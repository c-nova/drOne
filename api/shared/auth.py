# copied from DeepResearchFunctionApp/shared/auth.py
import base64, json
from typing import Optional, Dict, Any
from .settings import get_config

def _b64url_decode(data: str) -> bytes:
    padding = '=' * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)

def get_current_user(req) -> Optional[Dict[str, Any]]:
    principal_b64 = req.headers.get('x-ms-client-principal') or req.headers.get('X-MS-CLIENT-PRINCIPAL')
    if not principal_b64:
        if (get_config('ALLOW_ANONYMOUS', 'true') or 'true').lower() == 'true':
            return {"user_id": "anonymous", "roles": ["anonymous"]}
        return None
    try:
        data = json.loads(_b64url_decode(principal_b64).decode('utf-8'))
        user_id = data.get('userId') or data.get('user_id') or data.get('claims', [{}])[0].get('val')
        return {
            "user_id": user_id or "anonymous",
            "identity_provider": data.get('identityProvider'),
            "user_details": data.get('userDetails'),
            "roles": data.get('userRoles', [])
        }
    except Exception:
        if (get_config('ALLOW_ANONYMOUS', 'true') or 'true').lower() == 'true':
            return {"user_id": "anonymous", "roles": ["anonymous"]}
        return None
