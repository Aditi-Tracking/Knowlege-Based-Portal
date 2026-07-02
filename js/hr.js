// Section: HR Panel (loadHRSection, Mediclaim upload)
let hrSectionLoaded = false;

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

async function loadHRSection() {
  if (hrSectionLoaded) return;
  const loadEl = document.getElementById('hr-loading');
  const gridEl = document.getElementById('hr-doc-grid');
  try {
    await CN.load();
    const hrSection = CN.getSection('HR');
    if (!hrSection) { if (loadEl) loadEl.style.display='none'; return; }

    // Get all direct children of HR section
    const cats = CN.getCategories(hrSection.id);

    // Special cards handled separately — skip them from dynamic render
    const SPECIAL = ['organization chart', 'directory', 'holiday list', 'branch office'];
    const docCats = cats.filter(c => !SPECIAL.includes((c.name||'').toLowerCase().trim()));

    if (loadEl) loadEl.style.display = 'none';

    // Known HR doc cards → shown ABOVE special cards (Org Chart, Directory, Holiday List)
    // Any NEW card added later → shown BELOW special cards (after Holiday List)
    const KNOWN_FIRST = ['sop', 'mediclaim', 'hr policy'];
    const knownCats = docCats.filter(c => KNOWN_FIRST.includes((c.name||'').toLowerCase().trim()));
    const newCats   = docCats.filter(c => !KNOWN_FIRST.includes((c.name||'').toLowerCase().trim()));

    const specialGrid = document.getElementById('hr-special-grid');
    const specialHTML = specialGrid ? specialGrid.innerHTML : '';

    // Order: [SOP, Mediclaim, HR Policy] → [Org Chart, Directory, Holiday List] → [new cards]
    const renderCatCards = (list, indexOffset) => list.map((cat, i) => {
      const th    = cnTheme(i + indexOffset);
      const name  = cat.name || 'Category';
      const count = CN.totalFiles(cat.id);
      const safe  = name.replace(/'/g, "\'").replace(/"/g, '&quot;');
      return `
      <div style="position:relative;">
        ${_isMIS() ? `        <button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete card"
          style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>` : ''}
        <div onclick="openHRDocsOverlay('${safe}')" style="height:100%;display:flex;cursor:pointer;">
        <div class="home-card" style="--card-top:${th.color};cursor:pointer;padding:1.5rem;width:100%;">
          <div class="hc-icon" style="background:${th.bg};border-color:${th.border};width:52px;height:52px;border-radius:14px;margin-bottom:16px;color:${th.color};">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div class="hc-name" style="font-size:1.12rem;">${name}</div>
          <div class="hc-desc" style="font-size:0.91rem;line-height:1.6;color:var(--muted);">${getCNCardDesc(name)}</div>
          <div style="margin-top:14px;">
            <span style="font-size:0.82rem;font-weight:600;color:${th.color};background:${th.bg};border:1px solid ${th.border};padding:4px 12px;border-radius:20px;">📂 ${count} file${count===1?'':'s'}</span>
          </div>
        </div>
        </div>
      </div>`;
    }).join('');

    if (!knownCats.length && !newCats.length) { gridEl.style.display = 'none'; return; }

    gridEl.innerHTML = renderCatCards(knownCats, 0) + specialHTML + renderCatCards(newCats, knownCats.length);

    if (specialGrid) specialGrid.style.display = 'none';

    gridEl.style.display = 'grid';
    hrSectionLoaded = true;
    // Inject delete buttons on special cards (now inside hr-doc-grid)
    injectDeleteBtns('HR', gridEl);
  } catch(e) {
    if (loadEl) loadEl.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════
// HOLIDAY LIST  — Supabase fetch, location-wise filter
// ══════════════════════════════════════════════════════════
let _holidayAllData = [];   // raw data from Supabase
let _holidayFetched = false;

async function loadHolidayCard() {
  if (_holidayFetched) { renderHolidayCard(); return; }
  try {
    // Holiday List RLS policy is on 'anon' role — always use anon key (not user JWT)
    const anonHdrs = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}`, 'Accept': 'application/json' };
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Holiday%20List?select=*&order=Date.asc`,
      { headers: anonHdrs }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _holidayAllData = await res.json();
    _holidayFetched = true;
  } catch(e) {
    document.getElementById('holidayLoading').innerHTML =
      `<span style="color:var(--accent3);">⚠️ Failed to load holiday data. (${e.message})</span>`;
    return;
  }
  renderHolidayCard();
}

function _holLocClass(loc) {
  const l = (loc||'').toLowerCase();
  if (l.includes('goa'))       return 'hol-branch-goa';
  if (l.includes('bangalore') || l.includes('bengaluru')) return 'hol-branch-bangalore';
  if (l.includes('gujarat'))   return 'hol-branch-gujarat';
  if (l.includes('mumbai'))    return 'hol-branch-mumbai';
  return 'hol-branch-all';
}

function _holNormLoc(loc) {
  const l = (loc||'').toLowerCase().trim();
  if (l.includes('goa'))       return 'Goa';
  if (l.includes('bangalore') || l.includes('bengaluru')) return 'Bangalore';
  if (l.includes('gujarat') || l.includes('surat') || l.includes('ahmedabad')) return 'Gujarat';
  if (l.includes('mumbai') || l.includes('head office')) return 'Mumbai';
  return loc || 'All';
}

function renderHolidayCard(branchFilter) {
  const isOwner = CURRENT_USER && (CURRENT_USER.role === 'owner' ||
    ['managing director','mis','pc','executive assistant','ea'].includes((CURRENT_USER.rawRole||'').toLowerCase()));

  // Show branch tabs for Managing Director/mis/pc
  const tabsEl = document.getElementById('holidayBranchTabs');
  if (isOwner) tabsEl.style.display = 'flex';

  // Determine which location to show
  const empLoc = _holNormLoc(
    (CURRENT_USER && CURRENT_USER.location) ? CURRENT_USER.location : 'Mumbai'
  );

  // Badge
  const badgeEl = document.getElementById('holidayBranchBadge');
  if (isOwner) {
    const bf = branchFilter || 'Mumbai';
    badgeEl.textContent = '📍 ' + bf;
  } else {
    badgeEl.textContent = '📍 ' + empLoc;
  }

  // Filter data
  let rows = _holidayAllData;
  if (isOwner) {
    const bf = branchFilter || 'Mumbai';
    rows = rows.filter(r => _holNormLoc(r['Location']) === bf);
  } else if (!isOwner) {
    // Employee: sirf apni location ke holidays
    rows = rows.filter(r => {
      const rl = _holNormLoc(r['Location']);
      return rl === empLoc;
    });
  }

  // Sort by date
  rows = [...rows].sort((a,b) => new Date(a['Date']) - new Date(b['Date']));

  // Build table
  const today = new Date();
  today.setHours(0,0,0,0);
  let nextHol = null;

  const tbody = document.getElementById('holidayTbody');
  if (!rows.length) {
    tbody.innerHTML = '';
    document.getElementById('holidayLoading').style.display = 'none';
    document.getElementById('holidayTableWrap').style.display = 'none';
    document.getElementById('holidayEmpty').style.display = 'block';
    document.getElementById('nextHolidayBanner').style.display = 'none';
    return;
  }

  let html = '';
  let sr = 1;
  rows.forEach(r => {
    const hDate = new Date(r['Date']);
    hDate.setHours(0,0,0,0);
    const diff = Math.round((hDate - today) / 86400000);
    let statusClass, statusLabel, rowClass = 'hol-row';

    if (diff < 0) {
      statusClass = 'hol-status-past'; statusLabel = 'Past'; rowClass += ' past';
    } else if (diff === 0) {
      statusClass = 'hol-status-today'; statusLabel = '🎉 Today!'; rowClass += ' today';
    } else {
      statusClass = 'hol-status-upcoming'; statusLabel = 'Upcoming';
      if (!nextHol) nextHol = { ...r, diff };
    }

    const locNorm = _holNormLoc(r['Location']);
    const locClass = _holLocClass(r['Location']);
    const dateStr = hDate.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    html += `<tr class="${rowClass}">
      <td style="padding:9px 12px;color:var(--muted);font-size:0.78rem;">${sr++}</td>
      <td style="padding:9px 12px;font-weight:600;color:var(--text);">${r['Holiday']||'—'}</td>
      <td style="padding:9px 12px;color:var(--text2);white-space:nowrap;">${dateStr}</td>
      <td style="padding:9px 12px;color:var(--text2);">${r['Day']||'—'}</td>
      <td style="padding:9px 12px;"><span class="hol-branch-pill ${locClass}">${locNorm}</span></td>
      <td style="padding:9px 12px;"><span class="hol-status-badge ${statusClass}">${statusLabel}</span></td>
    </tr>`;
  });

  tbody.innerHTML = html;
  document.getElementById('holidayLoading').style.display = 'none';
  document.getElementById('holidayTableWrap').style.display = 'block';
  document.getElementById('holidayEmpty').style.display = 'none';

  // Next holiday banner
  if (nextHol) {
    const nd = new Date(nextHol['Date']);
    const dateStr2 = nd.toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
    document.getElementById('nextHolName').textContent = nextHol['Holiday'];
    document.getElementById('nextHolMeta').textContent = `${nextHol['Day']}, ${dateStr2} • ${_holNormLoc(nextHol['Location'])}`;
    document.getElementById('nextHolDays').textContent = nextHol.diff;
    document.getElementById('nextHolidayBanner').style.display = 'flex';
  } else {
    document.getElementById('nextHolidayBanner').style.display = 'none';
  }
}

function filterHolidayBranch(branch) {
  // Update active tab
  document.querySelectorAll('.hol-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.branch === branch);
  });
  renderHolidayCard(branch);
}

// Auto-load when home panel is shown
(function() {
  const _origShowPortal = typeof showPortal === 'function' ? showPortal : null;
  // Hook into panel navigation
  const _origNavClick = typeof navClick === 'function' ? navClick : null;
  // Watch for home panel visibility
  const _homeObs = new MutationObserver(() => {
    const hp = document.getElementById('panel-home');
    if (hp && hp.classList.contains('active')) {
      if (!_holidayFetched && typeof SUPABASE_URL !== 'undefined') {
        loadHolidayCard();
      }
    }
  });
  const hpEl = document.getElementById('panel-home');
  if (hpEl) {
    _homeObs.observe(hpEl, { attributes: true, attributeFilter: ['class'] });
  }
  // Also try on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (typeof SUPABASE_URL !== 'undefined' && typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
          loadHolidayCard();
        }
      }, 1500);
    });
  } else {
    setTimeout(() => {
      const hp2 = document.getElementById('panel-home');
      if (hp2 && hp2.classList.contains('active') && typeof SUPABASE_URL !== 'undefined') {
        if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) loadHolidayCard();
      }
    }, 1500);
  }
})();

// Also expose so showPortal can call it
function maybeLoadHolidayCard() {
  if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && typeof SUPABASE_URL !== 'undefined') {
    loadHolidayCard();
  }
}

function openHolidayOverlay() {
  _actOnCardOpen('Holiday List'); // ACTIVITY TRACKING
  const overlay = document.getElementById('holidayOverlay');
  if (overlay) {
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && typeof SUPABASE_URL !== 'undefined') {
      loadHolidayCard();
    }
  }
}

function closeHolidayOverlay() {
  _actOnCardClose(); // ACTIVITY TRACKING
  const overlay = document.getElementById('holidayOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Close holiday overlay on backdrop click
document.addEventListener('DOMContentLoaded', function() {
  const hOverlay = document.getElementById('holidayOverlay');
  if (hOverlay) {
    hOverlay.addEventListener('click', function(e) {
      if (e.target === hOverlay) closeHolidayOverlay();
    });
  }
});
