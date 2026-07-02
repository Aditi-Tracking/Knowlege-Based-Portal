
// ═══════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════
let lLoaded=false,cLoaded=false,enLoaded=false;
// Pre-fetch data caches
let _leadsCache=null, _collCache=null, _tasksCache=null, _fmsCache=null;

function prefetchAllData(){
  const _isOwner = CURRENT_USER && CURRENT_USER.role === 'owner';
  const myEmail = CURRENT_USER ? encodeURIComponent(String(CURRENT_USER.email||'').trim().toLowerCase()) : '';
  const myName = CURRENT_USER ? encodeURIComponent(String(CURRENT_USER.name||'').trim().toLowerCase()) : '';

  if(!_tasksCache){
    // Supabase se prefetch — background mein loadTasks trigger karo
    Promise.resolve().then(()=>{
      _tasksAllReady=true;
      if(!tLoaded){
        tLoaded=true;
        setTimeout(()=>{ try{ loadTasks(); }catch(e){ } }, 0);
      }
    });
  }

  // Managing Director/MIS/PC: also fetch leads, collection, FMS in background
  if(_isOwner){
    if(!_leadsCache) fetch(L_URL).then(r=>r.json()).then(d=>{_leadsCache=d;}).catch(()=>{});
    if(!_collCache)  fetch(C_URL).then(r=>r.json()).then(d=>{_collCache=d;}).catch(()=>{});
    // FMS now uses Supabase directly — no prefetch needed
  }
}
function toggleUserPopup(e){
  if(e) e.stopPropagation();
  openUserSheet();
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.bn-user-profile')){const p=document.getElementById('bnUserPopup');if(p)p.classList.remove('open');}
});

// ─── USER BOTTOM SHEET ───────────────────────────────────────────────────────
function _syncProfileUI(){
  if(typeof CURRENT_USER==='undefined' || !CURRENT_USER) return;
  const name     = CURRENT_USER.name || CURRENT_USER.email.split('@')[0] || 'User';
  const rawRole  = CURRENT_USER.rawRole || 'employee';
  const roleLabel= rawRole === 'owner' ? 'Managing Director' : rawRole.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  const roleIcon = rawRole === 'owner' ? '👑' : rawRole === 'mis' ? '📊' : rawRole === 'pc' ? '💼' : rawRole === 'executive assistant' || rawRole === 'ea' ? '🤝' : '👤';
  const initial  = name.charAt(0).toUpperCase();
  // Desktop sidebar
  const sbpAv=document.getElementById('sbpAvatar'); if(sbpAv) sbpAv.textContent=initial;
  const sbpNm=document.getElementById('sbpName');   if(sbpNm) sbpNm.textContent=name;
  const sbpRl=document.getElementById('sbpRole');   if(sbpRl) sbpRl.textContent=roleIcon+' '+roleLabel;
  // Mobile bottom nav
  const bnpAv=document.getElementById('bnpAvatar'); if(bnpAv) bnpAv.textContent=initial;
  const bnpNm=document.getElementById('bnpName');   if(bnpNm) bnpNm.textContent=name.split(' ')[0];
  // Mobile sheet header (pre-fill)
  const usAv=document.getElementById('usAvatar'); if(usAv) usAv.textContent=initial;
  const usNm=document.getElementById('usName');   if(usNm) usNm.textContent=name;
  const usRl=document.getElementById('usRole');   if(usRl) usRl.textContent=roleLabel;
}

// ─── USER BOTTOM SHEET (Mobile only) ─────────────────────────────────────────
function openUserSheet(){
  _syncProfileUI();
  const overlay=document.getElementById('userSheetOverlay');
  const sheet=document.getElementById('userSheet');
  if(!overlay||!sheet) return;
  overlay.style.display='block'; sheet.style.display='block';
  requestAnimationFrame(()=>{ sheet.style.transform='translateY(0)'; });
}
function closeUserSheet(){
  const sheet=document.getElementById('userSheet');
  if(sheet){
    sheet.style.transform='translateY(100%)';
    setTimeout(()=>{
      sheet.style.display='none';
      const ov=document.getElementById('userSheetOverlay'); if(ov) ov.style.display='none';
    },280);
  }
}

// ─── PROFILE DETAILS MODAL ───────────────────────────────────────────────────
function showProfileDetails(){
  closeUserSheet();
  const overlay=document.getElementById('profileModalOverlay');
  const modal=document.getElementById('profileModal');
  if(!overlay||!modal) return;
  overlay.style.display='block'; modal.style.display='block';

  const loadMsg=document.getElementById('pmLoadingMsg');
  const grid=document.getElementById('pmDetailsGrid');
  const errMsg=document.getElementById('pmErrorMsg');
  if(loadMsg) loadMsg.style.display='block';
  if(grid)    grid.style.display='none';
  if(errMsg)  errMsg.style.display='none';

  const name   =(typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.name)    ? CURRENT_USER.name    : 'User';
  const email  =(typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.email)   ? String(CURRENT_USER.email).trim() : '';
  const rawRole=(typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.rawRole) ? CURRENT_USER.rawRole : '';

  // Photo wrap reset karo — _fillProfileModal previous run mein innerHTML replace kar deta hai
  // jisse pmAvatarLetter span destroy ho jata hai. Yahan dobara create karo.
  const photoWrap=document.getElementById('pmPhotoWrap');
  if(photoWrap) photoWrap.innerHTML='<span id="pmAvatarLetter">'+name.charAt(0).toUpperCase()+'</span>';
  const upStatus=document.getElementById('pmUploadStatus'); if(upStatus) upStatus.textContent='';

  // Safe DOM updates — element null ho toh skip
  const _set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  _set('pmName', name);
  _set('pmDept', rawRole ? rawRole.charAt(0).toUpperCase()+rawRole.slice(1) : 'Employee');
  _set('pmAvatarLetter', name.charAt(0).toUpperCase());

  const _hdrs = SB_HDRS();

  // DEBUG: console mein dikhao kya search ho raha hai

  // Step 1 – Email_Id se match karo (most reliable — email unique hota hai)
  const tryEmailLookup = email
    ? fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=*&Email_Id=ilike.${encodeURIComponent(email)}&limit=1`,{headers:_hdrs}).then(r=>r.json())
    : Promise.resolve([]);

  tryEmailLookup
  .then(rows=>{
    if(rows&&rows.length>0){ _fillProfileModal(rows[0],name,rawRole,grid,errMsg,loadMsg); return null; }
    // Step 2 – Employee_name exact match fallback
    const encodedName=encodeURIComponent(name.trim());
    return fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=*&Employee_name=ilike.${encodedName}&limit=1`,{headers:_hdrs}).then(r=>r.json());
  })
  .then(rows=>{
    if(rows===null) return null; // already filled in step 1
    if(rows&&rows.length>0){ _fillProfileModal(rows[0],name,rawRole,grid,errMsg,loadMsg); return null; }
    // Step 3 – first name only fallback
    const firstName=name.trim().split(/\s+/)[0];
    if(firstName&&firstName.toLowerCase()!==name.toLowerCase()){
      return fetch(`${SUPABASE_URL}/rest/v1/Employee_details?select=*&Employee_name=ilike.${encodeURIComponent(firstName)}&limit=1`,{headers:_hdrs}).then(r=>r.json()).then(rows2=>{
        if(rows2&&rows2.length>0){ _fillProfileModal(rows2[0],name,rawRole,grid,errMsg,loadMsg); return null; }
        _profileNotFound(name,loadMsg,errMsg);
        return null;
      });
    }
    _profileNotFound(name,loadMsg,errMsg);
    return null;
  })
  .catch(err=>{ if(loadMsg)loadMsg.style.display='none'; if(errMsg){errMsg.style.display='block';errMsg.textContent='⚠️ Network error.';} });
}
function _profileNotFound(name,loadMsg,errMsg){
  if(loadMsg) loadMsg.style.display='none';
  const _em=(typeof CURRENT_USER!=='undefined'&&CURRENT_USER&&CURRENT_USER.email)?CURRENT_USER.email:'';
  if(errMsg){ errMsg.style.display='block'; errMsg.textContent='⚠️ Record not found. (Name: "'+name+'"'+(_em?', Email: '+_em:'')+') — Please contact MIS.'; }
}
function _fillProfileModal(row,name,rawRole,grid,errMsg,loadMsg){
  if(loadMsg) loadMsg.style.display='none';
  const _set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  const photoUrl=row['avatar_url']||row['Link']||row['link']||row['Photo']||null;
  const photoWrap=document.getElementById('pmPhotoWrap');
  if(photoWrap) {
    if(photoUrl) {
      photoWrap.innerHTML=`<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<span id=&quot;pmAvatarLetter&quot;>'+(this.alt||'?').charAt(0).toUpperCase()+'</span>'" alt="${(row['Employee_name']||name)}">`;
    } else {
      photoWrap.innerHTML=`<span id="pmAvatarLetter">${(row['Employee_name']||name).charAt(0).toUpperCase()}</span>`;
    }
  }
  // Agar avatar_url hai toh CURRENT_USER mein bhi save karo aur UI sync karo
  if(row['avatar_url'] && typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
    CURRENT_USER.avatar_url = row['avatar_url'];
    localStorage.setItem('aditiUser', JSON.stringify(CURRENT_USER));
    _syncProfileUI();
    // Update sidebar avatar with actual photo
    const sbAv = document.getElementById('sidebarUserAvatar');
    if (sbAv) sbAv.innerHTML = `<img src="${row['avatar_url']}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${(CURRENT_USER.name||'?')[0].toUpperCase()}'">`;
  }
  const dbName=row['Employee_name']||name;
  const dbDept=row['Employee_Dept']||row['Emp_Dept']||rawRole||'—';
  _set('pmName', dbName);
  _set('pmDept', dbDept.charAt(0).toUpperCase()+dbDept.slice(1));
  _set('pmAvatarLetter', dbName.charAt(0).toUpperCase());
  function fmtDate(d){ if(!d)return'—'; try{return new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return d;} }
  _set('pmEmail',    row['Email_Id']||row['Email']||'—');
  _set('pmPhone',    row['Phone Number']||row['Phone_Number']||'—');
  _set('pmLocation', row['Location']||row['location']||'—');
  _set('pmDOJ',      fmtDate(row['Date Of Joining']||row['Date_Of_Joining']));
  _set('pmDOB',      fmtDate(row['Date of Birth']||row['Date_of_Birth']));
  if(grid) grid.style.display='grid';
}
function closeProfileModal(){
  const ov=document.getElementById('profileModalOverlay'); if(ov) ov.style.display='none';
  const md=document.getElementById('profileModal');        if(md) md.style.display='none';
}

// Download access — in emails ko Training Videos download karne ki permission hai
const VIDEO_DOWNLOAD_EMAILS = [
  'care3@adititracking.com',   // Akshay More
  'mis@adititracking.com',     // Hemant (MIS)
  'mis1@adititracking.com',    // Krishna (MIS)
  'chirag@adititracking.com',  // Managing Director
];
function _canDownloadVideo() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return false;
  return PERMISSIONS.can_download_video === 'true';
}

// ─── PROFILE PHOTO UPLOAD ────────────────────────────────────────────────────
function handleProfilePhotoUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  // Sirf image allow karo
  if (!file.type.startsWith('image/')) {
    _pmUploadMsg('❌ Please select an image file only.', '#ff5c7c');
    return;
  }
  // 5MB limit
  if (file.size > 5 * 1024 * 1024) {
    _pmUploadMsg('❌ File must be smaller than 5MB.', '#ff5c7c');
    return;
  }
  uploadProfilePhoto(file);
  // Reset input so same file dobara select ho sake
  input.value = '';
}

function _pmUploadMsg(msg, color) {
  const el = document.getElementById('pmUploadStatus');
  if (el) { el.textContent = msg; el.style.color = color || 'var(--muted)'; }
}

async function uploadProfilePhoto(file) {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  const email = String(CURRENT_USER.email || '').trim().toLowerCase();
  if (!email) { _pmUploadMsg('❌ Email not found.', '#ff5c7c'); return; }

  _pmUploadMsg('⏳ Uploading...', '#f0a500');

  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `avatars/${email}.${ext}`;
    const bucket   = 'Employee_Photos';
    const hdrs = {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${_currentToken}`,
      'Content-Type': file.type,
      'Cache-Control': '3600',
      'x-upsert': 'true'   // agar file already hai toh overwrite karo
    };

    // 1. Storage mein upload
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`,
      { method: 'POST', headers: hdrs, body: file }
    );

    if (!uploadRes.ok) {
      const errTxt = await uploadRes.text();
      throw new Error('Upload failed: ' + errTxt);
    }

    // 2. Public URL banao
    // Cache bust ke liye timestamp add karo
    const ts = Date.now();
    const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}?t=${ts}`;

    // 3. Employee_details table mein avatar_url update karo
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/Employee_details?Email_Id=ilike.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${_currentToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ avatar_url: avatarUrl })
      }
    );

    if (!patchRes.ok) {
      const errTxt2 = await patchRes.text();
      throw new Error('DB update failed: ' + errTxt2);
    }

    // 4. CURRENT_USER mein save karo + localStorage update
    CURRENT_USER.avatar_url = avatarUrl;
    localStorage.setItem('aditiUser', JSON.stringify(CURRENT_USER));

    // 5. Profile modal photo update karo
    const photoWrap = document.getElementById('pmPhotoWrap');
    if (photoWrap) {
      photoWrap.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Profile">`;
    }

    // 6. Home page banner photo bhi update karo (live)
    const homeBanner = document.getElementById('empProfileBanner');
    if (homeBanner) {
      // Koi bhi purana photo element dhundho — wrap, loading, ya placeholder
      const targetEl = homeBanner.querySelector('.emp-photo-wrap')
                    || homeBanner.querySelector('.emp-photo-loading')
                    || homeBanner.querySelector('.emp-photo-placeholder');
      if (targetEl) {
        const newWrap = document.createElement('div');
        newWrap.className = 'emp-photo-wrap';
        const newImg = document.createElement('img');
        newImg.src = avatarUrl;
        newImg.alt = CURRENT_USER.name || 'Profile';
        newImg.style.cssText = 'width:90px;height:90px;object-fit:cover;border-radius:50%;';
        newWrap.appendChild(newImg);
        targetEl.replaceWith(newWrap);
      }
      // Banner visible karo agar hidden hai
      homeBanner.style.display = 'flex';
    }

    // 7. Sidebar, bottom nav, user sheet — sab update karo
    _syncProfileUI();

    _pmUploadMsg('✅ Photo updated successfully!', '#00d4aa');

  } catch(err) {
    _pmUploadMsg('❌ ' + (err.message || 'Upload failed. Please try again.'), '#ff5c7c');
  }
}
// ─────────────────────────────────────────────────────────────────────────────


function toggleDashboardAccordion(){
  var grp=document.getElementById('dashboardSubGroup');
  var arrow=document.getElementById('dashAccordionArrow');
  var trigger=document.getElementById('nav-dashboards-trigger');
  if(!grp)return;
  if(grp.style.display==='none'||grp.style.display===''){
    grp.style.display='block';
    if(arrow)arrow.classList.add('open');
    if(trigger)trigger.classList.add('dash-open');
  } else {
    grp.style.display='none';
    if(arrow)arrow.classList.remove('open');
    if(trigger)trigger.classList.remove('dash-open');
  }
}

function resourcesShowDocs(){
  document.getElementById('resources-main').style.display='none';
  document.getElementById('resources-docs').style.display='block';
  window.scrollTo({top:0,behavior:'smooth'});
}
function resourcesShowMain(){
  document.getElementById('resources-docs').style.display='none';
  document.getElementById('resources-main').style.display='block';
  window.scrollTo({top:0,behavior:'smooth'});
}


// ═══════════════════════════════════════════════════════════
// GLOBAL VIDEO MANAGER — Ek waqt mein sirf ek video
// Jab koi naya video play hota hai, baaki sab automatically pause
// ═══════════════════════════════════════════════════════════
function pauseAllVideosExcept(exceptId) {
  document.querySelectorAll('video').forEach(function(v) {
    if (v.id !== exceptId && !v.paused) {
      v.pause();
    }
  });
}

function switchDB(id, fromPopState){
  _actOnPageSwitch(id); // ACTIVITY TRACKING: log previous page time, start new page timer
  document.querySelectorAll('.dashboard-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll('.bn-item').forEach(n=>n.classList.remove('active'));
  // Auto-open dashboard accordion when a sub-dashboard is selected
  var dashPanels=['leads','enterprise','collection','fms','tasks','ims','crm','mapping'];
  if(dashPanels.indexOf(id)>=0){
    var grp=document.getElementById('dashboardSubGroup');
    var arrow=document.getElementById('dashAccordionArrow');
    var trigger=document.getElementById('nav-dashboards-trigger');
    if(grp){grp.style.display='block';}
    if(arrow){arrow.classList.add('open');}
    if(trigger){trigger.classList.add('dash-open');}
  }
  // Reset Resources sub-view when switching away
  if(id!=='resources'){
    var rm=document.getElementById('resources-main');
    var rd=document.getElementById('resources-docs');
    if(rm){rm.style.display='block';}
    if(rd){rd.style.display='none';}
  }
  var panel=document.getElementById('panel-'+id);
  if(!panel){
    // Fallback for coming-soon panels — show home
    document.getElementById('panel-home').classList.add('active');
    document.getElementById('nav-home').classList.add('active');
    return;
  }
  panel.classList.add('active');
  if(document.getElementById('nav-'+id)) document.getElementById('nav-'+id).classList.add('active');
  if(document.getElementById('bn-'+id)) document.getElementById('bn-'+id).classList.add('active');
  // Scroll to top on mobile
  window.scrollTo({top:0,behavior:'smooth'});
  const _up=document.getElementById('bnUserPopup');if(_up)_up.classList.remove('open');
  if(id==='leads'&&!lLoaded){lLoaded=true;loadLeads();}
  if(id==='enterprise'&&!enLoaded){enLoaded=true;loadEnterprise();}
  if(id==='collection'&&!cLoaded){cLoaded=true;loadColl();}
  if(id==='tasks'&&!tLoaded){tLoaded=true;loadTasks();}
  if(id==='hr'){loadHRSection();}
  if(id==='sales'&&!salesDocsLoaded){loadSalesDocs();}
  if(id==='aftersales'&&!afterSalesLoaded){loadAfterSales();}
  if(id==='products'&&!prodLoaded){loadProducts();}
  if(id==='training'){loadTrainingSection();}
  if(id==='marketing'){loadMarketingCounts();}
  if(id==='ims')      { loadIMSDashboard(); }
  if(id==='crm')      { loadCRMDashboard(); }
  if(id==='mapping')   { loadMappingDashboard(); }
  if(id==='adminperms') { loadAdminPermsPanel(); }
  if(id==='finance')    { loadSimpleCNPanel('finance',    'Finance').then(()=>_injectPurchaseCard()); }
  if(id==='compliance') { loadSimpleCNPanel('compliance', 'Compliance'); }
  if(id==='referral')   { initReferralProgramme(); }
  if(id==='announcements') { /* handled by override below */ }
  if(id==='activitylog') { loadActivityLog(); }
  if(id==='itadmin')    { loadSimpleCNPanel('itadmin',    'IT Admin');   }
  // Training panel needs no data loading — just shows static links
  // Push history state so back button returns to home
  if(!fromPopState){
    if(id==='home'){
      history.replaceState({panel:'home'},'','');
    } else {
      history.pushState({panel:id},'','');
    }
  }
}

// Handle browser/phone back button — always go to home
window.addEventListener('popstate', function(e){
  const panel = (e.state && e.state.panel) ? e.state.panel : 'home';
  switchDB(panel==='home' ? 'home' : 'home', true);
});

// On portal load, set initial history state
function initHistory(){
  history.replaceState({panel:'home'},'','');
}

// ╔══════════════════════════════════════════════════════════════════════════
// ║  [SUPABASE SETUP] — Database connection constants
// ║  SUPABASE_URL  = Supabase project ka URL (kabhi change mat karo)
// ║  SUPABASE_ANON = Public anon key (safe to expose — RLS protect karta hai)
// ║  _currentToken = Login ke baad user's JWT replace karta hai anon key ko
// ║  SB_HDRS()     = Har API call mein yahi headers lagao
// ║  IMPORTANT: Agar Supabase project change karo toh DONO URL + ANON update karo
// ╚══════════════════════════════════════════════════════════════════════════
// ── Supabase constants + header helpers (defined early — used throughout) ──
const SUPABASE_URL  = 'https://rramdtpabwjsndgkohbi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyYW1kdHBhYndqc25kZ2tvaGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDQ4ODUsImV4cCI6MjA5MTQ4MDg4NX0.hpdTOkhRrbqmbPM6VJWEtz2oEjkeXAjYJQS9rgzheec';
// ── Auth token — login ke baad user JWT yahan save hota hai ──
let _currentToken = SUPABASE_ANON; // default: anon; login hone pe user JWT set hoga

// SB_HDRS ab _currentToken use karta hai — authenticated RLS policies kaam karengi
// SB_HDRS_JSON / SB_HDRS_REPR / SB_HDRS_MIN sab inhi se extend hote hain — auto-fix!
const SB_HDRS      = () => ({ 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${_currentToken}`, 'Accept': 'application/json' });
const SB_HDRS_JSON = () => ({ ...SB_HDRS(), 'Content-Type': 'application/json' });
const SB_HDRS_REPR = () => ({ ...SB_HDRS_JSON(), 'Prefer': 'return=representation' });
const SB_HDRS_MIN  = () => ({ ...SB_HDRS_JSON(), 'Prefer': 'return=minimal' });

// SB_HDRS_AUTH alias — purana code jo SB_HDRS_AUTH() use karta hai vo bhi kaam kare
const SB_HDRS_AUTH      = SB_HDRS;
const SB_HDRS_AUTH_JSON = SB_HDRS_JSON;

// ═══════════════════════════════════
// LEAD TRACKING DASHBOARD
// ═══════════════════════════════════
const L_URL='https://script.google.com/macros/s/AKfycbxsC_glUfbC5RJSs0BPFYQI5jbsM5p6VeIraKcl-cO8zC8VjVnLqFYQuumhRP69oEy2/exec';
const REP_MAP={'supportmum@adititracking.com':{name:'Support MUM',color:'#f0a500',bg:'rgba(240,165,0,0.2)'},'salesmumbai@adititracking.com':{name:'Sales Mumbai',color:'#00d4aa',bg:'rgba(0,212,170,0.2)'},'salesgoa@adititracking.com':{name:'Sales Goa',color:'#ff5c7c',bg:'rgba(255,92,124,0.2)'},'salesgujarat@adititracking.com':{name:'Sales Gujarat',color:'#a78bfa',bg:'rgba(167,139,250,0.2)'},'coolbus.enterprise@adititracking.com':{name:'CoolBus',color:'#4e9af1',bg:'rgba(78,154,241,0.2)'}};
const rN=e=>REP_MAP[e]?.name||(String(e||'')).split('@')[0];
const rC=e=>REP_MAP[e]?.color||'#888';
const rB=e=>REP_MAP[e]?.bg||'rgba(128,128,128,0.2)';
const rI=e=>rN(e).charAt(0).toUpperCase();
// Set Chart.js global defaults based on current theme on initial load
(function(){
  const isLight = document.body.classList.contains('light-mode');
  const tc = isLight ? '#000000' : '#ffffff';
  const gc = isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
  if(typeof Chart !== 'undefined'){
    Chart.defaults.color = tc;
    Chart.defaults.borderColor = gc;
    Chart.defaults.font.family = 'DM Sans';
  }
})();

// ── Generic CN panel loader (Finance / Compliance / Referral) ─────────────
// Loads content_nodes cards for a section name into a standard panel layout.
const _simplePanelLoaded = {};

// --- Shared: loadSimpleCNPanel ---
async function loadSimpleCNPanel(panelKey, sectionName) {
  if (_simplePanelLoaded[panelKey]) return;
  _simplePanelLoaded[panelKey] = true;

  const loadingEl = document.getElementById(panelKey + '-loading');
  const gridEl    = document.getElementById(panelKey + '-grid');
  const emptyEl   = document.getElementById(panelKey + '-empty');

  try {
    await CN.load();
    const section = CN.getSection(sectionName);
    if (!section) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl)   emptyEl.style.display = 'block';
      return;
    }
    const cats = CN.getCategories(section.id);
    if (!cats.length) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl)   emptyEl.style.display = 'block';
      return;
    }
    if (loadingEl) loadingEl.style.display = 'none';
    gridEl.innerHTML = cats.map((cat, i) => {
      const th    = cnTheme(i);
      const name  = cat.name || 'Category';
      const count = CN.totalFiles(cat.id);
      const safe  = name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      return `
      <div style="position:relative;">
        ${_isMIS() ? `        <button onclick="event.stopPropagation();confirmDeleteCard(${cat.id},'${safe}')" title="Delete"
          style="position:absolute;top:10px;right:10px;z-index:3;width:28px;height:28px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>` : ''}
        <div class="home-card" style="--card-top:${th.color};cursor:pointer;"
          onclick="_hideAssessmentTab();switchMktTab('videos');cnOpenOverlay(${cat.id},'${safe}','marketingOverlay','mktOverlayTitle','mktOverlaySub','mktOverlayGrid','mktOverlayLoader','mktOverlayEmpty')"
          onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,0.3)';this.style.borderColor='${th.color}'"
          onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor=''">
          <div class="hc-icon" style="background:${th.bg};border-color:${th.border};color:${th.color};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="hc-name">${name}</div>
          <div class="hc-desc" style="font-size:0.88rem;line-height:1.55;color:var(--muted);">${getCNCardDesc(name)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
            <span class="hc-status live" style="background:${th.bg};color:${th.color};border:1px solid ${th.border};">📂 ${count} file${count===1?'':'s'}</span>
            <span style="font-size:0.78rem;font-weight:600;color:${th.color};">View →</span>
          </div>
        </div>
      </div>`;
    }).join('');
    gridEl.style.display = 'grid';
  } catch(e) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl)   { emptyEl.style.display = 'block'; emptyEl.textContent = '⚠️ ' + e.message; }
  }
}

// ═══════════════════════════════════════════════════════════
// REFERRAL PROGRAMME — "Refer & Earn" (₹2,000 per successful referral)
// Tables (Supabase): job_openings, referrals
// See /referral_programme_schema.sql for table + RLS + storage setup
// ═══════════════════════════════════════════════════════════
let _refOpenings        = [];
let _myReferrals        = [];
let _refOpeningsLoaded  = false;
let _myReferralsLoaded  = false;

function _isReferralAdmin(){
  if (!CURRENT_USER) return false;
  if (CURRENT_USER.role === 'owner') return true;
  const r = String(CURRENT_USER.rawRole || '').toLowerCase().trim();
  return r === 'hr' || r === 'mis';
}

// Access Control toggle wins if set; otherwise fall back to legacy HR/MIS/owner check
function _canSeeReferralPipeline(){
  return PERMISSIONS.can_view_referral_pipeline === 'true' || _isReferralAdmin();
}
function _canPostReferralRole(){
  return PERMISSIONS.can_post_referral_role === 'true' || _isReferralAdmin();
}

// Nav item + tab visibility for Referral Programme — runs at login and again on tab open
function _applyReferralNavVisibility(){
  const canRoles = PERMISSIONS.can_view_open_roles        !== 'false';
  const canMine  = PERMISSIONS.can_view_my_referrals      !== 'false';
  const canPipe  = _canSeeReferralPipeline();
  const canPost  = _canPostReferralRole();
  const anyTab   = canRoles || canMine || canPipe || canPost;

  const refNav = document.getElementById('nav-referral');
  const refMM  = document.getElementById('mm-referral');
  if (refNav) refNav.style.display = anyTab ? '' : 'none';
  if (refMM)  refMM.style.display  = anyTab ? '' : 'none';

  return { canRoles, canMine, canPipe, canPost };
}

