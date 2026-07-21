-- Gives a crm_persons row org-wide READ access to every customer's data
-- (like MIS), without granting MIS-only tabs (Upload, Unassigned Pool) or
-- MIS-only write actions. is_mis() is keyed off Employee_details.
-- Employee_Dept, a completely separate table from crm_persons — this is
-- deliberately a new, independent flag/helper, not a tweak to is_mis()
-- itself, so the frontend's Upload/Unassigned Pool tab gate (driven by
-- CURRENT_USER.role, nothing to do with crm_persons) is never affected.
--
-- First grant: Suchit Shah (suchit@adititracking.com), crm_persons.id =
-- ff2f64fd-bd3e-488a-bc6e-d1b6c47c9aad — confirmed as the sole match before
-- writing this migration.

alter table crm_persons
  add column if not exists full_data_access boolean not null default false;

comment on column crm_persons.full_data_access is
  'Grants org-wide read access to all customers'' data (like MIS) without granting MIS-only tabs (Upload, Unassigned Pool) or MIS-only write actions. Checked via is_full_access_crm_person().';

create or replace function is_full_access_crm_person()
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
    and full_data_access = true
  );
$$;

-- ── crm_customers ────────────────────────────────────────────────────────
-- Read-only widening. crm_reassign_own_customers (UPDATE) is deliberately
-- left untouched — full_data_access grants visibility, not reassignment
-- power over customers outside one's own book; that would be a distinct,
-- unrequested privilege.
drop policy if exists "crm_view_own_customers" on crm_customers;
create policy "crm_view_own_customers" on crm_customers
  for select to public
  using (is_mis() or is_own_assigned_person(assigned_crm_person_id) or is_full_access_crm_person());

-- ── outstanding_snapshots ────────────────────────────────────────────────
drop policy if exists "crm_view_own_snapshots" on outstanding_snapshots;
create policy "crm_view_own_snapshots" on outstanding_snapshots
  for select to public
  using (
    is_full_access_crm_person()
    or exists (
      select 1 from crm_customers
      where crm_customers.id = outstanding_snapshots.customer_id
      and is_own_assigned_person(crm_customers.assigned_crm_person_id)
    )
  );

-- ── collection_calls ─────────────────────────────────────────────────────
-- SELECT: same widening as snapshots.
drop policy if exists "crm_view_own_calls" on collection_calls;
create policy "crm_view_own_calls" on collection_calls
  for select to public
  using (
    is_full_access_crm_person()
    or exists (
      select 1 from crm_customers
      where crm_customers.id = collection_calls.customer_id
      and is_own_assigned_person(crm_customers.assigned_crm_person_id)
    )
  );

-- INSERT: a full-access CRM person can log a call against ANY customer, not
-- just their own assigned book — otherwise the Call button in My Customers
-- (now showing every customer for them) would be visibly present but
-- silently fail RLS for rows outside their own book. called_by itself still
-- must be the caller (is_own_assigned_person(called_by)) — full_data_access
-- widens which customers a call can be logged against, not who it can be
-- attributed to.
drop policy if exists "crm_log_own_calls" on collection_calls;
create policy "crm_log_own_calls" on collection_calls
  for insert to public
  with check (
    is_own_assigned_person(called_by)
    and (
      is_full_access_crm_person()
      or exists (
        select 1 from crm_customers
        where crm_customers.id = collection_calls.customer_id
        and is_own_assigned_person(crm_customers.assigned_crm_person_id)
      )
    )
  );

-- unmatched_import_names/customer_name_aliases/import_jobs/import_job_closures
-- and the accounts-uploads storage policies are untouched:
--   - unmatched_import_names is already unscoped for every active CRM person
--     (migration 0019) — Suchit already sees identical rows to MIS here.
--   - customer_name_aliases has no CRM-person policy at all, and js/renewals.js
--     never queries it directly for any CRM-person-facing tab (confirmed by
--     grep) — nothing to widen.
--   - import_jobs/import_job_closures/accounts-uploads stay MIS-only,
--     matching Upload staying hidden from a full-access (non-MIS) person.

-- ── get_renewals_overview() ──────────────────────────────────────────────
-- New p_full_access param. The existing single p_crm_person_id can't express
-- "org-wide for the assignment-scoped sections, personal for the
-- called-by-scoped ones" in one call — team_performance must stay the
-- caller's personal scorecard (confirmed preference) while financial/
-- status_breakdown/recent_activity go org-wide for a full-access caller.
--
-- Per-section behavior under p_full_access:true (p_crm_person_id still set
-- to the caller's own id, NOT null):
--   - category_outstanding / monthly_recovery / status_counts / financial.* :
--     bypass scoping (org-wide), same as if p_crm_person_id were null.
--   - team_performance: UNCHANGED — stays scoped to just the caller's own
--     row. This is the one section that intentionally does NOT widen; no
--     frontend change needed either, _ruOverviewTeamTableHtml already
--     renders the personal scorecard for any non-MIS caller.
--   - recent_activity: bypass scoping (org-wide) — grouped with financial/
--     status per the confirmed answer, even though it shares its scoping
--     axis (called_by) with team_performance, which does NOT bypass.
--   - operational_health.unresolved_unmatched_count: bypass (real number,
--     not null) — confirmed, since a full-access person has the Resolve
--     Unmatched tab and can act on it.
--   - operational_health.unassigned_pool_count: UNCHANGED — stays null
--     under any non-null p_crm_person_id, full_access or not. Unassigned
--     Pool itself stays hidden from a full-access (non-MIS) person.
--   - operational_health.never_called_count: UNCHANGED — stays scoped to
--     the caller's own assigned customers even under full_access. Not one
--     of the four sections named in the confirmed answer, and its frontend
--     label ("Your Never-Called Customers" vs "Never Called") is keyed off
--     _ruIsMIS only — bypassing the count here without also revisiting that
--     label would show an org-wide number under a personal-sounding label,
--     so this is left as the safer no-op pending an explicit call on it.
--
-- CREATE OR REPLACE cannot change a function's argument list — the existing
-- single-arg get_renewals_overview(uuid) must be dropped first (same
-- requirement documented in migrations 0014/0017).
drop function if exists get_renewals_overview(uuid);

create or replace function get_renewals_overview(p_crm_person_id uuid default null, p_full_access boolean default false)
returns json
language sql
stable
as $$
  with category_outstanding as (
    select cust.category, sum(los.grand_total) as total
    from crm_customers cust
    join latest_outstanding_snapshots los on los.customer_id = cust.id
    where cust.category is not null
    and (p_crm_person_id is null or p_full_access or cust.assigned_crm_person_id = p_crm_person_id)
    group by cust.category
  ),
  monthly_recovery as (
    select to_char(os.snapshot_date, 'YYYY-MM') as month, sum(coalesce(os.recovered_amount, 0)) as recovered
    from outstanding_snapshots os
    join crm_customers cust on cust.id = os.customer_id
    where p_crm_person_id is null or p_full_access or cust.assigned_crm_person_id = p_crm_person_id
    group by to_char(os.snapshot_date, 'YYYY-MM')
  ),
  status_counts as (
    select coalesce(crm_status, 'Not Set') as status, count(*) as count
    from crm_customers
    where p_crm_person_id is null or p_full_access or assigned_crm_person_id = p_crm_person_id
    group by coalesce(crm_status, 'Not Set')
  ),
  -- Per active-calling, active-BALANCE customer: how many calls were
  -- expected vs actually logged in the last 30 days, given their category's
  -- calling_frequency. Unchanged from 0017 — feeds team_performance's
  -- compliance_pct, which stays personal-scoped regardless of p_full_access.
  customer_compliance as (
    select
      cust.id as customer_id,
      cust.assigned_crm_person_id,
      case cust.calling_frequency
        when 'Once a Week' then 30.0 / 7
        when 'Twice a Week' then 30.0 / 3.5
        when 'Thrice a Week' then 30.0 / 2.33
        else 30.0 / 7
      end as expected_calls,
      (
        select count(*) from collection_calls cc
        where cc.customer_id = cust.id and cc.call_date >= current_date - 30
      ) as actual_calls
    from crm_customers cust
    join latest_outstanding_snapshots los on los.customer_id = cust.id and los.grand_total > 0
    where cust.is_active_calling = true
    and cust.assigned_crm_person_id is not null
  ),
  team_performance as (
    select
      cp.id as person_id,
      cp.name as person_name,
      count(distinct case when los2.grand_total > 0 then cust.id end) as customers_assigned,
      coalesce((
        select count(*) from collection_calls cc
        where cc.called_by = cp.id and cc.connected = true and cc.call_date >= current_date - 30
      ), 0) as calls_connected_30d,
      coalesce((
        select count(*) from collection_calls cc
        where cc.called_by = cp.id and cc.connected = false and cc.call_date >= current_date - 30
      ), 0) as calls_not_connected_30d,
      coalesce((
        select sum(amount_recovered) from collection_calls cc
        where cc.called_by = cp.id
        and date_trunc('month', cc.call_date) = date_trunc('month', current_date)
      ), 0) as recovered_this_month,
      coalesce((
        select round(avg(least(1.0, cc2.actual_calls / cc2.expected_calls)) * 100)
        from customer_compliance cc2
        where cc2.assigned_crm_person_id = cp.id
      ), 0) as compliance_pct
    from crm_persons cp
    left join crm_customers cust on cust.assigned_crm_person_id = cp.id
    left join latest_outstanding_snapshots los2 on los2.customer_id = cust.id
    where cp.is_active = true
    and (p_crm_person_id is null or cp.id = p_crm_person_id)
    group by cp.id, cp.name
    order by cp.name
  ),
  recent_activity as (
    select
      cc.call_date,
      cc.created_at,
      cust.billing_name as customer_name,
      cp.name as person_name,
      cc.connected,
      coalesce(cc.conversation_notes, cc.not_connected_reason) as note,
      cc.amount_recovered
    from collection_calls cc
    join crm_customers cust on cust.id = cc.customer_id
    join crm_persons cp on cp.id = cc.called_by
    where p_crm_person_id is null or p_full_access or cc.called_by = p_crm_person_id
    order by cc.created_at desc
    limit 20
  )
  select json_build_object(
    'financial', json_build_object(
      'total_outstanding', (
        select coalesce(sum(los.grand_total), 0)
        from latest_outstanding_snapshots los
        join crm_customers cust on cust.id = los.customer_id
        where p_crm_person_id is null or p_full_access or cust.assigned_crm_person_id = p_crm_person_id
      ),
      'outstanding_by_category', (select coalesce(json_object_agg(category, total), '{}'::json) from category_outstanding),
      'total_recovered_all_time', (
        select coalesce(sum(cc.amount_recovered), 0)
        from collection_calls cc
        join crm_customers cust on cust.id = cc.customer_id
        where p_crm_person_id is null or p_full_access or cust.assigned_crm_person_id = p_crm_person_id
      ),
      'total_recovered_this_month', (
        select coalesce(sum(cc.amount_recovered), 0)
        from collection_calls cc
        join crm_customers cust on cust.id = cc.customer_id
        where date_trunc('month', cc.call_date) = date_trunc('month', current_date)
        and (p_crm_person_id is null or p_full_access or cust.assigned_crm_person_id = p_crm_person_id)
      ),
      'monthly_recovery_trend', (select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json) from monthly_recovery m)
    ),
    'status_breakdown', (select coalesce(json_agg(row_to_json(s) order by s.count desc), '[]'::json) from status_counts s),
    'team_performance', (select coalesce(json_agg(row_to_json(t)), '[]'::json) from team_performance t),
    'operational_health', json_build_object(
      'unresolved_unmatched_count', case when p_crm_person_id is null or p_full_access then (select count(*) from unmatched_import_names where resolved = false) else null end,
      'unassigned_pool_count', case when p_crm_person_id is null then (select count(*) from crm_customers where assigned_crm_person_id is null) else null end,
      'never_called_count', (
        select count(*) from crm_customers cust
        join latest_outstanding_snapshots los on los.customer_id = cust.id and los.grand_total > 0
        where cust.is_active_calling = true
        and (p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id)
        and not exists (select 1 from collection_calls cc where cc.customer_id = cust.id)
      )
    ),
    'recent_activity', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from recent_activity r)
  );
$$;

-- ── Grant Suchit the flag ────────────────────────────────────────────────
update crm_persons
set full_data_access = true
where id = 'ff2f64fd-bd3e-488a-bc6e-d1b6c47c9aad'; -- suchit@adititracking.com, confirmed sole match
