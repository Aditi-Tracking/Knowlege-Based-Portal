-- Replaces the direct PostgREST PATCH that js/renewals.js's ruReassign() used
-- to move a crm_customers row between CRM persons (or to the unassigned pool,
-- new value null). That PATCH goes through crm_reassign_own_customers' RLS
-- policy, which fails for BOTH cases — not just "move to unassigned pool" as
-- originally reported.
--
-- Root cause (confirmed empirically against the live database, not guessed):
-- crm_customers also has a SELECT policy, crm_view_own_customers
-- ("is_mis() OR is_own_assigned_person(assigned_crm_person_id)"). Postgres
-- requires that after an UPDATE, the resulting row still satisfies the
-- table's SELECT policy for the calling role — enforced in addition to the
-- UPDATE policy's own WITH CHECK, and regardless of whether RETURNING is
-- used. The moment a CRM person reassigns a customer away from themselves
-- (to null OR to another real person), that row no longer satisfies
-- is_own_assigned_person() for them and they aren't MIS, so the SELECT
-- policy evaluates false against the just-written row and Postgres raises
-- "new row violates row-level security policy" — surfaced by PostgREST as a
-- 403 — independent of whatever the UPDATE policy's WITH CHECK says.
--
-- Broadening crm_view_own_customers to tolerate this would mean showing a
-- CRM person rows that are no longer theirs (or belong to someone else
-- entirely), which defeats the point of that policy. A SECURITY DEFINER RPC
-- sidesteps the problem instead — it runs under the function owner's
-- privileges (this project's crm_customers has relforcerowsecurity = false,
-- so the owning role bypasses RLS entirely), so the "must remain
-- SELECT-visible to the caller after the write" requirement never applies.
-- The function does its own explicit ownership check up front, mirroring
-- crm_reassign_own_customers' USING clause, so authorization is equivalent —
-- just enforced in application logic instead of RLS. Same pattern already
-- used by resolve_unmatched_customer() (migration 0004) for comparable
-- privileged multi-step writes.
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

  if v_caller_person_id is null and not is_mis() then
    raise exception 'no crm_persons row found for the current user';
  end if;

  -- Ownership check — same authorization crm_reassign_own_customers' USING
  -- clause already enforced: only the customer's current assignee, or MIS,
  -- may move it.
  if not (
    is_mis()
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
