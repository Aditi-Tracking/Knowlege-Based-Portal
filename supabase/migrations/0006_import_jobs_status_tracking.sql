-- Adds a dedicated status-tracking table for async parse-outstanding runs.
-- Row-count diffing (comparing outstanding_snapshots/unmatched_import_names
-- counts before/after upload) was unreliable: the pipeline upserts (same
-- customer + same date = update, not insert), so re-processing the same file
-- never changes counts even on a fully successful run. This table gives the
-- frontend a direct, unambiguous completion signal instead.

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  file_path text not null,
  status text not null default 'processing' check (status in ('processing','done','error')),
  rows_processed int,
  matched int,
  unmatched int,
  closed int,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table import_jobs enable row level security;

create policy "mis_full_access_import_jobs" on import_jobs
  for all to public
  using (is_mis());

-- ── trigger_parse_outstanding_fn ─────────────────────────────────────────
-- Creates the import_jobs row before invoking the Edge Function, and passes
-- its id through in the payload (as a sibling key to 'record', since
-- row_to_json(new) off storage.objects has no job_id column of its own) so
-- the function can report status/summary/error directly against that row.
--
-- IMPORTANT: replace <WEBHOOK_SECRET> below with the real secret (the same
-- value already live in this function today) before running this in the SQL
-- editor. Do NOT commit the real value back into this file.
create or replace function public.trigger_parse_outstanding_fn()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_job_id uuid;
begin
  if new.bucket_id = 'accounts-uploads' then
    insert into import_jobs (file_path, status)
    values (new.name, 'processing')
    returning id into v_job_id;

    perform net.http_post(
      url := 'https://rramdtpabwjsndgkohbi.supabase.co/functions/v1/parse-outstanding',
      headers := '{"Content-Type": "application/json", "x-webhook-secret": "<WEBHOOK_SECRET>"}'::jsonb,
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'objects',
        'schema', 'storage',
        'record', row_to_json(new),
        'job_id', v_job_id
      ),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
end;
$function$;
