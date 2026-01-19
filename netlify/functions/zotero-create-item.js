// netlify/functions/zotero-create-item.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return {
        statusCode: 500,
        body: 'Zotero API non configurée (variables d’environnement manquantes).'
      };
    }

    // Pour l’instant : chapitre d’ouvrage (bookSection)
    const item = buildBookSectionItem(payload);

    const res = await fetch(`https://api.zotero.org/${libraryType}/${libraryId}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3'
      },
      body: JSON.stringify([item])
    });

    const text = await res.text();

    if (!res.ok) {
      return { statusCode: res.status, body: `Erreur Zotero (${res.status}): ${text}` };
    }

    return { statusCode: 200, body: text };
  } catch (err) {
    return { statusCode: 500, body: 'Erreur serveur : ' + err.message };
  }
};

// --- Création d'un item Zotero de type "bookSection" ---
function buildBookSectionItem(payload) {
  const creators = parseCreatorsFlexible(payload.authors, 'author');

  return {
    itemType: 'bookSection',
    title: payload.title || '',
    creators,
    bookTitle: payload.bookTitle || '',
    series: payload.series || '',
    seriesNumber: payload.seriesNumber || '',
    volume: payload.volume || '',
    edition: payload.edition || '',
    date: payload.date || '',
    publisher: payload.publisher || '',
    place: payload.place || '',
    pages: payload.pages || '',
    ISBN: payload.isbn || '',
    extra: payload.extra || '',
    collections: []
  };
}

function parseCreatorsFlexible(authors, creatorType) {
  // Nouveau format: tableau [{firstName,lastName}, ...]
  if (Array.isArray(authors)) {
    return authors
      .map((a) => ({
        creatorType,
        firstName: (a.firstName || '').trim(),
        lastName: (a.lastName || '').trim()
      }))
      .filter((a) => a.firstName || a.lastName)
      .map((a) => {
        if (!a.lastName && a.firstName) {
          return { creatorType, firstName: '', lastName: a.firstName };
        }
        return a;
      });
  }

  // Ancien format: string "Prénom Nom, Prénom Nom"
  return parseCreators(authors, creatorType);
}

function parseCreators(raw, creatorType) {
  const s = (raw || '').trim();
  if (!s) return [];

  return s
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((fullName) => {
      const parts = fullName.split(' ').filter(Boolean);

      if (parts.length === 1) {
        return { creatorType, firstName: '', lastName: parts[0] };
      }

      const firstName = parts.shift() || '';
      const lastName = parts.join(' ') || '';
      return { creatorType, firstName, lastName };
    });
}
