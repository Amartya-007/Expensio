import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../powersync/db';

type Expense = { id: string; description: string; amount: number; currency: string; created_at: string };
type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };
type Trip = { id: string; name: string; currency: string };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TripDetailScreen({
  tripId,
  onBack,
  onAddExpense,
}: {
  tripId: string;
  onBack: () => void;
  onAddExpense: () => void;
}) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tab, setTab] = useState<'expenses' | 'log'>('expenses');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [log, setLog] = useState<ActivityEntry[]>([]);

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
      'SELECT id, description, amount, currency, created_at FROM expenses WHERE trip_id = ? ORDER BY created_at DESC',
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
      </View>

      {tab === 'expenses' ? (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>No expenses yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.description}</Text>
              <Text style={styles.rowAmount}>
                {item.currency} {item.amount.toFixed(2)}
              </Text>
              <Text style={styles.rowMeta}>{formatTimestamp(item.created_at)}</Text>
            </View>
          )}
        />
      ) : (
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

      {tab === 'expenses' && (
        <TouchableOpacity style={styles.fab} onPress={onAddExpense}>
          <Text style={styles.fabText}>+ Add Expense</Text>
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
  rowMeta: { fontSize: 11, color: '#999', marginTop: 2 },
  fab: { backgroundColor: '#111', borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginTop: 12, marginBottom: 20 },
  fabText: { color: '#fff', fontWeight: '600' },
});
