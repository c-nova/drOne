"""Backend selector for job storage.

Respects DATABASE_PROVIDER env/secret (sqlite|cosmos). Default sqlite.
Falls back gracefully to in-memory if import chain fails (local dev safety net).
"""
from functools import lru_cache
from typing import Any
import os
import logging
import traceback

# Debug metadata for introspection
_backend_provider: str | None = None
_backend_selected_base: str | None = None
_backend_errors: list[str] = []
_backend_init_error: str | None = None


def _load_backend():
    global _backend_provider, _backend_selected_base, _backend_errors
    provider = (os.getenv('DATABASE_PROVIDER') or 'sqlite').lower()
    _backend_provider = provider
    # Try new local package import first, then legacy path for backward compat
    module_base_candidates = [
        'shared',  # local copied shared folder
        'DeepResearchFunctionApp.shared'  # legacy path
    ]
    last_err = None
    for base in module_base_candidates:
        try:
            if provider == 'cosmos':
                mod = __import__(f'{base}.db_cosmos', fromlist=['ResearchJobManager'])
            else:
                mod = __import__(f'{base}.db_sqlite', fromlist=['ResearchJobManager'])
            logging.info(f"Selected backend '{provider}' via module base '{base}'")
            _backend_selected_base = base
            return getattr(mod, 'ResearchJobManager')
        except Exception as e:  # pragma: no cover
            last_err = e
            _backend_errors.append(f"{base}: {e}")
            logging.warning(f"Backend import failed for base '{base}' (provider={provider}): {e}")
            continue
    logging.error(f"All backend imports failed for provider '{provider}' (last error: {last_err}); falling back to in-memory store")
    # Fallback dummy (in-memory)
    class FallbackJobManager:  # type: ignore
        def __init__(self):
            self._jobs = {}
            self._steps = {}
        def create_job(self, query: str, user_id: str):
            jid = f"mem-{len(self._jobs)+1}"
            self._jobs[jid] = {
                "id": jid,
                "query": query,
                "status": "created",
                "user_id": user_id,
                "created_at": None,
                "current_step": None,
                "result": None,
                "error_message": None,
                "thread_id": None,
                "run_id": None
            }
            return jid
        def get_job(self, job_id: str):
            return self._jobs.get(job_id)
        def get_jobs(self, user_id=None, status=None, limit=50):
            vals = list(self._jobs.values())
            if user_id:
                vals = [v for v in vals if v.get('user_id') == user_id]
            if status:
                vals = [v for v in vals if v.get('status') == status]
            return vals[:limit]
        def get_job_steps(self, job_id: str):
            return []
        def delete_job(self, job_id: str):
            self._jobs.pop(job_id, None)
    return FallbackJobManager


def get_backend_debug() -> dict:
    return {
        'provider_requested': _backend_provider,
        'selected_base': _backend_selected_base,
        'import_errors': _backend_errors,
    'init_error': _backend_init_error,
    }


@lru_cache
def get_job_manager() -> Any:
    cls = _load_backend()
    try:
        return cls()
    except Exception as e:  # runtime init failure (e.g. cosmos config missing / RBAC)
        global _backend_init_error
        _backend_init_error = f"{e.__class__.__name__}: {e}"
        # Include stack if debug env enabled
        if os.getenv('LOG_COSMOS_DEBUG','').lower() in ('1','true','yes'):
            logging.error('Backend init error (stacktrace):\n%s', traceback.format_exc())
        logging.warning(f"Primary job backend init failed ({e}); attempting sqlite fallback then memory")
        # Try sqlite explicit (legacy path) first
        try:
            from DeepResearchFunctionApp.shared.db_sqlite import ResearchJobManager as SqliteManager  # type: ignore
            logging.info('Sqlite fallback (legacy path) succeeded after primary failure')
            return SqliteManager()
        except Exception as e2:
            logging.warning(f"Sqlite fallback failed ({e2}); using in-memory store")
            class FallbackJobManager:  # type: ignore
                def __init__(self):
                    self._jobs = {}
                def create_job(self, query: str, user_id: str):
                    jid = f"mem-{len(self._jobs)+1}"
                    self._jobs[jid] = {
                        "id": jid,
                        "query": query,
                        "status": "created",
                        "user_id": user_id,
                        "created_at": None,
                        "current_step": None,
                        "result": None,
                        "error_message": None,
                        "thread_id": None,
                        "run_id": None
                    }
                    return jid
                def get_job(self, job_id: str):
                    return self._jobs.get(job_id)
                def get_jobs(self, user_id=None, status=None, limit=50):
                    vals = list(self._jobs.values())
                    if user_id:
                        vals = [v for v in vals if v.get('user_id') == user_id]
                    if status:
                        vals = [v for v in vals if v.get('status') == status]
                    return vals[:limit]
                def get_job_steps(self, job_id: str):
                    return []
                def delete_job(self, job_id: str):
                    self._jobs.pop(job_id, None)
            return FallbackJobManager()
