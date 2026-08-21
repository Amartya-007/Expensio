import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  created_at: string;
};
type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };
type Trip = { id: string; name: string; currency: string; is_archived: number };
type Participant = { id: string; display_name: string; type: string };
type Split = { expense_id: string; participant_id: string; share_amount: number };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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
      'SELECT id, description, amount, currency, paid_by, created_at FROM expenses WHERE trip_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
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

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Trips</Text>
      </TouchableOpacity>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>{trip?.name ?? '…'}</Text>
        <TouchableOpacity onPress={openTripOptions} hitSlop={12}>
          <Text style={styles.optionsButton}>⋯</Text>
        </TouchableOpacity>
      </View>
      {!!trip?.is_archived && <Text style={styles.archivedBadge}>Archived</Text>}

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'expenses' && styles.tabActive]} onPress={() => setTab('expenses')}>
          <Text style={[styles.tabText, tab === 'expenses' && styles.tabTextActive]}>Expenses</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'log' && styles.tabActive]} onPress={() => setTab('log')}>
          <Text style={[styles.tabText, tab === 'log' && styles.tabTextActive]}>Activity Log</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'members' && styles.tabActive]} onPress={() => setTab('members')}>
          <Text style={[styles.tabText, tab === 'members' && styles.tabTextActive]}>Members</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'settlement' && styles.tabActive]} onPress={onOpenSettlement}>
          <Text style={[styles.tabText, tab === 'settlement' && styles.tabTextActive]}>Settle</Text>
        </TouchableOpacity>
      </View>

      {tab === 'expenses' && (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>No expenses yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => onOpenExpense(item.id)}>
              <Text style={styles.rowTitle}>{item.description}</Text>
              <Text style={styles.rowAmount}>
                {item.currency} {item.amount.toFixed(2)} · paid by {nameFor(item.paid_by)}
              </Text>
              <Text style={styles.rowSplit}>{splitSummary(item.id, item.currency)}</Text>
              <Text style={styles.rowMeta}>{formatTimestamp(item.created_at)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {tab === 'log' && (
        <FlatList
          data={log}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>No activity yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.description}</Text>
              <Text style={styles.rowMeta}>{formatTimestamp(item.created_at)}</Text>
            </View>
          )}
        />
      )}

      {tab === 'members' && (
        <FlatList
          data={participants}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>No one here yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.display_name}</Text>
              <Text style={styles.rowMeta}>{item.type === 'placeholder' ? 'Added by you, no account' : 'Has an account'}</Text>
            </View>
          )}
        />
      )}

      {tab === 'expenses' && (
        <TouchableOpacity style={styles.fab} onPress={onAddExpense}>
          <Text style={styles.fabText}>+ Add Expense</Text>
        </TouchableOpacity>
      )}
      {tab === 'members' && (
        <View style={styles.memberActions}>
          <TouchableOpacity style={[styles.fab, styles.memberAction]} onPress={onAddParticipant}>
            <Text style={styles.fabText}>+ Add Person</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.fab, styles.memberAction]} onPress={onOpenInvite}>
            <Text style={styles.fabText}>Invite / Join</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  optionsButton: { fontSize: 22, color: '#666', paddingHorizontal: 8 },
  archivedBadge: { fontSize: 12, color: '#8a6d00', marginBottom: 12 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 8 },
  tab: { paddingVertical: 10, marginRight: 24 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#111' },
  tabText: { color: '#999', fontWeight: '600' },
  tabTextActive: { color: '#111' },
  empty: { color: '#999', marginTop: 40, textAlign: 'center' },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowAmount: { fontSize: 13, color: '#111', marginTop: 2 },
  rowSplit: { fontSize: 12, color: '#666', marginTop: 2 },
  rowMeta: { fontSize: 11, color: '#999', marginTop: 2 },
  fab: { backgroundColor: '#111', borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginTop: 12, marginBottom: 20 },
  fabText: { color: '#fff', fontWeight: '600' },
  memberActions: { flexDirection: 'row', gap: 10 },
  memberAction: { flex: 1 },
});
