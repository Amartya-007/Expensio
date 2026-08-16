import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

type Participant = { id: string; display_name: string };

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
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // paid_by is a participant_id, not a user id (permissions-matrix doc — a participant
    // row is the financial identity, separate from account identity) — so this is anyone
    // currently in the trip, including a placeholder with no account of their own. Default
    // to "you" once participants load, since that's the common case; anyone can change it.
    const abortController = new AbortController();
    db.watch(
      'SELECT id, display_name FROM participants WHERE trip_id = ?',
      [tripId],
      {
        onResult: async (result) => {
          const rows = result.rows?._array ?? [];
          setParticipants(rows);
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
    // paidBy intentionally excluded — this effect sets an initial default once, it
    // shouldn't re-run and clobber a choice the user already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function submit() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !parsedAmount || parsedAmount <= 0 || !paidBy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callRpc('add_expense', {
        p_trip_id: tripId,
        p_paid_by: paidBy,
        p_description: description.trim(),
        p_amount: parsedAmount,
        p_currency: currency,
        p_split_type: 'equal',
        p_split_config: {},
      });
      // Whether it ran immediately or got queued for later (see rpc.ts), there's nothing
      // more to do here — either way the list this screen returns to will update itself
      // once the data's actually there (immediately if 'ok'; once synced back down, if
      // queued). No separate "success" branch needed.
      void result;
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Add expense</Text>

      <Text style={styles.label}>What was it for?</Text>
      <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Taxi" autoFocus />

      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Paid by</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {participants.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.chip, paidBy === p.id && styles.chipSelected]}
              onPress={() => setPaidBy(p.id)}
            >
              <Text style={[styles.chipText, paidBy === p.id && styles.chipTextSelected]}>{p.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.hint}>Split equally among everyone currently in the trip.</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={submit}
          disabled={busy || !description.trim() || !amount || !paidBy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Add</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  hint: { fontSize: 12, color: '#999', marginTop: 16 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111' },
  chipTextSelected: { color: '#fff' },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#666' },
  submitButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600' },
});
