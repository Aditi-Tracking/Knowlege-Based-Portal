-- Powers the Overview tab (MIS-only in the UI). Deliberately one SQL function
-- doing the aggregation server-side rather than pulling raw rows into the
-- browser and reducing client-side — PostgREST has no GROUP BY query param,
-- and this keeps the multi-metric aggregation correct and to one round trip.
--
-- No SECURITY DEFINER here (unlike is_mis()/is_own_assigned_person()): this
-- function only aggregates tables that already grant MIS full access via
-- existing mis_full_access_* policies, so plain invoker semantics already
-- give an MIS caller the correct global numbers. A non-MIS caller would just
-- see partial/empty aggregates reflecting their own restricted RLS view —
-- not a privilege escalation, just not meaningful, consistent with this
-- being wired only into the MIS-only Overview tab.
create or replace function get_renewals_overview()
returns json
language sql
stable
as $$
  select json_build_object(
    'total_outstanding', (
      select coalesce(sum(grand_total), 0) from latest_outstanding_snapshots
    ),
    'total_recovered_this_month', (
      select coalesce(sum(amount_recovered), 0)
      from collection_calls
      where date_trunc('month', call_date) = date_trunc('month', current_date)
    ),
    'unresolved_unmatched_count', (
      select count(*) from unmatched_import_names where resolved = false
    ),
    'aging_buckets', (
      select json_build_object(
        'bucket_0_30', coalesce(sum(bucket_0_30), 0),
        'bucket_31_60', coalesce(sum(bucket_31_60), 0),
        'bucket_61_90', coalesce(sum(bucket_61_90), 0),
        'bucket_above_90', coalesce(sum(bucket_above_90), 0)
      )
      from latest_outstanding_snapshots
    ),
    'per_person_breakdown', (
      select coalesce(json_agg(row_to_json(p)), '[]'::json)
      from (
        select
          cp.id as person_id,
          cp.name as person_name,
          count(distinct cust.id) as customer_count,
          coalesce((
            select count(*) from collection_calls
            where called_by = cp.id and call_date = current_date
          ), 0) as calls_today,
          coalesce((
            select sum(amount_recovered) from collection_calls
            where called_by = cp.id
            and date_trunc('month', call_date) = date_trunc('month', current_date)
          ), 0) as recovered_this_month
        from crm_persons cp
        left join crm_customers cust on cust.assigned_crm_person_id = cp.id
        where cp.is_active = true
        group by cp.id, cp.name
        order by cp.name
      ) p
    ),
    'needs_attention', (
      select coalesce(json_agg(row_to_json(n)), '[]'::json)
      from (
        select
          cust.id as customer_id,
          cust.billing_name,
          los.grand_total,
          lcc.call_date as last_call_date
        from crm_customers cust
        join latest_outstanding_snapshots los on los.customer_id = cust.id
        left join latest_collection_calls lcc on lcc.customer_id = cust.id
        where los.is_closed = false
        and (lcc.call_date is null or lcc.call_date < current_date - 7)
        order by los.grand_total desc
        limit 10
      ) n
    )
  );
$$;
