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
$env:DATABASE_URL = "<connection string for the expensio_api role — see below>"
$env:SUPABASE_JWKS_URL = "https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json"
uvicorn app.main:app --reload --port 8000
```

The service role key is not required and must not be used as a client-provided credential.

### DATABASE_URL: the `expensio_api` role

`supabase/migrations/0008_api_readonly_role.sql` creates the role this service should
actually connect as. It doesn't set a password (that migration is committed to git) — set
one directly in the Supabase SQL Editor once:

```sql
alter role expensio_api with password '<generate one, do not reuse elsewhere>';
```

then build `DATABASE_URL` from that (`postgresql://expensio_api:<password>@<host>:5432/postgres`).

This role is not "least-privileged" in the RLS-respecting sense that phrase usually
implies, and it's worth being precise about why: `repository.py` does its own manual
membership check (`select ... from trip_members where trip_id = $1 and user_id = $2`)
rather than relying on RLS + `auth.uid()`, because this is a raw `asyncpg` connection with
no JWT/request context for `auth.uid()` to read — it isn't going through PostgREST. That
means the connecting role has to see rows across every user's data to do its job at all,
which requires `BYPASSRLS`. Confirmed directly: the same query, same data, fails with
`TripAccessError` for a genuinely active member when connected as a plain SELECT-granted
non-bypass role, and succeeds once `BYPASSRLS` is granted.

What "least-privileged" *does* mean here: this role can read exactly three things
(`trip_members`, `participants`, `trip_balances`) and nothing else, and can't write
anything at all — no table grants beyond those three `SELECT`s, so every RPC call it
might attempt either gets denied by `is_active_member()`'s `auth.uid()` check (which is
`NULL` for this connection) or fails outright on a `NOT NULL` constraint the same way. See
`0008_api_readonly_role.sql`'s own comments for the honest caveat on that: it's an
incidental protection from a pattern used for a different reason, not an intentional grant
boundary, and closing it properly is flagged there as follow-up work, not done yet.
