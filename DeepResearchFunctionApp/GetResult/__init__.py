import azure.functions as func
import json
import logging
import os
import sys

# 親ディレクトリをパスに追加してsharedモジュールをインポート
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from shared.database import ResearchJobManager

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('GetResult function processed a request.')
    
    try:
        # URLパラメータからjob_idを取得
        job_id = req.route_params.get('job_id')
        
        if not job_id:
            return func.HttpResponse(
                json.dumps({"error": "Job ID is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        
        # ジョブの詳細を取得
        job_manager = ResearchJobManager()
        job = job_manager.get_job(job_id)
        
        if not job:
            return func.HttpResponse(
                json.dumps({"error": "Job not found"}),
                status_code=404,
                headers={"Content-Type": "application/json"}
            )
        
        logging.info(f"Getting result for job {job_id}: {job['status']}")
        
        # ジョブステップも取得
        steps = job_manager.get_job_steps(job_id)
        
        # レスポンスデータを構築
        # created_at, completed_atをZ付きUTCで返す
        def ensure_z(dt):
            if dt and isinstance(dt, str) and not dt.endswith('Z'):
                return dt + 'Z'
            return dt
        response_data = {
            "job_id": job_id,
            "status": job['status'],
            "query": job['query'],
            "created_at": ensure_z(job['created_at']),
            "completed_at": ensure_z(job['completed_at']),
            "steps": steps
        }
        
        # ステータスに応じてレスポンスを構築
        if job['status'] == 'completed':
            response_data['result'] = job['result']
            response_data['success'] = True
        elif job['status'] == 'failed':
            response_data['error'] = job['error_message']
            response_data['success'] = False
        else:
            # まだ完了していない場合
            response_data['current_step'] = job['current_step']
            response_data['success'] = False
            response_data['message'] = f"Job is still {job['status']}"
        
        return func.HttpResponse(
            json.dumps(response_data),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )
        
    except Exception as e:
        logging.error(f"Error in GetResult function: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
