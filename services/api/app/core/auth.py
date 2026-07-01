"""Verificación de tokens de sesión de Clerk (opcional, seguro por defecto).

Si no hay `CLERK_ISSUER` configurado, la autenticación está deshabilitada y la app funciona
solo en modo **invitado** (identidad anónima por dispositivo). Con él configurado, se verifica
la firma RS256 del token contra el JWKS del emisor y se devuelve el `sub` (id del usuario Clerk).

Nunca lanza: ante cualquier problema devuelve `None` (se trata como invitado).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from app.core.config import get_settings


@lru_cache(maxsize=1)
def _jwk_client():
    """Cliente JWKS del emisor Clerk (cacheado). None si no hay emisor configurado."""
    issuer = get_settings().clerk_issuer
    if not issuer:
        return None
    import jwt  # perezoso: la app arranca aunque falte la dependencia

    return jwt.PyJWKClient(f"{issuer.rstrip('/')}/.well-known/jwks.json")


def verify_bearer(authorization: Optional[str]) -> Optional[str]:
    """Devuelve el id de usuario (sub) si el Bearer es un token Clerk válido; si no, None."""
    issuer = get_settings().clerk_issuer
    if not issuer or not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    try:
        import jwt

        client = _jwk_client()
        if client is None:
            return None
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False, "require": ["exp", "iss", "sub"]},
        )
        sub = claims.get("sub")
        return str(sub) if sub else None
    except Exception:  # noqa: BLE001 — token inválido/expirado → invitado
        return None
