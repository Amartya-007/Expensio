# Expensio — Monetization

Companion to the other five docs. Covers what's free vs. paid, how that's enforced, and the
billing infrastructure — based on the free/paid feature split from the reference app you
shared, adapted to a collaborative product rather than a solo one (see §3, where that
difference actually changes the right design, not just the implementation).

## 1. Philosophy — the one rule everything else follows

**Never gate a core collaborative action.** Joining a trip, adding an expense, splitting it,
recording or confirming a payment, leaving a comment — all free, always, for everyone,
guest or verified. The value of a group expense splitter comes entirely from *everyone in
the group* being able to participate with zero friction; paywalling that would break the
same viral loop that makes the invite system worth having at all.

What's fair game to gate: **volume** (how many trips someone creates) and **power-user
features** (custom categories, analytics, manual exchange-rate control) — never participation
itself.

## 2. Free vs. paid

| Feature | Free | Plus |
|---|---|---|
| Join / add expenses / split / settle / comment | ✅ unlimited | ✅ unlimited |
| Placeholder participants | ✅ unlimited | ✅ unlimited |
| Create a trip | ✅ up to 3 active (non-archived) | ✅ unlimited |
| Categories | ✅ default set only | ✅ + custom, with icons |
| Photo attachments | ✅ | ✅ |
| Charts & spending breakdowns | ❌ | ✅ |
| Manual exchange rate override | ❌ (always live-fetched) | ✅ |

Dropped from the reference app's list, on purpose: income tracking (out of scope for v1,
per your call), and "country statistics" specifically — that needs location tagging on
expenses, which doesn't exist in the schema and isn't worth adding just for this.

## 3. Where a collaborative app needs a different answer than a solo one

The reference app is single-player, so it never has to answer: **if one person in a shared
trip is subscribed, do the other members benefit?** For Expensio, I'd recommend **yes, for
trip-level features** — and it's a meaningfully better monetization design here, not just a
nicety:

- **Trip creation stays gated per-creator.** The "3 active trips" cap is a personal quota —
  it's about how many trips *you* start, so it stays tied to whoever calls `create_trip`.
- **Custom categories, charts, and exchange-rate override become trip-level, not
  member-level.** If *any* active member of a trip is subscribed, everyone in that trip gets
  those features for that trip. This turns a subscription into "I'll get Plus so our whole
  trip gets analytics," not "I alone get analytics while everyone else in my own shared trip
  doesn't" — a much stronger pitch for a group product, and it avoids the confusing
  UX of some members being able to do something others in the same trip can't.

This is more work than a flat per-user check (a join across `trip_members` and
`subscriptions` instead of one row lookup), but it's the right shape for what this product
actually is.

## 4. Schema

```sql
create table subscriptions (
  user_id uuid primary key references profiles(id),
  status text not null default 'free'
    check (status in ('free', 'trialing', 'active', 'expired', 'cancelled', 'grace_period')),
  platform text check (platform in ('ios', 'android')),   -- null until they ever subscribe
  product_id text,                      -- RevenueCat/store product identifier
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- Personal: does THIS user have an active subscription right now?
create function is_subscribed()
returns boolean language sql stable as $$
  select exists (
    select 1 from subscriptions
    where user_id = auth.uid()
      and status in ('trialing', 'active', 'grace_period')
      and (current_period_end is null or current_period_end > now())
  );
$$;

-- Trip-level: does ANY active member of this trip have a subscription? (§3)
create function trip_has_subscribed_member(p_trip_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from trip_members tm
    join subscriptions s on s.user_id = tm.user_id
    where tm.trip_id = p_trip_id and tm.status = 'active'
      and s.status in ('trialing', 'active', 'grace_period')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
```

## 5. Enforcement — same pattern as every other rule in this design: server-side, in the RPC

```sql
-- Inside create_trip, before the insert:
if not is_subscribed() then
  if (select count(*) from trips where created_by = auth.uid() and not is_archived) >= 3 then
    raise exception 'free plan is limited to 3 active trips — upgrade or archive one first';
  end if;
end if;

-- Inside add_custom_category, before the insert:
if not trip_has_subscribed_member(p_trip_id) then
  raise exception 'custom categories require Expensio Plus for this trip';
end if;

-- Inside add_expense / edit_expense, only when p_exchange_rate_override is provided:
if p_exchange_rate_override is not null and not trip_has_subscribed_member(p_trip_id) then
  raise exception 'manual exchange rates require Expensio Plus for this trip';
end if;
```

The client should of course also show the paywall proactively rather than let someone fill
out a whole custom-category form and get rejected at the end — but exactly like RLS and every
RPC check elsewhere in this design, the server-side check is the one that actually matters;
the client-side gate is just UX, never trusted alone.

## 6. Billing infrastructure

Recommend **RevenueCat** over hand-rolling App Store/Play Store receipt validation —
verified this is still the standard choice for a team this size: free up to $2,500/month in
tracked revenue, handles cross-platform (iOS + Android) receipt validation, entitlement
state, and subscription lifecycle (renewals, cancellations, grace periods, family sharing)
in one place instead of building against StoreKit and Play Billing separately. Trial period
+ annual pricing ("1 week free, then ₹2,200/year" — same structure as the reference app) is
configured directly in App Store Connect / Play Console as an introductory offer; RevenueCat
just reports it. "Redeem Code" and "Restore Purchases" are both native RevenueCat/store
capabilities, not custom build work.

**Webhook flow:** RevenueCat → webhook → a FastAPI endpoint (or a Supabase Edge Function) →
updates the `subscriptions` row for that `user_id`. This is the only place `subscriptions`
gets written from outside the RPCs above — client apps never write to it directly, matching
the "server is the source of truth for anything that gates access" pattern used everywhere
else in this design.

## 7. Still open

- **Actual free-trip cap (3) and price (₹2,200/year) are placeholders** matching the
  reference app's numbers — real pricing is a business decision, not an architecture one.
- **What happens to a trip's paid features when the subscribed member leaves it?** Under
  §3's design, the trip-level unlock would simply stop applying once no active member is
  subscribed — worth deciding if custom categories/data already created should stay
  visible (read-only) or actually become unusable going forward. Recommend: stay visible,
  just can't add new ones — consistent with never destroying existing data anywhere else in
  this design.
