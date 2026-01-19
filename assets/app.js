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

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function resetAuthors() {
  const list = document.getElementById('authors-list');
  if (!list) return;
  list.innerHTML = '';
  addAuthorRow();
}

function getAuthors() {
  return [...document.querySelectorAll('.author-row')].map(row => {
    const [fn, ln] = row.querySelectorAll('input');
    return { firstName: (fn.value || '').trim(), lastName: (ln.value || '').trim() };
  }).filter(a => a.firstName || a.lastName);
}

// --- UI: switch Livre / Chapitre ---
function togglePubType(pubType) {
  document.getElementById('book-fields').style.display =
    pubType === 'book' ? 'block' : 'none';
  document.getElementById('section-fields').style.display =
    pubType === 'bookSection' ? 'block' : 'none';

  // UX: effacer le statut pour éviter “✅ Envoyé” qui traîne
  clearStatus();
}

// --- Init ---
const addBtn = document.getElementById('add-author-btn');
if (addBtn) addBtn.onclick = () => addAuthorRow();

resetAuthors();

const pubTypeSelect = document.getElementById('pubType');
if (pubTypeSelect) {
  pubTypeSelect.onchange = (e) => togglePubType(e.target.value);
  // état initial
  togglePubType(pubTypeSelect.value);
}

const form = document.getElementById('pub-form');
form.onsubmit = async (e) => {
  e.preventDefault();

  const submitBtn = form.querySelector('button[type="submit"]');

  // UX: feedback immédiat
  clearStatus();
  setStatus('⏳ Envoi en cours…', 'info');
  submitBtn.disabled = true;

  try {
    const authors = getAuthors();

    // petit garde-fou UX (au moins un nom)
    const hasLastName = authors.some(a => (a.lastName || '').trim().length > 0);
    if (!hasLastName) {
      setStatus('❌ Merci de renseigner au moins un Nom d’auteur.', 'err');
      submitBtn.disabled = false;
      return;
    }

    const payload = {
      kind: 'publication',
      pubType: form.pubType.value,
      title: (form.title.value || '').trim(),
      authors,
      date: (form.date?.value || '').trim(),
      publisher: (form.publisher?.value || '').trim(),
      place: (form.place?.value || '').trim(),
      isbn: (form.isbn?.value || '').trim(),
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

    // validation minimale selon type
    if (!payload.title) throw new Error('Titre manquant.');
    if (!payload.date) throw new Error('Date manquante.');
    if (!payload.publisher) throw new Error('Publisher manquant.');
    if (!payload.place) throw new Error('Place manquant.');

    if (payload.pubType === 'bookSection' && !payload.bookTitle) {
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

      // (optionnel mais recommandé) effacer après 3s pour éviter confusion à la saisie suivante
      setTimeout(() => clearStatus(), 3000);

      // reset champs mais garder le type sélectionné
      const currentType = form.pubType.value;
      form.reset();
      form.pubType.value = currentType;
      togglePubType(currentType);

      // reset auteurs
      resetAuthors();
    } else {
      setStatus(`❌ Erreur Zotero (${r.status}) : ${text}`, 'err');
    }
  } catch (err) {
    setStatus('❌ ' + (err.message || 'Erreur'), 'err');
  } finally {
    submitBtn.disabled = false;
  }
};
