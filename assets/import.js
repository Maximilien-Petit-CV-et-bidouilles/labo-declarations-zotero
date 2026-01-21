// assets/import.js
// Page: import.html
// Objectif : importer un CSV HAL (colonnes halId_s + docType_s) -> Netlify Function -> Zotero

(function () {
  const $ = (id) => document.getElementById(id);

  const fileInput = $("csvFile");
  const btnImport = $("btnImport");
  const btnReset = $("btnReset");
  const statusBox = $("statusBox");

  const kpiTotal = $("kpiTotal");
  const kpiUsable = $("kpiUsable");
  const kpiImportable = $("kpiImportable");
  const dotTotal = $("dotTotal");

  const previewBody = $("previewBody");

  // Données en mémoire
  let rowsAll = [];
  let rowsUsable = [];
  let rowsImportable = []; // seulement ART/OUV/COUV
  let busy = false;

  // Mapping docType HAL -> importable ?
  // On filtre au plus tôt côté front pour éviter des appels HAL inutiles.
  const HAL_IMPORTABLE = new Set(["ART", "OUV", "COUV"]);

  function setBusy(v) {
    busy = v;
    btnImport.disabled = v || rowsImportable.length === 0;
    fileInput.disabled = v;
  }

  function setStatus(message, kind = "info") {
    statusBox.style.display = "block";
    statusBox.className = `status ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.style.display = "none";
    statusBox.textContent = "";
    statusBox.className = "status info";
  }

  function resetUI() {
    rowsAll = [];
    rowsUsable = [];
    rowsImportable = [];
    kpiTotal.textContent = "0";
    kpiUsable.textContent = "0";
    kpiImportable.textContent = "0";
    dotTotal.className = "dot";
    previewBody.innerHTML = `
      <tr><td colspan="3" class="small">Aucun fichier chargé.</td></tr>
    `;
    btnImport.disabled = true;
    fileInput.value = "";
    clearStatus();
  }

  function normalize(s) {
    return String(s ?? "").trim();
  }

  function unique(arr) {
    return [...new Set(arr)];
  }

  function renderPreview() {
    const max = 50;
    const slice = rowsUsable.slice(0, max);

    if (!slice.length) {
      previewBody.innerHTML = `<tr><td colspan="3" class="small">Aucune ligne exploitable (halId_s manquant ?).</td></tr>`;
      return;
    }

    previewBody.innerHTML = slice
      .map((r) => {
        const docType = r.docType_s || "";
        const halId = r.halId_s || "";
        const importable = HAL_IMPORTABLE.has(docType);
        const status = importable ? "importable" : "ignoré";
        return `
          <tr>
            <td class="mono">${escapeHtml(docType)}</td>
            <td class="mono">${escapeHtml(halId)}</td>
            <td>${importable ? "✅ Importable" : "— Ignoré"}</td>
          </tr>
        `;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function computeKpis() {
    kpiTotal.textContent = String(rowsAll.length);
    kpiUsable.textContent = String(rowsUsable.length);
    kpiImportable.textContent = String(rowsImportable.length);

    dotTotal.className = "dot" + (rowsAll.length ? " ok" : "");
    btnImport.disabled = rowsImportable.length === 0 || busy;
  }

  async function parseCsvFile(file) {
    clearStatus();
    setBusy(true);
    setStatus("Lecture du CSV…", "info");

    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          try {
            const data = Array.isArray(res.data) ? res.data : [];
            rowsAll = data;

            // Exploitables si halId_s présent
            rowsUsable = data
              .map((r) => ({
                halId_s: normalize(r.halId_s),
                docType_s: normalize(r.docType_s),
              }))
              .filter((r) => r.halId_s);

            // Importables si docType dans {ART, OUV, COUV}
            rowsImportable = rowsUsable.filter((r) => HAL_IMPORTABLE.has(r.docType_s));

            computeKpis();
            renderPreview();

            if (!rowsAll.length) {
              setStatus("Le CSV semble vide.", "warn");
            } else if (!rowsUsable.length) {
              setStatus("Aucune ligne exploitable : la colonne halId_s est absente ou vide.", "bad");
            } else if (!rowsImportable.length) {
              setStatus(
                "Aucune ligne importable (types attendus : ART, OUV, COUV). Les autres types HAL sont ignorés.",
                "warn"
              );
            } else {
              const uniqueIds = unique(rowsImportable.map((r) => r.halId_s));
              const msg =
                `CSV chargé.\n` +
                `- Lignes totales : ${rowsAll.length}\n` +
                `- Exploitables (halId_s) : ${rowsUsable.length}\n` +
                `- Importables (ART/OUV/COUV) : ${rowsImportable.length}\n` +
                `- halId uniques à importer : ${uniqueIds.length}\n\n` +
                `Clique sur “Importer dans Zotero”.`;
              setStatus(msg, "ok");
            }

            resolve(true);
          } catch (e) {
            reject(e);
          } finally {
            setBusy(false);
          }
        },
        error: (err) => {
          setBusy(false);
          reject(err);
        },
      });
    });
  }

  async function doImport() {
    if (busy) return;
    if (!rowsImportable.length) {
      setStatus("Rien à importer.", "warn");
      return;
    }

    const halIds = unique(rowsImportable.map((r) => r.halId_s));

    setBusy(true);
    setStatus(
      `Import en cours…\n- ${halIds.length} halId uniques envoyés\n\nNe ferme pas l’onglet.`,
      "info"
    );

    try {
      const r = await fetch("/.netlify/functions/zotero-import-hal-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halIds }),
      });

      const text = await r.text();
      let payload;
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

      if (!r.ok) {
        const msg =
          `Erreur serveur (${r.status}).\n` +
          (payload?.error ? `\n${payload.error}` : "") +
          (payload?.raw ? `\n\n${payload.raw}` : "");
        setStatus(msg, "bad");
        return;
      }

      // payload attendu : { requested, fetched, importable, imported, skipped, errors }
      const msg =
        `Import terminé ✅\n\n` +
        `Demandés : ${payload.requested ?? halIds.length}\n` +
        `Trouvés HAL : ${payload.fetched ?? "?"}\n` +
        `Importables (book/bookSection/journalArticle) : ${payload.importable ?? "?"}\n` +
        `Créés Zotero : ${payload.imported ?? "?"}\n` +
        `Ignorés (doublons ou non importables) : ${payload.skipped ?? 0}\n` +
        (payload.errors?.length ? `\nErreurs : ${payload.errors.length} (voir détails dans la réponse serveur)` : "");

      setStatus(msg, payload.errors?.length ? "warn" : "ok");
    } catch (e) {
      setStatus(`Erreur réseau : ${e.message || e}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  // Events
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      await parseCsvFile(f);
    } catch (e) {
      setStatus(`Impossible de lire le CSV : ${e.message || e}`, "bad");
      setBusy(false);
    }
  });

  btnImport.addEventListener("click", doImport);
  btnReset.addEventListener("click", resetUI);

  // Init
  resetUI();
})();
