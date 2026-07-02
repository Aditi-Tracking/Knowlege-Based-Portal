// Section: Task Checklist (loadTasks, markTaskDone, ongoing tasks, uploads)
// Department → sheet mapping removed (Supabase se direct fetch hoga)
// Managing Director/MIS/PC = fetch all (owner role check rahega)
let tAllData=[], tFiltered=[], tPage=1, tLoaded=false;
let tActiveKpi=null, tActivePerson=null, tActiveDept=null, tActiveStatus=null, tActiveFreq=null, tActiveDateFrom=null, tActiveDateTo=null, tActiveLocation=null;

function tParseDate(v){
  if(!v) return '';
  let s=String(v).trim();
  // dd/mm/yyyy
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  // yyyy-mm-dd
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return m[0].slice(0,10);
  return s.slice(0,10);
}
const T_PER_PAGE=20;
let tCharts={};

// ── Supabase paginated fetch — 1000 row limit bypass karo ──
async function tFetchAllPages(baseUrl){
  const BATCH = 1000;
  let all = [];
  let offset = 0;
  while(true){
    const url = `${baseUrl}&limit=${BATCH}&offset=${offset}`;
    const res = await fetch(url, { headers: SB_HDRS() });
    const batch = await res.json();
    if(!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch); // FIX: avoid creating new array every iteration
    if(batch.length < BATCH) break; // last page
    offset += BATCH;
    if(offset > 100000) break; // safety cap at 100k
  }
  return all;
}

async function loadTasks(overrideDateFrom, overrideDateTo){
  // Loader overlay — content hide mat karo, sirf dim karo (no jerk/flash)
  const _tasksCont = document.getElementById('tasksCont');
  const _isFirstLoad = !window._tasksEverLoaded;
  if(_isFirstLoad){
    document.getElementById('tasksLoad').style.display='flex';
    _tasksCont.style.display='none';
  } else {
    document.getElementById('tasksLoad').style.display='none';
    _tasksCont.style.opacity='0.45';
    _tasksCont.style.pointerEvents='none';
    _tasksCont.style.transition='opacity 0.2s';
  }
  try{
    const isOwner = PERMISSIONS.checklist_scope === 'all';
    const myEmail = CURRENT_USER ? String(CURRENT_USER.email||'').trim().toLowerCase() : '';

    // ── Date: dono ke liye today default, admin date change kar sakta hai ──
    const todayStr = new Date().toISOString().slice(0,10);
    const fetchFrom = overrideDateFrom || document.getElementById('tFDateFrom').value || todayStr;
    const fetchTo   = overrideDateTo   || document.getElementById('tFDateTo').value   || todayStr;

    // UI mein date set karo (dono ke liye)
    document.getElementById('tFDateFrom').value = fetchFrom;
    document.getElementById('tFDateTo').value   = fetchTo;
    tActiveDateFrom = fetchFrom;
    tActiveDateTo   = fetchTo;

    // ── Step 1: Email se emp_id dhundho (employee ke liye) ──
    let myEmpId = null;
    if(!isOwner && myEmail){
      const empRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(myEmail)}&limit=1`,
        { headers: SB_HDRS() }
      );
      const empRows = await empRes.json();
      if(empRows && empRows[0]){
        myEmpId = String(empRows[0].Emp_id || empRows[0].emp_id || '').trim();
      }
      if(!myEmpId){
        tAllData=[];
        const warn=document.getElementById('tNoTaskWarn');
        if(warn){
          warn.style.display='block';
          warn.innerHTML=`<div style="background:rgba(255,92,124,0.08);border:1px solid rgba(255,92,124,0.3);border-radius:12px;padding:16px 20px;margin:16px 0">
            <div style="color:#ff5c7c;font-weight:700;margin-bottom:8px">⚠️ No tasks found!</div>
            <div style="font-size:0.88rem;margin-bottom:6px">Login email: <b style="color:#f0a500">${myEmail}</b></div>
            <div style="font-size:0.82rem;color:#f0a500">👆 Login email Employee_details table mein nahi mila!</div>
          </div>`;
        }
        document.getElementById('tasksLoad').style.display='none';
        document.getElementById('tasksCont').style.display='block';
        return;
      }
    }

    // ── Step 2: Tasks fetch — ek hi query mein planned tasks + pending ongoing tasks ──
    // OR condition: (planned_date in range) OR (ongoing date in range AND not done)
    // NOTE: actual_timestamp wali condition hata di — done task sirf apni planned_date pe dikhega,
    // doosre din nahi aayega chahe kisi bhi din done kiya ho
    const orFilter = `or=(and(planned_date.gte.${fetchFrom},planned_date.lte.${fetchTo}),and(ongoing.gte.${fetchFrom},ongoing.lte.${fetchTo},actual_timestamp.is.null))`;
    let tasksBaseUrl;
    if(isOwner){
      tasksBaseUrl = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
                   + `&${orFilter}`
                   + `&order=planned_date.desc,id.asc`;
    } else {
      tasksBaseUrl = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
                   + `&emp_id=eq.${encodeURIComponent(myEmpId)}`
                   + `&${orFilter}`
                   + `&order=planned_date.desc,id.asc`;
    }

    const tasks = await tFetchAllPages(tasksBaseUrl);
    if(!Array.isArray(tasks)) throw new Error('Tasks fetch failed');

    // tasks = planned tasks + pending ongoing tasks (already merged in one query)
    const mergedTasks = tasks;

    // ── Step 3: Employee_details batch fetch ──
    const empIdSet = [...new Set(mergedTasks.map(r=>String(r.emp_id||'').trim()).filter(Boolean))];
    let empMap = {};
    if(empIdSet.length > 0){
      const edRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept,Email_Id,Location&Emp_id=in.(${empIdSet.join(',')})`,
        { headers: SB_HDRS() }
      );
      const edRows = await edRes.json();
      if(Array.isArray(edRows)){
        edRows.forEach(r=>{
          const id = String(r.Emp_id || r.emp_id || '').trim();
          if(id) empMap[id] = {
            name:  String(r.Employee_name || '').trim(),
            dept:  String(r.Employee_Dept || '').trim(),
            email: String(r.Email_Id || '').trim(),
            loc:   String(r.Location || '').trim(),
          };
        });
      }
    }

    // ── Step 4: Build tAllData from merged tasks ──
    tAllData = mergedTasks.map(r => {
      const empId = String(r.emp_id || '').trim();
      const ed = empMap[empId] || {};
      // expected_date: YYYY-MM-DD → DD/MM/YYYY for display
      const expRaw = r.ongoing ? String(r.ongoing).trim() : null;
      const expParts = expRaw ? expRaw.split('-') : null;
      const expDisplay = expParts && expParts.length===3 ? `${expParts[2]}/${expParts[1]}/${expParts[0]}` : null;
      return {
        'Name':             ed.name  || empId || '',
        'Email':            ed.email || '',
        'Department':       ed.dept  || '',
        'Task ID':          String(r.sheet_task_id || '').trim(),
        'Freq':             String(r.frequency || '').trim(),
        'Task':             String(r.task_name || '').trim(),
        'Planned':          String(r.planned_date || r.planned_data || '').trim(),
        'Actual':           String(r.actual_timestamp || '').trim(),
        'Status':           r.actual_timestamp ? 'Done' : 'Pending',
        'Remarks':          String(r.remarks || '').trim(),
        '_location':        ed.loc || String(r.branch_id || '').trim(),
        '_id':              r.id,
        '_expected_date':   expRaw,
        '_expected_display':expDisplay,
        '_upload_url':      r.upload ? String(r.upload).trim() : null,
      };
    });

    if(tAllData.length===0 && !isOwner){
      const warn=document.getElementById('tNoTaskWarn');
      if(warn){
        warn.style.display='block';
        warn.innerHTML=`<div style="background:rgba(255,92,124,0.08);border:1px solid rgba(255,92,124,0.3);border-radius:12px;padding:16px 20px;margin:16px 0">
          <div style="color:#ff5c7c;font-weight:700;margin-bottom:8px">⚠️ No tasks found!</div>
          <div style="font-size:0.88rem;margin-bottom:6px">Login email: <b style="color:#f0a500">${myEmail}</b> | Emp ID: <b style="color:#f0a500">${myEmpId}</b></div>
          <div style="font-size:0.82rem;color:#f0a500">👆 employee_checklists mein is emp_id ka koi record nahi mila.</div>
        </div>`;
      }
      const navTasks=document.getElementById('nav-tasks');
      if(navTasks)navTasks.style.display='none';
      // Dashboards Tasks se independent — PERMISSIONS se control hoga
      const hasDashAccess=
        PERMISSIONS.can_view_crm==='true'||
        PERMISSIONS.can_view_leads==='true'||
        PERMISSIONS.can_view_enterprise==='true'||
        PERMISSIONS.can_view_collection==='true'||
        PERMISSIONS.can_view_fms==='true'||
        PERMISSIONS.can_view_ims==='true'||
        PERMISSIONS.can_view_mapping==='true';
      const navDash=document.getElementById('nav-dashboards-trigger');
      if(navDash)navDash.style.display=hasDashAccess?'':'none';
      const dashGroup=document.getElementById('dashboardSubGroup');
      if(dashGroup)dashGroup.style.display=hasDashAccess?'':'none';
      document.querySelectorAll('#panel-home .home-card').forEach(card=>{
        if(card.textContent.includes('Task Checklist'))card.style.display='none';
      });
    }

    tAllData.forEach(r=>{ r['_tDate']=tParseDate(r['Planned']); });

    // ── DB Sync: agar DB mein ongoing/upload NULL hai toh localStorage bhi clear karo ──
    tSyncLocalStorageWithDB(tAllData);

    tProcessData();
    window._tasksEverLoaded = true;
    tInitUploadsButton(); // Show 📂 Uploaded Files button for owner/MIS/Saajan
    document.getElementById('tasksLoad').style.display='none';
    const _tc = document.getElementById('tasksCont');
    _tc.style.display='block';
    _tc.style.opacity='1';
    _tc.style.pointerEvents='';
    document.getElementById('tasksSync').textContent='Updated '+new Date().toLocaleTimeString();

  }catch(e){
    document.getElementById('tasksLoad').style.display='none';
    const _tcErr = document.getElementById('tasksCont');
    _tcErr.style.display='block';
    _tcErr.style.opacity='1';
    _tcErr.style.pointerEvents='';
    document.getElementById('tTblBody').innerHTML=`<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--hot)">❌ ${e.message}</td></tr>`;
  }
}



async function refreshTasks(){
  const btn=document.getElementById('tasksRefBtn');
  btn.classList.add('spinning');
  Object.values(tCharts).forEach(c=>c&&c.destroy&&c.destroy()); tCharts={};
  tActiveKpi=null; tActivePerson=null; tActiveDept=null; tActiveStatus=null;
  _tasksCache=null;
  tLoaded=true;
  // Refresh = aaj ke tasks dikhao (dono ke liye — employee aur admin)
  const _ts = new Date().toISOString().slice(0,10);
  await loadTasks(_ts, _ts);
  btn.classList.remove('spinning');
}

function tProcessData(){
  // 1. Restore locally-saved done states
  tApplyDoneTasks();

  // 2. Date filter is already set by loadTasks()

  // 3. Populate dropdowns
  tPopulateFilters();

  // 4. Yield BEFORE every heavy render step to keep browser responsive
  //    Each setTimeout(0) gives browser a chance to breathe between steps
  setTimeout(function(){
    tRenderKPIs();
    setTimeout(function(){
      tRenderCharts();
      setTimeout(function(){
        tFiltered = tGetFiltered(); tPage=1;
        tRenderTable();
        tUpdateBadge();
        updateHomeTaskBanner();
      }, 0);
    }, 0);
  }, 0);
}

// ══════════════════════════════════════════════════════════════════════
// MANDATORY ATTACHMENT TASKS (Akshay More checklist — Attachment col mein *)
// Agar employee in tasks ke liye attachment upload nahi karta, task
// "Done" nahi banega aur KPI/Charts mein bhi count nahi hoga — chahe wo
// "Mark Done" dabaye ya na dabaye. Spelling DB ke 'task_name' se exact
// match honi chahiye (case/extra-space ignore hoti hai).
// ══════════════════════════════════════════════════════════════════════
const MANDATORY_ATTACHMENT_TASKS = [
  'open tickets less than 24 hours',
  'open tickets more than 24 hours',
  'open tickets more than 48 hours',
  'open tickets more than 96 hours',
  'checkin pending activity',
  'checkout pending activity',
  'training videos creation',
  '1 1 meetings with l1 team',
  '1 1 meetings with l2 team',
  'l1 team utilization',
  'un read emails',
  'missed calls response',
  'un read whatsapp',
  // ↓ Sakshi Tupe / Vinit Singh / Chirag Gupta checklist ke extra * wale tasks
  'escalations',
  'ims status check'
];

function tNormTaskName(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function tTaskRequiresAttachment(taskName){
  const norm = tNormTaskName(taskName);
  if(!norm) return false;
  return MANDATORY_ATTACHMENT_TASKS.indexOf(norm) !== -1;
}

// Attachment exists for this row? — Supabase 'upload' column OR localStorage backup
function tHasAttachment(r){
  if(!r) return false;
  if(r['_upload_url']) return true;
  const tid = String(r['Task ID']||'');
  return tGetUploadCount(tid) > 0;
}

function tIsDone(r){
  const s=String(r['Status']||'').toLowerCase().trim();
  const actual=String(r['Actual']||'').trim();
  const markedDone = s==='done'||s==='yes'||s==='1'||s==='complete'||s==='completed'||actual!=='';
  if(!markedDone) return false;
  // ── Mandatory-attachment check: * wale task ke liye attachment zaroori hai,
  // warna chahe DB mein "actual_timestamp" set ho, hum use Pending hi maanenge ──
  if(tTaskRequiresAttachment(r['Task']) && !tHasAttachment(r)) return false;
  return true;
}

/* ══ HOME TASK ALERT BANNER — shows pending task count on home page ══ */
function updateHomeTaskBanner(){
  const banner = document.getElementById('homeTaskBanner');
  if(!banner) return;

  // Don't show for Managing Director, MIS, or PC roles
  const role = CURRENT_USER && (CURRENT_USER.rawRole||'').toLowerCase();
  if(!CURRENT_USER || CURRENT_USER.role==='owner' || role==='owner' || role==='mis' || role==='pc' || role==='executive assistant' || role==='ea' || role==='admin'){
    banner.style.display='none';
    return;
  }

  // Work with today's tasks — ongoing task sirf expected date (ongoing column) pe dikhega
  const todayStr = new Date().toISOString().slice(0,10);
  const todayAllTasks = tAllData.filter(r => tIsVisibleOnDate(r, todayStr));
  const todayTasks = tGetCountableForDate(todayStr, todayAllTasks);
  const totalToday = todayTasks.length;

  // If no countable tasks today, hide banner
  if(totalToday === 0){
    banner.style.display='none';
    return;
  }

  const doneTasks   = todayTasks.filter(r => tIsDone(r)).length;
  const pending     = totalToday - doneTasks;
  const userName    = (CURRENT_USER.name || CURRENT_USER.email.split('@')[0]).split(' ')[0];
  const now         = new Date();
  const hour        = now.getHours();

  banner.style.display = 'block';

  if(pending === 0){
    // All done — celebrate!
    banner.innerHTML = `
      <div class="htb-wrap htb-done">
        <div class="htb-icon">🏆</div>
        <div class="htb-body">
          <div class="htb-title">Outstanding work, ${userName}! All tasks completed.</div>
          <div class="htb-sub">
            You've finished all <strong>${totalToday} task${totalToday>1?'s':''}</strong> for today.
            Your score is looking great — keep this consistency going every day!
          </div>
          <div class="htb-count-chip">✅ ${doneTasks} / ${totalToday} Done Today</div>
        </div>
        <button class="htb-btn htb-btn-done" onclick="switchDB('tasks')">View Tasks</button>
      </div>`;
  } else {
    // Pending tasks remain
    const isUrgent = hour >= 16; // After 4 PM = urgent
    const greet    = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const urgencyNote = isUrgent
      ? `<div class="htb-urgent">⚠️ Day is ending — please complete your tasks before close of business!</div>`
      : `<span style="color:var(--muted);font-size:0.80rem;">Complete them now for a great performance score!</span>`;

    banner.innerHTML = `
      <div class="htb-wrap htb-pending">
        <div class="htb-icon">${isUrgent ? '⚠️' : '📋'}</div>
        <div class="htb-body">
          <div class="htb-title">
            ${greet}, ${userName}! You have <span class="htb-count">${pending}</span>
            pending task${pending>1?'s':''} today.
          </div>
          <div class="htb-sub">
            <strong>${doneTasks} of ${totalToday}</strong> task${totalToday>1?'s':''} completed so far.
            ${isUrgent ? '' : 'Head to your Task Checklist and mark them done to boost your score.'}
          </div>
          ${urgencyNote}
        </div>
        <button class="htb-btn htb-btn-go" onclick="switchDB('tasks')">Go to Tasks →</button>
      </div>`;
  }
}

function tGetFiltered(){
  return tAllData.filter(r=>{
    if(tActivePerson&&r['Name']!==tActivePerson) return false;
    if(tActiveDept&&r['Department']!==tActiveDept) return false;
    if(tActiveLocation&&(r['_location']||'')!==tActiveLocation) return false;
    if(tActiveStatus==='done'&&!tIsDone(r)) return false;
    if(tActiveStatus==='pending'&&(tIsDone(r)||tIsOngoing(r))) return false;
    if(tActiveStatus==='ongoing'&&(!tIsOngoing(r)||tIsDone(r))) return false;
    if(tActiveFreq&&String(r['Freq']||'').trim()!==tActiveFreq) return false;
    // ── Date filter — ongoing: sirf expected date pe dikhao; done: actual date pe ──
    if(tActiveDateFrom || tActiveDateTo){
      const df = tActiveDateFrom || '0000-01-01';
      const dt = tActiveDateTo   || '9999-12-31';
      if(tIsOngoing(r)){
        // Ongoing task: original planned date se HAAT ke expected date (ongoing column) pe aao
        const exp = r['_expected_date'] || r['_tDate'] || '';
        if(exp < df || exp > dt) return false;
      } else if(tIsDone(r)){
        // Done task: sirf apni planned_date pe dikhao
        // actual_date se match karne se task doosre din bhi dikh raha tha — FIX
        if((r['_tDate']||'') < df || (r['_tDate']||'') > dt) return false;
      } else {
        if((r['_tDate']||'') < df || (r['_tDate']||'') > dt) return false;
      }
    }
    const q=(document.getElementById('tSearch').value||'').toLowerCase();
    if(q&&!((r['Name']||'').toLowerCase().includes(q)||(r['Task']||'').toLowerCase().includes(q)||(r['Department']||'').toLowerCase().includes(q))) return false;
    return true;
  });
}

function tRenderKPIs(){
  // Use date-filtered data so KPIs match what the table shows
  const baseData = tGetDateFiltered();
  // ── Ongoing tasks are excluded; done ongoing tasks count on completion date ──
  const ongoingTasks = baseData.filter(r=>tIsOngoing(r));
  const ongoingCount = ongoingTasks.length;

  // If single day view, use tGetCountableForDate for accurate score
  // (ongoing task done today = +1 on today's count)
  let countableData;
  if(tActiveDateFrom && tActiveDateFrom === tActiveDateTo){
    countableData = tGetCountableForDate(tActiveDateFrom, baseData);
  } else {
    countableData = baseData.filter(r=>!tIsOngoing(r));
  }

  const total=countableData.length;
  const done=countableData.filter(r=>tIsDone(r)).length;
  const pending=total-done;
  const pct=total?Math.round((done/total)*100):0;

  // Unique employees (from date-filtered data)
  const uniqueEmp=[...new Set(baseData.map(r=>r['Name']).filter(Boolean))].length;

  // Score = (completed / countable_total * 100) - 100  → range: -100 to 0
  const score = total ? Math.round((done/total)*100) - 100 : -100;
  const scoreColor = score >= -10 ? '#00d4aa' : score >= -30 ? '#34d399' : score >= -50 ? '#4e9af1' : score >= -75 ? '#f0a500' : '#ff5c7c';

  const kpis=[
    {id:'all',      label:'Total Tasks',      value:total,       color:'#a855f7', sub:ongoingCount?ongoingCount+' ongoing excluded':'All records', clickable:true},
    {id:'done',     label:'Completed',        value:done,        color:'#00d4aa', sub:pct+'% completion',      clickable:true},
    {id:'pending',  label:'Pending',          value:pending,     color:'#f0a500', sub:(100-pct)+'% remaining', clickable:true},
    {id:'ongoing',  label:'🔄 Ongoing',       value:ongoingCount,color:'#00d4ff', sub:'Click to view all',     clickable:true},
    {id:'emp',      label:'Total Employees',  value:uniqueEmp,   color:'#f472b6', sub:'Active members',        clickable:true},
    {id:'score',    label:'Score',            value:score+'%',   color:scoreColor, sub:ongoingCount?'Ongoing excluded':'Overall Rate', clickable:true},
  ];

  // Set grid to 5 columns — handled via CSS #tKpiGrid rule
  const grid=document.getElementById('tKpiGrid');

  grid.innerHTML=kpis.map(k=>{
    const isActive=tActiveKpi===k.id;
    return `<div class="kpi-card ${isActive?'kpi-active':''}"
      style="--card-accent:${k.color};cursor:pointer;transition:all 0.2s"
      onclick="tKpiClick('${k.id}')">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
      <span class="kpi-badge" style="background:${k.color}22;color:${k.color}">${isActive?'✕ Clear':'↗ Filter'}</span>
    </div>`;
  }).join('');
}

function tKpiClick(id){
  if(tActiveKpi===id){tActiveKpi=null; tActiveStatus=null;}
  else{
    tActiveKpi=id;
    if(id==='done')    tActiveStatus='done';
    else if(id==='pending')  tActiveStatus='pending';
    else if(id==='ongoing')  tActiveStatus='ongoing';  // 🔄 Ongoing KPI click
    else tActiveStatus=null; // 'all', 'emp', 'score' → no status filter
  }
  tFiltered=tGetFiltered(); tPage=1;
  tRenderKPIs();
  tRenderCharts();
  tRenderTable();
  tUpdateBadge();
}

function tRenderCharts(){
  Object.values(tCharts).forEach(c=>c&&c.destroy&&c.destroy()); tCharts={};
  const {tc,gc,noGrid}=chartColors();
  // Use date-filtered data as base; apply kpi/status filter on top if active
  const chartData=(tFiltered&&tFiltered.length&&(tActiveKpi||tActivePerson||tActiveDept||tActiveStatus||tActiveFreq||tActiveLocation))?tFiltered:tGetDateFiltered();

  // 1. Status donut - clickable
  const doneCount=chartData.filter(r=>tIsDone(r)).length;
  const pendCount=chartData.length-doneCount;
  tCharts.status=new Chart(document.getElementById('tChStatus'),{
    type:'doughnut',
    data:{labels:['Completed','Pending'],datasets:[{
      data:[doneCount,pendCount],
      backgroundColor:tActiveStatus?
        (tActiveStatus==='done'?['#00d4aa',(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)')]:[(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)'),'#f0a500']):
        ['#00d4aa','#f0a500'],
      borderWidth:0,hoverOffset:8
    }]},
    options:{
      cutout:'62%',responsive:true,maintainAspectRatio:false,
      onClick:(_,els)=>{if(els.length){const lbl=['done','pending'][els[0].index];tChartFilter('status',lbl);}},
      onHover:(e,els)=>{e.native.target.style.cursor=els.length?'pointer':'default';},
      plugins:{legend:{labels:{color:tc,padding:14,font:{size:11}}}}
    }
  });

  // 2. Person bar - clickable
  // FIX: Use reduce to count in O(n) instead of filter-per-person O(n²)
  const personCountMap = chartData.reduce((acc,r)=>{ const n=r['Name']||''; acc[n]=(acc[n]||0)+1; return acc; },{});
  const persons = Object.keys(personCountMap).sort();
  const personCounts = persons.map(p=>personCountMap[p]);
  tCharts.person=new Chart(document.getElementById('tChPerson'),{
    type:'bar',
    data:{labels:persons,datasets:[{
      data:personCounts,
      backgroundColor:persons.map(p=>tActivePerson?
        (tActivePerson===p?'#00d4ff':(document.body.classList.contains('light-mode')?'rgba(0,212,255,0.12)':'rgba(0,212,255,0.15)')):
        '#00d4ff'),
      borderRadius:6,borderSkipped:false
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      onClick:(_,els)=>{if(els.length)tChartFilter('person',persons[els[0].index]);},
      onHover:(e,els)=>{e.native.target.style.cursor=els.length?'pointer':'default';},
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:tc,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:tc},grid:{display:!noGrid,color:gc},beginAtZero:true}
      }
    }
  });

  // 3. Dept bar - clickable
  // FIX: Use reduce to count in O(n) instead of filter-per-dept O(n²)
  const deptCountMap = chartData.reduce((acc,r)=>{ const d=r['Department']||''; if(d){acc[d]=(acc[d]||0)+1;} return acc; },{});
  const depts = Object.keys(deptCountMap).sort();
  const deptCounts = depts.map(d=>deptCountMap[d]);
  const DCOLS=['#a855f7','#f0a500','#00d4aa','#00d4ff','#ff5c7c','#f472b6','#34d399'];
  tCharts.dept=new Chart(document.getElementById('tChDept'),{
    type:'bar',
    data:{labels:depts,datasets:[{
      data:deptCounts,
      backgroundColor:depts.map((d,i)=>tActiveDept?
        (tActiveDept===d?DCOLS[i%DCOLS.length]:(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)')):
        DCOLS[i%DCOLS.length]),
      borderRadius:6,borderSkipped:false
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      onClick:(_,els)=>{if(els.length)tChartFilter('dept',depts[els[0].index]);},
      onHover:(e,els)=>{e.native.target.style.cursor=els.length?'pointer':'default';},
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:tc,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:tc},grid:{display:!noGrid,color:gc},beginAtZero:true}
      }
    }
  });

  // 4. Leaderboard — FIX: single-pass reduce instead of filter-per-person O(n²)
  const _statsMap = chartData.reduce((acc,r)=>{
    const n=r['Name']||''; if(!n) return acc;
    if(!acc[n]) acc[n]={name:n,dept:r['Department']||'',total:0,done:0,pending:0};
    acc[n].total++;
    if(tIsDone(r)) acc[n].done++; else acc[n].pending++;
    return acc;
  },{});
  const allStats = Object.values(_statsMap).map(p=>({
    ...p,score:+(p.done-p.pending*0.5).toFixed(1),
    pct:p.total?Math.round((p.done/p.total)*100):0
  })).sort((a,b)=>b.done-a.done);

  const medals=['🥇','🥈','🥉'];
  document.getElementById('tLeaderboard').innerHTML=`
    <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
      <thead><tr style="color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px;text-align:left">#</th>
        <th style="padding:6px 8px;text-align:left">NAME</th>
        <th style="padding:6px 8px;text-align:left">DEPARTMENT</th>
        <th style="padding:6px 8px;text-align:center">TOTAL</th>
        <th style="padding:6px 8px;text-align:center;color:#00d4aa">DONE</th>
        <th style="padding:6px 8px;text-align:center;color:#f0a500">PENDING</th>
      </tr></thead>
      <tbody>
        ${allStats.map((p,i)=>`
        <tr style="border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s" 
          onclick="tChartFilter('person','${p.name}')"
          onmouseover="this.style.background='var(--surface2)'" 
          onmouseout="this.style.background='transparent'">
          <td style="padding:7px 8px;font-size:1rem">${medals[i]||i+1}</td>
          <td style="padding:7px 8px;font-weight:600;color:${tActivePerson===p.name?'#a855f7':'var(--text)'}">${p.name}</td>
          <td style="padding:7px 8px"><span style="font-size:0.80rem;background:rgba(168,85,247,0.1);color:#a855f7;padding:2px 7px;border-radius:5px">${p.dept||'—'}</span></td>
          <td style="padding:7px 8px;text-align:center">${p.total}</td>
          <td style="padding:7px 8px;text-align:center;color:#00d4aa;font-weight:600">${p.done}</td>
          <td style="padding:7px 8px;text-align:center;color:#f0a500;font-weight:600">${p.pending}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function tChartFilter(type, val){
  if(type==='person'){
    tActivePerson=(tActivePerson===val)?null:val;
    document.getElementById('tFPerson').value=tActivePerson||'';
  } else if(type==='dept'){
    tActiveDept=(tActiveDept===val)?null:val;
    document.getElementById('tFDept').value=tActiveDept||'';
  } else if(type==='status'){
    tActiveStatus=(tActiveStatus===val)?null:val;
    if(tActiveStatus) tActiveKpi=tActiveStatus;
    else tActiveKpi=null;
    document.getElementById('tFStatus').value=tActiveStatus||'';
  }
  tFiltered=tGetFiltered(); tPage=1;
  tRenderKPIs();
  tRenderCharts();
  tRenderTable();
  tUpdateBadge();
}

function tUpdateBadge(){
  const badge=document.getElementById('tCFBadge');
  const parts=[];
  if(tActiveDateFrom||tActiveDateTo){
    const f=tActiveDateFrom||'…', t=tActiveDateTo||'…';
    parts.push(`<strong style="color:#06b6d4">📅 ${f} → ${t}</strong>`);
  }
  if(tActivePerson) parts.push(`<strong style="color:#00d4ff">👤 ${tActivePerson}</strong>`);
  if(tActiveDept) parts.push(`<strong style="color:#a855f7">🏢 ${tActiveDept}</strong>`);
  if(tActiveLocation) parts.push(`<strong style="color:#06b6d4">📍 ${tActiveLocation}</strong>`);
  if(tActiveFreq) parts.push(`<strong style="color:#34d399">🔄 ${tActiveFreq}</strong>`);
  if(tActiveStatus) parts.push(`<strong style="color:#f0a500">${tActiveStatus==='done'?'✅ Completed':tActiveStatus==='ongoing'?'🔄 Ongoing':'⏳ Pending'}</strong>`);
  if(parts.length){
    badge.style.display='flex';
    badge.innerHTML='🎯 Filter: '+parts.join(' + ')+'';
  } else {
    badge.style.display='none';
  }
}

function tPopulateFilters(){
  // _tDate already parsed in loadTasks — no need to re-parse here
  const depts=[...new Set(tAllData.map(r=>r['Department']).filter(Boolean))].sort();
  const persons=[...new Set(tAllData.map(r=>r['Name']).filter(Boolean))].sort();
  const freqs=[...new Set(tAllData.map(r=>String(r['Freq']||'').trim()).filter(Boolean))].sort();
  document.getElementById('tFDept').innerHTML='<option value="">All Departments</option>'+depts.map(d=>`<option value="${d}">${d}</option>`).join('');
  document.getElementById('tFPerson').innerHTML='<option value="">All People</option>'+persons.map(p=>`<option value="${p}">${p}</option>`).join('');
  document.getElementById('tFFreq').innerHTML='<option value="">All Frequency</option>'+freqs.map(f=>`<option value="${f}">${f}</option>`).join('');
  // Show location filter only for Managing Director/mis/pc
  const locEl=document.getElementById('tFLocation');
  if(locEl && CURRENT_USER && CURRENT_USER.role==='owner'){
    locEl.style.display='';
  } else if(locEl){
    locEl.style.display='none';
  }
  // ── Date filter visibility: sirf Managing Director/MIS/PC ko hi date change karne ka option mile.
  // Baaki employees ke liye From/To inputs aur unke labels hide ho jaate hain — but
  // background mein "today" ka filter pehle se applied hai (tInit mein set hota hai),
  // toh unhe by-default aaj ke tasks dikhte rahenge.
  const _isPrivilegedDate = CURRENT_USER && (
    CURRENT_USER.role === 'owner' ||
    CURRENT_USER.rawRole === 'owner' ||
    CURRENT_USER.rawRole === 'mis' ||
    CURRENT_USER.rawRole === 'pc' ||
    CURRENT_USER.rawRole === 'executive assistant' ||
    CURRENT_USER.rawRole === 'ea'
  );
  document.querySelectorAll('.tDateFilterEl').forEach(el=>{
    el.style.display = _isPrivilegedDate ? '' : 'none';
  });
}

function tApply(){
  const dept=document.getElementById('tFDept').value;
  const person=document.getElementById('tFPerson').value;
  const status=document.getElementById('tFStatus').value;
  const freq=document.getElementById('tFFreq').value;
  const dateFrom=document.getElementById('tFDateFrom').value;
  const dateTo=document.getElementById('tFDateTo').value;
  const locEl=document.getElementById('tFLocation');
  const loc=locEl?locEl.value:'';

  // Date change hone pe DONO ke liye server se re-fetch karo — debounced (no jerk)
  if(dateFrom !== tActiveDateFrom || dateTo !== tActiveDateTo){
    clearTimeout(window._tDateFilterTimer);
    window._tDateFilterTimer = setTimeout(()=>{
      loadTasks(dateFrom || undefined, dateTo || undefined);
    }, 400);
    return;
  }

  tActiveDept=dept||null;
  tActivePerson=person||null;
  tActiveStatus=status||null;
  tActiveFreq=freq||null;
  tActiveDateFrom=dateFrom||null;
  tActiveDateTo=dateTo||null;
  tActiveLocation=loc||null;
  if(!status) tActiveKpi=null;
  tFiltered=tGetFiltered(); tPage=1;
  tRenderKPIs();
  tRenderCharts();
  tRenderTable();
  tUpdateBadge();
}





function fmtDate(val){
  if(!val||val==='—'||val==='') return '—';
  const s=String(val).trim();
  // Already formatted DD/MM/YYYY
  if(/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s;
  // Pure date: YYYY-MM-DD → DD/MM/YYYY (no timezone, no time)
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  // ISO datetime with T: show only date part (ignore time/timezone)
  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if(isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  // Fallback: try Date parse but only show date
  try{
    const d=new Date(s);
    if(isNaN(d.getTime())) return s;
    const day=String(d.getDate()).padStart(2,'0');
    const mon=String(d.getMonth()+1).padStart(2,'0');
    const yr=d.getFullYear();
    return `${day}/${mon}/${yr}`;
  }catch(e){return s;}
}

// ── Task Checklist Actual column — UTC → IST (Mumbai +5:30) display ──
function fmtDateTime(val){
  if(!val||val==='—'||val==='') return '—';
  try{
    let s = String(val).trim();
    if(!s) return '—';
    // Supabase plain timestamp column 'Z' ya '+00:00' nahi deta
    // Browser bina timezone ke string ko LOCAL time maanta hai (IST)
    // Isliye 'Z' append karo — force UTC parsing
    if(!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    if(isNaN(d.getTime())) return String(val);
    // UTC + 5:30 = IST
    const istMs = d.getTime() + (330 * 60 * 1000);
    const ist   = new Date(istMs);
    const dd    = String(ist.getUTCDate()).padStart(2,'0');
    const mon   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()];
    const yr    = ist.getUTCFullYear();
    const hh    = String(ist.getUTCHours()).padStart(2,'0');
    const mn    = String(ist.getUTCMinutes()).padStart(2,'0');
    return `${dd} ${mon} ${yr}, ${hh}:${mn}`;
  }catch(e){ return String(val); }
}

function tRenderTable(){
  const start=(tPage-1)*T_PER_PAGE;
  const pg=tFiltered.slice(start,start+T_PER_PAGE);
  document.getElementById('tTblCnt').textContent=tFiltered.length+' tasks';
  // Supabase version: Google Form URLs removed — inline remarks input se direct DB update
  const buildPrefillUrl = function(r){ return null; };
  document.getElementById('tTblBody').innerHTML=pg.map((r,i)=>{
    const done=tIsDone(r);
    const isOngoing=!done&&tIsOngoing(r);
    const ongoingData=tGetOngoingData(r['Task ID']);
    const isSupport=(r['Department']||'').toLowerCase()==='support'||r['_source']==='support';
    // ── FIX (Goa): isSales check sirf HO Sales sheet ke liye chale, branch (goa/gujarat/bangalore)
    // ke Sales-dept rows ke liye nahi. Branch employees pre-filled Google Form direct kholenge,
    // jaisa support/HO main mein hota hai. Pehle Department='Sales' Goa sheet mein hone se
    // remarks-popup khul jata tha — wo galat behaviour tha.
    const _src=String(r['_source']||'').toLowerCase();
    const isBranch=_src==='goa'||_src==='gujarat'||_src==='bangalore';
    const isSales=!isBranch && _src==='sales';
    const statusBadge=done
      ?'<span class="badge" style="background:rgba(0,212,170,0.12);color:#00d4aa;border:1px solid rgba(0,212,170,0.25)">✅ Done</span>'
      :isOngoing
      ?'<span class="badge" style="background:rgba(0,212,255,0.12);color:#00d4ff;border:1px solid rgba(0,212,255,0.25)">🔄 Ongoing</span>'
      :'<span class="badge" style="background:rgba(240,165,0,0.1);color:#f0a500;border:1px solid rgba(240,165,0,0.2)">⏳ Pending</span>';
    const _undoBtn = (done && _canUndoTask())
      ? `<button onclick="tUndoTask('${r['Task ID']||''}')"
           title="Undo — Set task back to Pending"
           style="margin-top:4px;width:100%;background:rgba(255,92,124,0.10);border:1.5px solid rgba(255,92,124,0.35);color:#ff5c7c;border-radius:7px;padding:4px 6px;font-size:0.72rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:3px;white-space:nowrap;transition:all 0.18s;"
           onmouseover="this.style.background='rgba(255,92,124,0.22)'" onmouseout="this.style.background='rgba(255,92,124,0.10)'">
           ↩️ Undo
         </button>`
      : '';
    // ── Mandatory attachment check — agar * wala task hai aur abhi file upload nahi hui ──
    const _needsAttach   = tTaskRequiresAttachment(r['Task']);
    const _attachMissing = _needsAttach && !tHasAttachment(r);
    const actionCell=done
      ?`<div style="display:flex;flex-direction:column;align-items:flex-start;">
          <span style="color:#00d4aa;font-size:0.84rem;font-weight:700;display:flex;align-items:center;gap:4px;">✅ Done</span>
          ${_undoBtn}
        </div>`
      :_attachMissing
      ?`<button data-dept-tid="${r['Task ID']||''}" onclick="tBlockedMarkDone('${r['Task ID']||''}')"
            title="First Upload📎the document"
            style="background:rgba(255,92,124,0.10);color:#ff5c7c;border:1.5px dashed rgba(255,92,124,0.5);border-radius:8px;padding:6px 8px;font-size:0.76rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:100%;transition:all 0.18s;">
            📎 Upload Required
          </button>`
      :`<button data-dept-tid="${r['Task ID']||''}" onclick="deptShowRemarksInput('${r['Task ID']||''}','${_src}')"
            style="background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border-radius:8px;padding:6px 8px;font-size:0.78rem;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:100%;box-shadow:0 2px 6px rgba(168,85,247,0.3);transition:all 0.18s;">
            ✅ Mark Done
          </button>`;
    const remarks = r['Remarks']||'';
    const remarkCell = remarks
      ? `<span style="font-size:0.82rem;color:var(--text);background:var(--surface2);padding:3px 7px;border-radius:5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${remarks.replace(/"/g,'')}">${remarks}</span>`
      : `<span style="color:var(--muted);font-size:0.82rem">—</span>`;
    const deptColor = (r['Department']||'').toLowerCase()==='support' ? '#00d4ff' : (r['Department']||'').toLowerCase()==='sales' ? '#00d4aa' : '#a855f7';
    const deptBg = (r['Department']||'').toLowerCase()==='support' ? 'rgba(0,212,255,0.1)' : (r['Department']||'').toLowerCase()==='sales' ? 'rgba(0,212,170,0.1)' : 'rgba(168,85,247,0.1)';
    const ongoingCell = done
      ? `<span style="color:#00d4aa;font-size:0.82rem;font-weight:600">✅ Done</span>`
      : isOngoing
      ? `<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">
           <span style="color:#00d4ff;font-size:0.80rem;font-weight:700">🔄 Ongoing</span>
           ${ongoingData&&ongoingData.expectedDate?`<span style="color:var(--muted);font-size:0.71rem;font-weight:500">📅 ${ongoingData.expectedDate}</span>`:''}
         </div>`
      : `<button id="ong_${r['Task ID']||''}" onclick="tShowOngoing('${r['Task ID']||''}','${_src}')"
           style="background:rgba(0,212,255,0.08);border:1.5px solid rgba(0,212,255,0.3);color:#00d4ff;border-radius:8px;padding:6px 8px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;width:100%;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.18s;">
           🔄 Ongoing
         </button>`;
    const hasUpload = !!(r['_upload_url'] || tGetUploadCount(r['Task ID']||'') > 0);
    const uploadUrl  = r['_upload_url'] || (() => { try{ const s=JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}'); const f=(s[String(r['Task ID']||'')]||[])[0]; return f?f.url:null; }catch(e){return null;} })();
    const uploadCell = `
      <div style="display:flex;align-items:center;justify-content:center;">
        ${hasUpload && uploadUrl
          ? `<a href="${uploadUrl}" target="_blank" rel="noopener" title="See Your Uploaded file"
               style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;
                      background:rgba(0,212,170,0.12);border:1.5px solid rgba(0,212,170,0.4);
                      border-radius:8px;text-decoration:none;font-size:1rem;cursor:pointer;transition:all 0.18s;"
               onmouseover="this.style.background='rgba(0,212,170,0.25)'"
               onmouseout="this.style.background='rgba(0,212,170,0.12)'">📄</a>`
          : `<button id="tfu_btn_${r['Task ID']||''}" title="${_attachMissing?'Mandatory — File/PDF':'Upload file'}"
               onclick="tOpenTaskUpload('${r['Task ID']||''}','${(r['Task']||'').replace(/'/g,"\\'")}')"
               style="position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;
                      background:${_attachMissing?'rgba(255,92,124,0.10)':'rgba(168,85,247,0.08)'};border:1.5px solid ${_attachMissing?'rgba(255,92,124,0.5)':'rgba(168,85,247,0.3)'};
                      border-radius:8px;font-size:1rem;cursor:pointer;transition:all 0.18s;color:${_attachMissing?'#ff5c7c':'#a855f7'};"
               onmouseover="this.style.background='${_attachMissing?'rgba(255,92,124,0.22)':'rgba(168,85,247,0.22)'}'"
               onmouseout="this.style.background='${_attachMissing?'rgba(255,92,124,0.10)':'rgba(168,85,247,0.08)'}'">📎${_needsAttach?'<span style="position:absolute;top:-2px;right:-2px;color:#ff5c7c;font-weight:900;font-size:0.95rem;">*</span>':''}</button>`
        }
      </div>`;
    return `<tr>
      <td style="padding:0;width:30px;text-align:center;"><input type="checkbox" class="t-row-cb" data-id="${r['_id']}" onchange="tOnCheckChange()" style="width:13px;height:13px;cursor:pointer;margin:0;"></td>
      <td style="padding:8px 4px;"><div style="font-weight:600;font-size:0.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r['Name']||'')}">${r['Name']||'—'}</div></td>
      <td style="padding:8px 8px;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r['Task']||'').replace(/"/g,'')}${_needsAttach?' (Attachment Mandatory)':''}">${r['Task']||'—'}${_needsAttach?'<span title="Attachment Mandatory" style="color:#ff5c7c;font-weight:900;margin-left:3px;">*</span>':''}</td>
      <td style="padding:9px 6px;font-size:0.82rem;color:${isOngoing?'#00d4ff':'var(--muted)'}">
        ${isOngoing && r['_expected_date']
          ? `<div style="display:flex;flex-direction:column;gap:1px;">
               <span style="font-weight:700;">${fmtDate(r['_expected_date'])}</span>
               <span style="font-size:0.70rem;color:var(--muted);">from ${fmtDate(r['Planned'])}</span>
             </div>`
          : fmtDate(r['Planned'])
        }
      </td>
      <td style="padding:9px 6px;font-size:0.82rem;color:${r['Actual']?'#00d4aa':'var(--muted)'}">${fmtDateTime(r['Actual'])}</td>
      <td style="padding:9px 6px;">${remarkCell}</td>
      <td style="padding:7px 5px;" id="act_${r['Task ID']||''}">${actionCell}</td>
      <td style="padding:7px 5px;" id="ong_td_${r['Task ID']||''}">${ongoingCell}</td>
      <td style="padding:8px 4px;text-align:center;">${uploadCell}</td>
    </tr>`;
  }).join('');

  const tp=Math.ceil((tFiltered.length||1)/T_PER_PAGE);
  let h=`<span class="page-info">Page ${tPage} of ${tp}</span>`;
  h+=`<button class="page-btn" onclick="tGoPage(${tPage-1})" ${tPage===1?'disabled':''}>‹</button>`;
  for(let p=1;p<=Math.min(tp,7);p++) h+=`<button class="page-btn ${p===tPage?'active':''}" onclick="tGoPage(${p})">${p}</button>`;
  h+=`<button class="page-btn" onclick="tGoPage(${tPage+1})" ${tPage===tp?'disabled':''}>›</button>`;
  document.getElementById('tPagBar').innerHTML=h;
}

// ── Task Delete Functions ──────────────────────────────────────
let _tSelectedIds = new Set();

function tOnCheckChange(){
  _tSelectedIds = new Set();
  document.querySelectorAll('.t-row-cb:checked').forEach(cb => {
    _tSelectedIds.add(Number(cb.dataset.id));
  });
  const btn = document.getElementById('tDeleteBtn');
  const cnt = document.getElementById('tDelCount');
  const all = document.getElementById('tSelectAll');
  if(btn) btn.style.display = _tSelectedIds.size > 0 ? 'inline-flex' : 'none';
  if(cnt) cnt.textContent = _tSelectedIds.size;
  const total = document.querySelectorAll('.t-row-cb').length;
  if(all) all.indeterminate = _tSelectedIds.size > 0 && _tSelectedIds.size < total;
  if(all) all.checked = _tSelectedIds.size === total && total > 0;
}

function tToggleSelectAll(checked){
  _tSelectedIds = new Set();
  document.querySelectorAll('.t-row-cb').forEach(cb => {
    cb.checked = checked;
    if(checked) _tSelectedIds.add(Number(cb.dataset.id));
  });
  const btn = document.getElementById('tDeleteBtn');
  const cnt = document.getElementById('tDelCount');
  if(btn) btn.style.display = _tSelectedIds.size > 0 ? 'inline-flex' : 'none';
  if(cnt) cnt.textContent = _tSelectedIds.size;
}

async function tDeleteSelected(){
  if(PERMISSIONS.can_delete_tasks !== 'true'){
    alert('❌ You do not have permission to delete tasks.');
    return;
  }
  if(_tSelectedIds.size === 0) return;
  const confirmed = confirm(`⚠️ Are you sure you want to delete ${_tSelectedIds.size} task(s)? This cannot be undone.`);
  if(!confirmed) return;

  const ids = [..._tSelectedIds];
  let deleted = 0;
  let failed  = 0;

 try {
    const idList = ids.join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?id=in.(${idList})`,
      { method: 'DELETE', headers: SB_HDRS() }
    );
    if(res.ok) deleted = ids.length;
    else failed = ids.length;
  } catch(e){
    failed = ids.length;
  }

  _tSelectedIds = new Set();
  const btn = document.getElementById('tDeleteBtn');
  const all = document.getElementById('tSelectAll');
  if(btn) btn.style.display = 'none';
  if(all) all.checked = false;

  await tFetchTasks();

  if(failed > 0) alert(`✅ ${deleted} deleted, ❌ ${failed} failed.`);
}  

function tGoPage(p){
  const tp=Math.ceil((tFiltered.length||1)/T_PER_PAGE);
  if(p<1||p>tp) return;
  tPage=p; tRenderTable();
  document.querySelector('#panel-tasks .table-card').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── Mark Done — Local update only ─
// ── LocalStorage persistence for done tasks ──────────────────────────
function tSaveDoneTask(taskId, actualTime){
  try{
    const key='aditiDoneTasks';
    const saved=JSON.parse(localStorage.getItem(key)||'{}');
    // Store actual time + savedAt timestamp so tApplyDoneTasks can check age
    saved[String(taskId)]={actual:actualTime, savedAt:Date.now()};
    localStorage.setItem(key,JSON.stringify(saved));
  }catch(e){}
}

function tApplyDoneTasks(){
  // Locally-saved done states sirf click ke turant baad visual feedback ke liye.
  // 60s TTL — agar user form submit kare aur sheet se confirm aa jaye, pehle se
  // "Done" dikhta rahega. Agar user submit na kare, 60s baad task wapas Pending.
  // Live sync har ~45s pe chalti hai — sheet = source of truth always.
  try{
    const key='aditiDoneTasks';
    const saved=JSON.parse(localStorage.getItem(key)||'{}');
    if(!Object.keys(saved).length) return;
    const nowMs=Date.now();
    const MAX_AGE_MS=0; // 0 = disabled — sheet is ALWAYS source of truth (row delete = turant Pending)
    const stillNeeded={};
    tAllData.forEach(r=>{
      const tid=String(r['Task ID']);
      const entry=saved[tid];
      if(!entry) return;
      if(tIsDone(r)){
        return; // Sheet already confirmed done — remove from cache
      }
      // Sheet says NOT done. Check how old this local entry is.
      const savedAt = typeof entry === 'object' ? (entry.savedAt||0) : 0;
      const actualTime = typeof entry === 'object' ? (entry.actual||entry) : entry;
      const ageMs = nowMs - savedAt;
      if(savedAt && ageMs <= MAX_AGE_MS){
        // Very recent (within 90s) — sheet might not have updated yet from form
        r['Status']='done';
        r['Actual']=actualTime;
        stillNeeded[tid]=entry;
      }
      // else: too old OR no timestamp → sheet wins → task shows as Pending/Not Done
    });
    localStorage.setItem(key,JSON.stringify(stillNeeded));
  }catch(e){}
}

// ── Date-aware base data for KPI & Charts ────────────────────────────
// ── DB Sync: DB se NULL aane par localStorage bhi clear karo ────────────
function tSyncLocalStorageWithDB(dataArr){
  try{
    const ongoingStore = JSON.parse(localStorage.getItem(ONGOING_KEY)||'{}');
    const uploadStore  = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    let ongoingChanged = false, uploadChanged = false;
    dataArr.forEach(r=>{
      const tid = String(r['Task ID']||'');
      if(!tid) return;
      // DB mein ongoing NULL hai → localStorage se bhi hatao
      if(!r['_expected_date'] && ongoingStore[tid]){
        delete ongoingStore[tid];
        ongoingChanged = true;
      }
      // DB mein upload NULL hai → localStorage se bhi hatao
      if(!r['_upload_url'] && uploadStore[tid]){
        delete uploadStore[tid];
        uploadChanged = true;
      }
    });
    if(ongoingChanged) localStorage.setItem(ONGOING_KEY, JSON.stringify(ongoingStore));
    if(uploadChanged)  localStorage.setItem('aditiTaskUploads', JSON.stringify(uploadStore));
  }catch(e){}
}

// ── Ongoing Task Date Range Check ───────────────────────────────────────
// Ongoing task un tamam dinon mein dikhega jab tak expected date na aa jaye
// r['_tDate'] = planned date (YYYY-MM-DD)
// r['_expected_date'] = expected completion date (YYYY-MM-DD)
function tIsVisibleOnDate(r, dateStr){
  const planned = r['_tDate'];
  if(!planned) return false;

  if(tIsDone(r)){
    // Done task: sirf apni planned_date pe dikhao
    // actual_timestamp se match karne se task doosre din bhi dikh raha tha — FIX
    return planned === dateStr;
  }

  if(tIsOngoing(r)){
    // Ongoing task: sirf expected date pe dikhao (original planned date se HAAT jao)
    const exp = r['_expected_date'];
    if(!exp) return planned === dateStr;
    return exp === dateStr; // exact match only
  }

  // Normal pending: sirf planned date pe
  return planned === dateStr;
}

// ── Ongoing done = us din +1 task count ─────────────────────────────────
// Returns tasks that should be counted on a given date for score calculation
function tGetCountableForDate(dateStr, dataArr){
  return (dataArr||tAllData).filter(r=>{
    if(tIsOngoing(r)) return false; // active ongoing = count nahi
    if(tIsDone(r)){
      // Done tasks: agar actual date = dateStr → count (even if planned != dateStr)
      const actualRaw = String(r['Actual']||'').trim();
      if(actualRaw){
        const actualDate = actualRaw.slice(0,10);
        if(actualDate === dateStr) return true; // completed today
        // Original planned date pe bhi count (agar actual date match nahi)
        return r['_tDate'] === dateStr;
      }
      return r['_tDate'] === dateStr;
    }
    // Pending: sirf planned date pe count
    return r['_tDate'] === dateStr;
  });
}


function tGetDateFiltered(){
  // KPI & Charts base data: date + person + dept + freq + location (NO status/kpi filter)
  return tAllData.filter(r=>{
    if(tActivePerson&&r['Name']!==tActivePerson) return false;
    if(tActiveDept&&r['Department']!==tActiveDept) return false;
    if(tActiveLocation&&(r['_location']||'')!==tActiveLocation) return false;
    if(tActiveFreq&&String(r['Freq']||'').trim()!==tActiveFreq) return false;
    // ── Date filter — ongoing: sirf expected date pe dikhao; done: actual date pe ──
    if(tActiveDateFrom || tActiveDateTo){
      const df = tActiveDateFrom || '0000-01-01';
      const dt = tActiveDateTo   || '9999-12-31';
      if(tIsOngoing(r)){
        // Ongoing task: original planned date se HAAT ke expected date (ongoing column) pe aao
        const exp = r['_expected_date'] || r['_tDate'] || '';
        if(exp < df || exp > dt) return false;
      } else if(tIsDone(r)){
        // Done task: sirf apni planned_date pe dikhao (actual_date se nahi)
        if((r['_tDate']||'') < df || (r['_tDate']||'') > dt) return false;
      } else {
        if((r['_tDate']||'') < df || (r['_tDate']||'') > dt) return false;
      }
    }
    const q=(document.getElementById('tSearch')?document.getElementById('tSearch').value||'':'').toLowerCase();
    if(q&&!((r['Name']||'').toLowerCase().includes(q)||(r['Task']||'').toLowerCase().includes(q)||(r['Department']||'').toLowerCase().includes(q))) return false;
    return true;
  });
}
// ─────────────────────────────────────────────────────────────────────



// ── Mandatory attachment missing — Mark Done block karo, upload ki taraf guide karo ──
function tBlockedMarkDone(taskId){
  const tid = String(taskId);
  showToast && showToast('📎 This task cannot be marked Done without the mandatory attachment! Please upload a file/PDF in the 📎 column first.', 'error', 4000);
  // Highlight the upload button so the employee knows where to click
  const upBtn = document.getElementById('tfu_btn_' + tid);
  if(upBtn){
    upBtn.style.transition = 'box-shadow 0.3s';
    upBtn.style.boxShadow  = '0 0 0 4px rgba(255,92,124,0.35)';
    setTimeout(()=>{ if(upBtn) upBtn.style.boxShadow = ''; }, 1400);
    upBtn.scrollIntoView({behavior:'smooth', block:'center', inline:'center'});
  }
}

// ── All Departments: Inline Remarks Input ───────────────────────────

function deptShowRemarksInput(taskId, src){
  const tid = String(taskId);
  // Find the button's TD — try data-dept-tid attribute first, then onclick match
  let td = null;
  const allBtns = document.querySelectorAll('[data-dept-tid="'+tid+'"]');
  if(allBtns.length) td = allBtns[0].closest('td');
  if(!td){
    const all = document.querySelectorAll('button');
    for(const b of all){
      if((b.getAttribute('onclick')||'').includes("deptShowRemarksInput('"+tid+"'")){
        td = b.closest('td'); break;
      }
    }
  }
  if(!td) return;
  td.style.whiteSpace = 'normal';
  td.style.minWidth   = '0';
  td.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;">
      <input type="text" id="dept_rem_${tid}"
             placeholder="Remarks (optional)..."
             style="padding:5px 7px;border-radius:6px;border:1.5px solid var(--border);
                    background:var(--surface2);color:var(--text);font-size:0.80rem;
                    width:100%;box-sizing:border-box;outline:none;font-family:inherit;"
             onkeydown="if(event.key==='Enter') deptSubmitDone('${tid}','${src}')">
      <div style="display:flex;gap:4px;width:100%;">
        <button onclick="deptSubmitDone('${tid}','${src}')"
                style="flex:1;background:#00d4aa;color:#000;border:none;border-radius:6px;
                       padding:4px 6px;font-size:0.78rem;font-weight:700;cursor:pointer;
                       white-space:nowrap;">✅ Submit</button>
        <button onclick="tRenderTable()"
                style="flex:0 0 auto;background:var(--surface2);color:var(--text2);
                       border:1px solid var(--border);border-radius:6px;
                       padding:4px 8px;font-size:0.78rem;cursor:pointer;">✕</button>
      </div>
    </div>`;
  try{ document.getElementById('dept_rem_'+tid).focus(); }catch(e){}
}

function deptSubmitDone(taskId, src){
  const tid = String(taskId);

  // ── Safety net: mandatory attachment wale task ko bina file ke Done mat hone do ──
  const _row = tAllData.find(r => String(r['Task ID']) === tid);
  if(_row && tTaskRequiresAttachment(_row['Task']) && !tHasAttachment(_row)){
    showToast && showToast('📎 This task cannot be marked Done without the mandatory attachment! Please upload a file/PDF in the 📎 column first.', 'error', 4000);
    tRenderTable();
    return;
  }

  const inp = document.getElementById('dept_rem_'+tid);
  const remarks = (inp ? inp.value : '').trim();

  const now = new Date();
  const day=String(now.getDate()).padStart(2,'0');
  const mon=String(now.getMonth()+1).padStart(2,'0');
  const yr=now.getFullYear();
  const hr=String(now.getHours()).padStart(2,'0');
  const mn=String(now.getMinutes()).padStart(2,'0');
  const sc=String(now.getSeconds()).padStart(2,'0');
  const actualForDisplay = day+'/'+mon+'/'+yr+' '+hr+':'+mn+':'+sc;

  // Turant UI update — sab arrays mein done mark karo
  [tAllData, tFiltered].forEach(arr=>{
    arr.forEach(r=>{
      if(String(r['Task ID'])===tid){
        r['Status']='Done';
        r['Actual']=actualForDisplay;
        r['Remarks']=remarks;
      }
    });
  });
  // Surgical DOM update — sirf is row ke cells update, puri table re-render nahi (no jerk)
  const _actEl = document.getElementById('act_' + tid);
  if(_actEl){
    _actEl.innerHTML = '<span style="color:#00d4aa;font-size:0.85rem;font-weight:700;display:flex;align-items:center;gap:4px;">✅ Done</span>';
    const _row = _actEl.closest('tr');
    if(_row){
      const _acTd = _row.cells[4]; // Actual column (index 4)
      if(_acTd){ _acTd.style.color='#00d4aa'; _acTd.textContent=fmtDateTime(now.toISOString()); }
      const _remTd = _row.cells[5]; // Remarks column (index 5, STATUS hata diya)
      if(_remTd){
        if(remarks){
          _remTd.innerHTML = '<span style="font-size:0.82rem;color:var(--text);background:var(--surface2);padding:3px 7px;border-radius:5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+remarks.replace(/"/g,'')+'">'+ remarks +'</span>';
        } else {
          _remTd.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">—</span>';
        }
      }
      // Ongoing column bhi Done dikhao
      const _ongTd = _row.cells[7]; // Ongoing column (index 7)
      if(_ongTd) _ongTd.innerHTML = '<span style="color:#00d4aa;font-size:0.82rem;font-weight:600">✅ Done</span>';
    }
  }
  setTimeout(()=>{ tRenderKPIs(); updateHomeTaskBanner&&updateHomeTaskBanner(); }, 200);
  tSaveDoneTask(tid, actualForDisplay);

  // ── Supabase REST API se update karo (id se match karke) ──
  const rowId = (tAllData.find(r=>String(r['Task ID'])===tid)||{})['_id'];
  if(rowId){
    fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
      {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({
          actual_timestamp: now.toISOString(),
          remarks: remarks || null
        })
      }
    ).then(res => {
      if(res.ok) setTimeout(()=>{ _tasksLastSync=0; tSilentRefresh(); }, 3000);
    }).catch(()=>{});
  }
}

// ── Undo Access: Sirf MIS aur PC ko allowed ─────────────────────────────
function _canUndoTask(){
  if(typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  const r = String(CURRENT_USER.rawRole || '').toLowerCase().trim();
  return r === 'mis' || r === 'pc' || r === 'executive assistant' || r === 'ea';
}

// ── Undo Done Task — Supabase mein actual_timestamp + remarks NULL karo ──
function tUndoTask(taskId){
  if(!_canUndoTask()){
    showToast && showToast('⛔ Undo access is restricted to MIS and PC only.', 'error', 3000);
    return;
  }
  const tid = String(taskId);
  const row = tAllData.find(r => String(r['Task ID']) === tid);
  if(!row){ return; }

  // ─── Immediate local update ───────────────────────────────────────────
  [tAllData, tFiltered].forEach(arr => {
    arr.forEach(r => {
      if(String(r['Task ID']) === tid){
        r['Status']  = 'Pending';
        r['Actual']  = '';
        r['Remarks'] = '';
      }
    });
  });

  // Clear from localStorage done cache
  try{
    const saved = JSON.parse(localStorage.getItem('aditiDoneTasks') || '{}');
    delete saved[tid];
    localStorage.setItem('aditiDoneTasks', JSON.stringify(saved));
  }catch(e){}

  // ─── DOM: instantly flip row back to pending state ────────────────────
  const actEl = document.getElementById('act_' + tid);
  if(actEl){
    actEl.innerHTML = `<button data-dept-tid="${tid}" onclick="deptShowRemarksInput('${tid}','${String(row['_source']||'').toLowerCase()}')"
      style="background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border-radius:8px;padding:6px 8px;font-size:0.78rem;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:100%;box-shadow:0 2px 6px rgba(168,85,247,0.3);transition:all 0.18s;">
      ✅ Mark Done
    </button>`;
    const tr = actEl.closest('tr');
    if(tr){
      // Actual column
      const acTd = tr.cells[4];
      if(acTd){ acTd.style.color = 'var(--muted)'; acTd.textContent = '—'; }
      // Remarks column
      const remTd = tr.cells[5];
      if(remTd) remTd.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">—</span>';
      // Ongoing column — wapas button
      const ongTd = tr.cells[7];
      if(ongTd) ongTd.innerHTML = `<button id="ong_${tid}" onclick="tShowOngoing('${tid}','${String(row['_source']||'').toLowerCase()}')"
        style="background:rgba(0,212,255,0.08);border:1.5px solid rgba(0,212,255,0.3);color:#00d4ff;border-radius:8px;padding:6px 8px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;width:100%;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.18s;">🔄 Ongoing</button>`;
    }
  }

  // Re-render KPIs + Charts immediately
  tRenderKPIs();
  tRenderCharts();
  updateHomeTaskBanner && updateHomeTaskBanner();

  // ─── Supabase PATCH: actual_timestamp + remarks = NULL ───────────────
  const rowId = row['_id'];
  if(rowId){
    fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
      {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ actual_timestamp: null, remarks: null })
      }
    ).then(res => {
      if(res.ok){
        showToast && showToast('↩️ Task undone & database updated!', 'success', 3000);
        setTimeout(() => { _tasksLastSync = 0; tSilentRefresh(); }, 3000);
      } else {
        showToast && showToast('⚠️ UI updated but DB sync failed. Please refresh.', 'error', 4000);
      }
    }).catch(() => {
      showToast && showToast('⚠️ Network error — DB update failed.', 'error', 4000);
    });
  } else {
    showToast && showToast('↩️ Task locally undone. (No DB row ID found)', 'warning', 3000);
  }
}

// Legacy aliases — purane calls break na ho
function salesShowRemarksInput(taskId){ deptShowRemarksInput(taskId,'sales'); }
function salesSubmitDone(taskId){ deptSubmitDone(taskId,'sales'); }

// ═══════════════════════════════════════════════════════════════════════
// ONGOING STATUS — localStorage mein store karo
// ═══════════════════════════════════════════════════════════════════════

const ONGOING_KEY = 'aditiOngoingTasks';

function tGetOngoingData(taskId){
  // Pehle Supabase data check karo (row mein _expected_date field)
  const row = tAllData.find(r=>String(r['Task ID'])===String(taskId));
  if(row && row['_expected_date']){
    return { expectedDate: row['_expected_display'] || row['_expected_date'] };
  }
  // Fallback: localStorage
  try{
    const saved = JSON.parse(localStorage.getItem(ONGOING_KEY)||'{}');
    return saved[String(taskId)] || null;
  }catch(e){ return null; }
}

function tIsOngoing(r){
  if(tIsDone(r)) return false;
  // Supabase column check
  if(r['_expected_date']) return true;
  // localStorage fallback
  const data = tGetOngoingData(r['Task ID']);
  return !!(data && data.expectedDate);
}

function tGetUploadCount(taskId){
  try{
    const saved = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    const files = saved[String(taskId)];
    return Array.isArray(files) ? files.length : 0;
  }catch(e){ return 0; }
}

function tSaveOngoingTask(taskId, expectedDate){
  try{
    const saved = JSON.parse(localStorage.getItem(ONGOING_KEY)||'{}');
    saved[String(taskId)] = { expectedDate, savedAt: Date.now() };
    localStorage.setItem(ONGOING_KEY, JSON.stringify(saved));
  }catch(e){}
}

function tRemoveOngoingTask(taskId){
  try{
    const saved = JSON.parse(localStorage.getItem(ONGOING_KEY)||'{}');
    delete saved[String(taskId)];
    localStorage.setItem(ONGOING_KEY, JSON.stringify(saved));
  }catch(e){}
}

function tShowOngoing(taskId, src){
  const tid = String(taskId);
  const td = document.getElementById('ong_td_' + tid);
  if(!td) return;
  // Default date: kal
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = tomorrow.toISOString().slice(0,10);
  td.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;min-width:110px;box-sizing:border-box;">
      <label style="font-size:0.68rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Expected Completion Date</label>
      <input type="date" id="ong_date_${tid}" value="${tomorrowStr}" min="${new Date().toISOString().slice(0,10)}"
        style="padding:4px 6px;border-radius:6px;border:1.5px solid rgba(0,212,255,0.4);
               background:var(--surface2);color:var(--text);font-size:0.80rem;
               width:100%;box-sizing:border-box;outline:none;font-family:inherit;">
      <div style="display:flex;gap:4px;">
        <button onclick="tSubmitOngoing('${tid}','${src}')"
          style="flex:1;background:#00d4ff;color:#000;border:none;border-radius:6px;
                 padding:4px 0;font-size:0.76rem;font-weight:700;cursor:pointer;">✓ Set</button>
        <button onclick="tRenderTable()"
          style="flex:0 0 auto;background:var(--surface2);color:var(--text2);
                 border:1px solid var(--border);border-radius:6px;
                 padding:4px 7px;font-size:0.76rem;cursor:pointer;">✕</button>
      </div>
    </div>`;
  try{ document.getElementById('ong_date_'+tid).focus(); }catch(e){}
}

function tSubmitOngoing(taskId, src){
  const tid = String(taskId);
  const inp = document.getElementById('ong_date_'+tid);
  if(!inp || !inp.value){ alert('Please select a date!'); return; }
  const rawDate = inp.value; // YYYY-MM-DD
  const parts = rawDate.split('-');
  const displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY

  tSaveOngoingTask(tid, displayDate);

  // Immediate DOM update — status badge bhi update karo
  const td = document.getElementById('ong_td_'+tid);
  if(td){
    td.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">
        <span style="color:#00d4ff;font-size:0.80rem;font-weight:700">🔄 Ongoing</span>
        <span style="color:var(--muted);font-size:0.71rem;font-weight:500">📅 ${displayDate}</span>
      </div>`;
  }
  const row = td ? td.closest('tr') : null;
  if(row){
    const stTd = row.cells[6]; // ACTION column — ongoing ke baad status reflect karne ki zaroorat nahi (STATUS column hata diya)
    // no-op: STATUS column removed
  }

  // ✅ Supabase mein expected_date column directly update karo
  const rowId = (tAllData.find(r=>String(r['Task ID'])===tid)||{})['_id'];
  if(rowId){
    fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
      { method:'PATCH', headers:SB_HDRS_JSON(), body:JSON.stringify({ ongoing: rawDate }) }
    ).catch(()=>{});
    // Local data update
    [tAllData, tFiltered].forEach(arr=>{
      arr.forEach(r=>{ if(String(r['Task ID'])===tid){ r['_expected_date']=rawDate; r['_expected_display']=displayDate; } });
    });
  }
  setTimeout(()=>{ tRenderKPIs(); updateHomeTaskBanner&&updateHomeTaskBanner(); }, 150);
}

function tCancelOngoing(taskId){
  const tid = String(taskId);
  tRemoveOngoingTask(tid);

  // ✅ Supabase mein expected_date NULL karo
  const rowId = (tAllData.find(r=>String(r['Task ID'])===tid)||{})['_id'];
  if(rowId){
    fetch(
      `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
      { method:'PATCH', headers:SB_HDRS_JSON(), body:JSON.stringify({ ongoing: null }) }
    ).catch(()=>{});
    [tAllData, tFiltered].forEach(arr=>{
      arr.forEach(r=>{ if(String(r['Task ID'])===tid){ r['_expected_date']=null; r['_expected_display']=null; } });
    });
  }
  tFiltered=tGetFiltered(); tRenderKPIs(); tRenderTable();
}

// ── Uploaded Files Viewer — owner / MIS / Saajan Jain access ──────────
function tCanViewUploads(){
  if(!CURRENT_USER) return false;
  const role = String(CURRENT_USER.rawRole||CURRENT_USER.role||'').toLowerCase().trim();
  if(CURRENT_USER.role==='owner' || role==='owner' || role==='mis') return true;
  // Saajan Jain special access
  const name = String(CURRENT_USER.name||'').trim().toLowerCase();
  return name==='saajan jain';
}

function tInitUploadsButton(){
  const btn = document.getElementById('tasksUploadViewBtn');
  if(btn) btn.style.display = tCanViewUploads() ? 'flex' : 'none';
}

// Sab uploaded files gather karo — Supabase data + localStorage
let _allUploadsCache = [];

function tShowAllUploads(){
  if(!tCanViewUploads()) return;
  document.getElementById('taskAllUploadsModal').style.display='flex';
  document.body.style.overflow='hidden';
  document.getElementById('uploadsSearchInput').value='';
  document.getElementById('uploadsNameFilter').value='';
  // Default: aaj ki date dono fields mein
  const todayISO = new Date().toISOString().slice(0,10);
  document.getElementById('uploadsDateFrom').value = todayISO;
  document.getElementById('uploadsDateTo').value   = todayISO;
  _allUploadsCache = [];
  tFetchAndRenderUploads();
}

function tResetUploadsFilter(){
  document.getElementById('uploadsSearchInput').value='';
  document.getElementById('uploadsNameFilter').value='';
  document.getElementById('uploadsDateFrom').value='';
  document.getElementById('uploadsDateTo').value='';
  tFetchAndRenderUploads();
}

function tPopulateUploadsNameFilter(){
  const sel = document.getElementById('uploadsNameFilter');
  if(!sel) return;
  const curVal = sel.value;
  const names = [...new Set(_allUploadsCache.map(f=>f.employee).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All Employees</option>' +
    names.map(n=>`<option value="${n}"${n===curVal?' selected':''} >${n}</option>`).join('');
}

// ── Main fetch: Supabase se date-range ke hisaab se upload wale tasks laao ──
async function tFetchAndRenderUploads(){
  const listEl = document.getElementById('taskAllUploadsList');
  if(!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:0.9rem;">⏳ Loading…</div>';

  const df = document.getElementById('uploadsDateFrom').value || '';
  const dt = document.getElementById('uploadsDateTo').value   || '';

  try {
    // Step 1: Upload wale tasks fetch karo with date filter
    let url = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*&upload=not.is.null`;
    if(df) url += `&planned_date=gte.${df}`;
    if(dt) url += `&planned_date=lte.${dt}`;
    url += `&order=planned_date.desc,id.desc&limit=500`;

    const res  = await fetch(url, { headers: SB_HDRS() });
    const rows = await res.json();
    if(!Array.isArray(rows)) throw new Error('Bad response');

    // Step 2: Employee details cache (emp_id → name, dept)
    // tAllData mein already loaded hai — usse map banao
    const empMap = {};
    tAllData.forEach(r => {
      const eid = String(r['_id']||'');
      // emp_id se bhi map karo
      if(r['Name']) empMap[String(r['emp_id']||r['_emp_id']||'')] = { name: r['Name'], dept: r['Department']||'' };
    });

    // Fallback: employee_details table se bhi try karo if empMap empty
    let edCache = {};
    try {
      const edRes  = await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept&limit=500`, { headers: SB_HDRS() });
      const edRows = await edRes.json();
      if(Array.isArray(edRows)){
        edRows.forEach(e => {
          edCache[String(e.Emp_id||'')] = { name: e.Employee_name||'', dept: e.Employee_Dept||'' };
        });
      }
    } catch(_){}

    _allUploadsCache = rows.map(r => {
      const cloudUrl  = r.upload ? String(r.upload).trim() : null;
      if(!cloudUrl) return null;
      const rawName   = cloudUrl.split('/').pop().replace(/^\d+_/,'').replace(/_/g,' ');
      const pd        = String(r.planned_date||'').slice(0,10);
      let uploadedAt  = '';
      if(pd && pd.length===10){
        const [yy,mm,dd] = pd.split('-');
        uploadedAt = `${dd}/${mm}/${yy} 00:00`;
      }
      // Employee info — edCache se lo
      const empId = String(r.emp_id||'');
      const ed    = edCache[empId] || empMap[empId] || {};
      const employeeName = ed.name || r.employee_name || empId || '—';
      const deptName     = ed.dept || r.department || '—';

      const ext  = rawName.split('.').pop().toLowerCase();
      const icon = ['pdf'].includes(ext) ? '📄'
        : ['png','jpg','jpeg','gif','webp'].includes(ext) ? '🖼️'
        : ['xls','xlsx','csv'].includes(ext) ? '📊'
        : ['doc','docx'].includes(ext) ? '📝' : '📎';
      return {
        taskId:     String(r.id||''),
        task:       String(r.task_name||r.task||'—').trim(),
        employee:   employeeName,
        dept:       deptName,
        fileName:   rawName,
        fileUrl:    cloudUrl,
        uploadedAt: uploadedAt,
        plannedDate: pd,
        icon:       icon,
        fromCloud:  true
      };
    }).filter(Boolean);

    tPopulateUploadsNameFilter();
    tFilterUploadsModal();
  } catch(e) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:#ff3b30;font-size:0.87rem;">❌ Error loading: ${e.message}</div>`;
  }
}

function tFilterUploadsModal(){
  const q    = (document.getElementById('uploadsSearchInput').value||'').toLowerCase();
  const name = (document.getElementById('uploadsNameFilter').value||'').toLowerCase();

  const filtered = _allUploadsCache.filter(f=>{
    if(q && !(f.employee.toLowerCase().includes(q)||f.task.toLowerCase().includes(q)||
              f.dept.toLowerCase().includes(q)||f.fileName.toLowerCase().includes(q))) return false;
    if(name && f.employee.toLowerCase() !== name) return false;
    return true;
  });
  tRenderAllUploads(filtered);
}

function tRenderAllUploads(list){
  const el = document.getElementById('taskAllUploadsList');
  if(!el) return;
  if(!list.length){
    el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:0.9rem;">📭 No uploaded files found</div>';
    return;
  }
  el.innerHTML = list.map((f,i)=>`
    <div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);${i===list.length-1?'border-bottom:none;':''}">
      <!-- Icon -->
      <div style="width:38px;height:38px;border-radius:10px;background:${f.fromCloud?'rgba(0,212,170,0.1)':'rgba(240,165,0,0.1)'};
           border:1.5px solid ${f.fromCloud?'rgba(0,212,170,0.3)':'rgba(240,165,0,0.3)'};
           display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">${f.icon}</div>
      <!-- Info -->
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.85rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.fileName}">${f.fileName}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:3px;align-items:center;">
          <span style="font-size:0.74rem;background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.2);border-radius:5px;padding:1px 7px;font-weight:600;">👤 ${f.employee}</span>
          <span style="font-size:0.74rem;color:var(--muted);">${f.dept}</span>

        </div>
        <div style="font-size:0.77rem;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📋 ${f.task}</div>
      </div>
      <!-- View button -->
      ${f.fileUrl?`<a href="${f.fileUrl}" target="_blank" rel="noopener"
        style="background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.3);color:#00d4aa;
               border-radius:8px;padding:7px 13px;font-size:0.78rem;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;">
        ⬇ View
      </a>`:'<span style="font-size:0.72rem;color:var(--muted);flex-shrink:0;">No URL</span>'}
    </div>`).join('');
}


// ── File select hote hi turant "uploaded" dikhao + Mark Done unlock karo ──
// (asli cloud upload background mein chalta rehta hai, baad mein silently real URL se update ho jata hai)
function tUnlockMarkDoneIfReady(taskId){
  const tid = String(taskId);
  const _rowRef = tAllData.find(r=>String(r['Task ID'])===tid);
  if(_rowRef && tTaskRequiresAttachment(_rowRef['Task']) && !tIsDone(_rowRef)){
    const _actTd = document.getElementById('act_'+tid);
    if(_actTd){
      const _srcVal = String(_rowRef['_source']||'').toLowerCase();
      _actTd.innerHTML = `<button data-dept-tid="${tid}" onclick="deptShowRemarksInput('${tid}','${_srcVal}')"
        style="background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border-radius:8px;padding:6px 8px;font-size:0.78rem;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:100%;box-shadow:0 2px 6px rgba(168,85,247,0.3);transition:all 0.18s;">
        ✅ Mark Done
      </button>`;
    }
  }
}

async function tDirectUpload(input, taskId){
  const file = input.files[0];
  if(!file) return;
  await tProcessTaskFile(file, taskId);
  input.value='';
}
// ── Shared upload logic — click, drag&drop, aur Ctrl+V paste teeno yahi function use karte hain ──
async function tProcessTaskFile(file, taskId){
  if(!file) return;
  const tid = String(taskId);

  const btn = document.getElementById('tfu_btn_'+tid);
  const td  = btn ? btn.closest('td') : null;

  // ══ INSTANT FEEDBACK — file select karte hi turant dikhao "file daal di" ══
  let _localPreviewUrl = null;
  try{ _localPreviewUrl = URL.createObjectURL(file); }catch(e){}

  if(td){
    td.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;">
        <a href="${_localPreviewUrl||'#'}" target="_blank" rel="noopener" title="${file.name} — syncing to cloud…"
           style="position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;
                  background:rgba(0,212,170,0.12);border:1.5px solid rgba(0,212,170,0.4);
                  border-radius:8px;text-decoration:none;font-size:1rem;">📄<span style="position:absolute;bottom:-3px;right:-3px;font-size:0.6rem;">⏳</span></a>
      </div>`;
  }

  const _now0 = new Date();
  const _uploadedAt0 = `${String(_now0.getDate()).padStart(2,'0')}/${String(_now0.getMonth()+1).padStart(2,'0')}/${_now0.getFullYear()} ${String(_now0.getHours()).padStart(2,'0')}:${String(_now0.getMinutes()).padStart(2,'0')}`;
  // localStorage mein turant save — isse tHasAttachment() abhi se TRUE ho jaata hai
  try{
    const _saved0 = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    _saved0[tid] = [{ name: file.name, url: _localPreviewUrl, uploadedAt: _uploadedAt0, size: file.size, _pendingSync: true }];
    localStorage.setItem('aditiTaskUploads', JSON.stringify(_saved0));
  }catch(e){}

  // Mandatory task ho aur abhi Done nahi hua to "Mark Done" turant unlock karo
  tUnlockMarkDoneIfReady(tid);

  try{
    const ts       = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const bucket   = 'files';
    const filePath = `task_docs/task_${tid}/${ts}_${safeName}`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`,
      {
        method : 'POST',
        headers: {
          'apikey'        : SUPABASE_ANON,
          'Authorization' : `Bearer ${_currentToken}`,
          'Content-Type'  : file.type || 'application/octet-stream',
          'Cache-Control' : '3600',
          'x-upsert'      : 'true'
        },
        body: file
      }
    );

    let fileUrl = null;
    if(uploadRes.ok){
      fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
    }

    // Save to Supabase upload column — URL if upload succeeded, else just filename
    const saveValue = fileUrl || file.name;
    const rowId = (tAllData.find(r=>String(r['Task ID'])===tid)||{})['_id'];
    if(rowId){
      fetch(
        `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
        { method:'PATCH', headers:SB_HDRS_JSON(), body:JSON.stringify({ upload: saveValue }) }
      ).catch(()=>{});
      [tAllData, tFiltered].forEach(arr=>{
        arr.forEach(r=>{ if(String(r['Task ID'])===tid) r['_upload_url']=saveValue; });
      });
    }

    // localStorage ko ab real (final) value se overwrite karo — pending hata do
    try{
      const saved2 = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
      saved2[tid] = [{ name: file.name, url: fileUrl, uploadedAt: _uploadedAt0, size: file.size }];
      localStorage.setItem('aditiTaskUploads', JSON.stringify(saved2));
    }catch(e){}

    // Icon ko silently real cloud URL se refresh karo — 📄 green if URL received, orange if filename only
    if(td){
      const isCloud = !!fileUrl;
      td.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;">
          <a href="${fileUrl||'#'}" target="${isCloud?'_blank':'_self'}" rel="noopener" title="${file.name}"
             style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;
                    background:${isCloud?'rgba(0,212,170,0.12)':'rgba(240,165,0,0.12)'};
                    border:1.5px solid ${isCloud?'rgba(0,212,170,0.4)':'rgba(240,165,0,0.4)'};
                    border-radius:8px;text-decoration:none;font-size:1rem;transition:all 0.18s;">📄</a>
        </div>`;
    }

    tUnlockMarkDoneIfReady(tid);
    if(isCloudUploadDone(fileUrl) && _localPreviewUrl){ try{ URL.revokeObjectURL(_localPreviewUrl); }catch(e){} }

  }catch(err){
    // Network/exception fail — file already locally save ho chuki hai (filename ke saath),
    // isliye "gayab" jaisa na dikhao — sirf filename-only (local) state mein rakho.
    try{
      const rowId = (tAllData.find(r=>String(r['Task ID'])===tid)||{})['_id'];
      if(rowId){
        fetch(
          `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
          { method:'PATCH', headers:SB_HDRS_JSON(), body:JSON.stringify({ upload: file.name }) }
        ).catch(()=>{});
        [tAllData, tFiltered].forEach(arr=>{
          arr.forEach(r=>{ if(String(r['Task ID'])===tid) r['_upload_url']=file.name; });
        });
      }
    }catch(e2){}
    const tdx = document.getElementById('tfu_btn_'+tid) ? document.getElementById('tfu_btn_'+tid).closest('td') : td;
    if(tdx){
      tdx.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;">
          <a href="#" rel="noopener" title="${file.name} (cloud sync failed — local copy saved)"
             style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;
                    background:rgba(240,165,0,0.12);border:1.5px solid rgba(240,165,0,0.4);
                    border-radius:8px;text-decoration:none;font-size:1rem;">📄</a>
        </div>`;
    }
    tUnlockMarkDoneIfReady(tid);
    console.error('Upload error:', err);
  }
}
function isCloudUploadDone(u){ return !!u; }

let _taskUploadId   = null;
let _taskUploadName = '';
let _taskUploadFile = null;

function tOpenTaskUpload(taskId, taskName){
  _taskUploadId   = String(taskId);
  _taskUploadName = taskName;
  _taskUploadFile = null;

  document.getElementById('taskUploadTaskId').textContent   = 'Task #' + taskId;
  document.getElementById('taskUploadTaskName').textContent = taskName;
  document.getElementById('taskUploadStatus').style.display = 'none';
  document.getElementById('taskUploadFileInput').value      = '';
  document.getElementById('taskUploadDropLabel').textContent= 'Click, drag & drop, or paste (Ctrl+V)';
  document.getElementById('taskUploadDropMeta').textContent = 'You can upload a file, drag & drop, or copy-paste a screenshot directly';
  document.getElementById('taskUploadDropZone').style.borderColor = '';
  document.getElementById('taskUploadDropZone').style.background  = '';

  // Existing files dikhao
  tRenderTaskFileList(taskId);

  document.getElementById('taskUploadModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function tCloseTaskUpload(){
  document.getElementById('taskUploadModal').style.display = 'none';
  document.body.style.overflow = '';
  _taskUploadFile = null; _taskUploadId = null;
}

function tRenderTaskFileList(taskId){
  const list = document.getElementById('taskUploadFileList');
  if(!list) return;
  try{
    // Supabase se file URL
    const row = tAllData.find(r=>String(r['Task ID'])===String(taskId));
    const cloudUrl = row ? row['_upload_url'] : null;

    // localStorage se bhi check
    const saved = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    const localFiles = saved[String(taskId)] || [];

    // Cloud URL ko prefer karo
    const allFiles = [];
    if(cloudUrl){
      const localMatch = localFiles.find(f=>f.url===cloudUrl);
      allFiles.push({
        name: localMatch ? localMatch.name : cloudUrl.split('/').pop().replace(/^\d+_/,''),
        url: cloudUrl,
        uploadedAt: localMatch ? localMatch.uploadedAt : '—',
        size: localMatch ? localMatch.size : null,
        fromCloud: true
      });
    } else if(localFiles.length){
      allFiles.push(...localFiles);
    }

    if(!allFiles.length){
      list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:0.82rem;padding:14px 0;">No files uploaded yet</div>';
      return;
    }
    list.innerHTML = allFiles.map((f,i)=>`
      <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:1.2rem;flex-shrink:0">${f.name&&f.name.match(/\.(pdf)$/i)?'📄':f.name&&f.name.match(/\.(png|jpg|jpeg|gif|webp)$/i)?'🖼️':'📎'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.83rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.name}">${f.name}</div>
          <div style="font-size:0.71rem;color:var(--muted);margin-top:1px;">${f.uploadedAt||'—'} ${f.fromCloud?'<span style="color:#00d4aa;font-weight:600">☁ Cloud</span>':''}</div>
        </div>
        ${f.url?`<a href="${f.url}" target="_blank" rel="noopener"
          style="background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.3);color:#00d4aa;
                 border-radius:7px;padding:5px 10px;font-size:0.76rem;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;">
          ⬇ View
        </a>`:'<span style="font-size:0.72rem;color:var(--muted)">No URL</span>'}
      </div>`).join('');
  }catch(e){ list.innerHTML='<div style="color:var(--hot);font-size:0.82rem;">Error loading files</div>'; }
}

function tDeleteTaskFile(taskId, idx){
  if(!confirm('Delete this file?')) return;
  try{
    const saved = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    const files = saved[String(taskId)] || [];
    files.splice(idx, 1);
    saved[String(taskId)] = files;
    localStorage.setItem('aditiTaskUploads', JSON.stringify(saved));
    tRenderTaskFileList(taskId);
    tRenderTable();
  }catch(e){}
}

function tHandleTaskFileSelect(e){
  const file = e.target.files[0];
  if(!file) return;
  _taskUploadFile = file;
  document.getElementById('taskUploadDropLabel').textContent = file.name;
  document.getElementById('taskUploadDropMeta').textContent  = (file.size/1024).toFixed(1)+' KB';
  document.getElementById('taskUploadDropZone').style.borderColor = '#a855f7';
  document.getElementById('taskUploadDropZone').style.background  = 'rgba(168,85,247,0.06)';
}

// ── Task Upload Modal — Ctrl+V se screenshot paste karne ka support ──────
document.addEventListener('paste', function(e){
  const modal = document.getElementById('taskUploadModal');
  if(!modal || modal.style.display !== 'flex') return; // modal khula nahi hai to kuch na karo
  const items = e.clipboardData?.items;
  if(!items) return;
  for(let item of items){
    if(item.type.startsWith('image/')){
      const file = item.getAsFile();
      if(!file) continue;
      const namedFile = new File([file], `screenshot_${Date.now()}.png`, { type: 'image/png' });
      tHandleTaskFileSelect({ target: { files: [namedFile] } });
      showToast && showToast('📋 Screenshot pasted! Click Upload to save.', 'success', 2500);
      e.preventDefault();
      break;
    }
  }
});

async function tSubmitTaskUpload(){
  if(!_taskUploadFile){ alert('Please select a file first!'); return; }
  if(!_taskUploadId){ return; }

  const statusEl = document.getElementById('taskUploadStatus');
  const btn      = document.getElementById('taskUploadSubmitBtn');
  btn.disabled   = true;
  statusEl.style.display    = 'block';
  statusEl.style.color      = '#00d4ff';
  statusEl.style.background = 'rgba(0,212,255,0.06)';
  statusEl.style.border     = '1px solid rgba(0,212,255,0.2)';
  statusEl.textContent      = '⏳ Uploading...';

  try{
    const file = _taskUploadFile;
    const ts   = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const bucket   = 'files';
    const filePath = `task_docs/task_${_taskUploadId}/${ts}_${safeName}`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`,
      {
        method : 'POST',
        headers: {
          'apikey'        : SUPABASE_ANON,
          'Authorization' : `Bearer ${_currentToken}`,
          'Content-Type'  : file.type || 'application/octet-stream',
          'Cache-Control' : '3600',
          'x-upsert'      : 'true'
        },
        body: file
      }
    );

    let fileUrl = null;
    if(uploadRes.ok){
      fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;

      // ✅ Supabase mein task_doc_urls column update karo
      const rowId = (tAllData.find(r=>String(r['Task ID'])===_taskUploadId)||{})['_id'];
      if(rowId){
        await fetch(
          `${SUPABASE_URL}/rest/v1/employee_checklists?id=eq.${encodeURIComponent(rowId)}`,
          { method:'PATCH', headers:SB_HDRS_JSON(), body:JSON.stringify({ upload: fileUrl }) }
        ).catch(()=>{});
        // Local data update
        [tAllData, tFiltered].forEach(arr=>{
          arr.forEach(r=>{ if(String(r['Task ID'])===_taskUploadId) r['_upload_url']=fileUrl; });
        });
      }

      statusEl.style.color = '#00d4aa';
      statusEl.style.background = 'rgba(0,212,170,0.06)';
      statusEl.style.border = '1px solid rgba(0,212,170,0.2)';
      statusEl.textContent = '✅ Upload successful! File saved to cloud.';
    } else {
      statusEl.style.color = '#f0a500';
      statusEl.style.background = 'rgba(240,165,0,0.06)';
      statusEl.style.border = '1px solid rgba(240,165,0,0.2)';
      statusEl.textContent = '⚠️ Cloud upload failed — saved locally only';
    }

    // localStorage mein bhi save karo (offline fallback)
    const saved = JSON.parse(localStorage.getItem('aditiTaskUploads')||'{}');
    const now2 = new Date();
    const uploadedAt = `${String(now2.getDate()).padStart(2,'0')}/${String(now2.getMonth()+1).padStart(2,'0')}/${now2.getFullYear()} ${String(now2.getHours()).padStart(2,'0')}:${String(now2.getMinutes()).padStart(2,'0')}`;
    saved[_taskUploadId] = [{ name: file.name, url: fileUrl, uploadedAt, size: file.size }];
    localStorage.setItem('aditiTaskUploads', JSON.stringify(saved));

    // UI refresh
    tRenderTaskFileList(_taskUploadId);
    tRenderTable();
    document.getElementById('taskUploadFileInput').value = '';
    _taskUploadFile = null;
    document.getElementById('taskUploadDropLabel').textContent = 'Click, drag & drop, or paste (Ctrl+V)';
    document.getElementById('taskUploadDropMeta').textContent  = 'You can upload a file, drag & drop, or copy-paste a screenshot directly';
    document.getElementById('taskUploadDropZone').style.borderColor = '';
    document.getElementById('taskUploadDropZone').style.background  = '';

  } catch(err){
    statusEl.style.color = '#ff5c7c';
    statusEl.style.background = 'rgba(255,92,124,0.06)';
    statusEl.style.border = '1px solid rgba(255,92,124,0.2)';
    statusEl.textContent = '❌ Error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LIVE SYNC — portal aur sheet real-time sync mein rahein
// ═══════════════════════════════════════════════════════════════════════
// Background mein silently fresh data fetch karta hai bina spinner ya filter
// reset kare. Jab user tab pe wapas aata hai ya har 45 sec pe automatically
// chalta hai. Isse sheet ka har change (add karo ya delete karo) ~45s mein
// portal pe reflect ho jayega.
let _tasksLastSync = 0;
let _tasksSyncing = false;
const TASKS_LIVE_POLL_MS = 15*1000;     // 15 seconds polling — row delete ~15s mein reflect hoga
const TASKS_LIVE_MIN_GAP_MS = 8*1000;   // Minimum 8s gap between syncs

async function tSilentRefresh(){
  if(_tasksSyncing || !tLoaded) return;
  _tasksSyncing = true;
  try {
    const isOwner = PERMISSIONS.checklist_scope === 'all';
    const myEmail = CURRENT_USER ? String(CURRENT_USER.email||'').trim().toLowerCase() : '';

    // Dono ke liye current active date use karo (default today)
    const _todaySync = new Date().toISOString().slice(0,10);
    const fetchFrom = tActiveDateFrom || _todaySync;
    const fetchTo   = tActiveDateTo   || _todaySync;

    // Employee: emp_id lookup
    let myEmpId = null;
    if(!isOwner && myEmail){
      const empRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(myEmail)}&limit=1`,
        { headers: SB_HDRS() }
      );
      const empRows = await empRes.json();
      myEmpId = empRows && empRows[0] ? String(empRows[0].Emp_id || empRows[0].emp_id || '').trim() : null;
      if(!myEmpId){ _tasksSyncing=false; return; }
    }

    // Tasks fetch - single OR query (planned tasks + pending ongoing tasks)
    // OR condition: planned tasks + ongoing tasks due IN this date range + tasks completed on view date
    const orFilter2 = `or=(and(planned_date.gte.${fetchFrom},planned_date.lte.${fetchTo}),and(ongoing.gte.${fetchFrom},ongoing.lte.${fetchTo},actual_timestamp.is.null),and(actual_timestamp.gte.${fetchFrom},actual_timestamp.lte.${fetchTo}T23:59:59))`;
    let tasksBaseUrl2;
    if(isOwner){
      tasksBaseUrl2 = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
               + `&${orFilter2}`
               + `&order=planned_date.desc,id.asc`;
    } else {
      tasksBaseUrl2 = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
               + `&emp_id=eq.${encodeURIComponent(myEmpId)}`
               + `&${orFilter2}`
               + `&order=planned_date.desc,id.asc`;
    }

    const tasks = await tFetchAllPages(tasksBaseUrl2);
    if(!Array.isArray(tasks)) throw new Error('Bad response');

    // ── Silent Refresh: Ongoing tasks bhi fetch karo (jo future mein due hain) ──
    let ongoingTasksSync = [];
    try{
      let ongoingUrlSync;
      if(isOwner){
        ongoingUrlSync = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
                       + `&ongoing=gte.${fetchFrom}&actual_timestamp=is.null`
                       + `&order=planned_date.desc,id.asc`;
      } else if(myEmpId){
        ongoingUrlSync = `${SUPABASE_URL}/rest/v1/employee_checklists?select=*`
                       + `&emp_id=eq.${encodeURIComponent(myEmpId)}`
                       + `&ongoing=gte.${fetchFrom}&actual_timestamp=is.null`
                       + `&order=planned_date.desc,id.asc`;
      }
      if(ongoingUrlSync){
        const ogRes2 = await fetch(ongoingUrlSync + '&limit=500', { headers: SB_HDRS() });
        const ogRows2 = await ogRes2.json();
        if(Array.isArray(ogRows2)) ongoingTasksSync = ogRows2;
      }
    }catch(e){ console.warn('Ongoing sync fetch failed:', e); }

    // Merge: dedup by id
    const taskIdSet2 = new Set(tasks.map(r=>r.id));
    const mergedTasksSync = [...tasks];
    ongoingTasksSync.forEach(r=>{ if(!taskIdSet2.has(r.id)){ mergedTasksSync.push(r); } });

    // Employee_details batch fetch
    const empIdSet = [...new Set(mergedTasksSync.map(r=>String(r.emp_id||'').trim()).filter(Boolean))];
    let empMap = {};
    if(empIdSet.length > 0){
      const edRes = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept,Email_Id,Location&Emp_id=in.(${empIdSet.join(',')})`,
        { headers: SB_HDRS() }
      );
      const edRows = await edRes.json();
      if(Array.isArray(edRows)){
        edRows.forEach(r=>{
          const id = String(r.Emp_id || r.emp_id || '').trim();
          if(id) empMap[id] = {
            name:  String(r.Employee_name || '').trim(),
            dept:  String(r.Employee_Dept || '').trim(),
            email: String(r.Email_Id || '').trim(),
            loc:   String(r.Location || '').trim(),
          };
        });
      }
    }

    const newData = mergedTasksSync.map(r => {
      const empId = String(r.emp_id || '').trim();
      const ed = empMap[empId] || {};
      const expRaw = r.ongoing ? String(r.ongoing).trim() : null;
      const expParts = expRaw ? expRaw.split('-') : null;
      const expDisplay = expParts && expParts.length===3 ? `${expParts[2]}/${expParts[1]}/${expParts[0]}` : null;
      return {
        'Name':             ed.name  || empId || '',
        'Email':            ed.email || '',
        'Department':       ed.dept  || '',
        'Task ID':          String(r.sheet_task_id || '').trim(),
        'Freq':             String(r.frequency || '').trim(),
        'Task':             String(r.task_name || '').trim(),
        'Planned':          String(r.planned_date || r.planned_data || '').trim(),
        'Actual':           String(r.actual_timestamp || '').trim(),
        'Status':           r.actual_timestamp ? 'Done' : 'Pending',
        'Remarks':          String(r.remarks || '').trim(),
        '_location':        ed.loc || String(r.branch_id || '').trim(),
        '_id':              r.id,
        '_expected_date':   expRaw,
        '_expected_display':expDisplay,
        '_upload_url':      r.upload ? String(r.upload).trim() : null,
      };
    });

    newData.forEach(r=>{ r['_tDate']=tParseDate(r['Planned']); });

    // ── DB Sync: silent refresh ke baad bhi localStorage clear karo ──
    tSyncLocalStorageWithDB(newData);

    // FIX: In-place merge — existing rows ki position preserve karo (niche shift nahi hoga)
    const newDataMap = new Map(newData.map(r => [r['_id'], r]));
    const existingIds = new Set(tAllData.map(r => r['_id']));
    // Existing rows in-place update karo
    tAllData.forEach((r, i) => {
      const updated = newDataMap.get(r['_id']);
      if(updated) Object.assign(tAllData[i], updated);
    });
    // Naye rows add karo (jo pehle nahi the)
    newData.forEach(r => { if(!existingIds.has(r['_id'])) tAllData.push(r); });
    // Delete hue rows hatao — LEKIN done tasks mat hatao
    // Ongoing task done hone ke baad planned_date purana hota hai isliye server se nahi aata
    // Aise tasks ko view mein rakho agar aaj complete kiya ho
    const newIds = new Set(newData.map(r => r['_id']));
    const _vFrom = tActiveDateFrom || new Date().toISOString().slice(0,10);
    const _vTo   = tActiveDateTo   || _vFrom;
    tAllData = tAllData.filter(r => {
      if(newIds.has(r['_id'])) return true;
      // Server se nahi aaya — recently done task hai toh rakho
      if(r['Actual'] && String(r['Actual']).trim()){
        try{
          const actDate = String(r['Actual']).trim().slice(0,10);
          if(actDate >= _vFrom && actDate <= _vTo) return true;
        }catch(e){}
      }
      return false;
    });

    tApplyDoneTasks();

    const _notOwner = !isOwner;
    if(CURRENT_USER && _notOwner){
      const hasTasks = tAllData.length > 0;
      // Dashboards visible if user has ANY of: CRM/Leads/Enterprise/Collection/FMS/IMS/Mapping permission, OR has tasks assigned (Task Checklist)
      const hasDashAccess=
        PERMISSIONS.can_view_crm==='true'||
        PERMISSIONS.can_view_leads==='true'||
        PERMISSIONS.can_view_enterprise==='true'||
        PERMISSIONS.can_view_collection==='true'||
        PERMISSIONS.can_view_fms==='true'||
        PERMISSIONS.can_view_ims==='true'||
        PERMISSIONS.can_view_mapping==='true'||
        hasTasks;
      const navDash=document.getElementById('nav-dashboards-trigger');
      if(navDash)navDash.style.display=hasDashAccess?'':'none';
      const dashGroup=document.getElementById('dashboardSubGroup');
      if(dashGroup)dashGroup.style.display=hasDashAccess?'':'none';
      if(!hasTasks){
        const navTasks=document.getElementById('nav-tasks');
        if(navTasks)navTasks.style.display='none';
        document.querySelectorAll('#panel-home .home-card').forEach(card=>{
          if(card.textContent.includes('Task Checklist'))card.style.display='none';
        });
      } else {
        const navTasks=document.getElementById('nav-tasks');
        if(navTasks)navTasks.style.display='';
        document.querySelectorAll('#panel-home .home-card').forEach(card=>{
          if(card.textContent.includes('Task Checklist'))card.style.display='';
        });
      }
    }
    const prevPage = tPage || 1;
    tFiltered = tGetFiltered();
    const maxPage = Math.max(1, Math.ceil(tFiltered.length / T_PER_PAGE));
    tPage = Math.min(prevPage, maxPage);

    Object.values(tCharts).forEach(c=>c&&c.destroy&&c.destroy()); tCharts={};
    tRenderKPIs(); tRenderCharts();
    // FIX: Agar koi remarks input active hai (user type kar raha hai), table re-render skip karo
    // — warna user ka inline input gayab ho jayega (task "disappears" bug)
    const _hasActiveInput = !!document.querySelector('[id^="dept_rem_"]');
    if(!_hasActiveInput){ tRenderTable(); }
    tUpdateBadge();
    updateHomeTaskBanner();
    const syncBadge = document.getElementById('tLastSyncBadge');
    if(syncBadge) syncBadge.textContent = '✓ Synced ' + new Date().toLocaleTimeString();
    const refreshBtn = document.getElementById('tForceRefreshBtn');
    if(refreshBtn){ refreshBtn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Refresh'; refreshBtn.disabled=false; refreshBtn.style.opacity='1'; }
    const sync = document.getElementById('tasksSync');
    if(sync) sync.textContent='Live · '+new Date().toLocaleTimeString();
    _tasksLastSync = Date.now();
  } catch(e){
  } finally {
    _tasksSyncing = false;
  }
}

// Manual force refresh — user button click se
async function tForceRefresh(){
  const btn = document.getElementById('tForceRefreshBtn');
  if(btn){ btn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Fetching...'; btn.disabled=true; btn.style.opacity='0.6'; }
  const syncBadge = document.getElementById('tLastSyncBadge');
  if(syncBadge) syncBadge.textContent = '⟳ Fetching from Sheet...';
  _tasksLastSync = 0; // Force bypass min-gap check
  await tSilentRefresh();
}

function tMaybeLiveSync(){
  if(!tLoaded) return;
  if(Date.now() - _tasksLastSync < TASKS_LIVE_MIN_GAP_MS) return;
  tSilentRefresh();
}

// Tab visible hone pe (form submit karke wapas aane pe)
document.addEventListener('visibilitychange', function(){
  if(!document.hidden) tMaybeLiveSync();
});
// Window focus milne pe
window.addEventListener('focus', tMaybeLiveSync);

// Har 45 seconds pe background sync — sheet ka koi bhi change ~45s mein dikhega
setInterval(function(){
  if(!document.hidden) tMaybeLiveSync();
}, TASKS_LIVE_POLL_MS);


// ============================================================


// ╔══════════════════════════════════════════════════════════════════════════
// ║  [AUTH / LOGIN JS] — Login, logout, session management
// ║  doLogin()    = Email+password se Supabase Auth se login karo
// ║  doLogout()   = Session clear karo, login page dikhao
// ║  _currentToken = Login ke baad user JWT yahan store hota hai
// ║  CURRENT_USER  = Logged-in user ka object (name, email, role etc.)
// ║  PERMISSIONS   = User ki permissions ka object (loaded after login)
// ║  Agar login na ho raha ho: Supabase Auth > Users check karo
// ╚══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════
// LOGIN SYSTEM
// ═══════════════════════════════════
// USERS_URL (Google Sheet) removed — employee data now fetched from Supabase Employee_details table

// ── Supabase Auth Client ──
