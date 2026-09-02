import asyncio
import unittest
from unittest.mock import patch

from app.repository import PostgresBalanceRepository


class PoolCreationRaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_get_pool_calls_create_only_one_pool(self) -> None:
        """_get_pool()'s lazy-init used to be a plain `if self._pool is None: ... await
        asyncpg.create_pool(...)` with no guard. Two requests arriving before the pool
        exists could both pass that check, both start create_pool (a real await point —
        control yields to the event loop there), and whichever finished second would
        silently overwrite self._pool, leaking the first pool's connections since
        nothing ever closes it. Reproduced without the fix: all 10 concurrent calls
        below each created their own pool. With the asyncio.Lock guard, only one does."""

        create_calls = 0
        fake_pool = object()

        async def fake_create_pool(*args, **kwargs):
            nonlocal create_calls
            create_calls += 1
            # Yield control here on purpose -- this is the exact window the unguarded
            # version got wrong.
            await asyncio.sleep(0.01)
            return fake_pool

        repo = PostgresBalanceRepository(dsn="postgres://fake/dsn")
        with patch("asyncpg.create_pool", side_effect=fake_create_pool):
            results = await asyncio.gather(*[repo._get_pool() for _ in range(10)])

        self.assertEqual(create_calls, 1)
        self.assertTrue(all(result is fake_pool for result in results))


if __name__ == "__main__":
    unittest.main()
