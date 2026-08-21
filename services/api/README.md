# Expensio API

This service owns read-only heavy logic that does not belong in a Postgres RPC. The first
endpoint is:

```text
GET /trip/{trip_id}/settlement-plan
Authorization: Bearer <Supabase access token>
```

It validates the Supabase JWT against the environment's JWKS endpoint, checks active trip
membership through the database repository, reads `trip_balances`, and returns deterministic
per-currency settlement suggestions. It never writes expenses, payments, membership, or
ledger entries.

## Local run

```powershell
cd services/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
$env:DATABASE_URL = "<least-privileged connection string>"
$env:SUPABASE_JWKS_URL = "https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json"
uvicorn app.main:app --reload --port 8000
```

The service role key is not required and must not be used as a client-provided credential.
