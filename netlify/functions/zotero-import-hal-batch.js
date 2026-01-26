// netlify/functions/zotero-import-hal-batch.js
//
// Import CSV HAL (halId) -> HAL API -> Zotero batch
// FINAL: dédoublonnage HALID robuste + compatible gros volumes (chunking côté front)
//
// Dédoublonnage:
// - on taggue chaque item créé avec `HALID:<halId>`
// - avant import, on cherche dans Zotero les items qui ont ces tags (requête unique par paquet)
//
// Optimisations:
// - HAL fetch en parallèle (concurrency limitée)
// - Zotero POST par batch de 25
//
// Vars d'env attendues :
// - ZOTERO_API_KEY
// - ZOTERO_LIBRARY_TYPE   ("users" ou "groups")
// - ZOTERO_LIBRARY_ID

const HAL_SEARCH = "https://api.archives-ouvertes.fr/search/";
const ZOTERO_API = "https://api.zotero.org";

const HAL_TO_ZOTERO = {
  ART: "journalArticle",
  OUV: "book",
  COUV: "bookSection",
};

// Champs HAL (best-effort, HAL varie selon les dépôts)
const HAL_FL = [
  "halId_s",
  "docid",
  "docType_s",

  "title_s",
  "title_t",

  "year_i",
  "producedDate_s",
  "publicationDate_s",

  "authFullName_s",
  "authLastName_s",
  "authFirstName_s",

  // Article
  "journalTitle_s",
  "journalTitle_t",
  "volume_s",
  "issue_s",
  "page_s",

  // Livre / chapitre
  "publisher_s",
  "publisher_t",
  "place_s",
  "city_s",
  "bookTitle_s",
  "bookTitle_t",
  "isbn_s",
  "series_s",
  "series_t",
  "seriesNumber_s",
  "edition_s",

  // Identifiants
  "doiId_s",

  // Divers
  "abstract_s",
  "abstract_t",
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
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean).join(" ").trim();
  return String(v).trim();
}

function pickFirstNonEmpty(doc, keys) {
  for (const k of keys) {
    const s = asString(doc?.[k]);
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
      const parts = s.split(/\s+/).filter(Boolean);
      if (parts.length === 1) creators.push({ lastName: parts[0], firstName: "" });
      else creators.push({ lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(" ") });
    }
  }

  return creators;
}

function halDocToPayload(doc) {
  const docType = asString(doc?.docType_s);
  const pubType = HAL_TO_ZOTERO[docType];
  if (!pubType) return { ok: false, reason: `docType non importable: ${docType}` };

  const halId = pickFirstNonEmpty(doc, ["halId_s"]);
  const docid = pickFirstNonEmpty(doc, ["docid"]);

  const title = pickFirstNonEmpty(doc, ["title_s", "title_t"]);
  const year = pickFirstNonEmpty(doc, ["year_i"]);
  const produced = pickFirstNonEmpty(doc, ["producedDate_s", "publicationDate_s"]);
  const date = year || (produced ? produced.slice(0, 10) : "");

  const authors = parseCreatorsFromHAL(doc);

  const publisher = pickFirstNonEmpty(doc, ["publisher_s", "publisher_t"]);
  const place = pickFirstNonEmpty(doc, ["place_s", "city_s"]);
  const pages = pickFirstNonEmpty(doc, ["page_s"]);
  const isbn = pickFirstNonEmpty(doc, ["isbn_s"]);
  const language = pickFirstNonEmpty(doc, ["language_s"]);
  const abstract = pickFirstNonEmpty(doc, ["abstract_s", "abstract_t"]);
  const doi = normalizeDoi(pickFirstNonEmpty(doc, ["doiId_s"]));

  const publication = pickFirstNonEmpty(doc, ["journalTitle_s", "journalTitle_t"]);
  const articleVolume = pickFirstNonEmpty(doc, ["volume_s"]);
  const articleIssue = pickFirstNonEmpty(doc, ["issue_s"]);

  const bookTitle = pickFirstNonEmpty(doc, ["bookTitle_s", "bookTitle_t"]);
  const series = pickFirstNonEmpty(doc, ["series_s", "series_t"]);
  const seriesNumber = pickFirstNonEmpty(doc, ["seriesNumber_s"]);
  const edition = pickFirstNonEmpty(doc, ["edition_s"]);
  const volume = pickFirstNonEmpty(doc, ["volume_s"]);

  const extraLines = [];
  if (halId) extraLines.push(`HAL: ${halId}`);
  if (docid) extraLines.push(`HAL_DOCID: ${docid}`);
  const extra = extraLines.join("\n");

  const payload = {
    halId,
    pubType,
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
    articlePages: pages,
    doi,

    abstract,
    language,
    extra,
  };

  // validation minimale
  if (!payload.halId) return { ok: false, reason: "halId manquant" };
  if (!payload.title) return { ok: false, reason: "titre manquant" };
  if (!payload.date) return { ok: false, reason: "date manquante" };
  if (!payload.authors || payload.authors.length === 0) return { ok: false, reason: "auteurs manquants" };

  return { ok: true, payload };
}

function payloadToZoteroItem(p) {
  const creators = (p.authors || []).map((a) => ({
    creatorType: "author",
    firstName: a.firstName || "",
    lastName: a.lastName || "",
  }));

  const tags = [{ tag: `HALID:${p.halId}` }];

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
      tags,
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
      tags,
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
      tags,
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
  return j?.response?.docs?.[0] || null;
}

function zoteroEnv() {
  const apiKey = process.env.ZOTERO_API_KEY;
  const libType = process.env.ZOTERO_LIBRARY_TYPE; // "users" ou "groups"
  const libId = process.env.ZOTERO_LIBRARY_ID;

  if (!apiKey || !libType || !libId) {
    throw new Error("Missing Zotero env vars (ZOTERO_API_KEY / ZOTERO_LIBRARY_TYPE / ZOTERO_LIBRARY_ID).");
  }
  return { apiKey, libType, libId };
}

// Concurrency helper
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ✅ Dédoublonnage: requête unique Zotero pour le paquet
// Stratégie: qmode=everything avec requête OR sur "tag:HALID:xxx"
// Ex: tag:"HALID:hal-xxx" OR tag:"HALID:hal-yyy"
async function fetchExistingHalIdsForChunk(halIds) {
  const { apiKey, libType, libId } = zoteroEnv();

  // Protéger la longueur d'URL: cette méthode est prévue pour un chunk (40–60)
  // On quote pour les tags avec caractères spéciaux.
  const clauses = halIds.map((id) => `tag:"HALID:${id}"`);
  const q = clauses.join(" OR ");

  const url =
    `${ZOTERO_API}/${libType}/${libId}/items?` +
    `q=${encodeURIComponent(q)}&qmode=everything&limit=100`;

  const r = await fetch(url, {
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3",
      Accept: "application/json",
    },
  });

  if (!r.ok) {
    throw new Error(`Zotero chunk-dedupe lookup failed (HTTP ${r.status})`);
  }

  const items = await r.json();
  const existing = new Set();

  if (Array.isArray(items)) {
    for (const it of items) {
      const tags = it?.data?.tags || [];
      for (const t of tags) {
        const tag = (t?.tag || "").trim();
        if (tag.startsWith("HALID:")) {
          const halId = tag.slice("HALID:".length).trim();
          if (halId) existing.add(halId);
        }
      }
    }
  }

  return existing;
}

async function postZoteroItems(items) {
  const { apiKey, libType, libId } = zoteroEnv();

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

  const successful = payload?.successful ? Object.keys(payload.successful).length : items.length;
  const unsuccessful = payload?.unsuccessful ? Object.keys(payload.unsuccessful).length : 0;
  return { successful, unsuccessful };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const halIds = Array.isArray(body.halIds)
      ? body.halIds.map(String).map((s) => s.trim()).filter(Boolean)
      : [];

    if (!halIds.length) return jsonResponse(400, { error: "Missing 'halIds' array" });

    const uniqueHalIds = [...new Set(halIds)];
    const errors = [];
    const skipped = [];

    // ✅ 1) Dédoublonnage du paquet en 1 requête Zotero
    let existing = new Set();
    try {
      existing = await fetchExistingHalIdsForChunk(uniqueHalIds);
    } catch (e) {
      // On n'empêche pas l'import si la recherche échoue, mais on log.
      errors.push({ step: "ZoteroChunkDedupe", message: e.message || String(e) });
      existing = new Set();
    }

    const skippedDuplicatesHalIds = [];
    let skippedDuplicates = 0;

    const toProcess = [];
    for (const halId of uniqueHalIds) {
      if (existing.has(halId)) {
        skippedDuplicates++;
        skippedDuplicatesHalIds.push(halId);
        skipped.push({ halId, reason: "doublon (HALID déjà présent dans Zotero)" });
      } else {
        toProcess.push(halId);
      }
    }

    // ✅ 2) Fetch HAL en parallèle (concurrency)
    const CONCURRENCY = 8; // 6–10 recommandé
    const results = await mapWithConcurrency(toProcess, CONCURRENCY, async (halId) => {
      try {
        const doc = await fetchHALById(halId);
        if (!doc) return { type: "skip", halId, reason: "introuvable via API HAL" };

        const res = halDocToPayload(doc);
        if (!res.ok) return { type: "skip", halId, reason: res.reason };

        return { type: "ok", payload: res.payload };
      } catch (e) {
        return { type: "err", halId, step: "HAL", message: e.message || String(e) };
      }
    });

    let fetched = 0;
    const payloads = [];

    for (const r of results) {
      if (!r) continue;
      if (r.type === "ok") {
        payloads.push(r.payload);
        fetched++;
      } else if (r.type === "skip") {
        skipped.push({ halId: r.halId, reason: r.reason });
      } else if (r.type === "err") {
        errors.push({ halId: r.halId, step: r.step, message: r.message });
      }
    }

    // ✅ 3) Map to Zotero items
    const zoteroItems = payloads.map(payloadToZoteroItem).filter(Boolean);

    // ✅ 4) Post to Zotero in batches of 25
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
        errors.push({ batchStart: i, step: "Zotero", message: e.message || String(e) });
      }
    }

    return jsonResponse(200, {
      requested: uniqueHalIds.length,
      // fetched = nombre de payloads OK (HAL trouvés + mappables)
      fetched,
      importable: zoteroItems.length,
      imported,
      zoteroFailures,
      skippedCount: skipped.length,
      skippedDuplicates,
      skippedDuplicatesHalIds,
      skipped,
      errors,
      note:
        "Final: dédoublonnage HALID via requête Zotero unique par paquet + HAL fetch parallèle. Utiliser chunking côté front (40–60).",
    });
  } catch (e) {
    return jsonResponse(500, { error: e.message || String(e) });
  }
};
