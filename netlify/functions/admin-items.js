// netlify/functions/admin-items.js
// API admin : liste complète des items depuis Zotero (pour admin.html)
//
// ✅ Ajout : inclure aussi les "conferencePaper" (en plus de book/bookSection/journalArticle)
// ✅ Récupération paginée côté serveur pour dépasser la limite des 100 items Zotero
//
// Réponse:
// { count, items, fetchedAt }

const API_BASE = "https://api.zotero.org";

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function err(message, statusCode = 500) {
  return json({ error: message }, statusCode);
}

function buildZoteroUrl(libraryType, libraryId, key) {
  if (!key) return "";
  return (libraryType === "groups")
    ? `https://www.zotero.org/groups/${libraryId}/items/${key}`
    : `https://www.zotero.org/users/${libraryId}/items/${key}`;
}

function parseDLABFlags(extra) {
  const s = String(extra || "");
  const start = s.indexOf("[DLAB]");
  const end = s.indexOf("[/DLAB]");
  if (start === -1 || end === -1 || end <= start) return {};

  const block = s.slice(start + 6, end).trim();
  const out = {};

  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

async function fetchZoteroPage({ apiKey, libraryType, libraryId, start = 0, limit = 100 }) {
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
      "Zotero-API-Version": "3",
    },
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

async function fetchAllItems({ apiKey, libraryType, libraryId }) {
  const MAX_ITEMS = 20000; // marge pour les années à venir
  const limit = 100;

  let start = 0;
  let all = [];

  while (true) {
    const { items, hasMore } = await fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit });
    if (!items.length) break;

    all = all.concat(items);

    if (!hasMore) break;

    start += items.length;
    if (all.length >= MAX_ITEMS) break;
  }

  return all;
}

function mapItems(zoteroWrappedItems, libraryType, libraryId) {
  return (zoteroWrappedItems || [])
    .map((z) => (z && z.data) ? z.data : null)
    .filter(Boolean)
    // ✅ Ajout conferencePaper
    .filter((d) =>
      d.itemType === "book" ||
      d.itemType === "bookSection" ||
      d.itemType === "journalArticle" ||
      d.itemType === "conferencePaper"
    )
    .map((d) => ({
      key: d.key,
      itemType: d.itemType || "",
      title: d.title || "",
      date: d.date || "",

      // contexte
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

      zoteroUrl: buildZoteroUrl(libraryType, libraryId, d.key),
    }));
}

exports.handler = async () => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // "users" ou "groups"
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return err("Configuration Zotero manquante (env vars).", 500);
    }

    const raw = await fetchAllItems({ apiKey, libraryType, libraryId });
    const items = mapItems(raw, libraryType, libraryId);

    return json({
      count: items.length,
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return err(String(e?.message || e), 500);
  }
};
