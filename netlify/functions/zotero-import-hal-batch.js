// netlify/functions/zotero-import-hal-batch.js
//
// Reçoit: { halIds: ["hal-xxxx", ...] }
// Pour chaque halId : récupère des métadonnées structurées via l'API HAL,
// filtre uniquement livres/chapitres/articles, mappe vers le "modèle" déjà utilisé
// par le projet (book / bookSection / journalArticle), puis crée les items dans Zotero
// en batch.
//
// Vars d'env attendues (déjà présentes dans ton projet):
// - ZOTERO_API_KEY
// - ZOTERO_LIBRARY_TYPE   (ex: "users" ou "groups")
// - ZOTERO_LIBRARY_ID

const HAL_SEARCH = "https://api.archives-ouvertes.fr/search/";
const ZOTERO_API = "https://api.zotero.org";

// Mapping docType HAL -> itemType Zotero autorisé
const HAL_TO_ZOTERO = {
  ART: "journalArticle",
  OUV: "book",
  COUV: "bookSection",
};

// Champs qu'on demande à HAL (best-effort : HAL varie selon les dépôts/types)
const HAL_FL = [
  "halId_s",
  "docid",
  "docType_s",

  // Titre / date
  "title_s",
  "title_t",
  "year_i",
  "producedDate_s",
  "publicationDate_s",

  // Auteurs
  "authFullName_s",
  "authLastName_s",
  "authFirstName_s",

  // Article
  "journalTitle_s",
  "volume_s",
  "issue_s",
  "page_s",

  // Livre / chapitre
  "publisher_s",
  "place_s",
  "bookTitle_s",
  "isbn_s",
  "series_s",
  "seriesNumber_s",
  "edition_s",

  // Identifiants
  "doiId_s",

  // Divers
  "abstract_s",
  "language_s",
].join(",");

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function asString(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(" ").trim();
  return String(v).trim();
}

function pickFirstNonEmpty(doc, keys) {
  for (const k of keys) {
    const v = doc?.[k];
    const s = asString(v);
    if (s) return s;
  }
  return "";
}

function normalizeDoi(raw) {
  return asString(raw)
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function parseCreatorsFromHAL(doc) {
  // Priorité: authLastName_s + authFirstName_s (si fournis)
  const ln = doc?.authLastName_s;
  const fn = doc?.authFirstName_s;

  if (Array.isArray(ln) && Array.isArray(fn) && ln.length) {
    const n = Math.min(ln.length, fn.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const lastName = asString(ln[i]);
      const firstName = asString(fn[i]);
      if (lastName || firstName) out.push({ firstName, lastName });
    }
    if (out.length) return out;
  }

  // Fallback: authFullName_s (souvent "NOM, Prénom" ou "Prénom NOM")
  const full = doc?.authFullName_s;
  const names = Array.isArray(full) ? full : (full ? [full] : []);
  const creators = [];

  for (const raw of names) {
    const s = asString(raw);
    if (!s) continue;

    if (s.includes(",")) {
      const [last, first] = s.split(",", 2);
      creators.push({ lastName: asString(last), firstName: asString(first) });
    } else {
      // Heuristique simple: dernier mot = nom, reste = prénom
      const parts = s.split(/\s+/).filter(Boolean);
      if (parts.length === 1) creators.push({ lastName: parts[0], firstName: "" });
      else creators.push({ lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(" ") });
    }
  }

  return creators;
}

function halDocToPayload(doc) {
  const docType = asString(doc?.docType_s);
  const zotItemType = HAL_TO_ZOTERO[docType];
  if (!zotItemType) return null;

  const halId = pickFirstNonEmpty(doc, ["halId_s"]);
  const title = pickFirstNonEmpty(doc, ["title_s", "title_t"]);
  const year = pickFirstNonEmpty(doc, ["year_i"]);
  const produced = pickFirstNonEmpty(doc, ["producedDate_s", "publicationDate_s"]);
  const date = year || (produced ? produced.slice(0, 10) : "");

  const authors = parseCreatorsFromHAL(doc);
  const publisher = pickFirstNonEmpty(doc, ["publisher_s"]);
  const place = pickFirstNonEmpty(doc, ["place_s"]);
  const pages = pickFirstNonEmpty(doc, ["page_s"]);
  const isbn = pickFirstNonEmpty(doc, ["isbn_s"]);
  const language = pickFirstNonEmpty(doc, ["language_s"]);
  const abstract = pickFirstNonEmpty(doc, ["abstract_s"]);
  const doi = normalizeDoi(pickFirstNonEmpty(doc, ["doiId_s"]));

  // Champs spécifiques
  const publication = pickFirstNonEmpty(doc, ["journalTitle_s"]);
  const articleVolume = pickFirstNonEmpty(doc, ["volume_s"]);
  const articleIssue = pickFirstNonEmpty(doc, ["issue_s"]);

  const bookTitle = pickFirstNonEmpty(doc, ["bookTitle_s"]);
  const series = pickFirstNonEmpty(doc, ["series_s"]);
  const seriesNumber = pickFirstNonEmpty(doc, ["seriesNumber_s"]);
  const edition = pickFirstNonEmpty(doc, ["edition_s"]);
  const volume = pickFirstNonEmpty(doc, ["volume_s"]); // peut aussi servir au livre

  // Extra: on conserve une trace HAL (utile pour retrouver / dédoublonner ensuite)
  const docid = pickFirstNonEmpty(doc, ["docid"]);
  const extraLines = [];
  if (halId) extraLines.push(`HAL: ${halId}`);
  if (docid) extraLines.push(`HAL_DOCID: ${docid}`);
  const extra = extraLines.join("\n");

  // On ne sort QUE les champs définis dans le projet (mêmes noms que la function existante)
  const payload = {
    pubType: zotItemType, // book | bookSection | journalArticle
    title,
    authors,
    date,

    publisher,
    place,
    pages,
    isbn,

    bookTitle,
    series,
    seriesNumber,
    volume,
    edition,

    publication,
    articleVolume,
    articleIssue,
    articlePages: pages, // pour un article, HAL met souvent "page_s"
    doi,

    abstract,
    language,
    extra,
  };

  // Validation minimale (cohérente avec votre schéma)
  if (!payload.title || !payload.authors?.length || !payload.date) return null;

  if (payload.pubType === "book") {
    if (!payload.publisher || !payload.place) return null;
  }
  if (payload.pubType === "bookSection") {
    if (!payload.bookTitle || !payload.publisher || !payload.place) return null;
  }
  if (payload.pubType === "journalArticle") {
    if (!payload.publication) return null;
  }

  return payload;
}

function payloadToZoteroItem(p) {
  const creators = (p.authors || []).map((a) => ({
    creatorType: "author",
    firstName: a.firstName || "",
    lastName: a.lastName || "",
  }));

  if (p.pubType === "book") {
    return {
      itemType: "book",
      title: p.title,
      creators,
      series: p.series || "",
      seriesNumber: p.seriesNumber || "",
      volume: p.volume || "",
      edition: p.edition || "",
      date: p.date || "",
      publisher: p.publisher || "",
      place: p.place || "",
      pages: p.pages || "",
      ISBN: p.isbn || "",
      abstractNote: p.abstract || "",
      language: p.language || "",
      extra: p.extra || "",
    };
  }

  if (p.pubType === "bookSection") {
    return {
      itemType: "bookSection",
      title: p.title,
      creators,
      bookTitle: p.bookTitle || "",
      series: p.series || "",
      seriesNumber: p.seriesNumber || "",
      volume: p.volume || "",
      edition: p.edition || "",
      date: p.date || "",
      publisher: p.publisher || "",
      place: p.place || "",
      pages: p.pages || "",
      ISBN: p.isbn || "",
      abstractNote: p.abstract || "",
      language: p.language || "",
      extra: p.extra || "",
    };
  }

  if (p.pubType === "journalArticle") {
    return {
      itemType: "journalArticle",
      title: p.title,
      creators,
      publicationTitle: p.publication || "",
      date: p.date || "",
      volume: p.articleVolume || "",
      issue: p.articleIssue || "",
      pages: p.articlePages || "",
      DOI: p.doi || "",
      publisher: p.publisher || "",
      place: p.place || "",
      abstractNote: p.abstract || "",
      language: p.language || "",
      extra: p.extra || "",
    };
  }

  return null;
}

async function fetchHALById(halId) {
  const q = `halId_s:${halId}`;
  const url =
    `${HAL_SEARCH}?q=${encodeURIComponent(q)}` +
    `&wt=json&rows=1&fl=${encodeURIComponent(HAL_FL)}`;

  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HAL ${halId}: HTTP ${r.status}`);
  const j = await r.json();
  const doc = j?.response?.docs?.[0] || null;
  return doc;
}

async function postZoteroItems(items) {
  const apiKey = process.env.ZOTERO_API_KEY;
  const libType = process.env.ZOTERO_LIBRARY_TYPE; // "users" ou "groups"
  const libId = process.env.ZOTERO_LIBRARY_ID;

  if (!apiKey || !libType || !libId) {
    throw new Error("Missing Zotero env vars (ZOTERO_API_KEY / ZOTERO_LIBRARY_TYPE / ZOTERO_LIBRARY_ID).");
  }

  const r = await fetch(`${ZOTERO_API}/${libType}/${libId}/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3",
    },
    body: JSON.stringify(items),
  });

  const text = await r.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* ignore */ }

  if (!r.ok) {
    const err = payload?.message || payload?.error || text || `HTTP ${r.status}`;
    throw new Error(`Zotero HTTP ${r.status}: ${err}`);
  }

  // Zotero renvoie souvent: { successful: {...}, unsuccessful: {...} }
  const successful = payload?.successful ? Object.keys(payload.successful).length : items.length;
  const unsuccessful = payload?.unsuccessful ? Object.keys(payload.unsuccessful).length : 0;

  return { successful, unsuccessful, raw: payload || text };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const halIds = Array.isArray(body.halIds) ? body.halIds.map(String).map((s) => s.trim()).filter(Boolean) : [];

    if (!halIds.length) {
      return jsonResponse(400, { error: "Missing 'halIds' array" });
    }

    const uniqueHalIds = [...new Set(halIds)];
    const errors = [];

    // 1) Fetch HAL + OUV/COUV/ART filter + map payload
    let fetched = 0;
    const payloads = [];

    for (const halId of uniqueHalIds) {
      try {
        const doc = await fetchHALById(halId);
        if (!doc) continue;
        fetched++;

        const payload = halDocToPayload(doc);
        if (!payload) continue; // non importable ou incomplet selon règles
        payloads.push(payload);
      } catch (e) {
        errors.push({ halId, step: "HAL", message: e.message || String(e) });
      }
    }

    // 2) Map to Zotero items
    const zoteroItems = payloads
      .map(payloadToZoteroItem)
      .filter(Boolean);

    // 3) Post to Zotero in batches of 25
    const BATCH = 25;
    let imported = 0;
    let zoteroFailures = 0;

    for (let i = 0; i < zoteroItems.length; i += BATCH) {
      const batch = zoteroItems.slice(i, i + BATCH);
      try {
        const res = await postZoteroItems(batch);
        imported += res.successful;
        zoteroFailures += res.unsuccessful;
      } catch (e) {
        // En cas d’échec batch : on log et continue (pour ne pas bloquer tout)
        errors.push({ batchStart: i, step: "Zotero", message: e.message || String(e) });
      }
    }

    const skipped = Math.max(0, uniqueHalIds.length - payloads.length);

    return jsonResponse(200, {
      requested: uniqueHalIds.length,
      fetched,
      importable: zoteroItems.length,
      imported,
      skipped,
      zoteroFailures,
      errors,
    });
  } catch (e) {
    return jsonResponse(500, { error: e.message || String(e) });
  }
};
