import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

type Expense = {
  id: string;
  description: string;
  amount: number;
  currency: string;
  paid_by: string;
  created_at: string;
};
type Participant = { id: string; display_name: string };
type Split = { participant_id: string; share_amount: number };

export default function ExpenseDetailScreen({ expenseId, onBack }: { expenseId: string; onBack: () => void }) {
  const [expense, setExpense] = useState<Expense | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT id, description, amount, currency, paid_by, created_at FROM expenses WHERE id = ? AND deleted_at IS NULL',
      [expenseId],
      {
        onResult: (result) => {
          const row = result.rows?._array?.[0] ?? null;
          setExpense(row);
          // Only seed the edit fields the first time this loads, not on every live
          // update -- otherwise typing in the edit form would get overwritten by the
          // still-live watch query firing again mid-edit.
          if (row && description === '' && amount === '') {
            setDescription(row.description);
            setAmount(String(row.amount));
          }
        },
      },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseId]);

  useEffect(() => {
    if (!expense) return;
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name FROM participants WHERE trip_id = (SELECT trip_id FROM expenses WHERE id = ?)',
      [expenseId],
      { onResult: (result) => setParticipants(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [expenseId, expense]);

  useEffect(() => {
    const abortController = new AbortController();
    db.watch(
      'SELECT participant_id, share_amount FROM expense_splits WHERE expense_id = ?',
      [expenseId],
      { onResult: (result) => setSplits(result.rows?._array ?? []) },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, [expenseId]);

  const nameFor = (participantId: string) =>
    participants.find((p) => p.id === participantId)?.display_name ?? '…';

  async function saveEdit() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !parsedAmount || parsedAmount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      // split_type/split_config stay 'equal'/{} — this app only offers equal splits so
      // far (AddExpenseScreen), so an edit just re-runs the same equal split against the
      // new amount. edit_expense calls compute_expense_splits itself, same as add_expense.
      await callRpc('edit_expense', {
        p_expense_id: expenseId,
        p_description: description.trim(),
        p_amount: parsedAmount,
        p_split_type: 'equal',
        p_split_config: {},
      });
      setEditing(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this expense?', 'This removes it from the trip. It stays in the activity log either way.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await callRpc('delete_expense', { p_expense_id: expenseId });
            onBack();
          } catch (err) {
            setError(String(err));
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (!expense) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.empty}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>

      {editing ? (
        <>
          <Text style={styles.heading}>Edit expense</Text>
          <Text style={styles.label}>What was it for?</Text>
          <TextInput style={styles.input} value={description} onChangeText={setDescription} />
          <Text style={styles.label}>Amount ({expense.currency})</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(false)} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitButton} onPress={saveEdit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.heading}>{expense.description}</Text>
          <Text style={styles.amount}>
            {expense.currency} {expense.amount.toFixed(2)}
          </Text>
          <Text style={styles.paidBy}>Paid by {nameFor(expense.paid_by)}</Text>

          <Text style={styles.sectionLabel}>Split</Text>
          {splits.map((s) => (
            <Text key={s.participant_id} style={styles.splitLine}>
              {nameFor(s.participant_id)} owes {expense.currency} {s.share_amount.toFixed(2)}
            </Text>
          ))}

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(true)} disabled={busy}>
              <Text style={styles.cancelText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} disabled={busy}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700' },
  amount: { fontSize: 18, color: '#111', marginTop: 8 },
  paidBy: { fontSize: 13, color: '#666', marginTop: 4 },
  sectionLabel: { fontSize: 13, color: '#666', marginTop: 24, marginBottom: 8, fontWeight: '600' },
  splitLine: { fontSize: 14, color: '#111', paddingVertical: 4 },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
  empty: { color: '#999', marginTop: 40, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#666' },
  submitButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600' },
  deleteButton: { flex: 1, backgroundColor: '#b00020', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  deleteText: { color: '#fff', fontWeight: '600' },
});
