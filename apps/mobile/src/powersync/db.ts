import { PowerSyncDatabase } from '@powersync/react-native';
import { AppSchema } from './AppSchema';
import { SupabaseConnector } from './SupabaseConnector';

// PowerSyncDatabase builds its own OP-SQLite adapter from these options —
// no need to construct one by hand. (An earlier draft of this file did
// that explicitly; @powersync/react-native's own type declarations
// document the plain-options form below as the supported API, and the
// manual class isn't part of the package's public exports.)
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: 'expensio-spike.sqlite',
  },
});

let connected = false;

// Call once at app startup, after Supabase auth is ready. Safe to call more
// than once — guarded so double-invoke (e.g. Fast Refresh during dev)
// doesn't open two connections.
export async function connectPowerSync() {
  if (connected) return;
  connected = true;
  await db.connect(new SupabaseConnector());
}
