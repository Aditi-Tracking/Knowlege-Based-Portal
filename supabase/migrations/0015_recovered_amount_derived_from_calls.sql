-- Reverses crm_customers.recovered_amount's data-flow direction. It used to
-- be the source of truth (manually inline-edited in the My Customers
-- table), with edits auto-logging a delta into collection_calls purely so
-- get_renewals_overview() had something to sum. That was backwards for a
-- number meant to represent "how much has actually been recovered, and
-- when" — collection_calls (one row per call, already date-stamped, already
-- what the Overview dashboard sums) is the natural source of truth instead.
--
-- From here on, crm_customers.recovered_amount is purely derived: always
-- equal to SUM(collection_calls.amount_recovered) for that customer, kept
-- in sync by the trigger below. The only way to affect it is logging a call
-- with an "Amount recovered" figure — there's no more direct-write path
-- (js/renewals.js's inline-edit UI for this column was removed).
--
-- Data check before writing this migration (2026, live project): both sides
-- are completely empty — 0 collection_calls rows exist at all, and every
-- crm_customers.recovered_amount is 0 (425 customers total, none nonzero).
-- So there is nothing to backfill; letting the trigger recompute everyone to
-- their real (currently zero) collection_calls sum is a no-op, not a data
-- loss. No synthetic "backfilled from prior manual entry" rows are created.
comment on column crm_customers.recovered_amount is
  'Derived — always equal to SUM(collection_calls.amount_recovered) for this customer, maintained by trg_sync_customer_recovered_amount. Not directly writable from the app anymore.';

create or replace function sync_customer_recovered_amount()
returns trigger
language plpgsql
as $$
begin
  -- INSERT/UPDATE: recompute the (new) row's customer.
  if tg_op in ('INSERT', 'UPDATE') then
    update crm_customers
    set recovered_amount = (
      select coalesce(sum(amount_recovered), 0)
      from collection_calls
      where customer_id = new.customer_id
    )
    where id = new.customer_id;
  end if;

  -- DELETE, or an UPDATE that moved the call to a different customer_id:
  -- the old customer's total needs recomputing too, or it'd be left
  -- including a call that no longer belongs to it.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id) then
    update crm_customers
    set recovered_amount = (
      select coalesce(sum(amount_recovered), 0)
      from collection_calls
      where customer_id = old.customer_id
    )
    where id = old.customer_id;
  end if;

  return null; -- AFTER trigger — return value is ignored either way
end;
$$;

drop trigger if exists collection_calls_sync_recovered_amount on collection_calls;
create trigger collection_calls_sync_recovered_amount
after insert or update or delete on collection_calls
for each row execute function sync_customer_recovered_amount();
