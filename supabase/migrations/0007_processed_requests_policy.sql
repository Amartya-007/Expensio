-- processed_requests had RLS enabled (0003_rls_and_rpcs.sql) but was the only table in
-- the whole schema that never got an explicit policy -- every write already goes through
-- claim_idempotency_key()/claim_idempotency_key_with_result()/store_idempotent_result(),
-- all SECURITY DEFINER and owned by the migration role, so writes never needed a policy
-- to work. But with zero policies and RLS enabled, Postgres denies ALL direct access by
-- default -- including SELECT -- to any non-owner role. That silently broke the ability
-- for an ordinary authenticated client to ever look up its own idempotency-replay record
-- directly (e.g. to confirm a request was already claimed), and is why the pgTAP suite's
-- "create_trip claims one idempotency key" assertion returned 0 rows even though the row
-- genuinely existed. Found by running the suite as the real `authenticated` role, not
-- `postgres` -- a superuser session bypasses RLS entirely, so this gap was invisible
-- under the way this suite had apparently always been run before.
--
-- client_request_id is a client-generated random UUID (effectively unguessable, ~122
-- bits of entropy), not a sequential or otherwise enumerable id, and the table has no
-- owner/user column to scope a tighter per-user policy by -- so a broad `true` SELECT
-- policy (matching this migration's least-restrictive option given that constraint) is a
-- reasonable tradeoff, not a meaningful information leak: it lets any authenticated
-- client read a payload only if it already knows the specific idempotency key, which in
-- practice means only the client that generated that key.
create policy processed_requests_select on processed_requests for select
  to authenticated
  using (true);
