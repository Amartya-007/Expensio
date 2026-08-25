import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { CheckCircle2, HandCoins } from 'lucide-react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { env } from '../env';

type Suggestion = {
  from_participant: string;
  to_participant: string;
  amount: string;
  currency: string;
};

// Content-only piece of the settlement UI -- no header, no page-shell padding, so it can
// sit inside a page that already has its own (TripDetailScreen's Settle tab) as well as
// stand alone (SettlementScreen.tsx). Extracted rather than duplicated once it needed a
// second home; see TripDetailScreen.tsx's header comment for why Settle became a real
// local tab instead of navigating away.
//
// Wires in record_payment (payer side): a "Record payment" action per suggestion, only
// for suggestions where the current user IS the payer (from_participant), since the RPC
// infers the payer from the caller's own session, not a parameter. After a successful
// record, the whole settlement plan is re-fetched rather than just marking that one row
// done client-side -- paying off one debt can change what the debt-simplification
// algorithm suggests for everyone else, not just remove a single row.
//
// Deliberately NOT built: the recipient's side (confirm_payment). That needs a list of
// not-yet-confirmed payments where the current user is the recipient, which requires
// reading ledger_entries directly -- it has no PowerSync sync stream (see
// sync-streams.yaml: the table's in the Postgres publication but nothing requests it, so
// it never reaches the client's local database), so this needs a direct Supabase query,
// not db.watch. Scoped as its own explicit follow-up.
export default function SettlementView({ tripId }: { tripId: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!env.apiUrl) {
      setError('Settlement service is not configured. Add EXPO_PUBLIC_API_URL to .env.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data: sessionData }, participantRows] = await Promise.all([
        supabase.auth.getSession(),
        db.getAll<{ id: string; display_name: string; linked_user_id: string | null }>(
          'SELECT id, display_name, linked_user_id FROM participants WHERE trip_id = ?',
          [tripId]
        ),
      ]);
      if (!sessionData.session) throw new Error('Your session has expired. Sign in again.');
      const response = await fetch(`${env.apiUrl.replace(/\/$/, '')}/trip/${tripId}/settlement-plan`, {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (!response.ok) throw new Error((await response.json()).detail ?? 'Could not load settlement suggestions.');
      const data = (await response.json()) as { suggestions: Suggestion[] };
      setSuggestions(data.suggestions);
      setNames(Object.fromEntries(participantRows.map((row) => [row.id, row.display_name])));
      setMyParticipantId(participantRows.find((row) => row.linked_user_id === sessionData.session!.user.id)?.id ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function recordPayment(suggestion: Suggestion, key: string) {
    setRecordingKey(key);
    setError(null);
    try {
      await callRpc('record_payment', {
        p_trip_id: tripId,
        p_to_participant: suggestion.to_participant,
        p_amount: Number(suggestion.amount),
        p_currency: suggestion.currency,
      });
      await load();
    } catch (err) {
      setError(String(err));
      setRecordingKey(null);
    }
  }

  return (
    <View className="space-y-4">
      {loading && <ActivityIndicator className="mt-10" color="#2563eb" />}

      {!!error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Text className="text-sm text-red-700 font-medium">{error}</Text>
        </View>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <View className="card-elevated p-8 items-center mt-6">
          <View className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 items-center justify-center mb-3">
            <CheckCircle2 size={22} color="#059669" />
          </View>
          <Text className="text-sm font-semibold text-slate-600">Everyone is settled up.</Text>
        </View>
      )}

      {!loading &&
        suggestions.map((suggestion, index) => {
          const key = `${suggestion.from_participant}-${suggestion.to_participant}-${suggestion.currency}-${index}`;
          const canRecord = myParticipantId !== null && suggestion.from_participant === myParticipantId;
          return (
            <View className="card-elevated p-4 flex-row items-center gap-3" key={key}>
              <View className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 items-center justify-center">
                <HandCoins size={18} color="#d97706" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-slate-700">
                  {names[suggestion.from_participant] ?? suggestion.from_participant} pays{' '}
                  {names[suggestion.to_participant] ?? suggestion.to_participant}
                </Text>
                <Text className="text-lg font-black text-slate-900 mt-0.5">
                  {suggestion.currency} {suggestion.amount}
                </Text>
              </View>
              {canRecord && (
                <Pressable
                  onPress={() => recordPayment(suggestion, key)}
                  disabled={recordingKey === key}
                  className="px-3 py-2 rounded-xl bg-blue-600 items-center justify-center"
                >
                  {recordingKey === key ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-xs font-bold text-white">I paid this</Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
    </View>
  );
}
