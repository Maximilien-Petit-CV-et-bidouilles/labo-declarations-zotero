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

  // UX: ne pas laisser un vieux "✅ Envoyé" traîner
  clearStatus();
}

// --- Init
const form = document.getElementById('pub-form');
const submitBtn = form.querySelector('button[type="submit"]');

document.getElementById('add-author-btn').addEventListener('click', () => addAuthorRow());
resetAuthors();

const pubTypeSelect = document.getElementById('pubType');
pubTypeSelect.addEventListener('change', (e) => togglePubType(e.target.value));
togglePubType(pubTypeSelect.value);

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

    // Lire les bons champs (évite les doublons)
    const dateValue = isSection
      ? (form.sectionDate?.value || '').trim()
      : (form.date?.value || '').trim();

    const publisherValue = isSection
      ? (form.sectionPublisher?.value || '').trim()
      : (form.publisher?.value || '').trim();

    const placeValue = isSection
      ? (form.sectionPlace?.value || '').trim()
      : (form.place?.value || '').trim();

    const isbnValue = isSection
      ? (form.sectionIsbn?.value || '').trim()
      : (form.isbn?.value || '').trim();

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
      extra: (form.extra.value || '').trim()
    };

    // Validation minimale
    if (!payload.title) throw new Error('Titre manquant.');
    if (!payload.date) throw new Error('Date manquante.');
    if (!payload.publisher) throw new Error('Publisher manquant.');
    if (!payload.place) throw new Error('Place manquant.');

    if (pubType === 'bookSection' && !payload.bookTitle) {
      throw new Error('Book Title manquant (chapitre).');
    }

    const r = await fetch('/.netlify/functions/zotero-create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await r.text();

    if (r.ok) {
      setStatus('✅ Envoyé vers Zotero', 'ok');

      // Optionnel : effacer après 3s pour éviter confusion
      setTimeout(() => clearStatus(), 3000);

      // Reset du formulaire en conservant le type sélectionné
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
