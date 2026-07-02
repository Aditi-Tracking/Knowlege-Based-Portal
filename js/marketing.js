// Section: Marketing (loadMarketingCounts)
async function loadMarketingCounts() {
  if (marketingInitLoaded) return;
  marketingInitLoaded = true;
  try {
    await CN.load();
    const section = CN.getSection('Marketing');
    if (!section) return;
    const cats = CN.getCategories(section.id);

    // Map known hardcoded card names to badge IDs
    const badgeMap = {
      'marketing brochure': 'mkt-brochure-count',
      'solution videos':    'mkt-solution-count',
      'short explainer':    'mkt-explainer-count',
    };

    // Update badge counts for hardcoded cards
    cats.forEach(cat => {
      const key = (cat.name || '').toLowerCase().trim();
      const bid = badgeMap[key];
      if (bid) {
        const el = document.getElementById(bid);
        const count = CN.totalFiles(cat.id);
        if (el) el.textContent = '📂 ' + count + ' file' + (count===1?'':'s');
      }
    });

    // Store cats for overlay use
    window._cnMktCats = cats;

    // ── Render NEW dynamic cards (not in hardcoded set) ──────────────────
    const hardcoded = new Set(Object.keys(badgeMap));
    const newCats = cats.filter(c => !hardcoded.has((c.name||'').toLowerCase().trim()));
    const mainGrid = document.getElementById('mkt-main-grid');

    if (newCats.length && mainGrid) {
      newCats.forEach((cat, i) => {
        const th    = cnTheme(i);
        const name  = cat.name || 'Category';
        const count = CN.totalFiles(cat.id);
        const safe  = name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.innerHTML = `
          ${_isMIS() ? `          <button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete card"
            style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
            onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>` : ''}
          <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
            onclick="cnOpenMktDynOverlay(${cat.id},'${safe}')"
            onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
            onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
            <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div class="hc-name">${name}</div>
            <div class="hc-desc" style="font-size:0.88rem;color:var(--muted);line-height:1.55;">${getCNCardDesc(name)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
              <span class="hc-status live" style="background:${th.bg};color:${th.color};border:1px solid ${th.border};">📂 ${count} file${count===1?'':'s'}</span>
              <span style="font-size:0.78rem;font-weight:600;color:${th.color};">View →</span>
            </div>
          </div>`;
        mainGrid.appendChild(wrapper);
      });
    }

    // Inject delete buttons on hardcoded marketing cards
    injectDeleteBtns('Marketing', document.querySelector('#panel-marketing .db-content'));
  } catch(e) {
  }
}

function cnOpenMktDynOverlay(nodeId, catName) {
  _hideAssessmentTab(); // Marketing — Assessment tab nahi dikhana
  switchMktTab('videos');
  cnOpenOverlay(nodeId, catName, 'marketingOverlay', 'mktOverlayTitle', 'mktOverlaySub',
                'mktOverlayGrid', 'mktOverlayLoader', 'mktOverlayEmpty');
}

async function openMarketingOverlay(category) {
  const th = MKT_CAT_THEME[category] || MKT_THEME;
  const iconEl = document.getElementById('mktOverlayIcon');
  if (iconEl) {
    iconEl.style.background  = th.bg;
    iconEl.style.borderColor = th.border;
    iconEl.innerHTML = `<span style="font-size:1.4rem;">${th.icon}</span>`;
  }
  document.getElementById('mktOverlayTitle').textContent     = category;
  document.getElementById('mktOverlaySub').textContent       = '';
  document.getElementById('mktOverlayLoader').style.display  = 'block';
  document.getElementById('mktOverlayGrid').innerHTML        = '';
  document.getElementById('mktOverlayEmpty').style.display   = 'none';
  document.getElementById('marketingOverlay').style.display  = 'block';
  document.body.style.overflow = 'hidden';
  _hideAssessmentTab(); // Marketing — Assessment tab nahi dikhana
  switchMktTab('videos');

  try {
    await CN.load();
    const section = CN.getSection('Marketing');
    const cats    = section ? CN.getCategories(section.id) : [];
    const cat     = cats.find(c => (c.name||'').trim().toLowerCase() === category.trim().toLowerCase());
    document.getElementById('mktOverlayLoader').style.display = 'none';
    if (!cat) {
      document.getElementById('mktOverlayEmpty').style.display = 'block';
      return;
    }
    // Use shared renderer — handles sub-cards + direct files
    _cnRenderOverlayContent(cat.id, category, th, 'mktOverlayGrid', 'mktOverlaySub', 'mktOverlayEmpty', null);
  } catch(e) {
    document.getElementById('mktOverlayLoader').style.display = 'none';
    const ee = document.getElementById('mktOverlayEmpty');
    if (ee) { ee.style.display='block'; ee.textContent='Failed to load: ' + e.message; }
  }
}

function renderMarketingDocs(items, th) {
  document.getElementById('mktOverlayLoader').style.display = 'none';
  document.getElementById('mktOverlaySub').textContent = items.length + ' file' + (items.length === 1 ? '' : 's');
  if (!items.length) {
    document.getElementById('mktOverlayEmpty').style.display = 'block';
    return;
  }
  const grid = document.getElementById('mktOverlayGrid');
  grid.innerHTML = items.map(row => {
    const name = (row.Module || 'Document').trim();
    const link = (row.Link   || '').trim();
    return renderOverlayCard(name, link, th);
  }).join('');
}

function closeMarketingOverlay() {
  document.getElementById('marketingOverlay').style.display = 'none';
  document.body.style.overflow = '';
  const qBtn = document.getElementById('mkt-overlay-quiz-btn');
  if (qBtn) qBtn.remove();
}

// Wrapper called from overlay quiz cards — closes overlay first then starts quiz
function startDBQuizFromOverlay(quizId) {
  closeMarketingOverlay();
  // Small delay so overlay closes before quiz overlay opens
  setTimeout(() => startDBQuiz(quizId), 80);
}

// Wrapper for My Results from overlay — closes overlay first
function openMyResultsFromOverlay(nodeId) {
  closeMarketingOverlay();
  setTimeout(() => openMyQuizResults(nodeId), 80);
}

// ═══════════════════════════════════════════════════════════
// PRODUCTS PANEL — Supabase Videos Only
// ═══════════════════════════════════════════════════════════
let prodLoaded = false;

// ── Generic CN panel loader (Finance / Compliance / Referral) ─────────────
// Loads content_nodes cards for a section name into a standard panel layout.
const _simplePanelLoaded = {};
