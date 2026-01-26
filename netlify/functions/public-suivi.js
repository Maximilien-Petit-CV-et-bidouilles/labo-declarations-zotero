// netlify/functions/public-suivi.js
// JSON public depuis Zotero (sans exposer la clé API côté navigateur)
//
// - Mode "page" si start/limit sont fournis (plus rapide)
// - Mode "all" (par défaut) : récupère tout (pagination interne)
//
// ✅ Optimisation perf : cache HTTP court (60s) pour éviter de re-puller 1500 items à chaque visite

exports.handler = async (event) => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: "Missing Zotero env vars" });
    }

    const qs = event.queryStringParameters || {};
    const start = qs.start !== undefined ? Math.max(0, parseInt(qs.start, 10) || 0) : null;
    const limitReq = qs.limit !== undefined ? (parseInt(qs.limit, 10) || 100) : null;

    // Zotero max=100
    const limit = limitReq !== null ? Math.min(100, Math.max(1, limitReq)) : 100;

    // ✅ Mode "page" si start/limit fournis => un seul appel Zotero
    if (start !== null || limitReq !== null) {
      const page = await fetchZoteroPage({ apiKey, libraryType, libraryId, start: start || 0, limit });
      const items = mapItems(page.items, libraryType, libraryId);

      return json(200, {
        fetchedAt: new Date().toISOString(),
        mode: "page",
        start: page.start,
        limit: page.limit,
        totalResults: page.totalResults,
        hasMore: page.hasMore,
        nextStart: page.hasMore ? (page.start + page.items.length) : null,
        count: items.length,
        items,
      });
    }

    // ✅ Mode "all" (compat)
    const all = await fetchAllZoteroItems({ apiKey, libraryType, libraryId });
    const items = mapItems(all, libraryType, libraryId);

    return json(200, {
      fetchedAt: new Date().toISOString(),
      mode: "all",
      count: items.length,
      items,
    });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // ✅ cache court (page publique interne)
      // stale-while-revalidate : Netlify/CDN peut servir une version encore fraîche
      // pendant qu'il récupère la nouvelle (meilleure UX sur gros volumes)
      "Cache-Control": "public, max-age=60, stale-while-revalidate=60",
    },
    body: JSON.stringify(obj),
  };
}

async function fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit }) {
  const url =
    `https://api.zotero.org/${libraryType}/${libraryId}/items` +
    `?limit=${limit}&start=${start}&sort=dateModified&direction=desc`;

  const res = await fetch(url, {
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3",
      "Accept": "application/json",
    },
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Zotero error HTTP ${res.status}: ${raw}`);

  const items = JSON.parse(raw);

  // Total-Results (souvent présent)
  const totalResults = parseInt(res.headers.get("Total-Results") || "", 10);
  const total = Number.isFinite(totalResults) ? totalResults : null;

  const hasMore = total !== null
    ? (start + items.length) < total
    : (Array.isArray(items) && items.length === limit);

  return {
    start,
    limit,
    totalResults: total,
    hasMore,
    items: Array.isArray(items) ? items : [],
  };
}

async function fetchAllZoteroItems({ apiKey, libraryType, libraryId }) {
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

function mapItems(zoteroWrappedItems, libraryType, libraryId) {
  return (zoteroWrappedItems || [])
    .map((z) => (z && z.data) ? z.data : null)
    .filter(Boolean)
    .filter((d) => d.itemType === "book" || d.itemType === "bookSection" || d.itemType === "journalArticle")
    .map((d) => ({
      itemType: d.itemType || "",
      title: d.title || "",
      date: d.date || "",

      bookTitle: d.bookTitle || "",
      publicationTitle: d.publicationTitle || "",
      publisher: d.publisher || "",
      place: d.place || "",
      isbn: d.ISBN || "",
      doi: d.DOI || "",
      volume: d.volume || "",
      issue: d.issue || "",
      pages: d.pages || "",

      creators: Array.isArray(d.creators) ? d.creators : [],
      flags: parseDLABFlags(d.extra || ""),

      zoteroUrl: buildZoteroUrl(libraryType, libraryId, d.key),
    }));
}

// Parse le bloc DLAB dans extra:
// [DLAB]
// hal_create: yes
// comms_publish: no
// hal_done: yes
// comms_done: no
// axes: PICMAP, MOPTIS
// [/DLAB]
function parseDLABFlags(extra) {
  const s = String(extra || "");
  const start = s.indexOf("[DLAB]");
  const end = s.indexOf("[/DLAB]");
  if (start === -1 || end === -1 || end <= start) return {};

  const block = s.slice(start + 6, end).trim();
  const flags = {};

  block.split("\n").forEach((line) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const idx = l.indexOf(":");
    if (idx === -1) return;

    const key = l.slice(0, idx).trim();
    let val = l.slice(idx + 1).trim();

    if (!key) return;

    const low = val.toLowerCase();
    if (low === "yes" || low === "true" || low === "oui") val = "yes";
    else if (low === "no" || low === "false" || low === "non") val = "no";

    flags[key] = val;
  });

  return flags;
}

function buildZoteroUrl(libraryType, libraryId, itemKey) {
  if (!libraryType || !libraryId || !itemKey) return "";
  if (libraryType === "groups") {
    return `https://www.zotero.org/groups/${libraryId}/items/${itemKey}`;
  }
  if (libraryType === "users") {
    return `https://www.zotero.org/users/${libraryId}/items/${itemKey}`;
  }
  return "";
}
