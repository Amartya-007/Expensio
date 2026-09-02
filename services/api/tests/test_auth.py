import time
import unittest
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

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


def _make_keypair_and_jwks(kid: str = "test-key-1"):
    """A real EC (P-256/ES256) keypair plus the JWKS document Supabase would publish for
    it, so the tests below can exercise SupabaseJwtVerifier's actual PyJWKClient/jwt.decode
    codepath (_decode_with_supabase_jwks) rather than always injecting a fake decode_token.
    Every test above this point does inject one, which means that codepath — the real
    cryptographic verification this service depends on in production — had no test
    coverage at all until this class. Found by reviewing the suite, not by it failing.
    """

    import json

    private_key = ec.generate_private_key(ec.SECP256R1())
    algo = ECAlgorithm(ECAlgorithm.SHA256)
    jwk = json.loads(algo.to_jwk(private_key.public_key()))
    jwk["kid"] = kid
    jwk["use"] = "sig"
    jwk["alg"] = "ES256"
    return private_key, {"keys": [jwk]}


class RealJwksVerificationTests(unittest.TestCase):
    """Exercises SupabaseJwtVerifier against a real signed token and a mocked JWKS fetch —
    no decode_token injection. This is the only place the actual PyJWKClient/jwt.decode
    wiring in auth.py gets run at all."""

    def setUp(self) -> None:
        self.private_key, self.jwks = _make_keypair_and_jwks()
        self.verifier = SupabaseJwtVerifier(
            jwks_url="https://fake-project.supabase.co/auth/v1/.well-known/jwks.json",
            issuer="https://fake-project.supabase.co/auth/v1",
            audience="authenticated",
        )
        # PyJWKClient.fetch_data is the one method that performs the actual HTTP GET —
        # patching only this (not the whole client) means everything downstream (kid
        # matching, caching, key construction) still runs for real.
        patcher = patch("jwt.PyJWKClient.fetch_data", return_value=self.jwks)
        self.addCleanup(patcher.stop)
        patcher.start()

    def _sign(self, **overrides: object) -> str:
        now = int(time.time())
        payload = {
            "sub": "10000000-0000-0000-0000-000000000001",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://fake-project.supabase.co/auth/v1",
            "iat": now,
            "exp": now + 3600,
        }
        payload.update(overrides)
        return jwt.encode(payload, self.private_key, algorithm="ES256", headers={"kid": "test-key-1"})

    def test_valid_token_verifies(self) -> None:
        claims = self.verifier.verify(self._sign())
        self.assertEqual(claims.user_id, "10000000-0000-0000-0000-000000000001")
        self.assertEqual(claims.role, "authenticated")

    def test_expired_token_rejected(self) -> None:
        now = int(time.time())
        token = self._sign(iat=now - 7200, exp=now - 3600)
        with self.assertRaises(AuthError):
            self.verifier.verify(token)

    def test_wrong_audience_rejected(self) -> None:
        with self.assertRaises(AuthError):
            self.verifier.verify(self._sign(aud="something-else"))

    def test_wrong_issuer_rejected(self) -> None:
        with self.assertRaises(AuthError):
            self.verifier.verify(self._sign(iss="https://attacker.example/auth/v1"))

    def test_token_signed_by_unknown_key_rejected(self) -> None:
        other_key, _ = _make_keypair_and_jwks(kid="test-key-1")
        now = int(time.time())
        payload = {
            "sub": "10000000-0000-0000-0000-000000000001",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://fake-project.supabase.co/auth/v1",
            "iat": now,
            "exp": now + 3600,
        }
        # Same kid as the JWKS entry, but signed with a different keypair — a forged
        # token can't just claim to be from a known kid, the signature has to actually
        # verify against that kid's real public key.
        token = jwt.encode(payload, other_key, algorithm="ES256", headers={"kid": "test-key-1"})
        with self.assertRaises(AuthError):
            self.verifier.verify(token)

    def test_algorithm_confusion_hs256_rejected(self) -> None:
        """A well-known JWT attack: sign an HS256 token using the EC public key's PEM
        bytes as the HMAC secret. Since the public key is, well, public, anyone can do
        this — the only thing standing between this and a forged "valid" token is the
        verifier restricting which algorithms it will ever accept (algorithms=["RS256",
        "ES256"] in auth.py). PyJWT's own jwt.encode() refuses to build this token at all
        (it detects a PEM-shaped HMAC secret and raises), so the forged token is
        assembled by hand instead, the way a real attacker's script would, to make sure
        the protection is really enforced on the decode/verify side."""

        import base64
        import hashlib
        import hmac
        import json as json_module

        from cryptography.hazmat.primitives import serialization

        now = int(time.time())
        header = {"alg": "HS256", "typ": "JWT", "kid": "test-key-1"}
        payload = {
            "sub": "attacker",
            "role": "authenticated",
            "aud": "authenticated",
            "iat": now,
            "exp": now + 3600,
        }
        public_pem = self.private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

        def _b64(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

        signing_input = f"{_b64(json_module.dumps(header).encode())}.{_b64(json_module.dumps(payload).encode())}"
        signature = hmac.new(public_pem, signing_input.encode(), hashlib.sha256).digest()
        forged = f"{signing_input}.{_b64(signature)}"

        with self.assertRaises(AuthError):
            self.verifier.verify(forged)


if __name__ == "__main__":
    unittest.main()
