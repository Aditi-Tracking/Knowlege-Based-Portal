// Section: Customer Mapping (loadMappingDashboard, GPS-Odoo mapping)
async function loadMappingDashboard(){
  if(_mpLoaded) return;
  _mpLoaded = true;
  _mpCanEdit = PERMISSIONS.can_edit_mapping === 'true';

  // Fetch allowed regions from PERMISSIONS (Option A)
  _mpAllowedRgns = [];
  if(PERMISSIONS.mapping_region_headoffice === 'true') _mpAllowedRgns.push('HeadOffice');
  if(PERMISSIONS.mapping_region_goa        === 'true') _mpAllowedRgns.push('Goa');
  if(PERMISSIONS.mapping_region_bangalore  === 'true') _mpAllowedRgns.push('Bangalore');
  if(PERMISSIONS.mapping_region_gujarat    === 'true') _mpAllowedRgns.push('Gujarat');
  if(!_mpAllowedRgns.length) _mpAllowedRgns = ['HeadOffice','Goa','Bangalore','Gujarat'];

  // Render region buttons
  const rbDiv = document.getElementById('mp-region-btns');
  if(rbDiv){
    rbDiv.innerHTML = ['All',..._mpAllowedRgns].map(r=>
      `<button class="mp-region-btn${r==='All'?' active':''}" onclick="mpSwitchRegion('${r}')" id="mp-rgn-${r}">${r}</button>`
    ).join('');
  }
  await mpLoadData();
}

async function mpLoadData(){
  document.getElementById('mp-loading').style.display = 'block';
  document.getElementById('mp-empty').style.display   = 'none';
  document.getElementById('mp-tbody').innerHTML       = '';
  try {
    const region = _mpRegion === 'All' ? '' : _mpRegion;
    const r = await fetch(`${_MAPI}/api/mapping-data?region=${encodeURIComponent(region)}`);
    _mpData = r.ok ? await r.json() : [];
  } catch(e){ _mpData = []; }
  document.getElementById('mp-loading').style.display = 'none';
  mpUpdateProgress();
  mpRenderTable();
}

function mpSwitchRegion(region){
  _mpRegion = region;
  document.querySelectorAll('.mp-region-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById(`mp-rgn-${region}`);
  if(btn) btn.classList.add('active');
  _mpLoaded = false;
  mpLoadData();
  _mpLoaded = true;
}

function mpFilterStatus(status){
  _mpStatus = status;
  ['all','mapped','unmapped'].forEach(s=>{
    const b = document.getElementById(`mp-st-${s}`);
    if(b) b.classList.toggle('active', s===status);
  });
  mpRenderTable();
}

function mpUpdateProgress(){
  const total    = _mpData.length;
  const mapped   = _mpData.filter(r=>r.is_mapped).length;
  const unmapped = total - mapped;
  const pct      = total ? Math.round(mapped/total*100) : 0;
  const unpct    = total ? Math.round(unmapped/total*100) : 0;
  const vehicles = _mpData.filter(r=>r.is_mapped).reduce((s,r)=>s+(r.total_vehicles||0),0);

  const set = (id,val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
  set('mp-kpi-total-val',   total.toLocaleString());
  set('mp-kpi-mapped-val',  mapped.toLocaleString());
  set('mp-kpi-unmapped-val',unmapped.toLocaleString());
  set('mp-kpi-vehicles-val',vehicles.toLocaleString());
  set('mp-kpi-mapped-pct',  `${pct}% complete`);
  set('mp-kpi-unmapped-pct',`${unpct}% remaining`);

  const mb = document.getElementById('mp-kpi-mapped-bar');
  const ub = document.getElementById('mp-kpi-unmapped-bar');
  if(mb) mb.style.width = `${pct}%`;
  if(ub) ub.style.width = `${unpct}%`;

  // Active KPI highlight
  ['mp-kpi-total','mp-kpi-mapped','mp-kpi-unmapped'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.remove('active');
  });
  const activeMap = {all:'mp-kpi-total', mapped:'mp-kpi-mapped', unmapped:'mp-kpi-unmapped'};
  const activeEl  = document.getElementById(activeMap[_mpStatus]);
  if(activeEl) activeEl.classList.add('active');
}

function mpRenderTable(){
  const search = (document.getElementById('mp-search-input')?.value||'').toLowerCase();
  const odooSearch = (document.getElementById('mp-odoo-search-input')?.value||'').toLowerCase();
  _mpFiltered = _mpData.filter(r=>{
    if(_mpStatus==='mapped'   && !r.is_mapped) return false;
    if(_mpStatus==='unmapped' &&  r.is_mapped) return false;
    if(search && !r.gps_name.toLowerCase().includes(search)) return false;
    if(odooSearch && !(r.canonical_name||'').toLowerCase().includes(odooSearch)) return false;
    return true;
  }).sort((a,b)=>(b.total_vehicles||0)-(a.total_vehicles||0));

  const tbody = document.getElementById('mp-tbody');
  const empty = document.getElementById('mp-empty');
  if(!_mpFiltered.length){ tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';

  const tierClass = t => t==='Platinum'?'mp-tier-plat':t==='Gold'?'mp-tier-gold':'mp-tier-silv';

  tbody.innerHTML = _mpFiltered.map((r,i)=>{
    const tierBadge = r.tier
      ? `<span class="mp-tier-badge ${tierClass(r.tier)}">${r.tier}</span>`
      : '<span style="color:var(--muted);font-size:12px;">—</span>';

    const statusBadge = r.is_mapped
      ? `<span class="mp-mapped-badge mp-mapped-yes">✅ Mapped</span>`
      : `<span class="mp-mapped-badge mp-mapped-no">❌ Unmapped</span>`;

    const odooCell = _mpCanEdit
      ? `<div style="position:relative;" id="mp-wrap-${i}">
          <div style="display:flex;align-items:center;border:1.5px solid var(--border);border-radius:6px;background:var(--surface2);overflow:hidden;">
            <input class="mp-inline-search" type="text"
              value="${(r.canonical_name||'').replace(/"/g,'&quot;')}"
              placeholder="Search Odoo customer..."
              data-idx="${i}"
              oninput="mpInlineSearch(this,${i})"
              onclick="mpInlineClick(this,${i})"
              onblur="mpInlineBlur(this,${i})"
              autocomplete="off"
              style="flex:1;padding:5px 8px;border:none;background:transparent;color:var(--text);font-size:12px;outline:none;">
            ${r.canonical_name ? `<span onclick="mpClearMapping(${i})" title="Clear mapping" style="padding:0 8px;cursor:pointer;color:#ef4444;font-size:16px;line-height:1;flex-shrink:0;">✕</span>` : ''}
          </div>
          <div id="mp-dd-${i}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;z-index:9999;max-height:200px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.18);margin-top:2px;"></div>
        </div>`
      : `<span style="font-size:12px;color:${r.canonical_name?'var(--text)':'var(--muted)'};font-style:${r.canonical_name?'normal':'italic'};">${r.canonical_name||'Not mapped'}</span>`;

    return `<tr>
      <td style="color:var(--muted);font-size:12px;">${i+1}</td>
      <td style="font-weight:600;max-width:180px;">${r.gps_name}</td>
      <td style="font-size:12px;color:var(--muted);">${r.region||'—'}</td>
      <td>${tierBadge}</td>
      <td style="font-weight:600;color:#10b981;">${r.total_vehicles||0}</td>
      <td style="min-width:200px;">${odooCell}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');
}

async function mpInlineSearch(input, idx){
  const q  = input.value.trim();
  const dd = document.getElementById(`mp-dd-${idx}`);
  if(!dd) return;
  clearTimeout(_mpInlineTimer);
  // Show all if empty, search if has text
  _mpInlineTimer = setTimeout(async()=>{
    try {
      const searchQ = q.length > 0 ? q : ' ';
      const r    = await fetch(`${_MAPI}/api/odoo-search?q=${encodeURIComponent(searchQ)}`);
      const data = r.ok ? await r.json() : [];
      if(!data.length){ dd.style.display='none'; return; }
      dd.style.display = 'block';
      dd.innerHTML = data.map(o=>
        `<div onmousedown="mpInlineSelect(${idx},${o.id},'${o.odoo_name.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')"
          style="padding:9px 12px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border);"
          onmouseover="this.style.background='var(--surface2)'"
          onmouseout="this.style.background=''">
          ${o.odoo_name}
        </div>`
      ).join('');
    } catch(e){}
  }, 200);
}

// Click on input — show dropdown with current value or all
async function mpInlineClick(input, idx){
  const q  = input.value.trim();
  const dd = document.getElementById(`mp-dd-${idx}`);
  if(!dd) return;
  // Already open — don't refetch
  if(dd.style.display === 'block') return;
  try {
    const searchQ = q.length > 0 ? q : 'a'; // show some results
    const r    = await fetch(`${_MAPI}/api/odoo-search?q=${encodeURIComponent(searchQ)}`);
    const data = r.ok ? await r.json() : [];
    if(!data.length){ return; }
    dd.style.display = 'block';
    dd.innerHTML = data.map(o=>
      `<div onmousedown="mpInlineSelect(${idx},${o.id},'${o.odoo_name.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')"
        style="padding:9px 12px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border);"
        onmouseover="this.style.background='var(--surface2)'"
        onmouseout="this.style.background=''">
        ${o.odoo_name}
      </div>`
    ).join('');
  } catch(e){}
}

async function mpInlineSelect(idx, odooId, odooName){
  const row = _mpFiltered[idx];
  if(!row) return;
  const dd    = document.getElementById(`mp-dd-${idx}`);
  const input = document.querySelector(`.mp-inline-search[data-idx="${idx}"]`);
  if(dd)    dd.style.display = 'none';
  if(input) input.value      = odooName;

  try {
    const res = await fetch(`${_MAPI}/api/save-mapping`, {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'X-User-Email': CURRENT_USER?.email||'' },
      body: JSON.stringify({
        gps_alias_id:   row.gps_alias_id,
        gps_name:       row.gps_name,
        odoo_alias_ids: [odooId],
        canonical_name: odooName,
        tier:           row.tier||''
      })
    });
    if(res.ok){
      const di = _mpData.findIndex(r=>r.gps_alias_id===row.gps_alias_id);
      if(di>=0){ _mpData[di].is_mapped=true; _mpData[di].canonical_name=odooName; }
      const fi = _mpFiltered.findIndex(r=>r.gps_alias_id===row.gps_alias_id);
      if(fi>=0){ _mpFiltered[fi].is_mapped=true; _mpFiltered[fi].canonical_name=odooName; }
      // Update status + add clear button in DOM
      const rows = document.querySelectorAll('#mp-tbody tr');
      if(rows[idx]){
        const cells = rows[idx].querySelectorAll('td');
        if(cells[6]) cells[6].innerHTML='<span class="mp-mapped-badge mp-mapped-yes">✅ Mapped</span>';
        // Add clear button
        const wrap = document.getElementById(`mp-wrap-${idx}`);
        if(wrap){
          const existX = wrap.querySelector('.mp-clear-btn');
          if(!existX){
            const xBtn = document.createElement('span');
            xBtn.className = 'mp-clear-btn';
            xBtn.title = 'Clear mapping';
            xBtn.innerHTML = '✕';
            xBtn.style.cssText = 'padding:0 8px;cursor:pointer;color:#ef4444;font-size:16px;line-height:1;flex-shrink:0;';
            xBtn.onclick = ()=> mpClearMapping(idx);
            wrap.querySelector('div').appendChild(xBtn);
          }
        }
      }
      mpUpdateProgress();
    } else {
      alert('Save failed!');
      if(input) input.value = row.canonical_name||'';
    }
  } catch(e){
    alert('Network error: '+e.message);
    if(input) input.value = row.canonical_name||'';
  }
}

// Clear mapping for a row
async function mpClearMapping(idx){
  const row = _mpFiltered[idx];
  if(!row || !row.customer_id) return;
  if(!confirm(`Clear the mapping for "${row.gps_name}"?`)) return;

  try {
    // GPS alias se customer_id remove karo
    const res = await fetch(`${_MAPI}/api/clear-mapping`, {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'X-User-Email': CURRENT_USER?.email||'' },
      body: JSON.stringify({ gps_alias_id: row.gps_alias_id })
    });
    if(res.ok){
      const di = _mpData.findIndex(r=>r.gps_alias_id===row.gps_alias_id);
      if(di>=0){ _mpData[di].is_mapped=false; _mpData[di].canonical_name=''; _mpData[di].customer_id=null; }
      const fi = _mpFiltered.findIndex(r=>r.gps_alias_id===row.gps_alias_id);
      if(fi>=0){ _mpFiltered[fi].is_mapped=false; _mpFiltered[fi].canonical_name=''; _mpFiltered[fi].customer_id=null; }
      // Update DOM
      const input = document.querySelector(`.mp-inline-search[data-idx="${idx}"]`);
      if(input) input.value = '';
      const wrap = document.getElementById(`mp-wrap-${idx}`);
      if(wrap){ const x = wrap.querySelector('.mp-clear-btn'); if(x) x.remove(); }
      const rows = document.querySelectorAll('#mp-tbody tr');
      if(rows[idx]){
        const cells = rows[idx].querySelectorAll('td');
        if(cells[6]) cells[6].innerHTML='<span class="mp-mapped-badge mp-mapped-no">❌ Unmapped</span>';
      }
      mpUpdateProgress();
    } else {
      alert('Clear failed!');
    }
  } catch(e){ alert('Network error: '+e.message); }
}

// Blur — close dropdown only (don't reset — onmousedown on item fires before onblur)
function mpInlineBlur(input, idx){
  setTimeout(()=>{
    const dd = document.getElementById(`mp-dd-${idx}`);
    if(dd) dd.style.display='none';
  }, 250);
}

// Close dropdowns on outside click
document.addEventListener('DOMContentLoaded', function(){
  window.addEventListener('click', function(e){
    if(!e.target.classList.contains('mp-inline-search')){
      document.querySelectorAll('[id^="mp-dd-"]').forEach(d=>d.style.display='none');
    }
  });
});
// ── end Customer Mapping JS ───────────────────────────────────

