import requests, schedule, time, urllib3
from datetime import datetime, timezone
from supabase import create_client
import os
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# CONFIGURATION
# On Railway: set these as Environment Variables
# For local testing: fill them in directly below

SUPABASE_URL     = os.environ.get("SUPABASE_URL",     "")
SUPABASE_KEY     = os.environ.get("SUPABASE_KEY",     "")
PREMIUM_USERNAME = os.environ.get("PREMIUM_USERNAME", "")
PREMIUM_PASSWORD = os.environ.get("PREMIUM_PASSWORD", "")
PRO_USERNAME     = os.environ.get("PRO_USERNAME",     "")
PRO_PASSWORD     = os.environ.get("PRO_PASSWORD",     "")


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
    }
]


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


def map_vehicle(v, region):
    imei = str(v.get("Imeino", "")).strip()
    return {
        "synced_at":          datetime.now(timezone.utc).isoformat(),
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


def sync_server(server):
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
        rows.append(map_vehicle(v, server["name"]))

    print(f"  [{server['name']}] Valid: {len(rows)} | Skipped (no IMEI): {skipped}")

    if not rows:
        return

    # Deduplicate by imeino
    seen = {}
    for row in rows:
        seen[row["imeino"]] = row
    unique_rows = list(seen.values())

    # Upsert — both servers go to same table
    # unique key is (imeino, region)
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

    print(f"  [{server['name']}] Saved {total} rows ")


def sync_all():
    print(f"\n{'='*50}")
    print(f"Sync — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*50}")

    for server in SERVERS:
        sync_server(server)

    try:
        supabase.rpc("refresh_customer_crm").execute()
        print("\n  CRM updated ")
    except Exception as e:
        print(f"\n  CRM error: {e}")

    print(f"\nNext sync in {SYNC_EVERY_MINUTES} minutes\n")


print("SmartFleet Sync Started!")
print(f"Servers: Premium + PRO")
print(f"Interval: every {SYNC_EVERY_MINUTES} minutes")
print("Press Ctrl+C to stop\n")

sync_all()
schedule.every(SYNC_EVERY_MINUTES).minutes.do(sync_all)
while True:
    schedule.run_pending()
    time.sleep(1)
