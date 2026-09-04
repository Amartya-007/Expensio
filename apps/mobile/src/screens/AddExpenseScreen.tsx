import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowLeft, Check, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { randomUUID } from '../utils/uuid';
import { formatError } from '../utils/errors';
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
  const n = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return null;
  const [whole, frac = ''] = n.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
function fillValues(rows: Participant[], current: Record<string, string>, fallback: string): Record<string, string> {
  return rows.reduce<Record<string, string>>((acc, p) => { acc[p.id] = current[p.id] ?? fallback; return acc; }, {});
}
function equalPercentages(rows: Participant[]): Record<string, string> {
  if (rows.length === 0) return {};
  const base = Math.floor(10000 / rows.length);
  let rem = 10000 - base * rows.length;
  return rows.reduce<Record<string, string>>((acc, p) => {
    const v = base + (rem > 0 ? 1 : 0); rem -= v > base ? 1 : 0;
    acc[p.id] = (v / 100).toFixed(2); return acc;
  }, {});
}

export default function AddExpenseScreen({
  tripId, currency, onDone, onCancel,
}: { tripId: string; currency: string; onDone: () => void; onCancel: () => void; }) {
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
    const ac = new AbortController();
    db.watch('SELECT id, display_name FROM participants WHERE trip_id = ?', [tripId], {
      onResult: async (r) => {
        const rows = r.rows?._array ?? [];
        setParticipants(rows);
        setExactShares(c => fillValues(rows, c, ''));
        setPercentageShares(c => Object.keys(c).length === 0 ? equalPercentages(rows) : fillValues(rows, c, '0.00'));
        setShareUnits(c => fillValues(rows, c, '1'));
        setAdjustments(c => fillValues(rows, c, ''));
        setRemainderUnits(c => fillValues(rows, c, '1'));
        setItems(c => c.length === 0
          ? [{ id: randomUUID(), label: '', amount: '', sharedBy: rows.map((p: Participant) => p.id) }]
          : c.map(item => ({ ...item, sharedBy: item.sharedBy.filter((id: string) => rows.some((p: Participant) => p.id === id)) }))
        );
        if (paidBy === null && rows.length > 0) {
          const { data: { session } } = await supabase.auth.getSession();
          const mine = await db.getAll<{ id: string }>('SELECT id FROM participants WHERE trip_id = ? AND linked_user_id = ?', [tripId, session?.user.id ?? '']);
          setPaidBy(mine[0]?.id ?? rows[0].id);
        }
      },
    }, { signal: ac.signal });
    return () => ac.abort();
  }, [tripId]);

  useEffect(() => {
    const ac = new AbortController();
    db.watch('SELECT id, name, icon FROM custom_categories WHERE trip_id = ? ORDER BY name', [tripId], { onResult: r => setCategories(r.rows?._array ?? []) }, { signal: ac.signal });
    return () => ac.abort();
  }, [tripId]);

  async function addCategory() {
    const name = newCategory.trim(); if (!name) return; setError(null);
    try {
      await callRpc<string>('add_custom_category', { p_trip_id: tripId, p_name: name, p_icon: 'tag' });
      setCategory(name); setNewCategory(''); setShowAddCat(false);
    } catch (err) { setError(formatError(err)); }
  }

  function updateMap(setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, id: string, val: string) {
    setter(c => ({ ...c, [id]: val }));
  }
  function parseWeights(map: Record<string, string>): Record<string, number> | null {
    const result: Record<string, number> = {};
    for (const p of participants) {
      const n = Number(map[p.id] ?? '0');
      if (!Number.isFinite(n) || n < 0) return null;
      result[p.id] = n;
    }
    return Object.values(result).reduce((s, n) => s + n, 0) > 0 ? result : null;
  }

  function buildSplitConfig(): Record<string, unknown> | null {
    switch (splitType) {
      case 'equal': return {};
      case 'exact': case 'reimbursement': {
        const amounts: Record<string, number> = {};
        for (const p of participants) {
          const m = toMinor(exactShares[p.id] ?? ''); if (m === null || m < 0) return null;
          amounts[p.id] = m;
        }
        return { amounts };
      }
      case 'percentage': { const w = parseWeights(percentageShares); return w ? { weights: w } : null; }
      case 'shares': { const w = parseWeights(shareUnits); return w ? { weights: w } : null; }
      case 'adjustment': {
        const adj: Record<string, number> = {};
        for (const p of participants) {
          const raw = adjustments[p.id] ?? '';
          if (raw.trim() === '') { adj[p.id] = 0; continue; }
          const m = toMinor(raw); if (m === null) return null; adj[p.id] = m;
        }
        if (adjustmentRemainder === 'shares') {
          const w = parseWeights(remainderUnits); if (!w) return null;
          return { adjustments: adj, remainder: 'shares', weights: w };
        }
        return { adjustments: adj, remainder: 'equal' };
      }
      case 'itemized': {
        const parsed = [];
        for (const item of items) {
          const label = item.label.trim(); const am = toMinor(item.amount);
          if (!label || am === null || am <= 0 || item.sharedBy.length === 0) return null;
          parsed.push({ id: item.id, label, amount: am, shared_by: item.sharedBy });
        }
        return { items: parsed, tax: toMinor(tax) ?? 0, tip: toMinor(tip) ?? 0 };
      }
    }
  }

  function validateSplit(amountMinor: number, config: Record<string, unknown>): string | null {
    if (splitType === 'exact') {
      const total = Object.values((config.amounts as Record<string, number>) ?? {}).reduce((s, n) => s + n, 0);
      if (total !== amountMinor) return `Shares sum to ${(total/100).toFixed(2)} but total is ${(amountMinor/100).toFixed(2)} ${currency}.`;
    }
    if (splitType === 'percentage') {
      const total = Object.values((config.weights as Record<string, number>) ?? {}).reduce((s, n) => s + n, 0);
      if (Math.abs(total - 100) > 0.01) return `Percentages must sum to 100% (currently ${total.toFixed(2)}%).`;
    }
    if (splitType === 'itemized') {
      const rawItems = (config.items as Array<{ amount: number }>) ?? [];
      const itemSum = rawItems.reduce((s, i) => s + i.amount, 0);
      const tx = (config.tax as number) ?? 0; const tp = (config.tip as number) ?? 0;
      if (itemSum + tx + tp !== amountMinor) return `Items sum to ${((itemSum+tx+tp)/100).toFixed(2)} but total is ${(amountMinor/100).toFixed(2)} ${currency}.`;
    }
    return null;
  }

  async function submit() {
    setError(null);
    const parsedAmount = Number(amount); const amountMinor = toMinor(amount);
    if (!description.trim()) { setError('Please enter a description.'); return; }
    if (!amountMinor || amountMinor <= 0) { setError('Please enter a valid positive amount.'); return; }
    if (!paidBy) { setError('Select who paid.'); return; }
    const splitConfig = buildSplitConfig();
    if (!splitConfig) { setError('Please fill in valid split values for all participants.'); return; }
    const ve = validateSplit(amountMinor, splitConfig); if (ve) { setError(ve); return; }
    setBusy(true);
    try {
      await callRpc('add_expense', { p_trip_id: tripId, p_description: description.trim(), p_amount: parsedAmount, p_paid_by: paidBy, p_currency: currency, p_category: category || null, p_split_type: splitType, p_split_config: splitConfig });
      onDone();
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(false); }
  }

  function renderParticipantValues(
    map: Record<string, string>,
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    title: string, placeholder: string
  ) {
    return (
      <View style={s.splitDetailCard}>
        <Text style={s.fieldLabel}>{title}</Text>
        {participants.map(p => (
          <View key={p.id} style={s.splitRow}>
            <Text style={s.splitName} numberOfLines={1}>{p.display_name}</Text>
            <TextInput
              style={s.splitInput}
              value={map[p.id] ?? ''}
              onChangeText={v => updateMap(setter, p.id, v)}
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
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 20) + 90,
          paddingHorizontal: 16,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={onCancel} disabled={busy} style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]} hitSlop={8}>
            <ArrowLeft size={18} color="#334155" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <GradientText className="text-2xl font-black tracking-tight">Add Expense</GradientText>
            <Text style={s.headerSub}>Record a new payment or group spend</Text>
          </View>
        </View>

        {/* Description & amount */}
        <View style={s.card}>
          <Text style={s.fieldLabel}>What was it for?</Text>
          <TextInput style={s.input} value={description} onChangeText={setDescription} placeholder="e.g. Dinner, Taxi, Groceries" placeholderTextColor="#94a3b8" autoFocus />

          <View style={s.divider} />

          <Text style={s.fieldLabel}>Amount</Text>
          <View style={s.amountRow}>
            <View style={s.currencyBadge}><Text style={s.currencyBadgeText}>{currency}</Text></View>
            <TextInput style={s.amountInput} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor="#cbd5e1" keyboardType="decimal-pad" />
          </View>
        </View>

        {/* Paid by */}
        <View style={s.card}>
          <Text style={s.fieldLabel}>Who Paid?</Text>
          <View style={s.chipRow}>
            {participants.map(p => {
              const sel = paidBy === p.id;
              return (
                <Pressable key={p.id} onPress={() => setPaidBy(p.id)} style={[s.paidByChip, sel ? s.paidByChipSel : s.paidByChipUnsel]}>
                  {sel && <Check size={13} color="#fff" strokeWidth={3} />}
                  <Text style={[s.paidByText, sel ? s.paidByTextSel : s.paidByTextUnsel]}>{p.display_name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Category */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <Text style={s.fieldLabel}>Category</Text>
            <Pressable onPress={() => setShowAddCat(v => !v)} style={s.newCatBtn}>
              <Plus size={13} color="#2563eb" />
              <Text style={s.newCatText}>New</Text>
            </Pressable>
          </View>

          {showAddCat && (
            <View style={s.newCatRow}>
              <TextInput style={s.newCatInput} value={newCategory} onChangeText={setNewCategory} placeholder="Category name" placeholderTextColor="#94a3b8" />
              <Pressable onPress={addCategory} disabled={!newCategory.trim()} style={[s.newCatSave, !newCategory.trim() && s.newCatSaveDisabled]}>
                <Text style={s.newCatSaveText}>Save</Text>
              </Pressable>
            </View>
          )}

          <View style={s.chipRow}>
            <Pressable onPress={() => setCategory('')} style={[s.catChip, category === '' && s.catChipSel]}>
              <Text style={[s.catChipText, category === '' && s.catChipTextSel]}>None</Text>
            </Pressable>
            {categories.map(c => {
              const sel = category === c.name;
              return (
                <Pressable key={c.id} onPress={() => setCategory(c.name)} style={[s.catChip, sel && s.catChipSel]}>
                  <Text style={[s.catChipText, sel && s.catChipTextSel]}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Split type */}
        <View style={s.card}>
          <Text style={s.fieldLabel}>Split Method</Text>
          <View style={s.chipRow}>
            {SPLIT_TYPES.map(opt => (
              <Chip key={opt.value} selected={splitType === opt.value} label={opt.label} onPress={() => setSplitType(opt.value)} />
            ))}
          </View>
        </View>

        {/* Split details */}
        {splitType === 'equal' && (
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>Equally Shared</Text>
            <Text style={s.infoBody}>Split evenly among all {participants.length} member{participants.length !== 1 ? 's' : ''}.</Text>
          </View>
        )}
        {(splitType === 'exact') && renderParticipantValues(exactShares, setExactShares, 'Exact Amount per Person', '0.00')}
        {splitType === 'reimbursement' && (
          <>
            <View style={s.infoCard}><Text style={s.infoTitle}>Reimbursement</Text><Text style={s.infoBody}>Amounts owed back to the payer.</Text></View>
            {renderParticipantValues(exactShares, setExactShares, 'Amount to Reimburse', '0.00')}
          </>
        )}
        {splitType === 'percentage' && renderParticipantValues(percentageShares, setPercentageShares, 'Percentage Split (%)', '0.00')}
        {splitType === 'shares' && renderParticipantValues(shareUnits, setShareUnits, 'Relative Shares', '1')}

        {!!error && (
          <View style={s.errorBanner}><Text style={s.errorText}>{error}</Text></View>
        )}
      </ScrollView>

      {/* Bottom bar */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={onCancel} disabled={busy} style={({ pressed }) => [s.cancelBtn, pressed && s.cancelBtnPressed]}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton onPress={submit} disabled={busy || !description.trim() || !amount || !paidBy} loading={busy}>
            Save Expense
          </PrimaryButton>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginTop: 2 },

  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', gap: 12, shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  divider: { height: 1, backgroundColor: '#f1f5f9' },

  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  currencyBadge: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  currencyBadgeText: { fontSize: 11, fontWeight: '800', color: '#1d4ed8' },
  amountInput: { flex: 1, fontSize: 24, fontWeight: '800', color: '#0f172a' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paidByChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 1 },
  paidByChipSel: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  paidByChipUnsel: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  paidByText: { fontSize: 13, fontWeight: '700' },
  paidByTextSel: { color: '#fff' },
  paidByTextUnsel: { color: '#334155' },

  newCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  newCatText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  newCatRow: { flexDirection: 'row', gap: 8, backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 8, alignItems: 'center' },
  newCatInput: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a', paddingHorizontal: 4 },
  newCatSave: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  newCatSaveDisabled: { backgroundColor: '#94a3b8' },
  newCatSaveText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  catChipSel: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  catChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  catChipTextSel: { color: '#fff' },

  infoCard: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 16, padding: 14, gap: 4 },
  infoTitle: { fontSize: 13, fontWeight: '800', color: '#1d4ed8' },
  infoBody: { fontSize: 12, fontWeight: '500', color: '#3b82f6' },

  splitDetailCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', gap: 10 },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  splitName: { flex: 1, fontSize: 13, fontWeight: '700', color: '#334155' },
  splitInput: { width: 112, textAlign: 'right', fontSize: 13, fontWeight: '700', color: '#0f172a', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },

  errorBanner: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  errorText: { fontSize: 13, fontWeight: '600', color: '#be123c' },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', gap: 12, shadowColor: '#0f172a', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 8 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  cancelBtnPressed: { backgroundColor: '#e2e8f0' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#334155' },
});
