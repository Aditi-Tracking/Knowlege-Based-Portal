// Section: Home Dashboard (employee profile photo)
// HR-editable card-grid sections ("Spotlight of the Month", "New Joiners", or
// any other box HR creates) moved to js/homeContent.js — loadHomeContentSections().
// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL UPLOAD SYSTEM
// Flow: choose section → pick/create card → pick file → upload to
//       Supabase Storage bucket "files" → insert row in "files" table
// ═══════════════════════════════════════════════════════════════════════════


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

