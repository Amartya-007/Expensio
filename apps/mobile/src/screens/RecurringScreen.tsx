import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

type Participant = { id: string; display_name: string };
type Template = { id: string; description: string; amount: number; currency: string; recurrence_rule: string; next_run_date: string };

const RULES = ['weekly', 'monthly', 'yearly'] as const;

export default function RecurringScreen({ tripId, currency, onBack }: { tripId: string; currency: string; onBack: () => void }) {
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
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    setError(null);
    try {
      await callRpc('delete_expense_template', { p_template_id: id }, { idempotent: false });
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} disabled={busy}><Text style={styles.back}>‹ Trip</Text></TouchableOpacity>
      <Text style={styles.heading}>Recurring expenses</Text>
      <Text style={styles.description}>Templates create normal expenses through the same split and ledger rules.</Text>

      <Text style={styles.label}>Description</Text>
      <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Rent" />
      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={styles.label}>Paid by</Text>
      <View style={styles.rowWrap}>
        {participants.map((participant) => (
          <TouchableOpacity key={participant.id} style={[styles.chip, paidBy === participant.id && styles.chipSelected]} onPress={() => setPaidBy(participant.id)}>
            <Text style={[styles.chipText, paidBy === participant.id && styles.chipTextSelected]}>{participant.display_name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Repeats</Text>
      <View style={styles.row}>
        {RULES.map((option) => (
          <TouchableOpacity key={option} style={[styles.chip, rule === option && styles.chipSelected]} onPress={() => setRule(option)}>
            <Text style={[styles.chipText, rule === option && styles.chipTextSelected]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Next run date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={nextRunDate} onChangeText={setNextRunDate} placeholder="2026-09-01" />
      <TouchableOpacity style={styles.primaryButton} onPress={createTemplate} disabled={busy || !description.trim() || !amount || !paidBy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Add recurring expense</Text>}
      </TouchableOpacity>

      <Text style={styles.sectionHeading}>Active templates</Text>
      {templates.map((template) => (
        <View style={styles.templateRow} key={template.id}>
          <View><Text style={styles.templateTitle}>{template.description}</Text><Text style={styles.templateMeta}>{template.currency} {template.amount.toFixed(2)} · {template.recurrence_rule} · next {template.next_run_date}</Text></View>
          <TouchableOpacity onPress={() => deleteTemplate(template.id)}><Text style={styles.deleteText}>Stop</Text></TouchableOpacity>
        </View>
      ))}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: '700' },
  description: { color: '#666', lineHeight: 20, marginTop: 8 },
  label: { color: '#666', fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111' },
  chipTextSelected: { color: '#fff' },
  primaryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  primaryText: { color: '#fff', fontWeight: '600' },
  sectionHeading: { fontSize: 16, fontWeight: '600', marginTop: 28, marginBottom: 8 },
  templateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 12 },
  templateTitle: { color: '#111', fontWeight: '600' },
  templateMeta: { color: '#666', fontSize: 12, marginTop: 3 },
  deleteText: { color: '#b00020', fontWeight: '600' },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
});
