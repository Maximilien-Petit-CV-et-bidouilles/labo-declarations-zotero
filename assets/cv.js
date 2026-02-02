/* ==========================================================
   assets/cv.js — version robuste “ne casse rien”
   Objectifs :
   - ✅ rétablir l’édition des blocs + bouton “Sauver les textes”
   - ✅ rétablir export DOCX (docx + FileSaver)
   - ✅ publications : auteurs visibles + filtre auteur fonctionnel
   - ✅ éviter le chargement massif : on ne charge les pubs QUE si
        le champ Auteur contient au moins “Nom Prénom”
   - ✅ inclure conferencePaper comme publication
   - ✅ ne touche pas aux autres pages (index/admin/suivi)
   ----------------------------------------------------------
   Hypothèses minimales sur cv.html :
   - un conteneur principal #cvRoot (ou <main> si absent)
   - des blocs éditables marqués soit par:
       [data-cv-block]   (recommandé)
     ou des ids connus (fallback)
   - un bouton “Sauver les textes” : #saveTextsBtn (fallback : #saveBtn)
   - un statut : #saveStatus (fallback : #cvSaveStatus)
   - une zone publications :
       - #authorFilter (input)
       - #pubList (ul/ol/div)
       - #pubCount (span)
       - #cv-status (status)
   - boutons export :
       #exportHtmlBtn #exportPdfBtn #exportDocxBtn
   ========================================================== */

(function () {
  'use strict';

  // ---------------- DOM helpers
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Root export
  const CV_ROOT = $('cvRoot') || qs('main') || document.body;

  // UI pubs
  const elAuthor = $('authorFilter') || qs('[name="authorFilter"]');
  const elPubList = $('pubList') || qs('#pubList') || qs('[data-pub-list]');
  const elPubCount = $('pubCount') || qs('#pubCount') || qs('[data-pub-count]');
  const elStatus = $('cv-status') || qs('#cv-status') || qs('[data-cv-status]');

  // UI save blocks
  const btnSave = $('saveTextsBtn') || $('saveBtn') || qs('[data-save-texts]');
  const saveStatus = $('saveStatus') || $('cvSaveStatus') || qs('[data-save-status]');

  // export buttons
  const btnExportHtml = $('exportHtmlBtn') || qs('[data-export="html"]');
  const btnExportPdf = $('exportPdfBtn') || qs('[data-export="pdf"]');
  const btnExportDocx = $('exportDocxBtn') || qs('[data-export="docx"]');

  // optional refresh button (pubs)
  const btnRefresh = $('refreshBtn') || qs('[data-refresh-pubs]');

  // meta info you wanted removed from export
  const elMeta = $('cvMeta') || qs('#cvMeta') || qs('[data-cv-meta]');

  // ---------------- constants
  const STORAGE_BLOCKS_KEY = 'dlab.cv.blocks.v1';
  const STORAGE_FILTERS_KEY = 'dlab.cv.filters.v1';

  // cache pubs
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;

  function setStatus(msg, ok = true) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = ok ? 'status ok' : 'status err';
  }
  function setSaveStatus(msg, ok = true) {
    if (!saveStatus) return;
    saveStatus.textContent = msg || '';
    saveStatus.className = ok ? 'status ok' : 'status err';
  }

  // ---------------- text utils
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
  function hasFullNameQuery(q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    return tokens.length >= 2 && tokens.every(t => t.length >= 2);
  }
  function extractYear(dateStr) {
    const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  }

  // ---------------- blocks (édition/sauvegarde)
  // Strategy:
  // - “blocs” = éléments avec [data-cv-block="presentation"] etc.
  // - fallback: ids connus
  function collectBlocks() {
    const blocks = [];

    // preferred markers
    qsa('[data-cv-block]', CV_ROOT).forEach(el => {
      const key = el.getAttribute('data-cv-block');
      if (!key) return;
      blocks.push({ key, el });
    });

    if (blocks.length) return blocks;

    // fallback ids (si cv.html ancien)
    const fallbackIds = [
      'block-presentation',
      'block-titles',
      'block-degrees',
      'block-teaching',
      'block-other'
    ];
    fallbackIds.forEach(id => {
      const el = $(id);
      if (el) blocks.push({ key: id, el });
    });

    return blocks;
  }

  function getBlocksState() {
    const blocks = collectBlocks();
    const obj = {};
    for (const b of blocks) {
      // On privilégie innerHTML pour garder la mise en forme (markdown déjà rendu / HTML simple)
      obj[b.key] = b.el.innerHTML;
    }
    return obj;
  }

  function applyBlocksState(state) {
    if (!state || typeof state !== 'object') return;
    const blocks = collectBlocks();
    for (const b of blocks) {
      if (Object.prototype.hasOwnProperty.call(state, b.key)) {
        b.el.innerHTML = state[b.key] || '';
      }
    }
  }

  function loadBlocks() {
    try {
      const raw = localStorage.getItem(STORAGE_BLOCKS_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      applyBlocksState(state);
      setSaveStatus('Textes chargés.', true);
    } catch (e) {
      console.error(e);
    }
  }

  function saveBlocks() {
    try {
      const state = getBlocksState();
      localStorage.setItem(STORAGE_BLOCKS_KEY, JSON.stringify(state));
      setSaveStatus('Textes sauvegardés ✅', true);
    } catch (e) {
      console.error(e);
      setSaveStatus('Erreur sauvegarde textes.', false);
    }
  }

  function wireEditingUX() {
    // Ne force pas contenteditable : on respecte ce que cv.html a déjà.
    // Mais si un bloc est marqué data-cv-block et n’a rien, on l’active.
    const blocks = collectBlocks();
    for (const b of blocks) {
      // si cv.html gère déjà l’édition, on ne touche pas.
      if (b.el.getAttribute('contenteditable') === null) continue;
    }

    if (btnSave) btnSave.addEventListener('click', (e) => { e.preventDefault(); saveBlocks(); });
  }

  // ---------------- filtres pubs (optionnel)
  function loadFilters() {
    try {
      const raw = localStorage.getItem(STORAGE_FILTERS_KEY);
      if (!raw) return;
      const f = JSON.parse(raw);
      if (elAuthor && typeof f.author === 'string') elAuthor.value = f.author;
    } catch {}
  }
  function saveFilters() {
    try {
      localStorage.setItem(STORAGE_FILTERS_KEY, JSON.stringify({
        author: elAuthor?.value || ''
      }));
    } catch {}
  }

  // ---------------- fetch pubs (public-suivi) paginé
  async function fetchAllPublicationsPaged() {
    const PAGE_SIZE = 200;
    let start = 0;
    const out = [];

    // on boucle tant que hasMore
    for (let guard = 0; guard < 200; guard++) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${PAGE_SIZE}`;
      const r = await fetch(url, { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Erreur serveur (${r.status})`);

      const items = Array.isArray(data.items) ? data.items : [];
      out.push(...items);

      if (!data.hasMore) break;
      if (!items.length) break;
      start += items.length;
    }
    return out;
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

  function applyPubFilter(items, authorQuery) {
    return (items || [])
      .filter(it => it && typeof it === 'object')
      .filter(it => isPublicationType(it.itemType))
      .filter(it => isAuthorMatch(it.creatorsText || '', authorQuery))
      .sort((a, b) => {
        const ya = extractYear(a.date) || 0;
        const yb = extractYear(b.date) || 0;
        if (yb !== ya) return yb - ya;
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
  }

  // ---------------- render pubs
  function formatOne(item) {
    const authors = String(item.creatorsText || '').trim();
    const year = extractYear(item.date);
    const title = String(item.title || '').trim();
    const it = item.itemType;

    const parts = [];
    if (authors) parts.push(escapeHtml(authors) + (year ? ` (${year}).` : '.'));
    else if (year) parts.push(`(${year}).`);

    if (title) parts.push(`<span class="t">${escapeHtml(title)}</span>.`);

    if (it === 'journalArticle') {
      const j = String(item.publicationTitle || '').trim();
      const vol = String(item.volume || '').trim();
      const issue = String(item.issue || '').trim();
      const pages = String(item.pages || '').trim();
      const doi = String(item.doi || '').trim();

      const tail = [];
      if (j) tail.push(`<i>${escapeHtml(j)}</i>`);
      if (vol) tail.push(`vol. ${escapeHtml(vol)}`);
      if (issue) tail.push(`n° ${escapeHtml(issue)}`);
      if (pages) tail.push(`pp. ${escapeHtml(pages)}`);
      if (doi) tail.push(`DOI: ${escapeHtml(doi)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'book') {
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const isbn = String(item.isbn || '').trim();
      const tail = [];
      if (place) tail.push(escapeHtml(place));
      if (publisher) tail.push(escapeHtml(publisher));
      if (isbn) tail.push(`ISBN: ${escapeHtml(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'bookSection') {
      const bookTitle = String(item.bookTitle || '').trim();
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pages = String(item.pages || '').trim();
      const isbn = String(item.isbn || '').trim();

      const tail = [];
      if (bookTitle) tail.push(`Dans : <i>${escapeHtml(bookTitle)}</i>`);
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push(`pp. ${escapeHtml(pages)}`);
      if (isbn) tail.push(`ISBN: ${escapeHtml(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (it === 'conferencePaper') {
      const conf = String(item.conferenceName || '').trim();
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pages = String(item.pages || '').trim();

      const tail = [];
      if (conf) tail.push(`<i>${escapeHtml(conf)}</i>`);
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push(`pp. ${escapeHtml(pages)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function renderPubList(items) {
    const arr = Array.isArray(items) ? items : [];
    if (elPubCount) elPubCount.textContent = `${arr.length} référence(s)`;

    if (!elPubList) return;
    // Support ul/ol ou div
    const isList = /^(UL|OL)$/.test(elPubList.tagName);
    if (isList) {
      elPubList.innerHTML = arr.map(it => `<li>${formatOne(it)}</li>`).join('');
    } else {
      elPubList.innerHTML = arr.map(it => `<div class="pub">${formatOne(it)}</div>`).join('');
    }
  }

  async function refreshPubs() {
    saveFilters();

    const author = elAuthor?.value || '';
    if (!hasFullNameQuery(author)) {
      renderPubList([]);
      if (elMeta) elMeta.textContent = '';
      setStatus('Pour afficher les productions : tapez “Nom Prénom” (au moins 2 mots) dans le filtre Auteur.', true);
      return;
    }

    try {
      const pubs = await getPublications();
      const filtered = applyPubFilter(pubs, author);
      renderPubList(filtered);

      if (elMeta) {
        const ts = PUBS_FETCHED_AT ? PUBS_FETCHED_AT.toLocaleString('fr-FR') : '';
        // visible à l’écran, mais retiré à l’export
        elMeta.textContent = ts ? `Maj : ${ts} · source : Zotero` : '';
      }
      setStatus(`OK — ${filtered.length} publication(s).`, true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur chargement publications : ' + (e?.message || e), false);
    }
  }

  // ---------------- export
  function removeNonExportNodes(root) {
    qsa('.no-print, .controls, .toolbar, .cv-tools, #cvMeta, [data-cv-meta], #cv-status, [data-cv-status]', root)
      .forEach(n => n.remove());
  }

  function getExportClone() {
    const clone = CV_ROOT.cloneNode(true);
    removeNonExportNodes(clone);
    return clone;
  }

  function exportHtml() {
    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);
    const clone = getExportClone();

    const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
</head>
<body>${clone.innerHTML}</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    if (!window.html2pdf) {
      setStatus("Erreur : html2pdf n'est pas chargé (cv.html).", false);
      return;
    }

    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);
    const clone = getExportClone();

    // temp holder (évite les styles positionnés)
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
          margin: [10, 10, 10, 10],
          filename: `${base}.pdf`,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
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

  // DOCX : texte fiable (et surtout “ça marche”)
  async function exportDocx() {
    if (!window.docx || !window.saveAs) {
      setStatus("Erreur : docx / FileSaver non chargés (cv.html).", false);
      return;
    }
    const { Document, Packer, Paragraph, TextRun } = window.docx;

    const name = ($('cvName')?.value || 'CV');
    const base = safeFilenameBase(name);
    const clone = getExportClone();

    // Nettoyage : convertit en lignes
    const text = (clone.innerText || '').replace(/\r/g, '');
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

    const children = [];
    for (const line of lines) {
      // petite heuristique: titres en MAJ ou lignes courtes => bold
      const isHeading = (line.length <= 40 && /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s'’\-:]+$/.test(line));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, bold: !!isHeading })],
          spacing: { after: 120 }
        })
      );
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });

    try {
      const blob = await Packer.toBlob(doc);
      window.saveAs(blob, `${base}.docx`);
      setStatus('DOCX généré ✅', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur export DOCX : ' + (e?.message || e), false);
    }
  }

  // ---------------- init
  function wireExports() {
    if (btnExportHtml) btnExportHtml.addEventListener('click', (e) => { e.preventDefault(); exportHtml(); });
    if (btnExportPdf) btnExportPdf.addEventListener('click', (e) => { e.preventDefault(); exportPdf(); });
    if (btnExportDocx) btnExportDocx.addEventListener('click', (e) => { e.preventDefault(); exportDocx(); });
  }

  function wirePubsUX() {
    if (btnRefresh) btnRefresh.addEventListener('click', (e) => { e.preventDefault(); refreshPubs(); });

    // rafraîchit au changement du filtre auteur
    if (elAuthor) {
      elAuthor.addEventListener('input', () => {
        // debounce léger
        clearTimeout(elAuthor.__t);
        elAuthor.__t = setTimeout(refreshPubs, 250);
      });
      elAuthor.addEventListener('change', refreshPubs);
    }
  }

  function init() {
    // 1) blocs
    loadBlocks();
    wireEditingUX();
    // si pas de bouton save, au moins autosave à la sortie de page
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem(STORAGE_BLOCKS_KEY, JSON.stringify(getBlocksState())); } catch {}
    });

    // 2) pubs
    loadFilters();
    wirePubsUX();
    refreshPubs();

    // 3) exports
    wireExports();
  }

  init();
})();
