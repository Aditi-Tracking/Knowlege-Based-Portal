// Section: Products (loadProducts, product overlay, org chart, directory)
let prodLoaded = false;

async function loadProducts() {
  if (prodLoaded) return;
  prodLoaded = true;

  try {
    await CN.load();
    const section = CN.getSection('Products');
    const loading = document.getElementById('prod-vid-loading');
    const errEl   = document.getElementById('prod-vid-error');

    if (!section) {
      if (loading) loading.style.display = 'none';
      if (errEl)   { errEl.style.display='block'; errEl.innerHTML='<div style="padding:2rem;text-align:center;color:var(--muted);">No Products section found in content_nodes.</div>'; }
      return;
    }

    const cats = CN.getCategories(section.id);

    // ── Render category cards ─────────────────────────────────────────────
    const catSection = document.getElementById('prod-cat-section');
    const catGrid    = document.getElementById('prod-cat-grid');
    if (cats.length && catGrid) {
      catGrid.innerHTML = cats.map((cat, i) => {
        const th    = cnTheme(i);
        const name  = cat.name || 'Category';
        const count = CN.totalFiles(cat.id);
        const safe  = name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
        return `
        <div style="position:relative;">
          ${_isMIS() ? `          <button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete card"
            style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
            onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>` : ''}
          <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
            onclick="cnOpenProdOverlay(${cat.id},'${safe}')"
            onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
            onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
            <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="hc-name">${name}</div>
            <div class="hc-desc" style="font-size:0.88rem;color:var(--muted);line-height:1.55;">${getCNCardDesc(name)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
              <span class="hc-status live" style="background:${th.bg};color:${th.color};border:1px solid ${th.border};">📂 ${count} file${count===1?'':'s'}</span>
              <span style="font-size:0.78rem;font-weight:600;color:${th.color};">View →</span>
            </div>
          </div>
        </div>`;
      }).join('');
      if (catSection) catSection.style.display = 'block';
    }

    // ── Render flat video list (direct files only, not inside categories) ─
    const directFiles = CN.getFiles(section.id);
    const allCatFiles = cats.flatMap(c => CN.getFiles(c.id));
    const allFiles    = [...directFiles, ...allCatFiles];
    if (loading) loading.style.display = 'none';
    if (allFiles.length) {
      renderProdVideos(allFiles.map(f => ({ Product_name: f.name, Product_Url: f.url, fileId: f.id })));
    } else {
      if (loading) loading.style.display = 'none';
    }

  } catch(e) {
    const loading = document.getElementById('prod-vid-loading');
    const errEl   = document.getElementById('prod-vid-error');
    if (loading) loading.style.display = 'none';
    if (errEl)   { errEl.style.display='block'; errEl.innerHTML='<div style="padding:2rem;text-align:center;color:var(--muted);">⚠️ ' + e.message + '</div>'; }
  }
}

// Products overlay using shared renderer
function cnOpenProdOverlay(nodeId, catName) {
  // Reuse marketing overlay for products (same structure)
  const th = cnTheme(0);
  const iconEl = document.getElementById('mktOverlayIcon');
  if (iconEl) { iconEl.style.background = th.bg; iconEl.style.borderColor = th.border; iconEl.innerHTML = `<span style="font-size:1.4rem;">📂</span>`; }
  document.getElementById('mktOverlayTitle').textContent    = catName;
  document.getElementById('mktOverlaySub').textContent      = '';
  document.getElementById('mktOverlayLoader').style.display = 'none';
  document.getElementById('mktOverlayGrid').innerHTML       = '';
  document.getElementById('mktOverlayEmpty').style.display  = 'none';
  document.getElementById('marketingOverlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  _cnRenderOverlayContent(nodeId, catName, th, 'mktOverlayGrid', 'mktOverlaySub', 'mktOverlayEmpty', null);
}

function renderProdVideos(videos) {
  const loadEl = document.getElementById('prod-vid-loading');
  const gridEl = document.getElementById('prod-vid-grid');
  if (loadEl) loadEl.style.display = 'none';

  if (!videos || videos.length === 0) {
    const errEl = document.getElementById('prod-vid-error');
    if (errEl) { errEl.style.display = 'block'; document.getElementById('prod-vid-error-msg').textContent = 'No training videos found.'; }
    return;
  }

  const vidColors = ['#a855f7','#00d4aa','#4e9af1','#f0a500'];
  gridEl.style.display = 'grid';
  gridEl.innerHTML = videos.map((row, i) => {
    const name  = (row.Product_name || 'Video').trim();
    const url   = (row.Product_Url  || '').trim();
    const color = vidColors[i % vidColors.length];
    const bg    = color + '18';
    const border= color + '44';
    // Determine if URL is a direct video file or an embed link
    const isDirectVideo = url.match(/\.(mp4|webm|ogg|mov)(\?|$)/i);
    const isYouTube     = url.includes('youtube.com') || url.includes('youtu.be');
    const isSupabase    = url.includes('supabase.co');
    let mediaHtml = '';
    if (isDirectVideo || isSupabase) {
      mediaHtml = `<video id="prod-vid-${i}" controls controlsList="nodownload noplaybackrate" disablePictureInPicture preload="metadata"
        onplay="pauseAllVideosExcept('prod-vid-${i}')"
        style="width:100%;height:100%;object-fit:cover;border-radius:12px 12px 0 0;display:block;background:#000;">
        <source src="${url}" type="video/mp4">
        <source src="${url}" type="video/webm">
        Your browser does not support the video tag.
      </video>`;
    } else if (isYouTube) {
      const ytId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || '';
      mediaHtml = ytId
        ? `<iframe src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen
            style="width:100%;height:100%;border-radius:12px 12px 0 0;display:block;"></iframe>`
        : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;color:var(--muted);">Preview unavailable</div>`;
    } else if (url) {
      mediaHtml = `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:${bg};">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="${color}" stroke="none"/></svg>
        <div style="font-size:0.78rem;color:var(--muted);text-align:center;padding:0 16px;">Click below to open video</div>
      </div>`;
    } else {
      mediaHtml = `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:${bg};">🎥</div>`;
    }
    const fid = row.fileId;
    const delBtn = (fid && _isMIS()) ? `<button onclick="confirmDeleteFile(${fid},'${url.replace(/'/g,"\'")}')" title="Delete"
      style="position:absolute;top:8px;right:8px;z-index:3;width:30px;height:30px;border-radius:8px;background:rgba(239,68,68,0.85);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;"
      onmouseover="this.style.background='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(239,68,68,0.85)'">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
    </button>` : '';
    return `
    <div style="position:relative;background:var(--surface);border:1.5px solid ${border};border-radius:14px;overflow:hidden;
                box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:transform 0.22s,box-shadow 0.22s;"
         onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.35)'"
         onmouseout="this.style.transform='';this.style.boxShadow='0 4px 20px rgba(0,0,0,0.2)'">
      ${delBtn}
      <div style="width:100%;height:200px;overflow:hidden;position:relative;background:#000;">${mediaHtml}</div>
      <div style="padding:14px 16px 16px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="width:32px;height:32px;border-radius:8px;background:${bg};border:1px solid ${border};
                      display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div style="font-weight:700;font-size:0.95rem;color:var(--text);line-height:1.3;">${name}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---- ORG CHART OVERLAY (Supabase Documents) ----
function openOrgChartPicker() {
  _actOnCardOpen('Organization Chart'); // ACTIVITY TRACKING
  document.getElementById('orgChartOverlay').style.display = 'flex';
  document.getElementById('orgChartPicker').style.display = 'block';
  document.getElementById('orgChartDocScreen').style.display = 'none';
  document.body.style.overflow = 'hidden';
}

function backToOrgChartPicker() {
  document.getElementById('orgChartPicker').style.display = 'block';
  document.getElementById('orgChartDocScreen').style.display = 'none';
}

async function openOrgChartOverlay(moduleType) {
  const isHead    = moduleType === 'Head Office';
  const accentClr = isHead ? '#14b8a6' : '#6366f1';

  const loader  = document.getElementById('orgChartOverlayLoader');
  const grid    = document.getElementById('orgChartOverlayGrid');
  const emptyEl = document.getElementById('orgChartOverlayEmpty');
  const errorEl = document.getElementById('orgChartOverlayError');

  try {
    // Show loader briefly while fetching
    document.getElementById('orgChartPicker').style.display = 'none';
    const docScreen = document.getElementById('orgChartDocScreen');
    docScreen.style.display = 'block';
    loader.style.display  = 'block';
    grid.style.display    = 'none';
    emptyEl.style.display = 'none';
    errorEl.style.display = 'none';
    grid.innerHTML        = '';

    document.getElementById('orgChartOverlayTitle').textContent = isHead ? '🏢 Head Office — Org Charts' : '🏬 Branch Offices — Org Charts';
    document.getElementById('orgChartOverlaySub').textContent   = isHead
      ? 'Mumbai Head Office organizational structure.'
      : 'Goa, Bengaluru, Ahmedabad and other branch office org charts.';

    // Use CN — content_nodes + files
    await CN.load();
    const hrSection = CN.getSection('HR');
    let docs = [];
    if (hrSection) {
      const cats = CN.getCategories(hrSection.id);
      const orgCat = cats.find(c => (c.name||'').toLowerCase().includes('organization') || (c.name||'').toLowerCase().includes('org chart'));
      if (orgCat) {
        if (isHead) {
          // Direct files of Organisation Chart node
          const directFiles = CN.getFiles(orgCat.id);
          docs = directFiles.map(f => ({ Doc_Name: f.name, Doc_Link: f.url }));
        } else {
          // Branch Office sub-category
          const subCats = CN.getCategories(orgCat.id);
          const branchCat = subCats.find(c => (c.name||'').toLowerCase().includes('branch'));
          if (branchCat) {
            docs = CN.getFiles(branchCat.id).map(f => ({ Doc_Name: f.name, Doc_Link: f.url }));
          }
        }
      }
    }

    loader.style.display = 'none';

    if (!docs.length) {
      emptyEl.style.display = 'block';
      return;
    }

    // Head Office — if only 1 doc, open directly
    if (isHead && docs.length === 1) {
      closeOrgChartOverlay();
      openFileViewer(docs[0].Doc_Link, docs[0].Doc_Name || 'Org Chart');
      return;
    }

    // Branch Office (ya multiple docs) — compact horizontal cards
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.gap = '10px';
    grid.innerHTML = docs.map(doc => {
      const safeLink = (doc.Doc_Link||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
      const safeName = (doc.Doc_Name||'Org Chart').replace(/'/g,"\\'").replace(/"/g,'&quot;');
      return `
      <a href="${doc.Doc_Link}" onclick="openFileViewer('${safeLink}','${safeName}');return false;" style="text-decoration:none;cursor:pointer;">
        <div style="background:var(--surface2);border:1.5px solid ${accentClr}33;border-left:4px solid ${accentClr};border-radius:12px;padding:14px 16px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:14px;"
             onmouseover="this.style.background='${accentClr}12';this.style.borderColor='${accentClr}88';"
             onmouseout="this.style.background='var(--surface2)';this.style.borderColor='${accentClr}33';">
          <div style="width:40px;height:40px;min-width:40px;border-radius:10px;background:${accentClr}18;border:1px solid ${accentClr}44;display:flex;align-items:center;justify-content:center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${accentClr}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><rect x="1" y="17" width="6" height="4" rx="1"/><rect x="9" y="17" width="6" height="4" rx="1"/><rect x="17" y="17" width="6" height="4" rx="1"/><path d="M12 6v4M4 17v-3a2 2 0 012-2h12a2 2 0 012 2v3"/><line x1="12" y1="10" x2="12" y2="12"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.95rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${doc.Doc_Name}</div>
            <div style="font-size:0.78rem;color:${accentClr};margin-top:3px;">🔗 Open Document</div>
          </div>
          <span style="color:${accentClr};font-size:1.1rem;flex-shrink:0;">→</span>
        </div>
      </a>`;
    }).join('');

  } catch(e) {
    loader.style.display  = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent   = 'Error loading documents: ' + e.message;
  }
}

function closeOrgChartOverlay() {
  document.getElementById('orgChartOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

function openDirectoryOverlay() {
  _actOnCardOpen('Directory'); // ACTIVITY TRACKING
  document.getElementById('directoryOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeDirectoryOverlay() {
  document.getElementById('directoryOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

// Icon/color map keyed by lowercase title keywords
function getMISVideoMeta(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('checklist') || t.includes('task'))
    return { icon: '✅', color: '#00d4aa', desc: 'Task Checklist — training on how to use checklists in daily operations.' };
  if (t.includes('how to') && (t.includes('fms') || t.includes('fleet')))
    return { icon: '🎯', color: '#3b82f6', desc: 'FMS step-by-step guide — learn how to use it practically.' };
  if (t.includes('fms') || t.includes('fleet'))
    return { icon: '🚗', color: '#f0a500', desc: 'Fleet Management System — training on vehicle tracking, trips and fuel monitoring.' };
  if (t.includes('odoo'))
    return { icon: '🏢', color: '#a855f7', desc: 'Odoo ERP — training on purchase, sales and inventory management.' };
  if (t.includes('pre-sales') || t.includes('presales') || t.includes('pre sales') || t.includes('lead') || t.includes('demo') || t.includes('proposal'))
    return { icon: '🤝', color: '#e879f9', desc: 'Pre-Sales — training on lead handling, demos, proposals and client communication.' };
  if (t.includes('looker'))
    return { icon: '📈', color: '#3b82f6', desc: 'Looker Studio — training on building data visualizations and dashboards.' };
  if (t.includes('cool bus') || t.includes('coolbus'))
    return { icon: '🚌', color: '#22c55e', desc: 'Cool Bus — training on vehicle tracking and route management.' };
  if (t.includes('smart fleet') || t.includes('smartfleet'))
    return { icon: '🛰️', color: '#f97316', desc: 'Smart Fleet — training on fleet monitoring and operations.' };
  if (t.includes('pc') || t.includes('process'))
    return { icon: '💼', color: '#ec4899', desc: 'Process Coordinator — training on coordination workflows and closing procedures.' };
  if (t.includes('part'))
    return { icon: '📹', color: '#6366f1', desc: 'Training video — step-by-step guide.' };
  return { icon: '🎬', color: '#f0a500', desc: 'Training video.' };
}

// Loaded videos (array of {id, Title, Video_URL})
