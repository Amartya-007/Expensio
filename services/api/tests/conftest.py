"""Shared pytest fixtures for the FastAPI service test suite.

The app under test reads several settings straight from ``os.environ``
(``DATABASE_URL``, ``SUPABASE_JWKS_URL``, ``SUPABASE_JWT_ISSUER`` — see
``app/repository.py`` and ``app/auth.py``), and ``app.main`` calls
``load_dotenv()`` at import time. Without this fixture, a developer's local
``services/api/.env`` (or any of these vars already exported in their shell)
would leak into every test process: tests that construct
``PostgresBalanceRepository(dsn="")`` or ``SupabaseJwtVerifier(jwks_url="")``
to assert the "not configured" error path would instead pick up the real
value from the environment and fail non-deterministically depending on
whatever the developer happened to have configured locally.
"""

import os

import pytest

_ENV_VARS_UNDER_TEST = ("DATABASE_URL", "SUPABASE_JWKS_URL", "SUPABASE_JWT_ISSUER")


@pytest.fixture(autouse=True)
def _clean_service_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ENV_VARS_UNDER_TEST:
        monkeypatch.delenv(name, raising=False)
