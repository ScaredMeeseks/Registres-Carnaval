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
  let currentRole = null;   // 'admin' | 'cap'
  let currentCollaCode = null;      // selected colla code for registration
  let currentCollaName = null;
  let currentCollaId = null;        // Firestore doc id of selected colla
  let pendingRegistration = null;   // temp object before T&C
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
      // Load the colla's custom PDF if it exists — nothing is written to
      // Firestore until the T&C are accepted
      await loadCollaPdf(currentCollaId);
      showView('view-terms');
      resetTermsView();
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
      const reg = pendingRegistration;
      if (!checkbox.checked || !reg) return;
      pendingRegistration = null; // guard against double-click double writes
      showLoading();
      try {
        await db.collection('registrations').add({
          ...reg,
          tcAccepted: true,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        showView('view-success');
        $('#register-form').reset();
      } catch (e) {
        pendingRegistration = reg; // restore so the user can retry
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
      if (!user) {
        currentUser = null;
        currentRole = null;
        return;
      }

      currentUser = user;
      const email = user.email.toLowerCase();

      // Check if admin
      const adminDoc = await db.collection('admins').doc(email).get();
      const isAdmin = adminDoc.exists;

      // Check if also cap de colla (caps are keyed by email)
      const capDoc = await db.collection('caps').doc(email).get();
      const isCap = capDoc.exists;

      if (isAdmin) {
        currentRole = 'admin';
        $('#admin-user-label').textContent = email;
        showView('view-admin-dashboard');
        await runMigrations();
        loadAdminData();
        hideLoading();
        return;
      }

      if (isCap) {
        currentRole = 'cap';
        const capData = capDoc.data();
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
  //  ONE-TIME MIGRATIONS — run on admin login, guarded by marker
  // ═══════════════════════════════════════════════════════════
  async function runMigrations() {
    try {
      const marker = await db.collection('meta').doc('migrations').get();
      if (marker.exists && marker.data().v >= 1) return;

      // 1. Caps: re-key docs by email, drop stored plaintext passwords
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

      // 2. Registrations: backfill collaId from collaCode
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

      await db.collection('meta').doc('migrations').set({
        v: 1,
        ranAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('Migrations v1 completed');
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
      // Load registrations + orders for the first colla by default
      await loadServices();
      renderOrderCatalog();
      await loadCapRegistrations(capActiveCollaId);
      loadCapOrders(capActiveCollaId);
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

  function initCapOrders() {
    // Sub-nav: Registres / Comandes
    const btnReg = $('#btn-cap-tab-registres');
    const btnCom = $('#btn-cap-tab-comandes');
    btnReg.addEventListener('click', () => {
      btnReg.classList.add('active'); btnCom.classList.remove('active');
      $('#cap-section-registres').hidden = false;
      $('#cap-section-comandes').hidden = true;
    });
    btnCom.addEventListener('click', () => {
      btnCom.classList.add('active'); btnReg.classList.remove('active');
      $('#cap-section-registres').hidden = true;
      $('#cap-section-comandes').hidden = false;
    });

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
          if (file && old) await deleteServiceImage(old);
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
        if (s) await deleteServiceImage(s);
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

  async function deleteServiceImage(service) {
    try {
      if (service.imagePath) {
        await storage.ref(service.imagePath).delete();
      } else if (service.imageUrl) {
        await storage.refFromURL(service.imageUrl).delete(); // legacy docs
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
    showView('view-landing');

    // Initialize all UI modules first so buttons always work
    initLanding();
    initRegistration();
    initConfirmation();
    initTerms();
    initSuccess();
    initLogin();
    initCapDashboard();
    initCapOrders();
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
