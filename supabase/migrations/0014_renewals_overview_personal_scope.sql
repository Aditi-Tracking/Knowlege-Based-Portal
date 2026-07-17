-- Adds an optional p_crm_person_id parameter to get_renewals_overview() so a
-- CRM person can now see their own scoped Overview tab (previously
-- MIS/owner-only). Kept as one function rather than a second RPC — the
-- scoped and unscoped bodies share almost everything; a parallel function
-- would just drift out of sync over time.
--
-- p_crm_person_id is left as-is (default null) when called by MIS/owner —
-- that reproduces the exact previous org-wide behaviour, untouched.
--
-- Scoping is applied explicitly in SQL rather than left to RLS. This
-- function is SECURITY INVOKER (unchanged) and crm_persons has an
-- intentionally unrestricted SELECT policy (everyone_can_view_persons,
-- needed by the Reassign dropdown) — so without an explicit filter,
-- team_performance would still enumerate every active person's name for a
-- CRM person's own session, with RLS silently zeroing out every peer's
-- stats (their crm_customers/collection_calls rows aren't visible to the
-- caller). That reads as broken data (everyone's name, blank stats), not a
-- clean personal view, so this function filters team_performance down to
-- just the calling person's own row itself when scoped.
--
-- Two different scoping bases are used deliberately, matching what each
-- section is actually about:
--   - financial / status_breakdown / monthly_recovery_trend: scoped by
--     customer ASSIGNMENT (cust.assigned_crm_person_id) — these sections
--     are about "my book of customers".
--   - team_performance / recent_activity: scoped by CALLED_BY — these
--     sections are about "my own logged calling activity". The two
--     normally coincide (RLS already prevents a CRM person from logging
--     calls against customers not assigned to them) but could diverge if a
--     customer was reassigned away after calls were already logged against
--     it, so the distinction is kept precise rather than collapsed.
--
-- operational_health's unresolved_unmatched_count / unassigned_pool_count
-- are org-wide, not-actionable-by-a-CRM-person concepts (matches
-- Unassigned Pool being MIS-only already) — they come back null when
-- scoped, rather than a real number a CRM person has no use for and no
-- business seeing. never_called_count stays, scoped to the caller's own
-- customers ("your never-called customers").
--
-- CREATE OR REPLACE cannot change a function's argument list — the existing
-- zero-arg get_renewals_overview() must be dropped first, otherwise this
-- would create a second, overloaded function alongside it (and PostgREST's
-- RPC dispatch would then have two candidates to choose between for calls
-- that pass no arguments).
drop function if exists get_renewals_overview();

create or replace function get_renewals_overview(p_crm_person_id uuid default null)
returns json
language sql
stable
as $$
  with category_outstanding as (
    select cust.category, sum(los.grand_total) as total
    from crm_customers cust
    join latest_outstanding_snapshots los on los.customer_id = cust.id
    where cust.category is not null
    and (p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id)
    group by cust.category
  ),
  monthly_recovery as (
    select to_char(os.snapshot_date, 'YYYY-MM') as month, sum(coalesce(os.recovered_amount, 0)) as recovered
    from outstanding_snapshots os
    join crm_customers cust on cust.id = os.customer_id
    where p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id
    group by to_char(os.snapshot_date, 'YYYY-MM')
  ),
  status_counts as (
    select coalesce(crm_status, 'Not Set') as status, count(*) as count
    from crm_customers
    where p_crm_person_id is null or assigned_crm_person_id = p_crm_person_id
    group by coalesce(crm_status, 'Not Set')
  ),
  -- Per active-calling customer: how many calls were expected vs actually
  -- logged in the last 30 days, given their category's calling_frequency.
  -- 30 / interval-between-calls-in-days approximates "expected call count".
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
    where cust.is_active_calling = true
    and cust.assigned_crm_person_id is not null
  ),
  team_performance as (
    select
      cp.id as person_id,
      cp.name as person_name,
      count(distinct cust.id) as customers_assigned,
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
    where p_crm_person_id is null or cc.called_by = p_crm_person_id
    order by cc.created_at desc
    limit 20
  )
  select json_build_object(
    'financial', json_build_object(
      'total_outstanding', (
        select coalesce(sum(los.grand_total), 0)
        from latest_outstanding_snapshots los
        join crm_customers cust on cust.id = los.customer_id
        where p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id
      ),
      'outstanding_by_category', (select coalesce(json_object_agg(category, total), '{}'::json) from category_outstanding),
      'total_recovered_all_time', (
        select coalesce(sum(cc.amount_recovered), 0)
        from collection_calls cc
        join crm_customers cust on cust.id = cc.customer_id
        where p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id
      ),
      'total_recovered_this_month', (
        select coalesce(sum(cc.amount_recovered), 0)
        from collection_calls cc
        join crm_customers cust on cust.id = cc.customer_id
        where date_trunc('month', cc.call_date) = date_trunc('month', current_date)
        and (p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id)
      ),
      'monthly_recovery_trend', (select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json) from monthly_recovery m)
    ),
    'status_breakdown', (select coalesce(json_agg(row_to_json(s) order by s.count desc), '[]'::json) from status_counts s),
    'team_performance', (select coalesce(json_agg(row_to_json(t)), '[]'::json) from team_performance t),
    'operational_health', json_build_object(
      'unresolved_unmatched_count', case when p_crm_person_id is null then (select count(*) from unmatched_import_names where resolved = false) else null end,
      'unassigned_pool_count', case when p_crm_person_id is null then (select count(*) from crm_customers where assigned_crm_person_id is null) else null end,
      'never_called_count', (
        select count(*) from crm_customers cust
        where cust.is_active_calling = true
        and (p_crm_person_id is null or cust.assigned_crm_person_id = p_crm_person_id)
        and not exists (select 1 from collection_calls cc where cc.customer_id = cust.id)
      )
    ),
    'recent_activity', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from recent_activity r)
  );
$$;
