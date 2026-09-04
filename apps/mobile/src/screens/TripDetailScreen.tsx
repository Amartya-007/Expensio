import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PlusCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import ScreenHeader from '../components/ScreenHeader';
import SettlementView from '../components/SettlementView';
import TripTabBar, { TripTab } from '../components/TripTabBar';
import DashboardScreen from './DashboardScreen';
import TripSettingsScreen from './TripSettingsScreen';
import { colorFor } from '../utils/avatarColor';
import { formatTimestamp } from '../utils/formatDate';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  category: string | null;
  expense_date: string | null;
  created_at: string;
};
type Trip = { id: string; name: string; currency: string; is_archived: number };
type Participant = { id: string; display_name: string; type: string };
type Split = { expense_id: string; participant_id: string; share_amount: number };

export default function TripDetailScreen({
  tripId,
  onBack,
  onAddExpense,
  onOpenExpense,
  onOpenMembers,
  onOpenActivityLog,
  onOpenRecurring,
}: {
  tripId: string;
  onBack: () => void;
  onAddExpense: () => void;
  onOpenExpense: (expenseId: string) => void;
  onOpenMembers: () => void;
  onOpenActivityLog: () => void;
  onOpenRecurring: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TripTab>('home');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, name, currency, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (r) => setTrip(r.rows?._array?.[0] ?? null) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, description, amount, currency, paid_by, category, expense_date, created_at FROM expenses WHERE trip_id = ? AND deleted_at IS NULL ORDER BY COALESCE(expense_date, created_at) DESC',
      [tripId],
      { onResult: (r) => setExpenses(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, display_name, type FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (r) => setParticipants(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    // Added e.deleted_at IS NULL so splits from soft-deleted expenses don't appear.
    db.watch(
      `SELECT s.expense_id, s.participant_id, s.share_amount
       FROM expense_splits s
       JOIN expenses e ON e.id = s.expense_id
       WHERE e.trip_id = ? AND e.deleted_at IS NULL`,
      [tripId],
      { onResult: (r) => setSplits(r.rows?._array ?? []) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  // O(1) participant name lookup — recomputed only when participants change.
  const nameMap = useMemo(
    () => Object.fromEntries(participants.map((p) => [p.id, p.display_name])),
    [participants]
  );
  const nameFor = (id: string) => nameMap[id] ?? '…';

  // Pre-index splits by expense_id so summary lookup is O(k) not O(n).
  const splitsByExpense = useMemo(() => {
    const map: Record<string, Split[]> = {};
    for (const s of splits) {
      (map[s.expense_id] ??= []).push(s);
    }
    return map;
  }, [splits]);

  const splitSummary = (expenseId: string, cur: string) =>
    (splitsByExpense[expenseId] ?? [])
      .map((s) => `${nameFor(s.participant_id)} · ${cur} ${s.share_amount.toFixed(2)}`)
      .join('   ');

  return (
    <View style={styles.shell}>
      {/* ── Home tab ── */}
      {activeTab === 'home' && (
        <DashboardScreen tripId={tripId} onBack={onBack} />
      )}

      {/* ── Expenses tab ── */}
      {activeTab === 'expenses' && (
        <View style={styles.tabShell}>
          <ScreenHeader
            title={trip?.name ?? '…'}
            subtitle="All Expenses"
            paddingTop={Math.max(insets.top, 16)}
            onBack={onBack}
            right={!!trip?.is_archived ? (
              <View style={styles.archivedBadge}>
                <Text style={styles.archivedText}>Archived</Text>
              </View>
            ) : undefined}
            titleClassName="text-xl font-black"
          />

          <FlatList
            data={expenses}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.expenseList,
              { paddingBottom: Math.max(insets.bottom, 16) + 100 },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <PlusCircle size={36} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>No expenses yet</Text>
                <Text style={styles.emptyBody}>
                  Tap the + button below to record your first expense.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const color = colorFor(item.paid_by);
              const dateStr = item.expense_date
                ? new Date(item.expense_date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })
                : formatTimestamp(item.created_at);
              // Cache per-item to avoid calling twice (once for the guard, once for render)
              const summary = splitSummary(item.id, item.currency);
              return (
                <Pressable
                  onPress={() => onOpenExpense(item.id)}
                  style={({ pressed }) => [
                    styles.expenseCard,
                    pressed && styles.expenseCardPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.expenseAvatar,
                      { backgroundColor: color.rawBg, borderColor: color.rawBorder },
                    ]}
                  >
                    <Text style={[styles.expenseAvatarText, { color: color.rawText }]}>
                      {item.description[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>

                  <View style={styles.expenseInfo}>
                    <View style={styles.expenseTopRow}>
                      <Text style={styles.expenseDesc} numberOfLines={1}>
                        {item.description}
                      </Text>
                      <Text style={styles.expenseAmt}>
                        {item.currency} {item.amount.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={styles.expenseMeta} numberOfLines={1}>
                      Paid by {nameFor(item.paid_by)}
                      {item.category ? `  ·  ${item.category}` : ''}
                      {'  ·  '}
                      {dateStr}
                    </Text>
                    {summary !== '' && (
                      <Text style={styles.expenseSplits} numberOfLines={1}>
                        {summary}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {/* ── Settle tab ── */}
      {activeTab === 'settle' && (
        <View style={styles.tabShell}>
          <ScreenHeader
            title={trip?.name ?? '…'}
            subtitle="Settle Up & Balances"
            paddingTop={Math.max(insets.top, 16)}
            onBack={onBack}
            right={!!trip?.is_archived ? (
              <View style={styles.archivedBadge}>
                <Text style={styles.archivedText}>Archived</Text>
              </View>
            ) : undefined}
            titleClassName="text-xl font-black"
          />
          <ScrollView
            contentContainerStyle={[
              styles.settleContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 100 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <SettlementView tripId={tripId} />
          </ScrollView>
        </View>
      )}

      {/* ── Settings tab ── */}
      {activeTab === 'settings' && (
        <TripSettingsScreen
          tripId={tripId}
          onBack={onBack}
          onOpenMembers={onOpenMembers}
          onOpenActivityLog={onOpenActivityLog}
          onOpenRecurring={onOpenRecurring}
        />
      )}

      <TripTabBar active={activeTab} onChange={setActiveTab} onAddExpense={onAddExpense} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#f8fafc' },

  tabShell: { flex: 1 },
  archivedBadge: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  archivedText: { fontSize: 11, fontWeight: '700', color: '#92400e' },

  expenseList: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  expenseCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  expenseCardPressed: { backgroundColor: '#f8fafc', transform: [{ scale: 0.99 }] },
  expenseAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  expenseAvatarText: { fontSize: 16, fontWeight: '800' },
  expenseInfo: { flex: 1, gap: 3 },
  expenseTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  expenseDesc: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1, letterSpacing: -0.1 },
  expenseAmt: { fontSize: 15, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2, flexShrink: 0 },
  expenseMeta: { fontSize: 12, fontWeight: '500', color: '#64748b' },
  expenseSplits: { fontSize: 11, fontWeight: '500', color: '#94a3b8' },

  emptyState: { alignItems: 'center', paddingVertical: 72, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#334155' },
  emptyBody: { fontSize: 13, fontWeight: '500', color: '#94a3b8', textAlign: 'center', lineHeight: 20 },

  settleContent: { paddingHorizontal: 16, paddingTop: 16 },
});
