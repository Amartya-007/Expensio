import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Archive,
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock,
  DollarSign,
  LogOut,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { currencyIcon } from '../utils/currencyIcon';
import { formatError } from '../utils/errors';
import { LIMITS, validateTripBudget, validateTripDate } from '../constants/limits';
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

function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayIso() { return localDateIso(new Date()); }
function plusDaysIso(days: number) {
  const d = new Date(); d.setDate(d.getDate() + days); return localDateIso(d);
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
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const budgetError = validateTripBudget(budget) ?? '';
  const dateError =
    (endDate < startDate ? "End date can't be before start date." : '') ||
    (validateTripDate(startDate) ?? validateTripDate(endDate) ?? '');
  const BudgetIcon = currencyIcon(trip?.currency);

  async function handleSave() {
    if (budgetError || dateError) { setError(budgetError || dateError); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      await callRpc(
        'update_trip_details',
        {
          p_trip_id: tripId,
          p_start_date: startDate,
          p_end_date: endDate,
          ...(budget === '' ? { p_clear_budget: true } : { p_total_budget: budgetNum }),
        },
        { idempotent: false }
      );
      setSaved(true);
    } catch (err) { setError(formatError(err)); }
    finally { setSaving(false); }
  }

  function confirmArchive() {
    const archiving = !trip?.is_archived;
    Alert.alert(
      archiving ? 'Archive this trip?' : 'Unarchive this trip?', undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Archive' : 'Unarchive',
          onPress: async () => {
            try { await callRpc(archiving ? 'archive_trip' : 'unarchive_trip', { p_trip_id: tripId }, { idempotent: false }); }
            catch (err) { Alert.alert('Could not update trip', formatError(err)); }
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
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try { await callRpc('delete_trip', { p_trip_id: tripId }, { idempotent: false }); onBack(); }
            catch (err) { Alert.alert('Could not delete trip', formatError(err)); }
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
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            try { await callRpc('leave_trip', { p_trip_id: tripId }, { idempotent: false }); onBack(); }
            catch (err) { Alert.alert('Could not leave trip', formatError(err)); }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 0),
        paddingBottom: Math.max(insets.bottom, 16) + 100,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero header with gradient ── */}
      <LinearGradient
        colors={['#1e3a8a', '#2563eb']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroGradient, { paddingTop: Math.max(insets.top, 20) }]}
      >
        <View style={s.heroTopRow}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            hitSlop={8}
          >
            <ArrowLeft size={18} color="#e0e7ff" />
          </Pressable>

          {!!trip?.is_archived && (
            <View style={s.archivedBadge}>
              <Text style={s.archivedText}>Archived</Text>
            </View>
          )}
        </View>

        <View style={s.heroContent}>
          <Text style={s.heroTitle}>{trip?.name ?? '…'}</Text>
          <Text style={s.heroSub}>Trip Settings</Text>

          {/* Stats row */}
          <View style={s.heroStats}>
            <View style={s.heroStat}>
              <Users size={14} color="#93c5fd" />
              <Text style={s.heroStatText}>
                {participantCount} {participantCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
            {trip?.total_budget != null && (
              <View style={s.heroStat}>
                <DollarSign size={14} color="#93c5fd" />
                <Text style={s.heroStatText}>
                  {trip.currency} {trip.total_budget.toLocaleString(undefined, { maximumFractionDigits: 0 })} budget
                </Text>
              </View>
            )}
          </View>
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <View style={s.body}>
        {/* Alerts */}
        {!!error && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
        {saved && !error && (
          <View style={s.successBanner}>
            <Text style={s.successText}>✓  Changes saved successfully.</Text>
          </View>
        )}

        {/* ── Budget & Dates card ── */}
        <Text style={s.sectionLabel}>Budget & Dates</Text>
        <View style={s.card}>
          {/* Budget */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Total budget ({trip?.currency ?? '…'})</Text>
            <View style={[s.inputRow, budgetFocused && s.inputRowFocused, !!budgetError && s.inputRowError]}>
              <BudgetIcon size={16} color="#94a3b8" />
              <TextInput
                style={s.budgetInput}
                value={budget}
                onChangeText={setBudget}
                onFocus={() => setBudgetFocused(true)}
                onBlur={() => setBudgetFocused(false)}
                placeholder="No budget set"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
                maxLength={String(LIMITS.trip.budget.max).length + 3}
              />
            </View>
            {!!budgetError && <Text style={s.fieldError}>{budgetError}</Text>}
          </View>

          <View style={s.divider} />

          {/* Dates */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Trip dates</Text>
            <View style={s.dateRow}>
              <View style={s.dateBlock}>
                <Text style={s.dateSubLabel}>
                  <Calendar size={11} color="#94a3b8" />{'  '}Start
                </Text>
                <DatePicker value={startDate} onChange={setStartDate} />
              </View>
              <View style={s.dateBlock}>
                <Text style={s.dateSubLabel}>
                  <Calendar size={11} color="#94a3b8" />{'  '}End
                </Text>
                <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
              </View>
            </View>
            {!!dateError && <Text style={s.fieldError}>{dateError}</Text>}
          </View>
        </View>

        <PrimaryButton onPress={handleSave} loading={saving} style={s.saveBtn}>
          Save Changes
        </PrimaryButton>

        {/* ── Trip section ── */}
        <Text style={s.sectionLabel}>Trip</Text>
        <View style={s.rowGroup}>
          <SettingsRow
            icon={<Users size={18} color="#0d9488" />}
            iconBg="#f0fdfa"
            iconAccent="#ccfbf1"
            title="Manage Members"
            subtitle={`${participantCount} participant${participantCount !== 1 ? 's' : ''}`}
            onPress={onOpenMembers}
          />
          <View style={s.rowDivider} />
          <SettingsRow
            icon={<Clock size={18} color="#6366f1" />}
            iconBg="#eef2ff"
            iconAccent="#c7d2fe"
            title="Activity Log"
            subtitle="History of all trip events"
            onPress={onOpenActivityLog}
          />
          <View style={s.rowDivider} />
          <SettingsRow
            icon={<Repeat size={18} color="#7c3aed" />}
            iconBg="#f5f3ff"
            iconAccent="#ede9fe"
            title="Recurring Expenses"
            subtitle="Auto-repeating templates"
            onPress={onOpenRecurring}
          />
        </View>

        {/* ── Danger zone ── */}
        <Text style={s.sectionLabel}>Trip Actions</Text>
        <View style={s.rowGroup}>
          <SettingsRow
            icon={<Archive size={18} color="#d97706" />}
            iconBg="#fffbeb"
            iconAccent="#fef3c7"
            title={trip?.is_archived ? 'Unarchive Trip' : 'Archive Trip'}
            subtitle={trip?.is_archived ? 'Make this trip active again' : 'Hide from your active trips'}
            onPress={confirmArchive}
          />
          <View style={s.rowDivider} />
          <SettingsRow
            icon={<LogOut size={18} color="#dc2626" />}
            iconBg="#fff1f2"
            iconAccent="#ffe4e6"
            title="Leave Trip"
            subtitle="Remove yourself from this trip"
            titleColor="#dc2626"
            onPress={confirmLeave}
          />
          <View style={s.rowDivider} />
          <SettingsRow
            icon={<Trash2 size={18} color="#dc2626" />}
            iconBg="#fff1f2"
            iconAccent="#ffe4e6"
            title="Delete Trip"
            subtitle="Permanently remove this trip"
            titleColor="#dc2626"
            onPress={confirmDelete}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function SettingsRow({
  icon,
  iconBg,
  iconAccent,
  title,
  subtitle,
  titleColor = '#0f172a',
  onPress,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconAccent: string;
  title: string;
  subtitle?: string;
  titleColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.settingsRow, pressed && s.settingsRowPressed]}
    >
      {/* Icon with two-tone circle */}
      <View style={[s.settingsIconOuter, { backgroundColor: iconAccent }]}>
        <View style={[s.settingsIconInner, { backgroundColor: iconBg }]}>
          {icon}
        </View>
      </View>

      {/* Text */}
      <View style={s.settingsBody}>
        <Text style={[s.settingsTitle, { color: titleColor }]}>{title}</Text>
        {!!subtitle && <Text style={s.settingsSub}>{subtitle}</Text>}
      </View>

      {/* Chevron */}
      <View style={s.settingsChevron}>
        <ChevronRight size={15} color="#cbd5e1" />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  // ── Hero ──
  heroGradient: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPressed: { backgroundColor: 'rgba(255,255,255,0.25)' },
  archivedBadge: {
    backgroundColor: 'rgba(254,243,199,0.9)',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  archivedText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  heroContent: { gap: 6 },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.4,
  },
  heroSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#93c5fd',
    letterSpacing: 0.3,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroStatText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#bfdbfe',
  },

  // ── Body ──
  body: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },

  // ── Alerts ──
  errorBanner: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 13, fontWeight: '600', color: '#be123c' },
  successBanner: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  successText: { fontSize: 13, fontWeight: '700', color: '#15803d' },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 8,
    marginTop: 24,
    paddingHorizontal: 2,
  },

  // ── Budget/dates card ──
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
  fieldGroup: { gap: 8 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  inputRowFocused: { borderColor: '#2563eb', backgroundColor: '#fff' },
  inputRowError: { borderColor: '#fca5a5' },
  budgetInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  fieldError: { fontSize: 11, fontWeight: '600', color: '#dc2626' },
  divider: { height: 1, backgroundColor: '#f1f5f9' },
  dateRow: { gap: 12 },
  dateBlock: { gap: 6 },
  dateSubLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  saveBtn: { marginTop: 16 },

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
    marginLeft: 72,
  },

  // ── Settings row ──
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowPressed: { backgroundColor: '#f8fafc' },
  settingsIconOuter: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  settingsIconInner: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBody: { flex: 1 },
  settingsTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  settingsSub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
    marginTop: 1,
  },
  settingsChevron: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
