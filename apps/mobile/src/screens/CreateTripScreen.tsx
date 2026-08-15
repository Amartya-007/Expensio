import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { callRpc } from '../rpc';

const CURRENCIES = ['INR', 'USD', 'EUR'];

export default function CreateTripScreen({
  onCreated,
  onCancel,
}: {
  onCreated: (tripId: string | null, currency: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callRpc<string>('create_trip', { p_name: name.trim(), p_currency: currency });
      if (result.status === 'ok') {
        onCreated(result.data, currency);
      } else {
        // Queued for later — there's no local trip row to open yet (it doesn't exist
        // locally until the RPC actually runs and syncs back down), so go back to the
        // list instead of trying to navigate into it.
        onCreated(null, currency);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>New trip</Text>

      <Text style={styles.label}>Trip name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Goa Trip" autoFocus />

      <Text style={styles.label}>Currency</Text>
      <View style={styles.row}>
        {CURRENCIES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, currency === c && styles.chipSelected]}
            onPress={() => setCurrency(c)}
          >
            <Text style={[styles.chipText, currency === c && styles.chipTextSelected]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={busy || !name.trim()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create</Text>}
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
