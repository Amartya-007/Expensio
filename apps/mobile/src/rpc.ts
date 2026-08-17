import { supabase } from './supabaseClient';
import { db } from './powersync/db';

// Why RPCs are called directly here instead of through PowerSync's CRUD upload queue
// (which is what the earlier spike used, and what most PowerSync tutorials show): real
// Expensio writes need server-side business logic that only exists in the RPCs --
// compute_expense_splits, activity-log entries, ledger entries. PowerSync's default CRUD
// queue just mirrors local INSERT/UPDATE/DELETE onto the matching Postgres table, which
// has no way to run that logic. So the split here is: PowerSync handles all READS (the
// synced tables in AppSchema.ts) via its normal replication; this file handles all WRITES,
// bypassing PowerSync's upload queue entirely. The results of a successful RPC call (new
// rows in trips/expenses/expense_splits/trip_activity_log) flow back to the client through
// PowerSync's ordinary replication, same as any other Postgres change -- there's nothing
// extra to do to make a successful write show up locally.
//
// Not every RPC takes p_client_request_id — 10 of the ~20 do (create_trip, add_expense,
// edit_expense, delete_expense, generate_invite, join_trip_via_code,
// add_placeholder_participant, add_custom_category, record_payment, confirm_payment); the
// other 10 (archive_trip, unarchive_trip, delete_trip, leave_trip, revoke_invite,
// revoke_recent_join, add_comment, add_attachment, update_display_name, delete_account)
// don't. Sending it to one that doesn't accept it fails outright — PostgREST can't match
// an unexpected named parameter to any function signature. callRpc's idempotent option
// (default true) controls whether it gets added; pass { idempotent: false } for the RPCs
// that don't declare it. Those are naturally idempotent-enough in effect anyway (setting
// is_archived = true twice, or deleted_at = now() twice, does nothing worse than one
// duplicate activity-log entry on a rare replay) — a formal idempotency key just isn't
// available for them.

function isNetworkError(err: unknown): boolean {
  // Heuristic, not a certainty -- react-native has no built-in reliable way to
  // distinguish "no internet" from "server returned an unusual error" without adding a
  // connectivity-check dependency (e.g. NetInfo), which this project doesn't have
  // installed. A Postgres-side error (validation failure, permission denied) always comes
  // back with a real error message from the database; a network failure's message is
  // almost always one of a handful of fetch-layer strings. Good enough to route correctly
  // in practice; add NetInfo if this ever misroutes a real error into the retry queue.
  const message = String((err as { message?: unknown })?.message ?? err ?? '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('failed to connect')
  );
}

async function queueForLater(rpcName: string, params: Record<string, unknown>, clientRequestId: string) {
  await db.execute(
    'INSERT INTO pending_actions (id, rpc_name, params_json, client_request_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), rpcName, JSON.stringify(params), clientRequestId, new Date().toISOString()]
  );
}

export type RpcResult<T> = { status: 'ok'; data: T } | { status: 'queued' };

// Call an Expensio RPC. On success, returns its result. On a NETWORK failure, queues it
// in the local pending_actions table (see AppSchema.ts) and returns { status: 'queued' }
// instead of throwing -- callers show an optimistic "pending sync" state rather than an
// error for this case. On any OTHER failure (a real validation or permission error from
// the RPC itself), throws -- that's a real problem the user needs to see now, not silently
// queue and retry, since retrying an invalid call just fails identically forever.
//
// idempotent (default true): whether to add p_client_request_id to the call. Must be
// false for the ~10 RPCs that don't declare that parameter -- see the file header.
export async function callRpc<T = unknown>(
  rpcName: string,
  params: Record<string, unknown>,
  opts: { idempotent?: boolean } = {}
): Promise<RpcResult<T>> {
  const idempotent = opts.idempotent ?? true;
  const finalParams = idempotent
    ? {
        ...params,
        p_client_request_id: (params.p_client_request_id as string | undefined) ?? crypto.randomUUID(),
      }
    : params;
  // pending_actions still needs a unique local key even for a non-idempotent RPC, purely
  // for its own row identity -- separate from whether that value is ALSO sent to Postgres.
  const localTrackingId = (finalParams.p_client_request_id as string | undefined) ?? crypto.randomUUID();

  try {
    const { data, error } = await supabase.rpc(rpcName, finalParams);
    if (error) {
      if (isNetworkError(error)) {
        await queueForLater(rpcName, finalParams, localTrackingId);
        return { status: 'queued' };
      }
      throw error;
    }
    return { status: 'ok', data: data as T };
  } catch (err) {
    if (isNetworkError(err)) {
      await queueForLater(rpcName, finalParams, localTrackingId);
      return { status: 'queued' };
    }
    throw err;
  }
}

// Replays every queued action, oldest first, via a direct RPC call. Call this after
// (re)connecting -- App.tsx does this once at startup and offers a manual pull-to-refresh,
// since this project doesn't have a network-state listener (NetInfo) installed to trigger
// it automatically on reconnect.
export async function flushPendingActions(): Promise<void> {
  const pending = await db.getAll<{ id: string; rpc_name: string; params_json: string }>(
    'SELECT id, rpc_name, params_json FROM pending_actions ORDER BY created_at ASC'
  );

  for (const action of pending) {
    const params = JSON.parse(action.params_json) as Record<string, unknown>;
    const { error } = await supabase.rpc(action.rpc_name, params);

    if (!error || !isNetworkError(error)) {
      // Either it succeeded, or it failed for a real (non-network) reason -- either way
      // it's done being pending. A real failure here would mean an action that was valid
      // enough to queue is now invalid on replay (e.g. the trip was deleted meanwhile) --
      // logged loudly since silently losing a queued action is a real bug if it happens.
      if (error) {
        console.error('Pending action failed permanently on replay, dropping it', action, error);
      }
      await db.execute('DELETE FROM pending_actions WHERE id = ?', [action.id]);
    }
    // else: still a network error -- leave it queued, the next flush will retry it.
  }
}
