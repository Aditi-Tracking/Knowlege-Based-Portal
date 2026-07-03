// Section: CRM Vehicle Dashboard (loadCRMDashboard, server switch, vehicle data, alerts)
let _crmLoaded=false, _crmServer='both', _crmTier='', _crmStatus='';
let _crmData=[], _crmSelectedIdx=null;

function _canAccessCRM(){
  if(!CURRENT_USER)return false;
  return (PERMISSIONS.can_view_crm||'false')!=='false';
}
function _getCRMAccessLevel(){
  if(!CURRENT_USER)return'none';
  const p=PERMISSIONS.can_view_crm||'false';
  if(p==='false')return'none';
  // Check if ALL individual server permissions are ON (meaning truly full access)
  const rawRole=String(CURRENT_USER.rawRole||CURRENT_USER.role||'').toLowerCase().trim();
  const isSuperAdmin=(rawRole==='owner'||rawRole==='managing director'||rawRole==='mis');
  // Super admins with can_view_crm=true AND no explicit server restrictions = full access
  // But if any server toggle is explicitly set to 'true', we check them all
  const hasAnyServerPerm=(
    PERMISSIONS.crm_server_premium==='true'||
    PERMISSIONS.crm_server_pro==='true'||
    PERMISSIONS.crm_server_goa==='true'||
    PERMISSIONS.crm_server_bangalore==='true'||
    PERMISSIONS.crm_server_gujarat==='true'
  );
  // Super admins with NO server-level toggles set = full access (default)
  if(isSuperAdmin&&!hasAnyServerPerm)return'all';
  // Super admins WITH server toggles set = respect those toggles
  if(isSuperAdmin&&hasAnyServerPerm)return'restricted';
  // Regular users with can_view_crm=true = restricted (must have explicit server perms)
  if(p==='true')return'restricted';
  return p;
}
function _canViewCRMChanges(){
  if(!CURRENT_USER)return false;
  // Full access users always see it
  if(_getCRMAccessLevel()==='all') return true;
  return (PERMISSIONS.can_view_crm_changes||'false')==='true';
}
function _getCRMAllowedServers(){
  const lvl=_getCRMAccessLevel();
  if(lvl==='all')return['both','Premium Server','PRO Server','Goa Server','Bangalore Server','Gujarat Server'];
  if(lvl==='none')return[];
  // For restricted — always check individual server permissions
  const map={
    'Premium Server':  PERMISSIONS.crm_server_premium    ||'false',
    'PRO Server':      PERMISSIONS.crm_server_pro        ||'false',
    'Goa Server':      PERMISSIONS.crm_server_goa        ||'false',
    'Bangalore Server':PERMISSIONS.crm_server_bangalore  ||'false',
    'Gujarat Server':  PERMISSIONS.crm_server_gujarat    ||'false',
  };
  const allowed=Object.keys(map).filter(k=>map[k]==='true');
  if(allowed.length>1)allowed.unshift('both');
  return allowed;
}

function _applyCRMNavVisibility(){
  const el=document.getElementById('nav-crm'),mm=document.getElementById('mm-crm'),show=_canAccessCRM();
  if(el)el.style.display=show?'flex':'none';
  if(mm)mm.style.display=show?'flex':'none';
}
function _applyCRMServerButtons(){
  const allowed=_getCRMAllowedServers();
  const btnMap={
    'both':'crm-btn-both','Premium Server':'crm-btn-prem','PRO Server':'crm-btn-pro',
    'Goa Server':'crm-btn-goa','Bangalore Server':'crm-btn-bang','Gujarat Server':'crm-btn-guj'
  };
  Object.keys(btnMap).forEach(srv=>{
    const el=document.getElementById(btnMap[srv]);
    if(el)el.style.display=allowed.includes(srv)?'':'none';
  });
  if(!allowed.includes(_crmServer)){
    const first=allowed.find(s=>s!=='both')||allowed[0];
    if(first)_crmServer=first;
  }
  // Show/hide changes section based on permission
  const sec=document.getElementById('crm-changes-section');
  if(sec)sec.style.display=_canViewCRMChanges()?'block':'none';
}
function _crmAnim(el,val,dur=600){
  if(!el)return;
  const t0=performance.now();
  function step(now){const p=Math.min((now-t0)/dur,1),e=1-Math.pow(1-p,3);el.textContent=Math.round(e*val).toLocaleString();if(p<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}

/* Paginated fetch — bypasses Supabase 1000 row default limit */
async function _crmFetchAll(baseUrl){
  const pageSize=1000, hdrs=SB_HDRS();
  let allRows=[], offset=0;
  while(true){
    const res=await fetch(`${baseUrl}&limit=${pageSize}&offset=${offset}`,{
      headers:{...hdrs,'Range-Unit':'items','Range':`${offset}-${offset+pageSize-1}`}
    });
    const batch=await res.json();
    if(!Array.isArray(batch)||batch.length===0)break;
    allRows=[...allRows,...batch];
    if(batch.length<pageSize)break;
    offset+=pageSize;
  }
  return allRows;
}

async function loadCRMDashboard(){
  if(!_canAccessCRM()){switchDB('home');return;}
  _applyCRMServerButtons();
  const acc=_getCRMAccessLevel();
  const pw=document.getElementById('crm-access-pill-wrap');
  if(pw){
    if(acc==='all')pw.innerHTML='<span class="crm-access-pill crm-pill-all">✅ Full Access</span>';
    else if(acc==='restricted')pw.innerHTML='<span class="crm-access-pill crm-pill-tier">🔒 Server Restricted</span>';
    else if(acc!=='none'){
      pw.innerHTML=`<span class="crm-access-pill crm-pill-tier">🔒 ${acc} Only</span>`;
      crmSwitchTier(acc);
      document.querySelectorAll('#panel-crm .crm-tier-btn').forEach(b=>b.style.pointerEvents='none');
    }
  }
  const tb=document.getElementById('crm-tbl-body');
  if(tb)tb.innerHTML='<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--muted);">Loading data...</td></tr>';
  crmClearSelection();
  try{
    const baseUrl=_crmServer==='both'
      ?`${SUPABASE_URL}/rest/v1/server_customer_summary?order=total_vehicles.desc`
      :`${SUPABASE_URL}/rest/v1/server_customer_summary?region=eq.${encodeURIComponent(_crmServer)}&order=total_vehicles.desc`;
    let data=await _crmFetchAll(baseUrl);
    // For restricted users: filter data to only allowed servers
    if(acc==='restricted'){
      const allowedSrvs=_getCRMAllowedServers().filter(s=>s!=='both');
      if(allowedSrvs.length>0) data=data.filter(r=>allowedSrvs.includes(r.region));
    }
    if(acc!=='all'&&acc!=='none'&&acc!=='restricted')data=data.filter(r=>r.tier===acc);
    _crmData=data; _crmLoaded=true;
    const si=document.getElementById('crm-sync-info');
    if(si)si.textContent='Last loaded: '+new Date().toLocaleTimeString()+' — syncs every 5 min · Click any row to see details';
    // Auto-load today's vehicle changes if user has access
    if(_canViewCRMChanges()){
      crmChgQuick('yesterday');
    }
    loadCustomerAlerts();
    crmApplyFilters();
  }catch(e){
    console.error('CRM load error:',e);
    const tb2=document.getElementById('crm-tbl-body');
    if(tb2)tb2.innerHTML='<tr><td colspan="11" style="text-align:center;padding:40px;color:#ef4444;">Failed to load. Check console.</td></tr>';
  }
}

function crmApplyFilters(){
  const s=(document.getElementById('crm-search')?.value||'').toLowerCase();
  let f=_crmData.filter(r=>(!s||(r.company||'').toLowerCase().includes(s))&&(!_crmTier||r.tier===_crmTier));
  if(_crmStatus){const km={RUNNING:'running_count',IDLE:'idle_count',STOP:'stop_count',INACTIVE:'inactive_count'};f=f.filter(r=>(r[km[_crmStatus]]||0)>0);}
  crmRenderCards(f);
  crmRenderTable(f);
  const c=document.getElementById('crm-count'); if(c)c.textContent=f.length;
}

function crmRenderCards(data){
  const tot =data.reduce((s,r)=>s+(r.total_vehicles||0),0);
  const run =data.reduce((s,r)=>s+(r.running_count||0),0);
  const idl =data.reduce((s,r)=>s+(r.idle_count||0),0);
  const stp =data.reduce((s,r)=>s+(r.stop_count||0),0);
  const ina =data.reduce((s,r)=>s+(r.inactive_count||0),0);
  const act =run+idl+stp;
  const cust=data.length;
  const g=id=>document.getElementById(id);
  _crmAnim(g('crm-s-customers'),cust);
  _crmAnim(g('crm-s-total'),tot);
  _crmAnim(g('crm-s-active'),act);
  _crmAnim(g('crm-s-run'),run);
  _crmAnim(g('crm-s-idle'),idl);
  _crmAnim(g('crm-s-stop'),stp);
  _crmAnim(g('crm-s-inac'),ina);
  if(g('crm-ap-run')) g('crm-ap-run').textContent=run.toLocaleString();
  if(g('crm-ap-idle'))g('crm-ap-idle').textContent=idl.toLocaleString();
  if(g('crm-ap-stop'))g('crm-ap-stop').textContent=stp.toLocaleString();
  const srv=_crmServer==='both'?'all servers':_crmServer.replace(' Server','');
  if(g('crm-ss-customers'))g('crm-ss-customers').textContent=_crmTier?_crmTier+' tier':'all servers';
  if(g('crm-ss-total'))g('crm-ss-total').textContent=cust+' companies';
  if(g('crm-ss-active'))g('crm-ss-active').textContent=tot?Math.round(act/tot*100)+'% of total fleet':'running+idle+stop';
  if(g('crm-ss-run'))g('crm-ss-run').textContent=act?Math.round(run/act*100)+'% of active':'in motion';
  if(g('crm-ss-idle'))g('crm-ss-idle').textContent=act?Math.round(idl/act*100)+'% of active':'engine on';
  if(g('crm-ss-stop'))g('crm-ss-stop').textContent=act?Math.round(stp/act*100)+'% of active':'parked';
  if(g('crm-ss-inac'))g('crm-ss-inac').textContent=tot?Math.round(ina/tot*100)+'% of fleet':'no signal';
}

/* Clicking a table row highlights it + updates KPI cards with that company's data */
function crmSelectRow(idx, rowEl){
  const r=_crmData[idx];
  if(!r)return;
  // Deselect previous
  document.querySelectorAll('#crm-tbl-body tr.crm-row-selected').forEach(tr=>tr.classList.remove('crm-row-selected'));
  // If same row clicked again — deselect
  if(_crmSelectedIdx===idx){
    _crmSelectedIdx=null;
    crmClearSelection();
    crmApplyFilters(); // restore full cards
    return;
  }
  _crmSelectedIdx=idx;
  rowEl.classList.add('crm-row-selected');
  // Update KPI cards to show this company's data
  const act=(r.running_count||0)+(r.idle_count||0)+(r.stop_count||0);
  const tot=r.total_vehicles||0;
  const g=id=>document.getElementById(id);
  _crmAnim(g('crm-s-customers'),1,300);
  _crmAnim(g('crm-s-total'),tot,300);
  _crmAnim(g('crm-s-active'),act,300);
  _crmAnim(g('crm-s-run'),r.running_count||0,300);
  _crmAnim(g('crm-s-idle'),r.idle_count||0,300);
  _crmAnim(g('crm-s-stop'),r.stop_count||0,300);
  _crmAnim(g('crm-s-inac'),r.inactive_count||0,300);
  if(g('crm-ap-run')) g('crm-ap-run').textContent=(r.running_count||0).toLocaleString();
  if(g('crm-ap-idle'))g('crm-ap-idle').textContent=(r.idle_count||0).toLocaleString();
  if(g('crm-ap-stop'))g('crm-ap-stop').textContent=(r.stop_count||0).toLocaleString();
  if(g('crm-ss-customers'))g('crm-ss-customers').textContent='selected company';
  if(g('crm-ss-total'))g('crm-ss-total').textContent=r.company||'—';
  if(g('crm-ss-active'))g('crm-ss-active').textContent=tot?Math.round(act/tot*100)+'% of this company':'running+idle+stop';
  if(g('crm-ss-run'))g('crm-ss-run').textContent=act?Math.round((r.running_count||0)/act*100)+'% of active':'—';
  if(g('crm-ss-idle'))g('crm-ss-idle').textContent=act?Math.round((r.idle_count||0)/act*100)+'% of active':'—';
  if(g('crm-ss-stop'))g('crm-ss-stop').textContent=act?Math.round((r.stop_count||0)/act*100)+'% of active':'—';
  if(g('crm-ss-inac'))g('crm-ss-inac').textContent=tot?Math.round((r.inactive_count||0)/tot*100)+'% of company':'—';
  // Show selected company bar
  const bar=document.getElementById('crm-selected-bar');
  const nm=document.getElementById('crm-sel-name');
  const st=document.getElementById('crm-sel-stats');
  if(bar)bar.classList.add('show');
  if(nm)nm.textContent=r.company||'—';
  if(st)st.innerHTML=`
    <span class="crm-sel-stat" style="color:#0a7bc4">🚗 ${(r.total_vehicles||0).toLocaleString()} Total</span>
    <span class="crm-sel-stat" style="color:#10b981">🟢 ${(r.running_count||0).toLocaleString()} Running</span>
    <span class="crm-sel-stat" style="color:#f59e0b">🟡 ${(r.idle_count||0).toLocaleString()} Idle</span>
    <span class="crm-sel-stat" style="color:#64748b">⚫ ${(r.stop_count||0).toLocaleString()} Stop</span>
    <span class="crm-sel-stat" style="color:#ef4444">🔴 ${(r.inactive_count||0).toLocaleString()} Inactive</span>
    <span class="crm-sel-stat" style="color:#7c3aed">${r.tier||'—'}</span>
  `;
}

function crmClearSelection(){
  _crmSelectedIdx=null;
  document.querySelectorAll('#crm-tbl-body tr.crm-row-selected').forEach(tr=>tr.classList.remove('crm-row-selected'));
  const bar=document.getElementById('crm-selected-bar');
  if(bar)bar.classList.remove('show');
}

function crmRenderTable(data){
  const tb=document.getElementById('crm-tbl-body'); if(!tb)return;
  if(!data.length){tb.innerHTML='<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--muted);">No companies found</td></tr>';return;}
  const ec={'guddu':'#6366f1','darshil':'#f59e0b','nitasha':'#10b981'};
  tb.innerHTML=data.map((r,i)=>{
    const tc=r.tier==='Platinum'?'tb-plat':r.tier==='Gold'?'tb-gold':'tb-silv';
    const ti=r.tier==='Platinum'?'💎':r.tier==='Gold'?'🥇':'🥈';
    const t=r.total_vehicles||1;
    const bR=Math.round((r.running_count||0)/t*80),bI=Math.round((r.idle_count||0)/t*80),bS=Math.round((r.stop_count||0)/t*80),bN=Math.max(0,80-bR-bI-bS);
    const syn=r.last_synced?new Date(r.last_synced).toLocaleString():'—';
    const en=r.assigned_to||'—',ek=Object.keys(ec).find(k=>en.toLowerCase().includes(k)),ecol=ek?ec[ek]:'var(--muted)';
    // Find original index in _crmData for selection
    const dataIdx=_crmData.indexOf(r);
    return`<tr onclick="crmSelectRow(${dataIdx},this)" title="Click to see ${r.company||''} details in cards">
      <td style="color:var(--muted);font-weight:500">${i+1}</td>
      <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${r.company||''}">${r.company||'—'}</td>
      <td><span class="crm-tier-badge ${tc}">${ti} ${r.tier||'—'}</span></td>
      <td style="font-weight:700;color:#0a7bc4;">${(r.total_vehicles||0).toLocaleString()}</td>
      <td style="font-weight:600;color:#10b981;">${(r.running_count||0).toLocaleString()}</td>
      <td style="font-weight:600;color:#f59e0b;">${(r.idle_count||0).toLocaleString()}</td>
      <td style="font-weight:600;color:#64748b;">${(r.stop_count||0).toLocaleString()}</td>
      <td style="font-weight:600;color:#ef4444;">${(r.inactive_count||0).toLocaleString()}</td>
      <td><div class="crm-bar"><div class="crm-bar-run" style="width:${bR}px"></div><div class="crm-bar-idle" style="width:${bI}px"></div><div class="crm-bar-stop" style="width:${bS}px"></div><div class="crm-bar-inac" style="width:${bN}px"></div></div></td>
      <td><span class="crm-emp-chip"><span class="crm-emp-dot" style="background:${ecol}"></span>${en}</span></td>
      <td style="font-size:11px;color:var(--muted);">${syn}</td>
    </tr>`;
  }).join('');
}

function crmSwitchServer(s){
  _crmServer=s; _crmLoaded=false;
  ['crm-btn-both','crm-btn-prem','crm-btn-pro','crm-btn-goa','crm-btn-bang','crm-btn-guj'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.className='crm-srv-btn';
  });
  const map={
    'both':'crm-btn-both','Premium Server':'crm-btn-prem','PRO Server':'crm-btn-pro',
    'Goa Server':'crm-btn-goa','Bangalore Server':'crm-btn-bang','Gujarat Server':'crm-btn-guj'
  };
  const activeId=map[s];
  if(activeId){const el=document.getElementById(activeId);if(el)el.className='crm-srv-btn'+(s==='both'?' both-active':' active');}
  loadCRMDashboard();
}

// ── VEHICLE CHANGES ───────────────────────────────────────────
let _chgAddedAll=[], _chgRemovedAll=[];

function _fmtDate(d){
  // IST = UTC+5:30
  const ist = new Date(d.getTime() + (5*60+30)*60000);
  return ist.toISOString().split('T')[0];
}

function crmChgQuick(period){
  // Highlight active button
  ['chg-q-yesterday','chg-q-7d','chg-q-30d'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.className='crm-chg-qbtn';
  });
  const activeMap={'yesterday':'chg-q-yesterday','7d':'chg-q-7d','30d':'chg-q-30d'};
  const btn=document.getElementById(activeMap[period]); if(btn)btn.className='crm-chg-qbtn active';

  // IST today
const now = new Date();
const istOffset = 5*60+30; // minutes
const istNow = new Date(now.getTime() + istOffset*60000);
const today = new Date(istNow.toISOString().split('T')[0]+'T00:00:00.000Z');
  let fromDate, toDate, periodLabel, isLiveToday=false;

  if(period==='yesterday'){
    // Yesterday = literally yesterday's change_date batch
    const yest=new Date(today); yest.setDate(yest.getDate()-1);
    fromDate=_fmtDate(yest); toDate=_fmtDate(yest);
    periodLabel='Yesterday\'s changes ('+_fmtDate(yest)+')';
  } else if(period==='7d'){
    const d=new Date(today); d.setDate(d.getDate()-7);
    fromDate=_fmtDate(d); toDate=_fmtDate(today);
    periodLabel='Last 7 days — '+_fmtDate(d)+' → Today';
  } else if(period==='30d'){
    const d=new Date(today); d.setDate(d.getDate()-30);
    fromDate=_fmtDate(d); toDate=_fmtDate(today);
    periodLabel='Last 30 days — '+_fmtDate(d)+' → Today';
  }

  // Set date pickers to reflect selection
  const fi=document.getElementById('chg-date-from');
  const ti=document.getElementById('chg-date-to');
  if(fi)fi.value=fromDate;
  if(ti)ti.value=toDate==='live'?_fmtDate(today):toDate;

  crmChgLoad(fromDate, toDate, periodLabel, isLiveToday);
}

function crmChgCustom(){
  const from=document.getElementById('chg-date-from')?.value;
  const to=document.getElementById('chg-date-to')?.value;
  if(!from||!to)return;
  if(from>to){alert('From date must be before To date');return;}
  // Deactivate quick buttons
  ['chg-q-yesterday','chg-q-7d','chg-q-30d'].forEach(id=>{
    const el=document.getElementById(id); if(el)el.className='crm-chg-qbtn';
  });
  const todayStr=_fmtDate(new Date());
  const toVal=to===todayStr?'live':to;
  const label=from+' 11:50PM → '+(toVal==='live'?'Now (live)':to+' 11:50PM');
  const isLiveToday=(from===to && to===todayStr);
  crmChgLoad(from, toVal, label, isLiveToday);
}

// ── VEHICLE CHANGES — new logic using vehicle_changes table ──
let _chgDetailType='added', _chgDetailData=[], _chgFromDate='', _chgToDate='';

async function crmChgLoad(fromDate, toDate, periodLabel, isLiveToday){
  const g=id=>document.getElementById(id);
  if(g('chg-added-count'))  g('chg-added-count').textContent='...';
  if(g('chg-removed-count'))g('chg-removed-count').textContent='...';
  if(g('chg-added-pct'))    g('chg-added-pct').textContent='';
  if(g('chg-removed-pct'))  g('chg-removed-pct').textContent='';
  if(g('chg-period-label')) g('chg-period-label').textContent=periodLabel||'—';
  if(g('chg-server-label')) g('chg-server-label').textContent=_crmServer==='both'?'All Servers':_crmServer.replace(' Server','');
  if(g('chg-detail-panel')) g('chg-detail-panel').style.display='none';

  _chgFromDate=fromDate; _chgToDate=toDate==='live'?_fmtDate(new Date()):toDate;

  // Also update KPI deltas to match selected date range
  crmLoadKpiDeltas(fromDate, toDate==='live'?_fmtDate(new Date()):toDate, isLiveToday);

  try{
    const hdrs={...SB_HDRS()};

    // Fetch from vehicle_changes table for the date range
    async function fetchChanges(type){
      let url=`${SUPABASE_URL}/rest/v1/vehicle_changes?select=imeino,vehicle_no,vehicle_name,company,tier,region,change_date&change_type=eq.${type}&change_date=gte.${fromDate}&change_date=lte.${_chgToDate}`;
      if(_crmServer!=='both'){
        url+=`&region=eq.${encodeURIComponent(_crmServer)}`;
      } else {
        const allowedSrvs=_getCRMAllowedServers().filter(s=>s!=='both');
        if(allowedSrvs.length>0 && allowedSrvs.length<5){
          url+=`&region=in.(${allowedSrvs.map(s=>encodeURIComponent(s)).join(',')})`;
        }
      }
      if(_crmTier) url+=`&tier=eq.${encodeURIComponent(_crmTier)}`;
      url+=`&order=change_date.desc&limit=5000`;
      const res=await fetch(url,{headers:hdrs});
      return await res.json();
    }

    const [addedRows, removedRows] = await Promise.all([
      fetchChanges('added'),
      fetchChanges('removed')
    ]);

    const added   = Array.isArray(addedRows)   ? addedRows   : [];
    const removed = Array.isArray(removedRows) ? removedRows : [];

    // Get total vehicles for % calculation
    const totalVehicles = parseInt(g('crm-s-total')?.textContent?.replace(/,/g,'')||'0')||0;

    // Update counts
    if(g('chg-added-count'))   g('chg-added-count').textContent=added.length.toLocaleString();
    if(g('chg-removed-count')) g('chg-removed-count').textContent=removed.length.toLocaleString();

    // Show percentage
    if(totalVehicles>0){
      const addPct=((added.length/totalVehicles)*100).toFixed(1);
      const remPct=((removed.length/totalVehicles)*100).toFixed(1);
      if(g('chg-added-pct'))   g('chg-added-pct').textContent=`+${addPct}% of fleet`;
      if(g('chg-removed-pct')) g('chg-removed-pct').textContent=`-${remPct}% of fleet`;
    }

    // Store for detail view
    window._chgAdded   = added;
    window._chgRemoved = removed;

  }catch(e){
    console.error('Vehicle changes error:',e);
    if(g('chg-added-count'))   g('chg-added-count').textContent='—';
    if(g('chg-removed-count')) g('chg-removed-count').textContent='—';
  }
}
async function crmLoadKpiDeltas(fromDate, toDate, isLiveToday){
  try{
    const hdrs={...SB_HDRS()};
    const g=id=>document.getElementById(id);

    // ── 1. Total Vehicles delta — vehicle_changes se ──
    async function fetchCount(type){
      let url=`${SUPABASE_URL}/rest/v1/vehicle_changes?select=imeino&change_type=eq.${type}&change_date=gte.${fromDate}&change_date=lte.${toDate}`;
      if(_crmServer!=='both'){
        url+=`&region=eq.${encodeURIComponent(_crmServer)}`;
      } else {
        const allowedSrvs=_getCRMAllowedServers().filter(s=>s!=='both');
        if(allowedSrvs.length>0 && allowedSrvs.length<5)
          url+=`&region=in.(${allowedSrvs.map(s=>encodeURIComponent(s)).join(',')})`;
      }
      url+=`&limit=5000`;
      const res=await fetch(url,{headers:hdrs});
      const data=await res.json();
      return Array.isArray(data)?data.length:0;
    }

    // ── 2. Stats delta — daily_fleet_stats se ──
    let statsUrl=`${SUPABASE_URL}/rest/v1/daily_fleet_stats?select=snapshot_date,region,tier,total_vehicles,active_vehicles,running_vehicles,idle_vehicles,stop_vehicles,inactive_vehicles&tier=eq.All&order=snapshot_date.asc&limit=500`;
    if(_crmServer!=='both') statsUrl+=`&region=eq.${encodeURIComponent(_crmServer)}`;

    const [addedCount, removedCount, statsRes] = await Promise.all([
      fetchCount('added'),
      fetchCount('removed'),
      fetch(statsUrl,{headers:hdrs})
    ]);
    const statsRows = await statsRes.json();

    // Total Vehicles arrow
    const net = addedCount - removedCount;
    const totalEl=g('crm-delta-total');
    if(totalEl){
      if(net===0){totalEl.textContent='No change';totalEl.className='crm-kpi-delta neutral';}
      else{
        const arrow=net>0?'▲':'▼';
        const sign=net>0?'+':'';
        totalEl.className='crm-kpi-delta '+(net>0?'up':'down');
        totalEl.textContent=`${arrow} ${sign}${net.toLocaleString()} vehicles`;
      }
    }

    // ── Stats comparison ──
    if(!Array.isArray(statsRows)||!statsRows.length) return;

    const byDate={};
    statsRows.forEach(r=>{
      if(!byDate[r.snapshot_date]) byDate[r.snapshot_date]={active:0,running:0,idle:0,stop:0,inactive:0};
      byDate[r.snapshot_date].active   += r.active_vehicles   ||0;
      byDate[r.snapshot_date].running  += r.running_vehicles  ||0;
      byDate[r.snapshot_date].idle     += r.idle_vehicles     ||0;
      byDate[r.snapshot_date].stop     += r.stop_vehicles     ||0;
      byDate[r.snapshot_date].inactive += r.inactive_vehicles ||0;
    });

    const dates=Object.keys(byDate).sort();
    if(!dates.length) return;

    // FIX (16-Jun-2026): earlier, "base" and "current" were BOTH resolved as
    // "nearest snapshot <= date" using the same date whenever fromDate===toDate —
    // which happens for BOTH "Today" and "Yesterday" quick filters by design.
    // That made base accidentally equal current for "Yesterday" too, wrongly
    // triggering the live-data fallback (meant ONLY for "Today") — comparing
    // live-right-now numbers against a snapshot from several days back, which
    // produced fake 700%+ jumps. Now each mode is resolved explicitly so base
    // and current always land on the correct, distinct dates.
    let current, baseDate;

    if(isLiveToday){
      // "Today": current = LIVE right now, base = most recent snapshot on/before fromDate
      current={
        active:   parseInt((g('crm-s-active')?.textContent||'0').replace(/,/g,''))||0,
        running:  parseInt((g('crm-s-run')?.textContent||'0').replace(/,/g,''))   ||0,
        idle:     parseInt((g('crm-s-idle')?.textContent||'0').replace(/,/g,''))  ||0,
        stop:     parseInt((g('crm-s-stop')?.textContent||'0').replace(/,/g,''))  ||0,
        inactive: parseInt((g('crm-s-inac')?.textContent||'0').replace(/,/g,''))  ||0,
      };
      const baseDates=dates.filter(d=>d<=fromDate);
      baseDate=baseDates.length?baseDates[baseDates.length-1]:dates[0];
    } else if(fromDate===toDate){
      // Single specific historical day (e.g. "Yesterday", or a custom single-day pick):
      // current = that day's OWN snapshot, base = nearest snapshot STRICTLY BEFORE it
      // (never the same date as current, even across a multi-day gap)
      const currDates=dates.filter(d=>d<=toDate);
      const currDate=currDates.length?currDates[currDates.length-1]:null;
      if(!currDate) return;
      current=byDate[currDate];
      const baseDates=dates.filter(d=>d<currDate);
      baseDate=baseDates.length?baseDates[baseDates.length-1]:null;
      if(!baseDate) return;
    } else {
      // Multi-day range (Last 7/30 days, custom range)
      const currDates=dates.filter(d=>d<=toDate);
      const currDate=currDates.length?currDates[currDates.length-1]:null;
      if(!currDate) return;
      current=byDate[currDate];
      const baseDates=dates.filter(d=>d<=fromDate);
      baseDate=baseDates.length?baseDates[baseDates.length-1]:dates[0];
    }

    const base=baseDate?byDate[baseDate]:null;
    if(!base||!current) return;

    const fields=[
      {key:'active',  elId:'crm-delta-active'},
      {key:'running', elId:'crm-delta-run'},
      {key:'idle',    elId:'crm-delta-idle'},
      {key:'stop',    elId:'crm-delta-stop'},
      {key:'inactive',elId:'crm-delta-inac'},
    ];
    fields.forEach(({key,elId})=>{
      const el=g(elId); if(!el) return;
      const diff=current[key]-base[key];
      if(diff===0){el.textContent='No change';el.className='crm-kpi-delta neutral';return;}
      const pct=base[key]>0?((Math.abs(diff)/base[key])*100).toFixed(1):'—';
      const arrow=diff>0?'▲':'▼';
      const sign=diff>0?'+':'';
      el.className='crm-kpi-delta '+(diff>0?'up':'down');
      el.textContent=`${arrow} ${sign}${diff.toLocaleString()} (${pct}%)`;
    });

  }catch(e){
    console.error('KPI delta error:',e);
  }
}

// ── PLATINUM CUSTOMER VEHICLE-REDUCTION ALERTS ──────────────────
async function loadCustomerAlerts(){
  const wrap=document.getElementById('crm-alerts-banner');
  const list=document.getElementById('crm-alerts-list');
  if(!wrap||!list) return;
  try{
    const hdrs={...SB_HDRS()};
    const url=`${SUPABASE_URL}/rest/v1/customer_alerts?select=*&acknowledged=eq.false&order=pct_drop.desc&limit=20`;
    const res=await fetch(url,{headers:hdrs});
    const rows=await res.json();
    if(!Array.isArray(rows)||!rows.length){
      wrap.style.display='none';
      list.innerHTML='';
      return;
    }
    wrap.style.display='block';
    list.innerHTML=rows.map(r=>`
      <div class="crm-alert-card">
        <div class="crm-alert-left">
          <div class="crm-alert-icon">⚠️</div>
          <div>
            <div class="crm-alert-text">💎 <b>${r.company_name}</b>'s vehicle count dropped <b>${r.pct_drop}%</b></div>
            <div class="crm-alert-sub">${Math.round(r.baseline_avg)} (7-day average) → ${r.current_count} vehicles · ${r.alert_date}</div>
          </div>
        </div>
        <button class="crm-alert-ack-btn" onclick="crmAcknowledgeAlert(${r.id})">Acknowledge</button>
      </div>
    `).join('');
  }catch(e){
    console.error('Customer alerts load error:',e);
  }
}

async function crmAcknowledgeAlert(id){
  try{
    const hdrs={...SB_HDRS_MIN()};
    const url=`${SUPABASE_URL}/rest/v1/customer_alerts?id=eq.${id}`;
    await fetch(url,{
      method:'PATCH',
      headers:hdrs,
      body:JSON.stringify({
        acknowledged: true,
        acknowledged_by: (typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.name)||'Unknown',
        acknowledged_at: new Date().toISOString()
      })
    });
    loadCustomerAlerts();
  }catch(e){
    console.error('Acknowledge alert error:',e);
  }
}

function crmChgShowDetail(type){
  const g=id=>document.getElementById(id);
  const panel=g('chg-detail-panel');
  if(!panel)return;

  _chgDetailType=type;
  const rows=type==='added'?(window._chgAdded||[]):(window._chgRemoved||[]);
  _chgDetailData=rows;

  const color=type==='added'?'#10b981':'#ef4444';
  const emoji=type==='added'?'🟢':'🔴';
  if(g('chg-detail-title')) g('chg-detail-title').innerHTML=`${emoji} <span style="color:${color}">${rows.length.toLocaleString()} Vehicles ${type==='added'?'Added':'Removed'}</span> — Company Breakdown`;
  if(g('chg-detail-search')) g('chg-detail-search').value='';

  panel.style.display='block';
  crmChgRenderDetail(rows, type);
}

function crmChgFilterDetail(){
  const q=(document.getElementById('chg-detail-search')?.value||'').toLowerCase();
  const rows=_chgDetailType==='added'?(window._chgAdded||[]):(window._chgRemoved||[]);
  const filtered=q?rows.filter(r=>(r.company||'').toLowerCase().includes(q)||(r.vehicle_no||'').toLowerCase().includes(q)):rows;
  crmChgRenderDetail(filtered,_chgDetailType);
}

function crmChgRenderDetail(rows, type){
  const body=document.getElementById('chg-detail-body');
  if(!body)return;
  if(!rows.length){
    body.innerHTML=`<div style="text-align:center;padding:24px;color:var(--muted);font-size:0.84rem;">No data found</div>`;
    return;
  }

  // Group by company
  const companyMap={};
  rows.forEach(r=>{
    const co=r.company||'Unknown';
    if(!companyMap[co]) companyMap[co]={count:0,tier:r.tier||'',region:r.region||''};
    companyMap[co].count++;
  });

  const sorted=Object.entries(companyMap).sort((a,b)=>b[1].count-a[1].count);
  const color=type==='added'?'#10b981':'#ef4444';
  const sign =type==='added'?'+':'-';

  body.innerHTML=sorted.map(([company,info])=>`
    <div class="chg-company-row">
      <div>
        <div class="chg-company-name">${company}</div>
        <div style="font-size:0.70rem;color:var(--muted);">${info.tier?info.tier+' · ':''}${(info.region||'').replace(' Server','')}</div>
      </div>
      <div class="chg-company-count ${type}" style="color:${color};">${sign}${info.count}</div>
    </div>`).join('');
}

// Legacy stubs so nothing breaks
function crmChgRenderTable(){}
function crmChgFilterTable(){}
// ── END VEHICLE CHANGES ───────────────────────────────────────
function crmSwitchTier(t){
  _crmTier=t;
  document.querySelectorAll('#panel-crm .crm-tier-btn').forEach(b=>b.classList.remove('active'));
  const m={'':'crm-tf-all','Platinum':'crm-tf-plat','Gold':'crm-tf-gold','Silver':'crm-tf-silv'};
  const el=document.getElementById(m[t]); if(el)el.classList.add('active');
  crmApplyFilters();
}
function crmFilterStatus(s){
  _crmStatus=s;
  document.querySelectorAll('#panel-crm .crm-card').forEach(c=>c.classList.remove('active-filter'));
  if(s){const m={RUNNING:'crm-card-run',IDLE:'crm-card-idle',STOP:'crm-card-stop',INACTIVE:'crm-card-inac'};const el=document.getElementById(m[s]);if(el)el.classList.add('active-filter');}
  crmClearSelection();
  crmApplyFilters();
}
setInterval(()=>{if(_crmLoaded&&!_crmSelectedIdx)loadCRMDashboard();},5*60*1000);



