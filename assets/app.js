// assets/app.js

async function sendPublication(form) {
  const statusElt = document.getElementById('pub-status');
  statusElt.textContent = '';
  statusElt.className = 'status';

  const data = {
    kind: 'publication',
    title: form.title.value.trim(),
    authors: form.authors.value.trim(),
    year: form.year.value.trim(),
    itemType: form.itemType.value,
    doi: form.doi.value.trim() || null,
    publicationTitle: form.publicationTitle.value.trim() || null,
    internalNotes: form.internalNotes.value.trim() || null
  };

  // petite validation côté client
  if (!data.title || !data.authors || !data.year) {
    statusElt.textContent = 'Merci de remplir au moins le titre, les auteurs et l’année.';
    statusElt.classList.add('err');
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Envoi en cours…';

  try {
    const resp = await fetch('/.netlify/functions/zotero-create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const text = await resp.text();

    if (resp.ok) {
      statusElt.textContent = '✅ Publication envoyée à Zotero.';
      statusElt.classList.add('ok');
      form.reset();
    } else {
      console.error('Erreur Zotero:', text);
      statusElt.textContent = '❌ Erreur côté serveur / Zotero. Voir la console navigateur pour les détails.';
      statusElt.classList.add('err');
    }
  } catch (err) {
    console.error(err);
    statusElt.textContent = '❌ Erreur réseau ou serveur : ' + err.message;
    statusElt.classList.add('err');
  } finally {
    button.disabled = false;
    button.textContent = 'Envoyer vers Zotero';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const pubForm = document.getElementById('pub-form');
  if (pubForm) {
    pubForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendPublication(pubForm);
    });
  }
});
