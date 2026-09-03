import { useEffect, useState } from 'react';
import { db } from './db';

export interface SyncStatusSummary {
  connected: boolean;
  hasSynced: boolean | undefined;
  errorMessage: string | null;
}

function summarize(): SyncStatusSummary {
  const s = db.currentStatus;
  const err = s?.dataFlowStatus?.downloadError;
  return {
    connected: !!s?.connected,
    hasSynced: s?.hasSynced,
    errorMessage: err ? String((err as { message?: string })?.message ?? err) : null,
  };
}

// Exposes PowerSync's own connection status (db.currentStatus / statusChanged
// listener) so the UI can tell "connected and synced" apart from "silently
// stuck" -- which today it can't. This is what let the 401 PSYNC_S2105
// audience misconfiguration go unnoticed: the RPC calls that write data
// succeed independently of PowerSync, so nothing ever *errored* on screen --
// data just never synced back down, and there was no signal anywhere that
// the sync connection itself was being rejected.
export function useSyncStatus(): SyncStatusSummary {
  const [status, setStatus] = useState<SyncStatusSummary>(() => summarize());

  useEffect(() => {
    return db.registerListener({
      statusChanged: () => setStatus(summarize()),
    });
  }, []);

  return status;
}
