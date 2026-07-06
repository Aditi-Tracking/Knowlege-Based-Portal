// Section: Enterprise Lead Dashboard (loadEnterprise, charts, filters, table)
// Data source: Google Apps Script (EN_URL) — fully dynamic, click-to-filter
// Access control: gated by PERMISSIONS.can_view_enterprise (see _canAccessEnterprise below)

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
const EN_URL='https://script.google.com/macros/s/AKfycbycTqWxk0GP_wuWOC8txx0Q6ZkPNk-MGZffPH53YbuNYD14ioMstVedjdpy62xzK6Q/exec';
let EN=[],ENf=[],ENch={},ENp=1,ENsk=null,ENsd=1,ENkpi=null,ENtblOpen=true;
let ENcf={status:null,city:null,outreach:null,convertedOnly:false};
const ENPP=15;
// Colour + badge-class helpers — status text in the sheet can be a temperature
// (Hot/Warm/Cold) OR an outcome (Won/Lost) OR anything else. We handle both.
function enStatusColor(v){
  const s=(v||'').toString().toLowerCase();
  if(/\bhot\b/.test(s))return '#ff5c7c';
  if(/\bwarm\b/.test(s))return '#f0a500';
  if(/\bcold\b/.test(s))return '#4e9af1';
  if(/won|convert|closed.?won|success|confirmed|deal.?done/.test(s))return '#00d4aa';
  if(/lost|closed.?lost|reject|cancel|declined|not.?interested/.test(s))return '#a78bfa';
  return null;
}
function enStatusBadge(v){
  const s=(v||'').toString().toLowerCase();
  if(/\bhot\b/.test(s))return 'badge-hot';
  if(/\bwarm\b/.test(s))return 'badge-warm';
  if(/\bcold\b/.test(s))return 'badge-cold';
  if(/won|convert|closed.?won|success|confirmed|deal.?done/.test(s))return 'badge-won';
  if(/lost|closed.?lost|reject|cancel|declined|not.?interested/.test(s))return 'badge-lost';
  return 'badge-open';
}
function enIsConverted(r){return /won|convert|closed.?won|success|confirmed|deal.?done/.test((r['_Status']||'').toString().toLowerCase());}
function enIsLost(r){return /lost|closed.?lost|reject|cancel|declined|not.?interested/.test((r['_Status']||'').toString().toLowerCase());}
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
    const sampleKeys=Object.keys(rows[0]||{});
    // Exact sheet columns: Date, Stakeholder, City, Phone, Outreach By, Probability, Status, ACV, MRR, Comments
    const dateCol=sampleKeys.find(k=>/^date$/i.test(k))||sampleKeys.find(k=>/date|timestamp|created/i.test(k));
    const stakeCol=sampleKeys.find(k=>/stakeholder/i.test(k))||sampleKeys.find(k=>/client|company|customer|contact|^name$/i.test(k))||sampleKeys[0];
    const cityCol=sampleKeys.find(k=>/^city$/i.test(k))||sampleKeys.find(k=>/city|location/i.test(k));
    const phoneCol=sampleKeys.find(k=>/phone|mobile|contact.?no/i.test(k));
    const outreachCol=sampleKeys.find(k=>/outreach/i.test(k))||sampleKeys.find(k=>/executive|sales.?rep|rep.?name|assigned.?to|handled.?by|owner|email/i.test(k));
    const probCol=sampleKeys.find(k=>/probability|win.?chance|win.?%/i.test(k));
    const statusCol=sampleKeys.find(k=>/^status$/i.test(k))||sampleKeys.find(k=>/status|stage|outcome|conversion|result/i.test(k));
    const acvCol=sampleKeys.find(k=>/\bacv\b/i.test(k));
    const mrrCol=sampleKeys.find(k=>/\bmrr\b/i.test(k));
    const commentsCol=sampleKeys.find(k=>/comment|remark|note/i.test(k));
    const productCol=sampleKeys.find(k=>/product|solution|hero.?product/i.test(k));
    EN=rows.map(r=>{
      const n={...r};
      n['_Date']=dateCol?(r[dateCol]||'').toString().trim():'';
      n['_Stakeholder']=stakeCol?(r[stakeCol]||'').toString().trim():'';
      n['_City']=cityCol?(r[cityCol]||'').toString().trim():'';
      n['_Phone']=phoneCol?(r[phoneCol]||'').toString().trim():'';
      n['_Outreach']=outreachCol?(r[outreachCol]||'').toString().trim():'';
      n['_Probability']=probCol?(r[probCol]||'').toString().trim():'';
      n['_Status']=statusCol?(r[statusCol]||'').toString().trim():'';
      n['_ACV']=acvCol?(r[acvCol]||'').toString().trim():'';
      n['_MRR']=mrrCol?(r[mrrCol]||'').toString().trim():'';
      n['_Comments']=commentsCol?(r[commentsCol]||'').toString().trim():'';
      n['_Product']=productCol?(r[productCol]||'').toString().trim():'';
      return n;
    }).filter(r=>r['_Stakeholder']);
    if(!EN.length)throw new Error('No data — could not detect a Stakeholder column. Sheet columns: '+sampleKeys.slice(0,6).join(', ')+'...');
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
  const city=[...new Set(EN.map(r=>r['_City']).filter(Boolean))].sort();
  const out=[...new Set(EN.map(r=>r['_Outreach']).filter(Boolean))].sort();
  const st=[...new Set(EN.map(r=>r['_Status']).filter(Boolean))].sort();
  const s1=document.getElementById('enFSource');s1.innerHTML='<option value="">All Cities</option>';city.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;s1.appendChild(o);});
  const s2=document.getElementById('enFRep');s2.innerHTML='<option value="">All Outreach By</option>';out.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;s2.appendChild(o);});
  const s3=document.getElementById('enFStatus');s3.innerHTML='<option value="">All Status</option>';st.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s3.appendChild(o);});
}
function enRenderAll(){enRenderKPIs();enRenderCharts();enApply();}
function enGetCF(){return EN.filter(r=>{
  if(ENcf.status&&r['_Status']!==ENcf.status)return false;
  if(ENcf.city&&r['_City']!==ENcf.city)return false;
  if(ENcf.outreach&&r['_Outreach']!==ENcf.outreach)return false;
  if(ENcf.convertedOnly&&!enIsConverted(r))return false;
  return true;
});}
function enRenderKPIs(){
  const t=EN.length;
  const uniqueClients=new Set(EN.map(r=>r['_Stakeholder'])).size;
  const hasDates=EN.some(r=>r['_Date']);
  const uniqueMeetings=hasDates?new Set(EN.map(r=>r['_Stakeholder']+'|'+r['_Date'])).size:t;
  const converted=EN.filter(enIsConverted).length;
  const crKnown=uniqueMeetings>0;
  const cr=crKnown?((converted/uniqueMeetings)*100).toFixed(1)+'%':'—';
  const crSub=crKnown?converted+' won / '+uniqueMeetings+' unique meetings':'No meetings found yet';
  const kpis=[
    {l:'No. of Unique Client Meetings',v:uniqueMeetings,s:t+' total record'+(t!==1?'s':''),a:'#f0a500',b:'Live',bb:'rgba(240,165,0,0.15)',fk:'meetings'},
    {l:'Conversion Ratio',v:cr,s:crSub,a:'#00d4aa',b:crKnown?'Tracked':'—',bb:'rgba(0,212,170,0.15)',fk:'converted'},
    {l:'Clients',v:uniqueClients,s:'Unique stakeholders met',a:'#4e9af1',b:'Enterprise',bb:'rgba(78,154,241,0.15)',fk:'clients'}
  ];
  document.getElementById('enKpiGrid').innerHTML=kpis.map(k=>{const ia=ENkpi===k.fk&&ENkpi!==null;return `<div class="kpi-card ${ia?'kpi-active':''}" style="--card-accent:${k.a};--card-color:${k.a}" onclick="enKpiClick('${k.fk}')"><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div><span class="kpi-badge" style="background:${k.bb};color:${k.a}">${k.b}</span><div class="kpi-click-hint">${ia?'✕ Clear':'→ Filter'}</div></div>`;}).join('');
}
function enKpiClick(fk){
  if(fk==='converted'){
    ENcf.convertedOnly=!ENcf.convertedOnly;
    ENkpi=ENcf.convertedOnly?'converted':null;
  }else{
    ENkpi=null;ENcf={status:null,city:null,outreach:null,convertedOnly:false};
  }
  Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};
  enRenderAll();enBadge();
}
function enBadge(){
  const b=document.getElementById('enCFBadge');
  const parts=[];
  if(ENcf.status)parts.push(ENcf.status);
  if(ENcf.city)parts.push(ENcf.city);
  if(ENcf.outreach)parts.push(ENcf.outreach);
  if(ENcf.convertedOnly)parts.push('Won');
  if(parts.length){b.style.display='flex';b.innerHTML='🎯 Filter: <strong style="color:var(--accent)">'+parts.join(' + ')+'</strong> <span onclick="enClearAll()" style="cursor:pointer;color:var(--hot);margin-left:8px;font-weight:600">✕ Clear All</span>';}
  else b.style.display='none';
}
function enClearAll(){ENkpi=null;ENcf={status:null,city:null,outreach:null,convertedOnly:false};Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};enRenderAll();enBadge();}
function enCF(k,v){ENcf[k]=ENcf[k]===v?null:v;enBadge();Object.values(ENch).forEach(c=>c&&c.destroy&&c.destroy());ENch={};enRenderCharts();enApply();}
function enRenderCharts(){
  const D=enGetCF();const sc=['#f0a500','#00d4aa','#ff5c7c','#4e9af1','#a78bfa','#f97316','#10b981'];
  const {tc:eTC,gc:eGC,noGrid:eNG}=chartColors();
  const isLight=document.body.classList.contains('light-mode');
  const dim=isLight?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.07)';

  // ── Lead Status Breakdown (doughnut, raw status values — Hot/Warm/Cold/Won/Lost/etc.) ──
  const stc={};D.forEach(r=>{const s=r['_Status']||'Unspecified';stc[s]=(stc[s]||0)+1;});
  const sk=Object.keys(stc);
  ENch.status=new Chart(document.getElementById('enChStatus'),{type:'doughnut',data:{labels:sk,datasets:[{data:sk.map(k=>stc[k]),backgroundColor:sk.map((k,i)=>ENcf.status&&ENcf.status!==k?dim:(enStatusColor(k)||sc[i%sc.length])),borderWidth:0,hoverOffset:8}]},options:{cutout:'68%',onClick:(_,e)=>{if(e.length)enCF('status',sk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChStatus').style.cursor='pointer';

  // ── Daily Leads (line, by calendar date) ──
  const dc={};D.forEach(r=>{let d=(r['_Date']||'').toString();let key='';const m1=d.match(/^(\d{4})-(\d{2})-(\d{2})/);const m2=d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(m1)key=m1[1]+'-'+m1[2]+'-'+m1[3];else if(m2)key=m2[3]+'-'+m2[2]+'-'+m2[1];else if(d)key=d.slice(0,10);if(key&&key.length===10)dc[key]=(dc[key]||0)+1;});
  const ds=Object.keys(dc).sort();
  ENch.daily=new Chart(document.getElementById('enChDaily'),{type:'line',data:{labels:ds.map(d=>d.slice(5)),datasets:[{data:ds.map(d=>dc[d]),borderColor:'#00d4aa',backgroundColor:'rgba(0,212,170,0.1)',fill:true,tension:0.4,pointBackgroundColor:'#00d4aa',pointRadius:4,borderWidth:2}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}}},responsive:true,maintainAspectRatio:false}});

  // ── Top Cities (bar) ──
  const ci={};D.forEach(r=>{const c=r['_City']||'Unknown';ci[c]=(ci[c]||0)+1;});
  const cis=Object.entries(ci).sort((a,b)=>b[1]-a[1]).slice(0,10);
  ENch.city=new Chart(document.getElementById('enChCity'),{type:'bar',data:{labels:cis.map(([k])=>k),datasets:[{data:cis.map(([,v])=>v),backgroundColor:cis.map(([k],i)=>ENcf.city&&ENcf.city!==k?dim:sc[i%sc.length]),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',onClick:(_,e)=>{if(e.length)enCF('city',cis[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChCity').style.cursor='pointer';

  // ── Top Performers — Outreach By (bar) ──
  const oc={};D.forEach(r=>{const o=r['_Outreach']||'Unassigned';oc[o]=(oc[o]||0)+1;});
  const os=Object.entries(oc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  ENch.outreach=new Chart(document.getElementById('enChOutreach'),{type:'bar',data:{labels:os.map(([k])=>k),datasets:[{data:os.map(([,v])=>v),backgroundColor:os.map(([k])=>ENcf.outreach&&ENcf.outreach!==k?dim:'#a78bfa'),borderRadius:6,borderWidth:0}]},options:{onClick:(_,e)=>{if(e.length)enCF('outreach',os[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:eTC,font:{family:'DM Sans',size:9}},grid:{display:false}},y:{ticks:{color:eTC,font:{family:'DM Sans',size:10}},grid:{display:!eNG,color:eGC}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('enChOutreach').style.cursor='pointer';

  // ── Product Mix (doughnut) ──
  const pc={};D.forEach(r=>{const p=r['_Product']||'Unspecified';pc[p]=(pc[p]||0)+1;});
  const pk=Object.keys(pc);
  ENch.product=new Chart(document.getElementById('enChProduct'),{type:'doughnut',data:{labels:pk,datasets:[{data:pk.map(k=>pc[k]),backgroundColor:pk.map((k,i)=>sc[i%sc.length]),borderWidth:0,hoverOffset:8}]},options:{cutout:'65%',plugins:{legend:{position:'right',labels:{color:eTC,padding:10,font:{family:'DM Sans',size:10}}}},responsive:true,maintainAspectRatio:false}});
}
function enApply(){
  const q=(document.getElementById('enSearch').value||'').toLowerCase();
  const city=document.getElementById('enFSource').value,out=document.getElementById('enFRep').value,st=document.getElementById('enFStatus').value;
  ENf=EN.filter(r=>{
    if(q&&!((r['_Stakeholder']||'').toLowerCase().includes(q)||(r['_City']||'').toLowerCase().includes(q)||(r['_Phone']||'').toLowerCase().includes(q)||(r['_Outreach']||'').toLowerCase().includes(q)))return false;
    if(city&&r['_City']!==city)return false;
    if(out&&r['_Outreach']!==out)return false;
    if(st&&r['_Status']!==st)return false;
    if(ENcf.status&&r['_Status']!==ENcf.status)return false;
    if(ENcf.city&&r['_City']!==ENcf.city)return false;
    if(ENcf.outreach&&r['_Outreach']!==ENcf.outreach)return false;
    if(ENcf.convertedOnly&&!enIsConverted(r))return false;
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
  const heads=[{k:'_Date',l:'DATE',s:true},{k:'_Stakeholder',l:'STAKEHOLDER',s:true},{k:'_City',l:'CITY',s:false},{k:'_Phone',l:'PHONE',s:false},{k:'_Outreach',l:'OUTREACH BY',s:false},{k:'_Probability',l:'PROBABILITY',s:false},{k:'_Status',l:'STATUS',s:true},{k:'_ACV',l:'ACV',s:true},{k:'_MRR',l:'MRR',s:true},{k:'_Comments',l:'COMMENTS',s:false}];
  const thh=document.getElementById('enTblHead');if(thh)thh.innerHTML=heads.map(h=>h.s?`<th onclick="enSort('${h.k}')">${h.l} ↕</th>`:`<th>${h.l}</th>`).join('');
  const tot=ENf.length,tp=Math.max(1,Math.ceil(tot/ENPP));
  if(ENp>tp)ENp=tp;
  const pg=ENf.slice((ENp-1)*ENPP,ENp*ENPP);
  document.getElementById('enTblCnt').textContent=tot+' lead'+(tot!==1?'s':'');
  const tb=document.getElementById('enTblBody');
  if(!pg.length){tb.innerHTML='<tr><td colspan="10"><div class="empty-state">No leads found</div></td></tr>';document.getElementById('enPagBar').innerHTML='';return;}
  tb.innerHTML=pg.map(r=>{
    const bc=enStatusBadge(r['_Status']);
    const acv=r['_ACV']?(isNaN(r['_ACV'])?r['_ACV']:'₹'+(+r['_ACV']).toLocaleString('en-IN')):'—';
    const mrr=r['_MRR']?(isNaN(r['_MRR'])?r['_MRR']:'₹'+(+r['_MRR']).toLocaleString('en-IN')):'—';
    const prob=r['_Probability']?(isNaN(r['_Probability'])?r['_Probability']:r['_Probability']+'%'):'—';
    return `<tr><td style="font-size:0.83rem;color:var(--muted)">${r['_Date']||'—'}</td><td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis">${r['_Stakeholder']||'—'}</td><td style="font-size:0.83rem">${r['_City']||'—'}</td><td style="font-size:0.83rem">${r['_Phone']||'—'}</td><td style="font-size:0.83rem">${r['_Outreach']||'—'}</td><td style="font-size:0.83rem">${prob}</td><td><span class="badge ${bc}">${r['_Status']||'—'}</span></td><td style="font-weight:600;color:var(--accent)">${acv}</td><td style="font-weight:600;color:var(--won)">${mrr}</td><td style="font-size:0.80rem;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis">${r['_Comments']||'—'}</td></tr>`;
  }).join('');
  document.getElementById('enPagBar').innerHTML=enPagerHTML(ENp,tp,'enGoPage');
}
function enGoPage(p){const tp=Math.ceil(ENf.length/ENPP)||1;if(p<1||p>tp)return;ENp=p;enRenderTable();document.querySelector('#panel-enterprise .table-card').scrollIntoView({behavior:'smooth',block:'start'});}
