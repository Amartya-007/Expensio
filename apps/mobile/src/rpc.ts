import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabaseClient';
import { db } from './powersync/db';
import { randomUUID } from './utils/uuid';

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
// Not every RPC takes p_client_request_id — 10 of the ~21 do (create_trip, add_expense,
// edit_expense, delete_expense, generate_invite, join_trip_via_code,
// add_placeholder_participant, add_custom_category, record_payment, confirm_payment); the
// other 11 (archive_trip, unarchive_trip, delete_trip, leave_trip, revoke_invite,
// revoke_recent_join, add_comment, add_attachment, update_display_name, delete_account,
// update_trip_details) don't. Sending it to one that doesn't accept it fails outright — PostgREST can't match
// an unexpected named parameter to any function signature. callRpc's idempotent option
// (default true) controls whether it gets added; pass { idempotent: false } for the RPCs
// that don't declare it. Those are naturally idempotent-enough in effect anyway (setting
// is_archived = true twice, or deleted_at = now() twice, does nothing worse than one
// duplicate activity-log entry on a rare replay) — a formal idempotency key just isn't
// available for them.

// Whether a failed RPC call should be queued for later (genuinely offline) or surfaced
// immediately as a real error (online, but something else is actually wrong -- auth,
// permissions, a validation failure). This used to be a message-string guess ('does the
// error text contain "network"/"fetch"/"timeout"?'), which this file's own comment already
// flagged as "not a certainty" -- and in practice it was misrouting real errors into the
// queue: a single, already-online user adding a placeholder participant would see "will be
// added after syncing" instead of the actual problem, because some non-network failure's
// message happened to match one of those substrings. NetInfo (already used for the
// reconnect listener in App.tsx) gives an actual answer instead of a guess.
async function isOffline(err: unknown): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected === false || state.isInternetReachable === false) return true;
    if (state.isConnected === true && state.isInternetReachable !== false) return false;
    // isInternetReachable can be null right after a state change on some Android devices,
    // before NetInfo has finished probing -- fall back to the old message heuristic only
    // for this narrow "genuinely don't know yet" case rather than trusting it generally.
    return isNetworkErrorMessage(err);
  } catch {
    // NetInfo itself failed to answer -- fall back rather than assuming either way.
    return isNetworkErrorMessage(err);
  }
}

function isNetworkErrorMessage(err: unknown): boolean {
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
    [randomUUID(), rpcName, JSON.stringify(params), clientRequestId, new Date().toISOString()]
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
        p_client_request_id: (params.p_client_request_id as string | undefined) ?? randomUUID(),
      }
    : params;
  // pending_actions still needs a unique local key even for a non-idempotent RPC, purely
  // for its own row identity -- separate from whether that value is ALSO sent to Postgres.
  const localTrackingId = (finalParams.p_client_request_id as string | undefined) ?? randomUUID();

  try {
    const { data, error } = await supabase.rpc(rpcName, finalParams);
    if (error) {
      if (await isOffline(error)) {
        await queueForLater(rpcName, finalParams, localTrackingId);
        return { status: 'queued' };
      }
      throw error;
    }
    return { status: 'ok', data: data as T };
  } catch (err) {
    if (await isOffline(err)) {
      await queueForLater(rpcName, finalParams, localTrackingId);
      return { status: 'queued' };
    }
    throw err;
  }
}

// Replays every queued action, oldest first, via a direct RPC call. App.tsx calls this at
// startup, on reconnect, and from the manual pull-to-refresh action.
export async function flushPendingActions(): Promise<void> {
  const pending = await db.getAll<{ id: string; rpc_name: string; params_json: string }>(
    'SELECT id, rpc_name, params_json FROM pending_actions ORDER BY created_at ASC'
  );

  for (const action of pending) {
    const params = JSON.parse(action.params_json) as Record<string, unknown>;
    const { error } = await supabase.rpc(action.rpc_name, params);

    if (!error || !(await isOffline(error))) {
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
