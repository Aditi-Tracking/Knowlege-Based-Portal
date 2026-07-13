// Section: SmartFleet Dashboard (loadLeads, charts, filters, table)
// Data source: Supabase `leads_normalized` view (Odoo + Sheets synced leads, funnel_stage normalized).
let L=[],Lf=[],Lch={},Lp=1,Lsk=null,Lsd=1,Ltype='',Lkpi=null;
let Lcf={source:null,team:null,product:null,lostReason:null};
const LPP=15;
const LEADS_FIELDS='lead_name,contact_name,phone,email,funnel_stage,demo_reached,quotation_reached,salesperson_name,salesperson_email,team_name,source_channel,hero_product,city,lead_created_at,lead_updated_at,demo_given,quotation_sent,calls_made,order_value,won_revenue,probability,activity_state,is_active,lost_reason_name';

// Compact Indian-style money format — Cr for 1,00,00,000+, L for 1,00,000+, K for 1,000+, else plain.
function lFmtINR(v){
  v=v||0;
  if(v>=1e7)return(v/1e7).toFixed(2)+'Cr';
  if(v>=1e5)return(v/1e5).toFixed(2)+'L';
  if(v>=1e3)return(v/1e3).toFixed(0)+'K';
  return String(Math.round(v));
}
// Won: funnel_stage='Won'. Lost: funnel_stage='Lost' (sheets) OR is_active=false (odoo). Else Pending.
function lStage(r){
  if(r['funnel_stage']==='Won')return'Won';
  if(r['funnel_stage']==='Lost'||r['is_active']===false)return'Lost';
  return'Pending';
}
// For a Pending lead, work out which pipeline stage it's actually sitting in (for table display only —
// doesn't touch Won/Lost/Pending used by KPIs/charts/filters). The view's funnel_stage already carries
// the real stage (Contacted/Demo/Quotation/Negotiation/New Lead/...) for both Odoo and Sheets rows —
// Sheets rows have no CRM stage_id of their own, so the view derives their funnel_stage from
// demo_reached/quotation_reached internally; Odoo rows use their actual CRM stage. Either way funnel_stage
// is the one column to read here.
function lPendingSubStage(r){
  const fs=r['funnel_stage'];
  return(fs&&fs!=='Won'&&fs!=='Lost')?fs:null;
}
async function _leadsFetchAll(){
  const pageSize=1000,hdrs=SB_HDRS();
  const baseUrl=`${SUPABASE_URL}/rest/v1/leads_normalized?select=${LEADS_FIELDS}&order=lead_created_at.desc`;
  let all=[],offset=0;
  while(true){
    const res=await fetch(`${baseUrl}&limit=${pageSize}&offset=${offset}`,{headers:{...hdrs,'Range-Unit':'items','Range':`${offset}-${offset+pageSize-1}`}});
    if(!res.ok)throw new Error(res.status);
    const batch=await res.json();
    if(!Array.isArray(batch)||!batch.length)break;
    all=[...all,...batch];
    if(batch.length<pageSize)break;
    offset+=pageSize;
  }
  return all;
}
async function loadLeads(){
  document.getElementById('leadsTxt').textContent='Fetching data from Supabase...';
  try{
    const rows=await _leadsFetchAll();
    if(!Array.isArray(rows)||!rows.length)throw new Error('No leads found in leads_normalized');
    L=rows.map(r=>{
      const n={...r};
      n['probability']=n['probability']!=null?parseFloat(n['probability'])||0:0;
      n['order_value']=n['order_value']!=null?parseFloat(n['order_value'])||null:null;
      n['won_revenue']=n['won_revenue']!=null?parseFloat(n['won_revenue'])||null:null;
      n['Stage']=lStage(n);
      n['PendingSubStage']=n['Stage']==='Pending'?lPendingSubStage(n):null;
      n['RepName']=n['salesperson_name']||rN(n['salesperson_email'])||null;
      return n;
    }).filter(r=>r['contact_name']||r['lead_name']);
    document.getElementById('leadsLoad').style.display='none';document.getElementById('leadsCont').style.display='block';
    document.getElementById('leadsSync').textContent='Sync: '+new Date().toLocaleTimeString('en-IN');
    document.getElementById('leadsErr').style.display='none';
    lBuildFilters();lRenderAll();
  }catch(e){document.getElementById('leadsLoad').style.display='none';document.getElementById('leadsCont').style.display='block';document.getElementById('leadsErr').style.display='block';document.getElementById('leadsErr').textContent='⚠️ Data load failed: '+e.message;}
}
async function refreshLeads(){const b=document.getElementById('leadsRefBtn');b.classList.add('spinning');Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};document.getElementById('leadsLoad').style.display='flex';document.getElementById('leadsCont').style.display='none';await loadLeads();b.classList.remove('spinning');}
function lBuildFilters(){
  const src=[...new Set(L.map(r=>r['source_channel']).filter(Boolean))].sort();
  const team=[...new Set(L.map(r=>r['team_name']).filter(Boolean))].sort();
  const rep=[...new Set(L.map(r=>r['RepName']).filter(Boolean))].sort();
  const s1=document.getElementById('lFSrc');s1.innerHTML='<option value="">All Sources</option>';src.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s1.appendChild(o);});
  const s2=document.getElementById('lFTeam');s2.innerHTML='<option value="">All Teams</option>';team.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s2.appendChild(o);});
  const s3=document.getElementById('lFRep');s3.innerHTML='<option value="">All Sales Rep</option>';rep.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;s3.appendChild(o);});
  const s4=document.getElementById('lRepPerfSel');
  if(s4){const cur=s4.value;s4.innerHTML='<option value="">Select Sales Rep...</option>';rep.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;s4.appendChild(o);});if(rep.includes(cur))s4.value=cur;}
}
function lRenderAll(){lRenderKPIs();lRenderCharts();lRenderInsights();lApply();}
function lToday(){return new Date().toISOString().slice(0,10);}
function lMatchKpi(r,k){
  if(!k||k==='all')return true;
  if(k==='calls')return r['calls_made']===true;
  if(k==='quoted')return r['quotation_reached']===true;
  if(k==='demo')return r['demo_reached']===true;
  if(k==='won')return r['Stage']==='Won';
  if(k==='today')return(r['lead_created_at']||'').slice(0,10)===lToday();
  return true;
}
function lGetCF(){return L.filter(r=>{
  if(!lMatchKpi(r,Lkpi))return false;
  if(Lcf.source&&(r['source_channel']||'Unknown')!==Lcf.source)return false;
  if(Lcf.team&&(r['team_name']||'Unassigned')!==Lcf.team)return false;
  if(Lcf.product){const ps=(r['hero_product']||'').split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase());if(!ps.includes(Lcf.product))return false;}
  if(Lcf.lostReason&&(r['lost_reason_name']||'Unspecified')!==Lcf.lostReason)return false;
  return true;
});}
function lRenderKPIs(){
  const t=L.length;
  const calls=L.filter(r=>r['calls_made']===true).length;
  const q=L.filter(r=>r['quotation_reached']===true).length;
  const dm=L.filter(r=>r['demo_reached']===true).length;
  const won=L.filter(r=>r['Stage']==='Won');
  const rev=won.reduce((s,r)=>s+(r['won_revenue']??r['order_value']??0),0);
  const today=L.filter(r=>(r['lead_created_at']||'').slice(0,10)===lToday()).length;
  const pct=v=>t?((v/t)*100).toFixed(0):0;
  const kpis=[
    {l:'Total Leads',v:t,s:'All time',ic:'📊',bg:'#dbeafe',a:'#3b82f6',fk:'all'},
    {l:'No. of Calls',v:calls,s:pct(calls)+'% of leads',ic:'📞',bg:'#cffafe',a:'#06b6d4',fk:'calls'},
    {l:'Demo',v:dm,s:pct(dm)+'% of leads',ic:'🖥',bg:'#ede9fe',a:'#8b5cf6',fk:'demo'},
    {l:'Quotation',v:q,s:pct(q)+'% of leads',ic:'📄',bg:'#fae8ff',a:'#d946ef',fk:'quoted'},
    {l:'Won Lead',v:won.length,s:pct(won.length)+'% conv.',ic:'✅',bg:'#d1fae5',a:'#10b981',fk:'won'},
    {l:'Total Revenue',v:'₹'+lFmtINR(rev),s:won.length+' won deal'+(won.length!==1?'s':''),ic:'💰',bg:'#fef3c7',a:'#f59e0b',fk:null},
    {l:'Daily Lead',v:today,s:'Today · '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'}),ic:'📅',bg:'#ffe4e6',a:'#f43f5e',fk:'today'}
  ];
  document.getElementById('lKpiGrid').innerHTML=kpis.map(k=>{
    const clickable=!!k.fk;const ia=clickable&&Lkpi===k.fk&&Lkpi!=='all';
    return `<div class="kpi-card sf-tile ${ia?'kpi-active':''}" style="background:${k.bg};--card-accent:${k.a}" ${clickable?`onclick="lKpiClick('${k.fk}')"`:''}><div class="sf-tile-icon" style="background:${k.a}">${k.ic}</div><div class="kpi-value">${k.v}</div><div class="kpi-label">${k.l}</div><div class="kpi-sub" style="color:${k.a};font-weight:700;">${k.s}</div>${clickable?`<div class="kpi-click-hint">${ia?'✕ Clear':'↗ Filter'}</div>`:''}</div>`;
  }).join('');
}
function lKpiClick(fk){Lkpi=(Lkpi===fk&&fk!=='all')?null:fk;Ltype=(Lkpi==='won')?'Won':(Ltype==='Won'?'':Ltype);document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0&&!Ltype));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lBadge(){const b=document.getElementById('lCFBadge');const m={calls:'📞 Calls',quoted:'📄 Quoted',demo:'🖥 Demo',won:'✅ Won',today:'📅 Today'};const ca=Object.values(Lcf).filter(Boolean);if((Lkpi&&Lkpi!=='all')||ca.length>0){b.style.display='flex';let p=[];if(Lkpi&&Lkpi!=='all')p.push('<strong style="color:var(--accent2)">'+(m[Lkpi]||Lkpi)+'</strong>');if(ca.length)p.push('<strong style="color:var(--accent)">'+ca.join(' + ')+'</strong>');b.innerHTML='🎯 Filter: '+p.join(' & ')+' <span onclick="lClearAll()" style="cursor:pointer;color:var(--hot);margin-left:8px;font-weight:600">✕ Clear All</span>';}else b.style.display='none';}
function lClearAll(){Lkpi=null;Ltype='';Lcf={source:null,team:null,product:null,lostReason:null};document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lCF(k,v){Lcf[k]=Lcf[k]===v?null:v;lBadge();lApply();Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderCharts();}
function lRenderCharts(){
  const D=lGetCF();const sc=['#3b82f6','#06b6d4','#8b5cf6','#d946ef','#10b981','#f59e0b','#f43f5e'];
  const {tc:lTC,gc:lGC,noGrid:lNG}=chartColors();
  const dim=document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.08)';
  // Monthly Trend — Total leads vs Won leads, by month (chronological, oldest → newest)
  const mo={};D.forEach(r=>{
    const m=(r['lead_created_at']||'').slice(0,7);
    if(m.length!==7)return;
    if(!mo[m])mo[m]={total:0,won:0};
    mo[m].total++;
    if(r['Stage']==='Won')mo[m].won++;
  });
  const mk=Object.keys(mo).sort();
  const mLbl=m=>{const[y,mm]=m.split('-');return new Date(+y,+mm-1,1).toLocaleDateString('en-IN',{month:'short',year:'2-digit'});};
  Lch.trend=new Chart(document.getElementById('lChFunnel'),{type:'bar',data:{labels:mk.map(mLbl),datasets:[
    {label:'Total Leads',data:mk.map(m=>mo[m].total),backgroundColor:'rgba(59,130,246,0.65)',borderRadius:4,borderWidth:0},
    {label:'Won',data:mk.map(m=>mo[m].won),backgroundColor:'#10b981',borderRadius:4,borderWidth:0}
  ]},options:{plugins:{legend:{labels:{color:lTC,font:{family:'DM Sans',size:10}}}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:9}},grid:{display:false}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}}},responsive:true,maintainAspectRatio:false}});
  // Source Breakdown
  const so={};D.forEach(r=>{const s=r['source_channel']||'Unknown';so[s]=(so[s]||0)+1;});
  const ss=Object.entries(so).sort((a,b)=>b[1]-a[1]).slice(0,5);
  Lch.src=new Chart(document.getElementById('lChSrc'),{type:'bar',data:{labels:ss.map(([k])=>k),datasets:[{data:ss.map(([,v])=>v),backgroundColor:ss.map(([k],i)=>Lcf.source&&Lcf.source!==k?dim:sc[i%sc.length]),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',onClick:(_,e)=>{if(e.length)lCF('source',ss[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChSrc').style.cursor='pointer';
  // Team Breakdown
  const tmc={};D.forEach(r=>{const s=r['team_name']||'Unassigned';tmc[s]=(tmc[s]||0)+1;});const tmk=Object.keys(tmc);const tmcol=['#3b82f6','#06b6d4','#8b5cf6','#f59e0b','#f43f5e'];
  Lch.sol=new Chart(document.getElementById('lChSol'),{type:'doughnut',data:{labels:tmk,datasets:[{data:Object.values(tmc),backgroundColor:tmk.map((k,i)=>Lcf.team&&Lcf.team!==k?dim:tmcol[i%tmcol.length]),borderWidth:0,hoverOffset:8}]},options:{cutout:'65%',onClick:(_,e)=>{if(e.length)lCF('team',tmk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:lTC,padding:10,font:{family:'DM Sans',size:10}}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChSol').style.cursor='pointer';
  // Daily Lead Volume
  const dc={};D.forEach(r=>{const d=(r['lead_created_at']||'').slice(0,10);if(d.length===10)dc[d]=(dc[d]||0)+1;});
  const ds=Object.keys(dc).sort();
  Lch.day=new Chart(document.getElementById('lChDay'),{type:'line',data:{labels:ds.map(d=>d.slice(5)),datasets:[{data:ds.map(d=>dc[d]),borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.08)',fill:true,tension:0.4,pointBackgroundColor:'#3b82f6',pointRadius:4,borderWidth:2}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}}},responsive:true,maintainAspectRatio:false}});
  // Hero Product Demand — Won leads only
  const pc={};D.filter(r=>r['Stage']==='Won').forEach(r=>{if(!r['hero_product'])return;r['hero_product'].split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase()).filter(Boolean).forEach(p=>{pc[p]=(pc[p]||0)+1;});});
  const ps=Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,8);
  Lch.prod=new Chart(document.getElementById('lChProd'),{type:'bar',data:{labels:ps.map(([k])=>k),datasets:[{data:ps.map(([,v])=>v),backgroundColor:ps.map(([k])=>Lcf.product&&Lcf.product!==k?dim:'#10b981'),borderRadius:6,borderWidth:0}]},options:{onClick:(_,e)=>{if(e.length)lCF('product',ps[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:9}},grid:{display:false}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChProd').style.cursor='pointer';
  // Lost Reasons
  const lr={};D.filter(r=>r['Stage']==='Lost').forEach(r=>{const k=r['lost_reason_name']||'Unspecified';lr[k]=(lr[k]||0)+1;});
  const ls=Object.entries(lr).sort((a,b)=>b[1]-a[1]).slice(0,8);
  Lch.lost=new Chart(document.getElementById('lChLost'),{type:'bar',data:{labels:ls.map(([k])=>k),datasets:[{data:ls.map(([,v])=>v),backgroundColor:ls.map(([k])=>Lcf.lostReason&&Lcf.lostReason!==k?dim:'#ef4444'),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',onClick:(_,e)=>{if(e.length)lCF('lostReason',ls[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChLost').style.cursor='pointer';
}
function lRenderInsights(){
  lRenderRepLB();
}
// Sales Rep Performance — pick a rep from the top-right dropdown, see their Total/Demo/Quotation/Won/Revenue.
function lRenderRepLB(){
  const sel=document.getElementById('lRepPerfSel');
  const chosen=sel?sel.value:'';
  const box=document.getElementById('lRepLB');
  if(!chosen){
    box.innerHTML='<div style="padding:22px 4px;text-align:center;color:var(--muted);font-size:0.85rem;">👆 Select a sales rep above to view their performance</div>';
    return;
  }
  const rows=L.filter(r=>(r['RepName']||'Unassigned')===chosen);
  if(!rows.length){box.innerHTML='<div style="padding:22px 4px;text-align:center;color:var(--muted);font-size:0.85rem;">No data for this rep</div>';return;}
  const email=rows.find(r=>r['salesperson_email'])?.['salesperson_email'];
  const s={total:0,demo:0,quoted:0,won:0,revenue:0};
  rows.forEach(r=>{
    s.total++;
    if(r['demo_reached']===true)s.demo++;
    if(r['quotation_reached']===true)s.quoted++;
    if(r['Stage']==='Won'){s.won++;s.revenue+=(r['won_revenue']??r['order_value']??0);}
  });
  box.innerHTML=`
    <div class="lb-row" style="border-bottom:none;">
      <div class="rep-dot" style="background:${rB(email)};color:${rC(email)};width:38px;height:38px;font-size:0.98rem">${chosen.charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:100px;font-size:1rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:12px">${chosen}</div>
      <div style="display:flex;gap:32px;flex-shrink:0">
        <div style="text-align:center;min-width:56px"><div style="font-size:1.4rem;font-weight:700;color:var(--text)">${s.total}</div><div style="font-size:0.7rem;color:var(--muted)">TOTAL</div></div>
        <div style="text-align:center;min-width:56px"><div style="font-size:1.4rem;font-weight:700;color:#3b82f6">${s.demo}</div><div style="font-size:0.7rem;color:var(--muted)">DEMO</div></div>
        <div style="text-align:center;min-width:60px"><div style="font-size:1.4rem;font-weight:700;color:#60a5fa">${s.quoted}</div><div style="font-size:0.7rem;color:var(--muted)">QUOTE</div></div>
        <div style="text-align:center;min-width:56px"><div style="font-size:1.4rem;font-weight:700;color:#10b981">${s.won}</div><div style="font-size:0.7rem;color:var(--muted)">WON</div></div>
        <div style="text-align:center;min-width:100px"><div style="font-size:1.4rem;font-weight:700;color:var(--text)">₹${lFmtINR(s.revenue)}</div><div style="font-size:0.7rem;color:var(--muted)">REVENUE</div></div>
      </div>
    </div>`;
}
function lSetType(v,b){Ltype=v;document.querySelectorAll('#panel-leads .filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');lApply();}
function lApply(){
  const q=document.getElementById('lSearch').value.toLowerCase(),src=document.getElementById('lFSrc').value,team=document.getElementById('lFTeam').value,rep=document.getElementById('lFRep').value;
  Lf=L.filter(r=>{
    if(q&&!((r['contact_name']||r['lead_name']||'').toLowerCase().includes(q)||String(r['phone']||'').includes(q)||(r['email']||'').toLowerCase().includes(q)))return false;
    if(src&&r['source_channel']!==src)return false;if(team&&r['team_name']!==team)return false;if(rep&&r['RepName']!==rep)return false;
    if(Ltype&&r['Stage']!==Ltype)return false;
    if(!lMatchKpi(r,Lkpi))return false;
      if(Lcf.source&&(r['source_channel']||'Unknown')!==Lcf.source)return false;
    if(Lcf.team&&(r['team_name']||'Unassigned')!==Lcf.team)return false;
    if(Lcf.product){const ps=(r['hero_product']||'').split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase());if(!ps.includes(Lcf.product))return false;}
  if(Lcf.lostReason&&(r['lost_reason_name']||'Unspecified')!==Lcf.lostReason)return false;
    return true;
  });
  if(Lsk){
    Lf.sort((a,b)=>{
      let av,bv;
      if(Lsk==='revenue'){av=a['won_revenue']??a['order_value']??0;bv=b['won_revenue']??b['order_value']??0;}
      else{av=a[Lsk]??'';bv=b[Lsk]??'';}
      if(!isNaN(av)&&!isNaN(bv)&&av!==''&&bv!=='')return(+av-+bv)*Lsd;
      return String(av).localeCompare(String(bv))*Lsd;
    });
  }
  Lp=1;lRenderTable();
}
function lReset(){document.getElementById('lSearch').value='';document.getElementById('lFSrc').value='';document.getElementById('lFTeam').value='';document.getElementById('lFRep').value='';Ltype='';Lkpi=null;Lcf={source:null,team:null,product:null,lostReason:null};document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lSort(k){Lsk=Lsk===k?(Lsd*=-1,k):(Lsd=1,k);lApply();}
function lRenderTable(){
  const tot=Lf.length,tp=Math.max(1,Math.ceil(tot/LPP)),pg=Lf.slice((Lp-1)*LPP,Lp*LPP);
  document.getElementById('lTblCnt').textContent=tot+' lead'+(tot!==1?'s':'');
  const tb=document.getElementById('lTblBody');
  if(!pg.length){tb.innerHTML='<tr><td colspan="10"><div class="empty-state">No leads found</div></td></tr>';return;}
  tb.innerHTML=pg.map(r=>{
    const pr=r['probability']||0;const prc=pr>=70?'#10b981':pr>=40?'#3b82f6':'#ef4444';
    const st=r['Stage'];const sc2=st==='Won'?'badge-won':st==='Lost'?'badge-lost':'badge-open';const stt=st==='Won'?'✓ Won':st==='Lost'?'✗ Lost':(r['PendingSubStage']?'● '+r['PendingSubStage']:'● Pending');
    const ov=(r['won_revenue']??r['order_value'])?'₹'+(+(r['won_revenue']??r['order_value'])).toLocaleString('en-IN'):'—';
    const nm=r['contact_name']||r['lead_name']||'—';
    const repNm=r['RepName']||'—';
    return`<tr><td><div style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis">${nm.slice(0,22)}</div><div style="font-size:0.78rem;color:var(--muted)">${r['city']||''}</div></td><td style="font-size:0.83rem">${r['source_channel']||'—'}</td><td><div class="rep-info"><div class="rep-dot" style="background:${rB(r['salesperson_email'])};color:${rC(r['salesperson_email'])}">${repNm.charAt(0).toUpperCase()}</div><span style="font-size:0.83rem">${repNm}</span></div></td><td style="font-size:0.80rem;color:var(--muted)">${(r['hero_product']||'—').slice(0,18)}</td><td><div class="wc-wrap"><div class="wc-bar"><div class="wc-fill" style="width:${pr}%;background:${prc}"></div></div><span style="font-size:0.82rem;font-weight:600;color:${prc}">${Math.round(pr)}%</span></div></td><td><span class="badge ${sc2}">${stt}</span></td><td><span style="font-size:0.83rem;color:${r['calls_made']===true?'var(--won)':'var(--muted)'}">${r['calls_made']===true?'✓ Yes':'✗ No'}</span></td><td><span style="font-size:0.83rem;color:${r['demo_given']===true?'var(--won)':'var(--muted)'}">${r['demo_given']===true?'✓ Yes':'✗ No'}</span></td><td><span style="font-size:0.83rem;color:${r['quotation_sent']===true?'var(--won)':'var(--muted)'}">${r['quotation_sent']===true?'✓ Sent':'✗ No'}</span></td><td style="font-weight:600;color:${(r['won_revenue']??r['order_value'])?'var(--accent)':'var(--muted)'}">${ov}</td></tr>`;
  }).join('');
  const bar=document.getElementById('lPagBar');if(tp<=1){bar.innerHTML='';return;}
  let h='<span class="page-info">Page '+Lp+' of '+tp+'</span><button class="page-btn" onclick="lGoPage('+(Lp-1)+')" '+(Lp===1?'disabled':'')+'>‹</button>';
  lPageList(Lp,tp).forEach(p=>{h+=p==='…'?'<span class="page-ellipsis">…</span>':'<button class="page-btn '+(p===Lp?'active':'')+'" onclick="lGoPage('+p+')">'+p+'</button>';});
  h+='<button class="page-btn" onclick="lGoPage('+(Lp+1)+')" '+(Lp===tp?'disabled':'')+'>›</button>';bar.innerHTML=h;
}
function lPageList(cur,tot){
  const delta=2,range=[1];
  for(let i=Math.max(2,cur-delta);i<=Math.min(tot-1,cur+delta);i++)range.push(i);
  if(tot>1)range.push(tot);
  const out=[];
  range.forEach((p,i)=>{if(i&&p-range[i-1]>1)out.push('…');out.push(p);});
  return out;
}
function lGoPage(p){const tp=Math.ceil(Lf.length/LPP);if(p<1||p>tp)return;Lp=p;lRenderTable();document.querySelector('#panel-leads .table-card').scrollIntoView({behavior:'smooth',block:'start'});}
