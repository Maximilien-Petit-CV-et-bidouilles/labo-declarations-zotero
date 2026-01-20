// assets/app.js

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
      return { firstName: (fn.value || '').trim(), lastName: (ln.value || '').trim() };
    })
    .filter(a => a.firstName || a.lastName);
}

function togglePubType(pubType) {
  document.getElementById('book-fields').style.display =
    pubType === 'book' ? 'block' : 'none';
  document.getElementById('section-fields').style.display =
    pubType === 'bookSection' ? 'block' : 'none';
  const article = document.getElementById('article-fields');
  if (article) article.style.display = pubType === 'journalArticle' ? 'block' : 'none';
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

function getAxesFromForm(form) {
  const axes = [];
  if (form.axisPICMAP?.checked) axes.push('PICMAP');
  if (form.axisMOPTIS?.checked) axes.push('MOPTIS');
  if (form.axisOCSO?.checked) axes.push('OCSO');
  return axes;
}

// --- Init
const form = document.getElementById('pub-form');
const submitBtn = form.querySelector('button[type="submit"]');

document.getElementById('add-author-btn').addEventListener('click', () => addAuthorRow());
resetAuthors();

const pubTypeSelect = document.getElementById('pubType');
pubTypeSelect.addEventListener('change', (e) => {
  togglePubType(e.target.value);
  clearStatus();
});
togglePubType(pubTypeSelect.value);

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
  submitBtn.disabled = true;

  try {
    const authors = getAuthors();
    const hasLastName = authors.some(a => (a.lastName || '').trim().length > 0);
    if (!hasLastName) {
      setStatus('❌ Merci de renseigner au moins un Nom d’auteur.', 'err');
      submitBtn.disabled = false;
      return;
    }

    const pubType = form.pubType.value;
    const isSection = pubType === 'bookSection';
    const isArticle = pubType === 'journalArticle';

    // Options obligatoires
    const optHal = (form.optHal?.value || '').trim();     // yes/no
    const optComms = (form.optComms?.value || '').trim(); // yes/no
    if (!optHal || !optComms) {
      setStatus('❌ Merci de répondre aux 2 questions (HAL + communication).', 'err');
      submitBtn.disabled = false;
      return;
    }

    // ✅ Axes
    const axes = getAxesFromForm(form);

    // Lire les bons champs (évite les doublons)
    const dateValue = isSection
      ? (form.sectionDate?.value || '').trim()
      : isArticle
        ? (form.articleDate?.value || '').trim()
        : (form.date?.value || '').trim();

    const publisherValue = isSection
      ? (form.sectionPublisher?.value || '').trim()
      : isArticle
        ? (form.articlePublisher?.value || '').trim()
        : (form.publisher?.value || '').trim();

    const placeValue = isSection
      ? (form.sectionPlace?.value || '').trim()
      : isArticle
        ? (form.articlePlace?.value || '').trim()
        : (form.place?.value || '').trim();

    const isbnValue = isSection
      ? (form.sectionIsbn?.value || '').trim()
      : (form.isbn?.value || '').trim();

    const extraValue = buildExtraWithOptions(
      (form.extra?.value || '').trim(),
      optHal,
      optComms,
      axes
    );

    const payload = {
      kind: 'publication',
      pubType,
      title: (form.title.value || '').trim(),
      authors,
      date: dateValue,
      publisher: publisherValue,
      place: placeValue,
      isbn: isbnValue,
      abstract: (form.abstract?.value || '').trim(),
      language: (form.language?.value || '').trim(),
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

      extra: extraValue
    };

    // Validation minimale
    if (!payload.title) throw new Error('Titre manquant.');
    if (!payload.date) throw new Error('Date manquante.');
    if (pubType === 'book' && !payload.publisher) throw new Error('Publisher manquant.');
    if (pubType === 'book' && !payload.place) throw new Error('Place manquante.');
    if (pubType === 'bookSection') {
      if (!payload.publisher) throw new Error('Publisher manquant.');
      if (!payload.place) throw new Error('Place manquante.');
      if (!payload.bookTitle) throw new Error('Book Title manquant (chapitre).');
    }
    if (pubType === 'journalArticle' && !payload.publication) throw new Error('Publication (revue) manquante.');

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
      const currentType = pubTypeSelect.value;
      form.reset();
      pubTypeSelect.value = currentType;
      togglePubType(currentType);
      resetAuthors();
    } else {
      setStatus(`❌ Erreur Zotero (${r.status}) : ${text}`, 'err');
    }
  } catch (err) {
    setStatus('❌ ' + (err.message || 'Erreur'), 'err');
  } finally {
    submitBtn.disabled = false;
  }
});
