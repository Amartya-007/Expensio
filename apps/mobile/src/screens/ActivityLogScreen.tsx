import { useEffect, useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react-native';
import { FlatList, Pressable, Text, View } from 'react-native';
import { db } from '../powersync/db';

type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Extracted from TripDetailScreen.tsx's old in-page 'log' tab body, once that tab moved
// out to make room for the Home/Expenses/Settle/Settings bottom tab bar. No TripSpend
// screen to port from (this feature doesn't exist there at all -- it's the one this whole
// project actually started from, per the original db.watch comment, kept below). Given a
// home under the new Settings tab, next to Members, rather than invented a bottom tab of
// its own that TripSpend's BottomNav.tsx doesn't have.
export default function ActivityLogScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [log, setLog] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    // What makes this "immutable" is enforced in Postgres (0002_core_schema.sql's
    // trigger + the RLS policy with no UPDATE/DELETE rule), not anything about this
    // screen -- this is just a live view onto rows that can only ever be inserted, never
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
    <View className="flex-1 bg-white">
      <View className="page-shell pb-0">
        <View className="flex-row items-center gap-3 page-header">
          <Pressable onPress={onBack} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#64748b" />
          </Pressable>
          <Text className="page-title">Activity Log</Text>
        </View>
      </View>

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
    </View>
  );
}
