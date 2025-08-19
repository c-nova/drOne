"""App package init: ensure repo root on sys.path for sibling package imports.

Allows 'DeepResearchFunctionApp.shared...' imports when running uvicorn from
the api/ directory locally (Dockerfile already sets PYTHONPATH at runtime).
"""
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parents[2]
if str(repo_root) not in sys.path:
	sys.path.insert(0, str(repo_root))
