import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';

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
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // paid_by is a participant_id, not a user id (permissions-matrix doc — a participant
    // row is the financial identity, separate from account identity). This minimal
    // version always pays as "you" — adding a picker for placeholders/other members is
    // the natural next screen, not built here.
    let cancelled = false;
    async function resolveMyParticipant() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const rows = await db.getAll<{ id: string }>(
        'SELECT id FROM participants WHERE trip_id = ? AND linked_user_id = ?',
        [tripId, session.user.id]
      );
      if (!cancelled) setMyParticipantId(rows[0]?.id ?? null);
    }
    resolveMyParticipant();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function submit() {
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !parsedAmount || parsedAmount <= 0) return;
    if (!myParticipantId) {
      setError("Couldn't find your participant record for this trip yet — try again in a moment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await callRpc('add_expense', {
        p_trip_id: tripId,
        p_paid_by: myParticipantId,
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

      <Text style={styles.hint}>Split equally among everyone currently in the trip.</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={submit}
          disabled={busy || !description.trim() || !amount}
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
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#666' },
  submitButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600' },
});
