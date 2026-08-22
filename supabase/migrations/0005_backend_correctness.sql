-- Canonical money values in split_config are decimal currency units, represented as
-- JSON numbers or strings (for example "20.00"), and converted to integer minor units
-- only inside Postgres. Percentages and proportional units remain dimensionless numbers.
create function money_to_minor(p_value jsonb)
returns bigint language plpgsql immutable as $$
declare
  v_text text;
  v_value numeric;
begin
  if p_value is null or jsonb_typeof(p_value) not in ('number', 'string') then
    raise exception 'money value must be a JSON number or string';
  end if;

  v_text := trim(p_value #>> '{}');
  if v_text !~ '^-?[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'money value % must have at most two decimal places', v_text;
  end if;

  v_value := v_text::numeric;
  if abs(v_value) > 999999999999.99 then
    raise exception 'money value % is out of range', v_text;
  end if;
  return round(v_value * 100)::bigint;
end; $$;

create function validate_split_participant_map(
  p_trip_id uuid,
  p_values jsonb,
  p_allow_negative boolean default false
) returns void language plpgsql as $$
declare
  v_key text;
  v_value jsonb;
  v_participant_id uuid;
  v_minor bigint;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'split participant values must be a JSON object';
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_values) loop
    begin
      v_participant_id := v_key::uuid;
    exception when invalid_text_representation then
      raise exception 'split contains invalid participant id %', v_key;
    end;

    if not exists (
      select 1
      from participants p
      left join trip_members tm
        on tm.trip_id = p.trip_id and tm.user_id = p.linked_user_id
      where p.id = v_participant_id
        and p.trip_id = p_trip_id
        and (p.type = 'placeholder' or tm.status = 'active')
    ) then
      raise exception 'split contains an inactive or unknown participant %', v_key;
    end if;

    v_minor := money_to_minor(v_value);
    if not p_allow_negative and v_minor < 0 then
      raise exception 'split amount for participant % cannot be negative', v_key;
    end if;
  end loop;
end; $$;

create function validate_weight_map(p_trip_id uuid, p_values jsonb)
returns void language plpgsql as $$
declare
  v_key text;
  v_value numeric;
  v_participant_id uuid;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception 'split weights must be a non-empty JSON object';
  end if;

  for v_key, v_value in select key, value::numeric from jsonb_each_text(p_values) loop
    v_participant_id := v_key::uuid;
    if v_value <= 0 then
      raise exception 'split weight for participant % must be positive', v_key;
    end if;
    if not exists (
      select 1
      from participants p
      left join trip_members tm
        on tm.trip_id = p.trip_id and tm.user_id = p.linked_user_id
      where p.id = v_participant_id
        and p.trip_id = p_trip_id
        and (p.type = 'placeholder' or tm.status = 'active')
    ) then
      raise exception 'split contains an inactive or unknown participant %', v_key;
    end if;
  end loop;
end; $$;

create or replace function compute_expense_splits(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_expense expenses;
  v_total_minor bigint;
  v_shares jsonb := '{}'::jsonb;
  v_normalized jsonb := '{}'::jsonb;
  v_sum bigint;
  v_pct_sum numeric;
  v_units jsonb;
  v_key text;
  v_value jsonb;
  v_val bigint;
  v_item jsonb;
  v_item_amount_minor bigint;
  v_item_weights jsonb;
  v_item_shares jsonb;
  v_running jsonb := '{}'::jsonb;
  v_tax_minor bigint;
  v_tip_minor bigint;
  v_extra jsonb;
  v_adjustments jsonb := '{}'::jsonb;
  v_adj_total bigint := 0;
  v_remainder_minor bigint;
  v_remainder_weights jsonb;
  v_shared_by jsonb;
  v_exact_item_sum bigint;
  v_remainder_mode text;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if not found then
    raise exception 'expense % does not exist', p_expense_id;
  end if;

  v_total_minor := round(v_expense.amount * 100)::bigint;
  if v_total_minor <= 0 then
    raise exception 'expense amount must be positive';
  end if;

  delete from expense_splits where expense_id = p_expense_id;

  if v_expense.split_type = 'equal' then
    v_shares := distribute_proportionally(v_total_minor, trip_active_participant_weights(v_expense.trip_id));

  elsif v_expense.split_type = 'exact' then
    v_normalized := coalesce(v_expense.split_config -> 'shares', '{}'::jsonb);
    validate_split_participant_map(v_expense.trip_id, v_normalized);
    for v_key, v_value in select key, value from jsonb_each(v_normalized) loop
      v_val := money_to_minor(v_value);
      v_normalized := jsonb_set(v_normalized, array[v_key], to_jsonb(v_val), true);
    end loop;
    select coalesce(sum(value::bigint), 0) into v_sum from jsonb_each_text(v_normalized);
    if v_sum <> v_total_minor then
      raise exception 'exact shares (%) do not sum to the expense total (%)', v_sum, v_total_minor;
    end if;
    v_shares := v_normalized;

  elsif v_expense.split_type = 'percentage' then
    v_units := coalesce(v_expense.split_config -> 'shares', '{}'::jsonb);
    validate_weight_map(v_expense.trip_id, v_units);
    select sum(value::numeric) into v_pct_sum from jsonb_each_text(v_units);
    if v_pct_sum is distinct from 100 then
      raise exception 'percentages (%) do not sum to 100', v_pct_sum;
    end if;
    v_shares := distribute_proportionally(v_total_minor, v_units);

  elsif v_expense.split_type = 'shares' then
    v_units := coalesce(v_expense.split_config -> 'units', '{}'::jsonb);
    validate_weight_map(v_expense.trip_id, v_units);
    v_shares := distribute_proportionally(v_total_minor, v_units);

  elsif v_expense.split_type = 'adjustment' then
    v_normalized := coalesce(v_expense.split_config -> 'adjustments', '{}'::jsonb);
    validate_split_participant_map(v_expense.trip_id, v_normalized, true);
    for v_key, v_value in select key, value from jsonb_each(v_normalized) loop
      v_val := money_to_minor(v_value);
      v_normalized := jsonb_set(v_normalized, array[v_key], to_jsonb(v_val), true);
      v_adj_total := v_adj_total + v_val;
    end loop;
    v_remainder_minor := v_total_minor - v_adj_total;
    if v_remainder_minor < 0 then
      raise exception 'adjustments exceed the expense total';
    end if;

    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_remainder_weights
    from jsonb_each(trip_active_participant_weights(v_expense.trip_id))
    where not (v_normalized ? key);

    if v_remainder_weights = '{}'::jsonb then
      if v_remainder_minor <> 0 then
        raise exception 'adjustments must cover the full expense when no remainder participants exist';
      end if;
      v_shares := v_normalized;
    else
      v_remainder_mode := coalesce(v_expense.split_config ->> 'remainder', 'equal');
      if v_remainder_mode = 'shares' then
        v_units := coalesce(v_expense.split_config -> 'units', '{}'::jsonb);
        validate_weight_map(v_expense.trip_id, v_units);
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_units
        from jsonb_each(v_units)
        where v_remainder_weights ? key;
        if v_units = '{}'::jsonb then
          raise exception 'adjustment remainder shares must include an eligible participant';
        end if;
        v_shares := v_normalized || distribute_proportionally(v_remainder_minor, v_units);
      elsif v_remainder_mode = 'equal' then
        v_shares := v_normalized || distribute_proportionally(v_remainder_minor, v_remainder_weights);
      else
        raise exception 'adjustment remainder must be equal or shares';
      end if;
    end if;

  elsif v_expense.split_type = 'reimbursement' then
    if v_expense.split_config ->> 'reimburse_to' is null
       or (v_expense.split_config ->> 'reimburse_to')::uuid <> v_expense.paid_by then
      raise exception 'reimbursement target must match paid_by';
    end if;
    v_normalized := coalesce(v_expense.split_config -> 'shares', '{}'::jsonb);
    validate_split_participant_map(v_expense.trip_id, v_normalized);
    for v_key, v_value in select key, value from jsonb_each(v_normalized) loop
      v_val := money_to_minor(v_value);
      v_normalized := jsonb_set(v_normalized, array[v_key], to_jsonb(v_val), true);
    end loop;
    select coalesce(sum(value::bigint), 0) into v_sum from jsonb_each_text(v_normalized);
    if v_sum <> v_total_minor then
      raise exception 'reimbursement shares (%) do not sum to the expense total (%)', v_sum, v_total_minor;
    end if;
    v_shares := v_normalized;

  elsif v_expense.split_type = 'itemized' then
    if jsonb_typeof(v_expense.split_config -> 'items') <> 'array'
       or jsonb_array_length(v_expense.split_config -> 'items') = 0 then
      raise exception 'itemized split requires at least one item';
    end if;

    for v_item in select value from jsonb_array_elements(v_expense.split_config -> 'items') loop
      if jsonb_typeof(v_item -> 'amounts') = 'object' then
        v_item_amount_minor := money_to_minor(v_item -> 'amount');
        validate_split_participant_map(v_expense.trip_id, v_item -> 'amounts');
        v_item_shares := '{}'::jsonb;
        for v_key, v_value in select key, value from jsonb_each(v_item -> 'amounts') loop
          v_val := money_to_minor(v_value);
          v_item_shares := jsonb_set(v_item_shares, array[v_key], to_jsonb(v_val), true);
        end loop;
        select coalesce(sum(value::bigint), 0) into v_exact_item_sum from jsonb_each_text(v_item_shares);
        if v_exact_item_sum <> v_item_amount_minor then
          raise exception 'item exact amounts do not sum to the item amount';
        end if;
      else
        v_item_amount_minor := money_to_minor(v_item -> 'amount');
        v_shared_by := coalesce(v_item -> 'shared_by', '[]'::jsonb);
        if jsonb_typeof(v_shared_by) <> 'array' or jsonb_array_length(v_shared_by) = 0 then
          raise exception 'each item must have at least one shared_by participant';
        end if;
        if jsonb_array_length(v_shared_by) <> (
          select count(distinct value) from jsonb_array_elements_text(v_shared_by)
        ) then
          raise exception 'an item cannot list the same participant twice';
        end if;
        select coalesce(jsonb_object_agg(elem, 1), '{}'::jsonb) into v_item_weights
        from jsonb_array_elements_text(v_shared_by) as elem;
        validate_weight_map(v_expense.trip_id, v_item_weights);
        v_item_shares := distribute_proportionally(v_item_amount_minor, v_item_weights);
      end if;

      for v_key, v_val in select key, value::bigint from jsonb_each_text(v_item_shares) loop
        v_running := jsonb_set(
          v_running,
          array[v_key],
          to_jsonb(coalesce((v_running ->> v_key)::bigint, 0) + v_val),
          true
        );
      end loop;
    end loop;

    v_tax_minor := money_to_minor(coalesce(v_expense.split_config -> 'tax', '0'::jsonb));
    v_tip_minor := money_to_minor(coalesce(v_expense.split_config -> 'tip', '0'::jsonb));
    if v_tax_minor < 0 or v_tip_minor < 0 then
      raise exception 'tax and tip cannot be negative';
    end if;
    v_shares := v_running;
    if v_tax_minor + v_tip_minor > 0 then
      v_extra := distribute_proportionally(v_tax_minor + v_tip_minor, v_running);
      for v_key, v_val in select key, value::bigint from jsonb_each_text(v_extra) loop
        v_shares := jsonb_set(
          v_shares,
          array[v_key],
          to_jsonb(coalesce((v_shares ->> v_key)::bigint, 0) + v_val),
          true
        );
      end loop;
    end if;
    select coalesce(sum(value::bigint), 0) into v_sum from jsonb_each_text(v_shares);
    if v_sum <> v_total_minor then
      raise exception 'itemized amounts, tax, and tip do not sum to the expense total';
    end if;

  else
    raise exception 'compute_expense_splits: unknown split_type %', v_expense.split_type;
  end if;

  validate_split_participant_map(v_expense.trip_id, v_shares);
  for v_key, v_val in select key, value::bigint from jsonb_each_text(v_shares) loop
    if v_val < 0 then
      raise exception 'computed share for participant % cannot be negative', v_key;
    end if;
    insert into expense_splits (expense_id, participant_id, share_amount)
    values (p_expense_id, v_key::uuid, v_val::numeric / 100.0);
  end loop;
end; $$;

create or replace view trip_balances as
with movements as (
  select trip_id, from_participant as participant_id, currency, -sum(amount) as balance_delta
  from ledger_entries
  where from_participant is not null
    and entry_type in ('expense_added', 'expense_edited', 'expense_deleted', 'payment_recorded', 'payment_disputed')
  group by trip_id, from_participant, currency
  union all
  select trip_id, to_participant as participant_id, currency, sum(amount) as balance_delta
  from ledger_entries
  where to_participant is not null
    and entry_type in ('expense_added', 'expense_edited', 'expense_deleted', 'payment_recorded', 'payment_disputed')
  group by trip_id, to_participant, currency
)
select trip_id, participant_id, currency, sum(balance_delta) as balance_delta
from movements
group by trip_id, participant_id, currency;

create function insert_expense_ledger_entries(
  p_expense_id uuid,
  p_entry_type text,
  p_created_by uuid,
  p_total_amount numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_expense expenses;
  v_split expense_splits;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if not found then
    raise exception 'expense % does not exist', p_expense_id;
  end if;

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by, metadata)
  values (
    v_expense.trip_id, p_entry_type, p_expense_id, p_total_amount,
    v_expense.currency, p_created_by, jsonb_build_object('role', 'expense_total')
  );

  for v_split in select * from expense_splits where expense_id = p_expense_id loop
    if v_split.participant_id <> v_expense.paid_by then
      insert into ledger_entries (
        trip_id, entry_type, expense_id, from_participant, to_participant,
        amount, currency, created_by, metadata
      ) values (
        v_expense.trip_id, p_entry_type, p_expense_id, v_split.participant_id,
        v_expense.paid_by, v_split.share_amount, v_expense.currency, p_created_by,
        jsonb_build_object('role', 'split_transfer')
      );
    end if;
  end loop;
end; $$;

create function reverse_expense_ledger_entries(
  p_expense_id uuid,
  p_entry_type text,
  p_created_by uuid,
  p_total_amount numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_expense expenses;
  v_split expense_splits;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if not found then
    raise exception 'expense % does not exist', p_expense_id;
  end if;

  insert into ledger_entries (trip_id, entry_type, expense_id, amount, currency, created_by, metadata)
  values (
    v_expense.trip_id, p_entry_type, p_expense_id, -p_total_amount,
    v_expense.currency, p_created_by, jsonb_build_object('role', 'expense_total_reversal')
  );

  for v_split in select * from expense_splits where expense_id = p_expense_id loop
    if v_split.participant_id <> v_expense.paid_by then
      insert into ledger_entries (
        trip_id, entry_type, expense_id, from_participant, to_participant,
        amount, currency, created_by, metadata
      ) values (
        v_expense.trip_id, p_entry_type, p_expense_id, v_split.participant_id,
        v_expense.paid_by, -v_split.share_amount, v_expense.currency, p_created_by,
        jsonb_build_object('role', 'split_transfer_reversal')
      );
    end if;
  end loop;
end; $$;

-- Backfill current, non-deleted expense shares created before the participant-aware
-- ledger entries existed. The old aggregate rows remain as historical audit records.
-- The migration_backfill metadata flag prevents this repair from notifying users about
-- expenses that already existed before the notification queue was installed.
do $$
declare
  v_expense expenses;
  v_split expense_splits;
begin
  for v_expense in select * from expenses where deleted_at is null loop
    if not exists (
      select 1 from ledger_entries
      where expense_id = v_expense.id
        and metadata ->> 'role' = 'split_transfer'
    ) then
      for v_split in select * from expense_splits where expense_id = v_expense.id loop
        if v_split.participant_id <> v_expense.paid_by then
          insert into ledger_entries (
            trip_id, entry_type, expense_id, from_participant, to_participant,
            amount, currency, created_by, metadata
          ) values (
            v_expense.trip_id, 'expense_added', v_expense.id, v_split.participant_id,
            v_expense.paid_by, v_split.share_amount, v_expense.currency, v_expense.created_by,
            jsonb_build_object('role', 'migration_backfill')
          );
        end if;
      end loop;
    end if;
  end loop;
end; $$;

create or replace function add_expense(
  p_trip_id uuid,
  p_paid_by uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_split_type text,
  p_split_config jsonb,
  p_category text default null,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_expense_id uuid;
  v_claim record;
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
  if p_amount <= 0 then
    raise exception 'expense amount must be positive';
  end if;
  if not exists (
    select 1 from participants
    where id = p_paid_by and trip_id = p_trip_id
      and (type = 'placeholder' or exists (
        select 1 from trip_members tm
        where tm.trip_id = p_trip_id and tm.user_id = linked_user_id and tm.status = 'active'
      ))
  ) then
    raise exception 'paid_by must be an active participant of this trip';
  end if;

  insert into expenses (trip_id, description, amount, currency, paid_by, category, split_type, split_config, created_by)
  values (p_trip_id, p_description, p_amount, p_currency, p_paid_by, p_category, p_split_type, p_split_config, auth.uid())
  returning id into v_expense_id;

  perform compute_expense_splits(v_expense_id);
  perform insert_expense_ledger_entries(v_expense_id, 'expense_added', auth.uid(), p_amount);
  perform log_activity(
    p_trip_id,
    'expense_added',
    format('added an expense: %s (%s %s)', p_description, p_currency, p_amount),
    p_paid_by
  );

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('expense_id', v_expense_id));
  end if;
  return v_expense_id;
end; $$;

create or replace function edit_expense(
  p_expense_id uuid,
  p_description text,
  p_amount numeric,
  p_split_type text,
  p_split_config jsonb,
  p_client_request_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_trip_id uuid;
  v_currency text;
  v_old_amount numeric;
  v_deleted_at timestamptz;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return;
  end if;
  select trip_id, currency, amount, deleted_at
    into v_trip_id, v_currency, v_old_amount, v_deleted_at
  from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to edit this expense';
  end if;
  if v_deleted_at is not null then
    raise exception 'cannot edit a deleted expense';
  end if;
  if p_amount <= 0 then
    raise exception 'expense amount must be positive';
  end if;

  perform reverse_expense_ledger_entries(p_expense_id, 'expense_edited', auth.uid(), v_old_amount);

  update expenses
  set description = p_description,
      amount = p_amount,
      split_type = p_split_type,
      split_config = p_split_config,
      updated_at = now()
  where id = p_expense_id;

  perform compute_expense_splits(p_expense_id);
  perform insert_expense_ledger_entries(p_expense_id, 'expense_edited', auth.uid(), p_amount);
  insert into expense_comments (expense_id, user_id, comment_type, body)
  values (p_expense_id, auth.uid(), 'system', format('changed the amount to %s %s', v_currency, p_amount));
  perform log_activity(v_trip_id, 'expense_edited', format('edited an expense: %s', p_description));
end; $$;

create or replace function delete_expense(
  p_expense_id uuid,
  p_client_request_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_trip_id uuid;
  v_amount numeric;
  v_description text;
  v_deleted_at timestamptz;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return;
  end if;
  select trip_id, amount, description, deleted_at
    into v_trip_id, v_amount, v_description, v_deleted_at
  from expenses where id = p_expense_id;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to delete this expense';
  end if;
  if v_deleted_at is not null then
    raise exception 'expense is already deleted';
  end if;

  perform reverse_expense_ledger_entries(p_expense_id, 'expense_deleted', auth.uid(), v_amount);
  update expenses set deleted_at = now() where id = p_expense_id;
  perform log_activity(v_trip_id, 'expense_deleted', format('deleted an expense: %s', v_description));
end; $$;

create or replace function record_payment(
  p_trip_id uuid,
  p_to_participant uuid,
  p_amount numeric,
  p_currency text,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_from_participant uuid;
begin
  if p_client_request_id is not null then
    if not claim_idempotency_key(p_client_request_id) then
      return null;
    end if;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  if p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  if not exists (
    select 1 from participants
    where id = p_to_participant and trip_id = p_trip_id
  ) then
    raise exception 'payment recipient must be a participant of this trip';
  end if;

  select id into v_from_participant
  from participants
  where trip_id = p_trip_id and linked_user_id = auth.uid();
  if v_from_participant is null then
    raise exception 'no participant record found for this trip';
  end if;

  insert into ledger_entries (
    trip_id, entry_type, from_participant, to_participant, amount, currency, created_by, metadata
  ) values (
    p_trip_id, 'payment_recorded', v_from_participant, p_to_participant,
    p_amount, p_currency, auth.uid(), jsonb_build_object('financial_effect', true)
  ) returning id into v_id;

  perform log_activity(
    p_trip_id,
    'payment_recorded',
    format('recorded a payment of %s %s', p_currency, p_amount),
    p_to_participant
  );
  return v_id;
end; $$;

create or replace function confirm_payment(
  p_ledger_entry_id uuid,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entry ledger_entries;
  v_to_participant participants;
  v_id uuid;
begin
  if p_client_request_id is not null then
    if not claim_idempotency_key(p_client_request_id) then
      return null;
    end if;
  end if;
  select * into v_entry
  from ledger_entries
  where id = p_ledger_entry_id and entry_type = 'payment_recorded';
  if v_entry is null then
    raise exception 'payment entry does not exist or is not confirmable';
  end if;
  if exists (
    select 1 from ledger_entries
    where entry_type = 'payment_confirmed'
      and metadata ->> 'confirms' = p_ledger_entry_id::text
  ) then
    raise exception 'payment is already confirmed';
  end if;

  select * into v_to_participant from participants where id = v_entry.to_participant;
  if v_to_participant.linked_user_id is not null then
    if v_to_participant.linked_user_id <> auth.uid() then
      raise exception 'only the recipient can confirm this payment';
    end if;
  elsif not is_active_member(v_entry.trip_id) then
    raise exception 'not an active member of this trip';
  end if;

  insert into ledger_entries (
    trip_id, entry_type, from_participant, to_participant, amount, currency, created_by, metadata
  ) values (
    v_entry.trip_id, 'payment_confirmed', v_entry.from_participant, v_entry.to_participant,
    0, v_entry.currency, auth.uid(),
    jsonb_build_object('confirms', p_ledger_entry_id, 'financial_effect', false)
  ) returning id into v_id;

  perform log_activity(v_entry.trip_id, 'payment_confirmed', 'confirmed a payment received');
  return v_id;
end; $$;

create or replace function create_expense_template(
  p_trip_id uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_paid_by uuid,
  p_split_type text,
  p_split_config jsonb,
  p_recurrence_rule text,
  p_next_run_date date,
  p_category text default null,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_client_request_id is not null and not claim_idempotency_key(p_client_request_id) then
    return null;
  end if;
  if not is_active_member(p_trip_id) then
    raise exception 'not an active member of this trip';
  end if;
  if p_amount <= 0 then
    raise exception 'template amount must be positive';
  end if;
  if p_recurrence_rule not in ('weekly', 'monthly', 'yearly') then
    raise exception 'recurrence rule must be weekly, monthly, or yearly';
  end if;
  if not exists (select 1 from participants where id = p_paid_by and trip_id = p_trip_id) then
    raise exception 'paid_by must be a participant of this trip';
  end if;

  insert into expense_templates (
    trip_id, description, amount, currency, paid_by, category, split_type,
    split_config, recurrence_rule, next_run_date, created_by
  ) values (
    p_trip_id, p_description, p_amount, p_currency, p_paid_by, p_category, p_split_type,
    p_split_config, p_recurrence_rule, p_next_run_date, auth.uid()
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function update_expense_template(
  p_template_id uuid,
  p_description text,
  p_amount numeric,
  p_paid_by uuid,
  p_split_type text,
  p_split_config jsonb,
  p_recurrence_rule text,
  p_next_run_date date,
  p_category text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from expense_templates where id = p_template_id and is_active;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to edit this template';
  end if;
  if p_amount <= 0 or p_recurrence_rule not in ('weekly', 'monthly', 'yearly') then
    raise exception 'invalid recurring template values';
  end if;
  if not exists (select 1 from participants where id = p_paid_by and trip_id = v_trip_id) then
    raise exception 'paid_by must be a participant of this trip';
  end if;
  update expense_templates
  set description = p_description,
      amount = p_amount,
      paid_by = p_paid_by,
      category = p_category,
      split_type = p_split_type,
      split_config = p_split_config,
      recurrence_rule = p_recurrence_rule,
      next_run_date = p_next_run_date
  where id = p_template_id;
end; $$;

create or replace function delete_expense_template(p_template_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from expense_templates where id = p_template_id and is_active;
  if not is_active_member(v_trip_id) then
    raise exception 'not permitted to delete this template';
  end if;
  update expense_templates set is_active = false where id = p_template_id;
end; $$;

-- These helpers are implementation details. Callers use the public RPCs above; exposing
-- the SECURITY DEFINER helpers directly would allow arbitrary split recomputation or
-- ledger writes outside the membership and validation checks.
revoke execute on function compute_expense_splits(uuid) from public, anon, authenticated;
revoke execute on function insert_expense_ledger_entries(uuid, text, uuid, numeric)
  from public, anon, authenticated;
revoke execute on function reverse_expense_ledger_entries(uuid, text, uuid, numeric)
  from public, anon, authenticated;
