// netlify/functions/admin-items.js
// Admin: récupère TOUS les items Zotero (pagination côté serveur)
//
// ✅ Ajout : inclure aussi "conferencePaper" (en plus de book/bookSection/journalArticle)

const API_BASE = "https://api.zotero.org";

exports.handler = async () => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: "Missing Zotero env vars" });
    }

    const all = await fetchAllZoteroItems({ apiKey, libraryType, libraryId });
    const items = mapItems(all, libraryType, libraryId);

    return json(200, {
      count: items.length,
      items,
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
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

async function fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit }) {
  const url = new URL(`${API_BASE}/${libraryType}/${libraryId}/items`);
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
      key: d.key || "",
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
      extra: d.extra || "",
      flags: parseDLABFlags(d.extra || ""),

      zoteroUrl: buildZoteroUrl(libraryType, libraryId, d.key)
    }));
}

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
