-- Revises the earlier 0020 design decision: a full_data_access CRM person
-- (e.g. Suchit) now sees the FULL peer Team Performance comparison table,
-- same as MIS, instead of just their own personal scorecard. Overrides only
-- this one section — Financial/Status/Recent Activity stay org-wide (already
-- true since 0020) and never_called_count/its "Your Never-Called Customers"
-- label stay personal-only (unchanged, not part of this revision).
--
-- Only the team_performance CTE's WHERE clause changes from 0020: adding
-- `p_full_access` to the same bypass condition already used by every other
-- org-wide section. Nothing else in the function body differs.
--
-- No RLS changes needed here — crm_view_own_customers/crm_view_own_snapshots/
-- crm_view_own_calls already OR in is_full_access_crm_person() (migration
-- 0020), which is what lets this CTE actually read every other person's
-- crm_customers/outstanding_snapshots/collection_calls rows once it's asked
-- to. This migration only changes which rows the CTE ASKS for.
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
  -- CHANGED from 0020: added `p_full_access` to this CTE's own condition —
  -- this is the one and only change in this migration. Every other CTE/
  -- section above and below is copied verbatim from 0020.
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
    and (p_crm_person_id is null or p_full_access or cp.id = p_crm_person_id)
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
