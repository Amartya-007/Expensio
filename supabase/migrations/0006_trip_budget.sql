-- Adds the budget-tracking concept TripSpend's Dashboard.tsx/TripDetails.tsx are built
-- around, which had no field anywhere on this side until now -- see
-- docs/architecture/expensio-ui-port-plan.md's "The budget concept" section for the full
-- history of that gap. Deliberately NOT porting `lockPreviousDays` (TripSpend's
-- lock-past-days-from-editing toggle) — a real but separate feature from budget tracking
-- itself, and not needed for calculateStats() (the actual burn-rate/days-remaining math)
-- to work. `peopleCount` also isn't stored: Expensio's participant list is already
-- dynamic (people can be added/removed after creation), so deriving the count live from
-- `participants` is more correct than TripSpend's fixed field, not a gap.

-- trip_activity_log's event_type check constraint (0002_core_schema.sql) didn't include
-- anything for this new kind of event -- without widening it, every update_trip_details
-- call below would fail on its own perform log_activity(...) line and roll back
-- everything the function did, including the trip UPDATE itself (an unhandled exception
-- inside a function aborts that whole invocation, not just the statement that raised it).
-- Found by actually calling update_trip_details after writing it, not by reading it --
-- the first attempt looked like it worked from the query results alone until a fresh
-- SELECT showed the update had never actually persisted.
alter table trip_activity_log drop constraint trip_activity_log_event_type_check;
alter table trip_activity_log add constraint trip_activity_log_event_type_check
  check (event_type in (
    'trip_created', 'trip_archived', 'trip_unarchived', 'trip_details_updated',
    'expense_added', 'expense_edited', 'expense_deleted',
    'payment_recorded', 'payment_confirmed',
    'member_joined', 'member_rejoined', 'member_left',
    'placeholder_added', 'placeholder_claimed',
    'invite_generated', 'invite_revoked', 'invite_join_undone',
    'display_name_changed', 'category_added'
  ));

alter table trips add column total_budget numeric(12, 2);

-- start_date/end_date already existed (0002_core_schema.sql) but nothing ever let a
-- client set them -- create_trip only ever accepted name/currency/settings. Extending it
-- (backward compatible: all three new params default to null, so the mobile app's
-- existing create_trip call is untouched) rather than requiring a second RPC call right
-- after creation just to set dates a trip will need immediately if it has a budget at all.
--
-- The drop is required, not optional: `create or replace` only replaces a function whose
-- parameter list matches exactly (same types, same order). Adding params in the middle
-- of the list makes this a different signature, so without the drop, Postgres would keep
-- BOTH the old 4-param and new 7-param create_trip as separate overloads -- and calling
-- it with the 2 truly-required args (name, currency) becomes ambiguous between them.
-- Caught by actually calling create_trip after applying this migration, not by reading it.
drop function if exists create_trip(text, text, jsonb, uuid);
create or replace function create_trip(
  p_name text, p_currency text, p_settings jsonb default '{}',
  p_start_date date default null, p_end_date date default null, p_total_budget numeric default null,
  p_client_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_trip_id uuid; v_claim record;
begin
  if p_client_request_id is not null then
    v_claim := claim_idempotency_key_with_result(p_client_request_id);
    if not v_claim.is_new then
      return (v_claim.found_result ->> 'trip_id')::uuid;
    end if;
  end if;

  insert into trips (name, currency, settings, start_date, end_date, total_budget, created_by)
  values (p_name, p_currency, p_settings, p_start_date, p_end_date, p_total_budget, auth.uid())
  returning id into v_trip_id;

  insert into trip_members (trip_id, user_id, status) values (v_trip_id, auth.uid(), 'active');
  -- coalesce, not a bare select: profiles.display_name starts out null for every user
  -- (handle_new_user in 0002_core_schema.sql inserts it that way unconditionally), and
  -- anonymous sign-in -- the app's actual entry point -- never sets it. Without this,
  -- create_trip crashes on participants' not-null display_name constraint for anyone
  -- creating their first trip before ever setting a name (i.e. almost everyone, since
  -- update_display_name is only ever called from the phone-verification flow). Found by
  -- actually running create_trip end-to-end while testing this migration, not by reading
  -- the code -- the fix is here because create_trip is the function that broke, but the
  -- root cause (handle_new_user's unconditional null) predates this migration entirely.
  insert into participants (trip_id, type, display_name, linked_user_id, created_by)
    values (v_trip_id, 'registered', coalesce((select display_name from profiles where id = auth.uid()), 'Trip creator'), auth.uid(), auth.uid());
  perform log_activity(v_trip_id, 'trip_created', 'created this trip');

  if p_client_request_id is not null then
    perform store_idempotent_result(p_client_request_id, jsonb_build_object('trip_id', v_trip_id));
  end if;

  return v_trip_id;
end; $$;

-- No general "edit trip" RPC existed at all before this -- name/dates/budget were
-- write-once at creation. TripSpend's TripDetails.tsx is precisely a budget/dates editor
-- screen, so this is the RPC that screen's eventual port will call. Every param defaults
-- to null and a null means "leave this field alone" (via coalesce), not "clear it" --
-- matching how a partial-update form naturally works (only send what changed), and
-- avoiding a footgun where omitting a param would blank out the trip's name.
create or replace function update_trip_details(
  p_trip_id uuid, p_name text default null, p_start_date date default null,
  p_end_date date default null, p_total_budget numeric default null,
  p_clear_budget boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_active_member(p_trip_id) then raise exception 'not an active member of this trip'; end if;
  update trips set
    name = coalesce(p_name, name),
    start_date = coalesce(p_start_date, start_date),
    end_date = coalesce(p_end_date, end_date),
    total_budget = case when p_clear_budget then null else coalesce(p_total_budget, total_budget) end,
    updated_at = now()
  where id = p_trip_id;
  perform log_activity(p_trip_id, 'trip_details_updated', 'updated trip details');
end; $$;
