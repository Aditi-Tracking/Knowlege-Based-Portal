// Section: Home Content (HR-editable card-grid boxes on the Home page)
// ╔══════════════════════════════════════════════════════════════════════════
// ║  [HOME CONTENT JS]
// ║  Tables (Supabase): home_content_sections, home_content_items
// ║  Permission: home_content_manage (see role_defaults/user_permissions) —
// ║  UX gating only, RLS on both tables is the real gate (same convention as
// ║  js/fieldservice.js's _fsCanCreate/_fsCanViewAll).
// ║
// ║  There is no separate admin page. Users with home_content_manage get
// ║  inline edit affordances rendered directly inside the Home page boxes:
// ║  a ✕ on each card, a "+" tile to add one (picked from Employee_details —
// ║  no manual text entry, no photo upload — subtitle/location/photo always
// ║  come straight from the employee record), a pencil to rename a section,
// ║  an icon to deactivate one, and a "+ Add Section" strip at the bottom.
// ║  Everyone else gets the exact same DOM as a user with no permission at
// ║  all — the manage-only branches are never rendered, not just hidden.
// ║
// ║  Key functions:
// ║    loadHomeContentSections() = fetch + entry point (called from js/auth.js's showPortal())
// ║    _hcRenderAll()            = pure re-render from in-memory state (no fetch)
// ╚══════════════════════════════════════════════════════════════════════════

const HC_ICON_PRESETS = ['🏆', '🌱', '🎉', '⭐', '🏅', '👏', '🎂', '📢', '🎯', '🌟', '💡', '🙌'];
const HC_ACCENT_PRESETS = [
  { key: 'blue',   hex: '#4e9af1' },
  { key: 'teal',   hex: '#00d4aa' },
  { key: 'orange', hex: '#f0a500' },
  { key: 'pink',   hex: '#ff5c7c' },
  { key: 'purple', hex: '#a78bfa' },
  { key: 'gold',   hex: '#ffcc44' },
];
function _hcAccentHex(key) {
  const found = HC_ACCENT_PRESETS.find(c => c.key === key);
  return found ? found.hex : '#00d4aa';
}
function _hcEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _hcMyEmail() { return (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.email) ? String(CURRENT_USER.email).trim().toLowerCase() : ''; }
function _hcCanManage() { return !!CURRENT_USER && typeof PERMISSIONS !== 'undefined' && PERMISSIONS.home_content_manage === 'true'; }

// Called by a broken <img onerror> — keeps the initials-avatar fallback out
// of an inline arrow function inside a template string (quoting that safely
// gets ugly fast).
function _hcPhotoError(imgEl, initial) {
  const av = document.createElement('div');
  av.className = 'potm-avatar';
  av.textContent = initial;
  imgEl.replaceWith(av);
}

// ── DATA STATE ────────────────────────────────────────────────────────────
let _hcSections = [];          // active sections, as fetched
let _hcItemsBySection = {};    // section_id -> active items[]
let _hcEmpDirectory = null;    // Employee_details rows for the add-card picker (null = not loaded yet)
let _hcEmpDirectoryPromise = null;

// ── EPHEMERAL INLINE-UI STATE (only one interactive affordance open at a time) ──
let _hcRenamingSection = null;          // section id currently showing the rename input
let _hcPendingDeactivateSection = null; // section id showing "Deactivate? Yes/No"
let _hcPendingRemoveItem = null;        // item id showing "Remove? Yes/No"
let _hcAddCardOpenFor = null;           // section id whose "+" tile is expanded
let _hcAddCardStep = null;              // 'search' | 'confirm'
let _hcAddCardQuery = '';
let _hcAddCardResults = [];             // last-rendered filtered employee list (indexed by the picker's onclick)
let _hcAddCardSelectedEmp = null;
let _hcAddSectionOpen = false;
let _hcAddSectionDraft = { title: '', icon: HC_ICON_PRESETS[0], accent_color: HC_ACCENT_PRESETS[0].key };

function _hcResetInlineUIState() {
  _hcRenamingSection = null;
  _hcPendingDeactivateSection = null;
  _hcPendingRemoveItem = null;
  _hcAddCardOpenFor = null;
  _hcAddCardStep = null;
  _hcAddCardQuery = '';
  _hcAddCardResults = [];
  _hcAddCardSelectedEmp = null;
  _hcAddSectionOpen = false;
  _hcAddSectionDraft = { title: '', icon: HC_ICON_PRESETS[0], accent_color: HC_ACCENT_PRESETS[0].key };
}

// ═══════════════════════════════════════════════════════════════════════
// LOAD + RENDER (every authenticated user calls this; manage affordances
// are additive branches inside it, gated by _hcCanManage())
// ═══════════════════════════════════════════════════════════════════════
async function loadHomeContentSections() {
  const container = document.getElementById('homeContentSections');
  if (!container) return;
  try {
    const secRes = await fetch(`${SUPABASE_URL}/rest/v1/home_content_sections?select=*&is_active=eq.true&order=display_order.asc`, { headers: SB_HDRS() });
    if (secRes.ok) {
      _hcSections = await secRes.json();
    } else {
      console.error('[HomeContent] home_content_sections fetch failed:', secRes.status, await secRes.text());
      _hcSections = [];
    }
    if (!Array.isArray(_hcSections)) _hcSections = [];

    if (_hcSections.length) {
      const ids = _hcSections.map(s => s.id).join(',');
      const itemRes = await fetch(`${SUPABASE_URL}/rest/v1/home_content_items?select=*&is_active=eq.true&section_id=in.(${ids})&order=display_order.asc`, { headers: SB_HDRS() });
      let items = [];
      if (itemRes.ok) {
        items = await itemRes.json();
      } else {
        console.error('[HomeContent] home_content_items fetch failed:', itemRes.status, await itemRes.text());
      }
      _hcItemsBySection = {};
      items.forEach(it => { (_hcItemsBySection[it.section_id] = _hcItemsBySection[it.section_id] || []).push(it); });
    } else {
      _hcItemsBySection = {};
    }

    // Warm the employee directory cache in the background for manage users —
    // not awaited, so it's usually already loaded by the time someone opens
    // the add-card picker.
    if (_hcCanManage()) _hcEnsureEmpDirectoryLoaded();

    _hcRenderAll();
  } catch (e) {
    console.error('[HomeContent] loadHomeContentSections failed:', e);
    container.innerHTML = '<div class="hp-card" style="color:var(--muted);font-size:0.84rem;padding:14px;">Couldn\'t load Home content right now.</div>';
  }
}

// Pure re-render from current in-memory state — no fetch. Used both after a
// data refresh and after purely local UI toggles (opening the search picker,
// entering rename mode, etc.) so those don't need a round-trip to redraw.
function _hcRenderAll() {
  const container = document.getElementById('homeContentSections');
  if (!container) return;
  const canManage = _hcCanManage();

  if (!_hcSections.length) {
    container.innerHTML = canManage ? _hcRenderAddSectionAffordance() : '';
    return;
  }

  const boxesHtml = _hcSections.map(sec => _hcRenderSectionBox(sec, _hcItemsBySection[sec.id] || [], canManage)).join('');
  container.innerHTML = boxesHtml + (canManage ? _hcRenderAddSectionAffordance() : '');
}

function _hcRenderSectionBox(sec, items, canManage) {
  const hex = _hcAccentHex(sec.accent_color);
  const icon = sec.icon || '⭐';

  const isRenaming = canManage && _hcRenamingSection === sec.id;
  const titleHtml = isRenaming
    ? `<input type="text" id="hcRenameInput-${sec.id}" value="${_hcEsc(sec.title)}"
         style="font-family:inherit;font-size:0.9rem;font-weight:700;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;">
       <button onclick="hcConfirmRename('${sec.id}')" title="Save" style="${_hcInlineIconBtnStyle()}">✓</button>
       <button onclick="hcCancelRename()" title="Cancel" style="${_hcInlineIconBtnStyle()}">✕</button>`
    : `<span class="hp-card-title">${_hcEsc(sec.title)}</span>
       ${canManage ? `<button onclick="hcStartRename('${sec.id}')" title="Rename section" style="${_hcInlineIconBtnStyle()}">✏️</button>` : ''}`;

  const isDeactivating = canManage && _hcPendingDeactivateSection === sec.id;
  const deactivateHtml = !canManage ? '' : (
    isDeactivating
      ? `<span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:0.74rem;color:var(--muted);white-space:nowrap;">
           Deactivate section?
           <button onclick="hcConfirmDeactivateSection('${sec.id}')" style="${_hcInlineTextBtnStyle('#ff5c7c')}">Yes</button>
           <button onclick="hcCancelDeactivateSection()" style="${_hcInlineTextBtnStyle()}">No</button>
         </span>`
      : `<button onclick="hcStartDeactivateSection('${sec.id}')" title="Deactivate section" style="margin-left:auto;${_hcInlineIconBtnStyle()}">🗑️</button>`
  );

  const cardsHtml = items.length
    ? items.map(it => _hcRenderItemCard(it, hex, canManage)).join('')
    : '<div style="color:var(--muted);font-size:0.84rem;padding:10px 0;">No entries yet.</div>';

  const addTileHtml = canManage ? _hcRenderAddCardTile(sec.id) : '';

  return `
    <div class="hp-card" style="margin-bottom:16px;position:relative;overflow:visible;">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${hex},${hex}99,${hex});background-size:200%;animation:shimmer2 3s linear infinite;border-radius:14px 14px 0 0;overflow:hidden;"></div>
      <div class="hp-card-header">
        <span class="hp-card-icon">${icon}</span>
        ${titleHtml}
        ${deactivateHtml}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:10px;">
        ${cardsHtml}${addTileHtml}
      </div>
    </div>`;
}

function _hcRenderItemCard(item, hex, canManage) {
  const name = _hcEsc(item.employee_name || '—');
  const initial = (item.employee_name || '?').trim()[0].toUpperCase();
  const photoHtml = item.photo_url
    ? `<img class="potm-photo" src="${_hcEsc(item.photo_url)}" alt="${name}" onerror="_hcPhotoError(this,'${initial}')">`
    : `<div class="potm-avatar">${initial}</div>`;

  const isPendingRemove = canManage && _hcPendingRemoveItem === item.id;
  const removeHtml = !canManage ? '' : (
    isPendingRemove
      ? `<div style="position:absolute;inset:0;background:var(--surface);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:10px;z-index:2;">
           <div style="font-size:0.76rem;color:var(--text2);text-align:center;">Remove this card?</div>
           <div style="display:flex;gap:8px;">
             <button onclick="hcConfirmRemoveItem('${item.id}')" style="${_hcInlineTextBtnStyle('#ff5c7c')}">Yes</button>
             <button onclick="hcCancelRemoveItem()" style="${_hcInlineTextBtnStyle()}">No</button>
           </div>
         </div>`
      : `<button onclick="hcStartRemoveItem('${item.id}')" title="Remove card" style="position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,0.35);color:#fff;font-size:0.7rem;line-height:20px;text-align:center;cursor:pointer;padding:0;z-index:2;">✕</button>`
  );

  return `
    <div class="potm-card" style="width:200px;">
      <div class="potm-card-bar" style="background:${hex};opacity:0.8;"></div>
      ${removeHtml}
      ${photoHtml}
      <div class="potm-name">${name}</div>
      ${item.subtitle ? `<div class="potm-dept" style="background:${hex}1f;color:${hex};border:1px solid ${hex}4d;">🏢 ${_hcEsc(item.subtitle)}</div>` : ''}
      ${item.location ? `<div class="potm-location">📍 ${_hcEsc(item.location)}</div>` : ''}
      ${item.extra_label ? `<div style="font-size:0.71rem;color:${hex};font-weight:700;background:${hex}1a;border:1px solid ${hex}40;border-radius:20px;padding:2px 9px;margin-top:6px;display:inline-block;">${_hcEsc(item.extra_label)}</div>` : ''}
    </div>`;
}

function _hcInlineIconBtnStyle() {
  return 'background:transparent;border:none;color:var(--muted);font-size:0.78rem;cursor:pointer;padding:2px 4px;';
}
function _hcInlineTextBtnStyle(color) {
  return `background:transparent;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:0.74rem;cursor:pointer;color:${color || 'var(--text2)'};font-family:inherit;`;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION RENAME (inline)
// ═══════════════════════════════════════════════════════════════════════
function hcStartRename(sectionId) {
  _hcResetInlineUIState();
  _hcRenamingSection = sectionId;
  _hcRenderAll();
  const input = document.getElementById('hcRenameInput-' + sectionId);
  if (input) { input.focus(); input.select(); }
}
function hcCancelRename() {
  _hcResetInlineUIState();
  _hcRenderAll();
}
async function hcConfirmRename(sectionId) {
  const input = document.getElementById('hcRenameInput-' + sectionId);
  const title = input ? input.value.trim() : '';
  if (!title) { alert('❌ Title cannot be empty.'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/home_content_sections?id=eq.${sectionId}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(),
      body: JSON.stringify({ title, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(await res.text());
    _hcResetInlineUIState();
    await loadHomeContentSections();
  } catch (e) {
    alert('❌ Rename failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION DEACTIVATE (inline confirm)
// ═══════════════════════════════════════════════════════════════════════
function hcStartDeactivateSection(sectionId) {
  _hcResetInlineUIState();
  _hcPendingDeactivateSection = sectionId;
  _hcRenderAll();
}
function hcCancelDeactivateSection() {
  _hcResetInlineUIState();
  _hcRenderAll();
}
async function hcConfirmDeactivateSection(sectionId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/home_content_sections?id=eq.${sectionId}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(),
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(await res.text());
    _hcResetInlineUIState();
    await loadHomeContentSections();
  } catch (e) {
    alert('❌ Deactivate failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CARD REMOVE (inline confirm, soft-delete via is_active=false)
// ═══════════════════════════════════════════════════════════════════════
function hcStartRemoveItem(itemId) {
  _hcResetInlineUIState();
  _hcPendingRemoveItem = itemId;
  _hcRenderAll();
}
function hcCancelRemoveItem() {
  _hcResetInlineUIState();
  _hcRenderAll();
}
async function hcConfirmRemoveItem(itemId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/home_content_items?id=eq.${itemId}`, {
      method: 'PATCH', headers: SB_HDRS_MIN(),
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(await res.text());
    _hcResetInlineUIState();
    await loadHomeContentSections();
  } catch (e) {
    alert('❌ Remove failed: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADD CARD — employee picker only, no manual entry, no photo upload.
// subtitle/location/photo_url are always copied from Employee_details.
// ═══════════════════════════════════════════════════════════════════════
function _hcEnsureEmpDirectoryLoaded() {
  if (_hcEmpDirectory !== null) return Promise.resolve();
  if (_hcEmpDirectoryPromise) return _hcEmpDirectoryPromise;
  _hcEmpDirectoryPromise = fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Employee_name,Employee_Dept,Location,avatar_url,Link&order=Employee_name.asc`, { headers: SB_HDRS() })
    .then(res => res.ok ? res.json() : [])
    .then(rows => { _hcEmpDirectory = Array.isArray(rows) ? rows : []; })
    .catch(() => { _hcEmpDirectory = []; });
  return _hcEmpDirectoryPromise;
}

function _hcFilteredEmpDirectory(query) {
  const dir = _hcEmpDirectory || [];
  const q = String(query || '').trim().toLowerCase();
  const filtered = q ? dir.filter(e => String(e.Employee_name || '').toLowerCase().includes(q)) : dir;
  return filtered.slice(0, 40); // cap the popover's result list to something scannable
}

function _hcRenderAddCardTile(sectionId) {
  if (_hcAddCardOpenFor !== sectionId) {
    return `<div class="potm-card" onclick="hcOpenAddCardTile('${sectionId}')" title="Add a card"
      style="width:200px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1.5px dashed var(--border);background:transparent;box-shadow:none;">
      <span style="font-size:1.8rem;color:var(--muted);">+</span>
    </div>`;
  }
  return _hcAddCardStep === 'confirm' && _hcAddCardSelectedEmp
    ? _hcRenderAddCardConfirmStep(sectionId)
    : _hcRenderAddCardSearchStep(sectionId);
}

function _hcRenderAddCardSearchStep(sectionId) {
  const results = _hcFilteredEmpDirectory(_hcAddCardQuery);
  return `
    <div class="potm-card" style="width:200px;position:relative;overflow:visible;box-shadow:none;">
      <div style="position:absolute;top:0;left:0;width:240px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px;z-index:20;box-shadow:0 8px 24px rgba(0,0,0,0.25);text-align:left;">
        <input type="text" id="hcAddCardSearchInput" placeholder="🔍 Search employee name…" value="${_hcEsc(_hcAddCardQuery)}"
          oninput="hcSearchEmpDirectory(this.value)" autofocus
          style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);font-size:0.82rem;font-family:inherit;margin-bottom:8px;">
        <div id="hcAddCardResultsList" style="max-height:180px;overflow-y:auto;">${_hcRenderResultsListHtml(results)}</div>
        <button onclick="hcCancelAddCard()" style="margin-top:8px;width:100%;padding:5px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:0.78rem;cursor:pointer;font-family:inherit;">Cancel</button>
      </div>
    </div>`;
}

function _hcRenderResultsListHtml(results) {
  _hcAddCardResults = results;
  if (_hcEmpDirectory === null) return '<div style="font-size:0.78rem;color:var(--muted);padding:6px 2px;">Loading employees…</div>';
  if (!results.length) return '<div style="font-size:0.78rem;color:var(--muted);padding:6px 2px;">No matches.</div>';
  return results.map((emp, i) => `
    <div onclick="hcPickEmployeeByIndex(${i})" style="padding:6px 6px;border-radius:6px;cursor:pointer;font-size:0.82rem;color:var(--text);"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight:600;">${_hcEsc(emp.Employee_name)}</div>
      <div style="font-size:0.72rem;color:var(--muted);">${_hcEsc(emp.Employee_Dept || '—')}</div>
    </div>`).join('');
}

// _hcItemsBySection only ever holds rows fetched with is_active=eq.true (see
// loadHomeContentSections), so every entry in it already satisfies
// is_active=true — no separate flag check needed here, just the name match.
function _hcSectionHasActiveEmployeeCard(sectionId, employeeName) {
  const items = _hcItemsBySection[sectionId] || [];
  const name = String(employeeName || '').trim().toLowerCase();
  return items.some(it => String(it.employee_name || '').trim().toLowerCase() === name);
}

function _hcRenderAddCardConfirmStep(sectionId) {
  const emp = _hcAddCardSelectedEmp;
  const hasPhoto = !!(emp.avatar_url || emp.Link);
  const isDuplicate = _hcSectionHasActiveEmployeeCard(sectionId, emp.Employee_name);
  return `
    <div class="potm-card" style="width:200px;position:relative;overflow:visible;box-shadow:none;">
      <div style="position:absolute;top:0;left:0;width:240px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;z-index:20;box-shadow:0 8px 24px rgba(0,0,0,0.25);text-align:left;">
        <div style="font-weight:700;font-size:0.86rem;color:var(--text);margin-bottom:4px;">${_hcEsc(emp.Employee_name)}</div>
        <div style="font-size:0.76rem;color:var(--muted);margin-bottom:6px;">${_hcEsc(emp.Employee_Dept || '—')}${emp.Location ? ' · ' + _hcEsc(emp.Location) : ''}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-bottom:10px;">${hasPhoto ? '📷 Profile photo will be used' : '⚠️ No profile photo on file'}</div>
        ${isDuplicate ? `<div style="font-size:0.74rem;color:#f0a500;background:rgba(240,165,0,0.12);border:1px solid rgba(240,165,0,0.3);border-radius:8px;padding:6px 8px;margin-bottom:10px;">⚠️ ${_hcEsc(emp.Employee_name)} already has an active card in this section. Add anyway?</div>` : ''}
        <label style="font-size:0.74rem;color:var(--text2);display:block;margin-bottom:4px;">Extra label (optional)</label>
        <input type="text" id="hcAddCardExtraLabel" placeholder="e.g. June 2026"
          style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text);font-size:0.82rem;font-family:inherit;margin-bottom:10px;">
        <div style="display:flex;gap:8px;">
          <button onclick="hcConfirmAddCard('${sectionId}')" style="flex:1;padding:6px;border-radius:8px;border:none;background:${isDuplicate ? '#f0a500' : '#00d4aa'};color:${isDuplicate ? '#2b1d00' : '#04231d'};font-weight:700;font-size:0.8rem;cursor:pointer;font-family:inherit;">${isDuplicate ? 'Add Anyway' : 'Add'}</button>
          <button onclick="hcCancelAddCard()" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:0.8rem;cursor:pointer;font-family:inherit;">Cancel</button>
        </div>
      </div>
    </div>`;
}

function hcOpenAddCardTile(sectionId) {
  _hcResetInlineUIState();
  _hcAddCardOpenFor = sectionId;
  _hcAddCardStep = 'search';
  _hcRenderAll();
  const input = document.getElementById('hcAddCardSearchInput');
  if (input) input.focus();
  _hcEnsureEmpDirectoryLoaded().then(() => {
    // Only refresh the results list (not a full re-render) so a still-open
    // picker doesn't yank focus away from whatever the user is mid-typing.
    if (_hcAddCardOpenFor !== sectionId) return;
    const listEl = document.getElementById('hcAddCardResultsList');
    if (listEl) listEl.innerHTML = _hcRenderResultsListHtml(_hcFilteredEmpDirectory(_hcAddCardQuery));
  });
}
function hcSearchEmpDirectory(value) {
  _hcAddCardQuery = value;
  const listEl = document.getElementById('hcAddCardResultsList');
  if (listEl) listEl.innerHTML = _hcRenderResultsListHtml(_hcFilteredEmpDirectory(value));
}
function hcPickEmployeeByIndex(i) {
  const emp = _hcAddCardResults[i];
  if (!emp) return;
  _hcAddCardSelectedEmp = emp;
  _hcAddCardStep = 'confirm';
  _hcRenderAll();
}
function hcCancelAddCard() {
  _hcResetInlineUIState();
  _hcRenderAll();
}
async function hcConfirmAddCard(sectionId) {
  const emp = _hcAddCardSelectedEmp;
  if (!emp) return;
  const extraLabelInput = document.getElementById('hcAddCardExtraLabel');
  const extraLabel = extraLabelInput ? extraLabelInput.value.trim() : '';
  const items = _hcItemsBySection[sectionId] || [];
  const nextOrder = items.length ? Math.max(...items.map(i => i.display_order || 0)) + 1 : 0;

  const payload = {
    section_id: sectionId,
    employee_name: emp.Employee_name,
    subtitle: emp.Employee_Dept || null,
    location: emp.Location || null,
    extra_label: extraLabel || null,
    photo_url: emp.avatar_url || emp.Link || null,
    display_order: nextOrder,
    created_by: _hcMyEmail()
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/home_content_items`, { method: 'POST', headers: SB_HDRS_MIN(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    _hcResetInlineUIState();
    await loadHomeContentSections();
  } catch (e) {
    alert('❌ Failed to add card: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADD SECTION (compact inline affordance at the bottom of the stack)
// ═══════════════════════════════════════════════════════════════════════
function _hcRenderAddSectionAffordance() {
  if (!_hcAddSectionOpen) {
    return `<div onclick="hcOpenAddSection()" style="border:1.5px dashed var(--border);border-radius:14px;padding:14px;text-align:center;color:var(--muted);font-size:0.86rem;cursor:pointer;">+ Add Section</div>`;
  }
  const iconPicker = HC_ICON_PRESETS.map(ic => `<button type="button" onclick="hcPickNewSectionIcon('${ic}')"
    style="font-size:1.2rem;padding:6px 10px;border-radius:8px;border:1.5px solid ${ic === _hcAddSectionDraft.icon ? 'var(--accent2,#00d4aa)' : 'var(--border)'};background:${ic === _hcAddSectionDraft.icon ? 'rgba(0,212,170,0.12)' : 'var(--surface2)'};cursor:pointer;">${ic}</button>`).join('');
  const colorPicker = HC_ACCENT_PRESETS.map(c => `<button type="button" onclick="hcPickNewSectionColor('${c.key}')" title="${c.key}"
    style="width:26px;height:26px;border-radius:50%;background:${c.hex};border:2.5px solid ${c.key === _hcAddSectionDraft.accent_color ? 'var(--text)' : 'transparent'};cursor:pointer;"></button>`).join('');

  return `
    <div style="border:1.5px dashed var(--border);border-radius:14px;padding:16px;">
      <input type="text" id="hcNewSectionTitle" value="${_hcEsc(_hcAddSectionDraft.title)}" oninput="_hcAddSectionDraft.title=this.value"
        placeholder="Section title, e.g. Employee of the Quarter" autofocus
        style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:0.88rem;font-family:inherit;margin-bottom:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${iconPicker}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">${colorPicker}</div>
      <div style="display:flex;gap:8px;">
        <button onclick="hcConfirmAddSection()" style="flex:1;padding:8px;border-radius:8px;border:none;background:#00d4aa;color:#04231d;font-weight:700;font-size:0.85rem;cursor:pointer;font-family:inherit;">Create Section</button>
        <button onclick="hcCancelAddSection()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:0.85rem;cursor:pointer;font-family:inherit;">Cancel</button>
      </div>
    </div>`;
}

function hcOpenAddSection() {
  _hcResetInlineUIState();
  _hcAddSectionOpen = true;
  _hcRenderAll();
  const input = document.getElementById('hcNewSectionTitle');
  if (input) input.focus();
}
function hcCancelAddSection() {
  _hcResetInlineUIState();
  _hcRenderAll();
}
function hcPickNewSectionIcon(ic) { _hcAddSectionDraft.icon = ic; _hcRenderAll(); }
function hcPickNewSectionColor(key) { _hcAddSectionDraft.accent_color = key; _hcRenderAll(); }

async function hcConfirmAddSection() {
  const input = document.getElementById('hcNewSectionTitle');
  const title = (input ? input.value : _hcAddSectionDraft.title || '').trim();
  if (!title) { alert('❌ Title is required.'); return; }
  const nextOrder = _hcSections.length ? Math.max(..._hcSections.map(s => s.display_order || 0)) + 1 : 0;

  const payload = {
    title,
    icon: _hcAddSectionDraft.icon,
    accent_color: _hcAddSectionDraft.accent_color,
    display_order: nextOrder,
    created_by: _hcMyEmail()
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/home_content_sections`, { method: 'POST', headers: SB_HDRS_MIN(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    _hcResetInlineUIState();
    await loadHomeContentSections();
  } catch (e) {
    alert('❌ Failed to create section: ' + e.message);
  }
}
