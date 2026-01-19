// netlify/functions/public-suivi.js
// Renvoie un JSON public "sanitisé" à partir de Zotero (sans exposer la clé API côté navigateur)

exports.handler = async () => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;             // clé avec droit de lecture (ou lecture+écriture)
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE;   // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: 'Missing Zotero env vars' });
    }

    // Récupère les items triés par date de modification (desc), limite raisonnable.
    // Tu peux augmenter limit si besoin.
    const url = `https://api.zotero.org/${libraryType}/${libraryId}/items?limit=200&sort=dateModified&direction=desc`;

    const res = await fetch(url, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3'
      }
    });

    const raw = await res.text();
    if (!res.ok) {
      return json(res.status, { error: 'Zotero error', details: raw });
    }

    const items = JSON.parse(raw);

    // On ne garde que livres + chapitres
    const filtered = items
      .map(z => z?.data)
      .filter(Boolean)
      .filter(d => d.itemType === 'book' || d.itemType === 'bookSection')
      .map(d => {
        const flags = parseDLABFlags(d.extra || '');

        return {
          itemType: d.itemType,
          title: d.title || '',
          date: d.date || '',
          year: extractYear(d.date || ''),
          creators: Array.isArray(d.creators) ? d.creators : [],
          creatorsText: (d.creators || [])
            .filter(c => c && (c.creatorType === 'author' || c.creatorType === 'editor'))
            .map(c => `${(c.lastName||'').trim()} ${(c.firstName||'').trim()}`.trim())
            .filter(Boolean)
            .join(', '),

          // Champs utiles au tableau
          bookTitle: d.bookTitle || '',
          publisher: d.publisher || '',
          place: d.place || '',
          isbn: d.ISBN || d.isbn || '',
          flags,

          // Lien public (si bibliothèque publique). Sinon, on renvoie rien.
          zoteroUrl: buildZoteroUrl(libraryType, libraryId, d.key)
        };
      });

    return json(200, {
      fetchedAt: new Date().toISOString(),
      items: filtered
    });
  } catch (err) {
    return json(500, { error: 'Server error', message: err.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Cache léger côté navigateur (tu peux mettre 0 si tu veux du temps réel)
      'Cache-Control': 'public, max-age=60'
    },
    body: JSON.stringify(obj)
  };
}

function extractYear(dateStr) {
  const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

// Parse le bloc:
// [DLAB]
// hal_create: yes
// comms_publish: no
// hal_done: yes
// comms_done: no
// [/DLAB]
function parseDLABFlags(extra) {
  const s = String(extra || '');
  const start = s.indexOf('[DLAB]');
  const end = s.indexOf('[/DLAB]');
  if (start === -1 || end === -1 || end <= start) return {};

  const block = s.slice(start + 6, end).trim();
  const flags = {};

  block.split('\n').forEach(line => {
    const l = line.trim();
    if (!l || l.startsWith('#')) return;
    const idx = l.indexOf(':');
    if (idx === -1) return;
    const k = l.slice(0, idx).trim();
    const v = l.slice(idx + 1).trim().toLowerCase();
    if (!k) return;
    // on accepte yes/no/true/false/oui/non
    flags[k] = normalizeBool(v);
  });

  return flags;
}

function normalizeBool(v) {
  if (v === 'yes' || v === 'true' || v === 'oui') return 'yes';
  if (v === 'no' || v === 'false' || v === 'non') return 'no';
  return v; // fallback (pour ne pas perdre l’info)
}

// ⚠️ Ce lien n’est utile que si la bibliothèque est publique.
// Sinon, tu peux le retirer.
function buildZoteroUrl(libraryType, libraryId, itemKey) {
  if (!libraryType || !libraryId || !itemKey) return '';
  // URL “classique” Zotero Web Library (peut varier selon réglages de visibilité)
  // On fournit un lien générique plutôt que de promettre un accès privé.
  if (libraryType === 'groups') {
    return `https://www.zotero.org/groups/${libraryId}/items/${itemKey}`;
  }
  if (libraryType === 'users') {
    return `https://www.zotero.org/users/${libraryId}/items/${itemKey}`;
  }
  return '';
}
