import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { db } from '../powersync/db';
import { flushPendingActions } from '../rpc';
import GradientText from '../components/GradientText';
import PrimaryButton from '../components/PrimaryButton';

type Trip = { id: string; name: string; currency: string; created_at: string; is_archived: number };

// Restyled with the rest of the app's NativeWind design system — this screen (and
// CreateTripScreen.tsx, reached from here) had never been touched since before the
// TripSpend UI port started, still on the original plain StyleSheet. The empty state is
// the real point of this pass: it used to be a single line of grey "No trips yet" text,
// which undercuts a brand-new user's very first impression of the app. Now it's a full,
// inviting prompt leading straight to CreateTripScreen's "Where to?" screen.
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

  if (!showArchived && trips.length === 0) {
    return (
      <View className="flex-1 bg-white page-shell items-center justify-center">
        <Text className="text-5xl mb-4">✈️</Text>
        <GradientText className="text-3xl font-black tracking-tight text-center mb-2">
          Let's plan your first trip
        </GradientText>
        <Text className="text-sm text-slate-400 text-center mb-8 max-w-[280px]">
          Track spending, split costs, and settle up — all in one place.
        </Text>
        <PrimaryButton onPress={onCreateTrip} icon={<ArrowRight size={16} color="#fff" />} className="w-full max-w-xs">
          Get Started
        </PrimaryButton>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white page-shell">
      <View className="flex-row items-center justify-between page-header">
        <Text className="page-title">{showArchived ? 'Archived trips' : 'Your trips'}</Text>
        {!showArchived && (
          <Pressable onPress={onCreateTrip} className="bg-slate-900 rounded-2xl px-4 py-2.5">
            <Text className="text-white font-bold text-sm">+ New Trip</Text>
          </Pressable>
        )}
      </View>

      {pendingCount > 0 && (
        <View className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-3">
          <Text className="text-xs text-amber-700 font-medium">
            {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to sync — pull to refresh once you're back online
          </Text>
        </View>
      )}

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerClassName="pb-8"
        ListEmptyComponent={<Text className="text-slate-400 text-center mt-16">No archived trips.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpenTrip(item.id, item.currency)} className="card-elevated p-4 flex-row items-center justify-between mb-3">
            <Text className="font-bold text-slate-900 text-base flex-1" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="text-xs font-bold text-slate-400 ml-3">{item.currency}</Text>
          </Pressable>
        )}
      />

      <Pressable onPress={() => setShowArchived((v) => !v)} className="py-4">
        <Text className="text-sm font-semibold text-slate-500 text-center">
          {showArchived ? '‹ Back to your trips' : 'Show archived trips'}
        </Text>
      </Pressable>
    </View>
  );
}
