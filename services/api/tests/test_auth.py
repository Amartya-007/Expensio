import unittest

from app.auth import AuthError, SupabaseJwtVerifier


class AuthTests(unittest.TestCase):
    def test_verifier_returns_user_id_from_valid_claims(self) -> None:
        verifier = SupabaseJwtVerifier(
            decode_token=lambda token: {
                "sub": "10000000-0000-0000-0000-000000000001",
                "role": "authenticated",
                "aud": "authenticated",
            }
        )

        self.assertEqual(
            verifier.verify("token").user_id,
            "10000000-0000-0000-0000-000000000001",
        )

    def test_verifier_rejects_missing_subject(self) -> None:
        verifier = SupabaseJwtVerifier(decode_token=lambda token: {"role": "authenticated"})

        with self.assertRaisesRegex(AuthError, "subject"):
            verifier.verify("token")

    def test_verifier_rejects_non_authenticated_role(self) -> None:
        verifier = SupabaseJwtVerifier(
            decode_token=lambda token: {
                "sub": "10000000-0000-0000-0000-000000000001",
                "role": "service_role",
            }
        )

        with self.assertRaisesRegex(AuthError, "role"):
            verifier.verify("token")

    def test_verifier_accepts_anon_role(self) -> None:
        """Supabase anonymous sessions carry role='anon'; they are valid callers."""
        verifier = SupabaseJwtVerifier(
            decode_token=lambda token: {
                "sub": "10000000-0000-0000-0000-000000000002",
                "role": "anon",
                "aud": "authenticated",
            }
        )

        claims = verifier.verify("token")
        self.assertEqual(claims.role, "anon")
        self.assertEqual(claims.user_id, "10000000-0000-0000-0000-000000000002")


if __name__ == "__main__":
    unittest.main()
