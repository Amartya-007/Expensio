import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../supabaseClient';
import { env } from '../env';

type Suggestion = {
  from_participant: string;
  to_participant: string;
  amount: string;
  currency: string;
};

export default function SettlementScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!env.apiUrl) {
        setError('Settlement service is not configured. Add EXPO_PUBLIC_API_URL to .env.');
        setLoading(false);
        return;
      }
      try {
        const [{ data: sessionData }, participantRows] = await Promise.all([
          supabase.auth.getSession(),
          import('../powersync/db').then(({ db }) => db.getAll<{ id: string; display_name: string }>(
            'SELECT id, display_name FROM participants WHERE trip_id = ?',
            [tripId]
          )),
        ]);
        if (!sessionData.session) throw new Error('Your session has expired. Sign in again.');
        const response = await fetch(`${env.apiUrl.replace(/\/$/, '')}/trip/${tripId}/settlement-plan`, {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        });
        if (!response.ok) throw new Error((await response.json()).detail ?? 'Could not load settlement suggestions.');
        const data = (await response.json()) as { suggestions: Suggestion[] };
        if (!cancelled) {
          setSuggestions(data.suggestions);
          setNames(Object.fromEntries(participantRows.map((row) => [row.id, row.display_name])));
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>‹ Trip</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>Settle up</Text>
      <Text style={styles.description}>Read-only suggestions based on the trip ledger.</Text>
      {loading && <ActivityIndicator style={styles.spinner} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && suggestions.length === 0 && <Text style={styles.empty}>Everyone is settled up.</Text>}
      {suggestions.map((suggestion, index) => (
        <View style={styles.card} key={`${suggestion.from_participant}-${suggestion.to_participant}-${suggestion.currency}-${index}`}>
          <Text style={styles.payment}>
            {names[suggestion.from_participant] ?? suggestion.from_participant} pays {names[suggestion.to_participant] ?? suggestion.to_participant}
          </Text>
          <Text style={styles.amount}>{suggestion.currency} {suggestion.amount}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 20 },
  back: { color: '#666', fontSize: 15, marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: '700' },
  description: { color: '#666', marginTop: 8, marginBottom: 20 },
  spinner: { marginTop: 32 },
  error: { color: '#b00020', marginTop: 24 },
  empty: { color: '#666', textAlign: 'center', marginTop: 48 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 16, marginTop: 12 },
  payment: { color: '#111', fontSize: 15 },
  amount: { color: '#111', fontSize: 20, fontWeight: '700', marginTop: 6 },
});
