# Expensio — UI Port Plan (from TripSpend)

Living document, same rules as `TASKS.md`: update it in the same commit as the work it
tracks. Covers porting [tripspend](https://github.com/Amartya-007/tripspend)'s exact UI
onto Expensio's React Native client. The backend is entirely new (Supabase/PowerSync
instead of Firebase); only the look and interaction design is being carried over.

*A large, independent batch of work ("New screen and FastAPI") landed directly on GitHub
partway through this port, adding `InviteScreen.tsx`, `PhoneVerificationScreen.tsx`,
`SettlementScreen.tsx`, `RecurringScreen.tsx`, a FastAPI service, and two new migrations —
see `TASKS.md`'s own note on this. It was merged in (not overwritten) once discovered; the
one real conflict was `ExpenseDetailScreen.tsx`, which both this port and that batch had
independently rewritten — resolved by keeping this port's restyle and re-adding the other
side's comments feature as its own card. All four of those screens are ported now too, in
later passes — see their entries in the mapping table below (`SettlementScreen.tsx`
specifically no longer exists as a standalone file; its content moved into
`SettlementView.tsx`, see "Navigation shape" below for why).*

## Why this isn't a copy-paste job

TripSpend is a **web** React app (Vite + React DOM), wrapped in Capacitor for native
distribution — Tailwind classes on real `<div>`/`<button>` DOM elements, `react-router-dom`
for navigation, `lucide-react` + `motion` (Framer Motion) for icons/animation. Expensio's
mobile client is React Native + Expo — no DOM, no `<div>`, no CSS transitions. "Exact UI"
here means rebuilding every screen in RN so it looks and behaves identically, then wiring
it to PowerSync/RPCs instead of Firebase's `onSnapshot` listeners. Expensio's mobile app had
no design system before this (plain ad-hoc `StyleSheet.create`, per `App.tsx`'s old
comments) — nothing to fight, a clean port target.

## Stack

| Concern | Package | Version pinned | Why |
|---|---|---|---|
| Tailwind-in-RN | `nativewind` | `4.2.6` | Lets screens keep TripSpend's exact `className` strings |
| Tailwind engine | `tailwindcss` | `^3.4.17` (**not v4**) | See trap below |
| Animation | `moti` (+ `react-native-reanimated`) | latest | Closest match to `motion/react`'s variants |
| Icons | `lucide-react-native` | latest | Same icon set/names as `lucide-react` |
| Navigation | `@react-navigation` (native, native-stack, bottom-tabs) | v7 | Replaces `react-router-dom` |
| Gradients | `expo-linear-gradient` | latest | RN has no CSS gradient backgrounds |
| Gradient text | `@react-native-masked-view/masked-view` | latest | RN `Text` can't clip a gradient to glyphs |
| Font | `@expo-google-fonts/inter` + `expo-font` | latest | TripSpend's `--font-sans` |

**The nativewind/tailwindcss trap:** `nativewind@4.2.6`'s own `package.json` declares
`peerDependencies: { tailwindcss: ">3.3.0" }` — looks like it accepts v4. It doesn't.
Its actual engine, `react-native-css-interop`, declares `tailwindcss: "~3"` — v3 only.
`npm ls` flags any v4 install as `invalid`. TripSpend itself is on Tailwind v4
(`@theme` CSS-first config) — Expensio's RN app is intentionally on v3 (JS
`tailwind.config.js` + `nativewind/preset`) despite that mismatch, because the RN engine
requires it. Confirmed by actually installing both ways in the sandbox, not just reading
docs. If a future NativeWind release adds real v4 support, revisit this — check
`npm ls tailwindcss` for an `invalid:` line, that's the tell.

## Design tokens (`global.css`, ported from `tripspend/src/index.css`)

Every custom class name (`.btn-primary`, `.card-elevated`, `.page-shell`, `.page-title`,
etc.) is kept identical so screens read the same, but several parts had to be dropped or
moved to component level — a className alone can't express them in RN:

- **`hover:*`** — dropped everywhere. No hover state on a touchscreen.
- **`transition-*`, `duration-*`** — dropped everywhere. These animate a CSS property
  change over time; there's no such mechanism from a className alone. Real motion goes
  through Reanimated at the component level instead (see `PrimaryButton.tsx`).
- **`active:scale-95`** — dropped from `.btn-primary`'s class, reproduced instead by
  wrapping the button in a Reanimated-animated `Pressable` (`PrimaryButton.tsx`).
- **`focus:*` (ring/border/outline)** — dropped from `.input-field`. RN has no CSS
  `:focus` pseudo-class; screens toggle a `.input-field-focused` class themselves from
  `onFocus`/`onBlur` state (see `AddParticipantScreen.tsx` for the pattern).
- **`linear-gradient(...)` as a raw CSS `background` property** (`.btn-primary`'s
  original background) — has no RN translation at all, gradient or otherwise. Rendered by
  `expo-linear-gradient`'s `<LinearGradient>` component instead; the class only supplies
  padding/radius/shadow/text that sits on top of it. See `PrimaryButton.tsx`.
- **`bg-gradient-to-r ... bg-clip-text text-transparent`** (`.page-title`) — RN `Text`
  can't clip a gradient to its own glyphs. `global.css`'s `.page-title` falls back to a
  solid `text-blue-700`; the true gradient version is `GradientText.tsx`
  (masked-view + linear-gradient), used wherever a page title needs the exact original look.
- **Font weights on Android** — `font-semibold`/`font-bold`/`font-black` utility classes
  set `fontWeight` on whatever `fontFamily` is active, but Android doesn't auto-resolve a
  `fontWeight` to the matching static Inter file the way iOS/CSS does. `tailwind.config.js`
  only sets the *regular* Inter as the default `font-sans`; any screen that needs a heavier
  weight has to also set an explicit `fontFamily: 'Inter_600SemiBold'` /
  `'Inter_700Bold'` / `'Inter_900Black'` in a `style` prop alongside the class (see
  `GradientText.tsx` and `PrimaryButton.tsx` for the pattern) — otherwise it silently
  renders in regular weight on Android only, one of those "looks fine on iOS, wrong on
  Android" bugs that's easy to miss without a real device to check.

Shared components built so far: `src/components/GradientText.tsx`,
`src/components/PrimaryButton.tsx`. Add to this list as more of TripSpend's repeated
patterns (badges, cards with a colored icon chip, the toggle switch in `TripDetails.tsx`)
get their own component rather than being re-typed per screen.

## Navigation shape — a real decision, not just a library swap

TripSpend's `BottomNav.tsx` is a persistent 4-tab bar (Home / Expenses / Settle / Settings)
plus a raised center FAB for "Add Expense" — it assumes exactly one "current" trip, switched
via `TripSwitcher.tsx`, with every tab relative to that trip. Expensio is multi-trip with
drill-in navigation (Trips List → a specific trip → its expenses/participants) — there's no
single "current trip" concept in the data model.

**Partly resolved.** The concrete inconsistency this section originally flagged — Settle
looked like a fourth tab alongside Expenses/Log/Members but actually navigated to a
separate route, and the `'settlement'` tab-state value was never set by anything as a
result — is fixed. Settle is a real local tab now, rendering `SettlementView` (the content
that used to be `SettlementScreen.tsx`'s whole body, extracted once it needed a second
home) inline, exactly like its three siblings. `TripDetailScreen`'s options menu still
reaches `Invite`/`Recurring`/`VerifyPhone` as separate pushed routes — those don't have
the same "looks like a tab but isn't" problem Settle had, so they weren't touched.

**Still not resolved — the bigger question this section was really about:** does opening a
trip from the Trips List switch into TripSpend's persistent-tab-bar mode for that trip
(closest to "exact UI"), replacing today's drill-in header entirely? That's a materially
bigger change than the Settle fix above, and it runs straight into the budget-schema gap
below: TripSpend's bar's first tab is the Dashboard, and there's nothing to send that tab
to on this side yet. Worth deciding once, rather than building a global tab shell now and
discovering it needs Home to point somewhere.

What's in place: `src/navigation/RootNavigator.tsx`, a real `@react-navigation/native-stack`
replacing `App.tsx`'s old hand-rolled `Screen` state union (its own comment said to swap it
out "whenever screen count or transition needs... outgrow it" — this was that moment).
Every route still maps 1:1 onto the old screen union; no screen's own prop contract changed
beyond Settle losing its `onOpenSettlement` prop (it doesn't navigate anywhere now).

## The "budget" concept — a schema gap, not a UI gap

`Dashboard.tsx` (the per-trip budget snapshot — remaining balance, burn rate, "safe to
spend today", overspend alerts) and `TripDetails.tsx` (budget-per-person + dates editor)
are both built around a personal daily-budget concept that **has no field in Expensio's
schema at all** — `trips` (`AppSchema.ts` / `0002_core_schema.sql`) has `name`, `currency`,
`start_date`, `end_date`, `is_archived` — no `total_budget`, no `budget_per_person`.
Expensio's design docs (`expensio-architecture.md`, `expensio-data-model.md`) scope it as
pure shared-expense-splitting/settlement, with no budget-tracking feature at all so far.

Porting these two screens "exactly" needs a product decision (does Expensio want a
budget-tracking feature at all?) and, if yes, a schema migration (`total_budget` and/or
`budget_per_person` on `trips`) **before** any UI work — not attempted in this pass.
Flagging it here so it isn't rediscovered mid-port later.

## Screen-by-screen mapping

| TripSpend file | Maps to (Expensio) | Status | Notes |
|---|---|---|---|
| `screens/Dashboard.tsx` | *(no current equivalent)* | Not started | Needs the budget schema decision above first |
| `screens/TripDetails.tsx` | *(no current equivalent)* | Not started | Same budget-schema blocker; the Members/Categories nav rows at the bottom are unblocked and portable independently |
| `screens/GroupMemberManager.tsx` | `AddParticipantScreen.tsx`, `TripDetailScreen.tsx`'s Members tab | **Partial** | "Add" slice ported (`AddParticipantScreen.tsx`); the Members tab now shows the real list with colored-initial avatars, matching the badge visual language elsewhere in this port. Inline rename, remove-with-settlement-check, restore-inactive-members still not built — bigger scope, `trip_balances` view already exists to support the settlement-check part whenever this is picked up |
| `screens/ExpenseList.tsx` | `TripDetailScreen.tsx`'s Expenses tab | **Ported** | Row card uses a colored-initial badge instead of TripSpend's fixed-category icon map (`Food`/`Travel`/`Stay`/`Misc` doesn't fit Expensio's free-text custom categories) — same device already used for participant avatars. Added `category` to the query, same as `ExpenseDetailScreen.tsx` before it — existed on the table, wasn't being read. TripSpend's filter bottom-sheet (category/person/date filters) not ported — no filter UI exists on the Expensio side yet at all, not just unstyled |
| `screens/ExpenseDetail.tsx` | `ExpenseDetailScreen.tsx` | **Ported** | Dropped the `isLocked` banner (same budget-schema gap) and note/tags/receipts sections (no matching columns). Added `category`/`expense_date` to the query — both already existed in the schema and in `add_expense`'s RPC signature, just weren't being read before. Split display shows each participant's real `share_amount` rather than TripSpend's single equal-split figure. Delete confirmation is now a real `Modal`, replacing the native `Alert.alert()`. Also gained a Comments card (`add_comment` RPC) merged in from the parallel work stream noted at the top — not part of TripSpend's original screen, kept as its own card in the ported design language rather than dropped |
| `screens/AddExpense.tsx` | `AddExpenseScreen.tsx` | **Ported** | Not a structural port — TripSpend's version is built around receipts/tags/an AI category suggester/budget presets, none of which have a backing RPC or schema column here. Kept every one of Expensio's actual fields (7 formal split types, custom categories) and all client-side validation exactly as they were; only the JSX changed |
| `screens/Settlement.tsx` | `SettlementView.tsx` (used inline by `TripDetailScreen`'s Settle tab) | **Ported** | TripSpend's own version isn't a usable visual reference at all (60KB, built around the budget concept), so this follows the established page-shell/card-elevated/badge patterns instead. Also newly wired: a "Record payment" action per suggestion, calling the now-fixed `record_payment` — only for suggestions where the current user is the payer, since the RPC infers payer from the session. Re-fetches the whole plan after a successful record rather than just removing that row client-side, since paying one debt can reshape the whole simplified plan. The recipient's confirm-side (`confirm_payment`) still isn't wired — needs a direct Supabase query against `ledger_entries` (no PowerSync sync stream for it; see sync-streams.yaml), scoped as an explicit follow-up rather than half-built here. Originally a standalone `SettlementScreen.tsx` route; extracted into this content-only component and inlined as a real tab once the "Navigation shape" section's Settle inconsistency was fixed — the standalone route is gone, nothing pushes to it anymore |
| `screens/SettlementLog.tsx` | *(none)* | Not started | |
| `screens/Analytics.tsx` | *(none)* | Not started | Partly depends on the budget concept (burn rate, health score) — split what needs budget data from what doesn't |
| `screens/CategoryManager.tsx` | *(none — `custom_categories` table exists, unused by mobile so far)* | Not started | |
| `screens/Onboarding.tsx` | *(none — App.tsx signs in anonymously with no onboarding UI)* | Not started | |
| `screens/Settings.tsx` | *(none)* | Not started | |
| `screens/SetupScreen.tsx` | `CreateTripScreen.tsx` | Not ported | TripSpend's version (38KB) covers more than trip creation alone — check what before porting 1:1 |
| `components/BottomNav.tsx` | *(the global tab shell — see "Navigation shape" above; still blocked on the Home/Dashboard decision)* | Blocked on decision | |
| `components/TripSwitcher.tsx` | *(none — `TripsListScreen.tsx` is the closest thing)* | Not started | Relevant to the same navigation-shape decision |
| `components/AccountSwitchDialog.tsx` | *(none)* | Not started | |
| `components/CustomSelect.tsx`, `DatePicker.tsx` | *(none yet — shared form components)* | Not started | Needed once `TripDetails`/`SetupScreen` are tackled |
| `components/NotificationCard.tsx`, `PeoplePickerSheet.tsx`, `PreSetupTripChoice.tsx` | *(none)* | Not started | |
| *(no TripSpend equivalent — Expensio-specific)* | `InviteScreen.tsx`, `PhoneVerificationScreen.tsx`, `RecurringScreen.tsx` (all new, from the parallel work stream) | **Ported** | Not in TripSpend's own screen list at all (it has no recurring-expense feature, and its invite flow lives elsewhere in that codebase, not as a dedicated screen), so these had no "port from X" — restyled following this port's own established patterns instead. `RecurringScreen.tsx`'s paid-by/repeats selectors use the same shared `Chip` component `AddExpenseScreen.tsx` uses — extracted into `src/components/Chip.tsx` once it was needed in a second place, rather than left duplicated |

## What's actually done this pass

- NativeWind + Tailwind v3 + navigation + animation + gradient + font stack installed and
  version-locked (see table above); real `npm install`, not just documented steps.
- `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`,
  `nativewind-env.d.ts` all in place.
- `App.tsx`: global.css imported, Inter fonts loaded, real navigation
  (`GestureHandlerRootView` → `SafeAreaProvider` → `NavigationContainer` →
  `RootNavigator`) replacing the old hand-rolled screen state. Existing bootstrap logic
  (anonymous sign-in, PowerSync connect, pending-actions flush) untouched.
- `src/navigation/RootNavigator.tsx`: real stack, 1:1 with the old screens.
- `src/components/GradientText.tsx`, `src/components/PrimaryButton.tsx`: first two shared
  design-system pieces.
- `AddParticipantScreen.tsx` restyled with TripSpend's exact visual language (page-shell/
  page-header/card-elevated/input-field, GradientText title, PrimaryButton submit) — same
  props, same `add_placeholder_participant` RPC call as before, just re-skinned.
- `ExpenseDetailScreen.tsx` fully ported — see its table row above for the specific
  omissions/additions. Added `date-fns` (pure JS, RN-safe) for the date formatting
  TripSpend's version relies on.
- `AddExpenseScreen.tsx` fully ported — see its table row above. `PrimaryButton.tsx`
  gained an `icon` prop in the process: a call site tried passing an icon alongside text
  through `children`, which doesn't work since RN won't allow a non-Text element inside
  `<Text>` (that's how `PrimaryButton` renders its children) — caught before it ever hit
  `tsc` (a type-valid but runtime-broken pattern) rather than after.
- `TripDetailScreen.tsx` fully ported — Expenses/Activity Log/Members tabs all restyled.
  Options menu (archive/delete/leave/recurring) is untouched — it's a native
  `Alert.alert`, which can't be restyled at all, RN or otherwise. (Settle's tab behavior
  was fixed in a later pass — see "Navigation shape" above.)
- `npx tsc --noEmit` passes clean across the whole project after all of the above,
  including after merging in the parallel work stream noted at the top of this doc.
- `SettlementScreen.tsx` fully ported — see its table row above, including the newly
  wired "Record payment" action (payer side only; recipient confirm-side is a scoped
  follow-up, not built this pass).
- `InviteScreen.tsx`, `PhoneVerificationScreen.tsx`, `RecurringScreen.tsx` fully ported —
  the last three functional-but-unstyled screens. `src/components/Chip.tsx` extracted as
  a shared component (was duplicated between `AddExpenseScreen.tsx` and this batch).
  **This closes out every screen that currently exists in the app** — everything left in
  the mapping table above is either blocked on a decision or doesn't exist as an Expensio
  screen yet at all (see "Suggested order from here" below).
- Settle's tab inconsistency (flagged when `TripDetailScreen.tsx` was first ported —
  looked like a fourth tab, actually navigated away) fixed: `SettlementScreen.tsx`'s
  content extracted into `src/components/SettlementView.tsx` (header-less, so it can sit
  inside a page that already has its own), the standalone screen and its `Settlement`
  route deleted, and Settle now renders `SettlementView` inline exactly like
  Expenses/Log/Members. See "Navigation shape" above for what's still open versus what
  this resolved.

**Not verified:** actual rendered output. This sandbox has no device/simulator, so nothing
above has been visually confirmed — only that real packages installed without conflict and
the whole project compiles. Run `npx expo start` locally to confirm the Metro bundle
actually builds and the ported screen looks right, especially the two gradient components
(masked-view interacting with Metro's bundler is the one piece a clean `tsc` run can't
catch).

## Suggested order from here

Every screen that currently exists and works in Expensio's mobile client is now ported —
that closes out the original scope of this doc (port TripSpend's *existing* UI onto this
app). What's left splits into two different kinds of work, not really an ordered list
anymore:

**Decisions, not code:**
1. The navigation-shape decision above — `Settlement`/`Invite`/`Recurring` all exist as
   flat stack routes today and would need moving if the persistent-tab-bar direction is
   chosen.
2. The budget-schema product decision — unblocks `Dashboard.tsx` / `TripDetails.tsx` /
   the budget half of `Analytics.tsx`, none of which can be *ported* until Expensio
   decides whether it wants that feature at all.

**New screens Expensio doesn't have yet** (`Settings`, `CategoryManager`'s management UI,
`Onboarding`, `SetupScreen`'s fuller flow, `TripSwitcher`/`BottomNav`,
`AccountSwitchDialog`, `CustomSelect`/`DatePicker`, `NotificationCard`/
`PeoplePickerSheet`/`PreSetupTripChoice`) — these aren't restyle jobs like everything
above was. They're new features, and TripSpend's screens for them are a reasonable
design reference once Expensio actually needs the feature, but building them now would
be scope invented by this doc rather than scope this doc was tracking. Worth picking up
in whatever order matches what Expensio's roadmap actually calls for next, not TripSpend's
file sizes.
