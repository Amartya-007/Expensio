# Expensio — UI Port Plan (from TripSpend)

Living document, same rules as `TASKS.md`: update it in the same commit as the work it
tracks. Covers porting [tripspend](https://github.com/Amartya-007/tripspend)'s exact UI
onto Expensio's React Native client. The backend is entirely new (Supabase/PowerSync
instead of Firebase); only the look and interaction design is being carried over.

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

**Not yet resolved — needs a decision before the tab shell gets built:** does opening a trip
from the Trips List switch into TripSpend's persistent-tab-bar mode for that trip (closest
to "exact UI"), or does Expensio keep a lighter drill-in header with a trip-switcher control
instead of full-time bottom tabs? Either is buildable; picking one now avoids building the
tab shell twice.

What's in place now instead: `src/navigation/RootNavigator.tsx`, a real
`@react-navigation/native-stack` replacing `App.tsx`'s old hand-rolled `Screen` state
union (its own comment said to swap it out "whenever screen count or transition needs...
outgrow it" — this is that moment). Every route maps 1:1 onto the old screen union; no
screen's own prop contract changed, only how it's reached. This stack is what the eventual
tab shell sits on top of, once the above is decided and the tabs it needs
(Expenses/Settle) exist.

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
| `screens/GroupMemberManager.tsx` | `AddParticipantScreen.tsx` | **Partial** | "Add" slice ported this pass, TripSpend-styled (see below). Inline rename, remove-with-settlement-check, restore-inactive-members not built — bigger scope, `trip_balances` view already exists to support the settlement-check part whenever this is picked up |
| `screens/ExpenseList.tsx` | `TripDetailScreen.tsx`'s activity tab | Not ported | Existing Expensio screen is functional but unstyled |
| `screens/ExpenseDetail.tsx` | `ExpenseDetailScreen.tsx` | Not ported | Existing Expensio screen is functional but unstyled |
| `screens/AddExpense.tsx` | `AddExpenseScreen.tsx` | Not ported | Existing Expensio screen only supports equal split so far (per `TASKS.md`) — non-equal split UI and this port are related work, worth doing together |
| `screens/Settlement.tsx` | *(no current equivalent — this is the open "balances/settlement view" TASKS.md item)* | Not started | Biggest TripSpend file (60KB); backed by the real `trip_balances` view, so no schema blocker here — just size |
| `screens/SettlementLog.tsx` | *(none)* | Not started | |
| `screens/Analytics.tsx` | *(none)* | Not started | Partly depends on the budget concept (burn rate, health score) — split what needs budget data from what doesn't |
| `screens/CategoryManager.tsx` | *(none — `custom_categories` table exists, unused by mobile so far)* | Not started | |
| `screens/Onboarding.tsx` | *(none — App.tsx signs in anonymously with no onboarding UI)* | Not started | |
| `screens/Settings.tsx` | *(none)* | Not started | |
| `screens/SetupScreen.tsx` | `CreateTripScreen.tsx` | Not ported | TripSpend's version (38KB) covers more than trip creation alone — check what before porting 1:1 |
| `components/BottomNav.tsx` | *(the tab shell — see "Navigation shape" above)* | Blocked on decision | |
| `components/TripSwitcher.tsx` | *(none — `TripsListScreen.tsx` is the closest thing)* | Not started | Relevant to the same navigation-shape decision |
| `components/AccountSwitchDialog.tsx` | *(none)* | Not started | |
| `components/CustomSelect.tsx`, `DatePicker.tsx` | *(none yet — shared form components)* | Not started | Needed once `TripDetails`/`SetupScreen` are tackled |
| `components/NotificationCard.tsx`, `PeoplePickerSheet.tsx`, `PreSetupTripChoice.tsx` | *(none)* | Not started | |

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
- `npx tsc --noEmit` passes clean across the whole project after all of the above.

**Not verified:** actual rendered output. This sandbox has no device/simulator, so nothing
above has been visually confirmed — only that real packages installed without conflict and
the whole project compiles. Run `npx expo start` locally to confirm the Metro bundle
actually builds and the ported screen looks right, especially the two gradient components
(masked-view interacting with Metro's bundler is the one piece a clean `tsc` run can't
catch).

## Suggested order from here

1. Resolve the navigation-shape decision above — it affects how every other screen gets
   wired in, so worth settling before porting more of them.
2. `ExpenseList.tsx` / `ExpenseDetail.tsx` / `AddExpense.tsx` — no schema blockers, existing
   Expensio screens are already functional, "just" need the visual pass. `AddExpense.tsx`
   pairs naturally with the still-open non-equal-split UI work.
3. `Settlement.tsx` (the open balances/settlement TASKS.md item) — no schema blocker, but
   the largest single file; budget time for it accordingly.
4. The budget-schema product decision, unblocking `Dashboard.tsx` / `TripDetails.tsx` /
   the budget half of `Analytics.tsx`.
5. Everything else (`Settings`, `CategoryManager`, `Onboarding`, `SetupScreen`,
   `TripSwitcher`/`BottomNav`) roughly in whatever order matches which features Expensio
   actually needs next per `TASKS.md`, rather than TripSpend's own file sizes.
