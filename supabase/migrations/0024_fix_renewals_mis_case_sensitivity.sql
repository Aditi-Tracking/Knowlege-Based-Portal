-- Fixes a case-sensitivity bug in is_renewals_mis() and
-- self_check_renewals_mis_grants (both introduced in 0022): both compared
-- `lower(email) = auth.email()`, which only lowercases the
-- renewals_mis_grants.email side. auth.email() returns the Auth user's email
-- verbatim from the JWT claim, which is not guaranteed to be lowercase — so
-- any grantee whose Auth email contains an uppercase letter silently fails
-- the match, even though their grants-table row is correct. Confirmed live:
-- an account with Auth email 'Collection@adititracking.com' (capital C) has
-- a matching, correctly-spelled row in renewals_mis_grants, yet
-- lower('Collection@adititracking.com') <> 'Collection@adititracking.com'
-- caused is_renewals_mis() (and the self-check policy gating the frontend's
-- own read of its row) to return false for them.
--
-- Fix: lowercase both sides of the comparison.

create or replace function is_renewals_mis()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_mis() or exists (
    select 1 from renewals_mis_grants where lower(email) = lower(auth.email())
  );
$$;

drop policy if exists "self_check_renewals_mis_grants" on renewals_mis_grants;
create policy "self_check_renewals_mis_grants" on renewals_mis_grants
  for select to public
  using (lower(email) = lower(auth.email())); -- anyone may check only their OWN row (frontend needs this); the list itself isn't enumerable by non-MIS
