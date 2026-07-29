// Section: Enterprise Lead Dashboard (loadEnterprise, charts, filters, table)
// Data source: Google Apps Script (EN_URL) — a call-tracking lead funnel sheet:
// one row per lead, up to 6 dialling attempts (Connected/Time/Stage per call).
// Fully dynamic, click-to-filter.

// ── Access control ──────────────────────────────────────────────────────
function _canAccessEnterprise(){
  if(!CURRENT_USER) return false;
  // The Python permissions backend doesn't have a can_view_enterprise column yet,
  // so it never sends this key. Until it does, fall back to the same role
  // default used elsewhere (Owner / MIS / PC / Executive Assistant). Once the
  // backend starts returning an explicit 'true'/'false' for this key, that
  // value takes over automatically.
  if (PERMISSIONS.can_view_enterprise === undefined) {
    const r = String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim();
    return r === 'owner' || r === 'mis' || r === 'pc' || r === 'executive assistant' || r === 'ea';
  }
  return PERMISSIONS.can_view_enterprise === 'true';
}
function _applyEnterpriseNavVisibility(){
  const show = _canAccessEnterprise();
  const el = document.getElementById('nav-enterprise');
  const mm = document.getElementById('mm-enterprise');
  if(el) el.style.display = show ? 'flex' : 'none';
  if(mm) mm.style.display = show ? 'flex' : 'none';
}

// ── ENTERPRISE LEAD DASHBOARD ───────────────────────────────────────────
const EN_URL='https://script.google.com/macros/s/AKfycbw5Jl0VME63SwnUhNQhANdmGcNdedK0yIz9n6LdtpLwaSM_p5sqG181rSwdYYhMbLeJ/exec';
let EN=[],ENf=[],ENch={},ENp=1,ENsk=null,ENsd=1,ENkpi=null,ENtblOpen=true;
let ENcf={status:null,city:null,owner:null,source:null,product:null,milestone:null};
const ENPP=15;
const EN_CALL_SUFFIX=['1st','2nd','3rd','4th','5th','6th'];

// Colour + badge-class helpers for the lead's current stage (the most recent
// call's outcome — see _CurrentStage below).
function enStatusColor(v){
  const s=(v||'').toString().toLowerCase();
  if(s==='interested')return '#4e9af1';
  if(s==='demo scheduled')return '#f0a500';
  if(s==='quotation')return '#a78bfa';
  if(s==='won')return '#00d4aa';
  if(s==='lost')return '#ff5c7c';
  if(s==='invalid')return '#6b7280';
  return '#9ca3af';
}
function enStatusBadge(v){
  const s=(v||'').toString().toLowerCase();
  if(s==='interested')return 'badge-cold';
  if(s==='demo scheduled')return 'badge-warm';
  if(s==='quotation')return 'badge-quote';
  if(s==='won')return 'badge-won';
  if(s==='lost')return 'badge-lost';
  if(s==='invalid')return 'badge-open';
  return 'badge-open';
}
// "dd/mm/yyyy hh:mm AM/PM" → {key:'yyyy-mm-dd', ts: epoch millis} — key is
// used for grouping/filtering by calendar day, ts for numeric sorting.
function enParseEntry(s){
  const m=(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if(!m)return{key:'',ts:0};
  let[,d,mo,y,h,mi,ap]=m;h=+h;
  if(ap){ap=ap.toUpperCase();if(ap==='PM'&&h!==12)h+=12;if(ap==='AM'&&h===12)h=0;}
  const dt=new Date(+y,+mo-1,+d,h,+mi);
  const key=y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  return{key,ts:dt.getTime()};
}
function enTodayKey(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
async function loadEnterprise(){
  if(!_canAccessEnterprise()){ switchDB('home'); return; }
  try{
    const res=await fetch(EN_URL);if(!res.ok)throw new Error(res.status);
    let rows=await res.json();
    if(rows&&!Array.isArray(rows)&&rows.h&&rows.r){
      const headers=rows.h;
      rows=rows.r.map(row=>{const obj={};headers.forEach((k,i)=>{obj[k]=row[i]??'';});return obj;});
    }else if(rows&&!Array.isArray(rows)&&rows.data&&Array.isArray(rows.data)){
      rows=rows.data;
    }else if(rows&&!Array.isArray(rows)&&rows.rows&&Array.isArray(rows.rows)){
      rows=rows.rows;
    }
    if(!Array.isArray(rows)||!rows.length)throw new Error('API returned empty or invalid data');
    EN=rows.map(r=>{
      const calls=EN_CALL_SUFFIX.map(suf=>({
        connected:(r[suf+' Call - Connected']||'').toString().trim(),
        time:(r[suf+' Call - Time']||'').toString().trim(),
        stage:(r[suf+' Call - Stage']||'').toString().trim()
      }));
      const attempted=calls.filter(c=>c.connected);
      const connected=calls.filter(c=>c.connected==='Yes');
      const stageSet=new Set(calls.map(c=>c.stage).filter(Boolean));
      let currentStage='Not Contacted';
      for(let i=calls.length-1;i>=0;i--){if(calls[i].stage){currentStage=calls[i].stage;break;}}
      const entry=enParseEntry((r['Lead Entry']||'').toString().trim());
      const revenue=parseFloat(String(r['Revenue']||'').replace(/[^0-9.\-]/g,''))||0;
      return{
        _SrNo:r['SR.No']??'',
        _Name:(r['Lead Name']||'').toString().trim(),
        _Phone:(r['Contact No']||'').toString().trim(),
        _Email:(r['Email id']||'').toString().trim(),
        _City:(r['City']||'').toString().trim(),
        _EntryRaw:(r['Lead Entry']||'').toString().trim(),
        _EntryKey:entry.key,
        _EntryTs:entry.ts,
        _Source:(r['Source']||'').toString().trim()||'Direct / Unspecified',
        _Product:(r['Product']||'').toString().trim()||'Unspecified',
        _Owner:(r['Lead Owner']||'').toString().trim()||'Unassigned',
        _Comments:(r['Comments']||'').toString().trim(),
        _Reason:(r['Reason for Lost']||'').toString().trim(),
        _Revenue:revenue,
        _CallsMade:attempted.length,
        _Connected:connected.length,
        _CurrentStage:currentStage,
        _ReachedInterested:stageSet.has('Interested'),
        _ReachedDemo:stageSet.has('Demo Scheduled'),
        _ReachedQuotation:stageSet.has('Quotation'),
        _ReachedWon:stageSet.has('Won')
      };
    }).filter(r=>r._Name);
    if(!EN.length)throw new Error('No data — could not detect a Lead Name column.');
    document.getElementById('enLoad').style.display='none';document.getElementById('enCont').style.display='block';
    document.getElementById('enSync').textContent='Sync: '+new Date().toLocaleTimeString('en-IN');
    document.getElementById('enErr').style.display='none';
    enBuildFilters();enRenderAll();
  }catch(e){
    document.getElementById('enLoad').style.display='none';document.getElementById('enCont').style.display='block';
    document.getElementById('enErr').style.display='block';document.getElementById('enErr').textContent='⚠️ Data load failed: '+e.message;
  }
}
async function refreshEnterprise(){
  if(!_canAccessEnterprise()) return;
  const b=document.getElementById('enRefBtn');if(b)b.classList.add('spinning');Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};document.getElementById('enLoad').style.display='flex';document.getElementById('enCont').style.display='none';await loadEnterprise();if(b)b.classList.remove('spinning');
}
function enBuildFilters(){
  const city=[...new Set(EN.map(r=>r._City).filter(Boolean))].sort();
  const own=[...new Set(EN.map(r=>r._Owner).filter(Boolean))].sort();
  const st=[...new Set(EN.map(r=>r._CurrentStage).filter(Boolean))].sort();
  const s1=document.getElementById('enFSource');s1.innerHTML='<option value="">All Cities</option>';city.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;s1.appendChild(o);});
  const s2=document.getElementById('enFRep');s2.innerHTML='<option value="">All Owners</option>';own.forEach(o=>{const opt=document.createElement('option');opt.value=o;opt.textContent=o;s2.appendChild(opt);});
  const s3=document.getElementById('enFStatus');s3.innerHTML='<option value="">All Stages</option>';st.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s3.appendChild(o);});
}
function enRenderAll(){enRenderKPIs();enRenderCharts();enApply();enRenderRepLB();}
// Performance of Lead Owner — collapsed by default (just the toggle button).
// Toggle ON: card expands, showing every lead owner's Total/Demo/Quotation/Won/
// Revenue at once, ranked by Revenue (ties broken by Won count) so it's obvious
// at a glance who's carrying the numbers — same pattern as SmartFleet's
// "Performance of Sales Rep" (see lRenderRepLB in js/leads.js).
let ENRepAllMode=false;
function enToggleRepAll(btn){
  ENRepAllMode=!ENRepAllMode;
  btn.classList.toggle('active',ENRepAllMode);
  enRenderRepLB();
}
function enRepColor(name){
  const s=(name||'?').trim();
  let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}
  const palette=['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#f97316'];
  return palette[Math.abs(h)%palette.length];
}
// Strip the "Dialled By " prefix some rows have so "Dialled By Disha" and a
// plain "Disha" merge into one person instead of showing as two rows.
function enOwnerName(raw){
  return (raw||'').replace(/^dialled\s*by\s*/i,'').trim()||'Unassigned';
}
function enRenderRepLB(){
  const box=document.getElementById('enRepLB');
  if(!box)return;
  if(!ENRepAllMode){box.innerHTML='';return;}
  const reps={};
  EN.forEach(r=>{
    const key=enOwnerName(r._Owner);
    if(key==='Unassigned')return;
    if(!reps[key])reps[key]={name:key,total:0,demo:0,quoted:0,won:0,revenue:0};
    const s=reps[key];
    s.total++;
    if(r._ReachedDemo)s.demo++;
    if(r._ReachedQuotation)s.quoted++;
    if(r._ReachedWon){s.won++;s.revenue+=r._Revenue;}
  });
  const board=Object.values(reps).sort((a,b)=>b.revenue-a.revenue||b.won-a.won);
  box.innerHTML=board.map((b,i)=>{
    const avgOrder=b.won?b.revenue/b.won:0;
    const convRate=b.total?(b.won/b.total*100):0;
    const col=enRepColor(b.name);
    return`
    <div class="lb-row">
      <span style="font-size:0.9rem;width:22px;flex-shrink:0">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</span>
      <div class="rep-dot" style="background:${col}22;color:${col}">${b.name.charAt(0).toUpperCase()}</div>
      <div style="width:170px;flex-shrink:0;font-size:1rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:9px">${b.name}</div>
      <div style="display:flex;flex:1;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="text-align:center;min-width:44px"><div style="font-size:1.1rem;font-weight:700;color:var(--text)">${b.total}</div><div style="font-size:0.66rem;color:var(--muted)">TOTAL</div></div>
        <div style="text-align:center;min-width:44px"><div style="font-size:1.1rem;font-weight:700;color:#3b82f6">${b.demo}</div><div style="font-size:0.66rem;color:var(--muted)">DEMO</div></div>
        <div style="text-align:center;min-width:48px"><div style="font-size:1.1rem;font-weight:700;color:#60a5fa">${b.quoted}</div><div style="font-size:0.66rem;color:var(--muted)">QUOTE</div></div>
        <div style="text-align:center;min-width:44px"><div style="font-size:1.1rem;font-weight:700;color:#10b981">${b.won}</div><div style="font-size:0.66rem;color:var(--muted)">WON</div></div>
        <div style="text-align:center;min-width:76px"><div style="font-size:1.1rem;font-weight:700;color:var(--text)">₹${lFmtINR(avgOrder)}</div><div style="font-size:0.66rem;color:var(--muted)">AVG ORDER</div></div>
        <div style="text-align:center;min-width:60px"><div style="font-size:1.1rem;font-weight:700;color:#8b5cf6">${convRate.toFixed(0)}%</div><div style="font-size:0.66rem;color:var(--muted)">CONVERSION</div></div>
        <div style="text-align:center;min-width:76px"><div style="font-size:1.1rem;font-weight:700;color:var(--text)">₹${lFmtINR(b.revenue)}</div><div style="font-size:0.66rem;color:var(--muted)">REVENUE</div></div>
      </div>
    </div>`;}).join('');
}
function enGetCF(){return EN.filter(r=>{
  if(ENcf.status&&r._CurrentStage!==ENcf.status)return false;
  if(ENcf.city&&r._City!==ENcf.city)return false;
  if(ENcf.owner&&r._Owner!==ENcf.owner)return false;
  if(ENcf.source&&r._Source!==ENcf.source)return false;
  if(ENcf.product&&r._Product!==ENcf.product)return false;
  if(ENcf.milestone==='contacted'&&r._CallsMade===0)return false;
  if(ENcf.milestone==='demo'&&!r._ReachedDemo)return false;
  if(ENcf.milestone==='quotation'&&!r._ReachedQuotation)return false;
  if(ENcf.milestone==='won'&&!r._ReachedWon)return false;
  if(ENcf.milestone==='lost'&&r._CurrentStage!=='Lost')return false;
  if(ENcf.milestone==='revenue'&&!(r._Revenue>0))return false;
  if(ENcf.milestone==='today'&&r._EntryKey!==enTodayKey())return false;
  return true;
});}
function enRenderKPIs(){
  const t=EN.length;
  const totalCalls=EN.reduce((s,r)=>s+r._CallsMade,0);
  const totalConnected=EN.reduce((s,r)=>s+r._Connected,0);
  const demo=EN.filter(r=>r._ReachedDemo).length;
  const quotation=EN.filter(r=>r._ReachedQuotation).length;
  const won=EN.filter(r=>r._ReachedWon).length;
  const lost=EN.filter(r=>r._CurrentStage==='Lost').length;
  const revenue=EN.reduce((s,r)=>s+r._Revenue,0);
  const todayLeads=EN.filter(r=>r._EntryKey===enTodayKey()).length;
  const kpis=[
    {l:'Total Leads',v:t,s:t+' lead'+(t!==1?'s':'')+' tracked',ic:'📊',grad:'linear-gradient(135deg,#fdba74,#fb923c)',fk:'total'},
    {l:'No. of Calls',v:totalCalls,s:totalConnected+' connected · '+(totalCalls-totalConnected)+' no answer',ic:'📞',grad:'linear-gradient(135deg,#6ee7b7,#34d399)',fk:'contacted'},
    {l:'Demo',v:demo,s:t?((demo/t)*100).toFixed(1)+'% of leads':'—',ic:'🖥',grad:'linear-gradient(135deg,#fda4af,#fb7185)',fk:'demo'},
    {l:'Quotation',v:quotation,s:t?((quotation/t)*100).toFixed(1)+'% of leads':'—',ic:'📄',grad:'linear-gradient(135deg,#67e8f9,#22d3ee)',fk:'quotation'},
    {l:'Won',v:won,s:t?((won/t)*100).toFixed(1)+'% win rate':'—',ic:'✅',grad:'linear-gradient(135deg,#c4b5fd,#a78bfa)',fk:'won'},
    {l:'Revenue',v:'₹'+revenue.toLocaleString('en-IN'),s:won+' won deal'+(won!==1?'s':''),ic:'💰',grad:'linear-gradient(135deg,#fcd34d,#fbbf24)',fk:'revenue'},
    {l:'Lost',v:lost,s:t?((lost/t)*100).toFixed(1)+'% of leads':'—',ic:'❌',grad:'linear-gradient(135deg,#fca5a5,#f87171)',fk:'lost'},
    {l:'Daily Lead',v:todayLeads,s:'Added today',ic:'📅',grad:'linear-gradient(135deg,#93c5fd,#60a5fa)',fk:'today'}
  ];
  document.getElementById('enKpiGrid').innerHTML=kpis.map(k=>{const ia=ENkpi===k.fk;return `<div class="en-kpi-tile ${ia?'en-kpi-active':''}" style="background:${k.grad}" onclick="enKpiClick('${k.fk}')"><div class="en-kpi-tile-body"><div class="en-kpi-tile-icon"><i></i><i></i><i></i><i></i></div><div class="en-kpi-value">${k.v}</div><div class="en-kpi-label">${k.l}</div></div><div class="en-kpi-tile-foot"><span>${k.ic}</span><span>${k.s}</span><span class="en-kpi-click-hint">${ia?'✕':'→'}</span></div></div>`;}).join('');
}
function enKpiClick(fk){
  if(fk==='total'){
    ENkpi=null;ENcf={status:null,city:null,owner:null,source:null,product:null,milestone:null};
  }else{
    ENkpi=ENkpi===fk?null:fk;
    ENcf.milestone=ENkpi;
  }
  Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};
  enRenderAll();enBadge();
}
function enBadge(){
  const b=document.getElementById('enCFBadge');
  const parts=[];
  if(ENcf.status)parts.push(ENcf.status);
  if(ENcf.city)parts.push(ENcf.city);
  if(ENcf.owner)parts.push(ENcf.owner);
  if(ENcf.source)parts.push(ENcf.source);
  if(ENcf.product)parts.push(ENcf.product);
  if(ENcf.milestone){
    const ml={contacted:'Contacted',demo:'Demo',quotation:'Quotation',won:'Won',lost:'Lost',revenue:'Has Revenue',today:'Today'};
    parts.push(ml[ENcf.milestone]||ENcf.milestone);
  }
  if(parts.length){b.style.display='flex';b.innerHTML='🎯 Filter: <strong style="color:var(--accent)">'+parts.join(' + ')+'</strong> <span onclick="enClearAll()" style="cursor:pointer;color:var(--hot);margin-left:8px;font-weight:600">✕ Clear All</span>';}
  else b.style.display='none';
}
function enClearAll(){ENkpi=null;ENcf={status:null,city:null,owner:null,source:null,product:null,milestone:null};Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};enRenderAll();enBadge();}
function enCF(k,v){ENcf[k]=ENcf[k]===v?null:v;enBadge();Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};enRenderCharts();enApply();}
function enRenderCharts(){
  const D=enGetCF();const sc=['#4e9af1','#a78bfa','#00d4aa','#f0a500','#ff5c7c','#f97316','#10b981','#ec4899'];
  const {tc:eTC,gc:eGC,noGrid:eNG}=chartColors();
  const isLight=document.body.classList.contains('light-mode');
  const dim=isLight?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.07)';

  // ── Lead Status Breakdown (doughnut, current stage per lead) ──
  const stc={};D.forEach(r=>{const s=r._CurrentStage||'Not Contacted';stc[s]=(stc[s]||0)+1;});
  const sk=Object.keys(stc);
  ENch.status=new Chart(document.getElementById('enChStatus'),{type:'doughnut',data:{labels:sk,datasets:[{data:sk.map(k=>stc[k]),backgroundColor:sk.map((k,i)=>ENcf.status&&ENcf.status!==k?dim:(enStatusColor(k)||sc[i%sc.length])),borderWidth:0,hoverOffset:8}]},options:{cutout:'68%',onClick:(_,e)=>{if(e.length)enCF('status',sk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}},datalabels:{display:false}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChStatus').style.cursor='pointer';

  // ── Daily Leads (line, by calendar date) ──
  const dc={};D.forEach(r=>{if(r._EntryKey)dc[r._EntryKey]=(dc[r._EntryKey]||0)+1;});
  const ds=Object.keys(dc).sort();
  ENch.daily=new Chart(document.getElementById('enChDaily'),{type:'line',data:{labels:ds.map(d=>d.slice(5)),datasets:[{data:ds.map(d=>dc[d]),borderColor:'#00d4aa',backgroundColor:'rgba(0,212,170,0.1)',fill:true,tension:0.4,pointBackgroundColor:'#00d4aa',pointRadius:4,borderWidth:2}]},options:{plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}}},responsive:true,maintainAspectRatio:false}});

  // ── Top Cities (bar) ──
  const ci={};D.forEach(r=>{const c=r._City||'Unknown';ci[c]=(ci[c]||0)+1;});
  const cis=Object.entries(ci).sort((a,b)=>b[1]-a[1]).slice(0,10);
  ENch.city=new Chart(document.getElementById('enChCity'),{type:'bar',data:{labels:cis.map(([k])=>k),datasets:[{data:cis.map(([,v])=>v),backgroundColor:cis.map(([k],i)=>ENcf.city&&ENcf.city!==k?dim:sc[i%sc.length]),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',onClick:(_,e)=>{if(e.length)enCF('city',cis[e[0].index][0]);},plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChCity').style.cursor='pointer';

  // ── Lead Owner Performance (bar) ──
  const oc={};D.forEach(r=>{const o=r._Owner||'Unassigned';oc[o]=(oc[o]||0)+1;});
  const os=Object.entries(oc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  ENch.outreach=new Chart(document.getElementById('enChOutreach'),{type:'bar',data:{labels:os.map(([k])=>k),datasets:[{data:os.map(([,v])=>v),backgroundColor:os.map(([k])=>ENcf.owner&&ENcf.owner!==k?dim:'#a78bfa'),borderRadius:6,borderWidth:0}]},options:{onClick:(_,e)=>{if(e.length)enCF('owner',os[e[0].index][0]);},plugins:{legend:{display:false},datalabels:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:9}},grid:{display:false}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChOutreach').style.cursor='pointer';

  // ── Lead Source Mix (doughnut) ──
  const rc={};D.forEach(r=>{const s=r._Source||'Direct / Unspecified';rc[s]=(rc[s]||0)+1;});
  const rk=Object.keys(rc);
  ENch.source=new Chart(document.getElementById('enChSource'),{type:'doughnut',data:{labels:rk,datasets:[{data:rk.map(k=>rc[k]),backgroundColor:rk.map((k,i)=>ENcf.source&&ENcf.source!==k?dim:sc[i%sc.length]),borderWidth:0,hoverOffset:8}]},options:{cutout:'65%',onClick:(_,e)=>{if(e.length)enCF('source',rk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}},datalabels:{display:false}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChSource').style.cursor='pointer';

  // ── Call Connection Rate (doughnut) — how many dial attempts actually
  // connected, across the currently cross-filtered leads. Not click-to-filter
  // (there's no "connected"/"not connected" table dimension to jump to). ──
  const connD=D.reduce((s,r)=>s+r._Connected,0),noAnsD=D.reduce((s,r)=>s+(r._CallsMade-r._Connected),0);
  ENch.connect=new Chart(document.getElementById('enChConnect'),{type:'doughnut',data:{labels:['Connected','No Answer'],datasets:[{data:[connD,noAnsD],backgroundColor:['#00d4aa','#ff5c7c'],borderWidth:0,hoverOffset:8}]},options:{cutout:'68%',plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}},datalabels:{display:false}},responsive:true,maintainAspectRatio:false}});

  // ── Product Interest (doughnut) ──
  const pc={};D.forEach(r=>{const p=r._Product||'Unspecified';pc[p]=(pc[p]||0)+1;});
  const pk=Object.keys(pc);
  ENch.product=new Chart(document.getElementById('enChProduct'),{type:'doughnut',data:{labels:pk,datasets:[{data:pk.map(k=>pc[k]),backgroundColor:pk.map((k,i)=>ENcf.product&&ENcf.product!==k?dim:sc[i%sc.length]),borderWidth:0,hoverOffset:8}]},options:{cutout:'65%',onClick:(_,e)=>{if(e.length)enCF('product',pk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}},datalabels:{display:false}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChProduct').style.cursor='pointer';

  // ── Conversion Funnel (bar) — always the full pipeline (EN), not the
  // cross-filtered D, so filtering by e.g. City doesn't collapse the funnel
  // down to a single stage. ──
  const total=EN.length;
  const contacted=EN.filter(r=>r._CallsMade>0).length;
  const interested=EN.filter(r=>r._ReachedInterested||r._ReachedDemo||r._ReachedQuotation||r._ReachedWon).length;
  const demoN=EN.filter(r=>r._ReachedDemo).length;
  const quotationN=EN.filter(r=>r._ReachedQuotation).length;
  const wonN=EN.filter(r=>r._ReachedWon).length;
  const funnel=[{l:'Total Leads',v:total,c:'#4e9af1'},{l:'Contacted',v:contacted,c:'#a78bfa'},{l:'Interested',v:interested,c:'#f0a500'},{l:'Demo',v:demoN,c:'#f97316'},{l:'Quotation',v:quotationN,c:'#ec4899'},{l:'Won',v:wonN,c:'#00d4aa'}];
  ENch.funnel=new Chart(document.getElementById('enChFunnel'),{type:'bar',data:{labels:funnel.map(f=>f.l),datasets:[{data:funnel.map(f=>f.v),backgroundColor:funnel.map(f=>f.c),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',layout:{padding:{right:56}},plugins:{legend:{display:false},datalabels:{anchor:'end',align:'end',color:eTC,font:{family:'DM Sans',size:10,weight:'600'},formatter:v=>v.toLocaleString('en-IN')+(total?'  ('+((v/total)*100).toFixed(0)+'%)':'')}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
}
function enApply(){
  const q=(document.getElementById('enSearch').value||'').toLowerCase();
  const city=document.getElementById('enFSource').value,owner=document.getElementById('enFRep').value,stage=document.getElementById('enFStatus').value;
  ENf=EN.filter(r=>{
    if(q&&!((r._Name||'').toLowerCase().includes(q)||(r._City||'').toLowerCase().includes(q)||(r._Phone||'').toLowerCase().includes(q)||(r._Owner||'').toLowerCase().includes(q)))return false;
    if(city&&r._City!==city)return false;
    if(owner&&r._Owner!==owner)return false;
    if(stage&&r._CurrentStage!==stage)return false;
    if(ENcf.status&&r._CurrentStage!==ENcf.status)return false;
    if(ENcf.city&&r._City!==ENcf.city)return false;
    if(ENcf.owner&&r._Owner!==ENcf.owner)return false;
    if(ENcf.source&&r._Source!==ENcf.source)return false;
    if(ENcf.product&&r._Product!==ENcf.product)return false;
    if(ENcf.milestone==='contacted'&&r._CallsMade===0)return false;
    if(ENcf.milestone==='demo'&&!r._ReachedDemo)return false;
    if(ENcf.milestone==='quotation'&&!r._ReachedQuotation)return false;
    if(ENcf.milestone==='won'&&!r._ReachedWon)return false;
    if(ENcf.milestone==='lost'&&r._CurrentStage!=='Lost')return false;
    if(ENcf.milestone==='revenue'&&!(r._Revenue>0))return false;
    if(ENcf.milestone==='today'&&r._EntryKey!==enTodayKey())return false;
    return true;
  });
  if(ENsk)ENf.sort((a,b)=>{let av=a[ENsk]??'',bv=b[ENsk]??'';if(av!==''&&bv!==''&&!isNaN(av)&&!isNaN(bv))return(+av-+bv)*ENsd;return String(av).localeCompare(String(bv))*ENsd;});
  ENp=1;enRenderTable();
}
function enReset(){document.getElementById('enSearch').value='';document.getElementById('enFSource').value='';document.getElementById('enFRep').value='';document.getElementById('enFStatus').value='';enClearAll();}
function enSort(k){ENsk=ENsk===k?(ENsd*=-1,k):(ENsd=1,k);enApply();}
function enToggleTable(){
  ENtblOpen=!ENtblOpen;
  const wrap=document.getElementById('enTblBodyWrap');
  const ico=document.getElementById('enTblToggleIco');
  if(wrap)wrap.style.display=ENtblOpen?'':'none';
  if(ico)ico.textContent=ENtblOpen?'−':'+';
}
// Compact windowed pagination — always shows page 1 & last page, never
// requires horizontal scrolling to reach the start no matter how many pages.
function enPagerHTML(cur,tp,fn){
  if(tp<=1)return '';
  let h='<span class="page-info">Page '+cur+' of '+tp+'</span>';
  h+='<button class="page-btn" onclick="'+fn+'(1)" '+(cur===1?'disabled':'')+'>«</button>';
  h+='<button class="page-btn" onclick="'+fn+'('+(cur-1)+')" '+(cur===1?'disabled':'')+'>‹</button>';
  const keep=new Set([1,2,tp-1,tp,cur-1,cur,cur+1].filter(p=>p>=1&&p<=tp));
  const sorted=[...keep].sort((a,b)=>a-b);
  let prev=0;
  sorted.forEach(p=>{
    if(prev&&p-prev>1)h+='<span style="padding:0 6px;color:var(--muted)">…</span>';
    h+='<button class="page-btn '+(p===cur?'active':'')+'" onclick="'+fn+'('+p+')">'+p+'</button>';
    prev=p;
  });
  h+='<button class="page-btn" onclick="'+fn+'('+(cur+1)+')" '+(cur===tp?'disabled':'')+'>›</button>';
  h+='<button class="page-btn" onclick="'+fn+'('+tp+')" '+(cur===tp?'disabled':'')+'>»</button>';
  return h;
}
function enRenderTable(){
  const heads=[{k:'_EntryTs',l:'DATE',s:true},{k:'_Name',l:'LEAD NAME',s:true},{k:'_City',l:'CITY',s:false},{k:'_Phone',l:'PHONE',s:false},{k:'_Source',l:'SOURCE',s:false},{k:'_Product',l:'PRODUCT',s:false},{k:'_Owner',l:'OWNER',s:false},{k:'_CurrentStage',l:'STAGE',s:true},{k:'_CallsMade',l:'CALLS',s:true},{k:'_Revenue',l:'REVENUE',s:true}];
  const thh=document.getElementById('enTblHead');if(thh)thh.innerHTML=heads.map(h=>h.s?`<th onclick="enSort('${h.k}')">${h.l} ↕</th>`:`<th>${h.l}</th>`).join('');
  const tot=ENf.length,tp=Math.max(1,Math.ceil(tot/ENPP));
  if(ENp>tp)ENp=tp;
  const pg=ENf.slice((ENp-1)*ENPP,ENp*ENPP);
  document.getElementById('enTblCnt').textContent=tot+' lead'+(tot!==1?'s':'');
  const tb=document.getElementById('enTblBody');
  if(!pg.length){tb.innerHTML='<tr><td colspan="10"><div class="empty-state">No leads found</div></td></tr>';document.getElementById('enPagBar').innerHTML='';return;}
  tb.innerHTML=pg.map(r=>{
    const bc=enStatusBadge(r._CurrentStage);
    const rev=r._Revenue?'₹'+r._Revenue.toLocaleString('en-IN'):'—';
    return `<tr><td style="font-size:0.83rem;color:var(--muted)">${r._EntryRaw||'—'}</td><td style="font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis">${r._Name||'—'}</td><td style="font-size:0.83rem">${r._City||'—'}</td><td style="font-size:0.83rem">${r._Phone||'—'}</td><td style="font-size:0.83rem">${r._Source}</td><td style="font-size:0.83rem">${r._Product}</td><td style="font-size:0.83rem">${r._Owner}</td><td><span class="badge ${bc}">${r._CurrentStage}</span></td><td style="font-size:0.83rem;text-align:center">${r._CallsMade}</td><td style="font-weight:600;color:var(--accent)">${rev}</td></tr>`;
  }).join('');
  document.getElementById('enPagBar').innerHTML=enPagerHTML(ENp,tp,'enGoPage');
}
function enGoPage(p){const tp=Math.ceil(ENf.length/ENPP)||1;if(p<1||p>tp)return;ENp=p;enRenderTable();document.querySelector('#panel-enterprise .table-card').scrollIntoView({behavior:'smooth',block:'start'});}
