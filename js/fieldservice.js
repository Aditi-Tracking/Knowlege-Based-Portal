// Section: Field Service (loadFieldService, per-job-type dynamic form, submission-only + listing/gallery)
// Tables (Supabase): field_service_entries, field_service_photos
// Storage bucket: field-service-photos (public)
// Access control: PERMISSIONS.field_service_create (submit) / PERMISSIONS.field_service_view_all (see everyone's
// entries; otherwise RLS restricts a user to their own). These checks are UX gating only — RLS is the real gate.

// ── Job type → per-type fields + photo label (source of truth for the dynamic form) ──
const JOB_TYPE_CONFIG = {
  new_installation: {
    label: 'New Installation',
    fields: [
      { key: 'vehicle_number', label: 'Vehicle Number', type: 'text' },
      { key: 'new_imei',       label: 'New Device IMEI', type: 'text', numeric: true },
      { key: 'sim_number',     label: 'SIM Number',      type: 'text', numeric: true },
    ],
    photoLabel: 'Vehicle Number and Device IMEI Picture'
  },
  reinstallation: {
    label: 'Re-installation',
    fields: [
      { key: 'old_vehicle_number', label: 'Old Vehicle Number', type: 'text' },
      { key: 'new_vehicle_number', label: 'New Vehicle Number', type: 'text' },
    ],
    photoLabel: 'New Vehicle Picture and Device IMEI Picture'
  },
  device_replace: {
    label: 'Device Replace',
    fields: [
      { key: 'old_imei', label: 'Old Device IMEI', type: 'text', numeric: true },
      { key: 'new_imei', label: 'New Device IMEI', type: 'text', numeric: true },
    ],
    photoLabel: 'New Device Picture with IMEI'
  },
  sim_replace: {
    label: 'Sim Replace',
    fields: [
      { key: 'new_sim_number', label: 'New SIM Number', type: 'text', numeric: true },
      { key: 'old_sim_number', label: 'Old SIM Number', type: 'text', numeric: true },
    ],
    photoLabel: 'New Sim Picture'
  },
  sensor_replace: {
    label: 'Sensor Replace',
    fields: [
      { key: 'old_sensor', label: 'Old Sensor', type: 'text' },
      { key: 'new_sensor', label: 'New Sensor', type: 'text' },
    ],
    photoLabel: null
  },
  device_sensor_remove: {
    label: 'Device or Sensor Remove',
    fields: [],
    photoLabel: 'Handover (Proof)'
  },
  device_sensor_collected: {
    label: 'Sensor or Device Collected',
    fields: [
      { key: 'collection_proof', label: 'IMEI + note if any parts missing', type: 'textarea' },
    ],
    photoLabel: 'Device Collected Pictures'
  },
  tampering: {
    label: 'Tampering',
    fields: [],
    photoLabel: 'Tampering Picture'
  },
  reactivation: {
    label: 'Reactivation',
    fields: [
      { key: 'new_sim_number',     label: 'New SIM Number',    type: 'text', numeric: true },
      { key: 'device_imei',        label: 'Device IMEI',       type: 'text', numeric: true },
      { key: 'new_vehicle_number', label: 'New Vehicle Number (optional)', type: 'text', required: false },
    ],
    photoLabel: 'New Sim + New Vehicle Picture Upload'
  }
};

const FS_BUCKET = 'field-service-photos';

// ── Access control ──────────────────────────────────────────────────────
function _fsCanCreate(){ return !!CURRENT_USER && PERMISSIONS.field_service_create === 'true'; }
function _fsCanViewAll(){ return !!CURRENT_USER && PERMISSIONS.field_service_view_all === 'true'; }
function _fsHasAccess(){ return _fsCanCreate() || _fsCanViewAll(); }

function _applyFieldServiceNavVisibility(){
  const show = _fsHasAccess();
  const nav = document.getElementById('nav-fieldservice');
  const mm  = document.getElementById('mm-fieldservice');
  if (nav) nav.style.display = show ? 'flex' : 'none';
  if (mm)  mm.style.display  = show ? 'flex' : 'none';
  return show;
}

// ── Small helpers ────────────────────────────────────────────────────────
function _fsEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _fsPublicPhotoUrl(storagePath){
  return `${SUPABASE_URL}/storage/v1/object/public/${FS_BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}
function _fsMsg(text, color){
  const el = document.getElementById('fsSubmitStatus');
  if (!el) return;
  el.style.display    = 'block';
  el.style.background = color + '1f';
  el.style.color      = color;
  el.textContent      = text;
}

// ── Entry point (called from switchDB) ──────────────────────────────────
let _fsInited     = false;
let _fsActiveTab  = 'submit';

function loadFieldService(){
  if (!_fsHasAccess()) { switchDB('home'); return; }
  if (!_fsCanCreate() && _fsActiveTab === 'submit') _fsActiveTab = 'list';
  if (!_fsInited) {
    _fsInited = true;
    _fsRenderSubmitForm();
    _fsRenderListSkeleton();
  }
  _fsRenderTabBar();
  _fsSwitchTabView(_fsActiveTab);
}

function _fsRenderTabBar(){
  const bar = document.getElementById('fsTabBar');
  if (!bar) return;
  const tabs = [];
  if (_fsCanCreate()) tabs.push(['submit', '📝 Submit Entry']);
  tabs.push(['list', _fsCanViewAll() ? '📋 All Entries' : '📋 My Entries']);
  bar.innerHTML = tabs.map(([id, label]) => {
    const active = _fsActiveTab === id;
    return `<button onclick="_fsSwitchTab('${id}')" style="padding:10px 18px;border-radius:10px;border:1.5px solid ${active ? 'var(--accent2)' : 'var(--border)'};background:${active ? 'rgba(0,212,170,0.12)' : 'var(--surface2)'};color:${active ? 'var(--accent2)' : 'var(--muted)'};font-weight:700;font-size:0.87rem;cursor:pointer;font-family:inherit;">${label}</button>`;
  }).join('');
}

function _fsSwitchTab(tab){
  _fsActiveTab = tab;
  _fsRenderTabBar();
  _fsSwitchTabView(tab);
}

async function _fsSwitchTabView(tab){
  const submitEl = document.getElementById('fsSubmitTab');
  const listEl   = document.getElementById('fsListTab');
  if (submitEl) submitEl.style.display = tab === 'submit' ? 'block' : 'none';
  if (listEl)   listEl.style.display   = tab === 'list'   ? 'block' : 'none';
  if (tab === 'list') {
    // Await the Engineer/Client dropdown options (cached after first fetch)
    // before rendering entries, so the very first render already shows
    // resolved engineer names instead of raw uuids.
    await _fsLoadFilterOptions();
    _fsLoadEntries();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SUBMIT TAB — dynamic per-job-type form
// ═══════════════════════════════════════════════════════════════════════
let _fsSelectedJobType   = null;
let _fsPendingPhotos     = []; // { file, blobUrl, status: pending|uploading|done|error, progress, error }
let _fsCurrentEntryId    = null;
let _fsCurrentPhotoLabel = null;

function _fsRenderSubmitForm(){
  const wrap = document.getElementById('fsSubmitTab');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;max-width:640px;">
      <div style="font-weight:800;font-size:1.05rem;color:var(--text);margin-bottom:18px;">🛠️ New Field Service Entry</div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:6px;">Client Name *</label>
        <input id="fsClientName" type="text" placeholder="Client name" style="width:100%;padding:14px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:0.95rem;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:6px;">Location *</label>
        <input id="fsLocation" type="text" placeholder="Site / location" style="width:100%;padding:14px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:0.95rem;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:10px;">Job Type *</label>
        <div id="fsJobTypeGrid" style="display:flex;flex-direction:column;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;"></div>
      </div>
      <div id="fsDynamicFields"></div>
      <div id="fsPhotoSection"></div>
      <div id="fsSubmitStatus" style="display:none;padding:11px 14px;border-radius:10px;font-size:0.85rem;font-weight:600;margin-bottom:14px;"></div>
      <button id="fsSubmitBtn" onclick="fsSubmitEntry()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent2);color:#04231d;font-weight:800;font-size:1rem;cursor:pointer;font-family:inherit;">✅ Submit Entry</button>
    </div>`;
  _fsRenderJobTypeGrid();
}

function _fsRenderJobTypeGrid(){
  const grid = document.getElementById('fsJobTypeGrid');
  if (!grid) return;
  const entries = Object.entries(JOB_TYPE_CONFIG);
  grid.innerHTML = entries.map(([key, cfg], i) => {
    const active = _fsSelectedJobType === key;
    const borderTop = i > 0 ? 'border-top:1px solid var(--border);' : '';
    return `<button type="button" onclick="_fsSelectJobType('${key}')" style="display:flex;align-items:center;gap:12px;width:100%;padding:16px 16px;border:none;${borderTop}background:${active ? 'rgba(0,212,170,0.12)' : 'var(--surface2)'};color:${active ? 'var(--accent2)' : 'var(--text2)'};font-weight:700;font-size:0.9rem;cursor:pointer;font-family:inherit;text-align:left;min-height:52px;">
      <span style="width:18px;height:18px;border-radius:50%;border:2px solid ${active ? 'var(--accent2)' : 'var(--muted)'};flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        ${active ? '<span style="width:9px;height:9px;border-radius:50%;background:var(--accent2);"></span>' : ''}
      </span>
      <span>${cfg.label}</span>
    </button>`;
  }).join('');
}

// Selecting a job type fully re-renders (not just hides) the fields + photo
// section, so switching types can never leave a stale value behind — the
// old inputs simply don't exist in the DOM once a different type is picked.
function _fsSelectJobType(key){
  _fsSelectedJobType = key;
  _fsPendingPhotos.forEach(p => URL.revokeObjectURL(p.blobUrl));
  _fsPendingPhotos = [];
  _fsRenderJobTypeGrid();
  _fsRenderDynamicFields();
  _fsRenderPhotoSection();
}

function _fsRenderDynamicFields(){
  const wrap = document.getElementById('fsDynamicFields');
  if (!wrap) return;
  const cfg = JOB_TYPE_CONFIG[_fsSelectedJobType];
  if (!cfg || !cfg.fields.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = cfg.fields.map(f => {
    const req = f.required !== false;
    if (f.type === 'textarea') {
      return `<div style="margin-bottom:16px;">
        <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:6px;">${f.label}${req ? ' *' : ''}</label>
        <textarea id="fsField-${f.key}" rows="3" style="width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:0.9rem;box-sizing:border-box;resize:vertical;"></textarea>
      </div>`;
    }
    const inputAttrs = f.numeric ? 'inputmode="numeric" pattern="[0-9]*"' : '';
    return `<div style="margin-bottom:16px;">
      <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:6px;">${f.label}${req ? ' *' : ''}</label>
      <input id="fsField-${f.key}" type="text" ${inputAttrs} style="width:100%;padding:14px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit;font-size:0.95rem;box-sizing:border-box;">
    </div>`;
  }).join('');
}

function _fsRenderPhotoSection(){
  const wrap = document.getElementById('fsPhotoSection');
  if (!wrap) return;
  const cfg = JOB_TYPE_CONFIG[_fsSelectedJobType];
  if (!cfg || !cfg.photoLabel) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--muted);margin-bottom:8px;">${cfg.photoLabel}</label>
      <input type="file" id="fsPhotoInput" accept="image/*" capture="environment" multiple
        onchange="_fsAddPhotos(this.files); this.value='';"
        style="display:block;width:100%;padding:12px;border-radius:10px;border:1.5px dashed var(--border);background:var(--surface2);color:var(--text2);font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
      <div id="fsPhotoPreview" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;"></div>
    </div>`;
}

function _fsAddPhotos(fileList){
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith('image/')) continue;
    _fsPendingPhotos.push({ file, blobUrl: URL.createObjectURL(file), status: 'pending', progress: 0, error: null });
  }
  _fsRenderPhotoPreview();
}

function _fsRenderPhotoPreview(){
  const c = document.getElementById('fsPhotoPreview');
  if (!c) return;
  c.innerHTML = _fsPendingPhotos.map((p, i) => {
    let overlay = '';
    if (p.status === 'uploading') {
      overlay = `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;font-weight:700;border-radius:10px;">${p.progress}%</div>`;
    } else if (p.status === 'error') {
      overlay = `<div onclick="_fsRetryPhoto(${i})" title="Retry upload — ${_fsEsc(p.error || '')}" style="position:absolute;inset:0;background:rgba(239,68,68,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.2rem;border-radius:10px;cursor:pointer;">↻</div>`;
    } else if (p.status === 'done') {
      overlay = `<div style="position:absolute;bottom:3px;right:3px;background:#00d4aa;color:#04231d;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;">✓</div>`;
    }
    const removeBtn = p.status !== 'uploading'
      ? `<button type="button" onclick="_fsRemovePendingPhoto(${i})" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#ff5c7c;color:#fff;font-size:0.72rem;cursor:pointer;line-height:20px;padding:0;">✕</button>`
      : '';
    return `<div style="position:relative;width:72px;height:72px;flex-shrink:0;">
      <img src="${p.blobUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;border:1px solid var(--border);">
      ${overlay}${removeBtn}
    </div>`;
  }).join('');
}

function _fsRemovePendingPhoto(i){
  const [removed] = _fsPendingPhotos.splice(i, 1);
  if (removed) URL.revokeObjectURL(removed.blobUrl);
  _fsRenderPhotoPreview();
}

// Disables the form once the entry row is saved — prevents a duplicate
// field_service_entries row from a second click while photos are still
// uploading/retrying. Individual photo retries (↻ on a thumbnail) still work.
function _fsLockFormAfterSave(){
  const clientEl = document.getElementById('fsClientName'); if (clientEl) clientEl.disabled = true;
  const locEl    = document.getElementById('fsLocation');   if (locEl)    locEl.disabled = true;
  document.querySelectorAll('#fsJobTypeGrid button').forEach(b => b.disabled = true);
  document.querySelectorAll('#fsDynamicFields input,#fsDynamicFields textarea').forEach(el => el.disabled = true);
  const fileInput = document.getElementById('fsPhotoInput'); if (fileInput) fileInput.disabled = true;
}

async function fsSubmitEntry(){
  if (_fsCurrentEntryId) return; // guard: this form instance already saved an entry
  if (!_fsCanCreate()) { _fsMsg('⛔ You do not have permission to submit field service entries.', '#ff5c7c'); return; }

  const btn        = document.getElementById('fsSubmitBtn');
  const clientName = document.getElementById('fsClientName').value.trim();
  const location    = document.getElementById('fsLocation').value.trim();
  const jobType     = _fsSelectedJobType;

  if (!clientName) { _fsMsg('⚠️ Client name is required.', '#ff5c7c'); return; }
  if (!location)   { _fsMsg('⚠️ Location is required.', '#ff5c7c'); return; }
  if (!jobType)     { _fsMsg('⚠️ Please select a job type.', '#ff5c7c'); return; }

  const cfg = JOB_TYPE_CONFIG[jobType];
  const details = {};
  for (const f of cfg.fields) {
    const el  = document.getElementById('fsField-' + f.key);
    const val = el ? el.value.trim() : '';
    if (f.required !== false && !val) { _fsMsg(`⚠️ Please fill in "${f.label}".`, '#ff5c7c'); return; }
    if (val) details[f.key] = val;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Submitting…';
  _fsMsg('⏳ Saving entry…', '#f0a500');

  try {
    const { data: sessionData } = await _sbAuth.auth.getSession();
    const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
    if (!userId) throw new Error('Could not verify your session — please log in again.');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/field_service_entries`, {
      method: 'POST',
      headers: SB_HDRS_REPR(),
      body: JSON.stringify({ engineer_id: userId, client_name: clientName, location, job_type: jobType, details })
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t || ('HTTP ' + res.status)); }
    const [saved] = await res.json();

    _fsCurrentEntryId    = saved.id;
    _fsCurrentPhotoLabel = cfg.photoLabel;
    _fsLockFormAfterSave();

    if (cfg.photoLabel && _fsPendingPhotos.length) {
      _fsMsg('⏳ Uploading photos…', '#f0a500');
      // Sequential, not Promise.all — a failed upload doesn't block or lose
      // the others, and this avoids piling concurrent XHRs onto one bucket.
      for (const item of _fsPendingPhotos) {
        await _fsUploadPhoto(_fsCurrentEntryId, item, cfg.photoLabel);
      }
    }
    _fsAfterUploadRoundCheck();
  } catch (e) {
    _fsMsg('❌ ' + e.message, '#ff5c7c');
    btn.disabled = false;
    btn.textContent = '✅ Submit Entry';
  }
}

async function _fsUploadPhoto(entryId, item, photoLabel){
  item.status = 'uploading'; item.progress = 0; item.error = null;
  _fsRenderPhotoPreview();
  try {
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${entryId}/${Date.now()}_${safeName}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${FS_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('apikey', SUPABASE_ANON);
      xhr.setRequestHeader('Authorization', `Bearer ${_currentToken}`);
      xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) { item.progress = Math.round((ev.loaded / ev.total) * 100); _fsRenderPhotoPreview(); }
      };
      xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('Upload failed (HTTP ' + xhr.status + ')'));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(item.file);
    });

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/field_service_photos`, {
      method: 'POST',
      headers: SB_HDRS_MIN(),
      body: JSON.stringify({ entry_id: entryId, field_label: photoLabel, storage_path: path, file_name: item.file.name })
    });
    if (!insRes.ok) { const t = await insRes.text(); throw new Error(t || ('Could not save photo record (HTTP ' + insRes.status + ')')); }

    item.status = 'done'; item.progress = 100;
  } catch (e) {
    item.status = 'error'; item.error = e.message;
  }
  _fsRenderPhotoPreview();
}

async function _fsRetryPhoto(i){
  const item = _fsPendingPhotos[i];
  if (!item || item.status !== 'error' || !_fsCurrentEntryId) return;
  await _fsUploadPhoto(_fsCurrentEntryId, item, _fsCurrentPhotoLabel);
  _fsAfterUploadRoundCheck();
}

function _fsAfterUploadRoundCheck(){
  const btn    = document.getElementById('fsSubmitBtn');
  const failed = _fsPendingPhotos.filter(p => p.status === 'error').length;
  if (!btn) return;
  if (!failed) {
    _fsMsg('✅ Entry submitted successfully!', '#00d4aa');
    btn.textContent = '🆕 Log Another Entry';
  } else {
    _fsMsg(`⚠️ Entry saved, but ${failed} photo${failed > 1 ? 's' : ''} failed to upload — tap ↻ on a thumbnail to retry, or start a new entry.`, '#f0a500');
    btn.textContent = '🆕 Start New Entry';
  }
  btn.disabled = false;
  btn.onclick = _fsResetForm;
}

function _fsResetForm(){
  _fsPendingPhotos.forEach(p => URL.revokeObjectURL(p.blobUrl));
  _fsPendingPhotos     = [];
  _fsSelectedJobType   = null;
  _fsCurrentEntryId    = null;
  _fsCurrentPhotoLabel = null;
  _fsRenderSubmitForm();
}

// ═══════════════════════════════════════════════════════════════════════
// LIST TAB — own entries (create-only) or all entries + filters (view_all)
// ═══════════════════════════════════════════════════════════════════════
let _fsEntries = [];
let _fsEngineerOptions = null; // cached [{engineer_id, email, name}], view_all only
let _fsClientOptions   = null; // cached [string], view_all only

function _fsRenderListSkeleton(){
  const wrap = document.getElementById('fsListTab');
  if (!wrap) return;
  const showFilters = _fsCanViewAll();
  wrap.innerHTML = `
    ${showFilters ? `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <select id="fsFilterJobType" onchange="_fsLoadEntries()" style="padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.83rem;font-family:inherit;">
        <option value="">All Job Types</option>
        ${Object.entries(JOB_TYPE_CONFIG).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}
      </select>
      <select id="fsFilterEngineer" onchange="_fsLoadEntries()" style="padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.83rem;font-family:inherit;">
        <option value="">All Engineers</option>
      </select>
      <select id="fsFilterClient" onchange="_fsLoadEntries()" style="padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.83rem;font-family:inherit;">
        <option value="">All Clients</option>
      </select>
      <input id="fsFilterFrom" type="date" onchange="_fsLoadEntries()" style="padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.83rem;font-family:inherit;">
      <input id="fsFilterTo" type="date" onchange="_fsLoadEntries()" style="padding:9px 12px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:0.83rem;font-family:inherit;">
      <button onclick="_fsClearFilters()" style="padding:9px 14px;border-radius:9px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-size:0.83rem;font-weight:600;cursor:pointer;font-family:inherit;">Clear</button>
    </div>` : ''}
    <div id="fsEntriesLoading" style="text-align:center;padding:40px;color:var(--muted);">⏳ Loading entries…</div>
    <div id="fsEntriesEmpty" style="display:none;text-align:center;padding:40px;color:var(--muted);">No entries found.</div>
    <div id="fsEntriesList" style="display:none;"></div>
  `;
}

// Populates the Engineer + Client dropdowns once, from data that already
// exists — the engineer list comes from a backend endpoint (only the
// service-role key can resolve an auth uuid to an email/name; see
// backend/api.py), the client list from the distinct client_name values
// already in field_service_entries. Cached — only re-fetched on a hard
// panel re-render (e.g. re-login), not on every filter change.
async function _fsLoadFilterOptions(){
  if (!_fsCanViewAll()) return;
  const tasks = [];
  if (_fsEngineerOptions === null) tasks.push(_fsFetchEngineerOptions());
  if (_fsClientOptions === null)   tasks.push(_fsFetchClientOptions());
  if (tasks.length) await Promise.all(tasks);
}

async function _fsFetchEngineerOptions(){
  try {
    const res = await fetch(`${_PAPI}/api/field-service/engineer-names`, {
      headers: { 'X-User-Email': CURRENT_USER.email }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _fsEngineerOptions = (data.engineers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (e) {
    _fsEngineerOptions = [];
  }
  const sel = document.getElementById('fsFilterEngineer');
  if (sel) sel.innerHTML = '<option value="">All Engineers</option>' + _fsEngineerOptions.map(en => `<option value="${en.engineer_id}">${_fsEsc(en.name)}</option>`).join('');
}

async function _fsFetchClientOptions(){
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/field_service_entries?select=client_name`, { headers: SB_HDRS() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    _fsClientOptions = [...new Set(rows.map(r => r.client_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    _fsClientOptions = [];
  }
  const sel = document.getElementById('fsFilterClient');
  if (sel) sel.innerHTML = '<option value="">All Clients</option>' + _fsClientOptions.map(c => `<option value="${_fsEsc(c)}">${_fsEsc(c)}</option>`).join('');
}

function _fsEngineerName(engineerId){
  const found = (_fsEngineerOptions || []).find(en => en.engineer_id === engineerId);
  return found ? found.name : engineerId;
}

function _fsClearFilters(){
  const jt  = document.getElementById('fsFilterJobType');  if (jt)  jt.value  = '';
  const eng = document.getElementById('fsFilterEngineer'); if (eng) eng.value = '';
  const cl  = document.getElementById('fsFilterClient');   if (cl)  cl.value  = '';
  const f   = document.getElementById('fsFilterFrom');     if (f)   f.value   = '';
  const t   = document.getElementById('fsFilterTo');       if (t)   t.value   = '';
  _fsLoadEntries();
}

async function _fsLoadEntries(){
  const loadingEl = document.getElementById('fsEntriesLoading');
  const emptyEl   = document.getElementById('fsEntriesEmpty');
  const listEl    = document.getElementById('fsEntriesList');
  if (!loadingEl) return;
  loadingEl.style.display = 'block'; emptyEl.style.display = 'none'; listEl.style.display = 'none';
  try {
    let url = `${SUPABASE_URL}/rest/v1/field_service_entries?select=*,field_service_photos(*)&order=created_at.desc`;
    if (_fsCanViewAll()) {
      const jt   = document.getElementById('fsFilterJobType');
      const eng  = document.getElementById('fsFilterEngineer');
      const cl   = document.getElementById('fsFilterClient');
      const from = document.getElementById('fsFilterFrom');
      const to   = document.getElementById('fsFilterTo');
      if (jt && jt.value)     url += `&job_type=eq.${encodeURIComponent(jt.value)}`;
      if (eng && eng.value)   url += `&engineer_id=eq.${encodeURIComponent(eng.value)}`;
      if (cl && cl.value)     url += `&client_name=eq.${encodeURIComponent(cl.value)}`;
      if (from && from.value) url += `&created_at=gte.${from.value}T00:00:00`;
      if (to && to.value)     url += `&created_at=lte.${to.value}T23:59:59`;
    }
    const res = await fetch(url, { headers: SB_HDRS() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _fsEntries = await res.json();
    loadingEl.style.display = 'none';
    if (!_fsEntries.length) { emptyEl.style.display = 'block'; return; }
    listEl.style.display = 'block';
    _fsRenderEntriesList();
  } catch (e) {
    loadingEl.style.display = 'none';
    emptyEl.style.display   = 'block';
    emptyEl.textContent     = '⚠️ Could not load entries: ' + e.message;
  }
}

function _fsRenderEntriesList(){
  const el = document.getElementById('fsEntriesList');
  if (!el) return;
  const showEngineer = _fsCanViewAll();
  el.innerHTML = _fsEntries.map(e => {
    const cfg          = JOB_TYPE_CONFIG[e.job_type];
    const label         = cfg ? cfg.label : e.job_type;
    const dateStr       = e.created_at ? new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const photoCount   = (e.field_service_photos || []).length;
    const engineerName = showEngineer ? _fsEngineerName(e.engineer_id) : null;
    return `
      <div onclick="_fsOpenDetail('${e.id}')" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;transition:border-color 0.15s;"
        onmouseover="this.style.borderColor='var(--accent2)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="flex:1;min-width:180px;">
          <div style="font-weight:700;color:var(--text);font-size:0.92rem;">${_fsEsc(e.client_name)}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">📍 ${_fsEsc(e.location)} · 🗓️ ${dateStr}${engineerName ? ' · 👷 ' + _fsEsc(engineerName) : ''}</div>
        </div>
        <span style="font-size:0.72rem;font-weight:700;padding:4px 10px;border-radius:20px;background:rgba(0,212,170,0.12);color:var(--accent2);border:1px solid rgba(0,212,170,0.3);white-space:nowrap;">${_fsEsc(label)}</span>
        ${photoCount ? `<span style="font-size:0.75rem;color:var(--muted);">📷 ${photoCount}</span>` : ''}
      </div>`;
  }).join('');
}

// ── Detail modal (injected once, reused) ────────────────────────────────
function _fsEnsureDetailModal(){
  if (document.getElementById('fsDetailOverlay')) return;
  const div = document.createElement('div');
  div.id = 'fsDetailOverlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99000;align-items:center;justify-content:center;padding:20px;';
  div.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;position:relative;">
      <button onclick="_fsCloseDetail()" style="position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;border:none;background:var(--surface2);color:var(--muted);font-size:1rem;cursor:pointer;">✕</button>
      <div id="fsDetailBody"></div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', (e) => { if (e.target === div) _fsCloseDetail(); });
}

function _fsCloseDetail(){
  const el = document.getElementById('fsDetailOverlay');
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
}

function _fsOpenDetail(entryId){
  const e = _fsEntries.find(x => String(x.id) === String(entryId));
  if (!e) return;
  _fsEnsureDetailModal();

  const cfg     = JOB_TYPE_CONFIG[e.job_type];
  const label   = cfg ? cfg.label : e.job_type;
  const dateStr = e.created_at ? new Date(e.created_at).toLocaleString('en-IN') : '—';
  const details = e.details || {};

  const detailRows = (cfg && cfg.fields.length)
    ? cfg.fields.map(f => `<div style="color:var(--muted);font-weight:600;">${_fsEsc(f.label)}</div><div>${_fsEsc(details[f.key] || '—')}</div>`).join('')
    : '';

  const photos = e.field_service_photos || [];
  const photoGrid = photos.length ? `
    <div style="margin-top:16px;">
      <div style="font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">📷 Photos (${photos.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;">
        ${photos.map((p, i) => `<div onclick="_fsOpenLightbox('${e.id}',${i})" style="cursor:pointer;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border);">
          <img src="${_fsPublicPhotoUrl(p.storage_path)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
        </div>`).join('')}
      </div>
    </div>` : '';

  const engineerLine = _fsCanViewAll()
    ? `<div style="font-size:0.82rem;color:var(--muted);margin-bottom:16px;">👷 ${_fsEsc(_fsEngineerName(e.engineer_id))}</div>`
    : '';

  document.getElementById('fsDetailBody').innerHTML = `
    <div style="font-weight:800;font-size:1.1rem;color:var(--text);margin-bottom:4px;">${_fsEsc(e.client_name)}</div>
    <div style="font-size:0.82rem;color:var(--muted);margin-bottom:${_fsCanViewAll() ? '4px' : '16px'};">📍 ${_fsEsc(e.location)} · 🗓️ ${dateStr}</div>
    ${engineerLine}
    <span style="font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:20px;background:rgba(0,212,170,0.12);color:var(--accent2);border:1px solid rgba(0,212,170,0.3);">${_fsEsc(label)}</span>
    ${detailRows ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;font-size:0.85rem;margin-top:16px;">${detailRows}</div>` : ''}
    ${photoGrid}
  `;
  document.getElementById('fsDetailOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// ── Lightbox (bucket is public — plain <img src>, no blob fetching needed) ──
let _fsLightboxPhotos = [];
let _fsLightboxIndex  = 0;

function _fsEnsureLightbox(){
  if (document.getElementById('fsLightboxOverlay')) return;
  const div = document.createElement('div');
  div.id = 'fsLightboxOverlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99500;align-items:center;justify-content:center;flex-direction:column;';
  div.innerHTML = `
    <button onclick="_fsCloseLightbox()" style="position:absolute;top:18px;right:20px;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;">✕</button>
    <button onclick="_fsLightboxPrev()" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:1.4rem;width:44px;height:44px;border-radius:50%;cursor:pointer;">‹</button>
    <img id="fsLightboxImg" style="max-width:90vw;max-height:80vh;border-radius:8px;object-fit:contain;">
    <button onclick="_fsLightboxNext()" style="position:absolute;right:14px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:1.4rem;width:44px;height:44px;border-radius:50%;cursor:pointer;">›</button>
    <div id="fsLightboxCounter" style="color:#ccc;margin-top:14px;font-size:0.85rem;"></div>
  `;
  document.body.appendChild(div);
  div.addEventListener('click', (e) => { if (e.target === div) _fsCloseLightbox(); });
}

function _fsOpenLightbox(entryId, startIndex){
  const e = _fsEntries.find(x => String(x.id) === String(entryId));
  if (!e) return;
  _fsLightboxPhotos = (e.field_service_photos || []).map(p => _fsPublicPhotoUrl(p.storage_path));
  _fsLightboxIndex  = startIndex || 0;
  _fsEnsureLightbox();
  _fsShowLightboxImage();
  document.getElementById('fsLightboxOverlay').style.display = 'flex';
}

function _fsShowLightboxImage(){
  document.getElementById('fsLightboxImg').src = _fsLightboxPhotos[_fsLightboxIndex];
  document.getElementById('fsLightboxCounter').textContent = `${_fsLightboxIndex + 1} / ${_fsLightboxPhotos.length}`;
}

function _fsLightboxPrev(){
  if (_fsLightboxPhotos.length < 2) return;
  _fsLightboxIndex = (_fsLightboxIndex - 1 + _fsLightboxPhotos.length) % _fsLightboxPhotos.length;
  _fsShowLightboxImage();
}
function _fsLightboxNext(){
  if (_fsLightboxPhotos.length < 2) return;
  _fsLightboxIndex = (_fsLightboxIndex + 1) % _fsLightboxPhotos.length;
  _fsShowLightboxImage();
}
function _fsCloseLightbox(){
  const el = document.getElementById('fsLightboxOverlay');
  if (el) el.style.display = 'none';
}

document.addEventListener('keydown', function(e){
  const el = document.getElementById('fsLightboxOverlay');
  if (!el || el.style.display === 'none') return;
  if (e.key === 'ArrowLeft') _fsLightboxPrev();
  else if (e.key === 'ArrowRight') _fsLightboxNext();
  else if (e.key === 'Escape') _fsCloseLightbox();
});
