// netlify/functions/admin-items.js
//
// Endpoint admin (auth Netlify Identity)
// - Pagination Zotero (100 max / page)
// - Chargement progressif côté front
// - Cache mémoire "warm function" (≈25s) pour éviter de re-puller 1500 items en boucle
//
// ⚠️ Pas de cache navigateur/proxy (endpoint admin)


// =======================
// Cache mémoire (warm)
// =======================
let __CACHE = {
  at: 0,
  key: '',
  data: null
};

function getCache(key, ttlMs){
  if (__CACHE.data && __CACHE.key === key && (Date.now() - __CACHE.at) < ttlMs) {
    return __CACHE.data;
  }
  return null;
}

function setCache(key, data){
  __CACHE = { at: Date.now(), key, data };
}


// =======================
// Handler
// =======================
exports.handler = async (event) => {
  try {
    const user = await verifyIdentityUser(event);
    if (!user) return json(401, { error: 'Unauthorized (not logged in)' });

    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' | 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: 'Missing Zotero env vars' });
    }

    const qs = event.queryStringParameters || {};
    const start = qs.start !== undefined ? Math.max(0, parseInt(qs.start, 10) || 0) : null;
    const limitReq = qs.limit !== undefined ? (parseInt(qs.limit, 10) || 100) : null;

    const limit = limitReq !== null
      ? Math.min(100, Math.max(1, limitReq))
      : 100;

    // =======================
    // Mode PAGE (rapide)
    // =======================
    if (start !== null || limitReq !== null) {
      const page = await fetchZoteroPage({ apiKey, libraryType, libraryId, start: start || 0, limit });
      const items = mapItems(page.items);

      return json(200, {
        fetchedAt: new Date().toISOString(),
        mode: 'page',
        start: page.start,
        limit: page.limit,
        totalResults: page.totalResults,
        hasMore: page.hasMore,
        nextStart: page.hasMore ? (page.start + page.items.length) : null,
        items
      });
    }

    // =======================
    // Mode ALL (rare, compat)
    // =======================
    const CACHE_TTL = 25000; // 25s
    const cacheKey = 'admin-items-all';

    const cached = getCache(cacheKey, CACHE_TTL);
    if (cached) {
      return json(200, { ...cached, cached: true });
    }

    const all = await fetchAllZoteroItems({ apiKey, libraryType, libraryId });
    const items = mapItems(all);

    const payload = {
      fetchedAt: new Date().toISOString(),
      mode: 'all',
      items
    };

    setCache(cacheKey, payload);
    return json(200, payload);

  } catch (err) {
    console.error(err);
    return json(500, { error: 'Server error', message: err.message });
  }
};


// =======================
// Helpers HTTP
// =======================
function json(statusCode, obj){
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // ❌ pas de cache navigateur/proxy
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}


// =======================
// Zotero fetch helpers
// =======================
async function fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit }){
  const url =
    `https://api.zotero.org/${libraryType}/${libraryId}/items` +
    `?limit=${limit}&start=${start}&sort=dateModified&direction=desc`;

  const res = await fetch(url, {
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': '3',
      'Accept': 'application/json'
    }
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero error HTTP ${res.status}: ${raw}`);
  }

  const items = JSON.parse(raw);
  const totalResults = parseInt(res.headers.get('Total-Results') || '', 10);
  const total = Number.isFinite(totalResults) ? totalResults : null;

  const hasMore = total !== null
    ? (start + items.length) < total
    : (Array.isArray(items) && items.length === limit);

  return {
    start,
    limit,
    totalResults: total,
    hasMore,
    items: Array.isArray(items) ? items : []
  };
}

async function fetchAllZoteroItems({ apiKey, libraryType, libraryId }){
  const limit = 100;
  let start = 0;
  const MAX_ITEMS = 10000;

  const all = [];
  while (true) {
    const page = await fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit });
    if (!page.items.length) break;

    all.push(...page.items);
    if (!page.hasMore) break;

    start += page.items.length;
    if (all.length >= MAX_ITEMS) break;
  }

  return all;
}


// =======================
// Mapping Zotero → Admin
// =======================
function mapItems(zoteroWrappedItems){
  return (zoteroWrappedItems || [])
    .map(z => z?.data)
    .filter(Boolean)
    .filter(d =>
      d.itemType === 'book' ||
      d.itemType === 'bookSection' ||
      d.itemType === 'journalArticle'
    )
    .map(d => ({
      key: d.key,
      itemType: d.itemType,
      title: d.title || '',
      date: d.date || '',
      year: extractYear(d.date || ''),

      creatorsText: (d.creators || [])
        .filter(c => c && (c.creatorType === 'author' || c.creatorType === 'editor'))
        .map(c => `${(c.lastName || '').trim()} ${(c.firstName || '').trim()}`.trim())
        .filter(Boolean)
        .join(', '),

      bookTitle: d.bookTitle || '',
      publicationTitle: d.publicationTitle || d.journalAbbreviation || '',
      publisher: d.publisher || '',
      place: d.place || '',
      isbn: d.ISBN || d.isbn || '',
      doi: d.DOI || d.doi || '',
      volume: d.volume || '',
      issue: d.issue || '',
      pages: d.pages || '',

      flags: parseDLABFlags(d.extra || '')
    }));
}

function extractYear(dateStr){
  const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}


// =======================
// DLAB flags
// =======================
function parseDLABFlags(extra){
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

function normalizeBool(v){
  if (v === 'yes' || v === 'true' || v === 'oui') return 'yes';
  if (v === 'no' || v === 'false' || v === 'non') return 'no';
  return v;
}


// =======================
// Netlify Identity verify
// =======================
async function verifyIdentityUser(event){
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim();
  if (!token) return null;

  const siteUrl =
    process.env.URL ||
    (event.headers?.origin || event.headers?.Origin || '').trim();

  if (!siteUrl) return null;

  const userUrl = `${siteUrl.replace(/\/$/, '')}/.netlify/identity/user`;

  const res = await fetch(userUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) return null;
  return await res.json();
}
