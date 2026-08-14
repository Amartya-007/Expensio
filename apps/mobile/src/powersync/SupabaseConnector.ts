import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/react-native';
import { UpdateType } from '@powersync/react-native';
import { supabase } from '../supabaseClient';
import { env } from '../env';

// Postgres error codes that will NEVER succeed on retry (bad data, a
// constraint violation) — as opposed to a network blip, which should stay
// queued and retry automatically. Without this distinction, one bad local
// write would jam the entire upload queue forever, since PowerSync retries
// a failed transaction indefinitely by default.
// Class 22 = Data Exception (e.g. type mismatch), Class 23 = Integrity
// Constraint Violation (NOT NULL / FK / UNIQUE).
const FATAL_POSTGRES_RESPONSE_CODES = [/^22...$/, /^23...$/];

// Bridges PowerSync's local upload queue to Supabase — identical logic to
// the earlier Capacitor spike's connector, just re-imported from
// @powersync/react-native. For the spike, writes go straight to the table
// (spike_items has an open RLS policy); once real tables are wired up, this
// should call the RPCs in expensio-permissions-matrix.md instead of raw
// table writes, same as everywhere else in this design.
export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }
    if (!session) {
      throw new Error('No Supabase session — anonymous sign-in must run before connecting PowerSync.');
    }

    return {
      endpoint: env.powersyncUrl,
      // PowerSync instance must have "Use Supabase Auth" enabled, pointed at
      // your project's JWKS endpoint — see
      // docs/architecture/expensio-react-native-setup.md. That's what lets
      // the same Supabase session token authenticate both supabase-js calls
      // AND the PowerSync connection, matching architecture doc §6.
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    let lastOp: (typeof transaction.crud)[number] | undefined;
    try {
      for (const op of transaction.crud) {
        lastOp = op;
        const table = supabase.from(op.table);

        switch (op.op) {
          case UpdateType.PUT: {
            const record = { ...op.opData, id: op.id };
            const { error } = await table.upsert(record);
            if (error) throw error;
            break;
          }
          case UpdateType.PATCH: {
            const { error } = await table.update(op.opData ?? {}).eq('id', op.id);
            if (error) throw error;
            break;
          }
          case UpdateType.DELETE: {
            const { error } = await table.delete().eq('id', op.id);
            if (error) throw error;
            break;
          }
        }
      }

      await transaction.complete();
    } catch (ex: any) {
      const code = ex?.code as string | undefined;
      const isFatal = code != null && FATAL_POSTGRES_RESPONSE_CODES.some((re) => re.test(code));

      if (isFatal) {
        console.error('Discarding un-uploadable local write', lastOp, ex);
        await transaction.complete();
        return;
      }

      // Anything else (network error, PowerSync/Supabase temporarily down)
      // — leave the transaction queued and let PowerSync retry.
      throw ex;
    }
  }
}
