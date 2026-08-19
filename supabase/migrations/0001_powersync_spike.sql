create table if not exists spike_items (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  created_at timestamptz not null default now()
);

alter table spike_items enable row level security;
create policy spike_items_all on spike_items for all using (true) with check (true);

alter table spike_items replica identity full;

drop publication if exists powersync;
create publication powersync for table spike_items;
