import azure.functions as func
import json
import logging
import os
import sys

# 親ディレクトリをパスに追加してsharedモジュールをインポート
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from shared.database import ResearchJobManager

# Azure AI Foundry imports
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('CheckStatus function processed a request.')
    
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
        
        logging.info(f"Checking status for job {job_id}: {job['status']}")
        
        # Azure AI Foundryでのステータス確認（run_idがある場合）
        messages_data = None
        if job['run_id']:
            try:
                project_endpoint = os.getenv("PROJECT_ENDPOINT")
                if project_endpoint:
                    project = AIProjectClient(
                        endpoint=project_endpoint,
                        credential=DefaultAzureCredential()
                    )
                    # Runの状態を確認（正しくはruns.getを使う！）
                    run = project.agents.runs.get(
                        thread_id=job['thread_id'],
                        run_id=job['run_id']
                    )
                    logging.info(f"Run status: {run.status}")
                    logging.info(f"run: {run}")
                    # REST APIでFoundry Portalと同じパス＋バージョンで取得する！
                    import requests
                    api_version = "v1"
                    # project_endpointは/api/projects/{project}まで（末尾/は消す）
                    foundry_endpoint = project_endpoint.rstrip("/")
                    url = f"{foundry_endpoint}/threads/{job['thread_id']}/messages?api-version={api_version}"
                    # 認証トークン取得
                    token = DefaultAzureCredential().get_token("https://ai.azure.com/.default").token
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    }
                    response = requests.get(url, headers=headers)
                    logging.info(f"messages API response: {response.text}")
                    messages_data = []
                    try:
                        resp_json = response.json()
                        msg_list = resp_json.get("data", [])
                        logging.info(f"msg_list: {json.dumps(msg_list, ensure_ascii=False)}")
                        for msg in msg_list:
                            msg_dict = {
                                'id': msg.get('id'),
                                'role': msg.get('role'),
                                'created_at': msg.get('created_at'),
                                'content': []
                            }
                            for content_item in msg.get('content', []):
                                logging.info(f"content_item: {json.dumps(content_item, ensure_ascii=False)}")
                                # テキスト部分
                                if 'text' in content_item:
                                    msg_dict['content'].append(content_item['text'].get('value', ''))
                                    # 参考文献やリンク情報も抽出（annotationsもチェック！）
                                    annotations = content_item['text'].get('annotations', [])
                                    logging.info(f"annotations: {json.dumps(annotations, ensure_ascii=False)}")
                                    for ann in annotations:
                                        if ann.get('type') == 'url_citation':
                                            url = ann.get('url')
                                            title = ann.get('title')
                                            logging.info(f"url_citation found: url={url}, title={title}")
                                            if url:
                                                msg_dict.setdefault('citations', []).append({'url': url, 'title': title})
                                if 'source' in content_item:
                                    msg_dict.setdefault('sources', []).append(content_item['source'])
                                if 'url' in content_item:
                                    msg_dict.setdefault('urls', []).append(content_item['url'])
                                if 'reference' in content_item:
                                    msg_dict.setdefault('references', []).append(content_item['reference'])
                            messages_data.append(msg_dict)
                        logging.info(f"messages_data after extraction: {json.dumps(messages_data, ensure_ascii=False)}")
                    except Exception as ex:
                        logging.error(f"Error parsing messages API response: {ex}")
                        return func.HttpResponse(
                            json.dumps({"error": f"Error parsing messages API response: {str(ex)}"}),
                            status_code=500,
                            headers={"Content-Type": "application/json"}
                        )
                    # Run statusに基づいてジョブステータスを更新
                    if run.status == "completed":
                        logging.info(f"run.status==completed判定通過！")
                        assistant_messages = [msg for msg in msg_list if msg.get('role') == "assistant"]
                        if assistant_messages:
                            latest_message = assistant_messages[0]
                            # contentリストからテキストだけ抽出してjoin！
                            content = "\n".join([
                                c['text']['value']
                                for c in latest_message.get('content', [])
                                if 'text' in c and 'value' in c['text']
                            ])
                            job_manager.update_job_result(job_id, content.strip())
                            job_manager.add_job_step(job_id, 'completed', 'Deep Research調査が完了しました')
                            job_manager.update_job_status(job_id, 'completed', 'Deep Research調査が完了しました')
                            job = job_manager.get_job(job_id)
                            logging.info(f"update_job_status後のjob['status']: {job['status']}")
                    elif run.status == "failed" or run.status == "expired":
                        error_msg = f"Research failed with status: {run.status}"
                        job_manager.update_job_error(job_id, error_msg)
                        job_manager.add_job_step(job_id, 'failed', error_msg)
                        # 更新されたジョブ情報を再取得
                        job = job_manager.get_job(job_id)
                    elif run.status in ["queued", "in_progress", "requires_action"]:
                        # まだ実行中
                        current_step = f"Deep Research実行中... (Status: {run.status})"
                        job_manager.update_job_status(job_id, 'in_progress', current_step)
                        job = job_manager.get_job(job_id)
                        # ステップを記録
                        if run.status == "requires_action":
                            logging.info(f"Job {job_id}: requires_action判定！ユーザーアクション待ちだよ！")
                            job_manager.add_job_step(job_id, 'requires_action', 'アクションが必要です')
            except Exception as e:
                logging.error(f"Error checking run status: {str(e)}")
                # エラーが発生してもジョブの基本情報は返す
        
        # ジョブステップも取得
        steps = job_manager.get_job_steps(job_id)

        # messages_dataの中身をログに出す！
        logging.info(f"messages_data: {messages_data}")

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
            "current_step": job['current_step'],
            "created_at": ensure_z(job['created_at']),
            "completed_at": ensure_z(job['completed_at']),
            "steps": steps,
            "has_result": bool(job['result']),
            "has_error": bool(job['error_message']),
            "error_message": job['error_message'],
            "thread_id": job.get('thread_id'),
            "run_id": job.get('run_id'),
            "messages": messages_data
        }
        return func.HttpResponse(
            json.dumps(response_data),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )
        
    except Exception as e:
        logging.error(f"Error in CheckStatus function: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
