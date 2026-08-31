import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Clock,
  IndianRupee,
  LogOut,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react-native';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
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

// Ported from tripspend/src/screens/TripDetails.tsx, reshaped for what Expensio's schema
// actually stores. Two deliberate departures from the original, both already decided in
// expensio-ui-port-plan.md's "budget concept" section:
// - A single total-budget field, not TripSpend's per-person-budget-times-fixed-headcount
//   (trips.total_budget is a plain total; Expensio's participant count is a live count,
//   not a fixed peopleCount field set once at setup).
// - No "lock past days" toggle -- deliberately not ported, nothing on this side reads it.
//
// The People & Categories section became a Members/Activity Log/Recurring row list --
// Categories management has no screen yet on this side (custom_categories exists,
// unused by mobile so far, per the plan doc's mapping table), so that row is dropped
// rather than pointing somewhere that doesn't exist. Activity Log has no TripSpend
// equivalent at all, given a home here since it needed one once it stopped being a
// top-level tab. Invite/Join lives on MembersScreen instead of duplicated here.
//
// The trip action rows (archive/delete/leave) are new here, not in TripSpend's
// TripDetails.tsx at all -- they're what used to be TripDetailScreen.tsx's hidden
// Alert.alert options menu (openTripOptions), made into visible rows now that this is a
// real settings screen rather than a three-dot menu. Same underlying RPC calls,
// unchanged; only the trigger UI moved.
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
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, currency, start_date, end_date, total_budget, is_archived FROM trips WHERE id = ?',
      [tripId],
      { onResult: (result) => setTrip(result.rows?._array?.[0] ?? null) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT COUNT(*) as count FROM participants WHERE trip_id = ?',
      [tripId],
      { onResult: (result) => setParticipantCount(result.rows?._array?.[0]?.count ?? 0) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  // Seed the editable fields from the loaded trip exactly once -- not on every db.watch
  // update, or the user's in-progress edits would get clobbered the moment their own
  // save round-trips back through PowerSync.
  useEffect(() => {
    if (!trip || hydrated) return;
    setBudget(trip.total_budget != null ? String(trip.total_budget) : '');
    if (trip.start_date) setStartDate(trip.start_date);
    if (trip.end_date) setEndDate(trip.end_date);
    setHydrated(true);
  }, [trip, hydrated]);

  const budgetNum = Number(budget);
  const budgetError = budget !== '' && (!Number.isFinite(budgetNum) || budgetNum <= 0) ? 'Enter a budget greater than 0.' : '';
  const dateError = endDate < startDate ? "End date can't be before the start date." : '';

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
          // Omitting p_total_budget (rather than sending 0) when the field was cleared,
          // since update_trip_details treats a null amount as "leave it as-is" -- clearing
          // the budget on purpose needs the separate p_clear_budget flag instead.
          ...(budget === '' ? { p_clear_budget: true } : { p_total_budget: budgetNum }),
        },
        { idempotent: false }
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmArchive() {
    const archiving = !trip?.is_archived;
    const rpcName = archiving ? 'archive_trip' : 'unarchive_trip';
    Alert.alert(archiving ? 'Archive this trip?' : 'Unarchive this trip?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: archiving ? 'Archive' : 'Unarchive',
        onPress: async () => {
          try {
            await callRpc(rpcName, { p_trip_id: tripId }, { idempotent: false });
          } catch (err) {
            Alert.alert('Could not update trip', String(err));
          }
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this trip?',
      'Only works while you\u2019re the only active member. This cannot be undone from here.',
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
              Alert.alert('Could not delete trip', String(err));
            }
          },
        },
      ]
    );
  }

  function confirmLeave() {
    Alert.alert('Leave this trip?', 'Your historical expenses stay in the trip, but you will lose access.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await callRpc('leave_trip', { p_trip_id: tripId }, { idempotent: false });
            onBack();
          } catch (err) {
            Alert.alert('Could not leave trip', String(err));
          }
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="page-shell pb-32 space-y-4" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center gap-3 page-header">
        <Pressable onPress={onBack} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
          <ArrowLeft size={20} color="#64748b" />
        </Pressable>
        <View>
          <Text className="page-title">Trip Settings</Text>
          <Text className="page-subtitle">
            {participantCount} people
            {trip?.total_budget != null ? ` \u00b7 ${trip.currency} ${trip.total_budget.toFixed(2)} total` : ''}
          </Text>
        </View>
        {!!trip?.is_archived && (
          <View className="badge-warning">
            <Text className="text-xs font-bold text-amber-700">Archived</Text>
          </View>
        )}
      </View>

      {!!error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Text className="text-sm text-red-700 font-medium">{error}</Text>
        </View>
      )}

      {/* Budget & Dates */}
      <View>
        <Text className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Budget & Dates</Text>
        <View className="card-elevated p-5 space-y-4">
          <View>
            <Text className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              Total budget ({trip?.currency ?? '\u2026'})
            </Text>
            <View className={`flex-row items-center gap-2 input-field ${budgetFocused ? 'input-field-focused' : ''} ${budgetError ? 'border-red-300' : ''}`}>
              <IndianRupee size={16} color="#94a3b8" />
              <TextInput
                className="flex-1 text-2xl font-black text-slate-900"
                value={budget}
                onChangeText={setBudget}
                onFocus={() => setBudgetFocused(true)}
                onBlur={() => setBudgetFocused(false)}
                placeholder="No budget set"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
            </View>
            {!!budgetError && <Text className="text-xs text-red-500 font-semibold mt-1.5">{budgetError}</Text>}
          </View>

          <View className="h-px bg-slate-100" />

          <View className="space-y-3">
            <Text className="text-xs font-bold text-slate-500 uppercase tracking-widest">Dates</Text>
            <View>
              <Text className="text-xs text-slate-400 mb-1.5">Start</Text>
              <DatePicker value={startDate} onChange={setStartDate} />
            </View>
            <View>
              <Text className="text-xs text-slate-400 mb-1.5">End</Text>
              <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
            </View>
            {!!dateError && <Text className="text-xs text-red-500 font-semibold">{dateError}</Text>}
          </View>
        </View>
      </View>

      <PrimaryButton onPress={handleSave} loading={saving} className="w-full">
        Save Changes
      </PrimaryButton>

      {/* Trip */}
      <View>
        <Text className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Trip</Text>
        <View className="card-elevated overflow-hidden p-0">
          <SettingsRow icon={<Users size={16} color="#0d9488" />} iconBg="bg-teal-50" title="Manage Members" subtitle={`${participantCount} participant${participantCount !== 1 ? 's' : ''}`} onPress={onOpenMembers} />
          <View className="h-px bg-slate-50 mx-4" />
          <SettingsRow icon={<Clock size={16} color="#64748b" />} iconBg="bg-slate-100" title="Activity Log" onPress={onOpenActivityLog} />
          <View className="h-px bg-slate-50 mx-4" />
          <SettingsRow icon={<Repeat size={16} color="#7c3aed" />} iconBg="bg-violet-50" title="Recurring Expenses" onPress={onOpenRecurring} />
        </View>
      </View>

      {/* Trip actions */}
      <View>
        <Text className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Trip Actions</Text>
        <View className="card-elevated overflow-hidden p-0">
          <SettingsRow
            icon={<Archive size={16} color="#d97706" />}
            iconBg="bg-amber-50"
            title={trip?.is_archived ? 'Unarchive Trip' : 'Archive Trip'}
            onPress={confirmArchive}
          />
          <View className="h-px bg-slate-50 mx-4" />
          <SettingsRow icon={<LogOut size={16} color="#dc2626" />} iconBg="bg-red-50" title="Leave Trip" titleColor="text-red-600" onPress={confirmLeave} />
          <View className="h-px bg-slate-50 mx-4" />
          <SettingsRow icon={<Trash2 size={16} color="#dc2626" />} iconBg="bg-red-50" title="Delete Trip" titleColor="text-red-600" onPress={confirmDelete} />
        </View>
      </View>
    </ScrollView>
  );
}

function SettingsRow({
  icon,
  iconBg,
  title,
  subtitle,
  titleColor = 'text-slate-900',
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
    <Pressable onPress={onPress} className="w-full px-4 py-3.5 flex-row items-center gap-3 active:bg-slate-50">
      <View className={`w-9 h-9 rounded-xl items-center justify-center flex-shrink-0 ${iconBg}`}>{icon}</View>
      <View className="flex-1 min-w-0">
        <Text className={`font-semibold text-sm ${titleColor}`}>{title}</Text>
        {!!subtitle && <Text className="text-xs text-slate-400 mt-0.5">{subtitle}</Text>}
      </View>
      <ChevronRight size={16} color="#cbd5e1" />
    </Pressable>
  );
}
