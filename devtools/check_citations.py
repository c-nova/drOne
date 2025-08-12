#!/usr/bin/env python3
"""
現在実行中のrunのmessagesを取得してannotationsを確認するスクリプト
"""
import os
import json
import logging
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

# ログ設定
logging.basicConfig(level=logging.INFO)

def main():
    run_id = "run_vDJlbojkDe6XL4PRW4s5bcW0"
    thread_id = "thread_3gQMUrmEgkpMOluBSOZNxrwZ"
    
    try:
        # Azure AI Foundry設定
        project_endpoint = os.getenv("PROJECT_ENDPOINT")
        if not project_endpoint:
            raise Exception("PROJECT_ENDPOINT environment variable is not set")

        project = AIProjectClient(
            endpoint=project_endpoint,
            credential=DefaultAzureCredential()
        )

        print(f"🔍 Checking messages for run_id: {run_id}")
        
        # run statusを確認
        run_status = project.agents.runs.get(thread_id=thread_id, run_id=run_id)
        print(f"📊 Run status: {getattr(run_status, 'status', 'unknown')}")
        
        # messagesを取得
        messages = project.agents.runs.get_messages(run_id=run_id)
        print(f"📝 Total messages: {len(messages)}")
        
        # 各メッセージのannotationsを確認
        for i, msg in enumerate(messages):
            role = getattr(msg, 'role', 'unknown')
            content = getattr(msg, 'content', '')
            annotations = getattr(msg, 'annotations', None)
            created_at = getattr(msg, 'created_at', None)
            
            print(f"\n--- Message {i+1} ---")
            print(f"Role: {role}")
            print(f"Created at: {created_at}")
            print(f"Content length: {len(content) if content else 0}")
            print(f"Annotations: {annotations is not None}")
            
            if annotations:
                print(f"Annotations count: {len(annotations)}")
                for j, ann in enumerate(annotations):
                    print(f"  Annotation {j+1}: {json.dumps(ann, ensure_ascii=False, indent=2)}")
                    
                    # url_citationタイプのannotationを特に確認
                    if ann.get('type') == 'url_citation':
                        print(f"  🔗 Found URL citation: {ann.get('text', 'No text')}")
                        url_citation_obj = ann.get('url_citation', {})
                        if isinstance(url_citation_obj, str):
                            try:
                                url_citation_obj = json.loads(url_citation_obj)
                            except Exception as e:
                                print(f"  ❌ JSON parse error: {str(e)}")
                                continue
                        print(f"  URL: {url_citation_obj.get('url', 'No URL')}")
                        print(f"  Title: {url_citation_obj.get('title', 'No title')}")
            
            if content and len(content) > 0:
                print(f"Content preview: {content[:200]}...")
                
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
