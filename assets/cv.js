/* ==========================================================
   assets/cv.js (SAFE)
   - N'écrase aucun autre fichier / aucune UI globale
   - Ajoute conferencePaper dans le CV
   - Ne charge les pubs que si "Nom Prénom" est saisi
   - Export PDF via html2pdf (comme avant)
   - Export DOCX via docx + FileSaver (comme avant)
   ========================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---- éléments attendus dans cv.html (ta version existante)
  const elAuthor = $('authorFilter');
  const elYearMin = $('yearMin');
  const elYearMax = $('yearMax');
  const elOnlyPubs = $('onlyPublications');
  const elSort = $('sortMode');

  const btnRefresh = $('refreshBtn');
  const btnExportHtml = $('exportHtmlBtn');
  const btnExportPdf = $('exportPdfBtn');
  const btnExportDocx = $('exportDocxBtn');

  const elStatus = $('cv-status');
  const elPubList = $('pubList');
  const elPubCount = $('pubCount');
  const elCvRoot = $('cvRoot'); // conteneur à exporter

  // si tu as un meta affichage (et qu'on ne veut PAS en export)
  const elMeta = $('cvMeta');

  const FILTER_KEY = 'dlab.cv.filters.v4';
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;

  function setStatus(msg, ok = true) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function stripDiacritics(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function norm(s) {
    return stripDiacritics(String(s || ''))
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function hasFullNameQuery(q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    return tokens.length >= 2 && tokens.every(t => t.length >= 2);
  }
  function extractYear(dateStr) {
    const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  }
  function creatorsToText(creators) {
    if (!Array.isArray(creators)) return '';
    const names = creators
      .filter(c => c && (c.creatorType === 'author' || c.creatorType === 'editor' || c.creatorType === 'presenter'))
      .map(c => {
        const fn = String(c.firstName || '').trim();
        const ln = String(c.lastName || '').trim();
        return (ln && fn) ? (ln + ' ' + fn) : (ln || fn);
      })
      .filter(Boolean);
    return names.join(', ');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeFilenameBase(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return base || 'cv';
  }
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------- Persist filters
  function loadFilters() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return;
      if (elAuthor && typeof obj.author === 'string') elAuthor.value = obj.author;
      if (elYearMin && typeof obj.yearMin === 'string') elYearMin.value = obj.yearMin;
      if (elYearMax && typeof obj.yearMax === 'string') elYearMax.value = obj.yearMax;
      if (elOnlyPubs && typeof obj.onlyPubs === 'string') elOnlyPubs.value = obj.onlyPubs;
      if (elSort && typeof obj.sort === 'string') elSort.value = obj.sort;
    } catch {}
  }
  function saveFilters() {
    try {
      const obj = {
        author: elAuthor?.value || '',
        yearMin: elYearMin?.value || '',
        yearMax: elYearMax?.value || '',
        onlyPubs: elOnlyPubs?.value || 'yes',
        sort: elSort?.value || 'date_desc'
      };
      localStorage.setItem(FILTER_KEY, JSON.stringify(obj));
    } catch {}
  }

  // ---------------- Fetch pubs paginées via public-suivi (déjà en prod)
  async function fetchAllPublicationsPaged() {
    // si ton public-suivi ne supporte pas start/limit, ça marche quand même avec sans params
    const PAGE_SIZE = 200;
    let start = 0;
    const out = [];

    for (let guard = 0; guard < 200; guard++) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${PAGE_SIZE}`;
      const r = await fetch(url, { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Erreur serveur (${r.status})`);
      const items = Array.isArray(data.items) ? data.items : [];
      out.push(...items);

      // si hasMore absent → on s'arrête après 1 page
      if (!data.hasMore) break;
      if (items.length === 0) break;

      start += items.length;
    }
    return out;
  }

  async function getPublications() {
    if (PUBS_CACHE && Array.isArray(PUBS_CACHE)) return PUBS_CACHE;
    setStatus('Chargement des publications…', true);
    const items = await fetchAllPublicationsPaged();
    PUBS_CACHE = (items || []).map(it => ({
      ...it,
      creatorsText: it.creatorsText || creatorsToText(it.creators || [])
    }));
    PUBS_FETCHED_AT = new Date();
    return PUBS_CACHE;
  }

  function isPublicationType(itemType) {
    return itemType === 'book'
      || itemType === 'bookSection'
      || itemType === 'journalArticle'
      || itemType === 'conferencePaper';
  }

  function isAuthorMatch(creatorsText, authorQuery) {
    const q = norm(authorQuery);
    if (!q) return true;
    const hay = norm(creatorsText);
    if (!hay) return false;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(t => hay.includes(t));
  }

  function compareItems(a, b, mode) {
    const ya = extractYear(a.date) || 0;
    const yb = extractYear(b.date) || 0;
    if (mode === 'date_asc') return ya - yb;
    if (mode === 'title_asc') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' });
    }
    return yb - ya;
  }

  function applyFilters(items) {
    const author = elAuthor?.value || '';
    const yMin = parseInt(elYearMin?.value, 10);
    const yMax = parseInt(elYearMax?.value, 10);
    const hasMin = Number.isFinite(yMin);
    const hasMax = Number.isFinite(yMax);
    const onlyPubs = (elOnlyPubs?.value || 'yes') === 'yes';
    const sort = elSort?.value || 'date_desc';

    return (items || [])
      .filter(it => it && typeof it === 'object')
      .filter(it => !onlyPubs || isPublicationType(it.itemType))
      .filter(it => isAuthorMatch(it.creatorsText || '', author))
      .filter(it => {
        const y = extractYear(it.date);
        if (hasMin && (y === null || y < yMin)) return false;
        if (hasMax && (y === null || y > yMax)) return false;
        return true;
      })
      .sort((a, b) => compareItems(a, b, sort));
  }

  // ---------------- Formatting (HTML list)
  function formatOne(item) {
    const authors = String(item.creatorsText || '').trim();
    const year = extractYear(item.date);
    const title = String(item.title || '').trim();
    const it = item.itemType;

    const parts = [];
    if (authors) parts.push(escapeHtml(authors) + (year ? ' (' + year + ').' : '.'));
    else if (year) parts.push('(' + year + ').');

    if (title) parts.push('<span class="t">' + escapeHtml(title) + '</span>.');

    if (it === 'journalArticle') {
      const j = String(item.publicationTitle || '').trim();
      const vol = String(item.volume || '').trim();
      const issue = String(item.issue || '').trim();
      const pages = String(item.pages || '').trim();
      const doi = String(item.doi || '').trim();

      const tail = [];
      if (j) tail.push('<i>' + escapeHtml(j) + '</i>');
      if (vol) tail.push('vol. ' + escapeHtml(vol));
      if (issue) tail.push('n° ' + escapeHtml(issue));
      if (pages) tail.push('pp. ' + escapeHtml(pages));
      if (doi) tail.push('DOI: ' + escapeHtml(doi));
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'book') {
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const isbn = String(item.isbn || '').trim();
      const tail = [];
      if (place) tail.push(escapeHtml(place));
      if (publisher) tail.push(escapeHtml(publisher));
      if (isbn) tail.push('ISBN: ' + escapeHtml(isbn));
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'bookSection') {
      const bookTitle = String(item.bookTitle || '').trim();
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pages = String(item.pages || '').trim();
      const isbn = String(item.isbn || '').trim();

      const tail = [];
      if (bookTitle) tail.push('Dans : <i>' + escapeHtml(bookTitle) + '</i>');
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push('pp. ' + escapeHtml(pages));
      if (isbn) tail.push('ISBN: ' + escapeHtml(isbn));
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'conferencePaper') {
      const conf = String(item.conferenceName || '').trim();
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pages = String(item.pages || '').trim();

      const tail = [];
      if (conf) tail.push('<i>' + escapeHtml(conf) + '</i>');
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push('pp. ' + escapeHtml(pages));
      if (tail.length) parts.push(tail.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function renderList(items) {
    const arr = Array.isArray(items) ? items : [];
    if (elPubList) elPubList.innerHTML = arr.map(it => `<li>${formatOne(it)}</li>`).join('');
    if (elPubCount) {
      const n = arr.length;
      elPubCount.textContent = n + (n <= 1 ? ' référence' : ' références');
    }
  }

  // ---------------- Export helpers (ne pas exporter cvMeta)
  function getExportNodeClone() {
    if (!elCvRoot) return null;
    const clone = elCvRoot.cloneNode(true);

    // supprime les contrôles / boutons dans le clone
    clone.querySelectorAll('.no-print, .controls, .toolbar, .cv-tools, #cvMeta, #cv-status').forEach(n => n.remove());

    return clone;
  }

  function exportHtml() {
    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);

    const clone = getExportNodeClone();
    if (!clone) return;

    const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
</head>
<body>${clone.innerHTML}</body></html>`;

    downloadText(html, `${base}.html`);
  }

  async function exportPdf() {
    // exige html2pdf déjà chargé par cv.html
    if (!window.html2pdf) {
      setStatus("Erreur: html2pdf n'est pas chargé (cv.html).", false);
      return;
    }
    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);

    const clone = getExportNodeClone();
    if (!clone) return;

    // on exporte un node temporaire pour éviter la mise en page page entière
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '0';
    holder.style.width = '900px';
    holder.appendChild(clone);
    document.body.appendChild(holder);

    try {
      await window.html2pdf()
        .set({
          margin:       [10, 10, 10, 10],
          filename:     `${base}.pdf`,
          image:        { type: 'jpeg', quality: 0.95 },
          html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak:    { mode: ['css', 'legacy'] }
        })
        .from(clone)
        .save();
    } catch (e) {
      console.error(e);
      setStatus('Erreur export PDF : ' + (e?.message || e), false);
    } finally {
      holder.remove();
    }
  }

  async function exportDocx() {
    // Version "compatible": on produit un DOCX basique depuis le texte (stable et léger)
    // Prérequis : docx + saveAs (FileSaver) déjà chargés par cv.html.
    if (!window.docx || !window.saveAs) {
      setStatus("Erreur: docx / FileSaver non chargés (cv.html).", false);
      return;
    }

    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);

    // récup texte (sans boutons)
    const clone = getExportNodeClone();
    if (!clone) return;

    const text = clone.innerText || '';
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

    const paras = lines.map(line =>
      new Paragraph({ children: [new TextRun({ text: line })] })
    );

    const doc = new Document({ sections: [{ properties: {}, children: paras }] });

    try {
      const blob = await Packer.toBlob(doc);
      window.saveAs(blob, `${base}.docx`);
    } catch (e) {
      console.error(e);
      setStatus('Erreur export DOCX : ' + (e?.message || e), false);
    }
  }

  // ---------------- Refresh
  async function refresh() {
    saveFilters();

    const author = elAuthor?.value || '';
    if (!hasFullNameQuery(author)) {
      renderList([]);
      if (elMeta) elMeta.textContent = '';
      setStatus('Pour afficher les productions, tapez "Nom Prénom" (au moins 2 mots) dans le filtre Auteur.', true);
      return;
    }

    try {
      const pubs = await getPublications();
      const filtered = applyFilters(pubs);
      renderList(filtered);

      if (elMeta) {
        // on garde le meta à l'écran mais il sera supprimé à l'export
        const ts = PUBS_FETCHED_AT ? PUBS_FETCHED_AT.toLocaleString('fr-FR') : '';
        elMeta.textContent = ts ? `Maj : ${ts} · source : Zotero` : '';
      }

      setStatus('OK — ' + (filtered.length || 0) + ' résultat(s).', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur : ' + (e?.message || e), false);
    }
  }

  // ---------------- Init
  function init() {
    loadFilters();

    btnRefresh?.addEventListener('click', refresh);
    btnExportHtml?.addEventListener('click', exportHtml);
    btnExportPdf?.addEventListener('click', exportPdf);
    btnExportDocx?.addEventListener('click', exportDocx);

    // refresh auto (mais gate Nom+Prénom)
    [elAuthor, elYearMin, elYearMax, elOnlyPubs, elSort].forEach(el => {
      el?.addEventListener('input', refresh);
      el?.addEventListener('change', refresh);
    });

    refresh();
  }

  init();
})();
