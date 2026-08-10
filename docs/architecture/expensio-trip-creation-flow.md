# Expensio — Trip Creation & Invitation Flow

Companion to `expensio-onboarding-auth.md` (which ends at Home) and
`expensio-permissions-matrix.md` (which this flow must stay consistent with — see §5).
This documents the flow as specified, screen by screen, plus the gaps that need resolving
before it's buildable as-is.

## 1. Entry flow (recap — full detail in the onboarding doc)

Onboarding carousel → Auth (Google or username+phone) → mandatory phone OTP → **Home**.

**Home, first visit:** two options — **Create a new trip** / **Join an existing trip** —
with a 6-digit code field and **Join Trip** button beneath both. Code entry calls
`join_trip_via_code` directly; no wizard needed for joining.

## 2. Trip creation wizard

**Step 1 — Trip setup:** trip name (autofocus), expected group size (2–25 — see §5.1 for
why this range is a problem as stated). "Next."

**Step 2 — Who's who:** two entry modes for populating the roster —

- **Manual entry:** creator types in names for everyone. Framed as "one person manages the
  whole trip" — no phone number collected, no invite sent, no account required for these
  participants. See §5.2 — this is the biggest open item in this whole doc.
- **Contact-based selection:** "Speed up with contacts: Person 1 is you. Select up to
  [N] contacts, then tap OK." Requests contacts permission, stores name + phone number per
  selected contact. Phone number is required specifically because names collide (two
  contacts can share a first name) — the phone is the actual disambiguator.

"Next."

**Step 3 — Budget:** per-person budget (max 1,000,000), with total trip budget shown live
as per-person × group size. "Next."

**Step 4 — Dates:** start date via a custom calendar, end date (calendar disables anything
before the selected start date rather than allowing an invalid pick and erroring after).
"Start Trip" replaces "Next" on this step.

Every step has a back button. "Start Trip" → **Home**, showing the new trip at the top with
its name and budget.

## 3. Invitation logic

Only contact-selected and phone-provided placeholder participants have a number to invite —
manual entries with no phone can't be SMS'd (§5.2 covers what happens to them).

**Google Meet–style, not deferred deep linking — this is a better call than my original
Branch.io suggestion, not just an acceptable alternative:**

- **App already installed:** the SMS/email link is a plain `https://expensio.app/join/ABC123`
  Universal Link (iOS) / App Link (Android). The OS routes it straight to the app — no SDK,
  no third party — the app extracts the code and calls `join_trip_via_code` automatically.
  This needs `apple-app-site-association` and `assetlinks.json` hosted at the domain; easy
  to forget, worth putting on the launch checklist explicitly.
- **App not installed:** the exact same URL just loads as a normal webpage (this is how
  Universal Links/App Links degrade automatically — no special handling needed), showing the
  trip name, the code, and an install link. The person installs, opens the app, and enters
  the code — manually, not automatically. Small, cheap enhancement: have the web page copy
  the code to the clipboard on load, so most mobile keyboards will offer to paste it the
  moment they tap the code field in-app.

This drops the vendor dependency entirely — no Branch/AppsFlyer/Adjust needed for either
case. The trade-off is a few seconds of manual code entry for people who didn't have the
app yet, in exchange for a deterministic flow with zero attribution-matching risk and zero
per-install cost. Worth it at this stage.

**One thing worth getting right:** the `https://` link is what actually goes in the SMS/
email text — a custom scheme like `expensio://join/ABC123` should exist for in-app use
(e.g. a "reshare" button), but sending it directly via SMS is a trap: carriers and messaging
apps frequently strip or block custom-scheme links, and it does nothing at all for someone
without the app installed yet.

This also needs its own SMS template, separate from the OTP template — India's DLT
sender-ID/template registration (already covered in the onboarding doc) is per message type,
not a blanket approval. Register "you've been invited to a trip" as its own template.

## 4. Edge case: mixed manual + contact participants

Your example: 7-person trip, 2–4 added via contacts, the rest entered manually with no phone
number. Recommendation is **all three of your options together, not one instead of the
others**, since they're not actually competing:

- **Skip sending an invite** to anyone without a phone number — the only option that's
  actually mandatory, since there's nothing to SMS.
- **Show a summary before finalizing:** "4 people will get an invite by text. 3 people
  (Rahul, Priya, Amit) were added manually and won't have their own login unless you add a
  number for them." One screen, not a blocking wall — matches the "skippable, not gatekept"
  pattern used throughout the onboarding flow.
- **Allow adding a phone number later** from the roster/settings screen, at which point an
  invite can be sent retroactively. This is also the moment a manual entry could be
  reconciled with a real account if one already exists for that number — see §5.2.

## 5. Open issues — resolve before this is buildable

### 5.1 Group size minimum of 2 blocks the solo-trip case

The architecture doc treats a single-member trip as fully first-class — no special
handling, same schema, same everything. A hard `2–25` minimum on this screen means the app
itself can't be used the way it's designed to support. Two ways to resolve, your call:
- Change the range to `1–25`, and treat "1" as the solo/local-tracking use case.
- Or keep `2–25` here deliberately, and route a genuine solo use case through a different,
  lighter entry point ("track my own expenses" vs. "plan a trip with people") — reasonable
  if you want the wizard to specifically mean "group trip," but then it should be a
  conscious product decision, not an unexamined default.

### 5.2 Manual entry — resolved

Built as `participants` in `expensio-data-model.md` and the RPCs in
`expensio-permissions-matrix.md` (`add_placeholder_participant`, and the claim logic inside
`join_trip_via_code`). One correction worth knowing about if you saw an earlier draft of
this idea: `participants` is a separate table from `trip_members`, not a repurposed version
of it — `trip_members` is pure access control (only ever exists for someone with a real
`auth.uid()`), `participants` is pure financial identity (may or may not have an account).
Keeping them apart means a placeholder never needs a fake access row it can't use, and
`trip_members` stays exactly as simple as the flat-model refactor made it.

### 5.3 Smaller items

- ~~Invite code format~~ — resolved: `generate_invite` now produces a numeric 6-digit code
  (matches the field in this flow), and no longer relies on a permanent DB-level
  `UNIQUE(code)` constraint — see the comment on `generate_invite` in the permissions doc
  for why that constraint doesn't hold up at this code length.
- **Email invites** are named in your opening line but never described in the flow itself —
  open question whether that's an actual v1 requirement or just naming apps that do
  invites well in general. Worth a direct answer before I document an email flow that might
  not be wanted.
- **Budget and trip dates** aren't in the schema yet (`expensio-data-model.md` has no
  `budget`, `start_date`, or `end_date`). Straightforward to add — budget probably belongs
  in `trips.settings` (jsonb, doesn't affect ledger math) rather than a dedicated column;
  dates are simple enough to be real columns.
- **Contacts data is third-party personal data, not the user's own.** Storing other
  people's phone numbers pulled from someone's address book carries real privacy weight —
  both app stores require a specific, honest permission-prompt disclosure for contacts
  access, and the safest default is storing only the numbers of people actually selected,
  not importing or retaining the full contact list.
- **"Redirect to Play Store"** is Android-specific phrasing — worth confirming whether iOS
  is in scope for this flow yet. With the Universal Links approach (§3) the iOS equivalent
  needs its own `apple-app-site-association` setup, but no separate vendor decision.
