import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { CheckCircle2, HandCoins, ThumbsUp } from 'lucide-react-native';
import { supabase } from '../supabaseClient';
import { db } from '../powersync/db';
import { callRpc } from '../rpc';
import { formatError } from '../utils/errors';
import { env } from '../env';

type Suggestion = {
  from_participant: string;
  to_participant: string;
  amount: string;
  currency: string;
};

// A pending payment: a ledger_entries row with entry_type='payment_recorded' that has
// no matching 'payment_confirmed' row yet, and where the current user is the recipient.
// ledger_entries is not in the PowerSync sync stream so this must be a direct Supabase
// query, not db.watch — see sync-streams.yaml and AppSchema.ts comments.
type PendingReceipt = {
  id: string;
  from_participant: string;
  amount: string;
  currency: string;
};

// Content-only piece of the settlement UI -- no header, no page-shell padding, so it can
// sit inside a page that already has its own (TripDetailScreen's Settle tab).
//
// Wires in record_payment (payer side): "I paid this" per suggestion, only shown to the
// current user when they are the from_participant. Re-fetches the full plan after a
// successful record since paying one debt can reshape the suggestions for everyone.
//
// Wires in confirm_payment (recipient side): a "Confirm received" list is shown below
// the suggestions for unconfirmed payments where the current user is the to_participant.
// This requires a direct Supabase query against ledger_entries (not PowerSync) because
// that table has no sync stream — confirmed in AppSchema.ts and sync-streams.yaml.
export default function SettlementView({ tripId }: { tripId: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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

      const nameMap = Object.fromEntries(participantRows.map((row) => [row.id, row.display_name]));
      const myId = participantRows.find((row) => row.linked_user_id === sessionData.session!.user.id)?.id ?? null;

      // --- Settlement suggestions (FastAPI) ---
      let data: { suggestions: Suggestion[] } = { suggestions: [] };
      try {
        const response = await fetch(`${env.apiUrl.replace(/\/$/, '')}/trip/${tripId}/settlement-plan`, {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        });
        if (response.ok) {
          data = (await response.json()) as { suggestions: Suggestion[] };
        } else {
          const errBody = await response.json().catch(() => ({}));
          console.warn('Settlement plan response not ok:', errBody);
        }
      } catch (fetchErr) {
        console.warn('Could not reach settlement API at', env.apiUrl, fetchErr);
      }

      // --- Pending receipts to confirm (direct Supabase query) ---
      // Find all payment_recorded ledger entries for this trip where:
      //   1. to_participant = current user's participant row (they are the recipient)
      //   2. There is no corresponding payment_confirmed entry for the same expense/amount chain
      // confirm_payment (0005_backend_correctness.sql) stores the link back to the
      // original entry as { confirms: <original_id> } in its own metadata -- we key off
      // the absence of any payment_confirmed row referencing this entry's id that way.
      let receipts: PendingReceipt[] = [];
      if (myId) {
        const { data: ledgerRows, error: ledgerError } = await supabase
          .from('ledger_entries')
          .select('id, from_participant, amount, currency')
          .eq('trip_id', tripId)
          .eq('entry_type', 'payment_recorded')
          .eq('to_participant', myId);

        if (ledgerError) {
          // Non-fatal: settlement suggestions still show, just no confirm UI
          console.warn('Could not load pending receipts:', ledgerError.message);
        } else if (ledgerRows && ledgerRows.length > 0) {
          // Filter to only those not yet confirmed. confirm_payment (0005_backend_
          // correctness.sql) stores the link back to the original entry as
          // { confirms: <original_id> } -- 'confirms', not 'confirmed_entry_id'. Getting
          // this key wrong doesn't break anything loudly (confirm_payment has its own
          // server-side duplicate check and would reject a stale double-confirm
          // cleanly), it just means this filter would silently match nothing and every
          // already-confirmed payment would keep reappearing in the list forever.
          const recordedIds = ledgerRows.map((r) => r.id as string);
          const { data: confirmedRows } = await supabase
            .from('ledger_entries')
            .select('metadata')
            .eq('trip_id', tripId)
            .eq('entry_type', 'payment_confirmed')
            .in('metadata->>confirms', recordedIds);

          const alreadyConfirmed = new Set(
            (confirmedRows ?? []).map((r) => (r.metadata as { confirms?: string })?.confirms)
          );

          receipts = ledgerRows
            .filter((r) => !alreadyConfirmed.has(r.id as string))
            .map((r) => ({
              id: r.id as string,
              from_participant: r.from_participant as string,
              amount: (r.amount as number).toFixed(2),
              currency: r.currency as string,
            }));
        }
      }

      setSuggestions(data.suggestions);
      setNames(nameMap);
      setMyParticipantId(myId);
      setPendingReceipts(receipts);
    } catch (err) {
      setError(formatError(err));
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
      // Clear the spinner key BEFORE re-fetching so it doesn't persist across the reload
      // if the same suggestion reappears in the refreshed plan.
      setRecordingKey(null);
      await load();
    } catch (err) {
      setError(formatError(err));
      setRecordingKey(null);
    }
  }

  async function confirmPayment(entryId: string) {
    setConfirmingId(entryId);
    setError(null);
    try {
      await callRpc('confirm_payment', { p_ledger_entry_id: entryId });
      setConfirmingId(null);
      await load();
    } catch (err) {
      setError(formatError(err));
      setConfirmingId(null);
    }
  }

  const settled = !loading && !error && suggestions.length === 0 && pendingReceipts.length === 0;

  return (
    <View className="space-y-4">
      {loading && <ActivityIndicator className="mt-10" color="#2563eb" />}

      {!!error && (
        <View className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <Text className="text-sm text-red-700 font-medium">{error}</Text>
        </View>
      )}

      {settled && (
        <View className="card-elevated p-8 items-center mt-6">
          <View className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 items-center justify-center mb-3">
            <CheckCircle2 size={22} color="#059669" />
          </View>
          <Text className="text-sm font-semibold text-slate-600">Everyone is settled up.</Text>
        </View>
      )}

      {/* Settlement suggestions — payer side */}
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

      {/* Pending receipts to confirm — recipient side */}
      {!loading && pendingReceipts.length > 0 && (
        <View className="space-y-2">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-2">
            Payments awaiting your confirmation
          </Text>
          {pendingReceipts.map((receipt) => (
            <View className="card-elevated p-4 flex-row items-center gap-3" key={receipt.id}>
              <View className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 items-center justify-center">
                <ThumbsUp size={18} color="#059669" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-slate-700">
                  {names[receipt.from_participant] ?? receipt.from_participant} paid you
                </Text>
                <Text className="text-lg font-black text-slate-900 mt-0.5">
                  {receipt.currency} {receipt.amount}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmPayment(receipt.id)}
                disabled={confirmingId === receipt.id}
                className="px-3 py-2 rounded-xl bg-emerald-600 items-center justify-center"
              >
                {confirmingId === receipt.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-xs font-bold text-white">Confirm</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
