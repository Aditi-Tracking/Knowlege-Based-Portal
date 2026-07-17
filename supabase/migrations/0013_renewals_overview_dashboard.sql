-- Rewrites get_renewals_overview() to power the Overview tab (Stage 4) —
-- previously defined (migration 0009) but never wired to any UI, so this
-- freely replaces its shape rather than layering onto it. Same
-- language/stability/invoker-security posture as before (no consumer has
-- ever depended on a stricter model, so none is introduced here).
--
-- Two distinct "recovered" figures are kept deliberately separate, not
-- combined:
--   - collection_calls.amount_recovered (CRM-self-reported, per call/edit)
--     powers total_recovered_this_month/all_time.
--   - outstanding_snapshots.recovered_amount (set by the parse-outstanding
--     Edge Function as max(0, previous_grand_total - new_grand_total) on
--     each Excel import — accounting-driven) powers monthly_recovery_trend.
-- Summing them would double-count the same real-world payment if a CRM
-- person also logged it manually.
--
-- crm_category_rules is NOT used here — it has no frequency columns and is
-- empty; calling_frequency lives on crm_customers itself (already populated:
-- Platinum/Once a Week, Gold/Twice a Week, Silver/Thrice a Week).
create or replace function get_renewals_overview()
returns json
language sql
stable
as $$
  with category_outstanding as (
    select cust.category, sum(los.grand_total) as total
    from crm_customers cust
    join latest_outstanding_snapshots los on los.customer_id = cust.id
    where cust.category is not null
    group by cust.category
  ),
  monthly_recovery as (
    select to_char(snapshot_date, 'YYYY-MM') as month, sum(coalesce(recovered_amount, 0)) as recovered
    from outstanding_snapshots
    group by to_char(snapshot_date, 'YYYY-MM')
  ),
  status_counts as (
    select coalesce(crm_status, 'Not Set') as status, count(*) as count
    from crm_customers
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
    order by cc.created_at desc
    limit 20
  )
  select json_build_object(
    'financial', json_build_object(
      'total_outstanding', (select coalesce(sum(grand_total), 0) from latest_outstanding_snapshots),
      'outstanding_by_category', (select coalesce(json_object_agg(category, total), '{}'::json) from category_outstanding),
      'total_recovered_all_time', (select coalesce(sum(amount_recovered), 0) from collection_calls),
      'total_recovered_this_month', (
        select coalesce(sum(amount_recovered), 0)
        from collection_calls
        where date_trunc('month', call_date) = date_trunc('month', current_date)
      ),
      'monthly_recovery_trend', (select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json) from monthly_recovery m)
    ),
    'status_breakdown', (select coalesce(json_agg(row_to_json(s) order by s.count desc), '[]'::json) from status_counts s),
    'team_performance', (select coalesce(json_agg(row_to_json(t)), '[]'::json) from team_performance t),
    'operational_health', json_build_object(
      'unresolved_unmatched_count', (select count(*) from unmatched_import_names where resolved = false),
      'unassigned_pool_count', (select count(*) from crm_customers where assigned_crm_person_id is null),
      'never_called_count', (
        select count(*) from crm_customers cust
        where cust.is_active_calling = true
        and not exists (select 1 from collection_calls cc where cc.customer_id = cust.id)
      )
    ),
    'recent_activity', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from recent_activity r)
  );
$$;
