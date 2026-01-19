// assets/app.js

function setStatus(id, message, ok) {
  const elt = document.getElementById(id);
  if (!elt) return;
  elt.textContent = message || '';
  elt.className = 'status';
  if (message) {
    elt.classList.add(ok ? 'ok' : 'err');
  }
}

async function sendToZotero(payload, form, statusId) {
  const button = form.querySelector('button[type="submit"]');
  const originalLabel = button.textContent;

  setStatus(statusId, '', true);
  button.disabled = true;
  button.textContent = 'Envoi en cours…';

  try {
    const resp = await fetch('/.netlify/functions/zotero-create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();

    if (resp.ok) {
      setStatus(statusId, '✅ Déclaration envoyée à Zotero.', true);
      form.reset();

      if (payload.kind === 'publication') {
        resetAuthorsUI();
      }
    } else {
      console.error('Erreur Zotero:', text);
      setStatus(statusId, `❌ Erreur (${resp.status}) : ${text}`, false);
    }
  } catch (err) {
    console.error(err);
    setStatus(statusId, '❌ Erreur réseau ou serveur : ' + err.message, false);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function setupSectionSwitcher() {
  const buttons = document.querySelectorAll('.switcher button');
  const sections = document.querySelectorAll('.section');

  function showSection(targetId) {
    sections.forEach((sec) => {
      sec.classList.toggle('visible', sec.id === targetId);
    });
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.target === targetId);
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target) showSection(target);
    });
  });

  showSection('pub-section');
}

// --- Auteurs dynamiques ---
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function addAuthorRow(firstName = '', lastName = '') {
  const list = document.getElementById('authors-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'author-row';

  row.innerHTML = `
    <div class="two-cols">
      <label>
        <span>Prénom</span>
        <input name="authorFirstName" value="${escapeHtml(firstName)}" />
      </label>
      <label>
        <span>Nom *</span>
        <input name="authorLastName" value="${escapeHtml(lastName)}" required />
      </label>
    </div>
    <div class="row-actions">
      <button type="button" class="btn-link remove-author-btn">Supprimer</button>
    </div>
  `;

  row.querySelector('.remove-author-btn').addEventListener('click', () => {
    row.remove();
  });

  list.appendChild(row);
}

function resetAuthorsUI() {
  const list = document.getElementById('authors-list');
  if (!list) return;
  list.innerHTML = '';
  addAuthorRow();
}

function getAuthorsFromForm(form) {
  const firstNames = Array.from(form.querySelectorAll('input[name="authorFirstName"]'));
  const lastNames = Array.from(form.querySelectorAll('input[name="authorLastName"]'));

  const authors = [];
  const n = Math.max(firstNames.length, lastNames.length);

  for (let i = 0; i < n; i++) {
    const fn = (firstNames[i]?.value || '').trim();
    const ln = (lastNames[i]?.value || '').trim();
    if (fn || ln) authors.push({ firstName: fn, lastName: ln });
  }

  return authors.filter(a => (a.firstName || a.lastName));
}

// --- Publications : Chapitre d'ouvrage (bookSection) ---
function handlePublicationForm(form) {
  const authors = getAuthorsFromForm(form);

  const payload = {
    kind: 'publication',
    pubType: 'bookSection',
    title: form.title.value.trim(),
    authors,
    bookTitle: form.bookTitle.value.trim(),
    series: form.series.value.trim() || null,
    seriesNumber: form.seriesNumber.value.trim() || null,
    volume: form.volume.value.trim() || null,
    edition: form.edition.value.trim() || null,
    date: form.date.value.trim(),
    publisher: form.publisher.value.trim(),
    place: form.place.value.trim(),
    pages: form.pages.value.trim() || null,
    isbn: form.isbn.value.trim() || null,
    extra: form.extra.value.trim() || null
  };

  if (!payload.title || authors.length === 0 || !payload.bookTitle || !payload.date || !payload.publisher || !payload.place) {
    setStatus('pub-status', 'Merci de remplir Title, au moins un auteur, Book Title, Date, Publisher et Place.', false);
    return;
  }

  const hasAtLeastOneLastName = authors.some(a => (a.lastName || '').trim().length > 0);
  if (!hasAtLeastOneLastName) {
    setStatus('pub-status', 'Merci de renseigner au moins un Nom d’auteur.', false);
    return;
  }

  sendToZotero(payload, form, 'pub-status');
}

// --- Événements (placeholder) ---
function handleEventForm(form) {
  const payload = {
    kind: 'event',
    title: form.title.value.trim()
  };

  if (!payload.title) {
    setStatus('event-status', 'Merci de renseigner un titre.', false);
    return;
  }

  sendToZotero(payload, form, 'event-status');
}

// --- Communications (placeholder) ---
function handleCommForm(form) {
  const payload = {
    kind: 'communication',
    title: form.title.value.trim()
  };

  if (!payload.title) {
    setStatus('comm-status', 'Merci de renseigner un titre.', false);
    return;
  }

  sendToZotero(payload, form, 'comm-status');
}

document.addEventListener('DOMContentLoaded', () => {
  setupSectionSwitcher();

  resetAuthorsUI();

  const addBtn = document.getElementById('add-author-btn');
  if (addBtn) addBtn.addEventListener('click', () => addAuthorRow());

  const pubForm = document.getElementById('pub-form');
  if (pubForm) {
    pubForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handlePublicationForm(pubForm);
    });
  }

  const eventForm = document.getElementById('event-form');
  if (eventForm) {
    eventForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleEventForm(eventForm);
    });
  }

  const commForm = document.getElementById('comm-form');
  if (commForm) {
    commForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleCommForm(commForm);
    });
  }
});
