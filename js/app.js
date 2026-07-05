/* =============================================================
   Registre Carnaval — Main Application Logic
   ============================================================= */
(function () {
  'use strict';

  // ─── DOM helpers ────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ─── State ──────────────────────────────────────────────────
  let currentUser = null;   // firebase.User
  let currentRole = null;   // 'admin' | 'cap' | 'user'
  let currentUserProfile = null;    // users/{email} doc data (normal users)
  let currentCollaCode = null;      // selected colla code for registration
  let currentCollaName = null;
  let currentCollaId = null;        // Firestore doc id of selected colla
  let pendingRegistration = null;   // temp object before T&C
  let pendingPassword = null;       // account password during signup — memory only, never written
  let registrationInProgress = false; // suppress auth routing while signup docs are written
  let termsMode = 'signup';         // 'signup' | 'acceptance' (deferred T&C at login)
  let capColles = [];               // colles assigned to current cap
  let servicesCache = [];           // orderable services catalog (caps + admin)
  let capActiveCollaId = null;      // colla selected in the cap dashboard tabs
  let adminOrdersCache = [];        // all orders, for admin filtering/export
  let editingServiceId = null;      // service being edited in the admin form

  // ─── View switching ─────────────────────────────────────────
  function showView(id) {
    $$('.view').forEach(v => v.hidden = true);
    const view = $('#' + id);
    if (view) view.hidden = false;
    window.scrollTo(0, 0);
  }

  // ─── Toast notifications ────────────────────────────────────
  function toast(msg, type = 'info') {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // ─── Loading overlay ───────────────────────────────────────
  function showLoading() {
    let overlay = $('#loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(overlay);
    }
    overlay.hidden = false;
  }
  function hideLoading() {
    const overlay = $('#loading-overlay');
    if (overlay) overlay.hidden = true;
  }

  // ─── Password generator ────────────────────────────────────
  function generatePassword(len = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
  }

  // ─── 6-char code generator ─────────────────────────────────
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
  }

  // ─── Ensure unique code ────────────────────────────────────
  async function generateUniqueCode() {
    let code, exists = true;
    while (exists) {
      code = generateCode();
      const snap = await db.collection('colles').where('code', '==', code).get();
      exists = !snap.empty;
    }
    return code;
  }

  // ═══════════════════════════════════════════════════════════
  //  1. REGISTER STEP 1 — Colla code validation
  // ═══════════════════════════════════════════════════════════
  function initLanding() {
    const input = $('#code-input');
    const btnValidate = $('#btn-validate-code');
    const btnBack = $('#btn-code-back');
    const error = $('#landing-error');

    // Auto-uppercase
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    btnValidate.addEventListener('click', async () => {
      const code = input.value.trim();
      if (code.length !== 6) {
        error.textContent = 'El codi ha de tenir 6 caràcters.';
        error.hidden = false;
        return;
      }
      error.hidden = true;
      showLoading();
      try {
        const snap = await db.collection('colles').where('code', '==', code).get();
        if (snap.empty) {
          error.textContent = 'Codi no vàlid. Comprova que l\'has escrit correctament.';
          error.hidden = false;
          hideLoading();
          return;
        }
        const collaDoc = snap.docs[0].data();
        currentCollaCode = code;
        currentCollaName = collaDoc.name;
        currentCollaId = snap.docs[0].id;
        $('#register-colla-name').textContent = 'Colla: ' + collaDoc.name;
        showView('view-register');
      } catch (e) {
        error.textContent = 'Error de connexió. Torna-ho a provar.';
        error.hidden = false;
        console.error(e);
      }
      hideLoading();
    });

    // Enter key on code input
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') btnValidate.click();
    });

    btnBack.addEventListener('click', () => {
      error.hidden = true;
      showView('view-login');
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  2. REGISTRATION FORM
  // ═══════════════════════════════════════════════════════════
  function initRegistration() {
    const form = $('#register-form');
    const error = $('#register-error');

    $('#btn-register-back').addEventListener('click', () => {
      showView('view-landing');
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      error.hidden = true;

      const name      = $('#reg-name').value.trim();
      const surname   = $('#reg-surname').value.trim();
      const id        = $('#reg-id').value.trim();
      const email     = $('#reg-email').value.trim().toLowerCase();
      const phone     = $('#reg-phone').value.trim();
      const password  = $('#reg-password').value;
      const password2 = $('#reg-password2').value;

      // Validation
      if (!name || !surname || !id || !email || !phone || !password) {
        error.textContent = 'Tots els camps són obligatoris.';
        error.hidden = false;
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        error.textContent = 'El correu electrònic no és vàlid.';
        error.hidden = false;
        return;
      }
      if (!/^[0-9+\-\s]{6,15}$/.test(phone)) {
        error.textContent = 'El número de telèfon no és vàlid.';
        error.hidden = false;
        return;
      }
      if (password.length < 6) {
        error.textContent = 'La contrasenya ha de tenir com a mínim 6 caràcters.';
        error.hidden = false;
        return;
      }
      if (password !== password2) {
        error.textContent = 'Les contrasenyes no coincideixen.';
        error.hidden = false;
        return;
      }

      // Password is kept out of pendingRegistration: that object is spread
      // straight into the Firestore write and must never carry it
      pendingPassword = password;
      pendingRegistration = { name, surname, idNumber: id, email, phone, collaCode: currentCollaCode, collaName: currentCollaName, collaId: currentCollaId };

      // Show confirmation
      $('#confirm-name').textContent = name;
      $('#confirm-surname').textContent = surname;
      $('#confirm-id').textContent = id;
      $('#confirm-email').textContent = email;
      $('#confirm-phone').textContent = phone;
      showView('view-confirm');
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  3. CONFIRMATION
  // ═══════════════════════════════════════════════════════════
  function initConfirmation() {
    $('#btn-confirm-back').addEventListener('click', () => {
      showView('view-register');
    });

    $('#btn-confirm-submit').addEventListener('click', async () => {
      if (!pendingRegistration) return;
      showLoading();
      try {
        const collaDoc = await db.collection('colles').doc(currentCollaId).get();
        const colla = collaDoc.exists ? collaDoc.data() : null;
        if (colla && colla.pdfUrl) {
          // Colla has published T&C — scroll-accept before anything is written
          $('#terms-pdf').src = colla.pdfUrl;
          termsMode = 'signup';
          $('#btn-terms-save').textContent = 'Desar';
          showView('view-terms');
          resetTermsView();
        } else {
          // No T&C published yet — register now; the member will be prompted
          // to accept at login once the colla uploads its document
          const reg = pendingRegistration;
          pendingRegistration = null; // guard against double-click double writes
          const ok = await completeRegistration(reg, false);
          if (!ok) pendingRegistration = reg; // restore so the user can retry
        }
      } catch (e) {
        toast('Error de connexió. Torna-ho a provar.', 'error');
        console.error(e);
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  4. TERMS & CONDITIONS — scroll gating
  // ═══════════════════════════════════════════════════════════
  function checkTermsScroll() {
    const container = $('#terms-scroll-container');
    // Check if scrolled to bottom (with 20px tolerance)
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
    if (atBottom) {
      $('#tc-checkbox').disabled = false;
      $('#terms-hint').hidden = true;
    }
  }

  // Called each time the terms view is shown
  function resetTermsView() {
    const checkbox = $('#tc-checkbox');
    checkbox.checked = false;
    checkbox.disabled = true;
    $('#btn-terms-save').disabled = true;
    $('#terms-hint').hidden = false;
    $('#terms-scroll-container').scrollTop = 0;
    // Also check shortly after in case content is short
    setTimeout(checkTermsScroll, 500);
  }

  // Called once at startup — listeners must not stack across registrations
  function initTerms() {
    const container = $('#terms-scroll-container');
    const checkbox = $('#tc-checkbox');
    const btnSave = $('#btn-terms-save');

    container.addEventListener('scroll', checkTermsScroll);

    checkbox.addEventListener('change', () => {
      btnSave.disabled = !checkbox.checked;
    });

    btnSave.addEventListener('click', async () => {
      if (!checkbox.checked) return;

      // Acceptance mode: an existing member accepting newly published T&C
      if (termsMode === 'acceptance') {
        await acceptPendingTerms();
        return;
      }

      // Signup mode: finish the registration
      const reg = pendingRegistration;
      if (!reg) return;
      pendingRegistration = null; // guard against double-click double writes
      showLoading();
      const ok = await completeRegistration(reg, true);
      if (!ok) pendingRegistration = reg; // restore so the user can retry
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  4b. COMPLETE REGISTRATION — account + registration + profile
  // ═══════════════════════════════════════════════════════════
  // `accepted` is false only when the colla has no published T&C yet:
  // the registration is written with tcAccepted:false and the profile
  // gets tcPending:true so login prompts for acceptance later.
  // Returns true on success, false on failure (caller restores state).
  async function completeRegistration(reg, accepted) {
    // Account creation fires onAuthStateChanged before the profile docs
    // exist — the listener must not route (and sign out) mid-signup
    registrationInProgress = true;
    try {
      // 1. Create the Auth account (skip when retrying after a partial failure)
      if (!auth.currentUser || (auth.currentUser.email || '').toLowerCase() !== reg.email) {
        await auth.createUserWithEmailAndPassword(reg.email, pendingPassword);
      }

      // 2. A profile with a regId means this person is already registered
      //    (backfilled legacy registration) — link the account, don't duplicate
      const profileRef = db.collection('users').doc(reg.email);
      const profileSnap = await profileRef.get();
      const existing = profileSnap.exists ? profileSnap.data() : null;
      let tcDeferred = false; // show the "we'll ask you later" note only when true

      if (existing && existing.regId) {
        // Legacy registrations were already accepted — nothing deferred here
        await profileRef.set({ name: reg.name, surname: reg.surname }, { merge: true });
        if (existing.collaId !== reg.collaId) {
          toast(`Aquest correu ja estava registrat a la colla "${existing.collaName || existing.collaCode || ''}". El compte s'ha vinculat a aquella colla.`, 'info');
        }
      } else {
        const regDoc = await db.collection('registrations').add({
          ...reg,
          tcAccepted: accepted,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        const profile = {
          email: reg.email,
          name: reg.name,
          surname: reg.surname,
          collaId: reg.collaId,
          collaCode: reg.collaCode,
          collaName: reg.collaName,
          regId: regDoc.id,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (!accepted) {
          profile.tcPending = true;
          tcDeferred = true;
        }
        await profileRef.set(profile);
      }

      pendingPassword = null;
      registrationInProgress = false;
      $('#success-tc-note').hidden = !tcDeferred;
      showView('view-success');
      $('#register-form').reset();
      return true;
    } catch (e) {
      registrationInProgress = false;
      let msg = 'Error desant. Torna-ho a provar.';
      if (e.code === 'auth/email-already-in-use') {
        msg = 'Ja existeix un compte amb aquest correu. Inicia sessió.';
        showView('view-login'); // the terms/confirm views have no way back
      } else if (e.code === 'auth/weak-password') {
        msg = 'La contrasenya és massa dèbil (mínim 6 caràcters).';
      }
      toast(msg, 'error');
      console.error(e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  4c. DEFERRED T&C ACCEPTANCE — prompt at login
  // ═══════════════════════════════════════════════════════════
  // Shows the terms view in acceptance mode if the member registered
  // before their colla published its T&C and the document now exists.
  // Returns true when the prompt was shown (dashboard load is deferred).
  async function maybePromptPendingTerms(profile) {
    if (!profile.tcPending || !profile.regId || !profile.collaId) return false;
    try {
      const collaDoc = await db.collection('colles').doc(profile.collaId).get();
      const colla = collaDoc.exists ? collaDoc.data() : null;
      if (!colla || !colla.pdfUrl) return false; // still nothing to accept
      termsMode = 'acceptance';
      $('#terms-pdf').src = colla.pdfUrl;
      $('#btn-terms-save').textContent = 'Acceptar';
      showView('view-terms');
      resetTermsView();
      return true;
    } catch (e) {
      console.warn('Could not check pending terms:', e);
      return false;
    }
  }

  async function acceptPendingTerms() {
    const profile = currentUserProfile;
    if (!profile || !profile.regId) return;
    showLoading();
    try {
      // Rules only allow the member to flip their own tcAccepted to true
      await db.collection('registrations').doc(profile.regId).update({ tcAccepted: true });
      await db.collection('users').doc(profile.email).update({
        tcPending: firebase.firestore.FieldValue.delete()
      });
      delete currentUserProfile.tcPending;
      termsMode = 'signup';
      $('#btn-terms-save').textContent = 'Desar';
      toast('Termes i Condicions acceptats. Gràcies!', 'success');
      showUserDashboard();
    } catch (e) {
      toast('Error desant l\'acceptació. Torna-ho a provar.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  // ═══════════════════════════════════════════════════════════
  //  5. SUCCESS
  // ═══════════════════════════════════════════════════════════
  function initSuccess() {
    $('#btn-success-home').addEventListener('click', async () => {
      currentCollaCode = null;
      currentCollaName = null;
      currentCollaId = null;
      $('#code-input').value = '';
      if (auth.currentUser) {
        showLoading();
        await routeUser(auth.currentUser);
      } else {
        showView('view-login');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  6. LOGIN
  // ═══════════════════════════════════════════════════════════
  function initLogin() {
    const form = $('#login-form');
    const error = $('#login-error');

    // Password eye toggle
    const eyeOpen = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeClosed = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    $$('.pw-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $('#' + btn.dataset.target);
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = isPassword ? eyeClosed : eyeOpen;
      });
    });

    // First-time users go to the register flow (colla code first)
    $('#btn-go-register').addEventListener('click', () => {
      error.hidden = true;
      showView('view-landing');
    });

    // Self-service password reset (serves participants and caps alike)
    $('#btn-forgot-password').addEventListener('click', async () => {
      const email = $('#login-email').value.trim().toLowerCase();
      if (!email) {
        error.textContent = 'Escriu el teu correu al camp de dalt i torna a clicar l\'enllaç.';
        error.hidden = false;
        return;
      }
      showLoading();
      try {
        await auth.sendPasswordResetEmail(email);
        error.hidden = true;
        toast(`Correu de restabliment enviat a ${email}.`, 'success');
      } catch (e) {
        error.textContent = 'No s\'ha pogut enviar el correu de restabliment.';
        error.hidden = false;
        console.error(e);
      }
      hideLoading();
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      error.hidden = true;
      const email = $('#login-email').value.trim().toLowerCase();
      const password = $('#login-password').value;

      if (!email || !password) {
        error.textContent = 'Introdueix el correu i la contrasenya.';
        error.hidden = false;
        return;
      }

      showLoading();
      try {
        await auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged will handle routing
        form.reset();
      } catch (e) {
        let msg = 'Error d\'autenticació. Comprova les credencials.';
        if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
          msg = 'Correu o contrasenya incorrectes.';
        } else if (e.code === 'auth/too-many-requests') {
          msg = 'Massa intents. Espera uns minuts.';
        }
        error.textContent = msg;
        error.hidden = false;
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  AUTH ROUTING — admin > cap > user, else sign out
  // ═══════════════════════════════════════════════════════════
  async function routeUser(user) {
    currentUser = user;
    const email = user.email.toLowerCase();

    // Check if admin
    const adminDoc = await db.collection('admins').doc(email).get();
    if (adminDoc.exists) {
      currentRole = 'admin';
      $('#admin-user-label').textContent = email;
      showView('view-admin-dashboard');
      await runMigrations();
      loadAdminData();
      hideLoading();
      return;
    }

    // Check if cap de colla (caps are keyed by email)
    const capDoc = await db.collection('caps').doc(email).get();
    if (capDoc.exists) {
      currentRole = 'cap';
      const capData = capDoc.data();
      $('#cap-user-label').textContent = capData.name || email;
      showView('view-cap-dashboard');
      loadCapData(email);
      hideLoading();
      return;
    }

    // Check if registered member (users are keyed by email)
    const profileDoc = await db.collection('users').doc(email).get();
    if (profileDoc.exists) {
      currentRole = 'user';
      currentUserProfile = { id: profileDoc.id, ...profileDoc.data() };
      // Registered before the colla published its T&C? Prompt now if possible
      const prompted = await maybePromptPendingTerms(currentUserProfile);
      if (!prompted) showUserDashboard();
      hideLoading();
      return;
    }

    // Unknown role — sign out
    toast('No tens permisos per accedir.', 'error');
    await auth.signOut();
    hideLoading();
  }

  function initAuthListener() {
    auth.onAuthStateChanged(async user => {
      // Mid-signup the account exists but the profile docs don't yet —
      // routing now would hit the sign-out branch
      if (registrationInProgress) return;
      if (!user) {
        currentUser = null;
        currentRole = null;
        currentUserProfile = null;
        return;
      }
      await routeUser(user);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  ONE-TIME MIGRATIONS — run on admin login, guarded by marker
  // ═══════════════════════════════════════════════════════════
  async function runMigrations() {
    try {
      const marker = await db.collection('meta').doc('migrations').get();
      const version = marker.exists ? (marker.data().v || 0) : 0;
      if (version >= 2) return;

      if (version < 1) {
        // v1.1. Caps: re-key docs by email, drop stored plaintext passwords
        const capsSnap = await db.collection('caps').get();
        for (const doc of capsSnap.docs) {
          const d = doc.data();
          if (!d.email) continue;
          if (doc.id !== d.email) {
            const { plainPassword, ...rest } = d;
            await db.collection('caps').doc(d.email).set(rest, { merge: true });
            await doc.ref.delete();
          } else if (d.plainPassword !== undefined) {
            await doc.ref.update({ plainPassword: firebase.firestore.FieldValue.delete() });
          }
        }

        // v1.2. Registrations: backfill collaId from collaCode
        const collesSnap = await db.collection('colles').get();
        const codeToId = {};
        collesSnap.docs.forEach(c => { codeToId[c.data().code] = c.id; });
        const regsSnap = await db.collection('registrations').get();
        for (const doc of regsSnap.docs) {
          const d = doc.data();
          if (!d.collaId && codeToId[d.collaCode]) {
            await doc.ref.update({ collaId: codeToId[d.collaCode] });
          }
        }
      }

      if (version < 2) {
        // v2. Backfill users/{email} member profiles from legacy registrations
        // so their names show in colla member lists and a later signup links
        // to the existing registration. Duplicate emails: first one wins.
        // Registrations pointing at deleted colles are skipped — the create
        // rule requires the colla to exist and one failure would abort the loop.
        const collesSnap2 = await db.collection('colles').get();
        const collaIds = {};
        collesSnap2.docs.forEach(c => { collaIds[c.id] = true; });
        const regsSnap = await db.collection('registrations').get();
        for (const doc of regsSnap.docs) {
          const d = doc.data();
          if (!d.email || !d.collaId || !collaIds[d.collaId]) continue;
          const email = d.email.toLowerCase();
          const ref = db.collection('users').doc(email);
          const existing = await ref.get();
          if (existing.exists) continue;
          await ref.set({
            email: email,
            name: d.name || '',
            surname: d.surname || '',
            collaId: d.collaId,
            collaCode: d.collaCode || '',
            collaName: d.collaName || '',
            regId: doc.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      await db.collection('meta').doc('migrations').set({
        v: 2,
        ranAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('Migrations completed (v2)');
    } catch (e) {
      console.warn('Migration error:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  7. CAP DE COLLA DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async function loadCapData(email) {
    showLoading();
    try {
      // Get colles assigned to this cap (capEmails is an array)
      const collesSnap = await db.collection('colles').where('capEmails', 'array-contains', email).get();
      capColles = collesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (capColles.length === 0) {
        $('#cap-table-body').innerHTML = '';
        $('#cap-table-empty').hidden = false;
        $('#cap-colla-tabs').innerHTML = '<p style="color:var(--text-secondary);font-size:.9rem;">No tens cap colla assignada.</p>';
        hideLoading();
        return;
      }

      // Render colla tabs
      renderCollaTabs();
      capActiveCollaId = capColles[0].id;
      // Load registrations + orders + posts for the first colla by default
      await loadServices();
      renderOrderCatalog();
      await loadCapRegistrations(capActiveCollaId);
      loadCapOrders(capActiveCollaId);
      loadCapPosts(capActiveCollaId);
    } catch (e) {
      toast('Error carregant dades.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  function renderCollaTabs() {
    const container = $('#cap-colla-tabs');
    container.innerHTML = '';
    capColles.forEach((colla, i) => {
      const btn = document.createElement('button');
      btn.className = 'colla-tab' + (i === 0 ? ' active' : '');
      btn.textContent = colla.name + ' (' + colla.code + ')';
      btn.dataset.code = colla.code;
      btn.dataset.collaId = colla.id;
      btn.addEventListener('click', () => {
        $$('.colla-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        capActiveCollaId = colla.id;
        loadCapRegistrations(colla.id);
        loadCapOrders(colla.id);
        loadCapPosts(colla.id);
        updatePdfStatus(colla.id);
      });
      container.appendChild(btn);
    });
    // Load PDF status for first colla
    if (capColles.length > 0) {
      updatePdfStatus(capColles[0].id);
    }
  }

  async function loadCapRegistrations(collaId) {
    const tbody = $('#cap-table-body');
    const empty = $('#cap-table-empty');
    tbody.innerHTML = '';
    updateCapRegCounts();

    try {
      // Query by collaId: security rules verify cap membership via the colla doc
      const snap = await db.collection('registrations')
        .where('collaId', '==', collaId)
        .orderBy('timestamp', 'desc')
        .get();

      if (snap.empty) {
        empty.hidden = false;
        return;
      }
      empty.hidden = true;

      snap.docs.forEach(doc => {
        const d = doc.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.surname)}</td>
          <td>${escapeHtml(d.idNumber)}</td>
          <td>${escapeHtml(d.email)}</td>
          <td>${escapeHtml(d.phone)}</td>
          <td><input type="checkbox" class="reg-paid" data-id="${doc.id}" ${d.paid ? 'checked' : ''} title="Pagament"></td>
          <td>${formatTimestamp(d.timestamp)}</td>
          <td><button class="btn btn-danger btn-small btn-delete-reg" data-id="${doc.id}">Eliminar</button></td>
        `;
        // dataset assignment keeps user-provided emails out of the HTML string
        tr.querySelector('.btn-delete-reg').dataset.email = d.email || '';
        tbody.appendChild(tr);
      });
      updateCapRegCounts();
    } catch (e) {
      toast('Error carregant registres.', 'error');
      console.error(e);
    }
  }

  // Counts above the Pagament column: total registered / total paid
  function updateCapRegCounts() {
    const boxes = $$('#cap-table-body .reg-paid');
    const paid = boxes.filter(b => b.checked).length;
    $('#cap-reg-counts').textContent = `👥 ${boxes.length} registrats · 💰 ${paid} pagaments`;
  }

  // Remove the member profile linked to a deleted registration (best effort)
  async function removeLinkedProfile(email, regId) {
    if (!email) return;
    try {
      const ref = db.collection('users').doc(email.toLowerCase());
      const snap = await ref.get();
      if (snap.exists && snap.data().regId === regId) await ref.delete();
    } catch (e) {
      console.warn('Could not remove linked member profile:', e);
    }
  }

  function initCapDashboard() {
    // Logout
    $('#btn-cap-logout').addEventListener('click', async () => {
      await auth.signOut();
      showView('view-login');
    });

    // Delete registration (delegated)
    $('#cap-table-body').addEventListener('click', async e => {
      const btn = e.target.closest('.btn-delete-reg');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquest registre?')) return;
      showLoading();
      try {
        await db.collection('registrations').doc(btn.dataset.id).delete();
        await removeLinkedProfile(btn.dataset.email, btn.dataset.id);
        btn.closest('tr').remove();
        toast('Registre eliminat.', 'success');
        updateCapRegCounts();
        // Check if table is now empty
        if ($('#cap-table-body').children.length === 0) {
          $('#cap-table-empty').hidden = false;
        }
      } catch (e) {
        toast('Error eliminant el registre.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // Pagament checkbox (delegated)
    $('#cap-table-body').addEventListener('change', async e => {
      const box = e.target.closest('.reg-paid');
      if (!box) return;
      const paid = box.checked;
      box.disabled = true;
      try {
        await db.collection('registrations').doc(box.dataset.id).update({ paid: paid });
        updateCapRegCounts();
      } catch (err) {
        box.checked = !paid; // revert
        toast('Error desant el pagament.', 'error');
        console.error(err);
      }
      box.disabled = false;
    });

    // Export to Excel
    $('#btn-cap-export').addEventListener('click', () => exportCapExcel());

    // ── PDF Upload (Firebase Storage) ──
    // Custom file chooser button
    $('#btn-cap-pdf-choose').addEventListener('click', () => {
      $('#cap-pdf-input').click();
    });
    $('#cap-pdf-input').addEventListener('change', () => {
      const file = $('#cap-pdf-input').files[0];
      $('#cap-pdf-filename').textContent = file ? file.name : 'Cap arxiu seleccionat';
    });

    $('#btn-cap-pdf-upload').addEventListener('click', async () => {
      const activeTab = $('.colla-tab.active');
      if (!activeTab) { toast('Selecciona una colla primer.', 'error'); return; }
      const collaId = activeTab.dataset.collaId;
      const fileInput = $('#cap-pdf-input');
      const file = fileInput.files[0];
      if (!file) { toast('Selecciona un fitxer primer.', 'error'); return; }

      showLoading();
      try {
        const ref = storage.ref(`terms/${collaId}/${file.name}`);
        const snapshot = await ref.put(file);
        const url = await snapshot.ref.getDownloadURL();
        await db.collection('colles').doc(collaId).update({
          pdfUrl: url,
          pdfName: file.name
        });
        toast('PDF pujat correctament!', 'success');
        updatePdfStatus(collaId);
        fileInput.value = '';
        $('#cap-pdf-filename').textContent = 'Cap arxiu seleccionat';
      } catch (e) {
        toast('Error pujant el PDF.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    $('#btn-cap-pdf-remove').addEventListener('click', async () => {
      const activeTab = $('.colla-tab.active');
      if (!activeTab) return;
      const collaId = activeTab.dataset.collaId;
      if (!confirm('Segur que vols eliminar el PDF?')) return;

      showLoading();
      try {
        const collaDoc = await db.collection('colles').doc(collaId).get();
        const data = collaDoc.data();
        if (data.pdfUrl) {
          try {
            const ref = storage.refFromURL(data.pdfUrl);
            await ref.delete();
          } catch (e) { /* file may already be deleted */ }
        }
        await db.collection('colles').doc(collaId).update({
          pdfUrl: firebase.firestore.FieldValue.delete(),
          pdfName: firebase.firestore.FieldValue.delete()
        });
        toast('PDF eliminat.', 'success');
        updatePdfStatus(collaId);
      } catch (e) {
        toast('Error eliminant PDF.', 'error');
        console.error(e);
      }
      hideLoading();
    });
  }

  async function updatePdfStatus(collaId) {
    try {
      const doc = await db.collection('colles').doc(collaId).get();
      const data = doc.data();
      const status = $('#cap-pdf-status');
      const removeBtn = $('#btn-cap-pdf-remove');
      if (data && data.pdfUrl) {
        status.innerHTML = `✅ Document actual: <strong>${escapeHtml(data.pdfName || 'terms.pdf')}</strong>`;
        removeBtn.hidden = false;
      } else {
        status.textContent = 'Cap document pujat encara. Els nous registres queden pendents d\'acceptar els termes fins que pugis un document (se\'ls demanarà en iniciar sessió).';
        removeBtn.hidden = true;
      }
    } catch (e) {
      console.warn('Error checking PDF status:', e);
    }
  }

  async function exportCapExcel() {
    const activeTab = $('.colla-tab.active');
    if (!activeTab) { toast('Selecciona una colla primer.', 'error'); return; }
    const code = activeTab.dataset.code;
    const collaId = activeTab.dataset.collaId;

    showLoading();
    try {
      const snap = await db.collection('registrations')
        .where('collaId', '==', collaId)
        .orderBy('timestamp', 'desc')
        .get();

      const rows = snap.docs.map(doc => {
        const d = doc.data();
        return {
          'Nom': d.name,
          'Cognoms': d.surname,
          'DNI/NIE/Passaport': d.idNumber,
          'Correu': d.email,
          'Telèfon': d.phone,
          'Pagament': d.paid ? 'Sí' : 'No',
          'Colla': d.collaName || '',
          'Data registre': formatTimestamp(d.timestamp)
        };
      });

      if (rows.length === 0) {
        toast('No hi ha dades per exportar.', 'info');
        hideLoading();
        return;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Registres');
      XLSX.writeFile(wb, `registres_${code}.xlsx`);
      toast('Excel descarregat!', 'success');
    } catch (e) {
      toast('Error exportant.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  // ═══════════════════════════════════════════════════════════
  //  7b. COMANDES (CAP) — service catalog + orders
  // ═══════════════════════════════════════════════════════════
  const CATEGORY_LABELS = { menjar: '🍖 Menjar', beguda: '🍹 Beguda', gel: '🧊 Gel', altres: '📦 Altres' };

  function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || cat || '📦 Altres';
  }

  async function loadServices() {
    try {
      const snap = await db.collection('services').get();
      servicesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      servicesCache.sort((a, b) =>
        (a.category || '').localeCompare(b.category || '') ||
        (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
      console.error('Error loading services:', e);
    }
  }

  function renderOrderCatalog() {
    const container = $('#cap-service-catalog');
    container.innerHTML = '';
    if (servicesCache.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);font-size:.9rem;">No hi ha serveis disponibles.</p>';
      updateOrderTotal();
      return;
    }
    let grid = null, lastCat = null;
    servicesCache.forEach(s => {
      if (s.category !== lastCat) {
        lastCat = s.category;
        const h = document.createElement('h3');
        h.className = 'service-category-title';
        h.textContent = categoryLabel(s.category);
        container.appendChild(h);
        grid = document.createElement('div');
        grid.className = 'service-grid';
        container.appendChild(grid);
      }
      const price = Number(s.price) || 0;
      const card = document.createElement('div');
      card.className = 'service-card';
      card.innerHTML = `
        ${s.imageUrl
          ? `<img src="${escapeHtml(s.imageUrl)}" alt="" class="service-card-img">`
          : '<div class="service-card-img service-card-img-placeholder">🛒</div>'}
        <div class="service-card-name">${escapeHtml(s.name)}</div>
        <div class="service-card-price">${price.toFixed(2)} € / ${escapeHtml(s.unit || 'unitat')}</div>
        <input type="number" class="service-qty" data-service-id="${s.id}" min="0" step="1" value="0">
      `;
      grid.appendChild(card);
    });
    updateOrderTotal();
  }

  function collectOrderItems() {
    const items = [];
    $$('.service-qty').forEach(inp => {
      const qty = parseInt(inp.value, 10) || 0;
      if (qty <= 0) return;
      const s = servicesCache.find(x => x.id === inp.dataset.serviceId);
      if (!s) return;
      items.push({
        serviceId: s.id,
        serviceName: s.name,
        unitPrice: Number(s.price) || 0,
        unit: s.unit || 'unitat',
        category: s.category || '',
        quantity: qty
      });
    });
    return items;
  }

  function updateOrderTotal() {
    const total = collectOrderItems().reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    $('#cap-order-total').textContent = total.toFixed(2) + ' €';
  }

  async function submitCapOrder() {
    if (!capActiveCollaId) { toast('Selecciona una colla primer.', 'error'); return; }
    const items = collectOrderItems();
    if (items.length === 0) { toast('Afegeix alguna quantitat primer.', 'error'); return; }
    const colla = capColles.find(c => c.id === capActiveCollaId);
    const total = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);

    showLoading();
    try {
      await db.collection('orders').add({
        collaId: capActiveCollaId,
        collaCode: colla ? colla.code : '',
        collaName: colla ? colla.name : '',
        capEmail: currentUser.email.toLowerCase(),
        items: items,
        total: Math.round(total * 100) / 100,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast('Comanda enviada!', 'success');
      renderOrderCatalog(); // resets quantities to 0
      loadCapOrders(capActiveCollaId);
    } catch (e) {
      toast('Error enviant la comanda.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  function orderItemsSummary(items) {
    return (items || []).map(it => `${it.quantity}× ${it.serviceName}`).join(', ');
  }

  async function loadCapOrders(collaId) {
    const tbody = $('#cap-orders-body');
    const empty = $('#cap-orders-empty');
    tbody.innerHTML = '';

    try {
      const snap = await db.collection('orders')
        .where('collaId', '==', collaId)
        .orderBy('createdAt', 'desc')
        .get();

      if (snap.empty) { empty.hidden = false; return; }
      empty.hidden = true;

      snap.docs.forEach(doc => {
        const d = doc.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${formatTimestamp(d.createdAt)}</td>
          <td>${escapeHtml(orderItemsSummary(d.items))}</td>
          <td>${(Number(d.total) || 0).toFixed(2)} €</td>
          <td><button class="btn btn-danger btn-small btn-delete-order" data-id="${doc.id}">Eliminar</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toast('Error carregant comandes.', 'error');
      console.error(e);
    }
  }

  // Sub-nav: Registres / Comandes / Publicacions
  function initCapSubnav() {
    const tabs = [
      { btn: '#btn-cap-tab-registres', section: '#cap-section-registres' },
      { btn: '#btn-cap-tab-comandes', section: '#cap-section-comandes' },
      { btn: '#btn-cap-tab-publicacions', section: '#cap-section-publicacions' }
    ];
    tabs.forEach(t => {
      $(t.btn).addEventListener('click', () => {
        tabs.forEach(o => {
          $(o.btn).classList.toggle('active', o === t);
          $(o.section).hidden = o !== t;
        });
      });
    });
  }

  function initCapOrders() {
    // Live total while typing quantities (delegated)
    $('#cap-service-catalog').addEventListener('input', e => {
      if (e.target.classList.contains('service-qty')) updateOrderTotal();
    });

    $('#btn-cap-order-submit').addEventListener('click', submitCapOrder);

    // Delete own order (delegated)
    $('#cap-orders-body').addEventListener('click', async e => {
      const btn = e.target.closest('.btn-delete-order');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquesta comanda?')) return;
      showLoading();
      try {
        await db.collection('orders').doc(btn.dataset.id).delete();
        toast('Comanda eliminada.', 'success');
        loadCapOrders(capActiveCollaId);
      } catch (err) {
        toast('Error eliminant la comanda.', 'error');
        console.error(err);
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  7c. PUBLICACIONS (CAP) — colla-page posts
  // ═══════════════════════════════════════════════════════════
  // Extract the 11-char video id from any YouTube URL form (watch/shorts/embed/youtu.be)
  function youtubeEmbedId(url) {
    const m = (url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : null;
  }

  // Shared renderer: cap list (with pin/delete controls) and user feed (read-only)
  function renderPostsList(container, emptyEl, posts, withControls) {
    container.innerHTML = '';
    emptyEl.hidden = posts.length > 0;
    // Pinned first; the stable sort keeps newest-first order within each group
    const sorted = [...posts].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    sorted.forEach(p => {
      // Only render http(s) links — anything else is dropped
      const url = (p.url && /^https?:\/\//i.test(p.url)) ? p.url : null;
      const ytId = url ? youtubeEmbedId(url) : null;
      const card = document.createElement('div');
      card.className = 'post-card' + (p.pinned ? ' post-card-pinned' : '');
      card.innerHTML = `
        <div class="post-card-head">
          <span class="post-card-title">${p.pinned ? '📌 ' : ''}${escapeHtml(p.title)}</span>
          <span class="post-card-date">${formatTimestamp(p.createdAt)}</span>
        </div>
        ${p.body ? `<p class="post-card-body">${escapeHtml(p.body)}</p>` : ''}
        ${p.imageUrl ? `<a href="${escapeHtml(p.imageUrl)}" target="_blank" rel="noopener"><img class="post-card-img" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy"></a>` : ''}
        ${ytId
          ? `<div class="post-card-video"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}" title="YouTube" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
          : (url ? `<a class="post-card-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">🔗 ${escapeHtml(url)}</a>` : '')}
        ${withControls ? `<div class="post-card-actions">
          <button class="btn btn-outline btn-small btn-pin-post" data-id="${p.id}" data-pinned="${p.pinned ? 1 : 0}">${p.pinned ? 'Desfixar' : '📌 Fixar'}</button>
          <button class="btn btn-danger btn-small btn-delete-post" data-id="${p.id}">Eliminar</button>
        </div>` : ''}
      `;
      container.appendChild(card);
    });
  }

  async function loadCapPosts(collaId) {
    try {
      const snap = await db.collection('posts')
        .where('collaId', '==', collaId)
        .orderBy('createdAt', 'desc')
        .get();
      renderPostsList($('#cap-posts-list'), $('#cap-posts-empty'),
        snap.docs.map(d => ({ id: d.id, ...d.data() })), true);
    } catch (e) {
      toast('Error carregant publicacions.', 'error');
      console.error(e);
    }
  }

  function resetPostForm() {
    $('#cap-post-form').reset();
    $('#post-image-input').value = '';
    $('#post-image-filename').textContent = 'Cap arxiu';
  }

  function initCapPosts() {
    // Image chooser
    $('#btn-post-image-choose').addEventListener('click', () => $('#post-image-input').click());
    $('#post-image-input').addEventListener('change', () => {
      const file = $('#post-image-input').files[0];
      $('#post-image-filename').textContent = file ? file.name : 'Cap arxiu';
    });

    $('#cap-post-form').addEventListener('submit', async e => {
      e.preventDefault();
      if (!capActiveCollaId) { toast('Selecciona una colla primer.', 'error'); return; }
      const title = $('#post-title').value.trim();
      const body = $('#post-body').value.trim();
      const url = $('#post-url').value.trim();
      if (!title) return;
      if (url && !/^https?:\/\//i.test(url)) {
        toast('L\'enllaç ha de començar per http:// o https://', 'error');
        return;
      }
      showLoading();
      try {
        const data = {
          collaId: capActiveCollaId,
          title: title,
          authorEmail: currentUser.email.toLowerCase(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (body) data.body = body;
        if (url) data.url = url;

        const file = $('#post-image-input').files[0];
        if (file) {
          const path = `posts/${capActiveCollaId}/${Date.now()}_${file.name}`;
          const snapshot = await storage.ref(path).put(file);
          data.imageUrl = await snapshot.ref.getDownloadURL();
          data.imagePath = path;
        }

        await db.collection('posts').add(data);
        toast('Publicació creada.', 'success');
        resetPostForm();
        loadCapPosts(capActiveCollaId);
      } catch (err) {
        toast('Error creant la publicació.', 'error');
        console.error(err);
      }
      hideLoading();
    });

    // Pin/unpin + delete (delegated)
    $('#cap-posts-list').addEventListener('click', async e => {
      const btnPin = e.target.closest('.btn-pin-post');
      if (btnPin) {
        const pinned = btnPin.dataset.pinned !== '1';
        showLoading();
        try {
          await db.collection('posts').doc(btnPin.dataset.id).update({ pinned: pinned });
          loadCapPosts(capActiveCollaId);
        } catch (err) {
          toast('Error fixant la publicació.', 'error');
          console.error(err);
        }
        hideLoading();
        return;
      }

      const btn = e.target.closest('.btn-delete-post');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquesta publicació?')) return;
      showLoading();
      try {
        const ref = db.collection('posts').doc(btn.dataset.id);
        const snap = await ref.get();
        if (snap.exists) await deleteStoredImage(snap.data());
        await ref.delete();
        toast('Publicació eliminada.', 'success');
        loadCapPosts(capActiveCollaId);
      } catch (err) {
        toast('Error eliminant.', 'error');
        console.error(err);
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  7d. USER (MEMBER) DASHBOARD — colla page
  // ═══════════════════════════════════════════════════════════
  function showUserDashboard() {
    $('#user-user-label').textContent = currentUserProfile.name || currentUserProfile.email;
    showView('view-user-dashboard');
    loadUserData();
  }

  async function loadUserData() {
    const p = currentUserProfile;
    if (!p || !p.collaId) return;
    $('#user-colla-title').textContent = p.collaName
      ? `${p.collaName} (${p.collaCode || ''})`
      : 'La meva colla';
    showLoading();
    try {
      const [postsSnap, membersSnap] = await Promise.all([
        db.collection('posts')
          .where('collaId', '==', p.collaId)
          .orderBy('createdAt', 'desc')
          .get(),
        db.collection('users')
          .where('collaId', '==', p.collaId)
          .get()
      ]);

      renderPostsList($('#user-posts-list'), $('#user-posts-empty'),
        postsSnap.docs.map(d => ({ id: d.id, ...d.data() })), false);

      const members = membersSnap.docs
        .map(d => d.data())
        .sort((a, b) =>
          (a.name || '').localeCompare(b.name || '') ||
          (a.surname || '').localeCompare(b.surname || ''));
      const list = $('#user-members-list');
      list.innerHTML = '';
      $('#user-members-empty').hidden = members.length > 0;
      members.forEach(m => {
        const li = document.createElement('li');
        li.textContent = `${m.name || ''} ${m.surname || ''}`.trim();
        list.appendChild(li);
      });
    } catch (e) {
      toast('Error carregant la pàgina de la colla.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  function initUserDashboard() {
    $('#btn-user-logout').addEventListener('click', async () => {
      await auth.signOut();
      showView('view-login');
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  8. ADMIN DASHBOARD
  // ═══════════════════════════════════════════════════════════
  function initAdminDashboard() {
    // Sidebar tab switching
    $$('[data-admin-tab]').forEach(item => {
      item.addEventListener('click', () => {
        $$('[data-admin-tab]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        $$('.admin-tab').forEach(t => t.hidden = true);
        const tab = $('#admin-tab-' + item.dataset.adminTab);
        if (tab) tab.hidden = false;
      });
    });

    // Logout
    $('#btn-admin-logout').addEventListener('click', async () => {
      await auth.signOut();
      showView('view-login');
    });

    // ── Add Cap de Colla ──
    $('#add-cap-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#cap-email').value.trim().toLowerCase();
      const name = $('#cap-name').value.trim();
      if (!email || !name) return;

      showLoading();
      try {
        // Check if already exists (caps are keyed by email)
        const existing = await db.collection('caps').doc(email).get();
        if (existing.exists) {
          toast('Aquest correu ja és cap de colla.', 'error');
          hideLoading();
          return;
        }

        let authAccountExisted = false;

        // Create Firebase Auth account via REST API (without signing out the
        // current admin). The random password is a throwaway — the cap sets
        // their own via the password-reset email; nothing is stored.
        const apiKey = firebase.app().options.apiKey;
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: generatePassword(),
            returnSecureToken: false
          })
        });

        const result = await response.json();
        if (result.error) {
          if (result.error.message === 'EMAIL_EXISTS') {
            // Auth account already exists (e.g., admin adding themselves as cap)
            authAccountExisted = true;
          } else {
            toast('Error creant el compte: ' + result.error.message, 'error');
            hideLoading();
            return;
          }
        }

        await db.collection('caps').doc(email).set({
          email: email,
          name: name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        if (authAccountExisted) {
          toast(`Cap de colla afegit: ${email} (compte existent, mateixa contrasenya)`, 'success');
        } else {
          await auth.sendPasswordResetEmail(email);
          toast(`Cap de colla afegit: ${email}. S'ha enviat un correu per establir la contrasenya.`, 'success');
        }
        $('#add-cap-form').reset();
        loadAdminCaps();
      } catch (e) {
        toast('Error afegint cap de colla.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // ── Add Colla (without cap, just a name) ──
    $('#add-colla-form').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#colla-name').value.trim();
      if (!name) return;

      showLoading();
      try {
        const code = await generateUniqueCode();
        await db.collection('colles').add({
          name: name,
          code: code,
          capEmails: [],
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast(`Colla "${name}" creada amb codi: ${code}`, 'success');
        $('#add-colla-form').reset();
        loadAdminColles();
      } catch (e) {
        toast('Error afegint colla.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // ── Assign Cap to Colla ──
    $('#assign-cap-form').addEventListener('submit', async e => {
      e.preventDefault();
      const collaId = $('#assign-colla').value;
      const capEmail = $('#assign-cap').value;
      if (!collaId || !capEmail) return;

      showLoading();
      try {
        // Check if already assigned
        const collaDoc = await db.collection('colles').doc(collaId).get();
        const data = collaDoc.data();
        if (data.capEmails && data.capEmails.includes(capEmail)) {
          toast('Aquest cap ja està assignat a aquesta colla.', 'error');
          hideLoading();
          return;
        }
        await db.collection('colles').doc(collaId).update({
          capEmails: firebase.firestore.FieldValue.arrayUnion(capEmail)
        });
        toast('Cap de colla assignat correctament!', 'success');
        $('#assign-cap-form').reset();
        loadAdminColles();
      } catch (e) {
        toast('Error assignant cap de colla.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // ── Cap row actions: resend reset email / delete (delegated) ──
    $('#admin-caps-body').addEventListener('click', async e => {
      const btnResend = e.target.closest('.btn-resend-cap');
      if (btnResend) {
        showLoading();
        try {
          await auth.sendPasswordResetEmail(btnResend.dataset.email);
          toast(`Correu de restabliment enviat a ${btnResend.dataset.email}.`, 'success');
        } catch (err) {
          toast('Error enviant el correu.', 'error');
          console.error(err);
        }
        hideLoading();
        return;
      }
      const btn = e.target.closest('.btn-delete-cap');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquest cap de colla?')) return;
      showLoading();
      try {
        await db.collection('caps').doc(btn.dataset.id).delete();
        toast('Cap de colla eliminat.', 'success');
        loadAdminCaps();
      } catch (e) {
        toast('Error eliminant.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // ── Delete colla (delegated) ──
    $('#admin-colles-body').addEventListener('click', async e => {
      // Delete entire colla
      const btnDel = e.target.closest('.btn-delete-colla');
      if (btnDel) {
        if (!confirm('Segur que vols eliminar aquesta colla?')) return;
        showLoading();
        try {
          await db.collection('colles').doc(btnDel.dataset.id).delete();
          toast('Colla eliminada.', 'success');
          loadAdminColles();
        } catch (err) {
          toast('Error eliminant.', 'error');
          console.error(err);
        }
        hideLoading();
        return;
      }
      // Remove a cap from a colla
      const btnUn = e.target.closest('.btn-unassign-cap');
      if (btnUn) {
        if (!confirm(`Treure ${btnUn.dataset.email} d'aquesta colla?`)) return;
        showLoading();
        try {
          await db.collection('colles').doc(btnUn.dataset.collaId).update({
            capEmails: firebase.firestore.FieldValue.arrayRemove(btnUn.dataset.email)
          });
          toast('Cap desassignat.', 'success');
          loadAdminColles();
        } catch (err) {
          toast('Error desassignant.', 'error');
          console.error(err);
        }
        hideLoading();
      }
    });

    // ── Delete registration (delegated) ──
    $('#admin-reg-body').addEventListener('click', async e => {
      const btn = e.target.closest('.btn-delete-reg');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquest registre?')) return;
      showLoading();
      try {
        await db.collection('registrations').doc(btn.dataset.id).delete();
        await removeLinkedProfile(btn.dataset.email, btn.dataset.id);
        toast('Registre eliminat.', 'success');
        loadAdminRegistrations();
      } catch (e) {
        toast('Error eliminant.', 'error');
        console.error(e);
      }
      hideLoading();
    });

    // ── Admin export ──
    $('#btn-admin-export').addEventListener('click', () => exportAdminExcel());
  }

  async function loadAdminData() {
    await Promise.all([
      loadAdminCaps(),
      loadAdminColles(),
      loadAdminRegistrations(),
      loadServices().then(renderAdminServices),
      loadAdminOrders()
    ]);
  }

  async function loadAdminCaps() {
    const tbody = $('#admin-caps-body');
    const empty = $('#admin-caps-empty');
    tbody.innerHTML = '';

    try {
      const snap = await db.collection('caps').orderBy('createdAt', 'desc').get();
      if (snap.empty) { empty.hidden = false; return; }
      empty.hidden = true;

      snap.docs.forEach(doc => {
        const d = doc.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.email)}</td>
          <td>
            <button class="btn btn-outline btn-small btn-resend-cap" data-email="${escapeHtml(d.email)}">🔁 Correu contrasenya</button>
            <button class="btn btn-danger btn-small btn-delete-cap" data-id="${doc.id}">Eliminar</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Also update cap dropdowns
      updateCapDropdown(snap.docs);
    } catch (e) {
      console.error('Error loading caps:', e);
    }
  }

  function updateCapDropdown(capDocs) {
    // Update both the assign-cap dropdown
    const select = $('#assign-cap');
    select.innerHTML = '<option value="">— Selecciona cap —</option>';
    capDocs.forEach(doc => {
      const d = doc.data();
      const opt = document.createElement('option');
      opt.value = d.email;
      opt.textContent = `${d.name} (${d.email})`;
      select.appendChild(opt);
    });
  }

  async function loadAdminColles() {
    const tbody = $('#admin-colles-body');
    const empty = $('#admin-colles-empty');
    tbody.innerHTML = '';

    try {
      const snap = await db.collection('colles').orderBy('createdAt', 'desc').get();
      if (snap.empty) { empty.hidden = false; updateCollaDropdown([]); return; }
      empty.hidden = true;

      snap.docs.forEach(doc => {
        const d = doc.data();
        const caps = d.capEmails || (d.capEmail ? [d.capEmail] : []);
        const capsHtml = caps.length === 0
          ? '<em style="color:var(--text-secondary)">Cap assignat</em>'
          : caps.map(email =>
              `<span style="display:inline-flex;align-items:center;gap:.3rem;margin:.1rem 0;">
                ${escapeHtml(email)}
                <button class="btn btn-danger btn-small btn-unassign-cap" data-colla-id="${doc.id}" data-email="${escapeHtml(email)}" style="padding:.1rem .4rem;font-size:.7rem;">✕</button>
              </span>`
            ).join('<br>');
        const pdfHtml = d.pdfUrl
          ? `<span style="color:var(--success)">✅ ${escapeHtml(d.pdfName || 'Pujat')}</span>`
          : '<span style="color:var(--text-secondary)">—</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(d.name)}</td>
          <td><span class="code-cell">${escapeHtml(d.code)}</span></td>
          <td>${capsHtml}</td>
          <td>${pdfHtml}</td>
          <td><button class="btn btn-danger btn-small btn-delete-colla" data-id="${doc.id}">Eliminar</button></td>
        `;
        tbody.appendChild(tr);
      });

      // Update the assign-colla dropdown
      updateCollaDropdown(snap.docs);
    } catch (e) {
      console.error('Error loading colles:', e);
    }
  }

  function updateCollaDropdown(collaDocs) {
    const select = $('#assign-colla');
    select.innerHTML = '<option value="">— Selecciona colla —</option>';
    collaDocs.forEach(doc => {
      const d = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${d.name} (${d.code})`;
      select.appendChild(opt);
    });
  }

  async function loadAdminRegistrations() {
    const tbody = $('#admin-reg-body');
    const empty = $('#admin-reg-empty');
    tbody.innerHTML = '';

    try {
      const snap = await db.collection('registrations').orderBy('timestamp', 'desc').get();
      if (snap.empty) { empty.hidden = false; return; }
      empty.hidden = true;

      snap.docs.forEach(doc => {
        const d = doc.data();
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.surname)}</td>
          <td>${escapeHtml(d.idNumber)}</td>
          <td>${escapeHtml(d.email)}</td>
          <td>${escapeHtml(d.phone)}</td>
          <td>${escapeHtml(d.collaName || d.collaCode)}</td>
          <td>${formatTimestamp(d.timestamp)}</td>
          <td><button class="btn btn-danger btn-small btn-delete-reg" data-id="${doc.id}">Eliminar</button></td>
        `;
        // dataset assignment keeps user-provided emails out of the HTML string
        tr.querySelector('.btn-delete-reg').dataset.email = d.email || '';
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('Error loading registrations:', e);
    }
  }

  async function exportAdminExcel() {
    showLoading();
    try {
      const snap = await db.collection('registrations').orderBy('timestamp', 'desc').get();
      const rows = snap.docs.map(doc => {
        const d = doc.data();
        return {
          'Nom': d.name,
          'Cognoms': d.surname,
          'DNI/NIE/Passaport': d.idNumber,
          'Correu': d.email,
          'Telèfon': d.phone,
          'Colla': d.collaName || d.collaCode || '',
          'T&C Acceptats': d.tcAccepted ? 'Sí' : 'No',
          'Data registre': formatTimestamp(d.timestamp)
        };
      });

      if (rows.length === 0) {
        toast('No hi ha dades per exportar.', 'info');
        hideLoading();
        return;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Tots els Registres');
      XLSX.writeFile(wb, 'registres_tots.xlsx');
      toast('Excel descarregat!', 'success');
    } catch (e) {
      toast('Error exportant.', 'error');
      console.error(e);
    }
    hideLoading();
  }

  // ═══════════════════════════════════════════════════════════
  //  9. ADMIN — SERVEIS (catalog CRUD)
  // ═══════════════════════════════════════════════════════════
  function renderAdminServices() {
    const tbody = $('#admin-services-body');
    const empty = $('#admin-services-empty');
    tbody.innerHTML = '';

    if (servicesCache.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;

    servicesCache.forEach(s => {
      const price = Number(s.price) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.imageUrl ? `<img src="${escapeHtml(s.imageUrl)}" alt="" class="service-thumb">` : '🛒'}</td>
        <td>${escapeHtml(s.name)}${s.link ? ` <a href="${escapeHtml(s.link)}" target="_blank" rel="noopener" title="Enllaç">🔗</a>` : ''}</td>
        <td>${escapeHtml(categoryLabel(s.category))}</td>
        <td>${price.toFixed(2)} € / ${escapeHtml(s.unit || 'unitat')}</td>
        <td>
          <button class="btn btn-outline btn-small btn-edit-service" data-id="${s.id}">Editar</button>
          <button class="btn btn-danger btn-small btn-delete-service" data-id="${s.id}">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function resetServiceForm() {
    editingServiceId = null;
    $('#service-form').reset();
    $('#service-image-input').value = '';
    $('#service-image-filename').textContent = 'Cap arxiu';
    $('#service-form-title').textContent = 'Afegir Servei';
    $('#btn-service-save').textContent = 'Desar';
    $('#btn-service-cancel').hidden = true;
  }

  function initAdminServices() {
    // Image chooser
    $('#btn-service-image-choose').addEventListener('click', () => $('#service-image-input').click());
    $('#service-image-input').addEventListener('change', () => {
      const file = $('#service-image-input').files[0];
      $('#service-image-filename').textContent = file ? file.name : 'Cap arxiu';
    });

    $('#btn-service-cancel').addEventListener('click', resetServiceForm);

    // Create / update
    $('#service-form').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#service-name').value.trim();
      const price = parseFloat($('#service-price').value);
      const unit = $('#service-unit').value;
      const category = $('#service-category').value;
      const link = $('#service-link').value.trim();
      if (!name || isNaN(price) || price < 0) { toast('Revisa el nom i el preu.', 'error'); return; }

      showLoading();
      try {
        const data = { name, price, unit, category };
        if (link) data.link = link; else if (editingServiceId) data.link = firebase.firestore.FieldValue.delete();

        // Upload new image if one was chosen
        const file = $('#service-image-input').files[0];
        if (file) {
          const path = `services/${Date.now()}_${file.name}`;
          const snapshot = await storage.ref(path).put(file);
          data.imageUrl = await snapshot.ref.getDownloadURL();
          data.imagePath = path;
        }

        if (editingServiceId) {
          // Replacing the image? Delete the old file best-effort
          const old = servicesCache.find(s => s.id === editingServiceId);
          if (file && old) await deleteStoredImage(old);
          await db.collection('services').doc(editingServiceId).update(data);
          toast('Servei actualitzat.', 'success');
        } else {
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection('services').add(data);
          toast('Servei afegit.', 'success');
        }
        resetServiceForm();
        await loadServices();
        renderAdminServices();
      } catch (err) {
        toast('Error desant el servei.', 'error');
        console.error(err);
      }
      hideLoading();
    });

    // Edit / delete (delegated)
    $('#admin-services-body').addEventListener('click', async e => {
      const btnEdit = e.target.closest('.btn-edit-service');
      if (btnEdit) {
        const s = servicesCache.find(x => x.id === btnEdit.dataset.id);
        if (!s) return;
        editingServiceId = s.id;
        $('#service-name').value = s.name || '';
        $('#service-price').value = Number(s.price) || 0;
        $('#service-unit').value = s.unit || 'unitat';
        $('#service-category').value = CATEGORY_LABELS[s.category] ? s.category : 'altres';
        $('#service-link').value = s.link || '';
        $('#service-image-filename').textContent = s.imageUrl ? '(imatge actual)' : 'Cap arxiu';
        $('#service-form-title').textContent = 'Editar Servei';
        $('#btn-service-save').textContent = 'Actualitzar';
        $('#btn-service-cancel').hidden = false;
        window.scrollTo(0, 0);
        return;
      }
      const btnDel = e.target.closest('.btn-delete-service');
      if (!btnDel) return;
      if (!confirm('Segur que vols eliminar aquest servei?')) return;
      showLoading();
      try {
        const s = servicesCache.find(x => x.id === btnDel.dataset.id);
        if (s) await deleteStoredImage(s);
        await db.collection('services').doc(btnDel.dataset.id).delete();
        toast('Servei eliminat.', 'success');
        if (editingServiceId === btnDel.dataset.id) resetServiceForm();
        await loadServices();
        renderAdminServices();
      } catch (err) {
        toast('Error eliminant el servei.', 'error');
        console.error(err);
      }
      hideLoading();
    });
  }

  // Best-effort Storage cleanup for any doc carrying imagePath/imageUrl
  // (services and posts)
  async function deleteStoredImage(doc) {
    try {
      if (doc.imagePath) {
        await storage.ref(doc.imagePath).delete();
      } else if (doc.imageUrl) {
        await storage.refFromURL(doc.imageUrl).delete(); // legacy docs
      }
    } catch (e) { /* image may already be gone */ }
  }

  // ═══════════════════════════════════════════════════════════
  //  10. ADMIN — COMANDES (orders overview + totals)
  // ═══════════════════════════════════════════════════════════
  function filteredAdminOrders() {
    const collaId = $('#admin-orders-colla-filter').value;
    return collaId ? adminOrdersCache.filter(o => o.collaId === collaId) : adminOrdersCache;
  }

  async function loadAdminOrders() {
    try {
      const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
      adminOrdersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Colla filter options (from the orders themselves)
      const select = $('#admin-orders-colla-filter');
      const current = select.value;
      const seen = {};
      select.innerHTML = '<option value="">Totes les colles</option>';
      adminOrdersCache.forEach(o => {
        if (!o.collaId || seen[o.collaId]) return;
        seen[o.collaId] = true;
        const opt = document.createElement('option');
        opt.value = o.collaId;
        opt.textContent = o.collaName || o.collaCode || o.collaId;
        select.appendChild(opt);
      });
      select.value = seen[current] ? current : '';

      renderAdminOrders();
    } catch (e) {
      console.error('Error loading orders:', e);
    }
  }

  function renderAdminOrders() {
    const orders = filteredAdminOrders();

    // Orders table (each row followed by a hidden per-item detail row)
    const tbody = $('#admin-orders-body');
    const empty = $('#admin-orders-empty');
    tbody.innerHTML = '';
    empty.hidden = orders.length > 0;

    orders.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatTimestamp(o.createdAt)}</td>
        <td>${escapeHtml(o.collaName || o.collaCode || '—')}</td>
        <td>${escapeHtml(o.capEmail || '—')}</td>
        <td>${(o.items || []).length}</td>
        <td>${(Number(o.total) || 0).toFixed(2)} €</td>
        <td>
          <button class="btn btn-outline btn-small btn-order-detail">Detall</button>
          <button class="btn btn-danger btn-small btn-delete-order-admin" data-id="${o.id}">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);

      const detail = document.createElement('tr');
      detail.className = 'order-items-detail';
      detail.hidden = true;
      detail.innerHTML = `<td colspan="6">${(o.items || []).map(it =>
        `${it.quantity} ${escapeHtml(it.unit || '')} — ${escapeHtml(it.serviceName)} (${(Number(it.unitPrice) || 0).toFixed(2)} €/${escapeHtml(it.unit || 'unitat')} → ${((Number(it.unitPrice) || 0) * it.quantity).toFixed(2)} €)`
      ).join('<br>') || '—'}</td>`;
      tbody.appendChild(detail);
    });

    // Aggregated shopping-list totals
    const totals = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      const key = it.serviceId || it.serviceName;
      if (!totals[key]) totals[key] = { name: it.serviceName, unit: it.unit || 'unitat', qty: 0, cost: 0 };
      totals[key].qty += Number(it.quantity) || 0;
      totals[key].cost += (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0);
    }));

    const tBody = $('#admin-orders-totals-body');
    const tEmpty = $('#admin-orders-totals-empty');
    tBody.innerHTML = '';
    const keys = Object.keys(totals);
    tEmpty.hidden = keys.length > 0;
    keys.sort((a, b) => totals[a].name.localeCompare(totals[b].name)).forEach(k => {
      const t = totals[k];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.name)}</td>
        <td>${t.qty}</td>
        <td>${escapeHtml(t.unit)}</td>
        <td>${t.cost.toFixed(2)} €</td>
      `;
      tBody.appendChild(tr);
    });
  }

  function initAdminOrders() {
    $('#admin-orders-colla-filter').addEventListener('change', renderAdminOrders);
    $('#btn-admin-orders-export').addEventListener('click', exportOrdersExcel);

    $('#admin-orders-body').addEventListener('click', async e => {
      const btnDetail = e.target.closest('.btn-order-detail');
      if (btnDetail) {
        const detailRow = btnDetail.closest('tr').nextElementSibling;
        if (detailRow) detailRow.hidden = !detailRow.hidden;
        return;
      }
      const btnDel = e.target.closest('.btn-delete-order-admin');
      if (!btnDel) return;
      if (!confirm('Segur que vols eliminar aquesta comanda?')) return;
      showLoading();
      try {
        await db.collection('orders').doc(btnDel.dataset.id).delete();
        toast('Comanda eliminada.', 'success');
        await loadAdminOrders();
      } catch (err) {
        toast('Error eliminant.', 'error');
        console.error(err);
      }
      hideLoading();
    });
  }

  function exportOrdersExcel() {
    const orders = filteredAdminOrders();
    if (orders.length === 0) { toast('No hi ha dades per exportar.', 'info'); return; }

    // Sheet 1: one row per order item
    const rows = [];
    orders.forEach(o => (o.items || []).forEach(it => {
      rows.push({
        'Data': formatTimestamp(o.createdAt),
        'Colla': o.collaName || o.collaCode || '',
        'Cap': o.capEmail || '',
        'Servei': it.serviceName,
        'Quantitat': it.quantity,
        'Unitat': it.unit || '',
        'Preu unitari (€)': Number(it.unitPrice) || 0,
        'Subtotal (€)': Math.round((Number(it.unitPrice) || 0) * it.quantity * 100) / 100
      });
    }));

    // Sheet 2: aggregated shopping list
    const totals = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      const key = it.serviceId || it.serviceName;
      if (!totals[key]) totals[key] = { name: it.serviceName, unit: it.unit || 'unitat', qty: 0, cost: 0 };
      totals[key].qty += Number(it.quantity) || 0;
      totals[key].cost += (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0);
    }));
    const totalRows = Object.values(totals)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({
        'Servei': t.name,
        'Quantitat': t.qty,
        'Unitat': t.unit,
        'Cost (€)': Math.round(t.cost * 100) / 100
      }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Comandes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totalRows), 'Totals');
    XLSX.writeFile(wb, 'comandes.xlsx');
    toast('Excel descarregat!', 'success');
  }

  // ─── Utility: escape HTML ──────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Utility: format Firestore timestamp ───────────────────
  function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('ca-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    showView('view-login');

    // Initialize all UI modules first so buttons always work
    initLanding();
    initRegistration();
    initConfirmation();
    initTerms();
    initSuccess();
    initLogin();
    initCapDashboard();
    initCapSubnav();
    initCapOrders();
    initCapPosts();
    initUserDashboard();
    initAdminDashboard();
    initAdminServices();
    initAdminOrders();

    initAuthListener();
  }

  // Wait for Firebase to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
