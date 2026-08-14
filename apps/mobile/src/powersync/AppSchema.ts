import { Schema, Table, column } from '@powersync/react-native';

// Client-side (SQLite) schema — same shape as the earlier Capacitor spike,
// just imported from @powersync/react-native instead of @powersync/web.
// Deliberately just the one throwaway spike table; see
// docs/architecture/expensio-pre-code-checklist.md. Real tables get added
// here once the spike passes, mirroring expensio-data-model.md's DDL
// column-for-column.
export const AppSchema = new Schema({
  spike_items: new Table({
    note: column.text,
    created_at: column.text,
  }),
});

export type Database = (typeof AppSchema)['types'];
