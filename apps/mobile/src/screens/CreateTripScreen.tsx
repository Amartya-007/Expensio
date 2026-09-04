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
import { LinearGradient } from 'expo-linear-gradient';
import { callRpc } from '../rpc';
import { detectCurrency } from '../utils/detectCurrency';
import { currencyIcon } from '../utils/currencyIcon';
import { formatError } from '../utils/errors';
import GradientText from '../components/GradientText';
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
  const budgetValid = budget === '' || (Number.isFinite(budgetNum) && budgetNum > 0);
  const BudgetIcon = currencyIcon(currency);

  async function submit() {
    if (!name.trim() || !budgetValid) return;
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
            hitSlop={8}
          >
            <ArrowLeft size={18} color="#334155" />
          </Pressable>
          <View style={s.newBadge}>
            <Sparkles size={11} color="#2563eb" />
            <Text style={s.newBadgeText}>New Journey</Text>
          </View>
        </View>

        {/* Title */}
        <View style={s.titleBlock}>
          <GradientText className="text-3xl font-black tracking-tight">Where to?</GradientText>
          <Text style={s.subtitle}>Name your trip, set a currency, and start splitting.</Text>
        </View>

        {/* Trip name card */}
        <View style={s.card}>
          <Text style={s.fieldLabel}>Trip Name</Text>
          <View style={s.nameInputRow}>
            <Compass size={20} color="#2563eb" />
            <TextInput
              style={s.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Goa Trip, Euro Summer"
              placeholderTextColor="#94a3b8"
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
            style={s.collapsibleHeader}
          >
            <View style={s.collapsibleHeaderLeft}>
              <Calendar size={17} color="#2563eb" />
              <Text style={s.collapsibleTitle}>Dates &amp; Budget (Optional)</Text>
            </View>
            <View style={s.chevronWrap}>
              {showMore ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
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
                <BudgetIcon size={17} color="#64748b" />
                <TextInput
                  style={s.budgetInput}
                  value={budget}
                  onChangeText={setBudget}
                  placeholder="No limit"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
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
            <AlertCircle size={16} color="#dc2626" />
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
        >
          Start Planning
        </PrimaryButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  newBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 20 },
  newBadgeText: { fontSize: 11, fontWeight: '700', color: '#2563eb' },

  titleBlock: { marginBottom: 24, gap: 6 },
  subtitle: { fontSize: 13, fontWeight: '500', color: '#64748b', lineHeight: 20 },

  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16, shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2, gap: 12 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  autoLabel: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },
  subLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },

  nameInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  nameInput: { flex: 1, fontSize: 18, fontWeight: '700', color: '#0f172a' },

  currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currencyChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
  currencyChipSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  currencyChipUnselected: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  currencyChipPressed: { backgroundColor: '#f1f5f9' },
  currencySymbol: { fontSize: 12, fontWeight: '700' },
  currencySymbolSelected: { color: '#bfdbfe' },
  currencySymbolUnselected: { color: '#94a3b8' },
  currencyCode: { fontSize: 12, fontWeight: '800' },
  currencyCodeSelected: { color: '#fff' },
  currencyCodeUnselected: { color: '#334155' },

  collapsibleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapsibleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapsibleTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  chevronWrap: { width: 28, height: 28, borderRadius: 9, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  collapsibleBody: { gap: 6 },
  divider: { height: 1, backgroundColor: '#f1f5f9' },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  budgetInput: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0f172a' },
  fieldError: { fontSize: 11, fontWeight: '600', color: '#dc2626' },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', marginBottom: 16 },
  errorTitle: { fontSize: 12, fontWeight: '800', color: '#991b1b' },
  errorBody: { fontSize: 12, fontWeight: '500', color: '#b91c1c', marginTop: 2, lineHeight: 18 },
});
