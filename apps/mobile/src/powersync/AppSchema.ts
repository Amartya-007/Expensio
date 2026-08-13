import { Schema, Table, column } from '@powersync/web';

// The client-side (SQLite) schema — deliberately just the one spike table.
// This is NOT expensio-data-model.md's real schema; it exists only to prove
// the sync pipe works. Real tables get added here once the spike passes,
// mirroring expensio-data-model.md's DDL column-for-column.
//
// PowerSync applies this schema when the database is instantiated — no
// migration step, unlike the Postgres side (supabase/migrations/).
export const AppSchema = new Schema({
  spike_items: new Table({
    // id is implicit — PowerSync always provides a TEXT id column matching
    // Postgres's uuid primary key.
    note: column.text,
    created_at: column.text,
  }),
});

export type Database = (typeof AppSchema)['types'];
