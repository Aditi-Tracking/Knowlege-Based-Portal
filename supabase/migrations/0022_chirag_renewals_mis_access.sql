-- Grants full MIS-tier access to Renewals & Collections for people who are
-- NOT actually in the MIS department (Employee_details.Employee_Dept) and
-- should NOT be reclassified as if they were — unlike the earlier Chirag
-- proposal (change Employee_Dept to 'mis'), this does not touch
-- Employee_Dept, ROLE_MAP, role_defaults, or any other module. It also
-- doesn't touch crm_persons — the intended first grantee (Chirag) has no
-- crm_persons row at all (he's Managing Director, not a calling agent), and
-- forcing one into existence just to hang a flag off it would misrepresent
-- him as a CRM person elsewhere in this module (Team Performance, the
-- Reassign dropdown, etc).
--
-- is_mis() itself is deliberately left unchanged — confirmed by grepping
-- every migration file that it is called ONLY from Renewals & Collections
-- policies/functions today, but it should keep meaning exactly "this
-- person's real department is MIS," not grow a special case that some
-- future unrelated feature might inherit by accident. is_renewals_mis()
-- wraps it instead: same real-MIS behavior, plus this new allow-list.
create table renewals_mis_grants (
  email text primary key,
  granted_at timestamptz not null default now(),
  note text
);

comment on table renewals_mis_grants is
  'Allow-list granting full MIS-tier Renewals & Collections access (Upload, Resolve Unmatched, Unassigned Pool, org-wide Overview) to someone without reclassifying their Employee_Dept/role elsewhere in the app. Checked via is_renewals_mis(). Managed by hand (migration/SQL), not a UI.';

alter table renewals_mis_grants enable row level security;

create policy "mis_manage_renewals_mis_grants" on renewals_mis_grants
  for all to public
  using (is_mis()); -- only real MIS-department staff can add/remove grants — a full-access grantee cannot self-manage this list

create policy "self_check_renewals_mis_grants" on renewals_mis_grants
  for select to public
  using (lower(email) = auth.email()); -- anyone may check only their OWN row (frontend needs this); the list itself isn't enumerable by non-MIS

create or replace function is_renewals_mis()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_mis() or exists (
    select 1 from renewals_mis_grants where lower(email) = auth.email()
  );
$$;

-- ── Swap every bare is_mis() call in Renewals & Collections to is_renewals_mis() ──
-- Every one of these tables/functions belongs exclusively to this module
-- (confirmed by grep — is_mis() has zero non-Renewals consumers), so this
-- swap's effect is fully contained to Renewals & Collections.

-- crm_customers
drop policy if exists "mis_full_access_customers" on crm_customers;
create policy "mis_full_access_customers" on crm_customers
  for all to public
  using (is_renewals_mis());

drop policy if exists "crm_view_own_customers" on crm_customers;
create policy "crm_view_own_customers" on crm_customers
  for select to public
  using (is_renewals_mis() or is_own_assigned_person(assigned_crm_person_id) or is_full_access_crm_person());

-- crm_persons
drop policy if exists "mis_full_access_persons" on crm_persons;
create policy "mis_full_access_persons" on crm_persons
  for all to public
  using (is_renewals_mis());

-- customer_name_aliases
drop policy if exists "mis_full_access_aliases" on customer_name_aliases;
create policy "mis_full_access_aliases" on customer_name_aliases
  for all to public
  using (is_renewals_mis());

-- outstanding_snapshots (mis_full_access_snapshots only — crm_view_own_snapshots
-- already uses is_full_access_crm_person(), not is_mis(), since migration 0020)
drop policy if exists "mis_full_access_snapshots" on outstanding_snapshots;
create policy "mis_full_access_snapshots" on outstanding_snapshots
  for all to public
  using (is_renewals_mis());

-- unmatched_import_names (current policy is 0019's renewals_staff_full_access_unmatched
-- — 0005's mis_full_access_unmatched was already dropped there)
drop policy if exists "renewals_staff_full_access_unmatched" on unmatched_import_names;
create policy "renewals_staff_full_access_unmatched" on unmatched_import_names
  for all to public
  using (is_renewals_mis() or is_active_crm_person());

-- collection_calls (mis_full_access_calls only — crm_view_own_calls/crm_log_own_calls
-- already use is_full_access_crm_person(), not is_mis(), since migration 0020)
drop policy if exists "mis_full_access_calls" on collection_calls;
create policy "mis_full_access_calls" on collection_calls
  for all to public
  using (is_renewals_mis());

-- import_jobs
drop policy if exists "mis_full_access_import_jobs" on import_jobs;
create policy "mis_full_access_import_jobs" on import_jobs
  for all to public
  using (is_renewals_mis());

-- import_job_closures
drop policy if exists "mis_full_access_import_job_closures" on import_job_closures;
create policy "mis_full_access_import_job_closures" on import_job_closures
  for all to public
  using (is_renewals_mis());

-- storage.objects — accounts-uploads bucket
drop policy if exists "mis_list_accounts_files" on storage.objects;
create policy "mis_list_accounts_files" on storage.objects
  for select to authenticated
  using (bucket_id = 'accounts-uploads' and is_renewals_mis());

drop policy if exists "mis_upload_accounts_files" on storage.objects;
create policy "mis_upload_accounts_files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'accounts-uploads' and is_renewals_mis());

-- storage.objects — call-attachments bucket (migration 0021)
drop policy if exists "mis_full_access_call_attachments" on storage.objects;
create policy "mis_full_access_call_attachments" on storage.objects
  for all to authenticated
  using (bucket_id = 'call-attachments' and is_renewals_mis())
  with check (bucket_id = 'call-attachments' and is_renewals_mis());

-- function reassign_crm_customer() (migration 0012) — same signature, so
-- create or replace is sufficient (no drop needed). Internal is_mis() checks
-- swapped; logic otherwise unchanged.
create or replace function reassign_crm_customer(
  p_customer_id uuid,
  p_new_person_id uuid -- null = move to the unassigned pool
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_person_id uuid;
begin
  select id into v_caller_person_id
  from crm_persons
  where lower(email) = auth.email()
  limit 1;

  if v_caller_person_id is null and not is_renewals_mis() then
    raise exception 'no crm_persons row found for the current user';
  end if;

  -- Ownership check — same authorization crm_reassign_own_customers' USING
  -- clause already enforced: only the customer's current assignee, or
  -- full-MIS-tier Renewals access, may move it.
  if not (
    is_renewals_mis()
    or exists (
      select 1 from crm_customers
      where id = p_customer_id
      and assigned_crm_person_id = v_caller_person_id
    )
  ) then
    raise exception 'not authorized to reassign this customer';
  end if;

  if p_new_person_id is not null and not exists (
    select 1 from crm_persons where id = p_new_person_id
  ) then
    raise exception 'target person % does not exist', p_new_person_id;
  end if;

  update crm_customers
  set assigned_crm_person_id = p_new_person_id
  where id = p_customer_id;
end;
$$;

-- function resolve_unmatched_customer() (migration 0004, security-definer'd in
-- 0019) — same signature, create or replace is sufficient. Internal
-- authorization check swapped; logic otherwise unchanged.
create or replace function resolve_unmatched_customer(
  p_unmatched_id uuid,
  p_person_id uuid,
  p_category text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unmatched unmatched_import_names%rowtype;
  v_calling_frequency text;
  v_customer_id uuid;
begin
  if not (is_renewals_mis() or is_active_crm_person()) then
    raise exception 'not authorized to resolve unmatched rows';
  end if;

  select * into v_unmatched
  from unmatched_import_names
  where id = p_unmatched_id
  for update;

  if not found then
    raise exception 'unmatched_import_names row % not found', p_unmatched_id;
  end if;

  if v_unmatched.resolved then
    raise exception 'unmatched_import_names row % is already resolved', p_unmatched_id;
  end if;

  v_calling_frequency := case p_category
    when 'Platinum' then 'Once a Week'
    when 'Gold'     then 'Twice a Week'
    when 'Silver'   then 'Thrice a Week'
    else null
  end;

  if v_calling_frequency is null then
    raise exception 'unrecognized category: %', p_category;
  end if;

  insert into crm_customers (
    billing_name, category, calling_frequency,
    assigned_crm_person_id, is_active_calling, status
  ) values (
    v_unmatched.raw_name, p_category, v_calling_frequency,
    p_person_id, true, 'active'
  ) returning id into v_customer_id;

  insert into customer_name_aliases (raw_name, customer_id, source)
  values (v_unmatched.raw_name, v_customer_id, 'manual');

  insert into outstanding_snapshots (
    customer_id, snapshot_date, bucket_0_30, bucket_31_60, bucket_61_90,
    bucket_above_90, grand_total, recovered_amount, is_closed
  ) values (
    v_customer_id, v_unmatched.import_batch_date, v_unmatched.bucket_0_30,
    v_unmatched.bucket_31_60, v_unmatched.bucket_61_90, v_unmatched.bucket_above_90,
    v_unmatched.grand_total, 0, false
  );

  update unmatched_import_names
  set resolved = true, resolved_customer_id = v_customer_id
  where id = p_unmatched_id;

  return v_customer_id;
end;
$$;

-- ── NOT included here, on purpose ─────────────────────────────────────────
-- The actual grant for Chirag:
--   insert into renewals_mis_grants (email) values ('chirag@adititracking.com');
-- This is left OUT of this migration file deliberately — per the standing
-- rule, nothing touches the live database, including this INSERT, until an
-- explicit separate go-ahead. Run it by hand (or in a follow-up migration)
-- only after that confirmation.
