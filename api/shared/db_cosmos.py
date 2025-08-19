# copied from DeepResearchFunctionApp/shared/db_cosmos.py
from typing import Optional, Dict, List
from datetime import datetime
import uuid, logging, os, traceback
try:
    from azure.cosmos import CosmosClient, PartitionKey
except Exception:
    CosmosClient = None  # type: ignore
try:
    from azure.identity import DefaultAzureCredential
except Exception:
    DefaultAzureCredential = None  # type: ignore
from .settings import get_config
class ResearchJobManager:
    def __init__(self):
        self._client=None; self._db=None; self._jobs=None; self._steps=None
        self._init_cosmos()
    def _init_cosmos(self):
        if CosmosClient is None:
            raise RuntimeError('azure-cosmos package not installed')
        account_uri = get_config('COSMOS_DB_ACCOUNT_URI') or get_config('COSMOS_DB_URI')
        if not account_uri:
            raise RuntimeError('COSMOS_DB_ACCOUNT_URI not configured')
        key = get_config('COSMOS_DB_KEY')
        use_identity = False
        if not key:
            if DefaultAzureCredential is None:
                raise RuntimeError('COSMOS_DB_KEY missing and azure.identity not available for MSI')
            use_identity = True
        database_name = get_config('COSMOS_DB_DATABASE', 'DeepResearch')
        jobs_container = get_config('COSMOS_JOBS_CONTAINER', 'research_jobs')
        steps_container = get_config('COSMOS_STEPS_CONTAINER', 'job_steps')
        debug = os.getenv('LOG_COSMOS_DEBUG', '').lower() in ('1','true','yes')
        try:
            if use_identity:
                logging.info('Cosmos init: using Managed Identity (AAD) auth; uri=%s db=%s', account_uri, database_name)
                cred = DefaultAzureCredential()
                self._client = CosmosClient(account_uri, credential=cred)
            else:
                scr_key = key[:6] + '...' if key else 'NONE'
                logging.info('Cosmos init: using key auth; uri=%s key=%s', account_uri, scr_key)
                self._client = CosmosClient(account_uri, key)
        except Exception as e:
            if debug:
                logging.error('Cosmos client creation failed: %s\n%s', e, traceback.format_exc())
            raise RuntimeError(f'Failed to create CosmosClient: {e}')
        try:
            self._db = self._client.create_database_if_not_exists(id=database_name)
            self._jobs = self._db.create_container_if_not_exists(id=jobs_container, partition_key=PartitionKey(path='/user_id'))
            self._steps = self._db.create_container_if_not_exists(id=steps_container, partition_key=PartitionKey(path='/job_id'))
            logging.info('Cosmos init success: db=%s containers=[%s,%s]', database_name, jobs_container, steps_container)
        except Exception as e:
            if debug:
                logging.error('Cosmos database/container ensure failed: %s\n%s', e, traceback.format_exc())
            raise RuntimeError(f'Failed ensuring database/containers: {e}')
    def delete_job(self, job_id: str):
        items = list(self._jobs.query_items(query='SELECT c.id, c.user_id FROM c WHERE c.id=@id', parameters=[{'name':'@id','value':job_id}], enable_cross_partition_query=True))
        if not items: return
        user_id = items[0]['user_id']
        for step in self._steps.query_items(query='SELECT c.id FROM c WHERE c.job_id=@job_id', parameters=[{'name':'@job_id','value':job_id}], enable_cross_partition_query=True):
            self._steps.delete_item(item=step['id'], partition_key=job_id)
        self._jobs.delete_item(item=job_id, partition_key=user_id)
    def create_job(self, query: str, user_id: str = 'anonymous') -> str:
        job_id = str(uuid.uuid4())
        doc = {'id':job_id,'user_id':user_id,'query':query,'status':'created','created_at':datetime.utcnow().replace(microsecond=0).isoformat()+'Z'}
        self._jobs.create_item(doc); return job_id
    def update_job_status(self, job_id: str, status: str, current_step: str = None, thread_id: str = None, run_id: str = None, agent_id: str = None):
        job = self.get_job(job_id);
        if not job: return
        job['status']=status
        if current_step is not None: job['current_step']=current_step
        if thread_id is not None: job['thread_id']=thread_id
        if run_id is not None: job['run_id']=run_id
        if agent_id is not None: job['agent_id']=agent_id
        if status in ('completed','failed'): job['completed_at']=datetime.utcnow().replace(microsecond=0).isoformat()+'Z'
        self._jobs.replace_item(item=job, body=job)
    def update_job_result(self, job_id: str, result: str):
        job = self.get_job(job_id);
        if not job: return
        job['result']=result; job['status']='completed'; job['completed_at']=datetime.utcnow().replace(microsecond=0).isoformat()+'Z'
        self._jobs.replace_item(item=job, body=job)
    def update_job_error(self, job_id: str, error_message: str):
        job = self.get_job(job_id);
        if not job: return
        job['error_message']=error_message; job['status']='failed'; job['completed_at']=datetime.utcnow().replace(microsecond=0).isoformat()+'Z'
        self._jobs.replace_item(item=job, body=job)
    def get_job(self, job_id: str) -> Optional[Dict]:
        items = list(self._jobs.query_items(query='SELECT * FROM c WHERE c.id=@id', parameters=[{'name':'@id','value':job_id}], enable_cross_partition_query=True))
        return items[0] if items else None
    def get_job_run_id(self, job_id: str) -> Optional[str]:
        items = list(self._jobs.query_items(query='SELECT c.run_id FROM c WHERE c.id=@id', parameters=[{'name':'@id','value':job_id}], enable_cross_partition_query=True))
        if items: return items[0].get('run_id'); return None
    def get_jobs(self, user_id: str = None, status: str = None, limit: int = 50) -> List[Dict]:
        if user_id:
            query='SELECT TOP @limit * FROM c WHERE c.user_id=@uid'
            params=[{'name':'@limit','value':limit},{'name':'@uid','value':user_id}]
            if status:
                query+=' AND c.status=@st'; params.append({'name':'@st','value':status})
            return list(self._jobs.query_items(query=query, parameters=params, partition_key=user_id))
        query='SELECT * FROM c'; params=[]
        if status: query+=' WHERE c.status=@st'; params.append({'name':'@st','value':status})
        query+=' ORDER BY c.created_at DESC'; items=list(self._jobs.query_items(query=query, parameters=params, enable_cross_partition_query=True))
        return items[:limit]
    def add_job_step(self, job_id: str, step_name: str, step_details: str = None):
        doc={'id':str(uuid.uuid4()),'job_id':job_id,'step_name':step_name,'step_details':step_details,'timestamp':datetime.utcnow().replace(microsecond=0).isoformat()+'Z'}
        self._steps.create_item(doc)
    def get_job_steps(self, job_id: str) -> List[Dict]:
        return list(self._steps.query_items(query='SELECT * FROM c WHERE c.job_id=@job_id ORDER BY c.timestamp ASC', parameters=[{'name':'@job_id','value':job_id}], partition_key=job_id))
