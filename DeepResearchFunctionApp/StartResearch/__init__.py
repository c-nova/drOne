import azure.functions as func
import json
import logging
import os
import sys
import threading
from datetime import datetime, timezone

# 親ディレクトリをパスに追加してsharedモジュールをインポート
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from shared.database import ResearchJobManager

# Azure AI Foundry imports

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from azure.ai.agents.models import DeepResearchTool

def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('StartResearch function processed a request.')
    
    try:
        # リクエストからクエリを取得
        req_body = req.get_json()
        if not req_body or 'query' not in req_body:
            return func.HttpResponse(
                json.dumps({"error": "Query parameter is required"}),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        
        query = req_body['query']
        user_id = req_body.get('user_id', 'anonymous')

        # tool_choice, bing_grounding_connectionsをリクエストボディから受け取る（なければ環境変数で自動生成）
        tool_choice = req_body.get('tool_choice')
        bing_grounding_connections = req_body.get('bing_grounding_connections', None)
        deep_research_model = req_body.get('deep_research_model')
        # もしbing_grounding_connectionsが文字列ならパース
        if isinstance(bing_grounding_connections, str):
            try:
                bing_grounding_connections = json.loads(bing_grounding_connections)
            except Exception:
                bing_grounding_connections = None

        # ジョブを作成
        job_manager = ResearchJobManager()
        job_id = job_manager.create_job(query, user_id)

        logging.info(f"Created research job {job_id} for query: {query}")

        # バックグラウンドでリサーチを開始
        def start_research_background(tool_choice_arg, bing_grounding_connections_arg, result_holder):
            try:
                logging.info(f"Starting background research for job {job_id}")

                # Azure AI Foundry設定
                project_endpoint = os.getenv("PROJECT_ENDPOINT")
                if not project_endpoint:
                    raise Exception("PROJECT_ENDPOINT environment variable is not set")

                project = AIProjectClient(
                    endpoint=project_endpoint,
                    credential=DefaultAzureCredential()
                )

                job_manager.add_job_step(job_id, 'agent_init', 'AI Agentを初期化しています')

                dr_model = deep_research_model or os.getenv("DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME", "latest")
                dr_bing_id = None
                if bing_grounding_connections and isinstance(bing_grounding_connections, list) and len(bing_grounding_connections) > 0:
                    dr_bing_id = bing_grounding_connections[0].get("connection_id")
                if not dr_bing_id:
                    bing_resource_name = os.getenv("BING_RESOURCE_NAME")
                    if bing_resource_name:
                        try:
                            conn = project.connections.get(name=bing_resource_name)
                            dr_bing_id = conn.id
                        except Exception as e:
                            raise Exception(f"Bing connection id取得失敗: {str(e)}")
                if not dr_bing_id:
                    raise Exception("Bing connection idが取得できませんでした")
                deep_research_tool = DeepResearchTool(
                    bing_grounding_connection_id=dr_bing_id,
                    deep_research_model=dr_model
                )

                agent = project.agents.create_agent(
                    model=os.getenv("MODEL_DEPLOYMENT_NAME", "gpt-4o"),
                    name="Deep Research Agent",
                    instructions=f"""あなたは詳細な調査を行う専門的なリサーチエージェントです。

ユーザーからの質問: {query}

この質問について、深く詳細な調査を行ってください。必ずDeep Research toolを使用して、最新で正確な情報を収集し、包括的な回答を提供してください。

以下の点に注意してください：
1. 必ずDeep Research toolを使用すること
2. 最新の情報を収集すること
3. 複数の信頼できるソースから情報を収集すること
4. 具体的で詳細な回答を提供すること
5. 一般的なレポートではなく、ユーザーの質問に焦点を当てた回答をすること""",
                    tools=deep_research_tool.definitions
                )

                run_tool_choice = {"type": "deep_research"}

                thread = project.agents.threads.create()
                message = project.agents.messages.create(
                    thread_id=thread.id,
                    role="user",
                    content=f"以下について詳細に調査してください。必ずDeep Research toolを使用してください:\n\n{query}"
                )
                run = project.agents.runs.create(
                    thread_id=thread.id,
                    agent_id=agent.id,
                    tool_choice=run_tool_choice
                )

                # 成功時のみin_progress＋IDを保存（agent_idも保存！）
                job_manager.update_job_status(
                    job_id,
                    'in_progress',
                    'Deep Research実行中...',
                    thread_id=thread.id,
                    run_id=run.id,
                    agent_id=agent.id
                )
                # デバッグ用: 作成直後のIDをDBのjob_stepsに記録
                job_manager.add_job_step(job_id, 'id_debug', f"thread_id={thread.id}, run_id={run.id}, agent_id={agent.id}")
                job_manager.add_job_step(job_id, 'run_created', f'Run ID: {run.id}で調査実行中')
                logging.info(f"Job {job_id}: Created run {run.id} in thread {thread.id} (agent {agent.id})")
                
                result_holder['success'] = True
                result_holder['error'] = None
                result_holder['run_id'] = run.id
                
                # 非同期でrun完了後のcitation保存を開始
                def save_citations_after_completion():
                    logging.info(f"[DEBUG] save_citations_after_completion function called")
                    job_manager.add_job_step(job_id, 'debug_citation_func', 'Citation保存関数が呼ばれました')
                    try:
                        # runの完了を待つ（statusがcompletedになるまでポーリング）
                        import time
                        max_wait = 600  # 最大10分
                        wait_count = 0
                        logging.info(f"[DEBUG] Starting citation save process for run_id={run.id}")
                        while wait_count < max_wait:
                            run_status = project.agents.runs.get(run_id=run.id)
                            logging.info(f"[DEBUG] run_status.status={getattr(run_status, 'status', None)} wait_count={wait_count}")
                            if getattr(run_status, 'status', None) == 'completed':
                                logging.info(f"[DEBUG] Run completed, proceeding with citation extraction")
                                break
                            time.sleep(5)
                            wait_count += 5
                        
                        # 完了したら再度get_messages
                        messages = project.agents.runs.get_messages(run_id=run.id)
                        logging.info(f"[DEBUG] 完了後のmessages数: {len(messages)}")
                        
                        # 追加: messagesのannotations内容を全部ログ出力
                        for msg in messages:
                            annotations = getattr(msg, 'annotations', None)
                            msg_id = getattr(msg, 'id', None)
                            msg_role = getattr(msg, 'role', None)
                            msg_content = getattr(msg, 'content', None)
                            logging.info(f"[DEBUG] msg.id={msg_id} role={msg_role} content_len={len(msg_content) if msg_content else 0}")
                            logging.info(f"[DEBUG] annotations={annotations}")
                            
                            # contentの中身も一部確認
                            if msg_content:
                                content_preview = msg_content[:200] + "..." if len(msg_content) > 200 else msg_content
                                logging.info(f"[DEBUG] content_preview={content_preview}")
                        
                        # Citation抽出処理
                        citation_count = 0
                        for msg in messages:
                            annotations = getattr(msg, 'annotations', None)
                            logging.info(f"[DEBUG] Processing message annotations: {annotations}")
                            
                            if annotations:
                                logging.info(f"[DEBUG] Found {len(annotations)} annotations")
                                for i, ann in enumerate(annotations):
                                    logging.info(f"[DEBUG] annotation[{i}]: {ann}")
                                    
                                    # 複数の形式を試す
                                    if isinstance(ann, dict):
                                        if ann.get('type') == 'url_citation':
                                            # パターン1: url_citation形式
                                            logging.info(f"[DEBUG] Found url_citation annotation")
                                            try:
                                                citation_id = ann.get('text', '')
                                                url_citation_obj = ann.get('url_citation', {})
                                                if isinstance(url_citation_obj, str):
                                                    url_citation_obj = json.loads(url_citation_obj)
                                                citation_url = url_citation_obj.get('url', '')
                                                citation_title = url_citation_obj.get('title', '')
                                                job_manager.add_job_step(job_id, 'citation', f"{citation_id}: {citation_url} [{citation_title}]")
                                                logging.info(f"[DEBUG] Citation保存 type1: {citation_id} -> {citation_url}")
                                                citation_count += 1
                                            except Exception as e:
                                                logging.warning(f"url_citation処理失敗: {str(e)}")
                                        elif ann.get('type') == 'file_citation':
                                            # パターン2: file_citation形式
                                            logging.info(f"[DEBUG] Found file_citation annotation")
                                            try:
                                                citation_id = ann.get('text', '')
                                                file_citation_obj = ann.get('file_citation', {})
                                                if isinstance(file_citation_obj, str):
                                                    file_citation_obj = json.loads(file_citation_obj)
                                                citation_url = file_citation_obj.get('file_id', '')
                                                citation_title = file_citation_obj.get('quote', '')
                                                job_manager.add_job_step(job_id, 'citation', f"{citation_id}: {citation_url} [{citation_title}]")
                                                logging.info(f"[DEBUG] Citation保存 type2: {citation_id} -> {citation_url}")
                                                citation_count += 1
                                            except Exception as e:
                                                logging.warning(f"file_citation処理失敗: {str(e)}")
                                        else:
                                            # その他の形式もログ出力
                                            logging.info(f"[DEBUG] Other annotation type: {ann.get('type')}")
                                    else:
                                        logging.info(f"[DEBUG] Non-dict annotation: {type(ann)}")
                            else:
                                logging.info(f"[DEBUG] No annotations found in message")
                        
                        logging.info(f"[DEBUG] Citation保存処理完了: {citation_count}個のcitationを保存")
                            
                    except Exception as e:
                        logging.error(f"[ERROR] save_citations_after_completion failed: {str(e)}")
                        logging.error(f"[ERROR] Exception traceback: {str(e)}")
                        import traceback
                        logging.error(f"[ERROR] Full traceback: {traceback.format_exc()}")
                
                # バックグラウンドスレッドでcitation保存を開始
                # citation_thread = threading.Thread(target=save_citations_after_completion)
                # citation_thread.daemon = True
                # citation_thread.start()
                
                # 同期的に実行に変更してテスト
                logging.info(f"[DEBUG] Starting synchronous citation save process")
                job_manager.add_job_step(job_id, 'debug_citation_start', 'Citation保存処理を開始します')
                save_citations_after_completion()
                job_manager.add_job_step(job_id, 'debug_citation_end', 'Citation保存処理を完了しました')
                logging.info(f"[DEBUG] Synchronous citation save process completed")
            except Exception as e:
                logging.error(f"Error in background research for job {job_id}: {str(e)}")
                job_manager.update_job_error(job_id, str(e))
                job_manager.add_job_step(job_id, 'error', f'エラーが発生しました: {str(e)}')
                result_holder['success'] = False
                result_holder['error'] = str(e)
        
        # バックグラウンドスレッドで実行開始
        # スレッドの実行結果を格納する辞書
        result_holder = {}
        thread = threading.Thread(target=start_research_background, args=(tool_choice, bing_grounding_connections, result_holder))
        thread.start()
        thread.join()  # 完全同期でrun/thread作成まで待つ（API応答で成否を返すため）

        if result_holder.get('success'):
            # run完了前のget_messagesでassistantメッセージを抽出
            try:
                project_endpoint = os.getenv("PROJECT_ENDPOINT")
                project = AIProjectClient(
                    endpoint=project_endpoint,
                    credential=DefaultAzureCredential()
                )
                messages = project.agents.runs.get_messages(run_id=result_holder.get('run_id', None) or job_manager.get_job_run_id(job_id))
                assistant_msgs = []
                for msg in messages:
                    if getattr(msg, 'role', None) == 'assistant':
                        content = getattr(msg, 'content', None)
                        created_at = getattr(msg, 'created_at', None)
                        annotations = getattr(msg, 'annotations', None)
                        assistant_msgs.append({
                            "content": content,
                            "created_at": created_at,
                            "annotations": annotations
                        })
            except Exception as e:
                logging.warning(f"中間メッセージ取得失敗: {str(e)}")
                assistant_msgs = []
            response_data = {
                "job_id": job_id,
                "status": "created",
                "message": "Research job created successfully",
                "created_at": datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
                "messages": assistant_msgs
            }
            return func.HttpResponse(
                json.dumps(response_data),
                status_code=200,
                headers={"Content-Type": "application/json"}
            )
        else:
            return func.HttpResponse(
                json.dumps({"error": result_holder.get('error', 'Unknown error')}),
                status_code=500,
                headers={"Content-Type": "application/json"}
            )
        
    except Exception as e:
        logging.error(f"Error in StartResearch function: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
