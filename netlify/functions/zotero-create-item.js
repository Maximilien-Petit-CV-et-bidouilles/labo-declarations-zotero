// netlify/functions/zotero-create-item.js

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
        body: JSON.stringify([item])
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

// Mapping simple des 3 types de formulaires vers Zotero
function buildZoteroItemFromPayload(payload) {
  const kind = payload.kind || 'publication';
  let itemType = 'journalArticle';
  let date = '';

  if (kind === 'publication') {
    itemType = payload.itemType || 'journalArticle';
    date = payload.year || '';
  } else if (kind === 'event') {
    // Pour les événements, on utilise un "report" générique
    itemType = 'report';
    // on stocke la date de début
    date = payload.startDate || '';
  } else if (kind === 'communication') {
    // Pour les communications, on peut utiliser "presentation"
    itemType = 'presentation';
    date = payload.date || payload.year || '';
  }

  // Créateurs (auteurs / intervenants) si fournis
  const rawAuthors = payload.authors || '';
  const creators = rawAuthors
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

  if (kind === 'event') {
    if (payload.eventType) {
      extraLines.push(`eventType: ${payload.eventType}`);
    }
    if (payload.endDate) {
      extraLines.push(`endDate: ${payload.endDate}`);
    }
    if (payload.organizers) {
      extraLines.push(`organizers: ${payload.organizers}`);
    }
  }

  if (kind === 'communication') {
    if (payload.commType) {
      extraLines.push(`communicationType: ${payload.commType}`);
    }
    if (payload.eventName) {
      extraLines.push(`eventName: ${payload.eventName}`);
    }
  }

  const baseItem = {
    itemType,
    title: payload.title || '',
    creators,
    date,
    extra: extraLines.join('\n'),
    collections: []
  };

  if (kind === 'publication') {
    return {
      ...baseItem,
      DOI: payload.doi || '',
      publicationTitle: payload.publicationTitle || ''
    };
  }

  if (kind === 'event') {
    return {
      ...baseItem,
      place: payload.location || '',
      url: payload.url || ''
    };
  }

  if (kind === 'communication') {
    return {
      ...baseItem,
      place: payload.location || '',
      conferenceName: payload.eventName || ''
    };
  }

  return baseItem;
}
