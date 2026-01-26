// netlify/functions/zotero-create-item.js

exports.handler = async (event) => {
  try {
    const p = JSON.parse(event.body || "{}");

    const apiKey = process.env.ZOTERO_API_KEY;
    const libType = process.env.ZOTERO_LIBRARY_TYPE; // "users" ou "groups"
    const libId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libType || !libId) {
      return { statusCode: 500, body: "Configuration Zotero manquante (env vars)." };
    }

    if (!p || !p.pubType) {
      return { statusCode: 400, body: "Requête invalide (pubType manquant)." };
    }

    const creators = Array.isArray(p.authors)
      ? p.authors.map(a => ({
          creatorType: "author",
          firstName: a.firstName || "",
          lastName: a.lastName || ""
        }))
      : [];

    let item;

    if (p.pubType === "book") {
      item = {
        itemType: "book",
        title: p.title,
        creators,
        date: p.date,
        publisher: p.publisher,
        place: p.place,
        ISBN: p.isbn || "",
        abstractNote: p.abstract || "",
        language: p.language || "",
        extra: p.extra || ""
      };

    } else if (p.pubType === "bookSection") {
      item = {
        itemType: "bookSection",
        title: p.title,
        creators,
        bookTitle: p.bookTitle,
        series: p.series || "",
        seriesNumber: p.seriesNumber || "",
        volume: p.volume || "",
        edition: p.edition || "",
        date: p.date,
        publisher: p.publisher,
        place: p.place,
        pages: p.pages || "",
        ISBN: p.isbn || "",
        language: p.language || "",
        extra: p.extra || ""
      };

    } else if (p.pubType === "journalArticle") {
      item = {
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
        language: p.language || "",
        extra: p.extra || ""
      };

    } else if (p.pubType === "conferencePaper") {
      // ✅ Nouveau : Conference Paper
      item = {
        itemType: "conferencePaper",
        title: p.title,
        creators,
        conferenceName: p.conferenceName || "",
        publisher: p.publisher || "",
        place: p.place || "",
        date: p.date || "",
        language: p.language || "",
        extra: p.extra || ""
      };

    } else {
      return { statusCode: 400, body: "Type de publication inconnu." };
    }

    const r = await fetch(`https://api.zotero.org/${libType}/${libId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3"
      },
      body: JSON.stringify([item])
    });

    return { statusCode: r.status, body: await r.text() };
  } catch (e) {
    return { statusCode: 500, body: "Erreur serveur: " + String(e?.message || e) };
  }
};
