// netlify/functions/public-suivi.js
// JSON public depuis Zotero (sans exposer la clé API côté navigateur)
//
// - Mode "page" si start/limit sont fournis (plus rapide)
// - Mode "all" (par défaut) : rapatrie tout (jusqu’à MAX_ITEMS)
//
// ✅ Ajout : support des items Zotero "conferencePaper" (en plus de book/bookSection/journalArticle)

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
  const base = libraryType === "groups"
    ? `https://www.zotero.org/groups/${libraryId}/items/${key}`
    : `https://www.zotero.org/users/${libraryId}/items/${key}`;
  return base;
}

async function fetchZoteroPage({ apiKey, libraryType, libraryId, start = 0, limit = 100 }) {
  const url = new URL(`${API_BASE}/${libraryType}/${libraryId}/items`);
  url.searchParams.set("format", "json");
  url.searchParams.set("include", "data");
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", String(limit));
  // Tri (stable) : modifié le plus récemment d’abord
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

  // Pagination : Zotero expose "Link" header
  const link = r.headers.get("Link") || "";
  const hasMore = link.includes('rel="next"');

  return { items, hasMore };
}

async function fetchAllItems({ apiKey, libraryType, libraryId }) {
  const MAX_ITEMS = 10000;

  let start = 0;
  const limit = 100;
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
    // ✅ Ajout conferencePaper
    .filter((d) =>
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
      // ✅ utile pour conferencePaper
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
  const out = {};

  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2];
    out[k] = v;
  }

  return out;
}

exports.handler = async (event) => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // "users" ou "groups"
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return err("Configuration Zotero manquante (env vars).", 500);
    }

    const qs = event.queryStringParameters || {};
    const start = qs.start !== undefined ? parseInt(qs.start, 10) : null;
    const limit = qs.limit !== undefined ? parseInt(qs.limit, 10) : null;

    // Mode page
    if (Number.isFinite(start) && Number.isFinite(limit)) {
      const page = await fetchZoteroPage({ apiKey, libraryType, libraryId, start, limit });
      const items = mapItems(page.items, libraryType, libraryId);

      return json({
        mode: "page",
        start,
        limit,
        count: items.length,
        items,
        fetchedAt: new Date().toISOString(),
        hasMore: page.hasMore,
      });
    }

    // Mode all
    const raw = await fetchAllItems({ apiKey, libraryType, libraryId });
    const items = mapItems(raw, libraryType, libraryId);

    return json({
      mode: "all",
      count: items.length,
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return err(String(e?.message || e), 500);
  }
};
