// Section: Announcements (loadAnnouncements, feed, wishes, emoji, chat)
// Stable key for celebrations: use name+celebType+today (no .id on employee rows)
function _annCelebKey(c) {
  return 'c_' + (c.name || '').replace(/\s+/g,'_') + '_' + (c.celebType || 'bday');
}
function _annMarkAllSeen() {
  const allIds = [
    ..._annDrwUpdates.map(a => 'u_' + a.id),
    ..._annDrwCelebs.map(c => _annCelebKey(c))
  ];
  localStorage.setItem('annSeenIds', JSON.stringify(allIds));
  // Also set day-level seen flag so dot stays gone all day
  localStorage.setItem('annSeen_' + _annTodayKey(), '1');
  _annUpdateBadge();
}
function _annUpdateBadge() {
  const badge = document.getElementById('annBellDot');
  if (!badge) return;
  // If user has opened the overlay today, hide dot immediately
  if (localStorage.getItem('annSeen_' + _annTodayKey()) === '1') {
    badge.style.display = 'none';
    return;
  }
  const seenIds = _annGetSeenIds();
  const unseenUpdates = _annDrwUpdates.filter(a => !seenIds.includes('u_' + a.id));
  const unseenCelebs  = _annDrwCelebs.filter(c => !seenIds.includes(_annCelebKey(c)));
  const count = unseenUpdates.length + unseenCelebs.length;
  if (count <= 0) {
    badge.style.display = 'none';
  } else {
    badge.style.display = 'inline-flex';
    badge.textContent = count > 99 ? '99+' : String(count);
  }
}

/* ── Open / Close overlay ────────────────────────────────── */
let _annChatPollInterval = null;
let _annLastMsgId = 0; // track last seen message id for incremental fetch

function _annStartChatPoll() {
  _annStopChatPoll();
  // Update _annLastMsgId from current data
  if (_annDrwWishes.length) _annLastMsgId = Math.max(..._annDrwWishes.map(w => w.id || 0));

  _annChatPollInterval = setInterval(async () => {
    if (_annDrwFilter !== 'celeb') { _annStopChatPoll(); return; }
    try {
      const today = new Date().toISOString().slice(0,10);
      // Only fetch messages newer than last known id
      const idFilter = _annLastMsgId > 0 ? `&id=gt.${_annLastMsgId}` : '';
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/birthday_wishes?select=id,wish_text,from_email,from_name,type,to_email,to_name,created_at&wish_date=eq.${today}${idFilter}&order=created_at.asc&limit=50`,
        { headers: SB_HDRS() }
      );
      if (!res.ok) return;
      const newMsgs = await res.json();
      if (!newMsgs.length) return;

      // Append only truly new messages
      const existingIds = new Set(_annDrwWishes.map(w => w.id));
      const toAdd = newMsgs.filter(w => !existingIds.has(w.id)).map(w => ({
        ...w,
        _senderName:   w.from_name || (w.from_email ? w.from_email.split('@')[0] : 'Someone'),
        _senderAvatar: _annAvatarCache[( w.from_email||'').toLowerCase()] || null
      }));
      if (!toAdd.length) return;

      _annDrwWishes.push(...toAdd);
      _annLastMsgId = Math.max(..._annDrwWishes.map(w => w.id || 0));
      _annDrwRender();
      // Load any missing avatars for new senders
      _annLoadMissingAvatars();
      // Scroll to bottom if user is near bottom
      const feed = document.getElementById('annDrwFeed');
      if (feed && (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 140) {
        setTimeout(() => { feed.scrollTop = feed.scrollHeight; }, 60);
      }
    } catch(e) {}
  }, 5000); // poll every 5 seconds
}

function _annStopChatPoll() {
  if (_annChatPollInterval) { clearInterval(_annChatPollInterval); _annChatPollInterval = null; }
}

function openAnnOverlay() {
  const backdrop = document.getElementById('annOverlayBackdrop');
  const drawer   = document.getElementById('annOverlayDrawer');
  if (!backdrop || !drawer) return;
  backdrop.style.display = 'block';
  drawer.style.display   = 'flex';
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    drawer.style.transform = 'translateX(0)';
  });
  document.body.style.overflow = 'hidden';
  if (_annDrwLoaded) {
    _annDrwRender();
    _annMarkAllSeen();
  } else {
    _annDrwLoad();
  }
  localStorage.setItem('annSeen_' + _annTodayKey(), '1');
  if (_annDrwLoaded) _annMarkAllSeen(); // ensure badge stays off after viewing
  annDrwFilter(_annDrwFilter || 'update');
}

function closeAnnOverlay() {
  const backdrop = document.getElementById('annOverlayBackdrop');
  const drawer   = document.getElementById('annOverlayDrawer');
  if (!backdrop || !drawer) return;
  _annStopChatPoll(); // stop polling when drawer closes
  drawer.style.transform = 'translateX(100%)';
  backdrop.style.opacity = '0';
  setTimeout(() => {
    drawer.style.display   = 'none';
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
  }, 320);
}

/* ── Filter tabs ─────────────────────────────────────────── */
function annDrwFilter(f) {
  _annDrwFilter = f;
  document.querySelectorAll('.ann-drw-tab').forEach(b => {
    const isActive = b.id === 'ann-drw-tab-' + f;
    const col = f === 'celeb' ? '#f0a500' : '#4e9af1';
    b.style.borderBottomColor = isActive ? col : 'transparent';
    b.style.color   = isActive ? col : 'var(--muted)';
    b.style.fontWeight = isActive ? '700' : '600';
    b.style.background = isActive ? (f==='celeb'?'rgba(240,165,0,0.06)':'rgba(78,154,241,0.06)') : 'transparent';
    if (isActive) b.classList.add('active'); else b.classList.remove('active');
  });

  // Footer: Updates → Post Update btn | Celebrations → chat input
  const updFooter  = document.getElementById('annFooterUpdates');
  const chatFooter = document.getElementById('annFooterChat');
  const postBtn    = document.getElementById('annPostUpdateBtn');
  const isMIS      = PERMISSIONS.can_post_announcements === 'true';

  const feed = document.getElementById('annDrwFeed');

  if (f === 'celeb') {
    if (updFooter)  updFooter.style.display  = 'none';
    if (chatFooter) chatFooter.style.display = 'flex';
    _annSetSelfAvatar();
    // Fun celebration background
    if (feed) {
      feed.style.background = 'linear-gradient(135deg,rgba(255,220,100,0.08) 0%,rgba(255,100,150,0.06) 33%,rgba(150,100,255,0.06) 66%,rgba(100,200,255,0.07) 100%)';
      feed.style.padding    = '14px 14px';
    }
    _annStartChatPoll(); // start real-time polling
  } else {
    if (updFooter)  updFooter.style.display  = 'flex';
    if (chatFooter) chatFooter.style.display = 'none';
    if (postBtn) postBtn.style.display = isMIS ? 'flex' : 'none';
    if (feed) { feed.style.background = ''; feed.style.padding = '16px 20px'; }
    _annStopChatPoll(); // stop polling when not on celeb tab
  }

  _annDrwRender();
}

/* ── Load data ───────────────────────────────────────────── */
async function _annDrwLoad() {
  const feed = document.getElementById('annDrwFeed');
  if (!feed) return;

  // Show loading skeleton immediately — don't make user wait
  feed.innerHTML = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:0.87rem;">⏳ Loading...</div>';

  // Fetch all data in parallel (not sequential)
  await Promise.allSettled([
    _annDrwFetchUpdates(),
    _annDrwFetchCelebrations(),
    _annDrwFetchWishes()
  ]);

  _annDrwLoaded = true;
  _annDrwRender();
  _annUpdateBadge();
  _annMarkAllSeen();
}

/* ── Fetch announcements from Supabase ───────────────────── */
async function _annDrwFetchUpdates() {
  try {
    const hdrs = SB_HDRS();
    // Dedicated portal_update_text table se fetch karo
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_update_text?select=id,title,body,posted_by,created_at&order=created_at.desc&limit=50`,
      { headers: hdrs }
    );
    if (!res.ok) { _annDrwUpdates = []; return; }
    const data = await res.json();
    _annDrwUpdates = (Array.isArray(data) ? data : [])
      .filter(r => r.title && r.title.trim())
      .map(r => ({
        id:         r.id,
        title:      r.title || 'Portal Update',
        body:       r.body || '',
        posted_by:  r.posted_by || 'MIS Team',
        pinned:     false,
        type:       'update',
        created_at: r.created_at
      }));
  } catch(e) { _annDrwUpdates = []; }
}

/* ── Fetch birthdays/anniversaries ───────────────────────── */
async function _annDrwFetchCelebrations() {
  try {
    const hdrs = SB_HDRS();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=*&limit=500`, { headers: hdrs });
    if (!res.ok) return;
    const employees = await res.json();
    if (!Array.isArray(employees)) return;
    _annDrwCelebs = [];
    employees.forEach(emp => {
      const name   = _annGetField(emp, ['Employee_name','employee_name','Name']);
      if (!name) return;
      const email  = _annGetField(emp, ['Email_Id','email_id','Email','email']);
      const dept   = _annGetField(emp, ['Employee_Dept','employee_dept','Department']);
      const avatar = _annGetField(emp, ['avatar_url','Link','link','Photo']);
      const dob    = _annGetField(emp, ['Date of Birth','Date_of_Birth','date_of_birth','DOB']);
      const doj    = _annGetField(emp, ['Date Of Joining','Date_Of_Joining','date_of_joining','DOJ']);
      if (dob && typeof _celebIsToday === 'function' && _celebIsToday(dob))
        _annDrwCelebs.push({ name, email, dept, avatar, celebType:'birthday' });
      if (doj && typeof _celebIsToday === 'function' && _celebIsToday(doj)) {
        const years = typeof _celebYearsSince === 'function' ? _celebYearsSince(doj) : 0;
        if (years > 0) _annDrwCelebs.push({ name, email, dept, avatar, celebType:'anniversary', years });
      }
    });
  } catch(e) {}
}

/* ── Safe body renderer: escape HTML → newlines → clickable links ── */
function _safeBody(text) {
  if (!text) return '';
  // 1. HTML entities escape karo — agar user ne </div> ya < > type kiya ho toh layout nahi tootega
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // 2. Newlines ko <br> mein convert karo
  const withBreaks = escaped.replace(/\n/g, '<br>');
  // 3. URLs ko clickable <a> links mein convert karo
  return withBreaks.replace(
    /(https?:\/\/[^\s<>"'\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#4e9af1;text-decoration:underline;word-break:break-all;display:inline;">$1</a>'
  );
}

/* ── Render all cards in drawer ─────────────────────────── */
function _annDrwRender() {
  const feed = document.getElementById('annDrwFeed');
  if (!feed) return;

  const f = _annDrwFilter;
  let html = '';

  // ─ Portal Updates from Supabase ─
  if (f === 'all' || f === 'update') {
    if (_annDrwUpdates.length > 0) {
      _annDrwUpdates.forEach((ann, i) => {
        const typeClr = ann.type === 'celeb' ? '#f0a500'
                      : ann.type === 'general' ? '#ff5c7c'
                      : '#4e9af1';
        const typeBg  = ann.type === 'celeb' ? 'rgba(240,165,0,0.1)'
                      : ann.type === 'general' ? 'rgba(255,92,124,0.1)'
                      : 'rgba(78,154,241,0.1)';
        const typeIcon = ann.type === 'celeb' ? '🎉' : ann.type === 'general' ? '📣' : '✨';
        const timeAgo = ann.created_at ? _annTimeLabel(ann.created_at) : '';
        const pinnedBadge = ann.pinned
          ? `<span style="font-size:0.68rem;padding:2px 8px;border-radius:20px;background:rgba(240,165,0,0.15);color:#f0a500;font-weight:700;border:1px solid rgba(240,165,0,0.3);">📌 Pinned</span>` : '';
        const _isMIS = PERMISSIONS.can_post_announcements === 'true';
        const _delBtn = _isMIS
          ? `<button onclick="editPortalUpdate(${ann.id})" style="background:rgba(78,154,241,0.08);border:1px solid rgba(78,154,241,0.25);color:#4e9af1;border-radius:7px;padding:2px 9px;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.18s;margin-right:4px;" onmouseover="this.style.background='rgba(78,154,241,0.2)'" onmouseout="this.style.background='rgba(78,154,241,0.08)'">✏️ Edit</button><button onclick="deletePortalUpdate(${ann.id})" style="background:rgba(255,59,48,0.08);border:1px solid rgba(255,59,48,0.22);color:#ff3b30;border-radius:7px;padding:2px 9px;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.18s;" onmouseover="this.style.background='rgba(255,59,48,0.2)'" onmouseout="this.style.background='rgba(255,59,48,0.08)'">🗑 Delete</button>`
          : '';
        html += `
        <div id="ann-card-${ann.id}" style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;border-left:3px solid ${typeClr};flex-shrink:0;animation:annCardIn 0.35s cubic-bezier(0.22,1,0.36,1) both;animation-delay:${i*0.06}s;">
          <div style="padding:14px 16px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
              <span style="font-size:1.1rem;">${typeIcon}</span>
              <span style="font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:20px;background:${typeBg};color:${typeClr};border:1px solid ${typeClr}40;">Portal Update</span>
              ${pinnedBadge}
              <span style="font-size:0.72rem;color:var(--muted);margin-left:auto;">${timeAgo}</span>
              ${_delBtn}
            </div>
            <div style="font-family:'Playfair Display',serif;font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:6px;line-height:1.35;">${ann.title || 'Update'}</div>
            <div style="font-size:0.83rem;color:var(--text2);line-height:1.7;word-break:break-word;overflow-wrap:break-word;width:100%;">${_safeBody(ann.body)}</div>
            ${ann.posted_by ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:0.75rem;color:var(--muted);display:flex;align-items:center;gap:6px;"><span style="width:22px;height:22px;border-radius:6px;background:rgba(78,154,241,0.15);color:#4e9af1;display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;">${(ann.posted_by||'M')[0].toUpperCase()}</span><span>Posted by <strong style="color:var(--text2);">${ann.posted_by}</strong></span></div>` : ''}
          </div>
        </div>`;
      });
    } else if (f === 'update') {
      html += _annDrwEmpty('✨', 'No portal updates yet.', 'MIS Team will post updates here soon.');
    }
  }

  // ─ Celebrations tab — always show (chat works even without celebrations) ─
  if (f === 'all' || f === 'celeb') {
    const bdays = _annDrwCelebs.filter(c => c.celebType === 'birthday');
    const annis = _annDrwCelebs.filter(c => c.celebType === 'anniversary');
    let celebHTML = '';

    // ── Celebration banner (only when someone has birthday/anniversary) ──
    if (_annDrwCelebs.length > 0) {
      celebHTML += `
    <div style="background:var(--surface2);border:1px solid rgba(240,165,0,0.3);border-radius:14px;overflow:hidden;border-left:3px solid #f0a500;">
      <div style="padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:1.2rem;">${bdays.length > 0 && annis.length > 0 ? '🎉' : bdays.length > 0 ? '🎂' : '🥳'}</span>
          <span style="font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:20px;background:rgba(240,165,0,0.12);color:#f0a500;border:1px solid rgba(240,165,0,0.3);">Celebrations</span>
          <span style="font-size:0.72rem;color:#ff3b30;font-weight:700;margin-left:auto;">🔴 Today</span>
        </div>
        <div style="font-family:'Playfair Display',serif;font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:8px;">
          ${bdays.length > 0 && annis.length > 0 ? 'Birthdays & Anniversaries Today!' :
            bdays.length > 0 ? (bdays.length === 1 ? `Happy Birthday, ${bdays[0].name.split(' ')[0]}! 🎂` : `${bdays.length} Birthdays Today!`) :
            (annis.length === 1 ? `Happy Anniversary, ${annis[0].name.split(' ')[0]}! 🥳` : `${annis.length} Work Anniversaries!`)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">`;
      bdays.forEach(p => {
        const ini = (p.name||'?')[0].toUpperCase();
      celebHTML += `<div style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:10px;background:rgba(240,165,0,0.08);border:1px solid rgba(240,165,0,0.2);">
        ${p.avatar ? `<img src="${p.avatar}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='<span style=width:28px;height:28px;border-radius:50%;background:rgba(240,165,0,0.2);color:#f0a500;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;>${ini}</span>'">`
          : `<span style="width:28px;height:28px;border-radius:50%;background:rgba(240,165,0,0.2);color:#f0a500;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;">${ini}</span>`}
        <div><div style="font-size:0.81rem;font-weight:700;color:var(--text);">🎂 ${p.name.split(' ')[0]}</div><div style="font-size:0.70rem;color:var(--muted);">Birthday</div></div>
      </div>`;
    });
    annis.forEach(p => {
      const ini = (p.name||'?')[0].toUpperCase();
      celebHTML += `<div style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:10px;background:rgba(78,154,241,0.08);border:1px solid rgba(78,154,241,0.2);">
        ${p.avatar ? `<img src="${p.avatar}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='<span style=width:28px;height:28px;border-radius:50%;background:rgba(78,154,241,0.2);color:#4e9af1;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;>${ini}</span>'">`
          : `<span style="width:28px;height:28px;border-radius:50%;background:rgba(78,154,241,0.2);color:#4e9af1;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;">${ini}</span>`}
        <div><div style="font-size:0.81rem;font-weight:700;color:var(--text);">🥳 ${p.name.split(' ')[0]}</div><div style="font-size:0.70rem;color:var(--muted);">${p.years ? p.years + ' yr' : ''} Anniversary</div></div>
      </div>`;
    });
    celebHTML += `</div>
        <div style="font-size:0.80rem;color:var(--muted);">Spread some love and wish your teammates on their special day! 💛</div>
      </div>
    </div>`; // end celebration banner
    } // end if (_annDrwCelebs.length > 0)

    // WhatsApp-style group chat — always visible in celeb tab
    // Colorful palette for other senders (cycles through fun colors)
    const _chatPalette = [
      {bg:'rgba(168,85,247,0.13)',border:'rgba(168,85,247,0.3)',name:'#a855f7',bubble:'rgba(168,85,247,0.1)'},
      {bg:'rgba(236,72,153,0.12)',border:'rgba(236,72,153,0.3)',name:'#ec4899',bubble:'rgba(236,72,153,0.09)'},
      {bg:'rgba(59,130,246,0.13)',border:'rgba(59,130,246,0.3)',name:'#3b82f6',bubble:'rgba(59,130,246,0.1)'},
      {bg:'rgba(20,184,166,0.13)',border:'rgba(20,184,166,0.3)',name:'#14b8a6',bubble:'rgba(20,184,166,0.1)'},
      {bg:'rgba(234,179,8,0.13)', border:'rgba(234,179,8,0.3)', name:'#ca8a04',bubble:'rgba(234,179,8,0.08)'},
    ];
    // Build sender→color map so each person always gets same color
    const _senderColorMap = {};
    let _colorIdx = 0;

    celebHTML += `<div id="annCelebChat" style="display:flex;flex-direction:column;gap:8px;">
      <div style="text-align:center;margin-bottom:4px;">
        <span style="font-size:0.68rem;font-weight:700;color:var(--muted);background:rgba(240,165,0,0.1);padding:4px 14px;border-radius:20px;border:1px solid rgba(240,165,0,0.2);letter-spacing:0.05em;">✨ GROUP WISHES ✨ <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-left:4px;vertical-align:middle;animation:pulse 2s infinite;" title="Live"></span></span>
      </div>`;

    if (_annDrwWishes.length > 0) {
      _annDrwWishes.forEach(w => {
        const me       = CURRENT_USER?.email && w.from_email && w.from_email.toLowerCase() === CURRENT_USER.email.toLowerCase();
        const sender   = w._senderName || w.from_name || (w.from_email ? w.from_email.split('@')[0] : 'Someone');
        const initials = sender[0]?.toUpperCase() || '?';
        const avatar   = w._senderAvatar || null;
        const timeStr  = w.created_at ? new Date(w.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
        const target   = _annDrwCelebs.find(c => c.email === w.to_email);
        const toName   = target ? target.name.split(' ')[0] : (w.to_name && w.to_name !== 'Team' ? w.to_name.split(' ')[0] : '');
        const typeEmoji= (w.type === 'birthday') ? '🎂' : (w.type === 'anniversary') ? '🥳' : '🎉';

        // Assign stable color per sender
        if (!_senderColorMap[sender]) { _senderColorMap[sender] = _chatPalette[_colorIdx++ % _chatPalette.length]; }
        const pal = _senderColorMap[sender];

        // Avatar
        const avatarDiv = avatar
          ? `<img src="${avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-top:2px;border:2px solid ${pal.border};" onerror="this.style.display='none'">`
          : `<div style="width:32px;height:32px;border-radius:50%;background:${pal.bg};color:${pal.name};display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:900;flex-shrink:0;margin-top:2px;border:2px solid ${pal.border};">${initials}</div>`;

        if (me) {
          // My message — right side, golden gradient bubble
          celebHTML += `
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
              <div style="max-width:85%;background:linear-gradient(135deg,#f0a500,#f97316);border-radius:18px 3px 18px 18px;padding:10px 14px;box-shadow:0 2px 10px rgba(240,165,0,0.35);">
                ${toName?`<div style="font-size:0.67rem;color:rgba(255,255,255,0.85);font-weight:800;margin-bottom:4px;letter-spacing:0.02em;">${typeEmoji} To ${toName}</div>`:''}
                <div style="font-size:0.92rem;font-weight:700;color:#fff;line-height:1.5;letter-spacing:0.01em;">${w.wish_text}</div>
                <div style="font-size:0.62rem;color:rgba(255,255,255,0.75);text-align:right;margin-top:5px;">${timeStr} ✓✓</div>
              </div>
            </div>`;
        } else {
          // Others — left side, colorful per-sender bubble
          celebHTML += `
            <div style="display:flex;align-items:flex-start;gap:8px;">
              ${avatarDiv}
              <div style="max-width:82%;">
                <div style="font-size:0.7rem;font-weight:800;color:${pal.name};margin-bottom:3px;letter-spacing:0.01em;">${sender}</div>
                <div style="background:${pal.bubble};border:1.5px solid ${pal.border};border-radius:3px 18px 18px 18px;padding:10px 14px;box-shadow:0 1px 6px rgba(0,0,0,0.08);">
                  ${toName?`<div style="font-size:0.67rem;color:${pal.name};font-weight:800;margin-bottom:4px;">${typeEmoji} To ${toName}</div>`:''}
                  <div style="font-size:0.92rem;font-weight:700;color:var(--text);line-height:1.5;letter-spacing:0.01em;">${w.wish_text}</div>
                  <div style="font-size:0.62rem;color:var(--muted);margin-top:5px;">${timeStr}</div>
                </div>
              </div>
            </div>`;
        }
      });
      celebHTML += `</div>`; // close wishes list
    } else {
      celebHTML += `<div style="text-align:center;padding:30px 16px;">
        <div style="font-size:3rem;margin-bottom:10px;animation:livePulse 2s ease-in-out infinite;">🎊</div>
        <div style="font-size:0.92rem;font-weight:800;color:var(--text);margin-bottom:6px;">No messages yet!</div>
        <div style="font-size:0.8rem;color:var(--muted);">Be the first to spread some joy 🌟</div>
      </div>`;
    }
    celebHTML += `</div>`; // close annCelebChat
    html += celebHTML;
  }

  // ─ Empty state (only for updates tab when no updates) ─
  if (!html) {
    if (f === 'update') {
      html = _annDrwEmpty('✨', 'No updates yet.', 'MIS Team will post updates here soon.');
    }
  }

  feed.innerHTML = html;
  // Scroll chat to bottom when celeb tab is active
  if (_annDrwFilter === 'celeb') {
    setTimeout(() => { feed.scrollTop = feed.scrollHeight; }, 50);
  }
}

function _annDrwEmpty(icon, title, sub) {
  return `<div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:2.5rem;margin-bottom:10px;">${icon}</div>
    <div style="font-size:0.88rem;font-weight:600;color:var(--text2);margin-bottom:4px;">${title}</div>
    <div style="font-size:0.80rem;">${sub}</div>
  </div>`;
}

/* ── Wish Modal ─────────────────────────────────────────────── */
function openAnnWishModal() {
  if (!_annDrwCelebs.length) { alert('No celebrations today to wish!'); return; }
  // Populate target dropdown
  const sel = document.getElementById('annWishTarget');
  if (sel) {
    sel.innerHTML = '<option value="">— Select Person —</option>' +
      _annDrwCelebs.map(c =>
        `<option value="${c.email}|${c.celebType}">${c.name} — ${c.celebType === 'birthday' ? '🎂 Birthday' : '🥳 Work Anniversary'}</option>`
      ).join('');
  }
  document.getElementById('annWishMessage').value = '';
  document.getElementById('annWishError').style.display = 'none';
  document.getElementById('annWishBackdrop').style.display = 'block';
  document.getElementById('annWishModal').style.display = 'block';
}

function closeAnnWishModal() {
  document.getElementById('annWishBackdrop').style.display = 'none';
  document.getElementById('annWishModal').style.display = 'none';
}

async function submitAnnWish() {
  const sel  = document.getElementById('annWishTarget');
  const msg  = document.getElementById('annWishMessage').value.trim();
  const errEl= document.getElementById('annWishError');
  const btn  = document.getElementById('annWishSubmitBtn');
  errEl.style.display = 'none';

  if (!sel.value) { errEl.textContent = 'Please select who you want to wish.'; errEl.style.display='block'; return; }
  if (!msg)       { errEl.textContent = 'Please write a message.'; errEl.style.display='block'; return; }

  const [toEmail, celebType] = sel.value.split('|');
  const senderName = CURRENT_USER?.name || CURRENT_USER?.email || 'A teammate';
  const today = new Date().toISOString().slice(0,10);

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const body = {
      to_email:    toEmail,
      wish_text:   msg,
      type:        celebType,
      wish_date:   today,
      from_email:  CURRENT_USER?.email || null,
    };
    // Try to add from_emp_id if available
    if (_qzEmpId) body.from_emp_id = _qzEmpId;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/birthday_wishes`, {
      method: 'POST',
      headers: { ...SB_HDRS_JSON(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const e = await res.text();
      throw new Error(e.substring(0,120));
    }
    closeAnnWishModal();
    // Reload celeb wishes in drawer
    await _annDrwFetchWishes();
    _annDrwRender();
    // Show success toast
    _annToast('💌 Wish sent! Your message has been delivered.');
  } catch(e) {
    errEl.textContent = 'Could not send wish: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '💌 Send Wish';
  }
}

/* ── Fetch today's wishes for celebrations in drawer ─────── */
let _annDrwWishes = []; // wishes for today's celebrants
// Avatar cache: email → avatar_url (populated lazily)
const _annAvatarCache = {};

async function _annDrwFetchWishes() {
  try {
    const today = new Date().toISOString().slice(0,10);
    // Simple fast query — no JOIN, uses from_name saved at send time
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/birthday_wishes?select=id,wish_text,from_email,from_name,type,to_email,to_name,created_at&wish_date=eq.${today}&order=created_at.asc&limit=100`,
      { headers: SB_HDRS() }
    );
    const raw = res.ok ? (await res.json()) : [];
    _annDrwWishes = raw.map(w => ({
      ...w,
      _senderName:   w.from_name || (w.from_email ? w.from_email.split('@')[0] : 'Someone'),
      _senderAvatar: _annAvatarCache[w.from_email] || null
    }));
    // Lazy-load avatars for senders we haven't cached yet
    _annLoadMissingAvatars();
  } catch(e) { _annDrwWishes = []; }
}

async function _annLoadMissingAvatars() {
  const uncached = [...new Set(
    _annDrwWishes.map(w => w.from_email).filter(e => e && !_annAvatarCache[e])
  )];
  if (!uncached.length) return;
  try {
    const emailList = uncached.slice(0,20).map(e => `"${e}"`).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?select=Email_Id,avatar_url,Link&Email_Id=in.(${emailList})`,
      { headers: SB_HDRS() }
    );
    if (!res.ok) return;
    const rows = await res.json();
    let changed = false;
    rows.forEach(r => {
      const url = r.avatar_url || r.Link || null;
      const email = (r.Email_Id || '').toLowerCase();
      if (email && url && !_annAvatarCache[email]) {
        _annAvatarCache[email] = url;
        // Update cached wishes with avatar
        _annDrwWishes.forEach(w => {
          if ((w.from_email || '').toLowerCase() === email) { w._senderAvatar = url; changed = true; }
        });
      }
    });
    // Re-render only if avatars changed
    if (changed && _annDrwFilter === 'celeb') _annDrwRender();
  } catch(e) {}
}

/* ── Emoji picker helpers ─────────────────────────────────── */
function annToggleEmojiPicker() {
  const picker = document.getElementById('annEmojiPicker');
  if (!picker) return;
  picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function annInsertEmoji(emoji) {
  const input = document.getElementById('annChatInput');
  if (!input) return;
  const pos = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
  input.focus();
  input.setSelectionRange(pos + emoji.length, pos + emoji.length);
}

/* ── Populate self avatar in chat input ────────────────────── */
function _annSetSelfAvatar() {
  const el = document.getElementById('annChatSelfAvatar');
  if (!el || !CURRENT_USER) return;
  const name   = CURRENT_USER.name || CURRENT_USER.email || '';
  const ini    = name[0]?.toUpperCase() || '?';
  const avatar = CURRENT_USER.avatar_url || CURRENT_USER.avatar || null;
  if (avatar) {
    el.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${ini}'">`;
    el.style.padding = '0';
  } else {
    // Try fetching from DB if not cached
    if (CURRENT_USER.email && !CURRENT_USER._avatarFetched) {
      CURRENT_USER._avatarFetched = true;
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Email_Id,avatar_url,Link&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`, { headers: SB_HDRS() })
        .then(r => r.json()).then(arr => {
          const url = arr[0]?.avatar_url || arr[0]?.Link || null;
          if (url) {
            CURRENT_USER.avatar_url = url;
            // Pre-cache for group chat avatars
            if (typeof _annAvatarCache !== 'undefined') _annAvatarCache[CURRENT_USER.email.toLowerCase()] = url;
            _annSetSelfAvatar();
          }
        }).catch(() => {});
    }
    el.textContent = ini;
  }
}

/* ── Inline chat send (Celebrations tab) ─────────────────── */
async function annSendChatWish() {
  const input = document.getElementById('annChatInput');
  const msg   = input?.value?.trim();
  if (!msg) return;

  const picker = document.getElementById('annEmojiPicker');
  if (picker) picker.style.display = 'none';

  // If celebration today, target first celebrant; otherwise send as general team message
  const target     = _annDrwCelebs[0] || null;
  const toEmail    = target?.email || 'team@celebrations'; // placeholder — avoids NOT NULL constraint
  const toName     = target?.name  || 'Team';
  const celebType  = target?.celebType || 'general';
  const today      = new Date().toISOString().slice(0,10);
  const senderName = CURRENT_USER?.name || CURRENT_USER?.email?.split('@')[0] || 'Someone';
  const senderAvatar = CURRENT_USER?.avatar_url || CURRENT_USER?.avatar || null;

  const body = {
    wish_text:  msg,
    type:       celebType,
    wish_date:  today,
    from_email: CURRENT_USER?.email || null,
    from_name:  senderName,
    to_name:    toName,
    to_email:   toEmail,  // always set — never null
  };
  if (_qzEmpId) body.from_emp_id = _qzEmpId;

  input.value = '';
  input.disabled = true;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/birthday_wishes`, {
      method: 'POST',
      headers: { ...SB_HDRS_JSON(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => res.status);
      throw new Error(errTxt.substring(0,120));
    }
    // Optimistically add to local list
    _annDrwWishes.push({
      id: Date.now(), wish_text: msg,
      from_email: CURRENT_USER?.email, from_name: senderName,
      type: celebType, to_email: toEmail, to_name: toName,
      created_at: new Date().toISOString(),
      _senderName:   senderName,
      _senderAvatar: senderAvatar
    });
    _annDrwRender();
    const feed = document.getElementById('annDrwFeed');
    if (feed) setTimeout(() => { feed.scrollTop = feed.scrollHeight; }, 80);
  } catch(e) {
    _annToast('⚠️ Could not send: ' + e.message);
    input.value = msg; // restore message on failure
  } finally {
    input.disabled = false;
    input.focus();
  }
}

function _annToast(msg) {
  let t = document.getElementById('annToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'annToast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:10px 20px;border-radius:10px;font-size:0.82rem;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ── Main function called when switching to announcements ──────
async function loadAnnouncements() {
  if (_annLoaded) { _renderAnnFeed(); return; }

  // Show loading
  const container = document.getElementById('annFeedContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted);">
    <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
    <div style="font-size:0.9rem;">Loading announcements…</div>
  </div>`;

  // Fetch live data in parallel
  await Promise.allSettled([
    _annFetchCelebrations(),
  ]);

  _annLoaded = true;
  _renderAnnFeed();
  // Hide the red dot since user has seen it
  const dot = document.getElementById('announceDot');
  if (dot) { dot.style.display = 'none'; localStorage.setItem('annSeen_' + _annTodayKey(), '1'); }
}

function _annTodayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}

// ── Cached live data ─────────────────────────────────────────
let _annBirthdays    = [];
let _annAnniversaries = [];

// ── Fetch birthdays & anniversaries from Supabase ─────────────
async function _annFetchCelebrations() {
  // Reuse data from celebration system if already loaded
  if (typeof _celebLoaded !== 'undefined' && _celebLoaded) {
    // Get from existing banner render — re-fetch fresh
  }
  try {
    const hdrs = SB_HDRS();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=*&limit=500`, { headers:hdrs });
    if (!res.ok) return;
    const employees = await res.json();
    if (!Array.isArray(employees)) return;

    _annBirthdays    = [];
    _annAnniversaries = [];

    employees.forEach(emp => {
      const name  = _annGetField(emp, ['Employee_name','employee_name','Name']);
      if (!name) return;
      const email  = _annGetField(emp, ['Email_Id','email_id','Email','email']);
      const dept   = _annGetField(emp, ['Employee_Dept','employee_dept','Department']);
      const avatar = _annGetField(emp, ['avatar_url','Link','link','Photo']);
      const dob    = _annGetField(emp, ['Date of Birth','Date_of_Birth','date_of_birth','DOB']);
      const doj    = _annGetField(emp, ['Date Of Joining','Date_Of_Joining','date_of_joining','DOJ']);

      if (dob && typeof _celebIsToday === 'function' && _celebIsToday(dob)) {
        _annBirthdays.push({ name, email, dept, avatar });
      }
      if (doj && typeof _celebIsToday === 'function' && _celebIsToday(doj)) {
        const years = typeof _celebYearsSince === 'function' ? _celebYearsSince(doj) : 0;
        if (years > 0) _annAnniversaries.push({ name, email, dept, avatar, years });
      }
    });
  } catch(e) { }
}

// ── Helper to safely get field ────────────────────────────────
function _annGetField(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]).trim();
  }
  return '';
}

// ── Format date nicely ────────────────────────────────────────
function _annFmtDate(str) {
  if (!str) return '';
  try {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  } catch { return str; }
}

// ── Days ago label ────────────────────────────────────────────
function _annTimeLabel(dateStr) {
  if (!dateStr) return '';
  // IST (UTC+5:30) mein compare karo — raw ms diff se galat din aata tha
  const toIST = dt => {
    const utc = dt.getTime() + dt.getTimezoneOffset() * 60000;
    return new Date(utc + 5.5 * 3600000);
  };
  const dIST   = toIST(new Date(dateStr));
  const nowIST = toIST(new Date());
  // Date-only strings compare karo (time ignore karo)
  const dDate   = dIST.toISOString().slice(0,10);
  const nowDate = nowIST.toISOString().slice(0,10);
  if (dDate === nowDate) return '🔴 Today';
  // Diff in calendar days
  const diffMs   = new Date(nowDate) - new Date(dDate);
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return diffDays + ' days ago';
  if (diffDays < 30) return Math.floor(diffDays/7) + ' weeks ago';
  if (diffDays < 365)return Math.floor(diffDays/30) + ' months ago';
  return Math.floor(diffDays/365) + ' years ago';
}

// ── Build tag HTML ────────────────────────────────────────────
function _annBuildTags(tags, color) {
  if (!tags || !tags.length) return '';
  const bg = color ? color + '18' : 'rgba(240,165,0,0.1)';
  const cl = color || '#f0a500';
  const brd = color ? color + '35' : 'rgba(240,165,0,0.25)';
  return tags.map(t => `<span class="ann-tag" style="background:${bg};color:${cl};border:1px solid ${brd};">${t}</span>`).join('');
}

// ── Build a person chip ───────────────────────────────────────
function _annPersonChip(p, emoji, extraText, clickFn, color) {
  const bg = color ? color + '15' : 'rgba(240,165,0,0.12)';
  const cl = color || '#f0a500';
  const first = (p.name||'?').charAt(0).toUpperCase();
  const imgHtml = p.avatar
    ? `<img src="${p.avatar}" alt="${p.name}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><span style="display:none;width:26px;height:26px;border-radius:50%;background:${bg};color:${cl};align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;">${first}</span>`
    : `<span style="display:flex;width:26px;height:26px;border-radius:50%;background:${bg};color:${cl};align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;">${first}</span>`;
  return `<span class="ann-person-chip" onclick="${clickFn}" style="border-color:${cl}33;">
    <span class="ann-person-avatar">${imgHtml}</span>
    <span>
      <span class="ann-person-name">${emoji} ${p.name}</span>
      ${extraText ? `<br><span class="ann-person-sub">${extraText}</span>` : ''}
    </span>
  </span>`;
}

// ── Render all cards filtered ─────────────────────────────────
function _renderAnnFeed() {
  const container = document.getElementById('annFeedContainer');
  if (!container) return;

  const filter = _annCurrentFilter;
  let cards = [];

  // ─ 1. Celebrations (birthdays + anniversaries) ─
  if (true) { // always show celebrations
    if (_annBirthdays.length > 0 || _annAnniversaries.length > 0) {
      const hasBday = _annBirthdays.length > 0;
      const hasAnni = _annAnniversaries.length > 0;

      let pplHTML = '<div class="ann-people-row">';
      _annBirthdays.forEach(p => {
        pplHTML += _annPersonChip(p, '🎂', 'Birthday Today!',
          `_openCelebPopup('birthday-others',${JSON.stringify(p)},null)`, '#f0a500');
      });
      _annAnniversaries.forEach(p => {
        const yr = p.years;
        pplHTML += _annPersonChip(p, '🥳', (yr ? _celebOrdinal(yr) + ' Work Anniversary' : 'Work Anniversary'),
          `_openCelebPopup('anniversary-others',${JSON.stringify(p)},${yr||0})`, '#4e9af1');
      });
      pplHTML += '</div>';
      pplHTML += `<div style="margin-top:12px;">
        <button class="ann-wish-btn" onclick="switchDB('home')">🎉 Wish Them on Home Page</button>
      </div>`;

      cards.push({
        type:'celeb', date: new Date().toISOString().split('T')[0], color:'#f0a500',
        icon: hasBday && hasAnni ? '🎉' : hasBday ? '🎂' : '🥳',
        typeBadge:'Celebrations',
        title: hasBday && hasAnni ? "Birthdays & Anniversaries Today!" :
               hasBday ? (_annBirthdays.length===1 ? `Happy Birthday, ${_annBirthdays[0].name.split(' ')[0]}! 🎂` : `${_annBirthdays.length} Birthdays Today! 🎂`) :
               (_annAnniversaries.length===1 ? `Happy Anniversary, ${_annAnniversaries[0].name.split(' ')[0]}! 🥳` : `${_annAnniversaries.length} Work Anniversaries Today!`),
        body: 'Spread some love and wish your teammates on their special day! 💛',
        extraHTML: pplHTML,
        tags: ['🎊 Today'],
        sortKey: '9999-celeb'
      });
    }
  }

  // ─ Sort: latest first ─
  cards.sort((a,b) => (b.sortKey||'') > (a.sortKey||'') ? 1 : -1);

  if (cards.length === 0) {
    container.innerHTML = `<div class="ann-empty">
      <div class="ann-empty-icon">🔕</div>
      <div class="ann-empty-text">No announcements in this category yet.</div>
    </div>`;
    return;
  }

  // ─ Render cards ─
  let html = '';
  cards.forEach((c, i) => {
    const typeColors = {
      update:'rgba(78,154,241,0.12)', celeb:'rgba(240,165,0,0.12)',
      potm:'rgba(240,165,0,0.12)', holiday:'rgba(0,212,170,0.12)', general:'rgba(255,92,124,0.12)'
    };
    const typeTextColors = {
      update:'#4e9af1', celeb:'#f0a500', potm:'#f0a500', holiday:'#00d4aa', general:'#ff5c7c'
    };
    const typeType = c.type||'update';
    const badgeBg  = typeColors[typeType]  || 'rgba(240,165,0,0.12)';
    const badgeClr = typeTextColors[typeType] || '#f0a500';
    const timeLabel = c.sortKey && c.sortKey.startsWith('999') ? '🔴 Today' : _annTimeLabel(c.date);

    html += `<div class="ann-card" style="--ann-color:${c.color||'#f0a500'};animation-delay:${i*0.05}s;">
      <div class="ann-card-left-bar"></div>
      <div class="ann-card-inner">
        <div class="ann-card-head">
          <span style="font-size:1.4rem;line-height:1;">${c.icon||'📢'}</span>
          <span class="ann-type-badge" style="background:${badgeBg};color:${badgeClr};border-color:${c.color||'#f0a500'}40;">${c.typeBadge||c.type}</span>
          <span class="ann-card-time">${timeLabel}${c.date && !c.sortKey?.startsWith('999') ? ' · '+_annFmtDate(c.date) : ''}</span>
        </div>
        <div class="ann-card-title">${c.title}</div>
        <div class="ann-card-body">${c.body}</div>
        ${c.extraHTML ? `<div style="margin-top:10px;">${c.extraHTML}</div>` : ''}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

// ── Hook into switchDB for announcements ──────────────────────
(function() {
  const _origSwitchDB = window.switchDB;
  window.switchDB = function(id, fromPopState) {
    if (_origSwitchDB) _origSwitchDB.apply(this, arguments);
    if (id === 'announcements') {
      setTimeout(loadAnnouncements, 50);
    }
  };
})();

// ── On page load — fetch announcement count ───────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Sidebar dot (hidden nav)
  const dot = document.getElementById('announceDot');
  if (dot) dot.style.display = 'none';
  // Load announcements silently to show count badge
  (async () => {
    await Promise.allSettled([_annDrwFetchUpdates(), _annDrwFetchCelebrations()]);
    _annDrwLoaded = true;
    _annUpdateBadge();
  })();
  // Keyboard ESC to close overlay
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeAnnOverlay(); });
});
