-- Database-level input limits.
--
-- apps/mobile/src/constants/limits.ts is the client-side copy of these same numbers --
-- it drives maxLength props and pre-submit validation so the UI gives an immediate,
-- friendly error. But it runs on the device, so it cannot stop a request sent directly
-- to Supabase's REST/RPC endpoints with a valid session token (this app has no separate
-- backend sitting between the client and Postgres for writes -- see src/rpc.ts). These
-- CHECK constraints are the layer that actually cannot be bypassed: they're enforced by
-- Postgres itself regardless of what called it.
--
-- The two files are kept numerically in sync by hand. If a limit changes in one, it
-- must change in the other. Mapping (limits.ts key -> constraint here):
--   trip.name              -> trips_name_length
--   trip.budget            -> trips_budget_range
--   trip.dateMin/dateMax   -> trips_start_date_range, trips_end_date_range
--   participant.displayName -> participants_display_name_length
--   participant.phone      -> participants_phone_format (India-only: +91 + 10 digits,
--                              leading digit 6-9 -- matches COUNTRY_CODE/toE164() in
--                              limits.ts, which prepends +91 to whatever 10 digits the
--                              person typed before it's ever sent anywhere)
--   expense.description    -> expenses_description_length
--   expense.amount (upper) -> expenses_amount_max
--   category.name          -> custom_categories_name_length
--   comment.body           -> expense_comments_body_length
--   recurring.description  -> expense_templates_description_length
--   recurring.amount (upper) -> expense_templates_amount_max
--   phoneVerification.displayName -> profiles_display_name_length
--
-- Added as NOT VALID: enforced on every new insert/update from this point forward
-- without failing this migration if any pre-existing row (test data) already violates
-- one. Existing rows can be brought into compliance and each constraint validated for
-- real with `alter table ... validate constraint ...` once that's confirmed clean --
-- that step is intentionally not part of this migration.

alter table trips
  add constraint trips_name_length
    check (char_length(name) between 1 and 100) not valid,
  add constraint trips_budget_range
    check (total_budget is null or (total_budget > 0 and total_budget <= 100000000)) not valid,
  add constraint trips_start_date_range
    check (start_date is null or start_date between '2000-01-01' and '2100-12-31') not valid,
  add constraint trips_end_date_range
    check (end_date is null or end_date between '2000-01-01' and '2100-12-31') not valid;

alter table participants
  add constraint participants_display_name_length
    check (char_length(display_name) between 1 and 60) not valid,
  add constraint participants_phone_format
    check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$') not valid;

alter table expenses
  add constraint expenses_description_length
    check (char_length(description) between 1 and 200) not valid,
  add constraint expenses_amount_max
    check (amount <= 10000000) not valid;

alter table custom_categories
  add constraint custom_categories_name_length
    check (char_length(name) between 1 and 40) not valid;

alter table expense_comments
  add constraint expense_comments_body_length
    check (char_length(body) between 1 and 500) not valid;

alter table expense_templates
  add constraint expense_templates_description_length
    check (char_length(description) between 1 and 200) not valid,
  add constraint expense_templates_amount_max
    check (amount <= 10000000) not valid;

alter table profiles
  add constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 60) not valid;
