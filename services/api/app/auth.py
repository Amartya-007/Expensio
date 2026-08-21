from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Mapping


class AuthError(ValueError):
    """Raised when a Supabase access token cannot authenticate a request."""


@dataclass(frozen=True)
class Claims:
    user_id: str
    role: str
    raw: Mapping[str, Any]


class SupabaseJwtVerifier:
    def __init__(
        self,
        decode_token: Callable[[str], Mapping[str, Any]] | None = None,
        *,
        jwks_url: str | None = None,
        issuer: str | None = None,
        audience: str = "authenticated",
    ) -> None:
        self._decode_token = decode_token
        self._jwks_url = jwks_url or os.getenv("SUPABASE_JWKS_URL")
        self._issuer = issuer or os.getenv("SUPABASE_JWT_ISSUER")
        self._audience = audience
        self._jwks_client: Any = None

    def _decode_with_supabase_jwks(self, token: str) -> Mapping[str, Any]:
        if not self._jwks_url:
            raise AuthError("SUPABASE_JWKS_URL is not configured")

        try:
            import jwt
            from jwt import PyJWKClient

            if self._jwks_client is None:
                self._jwks_client = PyJWKClient(self._jwks_url, cache_jwk_set=True)
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            options = {"require": ["sub", "exp"]}
            kwargs: dict[str, Any] = {
                "algorithms": ["RS256", "ES256"],
                "audience": self._audience,
                "options": options,
            }
            if self._issuer:
                kwargs["issuer"] = self._issuer
            return jwt.decode(token, signing_key.key, **kwargs)
        except AuthError:
            raise
        except Exception as exc:  # PyJWT exposes several provider-specific exceptions.
            raise AuthError("invalid Supabase access token") from exc

    def verify(self, token: str) -> Claims:
        try:
            raw = (
                self._decode_token(token)
                if self._decode_token is not None
                else self._decode_with_supabase_jwks(token)
            )
        except AuthError:
            raise
        except Exception as exc:
            raise AuthError("invalid Supabase access token") from exc

        user_id = raw.get("sub")
        role = raw.get("role")
        if not isinstance(user_id, str) or not user_id:
            raise AuthError("access token is missing a subject")
        if role != "authenticated":
            raise AuthError("access token is not authenticated")
        return Claims(user_id=user_id, role=role, raw=raw)
