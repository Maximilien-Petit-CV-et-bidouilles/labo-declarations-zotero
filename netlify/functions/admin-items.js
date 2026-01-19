// netlify/functions/admin-items.js
exports.handler = async (event) => {
  try {
    // Auth Netlify Identity
    const user = event.clientContext && event.clientContext.user;
    if (!user) return json(401, { error: 'Unauthorized (not logged in)' });

    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: 'Missing Zotero env vars' });
    }

    const url = `https://api.zotero.org/${libraryType}/${libraryId}/items?limit=200&sort=dateModified&direction=desc`;

    const res = await fetch(url, {
      headers: { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' }
    });

    const raw = await res.text();
    if (!res.ok) return json(res.status, { error: 'Zotero error', details: raw });

    const items = JSON.parse(raw);

    const filtered = items
      .map(z => z?.data)
      .filter(Boolean)
      .filter(d => d.itemType === 'book' || d.itemType === 'bookSection')
      .map(d => ({
        key: d.key,
        itemType: d.itemType,
        title: d.title || '',
        date: d.date || '',
        year: extractYear(d.date || ''),
        creatorsText: (d.creators || [])
          .filter(c => c && (c.creatorType === 'author' || c.creatorType === 'editor'))
          .map(c => `${(c.lastName||'').trim()} ${(c.firstName||'').trim()}`.trim())
          .filter(Boolean)
          .join(', '),
        bookTitle: d.bookTitle || '',
        publisher: d.publisher || '',
        place: d.place || '',
        isbn: d.ISBN || d.isbn || '',
        flags: parseDLABFlags(d.extra || '')
      }));

    return json(200, { fetchedAt: new Date().toISOString(), items: filtered });
  } catch (err) {
    return json(500, { error: 'Server error', message: err.message });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

function extractYear(dateStr) {
  const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

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
    flags[k] = normalizeBool(v);
  });
  return flags;
}

function normalizeBool(v) {
  if (v === 'yes' || v === 'true' || v === 'oui') return 'yes';
  if (v === 'no' || v === 'false' || v === 'non') return 'no';
  return v;
}
