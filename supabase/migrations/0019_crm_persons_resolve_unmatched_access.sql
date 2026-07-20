-- Gives CRM persons the same full access to Resolve Unmatched that MIS has
-- — unmatched_import_names rows have no "assigned to" concept at all (they
-- aren't linked to any customer/person yet), so there's no natural
-- per-person scoping to apply here the way My Customers scopes by
-- assigned_crm_person_id. Every active CRM person sees and can act on the
-- exact same unresolved rows as MIS, matching the frontend requirement
-- that this tab behave identically for both roles.
--
-- is_active_crm_person() mirrors is_mis()'s exact shape (security definer,
-- checks the caller's own auth.email() against an active crm_persons row)
-- rather than repeating that subquery inline in every policy that needs it.
create or replace function is_active_crm_person()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from crm_persons
    where lower(email) = auth.email()
    and is_active = true
  );
$$;

drop policy if exists "mis_full_access_unmatched" on unmatched_import_names;
create policy "renewals_staff_full_access_unmatched" on unmatched_import_names
  for all to public
  using (is_mis() or is_active_crm_person());

-- resolve_unmatched_customer() (migration 0004) inserts into crm_customers,
-- customer_name_aliases, and outstanding_snapshots — none of which grant a
-- CRM person general INSERT access (crm_customers/customer_name_aliases
-- have no CRM-person INSERT policy at all; a customer doesn't exist yet at
-- the point of this insert, so there's nothing for an "own assigned rows"
-- style policy to scope against anyway). Rather than opening broad INSERT
-- policies on three tables for every CRM person — which would grant more
-- than this one controlled flow needs — this function becomes SECURITY
-- DEFINER (same pattern as reassign_crm_customer, migration 0012) with its
-- own explicit authorization check, so it remains the sole gate for CRM
-- persons creating new customers this way.
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
  if not (is_mis() or is_active_crm_person()) then
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
