-- Fixes RLS policies written against (auth.jwt() ->> 'role') = 'mis' and
-- (auth.jwt() ->> 'crm_person_id'), neither of which exist — Supabase Auth JWTs
-- only carry the reserved 'role' claim ('authenticated'/'anon'/'service_role'),
-- never an app-level role. The app's real "MIS" / "which CRM person" concepts
-- live in Employee_details.Employee_Dept and crm_persons.email, keyed by the
-- caller's real, trustworthy auth.email().
--
-- Two helper functions centralize the corrected checks so they're defined once
-- instead of repeated inline across 9 policies. SECURITY DEFINER so the checks
-- aren't accidentally blocked by unrelated RLS on Employee_details/crm_persons.

create or replace function is_mis()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from "Employee_details"
    where lower("Email_Id") = auth.email()
    and lower("Employee_Dept") = 'mis'
  );
$$;

create or replace function is_own_assigned_person(p_assigned_crm_person_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from crm_persons
    where crm_persons.id = p_assigned_crm_person_id
    and lower(crm_persons.email) = auth.email()
  );
$$;

-- ── crm_customers ────────────────────────────────────────────────────────
drop policy if exists "mis_full_access_customers" on crm_customers;
create policy "mis_full_access_customers" on crm_customers
  for all to public
  using (is_mis());

drop policy if exists "crm_view_own_customers" on crm_customers;
create policy "crm_view_own_customers" on crm_customers
  for select to public
  using (is_mis() or is_own_assigned_person(assigned_crm_person_id));

-- USING: only rows currently assigned to the calling CRM person can be touched.
-- WITH CHECK: the new assigned_crm_person_id may be ANY valid crm_persons.id —
-- this is what actually allows reassigning a customer away to someone else,
-- rather than only permitting no-op updates that leave it assigned to self.
--
-- Note: RLS is row-level only — it has no concept of "this policy may change
-- column X but not column Y". A CRM person who owns a row can update ANY
-- column on it (category, calling_frequency, etc.), not just
-- assigned_crm_person_id, as long as USING/WITH CHECK both pass. Restricting
-- to specific columns would need column-level GRANT/REVOKE privileges (a
-- separate mechanism from RLS) or a trigger — not added here since it wasn't
-- asked for, just flagging it so it's a known/deliberate gap.
drop policy if exists "crm_reassign_own_customers" on crm_customers;
create policy "crm_reassign_own_customers" on crm_customers
  for update to public
  using (is_own_assigned_person(assigned_crm_person_id))
  with check (
    exists (select 1 from crm_persons where id = crm_customers.assigned_crm_person_id)
  );

-- ── crm_persons ──────────────────────────────────────────────────────────
-- everyone_can_view_persons (qual = true) is role-agnostic and untouched.
drop policy if exists "mis_full_access_persons" on crm_persons;
create policy "mis_full_access_persons" on crm_persons
  for all to public
  using (is_mis());

-- ── customer_name_aliases ────────────────────────────────────────────────
drop policy if exists "mis_full_access_aliases" on customer_name_aliases;
create policy "mis_full_access_aliases" on customer_name_aliases
  for all to public
  using (is_mis());

-- ── outstanding_snapshots ────────────────────────────────────────────────
drop policy if exists "mis_full_access_snapshots" on outstanding_snapshots;
create policy "mis_full_access_snapshots" on outstanding_snapshots
  for all to public
  using (is_mis());

-- ── unmatched_import_names ───────────────────────────────────────────────
drop policy if exists "mis_full_access_unmatched" on unmatched_import_names;
create policy "mis_full_access_unmatched" on unmatched_import_names
  for all to public
  using (is_mis());

-- ── storage.objects (accounts-uploads bucket) ───────────────────────────
drop policy if exists "mis_list_accounts_files" on storage.objects;
create policy "mis_list_accounts_files" on storage.objects
  for select to authenticated
  using (bucket_id = 'accounts-uploads' and is_mis());

drop policy if exists "mis_upload_accounts_files" on storage.objects;
create policy "mis_upload_accounts_files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'accounts-uploads' and is_mis());
