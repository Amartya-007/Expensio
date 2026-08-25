import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle2, HandCoins } from 'lucide-react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { env } from '../env';
import GradientText from '../components/GradientText';

type Suggestion = {
  from_participant: string;
  to_participant: string;
  amount: string;
  currency: string;
};

// Restyled visually to match this port's design language -- TripSpend's own
// Settlement.tsx isn't a usable reference here at all (it's 60KB, built entirely around
// the personal daily-budget concept documented as a schema gap in
// docs/architecture/expensio-ui-port-plan.md), so this follows the established
// page-shell/card-elevated/badge patterns from the other ported screens instead of
// porting any specific TripSpend screen.
//
// Also newly wired in this pass, closing the "currently read-only" gap noted in the plan
// doc: a "Record payment" action per suggestion, calling record_payment (now fixed --
// see TASKS.md) -- but only for suggestions where the current user IS the payer
// (from_participant), since record_payment infers the payer from the caller's own
// session, not a parameter. After a successful record, the whole settlement plan is
// re-fetched rather than just marking that one row done client-side: paying off one debt
// can change what the debt-simplification algorithm suggests for everyone else, not just
// remove a single row.
//
// Deliberately NOT built this pass: the recipient's side (confirming a payment via
// confirm_payment). That needs a list of not-yet-confirmed payments where the current
// user is the recipient, which requires reading ledger_entries directly -- it has no
// PowerSync sync stream (see sync-streams.yaml; the table's in the Postgres publication
// but nothing requests it, so it never reaches the client's local database), so this
// would need a direct Supabase query, not db.watch. Left as an explicitly separate
// follow-up rather than half-building it here.
export default function SettlementScreen({ tripId, onBack }: { tripId: string; onBack: () => void }) {
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
    <ScrollView className="flex-1 bg-white" contentContainerClassName="page-shell space-y-4">
      <View className="flex-row items-center gap-3 page-header">
        <Pressable onPress={onBack} className="p-2 -ml-1 rounded-xl active:bg-slate-100">
          <ArrowLeft size={20} color="#64748b" />
        </Pressable>
        <View>
          <GradientText className="page-title">Settle up</GradientText>
          <Text className="page-subtitle">Suggestions based on the trip ledger</Text>
        </View>
      </View>

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
    </ScrollView>
  );
}
