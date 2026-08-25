import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { ArrowLeft, Clock, MoreHorizontal, Plus, UserPlus, Users } from 'lucide-react-native';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  category: string | null;
  created_at: string;
};
type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };
type Trip = { id: string; name: string; currency: string; is_archived: number };
type Participant = { id: string; display_name: string; type: string };
type Split = { expense_id: string; participant_id: string; share_amount: number };

const AVATAR_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700' },
  { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700' },
  { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-700' },
  { bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-700' },
];
function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Ported visually from tripspend/src/screens/ExpenseList.tsx's row card (icon avatar +
// title/amount/meta layout) and GroupMemberManager.tsx's colored-initial badge pattern --
// see docs/architecture/expensio-ui-port-plan.md. Not a structural port: TripSpend's
// ExpenseList filters against a fixed category enum (Food/Travel/Stay/Misc) with a
// per-category icon map, which doesn't fit Expensio's free-text custom categories -- used
// a colored initial badge instead of a category icon, same device this file already uses
// for participant avatars. The options menu (Alert.alert) is native OS chrome and can't be
// restyled; left as-is. All data-fetching (db.watch queries), business logic (nameFor,
// splitSummary, openTripOptions and every RPC call inside it), and the tab/screen
// structure itself are unchanged from before this pass -- only the JSX and, per the
// pattern already established in ExpenseDetailScreen.tsx, added `category` to the
// expenses query (it already existed on the table, just wasn't being read here either).
export default function TripDetailScreen({
  tripId,
  onBack,
  onAddExpense,
  onAddParticipant,
  onOpenInvite,
  onOpenSettlement,
  onOpenRecurring,
  onOpenExpense,
}: {
  tripId: string;
  onBack: () => void;
  onAddExpense: () => void;
  onAddParticipant: () => void;
  onOpenInvite: () => void;
  onOpenSettlement: () => void;
  onOpenRecurring: () => void;
  onOpenExpense: (expenseId: string) => void;
}) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tab, setTab] = useState<'expenses' | 'log' | 'members' | 'settlement'>('expenses');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [log, setLog] = useState<ActivityEntry[]>([]);
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
    // This is the feature the whole project started from: a separate, immutable log
    // per trip. What makes it "immutable" is enforced in Postgres (0002_core_schema.sql's
    // trigger + the RLS policy with no UPDATE/DELETE rule), not anything about this
    // screen — this is just a live view onto rows that can only ever be inserted, never
    // changed, once they land here.
    const abortController = new AbortController();
    db.watch(
      'SELECT id, event_type, description, created_at FROM trip_activity_log WHERE trip_id = ? ORDER BY created_at DESC',
      [tripId],
      { onResult: (result) => setLog(result.rows?._array ?? []) },
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
    // sync-rules.yaml's header comment for why) — but it's still just a normal local
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
    participants.find((p) => p.id === participantId)?.display_name ?? '…';

  const splitSummary = (expenseId: string, currency: string) =>
    splits
      .filter((s) => s.expense_id === expenseId)
      .map((s) => `${nameFor(s.participant_id)} owes ${currency} ${s.share_amount.toFixed(2)}`)
      .join(' · ');

  function openTripOptions() {
    const archiveLabel = trip?.is_archived ? 'Unarchive Trip' : 'Archive Trip';
    Alert.alert(trip?.name ?? 'Trip options', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Recurring expenses', onPress: onOpenRecurring },
      {
        text: archiveLabel,
        onPress: async () => {
          // Neither RPC takes p_client_request_id -- idempotent: false tells callRpc not
          // to send one, since PostgREST would reject an unexpected parameter (see
          // rpc.ts's header comment). Both toggle a plain boolean, so replaying one after
          // a dropped connection is harmless even without a formal idempotency key.
          const rpcName = trip?.is_archived ? 'unarchive_trip' : 'archive_trip';
          await callRpc(rpcName, { p_trip_id: tripId }, { idempotent: false });
        },
      },
      {
        text: 'Delete Trip',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Delete this trip?',
            'Only works while you\u2019re the only active member. This cannot be undone from here.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await callRpc('delete_trip', { p_trip_id: tripId }, { idempotent: false });
                    onBack();
                  } catch (err) {
                    Alert.alert('Could not delete trip', String(err));
                  }
                },
              },
            ]
          );
        },
      },
      {
        text: 'Leave Trip',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Leave this trip?', 'Your historical expenses stay in the trip, but you will lose access.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: async () => {
                try {
                  await callRpc('leave_trip', { p_trip_id: tripId }, { idempotent: false });
                  onBack();
                } catch (err) {
                  Alert.alert('Could not leave trip', String(err));
                }
              },
            },
          ]);
        },
      },
    ]);
  }

  const TABS: Array<{ key: typeof tab; label: string; onPress: () => void }> = [
    { key: 'expenses', label: 'Expenses', onPress: () => setTab('expenses') },
    { key: 'log', label: 'Activity Log', onPress: () => setTab('log') },
    { key: 'members', label: 'Members', onPress: () => setTab('members') },
    { key: 'settlement', label: 'Settle', onPress: onOpenSettlement },
  ];

  return (
    <View className="flex-1 bg-white">
      <View className="page-shell pb-0 space-y-4">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={onBack} className="flex-row items-center gap-2 -ml-1 p-1">
            <ArrowLeft size={18} color="#475569" />
            <Text className="text-sm font-semibold text-slate-600">Trips</Text>
          </Pressable>
          <Pressable onPress={openTripOptions} hitSlop={12} className="p-2 rounded-xl active:bg-slate-100">
            <MoreHorizontal size={20} color="#64748b" />
          </Pressable>
        </View>

        <View>
          <GradientText className="page-title" numberOfLines={1}>
            {trip?.name ?? '…'}
          </GradientText>
          {!!trip?.is_archived && (
            <View className="badge-warning self-start mt-2">
              <Text className="text-xs font-bold text-amber-700">Archived</Text>
            </View>
          )}
        </View>

        <View className="flex-row border-b border-slate-100">
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={t.onPress} className="mr-6 pb-3">
              <Text className={`text-sm font-bold ${tab === t.key ? 'text-slate-900' : 'text-slate-400'}`}>{t.label}</Text>
              {tab === t.key && <View className="h-0.5 bg-slate-900 rounded-full mt-2" />}
            </Pressable>
          ))}
        </View>
      </View>

      {tab === 'expenses' && (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-28 pt-3"
          ListEmptyComponent={<Text className="text-slate-400 text-center mt-16">No expenses yet.</Text>}
          renderItem={({ item }) => {
            const color = colorFor(item.paid_by);
            return (
              <Pressable
                onPress={() => onOpenExpense(item.id)}
                className="card-elevated p-4 flex-row items-center gap-3 mb-3"
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
                    {item.category ? ` · ${item.category}` : ''}
                  </Text>
                  <Text className="text-xs text-slate-400 mt-0.5" numberOfLines={1}>
                    {splitSummary(item.id, item.currency)}
                  </Text>
                  <Text className="text-[11px] text-slate-300 mt-1">{formatTimestamp(item.created_at)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {tab === 'log' && (
        <FlatList
          data={log}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-8 pt-3"
          ListEmptyComponent={<Text className="text-slate-400 text-center mt-16">No activity yet.</Text>}
          renderItem={({ item }) => (
            <View className="flex-row items-start gap-3 py-3 border-b border-slate-50">
              <View className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 items-center justify-center mt-0.5">
                <Clock size={13} color="#94a3b8" />
              </View>
              <View className="flex-1">
                <Text className="text-sm text-slate-700">{item.description}</Text>
                <Text className="text-xs text-slate-400 mt-0.5">{formatTimestamp(item.created_at)}</Text>
              </View>
            </View>
          )}
        />
      )}

      {tab === 'members' && (
        <FlatList
          data={participants}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-28 pt-3"
          ListEmptyComponent={<Text className="text-slate-400 text-center mt-16">No one here yet.</Text>}
          renderItem={({ item }) => {
            const color = colorFor(item.id);
            return (
              <View className="flex-row items-center gap-3 py-3 border-b border-slate-50">
                <View className={`w-10 h-10 rounded-full items-center justify-center ${color.bg} border ${color.border}`}>
                  <Text className={`text-sm font-black ${color.text}`}>{item.display_name[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-slate-900">{item.display_name}</Text>
                  <Text className="text-xs text-slate-400 mt-0.5">
                    {item.type === 'placeholder' ? 'Added by you, no account' : 'Has an account'}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {tab === 'expenses' && (
        <View className="absolute bottom-6 left-4 right-4">
          <PrimaryButton onPress={onAddExpense} icon={<Plus size={16} color="#fff" />} className="w-full">
            Add Expense
          </PrimaryButton>
        </View>
      )}
      {tab === 'members' && (
        <View className="absolute bottom-6 left-4 right-4 flex-row gap-3">
          <Pressable onPress={onAddParticipant} className="flex-1 btn-secondary flex-row items-center justify-center gap-2">
            <UserPlus size={16} color="#475569" />
            <Text className="text-slate-600 font-bold text-sm">Add Person</Text>
          </Pressable>
          <Pressable onPress={onOpenInvite} className="flex-1 bg-slate-900 rounded-2xl py-3 flex-row items-center justify-center gap-2">
            <Users size={16} color="#fff" />
            <Text className="text-white font-bold text-sm">Invite / Join</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
