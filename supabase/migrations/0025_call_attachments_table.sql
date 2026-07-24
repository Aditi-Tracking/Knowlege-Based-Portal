-- Multi-screenshot support for logged calls. collection_calls.screenshot_url
-- (migration 0021) was a single text column — one screenshot per call. This
-- replaces it with a proper child table so a call can carry any number of
-- attachments, following this repo's existing normalization pattern (a
-- separate table per one-to-many relationship, e.g. customer_name_aliases)
-- rather than a text[] column — RLS scopes to table rows, not array
-- elements, and this leaves room for per-attachment metadata later (e.g.
-- uploaded_by) without another migration.
--
-- Nothing in the storage layer changes: call-attachments' bucket/RLS
-- (migration 0021) is already keyed off <customer_id>/<filename> object
-- paths, per file, with no count limit — it already supports any number of
-- attachments per call with zero changes here.
--
-- Every statement below is written to be safely re-runnable: this project
-- has no supabase_migrations.schema_migrations tracking (migrations are
-- applied by hand via `supabase db query -f`, not `db push`), so nothing
-- records that this file already ran — re-running it (deliberately, or by
-- mistake) must be a no-op, not an error.

create table if not exists call_attachments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references collection_calls(id) on delete cascade,
  screenshot_url text not null,
  created_at timestamptz not null default now()
);

comment on table call_attachments is
  'One row per screenshot attached to a logged call (collection_calls). screenshot_url is a storage object path in the private call-attachments bucket (migration 0021), same convention as the column this replaces.';

create index if not exists call_attachments_call_id_idx on call_attachments(call_id);

-- Enabling RLS that's already enabled is itself already a silent no-op —
-- no IF NOT EXISTS equivalent needed here.
alter table call_attachments enable row level security;

-- RLS mirrors collection_calls' own policies (migration 0010) exactly,
-- joining through collection_calls -> crm_customers the same way, since an
-- attachment's visibility/ownership should never diverge from its call's.
-- drop-then-create (this repo's existing convention, e.g. migration 0021)
-- makes each policy re-runnable/redefinable rather than erroring on repeat.
drop policy if exists "mis_full_access_call_attachments_table" on call_attachments;
create policy "mis_full_access_call_attachments_table" on call_attachments
  for all to public
  using (is_mis());

drop policy if exists "crm_view_own_call_attachments_table" on call_attachments;
create policy "crm_view_own_call_attachments_table" on call_attachments
  for select to public
  using (
    exists (
      select 1 from collection_calls cc
      join crm_customers c on c.id = cc.customer_id
      where cc.id = call_attachments.call_id
      and (is_own_assigned_person(c.assigned_crm_person_id) or is_full_access_crm_person())
    )
  );

drop policy if exists "crm_insert_own_call_attachments_table" on call_attachments;
create policy "crm_insert_own_call_attachments_table" on call_attachments
  for insert to public
  with check (
    exists (
      select 1 from collection_calls cc
      join crm_customers c on c.id = cc.customer_id
      where cc.id = call_attachments.call_id
      and (is_own_assigned_person(c.assigned_crm_person_id) or is_full_access_crm_person())
    )
  );

-- Backfill: every existing call's single screenshot becomes its first (and
-- so far only) attachment row. Confirmed live before writing this migration
-- — 10 of 235 collection_calls rows have a non-null screenshot_url; this
-- carries all 10 forward before the column is dropped below.
--
-- Wrapped in dynamic SQL behind an information_schema check because on a
-- re-run *after* the drop-column step below has already executed once,
-- collection_calls.screenshot_url no longer exists — a plain (non-dynamic)
-- reference to it would fail to even parse, regardless of any WHERE guard.
-- The `not exists` anti-join additionally protects a re-run *before* the
-- column's been dropped (e.g. a re-run interrupted between this step and
-- the drop) from inserting duplicate attachment rows for calls already
-- backfilled.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'collection_calls' and column_name = 'screenshot_url'
  ) then
    execute $sql$
      insert into call_attachments (call_id, screenshot_url, created_at)
      select cc.id, cc.screenshot_url, cc.created_at
      from collection_calls cc
      where cc.screenshot_url is not null
      and not exists (
        select 1 from call_attachments ca where ca.call_id = cc.id
      )
    $sql$;
  end if;
end $$;

-- Nothing reads collection_calls.screenshot_url anymore (frontend now reads
-- through call_attachments) — safe to drop now that its data is preserved
-- in the backfill above. IF EXISTS makes this a no-op on re-run.
alter table collection_calls drop column if exists screenshot_url;
