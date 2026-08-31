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

**Fully resolved.** The bigger question this section was really about — does opening a
trip switch into TripSpend's persistent-tab-bar mode, closest to "exact UI"? — is decided
and built: `TripDetailScreen.tsx` now renders the real Home/Expenses/Settle/Settings tab
bar (`TripTabBar.tsx`, ported from `BottomNav.tsx`) plus the raised center FAB, replacing
the old in-page Expenses/Log/Members/Settle tab row entirely. This didn't need a real
nested React Navigation tab navigator — the existing screen already held its own `tab`
union in local state before this pass; that state's four values changed to
`'home'|'expenses'|'settle'|'settings'` and the UI around it changed from an in-page row
to a fixed bottom bar, same mechanism, lower risk than introducing nested-navigator
typing for what's still fundamentally one screen switching what it renders.

Members and Activity Log moved out of that in-page row into their own routes
(`MembersScreen.tsx`, `ActivityLogScreen.tsx`), reached from the new Settings tab's nav
rows — this actually matches TripSpend's real structure *more* closely than the old flat
tab row did: TripSpend's own member management isn't a bottom tab either (it's one level
under Settings, via `TripDetails.tsx`), and Activity Log has no TripSpend equivalent at
all so it was given the same kind of home. `colorFor`/`AVATAR_COLORS` extracted into
`src/utils/avatarColor.ts` once `MembersScreen.tsx` needed the same device
`TripDetailScreen.tsx` already used for expense-row avatars.

What's in place: `src/navigation/RootNavigator.tsx`, a real `@react-navigation/native-stack`
replacing `App.tsx`'s old hand-rolled `Screen` state union (its own comment said to swap it
out "whenever screen count or transition needs... outgrow it" — this was that moment).
`TripDetail`'s prop contract changed for the new shell (dropped `onAddParticipant`/
`onOpenInvite`, now owned by the new `Members` route instead; added `onOpenMembers`/
`onOpenActivityLog`). Two new stack routes, `Members` and `ActivityLog`, for the screens
that moved out of the in-page tabs.

## The "budget" concept — decided, in progress

**Decided: add it.** `Dashboard.tsx` (the per-trip budget snapshot — remaining balance,
burn rate, "safe to spend today", overspend alerts) and `TripDetails.tsx` (budget-per-
person + dates editor) are TripSpend's most substantial screens, and the whole premise of
this doc from message one was porting TripSpend's *exact* UI — leaving out its most
developed feature permanently would make that structurally incomplete, not just
unfinished. This was a real product decision (not a restyle call), made explicitly rather
than assumed.

**Schema, done and verified.** `0006_trip_budget.sql` adds `total_budget numeric(12,2)`
to `trips` (nullable — budget stays optional, matching Expensio's already-more-flexible
scope; a trip with no budget set just has nothing to compute). `start_date`/`end_date`
already existed on `trips` since `0002_core_schema.sql` but nothing had ever let a client
set them — `create_trip` only ever accepted name/currency/settings. Extended it
(backward compatible — new params default to null) and added `update_trip_details` for
editing after creation, matching TripSpend's `TripDetails.tsx`. Deliberately not porting
`lockPreviousDays` (TripSpend's separate lock-past-days-from-editing toggle) or storing
`peopleCount` (Expensio's participant list is already dynamic — derived live, not a fixed
field). Migration re-run clean from scratch against local Postgres after every fix below;
`create_trip`/`update_trip_details` called for real, not just read.

Found and fixed three real bugs while verifying this migration, none hypothetical — all
caught by actually calling the functions, not by reading them:
1. `create_trip` crashed for essentially any brand-new user. `profiles.display_name`
   starts `null` for every user (`handle_new_user` in `0002_core_schema.sql` sets it
   unconditionally), and anonymous sign-in — the app's actual entry point — never sets
   it before someone creates their first trip. `participants.display_name` is `not
   null`, so `create_trip`'s own participant-insert (pre-existing code, not something
   this migration introduced) would fail outright. Fixed with a `coalesce(..., 'Trip
   creator')` fallback.
2. `create or replace function create_trip(...)` with a different parameter list doesn't
   replace the old function — Postgres only replaces on an exact signature match, so
   this would have left both the old 4-param and new 7-param versions coexisting as
   separate overloads, making `create_trip('name', 'currency')` ambiguous. Fixed with an
   explicit `drop function` first.
3. `update_trip_details`'s own `perform log_activity(...)` call violated
   `trip_activity_log`'s `event_type` check constraint (`'trip_details_updated'` wasn't
   in the allowed list) — and since an unhandled exception aborts the whole function
   invocation, this silently rolled back the trip UPDATE too, not just the log insert.
   Looked like it worked from the query output until a fresh `SELECT` showed nothing had
   actually persisted. Fixed by widening the constraint.

**Calculation logic, done and verified.** `src/utils/calculations.ts` ports
`calculateStats` from `tripspend/src/utils/calculations.ts` — formula kept identical,
only the input shape changed (plain fields instead of a `TripSetup`/`TripData` pair, no
`memberRegistry`/legacy-migration concepts to thread through). Compiled standalone and
ran against a hand-calculated scenario (₹10,000 budget, 11-day trip, ₹3,000 spent across
two expenses) — every output field matched by hand, not just "ran without crashing":
burn rate, days remaining, projected end balance, all exact.

**UI, done.** `DashboardScreen.tsx` (Home tab) and `TripSettingsScreen.tsx` (Settings
tab) are both built and wired to real data — see the mapping table below for what
changed versus the original TripSpend screens. `CreateTripScreen` still isn't wired to
`create_trip`'s budget/date params (a trip created there has no budget until someone
visits the Settings tab and saves one) — deliberately deferred, not a blocker, since
`total_budget`/dates are nullable and `DashboardScreen` already handles "no budget set"
gracefully with a prompt pointing at Settings. TripSpend's own `SetupScreen.tsx` is a
separate, larger port (38KB, more than trip creation alone) that this doc's mapping
table already tracks as "Not ported" independently of this section.

## Screen-by-screen mapping

| TripSpend file | Maps to (Expensio) | Status | Notes |
|---|---|---|---|
| `screens/Dashboard.tsx` | `DashboardScreen.tsx` (Home tab) | **Ported** | Dropped: the `TripSwitcher` section (`TripsListScreen` already covers multi-trip nav), the header's Settings gear icon (Settings is one tap away in the tab bar itself), the browser `Notification` API overspend alert (no RN equivalent; a real push would need a `notification_events` worker, which doesn't exist yet), and the "Full Analytics" CTA (no Analytics screen exists). `peopleCount` is a live `COUNT(*)` on `participants`, not a stored field, per the schema decision above |
| `screens/TripDetails.tsx` | `TripSettingsScreen.tsx` (Settings tab) | **Ported, reshaped** | Single total-budget field instead of TripSpend's per-person-budget × fixed-headcount (matches `trips.total_budget` being a plain total and participant count being live, not fixed). No "lock past days" toggle — deliberately not ported, matching the schema decision above. The People & Categories nav-row section became Members/Activity Log/Recurring — Categories dropped (no management screen exists for it yet, nothing to point at), Invite moved to `MembersScreen.tsx` instead of duplicated here. Also gained rows TripSpend's `TripDetails.tsx` never had at all: the trip-action rows (archive/unarchive/delete/leave), which used to be `TripDetailScreen.tsx`'s hidden `Alert.alert` options menu — same RPC calls, now visible rows since this is a real settings screen rather than a three-dot menu |
| `components/DatePicker.tsx` | `DatePicker.tsx` | **Ported, reshaped** | TripSpend's wraps a native HTML `<input type="date">` for a free platform picker UI — no RN equivalent from a plain component. A real native picker (`@react-native-community/datetimepicker`) would add a new native module this sandbox has no device to visually verify; used a validated `YYYY-MM-DD` text field instead, same data shape in and out, swappable later without touching any caller |
| `screens/GroupMemberManager.tsx` | `AddParticipantScreen.tsx`, `MembersScreen.tsx` | **Partial** | "Add" slice ported (`AddParticipantScreen.tsx`); member list + colored-initial avatars ported to `MembersScreen.tsx` (moved out of `TripDetailScreen.tsx`'s old in-page Members tab once the tab bar shell needed that slot — see "Navigation shape" above). Inline rename, remove-with-settlement-check, restore-inactive-members still not built — bigger scope, `trip_balances` view already exists to support the settlement-check part whenever this is picked up |
| *(no TripSpend equivalent — moved out of the old in-page tab row)* | `ActivityLogScreen.tsx` | **Ported** | This feature doesn't exist in TripSpend at all. Reachable from the Settings tab, next to Members, rather than given a bottom tab TripSpend's `BottomNav.tsx` doesn't have |
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
| `components/BottomNav.tsx` | `TripTabBar.tsx` | **Ported** | Same 4 tabs (Home/Expenses/Settle/Settings) in the same order with the same raised center FAB between Expenses and Settle — see "Navigation shape" above |
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

- Both open decisions from "Navigation shape" and "The budget concept" — build the
  persistent tab bar, add the budget feature — resolved and built: `TripTabBar.tsx`
  (Home/Expenses/Settle/Settings + FAB) now wraps `DashboardScreen.tsx`,
  `TripDetailScreen.tsx`'s existing Expenses content, `SettlementView.tsx`, and the new
  `TripSettingsScreen.tsx`. `MembersScreen.tsx`/`ActivityLogScreen.tsx` extracted out of
  the old in-page tab row into routes reached from Settings.

**Not verified:** actual rendered output. This sandbox has no device/simulator, so nothing
above has been visually confirmed — only that real packages installed without conflict and
the whole project compiles. Run `npx expo start` locally to confirm the Metro bundle
actually builds and the ported screens look right, especially the two gradient components
(masked-view interacting with Metro's bundler is the one piece a clean `tsc` run can't
catch), and the new tab bar's raised FAB positioning/safe-area behavior specifically —
`env(safe-area-inset-bottom)` was a plain CSS property TripSpend's web build got for free;
`TripTabBar.tsx` doesn't yet handle a device's bottom safe-area inset explicitly (worth
checking on a real device, especially anything with a home indicator).

## Suggested order from here

The navigation shape and the budget feature — the two things that were genuinely blocking
further "exact UI" work — are both resolved and built now. What's left is entirely **new
screens Expensio doesn't have yet** (`CategoryManager`'s management UI, `Onboarding`,
`SetupScreen`'s fuller flow wiring budget/dates into trip *creation* rather than only
post-creation editing, `TripSwitcher`, `AccountSwitchDialog`, `CustomSelect`,
`NotificationCard`/`PeoplePickerSheet`/`PreSetupTripChoice`) — these aren't restyle jobs
like everything above was. They're new features, and TripSpend's screens for them are a
reasonable design reference once Expensio actually needs the feature, but building them
now would be scope invented by this doc rather than scope this doc was tracking. Worth
picking up in whatever order matches what Expensio's roadmap actually calls for next, not
TripSpend's file sizes. `CreateTripScreen` not accepting budget/dates at creation time
(only via the Settings tab afterward) is the one loose end from this pass most likely to
matter soon — worth an explicit decision on whether that's acceptable long-term or worth
closing next.
