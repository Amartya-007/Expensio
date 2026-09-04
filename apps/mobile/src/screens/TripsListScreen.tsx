import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ArrowRight, Compass, MapPin, Plus, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { flushPendingActions } from '../rpc';
import GradientText from '../components/GradientText';
import PrimaryButton from '../components/PrimaryButton';
import SyncStatusBanner from '../components/SyncStatusBanner';

type Trip = {
  id: string;
  name: string;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  created_at: string;
  is_archived: number;
};

export default function TripsListScreen({
  onOpenTrip,
  onCreateTrip,
}: {
  onOpenTrip: (tripId: string, currency: string) => void;
  onCreateTrip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, created_at, is_archived FROM trips WHERE is_archived = ? ORDER BY created_at DESC',
      [showArchived ? 1 : 0],
      { onResult: (result) => setTrips(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [showArchived]);

  useEffect(() => {
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

  if (!showArchived && trips.length === 0) {
    return (
      <View
        style={{
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        }}
        className="flex-1 bg-white px-6 items-center justify-center"
      >
        <View
          className="w-20 h-20 rounded-3xl bg-blue-50 border border-blue-100 items-center justify-center mb-6"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <Compass size={40} color="#2563eb" strokeWidth={2} />
        </View>

        <GradientText className="text-3xl font-black tracking-tight text-center mb-2">
          Plan Your Next Adventure
        </GradientText>
        <Text className="text-sm text-slate-500 text-center mb-8 max-w-[280px] leading-relaxed">
          Track shared expenses, set daily budgets, and split bills effortlessly with your travel group.
        </Text>

        <PrimaryButton
          onPress={onCreateTrip}
          icon={<ArrowRight size={18} color="#fff" strokeWidth={2.5} />}
          className="w-full max-w-xs"
          style={{
            shadowColor: '#3b82f6',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 6,
          }}
        >
          Create Trip
        </PrimaryButton>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16),
        backgroundColor: 'rgba(248, 250, 252, 0.6)',
      }}
      className="flex-1 px-4"
    >
      {/* Top Header */}
      <View className="flex-row items-center justify-between py-2 mb-4">
        <View>
          <GradientText className="text-3xl font-black tracking-tight">
            {showArchived ? 'Archived Trips' : 'Your Trips'}
          </GradientText>
          <Text className="text-xs font-semibold text-slate-500 mt-0.5">
            {trips.length} {trips.length === 1 ? 'trip' : 'trips'} total
          </Text>
        </View>

        {!showArchived && (
          <Pressable
            onPress={onCreateTrip}
            className="flex-row items-center gap-1.5 bg-blue-600 rounded-2xl px-4 py-2.5 active:scale-95"
            style={{
              shadowColor: '#3b82f6',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 6,
              elevation: 3,
            }}
          >
            <Plus size={16} color="#ffffff" strokeWidth={3} />
            <Text className="text-white font-black text-sm">New Trip</Text>
          </Pressable>
        )}
      </View>

      <SyncStatusBanner />

      {pendingCount > 0 && (
        <View className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-3">
          <Text className="text-xs text-amber-800 font-bold">
            {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to sync — pull down to refresh
          </Text>
        </View>
      )}

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-sm font-semibold text-slate-400">No archived trips found.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpenTrip(item.id, item.currency)}
            className="bg-white rounded-3xl p-4.5 mb-3.5 active:bg-slate-50"
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
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 items-center justify-center">
                  <MapPin size={22} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-slate-900 text-lg" numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.start_date ? (
                    <Text className="text-xs font-semibold text-slate-400 mt-0.5">
                      {item.start_date} {item.end_date ? `to ${item.end_date}` : ''}
                    </Text>
                  ) : (
                    <Text className="text-xs font-semibold text-slate-400 mt-0.5">
                      Created {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  )}
                </View>
              </View>

              <View className="items-end">
                <View className="px-2.5 py-1 bg-slate-100 rounded-xl">
                  <Text className="text-xs font-black text-slate-700">{item.currency}</Text>
                </View>
                {item.total_budget != null && (
                  <Text className="text-xs font-bold text-emerald-600 mt-1">
                    {item.currency} {Number(item.total_budget).toFixed(0)}
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        )}
      />

      <Pressable onPress={() => setShowArchived((v) => !v)} className="py-3 items-center">
        <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          {showArchived ? '‹ Back to active trips' : 'Show archived trips'}
        </Text>
      </Pressable>
    </View>
  );
}
