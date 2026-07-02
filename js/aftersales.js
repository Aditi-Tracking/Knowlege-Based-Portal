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

// ═══════════════════════════════════════════════════════════
// SHARED OVERLAY CARD RENDERER — used by HR, Sales, After Sales
// ═══════════════════════════════════════════════════════════
function renderOverlayCard(name, link, th, fileId, nodeId) {
  const ext   = (link||'').split('?')[0].split('.').pop().toLowerCase();
  const isYt  = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.test(link||'');
  const ytId  = isYt ? (link||'').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1] : null;
  const isVid = ['mp4','webm','mov'].includes(ext);
  const isPdf = ext === 'pdf';
  const label = isYt ? '▶ YouTube' : isVid ? '🎬 Video' : isPdf ? '📄 PDF' : '📁 Open';
  const fileIcon = isYt
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/></svg>`
    : isVid
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
    : isPdf
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

  const safeLink = (link||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const safeName = (name||'Document').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const delFileBtn = (fileId && _isMIS()) ? `<button onclick="event.stopPropagation();event.preventDefault();confirmDeleteFile(${fileId},'${safeLink}')" title="Delete file"
    style="position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;transition:all 0.18s;"
    onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
  </button>` : '';

  // YouTube card — show thumbnail prominently
  if (isYt && ytId) {
    return `
    <div style="position:relative;display:flex;flex-direction:column;" data-file-id="${fileId||''}">
      ${delFileBtn}
      <div onclick="openFileViewer('${safeLink}','${safeName}')" style="cursor:pointer;border-radius:16px;overflow:hidden;border:1.5px solid var(--border);border-top:3px solid #ff0000;transition:all 0.22s;background:var(--surface2);"
        onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 10px 30px rgba(0,0,0,0.22)';this.style.borderColor='#ff0000'"
        onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
        <div style="position:relative;">
          <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" alt="${name}" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover;" onerror="this.style.display='none'"/>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
            <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,0,0,0.88);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            </div>
          </div>
        </div>
        <div style="padding:12px 14px;">
          <div style="font-size:0.87rem;font-weight:700;color:var(--text);line-height:1.4;margin-bottom:8px;">${name}</div>
          <span style="font-size:0.70rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(255,0,0,0.1);color:#ff4444;border:1px solid rgba(255,0,0,0.25);">▶ YouTube</span>
        </div>
      </div>
    </div>`;
  }

  return `
  <div style="position:relative;display:flex;flex-direction:column;" data-file-id="${fileId||''}">
    ${delFileBtn}
    <a href="${link}" onclick="openFileViewer('${safeLink}','${safeName}');return false;" style="text-decoration:none;display:flex;cursor:pointer;">
      <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:16px;
                  padding:20px 16px;cursor:pointer;transition:all 0.22s;
                  border-top:3px solid ${th.color};
                  display:flex;flex-direction:column;width:100%;min-height:148px;"
           onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 10px 30px rgba(0,0,0,0.22)';this.style.borderColor='${th.color}'"
           onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
        <div style="width:42px;height:42px;border-radius:11px;background:${th.bg};border:1px solid ${th.border};
                    display:flex;align-items:center;justify-content:center;margin-bottom:14px;
                    flex-shrink:0;color:${th.color};">${fileIcon}</div>
        <div style="font-size:0.87rem;font-weight:700;color:var(--text);line-height:1.45;
                    flex:1;margin-bottom:14px;">${name}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
          <span style="font-size:0.70rem;font-weight:700;padding:4px 11px;border-radius:20px;
                       background:${th.bg};color:${th.color};border:1px solid ${th.border};">${label}</span>
          <span style="font-size:0.78rem;font-weight:600;color:${th.color};">↗</span>
        </div>
      </div>
    </a>
  </div>`;
}

