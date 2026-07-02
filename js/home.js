// Section: Home Dashboard (holiday card, MIS videos, file viewer, portal update posts)
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

function startQuiz(moduleKey) {
  currentQuizModule = MIS_QUIZ_MODULES[moduleKey];
  currentQuestionIndex = 0;
  userAnswers = [];
  document.getElementById('mis-quiz-menu').style.display = 'none';
  document.getElementById('mis-quiz-question-screen').style.display = 'block';
  document.getElementById('mis-quiz-result-screen').style.display = 'none';
  renderQuestion();
}

function renderQuestion() {
  const mod = currentQuizModule;
  const q = mod.questions[currentQuestionIndex];
  const total = mod.questions.length;
  const screen = document.getElementById('mis-quiz-question-screen');
  screen.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
      <button onclick="document.getElementById('mis-quiz-menu').style.display='block';document.getElementById('mis-quiz-question-screen').style.display='none';" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.26rem;padding:0;">←</button>
      <div>
        <div style="font-weight:700;font-size:1rem;color:var(--text);">${mod.icon} ${mod.title}</div>
        <div style="font-size:0.82rem;color:var(--muted);">${mod.subtitle}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <span style="font-size:0.88rem;color:var(--muted);">Question ${currentQuestionIndex+1} of ${total}</span>
      <span style="font-size:0.88rem;font-weight:700;color:${mod.color};">${Math.round(((currentQuestionIndex)/total)*100)}% done</span>
    </div>
    <div style="background:var(--border);border-radius:4px;height:5px;margin-bottom:20px;">
      <div style="background:${mod.color};height:5px;border-radius:4px;width:${((currentQuestionIndex)/total)*100}%;transition:width 0.3s;"></div>
    </div>
    <div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:20px;line-height:1.5;">${q.q}</div>
    <div style="display:flex;flex-direction:column;gap:10px;" id="quiz-options">
      ${q.opts.map((opt,i)=>`
        <button onclick="selectAnswer(${i})" id="opt-btn-${i}" style="text-align:left;padding:12px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:0.97rem;transition:all 0.18s;font-family:inherit;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--border);font-weight:700;font-size:0.82rem;margin-right:10px;">${['A','B','C','D'][i]}</span>
          ${opt}
        </button>
      `).join('')}
    </div>
    <div id="quiz-next-area" style="margin-top:18px;display:none;">
      <button onclick="nextQuestion()" style="width:100%;padding:12px;border-radius:10px;border:none;background:${mod.color};color:#fff;font-weight:700;font-size:1.03rem;cursor:pointer;font-family:inherit;">
        ${currentQuestionIndex < total-1 ? 'Next Question →' : 'Submit Quiz 🎯'}
      </button>
    </div>
  `;
}

function selectAnswer(selectedIndex) {
  const mod = currentQuizModule;
  const q = mod.questions[currentQuestionIndex];
  const isCorrect = selectedIndex === q.ans;
  userAnswers[currentQuestionIndex] = selectedIndex;

  // Disable all buttons and show correct/wrong
  const opts = document.querySelectorAll('[id^="opt-btn-"]');
  opts.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.ans) {
      btn.style.background = 'rgba(34,197,94,0.15)';
      btn.style.borderColor = '#22c55e';
      btn.style.color = '#22c55e';
    } else if (i === selectedIndex && !isCorrect) {
      btn.style.background = 'rgba(239,68,68,0.15)';
      btn.style.borderColor = '#ef4444';
      btn.style.color = '#ef4444';
    }
  });
  document.getElementById('quiz-next-area').style.display = 'block';
}

function nextQuestion() {
  currentQuestionIndex++;
  if (currentQuestionIndex < currentQuizModule.questions.length) {
    renderQuestion();
  } else {
    showResult();
  }
}

function showResult() {
  const mod = currentQuizModule;
  const total = mod.questions.length;
  let score = 0;
  userAnswers.forEach((ans, i) => { if (ans === mod.questions[i].ans) score++; });
  const pct = Math.round((score/total)*100);
  let emoji = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '📚';
  let msg = pct >= 80 ? 'Excellent Work!' : pct >= 60 ? 'Good Job!' : 'Keep Learning!';
  let msgColor = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f0a500' : '#ef4444';

  document.getElementById('mis-quiz-question-screen').style.display = 'none';
  const result = document.getElementById('mis-quiz-result-screen');
  result.style.display = 'block';
  result.innerHTML = `
    <div style="text-align:center;padding:10px 0;">
      <div style="font-size:3.5rem;margin-bottom:10px;">${emoji}</div>
      <div style="font-size:1.36rem;font-weight:800;color:${msgColor};margin-bottom:4px;">${msg}</div>
      <div style="font-size:0.91rem;color:var(--muted);margin-bottom:24px;">${mod.icon} ${mod.title}</div>
      <div style="display:inline-flex;align-items:center;justify-content:center;width:110px;height:110px;border-radius:50%;border:6px solid ${msgColor};margin:0 auto 20px;">
        <div>
          <div style="font-size:1.8rem;font-weight:900;color:${msgColor};">${score}/${total}</div>
          <div style="font-size:0.85rem;color:var(--muted);">${pct}%</div>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:18px;max-height:220px;overflow-y:auto;">
        <div style="font-size:0.88rem;font-weight:700;color:var(--text);margin-bottom:10px;text-align:left;">Review Answers</div>
        ${mod.questions.map((q,i)=>`
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;text-align:left;">
            <span style="font-size:0.94rem;">${userAnswers[i]===q.ans?'✅':'❌'}</span>
            <div>
              <div style="font-size:0.85rem;color:var(--text);font-weight:600;">Q${i+1}: ${q.q}</div>
              <div style="font-size:0.82rem;color:${userAnswers[i]===q.ans?'#22c55e':'#ef4444'};">Your answer: ${q.opts[userAnswers[i]]}</div>
              ${userAnswers[i]!==q.ans?`<div style="font-size:0.82rem;color:#22c55e;">Correct: ${q.opts[q.ans]}</div>`:''}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <button onclick="startQuiz('${Object.keys(MIS_QUIZ_MODULES).find(k=>MIS_QUIZ_MODULES[k].title===mod.title)}')" style="flex:1;min-width:120px;padding:10px 16px;border-radius:10px;border:1.5px solid ${mod.color};background:transparent;color:${mod.color};font-weight:700;font-size:0.94rem;cursor:pointer;font-family:inherit;">🔄 Retry</button>
        <button onclick="document.getElementById('mis-quiz-menu').style.display='block';document.getElementById('mis-quiz-result-screen').style.display='none';" style="flex:1;min-width:120px;padding:10px 16px;border-radius:10px;border:none;background:${mod.color};color:#fff;font-weight:700;font-size:0.94rem;cursor:pointer;font-family:inherit;">← Other Quizzes</button>
        <a href="${mod.driveUrl}" target="_blank" style="flex:1;min-width:120px;text-decoration:none;"><button style="width:100%;padding:10px 16px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:0.91rem;cursor:pointer;font-family:inherit;">📁 Open Drive</button></a>
      </div>
    </div>
  `;
}



// ============================================================


/* ────────────────────────────────────────────────────────────
   FILE VIEWER — opens Google Drive folders/files inside portal
   ──────────────────────────────────────────────────────────── */

// Convert any Google Drive URL to its embeddable form
function toDriveEmbedUrl(url){
  if(!url) return url;
  try{
    // 1) Folder URL:  /drive/folders/FOLDER_ID  →  embeddedfolderview
    var folderMatch = url.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
    if(folderMatch){
      return 'https://drive.google.com/embeddedfolderview?id=' + folderMatch[1] + '#grid';
    }
    // 2) File URL:  /file/d/FILE_ID/...  →  /preview
    var fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if(fileMatch){
      return 'https://drive.google.com/file/d/' + fileMatch[1] + '/preview';
    }
    // 3) Google Docs / Sheets / Slides  →  /preview
    var docMatch = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
    if(docMatch){
      return 'https://docs.google.com/' + docMatch[1] + '/d/' + docMatch[2] + '/preview';
    }
    // 4) open?id=ID  →  file preview
    var openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if(openMatch && url.indexOf('drive.google.com')>=0){
      return 'https://drive.google.com/file/d/' + openMatch[1] + '/preview';
    }
  }catch(e){}
  return url; // fallback: raw URL
}

// Detect direct video file from URL
function isDirectVideoUrl(url){
  if(!url) return false;
  var ext = url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  return ['mp4','webm','mov','m4v','ogg','ogv'].indexOf(ext) >= 0;
}

// Open any URL inside the in-page viewer modal

// ═══════════════════════════════════════════════════════════
// DIRECTORY DOC — Seedha Supabase se link fetch karke open karo
// ═══════════════════════════════════════════════════════════
async function openDirectoryDoc(module, displayName) {
  closeDirectoryOverlay();
  try {
    await CN.load();
    const hrSection = CN.getSection('HR');
    let fileData = null;
    if (hrSection) {
      const cats = CN.getCategories(hrSection.id);
      const dirCat = cats.find(c => (c.name||'').toLowerCase().includes('director'));
      if (dirCat) {
        const subCats = CN.getCategories(dirCat.id);
        const match = subCats.find(c => (c.name||'').toLowerCase().includes(module.trim().toLowerCase()));
        if (match) {
          const files = CN.getFiles(match.id);
          if (files.length) fileData = files[0];
        }
        // Also try direct files of directory node
        if (!fileData) {
          const direct = CN.getFiles(dirCat.id);
          if (direct.length) fileData = direct[0];
        }
      }
    }
    if (fileData && fileData.url) {
      openFileViewer(fileData.url, fileData.name || displayName || 'Document');
    } else {
      alert('No file found for ' + (displayName || module) + '. Please add files in the files table.');
    }
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

function openFileViewer(url, title){
  if(!url) return;

  // Track file/video open
  const _isYT  = /(?:youtube\.com|youtu\.be)/i.test(url);
  const _isVid = /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const _isPdf = /\.pdf(\?|$)/i.test(url);
  const _evType = _isYT || _isVid ? 'video_play' : 'file_open';
  logActivity({
    event_type:   _evType,
    event_detail: (_isYT ? 'YouTube: ' : _isVid ? 'Video: ' : _isPdf ? 'PDF: ' : 'File: ') + (title||url),
    page_name:    _actPageName || 'unknown',
    card_name:    _actCardName || '',
    video_title:  (_isYT || _isVid) ? (title||url) : null,
    file_name:    (!_isYT && !_isVid) ? (title||url) : null,
  });

  // YouTube link → seedha new tab mein kholo (iframe mein nahi chalega)
  if(_isYT) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  var ov = document.getElementById('file-viewer-overlay');
  if(!ov) return;

  document.getElementById('file-viewer-title').textContent = title || 'Documents';

  var body    = document.getElementById('file-viewer-body');
  var frame   = document.getElementById('file-viewer-frame');
  var loading = document.getElementById('file-viewer-loading');
  var mask    = document.getElementById('file-viewer-dl-mask');
  var mask2   = document.getElementById('file-viewer-dl-mask2');

  // If it's a direct video file, render a <video> tag instead of iframe
  if(isDirectVideoUrl(url)){
    frame.src = 'about:blank';
    frame.style.display = 'none';
    loading.style.display = 'none';
    if(mask)  mask.style.display  = 'none';
    if(mask2) mask2.style.display = 'none';
    // Training video jaisa exact approach — static HTML element, direct src set, sirf load()
    var vid = document.getElementById('file-viewer-video');
    vid.style.display = 'block';
    pauseAllVideosExcept('file-viewer-video');
    vid.src = url;   // playModuleVideo jaisa — seedha src assign
    vid.load();      // sirf load — no autoplay (training video approach)
  } else {
    // Document / folder → iframe with embeddable URL
    var vid = document.getElementById('file-viewer-video');
    if(vid){ try{vid.pause();}catch(e){} vid.removeAttribute('src'); vid.load(); vid.style.display='none'; }

    // Mobile/PWA detect: Android Chrome iframe mein PDF "Open" button + pencil aata hai
    // Fix: mobile par seedha Google Drive preview new tab mein kholo
    var isIPad = /iPad/i.test(navigator.userAgent)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isPhone = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) && !isIPad;
    var isMobile = isPhone;

    if(isMobile){
      // Modal band karo aur Google Drive preview seedha new tab mein kholo
      ov.style.display = 'none';
      document.body.style.overflow = '';
      // Drive embed URL ki jagah original preview URL use karo
      var mobileUrl = toDriveEmbedUrl(url);
      window.open(mobileUrl, '_blank');
      return;
    }

    frame.style.display = 'block';
    loading.style.display = 'flex';
    var embedUrl = toDriveEmbedUrl(url);
    // Add #toolbar=0 hint (works on Chrome native PDF viewer; harmless otherwise)
    if(embedUrl.indexOf('#') === -1) embedUrl += '#toolbar=0';
    frame.src = embedUrl;

    var isGoogle = /drive\.google\.com|docs\.google\.com/.test(embedUrl);
    // Safari detect karo
    var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if(isGoogle){
      if(isSafari){
        // Safari fix: toolbar clip nahi karte — seedha normal size rakhte hain
        // Safari mein calc(100% + 128px) scroll tod deta hai
        frame.style.top    = '0';
        frame.style.height = '100%';
        if(mask)  mask.style.display  = 'none';
        if(mask2) mask2.style.display = 'none';
      } else {
        // 🔒 CLIP TOOLBAR: shift iframe UP by 64px so Google's toolbar is outside visible area.
        //     Parent has overflow:hidden so the shifted-off part is invisible & unclickable.
        frame.style.top    = '-64px';
        frame.style.height = 'calc(100% + 128px)'; // extend bottom too to hide any bottom bar
        if(mask)  mask.style.display  = 'block';   // backup mask in case clip fails
        if(mask2) mask2.style.display = 'block';
      }
    } else {
      frame.style.top    = '0';
      frame.style.height = '100%';
      if(mask)  mask.style.display  = 'none';
      if(mask2) mask2.style.display = 'none';
    }
  }

  ov.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeFileViewer(){
  var frame = document.getElementById('file-viewer-frame');
  if(frame) frame.src = 'about:blank';
  var vid = document.getElementById('file-viewer-video');
  if(vid){ try{vid.pause();}catch(e){} vid.removeAttribute('src'); vid.load(); vid.style.display='none'; }
  document.getElementById('file-viewer-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// Click outside modal to close
document.getElementById('file-viewer-overlay').addEventListener('click', function(e){
  if(e.target === this) closeFileViewer();
});

// Escape key closes file viewer
document.addEventListener('keydown', function(e){
  var ov = document.getElementById('file-viewer-overlay');
  var isOpen = ov && ov.style.display === 'flex';
  if(e.key === 'Escape' && isOpen){ closeFileViewer(); return; }
});

/* Auto-intercept: any <a> tag pointing to drive.google.com or docs.google.com
   with a data-inline-view attribute (or matching folder/file pattern) opens
   inside the viewer instead of a new tab. This is a safety net — primary
   hookup is the onclick handler added on each link below. */
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('a[data-inline-view]');
  if(!a) return;
  e.preventDefault();
  var title = a.getAttribute('data-title') ||
              (a.querySelector('.hc-name') ? a.querySelector('.hc-name').textContent.trim() : 'Documents');
  openFileViewer(a.href, title);
});

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

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL UPLOAD SYSTEM
// Flow: choose section → pick/create card → pick file → upload to
//       Supabase Storage bucket "files" → insert row in "files" table
// ═══════════════════════════════════════════════════════════════════════════

// --- Portal Update Posts (MIS feature) ---
let _editingAnnId = null; // null = new post, number = edit mode

function openPostUpdateModal() {
  _editingAnnId = null;
  document.getElementById('postUpdateTitle').value = '';
  document.getElementById('postUpdateBody').value = '';
  document.getElementById('postUpdateError').style.display = 'none';
  // Modal heading aur button text reset
  const heading = document.getElementById('postUpdateHeading');
  if (heading) heading.textContent = '✨ Post Update';
  const btn = document.getElementById('postUpdateSubmitBtn');
  if (btn) btn.textContent = '🚀 Publish Update';
  document.getElementById('postUpdateModal').style.display = 'block';
  document.getElementById('postUpdateBackdrop').style.display = 'block';
  setTimeout(()=>document.getElementById('postUpdateTitle').focus(), 100);
}

function editPortalUpdate(id) {
  if (!CURRENT_USER || PERMISSIONS.can_post_announcements !== 'true') return;
  const ann = _annDrwUpdates.find(a => a.id === id);
  if (!ann) { alert('Update not found.'); return; }
  _editingAnnId = id;
  document.getElementById('postUpdateTitle').value = ann.title || '';
  document.getElementById('postUpdateBody').value  = ann.body  || '';
  document.getElementById('postUpdateError').style.display = 'none';
  // Modal heading aur button update karo
  const heading = document.getElementById('postUpdateHeading');
  if (heading) heading.textContent = '✏️ Edit Update';
  const btn = document.getElementById('postUpdateSubmitBtn');
  if (btn) btn.textContent = '💾 Save Changes';
  document.getElementById('postUpdateModal').style.display = 'block';
  document.getElementById('postUpdateBackdrop').style.display = 'block';
  setTimeout(()=>document.getElementById('postUpdateTitle').focus(), 100);
}

function closePostUpdateModal() {
  document.getElementById('postUpdateModal').style.display = 'none';
  document.getElementById('postUpdateBackdrop').style.display = 'none';
}

async function submitPortalUpdate() {
  const title = (document.getElementById('postUpdateTitle').value || '').trim();
  const body  = (document.getElementById('postUpdateBody').value || '').trim();
  const errEl = document.getElementById('postUpdateError');
  const btn   = document.getElementById('postUpdateSubmitBtn');

  errEl.style.display = 'none';
  if (!title) { errEl.textContent = '⚠️ Title is required.'; errEl.style.display = 'block'; return; }
  if (!body)  { errEl.textContent = '⚠️ Message cannot be empty.'; errEl.style.display = 'block'; return; }

  const isEditing = !!_editingAnnId;
  btn.disabled = true;
  btn.textContent = isEditing ? 'Saving…' : 'Publishing…';

  try {
    const hdrs = {
      ...SB_HDRS(),
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    let res;
    if (isEditing) {
      // ── EDIT mode: PATCH existing row ──
      const payload = { title, body };
      res = await fetch(
        SUPABASE_URL + '/rest/v1/portal_update_text?id=eq.' + _editingAnnId,
        { method: 'PATCH', headers: hdrs, body: JSON.stringify(payload) }
      );
    } else {
      // ── NEW post: INSERT ──
      const postedBy = (CURRENT_USER && CURRENT_USER.name) || 'MIS Team';
      const payload = { title, body, posted_by: postedBy };
      res = await fetch(
        SUPABASE_URL + '/rest/v1/portal_update_text',
        { method: 'POST', headers: hdrs, body: JSON.stringify(payload) }
      );
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || res.statusText);
    }

    // Local data bhi update karo (immediate UI refresh)
    if (isEditing) {
      const idx = _annDrwUpdates.findIndex(a => a.id === _editingAnnId);
      if (idx !== -1) { _annDrwUpdates[idx].title = title; _annDrwUpdates[idx].body = body; }
    }

    // Refresh the feed
    _annDrwLoaded = false;
    _annDrwUpdates = [];
    _editingAnnId = null;
    closePostUpdateModal();
    document.getElementById('annDrwFeed').innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:0.85rem;">Refreshing…</div>';
    await _annDrwLoad();
    annDrwFilter('update');

    if (!isEditing) {
      // ── Push sirf new post pe ──
      osSendPush('New Announcement', title + '\nOpen the portal to view — learn.adititracking.com');
    }
  } catch(e) {
    errEl.textContent = '❌ Error: ' + (e.message || 'Please try again.');
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = isEditing ? '💾 Save Changes' : '🚀 Publish Update';
  }
}

/* ══ DELETE PORTAL UPDATE ══ */
async function deletePortalUpdate(id) {
  if (!CURRENT_USER || CURRENT_USER.rawRole !== 'mis') return;
  if (!confirm('Are you sure you want to delete this update?')) return;

  // Card turant fade karo
  const card = document.getElementById('ann-card-' + id);
  if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }

  try {
    const hdrs = { ...SB_HDRS(), 'Content-Type': 'application/json' };
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/portal_update_text?id=eq.' + id,
      { method: 'DELETE', headers: hdrs }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || res.statusText);
    }
    // Local list se bhi hatao
    _annDrwUpdates = _annDrwUpdates.filter(a => a.id !== id);
    _annDrwRender();
  } catch(e) {
    if (card) { card.style.opacity = '1'; card.style.pointerEvents = ''; }
    alert('Delete error: ' + (e.message || 'Please try again.'));
  }
}

(function initIdleTimeout() {
  const IDLE_LIMIT  = 3 * 60 * 60 * 1000;  // 3 hours idle = logout
  const WARN_BEFORE = 5  * 60 * 1000;       // warn 5 minutes before logout

  let lastActivity = Date.now();
  let warnShown    = false;
  let logoutDone   = false;

  ['click', 'keydown', 'scroll', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, () => {
      lastActivity = Date.now();
      if (warnShown) {
        warnShown  = false;
        logoutDone = false;
        const w = document.getElementById('_idleWarn');
        if (w) { w.style.opacity = '0'; setTimeout(() => w && w.remove(), 300); }
      }
    }, { passive: true });
  });

  function showIdleWarning() {
    if (warnShown) return;
    warnShown = true;
    const w = document.createElement('div');
    w.id = '_idleWarn';
    w.style.cssText = `
      position:fixed;bottom:28px;right:24px;z-index:999990;
      background:#1e1b14;border:1.5px solid #f0a500;
      border-radius:16px;padding:16px 20px;
      font-family:'DM Sans',sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,0.55);
      display:flex;align-items:flex-start;gap:13px;
      opacity:0;transition:opacity 0.35s;max-width:340px;
    `;
    w.innerHTML = `
      <span style="font-size:1.6rem;line-height:1;margin-top:2px;">⏱️</span>
      <div style="flex:1;">
        <div style="font-size:0.92rem;font-weight:700;color:#f0a500;margin-bottom:4px;">Session Expiring Soon</div>
        <div style="font-size:0.81rem;color:#c8cdd8;line-height:1.5;">
          You will be automatically logged out in <strong style="color:#fff;">5 minutes</strong> due to inactivity.
        </div>
        <div style="font-size:0.78rem;color:#8a909e;margin-top:5px;">Click anywhere to stay logged in.</div>
      </div>
      <button onclick="(function(){var w=document.getElementById('_idleWarn');if(w){w.style.opacity='0';setTimeout(function(){w&&w.remove();},300);}})()"
        style="background:none;border:none;color:#8a909e;cursor:pointer;font-size:1.1rem;padding:0;line-height:1;margin-top:2px;flex-shrink:0;">✕</button>
    `;
    document.body.appendChild(w);
    requestAnimationFrame(() => w.style.opacity = '1');
  }

  function doIdleLogout() {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
    if (logoutDone) return;
    logoutDone = true;
    const w = document.getElementById('_idleWarn');
    if (w) w.remove();
    if (typeof showToast === 'function') {
      showToast('🔒 Session expired due to inactivity. Please log in again.', 'warning', 5000);
    }
    setTimeout(() => {
      if (typeof doLogout === 'function') doLogout();
      else { _sbAuth.auth.signOut().catch(() => {}); location.reload(); }
    }, 1800);
  }

  setInterval(() => {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
    const idleMs = Date.now() - lastActivity;
    if (!warnShown  && idleMs >= (IDLE_LIMIT - WARN_BEFORE)) showIdleWarning();
    if (!logoutDone && idleMs >= IDLE_LIMIT)                  doIdleLogout();
  }, 10000);
})();


// ═══════════════════════════════════════════════════════════
// EMPLOYEE PROFILE PHOTO — Supabase Employee_details
// Employee_name se match karo, photo home page pe dikhao
// ═══════════════════════════════════════════════════════════
async function fetchUserProfilePhoto() {
  const banner  = document.getElementById('empProfileBanner');
  const photoEl = document.getElementById('empPhotoContainer');
  const nameEl  = document.getElementById('empProfileName');
  const deptEl  = document.getElementById('empProfileDept');
  const hintEl  = document.getElementById('empNoPhotoHint');
  if (!banner || !CURRENT_USER) return;

  // Banner show karo (loading state ke saath)
  banner.style.display = 'flex';

  // User ka naam Supabase format mein
  const userName = (CURRENT_USER.name || '').trim();
  const userEmail = String(CURRENT_USER.email || '').trim();
  if (!userName) return;

  try {
    // Step 1 – Email_Id se filter karo (most reliable — email unique hota hai)
    let row = null;
    const _hdrs = SB_HDRS();

    if (userEmail) {
      const urlE = `${SUPABASE_URL}/rest/v1/Employee_details?select=*&Email_Id=ilike.${encodeURIComponent(userEmail)}&limit=1`;
      const resE = await fetch(urlE, { headers: _hdrs });
      const dataE = await resE.json();
      if (Array.isArray(dataE) && dataE.length > 0) row = dataE[0];
    }

    // Step 2 – Email se nahi mila toh Employee_name se try karo (case-insensitive)
    if (!row) {
      const encodedName = encodeURIComponent(userName);
      const url = `${SUPABASE_URL}/rest/v1/Employee_details?select=*&Employee_name=ilike.${encodedName}&limit=1`;
      const res = await fetch(url, { headers: _hdrs });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) row = data[0];
    }

    // Name aur dept fill karo (DB se mila toh DB ka naam, warna login wala)
    nameEl.textContent = (row && row['Employee_name']) ? row['Employee_name'] : userName;
    const dept = row ? (row['Employee_Dept'] || CURRENT_USER.rawRole || 'Employee') : (CURRENT_USER.rawRole || 'Employee');
    deptEl.textContent = '🏢 ' + dept.charAt(0).toUpperCase() + dept.slice(1);

    if (row && (row['avatar_url'] || row['Link'])) {
      // Photo mili — img tag banao
      const photoUrl = row['avatar_url'] || row['Link'];
      const img = document.createElement('img');
      img.src = photoUrl;
      img.alt = userName;
      img.style.cssText = 'width:90px;height:90px;object-fit:cover;border-radius:50%;';
      img.onerror = function() {
        // URL broken hai — silently initials placeholder dikhao, error message nahi
        const wrap = this.closest('.emp-photo-wrap');
        const placeholder = document.createElement('div');
        placeholder.className = 'emp-photo-placeholder';
        placeholder.textContent = (userName || 'U')[0].toUpperCase();
        if (wrap) { wrap.innerHTML = ''; wrap.appendChild(placeholder); }
        else { _showPhotoPlaceholder(photoEl, userName); }
        hintEl.style.display = 'none';
      };
      // Replace loading div with actual photo
      const wrap = document.createElement('div');
      wrap.className = 'emp-photo-wrap';
      wrap.appendChild(img);
      photoEl.replaceWith(wrap);
      hintEl.style.display = 'none';
    } else {
      // Koi photo nahi mili — naam ka pehla letter dikhao
      _showPhotoPlaceholder(photoEl, userName);
      hintEl.style.display = 'block';
    }

  } catch (err) {
    _showPhotoPlaceholder(photoEl, userName);
    nameEl.textContent = userName;
    deptEl.textContent = '🏢 ' + (CURRENT_USER.rawRole || 'Employee').charAt(0).toUpperCase() + (CURRENT_USER.rawRole || 'Employee').slice(1);
  }
}

function _showPhotoPlaceholder(el, name) {
  const placeholder = document.createElement('div');
  placeholder.className = 'emp-photo-placeholder';
  placeholder.textContent = (name || 'U')[0].toUpperCase();
  el.replaceWith(placeholder);
}

// ═══════════════════════════════════════════════════════════
// SPOTLIGHT OF THE MONTH — Soloni Raut (Support)
// ═══════════════════════════════════════════════════════════
const POTM_NAMES = ['Soloni Raut']; // kept for any reference, not used below



async function loadPerformers() {
  const slot = document.getElementById('soloni-img-slot');
  if (!slot) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/Employee_details?select=avatar_url,Link&Emp_id=eq.7&limit=1`;
    const res = await fetch(url, { headers: SB_HDRS() });
    const rows = await res.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const link = row ? (row['avatar_url'] || row['Link']) : null;
    if (link) {
      const img = document.createElement('img');
      img.className = 'potm-photo';
      img.alt = 'Soloni Raut';
      img.src = link;
      img.onerror = function() {
        const av = document.createElement('div');
        av.className = 'potm-avatar';
        av.textContent = 'S';
        img.replaceWith(av);
      };
      slot.replaceWith(img);
    } else {
      const av = document.createElement('div');
      av.className = 'potm-avatar';
      av.textContent = 'S';
      slot.replaceWith(av);
    }
  } catch(e) {
    const av = document.createElement('div');
    av.className = 'potm-avatar';
    av.textContent = 'S';
    if (slot) slot.replaceWith(av);
  }
}

// ═══════════════════════════════════════════════════════════
// NEW JOINERS — Emp_id 78, 80
// ═══════════════════════════════════════════════════════════
async function loadNewJoiners() {
  const grid = document.getElementById('newJoinersGrid');
  if (!grid) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Employee_Dept,Location,avatar_url,Link&Emp_id=in.(78,80)&order=Emp_id.asc`;
    const res = await fetch(url, { headers: SB_HDRS() });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      grid.innerHTML = '<div style="color:var(--muted);font-size:0.84rem;padding:10px 0;">No new joiners to show right now.</div>';
      return;
    }
    grid.innerHTML = '';
    rows.forEach(row => {
      const name = row['Employee_name'] || 'New Joiner';
      const dept = row['Employee_Dept'] || '';
      const loc = row['Location'] || '';
      const photo = row['avatar_url'] || row['Link'] || null;
      const initial = (name || 'N')[0].toUpperCase();

      const card = document.createElement('div');
      card.className = 'potm-card nj-card';

      const bar = document.createElement('div');
      bar.className = 'potm-card-bar';
      bar.style.background = '#00d4aa';
      bar.style.opacity = '0.8';
      card.appendChild(bar);

      if (photo) {
        const img = document.createElement('img');
        img.className = 'potm-photo';
        img.alt = name;
        img.src = photo;
        img.onerror = function() {
          const av = document.createElement('div');
          av.className = 'potm-avatar';
          av.textContent = initial;
          img.replaceWith(av);
        };
        card.appendChild(img);
      } else {
        const av = document.createElement('div');
        av.className = 'potm-avatar';
        av.textContent = initial;
        card.appendChild(av);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'potm-name';
      nameEl.textContent = name;
      card.appendChild(nameEl);

      if (dept) {
        const deptEl = document.createElement('div');
        deptEl.className = 'potm-dept';
        deptEl.style.background = 'rgba(0,212,170,0.12)';
        deptEl.style.color = '#00d4aa';
        deptEl.style.border = '1px solid rgba(0,212,170,0.3)';
        deptEl.textContent = '🏢 ' + dept;
        card.appendChild(deptEl);
      }

      if (loc) {
        const locEl = document.createElement('div');
        locEl.className = 'potm-location';
        locEl.textContent = '📍 ' + loc;
        card.appendChild(locEl);
      }

      grid.appendChild(card);
    });
  } catch(e) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:0.84rem;padding:10px 0;">Couldn\'t load new joiners.</div>';
  }
}



