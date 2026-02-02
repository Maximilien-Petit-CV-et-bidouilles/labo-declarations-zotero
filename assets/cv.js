/* ==========================================================
   assets/cv.js (PATCH: HTML width + PDF blank fix)
   - DOCX: unchanged (as requested)
   - HTML export: A4 centered (not full-width)
   - PDF export: fixes blank page by rendering in-viewport (invisible)
   ========================================================== */

(() => {
  'use strict';

  // ---------- DOM helpers
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Elements (cv.html)
  const cvRoot = $('cvRoot');
  const cvName = $('cvName');
  const cvContact = $('cvContact');
  const cvMeta = $('cvMeta');

  const authorFilter = $('authorFilter');
  const yearMin = $('yearMin');
  const yearMax = $('yearMax');
  const onlyPublications = $('onlyPublications');
  const sortMode = $('sortMode');

  const refreshBtn = $('refreshBtn');
  const saveTextBtn = $('saveTextBtn');

  const exportHtmlBtn = $('exportHtmlBtn');
  const exportPdfBtn = $('exportPdfBtn');
  const exportDocxBtn = $('exportDocxBtn');

  const pubList = $('pubList');
  const pubCount = $('pubCount');
  const statusEl = $('cv-status');

  if (!cvRoot) {
    console.warn('[cv.js] #cvRoot not found. Aborting init.');
    return;
  }

  // ---------- Storage keys
  const LS_MD = 'cv.mdblocks.v2';
  const LS_HDR = 'cv.header.v2';
  const LS_FILTERS = 'cv.filters.v2';

  // ---------- State
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;
  let PUBS_LOADING = false;

  // ---------- utils
  const stripDiacritics = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = (s) => stripDiacritics(String(s || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const escapeHtml = (s) => String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const extractYear = (dateStr) => {
    const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : null;
  };

  const debounce = (fn, ms = 250) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function setStatus(msg, ok = true) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function safeFilenameBase(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return base || 'cv';
  }

  // ---------- Markdown blocks wiring
  function getMdBlocks() {
    return qsa('section[data-mdblock]', cvRoot).map((sec) => {
      const key = sec.getAttribute('data-mdblock');
      const toggle = sec.querySelector('.mdtoggle');
      const edit = sec.querySelector('.mdedit');
      const preview = sec.querySelector('.mdpreview');
      return { sec, key, toggle, edit, preview };
    }).filter(b => b.key && b.edit && b.preview && b.toggle);
  }

  function renderMarkdown(md) {
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(md || '');
    }
    return '<pre>' + escapeHtml(md || '') + '</pre>';
  }

  function updatePreview(block) {
    block.preview.innerHTML = renderMarkdown(block.edit.value || '');
  }

  function showEdit(block, show) {
    if (show) {
      block.edit.hidden = false;
      block.preview.style.display = 'none';
      block.toggle.textContent = 'Aperçu';
      block.edit.focus();
    } else {
      block.edit.hidden = true;
      block.preview.style.display = '';
      block.toggle.textContent = 'Éditer';
    }
  }

  function loadMdBlocks() {
    try {
      const raw = localStorage.getItem(LS_MD);
      if (!raw) return;
      const data = JSON.parse(raw);
      const blocks = getMdBlocks();
      for (const b of blocks) {
        if (typeof data[b.key] === 'string') b.edit.value = data[b.key];
        updatePreview(b);
        showEdit(b, false);
      }
    } catch (e) {
      console.warn('[cv.js] loadMdBlocks failed:', e);
    }
  }

  function saveMdBlocks() {
    const blocks = getMdBlocks();
    const out = {};
    for (const b of blocks) out[b.key] = b.edit.value || '';
    localStorage.setItem(LS_MD, JSON.stringify(out));
  }

  function wireMdBlocks() {
    const blocks = getMdBlocks();
    for (const b of blocks) {
      updatePreview(b);
      showEdit(b, false);

      b.toggle.addEventListener('click', () => {
        const nowEdit = b.edit.hidden;
        showEdit(b, nowEdit);
        if (!nowEdit) updatePreview(b);
      });

      b.edit.addEventListener('input', debounce(() => updatePreview(b), 180));
    }
  }

  // ---------- Header persistence
  function loadHeader() {
    try {
      const raw = localStorage.getItem(LS_HDR);
      if (!raw) return;
      const h = JSON.parse(raw);
      if (cvName && typeof h.name === 'string') cvName.textContent = h.name;
      if (cvContact && typeof h.contact === 'string') cvContact.textContent = h.contact;
    } catch (e) {
      console.warn('[cv.js] loadHeader failed:', e);
    }
  }

  function saveHeader() {
    const name = cvName ? cvName.textContent.trim() : '';
    const contact = cvContact ? cvContact.textContent.trim() : '';
    localStorage.setItem(LS_HDR, JSON.stringify({ name, contact }));
  }

  // ---------- Filters persistence
  function loadFilters() {
    try {
      const raw = localStorage.getItem(LS_FILTERS);
      if (!raw) return;
      const f = JSON.parse(raw);
      if (authorFilter && typeof f.author === 'string') authorFilter.value = f.author;
      if (yearMin && typeof f.yearMin === 'string') yearMin.value = f.yearMin;
      if (yearMax && typeof f.yearMax === 'string') yearMax.value = f.yearMax;
      if (onlyPublications && typeof f.onlyPublications === 'string') onlyPublications.value = f.onlyPublications;
      if (sortMode && typeof f.sortMode === 'string') sortMode.value = f.sortMode;
    } catch {}
  }

  function saveFilters() {
    const f = {
      author: authorFilter ? authorFilter.value : '',
      yearMin: yearMin ? yearMin.value : '',
      yearMax: yearMax ? yearMax.value : '',
      onlyPublications: onlyPublications ? onlyPublications.value : 'yes',
      sortMode: sortMode ? sortMode.value : 'date_desc'
    };
    try { localStorage.setItem(LS_FILTERS, JSON.stringify(f)); } catch {}
  }

  function hasFullNameQuery(q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    return tokens.length >= 2 && tokens.every(t => t.length >= 2);
  }

  // ---------- Publications fetching (paged)
  async function fetchPagedPublicSuivi() {
    const out = [];
    let start = 0;
    const limit = 200;

    for (let guard = 0; guard < 100; guard++) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${limit}`;
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

  function creatorsText(creators) {
    if (!Array.isArray(creators)) return '';
    return creators
      .filter(c => c && (c.creatorType === 'author' || c.creatorType === 'editor' || c.creatorType === 'presenter'))
      .map(c => {
        const fn = String(c.firstName || '').trim();
        const ln = String(c.lastName || '').trim();
        return (ln && fn) ? (ln + ' ' + fn) : (ln || fn);
      })
      .filter(Boolean)
      .join(', ');
  }

  function isPublicationType(itemType, onlyPub) {
    if (!onlyPub) return true;
    return itemType === 'book' || itemType === 'bookSection' || itemType === 'journalArticle' || itemType === 'conferencePaper';
  }

  function authorMatch(creators, query) {
    const q = norm(query);
    if (!q) return true;
    const hay = norm(creators || '');
    if (!hay) return false;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(t => hay.includes(t));
  }

  function applyFiltersToItems(items) {
    const qAuthor = authorFilter ? authorFilter.value : '';
    const onlyPub = (onlyPublications ? onlyPublications.value : 'yes') === 'yes';

    const minY = parseInt((yearMin && yearMin.value) ? yearMin.value : '', 10);
    const maxY = parseInt((yearMax && yearMax.value) ? yearMax.value : '', 10);
    const hasMin = Number.isFinite(minY);
    const hasMax = Number.isFinite(maxY);

    let arr = (items || [])
      .filter(it => it && typeof it === 'object')
      .map(it => ({
        ...it,
        creatorsText: it.creatorsText || creatorsText(it.creators || [])
      }))
      .filter(it => isPublicationType(it.itemType, onlyPub))
      .filter(it => authorMatch(it.creatorsText, qAuthor));

    if (hasMin || hasMax) {
      arr = arr.filter(it => {
        const y = extractYear(it.date);
        if (!y) return true;
        if (hasMin && y < minY) return false;
        if (hasMax && y > maxY) return false;
        return true;
      });
    }

    const mode = sortMode ? sortMode.value : 'date_desc';
    arr.sort((a, b) => {
      const ya = extractYear(a.date) || 0;
      const yb = extractYear(b.date) || 0;

      if (mode === 'date_desc') {
        if (yb !== ya) return yb - ya;
        return String(b.date || '').localeCompare(String(a.date || ''));
      }
      if (mode === 'date_asc') {
        if (ya !== yb) return ya - yb;
        return String(a.date || '').localeCompare(String(b.date || ''));
      }
      if (mode === 'title_asc') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' });
      }
      return 0;
    });

    return arr;
  }

  function formatCitation(it) {
    const authors = (it.creatorsText || '').trim();
    const year = extractYear(it.date);
    const title = (it.title || '').trim();
    const t = it.itemType;

    const parts = [];
    if (authors) parts.push(escapeHtml(authors) + (year ? ` (${year}).` : '.'));
    else if (year) parts.push(`(${year}).`);

    if (title) parts.push(`<span class="t">${escapeHtml(title)}</span>.`);

    if (t === 'journalArticle') {
      const j = String(it.publicationTitle || '').trim();
      const vol = String(it.volume || '').trim();
      const iss = String(it.issue || '').trim();
      const pages = String(it.pages || '').trim();
      const doi = String(it.doi || '').trim();
      const tail = [];
      if (j) tail.push(`<i>${escapeHtml(j)}</i>`);
      if (vol) tail.push(`vol. ${escapeHtml(vol)}`);
      if (iss) tail.push(`n° ${escapeHtml(iss)}`);
      if (pages) tail.push(`pp. ${escapeHtml(pages)}`);
      if (doi) tail.push(`DOI: ${escapeHtml(doi)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'book') {
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const isbn = String(it.isbn || '').trim();
      const tail = [];
      if (place) tail.push(escapeHtml(place));
      if (publisher) tail.push(escapeHtml(publisher));
      if (isbn) tail.push(`ISBN: ${escapeHtml(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'bookSection') {
      const bookTitle = String(it.bookTitle || '').trim();
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const pages = String(it.pages || '').trim();
      const isbn = String(it.isbn || '').trim();
      const tail = [];
      if (bookTitle) tail.push(`Dans : <i>${escapeHtml(bookTitle)}</i>`);
      const ed = [];
      if (place) ed.push(escapeHtml(place));
      if (publisher) ed.push(escapeHtml(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push(`pp. ${escapeHtml(pages)}`);
      if (isbn) tail.push(`ISBN: ${escapeHtml(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'conferencePaper') {
      const conf = String(it.conferenceName || '').trim();
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const pages = String(it.pages || '').trim();
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

  function renderPublications(items, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    if (pubCount) pubCount.textContent = `${arr.length} référence(s)`;

    if (!pubList) return;
    if (!arr.length) {
      pubList.innerHTML = `<li style="color:var(--muted)">${opts.emptyMessage || 'Aucune référence.'}</li>`;
      return;
    }
    pubList.innerHTML = arr.map(it => `<li>${formatCitation(it)}</li>`).join('');
  }

  async function ensurePubsLoaded() {
    if (PUBS_CACHE) return PUBS_CACHE;
    if (PUBS_LOADING) return null;

    PUBS_LOADING = true;
    setStatus('Chargement des publications…', true);

    try {
      const items = await fetchPagedPublicSuivi();
      PUBS_CACHE = (items || []).map(it => ({
        ...it,
        creatorsText: it.creatorsText || creatorsText(it.creators || [])
      }));
      PUBS_FETCHED_AT = new Date();
      setStatus('', true);
      return PUBS_CACHE;
    } finally {
      PUBS_LOADING = false;
    }
  }

  async function refreshPublications(forceReload = false) {
    saveFilters();

    const q = authorFilter ? authorFilter.value : '';
    if (!hasFullNameQuery(q)) {
      renderPublications([], { emptyMessage: 'Tapez <b>Nom Prénom</b> dans le filtre <b>Auteur</b> pour charger les publications.' });
      if (cvMeta) cvMeta.textContent = '';
      setStatus('', true);
      return;
    }

    try {
      if (forceReload) {
        PUBS_CACHE = null;
        PUBS_FETCHED_AT = null;
      }
      const all = await ensurePubsLoaded();
      if (!all) return;

      const filtered = applyFiltersToItems(all);
      renderPublications(filtered);

      if (cvMeta) {
        const ts = PUBS_FETCHED_AT ? PUBS_FETCHED_AT.toLocaleString('fr-FR') : '';
        cvMeta.textContent = ts ? `Maj : ${ts} · source : Zotero` : '';
      }

      setStatus('', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur chargement publications : ' + (e?.message || e), false);
    }
  }

  // ---------- Save texts (header + md blocks)
  function saveAllTexts() {
    try {
      saveHeader();
      saveMdBlocks();
      saveFilters();
      setStatus('Textes sauvegardés ✅', true);
      setTimeout(() => { if (statusEl && statusEl.textContent.includes('sauvegardés')) setStatus('', true); }, 1200);
    } catch (e) {
      console.error(e);
      setStatus('Erreur sauvegarde textes.', false);
    }
  }

  // ==========================================================
  // EXPORTS (only HTML/PDF changed here; DOCX unchanged)
  // ==========================================================

  // Export overrides: remove frames + make typography cleaner
  const EXPORT_OVERRIDES_CSS = `
    body{ background:#fff !important; color:#111 !important; }
    .cv{ border:none !important; border-radius:0 !important; background:transparent !important; padding:0 !important; }
    .mdblock{ border:none !important; background:transparent !important; padding:0 !important; }
    #cv-status, #cvMeta, .status, .toolbar, .controls { display:none !important; }
    /* A4-like centered page for HTML export */
    .a4page{
      max-width: 210mm;
      margin: 0 auto;
      padding: 12mm 14mm;
      background: #fff;
    }
    @media print{
      .a4page{ padding: 0; }
    }
  `;

  function getInlineStyleFromCvHtml() {
    const styles = [];
    qsa('style').forEach(s => styles.push(s.textContent || ''));
    styles.push(EXPORT_OVERRIDES_CSS);
    return styles.join('\n');
  }

  function cloneForExport() {
    for (const b of getMdBlocks()) updatePreview(b);

    const clone = cvRoot.cloneNode(true);

    // remove meta + status
    const meta = clone.querySelector('#cvMeta');
    if (meta) meta.remove();
    const st = clone.querySelector('#cv-status');
    if (st) st.remove();

    // remove markdown editor UI, keep preview
    qsa('.mdtabs', clone).forEach(n => n.remove());
    qsa('textarea.mdedit', clone).forEach(n => n.remove());

    // remove helper message near publications
    const pubOl = clone.querySelector('#pubList');
    if (pubOl) {
      const pubSection = pubOl.closest('section.section');
      if (pubSection) {
        qsa('div', pubSection).forEach(d => {
          const t = (d.textContent || '').trim();
          if (t.includes('Les publications ne se chargent')) d.remove();
        });
        qsa('#pubList li', pubSection).forEach(li => {
          const t = (li.textContent || '').trim();
          if (t.includes('Tapez') && t.includes('Nom') && t.includes('Prénom') && t.includes('charger')) li.remove();
        });
      }
    }

    // remove placeholder "Mon site" only if it is the example placeholder
    qsa('a', clone).forEach(a => {
      const href = (a.getAttribute('href') || '').trim();
      const txt = (a.textContent || '').trim();
      if (href === 'https://exemple.fr' && txt.toLowerCase().includes('mon site')) {
        const span = document.createElement('span');
        span.textContent = a.textContent;
        a.replaceWith(span);
      }
    });

    // remove contenteditable attributes
    qsa('[contenteditable]', clone).forEach(n => n.removeAttribute('contenteditable'));

    return clone;
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

  // ✅ HTML: wrap in .a4page so it's not full-width
  function exportHTML() {
    const clone = cloneForExport();
    const css = getInlineStyleFromCvHtml();

    const title = (cvName ? cvName.textContent.trim() : 'CV') || 'CV';
    const filename = safeFilenameBase(title) + '.html';

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="a4page">
${clone.outerHTML}
</div>
</body>
</html>`;

    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
    setStatus('Export HTML généré ✅', true);
  }
// ✅ PDF: html2pdf robuste (évite page blanche)
// Remplace uniquement ta fonction exportPDF() par celle-ci.
async function exportPDF() {
  if (!window.html2pdf) {
    setStatus("Erreur : html2pdf n'est pas chargé.", false);
    return;
  }

  const clone = cloneForExport();
  const title = (cvName ? cvName.textContent.trim() : 'CV') || 'CV';
  const filename = safeFilenameBase(title) + '.pdf';

  // Holder hors écran, MAIS rendu (pas display:none, pas opacity:0)
  const holder = document.createElement('div');
  holder.id = 'pdfExportHolder';
  holder.style.position = 'fixed';
  holder.style.left = '0';
  holder.style.top = '0';
  holder.style.transform = 'translateX(-12000px)'; // hors viewport
  holder.style.background = '#fff';
  holder.style.color = '#111';
  holder.style.width = '210mm';   // A4
  holder.style.maxWidth = '210mm';

  // Inject CSS export (suppression des cadres, look "pandoc-like")
  const style = document.createElement('style');
  style.textContent = EXPORT_OVERRIDES_CSS;
  holder.appendChild(style);

  // IMPORTANT : capturer une page "simple", pas le holder
  const page = document.createElement('div');
  page.className = 'a4page';
  page.style.width = '210mm';
  page.style.boxSizing = 'border-box';
  page.style.padding = '12mm 14mm';
  page.style.background = '#ffffff';
  page.appendChild(clone);
  holder.appendChild(page);

  document.body.appendChild(holder);

  try {
    // Attendre fonts + layout (sinon canvas parfois vide)
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    await window.html2pdf()
      .set({
        filename,
        margin: [0, 0, 0, 0],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          // ces 2 lignes aident beaucoup contre les "blancs" selon navigateur
          windowWidth: page.scrollWidth || 1200,
          windowHeight: page.scrollHeight || 1600
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(page) // ✅ capte la page, pas le wrapper
      .save();

    setStatus('Export PDF généré ✅', true);
  } catch (e) {
    console.error(e);
    setStatus('Erreur export PDF : ' + (e?.message || e), false);
  } finally {
    holder.remove();
  }
}


  // DOCX: keep the version you said is "très bien"
  // (copied as-is from your previous working patch)
  function docxAvailable() {
    return !!(window.docx && window.docx.Document && window.docx.Paragraph && window.docx.TextRun);
  }

  function parseHtmlToNodes(html) {
    const dp = new DOMParser();
    const doc = dp.parseFromString(`<div>${html || ''}</div>`, 'text/html');
    return doc.body.firstChild ? Array.from(doc.body.firstChild.childNodes) : [];
  }

  function htmlNodeToRuns(node, style) {
    const { TextRun } = window.docx;
    const runs = [];
    const cur = { bold: !!style.bold, italics: !!style.italics };

    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue || '';
      if (t) runs.push(new TextRun({ text: t, bold: cur.bold, italics: cur.italics }));
      return runs;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return runs;

    const tag = node.tagName.toLowerCase();
    const nextStyle = { ...cur };
    if (tag === 'strong' || tag === 'b') nextStyle.bold = true;
    if (tag === 'em' || tag === 'i') nextStyle.italics = true;

    if (tag === 'br') {
      runs.push(new TextRun({ text: '\n', bold: cur.bold, italics: cur.italics }));
      return runs;
    }
    if (tag === 'a') {
      const text = node.textContent || '';
      if (text) runs.push(new TextRun({ text, bold: nextStyle.bold, italics: nextStyle.italics }));
      return runs;
    }

    for (const child of Array.from(node.childNodes)) {
      runs.push(...htmlNodeToRuns(child, nextStyle));
    }
    return runs;
  }

  function blockToDocxParagraphsFromPreview(previewEl) {
    const { Paragraph } = window.docx;
    const paras = [];
    const nodes = parseHtmlToNodes(previewEl.innerHTML || '');

    function walk(node, listLevel = null) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(node.querySelectorAll(':scope > li'));
          items.forEach(li => walk(li, { ordered: tag === 'ol' }));
          return;
        }

        if (tag === 'li') {
          const runs = [];
          for (const ch of Array.from(node.childNodes)) {
            if (ch.nodeType === Node.ELEMENT_NODE) {
              const ct = ch.tagName.toLowerCase();
              if (ct === 'ul' || ct === 'ol') continue;
            }
            runs.push(...htmlNodeToRuns(ch, { bold: false, italics: false }));
          }
          paras.push(new Paragraph({
            children: runs.length ? runs : undefined,
            bullet: listLevel ? { level: 0 } : undefined,
            spacing: { after: 120 }
          }));
          Array.from(node.childNodes).forEach(ch => {
            if (ch.nodeType === Node.ELEMENT_NODE) {
              const ct = ch.tagName.toLowerCase();
              if (ct === 'ul' || ct === 'ol') walk(ch, listLevel);
            }
          });
          return;
        }

        if (tag === 'p' || tag === 'div') {
          const runs = htmlNodeToRuns(node, { bold: false, italics: false });
          const textOnly = (node.textContent || '').trim();
          if (runs.length && textOnly) paras.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
          return;
        }
      }

      if ((node.textContent || '').trim()) {
        const runs = htmlNodeToRuns(node, { bold: false, italics: false });
        paras.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
      }
    }

    nodes.forEach(n => walk(n, null));
    return paras;
  }

  async function exportDOCX() {
    if (!docxAvailable()) {
      setStatus("Erreur : docx n'est pas chargé.", false);
      return;
    }
    const { Document, Packer, Paragraph, TextRun } = window.docx;

    const clone = cloneForExport();
    const title = (cvName ? cvName.textContent.trim() : 'CV') || 'CV';
    const filename = safeFilenameBase(title) + '.docx';

    const children = [];

    const name = (cvName ? cvName.textContent.trim() : '').trim();
    const contact = (cvContact ? cvContact.textContent.trim() : '').trim();
    if (name) children.push(new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 36 })], spacing: { after: 120 } }));
    if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact, size: 22 })], spacing: { after: 240 } }));

    const sections = qsa('section.section', clone);
    for (const sec of sections) {
      const h3 = sec.querySelector('h3');
      const heading = h3 ? (h3.textContent || '').trim() : '';
      if (heading) {
        children.push(new Paragraph({ children: [new TextRun({ text: heading, bold: true, size: 26 })], spacing: { before: 160, after: 120 } }));
      }

      const pubs = sec.querySelector('#pubList');
      if (pubs) {
        const lis = qsa('#pubList li', sec);
        for (const li of lis) {
          const runs = htmlNodeToRuns(li, { bold: false, italics: false });
          const txt = (li.textContent || '').trim();
          if (!txt) continue;
          children.push(new Paragraph({ children: runs, spacing: { after: 120 }, bullet: { level: 0 } }));
        }
        continue;
      }

      const preview = sec.querySelector('.mdpreview');
      if (preview) {
        const paras = blockToDocxParagraphsFromPreview(preview);
        children.push(...paras);
      }
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });

    try {
      const blob = await Packer.toBlob(doc);
      if (window.saveAs) window.saveAs(blob, filename);
      else downloadBlob(blob, filename);
      setStatus('Export DOCX généré ✅', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur export DOCX : ' + (e?.message || e), false);
    }
  }

  // ---------- Wiring
  function wireUI() {
    if (saveTextBtn) saveTextBtn.addEventListener('click', (e) => { e.preventDefault(); saveAllTexts(); });

    const onHeaderEdit = debounce(() => saveHeader(), 300);
    if (cvName) cvName.addEventListener('input', onHeaderEdit);
    if (cvContact) cvContact.addEventListener('input', onHeaderEdit);

    if (refreshBtn) refreshBtn.addEventListener('click', (e) => { e.preventDefault(); refreshPublications(true); });

    const filterChanged = debounce(() => refreshPublications(false), 260);
    [authorFilter, yearMin, yearMax, onlyPublications, sortMode].filter(Boolean).forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', filterChanged);
      el.addEventListener('change', filterChanged);
    });

    if (exportHtmlBtn) exportHtmlBtn.addEventListener('click', (e) => { e.preventDefault(); exportHTML(); });
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', (e) => { e.preventDefault(); exportPDF(); });
    if (exportDocxBtn) exportDocxBtn.addEventListener('click', (e) => { e.preventDefault(); exportDOCX(); });
  }

  // ---------- Init
  function init() {
    if (window.marked && typeof window.marked.setOptions === 'function') {
      window.marked.setOptions({ breaks: true, gfm: true });
    }

    loadHeader();
    loadFilters();

    wireMdBlocks();
    loadMdBlocks();

    wireUI();

    refreshPublications(false);

    window.addEventListener('beforeunload', () => {
      try {
        saveHeader();
        saveMdBlocks();
        saveFilters();
      } catch {}
    });
  }

  init();
})();
