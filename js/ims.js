// Section: IMS Dashboard (loadIMSDashboard, stock KPIs, charts, table)
// ── CONFIG ────────────────────────────────────────────────────────
const IMS_API_URL = 'https://script.google.com/macros/s/AKfycbwJopykJi1HJzqsbeMaCqx0iaFQCbq-UJo0IZvqR8uDMttjYDb0enqsmNAz-2GxYsWA/exec'; // HQ

// ── Location-specific API URLs ─────────────────────────────────────
// ⚠️ REPLACE these with actual Google Apps Script URLs for each location
const IMS_GOA_API       = 'https://script.google.com/macros/s/AKfycbyJdOUvUvSDgRkFtVUlFahtABXzR-H1nrcv-Syj--wf1ehNoQIteTLuoXTZIwWBPQtByg/exec';
const IMS_GUJARAT_API   = 'https://script.google.com/macros/s/AKfycbz3m_D7OETa5BIX1JBL8wj4rZ_kVELBOzhqRpZSeSQi-gEBnCoHKCp9p4ir3TNwfFiR/exec';
const IMS_BANGALORE_API = 'https://script.google.com/macros/s/AKfycbz6NrjwVJxfivZfTlbeolSXy3Azsq0kdrHbMDgDT9UioBOQ4Gl-0Ypd--QtpvJjM3Sf_w/exec';

// ── STATE ─────────────────────────────────────────────────────────
let _imsLoaded       = false;
let _imsAllRows      = [];
let _imsDateHdrs     = [];
let _imsMaxStock     = 1;
let _imsFilter       = 'all';
let _imsDateIdx      = -1;   // -1 = latest date (default); index into _imsDateHdrs
let _imsBarChart     = null;
let _imsDonutChart   = null;
let _imsRefInterval  = null;
let _imsLocation     = 'hq'; // 'hq' | 'goa' | 'gujarat' | 'bangalore'

function _imsGetAPI() {
  if (_imsLocation === 'goa')       return IMS_GOA_API;
  if (_imsLocation === 'gujarat')   return IMS_GUJARAT_API;
  if (_imsLocation === 'bangalore') return IMS_BANGALORE_API;
  return IMS_API_URL; // HQ
}

// ── Role ──────────────────────────────────────────────────────────
function _canAccessIMS() {
  return PERMISSIONS.can_view_ims === 'true';
}

function _applyIMSNavVisibility() {
  const show = PERMISSIONS.can_view_ims === 'true';
  const el   = document.getElementById('nav-ims');
  const mmEl = document.getElementById('mm-ims');
  if (el)   el.style.display   = show ? 'flex' : 'none';
  if (mmEl) mmEl.style.display = show ? 'flex' : 'none';
}

function _imsEffDateIdx() {
  if (!_imsDateHdrs.length) return null;
  if (_imsDateIdx >= 0 && _imsDateIdx < _imsDateHdrs.length) return _imsDateIdx;
  return _imsDateHdrs.length - 1;
}

// ── Get stock value for a row based on selected date ─────────────
function _imsStock(row) {
  const di = _imsEffDateIdx();
  if (di === null) return row.closing;
  // If all date values are 0/missing, fall back to closing stock
  const v = row.dates[di];
  return (v !== undefined && v !== null) ? v : row.closing;
}

// ── Status based on selected date's stock ────────────────────────
function _imsSt(row) {
  const stock = _imsStock(row);
  if (stock === 0) return 'zero';
  if (row.maxLevel > 0 && stock <= row.maxLevel * 10) return 'low';
  return 'ok';
}

// ── Location switch ───────────────────────────────────────────────
function imsSetLocation(loc) {
  if (_imsLocation === loc) return;
  _imsLocation = loc;
  _imsLoaded   = false;
  _imsDateIdx  = -1;  // Reset date index so today is auto-selected for new location
  _imsDateHdrs = [];  // Clear old date headers
  _imsAllRows  = [];  // Clear old rows
  // Sync dropdown value
  const dd = document.querySelector('#imsControls select');
  if (dd) dd.value = loc;
  // Update breadcrumb title
  const labels = { hq:'Head Quarter', goa:'Goa', gujarat:'Gujarat', bangalore:'Bangalore' };
  const titleEl = document.querySelector('#panel-ims .db-breadcrumb');
  if (titleEl) titleEl.textContent = 'Home › IMS — ' + (labels[loc] || loc);
  loadIMSDashboard();
}

// ── Refresh ───────────────────────────────────────────────────────
function imsRefresh() { _imsLoaded = false; loadIMSDashboard(); }

// ── Load ──────────────────────────────────────────────────────────
async function loadIMSDashboard() {
  if (_imsLoaded) return;
  if (!_canAccessIMS()) { switchDB('home'); return; }
  // Validate all location APIs
  const _apiCheck = _imsGetAPI();
  if (!_apiCheck || _apiCheck.includes('PASTE_')) {
    const _locNames = { hq: 'HQ', goa: 'Goa', gujarat: 'Gujarat', bangalore: 'Bangalore' };
    _imsShowError(`IMS ${_locNames[_imsLocation] || _imsLocation} API URL is not configured. Please add the Google Apps Script URL in the HTML file.`);
    document.getElementById('imsLoader').style.display = 'none';
    return;
  }
  _imsShowLoader();
  const ico = document.getElementById('imsRefIco');
  if (ico) ico.style.animation = 'spin 0.8s linear infinite';
  try {
    const apiUrl = _imsGetAPI();
    const res  = await fetch(apiUrl);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');
    _imsParseData(json);
    _imsLoaded = true;
    document.getElementById('imsLastSync').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('imsError').style.display = 'none';
    if (_imsRefInterval) clearInterval(_imsRefInterval);
    _imsRefInterval = setInterval(() => { _imsLoaded = false; loadIMSDashboard(); }, 5 * 60 * 1000);
  } catch(e) {
    _imsShowError(e.message);
    document.getElementById('imsLoader').style.display = 'none';
  } finally {
    if (ico) ico.style.animation = '';
  }
}

// ── Parse ─────────────────────────────────────────────────────────
function _imsParseData(json) {
  const headers = json.headers || [];
  const rows    = json.data    || [];

  _imsDateHdrs = headers.slice(5).filter(h => h && String(h).trim());

  _imsAllRows = rows
    .filter(r => r[headers[0]] || r[headers[1]])
    .map(r => ({
      skuCode:   _s(r[headers[0]]),
      itemName:  _s(r[headers[1]]),
      maxLevel:  _n(r[headers[2]]),
      inTransit: _n(r[headers[3]]),
      closing:   _n(r[headers[4]]),
      dates:     _imsDateHdrs.map(h => _n(r[h]))
    }));

  // Auto-select today's date, or closest past date, or latest
  _imsDateIdx = _imsFindTodayIdx();

  _imsRecalcMax();
  _imsBuildDateFilter();
  _imsRenderKPIs();
  _imsRenderTable();

  // Show containers FIRST so Canvas gets correct width before Chart.js renders
  document.getElementById('imsLoader').style.display    = 'none';
  document.getElementById('imsKpiGrid').style.display   = 'grid';
  document.getElementById('imsChartsRow').style.display = 'grid';
  document.getElementById('imsControls').style.display  = 'flex';
  document.getElementById('imsTableCard').style.display = 'block';

  // Render charts AFTER containers are visible so canvas dimensions are correct
  requestAnimationFrame(() => _imsRenderCharts());
}

function _s(v) { return v !== null && v !== undefined ? String(v) : ''; }
function _n(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ── Date formatter — any format → DD/MM/YYYY ──────────────────────
function _imsFmtDate(raw) {
  if (!raw) return '—';
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const dd   = String(dt.getDate()).padStart(2, '0');
    const mm   = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

// ── Parse any date string (handles dd/MM/yyyy AND ISO formats) ────
function _imsParseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // dd/MM/yyyy or d/M/yyyy (06/05/2026 or 6/5/2026) — Indian format used by branch sheets
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm) {
    const d = parseInt(ddmm[1]), m = parseInt(ddmm[2]), y = parseInt(ddmm[3]);
    // Validate: day 1-31, month 1-12
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // yyyy-MM-dd (ISO date: 2026-05-06)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const dt = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    if (!isNaN(dt.getTime())) return dt;
  }

  // dd-MM-yyyy (06-05-2026)
  const ddmmDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmDash) {
    const d = parseInt(ddmmDash[1]), m = parseInt(ddmmDash[2]), y = parseInt(ddmmDash[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // Excel serial number (e.g. 46747)
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s);
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    if (!isNaN(dt.getTime())) return dt;
  }

  // Fallback: JS native parse (handles "May 6, 2026", RFC2822, etc.)
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Find index of today's date (or closest past date, else latest) ─
function _imsFindTodayIdx() {
  if (!_imsDateHdrs.length) return -1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse all header dates — supports dd/MM/yyyy + ISO (all locations)
  const parsed = _imsDateHdrs.map((h, i) => {
    const dt = _imsParseDate(h);
    if (dt) dt.setHours(0, 0, 0, 0);
    return { i, dt };
  });

  // Exact match for today
  const exact = parsed.find(p => p.dt && p.dt.getTime() === today.getTime());
  if (exact) return exact.i;

  // Closest past date (most recent date <= today)
  const past = parsed.filter(p => p.dt && p.dt <= today);
  if (past.length) return past[past.length - 1].i;

  // Fallback: latest available
  return _imsDateHdrs.length - 1;
}

// ── Recalculate max stock for progress bars ───────────────────────
function _imsRecalcMax() {
  _imsMaxStock = Math.max(1, ..._imsAllRows.map(r => _imsStock(r)));
}

// ── Build date filter dropdown ────────────────────────────────────
function _imsBuildDateFilter() {
  const wrap = document.getElementById('imsDateFilterWrap');
  if (!wrap || !_imsDateHdrs.length) return;

  // Ensure today is auto-selected for all locations (HQ, Goa, Gujarat, Bangalore)
  if (_imsDateIdx < 0) _imsDateIdx = _imsFindTodayIdx();
  const todayIdx = _imsFindTodayIdx();

  let opts = '';
  _imsDateHdrs.forEach((d, i) => {
    const isSelected = (i === _imsDateIdx) ? 'selected' : '';
    const isToday    = (i === todayIdx);
    const label      = _imsFmtDate(d) + (isToday ? ' ★' : '');
    opts += '<option value="' + i + '" ' + isSelected + '>' + label + '</option>';
  });

  wrap.innerHTML =
    '<select id="imsDateSelect" onchange="imsOnDateChange(this.value)"' +
    ' style="padding:7px 12px;background:var(--surface2);border:1px solid var(--border);' +
    'border-radius:8px;color:var(--text);font-size:0.82rem;font-family:\'DM Sans\',sans-serif;' +
    'outline:none;cursor:pointer;min-width:140px;transition:border-color 0.18s;"' +
    ' onfocus="this.style.borderColor=\'rgba(240,165,0,0.5)\'"' +
    ' onblur="this.style.borderColor=\'var(--border)\'">' +
    opts +
    '</select>' +
    '<span style="font-size:0.73rem;color:var(--muted);">Date</span>';
}

// ── On date change ────────────────────────────────────────────────
function imsOnDateChange(val) {
  _imsDateIdx = parseInt(val);
  _imsRecalcMax();
  _imsRenderAll();
}

// ── Render everything ─────────────────────────────────────────────
function _imsRenderAll() {
  _imsRenderKPIs();
  _imsRenderCharts();
  _imsRenderTable();
}

// ── KPI Cards ─────────────────────────────────────────────────────
function _imsRenderKPIs() {
  const total  = _imsAllRows.length;
  const zero   = _imsAllRows.filter(r => _imsSt(r) === 'zero').length;
  const low    = _imsAllRows.filter(r => _imsSt(r) === 'low').length;
  const ok     = _imsAllRows.filter(r => _imsSt(r) === 'ok').length;
  const totQty = _imsAllRows.reduce((s, r) => s + _imsStock(r), 0);
  const di     = _imsEffDateIdx();
  const dateLbl = di !== null ? _imsFmtDate(_imsDateHdrs[di]) : '—';

  const kpis = [
    { lbl:'Total SKUs',     val:total,                         sub:'All inventory items',              c:'#4e9af1', ico:'📦', filter:'all'  },
    { lbl:'Zero Stock',     val:zero,                          sub:Math.round(zero/total*100)+'% items',c:'#ff5c7c', ico:'🚨', filter:'zero' },
    { lbl:'Low Stock',      val:low,                           sub:'Below threshold',                   c:'#f0a500', ico:'⚠️', filter:'low'  },
    { lbl:'Healthy Stock',  val:ok,                            sub:Math.round(ok/total*100)+'% items',  c:'#00d4aa', ico:'✅', filter:'ok'   },
    { lbl:'Total Stock',    val:totQty.toLocaleString('en-IN'),sub:'Units on ' + dateLbl,               c:'#a78bfa', ico:'🏭', filter:'all'  },
  ];
  document.getElementById('imsKpiGrid').innerHTML = kpis.map((k, idx) => `
    <div class="ims-kpi" style="--ik:${k.c};cursor:pointer;transition:transform 0.18s,box-shadow 0.18s;"
      onclick="imsKpiClick('${k.filter}', this)"
      onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div class="ims-kpi-label">${k.lbl}</div>
      <div class="ims-kpi-val">${k.val}</div>
      <div class="ims-kpi-sub">${k.sub}</div>
      <div class="ims-kpi-ico">${k.ico}</div>
    </div>`).join('');
}

// ── Charts ────────────────────────────────────────────────────────
function _imsRenderCharts() {
  const isLight = document.body.classList.contains('light-mode');
  const tickClr  = isLight ? '#5a6070' : '#8b93b0';
  const gridClr  = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
  const legendClr= isLight ? '#4a5060' : '#8b93b0';

  const sorted = [..._imsAllRows]
    .sort((a, b) => _imsStock(b) - _imsStock(a))
    .slice(0, 15);

  const labels = sorted.map(r => r.itemName.length > 18 ? r.itemName.slice(0,16)+'…' : r.itemName);
  const data   = sorted.map(r => _imsStock(r));
  const colors = sorted.map(r => {
    const s = _imsSt(r);
    return s==='zero' ? 'rgba(255,92,124,0.78)' : s==='low' ? 'rgba(240,165,0,0.78)' : 'rgba(0,212,170,0.68)';
  });

  const di     = _imsEffDateIdx();
  const dateLbl = di !== null ? _imsFmtDate(_imsDateHdrs[di]) : 'Closing Stock';

  if (_imsBarChart) _imsBarChart.destroy();
  const barCtx = document.getElementById('imsBarChart');
  if (barCtx) {
    // Update chart title
    const titleEl = barCtx.closest('.ims-chart-card')?.querySelector('.ims-chart-title');
    if (titleEl) titleEl.innerHTML = `<span class="dot"></span> Stock by Item — <span style="color:var(--accent);font-size:0.82rem;">${dateLbl}</span>`;

    _imsBarChart = new Chart(barCtx, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ' '+ctx.raw+' units' } } },
        scales:{
          x:{ grid:{color:gridClr}, ticks:{color:tickClr} },
          y:{ grid:{display:false}, ticks:{color:tickClr, font:{size:11}} }
        }
      }
    });
  }

  const zeroC = _imsAllRows.filter(r => _imsSt(r)==='zero').length;
  const lowC  = _imsAllRows.filter(r => _imsSt(r)==='low').length;
  const okC   = _imsAllRows.filter(r => _imsSt(r)==='ok').length;

  if (_imsDonutChart) _imsDonutChart.destroy();
  const donutCtx = document.getElementById('imsDonut');
  if (donutCtx) {
    _imsDonutChart = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Zero Stock','Low Stock','Healthy'],
        datasets: [{ data:[zeroC,lowC,okC], backgroundColor:['rgba(255,92,124,0.8)','rgba(240,165,0,0.8)','rgba(0,212,170,0.8)'], borderWidth:0, hoverOffset:6 }]
      },
      options: {
        responsive:true, maintainAspectRatio:false, cutout:'68%',
        plugins:{
          legend:{ position:'bottom', labels:{color:legendClr, padding:12, font:{size:11}} },
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw}` } }
        }
      }
    });
  }
}

// ── Table ─────────────────────────────────────────────────────────
function _imsRenderTable() {
  const di       = _imsEffDateIdx();
  const dateLbl  = di !== null ? _imsFmtDate(_imsDateHdrs[di]) : '—';

  // Build header — selected date column highlighted
  document.getElementById('imsTHead').innerHTML = `<tr>
    <th>Item Name</th><th>SKU Code</th>
    <th class="r" style="color:var(--accent);">📅 ${dateLbl} (Stock)</th>
    <th>Status</th>
  </tr>`;
  imsApplyFilter();
}

function imsApplyFilter() {
  const q = (document.getElementById('imsSearch')?.value || '').toLowerCase().trim();
  let rows = _imsAllRows;
  if (_imsFilter !== 'all') rows = rows.filter(r => _imsSt(r) === _imsFilter);
  if (q) rows = rows.filter(r => r.itemName.toLowerCase().includes(q) || r.skuCode.toLowerCase().includes(q));

  document.getElementById('imsTableCount').textContent = rows.length + ' / ' + _imsAllRows.length + ' items';

  if (!rows.length) {
    document.getElementById('imsTBody').innerHTML = `<tr><td colspan="4" class="ims-no-rows">No items found</td></tr>`;
    return;
  }

  document.getElementById('imsTBody').innerHTML = rows.map((r, i) => {
    const stock  = _imsStock(r);
    const st     = _imsSt(r);
    const rowCls = st==='zero' ? 'ims-zero' : st==='low' ? 'ims-low' : '';
    const pct    = Math.round(Math.min(stock / _imsMaxStock, 1) * 100);
    const fill   = st==='zero' ? '#ff5c7c' : st==='low' ? '#f0a500' : '#00d4aa';
    const badge  = st==='zero' ? '<span class="ibadge ibadge-z">Zero</span>'
                 : st==='low'  ? '<span class="ibadge ibadge-l">Low</span>'
                 :                '<span class="ibadge ibadge-ok">OK</span>';

    return `<tr class="${rowCls}">
      <td><div class="ims-name">${r.itemName||'—'}</div></td>
      <td><span class="ims-sku">${r.skuCode}</span></td>
      <td class="r">
        <div class="sbar-wrap">
          <div class="sbar"><div class="sbar-fill" style="width:${pct}%;background:${fill}"></div></div>
          <span style="color:${fill};font-weight:700">${stock}</span>
        </div>
      </td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

function imsSetFilter(el, f) {
  document.querySelectorAll('.ims-fbtn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _imsFilter = f;
  imsApplyFilter();
}

function imsKpiClick(filter, kpiEl) {
  // Highlight active KPI card
  document.querySelectorAll('#imsKpiGrid .ims-kpi').forEach(k => {
    k.style.outline = '';
    k.style.boxShadow = '';
  });
  if (filter !== 'all' || kpiEl.querySelector('.ims-kpi-label').textContent === 'Total SKUs') {
    kpiEl.style.outline = '2px solid var(--ik, var(--accent))';
    kpiEl.style.boxShadow = '0 0 0 4px rgba(var(--ik, 78,154,241), 0.15)';
  }
  // Sync filter buttons
  document.querySelectorAll('.ims-fbtn').forEach(b => b.classList.remove('active'));
  const matchBtn = [...document.querySelectorAll('.ims-fbtn')].find(b => b.getAttribute('onclick')?.includes(`'${filter}'`));
  if (matchBtn) matchBtn.classList.add('active');
  // Apply filter to table
  _imsFilter = filter;
  imsApplyFilter();
  // Re-render charts filtered to same subset
  _imsRenderChartsFiltered(filter);
}

function _imsRenderChartsFiltered(filter) {
  const isLight   = document.body.classList.contains('light-mode');
  const tickClr   = isLight ? '#5a6070' : '#8b93b0';
  const gridClr   = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
  const legendClr = isLight ? '#4a5060' : '#8b93b0';

  const subset = filter === 'all' ? _imsAllRows : _imsAllRows.filter(r => _imsSt(r) === filter);
  const sorted = [...subset].sort((a, b) => _imsStock(b) - _imsStock(a)).slice(0, 15);

  const labels = sorted.map(r => r.itemName.length > 18 ? r.itemName.slice(0,16)+'…' : r.itemName);
  const data   = sorted.map(r => _imsStock(r));
  const colors = sorted.map(r => {
    const s = _imsSt(r);
    return s==='zero' ? 'rgba(255,92,124,0.78)' : s==='low' ? 'rgba(240,165,0,0.78)' : 'rgba(0,212,170,0.68)';
  });

  const di = _imsEffDateIdx();
  const dateLbl = di !== null ? _imsFmtDate(_imsDateHdrs[di]) : 'Closing Stock';

  if (_imsBarChart) _imsBarChart.destroy();
  const barCtx = document.getElementById('imsBarChart');
  if (barCtx) {
    const titleEl = barCtx.closest('.ims-chart-card')?.querySelector('.ims-chart-title');
    if (titleEl) titleEl.innerHTML = `<span class="dot"></span> Stock by Item — <span style="color:var(--accent);font-size:0.82rem;">${dateLbl}</span>`;
    _imsBarChart = new Chart(barCtx, {
      type:'bar',
      data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:4, borderSkipped:false }] },
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ' '+ctx.raw+' units' } } },
        scales:{
          x:{ grid:{color:gridClr}, ticks:{color:tickClr} },
          y:{ grid:{display:false}, ticks:{color:tickClr, font:{size:11}} }
        }
      }
    });
  }

  const zeroC = subset.filter(r => _imsSt(r)==='zero').length;
  const lowC  = subset.filter(r => _imsSt(r)==='low').length;
  const okC   = subset.filter(r => _imsSt(r)==='ok').length;

  if (_imsDonutChart) _imsDonutChart.destroy();
  const donutCtx = document.getElementById('imsDonut');
  if (donutCtx) {
    _imsDonutChart = new Chart(donutCtx, {
      type:'doughnut',
      data:{
        labels:['Zero Stock','Low Stock','Healthy'],
        datasets:[{ data:[zeroC,lowC,okC], backgroundColor:['rgba(255,92,124,0.8)','rgba(240,165,0,0.8)','rgba(0,212,170,0.8)'], borderWidth:0, hoverOffset:6 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'68%',
        plugins:{
          legend:{ position:'bottom', labels:{color:legendClr, padding:12, font:{size:11}} },
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw}` } }
        }
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function _imsShowLoader() {
  document.getElementById('imsLoader').style.display    = 'flex';
  document.getElementById('imsKpiGrid').style.display   = 'none';
  document.getElementById('imsChartsRow').style.display = 'none';
  document.getElementById('imsControls').style.display  = 'none';
  document.getElementById('imsTableCard').style.display = 'none';
  document.getElementById('imsError').style.display     = 'none';
}
function _imsShowError(msg) {
  document.getElementById('imsError').style.display = 'block';
  document.getElementById('imsErrMsg').textContent  = msg;
}

