-- Adds two CRM-editable fields to crm_customers, surfaced as optional
-- columns in the My Customers table (Renewals & Collections).
--
-- crm_status is deliberately a NEW column, not a reuse of the existing
-- `status` column — that one already tracks an internal active/inactive
-- lifecycle (see resolve_unmatched_customer, which sets it to 'active').
-- crm_status is a separate, CRM-editable tag matching the "SCOT Sheet"
-- Google Sheet's status list, shown as a colored pill in the UI.
--
-- recovered_amount is a single running total a CRM person can correct by
-- hand from the table. It is intentionally independent of (not derived
-- from or reconciled with) collection_calls.amount_recovered, which is the
-- per-call log already summed by get_renewals_overview() for the "recovered
-- this month" stat — these are two different figures serving two different
-- purposes, not a duplicate. "Current Outstanding" (grand_total minus this
-- column) is NOT stored anywhere — it's cheap to derive from
-- latest_outstanding_snapshots.grand_total and this column, so it's computed
-- client-side to avoid a derived column going stale. If the still-pending
-- Overview (Stage 4) needs an aggregate net-outstanding figure, it can sum
-- both source columns in SQL rather than reading a stored per-row value.
alter table crm_customers
  add column if not exists crm_status text,
  add column if not exists recovered_amount numeric not null default 0;

alter table crm_customers
  drop constraint if exists crm_customers_crm_status_check;
alter table crm_customers
  add constraint crm_customers_crm_status_check
  check (crm_status is null or crm_status in (
    'Payment Recieved', 'Deactivated', 'Patch', 'Shared Details', 'Inactive', 'Partial Payment'
  ));

alter table crm_customers
  add constraint crm_customers_recovered_amount_check
  check (recovered_amount >= 0);

comment on column crm_customers.crm_status is
  'CRM-editable status tag (SCOT-sheet style, shown as a colored pill) — distinct from the internal active/inactive `status` column.';
comment on column crm_customers.recovered_amount is
  'Manually-entered running total recovered from this customer, edited inline by CRM users. Independent of collection_calls.amount_recovered (the per-call log used for Overview reporting).';
