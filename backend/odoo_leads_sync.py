"""
Odoo CRM leads sync -> Supabase leads_unified (source_system='odoo').

Ongoing, incremental sync. Designed to run as a Railway Cron Job (see
deployment notes) — not a persistent loop like smartfleet_sync.py, since
this workload has no live-data or time-of-day requirement and is fully
stateless between runs (all state lives in the `sync_state` table).

SCOPE — hard floor, applies to the first run too:
    Only crm.lead records with create_date >= ODOO_LEADS_START_DATE are ever
    pulled. Older leads are permanently excluded, not just skipped on later
    runs.

NO 'status' COLUMN — leads_unified doesn't have one. Won/Lost/Pending are
derived at query time from stage_name + is_active:
    Won:     stage_name = 'Won'                (both sources)
    Lost:    (sheets) stage_name = 'Lost'  |  (odoo) is_active = false
    Pending: (odoo only) is_active = true AND stage_name != 'Won'
This script's only responsibility is writing stage_name and is_active
accurately — it does not compute or write any won/lost/status value itself.

WON DETECTION (odoo) — driven by crm.stage.is_won, not by name-matching.
Some pipelines have more than one stage that counts as won (e.g. a repeat-
business stage) which isn't literally named "Won". Any stage flagged
is_won=True in Odoo has its stage_name normalized to the literal string
"Won" when written here, so stage_name = 'Won' stays a reliable filter
for every consumer of this table regardless of how many won-type stages
exist in Odoo.

Required env vars (never hardcode):
    ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY
    SUPABASE_URL, SUPABASE_KEY   (service_role key — bypasses RLS for writes)
"""
import os
import sys
import xmlrpc.client
from datetime import datetime, timezone
from supabase import create_client

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ODOO_URL      = os.environ.get("ODOO_URL", "").rstrip("/")
ODOO_DB       = os.environ.get("ODOO_DB", "")
ODOO_USERNAME = os.environ.get("ODOO_USERNAME", "")
ODOO_API_KEY  = os.environ.get("ODOO_API_KEY", "")
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY  = os.environ.get("SUPABASE_KEY", "")

# Hard floor — leads created before this are never pulled, first run included.
# Expressed in UTC, but chosen to equal midnight IST (UTC+5:30) on 2026-06-01,
# not midnight UTC — Odoo's own UI groups/displays creation dates in the
# browser's local timezone (IST here), so a UTC-midnight floor silently
# excludes leads created between 12:00-5:30 AM IST on the 1st (their UTC
# create_date still reads as the prior day).
ODOO_LEADS_START_DATE = "2026-05-31 18:30:00"
JOB_NAME = "odoo_leads_sync"
BATCH = 500

if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, SUPABASE_URL, SUPABASE_KEY]):
    raise SystemExit(
        "Missing one or more required env vars: ODOO_URL, ODOO_DB, ODOO_USERNAME, "
        "ODOO_API_KEY, SUPABASE_URL, SUPABASE_KEY"
    )

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
if not uid:
    raise SystemExit("Odoo authentication failed — check ODOO_DB / ODOO_USERNAME / ODOO_API_KEY")

models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")


def execute(model, method, *args, **kwargs):
    """NOTE: this helper already wraps *args in a list before sending — pass
    domain/fields as a single list, do NOT double-wrap (e.g. domain=[] not
    [[]]), or Odoo's domain validator will reject it. Cost us a debugging
    round-trip during Phase 1 discovery — documenting here so it doesn't
    happen again."""
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)


def m2o_id(v):
    """[id, 'Display Name'] tuple -> id, or None if False/empty."""
    return v[0] if isinstance(v, (list, tuple)) and v else None


def m2o_name(v):
    """[id, 'Display Name'] tuple -> name, or None if False/empty."""
    return v[1] if isinstance(v, (list, tuple)) and len(v) > 1 else None


def to_odoo_datetime_str(value):
    """Odoo XML-RPC domain filters require naive 'YYYY-MM-DD HH:MM:SS'
    strings — no 'T' separator, no timezone offset, no microseconds. Odoo
    treats naive datetimes as UTC, so any tz-aware value must be converted
    to UTC before the tzinfo is dropped. Supabase returns timestamptz
    columns (like sync_state.last_synced_at) as ISO strings with a '+00:00'
    offset, which Odoo's domain validator rejects outright."""
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def get_last_synced_at():
    res = supabase.table("sync_state").select("last_synced_at").eq("job_name", JOB_NAME).execute()
    if res.data:
        return res.data[0]["last_synced_at"]
    return None


def set_last_synced_at(ts_iso):
    supabase.table("sync_state").upsert(
        {"job_name": JOB_NAME, "last_synced_at": ts_iso}, on_conflict="job_name"
    ).execute()


def fetch_stage_sequence_map():
    """crm.stage id -> sequence, plus the 'Demo' stage's own sequence
    (looked up by name, never hardcoded — stages can get reordered), plus
    crm.stage id -> is_won so won-detection doesn't rely on stage naming."""
    stages = execute("crm.stage", "search_read", [], fields=["id", "name", "sequence", "is_won"])
    seq_map = {s["id"]: s["sequence"] for s in stages}
    won_map = {s["id"]: bool(s.get("is_won")) for s in stages}
    won_stage_names = [s["name"] for s in stages if s.get("is_won")]
    print(f"Won-flagged stage(s): {won_stage_names}")
    demo_stage = next((s for s in stages if s["name"].strip().lower() == "demo"), None)
    if not demo_stage:
        print("WARNING: no stage literally named 'Demo' found in this Odoo instance — "
              "demo_given will be False for every Odoo row this run.")
        return seq_map, None, won_map
    print(f"Demo stage: id={demo_stage['id']} sequence={demo_stage['sequence']}")
    return seq_map, demo_stage["sequence"], won_map


def fetch_user_emails(user_ids):
    if not user_ids:
        return {}
    users = execute("res.users", "read", list(user_ids), fields=["login", "email"])
    return {u["id"]: (u.get("email") or u.get("login") or None) for u in users}


def fetch_won_revenue_map(won_lead_ids):
    """Bulk fetch confirmed sale orders (state in sale/done — drafts excluded)
    for the given Won leads, sum amount_total per lead. One query, not N."""
    if not won_lead_ids:
        return {}
    orders = execute(
        "sale.order", "search_read",
        [("opportunity_id", "in", list(won_lead_ids)), ("state", "in", ("sale", "done"))],
        fields=["opportunity_id", "amount_total"]
    )
    revenue_map = {}
    for o in orders:
        lead_id = m2o_id(o.get("opportunity_id"))
        if lead_id is None:
            continue
        revenue_map[lead_id] = revenue_map.get(lead_id, 0.0) + (o.get("amount_total") or 0.0)
    return revenue_map


def map_lead(lead, stage_seq_map, demo_seq, user_email_map, revenue_map, won_map):
    stage_id = m2o_id(lead.get("stage_id"))
    stage_name_raw = m2o_name(lead.get("stage_id"))
    is_won = won_map.get(stage_id, False) if stage_id is not None else False
    # Normalize any won-flagged stage to the literal 'Won' so stage_name = 'Won'
    # stays a complete filter downstream, regardless of the stage's real name.
    stage_name = "Won" if is_won else stage_name_raw

    demo_given = False
    if demo_seq is not None and stage_id is not None:
        lead_seq = stage_seq_map.get(stage_id)
        if lead_seq is not None:
            demo_given = lead_seq >= demo_seq

    user_id = m2o_id(lead.get("user_id"))

    return {
        "source_system":     "odoo",
        "source_record_id":  str(lead["id"]),
        "lead_name":         lead.get("name") or None,
        "contact_name":      lead.get("contact_name") or lead.get("partner_name") or None,
        "phone":             lead.get("phone") or None,
        "email":             lead.get("email_from") or None,
        "stage_name":        stage_name,
        "lead_quality":      None,   # no Odoo equivalent found — never fabricated
        "salesperson_name":  m2o_name(lead.get("user_id")),
        "salesperson_email": user_email_map.get(user_id) if user_id is not None else None,
        "team_name":         m2o_name(lead.get("team_id")),
        "source_channel":    m2o_name(lead.get("source_id")),
        "product_line":      None,   # flagged — no clean Odoo equivalent, see chat
        "hero_product":      m2o_name(lead.get("x_studio_product_name_1")) or m2o_name(lead.get("x_studio_product_name_3")),
        "city":              lead.get("city") or None,
        "lead_created_at":   lead.get("create_date") or None,
        "lead_updated_at":   lead.get("write_date") or None,
        "demo_given":        demo_given,
        "quotation_sent":    (lead.get("quotation_count") or 0) > 0,
        "calls_made":        (lead.get("no_of_calls_done") or 0) > 0 or (lead.get("no_of_calls_missed") or 0) > 0,
        "order_value":       None,   # Odoo uses won_revenue instead, per confirmed decision
        "won_revenue":       revenue_map.get(lead["id"]) if is_won else None,
        "stage_id":          stage_id,
        "user_id":           user_id,
        "team_id":           m2o_id(lead.get("team_id")),
        "source_id":         m2o_id(lead.get("source_id")),
        "medium_id":         m2o_id(lead.get("medium_id")),
        "campaign_id":       m2o_id(lead.get("campaign_id")),
        "probability":       lead.get("probability"),
        "activity_state":    lead.get("activity_state") or None,
        "activity_date_deadline": lead.get("activity_date_deadline") or None,
        "lost_reason_name":  m2o_name(lead.get("lost_reason_id")),
        "is_active":         bool(lead.get("active")),
    }


def main():
    print("=" * 70)
    print(f"ODOO LEADS SYNC — job={JOB_NAME}")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 70)

    run_started_at = datetime.now(timezone.utc).isoformat()

    # Both dates must be naive 'YYYY-MM-DD HH:MM:SS' before hitting Odoo's
    # domain validator — ODOO_LEADS_START_DATE already is, but is routed
    # through the same helper as a safety net against future edits.
    create_date_floor = to_odoo_datetime_str(ODOO_LEADS_START_DATE)

    last_synced_at = get_last_synced_at()
    if last_synced_at:
        write_date_floor = to_odoo_datetime_str(last_synced_at)
        print(f"Incremental run — last synced at {last_synced_at} (odoo filter: write_date >= {write_date_floor})")
        domain = ["&", ("create_date", ">=", create_date_floor), ("write_date", ">=", write_date_floor)]
    else:
        print(f"FIRST RUN for this job — pulling all leads created >= {create_date_floor} (no upper bound).")
        domain = [("create_date", ">=", create_date_floor)]
    print(f"Domain: {domain}")

    try:
        # context active_test=False is required — otherwise Odoo silently
        # excludes archived/lost (active=False) leads from the result.
        leads = execute("crm.lead", "search_read", domain, context={"active_test": False})
    except Exception as e:
        print(f"ERROR: crm.lead fetch failed: {e}")
        sys.exit(1)

    print(f"Fetched {len(leads)} lead(s) from Odoo.")
    if not leads:
        print("Nothing to sync this run.")
        set_last_synced_at(run_started_at)
        return

    stage_seq_map, demo_seq, won_map = fetch_stage_sequence_map()

    user_ids = {m2o_id(l.get("user_id")) for l in leads if m2o_id(l.get("user_id")) is not None}
    user_email_map = fetch_user_emails(user_ids)

    won_lead_ids = [l["id"] for l in leads if won_map.get(m2o_id(l.get("stage_id")), False)]
    revenue_map = fetch_won_revenue_map(won_lead_ids)

    mapped = [map_lead(l, stage_seq_map, demo_seq, user_email_map, revenue_map, won_map) for l in leads]

    inserted = 0
    errors = []
    for start in range(0, len(mapped), BATCH):
        chunk = mapped[start:start + BATCH]
        try:
            res = supabase.table("leads_unified").upsert(
                chunk, on_conflict="source_system,source_record_id"
            ).execute()
            inserted += len(res.data or [])
            print(f"  upserted {start+1}-{start+len(chunk)} ({len(res.data or [])} confirmed)")
        except Exception as e:
            errors.append((start, str(e)))
            print(f"  ERROR: batch {start+1}-{start+len(chunk)} failed: {e}")

    print("\n" + "=" * 70)
    print("SYNC SUMMARY")
    print("=" * 70)
    print(f"Leads fetched:   {len(leads)}")
    print(f"Leads upserted:  {inserted}")
    print(f"Batch errors:    {len(errors)}")
    won_count = sum(1 for m in mapped if m["stage_name"] == "Won")
    lost_count = sum(1 for m in mapped if not m["is_active"])
    pending_count = len(mapped) - won_count - lost_count
    print(f"Won (stage_name='Won'):       {won_count}")
    print(f"Lost (is_active=false):       {lost_count}")
    print(f"Pending (active, not Won):    {pending_count}")

    if not errors:
        set_last_synced_at(run_started_at)
        print(f"\nsync_state updated: last_synced_at = {run_started_at}")
    else:
        print(f"\n{len(errors)} batch error(s) occurred — NOT updating sync_state, "
              f"so the next run will retry this same window instead of skipping it.")


if __name__ == "__main__":
    main()
