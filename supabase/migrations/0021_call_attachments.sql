-- Screenshot attachments on logged calls. Neither existing bucket fit:
-- accounts-uploads is MIS-only and read only by a service-role edge
-- function, and `files` (knowledge-base attachments) is public-read with no
-- RLS — call screenshots can contain customer payment confirmations/bank
-- details/private conversation context, which shouldn't be fetchable by
-- anyone with the link. New private bucket instead, with RLS mirroring
-- collection_calls' own access shape.
--
-- file_size_limit/allowed_mime_types are enforced by Storage itself, not
-- just the client's <input accept> hint — belt-and-suspenders against a
-- modified client or direct API call.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-attachments', 'call-attachments', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table collection_calls
  add column if not exists screenshot_url text;

comment on column collection_calls.screenshot_url is
  'Storage object path (not a full URL) in the private call-attachments bucket — <customer_id>/<timestamp>_<filename>. Null when no screenshot was attached. Bucket is private, so viewers fetch it via an authenticated request (see _ruOpenScreenshotLightbox), not a plain public URL.';

-- Object paths are written as <customer_id>/<filename> (see
-- _ruUploadCallScreenshot in js/renewals.js) specifically so storage.
-- foldername(name) — the folder segments of the object path — gives these
-- policies a customer_id to check ownership against, the same way
-- collection_calls/outstanding_snapshots RLS checks assigned_crm_person_id.
-- There's no per-call linkage available at upload time (the collection_calls
-- row doesn't exist yet — the file uploads first, then its path is
-- referenced in the row), so this checks against crm_customers directly
-- rather than joining through collection_calls.
drop policy if exists "mis_full_access_call_attachments" on storage.objects;
create policy "mis_full_access_call_attachments" on storage.objects
  for all to authenticated
  using (bucket_id = 'call-attachments' and is_mis())
  with check (bucket_id = 'call-attachments' and is_mis());

drop policy if exists "crm_upload_own_call_attachments" on storage.objects;
create policy "crm_upload_own_call_attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'call-attachments'
    and exists (
      select 1 from crm_customers
      where crm_customers.id::text = (storage.foldername(name))[1]
      and (is_own_assigned_person(crm_customers.assigned_crm_person_id) or is_full_access_crm_person())
    )
  );

drop policy if exists "crm_view_own_call_attachments" on storage.objects;
create policy "crm_view_own_call_attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'call-attachments'
    and exists (
      select 1 from crm_customers
      where crm_customers.id::text = (storage.foldername(name))[1]
      and (is_own_assigned_person(crm_customers.assigned_crm_person_id) or is_full_access_crm_person())
    )
  );
