// Section: FMS O2D (fmsInit, orders, pipeline, installation tracker)
// ═══════════════════════════════════════════════════
// FMS Installation Tracker — Dashboard Logic
// For PC = Yes → DELAYED | For PC = No → REMAINING
// ═══════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════
// ║  [NEW FMS MODULE JS] — Supabase-backed Installation Tracker
// ║  Tables: fms_orders, fms_assignments, fms_configuration,
// ║          fms_installation, fms_products, fms_locations
// ╚══════════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────────
let _fmsOrders = [], _fmsFiltered = [], _fmsProducts = [], _fmsLocations = [];
let _fmsCurrentOrder = null;
let _fmsPage = 1;
const FMS_PER_PAGE = 20;
let _fmsLoaded = false;
let _fmsSelectedLocation = null; // {id, name} or {id:'other', name:'Other'}
let _fmsClientSearchTimeout = null;
let _fmsEmpMap = { 'outsource':'Outsource', 'self_installed':'Self Installed by Client' }; // email → name cache

// ── Config persons — Anish (Mumbai) + Kush (Goa) — both do device configuration ──
const FMS_ANISH_EMAIL = 'support_1@adititracking.com';
const FMS_KUSH_EMAIL  = 'supportgoa1@adititracking.com';
const FMS_CONFIG_EMAILS = [FMS_ANISH_EMAIL, FMS_KUSH_EMAIL];

const _fmsOrigSwitchDB = typeof switchDB === 'function' ? switchDB : null;
switchDB = function(id){
  if(_fmsOrigSwitchDB) _fmsOrigSwitchDB(id);
  if(id === 'fms' && !_fmsLoaded){ _fmsLoaded = true; fmsInit(); }
};

// ── Init ───────────────────────────────────────────────────────────────────
async function fmsInit(){
  await Promise.all([fmsLoadProducts(), fmsLoadLocations(), fmsLoadEmpMap()]);
  fmsSetupPermissions();
  fmsLoadOrders();
}

async function fmsLoadEmpMap(){
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?select=Employee_name,Email_Id`,
      { headers: SB_HDRS() }
    );
    const rows = await res.json();
    rows.forEach(r => {
      if(r.Email_Id) _fmsEmpMap[(r.Email_Id||'').toLowerCase().trim()] = r.Employee_name || r.Email_Id;
    });
  } catch(e){ console.error('FMS emp map error:', e); }
}

// Helper: email → name
function fmsEmpName(email){
  if(!email) return '—';
  return _fmsEmpMap[(email||'').toLowerCase().trim()] || email;
}

function fmsSetupPermissions(){
  const p = PERMISSIONS || {};
  // can_view_fms gates the panel (via nav permission system)
  const canCreate = p.fms_create === 'true' || CURRENT_USER?.rawRole === 'mis' || CURRENT_USER?.rawRole === 'managing director';
  const btn = document.getElementById('fmsNewOrderBtn');
  if(btn) btn.style.display = canCreate ? 'inline-flex' : 'none';
}

// ── Load Products ──────────────────────────────────────────────────────────
async function fmsLoadProducts(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_products?is_active=eq.true&order=product_name`, { headers: SB_HDRS() });
    _fmsProducts = await res.json();
  } catch(e){ console.error('FMS products load error:', e); }
}

// ── Load Locations ─────────────────────────────────────────────────────────
async function fmsLoadLocations(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_locations?is_active=eq.true&order=location_name`, { headers: SB_HDRS() });
    _fmsLocations = await res.json();
    // Populate location filter dropdown
    const sel = document.getElementById('fmsLocationFilter');
    if(sel){
      _fmsLocations.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.location_name; opt.textContent = l.location_name;
        sel.appendChild(opt);
      });
    }
  } catch(e){ console.error('FMS locations load error:', e); }
}

// ── Load Orders ────────────────────────────────────────────────────────────
async function fmsLoadOrders(){
  const tbody = document.getElementById('fmsTableBody');
  if(tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2.5rem;color:var(--muted);"><div class="loader-bar"><div class="loader-fill"></div></div><p style="margin-top:0.8rem;font-size:0.89rem;">Loading orders...</p></td></tr>`;

  try{
    const p = PERMISSIONS || {};
    const isViewAll = p.fms_view_all === 'true' || CURRENT_USER?.rawRole === 'mis' || CURRENT_USER?.rawRole === 'managing director';
    const myEmail = CURRENT_USER?.email || '';

    let url = `${SUPABASE_URL}/rest/v1/fms_orders?order=created_at.desc`;
    if(!isViewAll){
      const isAnish = FMS_CONFIG_EMAILS.includes(myEmail);
      if(isAnish){
        url += `&or=(created_by.eq.${encodeURIComponent(myEmail)},assigned_to_support.eq.${encodeURIComponent(myEmail)},status.eq.pending_config,status.eq.configuring,status.eq.pending_engineer,status.eq.installing,status.eq.completed)`;
      } else {
        // Regular employee — sirf apne banaye + assigned orders
        url += `&or=(created_by.eq.${encodeURIComponent(myEmail)},assigned_to_support.eq.${encodeURIComponent(myEmail)})`;
      }
    }

    const res = await fetch(url, { headers: SB_HDRS() });
    _fmsOrders = await res.json();

    // Populate Created By dropdown — MIS/Owner only
    const createdByEl = document.getElementById('fmsCreatedByFilter');
    if(createdByEl){
      if(isViewAll){
        createdByEl.style.display = '';
        const uniqueCreators = [...new Set(_fmsOrders.map(o => o.created_by).filter(Boolean))];
        const currentVal = createdByEl.value;
        createdByEl.innerHTML = '<option value="">All Created By</option>';
        uniqueCreators.sort().forEach(email => {
          const opt = document.createElement('option');
          opt.value = email;
          opt.textContent = _fmsEmpMap[email.toLowerCase()] || email;
          createdByEl.appendChild(opt);
        });
        createdByEl.value = currentVal;
      } else {
        createdByEl.style.display = 'none';
      }
    }

    fmsUpdateKPIs();
    fmsApplyFilters();
  } catch(e){
    console.error('FMS load error:', e);
    if(tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--hot);">❌ Error loading orders. <button onclick="fmsLoadOrders()" style="margin-left:8px;padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;">Retry</button></td></tr>`;
  }
}

// ── KPI Update ─────────────────────────────────────────────────────────────
function fmsUpdateKPIs(){
  const counts = { total:0, pending_support:0, pending_config:0, pending_engineer:0, installing:0, completed:0 };
  let totalPendingAmt = 0;
  let pendingAmtOrders = 0;

  _fmsOrders.forEach(o => {
    counts.total++;
    if(counts[o.status] !== undefined) counts[o.status]++;

    // Pending payment calc
    const pending = (parseFloat(o.order_amount)||0) - (parseFloat(o.amount_received)||0);
    if(pending > 0){
      totalPendingAmt += pending;
      pendingAmtOrders++;
    }
  });

  document.getElementById('fmsKpiTotal').textContent           = counts.total;
  document.getElementById('fmsKpiPendingSupport').textContent  = counts.pending_support;
  document.getElementById('fmsKpiPendingConfig').textContent   = counts.pending_config;
  document.getElementById('fmsKpiPendingEngineer').textContent = counts.pending_engineer;
  document.getElementById('fmsKpiInstalling').textContent      = counts.installing;
  document.getElementById('fmsKpiCompleted').textContent       = counts.completed;

  // Pending Payment KPI — format as ₹ with K/L suffix
  const fmt = (n) => {
    if(n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
    if(n >= 100000)   return '₹' + (n/100000).toFixed(1) + 'L';
    if(n >= 1000)     return '₹' + (n/1000).toFixed(1) + 'K';
    return '₹' + n.toLocaleString('en-IN');
  };
  document.getElementById('fmsKpiPendingPayment').textContent      = fmt(totalPendingAmt);
  document.getElementById('fmsKpiPendingPaymentCount').textContent = `${pendingAmtOrders} order${pendingAmtOrders!==1?'s':''}`;

  // Total Amount KPI
  const totalAmt = _fmsOrders.reduce((s,o) => s+(parseFloat(o.order_amount)||0), 0);
  document.getElementById('fmsKpiTotalAmount').textContent = fmt(totalAmt);
}

// ── Filter ─────────────────────────────────────────────────────────────────
function fmsFilterStatus(status){
  document.getElementById('fmsStatusFilter').value = status;
  fmsApplyFilters();
}

function fmsApplyFilters(){
  const search    = (document.getElementById('fmsSearch')?.value || '').toLowerCase();
  const createdBy    = document.getElementById('fmsCreatedByFilter')?.value || '';
  const clientType   = document.getElementById('fmsClientTypeFilter')?.value || '';
  const location  = document.getElementById('fmsLocationFilter')?.value || '';
  const dateFrom  = document.getElementById('fmsDateFrom')?.value || '';
  const dateTo    = document.getElementById('fmsDateTo')?.value || '';

  _fmsFiltered = _fmsOrders.filter(o => {
    const clientName = (o.client_name || '').toLowerCase();
    const so         = (o.so_number  || '').toLowerCase();
    const ticket     = (o.ticket_no  || '').toLowerCase();
    const loc        = o.location_id ? (_fmsLocations.find(l=>l.id===o.location_id)?.location_name||'') : (o.location_manual||'');

    if(search && !clientName.includes(search) && !so.includes(search) && !ticket.includes(search)) return false;
    if(createdBy && (o.created_by||'').toLowerCase() !== createdBy.toLowerCase()) return false;
    if(clientType && (o.client_type||'existing') !== clientType) return false;
    if(location && loc !== location) return false;
    if(dateFrom && o.created_at < dateFrom) return false;
    if(dateTo && o.created_at.slice(0,10) > dateTo) return false;
    if(_fmsPendingPaymentFilter){
      const pending = (parseFloat(o.order_amount)||0) - (parseFloat(o.amount_received)||0);
      if(pending <= 0) return false;
    }
    return true;
  });

  document.getElementById('fmsTableCount').textContent = `${_fmsFiltered.length} order${_fmsFiltered.length!==1?'s':''}`;
  _fmsPage = 1;
  fmsRenderTable();
}

function fmsResetFilters(){
  ['fmsSearch','fmsCreatedByFilter','fmsLocationFilter','fmsDateFrom','fmsDateTo'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  _fmsPendingPaymentFilter = false;
  fmsApplyFilters();
}

// ── Pending Payment filter toggle ─────────────────────────────────────────
let _fmsPendingPaymentFilter = false;
function fmsFilterPendingPayment(){
  _fmsPendingPaymentFilter = !_fmsPendingPaymentFilter;
  // Highlight card
  const card = document.querySelector('[onclick="fmsFilterPendingPayment()"]');
  if(card) card.style.outline = _fmsPendingPaymentFilter ? '2px solid #ff5c7c' : '';
  fmsApplyFilters();
}

// ── FMS Pipeline Row Renderer ────────────────────────────────────────────
// Reference: large circles with icon, arrow connectors, Done/Next/Pending badges

const FMS_STEPS = [
  { key:'order',     icon:'🗒️',  label:'Order Created',  color:'#6c63ff', step:1 },
  { key:'support',   icon:'🔧',  label:'Support Assign', color:'#7c3aed', step:2 },
  { key:'config',    icon:'💾',  label:'Configuration',  color:'#2563eb', step:3 },
  { key:'engineer',  icon:'🔩',  label:'Installation',   color:'#7c3aed', step:4 },
  { key:'done',      icon:'🏁',  label:'Completed',      color:'#6b7280', step:5 },
];

function fmsStepStateMap(status){
  // Returns array of 'done'|'active'|'pending' for each step
  const map = {
    'pending_support':  ['active','pending','pending','pending','pending'],
    'pending_config':   ['done','active','pending','pending','pending'],
    'configuring':      ['done','done','active','pending','pending'],
    'pending_engineer': ['done','done','done','active','pending'],
    'installing':       ['done','done','done','active','pending'],
    'completed':        ['done','done','done','done','done'],
  };
  return map[status] || ['active','pending','pending','pending','pending'];
}

function fmsStepBadge(state){
  if(state==='done')   return `<span style="display:inline-block;padding:0px 6px;border-radius:20px;font-size:0.55rem;font-weight:700;background:#dcfce7;color:#16a34a;">Done</span>`;
  if(state==='active') return `<span style="display:inline-block;padding:0px 6px;border-radius:20px;font-size:0.55rem;font-weight:700;background:#fef9c3;color:#ca8a04;">Next</span>`;
  return `<span style="display:inline-block;padding:0px 6px;border-radius:20px;font-size:0.55rem;font-weight:700;background:rgba(255,255,255,0.05);color:var(--muted);">Pend</span>`;
}

function fmsBuildPipelineRow(o, states){
  // 3 stacked rows, all sharing the same circle(30px)/line(flex:1) column widths so everything lines up:
  //   Row 1 — TAT chip between each step (how long that step took)
  //   Row 2 — circle + connecting line (the actual pipeline)
  //   Row 3 — Done/Next/Pend badge under each circle
  const n = FMS_STEPS.length;
  const CIRCLE = 30; // px

  // Time-between-steps, same source as the detail view used to show
  const tatArr = [
    null,
    fmsTatStr(o.step1_completed_at, o.step2_completed_at),
    fmsTatStr(o.step3_started_at,   o.step3_completed_at),
    fmsTatStr(o.step4_started_at,   o.step4_completed_at),
    fmsTatStr(o.step5_started_at,   o.step5_completed_at),
  ];

  let tatRow = '', circleRow = '', badgeRow = '';

  FMS_STEPS.forEach((step, i) => {
    const state    = states[i];
    const isDone   = state==='done';
    const isActive = state==='active';

    // Circle styling
    let circleBg, circleBorder, circleOp, checkmark, glow;
    if(isDone){
      circleBg     = `linear-gradient(135deg,${step.color}99,${step.color}dd)`;
      circleBorder = step.color;
      circleOp     = '1';
      glow         = '';
      checkmark    = `<div style="position:absolute;top:-2px;right:-2px;width:13px;height:13px;border-radius:50%;background:#22c55e;border:1.5px solid var(--surface);display:flex;align-items:center;justify-content:center;font-size:0.45rem;color:#fff;font-weight:900;">✓</div>`;
    } else if(isActive){
      circleBg     = 'var(--surface)';
      circleBorder = step.color;
      circleOp     = '1';
      glow         = `box-shadow:0 0 0 3px ${step.color}22;animation:fmsPulse 2s infinite;`;
      checkmark    = '';
    } else {
      circleBg     = 'var(--surface2)';
      circleBorder = 'rgba(130,130,150,0.3)';
      circleOp     = '0.5';
      glow         = '';
      checkmark    = '';
    }

    // Row 2 — circle (fixed width column, matches Row 1 & Row 3 circle columns)
    circleRow += `<div style="width:${CIRCLE}px;flex-shrink:0;display:flex;justify-content:center;">
      <div style="position:relative;width:${CIRCLE}px;height:${CIRCLE}px;border-radius:50%;background:${circleBg};border:2px solid ${circleBorder};display:flex;align-items:center;justify-content:center;font-size:0.8rem;opacity:${circleOp};${glow}">
        ${step.icon}${checkmark}
      </div>
    </div>`;

    // Row 3 — badge under this circle
    badgeRow += `<div style="width:${CIRCLE}px;flex-shrink:0;display:flex;justify-content:center;">${fmsStepBadge(state)}</div>`;

    // Row 1 — empty placeholder under the circle (TAT chips only sit on the connector segments)
    tatRow += `<div style="width:${CIRCLE}px;flex-shrink:0;"></div>`;

    // Connector segment (flex:1) — line + TAT chip above it
    if(i < n - 1){
      const lineColor = isDone ? step.color : 'rgba(140,140,160,0.18)';
      const lineOp    = isDone ? '0.92' : '1';
      const tatVal    = tatArr[i+1];
      const tatChip   = tatVal
        ? `<span style="font-size:0.6rem;font-weight:700;color:${isDone?step.color:'var(--muted)'};background:${isDone?step.color+'14':'rgba(255,255,255,0.04)'};border:1px solid ${isDone?step.color+'33':'var(--border2)'};border-radius:20px;padding:1px 7px;white-space:nowrap;">⏱ ${tatVal}</span>`
        : '';

      tatRow += `<div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:16px;">${tatChip}</div>`;
      circleRow += `<div style="flex:1;display:flex;align-items:center;">
        <div style="width:100%;height:2.5px;background:${lineColor};opacity:${lineOp};border-radius:2px;"></div>
      </div>`;
      badgeRow += `<div style="flex:1;"></div>`;
    }
  });

  return [`<td colspan="11" style="padding:0.28rem 0.75rem;vertical-align:middle;">
    <div style="display:flex;align-items:center;width:100%;margin-bottom:2px;">${tatRow}</div>
    <div style="display:flex;align-items:center;width:100%;">${circleRow}</div>
    <div style="display:flex;align-items:flex-start;width:100%;margin-top:3px;">${badgeRow}</div>
  </td>`];
}


// ── Render Table ───────────────────────────────────────────────────────────
function fmsRenderTable(){
  const tbody = document.getElementById('fmsTableBody');
  if(!tbody) return;

  const total = _fmsFiltered.length;
  const totalPages = Math.ceil(total / FMS_PER_PAGE);
  const start = (_fmsPage - 1) * FMS_PER_PAGE;
  const page  = _fmsFiltered.slice(start, start + FMS_PER_PAGE);

  if(!page.length){
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:2.5rem;color:var(--muted);font-size:0.9rem;">📭 No orders found</td></tr>`;
    document.getElementById('fmsPagination').style.display = 'none';
    return;
  }

  const myEmail    = (CURRENT_USER?.email||'').toLowerCase();
  const p          = PERMISSIONS||{};
  const isOverride = p.fms_override==='true'||CURRENT_USER?.rawRole==='mis'||CURRENT_USER?.rawRole==='managing director';
  const isSupport  = p.fms_support==='true';
  const isConfig   = p.fms_config==='true'||FMS_CONFIG_EMAILS.includes(myEmail);

  tbody.innerHTML = page.map(o => {
    const locName  = o.location_type==='outside'?(o.location_manual||'Outside'):(_fmsLocations.find(l=>l.id===o.location_id)?.location_name||'—');
    const created  = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const states   = fmsStepStateMap(o.status);
    const pipeline = fmsBuildPipelineRow(o, states); // returns array of TDs

    // Action button
    let actionBtn = `<button onclick="fmsOpenTimeline(${o.id})" class="fms-action-btn info" style="font-size:0.75rem;padding:0.3rem 0.8rem;white-space:nowrap;">👁 View</button>`;
    if(o.status==='pending_support'&&(isSupport&&myEmail===(o.assigned_to_support||'').toLowerCase()||isOverride)){
      actionBtn=`<button onclick="fmsOpenSupportOverlay(${o.id})" class="fms-action-btn primary" style="font-size:0.75rem;padding:0.3rem 0.8rem;white-space:nowrap;">➡️ Assign</button>`;
    } else if(o.status==='pending_config'&&(isConfig&&FMS_CONFIG_EMAILS.includes(myEmail)||isOverride)){
      actionBtn=`<button onclick="fmsOpenConfigOverlay(${o.id})" class="fms-action-btn" style="background:#2563eb;color:#fff;font-size:0.75rem;padding:0.3rem 0.8rem;white-space:nowrap;">💾 Config</button>`;
    } else if(o.status==='pending_engineer'&&(isSupport&&myEmail===(o.assigned_to_support||'').toLowerCase()||isOverride)){
      actionBtn=`<button onclick="fmsOpenEngineerOverlay(${o.id})" class="fms-action-btn purple" style="font-size:0.75rem;padding:0.3rem 0.8rem;white-space:nowrap;">🔩 Assign</button>`;
    } else if(o.status==='installing'&&(isSupport&&myEmail===(o.assigned_to_support||'').toLowerCase()||isOverride)){
      actionBtn=`<button onclick="fmsOpenInstallUpdate(${o.id})" class="fms-action-btn success" style="font-size:0.75rem;padding:0.3rem 0.8rem;white-space:nowrap;">🔧 Update</button>`;
    }

    // Edit + Delete for MIS/Owner
    const editDeleteBtns = isOverride ? `
      <div style="display:flex;gap:4px;margin-top:4px;">
        <button onclick="event.stopPropagation();fmsEditOrder(${o.id})" style="flex:1;padding:2px 6px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:0.7rem;cursor:pointer;font-family:inherit;" title="Edit Order">✏️</button>
        <button onclick="event.stopPropagation();fmsDeleteOrder(${o.id})" style="flex:1;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,92,124,0.3);background:transparent;color:#ff5c7c;font-size:0.7rem;cursor:pointer;font-family:inherit;" title="Delete Order">🗑️</button>
      </div>` : '';

    // Update Payment button — CRM can update their own orders' payment
    const canUpdatePayment = myEmail === (o.created_by||'').toLowerCase().trim();
    const updatePaymentBtn = canUpdatePayment ? `
      <div style="margin-top:4px;">
        <button onclick="event.stopPropagation();fmsOpenUpdatePayment(${o.id})" style="width:100%;padding:2px 6px;border-radius:6px;border:1px solid rgba(0,212,170,0.35);background:rgba(0,212,170,0.08);color:#00d4aa;font-size:0.7rem;cursor:pointer;font-family:inherit;" title="Update Payment">💰 Payment</button>
      </div>` : '';

    return `<tr onclick="fmsOpenTimeline(${o.id})" style="cursor:pointer;">
      <td style="padding:0.28rem 0.75rem;border-left:3px solid transparent;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-weight:700;color:var(--accent);font-size:0.82rem;">${o.so_number||'—'}</span>
          ${o.payment_proof_url ? fmsProofLinks(o.payment_proof_url, 'font-size:0.85rem;') : ''}
        </div>
        <div style="font-size:0.65rem;color:var(--muted);">${created} · <strong>${o.quantity||0}</strong> units</div>
      </td>
      <td style="padding:0.28rem 0.75rem;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-weight:600;font-size:0.82rem;color:var(--text);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${o.client_name||'—'}</span>
          ${o.client_type==='nbd'?`<span style="font-size:0.58rem;font-weight:700;background:rgba(240,165,0,0.15);color:#f0a500;border:1px solid rgba(240,165,0,0.3);border-radius:20px;padding:1px 5px;flex-shrink:0;">NBD</span>`:''}
        </div>
        <div style="font-size:0.65rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:115px;">${locName} · ${fmsEmpName(o.assigned_to_support)}</div>
      </td>
      ${pipeline.join('')}
      <td style="padding:0.28rem 0.5rem;text-align:center;vertical-align:middle;border-left:1px solid var(--border2);" onclick="event.stopPropagation()">
        ${actionBtn}
        ${editDeleteBtns}
        ${updatePaymentBtn}
      </td>
    </tr>`;
  }).join('');

  // Pagination
  const pag = document.getElementById('fmsPagination');
  const pageInfo = document.getElementById('fmsPageInfo');
  const pageBtns = document.getElementById('fmsPageBtns');
  pag.style.display = totalPages > 1 ? 'flex' : 'none';
  if(pageInfo) pageInfo.textContent = `Showing ${start+1}–${Math.min(start+FMS_PER_PAGE,total)} of ${total}`;
  if(pageBtns){
    pageBtns.innerHTML='';
    for(let i=1;i<=totalPages;i++){
      const btn=document.createElement('button');
      btn.textContent=i;
      btn.style.cssText=`padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:${i===_fmsPage?'var(--accent)':'transparent'};color:${i===_fmsPage?'#000':'var(--muted)'};cursor:pointer;font-size:0.82rem;`;
      btn.onclick=()=>{_fmsPage=i;fmsRenderTable();};
      pageBtns.appendChild(btn);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmsStatusLabel(status){
  const map = {
    pending_support:  ['🟡','Awaiting Support','pending-support'],
    pending_config:   ['🟠','Awaiting Config','pending-config'],
    configuring:      ['🔵','Configuring','configuring'],
    pending_engineer: ['🟣','Awaiting Engineer','pending-engineer'],
    installing:       ['🔵','Installing','installing'],
    completed:        ['🟢','Completed','completed'],
  };
  const [icon, label, cls] = map[status] || ['⚪','Unknown',''];
  return `<span class="fms-status ${cls}">${icon} ${label}</span>`;
}

function fmsProductNames(ids, itemsJson){
  // Try product_items JSON first (has name + qty)
  if(itemsJson){
    try{
      const items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
      if(items && items.length){
        return items.map(i => `${i.product_name||_fmsProducts.find(p=>p.id===i.product_id)?.product_name||i.product_id} ×${i.quantity}`).join(', ');
      }
    } catch(e){}
  }
  // Fallback to ids array
  if(!ids || !ids.length) return '—';
  return ids.map(id => _fmsProducts.find(p=>p.id===id)?.product_name || id).join(', ');
}

function fmsTatStr(from, to){
  if(!from || !to) return '';
  const diff = new Date(to) - new Date(from);
  const hrs = Math.floor(diff/3600000);
  const mins = Math.floor((diff%3600000)/60000);
  if(hrs >= 24) return `${Math.floor(hrs/24)}d ${hrs%24}h`;
  if(hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── NEW ORDER FORM ─────────────────────────────────────────────────────────

// ── Product Row helpers ────────────────────────────────────────────────────
function fmsAddProductRow(){
  const container = document.getElementById('fmsProductRows');
  if(!container) return;
  const rowIdx = container.children.length;
  const row = document.createElement('div');
  row.className = 'fms-product-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;';
  row.innerHTML = `
    <select class="fms-form-input fms-product-select" style="flex:2;">
      <option value="">Select product...</option>
      ${_fmsProducts.map(p => `<option value="${p.id}">${p.product_name}</option>`).join('')}
    </select>
    <input type="number" class="fms-form-input fms-product-qty" placeholder="Qty" min="1" style="flex:0.7;max-width:90px;" value="1">
    <button type="button" onclick="this.closest('.fms-product-row').remove()" style="padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,92,124,0.4);background:rgba(255,92,124,0.1);color:#ff5c7c;cursor:pointer;font-size:0.9rem;flex-shrink:0;">✕</button>
  `;
  container.appendChild(row);
}

function fmsGetProductItems(){
  const rows = document.querySelectorAll('.fms-product-row');
  return [...rows].map(row => ({
    product_id: parseInt(row.querySelector('.fms-product-select')?.value)||null,
    product_name: row.querySelector('.fms-product-select')?.selectedOptions[0]?.text || '',
    quantity: parseInt(row.querySelector('.fms-product-qty')?.value)||1
  })).filter(r => r.product_id);
}

// ── Draft autosave — prevents New Order form data loss when switching browser tabs ──
const FMS_DRAFT_KEY = 'fmsNewOrderDraft_v1';
let _fmsDraftSaveTimer = null;
let _fmsDraftListenersAttached = false;

function fmsSaveDraft(){
  try{
    if(!document.getElementById('fmsNewOrderOverlay')?.classList.contains('open')) return;
    const draft = {
      clientType:     document.querySelector('input[name="fmsClientType"]:checked')?.value || '',
      clientSearch:   document.getElementById('fmsClientSearch')?.value || '',
      soNumber:       document.getElementById('fmsSoNumber')?.value || '',
      ticketNo:       document.getElementById('fmsTicketNo')?.value || '',
      orderAmount:    document.getElementById('fmsOrderAmount')?.value || '',
      amountReceived: document.getElementById('fmsAmountReceived')?.value || '',
      tentativeDate:  document.getElementById('fmsTentativeDate')?.value || '',
      locationId:     document.getElementById('fmsLocationSelect')?.value || '',
      locationManual: document.getElementById('fmsLocationManual')?.value || '',
      assignSupport:  document.getElementById('fmsAssignSupport')?.value || '',
      products:       typeof fmsGetProductItems === 'function' ? fmsGetProductItems() : [],
      savedAt:        Date.now()
    };
    localStorage.setItem(FMS_DRAFT_KEY, JSON.stringify(draft));
  } catch(e){}
}

function fmsScheduleDraftSave(){
  clearTimeout(_fmsDraftSaveTimer);
  _fmsDraftSaveTimer = setTimeout(fmsSaveDraft, 600);
}

function fmsClearDraft(){
  try{ localStorage.removeItem(FMS_DRAFT_KEY); } catch(e){}
}

function fmsRestoreDraftIfAny(){
  let draft = null;
  try{ draft = JSON.parse(localStorage.getItem(FMS_DRAFT_KEY) || 'null'); } catch(e){}
  if(!draft) return;
  // Drafts older than 24 hours are stale — discard
  if(!draft.savedAt || (Date.now() - draft.savedAt) > 24*60*60*1000){ fmsClearDraft(); return; }
  if(!draft.clientSearch && !draft.soNumber && !(draft.products||[]).length) return; // nothing meaningful saved

  if(document.getElementById('fmsClientSearch')) document.getElementById('fmsClientSearch').value = draft.clientSearch || '';
  if(document.getElementById('fmsSoNumber')) document.getElementById('fmsSoNumber').value = draft.soNumber || '';
  if(document.getElementById('fmsTicketNo')) document.getElementById('fmsTicketNo').value = draft.ticketNo || '';
  if(document.getElementById('fmsOrderAmount')) document.getElementById('fmsOrderAmount').value = draft.orderAmount || '';
  if(document.getElementById('fmsAmountReceived')) document.getElementById('fmsAmountReceived').value = draft.amountReceived || '';
  if(document.getElementById('fmsTentativeDate')) document.getElementById('fmsTentativeDate').value = draft.tentativeDate || '';
  if(draft.clientType) fmsSetClientType(draft.clientType);
  if(draft.locationId){
    const locSel = document.getElementById('fmsLocationSelect');
    if(locSel){ locSel.value = draft.locationId; fmsLocationSelectChange(); }
    if(draft.locationManual && document.getElementById('fmsLocationManual')) document.getElementById('fmsLocationManual').value = draft.locationManual;
  }
  if(draft.assignSupport && document.getElementById('fmsAssignSupport')) document.getElementById('fmsAssignSupport').value = draft.assignSupport;
  if(draft.products && draft.products.length){
    const container = document.getElementById('fmsProductRows');
    if(container){
      container.innerHTML = '';
      draft.products.forEach(item => {
        fmsAddProductRow();
        const rows = container.querySelectorAll('.fms-product-row');
        const lastRow = rows[rows.length-1];
        const sel = lastRow.querySelector('.fms-product-select');
        const qty = lastRow.querySelector('.fms-product-qty');
        if(sel) sel.value = item.product_id;
        if(qty) qty.value = item.quantity;
      });
    }
  }
  fmsToast('📝 Restored your unsaved draft from earlier');
}

function fmsAttachDraftListeners(){
  if(_fmsDraftListenersAttached) return;
  const box = document.querySelector('#fmsNewOrderOverlay .fms-overlay-box');
  if(!box) return;
  box.addEventListener('input', fmsScheduleDraftSave);
  box.addEventListener('change', fmsScheduleDraftSave);
  _fmsDraftListenersAttached = true;
}

async function fmsOpenNewOrder(isEdit){
  // Init product rows — start with 1 row
  const rowsContainer = document.getElementById('fmsProductRows');
  if(rowsContainer){
    rowsContainer.innerHTML = '';
    fmsAddProductRow();
  }

  // Populate location dropdown — all active locations + Other
  const locSelect = document.getElementById('fmsLocationSelect');
  if(locSelect){
    locSelect.innerHTML = '<option value="">Select location...</option>' +
      _fmsLocations.map(l => `<option value="${l.id}">${l.location_name}</option>`).join('') +
      '<option value="other">Other</option>';
  }

  // Load support persons
  await fmsLoadSupportPersons('fmsAssignSupport');

  // Reset form
  ['fmsClientSearch','fmsSoNumber','fmsTicketNo','fmsQuantity','fmsOrderAmount','fmsAmountReceived'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('fmsClientSearch').value = '';
  document.getElementById('fmsClientId').value = '';
  // Reset client type — default Existing, but auto-NBD for users who only handle New Business (e.g. Ronak Sir)
  const _fmsNBDDefaultUsers = ['salesmumbai@adititracking.com'];
  const _fmsCurrentEmail = (CURRENT_USER?.email || '').toLowerCase().trim();
  fmsSetClientType(_fmsNBDDefaultUsers.includes(_fmsCurrentEmail) ? 'nbd' : 'existing');
  if(locSelect) locSelect.value = '';
  const locManualReset = document.getElementById('fmsLocationManual');
  if(locManualReset){ locManualReset.value = ''; locManualReset.style.display = 'none'; }
  document.getElementById('fmsProofStatus').textContent = '';
  // Reset file input
  const proofInput = document.getElementById('fmsPaymentProof');
  if(proofInput) proofInput.value = '';
  _fmsProofFiles = [];
  const proofList = document.getElementById('fmsProofFileList');
  if(proofList) proofList.innerHTML = '';
  _fmsSelectedLocation = null;

  document.getElementById('fmsNewOrderOverlay').classList.add('open');
  fmsAttachDraftListeners();
  // Only restore a saved draft when opening a fresh "New Order" form (not while editing an existing order)
  if(!isEdit) fmsRestoreDraftIfAny();
}

function fmsCloseNewOrder(){
  document.getElementById('fmsNewOrderOverlay').classList.remove('open');
  fmsClearDraft();
}

function fmsLocationSelectChange(){
  const sel = document.getElementById('fmsLocationSelect');
  const manual = document.getElementById('fmsLocationManual');
  if(!sel || !sel.value){ _fmsSelectedLocation = null; if(manual) manual.style.display = 'none'; return; }
  _fmsSelectedLocation = { id: sel.value, name: sel.options[sel.selectedIndex].textContent };
  if(manual) manual.style.display = sel.value === 'other' ? 'block' : 'none';
}

function fmsToggleNewClient(checked){
  const search = document.getElementById('fmsClientSearch');
  if(search){
    search.placeholder = checked ? 'Enter new client name...' : 'Search existing client...';
    search.oninput = checked ? null : (e => fmsSearchClient(e.target.value));
  }
  if(checked){
    document.getElementById('fmsClientId').value = '';
    document.getElementById('fmsClientDropdown').style.display = 'none';
  }
}

async function fmsSearchClient(q){
  if(!q || q.length < 2){
    document.getElementById('fmsClientDropdown').style.display = 'none';
    return;
  }
  clearTimeout(_fmsClientSearchTimeout);
  _fmsClientSearchTimeout = setTimeout(async () => {
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/customer_odoo_aliases?odoo_name=ilike.%25${encodeURIComponent(q)}%25&order=odoo_name&limit=15`, { headers: SB_HDRS() });
      const data = await res.json();
      const dd = document.getElementById('fmsClientDropdown');
      if(!data.length){ dd.style.display = 'none'; return; }
      dd.innerHTML = data.map(c =>
        `<div onclick="fmsSelectClient(${c.id},'${(c.odoo_name||'').replace(/'/g,"\'")}',this)" style="padding:9px 14px;cursor:pointer;font-size:0.88rem;color:var(--text);border-bottom:1px solid var(--border);transition:background 0.15s;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">${c.odoo_name}</div>`
      ).join('');
      dd.style.display = 'block';
    } catch(e){}
  }, 300);
}

function fmsSelectClient(id, name, el){
  document.getElementById('fmsClientId').value = id;
  document.getElementById('fmsClientSearch').value = name;
  document.getElementById('fmsClientDropdown').style.display = 'none';
}

async function fmsLoadSupportPersons(selectId){
  try{
    // Employee_Dept = 'Support' waale employees fetch karo
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?Employee_Dept=eq.Support&select=Employee_name,Email_Id&order=Employee_name`,
      { headers: SB_HDRS() }
    );
    const rows = await res.json();
    const sel = document.getElementById(selectId);
    if(!sel) return;
    sel.innerHTML = '<option value="">Select support person...</option>';
    rows.forEach(emp => {
      if(!emp.Email_Id) return;
      const opt = document.createElement('option');
      opt.value = (emp.Email_Id||'').toLowerCase().trim();
      opt.textContent = emp.Employee_name || emp.Email_Id;
      sel.appendChild(opt);
    });
  } catch(e){ console.error('Load support persons error:', e); }
}

async function fmsLoadEngineers(selectId){
  try{
    // Employee_Dept = 'Service Engineer' waale fetch karo
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?Employee_Dept=eq.Service%20Engineer&select=Employee_name,Email_Id&order=Employee_name`,
      { headers: SB_HDRS() }
    );
    const rows = await res.json();
    const sel = document.getElementById(selectId);
    if(!sel) return;
    sel.innerHTML = '<option value="">Select engineer...</option>';
    rows.forEach(r => {
      if(!r.Email_Id) return;
      const opt = document.createElement('option');
      opt.value = (r.Email_Id||'').toLowerCase().trim();
      opt.textContent = r.Employee_name || r.Email_Id;
      sel.appendChild(opt);
    });
    // Extra non-employee options — Outsource / Self Installed by Client
    const optOutsource = document.createElement('option');
    optOutsource.value = 'outsource';
    optOutsource.textContent = 'Outsource';
    sel.appendChild(optOutsource);
    const optSelfInstalled = document.createElement('option');
    optSelfInstalled.value = 'self_installed';
    optSelfInstalled.textContent = 'Self Installed by Client';
    sel.appendChild(optSelfInstalled);
  } catch(e){ console.error('Load engineers error:', e); }
}

let _fmsSubmitting = false;
async function fmsSubmitNewOrder(){
  if(_fmsSubmitting){ fmsToast('⏳ Please wait...'); return; }
  const _submitBtn = document.querySelector('#fmsNewOrderOverlay button[onclick="fmsSubmitNewOrder()"]');
  fmsBtnLoading(_submitBtn, '⏳ Submitting...');
  _fmsSubmitting = true;

  const isNewClient = false; // Simplified — just name entry
  const clientSearch = document.getElementById('fmsClientSearch').value.trim();
  const clientId   = document.getElementById('fmsClientId').value;
  const soNumber   = document.getElementById('fmsSoNumber').value.trim();
  const ticketNo   = document.getElementById('fmsTicketNo').value.trim();
  // Auto-calculate total quantity from product rows
  const _allProductItems = fmsGetProductItems();
  const quantity = _allProductItems.reduce((sum, r) => sum + (r.quantity||0), 0);
  const orderAmt   = parseFloat(document.getElementById('fmsOrderAmount').value) || null;
  const amtRcvd    = parseFloat(document.getElementById('fmsAmountReceived').value) || null;
  const tentDate   = document.getElementById('fmsTentativeDate').value || null;
  const assignTo   = document.getElementById('fmsAssignSupport').value;
  const locManual  = document.getElementById('fmsLocationManual').value.trim();

  // Product items already calculated above
  const productItems = _allProductItems;
  const productIds = productItems.map(i => i.product_id);

  // Validate
  if(!clientSearch){ fmsToast('❌ Client name required'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(!soNumber){ fmsToast('❌ SO Number required'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(!quantity || quantity < 1){ fmsToast('❌ Add at least one product with quantity'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(!productItems.length){ fmsToast('❌ Add at least one product'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(!_fmsSelectedLocation){ fmsToast('❌ Select a location'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(_fmsSelectedLocation.id === 'other' && !locManual){ fmsToast('❌ Enter location name'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }
  if(!assignTo){ fmsToast('❌ Assign to support person'); fmsBtnReset(_submitBtn); _fmsSubmitting=false; return; }

  // Upload payment proof if any
  const proofUrls = await fmsUploadAllProofs('fmsProofStatus');
  const proofUrl = proofUrls.length > 0 ? JSON.stringify(proofUrls) : null;

  const now = new Date().toISOString();
  const myEmail = CURRENT_USER?.email || '';

  // Simple client name — no dropdown logic
  let finalClientId = clientId ? parseInt(clientId) : null;
  let finalClientName = clientSearch;

  const orderPayload = {
    client_id:          finalClientId,
    client_name:        finalClientName,
    is_new_client:      isNewClient,
    client_type:        (document.querySelector('input[name="fmsClientType"]:checked')?.value || 'existing'),
    so_number:          soNumber,
    ticket_no:          ticketNo || null,
    product_ids:        productIds,
    product_items:      JSON.stringify(productItems.map(i => ({product_id:i.product_id, product_name:i.product_name, quantity:i.quantity}))),
    quantity:           quantity,
    order_amount:       orderAmt,
    amount_received:    amtRcvd,
    payment_proof_url:  proofUrl,
    tentative_date:     tentDate,
    location_type:      _fmsSelectedLocation.id === 'other' ? 'outside' : 'local',
    location_id:        _fmsSelectedLocation.id !== 'other' ? parseInt(_fmsSelectedLocation.id) : null,
    location_manual:    _fmsSelectedLocation.id === 'other' ? locManual : null,
    status:             'pending_support',
    current_step:       1,
    created_by:         myEmail,
    assigned_to_support: assignTo,
    step1_completed_at: now,
    step2_started_at:   now,
  };

  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_orders`, {
      method: 'POST',
      headers: { ...SB_HDRS_JSON(), 'Prefer': 'return=representation' },
      body: JSON.stringify(orderPayload)
    });

    if(!res.ok){
      const errText = await res.text();
      console.error('Order insert error:', errText);
      // Agar product_items column nahi hai toh without it retry karo
      if(errText.includes('product_items')){
        delete orderPayload.product_items;
        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/fms_orders`, {
          method: 'POST',
          headers: { ...SB_HDRS_JSON(), 'Prefer': 'return=representation' },
          body: JSON.stringify(orderPayload)
        });
        if(!res2.ok){
          const e2 = await res2.text();
          fmsToast('❌ Error: ' + e2.slice(0,120));
          fmsBtnReset(_submitBtn);
          _fmsSubmitting = false;
          return;
        }
        const newOrder2 = await res2.json();
        const orderId2 = newOrder2[0]?.id;
        if(orderId2){
          await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
            method: 'POST',
            headers: SB_HDRS_JSON(),
            body: JSON.stringify({ order_id: orderId2, step: 1, assigned_from: myEmail, assigned_to: assignTo, assigned_at: now })
          });
        }
        fmsClearDraft();
        fmsToast('✅ Order created! (Run ALTER TABLE to enable product details)');
        fmsBtnSuccess(_submitBtn, '✅ Submitted!', 'fmsNewOrderOverlay');
        setTimeout(() => { fmsLoadOrders(); _fmsSubmitting = false; }, 950);
        return;
      }
      fmsToast('❌ Error: ' + errText.slice(0,120));
      fmsBtnReset(_submitBtn);
      _fmsSubmitting = false;
      return;
    }

    const newOrder = await res.json();
    const orderId = newOrder[0]?.id;

    if(orderId){
      // Insert assignment record
      await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
        method: 'POST',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ order_id: orderId, step: 1, assigned_from: myEmail, assigned_to: assignTo, assigned_at: now })
      });
    }

    fmsClearDraft();
    fmsToast('✅ Order created successfully!');
    fmsBtnSuccess(_submitBtn, '✅ Submitted!', 'fmsNewOrderOverlay');
    setTimeout(() => { fmsLoadOrders(); _fmsSubmitting = false; }, 950);
  } catch(e){
    console.error('Submit order error:', e);
    fmsToast('❌ Error: ' + e.message);
    fmsBtnReset(_submitBtn);
    _fmsSubmitting = false;
  }
}

// ── Proof file state ──────────────────────────────────────────────────────
let _fmsProofFiles = [];      // array of File objects — new order
let _fmsUpdateProofFile = null;

// Handle multiple proof files — new order form
function fmsHandleProofFiles(fileList){
  if(!fileList || !fileList.length) return;
  const newFiles = Array.from(fileList);
  newFiles.forEach(file => {
    if(!_fmsProofFiles.find(f => f.name === file.name)){
      _fmsProofFiles.push(file);
    }
  });
  fmsRenderProofPreviews();
}

// Legacy single-file handler (Ctrl+V paste still calls this)
function fmsHandleProofFile(file){
  if(file) fmsHandleProofFiles([file]);
}

function fmsRenderProofPreviews(){
  const list = document.getElementById('fmsProofFileList');
  if(!list) return;
  list.innerHTML = '';
  _fmsProofFiles.forEach((file, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg);';
    if(file.type.startsWith('image/')){
      const img = document.createElement('img');
      img.style.cssText = 'width:80px;height:80px;object-fit:cover;display:block;';
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.readAsDataURL(file);
      wrap.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.style.cssText = 'width:80px;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:1.6rem;';
      icon.innerHTML = '📄<span style="font-size:0.6rem;color:var(--muted);text-align:center;padding:0 4px;word-break:break-all;">' + file.name.slice(0,12) + '</span>';
      wrap.appendChild(icon);
    }
    const rmBtn = document.createElement('button');
    rmBtn.innerHTML = '✕';
    rmBtn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.65);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:0.6rem;display:flex;align-items:center;justify-content:center;padding:0;';
    rmBtn.onclick = () => { _fmsProofFiles.splice(idx, 1); fmsRenderProofPreviews(); };
    wrap.appendChild(rmBtn);
    const sizeLabel = document.createElement('div');
    sizeLabel.style.cssText = 'font-size:0.58rem;color:var(--muted);text-align:center;padding:2px 4px;border-top:1px solid var(--border);background:var(--surface2);';
    sizeLabel.textContent = (file.size/1024).toFixed(0) + ' KB';
    wrap.appendChild(sizeLabel);
    list.appendChild(wrap);
  });
  const status = document.getElementById('fmsProofStatus');
  if(status) status.textContent = _fmsProofFiles.length > 0 ? `${_fmsProofFiles.length} file${_fmsProofFiles.length>1?'s':''} selected` : '';
}

function fmsClearProof(){
  _fmsProofFiles = [];
  document.getElementById('fmsPaymentProof').value = '';
  const list = document.getElementById('fmsProofFileList');
  if(list) list.innerHTML = '';
  document.getElementById('fmsProofStatus').textContent = '';
}

// Handle proof file — update payment modal
function fmsHandleUpdateProofFile(file){
  if(!file) return;
  _fmsUpdateProofFile = file;
  const preview = document.getElementById('fmsUpdateProofPreview');
  const previewImg = document.getElementById('fmsUpdateProofPreviewImg');
  const fileName = document.getElementById('fmsUpdateProofFileName');
  if(preview && previewImg){
    if(file.type.startsWith('image/')){
      const reader = new FileReader();
      reader.onload = e => { previewImg.src = e.target.result; previewImg.style.display='block'; preview.style.display='block'; };
      reader.readAsDataURL(file);
    } else {
      previewImg.style.display = 'none';
      preview.style.display = 'block';
    }
    if(fileName) fileName.textContent = `📄 ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
  }
}

function fmsClearUpdateProof(){
  _fmsUpdateProofFile = null;
  document.getElementById('fmsUpdateProofFile').value = '';
  document.getElementById('fmsUpdateProofPreview').style.display = 'none';
  document.getElementById('fmsUpdateProofStatus').textContent = '';
  _fmsUpdateProofFile = null;
  const upp = document.getElementById('fmsUpdateProofPreview');
  if(upp) upp.style.display = 'none';
}

// ── Global Ctrl+V paste listener ──────────────────────────────────────────
document.addEventListener('paste', function(e){
  const newOrderOpen   = document.getElementById('fmsNewOrderOverlay')?.classList.contains('open');
  const updatePmtOpen  = document.getElementById('fmsUpdatePaymentOverlay')?.classList.contains('open');
  if(!newOrderOpen && !updatePmtOpen) return;

  const items = e.clipboardData?.items;
  if(!items) return;
  for(let item of items){
    if(item.type.startsWith('image/')){
      const file = item.getAsFile();
      if(!file) continue;
      // Convert to named file
      const namedFile = new File([file], `screenshot_${Date.now()}.png`, { type: 'image/png' });
      if(newOrderOpen){
        fmsHandleProofFiles([namedFile]);
        fmsToast('📋 Screenshot pasted!');
      } else if(updatePmtOpen){
        fmsHandleUpdateProofFile(namedFile);
        fmsToast('📋 Screenshot pasted!');
      }
      e.preventDefault();
      break;
    }
  }
});

async function fmsUploadProof(file){
  try{
    const ext = file.name.split('.').pop().toLowerCase();
    const safeName = Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    const path = `fms-proofs/${safeName}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/fms-documents/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_currentToken || SUPABASE_ANON}`,
        'Content-Type': file.type,
        'x-upsert': 'true'
      },
      body: file
    });
    if(res.ok) return `${SUPABASE_URL}/storage/v1/object/public/fms-documents/${path}`;
    const err = await res.text();
    console.error('Upload error:', err);
    return null;
  } catch(e){
    console.error('Upload error:', e);
    return null;
  }
}

async function fmsUploadAllProofs(statusElId='fmsProofStatus'){
  if(!_fmsProofFiles.length) return [];
  const statusEl = document.getElementById(statusElId);
  if(statusEl) statusEl.textContent = `⏳ Uploading ${_fmsProofFiles.length} file(s)...`;
  const urls = [];
  for(let i = 0; i < _fmsProofFiles.length; i++){
    const file = _fmsProofFiles[i];
    if(statusEl) statusEl.textContent = `⏳ Uploading file ${i+1}/${_fmsProofFiles.length}...`;
    const url = await fmsUploadProof(file);
    if(url) urls.push(url);
  }
  if(statusEl && urls.length > 0) statusEl.textContent = `✅ ${urls.length} file(s) uploaded`;
  return urls;
}

// ── SUPPORT OVERLAY (Step 2) ───────────────────────────────────────────────
async function fmsOpenSupportOverlay(orderId){
  _fmsCurrentOrder = _fmsOrders.find(o => o.id === orderId);
  if(!_fmsCurrentOrder) return;
  const o = _fmsCurrentOrder;
  const locName = o.location_type === 'outside' ? (o.location_manual||'Outside') : (_fmsLocations.find(l=>l.id===o.location_id)?.location_name||'—');

  const pendingAmt = (parseFloat(o.order_amount)||0) - (parseFloat(o.amount_received)||0);
  document.getElementById('fmsSupportOrderInfo').innerHTML = `
    <div><strong>SO:</strong> ${o.so_number} &nbsp;|&nbsp; <strong>Ticket:</strong> ${o.ticket_no||'—'}</div>
    <div><strong>Client:</strong> ${o.client_name||'—'}</div>
    <div><strong>Products:</strong> ${fmsProductNames(o.product_ids, o.product_items)}</div>
    <div><strong>Qty:</strong> ${o.quantity} &nbsp;|&nbsp; <strong>Location:</strong> ${locName}</div>
    <div><strong>Order Amt:</strong> ₹${o.order_amount||0} &nbsp;|&nbsp; <strong>Received:</strong> ₹${o.amount_received||0} &nbsp;|&nbsp; <strong style="color:${pendingAmt>0?'#ff5c7c':'#00d4aa'}">Pending: ₹${pendingAmt}</strong></div>
    ${o.tentative_date ? `<div><strong>Payment Due:</strong> <span style="color:#f0a500;">${new Date(o.tentative_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div>` : ''}
    ${o.payment_proof_url ? `<div>${fmsProofLinks(o.payment_proof_url)}</div>` : ''}
  `;
  document.getElementById('fmsSupportNotes').value = '';
  document.getElementById('fmsSupportEngineerRow').style.display = 'none';
  const _fmsCfgPersonRow = document.getElementById('fmsSupportConfigPersonRow');
  if(_fmsCfgPersonRow) _fmsCfgPersonRow.style.display = 'block';
  const _fmsCfgPersonSel = document.getElementById('fmsSupportConfigPerson');
  if(_fmsCfgPersonSel) _fmsCfgPersonSel.value = FMS_ANISH_EMAIL;
  document.getElementById('fmsSupportSubmitBtn').textContent = '➡️ Send for Configuration';
  document.getElementById('fmsSupportSubmitBtn').style.background = '#fb923c';
  // Reset radio to "Yes - Config required"
  const radios = document.querySelectorAll('input[name="fmsCfgRequired"]');
  if(radios[0]) radios[0].checked = true;
  document.getElementById('fmsSupportOverlay').classList.add('open');
}

function fmsCloseSupportOverlay(){
  document.getElementById('fmsSupportOverlay').classList.remove('open');
}


// ── FMS Toast — standalone (doesn't depend on showToast) ─────────────────
function fmsToast(msg, duration=3200){
  // Try global showToast first
  if(typeof showToast === 'function'){ showToast(msg); return; }
  // Fallback: create our own toast
  const existing = document.getElementById('_fmsToast');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.id = '_fmsToast';
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:12px;padding:11px 22px;font-size:0.88rem;font-weight:600;z-index:9999;transition:opacity 0.4s;opacity:0;pointer-events:none;white-space:nowrap;';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = '1');
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, duration);
}

// ── Button loading state helper ───────────────────────────────────────────
function fmsBtnLoading(btn, text='⏳ Please wait...'){
  if(!btn) return;
  btn._origText = btn.textContent;
  btn._origBg   = btn.style.background;
  btn.disabled  = true;
  btn.textContent = text;
  btn.style.opacity = '0.7';
}
function fmsBtnSuccess(btn, text='✅ Done!', overlayId=null){
  if(!btn) return;
  btn.style.background = '#00d4aa';
  btn.style.color = '#000';
  btn.style.opacity = '1';
  btn.textContent = text;
  setTimeout(() => {
    if(overlayId) document.getElementById(overlayId)?.classList.remove('open');
    btn.disabled = false;
    btn.style.background = btn._origBg || '';
    btn.style.opacity = '1';
    btn.textContent = btn._origText || text;
  }, 900);
}
function fmsBtnReset(btn){
  if(!btn) return;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.textContent = btn._origText || 'Submit';
}

// Toggle config required in support overlay
async function fmsSupportToggleCfg(cfgRequired){
  const engRow   = document.getElementById('fmsSupportEngineerRow');
  const cfgPersonRow = document.getElementById('fmsSupportConfigPersonRow');
  const notesLbl = document.getElementById('fmsSupportNotesLabel');
  const submitBtn = document.getElementById('fmsSupportSubmitBtn');
  if(cfgRequired){
    engRow.style.display = 'none';
    if(cfgPersonRow) cfgPersonRow.style.display = 'block';
    notesLbl.textContent = 'Notes for Configuration Team (Optional)';
    submitBtn.textContent = '➡️ Send for Configuration';
    submitBtn.style.background = '#fb923c';
  } else {
    engRow.style.display = 'block';
    if(cfgPersonRow) cfgPersonRow.style.display = 'none';
    notesLbl.textContent = 'Notes (Optional)';
    submitBtn.textContent = '👷 Assign Directly to Engineer';
    submitBtn.style.background = '#a855f7';
    // Default Devices to Install = order quantity, Devices Pending = 0
    const totalQty = _fmsCurrentOrder?.quantity || 0;
    const installQtyEl = document.getElementById('fmsSupportInstallQty');
    const pendingQtyEl = document.getElementById('fmsSupportPendingQty');
    if(installQtyEl) installQtyEl.value = totalQty;
    if(pendingQtyEl) pendingQtyEl.value = 0;
    // Load engineers if not already loaded
    await fmsLoadEngineers('fmsSupportEngineerSelect');
  }
}

async function fmsSupportSubmit(){
  if(!_fmsCurrentOrder) return;
  const cfgRequired = document.querySelector('input[name="fmsCfgRequired"]:checked')?.value === 'yes';
  const btn = document.getElementById('fmsSupportSubmitBtn');
  fmsBtnLoading(btn, '⏳ Assigning...');
  const notes   = document.getElementById('fmsSupportNotes').value.trim();
  const myEmail = CURRENT_USER?.email || '';
  const now     = new Date().toISOString();

  try{
    if(cfgRequired){
      // ── Send to selected config person (Anish or Kush) ──
      const configPersonEmail = document.getElementById('fmsSupportConfigPerson')?.value || FMS_ANISH_EMAIL;
      await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ status: 'pending_config', current_step: 2, step2_completed_at: now, step3_started_at: now })
      });
      await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
        method: 'POST',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ order_id: _fmsCurrentOrder.id, step: 2, assigned_from: myEmail, assigned_to: configPersonEmail, notes, assigned_at: now })
      });
      fmsToast(`✅ Sent to ${fmsEmpName(configPersonEmail)} for configuration!`);
    } else {
      // ── Direct to Engineer — skip config step ──
      const engineerEmail = document.getElementById('fmsSupportEngineerSelect').value;
      const installed     = parseInt(document.getElementById('fmsSupportInstallQty').value) || 0;
      const pending       = parseInt(document.getElementById('fmsSupportPendingQty').value) || 0;
      if(!engineerEmail){ fmsBtnReset(btn); fmsToast('❌ Select an engineer'); return; }

      // Update order — skip to installing
      await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ status: 'installing', current_step: 4, step2_completed_at: now, step4_completed_at: now, step5_started_at: now })
      });
      // Insert installation record
      const isCompleted = installed >= (_fmsCurrentOrder.quantity||0) && installed > 0;
      await fetch(`${SUPABASE_URL}/rest/v1/fms_installation`, {
        method: 'POST',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ order_id: _fmsCurrentOrder.id, engineer_email: engineerEmail, devices_installed: installed, devices_pending: pending, is_completed: isCompleted, completed_at: isCompleted ? now : null, updated_by: myEmail, assigned_at: now })
      });
      // Assignment record
      await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
        method: 'POST',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ order_id: _fmsCurrentOrder.id, step: 2, assigned_from: myEmail, assigned_to: engineerEmail, notes: 'Direct assignment (no config required)', assigned_at: now })
      });
      fmsToast('👷 Assigned directly to engineer!');
    }
    fmsBtnSuccess(btn, '✅ Done!', 'fmsSupportOverlay');
    setTimeout(() => fmsLoadOrders(), 950);
  } catch(e){
    fmsBtnReset(btn);
    fmsToast('❌ Error: ' + e.message);
  }
}

// Legacy — keep for compatibility
async function fmsAssignToAnish(){
  fmsSupportSubmit();
}

// ── ANISH CONFIG OVERLAY (Step 3) ─────────────────────────────────────────
async function fmsOpenConfigOverlay(orderId){
  _fmsCurrentOrder = _fmsOrders.find(o => o.id === orderId);
  if(!_fmsCurrentOrder) return;
  const o = _fmsCurrentOrder;
  const totalQty = parseInt(o.quantity) || 0;

  document.getElementById('fmsConfigOrderInfo').innerHTML = `
    <div><strong>SO:</strong> ${o.so_number} &nbsp;|&nbsp; <strong>Client:</strong> ${o.client_name||'—'}</div>
    <div><strong>Products:</strong> ${fmsProductNames(o.product_ids, o.product_items)}</div>
    <div><strong>Total Devices to Configure:</strong> <span style="color:#f0a500;font-weight:700;">${totalQty}</span></div>
  `;

  // Set max on configured qty
  const cfgInput = document.getElementById('fmsConfiguredQty');
  cfgInput.max = totalQty;
  cfgInput.value = '';
  document.getElementById('fmsCfgMax').textContent = totalQty;
  document.getElementById('fmsNotConfiguredQty').value = totalQty;
  document.getElementById('fmsConfigNotes').value = '';
  document.getElementById('fmsSkipReason').value = '';

  // Load existing config if any (Anish can update partial config)
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_configuration?order_id=eq.${o.id}&order=configured_at.desc&limit=1`, { headers: SB_HDRS() });
    const rows = await res.json();
    if(rows[0]){
      cfgInput.value = rows[0].configured_qty || 0;
      document.getElementById('fmsConfigNotes').value = rows[0].config_notes || '';
      document.getElementById('fmsSkipReason').value = rows[0].skip_reason || '';
      fmsCfgAutoCalc();
    } else {
      fmsCfgAutoCalc();
    }
  } catch(e){ fmsCfgAutoCalc(); }

  document.getElementById('fmsConfigOverlay').classList.add('open');
}

function fmsCloseConfigOverlay(){
  document.getElementById('fmsConfigOverlay').classList.remove('open');
}

// Auto calculate not-configured + progress bar
function fmsCfgAutoCalc(){
  const total = parseInt(_fmsCurrentOrder?.quantity) || 0;
  let cfgVal = parseInt(document.getElementById('fmsConfiguredQty').value) || 0;

  // Cap at total
  if(cfgVal > total){ cfgVal = total; document.getElementById('fmsConfiguredQty').value = total; }
  if(cfgVal < 0){ cfgVal = 0; document.getElementById('fmsConfiguredQty').value = 0; }

  const notCfg = total - cfgVal;
  document.getElementById('fmsNotConfiguredQty').value = notCfg;

  // Progress bar
  const pct = total > 0 ? Math.round((cfgVal / total) * 100) : 0;
  document.getElementById('fmsCfgProgressBar').style.width = pct + '%';
  document.getElementById('fmsCfgProgressText').textContent = `${cfgVal} / ${total} configured`;
  document.getElementById('fmsCfgProgressBar').style.background = pct === 100 ? '#00d4aa' : pct > 50 ? '#4e9af1' : '#fb923c';
}

async function fmsSubmitConfig(){
  if(!_fmsCurrentOrder) return;
  const cfgBtnStart = document.querySelector('#fmsConfigOverlay button[onclick="fmsSubmitConfig()"]');
  const totalQty   = parseInt(_fmsCurrentOrder.quantity) || 0;
  const configQty  = parseInt(document.getElementById('fmsConfiguredQty').value) || 0;
  const notCfgQty  = parseInt(document.getElementById('fmsNotConfiguredQty').value) || 0;
  const notes      = document.getElementById('fmsConfigNotes').value.trim();
  const skipReason = document.getElementById('fmsSkipReason').value.trim();
  const myEmail    = CURRENT_USER?.email || '';
  const now        = new Date().toISOString();

  // No restriction — Anish can configure any number freely
  const isSkipped = configQty === 0; // All skipped if 0 configured
  fmsBtnLoading(cfgBtnStart, '⏳ Saving...');

  try{
    // Insert config record
    await fetch(`${SUPABASE_URL}/rest/v1/fms_configuration`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({
        order_id: _fmsCurrentOrder.id,
        configured_qty: configQty,
        not_configured_qty: notCfgQty,
        config_notes: notes || null,
        is_skipped: isSkipped,
        skip_reason: skipReason || null,
        configured_by: myEmail,
        received_at: _fmsCurrentOrder.step3_started_at || now,
        configured_at: now
      })
    });

    // Update order — go back to support person
    await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
      method: 'PATCH',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ status: 'pending_engineer', current_step: 3, step3_completed_at: now, step4_started_at: now })
    });

    // Insert assignment back to support
    await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ order_id: _fmsCurrentOrder.id, step: 3, assigned_from: myEmail, assigned_to: _fmsCurrentOrder.assigned_to_support || '', notes: isSkipped ? `Skipped: ${skipReason}` : notes, assigned_at: now })
    });

    fmsToast(isSkipped ? '⏭️ Skipped — sent back to support!' : '✅ Configuration saved!');
    const cfgBtn = document.querySelector('#fmsConfigOverlay button[onclick="fmsSubmitConfig()"]');
    fmsBtnSuccess(cfgBtn, '✅ Done!', 'fmsConfigOverlay');
    setTimeout(() => fmsLoadOrders(), 950);
  } catch(e){
    const cfgBtn = document.querySelector('#fmsConfigOverlay button[onclick="fmsSubmitConfig()"]');
    fmsBtnReset(cfgBtn);
    fmsToast('❌ Error: ' + e.message);
  }
}

// ── ENGINEER ASSIGN OVERLAY (Step 4) ──────────────────────────────────────
async function fmsOpenEngineerOverlay(orderId){
  _fmsCurrentOrder = _fmsOrders.find(o => o.id === orderId);
  if(!_fmsCurrentOrder) return;
  const o = _fmsCurrentOrder;

  document.getElementById('fmsEngineerOrderInfo').innerHTML = `
    <div><strong>SO:</strong> ${o.so_number} &nbsp;|&nbsp; <strong>Client:</strong> ${o.client_name||'—'}</div>
    <div><strong>Products:</strong> ${fmsProductNames(o.product_ids, o.product_items)}</div>
    <div><strong>Total Qty:</strong> <span style="color:#a855f7;font-weight:700;">${o.quantity}</span></div>
  `;
  const engTotal = parseInt(o.quantity) || 0;
  document.getElementById('fmsDevicesInstalled').value = '';
  document.getElementById('fmsDevicesInstalled').max = engTotal;
  document.getElementById('fmsDevicesPending').value = engTotal;
  document.getElementById('fmsEngMax').textContent = engTotal;
  document.getElementById('fmsInstallNotes').value = '';
  await fmsLoadEngineers('fmsEngineerSelect');
  document.getElementById('fmsEngineerOverlay').classList.add('open');
}

function fmsCloseEngineerOverlay(){
  document.getElementById('fmsEngineerOverlay').classList.remove('open');
}

async function fmsSubmitEngineerAssign(){
  if(!_fmsCurrentOrder) return;
  const engBtnStart = document.querySelector('#fmsEngineerOverlay button[onclick="fmsSubmitEngineerAssign()"]');
  fmsBtnLoading(engBtnStart, '⏳ Assigning...');
  const engineerEmail = document.getElementById('fmsEngineerSelect').value;
  const installed = parseInt(document.getElementById('fmsDevicesInstalled').value) || 0;
  const totalQtyEng = parseInt(_fmsCurrentOrder?.quantity) || 0;
  const pending = totalQtyEng - installed;
  const notes         = document.getElementById('fmsInstallNotes').value.trim();
  const myEmail       = CURRENT_USER?.email || '';
  const now           = new Date().toISOString();

  if(!engineerEmail){ fmsToast('❌ Select an engineer'); return; }

  const isCompleted = installed >= (_fmsCurrentOrder.quantity || 0) && installed > 0;

  try{
    // Insert installation record
    await fetch(`${SUPABASE_URL}/rest/v1/fms_installation`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({
        order_id: _fmsCurrentOrder.id,
        engineer_email: engineerEmail,
        devices_installed: installed,
        devices_pending: pending,
        installation_notes: notes || null,
        is_completed: isCompleted,
        completed_at: isCompleted ? now : null,
        updated_by: myEmail,
        assigned_at: now
      })
    });

    // Update order
    const newStatus = isCompleted ? 'completed' : 'installing';
    await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
      method: 'PATCH',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({
        status: newStatus,
        current_step: 4,
        step4_completed_at: now,
        step5_started_at: now,
        ...(isCompleted ? { step5_completed_at: now } : {})
      })
    });

    // Insert assignment
    await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ order_id: _fmsCurrentOrder.id, step: 4, assigned_from: myEmail, assigned_to: engineerEmail, assigned_at: now })
    });

    fmsToast(isCompleted ? '🎉 Order completed!' : '✅ Engineer assigned!');
    const engBtn = document.querySelector('#fmsEngineerOverlay button[onclick="fmsSubmitEngineerAssign()"]');
    fmsBtnSuccess(engBtn, isCompleted ? '🎉 Completed!' : '✅ Assigned!', 'fmsEngineerOverlay');
    setTimeout(() => fmsLoadOrders(), 950);
  } catch(e){
    const engBtn = document.querySelector('#fmsEngineerOverlay button[onclick="fmsSubmitEngineerAssign()"]');
    fmsBtnReset(engBtn);
    fmsToast('❌ Error: ' + e.message);
  }
}

// ── INSTALLATION UPDATE (Step 5) ───────────────────────────────────────────
async function fmsOpenInstallUpdate(orderId){
  _fmsCurrentOrder = _fmsOrders.find(o => o.id === orderId);
  if(!_fmsCurrentOrder) return;
  const o = _fmsCurrentOrder;

  // Load existing installation record
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_installation?order_id=eq.${o.id}&order=created_at.desc&limit=1`, { headers: SB_HDRS() });
    const rows = await res.json();
    const inst = rows[0] || {};
    document.getElementById('fmsUpdateInstalled').value = inst.devices_installed || '';
    document.getElementById('fmsUpdatePending').value   = inst.devices_pending || '';
    document.getElementById('fmsUpdateNotes').value     = '';
  } catch(e){}

  const totalQty = parseInt(o.quantity) || 0;
  document.getElementById('fmsInstallUpdateInfo').innerHTML = `
    <div><strong>SO:</strong> ${o.so_number} &nbsp;|&nbsp; <strong>Client:</strong> ${o.client_name||'—'}</div>
    <div><strong>Total Qty Required:</strong> <span style="color:#06b6d4;font-weight:700;">${totalQty}</span></div>
  `;

  // Set max
  document.getElementById('fmsUpdateInstalled').max = totalQty;
  document.getElementById('fmsInstMax').textContent = totalQty;
  document.getElementById('fmsInstProgressText').textContent = `0 / ${totalQty}`;
  document.getElementById('fmsInstProgressBar').style.width = '0%';
  document.getElementById('fmsCompleteWarning').style.display = 'none';
  document.getElementById('fmsInstallUpdateOverlay').classList.add('open');
}

function fmsInstAutoCalc(){
  const total = parseInt(_fmsCurrentOrder?.quantity) || 0;
  let installed = parseInt(document.getElementById('fmsUpdateInstalled').value) || 0;
  if(installed > total){ installed = total; document.getElementById('fmsUpdateInstalled').value = total; }
  if(installed < 0){ installed = 0; document.getElementById('fmsUpdateInstalled').value = 0; }
  const pending = total - installed;
  document.getElementById('fmsUpdatePending').value = pending;
  // Progress
  const pct = total > 0 ? Math.round((installed/total)*100) : 0;
  document.getElementById('fmsInstProgressBar').style.width = pct + '%';
  document.getElementById('fmsInstProgressText').textContent = `${installed} / ${total} installed`;
  document.getElementById('fmsInstProgressBar').style.background = pct===100 ? '#00d4aa' : pct>50 ? '#06b6d4' : '#fb923c';
  document.getElementById('fmsCompleteWarning').style.display = (installed > 0 && installed >= total) ? 'block' : 'none';
}

function fmsEngAutoCalc(){
  const total = parseInt(_fmsCurrentOrder?.quantity) || 0;
  let installed = parseInt(document.getElementById('fmsDevicesInstalled').value) || 0;
  if(installed > total){ installed = total; document.getElementById('fmsDevicesInstalled').value = total; }
  if(installed < 0){ installed = 0; document.getElementById('fmsDevicesInstalled').value = 0; }
  document.getElementById('fmsDevicesPending').value = total - installed;
}

function fmsCheckInstallComplete(){
  fmsInstAutoCalc(); // Keep for compatibility
}

function fmsCloseInstallUpdateOverlay(){
  document.getElementById('fmsInstallUpdateOverlay').classList.remove('open');
}

async function fmsSubmitInstallUpdate(){
  if(!_fmsCurrentOrder) return;
  const instBtnStart = document.querySelector('#fmsInstallUpdateOverlay button[onclick="fmsSubmitInstallUpdate()"]');
  fmsBtnLoading(instBtnStart, '⏳ Updating...');
  const installed = parseInt(document.getElementById('fmsUpdateInstalled').value) || 0;
  const totalQtyInst = parseInt(_fmsCurrentOrder?.quantity) || 0;
  const pending = totalQtyInst - installed;
  const notes     = document.getElementById('fmsUpdateNotes').value.trim();
  const myEmail   = CURRENT_USER?.email || '';
  const now       = new Date().toISOString();
  const isCompleted = installed >= (_fmsCurrentOrder.quantity || 0) && installed > 0;

  try{
    // Update installation record
    const instRes = await fetch(`${SUPABASE_URL}/rest/v1/fms_installation?order_id=eq.${_fmsCurrentOrder.id}&order=created_at.desc&limit=1`, { headers: SB_HDRS() });
    const instRows = await instRes.json();

    if(instRows[0]){
      await fetch(`${SUPABASE_URL}/rest/v1/fms_installation?id=eq.${instRows[0].id}`, {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({
          devices_installed: installed,
          devices_pending: pending,
          installation_notes: notes || null,
          is_completed: isCompleted,
          completed_at: isCompleted ? now : null,
          updated_by: myEmail
        })
      });
    }

    // Update order if complete
    if(isCompleted){
      await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
        method: 'PATCH',
        headers: SB_HDRS_JSON(),
        body: JSON.stringify({ status: 'completed', current_step: 5, step5_completed_at: now })
      });
    }

    fmsToast(isCompleted ? '🎉 Order marked as Completed!' : '✅ Installation updated!');
    const instBtn = document.querySelector('#fmsInstallUpdateOverlay button[onclick="fmsSubmitInstallUpdate()"]');
    fmsBtnSuccess(instBtn, isCompleted ? '🎉 Completed!' : '✅ Updated!', 'fmsInstallUpdateOverlay');
    setTimeout(() => fmsLoadOrders(), 950);
  } catch(e){
    const instBtn = document.querySelector('#fmsInstallUpdateOverlay button[onclick="fmsSubmitInstallUpdate()"]');
    fmsBtnReset(instBtn);
    fmsToast('❌ Error: ' + e.message);
  }
}

// ── TIMELINE (Read-only detail view) ──────────────────────────────────────
async function fmsOpenTimeline(orderId){
  const o = _fmsOrders.find(x => x.id === orderId);
  if(!o) return;

  document.getElementById('fmsTimelineTitle').innerHTML = `
    📋 Order: <span style="color:var(--accent);">${o.so_number}</span> &nbsp; ${fmsStatusLabel(o.status)}
  `;

  // Edit/Delete — MIS/Owner only
  const tlActions = document.getElementById('fmsTimelineActions');
  const _isMISOwner = CURRENT_USER?.rawRole==='mis' || CURRENT_USER?.rawRole==='managing director';
  const _myEmailLower = (CURRENT_USER?.email||'').toLowerCase().trim();
  const _isOrderCreator = _myEmailLower === (o.created_by||'').toLowerCase().trim();

  if(tlActions){
    let btns = '';
    // Payment update — CRM/order creator can update
    if(_isOrderCreator || _isMISOwner){
      btns += `<button onclick="fmsCloseTimeline();fmsOpenUpdatePayment(${orderId})" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(0,212,170,0.4);background:rgba(0,212,170,0.08);color:#00d4aa;font-size:0.82rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;">💰 Payment</button>`;
    }
    // Edit/Delete — MIS/Owner only
    if(_isMISOwner){
      btns += `<button onclick="fmsEditOrder(${orderId})" style="padding:5px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:0.82rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;">✏️ Edit</button>`;
      btns += `<button onclick="fmsDeleteOrder(${orderId})" style="padding:5px 12px;border-radius:8px;border:1px solid rgba(255,92,124,0.4);background:rgba(255,92,124,0.08);color:#ff5c7c;font-size:0.82rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;">🗑️ Delete</button>`;
    }
    tlActions.innerHTML = btns;
  }

  // Load data
  const [assignRes, configRes, installRes, notesRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/fms_assignments?order_id=eq.${orderId}&order=assigned_at`, { headers: SB_HDRS() }),
    fetch(`${SUPABASE_URL}/rest/v1/fms_configuration?order_id=eq.${orderId}&order=configured_at.desc&limit=1`, { headers: SB_HDRS() }),
    fetch(`${SUPABASE_URL}/rest/v1/fms_installation?order_id=eq.${orderId}&order=created_at.desc&limit=1`, { headers: SB_HDRS() }),
    fetch(`${SUPABASE_URL}/rest/v1/fms_order_notes?order_id=eq.${orderId}&order=created_at.asc`, { headers: SB_HDRS() }).catch(()=>null),
  ]);
  const assignments = await assignRes.json();
  const config  = (await configRes.json())[0] || null;
  const install = (await installRes.json())[0] || null;
  const orderNotes = notesRes && notesRes.ok ? await notesRes.json() : [];

  // ── Notes access — default: anyone involved in THIS order (creator, assigned support,
  //    config person, engineer) can add a note; they can delete only their OWN notes.
  //    MIS/PC remain full admins.
  const _fmsNotesAdmin = CURRENT_USER?.rawRole==='mis' || CURRENT_USER?.rawRole==='pc';
  const _fmsInvolvedEmails = new Set();
  const _fmsAddInvolved = e => { if(e) _fmsInvolvedEmails.add(String(e).toLowerCase().trim()); };
  _fmsAddInvolved(o.created_by);
  _fmsAddInvolved(o.assigned_to_support);
  (assignments||[]).forEach(a => { _fmsAddInvolved(a.assigned_from); _fmsAddInvolved(a.assigned_to); });
  if(install) _fmsAddInvolved(install.engineer_email);
  const _fmsIsInvolved = _fmsInvolvedEmails.has(_myEmailLower);
  const _canAddNote = _fmsNotesAdmin || _fmsIsInvolved;
  const _canDeleteNote = (noteCreatedBy) => _fmsNotesAdmin || ((noteCreatedBy||'').toLowerCase().trim() === _myEmailLower);

  const step   = o.current_step || 1;
  const fmtDt  = dt => dt ? new Date(dt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : null;
  const fmtDate= dt => dt ? new Date(dt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const locName = o.location_type==='outside' ? (o.location_manual||'Outside') : (_fmsLocations.find(l=>l.id===o.location_id)?.location_name||'—');
  const pendAmt = (parseFloat(o.order_amount)||0) - (parseFloat(o.amount_received)||0);

  // ── STEP DATA ──
  const stepDefs = [
    {
      icon:'🗒️', label:'Order Created',     color:'#f0a500',
      state: step>=1?'done':'active',
      tat: null,
      time: fmtDt(o.step1_completed_at||o.created_at),
      info: `By ${fmsEmpName(o.created_by)} → ${fmsEmpName(o.assigned_to_support)}`
    },
    {
      icon:'🔧', label:'Support Assign',     color:'#fb923c',
      state: step>=2?'done':step===1?'active':'pending',
      tat: fmsTatStr(o.step1_completed_at, o.step2_completed_at),
      time: fmtDt(o.step2_completed_at),
      info: step>=2 ? `To: ${fmsEmpName(assignments.find(a=>a.step===2)?.assigned_to || FMS_ANISH_EMAIL)}` : '⏳ Pending'
    },
    {
      icon:'💾', label:'Configuration',      color:'#4e9af1',
      state: step>=3?'done':step===2?'active':'pending',
      tat: fmsTatStr(o.step3_started_at, o.step3_completed_at),
      time: fmtDt(config?.configured_at),
      info: config ? (config.is_skipped ? `Skipped — ${config.skip_reason||''}` : `✓ ${config.configured_qty} done, ${config.not_configured_qty} pending`) : '⏳ Pending'
    },
    {
      icon:'🔩', label:'Installation',       color:'#a855f7',
      state: step>=4?'done':step===3?'active':'pending',
      tat: fmsTatStr(o.step4_started_at, o.step4_completed_at),
      time: fmtDt(install?.assigned_at),
      info: install ? `Eng: ${fmsEmpName(install.engineer_email)} · ${install.devices_installed}/${o.quantity} installed` : '⏳ Pending'
    },
    {
      icon:'🏁', label:'Completed',          color:'#00d4aa',
      state: o.status==='completed'?'done':step>=4?'active':'pending',
      tat: fmsTatStr(o.step5_started_at, o.step5_completed_at),
      time: fmtDt(o.step5_completed_at),
      info: o.status==='completed' ? '🎉 Order Completed' : '⏳ Pending'
    },
  ];

  // ── HORIZONTAL PIPELINE with TAT on line ──
  let pipeHtml = '<div style="display:flex;align-items:flex-start;width:100%;padding:0.5rem 0;">';
  stepDefs.forEach((s, i) => {
    const isDone   = s.state==='done';
    const isActive = s.state==='active';
    const color    = s.color;

    let circleBg = isDone ? `linear-gradient(135deg,${color}99,${color}dd)` : isActive ? 'var(--surface)' : 'var(--surface2)';
    let circleBdr = isDone||isActive ? color : 'rgba(130,130,150,0.3)';
    let circleOp  = isDone||isActive ? '1' : '0.4';
    let glow      = isActive ? `box-shadow:0 0 0 3px ${color}22;` : '';
    let checkmark = isDone ? `<div style="position:absolute;top:-2px;right:-2px;width:13px;height:13px;border-radius:50%;background:#22c55e;border:1.5px solid var(--surface);display:flex;align-items:center;justify-content:center;font-size:0.45rem;color:#fff;font-weight:900;">✓</div>` : '';

    // Step cell — NO TAT here
    pipeHtml += `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;min-width:80px;">
      <div style="position:relative;width:36px;height:36px;border-radius:50%;background:${circleBg};border:2px solid ${circleBdr};display:flex;align-items:center;justify-content:center;font-size:0.9rem;opacity:${circleOp};${glow}">
        ${s.icon}${checkmark}
      </div>
      <div style="font-size:0.62rem;font-weight:700;color:${isDone?color:isActive?color:'var(--muted)'};text-align:center;margin-top:2px;">${s.label}</div>
      <div style="font-size:0.58rem;color:var(--muted);text-align:center;line-height:1.3;">${s.time||''}</div>
      <div style="font-size:0.58rem;color:${isDone?color+'cc':isActive?color+'99':'var(--muted)'};text-align:center;line-height:1.3;max-width:80px;">${s.info}</div>
    </div>`;

    // Connector line (TAT now shown in the orders table row instead, not here)
    if(i < stepDefs.length - 1){
      const lineColor = isDone ? s.color : 'rgba(140,140,160,0.18)';
      const lineOp    = isDone ? '0.9' : '1';
      pipeHtml += `<div style="flex:1;min-width:40px;margin-top:17px;">
        <div style="width:100%;height:2px;background:${lineColor};opacity:${lineOp};border-radius:1px;"></div>
      </div>`;
    }
  });
  pipeHtml += '</div>';

  document.getElementById('fmsTimelinePipeline').innerHTML = pipeHtml;

  // ── ORDER DATA — Odoo style: label left, value right ──
  const row = (label, value, valueStyle='') =>
    `<div style="display:flex;align-items:baseline;padding:0.38rem 0;border-bottom:1px solid var(--border2);">
      <span style="min-width:140px;font-size:0.78rem;color:var(--muted);font-weight:600;flex-shrink:0;">${label}</span>
      <span style="font-size:0.86rem;font-weight:600;color:var(--text);flex:1;${valueStyle}">${value}</span>
    </div>`;

  document.getElementById('fmsTimelineInfo').innerHTML = `
    <div>

      <!-- Section: Order Info -->
      <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.4rem;opacity:0.7;">Order Details</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0 0.9rem;margin-bottom:0.85rem;">
        ${row('Client', o.client_name||'—')}
        ${row('SO Number', o.so_number||'—', 'color:var(--accent);')}
        ${row('Ticket No', o.ticket_no||'—')}
        ${row('Location', locName)}
        ${row('Products', fmsProductNames(o.product_ids, o.product_items))}
        ${row('Total Quantity', `<span style="color:var(--accent);font-size:1rem;font-weight:700;">${o.quantity||'—'}</span> units`)}
        ${row('Created By', fmsEmpName(o.created_by))}
        ${row('Assigned To', fmsEmpName(o.assigned_to_support))}
      </div>

      <!-- Section: Payment Info -->
      <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.4rem;opacity:0.7;">Payment Details</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0 0.9rem;margin-bottom:0.5rem;">
        ${row('Order Amount', `₹${(o.order_amount||0).toLocaleString('en-IN')}`)}
        ${row('Amount Received', `₹${(o.amount_received||0).toLocaleString('en-IN')}`, 'color:#00d4aa;')}
        ${row('Pending Amount', `₹${pendAmt.toLocaleString('en-IN')}`, `color:${pendAmt>0?'#ff5c7c':'#00d4aa'};`)}
        ${o.tentative_date ? row('Payment Due Date', fmtDate(o.tentative_date), 'color:#f0a500;') : ''}
        ${o.payment_proof_url ? `<div style="display:flex;align-items:baseline;padding:0.38rem 0;border-bottom:1px solid var(--border2);">
          <span style="min-width:140px;font-size:0.78rem;color:var(--muted);font-weight:600;flex-shrink:0;">Payment Proof</span>
          <span style="display:flex;gap:8px;flex-wrap:wrap;">${fmsProofLinks(o.payment_proof_url, 'font-size:0.84rem;font-weight:600;')}</span>
        </div>` : ''}
      </div>

    </div>
  `;

  // ── Notes panel — right column, starts from top — add/delete restricted to MIS & PC ──
  document.getElementById('fmsTimelineNotesPanel').innerHTML = `
    <div style="font-size:0.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.5rem;opacity:0.7;">📝 Notes</div>
    <div id="fmsTimelineNotesList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:${orderNotes.length?'10px':'0'};">
      ${orderNotes.length ? orderNotes.map(n => `
        <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:0.6rem 0.75rem;display:flex;gap:8px;align-items:flex-start;justify-content:space-between;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.83rem;color:var(--text);white-space:pre-wrap;line-height:1.5;">${(n.note_text||'').replace(/</g,'&lt;')}</div>
            <div style="font-size:0.7rem;color:var(--muted);margin-top:4px;">${fmsEmpName(n.created_by)} · ${fmtDt(n.created_at)}</div>
          </div>
          ${_canDeleteNote(n.created_by) ? `<button onclick="fmsDeleteOrderNote(${n.id},${o.id},'${(n.created_by||'').replace(/'/g,"\\'")}')" title="Delete note" style="flex-shrink:0;background:transparent;border:none;color:var(--muted);font-size:0.9rem;cursor:pointer;padding:2px 4px;">🗑️</button>` : ''}
        </div>
      `).join('') : '<div style="font-size:0.8rem;color:var(--muted);">No notes yet' + (_canAddNote ? ' — add one below to explain a delay or share an update.' : '.') + '</div>'}
    </div>
    ${_canAddNote ? `
    <textarea id="fmsTimelineNoteInput" class="fms-form-input" rows="3" placeholder="e.g. Delayed due to client unavailable on site, rescheduled to..." style="width:100%;box-sizing:border-box;"></textarea>
    <button onclick="fmsAddOrderNote(${o.id})" style="margin-top:8px;padding:6px 16px;border-radius:8px;border:none;background:var(--accent);color:#000;font-size:0.83rem;font-weight:700;cursor:pointer;font-family:inherit;">➕ Add Note</button>
    ` : ''}
  `;

  // Auto-scroll Notes column to the bottom so the latest note is in view (chat-style)
  const _fmsNotesPanelEl = document.getElementById('fmsTimelineNotesPanel');
  if(_fmsNotesPanelEl) _fmsNotesPanelEl.scrollTop = _fmsNotesPanelEl.scrollHeight;

  document.getElementById('fmsTimelineOverlay').classList.add('open');
}

function fmsCloseTimeline(){
  document.getElementById('fmsTimelineOverlay').classList.remove('open');
}

// ── Notes access — default: anyone INVOLVED in a sale order (creator, support,
//    config person, engineer) can add a note to it; MIS/PC are always admins. ──
function fmsNotesIsAdmin(){
  const role = CURRENT_USER?.rawRole;
  return role === 'mis' || role === 'pc';
}

async function fmsIsInvolvedInOrder(orderId){
  const o = _fmsOrders.find(x => x.id === orderId);
  if(!o) return false;
  const myEmail = (CURRENT_USER?.email || '').toLowerCase().trim();
  if(!myEmail) return false;
  const involved = new Set();
  const addE = e => { if(e) involved.add(String(e).toLowerCase().trim()); };
  addE(o.created_by);
  addE(o.assigned_to_support);
  try{
    const [assignRes, installRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/fms_assignments?order_id=eq.${orderId}&select=assigned_from,assigned_to`, { headers: SB_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/fms_installation?order_id=eq.${orderId}&order=created_at.desc&limit=1`, { headers: SB_HDRS() }),
    ]);
    const assignments = await assignRes.json().catch(()=>[]);
    const install = (await installRes.json().catch(()=>[]))[0] || null;
    (assignments||[]).forEach(a => { addE(a.assigned_from); addE(a.assigned_to); });
    if(install) addE(install.engineer_email);
  } catch(e){}
  return involved.has(myEmail);
}

// ── Add a note to an order — default: only people involved in THAT order ───
async function fmsAddOrderNote(orderId){
  const input = document.getElementById('fmsTimelineNoteInput');
  const noteText = input?.value.trim();
  if(!noteText){ fmsToast('❌ Write something before adding a note'); return; }
  const myEmail = CURRENT_USER?.email || '';
  const btn = document.querySelector(`#fmsTimelineOverlay button[onclick="fmsAddOrderNote(${orderId})"]`);
  if(!fmsNotesIsAdmin()){
    const involved = await fmsIsInvolvedInOrder(orderId);
    if(!involved){ fmsToast('❌ Only people involved in this order can add notes'); return; }
  }
  fmsBtnLoading(btn, '⏳ Saving...');
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_order_notes`, {
      method: 'POST',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({ order_id: orderId, note_text: noteText, created_by: myEmail, created_at: new Date().toISOString() })
    });
    if(!res.ok){
      const errText = await res.text();
      fmsToast('❌ Error: ' + errText.slice(0,120));
      fmsBtnReset(btn);
      return;
    }
    if(input) input.value = '';
    fmsToast('✅ Note added!');
    await fmsOpenTimeline(orderId); // re-render with new note included
  } catch(e){
    fmsToast('❌ Error: ' + e.message);
    fmsBtnReset(btn);
  }
}

// ── Delete a note — default: only the person who wrote it (MIS/PC can delete any) ──
async function fmsDeleteOrderNote(noteId, orderId, noteCreatedBy){
  const myEmail = (CURRENT_USER?.email || '').toLowerCase().trim();
  const isOwner = (noteCreatedBy || '').toLowerCase().trim() === myEmail;
  if(!fmsNotesIsAdmin() && !isOwner){ fmsToast('❌ You can only delete your own notes'); return; }
  if(!confirm('Delete this note? This cannot be undone.')) return;
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_order_notes?id=eq.${noteId}`, {
      method: 'DELETE',
      headers: SB_HDRS()
    });
    if(!res.ok){
      const errText = await res.text();
      fmsToast('❌ Error: ' + errText.slice(0,120));
      return;
    }
    fmsToast('🗑️ Note deleted');
    await fmsOpenTimeline(orderId); // re-render without deleted note
  } catch(e){
    fmsToast('❌ Error: ' + e.message);
  }
}

// ── Edit Order — reopen New Order form pre-filled ──────────────────────────
async function fmsEditOrder(orderId){
  const o = _fmsOrders.find(x => x.id === orderId);
  if(!o) return;

  // Close timeline first
  fmsCloseTimeline();

  // Open New Order form (isEdit=true skips draft restore)
  await fmsOpenNewOrder(true);

  // Pre-fill all fields
  setTimeout(() => {
    // Client
    document.getElementById('fmsClientSearch').value = o.client_name || '';
    document.getElementById('fmsClientId').value     = o.client_id || '';

    // Basic fields
    document.getElementById('fmsSoNumber').value          = o.so_number || '';
    document.getElementById('fmsTicketNo').value          = o.ticket_no || '';
    document.getElementById('fmsOrderAmount').value       = o.order_amount || '';
    document.getElementById('fmsAmountReceived').value    = o.amount_received || '';
    document.getElementById('fmsTentativeDate').value     = o.tentative_date || '';

    // Products — rebuild rows
    const container = document.getElementById('fmsProductRows');
    if(container && o.product_items){
      try{
        const items = JSON.parse(o.product_items);
        container.innerHTML = '';
        items.forEach(item => {
          fmsAddProductRow();
          const rows = container.querySelectorAll('.fms-product-row');
          const lastRow = rows[rows.length-1];
          const sel = lastRow.querySelector('.fms-product-select');
          const qty = lastRow.querySelector('.fms-product-qty');
          if(sel) sel.value = item.product_id;
          if(qty) qty.value = item.quantity;
        });
      } catch(e){}
    }

    // Location
    const locSel = document.getElementById('fmsLocationSelect');
    if(o.location_type === 'outside' && locSel){
      locSel.value = 'other';
      fmsLocationSelectChange();
      document.getElementById('fmsLocationManual').value = o.location_manual || '';
    } else if(o.location_id && locSel){
      locSel.value = String(o.location_id);
      fmsLocationSelectChange();
    }

    // Assign support
    document.getElementById('fmsAssignSupport').value = o.assigned_to_support || '';

    // Change submit button to UPDATE
    const submitBtn = document.querySelector('#fmsNewOrderOverlay button[onclick="fmsSubmitNewOrder()"]');
    if(submitBtn){
      submitBtn.textContent = '💾 Update Order';
      submitBtn.onclick = () => fmsUpdateOrder(orderId);
    }

    // Change title
    const title = document.querySelector('#fmsNewOrderOverlay div[style*="Playfair"]');
    if(title) title.innerHTML = '✏️ Edit Order — <span style="color:var(--accent);">' + (o.so_number||'') + '</span>';

  }, 200);
}

// ── Update Order (PATCH) ───────────────────────────────────────────────────
async function fmsUpdateOrder(orderId){
  const _submitBtn = document.querySelector('#fmsNewOrderOverlay button');
  fmsBtnLoading(_submitBtn, '⏳ Updating...');

  const clientSearch = document.getElementById('fmsClientSearch').value.trim();
  const clientId     = document.getElementById('fmsClientId').value;
  const soNumber     = document.getElementById('fmsSoNumber').value.trim();
  const ticketNo     = document.getElementById('fmsTicketNo').value.trim();
  const orderAmt     = parseFloat(document.getElementById('fmsOrderAmount').value) || null;
  const amtRcvd      = parseFloat(document.getElementById('fmsAmountReceived').value) || null;
  const tentDate     = document.getElementById('fmsTentativeDate').value || null;
  const assignTo     = document.getElementById('fmsAssignSupport').value;
  const locManual    = document.getElementById('fmsLocationManual').value.trim();

  const productItems = fmsGetProductItems();
  const productIds   = productItems.map(i => i.product_id);
  const quantity     = productItems.reduce((s,r) => s+(r.quantity||0), 0);

  if(!soNumber){ fmsToast('❌ SO Number required'); fmsBtnReset(_submitBtn); return; }
  if(!productItems.length){ fmsToast('❌ Add at least one product'); fmsBtnReset(_submitBtn); return; }
  if(!_fmsSelectedLocation){ fmsToast('❌ Select a location'); fmsBtnReset(_submitBtn); return; }
  if(_fmsSelectedLocation.id === 'other' && !locManual){ fmsToast('❌ Enter location name'); fmsBtnReset(_submitBtn); return; }

  const payload = {
    client_id:           clientId ? parseInt(clientId) : null,
    client_name:         clientSearch,
    so_number:           soNumber,
    ticket_no:           ticketNo || null,
    product_ids:         productIds,
    product_items:       JSON.stringify(productItems.map(i=>({product_id:i.product_id,product_name:i.product_name,quantity:i.quantity}))),
    quantity:            quantity,
    order_amount:        orderAmt,
    amount_received:     amtRcvd,
    tentative_date:      tentDate,
    location_type:       _fmsSelectedLocation.id==='other'?'outside':'local',
    location_id:         _fmsSelectedLocation.id!=='other'?parseInt(_fmsSelectedLocation.id):null,
    location_manual:     _fmsSelectedLocation.id==='other'?locManual:null,
    assigned_to_support: assignTo,
  };

  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify(payload)
    });
    if(!res.ok){ const e=await res.text(); throw new Error(e); }
    fmsToast('✅ Order updated!');
    fmsBtnSuccess(_submitBtn, '✅ Updated!', 'fmsNewOrderOverlay');
    setTimeout(() => { fmsLoadOrders(); _fmsSubmitting = false; }, 950);
  } catch(e){
    fmsToast('❌ Error: ' + e.message);
    fmsBtnReset(_submitBtn);
  }
}

// ── Delete Order ───────────────────────────────────────────────────────────
async function fmsDeleteOrder(orderId){
  const o = _fmsOrders.find(x => x.id === orderId);
  if(!o) return;

  // Confirm
  if(!confirm(`Delete order "${o.so_number}" for "${o.client_name}"?

This cannot be undone.`)) return;

  fmsCloseTimeline();

  try{
    // Delete related records first (CASCADE should handle it but being safe)
    await fetch(`${SUPABASE_URL}/rest/v1/fms_assignments?order_id=eq.${orderId}`,   { method:'DELETE', headers:SB_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/fms_configuration?order_id=eq.${orderId}`, { method:'DELETE', headers:SB_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/fms_installation?order_id=eq.${orderId}`,  { method:'DELETE', headers:SB_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/fms_order_notes?order_id=eq.${orderId}`,   { method:'DELETE', headers:SB_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${orderId}`,              { method:'DELETE', headers:SB_HDRS() });

    fmsToast('🗑️ Order deleted');
    fmsLoadOrders();
  } catch(e){
    fmsToast('❌ Delete failed: ' + e.message);
  }
}

// ── Parse proof URLs — supports old single URL + new JSON array ──────────
function fmsParseProofUrls(raw){
  if(!raw) return [];
  try{
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch(e){ return [raw]; }
}

function fmsProofLinks(raw, style=''){
  const urls = fmsParseProofUrls(raw);
  if(!urls.length) return '';
  return urls.map((url, i) =>
    `<a href="${url}" target="_blank" onclick="event.stopPropagation()" style="color:#4e9af1;text-decoration:none;${style}" title="View file ${i+1}">📎${urls.length>1?' '+(i+1):''}</a>`
  ).join(' ');
}

// ── fmsSetClientType — NBD vs Existing ───────────────────────────────────
function fmsSetClientType(type){
  document.querySelectorAll('input[name="fmsClientType"]').forEach(r => r.checked = r.value === type);
  const nbd  = document.getElementById('fmsNBDLabel');
  const exist = document.getElementById('fmsExistingLabel');
  const hint  = document.getElementById('fmsClientNameHint');
  const input = document.getElementById('fmsClientSearch');
  if(type === 'nbd'){
    if(nbd)  nbd.style.borderColor  = '#f0a500';
    if(exist) exist.style.borderColor = 'var(--border)';
    if(hint)  hint.textContent = '(New Business — type company name)';
    if(input) input.placeholder = 'Enter new client company name...';
  } else {
    if(nbd)  nbd.style.borderColor  = 'var(--border)';
    if(exist) exist.style.borderColor = '#4e9af1';
    if(hint)  hint.textContent = '(Odoo Name)';
    if(input) input.placeholder = 'Enter client name as in Odoo...';
  }
}

// ── fmsOpenUpdatePayment ──────────────────────────────────────────────────
function fmsOpenUpdatePayment(orderId){
  _fmsCurrentOrder = _fmsOrders.find(o => o.id === orderId);
  if(!_fmsCurrentOrder) return;
  const o = _fmsCurrentOrder;
  const pendAmt = (parseFloat(o.order_amount)||0) - (parseFloat(o.amount_received)||0);

  document.getElementById('fmsUpdatePaymentInfo').innerHTML = `
    <div><strong>SO:</strong> ${o.so_number} &nbsp;|&nbsp; <strong>Client:</strong> ${o.client_name||'—'}</div>
    <div><strong>Order Amt:</strong> ₹${(o.order_amount||0).toLocaleString('en-IN')} &nbsp;|&nbsp; <strong>Received:</strong> ₹${(o.amount_received||0).toLocaleString('en-IN')}</div>
  `;
  document.getElementById('fmsUpdateAmtReceived').value = o.amount_received || '';
  document.getElementById('fmsUpdateTentDate').value    = o.tentative_date || '';
  document.getElementById('fmsUpdateProofStatus').textContent = '';
  document.getElementById('fmsUpdateProofFile').value = '';
  document.getElementById('fmsUpdatePendingPreview').innerHTML =
    `Pending: <strong style="color:${pendAmt>0?'#ff5c7c':'#00d4aa'};">₹${pendAmt.toLocaleString('en-IN')}</strong>`;

  // Live pending preview on input
  document.getElementById('fmsUpdateAmtReceived').oninput = function(){
    const newReceived = parseFloat(this.value) || 0;
    const newPending  = (parseFloat(o.order_amount)||0) - newReceived;
    document.getElementById('fmsUpdatePendingPreview').innerHTML =
      `Pending after update: <strong style="color:${newPending>0?'#ff5c7c':'#00d4aa'};">₹${newPending.toLocaleString('en-IN')}</strong>`;
  };

  document.getElementById('fmsUpdatePaymentOverlay').classList.add('open');
}

function fmsCloseUpdatePayment(){
  document.getElementById('fmsUpdatePaymentOverlay').classList.remove('open');
}

async function fmsSubmitUpdatePayment(){
  if(!_fmsCurrentOrder) return;
  const btn = document.querySelector('#fmsUpdatePaymentOverlay button[onclick="fmsSubmitUpdatePayment()"]');
  fmsBtnLoading(btn, '⏳ Saving...');

  const amtReceived = parseFloat(document.getElementById('fmsUpdateAmtReceived').value) || 0;
  const tentDate    = document.getElementById('fmsUpdateTentDate').value || null;
  const proofFile   = _fmsUpdateProofFile || document.getElementById('fmsUpdateProofFile').files[0];

  // Upload proof if new file selected
  let proofUrl = _fmsCurrentOrder.payment_proof_url || null;
  if(proofFile){
    const ext = proofFile.name.split('.').pop().toLowerCase();
    const path = `fms-proofs/${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
    document.getElementById('fmsUpdateProofStatus').textContent = '⏳ Uploading...';
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/fms-documents/${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_currentToken || SUPABASE_ANON}`, 'Content-Type': proofFile.type, 'x-upsert': 'true' },
      body: proofFile
    });
    if(uploadRes.ok){
      proofUrl = `${SUPABASE_URL}/storage/v1/object/public/fms-documents/${path}`;
      document.getElementById('fmsUpdateProofStatus').innerHTML = `✅ Uploaded — <a href="${proofUrl}" target="_blank" style="color:#4e9af1;">View</a>`;
    }
  }

  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/fms_orders?id=eq.${_fmsCurrentOrder.id}`, {
      method: 'PATCH',
      headers: SB_HDRS_JSON(),
      body: JSON.stringify({
        amount_received:   amtReceived,
        tentative_date:    tentDate,
        payment_proof_url: proofUrl
      })
    });
    if(!res.ok) throw new Error(await res.text());
    fmsToast('✅ Payment updated!');
    fmsBtnSuccess(btn, '✅ Updated!', 'fmsUpdatePaymentOverlay');
    setTimeout(() => fmsLoadOrders(), 950);
  } catch(e){
    fmsBtnReset(btn);
    fmsToast('❌ Error: ' + e.message);
  }
}

// Close overlays on backdrop click
['fmsNewOrderOverlay','fmsSupportOverlay','fmsConfigOverlay','fmsEngineerOverlay','fmsInstallUpdateOverlay','fmsTimelineOverlay','fmsUpdatePaymentOverlay'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('click', function(e){ if(e.target === this) this.classList.remove('open'); });
});



