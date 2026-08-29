// Section: Celebrations System (birthdays, anniversaries, wishes, confetti)
// ╔══════════════════════════════════════════════════════════════════════════
// ║  [CELEBRATIONS JS] — Birthday & Anniversary system
// ║  Home page pe banner dikhata hai jab kisi ka birthday/anniversary ho
// ║  Wish popup: text likh ke send karo, birthday wala dekh sakta hai
// ║  "See Your Wishes" button: birthday person apne wishes dekhe
// ║  Reply to all wishers: ek saath sab ko reply bhejo
// ║  Tables used: Employee_details (DOB/DOJ), employee_wishes (Supabase)
// ║  Key functions:
// ║    loadCelebrations()    = Home pe banner load karo
// ║    openCelebPopup()      = Wish popup open karo
// ║    sendWish()            = Wish Supabase mein save karo
// ║    openMyWishesModal()   = Birthday person ke liye wish viewer
// ╚══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// BIRTHDAY & ANNIVERSARY SYSTEM
// ═══════════════════════════════════════════════════════════════

let _celebCurrentPerson = null; // person whose popup is open (for wish feature)

// ── Global _isMe — checks if a person record matches the logged-in user ──
function _isMe(p) {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  const myEmail = (CURRENT_USER.email || '').toLowerCase().trim();
  const myName  = (CURRENT_USER.name  || '').toLowerCase().trim();
  if (myEmail && p.email && p.email.toLowerCase().trim() === myEmail) return true;
  if (myName  && p.name  && p.name.toLowerCase().trim()  === myName)  return true;
  // NOTE: deliberately no first-name-only fallback here — two different
  // employees can share a first name (e.g. "Chirag" vs "Chirag Gupta"),
  // and matching on just that showed one person's own celebration popup
  // to the wrong logged-in user. Email or full-name match only.
  return false;
}

// ── Helper: parse date string safely (handles all formats) ────
function _celebParseDate(str) {
  if (!str) return null;
  try {
    const s = String(str).trim();
    // DD/MM/YYYY  e.g. "07/05/2004"
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split('/');
      const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      return isNaN(dt.getTime()) ? null : dt;
    }
    // DD-MM-YYYY  e.g. "07-05-2004"
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
      const [d, m, y] = s.split('-');
      const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      return isNaN(dt.getTime()) ? null : dt;
    }
    // YYYY-MM-DD (ISO) e.g. "2004-05-07" — use local interpretation
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const parts = s.substring(0, 10).split('-');
      const dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return isNaN(dt.getTime()) ? null : dt;
    }
    // Fallback: natural parse
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  } catch { return null; }
}

// ── Get DOB/DOJ value from employee row (handles all column name variants) ──
function _celebGetField(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]).trim();
  }
  return '';
}

// ── Check if date matches today (only day + month) ────────────
function _celebIsToday(dateStr) {
  const d = _celebParseDate(dateStr);
  if (!d) return false;
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
}

// ── Calculate completed years since date ─────────────────────
function _celebYearsSince(dateStr) {
  const d = _celebParseDate(dateStr);
  if (!d) return 0;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() ||
      (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) {
    years--;
  }
  return Math.max(0, years);
}

// ── Ordinal number (1st, 2nd, 3rd…) ──────────────────────────
function _celebOrdinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Prevent duplicate runs ────────────────────────────────────
let _celebLoaded = false;

// ── Main loader — called after login ─────────────────────────
async function loadCelebrations() {
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON === 'undefined') return;
  if (!CURRENT_USER) return;
  if (_celebLoaded) return;   // run only once per session
  _celebLoaded = true;

  try {
    const hdrs = SB_HDRS();

    // Use select=* so we get actual column names regardless of spelling/case/spaces
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?select=*&limit=500`,
      { headers: hdrs }
    );
    if (!res.ok) {
      return;
    }
    const employees = await res.json();
    if (!Array.isArray(employees) || employees.length === 0) {
      return;
    }


    // ── Global employee cache with Emp_id (FK ke liye use hoga) ──
    window._empFullList = employees; // { Emp_id, Employee_name, Email_Id, ... }

    const birthdays    = [];
    const anniversaries = [];

    employees.forEach(emp => {
      // Try all known column name variants for employee name
      const name = _celebGetField(emp, ['Employee_name','employee_name','Name','name','EMPLOYEE_NAME']);
      if (!name) return;

      const email  = _celebGetField(emp, ['Email_Id','email_id','Email','email','EMAIL_ID']);
      const dept   = _celebGetField(emp, ['Employee_Dept','employee_dept','Emp_Dept','Department','dept']);
      const avatar = _celebGetField(emp, ['avatar_url','Avatar_url','Link','link','Photo','photo']);
      const empId  = emp['Emp_id'] || emp['emp_id'] || emp['EMP_ID'] || null;  // Primary Key

      // Try all DOB variants
      const dob = _celebGetField(emp, [
        'Date of Birth','Date_of_Birth','date_of_birth','DOB','dob',
        'DateOfBirth','date of birth','Date Of Birth','DATEOFBIRTH'
      ]);

      // Try all DOJ variants
      const doj = _celebGetField(emp, [
        'Date Of Joining','Date_Of_Joining','date_of_joining','DOJ','doj',
        'DateOfJoining','date of joining','Date of Joining','DATEOFJOING','Joining Date','joining_date'
      ]);

      if (dob) {
        if (_celebIsToday(dob)) {
          birthdays.push({ name, email, dept, avatar, empId });
        }
      }

      if (doj) {
        if (_celebIsToday(doj)) {
          const years = _celebYearsSince(doj);
          if (years > 0) anniversaries.push({ name, email, dept, avatar, years, empId });
        }
      }
    });


    // Show home banner for everyone
    _renderCelebBanner(birthdays, anniversaries);

    // Check if current user is one of the celebrants
    const myBday = birthdays.find(_isMe);
    const myAnni = anniversaries.find(_isMe);

    if (myBday || myAnni) {
      // Small delay so portal UI is fully rendered before popup shows
      setTimeout(() => {
        if (myBday) _openCelebPopup('birthday-self', myBday, null);
        else         _openCelebPopup('anniversary-self', myAnni, myAnni.years);
      }, 1000);
    }

  } catch (e) {
  }
}

// ── Render home banner ────────────────────────────────────────
function _renderCelebBanner(birthdays, anniversaries) {
  const banner = document.getElementById('celebrationHomeBanner');
  if (!banner) return;
  if (birthdays.length === 0 && anniversaries.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const hasBday = birthdays.length > 0;
  const hasAnni = anniversaries.length > 0;
  const bothTypes = hasBday && hasAnni;
  const onlyAnni = !hasBday && hasAnni;

  // Store globally — avoids JSON-in-onclick parse errors
  window._celebBannerBdays = birthdays;
  window._celebBannerAnnis = anniversaries;

  // Detect if logged-in user is one of today's celebrants
  const iAmCelebrant = birthdays.some(_isMe) || anniversaries.some(_isMe);

  let titleHTML = '';
  let subText = '';
  let mainEmoji = '';
  let cardClass = '';

  if (iAmCelebrant) {
    // Self view — birthday/anniversary is mine
    const isBday = birthdays.some(_isMe);
    mainEmoji = isBday ? '🎂' : '🥳';
    titleHTML = isBday
      ? `🎉 <span class="celeb-highlight">It's Your Birthday Today!</span>`
      : `🌟 <span class="celeb-highlight">It's Your Work Anniversary Today!</span>`;
    subText = isBday
      ? 'Wishing you a day full of joy and celebration! The entire Aditi Tracking family is thinking of you. 🎊'
      : 'Congratulations on your work anniversary! Your journey inspires us all. 🚀';
    cardClass = isBday ? '' : 'anni-only';
  } else if (bothTypes) {
    mainEmoji = '🎉';
    titleHTML = `<span class="celeb-highlight">Birthdays & Anniversaries</span> Today!`;
    subText = 'Spread some love — wish your teammates on their special day! 💛';
    cardClass = '';
  } else if (hasBday) {
    mainEmoji = '🎂';
    titleHTML = `<span class="celeb-highlight">${birthdays.length === 1 ? birthdays[0].name.split(' ')[0] : birthdays.length + ' teammates'}</span> ${birthdays.length === 1 ? 'has' : 'have'} a Birthday Today!`;
    subText = 'Make their day extra special — send your warmest wishes! 🎊';
    cardClass = '';
  } else {
    mainEmoji = '🥳';
    titleHTML = `Work Anniversary${anniversaries.length > 1 ? 'ies' : ''} Today!`;
    subText = 'Celebrate the journey — wish your colleagues on their work anniversary! ⭐';
    cardClass = 'anni-only';
  }

  // Build person chips — use index refs into window arrays, no inline JSON
  let chipsHTML = '<div class="celeb-person-chips">';
  birthdays.forEach((p, i) => {
    chipsHTML += `<span class="celeb-chip" onclick="_openCelebPopup('birthday-others', window._celebBannerBdays[${i}], null)" title="Click to wish ${p.name}">
      <span class="celeb-chip-confetti celeb-chip-emoji">🎂</span> ${p.name}
    </span>`;
  });
  anniversaries.forEach((p, i) => {
    chipsHTML += `<span class="celeb-chip celeb-chip-anni" onclick="_openCelebPopup('anniversary-others', window._celebBannerAnnis[${i}], ${p.years})" title="Click to wish ${p.name}">
      <span class="celeb-chip-emoji">🥳</span> ${p.name} <span style="opacity:0.7;font-size:0.75rem;">${_celebOrdinal(p.years)} Year</span>
    </span>`;
  });
  chipsHTML += '</div>';

  // Action button: "See Your Wishes" for celebrant, "Wished ✓" if already wished, else "Wish Them!"
  let actionBtnHTML;
  if (iAmCelebrant) {
    actionBtnHTML = `<button class="celeb-wish-all-btn" onclick="_openMyWishesModal()" style="background:linear-gradient(135deg,#4e9af1,#00d4aa);display:flex;align-items:center;gap:8px;">
         🎁 See Your Wishes
         <span id="bannerSeeWishesBadge" style="background:rgba(255,255,255,0.3);color:#fff;border-radius:20px;padding:1px 8px;font-size:0.78rem;font-weight:800;min-width:20px;text-align:center;">...</span>
       </button>`;
  } else {
    // Real state is resolved async below (DB is authoritative) — render a
    // neutral placeholder first so we never flash the wrong wished/not-wished state.
    actionBtnHTML = `<button class="celeb-wish-all-btn" id="bannerWishBtn" disabled style="opacity:0.6;">⏳ Checking…</button>`;
  }

  banner.innerHTML = `
    <div class="celeb-banner-card ${cardClass}">
      <div class="celeb-banner-inner">
        <div class="celeb-banner-icon">${mainEmoji}</div>
        <div class="celeb-banner-body">
          <div class="celeb-banner-title">${titleHTML}</div>
          <div class="celeb-banner-sub">${subText}</div>
          ${chipsHTML}
        </div>
        <div class="celeb-banner-actions">
          ${actionBtnHTML}
        </div>
      </div>
    </div>`;
  banner.style.display = 'block';

  // For users who have already wished, check if birthday person replied
  if (!iAmCelebrant) {
    _checkAndShowReplyOnHome(birthdays, anniversaries);
    _updateBannerWishButton(birthdays, anniversaries);
  }
}

// ── Resolve the banner's real Wished!/Wish Them! state via DB (async, no flash) ──
async function _updateBannerWishButton(birthdays, anniversaries) {
  const allCelebs = [
    ...birthdays.map(p => ({ ...p, celebType: 'birthday' })),
    ...anniversaries.map(p => ({ ...p, celebType: 'anniversary' }))
  ];
  if (!allCelebs.length) return;

  const results = await Promise.all(allCelebs.map(p => _hasAlreadyWished(p, p.celebType)));
  const alreadyWishedAll = results.every(Boolean);

  const btn = document.getElementById('bannerWishBtn');
  if (!btn) return; // banner may have re-rendered since

  if (alreadyWishedAll) {
    btn.outerHTML = `<button class="celeb-wish-all-btn" id="bannerWishBtn" disabled
      style="background:linear-gradient(135deg,#00d4aa,#22c55e);cursor:default;opacity:0.9;display:flex;align-items:center;gap:8px;">
      ✅ Wished!
    </button>`;
  } else {
    btn.outerHTML = `<button class="celeb-wish-all-btn" id="bannerWishBtn" onclick="_openWishAllPopup()">
      🎉 Wish Them!
    </button>`;
  }
}

// ── Show birthday person's reply on home page for wishers ─────
async function _checkAndShowReplyOnHome(birthdays, anniversaries) {
  const notif = document.getElementById('celebReplyNotif');
  if (!notif || !CURRENT_USER) return;

  const today = new Date().toISOString().split('T')[0];
  const hdrs = SB_HDRS();

  // Check each birthday/anniversary person
  const allPeople = [
    ...birthdays.map(p => ({ ...p, celebType: 'birthday' })),
    ...anniversaries.map(p => ({ ...p, celebType: 'anniversary' }))
  ];

  for (const person of allPeople) {
    const already = await _hasAlreadyWished(person, person.celebType);
    if (!already) continue; // user hasn't wished this person

    try {
      const fromEmpId = _getEmpId(CURRENT_USER.email || CURRENT_USER.name);
      const toEmpId   = person.empId || _getEmpId(person.email || person.name);
      let url;
      if (fromEmpId && toEmpId) {
        url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=reply_text,wish_text&from_emp_id=eq.${fromEmpId}&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${person.celebType}&order=created_at.desc&limit=1`;
      } else {
        const fe = encodeURIComponent((CURRENT_USER.email || '').trim());
        const te = encodeURIComponent((person.email || '').trim());
        url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=reply_text,wish_text&from_email=ilike.${fe}&to_email=ilike.${te}&wish_date=eq.${today}&type=eq.${person.celebType}&order=created_at.desc&limit=1`;
      }

      const res = await fetch(url, { headers: hdrs });
      if (!res.ok) continue;
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length || !rows[0].reply_text) continue;

      const { reply_text, wish_text } = rows[0];
      const firstName = (person.name || '').split(' ')[0];
      const typeLabel = person.celebType === 'birthday' ? '🎂' : '🥳';

      notif.innerHTML = `
        <div style="background:var(--surface);border:1.5px solid rgba(240,165,0,0.35);border-radius:16px;padding:14px 18px;display:flex;gap:12px;align-items:flex-start;animation:celebFadeIn 0.4s ease both;">
          <div style="font-size:1.6rem;flex-shrink:0;">${typeLabel}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.80rem;font-weight:700;color:#f0a500;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${firstName} replied to your wish!</div>
            <div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;font-style:italic;">"${wish_text}"</div>
            <div style="padding:9px 13px;background:rgba(240,165,0,0.09);border-left:3px solid #f0a500;border-radius:0 10px 10px 0;font-size:0.88rem;color:var(--text);line-height:1.5;">${reply_text}</div>
          </div>
        </div>`;
      notif.style.display = 'block';
      break; // show one at a time
    } catch(e) {
    }
  }
}

// ── Wish key for localStorage (prevent duplicate wishes) ──────
function _wishKey(toEmail, type) {
  const d = new Date();
  return `wish_${type}_${toEmail}_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;
}

// ── Stable cache key for a wish-check result ────────────────────
function _wishCheckKey(toPerson, type) {
  return type + '_' + (toPerson.empId || toPerson.email || toPerson.name);
}

// ── In-memory, same-session cache — never persisted, never shared across users ──
let _wishCheckCache = {};

// ── DB-backed check: has CURRENT_USER already wished this person today? (authoritative) ──
async function _hasAlreadyWished(toPerson, type) {
  if (!CURRENT_USER) return false;
  const cacheKey = _wishCheckKey(toPerson, type);
  if (_wishCheckCache[cacheKey] !== undefined) return _wishCheckCache[cacheKey];

  const today = new Date().toISOString().split('T')[0];
  const hdrs  = SB_HDRS();
  const fromEmpId = _getEmpId(CURRENT_USER.email || CURRENT_USER.name);
  const toEmpId   = toPerson.empId || _getEmpId(toPerson.email || toPerson.name);
  let found = false;

  try {
    // Strategy 1: emp_id match (most reliable)
    if (fromEmpId && toEmpId) {
      const url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=id&from_emp_id=eq.${fromEmpId}&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${type}&limit=1`;
      const res = await fetch(url, { headers: hdrs });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length) found = true;
      }
    }
    // Strategy 2: email fallback (emp_id sometimes null on either side)
    if (!found) {
      const fromEmail = encodeURIComponent((CURRENT_USER.email || '').trim());
      const toEmail   = encodeURIComponent((toPerson.email    || '').trim());
      if (fromEmail && toEmail) {
        const url2 = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=id&from_email=ilike.${fromEmail}&to_email=ilike.${toEmail}&wish_date=eq.${today}&type=eq.${type}&limit=1`;
        const res2 = await fetch(url2, { headers: hdrs });
        if (res2.ok) {
          const rows2 = await res2.json();
          if (Array.isArray(rows2) && rows2.length) found = true;
        }
      }
    }
  } catch (e) {}

  _wishCheckCache[cacheKey] = found;
  return found;
}

// ── Open popup (type: birthday-self / birthday-others / anniversary-self / anniversary-others) ──
function _openCelebPopup(type, person, years) {
  _celebCurrentPerson = person;
  const overlay      = document.getElementById('celebPopupOverlay');
  const emojiEl      = document.getElementById('celebEmoji');
  const titleEl      = document.getElementById('celebTitle');
  const nameEl       = document.getElementById('celebName');
  const subEl        = document.getElementById('celebSubtitle');
  const msBox        = document.getElementById('celebMilestone');
  const msBadge      = document.getElementById('celebMilestoneBadge');
  const wishBox      = document.getElementById('celebWishBox');
  const wishSent     = document.getElementById('celebWishSent');
  const alreadyEl    = document.getElementById('celebAlreadyWished');
  const topBar       = document.getElementById('celebTopBar');
  if (!overlay) return;

  // Reset all sections
  if (wishBox)    wishBox.style.display    = 'none';
  if (wishSent)   wishSent.style.display   = 'none';
  if (alreadyEl)  alreadyEl.style.display  = 'none';
  if (msBox)      msBox.style.display      = 'none';

  // Reset send button — otherwise a stuck "Sending..." state from a previous
  // popup (e.g. a failed banner update) would persist across reopens
  const sendBtn = document.getElementById('celebSendBtn');
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '🎉 Send Wish!'; }

  const inp = document.getElementById('celebWishInput');
  if (inp) { inp.value = ''; inp.style.borderColor = 'var(--border)'; }
  const cnt = document.getElementById('celebWishCharCount');
  if (cnt) cnt.textContent = '0/200';

  // Char counter
  if (inp) {
    inp.oninput = function() {
      const c = document.getElementById('celebWishCharCount');
      if (c) c.textContent = inp.value.length + '/200';
      if (inp.value.length > 200) inp.value = inp.value.substring(0, 200);
    };
  }

  const firstName = (person.name || '').split(' ')[0];
  const celebType = type.includes('birthday') ? 'birthday' : 'anniversary';

  if (type === 'birthday-self') {
    emojiEl.textContent = '🎂';
    titleEl.textContent = '🎉 Happy Birthday!';
    nameEl.textContent  = person.name || CURRENT_USER.name;
    subEl.textContent   = `Wishing you a wonderful birthday filled with joy, laughter, and all the happiness in the world! 🎈✨ The entire Aditi Tracking family wishes you the best!`;
    topBar.style.background    = 'linear-gradient(90deg,#f0a500,#ffcc44,#ff5c7c,#f0a500)';
    topBar.style.backgroundSize = '300%';
    // Preload wish count for banner badge
    _preloadWishCount(person.email || CURRENT_USER.email, 'birthday', person.empId || null);

  } else if (type === 'anniversary-self') {
    emojiEl.textContent = '🥳';
    const y = years || 0;
    titleEl.textContent = `🌟 Work Anniversary!`;
    nameEl.textContent  = person.name || CURRENT_USER.name;
    subEl.textContent   = `Congratulations on completing ${_celebOrdinal(y)} year${y > 1 ? 's' : ''} with Aditi Tracking! Your dedication and hard work inspire us all. Here's to many more years of growth and success! 🚀`;
    if (y > 0) { msBox.style.display = 'block'; msBadge.innerHTML = `🏆 ${_celebOrdinal(y)} Work Anniversary`; }
    topBar.style.background    = 'linear-gradient(90deg,#4e9af1,#00d4aa,#4e9af1)';
    topBar.style.backgroundSize = '300%';
    // Preload wish count for banner badge
    _preloadWishCount(person.email || CURRENT_USER.email, 'anniversary', person.empId || null);

  } else if (type === 'birthday-others') {
    emojiEl.textContent = '🎂';
    titleEl.textContent = `Happy Birthday, ${firstName}!`;
    nameEl.textContent  = person.name;
    subEl.textContent   = `Today is ${firstName}'s special day! 🎊 Send a warm wish and make their birthday extra special!`;
    topBar.style.background    = 'linear-gradient(90deg,#f0a500,#ffcc44,#ff5c7c,#f0a500)';
    topBar.style.backgroundSize = '300%';
    // Check already wished (DB-backed — localStorage would leak across users
    // sharing a browser). Both stay hidden until resolved, so nothing wrong flashes.
    _hasAlreadyWished(person, 'birthday').then(already => {
      if (already) { alreadyEl.style.display = 'block'; }
      else         { wishBox.style.display   = 'block'; }
    });

  } else if (type === 'anniversary-others') {
    emojiEl.textContent = '🥳';
    const y = years || 0;
    titleEl.textContent = `Work Anniversary!`;
    nameEl.textContent  = person.name;
    subEl.textContent   = `${firstName} is celebrating their ${_celebOrdinal(y)} work anniversary today! 🎊 Appreciate their journey and send your best wishes!`;
    if (y > 0) { msBox.style.display = 'block'; msBadge.innerHTML = `⭐ ${_celebOrdinal(y)} Work Anniversary`; }
    topBar.style.background    = 'linear-gradient(90deg,#4e9af1,#00d4aa,#4e9af1)';
    topBar.style.backgroundSize = '300%';
    // Check already wished (DB-backed, same as birthday branch above)
    _hasAlreadyWished(person, 'anniversary').then(already => {
      if (already) { alreadyEl.style.display = 'block'; }
      else         { wishBox.style.display   = 'block'; }
    });
  }

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _startConfetti(type.includes('birthday'));
}

// ── Emp_id lookup helper ──────────────────────────────────────
function _getEmpId(emailOrName) {
  const list = window._empFullList;
  if (!list || !list.length) return null;
  const key = (emailOrName || '').toLowerCase().trim();
  // Email match first (most reliable)
  let found = list.find(e => {
    const em = _celebGetField(e, ['Email_Id','email_id','Email','email']);
    return em && em.toLowerCase().trim() === key;
  });
  // Name match fallback
  if (!found) {
    found = list.find(e => {
      const nm = _celebGetField(e, ['Employee_name','employee_name','Name']);
      return nm && nm.toLowerCase().trim() === key;
    });
  }
  if (!found) return null;
  return found['Emp_id'] || found['emp_id'] || found['EMP_ID'] || null;
}

// ── Load wishes for the birthday/anniversary person (self view) ─
async function _loadWishesForSelf(toEmail, type, toEmpId) {
  const listEl    = document.getElementById('celebWishersList');
  const loadingEl = document.getElementById('celebWishersLoading');
  const emptyEl   = document.getElementById('celebWishersEmpty');
  const countEl   = document.getElementById('celebWishCount');
  if (!listEl) return;

  // Show loading
  listEl.innerHTML = '';
  if (loadingEl) loadingEl.style.display = 'block';
  if (emptyEl)   emptyEl.style.display   = 'none';
  if (countEl)   countEl.textContent     = '';

  try {
    const hdrs = SB_HDRS();
    const today = new Date().toISOString().split('T')[0];

    // Prefer Emp_id FK query; fallback to email
    let url;
    if (toEmpId) {
      // FK join: get wish + from_employee details (name, avatar, dept) in one call
      url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=*,from_employee:Employee_details!birthday_wishes_from_emp_id_fkey(Employee_name,Employee_Dept,avatar_url,Link)&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${type}&order=created_at.asc`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=*&to_email=eq.${encodeURIComponent(toEmail)}&wish_date=eq.${today}&type=eq.${type}&order=created_at.asc`;
    }

    const res = await fetch(url, { headers: hdrs });

    if (loadingEl) loadingEl.style.display = 'none';

    if (!res.ok) {
      if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Could not load wishes. 😕'; }
      return;
    }

    const wishes = await res.json();
    if (!Array.isArray(wishes) || wishes.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (countEl) countEl.textContent = wishes.length;

    // Render each wish
    listEl.innerHTML = wishes.map(w => {
      // Name: from joined employee table (FK) OR fallback to stored from_name
      const fromEmpData = w.from_employee || {};
      const fromName = fromEmpData['Employee_name'] || w.from_name || 'Colleague';
      const fromDept = fromEmpData['Employee_Dept'] || '';
      const fromAvatar = fromEmpData['avatar_url'] || fromEmpData['Link'] || null;
      const msg      = w.wish_text || '🎉';
      const timeStr  = w.created_at ? _celebFmtTime(w.created_at) : '';
      const initial  = fromName.charAt(0).toUpperCase();
      const colors   = ['#f0a500','#00d4aa','#4e9af1','#ff5c7c','#a855f7','#f97316'];
      const col      = colors[fromName.charCodeAt(0) % colors.length];
      const avatarHTML = fromAvatar
        ? `<img src="${fromAvatar}" alt="${fromName}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
          + `<span style="display:none;width:32px;height:32px;border-radius:50%;background:${col}22;color:${col};border:1.5px solid ${col}55;align-items:center;justify-content:center;font-size:0.82rem;font-weight:800;font-family:'DM Sans',sans-serif;">${initial}</span>`
        : `<span style="display:flex;width:32px;height:32px;border-radius:50%;background:${col}22;color:${col};border:1.5px solid ${col}55;align-items:center;justify-content:center;font-size:0.82rem;font-weight:800;font-family:'DM Sans',sans-serif;">${initial}</span>`;

      return `<div style="display:flex;gap:10px;align-items:flex-start;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;animation:celebFadeIn 0.4s ease both;">
        <div style="flex-shrink:0;">${avatarHTML}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="font-size:0.82rem;font-weight:700;color:var(--text);">${fromName}</span>
            ${fromDept ? `<span style="font-size:0.70rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);padding:1px 6px;border-radius:20px;">${fromDept}</span>` : ''}
            ${timeStr ? `<span style="font-size:0.70rem;color:var(--muted);margin-left:auto;white-space:nowrap;">${timeStr}</span>` : ''}
          </div>
          <div style="font-size:0.83rem;color:var(--text2);line-height:1.5;word-break:break-word;">${msg}</div>
        </div>
      </div>`;
    }).join('');

  } catch(e) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl)   { emptyEl.style.display = 'block'; emptyEl.textContent = 'Network error. 😕'; }
  }
}

// ── Format time from ISO string ───────────────────────────────
function _celebFmtTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  } catch { return ''; }
}

// ── Preload wish count for the "See Your Wishes" badge ───────
let _selfWishData = { email: null, type: null, empId: null, wishes: null };
async function _preloadWishCount(toEmail, type, toEmpId) {
  _selfWishData = { email: toEmail, type, empId: toEmpId, wishes: null };
  try {
    const hdrs = SB_HDRS();
    const today = new Date().toISOString().split('T')[0];
    let url;
    if (toEmpId) {
      url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=*,from_employee:Employee_details!birthday_wishes_from_emp_id_fkey(Employee_name,Employee_Dept,avatar_url,Link)&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${type}&order=created_at.asc`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=*&to_email=eq.${encodeURIComponent(toEmail)}&wish_date=eq.${today}&type=eq.${type}&order=created_at.asc`;
    }
    const res = await fetch(url, { headers: hdrs });
    if (res.ok) {
      const data = await res.json();
      _selfWishData.wishes = Array.isArray(data) ? data : [];
      // Update banner button badge count
      const bannerBadge = document.getElementById('bannerSeeWishesBadge');
      if (bannerBadge) bannerBadge.textContent = _selfWishData.wishes.length;
    }
  } catch(e) {
  }
}

// ── Open My Wishes Modal (for birthday/anniversary person) ───
function _openMyWishesModal() {
  // If _selfWishData is not yet set (e.g. user clicked banner button directly),
  // populate it from the global banner data
  if (!_selfWishData.email && !_selfWishData.empId) {
    const bdays = window._celebBannerBdays || [];
    const annis = window._celebBannerAnnis || [];
    const meBday = bdays.find(_isMe);
    const meAnni = annis.find(_isMe);
    const me = meBday || meAnni;
    if (me) {
      _selfWishData = {
        email:  me.email || (CURRENT_USER && CURRENT_USER.email) || null,
        type:   meBday ? 'birthday' : 'anniversary',
        empId:  me.empId || null,
        wishes: null
      };
    }
  }
  const overlay = document.getElementById('myWishesOverlay');
  if (!overlay) return;
  const listEl   = document.getElementById('myWishesList');
  const loadEl   = document.getElementById('myWishesLoading');
  const emptyEl  = document.getElementById('myWishesEmpty');
  const badge    = document.getElementById('myWishesBadge');
  const subtitle = document.getElementById('myWishesSubtitle');
  const topBar   = document.getElementById('myWishesTopBar');

  // Set subtitle
  const typeLabel = _selfWishData.type === 'anniversary' ? 'Work Anniversary' : 'Birthday';
  if (subtitle) subtitle.textContent = `Wishes received on your ${typeLabel} today`;
  if (topBar && _selfWishData.type === 'anniversary') {
    topBar.style.background = 'linear-gradient(90deg,#4e9af1,#00d4aa,#4e9af1)';
  }

  overlay.style.display = 'flex';

  // Reset Reply to Everyone section
  const revBox  = document.getElementById('replyEveryoneBox');
  const revDone = document.getElementById('replyEveryoneDone');
  const revInp  = document.getElementById('replyEveryoneInput');
  if (revBox)  revBox.style.display  = 'none';
  if (revDone) revDone.style.display = 'none';
  if (revInp)  revInp.value = '';

  // Use cached wishes if available
  if (_selfWishData.wishes !== null) {
    _renderMyWishes(_selfWishData.wishes, listEl, loadEl, emptyEl, badge);
    return;
  }

  // Otherwise fetch
  listEl.innerHTML = '';
  if (loadEl)  loadEl.style.display  = 'block';
  if (emptyEl) emptyEl.style.display = 'none';
  if (badge)   badge.textContent     = '';

  _preloadWishCount(_selfWishData.email, _selfWishData.type, _selfWishData.empId).then(() => {
    _renderMyWishes(_selfWishData.wishes || [], listEl, loadEl, emptyEl, badge);
  });
}

function _renderMyWishes(wishes, listEl, loadEl, emptyEl, badge) {
  if (loadEl)  loadEl.style.display  = 'none';
  if (badge)   badge.textContent     = wishes.length;
  if (!listEl) return;

  if (wishes.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  const colors = ['#f0a500','#00d4aa','#4e9af1','#ff5c7c','#a855f7','#f97316'];
  listEl.innerHTML = wishes.map((w, idx) => {
    const fromEmpData  = w.from_employee || {};
    const fromName     = fromEmpData['Employee_name'] || w.from_name || 'Colleague';
    const fromDept     = fromEmpData['Employee_Dept'] || '';
    const fromAvatar   = fromEmpData['avatar_url'] || fromEmpData['Link'] || null;
    const msg          = w.wish_text || '🎉';
    const timeStr      = w.created_at ? _celebFmtTime(w.created_at) : '';
    const initial      = fromName.charAt(0).toUpperCase();
    const col          = colors[fromName.charCodeAt(0) % colors.length];
    const wishId       = w.id || '';
    const existingReply = w.reply_text || '';

    const avatarHTML = fromAvatar
      ? `<img src="${fromAvatar}" alt="${fromName}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';this.nextSibling.style.display='flex'">
         <span style="display:none;width:36px;height:36px;border-radius:50%;background:${col}22;color:${col};border:1.5px solid ${col}55;align-items:center;justify-content:center;font-size:0.88rem;font-weight:800;font-family:'DM Sans',sans-serif;">${initial}</span>`
      : `<span style="display:flex;width:36px;height:36px;border-radius:50%;background:${col}22;color:${col};border:1.5px solid ${col}55;align-items:center;justify-content:center;font-size:0.88rem;font-weight:800;font-family:'DM Sans',sans-serif;">${initial}</span>`;

    const replyDisplayHTML = existingReply
      ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(240,165,0,0.08);border-left:3px solid #f0a500;border-radius:0 8px 8px 0;">
           <div style="font-size:0.72rem;font-weight:700;color:#f0a500;margin-bottom:3px;">🎂 Your Reply</div>
           <div style="font-size:0.84rem;color:var(--text2);line-height:1.5;">${existingReply}</div>
         </div>`
      : `<div id="replyBox_${idx}" style="display:none;margin-top:8px;">
           <textarea id="replyInput_${idx}" placeholder="Write your reply..." maxlength="200"
             style="width:100%;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:8px 10px;font-size:0.84rem;color:var(--text);font-family:DM Sans,sans-serif;resize:none;height:70px;outline:none;box-sizing:border-box;transition:border-color 0.2s;"
             onfocus="this.style.borderColor='#f0a500'" onblur="this.style.borderColor='var(--border)'"></textarea>
           <div style="display:flex;gap:8px;margin-top:6px;">
             <button onclick="_sendReply('${wishId}', ${idx})"
               style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,#f0a500,#ffcc44);color:#000;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">
               Send Reply 💬
             </button>
             <button onclick="document.getElementById('replyBox_${idx}').style.display='none'"
               style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);font-size:0.82rem;cursor:pointer;font-family:DM Sans,sans-serif;">
               Cancel
             </button>
           </div>
         </div>`;

    const replyBtnHTML = existingReply ? '' :
      `<button onclick="document.getElementById('replyBox_${idx}').style.display='block';document.getElementById('replyInput_${idx}').focus()"
         style="margin-top:7px;padding:4px 12px;border-radius:20px;border:1px solid rgba(240,165,0,0.4);background:rgba(240,165,0,0.08);color:#f0a500;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;transition:all 0.15s;"
         onmouseover="this.style.background='rgba(240,165,0,0.18)'" onmouseout="this.style.background='rgba(240,165,0,0.08)'">
         💬 Reply
       </button>`;

    return `<div id="wishCard_${idx}" style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px;animation:celebFadeIn 0.4s ease both;">
      <div style="display:flex;gap:11px;align-items:flex-start;">
        <div style="flex-shrink:0;">${avatarHTML}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
            <span style="font-size:0.88rem;font-weight:700;color:var(--text);">${fromName}</span>
            ${fromDept ? `<span style="font-size:0.72rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);padding:1px 7px;border-radius:20px;">${fromDept}</span>` : ""}
            ${timeStr  ? `<span style="font-size:0.72rem;color:var(--muted);margin-left:auto;white-space:nowrap;">${timeStr}</span>` : ""}
          </div>
          <div style="font-size:0.87rem;color:var(--text2);line-height:1.55;word-break:break-word;">${msg}</div>
          ${replyBtnHTML}
          ${replyDisplayHTML}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Toggle Reply to Everyone box ─────────────────────────────
function _toggleReplyEveryone() {
  const box = document.getElementById('replyEveryoneBox');
  const inp = document.getElementById('replyEveryoneInput');
  if (!box) return;
  const isOpen = box.style.display !== 'none';
  box.style.display = isOpen ? 'none' : 'block';
  if (!isOpen && inp) inp.focus();
}

// ── Send same reply to ALL wishers ───────────────────────────
async function _sendReplyToEveryone() {
  const inp     = document.getElementById('replyEveryoneInput');
  const sendBtn = document.getElementById('replyEveryoneSendBtn');
  const doneEl  = document.getElementById('replyEveryoneDone');
  if (!inp) return;

  const replyText = inp.value.trim();
  if (!replyText) { inp.style.borderColor = '#ff5c7c'; inp.placeholder = 'Please write something...'; return; }

  const wishes = _selfWishData.wishes;
  if (!wishes || wishes.length === 0) return;

  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

  const hdrs = SB_HDRS_MIN();

  let successCount = 0;
  for (const w of wishes) {
    if (!w.id) continue;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/birthday_wishes?id=eq.${w.id}`,
        { method: 'PATCH', headers: hdrs, body: JSON.stringify({ reply_text: replyText }) }
      );
      if (res.ok || res.status === 204) {
        w.reply_text = replyText; // update cache
        successCount++;
      }
    } catch(e) { }
  }

  if (successCount > 0) {
    // Update all wish cards in the modal to show the reply
    const listEl = document.getElementById('myWishesList');
    if (listEl) {
      // Re-render the list with updated wishes
      _renderMyWishes(_selfWishData.wishes, listEl, null, null,
        document.getElementById('myWishesBadge'));
    }
    // Show success
    if (doneEl) doneEl.style.display = 'block';
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to All 💌'; }
    inp.value = '';
    setTimeout(() => {
      const box = document.getElementById('replyEveryoneBox');
      if (box) box.style.display = 'none';
      if (doneEl) doneEl.style.display = 'none';
    }, 2500);
  } else {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to All 💌'; }
    alert('Could not send replies. Please try again.');
  }
}
async function _sendReply(wishId, idx) {
  const inp = document.getElementById('replyInput_' + idx);
  if (!inp) return;
  const replyText = inp.value.trim();
  if (!replyText) { inp.style.borderColor = '#ff5c7c'; inp.placeholder = 'Please write something...'; return; }

  const box = document.getElementById('replyBox_' + idx);
  const btns = box ? box.querySelectorAll('button') : [];
  btns.forEach(b => { b.disabled = true; });

  try {
    const hdrs = SB_HDRS_MIN();
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/birthday_wishes?id=eq.' + wishId,
      { method: 'PATCH', headers: hdrs, body: JSON.stringify({ reply_text: replyText }) }
    );

    if (res.ok || res.status === 204) {
      // Replace with saved reply display
      const card = document.getElementById('wishCard_' + idx);
      if (card) {
        const replyBtn = card.querySelector('button[onclick*="replyBox"]');
        if (replyBtn) replyBtn.remove();
        const replyBox = document.getElementById('replyBox_' + idx);
        if (replyBox) {
          replyBox.outerHTML = '<div style="margin-top:8px;padding:8px 12px;background:rgba(240,165,0,0.08);border-left:3px solid #f0a500;border-radius:0 8px 8px 0;">'
            + '<div style="font-size:0.72rem;font-weight:700;color:#f0a500;margin-bottom:3px;">🎂 Your Reply</div>'
            + '<div style="font-size:0.84rem;color:var(--text2);line-height:1.5;">' + replyText + '</div>'
            + '</div>';
        }
      }
      // Update cache
      if (_selfWishData.wishes) {
        const w = _selfWishData.wishes.find(x => String(x.id) === String(wishId));
        if (w) w.reply_text = replyText;
      }
    } else {
      btns.forEach(b => { b.disabled = false; });
      alert('Could not save reply. Please try again.');
    }
  } catch(e) {
    btns.forEach(b => { b.disabled = false; });
    alert('Network error. Please try again.');
  }
}

// ── Load wisher's own wish + birthday person's reply ─────────
async function _loadMyWishAndReply(toPerson, type, containerEl) {
  if (!CURRENT_USER) return;
  const today = new Date().toISOString().split('T')[0];
  const hdrs = SB_HDRS();
  const toFirstName = (toPerson.name || '').split(' ')[0];

  // Show a loading state immediately
  containerEl.innerHTML = `<div style="font-size:0.82rem;font-weight:700;color:#4e9af1;margin-bottom:4px;">✅ You've already sent a wish!</div>
    <div style="font-size:0.78rem;color:var(--muted);">Loading reply... ⏳</div>`;

  let rows = null;

  // ── Strategy 1: both emp_ids (most reliable) ──────────────────
  const fromEmpId = _getEmpId(CURRENT_USER.email || CURRENT_USER.name);
  const toEmpId   = toPerson.empId || _getEmpId(toPerson.email || toPerson.name);

  try {
    if (fromEmpId && toEmpId) {
      const url = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=wish_text,reply_text&from_emp_id=eq.${fromEmpId}&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${type}&order=created_at.desc&limit=1`;
      const res = await fetch(url, { headers: hdrs });
      if (res.ok) { const data = await res.json(); if (Array.isArray(data) && data.length) rows = data; }
    }

    // ── Strategy 2: email-based ────────────────────────────────
    if (!rows) {
      const fromEmail = encodeURIComponent((CURRENT_USER.email || '').trim());
      const toEmail   = encodeURIComponent((toPerson.email   || '').trim());
      if (fromEmail && toEmail) {
        const url2 = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=wish_text,reply_text&from_email=ilike.${fromEmail}&to_email=ilike.${toEmail}&wish_date=eq.${today}&type=eq.${type}&order=created_at.desc&limit=1`;
        const res2 = await fetch(url2, { headers: hdrs });
        if (res2.ok) { const data2 = await res2.json(); if (Array.isArray(data2) && data2.length) rows = data2; }
      }
    }

    // ── Strategy 3: fetch all today's wishes for this person, match by name ─
    if (!rows && toEmpId) {
      const url3 = `${SUPABASE_URL}/rest/v1/birthday_wishes?select=wish_text,reply_text,from_name&to_emp_id=eq.${toEmpId}&wish_date=eq.${today}&type=eq.${type}&order=created_at.desc`;
      const res3 = await fetch(url3, { headers: hdrs });
      if (res3.ok) {
        const all = await res3.json();
        if (Array.isArray(all)) {
          const myName = (CURRENT_USER.name || '').toLowerCase().trim();
          const match  = all.find(r => (r.from_name || '').toLowerCase().trim() === myName);
          if (match) rows = [match];
        }
      }
    }

    if (!rows || rows.length === 0) {
      containerEl.innerHTML = `<div style="font-size:0.82rem;font-weight:700;color:#4e9af1;">✅ You've already sent a wish!</div>`;
      return;
    }

    const { wish_text, reply_text } = rows[0];

    const replyHTML = reply_text
      ? `<div style="margin-top:9px;padding:10px 13px;background:rgba(240,165,0,0.10);border-left:3px solid #f0a500;border-radius:0 10px 10px 0;">
           <div style="font-size:0.72rem;font-weight:700;color:#f0a500;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.05em;">🎂 ${toFirstName} replied</div>
           <div style="font-size:0.86rem;color:var(--text);line-height:1.5;">${reply_text}</div>
         </div>`
      : `<div style="margin-top:6px;font-size:0.78rem;color:var(--muted);font-style:italic;">No reply yet — check back later 🕐</div>`;

    containerEl.innerHTML = `
      <div style="font-size:0.82rem;font-weight:700;color:#4e9af1;margin-bottom:6px;">✅ You've already sent a wish!</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 13px;font-size:0.85rem;color:var(--text2);line-height:1.5;">${wish_text || ''}</div>
      ${replyHTML}`;

  } catch(e) {
    containerEl.innerHTML = `<div style="font-size:0.82rem;font-weight:700;color:#4e9af1;">✅ You've already sent a wish!</div>`;
  }
}

// ── "Wish All" shortcut — first person ───────────────────────
function _openWishAllPopup(birthdays, anniversaries) {
  // Use passed args if provided, otherwise fall back to globally stored banner data
  const bdays = (birthdays && birthdays.length) ? birthdays : (window._celebBannerBdays || []);
  const annis = (anniversaries && anniversaries.length) ? anniversaries : (window._celebBannerAnnis || []);
  if (bdays.length > 0) {
    _openCelebPopup('birthday-others', bdays[0], null);
  } else if (annis.length > 0) {
    _openCelebPopup('anniversary-others', annis[0], annis[0].years);
  }
}

// ── Close popup ───────────────────────────────────────────────
function closeCelebPopup() {
  const overlay = document.getElementById('celebPopupOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  _stopConfetti();
  _celebCurrentPerson = null;
}

// ── Close My Wishes modal ──────────────────────────────────────
function closeMyWishesModal() {
  const overlay = document.getElementById('myWishesOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

// Close on backdrop click
document.addEventListener('DOMContentLoaded', function() {
  const ov = document.getElementById('celebPopupOverlay');
  if (ov) ov.addEventListener('click', function(e) {
    if (e.target === ov) closeCelebPopup();
  });
});

// ── Send wish → Supabase mein save karo (with FK) ────────────
async function sendWish() {
  const inp      = document.getElementById('celebWishInput');
  const wishText = inp ? inp.value.trim() : '';
  const wishBox  = document.getElementById('celebWishBox');
  const wishSent = document.getElementById('celebWishSent');
  const sendBtn  = document.getElementById('celebSendBtn');

  // Validate
  if (!wishText) {
    if (inp) { inp.style.borderColor = '#ff5c7c'; inp.focus(); }
    return;
  }
  if (!_celebCurrentPerson) return;

  // Disable button
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Sending...'; }

  // Detect wish type from popup title
  const titleEl   = document.getElementById('celebTitle');
  const titleTxt  = titleEl ? titleEl.textContent.toLowerCase() : '';
  const finalType = titleTxt.includes('anniversary') ? 'anniversary' : 'birthday';

  const today     = new Date().toISOString().split('T')[0];
  const fromName  = (CURRENT_USER && CURRENT_USER.name)  ? CURRENT_USER.name  : 'Colleague';
  const fromEmail = (CURRENT_USER && CURRENT_USER.email) ? CURRENT_USER.email : '';
  const toName    = _celebCurrentPerson.name  || '';
  const toEmail   = _celebCurrentPerson.email || '';

  // ── FK Emp_ids lookup ──
  const fromEmpId = _getEmpId(fromEmail || fromName) || null;
  const toEmpId   = _celebCurrentPerson.empId
                    || _getEmpId(toEmail || toName)
                    || null;


  const payload = {
    from_emp_id: fromEmpId,   // FK → Employee_details(Emp_id)
    to_emp_id:   toEmpId,     // FK → Employee_details(Emp_id)
    from_name:   fromName,    // backup display
    from_email:  fromEmail,   // backup lookup
    to_name:     toName,      // backup display
    to_email:    toEmail,     // backup lookup
    wish_text:   wishText,
    type:        finalType,
    wish_date:   today
  };

  try {
    const hdrs = SB_HDRS_MIN();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/birthday_wishes`,
      { method: 'POST', headers: hdrs, body: JSON.stringify(payload) }
    );

    if (res.ok || res.status === 201) {
      // Prevent duplicate wish today
      const wKey = _wishKey(toEmail || toName, finalType);
      localStorage.setItem(wKey, '1');
      // Warm the in-memory cache so this exact wish doesn't trigger a redundant DB call below
      _wishCheckCache[_wishCheckKey(_celebCurrentPerson, finalType)] = true;

      // Update banner button to "Wished ✅" without page reload — isolated in its
      // own try/catch so a failure or slow check here can never block the success
      // message below; the wish is already saved by this point regardless.
      try {
        const wishBannerBtn = document.getElementById('bannerWishBtn');
        if (wishBannerBtn && !wishBannerBtn.disabled) {
          // Check if all celebrants are now wished (DB-backed, authoritative)
          const allC = [
            ...(window._celebBannerBdays||[]).map(p=>({...p,celebType:'birthday'})),
            ...(window._celebBannerAnnis||[]).map(p=>({...p,celebType:'anniversary'}))
          ];
          const results = await Promise.all(allC.map(p => _hasAlreadyWished(p, p.celebType)));
          const allDone = results.every(Boolean);
          if (allDone) {
            wishBannerBtn.innerHTML = '✅ Wished!';
            wishBannerBtn.disabled = true;
            wishBannerBtn.style.background = 'linear-gradient(135deg,#00d4aa,#22c55e)';
            wishBannerBtn.style.cursor = 'default';
            wishBannerBtn.style.opacity = '0.9';
            wishBannerBtn.onclick = null;
          }
        }
      } catch (bannerErr) {}

      // Show success
      if (wishBox) wishBox.style.display = 'none';
      if (wishSent) {
        wishSent.style.display = 'block';
        wishSent.innerHTML = `✅ Your wish has been sent! 🎊<br>
          <span style="font-size:0.79rem;opacity:0.85;">— "${wishText.length > 60 ? wishText.substring(0,60)+'…' : wishText}"</span>`;
      }
      setTimeout(() => closeCelebPopup(), 2500);

    } else {
      const errText = await res.text();
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '🎉 Send Wish!'; }
      if (wishBox) {
        const e = document.createElement('div');
        e.style.cssText = 'font-size:0.80rem;color:#ff5c7c;margin-top:6px;padding:8px;border-radius:8px;background:rgba(255,92,124,0.1);border:1px solid rgba(255,92,124,0.25);';
        e.textContent = '⚠️ Error: ' + (errText.length < 120 ? errText : 'Table was not created. Run the SQL below.');
        wishBox.appendChild(e);
        setTimeout(() => e.remove(), 5000);
      }
    }
  } catch(e) {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '🎉 Send Wish!'; }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFETTI ENGINE (lightweight canvas-based)
// ═══════════════════════════════════════════════════════════════
let _confettiFrame = null;
let _confettiParts = [];

function _startConfetti(isBirthday) {
  const canvas = document.getElementById('celebConfetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth  || 480;
  canvas.height = canvas.offsetHeight || 400;

  const colors = isBirthday
    ? ['#f0a500','#ffcc44','#ff5c7c','#00d4aa','#4e9af1','#ff9f43','#ff6b9d']
    : ['#4e9af1','#00d4aa','#f0a500','#b8e0ff','#48dbfb'];

  _confettiParts = Array.from({length: 60}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    w: 7 + Math.random() * 9,
    h: 5 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    speed: 1.2 + Math.random() * 2.2,
    angle: Math.random() * 360,
    spin:  (Math.random() - 0.5) * 4,
    swing: (Math.random() - 0.5) * 1.5,
    opacity: 0.7 + Math.random() * 0.3
  }));

  _stopConfetti();
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _confettiParts.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.y     += p.speed;
      p.x     += p.swing;
      p.angle += p.spin;
      if (p.y > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }
    });
    _confettiFrame = requestAnimationFrame(draw);
  }
  draw();
}

function _stopConfetti() {
  if (_confettiFrame) { cancelAnimationFrame(_confettiFrame); _confettiFrame = null; }
  const canvas = document.getElementById('celebConfetti');
  if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
}

// ═══════════════════════════════════════════════════════════════
// HOOK INTO showPortal + MULTIPLE FALLBACK TRIGGERS
// ═══════════════════════════════════════════════════════════════
(function() {
  // 1. Wrap showPortal so celebrations load whenever portal shows
  const _origSP = window.showPortal;
  window.showPortal = function() {
    if (_origSP) _origSP.apply(this, arguments);
    // Trigger after portal renders (600ms is enough for DOM)
    setTimeout(function() {
      if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        loadCelebrations();
      }
    }, 600);
  };

  // 2. Fallback: if localStorage session exists, portal loads on window.load
  //    The load handler calls the original showPortal by name — which now points
  //    to our override because we assigned window.showPortal. But just in case,
  //    also try via MutationObserver watching portal visibility.
  const _celebObs = new MutationObserver(function() {
    const portal = document.getElementById('mainPortal');
    if (portal && portal.classList.contains('visible')) {
      if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        setTimeout(loadCelebrations, 800);
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    const portal = document.getElementById('mainPortal');
    if (portal) {
      _celebObs.observe(portal, { attributes: true, attributeFilter: ['class'] });
    }
    // 3. Extra fallback: check 3 seconds after page load
    setTimeout(function() {
      const p2 = document.getElementById('mainPortal');
      if (p2 && p2.classList.contains('visible') &&
          typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
        loadCelebrations();
      }
    }, 3000);
  });
})();
