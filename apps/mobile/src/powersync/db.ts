import { PowerSyncDatabase } from '@powersync/capacitor';
import { AppSchema } from './AppSchema';
import { SupabaseConnector } from './SupabaseConnector';

// The Capacitor PowerSyncDatabase auto-detects the runtime and uses native
// SQLite (via @capacitor-community/sqlite) on Android/iOS, falling back to
// WA-SQLite (IndexedDB/OPFS) when running as a plain web page — same code
// either way, per architecture doc §1's note on the Capacitor SDK.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: 'expensio-spike.sqlite',
  },
});

let connected = false;

// Call once at app startup, after Supabase auth is ready. Safe to call more
// than once — guarded so React StrictMode's double-invoke in dev doesn't
// open two connections.
export async function connectPowerSync() {
  if (connected) return;
  connected = true;
  await db.connect(new SupabaseConnector());
}
