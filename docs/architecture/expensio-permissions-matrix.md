# Expensio — Roles, Permissions & Access Control

Companion to `expensio-architecture.md` and `expensio-data-model.md`. This is the document
TripSpend never had — every action, spelled out for every role, before any code is written
against it.

## 1. Roles

- **owner** — the trip creator, or anyone promoted (not in v1 — one owner per trip for now).
- **member** — anyone who joined via invite and hasn't left or been removed.

Deliberately not building a `viewer` / read-only role for v1 — nothing in your brief asked
for it, and adding it later is a one-line `check` constraint change on `trip_members.role`
plus new RLS branches, not a redesign. Flagging it here so it's a known extension point, not
a surprise later.

## 2. Permission matrix

**A direct conflict with the Splitwise research, worth deciding on purpose:** Splitwise
uses a fully open "community edit" model — no admin role, any group member can edit or
delete *any* expense, full stop. Expensio's design so far restricts editing to the expense's
creator or the trip owner. Given TripSpend's history was largely bugs in exactly this area
(unrestricted writes causing data loss and confused state), I'd keep the stricter default —
but I've made it a **per-trip setting** rather than a hardcoded choice, so a trip that wants
Splitwise's fully-open model can have it:

```
trips.settings->>'expense_edit_policy'  -- 'creator_or_owner' (default) | 'any_member'
```

Both `edit_expense` and `delete_expense` read this setting (see §4). This means the decision
doesn't have to be right on day one — it's a toggle, not an architecture change, in either
direction.

| Action | Owner | Member (active) | Removed / left member | Non-member |
|---|:---:|:---:|:---:|:---:|
| Create a trip | ✅ (becomes owner) | ✅ | ✅ | ✅ (any authenticated user, incl. anonymous) |
| View trip & expenses | ✅ | ✅ | ❌ | ❌ |
| Add expense | ✅ | ✅ | ❌ | ❌ |
| Edit/delete **own** expense | ✅ | ✅ | ❌ | ❌ |
| Edit/delete **another member's** expense | ✅ | Only if `expense_edit_policy = 'any_member'` | ❌ | ❌ |
| Add a comment on an expense | ✅ | ✅ | ❌ | ❌ |
| Generate / view invite code | ✅ | ❌ | ❌ | ❌ |
| Revoke invite | ✅ | ❌ | ❌ | ❌ |
| Join via invite code | — | — | ✅ (rejoin) | ✅ |
| Remove another member | ✅ | ❌ | ❌ | ❌ |
| Leave trip (self) | ❌ (must transfer/archive first — see below) | ✅ | — | — |
| Record a payment | ✅ | ✅ | ❌ | ❌ |
| Confirm a payment received | ✅ | ✅ | ❌ | ❌ |
| Create / manage a recurring expense template | ✅ | ✅ (own templates); owner can manage any | ❌ | ❌ |
| Change own notification preferences | ✅ | ✅ | ✅ | — |
| Request own account deletion | ✅ (must transfer/archive owned trips first) | ✅ | ✅ | ✅ |
| Archive / delete trip | ✅ | ❌ | ❌ | ❌ |

**Owner-can't-leave is intentional**, not an oversight: every trip needs exactly one owner
at all times so "who can revoke invites / remove members" is never ambiguous. If you want
owner transfer or multi-owner later, that's a `role` value addition plus a
`transfer_ownership` RPC — not in v1 because your brief didn't ask for it, but noting it so
it's a conscious decision, not a gap discovered via a bug report.

## 3. RLS policy design

The principle: **RLS is defense in depth, not where business logic lives.** Every policy
below is a simple membership check. The actual rules (member caps, invite expiry, who can
remove whom) live in the RPC functions in §4, where they're one function each, testable in
isolation, instead of one long boolean expression per table.

```sql
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table trip_invites enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table ledger_entries enable row level security;

-- Helper: is the calling user an ACTIVE member of this trip?
create function is_active_member(p_trip_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create function is_owner(p_trip_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
      and status = 'active'
      and role = 'owner'
  );
$$;

-- trips: visible/editable only to active members. Creation is open to any authenticated
-- user (incl. anonymous), but created_by must be the caller — never trust a client-supplied value.
create policy trips_select on trips for select
  using (is_active_member(id));

create policy trips_insert on trips for insert
  with check (created_by = auth.uid());

create policy trips_update on trips for update
  using (is_owner(id));

-- trip_members: members can see their trip's roster. Direct writes are NOT allowed —
-- every membership change goes through an RPC (§4). This is the fix for TripSpend's
-- "removing a member didn't revoke access" bug: there is no other path to this table.
create policy trip_members_select on trip_members for select
  using (is_active_member(trip_id));

-- (no insert/update/delete policy defined for regular clients — RPC functions run as
--  SECURITY DEFINER and bypass RLS deliberately, which is the only sanctioned write path)

-- expenses / expense_splits / ledger_entries: read access follows membership.
-- All writes go through RPC functions for the same reason as trip_members.
create policy expenses_select on expenses for select
  using (is_active_member(trip_id));

create policy expense_splits_select on expense_splits for select
  using (is_active_member((select trip_id from expenses where id = expense_id)));

create policy ledger_entries_select on ledger_entries for select
  using (is_active_member(trip_id));

-- trip_invites: only the owner can see invite codes for their trip.
create policy trip_invites_select on trip_invites for select
  using (is_owner(trip_id));
```

## 4. RPC functions — the one place each rule lives

Every function below is `SECURITY DEFINER`, validates the caller against `auth.uid()`
internally, and is the *only* sanctioned way to make the corresponding change. Client code
calls these via `supabase.rpc(...)` — it never writes to `trip_members`, `expense_splits`,
or `ledger_entries` directly.

```sql
-- Creates a trip and makes the caller its owner, atomically.
create function create_trip(p_name text, p_currency text, p_settings jsonb default '{}')
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  insert into trips (name, currency, settings, created_by)
  values (p_name, p_currency, p_settings, auth.uid())
  returning id into v_trip_id;

  insert into trip_members (trip_id, user_id, role, status)
  values (v_trip_id, auth.uid(), 'owner', 'active');

  return v_trip_id;
end; $$;

-- Owner only. Revokes any existing active invite before creating a new one —
-- one active invite per trip, matching your original 6-digit-code design intent.
create function generate_invite(p_trip_id uuid, p_expires_in interval default '7 days', p_max_uses int default null)
returns text language plpgsql security definer as $$
declare v_code text;
begin
  if not is_owner(p_trip_id) then
    raise exception 'only the trip owner can generate an invite';
  end if;

  update trip_invites set revoked_at = now()
  where trip_id = p_trip_id and revoked_at is null and (expires_at is null or expires_at > now());

  v_code := upper(substr(md5(random()::text), 1, 6));  -- 6-char code, matches your original design
  insert into trip_invites (trip_id, code, created_by, max_uses, expires_at)
  values (p_trip_id, v_code, auth.uid(), p_max_uses, now() + p_expires_in);

  return v_code;
end; $$;

create function revoke_invite(p_invite_id uuid)
returns void language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from trip_invites where id = p_invite_id;
  if not is_owner(v_trip_id) then
    raise exception 'only the trip owner can revoke an invite';
  end if;
  update trip_invites set revoked_at = now() where id = p_invite_id;
end; $$;

-- Validates code, expiry, revocation, AND member cap in one place —
-- this is the fix for "join had no member cap while create did."
create function join_trip_via_code(p_code text)
returns uuid language plpgsql security definer as $$
declare v_invite trip_invites;
declare v_member_count int;
begin
  select * into v_invite from trip_invites where code = p_code for update;

  if v_invite is null or v_invite.revoked_at is not null or v_invite.expires_at < now() then
    raise exception 'invite code is invalid or expired';
  end if;
  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'invite code has reached its use limit';
  end if;

  select count(*) into v_member_count from trip_members
    where trip_id = v_invite.trip_id and status = 'active';
  if v_member_count >= 50 then
    raise exception 'trip has reached the maximum number of members';
  end if;

  insert into trip_members (trip_id, user_id, role, status)
  values (v_invite.trip_id, auth.uid(), 'member', 'active')
  on conflict (trip_id, user_id) do update set status = 'active', removed_at = null;

  update trip_invites set use_count = use_count + 1 where id = v_invite.id;

  return v_invite.trip_id;
end; $$;

-- Owner only. Sets status, not a delete — this IS the fix for "remove didn't revoke access,"
-- because every other RLS policy checks status = 'active'.
create function remove_member(p_trip_id uuid, p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_owner(p_trip_id) then
    raise exception 'only the trip owner can remove a member';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'owner cannot remove themselves — archive or transfer the trip instead';
  end if;
  update trip_members set status = 'removed', removed_at = now()
  where trip_id = p_trip_id and user_id = p_user_id;
end; $$;

create function leave_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if is_owner(p_trip_id) then
    raise exception 'the owner cannot leave — archive or transfer the trip instead';
  end if;
  update trip_members set status = 'left', removed_at = now()
  where trip_id = p_trip_id and user_id = auth.uid();
end; $$;

-- Computes expense_splits from split_type + split_config server-side —
-- the client never computes or trusts its own math.
create function add_expense(
  p_trip_id uuid, p_description text, p_amount numeric, p_currency text,
  p_split_type text, p_split_config jsonb, p_category text default null
) returns uuid language plpgsql security definer as $$
declare v_expense_id uuid;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;

  insert into expenses (trip_id, description, amount, currency, paid_by, category, split_type, split_config, created_by)
  values (p_trip_id, p_description, p_amount, p_currency, auth.uid(), p_category, p_split_type, p_split_config, auth.uid())
  returning id into v_expense_id;

  -- split computation lives here (per split_type) — omitted for brevity, see data-model doc
  perform compute_expense_splits(v_expense_id);

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (p_trip_id, 'expense_added', v_expense_id, p_amount, p_currency, auth.uid());

  return v_expense_id;
end; $$;

-- Shared by edit_expense and delete_expense: can the caller touch THIS expense?
-- Reads the per-trip setting from §2 rather than hardcoding one policy.
create function can_modify_expense(p_expense_id uuid)
returns boolean language plpgsql stable security definer as $$
declare v_trip_id uuid; v_created_by uuid; v_policy text;
begin
  select trip_id, created_by into v_trip_id, v_created_by from expenses where id = p_expense_id;
  select coalesce(settings->>'expense_edit_policy', 'creator_or_owner') into v_policy
    from trips where id = v_trip_id;

  return is_owner(v_trip_id)
      or v_created_by = auth.uid()
      or (v_policy = 'any_member' and is_active_member(v_trip_id));
end; $$;

create function edit_expense(
  p_expense_id uuid, p_description text, p_amount numeric,
  p_split_type text, p_split_config jsonb
) returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_currency text;
begin
  if not can_modify_expense(p_expense_id) then
    raise exception 'not permitted to edit this expense';
  end if;

  select trip_id, currency into v_trip_id, v_currency from expenses where id = p_expense_id;

  update expenses set description = p_description, amount = p_amount,
    split_type = p_split_type, split_config = p_split_config, updated_at = now()
  where id = p_expense_id;

  perform compute_expense_splits(p_expense_id);

  insert into expense_comments (expense_id, user_id, comment_type, body)
  values (p_expense_id, auth.uid(), 'system',
          format('changed the amount to %s %s', v_currency, p_amount));

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (v_trip_id, 'expense_edited', p_expense_id, p_amount, v_currency, auth.uid());
end; $$;

-- Owner can always modify; a regular member's access depends on trips.settings.expense_edit_policy.
create function delete_expense(p_expense_id uuid)
returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_amount numeric; v_currency text;
begin
  if not can_modify_expense(p_expense_id) then
    raise exception 'not permitted to delete this expense';
  end if;

  select trip_id, amount, currency into v_trip_id, v_amount, v_currency
    from expenses where id = p_expense_id;

  update expenses set deleted_at = now() where id = p_expense_id;
  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (v_trip_id, 'expense_deleted', p_expense_id, -v_amount, v_currency, auth.uid());
end; $$;

-- Any active member can comment; system comments (from edit_expense above) use the same table.
create function add_comment(p_expense_id uuid, p_body text)
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid; v_id uuid;
begin
  select trip_id into v_trip_id from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into expense_comments (expense_id, user_id, comment_type, body)
  values (p_expense_id, auth.uid(), 'user', p_body)
  returning id into v_id;
  return v_id;
end; $$;

create function record_payment(p_trip_id uuid, p_to_user uuid, p_amount numeric, p_currency text)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into ledger_entries (trip_id, entry_type, from_user, to_user, amount, currency, created_by)
  values (p_trip_id, 'payment_recorded', auth.uid(), p_to_user, p_amount, p_currency, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Only the recipient can confirm — mirrors your original sender/receiver design,
-- but as one append-only event instead of a mutable status field.
create function confirm_payment(p_ledger_entry_id uuid)
returns uuid language plpgsql security definer as $$
declare v_entry ledger_entries; v_id uuid;
begin
  select * into v_entry from ledger_entries where id = p_ledger_entry_id;
  if v_entry.to_user != auth.uid() then
    raise exception 'only the recipient can confirm this payment';
  end if;
  insert into ledger_entries (trip_id, entry_type, from_user, to_user, amount, currency, created_by, metadata)
  values (v_entry.trip_id, 'payment_confirmed', v_entry.from_user, v_entry.to_user, v_entry.amount,
          v_entry.currency, auth.uid(), jsonb_build_object('confirms', p_ledger_entry_id))
  returning id into v_id;
  return v_id;
end; $$;

-- Called daily by Supabase Cron. Turns due recurring templates into real expenses via the
-- SAME add_expense RPC everything else uses — a recurring expense is never a special case.
create function generate_due_recurring_expenses()
returns void language plpgsql security definer as $$
declare v_template expense_templates;
begin
  for v_template in
    select * from expense_templates where is_active and next_run_date <= current_date
  loop
    perform add_expense(v_template.trip_id, v_template.description, v_template.amount,
      v_template.currency, v_template.split_type, v_template.split_config);

    update expense_templates set next_run_date = case recurrence_rule
      when 'weekly' then next_run_date + interval '7 days'
      when 'monthly' then next_run_date + interval '1 month'
      when 'yearly' then next_run_date + interval '1 year'
    end
    where id = v_template.id;
  end loop;
end; $$;

-- Pseudonymizes rather than cascade-deletes — see data-model doc, "Account deletion & data
-- rights," for why a shared financial ledger can't tolerate a hard delete.
create function delete_account()
returns void language plpgsql security definer as $$
begin
  if exists (select 1 from trip_members where user_id = auth.uid() and role = 'owner' and status = 'active') then
    raise exception 'transfer or archive owned trips before deleting your account';
  end if;

  update profiles set display_name = 'Deleted user', avatar_url = null, deleted_at = now()
  where id = auth.uid();
  -- strips email/phone/OAuth identities via the Auth admin API — done outside this
  -- function, in the calling server-side handler, since it needs the service role.
end; $$;
```

## 5. Real-world scenarios this design was checked against

- **Someone removed mid-trip still has the app open offline.** Their queued writes replay
  against RPCs that re-check `is_active_member` server-side — they fail cleanly on
  reconnect instead of silently succeeding against stale local state.
- **Two people tap "confirm payment" at once.** `confirm_payment` inserts a new ledger row
  each time rather than mutating shared state, so there's no race on a single field — worst
  case is a duplicate `payment_confirmed` entry, which is a UI-level dedupe on
  `metadata->>'confirms'`, not a data-corruption risk.
- **Owner deletes an expense someone else already synced locally.** The delete is a soft
  delete plus an offsetting ledger entry, so every device converges to the same balance
  regardless of sync order — nothing is subtracted twice or missed.
- **Invite code is reused after being revoked.** `join_trip_via_code` checks
  `revoked_at is not null` before checking anything else — a stale cached code in someone's
  messages fails immediately.
- **Solo user invites someone six months later.** No migration step exists to fail — see
  architecture doc §3.
- **A friend group wants Splitwise's fully-open editing instead of the stricter default.**
  One `update trips set settings = settings || '{"expense_edit_policy": "any_member"}'`
  — no code change, no redeploy.
- **Someone deletes their account while three people still owe them money.** `delete_account`
  refuses if they're an active owner of any trip (forces a transfer/archive first), and for
  trips where they're a regular member, their historical ledger rows stay exactly as they
  are — only their profile is scrubbed. The other members' balances stay correct.
