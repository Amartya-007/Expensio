from __future__ import annotations

import os
from typing import Protocol

from .settlement import Balance


class TripAccessError(PermissionError):
    """The authenticated user is not an active member of the requested trip."""


class BalanceRepository(Protocol):
    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]: ...


class PostgresBalanceRepository:
    def __init__(self, dsn: str | None = None) -> None:
        self._dsn = dsn or os.getenv("DATABASE_URL")
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            if not self._dsn:
                raise RuntimeError("DATABASE_URL is not configured")
            import asyncpg

            self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
        return self._pool

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        pool = await self._get_pool()
        async with pool.acquire() as connection:
            has_access = await connection.fetchval(
                """
                select exists (
                  select 1 from trip_members
                  where trip_id = $1::uuid and user_id = $2::uuid and status = 'active'
                )
                """,
                trip_id,
                user_id,
            )
            if not has_access:
                raise TripAccessError("not an active member of this trip")

            rows = await connection.fetch(
                """
                select tb.participant_id::text,
                       coalesce(p.display_name, 'Participant') as display_name,
                       tb.currency,
                       tb.balance_delta
                from trip_balances tb
                join participants p on p.id = tb.participant_id
                where tb.trip_id = $1::uuid and p.trip_id = $1::uuid
                order by tb.currency, tb.participant_id
                """,
                trip_id,
            )

        return [
            Balance(
                participant_id=row["participant_id"],
                display_name=row["display_name"],
                currency=row["currency"],
                balance=row["balance_delta"],
            )
            for row in rows
        ]

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
