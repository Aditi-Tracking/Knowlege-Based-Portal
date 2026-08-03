// Section: HR Employee Master (loadHREmployeeMaster, Add/Edit Employee, Exit Checklist)
// ╔══════════════════════════════════════════════════════════════════════════
// ║  [HR EMPLOYEE MASTER JS]
// ║  Tables: employees, employee_category_history, employee_exit_details,
// ║          employee_exit_checklist_items, employee_exit_checklist_status
// ║  Permissions: hr_employee_view (see the module), hr_employee_edit
// ║               (add/edit employees, change category, manage exit checklist)
// ║  Key functions:
// ║    loadHREmployeeMaster() = entry point (switchDB('hremployee') hook)
// ║    heOpenEmployeeModal()  = add/edit employee
// ║    heOpenExitChecklistModal() = manage the 5-item exit checklist
// ╚══════════════════════════════════════════════════════════════════════════

// ── STATE ──────────────────────────────────────────
let _heEmployees = [], _heChecklistItems = [], _heExitDetails = {}, _heChecklistStatusAll = [];
let _heLoaded = false, _heActiveTab = 'overview';
let _heEditingId = null, _heOrigCategory = null, _heExitFormUrl = null, _heExitFormFile = null;
let _heChecklistEmployeeId = null;
const HE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'list',     label: 'Employee List' },
  { id: 'exited',   label: 'Exited Staff' }
];
const HE_CHECKLIST_BUCKET = 'Documents';
const HE_CHECKLIST_FOLDER = 'ExitForms';

// ── ROLE HELPERS ───────────────────────────────────
function _heRole() { return (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim() : ''; }
function _heCanView() {
  if (typeof PERMISSIONS !== 'undefined' && PERMISSIONS && PERMISSIONS.hr_employee_view === 'true') return true;
  const r = _heRole(); return r === 'owner' || r === 'mis';
}
function _heCanEdit() {
  if (typeof PERMISSIONS !== 'undefined' && PERMISSIONS && PERMISSIONS.hr_employee_edit === 'true') return true;
  const r = _heRole(); return r === 'owner' || r === 'mis';
}
function _heMyEmail() { return (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.email) ? String(CURRENT_USER.email).trim().toLowerCase() : ''; }

function _applyHREmployeeNavVisibility() {
  const show = _heCanView();
  const nav = document.getElementById('nav-hremployee');
  const mm  = document.getElementById('mm-hremployee');
  if (nav) nav.style.display = show ? 'flex' : 'none';
  if (mm)  mm.style.display  = show ? 'flex' : 'none';
  return show;
}

// ── HELPERS ────────────────────────────────────────
function heFmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
function _heDayDiff(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function _heEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function heCategoryBadgeClass(cat) {
  if (cat === 'Permanent Staff') return 'badge-won';
  if (cat === 'Probationary Staff') return 'badge-warm';
  if (cat === 'Exited Staff') return 'badge-lost';
  return 'badge-open';
}
function heCategoryBadgeHtml(cat) { return `<span class="badge ${heCategoryBadgeClass(cat)}">${_heEsc(cat || '—')}</span>`; }

function _heChecklistCountFor(employeeId) {
  const rows = _heChecklistStatusAll.filter(r => r.employee_id === employeeId);
  const total = _heChecklistItems.length || 5;
  const completed = rows.filter(r => r.status === 'completed').length;
  return { completed, total: rows.length ? rows.length : total };
}
function heChecklistBadgeHtml(employeeId) {
  const { completed, total } = _heChecklistCountFor(employeeId);
  const cls = completed === 0 ? 'badge-lost' : (completed === total ? 'badge-won' : 'badge-warm');
  return `<span class="badge ${cls}">${completed}/${total} completed</span>`;
}

// ── LOAD ───────────────────────────────────────────
async function loadHREmployeeMaster() {
  heRenderTabBar();
  if (!_heLoaded) {
    await _heFetchAll();
    _heLoaded = true;
  }
  heSwitchTab(_heActiveTab || 'overview');
}

async function _heFetchAll() {
  try {
    const [empRes, itemsRes, exitRes, statusRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/employees?select=*&order=full_name.asc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_items?select=*&order=sort_order.asc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/employee_exit_details?select=*`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status?select=*`, { headers: SB_HDRS() })
    ]);
    _heEmployees = empRes.ok ? await empRes.json() : [];
    _heChecklistItems = itemsRes.ok ? await itemsRes.json() : [];
    const exitRows = exitRes.ok ? await exitRes.json() : [];
    _heExitDetails = {};
    exitRows.forEach(r => { _heExitDetails[r.employee_id] = r; });
    _heChecklistStatusAll = statusRes.ok ? await statusRes.json() : [];
  } catch (e) {
    alert('❌ Failed to load HR Employee Master data: ' + e.message);
  }
}

async function _heRefreshExitData() {
  try {
    const [exitRes, statusRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/employee_exit_details?select=*`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status?select=*`, { headers: SB_HDRS() })
    ]);
    const exitRows = exitRes.ok ? await exitRes.json() : [];
    _heExitDetails = {};
    exitRows.forEach(r => { _heExitDetails[r.employee_id] = r; });
    _heChecklistStatusAll = statusRes.ok ? await statusRes.json() : [];
  } catch (e) { /* non-fatal — widgets just stay stale until next full reload */ }
}

// ── TAB BAR ────────────────────────────────────────
function heRenderTabBar() {
  const bar = document.getElementById('heTabBar');
  if (!bar) return;
  bar.innerHTML = HE_TABS.map(t => {
    const active = t.id === _heActiveTab;
    const style = active
      ? 'padding:8px 18px;border:1.5px solid #00d4aa;background:#00d4aa;color:#04231d;border-radius:8px;font-size:0.84rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .18s;'
      : 'padding:8px 18px;border:1.5px solid var(--border);background:var(--surface2);color:var(--muted);border-radius:8px;font-size:0.84rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .18s;';
    return `<button id="heTabBtn-${t.id}" onclick="heSwitchTab('${t.id}')" style="${style}">${t.label}</button>`;
  }).join('');
}

function heSwitchTab(tabId) {
  _heActiveTab = tabId;
  HE_TABS.forEach(t => {
    const content = document.getElementById(`heTab-${t.id}`);
    if (content) content.style.display = (t.id === tabId) ? 'block' : 'none';
  });
  heRenderTabBar();
  _heApplyAddButtonVisibility();
  if (tabId === 'overview') heRenderOverview();
  else if (tabId === 'list') heRenderEmployeeList();
  else if (tabId === 'exited') heRenderExitedStaff();
}

// Lives in db-header, visible across all 3 tabs — set independently of
// which tab renders first (Overview is the default landing tab, so this
// can't only be set from inside heRenderEmployeeList()).
function _heApplyAddButtonVisibility() {
  const addBtn = document.getElementById('heAddEmployeeBtn');
  if (addBtn) addBtn.style.display = _heCanEdit() ? 'inline-flex' : 'none';
}

// ── OVERVIEW TAB ───────────────────────────────────
function heRenderOverview() {
  const total = _heEmployees.length;
  const perm = _heEmployees.filter(e => e.category === 'Permanent Staff').length;
  const prob = _heEmployees.filter(e => e.category === 'Probationary Staff').length;
  const exited = _heEmployees.filter(e => e.category === 'Exited Staff').length;

  const cardsEl = document.getElementById('heOverviewCards');
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="kpi-card" style="--card-accent:#00d4ff;--card-color:#00d4ff;">
        <div class="kpi-label">Total Employees</div><div class="kpi-value">${total}</div><div class="kpi-sub">All categories</div>
      </div>
      <div class="kpi-card" style="--card-accent:#00d4aa;--card-color:#00d4aa;">
        <div class="kpi-label">Permanent</div><div class="kpi-value">${perm}</div><div class="kpi-sub">Permanent Staff</div>
      </div>
      <div class="kpi-card" style="--card-accent:#f0a500;--card-color:#f0a500;">
        <div class="kpi-label">Probationary</div><div class="kpi-value">${prob}</div><div class="kpi-sub">Probationary Staff</div>
      </div>
      <div class="kpi-card" style="--card-accent:#ff5c7c;--card-color:#ff5c7c;">
        <div class="kpi-label">Exited</div><div class="kpi-value">${exited}</div><div class="kpi-sub">Exited Staff</div>
      </div>`;
  }

  heRenderLocationBreakdown();
  heRenderUpcomingProbation();
  heRenderRecentlyExited();
}

function heRenderLocationBreakdown() {
  const el = document.getElementById('heLocationBreakdown');
  if (!el) return;
  const counts = {};
  _heEmployees.forEach(e => {
    const loc = (e.location || '').trim() || 'Unspecified';
    counts[loc] = (counts[loc] || 0) + 1;
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  if (!rows.length) { el.innerHTML = `<div style="padding:1.2rem;color:var(--muted);font-size:0.85rem;">No location data.</div>`; return; }
  el.innerHTML = rows.map(([loc, count]) => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;">
      <div style="width:110px;flex-shrink:0;font-size:0.83rem;color:var(--text);font-weight:600;">${_heEsc(loc)}</div>
      <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${Math.round((count / max) * 100)}%;background:var(--accent2,#00d4aa);border-radius:4px;"></div>
      </div>
      <div style="width:32px;text-align:right;font-size:0.83rem;color:var(--muted);font-weight:600;">${count}</div>
    </div>`).join('');
}

function heRenderUpcomingProbation() {
  const el = document.getElementById('heUpcomingProbation');
  if (!el) return;
  const rows = _heEmployees
    .filter(e => e.category === 'Probationary Staff' && e.probation_completion_date)
    .map(e => ({ e, diff: _heDayDiff(e.probation_completion_date) }))
    .filter(x => x.diff !== null && x.diff >= 0 && x.diff <= 30)
    .sort((a, b) => a.diff - b.diff);

  if (!rows.length) { el.innerHTML = `<div style="padding:1.2rem;color:var(--muted);font-size:0.85rem;">No probation completions in the next 30 days.</div>`; return; }

  el.innerHTML = rows.map(({ e, diff }) => {
    const cls = diff <= 7 ? 'badge-hot' : diff <= 15 ? 'badge-warm' : 'badge-cold';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="min-width:0;">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text);">${_heEsc(e.full_name)}</div>
        <div style="font-size:0.75rem;color:var(--muted);">${_heEsc(e.department || '—')} · ${heFmtDate(e.probation_completion_date)}</div>
      </div>
      <span class="badge ${cls}" style="flex-shrink:0;">${diff === 0 ? 'Today' : diff + 'd left'}</span>
    </div>`;
  }).join('');
}

function heRenderRecentlyExited() {
  const el = document.getElementById('heRecentlyExited');
  if (!el) return;
  const rows = _heEmployees
    .filter(e => e.category === 'Exited Staff')
    .map(e => ({ e, exitInfo: _heExitDetails[e.id] }))
    .sort((a, b) => {
      const da = a.exitInfo && a.exitInfo.exit_date ? new Date(a.exitInfo.exit_date) : new Date(0);
      const db = b.exitInfo && b.exitInfo.exit_date ? new Date(b.exitInfo.exit_date) : new Date(0);
      return db - da;
    })
    .slice(0, 10);

  if (!rows.length) { el.innerHTML = `<div style="padding:1.2rem;color:var(--muted);font-size:0.85rem;">No exited employees yet.</div>`; return; }

  el.innerHTML = rows.map(({ e, exitInfo }) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="heOpenExitChecklistModal('${e.id}')">
      <div style="min-width:0;">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text);">${_heEsc(e.full_name)}</div>
        <div style="font-size:0.75rem;color:var(--muted);">Exited ${exitInfo && exitInfo.exit_date ? heFmtDate(exitInfo.exit_date) : '—'}</div>
      </div>
      ${heChecklistBadgeHtml(e.id)}
    </div>`).join('');
}

// ── EMPLOYEE LIST TAB ──────────────────────────────
function _heDistinctValues(field) {
  const vals = new Set();
  _heEmployees.forEach(e => { const v = (e[field] || '').trim(); if (v) vals.add(v); });
  return Array.from(vals).sort((a, b) => a.localeCompare(b));
}

function heRenderListFilters() {
  const mk = (id, values) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">All</option>` + values.map(v => `<option value="${_heEsc(v)}">${_heEsc(v)}</option>`).join('');
    if (values.includes(current)) sel.value = current;
  };
  mk('heFilterLocation', _heDistinctValues('location'));
  mk('heFilterDepartment', _heDistinctValues('department'));
  mk('heFilterDesignation', _heDistinctValues('designation'));
}

function heFilteredEmployees(baseRows) {
  const q = (document.getElementById('heSearch')?.value || '').trim().toLowerCase();
  const loc = document.getElementById('heFilterLocation')?.value || '';
  const dept = document.getElementById('heFilterDepartment')?.value || '';
  const cat = document.getElementById('heFilterCategory')?.value || '';
  const desig = document.getElementById('heFilterDesignation')?.value || '';

  return baseRows.filter(e => {
    if (loc && (e.location || '') !== loc) return false;
    if (dept && (e.department || '') !== dept) return false;
    if (cat && (e.category || '') !== cat) return false;
    if (desig && (e.designation || '') !== desig) return false;
    if (q) {
      const hay = [e.full_name, e.email_official, e.email_personal, e.contact_official, e.contact_personal].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _heTableRowsHtml(rows, opts) {
  if (!rows.length) return `<tr><td colspan="${opts.showChecklist ? 8 : 7}" style="text-align:center;padding:2rem;color:var(--muted);">No employees found.</td></tr>`;
  return rows.map(e => `
    <tr onclick="${opts.rowClickFn}('${e.id}')" style="cursor:pointer;">
      <td style="padding:9px 12px;font-weight:600;color:var(--text);">${_heEsc(e.full_name)}</td>
      <td style="padding:9px 12px;">${heCategoryBadgeHtml(e.category)}</td>
      <td style="padding:9px 12px;color:var(--text2);">${_heEsc(e.department || '—')}</td>
      <td style="padding:9px 12px;color:var(--text2);">${_heEsc(e.designation || '—')}</td>
      <td style="padding:9px 12px;color:var(--text2);">${_heEsc(e.location || '—')}</td>
      <td style="padding:9px 12px;color:var(--text2);white-space:nowrap;">${heFmtDate(e.doj)}</td>
      <td style="padding:9px 12px;color:var(--text2);">${_heEsc(e.contact_official || '—')}</td>
      ${opts.showChecklist ? `<td style="padding:9px 12px;">${heChecklistBadgeHtml(e.id)}</td>` : ''}
    </tr>`).join('');
}

function heRenderEmployeeList() {
  heRenderListFilters();
  const catSel = document.getElementById('heFilterCategory');
  if (catSel && !catSel._heBound) {
    catSel.innerHTML = `<option value="">All</option><option>Permanent Staff</option><option>Probationary Staff</option><option>Exited Staff</option>`;
    catSel._heBound = true;
  }
  const rows = heFilteredEmployees(_heEmployees);
  const tbody = document.getElementById('heListTbody');
  if (tbody) tbody.innerHTML = _heTableRowsHtml(rows, { showChecklist: false, rowClickFn: 'heOpenEmployeeModal' });
  const countEl = document.getElementById('heListCount');
  if (countEl) countEl.textContent = `${rows.length} of ${_heEmployees.length} employees`;
  _heSyncTableScroll('heListHScrollTop', 'heListTableScroll');
}

function heResetListFilters() {
  ['heSearch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['heFilterLocation', 'heFilterDepartment', 'heFilterCategory', 'heFilterDesignation'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  heRenderEmployeeList();
}

// ── EXITED STAFF TAB ───────────────────────────────
// Intentionally does NOT reuse heFilteredEmployees() — that reads the
// Employee List tab's search/filter inputs, which would leak stale filter
// state into this tab with no visible control here to explain it.
function heRenderExitedStaff() {
  const exitedRows = _heEmployees.filter(e => e.category === 'Exited Staff');
  const tbody = document.getElementById('heExitedTbody');
  if (tbody) tbody.innerHTML = _heTableRowsHtml(exitedRows, { showChecklist: true, rowClickFn: 'heOpenExitChecklistModal' });
  const countEl = document.getElementById('heExitedCount');
  if (countEl) countEl.textContent = `${exitedRows.length} exited employee${exitedRows.length === 1 ? '' : 's'}`;
  _heSyncTableScroll('heExitedHScrollTop', 'heExitedTableScroll');
}

// Mirrors the dummy top scrollbar (a 1px-tall div whose spacer is stretched to
// the table's full scroll width) with the real scrolling table container, in
// both directions — lets users grab a horizontal scrollbar without hunting
// for it below however many rows are currently rendered.
function _heSyncTableScroll(topId, scrollId) {
  const top = document.getElementById(topId);
  const scrollEl = document.getElementById(scrollId);
  if (!top || !scrollEl) return;
  const spacer = top.firstElementChild;
  const table = scrollEl.querySelector('table');
  if (spacer && table) spacer.style.width = table.scrollWidth + 'px';
  if (!top._heBound) {
    top.addEventListener('scroll', () => { scrollEl.scrollLeft = top.scrollLeft; });
    scrollEl.addEventListener('scroll', () => { top.scrollLeft = scrollEl.scrollLeft; });
    top._heBound = true;
  }
}

// ── UPLOAD HELPER ──────────────────────────────────
async function _heUploadFile(file, bucket, folder) {
  if (!file) return null;
  const ext = file.name.split('.').pop().toLowerCase();
  const safeName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${safeName}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: file
  });
  if (!res.ok) { const t = await res.text(); throw new Error('Upload failed: ' + t); }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${safeName}`;
}

// ── ADD/EDIT EMPLOYEE MODAL ────────────────────────
function heOpenEmployeeModal(id) {
  _heEditingId = id || null;
  _heExitFormFile = null;
  const e = id ? _heEmployees.find(x => x.id === id) : null;
  _heOrigCategory = e ? e.category : null;
  _heExitFormUrl = e ? (_heExitDetails[e.id] ? _heExitDetails[e.id].exit_form_url : null) : null;

  const canEdit = _heCanEdit();
  document.getElementById('heEmpModalTitle').textContent = e ? ('Edit Employee — ' + e.full_name) : 'Add Employee';

  const set = (id2, val) => { const el = document.getElementById(id2); if (el) el.value = val || ''; };
  set('heEmpName', e && e.full_name);
  set('heEmpCategory', (e && e.category) || 'Probationary Staff');
  set('heEmpJoiningMonth', e && e.joining_month);
  set('heEmpDoj', e && e.doj ? String(e.doj).slice(0, 10) : '');
  set('heEmpProbationDate', e && e.probation_completion_date ? String(e.probation_completion_date).slice(0, 10) : '');
  set('heEmpDepartment', e && e.department);
  set('heEmpDesignation', e && e.designation);
  set('heEmpLocation', e && e.location);
  set('heEmpContactOfficial', e && e.contact_official);
  set('heEmpContactPersonal', e && e.contact_personal);
  set('heEmpEmailOfficial', e && e.email_official);
  set('heEmpEmailPersonal', e && e.email_personal);
  set('heEmpDob', e && e.dob ? String(e.dob).slice(0, 10) : '');
  set('heEmpGender', e && e.gender);
  set('heEmpExitDate', _heExitDetails[id] ? String(_heExitDetails[id].exit_date || '').slice(0, 10) : '');

  document.getElementById('heEmpExitFileName').textContent = 'No file chosen';
  document.getElementById('heEmpExitFile').value = '';
  const linkEl = document.getElementById('heEmpExistingExitFormLink');
  if (_heExitFormUrl) { linkEl.style.display = 'inline'; linkEl.href = _heExitFormUrl; } else { linkEl.style.display = 'none'; }

  document.querySelectorAll('#heEmployeeModalOverlay input, #heEmployeeModalOverlay select').forEach(el => { el.disabled = !canEdit; });
  document.getElementById('heEmpSaveBtn').style.display = canEdit ? 'inline-flex' : 'none';

  heEmpCategoryChanged();
  document.getElementById('heEmployeeModalOverlay').classList.add('open');
}

function heCloseEmployeeModal() {
  document.getElementById('heEmployeeModalOverlay').classList.remove('open');
  _heEditingId = null; _heExitFormFile = null;
}

function heEmpCategoryChanged() {
  const cat = document.getElementById('heEmpCategory').value;
  document.getElementById('heEmpExitSection').style.display = (cat === 'Exited Staff') ? 'block' : 'none';
}

function heEmpExitFileChosen(input) {
  _heExitFormFile = input.files && input.files[0] ? input.files[0] : null;
  document.getElementById('heEmpExitFileName').textContent = _heExitFormFile ? _heExitFormFile.name : 'No file chosen';
}

async function heSaveEmployee() {
  if (!_heCanEdit()) return;
  const fullName = document.getElementById('heEmpName').value.trim();
  if (!fullName) { alert('❌ Full Name is required.'); return; }
  const category = document.getElementById('heEmpCategory').value;
  const exitDateVal = document.getElementById('heEmpExitDate').value || null;

  if (category === 'Exited Staff') {
    if (!exitDateVal) { alert('❌ Exit Date is required when Category is Exited Staff.'); return; }
    if (!_heExitFormFile && !_heExitFormUrl) { alert('❌ Exit Form upload is required when Category is Exited Staff.'); return; }
  }

  const btn = document.getElementById('heEmpSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    let exitFormUrl = _heExitFormUrl;
    if (category === 'Exited Staff' && _heExitFormFile) {
      exitFormUrl = await _heUploadFile(_heExitFormFile, HE_CHECKLIST_BUCKET, HE_CHECKLIST_FOLDER);
    }

    const payload = {
      full_name: fullName,
      category,
      joining_month: document.getElementById('heEmpJoiningMonth').value.trim() || null,
      doj: document.getElementById('heEmpDoj').value || null,
      probation_completion_date: document.getElementById('heEmpProbationDate').value || null,
      department: document.getElementById('heEmpDepartment').value.trim() || null,
      designation: document.getElementById('heEmpDesignation').value.trim() || null,
      location: document.getElementById('heEmpLocation').value.trim() || null,
      contact_official: document.getElementById('heEmpContactOfficial').value.trim() || null,
      contact_personal: document.getElementById('heEmpContactPersonal').value.trim() || null,
      email_official: document.getElementById('heEmpEmailOfficial').value.trim() || null,
      email_personal: document.getElementById('heEmpEmailPersonal').value.trim() || null,
      dob: document.getElementById('heEmpDob').value || null,
      gender: document.getElementById('heEmpGender').value.trim() || null,
      updated_at: new Date().toISOString()
    };

    let employeeId = _heEditingId;

    if (employeeId) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/employees?id=eq.${employeeId}`, {
        method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());

      if (_heOrigCategory && _heOrigCategory !== category) {
        await fetch(`${SUPABASE_URL}/rest/v1/employee_category_history`, {
          method: 'POST', headers: SB_HDRS_MIN(),
          body: JSON.stringify({ employee_id: employeeId, old_category: _heOrigCategory, new_category: category, changed_by: _heMyEmail() })
        });
      }
    } else {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/employees`, {
        method: 'POST', headers: SB_HDRS_REPR(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const [saved] = await res.json();
      employeeId = saved.id;
    }

    if (category === 'Exited Staff') {
      await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_details?on_conflict=employee_id`, {
        method: 'POST',
        headers: { ...SB_HDRS_JSON(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ employee_id: employeeId, exit_date: exitDateVal, exit_form_url: exitFormUrl, updated_at: new Date().toISOString() })
      });

      const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status?employee_id=eq.${employeeId}&select=checklist_item_id`, { headers: SB_HDRS() });
      const existing = existingRes.ok ? await existingRes.json() : [];
      const existingIds = new Set(existing.map(r => r.checklist_item_id));
      const missing = _heChecklistItems.filter(item => !existingIds.has(item.id)).map(item => ({ employee_id: employeeId, checklist_item_id: item.id, status: 'pending' }));
      if (missing.length) {
        await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status`, {
          method: 'POST', headers: SB_HDRS_MIN(), body: JSON.stringify(missing)
        });
      }
    }

    await _heFetchAll();
    heCloseEmployeeModal();
    heSwitchTab(_heActiveTab);
  } catch (e) {
    alert('❌ Save failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Employee';
  }
}

// ── EXIT CHECKLIST MODAL ───────────────────────────
async function heOpenExitChecklistModal(employeeId) {
  const e = _heEmployees.find(x => x.id === employeeId);
  if (!e) return;
  _heChecklistEmployeeId = employeeId;
  document.getElementById('heChecklistModalTitle').textContent = 'Exit Checklist — ' + e.full_name;

  let rows = _heChecklistStatusAll.filter(r => r.employee_id === employeeId);
  if (rows.length < _heChecklistItems.length) {
    const existingIds = new Set(rows.map(r => r.checklist_item_id));
    const missing = _heChecklistItems.filter(item => !existingIds.has(item.id)).map(item => ({ employee_id: employeeId, checklist_item_id: item.id, status: 'pending' }));
    if (missing.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status`, { method: 'POST', headers: SB_HDRS_MIN(), body: JSON.stringify(missing) });
      await _heRefreshExitData();
      rows = _heChecklistStatusAll.filter(r => r.employee_id === employeeId);
    }
  }

  heRenderChecklistRows(rows);
  document.getElementById('heChecklistModalOverlay').classList.add('open');
}

function heCloseExitChecklistModal() {
  document.getElementById('heChecklistModalOverlay').classList.remove('open');
  _heChecklistEmployeeId = null;
}

function heRenderChecklistRows(rows) {
  const canEdit = _heCanEdit();
  const byItemId = {}; _heChecklistItems.forEach(i => { byItemId[i.id] = i; });
  const sorted = [...rows].sort((a, b) => (byItemId[a.checklist_item_id]?.sort_order || 0) - (byItemId[b.checklist_item_id]?.sort_order || 0));

  const listEl = document.getElementById('heChecklistItemsList');
  listEl.innerHTML = sorted.map(r => {
    const item = byItemId[r.checklist_item_id] || {};
    const isDone = r.status === 'completed';
    return `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:600;font-size:0.88rem;color:var(--text);">${_heEsc(item.item_name || '—')}</div>
        <button ${canEdit ? '' : 'disabled'} onclick="heToggleChecklistItem('${r.id}')"
          style="padding:5px 14px;border-radius:20px;font-size:0.78rem;font-weight:700;cursor:${canEdit ? 'pointer' : 'not-allowed'};border:1px solid ${isDone ? 'rgba(0,212,170,0.35)' : 'rgba(240,165,0,0.35)'};background:${isDone ? 'rgba(0,212,170,0.14)' : 'rgba(240,165,0,0.14)'};color:${isDone ? 'var(--won)' : 'var(--warm)'};">
          ${isDone ? '✅ Completed' : '⏳ Pending'}
        </button>
      </div>
      ${isDone ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:6px;">By ${_heEsc(r.completed_by || '—')} · ${r.completed_on ? heFmtDate(r.completed_on) : '—'}</div>` : ''}
      <input type="text" placeholder="Remarks (optional)" value="${_heEsc(r.remarks || '')}" ${canEdit ? '' : 'disabled'}
        onblur="heSaveChecklistRemarks('${r.id}', this.value)"
        style="width:100%;margin-top:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.4rem 0.7rem;color:var(--text);font-size:0.82rem;font-family:inherit;box-sizing:border-box;">
    </div>`;
  }).join('');

  const total = sorted.length || 5;
  const completed = sorted.filter(r => r.status === 'completed').length;
  document.getElementById('heChecklistProgressLabel').textContent = `${completed}/${total} completed`;
  document.getElementById('heChecklistProgressFill').style.width = `${Math.round((completed / total) * 100)}%`;
}

async function heToggleChecklistItem(rowId) {
  if (!_heCanEdit()) return;
  const row = _heChecklistStatusAll.find(r => r.id === rowId);
  if (!row) return;
  const newStatus = row.status === 'completed' ? 'pending' : 'completed';
  const payload = newStatus === 'completed'
    ? { status: 'completed', completed_by: _heMyEmail(), completed_on: new Date().toISOString() }
    : { status: 'pending', completed_by: null, completed_on: null };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status?id=eq.${rowId}`, { method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    Object.assign(row, payload);
    heRenderChecklistRows(_heChecklistStatusAll.filter(r => r.employee_id === _heChecklistEmployeeId));
    if (_heActiveTab === 'exited') heRenderExitedStaff();
    if (_heActiveTab === 'overview') heRenderRecentlyExited();
  } catch (e) {
    alert('❌ Update failed: ' + e.message);
  }
}

async function heSaveChecklistRemarks(rowId, value) {
  if (!_heCanEdit()) return;
  const row = _heChecklistStatusAll.find(r => r.id === rowId);
  if (!row || row.remarks === value) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/employee_exit_checklist_status?id=eq.${rowId}`, { method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify({ remarks: value }) });
    if (!res.ok) throw new Error(await res.text());
    row.remarks = value;
  } catch (e) {
    alert('❌ Failed to save remarks: ' + e.message);
  }
}

// Close overlays on backdrop click
document.addEventListener('DOMContentLoaded', function () {
  const o1 = document.getElementById('heEmployeeModalOverlay');
  if (o1) o1.addEventListener('click', e => { if (e.target === o1) heCloseEmployeeModal(); });
  const o2 = document.getElementById('heChecklistModalOverlay');
  if (o2) o2.addEventListener('click', e => { if (e.target === o2) heCloseExitChecklistModal(); });
});

// Keep the dummy top scrollbar's width in sync with the table on resize —
// a render (filter change, tab switch) already recalculates it, this just
// covers a plain window resize with no re-render in between.
window.addEventListener('resize', () => {
  if (_heActiveTab === 'list') _heSyncTableScroll('heListHScrollTop', 'heListTableScroll');
  else if (_heActiveTab === 'exited') _heSyncTableScroll('heExitedHScrollTop', 'heExitedTableScroll');
});
