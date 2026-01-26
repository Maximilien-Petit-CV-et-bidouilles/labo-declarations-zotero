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
      const n = $('#cvName');
      const c = $('#cvContact');
      if (n && typeof obj.name === 'string') n.textContent = obj.name;
      if (c && typeof obj.contact === 'string') c.textContent = obj.contact;
    } catch {}
  }

  function saveInline() {
    try {
      const n = $('#cvName')?.textContent || '';
      const c = $('#cvContact')?.textContent || '';
      localStorage.setItem(INLINE_KEY, JSON.stringify({ name: n, contact: c }));
    } catch {}
  }

  // ---------- Persist filters
  function loadFilters() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (elAuthor && typeof obj.author === 'string') elAuthor.value = obj.author;
      if (elYearMin && typeof obj.yearMin === 'string') elYearMin.value = obj.yearMin;
      if (elYearMax && typeof obj.yearMax === 'string') elYearMax.value = obj.yearMax;
      if (elOnlyPubs && typeof obj.onlyPubs === 'string') elOnlyPubs.value = obj.onlyPubs;
      if (elSort && typeof obj.sort === 'string') elSort.value = obj.sort;
    } catch {}
  }

  function saveFilters() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        author: elAuthor.value || '',
        yearMin: elYearMin.value || '',
        yearMax: elYearMax.value || '',
        onlyPubs: elOnlyPubs.value || 'yes',
        sort: elSort.value || 'date_desc'
      }));
    } catch {}
  }

  // ---------- Data fetch (paginated)
  async function fetchPublicItems() {
    const limit = 100;
    let start = 0;
    const MAX_ITEMS = 10000;

    const all = [];
    let fetchedAt = new Date().toISOString();

    while (true) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      const text = await res.text();

      if (!res.ok) throw new Error('Function public-suivi: HTTP ' + res.status + ' – ' + text.slice(0, 500));

      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error('Réponse JSON invalide depuis public-suivi : ' + text.slice(0, 200)); }

      if (Array.isArray(json)) return { items: json, fetchedAt: new Date().toISOString() };

      if (!json || !Array.isArray(json.items)) throw new Error('Format inattendu depuis public-suivi (pas de items[]).');

      fetchedAt = json.fetchedAt || fetchedAt;
      all.push(...json.items);

      const hasMore = !!json.hasMore;
      const nextStart = (json.nextStart !== undefined && json.nextStart !== null) ? Number(json.nextStart) : null;
      if (!hasMore || nextStart === null) break;

      start = nextStart;
      if (all.length >= MAX_ITEMS) break;
    }

    return { items: all, fetchedAt };
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

  function isPublicationType(itemType) {
    return itemType === 'book' || itemType === 'bookSection' || itemType === 'journalArticle';
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
      .filter(it => !onlyPubs || isPublicationType(it.itemType))
      .filter(it => matchAuthor(it.creatorsText || '', author))
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
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 10.5pt;
        color: var(--muted);
        line-height: 1.25;
        white-space: pre-wrap;
      }
      .cv-title .name{
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        font-weight: 750;
        font-size: 24pt;
        letter-spacing: .2px;
        margin: 0;
        line-height: 1.1;
      }
      .cv-title .subtitle{
        margin-top: 6px;
        color: var(--muted);
        font-size: 10.8pt;
      }

      hr.rule{
        border:0;
        border-top: 1px solid var(--rule);
        margin: 10px 0 14px;
      }

      .section{
        margin-top: 14px;
        padding-top: 0;
        border-top: 0 !important;
      }
      .section h3{
        margin: 0 0 8px;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        font-variant: small-caps;
        letter-spacing: .6px;
        font-weight: 800;
        font-size: 11.2pt;
        color: #111;
      }

      .mdpreview{ line-height:1.45; }
      .mdpreview p{ margin: 0 0 8px; }
      .mdpreview ul, .mdpreview ol{ margin: 0 0 8px; padding-left: 18px; }
      .mdpreview li{ margin: 0 0 3px; }

      a{ color: var(--link); text-decoration: none; }
      a:hover{ text-decoration: underline; }

      .pubs{
        margin: 0;
        padding-left: 0;
        list-style: none;
      }
      .pubs li{
        margin: 0 0 7px;
        padding-left: 1.35em;
        text-indent: -1.35em;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pubs li .t{ font-weight: 650; }

      .pill, .controls, button, textarea, .mdtabs, #cv-status, #cvMeta { display:none !important; }

      .section{ break-inside: avoid; page-break-inside: avoid; }
      .mdpreview p, .mdpreview li{ orphans: 2; widows: 2; }

      @page { margin: 14mm; }
    `;
  }

  function buildExportDocumentHtml() {
    // Sync state
    saveAllMdBlocksNow();
    saveInline();

    const clone = elCvRoot.cloneNode(true);

    // Remove meta in export
    clone.querySelectorAll('#cvMeta').forEach(n => n.remove());

    // Remove markdown UI (keep mdpreview only)
    clone.querySelectorAll('.mdtabs, button, textarea.mdedit').forEach(n => n.remove());

    // ✅ Supprime réellement les wrappers .mdblock (source des cadres)
    //    et remplace par le contenu .mdpreview uniquement.
    clone.querySelectorAll('.mdblock').forEach((mb) => {
      const prev = mb.querySelector('.mdpreview');
      if (prev) {
        const repl = document.createElement('div');
        repl.className = 'mdpreview';
        repl.innerHTML = prev.innerHTML;
        mb.replaceWith(repl);
      } else {
        // au pire, on enlève
        mb.remove();
      }
    });

    // Title block rebuild
    const nameEl = clone.querySelector('#cvName');
    const contactEl = clone.querySelector('#cvContact');

    const nameTxt = (nameEl?.textContent || '').trim() || 'Nom Prénom';
    const contactTxt = (contactEl?.textContent || '').trim();

    if (nameEl) nameEl.remove();
    if (contactEl) contactEl.remove();

    const cvTitle = clone.querySelector('.cv-title') || clone.firstElementChild;
    if (cvTitle) {
      cvTitle.innerHTML = `
        <div class="title-left">
          <div class="name">${escapeHtml(nameTxt)}</div>
          <div class="subtitle"></div>
        </div>
        <div class="title-right">${escapeHtml(contactTxt)}</div>
      `;
      const hr = document.createElement('hr');
      hr.className = 'rule';
      cvTitle.insertAdjacentElement('afterend', hr);
    }

    // Remove contenteditable attrs
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));

    const css = exportCssPandocLike();
    const title = nameTxt;

    const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="page">
    <main class="cv">
      ${clone.innerHTML}
    </main>
  </div>
</body>
</html>`;

    return { html, title };
  }

  // ---------- Export HTML
  function exportHtml() {
    try {
      const { html, title } = buildExportDocumentHtml();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      downloadBlob(blob, safeFilenameBase(title) + '.html');
      setStatus('✅ Export HTML (propre) généré.');
    } catch (e) {
      setStatus('❌ Export HTML impossible : ' + (e?.message || e), false);
      console.error('[CV] exportHtml error:', e);
    }
  }

  // ---------- Export PDF
  async function exportPdf() {
    try {
      if (!window.html2pdf) throw new Error('html2pdf.js introuvable (CDN).');

      const { html, title } = buildExportDocumentHtml();
      setStatus('⏳ Génération PDF…');

      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-99999px';
      host.style.top = '0';
      host.style.width = '980px';
      host.style.background = '#fff';
      host.innerHTML = html;
      document.body.appendChild(host);

      const exportRoot = host.querySelector('.page');
      if (!exportRoot) throw new Error('Export root introuvable.');

      const opt = {
        margin: [8, 8, 8, 8],
        filename: safeFilenameBase(title) + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 1.6,
          useCORS: true,
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      await window.html2pdf().set(opt).from(exportRoot).save();

      host.remove();
      setStatus('✅ Export PDF (pandoc-like) généré.');
    } catch (e) {
      setStatus('❌ Export PDF impossible : ' + (e?.message || e), false);
      console.error('[CV] exportPdf error:', e);
    }
  }

  // ---------- DOCX helpers (baseline — inchangé)
  function splitMarkdownBlocks(md) {
    const lines = String(md || '').split('\n');
    const blocks = [];
    let buf = [];

    const flushPara = () => {
      if (!buf.length) return;
      blocks.push({ type: 'para', text: buf.join('\n') });
      buf = [];
    };

    for (const line of lines) {
      const l = line.trim();

      const h = l.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        flushPara();
        blocks.push({ type: 'heading', level: h[1].length, text: h[2] });
        continue;
      }

      const b = l.match(/^[-*]\s+(.*)$/);
      if (b) {
        flushPara();
        blocks.push({ type: 'bullet', text: b[1] });
        continue;
      }

      buf.push(line);
    }

    flushPara();
    return blocks;
  }

  function runsFromInlineMarkdown(text) {
    const { TextRun, ExternalHyperlink } = window.docx || {};
    if (!TextRun) return [];

    const s = String(text || '');

    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    const parts = [];
    for (let m; (m = linkRe.exec(s)); ) {
      if (m.index > last) parts.push({ type: 'text', value: s.slice(last, m.index) });
      parts.push({ type: 'link', label: m[1], url: m[2] });
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });

    const out = [];
    const pushInline = (chunk) => {
      const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
      let i = 0;
      let m;
      while ((m = re.exec(chunk))) {
        if (m.index > i) out.push(new TextRun({ text: chunk.slice(i, m.index) }));
        const token = m[0];
        if (token.startsWith('**')) out.push(new TextRun({ text: token.slice(2, -2), bold: true }));
        else if (token.startsWith('*')) out.push(new TextRun({ text: token.slice(1, -1), italics: true }));
        i = m.index + token.length;
      }
      if (i < chunk.length) out.push(new TextRun({ text: chunk.slice(i) }));
    };

    for (const p of parts) {
      if (p.type === 'text') pushInline(p.value);
      else if (p.type === 'link' && ExternalHyperlink) {
        out.push(new ExternalHyperlink({
          link: p.url,
          children: [new TextRun({ text: p.label, style: 'Hyperlink' })]
        }));
      } else if (p.type === 'link') {
        pushInline(p.label + ' (' + p.url + ')');
      }
    }

    return out;
  }

  async function exportDocx() {
    try {
      saveAllMdBlocksNow();
      saveInline();
      setStatus('⏳ Génération DOCX…');

      const docx = window.docx;
      if (!docx) throw new Error('docx (CDN) introuvable.');

      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

      const name = $('#cvName')?.textContent || 'CV';
      const contact = $('#cvContact')?.textContent || '';

      const children = [];

      children.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_1 }));
      if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact })] }));
      children.push(new Paragraph({ text: ' ' }));

      const blocks = document.querySelectorAll('[data-mdblock]');
      const state = readMdState();

      for (const wrap of blocks) {
        const key = wrap.getAttribute('data-mdblock');
        const title = wrap.querySelector('h3')?.textContent || '';
        const md = (key && typeof state[key] === 'string') ? state[key] : (wrap.querySelector('textarea.mdedit')?.value || '');

        if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }));

        const parts = splitMarkdownBlocks(md);
        for (const part of parts) {
          if (part.type === 'bullet') {
            children.push(new Paragraph({ children: runsFromInlineMarkdown(part.text), bullet: { level: 0 } }));
          } else if (part.type === 'heading') {
            const level = part.level === 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
            children.push(new Paragraph({ text: part.text, heading: level }));
          } else {
            children.push(new Paragraph({ children: runsFromInlineMarkdown(part.text || '') }));
          }
        }
        children.push(new Paragraph({ text: ' ' }));
      }

      const pubs = Array.from(elPubList?.querySelectorAll('li') || []).map(li => li.textContent || '').filter(Boolean);
      if (pubs.length) {
        children.push(new Paragraph({ text: 'Productions principales en recherche', heading: HeadingLevel.HEADING_2 }));
        for (const p of pubs) children.push(new Paragraph({ text: p, bullet: { level: 0 } }));
      }

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, safeFilenameBase(name) + '.docx');
      setStatus('✅ Export DOCX généré.');
    } catch (e) {
      setStatus('❌ Export DOCX impossible : ' + (e?.message || e), false);
      console.error('[CV] exportDocx error:', e);
    }
  }

  // ---------- Refresh
  async function refresh(force = false) {
    saveFilters();

    const authorQuery = elAuthor?.value || '';
    if (!hasFullNameQuery(authorQuery)) {
      if (elPubList) {
        elPubList.innerHTML =
          '<li style="color:var(--muted)">' +
          'Tapez <b>Nom Prénom</b> dans le filtre <b>Auteur</b> pour charger les publications.' +
          '</li>';
      }
      if (elPubCount) elPubCount.textContent = '—';
      if (elMeta) elMeta.textContent = '';
      setStatus('ℹ️ Publications non chargées (saisir Nom + Prénom dans Auteur).');
      return;
    }

    setStatus('⏳ Chargement des publications…');

    try {
      if (btnRefresh) btnRefresh.disabled = true;

      if (force || !PUBS_CACHE) {
        const payload = await fetchPublicItems();
        const items = Array.isArray(payload.items) ? payload.items : [];

        PUBS_CACHE = items.map(it => ({
          ...it,
          creatorsText: (it && typeof it === 'object')
            ? (it.creatorsText || creatorsToText(it.creators || []))
            : ''
        }));
        PUBS_FETCHED_AT = payload.fetchedAt || new Date().toISOString();
      }

      const filtered = applyFilters(PUBS_CACHE);
      renderList(filtered);

      if (elMeta) {
        const ts = PUBS_FETCHED_AT ? new Date(PUBS_FETCHED_AT) : new Date();
        elMeta.textContent = `MAJ: ${ts.toLocaleString('fr-FR')} · source: Zotero`;
      }
      setStatus('✅ ' + filtered.length + ' référence(s) affichée(s).');
    } catch (e) {
      setStatus(
        '❌ Publications non chargées.\n' +
        '👉 Teste: /.netlify/functions/public-suivi\n' +
        'Détail: ' + String(e?.message || e),
        false
      );
      if (elMeta) elMeta.textContent = '';
      if (elPubList) elPubList.innerHTML = '';
      if (elPubCount) elPubCount.textContent = '0 référence';
      console.error('[CV] refresh error:', e);
    } finally {
      if (btnRefresh) btnRefresh.disabled = false;
    }
  }

  // ---------- Save button
  function saveAllTexts() {
    saveAllMdBlocksNow();
    saveInline();
    setStatus('✅ Textes sauvegardés (' + nowFr() + ').');
  }

  // ---------- Events
  btnRefresh?.addEventListener('click', () => refresh(true));
  btnSaveText?.addEventListener('click', saveAllTexts);
  btnExportHtml?.addEventListener('click', exportHtml);
  btnExportPdf?.addEventListener('click', exportPdf);
  btnExportDocx?.addEventListener('click', exportDocx);

  // Auto refresh on filter change (debounced)
  let t = null;
  const schedule = () => {
    saveFilters();
    clearTimeout(t);
    t = setTimeout(() => {
      const authorQuery = elAuthor?.value || '';
      if (!hasFullNameQuery(authorQuery)) {
        if (elPubList) {
          elPubList.innerHTML =
            '<li style="color:var(--muted)">' +
            'Tapez <b>Nom Prénom</b> dans le filtre <b>Auteur</b> pour charger les publications.' +
            '</li>';
        }
        if (elPubCount) elPubCount.textContent = '—';
        if (elMeta) elMeta.textContent = '';
        setStatus('ℹ️ Publications non chargées (saisir Nom + Prénom dans Auteur).');
        return;
      }
      refresh(false);
    }, 250);
  };

  [elAuthor, elYearMin, elYearMax, elOnlyPubs, elSort].forEach((el) => {
    el?.addEventListener('input', schedule);
    el?.addEventListener('change', schedule);
  });

  $('#cvName')?.addEventListener('blur', saveInline);
  $('#cvContact')?.addEventListener('blur', saveInline);

  // ---------- Init
  loadInline();
  loadFilters();
  initMdBlocks();
  refresh();
})();
