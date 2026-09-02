import unittest
from decimal import Decimal

from fastapi.testclient import TestClient

from app.auth import SupabaseJwtVerifier
from app.main import create_app
from app.repository import TripAccessError
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


class ForbiddenBalanceRepository:
    """Always raises TripAccessError — simulates a non-member requesting a trip."""

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        raise TripAccessError("not an active member of this trip")


class BadUuidBalanceRepository:
    """Always raises ValueError — simulates asyncpg rejecting a non-UUID trip_id."""

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        # asyncpg.exceptions.InvalidTextRepresentationError is a ValueError subclass.
        # Using the base class here keeps the test free of the asyncpg dependency.
        raise ValueError(f'invalid input syntax for type uuid: "{trip_id}"')


class FailingBalanceRepository:
    """Always raises RuntimeError — simulates database outage or missing config."""

    async def get_balances(self, trip_id: str, user_id: str) -> list[Balance]:
        raise RuntimeError("database connection failed")


def _make_verifier(role: str = "authenticated") -> SupabaseJwtVerifier:
    return SupabaseJwtVerifier(
        decode_token=lambda token: {
            "sub": "10000000-0000-0000-0000-000000000001",
            "role": role,
            "aud": "authenticated",
        }
    )


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = FakeBalanceRepository()
        self.verifier = _make_verifier()
        self.client = TestClient(create_app(self.repository, self.verifier))

    def test_root_endpoint(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "Expensio API")
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["docs_url"], "/docs")
        self.assertEqual(data["health_url"], "/health")

    def test_favicon_endpoint(self) -> None:
        response = self.client.get("/favicon.ico")
        self.assertEqual(response.status_code, 204)

    def test_cors_headers_present(self) -> None:
        response = self.client.get("/", headers={"Origin": "http://localhost:3000"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")

    def test_cors_preflight(self) -> None:
        response = self.client.options(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")

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

    def test_settlement_endpoint_rejects_empty_bearer_token(self) -> None:
        response = self.client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={"Authorization": "Bearer  "},
        )
        self.assertEqual(response.status_code, 401)

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

    def test_settlement_endpoint_returns_403_for_non_member(self) -> None:
        """TripAccessError from the repository must surface as 403 Forbidden."""
        client = TestClient(create_app(ForbiddenBalanceRepository(), _make_verifier()))
        response = client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={"Authorization": "Bearer test-token"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("active member", response.json()["detail"])

    def test_settlement_endpoint_returns_400_for_invalid_uuid(self) -> None:
        """A non-UUID trip_id must surface as 400 Bad Request."""
        client = TestClient(create_app(BadUuidBalanceRepository(), _make_verifier()))
        response = client.get(
            "/trip/not-a-uuid/settlement-plan",
            headers={"Authorization": "Bearer test-token"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("UUID", response.json()["detail"])

    def test_settlement_endpoint_returns_503_when_repository_fails(self) -> None:
        """A RuntimeError from repository must surface as 503 Service Unavailable."""
        client = TestClient(create_app(FailingBalanceRepository(), _make_verifier()))
        response = client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={"Authorization": "Bearer test-token"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("unavailable", response.json()["detail"])

    def test_settlement_endpoint_accepts_anonymous_token(self) -> None:
        """Supabase anonymous sessions carry role='anon' and must not be rejected as 401."""
        client = TestClient(create_app(self.repository, _make_verifier(role="anon")))
        response = client.get(
            "/trip/20000000-0000-0000-0000-000000000001/settlement-plan",
            headers={"Authorization": "Bearer anon-token"},
        )
        # The anon token is valid — the repository decides access, not the JWT role.
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()

