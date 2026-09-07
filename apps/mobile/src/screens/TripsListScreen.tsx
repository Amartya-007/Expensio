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
import { db } from '../powersync/db';
import { flushPendingActions } from '../rpc';
import SyncStatusBanner from '../components/SyncStatusBanner';
import PrimaryButton from '../components/PrimaryButton';

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
      ? new Date(end).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;
    return e ? `${s} – ${e}` : `From ${s}`;
  }
  return `Created ${new Date(created).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

// ClearBalance Modern stable accent palette for trip cards
const CARD_ACCENTS = [
  { icon: '#2563eb', bg: '#eff4ff', border: '#bfdbfe' },
  { icon: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
  { icon: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { icon: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  { icon: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function accentFor(id: string) {
  return CARD_ACCENTS[hashId(id) % CARD_ACCENTS.length];
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
  const [loaded, setLoaded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, created_at, is_archived FROM trips WHERE is_archived = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      [showArchived ? 1 : 0],
      {
        onResult: (r) => {
          setTrips(r.rows?._array ?? []);
          setLoaded(true);
        },
      },
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

  // ── Empty state (only after first query completes, non-archive mode) ─────────
  if (loaded && !showArchived && trips.length === 0) {
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
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <Compass size={38} color="#2563eb" strokeWidth={2} />
          </View>

          <Text style={styles.emptyTitle}>
            Effortless Group Expenses
          </Text>
          <Text style={styles.emptySubtitle}>
            Track shared costs, split fairly with friends, and settle balances instantly without spreadsheets.
          </Text>

          <PrimaryButton
            onPress={onCreateTrip}
            icon={<Plus size={18} color="#ffffff" strokeWidth={2.5} />}
            style={styles.emptyBtn}
          >
            Create Your First Trip
          </PrimaryButton>
        </View>
      </View>
    );
  }

  // ── Main list ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.shell, { paddingTop: Math.max(insets.top, 16) }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>
            {showArchived ? 'Archived Trips' : 'My Trips'}
          </Text>
          <Text style={styles.headerSub}>
            {trips.length} {trips.length === 1 ? 'trip' : 'trips'}
            {showArchived ? ' archived' : ' active'}
          </Text>
        </View>

        {!showArchived && (
          <Pressable
            onPress={onCreateTrip}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Create new trip"
            style={({ pressed }) => [styles.newBtn, pressed && styles.newBtnPressed]}
          >
            <Plus size={16} color="#ffffff" strokeWidth={2.5} />
            <Text style={styles.newBtnText}>New Trip</Text>
          </Pressable>
        )}
      </View>

      {/* ── Sync / pending banners ── */}
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

      {/* ── Trip list ── */}
      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <Archive size={32} color="#cbd5e1" />
            <Text style={styles.listEmptyText}>No archived trips found.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const accent = accentFor(item.id);
          const dateLabel = formatDateRange(item.start_date, item.end_date, item.created_at);
          return (
            <Pressable
              onPress={() => onOpenTrip(item.id, item.currency)}
              accessibilityRole="button"
              accessibilityLabel={`Open trip ${item.name}`}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              {/* Left: coloured icon circle */}
              <View
                style={[
                  styles.cardIconCircle,
                  { backgroundColor: accent.bg, borderColor: accent.border },
                ]}
              >
                <MapPin size={22} color={accent.icon} strokeWidth={2.2} />
              </View>

              {/* Body */}
              <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>

                <View style={styles.cardMetaRow}>
                  <Calendar size={13} color="#737686" />
                  <Text style={styles.cardMetaText} numberOfLines={1}>
                    {dateLabel}
                  </Text>
                </View>

                {item.total_budget != null && (
                  <View style={styles.cardBudgetRow}>
                    <Wallet size={12} color="#10b981" />
                    <Text style={styles.cardBudgetText}>
                      {item.currency}{' '}
                      {Number(item.total_budget).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}{' '}
                      budget
                    </Text>
                  </View>
                )}
              </View>

              {/* Right: currency chip + chevron */}
              <View style={styles.cardRight}>
                <View style={styles.currencyChip}>
                  <Text style={styles.currencyChipText}>{item.currency}</Text>
                </View>
                <ChevronRight size={18} color="#c3c6d7" />
              </View>
            </Pressable>
          );
        }}
      />

      {/* ── Archive toggle ── */}
      <Pressable
        onPress={() => setShowArchived((v) => !v)}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={showArchived ? 'Back to active trips' : 'Show archived trips'}
        style={({ pressed }) => [styles.archiveToggle, pressed && styles.archiveTogglePressed]}
      >
        <Archive size={14} color="#737686" />
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
    backgroundColor: '#f8f9ff',
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 24,
    alignItems: 'center',
    maxWidth: 360,
    width: '100%',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#eff4ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 20,
  },
  emptyBtn: {
    width: '100%',
  },

  // ── Main shell ──
  shell: {
    flex: 1,
    backgroundColor: '#f8f9ff',
    paddingHorizontal: 16,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 4,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  newBtnPressed: {
    backgroundColor: '#1d4ed8',
    transform: [{ scale: 0.98 }],
  },
  newBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Banners ──
  bannerArea: {
    gap: 6,
    marginBottom: 8,
  },
  pendingBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pendingText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#92400e',
  },

  // ── List ──
  listContent: {
    paddingTop: 4,
    gap: 10,
  },
  listEmpty: {
    alignItems: 'center',
    paddingVertical: 64,
    gap: 12,
  },
  listEmptyText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
  },

  // ── Trip card ──
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardPressed: {
    backgroundColor: '#f8f9ff',
    borderColor: '#cbdbf5',
  },
  cardIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardMetaText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
  },
  cardBudgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  cardBudgetText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#10b981',
    fontVariant: ['tabular-nums'],
  },
  cardRight: {
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  currencyChip: {
    backgroundColor: '#eff4ff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  currencyChipText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#2563eb',
  },

  // ── Archive toggle ──
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    height: 48,
  },
  archiveTogglePressed: {
    opacity: 0.6,
  },
  archiveToggleText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#737686',
    letterSpacing: 0.2,
  },
});
