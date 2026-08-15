-- ============================================================================
-- Expensio — RLS policies + RPCs
--
-- Transcribed from docs/architecture/expensio-permissions-matrix.md, with
-- three substantive additions beyond a straight transcription:
--
-- 1. compute_expense_splits — referenced by name throughout the doc's RPCs
--    but its body was never written down anywhere, only the rounding RULES
--    in prose (expensio-data-model.md, "compute_expense_splits" section).
--    Implemented here from those rules. See its own comment block below for
--    which parts are a direct transcription of the rule vs. a judgment call
--    the doc left open (equal-split membership, adjustment's remainder
--    weighting, itemized's per-item exact-amount variant).
--
-- 2. The idempotent-replay-returns-null gap flagged during the design
--    review: every RPC that returns an id/code returned NULL on a replayed
--    call, even though several callers (create_trip, generate_invite,
--    join_trip_via_code, add_placeholder_participant, add_custom_category,
--    add_expense, record_payment, confirm_payment) need the original result
--    back, not just confirmation it happened. claim_idempotency_key and
--    claim_idempotency_key_with_result below store and replay the actual
--    result via processed_requests.result (0002's schema addition) instead.
--
-- 3. join_trip_via_code's ON CONFLICT clause needs participants.linked_user_id
--    to be a real unique constraint target, and (trip_id, linked_user_id) is
--    only a PARTIAL unique index (0002_core_schema.sql, "where linked_user_id
--    is not null") — Postgres allows ON CONFLICT against a partial unique
--    index directly, so no schema change was needed, but it's worth noting
--    explicitly since it's easy to assume otherwise.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1: shared infrastructure
-- ----------------------------------------------------------------------------

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

-- Idempotency check for offline-replayed calls. Returns true the first time a given key is
-- seen (and records it), false on any repeat. Kept for RPCs with nothing to return
-- (leave_trip, edit_expense, delete_expense, revoke_invite, revoke_recent_join,
-- archive_trip, unarchive_trip) — see claim_idempotency_key_with_result below for the ones
-- that DO need their original result back on replay.
create function claim_idempotency_key(p_key uuid)
returns boolean language plpgsql security definer as $$
begin
  insert into processed_requests (client_request_id) values (p_key);
  return true;
exception when unique_violation then
  return false;
end; $$;

-- Fix for the "returns null on replay" gap: p_found_result is set (via OUT-style inout
-- param) to the ORIGINAL call's stored result when this is a replay, so the caller can
-- return that instead of null. On first call, records nothing yet — the caller stores its
-- own result once it has one, via store_idempotent_result below.
create function claim_idempotency_key_with_result(p_key uuid, out is_new boolean, out found_result jsonb)
returns record language plpgsql security definer as $$
begin
  insert into processed_requests (client_request_id) values (p_key);
  is_new := true;
  found_result := null;
exception when unique_violation then
  is_new := false;
  select result into found_result from processed_requests where client_request_id = p_key;
end; $$;

create function store_idempotent_result(p_key uuid, p_result jsonb)
returns void language sql security definer as $$
  update processed_requests set result = p_result where client_request_id = p_key;
$$;

-- ----------------------------------------------------------------------------
-- compute_expense_splits — never given an actual body anywhere in the docs,
-- only the rounding rules in prose. Implemented from those rules; judgment
-- calls the doc left open are called out inline.
-- ----------------------------------------------------------------------------

-- Shared rounding core used by every split type below: proportional allocation
-- in integer minor units, remainder given one unit at a time to participants
-- in ascending participant_id order — deterministic, not arbitrary, per the
-- doc's stated rule. p_weights is {participant_id: weight}; weights don't need
-- to sum to anything in particular, only be positive.
create function distribute_proportionally(p_total_minor bigint, p_weights jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_weight_sum numeric;
  v_result jsonb := '{}'::jsonb;
  v_allocated bigint := 0;
  v_key text; v_w numeric; v_share bigint;
  v_remainder bigint;
  v_ordered uuid[];
  v_pid uuid;
  v_i int;
begin
  select sum(value::numeric) into v_weight_sum from jsonb_each_text(p_weights);
  if v_weight_sum is null or v_weight_sum <= 0 then
    raise exception 'distribute_proportionally: weights must sum to a positive number';
  end if;

  for v_key, v_w in select key, value::numeric from jsonb_each_text(p_weights) loop
    v_share := floor(p_total_minor * v_w / v_weight_sum)::bigint;
    v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_share));
    v_allocated := v_allocated + v_share;
  end loop;

  v_remainder := p_total_minor - v_allocated;
  select array_agg(key::uuid order by key::uuid) into v_ordered from jsonb_each_text(p_weights);

  v_i := 0;
  while v_remainder > 0 loop
    v_pid := v_ordered[1 + (v_i % array_length(v_ordered, 1))];
    v_result := jsonb_set(v_result, array[v_pid::text],
      to_jsonb((v_result ->> v_pid::text)::bigint + 1));
    v_remainder := v_remainder - 1;
    v_i := v_i + 1;
  end loop;

  return v_result;
end; $$;

-- Judgment call #1 (doc leaves this open): who counts for a plain 'equal'
-- split with no explicit participant list? Read as "every participant
-- currently attached to the trip" — every placeholder (they never leave) plus
-- every registered participant whose trip_members.status is still 'active'.
-- A left member's own historical splits are untouched (expense_splits rows
-- aren't retroactively edited), this only affects what NEW equal-split
-- expenses divide across.
create function trip_active_participant_weights(p_trip_id uuid)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(p.id::text, 1), '{}'::jsonb)
  from participants p
  left join trip_members tm on tm.trip_id = p.trip_id and tm.user_id = p.linked_user_id
  where p.trip_id = p_trip_id
    and (p.type = 'placeholder' or tm.status = 'active');
$$;

create function compute_expense_splits(p_expense_id uuid)
returns void language plpgsql security definer as $$
declare
  v_expense expenses;
  v_total_minor bigint;
  v_shares jsonb;
  v_sum bigint;
  v_pct_sum numeric;
  v_pid text; v_val bigint;
  v_item jsonb;
  v_item_amount_minor bigint;
  v_item_weights jsonb;
  v_item_shares jsonb;
  v_running jsonb := '{}'::jsonb;
  v_tax_minor bigint;
  v_tip_minor bigint;
  v_extra jsonb;
  v_adjustments jsonb;
  v_adj_total bigint;
  v_remainder_minor bigint;
  v_remainder_weights jsonb;
begin
  select * into v_expense from expenses where id = p_expense_id;
  -- All currencies this project supports use 2 decimal minor units (paise/cents)
  -- — see expensio-trip-creation-flow.md's currency list. If a zero-decimal
  -- currency is ever added, this multiplier needs to become currency-aware.
  v_total_minor := round(v_expense.amount * 100)::bigint;

  delete from expense_splits where expense_id = p_expense_id;

  if v_expense.split_type = 'equal' then
    v_shares := distribute_proportionally(v_total_minor, trip_active_participant_weights(v_expense.trip_id));

  elsif v_expense.split_type = 'exact' then
    v_shares := coalesce(v_expense.split_config -> 'shares', '{}'::jsonb);
    select sum(value::bigint) into v_sum from jsonb_each_text(v_shares);
    if v_sum is distinct from v_total_minor then
      raise exception 'exact shares (%) do not sum to the expense total (%)', v_sum, v_total_minor;
    end if;

  elsif v_expense.split_type = 'percentage' then
    select sum(value::numeric) into v_pct_sum from jsonb_each_text(coalesce(v_expense.split_config -> 'shares', '{}'::jsonb));
    if v_pct_sum is distinct from 100 then
      raise exception 'percentages (%) do not sum to 100', v_pct_sum;
    end if;
    v_shares := distribute_proportionally(v_total_minor, v_expense.split_config -> 'shares');

  elsif v_expense.split_type = 'shares' then
    v_shares := distribute_proportionally(v_total_minor, v_expense.split_config -> 'units');

  elsif v_expense.split_type = 'adjustment' then
    -- Judgment call #2: "rest splits the remainder equally (or by units, per
    -- split_config)" — the doc doesn't specify the exact key for a units
    -- variant here, so only the equal-remainder path is implemented. A
    -- units-weighted remainder would reuse distribute_proportionally the same
    -- way 'shares' does above; add a split_config['remainder_units'] branch
    -- if/when that variant is actually needed.
    v_adjustments := coalesce(v_expense.split_config -> 'adjustments', '{}'::jsonb);
    select coalesce(sum(value::bigint), 0) into v_adj_total from jsonb_each_text(v_adjustments);
    v_remainder_minor := v_total_minor - v_adj_total;

    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_remainder_weights
    from jsonb_each(trip_active_participant_weights(v_expense.trip_id))
    where not (v_adjustments ? key);

    if v_remainder_weights = '{}'::jsonb then
      v_shares := v_adjustments;
    else
      v_shares := v_adjustments || distribute_proportionally(v_remainder_minor, v_remainder_weights);
    end if;

  elsif v_expense.split_type = 'reimbursement' then
    v_shares := coalesce(v_expense.split_config -> 'shares', '{}'::jsonb);
    select sum(value::bigint) into v_sum from jsonb_each_text(v_shares);
    if v_sum is distinct from v_total_minor then
      raise exception 'reimbursement shares (%) do not sum to the expense total (%)', v_sum, v_total_minor;
    end if;

  elsif v_expense.split_type = 'itemized' then
    -- Judgment call #3: the doc's split_config shape for itemized shows only
    -- equal shared_by splitting per item ("shared_by": ["pid1","pid2"]) — an
    -- item with its OWN exact per-person breakdown isn't shown in the shape
    -- table, so it isn't handled here. Add it if a real item needs it.
    v_tax_minor := round(coalesce((v_expense.split_config ->> 'tax')::numeric, 0) * 100)::bigint;
    v_tip_minor := round(coalesce((v_expense.split_config ->> 'tip')::numeric, 0) * 100)::bigint;

    for v_item in select * from jsonb_array_elements(coalesce(v_expense.split_config -> 'items', '[]'::jsonb)) loop
      v_item_amount_minor := round((v_item ->> 'amount')::numeric * 100)::bigint;

      select coalesce(jsonb_object_agg(elem, 1), '{}'::jsonb) into v_item_weights
      from jsonb_array_elements_text(v_item -> 'shared_by') as elem;

      v_item_shares := distribute_proportionally(v_item_amount_minor, v_item_weights);

      for v_pid, v_val in select key, value::bigint from jsonb_each_text(v_item_shares) loop
        v_running := jsonb_set(v_running, array[v_pid], to_jsonb(coalesce((v_running ->> v_pid)::bigint, 0) + v_val));
      end loop;
    end loop;

    v_shares := v_running;
    -- Tax/tip allocated proportionally to each participant's running item
    -- subtotal, not split equally — someone who ordered more pays a
    -- proportionally bigger share of tax/tip too, per the doc's rule.
    if v_tax_minor > 0 or v_tip_minor > 0 then
      v_extra := distribute_proportionally(v_tax_minor + v_tip_minor, v_running);
      for v_pid, v_val in select key, value::bigint from jsonb_each_text(v_extra) loop
        v_shares := jsonb_set(v_shares, array[v_pid], to_jsonb(coalesce((v_shares ->> v_pid)::bigint, 0) + v_val));
      end loop;
    end if;

  else
    raise exception 'compute_expense_splits: unknown split_type %', v_expense.split_type;
  end if;

  for v_pid, v_val in select key, value::bigint from jsonb_each_text(v_shares) loop
    insert into expense_splits (expense_id, participant_id, share_amount)
    values (p_expense_id, v_pid::uuid, v_val::numeric / 100.0);
  end loop;
end; $$;

-- ----------------------------------------------------------------------------
-- §2: RLS
-- ----------------------------------------------------------------------------

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

create policy trip_members_select on trip_members for select
  using (is_active_member(trip_id));

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
-- people who ARE in it.
create policy trip_activity_log_select on trip_activity_log for select
  using (is_active_member(trip_id));

-- ----------------------------------------------------------------------------
-- §3: RPCs
--
-- Every state-changing one takes an optional p_client_request_id for
-- idempotent offline replay. Ones that RETURN something use
-- claim_idempotency_key_with_result + store_idempotent_result (so a replay
-- gets the original id/code back, not null); ones that return nothing
-- (void) use the simpler claim_idempotency_key.
-- ----------------------------------------------------------------------------

create function create_trip(
  p_name text, p_currency text, p_settings jsonb default '{}', p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_trip_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'trip_id')::uuid;
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('trip_id', v_trip_id));
  end if;
  return v_trip_id;
end; $$;

create function add_placeholder_participant(
  p_trip_id uuid, p_display_name text, p_phone text default null, p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'participant_id')::uuid;
    end if;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  begin
    insert into participants (trip_id, type, display_name, phone, created_by)
    values (p_trip_id, 'placeholder', p_display_name, p_phone, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'a placeholder with this phone number already exists in this trip';
  end;
  perform log_activity(p_trip_id, 'placeholder_added', format('added %s as a participant', p_display_name), v_id);

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('participant_id', v_id));
  end if;
  return v_id;
end; $$;

create function add_custom_category(p_trip_id uuid, p_name text, p_icon text, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'category_id')::uuid;
    end if;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  insert into custom_categories (trip_id, name, icon, created_by)
  values (p_trip_id, p_name, p_icon, auth.uid())
  returning id into v_id;
  perform log_activity(p_trip_id, 'category_added', format('added a custom category: %s', p_name));

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('category_id', v_id));
  end if;
  return v_id;
end; $$;

-- Not idempotency-wrapped — the actual file upload to Supabase Storage is what a retry
-- would repeat, and that's a separate step the client controls; recording the same
-- storage_path twice is a harmless duplicate row, not a duplicated side effect.
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

create function generate_invite(
  p_trip_id uuid, p_expires_in interval default '24 hours', p_max_uses int default 1,
  p_client_request_id uuid default null
) returns text language plpgsql security definer as $$
declare v_code text; v_attempts int := 0; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return v_claim.found_result ->> 'code';
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('code', v_code));
  end if;
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

-- Validates code, expiry, revocation, and member cap. The claim mechanism uses the
-- CALLER'S OWN VERIFIED phone from their JWT, never a client-supplied parameter — a
-- client-passed phone would let anyone claim someone else's placeholder just by knowing
-- (or guessing) their number.
create function join_trip_via_code(p_code text, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_invite trip_invites; v_member_count int; v_claimed_id uuid;
declare v_verified_phone text; v_was_previously_member boolean; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'trip_id')::uuid;
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('trip_id', v_invite.trip_id));
  end if;
  return v_invite.trip_id;
end; $$;

-- No remove_member function exists, deliberately. Person who generated a specific invite
-- can undo THAT invite's join, only within an hour. Not power over the group.
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

-- SOFT-HIDE, not a real DELETE. A true hard delete would cascade-destroy
-- trip_activity_log along with everything else, directly contradicting "immutable" the
-- moment someone hit this button. Only allowed when the caller is the sole remaining
-- active member.
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
-- as paid by themselves OR by a placeholder they're managing.
create function add_expense(
  p_trip_id uuid, p_paid_by uuid, p_description text, p_amount numeric, p_currency text,
  p_split_type text, p_split_config jsonb, p_category text default null, p_client_request_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_expense_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'expense_id')::uuid;
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('expense_id', v_expense_id));
  end if;
  return v_expense_id;
end; $$;

-- Any active member may edit/delete ANY expense — the flat model, unconditionally.
-- Deliberately does NOT block editing an expense a payment has already been recorded
-- against — balances are derived by summing ledger_entries, so an edit's offsetting entry
-- keeps the math correct regardless of payment history.
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
declare v_id uuid; v_from_participant uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'ledger_entry_id')::uuid;
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('ledger_entry_id', v_id));
  end if;
  return v_id;
end; $$;

-- The registered recipient confirms for themselves. A PLACEHOLDER recipient can't log in
-- to confirm anything — so any active member of the trip may confirm on their behalf.
create function confirm_payment(p_ledger_entry_id uuid, p_client_request_id uuid default null)
returns uuid language plpgsql security definer as $$
declare v_entry ledger_entries; v_to_participant participants; v_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'ledger_entry_id')::uuid;
    end if;
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

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('ledger_entry_id', v_id));
  end if;
  return v_id;
end; $$;

-- Idempotent by construction, not just by the shared key mechanism: next_run_date only
-- advances AFTER a template successfully generates its expense, and the unique index on
-- (source_template_id, expense_date) means even a genuine double-run of this scheduled job
-- can't create two expenses for the same template on the same day.
create function generate_due_recurring_expenses()
returns void language plpgsql security definer as $$
declare v_template expense_templates;
begin
  for v_template in select * from expense_templates where is_active and next_run_date <= current_date loop
    begin
      perform add_expense(v_template.trip_id, v_template.paid_by, v_template.description,
        v_template.amount, v_template.currency, v_template.split_type, v_template.split_config);
    exception when unique_violation then
      continue;
    end;

    update expense_templates set next_run_date = case recurrence_rule
      when 'weekly' then next_run_date + interval '7 days'
      when 'monthly' then next_run_date + interval '1 month'
      when 'yearly' then next_run_date + interval '1 year'
    end
    where id = v_template.id;
  end loop;
end; $$;

-- Cross-trip fan-out: a display name is a global profiles field, but the log is
-- trip-scoped, so a name change gets one log entry in every trip the person is currently
-- an active member of.
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
-- name through profiles, so nothing here needs to touch participants at all.
create function delete_account()
returns void language plpgsql security definer as $$
begin
  update profiles set display_name = 'Deleted user', avatar_url = null, deleted_at = now()
  where id = auth.uid();
end; $$;
