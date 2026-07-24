-- Lightweight migration-tracking table, added after a real re-run mix-up:
-- 0025 was re-applied against production because nothing recorded that it
-- had already run. This project's migrations are applied by hand via
-- `supabase db query -f`, not `supabase db push` — so there's no
-- supabase_migrations.schema_migrations table doing this automatically,
-- the way a linked project managed entirely through the CLI would get for
-- free.
--
-- This is deliberately NOT a replacement for reviewing/running each
-- migration by hand one at a time (that stays exactly as it is) — it's
-- just a record of what's already been applied, so a re-run (deliberate or
-- accidental) can no-op instead of erroring or silently duplicating data,
-- the same principle as 0025's own IF NOT EXISTS/DROP-then-CREATE guards.
--
-- Going forward, every new migration file should end with:
--   insert into applied_migrations (filename) values ('00XX_name.sql')
--   on conflict (filename) do nothing;
-- and may optionally check at the top whether its own filename is already
-- present, to skip its body entirely on a re-run (see 0025 for the
-- dynamic-SQL pattern needed when the body includes a DDL change like a
-- column drop that isn't safely re-parseable on its own).

create table if not exists applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

comment on table applied_migrations is
  'Records which supabase/migrations/*.sql files have already been run against this database. Not auto-populated by any tool — each migration inserts its own filename at its end (on conflict do nothing). Rows for migrations older than this table were backfilled here with an applied_at of "now" at backfill time, not their real original apply time, which isn''t recoverable.';

-- Backfill: every migration that already ran before this table existed,
-- in filename order.
insert into applied_migrations (filename) values
  ('0001_outstanding_snapshots_unique.sql'),
  ('0002_match_customer_name.sql'),
  ('0003_unmatched_import_names_unique.sql'),
  ('0004_resolve_unmatched_customer.sql'),
  ('0005_fix_rls_mis_check.sql'),
  ('0006_import_jobs_status_tracking.sql'),
  ('0007_fix_reassign_null_check.sql'),
  ('0008_latest_snapshots_and_calls_views.sql'),
  ('0009_get_renewals_overview.sql'),
  ('0010_fix_calls_rls_and_add_snapshot_access.sql'),
  ('0011_customer_status_and_recovered_amount.sql'),
  ('0012_reassign_crm_customer_rpc.sql'),
  ('0013_renewals_overview_dashboard.sql'),
  ('0014_renewals_overview_personal_scope.sql'),
  ('0015_recovered_amount_derived_from_calls.sql'),
  ('0016_import_job_closures.sql'),
  ('0017_overview_excludes_zero_balance.sql'),
  ('0018_latest_unmatched_import_names_view.sql'),
  ('0019_crm_persons_resolve_unmatched_access.sql'),
  ('0020_suchit_full_data_access.sql'),
  ('0021_call_attachments.sql'),
  ('0022_chirag_renewals_mis_access.sql'),
  ('0023_full_access_team_performance.sql'),
  ('0024_fix_renewals_mis_case_sensitivity.sql'),
  ('0025_call_attachments_table.sql')
on conflict (filename) do nothing;

-- This migration's own record — the pattern every future migration should
-- follow, as its final statement.
insert into applied_migrations (filename) values ('0026_applied_migrations_table.sql')
on conflict (filename) do nothing;
