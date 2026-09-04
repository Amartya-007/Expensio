import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Clock,
  LogOut,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { currencyIcon } from '../utils/currencyIcon';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import DatePicker from '../components/DatePicker';

type Trip = {
  id: string;
  name: string;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  total_budget: number | null;
  is_archived: number;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function TripSettingsScreen({
  tripId,
  onBack,
  onOpenMembers,
  onOpenActivityLog,
  onOpenRecurring,
}: {
  tripId: string;
  onBack: () => void;
  onOpenMembers: () => void;
  onOpenActivityLog: () => void;
  onOpenRecurring: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [budget, setBudget] = useState('');
  const [budgetFocused, setBudgetFocused] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDaysIso(3));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (r) => setTrip(r.rows?._array?.[0] ?? null) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch(
      'SELECT COUNT(*) as count FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (r) => setParticipantCount(r.rows?._array?.[0]?.count ?? 0) },
      { signal: ac.signal }
    );
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    if (!trip || hydrated) return;
    setBudget(trip.total_budget != null ? String(trip.total_budget) : '');
    if (trip.start_date) setStartDate(trip.start_date);
    if (trip.end_date) setEndDate(trip.end_date);
    setHydrated(true);
  }, [trip, hydrated]);

  const budgetNum = Number(budget);
  const budgetError =
    budget !== '' && (!Number.isFinite(budgetNum) || budgetNum <= 0)
      ? 'Enter a budget greater than 0.'
      : '';
  const dateError =
    endDate < startDate ? "End date can't be before start date." : '';
  const BudgetIcon = currencyIcon(trip?.currency);

  async function handleSave() {
    if (budgetError || dateError) {
      setError(budgetError || dateError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await callRpc(
        'update_trip_details',
        {
          p_trip_id: tripId,
          p_start_date: startDate,
          p_end_date: endDate,
          ...(budget === ''
            ? { p_clear_budget: true }
            : { p_total_budget: budgetNum }),
        },
        { idempotent: false }
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmArchive() {
    const archiving = !trip?.is_archived;
    Alert.alert(
      archiving ? 'Archive this trip?' : 'Unarchive this trip?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Archive' : 'Unarchive',
          onPress: async () => {
            try {
              await callRpc(
                archiving ? 'archive_trip' : 'unarchive_trip',
                { p_trip_id: tripId },
                { idempotent: false }
              );
            } catch (err) {
              Alert.alert('Could not update trip', formatError(err));
            }
          },
        },
      ]
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this trip?',
      "Only works while you\u2019re the only active member. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await callRpc('delete_trip', { p_trip_id: tripId }, { idempotent: false });
              onBack();
            } catch (err) {
              Alert.alert('Could not delete trip', formatError(err));
            }
          },
        },
      ]
    );
  }

  function confirmLeave() {
    Alert.alert(
      'Leave this trip?',
      'Your historical expenses stay in the trip, but you will lose access.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await callRpc('leave_trip', { p_trip_id: tripId }, { idempotent: false });
              onBack();
            } catch (err) {
              Alert.alert('Could not leave trip', formatError(err));
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 100,
        paddingHorizontal: 16,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={18} color="#334155" />
        </Pressable>

        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>Trip Settings</Text>
          <Text style={styles.headerSub}>
            {participantCount} {participantCount === 1 ? 'member' : 'members'}
            {trip?.total_budget != null
              ? `  ·  ${trip.currency} ${trip.total_budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget`
              : ''}
          </Text>
        </View>

        {!!trip?.is_archived && (
          <View style={styles.archivedBadge}>
            <Text style={styles.archivedText}>Archived</Text>
          </View>
        )}
      </View>

      {/* ── Error banner ── */}
      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* ── Budget & Dates ── */}
      <Text style={styles.sectionLabel}>Budget & Dates</Text>
      <View style={styles.card}>
        {/* Budget input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Total budget ({trip?.currency ?? '…'})</Text>
          <View style={[styles.inputRow, budgetFocused && styles.inputRowFocused, !!budgetError && styles.inputRowError]}>
            <BudgetIcon size={16} color="#94a3b8" />
            <TextInput
              style={styles.budgetInput}
              value={budget}
              onChangeText={setBudget}
              onFocus={() => setBudgetFocused(true)}
              onBlur={() => setBudgetFocused(false)}
              placeholder="No budget set"
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
            />
          </View>
          {!!budgetError && <Text style={styles.fieldError}>{budgetError}</Text>}
        </View>

        <View style={styles.divider} />

        {/* Dates */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Trip dates</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateBlock}>
              <Text style={styles.dateSubLabel}>Start</Text>
              <DatePicker value={startDate} onChange={setStartDate} />
            </View>
            <View style={[styles.dateBlock, { marginTop: 0 }]}>
              <Text style={styles.dateSubLabel}>End</Text>
              <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
            </View>
          </View>
          {!!dateError && <Text style={styles.fieldError}>{dateError}</Text>}
        </View>
      </View>

      <PrimaryButton onPress={handleSave} loading={saving} style={styles.saveBtn}>
        Save Changes
      </PrimaryButton>

      {/* ── Trip links ── */}
      <Text style={styles.sectionLabel}>Trip</Text>
      <View style={styles.rowGroup}>
        <SettingsRow
          icon={<Users size={16} color="#0d9488" />}
          iconBg="#f0fdfa"
          title="Manage Members"
          subtitle={`${participantCount} participant${participantCount !== 1 ? 's' : ''}`}
          onPress={onOpenMembers}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon={<Clock size={16} color="#64748b" />}
          iconBg="#f8fafc"
          title="Activity Log"
          onPress={onOpenActivityLog}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon={<Repeat size={16} color="#7c3aed" />}
          iconBg="#f5f3ff"
          title="Recurring Expenses"
          onPress={onOpenRecurring}
        />
      </View>

      {/* ── Danger zone ── */}
      <Text style={styles.sectionLabel}>Trip Actions</Text>
      <View style={styles.rowGroup}>
        <SettingsRow
          icon={<Archive size={16} color="#d97706" />}
          iconBg="#fffbeb"
          title={trip?.is_archived ? 'Unarchive Trip' : 'Archive Trip'}
          onPress={confirmArchive}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon={<LogOut size={16} color="#dc2626" />}
          iconBg="#fff1f2"
          title="Leave Trip"
          titleColor="#dc2626"
          onPress={confirmLeave}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          icon={<Trash2 size={16} color="#dc2626" />}
          iconBg="#fff1f2"
          title="Delete Trip"
          titleColor="#dc2626"
          onPress={confirmDelete}
        />
      </View>
    </ScrollView>
  );
}

function SettingsRow({
  icon,
  iconBg,
  title,
  subtitle,
  titleColor = '#0f172a',
  onPress,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  titleColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.settingsRow, pressed && styles.settingsRowPressed]}
    >
      <View style={[styles.settingsIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.settingsBody}>
        <Text style={[styles.settingsTitle, { color: titleColor }]}>{title}</Text>
        {!!subtitle && <Text style={styles.settingsSub}>{subtitle}</Text>}
      </View>
      <ChevronRight size={16} color="#cbd5e1" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerBody: { flex: 1 },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
  },
  archivedBadge: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  archivedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },

  // ── Error banner ──
  errorBanner: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#be123c',
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
    paddingHorizontal: 2,
  },

  // ── Card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    gap: 16,
  },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputRowFocused: { borderColor: '#2563eb' },
  inputRowError: { borderColor: '#fca5a5' },
  budgetInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldError: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  dateRow: {
    gap: 12,
  },
  dateBlock: {
    gap: 6,
  },
  dateSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },

  saveBtn: {
    marginTop: 16,
  },

  // ── Row group ──
  rowGroup: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#f8fafc',
    marginLeft: 60,
  },

  // ── Settings row ──
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowPressed: { backgroundColor: '#f8fafc' },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  settingsBody: { flex: 1 },
  settingsTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  settingsSub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 1,
  },
});
