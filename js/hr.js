// Section: HR Panel (loadHRSection, Mediclaim upload)
let hrSectionLoaded = false;

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

