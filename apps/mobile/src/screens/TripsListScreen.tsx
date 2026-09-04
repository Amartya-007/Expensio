import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Archive,
  Calendar,
  ChevronRight,
  Compass,
  MapPin,
  Plus,
  Wallet,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { db } from '../powersync/db';
import { flushPendingActions } from '../rpc';
import GradientText from '../components/GradientText';
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

function formatDateRange(start: string | null, end: string | null, created: string): string {
  if (start) {
    const s = new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const e = end
      ? new Date(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    return e ? `${s} – ${e}` : `From ${s}`;
  }
  return `Created ${new Date(created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// Cycle through a small palette so each trip card gets a distinct accent
const CARD_ACCENTS = [
  { icon: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { icon: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { icon: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  { icon: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  { icon: '#e11d48', bg: '#fff1f2', border: '#fecdd3' },
];
function accentFor(index: number) {
  return CARD_ACCENTS[index % CARD_ACCENTS.length];
}

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
    const ac = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, created_at, is_archived FROM trips WHERE is_archived = ? ORDER BY created_at DESC',
      [showArchived ? 1 : 0],
      { onResult: (r) => setTrips(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [showArchived]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT count(*) as n FROM pending_actions',
      [],
      { onResult: (r) => setPendingCount(r.rows?._array?.[0]?.n ?? 0) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await flushPendingActions();
    setRefreshing(false);
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!showArchived && trips.length === 0) {
    return (
      <View
        style={[
          styles.emptyShell,
          {
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 32),
          },
        ]}
      >
        {/* Hero illustration */}
        <LinearGradient
          colors={['#eff6ff', '#dbeafe']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.emptyIconRing}
        >
          <Compass size={44} color="#2563eb" strokeWidth={1.8} />
        </LinearGradient>

        <GradientText className="text-3xl font-black tracking-tight text-center">
          Plan Your Next Adventure
        </GradientText>
        <Text style={styles.emptySubtitle}>
          Track shared expenses, set budgets, and split bills effortlessly with your travel group.
        </Text>

        <Pressable
          onPress={onCreateTrip}
          style={({ pressed }) => [styles.emptyBtn, pressed && styles.emptyBtnPressed]}
        >
          <LinearGradient
            colors={['#2563eb', '#1d4ed8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.emptyBtnGradient}
          >
            <Plus size={18} color="#fff" strokeWidth={2.5} />
            <Text style={styles.emptyBtnText}>Create Trip</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  // ── Main list ────────────────────────────────────────────────────────────────
  return (
    <View
      style={[
        styles.shell,
        { paddingTop: Math.max(insets.top, 16) },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <GradientText className="text-3xl font-black tracking-tight">
            {showArchived ? 'Archived' : 'My Trips'}
          </GradientText>
          <Text style={styles.headerSub}>
            {trips.length} {trips.length === 1 ? 'trip' : 'trips'}
            {showArchived ? ' archived' : ' active'}
          </Text>
        </View>

        {!showArchived && (
          <Pressable
            onPress={onCreateTrip}
            style={({ pressed }) => [styles.newBtn, pressed && styles.newBtnPressed]}
          >
            <Plus size={16} color="#fff" strokeWidth={2.5} />
            <Text style={styles.newBtnText}>New Trip</Text>
          </Pressable>
        )}
      </View>

      {/* Banners */}
      <View style={styles.bannerArea}>
        <SyncStatusBanner />
        {pendingCount > 0 && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingText}>
              {pendingCount} change{pendingCount === 1 ? '' : 's'} queued — pull to sync
            </Text>
          </View>
        )}
      </View>

      {/* List */}
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <Archive size={32} color="#cbd5e1" />
            <Text style={styles.listEmptyText}>No archived trips found.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const accent = accentFor(index);
          const dateLabel = formatDateRange(item.start_date, item.end_date, item.created_at);
          return (
            <Pressable
              onPress={() => onOpenTrip(item.id, item.currency)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              {/* Left icon */}
              <View style={[styles.cardIcon, { backgroundColor: accent.bg, borderColor: accent.border }]}>
                <MapPin size={20} color={accent.icon} strokeWidth={2} />
              </View>

              {/* Middle content */}
              <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>

                <View style={styles.cardMeta}>
                  <Calendar size={11} color="#94a3b8" />
                  <Text style={styles.cardMetaText} numberOfLines={1}>
                    {dateLabel}
                  </Text>
                </View>

                {item.total_budget != null && (
                  <View style={styles.cardBudgetRow}>
                    <Wallet size={11} color="#16a34a" />
                    <Text style={styles.cardBudgetText}>
                      {item.currency} {Number(item.total_budget).toLocaleString(undefined, { maximumFractionDigits: 0 })} budget
                    </Text>
                  </View>
                )}
              </View>

              {/* Right: currency chip + chevron */}
              <View style={styles.cardRight}>
                <View style={styles.currencyChip}>
                  <Text style={styles.currencyChipText}>{item.currency}</Text>
                </View>
                <ChevronRight size={16} color="#cbd5e1" style={{ marginTop: 8 }} />
              </View>
            </Pressable>
          );
        }}
      />

      {/* Archive toggle */}
      <Pressable
        onPress={() => setShowArchived((v) => !v)}
        style={({ pressed }) => [styles.archiveToggle, pressed && styles.archiveTogglePressed]}
      >
        <Archive size={13} color="#94a3b8" />
        <Text style={styles.archiveToggleText}>
          {showArchived ? 'Back to active trips' : 'Show archived trips'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Empty state ──
  emptyShell: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyIconRing: {
    width: 96,
    height: 96,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  emptyBtn: {
    borderRadius: 18,
    marginTop: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  emptyBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  emptyBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 18,
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Main shell ──
  shell: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  newBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
  newBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },

  // ── Banners ──
  bannerArea: {
    gap: 6,
    marginBottom: 4,
  },
  pendingBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pendingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },

  // ── List ──
  listContent: {
    paddingTop: 8,
    gap: 10,
  },
  listEmpty: {
    alignItems: 'center',
    paddingVertical: 64,
    gap: 12,
  },
  listEmptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
  },

  // ── Trip card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    backgroundColor: '#f8fafc',
    transform: [{ scale: 0.99 }],
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardMetaText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  cardBudgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardBudgetText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
  },
  cardRight: {
    alignItems: 'center',
    gap: 2,
  },
  currencyChip: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  currencyChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },

  // ── Archive toggle ──
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  archiveTogglePressed: {
    opacity: 0.6,
  },
  archiveToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
});
