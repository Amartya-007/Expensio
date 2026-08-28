import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Plus, Receipt, X } from 'lucide-react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import PrimaryButton from '../components/PrimaryButton';
import GradientText from '../components/GradientText';
import Chip from '../components/Chip';

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

// Ported visually from tripspend/src/screens/AddExpense.tsx's chip/card language
// (page-shell/card-elevated/badge-style chips, PrimaryButton, GradientText) --
// see docs/architecture/expensio-ui-port-plan.md. Not a structural port: TripSpend's
// AddExpense screen is built around a different feature set entirely (receipts, tags,
// an AI category suggester, budget presets/favorites, duplicate-expense detection) that
// has no backing RPC or schema column on this side -- porting those fields would mean
// inventing functionality, not styling. What's kept identical to before this pass is
// every field, all client-side validation, and the add_expense RPC call itself -- only
// the JSX changed, not the logic.
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
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
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
              ? [{ id: crypto.randomUUID(), label: '', amount: '', sharedBy: rows.map((row: Participant) => row.id) }]
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
    // paidBy intentionally excluded: this only sets the initial payer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (result.status === 'queued') setError('Category will appear after the connection returns.');
    } catch (err) {
      setError(String(err));
    }
  }

  function updateMap(
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    participantId: string,
    value: string
  ) {
    setter((current) => ({ ...current, [participantId]: value }));
  }

  function renderParticipantValues(
    values: Record<string, string>,
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    label: string,
    placeholder: string,
    keyboardType: 'decimal-pad' | 'number-pad' = 'decimal-pad'
  ) {
    return (
      <View className="card-elevated p-4">
        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{label}</Text>
        <View className="space-y-2">
          {participants.map((participant) => (
            <View className="flex-row items-center gap-3" key={participant.id}>
              <Text className="flex-1 text-sm font-semibold text-slate-700">{participant.display_name}</Text>
              <TextInput
                className="input-field w-28 text-right text-sm text-slate-900"
                value={values[participant.id] ?? ''}
                onChangeText={(value) => updateMap(setter, participant.id, value)}
                placeholder={placeholder}
                placeholderTextColor="#94a3b8"
                keyboardType={keyboardType}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  function buildSplitConfig(): Record<string, unknown> {
    if (splitType === 'exact' || splitType === 'reimbursement') {
      const entries = Object.fromEntries(
        Object.entries(exactShares).filter(([, value]) => value.trim() !== '').map(([id, value]) => [id, value.trim()])
      );
      if (Object.keys(entries).length !== participants.length) {
        throw new Error('Enter an amount for every participant.');
      }
      const totalMinor = toMinor(amount);
      const shareTotal = Object.values(entries).reduce((sum, value) => sum + (toMinor(value) ?? -1), 0);
      if (totalMinor === null || shareTotal !== totalMinor) {
        throw new Error(`The split must add up to ${currency} ${amount}.`);
      }
      return splitType === 'reimbursement' ? { reimburse_to: paidBy, shares: entries } : { shares: entries };
    }

    if (splitType === 'percentage') {
      const values = Object.values(percentageShares).map(Number);
      if (
        values.some((value) => !Number.isFinite(value) || value < 0) ||
        Math.round(values.reduce((a, b) => a + b, 0) * 100) !== 10000
      ) {
        throw new Error('Percentages must be non-negative and add up to 100.00%.');
      }
      return { shares: Object.fromEntries(Object.entries(percentageShares).map(([id, value]) => [id, Number(value)])) };
    }

    if (splitType === 'shares') {
      if (Object.values(shareUnits).some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) {
        throw new Error('Every participant needs a positive share unit.');
      }
      return { units: Object.fromEntries(Object.entries(shareUnits).map(([id, value]) => [id, Number(value)])) };
    }

    if (splitType === 'adjustment') {
      const adjustmentEntries = Object.fromEntries(
        Object.entries(adjustments).filter(([, value]) => value.trim() !== '').map(([id, value]) => [id, value.trim()])
      );
      const totalMinor = toMinor(amount);
      const adjustmentTotal = Object.values(adjustmentEntries).reduce((sum, value) => sum + (toMinor(value) ?? 0), 0);
      if (totalMinor === null || adjustmentTotal > totalMinor) {
        throw new Error('Adjustments cannot be greater than the expense total.');
      }
      return {
        adjustments: adjustmentEntries,
        remainder: adjustmentRemainder,
        ...(adjustmentRemainder === 'shares'
          ? { units: Object.fromEntries(Object.entries(remainderUnits).map(([id, value]) => [id, Number(value)])) }
          : {}),
      };
    }

    if (splitType === 'itemized') {
      if (items.some((item) => !item.label.trim() || toMinor(item.amount) === null || item.sharedBy.length === 0)) {
        throw new Error('Each item needs a label, amount, and at least one participant.');
      }
      const totalMinor = toMinor(amount);
      const itemTotal = items.reduce((sum, item) => sum + (toMinor(item.amount) ?? 0), 0);
      const taxMinor = toMinor(tax);
      const tipMinor = toMinor(tip);
      if (totalMinor === null || taxMinor === null || tipMinor === null || itemTotal + taxMinor + tipMinor !== totalMinor) {
        throw new Error('Items, tax, and tip must add up to the expense total.');
      }
      return {
        items: items.map((item) => ({ label: item.label.trim(), amount: item.amount.trim(), shared_by: item.sharedBy })),
        tax: tax.trim() || '0.00',
        tip: tip.trim() || '0.00',
        // Tax and tip are distributed proportionally to each participant's item subtotal
        // (architecture doc data model §split_config shapes). The UI doesn't yet expose a
        // toggle for 'equal', so we always send 'proportional' to match the displayed intent.
        tax_tip_split: 'proportional',
      };
    }

    return {};
  }

  async function submit() {
    if (!description.trim() || !paidBy || toMinor(amount) === null || toMinor(amount) === 0) return;
    setBusy(true);
    setError(null);
    try {
      const splitConfig = buildSplitConfig();
      await callRpc('add_expense', {
        p_trip_id: tripId,
        p_paid_by: paidBy,
        p_description: description.trim(),
        p_amount: Number(amount),
        p_currency: currency,
        p_category: category || null,
        p_split_type: splitType,
        p_split_config: splitConfig,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function addItem() {
    setItems((current) => [...current, { id: crypto.randomUUID(), label: '', amount: '', sharedBy: participants.map((p) => p.id) }]);
  }

  function updateItem(itemId: string, update: Partial<Item>) {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...update } : item)));
  }

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="page-shell space-y-5" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center gap-3 page-header">
        <Pressable onPress={onCancel} disabled={busy} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
          <ArrowLeft size={20} color="#64748b" />
        </Pressable>
        <GradientText className="page-title">Add expense</GradientText>
      </View>

      <View className="space-y-4">
        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What was it for?</Text>
          <TextInput
            className="input-field text-base text-slate-900"
            value={description}
            onChangeText={setDescription}
            placeholder="Taxi"
            placeholderTextColor="#94a3b8"
            autoFocus
          />
        </View>

        <View>
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Amount ({currency})</Text>
          <TextInput
            className="input-field text-2xl font-black text-slate-900"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="#cbd5e1"
            keyboardType="decimal-pad"
          />
        </View>
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
        <View className="flex-row items-center gap-1 mb-2">
          <Receipt size={12} color="#94a3b8" />
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">Category</Text>
        </View>
        <View className="flex-row flex-wrap gap-2 mb-2">
          <Chip selected={category === ''} label="None" onPress={() => setCategory('')} />
          {categories.map((entry) => (
            <Chip key={entry.id} selected={category === entry.name} label={entry.name} onPress={() => setCategory(entry.name)} />
          ))}
        </View>
        <View className="flex-row gap-2">
          <TextInput
            className="input-field flex-1 text-sm text-slate-900"
            value={newCategory}
            onChangeText={setNewCategory}
            placeholder="New category"
            placeholderTextColor="#94a3b8"
          />
          <Pressable onPress={addCategory} disabled={!newCategory.trim()} className="px-4 rounded-2xl bg-slate-900 items-center justify-center">
            <Plus size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View>
        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Split type</Text>
        <View className="flex-row flex-wrap gap-2">
          {SPLIT_TYPES.map((option) => (
            <Chip key={option.value} selected={splitType === option.value} label={option.label} onPress={() => setSplitType(option.value)} />
          ))}
        </View>
      </View>

      {splitType === 'equal' && (
        <View className="card-elevated p-4">
          <Text className="text-sm text-slate-500">Split equally among everyone currently in the trip.</Text>
        </View>
      )}
      {splitType === 'exact' && renderParticipantValues(exactShares, setExactShares, 'Amount owed by each person', '0.00')}
      {splitType === 'reimbursement' && (
        <>
          <View className="card-elevated p-4">
            <Text className="text-sm text-slate-500">Each amount is owed back to the selected payer.</Text>
          </View>
          {renderParticipantValues(exactShares, setExactShares, 'Amount to reimburse', '0.00')}
        </>
      )}
      {splitType === 'percentage' && renderParticipantValues(percentageShares, setPercentageShares, 'Percentage of the total', '0.00')}
      {splitType === 'shares' && renderParticipantValues(shareUnits, setShareUnits, 'Relative units', '1')}
      {splitType === 'adjustment' && (
        <>
          {renderParticipantValues(adjustments, setAdjustments, 'Fixed adjustment (+ amount)', '0.00')}
          <View>
            <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Split the remainder</Text>
            <View className="flex-row gap-2">
              {(['equal', 'shares'] as const).map((mode) => (
                <Chip key={mode} selected={adjustmentRemainder === mode} label={mode} onPress={() => setAdjustmentRemainder(mode)} />
              ))}
            </View>
          </View>
          {adjustmentRemainder === 'shares' && renderParticipantValues(remainderUnits, setRemainderUnits, 'Remainder units', '1')}
        </>
      )}
      {splitType === 'itemized' && (
        <View className="space-y-3">
          {items.map((item) => (
            <View className="card-elevated p-4 space-y-3" key={item.id}>
              <TextInput
                className="input-field text-sm text-slate-900"
                value={item.label}
                onChangeText={(value) => updateItem(item.id, { label: value })}
                placeholder="Item name"
                placeholderTextColor="#94a3b8"
              />
              <TextInput
                className="input-field text-sm text-slate-900"
                value={item.amount}
                onChangeText={(value) => updateItem(item.id, { amount: value })}
                placeholder="Item amount"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
              <View>
                <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Shared by</Text>
                <View className="flex-row flex-wrap gap-2">
                  {participants.map((participant) => {
                    const selected = item.sharedBy.includes(participant.id);
                    return (
                      <Chip
                        key={participant.id}
                        selected={selected}
                        label={participant.display_name}
                        onPress={() =>
                          updateItem(item.id, {
                            sharedBy: selected ? item.sharedBy.filter((id) => id !== participant.id) : [...item.sharedBy, participant.id],
                          })
                        }
                      />
                    );
                  })}
                </View>
              </View>
              <Pressable
                onPress={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                className="flex-row items-center gap-1 self-start"
              >
                <X size={12} color="#e11d48" />
                <Text className="text-xs font-semibold text-rose-600">Remove item</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addItem} className="btn-secondary flex-row items-center justify-center gap-2">
            <Plus size={16} color="#475569" />
            <Text className="text-slate-600 font-bold text-sm">Add item</Text>
          </Pressable>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tax</Text>
              <TextInput className="input-field text-sm text-slate-900" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tip</Text>
              <TextInput className="input-field text-sm text-slate-900" value={tip} onChangeText={setTip} keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      )}

      {error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Text className="text-sm text-red-700 font-medium">{error}</Text>
        </View>
      )}

      <View className="flex-row gap-3 pt-2">
        <Pressable onPress={onCancel} disabled={busy} className="flex-1 py-3.5 rounded-2xl items-center justify-center active:bg-slate-100">
          <Text className="text-slate-600 font-semibold text-sm">Cancel</Text>
        </Pressable>
        <View className="flex-1">
          <PrimaryButton onPress={submit} disabled={busy || !description.trim() || !amount || !paidBy} loading={busy} className="w-full">
            Add
          </PrimaryButton>
        </View>
      </View>
    </ScrollView>
  );
}
