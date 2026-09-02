import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Repeat, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';
import Chip from '../components/Chip';

type Participant = { id: string; display_name: string };
type Template = { id: string; description: string; amount: number; currency: string; recurrence_rule: string; next_run_date: string };

const RULES = ['weekly', 'monthly', 'yearly'] as const;

// Restyled with this port's design language -- no TripSpend screen to port from (that
// codebase doesn't have recurring expenses at all). All logic (both RPC calls, the
// participant/template watch queries) unchanged from before this pass -- only the JSX
// changed, plus the paid-by/repeats selectors now use the same shared Chip component
// AddExpenseScreen.tsx uses, extracted there once it was needed in a second place.
export default function RecurringScreen({ tripId, currency, onBack }: { tripId: string; currency: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [rule, setRule] = useState<(typeof RULES)[number]>('monthly');
  const [nextRunDate, setNextRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    db.watch('SELECT id, display_name FROM participants WHERE trip_id = ?', [tripId], {
      onResult: (result) => {
        const rows = result.rows?._array ?? [];
        setParticipants(rows);
        setPaidBy((current) => current ?? rows[0]?.id ?? null);
      },
    }, { signal: controller.signal });
    db.watch(
      'SELECT id, description, amount, currency, recurrence_rule, next_run_date FROM expense_templates WHERE trip_id = ? AND is_active = 1 ORDER BY next_run_date',
      [tripId],
      { onResult: (result) => setTemplates(result.rows?._array ?? []) },
      { signal: controller.signal }
    );
    return () => controller.abort();
  }, [tripId]);

  async function createTemplate() {
    if (!description.trim() || !amount || !paidBy || Number(amount) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await callRpc('create_expense_template', {
        p_trip_id: tripId,
        p_description: description.trim(),
        p_amount: Number(amount),
        p_currency: currency,
        p_paid_by: paidBy,
        p_split_type: 'equal',
        p_split_config: {},
        p_recurrence_rule: rule,
        p_next_run_date: nextRunDate,
        p_category: null,
      });
      setDescription('');
      setAmount('');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    setError(null);
    try {
      await callRpc('delete_expense_template', { p_template_id: id }, { idempotent: false });
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16) + 32,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center gap-3 mb-5">
        <Pressable onPress={onBack} disabled={busy} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
          <ArrowLeft size={20} color="#1e293b" />
        </Pressable>
        <View>
          <GradientText className="text-2xl font-black">Recurring Expenses</GradientText>
          <Text className="text-xs font-semibold text-slate-500">Auto-repeating expenses and templates</Text>
        </View>
      </View>

      <View className="card-elevated p-4 space-y-4">
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Description</Text>
          <TextInput className="input-field text-base text-slate-900" value={description} onChangeText={setDescription} placeholder="Rent" placeholderTextColor="#94a3b8" />
        </View>
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Amount ({currency})</Text>
          <TextInput className="input-field text-base text-slate-900" value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor="#94a3b8" keyboardType="decimal-pad" />
        </View>
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Paid by</Text>
          <View className="flex-row flex-wrap gap-2">
            {participants.map((participant) => (
              <Chip key={participant.id} selected={paidBy === participant.id} label={participant.display_name} onPress={() => setPaidBy(participant.id)} />
            ))}
          </View>
        </View>
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Repeats</Text>
          <View className="flex-row gap-2">
            {RULES.map((option) => (
              <Chip key={option} selected={rule === option} label={option} onPress={() => setRule(option)} />
            ))}
          </View>
        </View>
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Next run date (YYYY-MM-DD)</Text>
          <TextInput className="input-field text-base text-slate-900" value={nextRunDate} onChangeText={setNextRunDate} placeholder="2026-09-01" placeholderTextColor="#94a3b8" />
        </View>
        <PrimaryButton
          onPress={createTemplate}
          disabled={busy || !description.trim() || !amount || !paidBy}
          loading={busy}
          icon={<Repeat size={16} color="#fff" />}
          className="w-full"
        >
          Add recurring expense
        </PrimaryButton>
      </View>

      <View>
        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Active templates</Text>
        {templates.length === 0 && <Text className="text-slate-400 text-sm">No recurring expenses set up yet.</Text>}
        {templates.map((template) => (
          <View className="flex-row items-center justify-between gap-3 bg-slate-50 rounded-2xl px-4 py-3 mb-2" key={template.id}>
            <View className="flex-1">
              <Text className="text-sm font-bold text-slate-900">{template.description}</Text>
              <Text className="text-xs text-slate-500 mt-0.5">
                {template.currency} {template.amount.toFixed(2)} · {template.recurrence_rule} · next {template.next_run_date}
              </Text>
            </View>
            <Pressable onPress={() => deleteTemplate(template.id)} className="flex-row items-center gap-1">
              <X size={12} color="#e11d48" />
              <Text className="text-xs font-bold text-rose-600">Stop</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {!!error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Text className="text-sm text-red-700 font-medium">{error}</Text>
        </View>
      )}
    </ScrollView>
  );
}
