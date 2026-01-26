// assets/app.js
// - Ajout support "conferencePaper" (form + payload + validations)
// - N'altère pas les flux existants (book / bookSection / journalArticle)
// - Si des onglets "tab-publication" / "tab-event" existent dans index.html : active le toggle
//   (sinon, ne fait rien et reste compatible avec l’index actuel)

function setStatus(message, kind = 'info') {
  const el = document.getElementById('pub-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'status';
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'err') el.classList.add('err');
}

function clearStatus() {
  setStatus('', 'info');
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function addAuthorRow(firstName = '', lastName = '') {
  const list = document.getElementById('authors-list');
  if (!list) return;

  const div = document.createElement('div');
  div.className = 'author-row';

  div.innerHTML = `
    <div class="two-cols">
      <input placeholder="Prénom" value="${escapeHtml(firstName)}">
      <input placeholder="Nom *" value="${escapeHtml(lastName)}">
    </div>
  `;

  list.appendChild(div);
}

function resetAuthors() {
  const list = document.getElementById('authors-list');
  if (!list) return;
  list.innerHTML = '';
  addAuthorRow();
}

function getAuthors() {
  return [...document.querySelectorAll('.author-row')]
    .map(row => {
      const [fn, ln] = row.querySelectorAll('input');
      return {
        firstName: (fn?.value || '').trim(),
        lastName: (ln?.value || '').trim()
      };
    })
    .filter(a => a.firstName || a.lastName);
}

function togglePubType(pubType) {
  const book = document.getElementById('book-fields');
  const section = document.getElementById('section-fields');
  const article = document.getElementById('article-fields');
  const conf = document.getElementById('conference-fields');

  if (book) book.style.display = pubType === 'book' ? 'block' : 'none';
  if (section) section.style.display = pubType === 'bookSection' ? 'block' : 'none';
  if (article) article.style.display = pubType === 'journalArticle' ? 'block' : 'none';
  if (conf) conf.style.display = pubType === 'conferencePaper' ? 'block' : 'none';
}

function normalizeDoi(raw) {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

async function fetchDoiMetadata(doi) {
  // 1) OpenAlex
  try {
    const r = await fetch(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`);
    if (r.ok) {
      const w = await r.json();
      return {
        title: w?.title || '',
        authors: (w?.authorships || []).map(a => ({
          firstName: (a?.author?.display_name || '').split(' ').slice(0, -1).join(' '),
          lastName: (a?.author?.display_name || '').split(' ').slice(-1).join(' ')
        })).filter(a => a.firstName || a.lastName),
        publication: w?.host_venue?.display_name || '',
        date: w?.publication_year ? String(w.publication_year) : '',
        volume: w?.biblio?.volume || '',
        issue: w?.biblio?.issue || '',
        pages: (w?.biblio?.first_page && w?.biblio?.last_page)
          ? `${w.biblio.first_page}-${w.biblio.last_page}`
          : (w?.biblio?.page || ''),
        doi
      };
    }
  } catch (_) {}

  // 2) Crossref
  const r2 = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!r2.ok) throw new Error('DOI introuvable.');
  const j = await r2.json();
  const m = j?.message || {};
  const year = m?.issued?.['date-parts']?.[0]?.[0];
  return {
    title: (m?.title || [])[0] || '',
    authors: (m?.author || []).map(a => ({ firstName: a?.given || '', lastName: a?.family || '' }))
      .filter(a => a.firstName || a.lastName),
    publication: (m?.['container-title'] || [])[0] || '',
    date: year ? String(year) : '',
    volume: m?.volume || '',
    issue: m?.issue || '',
    pages: m?.page || '',
    doi: m?.DOI || doi
  };
}

function setInputValue(name, value) {
  const el = document.querySelector(`[name="${name}"]`);
  if (el && value !== undefined && value !== null) el.value = String(value);
}

/**
 * Construit le bloc [DLAB] stocké dans Extra.
 * On conserve ton texte libre "Extra", et on y ajoute/concatène un bloc normalisé.
 */
function buildExtraWithOptions(userExtra, optHal, optComms, axesArr) {
  const base = (userExtra || '').trim();
  const axes = Array.isArray(axesArr) && axesArr.length ? axesArr.join(',') : 'none';

  const block =
`[DLAB]
hal_create: ${optHal}
comms_publish: ${optComms}
axes: ${axes}
[/DLAB]`;

  if (base) return `${base}\n\n${block}`;
  return block;
}

/**
 * Ajoute des lignes "tex.*: ..." dans Extra (en conservant le bloc [DLAB] intact).
 * Les lignes vides sont ignorées.
 */
function appendTexLines(extraBase, texMap) {
  const base = (extraBase || '').trim();
  const lines = [];

  for (const [k, v] of Object.entries(texMap || {})) {
    const key = String(k || '').trim();
    const val = (v === undefined || v === null) ? '' : String(v).trim();
    if (!key) continue;
    if (!val) continue;
    lines.push(`${key}: ${val}`);
  }

  if (!lines.length) return base;
  if (!base) return lines.join('\n');
  return `${base}\n\n${lines.join('\n')}`;
}

function getAxesFromForm(form) {
  const axes = [];
  if (form.axisPICMAP?.checked) axes.push('PICMAP');
  if (form.axisMOPTIS?.checked) axes.push('MOPTIS');
  if (form.axisOCSO?.checked) axes.push('OCSO');
  return axes;
}

/* ===========================
   Onglets Publication / Event
   (compat : si absent, ignore)
   =========================== */
function initTabsIfPresent() {
  const btnPub = document.getElementById('tab-publication');
  const btnEvt = document.getElementById('tab-event');

  // Compat: certains index n'ont pas d'onglets
  if (!btnPub || !btnEvt) return;

  // Panneaux possibles : soit des wrappers, soit les forms direct
  const pubPanel =
    document.getElementById('publication-panel') ||
    document.getElementById('pub-panel') ||
    document.getElementById('pub-form');

  const evtPanel =
    document.getElementById('event-panel') ||
    document.getElementById('event-panel') ||
    document.getElementById('event-form');

  if (!pubPanel || !evtPanel) return;

  function activate(which) {
    const isPub = which === 'pub';
    btnPub.classList.toggle('active', isPub);
    btnEvt.classList.toggle('active', !isPub);
    pubPanel.style.display = isPub ? 'block' : 'none';
    evtPanel.style.display = isPub ? 'none' : 'block';
  }

  btnPub.addEventListener('click', () => activate('pub'));
  btnEvt.addEventListener('click', () => activate('evt'));

  // état initial
  activate('pub');
}

/* =========
   Init
   ========= */
const form = document.getElementById('pub-form');
if (!form) {
  // Si jamais cette page n’a pas de pub-form (ex: autre page)
  // on ne fait rien pour éviter de casser.
  initTabsIfPresent();
} else {
  const submitBtn = form.querySelector('button[type="submit"]');

  const addBtn = document.getElementById('add-author-btn');
  if (addBtn) addBtn.addEventListener('click', () => addAuthorRow());
  resetAuthors();

  const pubTypeSelect = document.getElementById('pubType');
  if (pubTypeSelect) {
    pubTypeSelect.addEventListener('change', (e) => {
      togglePubType(e.target.value);
      clearStatus();
    });
    togglePubType(pubTypeSelect.value);
  }

  // --- DOI prefill (Article)
  const doiBtn = document.getElementById('doi-prefill');
  if (doiBtn) {
    doiBtn.addEventListener('click', async () => {
      try {
        const doiEl = document.getElementById('articleDoi');
        const raw = (doiEl?.value || '').trim();
        const doi = normalizeDoi(raw);
        if (!doi) {
          setStatus('❌ Merci de renseigner un DOI.', 'err');
          return;
        }

        setStatus('⏳ Récupération des métadonnées via DOI…');
        doiBtn.disabled = true;

        const meta = await fetchDoiMetadata(doi);

        if (meta.title) setInputValue('title', meta.title);
        if (meta.publication) setInputValue('articlePublication', meta.publication);
        if (meta.date) setInputValue('articleDate', meta.date);
        if (meta.volume) setInputValue('articleVolume', meta.volume);
        if (meta.issue) setInputValue('articleIssue', meta.issue);
        if (meta.pages) setInputValue('articlePages', meta.pages);
        setInputValue('articleDoi', meta.doi || doi);

        if (Array.isArray(meta.authors) && meta.authors.length) {
          const list = document.getElementById('authors-list');
          list.innerHTML = '';
          meta.authors.forEach(a => addAuthorRow(a.firstName || '', a.lastName || ''));
        }

        setStatus('✅ Métadonnées récupérées. Vérifiez/complétez si nécessaire.', 'ok');
        setTimeout(() => clearStatus(), 2500);
      } catch (e) {
        setStatus('❌ Impossible de préremplir à partir du DOI (métadonnées indisponibles).', 'err');
      } finally {
        doiBtn.disabled = false;
      }
    });
  }

  // --- Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    clearStatus();
    setStatus('⏳ Envoi en cours…');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const authors = getAuthors();
      const hasLastName = authors.some(a => (a.lastName || '').trim().length > 0);
      if (!hasLastName) {
        setStatus('❌ Merci de renseigner au moins un Nom d’auteur.', 'err');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      const pubType = (form.pubType?.value || '').trim();
      const isSection = pubType === 'bookSection';
      const isArticle = pubType === 'journalArticle';
      const isConf = pubType === 'conferencePaper';

      // Options obligatoires
      const optHal = (form.optHal?.value || '').trim();     // yes/no
      const optComms = (form.optComms?.value || '').trim(); // yes/no
      if (!optHal || !optComms) {
        setStatus('❌ Merci de répondre aux 2 questions (HAL + communication).', 'err');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      const axes = getAxesFromForm(form);

      // Lire les bons champs (évite les doublons)
      const dateValue = isConf
        ? (form.conferenceDate?.value || '').trim()
        : isSection
          ? (form.sectionDate?.value || '').trim()
          : isArticle
            ? (form.articleDate?.value || '').trim()
            : (form.date?.value || '').trim();

      const publisherValue = isConf
        ? (form.conferencePublisher?.value || '').trim()
        : isSection
          ? (form.sectionPublisher?.value || '').trim()
          : isArticle
            ? (form.articlePublisher?.value || '').trim()
            : (form.publisher?.value || '').trim();

      const placeValue = isConf
        ? (form.conferencePlace?.value || '').trim()
        : isSection
          ? (form.sectionPlace?.value || '').trim()
          : isArticle
            ? (form.articlePlace?.value || '').trim()
            : (form.place?.value || '').trim();

      const languageValue = isConf
        ? (form.conferenceLanguage?.value || '').trim()
        : (form.language?.value || '').trim();

      const isbnValue = isSection
        ? (form.sectionIsbn?.value || '').trim()
        : (form.isbn?.value || '').trim();

      // Base Extra + [DLAB]
      let extraValue = buildExtraWithOptions(
        (form.extra?.value || '').trim(),
        optHal,
        optComms,
        axes
      );

      // Conference Paper: ajoute le bloc tex.*
      if (isConf) {
        const texAudience = (form.tex_x_audience?.value || 'Not set').trim() || 'Not set';

        const texMap = {
          'tex.conferenceenddate': (form.tex_conferenceenddate?.value || '').trim(),
          'tex.conferenceorganizer': (form.tex_conferenceorganizer?.value || '').trim(),
          'tex.conferencestartdate': (form.tex_conferencestartdate?.value || '').trim(),
          'tex.x-audience': texAudience,
          'tex.x-invitedcommunication': (form.tex_x_invitedcommunication?.value || '').trim(),
          'tex.x-language': (form.tex_x_language?.value || '').trim(),
          'tex.x-peerreviewing': (form.tex_x_peerreviewing?.value || '').trim(),
          'tex.x-popularlevel': (form.tex_x_popularlevel?.value || '').trim(),
          'tex.x-proceedings': (form.tex_x_proceedings?.value || '').trim()
        };

        extraValue = appendTexLines(extraValue, texMap);
      }

      const payload = {
        kind: 'publication',
        pubType,
        title: (form.title?.value || '').trim(),
        authors,

        // Champs communs (selon type)
        date: dateValue,
        publisher: publisherValue,
        place: placeValue,
        language: languageValue,
        isbn: isbnValue,

        // Livre
        abstract: (form.abstract?.value || '').trim(),

        // Chapitre
        bookTitle: (form.bookTitle?.value || '').trim(),
        pages: (form.pages?.value || '').trim(),
        series: (form.series?.value || '').trim(),
        seriesNumber: (form.seriesNumber?.value || '').trim(),
        volume: (form.volume?.value || '').trim(),
        edition: (form.edition?.value || '').trim(),

        // Article
        publication: (form.articlePublication?.value || '').trim(),
        articleVolume: (form.articleVolume?.value || '').trim(),
        articleIssue: (form.articleIssue?.value || '').trim(),
        articlePages: (form.articlePages?.value || '').trim(),
        doi: normalizeDoi((form.articleDoi?.value || '').trim()),

        // Conference Paper
        conferenceName: (form.conferenceName?.value || '').trim(),

        extra: extraValue
      };

      // Validation minimale
      if (!payload.title) throw new Error('Titre manquant.');
      if (!payload.date) throw new Error('Date manquante.');

      if (pubType === 'book') {
        if (!payload.publisher) throw new Error('Publisher manquant.');
        if (!payload.place) throw new Error('Place manquante.');
      }

      if (pubType === 'bookSection') {
        if (!payload.publisher) throw new Error('Publisher manquant.');
        if (!payload.place) throw new Error('Place manquante.');
        if (!payload.bookTitle) throw new Error('Book Title manquant (chapitre).');
      }

      if (pubType === 'journalArticle') {
        if (!payload.publication) throw new Error('Publication (revue) manquante.');
      }

      if (pubType === 'conferencePaper') {
        if (!payload.conferenceName) throw new Error('Conference Name manquant.');
        // Publisher/Place/Language : non obligatoires (comme tu l’as défini)
      }

      const r = await fetch('/.netlify/functions/zotero-create-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await r.text();

      if (r.ok) {
        setStatus('✅ Envoyé vers Zotero', 'ok');
        setTimeout(() => clearStatus(), 3000);

        // Reset en conservant le type
        const currentType = pubTypeSelect?.value || pubType;
        form.reset();
        if (pubTypeSelect) pubTypeSelect.value = currentType;
        togglePubType(currentType);
        resetAuthors();

        // Restaure la valeur par défaut "Not set" si le champ existe
        if (form.tex_x_audience) form.tex_x_audience.value = 'Not set';
      } else {
        setStatus(`❌ Erreur Zotero (${r.status}) : ${text}`, 'err');
      }
    } catch (err) {
      setStatus('❌ ' + (err?.message || 'Erreur'), 'err');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Init onglets si présents
  initTabsIfPresent();
}
