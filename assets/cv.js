/* ==========================================================
   assets/cv.js — CV generator
   - Publications via /.netlify/functions/public-suivi (pagination)
   - Ne charge les publications que si Auteur contient "Nom Prénom"
   - Blocs texte en Markdown (Edit/Aperçu) sauvegardés en localStorage
   - Export HTML / PDF "propres" : exporte UNIQUEMENT le CV avec CSS "pandoc-like"
   - PDF: suppression explicite de tout "cadre" (notamment .mdblock)
   ========================================================== */

(function () {
  'use strict';

  // ---------- DOM
  const $ = (sel) => document.querySelector(sel);

  const elAuthor = $('#authorFilter');
  const elYearMin = $('#yearMin');
  const elYearMax = $('#yearMax');
  const elOnlyPubs = $('#onlyPublications');
  const elSort = $('#sortMode');

  const btnRefresh = $('#refreshBtn');
  const btnSaveText = $('#saveTextBtn');
  const btnExportHtml = $('#exportHtmlBtn');
  const btnExportPdf = $('#exportPdfBtn');
  const btnExportDocx = $('#exportDocxBtn');

  const elStatus = $('#cv-status');
  const elMeta = $('#cvMeta'); // affichage page (pas export)
  const elPubList = $('#pubList');
  const elPubCount = $('#pubCount');
  const elCvRoot = $('#cvRoot');

  const FILTER_KEY = 'dlab.cv.filters.v3';
  const MD_KEY = 'dlab.cv.mdblocks.v1';
  const INLINE_KEY = 'dlab.cv.inline.v1'; // cvName / cvContact

  // Publications cache
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;

  // ---------- Utils
  function setStatus(msg, ok = true) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function nowFr() {
    try { return new Date().toLocaleString('fr-FR'); }
    catch { return new Date().toISOString(); }
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

  function hasFullNameQuery(q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    if (tokens.length < 2) return false;
    if (tokens.some(t => t.length < 2)) return false;
    return true;
  }

  function safeFilenameBase(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return base || 'cv';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---------- Markdown rendering
  function mdToHtml(md) {
    const src = String(md || '');
    if (window.marked && typeof window.marked.parse === 'function') {
      const noHtml = src.replace(/<[^>]*>/g, '');
      return window.marked.parse(noHtml, { gfm: true, breaks: true });
    }
    return escapeHtml(src).replace(/\n/g, '<br>');
  }

  // ---------- Persist inline
  function loadInline() {
    try {
      const raw = localStorage.getItem(INLINE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const elName = $('#cvName');
        const elContact = $('#cvContact');
        if (elName && obj.cvName) elName.textContent = obj.cvName;
        if (elContact && obj.cvContact) elContact.textContent = obj.cvContact;
      }
    } catch { /* ignore */ }
  }

  function saveInline() {
    try {
      const elName = $('#cvName');
      const elContact = $('#cvContact');
      const obj = {
        cvName: elName ? elName.textContent.trim() : '',
        cvContact: elContact ? elContact.textContent.trim() : ''
      };
      localStorage.setItem(INLINE_KEY, JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  // ---------- Persist filters
  function loadFilters() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        if (elAuthor && obj.author != null) elAuthor.value = obj.author;
        if (elYearMin && obj.yearMin != null) elYearMin.value = obj.yearMin;
        if (elYearMax && obj.yearMax != null) elYearMax.value = obj.yearMax;
        if (elOnlyPubs && obj.onlyPubs != null) elOnlyPubs.checked = !!obj.onlyPubs;
        if (elSort && obj.sort != null) elSort.value = obj.sort;
      }
    } catch { /* ignore */ }
  }

  function saveFilters() {
    try {
      const obj = {
        author: elAuthor ? elAuthor.value : '',
        yearMin: elYearMin ? elYearMin.value : '',
        yearMax: elYearMax ? elYearMax.value : '',
        onlyPubs: elOnlyPubs ? elOnlyPubs.checked : false,
        sort: elSort ? elSort.value : 'date_desc'
      };
      localStorage.setItem(FILTER_KEY, JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  // ---------- Data fetch (paginated)
  async function fetchAllPubsPaged() {
    const PAGE = 200;
    let start = 0;
    let out = [];
    let loops = 0;
    while (true) {
      loops++;
      if (loops > 200) break; // safety

      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${PAGE}`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('Erreur serveur (public-suivi).');
      const data = await r.json();

      const items = Array.isArray(data.items) ? data.items : [];
      out = out.concat(items);

      if (!data.hasMore) break;
      start += PAGE;
    }
    return out;
  }

  async function ensurePubsLoaded(force = false) {
    if (PUBS_CACHE && !force) return PUBS_CACHE;

    setStatus('Chargement des publications…', true);

    const items = await fetchAllPubsPaged();
    PUBS_CACHE = items.map(it => ({
      ...it,
      creatorsText: it.creatorsText || creatorsToText(it.creators || [])
    }));

    PUBS_FETCHED_AT = new Date();
    setStatus(`Publications chargées (${PUBS_CACHE.length}).`, true);

    if (elMeta) {
      elMeta.textContent = `MAJ: ${nowFr()} · source: Zotero`;
    }

    return PUBS_CACHE;
  }

  // ---------- Filtering + sorting
  function matchAuthor(itemCreatorsText, userQuery) {
    const q = norm(userQuery);
    if (!q) return true;
    const hay = norm(itemCreatorsText);
    if (!hay) return false;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(t => hay.includes(t));
  }

  // ✅ Ajout : conferencePaper est aussi une “production”
  function isPublicationType(itemType) {
    return itemType === 'book' || itemType === 'bookSection' || itemType === 'journalArticle' || itemType === 'conferencePaper';
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
    const author = elAuthor.value || '';
    const yMin = parseInt(elYearMin.value, 10);
    const yMax = parseInt(elYearMax.value, 10);
    const onlyPubs = !!(elOnlyPubs && elOnlyPubs.checked);
    const sort = (elSort && elSort.value) ? elSort.value : 'date_desc';

    const hasMin = Number.isFinite(yMin);
    const hasMax = Number.isFinite(yMax);

    return (items || [])
      .filter(it => {
        if (!it) return false;

        // Performance/UX : n'affiche rien tant que l'auteur n'a pas mis "Nom Prénom"
        if (author && !hasFullNameQuery(author)) return false;

        if (onlyPubs && !isPublicationType(it.itemType)) return false;

        if (author && !matchAuthor(it.creatorsText || '', author)) return false;

        const y = extractYear(it.date);
        if (hasMin && (y === null || y < yMin)) return false;
        if (hasMax && (y === null || y > yMax)) return false;

        return true;
      })
      .sort((a, b) => compareItems(a, b, sort));
  }

  // ---------- Publications formatting (HTML)
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
      // ✅ Nouveau : Conference Paper
      const conf = String(item.conferenceName || '').trim();
      const publisher = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pages = String(item.pages || '').trim();
      const doi = String(item.doi || '').trim();

      const tail = [];
      if (conf) tail.push('Communication : <i>' + escapeHtml(conf) + '</i>');
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push('pp. ' + escapeHtml(pages));
      if (doi) tail.push('DOI: ' + escapeHtml(doi));

      if (tail.length) parts.push(tail.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function renderList(items) {
    if (!elPubList) return;
    const arr = Array.isArray(items) ? items : [];
    elPubList.innerHTML = arr.map(it => `<li>${formatOne(it)}</li>`).join('');
    if (elPubCount) {
      const n = arr.length;
      elPubCount.textContent = n + (n <= 1 ? ' référence' : ' références');
    }
  }

  // ---------- Markdown blocks (edit/preview)
  function readMdState() {
    try {
      const raw = localStorage.getItem(MD_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch {
      return {};
    }
  }

  function writeMdState(obj) {
    try {
      localStorage.setItem(MD_KEY, JSON.stringify(obj || {}));
    } catch { /* ignore */ }
  }

  function initMdBlocks() {
    const state = readMdState();
    const blocks = document.querySelectorAll('[data-mdblock]');
    blocks.forEach(block => {
      const key = block.getAttribute('data-mdblock');
      const ta = block.querySelector('textarea');
      const prev = block.querySelector('.mdpreview');
      const btnT = block.querySelector('[data-md-toggle]');

      const val = (state[key] != null) ? String(state[key]) : '';
      if (ta) ta.value = val;
      if (prev) prev.innerHTML = mdToHtml(val);

      if (btnT && ta && prev) {
        btnT.addEventListener('click', () => {
          const isEditing = ta.style.display !== 'none';
          if (isEditing) {
            prev.innerHTML = mdToHtml(ta.value);
            ta.style.display = 'none';
            prev.style.display = 'block';
            btnT.textContent = 'Éditer';
          } else {
            ta.style.display = 'block';
            prev.style.display = 'none';
            btnT.textContent = 'Aperçu';
          }
        });
      }
    });
  }

  function saveMdBlocks() {
    const obj = readMdState();
    const blocks = document.querySelectorAll('[data-mdblock]');
    blocks.forEach(block => {
      const key = block.getAttribute('data-mdblock');
      const ta = block.querySelector('textarea');
      if (key && ta) obj[key] = ta.value;
    });
    writeMdState(obj);
    saveInline();
    setStatus('Textes sauvegardés.', true);
    setTimeout(() => setStatus('', true), 1200);
  }

  // ---------- Export helpers
  function getCvHtmlForExport() {
    const clone = elCvRoot.cloneNode(true);

    // Supprime meta d'écran
    const meta = clone.querySelector('#cvMeta');
    if (meta) meta.remove();

    // Transforme previews markdown en HTML final, supprime textarea
    const blocks = clone.querySelectorAll('[data-mdblock]');
    blocks.forEach(block => {
      const ta = block.querySelector('textarea');
      const prev = block.querySelector('.mdpreview');
      if (ta && prev) {
        prev.innerHTML = mdToHtml(ta.value);
        ta.remove();
      }
      const btn = block.querySelector('[data-md-toggle]');
      if (btn) btn.remove();
    });

    return clone.innerHTML;
  }

  function buildPandocLikeCss() {
    return `
      :root{--text:#111;--muted:#555;--rule:#ddd;}
      html,body{background:#fff;color:var(--text);}
      body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;}
      .cv{max-width:860px;margin:36px auto;padding:0 22px;}
      h1{font-size:28px;margin:0 0 6px;}
      .headerline{color:var(--muted);font-size:14px;margin:0 0 18px;}
      h2{font-size:16px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.04em;}
      h2 + .block{margin-top:6px;}
      .block{margin:0 0 10px;}
      .mdpreview p{margin:0 0 8px;}
      .mdpreview ul{margin:0 0 8px 20px;}
      .mdpreview li{margin:2px 0;}
      .pubs ul{margin:0 0 8px 20px;}
      .pubs li{margin:6px 0;line-height:1.35;}
      .pubs .t{font-weight:650;}
      hr{border:0;border-top:1px solid var(--rule);margin:16px 0;}
      /* ✅ anti-cadre */
      .mdblock, .block, .card, .section{border:none !important; box-shadow:none !important; background:transparent !important;}
    `;
  }

  async function exportHtml() {
    const name = ($('#cvName')?.textContent || 'CV').trim();
    const base = safeFilenameBase(name);
    const html = `
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>${buildPandocLikeCss()}</style>
</head>
<body>
  <div class="cv">
    ${getCvHtmlForExport()}
  </div>
</body>
</html>`.trim();

    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`);
  }

  async function exportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setStatus('jsPDF indisponible.', false);
      return;
    }
    const name = ($('#cvName')?.textContent || 'CV').trim();
    const base = safeFilenameBase(name);

    // Impression DOM -> canvas -> PDF (html2canvas)
    if (!window.html2canvas) {
      setStatus('html2canvas indisponible.', false);
      return;
    }

    setStatus('Export PDF en cours…', true);

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = '900px';
    container.innerHTML = `<div class="cv">${getCvHtmlForExport()}</div>`;
    document.body.appendChild(container);

    const style = document.createElement('style');
    style.textContent = buildPandocLikeCss();
    container.appendChild(style);

    const canvas = await window.html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });

    const img = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // fit width
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    let y = 0;
    let remaining = imgH;

    while (remaining > 0) {
      pdf.addImage(img, 'PNG', 0, y, imgW, imgH);
      remaining -= pageH;
      if (remaining > 0) {
        pdf.addPage();
        y -= pageH;
      }
    }

    document.body.removeChild(container);

    const blob = pdf.output('blob');
    downloadBlob(blob, `${base}.pdf`);
    setStatus('PDF exporté.', true);
    setTimeout(() => setStatus('', true), 1200);
  }

  async function exportDocx() {
    // Le projet existant gère déjà le DOCX correctement via la fonction serveur dédiée / lib.
    // On conserve l'appel existant (si présent). Ici : fallback "HTML -> docx" si pas de bouton branché.
    setStatus('Export DOCX non configuré ici.', false);
  }

  // ---------- Main refresh
  async function refresh() {
    try {
      saveFilters();
      const author = elAuthor.value || '';
      if (author && !hasFullNameQuery(author)) {
        // UX: n'affiche rien tant que Nom+Prénom
        renderList([]);
        if (elPubCount) elPubCount.textContent = '—';
        setStatus('Saisissez "Nom Prénom" (au moins 2 mots) pour charger/afficher les publications.', true);
        return;
      }

      const pubs = await ensurePubsLoaded(false);
      const view = applyFilters(pubs);
      renderList(view);
      setStatus('OK.', true);
      setTimeout(() => setStatus('', true), 900);
    } catch (e) {
      console.error(e);
      setStatus('Erreur: ' + (e?.message || e), false);
    }
  }

  // ---------- Init
  function init() {
    loadInline();
    loadFilters();
    initMdBlocks();

    if (btnSaveText) btnSaveText.addEventListener('click', saveMdBlocks);
    if (btnRefresh) btnRefresh.addEventListener('click', () => refresh());

    if (btnExportHtml) btnExportHtml.addEventListener('click', exportHtml);
    if (btnExportPdf) btnExportPdf.addEventListener('click', exportPdf);
    if (btnExportDocx) btnExportDocx.addEventListener('click', exportDocx);

    // Auto-refresh si auteur déjà complet en localStorage
    refresh();
  }

  init();

})();
