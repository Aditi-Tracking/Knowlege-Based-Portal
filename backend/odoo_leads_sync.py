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
ODOO_LEADS_START_DATE = "2026-06-01 00:00:00"
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
    (looked up by name, never hardcoded — stages can get reordered)."""
    stages = execute("crm.stage", "search_read", [], fields=["id", "name", "sequence"])
    seq_map = {s["id"]: s["sequence"] for s in stages}
    demo_stage = next((s for s in stages if s["name"].strip().lower() == "demo"), None)
    if not demo_stage:
        print("WARNING: no stage literally named 'Demo' found in this Odoo instance — "
              "demo_given will be False for every Odoo row this run.")
        return seq_map, None
    print(f"Demo stage: id={demo_stage['id']} sequence={demo_stage['sequence']}")
    return seq_map, demo_stage["sequence"]


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


def map_lead(lead, stage_seq_map, demo_seq, user_email_map, revenue_map):
    stage_id = m2o_id(lead.get("stage_id"))
    stage_name = m2o_name(lead.get("stage_id"))
    is_won = (stage_name or "").strip() == "Won"

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

    last_synced_at = get_last_synced_at()
    if last_synced_at:
        print(f"Incremental run — last synced at {last_synced_at}")
        domain = ["&", ("create_date", ">=", ODOO_LEADS_START_DATE), ("write_date", ">=", last_synced_at)]
    else:
        print(f"FIRST RUN for this job — pulling all leads created >= {ODOO_LEADS_START_DATE} (no upper bound).")
        domain = [("create_date", ">=", ODOO_LEADS_START_DATE)]
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

    stage_seq_map, demo_seq = fetch_stage_sequence_map()

    user_ids = {m2o_id(l.get("user_id")) for l in leads if m2o_id(l.get("user_id")) is not None}
    user_email_map = fetch_user_emails(user_ids)

    won_lead_ids = [l["id"] for l in leads if m2o_name(l.get("stage_id")) == "Won"]
    revenue_map = fetch_won_revenue_map(won_lead_ids)

    mapped = [map_lead(l, stage_seq_map, demo_seq, user_email_map, revenue_map) for l in leads]

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
