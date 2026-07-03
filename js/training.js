// Section: Training & Quiz System (loadTrainingSection, DB quizzes, grading, admin)
function _canUploadQuiz() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  return PERMISSIONS.can_upload_quiz === 'true';
}

// ── Training: load dynamic cards from content_nodes ──────────────────────
let trainingDynLoaded = false;

// Quiz function map — card name (lowercase) → quiz function call string
const TRAINING_QUIZ_MAP = {
  'mis training':         `openMISQuizMenu()`,
  'odoo training':        `openOdooModuleSelect()`,
  'pc training':          `openModuleQuiz('pc')`,
  'click task training':  `openModuleQuiz('clicktask')`,
  'cool bus training':    `openModuleQuiz('coolbus')`,
  'smart fleet training': `openModuleQuiz('smartfleet')`,
};
let misVideosData = [];

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

// ── Fetch MIS videos from content_nodes + files tables ──
async function fetchMISVideos() {
  const cardsEl = document.getElementById('mis-video-cards');
  cardsEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:0.92rem;">Loading...</div>`;
  try {
    await CN.load();
    const section = CN.getSection('Training');
    const cat = section
      ? CN.getCategories(section.id).find(c => (c.name||'').toLowerCase().includes('mis'))
      : null;
    const files = cat ? CN.getFiles(cat.id) : [];
    misVideosData = files.map(f => ({ id: f.id, Title: f.name, Video_URL: f.url }));
    renderMISVideoCards(misVideosData);
  } catch(err) {
    cardsEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:0.9rem;">Failed to load videos.<br><span style="font-size:0.78rem;color:var(--muted);">${err.message}</span></div>`;
  }
}

function renderMISVideoCards(data) {
  const cardsEl = document.getElementById('mis-video-cards');
  if (!data || data.length === 0) {
    cardsEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);">No videos found.</div>`;
    return;
  }

  cardsEl.innerHTML = data.map((row, idx) => {
    const meta = getMISVideoMeta(row.Title);
    const safeTitle = (row.Title||'').toLowerCase().replace(/"/g,'&quot;');
    const rowId = row.id || row.ID || '';
    const delBtnHtml = rowId ? `<button onclick="event.stopPropagation();confirmDeleteTrainingVideo(${rowId},'${safeTitle}',null)" title="Delete video"
      style="width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
      onmouseover="this.style.background='rgba(239,68,68,0.28)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
    </button>` : '';
    return `
      <div data-vtitle="${safeTitle}" onclick="playMISVideo(${idx})"
           style="cursor:pointer;padding:16px;border-radius:12px;border:1.5px solid ${meta.color}44;background:${meta.color}12;transition:all 0.18s;"
           onmouseover="this.style.borderColor='${meta.color}bb';this.style.background='${meta.color}22'"
           onmouseout="this.style.borderColor='${meta.color}44';this.style.background='${meta.color}12'">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:48px;height:48px;border-radius:10px;background:${meta.color}28;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">${meta.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:var(--text);font-size:1.00rem;">${row.Title}</div>
            <div style="font-size:0.81rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Training Video</div>
          </div>
          ${delBtnHtml}
          <div style="width:36px;height:36px;border-radius:50%;background:${meta.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:0.85rem;margin-left:2px;">▶</span>
          </div>
        </div>
      </div>`;
  }).join('');
  // Re-apply search filter if user already typed something before re-render
  if (typeof filterMISVideos === 'function') filterMISVideos();
}

// ── Play video by index ──
function playMISVideo(idx) {
  const row  = misVideosData[idx];
  if (!row) return;
  const meta = getMISVideoMeta(row.Title);

  document.getElementById('mis-video-title').textContent    = `${meta.icon} ${row.Title}`;
  document.getElementById('mis-video-subtitle').textContent = 'Training Video';
  document.getElementById('mis-video-desc').textContent     = meta.desc;

  const videoEl = document.getElementById('mis-main-video');
  pauseAllVideosExcept('mis-main-video');
  videoEl.src = row.Video_URL;   // direct URL from DB column
  videoEl.load();

  document.getElementById('mis-video-list').style.display   = 'none';
  document.getElementById('mis-video-player').style.display = 'block';
}

function backToMISVideoList() {
  const v = document.getElementById('mis-main-video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  document.getElementById('mis-video-player').style.display = 'none';
  document.getElementById('mis-video-list').style.display   = 'block';
}

/* ═══════════════════════════════════════════
   OTHER MODULE QUIZZES (Odoo, PC, Click Task, Cool Bus, Smart Fleet)
═══════════════════════════════════════════ */

const MODULE_QUIZZES = {
  presales: {
    title: 'Pre-Sales Training',
    subtitle: 'Pre-Sales Process',
    color: '#e879f9',
    icon: '🤝',
    supabaseModule: 'Pre-Sales',
    driveUrl: 'https://drive.google.com/drive/folders/',
    questions: []
  },
  odoo: {
    title: 'Odoo Quiz',
    subtitle: 'Odoo ERP System',
    color: '#00d4ff',
    icon: '🔷',
    supabaseModule: 'Odoo',
    driveUrl: 'https://drive.google.com/drive/folders/187nbxRXlOR2D-HpIlhAN3lJRu8tv66qC',
    questions: []
  },
  pc: {
    title: 'PC Training Quiz',
    subtitle: 'Process Coordinator',
    color: '#00d4aa',
    icon: '💼',
    supabaseModule: 'PC',
    driveUrl: 'https://drive.google.com/drive/folders/1dhF8EERqrulmyBh7hIUMGOg9ppLTEHKD',
    questions: []
  },
  clicktask: {
    title: 'Click Task Quiz',
    subtitle: 'Click Task App',
    color: '#a855f7',
    icon: '✔️',
    supabaseModule: 'Click Task',
    driveUrl: 'https://drive.google.com/drive/folders/1ojAyM6eGOm7xZ2eVzmn7d2vu-ZrPuglO',
    questions: []
  },
  coolbus: {
    title: 'Cool Bus Quiz',
    subtitle: 'Cool Bus Operations',
    color: '#f97316',
    icon: '🚌',
    driveUrl: 'https://drive.google.com/drive/folders/10HnwdiyB3AKUcOatkmSXrdw1hf8Nrbf3',
    questions: []
  },
  smartfleet: {
    title: 'Smart Fleet Quiz',
    subtitle: 'Smart Fleet System',
    color: '#22c55e',
    icon: '🚛',
    supabaseModule: 'Smart Fleet',
    driveUrl: 'https://drive.google.com/drive/folders/1dMDdfvZRwoneI0YDYlQ9mYoNttiNSHaW',
    questions: []
  }
};

let moduleQuizActive = null;
let moduleQuizQIndex = 0;
let moduleQuizAnswers = [];
let moduleQuizCurrentKey = null;

/* ═══════════════════════════════════════════
   ODOO MODULE-WISE VIDEO SYSTEM
═══════════════════════════════════════════ */
const ODOO_SUB_MODULES = [
  { key: 'purchase',   label: 'Purchase',       icon: '🛒', color: '#f97316', desc: 'Vendor orders, RFQ, purchase orders and procurement management.' },
  { key: 'sales',      label: 'Pre Sales',       icon: '🤝', color: '#e879f9', desc: 'Pre-Sales process — lead handling, demos, proposals and client communication.', moduleOverride: 'Pre Sales' },
  { key: 'inventory',  label: 'Inventory',      icon: '📦', color: '#3b82f6', desc: 'Stock management, warehouse operations and product transfers.' },
  { key: 'accounting', label: 'Accounting',     icon: '💳', color: '#a855f7', desc: 'Invoices, payments, journal entries and financial reports.' },
  { key: 'crm',        label: 'CRM',            icon: '🤝', color: '#e879f9', desc: 'Customer pipeline, leads, opportunities and follow-ups.' },
  { key: 'pos',        label: 'Point of Sale',  icon: '🏪', color: '#f0a500', desc: 'Retail counter sales and POS session management.' },
  { key: 'hr',         label: 'HR',             icon: '👥', color: '#00d4aa', desc: 'Employee records, attendance, leaves and payroll.' },
  { key: 'all',        label: 'All Videos',     icon: '🎬', color: '#00d4ff', desc: 'All Odoo training videos in one place.' },
];

// Videos data store for each odoo sub-module
const odooSubModuleVideosData = {};

function openOdooModuleSelect() {
  logActivity({event_type:'training_module_open',event_detail:'Opened Odoo Training',page_name:'training',card_name:'Odoo Training'});
  const ov = document.getElementById('module-quiz-overlay');
  ov.style.display = 'flex';
  const screen = document.getElementById('module-quiz-screen');
  screen.innerHTML = `
    <div style="margin-bottom:18px;display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:12px;background:rgba(0,212,255,0.15);border:1.5px solid rgba(0,212,255,0.35);display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🔷</div>
      <div>
        <div style="font-size:1.1rem;font-weight:800;color:var(--text);">Odoo Training</div>
        <div style="font-size:0.83rem;color:var(--muted);">Choose a module to watch videos</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${ODOO_SUB_MODULES.map(m => `
        <div onclick="openOdooSubModuleVideos('${m.key}')"
          style="cursor:pointer;padding:14px 16px;border-radius:12px;border:1.5px solid ${m.color}44;background:${m.color}12;display:flex;align-items:center;gap:14px;transition:all 0.18s;"
          onmouseover="this.style.borderColor='${m.color}bb';this.style.background='${m.color}22'"
          onmouseout="this.style.borderColor='${m.color}44';this.style.background='${m.color}12'">
          <div style="width:44px;height:44px;border-radius:10px;background:${m.color}28;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">${m.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:var(--text);font-size:0.96rem;">${m.label}</div>
            <div style="font-size:0.79rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.desc}</div>
          </div>
          <div style="width:32px;height:32px;border-radius:50%;background:${m.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:0.8rem;margin-left:2px;">▶</span>
          </div>
        </div>
      `).join('')}
    </div>
    <!-- Quiz Button -->
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
      <button onclick="openModuleQuiz('odoo')" style="width:100%;padding:13px;border-radius:12px;border:1.5px solid rgba(0,212,255,0.4);background:rgba(0,212,255,0.1);cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:12px;transition:all 0.18s;"
        onmouseover="this.style.borderColor='rgba(0,212,255,0.9)';this.style.background='rgba(0,212,255,0.18)'"
        onmouseout="this.style.borderColor='rgba(0,212,255,0.4)';this.style.background='rgba(0,212,255,0.1)'">
        <span style="font-size:1.4rem;">📝</span>
        <div style="flex:1;text-align:left;">
          <div style="font-weight:700;color:var(--text);font-size:0.94rem;">Odoo Quiz</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:1px;">10 Questions • Multiple Choice</div>
        </div>
        <span style="color:#00d4ff;font-size:1.1rem;">→</span>
      </button>
    </div>
  `;
}

function openOdooSubModuleVideos(subKey) {
  const sub = ODOO_SUB_MODULES.find(m => m.key === subKey);
  if (!sub) return;
  // training_submodule_open removed — module_open is sufficient
  const screen = document.getElementById('module-quiz-screen');
  screen.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <button onclick="openOdooModuleSelect()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.3rem;padding:0;line-height:1;">←</button>
      <div style="width:38px;height:38px;border-radius:10px;background:${sub.color}28;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${sub.icon}</div>
      <div>
        <div style="font-size:1.02rem;font-weight:800;color:var(--text);">${sub.label}</div>
        <div style="font-size:0.79rem;color:var(--muted);">Odoo Training Videos</div>
      </div>
    </div>
    <div style="position:relative;margin-bottom:12px;">
      <input type="text" id="odoo-sub-search-${subKey}"
        placeholder="Search videos..."
        oninput="filterOdooSubVideos('${subKey}')"
        style="width:100%;padding:10px 14px 10px 38px;border-radius:10px;border:1.5px solid ${sub.color}40;background:var(--surface2);color:var(--text);font-size:0.9rem;font-family:inherit;outline:none;transition:border-color 0.18s;box-sizing:border-box;"
        onfocus="this.style.borderColor='${sub.color}bb'" onblur="this.style.borderColor='${sub.color}40'">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${sub.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </div>
    <div id="odoo-sub-cards-${subKey}" style="display:flex;flex-direction:column;gap:10px;">
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:0.92rem;">Loading...</div>
    </div>
    <div id="odoo-sub-playerbox-${subKey}" style="display:none;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button onclick="backToOdooSubList('${subKey}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.3rem;padding:0;line-height:1;">←</button>
        <div>
          <div id="odoo-sub-vtitle-${subKey}" style="font-size:1.02rem;font-weight:800;color:var(--text);"></div>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">Odoo — ${sub.label}</div>
        </div>
      </div>
      <video id="odoo-sub-player-${subKey}" controls controlsList="nodownload noplaybackrate" disablePictureInPicture
        style="width:100%;border-radius:12px;background:#000;max-height:55vh;" preload="metadata">
        Your browser does not support the video tag.
      </video>
      <div id="odoo-sub-vdesc-${subKey}" style="margin-top:12px;font-size:0.87rem;color:var(--muted);line-height:1.65;"></div>
    </div>
  `;
  // Hide player box (cards is default)
  document.getElementById(`odoo-sub-playerbox-${subKey}`).style.display = 'none';
  fetchOdooSubVideos(subKey);
}

async function fetchOdooSubVideos(subKey) {
  const sub = ODOO_SUB_MODULES.find(m => m.key === subKey);
  const cardsEl = document.getElementById(`odoo-sub-cards-${subKey}`);
  if (!cardsEl) return;

  try {
    await CN.load();
    const section  = CN.getSection('Training');
    const odooNode = section
      ? CN.getCategories(section.id).find(c => (c.name||'').toLowerCase().includes('odoo'))
      : null;

    let files = [];
    if (odooNode) {
      if (subKey === 'all') {
        // All files directly under Odoo Training node
        files = CN.getFiles(odooNode.id);
      } else {
        // Try to find matching sub-node (e.g. "Purchase", "Sales", "Inventory"…)
        const subNode = CN.getCategories(odooNode.id).find(c =>
          (c.name||'').toLowerCase() === (sub.label||'').toLowerCase()
        );
        files = subNode ? CN.getFiles(subNode.id) : CN.getFiles(odooNode.id);
      }
    }

    odooSubModuleVideosData[subKey] = files.map(f => ({ id: f.id, Title: f.name, Video_URL: f.url }));
    renderOdooSubCards(subKey);
  } catch(err) {
    if (cardsEl) cardsEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:0.9rem;">Failed to load videos.<br><span style="font-size:0.78rem;color:var(--muted);">${err.message}</span></div>`;
  }
}

function renderOdooSubCards(subKey) {
  const sub = ODOO_SUB_MODULES.find(m => m.key === subKey);
  const cardsEl = document.getElementById(`odoo-sub-cards-${subKey}`);
  if (!cardsEl) return;
  const data = odooSubModuleVideosData[subKey] || [];
  if (!data.length) {
    cardsEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:0.9rem;">No videos found for this module.<br><span style="font-size:0.78rem;">Add SubModule = '${sub.label}' in Supabase.</span></div>`;
    return;
  }
  cardsEl.innerHTML = data.map((row, idx) => {
    const safeTitle = (row.Title||'').toLowerCase().replace(/"/g,'&quot;');
    const rowId = row.id || row.ID || '';
    const delBtnHtml = rowId ? `<button onclick="event.stopPropagation();confirmDeleteTrainingVideo(${rowId},'${safeTitle}','${subKey}')" title="Delete video"
      style="width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
      onmouseover="this.style.background='rgba(239,68,68,0.28)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
    </button>` : '';
    return `
      <div data-vtitle="${safeTitle}" onclick="playOdooSubVideo('${subKey}',${idx})"
        style="cursor:pointer;padding:14px;border-radius:12px;border:1.5px solid ${sub.color}44;background:${sub.color}12;transition:all 0.18s;"
        onmouseover="this.style.borderColor='${sub.color}bb';this.style.background='${sub.color}22'"
        onmouseout="this.style.borderColor='${sub.color}44';this.style.background='${sub.color}12'">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:44px;height:44px;border-radius:10px;background:${sub.color}28;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">${sub.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:var(--text);font-size:0.94rem;">${row.Title||'Untitled'}</div>
            <div style="font-size:0.79rem;color:var(--muted);margin-top:2px;">Odoo — ${sub.label}</div>
          </div>
          ${delBtnHtml}
          <div style="width:34px;height:34px;border-radius:50%;background:${sub.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:0.8rem;margin-left:2px;">▶</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function playOdooSubVideo(subKey, idx) {
  const row = (odooSubModuleVideosData[subKey]||[])[idx];
  if (!row) return;
  const sub = ODOO_SUB_MODULES.find(m => m.key === subKey);
  document.getElementById(`odoo-sub-vtitle-${subKey}`).textContent = `${sub.icon} ${row.Title}`;
  document.getElementById(`odoo-sub-vdesc-${subKey}`).textContent = sub.desc;
  document.getElementById(`odoo-sub-cards-${subKey}`).style.display = 'none';
  const searchWrap = document.querySelector(`#odoo-sub-search-${subKey}`)?.parentElement;
  if (searchWrap) searchWrap.style.display = 'none';
  document.getElementById(`odoo-sub-playerbox-${subKey}`).style.display = 'block';

  const url = row.Video_URL || '';
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const videoEl = document.getElementById(`odoo-sub-player-${subKey}`);

  if (ytMatch) {
    // YouTube: show thumbnail + watch button (embedding often restricted)
    const videoId = ytMatch[1];
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    if (videoEl) videoEl.style.display = 'none';
    // Remove old iframe if any
    const oldIframe = document.getElementById(`odoo-sub-yt-${subKey}`);
    if (oldIframe) oldIframe.remove();
    // Create or update YT card
    let ytCard = document.getElementById(`odoo-sub-ytcard-${subKey}`);
    if (!ytCard) {
      ytCard = document.createElement('div');
      ytCard.id = `odoo-sub-ytcard-${subKey}`;
      if (videoEl) videoEl.after(ytCard);
    }
    ytCard.style.display = 'block';
    ytCard.innerHTML = `
      <div style="position:relative;border-radius:12px;overflow:hidden;cursor:pointer;background:#000;" onclick="logActivity({event_type:'video_play',event_detail:'YouTube: ${row.Title}',video_title:'${row.Title}',page_name:'training',card_name:'Odoo - ${subKey}',metadata:{source:'youtube',url:'${watchUrl}'}});window.open('${watchUrl}','_blank')">
        <img src="${thumbUrl}" alt="${row.Title}" style="width:100%;display:block;border-radius:12px;max-height:55vh;object-fit:cover;" onerror="this.style.minHeight='180px';this.style.background='#111';">
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);border-radius:12px;">
          <div style="width:64px;height:64px;background:#ff0000;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px;box-shadow:0 4px 20px rgba(255,0,0,0.5);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <div style="color:#fff;font-weight:700;font-size:0.95rem;text-align:center;padding:0 16px;">Watch on YouTube</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.78rem;margin-top:4px;">Click to open in new tab</div>
        </div>
      </div>
      <a href="${watchUrl}" target="_blank" rel="noopener"
        onclick="logActivity({event_type:'video_play',event_detail:'YouTube: ${row.Title}',video_title:'${row.Title}',page_name:'training',card_name:'Odoo - ${subKey}',metadata:{source:'youtube',url:'${watchUrl}'}})"
        style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding:12px;border-radius:10px;background:#ff0000;color:#fff;font-weight:700;font-size:0.92rem;text-decoration:none;transition:opacity 0.18s;"
        onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        YouTube par Dekhein
      </a>`;
  } else {
    // Supabase/direct video
    pauseAllVideosExcept(`odoo-sub-player-${subKey}`);
    const ytCard = document.getElementById(`odoo-sub-ytcard-${subKey}`);
    if (ytCard) ytCard.style.display = 'none';
    const oldIframe = document.getElementById(`odoo-sub-yt-${subKey}`);
    if (oldIframe) { oldIframe.src = ''; oldIframe.style.display = 'none'; }
    if (videoEl) { videoEl.style.display = ''; videoEl.src = url; videoEl.load();
      _actTrackVideo(videoEl, row.Title || subKey); } // ACTIVITY TRACKING
  }
}

function backToOdooSubList(subKey) {
  const v = document.getElementById(`odoo-sub-player-${subKey}`);
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  const iframeEl = document.getElementById(`odoo-sub-yt-${subKey}`);
  if (iframeEl) { iframeEl.src = ''; iframeEl.style.display = 'none'; }
  const ytCard = document.getElementById(`odoo-sub-ytcard-${subKey}`);
  if (ytCard) ytCard.style.display = 'none';
  document.getElementById(`odoo-sub-playerbox-${subKey}`).style.display = 'none';
  document.getElementById(`odoo-sub-cards-${subKey}`).style.display = 'flex';
  const searchWrap = document.querySelector(`#odoo-sub-search-${subKey}`)?.parentElement;
  if (searchWrap) searchWrap.style.display = 'block';
}

function filterOdooSubVideos(subKey) {
  const inp = document.getElementById(`odoo-sub-search-${subKey}`);
  if (!inp) return;
  const q = inp.value.toLowerCase().trim();
  const container = document.getElementById(`odoo-sub-cards-${subKey}`);
  if (!container) return;
  const cards = container.querySelectorAll('[data-vtitle]');
  let visible = 0;
  cards.forEach(c => {
    const t = c.getAttribute('data-vtitle') || '';
    if (!q || t.includes(q)) { c.style.display = ''; visible++; } else { c.style.display = 'none'; }
  });
}

function openModuleQuiz(moduleKey) {
  moduleQuizCurrentKey = moduleKey;
  moduleQuizActive = MODULE_QUIZZES[moduleKey];
  const _modMeta = MODULE_QUIZZES[moduleKey];
  if (_modMeta) logActivity({event_type:'training_module_open',event_detail:'Opened module: '+_modMeta.title,page_name:'training',card_name:_modMeta.title});
  const ov = document.getElementById('module-quiz-overlay');
  ov.style.display = 'flex';
  showModuleQuizMenu();
}

// ── Per-module video data store ──
const moduleVideosData = {};

// ── Generic: fetch videos for a module from content_nodes + files ──
async function fetchModuleVideos(key) {
  const mod = MODULE_QUIZZES[key];
  const cardsEl = document.getElementById(`modvid-cards-${key}`);
  if (!cardsEl) return;
  cardsEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:0.92rem;">Loading...</div>`;
  try {
    await CN.load();
    const section = CN.getSection('Training');
    const label   = (mod.label || key).toLowerCase();
    const cat     = section
      ? CN.getCategories(section.id).find(c => (c.name||'').toLowerCase().includes(label))
      : null;
    const files = cat ? CN.getFiles(cat.id) : [];
    moduleVideosData[key] = files.map(f => ({ id: f.id, Title: f.name, Video_URL: f.url }));
    renderModuleVideoCards(key);
  } catch(err) {
    if (cardsEl) cardsEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:0.9rem;">Failed to load videos.<br><span style="font-size:0.78rem;color:var(--muted);">${err.message}</span></div>`;
  }
}

// ── Search filter for generic module video lists (Odoo, PC, ClickTask, CoolBus, SmartFleet) ──
function filterModuleVideos(key) {
  const inp = document.getElementById('modvid-search-' + key);
  if (!inp) return;
  const q = inp.value.toLowerCase().trim();
  const container = document.getElementById('modvid-cards-' + key);
  if (!container) return;
  const cards = container.querySelectorAll('[data-vtitle]');
  let visible = 0;
  cards.forEach(c => {
    const title = c.getAttribute('data-vtitle') || '';
    if (!q || title.includes(q)) { c.style.display = ''; visible++; }
    else { c.style.display = 'none'; }
  });
  // No-results message
  let nrEl = document.getElementById('modvid-nores-' + key);
  if (visible === 0 && q && cards.length > 0) {
    if (!nrEl) {
      nrEl = document.createElement('div');
      nrEl.id = 'modvid-nores-' + key;
      nrEl.style.cssText = 'text-align:center;padding:20px;color:var(--muted);font-size:0.9rem;';
      container.appendChild(nrEl);
    }
    nrEl.textContent = 'No videos found for "' + inp.value.trim() + '".';
    nrEl.style.display = '';
  } else if (nrEl) {
    nrEl.style.display = 'none';
  }
}

// ── Search filter for MIS video list ──
function filterMISVideos() {
  const inp = document.getElementById('mis-video-search');
  if (!inp) return;
  const q = inp.value.toLowerCase().trim();
  const container = document.getElementById('mis-video-cards');
  if (!container) return;
  const cards = container.querySelectorAll('[data-vtitle]');
  let visible = 0;
  cards.forEach(c => {
    const title = c.getAttribute('data-vtitle') || '';
    if (!q || title.includes(q)) { c.style.display = ''; visible++; }
    else { c.style.display = 'none'; }
  });
  let nrEl = document.getElementById('mis-video-nores');
  if (visible === 0 && q && cards.length > 0) {
    if (!nrEl) {
      nrEl = document.createElement('div');
      nrEl.id = 'mis-video-nores';
      nrEl.style.cssText = 'text-align:center;padding:20px;color:var(--muted);font-size:0.9rem;';
      container.appendChild(nrEl);
    }
    nrEl.textContent = 'No videos found for "' + inp.value.trim() + '".';
    nrEl.style.display = '';
  } else if (nrEl) {
    nrEl.style.display = 'none';
  }
}

function renderModuleVideoCards(key) {
  const mod = MODULE_QUIZZES[key];
  const cardsEl = document.getElementById(`modvid-cards-${key}`);
  if (!cardsEl) return;
  const data = moduleVideosData[key] || [];
  if (!data.length) {
    cardsEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);">No videos found.<br><span style="font-size:0.8rem;">Add videos with Module = '${mod.supabaseModule}' in Supabase.</span></div>`;
    return;
  }
  cardsEl.innerHTML = data.map((row, idx) => {
    const meta = getMISVideoMeta(row.Title);
    const safeTitle = (row.Title||'').toLowerCase().replace(/"/g,'&quot;');
    const rowId = row.id || row.ID || '';
    return `
      <div data-vtitle="${safeTitle}" onclick="playModuleVideo('${key}',${idx})"
           style="cursor:pointer;padding:16px;border-radius:12px;border:1.5px solid ${mod.color}44;background:${mod.color}12;transition:all 0.18s;"
           onmouseover="this.style.borderColor='${mod.color}bb';this.style.background='${mod.color}22'"
           onmouseout="this.style.borderColor='${mod.color}44';this.style.background='${mod.color}12'">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:48px;height:48px;border-radius:10px;background:${mod.color}28;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">${meta.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:var(--text);font-size:0.97rem;">${row.Title}</div>
            <div style="font-size:0.81rem;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Training Video</div>
          </div>
          ${rowId ? '<button onclick="event.stopPropagation();confirmDeleteTrainingVideo('+rowId+',\''+safeTitle+'\',\''+key+'\');" title="Delete" style="width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onmouseover="this.style.background=\'rgba(239,68,68,0.28)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.12)\'"><svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6\"/><path d=\"M10 11v6M14 11v6\"/><path d=\"M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2\"/></svg></button>' : ''}
          <div style="width:36px;height:36px;border-radius:50%;background:${mod.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:0.85rem;margin-left:2px;">▶</span>
          </div>
        </div>
      </div>`;
  }).join('');
  // Re-apply search filter if user already typed something before re-render
  if (typeof filterModuleVideos === 'function') filterModuleVideos(key);
}

function playModuleVideo(key, idx) {
  const row = (moduleVideosData[key] || [])[idx];
  if (!row) return;
  const meta = getMISVideoMeta(row.Title);
  document.getElementById(`modvid-title-${key}`).textContent = `${meta.icon} ${row.Title}`;
  document.getElementById(`modvid-desc-${key}`).textContent = meta.desc;
  document.getElementById(`modvid-list-${key}`).style.display = 'none';
  document.getElementById(`modvid-playerbox-${key}`).style.display = 'block';

  // ── YouTube URL detect karo ──
  const url = row.Video_URL || '';
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const playerBox = document.getElementById(`modvid-player-wrap-${key}`) || document.getElementById(`modvid-player-${key}`)?.parentElement;

  if (ytMatch) {
    // YouTube: show thumbnail + watch button (embedding often restricted)
    const videoId = ytMatch[1];
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const videoEl = document.getElementById(`modvid-player-${key}`);
    if (videoEl) videoEl.style.display = 'none';
    const oldIframe = document.getElementById(`modvid-yt-iframe-${key}`);
    if (oldIframe) oldIframe.remove();
    let ytCard = document.getElementById(`modvid-ytcard-${key}`);
    if (!ytCard) {
      ytCard = document.createElement('div');
      ytCard.id = `modvid-ytcard-${key}`;
      if (videoEl) videoEl.after(ytCard);
    }
    ytCard.style.display = 'block';
    ytCard.innerHTML = `
      <div style="position:relative;border-radius:12px;overflow:hidden;cursor:pointer;background:#000;" onclick="logActivity({event_type:'video_play',event_detail:'YouTube: ${row.Title}',video_title:'${row.Title}',page_name:'training',card_name:'${key}',metadata:{source:'youtube',url:'${watchUrl}'}});window.open('${watchUrl}','_blank')">
        <img src="${thumbUrl}" alt="${row.Title}" style="width:100%;display:block;border-radius:12px;max-height:55vh;object-fit:cover;" onerror="this.style.minHeight='180px';this.style.background='#111';">
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);border-radius:12px;">
          <div style="width:64px;height:64px;background:#ff0000;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px;box-shadow:0 4px 20px rgba(255,0,0,0.5);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <div style="color:#fff;font-weight:700;font-size:0.95rem;text-align:center;padding:0 16px;">Watch on YouTube</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.78rem;margin-top:4px;">Click to open in new tab</div>
        </div>
      </div>
      <a href="${watchUrl}" target="_blank" rel="noopener"
        onclick="logActivity({event_type:'video_play',event_detail:'YouTube: ${row.Title}',video_title:'${row.Title}',page_name:'training',card_name:'${key}',metadata:{source:'youtube',url:'${watchUrl}'}})"
        style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding:12px;border-radius:10px;background:#ff0000;color:#fff;font-weight:700;font-size:0.92rem;text-decoration:none;transition:opacity 0.18s;"
        onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        YouTube par Dekhein
      </a>`;
  } else {
    // Supabase/direct video URL
    pauseAllVideosExcept(`modvid-player-${key}`);
    const videoEl = document.getElementById(`modvid-player-${key}`);
    const iframeEl = document.getElementById(`modvid-yt-iframe-${key}`);
    if (iframeEl) { iframeEl.src = ''; iframeEl.style.display = 'none'; }
    if (videoEl) { videoEl.style.display = ''; videoEl.src = url; videoEl.load();
      _actTrackVideo(videoEl, row.Title || key); } // ACTIVITY TRACKING

    // Download button — sirf allowed users ke liye
    const dlWrap = document.getElementById(`modvid-dl-wrap-${key}`);
    if (dlWrap && _canDownloadVideo() && url) {
      dlWrap.innerHTML = `<a href="${url}" download="${row.Title || 'video'}.mp4" target="_blank"
        style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;background:rgba(0,212,170,0.12);border:1px solid rgba(0,212,170,0.35);color:#00d4aa;font-size:0.82rem;font-weight:700;text-decoration:none;">
        ⬇️ Download Video
      </a>`;
    }
  }
}

function backToModuleVideoList(key) {
  const v = document.getElementById(`modvid-player-${key}`);
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  const iframeEl = document.getElementById(`modvid-yt-iframe-${key}`);
  if (iframeEl) { iframeEl.src = ''; iframeEl.style.display = 'none'; }
  const ytCard = document.getElementById(`modvid-ytcard-${key}`);
  if (ytCard) ytCard.style.display = 'none';
  document.getElementById(`modvid-playerbox-${key}`).style.display = 'none';
  document.getElementById(`modvid-list-${key}`).style.display = 'block';
}

function switchModuleTab(key, tab) {
  const vTab = document.getElementById(`modvid-vtab-${key}`);
  const qTab = document.getElementById(`modvid-qtab-${key}`);
  const btnV = document.getElementById(`modvid-btn-v-${key}`);
  const btnQ = document.getElementById(`modvid-btn-q-${key}`);
  const mod = MODULE_QUIZZES[key];
  if (!vTab || !qTab) return;
  if (tab === 'videos') {
    vTab.style.display = 'block'; qTab.style.display = 'none';
    btnV.style.background = `${mod.color}2e`; btnV.style.color = mod.color; btnV.style.fontWeight = '800';
    btnQ.style.background = 'transparent'; btnQ.style.color = 'var(--muted)'; btnQ.style.fontWeight = '700';
    const v = document.getElementById(`modvid-player-${key}`);
    if (v) v.pause();
  } else {
    vTab.style.display = 'none'; qTab.style.display = 'block';
    btnQ.style.background = `${mod.color}2e`; btnQ.style.color = mod.color; btnQ.style.fontWeight = '800';
    btnV.style.background = 'transparent'; btnV.style.color = 'var(--muted)'; btnV.style.fontWeight = '700';
  }
}

function showModuleQuizMenu() {
  const mod = moduleQuizActive;
  const key = moduleQuizCurrentKey;
  const borderColor = mod.color + '55';
  const bgColor = mod.color + '14';
  const quizOnly = _quizOnlyMode;

  // ── Modules with Supabase videos → Videos + Quiz tabs ──
  if (mod.supabaseModule) {
    document.getElementById('module-quiz-screen').innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:1.15rem;font-weight:800;color:var(--text);margin-bottom:4px;">${mod.icon} ${mod.title.replace(' Quiz','')}</div>
        <div style="font-size:0.85rem;color:var(--muted);">${quizOnly ? 'Test your knowledge!' : 'Watch videos or test your knowledge!'}</div>
      </div>
      ${quizOnly ? '' : `
      <div style="display:flex;gap:0;margin-bottom:18px;border-radius:12px;overflow:hidden;border:1.5px solid ${mod.color}40;">
        <button id="modvid-btn-v-${key}" onclick="switchModuleTab('${key}','videos')"
          style="flex:1;padding:10px 0;border:none;background:${mod.color}2e;color:${mod.color};font-weight:800;font-size:0.95rem;cursor:pointer;font-family:inherit;">▶ Videos</button>
        <button id="modvid-btn-q-${key}" onclick="switchModuleTab('${key}','quiz')"
          style="flex:1;padding:10px 0;border:none;background:transparent;color:var(--muted);font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;">📝 Quiz</button>
      </div>
      <!-- Videos Tab -->
      <div id="modvid-vtab-${key}">
        <div id="modvid-list-${key}">
          <div style="font-size:0.82rem;font-weight:700;color:var(--muted);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:12px;">Training Videos</div>
          <div style="position:relative;margin-bottom:12px;">
            <input type="text" id="modvid-search-${key}"
              placeholder="Search videos..."
              oninput="filterModuleVideos('${key}')"
              style="width:100%;padding:10px 14px 10px 38px;border-radius:10px;border:1.5px solid ${mod.color}40;background:var(--surface2);color:var(--text);font-size:0.9rem;font-family:inherit;outline:none;transition:border-color 0.18s;box-sizing:border-box;"
              onfocus="this.style.borderColor='${mod.color}bb'" onblur="this.style.borderColor='${mod.color}40'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${mod.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </div>
          <div id="modvid-cards-${key}" style="display:flex;flex-direction:column;gap:10px;">
            <div style="text-align:center;padding:24px;color:var(--muted);font-size:0.92rem;">Loading...</div>
          </div>
        </div>
        <div id="modvid-playerbox-${key}" style="display:none;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <button onclick="backToModuleVideoList('${key}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.3rem;padding:0;line-height:1;">←</button>
            <div>
              <div id="modvid-title-${key}" style="font-size:1.02rem;font-weight:800;color:var(--text);"></div>
              <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">Training Video</div>
            </div>
          </div>
          <video id="modvid-player-${key}" controls
            controlsList="nodownload noplaybackrate" disablePictureInPicture
            style="width:100%;border-radius:12px;background:#000;max-height:55vh;" preload="metadata">
            Your browser does not support the video tag.
          </video>
          ${_canDownloadVideo() ? `<div id="modvid-dl-wrap-${key}" style="margin-top:10px;text-align:right;"></div>` : ''}
          <div id="modvid-desc-${key}" style="margin-top:12px;font-size:0.87rem;color:var(--muted);line-height:1.65;"></div>
        </div>
      </div>`}

      <!-- Quiz Tab -->
      <div id="modvid-qtab-${key}" style="display:block;">
        <div style="font-size:0.80rem;font-weight:700;color:var(--muted);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:12px;">Take the Quiz</div>
        <button onclick="startModuleQuiz()" style="width:100%;text-align:left;padding:18px;border-radius:12px;border:1.5px solid ${borderColor};background:${bgColor};cursor:pointer;font-family:inherit;transition:all 0.18s;" onmouseover="this.style.borderColor='${mod.color}'" onmouseout="this.style.borderColor='${borderColor}'">
          <div style="display:flex;align-items:center;gap:14px;">
            <span style="font-size:2rem;">${mod.icon}</span>
            <div style="flex:1;">
              <div style="font-weight:700;color:var(--text);font-size:0.97rem;margin-bottom:3px;">${mod.subtitle}</div>
              <div style="font-size:0.78rem;color:var(--muted);">10 Questions • Multiple Choice</div>
            </div>
            <span style="color:${mod.color};font-size:1.2rem;">→</span>
          </div>
        </button>
      </div>
    `;
    if (!quizOnly) fetchModuleVideos(key);
    _quizOnlyMode = false;
    return;
  }

  // ── Other modules (PC, Click Task, Cool Bus, SmartFleet) → Drive button + Quiz ──
  document.getElementById('module-quiz-screen').innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="font-size:1.15rem;font-weight:800;color:var(--text);margin-bottom:4px;">${mod.icon} ${mod.title.replace(' Quiz','')}</div>
      <div style="font-size:0.85rem;color:var(--muted);">${quizOnly ? 'Test your knowledge!' : 'Watch the videos, then test your knowledge!'}</div>
    </div>
    ${quizOnly ? '' : `
    <div style="margin-bottom:20px;">
      <a href="${mod.driveUrl}" target="_blank" style="text-decoration:none;">
        <button style="width:100%;padding:12px;border-radius:10px;border:1.5px solid rgba(240,165,0,0.4);background:rgba(240,165,0,0.1);color:#f0a500;font-weight:700;font-size:0.88rem;cursor:pointer;font-family:inherit;">📁 Open Drive Videos</button>
      </a>
    </div>`}
    <div style="font-size:0.80rem;font-weight:700;color:var(--muted);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:12px;">Take the Quiz</div>
    <button onclick="startModuleQuiz()" style="width:100%;text-align:left;padding:18px;border-radius:12px;border:1.5px solid ${borderColor};background:${bgColor};cursor:pointer;font-family:inherit;transition:all 0.18s;" onmouseover="this.style.borderColor='${mod.color}'" onmouseout="this.style.borderColor='${borderColor}'">
      <div style="display:flex;align-items:center;gap:14px;">
        <span style="font-size:2rem;">${mod.icon}</span>
        <div style="flex:1;">
          <div style="font-weight:700;color:var(--text);font-size:0.97rem;margin-bottom:3px;">${mod.subtitle}</div>
          <div style="font-size:0.78rem;color:var(--muted);">10 Questions • Multiple Choice</div>
        </div>
        <span style="color:${mod.color};font-size:1.2rem;">→</span>
      </div>
    </button>
  `;
  _quizOnlyMode = false;
}

function startModuleQuiz() {
  moduleQuizQIndex = 0;
  moduleQuizAnswers = [];
  renderModuleQuestion();
}

function closeModuleQuiz() {
  _quizOnlyMode = false;
  document.getElementById('module-quiz-overlay').style.display = 'none';
  // Stop any playing module video
  document.querySelectorAll('[id^="modvid-player-"]').forEach(v => {
    if (v && v.pause) { v.pause(); v.removeAttribute('src'); v.load(); }
  });
}

function renderModuleQuestion() {
  const mod = moduleQuizActive;
  const q = mod.questions[moduleQuizQIndex];
  const total = mod.questions.length;
  const screen = document.getElementById('module-quiz-screen');
  screen.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
      <button onclick="showModuleQuizMenu()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.3rem;padding:0;">←</button>
      <div>
        <div style="font-weight:700;font-size:1.05rem;color:var(--text);">${mod.icon} ${mod.title}</div>
        <div style="font-size:0.80rem;color:var(--muted);">${mod.subtitle}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-size:0.82rem;color:var(--muted);">Question ${moduleQuizQIndex+1} of ${total}</span>
      <span style="font-size:0.82rem;font-weight:700;color:${mod.color};">${Math.round((moduleQuizQIndex/total)*100)}% done</span>
    </div>
    <div style="background:var(--border);border-radius:4px;height:5px;margin-bottom:22px;">
      <div style="background:${mod.color};height:5px;border-radius:4px;width:${(moduleQuizQIndex/total)*100}%;transition:width 0.3s;"></div>
    </div>
    <div style="font-size:1.03rem;font-weight:600;color:var(--text);margin-bottom:20px;line-height:1.55;">${q.q}</div>
    <div style="display:flex;flex-direction:column;gap:10px;" id="mq-options">
      ${q.opts.map((opt,i)=>`
        <button onclick="selectModuleAnswer(${i})" id="mq-opt-${i}" style="text-align:left;padding:13px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:0.91rem;transition:all 0.18s;font-family:inherit;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--border);font-weight:700;font-size:0.75rem;margin-right:10px;">${['A','B','C','D'][i]}</span>${opt}
        </button>
      `).join('')}
    </div>
    <div id="mq-next-area" style="margin-top:18px;display:none;">
      <button onclick="nextModuleQuestion()" style="width:100%;padding:13px;border-radius:10px;border:none;background:${mod.color};color:#fff;font-weight:700;font-size:0.97rem;cursor:pointer;font-family:inherit;">
        ${moduleQuizQIndex < total-1 ? 'Next Question →' : 'Submit Quiz 🎯'}
      </button>
    </div>
  `;
}

function selectModuleAnswer(idx) {
  const mod = moduleQuizActive;
  const q = mod.questions[moduleQuizQIndex];
  moduleQuizAnswers[moduleQuizQIndex] = idx;
  document.querySelectorAll('[id^="mq-opt-"]').forEach((btn,i)=>{
    btn.disabled = true;
    if(i===q.ans){ btn.style.background='rgba(34,197,94,0.15)';btn.style.borderColor='#22c55e';btn.style.color='#22c55e'; }
    else if(i===idx && idx!==q.ans){ btn.style.background='rgba(239,68,68,0.15)';btn.style.borderColor='#ef4444';btn.style.color='#ef4444'; }
  });
  document.getElementById('mq-next-area').style.display='block';
}

function nextModuleQuestion() {
  moduleQuizQIndex++;
  if(moduleQuizQIndex < moduleQuizActive.questions.length){ renderModuleQuestion(); }
  else { showModuleResult(); }
}

function showModuleResult() {
  const mod = moduleQuizActive;
  const total = mod.questions.length;
  let score = 0;
  moduleQuizAnswers.forEach((ans,i)=>{ if(ans===mod.questions[i].ans) score++; });
  const pct = Math.round((score/total)*100);
  const emoji = pct>=80?'🏆':pct>=60?'👍':'📚';
  const msg = pct>=80?'Excellent Work!':pct>=60?'Good Job!':'Keep Learning!';
  const msgColor = pct>=80?'#22c55e':pct>=60?'#f0a500':'#ef4444';
  const modKey = Object.keys(MODULE_QUIZZES).find(k=>MODULE_QUIZZES[k].title===mod.title);
  document.getElementById('module-quiz-screen').innerHTML = `
    <div style="text-align:center;padding:10px 0;">
      <div style="font-size:3.5rem;margin-bottom:10px;">${emoji}</div>
      <div style="font-size:1.3rem;font-weight:800;color:${msgColor};margin-bottom:4px;">${msg}</div>
      <div style="font-size:0.85rem;color:var(--muted);margin-bottom:24px;">${mod.icon} ${mod.title}</div>
      <div style="display:inline-flex;align-items:center;justify-content:center;width:110px;height:110px;border-radius:50%;border:6px solid ${msgColor};margin:0 auto 22px;">
        <div>
          <div style="font-size:1.85rem;font-weight:900;color:${msgColor};">${score}/${total}</div>
          <div style="font-size:0.78rem;color:var(--muted);">${pct}%</div>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:18px;max-height:220px;overflow-y:auto;">
        <div style="font-size:0.82rem;font-weight:700;color:var(--text);margin-bottom:10px;text-align:left;">Review Answers</div>
        ${mod.questions.map((q,i)=>`
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;text-align:left;">
            <span style="font-size:0.90rem;">${moduleQuizAnswers[i]===q.ans?'✅':'❌'}</span>
            <div>
              <div style="font-size:0.78rem;color:var(--text);font-weight:600;">Q${i+1}: ${q.q}</div>
              <div style="font-size:0.75rem;color:${moduleQuizAnswers[i]===q.ans?'#22c55e':'#ef4444'};">Your answer: ${q.opts[moduleQuizAnswers[i]]}</div>
              ${moduleQuizAnswers[i]!==q.ans?`<div style="font-size:0.75rem;color:#22c55e;">Correct: ${q.opts[q.ans]}</div>`:''}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <button onclick="startModuleQuiz()" style="flex:1;min-width:110px;padding:11px 14px;border-radius:10px;border:1.5px solid ${mod.color};background:transparent;color:${mod.color};font-weight:700;font-size:0.88rem;cursor:pointer;font-family:inherit;">🔄 Retry</button>
        <button onclick="showModuleQuizMenu()" style="flex:1;min-width:110px;padding:11px 14px;border-radius:10px;border:none;background:var(--surface2);color:var(--text);font-weight:600;font-size:0.85rem;cursor:pointer;font-family:inherit;">← Back</button>
        <a href="${mod.driveUrl}" target="_blank" style="flex:1;min-width:110px;text-decoration:none;"><button style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:0.85rem;cursor:pointer;font-family:inherit;">📁 Drive</button></a>
      </div>
    </div>
  `;
}



const MIS_QUIZ_MODULES = {
  fms: {
    title: 'FMS Quiz',
    subtitle: 'Fleet Management System',
    color: '#f0a500',
    icon: '🚗',
    driveUrl: 'https://drive.google.com/drive/folders/1kJxI0w9_IfT6_dfkBlXUkjTfx47eGwcz',
    questions: []
  },
  checklist: {
    title: 'Checklist Quiz',
    subtitle: 'Daily Operational Checklist',
    color: '#00d4aa',
    icon: '✅',
    driveUrl: 'https://drive.google.com/drive/folders/1kJxI0w9_IfT6_dfkBlXUkjTfx47eGwcz',
    questions: []
  },
  mis: {
    title: 'MIS Quiz',
    subtitle: 'Management Information System',
    color: '#f0a500',
    icon: '📊',
    driveUrl: 'https://drive.google.com/drive/folders/1kJxI0w9_IfT6_dfkBlXUkjTfx47eGwcz',
    questions: []
  },
  looker: {
    title: 'Looker Studio Quiz',
    subtitle: 'Checklist Reports in Looker Studio',
    color: '#a855f7',
    icon: '📈',
    driveUrl: 'https://drive.google.com/drive/folders/1kJxI0w9_IfT6_dfkBlXUkjTfx47eGwcz',
    questions: []
  }
};

let currentQuizModule = null;
let currentQuestionIndex = 0;
let userAnswers = [];

function openMISQuizMenu() {
  logActivity({event_type:'training_module_open',event_detail:'Opened MIS Training',page_name:'training',card_name:'MIS Training'});
  console.log('[ACT] MIS Training opened');
  document.getElementById('mis-quiz-overlay').style.display = 'flex';
  switchMISTab('videos');
  fetchMISVideos();   // load from Supabase table on open
}

function closeMISQuiz() {
  document.getElementById('mis-quiz-overlay').style.display = 'none';
  const v = document.getElementById('mis-main-video');
  if(v) { v.pause(); v.removeAttribute('src'); v.load(); }
  _misQuizzesLoaded = false; // allow fresh reload next open
}

// ── Tab switching ──
function switchMISTab(tab) {
  const vTab = document.getElementById('mis-videos-tab');
  const qTab = document.getElementById('mis-quiz-tab');
  const btnV = document.getElementById('mis-tab-videos');
  const btnQ = document.getElementById('mis-tab-quiz');
  if(tab === 'videos') {
    vTab.style.display = 'block'; qTab.style.display = 'none';
    btnV.style.background = 'rgba(240,165,0,0.18)'; btnV.style.color = '#f0a500'; btnV.style.fontWeight = '800';
    btnQ.style.background = 'transparent'; btnQ.style.color = 'var(--muted)'; btnQ.style.fontWeight = '700';
    document.getElementById('mis-video-list').style.display = 'block';
    document.getElementById('mis-video-player').style.display = 'none';
    const v = document.getElementById('mis-main-video');
    if(v) v.pause();
  } else {
    vTab.style.display = 'none'; qTab.style.display = 'block';
    btnQ.style.background = 'rgba(168,85,247,0.18)'; btnQ.style.color = '#a855f7'; btnQ.style.fontWeight = '800';
    btnV.style.background = 'transparent'; btnV.style.color = 'var(--muted)'; btnV.style.fontWeight = '700';
    loadMISDBQuizzes();  // load quizzes from Supabase
  }
}

// ── Load DB quizzes inside MIS overlay Quiz tab ──
let _misQuizzesLoaded = false;
async function loadMISDBQuizzes() {
  if (_misQuizzesLoaded) return;  // already loaded, no re-fetch
  _misQuizzesLoaded = true;

  const loadEl  = document.getElementById('mis-db-quiz-loading');
  const listEl  = document.getElementById('mis-db-quiz-list');
  const emptyEl = document.getElementById('mis-db-quiz-empty');
  if (!loadEl) return;

  // Show Create Quiz button only to authorised MIS members
  const createBtn = document.getElementById('mis-create-quiz-btn');
  if (createBtn && _canUploadQuiz()) createBtn.style.display = 'inline-block';

  loadEl.style.display = 'block';
  listEl.innerHTML = '';
  emptyEl.style.display = 'none';

  // Inline headers — QZ_HDRS not yet defined at this point in the file
  const _hdrs = SB_HDRS_JSON();

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/quizzes?select=*,content_nodes(name),questions(marks)&is_active=eq.true&order=id.desc`,
      { headers: _hdrs }
    );
    let quizzes = await res.json();
    // Only show quizzes linked to MIS Training node
    quizzes = quizzes.filter(q =>
      (q.content_nodes?.name || '').toLowerCase().trim() === 'mis training'
    );
    loadEl.style.display = 'none';

    if (!Array.isArray(quizzes) || !quizzes.length) {
      emptyEl.style.display = 'block';
      return;
    }

    const colors = ['#a855f7','#f0a500','#00d4aa','#4e9af1','#f97316','#e879f9','#22c55e'];
    listEl.innerHTML = quizzes.map((q, i) => {
      const col        = colors[i % colors.length];
      const mod        = q.content_nodes?.name || 'General';
      const tl         = q.time_limit ? `⏱ ${q.time_limit} min` : '';
      const totalMarks = (q.questions || []).reduce((s, qq) => s + (qq.marks || 1), 0);
      const passingPct = q.passing_score || 60;
      const passingMks = totalMarks > 0 ? Math.ceil((passingPct / 100) * totalMarks) : null;
      const pass       = passingMks ? `🎯 Pass: ${passingMks}/${totalMarks} marks` : `🎯 Pass: ${passingPct}%`;
      return `
        <button onclick="openQuizPreview(${q.id})"
          style="text-align:left;padding:15px 16px;border-radius:13px;border:1.5px solid ${col}33;border-top:2.5px solid ${col};background:${col}0d;cursor:pointer;font-family:inherit;width:100%;transition:all 0.18s;"
          onmouseover="this.style.background='${col}1a';this.style.transform='translateY(-2px)'"
          onmouseout="this.style.background='${col}0d';this.style.transform=''">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:40px;height:40px;border-radius:10px;background:${col}22;border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">📝</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;color:var(--text);font-size:0.96rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${q.title}</div>
              <div style="font-size:0.76rem;color:var(--muted);margin-top:3px;">📚 ${mod}${tl ? ' · ' + tl : ''} · ${pass}</div>
            </div>
            <span style="color:${col};font-size:1.1rem;flex-shrink:0;">→</span>
          </div>
        </button>`;
    }).join('');

  } catch(e) {
    loadEl.style.display = 'none';
    listEl.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;font-size:0.83rem;">⚠️ Could not load quizzes: ${e.message}</div>`;
    _misQuizzesLoaded = false; // allow retry
  }
}

async function loadTrainingSection() {
  if (trainingDynLoaded) return;
  trainingDynLoaded = true;

  const loadingEl = document.getElementById('training-dynamic-loading');
  const gridEl    = document.getElementById('training-dynamic-grid');
  const emptyEl   = document.getElementById('training-dynamic-empty');

  try {
    await CN.load();
    const section = CN.getSection('Training');

    if (!section || !CN.getCategories(section.id).length) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl)   emptyEl.style.display = 'block';
      return;
    }

    const cats = CN.getCategories(section.id);
    if (loadingEl) loadingEl.style.display = 'none';

    gridEl.innerHTML = cats.map((cat, i) => {
      const th      = cnTheme(i);
      const name    = cat.name || 'Module';
      const count   = CN.totalFiles(cat.id);
      const safe    = name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      const quizFn  = TRAINING_QUIZ_MAP[name.toLowerCase().trim()];

      return `
      <div style="position:relative;">
        ${_isMIS() ? `        <button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete card"
          style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>` : ''}
        <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
          onclick="cnOpenTrainingOverlay(${cat.id},'${safe}')"
          onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
          onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
          <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
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

    gridEl.style.display = 'grid';

  } catch(e) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl)   { emptyEl.style.display = 'block'; emptyEl.textContent = '⚠️ ' + e.message; }
  }
}

// ── Overlay tab switch ───────────────────────────────────────────────────
let _currentMktNodeId = null;
function switchMktTab(tab) {
  const vTab = document.getElementById('mkt-tab-videos');
  const aTab = document.getElementById('mkt-tab-assessment');
  const btnV = document.getElementById('mkt-tab-btn-videos');
  const btnA = document.getElementById('mkt-tab-btn-assessment');
  if (!vTab) return;
  if (tab === 'videos') {
    vTab.style.display = 'block'; if(aTab) aTab.style.display = 'none';
    btnV.style.borderBottomColor = '#00d4ff'; btnV.style.color = '#00d4ff';
    btnV.style.background = 'rgba(0,212,255,0.08)'; btnV.style.fontWeight = '800';
    if(btnA){ btnA.style.borderBottomColor = 'transparent'; btnA.style.color = 'var(--muted)'; btnA.style.background = 'transparent'; btnA.style.fontWeight = '700'; }
  } else {
    vTab.style.display = 'none'; if(aTab) aTab.style.display = 'block';
    if(btnA){ btnA.style.borderBottomColor = '#a855f7'; btnA.style.color = '#a855f7'; btnA.style.background = 'rgba(168,85,247,0.08)'; btnA.style.fontWeight = '800'; }
    btnV.style.borderBottomColor = 'transparent'; btnV.style.color = 'var(--muted)'; btnV.style.background = 'transparent'; btnV.style.fontWeight = '700';
  }
}

// Hide Assessment tab — used when overlay is opened from IT Admin or Marketing
function _hideAssessmentTab() {
  const bar = document.getElementById('mkt-tab-bar');
  if (bar) bar.style.display = 'none';
  const btn = document.getElementById('mkt-tab-btn-assessment');
  if (btn) btn.style.display = 'none';
}

// Show Assessment tab — used when overlay is opened from Training
function _showAssessmentTab() {
  const bar = document.getElementById('mkt-tab-bar');
  if (bar) bar.style.display = 'flex';
  const btn = document.getElementById('mkt-tab-btn-assessment');
  if (btn) btn.style.display = 'flex';
}

// Training cards → show Assessment tab + load quizzes
function cnOpenTrainingOverlay(nodeId, catName) {
  _currentMktNodeId = nodeId;
  logActivity({event_type:'training_module_open', event_detail:'Opened training card: '+catName, page_name:'training', card_name:catName});
  const th = cnTheme(0);
  const iconEl = document.getElementById('mktOverlayIcon');
  if (iconEl) { iconEl.style.background = th.bg; iconEl.style.borderColor = th.border; iconEl.innerHTML = `<span style="font-size:1.4rem;">🎬</span>`; }
  document.getElementById('mktOverlayTitle').textContent    = catName;
  document.getElementById('mktOverlaySub').textContent      = '';
  document.getElementById('mktOverlayLoader').style.display = 'block';
  document.getElementById('mktOverlayGrid').innerHTML       = '';
  document.getElementById('mktOverlayEmpty').style.display  = 'none';
  document.getElementById('mkt-quiz-loading').style.display = 'block';
  document.getElementById('mkt-quiz-list').innerHTML        = '';
  document.getElementById('mkt-quiz-empty').style.display   = 'none';

  _showAssessmentTab(); // Training mein Assessment tab dikhao
  document.getElementById('marketingOverlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  switchMktTab('videos');
  _cnRenderOverlayContent(nodeId, catName, th, 'mktOverlayGrid', 'mktOverlaySub', 'mktOverlayEmpty', null);
  _loadMktQuizPanel(catName, nodeId);
}

// Load DB quizzes into Assessment panel
async function _loadMktQuizPanel(catName, nodeId) {
  const loadEl  = document.getElementById('mkt-quiz-loading');
  const listEl  = document.getElementById('mkt-quiz-list');
  const emptyEl = document.getElementById('mkt-quiz-empty');
  const _hdrs = SB_HDRS_JSON;
  try {
    const nodeFilter = nodeId ? `&node_id=eq.${nodeId}` : '';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/quizzes?select=*,content_nodes(name),questions(marks)&is_active=eq.true${nodeFilter}&order=id.desc`,
      { headers: _hdrs() }
    );
    const quizzes = await res.json();
    if(loadEl) loadEl.style.display = 'none';
    if (!Array.isArray(quizzes) || !quizzes.length) { if(emptyEl) emptyEl.style.display = 'block'; return; }
    const colors = ['#a855f7','#f0a500','#00d4aa','#4e9af1','#f97316','#e879f9','#22c55e'];
    if(listEl) listEl.innerHTML = quizzes.map((q, i) => {
      const col        = colors[i % colors.length];
      const mod        = q.content_nodes?.name || 'General';
      const tl         = q.time_limit ? `⏱ ${q.time_limit} min` : '';
      const totalMarks = (q.questions || []).reduce((s, qq) => s + (qq.marks || 1), 0);
      const passingPct = q.passing_score || 60;
      const passingMks = totalMarks > 0 ? Math.ceil((passingPct / 100) * totalMarks) : null;
      const pass       = passingMks ? `🎯 Pass: ${passingMks}/${totalMarks} marks` : `🎯 Pass: ${passingPct}%`;
      const qCount     = q.question_count ? `📋 ${q.question_count} Qs` : '';
      return `
        <button onclick="openQuizPreviewFromOverlay(${q.id})"
          style="text-align:left;padding:14px 15px;border-radius:13px;border:1.5px solid ${col}33;border-left:3px solid ${col};background:${col}0a;cursor:pointer;font-family:inherit;width:100%;transition:all 0.18s;"
          onmouseover="this.style.background='${col}18';this.style.transform='translateX(3px)'"
          onmouseout="this.style.background='${col}0a';this.style.transform=''">
          <div style="display:flex;align-items:center;gap:11px;">
            <div style="width:36px;height:36px;border-radius:9px;background:${col}20;border:1px solid ${col}40;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">📝</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;color:var(--text);font-size:0.9rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${q.title}</div>
              <div style="font-size:0.72rem;color:var(--muted);">${[mod,tl,pass,qCount].filter(Boolean).join(' · ')}</div>
            </div>
            <span style="color:${col};font-size:1rem;flex-shrink:0;">→</span>
          </div>
        </button>`;
    }).join('');
  } catch(e) {
    if(loadEl) loadEl.style.display = 'none';
    if(listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:0.82rem;padding:16px;">⚠️ ${e.message}</div>`;
  }
}

// ── Open quiz directly — no Videos tab shown ─────────────────────────────
let _quizOnlyMode = false;

function openQuizOnlyMode(cardName) {
  const key = cardName.toLowerCase().trim();
  _quizOnlyMode = true;

  if (key === 'mis training') {
    document.getElementById('mis-quiz-overlay').style.display = 'flex';
    const tabBar = document.getElementById('mis-main-tabs');
    if (tabBar) tabBar.style.display = 'none';
    switchMISTab('quiz');

  } else if (key === 'odoo training') {
    openModuleQuiz('odoo');

  } else {
    const keyMap = {
      'pc training':          'pc',
      'click task training':  'clicktask',
      'cool bus training':    'coolbus',
      'smart fleet training': 'smartfleet',
    };
    const moduleKey = keyMap[key];
    if (moduleKey) openModuleQuiz(moduleKey);
  }
}

// Restore MIS tabs visibility when quiz is closed normally
const _origCloseMISQuiz = window.closeMISQuiz;
window.closeMISQuiz = function() {
  const tabBar = document.getElementById('mis-main-tabs');
  if (tabBar) tabBar.style.display = 'flex';
  if (_origCloseMISQuiz) _origCloseMISQuiz();
  else {
    document.getElementById('mis-quiz-overlay').style.display = 'none';
    const v = document.getElementById('mis-main-video');
    if(v) { v.pause(); v.removeAttribute('src'); v.load(); }
  }
};

// ── Training module card delete is handled by CN.confirmDeleteCard()
// injected directly inside loadTrainingSection() cards — no separate
// Training_Videos table needed.


// Delete a single video from files table
async function confirmDeleteTrainingVideo(videoId, videoTitle, subKey) {
  if (!confirm('Delete "' + videoTitle + '"? This cannot be undone.')) return;
  // Look up URL from cached data
  let videoUrl = '';
  if (subKey && window.odooSubModuleVideosData && odooSubModuleVideosData[subKey]) {
    const row = odooSubModuleVideosData[subKey].find(r => String(r.id) === String(videoId));
    if (row) videoUrl = row.Video_URL || '';
  } else {
    const row = (misVideosData || []).find(r => String(r.id) === String(videoId));
    if (row) videoUrl = row.Video_URL || '';
    if (!videoUrl && window.moduleVideosData) {
      for (const k of Object.keys(moduleVideosData)) {
        const r = (moduleVideosData[k]||[]).find(r => String(r.id) === String(videoId));
        if (r) { videoUrl = r.Video_URL || ''; break; }
      }
    }
  }
  // Remove card from DOM immediately
  const card = document.querySelector('[data-vtitle="' + videoTitle.toLowerCase() + '"]');
  if (card) card.remove();
  // Invalidate caches so next open is fresh
  if (subKey && window.odooSubModuleVideosData) delete odooSubModuleVideosData[subKey];
  window.misVideosData = [];
  CN.loaded = false; CN.nodes = []; CN.files = [];
  await _doDeleteFile(videoId, videoUrl);
}


// ════════════════════════════════════════════════════════════════════════
//   [QUIZ SYSTEM JS] — Complete quiz engine
//   Overlays controlled here:
//     Quiz Preview popup → Quiz Taking overlay → Result overlay → My Results
//   Admin features (MIS only):
//     Quiz Admin Modal — create/edit/delete quizzes
//     Grade Overlay — manually grade descriptive answers
//   Key functions:
//     loadTrainingQuizzes()  = Training section mein list load
//     openQuizPreview()      = Quiz info popup open
//     startDBQuiz()          = Quiz start karo
//     submitDBQuiz()         = Quiz submit + score calculate
//     openMyQuizResults()    = My past attempts dekho
// ════════════════════════════════════════════════════════════════════════

// ─── Quiz System Config ────────────────────────────────────────────────────
// Base headers — no Prefer here (added per-request as needed)
// Aliases — use global SB_HDRS helpers defined near SUPABASE config
const QZ_HDRS         = SB_HDRS_JSON;
const QZ_HDRS_REPR    = SB_HDRS_REPR;
const QZ_HDRS_MINIMAL = SB_HDRS_MIN;

// ─── State ─────────────────────────────────────────────────────────────────
let _qzCurrentQuiz   = null;   // quiz row
let _qzQuestions     = [];     // array of {question, options[]}
let _qzCurrentIndex  = 0;
let _qzAnswers       = {};     // { question_id: selected_option_id }
let _qzTimerInterval = null;
let _qzSecondsLeft   = 0;
let _qzAttemptId     = null;
let _qzRetakeId      = null;
let _qzEmpId         = null;   // Employee Emp_id

// ─── Admin: question builder state ─────────────────────────────────────────
let _qaQuestions = [];  // [{text, marks, options:[{text,is_correct}]}]

// ══════════════════════════════════════════════════════════════
// LOAD QUIZZES for Training Section
// ══════════════════════════════════════════════════════════════
let _quizzesLoaded = false;

async function loadTrainingQuizzes() {
  if (_quizzesLoaded) return;
  _quizzesLoaded = true;

  // Show admin button only to Hemant & Krishna (authorised MIS members)
  if (_canUploadQuiz()) {
    const cb = document.getElementById('create-quiz-btn');
    if (cb) cb.style.display = 'inline-flex';
  }

  // Show "My Results" to all logged-in users
  const mrb = document.getElementById('quiz-my-results-btn');
  if (mrb && CURRENT_USER) mrb.style.display = 'inline-block';

  const loadEl  = document.getElementById('db-quiz-loading');
  const gridEl  = document.getElementById('db-quiz-grid');
  const emptyEl = document.getElementById('db-quiz-empty');

  try {
    const url = `${SUPABASE_URL}/rest/v1/quizzes?select=*,content_nodes(name)&is_active=eq.true&order=id.desc`;
    const res  = await fetch(url, { headers: QZ_HDRS() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const quizzes = await res.json();

    if (loadEl) loadEl.style.display = 'none';

    if (!quizzes.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    const colors = ['#a855f7','#f0a500','#00d4aa','#4e9af1','#f97316','#e879f9','#22c55e'];
    // db-quiz-grid is a legacy hidden element — quizzes are shown inside
    // the module overlay's Assessment tab via _loadMktQuizPanel().
    // We only cache the data here; do NOT make db-quiz-grid visible on
    // the main training page.
    gridEl.innerHTML = quizzes.map((q, i) => {
      const col   = colors[i % colors.length];
      const mod   = (q.content_nodes && q.content_nodes.name) ? q.content_nodes.name : 'General';
      const tl    = q.time_limit ? `${q.time_limit} min` : '—';
      const pass  = q.passing_score ? `${q.passing_score}%` : '60%';
      return `
        <div onclick="openQuizPreview(${q.id})" style="cursor:pointer;background:var(--surface);border:1.5px solid ${col}33;border-top:3px solid ${col};border-radius:14px;padding:20px;transition:all 0.2s;position:relative;"
          onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 10px 30px rgba(0,0,0,0.25)';this.style.borderColor='${col}88'"
          onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor='${col}33'">
          ${_canUploadQuiz()?`<button onclick="event.stopPropagation();toggleQuizActive(${q.id},false)" title="Deactivate quiz" style="position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:7px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;font-size:0.75rem;display:flex;align-items:center;justify-content:center;">🗑</button>`:''}
          <div style="width:44px;height:44px;border-radius:12px;background:${col}22;border:1px solid ${col}44;display:flex;align-items:center;justify-content:center;font-size:1.4rem;margin-bottom:14px;">📝</div>
          <div style="font-size:1rem;font-weight:800;color:var(--text);margin-bottom:6px;">${q.title}</div>
          <div style="font-size:0.79rem;color:var(--muted);line-height:1.5;margin-bottom:14px;">${q.description||'Test your knowledge on '+mod}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
            <span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;background:${col}18;color:${col};font-weight:700;border:1px solid ${col}33;">⏱ ${tl}</span>
            <span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;background:rgba(34,197,94,0.12);color:#22c55e;font-weight:700;border:1px solid rgba(34,197,94,0.3);">🎯 Pass: ${pass}</span>
            <span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;background:rgba(78,154,241,0.12);color:#4e9af1;font-weight:700;border:1px solid rgba(78,154,241,0.3);">📚 ${mod}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:0.78rem;font-weight:800;color:${col};">Take Quiz →</span>
          </div>
        </div>`;
    }).join('');

    // ✅ FIX: Do NOT set gridEl.style.display = 'grid' here.
    // Quiz cards must only appear inside the overlay Assessment tab,
    // NOT as separate cards below module cards on the training main page.
    // gridEl stays display:none always.

  } catch(e) {
    if (loadEl) loadEl.style.display = 'none';
    // ✅ FIX: Do NOT show emptyEl on the main training page either.
  }
}

// ── Training page tab switch ─────────────────────────────────────────────
function switchTrainingTab(tab) {
  const vidTab  = document.getElementById('training-tab-videos');
  const assTab  = document.getElementById('training-tab-assessment');
  const btnVid  = document.getElementById('tab-btn-videos');
  const btnAss  = document.getElementById('tab-btn-assessment');
  if (!vidTab || !assTab) return;

  if (tab === 'videos') {
    vidTab.style.display = 'block';
    assTab.style.display = 'none';
    btnVid.style.background = 'rgba(0,212,255,0.15)';
    btnVid.style.color      = '#00d4ff';
    btnVid.style.fontWeight = '800';
    btnAss.style.background = 'transparent';
    btnAss.style.color      = 'var(--muted)';
    btnAss.style.fontWeight = '700';
  } else {
    vidTab.style.display = 'none';
    assTab.style.display = 'block';
    btnAss.style.background = 'rgba(168,85,247,0.15)';
    btnAss.style.color      = '#a855f7';
    btnAss.style.fontWeight = '800';
    btnVid.style.background = 'transparent';
    btnVid.style.color      = 'var(--muted)';
    btnVid.style.fontWeight = '700';
    // load quizzes the first time Assessment tab is opened
    if (!_quizzesLoaded) loadTrainingQuizzes();
  }
}

// Hook into training panel load
const _origLoadTraining = window.loadTrainingSection;
window.loadTrainingSection = async function() {
  if (_origLoadTraining) await _origLoadTraining.apply(this, arguments);
  // Show Create Quiz + Grade Attempts + Upload buttons in header only to Hemant & Krishna
  if (_canUploadQuiz()) {
    const hdrBtn = document.getElementById('training-create-quiz-btn');
    if (hdrBtn) hdrBtn.style.display = 'flex';
    const gradeBtn = document.getElementById('training-grade-btn');
    if (gradeBtn) gradeBtn.style.display = 'flex';
    const uploadBtn = document.getElementById('training-upload-btn');
    if (uploadBtn) uploadBtn.style.display = 'flex';
  }
};

// ══════════════════════════════════════════════════════════════
// QUIZ INFO PREVIEW POPUP
// ══════════════════════════════════════════════════════════════
let _previewQuizId       = null;
let _previewFromOverlay  = false;

async function openQuizPreview(quizId) {
  _previewQuizId      = quizId;
  _previewFromOverlay = false;

  // Show popup with loading state
  document.getElementById('quiz-preview-backdrop').style.display = 'block';
  document.getElementById('quiz-preview-modal').style.display    = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('qp-title').textContent    = 'Loading…';
  document.getElementById('qp-module').textContent   = '';
  document.getElementById('qp-desc').textContent     = '';
  document.getElementById('qp-qs-count').textContent = '…';
  document.getElementById('qp-time-val').textContent = '…';
  document.getElementById('qp-pass-val').textContent = '…';
  document.getElementById('qp-types-wrap').style.display = 'none';
  document.getElementById('qp-start-btn').disabled   = true;

  try {
    // Fetch quiz meta
    const qRes  = await fetch(`${SUPABASE_URL}/rest/v1/quizzes?id=eq.${quizId}&select=*,content_nodes(name)`, { headers: QZ_HDRS() });
    const qArr  = await qRes.json();
    const quiz  = qArr[0];
    if (!quiz) throw new Error('Quiz not found');

    // Fetch question types + count
    const qqRes = await fetch(`${SUPABASE_URL}/rest/v1/questions?quiz_id=eq.${quizId}&select=id,question_type`, { headers: QZ_HDRS() });
    const qqArr = await qqRes.json();

    const mod   = quiz.content_nodes?.name || 'General';
    const col   = '#a855f7';

    // Populate popup
    document.getElementById('qp-top-bar').style.background   = `linear-gradient(90deg,${col},#7c3aed)`;
    document.getElementById('qp-icon').style.background       = `${col}22`;
    document.getElementById('qp-icon').style.borderColor      = `${col}55`;
    document.getElementById('qp-title').textContent           = quiz.title;
    document.getElementById('qp-module').textContent          = `📚 ${mod}`;
    document.getElementById('qp-desc').textContent            = quiz.description || 'No description provided.';
    document.getElementById('qp-qs-count').textContent        = qqArr.length || '—';
    document.getElementById('qp-time-val').textContent        = quiz.time_limit || '—';
    document.getElementById('qp-pass-val').textContent        = (quiz.passing_score || 60) + '%';

    // Question types badges
    if (qqArr.length) {
      const typeCounts = {};
      qqArr.forEach(q => {
        const t = q.question_type || 'mcq';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
      const typeLabels = { mcq:'MCQ', true_false:'True/False', descriptive:'Descriptive' };
      const typeColors = { mcq:'#a855f7', true_false:'#22c55e', descriptive:'#f0a500' };
      document.getElementById('qp-types').innerHTML = Object.entries(typeCounts).map(([t, cnt]) =>
        `<span style="font-size:0.75rem;padding:4px 11px;border-radius:20px;background:${typeColors[t]||'#4e9af1'}18;color:${typeColors[t]||'#4e9af1'};font-weight:700;border:1px solid ${typeColors[t]||'#4e9af1'}44;">${typeLabels[t]||t} ✕${cnt}</span>`
      ).join('');
      document.getElementById('qp-types-wrap').style.display = 'block';
    }

    document.getElementById('qp-start-btn').disabled = false;

  } catch(e) {
    document.getElementById('qp-desc').textContent     = '⚠️ ' + e.message;
    document.getElementById('qp-qs-count').textContent = '—';
    document.getElementById('qp-start-btn').disabled   = false;
  }
}

function openQuizPreviewFromOverlay(quizId) {
  _previewFromOverlay = true;
  closeMarketingOverlay();
  setTimeout(() => openQuizPreview(quizId), 80);
}

function closeQuizPreview() {
  document.getElementById('quiz-preview-backdrop').style.display = 'none';
  document.getElementById('quiz-preview-modal').style.display    = 'none';
  if (!document.getElementById('quiz-take-overlay') ||
      document.getElementById('quiz-take-overlay').style.display === 'none') {
    document.body.style.overflow = '';
  }
  _previewQuizId      = null;
  _previewFromOverlay = false;
}

function proceedFromPreview() {
  const qid = _previewQuizId;
  // Close preview popup (keep body scroll locked — quiz overlay will handle it)
  document.getElementById('quiz-preview-backdrop').style.display = 'none';
  document.getElementById('quiz-preview-modal').style.display    = 'none';
  _previewQuizId      = null;
  _previewFromOverlay = false;
  if (qid) startDBQuiz(qid);
}

// ══════════════════════════════════════════════════════════════
// START QUIZ
// ══════════════════════════════════════════════════════════════
async function startDBQuiz(quizId) {
  const overlay = document.getElementById('quiz-take-overlay');
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Reset state
  _qzAttemptId    = null;
  _qzCurrentIndex = 0;
  _qzAnswers      = {};

  // Loading UI
  document.getElementById('qt-quiz-title').textContent = 'Loading…';
  document.getElementById('qt-quiz-sub').textContent   = '';
  document.getElementById('qt-question-text').textContent = 'Loading quiz…';
  document.getElementById('qt-options-list').innerHTML  = '';
  document.getElementById('qt-progress-text').textContent = '…';

  try {
    // ── 1. Fetch quiz meta ──────────────────────────────────────────
    const qRes = await fetch(
      `${SUPABASE_URL}/rest/v1/quizzes?id=eq.${quizId}&select=*`,
      { headers: QZ_HDRS() }
    );
    const qArr = await qRes.json();
    if (!Array.isArray(qArr) || !qArr.length) throw new Error('Quiz not found');
    _qzCurrentQuiz = qArr[0];
    _qzRetakeId    = quizId;

    // ── 2. Fetch questions + options ────────────────────────────────
    const qqRes = await fetch(
      `${SUPABASE_URL}/rest/v1/questions?quiz_id=eq.${quizId}&select=*,options(*)&order=id.asc`,
      { headers: QZ_HDRS() }
    );
    _qzQuestions = await qqRes.json();
    if (!_qzQuestions.length) throw new Error('No questions added yet. Ask admin to add questions.');

    // ── 3. Get Employee Emp_id (for attempt tracking) ───────────────
    if (CURRENT_USER?.email && !_qzEmpId) {
      try {
        const eRes = await fetch(
          `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`,
          { headers: QZ_HDRS() }
        );
        const eArr = await eRes.json();
        if (eArr.length) _qzEmpId = eArr[0].Emp_id;
      } catch(e) { }
    }

    // ── 4. Count previous attempts → calculate attempt_number ───────
    // attempt_number = how many times this employee has taken this quiz before + 1
    let attemptNumber = 1;
    try {
      let countUrl = `${SUPABASE_URL}/rest/v1/quiz_attempts?quiz_id=eq.${quizId}&select=id`;
      if (_qzEmpId) countUrl += `&employee_id=eq.${_qzEmpId}`;
      const cRes  = await fetch(countUrl, {
        headers: { ...QZ_HDRS(), 'Prefer': 'count=exact', 'Range': '0-0' }
      });
      const cCount = parseInt(cRes.headers.get('Content-Range')?.split('/')[1] || '0');
      attemptNumber = cCount + 1;
    } catch(e) { }

    // ── 5. Create quiz_attempt record ───────────────────────────────
    // IMPORTANT: Do NOT send score/total_marks — DB Function 4 trigger sets these
    const attemptBody = {
      quiz_id:        quizId,
      attempt_number: attemptNumber,
      started_at:     new Date().toISOString()
    };
    // Only add employee_id if we have it (bigint column — must be number)
    if (_qzEmpId) attemptBody.employee_id = _qzEmpId;

    const attRes = await fetch(`${SUPABASE_URL}/rest/v1/quiz_attempts`, {
      method:  'POST',
      headers: QZ_HDRS_REPR(),
      body:    JSON.stringify(attemptBody)
    });

    // ── Error check on attempt INSERT ───────────────────────────────
    if (!attRes.ok) {
      const errBody = await attRes.text();
      throw new Error(`Could not start quiz (${attRes.status}). DB said: ${errBody.substring(0, 120)}`);
    }

    const attArr = await attRes.json();
    _qzAttemptId = Array.isArray(attArr) ? attArr[0]?.id : attArr?.id;

    if (!_qzAttemptId) {
      throw new Error('Quiz attempt record was not created. Check Supabase RLS on quiz_attempts table.');
    }


    // ── 6. Setup UI ─────────────────────────────────────────────────
    const attemptLabel  = attemptNumber > 1 ? ` · Attempt #${attemptNumber}` : '';
    const _qzTotalMarks = _qzQuestions.reduce((s, q) => s + (q.marks || 1), 0);
    const _qzPassPct    = _qzCurrentQuiz.passing_score || 60;
    const _qzPassMarks  = _qzTotalMarks > 0 ? Math.ceil((_qzPassPct / 100) * _qzTotalMarks) : null;
    const _qzPassLabel  = _qzPassMarks ? `Pass: ${_qzPassMarks}/${_qzTotalMarks} marks` : `Pass: ${_qzPassPct}%`;
    document.getElementById('qt-quiz-title').textContent = _qzCurrentQuiz.title;
    document.getElementById('qt-quiz-sub').textContent   =
      `${_qzQuestions.length} questions · ${_qzPassLabel}${attemptLabel}`;

    // ── 7. Start timer + render first question ──────────────────────
    _qzSecondsLeft = (_qzCurrentQuiz.time_limit || 15) * 60;
    startQuizTimer();
    renderQuizQuestion();

  } catch(e) {
    // Show error inside overlay (don't close it — user can see what went wrong)
    document.getElementById('qt-quiz-title').textContent = '⚠️ Failed to Start';
    document.getElementById('qt-question-text').textContent = e.message;
    document.getElementById('qt-options-list').innerHTML =
      `<div style="margin-top:16px;">
        <button onclick="document.getElementById('quiz-take-overlay').style.display='none';document.body.style.overflow='';"
          style="padding:10px 22px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.88rem;font-weight:600;cursor:pointer;font-family:inherit;">
          ← Close
        </button>
      </div>`;
  }
}

function renderQuizQuestion() {
  const total = _qzQuestions.length;
  const idx   = _qzCurrentIndex;
  const qData = _qzQuestions[idx];
  if (!qData) return;

  // Progress
  const pct = Math.round(((idx + 1) / total) * 100);
  document.getElementById('qt-progress-text').textContent = `${idx+1}/${total}`;
  document.getElementById('qt-progress-bar').style.width = pct + '%';
  document.getElementById('qt-q-label').textContent = `Question ${idx+1}`;
  document.getElementById('qt-question-text').textContent = qData.question_text;

  // Options — MCQ or Descriptive
  const qType = qData.question_type || 'mcq';
  const optsList = document.getElementById('qt-options-list');

  if (qType === 'true_false') {
    // ── True/False: show two big buttons ──
    const selId = _qzAnswers[qData.id];
    const opts  = qData.options || [];
    const trueOpt  = opts.find(o => o.option_text === 'True'  || o.option_text === 'true');
    const falseOpt = opts.find(o => o.option_text === 'False' || o.option_text === 'false');
    const trueId   = trueOpt?.id;
    const falseId  = falseOpt?.id;

    optsList.innerHTML = `
      <div style="display:flex;gap:14px;margin-top:6px;">
        <button onclick="selectQuizOption(${qData.id}, ${trueId}, null)" data-opt-id="${trueId}"
          style="flex:1;padding:20px;border-radius:14px;font-size:1.2rem;font-weight:800;cursor:pointer;font-family:inherit;
                 border:2.5px solid ${selId == trueId ? '#22c55e' : 'var(--border)'};
                 background:${selId == trueId ? 'rgba(34,197,94,0.14)' : 'var(--surface2)'};
                 color:${selId == trueId ? '#22c55e' : 'var(--text2)'};transition:all 0.18s;"
          onmouseover="this.style.borderColor='#22c55e';this.style.background='rgba(34,197,94,0.08)'"
          onmouseout="this.style.borderColor='${selId == trueId ? '#22c55e' : 'var(--border)'}';this.style.background='${selId == trueId ? 'rgba(34,197,94,0.14)' : 'var(--surface2)'}'">
          ✅ TRUE
        </button>
        <button onclick="selectQuizOption(${qData.id}, ${falseId}, null)" data-opt-id="${falseId}"
          style="flex:1;padding:20px;border-radius:14px;font-size:1.2rem;font-weight:800;cursor:pointer;font-family:inherit;
                 border:2.5px solid ${selId == falseId ? '#ef4444' : 'var(--border)'};
                 background:${selId == falseId ? 'rgba(239,68,68,0.12)' : 'var(--surface2)'};
                 color:${selId == falseId ? '#ef4444' : 'var(--text2)'};transition:all 0.18s;"
          onmouseover="this.style.borderColor='#ef4444';this.style.background='rgba(239,68,68,0.07)'"
          onmouseout="this.style.borderColor='${selId == falseId ? '#ef4444' : 'var(--border)'}';this.style.background='${selId == falseId ? 'rgba(239,68,68,0.12)' : 'var(--surface2)'}'">
          ❌ FALSE
        </button>
      </div>`;

  } else if (qType === 'descriptive') {
    // ── Descriptive: show textarea ──
    const existingAnswer = _qzAnswers[qData.id]?.text || '';
    optsList.innerHTML = `
      <div style="background:rgba(240,165,0,0.06);border:1.5px solid rgba(240,165,0,0.3);border-radius:12px;padding:14px;">
        <div style="font-size:0.75rem;font-weight:700;color:#f0a500;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">✏️ Write Your Answer</div>
        <textarea id="qt-desc-textarea-${qData.id}"
          oninput="saveDescriptiveAnswer(${qData.id}, this.value)"
          placeholder="Type your answer here…"
          rows="5"
          style="width:100%;padding:11px 13px;border-radius:9px;border:1px solid rgba(240,165,0,0.25);background:var(--surface);color:var(--text);font-size:0.9rem;font-family:inherit;outline:none;resize:vertical;line-height:1.6;"
        >${existingAnswer}</textarea>
        <div style="font-size:0.74rem;color:var(--muted);margin-top:8px;">Write a detailed answer. It will be reviewed by the admin.</div>
      </div>`;
  } else {
    // ── MCQ: show radio options ──
    const opts = qData.options || [];
    const selectedOptId = _qzAnswers[qData.id];
    optsList.innerHTML = opts.map(opt => {
      const isSelected = selectedOptId == opt.id;
      return `
        <div onclick="selectQuizOption(${qData.id}, ${opt.id}, this)" data-opt-id="${opt.id}"
          style="padding:13px 16px;border-radius:11px;border:2px solid ${isSelected ? '#a855f7' : 'var(--border)'};background:${isSelected ? 'rgba(168,85,247,0.12)' : 'var(--surface2)'};cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:12px;"
          onmouseover="if(!this.classList.contains('selected')){this.style.borderColor='rgba(168,85,247,0.5)';this.style.background='rgba(168,85,247,0.06)';}"
          onmouseout="if(!this.classList.contains('selected')){this.style.borderColor='var(--border)';this.style.background='var(--surface2)';}">
          <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${isSelected?'#a855f7':'var(--border)'};background:${isSelected?'#a855f7':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.18s;">
            ${isSelected ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
          <span style="font-size:0.9rem;color:var(--text);line-height:1.5;">${opt.option_text}</span>
        </div>`;
    }).join('');
  }

  // Navigation buttons
  document.getElementById('qt-prev-btn').style.opacity  = idx === 0 ? '0.3' : '1';
  document.getElementById('qt-prev-btn').disabled       = idx === 0;
  document.getElementById('qt-next-btn').style.display  = idx < total - 1 ? 'block' : 'none';
  document.getElementById('qt-submit-wrap').style.display = idx === total - 1 ? 'block' : 'none';

  // Answered count
  const answeredCount = Object.keys(_qzAnswers).length;
  document.getElementById('qt-answered-count').textContent = `${answeredCount}/${total} answered`;
}

function saveDescriptiveAnswer(questionId, text) {
  // Store as object with text key to distinguish from MCQ optionId
  _qzAnswers[questionId] = { text: text.trim() };
  // Update answered count
  const answeredCount = Object.keys(_qzAnswers).filter(k => {
    const v = _qzAnswers[k];
    if (typeof v === 'object') return v.text && v.text.length > 0;
    return !!v;
  }).length;
  const el = document.getElementById('qt-answered-count');
  if (el) el.textContent = `${answeredCount}/${_qzQuestions.length} answered`;
}

function selectQuizOption(questionId, optionId, el) {
  _qzAnswers[questionId] = optionId;
  // Refresh this question's options display
  const allOpts = document.getElementById('qt-options-list').querySelectorAll('[data-opt-id]');
  allOpts.forEach(div => {
    const isThis = parseInt(div.dataset.optId) === optionId;
    div.style.border     = `2px solid ${isThis ? '#a855f7' : 'var(--border)'}`;
    div.style.background = isThis ? 'rgba(168,85,247,0.12)' : 'var(--surface2)';
    div.classList.toggle('selected', isThis);
    const circle = div.querySelector('div');
    if (circle) {
      circle.style.border     = `2px solid ${isThis ? '#a855f7' : 'var(--border)'}`;
      circle.style.background = isThis ? '#a855f7' : 'transparent';
      circle.innerHTML = isThis ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
    }
  });

  // Update answered count
  const answeredCount = Object.keys(_qzAnswers).filter(k => {
    const v = _qzAnswers[k];
    if (typeof v === 'object' && v !== null) return v.text && v.text.length > 0;
    return !!v;
  }).length;
  const acEl = document.getElementById('qt-answered-count');
  if (acEl) acEl.textContent = `${answeredCount}/${_qzQuestions.length} answered`;
}

function qtNavigate(dir) {
  const newIdx = _qzCurrentIndex + dir;
  if (newIdx < 0 || newIdx >= _qzQuestions.length) return;
  _qzCurrentIndex = newIdx;
  renderQuizQuestion();
}

// ── Timer ──
function startQuizTimer() {
  clearInterval(_qzTimerInterval);
  updateTimerDisplay();
  _qzTimerInterval = setInterval(() => {
    _qzSecondsLeft--;
    updateTimerDisplay();
    if (_qzSecondsLeft <= 0) {
      clearInterval(_qzTimerInterval);
      submitDBQuiz(true); // auto-submit on timeout
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(_qzSecondsLeft / 60).toString().padStart(2,'0');
  const s = (_qzSecondsLeft % 60).toString().padStart(2,'0');
  const el = document.getElementById('qt-timer-display');
  if (el) {
    el.textContent = `${m}:${s}`;
    el.style.color = _qzSecondsLeft <= 60 ? '#ef4444' : '#a855f7';
  }
}

// ── Submit Quiz ──
// ── DB Function names (match Supabase Dashboard > Database > Functions)
const QZ_RPC_BULK_ANSWERS = 'submit_quiz_answers'; // ← verify this name in Supabase

// Helper: fetch with a timeout (default 15 s) so we never hang forever
function _fetchWithTimeout(url, options, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

async function submitDBQuiz(autoSubmit = false) {
  clearInterval(_qzTimerInterval);

  const answered = _qzQuestions.filter(q => {
    const v = _qzAnswers[q.id];
    if (typeof v === 'object' && v !== null) return v.text && v.text.trim().length > 0;
    return v !== undefined && v !== null;
  });

  if (!autoSubmit) {
    const unanswered = _qzQuestions.length - answered.length;
    if (unanswered > 0) {
      const go = confirm(`${unanswered} question(s) unanswered. Submit anyway?`);
      if (!go) return;
    }
  }

  const submitBtn = document.getElementById('qt-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

  try {
    if (!_qzAttemptId) throw new Error('Quiz attempt ID missing. Please restart the quiz.');

    // ── Build payloads
    const mcqRows  = [];
    const descRows = [];

    _qzQuestions.forEach(q => {
      const qType     = (q.question_type || 'mcq').toLowerCase();
      const answerVal = _qzAnswers[q.id];

      if (qType === 'descriptive') {
        const text = (typeof answerVal === 'object' && answerVal?.text)
          ? answerVal.text.trim() : null;
        descRows.push({ attempt_id: _qzAttemptId, question_id: q.id, answer_text: text });
      } else {
        const selId = (answerVal !== null && answerVal !== undefined
          && typeof answerVal !== 'object') ? parseInt(answerVal) : null;
        mcqRows.push({ attempt_id: _qzAttemptId, question_id: q.id, selected_option_id: selId });
      }
    });

    // ── Step 1: MCQ + True/False via RPC with fallback
    if (mcqRows.length > 0) {
      let rpcOk = false;
      try {
        const rpcRes = await _fetchWithTimeout(
          `${SUPABASE_URL}/rest/v1/rpc/${QZ_RPC_BULK_ANSWERS}`,
          { method: 'POST', headers: QZ_HDRS(), body: JSON.stringify({ payload: mcqRows }) }
        );
        rpcOk = rpcRes.ok || rpcRes.status === 204;
        if (!rpcOk) {
          const rb = await rpcRes.text().catch(() => '');
        }
      } catch(rpcErr) {
      }

      if (!rpcOk) {
        const insRes = await _fetchWithTimeout(
          `${SUPABASE_URL}/rest/v1/answers`,
          { method: 'POST', headers: QZ_HDRS_MINIMAL(), body: JSON.stringify(mcqRows) }
        );
        if (!insRes.ok) {
          const errTxt = await insRes.text().catch(() => String(insRes.status));
          throw new Error(`MCQ answers failed (${insRes.status}): ${errTxt}`);
        }
      }
    }

    // ── Step 2: Descriptive answers
    if (descRows.length > 0) {
      const dRes = await _fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/answers`,
        { method: 'POST', headers: QZ_HDRS_MINIMAL(), body: JSON.stringify(descRows) }
      );
      if (!dRes.ok) {
        const errTxt = await dRes.text().catch(() => String(dRes.status));
        throw new Error(`Descriptive answers failed (${dRes.status}): ${errTxt}`);
      }
    }

    // ── Step 3: Calculate correct MCQ score from local state (don't rely on DB trigger marks)
    let mcqScore = 0;
    let totalMarks = 0;
    _qzQuestions.forEach(q => {
      const qType = (q.question_type || 'mcq').toLowerCase();
      const qMarks = q.marks || 1;
      totalMarks += qMarks;
      if (qType === 'descriptive') return; // descriptive = 0 until manually graded
      const selId  = _qzAnswers[q.id];
      const corrOpt = (q.options || []).find(o => o.is_correct);
      if (selId && corrOpt && parseInt(selId) === corrOpt.id) {
        mcqScore += qMarks; // award full question marks for correct answer
      }
    });

    // Patch submitted_at + correct score + total_marks all in one call
    await _fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/quiz_attempts?id=eq.${_qzAttemptId}`,
      { method: 'PATCH', headers: QZ_HDRS_MINIMAL(), body: JSON.stringify({
          submitted_at: new Date().toISOString(),
          score:        mcqScore,
          total_marks:  totalMarks
        })
      }
    );

    // ── Step 4: Show result using our calculated score (no need to wait for DB)
    const dbScore = mcqScore;
    const dbTotal = totalMarks;

    document.getElementById('quiz-take-overlay').style.display = 'none';
    document.body.style.overflow = '';
    showQuizResult(dbScore, dbTotal, null, _qzQuestions.length);

  } catch(e) {
    const msg = e.name === 'AbortError'
      ? '⏱️ Request timed out. Please check your internet connection and try again.'
      : '⚠️ Error submitting quiz:\n' + e.message;
    alert(msg);
  } finally {
    // ALWAYS re-enable the button so the user is never stuck
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✅ Submit Quiz'; }
  }
}

function showQuizResult(earned, total, correct, totalQ) {
  const mcqQs  = _qzQuestions.filter(q => (q.question_type||'mcq').toLowerCase() !== 'descriptive');
  const descQs = _qzQuestions.filter(q => (q.question_type||'mcq').toLowerCase() === 'descriptive');

  // Use total quiz marks (all questions) as denominator so score is out of full quiz
  // `total` comes from the patched total_marks on the attempt (sum of all question marks)
  // `earned` = MCQ marks earned (descriptive = 0 until MIS grades)
  const fullTotal    = total > 0 ? total : _qzQuestions.reduce((s,q) => s+(q.marks||1), 0);
  const pct          = fullTotal > 0 ? Math.round((earned / fullTotal) * 100) : 0;
  const passing      = _qzCurrentQuiz?.passing_score || 60;
  const passingMarks = fullTotal > 0 ? Math.ceil((passing / 100) * fullTotal) : null;
  const passed       = pct >= passing;

  // Count correct MCQ/TF from local state (for display only)
  let correctCount = 0;
  mcqQs.forEach(q => {
    const selId   = _qzAnswers[q.id];
    const corrOpt = (q.options || []).find(o => o.is_correct);
    if (selId && corrOpt && selId == corrOpt.id) correctCount++;
  });
  const wrongCount = mcqQs.length - correctCount;

  document.getElementById('qr-emoji').style.display = 'none';
  const banner = document.getElementById('qr-result-banner');
  if (descQs.length > 0) {
    banner.textContent = '📋 Submitted — Grading in Progress';
    banner.style.cssText = 'display:inline-block;padding:8px 24px;border-radius:30px;font-size:0.85rem;font-weight:800;letter-spacing:0.04em;margin-bottom:12px;background:rgba(240,165,0,0.12);color:#f0a500;border:1.5px solid rgba(240,165,0,0.35);';
  } else if (passed) {
    banner.textContent = '✅ Quiz Submitted Successfully';
    banner.style.cssText = 'display:inline-block;padding:8px 24px;border-radius:30px;font-size:0.85rem;font-weight:800;letter-spacing:0.04em;margin-bottom:12px;background:rgba(34,197,94,0.12);color:#22c55e;border:1.5px solid rgba(34,197,94,0.35);';
  } else {
    banner.textContent = '📝 Quiz Submitted Successfully';
    banner.style.cssText = 'display:inline-block;padding:8px 24px;border-radius:30px;font-size:0.85rem;font-weight:800;letter-spacing:0.04em;margin-bottom:12px;background:rgba(168,85,247,0.1);color:#a855f7;border:1.5px solid rgba(168,85,247,0.3);';
  }
  document.getElementById('qr-title').textContent = passed && !descQs.length ? 'Excellent! You Passed!' : 'Quiz Completed';
  const subEl = document.getElementById('qt-quiz-sub');
  const attMatch = subEl ? (subEl.textContent.match(/Attempt #(\d+)/) || []) : [];
  const attNumStr = attMatch[1] ? ` · Attempt #${attMatch[1]}` : '';
  document.getElementById('qr-subtitle').textContent = `${_qzCurrentQuiz?.title || 'Quiz'}${attNumStr} · ${passed ? '🎉 You cleared the passing score!' : `Need ${passingMarks ?? passing+'%'} marks to pass`}`;
  document.getElementById('qr-score-pct').textContent = pct + '%';
  document.getElementById('qr-score-pct').style.color = passed ? '#22c55e' : (descQs.length > 0 ? '#f0a500' : '#ef4444');
  const ptsEl = document.getElementById('qr-score-pts');
  if (ptsEl) ptsEl.textContent = `${earned}/${fullTotal} pts${descQs.length > 0 ? ' (partial)' : ''}`;
  document.getElementById('qr-correct').textContent   = correctCount;
  document.getElementById('qr-wrong').textContent     = wrongCount;

  const badge = document.getElementById('qr-badge');
  if (descQs.length > 0) {
    // Has descriptive — score is partial, show pending note
    badge.textContent = '⏳ Partial Score';
    badge.style.cssText = 'display:inline-block;padding:8px 28px;border-radius:30px;background:rgba(240,165,0,0.12);color:#f0a500;border:2px solid rgba(240,165,0,0.35);font-size:0.9rem;font-weight:800;margin-bottom:8px;letter-spacing:0.05em;';
    // Inject descriptive pending note below badge
    const noteId = 'qr-desc-pending-note';
    let noteEl = document.getElementById(noteId);
    if (!noteEl) {
      noteEl = document.createElement('div');
      noteEl.id = noteId;
      badge.parentNode.insertBefore(noteEl, badge.nextSibling);
    }
    noteEl.style.cssText = 'font-size:0.8rem;color:#f0a500;background:rgba(240,165,0,0.08);border:1px solid rgba(240,165,0,0.25);border-radius:9px;padding:8px 14px;margin-bottom:20px;text-align:center;';
    noteEl.innerHTML = `📝 ${descQs.length} descriptive question${descQs.length>1?'s':''} pending manual review by MIS.<br>Your final score will be updated after grading.`;
  } else {
    const noteEl = document.getElementById('qr-desc-pending-note');
    if (noteEl) noteEl.style.display = 'none';
    if (passed) {
      badge.textContent = '✅ PASSED';
      badge.style.cssText = 'display:inline-block;padding:8px 28px;border-radius:30px;background:rgba(34,197,94,0.15);color:#22c55e;border:2px solid rgba(34,197,94,0.4);font-size:0.9rem;font-weight:800;margin-bottom:24px;letter-spacing:0.05em;';
    } else {
      badge.textContent = '❌ FAILED';
      badge.style.cssText = 'display:inline-block;padding:8px 28px;border-radius:30px;background:rgba(239,68,68,0.12);color:#ef4444;border:2px solid rgba(239,68,68,0.35);font-size:0.9rem;font-weight:800;margin-bottom:24px;letter-spacing:0.05em;';
    }
  }

  // Answer review
  const reviewEl = document.getElementById('qr-review-list');
  reviewEl.innerHTML = _qzQuestions.map((q, i) => {
    const qType     = (q.question_type || 'mcq').toLowerCase();
    const answerVal = _qzAnswers[q.id];

    if (qType === 'true_false') {
      // ── True/False review ──
      const selId   = (typeof answerVal === 'number' || typeof answerVal === 'string') ? parseInt(answerVal) : null;
      const corrOpt = (q.options || []).find(o => o.is_correct);
      const selOpt  = (q.options || []).find(o => o.id == selId);
      const isOk    = !!(selId && corrOpt && selId == corrOpt.id);
      return `
        <div style="padding:12px 14px;border-radius:10px;background:var(--surface2);border-left:3px solid ${isOk?'#22c55e':'#ef4444'};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <span style="font-size:0.72rem;padding:2px 8px;border-radius:20px;background:rgba(34,197,94,0.1);color:#22c55e;font-weight:700;">🔘 True/False</span>
          </div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--text);margin-bottom:6px;">${i+1}. ${q.question_text}</div>
          <div style="font-size:0.78rem;margin-bottom:3px;">
            <span style="color:var(--muted);">Your answer: </span>
            <span style="color:${isOk?'#22c55e':'#ef4444'};font-weight:600;">${selOpt ? selOpt.option_text : '(not answered)'}</span>
          </div>
          ${!isOk && corrOpt ? `<div style="font-size:0.78rem;"><span style="color:var(--muted);">Correct: </span><span style="color:#22c55e;font-weight:600;">${corrOpt.option_text}</span></div>` : ''}
        </div>`;

    } else if (qType === 'descriptive') {
      // ── Descriptive review ──
      const text = (typeof answerVal === 'object' && answerVal?.text) ? answerVal.text : '(not answered)';
      return `
        <div style="padding:12px 14px;border-radius:10px;background:var(--surface2);border-left:3px solid #f0a500;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:0.75rem;padding:2px 8px;border-radius:20px;background:rgba(240,165,0,0.12);color:#f0a500;font-weight:700;">✏️ Descriptive</span>
          </div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--text);margin-bottom:6px;">${i+1}. ${q.question_text}</div>
          <div style="font-size:0.79rem;color:var(--text2);background:var(--surface);padding:9px 11px;border-radius:8px;line-height:1.6;border:1px solid var(--border);">${text}</div>
          <div style="font-size:0.72rem;color:var(--muted);margin-top:5px;">📋 Admin will review this answer manually.</div>
        </div>`;

    } else {
      // ── MCQ review ──
      const selectedId  = (typeof answerVal === 'number' || typeof answerVal === 'string') ? parseInt(answerVal) : null;
      const correctOpt  = (q.options || []).find(o => o.is_correct);
      const selectedOpt = (q.options || []).find(o => o.id == selectedId);
      const isCorrect   = !!(selectedId && correctOpt && selectedId == correctOpt.id);
      return `
        <div style="padding:12px 14px;border-radius:10px;background:var(--surface2);border-left:3px solid ${isCorrect?'#22c55e':'#ef4444'};">
          <div style="font-size:0.82rem;font-weight:700;color:var(--text);margin-bottom:6px;">${i+1}. ${q.question_text}</div>
          <div style="font-size:0.78rem;margin-bottom:3px;">
            <span style="color:var(--muted);">Your answer: </span>
            <span style="color:${isCorrect?'#22c55e':'#ef4444'};font-weight:600;">${selectedOpt ? selectedOpt.option_text : '(not answered)'}</span>
          </div>
          ${!isCorrect && correctOpt ? `<div style="font-size:0.78rem;"><span style="color:var(--muted);">Correct: </span><span style="color:#22c55e;font-weight:600;">${correctOpt.option_text}</span></div>` : ''}
        </div>`;
    }
  }).join('');

  document.getElementById('quiz-result-overlay').style.display = 'block';
}

function closeQuizResult() {
  document.getElementById('quiz-result-overlay').style.display = 'none';
  _qzCurrentQuiz = null; _qzQuestions = []; _qzAttemptId = null;
}

function retakeQuiz() {
  document.getElementById('quiz-result-overlay').style.display = 'none';
  if (_qzRetakeId) startDBQuiz(_qzRetakeId);
}

function confirmQuitQuiz() {
  if (confirm('Are you sure you want to quit this quiz? Your progress will be lost.')) {
    clearInterval(_qzTimerInterval);
    document.getElementById('quiz-take-overlay').style.display = 'none';
    document.body.style.overflow = '';
    _qzCurrentQuiz = null; _qzQuestions = []; _qzAnswers = {};
  }
}

// ══════════════════════════════════════════════════════════════
// MY RESULTS
// ══════════════════════════════════════════════════════════════
let _mqrAllRows = [];
let _mqrGradedMap   = {};   // attemptId → true (fully graded) / false (has ungraded descriptive answer)
let _mqrQuizHasDesc = {};   // quizId → true if quiz has any descriptive question

async function openMyQuizResults(nodeId) {
  const overlay = document.getElementById('my-quiz-results-overlay');
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  const loadEl      = document.getElementById('mqr-loading');
  const listEl      = document.getElementById('mqr-list');
  const emptyEl     = document.getElementById('mqr-empty');
  const statsEl     = document.getElementById('mqr-stats');
  const filterEl    = document.getElementById('mqr-quiz-filter');
  const nameFilterEl= document.getElementById('mqr-name-filter');

  loadEl.style.display = 'block'; listEl.innerHTML = ''; emptyEl.style.display = 'none';
  if (statsEl) statsEl.style.display = 'none';

  const isMIS = _canUploadQuiz();
  const titleEl = document.querySelector('#my-quiz-results-overlay .mqr-title');
  const subEl   = document.querySelector('#my-quiz-results-overlay .mqr-sub');
  if (titleEl) titleEl.textContent = isMIS ? 'All Quiz Results' : 'My Quiz Results';
  if (subEl)   subEl.textContent   = isMIS ? 'All employees quiz attempts and performance' : 'Your quiz attempts and performance';

  // ── Name filter: MIS ke liye turant dikhao (data aane se pehle bhi) ──
  if (nameFilterEl) {
    nameFilterEl.style.display = isMIS ? 'block' : 'none';
    nameFilterEl.innerHTML = '<option value="">👤 All Employees</option>';
    nameFilterEl.value = '';
  }
  if (filterEl) {
    filterEl.innerHTML = '<option value="">📝 All Quizzes</option>';
    filterEl.value = '';
  }

  try {
    let empFilter = '';
    if (!isMIS) {
      if (_qzEmpId) {
        empFilter = `&employee_id=eq.${_qzEmpId}`;
      } else if (CURRENT_USER?.email) {
        const eRes = await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`, { headers: QZ_HDRS() });
        const eArr = await eRes.json();
        if (eArr.length) { _qzEmpId = eArr[0].Emp_id; empFilter = `&employee_id=eq.${_qzEmpId}`; }
      }
      // SAFETY GUARD: agar non-MIS user ka emp_id nahi mila toh
      // kisi aur ka data dikhne se rokne ke liye empty result return karo
      if (!empFilter) {
        loadEl.style.display = 'none';
        emptyEl.style.display = 'block';
        _mqrAllRows = [];
        return;
      }
    }
    const empSelect = isMIS ? ',Employee_details(Employee_name,Employee_Dept)' : '';
    const url = `${SUPABASE_URL}/rest/v1/quiz_attempts?select=id,quiz_id,employee_id,attempt_number,score,total_marks,started_at,submitted_at,quizzes(id,title,passing_score)${empSelect}${empFilter}&order=id.desc&limit=200`;
    const res  = await fetch(url, { headers: QZ_HDRS() });
    _mqrAllRows = await res.json();
    loadEl.style.display = 'none';

    // ── Determine which quizzes have descriptive questions, and which
    //    attempts have fully-graded descriptive answers (0 marks counts as
    //    graded — only an actual NULL marks_awarded means still pending) ──
    _mqrGradedMap = {}; _mqrQuizHasDesc = {};
    const mqrQuizIds = [...new Set(_mqrAllRows.map(r => r.quiz_id).filter(Boolean))];
    if (mqrQuizIds.length) {
      const qqRes = await fetch(
        `${SUPABASE_URL}/rest/v1/questions?select=quiz_id,question_type&quiz_id=in.(${mqrQuizIds.join(',')})`,
        { headers: QZ_HDRS() }
      );
      const mqrQs = await qqRes.json();
      mqrQs.forEach(q => {
        if ((q.question_type || '').toLowerCase() === 'descriptive') _mqrQuizHasDesc[q.quiz_id] = true;
      });
    }
    const mqrAttemptIds = _mqrAllRows.map(r => r.id);
    if (mqrAttemptIds.length) {
      const ansRes = await fetch(
        `${SUPABASE_URL}/rest/v1/answers?select=attempt_id,marks_awarded,questions(question_type)&attempt_id=in.(${mqrAttemptIds.join(',')})`,
        { headers: QZ_HDRS() }
      );
      const mqrAnswers = await ansRes.json();
      mqrAnswers.forEach(ans => {
        const qType = (ans.questions?.question_type || '').toLowerCase();
        if (qType !== 'descriptive') return;
        if (!(ans.attempt_id in _mqrGradedMap)) _mqrGradedMap[ans.attempt_id] = true;
        if (ans.marks_awarded == null) _mqrGradedMap[ans.attempt_id] = false;
      });
    }

    // ── Quiz filter populate ──
    if (filterEl) {
      const quizMap = {};
      _mqrAllRows.forEach(r => { if (r.quizzes?.id) quizMap[r.quizzes.id] = r.quizzes.title; });
      filterEl.innerHTML = '<option value="">📝 All Quizzes</option>' +
        Object.entries(quizMap).map(([id, title]) => `<option value="${id}">${title}</option>`).join('');
    }

    // ── Name filter populate (MIS only) — data aane ke baad names fill karo ──
    if (isMIS && nameFilterEl && _mqrAllRows.length) {
      const nameSet = new Set();
      _mqrAllRows.forEach(r => {
        const n = r.Employee_details?.Employee_name;
        if (n) nameSet.add(n);
      });
      const sortedNames = [...nameSet].sort((a, b) => a.localeCompare(b));
      nameFilterEl.innerHTML = '<option value="">👤 All Employees</option>' +
        sortedNames.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    if (!_mqrAllRows.length) { emptyEl.style.display = 'block'; return; }

    mqrRenderStats(_mqrAllRows);
    mqrRenderList(_mqrAllRows);
  } catch(e) {
    loadEl.style.display = 'none';
    listEl.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">Error: ${e.message}</div>`;
  }
}

function mqrApplyFilter() {
  const quizVal = document.getElementById('mqr-quiz-filter')?.value || '';
  const nameVal = document.getElementById('mqr-name-filter')?.value || '';
  let filtered = _mqrAllRows;
  if (quizVal) filtered = filtered.filter(r => String(r.quizzes?.id) === quizVal);
  if (nameVal) filtered = filtered.filter(r => (r.Employee_details?.Employee_name || '') === nameVal);
  mqrRenderStats(filtered);
  mqrRenderList(filtered);
}

function mqrClearFilters() {
  const qf = document.getElementById('mqr-quiz-filter');
  const nf = document.getElementById('mqr-name-filter');
  if (qf) qf.value = '';
  if (nf) nf.value = '';
  mqrRenderStats(_mqrAllRows);
  mqrRenderList(_mqrAllRows);
}

function mqrRenderStats(rows) {
  const statsEl = document.getElementById('mqr-stats');
  if (!statsEl) return;
  const sub     = rows.filter(r => r.submitted_at);
  const isMqrPending = r => {
    const hasDesc = !!_mqrQuizHasDesc[r.quiz_id];
    return hasDesc && ((r.score??0) === 0 || _mqrGradedMap[r.id] === false);
  };
  const pending = sub.filter(isMqrPending);
  const passed  = sub.filter(r => {
    if (isMqrPending(r)) return false;
    return r.total_marks>0 ? Math.round((r.score/r.total_marks)*100) >= (r.quizzes?.passing_score||60) : false;
  });
  const failed  = sub.filter(r => {
    if (isMqrPending(r)) return false;
    return r.total_marks>0 ? Math.round((r.score/r.total_marks)*100) < (r.quizzes?.passing_score||60) : false;
  });
  const cards = [
    { label:'Total Attempts', value:rows.length,   icon:'📋', color:'#4e9af1', bg:'rgba(78,154,241,0.1)',  border:'rgba(78,154,241,0.25)' },
    { label:'Passed',         value:passed.length,  icon:'✅', color:'#22c55e', bg:'rgba(34,197,94,0.1)',   border:'rgba(34,197,94,0.25)'  },
    { label:'Failed',         value:failed.length,  icon:'❌', color:'#ef4444', bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.2)'   },
    { label:'Pending',        value:pending.length, icon:'⏳', color:'#f97316', bg:'rgba(249,115,22,0.08)', border:'rgba(249,115,22,0.2)'  },
  ];
  statsEl.innerHTML = cards.map(c =>
    `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:14px 16px;text-align:center;">
      <div style="font-size:1.3rem;margin-bottom:4px;">${c.icon}</div>
      <div style="font-size:1.7rem;font-weight:900;color:${c.color};line-height:1;">${c.value}</div>
      <div style="font-size:0.69rem;color:var(--muted);font-weight:600;margin-top:5px;text-transform:uppercase;letter-spacing:0.05em;">${c.label}</div>
    </div>`).join('');
  statsEl.style.display = 'grid';
}

function mqrRenderList(rows) {
  const listEl  = document.getElementById('mqr-list');
  const emptyEl = document.getElementById('mqr-empty');
  listEl.innerHTML = '';
  if (!rows.length) { emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  const isMIS = _canUploadQuiz();
  listEl.innerHTML = rows.map(r => {
    const pct       = r.total_marks>0 ? Math.round((r.score/r.total_marks)*100) : 0;
    const passScore = r.quizzes?.passing_score || 60;
    const inProg    = !r.submitted_at;
    const hasDesc   = !!_mqrQuizHasDesc[r.quiz_id];
    const isPending = !inProg && hasDesc && ((r.score??0) === 0 || _mqrGradedMap[r.id] === false);
    const passed    = !inProg && !isPending && pct >= passScore;
    const borderCol = inProg?'#f0a500':isPending?'#f97316':passed?'#22c55e':'#ef4444';
    const statusBg  = inProg?'rgba(240,165,0,0.1)':isPending?'rgba(249,115,22,0.1)':passed?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.08)';
    const statusTxt = inProg?'🔄 In Progress':isPending?'⏳ Pending':passed?'✅ Pass':'❌ Fail';
    const date = r.submitted_at
      ? new Date(r.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
      : r.started_at ? new Date(r.started_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    const empRow = isMIS && r.Employee_details?.Employee_name
      ? `<div style="font-size:0.7rem;color:#a855f7;font-weight:700;margin-bottom:3px;">👤 ${r.Employee_details.Employee_name}${r.Employee_details?.Employee_Dept?' · '+r.Employee_details.Employee_Dept:''}</div>`
      : '';
    return `
      <div style="border-radius:12px;border:1px solid var(--border);border-left:3px solid ${borderCol};background:var(--surface2);overflow:hidden;">
        <div onclick="mqrToggleDetail(${r.id})" style="display:flex;align-items:center;gap:12px;padding:13px 16px;cursor:pointer;transition:background 0.15s;flex-wrap:wrap;"
          onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''">
          <div style="flex:1;min-width:150px;">
            ${empRow}
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:2px;">
              <span style="font-size:0.87rem;font-weight:700;color:var(--text);">${r.quizzes?.title||'Quiz'}</span>
              <span style="font-size:0.67rem;padding:1px 7px;border-radius:10px;background:rgba(168,85,247,0.12);color:#a855f7;font-weight:700;border:1px solid rgba(168,85,247,0.2);white-space:nowrap;">Attempt #${r.attempt_number||1}</span>
            </div>
            <div style="font-size:0.71rem;color:var(--muted);">📅 ${date}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.1rem;font-weight:900;color:${borderCol};">${inProg?'—':pct+'%'}</div>
            <div style="font-size:0.67rem;color:var(--muted);">${r.score??0}/${r.total_marks??0} pts</div>
          </div>
          <div style="font-size:0.74rem;font-weight:800;padding:4px 12px;border-radius:20px;background:${statusBg};color:${borderCol};">${statusTxt}</div>
          <span id="mqr-chevron-${r.id}" style="font-size:0.72rem;color:var(--muted);transition:transform 0.2s;">▼</span>
        </div>
        <div id="mqr-detail-${r.id}" style="display:none;border-top:1px solid var(--border);padding:14px 16px;background:var(--surface);">
          <div id="mqr-detail-content-${r.id}">
            <div style="text-align:center;padding:14px;color:var(--muted);font-size:0.82rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto 6px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function mqrToggleDetail(attemptId) {
  const panel = document.getElementById(`mqr-detail-${attemptId}`);
  const chev  = document.getElementById(`mqr-chevron-${attemptId}`);
  if (!panel) return;
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  if (!open) await mqrLoadAnswers(attemptId);
}

async function mqrLoadAnswers(attemptId) {
  const container = document.getElementById(`mqr-detail-content-${attemptId}`);
  if (!container) return;
  try {
    const ansRes = await fetch(
      `${SUPABASE_URL}/rest/v1/answers?select=id,answer_text,marks_awarded,selected_option_id,questions(id,question_text,question_type,marks,correct_answer_text),options!answers_selected_option_id_fkey(option_text,is_correct)&attempt_id=eq.${attemptId}&order=id.asc`,
      { headers: QZ_HDRS() }
    );
    const answers = await ansRes.json();
    if (!answers.length) { container.innerHTML = '<div style="text-align:center;padding:14px;color:var(--muted);font-size:0.82rem;">No answers recorded.</div>'; return; }

    const qIds = [...new Set(answers.map(a => a.questions?.id).filter(Boolean))];
    let allOpts = [];
    if (qIds.length) {
      const or = await fetch(`${SUPABASE_URL}/rest/v1/options?select=id,question_id,option_text,is_correct&question_id=in.(${qIds.join(',')})`, { headers: QZ_HDRS() });
      allOpts = await or.json();
    }

    let html = `<div style="font-size:0.73rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">Your Answers</div>`;
    answers.forEach((ans, idx) => {
      const qType  = (ans.questions?.question_type || 'mcq').toLowerCase();
      const qText  = ans.questions?.question_text || `Q${idx+1}`;
      const qMarks = ans.questions?.marks || 1;
      const qId    = ans.questions?.id;
      const selOptId = ans.selected_option_id;
      const selOpt   = ans.options;
      const isRight  = selOpt?.is_correct === true;
      const opts     = allOpts.filter(o => o.question_id === qId);
      const modelAns = ans.questions?.correct_answer_text || '';

      const badge = qType==='descriptive'
        ? `<span style="font-size:0.63rem;padding:1px 6px;border-radius:6px;background:rgba(240,165,0,0.12);color:#f0a500;font-weight:700;">✏️ Descriptive</span>`
        : qType==='true_false'
        ? `<span style="font-size:0.63rem;padding:1px 6px;border-radius:6px;background:rgba(34,197,94,0.12);color:#22c55e;font-weight:700;">🔘 T/F</span>`
        : `<span style="font-size:0.63rem;padding:1px 6px;border-radius:6px;background:rgba(168,85,247,0.12);color:#a855f7;font-weight:700;">☑ MCQ</span>`;

      if (qType === 'descriptive') {
        const awarded = ans.marks_awarded != null ? `${ans.marks_awarded}/${qMarks}` : `Pending/${qMarks}`;
        const aColor  = ans.marks_awarded != null ? '#22c55e' : '#f97316';
        html += `<div style="margin-bottom:9px;padding:11px 13px;border-radius:10px;background:var(--surface2);border:1px solid rgba(240,165,0,0.18);">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span style="font-size:0.74rem;color:var(--muted);font-weight:700;">Q${idx+1}</span>${badge}<span style="margin-left:auto;font-size:0.7rem;color:${aColor};font-weight:700;">${awarded} marks</span></div>
          <div style="font-size:0.81rem;font-weight:700;color:var(--text);margin-bottom:5px;">${qText}</div>
          <div style="font-size:0.78rem;color:var(--text2);background:var(--surface);padding:7px 10px;border-radius:7px;border:1px solid var(--border);line-height:1.55;">
            <span style="font-weight:700;color:#00d4aa;">Your answer: </span>${ans.answer_text || '<em style="color:var(--muted)">Not answered</em>'}
          </div>
          ${modelAns?`<div style="font-size:0.73rem;color:var(--muted);margin-top:5px;"><span style="font-weight:700;color:#a855f7;">Model: </span>${modelAns}</div>`:''}
        </div>`;
      } else {
        const earnedMks = isRight ? qMarks : 0;
        const sCol = !selOptId?'var(--muted)':isRight?'#22c55e':'#ef4444';
        html += `<div style="margin-bottom:9px;padding:11px 13px;border-radius:10px;background:var(--surface2);border:1px solid ${isRight?'rgba(34,197,94,0.2)':selOptId?'rgba(239,68,68,0.15)':'var(--border)'};">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span style="font-size:0.74rem;color:var(--muted);font-weight:700;">Q${idx+1}</span>${badge}<span style="margin-left:auto;font-size:0.7rem;color:${sCol};font-weight:700;">${isRight?'✅':'❌'} ${earnedMks}/${qMarks}</span></div>
          <div style="font-size:0.81rem;font-weight:700;color:var(--text);margin-bottom:7px;">${qText}</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${opts.map(o => {
              const isSel=o.id===selOptId,isCorr=o.is_correct;
              let bg='var(--surface)',bdr='var(--border)',tc='var(--text2)';
              if(isSel&&isCorr){bg='rgba(34,197,94,0.1)';bdr='rgba(34,197,94,0.4)';tc='#22c55e';}
              if(isSel&&!isCorr){bg='rgba(239,68,68,0.07)';bdr='rgba(239,68,68,0.35)';tc='#ef4444';}
              if(!isSel&&isCorr){bg='rgba(34,197,94,0.05)';bdr='rgba(34,197,94,0.2)';tc='#22c55e';}
              return `<div style="padding:5px 10px;border-radius:7px;border:1px solid ${bdr};background:${bg};font-size:0.77rem;color:${tc};display:flex;align-items:center;gap:7px;"><span>${isSel?'●':'○'}</span><span style="flex:1;">${o.option_text}</span>${isSel&&isCorr?'<span style="font-weight:700;font-size:0.7rem;">✓</span>':''}${isSel&&!isCorr?'<span style="font-weight:700;font-size:0.7rem;">✗</span>':''}${!isSel&&isCorr?'<span style="font-size:0.67rem;">← Correct</span>':''}</div>`;
            }).join('')}
          </div>
        </div>`;
      }
    });
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444;padding:12px;font-size:0.8rem;">⚠️ ${e.message}</div>`;
  }
}



// ══════════════════════════════════════════════════════════════
// ADMIN: QUIZ MANAGEMENT
// ══════════════════════════════════════════════════════════════
async function openQuizAdmin() {
  if (!_canUploadQuiz()) {
    alert('⛔ ⛔ Access denied. Quiz management is restricted.');
    return;
  }
  _qaQuestions   = [];
  _editingQuizId = null;
  document.getElementById('quiz-admin-overlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.getElementById('qa-questions-list').innerHTML = '';
  document.getElementById('qa-no-questions').style.display = 'block';
  document.getElementById('qa-save-status').style.display = 'none';
  document.getElementById('qa-save-btn').textContent = '💾 Save Quiz';
  document.getElementById('qa-title').value = '';
  document.getElementById('qa-desc').value  = '';
  switchQuizAdminTab('create');

  // Load training modules into select
  await populateNodeSelect();
}

async function populateNodeSelect() {
  const sel = document.getElementById('qa-node');
  sel.innerHTML = '<option value="">— Select Training Module —</option>';
  try {
    await CN.load();
    const section = CN.getSection('Training');
    if (section) {
      const cats = CN.getCategories(section.id);
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        sel.appendChild(opt);
      });
    }
    // Also add quizzes node if no categories
    if (sel.options.length === 1) {
      const nodes = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes?select=id,name&type=eq.section&order=name.asc`, { headers: QZ_HDRS() }).then(r=>r.json());
      nodes.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.id; opt.textContent = n.name;
        sel.appendChild(opt);
      });
    }
  } catch(e) { }
}

function closeQuizAdmin() {
  document.getElementById('quiz-admin-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function switchQuizAdminTab(tab) {
  ['create','manage'].forEach(t => {
    document.getElementById(`qa-panel-${t}`).style.display = tab === t ? 'block' : 'none';
    document.getElementById(`qa-tab-${t}`).style.borderBottomColor = tab === t ? '#a855f7' : 'transparent';
    document.getElementById(`qa-tab-${t}`).style.color             = tab === t ? '#a855f7' : 'var(--muted)';
    document.getElementById(`qa-tab-${t}`).style.fontWeight        = tab === t ? '700' : '600';
  });
  if (tab === 'manage') loadAdminQuizList();
}

function addQuizQuestion() {
  const idx = _qaQuestions.length;
  _qaQuestions.push({
    text: '', marks: 1,
    type: 'mcq',
    correct_answer_text: '',
    tf_correct: 'true',
    options: [
      { text: '', is_correct: false },
      { text: '', is_correct: false },
      { text: '', is_correct: false },
      { text: '', is_correct: false }
    ]
  });
  document.getElementById('qa-no-questions').style.display = 'none';
  renderAdminQuestions();
  setTimeout(() => {
    const el = document.getElementById(`qa-q-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
}

function changeQuestionType(idx, newType) {
  _qaQuestions[idx].type = newType;
  // NOTE: marks are intentionally NOT reset here — they stay as whatever the creator set.
  // Type change should never override the user's marks.
  if (newType === 'true_false') {
    _qaQuestions[idx].options = [
      { text: 'True',  is_correct: _qaQuestions[idx].tf_correct === 'true' },
      { text: 'False', is_correct: _qaQuestions[idx].tf_correct === 'false' }
    ];
  } else if (newType === 'mcq' && _qaQuestions[idx].options.length < 4) {
    _qaQuestions[idx].options = [
      { text: '', is_correct: false }, { text: '', is_correct: false },
      { text: '', is_correct: false }, { text: '', is_correct: false }
    ];
  }
  renderAdminQuestions();
}

function setTFCorrect(idx, which) {
  _qaQuestions[idx].tf_correct = which;
  _qaQuestions[idx].options = [
    { text: 'True',  is_correct: which === 'true'  },
    { text: 'False', is_correct: which === 'false' }
  ];
  renderAdminQuestions();
}

function removeQuizQuestion(idx) {
  _qaQuestions.splice(idx, 1);
  if (_qaQuestions.length === 0) document.getElementById('qa-no-questions').style.display = 'block';
  renderAdminQuestions();
}

function renderAdminQuestions() {
  const container = document.getElementById('qa-questions-list');
  container.innerHTML = _qaQuestions.map((q, idx) => {
    const qType = (q.type || 'mcq').toLowerCase();
    const isMCQ = qType === 'mcq';
    const isTF  = qType === 'true_false';
    const isDesc = qType === 'descriptive';
    return `
    <div id="qa-q-${idx}" style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;border-left:3px solid ${qType==='mcq'?'#a855f7':qType==='true_false'?'#22c55e':'#f0a500'};">
      <!-- Row 1: number, question text, marks, delete -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:24px;height:24px;border-radius:7px;background:${qType==='mcq'?'#a855f722':qType==='true_false'?'#22c55e22':'#f0a50022'};color:${qType==='mcq'?'#a855f7':qType==='true_false'?'#22c55e':'#f0a500'};font-size:0.75rem;font-weight:800;display:flex;align-items:center;justify-content:center;">${idx+1}</div>
        <input oninput="_qaQuestions[${idx}].text=this.value" value="${q.text.replace(/"/g,'&quot;')}" placeholder="Question text *" style="flex:1;padding:7px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.86rem;font-family:inherit;outline:none;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;">
          <span style="font-size:0.62rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">Marks</span>
          <input oninput="_qaQuestions[${idx}].marks=Math.max(1,parseFloat(this.value)||1)" type="number" value="${q.marks}" min="1" step="1" title="Marks for this question (no upper limit)" style="width:65px;padding:6px 9px;border-radius:8px;border:1.5px solid rgba(240,165,0,0.4);background:var(--surface);color:#f0a500;font-size:0.9rem;font-weight:700;font-family:inherit;outline:none;text-align:center;">
        </div>
        <button onclick="removeQuizQuestion(${idx})" style="width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#ef4444;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <!-- Row 2: Question type selector -->
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
        <button onclick="changeQuestionType(${idx},'mcq')" style="padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${qType==='mcq'?'#a855f7':'var(--border)'};background:${qType==='mcq'?'rgba(168,85,247,0.12)':'transparent'};color:${qType==='mcq'?'#a855f7':'var(--muted)'};">
          ☑ MCQ
        </button>
        <button onclick="changeQuestionType(${idx},'true_false')" style="padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${qType==='true_false'?'#22c55e':'var(--border)'};background:${qType==='true_false'?'rgba(34,197,94,0.12)':'transparent'};color:${qType==='true_false'?'#22c55e':'var(--muted)'};">
          🔘 True/False
        </button>
        <button onclick="changeQuestionType(${idx},'descriptive')" style="padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${qType==='descriptive'?'#f0a500':'var(--border)'};background:${qType==='descriptive'?'rgba(240,165,0,0.12)':'transparent'};color:${qType==='descriptive'?'#f0a500':'var(--muted)'};">
          ✏️ Descriptive
        </button>
      </div>

      <!-- MCQ or True/False options -->
      ${isMCQ || isTF ? `
        ${isTF ? `
        <!-- True/False: just pick which is correct -->
        <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Select Correct Answer</div>
        <div style="display:flex;gap:10px;">
          <button onclick="setTFCorrect(${idx},'true')" style="flex:1;padding:11px;border-radius:10px;font-size:0.9rem;font-weight:800;cursor:pointer;font-family:inherit;border:2px solid ${(q.tf_correct||'true')==='true'?'#22c55e':'var(--border)'};background:${(q.tf_correct||'true')==='true'?'rgba(34,197,94,0.12)':'var(--surface)'};color:${(q.tf_correct||'true')==='true'?'#22c55e':'var(--muted)'};">
            ✅ TRUE ${(q.tf_correct||'true')==='true'?'← Correct':''}
          </button>
          <button onclick="setTFCorrect(${idx},'false')" style="flex:1;padding:11px;border-radius:10px;font-size:0.9rem;font-weight:800;cursor:pointer;font-family:inherit;border:2px solid ${q.tf_correct==='false'?'#ef4444':'var(--border)'};background:${q.tf_correct==='false'?'rgba(239,68,68,0.1)':'var(--surface)'};color:${q.tf_correct==='false'?'#ef4444':'var(--muted)'};">
            ❌ FALSE ${q.tf_correct==='false'?'← Correct':''}
          </button>
        </div>` : `
        <!-- MCQ: 4 options -->
        <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Options — Select correct answer (radio)</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${q.options.map((opt, oi) => `
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="radio" name="correct-${idx}" ${opt.is_correct?'checked':''} onchange="setCorrectOption(${idx},${oi})" style="width:16px;height:16px;accent-color:#22c55e;flex-shrink:0;cursor:pointer;" title="Mark as correct">
              <input oninput="_qaQuestions[${idx}].options[${oi}].text=this.value" value="${opt.text.replace(/"/g,'&quot;')}" placeholder="Option ${oi+1} *" style="flex:1;padding:7px 11px;border-radius:8px;border:1px solid ${opt.is_correct?'rgba(34,197,94,0.4)':'var(--border)'};background:${opt.is_correct?'rgba(34,197,94,0.06)':'var(--surface)'};color:var(--text);font-size:0.84rem;font-family:inherit;outline:none;transition:all 0.15s;">
              <span style="font-size:0.7rem;color:${opt.is_correct?'#22c55e':'transparent'};">✓ Correct</span>
            </div>`).join('')}
        </div>` }` : `
        <!-- Descriptive: answer textarea for reference -->
        <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Model Answer (for reference / manual review)</div>
        <textarea oninput="_qaQuestions[${idx}].correct_answer_text=this.value" placeholder="Write the expected/model answer here…" rows="3" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid rgba(240,165,0,0.35);background:rgba(240,165,0,0.05);color:var(--text);font-size:0.84rem;font-family:inherit;outline:none;resize:vertical;">${q.correct_answer_text||''}</textarea>
        <div style="font-size:0.73rem;color:var(--muted);margin-top:4px;">ℹ️ Employee will type their answer. Marked as "Submitted" — admin reviews manually.</div>
      `}
    </div>`;
  }).join('');
}

function setCorrectOption(qIdx, optIdx) {
  _qaQuestions[qIdx].options.forEach((o, i) => o.is_correct = i === optIdx);
  renderAdminQuestions();
}

async function saveQuizToDB() {
  if (!_canUploadQuiz()) {
    alert('⛔ ⛔ Access denied. Only authorised members can save quizzes.');
    return;
  }
  const title    = document.getElementById('qa-title').value.trim();
  const nodeId   = document.getElementById('qa-node').value;
  const passing  = parseInt(document.getElementById('qa-passing').value) || 60;
  const timeLimit= parseInt(document.getElementById('qa-timelimit').value) || 15;
  const desc     = document.getElementById('qa-desc').value.trim();
  const statusEl = document.getElementById('qa-save-status');
  const saveBtn  = document.getElementById('qa-save-btn');

  if (!title)  { alert('Please enter a quiz title'); return; }
  if (!nodeId) { alert('Please select a training module'); return; }
  if (!_qaQuestions.length) { alert('Please add at least one question'); return; }

  // Validate questions
  for (let i = 0; i < _qaQuestions.length; i++) {
    const q = _qaQuestions[i];
    if (!q.text.trim()) { alert(`Question ${i+1}: Please enter question text`); return; }
    const qType = q.type || 'mcq';
    if (qType === 'mcq') {
      const hasCorrect = q.options.some(o => o.is_correct);
      const filledOpts = q.options.filter(o => o.text.trim());
      if (filledOpts.length < 2) { alert(`Question ${i+1} (MCQ): Please fill at least 2 options`); return; }
      if (!hasCorrect) { alert(`Question ${i+1} (MCQ): Please select the correct option (green radio button)`); return; }
    } else if (qType === 'true_false') {
      if (!q.tf_correct) { alert(`Question ${i+1} (True/False): Please select which answer is correct`); return; }
    }
    // Descriptive: no options needed, model answer is optional
  }

  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  statusEl.style.display = 'none';

  try {
    // 0. Fetch admin's Emp_id for created_by (bigint column)
    let adminEmpId = _qzEmpId || null;
    if (!adminEmpId && CURRENT_USER?.email) {
      try {
        const eRes = await fetch(
          `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`,
          { headers: QZ_HDRS() }
        );
        const eArr = await eRes.json();
        if (eArr.length) { adminEmpId = eArr[0].Emp_id; _qzEmpId = adminEmpId; }
      } catch(e) { }
    }

    // ── Edit mode: PATCH existing quiz | Create mode: POST new quiz ──
    let quizId;
    const quizBody = {
      title, description: desc,
      node_id: parseInt(nodeId),
      passing_score: passing,
      time_limit: timeLimit
    };

    if (_editingQuizId) {
      // UPDATE existing quiz
      await fetch(`${SUPABASE_URL}/rest/v1/quizzes?id=eq.${_editingQuizId}`, {
        method: 'PATCH',
        headers: { ...QZ_HDRS(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(quizBody)
      });
      quizId = _editingQuizId;

      // Purane questions + options delete karo (fresh insert)
      await fetch(`${SUPABASE_URL}/rest/v1/options?question_id=in.(select id from questions where quiz_id=eq.${quizId})`,
        { method: 'DELETE', headers: QZ_HDRS() }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/questions?quiz_id=eq.${quizId}`,
        { method: 'DELETE', headers: QZ_HDRS() });

    } else {
      // CREATE new quiz
      quizBody.is_active = true;
      if (adminEmpId) quizBody.created_by = adminEmpId;

      const qRes = await fetch(`${SUPABASE_URL}/rest/v1/quizzes`, {
        method: 'POST',
        headers: QZ_HDRS_REPR(),
        body: JSON.stringify(quizBody)
      });
      const qArr = await qRes.json();
      quizId = Array.isArray(qArr) ? qArr[0]?.id : qArr?.id;
      if (!quizId) throw new Error('Quiz save failed: ' + JSON.stringify(qArr));
    }

    // 2. Questions + options save karo (same for create & edit)
    for (const q of _qaQuestions) {
      const qType = q.type || 'mcq';
      const qqBody = {
        quiz_id: quizId,
        question_text: q.text.trim(),
        question_type: qType,
        marks: q.marks || 1,
        correct_answer_text: qType === 'descriptive' ? (q.correct_answer_text || null) : null
      };
      if (adminEmpId && !_editingQuizId) qqBody.created_by = adminEmpId;

      const qqRes = await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
        method: 'POST',
        headers: QZ_HDRS_REPR(),
        body: JSON.stringify(qqBody)
      });
      const qqArr = await qqRes.json();
      const qId   = Array.isArray(qqArr) ? qqArr[0]?.id : qqArr?.id;
      if (!qId) throw new Error('Question save failed: ' + JSON.stringify(qqArr));

      // MCQ + True/False: save options | Descriptive: skip
      if (qType === 'mcq') {
        const validOpts = q.options.filter(o => o.text.trim());
        if (validOpts.length) {
          await fetch(`${SUPABASE_URL}/rest/v1/options`, {
            method: 'POST',
            headers: QZ_HDRS_MINIMAL(),
            body: JSON.stringify(validOpts.map(o => ({
              question_id: qId,
              option_text: o.text.trim(),
              is_correct: o.is_correct
            })))
          });
        }
      } else if (qType === 'true_false') {
        const tfOpts = [
          { question_id: qId, option_text: 'True',  is_correct: (q.tf_correct || 'true') === 'true'  },
          { question_id: qId, option_text: 'False', is_correct: (q.tf_correct || 'true') === 'false' }
        ];
        await fetch(`${SUPABASE_URL}/rest/v1/options`, {
          method: 'POST',
          headers: QZ_HDRS_MINIMAL(),
          body: JSON.stringify(tfOpts)
        });
      }
    }

    statusEl.style.display = 'block';
    statusEl.style.color   = '#22c55e';
    statusEl.textContent   = _editingQuizId
      ? `✅ Quiz "${title}" updated with ${_qaQuestions.length} questions!`
      : `✅ Quiz "${title}" saved with ${_qaQuestions.length} questions!`;

    // Reset form + edit state
    _editingQuizId = null;
    _qaQuestions = [];
    document.getElementById('qa-title').value = '';
    document.getElementById('qa-desc').value  = '';
    document.getElementById('qa-questions-list').innerHTML = '';
    document.getElementById('qa-no-questions').style.display = 'block';

    // Reload quiz list in training section
    _quizzesLoaded = false;
    loadTrainingQuizzes();

  } catch(e) {
    statusEl.style.display = 'block';
    statusEl.style.color   = '#ef4444';
    statusEl.textContent   = '❌ Error: ' + e.message;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = _editingQuizId ? '✏️ Update Quiz' : '💾 Save Quiz';
  }
}

// ══════════════════════════════════════════════════════════════
// STANDALONE GRADE OVERLAY — filter tabs + direct attempts list
// ══════════════════════════════════════════════════════════════
let _goAllQuizzes   = [];   // all quiz rows
let _goAllAttempts  = [];   // all attempt rows
let _goAllQuestions = {};   // quizId → questions[]
let _goGradedMap    = {};   // attemptId → true (fully graded) / false (has ungraded descriptive answer) / undefined (no descriptive answers)
let _goActiveFilter = null; // null = all, quizId = filtered
let _goActiveNameFilter = null; // null = all, name string = filtered

function openGradeOverlay() {
  if (!_canUploadQuiz()) { alert('⛔ Only authorised MIS members can access grading.'); return; }
  document.getElementById('grade-overlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  goLoadAll();
}

function closeGradeOverlay() {
  document.getElementById('grade-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function goGradeRefresh() {
  _goAllQuizzes = []; _goAllAttempts = []; _goAllQuestions = {}; _goGradedMap = {};
  _goActiveFilter = null; _goActiveNameFilter = null;
  const ns = document.getElementById('go-filter-name');
  const qs = document.getElementById('go-filter-quiz');
  if (ns) ns.value = '';
  if (qs) qs.value = '';
  goLoadAll();
}

async function goLoadAll() {
  const loadEl = document.getElementById('go-list-loading');
  const listEl = document.getElementById('go-list');
  const emptyEl= document.getElementById('go-list-empty');
  const barEl  = document.getElementById('go-filter-bar');
  loadEl.style.display = 'block'; listEl.innerHTML = ''; emptyEl.style.display = 'none';

  try {
    const [qRes, aRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/quizzes?select=id,title,passing_score,content_nodes(name)&order=id.asc`, { headers: QZ_HDRS() }),
      fetch(`${SUPABASE_URL}/rest/v1/quiz_attempts?select=id,quiz_id,attempt_number,score,total_marks,started_at,submitted_at,Employee_details(Employee_name,Employee_Dept)&order=id.desc`, { headers: QZ_HDRS() })
    ]);
    _goAllQuizzes  = await qRes.json();
    _goAllAttempts = await aRes.json();

    // Fetch questions for all quizzes (to know which have descriptive)
    if (_goAllQuizzes.length) {
      const ids = _goAllQuizzes.map(q => q.id).join(',');
      const qqRes = await fetch(
        `${SUPABASE_URL}/rest/v1/questions?select=id,quiz_id,question_type,marks&quiz_id=in.(${ids})`,
        { headers: QZ_HDRS() }
      );
      const allQs = await qqRes.json();
      _goAllQuizzes.forEach(q => { _goAllQuestions[q.id] = allQs.filter(qq => qq.quiz_id === q.id); });
    }

    // Determine per-attempt grading completeness for descriptive questions.
    // A descriptive answer is "graded" once marks_awarded is NOT NULL —
    // an awarded score of 0 still counts as graded, it should NOT show as Pending.
    if (_goAllAttempts.length) {
      const attemptIds = _goAllAttempts.map(a => a.id).join(',');
      const ansRes = await fetch(
        `${SUPABASE_URL}/rest/v1/answers?select=attempt_id,marks_awarded,questions(question_type)&attempt_id=in.(${attemptIds})`,
        { headers: QZ_HDRS() }
      );
      const allAnswersForGrading = await ansRes.json();
      allAnswersForGrading.forEach(ans => {
        const qType = (ans.questions?.question_type || '').toLowerCase();
        if (qType !== 'descriptive') return;
        if (!(ans.attempt_id in _goGradedMap)) _goGradedMap[ans.attempt_id] = true;
        if (ans.marks_awarded == null) _goGradedMap[ans.attempt_id] = false;
      });
    }

    // Populate Employee dropdown
    const nameSelect = document.getElementById('go-filter-name');
    const quizSelect = document.getElementById('go-filter-quiz');
    if (nameSelect) {
      const names = [...new Set(
        _goAllAttempts.map(a => a.Employee_details?.Employee_name).filter(Boolean)
      )].sort();
      nameSelect.innerHTML = '<option value="">👤 All Employees</option>' +
        names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');
    }

    // Populate Quiz dropdown
    if (quizSelect) {
      quizSelect.innerHTML = '<option value="">📝 All Quizzes</option>' +
        _goAllQuizzes.map(q => `<option value="${q.id}">${q.title}</option>`).join('');
    }

    goApplyFilters();

  } catch(e) {
    loadEl.style.display = 'none';
    document.getElementById('go-list').innerHTML = `<div style="color:#ef4444;padding:20px;font-size:0.84rem;">⚠️ ${e.message}</div>`;
  }
}

function goApplyFilters() {
  const nameVal = document.getElementById('go-filter-name')?.value || '';
  const quizVal = document.getElementById('go-filter-quiz')?.value || '';
  _goActiveFilter   = quizVal ? parseInt(quizVal) : null;
  _goActiveNameFilter = nameVal || null;
  goRenderList();
}

async function goRenderList() {
  const loadEl = document.getElementById('go-list-loading');
  const listEl = document.getElementById('go-list');
  const emptyEl= document.getElementById('go-list-empty');
  loadEl.style.display = 'none'; listEl.innerHTML = ''; emptyEl.style.display = 'none';

  let filtered = _goAllAttempts;
  if (_goActiveFilter)     filtered = filtered.filter(a => a.quiz_id === _goActiveFilter);
  if (_goActiveNameFilter) filtered = filtered.filter(a =>
    (a.Employee_details?.Employee_name || '') === _goActiveNameFilter
  );

  if (!filtered.length) { emptyEl.style.display = 'block'; return; }

  // Build quiz lookup
  const quizMap = {};
  _goAllQuizzes.forEach(q => quizMap[q.id] = q);

  const colors = ['#a855f7','#f0a500','#00d4aa','#4e9af1','#f97316','#e879f9','#22c55e'];

  listEl.innerHTML = filtered.map(a => {
    const quiz    = quizMap[a.quiz_id] || {};
    const pass    = quiz.passing_score || 60;
    const qi      = _goAllQuizzes.findIndex(q => q.id === a.quiz_id);
    const col     = colors[qi >= 0 ? qi % colors.length : 0];
    const emp     = a.Employee_details?.Employee_name || 'Employee';
    const dept    = a.Employee_details?.Employee_Dept || '';
    const score   = a.score ?? 0;
    const total   = a.total_marks || 0;
    const pct     = total > 0 ? Math.round((score / total) * 100) : 0;
    const sub     = !!a.submitted_at;
    const ok      = sub && pct >= pass;
    const date    = a.submitted_at
      ? new Date(a.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
      : a.started_at
        ? new Date(a.started_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
        : '—';
    const hasDesc   = (_goAllQuestions[a.quiz_id] || []).some(q => (q.question_type||'').toLowerCase() === 'descriptive');
    const isPending = sub && hasDesc && (score === 0 || _goGradedMap[a.id] === false);
    const borderCol = !sub ? '#f0a500'
                    : isPending ? '#f97316'  // pending grading
                    : ok ? '#22c55e' : '#ef4444';

    const statusBg  = !sub               ? 'rgba(240,165,0,0.1)'
                    : isPending ? 'rgba(249,115,22,0.1)'
                    : ok                  ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    const statusTxt = !sub               ? '🔄 In Progress'
                    : isPending ? '⏳ Pending'
                    : ok                  ? '✅ Pass' : '❌ Fail';

    // Always show quiz label (no tabs anymore)
    const quizLabel = `<span style="font-size:0.7rem;padding:2px 8px;border-radius:10px;background:${col}18;color:${col};font-weight:700;border:1px solid ${col}33;white-space:nowrap;">${quiz.title||'Quiz'}</span>`;

    return `
      <div style="border-radius:12px;border:1px solid var(--border);border-left:3px solid ${borderCol};background:var(--surface2);overflow:hidden;" id="go-row-${a.id}">
        <!-- Clickable header row -->
        <div onclick="goToggleDetail(${a.id})" style="display:flex;align-items:center;gap:10px;padding:12px 16px;flex-wrap:wrap;cursor:pointer;transition:background 0.15s;"
          onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''">
          <div style="flex:1;min-width:150px;">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:3px;">
              <span style="font-size:0.9rem;font-weight:700;color:var(--text);">${emp}</span>
              ${quizLabel}
            </div>
            <div style="font-size:0.72rem;color:var(--muted);">${dept} · Attempt #${a.attempt_number||1} · 📅 ${date}</div>
          </div>
          <div style="text-align:center;min-width:70px;">
            <div id="go-pct-${a.id}" style="font-size:1.1rem;font-weight:900;color:${borderCol};">${sub ? pct+'%' : '—'}</div>
            <div id="go-pts-${a.id}" style="font-size:0.68rem;color:var(--muted);">${score}/${total} pts</div>
          </div>
          <div id="go-status-${a.id}" style="font-size:0.75rem;font-weight:800;padding:4px 13px;border-radius:20px;
            background:${statusBg};color:${borderCol};">
            ${statusTxt}
          </div>
          <span id="go-chevron-${a.id}" style="font-size:0.75rem;color:var(--muted);transition:transform 0.2s;display:inline-block;">▼</span>
        </div>
        <!-- Expandable detail panel (all answers) -->
        <div id="go-detail-${a.id}" style="display:none;border-top:1px solid var(--border);padding:14px 16px;background:var(--surface);">
          <div id="go-detail-content-${a.id}" style="font-size:0.82rem;color:var(--muted);">
            <div style="text-align:center;padding:20px 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f0a500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto 8px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Loading answers…
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// Toggle detail panel on card click
async function goToggleDetail(attemptId) {
  const panel   = document.getElementById(`go-detail-${attemptId}`);
  const chevron = document.getElementById(`go-chevron-${attemptId}`);
  if (!panel) return;
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) await goLoadAllAnswers(attemptId);
}

// Load ALL answers for an attempt (MCQ + TF + Descriptive)
async function goLoadAllAnswers(attemptId) {
  const container = document.getElementById(`go-detail-content-${attemptId}`);
  if (!container) return;

  // Find attempt's quiz to get question order
  const attempt = _goAllAttempts.find(a => a.id === attemptId);
  const quizQs  = attempt ? (_goAllQuestions[attempt.quiz_id] || []) : [];

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/answers?select=id,answer_text,marks_awarded,selected_option_id,` +
      `questions(id,question_text,question_type,marks,correct_answer_text),` +
      `options!answers_selected_option_id_fkey(option_text,is_correct)` +
      `&attempt_id=eq.${attemptId}&order=id.asc`,
      { headers: QZ_HDRS() }
    );
    const answers = await res.json();
    if (!answers.length) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.83rem;">No answers recorded yet.</div>';
      return;
    }

    // Also fetch all options for MCQ/TF questions to show all choices
    const qIds = [...new Set(answers.map(a => a.questions?.id).filter(Boolean))];
    let allOptions = [];
    if (qIds.length) {
      const optRes = await fetch(
        `${SUPABASE_URL}/rest/v1/options?select=id,question_id,option_text,is_correct&question_id=in.(${qIds.join(',')})`,
        { headers: QZ_HDRS() }
      );
      allOptions = await optRes.json();
    }

    let html = '';
    answers.forEach((ans, idx) => {
      const qType    = (ans.questions?.question_type || 'mcq').toLowerCase();
      const qText    = ans.questions?.question_text || `Question ${idx + 1}`;
      const qMarks   = ans.questions?.marks || 1;
      const qId      = ans.questions?.id;
      const modelAns = ans.questions?.correct_answer_text || '';

      // Type badge
      const typeBadge = qType === 'descriptive'
        ? `<span style="font-size:0.65rem;padding:1px 7px;border-radius:8px;background:rgba(240,165,0,0.12);color:#f0a500;font-weight:700;">✏️ Descriptive</span>`
        : qType === 'true_false'
        ? `<span style="font-size:0.65rem;padding:1px 7px;border-radius:8px;background:rgba(34,197,94,0.12);color:#22c55e;font-weight:700;">🔘 True/False</span>`
        : `<span style="font-size:0.65rem;padding:1px 7px;border-radius:8px;background:rgba(168,85,247,0.12);color:#a855f7;font-weight:700;">☑ MCQ</span>`;

      if (qType === 'descriptive') {
        // ── Descriptive ──
        const current = ans.marks_awarded ?? '';
        html += `
          <div style="margin-bottom:10px;padding:12px 14px;border-radius:10px;background:var(--surface2);border:1px solid rgba(240,165,0,0.2);">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px;">
              <span style="font-size:0.78rem;font-weight:700;color:var(--muted);">Q${idx+1}</span>
              ${typeBadge}
              <span style="font-size:0.7rem;color:var(--muted);margin-left:auto;">${qMarks} marks</span>
            </div>
            <div style="font-size:0.83rem;font-weight:700;color:var(--text);margin-bottom:6px;">${qText}</div>
            <div style="font-size:0.79rem;color:var(--text2);background:var(--surface);padding:8px 10px;border-radius:8px;border:1px solid var(--border);line-height:1.6;margin-bottom:6px;">
              <span style="font-weight:700;color:#00d4aa;">Answer: </span>${ans.answer_text || '<em style="color:var(--muted)">Not answered</em>'}
            </div>
            ${modelAns ? `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px;"><span style="font-weight:700;color:#a855f7;">Model: </span>${modelAns}</div>` : ''}
            <div style="display:flex;align-items:center;gap:8px;background:rgba(240,165,0,0.06);border-radius:7px;padding:7px 10px;flex-wrap:wrap;">
              <span style="font-size:0.75rem;font-weight:700;color:#f0a500;">Award Marks:</span>
              <input type="number" id="go-marks-${ans.id}" min="0" max="${qMarks}" step="1" value="${current}" placeholder="0"
                oninput="if(parseFloat(this.value)>${qMarks})this.value=${qMarks};"
                style="width:60px;padding:4px 8px;border-radius:6px;border:1.5px solid rgba(240,165,0,0.4);background:var(--surface2);color:var(--text);font-size:0.85rem;font-family:inherit;outline:none;text-align:center;">
              <span style="font-size:0.72rem;color:var(--muted);">/ ${qMarks}</span>
              <button onclick="goSaveMark(${ans.id},${attemptId},${qMarks})"
                style="padding:4px 13px;border-radius:7px;border:none;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;font-size:0.76rem;font-weight:700;cursor:pointer;font-family:inherit;">
                💾 Save
              </button>
              <span id="go-saved-${ans.id}" style="font-size:0.72rem;color:#22c55e;font-weight:700;display:none;">✓ Saved!</span>
            </div>
          </div>`;

      } else {
        // ── MCQ / True/False ──
        const selectedOptId = ans.selected_option_id;
        const selOpt  = ans.options;  // joined via FK
        const isRight = selOpt?.is_correct === true;
        const selText = selOpt?.option_text || '(Not answered)';
        const opts    = allOptions.filter(o => o.question_id === qId);
        const correctOpt = opts.find(o => o.is_correct);
        const statusCol  = !selectedOptId ? 'var(--muted)' : isRight ? '#22c55e' : '#ef4444';
        const statusIcon = !selectedOptId ? '—' : isRight ? '✅' : '❌';
        const earnedMks  = isRight ? qMarks : 0;

        html += `
          <div style="margin-bottom:10px;padding:12px 14px;border-radius:10px;background:var(--surface2);border:1px solid ${isRight?'rgba(34,197,94,0.2)':selectedOptId?'rgba(239,68,68,0.2)':'var(--border)'};">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px;">
              <span style="font-size:0.78rem;font-weight:700;color:var(--muted);">Q${idx+1}</span>
              ${typeBadge}
              <span style="font-size:0.7rem;font-weight:700;color:${statusCol};margin-left:auto;">${statusIcon} ${earnedMks}/${qMarks} marks</span>
            </div>
            <div style="font-size:0.83rem;font-weight:700;color:var(--text);margin-bottom:8px;">${qText}</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${opts.map(o => {
                const isSel   = o.id === selectedOptId;
                const isCorr  = o.is_correct;
                let bg = 'var(--surface)'; let border = 'var(--border)'; let textCol = 'var(--text)';
                if (isSel && isCorr)  { bg='rgba(34,197,94,0.1)';  border='rgba(34,197,94,0.4)';  textCol='#22c55e'; }
                if (isSel && !isCorr) { bg='rgba(239,68,68,0.08)'; border='rgba(239,68,68,0.35)'; textCol='#ef4444'; }
                if (!isSel && isCorr) { bg='rgba(34,197,94,0.05)'; border='rgba(34,197,94,0.25)'; textCol='#22c55e'; }
                return `<div style="padding:6px 10px;border-radius:7px;border:1px solid ${border};background:${bg};font-size:0.78rem;color:${textCol};display:flex;align-items:center;gap:7px;">
                  <span>${isSel?'●':'○'}</span>
                  <span style="flex:1;">${o.option_text}</span>
                  ${isSel&&isCorr?'<span style="font-weight:700;">✓ Correct</span>':''}
                  ${isSel&&!isCorr?'<span style="font-weight:700;">✗ Wrong</span>':''}
                  ${!isSel&&isCorr?'<span style="font-weight:600;font-size:0.72rem;">← Correct answer</span>':''}
                </div>`;
              }).join('')}
            </div>
          </div>`;
      }
    });

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444;padding:12px;font-size:0.8rem;">⚠️ Error: ${e.message}</div>`;
  }
}

// Update just ONE row's score%/status badge in place — does NOT touch the
// expanded detail panel, so reviewer can keep grading Q1, Q2, Q3... without
// the window jumping back to the closed list view after every Save.
function goUpdateRowDisplay(attemptId) {
  const a = _goAllAttempts.find(x => x.id === attemptId);
  if (!a) return;

  const quizMap = {};
  _goAllQuizzes.forEach(q => quizMap[q.id] = q);
  const quiz    = quizMap[a.quiz_id] || {};
  const pass    = quiz.passing_score || 60;
  const score   = a.score ?? 0;
  const total   = a.total_marks || 0;
  const pct     = total > 0 ? Math.round((score / total) * 100) : 0;
  const sub     = !!a.submitted_at;
  const ok      = sub && pct >= pass;
  const hasDesc   = (_goAllQuestions[a.quiz_id] || []).some(q => (q.question_type||'').toLowerCase() === 'descriptive');
  const isPending = sub && hasDesc && (score === 0 || _goGradedMap[a.id] === false);

  const borderCol = !sub ? '#f0a500'
                  : isPending ? '#f97316'
                  : ok ? '#22c55e' : '#ef4444';
  const statusBg  = !sub               ? 'rgba(240,165,0,0.1)'
                  : isPending ? 'rgba(249,115,22,0.1)'
                  : ok                  ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
  const statusTxt = !sub               ? '🔄 In Progress'
                  : isPending ? '⏳ Pending'
                  : ok                  ? '✅ Pass' : '❌ Fail';

  const rowEl    = document.getElementById(`go-row-${attemptId}`);
  const pctEl    = document.getElementById(`go-pct-${attemptId}`);
  const ptsEl    = document.getElementById(`go-pts-${attemptId}`);
  const statusEl = document.getElementById(`go-status-${attemptId}`);

  if (rowEl)    rowEl.style.borderLeft = `3px solid ${borderCol}`;
  if (pctEl)    { pctEl.style.color = borderCol; pctEl.textContent = sub ? pct + '%' : '—'; }
  if (ptsEl)    ptsEl.textContent = `${score}/${total} pts`;
  if (statusEl) {
    statusEl.style.background = statusBg;
    statusEl.style.color      = borderCol;
    statusEl.textContent      = statusTxt;
  }
}

async function goSaveMark(answerId, attemptId, maxMark) {
  if (!_canUploadQuiz()) { alert('⛔ Only MIS members can grade.'); return; }
  const input   = document.getElementById(`go-marks-${answerId}`);
  const savedEl = document.getElementById(`go-saved-${answerId}`);
  const marks   = parseFloat(input?.value);
  if (isNaN(marks) || marks < 0) { alert('Please enter a valid mark.'); return; }
  if (maxMark > 0 && marks > maxMark) { alert(`⚠️ Marks cannot exceed ${maxMark} for this question.`); input.value = maxMark; return; }

  try {
    // 1. Save descriptive marks_awarded
    await fetch(`${SUPABASE_URL}/rest/v1/answers?id=eq.${answerId}`, {
      method: 'PATCH', headers: { ...QZ_HDRS(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ marks_awarded: marks })
    });

    // 2. Fetch all answers with question type + marks + selected option correctness
    const aRes   = await fetch(
      `${SUPABASE_URL}/rest/v1/answers?select=id,selected_option_id,marks_awarded,questions(marks,question_type),options!answers_selected_option_id_fkey(is_correct)&attempt_id=eq.${attemptId}`,
      { headers: QZ_HDRS() }
    );
    const allAns = await aRes.json();

    // 3. Recalculate score:
    //    MCQ/TF  → question.marks if correct option selected
    //    Descriptive → marks_awarded (just saved or previously saved)
    let newScore = 0;
    allAns.forEach(a => {
      const qType  = (a.questions?.question_type || 'mcq').toLowerCase();
      const qMarks = a.questions?.marks || 1;
      if (qType === 'descriptive') {
        // Use the freshly saved value for our answer, DB value for others
        newScore += (a.id === answerId ? marks : (a.marks_awarded || 0));
      } else {
        // MCQ/TF: award question.marks if the selected option is_correct
        if (a.options?.is_correct) newScore += qMarks;
      }
    });

    // 4. Patch corrected score
    await fetch(`${SUPABASE_URL}/rest/v1/quiz_attempts?id=eq.${attemptId}`, {
      method: 'PATCH', headers: { ...QZ_HDRS(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ score: newScore })
    });

    // 3b. Recompute whether ALL descriptive answers for this attempt are now graded
    //     (marks_awarded not null — a saved 0 counts as graded, not pending)
    const stillUngraded = allAns.some(a => {
      const qType = (a.questions?.question_type || '').toLowerCase();
      if (qType !== 'descriptive') return false;
      const isThisOne = a.id === answerId;
      return isThisOne ? false : (a.marks_awarded == null);
    });
    _goGradedMap[attemptId] = !stillUngraded;

    const cached = _goAllAttempts.find(a => a.id === attemptId);
    if (cached) cached.score = newScore;
    if (savedEl) { savedEl.style.display = 'inline'; goUpdateRowDisplay(attemptId); setTimeout(() => { savedEl.style.display = 'none'; }, 1500); }
  } catch(e) {
    alert('Error saving: ' + e.message);
  }
}



async function loadAdminQuizList() {
  const loadEl  = document.getElementById('qa-manage-loading');
  const listEl  = document.getElementById('qa-manage-list');
  const emptyEl = document.getElementById('qa-manage-empty');
  loadEl.style.display = 'block'; listEl.innerHTML = ''; emptyEl.style.display = 'none';

  try {
    const res   = await fetch(`${SUPABASE_URL}/rest/v1/quizzes?select=*,content_nodes(name)&order=id.desc`, { headers: QZ_HDRS() });
    const quizzes = await res.json();
    loadEl.style.display = 'none';

    if (!quizzes.length) { emptyEl.style.display = 'block'; return; }

    listEl.innerHTML = quizzes.map(q => {
      const mod  = q.content_nodes?.name || '—';
      const stat = q.is_active ? '🟢 Active' : '🔴 Inactive';
      return `
        <div style="padding:13px 15px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:150px;">
            <div style="font-size:0.88rem;font-weight:700;color:var(--text);">${q.title}</div>
            <div style="font-size:0.75rem;color:var(--muted);">📚 ${mod} · ⏱ ${q.time_limit||'—'}min</div>
          </div>
          <div style="font-size:0.76rem;font-weight:600;color:var(--muted);">${stat}</div>
          <button onclick="editQuizFromDB(${q.id})" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(78,154,241,0.35);background:rgba(78,154,241,0.1);color:#4e9af1;font-size:0.76rem;cursor:pointer;font-family:inherit;">✏️ Edit</button>
          <button onclick="toggleQuizActive(${q.id},${!q.is_active})" style="padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--muted);font-size:0.76rem;cursor:pointer;font-family:inherit;">${q.is_active?'Deactivate':'Activate'}</button>
          <button onclick="deleteQuizFromDB(${q.id},'${q.title.replace(/'/g,"\\'")}')" style="padding:5px 10px;border-radius:7px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#ef4444;font-size:0.76rem;cursor:pointer;font-family:inherit;">Delete</button>
        </div>`;
    }).join('');
  } catch(e) {
    loadEl.style.display = 'none';
    listEl.innerHTML = `<div style="color:#ef4444;font-size:0.83rem;">Error: ${e.message}</div>`;
  }
}

async function toggleQuizActive(quizId, newState) {
  if (!_canUploadQuiz()) { alert('⛔ Only authorised MIS members can modify quizzes.'); return; }
  await fetch(`${SUPABASE_URL}/rest/v1/quizzes?id=eq.${quizId}`, {
    method: 'PATCH',
    headers: { ...QZ_HDRS(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ is_active: newState })
  });
  _quizzesLoaded = false;
  loadAdminQuizList();
  loadTrainingQuizzes();
}

async function deleteQuizFromDB(quizId, title) {
  if (!_canUploadQuiz()) { alert('⛔ Only authorised MIS members can delete quizzes.'); return; }
  if (!confirm(`Delete quiz "${title}"? This will also delete all questions, options and attempt records.`)) return;
  // Delete in order: answers → attempts → options → questions → quiz
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/answers?attempt_id=in.(select id from quiz_attempts where quiz_id=eq.${quizId})`, { method:'DELETE', headers:QZ_HDRS() }).catch(()=>{});
    await fetch(`${SUPABASE_URL}/rest/v1/quiz_attempts?quiz_id=eq.${quizId}`, { method:'DELETE', headers:QZ_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/options?question_id=in.(select id from questions where quiz_id=eq.${quizId})`, { method:'DELETE', headers:QZ_HDRS() }).catch(()=>{});
    await fetch(`${SUPABASE_URL}/rest/v1/questions?quiz_id=eq.${quizId}`, { method:'DELETE', headers:QZ_HDRS() });
    await fetch(`${SUPABASE_URL}/rest/v1/quizzes?id=eq.${quizId}`, { method:'DELETE', headers:QZ_HDRS() });
    _quizzesLoaded = false;
    loadAdminQuizList();
    loadTrainingQuizzes();
  } catch(e) { alert('Delete error: ' + e.message); }
}

// ── Track which quiz is being edited (null = creating new) ──
let _editingQuizId = null;

async function editQuizFromDB(quizId) {
  if (!_canUploadQuiz()) { alert('⛔ Only authorised MIS members can edit quizzes.'); return; }

  const saveBtn  = document.getElementById('qa-save-btn');
  const statusEl = document.getElementById('qa-save-status');
  saveBtn.textContent = 'Loading…'; saveBtn.disabled = true;

  // Switch to Create tab (form dikhao)
  switchQuizAdminTab('create');

  try {
    // 1. Quiz details fetch karo
    const qRes  = await fetch(`${SUPABASE_URL}/rest/v1/quizzes?id=eq.${quizId}&select=*`, { headers: QZ_HDRS() });
    const qArr  = await qRes.json();
    const quiz  = qArr[0];
    if (!quiz) throw new Error('Quiz not found');

    // 2. Questions fetch karo
    const qqRes = await fetch(`${SUPABASE_URL}/rest/v1/questions?quiz_id=eq.${quizId}&select=*&order=id.asc`, { headers: QZ_HDRS() });
    const qqArr = await qqRes.json();

    // 3. Options fetch karo (agar questions hain)
    let optMap = {};
    if (qqArr.length) {
      const qIds  = qqArr.map(q => q.id).join(',');
      const opRes = await fetch(`${SUPABASE_URL}/rest/v1/options?question_id=in.(${qIds})&select=*&order=id.asc`, { headers: QZ_HDRS() });
      const opArr = await opRes.json();
      opArr.forEach(o => {
        if (!optMap[o.question_id]) optMap[o.question_id] = [];
        optMap[o.question_id].push(o);
      });
    }

    // 4. Form fields bharo
    await populateNodeSelect();
    document.getElementById('qa-title').value     = quiz.title        || '';
    document.getElementById('qa-desc').value      = quiz.description  || '';
    document.getElementById('qa-passing').value   = quiz.passing_score|| 60;
    document.getElementById('qa-timelimit').value = quiz.time_limit   || 15;
    if (quiz.node_id) document.getElementById('qa-node').value = String(quiz.node_id);

    // 5. _qaQuestions array rebuild karo
    _qaQuestions = qqArr.map(q => {
      const qType   = q.question_type || 'mcq';
      const opts    = optMap[q.id] || [];
      const tfCorr  = qType === 'true_false'
        ? (opts.find(o => o.is_correct)?.option_text?.toLowerCase() || 'true')
        : 'true';
      return {
        text:                q.question_text || '',
        marks:               q.marks || 1,
        type:                qType,
        correct_answer_text: q.correct_answer_text || '',
        tf_correct:          tfCorr,
        options: qType === 'mcq'
          ? (opts.length ? opts.map(o => ({ text: o.option_text, is_correct: o.is_correct }))
                         : [{ text:'',is_correct:false },{ text:'',is_correct:false },{ text:'',is_correct:false },{ text:'',is_correct:false }])
          : (qType === 'true_false'
              ? [{ text:'True', is_correct: tfCorr==='true' },{ text:'False', is_correct: tfCorr==='false' }]
              : [])
      };
    });

    // 6. Questions render karo
    document.getElementById('qa-questions-list').innerHTML = '';
    if (_qaQuestions.length) {
      document.getElementById('qa-no-questions').style.display = 'none';
      renderAdminQuestions();
    } else {
      document.getElementById('qa-no-questions').style.display = 'block';
    }

    // 7. Editing mode set karo
    _editingQuizId = quizId;
    saveBtn.textContent = '✏️ Update Quiz';
    saveBtn.disabled    = false;
    statusEl.style.display = 'none';

    // Form top tak scroll karo
    document.getElementById('qa-title').scrollIntoView({ behavior:'smooth', block:'center' });

  } catch(e) {
    saveBtn.textContent = '💾 Save Quiz';
    saveBtn.disabled    = false;
    alert('Edit load error: ' + e.message);
  }
}
