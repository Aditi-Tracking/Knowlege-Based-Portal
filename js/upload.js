// Section: Upload Modal (shared file/video upload utility for HR, Sales, After Sales, Marketing, Products, Training)
const UPLOAD_PASSWORD = 'aditi@upload2026'; // change as needed

let _uploadSection  = null;   // e.g. 'Sales'
let _uploadMode     = 'existing';  // 'existing' | 'new'
let _uploadFile     = null;   // File object
let _uploadCats     = [];     // content_node categories for this section

// ── Open modal ───────────────────────────────────────────────────────────
async function openUploadModal(sectionName) {
  // Role gate — only MIS can upload
  const _role = CURRENT_USER ? String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim() : '';
  if (_role !== 'mis') {
    alert('⛔ Upload access is restricted to MIS users only.');
    return;
  }
  _uploadSection = sectionName;
  _uploadFile    = null;
  _uploadFiles   = [];
  _uploadMode    = 'existing';
  _uploadType    = 'file';

  document.getElementById('uploadModalTitle').textContent = 'Upload to ' + sectionName;
  document.getElementById('uploadModalSub').textContent   = 'Choose a card then pick your file';
  document.getElementById('uploadStatus').style.display   = 'none';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadDropLabel').textContent  = 'Click to choose or drag & drop a file';
  document.getElementById('uploadDropMeta').textContent   = 'PDF, Video, Image, Doc — any format';
  document.getElementById('uploadFileName').value         = '';
  document.getElementById('uploadNewCardName').value      = '';
  document.getElementById('uploadProgressBar').style.width = '0%';
  document.getElementById('uploadSubmitBtn').disabled     = false;
  document.getElementById('uploadFileInput').value        = '';
  document.getElementById('uploadDropZone').style.borderColor = '';
  document.getElementById('uploadDropZone').style.background  = '';
  const mflReset = document.getElementById('multiFileList');
  if (mflReset) mflReset.style.display = 'none';
  const subW = document.getElementById('uploadSubCardWrap');
  if (subW) subW.style.display = 'none';

  setUploadMode('existing');
  document.getElementById('uploadModal').style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Load categories for this section
  await _loadUploadCats();
}

function closeUploadModal() {
  document.getElementById('uploadModal').style.display = 'none';
  document.body.style.overflow = '';
  _uploadFile = null;
}

// ── Load categories into the dropdown ────────────────────────────────────
async function _loadUploadCats() {
  const sel = document.getElementById('uploadCardSelect');
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    await CN.load();
    const section = CN.getSection(_uploadSection);
    if (!section) {
      // Section not in content_nodes yet — only allow new card
      _uploadCats = [];
      sel.innerHTML = '<option value="">No cards yet — create one</option>';
      return;
    }
    _uploadCats = CN.getCategories(section.id);
    sel.innerHTML = _uploadCats.length
      ? _uploadCats.map(c => `<option value="${c.id}">${c.name || c.Name}</option>`).join('')
      : '<option value="">No cards yet — create one below</option>';
    // Hide sub-card wrap initially, trigger check for first option
    document.getElementById('uploadSubCardWrap').style.display = 'none';
    if (_uploadCats.length) onUploadCardChange(_uploadCats[0].id);
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading cards</option>';
  }
}

// ── Called when user changes the card selection ───────────────────────────
function onUploadCardChange(parentId) {
  const subWrap   = document.getElementById('uploadSubCardWrap');
  const subSelect = document.getElementById('uploadSubCardSelect');
  if (!parentId || !CN.loaded) { subWrap.style.display = 'none'; return; }

  const subCats = CN.getCategories(parseInt(parentId));
  if (!subCats.length) {
    subWrap.style.display = 'none';
    return;
  }
  // Show sub-card dropdown
  subSelect.innerHTML =
    '<option value="__parent__">— Upload directly to parent card —</option>' +
    subCats.map(c => `<option value="${c.id}">${c.name || c.Name}</option>`).join('');
  subWrap.style.display = 'block';
}

// ── Toggle existing / new mode ────────────────────────────────────────────
function setUploadMode(mode) {
  _uploadMode = mode;
  const btnEx  = document.getElementById('uploadModeExisting');
  const btnNew = document.getElementById('uploadModeNew');
  const exWrap = document.getElementById('uploadExistingWrap');
  const newWrap= document.getElementById('uploadNewWrap');

  const activeStyle  = 'flex:1;padding:10px;border-radius:10px;border:1.5px solid rgba(0,212,170,0.5);background:rgba(0,212,170,0.1);color:#00d4aa;font-weight:700;font-size:0.84rem;cursor:pointer;font-family:inherit;';
  const inactiveStyle= 'flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:0.84rem;cursor:pointer;font-family:inherit;';

  if (mode === 'existing') {
    btnEx.style.cssText   = activeStyle;
    btnNew.style.cssText  = inactiveStyle;
    exWrap.style.display  = 'block';
    newWrap.style.display = 'none';
  } else {
    btnNew.style.cssText  = activeStyle;
    btnEx.style.cssText   = inactiveStyle;
    exWrap.style.display  = 'none';
    newWrap.style.display = 'block';
    // Reset to top-level card type by default
    _newCardType = 'top';
    setNewCardType('top');
    const csEl = document.getElementById('createCardStatus');
    if (csEl) csEl.style.display = 'none';
  }
}

// ── New Card: toggle top-level vs sub-card ────────────────────────────────
let _newCardType = 'top'; // 'top' or 'sub'

function setNewCardType(type) {
  _newCardType = type;
  const topBtn     = document.getElementById('cardTypeTopBtn');
  const subBtn     = document.getElementById('cardTypeSubBtn');
  const parentWrap = document.getElementById('newSubParentWrap');
  const nameLabel  = document.getElementById('newCardNameLabel');

  const active   = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid rgba(0,212,170,0.5);background:rgba(0,212,170,0.1);color:#00d4aa;font-weight:700;font-size:0.8rem;cursor:pointer;font-family:inherit;';
  const inactive = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:0.8rem;cursor:pointer;font-family:inherit;';
  const activeS  = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid rgba(167,139,250,0.5);background:rgba(167,139,250,0.1);color:#a78bfa;font-weight:700;font-size:0.8rem;cursor:pointer;font-family:inherit;';

  if (type === 'top') {
    topBtn.style.cssText = active;
    subBtn.style.cssText = inactive;
    parentWrap.style.display = 'none';
    nameLabel.textContent = 'New Card Name';
  } else {
    subBtn.style.cssText = activeS;
    topBtn.style.cssText = inactive;
    parentWrap.style.display = 'block';
    nameLabel.textContent = 'Sub-Card Name';
    // Populate parent dropdown with existing top-level cards
    _populateNewSubParent();
  }
}

async function _populateNewSubParent() {
  const sel = document.getElementById('newSubParentSelect');
  sel.innerHTML = '<option value="">Loading cards…</option>';
  try {
    await CN.load();
    const section = CN.getSection(_uploadSection);
    if (!section) { sel.innerHTML = '<option value="">No cards yet</option>'; return; }
    const cats = CN.getCategories(section.id);
    sel.innerHTML = cats.length
      ? cats.map(c => `<option value="${c.id}">${c.name || c.Name}</option>`).join('')
      : '<option value="">No cards yet in this section</option>';
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading</option>';
  }
}

// ── Create Card Only (no file upload) ────────────────────────────────────
async function createCardOnly() {
  const cardName = document.getElementById('uploadNewCardName').value.trim();
  const statusEl = document.getElementById('createCardStatus');
  const btn      = document.getElementById('createCardOnlyBtn');

  if (!cardName) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#f0a500';
    statusEl.style.background = 'rgba(240,165,0,0.1)';
    statusEl.style.border = '1px solid #f0a500';
    statusEl.textContent = '⚠️ Please enter a card name first.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Creating…';
  statusEl.style.display = 'none';

  const hdrs = {
    'apikey':        SUPABASE_ANON,
    'Authorization': `Bearer ${_currentToken}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  };

  try {
    await CN.load();
    let parentId = null;

    if (_newCardType === 'sub') {
      const selVal = document.getElementById('newSubParentSelect').value;
      if (!selVal) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#f0a500';
        statusEl.style.background = 'rgba(240,165,0,0.1)';
        statusEl.style.border = '1px solid #f0a500';
        statusEl.textContent = '⚠️ Please select a parent card.';
        btn.disabled = false;
        btn.textContent = '✨ Create Card Only (no file)';
        return;
      }
      parentId = parseInt(selVal);
    } else {
      // Top-level: parent is section
      let section = CN.getSection(_uploadSection);
      if (!section) {
        // Create section first
        const secRes = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
          method: 'POST', headers: hdrs,
          body: JSON.stringify({ name: _uploadSection, type: 'section', parent_id: null })
        });
        if (!secRes.ok) throw new Error('Section create failed: HTTP ' + secRes.status);
        const secData = await secRes.json();
        parentId = Array.isArray(secData) ? secData[0].id : secData.id;
      } else {
        parentId = section.id;
      }
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ name: cardName, type: 'category', parent_id: parentId })
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      throw new Error('HTTP ' + res.status + ' — ' + txt.slice(0,200));
    }

    // Success
    statusEl.style.display = 'block';
    statusEl.style.color = '#00d4aa';
    statusEl.style.background = 'rgba(0,212,170,0.1)';
    statusEl.style.border = '1px solid #00d4aa';
    const typeLabel = _newCardType === 'sub' ? 'Sub-card' : 'Card';
    statusEl.textContent = `✅ ${typeLabel} "${cardName}" created successfully!`;

    // Reset CN cache
    CN.loaded = false; CN.nodes = []; CN.files = [];
    hrSectionLoaded = false; afterSalesLoaded = false;
    salesDocsLoaded = false; marketingInitLoaded = false;
    prodLoaded = false; trainingDynLoaded = false; hrDocsCache = {};

    // Clear name, refresh parent dropdown if sub
    document.getElementById('uploadNewCardName').value = '';
    if (_newCardType === 'sub') await _populateNewSubParent();

    // Reload section after a moment
    setTimeout(() => {
      const panelMap = {
        'HR':          () => { hrSectionLoaded=false; loadHRSection(); },
        'Sales':       () => loadSalesDocs(true),
        'After Sales': () => { afterSalesLoaded=false; loadAfterSales(); },
        'Marketing':   () => { marketingInitLoaded=false; loadMarketingCounts(); },
        'Products':    () => { prodLoaded=false; loadProducts(); },
        'Training':    () => { trainingDynLoaded=false; loadTrainingSection(); },
      };
      if (panelMap[_uploadSection]) panelMap[_uploadSection]();
    }, 1200);

  } catch(e) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#ef4444';
    statusEl.style.background = 'rgba(239,68,68,0.1)';
    statusEl.style.border = '1px solid #ef4444';
    statusEl.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Create Card Only (no file)';
  }
}

// ── Upload type: 'file' or 'youtube' ────────────────────────────────────
let _uploadType = 'file';
let _uploadFiles = []; // Array for multiple file support

function setUploadType(type) {
  _uploadType = type;
  const fileBtn = document.getElementById('upTypeFileBtn');
  const ytBtn   = document.getElementById('upTypeYtBtn');
  const dropZ   = document.getElementById('uploadDropZone');
  const ytWrap  = document.getElementById('uploadYtWrap');
  const submitBtn = document.getElementById('uploadSubmitBtn');
  const active   = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid rgba(0,212,170,0.5);background:rgba(0,212,170,0.1);color:#00d4aa;font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;';
  const inactive = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;';
  const ytActive = 'flex:1;padding:9px;border-radius:10px;border:1.5px solid rgba(255,0,0,0.4);background:rgba(255,0,0,0.06);color:#ff4444;font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;';
  if (type === 'file') {
    fileBtn.style.cssText = active; ytBtn.style.cssText = inactive;
    dropZ.style.display = 'block'; ytWrap.style.display = 'none';
    submitBtn.textContent = 'Upload File';
  } else {
    ytBtn.style.cssText = ytActive; fileBtn.style.cssText = inactive;
    dropZ.style.display = 'none'; ytWrap.style.display = 'block';
    submitBtn.textContent = 'Save YouTube Link';
  }
}

function onYtUrlInput(val) {
  const preview = document.getElementById('uploadYtPreview');
  const thumb   = document.getElementById('uploadYtThumb');
  const nameEl  = document.getElementById('uploadFileName');
  const ytId = _extractYtId(val);
  if (ytId) {
    thumb.src = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    preview.style.display = 'block';
    if (!nameEl.value.trim()) nameEl.value = 'YouTube Video';
  } else {
    preview.style.display = 'none';
  }
}

function _extractYtId(url) {
  const m = (url||'').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── File selected (from input or drop) ───────────────────────────────────
function uploadFileSelected(filesOrFile) {
  // Accept FileList, File[], or single File
  let files = [];
  if (filesOrFile instanceof FileList || Array.isArray(filesOrFile)) {
    files = Array.from(filesOrFile);
  } else if (filesOrFile instanceof File) {
    files = [filesOrFile];
  }
  if (!files.length) return;
  _uploadFiles = files;
  _uploadFile  = files[0]; // backward compat

  const label = document.getElementById('uploadDropLabel');
  const meta  = document.getElementById('uploadDropMeta');

  if (files.length === 1) {
    label.textContent = '✅ ' + files[0].name;
    meta.textContent  = (files[0].size / 1024 / 1024).toFixed(2) + ' MB — ' + (files[0].type || 'unknown type');
    // Auto-fill display name
    const nameInput = document.getElementById('uploadFileName');
    if (!nameInput.value.trim()) {
      nameInput.value = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    }
    // Hide multi-file list if shown
    const mfl = document.getElementById('multiFileList');
    if (mfl) mfl.style.display = 'none';
  } else {
    label.textContent = `✅ ${files.length} files selected`;
    const totalMB = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
    meta.textContent  = `Total: ${totalMB.toFixed(2)} MB — Names will be auto-filled from filenames`;
    // Show file list
    let mfl = document.getElementById('multiFileList');
    if (!mfl) {
      mfl = document.createElement('div');
      mfl.id = 'multiFileList';
      mfl.style.cssText = 'margin-top:10px;max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;';
      document.getElementById('uploadDropZone').after(mfl);
    }
    mfl.style.display = 'flex';
    mfl.innerHTML = files.map((f, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);font-size:0.80rem;">
        <span style="color:var(--accent2);font-weight:700;min-width:20px;">${i+1}.</span>
        <span style="flex:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</span>
        <span style="color:var(--muted);flex-shrink:0;">${(f.size/1024/1024).toFixed(1)}MB</span>
      </div>`
    ).join('');
    // Clear display name field — multi mode uses auto-names
    document.getElementById('uploadFileName').value = '';
  }

  document.getElementById('uploadDropZone').style.borderColor = '#00d4aa';
  document.getElementById('uploadDropZone').style.background  = 'rgba(0,212,170,0.04)';
}

function uploadHandleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadDropZone').style.borderColor = '';
  document.getElementById('uploadDropZone').style.background  = '';
  const files = e.dataTransfer.files;
  if (files && files.length) uploadFileSelected(files);
}

// ── Set upload status message ─────────────────────────────────────────────
function _uploadSetStatus(msg, color) {
  const el = document.getElementById('uploadStatus');
  el.style.display    = 'block';
  el.style.color      = color || 'var(--text)';
  el.style.background = color ? (color === '#ef4444' ? 'rgba(239,68,68,0.1)' : 'rgba(0,212,170,0.1)') : 'var(--surface2)';
  el.style.border     = '1px solid ' + (color || 'var(--border)');
  el.textContent      = msg;
}

function _uploadSetProgress(pct, label) {
  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadProgressBar').style.width = pct + '%';
  document.getElementById('uploadProgressLabel').textContent = label || 'Uploading…';
}

// ── Main submit ───────────────────────────────────────────────────────────
async function submitUpload() {
  const submitBtn   = document.getElementById('uploadSubmitBtn');
  const displayName = document.getElementById('uploadFileName').value.trim();
  const newCardName = document.getElementById('uploadNewCardName').value.trim();

  // DOM se check karo — YouTube wrap visible hai toh YouTube mode hai
  const ytWrap = document.getElementById('uploadYtWrap');
  const isYoutubeMode = ytWrap && ytWrap.style.display !== 'none';

  // YouTube mode validation
  if (isYoutubeMode) {
    const ytUrl = document.getElementById('uploadYtUrl').value.trim();
    const ytId  = _extractYtId(ytUrl);
    if (!ytId)        { _uploadSetStatus('⚠️ Please enter a valid YouTube link.', '#f0a500'); return; }
    if (!displayName) { _uploadSetStatus('⚠️ Please enter a display name.', '#f0a500'); return; }
    if (_uploadMode === 'new' && !newCardName) { _uploadSetStatus('⚠️ Please enter a card name.', '#f0a500'); return; }
    submitBtn.disabled = true;
    document.getElementById('uploadStatus').style.display = 'none';
    await _submitYoutubeLink(ytUrl, displayName, newCardName, submitBtn);
    return;
  }

  // File mode validation
  const filesToUpload = (_uploadFiles && _uploadFiles.length) ? _uploadFiles : (_uploadFile ? [_uploadFile] : []);
  if (!filesToUpload.length) { _uploadSetStatus('⚠️ Please select a file first.', '#f0a500'); return; }
  const isMulti = filesToUpload.length > 1;
  if (!isMulti && !displayName) { _uploadSetStatus('⚠️ Please enter a display name for the file.', '#f0a500'); return; }
  if (_uploadMode === 'new' && !newCardName) { _uploadSetStatus('⚠️ Please enter a card name.', '#f0a500'); return; }

  submitBtn.disabled = true;
  document.getElementById('uploadStatus').style.display = 'none';

  const hdrs = SB_HDRS();

  try {
    // ── Step 1: Resolve or create target node ─────────────────────────
    let nodeId = null;

    if (_uploadMode === 'new') {
      _uploadSetProgress(10, 'Creating new card…');
      await CN.load();
      let parentId = null;

      if (_newCardType === 'sub') {
        const selVal = document.getElementById('newSubParentSelect').value;
        if (!selVal) { _uploadSetStatus('⚠️ Please select a parent card for the sub-card.', '#f0a500'); submitBtn.disabled=false; return; }
        parentId = parseInt(selVal);
      } else {
        const section = CN.getSection(_uploadSection);
        if (!section) {
          _uploadSetProgress(15, 'Creating section…');
          const secRes = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
            method: 'POST',
            headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify({ name: _uploadSection, type: 'section', parent_id: null })
          });
          if (!secRes.ok) {
            const e401 = secRes.status === 401 || secRes.status === 403;
            throw new Error(e401
              ? 'Permission denied (HTTP ' + secRes.status + '). Run this in Supabase SQL Editor:\nCREATE POLICY "allow_anon_insert" ON "content_nodes" FOR INSERT TO anon WITH CHECK (true);'
              : 'Section create: HTTP ' + secRes.status);
          }
          const secData = await secRes.json();
          parentId = Array.isArray(secData) ? secData[0].id : secData.id;
        } else {
          parentId = section.id;
        }
      }

      const catRes = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ name: newCardName, type: 'category', parent_id: parentId })
      });
      if (!catRes.ok) {
        const e401 = catRes.status === 401 || catRes.status === 403;
        throw new Error(e401
          ? 'Permission denied (HTTP ' + catRes.status + '). In Supabase SQL Editor run:\nCREATE POLICY "allow_anon_insert" ON "content_nodes" FOR INSERT TO anon WITH CHECK (true);'
          : 'Card create: HTTP ' + catRes.status);
      }
      const catData = await catRes.json();
      nodeId = Array.isArray(catData) ? catData[0].id : catData.id;

    } else {
      const mainCardId = parseInt(document.getElementById('uploadCardSelect').value);
      if (!mainCardId) { _uploadSetStatus('⚠️ Please select a card.', '#f0a500'); submitBtn.disabled=false; return; }
      const subWrap   = document.getElementById('uploadSubCardWrap');
      const subVal    = document.getElementById('uploadSubCardSelect').value;
      const useSubCard = subWrap.style.display !== 'none' && subVal && subVal !== '__parent__';
      nodeId = useSubCard ? parseInt(subVal) : mainCardId;
      if (!nodeId) { _uploadSetStatus('⚠️ Please select a valid card.', '#f0a500'); submitBtn.disabled=false; return; }
    }

    // ── Step 2: Upload all files one by one ────────────────────────────
    let successCount = 0;
    for (let fi = 0; fi < filesToUpload.length; fi++) {
      const currentFile = filesToUpload[fi];
      const fileDisplayName = isMulti
        ? currentFile.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
        : displayName;

      _uploadSetProgress(
        Math.round(((fi) / filesToUpload.length) * 80) + 10,
        isMulti ? `Uploading file ${fi+1} of ${filesToUpload.length}: ${currentFile.name}` : 'Uploading file…'
      );

      const ts       = Date.now();
      const safeName = currentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path     = `${_uploadSection.replace(/\s+/g,'_')}/${nodeId}/${ts}_${safeName}`;
      const storageUrl = `${SUPABASE_URL}/storage/v1/object/files/${encodeURIComponent(path)}`;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', storageUrl);
        xhr.setRequestHeader('apikey', SUPABASE_ANON);
        xhr.setRequestHeader('Authorization', `Bearer ${_currentToken}`);
        xhr.setRequestHeader('Content-Type', currentFile.type || 'application/octet-stream');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const base = Math.round(((fi) / filesToUpload.length) * 80) + 10;
            const chunk = Math.round((ev.loaded / ev.total) * (80 / filesToUpload.length));
            _uploadSetProgress(base + chunk,
              isMulti ? `Uploading ${fi+1}/${filesToUpload.length}: ${Math.round(ev.loaded/1024)}KB / ${Math.round(ev.total/1024)}KB` :
              `Uploading… ${Math.round(ev.loaded/1024)}KB / ${Math.round(ev.total/1024)}KB`
            );
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('Storage upload: HTTP ' + xhr.status + ' — ' + xhr.responseText.slice(0,200)));
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(currentFile);
      });

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/files/${path}`;
      const _ext2 = (currentFile.name.split('.').pop() || '').toLowerCase();
      const _fileType2 = (
        ['pdf'].includes(_ext2)                                  ? 'pdf'   :
        ['jpg','jpeg','png','gif','webp','svg'].includes(_ext2)  ? 'image' :
        ['mp4','webm','mov','avi','mkv'].includes(_ext2)         ? 'video' :
        ['mp3','wav','aac','ogg'].includes(_ext2)                ? 'audio' :
        ['doc','docx','xls','xlsx','ppt','pptx'].includes(_ext2) ? 'doc'   :
        'file'
      );

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/files`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ node_id: nodeId, name: fileDisplayName, file_type: _fileType2, file_url: publicUrl })
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text().catch(() => '');
        throw new Error('DB insert: HTTP ' + insertRes.status + ' — ' + errText.slice(0, 300));
      }
      successCount++;
    }

    // ── Step 3: Success ────────────────────────────────────────────────
    _uploadSetProgress(100, 'Done!');
    _uploadSetStatus(
      isMulti ? `✅ ${successCount} files uploaded successfully!` : '✅ File uploaded successfully!',
      '#00d4aa'
    );

    // ── Step 4: Refresh caches and reload ────────────────────────────
    CN.loaded  = false;
    CN.nodes   = [];
    CN.files   = [];

    // Reset section loaders so they re-fetch
    hrSectionLoaded       = false;
    afterSalesLoaded     = false;
    salesDocsLoaded      = false;
    marketingInitLoaded  = false;
    prodLoaded = false; trainingDynLoaded = false;
    hrDocsCache          = {};

    // Auto-close and reload after 1.5s
    setTimeout(() => {
      closeUploadModal();
      // Re-trigger the current section
      const panelMap = {
        'HR':          () => { hrSectionLoaded=false; loadHRSection(); },
        'Sales':       () => loadSalesDocs(true),
        'After Sales': () => { afterSalesLoaded=false; loadAfterSales(); },
        'Marketing':   () => { marketingInitLoaded=false; loadMarketingCounts(); },
        'Products':    () => { prodLoaded=false; loadProducts(); },
        'Training':    () => { trainingDynLoaded=false; loadTrainingSection(); },
      };
      if (panelMap[_uploadSection]) panelMap[_uploadSection]();
    }, 1600);

  } catch(e) {
    _uploadSetStatus('❌ ' + e.message, '#ef4444');
    submitBtn.disabled = false;
  }
}
// ═══════════════════════════════════════════════════════════════════════════

// ── YouTube Link Save (no file upload — directly saves URL to DB) ─────────
async function _submitYoutubeLink(ytUrl, displayName, newCardName, submitBtn) {
  const hdrs = SB_HDRS();
  try {
    _uploadSetProgress(20, 'Resolving card…');

    // Step 1: Get or create node
    let nodeId = null;
    await CN.load();

    if (_uploadMode === 'new') {
      let parentId = null;
      if (_newCardType === 'sub') {
        parentId = parseInt(document.getElementById('newSubParentSelect').value);
        if (!parentId) { _uploadSetStatus('⚠️ Please select a parent card.', '#f0a500'); submitBtn.disabled=false; return; }
      } else {
        let section = CN.getSection(_uploadSection);
        if (!section) {
          const sr = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
            method:'POST', headers:{...hdrs,'Content-Type':'application/json','Prefer':'return=representation'},
            body: JSON.stringify({name:_uploadSection, type:'section', parent_id:null})
          });
          const sd = await sr.json(); parentId = Array.isArray(sd)?sd[0].id:sd.id;
        } else { parentId = section.id; }
      }
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes`, {
        method:'POST', headers:{...hdrs,'Content-Type':'application/json','Prefer':'return=representation'},
        body: JSON.stringify({name:newCardName, type:'category', parent_id:parentId})
      });
      const cd = await cr.json(); nodeId = Array.isArray(cd)?cd[0].id:cd.id;
    } else {
      const mainCardId = parseInt(document.getElementById('uploadCardSelect').value);
      if (!mainCardId) { _uploadSetStatus('⚠️ Please select a card.', '#f0a500'); submitBtn.disabled=false; return; }
      const subWrap = document.getElementById('uploadSubCardWrap');
      const subVal  = document.getElementById('uploadSubCardSelect').value;
      const useSubCard = subWrap.style.display !== 'none' && subVal && subVal !== '__parent__';
      nodeId = useSubCard ? parseInt(subVal) : mainCardId;
    }

    _uploadSetProgress(70, 'Saving link…');

    // Step 2: Insert YouTube URL directly into files table
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/files`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ node_id: nodeId, name: displayName, file_type: 'video', file_url: ytUrl })
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(()=>'');
      throw new Error('DB insert: HTTP ' + insertRes.status + ' — ' + errText.slice(0,200));
    }

    _uploadSetProgress(100, 'Done!');
    _uploadSetStatus('✅ YouTube link saved successfully!', '#00d4aa');

    CN.loaded=false; CN.nodes=[]; CN.files=[];
    hrSectionLoaded=false; afterSalesLoaded=false; salesDocsLoaded=false;
    marketingInitLoaded=false; prodLoaded=false; trainingDynLoaded=false; hrDocsCache={};

    setTimeout(() => {
      closeUploadModal();
      const panelMap = {
        'HR':          () => { hrSectionLoaded=false; loadHRSection(); },
        'Sales':       () => loadSalesDocs(true),
        'After Sales': () => { afterSalesLoaded=false; loadAfterSales(); },
        'Marketing':   () => { marketingInitLoaded=false; loadMarketingCounts(); },
        'Products':    () => { prodLoaded=false; loadProducts(); },
        'Training':    () => { trainingDynLoaded=false; loadTrainingSection(); },
      };
      if (panelMap[_uploadSection]) panelMap[_uploadSection]();
    }, 1400);

  } catch(e) {
    _uploadSetStatus('❌ ' + e.message, '#ef4444');
    submitBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// DELETE SYSTEM — Cards (content_nodes) and Files (files table + storage)
// ═══════════════════════════════════════════════════════════════════════════

async function confirmDeleteCard(nodeId, cardName) {
  const _role = CURRENT_USER ? String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim() : '';
  if (_role !== 'mis') { alert('⛔ Delete access is restricted to MIS users only.'); return; }
  if (!confirm(`⚠️ "${cardName}" and all its files will be permanently deleted.\nAre you sure?`)) return;
  await _doDeleteCard(nodeId, cardName);
}

async function _doDeleteCard(nodeId, cardName) {
  const hdrs = SB_HDRS();

  // ── Helper: delete files (storage + DB) for a single node ──────────────
  async function _deleteFilesOfNode(nid) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/files?node_id=eq.${nid}`, { headers: hdrs });
    const files = r.ok ? await r.json() : [];
    for (const f of files) {
      const fileUrl = f.file_url || f.url || f.link || '';
      if (fileUrl.includes('/storage/v1/object/public/files/')) {
        const path = fileUrl.split('/storage/v1/object/public/files/')[1];
        if (path) {
          await fetch(`${SUPABASE_URL}/storage/v1/object/files/${encodeURIComponent(path)}`, {
            method: 'DELETE',
            headers: SB_HDRS()
          }).catch(() => {});
        }
      }
    }
    if (files.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/files?node_id=eq.${nid}`, {
        method: 'DELETE', headers: hdrs
      }).catch(() => {});
    }
  }

  // ── Helper: recursively collect all descendant node IDs (BFS) ──────────
  async function _collectDescendants(rootId) {
    const allIds = [];
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift();
      // find children
      const cr = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes?parent_id=eq.${cur}&select=id`, { headers: hdrs });
      const children = cr.ok ? await cr.json() : [];
      for (const c of children) {
        allIds.push(c.id);
        queue.push(c.id);
      }
    }
    return allIds; // deepest first to be safe
  }

  try {
    // 1. Find all descendant nodes (sub-cards, sub-sub-cards...)
    const descendants = await _collectDescendants(nodeId);
    // Delete deepest first
    const deleteOrder = [...descendants].reverse();

    // 2. Delete files + node records for all descendants
    for (const did of deleteOrder) {
      await _deleteFilesOfNode(did);
      const dr = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes?id=eq.${did}`, {
        method: 'DELETE', headers: hdrs
      });
      if (!dr.ok) {
        const errTxt = await dr.text().catch(() => '');
        // Check for RLS / permission error
        if (dr.status === 401 || dr.status === 403 || errTxt.toLowerCase().includes('policy')) {
          alert(`❌ Permission denied when deleting sub-card (HTTP ${dr.status}).\n\nFix in Supabase SQL Editor:\nCREATE POLICY "allow_anon_delete" ON "content_nodes" FOR DELETE TO anon USING (true);\nCREATE POLICY "allow_anon_delete_files" ON "files" FOR DELETE TO anon USING (true);`);
          return;
        }
      }
    }

    // 3. Delete files + node record for the root card itself
    await _deleteFilesOfNode(nodeId);

    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/content_nodes?id=eq.${nodeId}`, {
      method: 'DELETE', headers: hdrs
    });

    if (!delRes.ok) {
      const err = await delRes.text().catch(() => '');
      if (delRes.status === 401 || delRes.status === 403 || err.toLowerCase().includes('policy')) {
        alert(`❌ Permission denied (HTTP ${delRes.status}).\n\nYou need to enable DELETE policy in Supabase.\nGo to Supabase → SQL Editor and run:\n\nCREATE POLICY "allow_anon_delete" ON "content_nodes" FOR DELETE TO anon USING (true);\nCREATE POLICY "allow_anon_delete_files" ON "files" FOR DELETE TO anon USING (true);`);
      } else {
        alert(`❌ Delete failed (HTTP ${delRes.status}):\n${err.slice(0, 300)}`);
      }
      return;
    }

    // 4. Refresh caches
    CN.loaded = false; CN.nodes = []; CN.files = [];
    hrSectionLoaded = false;
    afterSalesLoaded = false;
    salesDocsLoaded = false;
    marketingInitLoaded = false;
    prodLoaded = false;
    trainingDynLoaded = false;
    hrDocsCache = {};

    // 5. Close any open overlay
    ['hrDocsOverlay','salesDocsOverlay','afterSalesOverlay','marketingOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') { el.style.display = 'none'; document.body.style.overflow = ''; }
    });

    // 6. Re-render current active section
    const activePanel = document.querySelector('.dashboard-panel.active');
    const panelId = activePanel ? activePanel.id : '';
    if      (panelId === 'panel-hr')         loadHRSection();
    else if (panelId === 'panel-sales')      loadSalesDocs(true);
    else if (panelId === 'panel-aftersales') { afterSalesLoaded=false; loadAfterSales(); }
    else if (panelId === 'panel-marketing')  { marketingInitLoaded=false; loadMarketingCounts(); }
    else if (panelId === 'panel-products')   { prodLoaded=false; loadProducts(); }
    else if (panelId === 'panel-training')   { trainingDynLoaded=false; loadTrainingSection(); }

    alert(`✅ "${cardName}" and all its files have been deleted!`);

  } catch(e) {
    alert('❌ Error: ' + e.message);
  }
}

async function confirmDeleteFile(fileId, fileUrl) {
  const _role = CURRENT_USER ? String(CURRENT_USER.rawRole || CURRENT_USER.role || '').toLowerCase().trim() : '';
  if (_role !== 'mis') { alert('⛔ Delete access is restricted to MIS users only.'); return; }
  if (!confirm('⚠️ This file will be permanently deleted. Are you sure?')) return;
  await _doDeleteFile(fileId, fileUrl);
}

async function _doDeleteFile(fileId, fileUrl) {
  const hdrs = SB_HDRS();
  try {
    // 1. Delete from storage
    if (fileUrl && fileUrl.includes('/storage/v1/object/public/')) {
      const path = fileUrl.split('/storage/v1/object/public/files/')[1];
      if (path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/files/${path}`, {
          method: 'DELETE',
          headers: SB_HDRS()
        }).catch(() => {});
      }
    }

    // 2. Delete from files table
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/files?id=eq.${fileId}`, {
      method: 'DELETE',
      headers: hdrs
    });
    if (!delRes.ok) {
      const err = await delRes.text().catch(() => '');
      alert('Delete failed: ' + err.slice(0, 200));
      return;
    }

    // 3. Refresh CN cache
    CN.loaded = false; CN.nodes = []; CN.files = [];
    hrDocsCache = {};
    hrSectionLoaded = false;
    afterSalesLoaded = false;
    salesDocsLoaded = false;
    marketingInitLoaded = false;
    prodLoaded = false;
    trainingDynLoaded = false;

    // 4. Remove card from DOM immediately
    const card = document.querySelector(`[data-file-id="${fileId}"]`);
    if (card) card.remove();

    // 5. Close overlay and reload section
    ['hrDocsOverlay','salesDocsOverlay','afterSalesOverlay','marketingOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') { el.style.display = 'none'; document.body.style.overflow = ''; }
    });

    const activePanel = document.querySelector('.dashboard-panel.active');
    const panelId = activePanel ? activePanel.id : '';
    if (panelId === 'panel-hr')         loadHRSection();
    else if (panelId === 'panel-sales') loadSalesDocs(true);
    else if (panelId === 'panel-aftersales') { afterSalesLoaded=false; loadAfterSales(); }
    else if (panelId === 'panel-marketing')  { marketingInitLoaded=false; loadMarketingCounts(); }
    else if (panelId === 'panel-products')   { prodLoaded=false; loadProducts(); }

    alert('✅ File deleted successfully.');
  } catch(e) {
    alert('Error: ' + e.message);
  }
}
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL DELETE BUTTON INJECTOR
// Finds all [data-cn-name] cards in a container and adds delete buttons
// by looking up matching content_nodes entries.
// ═══════════════════════════════════════════════════════════════════════════
const DEL_BTN_HTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
  <path d="M10 11v6M14 11v6"/>
  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
</svg>`;

async function injectDeleteBtns(sectionName, containerEl) {
  if (!containerEl) return;
  if (!_isMIS()) return; // Only MIS can delete
  try {
    await CN.load();
    const section = CN.getSection(sectionName);
    if (!section) return;
    // Search direct children AND one level deeper (for Training sub-sections etc.)
    const cats = [
      ...CN.getCategories(section.id),
      ...CN.getCategories(section.id).flatMap(c => CN.getCategories(c.id))
    ];

    containerEl.querySelectorAll('[data-cn-name]').forEach(outerCard => {
      if (outerCard.querySelector('.cn-del-btn')) return;
      const cnName = outerCard.getAttribute('data-cn-name');
      const node   = cats.find(c => (c.name||'').trim().toLowerCase() === cnName.trim().toLowerCase());
      if (!node) return;

      // Inject INTO the inner .home-card so it works even when outer has display:flex
      const target = outerCard.querySelector('.home-card') || outerCard;
      if (target.querySelector('.cn-del-btn')) return;
      target.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'cn-del-btn';
      btn.title     = 'Delete ' + cnName;
      btn.innerHTML = DEL_BTN_HTML;
      btn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:10;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.18s;';
      btn.onmouseover = () => btn.style.background = 'rgba(239,68,68,0.28)';
      btn.onmouseout  = () => btn.style.background = 'rgba(239,68,68,0.12)';
      btn.onclick     = (e) => { e.stopPropagation(); e.preventDefault(); confirmDeleteCard(node.id, cnName); };
      target.appendChild(btn);
    });
  } catch(e) { }
}
