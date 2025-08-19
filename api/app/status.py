"""Run status & message retrieval service.

Ports logic from original Azure Functions CheckStatus:
 - Query Azure AI Foundry run status if run/thread IDs exist
 - Persist result & citations on completion
 - Update progress or mark failure accordingly
"""
from typing import Dict, Any, List
import logging

try:
    from shared.settings import get_config  # type: ignore
except Exception:  # pragma: no cover
    from DeepResearchFunctionApp.shared.settings import get_config  # type: ignore

try:
    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential
except Exception:  # pragma: no cover
    AIProjectClient = None  # type: ignore
    DefaultAzureCredential = None  # type: ignore


class StatusService:
    def __init__(self, job_manager):
        self.job_manager = job_manager

    def update_and_collect(self, job: Dict[str, Any]) -> Dict[str, Any]:
        messages_data = None
        updated = False
        run_id = job.get('run_id')
        thread_id = job.get('thread_id')
        if not run_id or not thread_id:
            return {"messages": messages_data, "updated": updated}

        if AIProjectClient is None or DefaultAzureCredential is None:
            logging.debug("AI packages missing; skipping remote run status check")
            return {"messages": messages_data, "updated": updated}

        project_endpoint = get_config("PROJECT_ENDPOINT")
        if not project_endpoint:
            logging.debug("PROJECT_ENDPOINT not configured; skipping remote status check")
            return {"messages": messages_data, "updated": updated}

        try:
            project = AIProjectClient(
                endpoint=project_endpoint,
                credential=DefaultAzureCredential()
            )
            run = project.agents.runs.get(thread_id=thread_id, run_id=run_id)
            run_status = getattr(run, 'status', None)
            logging.info(f"Run status for job {job.get('id')}: {run_status}")

            # Fetch messages (best effort)
            messages_data = []
            try:
                msgs = project.agents.runs.get_messages(run_id=run_id)
                for m in msgs:
                    msg_dict = {
                        'id': getattr(m, 'id', None),
                        'role': getattr(m, 'role', None),
                        'created_at': getattr(m, 'created_at', None),
                        'content': getattr(m, 'content', None)
                    }
                    annotations = getattr(m, 'annotations', None)
                    if annotations:
                        msg_dict['annotations'] = annotations
                    messages_data.append(msg_dict)
            except Exception as e:  # pragma: no cover
                logging.debug(f"Message fetch failure: {e}")

            if run_status == 'completed':
                content_text = self._extract_primary_content(messages_data)
                if content_text:
                    self.job_manager.update_job_result(job['id'], content_text)
                self.job_manager.update_job_status(job['id'], 'completed', 'Deep Research調査が完了しました')
                self._extract_and_store_citations(job['id'], messages_data)
                updated = True
            elif run_status in ('failed', 'expired'):
                self.job_manager.update_job_error(job['id'], f"Run ended with status {run_status}")
                updated = True
            elif run_status in ('queued', 'in_progress', 'requires_action'):
                current_step = f"Deep Research実行中... (Status: {run_status})"
                self.job_manager.update_job_status(job['id'], 'in_progress', current_step)
                updated = True
                if run_status == 'requires_action':
                    self.job_manager.add_job_step(job['id'], 'requires_action', 'アクションが必要です')
            return {"messages": messages_data, "updated": updated}
        except Exception as e:  # pragma: no cover
            logging.error(f"StatusService error: {e}")
            return {"messages": messages_data, "updated": updated, "error": str(e)}

    def _extract_primary_content(self, messages: List[Dict[str, Any]]):
        assistants = [m for m in messages if m.get('role') == 'assistant']
        if not assistants:
            return None
        c = assistants[0].get('content')
        if isinstance(c, list):
            parts = []
            for part in c:
                if isinstance(part, dict):
                    text_obj = part.get('text')
                    if isinstance(text_obj, dict):
                        val = text_obj.get('value')
                        if val:
                            parts.append(val)
            return "\n".join(parts).strip() if parts else None
        if isinstance(c, str):
            return c
        return None

    def _extract_and_store_citations(self, job_id: str, messages: List[Dict[str, Any]]):
        try:
            for msg in messages:
                anns = msg.get('annotations') or []
                for ann in anns:
                    if not isinstance(ann, dict):
                        continue
                    t = ann.get('type')
                    if t == 'url_citation':
                        url_citation_obj = ann.get('url_citation') or {}
                        if isinstance(url_citation_obj, str):
                            import json
                            try:
                                url_citation_obj = json.loads(url_citation_obj)
                            except Exception:  # pragma: no cover
                                url_citation_obj = {}
                        citation_id = ann.get('text', '')
                        citation_url = url_citation_obj.get('url', '')
                        citation_title = url_citation_obj.get('title', '')
                        self.job_manager.add_job_step(job_id, 'citation', f"{citation_id}: {citation_url} [{citation_title}]")
                    elif t == 'file_citation':
                        file_citation_obj = ann.get('file_citation') or {}
                        if isinstance(file_citation_obj, str):
                            import json
                            try:
                                file_citation_obj = json.loads(file_citation_obj)
                            except Exception:  # pragma: no cover
                                file_citation_obj = {}
                        citation_id = ann.get('text', '')
                        citation_url = file_citation_obj.get('file_id', '')
                        citation_title = file_citation_obj.get('quote', '')
                        self.job_manager.add_job_step(job_id, 'citation', f"{citation_id}: {citation_url} [{citation_title}]")
        except Exception as e:  # pragma: no cover
            logging.debug(f"Citation extraction failed: {e}")
