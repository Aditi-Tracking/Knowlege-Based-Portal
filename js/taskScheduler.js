// Section: Task Scheduler (MIS/owner-only tab inside the Task Checklist
// Dashboard — see js/tasks.js:tSwitchTab). Generates recurring
// employee_checklists rows automatically instead of inserting them by hand.
//
// All date math below is deliberately split into small, named functions
// so the whole "which dates get generated, and how holidays/Sundays shift
// them" logic can be read top-to-bottom instead of living in one dense
// block. Nothing here writes to the database directly — the actual INSERT
// happens server-side (backend/api.py: POST /api/admin/generate-checklist-tasks),
// which re-checks the caller is MIS/owner before touching anything. This
// file only computes the preview and, once the MIS user confirms it,
// sends the exact list of dates they saw.

// ── State ────────────────────────────────────────────────────────────
let _tsEmployees      = [];   // [{Emp_id, Employee_name, Employee_Dept, Location, Email_Id}]
let _tsHolidaysByLoc  = {};   // { 'Mumbai': Set('YYYY-MM-DD'), 'Goa': Set(...), ... }
let _tsLoaded         = false;
let _tsSelectedEmp    = null; // the employee object picked from the dropdown
let _tsPreviewRows    = [];   // last computed preview — this exact array is what gets submitted

// ── tsInit() — lazy-loaded the first time the Scheduler tab is opened ──
// (called from js/tasks.js:tSwitchTab). No-ops on repeat visits.
async function tsInit(){
  if(_tsLoaded) return;
  _tsLoaded = true;
  try{
    // Holiday List's RLS policy is scoped to the 'anon' role specifically
    // (see js/hr.js:loadHolidayCard) — it must be fetched with the anon
    // key even though the user is logged in, not with SB_HDRS()'s user JWT.
    const holAnonHdrs = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}`, 'Accept': 'application/json' };

    const [empRes, holRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept,Location,Email_Id&order=Employee_name`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/Holiday%20List?select=Date,Location`, { headers: holAnonHdrs }),
    ]);
    _tsEmployees = await empRes.json();
    if(!Array.isArray(_tsEmployees)) _tsEmployees = [];

    const holRows = await holRes.json();
    _tsHolidaysByLoc = {};
    (Array.isArray(holRows) ? holRows : []).forEach(h => {
      const loc = h.Location || 'Mumbai';
      if(!_tsHolidaysByLoc[loc]) _tsHolidaysByLoc[loc] = new Set();
      _tsHolidaysByLoc[loc].add(String(h.Date).slice(0, 10));
    });
  }catch(e){
    _tsLoaded = false; // allow a retry next time the tab is opened
    console.error('Task Scheduler: failed to load employees/holidays', e);
    const errEl = document.getElementById('tsFormError');
    if(errEl){ errEl.style.display = 'block'; errEl.textContent = '❌ Failed to load employee/holiday data — try reopening this tab.'; }
  }
}

// ══════════════════════════════════════════════════════════════════════
// EMPLOYEE SEARCHABLE DROPDOWN
// ══════════════════════════════════════════════════════════════════════
function tsFilterEmployees(q){
  const box = document.getElementById('tsEmpResults');
  if(!box) return;
  const query = String(q || '').trim().toLowerCase();
  if(!query){ box.style.display = 'none'; box.innerHTML = ''; return; }

  const matches = _tsEmployees
    .filter(e => String(e.Employee_name || '').toLowerCase().includes(query))
    .slice(0, 20); // cap the list — nobody needs to scroll through the whole roster

  if(!matches.length){
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:0.82rem;">No match</div>';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = matches.map(e => `
    <div onclick="tsSelectEmployee(${e.Emp_id})"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:0.85rem;"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight:600;color:var(--text);">${e.Employee_name || '—'}</div>
      <div style="font-size:0.74rem;color:var(--muted);">${e.Employee_Dept || ''}${e.Location ? ' · ' + e.Location : ''}</div>
    </div>`).join('');
}

async function tsSelectEmployee(empId){
  const emp = _tsEmployees.find(e => e.Emp_id === empId);
  if(!emp) return;
  _tsSelectedEmp = emp;
  document.getElementById('tsEmpSearch').value = emp.Employee_name || '';
  document.getElementById('tsEmpId').value = emp.Emp_id;
  document.getElementById('tsEmpResults').style.display = 'none';
  tsInvalidatePreview();

  // Auto-fill branch_id from this employee's most recent existing checklist
  // row. branch_id isn't stored on Employee_details (only Location is), and
  // the `branches` table isn't readable with the anon/user key, so this is
  // the most reliable source available. MIS can still type over it by hand.
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?select=branch_id&emp_id=eq.${encodeURIComponent(empId)}&branch_id=not.is.null&order=id.desc&limit=1`,
      { headers: SB_HDRS() }
    );
    const rows = await res.json();
    if(Array.isArray(rows) && rows[0] && rows[0].branch_id != null){
      document.getElementById('tsBranchId').value = rows[0].branch_id;
    }
  }catch(e){ /* non-fatal — MIS can enter branch_id manually */ }
}

// Close the results dropdown when clicking anywhere else on the page.
document.addEventListener('click', function(e){
  const box = document.getElementById('tsEmpResults');
  const input = document.getElementById('tsEmpSearch');
  if(box && input && box.style.display !== 'none' && !box.contains(e.target) && e.target !== input){
    box.style.display = 'none';
  }
});

// ══════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ══════════════════════════════════════════════════════════════════════

// YYYY-MM-DD in LOCAL time. Deliberately NOT using d.toISOString() — that
// converts to UTC first, which silently prints the PREVIOUS day for anyone
// in a timezone behind UTC (which includes most of the world at night).
function tsDateToISO(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The reverse of the above. `new Date('YYYY-MM-DD')` parses as UTC
// midnight, which then DISPLAYS as the previous day in negative-UTC-offset
// timezones — the exact bug tsDateToISO avoids on the way out. Building the
// Date from its Y/M/D parts directly keeps everything in local time.
function tsParseISO(s){
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function tsAddDays(d, n){
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
}

// "Same day, N months later" — but clamped to the target month's last day
// when it's shorter than the anchor day. Without this, naive date math on
// e.g. Jan 31 + 1 month rolls over into March 3 (Feb only has 28/29 days),
// which is not what "monthly on the 31st" should mean.
function tsAddMonthsClamped(d, n){
  const targetIndex = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(targetIndex / 12);
  const m = ((targetIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(y, m + 1, 0).getDate(); // day 0 of next month = last day of this one
  const day = Math.min(d.getDate(), lastDayOfTargetMonth);
  return new Date(y, m, day);
}

// The <input type="month"> value is "YYYY-MM". Returns the LAST calendar
// day of that month, as a local Date — the far edge of the generation window.
function tsEndOfMonth(yyyyMm){
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m, 0); // day 0 of "next" month = last day of month m
}

// The date of the Nth occurrence of `weekday` (0=Sun..6=Sat) inside the
// given month — e.g. "the 2nd Saturday of March 2026". May land in the
// FOLLOWING month if that occurrence doesn't exist (e.g. a "5th Sunday"
// some months don't have) — JS's Date constructor auto-rolls the overflow
// forward rather than throwing, so the caller below checks for that.
function tsNthWeekdayOfMonth(year, monthIndex0, weekday, n){
  const first = new Date(year, monthIndex0, 1);
  const firstWeekday = first.getDay();
  const dayOfMonth = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, monthIndex0, dayOfMonth);
}

// ══════════════════════════════════════════════════════════════════════
// HOLIDAY-AWARE WORKING-DAY HELPERS
// ══════════════════════════════════════════════════════════════════════

// A "working day" for scheduling = not a Sunday AND not listed in the
// Holiday List for this employee's location. _holNormLoc() (js/hr.js)
// already maps every raw Employee_details.Location value (HeadOffice,
// Pune, Indore, Satara, Nagpur, ...) down to one of the 4 locations the
// Holiday List actually has rows for, defaulting to Mumbai — reused as-is
// here rather than duplicating that mapping.
function tsHolidaySetForEmployee(emp){
  const locKey = (typeof _holNormLoc === 'function') ? _holNormLoc(emp && emp.Location) : 'Mumbai';
  return _tsHolidaysByLoc[locKey] || new Set();
}

function tsIsSunday(d){
  return d.getDay() === 0; // JS Date: 0 = Sunday
}

function tsIsWorkingDay(d, holidaySet){
  if(tsIsSunday(d)) return false;
  return !holidaySet.has(tsDateToISO(d));
}

// The literal "if it lands on a Sunday/holiday, shift forward — and keep
// shifting if the NEXT day is also a Sunday/holiday" rule. A while loop
// (not a single if) on purpose: a holiday sitting right next to a Sunday,
// or two holidays back-to-back, both need walking past correctly.
function tsShiftToWorkingDay(d, holidaySet){
  const shifted = new Date(d.getTime());
  while(!tsIsWorkingDay(shifted, holidaySet)){
    shifted.setDate(shifted.getDate() + 1);
  }
  return shifted;
}

// ══════════════════════════════════════════════════════════════════════
// PER-FREQUENCY OCCURRENCE GENERATORS
//
// Each returns the RAW anchor dates (BEFORE the Sunday/holiday shift is
// applied) from `start` through `end`, inclusive. Keeping "raw" separate
// from "shifted" matters: tsGenerateOccurrences() below shifts each
// occurrence independently, so a shift never moves where the NEXT
// occurrence is anchored — e.g. Fortnightly stays exactly 14 days apart
// even across a holiday, instead of drifting.
// ══════════════════════════════════════════════════════════════════════

function tsRawDaily(start, end){
  const out = [];
  let cur = new Date(start.getTime());
  while(cur <= end){ out.push(new Date(cur.getTime())); cur = tsAddDays(cur, 1); }
  return out;
}

// Covers Weekly (n=7), "2D" (n=2), and Fortnightly (n=14) — all three are
// just "every N calendar days from the anchor", confirmed against real
// data for W/F, and confirmed directly by the user for 2D (start, +2, +4, ...).
function tsRawEveryNDays(start, end, n){
  const out = [];
  let cur = new Date(start.getTime());
  while(cur <= end){ out.push(new Date(cur.getTime())); cur = tsAddDays(cur, n); }
  return out;
}

// Covers Monthly (everyNMonths=1), Quarterly (3), and Yearly (12) — all
// three are "same day-of-month, every N months", month-end clamped.
function tsRawMonthly(start, end, everyNMonths){
  const out = [];
  let step = 0;
  while(true){
    const d = tsAddMonthsClamped(start, step * everyNMonths);
    if(d > end) break;
    out.push(d);
    step++;
  }
  return out;
}

// Covers E2nd (n=2) and E3rd (n=3) — "the Nth occurrence of the anchor's
// weekday, every month". The anchor's weekday is fixed for the whole
// series (e.g. if start_date is a Saturday, every generated date is the
// Nth Saturday of its month).
function tsRawNthWeekdayEachMonth(start, end, n){
  const weekday = start.getDay();
  const out = [];
  let y = start.getFullYear(), m = start.getMonth();
  while(true){
    const d = tsNthWeekdayOfMonth(y, m, weekday, n);
    if(d > end) break;
    if(d.getMonth() === m) out.push(d); // guard: drop if the Nth occurrence overflowed past this month (e.g. no "5th Sunday" this month)
    m++; if(m > 11){ m = 0; y++; }
  }
  return out;
}

// ── Main entry point ─────────────────────────────────────────────────
// Returns [{ date: Date, iso: 'YYYY-MM-DD', shiftedFrom: 'YYYY-MM-DD'|null }]
function tsGenerateOccurrences(frequency, startDate, endDate){
  let raw;
  switch(frequency){
    case 'D':    raw = tsRawDaily(startDate, endDate); break;
    case 'W':    raw = tsRawEveryNDays(startDate, endDate, 7); break;
    case '2D':   raw = tsRawEveryNDays(startDate, endDate, 2); break;
    case 'F':    raw = tsRawEveryNDays(startDate, endDate, 14); break;
    case 'M':    raw = tsRawMonthly(startDate, endDate, 1); break;
    case 'Q':    raw = tsRawMonthly(startDate, endDate, 3); break;
    case 'Y':    raw = tsRawMonthly(startDate, endDate, 12); break;
    case 'E2nd': raw = tsRawNthWeekdayEachMonth(startDate, endDate, 2); break;
    case 'E3rd': raw = tsRawNthWeekdayEachMonth(startDate, endDate, 3); break;
    default:     raw = [];
  }

  const holidaySet = tsHolidaySetForEmployee(_tsSelectedEmp);
  const seenISO = new Set(); // guards against two shifted dates colliding on the same day
  const out = [];

  raw.forEach(rawDate => {
    if(frequency === 'D'){
      // Daily is DENSE — there's already a candidate for every calendar
      // day. A non-working day is EXCLUDED here, never shifted: shifting
      // Sunday's task onto Monday would collide with Monday's own,
      // separately-generated, Daily occurrence — a guaranteed duplicate.
      if(!tsIsWorkingDay(rawDate, holidaySet)) return;
      out.push({ date: rawDate, iso: tsDateToISO(rawDate), shiftedFrom: null });
      return;
    }
    // Every other frequency is SPARSE (days/weeks/months apart) — shifting
    // one occurrence forward by a day or two is safe because it can't
    // reach the next occurrence in the series.
    const shifted = tsShiftToWorkingDay(rawDate, holidaySet);
    const iso = tsDateToISO(shifted);
    if(seenISO.has(iso)) return; // two occurrences collapsed onto the same shifted day — drop the second rather than duplicate it
    seenISO.add(iso);
    const rawISO = tsDateToISO(rawDate);
    out.push({ date: shifted, iso, shiftedFrom: (iso !== rawISO) ? rawISO : null });
  });

  return out;
}

// ══════════════════════════════════════════════════════════════════════
// PREVIEW — form validation, date generation, duplicate check, render
// ══════════════════════════════════════════════════════════════════════

function tsInvalidatePreview(){
  _tsPreviewRows = [];
  const section = document.getElementById('tsPreviewSection');
  if(section) section.style.display = 'none';
}

async function tsPreview(){
  const errEl = document.getElementById('tsFormError');
  errEl.style.display = 'none';
  tsInvalidatePreview();

  const empId       = document.getElementById('tsEmpId').value;
  const taskName     = document.getElementById('tsTaskName').value.trim();
  const frequency    = document.getElementById('tsFrequency').value;
  const startStr     = document.getElementById('tsStartDate').value;
  const endMonthStr  = document.getElementById('tsEndMonth').value;

  if(!empId || !taskName || !startStr || !endMonthStr){
    errEl.textContent = '⚠️ Employee, Task Name, Start Date, and Generate-Through month are all required.';
    errEl.style.display = 'block';
    return;
  }

  const startDate = tsParseISO(startStr);
  const endDate   = tsEndOfMonth(endMonthStr);
  if(endDate < startDate){
    errEl.textContent = '⚠️ "Generate Through" month is before the Start Date.';
    errEl.style.display = 'block';
    return;
  }

  const occurrences = tsGenerateOccurrences(frequency, startDate, endDate);
  if(!occurrences.length){
    errEl.textContent = '⚠️ No dates were generated for this range — every candidate landed on a non-working day, or the range is empty.';
    errEl.style.display = 'block';
    return;
  }
  if(occurrences.length > 400){
    errEl.textContent = `⚠️ This would generate ${occurrences.length} rows in one batch — narrow the date range (max 400 per "Generate" click).`;
    errEl.style.display = 'block';
    return;
  }

  // Duplicate check — does this employee already have a task with this
  // exact name on any of these dates? Read-only, same anon/JWT REST access
  // every other read in this app already uses; only a WARNING, not a hard
  // block — MIS can still choose to insert anyway (e.g. a genuine 2nd task
  // that day under the same name).
  let existingDates = new Set();
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?select=planned_date&emp_id=eq.${encodeURIComponent(empId)}&task_name=eq.${encodeURIComponent(taskName)}`,
      { headers: SB_HDRS() }
    );
    const rows = await res.json();
    if(Array.isArray(rows)) rows.forEach(r => { if(r.planned_date) existingDates.add(String(r.planned_date).slice(0, 10)); });
  }catch(e){ /* non-fatal — duplicate check is advisory only */ }

  _tsPreviewRows = occurrences.map(o => ({ ...o, isDuplicate: existingDates.has(o.iso) }));
  tsRenderPreview(taskName, frequency);
}

function tsRenderPreview(taskName, frequency){
  const dupCount   = _tsPreviewRows.filter(r => r.isDuplicate).length;
  const shiftCount = _tsPreviewRows.filter(r => r.shiftedFrom).length;

  document.getElementById('tsPreviewSummary').textContent =
    `${_tsPreviewRows.length} task row(s) will be created for "${taskName}" (${frequency}).` +
    (shiftCount ? ` ${shiftCount} shifted off a Sunday/holiday.` : '');

  const dupBox = document.getElementById('tsDupWarning');
  if(dupCount > 0){
    dupBox.style.display = 'block';
    dupBox.textContent = `⚠️ ${dupCount} of these dates already have a task named "${taskName}" for this employee — highlighted below. Inserting anyway will create a second row on that date.`;
  }else{
    dupBox.style.display = 'none';
  }

  document.getElementById('tsPreviewBody').innerHTML = _tsPreviewRows.map((r, i) => {
    const dayName = r.date.toLocaleDateString('en-IN', { weekday: 'short' });
    let note = '';
    if(r.shiftedFrom) note += `shifted from ${r.shiftedFrom} (Sun/holiday)`;
    if(r.isDuplicate)  note += (note ? ' · ' : '') + '⚠️ duplicate';
    return `<tr style="${r.isDuplicate ? 'background:rgba(255,92,124,0.08);' : ''}">
      <td style="padding:6px 8px;">${i + 1}</td>
      <td style="padding:6px 8px;">${r.iso}</td>
      <td style="padding:6px 8px;">${dayName}</td>
      <td style="padding:6px 8px;font-size:0.78rem;color:${r.isDuplicate ? '#ff5c7c' : 'var(--muted)'};">${note || '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('tsPreviewSection').style.display = 'block';
  document.getElementById('tsPreviewSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ══════════════════════════════════════════════════════════════════════
// CONFIRM & INSERT — sends the exact previewed dates to the Flask backend
// ══════════════════════════════════════════════════════════════════════
async function tsConfirmInsert(){
  if(!_tsPreviewRows.length) return;

  const dupCount = _tsPreviewRows.filter(r => r.isDuplicate).length;
  if(dupCount > 0){
    const proceed = confirm(`${dupCount} of these dates already have a task with this name for this employee. Insert anyway?`);
    if(!proceed) return;
  }

  const empId    = document.getElementById('tsEmpId').value;
  const branchId = document.getElementById('tsBranchId').value;
  const taskName = document.getElementById('tsTaskName').value.trim();
  const frequency = document.getElementById('tsFrequency').value;

  const btn = document.getElementById('tsConfirmBtn');
  const statusEl = document.getElementById('tsSubmitStatus');
  btn.disabled = true;
  statusEl.textContent = '⏳ Inserting...';
  statusEl.style.color = 'var(--muted)';

  try{
    const res = await fetch(`${_PAPI}/api/admin/generate-checklist-tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': CURRENT_USER.email
      },
      body: JSON.stringify({
        emp_id:        Number(empId),
        branch_id:     branchId ? Number(branchId) : null,
        task_name:     taskName,
        frequency:     frequency,
        planned_dates: _tsPreviewRows.map(r => r.iso)
      })
    });
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    statusEl.textContent = `✅ ${data.inserted} task(s) created.` + (data.warning ? ` (${data.warning})` : '');
    statusEl.style.color = '#00d4aa';
    if(typeof showToast === 'function') showToast(`✅ Generated ${data.inserted} task(s) for "${taskName}"`, 'success', 4000);

    // Clear so a stale preview can't be re-submitted, and reset the task
    // name for the next series (employee/branch/frequency/dates are left
    // as-is — MIS is likely about to add another task for the same person).
    tsInvalidatePreview();
    document.getElementById('tsTaskName').value = '';

    // If the Checklist tab is currently showing this date range, refresh it
    // so the newly-generated rows appear without a manual reload.
    if(typeof _tasksLastSync !== 'undefined') _tasksLastSync = 0;
    if(typeof tSilentRefresh === 'function') tSilentRefresh();

  }catch(e){
    statusEl.textContent = `❌ ${e.message}`;
    statusEl.style.color = '#ff5c7c';
  }finally{
    btn.disabled = false;
  }
}
