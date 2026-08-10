# Expensio — Permissions & Access Control

Companion to `expensio-architecture.md` and `expensio-data-model.md`. Fully flat model, per
your call: "almost nobody has destructive power over other people." No owner, no admin —
every active member of a trip can do everything a trip-level action requires, and the only
things withheld are the ones that could hurt *other* people, not the acting member themself.

This now covers **placeholder participants** too (people manually added without an
account) — see `expensio-data-model.md`'s opening note for why `trip_members` (access) and
`participants` (financial identity) are two separate tables, not one renamed.

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
| Create a trip | ✅ (any signed-in, phone-verified user) | ✅ | ✅ |
| View trip & expenses | ✅ | ❌ | ❌ |
| Add expense (for self or any participant, incl. placeholders) | ✅ | ❌ | ❌ |
| Edit/delete **any** expense in the trip | ✅ | ❌ | ❌ |
| Add a placeholder participant | ✅ | ❌ | ❌ |
| Add a comment on an expense | ✅ | ❌ | ❌ |
| Generate / view invite code | ✅ | ❌ | ❌ |
| Revoke invite | ✅ | ❌ | ❌ |
| Join via invite code | — | ✅ (rejoin) | ✅ |
| Remove another member | **doesn't exist as a feature** — see below | | |
| Undo a join made through *your own* invite, within 1 hour | ✅ (only your own invite, only that recent) | ❌ | ❌ |
| Leave trip (self) | ✅, always, no restriction | — | — |
| Record a payment | ✅ (as self, or on behalf of a placeholder) | ❌ | ❌ |
| Confirm a payment received | ✅ if you're the recipient; any active member if the recipient is a placeholder | ❌ | ❌ |
| Create / manage a recurring expense template | ✅ | ❌ | ❌ |
| Archive / unarchive trip | ✅ | ❌ | ❌ |
| **Hard-delete** trip | ✅, only when caller is the sole remaining active member | ❌ | ❌ |
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

**Why trip deletion stays narrow:** archiving is reversible and safe to open to everyone. A
real delete isn't, so it's only allowed when the caller is the last active member standing —
there's no one left to lose data.

## 3. RLS policy design

**RLS is defense in depth, not where business logic lives.** One helper function,
`is_active_member`, backs almost every policy. The actual rules live in the RPCs in §4.

```sql
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table participants enable row level security;
alter table trip_invites enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table ledger_entries enable row level security;

create function is_active_member(p_trip_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip_id and user_id = auth.uid() and status = 'active'
  );
$$;

create policy trips_select on trips for select using (is_active_member(id));
create policy trips_insert on trips for insert with check (created_by = auth.uid());
create policy trips_update on trips for update using (is_active_member(id));

-- trip_members: members can see their trip's roster. No insert/update/delete policy for
-- clients — join_trip_via_code and leave_trip are the only sanctioned writes (RPCs run
-- SECURITY DEFINER and bypass RLS deliberately).
create policy trip_members_select on trip_members for select
  using (is_active_member(trip_id));

-- participants: same pattern — read follows membership, all writes go through RPCs
-- (create_trip, join_trip_via_code, add_placeholder_participant).
create policy participants_select on participants for select
  using (is_active_member(trip_id));

create policy expenses_select on expenses for select using (is_active_member(trip_id));
create policy expense_splits_select on expense_splits for select
  using (is_active_member((select trip_id from expenses where id = expense_id)));
create policy ledger_entries_select on ledger_entries for select
  using (is_active_member(trip_id));
create policy trip_invites_select on trip_invites for select
  using (is_active_member(trip_id));
```

## 4. RPC functions — the one place each rule lives

Every function below is `SECURITY DEFINER`, validates the caller against `auth.uid()`
internally, and is the *only* sanctioned way to make the corresponding change.

```sql
-- Creates a trip; the caller is its first active member AND gets a matching participants
-- row, so they're financially attributable from expense one.
create function create_trip(p_name text, p_currency text, p_settings jsonb default '{}')
returns uuid language plpgsql security definer as $$
declare v_trip_id uuid;
begin
  insert into trips (name, currency, settings, created_by)
  values (p_name, p_currency, p_settings, auth.uid())
  returning id into v_trip_id;

  insert into trip_members (trip_id, user_id, status)
  values (v_trip_id, auth.uid(), 'active');

  insert into participants (trip_id, type, linked_user_id, display_name, created_by)
  select v_trip_id, 'registered', auth.uid(), coalesce(display_name, 'You'), auth.uid()
  from profiles where id = auth.uid();

  return v_trip_id;
end; $$;

-- Any active member. A manually-added person with no account — see the claim logic in
-- join_trip_via_code for how this row gets linked to a real user later.
create function add_placeholder_participant(p_trip_id uuid, p_display_name text, p_phone text default null)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into participants (trip_id, type, display_name, phone, created_by)
  values (p_trip_id, 'placeholder', p_display_name, p_phone, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- 6-digit NUMERIC code (matches the app's 6-digit field — earlier drafts generated hex,
-- fixed here). No DB-level UNIQUE(code): at 1,000,000 combinations, "unique forever" would
-- eventually block valid new codes as old ones pile up expired-but-unrevoked, and Postgres
-- partial indexes can't express "while not yet expired" since now() isn't an immutable
-- predicate. Uniqueness is enforced among CURRENTLY VALID codes only, at generation time,
-- with a retry loop — this is exactly how Meet-style codes actually work: recycled, not
-- permanent.
create function generate_invite(p_trip_id uuid, p_expires_in interval default '24 hours', p_max_uses int default 1)
returns text language plpgsql security definer as $$
declare v_code text; v_attempts int := 0;
begin
  if not is_active_member(p_trip_id) then
    raise exception 'only trip members can generate an invite';
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

-- Validates code, expiry, revocation, and member cap. Also runs the CLAIM mechanism:
-- if a placeholder participant in this trip has a matching phone number, this join links
-- to that row instead of creating a fresh one — every expense/ledger row already
-- attributed to that placeholder becomes correctly attributed to the real account, with
-- no data migration, since nothing about the financial rows changes, only what they point to.
create function join_trip_via_code(p_code text, p_phone text default null)
returns uuid language plpgsql security definer as $$
declare v_invite trip_invites; v_member_count int; v_claimed_id uuid;
begin
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

  insert into trip_members (trip_id, user_id, status, joined_via_invite_id)
  values (v_invite.trip_id, auth.uid(), 'active', v_invite.id)
  on conflict (trip_id, user_id) do update
    set status = 'active', left_at = null, joined_via_invite_id = v_invite.id, joined_at = now();

  if p_phone is not null then
    update participants set linked_user_id = auth.uid(), type = 'registered', phone = p_phone
      where trip_id = v_invite.trip_id and type = 'placeholder' and phone = p_phone
      returning id into v_claimed_id;
  end if;

  if v_claimed_id is null then
    insert into participants (trip_id, type, linked_user_id, display_name, created_by)
    select v_invite.trip_id, 'registered', auth.uid(), coalesce(display_name, 'New member'), auth.uid()
    from profiles where id = auth.uid()
    on conflict (trip_id, linked_user_id) where linked_user_id is not null do nothing;
  end if;

  update trip_invites set use_count = use_count + 1 where id = v_invite.id;

  return v_invite.trip_id;
end; $$;

-- No remove_member function exists — see §2. Person who generated a specific invite can
-- undo THAT invite's join, only within an hour. Not power over the group.
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

-- The only other way membership ends: always self-initiated, always allowed.
create function leave_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  update trip_members set status = 'left', left_at = now()
  where trip_id = p_trip_id and user_id = auth.uid();
end; $$;

create function archive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  update trips set is_archived = true where id = p_trip_id;
end; $$;

create function unarchive_trip(p_trip_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  update trips set is_archived = false where id = p_trip_id;
end; $$;

-- Hard delete, only when it can't affect anyone else. Cascades via ON DELETE CASCADE.
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
  delete from trips where id = p_trip_id;
end; $$;

-- p_paid_by is a participant_id, not auth.uid() — lets any active member log an expense
-- as paid by themselves OR by a placeholder they're managing. Validated against the trip
-- so a participant_id from a different trip can't be passed in by mistake.
create function add_expense(
  p_trip_id uuid, p_paid_by uuid, p_description text, p_amount numeric, p_currency text,
  p_split_type text, p_split_config jsonb, p_category text default null
) returns uuid language plpgsql security definer as $$
declare v_expense_id uuid;
begin
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

  return v_expense_id;
end; $$;

-- Any active member may edit/delete ANY expense — the flat model, unconditionally.
create function edit_expense(
  p_expense_id uuid, p_description text, p_amount numeric, p_split_type text, p_split_config jsonb
) returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_currency text;
begin
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
end; $$;

create function delete_expense(p_expense_id uuid)
returns void language plpgsql security definer as $$
declare v_trip_id uuid; v_amount numeric; v_currency text;
begin
  select trip_id, amount, currency into v_trip_id, v_amount, v_currency from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then raise exception 'not permitted to delete this expense'; end if;

  update expenses set deleted_at = now() where id = p_expense_id;
  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by)
  values (v_trip_id, 'expense_deleted', p_expense_id, -v_amount, v_currency, auth.uid());
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
create function record_payment(p_trip_id uuid, p_to_participant uuid, p_amount numeric, p_currency text)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_from_participant uuid;
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;

  select id into v_from_participant from participants
    where trip_id = p_trip_id and linked_user_id = auth.uid();
  if v_from_participant is null then
    raise exception 'no participant record found for this trip';
  end if;

  insert into ledger_entries (trip_id, entry_type, from_participant, to_participant, amount, currency, created_by)
  values (p_trip_id, 'payment_recorded', v_from_participant, p_to_participant, p_amount, p_currency, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- The registered recipient confirms for themselves. A PLACEHOLDER recipient can't log in
-- to confirm anything — so any active member of the trip may confirm on their behalf,
-- same "any active member manages a placeholder" pattern as everywhere else.
create function confirm_payment(p_ledger_entry_id uuid)
returns uuid language plpgsql security definer as $$
declare v_entry ledger_entries; v_to_participant participants; v_id uuid;
begin
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
  return v_id;
end; $$;

create function generate_due_recurring_expenses()
returns void language plpgsql security definer as $$
declare v_template expense_templates;
begin
  for v_template in select * from expense_templates where is_active and next_run_date <= current_date loop
    perform add_expense(v_template.trip_id, v_template.paid_by, v_template.description,
      v_template.amount, v_template.currency, v_template.split_type, v_template.split_config);

    update expense_templates set next_run_date = case recurrence_rule
      when 'weekly' then next_run_date + interval '7 days'
      when 'monthly' then next_run_date + interval '1 month'
      when 'yearly' then next_run_date + interval '1 year'
    end
    where id = v_template.id;
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

## 5. Real-world scenarios this design was checked against

- **Someone tries to force-remove a member they disagree with.** Not possible — no such RPC.
- **Someone tries to delete a trip while others are still active.** `delete_trip` refuses
  and points at `archive_trip` instead.
- **A left member still has the app open offline.** Queued writes replay against RPCs that
  re-check `is_active_member` server-side.
- **Two people tap "confirm payment" at once.** Insert-only ledger rows, no race on shared
  state, worst case a UI-deduped double entry.
- **Someone deletes an expense already synced on another device.** Soft delete plus an
  offsetting ledger entry — every device converges regardless of sync order.
- **Invite code is revoked before its 24h expiry.** Fails immediately, doesn't wait out the timer.
- **A code is leaked and someone unwanted joins.** Caught within an hour + it was your own
  invite → clean undo via `revoke_recent_join`. Otherwise, no code-level fix — the group
  leaves and starts fresh.
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
