# Expensio — Pre-Code Checklist

Where things stand across the five docs already in `docs/architecture/`, and what's still
worth resolving before writing feature code against them.

## What's solid

Architecture, data model, permissions/RLS/RPCs, onboarding/auth, and the trip-creation/
invite flow are all pushed and internally consistent as of the last commit — no known
contradictions between them. That's a real foundation, not just a pile of documents.

## Quick decisions (minutes, not days) — nothing technical blocks these, they're just undecided

- **Solo trip minimum: 1, or keep 2 with a separate lighter entry point?** (flow doc §5.1)
- **Email invites: actually in v1, or just naming apps that do invites well?** (flow doc §5.3)
- **iOS in scope for v1, or Android-first?** — decides whether Apple Sign-In and the iOS
  Universal Links setup are needed now or later.
- **Currency list: a fixed supported set, or any ISO 4217 code?** Affects the currency
  picker UI and whether `trips.currency`/`expenses.currency` need a `check` constraint.
- **Expense category taxonomy.** Referenced repeatedly (`expenses.category`, OCR/AI
  categorization) but no actual list exists anywhere. Needed before the "add expense" screen
  or the AI categorization endpoint can be built.

## Real gaps — things I've referenced by name but never actually specified

Worth flagging clearly: these aren't hypothetical future work, they're pieces the RPCs
already *call* without a defined implementation.

- **`compute_expense_splits`** — every `add_expense`/`edit_expense` call does
  `perform compute_expense_splits(...)`, but the actual per-`split_type` math has never been
  written down. The real risk isn't the happy path, it's **rounding**: splitting ₹100 three
  ways equally is 33.33/33.33/33.34 — who gets the extra paisa? Same question for
  percentage splits that don't divide evenly. This needs an explicit, deterministic rule
  (e.g. "remainder goes to the first participant in the split, by id order") before it's
  coded, or you'll get a real bug where three people's shares don't sum to the total.
- **The settlement-plan debt-simplification algorithm** (architecture doc §6, FastAPI) —
  named as a feature, never designed. It's a well-understood problem (greedy pairing of the
  largest debtor with the largest creditor, repeat) but "well-understood" isn't the same as
  "written down for this codebase."
- **Notifications** — architecture doc §7 describes the *shape* (Postgres trigger → queue →
  Edge Function → push/email) but there's no `notification_events` table in the actual DDL,
  no event-to-template mapping, and `profiles.notification_preferences` is referenced in
  prose but was never added as a column. This is the biggest gap between "described" and
  "specified."

## New docs worth writing before code, not yet written

1. **A v1 scope doc** — genuinely the most valuable one missing. Every decision in this
   conversation has been made incrementally; there's no single page saying "this is what
   Expensio v1 actually does" versus what's deliberately deferred. Writing it would also
   force the quick decisions above to get made in one place instead of staying loose ends.
2. **A notifications doc** — same treatment `expensio-onboarding-auth.md` and
   `expensio-trip-creation-flow.md` already got: schema, event catalog, push vs. email
   rules, template content.
3. **An environments & deployment doc** — nothing about *how this actually ships* has been
   discussed: dev/staging/prod Supabase projects, migration tooling (Supabase CLI
   migrations vs. hand-applied SQL), where FastAPI runs, CI/CD. You can't really start
   "making the project" without knowing where the code lives and how a change reaches
   production.
4. **A testing strategy** — this design puts real business logic in ~20 Postgres RPCs.
   Worth deciding the testing approach (pgTAP for the RPCs, at minimum) before they're
   written, not after, so tests aren't an afterthought bolted onto already-shipped functions.

`compute_expense_splits`'s rounding rule and the settlement algorithm are small enough to
add as a new section in `expensio-data-model.md` rather than their own files — flagging them
as gaps here, not proposing a sixth document for two paragraphs of math.

## Not blocking code, but needed before a real launch

- **Privacy Policy + Terms of Service** — legal documents, not engineering, but the data
  model already tells you exactly what they need to cover: phone numbers, contacts data,
  financial records, the account-deletion/pseudonymization behavior.
- **App store data-safety disclosures** (Play's Data Safety form, Apple's App Privacy
  "nutrition label") — same underlying data, different paperwork, easy to fill out once the
  data model above is final.
- **DLT SMS template registration** (already flagged in the onboarding doc) — reconfirming
  it here since it's a launch-blocker, not a code-blocker, so it's easy to forget until
  OTPs/invites mysteriously stop delivering.

## PowerSync — the highest-risk unknown in the whole stack

Still alpha/beta as of when this was checked. Recommend it being the *literal first thing
built* — a tiny spike syncing one dummy table through the full path (Postgres → PowerSync →
local SQLite on a real device) — before any real feature code sits on top of it. Cheap to
discover a problem on day one; expensive to discover it on day sixty.
