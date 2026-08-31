// Section: Task Delegation (MD delegates tasks to specific employees; assignees manage their own list)
// Tables (Supabase): delegation_assignees (id, emp_id, employee_name, email_id, is_active, added_by, added_at)
//                    delegation_tasks (id, task_title, task_description, assigned_to_email, assigned_by,
//                    due_date, status, note, tentative_date, completed_at, created_at, updated_at,
//                    source_recurring_template_id)
//                    delegation_task_assignees (id, task_id, assignee_email, added_at) — many-to-many;
//                    this (not assigned_to_email) is the RLS source of truth for who can see/edit a
//                    task. assigned_to_email is kept in sync with the first-selected assignee only as
//                    a denormalized "primary assignee" convenience column (migration 0038).
//                    delegation_recurring_templates / delegation_recurring_template_assignees — MD-only
//                    config read by the daily delegation_generate_recurring_tasks() pg_cron job, which
//                    stamps generated delegation_tasks rows with source_recurring_template_id.
// Access: MD (chirag@adititracking.com) always gets the full Manage view (assignees + all tasks).
// Anyone else whose email matches an active delegation_assignees row gets a read-mostly "My Tasks"
// view (only note + tentative_date + completed toggle are editable — title/description/due date/
// assigned_by are never rendered as inputs there, so there's nothing for the user to tamper with
// via devtools).
// Nobody else can even see the dashboard tile — see _applyTaskDelegationNavVisibility below,
// wired from js/auth.js's showPortal(). This is a deliberately different access model from every
// other module (which gate on PERMISSIONS/role_defaults) — visibility here is a direct email/
// assignee-row check, per the Task Delegation module spec. RLS (migrations 0033/0034) backs this
// up server-side with case-insensitive policies — these checks are UX gating only.

const TD_MD_EMAIL = 'chirag@adititracking.com';

// ── Attachments (delegation_task_attachments + 'delegation-task-attachments' storage bucket) ──
// Path convention <task_id>/<timestamp>_<safeName>, same shape as Renewals' call_attachments
// pattern (js/renewals.js _ruUploadCallScreenshot) — mirrored here per spec so storage RLS
// (migration 0036) can key off storage.foldername(name) the same way. Unlike call_attachments,
// this bucket allows any file type (not images-only), so rendering falls back to a generic
// icon for non-images instead of assuming everything is a thumbnail.
const TD_ATTACHMENTS_BUCKET    = 'delegation-task-attachments';
const TD_ATTACHMENT_MAX_BYTES  = 10 * 1024 * 1024; // matches the bucket's file_size_limit (migration 0036)
let _tdDetailAttachments  = [];        // attachments for the task currently open in the detail modal
let _tdAttachmentBlobCache = new Map(); // storage path -> blob: URL, since the bucket is private (no plain <img src>)

function _tdIsMD(){ return !!CURRENT_USER && String(CURRENT_USER.email || '').trim().toLowerCase() === TD_MD_EMAIL; }

// Resolved by _applyTaskDelegationNavVisibility() — true only for a non-MD user whose email
// matched an active delegation_assignees row at last check. loadTaskDelegation() reads this
// instead of re-querying, since the nav-visibility check already answered the same question.
let _tdIsActiveAssignee = false;

// Async (unlike most _apply*NavVisibility() functions) because "is this user an active
// assignee" needs a Supabase round-trip — mirrors _applyRenewalsNavVisibility()'s pattern of
// self-calling _renderDashboardsHub() once its own check resolves, rather than being awaited
// inline inside showPortal().
async function _applyTaskDelegationNavVisibility(){
  const nav = document.getElementById('nav-taskdelegation');
  const mm  = document.getElementById('mm-taskdelegation');
  let show = _tdIsMD();
  if (!show && CURRENT_USER && CURRENT_USER.email) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/delegation_assignees?select=id&email_id=ilike.${encodeURIComponent(CURRENT_USER.email)}&is_active=eq.true&limit=1`,
        { headers: SB_HDRS() }
      );
      const rows = res.ok ? await res.json() : [];
      show = Array.isArray(rows) && rows.length > 0;
    } catch(e) {
      show = false;
    }
  }
  _tdIsActiveAssignee = show && !_tdIsMD();
  if (nav) nav.style.display = show ? 'flex' : 'none';
  if (mm)  mm.style.display  = show ? 'flex' : 'none';
  if (typeof _renderDashboardsHub === 'function') _renderDashboardsHub();
  return show;
}

// ── Small helpers ────────────────────────────────────────────────────────
function _tdEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _tdFmtDate(d){
  if (!d) return '—';
  const dt = new Date(d.length <= 10 ? d + 'T00:00:00' : d);
  if (isNaN(dt)) return _tdEsc(d);
  return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
function _tdFmtDateTime(d){
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return _tdEsc(d);
  return dt.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function _tdChip(text, bg, color){
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:14px;background:${bg};color:${color};font-size:0.74rem;font-weight:700;white-space:nowrap;">${text}</span>`;
}
// due_date is a DATE (no time component) — compare at end-of-day so "due today" never
// reads as overdue the instant the clock ticks past midnight in a later timezone.
function _tdIsOverdue(t){
  if (!t.due_date || t.status === 'completed') return false;
  const due = new Date(t.due_date + 'T23:59:59');
  return !isNaN(due) && due < new Date();
}

// ── Entry point (called from switchDB) ────────────────────────────────────
let _tdInited            = false;
let _tdAssignees         = [];
let _tdTasks             = [];
let _tdEmployeeOptions   = null;  // lazily fetched from Employee_details, cached for the modal's lifetime
let _tdSearchMatches     = [];    // current Add Assignee search results, indexed for onclick selection
let _tdActiveTab         = 'alltasks'; // MD only — All Delegated Tasks is the default landing tab
let _tdFilterAssignee    = '';
let _tdActiveKpi         = null; // MD's All Tasks KPI filter: null(=all) | 'pending' | 'completed' — combines with _tdFilterAssignee
let _tdMyActiveKpi       = null; // assignee's My Tasks KPI filter: null(=all) | 'pending' | 'completed'
let _tdEditingTaskId     = null;
let _tdDetailTaskId      = null; // task currently open in tdTaskDetailModalOverlay — used by the modal's action handlers
let _tdSelectedNewAssignee = null; // { Emp_id, Employee_name, Employee_Dept, Email_Id } chosen in the modal

async function loadTaskDelegation(){
  if (!CURRENT_USER) return;
  if (!_tdIsMD() && !_tdIsActiveAssignee) {
    // Defensive fallback only — the dashboard tile is already hidden for this case (see
    // _applyTaskDelegationNavVisibility), so this fires only on a stale tab / direct nav.
    document.getElementById('tdTabBar').style.display        = 'none';
    document.getElementById('tdFilterAssigneeSelect').style.display = 'none';
    document.getElementById('tdTab-assignees').style.display = 'none';
    document.getElementById('tdTab-alltasks').style.display  = 'none';
    document.getElementById('tdMyTasksView').style.display   = 'none';
    document.getElementById('tdAddAssigneeBtn').style.display = 'none';
    document.getElementById('tdNewTaskBtn').style.display     = 'none';
    document.getElementById('tdEmptyState').style.display    = 'block';
    return;
  }
  document.getElementById('tdEmptyState').style.display = 'none';
  if (!_tdInited) {
    _tdInited = true;
    await _tdFetchAll();
  }
  tdRender();
}

// taskId -> [assignee_email, ...], rebuilt whenever delegation_task_assignees is refetched.
// MD-only — an assignee's own "My Tasks" view never needs co-assignees, only its own rows.
let _tdTaskAssigneeMap = new Map();
function _tdRebuildTaskAssigneeMap(links){
  _tdTaskAssigneeMap = new Map();
  for (const l of (links || [])) {
    if (!_tdTaskAssigneeMap.has(l.task_id)) _tdTaskAssigneeMap.set(l.task_id, []);
    _tdTaskAssigneeMap.get(l.task_id).push(l.assignee_email);
  }
}
// Falls back to assigned_to_email for a task whose junction rows haven't loaded/exist yet
// (defensive only — every task written by this module always gets a junction row too).
function _tdAssigneeEmailsForTask(t){
  const list = _tdTaskAssigneeMap.get(t.id);
  if (list && list.length) return list;
  return t.assigned_to_email ? [t.assigned_to_email] : [];
}
function _tdAssigneeNamesForTask(t){
  const emails = _tdAssigneeEmailsForTask(t);
  if (!emails.length) return '—';
  return emails.map(e => {
    const a = _tdAssignees.find(a => a.email_id === e);
    return a ? a.employee_name : e;
  }).join(', ');
}
function _tdTaskHasAssignee(t, email){
  if (!email) return true;
  return _tdAssigneeEmailsForTask(t).includes(email);
}

async function _tdFetchAll(){
  if (_tdIsMD()) {
    const [assigneesRes, tasksRes, taskAssigneesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/delegation_assignees?select=*&order=employee_name.asc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?select=*&order=created_at.desc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/delegation_task_assignees?select=*`, { headers: SB_HDRS() })
    ]);
    _tdAssignees = assigneesRes.ok ? await assigneesRes.json() : [];
    _tdTasks     = tasksRes.ok ? await tasksRes.json() : [];
    _tdRebuildTaskAssigneeMap(taskAssigneesRes.ok ? await taskAssigneesRes.json() : []);
  } else {
    // No assigned_to_email filter here — RLS (delegation_task_assignees junction check) is the
    // real scoping, and filtering on the denormalized primary-assignee column would hide tasks
    // where this user is a secondary (non-primary) assignee.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/delegation_tasks?select=*&order=due_date.asc`,
      { headers: SB_HDRS() }
    );
    _tdTasks = res.ok ? await res.json() : [];
  }
}

function tdRender(){
  if (_tdIsMD()) {
    document.getElementById('tdMyTasksView').style.display    = 'none';
    document.getElementById('tdAddAssigneeBtn').style.display = 'inline-flex';
    document.getElementById('tdNewTaskBtn').style.display     = 'inline-flex';
    tdRenderTabBar();
    tdSwitchTab(_tdActiveTab);
  } else {
    document.getElementById('tdTabBar').style.display         = 'none';
    document.getElementById('tdTab-assignees').style.display  = 'none';
    document.getElementById('tdTab-alltasks').style.display   = 'none';
    document.getElementById('tdAddAssigneeBtn').style.display = 'none';
    document.getElementById('tdNewTaskBtn').style.display     = 'none';
    document.getElementById('tdMyTasksView').style.display    = 'block';
    tdRenderMyTasksTable();
  }
}

// ── MD: tab bar ──────────────────────────────────────────────────────────
// "All Delegated Tasks" first/default — MD lands here from the dashboard tile;
// "Manage Assignees" is the secondary, less-frequent action.
const TD_TABS = [
  ['alltasks',  '📋 All Delegated Tasks'],
  ['assignees', '👥 Manage Assignees'],
];
function tdRenderTabBar(){
  const bar = document.getElementById('tdTabBar');
  bar.style.display = 'flex';
  bar.innerHTML = TD_TABS.map(([id, label]) => {
    const active = _tdActiveTab === id;
    return `<button onclick="tdSwitchTab('${id}')" style="padding:10px 18px;border-radius:10px;border:1.5px solid ${active ? 'var(--accent2)' : 'var(--border)'};background:${active ? 'rgba(0,212,170,0.12)' : 'var(--surface2)'};color:${active ? 'var(--accent2)' : 'var(--muted)'};font-weight:700;font-size:0.87rem;cursor:pointer;font-family:inherit;">${label}</button>`;
  }).join('');
}
function tdSwitchTab(tab){
  _tdActiveTab = tab;
  tdRenderTabBar();
  document.getElementById('tdTab-assignees').style.display = tab === 'assignees' ? 'block' : 'none';
  document.getElementById('tdTab-alltasks').style.display  = tab === 'alltasks'  ? 'block' : 'none';
  // Lives in the tab-bar row itself now (inline beside the tab buttons), so it only needs
  // to show while the tab it filters is actually active.
  document.getElementById('tdFilterAssigneeSelect').style.display = tab === 'alltasks' ? 'inline-block' : 'none';
  if (tab === 'assignees') tdRenderAssigneesTable();
  if (tab === 'alltasks')  tdRenderAllTasksTable();
}

// ── MD: Manage Assignees ─────────────────────────────────────────────────
function tdRenderAssigneesTable(){
  const tbody = document.getElementById('tdAssigneesBody');
  if (!_tdAssignees.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);">No assignees yet — click "+ Add Assignee" to get started.</td></tr>`;
    return;
  }
  tbody.innerHTML = _tdAssignees.map(a => `
    <tr>
      <td>${_tdEsc(a.employee_name)}</td>
      <td>${_tdEsc(a.email_id)}</td>
      <td>${_tdEsc(a.emp_id || '—')}</td>
      <td>
        <label style="position:relative;display:inline-block;width:38px;height:22px;cursor:pointer;">
          <input type="checkbox" ${a.is_active ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;"
            onchange="tdToggleAssigneeActive('${a.id}', this.checked)">
          <span style="position:absolute;inset:0;border-radius:22px;background:${a.is_active ? '#00d4aa' : 'var(--border)'};transition:background 0.2s;">
            <span style="position:absolute;left:${a.is_active ? '18px' : '2px'};top:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.2s;"></span>
          </span>
        </label>
      </td>
      <td style="color:var(--muted);font-size:0.82rem;">${_tdFmtDate(a.added_at)}</td>
    </tr>`).join('');
}

async function tdToggleAssigneeActive(id, isActive){
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_assignees?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify({ is_active: isActive })
    });
    if (!res.ok) throw new Error(await res.text());
    const row = _tdAssignees.find(a => String(a.id) === String(id));
    if (row) row.is_active = isActive;
    tdRenderAssigneesTable(); // re-render so the switch's visual on/off state reflects the write
  } catch(e) {
    alert('❌ Failed to update assignee: ' + e.message);
    tdRenderAssigneesTable(); // revert the toggle visually since the write failed
  }
}

// ── Add Assignee modal ───────────────────────────────────────────────────
async function tdOpenAssigneeModal(){
  _tdSelectedNewAssignee = null;
  document.getElementById('tdAssigneeSearch').value = '';
  document.getElementById('tdAssigneeOptionsList').style.display = 'none';
  document.getElementById('tdAssigneeSelectedPreview').style.display = 'none';
  document.getElementById('tdAssigneeSaveBtn').disabled = true;
  if (!_tdEmployeeOptions) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept,Email_Id`, { headers: SB_HDRS() });
    _tdEmployeeOptions = res.ok ? await res.json() : [];
  }
  document.getElementById('tdAssigneeModalOverlay').classList.add('open');
}
function tdCloseAssigneeModal(){
  document.getElementById('tdAssigneeModalOverlay').classList.remove('open');
}
function tdFilterEmployeeOptions(){
  const q = (document.getElementById('tdAssigneeSearch').value || '').toLowerCase().trim();
  const list = document.getElementById('tdAssigneeOptionsList');
  if (!q) { list.style.display = 'none'; list.innerHTML = ''; _tdSearchMatches = []; return; }
  const activeEmails = new Set(_tdAssignees.filter(a => a.is_active).map(a => String(a.email_id||'').toLowerCase()));
  _tdSearchMatches = (_tdEmployeeOptions || [])
    .filter(e => !activeEmails.has(String(e.Email_Id||'').toLowerCase()))
    .filter(e => (e.Employee_name||'').toLowerCase().includes(q) || (e.Employee_Dept||'').toLowerCase().includes(q))
    .slice(0, 20);
  if (!_tdSearchMatches.length) {
    list.style.display = 'block';
    list.innerHTML = `<div style="padding:10px;color:var(--muted);font-size:0.82rem;">No matching employees</div>`;
    return;
  }
  list.style.display = 'block';
  list.innerHTML = _tdSearchMatches.map((e, i) => `
    <div onclick="tdSelectEmployeeOption(${i})" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:0.85rem;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight:600;color:var(--text);">${_tdEsc(e.Employee_name)}</div>
      <div style="color:var(--muted);font-size:0.76rem;">${_tdEsc(e.Employee_Dept||'')} · ${_tdEsc(e.Email_Id||'')}</div>
    </div>`).join('');
}
function tdSelectEmployeeOption(i){
  const emp = _tdSearchMatches[i];
  if (!emp) return;
  _tdSelectedNewAssignee = emp;
  document.getElementById('tdAssigneeOptionsList').style.display = 'none';
  document.getElementById('tdAssigneeSearch').value = emp.Employee_name;
  document.getElementById('tdAssigneeSelectedPreview').style.display = 'block';
  document.getElementById('tdAssigneeSelectedName').textContent = `${emp.Employee_name} (${emp.Email_Id})`;
  document.getElementById('tdAssigneeSaveBtn').disabled = false;
}
async function tdSaveAssignee(){
  if (!_tdSelectedNewAssignee || !CURRENT_USER) return;
  const btn = document.getElementById('tdAssigneeSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_assignees`, {
      method: 'POST', headers: SB_HDRS_REPR(),
      body: JSON.stringify({
        emp_id:         _tdSelectedNewAssignee.Emp_id,
        employee_name:  _tdSelectedNewAssignee.Employee_name,
        email_id:       String(_tdSelectedNewAssignee.Email_Id || '').trim().toLowerCase(),
        is_active:      true,
        added_by:       CURRENT_USER.email,
        added_at:       new Date().toISOString()
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const [saved] = await res.json();
    _tdAssignees.push(saved);
    tdCloseAssigneeModal();
    tdRenderAssigneesTable();
  } catch(e) {
    alert('❌ Failed to add assignee: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '+ Add Assignee';
  }
}

// ── MD: All Delegated Tasks ──────────────────────────────────────────────
function tdRenderAllTasksFilterOptions(){
  const sel = document.getElementById('tdFilterAssigneeSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Assignees</option>' +
    _tdAssignees.map(a => `<option value="${_tdEsc(a.email_id)}">${_tdEsc(a.employee_name)}</option>`).join('');
  sel.value = current;
}
function tdApplyTaskFilters(){
  _tdFilterAssignee = document.getElementById('tdFilterAssigneeSelect').value;
  tdRenderAllTasksTable();
}
// KPI tiles double as the status filter (replacing the old dropdown) — counts respect the
// assignee dropdown (a data-scoping filter) but not _tdActiveKpi itself, since that's the
// filter these very tiles control. Clicking 'all' or the already-active tile clears it.
function tdRenderAllTasksKpis(){
  const grid = document.getElementById('tdTasksKpiGrid');
  if (!grid) return;
  const scoped = _tdFilterAssignee ? _tdTasks.filter(t => _tdTaskHasAssignee(t, _tdFilterAssignee)) : _tdTasks;
  const completed = scoped.filter(t => t.status === 'completed').length;
  const total = scoped.length;
  const kpis = [
    { id:'all',       label:'Total Tasks', value: total,             color:'#818cf8' },
    { id:'pending',   label:'Pending',     value: total - completed, color:'#f0a500' },
    { id:'completed', label:'Completed',   value: completed,         color:'#00d4aa' },
  ];
  grid.innerHTML = kpis.map(k => {
    const isActive = k.id === 'all' ? !_tdActiveKpi : _tdActiveKpi === k.id;
    return `<div class="kpi-card ${isActive ? 'kpi-active' : ''}" style="--card-accent:${k.color};" onclick="tdKpiClick('${k.id}')">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
    </div>`;
  }).join('');
}
function tdKpiClick(id){
  _tdActiveKpi = (id === 'all' || _tdActiveKpi === id) ? null : id;
  tdRenderAllTasksTable();
}
function tdRenderAllTasksTable(){
  tdRenderAllTasksFilterOptions();
  tdRenderAllTasksKpis();
  const tbody = document.getElementById('tdAllTasksBody');
  let rows = _tdTasks;
  if (_tdFilterAssignee) rows = rows.filter(t => _tdTaskHasAssignee(t, _tdFilterAssignee));
  if (_tdActiveKpi === 'pending')   rows = rows.filter(t => t.status !== 'completed');
  if (_tdActiveKpi === 'completed') rows = rows.filter(t => t.status === 'completed');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted);">No tasks match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const statusBadge = t.status === 'completed'
      ? _tdChip('✅ Completed', '#00d4aa22', '#00d4aa')
      : _tdChip('⏳ Pending', '#f0a50022', '#f0a500');
    const recurringBadge = t.source_recurring_template_id ? ' ' + _tdChip('🔁 Recurring', '#818cf822', '#818cf8') : '';
    return `
      <tr onclick="tdOpenTaskDetailModal('${t.id}')" style="cursor:pointer;">
        <td>${_tdEsc(t.task_title)}${recurringBadge}</td>
        <td>${_tdEsc(_tdAssigneeNamesForTask(t))}</td>
        <td>${_tdFmtDate(t.due_date)}</td>
        <td>${statusBadge}</td>
        <td style="color:var(--muted);font-size:0.8rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_tdEsc(t.note || '—')}</td>
        <td onclick="event.stopPropagation();">
          <button onclick="tdOpenTaskModal('${t.id}')" title="Edit" aria-label="Edit" style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.9rem;line-height:1;cursor:pointer;font-family:inherit;">✏️</button>
        </td>
      </tr>`;
  }).join('');
}

// ── Task Detail modal — shared by both roles, opened by clicking a table row ─
// MD gets a read-only view (note shown as text). An assignee gets the same metadata plus
// a "Your Actions" section (note textarea, tentative-date picker, status toggle) instead of
// the read-only note block — this is the same modal element, not two separate components,
// per the spec that both roles should share one detail-modal pattern.
function tdOpenTaskDetailModal(id){
  const t = _tdTasks.find(x => String(x.id) === String(id));
  if (!t) return;
  _tdDetailTaskId = id;
  document.getElementById('tdDetailTitle').textContent = t.task_title || '';
  document.getElementById('tdDetailAssignee').textContent = _tdAssigneeNamesForTask(t);
  document.getElementById('tdDetailAssignedBy').textContent = t.assigned_by || '—';
  document.getElementById('tdDetailDueDate').textContent = _tdFmtDate(t.due_date);
  document.getElementById('tdDetailTentativeDate').textContent = t.tentative_date ? _tdFmtDate(t.tentative_date) : 'Not set yet';
  document.getElementById('tdDetailDescription').textContent = t.task_description || '—';
  _tdRefreshDetailStatusUi(t);

  const noteBlock    = document.getElementById('tdDetailNoteBlock');    // read-only — MD view
  const actionsBlock = document.getElementById('tdDetailActionsSection'); // editable — assignee view
  const actionsHeader = document.getElementById('tdDetailActions'); // header-row buttons, role-gated
  if (_tdIsMD()) {
    noteBlock.style.display = 'block';
    document.getElementById('tdDetailNote').textContent = t.note || '(no note yet)';
    actionsBlock.style.display = 'none';
    actionsHeader.innerHTML = `<button onclick="tdCloseTaskDetailModal();tdOpenTaskModal('${id}')" title="Edit" aria-label="Edit" style="padding:6px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.95rem;line-height:1;cursor:pointer;font-family:inherit;">✏️</button>`;
  } else {
    noteBlock.style.display = 'none';
    actionsBlock.style.display = 'block';
    document.getElementById('tdDetailTentativeInput').value = t.tentative_date || '';
    document.getElementById('tdDetailNoteInput').value = t.note || '';
    actionsHeader.innerHTML = '';
  }
  document.getElementById('tdTaskDetailModalOverlay').classList.add('open');
  // tabindex="-1" + immediate focus is what lets Ctrl+V paste-to-upload work the instant the
  // modal opens, without requiring the user to click into a field first (same trick as
  // Renewals' call-panel paste handling, js/renewals.js ruToggleCallPanel).
  const box = document.getElementById('tdTaskDetailModalBox');
  if (box) box.focus();
  _tdDetailAttachments = [];
  document.getElementById('tdDetailAttachmentsList').innerHTML = '';
  // Defensive reset — covers closing the modal mid-upload and reopening on a (possibly
  // different) task before the in-flight request's own finally-block clears this.
  _tdAttachmentUploadBusy = false;
  _tdSetAttachmentUploadUi(false);
  _tdLoadAttachments(id);
}
function tdCloseTaskDetailModal(){
  document.getElementById('tdTaskDetailModalOverlay').classList.remove('open');
  _tdDetailTaskId = null;
  _tdClearAttachmentCache();
}
// Refreshes the status badge, the actions section's toggle button, and the completed-at line —
// shared by the initial open and by tdDetailToggleStatus() after a successful save.
function _tdRefreshDetailStatusUi(t){
  document.getElementById('tdDetailStatusBadge').innerHTML = t.status === 'completed'
    ? _tdChip('✅ Completed', '#00d4aa22', '#00d4aa')
    : _tdChip('⏳ Pending', '#f0a50022', '#f0a500');
  const btn = document.getElementById('tdDetailStatusBtn');
  if (btn) {
    const isCompleted = t.status === 'completed';
    btn.textContent = isCompleted ? '↩️ Mark Pending' : '✅ Mark Completed';
    btn.style.background = isCompleted ? 'var(--border)' : '#00d4aa';
    btn.style.color = isCompleted ? 'var(--text2)' : '#04231d';
  }
  const completedRow = document.getElementById('tdDetailCompletedRow');
  if (t.status === 'completed') {
    completedRow.style.display = 'block';
    completedRow.textContent = `Completed at: ${_tdFmtDateTime(t.completed_at)}`;
  } else {
    completedRow.style.display = 'none';
  }
}
// ── Detail modal actions (assignee only) — same update calls as before, now triggered from
// inside the modal instead of an inline card. Each re-renders the My Tasks table underneath so
// it reflects the change without a page reload, and refreshes the still-open modal's own display.
async function tdDetailToggleStatus(){
  if (!_tdDetailTaskId) return;
  await tdToggleMyTaskStatus(_tdDetailTaskId);
  const t = _tdTasks.find(x => String(x.id) === String(_tdDetailTaskId));
  if (t) _tdRefreshDetailStatusUi(t);
}
async function tdDetailSaveNote(){
  if (!_tdDetailTaskId) return;
  await tdSaveNote(_tdDetailTaskId, document.getElementById('tdDetailNoteInput').value);
}
async function tdDetailSaveTentativeDate(){
  if (!_tdDetailTaskId) return;
  await tdSaveTentativeDate(_tdDetailTaskId, document.getElementById('tdDetailTentativeInput').value);
  const t = _tdTasks.find(x => String(x.id) === String(_tdDetailTaskId));
  if (t) document.getElementById('tdDetailTentativeDate').textContent = t.tentative_date ? _tdFmtDate(t.tentative_date) : 'Not set yet';
}

// ── Detail modal: attachments (both roles — shared thread on the task, not per-user) ────────
async function _tdLoadAttachments(taskId){
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/delegation_task_attachments?task_id=eq.${taskId}&select=*&order=uploaded_at.asc`,
      { headers: SB_HDRS() }
    );
    _tdDetailAttachments = res.ok ? await res.json() : [];
  } catch(e) {
    _tdDetailAttachments = [];
  }
  if (String(_tdDetailTaskId) === String(taskId)) _tdRenderAttachments();
}
// MD can remove any attachment (already covered by their table-level FOR ALL policy). An
// assignee can remove only what they personally uploaded, on their own task — matches the
// DELETE policy added by migration 0037, checked client-side here only for hiding the control
// (RLS is the real enforcement, same as everywhere else in this module).
function _tdCanRemoveAttachment(a){
  if (_tdIsMD()) return true;
  return !!CURRENT_USER && String(a.uploaded_by || '').trim().toLowerCase() === String(CURRENT_USER.email || '').trim().toLowerCase();
}
// Compact square-thumbnail grid, same visual density as Field Service's photo picker
// (_fsRenderPhotoPreview in js/fieldservice.js: 72x72 tiles, red circular ✕ overlay top-right).
// Uploader/timestamp move out of the visible tile into a title="" tooltip (and the lightbox
// caption for images) so the grid itself stays clean instead of full-detail rows.
function _tdRenderAttachments(){
  const wrap = document.getElementById('tdDetailAttachmentsList');
  if (!wrap) return;
  if (!_tdDetailAttachments.length) {
    wrap.innerHTML = `<div style="color:var(--muted);font-size:0.82rem;padding:6px 0;">No attachments yet.</div>`;
    return;
  }
  wrap.innerHTML = _tdDetailAttachments.map((a, i) => {
    const isImage = (a.file_type || '').startsWith('image/');
    const tooltip = `${a.file_name} · ${a.uploaded_by} · ${_tdFmtDateTime(a.uploaded_at)}`;
    return `
    <div style="position:relative;width:72px;flex-shrink:0;">
      <div onclick="tdOpenAttachment(${i})" title="${_tdEsc(tooltip)}" style="width:72px;height:72px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;font-size:1.6rem;box-sizing:border-box;">
        <div id="tdAttachmentThumb-${i}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${isImage ? '' : '📄'}</div>
      </div>
      ${!isImage ? `<div style="font-size:0.62rem;color:var(--muted);text-align:center;margin-top:3px;width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_tdEsc(tooltip)}">${_tdEsc(a.file_name)}</div>` : ''}
      ${_tdCanRemoveAttachment(a) ? `<button onclick="tdRemoveAttachment(${i}, event)" title="Remove" aria-label="Remove" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#ff5c7c;color:#fff;font-size:0.72rem;cursor:pointer;line-height:20px;padding:0;">✕</button>` : ''}
    </div>`;
  }).join('');
  _tdDetailAttachments.forEach((a, i) => {
    if ((a.file_type || '').startsWith('image/')) _tdLoadAttachmentThumb(i, a.file_path);
  });
}
async function _tdFetchAttachmentBlobUrl(path){
  if (_tdAttachmentBlobCache.has(path)) return _tdAttachmentBlobCache.get(path);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${TD_ATTACHMENTS_BUCKET}/${encodeURIComponent(path)}`, { headers: SB_HDRS() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  _tdAttachmentBlobCache.set(path, url);
  return url;
}
async function _tdLoadAttachmentThumb(i, path){
  try {
    const url = await _tdFetchAttachmentBlobUrl(path);
    const el = document.getElementById(`tdAttachmentThumb-${i}`);
    if (el) el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
  } catch(e) {
    // leave the generic-file icon fallback in place
  }
}
// Bucket is private, so a plain link can't authenticate — fetch it the same way as thumbnails.
// Images get an inline lightbox (viewing a screenshot shouldn't force a save dialog); anything
// else (PDF/docx/etc, which has no meaningful in-page preview here) still opens via a throwaway
// <a download>, same as before.
async function tdOpenAttachment(i){
  const a = _tdDetailAttachments[i];
  if (!a) return;
  if ((a.file_type || '').startsWith('image/')) {
    tdOpenAttachmentLightbox(a);
    return;
  }
  try {
    const url = await _tdFetchAttachmentBlobUrl(a.file_path);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.file_name;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch(e) {
    alert('❌ Failed to open attachment: ' + e.message);
  }
}
// Reuses the same cached blob URL as the thumbnail (_tdFetchAttachmentBlobUrl) rather than
// fetching a second copy — a thumbnail can be on screen behind the lightbox at the same time,
// so the URL is only revoked centrally in _tdClearAttachmentCache (on modal close), not here;
// revoking it when the lightbox itself closes would break that still-visible thumbnail.
async function tdOpenAttachmentLightbox(a){
  try {
    const url = await _tdFetchAttachmentBlobUrl(a.file_path);
    document.getElementById('tdAttachmentLightboxImg').src = url;
    document.getElementById('tdAttachmentLightboxCaption').textContent = `${a.file_name} · ${a.uploaded_by} · ${_tdFmtDateTime(a.uploaded_at)}`;
    document.getElementById('tdAttachmentLightboxOverlay').classList.add('open');
  } catch(e) {
    alert('❌ Failed to load image: ' + e.message);
  }
}
function tdCloseAttachmentLightbox(){
  document.getElementById('tdAttachmentLightboxOverlay').classList.remove('open');
  document.getElementById('tdAttachmentLightboxImg').src = '';
  document.getElementById('tdAttachmentLightboxCaption').textContent = '';
}
// Storage-object-then-DB-row delete order mirrors js/upload.js's _deleteFilesOfNode — if the
// storage delete fails, we bail before touching the DB row so we never end up with a DB row
// pointing at a file we already tried (and failed) to remove.
async function tdRemoveAttachment(i, event){
  if (event) event.stopPropagation();
  const a = _tdDetailAttachments[i];
  if (!a) return;
  if (!confirm('Remove this attachment? This cannot be undone.')) return;
  try {
    const stRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${TD_ATTACHMENTS_BUCKET}/${encodeURIComponent(a.file_path)}`, {
      method: 'DELETE', headers: SB_HDRS()
    });
    if (!stRes.ok) throw new Error('Storage delete failed: HTTP ' + stRes.status);
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_attachments?id=eq.${a.id}`, {
      method: 'DELETE', headers: SB_HDRS_MIN()
    });
    if (!dbRes.ok) throw new Error(await dbRes.text());
  } catch(e) {
    alert('❌ Failed to remove attachment: ' + e.message);
    return;
  }
  const cached = _tdAttachmentBlobCache.get(a.file_path);
  if (cached) { URL.revokeObjectURL(cached); _tdAttachmentBlobCache.delete(a.file_path); }
  await _tdLoadAttachments(_tdDetailTaskId);
}
function _tdClearAttachmentCache(){
  _tdAttachmentBlobCache.forEach(url => URL.revokeObjectURL(url));
  _tdAttachmentBlobCache.clear();
}
function tdHandleAttachmentPaste(event){
  const items = event.clipboardData && event.clipboardData.items;
  if (!items || !_tdDetailTaskId) return;
  const imageItem = Array.from(items).find(item => item.type && item.type.startsWith('image/'));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  // Clipboard image Files often come back with a generic name (e.g. "image.png") and no
  // extension mismatch issue, but we still route it through the same named-File path as a
  // picked file so downstream code (safeName, file_name column) has nothing screenshot-specific
  // to special-case.
  const named = new File([file], file.name || `pasted-${Date.now()}.png`, { type: file.type });
  tdHandleAttachmentFiles([named]);
}
// Root cause of the "takes 3-4 tries" bug: this had no re-entrancy guard, and with no visible
// loading state, an impatient user (nothing seems to happen for a network round-trip) would
// paste/click again before the first attempt's upload -> DB insert -> _tdLoadAttachments
// round-trip finished. Each retry ran the full sequence independently and concurrently.
// _tdLoadAttachments has no request sequencing beyond a task-id match check — it just
// overwrites _tdDetailAttachments with whatever response lands last — so if an EARLIER
// attempt's list re-fetch happened to resolve AFTER a LATER attempt's, its stale snapshot
// (taken before the later upload's INSERT had committed) won permission to render, silently
// erasing the newer upload from view even though it was already persisted server-side. The
// user saw nothing appear, assumed the paste failed, and pasted again — which actually
// re-uploaded a duplicate rather than retrying a failed one, until the response ordering
// happened to align favorably. Fixed here two ways: (1) _tdAttachmentUploadBusy makes the
// whole upload sequence a single critical section, so overlapping triggers are flat-out
// ignored instead of racing; (2) the button/input/paste-zone get a visible "Uploading…"
// state, so a user who's actually just waiting on a slow network doesn't mistake it for a
// silent failure and manually retry into the same race.
let _tdAttachmentUploadBusy = false;
function _tdSetAttachmentUploadUi(busy){
  const label = document.getElementById('tdAttachmentUploadLabel');
  const labelText = document.getElementById('tdAttachmentUploadLabelText');
  const input = document.getElementById('tdAttachmentFileInput');
  const zone = document.getElementById('tdAttachmentPasteZone');
  if (input) input.disabled = busy;
  if (label) { label.style.opacity = busy ? '0.6' : '1'; label.style.pointerEvents = busy ? 'none' : 'auto'; }
  if (labelText) labelText.textContent = busy ? '⏳ Uploading…' : '+ Upload';
  if (zone) zone.style.opacity = busy ? '0.6' : '1';
}
async function tdHandleAttachmentFiles(fileList){
  if (!_tdDetailTaskId) return;
  if (_tdAttachmentUploadBusy) return; // an upload is already running — ignore the repeat trigger instead of racing it
  const files = Array.from(fileList || []);
  if (!files.length) return;
  _tdAttachmentUploadBusy = true;
  _tdSetAttachmentUploadUi(true);
  try {
    for (const file of files) {
      if (file.size > TD_ATTACHMENT_MAX_BYTES) {
        alert(`❌ "${file.name}" is larger than 10MB and was skipped.`);
        continue;
      }
      try {
        await _tdUploadAttachment(_tdDetailTaskId, file);
      } catch(e) {
        alert(`❌ Failed to upload "${file.name}": ${e.message}`);
      }
    }
    await _tdLoadAttachments(_tdDetailTaskId);
  } finally {
    _tdAttachmentUploadBusy = false;
    _tdSetAttachmentUploadUi(false);
  }
}
async function _tdUploadAttachment(taskId, file){
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${taskId}/${Date.now()}_${safeName}`;
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${TD_ATTACHMENTS_BUCKET}/${encodeURIComponent(path)}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON);
    xhr.setRequestHeader('Authorization', `Bearer ${_currentToken}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('HTTP ' + xhr.status + ' — ' + xhr.responseText.slice(0, 200)));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_attachments`, {
    method: 'POST', headers: SB_HDRS_MIN(),
    body: JSON.stringify([{
      task_id:         taskId,
      file_name:       file.name,
      file_path:       path,
      file_type:       file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      uploaded_by:     CURRENT_USER.email,
      uploaded_at:     new Date().toISOString()
    }])
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── New/Edit Task modal (MD) ─────────────────────────────────────────────
// ── Assign To: checkbox-dropdown multi-select ────────────────────────────
// No existing "pick multiple people" widget in the portal to match, so this reuses the
// checkbox-row look of the (otherwise unwired) .fms-product-item class rather than inventing
// a new visual pattern.
let _tdAssigneeMultiOptions   = []; // [{email_id, employee_name}] offered in the open modal
let _tdSelectedAssigneeEmails = []; // working selection for the open modal
function tdToggleAssigneeMultiDropdown(){
  const list = document.getElementById('tdTaskAssigneeMultiList');
  if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
}
function tdToggleAssigneeSelection(email, isChecked){
  if (isChecked) {
    if (!_tdSelectedAssigneeEmails.includes(email)) _tdSelectedAssigneeEmails.push(email);
  } else {
    _tdSelectedAssigneeEmails = _tdSelectedAssigneeEmails.filter(e => e !== email);
  }
  _tdRenderAssigneeMultiDropdown();
}
function _tdRenderAssigneeMultiDropdown(){
  const list  = document.getElementById('tdTaskAssigneeMultiList');
  const label = document.getElementById('tdTaskAssigneeMultiLabel');
  if (!list || !label) return;
  list.innerHTML = _tdAssigneeMultiOptions.map(a => {
    const checked = _tdSelectedAssigneeEmails.includes(a.email_id);
    return `<label class="fms-product-item" style="padding:8px 10px;">
      <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation()" onchange="tdToggleAssigneeSelection('${a.email_id}', this.checked)">
      <span>${_tdEsc(a.employee_name)}</span>
    </label>`;
  }).join('');
  label.textContent = _tdSelectedAssigneeEmails.length
    ? _tdSelectedAssigneeEmails.map(email => {
        const a = _tdAssigneeMultiOptions.find(o => o.email_id === email);
        return a ? a.employee_name.replace(/ \(inactive\)$/, '') : email;
      }).join(', ')
    : 'Select assignees…';
}
document.addEventListener('click', function(e){
  const wrap = document.getElementById('tdTaskAssigneeMultiWrap');
  const list = document.getElementById('tdTaskAssigneeMultiList');
  if (wrap && list && list.style.display !== 'none' && !wrap.contains(e.target)) list.style.display = 'none';
});

// ── Frequency: One-time (default) vs Daily/Weekly/Monthly ────────────────
function tdOnFrequencyChange(){
  const freq = document.getElementById('tdTaskFrequency').value;
  const isRecurring = freq !== 'one_time';
  document.getElementById('tdTaskDueDateGroup').style.display    = isRecurring ? 'none' : '';
  document.getElementById('tdTaskRecurrenceDates').style.display = isRecurring ? 'grid' : 'none';
  if (isRecurring) {
    const startInput = document.getElementById('tdTaskStartDate');
    if (!startInput.value) startInput.value = document.getElementById('tdTaskDueDate').value || '';
  }
}
function _tdAdvanceDate(dateStr, frequency){
  const d = new Date(dateStr + 'T00:00:00');
  if (frequency === 'daily')   d.setDate(d.getDate() + 1);
  if (frequency === 'weekly')  d.setDate(d.getDate() + 7);
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function tdOpenTaskModal(taskId){
  _tdEditingTaskId = taskId;
  const t = taskId ? _tdTasks.find(x => String(x.id) === String(taskId)) : null;
  let options = _tdAssignees.filter(a => a.is_active);
  const currentEmails = t ? _tdAssigneeEmailsForTask(t) : [];
  // If the task is currently assigned to someone who's since been deactivated, the active-only
  // list above won't contain them — without this, opening the modal would silently drop them
  // from the selection, unassigning them on save without the MD ever having touched anything.
  currentEmails.forEach(email => {
    if (!options.some(a => a.email_id === email)) {
      const known = _tdAssignees.find(a => a.email_id === email);
      options.push({ email_id: email, employee_name: (known ? known.employee_name : email) + ' (inactive)' });
    }
  });
  _tdAssigneeMultiOptions   = options;
  _tdSelectedAssigneeEmails = currentEmails.slice();
  document.getElementById('tdTaskAssigneeMultiList').style.display = 'none';
  _tdRenderAssigneeMultiDropdown();

  const freqRow = document.getElementById('tdTaskFrequencyRow');
  if (taskId) {
    document.getElementById('tdTaskModalTitle').textContent = 'Edit Task';
    document.getElementById('tdTaskTitle').value = t.task_title || '';
    document.getElementById('tdTaskDescription').value = t.task_description || '';
    document.getElementById('tdTaskDueDate').value = t.due_date || '';
    // Recurrence is configured once at template-creation time (+ New Task), not per generated
    // instance — editing an existing task never touches delegation_recurring_templates.
    freqRow.style.display = 'none';
    document.getElementById('tdTaskDueDateGroup').style.display = '';
    document.getElementById('tdTaskRecurrenceDates').style.display = 'none';
  } else {
    document.getElementById('tdTaskModalTitle').textContent = 'New Task';
    document.getElementById('tdTaskTitle').value = '';
    document.getElementById('tdTaskDescription').value = '';
    document.getElementById('tdTaskDueDate').value = '';
    document.getElementById('tdTaskStartDate').value = '';
    document.getElementById('tdTaskEndDate').value = '';
    freqRow.style.display = '';
    document.getElementById('tdTaskFrequency').value = 'one_time';
    tdOnFrequencyChange();
  }
  document.getElementById('tdTaskModalOverlay').classList.add('open');
}
function tdCloseTaskModal(){
  document.getElementById('tdTaskModalOverlay').classList.remove('open');
  document.getElementById('tdTaskAssigneeMultiList').style.display = 'none';
  _tdEditingTaskId = null;
}
async function tdSaveTask(){
  if (!CURRENT_USER) return;
  const title       = document.getElementById('tdTaskTitle').value.trim();
  const description = document.getElementById('tdTaskDescription').value.trim();
  const dueDate     = document.getElementById('tdTaskDueDate').value || null;
  const assignees   = _tdSelectedAssigneeEmails.slice();
  if (!title) { alert('❌ Task title is required.'); return; }
  if (!assignees.length) { alert('❌ Please choose at least one assignee.'); return; }

  const isEditing  = !!_tdEditingTaskId;
  const frequency  = (!isEditing) ? document.getElementById('tdTaskFrequency').value : 'one_time';
  let startDate = dueDate;
  let endDate   = null;
  if (frequency !== 'one_time') {
    startDate = document.getElementById('tdTaskStartDate').value || dueDate;
    endDate   = document.getElementById('tdTaskEndDate').value || null;
    if (!startDate) { alert('❌ Please choose a start date.'); return; }
  }

  const btn = document.getElementById('tdTaskSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (isEditing) {
      const payload = {
        task_title:        title,
        task_description:  description,
        assigned_to_email: assignees[0],
        due_date:          dueDate,
        updated_at:        new Date().toISOString()
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?id=eq.${_tdEditingTaskId}`, {
        method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const t = _tdTasks.find(x => String(x.id) === String(_tdEditingTaskId));
      Object.assign(t, payload);

      const prevEmails = _tdTaskAssigneeMap.get(_tdEditingTaskId) || [];
      const toAdd    = assignees.filter(e => !prevEmails.includes(e));
      const toRemove = prevEmails.filter(e => !assignees.includes(e));
      if (toRemove.length) {
        const inList = toRemove.map(e => encodeURIComponent(e)).join(',');
        await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_assignees?task_id=eq.${_tdEditingTaskId}&assignee_email=in.(${inList})`, {
          method: 'DELETE', headers: SB_HDRS_MIN()
        });
      }
      if (toAdd.length) {
        await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_assignees`, {
          method: 'POST', headers: SB_HDRS_MIN(),
          body: JSON.stringify(toAdd.map(email => ({ task_id: _tdEditingTaskId, assignee_email: email })))
        });
      }
      _tdTaskAssigneeMap.set(_tdEditingTaskId, assignees.slice());
      // Only the newly-added assignees get notified — anyone already on the task doesn't get a
      // duplicate email just because it was edited.
      if (toAdd.length) _tdSendAssignmentEmails(t, toAdd);
    } else if (frequency === 'one_time') {
      const payload = {
        task_title:        title,
        task_description:  description,
        assigned_to_email: assignees[0],
        due_date:          dueDate,
        assigned_by:       CURRENT_USER.email,
        status:            'pending',
        created_at:        new Date().toISOString()
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks`, {
        method: 'POST', headers: SB_HDRS_REPR(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const [saved] = await res.json();
      await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_assignees`, {
        method: 'POST', headers: SB_HDRS_MIN(),
        body: JSON.stringify(assignees.map(email => ({ task_id: saved.id, assignee_email: email })))
      });
      _tdTaskAssigneeMap.set(saved.id, assignees.slice());
      _tdTasks.unshift(saved);
      _tdSendAssignmentEmails(saved, assignees);
    } else {
      // Recurring: create the template (advanced past today, to the *next* occurrence) AND the
      // first occurrence as a normal task right away, so MD/assignees see it immediately instead
      // of waiting for tomorrow's cron run. The cron's delegation_generate_recurring_tasks() picks
      // up generation from here on.
      const tmplPayload = {
        task_title:       title,
        task_description: description,
        frequency,
        start_date:       startDate,
        next_run_date:    _tdAdvanceDate(startDate, frequency),
        end_date:         endDate,
        is_active:        true,
        created_by:       CURRENT_USER.email,
        created_at:       new Date().toISOString()
      };
      const tmplRes = await fetch(`${SUPABASE_URL}/rest/v1/delegation_recurring_templates`, {
        method: 'POST', headers: SB_HDRS_REPR(), body: JSON.stringify(tmplPayload)
      });
      if (!tmplRes.ok) throw new Error(await tmplRes.text());
      const [tmpl] = await tmplRes.json();
      await fetch(`${SUPABASE_URL}/rest/v1/delegation_recurring_template_assignees`, {
        method: 'POST', headers: SB_HDRS_MIN(),
        body: JSON.stringify(assignees.map(email => ({ template_id: tmpl.id, assignee_email: email })))
      });

      const taskPayload = {
        task_title:                   title,
        task_description:             description,
        assigned_to_email:            assignees[0],
        due_date:                     startDate,
        assigned_by:                  CURRENT_USER.email,
        status:                       'pending',
        created_at:                   new Date().toISOString(),
        source_recurring_template_id: tmpl.id
      };
      const taskRes = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks`, {
        method: 'POST', headers: SB_HDRS_REPR(), body: JSON.stringify(taskPayload)
      });
      if (!taskRes.ok) throw new Error(await taskRes.text());
      const [savedTask] = await taskRes.json();
      await fetch(`${SUPABASE_URL}/rest/v1/delegation_task_assignees`, {
        method: 'POST', headers: SB_HDRS_MIN(),
        body: JSON.stringify(assignees.map(email => ({ task_id: savedTask.id, assignee_email: email })))
      });
      _tdTaskAssigneeMap.set(savedTask.id, assignees.slice());
      _tdTasks.unshift(savedTask);
      _tdSendAssignmentEmails(savedTask, assignees);
    }
    tdCloseTaskModal();
    tdRenderAllTasksTable();
  } catch(e) {
    alert('❌ Failed to save task: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Task';
  }
}

// ── Assignment email (Resend, via the send-delegation-task-email Edge Function) ──────────────
// Fire-and-forget: a failed/slow send should never block the save flow or the modal closing.
// Cron-generated recurring occurrences never call this — delegation_generate_recurring_tasks()
// is a pure SQL function with no HTTP call, so daily-generated instances can't spam assignees.
function _tdSendAssignmentEmails(task, emails){
  if (!emails || !emails.length) return;
  const assigneePayload = emails.map(email => {
    const a = _tdAssignees.find(a => a.email_id === email);
    return { email, name: a ? a.employee_name : email };
  });
  fetch(`${SUPABASE_URL}/functions/v1/send-delegation-task-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_title:       task.task_title,
      task_description: task.task_description,
      due_date:         task.due_date,
      assigned_by:      CURRENT_USER.email,
      assignees:        assigneePayload
    })
  }).catch(e => console.warn('Task assignment email failed to send:', e));
}

// ── Assignee: My Tasks ───────────────────────────────────────────────────
// KPI tiles + table, consistent with MD's All Delegated Tasks view. Row click opens the shared
// detail modal (see tdOpenTaskDetailModal), where note/tentative_date/status are actually edited —
// nothing here in the table itself is ever an input, so there's nothing to tamper with via
// inspect-element.
function tdRenderMyTasksKpis(){
  const grid = document.getElementById('tdMyTasksKpiGrid');
  if (!grid) return;
  const completed = _tdTasks.filter(t => t.status === 'completed').length;
  const total = _tdTasks.length;
  const kpis = [
    { id:'all',       label:'Total Tasks', value: total,             color:'#818cf8' },
    { id:'pending',   label:'Pending',     value: total - completed, color:'#f0a500' },
    { id:'completed', label:'Completed',   value: completed,         color:'#00d4aa' },
  ];
  grid.innerHTML = kpis.map(k => {
    const isActive = k.id === 'all' ? !_tdMyActiveKpi : _tdMyActiveKpi === k.id;
    return `<div class="kpi-card ${isActive ? 'kpi-active' : ''}" style="--card-accent:${k.color};" onclick="tdMyKpiClick('${k.id}')">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
    </div>`;
  }).join('');
}
function tdMyKpiClick(id){
  _tdMyActiveKpi = (id === 'all' || _tdMyActiveKpi === id) ? null : id;
  tdRenderMyTasksTable();
}
function tdRenderMyTasksTable(){
  tdRenderMyTasksKpis();
  const tbody = document.getElementById('tdMyTasksBody');
  let rows = _tdTasks;
  if (_tdMyActiveKpi === 'pending')   rows = rows.filter(t => t.status !== 'completed');
  if (_tdMyActiveKpi === 'completed') rows = rows.filter(t => t.status === 'completed');
  rows = rows.slice().sort((a, b) => {
    const aDone = a.status === 'completed', bDone = b.status === 'completed';
    if (aDone !== bDone) return aDone ? 1 : -1; // pending first
    return aDone
      ? String(b.completed_at || '').localeCompare(String(a.completed_at || ''))
      : String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
  });
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--muted);">${_tdTasks.length ? 'No tasks match this filter.' : "You don't have any delegated tasks yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const overdue = _tdIsOverdue(t);
    const statusBadge = t.status === 'completed'
      ? _tdChip('✅ Completed', '#00d4aa22', '#00d4aa')
      : _tdChip('⏳ Pending', '#f0a50022', '#f0a500');
    return `
      <tr onclick="tdOpenTaskDetailModal('${t.id}')" style="cursor:pointer;${t.status === 'completed' ? 'opacity:0.65;' : ''}">
        <td style="${t.status === 'completed' ? 'text-decoration:line-through;' : ''}">${_tdEsc(t.task_title)}</td>
        <td>${overdue ? `<span style="color:#ff5c7c;font-weight:700;">⚠️ ${_tdFmtDate(t.due_date)}</span>` : _tdFmtDate(t.due_date)}</td>
        <td>${t.tentative_date ? _tdFmtDate(t.tentative_date) : '—'}</td>
        <td>${statusBadge}</td>
      </tr>`;
  }).join('');
}
async function tdToggleMyTaskStatus(id){
  const t = _tdTasks.find(x => String(x.id) === String(id));
  if (!t) return;
  const newStatus = t.status === 'completed' ? 'pending' : 'completed';
  const payload = { status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : null };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    Object.assign(t, payload);
    tdRenderMyTasksTable();
  } catch(e) {
    alert('❌ Failed to update task: ' + e.message);
  }
}
async function tdSaveNote(id, note){
  const t = _tdTasks.find(x => String(x.id) === String(id));
  if (!t || t.note === note) return; // no change — skip the write
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify({ note })
    });
    if (!res.ok) throw new Error(await res.text());
    t.note = note;
  } catch(e) {
    alert('❌ Failed to save note: ' + e.message);
  }
}
async function tdSaveTentativeDate(id, value){
  const t = _tdTasks.find(x => String(x.id) === String(id));
  const newVal = value || null;
  if (!t || t.tentative_date === newVal) return; // no change — skip the write
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?id=eq.${id}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify({ tentative_date: newVal })
    });
    if (!res.ok) throw new Error(await res.text());
    t.tentative_date = newVal;
    tdRenderMyTasksTable(); // re-render so the new Tentative Date column value appears immediately
  } catch(e) {
    alert('❌ Failed to save planned date: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const o1 = document.getElementById('tdAssigneeModalOverlay');
  if (o1) o1.addEventListener('click', e => { if (e.target === o1) tdCloseAssigneeModal(); });
  const o2 = document.getElementById('tdTaskModalOverlay');
  if (o2) o2.addEventListener('click', e => { if (e.target === o2) tdCloseTaskModal(); });
  const o3 = document.getElementById('tdTaskDetailModalOverlay');
  if (o3) o3.addEventListener('click', e => { if (e.target === o3) tdCloseTaskDetailModal(); });
});
// Escape closes the attachment lightbox — same convention as ruCloseScreenshotLightbox
// (js/renewals.js) and _fsCloseLightbox (js/fieldservice.js). Only acts while it's actually
// open, so it doesn't steal Escape from the detail modal underneath it.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('tdAttachmentLightboxOverlay');
  if (overlay && overlay.classList.contains('open')) tdCloseAttachmentLightbox();
});
