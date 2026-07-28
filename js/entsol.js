// Section: Enterprise Solutions Dashboard (loadEnterpriseSolutions, ClickTask + CoolBus)
// Data source: Google Apps Script (ESOL_URL) — single JSON payload with two products
// Access control: PERMISSIONS.can_view_entsol (see _canAccessEnterpriseSolutions below)
// UI note: this panel is a fixed-light "product card" reskin (see #panel-entsol in
// styles.css) independent of the app's dark/light toggle, so chart/text colours
// below are hardcoded to match that white-card palette — do NOT swap in chartColors().

// ── Access control ──────────────────────────────────────────────────────
// Dedicated permission key (can_view_entsol), decoupled from Enterprise Lead's
// can_view_enterprise — same default audience today (Owner/MIS/PC/EA), but the
// two dashboards can be granted independently once the Python permissions
// backend adds a can_view_entsol column (see _canAccessEnterprise in
// js/enterprise.js for the same pattern — that's the column to mirror there).
function _canAccessEnterpriseSolutions(){
  if(!CURRENT_USER) return false;
  if (PERMISSIONS.can_view_entsol === undefined) {
    const r = String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim();
    return r === 'owner' || r === 'mis' || r === 'pc' || r === 'executive assistant' || r === 'ea';
  }
  return PERMISSIONS.can_view_entsol === 'true';
}
function _applyEnterpriseSolutionsNavVisibility(){
  const show = _canAccessEnterpriseSolutions();
  const el = document.getElementById('nav-entsol');
  const mm = document.getElementById('mm-entsol');
  if(el) el.style.display = show ? 'flex' : 'none';
  if(mm) mm.style.display = show ? 'flex' : 'none';
}

const ESOL_URL='https://script.google.com/macros/s/AKfycby5CHFwhQnIhLKetozrK6Tnf-81gyV9eaMt57fQawzXk5T384VrJCrbydCGaOWtXncF/exec';
let ESOL=null,ESOL_TAB='clicktask',ESOLch={},ESOLp=1,ESOLsk=null,ESOLsd=1,ESOLtblOpen=true;
let ESOL_ROWS={clicktask:[],coolbus:[]},ESOLf=[];
let ESOLcf={location:null,type:null,school:null};
const ESOLPP=15;
const ESOL_TC='#475569',ESOL_GC='rgba(15,23,42,0.07)',ESOL_DIM='rgba(15,23,42,0.09)';
const ESOL_SC=['#00d4aa','#f0a500','#4e9af1','#a78bfa','#ff5c7c','#f97316','#10b981','#ec4899'];
const ESOL_TOOLTIP={backgroundColor:'#1e293b',titleColor:'#fff',titleFont:{family:'DM Sans',size:11,weight:'700'},bodyColor:'#e2e8f0',bodyFont:{family:'DM Sans',size:11},padding:10,cornerRadius:8,displayColors:false};
// Horizontal-bar fill: a left→right gradient wash in the given colour, or the
// flat dim colour when this bar is filtered out — dimmed bars stay flat on
// purpose so only the active/selected bars carry the "premium" gradient look.
function esolBarFill(ctx,color,dimmed){
  if(dimmed)return ESOL_DIM;
  const area=ctx.chart.chartArea;
  if(!area)return color;
  const g=ctx.chart.ctx.createLinearGradient(area.left,0,area.right,0);
  g.addColorStop(0,color+'66');g.addColorStop(1,color);
  return g;
}
// Doughnut center-total — a small Chart.js plugin baked per-instance via
// closure (value/label are fixed at creation time, no external state needed).
function esolCenterText(value,label){
  return {id:'esolCenterText',afterDraw(chart){
    const {ctx,chartArea}=chart;if(!chartArea)return;
    const cx=chartArea.left+chartArea.width/2,cy=chartArea.top+chartArea.height/2;
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font="800 19px 'DM Sans',sans-serif";ctx.fillStyle='#111827';
    ctx.fillText(value,cx,cy-9);
    ctx.font="600 9.5px 'DM Sans',sans-serif";ctx.fillStyle='#94a0b8';
    ctx.fillText(label,cx,cy+10);
    ctx.restore();
  }};
}
const ESOL_ICO={
  users:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  tag:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24L3 3v6.59a2 2 0 00.59 1.41l9.58 9.58a2 2 0 002.82 0l4.6-4.6a2 2 0 000-2.82z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
  clock:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  bars:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  trophy:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 5h3a3 3 0 01-3 4M7 5H4a3 3 0 003 4"/></svg>',
  building:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/></svg>'
};

async function loadEnterpriseSolutions(){
  if(!_canAccessEnterpriseSolutions()){ switchDB('home'); return; }
  try{
    const res=await fetch(ESOL_URL);if(!res.ok)throw new Error(res.status);
    const data=await res.json();
    if(!data||!data.clicktask||!data.coolbus)throw new Error('API returned an unexpected shape — expected {clicktask, coolbus}');
    ESOL=data;
    const ct=ESOL.clicktask,cb=ESOL.coolbus;
    ESOL_ROWS.clicktask=[
      ...(ct.customers||[]).map(r=>({...r,_Type:'Customer'})),
      ...(ct.trials||[]).map(r=>({...r,_Type:'Trial'}))
    ];
    ESOL_ROWS.coolbus=(cb.schools||[]).map(r=>({...r}));
    document.getElementById('esolLoad').style.display='none';document.getElementById('esolCont').style.display='block';
    document.getElementById('esolErr').style.display='none';
    const syncSrc=ESOL.lastUpdated?new Date(ESOL.lastUpdated):new Date();
    document.getElementById('esolSync').textContent='Sync: '+syncSrc.toLocaleTimeString('en-IN');
    document.getElementById('esolSwSubCt').textContent=(ct.totalCustomers||0)+' customers · '+(ct.totalCustomerLicenses||0).toLocaleString('en-IN')+' licenses';
    document.getElementById('esolSwSubCb').textContent=(cb.totalSchools||0)+' schools · '+(cb.totalSchoolLicenses||0).toLocaleString('en-IN')+' licenses';
    esolRenderAll();
  }catch(e){
    document.getElementById('esolLoad').style.display='none';document.getElementById('esolCont').style.display='block';
    document.getElementById('esolErr').style.display='block';document.getElementById('esolErr').textContent='⚠️ Data load failed: '+e.message;
  }
}
async function refreshEnterpriseSolutions(){
  if(!_canAccessEnterpriseSolutions()) return;
  const b=document.getElementById('esolRefBtn');if(b)b.classList.add('spinning');
  Object.values(ESOLch).forEach(c=>c&&c.destroy&&c.destroy());ESOLch={};
  document.getElementById('esolLoad').style.display='flex';document.getElementById('esolCont').style.display='none';
  await loadEnterpriseSolutions();
  if(b)b.classList.remove('spinning');
}
function esolSwitchTab(tab){
  if(tab===ESOL_TAB)return;
  ESOL_TAB=tab;ESOLsk=null;ESOLsd=1;ESOLp=1;ESOLcf={location:null,type:null,school:null};
  document.getElementById('esolBtn-clicktask').classList.toggle('esol-switch-active',tab==='clicktask');
  document.getElementById('esolBtn-coolbus').classList.toggle('esol-switch-active',tab==='coolbus');
  document.getElementById('esolCharts-clicktask').style.display=tab==='clicktask'?'grid':'none';
  document.getElementById('esolCharts-coolbus').style.display=tab==='coolbus'?'grid':'none';
  document.getElementById('esolChartsTitle').textContent=tab==='clicktask'?'ClickTask Analytics':'CoolBus Analytics';
  document.getElementById('esolTblTitle').textContent=tab==='clicktask'?'ClickTask Deployments':'CoolBus Deployments';
  document.getElementById('esolFType').style.display=tab==='clicktask'?'':'none';
  document.getElementById('esolSearch').value='';
  document.getElementById('esolFType').value='';
  esolRenderAll();esolBadge();
}
function esolRenderAll(){esolRenderKPIs();esolRenderCharts();esolApply();}
function esolTopBy(arr,key){return arr.reduce((m,r)=>(+r[key]>+(m?m[key]:-1)?r:m),null);}
// Deterministic initial + colour per name (same customer/school always gets
// the same avatar colour across re-renders/pages, picked by a simple hash).
function esolAvatar(name){
  const s=(name||'?').trim();
  let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}
  return {initial:s[0]?s[0].toUpperCase():'?',color:ESOL_SC[Math.abs(h)%ESOL_SC.length]};
}
function esolRenderKPIs(){
  let kpis=[];
  if(ESOL_TAB==='clicktask'){
    const d=ESOL.clicktask;
    const avg=d.totalCustomers?(d.totalCustomerLicenses/d.totalCustomers).toFixed(1):'—';
    const top=esolTopBy(d.customers||[],'licenseCount');
    kpis=[
      {l:'Total Customers',v:d.totalCustomers||0,s:'Active license holders',a:'#00d4aa',i:ESOL_ICO.users},
      {l:'Total Licenses',v:(d.totalCustomerLicenses||0).toLocaleString('en-IN'),s:'Across all customers',a:'#f0a500',i:ESOL_ICO.tag},
      {l:'Trial Customers',v:d.totalTrialCustomers||0,s:(d.totalTrialLicenses||0)+' trial licenses',a:'#a78bfa',i:ESOL_ICO.clock},
      {l:'Avg Licenses / Customer',v:avg,s:'Mean deployment size',a:'#4e9af1',i:ESOL_ICO.bars},
      {l:'Largest Deployment',v:top?top.customer:'—',s:top?top.licenseCount.toLocaleString('en-IN')+' licenses · '+top.location:'—',a:'#ff5c7c',i:ESOL_ICO.trophy}
    ];
  }else{
    const d=ESOL.coolbus;
    const avg=d.totalSchools?(d.totalSchoolLicenses/d.totalSchools).toFixed(1):'—';
    const top=esolTopBy(d.schools||[],'licenseCount');
    kpis=[
      {l:'Total Schools',v:d.totalSchools||0,s:'Active deployments',a:'#4e9af1',i:ESOL_ICO.building},
      {l:'Total Licenses',v:(d.totalSchoolLicenses||0).toLocaleString('en-IN'),s:'Across all schools',a:'#00d4aa',i:ESOL_ICO.tag},
      {l:'Avg Licenses / School',v:avg,s:'Mean deployment size',a:'#f0a500',i:ESOL_ICO.bars},
      {l:'Largest Deployment',v:top?top.school:'—',s:top?top.licenseCount.toLocaleString('en-IN')+' licenses':'—',a:'#ff5c7c',i:ESOL_ICO.trophy}
    ];
  }
  document.getElementById('esolKpiGrid').innerHTML=kpis.map(k=>`<div class="kpi-card" style="--card-accent:${k.a};--card-color:${k.a};cursor:default"><div class="esol-kpi-icon" style="background:${k.a}1f;color:${k.a}">${k.i}</div><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
}
function esolBadge(){
  const b=document.getElementById('esolCFBadge');if(!b)return;
  const parts=[];
  if(ESOLcf.location)parts.push(ESOLcf.location);
  if(ESOLcf.type)parts.push(ESOLcf.type);
  if(ESOLcf.school)parts.push(ESOLcf.school);
  if(parts.length){b.style.display='flex';b.innerHTML='🎯 Filter: <strong style="color:#7c3aed">'+parts.join(' + ')+'</strong> <span onclick="esolClearFilter()" style="cursor:pointer;color:#e03e5c;margin-left:8px;font-weight:600">✕ Clear</span>';}
  else b.style.display='none';
}
function esolCF(key,val){
  ESOLcf[key]=ESOLcf[key]===val?null:val;
  esolBadge();esolRenderCharts();esolApply();
}
function esolClearFilter(){ESOLcf={location:null,type:null,school:null};esolBadge();esolRenderCharts();esolApply();}
function esolRenderCharts(){
  Object.values(ESOLch).forEach(c=>c&&c.destroy&&c.destroy());ESOLch={};
  const eTC=ESOL_TC,eGC=ESOL_GC;
  const legendOpt={position:'right',labels:{color:eTC,padding:10,usePointStyle:true,pointStyle:'circle',font:{family:'DM Sans',size:10}}};
  const barLabelOpt={anchor:'end',align:'end',color:'#334155',font:{family:'DM Sans',size:10,weight:'600'},formatter:v=>v.toLocaleString('en-IN')};
  if(ESOL_TAB==='clicktask'){
    const d=ESOL.clicktask;
    const top=[...(d.customers||[])].sort((a,b)=>b.licenseCount-a.licenseCount).slice(0,10);
    ESOLch.ctTop=new Chart(document.getElementById('esolChCtTop'),{type:'bar',data:{labels:top.map(r=>r.customer),datasets:[{data:top.map(r=>r.licenseCount),backgroundColor:ctx=>esolBarFill(ctx,'#00d4aa'),borderRadius:6,borderWidth:0,maxBarThickness:18}]},options:{indexAxis:'y',layout:{padding:{right:34}},plugins:{legend:{display:false},tooltip:ESOL_TOOLTIP,datalabels:barLabelOpt},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
    document.getElementById('esolChCtTop').style.cursor='pointer';

    const loc={};(d.customers||[]).forEach(r=>{const l=r.location||'Unspecified';loc[l]=(loc[l]||0)+1;});
    const lk=Object.keys(loc);
    ESOLch.ctLoc=new Chart(document.getElementById('esolChCtLoc'),{type:'doughnut',data:{labels:lk,datasets:[{data:lk.map(k=>loc[k]),backgroundColor:lk.map((k,i)=>ESOLcf.location&&ESOLcf.location!==k?ESOL_DIM:ESOL_SC[i%ESOL_SC.length]),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{cutout:'68%',onClick:(_,e)=>{if(e.length)esolCF('location',lk[e[0].index]);},plugins:{legend:legendOpt,tooltip:ESOL_TOOLTIP,datalabels:{display:false}},responsive:true,maintainAspectRatio:false},plugins:[esolCenterText(d.totalCustomers||0,'Customers')]});
    document.getElementById('esolChCtLoc').style.cursor='pointer';

    const mixLabels=['Live Licenses','Trial Licenses'];
    const mixData=[d.totalCustomerLicenses||0,d.totalTrialLicenses||0];
    const mixKeys=['Customer','Trial'];
    const mixTotal=(d.totalCustomerLicenses||0)+(d.totalTrialLicenses||0);
    ESOLch.ctMix=new Chart(document.getElementById('esolChCtMix'),{type:'doughnut',data:{labels:mixLabels,datasets:[{data:mixData,backgroundColor:mixKeys.map(k=>ESOLcf.type&&ESOLcf.type!==k?ESOL_DIM:(k==='Customer'?'#00d4aa':'#a78bfa')),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{cutout:'65%',onClick:(_,e)=>{if(e.length)esolCF('type',mixKeys[e[0].index]);},plugins:{legend:legendOpt,tooltip:ESOL_TOOLTIP,datalabels:{display:false}},responsive:true,maintainAspectRatio:false},plugins:[esolCenterText(mixTotal.toLocaleString('en-IN'),'Total Licenses')]});
    document.getElementById('esolChCtMix').style.cursor='pointer';
  }else{
    const d=ESOL.coolbus;
    const sch=[...(d.schools||[])].sort((a,b)=>b.licenseCount-a.licenseCount);
    ESOLch.cbBar=new Chart(document.getElementById('esolChCbBar'),{type:'bar',data:{labels:sch.map(r=>r.school),datasets:[{data:sch.map(r=>r.licenseCount),backgroundColor:ctx=>{const r=sch[ctx.dataIndex];return esolBarFill(ctx,'#4e9af1',r&&ESOLcf.school&&ESOLcf.school!==r.school);},borderRadius:6,borderWidth:0,maxBarThickness:18}]},options:{indexAxis:'y',layout:{padding:{right:38}},onClick:(_,e)=>{if(e.length)esolCF('school',sch[e[0].index].school);},plugins:{legend:{display:false},tooltip:ESOL_TOOLTIP,datalabels:barLabelOpt},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
    document.getElementById('esolChCbBar').style.cursor='pointer';

    ESOLch.cbShare=new Chart(document.getElementById('esolChCbShare'),{type:'doughnut',data:{labels:sch.map(r=>r.school),datasets:[{data:sch.map(r=>r.licenseCount),backgroundColor:sch.map((r,i)=>ESOLcf.school&&ESOLcf.school!==r.school?ESOL_DIM:ESOL_SC[i%ESOL_SC.length]),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{cutout:'62%',onClick:(_,e)=>{if(e.length)esolCF('school',sch[e[0].index].school);},plugins:{legend:{position:'right',labels:{color:eTC,padding:8,usePointStyle:true,pointStyle:'circle',font:{family:'DM Sans',size:9.5}}},tooltip:ESOL_TOOLTIP,datalabels:{display:false}},responsive:true,maintainAspectRatio:false},plugins:[esolCenterText((d.totalSchoolLicenses||0).toLocaleString('en-IN'),'Total Licenses')]});
    document.getElementById('esolChCbShare').style.cursor='pointer';
  }
}
function esolApply(){
  const q=(document.getElementById('esolSearch').value||'').toLowerCase();
  const rows=ESOL_ROWS[ESOL_TAB]||[];
  if(ESOL_TAB==='clicktask'){
    const ty=document.getElementById('esolFType').value;
    ESOLf=rows.filter(r=>{
      if(q&&!((r.customer||'').toLowerCase().includes(q)||(r.location||'').toLowerCase().includes(q)))return false;
      if(ty&&r._Type!==ty)return false;
      if(ESOLcf.location&&(r.location||'Unspecified')!==ESOLcf.location)return false;
      if(ESOLcf.type&&r._Type!==ESOLcf.type)return false;
      return true;
    });
  }else{
    ESOLf=rows.filter(r=>{
      if(q&&!(r.school||'').toLowerCase().includes(q))return false;
      if(ESOLcf.school&&r.school!==ESOLcf.school)return false;
      return true;
    });
  }
  if(ESOLsk)ESOLf.sort((a,b)=>{let av=a[ESOLsk]??'',bv=b[ESOLsk]??'';if(av!==''&&bv!==''&&!isNaN(av)&&!isNaN(bv))return(+av-+bv)*ESOLsd;return String(av).localeCompare(String(bv))*ESOLsd;});
  ESOLp=1;esolRenderTable();
}
function esolReset(){document.getElementById('esolSearch').value='';document.getElementById('esolFType').value='';ESOLsk=null;ESOLsd=1;ESOLcf={location:null,type:null,school:null};esolBadge();esolRenderCharts();esolApply();}
function esolSort(k){ESOLsk=ESOLsk===k?(ESOLsd*=-1,k):(ESOLsd=1,k);esolApply();}
function esolToggleTable(){
  ESOLtblOpen=!ESOLtblOpen;
  const wrap=document.getElementById('esolTblBodyWrap');
  const ico=document.getElementById('esolTblToggleIco');
  if(wrap)wrap.style.display=ESOLtblOpen?'':'none';
  if(ico)ico.textContent=ESOLtblOpen?'−':'+';
}
function esolRenderTable(){
  const isCt=ESOL_TAB==='clicktask';
  const totLic=isCt?((ESOL.clicktask.totalCustomerLicenses||0)+(ESOL.clicktask.totalTrialLicenses||0)):(ESOL.coolbus.totalSchoolLicenses||0);
  const heads=isCt
    ?[{k:'srNo',l:'SR NO',s:true},{k:'customer',l:'CUSTOMER',s:true},{k:'_Type',l:'TYPE',s:true},{k:'location',l:'LOCATION',s:false},{k:'licenseCount',l:'LICENSES',s:true}]
    :[{k:'srNo',l:'SR NO',s:true},{k:'school',l:'SCHOOL',s:true},{k:'licenseCount',l:'LICENSES',s:true},{k:'_share',l:'SHARE OF TOTAL',s:false}];
  const thh=document.getElementById('esolTblHead');if(thh)thh.innerHTML=heads.map(h=>h.s?`<th onclick="esolSort('${h.k}')">${h.l} ↕</th>`:`<th>${h.l}</th>`).join('');
  const tot=ESOLf.length,tp=Math.max(1,Math.ceil(tot/ESOLPP));
  if(ESOLp>tp)ESOLp=tp;
  const pg=ESOLf.slice((ESOLp-1)*ESOLPP,ESOLp*ESOLPP);
  document.getElementById('esolTblCnt').textContent=tot+(isCt?' record':' school')+(tot!==1?'s':'');
  const tb=document.getElementById('esolTblBody');
  if(!pg.length){tb.innerHTML=`<tr><td colspan="${heads.length}"><div class="empty-state">No records found</div></td></tr>`;document.getElementById('esolPagBar').innerHTML='';return;}
  tb.innerHTML=pg.map(r=>{
    if(isCt){
      const bc=r._Type==='Trial'?'badge-warm':'badge-won';
      const av=esolAvatar(r.customer);
      return `<tr><td style="font-size:0.83rem;color:#94a0b8;font-variant-numeric:tabular-nums">${r.srNo??'—'}</td><td style="font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="esol-avatar" style="background:${av.color}">${av.initial}</span>${r.customer||'—'}</td><td><span class="badge ${bc}">${r._Type}</span></td><td style="font-size:0.83rem">${r.location||'—'}</td><td style="font-weight:700;color:#6d28d9;font-variant-numeric:tabular-nums">${(r.licenseCount||0).toLocaleString('en-IN')}</td></tr>`;
    }
    const sharePct=totLic?((r.licenseCount||0)/totLic)*100:0;
    const av=esolAvatar(r.school);
    return `<tr><td style="font-size:0.83rem;color:#94a0b8;font-variant-numeric:tabular-nums">${r.srNo??'—'}</td><td style="font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="esol-avatar" style="background:${av.color}">${av.initial}</span>${r.school||'—'}</td><td style="font-weight:700;color:#6d28d9;font-variant-numeric:tabular-nums">${(r.licenseCount||0).toLocaleString('en-IN')}</td><td><div class="esol-share-wrap"><div class="esol-share-track"><div class="esol-share-fill" style="width:${sharePct.toFixed(1)}%"></div></div><span style="font-size:0.79rem;color:#94a0b8;font-variant-numeric:tabular-nums">${sharePct.toFixed(1)}%</span></div></td></tr>`;
  }).join('');
  document.getElementById('esolPagBar').innerHTML=enPagerHTML(ESOLp,tp,'esolGoPage');
}
function esolGoPage(p){const tp=Math.ceil(ESOLf.length/ESOLPP)||1;if(p<1||p>tp)return;ESOLp=p;esolRenderTable();document.querySelector('#panel-entsol .table-card').scrollIntoView({behavior:'smooth',block:'start'});}
