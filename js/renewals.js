// Section: Renewals & Collections — single tabbed panel.
// MIS sees all 5 tabs; a CRM person (crm_persons row matching their email,
// and not MIS) sees only "My Customers" with no tab bar at all. Upload and
// Resolve Unmatched are the two tabs migrated from their old standalone
// pages — unchanged in behavior, just relocated. My Customers is fully
// built; Unassigned Pool and Overview are placeholders for later stages.
//
// My Customers itself: a CRM person sees only their own assigned book.
// MIS/owner have no crm_persons row (they're not a CRM person), but still
// get full access — they see every customer across every CRM person, with
// an "Assigned To" column/filter to tell whose book each row belongs to.
// Actions that require a real crm_persons identity (logging a call —
// collection_calls.called_by is NOT NULL) are unavailable to MIS/owner here
// since there's no valid id to attribute them to; reassigning and editing
// Status remain available to MIS regardless. Recovered Amount is read-only
// everywhere — it's derived (SUM of collection_calls.amount_recovered for
// the customer, kept in sync by a DB trigger), entered only via the
// call-log popup's own "Amount recovered" field, which needs called_by too
// — so MIS/owner has no way to contribute to it, same limitation as Call.

const RU_BUCKET = 'accounts-uploads';
const RU_CATEGORY_FREQ = { Platinum: 'Once a Week', Gold: 'Twice a Week', Silver: 'Thrice a Week' };
const RU_CATEGORY_ORDER = ['Platinum', 'Gold', 'Silver'];
// collection_calls.not_connected_reason stores the raw <select> value — map
// back to its label so the calendar-cell tooltip shows "No Answer", not "no_answer".
const RU_NOT_CONNECTED_REASON_LABELS = { no_answer: 'No Answer', switched_off: 'Switched Off', call_later: 'Call Later' };

// crm_customers.crm_status — matches the "SCOT Sheet" status list/colors.
// Distinct from crm_customers.status, which tracks internal active/inactive
// lifecycle and isn't user-editable from this table.
const RU_CRM_STATUS_OPTIONS = [
  { value: 'Payment Recieved', color: '#00d4aa' },
  { value: 'Deactivated',      color: '#a855f7' },
  { value: 'Patch',            color: '#4e9af1' },
  { value: 'Shared Details',   color: '#eab308' },
  { value: 'Inactive',         color: '#ff5c7c' },
  { value: 'Partial Payment',  color: '#9aa3b2' },
];

// Optional columns for the My Customers table — Billing Name and Action are
// always shown and aren't part of this list. Visibility is a display
// preference only, so it's persisted client-side (localStorage), not synced
// server-side.
const RU_COLUMNS = [
  { key: 'assigned_to',          label: 'Assigned To' },
  { key: 'city',                 label: 'City' },
  { key: 'contact_person',       label: 'Contact Person' },
  { key: 'contact_number',       label: 'Contact Number' },
  { key: 'frequency',            label: 'Frequency' },
  { key: 'outstanding',          label: 'Outstanding', align: 'right' },
  { key: 'last_call',            label: 'Last Call' },
  { key: 'crm_status',           label: 'Status' },
  { key: 'recovered_amount',     label: 'Recovered Amount', align: 'right' },
  { key: 'current_outstanding',  label: 'Current Outstanding', align: 'right' },
];
const RU_COLUMNS_STORAGE_KEY = 'ru_my_customers_columns_v1';

function _ruLoadColumnPrefs() {
  try {
    const raw = localStorage.getItem(RU_COLUMNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) { /* corrupt/blocked storage — fall back to all-visible */ }
  return {};
}

let _ruColumnPrefs = _ruLoadColumnPrefs();

// Whether an optional column shows by default when the user hasn't explicitly
// toggled it. Only "assigned_to" is role-conditional — irrelevant noise for a
// CRM person (who only ever sees their own name), but the whole point of the
// column when MIS/owner is browsing everyone's book at once.
function _ruIsColumnVisible(key) {
  const pref = _ruColumnPrefs[key];
  if (pref !== undefined) return pref;
  return key === 'assigned_to' ? _ruIsMIS : true;
}
// Toggling a checkbox re-renders the whole tab (colspan depends on visible
// column count), which recreates the <details> element from scratch — track
// open/closed here so the rebuilt markup can restore it instead of always
// starting closed.
let _ruColumnsMenuOpen = false;

function ruToggleColumn(key, checked) {
  _ruColumnPrefs[key] = checked;
  try { localStorage.setItem(RU_COLUMNS_STORAGE_KEY, JSON.stringify(_ruColumnPrefs)); } catch (e) { /* ignore */ }
  ruRenderMyCustomers(document.getElementById('ruMyCustomersBody'));
}

// ── My Customers: unified list + calendar table ─────────────────────────
// Sunday isn't a working day, so this is N working-day columns, not N
// calendar days. User-configurable (see the day-count select in the nav
// toolbar); persisted the same way column visibility is — client-side only.
const RU_CALENDAR_DAYS_OPTIONS = [5, 10, 15, 20];
const RU_CALENDAR_DAYS_STORAGE_KEY = 'ru_my_customers_calendar_days_v1';

function _ruLoadCalendarDaysPref() {
  try {
    const raw = parseInt(localStorage.getItem(RU_CALENDAR_DAYS_STORAGE_KEY), 10);
    if (RU_CALENDAR_DAYS_OPTIONS.includes(raw)) return raw;
  } catch (e) { /* corrupt/blocked storage — fall back to default */ }
  return 10;
}

let _ruCalendarWorkingDays = _ruLoadCalendarDaysPref();
let _ruCalendarWindowEnd = null;  // ISO date string; null means "today"
let _ruCalendarCallsMap = null;   // Map<"customerId|date", row> for the current window; null = not loaded yet
let _ruCalendarLoading = false;
// Which edge to reveal on the next render — 'start' (Billing Name/leftmost
// columns) on initial load and after "Previous", 'end' (today/latest date
// column) after "Next", so the table opens showing who the customers are
// rather than the date grid, but still jumps to the newest dates on demand.
let _ruCalendarScrollAnchor = 'start';

// Formats a Date's LOCAL calendar date as YYYY-MM-DD. Never use toISOString()
// for this — it converts to UTC, which silently shifts the date backward by
// one day for any timezone ahead of UTC (e.g. IST). That bug previously made
// _ruAddDays(d, 1) return d unchanged, which turned the working-day loops
// below into infinite loops for every IST user.
function _ruDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _ruTodayStr() {
  return _ruDateStr(new Date());
}

function _ruAddDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return _ruDateStr(d);
}

function _ruIsSunday(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay() === 0;
}

// Steps n working days (Sundays skipped) from dateStr; negative n steps backward.
function _ruAddWorkingDays(dateStr, n) {
  let d = dateStr;
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d = _ruAddDays(d, step);
    if (!_ruIsSunday(d)) remaining--;
  }
  return d;
}

// Sunday has no working-day column, so an anchor that lands on one snaps back to Saturday.
function _ruLatestWorkingDay(dateStr) {
  return _ruIsSunday(dateStr) ? _ruAddWorkingDays(dateStr, -1) : dateStr;
}

function _ruCalendarDateRange() {
  const end = _ruLatestWorkingDay(_ruCalendarWindowEnd || _ruTodayStr());
  const start = _ruAddWorkingDays(end, -(_ruCalendarWorkingDays - 1));
  return { start, end };
}

function _ruCalendarDateList() {
  const { start, end } = _ruCalendarDateRange();
  const dates = [];
  let d = start;
  while (d <= end) {
    if (!_ruIsSunday(d)) dates.push(d);
    d = _ruAddDays(d, 1);
  }
  return dates;
}

function ruCalendarNav(direction) {
  if (_ruCalendarLoading) return;
  const { start, end } = _ruCalendarDateRange();
  const latestWorkingDay = _ruLatestWorkingDay(_ruTodayStr());

  let newEnd;
  if (direction === 'prev') {
    newEnd = _ruAddWorkingDays(start, -1);
    _ruCalendarScrollAnchor = 'start';
  } else {
    newEnd = _ruAddWorkingDays(end, _ruCalendarWorkingDays);
    if (newEnd > latestWorkingDay) newEnd = latestWorkingDay;
    if (newEnd === end) return; // already showing the most recent window
    _ruCalendarScrollAnchor = 'end';
  }

  _ruCalendarWindowEnd = newEnd;
  _ruCalendarCallsMap = null;
  ruLoadCalendarCalls();
}

// Changing the day-count keeps the current window's right edge (today, or
// wherever Prev/Next left off) fixed and just widens/narrows how far back it
// reaches — switching density shouldn't also throw away where the user was.
function ruChangeCalendarDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n === _ruCalendarWorkingDays) return;
  _ruCalendarWorkingDays = n;
  try { localStorage.setItem(RU_CALENDAR_DAYS_STORAGE_KEY, String(n)); } catch (e) { /* ignore */ }
  _ruCalendarCallsMap = null;
  ruLoadCalendarCalls();
}

// Fetches collection_calls for the assigned customers, scoped to the current
// working-day window only — never the whole history — so this stays fast
// regardless of how far back a person's call log goes.
async function ruLoadCalendarCalls() {
  _ruCalendarLoading = true;
  const container = document.getElementById('ruMyCustomersBody');
  if (container) ruRenderMyCustomers(container); // shows the loading state immediately

  const ids = _ruMyCustomers.map(c => c.id);
  if (!ids.length) {
    _ruCalendarCallsMap = new Map();
    _ruCalendarLoading = false;
    if (container) ruRenderMyCustomers(container);
    return;
  }

  const { start, end } = _ruCalendarDateRange();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/collection_calls?customer_id=in.(${ids.join(',')})&call_date=gte.${start}&call_date=lte.${end}&select=customer_id,call_date,connected,conversation_notes,not_connected_reason&order=call_date.asc`,
      { headers: SB_HDRS() },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    _ruCalendarCallsMap = new Map(rows.map(r => [`${r.customer_id}|${r.call_date}`, r]));
  } catch (e) {
    console.error('ruLoadCalendarCalls failed:', e);
    _ruCalendarCallsMap = new Map(); // render an empty grid rather than stay stuck loading
  } finally {
    _ruCalendarLoading = false;
    const c2 = document.getElementById('ruMyCustomersBody');
    if (c2) ruRenderMyCustomers(c2);
  }
}

function _ruCalendarNavHtml() {
  const { start, end } = _ruCalendarDateRange();
  const atToday = end === _ruLatestWorkingDay(_ruTodayStr());
  const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const btnStyle = 'padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;';
  const btnDisabled = 'padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);font-size:0.78rem;font-weight:700;cursor:not-allowed;font-family:inherit;opacity:0.5;';
  const nextDisabled = atToday || _ruCalendarLoading;
  const daysOptions = RU_CALENDAR_DAYS_OPTIONS
    .map(n => `<option value="${n}" ${n === _ruCalendarWorkingDays ? 'selected' : ''}>${n} days</option>`)
    .join('');
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <button onclick="ruCalendarNav('prev')" ${_ruCalendarLoading ? 'disabled' : ''} style="${_ruCalendarLoading ? btnDisabled : btnStyle}">◀ Previous ${_ruCalendarWorkingDays} working days</button>
      <span style="font-size:0.82rem;color:var(--muted);font-weight:600;white-space:nowrap;">${fmt(start)} – ${fmt(end)}</span>
      <button onclick="ruCalendarNav('next')" ${nextDisabled ? 'disabled' : ''} style="${nextDisabled ? btnDisabled : btnStyle}">Next ${_ruCalendarWorkingDays} working days ▶</button>
      <select onchange="ruChangeCalendarDays(this.value)" ${_ruCalendarLoading ? 'disabled' : ''} title="Working days shown per page" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;">
        ${daysOptions}
      </select>
    </div>
  `;
}

function _ruCalendarCellHtml(customerId, dateStr) {
  const rec = _ruCalendarCallsMap ? _ruCalendarCallsMap.get(`${customerId}|${dateStr}`) : null;
  let bg = 'transparent';
  let note = '';
  if (rec) {
    if (rec.connected) {
      bg = '#00d4aa';
      note = rec.conversation_notes || '';
    } else {
      bg = '#ff5c7c';
      note = RU_NOT_CONNECTED_REASON_LABELS[rec.not_connected_reason] || rec.not_connected_reason || '';
    }
  }
  // A native `title` tooltip can't be styled and renders long notes poorly —
  // ruShowCallTooltip/ruHideCallTooltip drive a single shared, styled tooltip
  // element instead (see ruCustomerDetailOverlay's sibling in index.html).
  const hoverAttrs = note
    ? `data-note="${_ruEsc(note)}" onmouseenter="ruShowCallTooltip(event, this)" onmouseleave="ruHideCallTooltip()" style="display:inline-block;width:18px;height:18px;border-radius:5px;background:${bg};border:1px solid var(--border);cursor:help;"`
    : `style="display:inline-block;width:18px;height:18px;border-radius:5px;background:${bg};border:1px solid var(--border);"`;
  return `<td style="text-align:center;padding:6px;"><span ${hoverAttrs}></span></td>`;
}

// Anchored to the hovered dot (not the cursor) and clamped to the viewport via
// position:fixed — this deliberately ignores the table's own scroll/overflow
// clipping, which is what made the old native `title` tooltip cut off at
// table edges when a cell sat near the scrolled-out boundary. Opens BELOW the
// cell by default, flipping above only when there isn't room below.
function ruShowCallTooltip(event, el) {
  const note = el.dataset.note;
  if (!note) return;
  const tip = document.getElementById('ruCallTooltip');
  if (!tip) return;
  tip.textContent = note;
  tip.style.display = 'block';

  const pad = 8;
  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect(); // safe to measure now that display:block has laid it out

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.min(Math.max(pad, left), window.innerWidth - tipRect.width - pad);

  let top = rect.bottom + pad; // default: below the cell
  if (top + tipRect.height > window.innerHeight - pad) top = rect.top - tipRect.height - pad; // not enough room below — flip above
  top = Math.max(pad, top);

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function ruHideCallTooltip() {
  const tip = document.getElementById('ruCallTooltip');
  if (tip) tip.style.display = 'none';
}

function _ruCalendarDateHeaderHtml() {
  const dates = _ruCalendarDateList();
  const highlightDate = _ruLatestWorkingDay(_ruTodayStr()); // today itself if it's Sunday has no column, so highlight Saturday instead
  return dates.map(d => `<th style="text-align:center;white-space:nowrap;${d === highlightDate ? 'color:#00d4aa;' : ''}">${new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</th>`).join('');
}

let _ruMyCustomers = []; // cached merged rows for the My Customers tab
let _ruAllPersons = [];  // active crm_persons, for the Reassign dropdown
// MIS/owner-only: '' = All, '__unassigned__', or a crm_persons.id — narrows
// the (otherwise everyone's-book) table client-side, no refetch needed.
let _ruAssignedToFilter = '';

let _ruUnassignedPool = [];      // cached merged rows for the Unassigned Pool tab
let _ruUnassignedPersons = [];   // active crm_persons, for the Unassigned Pool "Assign to" dropdown
let _ruUnassignedPoolCount = 0;  // shown as a "(N)" suffix on the tab button itself

const RU_TABS = [
  { id: 'myCustomers',    label: 'My Customers' },
  { id: 'upload',         label: 'Upload' },
  { id: 'unmatched',      label: 'Resolve Unmatched' },
  { id: 'unassignedPool', label: 'Unassigned Pool' },
  { id: 'overview',       label: 'Overview' },
];

let _ruFile = null;
let _ruPersons = [];
let _ruPollTimer = null;
let _ruIsMIS = false;
let _ruCrmPerson = null; // { id, name } | null — set by _applyRenewalsNavVisibility()
let _ruActiveTab = null;

// raw_name/file names come from uploaded Excel data — untrusted — escape before innerHTML.
function _ruEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ── Nav visibility — MIS OR a matching (by email) active crm_persons row ───
async function _applyRenewalsNavVisibility() {
  const nav = document.getElementById('nav-renewals');
  const mm  = document.getElementById('mm-renewals');
  const rawRole = String((CURRENT_USER && (CURRENT_USER.rawRole || CURRENT_USER.role)) || '').toLowerCase().trim();
  _ruIsMIS = (rawRole === 'owner' || rawRole === 'mis');
  _ruCrmPerson = null;

  if (!_ruIsMIS && CURRENT_USER && CURRENT_USER.email) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_persons?email=ilike.${encodeURIComponent(CURRENT_USER.email)}&is_active=eq.true&select=id,name&limit=1`,
        { headers: SB_HDRS() },
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) _ruCrmPerson = rows[0];
    } catch (e) {
      // treat as no match — nav item just won't show
    }
  }

  const hasAccess = _ruIsMIS || !!_ruCrmPerson;
  if (nav) nav.style.display = hasAccess ? '' : 'none';
  if (mm)  mm.style.display  = hasAccess ? 'flex' : 'none';
  if (_ruIsMIS) {
    _ruRefreshUnmatchedBadge();
    _ruRefreshUnassignedPoolBadge();
  }
}

// Small helper — exact row count via PostgREST's Content-Range header, no rows fetched.
async function _ruCount(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}&select=id`, {
    method: 'HEAD',
    headers: { ...SB_HDRS(), 'Prefer': 'count=exact' },
  });
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

async function _ruRefreshUnmatchedBadge() {
  try {
    const count = await _ruCount('unmatched_import_names', 'resolved=eq.false');
    const badge = document.getElementById('renewalsUnmatchedBadge');
    const badgeMob = document.getElementById('renewalsUnmatchedBadgeMob');
    [badge, badgeMob].forEach(b => {
      if (!b) return;
      b.textContent = count;
      b.style.display = count > 0 ? '' : 'none';
    });
  } catch (e) { /* badge is cosmetic — ignore failures */ }
}

// Unassigned Pool's count lives on the tab button's own label ("Unassigned
// Pool (12)") rather than a separate pill, so it's a plain textContent patch
// on that one button — never a full ruRenderTabBar() re-render, which would
// reset every button to its inactive style and lose the active-tab highlight.
function _ruUnassignedPoolTabLabel() {
  return _ruUnassignedPoolCount > 0 ? `Unassigned Pool (${_ruUnassignedPoolCount})` : 'Unassigned Pool';
}

function _ruUpdateUnassignedPoolTabLabel() {
  const btn = document.getElementById('ruTabBtn-unassignedPool');
  if (btn) btn.textContent = _ruUnassignedPoolTabLabel();
}

async function _ruRefreshUnassignedPoolBadge() {
  try {
    _ruUnassignedPoolCount = await _ruCount('crm_customers', 'assigned_crm_person_id=is.null');
    _ruUpdateUnassignedPoolTabLabel();
  } catch (e) { /* badge is cosmetic — ignore failures */ }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB CONTAINER
// ═══════════════════════════════════════════════════════════════════════

function _ruVisibleTabIds() {
  if (_ruIsMIS) return RU_TABS.map(t => t.id);
  if (_ruCrmPerson) return ['myCustomers', 'overview'];
  return [];
}

function _ruTabBtnStyle(active) {
  return active
    ? 'padding:8px 18px;border:1.5px solid #00d4aa;background:#00d4aa;color:#04231d;border-radius:8px;font-size:0.84rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .18s;'
    : 'padding:8px 18px;border:1.5px solid var(--border);background:var(--surface2);color:var(--muted);border-radius:8px;font-size:0.84rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .18s;';
}

// Renders only the buttons this user is allowed to see. If there's nothing to
// switch between (a CRM person only ever has one option), no bar is rendered
// at all — not a disabled/hidden button, nothing in the DOM to select.
function ruRenderTabBar() {
  const bar = document.getElementById('ruTabBar');
  if (!bar) return;
  const visible = _ruVisibleTabIds();

  if (visible.length <= 1) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = RU_TABS
    .filter(t => visible.includes(t.id))
    .map(t => `<button id="ruTabBtn-${t.id}" onclick="ruSwitchTab('${t.id}')" style="${_ruTabBtnStyle(false)}">${t.id === 'unassignedPool' ? _ruUnassignedPoolTabLabel() : t.label}</button>`)
    .join('');
}

function ruSwitchTab(tabId) {
  // Backstop, not the primary control — the tab bar itself only ever renders
  // buttons this user is allowed to see.
  if (!_ruVisibleTabIds().includes(tabId)) return;

  _ruActiveTab = tabId;

  RU_TABS.forEach(t => {
    const content = document.getElementById(`ruTab-${t.id}`);
    if (content) content.style.display = (t.id === tabId) ? 'block' : 'none';
    const btn = document.getElementById(`ruTabBtn-${t.id}`);
    if (btn) btn.setAttribute('style', _ruTabBtnStyle(t.id === tabId));
  });

  if (tabId === 'upload') loadRenewalsUpload();
  else if (tabId === 'unmatched') loadRenewalsUnmatched();
  else if (tabId === 'myCustomers') loadRenewalsMyCustomers();
  else if (tabId === 'unassignedPool') loadRenewalsUnassignedPool();
  else if (tabId === 'overview') loadRenewalsOverview();
}

// Called once per nav click into the module (switchDB('renewals') hook in
// app.js) — always lands on Overview, for both MIS and a CRM person. Tab
// state while already inside the module is a separate path (the tab bar's
// buttons call ruSwitchTab() directly, never back through here), so
// switching tabs internally isn't reset by this.
function loadRenewals() {
  ruRenderTabBar();
  const visible = _ruVisibleTabIds();
  if (!visible.length) return; // shouldn't happen — the nav item itself would be hidden

  _ruActiveTab = 'overview';
  ruSwitchTab(_ruActiveTab);
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Upload — migrated as-is from the old standalone panel-renewalsUpload
// ═══════════════════════════════════════════════════════════════════════

function loadRenewalsUpload() {
  const zone = document.getElementById('ruDropZone');
  zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = '#00d4aa'; };
  zone.ondragleave = () => { zone.style.borderColor = ''; };
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files.length) ruHandleFileSelect(e.dataTransfer.files[0]);
  };
  ruLoadHistory();
}

function ruHandleFileSelect(file) {
  if (!file) return;
  if (!/\.xlsx?$/i.test(file.name)) {
    alert('⚠️ Please choose an .xlsx or .xls file.');
    return;
  }
  _ruFile = file;
  document.getElementById('ruDropLabel').textContent = file.name;
  const btn = document.getElementById('ruSubmitBtn');
  btn.disabled = false;
  btn.style.opacity = '1';
}

async function ruUpload() {
  if (!_ruFile) return;
  const btn = document.getElementById('ruSubmitBtn');
  const statusBox = document.getElementById('ruStatus');
  const statusText = document.getElementById('ruStatusText');
  const statusSummary = document.getElementById('ruStatusSummary');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  statusBox.style.display = 'block';
  statusSummary.textContent = '';
  statusText.textContent = '⏳ Uploading file…';

  try {
    const safeName = _ruFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}_${safeName}`;
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/${RU_BUCKET}/${encodeURIComponent(path)}`;

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', storageUrl);
      xhr.setRequestHeader('apikey', SUPABASE_ANON);
      xhr.setRequestHeader('Authorization', `Bearer ${_currentToken}`);
      xhr.setRequestHeader('Content-Type', _ruFile.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Storage upload: HTTP ' + xhr.status + ' — ' + xhr.responseText.slice(0, 200)));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(_ruFile);
    });

    statusText.textContent = '⏳ Processing… (this runs in the background, may take a minute)';
    ruWatchProcessing(path);
  } catch (e) {
    statusText.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// Polls import_jobs directly instead of diffing row counts — the pipeline
// upserts (same customer + same date = update, not insert), so re-processing
// the same file never changes counts even on a fully successful run. The
// trigger creates the import_jobs row asynchronously right after the storage
// commit, so an empty result for the first tick or two is expected, not an error.
function ruWatchProcessing(filePath) {
  if (_ruPollTimer) clearInterval(_ruPollTimer);
  let attempts = 0;
  const maxAttempts = 40; // ~2 minutes at 3s intervals

  _ruPollTimer = setInterval(async () => {
    attempts++;

    // A single failed poll (network blip, transient error, whatever) must never
    // silently kill the loop — catch it, log it, and let the next tick retry.
    let job = null;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/import_jobs?file_path=eq.${encodeURIComponent(filePath)}&order=created_at.desc&limit=1`,
        { headers: SB_HDRS() },
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      job = Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch (e) {
      console.error(`ruWatchProcessing: poll attempt ${attempts} failed —`, e); // TEMP — remove once confirmed stable
    }

    const finished = job && job.status !== 'processing';

    // Guaranteed to resolve within maxAttempts either way — even if every
    // single poll above threw (or the job row never appeared), this still
    // fires and shows the fallback message.
    if (finished || attempts >= maxAttempts) {
      clearInterval(_ruPollTimer);
      _ruPollTimer = null;
      const statusText = document.getElementById('ruStatusText');
      const statusSummary = document.getElementById('ruStatusSummary');
      const btn = document.getElementById('ruSubmitBtn');
      if (job && job.status === 'done') {
        statusText.textContent = '✅ Done';
        statusSummary.textContent =
          `Rows processed: ${job.rows_processed} · Matched: ${job.matched} · Unmatched: ${job.unmatched} · Missing from file (assumed paid): ${job.closed}`;
      } else if (job && job.status === 'error') {
        statusText.textContent = '❌ Processing failed';
        statusSummary.textContent = job.error_message || 'Unknown error';
      } else {
        statusText.textContent = '⚠️ Still processing after 2 minutes';
        statusSummary.textContent = 'No status update yet — refresh this page shortly to re-check.';
      }
      btn.disabled = false;
      btn.style.opacity = '1';
      _ruFile = null;
      document.getElementById('ruFileInput').value = '';
      document.getElementById('ruDropLabel').textContent = 'Click to choose or drag & drop the Accounts Excel file';
      ruLoadHistory();
      _ruRefreshUnmatchedBadge();
    }
  }, 3000);
}

async function ruLoadHistory() {
  const body = document.getElementById('ruHistoryBody');
  body.innerHTML = '<tr><td colspan="3" style="padding:12px;color:var(--muted);">Loading…</td></tr>';
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${RU_BUCKET}`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ prefix: '', limit: 20, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('ruLoadHistory failed:', res.status, errText); // TEMP — remove once confirmed fixed
      throw new Error('HTTP ' + res.status + ' — ' + errText.slice(0, 200));
    }
    const files = await res.json();
    if (!Array.isArray(files) || !files.length) {
      body.innerHTML = '<tr><td colspan="3" style="padding:12px;color:var(--muted);">No uploads yet.</td></tr>';
      return;
    }

    // Joined by file_path — the same matching key ruWatchProcessing already
    // uses to find a specific upload's import_jobs row. Storage object names
    // are sanitized to [a-zA-Z0-9._-] at upload time (see ruUpload's
    // safeName), so they're safe to join unquoted into an in.() filter here.
    const jobsByFile = new Map();
    try {
      const jobsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/import_jobs?file_path=in.(${files.map(f => f.name).join(',')})&select=id,file_path,closed`,
        { headers: SB_HDRS() },
      );
      if (jobsRes.ok) {
        const jobs = await jobsRes.json();
        jobs.forEach(j => jobsByFile.set(j.file_path, j));
      }
    } catch (e) {
      // Supplementary — a failure here shouldn't block showing the file
      // list itself, every row just falls back to showing "—".
    }

    body.innerHTML = files.map(f => {
      const job = jobsByFile.get(f.name);
      const closedCell = (job && job.closed > 0)
        ? `<button onclick="ruToggleClosedList('${job.id}')" style="padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);font-size:0.78rem;font-weight:600;cursor:pointer;font-family:inherit;">${job.closed} assumed paid · View</button>`
        : '<span style="color:var(--muted);">—</span>';
      return `
        <tr>
          <td style="padding:8px;">${_ruEsc(f.name)}</td>
          <td style="padding:8px;">${f.created_at ? new Date(f.created_at).toLocaleString('en-IN') : '—'}</td>
          <td style="padding:8px;">${closedCell}</td>
        </tr>
        ${job && job.closed > 0 ? `
        <tr id="ruClosedPanel-${job.id}" style="display:none;">
          <td colspan="3" style="padding:0 8px 10px;">
            <div id="ruClosedList-${job.id}" style="max-width:420px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface2);font-size:0.82rem;"></div>
          </td>
        </tr>` : ''}
      `;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="3" style="padding:12px;color:var(--hot,#ff5c7c);">⚠️ Could not load history: ${e.message}</td></tr>`;
  }
}

// Same toggle-a-hidden-row pattern as ruToggleCallPanel. Fetches the closure
// list once on first expand (dataset.loaded caches it — collapsing/
// re-expanding doesn't re-fetch).
async function ruToggleClosedList(jobId) {
  const panel = document.getElementById(`ruClosedPanel-${jobId}`);
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'table-row' : 'none';
  if (!opening) return;

  const listEl = document.getElementById(`ruClosedList-${jobId}`);
  if (listEl.dataset.loaded) return;
  listEl.innerHTML = '<p style="color:var(--muted);margin:0;">Loading…</p>';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/import_job_closures?import_job_id=eq.${jobId}&select=billing_name,prev_grand_total&order=billing_name.asc`,
      { headers: SB_HDRS() },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    listEl.dataset.loaded = 'true';
    if (!rows.length) {
      listEl.innerHTML = '<p style="color:var(--muted);margin:0;">No closures recorded for this import.</p>';
      return;
    }
    listEl.innerHTML = rows.map(r => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;">
        <span>${_ruEsc(r.billing_name)}</span>
        <span style="color:var(--muted);">₹${Number(r.prev_grand_total).toLocaleString('en-IN')}</span>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<p style="color:var(--hot,#ff5c7c);margin:0;">⚠️ Could not load: ${e.message}</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Resolve Unmatched — migrated as-is from the old standalone
// panel-renewalsUnmatched
// ═══════════════════════════════════════════════════════════════════════

async function loadRenewalsUnmatched() {
  const body = document.getElementById('ruUnmatchedBody');
  body.innerHTML = '<tr><td colspan="10" style="padding:12px;color:var(--muted);">Loading…</td></tr>';
  try {
    const [personsRes, rowsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/crm_persons?is_active=eq.true&select=id,name&order=name.asc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/unmatched_import_names?resolved=eq.false&order=grand_total.desc&select=*`, { headers: SB_HDRS() }),
    ]);
    if (!personsRes.ok) throw new Error('crm_persons: HTTP ' + personsRes.status);
    if (!rowsRes.ok) throw new Error('unmatched_import_names: HTTP ' + rowsRes.status);
    _ruPersons = await personsRes.json();
    const rows = await rowsRes.json();
    ruRenderUnmatched(rows);
  } catch (e) {
    body.innerHTML = `<tr><td colspan="10" style="padding:12px;color:var(--hot,#ff5c7c);">⚠️ ${e.message}</td></tr>`;
  }
}

function ruRenderUnmatched(rows) {
  const body = document.getElementById('ruUnmatchedBody');
  const countEl = document.getElementById('ruUnmatchedCount');
  countEl.textContent = `${rows.length} unresolved`;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" style="padding:12px;color:var(--muted);">Nothing to resolve 🎉</td></tr>';
    return;
  }

  const personOptions = '<option value="">Select person…</option>' +
    _ruPersons.map(p => `<option value="${p.id}">${_ruEsc(p.name)}</option>`).join('');
  const categoryOptions = '<option value="">Select…</option>' +
    Object.keys(RU_CATEGORY_FREQ).map(c => `<option value="${c}">${c}</option>`).join('');

  body.innerHTML = rows.map(r => `
    <tr id="ruRow-${r.id}">
      <td style="padding:8px;">${_ruEsc(r.raw_name)}</td>
      <td style="padding:8px;text-align:right;">${Number(r.grand_total || 0).toLocaleString('en-IN')}</td>
      <td style="padding:8px;text-align:right;">${Number(r.bucket_0_30 || 0).toLocaleString('en-IN')}</td>
      <td style="padding:8px;text-align:right;">${Number(r.bucket_31_60 || 0).toLocaleString('en-IN')}</td>
      <td style="padding:8px;text-align:right;">${Number(r.bucket_61_90 || 0).toLocaleString('en-IN')}</td>
      <td style="padding:8px;text-align:right;">${Number(r.bucket_above_90 || 0).toLocaleString('en-IN')}</td>
      <td style="padding:8px;">${r.import_batch_date || '—'}</td>
      <td style="padding:8px;">
        <select id="ruPerson-${r.id}" style="width:100%;padding:4px;border-radius:6px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);">${personOptions}</select>
      </td>
      <td style="padding:8px;">
        <select id="ruCategory-${r.id}" style="width:100%;padding:4px;border-radius:6px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);">${categoryOptions}</select>
      </td>
      <td style="padding:8px;text-align:center;white-space:nowrap;">
        <button onclick="ruAssign('${r.id}')" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(0,212,170,0.4);background:rgba(0,212,170,0.08);color:#00d4aa;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;margin-right:4px;">Assign</button>
        <button onclick="ruIgnore('${r.id}')" style="padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;">Ignore</button>
      </td>
    </tr>
  `).join('');
}

async function ruAssign(id) {
  const personId = document.getElementById(`ruPerson-${id}`).value;
  const category = document.getElementById(`ruCategory-${id}`).value;
  if (!personId) { alert('⚠️ Please select a person to assign.'); return; }
  if (!category) { alert('⚠️ Please select a category.'); return; }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_unmatched_customer`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ p_unmatched_id: id, p_person_id: personId, p_category: category }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || ('HTTP ' + res.status));
    }
    const row = document.getElementById(`ruRow-${id}`);
    if (row) row.remove();
    _ruRefreshUnmatchedBadge();
    const countEl = document.getElementById('ruUnmatchedCount');
    const remaining = document.querySelectorAll('#ruUnmatchedBody tr[id^="ruRow-"]').length;
    countEl.textContent = `${remaining} unresolved`;
  } catch (e) {
    alert('❌ Could not assign: ' + e.message);
  }
}

async function ruIgnore(id) {
  if (!confirm('Mark this row as resolved without creating a customer?')) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/unmatched_import_names?id=eq.${id}`, {
      method: 'PATCH',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify({ resolved: true }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const row = document.getElementById(`ruRow-${id}`);
    if (row) row.remove();
    _ruRefreshUnmatchedBadge();
    const countEl = document.getElementById('ruUnmatchedCount');
    const remaining = document.querySelectorAll('#ruUnmatchedBody tr[id^="ruRow-"]').length;
    countEl.textContent = `${remaining} unresolved`;
  } catch (e) {
    alert('❌ Could not ignore: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: My Customers
// ═══════════════════════════════════════════════════════════════════════

async function loadRenewalsMyCustomers() {
  const container = document.getElementById('ruMyCustomersBody');
  if (!_ruIsMIS && !_ruCrmPerson) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.88rem;">No CRM person profile matched to your account.</p>';
    return;
  }
  container.innerHTML = '<p style="color:var(--muted);font-size:0.88rem;">Loading…</p>';

  try {
    // MIS/owner see every customer across every CRM person; a CRM person
    // still only sees their own assigned book.
    const scopeQuery = _ruIsMIS ? '' : `&assigned_crm_person_id=eq.${_ruCrmPerson.id}`;
    const custRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_customers?select=*&order=billing_name.asc${scopeQuery}`,
      { headers: SB_HDRS() },
    );
    if (!custRes.ok) throw new Error('crm_customers: HTTP ' + custRes.status);
    const customers = await custRes.json();

    if (!customers.length) {
      container.innerHTML = `<p style="color:var(--muted);font-size:0.88rem;">${_ruIsMIS ? 'No customers found.' : 'No customers assigned to you yet.'}</p>`;
      return;
    }

    const ids = customers.map(c => c.id).join(',');
    const [snapRes, callRes, personsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/latest_outstanding_snapshots?customer_id=in.(${ids})&select=customer_id,grand_total`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/latest_collection_calls?customer_id=in.(${ids})&select=customer_id,call_date,connected`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/crm_persons?is_active=eq.true&select=id,name&order=name.asc`, { headers: SB_HDRS() }),
    ]);
    if (!snapRes.ok) throw new Error('latest_outstanding_snapshots: HTTP ' + snapRes.status);
    if (!callRes.ok) throw new Error('latest_collection_calls: HTTP ' + callRes.status);
    if (!personsRes.ok) throw new Error('crm_persons: HTTP ' + personsRes.status);

    const snaps = await snapRes.json();
    const calls = await callRes.json();
    _ruAllPersons = await personsRes.json();

    const snapMap = new Map(snaps.map(s => [s.customer_id, s]));
    const callMap = new Map(calls.map(c => [c.customer_id, c]));

    _ruMyCustomers = customers.map(c => ({
      ...c,
      _snapshot: snapMap.get(c.id) || null,
      _lastCall: callMap.get(c.id) || null,
    }));

    // Customer set/assignment may have changed since the last load — force a
    // fresh calendar fetch rather than risk showing stale customer/date data.
    _ruCalendarCallsMap = null;
    _ruCalendarScrollAnchor = 'start'; // every fresh tab load opens on Billing Name, not wherever a past nav click left off
    _ruAssignedToFilter = ''; // every fresh tab load opens showing everyone, not wherever a past filter selection left off
    ruLoadCalendarCalls();
  } catch (e) {
    container.innerHTML = `<p style="color:var(--hot,#ff5c7c);font-size:0.88rem;">⚠️ ${e.message}</p>`;
  }
}

function _ruColumnsMenuHtml() {
  const checkboxes = RU_COLUMNS.map(col => `
    <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;color:var(--text);padding:5px 0;cursor:pointer;">
      <input type="checkbox" ${_ruIsColumnVisible(col.key) ? 'checked' : ''} onchange="ruToggleColumn('${col.key}', this.checked)">
      ${col.label}
    </label>
  `).join('');

  return `
    <details class="ru-columns-menu" ${_ruColumnsMenuOpen ? 'open' : ''} ontoggle="_ruColumnsMenuOpen = this.open" style="position:relative;">
      <summary style="padding:7px 14px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text2);font-size:0.8rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
        Columns
      </summary>
      <div style="position:absolute;left:0;top:calc(100% + 6px);z-index:500;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 14px;min-width:190px;max-height:280px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);">
        ${checkboxes}
      </div>
    </details>
  `;
}

// The <details> menu only toggles via its own summary click — without this, it
// stays open (covering the table header underneath) until the user explicitly
// clicks "Columns" again. Delegated on document since the menu is rebuilt
// from scratch on every render.
document.addEventListener('click', (e) => {
  const menu = document.querySelector('#panel-renewals .ru-columns-menu[open]');
  if (menu && !menu.contains(e.target)) {
    menu.removeAttribute('open');
    _ruColumnsMenuOpen = false;
  }
});

function _ruAssignedToFilterHtml() {
  if (!_ruIsMIS) return ''; // a CRM person only ever sees their own book — nothing to filter
  const options = _ruAllPersons
    .map(p => `<option value="${p.id}" ${_ruAssignedToFilter === p.id ? 'selected' : ''}>${_ruEsc(p.name)}</option>`)
    .join('');
  return `
    <select onchange="ruChangeAssignedToFilter(this.value)" style="padding:7px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text2);font-size:0.8rem;font-weight:700;cursor:pointer;font-family:inherit;">
      <option value="" ${_ruAssignedToFilter === '' ? 'selected' : ''}>Assigned To: All</option>
      <option value="__unassigned__" ${_ruAssignedToFilter === '__unassigned__' ? 'selected' : ''}>— Unassigned —</option>
      ${options}
    </select>
  `;
}

function ruChangeAssignedToFilter(value) {
  if (value === _ruAssignedToFilter) return;
  _ruAssignedToFilter = value;
  ruRenderMyCustomers(document.getElementById('ruMyCustomersBody'));
}

function ruRenderMyCustomers(container) {
  if (!container) return;

  const toolbar = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${_ruColumnsMenuHtml()}
        ${_ruAssignedToFilterHtml()}
      </div>
      ${_ruCalendarNavHtml()}
    </div>
  `;

  container.innerHTML = toolbar + _ruRenderMyCustomersTableBody();

  // The date columns render oldest → newest and scroll horizontally, so
  // without this the table would default to whatever edge the browser
  // happens to lay out first.
  _ruSyncCalendarScroll(container);
}

// Sizes each section's top scrollbar to match its table's real width, moves
// both the top bar and the table to _ruCalendarScrollAnchor's edge, and keeps
// the two in sync so dragging either one scrolls the other. Re-run on every
// render since a full re-render (toggling a column, saving a call, nav)
// replaces the DOM — old listeners go with it, so this always re-attaches
// fresh ones rather than relying on anything surviving between renders.
function _ruSyncCalendarScroll(container) {
  requestAnimationFrame(() => {
    container.querySelectorAll('.table-card').forEach(card => {
      const bottom = card.querySelector('.table-scroll:not(.ru-scroll-top)');
      const top = card.querySelector('.ru-scroll-top');
      if (!bottom) return;

      if (top) {
        const table = bottom.querySelector('table');
        const spacer = top.querySelector('.ru-scroll-top-spacer');
        if (table && spacer) spacer.style.width = `${table.scrollWidth}px`;
      }

      const targetLeft = _ruCalendarScrollAnchor === 'start' ? 0 : bottom.scrollWidth;
      bottom.scrollLeft = targetLeft;
      if (!top) return;
      top.scrollLeft = targetLeft;

      let syncing = false;
      top.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true; bottom.scrollLeft = top.scrollLeft; syncing = false;
      });
      bottom.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true; top.scrollLeft = bottom.scrollLeft; syncing = false;
      });
    });
  });
}

function _ruRenderMyCustomersTableBody() {
  if (_ruCalendarLoading || _ruCalendarCallsMap === null) {
    return '<p style="color:var(--muted);font-size:0.88rem;">Loading call history…</p>';
  }

  const optionalVisible = RU_COLUMNS.filter(col => _ruIsColumnVisible(col.key));
  const dates = _ruCalendarDateList();
  const colCount = 2 + optionalVisible.length + dates.length; // Billing Name + Action are always shown
  const dateHeaderHtml = _ruCalendarDateHeaderHtml();

  // MIS/owner-only filter (irrelevant/'' for a CRM person, who's already
  // scoped to their own book by the fetch itself).
  const visibleCustomers = !_ruAssignedToFilter ? _ruMyCustomers : _ruMyCustomers.filter(c =>
    _ruAssignedToFilter === '__unassigned__' ? !c.assigned_crm_person_id : c.assigned_crm_person_id === _ruAssignedToFilter
  );

  const sections = RU_CATEGORY_ORDER.map(cat => {
    const inCat = visibleCustomers.filter(c => c.category === cat);
    if (!inCat.length) return '';

    // Highest outstanding first — the customers most worth calling today.
    // A customer with no snapshot yet (nothing owed on record) sorts last.
    const sorted = [...inCat].sort((a, b) => {
      const aTotal = a._snapshot ? Number(a._snapshot.grand_total) : -Infinity;
      const bTotal = b._snapshot ? Number(b._snapshot.grand_total) : -Infinity;
      return bTotal - aTotal || a.billing_name.localeCompare(b.billing_name);
    });

    const freq = RU_CATEGORY_FREQ[cat];

    return `
      <div class="table-card" style="margin-bottom:20px;">
        <div class="table-header">
          <span class="table-title">${cat} (${inCat.length})${freq ? ` — ${freq}` : ''}</span>
        </div>
        <div class="table-scroll ru-scroll-top"><div class="ru-scroll-top-spacer"></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Billing Name</th>
              ${optionalVisible.map(col => `<th${col.align === 'right' ? ' style="text-align:right;"' : ''}>${col.label}</th>`).join('')}
              <th style="text-align:center;">Action</th>
              ${dateHeaderHtml}
            </tr></thead>
            <tbody>${sorted.map(c => ruCustomerRowHtml(c, optionalVisible, dates, colCount)).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  return sections || `<p style="color:var(--muted);font-size:0.88rem;">${_ruAssignedToFilter ? 'No customers match this filter.' : (_ruIsMIS ? 'No customers found.' : 'No customers assigned to you yet.')}</p>`;
}

function _ruLastCallText(customer) {
  const lastCall = customer._lastCall;
  return lastCall && lastCall.call_date
    ? `${lastCall.call_date} · ${lastCall.connected ? 'Connected' : 'Not connected'}`
    : 'Never called';
}

function _ruAssignedPersonName(customer) {
  if (!customer.assigned_crm_person_id) return null; // truly unassigned
  const person = _ruAllPersons.find(p => p.id === customer.assigned_crm_person_id);
  return person ? person.name : '(inactive person)'; // id set but no longer an active crm_persons row
}

function _ruColumnCellHtml(key, c) {
  switch (key) {
    case 'assigned_to': return `<td>${_ruEsc(_ruAssignedPersonName(c) || '— Unassigned —')}</td>`;
    case 'city': return `<td>${_ruEsc(c.city || '—')}</td>`;
    case 'contact_person': return _ruEditableCellHtml('contact_person', c);
    case 'contact_number': return _ruEditableCellHtml('contact_number', c);
    case 'frequency': return `<td>${_ruEsc(c.calling_frequency || '—')}</td>`;
    case 'outstanding': {
      const grandTotal = c._snapshot ? Number(c._snapshot.grand_total).toLocaleString('en-IN') : '—';
      return `<td style="text-align:right;">${grandTotal}</td>`;
    }
    case 'last_call':
      return `<td id="ruCustLastCall-${c.id}">${_ruEsc(_ruLastCallText(c))}</td>`;
    case 'crm_status': return _ruStatusCellHtml(c);
    case 'recovered_amount': return _ruRecoveredAmountCellHtml(c);
    case 'current_outstanding': {
      const value = _ruCurrentOutstandingValue(c);
      return `<td id="ruCustCurrentOutstanding-${c.id}" style="text-align:right;">${value !== null ? value.toLocaleString('en-IN') : '—'}</td>`;
    }
    default: return '';
  }
}

// grand_total comes from the latest snapshot (import-driven); recovered_amount
// is a DB-trigger-maintained derived total (SUM of collection_calls.
// amount_recovered for this customer — see migration 0015). Current
// Outstanding itself is still not stored anywhere — cheap enough to derive
// live from the two source values on every render.
function _ruCurrentOutstandingValue(c) {
  if (!c._snapshot) return null;
  return Number(c._snapshot.grand_total) - Number(c.recovered_amount || 0);
}

// Read-only — recovered_amount is derived server-side (migration 0015's
// trigger), the only way to affect it is logging a call with an "Amount
// recovered" figure (ruSaveCall). Styled visibly non-editable, unlike the
// still-inline-editable Contact Person/Number/Status columns.
function _ruRecoveredAmountCellHtml(c) {
  const value = Number(c.recovered_amount || 0);
  return `<td id="ruCustRecoveredAmount-${c.id}" style="text-align:right;color:var(--muted);cursor:default;" title="Derived from logged calls — log a call to update this">${value.toLocaleString('en-IN')}</td>`;
}

function _ruStatusCellHtml(c) {
  const current = c.crm_status || '';
  const opt = RU_CRM_STATUS_OPTIONS.find(o => o.value === current);
  const color = opt ? opt.color : 'var(--muted)';
  const options = '<option value="">—</option>' + RU_CRM_STATUS_OPTIONS
    .map(o => `<option value="${_ruEsc(o.value)}" ${o.value === current ? 'selected' : ''}>${_ruEsc(o.value)}</option>`)
    .join('');
  // min-width, not width alone — this table has no table-layout:fixed or
  // per-column widths anywhere, it's purely content-driven auto layout. A
  // plain width:100% gives auto-layout a percentage (not content) sizing
  // hint, so the column collapsed to fit the "Status" header instead of the
  // pill text, clipping longer values like "Payment Recieved". min-width sets
  // a content floor (sized to the longest option) while still letting the
  // column grow if something else in the row needs more room.
  return `<td>
    <select data-customer-id="${c.id}" onclick="event.stopPropagation()" onchange="ruSaveStatusField(this)"
      style="width:100%;min-width:172px;box-sizing:border-box;padding:4px 8px;border-radius:20px;border:1px solid ${color}55;background:${color}18;color:${color};font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;">
      ${options}
    </select>
  </td>`;
}

async function ruSaveStatusField(selectEl) {
  const customerId = selectEl.dataset.customerId;
  const value = selectEl.value;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_customers?id=eq.${customerId}`, {
      method: 'PATCH',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify({ crm_status: value || null }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const customer = _ruMyCustomers.find(c => c.id === customerId);
    if (customer) customer.crm_status = value || null;
    _ruRestyleStatusSelect(selectEl, value);
    _ruFlashInlineOutline(selectEl, true);
  } catch (e) {
    const customer = _ruMyCustomers.find(c => c.id === customerId);
    selectEl.value = (customer && customer.crm_status) || ''; // revert to last-known value
    _ruRestyleStatusSelect(selectEl, selectEl.value);
    _ruFlashInlineOutline(selectEl, false);
    alert('❌ Could not save: ' + e.message);
  }
}

function _ruRestyleStatusSelect(selectEl, value) {
  const opt = RU_CRM_STATUS_OPTIONS.find(o => o.value === value);
  const color = opt ? opt.color : 'var(--muted)';
  selectEl.style.borderColor = `${color}55`;
  selectEl.style.background = `${color}18`;
  selectEl.style.color = color;
}

// Same save-confirmation as _ruFlashInlineCell, but via outline rather than
// background — the status select's background IS its colored pill, so
// flashing background would clobber it instead of confirming the save.
function _ruFlashInlineOutline(el, success) {
  el.style.outline = `2px solid ${success ? '#00d4aa' : '#ff5c7c'}`;
  setTimeout(() => { el.style.outline = ''; }, 700);
}

// Click-to-edit, save-on-blur/Enter — the row itself opens a detail modal on
// click, so these need their own stopPropagation or clicking in to edit would
// also pop the modal open underneath the cursor.
function _ruEditableCellHtml(field, c) {
  const value = c[field] || '';
  return `<td class="ru-editable-cell" contenteditable="true" spellcheck="false" style="cursor:text;"
    data-field="${field}" data-customer-id="${c.id}" data-original="${_ruEsc(value)}"
    onclick="event.stopPropagation()"
    onblur="ruSaveInlineField(this)"
    onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
  >${_ruEsc(value)}</td>`;
}

async function ruSaveInlineField(cellEl) {
  const field = cellEl.dataset.field;
  const customerId = cellEl.dataset.customerId;
  const original = cellEl.dataset.original;
  const newValue = cellEl.textContent.trim();

  if (newValue === original) return; // nothing changed — don't round-trip for free

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_customers?id=eq.${customerId}`, {
      method: 'PATCH',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify({ [field]: newValue || null }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    cellEl.dataset.original = newValue;
    const customer = _ruMyCustomers.find(c => c.id === customerId);
    if (customer) customer[field] = newValue || null;
    _ruFlashInlineCell(cellEl, true);
  } catch (e) {
    cellEl.textContent = original; // revert the visible edit — the write never landed
    _ruFlashInlineCell(cellEl, false);
    alert('❌ Could not save: ' + e.message);
  }
}

function _ruFlashInlineCell(cellEl, success) {
  cellEl.style.background = success ? 'rgba(0,212,170,0.18)' : 'rgba(255,92,124,0.18)';
  setTimeout(() => { cellEl.style.background = ''; }, 700);
}


function ruCustomerRowHtml(c, optionalVisible, dates, colCount) {
  const cells = optionalVisible.map(col => _ruColumnCellHtml(col.key, c)).join('');
  const dateCells = dates.map(d => _ruCalendarCellHtml(c.id, d)).join('');

  return `
    <tr id="ruCustRow-${c.id}" onclick="ruOpenCustomerDetail('${c.id}')">
      <td>${_ruEsc(c.billing_name)}</td>
      ${cells}
      <td style="text-align:center;">
        ${_ruCrmPerson
          // Logging a call requires attributing it to a real crm_persons row
          // (collection_calls.called_by is NOT NULL) — MIS/owner accounts
          // don't have one, so there's nothing valid to log the call under.
          ? `<button onclick="ruToggleCallPanel('${c.id}', event)" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(0,212,170,0.4);background:rgba(0,212,170,0.08);color:#00d4aa;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;">Call</button>`
          : ''}
      </td>
      ${dateCells}
    </tr>
    <tr id="ruCallPanel-${c.id}" style="display:none;">
      <td colspan="${colCount}" style="padding:0 8px 10px;">
        <div style="max-width:360px;border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;background:var(--surface);box-shadow:0 8px 24px rgba(0,0,0,0.18);">
          <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px;">
            <label class="ru-seg-option ru-seg-yes" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 0;cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--muted);transition:all 0.15s;">
              <input type="radio" name="ruConnected-${c.id}" value="yes" onchange="ruToggleConnectedFields('${c.id}', true)"> Connected
            </label>
            <label class="ru-seg-option ru-seg-no" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 0;cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--muted);border-left:1px solid var(--border);transition:all 0.15s;">
              <input type="radio" name="ruConnected-${c.id}" value="no" onchange="ruToggleConnectedFields('${c.id}', false)"> Not Connected
            </label>
          </div>
          <div id="ruCallConnectedFields-${c.id}" style="display:none;">
            <textarea id="ruCallNotes-${c.id}" placeholder="Conversation notes…" style="width:100%;min-height:52px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);font-family:inherit;font-size:0.86rem;box-sizing:border-box;resize:vertical;"></textarea>
          </div>
          <div id="ruCallReasonFields-${c.id}" style="display:none;">
            <select id="ruCallReason-${c.id}" style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);font-size:0.84rem;box-sizing:border-box;">
              <option value="">Select reason…</option>
              <option value="no_answer">No Answer</option>
              <option value="switched_off">Switched Off</option>
              <option value="call_later">Call Later</option>
            </select>
          </div>
          <!-- Nothing was recovered on a call that didn't connect — this
               whole group hides (not just the input) when Not Connected is
               picked; see ruToggleConnectedFields. -->
          <div id="ruCallAmountGroup-${c.id}" style="display:none;margin-top:9px;">
            <label style="display:block;font-size:0.72rem;color:var(--muted);margin-bottom:3px;">Amount recovered (optional)</label>
            <input type="number" id="ruCallAmountRecovered-${c.id}" min="0" step="0.01" placeholder="0"
              style="width:100%;padding:5px 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text2);font-family:inherit;font-size:0.8rem;box-sizing:border-box;">
          </div>
          <div style="display:flex;justify-content:flex-start;flex-wrap:wrap;gap:8px;margin-top:12px;">
            <button class="ru-call-save-btn" onclick="ruSaveCall('${c.id}')" style="padding:7px 16px;border-radius:8px;border:none;background:#00d4aa;color:#04231d;font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;transition:filter 0.15s;">Save Call</button>
            <button class="ru-call-cancel-btn" onclick="ruToggleCallPanel('${c.id}')" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:0.78rem;cursor:pointer;font-family:inherit;transition:all 0.15s;">Cancel</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

// event is passed so this can stop propagation — the button lives inside a
// row that opens the customer detail modal on click, and pressing Call must
// not also trigger that.
function ruToggleCallPanel(customerId, event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById(`ruCallPanel-${customerId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'table-row' : 'none';
}

let _ruDetailCustomerId = null; // customer currently shown in the row-detail modal, if any

// Shared renderer for each of the 3 info sections — a plain label/value
// grid, escaped, joined into the section's container innerHTML.
function _ruDetailFieldRowsHtml(rows) {
  return rows.map(([label, value]) => `
    <div style="color:var(--muted);font-weight:600;">${_ruEsc(label)}</div>
    <div>${_ruEsc(value)}</div>
  `).join('');
}

function ruOpenCustomerDetail(customerId) {
  const c = _ruMyCustomers.find(x => x.id === customerId);
  if (!c) return;
  _ruDetailCustomerId = customerId;

  document.getElementById('ruCustomerDetailTitle').textContent = c.billing_name;
  document.getElementById('ruCustomerDetailSubtitle').textContent =
    `${c.category || 'Uncategorized'}${c.city ? ' · ' + c.city : ''}`;

  const grandTotal = c._snapshot ? Number(c._snapshot.grand_total).toLocaleString('en-IN') : '—';
  const currentOutstandingValue = _ruCurrentOutstandingValue(c);

  document.getElementById('ruCustomerDetailContact').innerHTML = _ruDetailFieldRowsHtml([
    ['City', c.city || '—'],
    ['Contact Person', c.contact_person || '—'],
    ['Contact Number', c.contact_number || '—'],
  ]);
  document.getElementById('ruCustomerDetailAccount').innerHTML = _ruDetailFieldRowsHtml([
    ['Category', c.category || '—'],
    ['Frequency', c.calling_frequency || '—'],
    ['Status', c.crm_status || '—'],
    ['Last Call', _ruLastCallText(c)],
  ]);
  document.getElementById('ruCustomerDetailFinancial').innerHTML = _ruDetailFieldRowsHtml([
    ['Outstanding', grandTotal],
    ['Recovered Amount', Number(c.recovered_amount || 0).toLocaleString('en-IN')],
    ['Current Outstanding', currentOutstandingValue !== null ? currentOutstandingValue.toLocaleString('en-IN') : '—'],
  ]);

  const personOptions = _ruAllPersons
    .filter(p => p.id !== _ruCrmPerson?.id) // MIS/owner has no id of their own to exclude — every person stays a valid target
    .map(p => `<option value="${p.id}">${_ruEsc(p.name)}</option>`)
    .join('');
  const reassignSelect = document.getElementById('ruCustomerDetailReassign');
  reassignSelect.innerHTML = `
    <option value="">Reassign…</option>
    <option value="__unassign__">— Move to unassigned pool —</option>
    ${personOptions}
  `;
  reassignSelect.value = '';
  reassignSelect.onchange = () => ruReassign(customerId, reassignSelect);

  document.getElementById('ruCustomerDetailOverlay').classList.add('open');
  _ruLoadCustomerCallHistory(customerId);
}

function ruCloseCustomerDetail() {
  document.getElementById('ruCustomerDetailOverlay').classList.remove('open');
  _ruDetailCustomerId = null;
}

// Full history for this customer, most recent first — distinct from
// latest_collection_calls (used elsewhere for just the single latest call).
// Capped at 50 rows; this is a per-customer view so that's already generous.
async function _ruLoadCustomerCallHistory(customerId) {
  const container = document.getElementById('ruCustomerDetailHistory');
  container.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;margin:0;">Loading…</p>';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/collection_calls?customer_id=eq.${customerId}&select=call_date,connected,not_connected_reason,conversation_notes,amount_recovered&order=call_date.desc,created_at.desc&limit=50`,
      { headers: SB_HDRS() },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    // The user may have already clicked into a different row by the time
    // this resolves — don't paint a stale customer's history over theirs.
    if (_ruDetailCustomerId !== customerId) return;
    _ruRenderCustomerCallHistory(container, rows);
  } catch (e) {
    if (_ruDetailCustomerId !== customerId) return;
    container.innerHTML = '<p style="color:var(--hot,#ff5c7c);font-size:0.82rem;margin:0;">⚠️ Could not load call history.</p>';
  }
}

function _ruRenderCustomerCallHistory(container, rows) {
  if (!rows.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;margin:0;">No calls logged yet.</p>';
    return;
  }
  container.innerHTML = rows.map(r => {
    const dot = r.connected ? '#00d4aa' : '#ff5c7c';
    const note = r.connected
      ? (r.conversation_notes || '—')
      : (RU_NOT_CONNECTED_REASON_LABELS[r.not_connected_reason] || r.not_connected_reason || '—');
    const amount = r.amount_recovered ? `₹${Number(r.amount_recovered).toLocaleString('en-IN')}` : '';
    return `
      <div class="ru-history-row">
        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};flex-shrink:0;margin-top:4px;"></span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;gap:8px;">
            <span style="font-weight:700;color:var(--text);">${_ruEsc(r.call_date)}</span>
            ${amount ? `<span style="color:#00d4aa;font-weight:700;">${amount}</span>` : ''}
          </div>
          <div style="color:var(--muted);margin-top:2px;overflow-wrap:anywhere;">${_ruEsc(note)}</div>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('ruCustomerDetailOverlay')?.addEventListener('click', function (e) {
  if (e.target === this) ruCloseCustomerDetail();
});

function ruToggleConnectedFields(customerId, connected) {
  document.getElementById(`ruCallConnectedFields-${customerId}`).style.display = connected ? 'block' : 'none';
  document.getElementById(`ruCallReasonFields-${customerId}`).style.display = connected ? 'none' : 'block';
  // Nothing was recovered on a call that didn't connect — hide the field
  // entirely rather than leave it sitting there with no sensible use.
  document.getElementById(`ruCallAmountGroup-${customerId}`).style.display = connected ? 'block' : 'none';
}

async function ruSaveCall(customerId) {
  const yesInput = document.querySelector(`input[name="ruConnected-${customerId}"][value="yes"]`);
  const noInput = document.querySelector(`input[name="ruConnected-${customerId}"][value="no"]`);
  if (!yesInput.checked && !noInput.checked) { alert('⚠️ Please select Connected or Not Connected.'); return; }
  const connected = yesInput.checked;

  // Only meaningful when Connected — the field itself is hidden for Not
  // Connected (nothing was recovered on a call that didn't go through), and
  // ignoring it here too guards against a stale value left over from
  // toggling Connected → Not Connected without clearing the input.
  let amountRecovered = null;
  if (connected) {
    const amountRaw = document.getElementById(`ruCallAmountRecovered-${customerId}`).value.trim();
    if (amountRaw !== '') {
      amountRecovered = Number(amountRaw);
      if (!Number.isFinite(amountRecovered) || amountRecovered < 0) {
        alert('⚠️ Please enter a valid non-negative recovered amount.');
        return;
      }
    }
  }

  const payload = {
    customer_id: customerId,
    called_by: _ruCrmPerson.id,
    call_date: _ruTodayStr(),
    connected,
  };
  if (amountRecovered !== null) payload.amount_recovered = amountRecovered;

  if (connected) {
    const notes = document.getElementById(`ruCallNotes-${customerId}`).value.trim();
    payload.conversation_notes = notes || null;
  } else {
    const reason = document.getElementById(`ruCallReason-${customerId}`).value;
    if (!reason) { alert('⚠️ Please select a reason.'); return; }
    payload.not_connected_reason = reason;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/collection_calls`, {
      method: 'POST',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || ('HTTP ' + res.status));
    }
    // Patch the just-logged call straight into the cached calendar map (its
    // shape already matches what a refetch would return) so today's date
    // cell updates immediately without a network round-trip + loading flash.
    if (_ruCalendarCallsMap) _ruCalendarCallsMap.set(`${customerId}|${payload.call_date}`, payload);
    // recovered_amount itself is recalculated server-side by a DB trigger
    // (migration 0015) — bumping it here too just keeps the very next
    // render (right below) showing the right number without waiting on a
    // refetch of this customer.
    if (amountRecovered) {
      const customer = _ruMyCustomers.find(c => c.id === customerId);
      if (customer) customer.recovered_amount = Number(customer.recovered_amount || 0) + amountRecovered;
    }
    await ruRefreshCustomerRow(customerId);
    ruRenderMyCustomers(document.getElementById('ruMyCustomersBody'));
  } catch (e) {
    alert('❌ Could not save call: ' + e.message);
  }
}

// Patches just this row's last-call cell in place — no full tab reload.
async function ruRefreshCustomerRow(customerId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/latest_collection_calls?customer_id=eq.${customerId}&select=customer_id,call_date,connected`,
      { headers: SB_HDRS() },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const lastCall = rows[0] || null;

    const customer = _ruMyCustomers.find(c => c.id === customerId);
    if (!customer) return;
    customer._lastCall = lastCall;

    const cell = document.getElementById(`ruCustLastCall-${customerId}`);
    if (cell) cell.textContent = _ruLastCallText(customer);
  } catch (e) {
    console.error('ruRefreshCustomerRow failed:', e);
  }
}

async function ruReassign(customerId, selectEl) {
  const value = selectEl.value;
  if (!value) return;
  const newPersonId = value === '__unassign__' ? null : value;
  const label = value === '__unassign__' ? 'move this customer to the unassigned pool' : 'reassign this customer to the selected person';
  if (!confirm(`Are you sure you want to ${label}? It will disappear from your list.`)) { selectEl.value = ''; return; }

  try {
    // Goes through reassign_crm_customer() (SECURITY DEFINER RPC), not a
    // direct PATCH — a plain PATCH hits crm_customers' RLS requirement that
    // the row remain SELECT-visible to the caller after the write, which a
    // hand-away update can never satisfy (see migration 0012).
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reassign_crm_customer`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ p_customer_id: customerId, p_new_person_id: newPersonId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.message || ('HTTP ' + res.status));
    }
    _ruMyCustomers = _ruMyCustomers.filter(c => c.id !== customerId);
    if (_ruDetailCustomerId === customerId) ruCloseCustomerDetail(); // it just left this person's list — nothing left to show
    ruRenderMyCustomers(document.getElementById('ruMyCustomersBody'));
  } catch (e) {
    alert('❌ Could not reassign: ' + e.message);
    selectEl.value = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Unassigned Pool — MIS-only
// ═══════════════════════════════════════════════════════════════════════

// Categories shown in this fixed order; customers with no (recognized)
// category are grouped last under "No Category" rather than dropped.
const RU_UNASSIGNED_CATEGORY_GROUPS = [...RU_CATEGORY_ORDER, null];

async function loadRenewalsUnassignedPool() {
  const container = document.getElementById('ruUnassignedPoolBody');
  container.innerHTML = '<p style="color:var(--muted);font-size:0.88rem;">Loading…</p>';

  try {
    const custRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_customers?assigned_crm_person_id=is.null&select=id,billing_name,city,contact_person,contact_number,category&order=billing_name.asc`,
      { headers: SB_HDRS() },
    );
    if (!custRes.ok) throw new Error('crm_customers: HTTP ' + custRes.status);
    const customers = await custRes.json();

    // Already have the exact count from this fetch — no need for a second
    // HEAD request just to refresh the tab-button badge.
    _ruUnassignedPoolCount = customers.length;
    _ruUpdateUnassignedPoolTabLabel();

    if (!customers.length) {
      _ruUnassignedPool = [];
      container.innerHTML = '<p style="color:var(--muted);font-size:0.88rem;">No unassigned customers 🎉</p>';
      return;
    }

    const ids = customers.map(c => c.id).join(',');
    const [snapRes, personsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/latest_outstanding_snapshots?customer_id=in.(${ids})&select=customer_id,grand_total`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/crm_persons?is_active=eq.true&select=id,name&order=name.asc`, { headers: SB_HDRS() }),
    ]);
    if (!snapRes.ok) throw new Error('latest_outstanding_snapshots: HTTP ' + snapRes.status);
    if (!personsRes.ok) throw new Error('crm_persons: HTTP ' + personsRes.status);

    const snaps = await snapRes.json();
    _ruUnassignedPersons = await personsRes.json();
    const snapMap = new Map(snaps.map(s => [s.customer_id, s]));

    _ruUnassignedPool = customers.map(c => ({ ...c, _snapshot: snapMap.get(c.id) || null }));

    ruRenderUnassignedPool(container);
  } catch (e) {
    container.innerHTML = `<p style="color:var(--hot,#ff5c7c);font-size:0.88rem;">⚠️ ${e.message}</p>`;
  }
}

function ruRenderUnassignedPool(container) {
  if (!container) return;

  const sections = RU_UNASSIGNED_CATEGORY_GROUPS.map(cat => {
    const inCat = _ruUnassignedPool.filter(c => (c.category || null) === cat);
    if (!inCat.length) return '';

    // Highest outstanding first within the group — those are the most urgent
    // to get assigned. A customer with no snapshot yet sorts to the bottom.
    const sorted = [...inCat].sort((a, b) => {
      const aTotal = a._snapshot ? Number(a._snapshot.grand_total) : -Infinity;
      const bTotal = b._snapshot ? Number(b._snapshot.grand_total) : -Infinity;
      return bTotal - aTotal;
    });

    const label = cat || 'No Category';
    const freq = cat ? RU_CATEGORY_FREQ[cat] : null;

    return `
      <div class="table-card" style="margin-bottom:20px;">
        <div class="table-header">
          <span class="table-title">${_ruEsc(label)} (${inCat.length})${freq ? ` — ${freq}` : ''}</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th>Billing Name</th>
              <th>City</th>
              <th>Contact Person</th>
              <th>Contact Number</th>
              <th>Category</th>
              <th style="text-align:right;">Grand Total</th>
              <th>Assign To</th>
            </tr></thead>
            <tbody>${sorted.map(c => _ruUnassignedRowHtml(c)).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = sections || '<p style="color:var(--muted);font-size:0.88rem;">No unassigned customers 🎉</p>';
}

function _ruUnassignedRowHtml(c) {
  const personOptions = _ruUnassignedPersons.map(p => `<option value="${p.id}">${_ruEsc(p.name)}</option>`).join('');
  const grandTotal = c._snapshot ? Number(c._snapshot.grand_total).toLocaleString('en-IN') : '—';
  return `
    <tr>
      <td>${_ruEsc(c.billing_name)}</td>
      <td>${_ruEsc(c.city || '—')}</td>
      <td>${_ruEsc(c.contact_person || '—')}</td>
      <td>${_ruEsc(c.contact_number || '—')}</td>
      <td>${_ruEsc(c.category || '—')}</td>
      <td style="text-align:right;">${grandTotal}</td>
      <td>
        <select onchange="ruAssignUnassignedPool('${c.id}', this)" style="max-width:160px;padding:4px;border-radius:6px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);font-size:0.78rem;">
          <option value="">Assign to…</option>
          ${personOptions}
        </select>
      </td>
    </tr>
  `;
}

async function ruAssignUnassignedPool(customerId, selectEl) {
  const personId = selectEl.value;
  if (!personId) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_customers?id=eq.${customerId}`, {
      method: 'PATCH',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify({ assigned_crm_person_id: personId, is_active_calling: true }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    _ruUnassignedPool = _ruUnassignedPool.filter(c => c.id !== customerId);
    _ruUnassignedPoolCount = _ruUnassignedPool.length;
    _ruUpdateUnassignedPoolTabLabel();
    ruRenderUnassignedPool(document.getElementById('ruUnassignedPoolBody'));
  } catch (e) {
    alert('❌ Could not assign: ' + e.message);
    selectEl.value = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: Overview — MIS/owner see the full org-wide view; a CRM person sees
// the same tab scoped to just their own customers/calls (get_renewals_
// overview()'s p_crm_person_id parameter — null for MIS, their id otherwise).
// ═══════════════════════════════════════════════════════════════════════

let _ruOverviewCharts = {}; // Chart.js instances, destroyed+recreated on every render (same pattern as leads.js)

async function loadRenewalsOverview() {
  const container = document.getElementById('ruOverviewBody');
  container.innerHTML = '<p style="color:var(--muted);font-size:0.88rem;">Loading…</p>';
  Object.values(_ruOverviewCharts).forEach(c => c && c.destroy && c.destroy());
  _ruOverviewCharts = {};

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_renewals_overview`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ p_crm_person_id: _ruCrmPerson ? _ruCrmPerson.id : null }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _ruRenderOverview(container, data);
  } catch (e) {
    container.innerHTML = `<p style="color:var(--hot,#ff5c7c);font-size:0.88rem;">⚠️ ${e.message}</p>`;
  }
}

function _ruRenderOverview(container, data) {
  container.innerHTML = `
    ${_ruOverviewFinancialHtml(data.financial)}
    ${_ruOverviewChartsRowHtml()}
    ${_ruOverviewTeamTableHtml(data.team_performance)}
    ${_ruOverviewHealthHtml(data.operational_health)}
    ${_ruOverviewActivityHtml(data.recent_activity)}
  `;
  // Charts need their <canvas> elements to actually exist in the DOM first.
  _ruBuildOverviewCharts(data);
}

// Compact Indian-numbering format (₹1.52 Cr / ₹68.23 L) for headline KPI
// figures, where a dense fully-expanded comma-grouped number is harder to
// scan at a glance than a rounded one. Only for display tiles like this —
// anywhere a value needs to be read/edited precisely (My Customers'
// Outstanding column, the row-detail modal, etc.) should keep using plain
// toLocaleString('en-IN') instead.
function formatIndianCompact(n) {
  const value = Number(n || 0);
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

function _ruOverviewFinancialHtml(f) {
  const inr = formatIndianCompact;
  const byCategory = f.outstanding_by_category || {};
  const tiles = [
    { label: 'Total Outstanding', value: inr(f.total_outstanding) },
    { label: 'Platinum Outstanding', value: inr(byCategory.Platinum) },
    { label: 'Gold Outstanding', value: inr(byCategory.Gold) },
    { label: 'Silver Outstanding', value: inr(byCategory.Silver) },
    { label: 'Recovered This Month', value: inr(f.total_recovered_this_month) },
    { label: 'Recovered All-Time', value: inr(f.total_recovered_all_time) },
  ];
  return `
    <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr);">
      ${tiles.map(t => `
        <div class="kpi-card">
          <div class="kpi-label">${t.label}</div>
          <div class="kpi-value">${t.value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function _ruOverviewChartsRowHtml() {
  return `
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:20px;">
      <div class="chart-card">
        <div class="chart-title">Monthly Recovery Trend</div>
        <div style="height:260px;"><canvas id="ruChartRecoveryTrend"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Status Breakdown</div>
        <div style="height:260px;"><canvas id="ruChartStatusBreakdown"></canvas></div>
      </div>
    </div>
  `;
}

function _ruComplianceBadgeClass(pct) {
  if (pct >= 80) return 'badge-won';
  if (pct >= 50) return 'badge-warm';
  return 'badge-hot';
}

// MIS/owner get the full team comparison table. A CRM person only ever gets
// their own single row back from the RPC (scoped server-side, not just
// hidden client-side — see migration 0014) — showing that as a one-row
// "table" complete with a Person-name column would be an odd, faintly
// redundant component, and a full team table would otherwise expose peers'
// individual performance to a CRM person, which isn't appropriate at that
// access level. So for a CRM person this renders as a compact personal
// scorecard instead — same underlying fields (compliance %, connected/
// not-connected split), just not shaped like a comparison table.
function _ruOverviewTeamTableHtml(team) {
  if (!_ruIsMIS) {
    const t = (team || [])[0] || { calls_connected_30d: 0, calls_not_connected_30d: 0, compliance_pct: 0 };
    const tiles = [
      { label: 'Connected Calls (30d)', value: t.calls_connected_30d },
      { label: 'Not Connected (30d)', value: t.calls_not_connected_30d },
      { label: 'Compliance', value: `<span class="badge ${_ruComplianceBadgeClass(t.compliance_pct)}">${t.compliance_pct}%</span>` },
    ];
    return `
      <div class="table-card" style="margin-bottom:20px;">
        <div class="table-header">
          <span class="table-title">Your Calling Activity</span>
        </div>
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);padding:14px;">
          ${tiles.map(x => `
            <div class="kpi-card">
              <div class="kpi-label">${x.label}</div>
              <div class="kpi-value">${x.value}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const rows = (team || []).map(t => `
    <tr>
      <td>${_ruEsc(t.person_name)}</td>
      <td style="text-align:right;">${t.customers_assigned}</td>
      <td style="text-align:right;">${t.calls_connected_30d}</td>
      <td style="text-align:right;">${t.calls_not_connected_30d}</td>
      <td style="text-align:right;">₹${Number(t.recovered_this_month || 0).toLocaleString('en-IN')}</td>
      <td style="text-align:center;"><span class="badge ${_ruComplianceBadgeClass(t.compliance_pct)}">${t.compliance_pct}%</span></td>
    </tr>
  `).join('');

  return `
    <div class="table-card" style="margin-bottom:20px;">
      <div class="table-header">
        <span class="table-title">CRM Team Performance</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Person</th>
            <th style="text-align:right;">Customers</th>
            <th style="text-align:right;">Connected (30d)</th>
            <th style="text-align:right;">Not Connected (30d)</th>
            <th style="text-align:right;">Recovered This Month</th>
            <th style="text-align:center;">Compliance</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="padding:12px;color:var(--muted);">No active CRM persons.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

// unresolved_unmatched_count/unassigned_pool_count are org-wide, not
// actionable by a CRM person (matches Unassigned Pool being MIS-only) — the
// RPC returns them as null when scoped (migration 0014), and this just
// drops any null-valued tile rather than needing its own role check, so
// rendering stays correct even if the scoping rule on the SQL side changes.
function _ruOverviewHealthHtml(oh) {
  const tiles = [
    { label: 'Unresolved (Import)', value: oh.unresolved_unmatched_count, color: oh.unresolved_unmatched_count > 0 ? 'var(--hot)' : 'var(--won)' },
    { label: 'Unassigned Pool', value: oh.unassigned_pool_count, color: oh.unassigned_pool_count > 0 ? 'var(--warm)' : 'var(--won)' },
    { label: _ruIsMIS ? 'Never Called' : 'Your Never-Called Customers', value: oh.never_called_count, color: oh.never_called_count > 0 ? 'var(--hot)' : 'var(--won)' },
  ].filter(t => t.value !== null && t.value !== undefined);
  return `
    <div class="kpi-grid" style="grid-template-columns:repeat(${tiles.length},1fr);margin-bottom:20px;">
      ${tiles.map(t => `
        <div class="kpi-card" style="--card-color:${t.color};">
          <div class="kpi-label">${t.label}</div>
          <div class="kpi-value">${t.value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function _ruOverviewActivityHtml(activity) {
  const rows = (activity || []).map(a => {
    const dot = a.connected ? '#00d4aa' : '#ff5c7c';
    const note = a.connected ? (a.note || '—') : (RU_NOT_CONNECTED_REASON_LABELS[a.note] || a.note || '—');
    const amount = a.amount_recovered ? `₹${Number(a.amount_recovered).toLocaleString('en-IN')}` : '—';
    return `
      <tr>
        <td style="white-space:nowrap;">${_ruEsc(a.call_date)}</td>
        <td>${_ruEsc(a.customer_name)}</td>
        <td>${_ruEsc(a.person_name)}</td>
        <td style="text-align:center;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot};"></span></td>
        <td>${_ruEsc(note)}</td>
        <td style="text-align:right;">${amount}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-card" style="margin-bottom:20px;">
      <div class="table-header">
        <span class="table-title">Recent Activity</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Date</th>
            <th>Customer</th>
            <th>By</th>
            <th style="text-align:center;">Connected</th>
            <th>Note</th>
            <th style="text-align:right;">Amount</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="padding:12px;color:var(--muted);">No calls logged yet.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function _ruBuildOverviewCharts(data) {
  const { tc, gc } = chartColors();
  const font = { family: 'DM Sans', size: 10 };

  const trend = data.financial.monthly_recovery_trend || [];
  const trendCanvas = document.getElementById('ruChartRecoveryTrend');
  if (trendCanvas) {
    _ruOverviewCharts.trend = new Chart(trendCanvas, {
      type: 'bar',
      data: {
        labels: trend.map(m => m.month),
        datasets: [{ label: 'Recovered', data: trend.map(m => Number(m.recovered)), backgroundColor: '#00d4aa', borderRadius: 4, borderWidth: 0 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tc, font }, grid: { display: false } },
          y: { ticks: { color: tc, font }, grid: { color: gc } },
        },
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }

  const statusRows = data.status_breakdown || [];
  const statusColorMap = { ...Object.fromEntries(RU_CRM_STATUS_OPTIONS.map(o => [o.value, o.color])), 'Not Set': '#6b7280' };
  const statusCanvas = document.getElementById('ruChartStatusBreakdown');
  if (statusCanvas) {
    _ruOverviewCharts.status = new Chart(statusCanvas, {
      type: 'doughnut',
      data: {
        labels: statusRows.map(s => s.status),
        datasets: [{ data: statusRows.map(s => s.count), backgroundColor: statusRows.map(s => statusColorMap[s.status] || '#6b7280'), borderWidth: 0, hoverOffset: 8 }],
      },
      options: {
        cutout: '65%',
        plugins: { legend: { position: 'right', labels: { color: tc, padding: 10, font } } },
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }
}

