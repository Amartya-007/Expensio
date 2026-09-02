-- Nothing in this repo ever actually created the role services/api/README.md tells you
-- to put in DATABASE_URL ("least-privileged connection string") -- there was no role to
-- point at, so anyone standing this service up would have had to invent one themselves,
-- most likely defaulting to service_role out of expedience (exactly what the README says
-- not to do), or hitting a confusing TripAccessError in production that looks like an app
-- bug but isn't.
--
-- Confirmed by actually connecting services/api/app/repository.py's real code (not the
-- FakeBalanceRepository every existing test uses) to a real Postgres instance as a plain
-- SELECT-granted, non-superuser, non-bypass role: PostgresBalanceRepository.get_balances()
-- failed with TripAccessError for a genuinely active trip member, every time. Root cause:
-- repository.py does its own manual authorization check (a plain SELECT against
-- trip_members for the caller-supplied user_id) rather than relying on RLS + auth.uid(),
-- because this is a raw asyncpg connection with no JWT/request context for auth.uid() to
-- read -- it isn't going through PostgREST. That means the connecting role has to be able
-- to see rows across every user's data to do its job at all, which requires BYPASSRLS.
-- Granting it turned the same query, same data, same role, into a success.
--
-- "Least-privileged" here specifically means: this role can bypass RLS to READ trip_members,
-- participants, and the trip_balances view (only those three, only SELECT) -- it is not
-- service_role, cannot write anything at all (no INSERT/UPDATE/DELETE grant on anything,
-- and no function EXECUTE grant, so it cannot call any RPC either), and cannot read any
-- other table. That's a meaningfully smaller blast radius than service_role even though it
-- does share service_role's RLS-bypass property -- worth being precise about in the
-- README rather than calling it "least-privileged" without qualification.
do $$ begin
  create role expensio_api with login bypassrls nosuperuser nocreatedb nocreaterole noinherit;
exception when duplicate_object then null; end $$;

-- No password set here on purpose -- this migration is committed to git. Set the real
-- password out of band (Supabase SQL Editor, not a file that gets pushed to GitHub):
--   alter role expensio_api with password '<generate one, do not reuse elsewhere>';
-- then build DATABASE_URL for services/api/.env from that.

grant connect on database postgres to expensio_api;
grant usage on schema public to expensio_api;
grant select on trip_members, participants, trip_balances to expensio_api;

-- Residual risk worth being explicit about, not silently relying on: every RPC in this
-- schema (create_trip, delete_trip, record_payment, ...) has EXECUTE granted to the
-- PUBLIC pseudo-role by default (Postgres's own default, never revoked here since
-- authenticated/anon need it) -- and PUBLIC's grant applies to every role, this one
-- included, regardless of what it isn't otherwise given. A per-role `revoke execute ...
-- from expensio_api` on any of them is not a fix: confirmed empirically that it's a
-- silent no-op when the actual privilege comes from PUBLIC, not a role-specific grant.
--
-- In practice this is mostly, but not intentionally, closed: is_active_member()
-- (checked first by nearly every mutating RPC) keys off auth.uid(), which is NULL for
-- this role's non-JWT connection, so NULL = user_id never matches and access is denied
-- -- confirmed against create_trip specifically, which took a different path to the same
-- outcome (no is_active_member call since a new trip has no existing members, but
-- auth.uid() being NULL still surfaced as a NOT NULL violation on created_by before any
-- row could commit). That's a side effect of a pattern used elsewhere for a different
-- reason, not a real grant boundary -- a future RPC that mutates data without an early
-- is_active_member-style check, or handles a null auth.uid() more gracefully than
-- create_trip happens to, would be silently exploitable by this role with no warning.
-- Properly closing this means revoking EXECUTE from PUBLIC across every RPC and
-- explicitly re-granting it to authenticated/anon (mirroring the pattern already used
-- for compute_expense_splits/insert_expense_ledger_entries/reverse_expense_ledger_entries
-- at the end of 0005_backend_correctness.sql) -- deliberately not attempted in this
-- migration: getting that list complete needs its own careful pass and full regression
-- against every real mobile RPC call, not a change to bundle in alongside adding a role.
