# copied from DeepResearchFunctionApp/shared/db_sqlite.py
import sqlite3, uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List

DB_PATH = Path(__file__).parent / 'research_jobs.db'

class ResearchJobManager:
    def __init__(self):
        self.init_database()
    def init_database(self):
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS research_jobs (
                    id TEXT PRIMARY KEY,
                    user_id TEXT DEFAULT 'anonymous',
                    query TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    current_step TEXT,
                    result TEXT,
                    error_message TEXT,
                    thread_id TEXT,
                    run_id TEXT,
                    agent_id TEXT
                )''')
            conn.execute('''CREATE TABLE IF NOT EXISTS job_steps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT,
                    step_name TEXT,
                    step_details TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )''')
            conn.commit()
    def delete_job(self, job_id: str):
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('DELETE FROM job_steps WHERE job_id = ?', (job_id,))
            conn.execute('DELETE FROM research_jobs WHERE id = ?', (job_id,))
            conn.commit()
    def create_job(self, query: str, user_id: str = 'anonymous') -> str:
        job_id = str(uuid.uuid4())
        created_at = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('''INSERT INTO research_jobs (id, user_id, query, status, created_at)
                VALUES (?, ?, ?, ?, ?)''', (job_id, user_id, query, 'created', created_at))
            conn.commit()
        return job_id
    def update_job_status(self, job_id: str, status: str, current_step: str = None,
                          thread_id: str = None, run_id: str = None, agent_id: str = None):
        with sqlite3.connect(str(DB_PATH)) as conn:
            cursor = conn.execute('SELECT thread_id, run_id, agent_id FROM research_jobs WHERE id = ?', (job_id,))
            row = cursor.fetchone()
            prev_thread_id = row[0] if row else None
            prev_run_id = row[1] if row else None
            prev_agent_id = row[2] if row else None
            new_thread_id = thread_id if thread_id is not None else prev_thread_id
            new_run_id = run_id if run_id is not None else prev_run_id
            new_agent_id = agent_id if agent_id is not None else prev_agent_id
            if status in ('completed', 'failed'):
                completed_at = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
                conn.execute('''UPDATE research_jobs SET status=?, current_step=?, completed_at=?,
                        thread_id=?, run_id=?, agent_id=? WHERE id = ?''',
                        (status, current_step, completed_at, new_thread_id, new_run_id, new_agent_id, job_id))
            else:
                conn.execute('''UPDATE research_jobs SET status=?, current_step=?, thread_id=?, run_id=?, agent_id=?
                        WHERE id = ?''', (status, current_step, new_thread_id, new_run_id, new_agent_id, job_id))
            conn.commit()
    def update_job_result(self, job_id: str, result: str):
        completed_at = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('''UPDATE research_jobs SET result=?, status='completed', completed_at=? WHERE id=?''',
                         (result, completed_at, job_id))
            conn.commit()
    def update_job_error(self, job_id: str, error_message: str):
        completed_at = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('''UPDATE research_jobs SET error_message=?, status='failed', completed_at=? WHERE id=?''',
                         (error_message, completed_at, job_id))
            conn.commit()
    def get_job(self, job_id: str) -> Optional[Dict]:
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute('SELECT * FROM research_jobs WHERE id = ?', (job_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    def get_job_run_id(self, job_id: str) -> Optional[str]:
        with sqlite3.connect(str(DB_PATH)) as conn:
            cursor = conn.execute('SELECT run_id FROM research_jobs WHERE id = ?', (job_id,))
            row = cursor.fetchone()
            return row[0] if row else None
    def get_jobs(self, user_id: str = None, status: str = None, limit: int = 50) -> List[Dict]:
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.row_factory = sqlite3.Row
            query = 'SELECT * FROM research_jobs'
            params = []
            cond = []
            if user_id:
                cond.append('user_id = ?')
                params.append(user_id)
            if status:
                cond.append('status = ?')
                params.append(status)
            if cond:
                query += ' WHERE ' + ' AND '.join(cond)
            query += ' ORDER BY created_at DESC LIMIT ?'
            params.append(limit)
            cursor = conn.execute(query, params)
            return [dict(r) for r in cursor.fetchall()]
    def add_job_step(self, job_id: str, step_name: str, step_details: str = None):
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.execute('''INSERT INTO job_steps (job_id, step_name, step_details) VALUES (?, ?, ?)''',
                         (job_id, step_name, step_details))
            conn.commit()
    def get_job_steps(self, job_id: str):
        with sqlite3.connect(str(DB_PATH)) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute('SELECT * FROM job_steps WHERE job_id=? ORDER BY timestamp ASC', (job_id,))
            return [dict(r) for r in cursor.fetchall()]
