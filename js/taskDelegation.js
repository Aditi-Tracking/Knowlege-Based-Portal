// Section: Task Delegation (MD delegates tasks to specific employees; assignees manage their own list)
// Tables (Supabase): delegation_assignees (id, emp_id, employee_name, email_id, is_active, added_by, added_at)
//                    delegation_tasks (id, task_title, task_description, assigned_to_email, assigned_by,
//                    due_date, status, note, tentative_date, completed_at, created_at, updated_at)
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

async function _tdFetchAll(){
  if (_tdIsMD()) {
    const [assigneesRes, tasksRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/delegation_assignees?select=*&order=employee_name.asc`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?select=*&order=created_at.desc`, { headers: SB_HDRS() })
    ]);
    _tdAssignees = assigneesRes.ok ? await assigneesRes.json() : [];
    _tdTasks     = tasksRes.ok ? await tasksRes.json() : [];
  } else {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/delegation_tasks?select=*&assigned_to_email=ilike.${encodeURIComponent(CURRENT_USER.email)}&order=due_date.asc`,
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
  const scoped = _tdFilterAssignee ? _tdTasks.filter(t => t.assigned_to_email === _tdFilterAssignee) : _tdTasks;
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
  if (_tdFilterAssignee) rows = rows.filter(t => t.assigned_to_email === _tdFilterAssignee);
  if (_tdActiveKpi === 'pending')   rows = rows.filter(t => t.status !== 'completed');
  if (_tdActiveKpi === 'completed') rows = rows.filter(t => t.status === 'completed');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--muted);">No tasks match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const assignee = _tdAssignees.find(a => a.email_id === t.assigned_to_email);
    const statusBadge = t.status === 'completed'
      ? _tdChip('✅ Completed', '#00d4aa22', '#00d4aa')
      : _tdChip('⏳ Pending', '#f0a50022', '#f0a500');
    return `
      <tr onclick="tdOpenTaskDetailModal('${t.id}')" style="cursor:pointer;">
        <td>${_tdEsc(t.task_title)}</td>
        <td>${_tdEsc(assignee ? assignee.employee_name : t.assigned_to_email)}</td>
        <td>${_tdFmtDate(t.due_date)}</td>
        <td>${statusBadge}</td>
        <td style="color:var(--muted);font-size:0.8rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_tdEsc(t.note || '—')}</td>
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
  const assignee = _tdAssignees.find(a => a.email_id === t.assigned_to_email);
  document.getElementById('tdDetailTitle').textContent = t.task_title || '';
  document.getElementById('tdDetailAssignee').textContent = assignee ? assignee.employee_name : (t.assigned_to_email || '—');
  document.getElementById('tdDetailAssignedBy').textContent = t.assigned_by || '—';
  document.getElementById('tdDetailDueDate').textContent = _tdFmtDate(t.due_date);
  document.getElementById('tdDetailTentativeDate').textContent = t.tentative_date ? _tdFmtDate(t.tentative_date) : 'Not set yet';
  document.getElementById('tdDetailDescription').textContent = t.task_description || '—';
  _tdRefreshDetailStatusUi(t);

  const noteBlock    = document.getElementById('tdDetailNoteBlock');    // read-only — MD view
  const actionsBlock = document.getElementById('tdDetailActionsSection'); // editable — assignee view
  if (_tdIsMD()) {
    noteBlock.style.display = 'block';
    document.getElementById('tdDetailNote').textContent = t.note || '(no note yet)';
    actionsBlock.style.display = 'none';
  } else {
    noteBlock.style.display = 'none';
    actionsBlock.style.display = 'block';
    document.getElementById('tdDetailTentativeInput').value = t.tentative_date || '';
    document.getElementById('tdDetailNoteInput').value = t.note || '';
  }
  document.getElementById('tdTaskDetailModalOverlay').classList.add('open');
}
function tdCloseTaskDetailModal(){
  document.getElementById('tdTaskDetailModalOverlay').classList.remove('open');
  _tdDetailTaskId = null;
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

// ── New/Edit Task modal (MD) ─────────────────────────────────────────────
function tdOpenTaskModal(taskId){
  _tdEditingTaskId = taskId;
  const sel = document.getElementById('tdTaskAssignee');
  sel.innerHTML = _tdAssignees.filter(a => a.is_active).map(a => `<option value="${_tdEsc(a.email_id)}">${_tdEsc(a.employee_name)}</option>`).join('');
  if (taskId) {
    const t = _tdTasks.find(x => String(x.id) === String(taskId));
    document.getElementById('tdTaskModalTitle').textContent = 'Edit Task';
    document.getElementById('tdTaskTitle').value = t.task_title || '';
    document.getElementById('tdTaskDescription').value = t.task_description || '';
    sel.value = t.assigned_to_email || '';
    document.getElementById('tdTaskDueDate').value = t.due_date || '';
  } else {
    document.getElementById('tdTaskModalTitle').textContent = 'New Task';
    document.getElementById('tdTaskTitle').value = '';
    document.getElementById('tdTaskDescription').value = '';
    document.getElementById('tdTaskDueDate').value = '';
  }
  document.getElementById('tdTaskModalOverlay').classList.add('open');
}
function tdCloseTaskModal(){
  document.getElementById('tdTaskModalOverlay').classList.remove('open');
  _tdEditingTaskId = null;
}
async function tdSaveTask(){
  if (!CURRENT_USER) return;
  const title       = document.getElementById('tdTaskTitle').value.trim();
  const description = document.getElementById('tdTaskDescription').value.trim();
  const assignedTo  = document.getElementById('tdTaskAssignee').value;
  const dueDate     = document.getElementById('tdTaskDueDate').value || null;
  if (!title) { alert('❌ Task title is required.'); return; }
  if (!assignedTo) { alert('❌ Please choose an assignee.'); return; }
  const btn = document.getElementById('tdTaskSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const payload = {
      task_title:        title,
      task_description:  description,
      assigned_to_email: assignedTo,
      due_date:          dueDate,
      updated_at:        new Date().toISOString()
    };
    if (_tdEditingTaskId) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks?id=eq.${_tdEditingTaskId}`, {
        method: 'PATCH', headers: SB_HDRS_MIN(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      Object.assign(_tdTasks.find(t => String(t.id) === String(_tdEditingTaskId)), payload);
    } else {
      payload.assigned_by = CURRENT_USER.email;
      payload.status      = 'pending';
      payload.created_at  = new Date().toISOString();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/delegation_tasks`, {
        method: 'POST', headers: SB_HDRS_REPR(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const [saved] = await res.json();
      _tdTasks.unshift(saved);
    }
    tdCloseTaskModal();
    tdRenderAllTasksTable();
  } catch(e) {
    alert('❌ Failed to save task: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Task';
  }
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
