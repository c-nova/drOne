import azure.functions as func
import json
import logging
import os
import sys

# 親ディレクトリをパスに追加してsharedモジュールをインポート
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from shared.database import ResearchJobManager

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('ListJobs function processed a request.')
    
    try:
        # クエリパラメータを取得
        user_id = req.params.get('user_id')  # 指定なければ全ユーザー
        status = req.params.get('status')
        limit = int(req.params.get('limit', 50))

        job_manager = ResearchJobManager()

        # user_id指定なければ全件

        if user_id:
            jobs = job_manager.get_jobs(user_id=user_id, status=status, limit=limit)
            all_jobs = job_manager.get_jobs(user_id=user_id, limit=1000)
        else:
            jobs = job_manager.get_jobs(status=status, limit=limit)
            all_jobs = job_manager.get_jobs(limit=1000)

        # 各jobにstart_timeを追加（created_atをstart_timeとして渡す、Z付きUTCに変換）
        from datetime import timezone
        for job in jobs:
            if 'created_at' in job and job['created_at']:
                # 既にZ付きならそのまま、なければZを付与
                if isinstance(job['created_at'], str) and not job['created_at'].endswith('Z'):
                    job['start_time'] = job['created_at'] + 'Z'
                else:
                    job['start_time'] = job['created_at']
            # thread_idを明示的に追加（DBに入ってる場合はそのまま、なければ'-'）
            job['thread_id'] = job.get('thread_id', '-')

        stats = {
            'total': len(all_jobs),
            'completed': len([j for j in all_jobs if j['status'] == 'completed']),
            'in_progress': len([j for j in all_jobs if j['status'] in ['created', 'starting', 'in_progress']]),
            'failed': len([j for j in all_jobs if j['status'] == 'failed'])
        }

        response_data = {
            "jobs": jobs,
            "stats": stats,
            "filters": {
                "user_id": user_id,
                "status": status,
                "limit": limit
            }
        }
        
        return func.HttpResponse(
            json.dumps(response_data),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )
        
    except Exception as e:
        logging.error(f"Error in ListJobs function: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
