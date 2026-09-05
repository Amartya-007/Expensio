/**
 * Single source of truth for every input limit in the app.
 *
 * Every screen with a form field imports its numbers from LIMITS and its checks from
 * the validate* functions below, instead of hardcoding a maxLength or writing its own
 * range check. To change a limit app-wide, change it here.
 *
 * IMPORTANT — this file is the UX layer only, not the security boundary. It runs on
 * the device, so it can be bypassed by anyone calling supabase.rpc(...) directly with
 * a valid session token (no separate backend sits between this app and Postgres for
 * writes — see src/rpc.ts). The layer that actually cannot be bypassed is the set of
 * CHECK constraints in supabase/migrations/0009_input_limits.sql, which enforces the
 * same numbers at the database level regardless of what called it. The two are kept in
 * sync by hand: a limit changed here must be changed there too, and vice versa. Search
 * for "0009_input_limits" in that migration's header for the mapping.
 */

// India-only for now: people type just the 10-digit local number, no country code.
// Supabase's phone auth (and the stored value participants.phone gets matched against
// for the "auto-links when they join later" feature) still needs real E.164 underneath,
// so COUNTRY_CODE gets silently prepended before anything is sent anywhere. If this app
// ever supports other countries, this becomes a picker instead of a constant.
export const COUNTRY_CODE = '+91';

export function toE164(localDigits: string): string {
  return `${COUNTRY_CODE}${localDigits}`;
}

export const LIMITS = {
  trip: {
    name: { min: 1, max: 100 },
    budget: { min: 0.01, max: 100_000_000 },
    // Calendar bounds for start_date/end_date — keeps the date picker (and a direct
    // RPC call) from accepting something like the year 9999. Wide enough to log a
    // past trip retroactively or plan one far out.
    dateMin: '2000-01-01',
    dateMax: '2100-12-31',
  },
  participant: {
    displayName: { min: 1, max: 60 },
    // Exactly 10 digits, no prefix — the +91 is added programmatically, never typed.
    // Leading digit 6-9 because that's a real constraint on Indian mobile numbers
    // (0-5 isn't issued for mobile) — remove the [6-9] and use \d{10} instead if you'd
    // rather not enforce that and just check length.
    phone: { length: 10, pattern: /^[6-9]\d{9}$/ },
  },
  expense: {
    description: { min: 1, max: 200 },
    amount: { min: 0.01, max: 10_000_000 },
    splitPercentage: { min: 0, max: 100 },
    // Integer count of shares, not a decimal — see validateInteger below.
    splitShares: { min: 1, max: 999 },
    // Applies to the "exact amount per person" and "reimbursement" split inputs —
    // same ceiling as the expense amount itself, since a per-person share can't
    // sensibly exceed the whole.
    splitExactAmount: { min: 0, max: 10_000_000 },
  },
  category: {
    name: { min: 1, max: 40 },
  },
  comment: {
    body: { min: 1, max: 500 },
  },
  recurring: {
    description: { min: 1, max: 200 },
    amount: { min: 0.01, max: 10_000_000 },
  },
  phoneVerification: {
    displayName: { min: 1, max: 60 },
    otp: { length: 6 },
  },
  invite: {
    code: { length: 6 },
  },
  // Not built yet — no file/image upload UI exists anywhere in the app currently
  // (expense_attachments has an add_attachment RPC server-side, but nothing calls it
  // yet). Defined now so the limit exists the moment that UI gets built, rather than
  // being an afterthought then.
  attachment: {
    maxFileSizeMb: 10,
    maxFilesPerExpense: 5,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'] as string[],
  },
} as const;

// ── Generic validators ──────────────────────────────────────────────────────────
// Every screen-specific validate* function below is a thin wrapper around one of
// these, so the actual comparison logic exists in exactly one place.

export function validateTextField(
  value: string,
  limits: { min: number; max: number },
  label: string
): string | null {
  const trimmed = value.trim();
  if (trimmed.length < limits.min) return `${label} is required.`;
  if (trimmed.length > limits.max) return `${label} must be ${limits.max} characters or fewer.`;
  return null;
}

export function validateOptionalTextField(
  value: string,
  limits: { max: number },
  label: string
): string | null {
  const trimmed = value.trim();
  if (trimmed.length > limits.max) return `${label} must be ${limits.max} characters or fewer.`;
  return null;
}

// Plain decimal only: digits, optionally one dot then 1-2 more digits. No leading +,
// no scientific notation (1e3), no hex (0x10), no whitespace inside the number --
// Number(value) alone would silently accept all of those, which isn't what anyone
// typing an amount meant.
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export function validateAmount(
  value: string,
  limits: { min: number; max: number },
  label: string
): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return `${label} is required.`;
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return `Enter ${label.toLowerCase()} as a plain number, e.g. 12.50.`;
  }
  const n = Number(trimmed);
  if (n < limits.min) return `${label} must be at least ${limits.min}.`;
  if (n > limits.max) return `${label} must be ${limits.max.toLocaleString()} or less.`;
  return null;
}

export function validateOptionalAmount(
  value: string,
  limits: { min: number; max: number },
  label: string
): string | null {
  if (value.trim() === '') return null;
  return validateAmount(value, limits, label);
}

// Whole numbers only (e.g. split shares) -- same idea as validateAmount but rejects
// any decimal point at all, not just ones beyond 2 places.
const INTEGER_PATTERN = /^\d+$/;

export function validateInteger(
  value: string,
  limits: { min: number; max: number },
  label: string
): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return `${label} is required.`;
  if (!INTEGER_PATTERN.test(trimmed)) return `${label} must be a whole number.`;
  const n = Number(trimmed);
  if (n < limits.min) return `${label} must be at least ${limits.min}.`;
  if (n > limits.max) return `${label} must be ${limits.max.toLocaleString()} or less.`;
  return null;
}

// ── Field-specific validators ───────────────────────────────────────────────────

export function validateTripName(value: string): string | null {
  return validateTextField(value, LIMITS.trip.name, 'Trip name');
}

export function validateTripBudget(value: string): string | null {
  return validateOptionalAmount(value, LIMITS.trip.budget, 'Budget');
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateTripDate(iso: string): string | null {
  if (!iso) return null;
  if (!ISO_DATE_PATTERN.test(iso)) return 'Enter a valid date.';
  if (iso < LIMITS.trip.dateMin || iso > LIMITS.trip.dateMax) {
    return `Date must be between ${LIMITS.trip.dateMin} and ${LIMITS.trip.dateMax}.`;
  }
  return null;
}

export function validateParticipantName(value: string): string | null {
  return validateTextField(value, LIMITS.participant.displayName, 'Name');
}

// Strips everything except digits -- turns "98765 43210" or "(98765) 43210" into
// "9876543210" so the length/pattern check always runs against just the digits the
// person actually typed, regardless of how they grouped them visually.
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function validatePhone(value: string, required = false): string | null {
  const digits = digitsOnly(value);
  if (!digits) return required ? 'Phone number is required.' : null;
  if (digits.length !== LIMITS.participant.phone.length) {
    return `Phone number must be exactly ${LIMITS.participant.phone.length} digits.`;
  }
  if (!LIMITS.participant.phone.pattern.test(digits)) {
    return 'Enter a valid 10-digit mobile number.';
  }
  return null;
}

export function validateExpenseDescription(value: string): string | null {
  return validateTextField(value, LIMITS.expense.description, 'Description');
}

export function validateExpenseAmount(value: string): string | null {
  return validateAmount(value, LIMITS.expense.amount, 'Amount');
}

export function validateSplitPercentage(value: string): string | null {
  return validateAmount(value, LIMITS.expense.splitPercentage, 'Percentage');
}

export function validateSplitShares(value: string): string | null {
  return validateInteger(value, LIMITS.expense.splitShares, 'Shares');
}

export function validateSplitExactAmount(value: string): string | null {
  return validateAmount(value, LIMITS.expense.splitExactAmount, 'Amount');
}

export function validateCategoryName(value: string): string | null {
  return validateTextField(value, LIMITS.category.name, 'Category name');
}

export function validateCommentBody(value: string): string | null {
  return validateTextField(value, LIMITS.comment.body, 'Comment');
}

export function validateRecurringDescription(value: string): string | null {
  return validateTextField(value, LIMITS.recurring.description, 'Description');
}

export function validateRecurringAmount(value: string): string | null {
  return validateAmount(value, LIMITS.recurring.amount, 'Amount');
}

export function validateDisplayName(value: string): string | null {
  return validateTextField(value, LIMITS.phoneVerification.displayName, 'Name');
}
