import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../powersync/db';
import { flushPendingActions } from '../rpc';

type Trip = { id: string; name: string; currency: string; created_at: string; is_archived: number };

export default function TripsListScreen({
  onOpenTrip,
  onCreateTrip,
}: {
  onOpenTrip: (tripId: string, currency: string) => void;
  onCreateTrip: () => void;
}) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency, created_at, is_archived FROM trips WHERE is_archived = ? ORDER BY created_at DESC',
      [showArchived ? 1 : 0],
      { onResult: (result) => setTrips(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [showArchived]);

  useEffect(() => {
    // pending_actions is a plain local table, same watch mechanism works on it —
    // this is what turns "N changes waiting to sync" into a live count rather than a
    // one-time check.
    const abortController = new AbortController();
    db.watch(
      'SELECT count(*) as n FROM pending_actions',
      [],
      { onResult: (result) => setPendingCount(result.rows?._array?.[0]?.n ?? 0) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await flushPendingActions();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>{showArchived ? 'Archived trips' : 'Your trips'}</Text>
        {!showArchived && (
          <TouchableOpacity style={styles.addButton} onPress={onCreateTrip}>
            <Text style={styles.addButtonText}>+ New Trip</Text>
          </TouchableOpacity>
        )}
      </View>

      {pendingCount > 0 && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingText}>
            {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to sync — pull to refresh once you're back online
          </Text>
        </View>
      )}

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {showArchived ? 'No archived trips.' : 'No trips yet — create one to get started.'}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.tripCard} onPress={() => onOpenTrip(item.id, item.currency)}>
            <Text style={styles.tripName}>{item.name}</Text>
            <Text style={styles.tripMeta}>{item.currency}</Text>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity onPress={() => setShowArchived((v) => !v)}>
        <Text style={styles.archivedToggle}>{showArchived ? '‹ Back to your trips' : 'Show archived trips'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700' },
  addButton: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  pendingBanner: { backgroundColor: '#fff8e1', borderRadius: 8, padding: 10, marginBottom: 12 },
  pendingText: { color: '#8a6d00', fontSize: 12 },
  empty: { color: '#999', marginTop: 40, textAlign: 'center' },
  tripCard: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tripName: { fontSize: 16, fontWeight: '600' },
  tripMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  archivedToggle: { color: '#666', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
});
