import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './src/supabaseClient';
import { db, connectPowerSync } from './src/powersync/db';

type SpikeItem = { id: string; note: string; created_at: string };

// This screen exists to answer exactly one question: does a row written on
// this device show up in Postgres, and does a row written elsewhere show up
// here — including after killing the app and going offline? Nothing about
// Expensio's real UI belongs here yet; see
// docs/architecture/expensio-react-native-setup.md for what "pass" means.
export default function App() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<SpikeItem[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('starting…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // Anonymous sign-in by default, per architecture doc §3 — every
        // user (including a guest) gets a real auth.uid() the moment the
        // app opens, which is what both RLS and PowerSync's auth need.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setStatus('signing in…');
          const { error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
        }

        setStatus('connecting PowerSync…');
        await connectPowerSync();
        if (cancelled) return;
        setReady(true);
        setStatus('connected');
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    // Live query — fires immediately with whatever's already in local
    // SQLite, then again every time a sync (or a local write) changes the
    // result set. This is the actual thing being proven: no manual refresh,
    // no polling.
    const abortController = new AbortController();
    db.watch(
      'SELECT id, note, created_at FROM spike_items ORDER BY created_at DESC LIMIT 50',
      [],
      {
        onResult: (result) => setItems(result.rows?._array ?? []),
        onError: (err) => setError(String(err)),
      },
      { signal: abortController.signal }
    );

    return () => abortController.abort();
  }, [ready]);

  async function addItem() {
    if (!note.trim()) return;
    // Writes to local SQLite immediately (shows up in the list instantly,
    // offline or not) and queues for upload — SupabaseConnector.uploadData
    // pushes it to Postgres as soon as there's connectivity.
    await db.execute('INSERT INTO spike_items (id, note, created_at) VALUES (?, ?, ?)', [
      crypto.randomUUID(),
      note.trim(),
      new Date().toISOString(),
    ]);
    setNote('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="auto" />
      <Text style={styles.heading}>Expensio — PowerSync spike</Text>
      <Text style={styles.status}>Status: {status}</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.row}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Type something, then check another device"
          style={styles.input}
          onSubmitEditing={addItem}
        />
        <TouchableOpacity style={[styles.button, !ready && styles.buttonDisabled]} onPress={addItem} disabled={!ready}>
          <Text style={styles.buttonText}>Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={ready ? <Text style={styles.empty}>No items yet.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text>{item.note}</Text>
            <Text style={styles.timestamp}>{item.created_at}</Text>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  heading: { fontSize: 20, fontWeight: '600' },
  status: { color: '#666', fontSize: 13, marginTop: 4 },
  error: { color: '#b00020', fontSize: 13, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  button: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  list: { flex: 1 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  timestamp: { fontSize: 11, color: '#999', marginTop: 2 },
  empty: { color: '#999', marginTop: 20, textAlign: 'center' },
});
