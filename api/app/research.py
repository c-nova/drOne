"""Deep Research orchestration extracted from original Azure Function.

This module ports the StartResearch logic to a service callable inside FastAPI.
Currently synchronous for MVP; can later move to background tasks (e.g. Celery,
Azure Container Apps Job, or async TaskGroup) without changing endpoint surface.
"""
from typing import Dict, Any, List, Optional
import logging
import json
from datetime import datetime, timezone

try:
    from shared.settings import get_config  # type: ignore
    from shared.database import ResearchJobManager  # type: ignore
except Exception:  # fallback to legacy path if running in original layout
    from DeepResearchFunctionApp.shared.settings import get_config  # type: ignore
    from DeepResearchFunctionApp.shared.database import ResearchJobManager  # type: ignore

try:
    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential
    from azure.ai.agents.models import DeepResearchTool
except Exception:  # pragma: no cover - libs may not be installed in all envs
    AIProjectClient = None  # type: ignore
    DefaultAzureCredential = None  # type: ignore
    DeepResearchTool = None  # type: ignore


class DeepResearchService:
    def __init__(self, job_manager: ResearchJobManager):
        self.job_manager = job_manager

    def start_research(self, query: str, user_id: str, tool_choice: Optional[str] = None,
                       deep_research_model: Optional[str] = None,
                       bing_grounding_connections: Optional[Any] = None) -> Dict[str, Any]:
        job_id = self.job_manager.create_job(query, user_id)
        logging.info(f"Created research job {job_id} for query={query}")

        # Early exit if libraries missing (local dev fallback)
        if AIProjectClient is None or DefaultAzureCredential is None or DeepResearchTool is None:
            logging.warning("Azure AI packages not available - returning stub response")
            return {
                "job_id": job_id,
                "status": "created",
                "message": "Research job created (Azure AI packages missing; processing skipped)",
                "created_at": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                "messages": []
            }

        try:
            project_endpoint = get_config("PROJECT_ENDPOINT")
            if not project_endpoint:
                raise RuntimeError("PROJECT_ENDPOINT not configured")

            credential = DefaultAzureCredential()
            project = AIProjectClient(endpoint=project_endpoint, credential=credential)

            # Resolve Bing grounding connection ID
            dr_bing_id = None
            if isinstance(bing_grounding_connections, list) and bing_grounding_connections:
                dr_bing_id = bing_grounding_connections[0].get("connection_id")
            if not dr_bing_id:
                bing_resource_name = get_config("BING_RESOURCE_NAME")
                if bing_resource_name:
                    try:
                        conn = project.connections.get(name=bing_resource_name)
                        dr_bing_id = conn.id
                    except Exception as e:
                        raise RuntimeError(f"Failed to fetch Bing connection id: {e}")
            if not dr_bing_id:
                raise RuntimeError("Bing connection id not resolved")

            dr_model = deep_research_model or get_config("DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME", "latest")
            deep_research_tool = DeepResearchTool(
                bing_grounding_connection_id=dr_bing_id,
                deep_research_model=dr_model
            )

            agent = project.agents.create_agent(
                model=get_config("MODEL_DEPLOYMENT_NAME", "gpt-4o"),
                name="Deep Research Agent",
                instructions=(
                    "あなたは詳細な調査を行う専門的なリサーチエージェントです。\n\n"
                    f"ユーザー質問: {query}\n\n"
                    "Deep Research toolを使用して包括的な回答を生成してください。"
                ),
                tools=deep_research_tool.definitions
            )

            run_tool_choice = {"type": "deep_research"}
            thread = project.agents.threads.create()
            project.agents.messages.create(
                thread_id=thread.id,
                role="user",
                content=(
                    "以下について詳細に調査してください。必ずDeep Research toolを使用してください:\n\n"
                    f"{query}"
                )
            )
            run = project.agents.runs.create(
                thread_id=thread.id,
                agent_id=agent.id,
                tool_choice=run_tool_choice
            )

            self.job_manager.update_job_status(
                job_id,
                'in_progress',
                'Deep Research実行中...',
                thread_id=thread.id,
                run_id=run.id,
                agent_id=agent.id
            )
            self.job_manager.add_job_step(job_id, 'id_debug', f"thread_id={thread.id}, run_id={run.id}, agent_id={agent.id}")
            self.job_manager.add_job_step(job_id, 'run_created', f'Run ID: {run.id} executing')

            # Early assistant messages (may be empty)
            assistant_msgs: List[Dict[str, Any]] = []
            try:
                messages = project.agents.runs.get_messages(run_id=run.id)
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
                logging.debug(f"Early message fetch failed: {e}")

            return {
                "job_id": job_id,
                "status": "created",
                "message": "Research job created successfully",
                "created_at": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                "messages": assistant_msgs
            }
        except Exception as e:
            logging.error(f"DeepResearchService error: {e}")
            self.job_manager.update_job_error(job_id, str(e))
            self.job_manager.add_job_step(job_id, 'error', f'エラー: {e}')
            return {
                "job_id": job_id,
                "status": "failed",
                "error": str(e)
            }
