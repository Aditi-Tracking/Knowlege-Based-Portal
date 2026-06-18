import requests, schedule, time, urllib3
from datetime import datetime, timezone, timedelta
from supabase import create_client
import os
try:
    import pytz
    IST = pytz.timezone('Asia/Kolkata')
    HAS_PYTZ = True
except ImportError:
    HAS_PYTZ = False
    print("WARNING: pytz not installed — snapshot will use UTC hour. Run: pip install pytz")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SUPABASE_URL       = os.environ.get("SUPABASE_URL",       "")
SUPABASE_KEY       = os.environ.get("SUPABASE_KEY",       "")
PREMIUM_USERNAME   = os.environ.get("PREMIUM_USERNAME",   "")
PREMIUM_PASSWORD   = os.environ.get("PREMIUM_PASSWORD",   "")
PRO_USERNAME       = os.environ.get("PRO_USERNAME",       "")
PRO_PASSWORD       = os.environ.get("PRO_PASSWORD",       "")
GOA_USERNAME       = os.environ.get("GOA_USERNAME",       "")
GOA_PASSWORD       = os.environ.get("GOA_PASSWORD",       "")
BANGALORE_USERNAME = os.environ.get("BANGALORE_USERNAME", "")
BANGALORE_PASSWORD = os.environ.get("BANGALORE_PASSWORD", "")
GUJARAT_USERNAME   = os.environ.get("GUJARAT_USERNAME",   "")
GUJARAT_PASSWORD   = os.environ.get("GUJARAT_PASSWORD",   "")

SYNC_EVERY_MINUTES = 5

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

SERVERS = [
    {"name": "Premium Server",   "username": PREMIUM_USERNAME,   "password": PREMIUM_PASSWORD,   "ip": "13.126.244.90",  "project_id": "37"},
    {"name": "PRO Server",       "username": PRO_USERNAME,       "password": PRO_PASSWORD,       "ip": "43.204.188.112", "project_id": "16"},
    {"name": "Goa Server",       "username": GOA_USERNAME,       "password": GOA_PASSWORD,       "ip": "3.7.238.246",    "project_id": "37"},
    {"name": "Bangalore Server", "username": BANGALORE_USERNAME, "password": BANGALORE_PASSWORD, "ip": "13.126.244.90",  "project_id": "37"},
    {"name": "Gujarat Server",   "username": GUJARAT_USERNAME,   "password": GUJARAT_PASSWORD,   "ip": "13.126.244.90",  "project_id": "37"},
]

_snapshotted_today = set()
_tier_map_cache = {}

TIER_MAP = {
    "platinum": "Platinum",
    "gold":     "Gold",
    "silver":   "Silver",
}

def fetch_all_rows(table_name, select_cols, filters=None, page_size=1000):
    """
    Supabase/PostgREST har REST response ko project ke "Max Rows" setting
    (default 1000) tak cap karta hai jab tak .range() se pagination na ho.
    Yeh function .range() se loop karke poora result set guarantee karta hai.
    """
    all_rows = []
    start = 0
    while True:
        q = supabase.table(table_name).select(select_cols)
        for col, val in (filters or {}).items():
            q = q.eq(col, val)
        res = q.range(start, start + page_size - 1).execute()
        rows = res.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size
    return all_rows

def get_ist_now():
    if HAS_PYTZ:
        return datetime.now(IST)
    else:
        return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)

def should_take_snapshot():
    now_ist = get_ist_now()
    return now_ist.hour == 23 and now_ist.minute >= 50

def get_snapshot_date():
    return get_ist_now().strftime('%Y-%m-%d')

def get_session(ip):
    session = requests.Session()
    session.headers.update({
        "User-Agent": "PostmanRuntime/7.36.3",
        "Accept": "*/*",
        "Content-Type": "application/json"
    })
    try:
        session.get(f"https://{ip}/webservice", verify=False, timeout=10)
    except Exception:
        pass
    return session

def get_token(server, session):
    url = f"https://{server['ip']}/webservice?token=generateAccessToken"
    try:
        res = session.get(
            url,
            json={"username": server["username"], "password": server["password"]},
            verify=False, timeout=15
        )
        token = res.json().get("data", {}).get("token")
        if token:
            print(f"  Token OK — {server['name']}")
        else:
            print(f"  No token — {server['name']} — {res.text[:100]}")
        return token
    except Exception as e:
        print(f"  Token error ({server['name']}): {e}")
        return None

def pull_vehicles(server, token, session):
    url = f"https://{server['ip']}/webservice?token=getTokenBaseLiveData&ProjectId={server['project_id']}"
    headers = {
        "auth-code": token,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = {"company_names": "", "vehicle_nos": "", "imei_nos": "", "format": "json"}
    try:
        res = session.post(url, json=body, headers=headers, verify=False, timeout=30)
        raw = res.json()
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            if "root" in raw and isinstance(raw["root"], dict):
                return raw["root"].get("VehicleData", [])
            for k in ["VehicleData", "data", "vehicles"]:
                if k in raw and isinstance(raw[k], list):
                    return raw[k]
        return []
    except Exception as e:
        print(f"   Pull error ({server['name']}): {e}")
        return []

def map_vehicle(v, region, sync_time):
    imei = str(v.get("Imeino", "")).strip()
    return {
        "synced_at": sync_time, "region": region,
        "vehicle_name": v.get("Vehicle_Name", ""), "vehicle_no": v.get("Vehicle_No", ""),
        "company": v.get("Company", ""), "branch": v.get("Branch", ""),
        "vehicletype": v.get("Vehicletype", ""), "status": v.get("Status", ""),
        "gps": v.get("GPS", ""), "ign": v.get("IGN", ""), "ac": v.get("AC", ""),
        "speed": v.get("Speed", ""), "location": v.get("Location", ""),
        "latitude": v.get("Latitude", ""), "longitude": v.get("Longitude", ""),
        "odometer": str(v.get("Odometer", "")), "gps_actual_time": v.get("GPSActualTime", ""),
        "device_datetime": v.get("Datetime", ""), "temperature": v.get("Temperature", ""),
        "heartbeat": v.get("heartbeat", ""), "device_model": v.get("DeviceModel", ""),
        "imeino": imei, "satellite_count": int(v.get("satellite_count", 0) or 0),
        "battery_percentage": int(v.get("battery_percentage", 0) or 0),
        "power": v.get("Power", ""), "sos": v.get("SOS", ""),
        "immobilize_state": v.get("Immobilize_State", ""),
        "driver_first_name": v.get("Driver_First_Name", ""),
        "driver_last_name": v.get("Driver_Last_Name", ""),
        "username": v.get("username", ""), "altitude": str(v.get("Altitude", "")),
        "angle": str(v.get("Angle", "")), "external_volt": v.get("ExternalVolt", ""),
        "vin": v.get("Vin", ""), "poi": v.get("POI", ""),
        "can_odometer": str(v.get("can_odometer", "")), "gps_hdop": v.get("gps_hdop", ""),
        "mcc": v.get("mcc", ""), "mnc": v.get("mnc", ""), "cellid": v.get("cellid", ""),
        "lac": v.get("lac", ""), "door1": v.get("Door1", ""), "door2": v.get("Door2", ""),
        "door3": v.get("Door3", ""), "door4": v.get("Door4", ""), "elock": v.get("elock", ""),
        "ibutton_rfid": v.get("Ibutton/RFID", ""), "course": str(v.get("course", ""))
    }

def refresh_tier_map():
    """
    Fetch company_name -> tier mapping from customer_crm table.
    FIX (16-Jun-2026): SmartFleet's live API does NOT return a Tier/tier/customer_tier
    field at all — that's why every vehicle was falling back to "Other" before.
    The actual tier (Platinum/Gold/Silver) lives in Supabase's customer_crm table,
    keyed by company_name. This refreshes a cached lookup once per sync_all() cycle
    (every 10 min) instead of querying it per-vehicle.
    """
    global _tier_map_cache
    try:
        rows = fetch_all_rows("customer_crm", "company_name,tier")
        new_map = {}
        for r in rows:
            name = str(r.get("company_name", "")).strip().lower()
            tier = str(r.get("tier", "")).strip()
            if name and tier:
                new_map[name] = tier
        _tier_map_cache = new_map
        print(f"  📋 Tier map refreshed — {len(_tier_map_cache)} companies loaded")
    except Exception as e:
        print(f"  ⚠️ Tier map refresh error: {e} — keeping previous cache ({len(_tier_map_cache)} companies)")

def get_tier(v):
    """Look up tier via company name in the cached customer_crm map"""
    company = str(v.get("Company", "")).strip().lower()
    tier = _tier_map_cache.get(company)
    if tier in ("Platinum", "Gold", "Silver"):
        return tier
    return "Other"

def save_daily_snapshot(server_name, vehicles):
    """Save full vehicle list snapshot — used for change detection"""
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    snapshot_key = f"snapshot_{server_name}_{today}"
    if snapshot_key in _snapshotted_today:
        return

    print(f"  [{server_name}] 🌙 Saving daily snapshot for {today}...")

    rows = []
    for v in vehicles:
        imei = str(v.get("Imeino", "")).strip()
        if not imei or imei.lower() == "null":
            continue
        rows.append({
            "snapshot_date": today,
            "region":        server_name,
            "imeino":        imei,
            "vehicle_no":    v.get("Vehicle_No", ""),
            "vehicle_name":  v.get("Vehicle_Name", ""),
            "company":       v.get("Company", ""),
            "tier":          get_tier(v),
            "status":        v.get("Status", ""),
        })

    if not rows:
        return

    saved = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i+500]
        try:
            supabase.table("vehicle_daily_snapshot").upsert(
                chunk, on_conflict="snapshot_date,region,imeino"
            ).execute()
            saved += len(chunk)
        except Exception as e:
            print(f"  [{server_name}] Snapshot save error: {e}")

    print(f"  [{server_name}] ✅ Snapshot saved — {saved} vehicles")
    _snapshotted_today.add(snapshot_key)

def save_daily_stats(server_name, vehicles):
    """Save aggregated counts per server+tier — used for KPI change indicators"""
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    stats_key = f"stats_{server_name}_{today}"
    if stats_key in _snapshotted_today:
        return

    print(f"  [{server_name}] 📊 Saving daily stats for {today}...")

    # Count by tier
    tier_stats = {}
    all_stats = {"total": 0, "active": 0, "running": 0, "idle": 0, "stop": 0, "inactive": 0}

    for v in vehicles:
        imei = str(v.get("Imeino", "")).strip()
        if not imei or imei.lower() == "null":
            continue

        tier = get_tier(v)
        status = str(v.get("Status", "")).strip().lower()

        if tier not in tier_stats:
            tier_stats[tier] = {"total": 0, "active": 0, "running": 0, "idle": 0, "stop": 0, "inactive": 0}

        # Count total
        tier_stats[tier]["total"] += 1
        all_stats["total"] += 1

        # Count by status
        if status == "running":
            tier_stats[tier]["running"] += 1
            tier_stats[tier]["active"] += 1
            all_stats["running"] += 1
            all_stats["active"] += 1
        elif status == "idle":
            tier_stats[tier]["idle"] += 1
            tier_stats[tier]["active"] += 1
            all_stats["idle"] += 1
            all_stats["active"] += 1
        elif status == "stop":
            tier_stats[tier]["stop"] += 1
            all_stats["stop"] += 1
        elif status in ["inactive", "no data"]:
            tier_stats[tier]["inactive"] += 1
            all_stats["inactive"] += 1

    rows = []

    # Save "All" tier — overall stats for this server
    rows.append({
        "snapshot_date":    today,
        "region":           server_name,
        "tier":             "All",
        "total_vehicles":   all_stats["total"],
        "active_vehicles":  all_stats["active"],
        "running_vehicles": all_stats["running"],
        "idle_vehicles":    all_stats["idle"],
        "stop_vehicles":    all_stats["stop"],
        "inactive_vehicles":all_stats["inactive"],
    })

    # Save per tier
    for tier, counts in tier_stats.items():
        rows.append({
            "snapshot_date":    today,
            "region":           server_name,
            "tier":             tier,
            "total_vehicles":   counts["total"],
            "active_vehicles":  counts["active"],
            "running_vehicles": counts["running"],
            "idle_vehicles":    counts["idle"],
            "stop_vehicles":    counts["stop"],
            "inactive_vehicles":counts["inactive"],
        })

    for i in range(0, len(rows), 500):
        try:
            supabase.table("daily_fleet_stats").upsert(
                rows[i:i+500], on_conflict="snapshot_date,region,tier"
            ).execute()
        except Exception as e:
            print(f"  [{server_name}] Stats save error: {e}")

    print(f"  [{server_name}] ✅ Stats saved — {len(rows)} tier rows")
    _snapshotted_today.add(stats_key)

def save_vehicle_changes(server_name, vehicles):
    """
    Compare today vs the MOST RECENT AVAILABLE previous snapshot — save added/removed vehicles.
    Gap-resilient: walks back to whatever the last real snapshot was (1 day back, or N days
    back after an outage) so a missing day never causes a total blackout.
    """
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    changes_key = f"changes_{server_name}_{today}"
    if changes_key in _snapshotted_today:
        return

    print(f"  [{server_name}] 🔄 Detecting vehicle changes for {today}...")

    # Step 1: find the most recent snapshot date strictly BEFORE today
    try:
        prev_dates_res = supabase.table("vehicle_daily_snapshot") \
            .select("snapshot_date") \
            .eq("region", server_name) \
            .lt("snapshot_date", today) \
            .order("snapshot_date", desc=True) \
            .limit(1) \
            .execute()
        prev_dates = prev_dates_res.data or []
    except Exception as e:
        print(f"  [{server_name}] Error finding previous snapshot date: {e}")
        return

    if not prev_dates:
        print(f"  [{server_name}] No previous snapshot found at all — skipping change detection (first-ever snapshot)")
        return

    prev_date = prev_dates[0]["snapshot_date"]
    gap_days = (datetime.strptime(today, '%Y-%m-%d') - datetime.strptime(prev_date, '%Y-%m-%d')).days
    if gap_days > 1:
        print(f"  [{server_name}] ⚠️ Snapshot gap detected ({gap_days} days) — comparing against {prev_date} instead of yesterday")

    # Step 2: fetch the full vehicle list for that previous date
    try:
        prev_rows = fetch_all_rows(
            "vehicle_daily_snapshot",
            "imeino,vehicle_no,vehicle_name,company,tier,region",
            {"snapshot_date": prev_date, "region": server_name}
        )
    except Exception as e:
        print(f"  [{server_name}] Error fetching previous snapshot: {e}")
        return

    if not prev_rows:
        print(f"  [{server_name}] Previous snapshot ({prev_date}) was empty — skipping")
        return

    # Build maps
    prev_map = {r["imeino"]: r for r in prev_rows}
    today_map = {}
    for v in vehicles:
        imei = str(v.get("Imeino", "")).strip()
        if not imei or imei.lower() == "null":
            continue
        today_map[imei] = v

    # ── SANITY CHECK ──────────────────────────────────────────────
    overlap = sum(1 for imei in today_map if imei in prev_map)
    total   = max(len(prev_map), len(today_map), 1)
    pct     = overlap / total
    print(f"  [{server_name}] Overlap: {overlap}/{total} ({pct:.0%})")
    if pct < 0.50:
        print(f"  [{server_name}] ⚠️ Low overlap ({pct:.0%}) — skipping changes to avoid false positives")
        _snapshotted_today.add(changes_key)
        return
    # ──────────────────────────────────────────────────────────────

    changes = []

    # Added = in today but not in previous available snapshot
    for imei, v in today_map.items():
        if imei not in prev_map:
            changes.append({
                "change_date": today,
                "change_type": "added",
                "imeino":      imei,
                "vehicle_no":  v.get("Vehicle_No", ""),
                "vehicle_name":v.get("Vehicle_Name", ""),
                "company":     v.get("Company", ""),
                "tier":        get_tier(v),
                "region":      server_name,
            })

    # Removed = in previous available snapshot but not in today
    for imei, r in prev_map.items():
        if imei not in today_map:
            changes.append({
                "change_date": today,
                "change_type": "removed",
                "imeino":      imei,
                "vehicle_no":  r.get("vehicle_no", ""),
                "vehicle_name":r.get("vehicle_name", ""),
                "company":     r.get("company", ""),
                "tier":        r.get("tier", "Other"),
                "region":      server_name,
            })

    if not changes:
        print(f"  [{server_name}] No vehicle changes since {prev_date}")
        _snapshotted_today.add(changes_key)
        return

    saved = 0
    for i in range(0, len(changes), 500):
        try:
            supabase.table("vehicle_changes").upsert(
                changes[i:i+500],
                on_conflict="change_date,imeino,region,change_type"
            ).execute()
            saved += len(changes[i:i+500])
        except Exception as e:
            print(f"  [{server_name}] Changes save error: {e}")

    added_count   = sum(1 for c in changes if c["change_type"] == "added")
    removed_count = sum(1 for c in changes if c["change_type"] == "removed")
    print(f"  [{server_name}] ✅ Changes saved (vs {prev_date}) — +{added_count} added, -{removed_count} removed")
    _snapshotted_today.add(changes_key)

def cleanup_old_snapshots(server_name):
    """Delete snapshots older than 30 days"""
    if not should_take_snapshot():
        return
    cleanup_key = f"cleanup_{server_name}_{get_snapshot_date()}"
    if cleanup_key in _snapshotted_today:
        return
    try:
        cutoff = (get_ist_now() - timedelta(days=30)).strftime('%Y-%m-%d')
        supabase.table("vehicle_daily_snapshot") \
            .delete() \
            .lt("snapshot_date", cutoff) \
            .execute()
        print(f"  [{server_name}] 🗑️ Old snapshots cleaned (before {cutoff})")
        _snapshotted_today.add(cleanup_key)
    except Exception as e:
        print(f"  [{server_name}] Cleanup error: {e}")

def reset_snapshot_tracker():
    global _snapshotted_today
    _snapshotted_today = set()
    print(f"  🔄 Snapshot tracker reset ({get_snapshot_date()})")

def check_platinum_churn_alerts():
    """
    Compare each Platinum-tier company's vehicle count TODAY against their
    average count over the previous 7 days. If it dropped 5% or more, save
    an alert row to customer_alerts (shown on the CRM Vehicle dashboard).
    Uses the 7-day average (not just yesterday) so a one-off device/network
    blip doesn't trigger a false alert — only a sustained drop does.
    Runs once per day, after all servers' snapshots for today are saved.
    """
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    alert_key = f"churn_check_{today}"
    if alert_key in _snapshotted_today:
        return

    print(f"  🔔 Checking Platinum customer vehicle reduction for {today}...")

    try:
        start_date = (get_ist_now() - timedelta(days=7)).strftime('%Y-%m-%d')
        res = supabase.table("vehicle_daily_snapshot") \
            .select("company,snapshot_date") \
            .eq("tier", "Platinum") \
            .gte("snapshot_date", start_date) \
            .lte("snapshot_date", today) \
            .limit(50000) \
            .execute()
        rows = res.data or []
    except Exception as e:
        print(f"  ⚠️ Churn check — error fetching snapshot data: {e}")
        return

    if not rows:
        print(f"  Churn check — no Platinum snapshot data found")
        _snapshotted_today.add(alert_key)
        return

    # Count vehicles per company per date
    counts = {}  # {company: {date: count}}
    for r in rows:
        company = r.get("company") or "Unknown"
        date = r.get("snapshot_date")
        counts.setdefault(company, {})
        counts[company][date] = counts[company].get(date, 0) + 1

    alerts_created = 0
    for company, by_date in counts.items():
        today_count = by_date.get(today)
        if today_count is None:
            continue  # no data for today yet for this company, skip

        prior_dates = [d for d in by_date if d != today]
        if not prior_dates:
            continue  # not enough history yet to compute a baseline

        baseline_avg = sum(by_date[d] for d in prior_dates) / len(prior_dates)
        if baseline_avg <= 0:
            continue

        pct_drop = ((baseline_avg - today_count) / baseline_avg) * 100
        if pct_drop < 5:
            continue

        # Skip if there's already an unacknowledged alert for this company
        # in the last 5 days (avoid spamming the same ongoing decline)
        try:
            recent_cutoff = (get_ist_now() - timedelta(days=5)).strftime('%Y-%m-%d')
            existing = supabase.table("customer_alerts") \
                .select("id") \
                .eq("company_name", company) \
                .eq("acknowledged", False) \
                .gte("alert_date", recent_cutoff) \
                .limit(1) \
                .execute()
            if existing.data:
                continue
        except Exception as e:
            print(f"  ⚠️ Churn check — error checking existing alerts for {company}: {e}")
            continue

        try:
            supabase.table("customer_alerts").upsert({
                "company_name":  company,
                "tier":          "Platinum",
                "alert_type":    "vehicle_reduction",
                "baseline_avg":  round(baseline_avg, 1),
                "current_count": today_count,
                "pct_drop":      round(pct_drop, 1),
                "alert_date":    today,
                "acknowledged":  False,
            }, on_conflict="company_name,alert_date").execute()
            alerts_created += 1
            print(f"  🚨 ALERT — {company}: {baseline_avg:.0f} → {today_count} ({pct_drop:.1f}% drop)")
        except Exception as e:
            print(f"  ⚠️ Churn check — error saving alert for {company}: {e}")

    print(f"  🔔 Churn check done — {alerts_created} new alert(s) created")
    _snapshotted_today.add(alert_key)

def sync_server(server):
    sync_time = datetime.now(timezone.utc).isoformat()
    print(f"\n  [{server['name']}] Syncing...")

    session = get_session(server["ip"])
    token   = get_token(server, session)
    if not token:
        return

    vehicles = pull_vehicles(server, token, session)
    print(f"  [{server['name']}] Vehicles found: {len(vehicles)}")

    rows = []
    skipped = 0
    for v in vehicles:
        imei = str(v.get("Imeino", "")).strip()
        if not imei or imei.lower() == "null":
            skipped += 1
            continue
        rows.append(map_vehicle(v, server["name"], sync_time))

    print(f"  [{server['name']}] Valid: {len(rows)} | Skipped: {skipped}")
    if not rows:
        return

    # Deduplicate
    seen = {}
    for row in rows:
        seen[row["imeino"]] = row
    unique_rows = list(seen.values())

    # Upsert live data
    total = 0
    for i in range(0, len(unique_rows), 100):
        chunk = unique_rows[i:i+100]
        try:
            supabase.table("vehicle_live_data").upsert(
                chunk, on_conflict="imeino,region"
            ).execute()
            total += len(chunk)
        except Exception as e:
            print(f"  [{server['name']}] Save error: {e}")

    print(f"  [{server['name']}] Saved {total} rows")

    # Delete stale
    try:
        supabase.table("vehicle_live_data") \
            .delete() \
            .eq("region", server["name"]) \
            .lt("synced_at", sync_time) \
            .execute()
        print(f"  [{server['name']}] Stale removed")
    except Exception as e:
        print(f"  [{server['name']}] Stale cleanup error: {e}")

    # 11:50 PM jobs — order matters!
    save_daily_snapshot(server["name"], vehicles)   # 1. Save full snapshot
    save_vehicle_changes(server["name"], vehicles)  # 2. Detect changes (gap-resilient now)
    save_daily_stats(server["name"], vehicles)      # 3. Save aggregated stats
    cleanup_old_snapshots(server["name"])           # 4. Clean old data

def sync_all():
    now_ist = get_ist_now()
    print(f"\n{'='*50}")
    print(f"Sync — {now_ist.strftime('%Y-%m-%d %H:%M:%S')} IST")
    print(f"{'='*50}")

    refresh_tier_map()

    for server in SERVERS:
        sync_server(server)

    try:
        supabase.rpc("refresh_customer_crm").execute()
        print("\n  CRM updated")
    except Exception as e:
        print(f"\n  CRM error: {e}")

    check_platinum_churn_alerts()

    print(f"\nNext sync in {SYNC_EVERY_MINUTES} minutes\n")


print("SmartFleet Sync Started!")
print(f"Servers: Premium + PRO + Goa + Bangalore + Gujarat")
print(f"Sync interval: every {SYNC_EVERY_MINUTES} minutes")
print(f"Snapshot window: 11:50 PM - 11:59 PM IST daily")
print("Press Ctrl+C to stop\n")

sync_all()
schedule.every(SYNC_EVERY_MINUTES).minutes.do(sync_all)
schedule.every().day.at("00:01").do(reset_snapshot_tracker)

while True:
    schedule.run_pending()
    time.sleep(1)
