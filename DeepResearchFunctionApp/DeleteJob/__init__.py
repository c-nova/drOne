import azure.functions as func
import json
import logging
import os
import sys

# 親ディレクトリをパスに追加してsharedモジュールをインポート
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from shared.database import ResearchJobManager

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('DeleteJob function processed a request.')
    try:
        job_id = req.route_params.get('job_id')
        if not job_id:
            return func.HttpResponse(
                json.dumps({"error": "Job ID is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        job_manager = ResearchJobManager()
        job = job_manager.get_job(job_id)
        if not job:
            return func.HttpResponse(
                json.dumps({"error": "Job not found"}),
                status_code=404,
                headers={"Content-Type": "application/json"}
            )
        job_manager.delete_job(job_id)
        return func.HttpResponse(
            json.dumps({"success": True, "message": f"Job {job_id} deleted"}),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )
    except Exception as e:
        logging.error(f"Error in DeleteJob function: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
