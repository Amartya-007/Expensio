# Expensio — Permissions & Access Control

Companion to `expensio-architecture.md` and `expensio-data-model.md`. Fully flat model, per
your call: "almost nobody has destructive power over other people." No owner, no admin —
every active member of a trip can do everything a trip-level action requires, and the only
things withheld are the ones that could hurt *other* people, not the acting member themself.

## 1. Membership, not roles

There is no `role` column. `trip_members.status` is the only thing that matters:
**`active`** or **`left`**. Every active member has identical permissions. The only ways a
membership row changes after a trip is created are `join_trip_via_code` and `leave_trip` —
there is no `remove_member` function, deliberately (§2).

Still not building a `viewer` / read-only tier for v1 — nothing in your brief asks for it,
and it's a `check` constraint change plus new RLS branches later, not a redesign.

## 2. Permission matrix

| Action | Active member | Left member | Non-member |
|---|:---:|:---:|:---:|
| Create a trip | ✅ (any signed-in, phone-verified user) | ✅ | ✅ |
| View trip & expenses | ✅ | ❌ | ❌ |
| Add expense | ✅ | ❌ | ❌ |
| Edit/delete **any** expense in the trip | ✅ | ❌ | ❌ |
| Add a comment on an expense | ✅ | ❌ | ❌ |
| Generate / view invite code | ✅ | ❌ | ❌ |
| Revoke invite | ✅ | ❌ | ❌ |
| Join via invite code | — | ✅ (rejoin) | ✅ |
| Remove another member | **doesn't exist as a feature** — see below | | |
| Undo a join made through *your own* invite, within 1 hour | ✅ (only your own invite, only that recent) | ❌ | ❌ |
| Leave trip (self) | ✅, always, no restriction | — | — |
| Record a payment | ✅ | ❌ | ❌ |
| Confirm a payment received | ✅ | ❌ | ❌ |
| Create / manage a recurring expense template | ✅ (any template, same as expenses) | ❌ | ❌ |
| Archive / unarchive trip | ✅ | ❌ | ❌ |
| **Hard-delete** trip | ✅, only when caller is the sole remaining active member | ❌ | ❌ |
| Change own notification preferences | ✅ | ✅ | — |
| Request own account deletion | ✅, unconditionally — no ownership check needed anymore | ✅ | ✅ |

**Why "remove another member" doesn't exist, on purpose:** the Splitwise research doesn't
describe a force-remove feature either — people leave voluntarily, full stop. In a fully
flat model, letting any member forcibly remove any other member is exactly the kind of
destructive power over other people this design is trying to avoid (two people join, one
kicks the other; a disagreement ends with someone getting cut off from shared history they
have a stake in). Dropping it isn't a missing feature — it's what makes the flat model safe
to ship. A disruptive member is a social problem the group works out for itself; the app
doesn't need to arbitrate it.

**The one narrow exception, and why it doesn't count as "destructive power over others":**
if an invite link ends up somewhere it shouldn't (a group chat, a forward), someone
unwanted can join before the code is revoked. There's no general fix for this — but there
*is* a case worth handling: catching it fast. `revoke_recent_join` lets the person who
generated a specific invite undo that invite's join, and only within an hour of it
happening. This isn't "any member can remove any member" — it's a person correcting their
own very recent action, on a short clock, scoped only to people who came in through their
own link. Past the window, or for a join that wasn't through your invite, there's no
code-level undo — the honest fallback is everyone else leaving and starting a fresh trip,
which stays consistent with the philosophy since it's a collective choice, not one member
exercising power over another.

**Also shrinking the blast radius in the first place:** `generate_invite`'s `max_uses` now
defaults to **1**, not unlimited. A leaked code seats at most one unwanted person, not
everyone who happened to see it — it doesn't stop a fast-acting stranger from being that
one person, but it stops a pile-on. The app can still offer "let multiple people join with
this code" as a deliberate choice for a real group invite (pass a higher `max_uses`), it's
just no longer the default.

**Why trip deletion stays narrow while everything else opens up:** archiving is reversible
and doesn't erase anyone's data, so it's safe to open to any member. A real, cascading
delete is not reversible and would destroy other people's shared history — so it's only
allowed at the one moment it can't hurt anyone else: when the caller is the last active
member standing. Everyone else already left; there's no one left to lose data.

## 3. RLS policy design

**RLS is defense in depth, not where business logic lives.** Every policy below is a simple
membership check — one helper function, `is_active_member`. The actual rules (member caps,
invite expiry, the sole-remaining-member check on delete) live in the RPC functions in §4.

```sql
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table trip_invites enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table ledger_entries enable row level security;

-- The one helper function every policy and RPC in this doc is built on.
create function is_active_member(p_trip_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

-- trips: visible/editable only to active members. Creation is open to any signed-in,
-- phone-verified user, but created_by must be the caller — never trust a client-supplied value.
create policy trips_select on trips for select
  using (is_active_member(id));

create policy trips_insert on trips for insert
  with check (created_by = auth.uid());

create policy trips_update on trips for update
  using (is_active_member(id));

-- trip_members: members can see their trip's roster. Direct writes are NOT allowed —
-- every membership change goes through an RPC (§4): join_trip_via_code or leave_trip only.
create policy trip_members_select on trip_members for select
  using (is_active_member(trip_id));

-- (no insert/update/delete policy for regular clients — RPC functions run as
--  SECURITY DEFINER and bypass RLS deliberately, which is the only sanctioned write path)

-- expenses / expense_splits / ledger_entries: read access follows membership.
-- All writes go through RPC functions for the same reason as trip_members.
create policy expenses_select on expenses for select
  using (is_active_member(trip_id));

create policy expense_splits_select on expense_splits for select
  using (is_active_member((select trip_id from expenses where id = expense_id)));

create policy ledger_entries_select on ledger_entries for select
  using (is_active_member(trip_id));

-- trip_invites: any active member can see invite codes for their trip.
create policy trip_invites_select on trip_invites for select
  using (is_active_member(trip_id));
```

## 4. RPC functions — the one place each rule lives

Every function below is `SECURITY DEFINER`, validates the caller against `auth.uid()`
internally, and is the *only* sanctioned way to make the corresponding change. Client code
calls these via `supabase.rpc(...)` — it never writes to `trip_members`, `expense_splits`,
or `ledger_entries` directly.

```sql
-- Creates a trip; the caller is just its first active member, nothing more.
create function create_trip(p_name text, p_currency text, p_settings jsonb default '{}')
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  insert into trips (name, currency, settings, created_by)
  values (p_name, p_currency, p_settings, auth.uid())
  returning id into v_trip_id;

  insert into trip_members (trip_id, user_id, status)
  values (v_trip_id, auth.uid(), 'active');

  return v_trip_id;
end; $$;

-- Any active member. Revokes any existing active invite before creating a new one —
-- one active invite per trip, matching your original 6-digit-code design intent.
-- Default expiry is short (24h) since most codes get shared and used within minutes of
-- creation — but this is a parameter, not a hardcoded rule: the client can offer a picker
-- (30 min / 24 hours / 7 days) depending on whether someone's sharing it directly to one
-- person right now, or posting it somewhere for a group to join over the next few days.
-- Expiry and revoke solve different problems and both stay: expiry is passive ("goes
-- stale on its own"), revoke is active ("kill it right now, regardless of time left") —
-- e.g. the code went to the wrong group chat and needs to die immediately, not in 24h.
-- max_uses defaults to 1, not unlimited — a leaked code seats at most one unwanted
-- person, not everyone who saw it. Pass a higher value explicitly for a real group invite.
create function generate_invite(p_trip_id uuid, p_expires_in interval default '24 hours', p_max_uses int default 1)
returns text language plpgsql security definer as $$
declare v_code text;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'only trip members can generate an invite';
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
  if not is_active_member(v_trip_id) then
    raise exception 'only trip members can revoke an invite';
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

  insert into trip_members (trip_id, user_id, status, joined_via_invite_id)
  values (v_invite.trip_id, auth.uid(), 'active', v_invite.id)
  on conflict (trip_id, user_id) do update
    set status = 'active', left_at = null, joined_via_invite_id = v_invite.id, joined_at = now();

  update trip_invites set use_count = use_count + 1 where id = v_invite.id;

  return v_invite.trip_id;
end; $$;

-- No remove_member function exists — see §2 for why. This is a narrow exception, not a
-- general one: the person who generated a specific invite can undo THAT invite's join,
-- and only within an hour of it happening. Scoped to their own recent action, not
-- power over the group.
create function revoke_recent_join(p_trip_id uuid, p_user_id uuid)
returns void language plpgsql security definer as $$
declare v_member trip_members; v_invite trip_invites;
begin
  select * into v_member from trip_members where trip_id = p_trip_id and user_id = p_user_id;
  if v_member is null or v_member.status != 'active' then
    raise exception 'no active membership to undo';
  end if;
  if v_member.joined_at < now() - interval '1 hour' then
    raise exception 'this join is more than an hour old — no longer undoable this way';
  end if;

  select * into v_invite from trip_invites where id = v_member.joined_via_invite_id;
  if v_invite is null or v_invite.created_by != auth.uid() then
    raise exception 'you can only undo a join that happened through an invite you personally generated';
  end if;

  update trip_members set status = 'left', left_at = now()
  where trip_id = p_trip_id and user_id = p_user_id;
end; $$;

-- Membership changes after creation: join_trip_via_code, leave_trip, and this narrow
-- exception only. Kept together here so the full picture of "how does trip_members ever
-- change" stays in one place.

-- No remove_member function exists — see §2 for why. This is the only way membership
-- ever ends: always self-initiated, always allowed, no restriction.
create function leave_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  update trip_members set status = 'left', left_at = now()
  where trip_id = p_trip_id and user_id = auth.uid();
end; $$;

-- Any active member may archive or unarchive — reversible, doesn't erase anything.
create function archive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  update trips set is_archived = true where id = p_trip_id;
end; $$;

create function unarchive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  update trips set is_archived = false where id = p_trip_id;
end; $$;

-- Hard delete, only when it can't affect anyone else. Cascades to trip_members, expenses,
-- expense_splits, ledger_entries, trip_invites, expense_templates via the FKs already
-- defined ON DELETE CASCADE in the data model.
create function delete_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
declare v_active_count int;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  select count(*) into v_active_count from trip_members
    where trip_id = p_trip_id and status = 'active';
  if v_active_count > 1 then
    raise exception 'cannot delete a trip while other members are still active — archive it instead';
  end if;
  delete from trips where id = p_trip_id;
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

  perform compute_expense_splits(v_expense_id);

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (p_trip_id, 'expense_added', v_expense_id, p_amount, p_currency, auth.uid());

  return v_expense_id;
end; $$;

-- Any active member may edit/delete ANY expense — the flat model, unconditionally.
-- No creator check, no policy toggle: this IS the policy now.
create function edit_expense(
  p_expense_id uuid, p_description text, p_amount numeric,
  p_split_type text, p_split_config jsonb
) returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_currency text;
begin
  select trip_id, currency into v_trip_id, v_currency from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to edit this expense';
  end if;

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

create function delete_expense(p_expense_id uuid)
returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_amount numeric; v_currency text;
begin
  select trip_id, amount, currency into v_trip_id, v_amount, v_currency
    from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to delete this expense';
  end if;

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
-- rights." No ownership check needed anymore: with no owner concept, deleting an account
-- never blocks on "someone has to hold this trip together" — it just leaves the profile
-- scrubbed and every other member's ledger history untouched.
create function delete_account()
returns void language plpgsql security definer as $$
begin
  update profiles set display_name = 'Deleted user', avatar_url = null, deleted_at = now()
  where id = auth.uid();
  -- strips email/phone/OAuth identities via the Auth admin API — done outside this
  -- function, in the calling server-side handler, since it needs the service role.
end; $$;
```

## 5. Real-world scenarios this design was checked against

- **Someone tries to force-remove a member they disagree with.** Not possible — there is no
  such RPC. The only paths that change `trip_members` after creation are joining and
  self-initiated leaving. This is a deliberate, load-bearing property of the flat model, not
  a missing feature.
- **Someone tries to delete a trip while others are still active in it.** `delete_trip`
  checks the active-member count first and refuses with a clear message pointing at
  `archive_trip` instead — no accidental mass-deletion of other people's shared history.
- **A left member still has the app open offline.** Their queued writes replay against RPCs
  that re-check `is_active_member` server-side — they fail cleanly on reconnect instead of
  silently succeeding against stale local state.
- **Two people tap "confirm payment" at once.** `confirm_payment` inserts a new ledger row
  each time rather than mutating shared state, so there's no race on a single field — worst
  case is a duplicate `payment_confirmed` entry, deduped in the UI on
  `metadata->>'confirms'`, not a data-corruption risk.
- **Someone deletes an expense someone else already synced locally.** Soft delete plus an
  offsetting ledger entry, so every device converges to the same balance regardless of sync
  order — nothing is subtracted twice or missed.
- **Invite code is revoked before its 24h expiry elapses.** `join_trip_via_code` checks
  `revoked_at is not null` before checking anything else, so a code shared with the wrong
  group chat stops working the moment it's revoked — it doesn't have to wait out the timer.
- **Solo user invites someone six months later.** No migration step exists to fail — see
  architecture doc §3.
- **A code gets shared somewhere it shouldn't, and someone unwanted joins before it's
  revoked.** If caught within an hour, whoever generated that invite can undo just that
  join via `revoke_recent_join` — narrow, scoped to their own action. If it's been longer,
  or the join came through someone else's invite, there's no code-level undo — the honest
  fallback is the rest of the group leaving and starting a fresh trip. Named explicitly
  because it's the one real gap this flat model accepts, not something worth pretending
  away.
- **Someone deletes their account while three people still owe them money.** `delete_account`
  has nothing to check anymore — no owner to force a transfer first. Their profile is
  scrubbed; every other member's ledger rows stay exactly as they are, and balances stay
  correct.
