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
    } else {
      console.error('Erreur Zotero:', text);
      console.error('Erreur Zotero:', text);
setStatus(
  statusId,
  '❌ Erreur Zotero : ' + text,
  false
);

    }
  } catch (err) {
    console.error(err);
    setStatus(statusId, '❌ Erreur réseau ou serveur : ' + err.message, false);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// --- Publications ---
function handlePublicationForm(form) {
  const payload = {
    kind: 'publication',
    pubType: 'book',
    title: form.title.value.trim(),
    authors: form.authors.value.trim(),
    date: form.date.value.trim(), // année ou date libre
    abstract: form.abstract.value.trim() || null,
    publisher: form.publisher.value.trim(),
    place: form.place.value.trim(),
    isbn: form.isbn.value.trim() || null,
    language: form.language.value || null,
    extra: form.extra.value.trim() || null
  };

  if (!payload.title || !payload.authors || !payload.date || !payload.publisher || !payload.place) {
    setStatus(
      'pub-status',
      'Merci de remplir au moins Title, Author(s), Date, Publisher et Place.',
      false
    );
    return;
  }

  sendToZotero(payload, form, 'pub-status');
}

// --- Événements ---
function handleEventForm(form) {
  const payload = {
    kind: 'event',
    title: form.title.value.trim(),
    eventType: form.eventType.value,
    location: form.location.value.trim(),
    startDate: form.startDate.value,
    endDate: form.endDate.value || null,
    organizers: form.organizers.value.trim() || null,
    url: form.url.value.trim() || null,
    internalNotes: form.internalNotes.value.trim() || null
  };

  if (!payload.title || !payload.eventType || !payload.location || !payload.startDate) {
    setStatus(
      'event-status',
      'Merci de remplir au moins le titre, le type, le lieu et la date de début.',
      false
    );
    return;
  }

  sendToZotero(payload, form, 'event-status');
}

// --- Communications ---
function handleCommForm(form) {
  const payload = {
    kind: 'communication',
    title: form.title.value.trim(),
    authors: form.authors.value.trim(),
    commType: form.commType.value,
    year: form.year.value.trim(),
    eventName: form.eventName.value.trim(),
    location: form.location.value.trim(),
    date: form.date.value,
    internalNotes: form.internalNotes.value.trim() || null
  };

  if (
    !payload.title ||
    !payload.authors ||
    !payload.commType ||
    !payload.year ||
    !payload.eventName ||
    !payload.location ||
    !payload.date
  ) {
    setStatus(
      'comm-status',
      'Merci de remplir tous les champs obligatoires (titre, auteurs, type, année, événement, lieu, date).',
      false
    );
    return;
  }

  sendToZotero(payload, form, 'comm-status');
}

// --- Gestion de l’affichage des sections ---
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

  // Par défaut, on s’assure que la section publication est visible
  showSection('pub-section');
}

// --- Initialisation ---
function addAuthorRow(firstName = '', lastName = '') {
  const list = document.getElementById('authors-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'two-cols';
  row.style.marginBottom = '10px';

  row.innerHTML = `
    <label>
      <span>Prénom</span>
      <input name="authorFirstName" value="${escapeHtml(firstName)}" />
    </label>
    <label>
      <span>Nom *</span>
      <input name="authorLastName" value="${escapeHtml(lastName)}" required />
    </label>
    <div style="grid-column: 1 / -1; display:flex; justify-content:flex-end;">
      <button type="button" class="remove-author-btn" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:0;">
        Supprimer
      </button>
    </div>
  `;

  row.querySelector('.remove-author-btn').addEventListener('click', () => {
    row.remove();
  });

  list.appendChild(row);
}

function getAuthorsFromForm(form) {
  const firstNames = Array.from(form.querySelectorAll('input[name="authorFirstName"]'));
  const lastNames = Array.from(form.querySelectorAll('input[name="authorLastName"]'));

  const authors = [];
  for (let i = 0; i < Math.max(firstNames.length, lastNames.length); i++) {
    const fn = (firstNames[i]?.value || '').trim();
    const ln = (lastNames[i]?.value || '').trim();
    if (fn || ln) authors.push({ firstName: fn, lastName: ln });
  }
  return authors;
}

// mini helper pour éviter d’injecter du texte brut dans innerHTML
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  setupSectionSwitcher();

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
