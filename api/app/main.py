from fastapi import FastAPI, Depends, HTTPException, Request, Query
from fastapi.responses import JSONResponse
from typing import Optional
from .security import get_current_principal
from .storage import get_job_manager, get_backend_debug
from .models import StartResearchRequest
from .research import DeepResearchService
from .status import StatusService
import logging

app = FastAPI(title="Deep Research API", version="0.1.0")


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/healthz/storage")
async def healthz_storage():
    import os
    provider = (os.getenv('DATABASE_PROVIDER') or 'sqlite').lower()
    jm = get_job_manager()
    mod = jm.__class__.__module__
    if 'db_cosmos' in mod:
        backend = 'cosmos'
    elif 'db_sqlite' in mod:
        backend = 'sqlite'
    else:
        backend = 'memory'
    status = 'ok'
    warning = None
    if provider == 'cosmos' and backend != 'cosmos':
        status = 'fallback'
        warning = 'Cosmos requested but fell back (missing config or package)'
    return {
        'status': status,
        'backend': backend,
        'requested': provider,
        'warning': warning,
        'debug': get_backend_debug()
    }


@app.get("/api/ListJobs")
async def list_jobs(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    principal=Depends(get_current_principal),
    job_manager=Depends(get_job_manager)
):
    try:
        # user_id指定が無ければ本人
        target_user = user_id or principal.get('user_id')
        jobs = job_manager.get_jobs(user_id=target_user, status=status, limit=limit)
        all_jobs = job_manager.get_jobs(user_id=target_user, limit=1000)
        for job in jobs:
            created = job.get('created_at')
            if created and isinstance(created, str) and not created.endswith('Z'):
                job['start_time'] = created + 'Z'
            else:
                job['start_time'] = created
            job['thread_id'] = job.get('thread_id', '-')
        stats = {
            'total': len(all_jobs),
            'completed': len([j for j in all_jobs if j['status'] == 'completed']),
            'in_progress': len([j for j in all_jobs if j['status'] in ['created', 'starting', 'in_progress']]),
            'failed': len([j for j in all_jobs if j['status'] == 'failed'])
        }
        return {"jobs": jobs, "stats": stats, "filters": {"user_id": target_user, "status": status, "limit": limit}}
    except Exception as e:
        logging.exception("ListJobs error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/StartResearch")
async def start_research(
    payload: StartResearchRequest,
    principal=Depends(get_current_principal),
    job_manager=Depends(get_job_manager)
):
    try:
        service = DeepResearchService(job_manager)
        resp = service.start_research(
            query=payload.query,
            user_id=principal.get('user_id'),
            tool_choice=payload.tool_choice,
            deep_research_model=payload.deep_research_model,
            bing_grounding_connections=payload.bing_grounding_connections
        )
        if resp.get('status') == 'failed':
            raise HTTPException(status_code=500, detail=resp.get('error', 'Failed'))
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("StartResearch error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/GetResult/{job_id}")
async def get_result(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    req_user = principal.get('user_id')
    if job.get('user_id') not in (req_user, None, 'anonymous'):
        raise HTTPException(status_code=403, detail="Forbidden")
    steps = job_manager.get_job_steps(job_id)
    citations = []
    for step in steps:
        if step.get('step_name') == 'citation':
            detail = step.get('step_details', '')
            if ':' in detail:
                try:
                    citation_id = detail.split(':')[0].strip()
                    rest = detail.split(':', 1)[1].strip()
                    if '[' in rest and ']' in rest:
                        url = rest.split('[')[0].strip()
                        title = rest.split('[')[1].split(']')[0].strip()
                    else:
                        url = rest
                        title = ''
                    citations.append({'id': citation_id, 'url': url, 'title': title})
                except Exception:
                    pass
    def ensure_z(dt):
        if dt and isinstance(dt, str) and not dt.endswith('Z'):
            return dt + 'Z'
        return dt
    resp = {
        "job_id": job_id,
        "status": job['status'],
        "query": job['query'],
        "created_at": ensure_z(job.get('created_at')),
        "completed_at": ensure_z(job.get('completed_at')),
        "steps": steps,
        "citations": citations
    }
    if job['status'] == 'completed':
        resp['result'] = job['result']
        resp['success'] = True
    elif job['status'] == 'failed':
        resp['error'] = job['error_message']
        resp['success'] = False
    else:
        resp['current_step'] = job.get('current_step')
        resp['success'] = False
        resp['message'] = f"Job is still {job['status']}"
    return resp


# --- Compatibility alias routes (legacy frontend expects lowercase /api/research/*) ---
@app.post("/api/research/start")
async def start_research_alias(
    payload: StartResearchRequest,
    principal=Depends(get_current_principal),
    job_manager=Depends(get_job_manager)
):
    return await start_research(payload, principal, job_manager)  # type: ignore


@app.get("/api/research/result/{job_id}")
async def get_result_alias(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    return await get_result(job_id, principal, job_manager)  # type: ignore


@app.get("/api/CheckStatus/{job_id}")
async def check_status(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    req_user = principal.get('user_id')
    if job.get('user_id') not in (req_user, None, 'anonymous'):
        raise HTTPException(status_code=403, detail="Forbidden")
    # Backfill missing fields for legacy in-memory jobs
    if 'current_step' not in job:
        job['current_step'] = None
    if 'result' not in job:
        job['result'] = None
    if 'error_message' not in job:
        job['error_message'] = None

    status_service = StatusService(job_manager)
    status_info = status_service.update_and_collect(job)
    if status_info.get('updated'):
        job = job_manager.get_job(job_id) or job
    steps = job_manager.get_job_steps(job_id)

    def ensure_z(dt):
        if dt and isinstance(dt, str) and not dt.endswith('Z'):
            return dt + 'Z'
        return dt

    return {
        "job_id": job_id,
        "status": job.get('status'),
        "query": job.get('query'),
        "current_step": job.get('current_step'),
        "created_at": ensure_z(job.get('created_at')),
        "completed_at": ensure_z(job.get('completed_at')),
        "steps": steps,
        "has_result": bool(job.get('result')),
        "has_error": bool(job.get('error_message')),
        "error_message": job.get('error_message'),
        "thread_id": job.get('thread_id'),
        "run_id": job.get('run_id'),
        "messages": status_info.get('messages')
    }


@app.get("/api/research/status/{job_id}")
async def check_status_alias(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    return await check_status(job_id, principal, job_manager)  # type: ignore


@app.get("/api/CheckStatus")
async def check_status_query(job_id: str = Query(...), principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    return await check_status(job_id, principal, job_manager)  # type: ignore


@app.delete("/api/DeleteJob/{job_id}")
async def delete_job(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    req_user = principal.get('user_id')
    if job.get('user_id') not in (req_user, None, 'anonymous'):
        raise HTTPException(status_code=403, detail="Forbidden")
    job_manager.delete_job(job_id)
    return {"success": True, "message": f"Job {job_id} deleted"}


@app.delete("/api/research/delete/{job_id}")
async def delete_job_alias(job_id: str, principal=Depends(get_current_principal), job_manager=Depends(get_job_manager)):
    return await delete_job(job_id, principal, job_manager)  # type: ignore


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"error": str(exc)})
