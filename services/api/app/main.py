from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .auth import AuthError, Claims, SupabaseJwtVerifier
from .models import SettlementPlanResponse, SettlementSuggestion
from .repository import BalanceRepository, PostgresBalanceRepository, TripAccessError
from .settlement import build_settlement_plan


def create_app(
    repository: BalanceRepository | None = None,
    verifier: SupabaseJwtVerifier | None = None,
) -> FastAPI:
    app = FastAPI(title="Expensio API", version="0.1.0")
    balance_repository = repository or PostgresBalanceRepository()
    jwt_verifier = verifier or SupabaseJwtVerifier(
        jwks_url=os.getenv("SUPABASE_JWKS_URL"),
        issuer=os.getenv("SUPABASE_JWT_ISSUER"),
    )
    bearer = HTTPBearer(auto_error=False)

    def authenticate(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> Claims:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Bearer authentication is required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            return jwt_verifier.verify(credentials.credentials)
        except AuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(
        "/trip/{trip_id}/settlement-plan",
        response_model=SettlementPlanResponse,
    )
    async def settlement_plan(
        trip_id: str,
        claims: Claims = Depends(authenticate),
    ) -> SettlementPlanResponse:
        try:
            balances = await balance_repository.get_balances(trip_id, claims.user_id)
        except TripAccessError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="balance service is not configured",
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
        return SettlementPlanResponse(trip_id=trip_id, suggestions=suggestions)

    return app


app = create_app()
