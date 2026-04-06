/* =============================================================
   Registre Carnaval — Main Application Logic
   ============================================================= */
(function () {
  'use strict';

  // ─── DOM helpers ────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ─── Constants ──────────────────────────────────────────────
  const ADMIN_EMAILS = ['marna96@gmail.com', 'said@magmamedia.cat'];
  const ADMIN_SEEDS = [
    { email: 'marna96@gmail.com',    password: 'Garriguella2026' },
    { email: 'said@magmamedia.cat',   password: 'Garriguella2026' }
  ];

  // ─── State ──────────────────────────────────────────────────
  let currentUser = null;   // firebase.User
  let currentRole = null;   // 'admin' | 'cap'
  let currentCollaCode = null;      // selected colla code for registration
  let currentCollaName = null;
  let currentCollaId = null;        // Firestore doc id of selected colla
  let pendingRegistration = null;   // temp object before T&C
  let capColles = [];               // colles assigned to current cap
  let isSeeding = false;            // guard: don't route during admin seeding

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
  //  ADMIN SEEDING — run once to create auth accounts
  // ═══════════════════════════════════════════════════════════
  async function seedAdmins() {
    isSeeding = true;

    for (const admin of ADMIN_SEEDS) {
      // Check if Firestore doc already exists
      try {
        const doc = await db.collection('admins').doc(admin.email).get();
        if (doc.exists) { continue; } // Already seeded
      } catch (e) { /* ignore read errors, try to seed anyway */ }

      try {
        // Try to create the auth account (auto-signs in)
        await auth.createUserWithEmailAndPassword(admin.email, admin.password);
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
          // Auth account exists — sign in instead
          try {
            await auth.signInWithEmailAndPassword(admin.email, admin.password);
          } catch (e2) {
            console.warn(`Cannot sign in as ${admin.email}:`, e2.message);
            continue;
          }
        } else {
          console.warn(`Cannot create ${admin.email}:`, e.message);
          continue;
        }
      }

      // Now signed in as admin — write Firestore doc
      try {
        await db.collection('admins').doc(admin.email).set({ email: admin.email }, { merge: true });
        console.log(`Admin seeded: ${admin.email}`);
      } catch (e) {
        console.warn(`Firestore write failed for ${admin.email}:`, e.message);
      }

      await auth.signOut();
    }

    isSeeding = false;
  }

  // ═══════════════════════════════════════════════════════════
  //  1. LANDING — Code validation
  // ═══════════════════════════════════════════════════════════
  function initLanding() {
    const input = $('#code-input');
    const btnValidate = $('#btn-validate-code');
    const btnLogin = $('#btn-go-login');
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

    btnLogin.addEventListener('click', () => {
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

      const name    = $('#reg-name').value.trim();
      const surname = $('#reg-surname').value.trim();
      const id      = $('#reg-id').value.trim();
      const email   = $('#reg-email').value.trim();
      const phone   = $('#reg-phone').value.trim();

      // Validation
      if (!name || !surname || !id || !email || !phone) {
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

      pendingRegistration = { name, surname, idNumber: id, email, phone, collaCode: currentCollaCode, collaName: currentCollaName };

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
        pendingRegistration.tcAccepted = false;
        pendingRegistration.timestamp = firebase.firestore.FieldValue.serverTimestamp();
        const docRef = await db.collection('registrations').add(pendingRegistration);
        pendingRegistration._id = docRef.id;

        // Load the colla's custom PDF if it exists
        await loadCollaPdf(currentCollaId);

        showView('view-terms');
        initTermsScroll();
      } catch (e) {
        toast('Error desant el registre. Torna-ho a provar.', 'error');
        console.error(e);
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  4. TERMS & CONDITIONS — scroll gating
  // ═══════════════════════════════════════════════════════════
  function initTermsScroll() {
    const container = $('#terms-scroll-container');
    const checkbox = $('#tc-checkbox');
    const hint = $('#terms-hint');
    const btnSave = $('#btn-terms-save');

    // Reset
    checkbox.checked = false;
    checkbox.disabled = true;
    btnSave.disabled = true;
    hint.hidden = false;

    function checkScroll() {
      // Check if scrolled to bottom (with 20px tolerance)
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
      if (atBottom) {
        checkbox.disabled = false;
        hint.hidden = true;
      }
    }

    container.addEventListener('scroll', checkScroll);
    // Also check immediately in case content is short
    setTimeout(checkScroll, 500);

    checkbox.addEventListener('change', () => {
      btnSave.disabled = !checkbox.checked;
    });

    btnSave.addEventListener('click', async () => {
      if (!checkbox.checked || !pendingRegistration) return;
      showLoading();
      try {
        await db.collection('registrations').doc(pendingRegistration._id).update({ tcAccepted: true });
        showView('view-success');
        // Reset form
        $('#register-form').reset();
        pendingRegistration = null;
      } catch (e) {
        toast('Error desant. Torna-ho a provar.', 'error');
        console.error(e);
      }
      hideLoading();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  4b. Load colla-specific PDF for T&C
  // ═══════════════════════════════════════════════════════════
  async function loadCollaPdf(collaId) {
    const iframe = $('#terms-pdf');
    if (!collaId) { iframe.src = 'docs/terms.html'; return; }
    try {
      const collaDoc = await db.collection('colles').doc(collaId).get();
      const data = collaDoc.data();
      if (data && data.pdfUrl) {
        iframe.src = data.pdfUrl;
      } else {
        iframe.src = 'docs/terms.html';
      }
    } catch (e) {
      console.warn('Could not load colla PDF, using default:', e);
      iframe.src = 'docs/terms.html';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  5. SUCCESS
  // ═══════════════════════════════════════════════════════════
  function initSuccess() {
    $('#btn-success-home').addEventListener('click', () => {
      currentCollaCode = null;
      currentCollaName = null;
      currentCollaId = null;
      $('#code-input').value = '';
      showView('view-landing');
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  6. LOGIN
  // ═══════════════════════════════════════════════════════════
  function initLogin() {
    const form = $('#login-form');
    const error = $('#login-error');

    // Password eye toggle
    $$('.pw-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $('#' + btn.dataset.target);
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? '🙈' : '👁';
      });
    });

    $('#btn-login-back').addEventListener('click', () => {
      showView('view-landing');
      error.hidden = true;
      form.reset();
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
  //  AUTH STATE LISTENER — routes to correct dashboard
  // ═══════════════════════════════════════════════════════════
  function initAuthListener() {
    auth.onAuthStateChanged(async user => {
      if (isSeeding) return; // Don't route during admin seeding

      if (!user) {
        currentUser = null;
        currentRole = null;
        return;
      }

      currentUser = user;
      const email = user.email.toLowerCase();

      // Check if admin
      const adminDoc = await db.collection('admins').doc(email).get();
      if (adminDoc.exists) {
        currentRole = 'admin';
        $('#admin-user-label').textContent = email;
        showView('view-admin-dashboard');
        loadAdminData();
        hideLoading();
        return;
      }

      // Check if cap de colla
      const capSnap = await db.collection('caps').where('email', '==', email).get();
      if (!capSnap.empty) {
        currentRole = 'cap';
        const capData = capSnap.docs[0].data();
        $('#cap-user-label').textContent = capData.name || email;
        showView('view-cap-dashboard');
        loadCapData(email);
        hideLoading();
        return;
      }

      // Unknown role — sign out
      toast('No tens permisos per accedir.', 'error');
      await auth.signOut();
      hideLoading();
    });
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
      // Load registrations for the first colla by default
      await loadCapRegistrations(capColles[0].code);
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
        loadCapRegistrations(colla.code);
        updatePdfStatus(colla.id);
      });
      container.appendChild(btn);
    });
    // Load PDF status for first colla
    if (capColles.length > 0) {
      updatePdfStatus(capColles[0].id);
    }
  }

  async function loadCapRegistrations(collaCode) {
    const tbody = $('#cap-table-body');
    const empty = $('#cap-table-empty');
    tbody.innerHTML = '';

    try {
      const snap = await db.collection('registrations')
        .where('collaCode', '==', collaCode)
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
          <td>${formatTimestamp(d.timestamp)}</td>
          <td><button class="btn btn-danger btn-small btn-delete-reg" data-id="${doc.id}">Eliminar</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      toast('Error carregant registres.', 'error');
      console.error(e);
    }
  }

  function initCapDashboard() {
    // Logout
    $('#btn-cap-logout').addEventListener('click', async () => {
      await auth.signOut();
      showView('view-landing');
    });

    // Delete registration (delegated)
    $('#cap-table-body').addEventListener('click', async e => {
      const btn = e.target.closest('.btn-delete-reg');
      if (!btn) return;
      if (!confirm('Segur que vols eliminar aquest registre?')) return;
      showLoading();
      try {
        await db.collection('registrations').doc(btn.dataset.id).delete();
        btn.closest('tr').remove();
        toast('Registre eliminat.', 'success');
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
        status.textContent = 'Cap document pujat encara. S\'utilitzarà el document per defecte.';
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

    showLoading();
    try {
      const snap = await db.collection('registrations')
        .where('collaCode', '==', code)
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
      showView('view-landing');
    });

    // ── Add Cap de Colla ──
    $('#add-cap-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#cap-email').value.trim().toLowerCase();
      const name = $('#cap-name').value.trim();
      if (!email || !name) return;

      showLoading();
      try {
        // Check if already exists
        const existing = await db.collection('caps').where('email', '==', email).get();
        if (!existing.empty) {
          toast('Aquest correu ja és cap de colla.', 'error');
          hideLoading();
          return;
        }

        const password = generatePassword();

        // We need to create a Firebase Auth account for the cap.
        // Since we're logged in as admin, we need to use a workaround:
        // Sign in with a secondary auth instance, or create + sign back in.
        // Using the admin's current credentials stored approach:

        // Save current admin credentials
        const adminEmail = currentUser.email;

        // Create the new auth account
        // We'll use a fetch to Firebase Auth REST API to create the user
        // without signing out the current admin
        const apiKey = firebase.app().options.apiKey;
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: password,
            returnSecureToken: false
          })
        });

        const result = await response.json();
        if (result.error) {
          if (result.error.message === 'EMAIL_EXISTS') {
            toast('Ja existeix un compte amb aquest correu.', 'error');
          } else {
            toast('Error creant el compte: ' + result.error.message, 'error');
          }
          hideLoading();
          return;
        }

        // Store in Firestore with plain password
        await db.collection('caps').add({
          email: email,
          name: name,
          plainPassword: password,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        toast(`Cap de colla afegit: ${email}`, 'success');
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

    // ── Delete cap (delegated) ──
    $('#admin-caps-body').addEventListener('click', async e => {
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
    await Promise.all([loadAdminCaps(), loadAdminColles(), loadAdminRegistrations()]);
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
          <td><span class="password-cell">${escapeHtml(d.plainPassword)}</span></td>
          <td><button class="btn btn-danger btn-small btn-delete-cap" data-id="${doc.id}">Eliminar</button></td>
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
  async function init() {
    showView('view-landing');

    // Initialize all modules first so buttons always work
    initLanding();
    initRegistration();
    initConfirmation();
    initSuccess();
    initLogin();
    initCapDashboard();
    initAdminDashboard();
    initAuthListener();

    // Seed admin accounts in background (only runs once)
    try {
      await seedAdmins();
    } catch (e) {
      console.warn('Admin seeding error (may be normal on first load):', e);
    }
  }

  // Wait for Firebase to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
