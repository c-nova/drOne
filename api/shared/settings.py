# copied from DeepResearchFunctionApp/shared/settings.py
import os
from typing import Optional

try:
    from azure.identity import DefaultAzureCredential
except Exception:  # pragma: no cover
    DefaultAzureCredential = None  # type: ignore
try:
    from azure.keyvault.secrets import SecretClient
except Exception:  # pragma: no cover
    SecretClient = None  # type: ignore

def _get_kv_client():
    kv_uri = os.getenv("KEY_VAULT_URI")
    if not kv_uri or SecretClient is None or DefaultAzureCredential is None:
        return None
    try:
        cred = DefaultAzureCredential()
        return SecretClient(vault_url=kv_uri, credential=cred)
    except Exception:
        return None

def get_secret(name: str, default: Optional[str] = None) -> Optional[str]:
    client = _get_kv_client()
    if client:
        try:
            return client.get_secret(name).value
        except Exception:
            dashed = name.replace('_', '-')
            if dashed != name:
                try:
                    return client.get_secret(dashed).value
                except Exception:
                    pass
    return os.getenv(name, default)

def get_config(name: str, default: Optional[str] = None) -> Optional[str]:
    return get_secret(name, default)
