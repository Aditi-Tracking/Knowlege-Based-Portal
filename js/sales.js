// Section: Sales (loadSalesDocs, SOP documents)
async function loadSalesDocs(force) {
  if (salesDocsLoaded && !force) return;
  const loading = document.getElementById('sales-loading');
  const errEl   = document.getElementById('sales-error');
  const grid    = document.getElementById('sales-cat-grid');
  if (loading) { loading.style.display = 'block'; }
  if (grid)    grid.style.display = 'none';
  if (errEl)   errEl.style.display = 'none';
  try {
    await CN.load();
    const section = CN.getSection('Sales');
    if (!section) throw new Error('Sales section not found in content_nodes');
    const cats = CN.getCategories(section.id);
    salesDocsLoaded = true;
    cnRenderCatGrid(grid, cats, loading, errEl, 'cnOpenSalesOverlay');
  } catch(e) {
    if (loading) loading.style.display = 'none';
    if (errEl)   { errEl.style.display = 'block'; errEl.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);">⚠️ ' + e.message + '</div>'; }
  }
}

function cnOpenSalesOverlay(nodeId, catName) {
  cnOpenOverlay(nodeId, catName, 'salesDocsOverlay', 'salesOverlayTitle', 'salesOverlaySub',
                'salesOverlayGrid', 'salesOverlayLoader', 'salesOverlayEmpty');
}

function renderSalesCatCards() {
  document.getElementById('sales-loading').style.display = 'none';
  if (!salesAllData || !salesAllData.length) {
    document.getElementById('sales-error').style.display = 'block';
    document.getElementById('sales-error-msg').textContent = 'No data found.';
    return;
  }
  // group by Category
  const cats = {};
  salesAllData.forEach(row => {
    const cat = (row.Category || 'General').trim();
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(row);
  });
  // Fixed order for sales cards
  const SALES_CAT_ORDER = ['SOP', 'Target Audience', 'Qualify Leads', 'Sales Pitch', 'Objection Handling', 'Intro & Follow-up'];
  const catNames = Object.keys(cats).sort((a, b) => {
    let idxA = SALES_CAT_ORDER.findIndex(o => a.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(a.toLowerCase()));
    let idxB = SALES_CAT_ORDER.findIndex(o => b.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(b.toLowerCase()));
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    return idxA - idxB;
  });
  const grid = document.getElementById('sales-cat-grid');
  grid.innerHTML = catNames.map((cat, i) => {
    const th    = getSalesCatTheme(cat, i);
    const count = cats[cat].length;
    const safecat = cat.replace(/'/g,"\\'");
    return `
    <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
         onclick="openSalesOverlay('${safecat}')"
         onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
         onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
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

function openSalesOverlay(cat) {
  _actOnCardOpen(cat); // ACTIVITY TRACKING
  const items = salesAllData.filter(r => (r.Category||'General').trim() === cat);
  const th    = getSalesCatTheme(cat);
  // Set header
  document.getElementById('salesOverlayTitle').textContent = cat;
  document.getElementById('salesOverlaySub').textContent   = items.length + ' file' + (items.length===1?'':'s');
  const iconEl = document.getElementById('salesOverlayCatIcon');
  iconEl.style.background = th.bg;
  iconEl.style.border     = '1px solid ' + th.border;
  iconEl.innerHTML = `<span style="color:${th.color}">${th.icon}</span>`;
  // Show overlay immediately, loader visible
  document.getElementById('salesOverlayLoader').style.display = 'block';
  document.getElementById('salesOverlayGrid').innerHTML       = '';
  document.getElementById('salesOverlayEmpty').style.display  = 'none';
  document.getElementById('salesDocsOverlay').style.display   = 'block';
  document.body.style.overflow = 'hidden';
  // Render cards
  setTimeout(() => {
    document.getElementById('salesOverlayLoader').style.display = 'none';
    if (!items.length) { document.getElementById('salesOverlayEmpty').style.display = 'block'; return; }
    const grid = document.getElementById('salesOverlayGrid');
    grid.innerHTML = items.map(row => {
      const module = (row.Module || 'Document').trim();
      const link   = (row.Link   || '').trim();
      return renderOverlayCard(module, link, th);
    }).join('');
  }, 100);
}

function closeSalesOverlay() {
  _actOnCardClose(); // ACTIVITY TRACKING
  document.getElementById('salesDocsOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════
// MARKETING PANEL — Supabase Marketing table → overlay
// Table: Marketing | Columns: Type, Category, Module, Link
// Filter: Category = 'Marketing Brochure'
// ═══════════════════════════════════════════════════════════
let marketingDataCache = {};
let marketingInitLoaded = false;

const MKT_THEME = {
  color: '#f0a500',
  bg:    'rgba(240,165,0,0.12)',
  border:'rgba(240,165,0,0.3)'
};

// Category → theme color map
const MKT_CAT_THEME = {
  'Marketing Brochure': { color:'#f0a500', bg:'rgba(240,165,0,0.12)',   border:'rgba(240,165,0,0.3)',   icon:'📄' },
  'Solution Videos':    { color:'#a855f7', bg:'rgba(168,85,247,0.12)',  border:'rgba(168,85,247,0.3)',  icon:'🎬' },
  'Short Explainer':    { color:'#00d4aa', bg:'rgba(0,212,170,0.12)',   border:'rgba(0,212,170,0.3)',   icon:'▶️' },
};

// Marketing panel khulte hi count badge update karo — teeno categories ke liye
