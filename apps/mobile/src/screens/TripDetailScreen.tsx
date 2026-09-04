import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import GradientText from '../components/GradientText';
import SettlementView from '../components/SettlementView';
import TripTabBar, { TripTab } from '../components/TripTabBar';
import DashboardScreen from './DashboardScreen';
import TripSettingsScreen from './TripSettingsScreen';
import { colorFor } from '../utils/avatarColor';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  category: string | null;
  created_at: string;
};
type Trip = { id: string; name: string; currency: string; is_archived: number };
type Participant = { id: string; display_name: string; type: string };
type Split = { expense_id: string; participant_id: string; share_amount: number };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// This screen is now the persistent tab-bar shell -- Home/Expenses/Settle/Settings +
// raised center FAB, ported from tripspend/src/components/BottomNav.tsx -- rather than
// the old in-page Expenses/Log/Members/Settle tab row it used to render (see git history
// / TASKS.md for that version). See docs/architecture/expensio-ui-port-plan.md's
// "Navigation shape" section for the full history of why this was blocked, then
// unblocked.
//
// Log and Members moved out to their own screens (ActivityLogScreen.tsx,
// MembersScreen.tsx), reachable from the new Settings tab -- matching TripSpend's actual
// structure more closely than the old flat tab row did (TripSpend's own member
// management isn't a bottom tab either, it sits one level under Settings). The
// FAB/Add-Expense button that used to float only over the Expenses tab is now the shared
// center FAB in the tab bar, visible from every tab, same as TripSpend's BottomNav.tsx.
// The old three-dot options menu (archive/delete/leave/recurring) moved into
// TripSettingsScreen as visible rows.
//
// Each tab body is a self-contained screen with its own header (matching how TripSpend's
// own routes each render full-screen with their own header, not one shared chrome) --
// this component itself supplies almost no chrome beyond the fixed tab bar at the bottom.
// Settle is the one exception: SettlementView is deliberately header-less (built to be
// embedded, see its own file), so a small header is rendered here just for that tab.
export default function TripDetailScreen({
  tripId,
  onBack,
  onAddExpense,
  onOpenExpense,
  onOpenMembers,
  onOpenActivityLog,
  onOpenRecurring,
}: {
  tripId: string;
  onBack: () => void;
  onAddExpense: () => void;
  onOpenExpense: (expenseId: string) => void;
  onOpenMembers: () => void;
  onOpenActivityLog: () => void;
  onOpenRecurring: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TripTab>('home');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (result) => setTrip(result.rows?._array?.[0] ?? null) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, description, amount, currency, paid_by, category, created_at FROM expenses WHERE trip_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      [tripId],
      { onResult: (result) => setExpenses(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name, type FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (result) => setParticipants(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    // expense_splits syncs via its own bucket keyed by expense_id, not trip_id (see
    // sync-rules.yaml's header comment for why) -- but it's still just a normal local
    // table once synced, so a plain join against this trip's expenses works exactly like
    // any other query.
    const abortController = new AbortController();
    db.watch(
      `SELECT s.expense_id, s.participant_id, s.share_amount FROM expense_splits s
       JOIN expenses e ON e.id = s.expense_id WHERE e.trip_id = ?`,
      [tripId],
      { onResult: (result) => setSplits(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  const nameFor = (participantId: string) =>
    participants.find((p) => p.id === participantId)?.display_name ?? '\u2026';

  const splitSummary = (expenseId: string, currency: string) =>
    splits
      .filter((s) => s.expense_id === expenseId)
      .map((s) => `${nameFor(s.participant_id)} owes ${currency} ${s.share_amount.toFixed(2)}`)
      .join(' \u00b7 ');

  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white">
      {activeTab === 'home' && <DashboardScreen tripId={tripId} onBack={onBack} />}

      {activeTab === 'expenses' && (
        <View className="flex-1">
          <View style={{ paddingTop: Math.max(insets.top, 16) }} className="px-4 pb-2 bg-white border-b border-slate-100">
            <View className="flex-row items-center gap-3 py-1">
              <Pressable onPress={onBack} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
                <ArrowLeft size={20} color="#1e293b" />
              </Pressable>
              <View className="flex-1">
                <GradientText className="text-2xl font-black" numberOfLines={1}>
                  {trip?.name ?? '\u2026'}
                </GradientText>
                <Text className="text-xs font-semibold text-slate-500">Expenses</Text>
              </View>
              {!!trip?.is_archived && (
                <View className="bg-amber-100 border border-amber-200 px-3 py-1 rounded-full">
                  <Text className="text-xs font-bold text-amber-800">Archived</Text>
                </View>
              )}
            </View>
          </View>
          <FlatList
            data={expenses}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 16) + 90,
            }}
            ListEmptyComponent={
              <View className="items-center py-16">
                <Text className="text-sm font-semibold text-slate-400 text-center">No expenses yet.</Text>
                <Text className="text-xs text-slate-400 text-center mt-1">Tap the + button below to add your first expense.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const color = colorFor(item.paid_by);
              return (
                <Pressable
                  onPress={() => onOpenExpense(item.id)}
                  className="bg-white rounded-2xl p-4 flex-row items-center gap-3 mb-3 active:bg-slate-50"
                  style={{
                    borderWidth: 1,
                    borderColor: 'rgba(226, 232, 240, 0.8)',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 2,
                    elevation: 1,
                  }}
                >
                  <View className={`w-12 h-12 rounded-2xl items-center justify-center ${color.bg} border ${color.border}`}>
                    <Text className={`text-base font-black ${color.text}`}>{item.description[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="font-bold text-slate-900 text-base flex-1" numberOfLines={1}>
                        {item.description}
                      </Text>
                      <Text className="font-black text-slate-900 text-base">
                        {item.currency} {item.amount.toFixed(2)}
                      </Text>
                    </View>
                    <Text className="text-xs text-slate-500 mt-0.5" numberOfLines={1}>
                      paid by {nameFor(item.paid_by)}
                      {item.category ? ` \u00b7 ${item.category}` : ''}
                    </Text>
                    <Text className="text-xs text-slate-400 mt-0.5" numberOfLines={1}>
                      {splitSummary(item.id, item.currency)}
                    </Text>
                    <Text className="text-[11px] text-slate-400 mt-1">{formatTimestamp(item.created_at)}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {activeTab === 'settle' && (
        <View className="flex-1">
          <View style={{ paddingTop: Math.max(insets.top, 16) }} className="px-4 pb-2 bg-white border-b border-slate-100">
            <View className="flex-row items-center gap-3 py-1">
              <Pressable onPress={onBack} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
                <ArrowLeft size={20} color="#1e293b" />
              </Pressable>
              <View>
                <GradientText className="text-2xl font-black" numberOfLines={1}>
                  {trip?.name ?? '\u2026'}
                </GradientText>
                <Text className="text-xs font-semibold text-slate-500">Settle Up & Balances</Text>
              </View>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 16) + 90,
            }}
          >
            <SettlementView tripId={tripId} />
          </ScrollView>
        </View>
      )}

      {activeTab === 'settings' && (
        <TripSettingsScreen
          tripId={tripId}
          onBack={onBack}
          onOpenMembers={onOpenMembers}
          onOpenActivityLog={onOpenActivityLog}
          onOpenRecurring={onOpenRecurring}
        />
      )}

      <TripTabBar active={activeTab} onChange={setActiveTab} onAddExpense={onAddExpense} />
    </View>
  );
}
