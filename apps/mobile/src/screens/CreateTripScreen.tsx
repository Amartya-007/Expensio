import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { callRpc } from '../rpc';
import { detectCurrency } from '../utils/detectCurrency';
import { currencyIcon } from '../utils/currencyIcon';
import GradientText from '../components/GradientText';
import PrimaryButton from '../components/PrimaryButton';
import Chip from '../components/Chip';
import DatePicker from '../components/DatePicker';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'SGD'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// This is a genuinely original design, not a port of either tripspend/src/screens/
// SetupScreen.tsx or its own Onboarding.tsx (a 3-slide feature carousel) -- deliberately
// asked for as its own thing, not a photocopy of either. It's also not built from the
// "TripSpend UX/UI Psychology" document pasted into this project's chat at one point:
// that doc's specific techniques (a progress bar pre-filled before any real progress,
// "I'll risk it" loss-aversion copy, manufactured urgency) were considered and explicitly
// rejected as manipulative, not just skipped for scope reasons -- see that conversation
// for the full reasoning. What carried over from it is only the legitimate part: fewer
// decisions, sensible defaults, no signup wall (already true of this app's anonymous-auth
// architecture, nothing to add there).
//
// The actual design choice here: no slides, no "skip" (there's nothing to skip), one
// screen. The trip name is the hero -- a large, borderless input merged into the
// question itself ("Where to?") rather than a small boxed field under a separate
// headline, since naming the trip *is* the one thing this screen is for. Currency
// defaults from the device's own locale (detectCurrency.ts) -- a real friction reducer,
// not a manufactured one, and fully overridable right there. Budget and dates are
// genuinely optional and collapsed by default, so the fewest-taps path is: type a name,
// tap Start Planning.
export default function CreateTripScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (tripId: string | null, currency: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(detectCurrency);
  const [showMore, setShowMore] = useState(false);
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDaysIso(3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetNum = Number(budget);
  const budgetValid = budget === '' || (Number.isFinite(budgetNum) && budgetNum > 0);
  const BudgetIcon = currencyIcon(currency);

  async function submit() {
    if (!name.trim() || !budgetValid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callRpc<string>('create_trip', {
        p_name: name.trim(),
        p_currency: currency,
        ...(showMore && { p_start_date: startDate, p_end_date: endDate }),
        ...(showMore && budget !== '' && { p_total_budget: budgetNum }),
      });
      if (result.status === 'ok') {
        onCreated(result.data, currency);
      } else {
        // Queued for later — there's no local trip row to open yet (it doesn't exist
        // locally until the RPC actually runs and syncs back down), so go back to the
        // list instead of trying to navigate into it.
        onCreated(null, currency);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="page-shell pb-10" keyboardShouldPersistTaps="handled">
      <Pressable onPress={onCancel} className="p-2 -ml-2 -mt-1 mb-6 self-start rounded-xl active:bg-slate-100">
        <ArrowLeft size={20} color="#64748b" />
      </Pressable>

      <GradientText className="text-4xl font-black tracking-tight mb-1">Where to?</GradientText>
      <Text className="text-sm text-slate-400 mb-6">Name it, and we'll set everything else up as you go.</Text>

      <TextInput
        className="text-3xl font-black text-slate-900 pb-3 border-b-2 border-slate-100 mb-8"
        value={name}
        onChangeText={setName}
        placeholder="Goa, December"
        placeholderTextColor="#cbd5e1"
        autoFocus
        returnKeyType="done"
      />

      <Text className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5">Currency</Text>
      <View className="flex-row flex-wrap gap-2 mb-2">
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>
      <Text className="text-xs text-slate-300 mb-8">Guessed from your device — tap to change it.</Text>

      {!showMore ? (
        <Pressable onPress={() => setShowMore(true)} className="mb-8">
          <Text className="text-sm font-bold text-blue-600">+ Add a budget or dates</Text>
        </Pressable>
      ) : (
        <View className="card-elevated p-5 space-y-4 mb-8">
          <View>
            <Text className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Total budget (optional)</Text>
            <View className="flex-row items-center gap-2 input-field">
              <BudgetIcon size={16} color="#94a3b8" />
              <TextInput
                className="flex-1 text-lg font-bold text-slate-900"
                value={budget}
                onChangeText={setBudget}
                placeholder="No limit"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
            </View>
            {!budgetValid && <Text className="text-xs text-red-500 font-semibold mt-1.5">Enter a budget greater than 0.</Text>}
          </View>
          <View className="h-px bg-slate-100" />
          <View>
            <Text className="text-xs text-slate-400 mb-1.5">Start</Text>
            <DatePicker value={startDate} onChange={setStartDate} />
          </View>
          <View>
            <Text className="text-xs text-slate-400 mb-1.5">End</Text>
            <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
          </View>
        </View>
      )}

      {!!error && <Text className="text-sm text-red-600 font-medium mb-4">{error}</Text>}

      <PrimaryButton onPress={submit} loading={busy} disabled={!name.trim() || !budgetValid} className="w-full">
        Start Planning
      </PrimaryButton>
    </ScrollView>
  );
}
