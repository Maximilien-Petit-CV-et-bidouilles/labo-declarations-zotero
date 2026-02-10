// assets/import.js
// Page: import.html
// CSV HAL -> envoi en paquets à la Netlify Function pour éviter les timeouts

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

  let rowsAll = [];
  let rowsUsable = [];
  let rowsImportable = [];
  let busy = false;

  const HAL_IMPORTABLE = new Set(["ART", "OUV", "COUV"]);

  // ✅ IMPORTANT : taille des paquets pour éviter les 504
 const CHUNK_SIZE = 10;
const PAUSE_MS = 400;


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
    previewBody.innerHTML = `<tr><td colspan="3" class="small">Aucun fichier chargé.</td></tr>`;
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

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function renderPreview() {
    const max = 50;
    const slice = rowsUsable.slice(0, max);

    if (!slice.length) {
      previewBody.innerHTML = `<tr><td colspan="3" class="small">Aucune ligne exploitable (halId_s manquant ?).</td></tr>`;
      return;
    }

    previewBody.innerHTML = slice.map((r) => {
      const docType = r.docType_s || "";
      const halId = r.halId_s || "";
      const importable = HAL_IMPORTABLE.has(docType);
      return `
        <tr>
          <td class="mono">${escapeHtml(docType)}</td>
          <td class="mono">${escapeHtml(halId)}</td>
          <td>${importable ? "✅ Importable" : "— Ignoré"}</td>
        </tr>
      `;
    }).join("");
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

            rowsUsable = data.map((r) => ({
              halId_s: normalize(r.halId_s),
              docType_s: normalize(r.docType_s),
            })).filter((r) => r.halId_s);

            rowsImportable = rowsUsable.filter((r) => HAL_IMPORTABLE.has(r.docType_s));

            computeKpis();
            renderPreview();

            if (!rowsAll.length) {
              setStatus("Le CSV semble vide.", "warn");
            } else if (!rowsUsable.length) {
              setStatus("Aucune ligne exploitable : la colonne halId_s est absente ou vide.", "bad");
            } else if (!rowsImportable.length) {
              setStatus("Aucune ligne importable (types attendus : ART, OUV, COUV).", "warn");
            } else {
              const uniqueIds = unique(rowsImportable.map((r) => r.halId_s));
              setStatus(
                `CSV chargé ✅\n` +
                `- Total : ${rowsAll.length}\n` +
                `- Exploitables : ${rowsUsable.length}\n` +
                `- Importables (ART/OUV/COUV) : ${rowsImportable.length}\n` +
                `- halId uniques : ${uniqueIds.length}\n\n` +
                `L’import sera envoyé par paquets de ${CHUNK_SIZE} pour éviter les timeouts.`,
                "ok"
              );
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

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function doImport() {
    if (busy) return;
    if (!rowsImportable.length) {
      setStatus("Rien à importer.", "warn");
      return;
    }

    const halIds = unique(rowsImportable.map((r) => r.halId_s));
    const chunks = chunkArray(halIds, CHUNK_SIZE);

    setBusy(true);

    let agg = {
      requested: halIds.length,
      fetched: 0,
      importable: 0,
      imported: 0,
      skippedCount: 0,
      skippedDuplicates: 0,
      zoteroFailures: 0,
      errors: 0,
    };

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        setStatus(
          `Import en cours…\n` +
          `Paquet ${i + 1}/${chunks.length}\n` +
          `- IDs dans ce paquet : ${chunk.length}\n` +
          `- Progression : ${Math.min(((i) * CHUNK_SIZE), halIds.length)}/${halIds.length}\n\n` +
          `Cumul : importés=${agg.imported} | doublons=${agg.skippedDuplicates} | ignorés=${agg.skippedCount} | erreurs=${agg.errors}`,
          "info"
        );

        const r = await fetch("/.netlify/functions/zotero-import-hal-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ halIds: chunk }),
        });

        const text = await r.text();
        let payload;
        try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

        if (!r.ok) {
          // on stoppe au premier paquet en erreur (plus clair), avec contexte
          setStatus(
            `Erreur serveur sur le paquet ${i + 1}/${chunks.length} (HTTP ${r.status}).\n\n` +
            (payload?.error || payload?.raw || "Erreur inconnue"),
            "bad"
          );
          return;
        }

        agg.fetched += payload.fetched || 0;
        agg.importable += payload.importable || 0;
        agg.imported += payload.imported || 0;
        agg.skippedCount += payload.skippedCount || 0;
        agg.skippedDuplicates += payload.skippedDuplicates || 0;
        agg.zoteroFailures += payload.zoteroFailures || 0;
        agg.errors += (payload.errors && payload.errors.length) ? payload.errors.length : 0;

        // petite pause pour éviter surcharge/ratelimit
        await sleep(PAUSE_MS);
      }

      setStatus(
        `Import terminé ✅\n\n` +
        `Demandés : ${agg.requested}\n` +
        `Trouvés HAL : ${agg.fetched}\n` +
        `Importables : ${agg.importable}\n` +
        `Créés Zotero : ${agg.imported}\n` +
        `Doublons : ${agg.skippedDuplicates}\n` +
        `Ignorés : ${agg.skippedCount}\n` +
        `Échecs Zotero : ${agg.zoteroFailures}\n` +
        `Erreurs : ${agg.errors}\n`,
        (agg.errors || agg.zoteroFailures) ? "warn" : "ok"
      );

    } catch (e) {
      setStatus(`Erreur réseau : ${e.message || e}`, "bad");
    } finally {
      setBusy(false);
    }
  }

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

  resetUI();
})();
