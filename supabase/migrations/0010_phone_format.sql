-- 0009_input_limits.sql's participants_phone_format allowed general E.164 (8-15 digits
-- after a leading +). The app was changed to only ever collect a 10-digit local number
-- with no typed prefix, silently prepending +91 before it's stored anywhere (see
-- COUNTRY_CODE / toE164() in apps/mobile/src/constants/limits.ts) -- so the stored
-- value is always exactly "+91" followed by 10 digits, never anything looser. Replacing
-- the constraint to match exactly, rather than leaving the old, wider one in place
-- alongside a narrower client-side check.
--
-- Dropped and re-added rather than editing 0009 in place, since that migration may
-- already be applied against the real project -- this is the safe way to change a
-- constraint's definition regardless of whether the old one was ever validated.

alter table participants
  drop constraint if exists participants_phone_format;

alter table participants
  add constraint participants_phone_format
    check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$') not valid;
