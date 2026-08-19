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

// True whenever the permissions fetch fell back to role defaults (timeout,
// non-ok response, or network error) rather than getting a real answer from
// the backend — see _loadUserProfile below. Not currently read by any UI
// (kept as a diagnostic signal, inspectable from devtools, for permissions
// with no role-level default such as field_service_create/view_all — see
// the Samsung A26 investigation this was added for).
let _permissionsFetchFailed = false;

// Bumped by every login attempt (auto-restore on page load OR manual doLogin).
// A device can have a still-valid session from a previous user sitting in
// localStorage — if someone types different credentials into the (still
// visible/interactive) login form while that session's auto-restore is
// still in flight, both flows would otherwise race to write CURRENT_USER/
// PERMISSIONS and call showPortal(). Each flow checks its own sequence
// number before publishing its result, so only the most-recently-started
// flow is ever allowed to win — a slower, stale flow just abandons itself.
let _authFlowSeq = 0;

window.addEventListener('load', async function(){
  const _loginBtn = document.getElementById('loginBtn');
  const _origBtnHtml = _loginBtn ? _loginBtn.innerHTML : null;
  try {
    const { data: { session } } = await _sbAuth.auth.getSession();
    if (session) {
      // A previous session is still valid on this device — make that
      // obvious and briefly block the button so a second person typing
      // their own credentials right now doesn't feel like nothing happened.
      if (_loginBtn) {
        _loginBtn.disabled = true;
        _loginBtn.innerHTML = '<span class="lp-btn-text"><span>Checking existing session…</span></span>';
      }
      _currentToken = session.access_token; // ✅ page reload pe bhi token set karo
      await _loadUserProfile(session.user);
      return;
    }
  } catch(e) {
    console.warn('Session check error:', e);
  } finally {
    if (_loginBtn && _origBtnHtml !== null) {
      _loginBtn.disabled = false;
      _loginBtn.innerHTML = _origBtnHtml;
    }
  }
});

function togglePass(){
  const p=document.getElementById('loginPass');
  const e=document.getElementById('eyeIcon');
  if(p.type==='password'){p.type='text';e.textContent='🙈';}
  else{p.type='password';e.textContent='👁️';}
}

// Fallback — builds PERMISSIONS from rawRole if the Python backend is
// unreachable. Mirrors role_defaults (checked live against Supabase on
// 2026-08-03) per role — only keys a role is actually granted need listing;
// anything absent reads as undefined everywhere it's checked (`PERMISSIONS.x
// === 'true'`), which is equivalent to 'false'.
//
// IMPORTANT LIMITATION: this can only reconstruct role-level defaults.
// Some permissions (e.g. field_service_create/view_all) are 'false' for
// EVERY role in role_defaults — they're granted per individual user via a
// separate overrides table, so no role-based fallback can ever recover
// them. That's why _fetchPermissionsWithRetry() below retries the real
// fetch a few times before ever falling back to this.
const _ROLE_DEFAULT_PERMISSIONS = {
  owner: {
    can_download_video:'true', can_edit_mapping:'true', can_post_referral_role:'true',
    can_view_activitylog:'true', can_view_announcements:'true', can_view_crm:'true',
    can_view_crm_changes:'true', can_view_enterprise:'true', can_view_fms:'true',
    can_view_ims:'true', can_view_leads:'true', can_view_mapping:'true',
    can_view_my_referrals:'true', can_view_open_roles:'true', can_view_referral_pipeline:'true',
    checklist_scope:'all', hr_employee_edit:'true', hr_employee_view:'true',
    mapping_region_headoffice:'true', mapping_region_goa:'true', mapping_region_bangalore:'true',
    mapping_region_gujarat:'true', vendor_view_all:'true',
  },
  mis: {
    can_delete_tasks:'true', can_download_video:'true', can_edit_mapping:'true',
    can_post_announcements:'true', can_post_referral_role:'true', can_upload_files:'true',
    can_upload_quiz:'true', can_view_activitylog:'true', can_view_announcements:'true',
    can_view_crm:'true', can_view_crm_changes:'true', can_view_enterprise:'true',
    can_view_entsol:'true', can_view_fms:'true', can_view_ims:'true', can_view_leads:'true',
    can_view_mapping:'true', can_view_my_referrals:'true', can_view_open_roles:'true',
    can_view_referral_pipeline:'true', checklist_scope:'all',
    crm_server_bangalore:'true', crm_server_goa:'true', crm_server_gujarat:'true',
    crm_server_premium:'true', crm_server_pro:'true', hr_employee_edit:'true', hr_employee_view:'true',
    mapping_region_headoffice:'true', mapping_region_goa:'true', mapping_region_bangalore:'true',
    mapping_region_gujarat:'true', vendor_view_all:'true',
  },
  pc: {
    can_view_announcements:'true', can_view_fms:'true', can_view_ims:'true',
    can_view_leads:'true', can_view_my_referrals:'true', can_view_open_roles:'true',
    checklist_scope:'all',
  },
  'executive assistant': {
    can_view_announcements:'true', can_view_enterprise:'true', can_view_fms:'true',
    can_view_ims:'true', can_view_leads:'true', can_view_my_referrals:'true',
    can_view_open_roles:'true', checklist_scope:'all', vendor_view_all:'true',
  },
  admin: {
    can_download_video:'true', can_post_referral_role:'true', can_view_activitylog:'true',
    can_view_announcements:'true', can_view_crm:'true', can_view_entsol:'true',
    can_view_fms:'true', can_view_ims:'true', can_view_leads:'true',
    can_view_my_referrals:'true', can_view_open_roles:'true', can_view_referral_pipeline:'true',
    checklist_scope:'all',
  },
  employee: {
    can_view_announcements:'true', can_view_my_referrals:'true', can_view_open_roles:'true',
    checklist_scope:'own',
  },
  hr: {
    can_view_announcements:'true', can_view_my_referrals:'true', can_view_open_roles:'true',
    checklist_scope:'own', home_content_manage:'true',
  },
};

function _buildFallbackPermissions(rawRole) {
  const r = String(rawRole || 'employee').toLowerCase().trim();
  const defaults = _ROLE_DEFAULT_PERMISSIONS[r] || _ROLE_DEFAULT_PERMISSIONS.employee;
  return { ...defaults };
}

// Retries the permissions call a couple of times before the caller falls
// back to role defaults — see the limitation noted above _buildFallbackPermissions.
async function _fetchPermissionsWithRetry(email, attempts = 3) {
  console.log('[FieldService diag] _fetchPermissionsWithRetry start. navigator.connection?.effectiveType:', (navigator.connection && navigator.connection.effectiveType) || 'unavailable');
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${_PAPI}/api/permissions?email=${encodeURIComponent(email)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok || i === attempts - 1) return res;
    } catch(e) {
      clearTimeout(timeoutId);
      lastErr = e;
      if (i === attempts - 1) throw lastErr;
    }
    await new Promise(r => setTimeout(r, 500 * (i + 1))); // 500ms, then 1000ms
  }
}

// ── Load user profile — Auth + Data both from Supabase Employee_details ──
async function _loadUserProfile(authUser) {
  const _mySeq = ++_authFlowSeq; // see _authFlowSeq comment above
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

    if (_mySeq !== _authFlowSeq) return; // a newer login/restore started — abandon this one

    const _rawR = String(
      (empData && empData['Employee_Dept']) || 'employee'
    ).trim().toLowerCase();
    const _fullAccessRoles = ['managing director','mis','pc','executive assistant','ea'];

    const _newUser = {
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

    // ── Fetch permissions from Python backend (retried a few times — see
    // _fetchPermissionsWithRetry / _buildFallbackPermissions comments) ──
    let _newPermissions;
    // Diagnostics only, for the catch block below — mirrors the URL built inside
    // _fetchPermissionsWithRetry (to confirm it's never malformed) and captures
    // a response object if one was ever obtained (e.g. a .json() parse failure
    // after a successful fetch) — stays null for a network-level failure
    // (TypeError before any response exists), which the catch block reports
    // explicitly rather than assuming.
    const _permFetchUrl = `${_PAPI}/api/permissions?email=${encodeURIComponent(authUser.email)}`;
    let _permFetchResponse = null;
    try {
      const _pr = await _fetchPermissionsWithRetry(authUser.email);
      _permFetchResponse = _pr || null;
      if (_pr && _pr.ok) {
        const _pd = await _pr.json();
        _newPermissions = _pd.permissions || {};
        if (_pd.rawRole) _newUser.rawRole = _pd.rawRole;
        if (_pd.role)    _newUser.role    = _pd.role === 'owner' ? 'owner' : 'employee';
        _permissionsFetchFailed = false;
      } else {
        console.error('[FieldService diag] Permissions fetch returned non-ok response, using fallback. Status:', _pr && _pr.status);
        _newPermissions = _buildFallbackPermissions(_newUser.rawRole);
        logClientDebug('fallback_permissions_used', `role=${_newUser.rawRole}`, {
          field_service_create:   _newPermissions.field_service_create,
          field_service_view_all: _newPermissions.field_service_view_all,
        });
        _permissionsFetchFailed = true;
      }
    } catch(_pe) {
      console.error('[FieldService diag] Permissions fetch failed after retries, using fallback:', {
        error: _pe,
        isTimeout: !!(_pe && _pe.name === 'AbortError'),
        message: _pe && _pe.message
      });
      logClientDebug('permissions_fetch_failed', _pe?.message || String(_pe), {
        errorName: _pe?.name,
        url: _permFetchUrl,
        responseStatus: _permFetchResponse ? _permFetchResponse.status : null,
        msSincePageLoad: Math.round(performance.now()),
      });
      _newPermissions = _buildFallbackPermissions(_newUser.rawRole);
      logClientDebug('fallback_permissions_used', `role=${_newUser.rawRole}`, {
        field_service_create:   _newPermissions.field_service_create,
        field_service_view_all: _newPermissions.field_service_view_all,
      });
      _permissionsFetchFailed = true;
    }
    console.log('[FieldService diag] Final PERMISSIONS used for', authUser.email, ':', _newPermissions);

    if (_mySeq !== _authFlowSeq) return; // re-check — the permissions fetch above is the slow part

    CURRENT_USER = _newUser;
    PERMISSIONS  = _newPermissions;

    // Show/hide Purchase Request button based on vendor_access permission
    if(typeof _vrCheckBtnAccess==='function') _vrCheckBtnAccess();

    showPortal();
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
    if (_mySeq !== _authFlowSeq) return; // a newer flow already took over — don't clobber it
    // Fallback — basic info se portal dikhao
    CURRENT_USER = {
      email:    authUser.email,
      role:     'employee',
      rawRole:  'employee',
      name:     authUser.email.split('@')[0],
      location: ''
    };
    PERMISSIONS = _buildFallbackPermissions('employee');
    logClientDebug('fallback_permissions_used', 'role=employee', {
      field_service_create:   PERMISSIONS.field_service_create,
      field_service_view_all: PERMISSIONS.field_service_view_all,
    });
    _permissionsFetchFailed = true;
    showPortal();
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
  _applyEnterpriseSolutionsNavVisibility();

  _applyFinanceNavVisibility();
  // Activity Log nav — sirf MIS aur Managing Director ke liye
  _applyActLogNavVisibility();
  // Access Control nav — only for owner or MIS role
  const _acpNav = document.getElementById('nav-adminperms');
  const _acpMobNav = document.getElementById('mm-adminperms');
  if (_acpNav || _acpMobNav) {
    const _rawRole = String((CURRENT_USER && (CURRENT_USER.rawRole || CURRENT_USER.role)) || '').toLowerCase().trim();
    const _hasAccess = (_rawRole === 'owner' || _rawRole === 'mis');
    if (_acpNav) _acpNav.style.display = _hasAccess ? '' : 'none';
    if (_acpMobNav) _acpMobNav.style.display = _hasAccess ? 'flex' : 'none';
  }
  // Renewals & Collections nav (Upload Outstanding Data / Resolve Unmatched) — owner or MIS only
  _applyRenewalsNavVisibility();
  // Field Service nav — only for users granted field_service_create or field_service_view_all.
  // The Field Service Dashboard is a tab inside this same panel (see js/fieldservice.js's
  // _fsRenderTabBar), not a separate nav item, so it has no visibility function of its own —
  // it inherits this same gate.
  if (typeof _applyFieldServiceNavVisibility === 'function') _applyFieldServiceNavVisibility();
  // HR Employee Master nav — only for users granted hr_employee_view
  if (typeof _applyHREmployeeNavVisibility === 'function') _applyHREmployeeNavVisibility();
  // Dashboards Hub — render the icon grid from the nav visibility all of the
  // calls above just set. Renewals/Task Checklist resolve their own
  // visibility asynchronously and re-call this themselves when they do.
  if (typeof _renderDashboardsHub === 'function') _renderDashboardsHub();
  // Fetch employee profile photo from Supabase → home page pe dikhao
  fetchUserProfilePhoto();
  // HR-editable Home page card sections (Spotlight of the Month, New Joiners,
  // or whatever else HR has created) — see js/homeContent.js. Inline edit
  // affordances for home_content_manage users render directly inside these
  // boxes, so there's no separate nav item to gate here.
  loadHomeContentSections();
  // Pre-fetch all dashboard data in background
  setTimeout(prefetchAllData, 0);
}

function restrictEmployee(){
  // Nav items — controlled by PERMISSIONS from database
  const navPermMap = {
    'nav-leads':      'can_view_leads',
    'nav-fms':        'can_view_fms',
    'bn-leads':       'can_view_leads',
    'bn-collection':  'can_view_collection',
    'bn-fms':         'can_view_fms',
    'mm-leads':       'can_view_leads',
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
    if (txt.includes('SmartFleet') && PERMISSIONS.can_view_leads      !== 'true') show = false;
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
    // Hide every upload button (CN system only — Task Checklist's own
    // upload button is excluded, it's gated separately and open to all)
    document.querySelectorAll('button').forEach(btn => {
      if (btn.id === 'taskUploadSubmitBtn') return;
      const oc = btn.getAttribute('onclick') || '';
      if (oc.includes('openUploadModal')) {
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


