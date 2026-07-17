-- Persistent, reviewable record of which customers got auto-closed
-- (grand_total:0, is_closed:true, recovered_amount:<their prior balance>) in
-- which import — that behavior itself is unchanged, this just stops the "N
-- closed" count from being a one-time, unreviewable number shown only once
-- right after upload. One row per customer closed in a given import_jobs run.
--
-- billing_name is deliberately denormalized (not just joined live off
-- crm_customers at read time) — a review of what happened during a past
-- import should show what the customer was called at closure time, not
-- whatever crm_customers.billing_name has since been edited to.
create table import_job_closures (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  customer_id uuid not null references crm_customers(id),
  billing_name text not null,
  prev_grand_total numeric not null,
  closed_at timestamptz not null default now()
);

alter table import_job_closures enable row level security;

-- Same MIS-only shape as import_jobs itself (mis_full_access_import_jobs) —
-- consistent, since the Upload tab where this surfaces is already MIS-only.
create policy "mis_full_access_import_job_closures" on import_job_closures
  for all to public
  using (is_mis());
