import { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Archive,
  ArrowRight,
  Calendar,
  Compass,
  Plane,
  Plus,
  User,
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
  SGD: 'S$',
};

const DESTINATION_IMAGES = [
  'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=400&q=80', // Greece
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80', // Himachal
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=400&q=80', // Dubai
  'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=400&q=80', // Bali
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80', // Beach
  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=400&q=80', // Road trip
];

const CARD_THEMES = [
  { bg: '#f0f5ff', border: '#e0e7ff', arrowBg: '#e0e7ff', arrowColor: '#4f46e5' }, // Soft Blue
  { bg: '#f0fdf4', border: '#dcfce7', arrowBg: '#dcfce7', arrowColor: '#16a34a' }, // Soft Mint
  { bg: '#fff8f0', border: '#ffedd5', arrowBg: '#ffedd5', arrowColor: '#ea580c' }, // Soft Peach
  { bg: '#f5f3ff', border: '#ede9fe', arrowBg: '#ede9fe', arrowColor: '#7c3aed' }, // Soft Lavender
];

function themeFor(index: number) {
  return CARD_THEMES[index % CARD_THEMES.length];
}

function imageFor(index: number) {
  return DESTINATION_IMAGES[index % DESTINATION_IMAGES.length];
}

function parseDateIso(iso: string) {
  const parts = iso.split('-').map(Number);
  if (parts.length === 3 && !parts.some(Number.isNaN)) {
    return { year: parts[0], month: parts[1], day: parts[2] };
  }
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function formatDateRange(start: string | null, end: string | null, created: string): string {
  if (start) {
    const s = parseDateIso(start);
    const sMonth = MONTHS[s.month - 1];
    if (end) {
      const e = parseDateIso(end);
      const eMonth = MONTHS[e.month - 1];
      if (s.year === e.year) {
        return `${s.day} ${sMonth} - ${e.day} ${eMonth} ${e.year}`;
      }
      return `${s.day} ${sMonth} ${s.year} - ${e.day} ${eMonth} ${e.year}`;
    }
    return `From ${s.day} ${sMonth} ${s.year}`;
  }
  const c = parseDateIso(created.slice(0, 10));
  return `Created ${c.day} ${MONTHS[c.month - 1]} ${c.year}`;
}

function formatBudget(total_budget: number | null, currency: string): string {
  if (total_budget == null) return 'Budget: No limit';
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  const formatted = Number(total_budget).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `Budget: ${symbol}${formatted}`;
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
      <View style={styles.container}>
        {/* ── Top Bar with Brand & Profile ── */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandIconCircle}>
              <Plane size={20} color="#4f46e5" strokeWidth={2.5} />
            </View>
            <Text style={styles.brandText}>Expensio</Text>
          </View>

          <View style={styles.topBarRight}>
            {!showArchived && (
              <Pressable
                onPress={onCreateTrip}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Create new trip"
                style={({ pressed }) => [styles.newBtn, pressed && styles.newBtnPressed]}
              >
                <Plus size={15} color="#ffffff" strokeWidth={2.5} />
                <Text style={styles.newBtnText}>New Trip</Text>
              </Pressable>
            )}

            <View style={styles.avatarCircle}>
              <User size={18} color="#4f46e5" strokeWidth={2} />
            </View>
          </View>
        </View>

        {/* ── Header Title & Description ── */}
        <View style={styles.headerBlock}>
          <Text style={styles.headerTitle}>
            {showArchived ? 'Archived Trips' : 'My Trips'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {showArchived
              ? 'View and manage your archived trips.'
              : 'Here are all the trips you\'ve created so far. Click on a trip to view more details, plan your itinerary, and manage your expenses.'}
          </Text>
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />
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
          renderItem={({ item, index }) => {
            const theme = themeFor(index);
            const imageUrl = imageFor(index);
            const dateLabel = formatDateRange(item.start_date, item.end_date, item.created_at);
            const budgetLabel = formatBudget(item.total_budget, item.currency);

            return (
              <Pressable
                onPress={() => onOpenTrip(item.id, item.currency)}
                accessibilityRole="button"
                accessibilityLabel={`Open trip ${item.name}`}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      styles.card,
                      {
                        backgroundColor: theme.bg,
                        borderColor: theme.border,
                      },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    {/* Left thumbnail image */}
                    <Image
                      source={{ uri: imageUrl }}
                      style={styles.cardThumb}
                      resizeMode="cover"
                    />

                    {/* Middle: name (right of image) and details (below name) */}
                    <View style={styles.cardBody}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {item.name}
                      </Text>

                      <View style={styles.cardMetaRow}>
                        <Calendar size={14} color="#64748b" strokeWidth={2} />
                        <Text style={styles.cardMetaText} numberOfLines={1}>
                          {dateLabel}
                        </Text>
                      </View>

                      <View style={styles.cardMetaRow}>
                        <Wallet size={14} color="#64748b" strokeWidth={2} />
                        <Text style={styles.cardBudgetText} numberOfLines={1}>
                          {budgetLabel}
                        </Text>
                      </View>
                    </View>

                    {/* Right: arrow circle on rightmost side */}
                    <View
                      style={[
                        styles.arrowCircle,
                        { backgroundColor: theme.arrowBg },
                      ]}
                    >
                      <ArrowRight size={18} color={theme.arrowColor} strokeWidth={2.5} />
                    </View>
                  </View>
                )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Empty state ──
  emptyShell: {
    flex: 1,
    backgroundColor: '#ffffff',
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
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },

  // ── Top Bar (Brand + Avatar) ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.3,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 12,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  newBtnPressed: {
    backgroundColor: '#1d4ed8',
    opacity: 0.9,
  },
  newBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Header Block ──
  headerBlock: {
    marginBottom: 16,
    gap: 6,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '800',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#64748b',
    lineHeight: 19,
  },

  // ── Banners ──
  bannerArea: {
    gap: 6,
    marginBottom: 12,
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
    paddingTop: 2,
    gap: 14,
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
    borderRadius: 20,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardPressed: {
    opacity: 0.92,
  },
  cardThumb: {
    width: 82,
    height: 82,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    marginLeft: 14,
    marginRight: 10,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 16.5,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardMetaText: {
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#64748b',
    marginLeft: 6,
  },
  cardBudgetText: {
    fontSize: 12.5,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#334155',
    marginLeft: 6,
  },
  arrowCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
    