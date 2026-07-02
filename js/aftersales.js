// Section: After Sales (loadAfterSales)
let afterSalesLoaded = false;
let afterSalesData   = [];

const AS_CAT_COLORS = [
  { color:'#22c55e', bg:'rgba(34,197,94,0.12)',  border:'rgba(34,197,94,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    desc:'Step-by-step hardware setup guides and configuration docs for all Aditi Tracking devices.' },
  { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    desc:'After sales documentation and support resources.' },
  { color:'#4e9af1', bg:'rgba(78,154,241,0.12)', border:'rgba(78,154,241,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
    desc:'After sales support and service resources.' },
  { color:'#a855f7', bg:'rgba(168,85,247,0.12)', border:'rgba(168,85,247,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    desc:'After sales resources.' },
];

async function loadAfterSales() {
  if (afterSalesLoaded) return;
  const loading = document.getElementById('aftersales-loading');
  const errEl   = document.getElementById('aftersales-error');
  const grid    = document.getElementById('aftersales-cat-grid');
  if (loading) loading.style.display = 'block';
  try {
    await CN.load();
    const section = CN.getSection('After Sales');
    if (!section) throw new Error('After Sales section not found in content_nodes');
    const cats = CN.getCategories(section.id);
    afterSalesLoaded = true;
    cnRenderCatGrid(grid, cats, loading, errEl, 'cnOpenAfterSalesOverlay');
  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (errEl)   { errEl.style.display = 'block'; errEl.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);">⚠️ ' + e.message + '</div>'; }
  }
}

function cnOpenAfterSalesOverlay(nodeId, catName) {
  cnOpenOverlay(nodeId, catName, 'afterSalesOverlay', 'asOverlayTitle', 'asOverlaySub',
                'asOverlayGrid', 'asOverlayLoader', 'asOverlayEmpty');
}

function renderAfterSalesCats() {
  document.getElementById('aftersales-loading').style.display = 'none';
  if (!afterSalesData || !afterSalesData.length) {
    document.getElementById('aftersales-error').style.display = 'block';
    document.getElementById('aftersales-error-msg').textContent = 'No data found.';
    return;
  }
  const cats = {};
  afterSalesData.forEach(row => {
    const cat = (row.Category || 'General').trim();
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(row);
  });
  const catNames = Object.keys(cats);
  const grid = document.getElementById('aftersales-cat-grid');
  grid.innerHTML = catNames.map((cat, i) => {
    const th    = AS_CAT_COLORS[i % AS_CAT_COLORS.length];
    const count = cats[cat].length;
    const safecat = cat.replace(/'/g,"\\'");
    return `
    <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
         onclick="openAfterSalesOverlay('${safecat}')">
      <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">${th.icon}</div>
      <div class="hc-name">${cat}</div>
      <div class="hc-desc">${th.desc}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
        <span class="hc-status live" style="background:${th.bg};color:${th.color};border:1px solid ${th.border};">📂 ${count} file${count===1?'':'s'}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${th.color};">View →</span>
      </div>
    </div>`;
  }).join('');
  grid.style.display = 'grid';
}

function openAfterSalesOverlay(cat) {
  const items = afterSalesData.filter(r => (r.Category||'General').trim() === cat);
  const i     = Object.keys(afterSalesData.reduce((a,r)=>{a[(r.Category||'General').trim()]=1;return a;},{})).indexOf(cat);
  const th    = AS_CAT_COLORS[Math.max(0,i) % AS_CAT_COLORS.length];
  document.getElementById('asOverlayTitle').textContent  = cat;
  document.getElementById('asOverlaySub').textContent    = items.length + ' file' + (items.length===1?'':'s');
  document.getElementById('asCatIcon').style.background  = th.bg;
  document.getElementById('asCatIcon').style.border      = '1px solid ' + th.border;
  document.getElementById('asCatIcon').innerHTML         = `<span style="color:${th.color}">${th.icon}</span>`;
  document.getElementById('asOverlayLoader').style.display = 'none';
  document.getElementById('asOverlayEmpty').style.display  = 'none';
  document.getElementById('afterSalesOverlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  const grid = document.getElementById('asOverlayGrid');
  if (!items.length) { document.getElementById('asOverlayEmpty').style.display='block'; grid.innerHTML=''; return; }
  grid.innerHTML = items.map(row => {
    const module = (row.Module || 'Document').trim();
    const link   = (row.Link   || '').trim();
    return renderOverlayCard(module, link, th);
  }).join('');
}

function closeAfterSalesOverlay() {
  document.getElementById('afterSalesOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

