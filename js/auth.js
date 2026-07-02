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

function toggleTheme(){
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('aditiTheme', isLight ? 'light' : 'dark');
  const icon = isLight ? '☀️' : '🌙';
  const label = isLight ? 'Light Mode' : 'Dark Mode';
  const loginBtn = document.getElementById('loginThemeBtn');
  const sidebarBtn = document.getElementById('sidebarThemeBtn');
  const mobBtn = document.getElementById('mobThemeBtn');
  if(loginBtn) loginBtn.textContent = icon + ' ' + label;
  if(sidebarBtn) sidebarBtn.textContent = icon + ' ' + label;
  if(mobBtn) mobBtn.textContent = icon + ' ' + (isLight ? 'Light' : 'Dark');
  // Redraw all charts so axis/label colors update immediately
  // First destroy existing charts, then re-render with new colors
  try{
    if(typeof L!=='undefined'&&L.length){
      Object.values(Lch||{}).forEach(c=>c&&c.destroy&&c.destroy()); Lch={};
      if(typeof lRenderCharts==='function') lRenderCharts();
      if(typeof lRenderLB==='function') lRenderLB();
    }
  }catch(e){}
  try{
    if(typeof C!=='undefined'&&C.length){
      Object.values(Cch||{}).forEach(c=>c&&c.destroy&&c.destroy()); Cch={};
      const cD=typeof cGetFiltered==='function'?cGetFiltered():(C||[]);
      if(typeof cRenderCharts==='function') cRenderCharts(cD);
      if(typeof cRenderLB==='function') cRenderLB(cD);
    }
  }catch(e){}
  try{
    if(typeof fmsCharts!=='undefined'&&Object.keys(fmsCharts||{}).length){
      Object.values(fmsCharts).forEach(c=>c&&c.destroy&&c.destroy()); fmsCharts={};
      if(typeof fmsRenderCharts==='function') fmsRenderCharts();
    }
  }catch(e){}
  try{
    if(typeof tCharts!=='undefined'&&Object.keys(tCharts||{}).length){
      Object.values(tCharts).forEach(c=>c&&c.destroy&&c.destroy()); tCharts={};
      if(typeof tRenderCharts==='function') tRenderCharts();
    }
  }catch(e){}
}

// Apply saved theme on load
(function(){
  const saved = localStorage.getItem('aditiTheme');
  if(saved === 'dark'){
    // Dark mode only if explicitly saved as dark
  } else {
    // Default is light mode
    document.body.classList.add('light-mode');
    const loginBtn = document.getElementById('loginThemeBtn');
    if(loginBtn) loginBtn.textContent = '☀️ Light Mode';
    const mobBtn = document.getElementById('mobThemeBtn');
    if(mobBtn) mobBtn.textContent = '☀️ Light';
  }
})();

/* ══ ABOUT ORGANISATION — tab switcher ══ */
function switchAbout(tab){
  document.querySelectorAll('.about-section').forEach(s=>s.style.display='none');
  document.querySelectorAll('#aboutTabs .about-tab').forEach(t=>t.classList.remove('active'));
  var el=document.getElementById('about-'+tab);
  if(el)el.style.display='block';
  var idx={'overview':0,'locations':1,'milestones':2,'certifications':3}[tab];
  if(idx===undefined)idx=0;
  var tabs=document.querySelectorAll('#aboutTabs .about-tab');
  if(tabs[idx])tabs[idx].classList.add('active');
}

/* ── MOBILE MENU SHEET ── */
function toggleMobMenu(){
  var sheet=document.getElementById('mobMenuSheet');
  var overlay=document.getElementById('mobMenuOverlay');
  if(sheet.style.display==='none'||sheet.style.display===''){
    sheet.style.display='block';
    overlay.style.display='block';
    requestAnimationFrame(function(){
      sheet.style.transform='translateY(0)';
    });
  } else {
    closeMobMenu();
  }
}
function closeMobMenu(){
  var sheet=document.getElementById('mobMenuSheet');
  var overlay=document.getElementById('mobMenuOverlay');
  sheet.style.transform='translateY(100%)';
  setTimeout(function(){
    sheet.style.display='none';
    overlay.style.display='none';
  },280);
}
function toggleMMDash(){
  var sub=document.getElementById('mmDashSub');
  var arrow=document.getElementById('mmDashArrow');
  if(sub.style.display==='none'||sub.style.display===''){
    sub.style.display='block';
    arrow.style.transform='rotate(180deg)';
  } else {
    sub.style.display='none';
    arrow.style.transform='rotate(0deg)';
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
function mobMenuGo(panel){
  // update active highlight in mobile menu
  document.querySelectorAll('.mm-nav-item').forEach(function(el){el.classList.remove('mm-active');});
  var target=document.getElementById('mm-'+panel);
  if(target) target.classList.add('mm-active');
  closeMobMenu();
  switchDB(panel);
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

// ── Supabase Config ──
// ── Global Supabase header helpers (defined early — see initHistory block above) ──

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY TRACKING SYSTEM
   Tracks: login, logout, page views, card opens/closes, video watching
   Table: activity_logs
   Columns needed in Supabase:
     emp_id text, event_type text, event_detail text, session_id text,
     device text, page_name text, card_name text, duration_seconds int,
     video_title text, video_watch_seconds int, video_watch_percent int,
     file_name text, logout_at timestamptz, session_duration_seconds int,
     metadata jsonb, created_at timestamptz (default now())
═══════════════════════════════════════════════════════════════════════════ */

const _ACT_SESSION_ID = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
let _actEmpId    = null; // numeric Emp_id (FK) — fetched after login
let _actNameMap      = {};  // email (lowercase) → Employee_name cache
let _actEmpIdNameMap = {};  // numeric Emp_id → Employee_name cache

// Fetch Employee names from Employee_details using email list (for table display)
// Fetch Employee names using emp_id (numeric FK) — reliable since Email_Id
// in Employee_details may differ from the login email stored in activity_logs
async function _fetchEmpNames(rows) {
  // Collect unique numeric emp_ids not yet in cache
  const empIds = [...new Set(rows.map(r => r.emp_id).filter(id => id && typeof id === 'number'))];
  const needIds  = empIds.filter(id => !_actEmpIdNameMap[id]);

  // Also try Email_Id lookup for any rows that have employee_email
  const emails  = [...new Set(rows.map(r => (r.employee_email||'').toLowerCase()).filter(Boolean))];
  const needEmails = emails.filter(e => !_actNameMap[e]);

  const fetches = [];

  if (needIds.length) {
    const idFilter = needIds.join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id,Employee_name,Email_Id&Emp_id=in.(${idFilter})`, { headers: SB_HDRS() })
        .then(r => r.ok ? r.json() : [])
        .then(arr => arr.forEach(r => {
          if (r.Emp_id) _actEmpIdNameMap[r.Emp_id] = r.Employee_name || '';
          // Also cache by email if available
          const em = (r.Email_Id || '').toLowerCase().trim();
          if (em && r.Employee_name) _actNameMap[em] = r.Employee_name;
        }))
        .catch(() => {})
    );
  }

  if (needEmails.length) {
    const orFilter = needEmails.map(e => `Email_Id.ilike.${encodeURIComponent(e)}`).join(',');
    fetches.push(
      fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=Email_Id,Employee_name&or=(${orFilter})`, { headers: SB_HDRS() })
        .then(r => r.ok ? r.json() : [])
        .then(arr => arr.forEach(r => {
          const key = (r.Email_Id || '').toLowerCase().trim();
          if (key && r.Employee_name) _actNameMap[key] = r.Employee_name;
        }))
        .catch(() => {})
    );
  }

  await Promise.all(fetches);
}

// Helper: get display name for a row (tries emp_id FK first, then email lookup)
function _getEmpDisplayName(row) {
  if (row.emp_id && _actEmpIdNameMap[row.emp_id]) return _actEmpIdNameMap[row.emp_id];
  const email = (row.employee_email || '').toLowerCase();
  if (email && _actNameMap[email]) return _actNameMap[email];
  if (row.employee?.Employee_name) return row.employee.Employee_name;
  return email ? email.split('@')[0] : '—';
}

// Fetch numeric Emp_id after login (emp_id column is now int FK)
async function _fetchAndCacheEmpId() {
  if (_actEmpId || !CURRENT_USER?.email) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?select=Emp_id&Email_Id=ilike.${encodeURIComponent(CURRENT_USER.email)}&limit=1`,
      { headers: SB_HDRS() }
    );
    if (res.ok) {
      const arr = await res.json();
      if (arr.length) {
        _actEmpId = arr[0].Emp_id;
        // CURRENT_USER mein bhi store karo taaki _canUploadQuiz use kar sake
        if (CURRENT_USER) CURRENT_USER.empId = _actEmpId;
        localStorage.setItem('aditiUser', JSON.stringify(CURRENT_USER));
      }
    }
  } catch(e) {}
}
let _actLoginTime     = Date.now();
let _actPageName      = 'home';
let _actPageStart     = Date.now();
let _actCardName      = null;
let _actCardStart     = null;
let _actVideoTitle    = null;
let _actVideoStart    = null;
let _actVideoEl       = null; // currently tracked <video> element

// Core logger — fire-and-forget, never disrupts UI
async function logActivity(data) {
  try {
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const fullPayload = {
      emp_id:                  _actEmpId || undefined,               // numeric FK (int)
      employee_email:          CURRENT_USER.email || null,           // new email column
      event_type:              data.event_type              || 'unknown',
      event_detail:            data.event_detail            || '',
      session_id:              _ACT_SESSION_ID,
      device:                  isMobile ? 'mobile' : 'desktop',
      page_name:               data.page_name               || _actPageName || '',
      card_name:               data.card_name               || null,
      duration_seconds:        data.duration_seconds        ?? null,
      video_title:             data.video_title             || null,
      video_watch_seconds:     data.video_watch_seconds     ?? null,
      video_watch_percent:     data.video_watch_percent     ?? null,
      file_name:               data.file_name               || null,
      logout_at:               data.logout_at               || null,
      session_duration_seconds:data.session_duration_seconds ?? null,
      metadata:                data.metadata || null
    };
    // Remove null/undefined values to avoid column errors
    Object.keys(fullPayload).forEach(k => { if (fullPayload[k] === null || fullPayload[k] === undefined) delete fullPayload[k]; });

    const hdrs = {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    // Try full payload first
    const res = await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(fullPayload)
    });

    // Fallback to basic columns if new columns don't exist yet
    if (!res.ok) {
      const basicPayload = {
        emp_id:       fullPayload.emp_id || undefined,   // numeric FK
        employee_email: fullPayload.employee_email || undefined,
        event_type:   fullPayload.event_type,
        event_detail: [
          fullPayload.event_detail,
          fullPayload.page_name   ? 'page:'+fullPayload.page_name   : '',
          fullPayload.card_name   ? 'card:'+fullPayload.card_name   : '',
          fullPayload.video_title ? 'video:'+fullPayload.video_title : '',
          fullPayload.duration_seconds != null ? 'dur:'+fullPayload.duration_seconds+'s' : ''
        ].filter(Boolean).join(' | '),
        session_id: fullPayload.session_id,
        device:     fullPayload.device
      };
      fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
        method: 'POST', headers: hdrs, body: JSON.stringify(basicPayload)
      }).catch(()=>{});
    }
  } catch(e) { /* silent fail — never break UI */ }
}

// Called on every panel switch — logs previous page time, starts new page timer
function _actOnPageSwitch(newPage) {
  const secs = Math.round((Date.now() - _actPageStart) / 1000);
  if (_actPageName && secs > 30) { // Skip page_view under 30s — reduces noise
    logActivity({ event_type:'page_view', event_detail:`Visited: ${_actPageName}`, page_name:_actPageName, duration_seconds:secs });
  }
  _actPageName  = newPage;
  _actPageStart = Date.now();
  _actStopVideoTracking(); // stop video tracking on page leave
}

// Called when a card or overlay opens
function _actOnCardOpen(cardName) {
  _actOnCardClose();
  _actCardName  = cardName;
  _actCardStart = Date.now();
  // card_open not logged — generated too many rows
}

// Called when a card or overlay closes
function _actOnCardClose() {
  // card_close not logged — just reset state
  _actCardName  = null;
  _actCardStart = null;
}

// Attach video tracking to a <video> element
function _actTrackVideo(videoEl, title) {
  if (!videoEl) return;
  _actStopVideoTracking();
  _actVideoEl    = videoEl;
  _actVideoTitle = title || 'Unknown Video';
  _actVideoStart = null;

  const onPlay = () => {
    _actVideoStart = Date.now();
    logActivity({ event_type:'video_play', event_detail:`Playing: ${_actVideoTitle}`, video_title:_actVideoTitle });
  };
  const onPause = () => {
    // video_pause not logged — only track play and complete
    _actVideoStart = null;
  };
  const onEnded = () => {
    const secs = videoEl.duration ? Math.round(videoEl.duration) : null;
    logActivity({ event_type:'video_complete', event_detail:`Completed: ${_actVideoTitle}`,
                  video_title:_actVideoTitle, video_watch_seconds:secs, video_watch_percent:100 });
    _actVideoStart = null;
  };

  videoEl._actHandlers = { onPlay, onPause, onEnded };
  videoEl.addEventListener('play',  onPlay);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('ended', onEnded);
}

// Detach video tracking from previous element
function _actStopVideoTracking() {
  if (!_actVideoEl) return;
  if (_actVideoEl._actHandlers) {
    _actVideoEl.removeEventListener('play',  _actVideoEl._actHandlers.onPlay);
    _actVideoEl.removeEventListener('pause', _actVideoEl._actHandlers.onPause);
    _actVideoEl.removeEventListener('ended', _actVideoEl._actHandlers.onEnded);
    delete _actVideoEl._actHandlers;
  }
  // Left-video pause not logged — reduces noise
  _actVideoStart = null;
  _actVideoEl    = null;
  _actVideoTitle = null;
  _actVideoStart = null;
}

// Log file open
function _actOnFileOpen(fileName, cardName) {
  logActivity({ event_type:'file_open', event_detail:`Opened file: ${fileName}`,
                card_name: cardName || _actCardName || '', file_name: fileName });
}

// Log before page unload (best effort)
window.addEventListener('beforeunload', () => {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  const totalSecs = Math.round((Date.now() - _actLoginTime) / 1000);
  _actStopVideoTracking();
  // sendBeacon can't send auth headers — use fetch with keepalive instead (RLS ke liye zaroori)
  fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      emp_id: CURRENT_USER.email || CURRENT_USER.name,
      event_type: 'page_unload', event_detail: 'Browser tab closed / navigated away',
      session_id: _ACT_SESSION_ID, device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'desktop',
      page_name: _actPageName, session_duration_seconds: totalSecs,
      logout_at: new Date().toISOString(), metadata: { unload: true }
    })
  }).catch(()=>{});
});

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

// Quiz admin access — email (Hemant & Krishna) + Emp_id (Pranali & Saajan Jain)
const _QUIZ_UPLOAD_EMAILS = [
  'mis@adititracking.com',   // Hemant
  'mis1@adititracking.com',  // Krishna
];
// Emp_id se access — Chirag (1), Hemant (2), Krishna (3), Pranali (15), Saajan Jain (19), Hetal (34), Savita (35)
const _QUIZ_UPLOAD_EMP_IDS = [1, 2, 3, 15, 19, 34, 35];

function _canUploadQuiz() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  return PERMISSIONS.can_upload_quiz === 'true';
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


// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// AFTER SALES PANEL — Supabase After_Sales table
// ═══════════════════════════════════════════════════════════
let afterSalesLoaded = false;
let afterSalesData   = [];

const AS_CAT_COLORS = [
  { color:'#22c55e', bg:'rgba(34,197,94,0.12)',  border:'rgba(34,197,94,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    desc:'Step-by-step hardware setup guides and configuration docs for all Aditi Tracking devices.' },
  { color:'#f0a500', bg:'rgba(240,165,0,0.12)',  border:'rgba(240,165,0,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    desc:'After sales documentation and support resources.' },
  { color:'#4e9af1', bg:'rgba(78,154,241,0.12)', border:'rgba(78,154,241,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
    desc:'After sales support and service resources.' },
  { color:'#a855f7', bg:'rgba(168,85,247,0.12)', border:'rgba(168,85,247,0.3)',
    icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    desc:'After sales resources.' },
];


// ═══════════════════════════════════════════════════════════════
// HR SECTION — Dynamic cards from content_nodes
// ═══════════════════════════════════════════════════════════════
let hrSectionLoaded = false;

