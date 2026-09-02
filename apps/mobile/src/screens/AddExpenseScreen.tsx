import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, Plus, Receipt, Tag, Users, Wallet, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { randomUUID } from '../utils/uuid';
import { formatError } from '../utils/errors';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';

type Participant = { id: string; display_name: string };
type Category = { id: string; name: string; icon: string };
type SplitType = 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustment' | 'itemized' | 'reimbursement';
type Item = { id: string; label: string; amount: string; sharedBy: string[] };

const SPLIT_TYPES: Array<{ value: SplitType; label: string }> = [
  { value: 'equal', label: 'Equal' },
  { value: 'exact', label: 'Exact' },
  { value: 'percentage', label: '%' },
  { value: 'shares', label: 'Shares' },
  { value: 'adjustment', label: 'Adjust' },
  { value: 'itemized', label: 'Items' },
  { value: 'reimbursement', label: 'Reimburse' },
];

function toMinor(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function fillValues(rows: Participant[], current: Record<string, string>, fallback: string) {
  return rows.reduce<Record<string, string>>((result, participant) => {
    result[participant.id] = current[participant.id] ?? fallback;
    return result;
  }, {});
}

function equalPercentages(rows: Participant[]): Record<string, string> {
  if (rows.length === 0) return {};
  const base = Math.floor(10000 / rows.length);
  let remainder = 10000 - base * rows.length;
  return rows.reduce<Record<string, string>>((result, participant) => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder -= value > base ? 1 : 0;
    result[participant.id] = (value / 100).toFixed(2);
    return result;
  }, {});
}

export default function AddExpenseScreen({
  tripId,
  currency,
  onDone,
  onCancel,
}: {
  tripId: string;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [exactShares, setExactShares] = useState<Record<string, string>>({});
  const [percentageShares, setPercentageShares] = useState<Record<string, string>>({});
  const [shareUnits, setShareUnits] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [adjustmentRemainder, setAdjustmentRemainder] = useState<'equal' | 'shares'>('equal');
  const [remainderUnits, setRemainderUnits] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [tax, setTax] = useState('0.00');
  const [tip, setTip] = useState('0.00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name FROM participants WHERE trip_id = ?',
      [tripId],
      {
        onResult: async (result) => {
          const rows = result.rows?._array ?? [];
          setParticipants(rows);
          setExactShares((current) => fillValues(rows, current, ''));
          setPercentageShares((current) =>
            Object.keys(current).length === 0 ? equalPercentages(rows) : fillValues(rows, current, '0.00')
          );
          setShareUnits((current) => fillValues(rows, current, '1'));
          setAdjustments((current) => fillValues(rows, current, ''));
          setRemainderUnits((current) => fillValues(rows, current, '1'));
          setItems((current) =>
            current.length === 0
              ? [{ id: randomUUID(), label: '', amount: '', sharedBy: rows.map((row: Participant) => row.id) }]
              : current.map((item) => ({
                  ...item,
                  sharedBy: item.sharedBy.filter((id) => rows.some((row: Participant) => row.id === id)),
                }))
          );
          if (paidBy === null && rows.length > 0) {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            const mine = await db.getAll<{ id: string }>(
              'SELECT id FROM participants WHERE trip_id = ? AND linked_user_id = ?',
              [tripId, session?.user.id ?? '']
            );
            setPaidBy(mine[0]?.id ?? rows[0].id);
          }
        },
      },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, name, icon FROM custom_categories WHERE trip_id = ? ORDER BY name',
      [tripId],
      { onResult: (result) => setCategories(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [tripId]);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setError(null);
    try {
      const result = await callRpc<string>('add_custom_category', {
        p_trip_id: tripId,
        p_name: name,
        p_icon: 'tag',
      });
      setCategory(name);
      setNewCategory('');
      setShowAddCat(false);
      if (result.status === 'queued') setError('Category will appear after connection returns.');
    } catch (err) {
      setError(formatError(err));
    }
  }

  function updateMap(
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    participantId: string,
    value: string
  ) {
    setter((current) => ({ ...current, [participantId]: value }));
  }

  function parseWeights(map: Record<string, string>): Record<string, number> | null {
    const result: Record<string, number> = {};
    for (const participant of participants) {
      const parsed = Number(map[participant.id] ?? '0');
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      result[participant.id] = parsed;
    }
    return Object.values(result).reduce((sum, n) => sum + n, 0) > 0 ? result : null;
  }

  function buildSplitConfig(): Record<string, unknown> | null {
    switch (splitType) {
      case 'equal':
        return {};
      case 'exact':
      case 'reimbursement': {
        const amounts: Record<string, number> = {};
        for (const participant of participants) {
          const minor = toMinor(exactShares[participant.id] ?? '');
          if (minor === null || minor < 0) return null;
          amounts[participant.id] = minor;
        }
        return { amounts };
      }
      case 'percentage': {
        const weights = parseWeights(percentageShares);
        return weights ? { weights } : null;
      }
      case 'shares': {
        const weights = parseWeights(shareUnits);
        return weights ? { weights } : null;
      }
      case 'adjustment': {
        const adjustmentsMinor: Record<string, number> = {};
        for (const participant of participants) {
          const raw = adjustments[participant.id] ?? '';
          if (raw.trim() === '') {
            adjustmentsMinor[participant.id] = 0;
            continue;
          }
          const minor = toMinor(raw);
          if (minor === null) return null;
          adjustmentsMinor[participant.id] = minor;
        }
        if (adjustmentRemainder === 'shares') {
          const weights = parseWeights(remainderUnits);
          if (!weights) return null;
          return { adjustments: adjustmentsMinor, remainder: 'shares', weights };
        }
        return { adjustments: adjustmentsMinor, remainder: 'equal' };
      }
      case 'itemized': {
        const parsedItems: Array<{ id: string; label: string; amount: number; shared_by: string[] }> = [];
        for (const item of items) {
          const label = item.label.trim();
          const amountMinor = toMinor(item.amount);
          if (!label || amountMinor === null || amountMinor <= 0 || item.sharedBy.length === 0) return null;
          parsedItems.push({
            id: item.id,
            label,
            amount: amountMinor,
            shared_by: item.sharedBy,
          });
        }
        const taxMinor = toMinor(tax) ?? 0;
        const tipMinor = toMinor(tip) ?? 0;
        return { items: parsedItems, tax: taxMinor, tip: tipMinor };
      }
    }
  }

  function validateSplit(amountMinor: number, config: Record<string, unknown>): string | null {
    if (splitType === 'exact') {
      const amounts = (config.amounts as Record<string, number>) ?? {};
      const total = Object.values(amounts).reduce((sum, n) => sum + n, 0);
      if (total !== amountMinor) {
        return `Individual shares sum to ${(total / 100).toFixed(2)} ${currency}, which doesn't match total expense of ${(amountMinor / 100).toFixed(2)} ${currency}.`;
      }
    }
    if (splitType === 'percentage') {
      const weights = (config.weights as Record<string, number>) ?? {};
      const total = Object.values(weights).reduce((sum, n) => sum + n, 0);
      if (Math.abs(total - 100) > 0.01) {
        return `Percentages must sum to 100% (currently ${total.toFixed(2)}%).`;
      }
    }
    if (splitType === 'itemized') {
      const rawItems = (config.items as Array<{ amount: number }>) ?? [];
      const itemSum = rawItems.reduce((sum, item) => sum + item.amount, 0);
      const taxMinor = (config.tax as number) ?? 0;
      const tipMinor = (config.tip as number) ?? 0;
      if (itemSum + taxMinor + tipMinor !== amountMinor) {
        return `Items sum to ${((itemSum + taxMinor + tipMinor) / 100).toFixed(2)} ${currency}, matching total of ${(amountMinor / 100).toFixed(2)} ${currency} is required.`;
      }
    }
    return null;
  }

  async function submit() {
    setError(null);
    const parsedAmount = Number(amount);
    const amountMinor = toMinor(amount);
    if (!description.trim()) {
      setError('Please enter a description for the expense.');
      return;
    }
    if (!amountMinor || amountMinor <= 0) {
      setError('Please enter a valid positive amount.');
      return;
    }
    if (!paidBy) {
      setError('Select who paid for this expense.');
      return;
    }

    const splitConfig = buildSplitConfig();
    if (!splitConfig) {
      setError('Please fill in valid split values for all participants.');
      return;
    }

    const validationError = validateSplit(amountMinor, splitConfig);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    try {
      await callRpc('add_expense', {
        p_trip_id: tripId,
        p_description: description.trim(),
        p_amount: parsedAmount,
        p_paid_by: paidBy,
        p_currency: currency,
        p_category: category || null,
        p_split_type: splitType,
        p_split_config: splitConfig,
      });
      onDone();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function renderParticipantValues(
    map: Record<string, string>,
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    title: string,
    placeholder: string
  ) {
    return (
      <View className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80 space-y-3">
        <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</Text>
        {participants.map((participant) => (
          <View key={participant.id} className="flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/60">
            <Text className="text-sm font-bold text-slate-800 flex-1" numberOfLines={1}>
              {participant.display_name}
            </Text>
            <TextInput
              className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 w-28 text-right"
              value={map[participant.id] ?? ''}
              onChangeText={(val) => updateMap(setter, participant.id, val)}
              placeholder={placeholder}
              placeholderTextColor="#94a3b8"
              keyboardType="decimal-pad"
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 20) + 90,
          paddingHorizontal: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center gap-3 mb-5">
          <Pressable onPress={onCancel} disabled={busy} className="p-2 -ml-2 rounded-xl active:bg-slate-100">
            <ArrowLeft size={20} color="#1e293b" />
          </Pressable>
          <View>
            <GradientText className="text-2xl font-black tracking-tight">Add Expense</GradientText>
            <Text className="text-xs font-semibold text-slate-500">Record a new payment or group spend</Text>
          </View>
        </View>

        <View className="space-y-4">
          {/* Main Card: Description & Amount */}
          <View className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80 space-y-3">
            <View>
              <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                What was it for?
              </Text>
              <TextInput
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-base font-bold text-slate-900"
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Dinner, Taxi, Groceries"
                placeholderTextColor="#94a3b8"
                autoFocus
              />
            </View>

            <View>
              <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Amount
              </Text>
              <View className="flex-row items-center bg-white rounded-2xl border border-slate-200 px-4 py-1.5">
                <View className="px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-xl mr-3">
                  <Text className="text-xs font-black text-blue-700">{currency}</Text>
                </View>
                <TextInput
                  className="flex-1 text-2xl font-black text-slate-900 py-2"
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor="#cbd5e1"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>

          {/* Paid By Section */}
          <View className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80">
            <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
              Who Paid?
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {participants.map((participant) => {
                const selected = paidBy === participant.id;
                return (
                  <Pressable
                    key={participant.id}
                    onPress={() => setPaidBy(participant.id)}
                    className={`flex-row items-center gap-1.5 px-3.5 py-2 rounded-2xl border ${selected ? 'bg-blue-600 border-blue-600 shadow-sm' : 'bg-white border-slate-200'}`}
                  >
                    {selected && <Check size={14} color="#ffffff" strokeWidth={3} />}
                    <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-slate-700'}`}>
                      {participant.display_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Category Section */}
          <View className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80">
            <View className="flex-row items-center justify-between mb-2.5">
              <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Category
              </Text>
              <Pressable
                onPress={() => setShowAddCat(!showAddCat)}
                className="flex-row items-center gap-1 py-0.5 px-2 rounded-lg active:bg-slate-200"
              >
                <Plus size={14} color="#2563eb" />
                <Text className="text-xs font-bold text-blue-600">New Category</Text>
              </Pressable>
            </View>

            {showAddCat && (
              <View className="flex-row gap-2 mb-3 bg-white p-2 rounded-2xl border border-slate-200">
                <TextInput
                  className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-900"
                  value={newCategory}
                  onChangeText={setNewCategory}
                  placeholder="Category name"
                  placeholderTextColor="#94a3b8"
                />
                <Pressable
                  onPress={addCategory}
                  disabled={!newCategory.trim()}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 items-center justify-center"
                >
                  <Text className="text-xs font-bold text-white">Save</Text>
                </Pressable>
              </View>
            )}

            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => setCategory('')}
                className={`px-3.5 py-1.5 rounded-xl border ${category === '' ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-200'}`}
              >
                <Text className={`text-xs font-bold ${category === '' ? 'text-white' : 'text-slate-600'}`}>
                  None
                </Text>
              </Pressable>
              {categories.map((entry) => {
                const selected = category === entry.name;
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => setCategory(entry.name)}
                    className={`px-3.5 py-1.5 rounded-xl border ${selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-slate-600'}`}>
                      {entry.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Split Type Selector */}
          <View className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80">
            <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
              Split Method
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {SPLIT_TYPES.map((option) => {
                const selected = splitType === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setSplitType(option.value)}
                    className={`px-3.5 py-2 rounded-xl border ${selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-slate-700'}`}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Dynamic Split Details */}
          {splitType === 'equal' && (
            <View className="bg-blue-50/70 border border-blue-200/80 p-4 rounded-3xl">
              <Text className="text-xs font-bold text-blue-900 mb-0.5">Equally Shared</Text>
              <Text className="text-xs text-blue-700">
                Split evenly among all {participants.length} member{participants.length !== 1 ? 's' : ''} in this trip.
              </Text>
            </View>
          )}

          {splitType === 'exact' && renderParticipantValues(exactShares, setExactShares, 'Exact Amount per Person', '0.00')}
          {splitType === 'reimbursement' && (
            <>
              <View className="bg-blue-50/70 border border-blue-200/80 p-4 rounded-3xl">
                <Text className="text-xs font-bold text-blue-900 mb-0.5">Reimbursement</Text>
                <Text className="text-xs text-blue-700">Amounts are owed directly back to the payer.</Text>
              </View>
              {renderParticipantValues(exactShares, setExactShares, 'Amount to Reimburse', '0.00')}
            </>
          )}
          {splitType === 'percentage' && renderParticipantValues(percentageShares, setPercentageShares, 'Percentage Split (%)', '0.00')}
          {splitType === 'shares' && renderParticipantValues(shareUnits, setShareUnits, 'Relative Shares (e.g. 1, 2)', '1')}

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <Text className="text-xs font-bold text-red-800">{error}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Bottom Action Bar */}
      <View
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 pt-3 flex-row gap-3 shadow-xl"
      >
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="flex-1 py-3.5 rounded-2xl items-center justify-center border border-slate-300 active:bg-slate-100"
        >
          <Text className="text-slate-700 font-bold text-sm">Cancel</Text>
        </Pressable>

        <View className="flex-1">
          <PrimaryButton
            onPress={submit}
            disabled={busy || !description.trim() || !amount || !paidBy}
            loading={busy}
            className="w-full shadow-md"
          >
            Save Expense
          </PrimaryButton>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
