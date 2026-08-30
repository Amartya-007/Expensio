import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AlertTriangle, ArrowLeft } from 'lucide-react-native';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { db } from '../powersync/db';
import { calculateStats } from '../utils/calculations';
import GradientText from '../components/GradientText';

type Trip = {
  id: string;
  name: string;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  is_archived: number;
};

// Ported from tripspend/src/screens/Dashboard.tsx. Dropped: the TripSwitcher section
// (TripsListScreen already covers multi-trip navigation, no separate switcher needed
// here), the header's Settings gear icon (Settings is one tap away in the bottom tab bar
// itself now, not something Dashboard needs its own shortcut to), the browser
// Notification API overspend alert (no RN equivalent to that specific web API -- a real
// push notification for this would go through notification_events, which has no worker
// yet per 0004_notifications.sql/TASKS.md), and the "Full Analytics" CTA (no Analytics
// screen exists on this side yet -- see expensio-ui-port-plan.md's mapping table).
// formatCurrency here is `{currency} {amount}`, matching every other screen in this app
// (AddExpenseScreen, SettlementView, TripDetailScreen) rather than introducing a new
// locale-symbol formatter TripSpend had and nothing else here uses.
export default function DashboardScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [expenses, setExpenses] = useState<Array<{ amount: number; expense_date: string | null; created_at: string }>>([]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (result) => setTrip(result.rows?._array?.[0] ?? null) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT COUNT(*) as count FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (result) => setParticipantCount(result.rows?._array?.[0]?.count ?? 0) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT amount, expense_date, created_at FROM expenses WHERE trip_id = ? AND deleted_at IS NULL',
      [tripId],
      { onResult: (result) => setExpenses(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  const stats = trip
    ? calculateStats({
        totalBudget: trip.total_budget,
        startDate: trip.start_date,
        endDate: trip.end_date,
        peopleCount: participantCount,
        // expense_date is nullable (unlike TripSpend, where every expense had a date) --
        // falls back to the created_at day, same convention calculations.ts's own header
        // comment describes for whichever caller supplies it.
        expenses: expenses.map((e) => ({ amount: e.amount, date: e.expense_date ?? e.created_at.slice(0, 10) })),
      })
    : null;

  const daysUntilStart = trip?.start_date ? differenceInDays(startOfDay(parseISO(trip.start_date)), startOfDay(new Date())) : 0;
  const isPreTrip = daysUntilStart > 0;

  const currency = trip?.currency ?? '';
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="page-shell pb-32 space-y-3">
      <View className="flex-row items-center justify-between page-header">
        <Pressable onPress={onBack} className="flex-row items-center gap-2 -ml-1 p-1">
          <ArrowLeft size={18} color="#475569" />
          <Text className="text-sm font-semibold text-slate-600">Trips</Text>
        </Pressable>
      </View>

      <View>
        <GradientText className="page-title" numberOfLines={1}>
          {trip?.name ?? '…'}
        </GradientText>
        <Text className="page-subtitle">Budget Dashboard</Text>
        {!!trip?.is_archived && (
          <View className="badge-warning self-start mt-2">
            <Text className="text-xs font-bold text-amber-700">Archived</Text>
          </View>
        )}
      </View>

      {!stats && trip && (
        <View className="card-elevated p-6 items-center mt-4">
          <Text className="text-sm font-semibold text-slate-600 text-center">
            No budget set yet.
          </Text>
          <Text className="text-xs text-slate-400 text-center mt-1.5">
            Add a total budget and trip dates from the Settings tab to see your spending snapshot here.
          </Text>
        </View>
      )}

      {stats && (
        <>
          <View className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-4 shadow-lg shadow-blue-200">
            <Text className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-2">Current Trip</Text>
            {isPreTrip && (
              <View className="mb-2 self-start px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
                <Text className="text-[10px] font-bold text-blue-50">
                  Starts in {daysUntilStart} day{daysUntilStart > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            <View className="flex-row flex-wrap">
              <View className="w-1/2 mb-2">
                <Text className="text-blue-200 text-[10px]">Budget</Text>
                <Text className="font-black text-base text-white">{fmt(trip!.total_budget ?? 0)}</Text>
              </View>
              <View className="w-1/2 mb-2">
                <Text className="text-blue-200 text-[10px]">Spent</Text>
                <Text className="font-black text-base text-white">{fmt(stats.totalSpent)}</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-blue-200 text-[10px]">People</Text>
                <Text className="font-black text-base text-white">{participantCount}</Text>
              </View>
              <View className="w-1/2">
                <Text className="text-blue-200 text-[10px]">Expenses</Text>
                <Text className="font-black text-base text-white">{expenses.length}</Text>
              </View>
            </View>
          </View>

          {stats.isOverspending && (
            <View className="bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-2xl flex-row items-center gap-2.5">
              <AlertTriangle size={16} color="#ef4444" />
              <View className="flex-1">
                <Text className="font-bold text-red-800 text-sm">Budget Alert</Text>
                <Text className="text-xs text-red-700">Projected to overshoot by {fmt(stats.projectedDeficit)}.</Text>
              </View>
            </View>
          )}

          <View className={`p-4 rounded-2xl border-2 ${stats.borderColor} ${stats.bgColor}`}>
            <Text className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Remaining Balance</Text>
            <Text className={`text-4xl font-black ${stats.statusColor} mb-3`}>{fmt(stats.remainingBalance)}</Text>
            <View className="w-full bg-slate-200 rounded-full h-2 mb-2 overflow-hidden">
              <View
                className={`h-full rounded-full ${stats.statusColor.replace('text', 'bg')}`}
                style={{ width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` }}
              />
            </View>
            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-semibold text-slate-500">{stats.remainingPercentage.toFixed(1)}% of budget left</Text>
              <Text className="text-xs font-semibold text-slate-500">{stats.daysRemaining} days left</Text>
            </View>
          </View>

          {expenses.length > 0 && (
            <View className="flex-row gap-3">
              <View className="flex-1 card-elevated p-3.5">
                <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Today</Text>
                <Text className="text-xl font-black text-slate-900">{fmt(stats.todaySpent)}</Text>
              </View>
              <View className="flex-1 card-elevated p-3.5">
                <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Yesterday</Text>
                <Text className="text-xl font-black text-slate-500">{fmt(stats.yesterdaySpent)}</Text>
              </View>
            </View>
          )}

          <View className="bg-gradient-to-br from-blue-600 to-blue-700 p-4 rounded-2xl shadow-lg shadow-blue-200">
            <Text className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-2">Today's Limit</Text>
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-blue-200 text-[10px] mb-0.5">Safe to spend today</Text>
                <Text className="text-3xl font-black text-white">{fmt(stats.remainingPerDay)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-blue-200 text-[10px] mb-0.5">Burn rate</Text>
                <Text className="text-lg font-bold text-white">{fmt(stats.dailyBurnRate)}</Text>
              </View>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
