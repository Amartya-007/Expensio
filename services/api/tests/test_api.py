import unittest
from decimal import Decimal

from fastapi.testclient import TestClient

from app.auth import SupabaseJwtVerifier
from app.main import create_app
from app.settlement import Balance


class FakeBalanceRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        self.calls.append((trip_id, user_id))
        return [
            Balance("alice", "Alice", "INR", Decimal("100.00")),
            Balance("bob", "Bob", "INR", Decimal("-100.00")),
        ]


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = FakeBalanceRepository()
        self.verifier = SupabaseJwtVerifier(
            decode_token=lambda token: {
                "sub": "10000000-0000-0000-0000-000000000001",
                "role": "authenticated",
                "aud": "authenticated",
            }
        )
        self.client = TestClient(create_app(self.repository, self.verifier))

    def test_health_endpoint(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_settlement_endpoint_requires_bearer_token(self) -> None:
        response = self.client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan"
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.repository.calls, [])

    def test_settlement_endpoint_reads_only_authorized_trip_balances(self) -> None:
        response = self.client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={"Authorization": "Bearer test-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "trip_id": "20000000-0000-0000-0000-000000000001",
                "suggestions": [
                    {
                        "from_participant": "bob",
                        "to_participant": "alice",
                    "amount": "100.00",
                        "currency": "INR",
                    }
                ],
            },
        )
        self.assertEqual(
            self.repository.calls,
            [("20000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000001")],
        )


if __name__ == "__main__":
    unittest.main()
