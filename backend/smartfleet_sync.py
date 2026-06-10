import requests, schedule, time, urllib3
from datetime import datetime, timezone, date
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

# CONFIGURATION
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
    {
        "name":       "Premium Server",
        "username":   PREMIUM_USERNAME,
        "password":   PREMIUM_PASSWORD,
        "ip":         "13.126.244.90",
        "project_id": "37",
    },
    {
        "name":       "PRO Server",
        "username":   PRO_USERNAME,
        "password":   PRO_PASSWORD,
        "ip":         "43.204.188.112",
        "project_id": "16",
    },
    {
        "name":       "Goa Server",
        "username":   GOA_USERNAME,
        "password":   GOA_PASSWORD,
        "ip":         "3.7.238.246",
        "project_id": "37",
    },
    {
        "name":       "Bangalore Server",
        "username":   BANGALORE_USERNAME,
        "password":   BANGALORE_PASSWORD,
        "ip":         "13.126.244.90",
        "project_id": "37",
    },
    {
        "name":       "Gujarat Server",
        "username":   GUJARAT_USERNAME,
        "password":   GUJARAT_PASSWORD,
        "ip":         "13.126.244.90",
        "project_id": "37",
    },
]

# Track which servers have already been snapshotted today
_snapshotted_today = set()


def get_ist_now():
    """Get current time in IST"""
    if HAS_PYTZ:
        return datetime.now(IST)
    else:
        # Fallback: UTC + 5:30
        from datetime import timedelta
        return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def should_take_snapshot():
    """
    Returns True only between 11:50 PM and 11:59 PM IST.
    This ensures snapshot is taken at end of day,
    giving a consistent daily baseline for comparisons.
    """
    now_ist = get_ist_now()
    return now_ist.hour == 23 and now_ist.minute >= 50


def get_snapshot_date():
    """
    Returns the date string to use for today's snapshot.
    Uses IST date so midnight doesn't cause off-by-one issues.
    """
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
            verify=False,
            timeout=15
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
        "synced_at":          sync_time,
        "region":             region,
        "vehicle_name":       v.get("Vehicle_Name", ""),
        "vehicle_no":         v.get("Vehicle_No", ""),
        "company":            v.get("Company", ""),
        "branch":             v.get("Branch", ""),
        "vehicletype":        v.get("Vehicletype", ""),
        "status":             v.get("Status", ""),
        "gps":                v.get("GPS", ""),
        "ign":                v.get("IGN", ""),
        "ac":                 v.get("AC", ""),
        "speed":              v.get("Speed", ""),
        "location":           v.get("Location", ""),
        "latitude":           v.get("Latitude", ""),
        "longitude":          v.get("Longitude", ""),
        "odometer":           str(v.get("Odometer", "")),
        "gps_actual_time":    v.get("GPSActualTime", ""),
        "device_datetime":    v.get("Datetime", ""),
        "temperature":        v.get("Temperature", ""),
        "heartbeat":          v.get("heartbeat", ""),
        "device_model":       v.get("DeviceModel", ""),
        "imeino":             imei,
        "satellite_count":    int(v.get("satellite_count", 0) or 0),
        "battery_percentage": int(v.get("battery_percentage", 0) or 0),
        "power":              v.get("Power", ""),
        "sos":                v.get("SOS", ""),
        "immobilize_state":   v.get("Immobilize_State", ""),
        "driver_first_name":  v.get("Driver_First_Name", ""),
        "driver_last_name":   v.get("Driver_Last_Name", ""),
        "username":           v.get("username", ""),
        "altitude":           str(v.get("Altitude", "")),
        "angle":              str(v.get("Angle", "")),
        "external_volt":      v.get("ExternalVolt", ""),
        "vin":                v.get("Vin", ""),
        "poi":                v.get("POI", ""),
        "can_odometer":       str(v.get("can_odometer", "")),
        "gps_hdop":           v.get("gps_hdop", ""),
        "mcc":                v.get("mcc", ""),
        "mnc":                v.get("mnc", ""),
        "cellid":             v.get("cellid", ""),
        "lac":                v.get("lac", ""),
        "door1":              v.get("Door1", ""),
        "door2":              v.get("Door2", ""),
        "door3":              v.get("Door3", ""),
        "door4":              v.get("Door4", ""),
        "elock":              v.get("elock", ""),
        "ibutton_rfid":       v.get("Ibutton/RFID", ""),
        "course":             str(v.get("course", ""))
    }


def save_daily_snapshot(server_name, vehicles):
    """
    Save end-of-day snapshot for this server.
    Only runs between 11:50 PM - 11:59 PM IST (once per server per day).

    Timeline example:
      23:50 sync  → snapshot saved  ← "end of Day 1"
      23:55 sync  → skipped (already saved today)
      00:00 sync  → new day, _snapshotted_today cleared by reset_snapshot_tracker()
      ...
      next 23:50  → snapshot saved  ← "end of Day 2"

    Comparison:
      "Yesterday" = Day 1 23:50 snapshot vs Day 2 23:50 snapshot
      "Today"     = Yesterday 23:50 snapshot vs current live data
    """
    # Only run during 11:50 PM - 11:59 PM IST window
    if not should_take_snapshot():
        return

    today = get_snapshot_date()
    snapshot_key = f"{server_name}_{today}"

    if snapshot_key in _snapshotted_today:
        return  # already saved in this window today

    print(f"  [{server_name}] 🌙 End-of-day snapshot for {today}...")

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
            "status":        v.get("Status", ""),
        })

    if not rows:
        return

    saved = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i+500]
        try:
            supabase.table("vehicle_daily_snapshot").upsert(
                chunk,
                on_conflict="snapshot_date,region,imeino"
            ).execute()
            saved += len(chunk)
        except Exception as e:
            print(f"  [{server_name}] Snapshot save error: {e}")

    print(f"  [{server_name}] ✅ Snapshot saved — {saved} vehicles for {today} (end-of-day)")
    _snapshotted_today.add(snapshot_key)


def reset_snapshot_tracker():
    """
    Clear the daily snapshot tracker at midnight IST.
    This allows the next day's snapshot window (11:50 PM) to run fresh.
    Scheduled separately every day at 00:01 IST.
    """
    global _snapshotted_today
    _snapshotted_today = set()
    print(f"  🔄 Snapshot tracker reset for new day ({get_snapshot_date()})")


def sync_server(server):
    sync_time = datetime.now(timezone.utc).isoformat()

    print(f"\n  [{server['name']}] Syncing...")
    session = get_session(server["ip"])
    token = get_token(server, session)
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

    print(f"  [{server['name']}] Valid: {len(rows)} | Skipped (no IMEI): {skipped}")

    if not rows:
        return

    # Deduplicate by imeino
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
                chunk,
                on_conflict="imeino,region"
            ).execute()
            total += len(chunk)
        except Exception as e:
            print(f"  [{server['name']}] Save error: {e}")

    print(f"  [{server['name']}] Saved {total} rows")

    # Delete stale records
    try:
        supabase.table("vehicle_live_data") \
            .delete() \
            .eq("region", server["name"]) \
            .lt("synced_at", sync_time) \
            .execute()
        print(f"  [{server['name']}] Stale vehicles removed")
    except Exception as e:
        print(f"  [{server['name']}] Stale cleanup error: {e}")

    # Save end-of-day snapshot (only runs 11:50-11:59 PM IST)
    save_daily_snapshot(server["name"], vehicles)


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

# Reset snapshot tracker at midnight IST every day
# This uses a fixed time schedule — runs at 00:01 IST
schedule.every().day.at("00:01").do(reset_snapshot_tracker)

while True:
    schedule.run_pending()
    time.sleep(1)
