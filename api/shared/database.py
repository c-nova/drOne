# copied from DeepResearchFunctionApp/shared/database.py
from .settings import get_config

backend = (get_config('DATABASE_PROVIDER', 'sqlite') or 'sqlite').lower()

if backend == 'cosmos':
    from .db_cosmos import ResearchJobManager  # noqa: F401
else:
    from .db_sqlite import ResearchJobManager  # noqa: F401
