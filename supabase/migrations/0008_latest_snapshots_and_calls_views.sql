-- "Latest per customer" views, reused across the My Customers, Unassigned
-- Pool, and Overview tabs instead of duplicating this reduction in JS three
-- times. security_invoker ensures each view is evaluated under the querying
-- user's own RLS, not the view owner's — without it, Postgres's older
-- (pre-15) default view-permission behavior can silently diverge from what
-- the caller is actually allowed to see.
--
-- Known gap, not addressed here: outstanding_snapshots and collection_calls
-- currently only have MIS-only RLS policies (mis_full_access_snapshots has
-- no non-MIS SELECT policy, and collection_calls has none at all yet). These
-- views will return empty results for non-MIS callers until a later
-- migration (part of the My Customers tab build) adds a policy scoping
-- access to a CRM person's own assigned customers — intentionally deferred
-- since that policy's exact shape belongs with that tab's design, not here.

create view latest_outstanding_snapshots
with (security_invoker = true) as
select distinct on (customer_id) *
from outstanding_snapshots
order by customer_id, snapshot_date desc;

create view latest_collection_calls
with (security_invoker = true) as
select distinct on (customer_id) *
from collection_calls
order by customer_id, call_date desc, created_at desc;
