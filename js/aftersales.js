// Section: After Sales (loadAfterSales)
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

// ═══════════════════════════════════════════════════════════
// HR DOCS OVERLAY — Supabase Documents table (SOP / HR Policy)
// ═══════════════════════════════════════════════════════════
let hrDocsCache = {};

const HR_DOC_THEMES = {
  'SOP':       { color:'#00d4ff', bg:'rgba(0,212,255,0.12)',  border:'rgba(0,212,255,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
  'HR Policy': { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>` },
  'Mediclaim': { color:'#ef4444', bg:'rgba(239,68,68,0.12)',  border:'rgba(239,68,68,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.5a5.5 5.5 0 0111-1 5.5 5.5 0 0111 1c0 7-8 11.5-8 11.5"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg>` },
  'Employee Dir': { color:'#06b6d4', bg:'rgba(6,182,212,0.12)', border:'rgba(6,182,212,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>` },
  'Support Dir': { color:'#0ea5e9', bg:'rgba(14,165,233,0.12)', border:'rgba(14,165,233,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.02 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>` },
  'Vendor Dir': { color:'#8b5cf6', bg:'rgba(139,92,246,0.12)', border:'rgba(139,92,246,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>` },
};

async function openHRDocsOverlay(module) {
  _actOnCardOpen(module); // ACTIVITY TRACKING
  const th = HR_DOC_THEMES[module] || HR_DOC_THEMES['SOP'];
  document.getElementById('hrDocsTitle').textContent  = module;
  document.getElementById('hrDocsSub').textContent    = '';
  document.getElementById('hrDocsIcon').style.background = th.bg;
  document.getElementById('hrDocsIcon').style.border     = '1px solid ' + th.border;
  document.getElementById('hrDocsIcon').innerHTML        = `<span style="color:${th.color}">${th.icon}</span>`;
  document.getElementById('hrDocsLoader').style.display  = 'block';
  document.getElementById('hrDocsGrid').innerHTML        = '';
  document.getElementById('hrDocsEmpty').style.display   = 'none';
  document.getElementById('hrDocsOverlay').style.display = 'block';

  // Show upload section only for Mediclaim
  const uploadSec = document.getElementById('hrDocsUploadSection');
  if (uploadSec) {
    uploadSec.style.display = (module === 'Mediclaim') ? 'block' : 'none';
    document.getElementById('hrDocsUploadStatus').style.display = 'none';
    document.getElementById('hrDocsFileInput').value = '';
  }

  try {
    await CN.load();
    const hrSection = CN.getSection('HR');
    let node = null;
    if (hrSection) {
      const cats = CN.getCategories(hrSection.id);
      node = cats.find(c => (c.name||'').trim().toLowerCase() === module.trim().toLowerCase());
      if (!node) {
        for (const cat of cats) {
          const sub = CN.getCategories(cat.id).find(s => (s.name||'').trim().toLowerCase() === module.trim().toLowerCase());
          if (sub) { node = sub; break; }
        }
      }
    }

    document.getElementById('hrDocsLoader').style.display = 'none';

    if (!node) {
      document.getElementById('hrDocsEmpty').style.display = 'block';
      return;
    }

    // Use shared renderer — handles sub-cards + direct files
    _cnRenderOverlayContent(
      node.id, module, th,
      'hrDocsGrid', 'hrDocsSub', 'hrDocsEmpty', null
    );

  } catch(e) {
    document.getElementById('hrDocsLoader').style.display = 'none';
    document.getElementById('hrDocsEmpty').style.display  = 'block';
    document.getElementById('hrDocsEmpty').textContent    = 'Failed to load: ' + e.message;
  }
}

function renderHRDocs(items, th, module) {
  document.getElementById('hrDocsLoader').style.display = 'none';
  document.getElementById('hrDocsSub').textContent = items.length + ' file' + (items.length===1?'':'s');
  if (!items.length) { document.getElementById('hrDocsEmpty').style.display='block'; return; }
  const grid = document.getElementById('hrDocsGrid');
  grid.innerHTML = items.map(row => {
    const name  = (row.Doc_Name || row.name || 'Document').trim();
    const link  = (row.Doc_Link || row.url  || '').trim();
    const fid   = row.id || row.fileId || undefined;
    return renderOverlayCard(name, link, th, fid);
  }).join('');
}

function closeHRDocsOverlay() {
  _actOnCardClose(); // ACTIVITY TRACKING
  document.getElementById('hrDocsOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════
// MEDICLAIM UPLOAD — HR can upload files directly
// ═══════════════════════════════════════════════════════════
const MEDICLAIM_UPLOAD_PASSWORD = 'hr@aditi2026';  // Change this to your preferred password
const MEDICLAIM_BUCKET = 'Documents';
const MEDICLAIM_FOLDER = 'Mediclaim';

function triggerMediclaimUpload() {
  alert('Mediclaim upload is being migrated to the new system. Coming soon!');
  return;
  // --- original code below (disabled) ---
  // Password gate
  const pwd = prompt('Enter HR password to upload:');
  if (pwd === null) return;  // User cancelled
  if (pwd !== MEDICLAIM_UPLOAD_PASSWORD) {
    alert('Incorrect password. Upload cancelled.');
    return;
  }
  // Trigger file picker
  document.getElementById('hrDocsFileInput').click();
}

// Wire up file input change handler after DOM ready
document.addEventListener('DOMContentLoaded', function() {
  const fileInput = document.getElementById('hrDocsFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleMediclaimFileSelected);
  }
});
// Also bind immediately in case DOMContentLoaded already fired
(function() {
  const fileInput = document.getElementById('hrDocsFileInput');
  if (fileInput && !fileInput._mediclaimBound) {
    fileInput.addEventListener('change', handleMediclaimFileSelected);
    fileInput._mediclaimBound = true;
  }
})();

async function handleMediclaimFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('hrDocsUploadStatus');
  const uploadBtn = document.getElementById('hrDocsUploadBtn');
  const setStatus = (msg, color) => {
    statusEl.style.display = 'block';
    statusEl.style.color = color || 'var(--muted)';
    statusEl.textContent = msg;
  };

  // Ask for display name (default = file name without extension)
  const defaultName = file.name.replace(/\.[^.]+$/, '');
  const displayName = prompt('Display name for this document:', defaultName);
  if (displayName === null || !displayName.trim()) {
    e.target.value = '';
    return;
  }

  try {
    uploadBtn.disabled = true;
    uploadBtn.style.opacity = '0.6';
    uploadBtn.style.cursor = 'wait';
    setStatus('⏳ Uploading file…', '#f0a500');

    // 1. Build unique storage path: Mediclaim/<timestamp>_<filename>
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${MEDICLAIM_FOLDER}/${ts}_${safeName}`;

    // 2. Upload file to Supabase Storage
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${MEDICLAIM_BUCKET}/${encodeURIComponent(storagePath)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${_currentToken}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false'
      },
      body: file
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      throw new Error('Storage upload fail: HTTP ' + uploadRes.status + (errText ? ' — ' + errText.slice(0, 200) : ''));
    }

    // 3. Build public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${MEDICLAIM_BUCKET}/${storagePath}`;

    setStatus('⏳ Saving to database…', '#f0a500');

    // 4. Find Mediclaim content_node and insert into files table
    await CN.load();
    const hrSection   = CN.getSection('HR');
    const mediclaimNode = hrSection
      ? CN.getCategories(hrSection.id).find(c => (c.name||'').toLowerCase() === 'mediclaim')
      : null;
    const nodeId = mediclaimNode ? mediclaimNode.id : null;

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/files`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${_currentToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ node_id: nodeId, name: displayName.trim(), file_url: publicUrl })
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => '');
      throw new Error('DB insert fail: HTTP ' + insertRes.status + (errText ? ' — ' + errText.slice(0, 200) : ''));
    }

    setStatus('✅ Upload successful! Refreshing list…', '#00d4aa');

    // 5. Clear cache and reload overlay
    delete hrDocsCache['Mediclaim'];
    e.target.value = '';
    setTimeout(() => {
      openHRDocsOverlay('Mediclaim');
    }, 800);

  } catch (err) {
    setStatus('❌ ' + err.message, '#ff5c7c');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.style.opacity = '';
    uploadBtn.style.cursor = 'pointer';
  }
}

// ═══════════════════════════════════════════════════════════
// SALES PANEL — Supabase Sales table → category cards → overlay
// ═══════════════════════════════════════════════════════════
let salesDocsLoaded = false;
let salesAllData    = [];

const SALES_CAT_THEME = {
  'SOP':                { color:'#00d4aa', bg:'rgba(0,212,170,0.12)',  border:'rgba(0,212,170,0.3)',
    desc:'Standard Operating Procedures — step-by-step documented processes for the Sales team.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
  'Target Audience':    { color:'#4e9af1', bg:'rgba(78,154,241,0.12)', border:'rgba(78,154,241,0.3)',
    desc:'Customer profiles and segmentation — understand who to target and how to approach them effectively.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>` },
  'Qualify Leads':      { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)',
    desc:'Lead qualification framework and SQL criteria — know when a prospect is truly ready to buy.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>` },
  'Sales Pitch':        { color:'#a855f7', bg:'rgba(168,85,247,0.12)', border:'rgba(168,85,247,0.3)',
    desc:'Ready-to-use pitch scripts and decks — present Aditi Tracking value proposition with confidence.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
  'Objection Handling': { color:'#ff5c7c', bg:'rgba(255,92,124,0.12)', border:'rgba(255,92,124,0.3)',
    desc:'Common objections and proven responses — turn hesitations into opportunities.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>` },
  'Intro & Follow-up':  { color:'#00d4ff', bg:'rgba(0,212,255,0.12)',  border:'rgba(0,212,255,0.3)',
    desc:'Email and message templates for introductions and follow-ups — make the right first impression.',
    icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>` },
};
const SALES_FALLBACK_COLORS = [
  { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)'  },
  { color:'#a855f7', bg:'rgba(168,85,247,0.12)', border:'rgba(168,85,247,0.3)' },
  { color:'#00d4aa', bg:'rgba(0,212,170,0.12)',  border:'rgba(0,212,170,0.3)'  },
  { color:'#4e9af1', bg:'rgba(78,154,241,0.12)', border:'rgba(78,154,241,0.3)' },
  { color:'#ff5c7c', bg:'rgba(255,92,124,0.12)', border:'rgba(255,92,124,0.3)' },
  { color:'#00d4ff', bg:'rgba(0,212,255,0.12)',  border:'rgba(0,212,255,0.3)'  },
];
function getSalesCatTheme(cat, idx) {
  // exact match
  if (SALES_CAT_THEME[cat]) return SALES_CAT_THEME[cat];
  // fuzzy match
  for (const key of Object.keys(SALES_CAT_THEME)) {
    if (cat.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(cat.toLowerCase()))
      return SALES_CAT_THEME[key];
  }
  const fb = SALES_FALLBACK_COLORS[(idx||0) % SALES_FALLBACK_COLORS.length];
  return { ...fb, desc: 'Sales resources for ' + cat + '.', icon:`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` };
}

