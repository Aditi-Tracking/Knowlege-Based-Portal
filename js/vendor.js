// Section: Vendor / Purchase Approval (loadVendorRequests, approve, pay, bulk-pay)

// ╔══════════════════════════════════════════════════════════════════════════
// ║  [VENDOR MODULE JS] — Purchase Approval System logic
// ║  Tables used: vendors, vendor_requests (Supabase)
// ║  Key roles:
// ║    _vrIsEA()       = Hetal Ma'am — approve/decline decisions
// ║    _vrIsAccounts() = Ashish Sir (vendor_pay permission) — mark paid
// ║    _vrCanViewAll() = MIS/owner — all requests dekh sakte hain
// ║  Key functions:
// ║    loadVendorRequests() = Dashboard data load karo
// ║    submitVendorRequest() = Naya purchase request submit karo
// ║    vrSaveDecision()    = EA approve/decline kare
// ║    vrMarkPaid()        = Accounts mark as paid kare
// ║    vrBulkPay()         = Multiple checked rows ek saath pay karo
// ║    vrDeleteRequest()   = Request delete karo
// ║  _vrAll = All requests array (local cache)
// ╚══════════════════════════════════════════════════════════════════════════
// ── STATE ──────────────────────────────────────────
let _vrAll=[], _vrFiltered=[], _vrFilterModes=new Set(), _vrCurId=null, _vrNameMap={}, _vrVendors=[], _vrLoaded=false, _vrRecurSourceId=null;
let _vrFilterVendor='', _vrFilterRequester='', _vrVendorFilterList=[], _vrRequesterFilterList=[];

// ── ROLE HELPERS ───────────────────────────────────
function _vrRole(){return(typeof CURRENT_USER!=='undefined'&&CURRENT_USER)?String(CURRENT_USER.rawRole||CURRENT_USER.role||'').toLowerCase().trim():'';}
function _vrCanViewAll(){if(typeof PERMISSIONS!=='undefined'&&PERMISSIONS&&PERMISSIONS.vendor_view_all==='true')return true;const r=_vrRole();return r==='owner'||r==='mis'||r==='executive assistant'||r==='ea';}
function _vrIsEA(){if(typeof PERMISSIONS!=='undefined'&&PERMISSIONS&&PERMISSIONS.vendor_review==='true')return true;const r=_vrRole();return r==='executive assistant'||r==='ea'||r==='owner'||r==='mis';}function _vrIsAccounts(){
  // Uses vendor_pay permission — set via Access Control panel for Ashish sir specifically
  // This is role-independent so any employee given this permission gets PAID button access
  if(typeof PERMISSIONS!=='undefined'&&PERMISSIONS&&PERMISSIONS.vendor_pay==='true')return true;
  // owner/mis always have pay access
  const r=_vrRole();return r==='owner'||r==='mis';
}
function _vrMyEmail(){return(typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.email)?String(CURRENT_USER.email).trim().toLowerCase():'';}

// ── LOAD ───────────────────────────────────────────
// ── LOAD ───────────────────────────────────────────
async function loadVendorRequests(force){
  if(_vrLoaded&&!force)return;
  _vrLoaded=true;
  const ldg=document.getElementById('vrLoading');
  const tw=document.getElementById('vrTableWrap');
  const em=document.getElementById('vrEmpty');
  if(ldg)ldg.style.display='block';
  if(tw)tw.style.display='none';
  if(em)em.style.display='none';
  document.getElementById('vrKpiRow').innerHTML='';
  try{
    const empRes=await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Email_Id,Employee_name`,{headers:SB_HDRS()});
    const empData=empRes.ok?await empRes.json():[];
    _vrNameMap={};
    (empData||[]).forEach(e=>{if(e.Email_Id)_vrNameMap[String(e.Email_Id).toLowerCase().trim()]=e.Employee_name||e.Email_Id;});
    await _vrLoadVendors();
    let url=`${SUPABASE_URL}/rest/v1/vendor_requests?select=*&order=created_at.desc`;
    if(!_vrCanViewAll())url+=`&submitted_by=eq.${encodeURIComponent(_vrMyEmail())}`;
    const vrRes=await fetch(url,{headers:SB_HDRS()});
    if(!vrRes.ok)throw new Error('HTTP '+vrRes.status);
    _vrAll=await vrRes.json();
    _vrBuildFilterOptions();
    _vrRenderKPIs();
    _vrLoadAmountKPIs();

    _vrApplyFilter();
  }catch(e){
    if(ldg)ldg.innerHTML=`<div style="color:#ef4444;font-size:0.84rem;">❌ ${e.message}</div>`;
    return;
  }
  if(ldg)ldg.style.display='none';
}

async function _vrLoadVendors(){
  const res=await fetch(`${SUPABASE_URL}/rest/v1/vendors?select=id,vendor_name&order=vendor_name.asc`,{headers:SB_HDRS()});
  _vrVendors=res.ok?await res.json():[];
  _vrPopulateVendorDropdown();
}
function _vrPopulateVendorDropdown(){
  const sel=document.getElementById('vfVendorSel');
  if(!sel)return;
  sel.innerHTML='<option value=""></option>';
  _vrVendors.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.vendor_name;o.dataset.name=v.vendor_name;sel.appendChild(o);});
}
function _vfVendorFilter(){
  const q=(document.getElementById('vfVendorSearch').value||'').toLowerCase();
  _vfVendorRenderList(q);
  document.getElementById('vfVendorDropdown').style.display='block';
}
function _vfVendorOpen(){
  const q=(document.getElementById('vfVendorSearch').value||'').toLowerCase();
  _vfVendorRenderList(q);
  document.getElementById('vfVendorDropdown').style.display='block';
}
function _vfVendorBlur(){setTimeout(()=>{document.getElementById('vfVendorDropdown').style.display='none';},180);}
function _vfVendorRenderList(q){
  const dd=document.getElementById('vfVendorDropdown');
  const filtered=q?_vrVendors.filter(v=>v.vendor_name.toLowerCase().includes(q)):_vrVendors;
  dd.innerHTML=filtered.slice(0,100).map(v=>`<div class="vf-vendor-option" onmousedown="_vfVendorSelect(${v.id},'${v.vendor_name.replace(/'/g,"\\'")}')">${v.vendor_name}</div>`).join('');
}
function _vfVendorSelect(id,name){
  document.getElementById('vfVendorSearch').value=name;
  document.getElementById('vfVendorSel').value=id;
  document.getElementById('vfVendorDropdown').style.display='none';
}

// ── KPIs ───────────────────────────────────────────
// KPIs are now computed from _vrFiltered so they update live with search/filters/row selection,
// instead of always reflecting the full unfiltered dataset.
function _vrRenderKPIs(){
  const rows=_vrFiltered;
  const kpis=[
    {label:'Total',val:rows.length,color:'#4e9af1',icon:'📋'},
    {label:'On Hold',val:rows.filter(r=>r.status==='On Hold').length,color:'#f59e0b',icon:'🔒'},
    {label:'Approved',val:rows.filter(r=>r.status==='Approved').length,color:'#22c55e',icon:'✅'},
    {label:'Paid',val:rows.filter(r=>r.payment_status==='Paid').length,color:'#a855f7',icon:'💳'},
  ];
document.getElementById('vrKpiRow').innerHTML=kpis.map(k=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 12px;border-left:4px solid ${k.color};box-shadow:var(--shadow);"><div style="font-size:0.95rem;margin-bottom:3px;">${k.icon}</div><div style="font-size:1.3rem;font-weight:900;color:${k.color};line-height:1;">${k.val}</div><div style="font-size:0.62rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px;">${k.label}</div></div>`).join('');}
async function _vrLoadAmountKPIs(){
  try{
    const rows=_vrFiltered;
    const sum=(list)=>list.reduce((s,r)=>s+(Number(r.amount)||0),0);
    const totalAmt=sum(rows);
    const approvedAmt=sum(rows.filter(r=>r.status==='Approved'));
    const paidAmt=sum(rows.filter(r=>r.payment_status==='Paid'));
    const unpaidAmt=totalAmt-paidAmt;
    const amountKpis=[
      {label:'Total Requested (₹)',val:totalAmt,color:'#4e9af1',icon:'💰'},
      {label:'Approved Amount (₹)',val:approvedAmt,color:'#22c55e',icon:'✅'},
      {label:'Paid Amount (₹)',val:paidAmt,color:'#a855f7',icon:'💳'},
      {label:'Unpaid Amount (₹)',val:unpaidAmt,color:'#ef4444',icon:'⏳'},
    ];
    const html=amountKpis.map(k=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 12px;border-left:4px solid ${k.color};box-shadow:var(--shadow);"><div style="font-size:0.95rem;margin-bottom:3px;">${k.icon}</div><div style="font-size:1.3rem;font-weight:900;color:${k.color};line-height:1;">₹${Number(k.val||0).toLocaleString('en-IN',{maximumFractionDigits:0})}</div><div style="font-size:0.62rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px;">${k.label}</div></div>`).join('');
    document.getElementById('vrKpiRow').insertAdjacentHTML('beforeend', html);
  }catch(e){
    console.error('Amount KPI render error:',e);
  }
}
// ── FILTER ─────────────────────────────────────────
function _vrBuildFilterOptions(){
  // Unique vendor names actually present in the loaded requests
  _vrVendorFilterList=[...new Set(_vrAll.map(r=>r.vendor_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  // Unique requesters (by email) actually present in the loaded requests, displayed via name map
  const reqMap={};
  _vrAll.forEach(r=>{
    const email=String(r.submitted_by||'').toLowerCase().trim();
    if(!email||reqMap[email])return;
    reqMap[email]={email,name:_vrNameMap[email]||r.submitted_by};
  });
  _vrRequesterFilterList=Object.values(reqMap).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
}
function _vrVendorFilterRender(q){
  const dd=document.getElementById('vrVendorFilterDropdown');if(!dd)return;
  const list=q?_vrVendorFilterList.filter(v=>v.toLowerCase().includes(q)):_vrVendorFilterList;
  let html=`<div class="vf-vendor-option" onmousedown="_vrVendorFilterSelect('')" style="font-weight:700;color:var(--muted);">— All Vendors —</div>`;
  html+=list.slice(0,100).map(v=>`<div class="vf-vendor-option" onmousedown="_vrVendorFilterSelect('${v.replace(/'/g,"\\'")}')">${v}</div>`).join('');
  dd.innerHTML=html;
  dd.style.display='block';
}
function _vrVendorFilterType(){_vrVendorFilterRender((document.getElementById('vrVendorFilterInput').value||'').toLowerCase());}
function _vrVendorFilterOpenFn(){_vrVendorFilterRender((document.getElementById('vrVendorFilterInput').value||'').toLowerCase());}
function _vrVendorFilterBlur(){setTimeout(()=>{const dd=document.getElementById('vrVendorFilterDropdown');if(dd)dd.style.display='none';},180);}
function _vrVendorFilterSelect(v){
  _vrFilterVendor=v;
  document.getElementById('vrVendorFilterInput').value=v;
  document.getElementById('vrVendorFilterDropdown').style.display='none';
  _vrApplyFilter();
}
function _vrReqFilterRender(q){
  const dd=document.getElementById('vrReqFilterDropdown');if(!dd)return;
  const list=q?_vrRequesterFilterList.filter(p=>String(p.name).toLowerCase().includes(q)):_vrRequesterFilterList;
  let html=`<div class="vf-vendor-option" onmousedown="_vrReqFilterSelect('','')" style="font-weight:700;color:var(--muted);">— All People —</div>`;
  html+=list.slice(0,100).map(p=>`<div class="vf-vendor-option" onmousedown="_vrReqFilterSelect('${p.email}','${String(p.name).replace(/'/g,"\\'")}')">${p.name}</div>`).join('');
  dd.innerHTML=html;
  dd.style.display='block';
}
function _vrReqFilterType(){_vrReqFilterRender((document.getElementById('vrReqFilterInput').value||'').toLowerCase());}
function _vrReqFilterOpenFn(){_vrReqFilterRender((document.getElementById('vrReqFilterInput').value||'').toLowerCase());}
function _vrReqFilterBlur(){setTimeout(()=>{const dd=document.getElementById('vrReqFilterDropdown');if(dd)dd.style.display='none';},180);}
function _vrReqFilterSelect(email,name){
  _vrFilterRequester=email;
  document.getElementById('vrReqFilterInput').value=name;
  document.getElementById('vrReqFilterDropdown').style.display='none';
  _vrApplyFilter();
}
// Multi-select filter chips: click toggles a chip on/off, so 2+ can be active together
// (e.g. "On Hold" + "Approved" shows rows matching either). "All" clears every chip.
function vrSetFilter(mode,btn){
  if(mode==='all'){
    _vrFilterModes.clear();
  }else if(_vrFilterModes.has(mode)){
    _vrFilterModes.delete(mode);
  }else{
    _vrFilterModes.add(mode);
  }
  // Re-sync every chip's active state from the Set (not just the one just clicked) —
  // otherwise picking a 2nd chip would visually un-highlight the 1st.
  document.querySelectorAll('.vr-fbtn').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode==='all'?_vrFilterModes.size===0:_vrFilterModes.has(b.dataset.mode));
  });
  _vrApplyFilter();
}
function vrApplyFilter(){_vrApplyFilter();}
function _vrApplyFilter(){
  const q=(document.getElementById('vrSearch')?.value||'').toLowerCase().trim();
  const STATUS_TAGS=['On Hold','Approved','Declined'];
  const PAY_TAGS=['Paid','Unpaid'];
  const activeStatus=[..._vrFilterModes].filter(m=>STATUS_TAGS.includes(m));
  const activePay=[..._vrFilterModes].filter(m=>PAY_TAGS.includes(m));
  _vrFiltered=_vrAll.filter(r=>{
    if(activeStatus.length&&!activeStatus.includes(r.status||'On Hold'))return false;
    if(activePay.length){
      const isPaid=r.payment_status==='Paid';
      if(!activePay.some(p=>p==='Paid'?isPaid:!isPaid))return false;
    }
    if(_vrFilterVendor&&r.vendor_name!==_vrFilterVendor)return false;
    if(_vrFilterRequester&&String(r.submitted_by||'').toLowerCase().trim()!==_vrFilterRequester)return false;
    if(q){const name=(_vrNameMap[String(r.submitted_by||'').toLowerCase()]||r.submitted_by||'').toLowerCase();const hay=[r.vendor_name,r.product_name,r.location,r.submitted_by,name,String(r.amount||'')].join(' ').toLowerCase();if(!hay.includes(q))return false;}
    return true;
  });
  _vrRenderTable();
  _vrRenderKPIs();
  _vrLoadAmountKPIs();
}

// ── BADGES ─────────────────────────────────────────
function _vrStatusBadge(s){const m={Approved:{bg:'rgba(34,197,94,0.12)',c:'#22c55e'},Declined:{bg:'rgba(239,68,68,0.1)',c:'#ef4444'},'On Hold':{bg:'rgba(245,158,11,0.1)',c:'#f59e0b'}};const t=m[s]||m['On Hold'];return`<span class="vr-badge" style="background:${t.bg};color:${t.c};border:1px solid ${t.c}44;">${s||'On Hold'}</span>`;}
function _vrPayBadge(s){if(s==='Paid')return`<span class="vr-badge" style="background:rgba(168,85,247,0.12);color:#a855f7;border:1px solid rgba(168,85,247,0.3);">💳 Paid</span>`;return`<span class="vr-badge" style="background:rgba(107,114,128,0.1);color:var(--muted);border:1px solid var(--border);">Unpaid</span>`;}

// ── RENDER TABLE ───────────────────────────────────
function _vrRenderTable(){
  const tbody=document.getElementById('vrTbody');
  const tw=document.getElementById('vrTableWrap');
  const em=document.getElementById('vrEmpty');
  if(!tbody)return;
  if(!_vrFiltered.length){if(tw)tw.style.display='none';if(em)em.style.display='block';return;}
  if(em)em.style.display='none';
  if(tw)tw.style.display='block';
  tbody.innerHTML=_vrFiltered.map(r=>{
    const d=r.created_at?new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';
    const nameDisplay=_vrNameMap[String(r.submitted_by||'').toLowerCase()]||r.submitted_by||'—';
    const status=r.status||'On Hold';
    // Row is selectable for bulk "Mark as Paid" if the viewer has EA or Accounts rights
    // and the request is Approved + still Unpaid. (Previously this checkbox only ever
    // appeared for non-EA accounts users, which is why it never showed up for EA/owner roles.)
    const canPay=(_vrIsAccounts()||_vrIsEA())&&status==='Approved'&&r.payment_status!=='Paid';
    const payCb=canPay?`<input type="checkbox" class="vr-row-cb" data-id="${r.id}" onclick="event.stopPropagation()" onchange="vrUpdateBulkBtn()" title="Select to mark as Paid" style="width:16px;height:16px;cursor:pointer;accent-color:#3b82f6;margin-right:6px;vertical-align:middle;">`:'';
    const canDelete=(typeof PERMISSIONS!=='undefined'&&PERMISSIONS&&PERMISSIONS.vendor_delete==='true')||_vrIsEA()||(String(r.submitted_by||'').toLowerCase()===_vrMyEmail());
    const canEdit=r.status==='On Hold'&&(_vrIsEA()||(String(r.submitted_by||'').toLowerCase()===_vrMyEmail()));
    const editBtn=canEdit?`<button class="vr-act" style="background:rgba(78,154,241,0.12);color:#4e9af1;border:1px solid rgba(78,154,241,0.35);margin-left:5px;" onclick="event.stopPropagation();openVendorEditForm(${r.id})" title="Edit request">✏️ Edit</button>`:'';
    const delBtn=canDelete?`<button class="vr-act" style="background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3);margin-left:5px;" onclick="vrDeleteRequest(${r.id},event)" title="Delete request">🗑</button>`:'';
    const attachCell=r.invoice_link
      ?`<a href="${r.invoice_link}" target="_blank" onclick="event.stopPropagation()" title="View uploaded invoice / quotation" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;background:rgba(78,154,241,0.12);border:1px solid rgba(78,154,241,0.3);color:#4e9af1;text-decoration:none;font-size:0.95rem;">📎</a>`
      :`<span style="color:var(--muted);font-size:0.8rem;">—</span>`;
    return`<tr onclick="openVrModal(${r.id})" title="Click row to view details" style="cursor:pointer;"><td style="color:var(--muted);font-size:0.78rem;white-space:nowrap;">${d}</td><td><div style="font-weight:700;font-size:0.85rem;color:var(--text);">${nameDisplay}</div></td><td><div style="font-weight:700;font-size:0.85rem;">${r.vendor_name||'—'}</div></td><td style="max-width:180px;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.product_name||''}">${r.product_name||'—'}</div></td><td style="text-align:center;">${r.qty||'—'}</td><td style="font-weight:700;white-space:nowrap;text-align:right;">₹${r.amount!=null?Number(r.amount).toLocaleString('en-IN',{maximumFractionDigits:0}):'—'}</td><td style="font-size:0.82rem;">${r.location||'—'}</td><td>${_vrStatusBadge(status)}</td><td>${_vrPayBadge(r.payment_status)}</td><td style="text-align:center;">${attachCell}</td><td style="white-space:nowrap;">${payCb}${editBtn}${delBtn}</td></tr>`;
  }).join('');
}

// ── VENDOR BUTTON VISIBILITY ───────────────────────
// Called after PERMISSIONS loads — shows Purchase Request button if allowed
function _vrCheckBtnAccess(){
  const btn=document.getElementById('vendorPurchaseBtn');
  const r=_vrRole();
  const alwaysAllow=r==='mis';
  const hasPermission=typeof PERMISSIONS!=='undefined'&&PERMISSIONS&&PERMISSIONS.vendor_access==='true';
  if(btn){
    if(alwaysAllow||hasPermission){
      btn.style.display='flex';
    } else {
      btn.style.display='none';
    }
  }
  _injectPurchaseCard();
}

function _injectPurchaseCard() {
  if (document.getElementById('purchase-request-card')) return;
  const rawRole = String((CURRENT_USER && (CURRENT_USER.rawRole || CURRENT_USER.role)) || '').toLowerCase().trim();
  const isMIS = (rawRole === 'mis' || rawRole === 'managing director' || rawRole === 'owner');
  const hasVendorAccess = PERMISSIONS && PERMISSIONS.vendor_access === 'true';
  if (!isMIS && !hasVendorAccess) return;
  const gridEl = document.getElementById('finance-grid');
  if (!gridEl) return;
  const card = document.createElement('div');
  card.id = 'purchase-request-card';
  card.style.cssText = 'position:relative;';
  card.innerHTML = `
    <div class="home-card" style="--card-top:#f0a500;cursor:pointer;border-top:3px solid #f0a500;"
      onclick="openVrDash()"
      onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='#f0a500'"
      onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
      <div class="hc-icon" style="background:rgba(240,165,0,0.12);border-color:rgba(240,165,0,0.3);color:#f0a500;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
      </div>
      <div class="hc-name">Purchase Request</div>
      <div class="hc-desc" style="font-size:0.88rem;line-height:1.55;color:var(--muted);">Submit vendor payment requests, track approvals and manage purchase history.</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
        <span class="hc-status live" style="background:rgba(240,165,0,0.12);color:#f0a500;border:1px solid rgba(240,165,0,0.3);">💰 Vendor Payments</span>
        <span style="font-size:0.78rem;font-weight:600;color:#f0a500;">Open →</span>
      </div>
    </div>`;
  gridEl.insertBefore(card, gridEl.firstChild);
}  

// ── OPEN VENDOR DASHBOARD (called by Purchase Request button) ──
function openVrDash(){
  document.getElementById('vrDashOverlay').style.display='block';
  document.body.style.overflow='hidden';
  loadVendorRequests();
}
function closeVrDash(){
  document.getElementById('vrDashOverlay').style.display='none';
  document.body.style.overflow='';
}

// ── SUBMIT FORM ────────────────────────────────────
async function openVendorForm(){
  document.getElementById('vfErr').style.display='none';
  ['vfProduct','vfQty','vfAmount','vfInvNo','vfPoNo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('vfLocation').value='';
  document.getElementById('vfVendorSel').value='';
  document.getElementById('vfVendorSearch').value='';
  document.getElementById('vfVendorSearch').value='';
  document.getElementById('vfNewVendorBox').style.display='none';
  const fi=document.getElementById('vfInvFile');if(fi)fi.value='';
  document.getElementById('vfInvFileName').textContent='No file chosen';
  const lbl=document.getElementById('vfInvUploadLabel');if(lbl)lbl.style.background='rgba(78,154,241,0.08)';

  await _vrLoadVendors();
  document.getElementById('vfOverlay').style.display='block';
}
function closeVendorForm(){document.getElementById('vfOverlay').style.display='none'; _vrResetFormToNew && _vrResetFormToNew();}
function vfToggleNewVendor(){
  const box=document.getElementById('vfNewVendorBox');
  box.style.display=box.style.display==='none'?'block':'none';
  if(box.style.display==='block'){['nvName','nvContact','nvNotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('nvErr').style.display='none';}
}
async function saveNewVendor(){
  const name=(document.getElementById('nvName').value||'').trim();
  const errEl=document.getElementById('nvErr');
  const btn=document.getElementById('nvSaveBtn');
  errEl.style.display='none';
  if(!name){errEl.textContent='⚠️ Vendor name is required.';errEl.style.display='block';return;}
  btn.disabled=true;btn.textContent='Saving…';
  try{
const payload={vendor_name:name,contact:document.getElementById('nvContact').value.trim()||null,notes:document.getElementById('nvNotes').value.trim()||null,created_by:_vrMyEmail()};    const res=await fetch(`${SUPABASE_URL}/rest/v1/vendors`,{method:'POST',headers:{...SB_HDRS_JSON(),'Prefer':'return=representation','Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!res.ok){const t=await res.text();throw new Error(t);}
    const newVendors=await res.json();
    const newV=newVendors[0];
    _vrVendors.push(newV);_vrVendors.sort((a,b)=>a.vendor_name.localeCompare(b.vendor_name));
    _vrPopulateVendorDropdown();
    document.getElementById('vfVendorSel').value=newV.id;
    document.getElementById('vfVendorSearch').value=newV.vendor_name;
    document.getElementById('vfVendorSearch').value=newV.vendor_name;
    document.getElementById('vfNewVendorBox').style.display='none';
    if(typeof showToast==='function')showToast('✅ Vendor added!','success',2000);
  }catch(e){
    errEl.textContent=(e.message&&e.message.toLowerCase().includes('unique'))?'⚠️ A vendor with this name already exists.':'❌ '+e.message;
    errEl.style.display='block';
  }finally{btn.disabled=false;btn.textContent='Save Vendor';}
}
async function submitVendorRequest(){
  const errEl=document.getElementById('vfErr');
  const btn=document.getElementById('vfSubmitBtn');
  errEl.style.display='none';
  const sel=document.getElementById('vfVendorSel');
  const vendorId=sel.value;
  const vendorName=sel.options[sel.selectedIndex]?.dataset?.name||'';
  const product=(document.getElementById('vfProduct').value||'').trim();
  const amount=document.getElementById('vfAmount').value;
  const location=document.getElementById('vfLocation').value;
  if(!vendorId){errEl.textContent='⚠️ Please select a vendor.';errEl.style.display='block';return;}
  if(!product){errEl.textContent='⚠️ Product / Service is required.';errEl.style.display='block';return;}
  if(!amount||isNaN(Number(amount))||Number(amount)<=0){errEl.textContent='⚠️ Please enter a valid amount.';errEl.style.display='block';return;}
  if(!location){errEl.textContent='⚠️ Please select a location.';errEl.style.display='block';return;}
  const invNo=(document.getElementById('vfInvNo').value||'').trim();
  const poNo=(document.getElementById('vfPoNo').value||'').trim();
  const invFile=document.getElementById('vfInvFile')?.files?.[0];
  if(!invNo){errEl.textContent='⚠️ Invoice Number is required.';errEl.style.display='block';return;}
  if(!poNo){errEl.textContent='⚠️ PO Number is required.';errEl.style.display='block';return;}
  if(!invFile){errEl.textContent='⚠️ Please upload an Invoice / Quotation file.';errEl.style.display='block';return;}
  btn.disabled=true;btn.textContent='Submitting…';
  try{
    let invoiceUrl=null;
    const invFile=document.getElementById('vfInvFile')?.files?.[0];
    if(invFile){
      btn.textContent='Uploading invoice…';
      try{
        invoiceUrl=await _vrUploadFile(invFile,'vendor-attachments','invoices');
      }catch(e){
        console.warn('Invoice upload failed, proceeding without it:',e.message);
        invoiceUrl=null;
      }
    }
    btn.textContent='Saving…';
    // Look up Emp_id from Employee_details to properly link to employee record
    let empId=null;
    try{
      const empLookup=await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(_vrMyEmail())}&limit=1`,
        {headers:SB_HDRS()}
      );
      const empRows=empLookup.ok?await empLookup.json():[];
      if(empRows&&empRows[0])empId=empRows[0].Emp_id||null;
    }catch(e){ /* non-fatal, submit anyway */ }
    const payload={submitted_by:_vrMyEmail(),submitted_by_emp_id:empId,vendor_id:parseInt(vendorId),vendor_name:vendorName,product_name:product,qty:parseInt(document.getElementById('vfQty').value)||null,amount:parseFloat(amount),location,invoice_number:document.getElementById('vfInvNo').value.trim()||null,po_number:document.getElementById('vfPoNo').value.trim()||null,invoice_link:invoiceUrl,status:'On Hold',payment_status:'Unpaid'};
    const res=await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests`,{method:'POST',headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'},body:JSON.stringify(payload)});
    if(!res.ok){const t=await res.text();throw new Error(t);}
    closeVendorForm();
    if(typeof showToast==='function')showToast('✅ Purchase request submitted!','success',3000);
    _vrLoaded=false;await loadVendorRequests(true);
  }catch(e){
  const msg=e.message||'';
  if(msg.includes('23505')||msg.includes('unique_vendor_invoice')){
    errEl.textContent='⚠️ This invoice number is already submitted for this vendor. Please check for duplicates.';
  } else {
    errEl.textContent='❌ '+msg;
  }
  errEl.style.display='block';
}
  finally{btn.disabled=false;btn.textContent='🚀 Submit for Approval';}
}

// ── EDIT PURCHASE REQUEST ───────────────────────────────────────────────
let _vrEditId = null;

async function openVendorEditForm(id){
  const r = _vrAll.find(x => x.id === id);
  if(!r){ return; }
  if(r.status !== 'On Hold'){
    if(typeof showToast==='function') showToast('⚠️ Only "On Hold" requests can be edited.','error',3000);
    return;
  }

  _vrEditId = id;

  // Load vendors first so dropdown is populated
  await _vrLoadVendors();

  // Switch form header to Edit mode
  document.querySelector('#vfBox .vfh-title').textContent = '✏️ Edit Purchase Request';
  document.querySelector('#vfBox .vfh-sub').textContent = 'Update the details and save changes';

  // Pre-fill fields
  const sel = document.getElementById('vfVendorSel');
  sel.value = r.vendor_id ? String(r.vendor_id) : '';
  document.getElementById('vfVendorSearch').value = r.vendor_name || '';
  // If vendor not in list (edge case), add a temporary option
  if(sel.value === '' && r.vendor_name){
    const opt = document.createElement('option');
    opt.value = r.vendor_id || 'existing';
    opt.textContent = r.vendor_name;
    opt.dataset.name = r.vendor_name;
    sel.appendChild(opt);
    sel.value = opt.value;
  }
  document.getElementById('vfVendorSearch').value = r.vendor_name || '';
  document.getElementById('vfProduct').value  = r.product_name || '';
  document.getElementById('vfQty').value      = r.qty != null ? r.qty : '';
  document.getElementById('vfAmount').value   = r.amount != null ? r.amount : '';
  document.getElementById('vfLocation').value = r.location || '';
  document.getElementById('vfInvNo').value    = r.invoice_number || '';
  document.getElementById('vfPoNo').value     = r.po_number || '';

  // Reset file input (existing invoice link shown as info)
  const fi = document.getElementById('vfInvFile'); if(fi) fi.value='';
  const fnEl = document.getElementById('vfInvFileName');
  if(fnEl) fnEl.textContent = r.invoice_link ? '📄 Existing file kept (upload to replace)' : 'No file chosen';

  // Hide new vendor box
  document.getElementById('vfNewVendorBox').style.display = 'none';
  document.getElementById('vfErr').style.display = 'none';

  // Swap submit button to update mode
  const btn = document.getElementById('vfSubmitBtn');
  btn.textContent = '💾 Save Changes';
  btn.onclick = () => submitVendorEdit();

  document.getElementById('vfOverlay').style.display = 'block';
}

async function submitVendorEdit(){
  const errEl = document.getElementById('vfErr');
  const btn   = document.getElementById('vfSubmitBtn');
  errEl.style.display = 'none';

  const sel       = document.getElementById('vfVendorSel');
  const vendorId  = sel.value;
  const vendorName= sel.options[sel.selectedIndex]?.dataset?.name || sel.options[sel.selectedIndex]?.textContent || '';
  const product   = (document.getElementById('vfProduct').value || '').trim();
  const amount    = document.getElementById('vfAmount').value;
  const location  = document.getElementById('vfLocation').value;

  if(!vendorId)   { errEl.textContent='⚠️ Please select a vendor.'; errEl.style.display='block'; return; }
  if(!product)    { errEl.textContent='⚠️ Product / Service is required.'; errEl.style.display='block'; return; }
  if(!amount || isNaN(Number(amount)) || Number(amount) <= 0){ errEl.textContent='⚠️ Please enter a valid amount.'; errEl.style.display='block'; return; }
  if(!location)   { errEl.textContent='⚠️ Please select a location.'; errEl.style.display='block'; return; }

  btn.disabled = true; btn.textContent = 'Saving…';

  try{
    // Check if a new invoice file was chosen
    let invoiceUrl = (_vrAll.find(x=>x.id===_vrEditId)||{}).invoice_link || null;
    const invFile = document.getElementById('vfInvFile')?.files?.[0];
    if(invFile){
      btn.textContent = 'Uploading invoice…';
      try{ invoiceUrl = await _vrUploadFile(invFile,'vendor-attachments','invoices'); }
      catch(e){ console.warn('Invoice upload failed:', e.message); }
    }

    btn.textContent = 'Saving…';
    const payload = {
      vendor_id:       parseInt(vendorId) || null,
      vendor_name:     vendorName,
      product_name:    product,
      qty:             parseInt(document.getElementById('vfQty').value) || null,
      amount:          parseFloat(amount),
      location,
      invoice_number:  document.getElementById('vfInvNo').value.trim() || null,
      po_number:       document.getElementById('vfPoNo').value.trim() || null,
      invoice_link:    invoiceUrl
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vendor_requests?id=eq.${_vrEditId}`,
      { method:'PATCH', headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'}, body:JSON.stringify(payload) }
    );
    if(!res.ok){ const t = await res.text(); throw new Error(t); }

    // Update local data
    const idx = _vrAll.findIndex(x => x.id === _vrEditId);
    if(idx !== -1) _vrAll[idx] = { ..._vrAll[idx], ...payload };

    // Reset form to new-request mode
    _vrResetFormToNew();
    closeVendorForm();
    if(typeof showToast==='function') showToast('✅ Request updated successfully!','success',3000);
    _vrApplyFilter();
    _vrRenderKPIs();
    _vrLoadAmountKPIs();
  }catch(e){
    errEl.textContent = '❌ ' + e.message;
    errEl.style.display = 'block';
  }finally{
    btn.disabled = false;
    btn.textContent = '💾 Save Changes';
  }
}

function _vrResetFormToNew(){
  _vrEditId = null;
  const titleEl = document.querySelector('#vfBox .vfh-title');
  const subEl   = document.querySelector('#vfBox .vfh-sub');
  if(titleEl) titleEl.textContent = '📦 New Purchase Request';
  if(subEl)   subEl.textContent   = 'Submit a vendor payment request for approval';
  const btn = document.getElementById('vfSubmitBtn');
  if(btn){ btn.textContent = '🚀 Submit for Approval'; btn.onclick = submitVendorRequest; }
}

function openVrModal(id){
  const r=_vrAll.find(x=>x.id===id);if(!r)return;
  _vrCurId=id;
  document.getElementById('vrmVendor').textContent=r.vendor_name||'—';
  document.getElementById('vrmProduct').textContent=r.product_name||'—';
  const nameDisplay=_vrNameMap[String(r.submitted_by||'').toLowerCase()]||r.submitted_by||'—';
  const d=r.created_at?new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  const details=[['Requested By',nameDisplay],['Date',d],['Amount',r.amount!=null?'₹'+Number(r.amount).toLocaleString('en-IN'):'—'],['Quantity',r.qty||'—'],['Location',r.location||'—'],['Invoice #',r.invoice_number||'—'],['PO No. (Odoo)',r.po_number||'—'],['Status',r.status||'On Hold'],['Payment',r.payment_status||'Unpaid'],...(r.remarks?[['Remarks',r.remarks]]:[]),...(r.reviewed_by?[['Reviewed By',_vrNameMap[String(r.reviewed_by||'').toLowerCase()]||r.reviewed_by]]:[]),...(r.utr_number?[['UTR Number',r.utr_number]]:[]),...(r.paid_by?[['Paid By',_vrNameMap[String(r.paid_by||'').toLowerCase()]||r.paid_by]]:[])];
  document.getElementById('vrmDetailsGrid').innerHTML=details.map(([l,v])=>`<div class="vrm-item"><div class="vrm-lbl">${l}</div><div class="vrm-val">${v}</div></div>`).join('');
  // Invoice attachment
  const invLinkWrap=document.getElementById('vrmInvLinkWrap');
  const invNoLink=document.getElementById('vrmInvNoLink');
  if(r.invoice_link){
    document.getElementById('vrmInvLink').href=r.invoice_link;
    invLinkWrap.style.display='block';
    invNoLink.style.display='none';
  }else{
    invLinkWrap.style.display='none';
    invNoLink.style.display='block';
  }
  // Payment attachment
  const payLinkWrap=document.getElementById('vrmPayAttachLinkWrap');
  const payNoLink=document.getElementById('vrmPayNoLink');
  if(r.payment_attachment){
    document.getElementById('vrmPayAttachLink').href=r.payment_attachment;
    payLinkWrap.style.display='block';
    payNoLink.style.display='none';
  }else{
    payLinkWrap.style.display='none';
    payNoLink.style.display='block';
  }
  const eaSect=document.getElementById('vrmEASection');
  const acctSect=document.getElementById('vrmAcctSection');
  eaSect.style.display='none';acctSect.style.display='none';
  if(_vrIsEA()){eaSect.style.display='block';document.getElementById('vrmStatus').value=r.status||'On Hold';document.getElementById('vrmRemarks').value=r.remarks||'';}
  if(_vrIsAccounts()&&r.status==='Approved'&&r.payment_status!=='Paid'){
    acctSect.style.display='block';
    document.getElementById('vrmUTR').value=r.utr_number||'';
    const paf=document.getElementById('vrmAttachFile');if(paf)paf.value='';
    document.getElementById('vrmAttachName').textContent='No file chosen';
  }
  document.getElementById('vrmMsg').style.display='none';
  const modal=document.getElementById('vrModal');modal.style.display='flex';document.body.style.overflow='hidden';
}
function closeVrModal(){document.getElementById('vrModal').style.display='none';}

// ── EA: SAVE DECISION ──────────────────────────────
async function vrSaveDecision(){
  if(!_vrCurId)return;
  const msgEl=document.getElementById('vrmMsg');msgEl.style.display='none';
  const status=document.getElementById('vrmStatus').value;
  const remarks=(document.getElementById('vrmRemarks').value||'').trim();
  try{
    const payload={status,remarks:remarks||null,reviewed_by:_vrMyEmail(),reviewed_at:new Date().toISOString()};
    const res=await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests?id=eq.${_vrCurId}`,{method:'PATCH',headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'},body:JSON.stringify(payload)});
    if(!res.ok){const t=await res.text();throw new Error(t);}
    const idx=_vrAll.findIndex(x=>x.id===_vrCurId);if(idx!==-1)_vrAll[idx]={..._vrAll[idx],...payload};
    msgEl.style.cssText='display:block;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:9px;color:#22c55e;padding:10px;';msgEl.textContent='✅ Decision saved!';
    _vrRenderKPIs();_vrLoadAmountKPIs();_vrApplyFilter();
    if(typeof showToast==='function')showToast('✅ Decision saved!','success',2500);
    setTimeout(closeVrModal,1200);
  }catch(e){msgEl.style.cssText='display:block;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:9px;color:#ef4444;padding:10px;';msgEl.textContent='❌ '+e.message;}
}

// ── ACCOUNTS: MARK PAID ────────────────────────────
async function vrMarkPaid(){
  if(!_vrCurId)return;
  const msgEl=document.getElementById('vrmMsg');msgEl.style.display='none';
  const utr=(document.getElementById('vrmUTR').value||'').trim();
  try{
    let attachUrl=null;
    const attachFile=document.getElementById('vrmAttachFile')?.files?.[0];
    if(attachFile){
      msgEl.style.cssText='display:block;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:9px;color:#a855f7;padding:10px;';
      msgEl.textContent='⏳ Uploading payment proof…';
      try{
        attachUrl=await _vrUploadFile(attachFile,'vendor-attachments','payments');
      }catch(e){
        // Upload failed — proceed without attachment, can be added later
        console.warn('Attachment upload failed, proceeding without it:',e.message);
        attachUrl=null;
      }
    }
    msgEl.textContent='⏳ Saving…';
    const payload={payment_status:'Paid',utr_number:utr,payment_attachment:attachUrl,paid_by:_vrMyEmail(),paid_at:new Date().toISOString()};
    const res=await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests?id=eq.${_vrCurId}`,{method:'PATCH',headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'},body:JSON.stringify(payload)});
    if(!res.ok){const t=await res.text();throw new Error(t);}
    const idx=_vrAll.findIndex(x=>x.id===_vrCurId);if(idx!==-1)_vrAll[idx]={..._vrAll[idx],...payload};
    msgEl.style.cssText='display:block;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:9px;color:#a855f7;padding:10px;';
    msgEl.textContent='💳 Marked as PAID!';
    _vrRenderKPIs();_vrLoadAmountKPIs();_vrApplyFilter();
    if(typeof showToast==='function')showToast('💳 Payment recorded!','success',2500);
    setTimeout(closeVrModal,1200);
  }catch(e){
    msgEl.style.cssText='display:block;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:9px;color:#ef4444;padding:10px;';
    msgEl.textContent='❌ '+e.message;
  }
}

// ── BULK PAY ───────────────────────────────────────
async function vrBulkPay(){
  const checked=[...document.querySelectorAll('.vr-row-cb:checked')];
  if(!checked.length){if(typeof showToast==='function')showToast('⚠️ No row selected','error',2000);return;}
  if(!confirm(`Mark ${checked.length} row(s) as Paid?`))return;
  const ids=checked.map(cb=>parseInt(cb.dataset.id));
  const payload={payment_status:'Paid',utr_number:'',paid_by:_vrMyEmail(),paid_at:new Date().toISOString()};
  let ok=0,fail=0;
  for(const id of ids){
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests?id=eq.${id}`,{method:'PATCH',headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'},body:JSON.stringify(payload)});
      if(!res.ok)throw new Error();
      const idx=_vrAll.findIndex(x=>x.id===id);if(idx!==-1)_vrAll[idx]={..._vrAll[idx],...payload};
      ok++;
    }catch{fail++;}
  }
  _vrRenderKPIs();_vrLoadAmountKPIs();_vrApplyFilter();
  if(typeof showToast==='function')showToast(`💳 ${ok} paid, ${fail} failed`,'success',3000);
}  
function vrUpdateBulkBtn(){
  const any=document.querySelector('.vr-row-cb:checked');
  document.getElementById('vrBulkPayBtn').style.display=any?'':'none';
}  

// ── FILE HELPERS ───────────────────────────────────
function vfInvFileChosen(input){
  const name=input.files[0]?input.files[0].name:'No file chosen';
  document.getElementById('vfInvFileName').textContent=name;
  const label=document.getElementById('vfInvUploadLabel');
  if(input.files[0])label.style.background='rgba(78,154,241,0.18)';
}
function vrmAttachFileChosen(input){
  document.getElementById('vrmAttachName').textContent=input.files[0]?input.files[0].name:'No file chosen';
}
async function _vrUploadFile(file, bucket, folder){
  if(!file)return null;
  const ext=file.name.split('.').pop().toLowerCase();
  const safeName=`${folder}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
  // Storage API needs apikey + Authorization but NOT Accept:application/json
  const res=await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${safeName}`,{
    method:'POST',
    headers:{
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': file.type||'application/octet-stream',
      'x-upsert': 'true'
    },
    body:file
  });
  if(!res.ok){const t=await res.text();throw new Error('Upload failed: '+t);}
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${safeName}`;
}

// ── DELETE REQUEST ─────────────────────────────────
async function vrDeleteRequest(id, event){
  if(event)event.stopPropagation();
  const r=_vrAll.find(x=>x.id===id);
  if(!r)return;
  // Confirm before deleting
  const vendorName=r.vendor_name||'this request';
  const confirmed=confirm(`Delete purchase request from ${vendorName}?\n\nThis cannot be undone.`);
  if(!confirmed)return;
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests?id=eq.${id}`,{
      method:'DELETE',
      headers:SB_HDRS()
    });
    if(!res.ok){const t=await res.text();throw new Error(t);}
    // Remove from local state
    _vrAll=_vrAll.filter(x=>x.id!==id);
    _vrRenderKPIs();
    _vrLoadAmountKPIs();
    _vrApplyFilter();
    if(typeof showToast==='function')showToast('🗑 Request deleted','success',2000);
  }catch(e){
    if(typeof showToast==='function')showToast('❌ Delete failed: '+e.message,'error',3000);
    else alert('❌ Delete failed: '+e.message);
  }
}

// ── CLOSE ON BACKDROP CLICK ─────────────────────────────────────────────────────────
const _vfOv = document.getElementById('vfOverlay');
const _vrMo = document.getElementById('vrModal');
const _vrRe = document.getElementById('vrRecurModal');
if(_vfOv) _vfOv.addEventListener('click',function(e){if(e.target===this)closeVendorForm();});
if(_vrMo) _vrMo.addEventListener('click',function(e){if(e.target===this)closeVrModal();});
if(_vrRe) _vrRe.addEventListener('click',function(e){if(e.target===this)closeRecurringModal();});

// ── RECURRING REQUEST — VENDOR PICKER ─────────────────────────────────────────────────
// Opened from the header "🔁 Recurring" button. Since that button isn't tied to any one
// row, the user picks a vendor here first; we then find that vendor's most recent request
// (any status) and hand off to the existing openRecurringModal(id) flow below, which does
// all the actual copy-and-resubmit logic.
function openRecurringPicker(){
  document.getElementById('vrpVendorInput').value = '';
  document.getElementById('vrpErr').style.display = 'none';
  document.getElementById('vrRecurPickerModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeRecurringPicker(){
  document.getElementById('vrRecurPickerModal').style.display = 'none';
  document.body.style.overflow = '';
}
function _vrpVendorRenderList(q){
  const dd = document.getElementById('vrpVendorDropdown'); if(!dd) return;
  const list = q ? _vrVendorFilterList.filter(v => v.toLowerCase().includes(q)) : _vrVendorFilterList;
  if(!list.length){
    dd.innerHTML = `<div class="vf-vendor-option" style="color:var(--muted);cursor:default;">No vendors found</div>`;
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = list.slice(0,100).map(v => `<div class="vf-vendor-option" onmousedown="_vrpVendorSelect('${v.replace(/'/g,"\\'")}')">${v}</div>`).join('');
  dd.style.display = 'block';
}
function _vrpVendorFilterType(){ _vrpVendorRenderList((document.getElementById('vrpVendorInput').value||'').toLowerCase()); }
function _vrpVendorFilterOpen(){ _vrpVendorRenderList((document.getElementById('vrpVendorInput').value||'').toLowerCase()); }
function _vrpVendorFilterBlur(){ setTimeout(() => { const dd = document.getElementById('vrpVendorDropdown'); if(dd) dd.style.display = 'none'; }, 180); }
function _vrpVendorSelect(name){
  document.getElementById('vrpVendorInput').value = name;
  document.getElementById('vrpVendorDropdown').style.display = 'none';
}
function vrpProceed(){
  const name = (document.getElementById('vrpVendorInput').value||'').trim();
  const errEl = document.getElementById('vrpErr');
  errEl.style.display = 'none';
  if(!name){ errEl.textContent = '⚠️ Please select a vendor.'; errEl.style.display = 'block'; return; }
  const matches = _vrAll.filter(r => r.vendor_name === name).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if(!matches.length){ errEl.textContent = '⚠️ No previous request found for this vendor. Please create a new request instead.'; errEl.style.display = 'block'; return; }
  closeRecurringPicker();
  openRecurringModal(matches[0].id);
}
const _vrpMo = document.getElementById('vrRecurPickerModal');
if(_vrpMo) _vrpMo.addEventListener('click', function(e){ if(e.target===this) closeRecurringPicker(); });

// ── RECURRING REQUEST ───────────────────────────────────────────────────────────────

function openRecurringModal(id){
  const r = _vrAll.find(x => x.id === id);
  if(!r) return;
  _vrRecurSourceId = id;

  // Fill read-only preview fields
  document.getElementById('vrrVendor').textContent   = r.vendor_name  || '—';
  document.getElementById('vrrProduct').textContent  = r.product_name || '—';
  document.getElementById('vrrQty').textContent      = r.qty != null ? r.qty : '—';
  document.getElementById('vrrLocation').textContent = r.location     || '—';

  // Set amount to previous amount as default (user can change)
  document.getElementById('vrrAmount').value = r.amount != null ? r.amount : '';

  document.getElementById('vrrErr').style.display  = 'none';
  document.getElementById('vrrMsg').style.display  = 'none';
  const btn = document.getElementById('vrrSubmitBtn');
  btn.disabled = false; btn.textContent = '🔁 Submit Recurring Request';
  btn.onclick = submitRecurringRequest;

  document.getElementById('vrRecurModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeRecurringModal(){
  document.getElementById('vrRecurModal').style.display = 'none';
  document.body.style.overflow = '';
  _vrRecurSourceId = null;
}

async function submitRecurringRequest(){
  const errEl = document.getElementById('vrrErr');
  const msgEl = document.getElementById('vrrMsg');
  const btn   = document.getElementById('vrrSubmitBtn');
  errEl.style.display = 'none';
  msgEl.style.display = 'none';

  const amount = document.getElementById('vrrAmount').value;
  if(!amount || isNaN(Number(amount)) || Number(amount) <= 0){
    errEl.textContent = '⚠️ Please enter a valid amount.';
    errEl.style.display = 'block';
    return;
  }

  const src = _vrAll.find(x => x.id === _vrRecurSourceId);
  if(!src){ errEl.textContent = '❌ Source request not found.'; errEl.style.display='block'; return; }

  btn.disabled = true; btn.textContent = 'Submitting…';

  try{
    // Look up Emp_id
    let empId = null;
    try{
      const empLookup = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(_vrMyEmail())}&limit=1`,
        {headers: SB_HDRS()}
      );
      const empRows = empLookup.ok ? await empLookup.json() : [];
      if(empRows && empRows[0]) empId = empRows[0].Emp_id || null;
    }catch(e){ /* non-fatal */ }

    const payload = {
      submitted_by:         _vrMyEmail(),
      submitted_by_emp_id:  empId,
      vendor_id:            src.vendor_id   || null,
      vendor_name:          src.vendor_name || '',
      product_name:         src.product_name|| '',
      qty:                  src.qty         || null,
      location:             src.location    || '',
      invoice_number:       null,
      invoice_link:         null,
      amount:               parseFloat(amount),
      status:               'On Hold',
      payment_status:       'Unpaid'
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/vendor_requests`,{
      method:'POST',
      headers:{...SB_HDRS_JSON(),'Prefer':'return=minimal'},
      body: JSON.stringify(payload)
    });
    if(!res.ok){ const t = await res.text(); throw new Error(t); }

    msgEl.style.cssText = 'display:block;background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.3);border-radius:9px;color:#00d4aa;padding:10px;font-size:0.84rem;margin-top:12px;';
    msgEl.textContent = '✅ Recurring request submitted successfully!';
    btn.textContent = '✅ Done';

    if(typeof showToast==='function') showToast('✅ Recurring request submitted!','success',3000);
    _vrLoaded = false;
    await loadVendorRequests(true);
    setTimeout(closeRecurringModal, 1400);
  }catch(e){
    errEl.textContent = '❌ ' + e.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '🔁 Submit Recurring Request';
  }
}
