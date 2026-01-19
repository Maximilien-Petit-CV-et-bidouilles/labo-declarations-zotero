// netlify/functions/zotero-create-item.js

// Cette fonction reçoit les données du formulaire
// et crée un item dans Zotero via l’API.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;     // ex : '1234567'

    if (!apiKey || !libraryType || !libraryId) {
      return {
        statusCode: 500,
        body: 'Zotero API non configurée (variables d’environnement manquantes).'
      };
    }

    // Construire l’item Zotero
    const item = buildZoteroItemFromPayload(payload);

    const response = await fetch(
      `https://api.zotero.org/${libraryType}/${libraryId}/items`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Zotero-API-Key': apiKey,
          'Zotero-API-Version': '3'
        },
        body: JSON.stringify([item]) // l’API attend un tableau
      }
    );

    const text = await response.text();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: `Erreur Zotero (${response.status}): ${text}`
      };
    }

    return {
      statusCode: 200,
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: 'Erreur serveur : ' + err.message
    };
  }
};

// -- mapping simple formulaire -> item Zotero --
function buildZoteroItemFromPayload(payload) {
  const itemType = payload.itemType || 'journalArticle';

  // transformer "Prénom Nom, Prénom Nom" en tableau creators
  const creators = (payload.authors || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((fullName) => {
      const parts = fullName.split(' ');
      const firstName = parts.shift();
      const lastName = parts.join(' ');
      return {
        creatorType: 'author',
        firstName: firstName || '',
        lastName: lastName || ''
      };
    });

  const extraLines = [];

  if (payload.internalNotes) {
    extraLines.push(`Internal notes: ${payload.internalNotes}`);
  }
  // tu pourras ajouter ici x-audience, x-language, id HAL, etc.

  return {
    itemType,
    title: payload.title || '',
    creators,
    date: payload.year || '',
    DOI: payload.doi || '',
    publicationTitle: payload.publicationTitle || '',
    extra: extraLines.join('\n'),
    collections: [] // pour l’instant, pas de collection spécifique
  };
}
