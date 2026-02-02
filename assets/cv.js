/* ==========================================================
   assets/cv.js (PATCHED FOR THIS PROJECT'S cv.html)
   - Works with cv.html structure:
       - Markdown blocks: <section data-mdblock="...">
         with .mdtoggle, .mdedit (textarea), .mdpreview
       - Save button: #saveTextBtn
       - Filters: #authorFilter, #yearMin, #yearMax, #onlyPublications, #sortMode
       - Refresh publications: #refreshBtn
       - Exports: #exportHtmlBtn, #exportPdfBtn, #exportDocxBtn
       - CV container: #cvRoot, meta: #cvMeta
   - Publications load ONLY when Author filter contains at least "Nom Prénom" (2 tokens)
   - Authors are displayed again + author filter works
   - conferencePaper is included everywhere as a "publication"
   - Keeps the existing HTML/PDF/DOCX export UX (and fixes the broken wiring)
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
  const LS_HDR = 'cv.header.v2';      // name + contact (contenteditable)
  const LS_FILTERS = 'cv.filters.v2'; // author/year/sort options

  // ---------- State
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;
  let PUBS_LOADING = false;

  // ---------- utils
  const stripDiacritics = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = (s) => stripDiacritics(String(s || '')).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
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
    // fallback minimal
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
      // Initial render
      updatePreview(b);
      showEdit(b, false);

      // Toggle edit/preview
      b.toggle.addEventListener('click', () => {
        const nowEdit = b.edit.hidden; // hidden => will show
        showEdit(b, nowEdit);
        if (!nowEdit) updatePreview(b);
      });

      // Live preview on input (debounced)
      b.edit.addEventListener('input', debounce(() => updatePreview(b), 180));
    }
  }

  // ---------- Header (name/contact) persistence
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
    // ✅ "Publications" includes conferencePaper (as requested)
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
      // IMPORTANT: do not load anything
      renderPublications([], { emptyMessage: 'Tapez <b>Nom Prénom</b> dans le filtre <b>Auteur</b> pour charger les publications.' });
      if (cvMeta) cvMeta.textContent = '';
      setStatus('Pour afficher les productions : tapez “Nom Prénom” (au moins 2 mots) dans le filtre Auteur.', true);
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

      // Show meta on screen (but removed in exports)
      if (cvMeta) {
        const ts = PUBS_FETCHED_AT ? PUBS_FETCHED_AT.toLocaleString('fr-FR') : '';
        cvMeta.textContent = ts ? `Maj : ${ts} · source : Zotero` : '';
      }

      setStatus(`OK — ${filtered.length} publication(s)`, true);
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
      setStatus('Textes sauvegardés ✅', true);
      // subtle auto-clear
      setTimeout(() => { if (statusEl && statusEl.textContent.includes('sauvegardés')) setStatus('', true); }, 1200);
    } catch (e) {
      console.error(e);
      setStatus('Erreur sauvegarde textes.', false);
    }
  }

  // ---------- Export helpers (build a clean clone of #cvRoot)
  function cloneForExport() {
    // Make sure previews reflect edits
    for (const b of getMdBlocks()) updatePreview(b);

    const clone = cvRoot.cloneNode(true);

    // Remove meta line (user requested)
    const meta = clone.querySelector('#cvMeta');
    if (meta) meta.remove();

    // Remove markdown editor UI: tabs + textarea, keep preview HTML
    qsa('.mdtabs', clone).forEach(n => n.remove());
    qsa('textarea.mdedit', clone).forEach(n => n.remove());

    // Remove any leftover "editable" contenteditable attributes
    qsa('[contenteditable]', clone).forEach(n => n.removeAttribute('contenteditable'));

    // ✅ Remove the box/border around md blocks for PDF/HTML exports
    qsa('.mdblock', clone).forEach(n => {
      n.style.border = 'none';
      n.style.background = 'transparent';
      n.style.padding = '0';
    });

    return clone;
  }

  function getInlineStyleFromCvHtml() {
    // We embed cv.html's <style> so exports keep your current layout.
    // (cv.html already has the whole stylesheet.)
    const styles = [];
    qsa('style').forEach(s => styles.push(s.textContent || ''));
    return styles.join('\n');
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

  function safeFilenameBase(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return base || 'cv';
  }

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
<div class="wrap">
${clone.outerHTML}
</div>
</body></html>`;

    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
    setStatus('Export HTML généré ✅', true);
  }

  async function exportPDF() {
    if (!window.html2pdf) {
      setStatus("Erreur : html2pdf n'est pas chargé.", false);
      return;
    }
    const clone = cloneForExport();
    const title = (cvName ? cvName.textContent.trim() : 'CV') || 'CV';
    const filename = safeFilenameBase(title) + '.pdf';

    // Temporary container (avoids layout glitches)
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '0';
    holder.style.width = '900px';
    holder.style.background = '#ffffff';
    holder.appendChild(clone);
    document.body.appendChild(holder);

    try {
      await window.html2pdf()
        .set({
          margin: [12, 14, 12, 14],
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        })
        .from(clone)
        .save();

      setStatus('Export PDF généré ✅', true);
    } catch (e) {
      console.error(e);
      setStatus('Erreur export PDF : ' + (e?.message || e), false);
    } finally {
      holder.remove();
    }
  }

  function htmlToPlainText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  }

  async function exportDOCX() {
    if (!window.docx) {
      setStatus("Erreur : docx n'est pas chargé.", false);
      return;
    }
    const { Document, Packer, Paragraph, TextRun } = window.docx;

    const clone = cloneForExport();
    const title = (cvName ? cvName.textContent.trim() : 'CV') || 'CV';
    const filename = safeFilenameBase(title) + '.docx';

    // Build a simple, robust DOCX (no fancy styling to keep it reliable)
    const children = [];

    // Header
    const name = (cvName ? cvName.textContent.trim() : '').trim();
    const contact = (cvContact ? cvContact.textContent.trim() : '').trim();
    if (name) children.push(new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 36 })], spacing: { after: 120 } }));
    if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact, size: 22 })], spacing: { after: 240 } }));

    // Sections
    const sections = qsa('section.section', clone);
    for (const sec of sections) {
      const h3 = sec.querySelector('h3');
      const heading = h3 ? (h3.textContent || '').trim() : '';
      if (heading) {
        children.push(new Paragraph({ children: [new TextRun({ text: heading, bold: true, size: 26 })], spacing: { before: 160, after: 100 } }));
      }

      // If publications section: list items
      if (sec.querySelector('#pubList')) {
        const lis = qsa('#pubList li', sec);
        for (const li of lis) {
          const t = htmlToPlainText(li.innerHTML);
          if (!t) continue;
          children.push(new Paragraph({ children: [new TextRun({ text: t, size: 22 })], spacing: { after: 80 } }));
        }
        continue;
      }

      // Markdown blocks: use preview HTML as text
      const preview = sec.querySelector('.mdpreview');
      if (preview) {
        const t = htmlToPlainText(preview.innerHTML);
        if (t) {
          t.split('\n').filter(Boolean).forEach(line => {
            children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })], spacing: { after: 80 } }));
          });
        }
      }
    }

    const doc = new Document({ sections: [{ properties: {}, children }] });

    try {
      const blob = await Packer.toBlob(doc);
      // Use built-in save if FileSaver absent
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
    // Save texts
    if (saveTextBtn) saveTextBtn.addEventListener('click', (e) => { e.preventDefault(); saveAllTexts(); });

    // Persist header edits (safe)
    const onHeaderEdit = debounce(() => saveHeader(), 300);
    if (cvName) cvName.addEventListener('input', onHeaderEdit);
    if (cvContact) cvContact.addEventListener('input', onHeaderEdit);

    // Publications refresh
    if (refreshBtn) refreshBtn.addEventListener('click', (e) => { e.preventDefault(); refreshPublications(true); });

    // Filters
    const filterChanged = debounce(() => refreshPublications(false), 260);
    [authorFilter, yearMin, yearMax, onlyPublications, sortMode].filter(Boolean).forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', filterChanged);
      el.addEventListener('change', filterChanged);
    });

    // Exports
    if (exportHtmlBtn) exportHtmlBtn.addEventListener('click', (e) => { e.preventDefault(); exportHTML(); });
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', (e) => { e.preventDefault(); exportPDF(); });
    if (exportDocxBtn) exportDocxBtn.addEventListener('click', (e) => { e.preventDefault(); exportDOCX(); });
  }

  // ---------- Init
  function init() {
    // Markdown renderer options (if present)
    if (window.marked && typeof window.marked.setOptions === 'function') {
      window.marked.setOptions({ breaks: true, gfm: true });
    }

    loadHeader();
    loadFilters();

    wireMdBlocks();
    loadMdBlocks(); // after wire (so it renders previews)

    wireUI();

    // Initial publications behavior: do NOT load until full name
    refreshPublications(false);

    // Safety autosave before leaving
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
