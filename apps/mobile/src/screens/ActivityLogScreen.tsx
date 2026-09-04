import { useEffect, useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react-native';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import GradientText from '../components/GradientText';

type ActivityEntry = { id: string; event_type: string; description: string; created_at: string };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ActivityLogScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [log, setLog] = useState<ActivityEntry[]>([]);

  useEffect(() => {
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
      {/* Header */}
      <View style={{ paddingTop: Math.max(insets.top, 16) }} className="px-4 pb-3 bg-white border-b border-slate-100">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={onBack} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#1e293b" />
          </Pressable>
          <View>
            <GradientText className="text-2xl font-black">Activity Log</GradientText>
            <Text className="text-xs font-semibold text-slate-500">History of changes, payments, and events</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={log}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 24,
        }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-sm font-semibold text-slate-400">No activity recorded yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            className="flex-row items-start gap-3.5 py-3.5 px-3 mb-2 rounded-2xl bg-slate-50"
            style={{ borderWidth: 1, borderColor: 'rgba(226, 232, 240, 0.6)' }}
          >
            <View className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 items-center justify-center mt-0.5">
              <Clock size={16} color="#2563eb" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-slate-800 leading-snug">{item.description}</Text>
              <Text className="text-[11px] font-semibold text-slate-400 mt-1">{formatTimestamp(item.created_at)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
