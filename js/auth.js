// Section: Auth & Permissions (doLogin, doLogout, showPortal, PERMISSIONS)
const _sbAuth = window.supabase.createClient(
  'https://rramdtpabwjsndgkohbi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyYW1kdHBhYndqc25kZ2tvaGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDQ4ODUsImV4cCI6MjA5MTQ4MDg4NX0.hpdTOkhRrbqmbPM6VJWEtz2oEjkeXAjYJQS9rgzheec'
);

// ── Auth state listener (token refresh, logout detect) ──
_sbAuth.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    CURRENT_USER = null;
    _currentToken = SUPABASE_ANON; // reset to anon on logout
  }
  if (session?.access_token) {
    _currentToken = session.access_token; // ✅ user JWT save — RLS authenticated policies kaam karengi
  }
  if (event === 'TOKEN_REFRESHED') {
    console.log('✅ Supabase session refreshed');
  }
});

// Cache for pre-fetched user list
let CURRENT_USER = null;
let PERMISSIONS  = {};   // populated from Python backend after login
const _PAPI = 'https://knowlege-based-portal-production.up.railway.app';
function warmupAPIs(){
  // Warm-up ping to Google Apps Scripts (fire & forget)
  [L_URL,C_URL].forEach(url=>{
    fetch(url+'?ping=1',{method:'GET',mode:'cors'}).catch(()=>{});
  });
}

window.addEventListener('load', async function(){
  try {
    const { data: { session } } = await _sbAuth.auth.getSession();
    if (session) {
      _currentToken = session.access_token; // ✅ page reload pe bhi token set karo
      await _loadUserProfile(session.user);
      return;
    }
  } catch(e) { console.warn('Session check error:', e); }
  // Always warm up APIs in background
  warmupAPIs();
});

function togglePass(){
  const p=document.getElementById('loginPass');
  const e=document.getElementById('eyeIcon');
  if(p.type==='password'){p.type='text';e.textContent='🙈';}
  else{p.type='password';e.textContent='👁️';}
}

// Fallback — builds PERMISSIONS from rawRole if Python backend unreachable
function _buildFallbackPermissions(rawRole) {
  const r       = (rawRole || 'employee').toLowerCase();
  const isOwner = r === 'owner' || r === 'managing director';
  const isMIS   = r === 'mis';
  const isPC    = r === 'pc' || r === 'executive assistant' || r === 'ea';
  const hasAll  = isOwner || isMIS || isPC;
  return {
    can_view_leads:         String(hasAll),
    can_view_enterprise:    String(hasAll),
    can_view_collection:    String(hasAll),
    can_view_fms:           String(hasAll),
    can_view_ims:           String(isMIS || isPC || isOwner),
    can_view_crm:           String(isOwner || isPC),
    can_view_activitylog:   String(isOwner || isMIS),
    can_view_announcements: 'true',
    can_post_announcements: String(isMIS),
    can_upload_files:       String(isMIS),
    can_upload_quiz:        String(isMIS),
    can_download_video:     String(isOwner || isMIS),
    checklist_scope:        hasAll ? 'all' : 'own',
    can_view_open_roles:        'true',
    can_view_my_referrals:      'true',
    can_view_referral_pipeline: String(isOwner || isMIS),
    can_post_referral_role:     String(isOwner || isMIS),
  };
}

// ── Load user profile — Auth + Data both from Supabase Employee_details ──
async function _loadUserProfile(authUser) {
  try {
    let empData = null;

    // Supabase Employee_details table se email match karke data lo
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/Employee_details?select=Employee_name,Employee_Dept,Location,Email_Id&Email_Id=ilike.${encodeURIComponent(authUser.email)}&limit=1`,
        { headers: SB_HDRS() }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        empData = rows[0];
      }
    } catch(e) {
      console.warn('Supabase Employee_details fetch failed:', e);
    }

    const _rawR = String(
      (empData && empData['Employee_Dept']) || 'employee'
    ).trim().toLowerCase();
    const _fullAccessRoles = ['managing director','mis','pc','executive assistant','ea'];

    CURRENT_USER = {
      email:          authUser.email,
      role:           _fullAccessRoles.includes(_rawR) ? 'owner' : 'employee',
      rawRole:        _rawR === 'managing director' ? 'owner'
                      : _rawR === 'ea' ? 'executive assistant'
                      : _rawR,
      name:           empData
                        ? String(empData['Employee_name'] || authUser.email.split('@')[0])
                        : authUser.email.split('@')[0],
      location:       empData
                        ? String(empData['Location'] || '').trim()
                        : ''
    };

    // ── Fetch permissions from Python backend ──────────────
    const _PAPI = 'https://knowlege-based-portal-production.up.railway.app';
    try {
      const _pr = await fetch(`${_PAPI}/api/permissions?email=${encodeURIComponent(authUser.email)}`);
      if (_pr.ok) {
        const _pd = await _pr.json();
        PERMISSIONS = _pd.permissions || {};
        if (_pd.rawRole) CURRENT_USER.rawRole = _pd.rawRole;
        if (_pd.role)    CURRENT_USER.role    = _pd.role === 'owner' ? 'owner' : 'employee';
      } else {
        PERMISSIONS = _buildFallbackPermissions(CURRENT_USER.rawRole);
      }
    } catch(_pe) {
      console.warn('Permissions fetch failed, using fallback:', _pe);
      PERMISSIONS = _buildFallbackPermissions(CURRENT_USER.rawRole);
    }

    // Show/hide Purchase Request button based on vendor_access permission
    if(typeof _vrCheckBtnAccess==='function') _vrCheckBtnAccess();

    showPortal();
    warmupAPIs();
    _actLoginTime = Date.now();
    _fetchAndCacheEmpId().then(() => {
      logActivity({
        event_type:   'login',
        event_detail: `User logged in: ${CURRENT_USER.name || CURRENT_USER.email}`,
        page_name:    'home',
        metadata:     { role: CURRENT_USER.rawRole, location: CURRENT_USER.location }
      });
    });
    setTimeout(maybeLoadHolidayCard, 800);

  } catch(e) {
    console.error('Profile load error:', e);
    // Fallback — basic info se portal dikhao
    CURRENT_USER = {
      email:    authUser.email,
      role:     'employee',
      rawRole:  'employee',
      name:     authUser.email.split('@')[0],
      location: ''
    };
    PERMISSIONS = _buildFallbackPermissions('employee');
    showPortal();
    warmupAPIs();
  }
}

async function doLogin(){
  const email=document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass=document.getElementById('loginPass').value.trim();
  const btn=document.getElementById('loginBtn');
  const err=document.getElementById('loginErr');

  if(!email||!pass){
    err.style.display='block';
    err.textContent='⚠️ Please enter both email and password!';
    return;
  }

  btn.innerHTML='<span class="lp-btn-text"><span>Signing in…</span></span>';
  btn.style.opacity='0.8';
  btn.disabled=true;
  err.style.display='none';

  const resetBtn=()=>{
    btn.innerHTML='<span class="lp-btn-text"><span>Sign In</span><svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    btn.style.opacity='1';
    btn.disabled=false;
  };

  try {
    // ✅ Supabase Auth — secure, hashed passwords
    const { data, error } = await _sbAuth.auth.signInWithPassword({
      email: email,
      password: pass
    });

    if (error) {
      err.style.display='block';
      if (error.message.includes('Invalid login') || error.message.includes('invalid_grant')) {
        err.textContent = '❌ Incorrect email or password. Please try again.';
      } else if (error.message.includes('Email not confirmed')) {
        err.textContent = '📧 Please confirm your email address before logging in.';
      } else {
        err.textContent = '❌ Login failed: ' + error.message;
      }
      resetBtn();
      return;
    }

    // Login successful — token pehle set karo, phir profile load karo
    _currentToken = data.session.access_token; // ✅ PEHLE token set — RLS pass hogi
    await _loadUserProfile(data.user);

  } catch(e) {
    err.style.display='block';
    err.innerHTML='⚠️ Network error.<br><small style="opacity:0.8">Please check your internet connection and try again.</small>';
    resetBtn();
  }
}

function showGreetingAnimation(name){
  const overlay=document.createElement('div');
  overlay.id='greetingOverlay';
  overlay.style.cssText=`
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.85);z-index:99999;
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:12px;
    animation:greetFadeIn 0.4s ease;
  `;
  overlay.innerHTML=`
    <div id="greetText" style="
      font-size:clamp(2rem,7vw,4rem);font-weight:800;
      color:#f0a500;text-align:center;padding:0 20px;
      font-family:'DM Sans',sans-serif;letter-spacing:1px;
      animation:greetBounce 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;
      text-shadow:0 0 40px rgba(240,165,0,0.6),0 0 80px rgba(240,165,0,0.3);
    ">👋 Hello, ${name}!</div>
    <div style="
      font-size:clamp(0.9rem,3vw,1.2rem);color:rgba(240,165,0,0.7);
      font-family:'DM Sans',sans-serif;letter-spacing:2px;
      animation:greetBounce 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.4s both;
    ">Welcome back ✨</div>
  `;
  // Inject keyframes
  if(!document.getElementById('greetKeyframes')){
    const style=document.createElement('style');
    style.id='greetKeyframes';
    style.textContent=`
      @keyframes greetFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes greetBounce{from{opacity:0;transform:scale(0.5) translateY(30px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @keyframes greetFadeOut{from{opacity:1}to{opacity:0}}
    `;
    document.head.appendChild(style);
  }
  document.body.appendChild(overlay);
  // Auto remove after 2.2s with fade out
  setTimeout(()=>{
    overlay.style.animation='greetFadeOut 0.5s ease forwards';
    setTimeout(()=>overlay.remove(),500);
  },2200);
}

function showPortal(){
  document.getElementById('loginPage').style.display='none';
  const portal=document.getElementById('mainPortal');
  portal.classList.add('visible');
  // Sync profile UI (sidebar + bottom nav) — synchronous so name shows immediately
  _syncProfileUI();
  // Init browser history so back button goes to home, not logout
  initHistory();
  // Update home welcome text with user name
  const welcomeEl=document.getElementById('homeWelcomeText');
  if(welcomeEl){
    const firstName=(CURRENT_USER.name||CURRENT_USER.email.split('@')[0]).split(' ')[0];
    welcomeEl.innerHTML=`Welcome, <span class="hw-name">${firstName}!</span>`;
  }
  // Show greeting animation
  showGreetingAnimation(CURRENT_USER.name||CURRENT_USER.email.split('@')[0]);
  // Add user info + logout to sidebar
  const sb=document.getElementById('sidebarBottom');
  if(sb){
    const roleLabel = CURRENT_USER.rawRole==='owner'?'👑 Managing Director':CURRENT_USER.rawRole==='mis'?'📊 MIS':CURRENT_USER.rawRole==='pc'?'💼 PC':CURRENT_USER.rawRole==='executive assistant'?'🤝 Executive Assistant':CURRENT_USER.role==='owner'?'👑 Managing Director':'👤 '+((CURRENT_USER.rawRole&&CURRENT_USER.rawRole!=='employee')?CURRENT_USER.rawRole.charAt(0).toUpperCase()+CURRENT_USER.rawRole.slice(1):'Employee');
    const avColor = CURRENT_USER.role==='owner'?'#f0a500':'#00d4aa';
    const avBg    = CURRENT_USER.role==='owner'?'rgba(240,165,0,0.2)':'rgba(0,212,170,0.2)';
    sb.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div id="sidebarUserAvatar" style="background:${avBg};color:${avColor};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.91rem;font-weight:700;flex-shrink:0;overflow:hidden;">${(CURRENT_USER.name||CURRENT_USER.email)[0].toUpperCase()}</div>
        <div style="overflow:hidden;flex:1;">
          <div class="user-name-text" style="font-size:0.82rem;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${CURRENT_USER.name||CURRENT_USER.email.split('@')[0]}</div>
          <div style="font-size:0.71rem;color:var(--text2);">${roleLabel}</div>
        </div>
      </div>
      <button onclick="doLogout()" style="width:100%;background:rgba(255,92,124,0.1);border:1px solid rgba(255,92,124,0.25);color:#ff5c7c;border-radius:8px;padding:8px;font-size:0.82rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all 0.2s;" onmouseover="this.style.background='rgba(255,92,124,0.25)'" onmouseout="this.style.background='rgba(255,92,124,0.1)'">
        🚪 Logout
      </button>`;
  }
  // Populate mobile bottom nav user profile button
  const bnProf=document.getElementById('bnUserProfile');
  if(bnProf){
    const isO3=CURRENT_USER.role==='owner';
    const uN3=CURRENT_USER.name||CURRENT_USER.email.split('@')[0];
    const rr3=CURRENT_USER.rawRole||'';
    let rl3=isO3?'👑 Managing Director':'👤 Employee';
    if(rr3==='owner') rl3='👑 Managing Director';
    else if(rr3==='mis') rl3='📊 MIS';
    else if(rr3==='pc') rl3='💼 PC';
    else if(rr3==='support') rl3='🎧 Support';
    else if(rr3==='sales') rl3='📈 Sales';
    else if(rr3&&rr3!=='employee') rl3='👤 '+rr3.charAt(0).toUpperCase()+rr3.slice(1);
    const avBg3=isO3?'rgba(240,165,0,0.18)':'rgba(0,212,170,0.18)';
    const avClr3=isO3?'#f0a500':'#00d4aa';
    const avBdr3=isO3?'rgba(240,165,0,0.5)':'rgba(0,212,170,0.5)';
    const avL3=uN3[0].toUpperCase();
    // Bottom nav button avatar + name
    const ba3=document.getElementById('bnpAvatar');
    if(ba3){ba3.style.background=avBg3;ba3.style.color=avClr3;ba3.style.borderColor=avBdr3;ba3.textContent=avL3;}
    const bn3=document.getElementById('bnpName');
    if(bn3) bn3.textContent=uN3;
    // Popup avatar + name + role
    const pa3=document.getElementById('bupAvatar');
    if(pa3){pa3.style.background=avBg3;pa3.style.color=avClr3;pa3.style.borderColor=avBdr3;pa3.textContent=avL3;}
    const pn3=document.getElementById('bupName');
    if(pn3) pn3.textContent=uN3;
    const pr3=document.getElementById('bupRole');
    if(pr3) pr3.textContent=rl3;
  }
  // Sync theme button label after portal shows
  const isLight = document.body.classList.contains('light-mode');
  const sb2 = document.getElementById('sidebarThemeBtn');
  if(sb2) sb2.textContent = (isLight ? '☀️ Light Mode' : '🌙 Dark Mode');
  const mobBtn2 = document.getElementById('mobThemeBtn');
  if(mobBtn2) mobBtn2.textContent = (isLight ? '☀️ Light' : '🌙 Dark');
  // Employee restrictions
  if(CURRENT_USER.role!=='owner'){restrictEmployee();}
  // Upload buttons — sirf MIS aur Managing Director ke liye dikhao
  _applyUploadVisibility();
  // IMS nav — sirf MIS, Managing Director, PC ke liye dikhao
  _applyIMSNavVisibility();
  _applyCRMNavVisibility();
  _applyMappingNavVisibility();
  _applyEnterpriseNavVisibility();

  _applyFinanceNavVisibility();
  // Activity Log nav — sirf MIS aur Managing Director ke liye
  _applyActLogNavVisibility();
  // Access Control nav — only for owner or MIS role
  const _acpNav = document.getElementById('nav-adminperms');
  if (_acpNav) {
    const _rawRole = String((CURRENT_USER && (CURRENT_USER.rawRole || CURRENT_USER.role)) || '').toLowerCase().trim();
    _acpNav.style.display = (_rawRole === 'owner' || _rawRole === 'mis') ? '' : 'none';
  }
  // Fetch employee profile photo from Supabase → home page pe dikhao
  fetchUserProfilePhoto();
  // Performer of the Month cards load karo
  loadPerformers();
  // New Joiners cards load karo
  loadNewJoiners();
  // Pre-fetch all dashboard data in background
  setTimeout(prefetchAllData, 0);
}

function restrictEmployee(){
  // Nav items — controlled by PERMISSIONS from database
  const navPermMap = {
    'nav-leads':      'can_view_leads',
    'nav-collection': 'can_view_collection',
    'nav-fms':        'can_view_fms',
    'bn-leads':       'can_view_leads',
    'bn-collection':  'can_view_collection',
    'bn-fms':         'can_view_fms',
    'mm-leads':       'can_view_leads',
    'mm-collection':  'can_view_collection',
    'mm-fms':         'can_view_fms',
  };
  Object.entries(navPermMap).forEach(([id, perm]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (PERMISSIONS[perm] === 'true') ? '' : 'none';
  });

  // Home page dashboard cards — show/hide based on permissions
  document.querySelectorAll('#panel-home .home-card:not(.disabled)').forEach(card => {
    const txt = card.textContent;
    let show  = true;
    if (txt.includes('Lead Tracking') && PERMISSIONS.can_view_leads      !== 'true') show = false;
    if (txt.includes('Collection')    && PERMISSIONS.can_view_collection  !== 'true') show = false;
    if (txt.includes('FMS')           && PERMISSIONS.can_view_fms         !== 'true') show = false;
    if (txt.includes('IMS')           && PERMISSIONS.can_view_ims         !== 'true') show = false;
    card.style.display = show ? '' : 'none';
  });

  if (CURRENT_USER) window.EMPLOYEE_EMAIL = CURRENT_USER.email;

  // Referral Programme nav item — hide entirely if user has none of the 4 referral permissions
  if (typeof _applyReferralNavVisibility === 'function') _applyReferralNavVisibility();
}

// ── Upload & Delete button visibility — controlled by PERMISSIONS ──────────
function _applyUploadVisibility() {
  const canUpload = PERMISSIONS.can_upload_files === 'true';
  if (!canUpload) {
    // Hide every upload button
    document.querySelectorAll('button').forEach(btn => {
      const oc = btn.getAttribute('onclick') || '';
      if (btn.textContent.trim() === 'Upload' || oc.includes('openUploadModal')) {
        btn.style.display = 'none';
      }
    });
    // Hide delete buttons (cn-del-btn class + any button calling confirmDelete*)
    document.querySelectorAll('.cn-del-btn').forEach(btn => btn.style.display = 'none');
    // Also intercept dynamically-rendered delete buttons via MutationObserver
    const _hideDelBtns = (root) => {
      (root || document).querySelectorAll('button').forEach(btn => {
        const oc = btn.getAttribute('onclick') || '';
        if (oc.includes('confirmDeleteCard') || oc.includes('confirmDeleteFile') || oc.includes('confirmDeleteTraining')) {
          btn.style.display = 'none';
        }
      });
    };
    _hideDelBtns();
    // Watch for dynamically added cards (CN loads async)
    const _obs = new MutationObserver(() => _hideDelBtns());
    _obs.observe(document.getElementById('mainPortal') || document.body, { childList: true, subtree: true });
  }
}

function doLogout(){
  try {
    const totalSecs = Math.round((Date.now() - _actLoginTime) / 1000);
    const pageSecs  = Math.round((Date.now() - _actPageStart) / 1000);
    if (pageSecs > 30) logActivity({ event_type:'page_view', event_detail:'Last page: '+_actPageName, page_name:_actPageName, duration_seconds:pageSecs }); // 30s threshold — matches _actOnPageSwitch
    _actStopVideoTracking();
    logActivity({ event_type:'logout', event_detail:'User logged out: '+(CURRENT_USER?(CURRENT_USER.name||CURRENT_USER.email):''),
                  session_duration_seconds:totalSecs, logout_at: new Date().toISOString() });
  } catch(e) {}
  setTimeout(async ()=>{ 
    try { await _sbAuth.auth.signOut(); } catch(e) {}
    localStorage.removeItem('aditiUser'); 
    localStorage.removeItem('aditiLoginTime'); 
    CURRENT_USER=null; 
    location.reload(); 
  }, 400);
}


// ── Supabase Config ──
// ── Global Supabase header helpers (defined early — see initHistory block above) ──

function _canUploadQuiz() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  return PERMISSIONS.can_upload_quiz === 'true';
}



