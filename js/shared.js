// ═══════════════════════════════════════════════════════════════
// SHARED / CROSS-CUTTING UTILITIES
// Functions and objects used by 2+ department files (not specific
// to one feature). Examples: Content Nodes (CN) system, shared
// overlay renderers.
// ═══════════════════════════════════════════════════════════════

// ╔══════════════════════════════════════════════════════════════════════════
// ║  [CONTENT NODES SYSTEM] — Universal CMS for all department panels
// ║  Yeh system HR, Sales, After Sales, Products, IT Admin, Resources etc.
// ║  sab ke cards/files manage karta hai
// ║  Tables:
// ║    content_nodes : sections aur categories (id, name, type, parent_id)
// ║    files         : uploaded files (id, node_id FK, name, url)
// ║  CN object = central data store + loading logic
// ║  Naya section ya category add karna ho toh Supabase mein content_nodes
// ║  table mein row add karo — code automatically pick kar lega
// ╚══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// CONTENT NODES — Universal CMS (content_nodes + files tables)
// Tables:
//   content_nodes : id, name, type (section/category), parent_id
//   files         : id, node_id (FK → content_nodes.id), name, url
// ═══════════════════════════════════════════════════════════════════════════
const CN = {
  nodes: [],      // all content_nodes rows
  files: [],      // all files rows
  loaded: false,
  loading: false,
  callbacks: [],

  _hdrs() {
    return SB_HDRS();
  },

  // ── Flexible column getter ───────────────────────────────────────────
  _get(row, ...names) {
    const keys = Object.keys(row);
    for (const n of names) {
      const k = keys.find(k => k.toLowerCase() === n.toLowerCase());
      if (k !== undefined && row[k] !== null && row[k] !== undefined) return String(row[k]).trim();
    }
    return '';
  },

  // ── Fetch both tables ────────────────────────────────────────────────
  async load() {
    // ✅ Smart reset: agar pehle load empty aaya tha (anon token se) toh dobara fetch karo
    if (this.loaded && this.nodes.length === 0) {
      this.loaded = false;
    }
    if (this.loaded) return;
    if (this.loading) return new Promise(res => this.callbacks.push(res));
    this.loading = true;
    try {
      const [nodesRes, filesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/content_nodes?select=*&order=id.asc`, { headers: this._hdrs() }),
        fetch(`${SUPABASE_URL}/rest/v1/files?select=*&order=id.asc`,         { headers: this._hdrs() })
      ]);
      if (!nodesRes.ok) throw new Error('content_nodes: HTTP ' + nodesRes.status);
      if (!filesRes.ok) throw new Error('files: HTTP ' + filesRes.status);
      this.nodes = await nodesRes.json();
      this.files = await filesRes.json();
      this.loaded = true;
    } catch(e) {
      throw e;
    } finally {
      this.loading = false;
      this.callbacks.splice(0).forEach(cb => cb());
    }
  },

  // ── Get all sections (type = section) ───────────────────────────────
  getSections() {
    return this.nodes.filter(n => (n.type || n.Type || '').toLowerCase() === 'section');
  },

  // ── Get a section by name (case-insensitive) ─────────────────────────
  getSection(name) {
    return this.nodes.find(n =>
      (n.type || n.Type || '').toLowerCase() === 'section' &&
      (n.name || n.Name || '').trim().toLowerCase() === name.trim().toLowerCase()
    );
  },

  // ── Get direct children categories of a parent id ───────────────────
  getCategories(parentId) {
    return this.nodes.filter(n => {
      const pid = n.parent_id !== undefined ? n.parent_id : n.Parent_id;
      return String(pid) === String(parentId);
    });
  },

  // ── Get files for a node id ──────────────────────────────────────────
  getFiles(nodeId) {
    return this.files.filter(f => {
      const nid = f.node_id !== undefined ? f.node_id
                : f.Node_id !== undefined ? f.Node_id
                : f.content_node_id !== undefined ? f.content_node_id
                : null;
      return String(nid) === String(nodeId);
    }).map(f => ({
      id:   f.id,
      name: this._get(f, 'name', 'title', 'file_name', 'Doc_Name') || 'Document',
      url:  this._get(f, 'file_url', 'url', 'link', 'Doc_Link', 'file_link')
    }));
  },

  // ── Node name → node obj ─────────────────────────────────────────────
  getNodeById(id) {
    return this.nodes.find(n => String(n.id) === String(id));
  },

  // ── All files count for a node (including children) ──────────────────
  totalFiles(nodeId) {
    const direct = this.getFiles(nodeId).length;
    const kids   = this.getCategories(nodeId).reduce((s, c) => s + this.getFiles(c.id).length, 0);
    return direct + kids;
  }
};

// ── Section colour themes ────────────────────────────────────────────────
const CN_SECTION_THEMES = {
  default: [
    { color:'#00d4ff', bg:'rgba(0,212,255,0.12)',  border:'rgba(0,212,255,0.3)'  },
    { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)'  },
    { color:'#00d4aa', bg:'rgba(0,212,170,0.12)',  border:'rgba(0,212,170,0.3)'  },
    { color:'#a855f7', bg:'rgba(168,85,247,0.12)', border:'rgba(168,85,247,0.3)' },
    { color:'#f97316', bg:'rgba(249,115,22,0.12)', border:'rgba(249,115,22,0.3)' },
    { color:'#e879f9', bg:'rgba(232,121,249,0.12)',border:'rgba(232,121,249,0.3)'},
    { color:'#22c55e', bg:'rgba(34,197,94,0.12)',  border:'rgba(34,197,94,0.3)'  },
    { color:'#0ea5e9', bg:'rgba(14,165,233,0.12)', border:'rgba(14,165,233,0.3)' },
  ]
};

function cnTheme(i) {
  const t = CN_SECTION_THEMES.default;
  return t[i % t.length];
}

// ── Generic category grid renderer ───────────────────────────────────────
// ── Role helper — sirf MIS ko manage karne ka haq hai ───────────────────
function _isMIS() {
  return PERMISSIONS.can_upload_files === 'true';
}

// ── Card descriptions — naam se description milta hai ────────────────────
const CN_CARD_DESCRIPTIONS = {
  // ── HR ──
  'sop':                      'Standard Operating Procedures — step-by-step documented processes to ensure consistent and efficient operations.',
  'mediclaim':                'Employee health insurance documents — claim forms, policy details, coverage information and reimbursement guidelines.',
  'hr policy':                'Company HR policies — leave rules, attendance guidelines, code of conduct and employee benefits information.',
  'organization chart':       'Complete team structure of Aditi Tracking — departments, roles and reporting hierarchy across all offices.',
  'directory':                'Employee, Support & Vendor directories — contacts, roles and resources all in one place.',
  'branch office':            'Branch office details — location, contacts, team structure and operational information for all branches.',
  'holiday list':             'Company holiday calendar — upcoming holidays, branch-wise list and next holiday countdown.',

  // ── Sales ──
  'target audience':          'Customer profiles and segmentation — understand who to target, buyer personas and effective approach strategies.',
  'qualify leads':            'Lead qualification framework and SQL criteria — know when a prospect is truly ready to buy.',
  'sales pitch':              'Ready-to-use pitch scripts and presentation decks — present Aditi Tracking value proposition with confidence.',
  'objection handling':       'Common objections and proven responses — turn customer hesitations into opportunities and close more deals.',
  'intro and follow up':      'Introduction scripts and follow-up message templates — make the right first impression and stay top of mind.',
  'intro & follow-up':        'Introduction scripts and follow-up message templates — make the right first impression and stay top of mind.',

  // ── After Sales ──
  'api docs':                 'Technical API documentation — integration guides, endpoint references and developer resources for Aditi systems.',
  'hardware configuration':   'Hardware setup and configuration guides — device installation, calibration, troubleshooting and maintenance steps.',

  // ── Training ──
  'mis training':             'Management Information System training — reports, dashboards, data analysis and MIS workflows for the team.',
  'odoo training':            'Odoo ERP system training — modules, workflows, daily operations and best practices across all departments.',
  'pc training':              'Process Coordinator training — coordination workflows, closing procedures and client follow-up best practices.',
  'click task training':      'Click Task app training — task creation, assignments, tracking and completion workflows for field teams.',
  'cool bus training':        'Cool Bus operations training — booking management, customer service and operational procedures.',
  'smart fleet training':     'Smart Fleet monitoring training — GPS tracking, fleet operations, alerts and reporting dashboards.',
  'pre-sales training':       'Pre-Sales process training — lead handling, CRM pipeline management and opportunity conversion techniques.',

  // ── IT & Admin ──
  'company docs & certifications': 'ISO certificates, company registrations, GST, EPFO, ESIC, NSIC and all official government documents.',
  'company docs and certifications': 'ISO certificates, company registrations, GST, EPFO, ESIC, NSIC and all official government documents.',
  "nda's":                    'Non-Disclosure Agreements — confidential contracts with employees, clients and business partners.',
  'ndas':                     'Non-Disclosure Agreements — confidential contracts with employees, clients and business partners.',
  '2025 iso certificates':    'Latest ISO certification documents — quality management and compliance certificates valid for 2025.',
  'company docs':             'Core company documents — registrations, licences and official records.',
  'gst epfo esic certification': 'GST, EPFO & ESIC statutory compliance certificates and related government filings.',
  'nsic certificate 25-27':   'National Small Industries Corporation certificate — valid 2025 to 2027.',
  'prof tax & certificate':   'Professional tax registration and related compliance certificates.',

  // ── Finance ──
  'invoices':                 'Client and vendor invoices — billing records, payment status and invoice tracking.',
  'budgets':                  'Annual and quarterly budget documents — expense plans, allocations and financial targets.',
  'reports':                  'Financial reports — monthly P&L, balance sheets and expense summaries.',
  'expenses':                 'Company expense records — reimbursements, petty cash and department-wise spending.',

  // ── Compliance ──
  'legal':                    'Legal documents — contracts, agreements and regulatory compliance filings.',
  'licenses':                 'Company licences and permits — trade licences, operating permits and renewal records.',
  'audits':                   'Audit reports and compliance checklists — internal and external audit documentation.',

  // ── Referral ──
  'referral policy':          'Employee referral programme policy — eligibility, reward structure and referral submission process.',
  'referral forms':           'Referral submission forms and tracking sheets for the employee referral programme.',
};

// ── Get description for a card name (case-insensitive match) ──────────────
function getCNCardDesc(name) {
  const key = (name || '').trim().toLowerCase();
  if (CN_CARD_DESCRIPTIONS[key]) return CN_CARD_DESCRIPTIONS[key];
  // Partial match fallback
  for (const k of Object.keys(CN_CARD_DESCRIPTIONS)) {
    if (key.includes(k) || k.includes(key)) return CN_CARD_DESCRIPTIONS[k];
  }
  // Smart generic fallback based on keywords
  if (key.includes('training') || key.includes('video')) return `${name} training materials — videos, guides and learning resources for the team.`;
  if (key.includes('policy') || key.includes('policies')) return `${name} — guidelines, rules and procedures to follow.`;
  if (key.includes('report') || key.includes('mis')) return `${name} — reports, data and analysis documents.`;
  if (key.includes('form') || key.includes('template')) return `${name} — ready-to-use templates and forms.`;
  if (key.includes('doc') || key.includes('cert')) return `${name} — official documents and certificates.`;
  return `${name} — all related files, documents and resources in one place.`;
}

function cnRenderCatGrid(gridEl, categories, loadingEl, errorEl, overlayFn) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (!categories.length) {
    if (errorEl) { errorEl.style.display='block'; errorEl.innerHTML='<div style="text-align:center;padding:32px 16px;color:var(--muted);">No categories found.</div>'; }
    return;
  }
  gridEl.innerHTML = categories.map((cat, i) => {
    const th    = cnTheme(i);
    const name  = cat.name || cat.Name || 'Category';
    const count = CN.totalFiles(cat.id);
    const safe  = name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const delBtn = _isMIS() ? `<button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete card"
        style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
        onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>` : '';
    return `
    <div style="position:relative;">
      ${delBtn}
    <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
         onclick="${overlayFn}(${cat.id}, '${safe}')"
         onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
         onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
      <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <div class="hc-name">${name}</div>
      <div class="hc-desc" style="font-size:0.88rem;line-height:1.55;color:var(--muted);">${getCNCardDesc(name)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
        <span class="hc-status live" style="background:${th.bg};color:${th.color};border:1px solid ${th.border};">📂 ${count} file${count===1?'':'s'}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${th.color};">View →</span>
      </div>
    </div></div>`;
  }).join('');
  gridEl.style.display = 'grid';
}

// ── Generic file overlay opener ───────────────────────────────────────────
function cnOpenOverlay(nodeId, catName, overlayId, titleId, subId, gridId, loaderId, emptyId) {
  const i   = CN.nodes.indexOf(CN.getNodeById(nodeId));
  const th  = cnTheme(Math.max(0, i) % 8);

  document.getElementById(titleId).textContent   = catName;
  if (loaderId) document.getElementById(loaderId).style.display = 'none';
  document.getElementById(emptyId).style.display  = 'none';
  document.getElementById(overlayId).style.display = 'block';
  document.body.style.overflow = 'hidden';

  _cnRenderOverlayContent(nodeId, catName, th, gridId, subId, emptyId, null);
}

// ── Render overlay content: sub-cards + files ────────────────────────────
function _cnRenderOverlayContent(nodeId, catName, th, gridId, subId, emptyId, parentInfo) {
  const subCards = CN.getCategories(nodeId);
  const files    = CN.getFiles(nodeId);
  const grid     = document.getElementById(gridId);
  const subEl    = document.getElementById(subId);

  const totalItems = subCards.length + files.length;
  subEl.textContent = (subCards.length ? subCards.length + ' sub-card' + (subCards.length>1?'s':'') + (files.length?' · ':'') : '') +
                      (files.length ? files.length + ' file' + (files.length>1?'s':'') : '') ||
                      '0 items';

  // Update video count badge in the split overlay header
  const vcEl = document.getElementById('mktVideoCount');
  if (vcEl) vcEl.textContent = totalItems ? `${totalItems} item${totalItems>1?'s':''}` : '';
  // Hide loader
  const loaderEl = document.getElementById('mktOverlayLoader');
  if (loaderEl) loaderEl.style.display = 'none';

  if (!totalItems) {
    document.getElementById(emptyId).style.display = 'block';
    grid.innerHTML = parentInfo ? `<div style="grid-column:1/-1;margin-bottom:8px;">
      <button onclick="_cnNavBack_${gridId}()" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:0.83rem;font-weight:600;font-family:inherit;">← Back</button>
    </div>` : '';
    return;
  }

  // Back button if navigated into a sub-card
  const backBtn = parentInfo ? `<div style="grid-column:1/-1;margin-bottom:8px;">
    <button onclick="_cnNavBack_${gridId}()" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:0.83rem;font-weight:600;font-family:inherit;">← Back to ${parentInfo.name}</button>
  </div>` : '';

  // Sub-card tiles
  const subCardHtml = subCards.map((sc, si) => {
    const scTh    = cnTheme(si);
    const scName  = sc.name || sc.Name || 'Sub-card';
    const scCount = CN.totalFiles(sc.id);
    const scSafe  = scName.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `
    <div style="position:relative;">
      ${_isMIS() ? `<button onclick="event.stopPropagation();confirmDeleteCard(${sc.id},'${scSafe}')" title="Delete sub-card"
        style="position:absolute;top:8px;right:8px;z-index:3;width:24px;height:24px;border-radius:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
        onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>` : ''}
      <div onclick="_cnDrillDown_${gridId}(${sc.id},'${scSafe}',${nodeId},'${catName.replace(/'/g,"\\'")}')"
        style="background:var(--surface2);border:1.5px solid ${scTh.border};border-left:4px solid ${scTh.color};border-radius:12px;padding:14px 14px 14px 16px;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:12px;"
        onmouseover="this.style.background='${scTh.bg}';this.style.borderColor='${scTh.color}'"
        onmouseout="this.style.background='var(--surface2)';this.style.borderColor='${scTh.border}'">
        <div style="width:38px;height:38px;min-width:38px;border-radius:10px;background:${scTh.bg};border:1px solid ${scTh.border};display:flex;align-items:center;justify-content:center;color:${scTh.color};">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.93rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${scName}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">📂 ${scCount} file${scCount===1?'':'s'}</div>
        </div>
        <span style="color:${scTh.color};font-weight:700;font-size:1rem;flex-shrink:0;">→</span>
      </div>
    </div>`;
  }).join('');

  // Direct files
  const filesHtml = files.map(f => renderOverlayCard(f.name, f.url, th, f.id)).join('');

  // Section label if both sub-cards and files exist
  const subLabel  = subCards.length ? `<div style="grid-column:1/-1;font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">📂 Sub-Cards</div>` : '';
  const fileLabel = (subCards.length && files.length) ? `<div style="grid-column:1/-1;font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:8px;margin-bottom:2px;">📄 Files</div>` : '';

  grid.innerHTML = backBtn + subLabel + subCardHtml + fileLabel + filesHtml;

  // Attach drill-down and back functions dynamically
  window[`_cnDrillDown_${gridId}`] = function(scId, scName, parentId, parentName) {
    // training_submodule_open removed — module_open is sufficient
    const scTh = cnTheme(subCards.findIndex(s => s.id === scId) % 8);
    _cnRenderOverlayContent(scId, scName, scTh, gridId, subId, emptyId, {id: parentId, name: parentName});
  };
  // Back: if parentInfo exists go UP to the parent node, else stay at top
  window[`_cnNavBack_${gridId}`] = function() {
    if (parentInfo) {
      // parentInfo is {id, name} of the card that contains the current sub-cards
      // Going back means rendering parentInfo's node with NO further parentInfo (top level)
      _cnRenderOverlayContent(parentInfo.id, parentInfo.name, th, gridId, subId, emptyId, null);
    } else {
      _cnRenderOverlayContent(nodeId, catName, th, gridId, subId, emptyId, null);
    }
  };
}
