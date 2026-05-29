# ═══════════════════════════════════════════════════════════════
# api.py — Aditi Portal Permission API
# A Flask web server that handles all permission-related requests
# from the frontend (index.html).
#
# Three endpoints:
#   GET  /api/permissions              — called on login
#   POST /api/admin/permissions        — called when admin flips a toggle
#   GET  /api/admin/all-users-permissions — called when admin opens panel
# ═══════════════════════════════════════════════════════════════

from flask import Flask, request, jsonify   # Flask web framework
from flask_cors import CORS                  # allows your frontend to call this server
from supabase import create_client          # Supabase Python client
import os                                   # to read environment variables

# ── App setup ───────────────────────────────────────────────────
app = Flask(__name__)

# CORS = Cross-Origin Resource Sharing.
# Your frontend (index.html) is on one domain, this server is on another.
# Without CORS, the browser blocks the request. This line allows it.
CORS(app)

# ── Supabase connection ─────────────────────────────────────────
# IMPORTANT: This uses the SERVICE ROLE key, not the anon key.
# The service role key bypasses RLS and has full read/write access.
# NEVER put this key in your frontend HTML file.
# Store it as an environment variable on Railway.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rramdtpabwjsndgkohbi.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Create the Supabase client using the service key
sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Role mapping ────────────────────────────────────────────────
# Your Employee_details table stores roles as Employee_Dept values
# like "Managing Director", "MIS", "PC" etc.
# This maps those values to the short role keys used in role_defaults table.
ROLE_MAP = {
    "managing director":   "owner",
    "mis":                 "mis",
    "pc":                  "pc",
    "executive Assistant": "executive Assistant"
}

# ── Helper: check if a caller is an admin ───────────────────────
# Used by the two admin endpoints to block non-admin callers.
# Reads the X-User-Email header that the frontend sends with every request.
def is_admin(caller_email):
    if not caller_email:
        return False
    try:
        res = sb.table("Employee_details") \
            .select("Employee_Dept") \
            .ilike("Email_Id", caller_email) \
            .limit(1) \
            .execute()
        if not res.data:
            return False
        dept = str(res.data[0].get("Employee_Dept", "")).strip().lower()
        return dept in ["mis", "managing director"]
    except Exception:
        return False

# ── Helper: build merged permissions for one user ───────────────
# Step 1: Load role defaults (what everyone with this role gets)
# Step 2: Load user-specific overrides (what this person gets differently)
# Step 3: Merge — user overrides always win over role defaults
def get_permissions(email, role):
    permissions = {}

    # Step 1: role defaults
    try:
        defaults_res = sb.table("role_defaults") \
            .select("permission, value") \
            .eq("role", role) \
            .execute()
        for row in (defaults_res.data or []):
            permissions[row["permission"]] = row["value"]
    except Exception as e:
        print(f"Error fetching role defaults: {e}")

    # Step 2: user-specific overrides
    try:
        overrides_res = sb.table("user_permissions") \
            .select("permission, value") \
            .eq("user_email", email.lower()) \
            .execute()
        for row in (overrides_res.data or []):
            permissions[row["permission"]] = row["value"]   # override wins
    except Exception as e:
        print(f"Error fetching user overrides: {e}")

    return permissions


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 1: GET /api/permissions?email=someone@adititracking.com
#
# Called by index.html right after Supabase Auth login.
# Returns the merged permissions object for that user.
#
# Example response:
# {
#   "role": "mis",
#   "rawRole": "mis",
#   "permissions": {
#     "can_view_ims": "true",
#     "can_upload_files": "true",
#     "checklist_scope": "all",
#     ...
#   }
# }
# ══════════════════════════════════════════════════════════════════
@app.route("/api/permissions", methods=["GET"])
def fetch_user_permissions():
    # Read the email from the URL query string: /api/permissions?email=...
    email = request.args.get("email", "").strip().lower()

    if not email:
        return jsonify({"error": "email is required"}), 400

    # Look up this person in Employee_details to find their department/role
    try:
        emp_res = sb.table("Employee_details") \
            .select("Employee_Dept") \
            .ilike("Email_Id", email) \
            .limit(1) \
            .execute()
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

    # If employee not found, treat as regular employee
    raw_role = ""
    if emp_res.data:
        raw_role = str(emp_res.data[0].get("Employee_Dept", "")).strip().lower()

    # Convert department name to role key
    role = ROLE_MAP.get(raw_role, "employee")

    # Build merged permissions
    permissions = get_permissions(email, role)

    return jsonify({
        "role":        role,
        "rawRole":     raw_role,
        "permissions": permissions
    })


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 2: POST /api/admin/permissions
#
# Called when an admin flips a toggle in the Access Control panel.
# Saves one permission change for one user.
#
# Request body (JSON):
# {
#   "user_email":  "employee@adititracking.com",
#   "permission":  "can_view_ims",
#   "value":       "true"
# }
#
# Response: { "ok": true }
# ══════════════════════════════════════════════════════════════════
@app.route("/api/admin/permissions", methods=["POST"])
def save_user_permission():
    # The frontend sends the admin's email in this header
    caller_email = request.headers.get("X-User-Email", "").strip().lower()

    # Block non-admins
    if not is_admin(caller_email):
        return jsonify({"error": "Forbidden — only MIS or Managing Director can change permissions"}), 403

    # Read the request body
    body       = request.get_json() or {}
    user_email = str(body.get("user_email", "")).strip().lower()
    permission = str(body.get("permission", "")).strip()
    value      = str(body.get("value", "")).strip()

    # Validate all three fields are present
    if not user_email or not permission or not value:
        return jsonify({"error": "user_email, permission, and value are all required"}), 400

    # Upsert = insert if this row doesn't exist, update if it does
    # on_conflict means: if user_email+permission already exists, update the value
    try:
        sb.table("user_permissions").upsert(
            {
                "user_email": user_email,
                "permission": permission,
                "value":      value,
            },
            on_conflict="user_email,permission"
        ).execute()
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 3: GET /api/admin/all-users-permissions
#
# Called when admin opens the Access Control panel in the portal.
# Returns every employee + their current merged permissions.
# Also returns the list of all possible permission keys.
#
# Response:
# {
#   "users": [
#     {
#       "name": "Hemant",
#       "email": "mis@adititracking.com",
#       "role": "mis",
#       "permissions": { "can_view_ims": "true", ... }
#     },
#     ...
#   ],
#   "all_permission_keys": ["can_view_ims", "can_view_leads", ...]
# }
# ══════════════════════════════════════════════════════════════════
@app.route("/api/admin/all-users-permissions", methods=["GET"])
def all_users_permissions():
    # Block non-admins
    caller_email = request.headers.get("X-User-Email", "").strip().lower()
    if not is_admin(caller_email):
        return jsonify({"error": "Forbidden"}), 403

    # Get all employees from Employee_details
    try:
        emps_res = sb.table("Employee_details") \
            .select("Employee_name, Email_Id, Employee_Dept") \
            .execute()
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

    # Get all possible permission keys from role_defaults
    # (so the admin panel knows what toggles to show)
    try:
        keys_res = sb.table("role_defaults").select("permission").execute()
        all_keys = sorted(list({r["permission"] for r in (keys_res.data or [])}))
    except Exception:
        all_keys = []

    # Get ALL role defaults in one query (more efficient than one query per user)
    try:
        all_defaults_res = sb.table("role_defaults") \
            .select("role, permission, value") \
            .execute()
        # Build a nested dict: defaults_map["mis"]["can_view_ims"] = "true"
        defaults_map = {}
        for row in (all_defaults_res.data or []):
            defaults_map.setdefault(row["role"], {})[row["permission"]] = row["value"]
    except Exception:
        defaults_map = {}

    # Get ALL user overrides in one query
    try:
        all_overrides_res = sb.table("user_permissions") \
            .select("user_email, permission, value") \
            .execute()
        # Build a nested dict: overrides_map["email"]["can_view_ims"] = "true"
        overrides_map = {}
        for row in (all_overrides_res.data or []):
            overrides_map.setdefault(row["user_email"], {})[row["permission"]] = row["value"]
    except Exception:
        overrides_map = {}

    # Build the result — one entry per employee
    result = []
    for emp in (emps_res.data or []):
        email = str(emp.get("Email_Id", "")).strip().lower()
        if not email:
            continue   # skip rows with no email

        raw_role = str(emp.get("Employee_Dept", "")).strip().lower()
        role     = ROLE_MAP.get(raw_role, "employee")

        # Merge: role defaults first, then user overrides on top
        perms = {}
        perms.update(defaults_map.get(role, {}))      # base: role defaults
        perms.update(overrides_map.get(email, {}))    # override: user-specific

        result.append({
            "name":        emp.get("Employee_name", ""),
            "email":       email,
            "role":        role,
            "permissions": perms
        })

    return jsonify({
        "users":               result,
        "all_permission_keys": all_keys
    })


# ── Health check endpoint ───────────────────────────────────────
# Visit /health in your browser to confirm the server is running.
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "Aditi Permissions API"})


# ── Start the server ────────────────────────────────────────────
# Railway sets a PORT environment variable. We read it.
# Default 5001 is for local testing (5000 is often taken).
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"Aditi Permissions API starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
