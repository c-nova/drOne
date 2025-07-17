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
            response_data = {
                "job_id": job_id,
                "status": "created",
                "message": "Research job created successfully",
                "created_at": datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
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
