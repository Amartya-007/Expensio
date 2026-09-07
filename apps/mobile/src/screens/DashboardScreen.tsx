import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Flame,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react-native';
import { differenceInDays, format, parseISO, startOfDay } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { calculateStats } from '../utils/calculations';
import SyncStatusBanner from '../components/SyncStatusBanner';

// ─── Types ────────────────────────────────────────────────────────────────────

type Trip = {
  id: string;
  name: string;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  is_archived: number;
};

type CategoryRow = {
  category: string | null;
  total: number;
};

type RecentExpense = {
  id: string;
  description: string;
  amount: number;
  category: string | null;
  expense_date: string | null;
  created_at: string;
  paid_by_name: string | null;
};

// ─── Category colour palette ──────────────────────────────────────────────────
// Cycles through a fixed set so each category gets a consistent colour without
// a lookup table (we don't know the user's custom category names ahead of time).
const CATEGORY_COLORS = [
  { bg: '#eff6ff', accent: '#2563eb', text: '#1d4ed8' }, // blue
  { bg: '#f0fdf4', accent: '#16a34a', text: '#15803d' }, // green
  { bg: '#fdf4ff', accent: '#9333ea', text: '#7e22ce' }, // purple
  { bg: '#fff7ed', accent: '#ea580c', text: '#c2410c' }, // orange
  { bg: '#fefce8', accent: '#ca8a04', text: '#a16207' }, // yellow
  { bg: '#fff1f2', accent: '#e11d48', text: '#be123c' }, // rose
  { bg: '#f0fdfa', accent: '#0d9488', text: '#0f766e' }, // teal
];

function categoryColor(index: number) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d');
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Simple horizontal progress bar */
function ProgressBar({ pct, color = '#22c55e' }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped}%` as any, backgroundColor: color }]} />
    </View>
  );
}

/** Single stat tile used inside gradient cards */
function StatTile({
  label,
  value,
  light = false,
}: {
  label: string;
  value: string;
  light?: boolean;
}) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statLabel, light ? styles.statLabelLight : styles.statLabelDark]}>
        {label}
      </Text>
      <Text
        style={[styles.statValue, light ? styles.statValueLight : styles.statValueDark]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** A single recent-expense row */
function ExpenseRow({
  item,
  fmt,
}: {
  item: RecentExpense;
  fmt: (n: number) => string;
}) {
  const dateStr = formatDate(item.expense_date ?? item.created_at?.slice(0, 10) ?? null);
  const initials = (item.paid_by_name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.expenseRow}>
      {/* Avatar */}
      <View style={styles.expenseAvatar}>
        <Text style={styles.expenseAvatarText}>{initials}</Text>
      </View>

      {/* Description + meta */}
      <View style={styles.expenseInfo}>
        <Text style={styles.expenseDesc} numberOfLines={1}>
          {item.description || 'Expense'}
        </Text>
        <Text style={styles.expenseMeta}>
          {item.category ? `${item.category}  ·  ` : ''}
          {dateStr}
        </Text>
      </View>

      {/* Amount */}
      <Text style={styles.expenseAmount}>{fmt(item.amount)}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [expenses, setExpenses] = useState<
    Array<{ amount: number; expense_date: string | null; created_at: string }>
  >([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryRow[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([]);

  // ── Live queries ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (r) => setTrip(r.rows?._array?.[0] ?? null) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT COUNT(*) as count FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (r) => setParticipantCount(r.rows?._array?.[0]?.count ?? 0) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT amount, expense_date, created_at FROM expenses WHERE trip_id = ? AND deleted_at IS NULL',
      [tripId],
      { onResult: (r) => setExpenses(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  // Category spend breakdown (top 5 by total)
  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      `SELECT category, SUM(amount) as total
       FROM expenses
       WHERE trip_id = ? AND deleted_at IS NULL
       GROUP BY category
       ORDER BY total DESC
       LIMIT 5`,
      [tripId],
      { onResult: (r) => setCategoryBreakdown(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  // Recent expenses with payer name (5 most recent)
  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      `SELECT e.id, e.description, e.amount, e.category, e.expense_date, e.created_at,
              p.display_name as paid_by_name
       FROM expenses e
       LEFT JOIN participants p ON p.id = e.paid_by
       WHERE e.trip_id = ? AND e.deleted_at IS NULL
       ORDER BY COALESCE(e.expense_date, e.created_at) DESC
       LIMIT 5`,
      [tripId],
      { onResult: (r) => setRecentExpenses(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  // ── Derived state ─────────────────────────────────────────────────────────────

  // Memoised so calculateStats only re-runs when its inputs actually change, not on
  // every render caused by any of the 5 independent db.watch state updates.
  const stats = useMemo(
    () =>
      trip
        ? calculateStats({
            totalBudget: trip.total_budget,
            startDate: trip.start_date,
            endDate: trip.end_date,
            peopleCount: participantCount,
            expenses: expenses.map((e) => ({
              amount: e.amount,
              date: e.expense_date ?? e.created_at.slice(0, 10),
            })),
          })
        : null,
    [trip, participantCount, expenses]
  );

  const daysUntilStart = trip?.start_date
    ? differenceInDays(startOfDay(parseISO(trip.start_date)), startOfDay(new Date()))
    : 0;
  const isPreTrip = daysUntilStart > 0;

  const currency = trip?.currency ?? '';
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  // Top category for the callout
  const topCategory = categoryBreakdown[0];
  const categoryTotal = categoryBreakdown.reduce((s, c) => s + c.total, 0);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 100,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Top navigation bar ── */}
      <View style={styles.topBar}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={18} color="#334155" />
          <Text style={styles.backLabel}>Trips</Text>
        </Pressable>

        <View style={styles.topBadgeRow}>
          {!!trip?.is_archived && (
            <View style={styles.archivedBadge}>
              <Text style={styles.archivedText}>Archived</Text>
            </View>
          )}
          {!!trip?.start_date && !!trip?.end_date && (
            <View style={styles.dateBadge}>
              <Calendar size={11} color="#64748b" />
              <Text style={styles.dateBadgeText}>
                {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
              </Text>
            </View>
          )}
        </View>
      </View>

      <SyncStatusBanner />

      {/* ── Page heading ── */}
      <View style={styles.heading}>
        <Text style={styles.headingTitle} numberOfLines={1}>
          {trip?.name ?? '…'}
        </Text>
        <Text style={styles.headingSubtitle}>Budget & Spend Overview</Text>
      </View>

      {/* ── No-budget placeholder ── */}
      {!stats && trip && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Wallet size={30} color="#2563eb" />
          </View>
          <Text style={styles.emptyTitle}>No budget configured</Text>
          <Text style={styles.emptyBody}>
            Set a total budget and trip dates in the{' '}
            <Text style={styles.emptyBodyBold}>Settings tab</Text> to unlock real-time
            spend analytics, burn-rate limits, and per-person breakdowns.
          </Text>
        </View>
      )}

      {/* ── Stats section (only when budget is set) ── */}
      {stats && (
        <View style={styles.statsSection}>

          {/* ── Hero gradient card ── */}
          <LinearGradient
            colors={['#0b1c30', '#132f4c', '#1e3a8a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            {/* Header row */}
            <View style={styles.heroHeader}>
              <View style={styles.heroLabelPill}>
                <Zap size={11} color="#93c5fd" />
                <Text style={styles.heroLabelText}>Live Overview</Text>
              </View>
              {isPreTrip && (
                <View style={styles.preStartPill}>
                  <Clock size={11} color="#fff" />
                  <Text style={styles.preStartText}>
                    Starts in {daysUntilStart} day{daysUntilStart !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>

            {/* Big remaining balance */}
            <View style={styles.heroBigBalance}>
              <Text style={styles.heroBalanceLabel}>Remaining Balance</Text>
              <Text style={styles.heroBalanceValue} numberOfLines={1}>
                {fmt(stats.remainingBalance)}
              </Text>
              <Text style={styles.heroBalancePct}>
                {stats.remainingPercentage.toFixed(0)}% of{' '}
                {fmt(trip!.total_budget ?? 0)} budget
              </Text>
            </View>

            {/* Progress bar */}
            <View style={styles.heroProgressTrack}>
              <View
                style={[
                  styles.heroProgressFill,
                  {
                    width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` as any,
                    backgroundColor:
                      stats.remainingPercentage > 50
                        ? '#4ade80'
                        : stats.remainingPercentage > 20
                        ? '#fbbf24'
                        : '#f87171',
                  },
                ]}
              />
            </View>

            {/* 4-up stat grid */}
            <View style={styles.heroGrid}>
              <StatTile label="Total Spent" value={fmt(stats.totalSpent)} light />
              <StatTile label="Per Person" value={fmt(stats.perPersonSpend)} light />
              <StatTile label="Members" value={String(participantCount)} light />
              <StatTile label="Expenses" value={String(expenses.length)} light />
            </View>
          </LinearGradient>

          {/* ── Overspend warning ── */}
          {stats.isOverspending && (
            <View style={styles.warningCard}>
              <View style={styles.warningIconWrap}>
                <AlertTriangle size={20} color="#dc2626" />
              </View>
              <View style={styles.warningBody}>
                <Text style={styles.warningTitle}>Over-budget alert</Text>
                <Text style={styles.warningText}>
                  At this burn rate you'll overshoot by{' '}
                  <Text style={styles.warningBold}>{fmt(stats.projectedDeficit)}</Text>.
                  Consider trimming daily spend.
                </Text>
              </View>
            </View>
          )}

          {/* ── Spending guide card (light) ── */}
          <View style={styles.spendCard}>
            <View style={styles.spendCardHeader}>
              <View style={styles.spendCardIconWrap}>
                <Flame size={14} color="#ea580c" />
              </View>
              <Text style={styles.spendCardTitle}>Daily Spending Guide</Text>
            </View>

            <View style={styles.spendCardGrid}>
              {/* Safe to spend */}
              <View style={styles.spendCardLeft}>
                <Text style={styles.spendCardSubLabel}>Safe to spend today</Text>
                <Text style={styles.spendCardBigValue} numberOfLines={1}>
                  {fmt(stats.remainingPerDay)}
                </Text>
                <View style={styles.spendCardTag}>
                  <TrendingDown size={11} color="#16a34a" />
                  <Text style={styles.spendCardTagText}>
                    {stats.daysRemaining} day{stats.daysRemaining !== 1 ? 's' : ''} left
                  </Text>
                </View>
              </View>

              {/* Divider */}
              <View style={styles.spendCardDivider} />

              {/* Burn rate */}
              <View style={styles.spendCardRight}>
                <Text style={styles.spendCardSubLabel}>Current burn rate</Text>
                <Text style={styles.spendCardBurnValue} numberOfLines={1}>
                  {fmt(stats.dailyBurnRate)}
                </Text>
                <Text style={styles.spendCardBurnSuffix}>per day</Text>
              </View>
            </View>

            {/* Budget runway warning */}
            {stats.budgetLastsDays !== Infinity && stats.budgetLastsDays < stats.daysRemaining && (
              <View style={styles.spendCardFooter}>
                <AlertTriangle size={12} color="#d97706" />
                <Text style={styles.spendCardFooterText}>
                  At this rate, budget runs out in ~{Math.floor(stats.budgetLastsDays)} day
                  {Math.floor(stats.budgetLastsDays) !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          {/* ── Today vs Yesterday mini cards ── */}
          <View style={styles.twoColRow}>
            <View style={[styles.miniCard, styles.twoColLeft]}>
              <View style={styles.miniCardHeader}>
                <View style={[styles.miniIconWrap, { backgroundColor: '#eff6ff' }]}>
                  <CreditCard size={14} color="#2563eb" />
                </View>
                <Text style={styles.miniCardLabel}>Today</Text>
              </View>
              <Text style={styles.miniCardValue} numberOfLines={1}>
                {fmt(stats.todaySpent)}
              </Text>
              {stats.todaySpent > stats.remainingPerDay && (
                <Text style={styles.miniCardWarning}>Over daily limit</Text>
              )}
            </View>

            <View style={[styles.miniCard, styles.twoColRight]}>
              <View style={styles.miniCardHeader}>
                <View style={[styles.miniIconWrap, { backgroundColor: '#f8fafc' }]}>
                  <Clock size={14} color="#64748b" />
                </View>
                <Text style={styles.miniCardLabel}>Yesterday</Text>
              </View>
              <Text style={[styles.miniCardValue, { color: '#64748b' }]} numberOfLines={1}>
                {fmt(stats.yesterdaySpent)}
              </Text>
              {stats.yesterdaySpent === 0 && (
                <Text style={styles.miniCardGreen}>No spend</Text>
              )}
            </View>
          </View>

          {/* ── Per-person breakdown ── */}
          {participantCount > 1 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconWrap, { backgroundColor: '#f5f3ff' }]}>
                  <Users size={15} color="#7c3aed" />
                </View>
                <Text style={styles.cardTitle}>Per Person</Text>
              </View>

              <View style={styles.perPersonRow}>
                <View style={styles.perPersonBlock}>
                  <Text style={styles.perPersonLabel}>Avg. Spent</Text>
                  <Text style={styles.perPersonValue} numberOfLines={1}>
                    {fmt(stats.perPersonSpend)}
                  </Text>
                </View>
                <View style={[styles.perPersonBlock, styles.perPersonCenter]}>
                  <Text style={styles.perPersonLabel}>Remaining / person</Text>
                  <Text
                    style={[
                      styles.perPersonValue,
                      { color: stats.remainingBalance >= 0 ? '#16a34a' : '#dc2626' },
                    ]}
                    numberOfLines={1}
                  >
                    {fmt(participantCount > 0 ? stats.remainingBalance / participantCount : 0)}
                  </Text>
                </View>
                <View style={[styles.perPersonBlock, styles.perPersonRight]}>
                  <Text style={styles.perPersonLabel}>Members</Text>
                  <Text style={styles.perPersonValue}>{participantCount}</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── Category breakdown ── */}
          {categoryBreakdown.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconWrap, { backgroundColor: '#fff7ed' }]}>
                  <BarChart2 size={15} color="#ea580c" />
                </View>
                <Text style={styles.cardTitle}>Spend by Category</Text>
              </View>

              <View style={styles.categoryList}>
                {categoryBreakdown.map((row, i) => {
                  const pct = categoryTotal > 0 ? (row.total / categoryTotal) * 100 : 0;
                  const col = categoryColor(i);
                  const label = row.category || 'Uncategorised';
                  return (
                    <View key={label} style={styles.categoryRow}>
                      <View style={styles.categoryRowTop}>
                        <View style={[styles.categoryDot, { backgroundColor: col.accent }]} />
                        <Text style={styles.categoryLabel} numberOfLines={1}>
                          {label}
                        </Text>
                        <Text style={styles.categoryAmt}>{fmt(row.total)}</Text>
                        <Text style={styles.categoryPct}>{pct.toFixed(0)}%</Text>
                      </View>
                      <ProgressBar pct={pct} color={col.accent} />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Recent expenses ── */}
          {recentExpenses.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconWrap, { backgroundColor: '#f0fdf4' }]}>
                  <Receipt size={15} color="#16a34a" />
                </View>
                <Text style={styles.cardTitle}>Recent Expenses</Text>
              </View>

              <View style={styles.expenseList}>
                {recentExpenses.map((item, idx) => (
                  <View key={item.id}>
                    <ExpenseRow item={item} fmt={fmt} />
                    {idx < recentExpenses.length - 1 && (
                      <View style={styles.expenseDivider} />
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Trip health summary card ── */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: '#f0fdf4' }]}>
                {stats.isOverspending ? (
                  <TrendingDown size={15} color="#dc2626" />
                ) : (
                  <TrendingUp size={15} color="#16a34a" />
                )}
              </View>
              <Text style={styles.cardTitle}>Trip Health</Text>
              <View
                style={[
                  styles.healthPill,
                  stats.isOverspending ? styles.healthPillBad : styles.healthPillGood,
                ]}
              >
                <Text
                  style={[
                    styles.healthPillText,
                    stats.isOverspending
                      ? styles.healthPillTextBad
                      : styles.healthPillTextGood,
                  ]}
                >
                  {stats.isOverspending ? 'At Risk' : 'On Track'}
                </Text>
              </View>
            </View>

            <View style={styles.healthRows}>
              <HealthRow
                icon={<CheckCircle2 size={14} color="#16a34a" />}
                label="Trip duration"
                value={`${stats.totalDays} day${stats.totalDays !== 1 ? 's' : ''}`}
              />
              <HealthRow
                icon={<Calendar size={14} color="#2563eb" />}
                label="Days remaining"
                value={`${stats.daysRemaining} day${stats.daysRemaining !== 1 ? 's' : ''}`}
              />
              <HealthRow
                icon={<Wallet size={14} color={stats.remainingBalance >= 0 ? '#16a34a' : '#dc2626'} />}
                label="Balance"
                value={fmt(stats.remainingBalance)}
                valueColor={stats.remainingBalance >= 0 ? '#16a34a' : '#dc2626'}
              />
              {stats.projectedDeficit > 0 && (
                <HealthRow
                  icon={<AlertTriangle size={14} color="#dc2626" />}
                  label="Projected overspend"
                  value={fmt(stats.projectedDeficit)}
                  valueColor="#dc2626"
                />
              )}
            </View>
          </View>
        </View>
      )}

      {/* ── No-budget-but-has-expenses summary ── */}
      {!stats && trip && expenses.length > 0 && (
        <View style={[styles.card, { marginTop: 12 }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIconWrap, { backgroundColor: '#eff6ff' }]}>
              <Receipt size={15} color="#2563eb" />
            </View>
            <Text style={styles.cardTitle}>Expenses So Far</Text>
          </View>

          <View style={styles.noBudgetStats}>
            <View style={styles.noBudgetBlock}>
              <Text style={styles.noBudgetLabel}>Total</Text>
              <Text style={styles.noBudgetValue}>
                {fmt(expenses.reduce((s, e) => s + e.amount, 0))}
              </Text>
            </View>
            <View style={[styles.noBudgetBlock, styles.noBudgetCenter]}>
              <Text style={styles.noBudgetLabel}>Count</Text>
              <Text style={styles.noBudgetValue}>{expenses.length}</Text>
            </View>
            <View style={[styles.noBudgetBlock, styles.noBudgetRight]}>
              <Text style={styles.noBudgetLabel}>Members</Text>
              <Text style={styles.noBudgetValue}>{participantCount}</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Small HealthRow helper ────────────────────────────────────────────────────

function HealthRow({
  icon,
  label,
  value,
  valueColor = '#0f172a',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.healthRow}>
      <View style={styles.healthRowLeft}>
        {icon}
        <Text style={styles.healthRowLabel}>{label}</Text>
      </View>
      <Text style={[styles.healthRowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 12,
    marginLeft: -4,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  backBtnPressed: {
    backgroundColor: '#f1f5f9',
  },
  backLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  topBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  archivedBadge: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  archivedText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#92400e',
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eff4ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  dateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#2563eb',
  },

  // ── Page heading ──
  heading: {
    marginBottom: 16,
  },
  headingTitle: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.4,
  },
  headingSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  // ── Empty card ──
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    alignItems: 'center',
    marginVertical: 8,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#eff4ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  emptyBodyBold: {
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
  },

  // ── Stats section wrapper ──
  statsSection: {
    gap: 12,
  },

  // ── Hero card ──
  heroCard: {
    borderRadius: 16,
    padding: 20,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heroLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  heroLabelText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#bfdbfe',
    letterSpacing: 0.5,
  },
  preStartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  preStartText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ffffff',
  },
  heroBigBalance: {
    marginBottom: 14,
  },
  heroBalanceLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#93c5fd',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroBalanceValue: {
    fontSize: 34,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.5,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  heroBalancePct: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
    color: '#bfdbfe',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  heroProgressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  // ── Stat tile ──
  statTile: {
    width: '50%',
    paddingVertical: 2,
    paddingRight: 8,
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  statLabelLight: {
    color: '#93c5fd',
  },
  statLabelDark: {
    color: '#737686',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  statValueLight: {
    color: '#ffffff',
  },
  statValueDark: {
    color: '#0b1c30',
  },

  // ── Warning card ──
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#ffdad6',
    borderWidth: 1,
    borderColor: '#ffb4ab',
    borderRadius: 16,
    padding: 16,
  },
  warningIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ffb4ab',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  warningBody: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#93000a',
    marginBottom: 3,
  },
  warningText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#410002',
    lineHeight: 18,
  },
  warningBold: {
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },

  // ── Spending guide card (light) ──
  spendCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  spendCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  spendCardIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spendCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
  },
  spendCardGrid: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spendCardLeft: {
    flex: 1,
    paddingRight: 16,
  },
  spendCardDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 4,
  },
  spendCardRight: {
    flex: 1,
    paddingLeft: 16,
    alignItems: 'flex-end',
  },
  spendCardSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    letterSpacing: 0.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  spendCardBigValue: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  spendCardTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  spendCardTagText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#16a34a',
  },
  spendCardBurnValue: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#ea580c',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  spendCardBurnSuffix: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
    marginTop: 2,
  },
  spendCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  spendCardFooterText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#d97706',
  },

  // ── Two-col mini cards ──
  twoColRow: {
    flexDirection: 'row',
    gap: 10,
  },
  twoColLeft: {
    flex: 1,
  },
  twoColRight: {
    flex: 1,
  },
  miniCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  miniCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  miniIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#434655',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  miniCardValue: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  miniCardWarning: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#ba1a1a',
    marginTop: 4,
  },
  miniCardGreen: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#16a34a',
    marginTop: 4,
  },

  // ── Generic white card ──
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    flex: 1,
  },

  // ── Per-person row ──
  perPersonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  perPersonBlock: {
    flex: 1,
  },
  perPersonCenter: {
    alignItems: 'center',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#f1f5f9',
    paddingHorizontal: 8,
  },
  perPersonRight: {
    alignItems: 'flex-end',
  },
  perPersonLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  perPersonValue: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },

  // ── Category list ──
  categoryList: {
    gap: 12,
  },
  categoryRow: {
    gap: 6,
  },
  categoryRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  categoryLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  categoryAmt: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },
  categoryPct: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    width: 32,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  // ── Progress bar ──
  progressTrack: {
    height: 5,
    backgroundColor: '#eff4ff',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // ── Expense list ──
  expenseList: {
    gap: 0,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  expenseAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  expenseAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#2563eb',
  },
  expenseInfo: {
    flex: 1,
    gap: 2,
  },
  expenseDesc: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  expenseMeta: {
    fontSize: 11,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
  },
  expenseAmount: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  expenseDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginLeft: 48,
  },

  // ── Trip health ──
  healthPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  healthPillGood: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  healthPillBad: {
    backgroundColor: '#ffdad6',
    borderColor: '#ffb4ab',
  },
  healthPillText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  healthPillTextGood: {
    color: '#15803d',
  },
  healthPillTextBad: {
    color: '#ba1a1a',
  },
  healthRows: {
    gap: 8,
  },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  healthRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  healthRowLabel: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
    color: '#434655',
  },
  healthRowValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },

  // ── No-budget expenses summary ──
  noBudgetStats: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  noBudgetBlock: {
    flex: 1,
  },
  noBudgetCenter: {
    alignItems: 'center',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#f1f5f9',
    paddingHorizontal: 8,
  },
  noBudgetRight: {
    alignItems: 'flex-end',
  },
  noBudgetLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  noBudgetValue: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
});
