// Section: Lead Tracking Dashboard (loadLeads, charts, filters, table)
let L=[],Lf=[],Lch={},Lp=1,Lsk=null,Lsd=1,Ltype='',Lkpi=null;
let Lcf={leadType:null,source:null,solution:null,product:null};
const LPP=15;

async function loadLeads(){
  document.getElementById('leadsTxt').textContent='Fetching data from Google Sheet...';
  try{
    let rows;
    if(_leadsCache){rows=_leadsCache;_leadsCache=null;}
    else{const res=await fetch(L_URL);if(!res.ok)throw new Error(res.status);rows=await res.json();}
    // Normalize {h:[headers], r:[[row],[row]]} compressed format → array of objects
    if(rows&&!Array.isArray(rows)&&rows.h&&rows.r){
      const headers=rows.h;
      rows=rows.r.map(row=>{const obj={};headers.forEach((k,i)=>{obj[k]=row[i]??'';});return obj;});
    } else if(rows&&!Array.isArray(rows)&&rows.data&&Array.isArray(rows.data)){
      rows=rows.data;
    }
    // Auto-detect CustomerName column (handles different naming conventions)
    if(!Array.isArray(rows)||!rows.length)throw new Error('API returned empty or invalid data');
    const sampleKeys=Object.keys(rows[0]||{});
    const custCol=sampleKeys.find(k=>/customer.?name|client.?name|name|cust/i.test(k))||sampleKeys[0];
    const winCol=sampleKeys.find(k=>/win.?chance|winchance|chance|score/i.test(k))||'WinChances';
    const orderCol=sampleKeys.find(k=>/order.?value|value|amount|revenue/i.test(k))||'Order Value';
    const wonCol=sampleKeys.find(k=>/^won$|^win$|closed/i.test(k))||'Won';
    const sourceCol=sampleKeys.find(k=>/^source$/i.test(k))||'Source';
    const solutionCol=sampleKeys.find(k=>/^solution$/i.test(k))||'Solution';
    const heroCol=sampleKeys.find(k=>/hero.?product|product/i.test(k))||'Hero Product';
    const emailCol=sampleKeys.find(k=>/email.?address|emailaddress|email|rep/i.test(k))||'Emailaddress';
    const tsCol=sampleKeys.find(k=>/timestamp|date|created/i.test(k))||'Timestamp';
    const quoteCol=sampleKeys.find(k=>/quotation|quote/i.test(k))||'Quotation Sent';
    const demoCol=sampleKeys.find(k=>/demo/i.test(k))||'IstheDemoGiven';
    const fu1Col=sampleKeys.find(k=>/follow.?up.?1|followup.?1|fu.?1/i.test(k))||'Follow-up 1 ';
    const fu2Col=sampleKeys.find(k=>/follow.?up.?2|followup.?2|fu.?2/i.test(k))||'Follow-up 2 ';
    const fu3Col=sampleKeys.find(k=>/follow.?up.?3|followup.?3|fu.?3/i.test(k))||'Follow-up 3';
    const lostCol=sampleKeys.find(k=>/^lost$/i.test(k))||'Lost';
    L=rows.map(r=>{
      const n={};
      Object.keys(r).forEach(k=>{n[k]=r[k]===''||r[k]===undefined?null:r[k];});
      // Normalize to expected keys
      if(custCol!=='CustomerName')n['CustomerName']=r[custCol]||null;
      if(winCol!=='WinChances')n['WinChances']=r[winCol]||null;
      if(orderCol!=='Order Value')n['Order Value']=r[orderCol]||null;
      if(wonCol!=='Won')n['Won']=r[wonCol]||null;
      if(sourceCol!=='Source')n['Source']=r[sourceCol]||null;
      if(solutionCol!=='Solution')n['Solution']=r[solutionCol]||null;
      if(heroCol!=='Hero Product')n['Hero Product']=r[heroCol]||null;
      if(emailCol!=='Emailaddress')n['Emailaddress']=r[emailCol]||null;
      if(tsCol!=='Timestamp')n['Timestamp']=r[tsCol]||null;
      if(quoteCol!=='Quotation Sent')n['Quotation Sent']=r[quoteCol]||null;
      if(demoCol!=='IstheDemoGiven')n['IstheDemoGiven']=r[demoCol]||null;
      if(fu1Col!=='Follow-up 1 ')n['Follow-up 1 ']=r[fu1Col]||null;
      if(fu2Col!=='Follow-up 2 ')n['Follow-up 2 ']=r[fu2Col]||null;
      if(fu3Col!=='Follow-up 3')n['Follow-up 3']=r[fu3Col]||null;
      if(lostCol!=='Lost')n['Lost']=r[lostCol]||null;
      const wc=parseFloat(n['WinChances'])||0;
      n['LeadType']=wc<=2?'Cold':wc<=5?'Warm':'Hot';
      n['WinChances']=wc;
      n['Order Value']=n['Order Value']?parseFloat(n['Order Value'])||null:null;
      return n;
    }).filter(r=>r['CustomerName']);
    if(!L.length)throw new Error('No data — Column mismatch. Sheet columns: '+sampleKeys.slice(0,5).join(', ')+'...');
    document.getElementById('leadsLoad').style.display='none';document.getElementById('leadsCont').style.display='block';
    document.getElementById('leadsSync').textContent='Sync: '+new Date().toLocaleTimeString('en-IN');
    document.getElementById('leadsErr').style.display='none';
    lBuildFilters();lRenderAll();
  }catch(e){document.getElementById('leadsLoad').style.display='none';document.getElementById('leadsCont').style.display='block';document.getElementById('leadsErr').style.display='block';document.getElementById('leadsErr').textContent='⚠️ Data load failed: '+e.message;}
}
async function refreshLeads(){const b=document.getElementById('leadsRefBtn');b.classList.add('spinning');Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};document.getElementById('leadsLoad').style.display='flex';document.getElementById('leadsCont').style.display='none';await loadLeads();b.classList.remove('spinning');}
function lBuildFilters(){
  const src=[...new Set(L.map(r=>r['Source']).filter(Boolean))].sort();
  const sol=[...new Set(L.map(r=>r['Solution']).filter(Boolean))].sort();
  const rep=[...new Set(L.map(r=>r['Emailaddress']).filter(Boolean))];
  const s1=document.getElementById('lFSrc');s1.innerHTML='<option value="">All Sources</option>';src.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s1.appendChild(o);});
  const s2=document.getElementById('lFSol');s2.innerHTML='<option value="">All Solutions</option>';sol.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;s2.appendChild(o);});
  const s3=document.getElementById('lFRep');s3.innerHTML='<option value="">All Reps</option>';rep.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=rN(r);s3.appendChild(o);});
}
function lRenderAll(){lRenderKPIs();lRenderCharts();lRenderInsights();lApply();}
function lGetCF(){return L.filter(r=>{
  if(Lkpi&&Lkpi!=='all'){if(Lkpi==='won'&&r['Lead Status']!=='Won')return false;if(Lkpi==='hot'&&r['LeadType']!=='Hot')return false;if(Lkpi==='warm'&&r['LeadType']!=='Warm')return false;if(Lkpi==='cold'&&r['LeadType']!=='Cold')return false;if(Lkpi==='quoted'&&r['Quotation Sent']!=='Yes')return false;}
  if(Lcf.leadType&&r['LeadType']!==Lcf.leadType)return false;
  if(Lcf.source){const s=(r['Source']||'').replace('Google Ads','GoogleAds').replace('CustomerReferral','Referral').replace('Internal Reference','Internal');if(s!==Lcf.source)return false;}
  if(Lcf.solution&&r['Solution']!==Lcf.solution)return false;
  if(Lcf.product){const ps=(r['Hero Product']||'').split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase());if(!ps.includes(Lcf.product))return false;}
  return true;
});}
function lRenderKPIs(){
  const t=L.length,w=L.filter(r=>r['Lead Status']==='Won').length,h=L.filter(r=>r['LeadType']==='Hot').length,wa=L.filter(r=>r['LeadType']==='Warm').length,c=L.filter(r=>r['LeadType']==='Cold').length;
  const rev=L.filter(r=>r['Lead Status']==='Won').reduce((s,r)=>s+(+r['Order Value']||0),0);
  const cr=t?((w/t)*100).toFixed(1):0,q=L.filter(r=>r['Quotation Sent']==='Yes').length,nfu=L.filter(r=>!r['Follow-up 1 ']&&r['Lead Status']!=='Won').length;
  const kpis=[{l:'Total Leads',v:t,s:'All time',a:'#f0a500',b:'Live',bb:'rgba(240,165,0,0.15)',fk:'all'},{l:'Won Deals',v:w,s:'₹'+(rev/1000).toFixed(0)+'K revenue',a:'#00d4aa',b:cr+'% conv.',bb:'rgba(0,212,170,0.15)',fk:'won'},{l:'🔥 Hot Leads',v:h,s:'Win > 5',a:'#ff5c7c',b:(t?((h/t)*100).toFixed(0):0)+'%',bb:'rgba(255,92,124,0.15)',fk:'hot'},{l:'🌤 Warm Leads',v:wa,s:'Win 3-5',a:'#f0a500',b:(t?((wa/t)*100).toFixed(0):0)+'%',bb:'rgba(240,165,0,0.15)',fk:'warm'},{l:'❄️ Cold Leads',v:c,s:'Win ≤ 2',a:'#4e9af1',b:'Nurturing',bb:'rgba(78,154,241,0.15)',fk:'cold'},{l:'Quotations',v:q,s:nfu+' need FU',a:'#a78bfa',b:(t?((q/t)*100).toFixed(0):0)+'%',bb:'rgba(167,139,250,0.15)',fk:'quoted'}];
  document.getElementById('lKpiGrid').innerHTML=kpis.map(k=>{const ia=Lkpi===k.fk&&Lkpi!==null&&Lkpi!=='all';return `<div class="kpi-card ${ia?'kpi-active':''}" style="--card-accent:${k.a};--card-color:${k.a}" onclick="lKpiClick('${k.fk}')"><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div><span class="kpi-badge" style="background:${k.bb};color:${k.a}">${k.b}</span><div class="kpi-click-hint">${ia?'✕ Clear':'↗ Filter'}</div></div>`;}).join('');
}
function lKpiClick(fk){Lkpi=(Lkpi===fk&&fk!=='all')?null:fk;const m={won:'Won',hot:'Hot',warm:'Warm',cold:'Cold',quoted:'Quoted'};Ltype=Lkpi&&Lkpi!=='all'?m[Lkpi]||'':'';document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lBadge(){const b=document.getElementById('lCFBadge');const m={won:'Won Deals',hot:'🔥 Hot',warm:'🌤 Warm',cold:'❄️ Cold',quoted:'Quotations'};const ca=Object.values(Lcf).filter(Boolean);if((Lkpi&&Lkpi!=='all')||ca.length>0){b.style.display='flex';let p=[];if(Lkpi&&Lkpi!=='all')p.push('<strong style="color:var(--accent2)">'+m[Lkpi]+'</strong>');if(ca.length)p.push('<strong style="color:var(--accent)">'+ca.join(' + ')+'</strong>');b.innerHTML='🎯 Filter: '+p.join(' & ')+' <span onclick="lClearAll()" style="cursor:pointer;color:var(--hot);margin-left:8px;font-weight:600">✕ Clear All</span>';}else b.style.display='none';}
function lClearAll(){Lkpi=null;Ltype='';Lcf={leadType:null,source:null,solution:null,product:null};document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lCF(k,v){Lcf[k]=Lcf[k]===v?null:v;lBadge();lApply();Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderCharts();}
function lRenderCharts(){
  const D=lGetCF();const sc=['#f0a500','#00d4aa','#ff5c7c','#4e9af1','#a78bfa','#f97316','#10b981'];
  const {tc:lTC,gc:lGC,noGrid:lNG}=chartColors();
  const tc={Hot:0,Warm:0,Cold:0};D.forEach(r=>{if(tc[r['LeadType']]!==undefined)tc[r['LeadType']]++;});
  const tk=['Hot','Warm','Cold'];const tb=tk.map((k,i)=>Lcf.leadType&&Lcf.leadType!==k?(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.08)'):['#ff5c7c','#f0a500','#4e9af1'][i]);
  Lch.temp=new Chart(document.getElementById('lChTemp'),{type:'doughnut',data:{labels:['Hot 🔥','Warm 🌤','Cold ❄️'],datasets:[{data:[tc.Hot,tc.Warm,tc.Cold],backgroundColor:tb,borderWidth:0,hoverOffset:8}]},options:{cutout:'68%',onClick:(_,e)=>{if(e.length)lCF('leadType',tk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:lTC,padding:10,font:{family:'DM Sans',size:10}}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChTemp').style.cursor='pointer';
  const so={};D.forEach(r=>{const s=(r['Source']||'Unknown').replace('Google Ads','GoogleAds').replace('CustomerReferral','Referral').replace('Internal Reference','Internal');so[s]=(so[s]||0)+1;});
  const ss=Object.entries(so).sort((a,b)=>b[1]-a[1]);
  Lch.src=new Chart(document.getElementById('lChSrc'),{type:'bar',data:{labels:ss.map(([k])=>k),datasets:[{data:ss.map(([,v])=>v),backgroundColor:ss.map(([k],i)=>Lcf.source&&Lcf.source!==k?(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)'):sc[i%sc.length]),borderRadius:6,borderWidth:0}]},options:{indexAxis:'y',onClick:(_,e)=>{if(e.length)lCF('source',ss[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:false}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChSrc').style.cursor='pointer';
  const slc={};D.forEach(r=>{const s=r['Solution']||'Unknown';slc[s]=(slc[s]||0)+1;});const sk=Object.keys(slc);const slcol=['#00d4aa','#f0a500','#ff5c7c','#4e9af1','#a78bfa'];
  Lch.sol=new Chart(document.getElementById('lChSol'),{type:'doughnut',data:{labels:sk,datasets:[{data:Object.values(slc),backgroundColor:sk.map((k,i)=>Lcf.solution&&Lcf.solution!==k?(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)'):slcol[i%slcol.length]),borderWidth:0,hoverOffset:8}]},options:{cutout:'65%',onClick:(_,e)=>{if(e.length)lCF('solution',sk[e[0].index]);},plugins:{legend:{position:'right',labels:{color:lTC,padding:10,font:{family:'DM Sans',size:10}}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChSol').style.cursor='pointer';
  const dc={};D.forEach(r=>{let d=(r['Timestamp']||'').toString();if(d.match(/^\d{2}\/\d{2}\/\d{4}/)){const m=d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);d=m[3]+'-'+m[2]+'-'+m[1];}d=d.slice(0,10);if(d.length===10)dc[d]=(dc[d]||0)+1;});
  const ds=Object.keys(dc).sort();
  Lch.day=new Chart(document.getElementById('lChDay'),{type:'line',data:{labels:ds.map(d=>d.slice(5)),datasets:[{data:ds.map(d=>dc[d]),borderColor:'#a78bfa',backgroundColor:'rgba(167,139,250,0.1)',fill:true,tension:0.4,pointBackgroundColor:'#a78bfa',pointRadius:4,borderWidth:2}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}}},responsive:true,maintainAspectRatio:false}});
  const pc={};D.forEach(r=>{if(!r['Hero Product'])return;r['Hero Product'].split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase()).filter(Boolean).forEach(p=>{pc[p]=(pc[p]||0)+1;});});
  const ps=Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,8);
  Lch.prod=new Chart(document.getElementById('lChProd'),{type:'bar',data:{labels:ps.map(([k])=>k),datasets:[{data:ps.map(([,v])=>v),backgroundColor:ps.map(([k])=>Lcf.product&&Lcf.product!==k?(document.body.classList.contains('light-mode')?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.06)'):'#ff5c7c'),borderRadius:6,borderWidth:0}]},options:{onClick:(_,e)=>{if(e.length)lCF('product',ps[e[0].index][0]);},plugins:{legend:{display:false}},scales:{x:{ticks:{color:lTC,font:{family:'DM Sans',size:9}},grid:{display:false}},y:{ticks:{color:lTC,font:{family:'DM Sans',size:10}},grid:{display:!lNG,color:lGC}}},responsive:true,maintainAspectRatio:false}});
  document.getElementById('lChProd').style.cursor='pointer';
}
function lRenderLB(){const el=document.getElementById('lLBoard');if(!el)return;const rc={},rw={};L.forEach(r=>{const e=r['Emailaddress'];if(!e)return;rc[e]=(rc[e]||0)+1;if(r['Lead Status']==='Won')rw[e]=(rw[e]||0)+1;});const sorted=Object.entries(rc).sort((a,b)=>b[1]-a[1]);const mx=sorted[0]?.[1]||1;el.innerHTML=sorted.map(([e,cnt],i)=>`<div class="lb-row"><span class="lb-rank">${i+1}</span><div style="background:${rB(e)};color:${rC(e)};width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.70rem;font-weight:700;flex-shrink:0">${rI(e)}</div><span style="font-size:0.83rem;flex:1;color:var(--text)">${rN(e)}</span><div class="lb-bar-wrap"><div class="lb-bar" style="width:${(cnt/mx*100).toFixed(0)}%;background:${rC(e)}"></div></div><span class="lb-count" style="color:${rC(e)}">${cnt}</span>${rw[e]?'<span style="font-size:0.73rem;color:var(--won);margin-left:3px">✓'+rw[e]+'</span>':''}</div>`).join('');}
function lRenderInsights(){
  const wd=L.filter(r=>r['Lead Status']==='Won'&&r['Order Value']);const tr=wd.reduce((s,r)=>s+(+r['Order Value']||0),0);const mx=[...wd].sort((a,b)=>(+b['Order Value']||0)-(+a['Order Value']||0))[0];
  document.getElementById('lRevIns').innerHTML=`<div class="insight-row"><span>Total Revenue</span><span class="insight-val">₹${tr.toLocaleString('en-IN')}</span></div><div class="insight-row"><span>Avg Deal</span><span class="insight-val">₹${wd.length?Math.round(tr/wd.length).toLocaleString('en-IN'):0}</span></div><div class="insight-row"><span>Biggest Deal</span><span class="insight-val">₹${mx?(+mx['Order Value']).toLocaleString('en-IN'):0}</span></div><div class="insight-row"><span>Won / Total</span><span class="insight-val">${wd.length} / ${L.length}</span></div><div class="insight-row"><span>Top Winner</span><span class="insight-val">${mx?rN(mx['Emailaddress']):'—'}</span></div>`;
  const wq=L.filter(r=>r['Quotation Sent']==='Yes').length,nfu=L.filter(r=>!r['Follow-up 1 ']&&r['Lead Status']!=='Won').length,dm=L.filter(r=>r['IstheDemoGiven']==='Yes').length,hnq=L.filter(r=>r['LeadType']==='Hot'&&!r['Quotation Sent']&&r['Lead Status']!=='Won').length,ls=L.filter(r=>r['Lost']&&r['Lost']!==null).length;
  document.getElementById('lPipeIns').innerHTML=`<div class="insight-row"><span>Quotations Sent</span><span class="insight-val">${wq}</span></div><div class="insight-row"><span>Demos Given</span><span class="insight-val">${dm} (${L.length?((dm/L.length)*100).toFixed(0):0}%)</span></div><div class="insight-row"><span>Hot w/o Quote ⚠️</span><span class="insight-val" style="color:var(--hot)">${hnq}</span></div><div class="insight-row"><span>No Follow-Up</span><span class="insight-val" style="color:var(--warm)">${nfu}</span></div><div class="insight-row"><span>Lost</span><span class="insight-val" style="color:var(--lost)">${ls}</span></div>`;
  const hf=L.filter(r=>r['LeadType']==='Hot'&&!r['Follow-up 1 ']&&r['Lead Status']!=='Won').length,hw=L.filter(r=>(+r['WinChances']||0)>=8&&r['Lead Status']!=='Won'&&!r['Lost']).length,rc2=L.filter(r=>(+r['WinChances']||0)===10&&r['Lead Status']!=='Won'&&!r['Lost']).length;
  document.getElementById('lActIns').innerHTML=`<div class="insight-row"><span>🔥 Hot, no FU</span><span class="insight-val" style="color:var(--hot)">${hf}</span></div><div class="insight-row"><span>⭐ Win≥8, open</span><span class="insight-val" style="color:var(--accent)">${hw}</span></div><div class="insight-row"><span>✅ Win=10, close now!</span><span class="insight-val" style="color:var(--won)">${rc2}</span></div>`;
}
function lSetType(v,b){Ltype=v;document.querySelectorAll('#panel-leads .filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');lApply();}
function lApply(){
  const q=document.getElementById('lSearch').value.toLowerCase(),src=document.getElementById('lFSrc').value,sol=document.getElementById('lFSol').value,rep=document.getElementById('lFRep').value;
  Lf=L.filter(r=>{
    if(q&&!((r['CustomerName']||'').toLowerCase().includes(q)||String(r['ContactNumber']||'').includes(q)||(r['EmailId']||'').toLowerCase().includes(q)))return false;
    if(src&&r['Source']!==src)return false;if(sol&&r['Solution']!==sol)return false;if(rep&&r['Emailaddress']!==rep)return false;
    if(Ltype==='Won'){if(r['Lead Status']!=='Won')return false;}else if(Ltype==='Quoted'){if(r['Quotation Sent']!=='Yes')return false;}else if(Ltype&&r['LeadType']!==Ltype)return false;
    if(Lkpi&&Lkpi!=='all'){if(Lkpi==='won'&&r['Lead Status']!=='Won')return false;if(Lkpi==='hot'&&r['LeadType']!=='Hot')return false;if(Lkpi==='warm'&&r['LeadType']!=='Warm')return false;if(Lkpi==='cold'&&r['LeadType']!=='Cold')return false;if(Lkpi==='quoted'&&r['Quotation Sent']!=='Yes')return false;}
    if(Lcf.leadType&&r['LeadType']!==Lcf.leadType)return false;
    if(Lcf.source){const s=(r['Source']||'').replace('Google Ads','GoogleAds').replace('CustomerReferral','Referral').replace('Internal Reference','Internal');if(s!==Lcf.source)return false;}
    if(Lcf.solution&&r['Solution']!==Lcf.solution)return false;
    if(Lcf.product){const ps=(r['Hero Product']||'').split(/[,\/]/).map(p=>p.trim().replace(/\s+/g,'').toUpperCase());if(!ps.includes(Lcf.product))return false;}
    return true;
  });
  if(Lsk)Lf.sort((a,b)=>{let av=a[Lsk]??'',bv=b[Lsk]??'';if(!isNaN(av)&&!isNaN(bv))return(+av-+bv)*Lsd;return String(av).localeCompare(String(bv))*Lsd;});
  Lp=1;lRenderTable();
}
function lReset(){document.getElementById('lSearch').value='';document.getElementById('lFSrc').value='';document.getElementById('lFSol').value='';document.getElementById('lFRep').value='';Ltype='';Lkpi=null;Lcf={leadType:null,source:null,solution:null,product:null};document.querySelectorAll('#panel-leads .filter-btn').forEach((b,i)=>b.classList.toggle('active',i===0));Object.values(Lch).forEach(c=>c&&c.destroy&&c.destroy());Lch={};lRenderAll();lBadge();}
function lSort(k){Lsk=Lsk===k?(Lsd*=-1,k):(Lsd=1,k);lApply();}
function lRenderTable(){
  const tot=Lf.length,tp=Math.max(1,Math.ceil(tot/LPP)),pg=Lf.slice((Lp-1)*LPP,Lp*LPP);
  document.getElementById('lTblCnt').textContent=tot+' lead'+(tot!==1?'s':'');
  const tb=document.getElementById('lTblBody');
  if(!pg.length){tb.innerHTML='<tr><td colspan="12"><div class="empty-state">No leads found</div></td></tr>';return;}
  tb.innerHTML=pg.map(r=>{const wc=+r['WinChances']||0;const wcc=wc>=7?'#00d4aa':wc>=4?'#f0a500':'#4e9af1';const f1=r['Follow-up 1 ']==='Yes',f2=r['Follow-up 2 ']==='Yes',f3=r['Follow-up 3']==='Yes';const bc=r['LeadType']==='Hot'?'badge-hot':r['LeadType']==='Warm'?'badge-warm':'badge-cold';const sc2=r['Lead Status']==='Won'?'badge-won':r['Lost']?'badge-lost':'badge-open';const st=r['Lead Status']==='Won'?'✓ Won':r['Lost']?'✗ Lost':'● Open';const ov=r['Order Value']?'₹'+(+r['Order Value']).toLocaleString('en-IN'):'—';return`<tr><td><div style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis">${(r['CustomerName']||'—').slice(0,22)}</div><div style="font-size:0.78rem;color:var(--muted)">${r['Source']||''}</div></td><td style="font-size:0.83rem">${(r['Source']||'—').replace('CustomerReferral','Referral')}</td><td><span style="font-size:0.83rem;color:#a78bfa">${r['Solution']||'—'}</span></td><td style="font-size:0.80rem;color:var(--muted)">${(r['Hero Product']||'—').slice(0,18)}</td><td><div class="wc-wrap"><div class="wc-bar"><div class="wc-fill" style="width:${wc*10}%;background:${wcc}"></div></div><span style="font-size:0.82rem;font-weight:600;color:${wcc}">${wc}/10</span></div></td><td><span class="badge ${bc}">${r['LeadType']}</span></td><td><span style="font-size:0.83rem;color:${r['IstheDemoGiven']==='Yes'?'var(--won)':'var(--muted)'}">${r['IstheDemoGiven']==='Yes'?'✓ Yes':'✗ No'}</span></td><td><div class="fu-dots"><div class="fu-dot ${f1?'done':''}"></div><div class="fu-dot ${f2?'done':''}"></div><div class="fu-dot ${f3?'done':''}"></div></div></td><td><span style="font-size:0.83rem;color:${r['Quotation Sent']==='Yes'?'var(--won)':'var(--muted)'}">${r['Quotation Sent']==='Yes'?'✓ Sent':r['Quotation Sent']==='No'?'✗ No':'—'}</span></td><td><span class="badge ${sc2}">${st}</span></td><td style="font-weight:600;color:${r['Order Value']?'var(--accent)':'var(--muted)'}">${ov}</td><td><div class="rep-info"><div class="rep-dot" style="background:${rB(r['Emailaddress'])};color:${rC(r['Emailaddress'])}">${rI(r['Emailaddress'])}</div><span style="font-size:0.83rem">${rN(r['Emailaddress'])}</span></div></td></tr>`;}).join('');
  const bar=document.getElementById('lPagBar');if(tp<=1){bar.innerHTML='';return;}
  let h='<span class="page-info">Page '+Lp+' of '+tp+'</span><button class="page-btn" onclick="lGoPage('+(Lp-1)+')" '+(Lp===1?'disabled':'')+'>‹</button>';
  for(let p=1;p<=tp;p++)h+='<button class="page-btn '+(p===Lp?'active':'')+'" onclick="lGoPage('+p+')">'+p+'</button>';
  h+='<button class="page-btn" onclick="lGoPage('+(Lp+1)+')" '+(Lp===tp?'disabled':'')+'>›</button>';bar.innerHTML=h;
}
function lGoPage(p){const tp=Math.ceil(Lf.length/LPP);if(p<1||p>tp)return;Lp=p;lRenderTable();document.querySelector('#panel-leads .table-card').scrollIntoView({behavior:'smooth',block:'start'});}

