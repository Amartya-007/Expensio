# Expensio — Permissions & Access Control

Companion to `expensio-architecture.md` and `expensio-data-model.md`. Fully flat model, per
your call: "almost nobody has destructive power over other people." No owner, no admin —
every active member of a trip can do everything a trip-level action requires, and the only
things withheld are the ones that could hurt *other* people, not the acting member themself.

This now covers **placeholder participants** (people manually added without an account —
see `expensio-data-model.md`'s opening note for why `trip_members` and `participants` are
separate tables), the **guest/verification gate** (architecture doc §3), and the **immutable
trip activity log** — every RPC below that changes something also writes one row to
`trip_activity_log`, in the same transaction, via the `log_activity` helper in §3.

## 1. Membership, not roles

There is no `role` column. `trip_members.status` is the only thing that matters:
**`active`** or **`left`**. Every active member has identical permissions. The only ways a
membership row changes after a trip is created are `join_trip_via_code` and `leave_trip` —
there is no `remove_member` function, deliberately (§2).

A placeholder participant is never a `trip_members` row — they have no `auth.uid()` to
check. Any active member manages a placeholder's expenses on their behalf; that's not a new
permission tier, it's the same "any active member" rule applied to someone who can't act for
themselves.

Still not building a `viewer` / read-only tier for v1 — nothing in your brief asks for it.

## 2. Permission matrix

| Action | Active member | Left member | Non-member |
|---|:---:|:---:|:---:|
| Create a trip | ✅ (any account, incl. guest) | ✅ | ✅ |
| View trip, expenses & activity log | ✅ | ❌ | ❌ |
| Add expense (for self or any participant, incl. placeholders) | ✅ | ❌ | ❌ |
| Edit/delete **any** expense in the trip | ✅ | ❌ | ❌ |
| Add a placeholder participant | ✅ (incl. guest) | ❌ | ❌ |
| Add a comment on an expense | ✅ | ❌ | ❌ |
| Generate / view invite code | ✅ **if verified** — guest is prompted to verify first | ❌ | ❌ |
| Revoke invite | ✅ | ❌ | ❌ |
| Join via invite code | — | ✅ (rejoin) | ✅ **if verified** — guest is prompted to verify first |
| Remove another member | **doesn't exist as a feature** — see below | | |
| Undo a join made through *your own* invite, within 1 hour | ✅ (only your own invite, only that recent) | ❌ | ❌ |
| Leave trip (self) | ✅, always, no restriction | — | — |
| Record a payment | ✅ (as self, or on behalf of a placeholder) | ❌ | ❌ |
| Confirm a payment received | ✅ if you're the recipient; any active member if the recipient is a placeholder | ❌ | ❌ |
| Create / manage a recurring expense template | ✅ | ❌ | ❌ |
| Change own display name (logged in every active trip) | ✅ | ✅ | ✅ |
| Archive / unarchive trip | ✅ | ❌ | ❌ |
| **Hide** a trip (soft — see §5's note on why this replaced hard delete) | ✅, only when caller is the sole remaining active member | ❌ | ❌ |
| Change own notification preferences | ✅ | ✅ | — |
| Request own account deletion | ✅, unconditionally | ✅ | ✅ |

**Why "remove another member" doesn't exist, on purpose:** the Splitwise research doesn't
describe a force-remove feature either — people leave voluntarily, full stop. Letting any
member forcibly remove any other member is exactly the destructive power over other people
this design avoids. A disruptive member is a social problem the group works out for itself.

**The one narrow exception:** `revoke_recent_join` lets the person who generated a specific
invite undo that invite's join, within an hour. Not "remove any member" — correcting your
own very recent action, on a short clock. Past the window, the honest fallback is everyone
else leaving and starting a fresh trip.

**Shrinking the blast radius in the first place:** `generate_invite`'s `max_uses` defaults
to **1**. A leaked code seats at most one unwanted person, not everyone who saw it.

## 3. Shared infrastructure — the two helpers everything else builds on

```sql
create function is_active_member(p_trip_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip_id and user_id = auth.uid() and status = 'active'
  );
$$;

-- "Not anonymous" — Google sign-in or phone verification both clear this, checked via
-- Supabase's own is_anonymous JWT claim. Gates only generate_invite and join_trip_via_code
-- (architecture doc §3) — every other action stays available to guests.
create function is_verified_user()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- Every RPC that changes something calls this once. Prepends the actor's CURRENT display
-- name to the detail text and freezes the result — this is what makes log entries survive
-- a later name change unchanged (data model doc, trip_activity_log comment).
create function log_activity(
  p_trip_id uuid, p_event_type text, p_detail text,
  p_subject_participant_id uuid default null, p_metadata jsonb default '{}'
) returns void language plpgsql security definer as $$
declare v_actor_name text;
begin
  select coalesce(display_name, 'Someone') into v_actor_name from profiles where id = auth.uid();
  insert into trip_activity_log (trip_id, event_type, actor_id, subject_participant_id, description, metadata)
  values (p_trip_id, p_event_type, auth.uid(), p_subject_participant_id,
          v_actor_name || ' ' || p_detail, p_metadata);
end; $$;

-- Idempotency check for offline-replayed calls (data model doc, Design Principle 8).
-- Returns true the first time a given key is seen (and records it), false on any repeat.
-- Every write RPC below starts with this when p_client_request_id is supplied.
create function claim_idempotency_key(p_key uuid)
returns boolean language plpgsql security definer as $$
begin
  insert into processed_requests (client_request_id) values (p_key);
  return true;
exception when unique_violation then
  return false;
end; $$;
```

## 4. RLS policy design

**RLS is defense in depth, not where business logic lives.** `is_active_member` backs
almost every policy; the actual rules live in the RPCs in §5.

```sql
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table participants enable row level security;
alter table trip_invites enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table ledger_entries enable row level security;
alter table expense_attachments enable row level security;
alter table custom_categories enable row level security;
alter table trip_activity_log enable row level security;

create policy trips_select on trips for select
  using (is_active_member(id) and deleted_at is null);
create policy trips_insert on trips for insert with check (created_by = auth.uid());
create policy trips_update on trips for update using (is_active_member(id));

-- trip_members: members can see their trip's roster. No insert/update/delete policy for
-- clients — join_trip_via_code and leave_trip are the only sanctioned writes (RPCs run
-- SECURITY DEFINER and bypass RLS deliberately).
create policy trip_members_select on trip_members for select
  using (is_active_member(trip_id));

-- participants: same pattern — read follows membership, all writes go through RPCs.
create policy participants_select on participants for select
  using (is_active_member(trip_id));

create policy expenses_select on expenses for select using (is_active_member(trip_id));
create policy expense_splits_select on expense_splits for select
  using (is_active_member((select trip_id from expenses where id = expense_id)));
create policy ledger_entries_select on ledger_entries for select
  using (is_active_member(trip_id));
create policy trip_invites_select on trip_invites for select
  using (is_active_member(trip_id));
create policy expense_attachments_select on expense_attachments for select
  using (is_active_member((select trip_id from expenses where id = expense_id)));
create policy custom_categories_select on custom_categories for select
  using (is_active_member(trip_id));

-- The cross-trip isolation invariant, stated as an actual policy, not left to the client:
-- a user can only ever see activity_log rows for a trip they're currently an active member
-- of — no event from Trip A can appear when viewing Trip B, and no one who's left a trip
-- (or never joined it) can see its log, regardless of which other trips they share with
-- people who ARE in it. This is exactly the bug from your old project — logs showing UUIDs
-- of people who didn't belong in that trip — closed at the RLS layer, not the UI layer.
create policy trip_activity_log_select on trip_activity_log for select
  using (is_active_member(trip_id));
```

## 5. RPC functions — the one place each rule lives

Every function below is `SECURITY DEFINER`, validates the caller against `auth.uid()`
internally, and is the *only* sanctioned way to make the corresponding change. Every
state-changing one takes an optional `p_client_request_id` for idempotent offline replay
(§3) and calls `log_activity` before returning.

```sql
-- Creates a trip; the caller is its first active member AND gets a matching participants
-- row, so they're financially attributable from expense one.
create function create_trip(
  p_name text, p_currency text, p_settings jsonb default '{}', p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;  -- already created on a previous attempt; client already has the trip_id
  end if;

  insert into trips (name, currency, settings, created_by)
  values (p_name, p_currency, p_settings, auth.uid())
  returning id into v_trip_id;

  insert into trip_members (trip_id, user_id, status)
  values (v_trip_id, auth.uid(), 'active');

  insert into participants (trip_id, type, linked_user_id, display_name, created_by)
  select v_trip_id, 'registered', auth.uid(), coalesce(display_name, 'You'), auth.uid()
  from profiles where id = auth.uid();

  perform log_activity(v_trip_id, 'trip_created', 'created this trip');
  return v_trip_id;
end; $$;

-- Any active member. A manually-added person with no account — see the claim logic in
-- join_trip_via_code for how this row gets linked to a real user later.
create function add_placeholder_participant(
  p_trip_id uuid, p_display_name text, p_phone text default null, p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into participants (trip_id, type, display_name, phone, created_by)
  values (p_trip_id, 'placeholder', p_display_name, p_phone, auth.uid())
  returning id into v_id;
  perform log_activity(p_trip_id, 'placeholder_added', format('added %s as a participant', p_display_name), v_id);
  return v_id;
end; $$;

-- expenses.category stays free text — no FK to this table. It exists only so a custom
-- name+icon pair is shared and reusable across the trip, not to constrain what category
-- text an expense can actually hold.
create function add_custom_category(p_trip_id uuid, p_name text, p_icon text, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into custom_categories (trip_id, name, icon, created_by)
  values (p_trip_id, p_name, p_icon, auth.uid())
  returning id into v_id;
  perform log_activity(p_trip_id, 'category_added', format('added a custom category: %s', p_name));
  return v_id;
end; $$;

-- The actual file upload goes straight to Supabase Storage from the client (RLS-protected
-- by trip membership on the bucket policy); this just records the resulting path. Not
-- logged to trip_activity_log — an attachment is metadata on an expense that's already
-- logged, not its own domain event worth a separate log line.
create function add_attachment(p_expense_id uuid, p_storage_path text)
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid; v_id uuid;
begin
  select trip_id into v_trip_id from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into expense_attachments (expense_id, storage_path, uploaded_by)
  values (p_expense_id, p_storage_path, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- 6-digit NUMERIC code. No DB-level UNIQUE(code): at 1,000,000 combinations, "unique
-- forever" would eventually block valid new codes as old ones pile up expired-but-unrevoked,
-- and Postgres partial indexes can't express "while not yet expired" since now() isn't an
-- immutable predicate. Uniqueness is enforced among CURRENTLY VALID codes only, at
-- generation time, with a retry loop.
create function generate_invite(
  p_trip_id uuid, p_expires_in interval default '24 hours', p_max_uses int default 1,
  p_client_request_id uuid default null
) returns text language plpgsql security definer as $$
declare v_code text; v_attempts int := 0;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'only trip members can generate an invite';
  end if;
  if not is_verified_user() then
    raise exception 'verify your account before inviting others';
  end if;

  update trip_invites set revoked_at = now()
  where trip_id = p_trip_id and revoked_at is null and (expires_at is null or expires_at > now());

  loop
    v_code := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when not exists (
      select 1 from trip_invites where code = v_code and revoked_at is null and expires_at > now()
    );
    v_attempts := v_attempts + 1;
    if v_attempts > 10 then
      raise exception 'could not generate a unique invite code — try again';
    end if;
  end loop;

  insert into trip_invites (trip_id, code, created_by, max_uses, expires_at)
  values (p_trip_id, v_code, auth.uid(), p_max_uses, now() + p_expires_in);

  perform log_activity(p_trip_id, 'invite_generated', 'generated an invite code');
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
  perform log_activity(v_trip_id, 'invite_revoked', 'revoked an invite code');
end; $$;

-- Validates code, expiry, revocation, and member cap. Also runs the CLAIM mechanism —
-- fixed here to use the CALLER'S OWN VERIFIED phone from their JWT, never a client-supplied
-- parameter. A client-passed phone would let anyone claim someone else's placeholder just
-- by knowing (or guessing) their number; the JWT claim is only ever set by Supabase itself,
-- after actual OTP verification, so it can't be spoofed the same way.
create function join_trip_via_code(p_code text, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_invite trip_invites; v_member_count int; v_claimed_id uuid;
declare v_verified_phone text; v_was_previously_member boolean;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_verified_user() then
    raise exception 'verify your account before joining a trip';
  end if;

  select * into v_invite from trip_invites
    where code = p_code and revoked_at is null and expires_at > now() for update;

  if v_invite is null then
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

  select exists(select 1 from trip_members where trip_id = v_invite.trip_id and user_id = auth.uid())
    into v_was_previously_member;

  insert into trip_members (trip_id, user_id, status, joined_via_invite_id)
  values (v_invite.trip_id, auth.uid(), 'active', v_invite.id)
  on conflict (trip_id, user_id) do update
    set status = 'active', left_at = null, joined_via_invite_id = v_invite.id, joined_at = now();

  -- Claim uses the verified JWT phone, not a parameter — see the function comment above.
  v_verified_phone := auth.jwt() ->> 'phone';
  if v_verified_phone is not null and v_verified_phone != '' then
    update participants set linked_user_id = auth.uid(), type = 'registered'
      where trip_id = v_invite.trip_id and type = 'placeholder' and phone = v_verified_phone
      returning id into v_claimed_id;
  end if;

  if v_claimed_id is null then
    insert into participants (trip_id, type, linked_user_id, display_name, created_by)
    select v_invite.trip_id, 'registered', auth.uid(), coalesce(display_name, 'New member'), auth.uid()
    from profiles where id = auth.uid()
    on conflict (trip_id, linked_user_id) where linked_user_id is not null do nothing;
  end if;

  update trip_invites set use_count = use_count + 1 where id = v_invite.id;

  perform log_activity(v_invite.trip_id, case when v_was_previously_member then 'member_rejoined' else 'member_joined' end,
    case when v_was_previously_member then 'rejoined the trip' else 'joined the trip' end);
  if v_claimed_id is not null then
    perform log_activity(v_invite.trip_id, 'placeholder_claimed', 'was matched to an existing placeholder by phone', v_claimed_id);
  end if;

  return v_invite.trip_id;
end; $$;

-- No remove_member function exists — see §2. Person who generated a specific invite can
-- undo THAT invite's join, only within an hour. Not power over the group.
create function revoke_recent_join(p_trip_id uuid, p_user_id uuid)
returns void language plpgsql security definer as $$
declare v_member trip_members; v_invite trip_invites; v_undone_name text;
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

  select coalesce(display_name, 'a member') into v_undone_name from profiles where id = p_user_id;
  perform log_activity(p_trip_id, 'invite_join_undone', format('undid %s''s recent join (invite mistake)', v_undone_name));
end; $$;

-- The only other way membership ends: always self-initiated, always allowed. left_at IS
-- overwritten to null on a later rejoin (join_trip_via_code) — that's fine now, because
-- trip_activity_log's 'member_left' entry from THIS call already recorded the departure
-- permanently, independent of what trip_members' current-state row does afterward.
create function leave_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  update trip_members set status = 'left', left_at = now()
  where trip_id = p_trip_id and user_id = auth.uid();
  perform log_activity(p_trip_id, 'member_left', 'left the trip');
end; $$;

create function archive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  update trips set is_archived = true where id = p_trip_id;
  perform log_activity(p_trip_id, 'trip_archived', 'archived this trip');
end; $$;

create function unarchive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  update trips set is_archived = false where id = p_trip_id;
  perform log_activity(p_trip_id, 'trip_unarchived', 'unarchived this trip');
end; $$;

-- SOFT-HIDE, not a real DELETE — changed from the earlier design. A true hard delete would
-- cascade-destroy trip_activity_log along with everything else, directly contradicting
-- "immutable" the moment someone hit this button. Only allowed when the caller is the sole
-- remaining active member, same restriction as before — there's no one else who'd want to
-- keep seeing it, but the record itself still isn't destroyed, just hidden from listings
-- (trips_select's RLS policy filters deleted_at is null).
create function delete_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
declare v_active_count int;
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  select count(*) into v_active_count from trip_members
    where trip_id = p_trip_id and status = 'active';
  if v_active_count > 1 then
    raise exception 'cannot delete a trip while other members are still active — archive it instead';
  end if;
  update trips set deleted_at = now() where id = p_trip_id;
end; $$;

-- p_paid_by is a participant_id, not auth.uid() — lets any active member log an expense
-- as paid by themselves OR by a placeholder they're managing. Validated against the trip
-- so a participant_id from a different trip can't be passed in by mistake.
create function add_expense(
  p_trip_id uuid, p_paid_by uuid, p_description text, p_amount numeric, p_currency text,
  p_split_type text, p_split_config jsonb, p_category text default null, p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_expense_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  if not exists (select 1 from participants where id = p_paid_by and trip_id = p_trip_id) then
    raise exception 'paid_by must be a participant of this trip';
  end if;

  insert into expenses (trip_id, description, amount, currency, paid_by, category, split_type, split_config, created_by)
  values (p_trip_id, p_description, p_amount, p_currency, p_paid_by, p_category, p_split_type, p_split_config, auth.uid())
  returning id into v_expense_id;

  perform compute_expense_splits(v_expense_id);

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (p_trip_id, 'expense_added', v_expense_id, p_amount, p_currency, auth.uid());

  perform log_activity(p_trip_id, 'expense_added',
    format('added an expense: %s (%s %s)', p_description, p_currency, p_amount), p_paid_by);
  return v_expense_id;
end; $$;

-- Any active member may edit/delete ANY expense — the flat model, unconditionally. Worth
-- being deliberate about one thing this does NOT do: block editing an expense that a
-- payment has already been recorded/confirmed against. It doesn't need to — balances are
-- always derived by summing ledger_entries, so an edit's offsetting entry keeps the math
-- correct regardless of payment history. The client should still show a heads-up ("this
-- may change a balance you've already settled") since it can genuinely surprise someone,
-- but that's a UX confirmation, not an architectural block.
create function edit_expense(
  p_expense_id uuid, p_description text, p_amount numeric, p_split_type text, p_split_config jsonb,
  p_client_request_id uuid default null
) returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_currency text;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return;
  end if;
  select trip_id, currency into v_trip_id, v_currency from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then raise exception 'not permitted to edit this expense'; end if;

  update expenses set description = p_description, amount = p_amount,
    split_type = p_split_type, split_config = p_split_config, updated_at = now()
  where id = p_expense_id;

  perform compute_expense_splits(p_expense_id);

  insert into expense_comments (expense_id, user_id, comment_type, body)
  values (p_expense_id, auth.uid(), 'system', format('changed the amount to %s %s', v_currency, p_amount));

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (v_trip_id, 'expense_edited', p_expense_id, p_amount, v_currency, auth.uid());

  perform log_activity(v_trip_id, 'expense_edited', format('edited an expense: %s', p_description));
end; $$;

create function delete_expense(p_expense_id uuid, p_client_request_id uuid default null)
returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_amount numeric; v_currency text; v_description text;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return;
  end if;
  select trip_id, amount, currency, description into v_trip_id, v_amount, v_currency, v_description
    from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then raise exception 'not permitted to delete this expense'; end if;

  update expenses set deleted_at = now() where id = p_expense_id;
  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (v_trip_id, 'expense_deleted', p_expense_id, -v_amount, v_currency, auth.uid());
  perform log_activity(v_trip_id, 'expense_deleted', format('deleted an expense: %s', v_description));
end; $$;

create function add_comment(p_expense_id uuid, p_body text)
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid; v_id uuid;
begin
  select trip_id into v_trip_id from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then raise exception 'not an active member of this trip'; end if;
  insert into expense_comments (expense_id, user_id, comment_type, body)
  values (p_expense_id, auth.uid(), 'user', p_body) returning id into v_id;
  return v_id;
end; $$;

-- Resolves the caller's OWN participant row in this trip as the payer — a real user
-- always pays as themselves, never on behalf of someone else.
create function record_payment(
  p_trip_id uuid, p_to_participant uuid, p_amount numeric, p_currency text, p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_id uuid; v_from_participant uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;

  select id into v_from_participant from participants
    where trip_id = p_trip_id and linked_user_id = auth.uid();
  if v_from_participant is null then
    raise exception 'no participant record found for this trip';
  end if;

  insert into ledger_entries (trip_id, entry_type, from_participant, to_participant, amount, currency, created_by)
  values (p_trip_id, 'payment_recorded', v_from_participant, p_to_participant, p_amount, p_currency, auth.uid())
  returning id into v_id;

  perform log_activity(p_trip_id, 'payment_recorded', format('recorded a payment of %s %s', p_currency, p_amount), p_to_participant);
  return v_id;
end; $$;

-- The registered recipient confirms for themselves. A PLACEHOLDER recipient can't log in
-- to confirm anything — so any active member of the trip may confirm on their behalf,
-- same "any active member manages a placeholder" pattern as everywhere else.
create function confirm_payment(p_ledger_entry_id uuid, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_entry ledger_entries; v_to_participant participants; v_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  select * into v_entry from ledger_entries where id = p_ledger_entry_id;
  select * into v_to_participant from participants where id = v_entry.to_participant;

  if v_to_participant.linked_user_id is not null then
    if v_to_participant.linked_user_id != auth.uid() then
      raise exception 'only the recipient can confirm this payment';
    end if;
  elsif not is_active_member(v_entry.trip_id) then
    raise exception 'not an active member of this trip';
  end if;

  insert into ledger_entries (trip_id, entry_type, from_participant, to_participant, amount, currency, created_by, metadata)
  values (v_entry.trip_id, 'payment_confirmed', v_entry.from_participant, v_entry.to_participant,
          v_entry.amount, v_entry.currency, auth.uid(), jsonb_build_object('confirms', p_ledger_entry_id))
  returning id into v_id;

  perform log_activity(v_entry.trip_id, 'payment_confirmed', 'confirmed a payment received');
  return v_id;
end; $$;

-- Idempotent by construction, not just by the shared key mechanism: next_run_date only
-- advances AFTER a template successfully generates its expense, and a unique index on
-- (source_template_id, expense_date) means even a genuine double-run of this scheduled job
-- (overlapping cron triggers, a retry after a timeout) can't create two expenses for the
-- same template on the same day — the second insert just fails the constraint and that
-- template is skipped for this run, not duplicated.
create function generate_due_recurring_expenses()
returns void language plpgsql security definer as $$
declare v_template expense_templates;
begin
  for v_template in select * from expense_templates where is_active and next_run_date <= current_date loop
    begin
      perform add_expense(v_template.trip_id, v_template.paid_by, v_template.description,
        v_template.amount, v_template.currency, v_template.split_type, v_template.split_config);
    exception when unique_violation then
      continue;  -- already generated for this period, skip rather than duplicate
    end;

    update expense_templates set next_run_date = case recurrence_rule
      when 'weekly' then next_run_date + interval '7 days'
      when 'monthly' then next_run_date + interval '1 month'
      when 'yearly' then next_run_date + interval '1 year'
    end
    where id = v_template.id;
  end loop;
end; $$;

-- Cross-trip fan-out: a display name is a global profiles field, but the log is trip-
-- scoped, so a name change gets one log entry in every trip the person is currently an
-- active member of — anyone who could see their old name in that trip can see when and
-- what it changed to.
create function update_display_name(p_new_name text)
returns void language plpgsql security definer as $$
declare v_old_name text; v_trip record;
begin
  select display_name into v_old_name from profiles where id = auth.uid();
  update profiles set display_name = p_new_name where id = auth.uid();

  for v_trip in select trip_id from trip_members where user_id = auth.uid() and status = 'active' loop
    perform log_activity(v_trip.trip_id, 'display_name_changed',
      format('changed their name from %s to %s', coalesce(v_old_name, '(unnamed)'), p_new_name));
  end loop;
end; $$;

-- Pseudonymizes, doesn't cascade-delete. Every participants row still resolves its display
-- name through profiles (data model doc, Design Principle 6), so nothing here needs to
-- touch participants at all.
create function delete_account()
returns void language plpgsql security definer as $$
begin
  update profiles set display_name = 'Deleted user', avatar_url = null, deleted_at = now()
  where id = auth.uid();
end; $$;
```

## 6. Real-world scenarios this design was checked against

- **Someone tries to force-remove a member they disagree with.** Not possible — no such RPC.
- **Someone tries to delete a trip while others are still active.** `delete_trip` refuses
  and points at `archive_trip` instead.
- **A left member still has the app open offline.** Queued writes replay against RPCs that
  re-check `is_active_member` server-side.
- **A flaky connection causes the same "add expense" call to fire twice.** The second call
  carries the same `p_client_request_id`, `claim_idempotency_key` returns false, and the
  function returns immediately — one expense, not two.
- **Two people tap "confirm payment" at once.** Insert-only ledger rows, no race on shared
  state, worst case a UI-deduped double entry.
- **Someone deletes an expense already synced on another device.** Soft delete plus an
  offsetting ledger entry — every device converges regardless of sync order.
- **Someone edits an expense a payment has already been recorded against.** Allowed —
  balances are derived, not stored, so the math stays correct automatically. The client
  should warn before submitting, but the server doesn't need to block it.
- **Invite code is revoked before its 24h expiry.** Fails immediately, doesn't wait out the timer.
- **A code is leaked and someone unwanted joins.** Caught within an hour + it was your own
  invite → clean undo via `revoke_recent_join`. Otherwise, no code-level fix — the group
  leaves and starts fresh.
- **Someone tries to claim a placeholder using a phone number that isn't theirs.** Can't —
  the claim check reads the number from the caller's own verified JWT, never from a
  client-supplied parameter. There's nothing to spoof.
- **A guest tries to invite someone or join a trip.** `is_verified_user()` blocks it
  server-side regardless of what the client UI shows.
- **Someone leaves a trip, then rejoins months later.** `trip_members.left_at` gets
  overwritten back to null on rejoin (it only tracks *current* state) — but the
  `member_left` and `member_rejoined` entries in `trip_activity_log` from each event are
  permanent and independent of that, so "they left on this date, rejoined on that one" is
  never actually lost, even though the mutable row doesn't carry it.
- **Someone changes their display name.** Every trip they're active in gets one
  `display_name_changed` log entry. Old log entries elsewhere ("Amit added an expense...")
  keep reading "Amit" forever, since the description was frozen at write time — the log is
  a historical record, not a live view through the current profile.
- **A recurring-expense job runs twice for the same day** (overlapping cron triggers, a
  timeout retry). The unique constraint on `(source_template_id, expense_date)` means the
  second attempt fails cleanly and is skipped — one expense generated, not two.
- **Two trips share some of the same people — does Trip A's log ever show up in Trip B?**
  No. `trip_activity_log_select`'s RLS checks `is_active_member(trip_id)` for the specific
  row's own `trip_id`, not "any trip this person is active in somewhere" — this is the
  cross-trip isolation invariant, enforced at the database layer, not left for the client
  to filter correctly.
- **Someone deletes their account while owed money by three people.** No blocking check
  needed — their profile is scrubbed, every other participant's ledger rows stay correct.
- **7-person trip, 3 added via contacts, 4 entered manually with no phone.** The 4 manual
  entries are `participants` rows with `type = 'placeholder'`, `phone = null`. They can't be
  invited (nothing to send to), but they're fully functional in the ledger — any active
  member logs expenses as paid by them, splits involving them, and confirms payments on
  their behalf.
- **A manually-added placeholder later signs up with the phone number that was on file for
  them.** `join_trip_via_code`'s claim step links their new account to the existing
  `participants` row instead of creating a second one — every expense they were already
  "in" is correctly theirs from the moment they join, no reconciliation step, no duplicate
  ledger identity.
- **Same person is added as a placeholder in two different trips.** Each is a fully separate
  `participants` row (table is `trip_id`-scoped) — no shared identity or history between
  them unless each one is individually claimed by the same real account.
- **Someone hides (deletes) their last solo trip, then wants to see what happened in it a
  year later.** `delete_trip` only sets `deleted_at` — the trip, its expenses, and its
  activity log are all still there in the database; it's just filtered out of normal
  listings by `trips_select`'s RLS. A "show hidden trips" view is a UI decision, not a data
  recovery problem.
