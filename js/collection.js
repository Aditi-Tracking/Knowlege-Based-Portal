// Section: Collection Dashboard (loadColl, charts, filters, table)
async function loadColl(){
  document.getElementById('cTxt').textContent='Fetching data from Google Sheet...';
  try{
    let rows;
    if(_collCache){rows=_collCache;_collCache=null;}
    else{const res=await fetch(C_URL);if(!res.ok)throw new Error('HTTP '+res.status);rows=await res.json();}
    if(!Array.isArray(rows)) throw new Error('Invalid data: '+JSON.stringify(rows).slice(0,100));
    C=rows.map(r=>{
      r['Commitment']=parseFloat(r['Commitment'])||0;
      r['Achivment']=parseFloat(r['Achivment'])||0;
      r['Commitment Calls']=parseFloat(r['Commitment Calls'])||0;
      r['Achievement  Calls']=parseFloat(r['Achievement  Calls'])||0;
      r['MTD']=parseFloat(String(r['MTD']).replace(/,/g,''))||0;
      r['Monthly Target']=parseFloat(r['Monthly Target'])||0;
      let d=String(r['Date']||'');
      if(d.match(/^\d{2}\/\d{2}\/\d{4}/)){const m=d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);d=m[3]+'-'+m[2]+'-'+m[1];}
      r['_date']=d.slice(0,10);
      r['_month']=r['Month Name']||d.slice(0,7);
      return r;
    }).filter(r=>r['Name']&&String(r['Name']).trim()!=='');
    if(!C.length) throw new Error('No data found — sheet may be empty');
    document.getElementById('cLoad').style.display='none';
    document.getElementById('cCont').style.display='block';
    document.getElementById('cSync').textContent='Sync: '+new Date().toLocaleTimeString('en-IN');
    document.getElementById('cErr').style.display='none';
    cBuildTopFilters(); cRenderAll(); cApplyTable();
  }catch(e){
    document.getElementById('cLoad').style.display='none';
    document.getElementById('cCont').style.display='block';
    document.getElementById('cErr').style.display='block';
    document.getElementById('cErr').textContent='⚠️ Error: '+e.message;
  }
}

async function refreshColl(){
  const b=document.getElementById('cRefBtn'); b.classList.add('spinning');
  Object.values(Cch).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
  document.getElementById('cLoad').style.display='flex';
  document.getElementById('cCont').style.display='none';
  C_person=''; C_month=''; C_loc=''; C_kpi=null;
  await loadColl(); b.classList.remove('spinning');
}

function cGetNames(){return[...new Set(C.map(r=>r['Name']).filter(Boolean))].sort();}

function cBuildTopFilters(){
  const names=cGetNames();
  let pb='';
  names.forEach((n,i)=>{pb+=`<button class="filter-btn" onclick="cSetPerson('${n}',this)" style="border-color:${C_COLS[i%C_COLS.length]}55">${n}</button> `;});
  document.getElementById('cPersonBtns').innerHTML=pb;
  const months=[...new Set(C.map(r=>r['_month']).filter(Boolean))].sort();
  const ms=document.getElementById('cFMonth'); ms.innerHTML='<option value="">All Months</option>';
  months.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;ms.appendChild(o);});
  const locs=[...new Set(C.map(r=>r['Location']).filter(Boolean))].sort();
  const ls=document.getElementById('cFLoc'); ls.innerHTML='<option value="">All Locations</option>';
  locs.forEach(l=>{const o=document.createElement('option');o.value=l;o.textContent=l;ls.appendChild(o);});
  const dates=[...new Set(C.map(r=>r['_date']).filter(Boolean))].sort().reverse();
  const ds=document.getElementById('cFDate'); ds.innerHTML='<option value="">All Dates</option>';
  dates.forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=d.split('-').reverse().join('/');ds.appendChild(o);});
}

function cSetPerson(name,el){
  C_person=C_person===name?'':name;
  document.querySelectorAll('#cPersonBtns .filter-btn,#cBtnAll').forEach(b=>b.classList.remove('active'));
  if(!C_person) document.getElementById('cBtnAll').classList.add('active');
  else el.classList.add('active');
  Object.values(Cch).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
  cRenderAll(); cApplyTable(); cBadge();
}

function cApplyGlobal(){
  C_month=document.getElementById('cFMonth').value;
  C_loc=document.getElementById('cFLoc').value;
  Object.values(Cch).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
  cRenderAll(); cApplyTable(); cBadge();
}

function cResetAll(){
  C_person=''; C_month=''; C_loc=''; C_kpi=null;
  document.getElementById('cFMonth').value='';
  document.getElementById('cFLoc').value='';
  document.querySelectorAll('#cPersonBtns .filter-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('cBtnAll').classList.add('active');
  Object.values(Cch).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
  cRenderAll(); cApplyTable(); cBadge();
}

function cGetFiltered(){
  return C.filter(r=>{
    if(C_person&&r['Name']!==C_person) return false;
    if(C_month&&r['_month']!==C_month) return false;
    if(C_loc&&r['Location']!==C_loc) return false;
    if(C_kpi==='achieved'&&r['Achivment']<r['Commitment']) return false;
    if(C_kpi==='below'&&r['Achivment']>=r['Commitment']) return false;
    return true;
  });
}

function cBadge(){
  const b=document.getElementById('cCFBadge'); const parts=[];
  if(C_person) parts.push('<strong style="color:var(--accent2)">'+C_person+'</strong>');
  if(C_month) parts.push('<strong style="color:var(--accent)">'+C_month+'</strong>');
  if(C_loc) parts.push('<strong style="color:#a78bfa">'+C_loc+'</strong>');
  if(C_kpi) parts.push('<strong style="color:var(--accent3)">'+C_kpi+'</strong>');
  if(parts.length){b.style.display='flex';b.innerHTML='🎯 Filter: '+parts.join(' + ')+' <span onclick="cResetAll()" style="cursor:pointer;color:var(--hot);margin-left:8px;font-weight:600">✕ Clear</span>';}
  else b.style.display='none';
}

function cRenderAll(){const D=cGetFiltered(); cRenderKPIs(D); cRenderCharts(D); cRenderLB(D);}

function cKpiClick(fk){
  C_kpi=C_kpi===fk?null:fk;
  Object.values(Cch).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
  cRenderAll(); cApplyTable(); cBadge();
}

function cRenderKPIs(D){
  const tc=D.reduce((s,r)=>s+r['Commitment'],0);
  const ta=D.reduce((s,r)=>s+r['Achivment'],0);
  const tm=D.reduce((s,r)=>s+r['MTD'],0);
  const tcc=D.reduce((s,r)=>s+r['Commitment Calls'],0);
  const tac=D.reduce((s,r)=>s+r['Achievement  Calls'],0);
  const pct=tc?((ta/tc)*100).toFixed(1):0;
  const cpct=tcc?((tac/tcc)*100).toFixed(1):0;
  const achieved=D.filter(r=>r['Achivment']>=r['Commitment']&&r['Commitment']>0).length;
  const below=D.filter(r=>r['Achivment']<r['Commitment']&&r['Commitment']>0).length;
  const kpis=[
    {l:'Total Commitment',v:'₹'+tc.toLocaleString('en-IN'),s:'Selected period',a:'#f0a500',b:'Target',bb:'rgba(240,165,0,0.15)',fk:'commitment'},
    {l:'Total Achievement',v:'₹'+ta.toLocaleString('en-IN'),s:pct+'% of commitment',a:'#00d4aa',b:pct+'%',bb:'rgba(0,212,170,0.15)',fk:'achieved'},
    {l:'MTD Total',v:'₹'+tm.toLocaleString('en-IN'),s:'Month to date',a:'#a78bfa',b:'MTD',bb:'rgba(167,139,250,0.15)',fk:'mtd'},
    {l:'Commit Calls',v:tcc,s:cpct+'% achieved',a:'#4e9af1',b:tcc+' calls',bb:'rgba(78,154,241,0.15)',fk:'calls'},
    {l:'Achievement Calls',v:tac,s:'Calls done',a:'#f97316',b:cpct+'%',bb:'rgba(249,115,22,0.15)',fk:'achvcalls'},
    {l:'Days Achieved',v:achieved,s:below+' days below target',a:'#ff5c7c',b:achieved+'/'+D.filter(r=>r['Commitment']>0).length,bb:'rgba(255,92,124,0.15)',fk:'achieved'},
  ];
  document.getElementById('cKpiGrid').innerHTML=kpis.map(k=>{
    const ia=C_kpi===k.fk;
    return`<div class="kpi-card ${ia?'kpi-active':''}" style="--card-accent:${k.a};--card-color:${k.a}" onclick="cKpiClick('${k.fk}')">
      <div class="kpi-label">${k.l}</div><div class="kpi-value" style="font-size:clamp(0.6rem,0.95vw,0.95rem);word-break:break-all;overflow-wrap:anywhere;line-height:1.2">${k.v}</div>
      <div class="kpi-sub">${k.s}</div>
      <span class="kpi-badge" style="background:${k.bb};color:${k.a}">${k.b}</span>
      <div class="kpi-click-hint">${ia?'✕ Clear':'↗ Click to filter'}</div>
    </div>`;
  }).join('');
}

function cRenderCharts(D){
  const names=cGetNames();
  const {tc:cTC,gc:cGC,noGrid:cNG}=chartColors();
  const dates=[...new Set(D.map(r=>r['_date']).filter(Boolean))].sort();
  const dayLabels=dates.map(d=>d.slice(5).split('-').reverse().join('/'));
  const dc={},da={};
  dates.forEach(d=>{dc[d]=0;da[d]=0;});
  D.forEach(r=>{if(r['_date']){dc[r['_date']]=(dc[r['_date']]||0)+r['Commitment'];da[r['_date']]=(da[r['_date']]||0)+r['Achivment'];}});

  if(document.getElementById('cChDay')){
    Cch.day=new Chart(document.getElementById('cChDay'),{type:'bar',data:{labels:dayLabels,datasets:[
      {label:'Commitment',data:dates.map(d=>dc[d]),backgroundColor:'rgba(240,165,0,0.65)',borderColor:'#f0a500',borderWidth:1,borderRadius:4},
      {label:'Achievement',data:dates.map(d=>da[d]),backgroundColor:'rgba(0,212,170,0.65)',borderColor:'#00d4aa',borderWidth:1,borderRadius:4}
    ]},options:{plugins:{legend:{labels:{color:cTC,font:{family:'DM Sans',size:10}}}},scales:{x:{ticks:{color:cTC,font:{family:'DM Sans',size:9}},grid:{display:!cNG,color:cGC}},y:{ticks:{color:cTC,font:{family:'DM Sans',size:10},callback:v=>'₹'+v.toLocaleString('en-IN')},grid:{display:!cNG,color:cGC}}},responsive:true,maintainAspectRatio:false}});
  }

  const mtdMap={};names.forEach(n=>{mtdMap[n]=0;});
  D.forEach(r=>{if(r['Name']&&r['MTD']>0) mtdMap[r['Name']]=Math.max(mtdMap[r['Name']]||0,r['MTD']);});
  if(document.getElementById('cChMTD')){
    Cch.mtd=new Chart(document.getElementById('cChMTD'),{type:'bar',data:{labels:names,datasets:[{data:names.map(n=>mtdMap[n]||0),backgroundColor:C_COLS.slice(0,names.length),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' ₹'+ctx.raw.toLocaleString('en-IN')}}},scales:{x:{ticks:{color:cTC,font:{family:'DM Sans',size:9},callback:v=>'₹'+v.toLocaleString('en-IN')},grid:{display:!cNG,color:cGC}},y:{ticks:{color:cTC,font:{family:'DM Sans',size:11}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  }

  const pctData=names.map(n=>{const rows=D.filter(r=>r['Name']===n);const co=rows.reduce((s,r)=>s+r['Commitment'],0);const ac=rows.reduce((s,r)=>s+r['Achivment'],0);return co?+((ac/co)*100).toFixed(1):0;});
  if(document.getElementById('cChPct')){
    Cch.pct=new Chart(document.getElementById('cChPct'),{type:'doughnut',data:{labels:names,datasets:[{data:pctData,backgroundColor:C_COLS.slice(0,names.length),borderWidth:0,hoverOffset:10}]},options:{cutout:'62%',plugins:{legend:{position:'right',labels:{color:cTC,padding:12,font:{family:'DM Sans',size:11}}},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${ctx.raw}%`}}},responsive:true,maintainAspectRatio:false}});
  }

  const ccc=names.map(n=>D.filter(r=>r['Name']===n).reduce((s,r)=>s+r['Commitment Calls'],0));
  const acc=names.map(n=>D.filter(r=>r['Name']===n).reduce((s,r)=>s+r['Achievement  Calls'],0));
  if(document.getElementById('cChCalls')){
    Cch.calls=new Chart(document.getElementById('cChCalls'),{type:'bar',data:{labels:names,datasets:[
      {label:'Commit Calls',data:ccc,backgroundColor:'rgba(78,154,241,0.7)',borderRadius:4,borderWidth:0},
      {label:'Achv Calls',data:acc,backgroundColor:'rgba(0,212,170,0.7)',borderRadius:4,borderWidth:0}
    ]},options:{plugins:{legend:{labels:{color:cTC,font:{family:'DM Sans',size:10}}}},scales:{x:{ticks:{color:cTC,font:{family:'DM Sans',size:10}},grid:{display:false}},y:{ticks:{color:cTC,font:{family:'DM Sans',size:10}},grid:{display:!cNG,color:cGC}}},responsive:true,maintainAspectRatio:false}});
  }

  const tDS=names.map((n,i)=>{const bd={};dates.forEach(d=>{bd[d]=D.filter(r=>r['Name']===n&&r['_date']===d).reduce((s,r)=>s+r['Achivment'],0);});return{label:n,data:dates.map(d=>bd[d]||0),borderColor:C_COLS[i%C_COLS.length],backgroundColor:'transparent',tension:0.4,pointRadius:4,borderWidth:2,pointHoverRadius:7};});
  if(document.getElementById('cChTrend')){
    Cch.trend=new Chart(document.getElementById('cChTrend'),{type:'line',data:{labels:dayLabels,datasets:tDS},options:{plugins:{legend:{labels:{color:cTC,font:{family:'DM Sans',size:10}}}},scales:{x:{ticks:{color:cTC,font:{family:'DM Sans',size:9}},grid:{display:!cNG,color:cGC}},y:{ticks:{color:cTC,font:{family:'DM Sans',size:10},callback:v=>'₹'+v.toLocaleString('en-IN')},grid:{display:!cNG,color:cGC}}},responsive:true,maintainAspectRatio:false}});
  }

  const tco=names.map(n=>D.filter(r=>r['Name']===n).reduce((s,r)=>s+r['Commitment'],0));
  const tac=names.map(n=>D.filter(r=>r['Name']===n).reduce((s,r)=>s+r['Achivment'],0));
  if(document.getElementById('cChTeam')){
    Cch.team=new Chart(document.getElementById('cChTeam'),{type:'bar',data:{labels:names,datasets:[
      {label:'Commitment',data:tco,backgroundColor:'rgba(240,165,0,0.5)',borderRadius:4,borderWidth:0},
      {label:'Achievement',data:tac,backgroundColor:C_COLS.slice(0,names.length).map(c=>c+'cc'),borderRadius:4,borderWidth:0}
    ]},options:{plugins:{legend:{labels:{color:cTC,font:{family:'DM Sans',size:10}}},tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ₹${ctx.raw.toLocaleString('en-IN')}`}}},scales:{x:{ticks:{color:cTC,font:{family:'DM Sans',size:10}},grid:{display:false}},y:{ticks:{color:cTC,font:{family:'DM Sans',size:10},callback:v=>'₹'+v.toLocaleString('en-IN')},grid:{display:!cNG,color:cGC}}},responsive:true,maintainAspectRatio:false}});
  }
}

function cRenderLB(D){
  const names=cGetNames();
  const board=names.map((n,i)=>{
    const rows=D.filter(r=>r['Name']===n);
    const co=rows.reduce((s,r)=>s+r['Commitment'],0);
    const ac=rows.reduce((s,r)=>s+r['Achivment'],0);
    const pct=co?+((ac/co)*100).toFixed(1):0;
    return{name:n,co,ac,pct,color:C_COLS[i%C_COLS.length]};
  }).sort((a,b)=>b.ac-a.ac);
  const mx=board[0]?.ac||1;
  document.getElementById('cLBoard').innerHTML=board.map((b,i)=>`
    <div class="lb-row">
      <span style="font-size:1rem;width:26px;flex-shrink:0">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</span>
      <div style="background:${b.color}22;color:${b.color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.80rem;font-weight:700;flex-shrink:0">${b.name[0]}</div>
      <div style="flex:1"><div style="font-size:0.89rem;font-weight:600;color:var(--text)">${b.name}</div><div style="font-size:0.74rem;color:var(--muted)">₹${b.ac.toLocaleString('en-IN')} / ₹${b.co.toLocaleString('en-IN')}</div></div>
      <div class="lb-bar-wrap"><div class="lb-bar" style="width:${(b.ac/mx*100).toFixed(0)}%;background:${b.color}"></div></div>
      <span style="font-size:0.85rem;font-weight:700;color:${b.color};min-width:48px;text-align:right">${b.pct}%</span>
    </div>`).join('');
}

function cApplyTable(){
  C_tSearch=(document.getElementById('cSearch')?.value||'').toLowerCase();
  C_tDate=document.getElementById('cFDate').value;
  C_tStatus=document.getElementById('cFStatus').value;
  Cf=C.filter(r=>{
    if(C_person&&r['Name']!==C_person) return false;
    if(C_month&&r['_month']!==C_month) return false;
    if(C_loc&&r['Location']!==C_loc) return false;
    if(C_tSearch&&!(r['Name']||'').toLowerCase().includes(C_tSearch)&&!(r['Location']||'').toLowerCase().includes(C_tSearch)) return false;
    if(C_tDate&&r['_date']!==C_tDate) return false;
    if(C_tStatus==='achieved'&&r['Achivment']<r['Commitment']) return false;
    if(C_tStatus==='below'&&r['Achivment']>=r['Commitment']) return false;
    return true;
  });
  if(Csk) Cf.sort((a,b)=>{let av=a[Csk]??'',bv=b[Csk]??'';if(!isNaN(av)&&!isNaN(bv))return(+av-+bv)*Csd;return String(av).localeCompare(String(bv))*Csd;});
  Cp=1; cRenderTable();
}

function cResetTable(){
  if(document.getElementById('cSearch')) document.getElementById('cSearch').value='';
  document.getElementById('cFDate').value='';
  document.getElementById('cFStatus').value='';
  C_tSearch=''; C_tDate=''; C_tStatus='';
  cApplyTable();
}

function cSort(k){Csk=Csk===k?(Csd*=-1,k):(Csd=1,k);cApplyTable();}

function cRenderTable(){
  const names=cGetNames();
  const tot=Cf.length,tp=Math.max(1,Math.ceil(tot/CPP));
  const pg=Cf.slice((Cp-1)*CPP,Cp*CPP);
  document.getElementById('cTblCnt').textContent=tot+' record'+(tot!==1?'s':'');
  const tb=document.getElementById('cTblBody');
  if(!pg.length){tb.innerHTML='<tr><td colspan="13"><div class="empty-state">No records found</div></td></tr>';return;}
  tb.innerHTML=pg.map(r=>{
    const co=r['Commitment'],ac=r['Achivment'];
    const pct=co?((ac/co)*100).toFixed(1):0;
    const cc=r['Commitment Calls'],ac2=r['Achievement  Calls'];
    const cpct=cc?((ac2/cc)*100).toFixed(1):0;
    const ni=names.indexOf(r['Name']); const col=ni>=0?C_COLS[ni%C_COLS.length]:'#888';
    let sc='badge-zero',st='—';
    if(co>0){sc=ac>=co?'badge-exceed':'badge-below';st=ac>=co?'✓ Achieved':'↓ Below';}
    const statusNote=r['Status']?`<div style="font-size:0.71rem;color:var(--warm);margin-top:2px">${r['Status']}</div>`:'';
    return`<tr>
      <td style="font-size:0.83rem;color:var(--muted)">${r['_date']||'—'}</td>
      <td style="font-size:0.80rem;color:var(--muted)">${r['Month Name']||'—'}</td>
      <td><div style="display:flex;align-items:center;gap:7px"><div style="background:${col}22;color:${col};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.76rem;font-weight:700">${(r['Name']||'?')[0]}</div><span style="font-weight:600;color:${col}">${r['Name']||'—'}</span></div></td>
      <td style="font-size:0.83rem;color:var(--muted)">${r['Location']||'—'}</td>
      <td style="color:var(--muted);font-size:0.82rem">₹${r['Monthly Target'].toLocaleString('en-IN')}</td>
      <td style="font-weight:600">₹${co.toLocaleString('en-IN')}</td>
      <td style="font-weight:600;color:${ac>=co&&ac>0?'var(--won)':ac>0?'var(--hot)':'var(--muted)'}">₹${ac.toLocaleString('en-IN')}</td>
      <td><div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:${Math.min(pct,100)}%;background:${parseFloat(pct)>=100?'var(--won)':parseFloat(pct)>=50?'var(--warm)':'var(--hot)'}"></div></div><span style="font-size:0.80rem;font-weight:600;min-width:42px;text-align:right;color:${parseFloat(pct)>=100?'var(--won)':parseFloat(pct)>=50?'var(--warm)':'var(--hot)'}">${pct}%</span></div></td>
      <td style="color:var(--cold);font-weight:600">${cc}</td>
      <td style="color:${ac2>=cc&&ac2>0?'var(--won)':'var(--accent)'};font-weight:600">${ac2}</td>
      <td style="font-size:0.82rem;font-weight:600;color:${parseFloat(cpct)>=100?'var(--won)':parseFloat(cpct)>=50?'var(--warm)':'var(--hot)'}">${cpct}%</td>
      <td style="font-weight:700;color:var(--accent2)">₹${r['MTD'].toLocaleString('en-IN')}</td>
      <td><span class="badge ${sc}">${st}</span>${statusNote}</td>
    </tr>`;
  }).join('');
  const bar=document.getElementById('cPagBar');if(tp<=1){bar.innerHTML='';return;}
  let h='<span class="page-info">Page '+Cp+' of '+tp+'</span><button class="page-btn" onclick="cGoPage('+(Cp-1)+')" '+(Cp===1?'disabled':'')+'>‹</button>';
  for(let p=1;p<=tp;p++)h+='<button class="page-btn '+(p===Cp?'active':'')+'\" onclick="cGoPage('+p+')">'+p+'</button>';
  h+='<button class="page-btn" onclick="cGoPage('+(Cp+1)+')" '+(Cp===tp?'disabled':'')+'>›</button>';
  bar.innerHTML=h;
}
function cGoPage(p){const tp=Math.ceil((Cf.length||1)/CPP);if(p<1||p>tp)return;Cp=p;cRenderTable();document.querySelector('#panel-collection .table-card').scrollIntoView({behavior:'smooth',block:'start'});}


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

// ── Hook into switchDB ─────────────────────────────────────────────────────
