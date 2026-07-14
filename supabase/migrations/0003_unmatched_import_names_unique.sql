-- Prevents duplicate rows when a webhook retry (or manual re-run) reprocesses
-- the same file: parse-outstanding now upserts on this constraint instead of
-- plain-inserting.
alter table unmatched_import_names
  add constraint uq_unmatched_raw_name_batch_date unique (raw_name, import_batch_date);
