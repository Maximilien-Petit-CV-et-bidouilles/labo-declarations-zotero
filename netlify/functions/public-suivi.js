// netlify/functions/public-suivi.js
// Renvoie un JSON public à partir de Zotero (sans exposer la clé API côté navigateur)
//
// FIX IMPORTANT : Zotero limite "limit" à 100 -> pagination avec start=0,100,200...
// Sinon la page suivi plafonne à 100 items même si la bibliothèque en contient plus.

exports.handler = async () => {
  try {
    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: "Missing Zotero env vars" });
    }

    const limit = 100; // Zotero max
    let start = 0;
    const MAX_ITEMS = 10000; // sécurité large

    const all = [];

    while (true) {
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

      const txt = await res.text();
      if (!res.ok) {
        return json(res.status, { error: `Zotero error HTTP ${res.status}`, details: txt });
      }

      const items = JSON.parse(txt);
      if (!Array.isArray(items) || items.length === 0) break;

      all.push(...items);

      // dernière page
      if (items.length < limit) break;

      start += limit;
      if (all.length >= MAX_ITEMS) break;
    }

    // On renvoie au front un format compatible avec ton suivi.html
    // Ton suivi.html utilise: data.items[], data.fetchedAt
    const out = all
      .map((z) => z && z.data ? z.data : null)
      .filter(Boolean)
      .filter((d) => d.itemType === "book" || d.itemType === "bookSection" || d.itemType === "journalArticle")
      .map((d) => ({
        // champs attendus par ton suivi.html
        itemType: d.itemType || "",
        title: d.title || "",
        date: d.date || "",

        // champs optionnels utilisés dans la recherche/affichage
        bookTitle: d.bookTitle || "",
        publicationTitle: d.publicationTitle || "",
        publisher: d.publisher || "",
        place: d.place || "",
        isbn: d.ISBN || "",
        doi: d.DOI || "",
        volume: d.volume || "",
        issue: d.issue || "",
        pages: d.pages || "",

        // creators et flags (DLAB dans extra)
        creators: Array.isArray(d.creators) ? d.creators : [],
        flags: parseDLABFlags(d.extra || ""),

        // lien zotero (si tu l’utilises)
        zoteroUrl: buildZoteroUrl(libraryType, libraryId, d.key),
      }));

    return json(200, {
      fetchedAt: new Date().toISOString(),
      count: out.length,
      items: out,
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
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
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

    // normalisation yes/no
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
