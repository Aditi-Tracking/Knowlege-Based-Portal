-- Prevents duplicate snapshot rows for the same customer on the same date
-- (needed so parse-outstanding can safely upsert on webhook retries / same-day reprocessing).
alter table outstanding_snapshots
  add constraint uq_snapshot_customer_date unique (customer_id, snapshot_date);
