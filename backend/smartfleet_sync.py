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

TIER_MAP = {
    "platinum": "Platinum",
    "gold":     "Gold",
    "silver":   "Silver",
}

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

def get_tier(v):
    """Extract tier from vehicle data"""
    tier_raw = str(v.get("Tier", "") or v.get("tier", "") or v.get("customer_tier", "")).strip().lower()
    return TIER_MAP.get(tier_raw, "Other")

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
    """Compare today vs yesterday snapshot — save added/removed vehicles"""
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    changes_key = f"changes_{server_name}_{today}"
    if changes_key in _snapshotted_today:
        return

    print(f"  [{server_name}] 🔄 Detecting vehicle changes for {today}...")

    # Fetch yesterday's snapshot
    yesterday = (get_ist_now() - timedelta(days=1)).strftime('%Y-%m-%d')
    try:
        prev_res = supabase.table("vehicle_daily_snapshot") \
            .select("imeino,vehicle_no,vehicle_name,company,tier,region") \
            .eq("snapshot_date", yesterday) \
            .eq("region", server_name) \
            .execute()
        prev_rows = prev_res.data or []
    except Exception as e:
        print(f"  [{server_name}] Error fetching yesterday snapshot: {e}")
        return

    if not prev_rows:
        print(f"  [{server_name}] No yesterday snapshot found — skipping change detection")
        return

    # Build maps
    prev_map = {r["imeino"]: r for r in prev_rows}
    today_map = {}
    for v in vehicles:
        imei = str(v.get("Imeino", "")).strip()
        if not imei or imei.lower() == "null":
            continue
        today_map[imei] = v

    changes = []

    # Added = in today but not in yesterday
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

    # Removed = in yesterday but not in today
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
        print(f"  [{server_name}] No vehicle changes today")
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
    print(f"  [{server_name}] ✅ Changes saved — +{added_count} added, -{removed_count} removed")
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
    save_vehicle_changes(server["name"], vehicles)  # 2. Detect changes (needs yesterday's snapshot)
    save_daily_stats(server["name"], vehicles)      # 3. Save aggregated stats
    cleanup_old_snapshots(server["name"])           # 4. Clean old data

def sync_all():
    now_ist = get_ist_now()
    print(f"\n{'='*50}")
    print(f"Sync — {now_ist.strftime('%Y-%m-%d %H:%M:%S')} IST")
    print(f"{'='*50}")

    for server in SERVERS:
        sync_server(server)

    try:
        supabase.rpc("refresh_customer_crm").execute()
        print("\n  CRM updated")
    except Exception as e:
        print(f"\n  CRM error: {e}")

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
