// assets/conference.js
// Formulaire "Conference Paper" (page conference.html)
// - Construit le bloc [DLAB] dans Extra (hal_create, comms_publish, axes)
// - Ajoute les champs tex.* dans Extra
// - Envoie vers /.netlify/functions/zotero-create-item (pubType=conferencePaper)
// - Ne dépend pas de app.js (aucun risque de casser index)

(() => {
  'use strict';

  const form = document.getElementById('conference-form');
  const statusEl = document.getElementById('status');
  const submitBtn = document.getElementById('submitBtn');
  const authorsList = document.getElementById('authors-list');
  const addAuthorBtn = document.getElementById('add-author');

  const $ = (name) => form.querySelector(`[name="${name}"]`);

  function setStatus(msg, kind = '') {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? (' ' + kind) : '');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  function addAuthorRow(firstName = '', lastName = '') {
    const row = document.createElement('div');
    row.className = 'author-row';
    row.innerHTML = `
      <div class="two-cols">
        <input placeholder="Prénom" value="${escapeHtml(firstName)}">
        <input placeholder="Nom *" value="${escapeHtml(lastName)}">
      </div>
    `;
    authorsList.appendChild(row);
  }

  function getAuthors() {
    return [...authorsList.querySelectorAll('.author-row')].map(row => {
      const inputs = row.querySelectorAll('input');
      return {
        firstName: (inputs[0]?.value || '').trim(),
        lastName: (inputs[1]?.value || '').trim()
      };
    }).filter(a => a.firstName || a.lastName);
  }

  function getAxes() {
    const axes = [];
    if (form.axisPICMAP?.checked) axes.push('PICMAP');
    if (form.axisMOPTIS?.checked) axes.push('MOPTIS');
    if (form.axisOCSO?.checked) axes.push('OCSO');
    return axes;
  }

  function buildDLABBlock(optHal, optComms, axesArr) {
    const axes = (axesArr && axesArr.length) ? axesArr.join(',') : 'none';
    return `[DLAB]
hal_create: ${optHal}
comms_publish: ${optComms}
axes: ${axes}
[/DLAB]`;
  }

  function appendTexLines(extraBase, texMap) {
    const base = String(extraBase || '').trim();
    const lines = [];

    for (const [k, v] of Object.entries(texMap || {})) {
      const key = String(k || '').trim();
      const val = String(v || '').trim();
      if (!key || !val) continue;
      lines.push(`${key}: ${val}`);
    }

    if (!lines.length) return base;
    if (!base) return lines.join('\n');
    return `${base}\n\n${lines.join('\n')}`;
  }

  function buildExtra(userExtra, optHal, optComms, axesArr, texMap) {
    const base = String(userExtra || '').trim();
    const dlab = buildDLABBlock(optHal, optComms, axesArr);

    // 1) texte libre
    // 2) bloc DLAB
    // 3) lignes tex.*
    let extra = base ? (base + '\n\n' + dlab) : dlab;
    extra = appendTexLines(extra, texMap);
    return extra;
  }

  function validate() {
    const title = ($('title').value || '').trim();
    const conferenceName = ($('conferenceName').value || '').trim();
    const date = ($('date').value || '').trim();
    const optHal = ($('optHal').value || '').trim();
    const optComms = ($('optComms').value || '').trim();
    const authors = getAuthors();

    if (!title) return 'Titre manquant.';
    if (!authors.length || !authors.some(a => (a.lastName || '').trim())) return 'Au moins un auteur est requis (Nom obligatoire).';
    if (!conferenceName) return 'Conference Name manquant.';
    if (!date) return 'Date manquante.';
    if (!optHal || !optComms) return 'Merci de répondre aux 2 questions (HAL + communication).';

    return '';
  }

  // Init authors
  if (addAuthorBtn) addAuthorBtn.addEventListener('click', () => addAuthorRow());
  addAuthorRow();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('');

    const err = validate();
    if (err) {
      setStatus('❌ ' + err, 'err');
      return;
    }

    submitBtn.disabled = true;
    setStatus('⏳ Envoi vers Zotero…');

    try {
      const authors = getAuthors();
      const axes = getAxes();

      const optHal = ($('optHal').value || '').trim();
      const optComms = ($('optComms').value || '').trim();

      const texMap = {
        'tex.conferenceenddate': ($('tex_conferenceenddate').value || '').trim(),
        'tex.conferenceorganizer': ($('tex_conferenceorganizer').value || '').trim(),
        'tex.conferencestartdate': ($('tex_conferencestartdate').value || '').trim(),
        'tex.x-audience': (($('tex_x_audience').value || '').trim() || 'Not set'),
        'tex.x-invitedcommunication': ($('tex_x_invitedcommunication').value || '').trim(),
        'tex.x-language': ($('tex_x_language').value || '').trim(),
        'tex.x-peerreviewing': ($('tex_x_peerreviewing').value || '').trim(),
        'tex.x-popularlevel': ($('tex_x_popularlevel').value || '').trim(),
        'tex.x-proceedings': ($('tex_x_proceedings').value || '').trim()
      };

      const extra = buildExtra(
        ($('extra').value || '').trim(),
        optHal,
        optComms,
        axes,
        texMap
      );

      const payload = {
        kind: 'publication',
        pubType: 'conferencePaper',
        title: ($('title').value || '').trim(),
        authors,
        conferenceName: ($('conferenceName').value || '').trim(),
        publisher: ($('publisher').value || '').trim(),
        place: ($('place').value || '').trim(),
        date: ($('date').value || '').trim(),
        language: ($('language').value || '').trim(),
        extra
      };

      const r = await fetch('/.netlify/functions/zotero-create-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await r.text();
      if (!r.ok) {
        setStatus(`❌ Erreur Zotero (${r.status}) : ${text}`, 'err');
        submitBtn.disabled = false;
        return;
      }

      setStatus('✅ Notice créée dans Zotero.', 'ok');

      // reset form (en gardant une ligne auteur)
      form.reset();
      authorsList.innerHTML = '';
      addAuthorRow();
      $('tex_x_audience').value = 'Not set';
    } catch (e2) {
      console.error(e2);
      setStatus('❌ Erreur : ' + String(e2?.message || e2), 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });

})();
