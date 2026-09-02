import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AlertTriangle, ArrowLeft, Calendar, DollarSign, TrendingDown, Users, Wallet } from 'lucide-react-native';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export default function DashboardScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
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
        expenses: expenses.map((e) => ({ amount: e.amount, date: e.expense_date ?? e.created_at.slice(0, 10) })),
      })
    : null;

  const daysUntilStart = trip?.start_date ? differenceInDays(startOfDay(parseISO(trip.start_date)), startOfDay(new Date())) : 0;
  const isPreTrip = daysUntilStart > 0;

  const currency = trip?.currency ?? '';
  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  return (
    <ScrollView
      className="flex-1 bg-slate-50/50"
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 90,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Bar Navigation */}
      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={onBack}
          className="flex-row items-center gap-2 py-2 px-3 -ml-2 rounded-xl active:bg-slate-200/60"
        >
          <ArrowLeft size={20} color="#1e293b" />
          <Text className="text-sm font-bold text-slate-800">Trips</Text>
        </Pressable>

        {!!trip?.is_archived && (
          <View className="bg-amber-100 border border-amber-200 px-3 py-1 rounded-full">
            <Text className="text-xs font-bold text-amber-800">Archived</Text>
          </View>
        )}
      </View>

      {/* Trip Title & Subtitle */}
      <View className="mb-5">
        <GradientText className="text-3xl font-black tracking-tight" numberOfLines={1}>
          {trip?.name ?? '…'}
        </GradientText>
        <Text className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-1">
          Budget & Spend Overview
        </Text>
      </View>

      {!stats && trip && (
        <View className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm items-center my-4">
          <View className="w-14 h-14 rounded-2xl bg-blue-50 items-center justify-center mb-3">
            <Wallet size={28} color="#2563eb" />
          </View>
          <Text className="text-base font-bold text-slate-900 text-center">
            No budget set yet
          </Text>
          <Text className="text-xs text-slate-500 text-center mt-1 leading-relaxed max-w-xs">
            Add a total budget and trip dates in the Settings tab to unlock real-time spend analytics and burn rate limits.
          </Text>
        </View>
      )}

      {stats && (
        <View className="space-y-4">
          {/* Card 1: Hero Overview Card with Gradient */}
          <LinearGradient
            colors={['#1e40af', '#2563eb', '#3b82f6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-3xl p-5 shadow-xl shadow-blue-500/20"
            style={{ elevation: 6 }}
          >
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-blue-100 text-xs font-bold uppercase tracking-wider">Current Trip</Text>
              {isPreTrip && (
                <View className="px-3 py-1 rounded-full bg-white/20 border border-white/25">
                  <Text className="text-[11px] font-bold text-white">
                    Starts in {daysUntilStart} day{daysUntilStart > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>

            <View className="flex-row flex-wrap">
              <View className="w-1/2 mb-4 pr-2">
                <Text className="text-blue-100/80 text-[11px] font-semibold mb-0.5">Budget</Text>
                <Text className="font-black text-xl text-white tracking-tight" numberOfLines={1}>
                  {fmt(trip!.total_budget ?? 0)}
                </Text>
              </View>

              <View className="w-1/2 mb-4 pl-2">
                <Text className="text-blue-100/80 text-[11px] font-semibold mb-0.5">Total Spent</Text>
                <Text className="font-black text-xl text-white tracking-tight" numberOfLines={1}>
                  {fmt(stats.totalSpent)}
                </Text>
              </View>

              <View className="w-1/2 pr-2">
                <Text className="text-blue-100/80 text-[11px] font-semibold mb-0.5">Participants</Text>
                <Text className="font-black text-xl text-white tracking-tight">
                  {participantCount}
                </Text>
              </View>

              <View className="w-1/2 pl-2">
                <Text className="text-blue-100/80 text-[11px] font-semibold mb-0.5">Total Expenses</Text>
                <Text className="font-black text-xl text-white tracking-tight">
                  {expenses.length}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* Overspending Warning */}
          {stats.isOverspending && (
            <View className="bg-red-50 border border-red-200 px-4 py-3 rounded-2xl flex-row items-center gap-3">
              <View className="w-9 h-9 rounded-xl bg-red-100 items-center justify-center">
                <AlertTriangle size={18} color="#dc2626" />
              </View>
              <View className="flex-1">
                <Text className="font-bold text-red-900 text-sm">Budget Alert</Text>
                <Text className="text-xs text-red-700 mt-0.5">
                  Projected to overshoot by {fmt(stats.projectedDeficit)}.
                </Text>
              </View>
            </View>
          )}

          {/* Card 2: Remaining Balance Card */}
          <View className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Remaining Balance
              </Text>
              <View className={`px-2.5 py-0.5 rounded-full ${stats.remainingBalance >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <Text className={`text-[11px] font-bold ${stats.remainingBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {stats.remainingPercentage.toFixed(0)}% Left
                </Text>
              </View>
            </View>

            <Text
              className={`text-3xl font-black mb-3 tracking-tight ${stats.remainingBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
              numberOfLines={1}
            >
              {fmt(stats.remainingBalance)}
            </Text>

            {/* Progress Bar */}
            <View className="w-full bg-slate-100 rounded-full h-2.5 mb-3 overflow-hidden">
              <View
                className={`h-full rounded-full ${stats.remainingBalance >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                style={{ width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` }}
              />
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-semibold text-slate-500">
                {fmt(stats.totalSpent)} spent so far
              </Text>
              <Text className="text-xs font-semibold text-slate-700">
                {stats.daysRemaining} days remaining
              </Text>
            </View>
          </View>

          {/* Card 3: Daily Limit & Burn Rate with Dark Slate Card */}
          <LinearGradient
            colors={['#0f172a', '#1e293b']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="p-5 rounded-3xl shadow-lg shadow-slate-900/10"
            style={{ elevation: 5 }}
          >
            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
              Today's Spending Guide
            </Text>
            <View className="flex-row items-end justify-between">
              <View className="flex-1 pr-2">
                <Text className="text-slate-400 text-[11px] font-semibold mb-1">Safe to spend today</Text>
                <Text className="text-2xl font-black text-white tracking-tight" numberOfLines={1}>
                  {fmt(stats.remainingPerDay)}
                </Text>
              </View>
              <View className="items-end pl-2">
                <Text className="text-slate-400 text-[11px] font-semibold mb-1">Current burn rate</Text>
                <Text className="text-lg font-bold text-amber-400">
                  {fmt(stats.dailyBurnRate)}/day
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* Quick Stats: Today vs Yesterday */}
          {expenses.length > 0 && (
            <View className="flex-row gap-3">
              <View className="flex-1 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <Text className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Today</Text>
                <Text className="text-lg font-black text-slate-900" numberOfLines={1}>
                  {fmt(stats.todaySpent)}
                </Text>
              </View>
              <View className="flex-1 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
                <Text className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Yesterday</Text>
                <Text className="text-lg font-black text-slate-600" numberOfLines={1}>
                  {fmt(stats.yesterdaySpent)}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
