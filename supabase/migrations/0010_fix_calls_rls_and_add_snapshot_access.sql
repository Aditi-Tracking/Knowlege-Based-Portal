-- Closes two things:
--
-- 1. The known gap flagged in migration 0008: outstanding_snapshots had no
--    non-MIS SELECT policy at all, so latest_outstanding_snapshots returned
--    nothing for CRM persons. Adds one scoped to their own assigned customers.
--
-- 2. collection_calls already had 3 policies using the same broken
--    (auth.jwt() ->> 'role')/(auth.jwt() ->> 'crm_person_id') claim pattern
--    fixed everywhere else in migration 0005 — this table just wasn't in that
--    audit's scope. Right now: mis_full_access_calls never matches (MIS has
--    no working access), crm_log_own_calls's INSERT always rejects (nobody
--    can log a call), and crm_view_own_calls is both broken AND scoped wrong
--    even if the claim worked — it checks "calls I personally logged"
--    (called_by = self), not "calls for customers assigned to me," which is
--    what My Customers actually needs (a reassigned customer's call history
--    from before the reassignment must still be visible).
--
-- Also tightens crm_log_own_calls beyond its original scope: it only ever
-- checked called_by, not that the customer being logged against is assigned
-- to the caller — meaning a CRM person could log a call against ANY
-- customer as long as they set called_by to themselves. Closing that too.

drop policy if exists "mis_full_access_calls" on collection_calls;
create policy "mis_full_access_calls" on collection_calls
  for all to public
  using (is_mis());

drop policy if exists "crm_log_own_calls" on collection_calls;
create policy "crm_log_own_calls" on collection_calls
  for insert to public
  with check (
    is_own_assigned_person(called_by)
    and exists (
      select 1 from crm_customers
      where crm_customers.id = collection_calls.customer_id
      and is_own_assigned_person(crm_customers.assigned_crm_person_id)
    )
  );

drop policy if exists "crm_view_own_calls" on collection_calls;
create policy "crm_view_own_calls" on collection_calls
  for select to public
  using (
    exists (
      select 1 from crm_customers
      where crm_customers.id = collection_calls.customer_id
      and is_own_assigned_person(crm_customers.assigned_crm_person_id)
    )
  );

create policy "crm_view_own_snapshots" on outstanding_snapshots
  for select to public
  using (
    exists (
      select 1 from crm_customers
      where crm_customers.id = outstanding_snapshots.customer_id
      and is_own_assigned_person(crm_customers.assigned_crm_person_id)
    )
  );
