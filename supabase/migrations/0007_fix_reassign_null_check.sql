-- crm_reassign_own_customers' WITH CHECK (from migration 0005) rejects setting
-- assigned_crm_person_id to null, since `id = null` is never true in SQL —
-- exists(...) always evaluates false for a null comparison. That breaks the
-- "move to unassigned pool" case the Renewals & Collections UI needs, where a
-- CRM person hands a customer back to the unassigned pool rather than to
-- another named person. USING is unchanged — only rows the caller currently
-- owns can still be touched.
drop policy if exists "crm_reassign_own_customers" on crm_customers;
create policy "crm_reassign_own_customers" on crm_customers
  for update to public
  using (is_own_assigned_person(assigned_crm_person_id))
  with check (
    crm_customers.assigned_crm_person_id is null
    or exists (select 1 from crm_persons where id = crm_customers.assigned_crm_person_id)
  );
