import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

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
      <View>
        <Text style={styles.subLabel}>{label}</Text>
        {participants.map((participant) => (
          <View style={styles.valueRow} key={participant.id}>
            <Text style={styles.valueName}>{participant.display_name}</Text>
            <TextInput
              style={styles.valueInput}
              value={values[participant.id] ?? ''}
              onChangeText={(value) => updateMap(setter, participant.id, value)}
              placeholder={placeholder}
              keyboardType={keyboardType}
            />
          </View>
        ))}
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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Add expense</Text>

      <Text style={styles.label}>What was it for?</Text>
      <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Taxi" autoFocus />

      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />

      <Text style={styles.label}>Paid by</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {participants.map((participant) => (
            <TouchableOpacity key={participant.id} style={[styles.chip, paidBy === participant.id && styles.chipSelected]} onPress={() => setPaidBy(participant.id)}>
              <Text style={[styles.chipText, paidBy === participant.id && styles.chipTextSelected]}>{participant.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.chip, category === '' && styles.chipSelected]} onPress={() => setCategory('')}>
            <Text style={[styles.chipText, category === '' && styles.chipTextSelected]}>None</Text>
          </TouchableOpacity>
          {categories.map((entry) => (
            <TouchableOpacity key={entry.id} style={[styles.chip, category === entry.name && styles.chipSelected]} onPress={() => setCategory(entry.name)}>
              <Text style={[styles.chipText, category === entry.name && styles.chipTextSelected]}>{entry.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={styles.categoryRow}>
        <TextInput style={styles.categoryInput} value={newCategory} onChangeText={setNewCategory} placeholder="New category" />
        <TouchableOpacity style={styles.categoryButton} onPress={addCategory} disabled={!newCategory.trim()}>
          <Text style={styles.categoryButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Split type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {SPLIT_TYPES.map((option) => (
            <TouchableOpacity key={option.value} style={[styles.chip, splitType === option.value && styles.chipSelected]} onPress={() => setSplitType(option.value)}>
              <Text style={[styles.chipText, splitType === option.value && styles.chipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {splitType === 'equal' && <Text style={styles.hint}>Split equally among everyone currently in the trip.</Text>}
      {splitType === 'exact' && renderParticipantValues(exactShares, setExactShares, 'Amount owed by each person', '0.00')}
      {splitType === 'reimbursement' && (
        <>
          <Text style={styles.hint}>Each amount is owed back to the selected payer.</Text>
          {renderParticipantValues(exactShares, setExactShares, 'Amount to reimburse', '0.00')}
        </>
      )}
      {splitType === 'percentage' && renderParticipantValues(percentageShares, setPercentageShares, 'Percentage of the total', '0.00')}
      {splitType === 'shares' && renderParticipantValues(shareUnits, setShareUnits, 'Relative units', '1')}
      {splitType === 'adjustment' && (
        <>
          {renderParticipantValues(adjustments, setAdjustments, 'Fixed adjustment (+ amount)', '0.00')}
          <Text style={styles.subLabel}>Split the remainder</Text>
          <View style={styles.row}>
            {(['equal', 'shares'] as const).map((mode) => (
              <TouchableOpacity key={mode} style={[styles.chip, adjustmentRemainder === mode && styles.chipSelected]} onPress={() => setAdjustmentRemainder(mode)}>
                <Text style={[styles.chipText, adjustmentRemainder === mode && styles.chipTextSelected]}>{mode}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {adjustmentRemainder === 'shares' && renderParticipantValues(remainderUnits, setRemainderUnits, 'Remainder units', '1')}
        </>
      )}
      {splitType === 'itemized' && (
        <>
          {items.map((item) => (
            <View style={styles.itemCard} key={item.id}>
              <TextInput style={styles.input} value={item.label} onChangeText={(value) => updateItem(item.id, { label: value })} placeholder="Item name" />
              <TextInput style={styles.input} value={item.amount} onChangeText={(value) => updateItem(item.id, { amount: value })} placeholder="Item amount" keyboardType="decimal-pad" />
              <Text style={styles.subLabel}>Shared by</Text>
              <View style={styles.rowWrap}>
                {participants.map((participant) => {
                  const selected = item.sharedBy.includes(participant.id);
                  return (
                    <TouchableOpacity
                      key={participant.id}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => updateItem(item.id, { sharedBy: selected ? item.sharedBy.filter((id) => id !== participant.id) : [...item.sharedBy, participant.id] })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{participant.display_name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity onPress={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>
                <Text style={styles.removeText}>Remove item</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.secondaryButton} onPress={addItem}><Text style={styles.secondaryText}>+ Add item</Text></TouchableOpacity>
          <View style={styles.rowInputs}>
            <View style={styles.half}><Text style={styles.subLabel}>Tax</Text><TextInput style={styles.input} value={tax} onChangeText={setTax} keyboardType="decimal-pad" /></View>
            <View style={styles.half}><Text style={styles.subLabel}>Tip</Text><TextInput style={styles.input} value={tip} onChangeText={setTip} keyboardType="decimal-pad" /></View>
          </View>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={busy || !description.trim() || !amount || !paidBy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Add</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#fff' },
  container: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 16 },
  subLabel: { fontSize: 12, color: '#666', marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 8 },
  hint: { fontSize: 12, color: '#999', marginTop: 16 },
  row: { flexDirection: 'row', gap: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowInputs: { flexDirection: 'row', gap: 10 },
  categoryRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  categoryInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  categoryButton: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  categoryButtonText: { color: '#fff', fontWeight: '600' },
  half: { flex: 1 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111' },
  chipTextSelected: { color: '#fff' },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  valueName: { flex: 1, color: '#111' },
  valueInput: { width: 110, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'right' },
  itemCard: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 12, marginTop: 10 },
  secondaryButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: '#111', fontWeight: '600' },
  removeText: { color: '#b00020', fontSize: 12, marginTop: 12 },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#666' },
  submitButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600' },
});
