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
import GradientText from '../components/GradientText';
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
        <GradientText className="text-3xl font-black tracking-tight" numberOfLines={1}>
          {trip?.name ?? '…'}
        </GradientText>
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
            colors={['#1e3a8a', '#2563eb', '#3b82f6']}
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
    backgroundColor: '#f8fafc',
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginLeft: -8,
    borderRadius: 12,
  },
  backBtnPressed: {
    backgroundColor: '#e2e8f0',
  },
  backLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  topBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  archivedBadge: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  archivedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  dateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },

  // ── Page heading ──
  heading: {
    marginBottom: 20,
  },
  headingSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  // ── Empty card ──
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    alignItems: 'center',
    marginVertical: 8,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  emptyBodyBold: {
    fontWeight: '700',
    color: '#334155',
  },

  // ── Stats section wrapper ──
  statsSection: {
    gap: 12,
  },

  // ── Hero card ──
  heroCard: {
    borderRadius: 24,
    padding: 20,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  heroLabelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  heroLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#bfdbfe',
    letterSpacing: 0.5,
  },
  preStartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  preStartText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  heroBigBalance: {
    marginBottom: 16,
  },
  heroBalanceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#93c5fd',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroBalanceValue: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -1,
    fontFamily: 'Inter_900Black',
  },
  heroBalancePct: {
    fontSize: 12,
    fontWeight: '600',
    color: '#bfdbfe',
    marginTop: 2,
  },
  heroProgressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 20,
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
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  statLabelLight: {
    color: '#93c5fd',
  },
  statLabelDark: {
    color: '#94a3b8',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statValueLight: {
    color: '#fff',
  },
  statValueDark: {
    color: '#0f172a',
  },

  // ── Warning card ──
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 20,
    padding: 16,
  },
  warningIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  warningBody: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991b1b',
    marginBottom: 3,
  },
  warningText: {
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 18,
  },
  warningBold: {
    fontWeight: '700',
  },

  // ── Spending guide card (light) ──
  spendCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  spendCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  spendCardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spendCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
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
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  spendCardBigValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.5,
    fontFamily: 'Inter_900Black',
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
    color: '#16a34a',
  },
  spendCardBurnValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ea580c',
    letterSpacing: -0.3,
  },
  spendCardBurnSuffix: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
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
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  miniCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
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
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  miniCardValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.3,
    fontFamily: 'Inter_900Black',
  },
  miniCardWarning: {
    fontSize: 10,
    fontWeight: '700',
    color: '#dc2626',
    marginTop: 4,
  },
  miniCardGreen: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16a34a',
    marginTop: 4,
  },

  // ── Generic white card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
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
    fontWeight: '800',
    color: '#0f172a',
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
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  perPersonValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
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
    color: '#334155',
  },
  categoryAmt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  categoryPct: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    width: 32,
    textAlign: 'right',
  },

  // ── Progress bar ──
  progressTrack: {
    height: 5,
    backgroundColor: '#f1f5f9',
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
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  expenseAvatarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563eb',
  },
  expenseInfo: {
    flex: 1,
    gap: 2,
  },
  expenseDesc: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  expenseMeta: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94a3b8',
  },
  expenseAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  expenseDivider: {
    height: 1,
    backgroundColor: '#f8fafc',
    marginLeft: 48,
  },

  // ── Trip health ──
  healthPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  healthPillGood: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  healthPillBad: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  healthPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  healthPillTextGood: {
    color: '#15803d',
  },
  healthPillTextBad: {
    color: '#be123c',
  },
  healthRows: {
    gap: 10,
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
    fontWeight: '600',
    color: '#475569',
  },
  healthRowValue: {
    fontSize: 13,
    fontWeight: '700',
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
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  noBudgetValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
});
