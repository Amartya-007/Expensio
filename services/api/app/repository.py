from __future__ import annotations

import asyncio
import os
from typing import Protocol

from .settlement import Balance


class TripAccessError(PermissionError):
    """The authenticated user is not an active member of the requested trip."""


class BalanceRepository(Protocol):
    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]: ...


class PostgresBalanceRepository:
    def __init__(self, dsn: str | None = None) -> None:
        raw_dsn = dsn or os.getenv("DATABASE_URL")
        self._dsn = raw_dsn.strip() if raw_dsn and isinstance(raw_dsn, str) else None
        self._pool = None
        # Guards pool creation. Without this, two requests arriving before the pool
        # exists could both pass the `self._pool is None` check, both start
        # `asyncpg.create_pool(...)` (a real await point — control yields to the event
        # loop there), and whichever finishes second would silently overwrite
        # self._pool, leaking the first pool's connections since nothing ever calls
        # .close() on it. Found by reading _get_pool as a concurrent-access pattern, not
        # by it failing — the window is narrow (only during startup, before the first
        # pool finishes creating) but real.
        self._pool_lock = asyncio.Lock()

    async def _get_pool(self):
        if self._pool is None:
            async with self._pool_lock:
                # Re-check inside the lock: another request may have already created
                # the pool while this one was waiting to acquire it.
                if self._pool is None:
                    if not self._dsn:
                        raise RuntimeError("DATABASE_URL is not configured")
                    import asyncpg

                    try:
                        self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
                    except Exception as exc:
                        raise RuntimeError(f"failed to connect to database: {exc}") from exc
        return self._pool

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        pool = await self._get_pool()
        try:
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
        except (TripAccessError, ValueError):
            raise
        except Exception as exc:
            raise RuntimeError(f"database query failed: {exc}") from exc

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
