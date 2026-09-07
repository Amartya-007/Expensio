import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

  // settled is only true once we know the participant lookup succeeded (myParticipantId
  // resolves to null for anonymous users with no participant row, so we use a separate
  // `loaded` flag to distinguish "loaded with no suggestions" from "not loaded yet").
  const settled = !loading && !error && myParticipantId !== null && suggestions.length === 0 && pendingReceipts.length === 0;

  return (
    <View style={sv.root}>
      {loading && <ActivityIndicator style={sv.spinner} color="#2563eb" />}

      {!!error && (
        <View style={sv.errorBanner}>
          <Text style={sv.errorText}>{error}</Text>
          <Pressable onPress={load} style={sv.retryBtn}>
            <Text style={sv.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {settled && (
        <View style={sv.settledCard}>
          <View style={sv.settledIcon}>
            <CheckCircle2 size={22} color="#059669" />
          </View>
          <Text style={sv.settledText}>Everyone is settled up.</Text>
        </View>
      )}

      {/* Settlement suggestions — payer side */}
      {!loading &&
        suggestions.map((suggestion, index) => {
          const key = `${suggestion.from_participant}-${suggestion.to_participant}-${suggestion.currency}-${index}`;
          const canRecord = myParticipantId !== null && suggestion.from_participant === myParticipantId;
          return (
            <View style={sv.suggestionCard} key={key}>
              <View style={sv.amberIcon}>
                <HandCoins size={18} color="#d97706" />
              </View>
              <View style={sv.cardBody}>
                <Text style={sv.cardTitle}>
                  {names[suggestion.from_participant] ?? suggestion.from_participant} pays{' '}
                  {names[suggestion.to_participant] ?? suggestion.to_participant}
                </Text>
                <Text style={sv.cardAmount}>
                  {suggestion.currency} {suggestion.amount}
                </Text>
              </View>
              {canRecord && (
                <Pressable
                  onPress={() => recordPayment(suggestion, key)}
                  disabled={recordingKey === key}
                  style={sv.paidBtn}
                >
                  {recordingKey === key ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={sv.paidBtnText}>I paid this</Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}

      {/* Pending receipts to confirm — recipient side */}
      {!loading && pendingReceipts.length > 0 && (
        <View style={sv.receiptsSection}>
          <Text style={sv.receiptsSectionLabel}>
            Payments awaiting your confirmation
          </Text>
          {pendingReceipts.map((receipt) => (
            <View style={sv.suggestionCard} key={receipt.id}>
              <View style={sv.emeraldIcon}>
                <ThumbsUp size={18} color="#059669" />
              </View>
              <View style={sv.cardBody}>
                <Text style={sv.cardTitle}>
                  {names[receipt.from_participant] ?? receipt.from_participant} paid you
                </Text>
                <Text style={sv.cardAmount}>
                  {receipt.currency} {receipt.amount}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmPayment(receipt.id)}
                disabled={confirmingId === receipt.id}
                style={sv.confirmBtn}
              >
                {confirmingId === receipt.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={sv.confirmBtnText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const sv = StyleSheet.create({
  root: { gap: 12 },
  spinner: { marginTop: 40, alignSelf: 'center' },

  errorBanner: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  errorText: { fontSize: 13, fontWeight: '600', color: '#be123c', flex: 1 },
  retryBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' },
  retryText: { fontSize: 12, fontWeight: '700', color: '#be123c' },

  settledCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 28, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', gap: 10, marginTop: 8 },
  settledIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', alignItems: 'center', justifyContent: 'center' },
  settledText: { fontSize: 14, fontWeight: '600', fontFamily: 'Inter_600SemiBold', color: '#0b1c30' },

  suggestionCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#0b1c30', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  amberIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emeraldIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 13, fontWeight: '500', fontFamily: 'Inter_500Medium', color: '#434655' },
  cardAmount: { fontSize: 18, fontWeight: '700', fontFamily: 'Inter_700Bold', color: '#0b1c30', marginTop: 2, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },

  paidBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingHorizontal: 14, height: 40, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  paidBtnText: { fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold', color: '#ffffff' },
  confirmBtn: { backgroundColor: '#10b981', borderRadius: 12, paddingHorizontal: 14, height: 40, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  confirmBtnText: { fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold', color: '#ffffff' },

  receiptsSection: { gap: 8, marginTop: 4 },
  receiptsSectionLabel: { fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold', color: '#737686', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
});
