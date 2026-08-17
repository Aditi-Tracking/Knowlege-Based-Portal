// Section: Field Service Dashboard — read-only analytics on top of Field Service data
// Tables/views read: field_service_daily_stats (security_invoker view, pre-aggregated,
// RLS-scoped automatically), field_service_entries + field_service_photos (RLS-scoped:
// own rows only, or all rows if field_service_view_all).
// Access control: same gate as Field Service itself — _fsHasAccess() (field_service_create
// OR field_service_view_all), reused from js/fieldservice.js. field_service_view_all alone
// controls UI-only decisions here (engineer column/filter/chart), exactly like _fsCanViewAll()
// is used elsewhere — RLS is what actually restricts rows, never a client-side engineer_id filter.
// This file depends on globals defined in js/fieldservice.js (JOB_TYPE_CONFIG, _fsHasAccess,
// _fsCanViewAll, _fsPublicPhotoUrl, _fsEsc, _fsEngineerOptions, _fsFetchEngineerOptions,
// _fsEngineerName) — loaded before this file in index.html, do not duplicate them here.

const FSD_PAGE_SIZE = 25;
const FSD_CHART_PALETTE = ['#00d4aa','#3b82f6','#f0a500','#a78bfa','#10b981','#ff5c7c','#f5a623','#6366f1','#ec4899','#14b8a6'];

let _fsdInited       = false;
let _fsdCharts       = {};
let _fsdPage         = 0;
let _fsdTotalCount   = 0;
let _fsdExpandedId   = null;
let _fsdLastRows     = [];   // last-fetched entries page — row-expand toggles re-render from
let _fsdLastViewAll  = false; // this cache instead of re-fetching over the network

// ═══════════════════════════════════════════════════════════════════════
// ENTRY POINT — called from js/fieldservice.js's _fsSwitchTabView('dashboard').
// Dashboard is a tab inside the Field Service panel, not a separate nav item —
// _fsHasAccess() is already enforced by loadFieldService() before any tab
// (including this one) can be reached, so no separate access gate is needed here.
// ═══════════════════════════════════════════════════════════════════════
async function loadFieldServiceDashboard(){
  if (!_fsdInited) {
    _fsdInited = true;
    await _fsdRenderFilters();
  }
  _fsdLoadAll();
}

async function _fsdLoadAll(){
  await Promise.all([_fsdLoadSummary(), _fsdLoadEntries()]);
}

// ═══════════════════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════════════════
async function _fsdRenderFilters(){
  const bar = document.getElementById('fsdInlineFilters');
  if (!bar) return;
  const viewAll = _fsCanViewAll();
  bar.innerHTML = `
    <input class="filter-input" id="fsdFrom" type="date" onchange="_fsdOnFilterChange()" title="From date">
    <input class="filter-input" id="fsdTo" type="date" onchange="_fsdOnFilterChange()" title="To date">
    <select class="filter-select" id="fsdJobType" onchange="_fsdOnFilterChange()">
      <option value="">All Job Types</option>
      ${Object.entries(JOB_TYPE_CONFIG).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}
    </select>
    ${viewAll ? `
    <select class="filter-select" id="fsdEngineer" onchange="_fsdOnFilterChange()">
      <option value="">All Engineers</option>
    </select>` : ''}
    <button class="filter-btn" onclick="_fsdClearFilters()">Clear</button>
  `;
  if (viewAll) await _fsdPopulateEngineerFilter();
}

async function _fsdPopulateEngineerFilter(){
  if (_fsEngineerOptions === null) await _fsFetchEngineerOptions();
  const sel = document.getElementById('fsdEngineer');
  if (sel && _fsEngineerOptions) {
    sel.innerHTML = '<option value="">All Engineers</option>' +
      _fsEngineerOptions.map(en => `<option value="${en.engineer_id}">${_fsEsc(en.name)}</option>`).join('');
  }
}

function _fsdOnFilterChange(){
  _fsdPage = 0;
  _fsdLoadAll();
}

function _fsdClearFilters(){
  const f = document.getElementById('fsdFrom');     if (f) f.value = '';
  const t = document.getElementById('fsdTo');       if (t) t.value = '';
  const j = document.getElementById('fsdJobType');  if (j) j.value = '';
  const e = document.getElementById('fsdEngineer'); if (e) e.value = '';
  _fsdOnFilterChange();
}

function _fsdActiveFilters(){
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  return {
    from:     val('fsdFrom'),
    to:       val('fsdTo'),
    jobType:  val('fsdJobType'),
    engineer: val('fsdEngineer'),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY CHARTS — from field_service_daily_stats (pre-aggregated, RLS-scoped)
// ═══════════════════════════════════════════════════════════════════════
async function _fsdLoadSummary(){
  try {
    const f = _fsdActiveFilters();
    let url = `${SUPABASE_URL}/rest/v1/field_service_daily_stats?select=*`;
    if (f.from)    url += `&entry_date=gte.${f.from}`;
    if (f.to)      url += `&entry_date=lte.${f.to}`;
    if (f.jobType) url += `&job_type=eq.${encodeURIComponent(f.jobType)}`;
    if (_fsCanViewAll() && f.engineer) url += `&engineer_id=eq.${encodeURIComponent(f.engineer)}`;

    const [res, kpiComparisons] = await Promise.all([
      fetch(url, { headers: SB_HDRS() }),
      _fsdLoadKpiComparisons(f),
    ]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();

    _fsdRenderKpis(rows, kpiComparisons);
    _fsdRenderCharts(rows);
  } catch (e) {
    console.error('[FieldServiceDash] Summary load failed:', e);
  }
}

// This Week/Month vs Last Week/Month tiles are independent of the trend
// chart's own date-range filter — otherwise narrowing the chart's range
// would silently change what "this week"/"this month" means. Job type /
// engineer filters still apply, since those narrow *what* is being
// compared, not *when*. "Last month" always means the full previous
// calendar month (1st through its last day), so the query's lookback is
// computed from that boundary rather than a fixed day count — a fixed
// 60-day window doesn't align with actual month boundaries and was the
// source of the "vs 0 last month" bug (see _fsdMonthBounds/_fsdSumWindows).
async function _fsdLoadKpiComparisons(f){
  try {
    const { lastMonthStart } = _fsdMonthBounds();
    let url = `${SUPABASE_URL}/rest/v1/field_service_daily_stats?select=entry_date,entry_count`;
    url += `&entry_date=gte.${_fsdDateStr(lastMonthStart)}`;
    if (f.jobType) url += `&job_type=eq.${encodeURIComponent(f.jobType)}`;
    if (_fsCanViewAll() && f.engineer) url += `&engineer_id=eq.${encodeURIComponent(f.engineer)}`;
    const res = await fetch(url, { headers: SB_HDRS() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    return _fsdSumWindows(rows);
  } catch (e) {
    console.error('[FieldServiceDash] KPI comparison load failed:', e);
    return null;
  }
}

// Local calendar date -> 'YYYY-MM-DD', using local getters (getFullYear/
// getMonth/getDate), NOT toISOString(). toISOString() first converts to UTC,
// which silently shifts the date by a day in either direction depending on
// the browser's timezone offset — exactly the bug that caused "vs 0 last
// month": entry_date comes back from PostgREST as a plain 'YYYY-MM-DD'
// string (no time component), and `new Date('2026-07-31')` parses THAT as
// UTC midnight per the ECMAScript date-only-string spec. For any user in a
// positive-UTC-offset timezone (e.g. IST, UTC+5:30 — the likely case here),
// UTC-midnight-of-day-D is *later* in absolute time than *local*-midnight-of-
// day-D, so a boundary check like `t <= localMidnight(lastDayOfMonth)` was
// false for that day's own entries — silently dropping the last day of
// "last month" (and, by the same mechanism, today's entries from "this
// month"). Comparing plain date strings instead (both sides always mean the
// same local calendar day) removes the entire class of bug.
function _fsdDateStr(d){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Calendar-month boundaries (local time) — lastMonthStart..lastMonthEnd is
// always the FULL previous month regardless of what day of the month today is.
function _fsdMonthBounds(){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    thisMonthStart: new Date(y, m, 1),
    lastMonthStart: new Date(y, m - 1, 1),
    lastMonthEnd:   new Date(y, m, 0), // day 0 of this month = last day of previous month
  };
}

function _fsdSumWindows(rows){
  // Plain string comparison — entry_date is already 'YYYY-MM-DD', and that
  // format sorts identically to date order, so no Date-object/epoch/timezone
  // conversion is involved at all (see _fsdDateStr comment above).
  const sumBetween = (startStr, endStr) => rows
    .filter(r => r.entry_date >= startStr && r.entry_date <= endStr)
    .reduce((sum, r) => sum + Number(r.entry_count || 0), 0);

  const now = new Date();
  const todayStr = _fsdDateStr(now);
  const weekAgo     = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const twoWeeksAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
  const oneWeekAgoEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const { thisMonthStart, lastMonthStart, lastMonthEnd } = _fsdMonthBounds();

  return {
    today:     sumBetween(todayStr, todayStr),
    thisWeek:  sumBetween(_fsdDateStr(weekAgo), todayStr),
    lastWeek:  sumBetween(_fsdDateStr(twoWeeksAgo), _fsdDateStr(oneWeekAgoEnd)),
    thisMonth: sumBetween(_fsdDateStr(thisMonthStart), todayStr),
    lastMonth: sumBetween(_fsdDateStr(lastMonthStart), _fsdDateStr(lastMonthEnd)),
  };
}

function _fsdRenderKpis(rows, kpiComparisons){
  const grid = document.getElementById('fsdKpiGrid');
  if (!grid) return;
  const kc = kpiComparisons || { today: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 };
  const pctChange = (cur, prev) => prev === 0
    ? (cur > 0 ? '+100%' : '—')
    : `${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}%`;

  // Highest single-day count within the selected range — daily_stats rows are
  // grouped by (engineer_id, job_type, entry_date), so multiple rows can share
  // a date; group by date first to get each day's real total before taking the max.
  const byDate = _fsdGroupSum(rows, 'entry_date');
  let maxDay = null, maxCount = 0;
  byDate.forEach((count, date) => { if (count > maxCount) { maxCount = count; maxDay = date; } });

  // Same UTC-vs-local pitfall as _fsdDateStr() applies to display, not just
  // comparison — `new Date('2026-07-31').toLocaleDateString()` can show the
  // wrong day depending on the browser's timezone offset, so parse the
  // 'YYYY-MM-DD' string into local date parts explicitly instead.
  const maxDayLabel = (() => {
    if (!maxDay) return 'No data';
    const [y, mo, da] = maxDay.split('-').map(Number);
    return new Date(y, mo - 1, da).toLocaleDateString();
  })();

  const tiles = [
    { label: 'Jobs Done Today', value: kc.today },
    { label: 'This Week',  value: kc.thisWeek,  sub: `vs ${kc.lastWeek} last week (${pctChange(kc.thisWeek, kc.lastWeek)})` },
    { label: 'This Month', value: kc.thisMonth, sub: `vs ${kc.lastMonth} last month (${pctChange(kc.thisMonth, kc.lastMonth)})` },
    { label: 'Highest Jobs Done in a Day', value: maxCount, sub: maxDayLabel },
  ];
  grid.style.gridTemplateColumns = `repeat(${tiles.length},1fr)`;
  grid.innerHTML = tiles.map(t => `
    <div class="kpi-card">
      <div class="kpi-label">${t.label}</div>
      <div class="kpi-value">${t.value}</div>
      ${t.sub ? `<div class="kpi-sub">${t.sub}</div>` : ''}
    </div>
  `).join('');
}

function _fsdGroupSum(rows, key){
  const map = new Map();
  rows.forEach(r => map.set(r[key], (map.get(r[key]) || 0) + Number(r.entry_count || 0)));
  return map;
}

function _fsdRenderCharts(rows){
  const { tc } = chartColors();
  const font = { family: 'DM Sans', size: 10 };

  // Trend
  const byDate = _fsdGroupSum(rows, 'entry_date');
  const dates = [...byDate.keys()].sort();
  const trendValues = dates.map(d => byDate.get(d));
  const trendMax = Math.max(0, ...trendValues);
  const trendCanvas = document.getElementById('fsdChartTrend');
  if (_fsdCharts.trend) { _fsdCharts.trend.destroy(); _fsdCharts.trend = null; }
  if (trendCanvas) {
    _fsdCharts.trend = new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'Jobs Done', data: trendValues,
          borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.12)', fill: true, tension: 0.3,
        }],
      },
      // chartjs-plugin-datalabels is loaded via CDN (index.html) but never globally
      // registered anywhere in this codebase (confirmed: no Chart.register() call
      // exists in the repo) — every other chart's `datalabels:{display:false}` option
      // elsewhere has always been a no-op because of this. Registering it globally
      // would silently turn on default labels for every OTHER chart in the app
      // (Renewals, SmartFleet, IMS, CRM, etc.) that never guarded against it, so
      // instead attach it locally to just this chart instance via Chart.js's
      // per-chart `plugins` array — no global side effects.
      plugins: [ChartDataLabels],
      options: {
        // layout.padding.top reserves canvas-level space above the plot area so a
        // label sitting above the highest point isn't clipped by the canvas edge
        // itself; suggestedMax adds scale headroom so the highest point isn't
        // drawn flush against the top gridline in the first place. Both are
        // needed — one fixes the canvas boundary, the other fixes the data range.
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            align: 'top', anchor: 'end', color: tc,
            font: { family: 'DM Sans', size: 8 }, backgroundColor: null, padding: 2,
          },
        },
        scales: {
          x: { ticks: { color: tc, font, autoSkip: true, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: tc, font }, grid: { display: false }, beginAtZero: true, suggestedMax: trendMax > 0 ? Math.ceil(trendMax * 1.15) : undefined },
        },
        responsive: true, maintainAspectRatio: false,
      },
    });
  }

  // By job type — sorted descending by count (display order only; does not
  // touch JOB_TYPE_CONFIG itself). Legend on the right, stacked vertically,
  // just "Label (count)" now — percentage moved onto the slices themselves
  // via datalabels (display:'auto' hides labels that would overlap/not fit,
  // e.g. on very thin slices).
  const byJob = _fsdGroupSum(rows, 'job_type');
  const jobKeysSorted = [...byJob.keys()].sort((a, b) => byJob.get(b) - byJob.get(a));
  const jobTotal = jobKeysSorted.reduce((s, k) => s + byJob.get(k), 0) || 1;
  const jobLabels = jobKeysSorted.map(k => {
    const label = (JOB_TYPE_CONFIG[k] && JOB_TYPE_CONFIG[k].label) || k;
    return `${label} (${byJob.get(k)})`;
  });
  const jobCanvas = document.getElementById('fsdChartJobType');
  if (_fsdCharts.jobType) { _fsdCharts.jobType.destroy(); _fsdCharts.jobType = null; }
  if (jobCanvas) {
    _fsdCharts.jobType = new Chart(jobCanvas, {
      type: 'doughnut',
      data: {
        labels: jobLabels,
        datasets: [{
          data: jobKeysSorted.map(k => byJob.get(k)),
          backgroundColor: FSD_CHART_PALETTE.slice(0, jobKeysSorted.length),
          borderWidth: 0, hoverOffset: 8,
        }],
      },
      plugins: [ChartDataLabels], // now needed — percentages render on-slice (see below)
      options: {
        plugins: {
          legend: { position: 'right', align: 'center', labels: { color: tc, font: { family: 'DM Sans', size: 11 }, boxWidth: 12, padding: 8 } },
          datalabels: {
            display: 'auto', // auto-hides on slices too thin to fit the label without overlap
            color: '#fff',
            font: { family: 'DM Sans', size: 10, weight: '700' },
            formatter: (value) => `${Math.round((value / jobTotal) * 100)}%`,
          },
        },
        responsive: true, maintainAspectRatio: false,
      },
    });
  }

  // By engineer — view_all only, UI decision same as _fsCanViewAll() elsewhere.
  // Standard vertical bar (engineer names on x-axis, count on y-axis).
  const engCard = document.getElementById('fsdEngineerChartCard');
  if (_fsCanViewAll()) {
    if (engCard) engCard.style.display = 'block';
    const byEng = _fsdGroupSum(rows, 'engineer_id');
    const engIds = [...byEng.keys()].sort((a, b) => byEng.get(b) - byEng.get(a)).slice(0, 10);
    const engValues = engIds.map(id => byEng.get(id));
    const engMax = Math.max(0, ...engValues);
    const engCanvas = document.getElementById('fsdChartEngineers');
    if (_fsdCharts.engineers) { _fsdCharts.engineers.destroy(); _fsdCharts.engineers = null; }
    if (engCanvas) {
      _fsdCharts.engineers = new Chart(engCanvas, {
        type: 'bar',
        data: {
          labels: engIds.map(id => _fsEngineerName(id)),
          datasets: [{ label: 'Jobs Done', data: engValues, backgroundColor: '#3b82f6', borderRadius: 4 }],
        },
        plugins: [ChartDataLabels], // see trend chart's comment above — attached locally, not globally registered
        options: {
          // Same clipping fix as the trend chart above.
          layout: { padding: { top: 16 } },
          plugins: {
            legend: { display: false },
            datalabels: {
              align: 'end', anchor: 'end', color: tc,
              font: { family: 'DM Sans', size: 8 }, backgroundColor: null, padding: 2,
            },
          },
          scales: {
            x: { ticks: { color: tc, font: { family: 'DM Sans', size: 9 }, maxRotation: 45, minRotation: 0, autoSkip: true }, grid: { display: false } },
            y: { ticks: { color: tc, font }, grid: { display: false }, beginAtZero: true, suggestedMax: engMax > 0 ? Math.ceil(engMax * 1.15) : undefined },
          },
          responsive: true, maintainAspectRatio: false,
        },
      });
    }
  } else if (engCard) {
    engCard.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DETAILED LIST — from field_service_entries directly (RLS-scoped: own
// rows only, or all rows if field_service_view_all). No client-side
// engineer_id filter is added for the own-data case — RLS already returns
// exactly the right rows, same convention as js/fieldservice.js's own list.
// ═══════════════════════════════════════════════════════════════════════
async function _fsdLoadEntries(){
  const loadingEl = document.getElementById('fsdListLoading');
  const emptyEl   = document.getElementById('fsdListEmpty');
  const wrapEl    = document.getElementById('fsdTableWrap');
  const pagEl     = document.getElementById('fsdPagination');
  if (!loadingEl) return;
  loadingEl.style.display = 'block'; emptyEl.style.display = 'none';
  wrapEl.style.display = 'none'; pagEl.style.display = 'none';
  _fsdExpandedId = null;

  try {
    const f = _fsdActiveFilters();
    const viewAll = _fsCanViewAll();
    let url = `${SUPABASE_URL}/rest/v1/field_service_entries`
      + `?select=id,created_at,job_type,client_name,location,engineer_id,details,field_service_photos(id,field_label,storage_path,file_name)`
      + `&order=created_at.desc`;
    if (f.from)    url += `&created_at=gte.${f.from}T00:00:00`;
    if (f.to)      url += `&created_at=lte.${f.to}T23:59:59`;
    if (f.jobType) url += `&job_type=eq.${encodeURIComponent(f.jobType)}`;
    if (viewAll && f.engineer) url += `&engineer_id=eq.${encodeURIComponent(f.engineer)}`;

    const rangeFrom = _fsdPage * FSD_PAGE_SIZE;
    const rangeTo   = rangeFrom + FSD_PAGE_SIZE - 1;
    const res = await fetch(url, {
      headers: { ...SB_HDRS(), 'Range-Unit': 'items', 'Range': `${rangeFrom}-${rangeTo}`, 'Prefer': 'count=exact' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    _fsdTotalCount = _fsdParseContentRangeTotal(res.headers.get('content-range'));
    _fsdLastRows = rows;
    _fsdLastViewAll = viewAll;

    loadingEl.style.display = 'none';
    if (!rows.length) { emptyEl.style.display = 'block'; emptyEl.textContent = 'No entries found.'; return; }
    wrapEl.style.display = 'block';
    _fsdRenderTable(rows, viewAll);
    _fsdRenderPagination();
  } catch (e) {
    console.error('[FieldServiceDash] Entries load failed:', e);
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.textContent = '⚠️ Could not load entries — please try again.';
  }
}

function _fsdParseContentRangeTotal(headerVal){
  if (!headerVal) return 0;
  const m = /\/(\d+|\*)$/.exec(headerVal);
  return m && m[1] !== '*' ? Number(m[1]) : 0;
}

function _fsdRenderTable(rows, viewAll){
  const head = document.getElementById('fsdTableHead');
  const body = document.getElementById('fsdTableBody');
  if (!head || !body) return;
  head.innerHTML = `<tr>
    <th>Date</th><th>Job Type</th><th>Client</th><th>Location</th>
    ${viewAll ? '<th>Engineer</th>' : ''}
    <th style="text-align:center;">Photos</th>
  </tr>`;
  body.innerHTML = rows.map(e => {
    const jobLabel   = (JOB_TYPE_CONFIG[e.job_type] && JOB_TYPE_CONFIG[e.job_type].label) || e.job_type;
    const photoCount = (e.field_service_photos || []).length;
    const dateStr    = new Date(e.created_at).toLocaleString();
    const expanded   = _fsdExpandedId === e.id;
    return `
      <tr onclick="_fsdToggleRow('${e.id}')" style="cursor:pointer;">
        <td>${_fsEsc(dateStr)}</td>
        <td>${_fsEsc(jobLabel)}</td>
        <td>${_fsEsc(e.client_name)}</td>
        <td>${_fsEsc(e.location)}</td>
        ${viewAll ? `<td>${_fsEsc(_fsEngineerName(e.engineer_id))}</td>` : ''}
        <td style="text-align:center;">${photoCount}</td>
      </tr>
      ${expanded ? `<tr><td colspan="${viewAll ? 6 : 5}" style="padding:0;">${_fsdRenderExpandedRow(e)}</td></tr>` : ''}
    `;
  }).join('');
}

function _fsdToggleRow(id){
  _fsdExpandedId = _fsdExpandedId === id ? null : id;
  _fsdRenderTable(_fsdLastRows, _fsdLastViewAll); // re-render from cache — no re-fetch needed
}

// Bucket `field-service-photos` is PUBLIC (see js/fieldservice.js's own comment + FS_BUCKET
// usage) — reusing its existing _fsPublicPhotoUrl() helper rather than introducing signed
// URLs, since no signing helper exists anywhere in this codebase and the bucket isn't private.
function _fsdRenderExpandedRow(e){
  const cfg       = JOB_TYPE_CONFIG[e.job_type];
  const fieldDefs = (cfg && cfg.fields) || [];
  const details   = e.details || {};
  const detailRows = fieldDefs
    .filter(f => details[f.key] != null && details[f.key] !== '')
    .map(f => `<div style="margin-bottom:6px;"><span style="color:var(--muted);font-size:0.78rem;">${_fsEsc(f.label)}:</span> <span style="font-weight:600;">${_fsEsc(details[f.key])}</span></div>`)
    .join('') || '<div style="color:var(--muted);font-size:0.82rem;">No additional details for this job type.</div>';

  const photos = e.field_service_photos || [];
  const photoThumbs = photos.length
    ? photos.map(p => `
        <a href="${_fsPublicPhotoUrl(p.storage_path)}" target="_blank" rel="noopener" style="display:inline-block;margin:4px;text-align:center;">
          <img src="${_fsPublicPhotoUrl(p.storage_path)}" alt="${_fsEsc(p.field_label || p.file_name)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
          <div style="font-size:0.68rem;color:var(--muted);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_fsEsc(p.field_label || p.file_name)}</div>
        </a>
      `).join('')
    : '<div style="color:var(--muted);font-size:0.82rem;">No photos attached.</div>';

  return `
    <div style="padding:16px 20px;background:var(--surface2);border-top:1px solid var(--border);">
      <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px;">Details</div>
      ${detailRows}
      <div style="font-weight:700;font-size:0.85rem;margin:14px 0 8px;">Photos</div>
      <div>${photoThumbs}</div>
    </div>
  `;
}

function _fsdRenderPagination(){
  const pagEl = document.getElementById('fsdPagination');
  if (!pagEl) return;
  const totalPages = Math.max(1, Math.ceil(_fsdTotalCount / FSD_PAGE_SIZE));
  const curPage = _fsdPage + 1;
  pagEl.style.display = 'flex';
  pagEl.innerHTML = `
    <button class="page-btn" ${_fsdPage <= 0 ? 'disabled' : ''} onclick="_fsdGoPage(${_fsdPage - 1})">‹ Prev</button>
    <span style="font-size:0.82rem;color:var(--muted);padding:0 10px;">Page ${curPage} of ${totalPages} (${_fsdTotalCount} total)</span>
    <button class="page-btn" ${curPage >= totalPages ? 'disabled' : ''} onclick="_fsdGoPage(${_fsdPage + 1})">Next ›</button>
  `;
}

function _fsdGoPage(p){
  if (p < 0) return;
  _fsdPage = p;
  _fsdLoadEntries();
}
