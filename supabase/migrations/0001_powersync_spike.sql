-- ============================================================================
-- Expensio — PowerSync spike migration
--
-- Purpose: prove the full sync pipe (Postgres -> PowerSync -> local SQLite on
-- a real Android device, and back) works BEFORE any real schema goes in.
-- Per docs/architecture/expensio-pre-code-checklist.md: this is deliberately
-- a throwaway table, not the real data model — expensio-data-model.md is the
-- actual schema and is applied in a later migration once this spike passes.
--
-- Run this in the Supabase SQL Editor, or via `supabase db push` if you're
-- using the CLI with this repo's supabase/ directory as your project.
-- ============================================================================

create table if not exists spike_items (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  created_at timestamptz not null default now()
);

-- Deliberately wide open — this table holds no real data and exists only to
-- validate the sync pipe. Every real table gets a proper RLS policy per
-- expensio-permissions-matrix.md; this one intentionally doesn't, since the
-- goal here is isolating "does sync work at all" from "does access control
-- work," not testing both at once.
alter table spike_items enable row level security;
create policy spike_items_all on spike_items for all using (true) with check (true);

-- PowerSync needs full row images (not just changed columns) to compute
-- before/after state for updates and deletes off the Postgres WAL.
alter table spike_items replica identity full;

-- PowerSync reads through its own publication, not Supabase's default
-- `supabase_realtime` one — keeps the two systems from stepping on each
-- other. Add every table you want PowerSync to sync to this publication;
-- for now, just the spike table.
drop publication if exists powersync;
create publication powersync for table spike_items;
