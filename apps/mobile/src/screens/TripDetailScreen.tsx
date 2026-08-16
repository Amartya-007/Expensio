import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../powersync/db';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  created_at: string;
};
type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };
type Trip = { id: string; name: string; currency: string };
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
  onOpenExpense,
}: {
  tripId: string;
  onBack: () => void;
  onAddExpense: () => void;
  onAddParticipant: () => void;
  onOpenExpense: (expenseId: string) => void;
}) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tab, setTab] = useState<'expenses' | 'log' | 'members'>('expenses');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency FROM trips WHERE id = ?',
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

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Trips</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>{trip?.name ?? '…'}</Text>

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
        <TouchableOpacity style={styles.fab} onPress={onAddParticipant}>
          <Text style={styles.fabText}>+ Add Person</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
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
});
