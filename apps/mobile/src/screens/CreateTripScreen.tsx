import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowLeft, Calendar, Compass, DollarSign, Sparkles, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callRpc } from '../rpc';
import { detectCurrency } from '../utils/detectCurrency';
import { currencyIcon } from '../utils/currencyIcon';
import { formatError } from '../utils/errors';
import GradientText from '../components/GradientText';
import PrimaryButton from '../components/PrimaryButton';
import DatePicker from '../components/DatePicker';

const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
];

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function plusDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-slate-50"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 24) + 24,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Navigation / Header */}
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.7}
            className="w-10 h-10 -ml-1 rounded-2xl bg-white items-center justify-center"
            style={{
              borderWidth: 1,
              borderColor: 'rgba(226, 232, 240, 0.8)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 2,
              elevation: 1,
            }}
          >
            <ArrowLeft size={20} color="#334155" />
          </TouchableOpacity>

          <View
            className="flex-row items-center gap-1.5 px-3 py-1 border border-blue-100 rounded-full"
            style={{ backgroundColor: 'rgba(239, 246, 255, 0.8)' }}
          >
            <Sparkles size={12} color="#2563eb" />
            <Text className="text-xs font-bold text-blue-700">New Journey</Text>
          </View>
        </View>

        {/* Title */}
        <View className="mb-6">
          <GradientText className="text-3xl font-black tracking-tight mb-1">
            Where to?
          </GradientText>
          <Text className="text-sm font-medium text-slate-500">
            Name your trip, set your currency, and start splitting effortlessly.
          </Text>
        </View>

        {/* Hero Trip Name Input Card */}
        <View
          className="bg-white rounded-3xl p-5 mb-6"
          style={{
            borderWidth: 1,
            borderColor: 'rgba(226, 232, 240, 0.8)',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
            Trip Name
          </Text>
          <View
            className="flex-row items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3 focus:border-blue-500"
            style={{ borderWidth: 1, borderColor: 'rgba(226, 232, 240, 0.8)' }}
          >
            <Compass size={22} color="#2563eb" />
            <TextInput
              className="flex-1 text-xl font-bold text-slate-900"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Goa Trip, Euro Summer"
              placeholderTextColor="#94a3b8"
              autoFocus
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Currency Selection Card */}
        <View
          className="bg-white rounded-3xl p-5 border border-slate-200 mb-6"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
            </Text>
            <Text className="text-[11px] font-semibold text-slate-400">
              Auto-detected
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {CURRENCIES.map((c) => {
              const isSelected = currency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  activeOpacity={0.7}
                  onPress={() => setCurrency(c.code)}
                  className={`flex-row items-center gap-1.5 px-3.5 py-2.5 rounded-2xl border ${isSelected
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-slate-50 border-slate-200 active:bg-slate-100'
                    }`}
                  style={
                    isSelected
                      ? {
                        shadowColor: '#3b82f6',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.2,
                        shadowRadius: 2,
                        elevation: 2,
                      }
                      : undefined
                  }
                >
                  <Text
                    className={`text-xs font-bold ${isSelected ? 'text-blue-100' : 'text-slate-400'
                      }`}
                  >
                    {c.symbol}
                  </Text>
                  <Text
                    className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-700'
                      }`}
                  >
                    {c.code}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Dates & Budget Card */}
        <View
          className="bg-white rounded-3xl p-5 border border-slate-200 mb-6"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowMore((prev) => !prev)}
            className="flex-row items-center justify-between"
          >
            <View className="flex-row items-center gap-2">
              <Calendar size={18} color="#2563eb" />
              <Text className="text-sm font-bold text-slate-800">
                Dates & Budget (Optional)
              </Text>
            </View>
            <View className="w-7 h-7 rounded-xl bg-slate-100 items-center justify-center">
              {showMore ? (
                <ChevronUp size={16} color="#64748b" />
              ) : (
                <ChevronDown size={16} color="#64748b" />
              )}
            </View>
          </TouchableOpacity>

          {showMore && (
            <View className="mt-4 pt-4 border-t border-slate-100 space-y-4">
              {/* Dates */}
              <View className="space-y-3">
                <View>
                  <Text className="text-xs font-bold text-slate-500 mb-1.5">
                    Start Date
                  </Text>
                  <DatePicker
                    value={startDate}
                    onChange={(d) => {
                      setStartDate(d);
                      if (endDate < d) {
                        setEndDate(d);
                      }
                    }}
                    label="Trip Start Date"
                  />
                </View>

                <View className="mt-3">
                  <Text className="text-xs font-bold text-slate-500 mb-1.5">
                    End Date
                  </Text>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    minDate={startDate}
                    label="Trip End Date"
                  />
                </View>
              </View>

              {/* Total Budget */}
              <View className="pt-2">
                <Text className="text-xs font-bold text-slate-500 mb-1.5">
                  Total Budget ({currency})
                </Text>
                <View className="flex-row items-center gap-2.5 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl">
                  <BudgetIcon size={18} color="#64748b" />
                  <TextInput
                    className="flex-1 text-base font-bold text-slate-900"
                    value={budget}
                    onChangeText={setBudget}
                    placeholder="No limit"
                    placeholderTextColor="#94a3b8"
                    keyboardType="decimal-pad"
                  />
                </View>
                {!budgetValid && (
                  <Text className="text-xs text-red-500 font-semibold mt-1.5">
                    Enter a valid budget greater than 0.
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Error Banner */}
        {!!error && (
          <View className="flex-row items-start gap-2.5 p-4 rounded-2xl bg-red-50 border border-red-200 mb-6">
            <AlertCircle size={18} color="#dc2626" className="mt-0.5 shrink-0" />
            <View className="flex-1">
              <Text className="text-xs font-bold text-red-800">
                Could not create trip
              </Text>
              <Text className="text-xs text-red-600 mt-0.5 leading-relaxed font-medium">
                {error}
              </Text>
            </View>
          </View>
        )}

        {/* Submit Button */}
        <PrimaryButton
          onPress={submit}
          loading={busy}
          disabled={!name.trim() || !budgetValid}
          className="w-full"
          style={{
            shadowColor: '#2563eb',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 15,
            elevation: 6,
          }}
        >
          Start Planning
        </PrimaryButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
