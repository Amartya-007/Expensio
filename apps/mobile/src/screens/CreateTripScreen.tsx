import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Compass,
  Sparkles,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { detectCurrency } from '../utils/detectCurrency';
import { currencyIcon } from '../utils/currencyIcon';
import { formatError } from '../utils/errors';
import { LIMITS, validateTripName, validateTripBudget, validateTripDate } from '../constants/limits';
import PrimaryButton from '../components/PrimaryButton';
import DatePicker from '../components/DatePicker';

const CURRENCIES = [
  { code: 'INR', symbol: '₹' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'JPY', symbol: '¥' },
  { code: 'SGD', symbol: 'S$' },
];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function plusDaysIso(days: number) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function CreateTripScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (tripId: string | null, currency: string) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(detectCurrency);
  const [showMore, setShowMore] = useState(true);
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDaysIso(4));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetNum = Number(budget);
  const budgetValid = validateTripBudget(budget) === null;
  const BudgetIcon = currencyIcon(currency);

  async function submit() {
    const nameError = validateTripName(name);
    const budgetError = validateTripBudget(budget);
    const dateError = showMore ? validateTripDate(startDate) ?? validateTripDate(endDate) : null;
    const firstError = nameError ?? budgetError ?? dateError;
    if (firstError) {
      setError(firstError);
      return;
    }
    setBusy(true); setError(null);
    try {
      const result = await callRpc<string>('create_trip', {
        p_name: name.trim(),
        p_currency: currency,
        ...(showMore && { p_start_date: startDate, p_end_date: endDate }),
        ...(showMore && budget !== '' && { p_total_budget: budgetNum }),
      });
      onCreated(result.status === 'ok' ? result.data : null, currency);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.root}
    >
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 24) + 24,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color="#0b1c30" strokeWidth={2} />
          </Pressable>
          <View style={s.newBadge}>
            <Sparkles size={12} color="#2563eb" />
            <Text style={s.newBadgeText}>New Journey</Text>
          </View>
        </View>

        {/* Title */}
        <View style={s.titleBlock}>
          <Text style={s.title}>Where to?</Text>
          <Text style={s.subtitle}>Name your trip, set a primary currency, and start splitting.</Text>
        </View>

        {/* Trip name card */}
        <View style={s.card}>
          <Text style={s.fieldLabel}>Trip Name</Text>
          <View style={s.nameInputRow}>
            <Compass size={20} color="#2563eb" strokeWidth={2} />
            <TextInput
              style={s.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Goa Trip, Euro Summer"
              placeholderTextColor="#94a3b8"
              maxLength={LIMITS.trip.name.max}
              autoFocus
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Currency card */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <Text style={s.fieldLabel}>Primary Currency</Text>
            <Text style={s.autoLabel}>Auto-detected</Text>
          </View>
          <View style={s.currencyGrid}>
            {CURRENCIES.map((c) => {
              const selected = currency === c.code;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => setCurrency(c.code)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.code} currency`}
                  style={({ pressed }) => [
                    s.currencyChip,
                    selected ? s.currencyChipSelected : s.currencyChipUnselected,
                    pressed && !selected && s.currencyChipPressed,
                  ]}
                >
                  <Text style={[s.currencySymbol, selected ? s.currencySymbolSelected : s.currencySymbolUnselected]}>
                    {c.symbol}
                  </Text>
                  <Text style={[s.currencyCode, selected ? s.currencyCodeSelected : s.currencyCodeUnselected]}>
                    {c.code}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Dates & budget card */}
        <View style={s.card}>
          <Pressable
            onPress={() => setShowMore(v => !v)}
            accessibilityRole="button"
            accessibilityLabel="Toggle dates and budget"
            style={s.collapsibleHeader}
          >
            <View style={s.collapsibleHeaderLeft}>
              <Calendar size={18} color="#2563eb" strokeWidth={2} />
              <Text style={s.collapsibleTitle}>Dates &amp; Budget (Optional)</Text>
            </View>
            <View style={s.chevronWrap}>
              {showMore ? <ChevronUp size={16} color="#434655" /> : <ChevronDown size={16} color="#434655" />}
            </View>
          </Pressable>

          {showMore && (
            <View style={s.collapsibleBody}>
              <View style={s.divider} />

              <Text style={s.subLabel}>Start Date</Text>
              <DatePicker
                value={startDate}
                onChange={(d) => { setStartDate(d); if (endDate < d) setEndDate(d); }}
                label="Trip Start Date"
              />

              <Text style={[s.subLabel, { marginTop: 12 }]}>End Date</Text>
              <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} label="Trip End Date" />

              <Text style={[s.subLabel, { marginTop: 12 }]}>Total Budget ({currency})</Text>
              <View style={s.budgetRow}>
                <BudgetIcon size={18} color="#434655" />
                <TextInput
                  style={s.budgetInput}
                  value={budget}
                  onChangeText={setBudget}
                  placeholder="No limit"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  maxLength={String(LIMITS.trip.budget.max).length + 3}
                />
              </View>
              {!budgetValid && (
                <Text style={s.fieldError}>Enter a valid budget greater than 0.</Text>
              )}
            </View>
          )}
        </View>

        {/* Error banner */}
        {!!error && (
          <View style={s.errorBanner}>
            <AlertCircle size={16} color="#ba1a1a" />
            <View style={{ flex: 1 }}>
              <Text style={s.errorTitle}>Could not create trip</Text>
              <Text style={s.errorBody}>{error}</Text>
            </View>
          </View>
        )}

        <PrimaryButton
          onPress={submit}
          loading={busy}
          disabled={!name.trim() || !budgetValid}
          style={{ marginTop: 8 }}
        >
          Start Planning
        </PrimaryButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f9ff' },
  scroll: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  backBtnPressed: { backgroundColor: '#f1f5f9' },
  newBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#eff4ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 20,
  },
  newBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#2563eb',
  },

  titleBlock: { marginBottom: 20, gap: 4 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    lineHeight: 20,
  },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
    shadowColor: '#0b1c30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#434655',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  autoLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#737686',
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#434655',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  nameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c3c6d7',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  nameInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },

  currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currencyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
  },
  currencyChipSelected: {
    backgroundColor: '#0b1c30',
    borderColor: '#0b1c30',
  },
  currencyChipUnselected: {
    backgroundColor: '#f8f9ff',
    borderColor: '#e2e8f0',
  },
  currencyChipPressed: { backgroundColor: '#eff4ff' },
  currencySymbol: { fontSize: 13, fontWeight: '700' },
  currencySymbolSelected: { color: '#bfdbfe' },
  currencySymbolUnselected: { color: '#737686' },
  currencyCode: { fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  currencyCodeSelected: { color: '#ffffff' },
  currencyCodeUnselected: { color: '#0b1c30' },

  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  collapsibleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapsibleTitle: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
  },
  chevronWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleBody: { gap: 8, marginTop: 4 },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 4 },

  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c3c6d7',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  budgetInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    color: '#0b1c30',
    fontVariant: ['tabular-nums'],
  },
  fieldError: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'Inter_400Regular',
    color: '#ba1a1a',
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#ffdad6',
    borderWidth: 1,
    borderColor: '#ffb4ab',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#93000a',
  },
  errorBody: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#410002',
    marginTop: 2,
    lineHeight: 18,
  },
});
