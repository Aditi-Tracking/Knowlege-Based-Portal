// Section: Activity Log (loadActivityLog, filters, event types)
/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY TRACKING SYSTEM
   Tracks: login, logout, page views, card opens/closes, video watching
   Table: activity_logs
   Columns needed in Supabase:
     emp_id text, event_type text, event_detail text, session_id text,
     device text, page_name text, card_name text, duration_seconds int,
     video_title text, video_watch_seconds int, video_watch_percent int,
     file_name text, logout_at timestamptz, session_duration_seconds int,
     metadata jsonb, created_at timestamptz (default now())
═══════════════════════════════════════════════════════════════════════════ */

const _ACT_SESSION_ID = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
let _actEmpId    = null; // numeric Emp_id (FK) — fetched after login
let _actNameMap      = {};  // email (lowercase) → Employee_name cache
let _actEmpIdNameMap = {};  // numeric Emp_id → Employee_name cache

// Fetch Employee names from Employee_details using email list (for table display)
// Fetch Employee names using emp_id (numeric FK) — reliable since Email_Id
// in Employee_details may differ from the login email stored in activity_logs
async function _fetchEmpNames(rows) {
  // Collect unique numeric emp_ids not yet in cache
  const empIds = [...new Set(rows.map(r => r.emp_id).filter(id => id && typeof id === 'number'))];
  const needIds  = empIds.filter(id => !_actEmpIdNameMap[id]);

  // Also try Email_Id lookup for any rows that have employee_email
  const emails  = [...new Set(rows.map(r => (r.employee_email||'').toLowerCase()).filter(Boolean))];
  const needEmails = emails.filter(e => !_actNameMap[e]);

  const fetches = [];

  if (needIds.length) {
    const idFilter = needIds.join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Email_Id&Emp_id=in.(${idFilter})`, { headers: SB_HDRS() })
        .then(r => r.ok ? r.json() : [])
        .then(arr => arr.forEach(r => {
          if (r.Emp_id) _actEmpIdNameMap[r.Emp_id] = r.Employee_name || '';
          // Also cache by email if available
          const em = (r.Email_Id || '').toLowerCase().trim();
          if (em && r.Employee_name) _actNameMap[em] = r.Employee_name;
        }))
        .catch(() => {})
    );
  }

  if (needEmails.length) {
    const orFilter = needEmails.map(e => `Email_Id.ilike.${encodeURIComponent(e)}`).join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Email_Id,Employee_name&or=(${orFilter})`, { headers: SB_HDRS() })
        .then(r => r.ok ? r.json() : [])
        .then(arr => arr.forEach(r => {
          const key = (r.Email_Id || '').toLowerCase().trim();
          if (key && r.Employee_name) _actNameMap[key] = r.Employee_name;
        }))
        .catch(() => {})
    );
  }

  await Promise.all(fetches);
}

// Helper: get display name for a row (tries emp_id FK first, then email lookup)
function _getEmpDisplayName(row) {
  if (row.emp_id && _actEmpIdNameMap[row.emp_id]) return _actEmpIdNameMap[row.emp_id];
  const email = (row.employee_email || '').toLowerCase();
  if (email && _actNameMap[email]) return _actNameMap[email];
  if (row.employee?.Employee_name) return row.employee.Employee_name;
  return email ? email.split('@')[0] : '—';
}

// Fetch numeric Emp_id after login (emp_id column is now int FK)
async function _fetchAndCacheEmpId() {
  if (_actEmpId || !CURRENT_USER?.email) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`,
      { headers: SB_HDRS() }
    );
    if (res.ok) {
      const arr = await res.json();
      if (arr.length) {
        _actEmpId = arr[0].Emp_id;
        // CURRENT_USER mein bhi store karo taaki _canUploadQuiz use kar sake
        if (CURRENT_USER) CURRENT_USER.empId = _actEmpId;
        localStorage.setItem('aditiUser', JSON.stringify(CURRENT_USER));
      }
    }
  } catch(e) {}
}
let _actLoginTime     = Date.now();
let _actPageName      = 'home';
let _actPageStart     = Date.now();
let _actCardName      = null;
let _actCardStart     = null;
let _actVideoTitle    = null;
let _actVideoStart    = null;
let _actVideoEl       = null; // currently tracked <video> element

// Core logger — fire-and-forget, never disrupts UI
async function logActivity(data) {
  try {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
    const fullPayload = {
      emp_id:                  _actEmpId || undefined,               // numeric FK (int)
      employee_email:          CURRENT_USER.email || null,           // new email column
      event_type:              data.event_type              || 'unknown',
      event_detail:            data.event_detail            || '',
      session_id:              _ACT_SESSION_ID,
      device:                  (isMobileDevice() || isTabletDevice()) ? 'mobile' : 'desktop',
      page_name:               data.page_name               || _actPageName || '',
      card_name:               data.card_name               || null,
      duration_seconds:        data.duration_seconds        ?? null,
      video_title:             data.video_title             || null,
      video_watch_seconds:     data.video_watch_seconds     ?? null,
      video_watch_percent:     data.video_watch_percent     ?? null,
      file_name:               data.file_name               || null,
      logout_at:               data.logout_at               || null,
      session_duration_seconds:data.session_duration_seconds ?? null,
      metadata:                data.metadata || null
    };
    // Remove null/undefined values to avoid column errors
    Object.keys(fullPayload).forEach(k => { if (fullPayload[k] === null || fullPayload[k] === undefined) delete fullPayload[k]; });

    const hdrs = {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    // Try full payload first
    const res = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(fullPayload)
    });

    // Fallback to basic columns if new columns don't exist yet
    if (!res.ok) {
      const basicPayload = {
        emp_id:       fullPayload.emp_id || undefined,   // numeric FK
        employee_email: fullPayload.employee_email || undefined,
        event_type:   fullPayload.event_type,
        event_detail: [
          fullPayload.event_detail,
          fullPayload.page_name   ? 'page:'+fullPayload.page_name   : '',
          fullPayload.card_name   ? 'card:'+fullPayload.card_name   : '',
          fullPayload.video_title ? 'video:'+fullPayload.video_title : '',
          fullPayload.duration_seconds != null ? 'dur:'+fullPayload.duration_seconds+'s' : ''
        ].filter(Boolean).join(' | '),
        session_id: fullPayload.session_id,
        device:     fullPayload.device
      };
      fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
        method: 'POST', headers: hdrs, body: JSON.stringify(basicPayload)
      }).catch(()=>{});
    }
  } catch(e) { /* silent fail — never break UI */ }
}

// Called on every panel switch — logs previous page time, starts new page timer
function _actOnPageSwitch(newPage) {
  const secs = Math.round((Date.now() - _actPageStart) / 1000);
  if (_actPageName && secs > 30) { // Skip page_view under 30s — reduces noise
    logActivity({ event_type:'page_view', event_detail:`Visited: ${_actPageName}`, page_name:_actPageName, duration_seconds:secs });
  }
  _actPageName  = newPage;
  _actPageStart = Date.now();
  _actStopVideoTracking(); // stop video tracking on page leave
}

// Called when a card or overlay opens
function _actOnCardOpen(cardName) {
  _actOnCardClose();
  _actCardName  = cardName;
  _actCardStart = Date.now();
  // card_open not logged — generated too many rows
}

// Called when a card or overlay closes
function _actOnCardClose() {
  // card_close not logged — just reset state
  _actCardName  = null;
  _actCardStart = null;
}

// Attach video tracking to a <video> element
function _actTrackVideo(videoEl, title) {
  if (!videoEl) return;
  _actStopVideoTracking();
  _actVideoEl    = videoEl;
  _actVideoTitle = title || 'Unknown Video';
  _actVideoStart = null;

  const onPlay = () => {
    _actVideoStart = Date.now();
    logActivity({ event_type:'video_play', event_detail:`Playing: ${_actVideoTitle}`, video_title:_actVideoTitle });
  };
  const onPause = () => {
    // video_pause not logged — only track play and complete
    _actVideoStart = null;
  };
  const onEnded = () => {
    const secs = videoEl.duration ? Math.round(videoEl.duration) : null;
    logActivity({ event_type:'video_complete', event_detail:`Completed: ${_actVideoTitle}`,
                  video_title:_actVideoTitle, video_watch_seconds:secs, video_watch_percent:100 });
    _actVideoStart = null;
  };

  videoEl._actHandlers = { onPlay, onPause, onEnded };
  videoEl.addEventListener('play',  onPlay);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('ended', onEnded);
}

// Detach video tracking from previous element
function _actStopVideoTracking() {
  if (!_actVideoEl) return;
  if (_actVideoEl._actHandlers) {
    _actVideoEl.removeEventListener('play',  _actVideoEl._actHandlers.onPlay);
    _actVideoEl.removeEventListener('pause', _actVideoEl._actHandlers.onPause);
    _actVideoEl.removeEventListener('ended', _actVideoEl._actHandlers.onEnded);
    delete _actVideoEl._actHandlers;
  }
  // Left-video pause not logged — reduces noise
  _actVideoStart = null;
  _actVideoEl    = null;
  _actVideoTitle = null;
  _actVideoStart = null;
}

// Log file open
function _actOnFileOpen(fileName, cardName) {
  logActivity({ event_type:'file_open', event_detail:`Opened file: ${fileName}`,
                card_name: cardName || _actCardName || '', file_name: fileName });
}

// Log before page unload (best effort)
window.addEventListener('beforeunload', () => {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  const totalSecs = Math.round((Date.now() - _actLoginTime) / 1000);
  _actStopVideoTracking();
  // sendBeacon can't send auth headers — use fetch with keepalive instead (RLS ke liye zaroori)
  fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      emp_id: CURRENT_USER.email || CURRENT_USER.name,
      event_type: 'page_unload', event_detail: 'Browser tab closed / navigated away',
      session_id: _ACT_SESSION_ID, device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'desktop',
      page_name: _actPageName, session_duration_seconds: totalSecs,
      logout_at: new Date().toISOString(), metadata: { unload: true }
    })
  }).catch(()=>{});
});

/* ═══════════════════════════════════════════════════════════════
   ACTIVITY LOG — JS (MIS & Managing Director only)
═══════════════════════════════════════════════════════════════ */
let _actLogAllRows = [];
let _actLogFiltered = [];
let _actLogPage = 1;
const _ACT_LOG_PER_PAGE = 50;


async function actLogTestConnection() {
  const res_el = document.getElementById('actlog-test-result');
  if (res_el) res_el.innerHTML = '<span style="color:var(--muted);">⏳ Testing...</span>';
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs?select=id,emp_id,event_type,page_name,card_name&limit=1`, { headers: SB_HDRS_AUTH() });
    if (r.ok) {
      const d = await r.json(); 
      // Check if new columns exist
      const hasNewCols = d.length === 0 || ('page_name' in d[0]);
      if (hasNewCols) {
        if (res_el) res_el.innerHTML = '<span style="color:#00d4aa;">✅ Connected! New columns also exist. Data should come through.</span>';
        document.getElementById('actlog-sql-banner').style.display = 'none';
      } else {
        if (res_el) res_el.innerHTML = '<span style="color:#f0a500;">⚠️ Connected, but new columns are missing. Run the SQL above.</span>';
        document.getElementById('actlog-sql-banner').style.display = 'block';
      }
    } else {
      const err = await r.text();
      if (r.status === 401 || r.status === 403) {
        if (res_el) res_el.innerHTML = '<span style="color:#ff5c7c;">❌ RLS is blocking this! Add an RLS policy in Supabase (see the SQL above).</span>';
        document.getElementById('actlog-sql-banner').style.display = 'block';
      } else {
        if (res_el) res_el.innerHTML = `<span style="color:#ff5c7c;">❌ Error ${r.status}: ${err.substring(0,80)}</span>`;
      }
    }
  } catch(e) {
    if (res_el) res_el.innerHTML = '<span style="color:#ff5c7c;">❌ Network error: ' + e.message + '</span>';
  }
}

async function actLogSendTestEvent() {
  const res_el = document.getElementById('actlog-test-result');
  if (res_el) res_el.innerHTML = '<span style="color:var(--muted);">⏳ Sending test log...</span>';
  try {
    const hdrs = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${_currentToken}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

    // Try full payload
    const fullP = { emp_id: CURRENT_USER?.email || 'test', event_type: 'login', event_detail: 'Test event from Activity Log panel',
      session_id: _ACT_SESSION_ID, device: 'desktop', page_name: 'activitylog', card_name: 'Test Card', duration_seconds: 5 };
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, { method:'POST', headers:hdrs, body:JSON.stringify(fullP) });

    if (r1.ok || r1.status === 201) {
      if (res_el) res_el.innerHTML = '<span style="color:#00d4aa;">✅ Test log sent! Refresh — data should show up.</span>';
      document.getElementById('actlog-sql-banner').style.display = 'none';
    } else {
      const errText = await r1.text();
      // Fallback to basic columns
      const basicP = { emp_id: CURRENT_USER?.email || 'test', event_type: 'login',
        event_detail: 'Test | page:activitylog | card:Test Card | dur:5s', session_id: _ACT_SESSION_ID, device: 'desktop' };
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, { method:'POST', headers:hdrs, body:JSON.stringify(basicP) });
      if (r2.ok || r2.status === 201) {
        if (res_el) res_el.innerHTML = '<span style="color:#f0a500;">⚠️ Basic log saved (new columns are missing). Run the SQL above for full data. Refresh!</span>';
        document.getElementById('actlog-sql-banner').style.display = 'block';
      } else {
        const err2 = await r2.text();
        if (r2.status === 401 || r2.status === 403) {
          if (res_el) res_el.innerHTML = '<span style="color:#ff5c7c;">❌ RLS policy is blocking the INSERT. Add an INSERT policy in Supabase!</span>';
        } else {
          if (res_el) res_el.innerHTML = `<span style="color:#ff5c7c;">❌ Failed ${r2.status}: ${err2.substring(0,100)}</span>`;
        }
        document.getElementById('actlog-sql-banner').style.display = 'block';
      }
    }
  } catch(e) {
    if (res_el) res_el.innerHTML = '<span style="color:#ff5c7c;">❌ ' + e.message + '</span>';
  }
}

// If user is already logged in (page reload), fetch Emp_id
if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER?.email) {
  _fetchAndCacheEmpId();
}

function _canAccessActLog() {
  return PERMISSIONS.can_view_activitylog === 'true';
}

function _applyActLogNavVisibility() {
  const el = document.getElementById('nav-activitylog');
  if (el) el.style.display = _canAccessActLog() ? 'flex' : 'none';
  const mmEl = document.getElementById('mm-activitylog');
  if (mmEl) mmEl.style.display = _canAccessActLog() ? 'flex' : 'none';
}

async function loadActivityLog(forceRefresh) {
  if (!_canAccessActLog()) return;
  const loading = document.getElementById('actlog-loading');
  const table   = document.getElementById('actlog-table');
  const empty   = document.getElementById('actlog-empty');
  const stats   = document.getElementById('actlog-stats');
  if (loading) loading.style.display = 'block';
  if (table)   table.style.display   = 'none';
  if (empty)   empty.style.display   = 'none';

  // Hide SQL migration banner — columns already exist
  const sqlBanner = document.getElementById('actlog-sql-banner');
  if (sqlBanner) sqlBanner.style.display = 'none';

  try {
    // Try with FK JOIN first (explicit hint to avoid PostgREST ambiguity)
    let rows = null;
    try {
      const res1 = await fetch(
        `${SUPABASE_URL}/rest/v1/activity_logs?select=*,employee:Employee_details!emp_id(Employee_name)&order=created_at.desc&limit=2000`,
        { headers: SB_HDRS_AUTH() }
      );
      if (res1.ok) {
        const data = await res1.json();
        if (Array.isArray(data)) rows = data;
      }
    } catch(e1) {}

    // Fallback: simple select without JOIN if FK hint fails
    if (!rows) {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/activity_logs?select=*&order=created_at.desc&limit=2000`,
        { headers: SB_HDRS_AUTH() }
      );
      if (!res2.ok) throw new Error('HTTP ' + res2.status);
      const data2 = await res2.json();
      rows = Array.isArray(data2) ? data2 : [];
    }

    _actLogAllRows = rows;
    _actLogPage = 1;
    await _actLogPopulateEmpDropdown(_actLogAllRows); // async — fetches real names by emp_id

    // Default: set today's date if no filter is already set
    const dtFrom = document.getElementById('actlog-filter-date-from');
    const dtTo   = document.getElementById('actlog-filter-date-to');
    if (dtFrom && !dtFrom.value) {
      const today = new Date().toISOString().split('T')[0];
      dtFrom.value = today;
      dtTo.value   = today;
    }

    applyActLogFilters(); // show filtered data (today by default, KPI also updates)
  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (empty) { empty.style.display = 'block'; empty.innerHTML = '<div style="text-align:center;padding:48px;color:#ff5c7c;">⚠️ Error loading logs: ' + e.message + '</div>'; }
  }
}

// MIS and Managing Director emails — excluded from employee filter dropdown
const _ACT_EXCLUDE_ROLES = []; // No exclusions — all employees shown in filter
// emp_id is now a numeric FK; employee_email holds the email directly
// Employee names fetched via JOIN or _actNameMap cache — no separate fetch needed

function _actLogIsExcluded(email) {
  const e = (email||'').toLowerCase();
  return _ACT_EXCLUDE_ROLES.some(r => e.startsWith(r+'@'));
}

// Populate dropdown — async so we can fetch real names from Employee_details
async function _actLogPopulateEmpDropdown(rows) {
  const sel = document.getElementById('actlog-filter-emp-select');
  if (!sel) return;

  // Fetch all names first (by emp_id FK — most reliable)
  await _fetchEmpNames(rows);

  // Build unique email → name map
  const seen = new Map();
  rows.forEach(r => {
    const email = (r.employee_email || '').toLowerCase().trim();
    if (!email || seen.has(email)) return;
    const name = _getEmpDisplayName(r); // uses emp_id FK lookup
    seen.set(email, name);
  });

  if (!seen.size) return;

  const current = sel.value;
  const sorted = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  sel.innerHTML = '<option value="">All Employees</option>' +
    sorted.map(([email, name]) =>
      `<option value="${email}" ${email===current?'selected':''}>${name}</option>`
    ).join('');
}

function applyActLogFilters() {
  const eventF   = (document.getElementById('actlog-filter-event')?.value || '').toLowerCase();
  const empF     = (document.getElementById('actlog-filter-emp-select')?.value || '').toLowerCase().trim();
  const dateFrom = document.getElementById('actlog-filter-date-from')?.value || '';
  const dateTo   = document.getElementById('actlog-filter-date-to')?.value || '';

  _actLogFiltered = _actLogAllRows.filter(row => {
    const matchEvent = !eventF || (row.event_type||'').toLowerCase() === eventF;
    const matchEmp   = !empF   || (row.employee_email||'').toLowerCase() === empF;
    let   matchDate  = true;
    if (dateFrom || dateTo) {
      const rowDate = row.created_at ? row.created_at.substring(0, 10) : '';
      if (dateFrom && rowDate < dateFrom) matchDate = false;
      if (dateTo   && rowDate > dateTo)   matchDate = false;
    }
    return matchEvent && matchEmp && matchDate;
  });
  _actLogPage = 1;
  renderActLogTable();
  renderActLogStats(_actLogFiltered); // KPI cards update with filtered data

  // Update filter summary
  const parts = [];
  if (empF) { const sel = document.getElementById('actlog-filter-emp-select'); parts.push('👤 ' + (sel?.options[sel.selectedIndex]?.text || empF)); }
  if (eventF) parts.push('⚡ ' + eventF.replace(/_/g,' '));
  if (dateFrom) parts.push('📅 From: ' + dateFrom);
  if (dateTo)   parts.push('📅 To: ' + dateTo);
  const sumEl = document.getElementById('actlog-filter-summary');
  if (sumEl) {
    if (parts.length) {
      sumEl.style.display = 'flex';
      sumEl.innerHTML = '<span style="color:var(--accent2);font-weight:600;">Filtering:' + parts.map(p => `<span style="background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:20px;">${p}</span>`).join('') + '</span>';
    } else {
      sumEl.style.display = 'none';
    }
  }
}

function actLogClearFilters() {
  const selEmp  = document.getElementById('actlog-filter-emp-select');
  const selEvt  = document.getElementById('actlog-filter-event');
  const dtFrom  = document.getElementById('actlog-filter-date-from');
  const dtTo    = document.getElementById('actlog-filter-date-to');
  if (selEmp) selEmp.value = '';
  if (selEvt) selEvt.value = '';
  if (dtFrom) dtFrom.value = '';
  if (dtTo)   dtTo.value   = '';
  applyActLogFilters();
}

function renderActLogTable() {
  const loading = document.getElementById('actlog-loading');
  const table   = document.getElementById('actlog-table');
  const empty   = document.getElementById('actlog-empty');
  const tbody   = document.getElementById('actlog-tbody');
  const pgInfo  = document.getElementById('actlog-page-info');
  const pgEl    = document.getElementById('actlog-pagination');
  const prev    = document.getElementById('actlog-prev');
  const next    = document.getElementById('actlog-next');

  if (loading) loading.style.display = 'none';

  if (!_actLogFiltered.length) {
    if (table) table.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      const dtFrom = document.getElementById('actlog-filter-date-from')?.value || '';
      const dtTo   = document.getElementById('actlog-filter-date-to')?.value   || '';
      const dateMsg = (dtFrom || dtTo)
        ? `<div style="font-size:0.85rem;color:var(--muted);margin-top:6px;">No activity found for the selected date: <b>${dtFrom}${dtTo && dtTo!==dtFrom?' → '+dtTo:''}</b>.</div><div style="font-size:0.8rem;color:var(--muted);margin-top:4px;">Change the date filter to view past data.</div>`
        : '';
      empty.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted);"><div style="font-size:2.5rem;margin-bottom:10px;">🗒️</div><div>No records found.</div>' + dateMsg + '</div>';
    }
    if (pgEl)  pgEl.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';

  const total = _actLogFiltered.length;
  const totalPages = Math.ceil(total / _ACT_LOG_PER_PAGE);
  const start = (_actLogPage - 1) * _ACT_LOG_PER_PAGE;
  const rows  = _actLogFiltered.slice(start, start + _ACT_LOG_PER_PAGE);

  const EVENT_STYLE = {
    login:          { bg:'rgba(0,212,170,0.12)',    color:'#00d4aa',  icon:'🔐' },
    logout:         { bg:'rgba(255,92,124,0.12)',   color:'#ff5c7c',  icon:'🚪' },
    page_view:      { bg:'rgba(78,154,241,0.12)',   color:'#4e9af1',  icon:'👁️' },
    card_open:      { bg:'rgba(240,165,0,0.12)',    color:'#f0a500',  icon:'📂' },
    video_play:     { bg:'rgba(168,85,247,0.12)',   color:'#a855f7',  icon:'▶️' },
    video_pause:    { bg:'rgba(168,85,247,0.08)',   color:'#8b40e8',  icon:'⏸️' },
    video_complete: { bg:'rgba(0,212,170,0.15)',    color:'#00b894',  icon:'✅' },
    file_open:      { bg:'rgba(99,102,241,0.12)',   color:'#6366f1',  icon:'📄' },
    page_unload:           { bg:'rgba(156,163,175,0.12)',  color:'#9ca3af',  icon:'💤' },
    training_module_open:  { bg:'rgba(99,102,241,0.12)',  color:'#6366f1',  icon:'📚' },
    training_submodule_open:{ bg:'rgba(99,102,241,0.08)', color:'#818cf8',  icon:'📖' },

  };

  // Fetch missing employee names by emp_id FK, then render
  _fetchEmpNames(rows).then(() => {
    tbody.innerHTML = _renderActLogRows(rows);
    if (table) table.style.display = 'table';
    if (pgInfo) pgInfo.textContent = `Showing ${start+1}–${Math.min(start+_ACT_LOG_PER_PAGE,total)} of ${total} records`;
    if (pgEl)  pgEl.style.display = 'flex';
    if (prev)  prev.disabled = _actLogPage <= 1;
    if (next)  next.disabled = _actLogPage >= totalPages;
  });
}

function _renderActLogRows(rows) {
  const EVENT_STYLE2 = {
    login:{ bg:'rgba(0,212,170,0.12)', color:'#00d4aa', icon:'🔐' },
    logout:{ bg:'rgba(255,92,124,0.12)', color:'#ff5c7c', icon:'🚪' },
    page_view:{ bg:'rgba(78,154,241,0.12)', color:'#4e9af1', icon:'👁️' },
    card_open:{ bg:'rgba(240,165,0,0.12)', color:'#f0a500', icon:'📋' },
    file_open:{ bg:'rgba(0,212,170,0.10)', color:'#00c49a', icon:'📄' },
    training_module_open:{ bg:'rgba(99,102,241,0.12)', color:'#818cf8', icon:'🎓' },
    training_submodule_open:{ bg:'rgba(99,102,241,0.08)', color:'#818cf8', icon:'📖' },
    video_play:{ bg:'rgba(168,85,247,0.12)', color:'#a855f7', icon:'▶️' },
    video_pause:{ bg:'rgba(168,85,247,0.08)', color:'#8b40e8', icon:'⏸️' },
    video_complete:{ bg:'rgba(0,212,170,0.15)', color:'#00d4aa', icon:'✅' },
  };
  return rows.map(row => {
    const s = EVENT_STYLE2[row.event_type] || { bg:'rgba(255,255,255,0.05)', color:'var(--muted)', icon:'📌' };
    const dt = row.created_at ? new Date(row.created_at) : null;
    const dateStr = dt ? dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) + '<br><span style="color:var(--muted);font-size:0.75rem;">' + dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) + '</span>' : '—';
    const emp     = row.employee_email || '—';
    const empName = _getEmpDisplayName(row);  // uses emp_id FK → Employee_name
    const dur = row.duration_seconds != null ? (row.duration_seconds >= 60 ? Math.floor(row.duration_seconds/60)+'m '+( row.duration_seconds%60)+'s' : row.duration_seconds+'s') : '—';
    const vid = row.video_title ? `<span title="${row.video_title}" style="display:block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.video_title}</span>${row.video_watch_percent != null ? '<span style=\'color:var(--muted);font-size:0.75rem;\'>' + row.video_watch_percent + '% watched</span>' : ''}` : '—';
    const cardDetail = row.card_name || row.event_detail || '—';
    const devIcon = row.device === 'mobile' ? '📱' : '💻';

    return `<tr style="border-bottom:1px solid var(--border);transition:background 0.15s;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <td style="padding:10px 14px;white-space:nowrap;color:var(--text2);font-size:0.79rem;">${dateStr}</td>
      <td style="padding:10px 14px;">
        <div style="font-weight:700;color:var(--text);font-size:0.84rem;">${empName}</div>
        <div style="color:var(--muted);font-size:0.73rem;">${emp !== '—' ? emp : ''}</div>
      </td>
      <td style="padding:10px 14px;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:0.75rem;font-weight:600;background:${s.bg};color:${s.color};">
          ${s.icon} ${(row.event_type||'').replace(/_/g,' ')}
        </span>
        ${row.session_duration_seconds ? '<div style="color:var(--muted);font-size:0.73rem;margin-top:3px;">Session: ' + (row.session_duration_seconds >= 60 ? Math.floor(row.session_duration_seconds/60)+'m' : row.session_duration_seconds+'s') + '</div>' : ''}
      </td>
      <td style="padding:10px 14px;color:var(--text2);font-size:0.81rem;white-space:nowrap;">${row.page_name || '—'}</td>
      <td style="padding:10px 14px;color:var(--text2);font-size:0.80rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${cardDetail}">${cardDetail}</td>
      <td style="padding:10px 14px;color:${dur!=='—'?'var(--accent2)':'var(--muted)'};font-weight:${dur!=='—'?'600':'400'};font-size:0.81rem;white-space:nowrap;">${dur}</td>
      <td style="padding:10px 14px;font-size:0.80rem;min-width:160px;max-width:220px;">${vid}</td>
      <td style="padding:10px 14px;text-align:center;font-size:1rem;" title="${row.device||''}">${devIcon}</td>
    </tr>`;
  }).join('');
}

function actLogPrevPage() { if (_actLogPage > 1) { _actLogPage--; renderActLogTable(); } }
function actLogNextPage() {
  const totalPages = Math.ceil(_actLogFiltered.length / _ACT_LOG_PER_PAGE);
  if (_actLogPage < totalPages) { _actLogPage++; renderActLogTable(); }
}

function renderActLogStats(rows) {
  const statsEl = document.getElementById('actlog-stats');
  if (!statsEl) return;
  const logins    = rows.filter(r => r.event_type === 'login').length;
  const logouts   = rows.filter(r => r.event_type === 'logout').length;
  const pageViews = rows.filter(r => r.event_type === 'page_view').length;
  const cardOpens = rows.filter(r => r.event_type === 'card_open').length;
  const videoPlay    = rows.filter(r => r.event_type === 'video_play').length;

  const trainingOpen = rows.filter(r => r.event_type === 'training_module_open' || r.event_type === 'training_submodule_open').length;
  const uniqueEmps   = new Set(rows.map(r=>r.employee_email || String(r.emp_id||'')).filter(Boolean)).size;

  const cards = [
    { icon:'🔐', label:'Total Logins',     value: logins,       color:'#00d4aa' },
    { icon:'👥', label:'Unique Users',     value: uniqueEmps,   color:'#4e9af1' },
    { icon:'📚', label:'Training Opens',   value: trainingOpen, color:'#6366f1' },
    { icon:'▶️', label:'Videos Played',   value: videoPlay,    color:'#a855f7' },

    { icon:'📂', label:'Cards Opened',     value: cardOpens,    color:'#f0a500' },
    { icon:'📊', label:'Total Events',     value: rows.length,  color:'#ff5c7c'},
  ];
  statsEl.innerHTML = cards.map(c => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;border-top:3px solid ${c.color};">
      <div style="font-size:1.5rem;margin-bottom:4px;">${c.icon}</div>
      <div style="font-size:1.5rem;font-weight:800;color:${c.color};">${c.value}</div>
      <div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">${c.label}</div>
    </div>`).join('');
}


