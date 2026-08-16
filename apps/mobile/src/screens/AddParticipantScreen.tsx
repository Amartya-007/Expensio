import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { callRpc } from '../rpc';

// Placeholder participants are how Expensio handles someone who doesn't have (or doesn't
// want) the app -- see permissions-matrix.md: a placeholder has no auth.uid(), so any
// active trip member manages expenses on their behalf. This is the ONLY way to add another
// person to a trip right now -- real invites (generate_invite/join_trip_via_code) need
// is_verified_user(), which nothing in this client satisfies yet (anonymous sign-in only).
export default function AddParticipantScreen({
  tripId,
  onDone,
  onCancel,
}: {
  tripId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await callRpc('add_placeholder_participant', {
        p_trip_id: tripId,
        p_display_name: name.trim(),
        p_phone: phone.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Add a person</Text>
      <Text style={styles.hint}>
        For splitting expenses with someone who isn't using the app. Give them a phone
        number now and if they ever join for real with that same number, this gets linked
        to their account automatically.
      </Text>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Rahul" autoFocus />

      <Text style={styles.label}>Phone (optional)</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="+91…"
        keyboardType="phone-pad"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={busy || !name.trim()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Add</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  hint: { fontSize: 13, color: '#999', marginBottom: 8, lineHeight: 18 },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { color: '#b00020', fontSize: 13, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#666' },
  submitButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '600' },
});
