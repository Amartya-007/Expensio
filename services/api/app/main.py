from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the project root (services/api/.env) before any os.getenv() calls.
# uvicorn does NOT auto-load .env files — without this, SUPABASE_JWKS_URL and
# DATABASE_URL are never set even if .env is perfectly configured.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .auth import AuthError, Claims, SupabaseJwtVerifier
from .models import SettlementPlanResponse, SettlementSuggestion
from .repository import BalanceRepository, PostgresBalanceRepository, TripAccessError
from .settlement import build_settlement_plan


def create_app(
    repository: BalanceRepository | None = None,
    verifier: SupabaseJwtVerifier | None = None,
) -> FastAPI:
    balance_repository = repository or PostgresBalanceRepository()
    jwt_verifier = verifier or SupabaseJwtVerifier(
        jwks_url=os.getenv("SUPABASE_JWKS_URL"),
        issuer=os.getenv("SUPABASE_JWT_ISSUER"),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        # Close the asyncpg connection pool gracefully on shutdown so that
        # in-flight connections are not abandoned. PostgresBalanceRepository.close()
        # is a no-op when the pool was never opened (e.g. in tests that inject a
        # fake repository), so this is always safe to call.
        if hasattr(balance_repository, "close"):
            await balance_repository.close()  # type: ignore[union-attr]

    app = FastAPI(
        title="Expensio API",
        description="Settlement calculation and heavy read logic API for Expensio.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    bearer = HTTPBearer(auto_error=False)

    def authenticate(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> Claims:
        if (
            credentials is None
            or credentials.scheme.lower() != "bearer"
            or not credentials.credentials
            or not credentials.credentials.strip()
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Bearer authentication is required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            return jwt_verifier.verify(credentials.credentials.strip())
        except AuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    @app.get("/", summary="API Root", tags=["System"])
    async def root() -> dict[str, str]:
        return {
            "name": "Expensio API",
            "version": "0.1.0",
            "status": "ok",
            "docs_url": "/docs",
            "health_url": "/health",
        }

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon() -> Response:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/health", summary="Health Check", tags=["System"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(
        "/trip/{trip_id}/settlement-plan",
        response_model=SettlementPlanResponse,
        summary="Get Trip Settlement Plan",
        tags=["Settlement"],
    )
    async def settlement_plan(
        trip_id: str,
        claims: Claims = Depends(authenticate),
    ) -> SettlementPlanResponse:
        # Validate trip_id upfront before querying database
        try:
            uuid.UUID(trip_id.strip() if trip_id else "")
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="trip_id must be a valid UUID",
            ) from exc

        try:
            balances = await balance_repository.get_balances(trip_id.strip(), claims.user_id)
        except TripAccessError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="trip_id must be a valid UUID",
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"balance service unavailable: {exc}",
            ) from exc

        suggestions = [
            SettlementSuggestion(
                from_participant=suggestion.from_participant,
                to_participant=suggestion.to_participant,
                amount=suggestion.amount,
                currency=suggestion.currency,
            )
            for suggestion in build_settlement_plan(balances)
        ]
        return SettlementPlanResponse(trip_id=trip_id.strip(), suggestions=suggestions)

    return app


app = create_app()

