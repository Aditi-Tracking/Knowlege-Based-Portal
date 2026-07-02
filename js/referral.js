// Section: Referral Programme (initReferralProgramme, job openings, applications)
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

function initReferralProgramme(){
  const rolesBtn = document.getElementById('refTabBtn-roles');
  const mineBtn  = document.getElementById('refTabBtn-mine');
  const postBtn  = document.getElementById('refTabBtn-post');
  const pipeBtn  = document.getElementById('refTabBtn-pipeline');

  // Each tab controlled by its own permission key from Access Control.
  // Open Roles / My Referrals default to visible (everyone can refer a friend)
  // unless an admin explicitly switches them off for a person.
  const { canRoles, canMine, canPipe, canPost } = _applyReferralNavVisibility();

  if (rolesBtn) rolesBtn.style.display = canRoles ? '' : 'none';
  if (mineBtn)  mineBtn.style.display  = canMine  ? '' : 'none';
  if (postBtn)  postBtn.style.display  = canPost  ? '' : 'none';
  if (pipeBtn)  pipeBtn.style.display  = canPipe  ? '' : 'none';

  // If the currently-active tab just got hidden, jump to the first visible one
  const order = [['roles',canRoles],['mine',canMine],['pipeline',canPipe],['post',canPost]];
  const activeBtn = document.querySelector('#panel-referral .ref-subnav button.active');
  const activeTab = activeBtn ? activeBtn.id.replace('refTabBtn-','') : 'roles';
  const activeStillVisible = order.some(([t,v]) => t === activeTab && v);
  if (!activeStillVisible) {
    const fallback = order.find(([,v]) => v);
    if (fallback) switchReferralTab(fallback[0]);
  }

  loadReferralOpenings();
  loadMyReferrals();
}

function switchReferralTab(tab){
  ['roles','mine','pipeline','post'].forEach(t=>{
    const tabEl = document.getElementById('refTab-' + t);
    const btnEl = document.getElementById('refTabBtn-' + t);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
    if (btnEl) btnEl.classList.toggle('active', t === tab);
  });
  if (tab === 'mine' && !_myReferralsLoaded) loadMyReferrals();
  if (tab === 'pipeline' && _canSeeReferralPipeline()) loadReferralPipeline();
  if (tab === 'post' && _canPostReferralRole())  loadAdminOpeningsList();
}

// ── Open Roles ───────────────────────────────────────────────
async function loadReferralOpenings(){
  const loadingEl = document.getElementById('refOpenings-loading');
  const gridEl    = document.getElementById('refOpenings-grid');
  const emptyEl   = document.getElementById('refOpenings-empty');
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/job_openings?select=*&status=eq.Open&order=posted_date.desc`,
      { headers: SB_HDRS() }
    );
    if (!res.ok) throw new Error('Could not load openings (' + res.status + ')');
    _refOpenings = await res.json();
    _refOpeningsLoaded = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (!_refOpenings.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    _populateReferralFilters();
    renderReferralOpenings();
  } catch(e){
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.innerHTML = '⚠️ Could not load openings.<br><span style="font-size:0.78rem;">' + e.message + ' — has the job_openings table been created in Supabase?</span>';
    }
  }
}

function _populateReferralFilters(){
  const locSel  = document.getElementById('refFilterLoc');
  const deptSel = document.getElementById('refFilterDept');
  if (!locSel || !deptSel) return;
  const curLoc  = locSel.value, curDept = deptSel.value;
  const locs    = [...new Set(_refOpenings.map(o=>o.location).filter(Boolean))].sort();
  const depts   = [...new Set(_refOpenings.map(o=>o.department).filter(Boolean))].sort();
  locSel.innerHTML  = '<option value="">All Locations</option>'  + locs.map(l=>`<option value="${l}">${l}</option>`).join('');
  deptSel.innerHTML = '<option value="">All Departments</option>' + depts.map(d=>`<option value="${d}">${d}</option>`).join('');
  locSel.value  = curLoc;
  deptSel.value = curDept;
}

function renderReferralOpenings(){
  const gridEl  = document.getElementById('refOpenings-grid');
  const emptyEl = document.getElementById('refOpenings-empty');
  if (!gridEl) return;
  const locF  = document.getElementById('refFilterLoc')  ? document.getElementById('refFilterLoc').value  : '';
  const deptF = document.getElementById('refFilterDept') ? document.getElementById('refFilterDept').value : '';
  const rows  = _refOpenings.filter(o => (!locF || o.location === locF) && (!deptF || o.department === deptF));

  if (!rows.length){
    gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';

  const colors = ['#f0a500','#00d4aa','#4e9af1','#a78bfa','#ff5c7c'];
  gridEl.innerHTML = rows.map((o,i)=>{
    const c = colors[i % colors.length];
    const safeTitle = String(o.role_title || 'Role').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const jdPreview = (o.jd_text || 'See the full JD for details.').slice(0,140);
    const jdMore    = (o.jd_text || '').length > 140 ? '…' : '';
    return `
      <div class="home-card" style="--card-top:${c};cursor:default;">
        <div class="hc-icon" style="color:${c};border-color:${c}40;background:${c}1a;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        </div>
        <div class="hc-name">${o.role_title || 'Role'}</div>
        <div class="ref-opening-meta">
          <span class="ref-chip">📍 ${o.location || '—'}</span>
          ${o.department ? `<span class="ref-chip">${o.department}</span>` : ''}
          <span class="ref-chip">${o.openings_count || 1} opening${(o.openings_count||1)===1?'':'s'}</span>
        </div>
        <div class="hc-desc" style="font-size:0.84rem;min-height:40px;">${jdPreview}${jdMore}</div>
        <div class="ref-card-actions">
          <button class="ref-btn ref-btn-primary" onclick="openReferModal(${o.id},'${safeTitle}')">🤝 Refer a Friend</button>
          ${o.jd_url ? `<a class="ref-btn ref-btn-ghost" href="${o.jd_url}" target="_blank">Full JD</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Refer a Friend modal ─────────────────────────────────────
function openReferModal(openingId, openingTitle){
  if (!CURRENT_USER){ alert('Please log in first.'); return; }
  document.getElementById('referOpeningId').value       = openingId;
  document.getElementById('referOpeningTitle').textContent = openingTitle;
  document.getElementById('referCandName').value    = '';
  document.getElementById('referCandMobile').value  = '';
  document.getElementById('referCandEmail').value   = '';
  document.getElementById('referCandCity').value     = '';
  document.getElementById('referResume').value      = '';
  document.getElementById('referModalStatus').style.display = 'none';
  document.getElementById('referSubmitBtn').disabled = false;
  document.getElementById('referModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeReferModal(){
  document.getElementById('referModal').style.display = 'none';
  document.body.style.overflow = '';
}
function _refMsg(text, color){
  const el = document.getElementById('referModalStatus');
  el.style.display    = 'block';
  el.style.background = color + '1f';
  el.style.color      = color;
  el.textContent      = text;
}

async function submitReferralForm(){
  const openingId    = document.getElementById('referOpeningId').value;
  const openingTitle = document.getElementById('referOpeningTitle').textContent;
  const name     = document.getElementById('referCandName').value.trim();
  const mobile   = document.getElementById('referCandMobile').value.trim();
  const email    = document.getElementById('referCandEmail').value.trim();
  const city     = document.getElementById('referCandCity').value.trim();
  const fileInput = document.getElementById('referResume');

  if (!name || !mobile || !email || !city) { _refMsg('⚠️ Please fill in all fields.', '#ff5c7c'); return; }
  if (!/^[0-9]{10}$/.test(mobile.replace(/\D/g,''))) { _refMsg('⚠️ Please enter a valid 10-digit mobile number.', '#ff5c7c'); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { _refMsg('⚠️ Please enter a valid email address.', '#ff5c7c'); return; }
  if (!fileInput.files || !fileInput.files[0]) { _refMsg('⚠️ Please attach the candidate\'s resume.', '#ff5c7c'); return; }
  if (!CURRENT_USER) { _refMsg('⚠️ Please log in again.', '#ff5c7c'); return; }
  if (!CURRENT_USER.empId) { _refMsg('⚠️ Could not find your Employee ID. Please refresh the page and try again.', '#ff5c7c'); return; }

  document.getElementById('referSubmitBtn').disabled = true;
  _refMsg('⏳ Submitting referral…', '#f0a500');

  let resumeUploadError = null;
  try{
    let resumeUrl = null;
    if (fileInput.files && fileInput.files[0]){
      const file     = fileInput.files[0];
      const ext      = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filePath = `${openingId}/${Date.now()}_${safeName}.${ext}`;
      const bucket   = 'referral_resumes';
      _refMsg('⏳ Uploading resume…', '#f0a500');
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${_currentToken}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: file
      });
      if (upRes.ok) {
        resumeUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
      } else {
        const errText = await upRes.text();
        resumeUploadError = errText || ('Resume upload failed (' + upRes.status + ')');
        console.warn('Resume upload failed:', resumeUploadError);
      }
    }
    _refMsg('⏳ Submitting referral…', '#f0a500');

    const payload = {
      opening_id:        openingId ? Number(openingId) : null,
      opening_title:      openingTitle,
      referrer_emp_id:     CURRENT_USER.empId,
      referrer_name:       CURRENT_USER.name    || '',
      referrer_email:      CURRENT_USER.email   || '',
      referrer_dept:       CURRENT_USER.rawRole || '',
      referrer_branch:     CURRENT_USER.location || '',
      candidate_name:      name,
      candidate_mobile:    mobile,
      candidate_email:     email,
      candidate_city:      city,
      resume_url:          resumeUrl,
      is_friend_declared:  true,
      status:              'Submitted'
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
      method: 'POST',
      headers: { ...SB_HDRS(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t || ('Could not save referral (' + res.status + ')')); }

    if (resumeUploadError) {
      _refMsg('⚠️ Referral submitted, but resume upload failed: ' + resumeUploadError, '#f0a500');
    } else {
      _refMsg('✅ Referral submitted! You will be notified as it progresses.', '#00d4aa');
    }
    _myReferralsLoaded = false;
    loadMyReferrals();
    setTimeout(closeReferModal, resumeUploadError ? 3500 : 1400);
  } catch(e){
    _refMsg('❌ ' + e.message, '#ff5c7c');
    document.getElementById('referSubmitBtn').disabled = false;
  }
}

// ── My Referrals ─────────────────────────────────────────────
function _refStageColor(status){
  const map = {
    'Submitted':              '#4e9af1',
    'Under Review':           '#f0a500',
    'Shortlisted/Interview':  '#f0a500',
    'Selected/Offered':       '#a78bfa',
    'Joined':                 '#a78bfa',
    '90-Day Completed':       '#00d4aa',
    'Incentive Paid':         '#00d4aa',
    'Closed-Not Eligible':    '#ff5c7c'
  };
  return map[status] || '#b0b8cc';
}

function _refStageDesc(status){
  const map = {
    'Submitted':             'HR has received your referral and will review it shortly.',
    'Under Review':          'HR is screening the candidate.',
    'Shortlisted/Interview': 'Candidate is progressing through the interview process.',
    'Selected/Offered':      'An offer has been extended to the candidate.',
    'Joined':                'Candidate has joined — the 90-day clock has started.',
    '90-Day Completed':      'Candidate completed 90 days — incentive eligible, payout pending.',
    'Incentive Paid':        'Your ₹2,000 incentive has been released.',
    'Closed-Not Eligible':   'Not eligible for incentive (did not join, exited early, or duplicate).'
  };
  return map[status] || '';
}

async function loadMyReferrals(){
  if (!CURRENT_USER || !CURRENT_USER.email) return;
  const loadingEl = document.getElementById('refMine-loading');
  const listEl    = document.getElementById('refMine-list');
  const emptyEl   = document.getElementById('refMine-empty');
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/referrals?select=*&referrer_email=ilike.${encodeURIComponent(CURRENT_USER.email)}&order=submitted_at.desc`,
      { headers: SB_HDRS() }
    );
    if (!res.ok) throw new Error('Could not load your referrals (' + res.status + ')');
    _myReferrals = await res.json();
    _myReferralsLoaded = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (!_myReferrals.length) { if (emptyEl) emptyEl.style.display = 'block'; return; }
    if (emptyEl) emptyEl.style.display = 'none';
    listEl.style.display = 'block';
    listEl.innerHTML = _myReferrals.map(r=>{
      const c = _refStageColor(r.status);
      let extra = '';
      if (r.status === 'Joined' && r.ninety_day_date){
        extra = `<div style="font-size:0.76rem;color:var(--muted);margin-top:4px;">Eligible on ${new Date(r.ninety_day_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>`;
      } else if (r.status === 'Incentive Paid' && r.paid_date){
        extra = `<div style="font-size:0.76rem;color:var(--won);margin-top:4px;">Paid on ${new Date(r.paid_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} · ₹${r.paid_amount || 2000}</div>`;
      } else {
        const desc = _refStageDesc(r.status);
        if (desc) extra = `<div style="font-size:0.76rem;color:var(--muted);margin-top:4px;">${desc}</div>`;
      }
      return `
        <div class="ref-mine-row">
          <div class="ref-mine-main">
            <div class="ref-mine-cand">${r.candidate_name}</div>
            <div class="ref-mine-role">for ${r.opening_title || '—'}</div>
            ${extra}
          </div>
          <span class="ref-stage-badge" style="background:${c}1f;color:${c};border:1px solid ${c}40;">${r.status}</span>
        </div>`;
    }).join('');
  } catch(e){
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.innerHTML = '⚠️ ' + e.message; }
  }
}

// ── HR / MIS: Pipeline — every referral with full details + status control ──
const REF_STATUS_OPTIONS = [
  'Submitted','Under Review','Shortlisted/Interview','Selected/Offered',
  'Joined','90-Day Completed','Incentive Paid','Closed-Not Eligible'
];

async function loadReferralPipeline(){
  if (!_canSeeReferralPipeline()) return;
  const loadingEl = document.getElementById('refPipeline-loading');
  const listEl    = document.getElementById('refPipeline-list');
  const emptyEl   = document.getElementById('refPipeline-empty');
  loadingEl.style.display = 'block'; listEl.style.display = 'none'; emptyEl.style.display = 'none';
  try{
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/referrals?select=*&order=submitted_at.desc`,
      { headers: SB_HDRS() }
    );
    if (!res.ok) throw new Error('Could not load referrals (' + res.status + ')');
    const rows = await res.json();
    loadingEl.style.display = 'none';
    if (!rows.length){ emptyEl.style.display = 'block'; return; }
    listEl.style.display = 'block';
    listEl.innerHTML = rows.map(r => _renderPipelineRow(r)).join('');
  } catch(e){
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = '⚠️ ' + e.message;
  }
}

function _renderPipelineRow(r){
  const c = _refStageColor(r.status);
  const submitted = r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
  const statusOpts = REF_STATUS_OPTIONS.map(s => `<option value="${s}" ${s===r.status?'selected':''}>${s}</option>`).join('');
  const showJoining = (r.status === 'Joined' || r.status === '90-Day Completed' || r.status === 'Incentive Paid');
  const showPayout  = (r.status === 'Incentive Paid' || r.status === '90-Day Completed');
  return `
    <div class="ref-pipe-row" id="refPipeRow-${r.id}">
      <div class="ref-pipe-top">
        <div>
          <div class="ref-pipe-cand">${r.candidate_name}</div>
          <div class="ref-pipe-role">for ${r.opening_title || '—'}</div>
        </div>
        <span class="ref-stage-badge" style="background:${c}1f;color:${c};border:1px solid ${c}40;">${r.status}</span>
      </div>

      <div class="ref-pipe-cols">
        <div class="ref-pipe-block">
          <div class="ref-pipe-block-title">Candidate</div>
          <div>🙋 ${r.candidate_name}</div>
          <div>📱 ${r.candidate_mobile}</div>
          ${r.candidate_email ? `<div>✉️ <a href="mailto:${r.candidate_email}">${r.candidate_email}</a></div>` : ''}
          ${r.candidate_city ? `<div>📍 ${r.candidate_city}</div>` : ''}
          ${r.resume_url ? `<div><a href="${r.resume_url}" target="_blank">📎 View Resume</a></div>` : ''}
        </div>
        <div class="ref-pipe-block">
          <div class="ref-pipe-block-title">Referred By</div>
          <div>👤 ${r.referrer_name}</div>
          <div>📍 ${r.referrer_branch || r.referrer_dept || '—'}</div>
          <div>🗓️ Submitted ${submitted}</div>
        </div>
      </div>

      ${r.note ? `<div class="ref-pipe-note">📝 ${r.note}</div>` : ''}
      <div class="ref-pipe-controls">
        <label>Status</label>
        <select id="refPipeStatus-${r.id}" onchange="_refPipeToggleFields(${r.id})">${statusOpts}</select>
        <span id="refPipeJoinWrap-${r.id}" style="display:${showJoining ? 'inline-flex' : 'none'};align-items:center;gap:6px;">
          <label>Joining Date</label>
          <input type="date" id="refPipeJoinDate-${r.id}" value="${r.joining_date || ''}">
        </span>
        <span id="refPipePayWrap-${r.id}" style="display:${showPayout ? 'inline-flex' : 'none'};align-items:center;gap:6px;">
          <label>Paid ₹</label>
          <input type="number" id="refPipePaidAmt-${r.id}" value="${r.paid_amount || 2000}" style="width:80px;">
          <label>Paid Date</label>
          <input type="date" id="refPipePaidDate-${r.id}" value="${r.paid_date || ''}">
        </span>
        <button class="ref-pipe-save" onclick="saveReferralPipelineRow(${r.id})">Save</button>
        <span id="refPipeMsg-${r.id}" style="font-size:0.76rem;font-weight:600;"></span>
      </div>
    </div>`;
}

function _refPipeToggleFields(id){
  const status   = document.getElementById('refPipeStatus-' + id).value;
  const joinWrap = document.getElementById('refPipeJoinWrap-' + id);
  const payWrap  = document.getElementById('refPipePayWrap-' + id);
  if (joinWrap) joinWrap.style.display = (status === 'Joined' || status === '90-Day Completed' || status === 'Incentive Paid') ? 'inline-flex' : 'none';
  if (payWrap)  payWrap.style.display  = (status === 'Incentive Paid' || status === '90-Day Completed') ? 'inline-flex' : 'none';
}

async function saveReferralPipelineRow(id){
  const msgEl   = document.getElementById('refPipeMsg-' + id);
  const status  = document.getElementById('refPipeStatus-' + id).value;
  const joinEl  = document.getElementById('refPipeJoinDate-' + id);
  const paidAmtEl  = document.getElementById('refPipePaidAmt-' + id);
  const paidDateEl = document.getElementById('refPipePaidDate-' + id);

  const patch = { status };
  if (joinEl && joinEl.value) patch.joining_date = joinEl.value;
  if (status === 'Incentive Paid'){
    patch.paid_flag = true;
    if (paidAmtEl  && paidAmtEl.value)  patch.paid_amount = Number(paidAmtEl.value);
    if (paidDateEl && paidDateEl.value) patch.paid_date   = paidDateEl.value;
  }
  if (status === '90-Day Completed') patch.eligible_flag = true;

  msgEl.style.color = 'var(--accent)'; msgEl.textContent = 'Saving…';
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/referrals?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...SB_HDRS(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t || ('Failed (' + res.status + ')')); }
    msgEl.style.color = 'var(--won)'; msgEl.textContent = '✅ Saved';
    setTimeout(()=>{ if (msgEl) msgEl.textContent = ''; }, 2500);
  } catch(e){
    msgEl.style.color = '#ff5c7c'; msgEl.textContent = '⚠️ ' + e.message;
  }
}

// ── HR / MIS: Post & manage openings ──────────────────────────
async function submitNewOpening(){
  if (!_canPostReferralRole()) { alert('⛔ You do not have permission to post a role.'); return; }
  const title  = document.getElementById('refNewTitle').value.trim();
  const count  = parseInt(document.getElementById('refNewCount').value) || 1;
  const dept   = document.getElementById('refNewDept').value.trim();
  const loc    = document.getElementById('refNewLoc').value.trim();
  const jd     = document.getElementById('refNewJD').value.trim();
  const jdUrl  = document.getElementById('refNewJdUrl').value.trim();
  const statusEl = document.getElementById('refNewStatus');

  if (!title || !loc){
    statusEl.style.display = 'block'; statusEl.style.background = '#ff5c7c1f'; statusEl.style.color = '#ff5c7c';
    statusEl.textContent = '⚠️ Role title and location are required.';
    return;
  }
  statusEl.style.display = 'block'; statusEl.style.background = '#f0a5001f'; statusEl.style.color = '#f0a500';
  statusEl.textContent = '⏳ Posting…';

  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/job_openings`, {
      method: 'POST',
      headers: { ...SB_HDRS(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        role_title: title, department: dept || null, location: loc, openings_count: count,
        jd_text: jd || null, jd_url: jdUrl || null, status: 'Open'
      })
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t || ('Failed (' + res.status + ')')); }
    statusEl.style.background = '#00d4aa1f'; statusEl.style.color = '#00d4aa';
    statusEl.textContent = '✅ Opening posted!';
    ['refNewTitle','refNewDept','refNewLoc','refNewJD','refNewJdUrl'].forEach(id=>{ const el=document.getElementById(id); if (el) el.value=''; });
    document.getElementById('refNewCount').value = 1;
    _refOpeningsLoaded = false;
    loadReferralOpenings();
    loadAdminOpeningsList();
  } catch(e){
    statusEl.style.background = '#ff5c7c1f'; statusEl.style.color = '#ff5c7c';
    statusEl.textContent = '❌ ' + e.message;
  }
}

async function loadAdminOpeningsList(){
  if (!_canPostReferralRole()) return;
  const wrap = document.getElementById('refAdminList');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">Loading…</div>';
  try{
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/job_openings?select=*&order=posted_date.desc`, { headers: SB_HDRS() });
    const rows = await res.json();
    if (!rows.length) { wrap.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">No openings posted yet.</div>'; return; }
    wrap.innerHTML = rows.map(o=>`
      <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;border:1px solid var(--border);border-radius:12px;margin-bottom:10px;background:var(--surface);flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <div style="font-weight:700;font-size:0.9rem;color:var(--text);">${o.role_title}</div>
          <div style="font-size:0.78rem;color:var(--muted);">${o.location || '—'} · ${o.department || '—'} · ${o.openings_count || 1} opening${(o.openings_count||1)===1?'':'s'}</div>
        </div>
        <span class="badge ${o.status === 'Open' ? 'badge-won' : 'badge-open'}">${o.status}</span>
        <button onclick="deleteOpening(${o.id},'${(o.role_title||'').replace(/'/g,"\\'")}')" style="padding:7px 12px;border-radius:8px;border:1.5px solid rgba(255,92,124,0.4);background:rgba(255,92,124,0.08);color:#ff5c7c;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;">
          Delete
        </button>
      </div>`).join('');
  } catch(e){
    wrap.innerHTML = '⚠️ ' + e.message;
  }
}

async function toggleOpeningStatus(id, newStatus){
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/job_openings?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...SB_HDRS(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: newStatus })
    });
    _refOpeningsLoaded = false;
    loadReferralOpenings();
    loadAdminOpeningsList();
  } catch(e){ alert('Could not update: ' + e.message); }
}

async function deleteOpening(id, title){
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/job_openings?id=eq.${id}`, {
      method: 'DELETE',
      headers: { ...SB_HDRS(), 'Prefer': 'return=minimal' }
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t || ('Failed (' + res.status + ')')); }
    _refOpeningsLoaded = false;
    loadReferralOpenings();
    loadAdminOpeningsList();
  } catch(e){ alert('Could not delete: ' + e.message); }
}

