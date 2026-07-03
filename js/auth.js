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


