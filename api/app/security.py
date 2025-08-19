import base64
import json
import os
import hmac
import hashlib
from fastapi import Request, HTTPException
from typing import Optional, Dict, Any

# Anonymous許可はデフォルトで true だったが保護強化用に環境変数で制御
#   ALLOW_ANONYMOUS=0 / false / no で匿名拒否
ALLOW_ANONYMOUS_DEFAULT = os.getenv('ALLOW_ANONYMOUS','1').lower() not in ['0','false','no']

_cached_api_key: Optional[str] = None

def _load_expected_api_key() -> Optional[str]:
    """Key Vault または環境変数から API キー取得 (API_KEY / API-KEY)。結果はプロセス内キャッシュ。"""
    global _cached_api_key
    if _cached_api_key is not None:
        return _cached_api_key
    try:
        # 遅延 import (Key Vault / identity 失敗時も graceful)
        from shared.settings import get_config  # type: ignore
    except Exception:
        get_config = None  # type: ignore
    candidates = [
        os.getenv('API_KEY'),
        os.getenv('API-KEY'),
    ]
    if get_config:
        try:
            candidates.append(get_config('API_KEY'))
            candidates.append(get_config('API-KEY'))
        except Exception:
            pass
    for val in candidates:
        if val and val.strip():
            _cached_api_key = val.strip()
            break
    return _cached_api_key

def _secure_compare(a: str, b: str) -> bool:
    try:
        return hmac.compare_digest(a.encode(), b.encode())
    except Exception:
        return False


def _b64url_decode(data: str) -> bytes:
    padding = '=' * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def parse_principal(header_val: str) -> Optional[Dict[str, Any]]:
    if not header_val:
        return None
    try:
        data = json.loads(_b64url_decode(header_val).decode('utf-8'))
        user_id = data.get('userId') or data.get('user_id') or data.get('claims', [{}])[0].get('val')
        return {
            "user_id": user_id or "anonymous",
            "identity_provider": data.get('identityProvider'),
            "user_details": data.get('userDetails'),
            "roles": data.get('userRoles', [])
        }
    except Exception:
        return None


def get_current_principal(request: Request):
    # 1. Static Web Apps 互換ヘッダ優先
    principal_b64 = request.headers.get('x-ms-client-principal') or request.headers.get('X-MS-CLIENT-PRINCIPAL')
    principal = parse_principal(principal_b64)
    if principal:
        return principal

    # 2. API Key (x-api-key) / Authorization: ApiKey <key>
    provided_key = request.headers.get('x-api-key') or None
    if not provided_key:
        auth_header = request.headers.get('authorization') or request.headers.get('Authorization')
        if auth_header and auth_header.lower().startswith('apikey '):
            provided_key = auth_header.split(' ',1)[1].strip()
    expected = _load_expected_api_key()
    if expected and provided_key and _secure_compare(provided_key, expected):
        return {"user_id": "api_key", "roles": ["api_key"]}

    # 3. 匿名許可 or 拒否
    if ALLOW_ANONYMOUS_DEFAULT:
        return {"user_id": "anonymous", "roles": ["anonymous"]}
    raise HTTPException(status_code=401, detail="Unauthorized")
