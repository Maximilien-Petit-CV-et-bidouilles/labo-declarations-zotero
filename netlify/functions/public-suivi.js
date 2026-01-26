// netlify/functions/public-suivi.js
// JSON public depuis Zotero (sans exposer la clé API côté navigateur)
//
// - Mode "page" si start/limit sont fournis (plus rapide)
// - Mode "all" (par défaut) : récupère tout (pagination interne)
//
// ✅ Optimisation perf : cache HTTP court (60s) pour éviter de re-puller 1500 items à chaque visite
// ✅ Ajout : inclut aussi les items "conferencePaper"

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
    const limit = qs.limit !== undefined ? Math.max(1, Math.min(500, parseInt(qs.limit, 10) || 100)) : null;

    // Mode "page"
    if (Number.isFinite(start) && Number.isFinite(limit)) {
      const { items, hasMore } = await fetchZoteroPage({
        apiKey,
        libraryType,
        libraryId,
        start,
        limit
      });

      const mapped = mapItems(items, libraryType, libraryId);

      return json(200, {
        mode: "page",
        start,
        limit,
        count: mapped.length,
        hasMore,
        items: mapped,
        fetchedAt: new Date().toISOString()
      });
    }

    // Mode "all"
    const all = await fetchAllZoteroItems({ apiKey, libraryType, libraryId });
    const mapped = mapItems(all, libraryType, libraryId);

    return json(200, {
      mode: "all",
      count: mapped.length,
      items: mapped,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    return json(500, { error: String(err && err.message ? err.message : err) });
  }
};

// ---------------- helpers ----------------

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    },
    body: JSON.stringify(body)
  };
}

async function fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit }) {
  const url = new URL(`https://api.zotero.org/${libraryType}/${libraryId}/items`);
  url.searchParams.set("format", "json");
  url.searchParams.set("include", "data");
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "dateModified");
  url.searchParams.set("direction", "desc");

  const r = await fetch(url.toString(), {
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3"
    }
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Zotero ${r.status}: ${text}`);
  }

  const items = JSON.parse(text);

  // Link header rel="next"
  const link = r.headers.get("Link") || "";
  const hasMore = link.includes('rel="next"');

  return { items, hasMore };
}

async function fetchAllZoteroItems({ apiKey, libraryType, libraryId }) {
  const MAX_ITEMS = 20000;
  const limit = 100;

  let start = 0;
  let out = [];
  let guard = 0;

  while (true) {
    guard++;
    if (guard > 500) break; // safety

    const { items, hasMore } = await fetchZoteroPage({
      apiKey,
      libraryType,
      libraryId,
      start,
      limit
    });

    if (!items || !items.length) break;

    out = out.concat(items);
    if (!hasMore) break;

    start += items.length;
    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}

function mapItems(zoteroWrappedItems, libraryType, libraryId) {
  return (zoteroWrappedItems || [])
    .map((z) => (z && z.data ? z.data : null))
    .filter(Boolean)
    // ✅ Ajout conferencePaper
    .filter(
      (d) =>
        d.itemType === "book" ||
        d.itemType === "bookSection" ||
        d.itemType === "journalArticle" ||
        d.itemType === "conferencePaper"
    )
    .map((d) => ({
      itemType: d.itemType || "",
      title: d.title || "",
      date: d.date || "",

      bookTitle: d.bookTitle || "",
      publicationTitle: d.publicationTitle || "",
      conferenceName: d.conferenceName || "",

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
      key: d.key || ""
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
    const m = line.match(/^\s*([^:]+)\s*:\s*(.*?)\s*$/);
    if (!m) return;
    const key = m[1].trim();
    const val = m[2].trim();
    if (!key) return;
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
