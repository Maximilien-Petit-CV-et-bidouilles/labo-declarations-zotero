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
      if (!obj || typeof obj !== 'object') return;
      const name = $('#cvName');
      const contact = $('#cvContact');
      if (name && typeof obj.name === 'string') name.value = obj.name;
      if (contact && typeof obj.contact === 'string') contact.value = obj.contact;
    } catch { }
  }

  function saveInline() {
    try {
      const name = $('#cvName')?.value || '';
      const contact = $('#cvContact')?.value || '';
      localStorage.setItem(INLINE_KEY, JSON.stringify({ name, contact }));
    } catch { }
  }

  // ---------- Persist filters
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
    } catch { }
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
    } catch { }
  }

  // ---------- Fetch publications (server paginated)
  async function fetchAllPublicationsPaged() {
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
      if (!data.hasMore || items.length === 0) break;
      start += items.length;
    }
    return out;
  }

  async function getPublications() {
    if (PUBS_CACHE && Array.isArray(PUBS_CACHE)) return PUBS_CACHE;
    setStatus('Chargement des publications…', true);
    const items = await fetchAllPublicationsPaged();
    const mapped = (items || []).map(it => ({
      ...it,
      creatorsText: it.creatorsText || creatorsToText(it.creators || [])
    }));
    PUBS_CACHE = mapped;
    PUBS_FETCHED_AT = new Date();
    return mapped;
  }

  // ---------- Filtering
  function isAuthorMatch(itemCreatorsText, authorQuery) {
    const q = norm(authorQuery);
    if (!q) return true;
    const hay = norm(itemCreatorsText);
    if (!hay) return false;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(t => hay.includes(t));
  }

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
    const hasMin = Number.isFinite(yMin);
    const hasMax = Number.isFinite(yMax);
    const onlyPubs = (elOnlyPubs.value || 'yes') === 'yes';
    const sort = elSort.value || 'date_desc';

    return (items || [])
      .filter(it => it && typeof it === 'object')
      .filter(it => {
        if (onlyPubs && !isPublicationType(it.itemType)) return false;
        return true;
      })
      .filter(it => {
        if (!isAuthorMatch(it.creatorsText || '', author)) return false;
        return true;
      })
      .filter(it => {
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

  function writeMdState(state) {
    try { localStorage.setItem(MD_KEY, JSON.stringify(state || {})); }
    catch {}
  }

  function initMdBlocks() {
    const blocks = document.querySelectorAll('[data-mdblock]');
    const state = readMdState();

    blocks.forEach((wrap) => {
      const key = wrap.getAttribute('data-mdblock');
      const textarea = wrap.querySelector('textarea.mdedit');
      const preview = wrap.querySelector('.mdpreview');
      const toggle = wrap.querySelector('button.mdtoggle');

      if (!key || !textarea || !preview) return;

      if (typeof state[key] === 'string') textarea.value = state[key];

      const renderPreview = () => { preview.innerHTML = mdToHtml(textarea.value || ''); };
      renderPreview();

      toggle?.addEventListener('click', () => {
        const isHidden = textarea.hasAttribute('hidden');
        if (isHidden) {
          textarea.removeAttribute('hidden');
          toggle.textContent = 'Aperçu';
        } else {
          textarea.setAttribute('hidden', '');
          toggle.textContent = 'Éditer';
          renderPreview();
        }
      });

      textarea.addEventListener('input', () => { renderPreview(); });
    });
  }

  function saveAllMdBlocksNow() {
    const blocks = document.querySelectorAll('[data-mdblock]');
    const state = readMdState();
    blocks.forEach((wrap) => {
      const key = wrap.getAttribute('data-mdblock');
      const textarea = wrap.querySelector('textarea.mdedit');
      if (!key || !textarea) return;
      state[key] = textarea.value || '';
    });
    writeMdState(state);
  }

  // ==========================================================
  // ✅ EXPORTS — CSS “pandoc-like” + anti-cadre (mdblock inclus)
  // ==========================================================
  function exportCssPandocLike() {
    return `
      :root{
        --text:#111;
        --muted:#555;
        --rule:#d9d9df;
        --link:#2c7be5;
      }
      *{ box-sizing:border-box; }

      html, body { height:auto; background:#fff !important; }

      body{
        margin:0;
        color:var(--text);
        font-family: Georgia, "Times New Roman", Times, serif;
        font-size: 11.3pt;
        line-height: 1.35;
      }

      /* ⛔️ Anti-cadre global (artefacts html2canvas) */
      .page, .cv, .cv *{
        box-shadow: none !important;
        outline: none !important;
        border-radius: 0 !important;
      }
      .page, .cv{
        border: 0 !important;
        background: #fff !important;
      }

      /* ⛔️ Anti-cadre spécifique aux wrappers markdown (.mdblock) */
      .mdblock{
        border: 0 !important;
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .mdpreview{
        padding: 0 !important;
        margin: 0 !important;
        background: transparent !important;
      }

      .page{
        max-width: 860px;
        margin: 0 auto;
        padding: 26px 36px;
      }

      .cv{ padding: 0; }

      .cv-title{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap: 16px;
        margin-bottom: 10px;
      }
      .cv-title .title-left{ flex: 1 1 auto; min-width: 240px; }
      .cv-title .title-right{
        flex: 0 0 auto;
        text-align:right;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
        font-size: 10.2pt;
        color: var(--muted);
        line-height: 1.25;
      }
      .cv-title h1{
        margin:0 0 2px 0;
        font-size: 18pt;
        font-weight: 700;
        letter-spacing: .1px;
      }
      .cv-title .meta{
        margin:0;
        color:var(--muted);
        font-size: 10.2pt;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
      }

      h2{
        margin: 16px 0 6px;
        padding: 0 0 4px;
        font-size: 12.8pt;
        font-weight: 700;
        border-bottom: 1px solid var(--rule);
      }

      /* Bloc texte (markdown rendu) */
      .mdpreview p{ margin: 0 0 8px; }
      .mdpreview ul{ margin: 0 0 8px 18px; }
      .mdpreview li{ margin: 0 0 2px; }
      .mdpreview a{ color: var(--link); text-decoration: none; }
      .mdpreview a:hover{ text-decoration: underline; }

      /* Publications */
      .pubs{ margin: 6px 0 0; padding-left: 18px; }
      .pubs li{ margin: 0 0 6px; }
      .pubs .t{ font-weight: 650; }
      .small{
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial;
        font-size: 9.7pt;
        color: var(--muted);
        margin-top: 8px;
      }

      /* Impression */
      @page { margin: 18mm 16mm; }
      @media print{
        .no-print{ display:none !important; }
        .page{ padding: 0 !important; }
      }
    `;
  }

  function buildExportHtmlDoc(title, bodyHtml) {
    const css = exportCssPandocLike();
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="page">${bodyHtml}</div>
</body>
</html>`;
  }

  function getCvInnerHtmlForExport() {
    if (!elCvRoot) return '';
    // clone CV root and remove controls / meta non exportés
    const clone = elCvRoot.cloneNode(true);

    // supprime les contrôles (zone filtre/export)
    clone.querySelectorAll('.no-print, .controls, .toolbar, .cv-tools, #cvMeta').forEach(n => n.remove());

    // s'assurer que les previews markdown soient visibles et propres
    clone.querySelectorAll('textarea.mdedit').forEach(t => t.remove());
    clone.querySelectorAll('button.mdtoggle').forEach(b => b.remove());

    // supprimer status/meta s'il existe
    clone.querySelectorAll('#cv-status').forEach(n => n.remove());

    // wrapper outer HTML
    return clone.innerHTML;
  }

  async function exportHtml() {
    saveAllMdBlocksNow();
    saveInline();
    const name = $('#cvName')?.value || 'CV';
    const base = safeFilenameBase(name);
    const html = buildExportHtmlDoc(name, getCvInnerHtmlForExport());
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`);
  }

  // PDF export (html2canvas + jsPDF)
  async function exportPdf() {
    saveAllMdBlocksNow();
    saveInline();

    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      setStatus('Erreur: librairies PDF manquantes (html2canvas / jsPDF).', false);
      return;
    }

    const name = $('#cvName')?.value || 'CV';
    const base = safeFilenameBase(name);

    // Construire un document isolé (évite styles UI)
    const html = buildExportHtmlDoc(name, getCvInnerHtmlForExport());

    // Iframe invisible pour rendre avec CSS pandoc-like
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = '900px';
    iframe.style.height = '1200px';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise(resolve => {
      iframe.onload = resolve;
      // fallback
      setTimeout(resolve, 600);
    });

    const target = doc.querySelector('.page');
    if (!target) {
      iframe.remove();
      setStatus('Erreur: export PDF (cible introuvable).', false);
      return;
    }

    // Render canvas
    const canvas = await window.html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Calcul ratio
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let y = 0;
    let heightLeft = imgHeight;

    pdf.addImage(imgData, 'JPEG', 0, y, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      pdf.addPage();
      y = heightLeft - imgHeight;
      pdf.addImage(imgData, 'JPEG', 0, y, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    iframe.remove();
    pdf.save(`${base}.pdf`);
  }

  // DOCX export (html -> docx)
  async function exportDocx() {
    saveAllMdBlocksNow();
    saveInline();

    if (!window.htmlDocx || typeof window.htmlDocx.asBlob !== 'function') {
      setStatus('Erreur: librairie html-docx-js manquante.', false);
      return;
    }

    const name = $('#cvName')?.value || 'CV';
    const base = safeFilenameBase(name);

    const html = buildExportHtmlDoc(name, getCvInnerHtmlForExport());
    const blob = window.htmlDocx.asBlob(html);
    downloadBlob(blob, `${base}.docx`);
  }

  // ---------- Main refresh (load + render)
  async function refresh() {
    saveFilters();
    saveInline();

    const author = elAuthor.value || '';

    // 💡 N'affiche / ne charge les publications que si Auteur contient "Nom Prénom"
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
        const fetched = PUBS_FETCHED_AT ? PUBS_FETCHED_AT.toLocaleString('fr-FR') : nowFr();
        elMeta.textContent = `Source : Zotero · Maj : ${fetched}`;
      }
      setStatus('OK — ' + (filtered.length || 0) + ' résultat(s).', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur: ' + String(e?.message || e), false);
    }
  }

  // ---------- Wire UI
  function init() {
    loadFilters();
    loadInline();
    initMdBlocks();

    btnRefresh?.addEventListener('click', refresh);

    btnSaveText?.addEventListener('click', () => {
      saveAllMdBlocksNow();
      saveInline();
      setStatus('Texte sauvegardé.', true);
    });

    btnExportHtml?.addEventListener('click', exportHtml);
    btnExportPdf?.addEventListener('click', exportPdf);
    btnExportDocx?.addEventListener('click', exportDocx);

    // auto refresh on filter changes (mais garde le “gate” Nom+Prénom)
    [elAuthor, elYearMin, elYearMax, elOnlyPubs, elSort].forEach(el => {
      el?.addEventListener('input', () => {
        saveFilters();
        refresh();
      });
      el?.addEventListener('change', () => {
        saveFilters();
        refresh();
      });
    });

    // First render
    refresh();
  }

  init();

})();
