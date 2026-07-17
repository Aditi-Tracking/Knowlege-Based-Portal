-- Resolves an unmatched_import_names row by creating a new crm_customers record
-- for it. Runs as one transaction so a partial failure can't leave an orphaned
-- customer with no alias/snapshot. Row-locks the unmatched row and bails out if
-- it's already resolved, so a double-click or client retry can't create duplicates.
create or replace function resolve_unmatched_customer(
  p_unmatched_id uuid,
  p_person_id uuid,
  p_category text
) returns uuid
language plpgsql
as $$
declare
  v_unmatched unmatched_import_names%rowtype;
  v_calling_frequency text;
  v_customer_id uuid;
begin
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
