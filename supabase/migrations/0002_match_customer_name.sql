-- Matches a raw billing name (as it appears in an Accounts export) to a crm_customers.id
-- via customer_name_aliases: exact match first, then pg_trgm similarity fallback.
create or replace function match_customer_name(input_name text)
returns uuid
language plpgsql
stable
as $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id
  from customer_name_aliases
  where lower(trim(raw_name)) = lower(trim(input_name))
  limit 1;

  if v_customer_id is not null then
    return v_customer_id;
  end if;

  select customer_id into v_customer_id
  from customer_name_aliases
  where similarity(lower(trim(raw_name)), lower(trim(input_name))) > 0.6
  order by similarity(lower(trim(raw_name)), lower(trim(input_name))) desc
  limit 1;

  return v_customer_id;
end;
$$;
