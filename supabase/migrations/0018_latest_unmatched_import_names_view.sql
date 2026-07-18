-- Resolve Unmatched was showing one row per (raw_name, import_batch_date) —
-- meaning a raw name still unresolved from a prior month's upload gets a
-- brand new row (new batch date) each time it reappears in a later file,
-- rather than updating the existing pending entry. Over months, the same
-- still-unresolved customer would accumulate multiple stale duplicate rows.
--
-- Fix is display-side, not a schema/upsert change: this view picks only the
-- most recent still-unresolved row per raw_name. Same DISTINCT ON idiom as
-- latest_outstanding_snapshots/latest_collection_calls (migration 0008).
-- Older duplicate rows for the same raw_name stay in the table (not deleted)
-- but are no longer shown/actionable — js/renewals.js's ruAssign()/ruIgnore()
-- now also resolve every row sharing that raw_name, not just the displayed
-- one, so those older rows don't linger as orphaned unresolved entries.
create view latest_unmatched_import_names
with (security_invoker = true) as
select distinct on (raw_name) *
from unmatched_import_names
where resolved = false
order by raw_name, import_batch_date desc;
