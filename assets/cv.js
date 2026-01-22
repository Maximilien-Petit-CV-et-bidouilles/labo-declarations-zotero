/* ==========================================================
   assets/cv.js — Option 2a (Markdown blocks in-CV) + DOCX Markdown
   - Publications via /.netlify/functions/public-suivi
   - Filtres + tri
   - Blocs texte en Markdown (Edit/Aperçu) sauvegardés en localStorage
   - Export HTML / PDF (html2pdf) / DOCX (docx) avec **gras**, *italique*, listes, liens
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
  const elMeta = $('#cvMeta');
  const elPubList = $('#pubList');
  const elPubCount = $('#pubCount');
  const elCvRoot = $('#cvRoot');

  const FILTER_KEY = 'dlab.cv.filters.v3';
  const MD_KEY = 'dlab.cv.mdblocks.v1';
  const INLINE_KEY = 'dlab.cv.inline.v1'; // cvName / cvContact

  // Publications cache (évite de recharger si on retouche uniquement les filtres)
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

  // ---------- Creators helpers (authors string)
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
    // évite de déclencher sur "a b" : au moins 2 caractères par token
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

  // ---------- Markdown rendering (safe-ish)
  function mdToHtml(md) {
    const src = String(md || '');
    if (window.marked && typeof window.marked.parse === 'function') {
      // Simple guard: remove raw HTML tags before parsing
      const noHtml = src.replace(/<[^>]*>/g, '');
      return window.marked.parse(noHtml, { gfm: true, breaks: true });
    }
    return escapeHtml(src).replace(/\n/g, '<br>');
  }

  // ---------- Persist inline (Name / Contact)
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

  // ---------- Data fetch
  async function fetchPublicItems() {
    // ⚠️ On utilise la pagination (100/page) pour éviter un gros JSON d'un coup.
    // Cette fonction est appelée uniquement quand l'utilisateur a saisi "Nom Prénom".
    const limit = 100;
    let start = 0;
    const MAX_ITEMS = 10000;

    const all = [];
    let fetchedAt = new Date().toISOString();
    let totalResults = null;

    while (true) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      const text = await res.text();

      if (!res.ok) throw new Error('Function public-suivi: HTTP ' + res.status + ' – ' + text.slice(0, 500));

      let json;
      try { json = JSON.parse(text); }
      catch { throw new Error('Réponse JSON invalide depuis public-suivi : ' + text.slice(0, 200)); }

      // compat ancien format
      if (Array.isArray(json)) {
        return { items: json, fetchedAt: new Date().toISOString() };
      }

      if (!json || !Array.isArray(json.items)) {
        throw new Error('Format inattendu depuis public-suivi (pas de items[]).');
      }

      fetchedAt = json.fetchedAt || fetchedAt;
      if (typeof json.totalResults === 'number') totalResults = json.totalResults;

      all.push(...json.items);

      const hasMore = !!json.hasMore;
      const nextStart = (json.nextStart !== undefined && json.nextStart !== null) ? Number(json.nextStart) : null;

      if (!hasMore || nextStart === null) break;

      start = nextStart;
      if (all.length >= MAX_ITEMS) break;
    }

    return { items: all, fetchedAt, totalResults };
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
    return yb - ya; // date_desc
  }

  function applyFilters(items) {
    const author = elAuthor.value || '';
    const yMin = parseInt(elYearMin.value, 10);
    const yMax = parseInt(elYearMax.value, 10);
    const hasMin = Number.isFinite(yMin);
    const hasMax = Number.isFinite(yMax);
    const onlyPubs = (elOnlyPubs.value || 'yes') === 'yes';

    const sort = elSort.value || 'date_desc';

    const out = (items || [])
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

    return out;
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
    const list = elPubList;
    if (!list) return;

    const arr = Array.isArray(items) ? items : [];
    list.innerHTML = arr.map(it => `<li>${formatOne(it)}</li>`).join('');

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
    try {
      localStorage.setItem(MD_KEY, JSON.stringify(state || {}));
    } catch {}
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

      // Toggle edit/preview
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

  // ---------- Export HTML
  function exportHtml() {
    try {
      saveAllMdBlocksNow();
      saveInline();
      setStatus('⏳ Génération HTML…');

      const html = '<!doctype html>\n' + document.documentElement.outerHTML;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const name = $('#cvName')?.textContent || 'cv';
      downloadBlob(blob, safeFilenameBase(name) + '.html');

      setStatus('✅ Export HTML généré.');
    } catch (e) {
      setStatus('❌ Export HTML impossible : ' + (e?.message || e), false);
      console.error('[CV] exportHtml error:', e);
    }
  }

  // ---------- Export PDF
  async function exportPdf() {
    try {
      saveAllMdBlocksNow();
      saveInline();
      setStatus('⏳ Génération PDF…');

      if (!window.html2pdf) throw new Error('html2pdf.js introuvable (CDN).');

      const name = $('#cvName')?.textContent || 'cv';
      const opt = {
        margin: [8, 8, 8, 8],
        filename: safeFilenameBase(name) + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      // Clone to avoid UI buttons etc.
      const clone = elCvRoot ? elCvRoot.cloneNode(true) : document.body.cloneNode(true);

      // Remove controls in clone
      clone.querySelectorAll('.controls, .adminbar, button, .mdtoggle').forEach(n => n.remove());
      // Ensure textareas replaced by preview
      clone.querySelectorAll('textarea.mdedit').forEach(n => n.remove());

      await window.html2pdf().set(opt).from(clone).save();

      setStatus('✅ Export PDF généré.');
    } catch (e) {
      setStatus('❌ Export PDF impossible : ' + (e?.message || e), false);
      console.error('[CV] exportPdf error:', e);
    }
  }

  // ---------- DOCX helpers: inline markdown -> docx runs
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

      // headings
      const h = l.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        flushPara();
        blocks.push({ type: 'heading', level: h[1].length, text: h[2] });
        continue;
      }

      // bullets
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
    // Supports **bold**, *italic*, and [link](url) (very small subset)
    const { TextRun, ExternalHyperlink } = window.docx || {};
    if (!TextRun) return [];

    const s = String(text || '');

    // Tokenize links first
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
      // parse **bold** and *italic* in plain text chunk
      const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
      let i = 0;
      let m;
      while ((m = re.exec(chunk))) {
        if (m.index > i) out.push(new TextRun({ text: chunk.slice(i, m.index) }));
        const token = m[0];
        if (token.startsWith('**')) {
          out.push(new TextRun({ text: token.slice(2, -2), bold: true }));
        } else if (token.startsWith('*')) {
          out.push(new TextRun({ text: token.slice(1, -1), italics: true }));
        }
        i = m.index + token.length;
      }
      if (i < chunk.length) out.push(new TextRun({ text: chunk.slice(i) }));
    };

    for (const p of parts) {
      if (p.type === 'text') {
        pushInline(p.value);
      } else if (p.type === 'link' && ExternalHyperlink) {
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

      // Header
      children.push(new Paragraph({
        text: name,
        heading: HeadingLevel.HEADING_1
      }));
      if (contact) {
        children.push(new Paragraph({
          children: [new TextRun({ text: contact })]
        }));
      }
      children.push(new Paragraph({ text: ' ' }));

      // Markdown blocks (in order)
      const blocks = document.querySelectorAll('[data-mdblock]');
      const state = readMdState();

      for (const wrap of blocks) {
        const key = wrap.getAttribute('data-mdblock');
        const title = wrap.querySelector('h3')?.textContent || '';
        const md = (key && typeof state[key] === 'string') ? state[key] : (wrap.querySelector('textarea.mdedit')?.value || '');

        if (title) {
          children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }));
        }

        const parts = splitMarkdownBlocks(md);

        for (const part of parts) {
          if (part.type === 'bullet') {
            children.push(new Paragraph({
              children: runsFromInlineMarkdown(part.text),
              bullet: { level: 0 }
            }));
            continue;
          }

          if (part.type === 'heading') {
            const level = part.level === 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
            children.push(new Paragraph({ text: part.text, heading: level }));
            continue;
          }

          children.push(new Paragraph({
            children: runsFromInlineMarkdown(part.text || '')
          }));
        }

        children.push(new Paragraph({ text: ' ' }));
      }

      // Publications as list
      const pubs = Array.from(elPubList?.querySelectorAll('li') || []).map(li => li.textContent || '').filter(Boolean);
      if (pubs.length) {
        children.push(new Paragraph({ text: 'Productions principales en recherche', heading: HeadingLevel.HEADING_2 }));
        for (const p of pubs) {
          children.push(new Paragraph({ text: p, bullet: { level: 0 } }));
        }
      }

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, safeFilenameBase(name) + '.docx');
      setStatus('✅ Export DOCX généré (Markdown conservé).');
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
      // ✅ Pas de chargement tant qu'on n'a pas "Nom Prénom"
      if (elPubList) {
        elPubList.innerHTML = '<li style="color:var(--muted)">' +
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

      // ✅ charge Zotero une seule fois (ou si force=true)
      if (force || !PUBS_CACHE) {
        const payload = await fetchPublicItems();
        const items = Array.isArray(payload.items) ? payload.items : [];

        // ✅ réinjecte creatorsText si l’API ne le fournit pas
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

      if (elMeta) elMeta.textContent = 'MAJ: ' + nowFr() + ' · source: Zotero';
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
    setStatus('✅ Textes Markdown sauvegardés (' + nowFr() + ').');
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
        // Pas de fetch : on affiche juste un hint + vide
        if (elPubList) {
          elPubList.innerHTML = '<li style="color:var(--muted)">' +
            'Tapez <b>Nom Prénom</b> dans le filtre <b>Auteur</b> pour charger les publications.' +
            '</li>';
        }
        if (elPubCount) elPubCount.textContent = '—';
        if (elMeta) elMeta.textContent = '';
        setStatus('ℹ️ Publications non chargées (saisir Nom + Prénom dans Auteur).');
        return;
      }
      // Auteur OK : on applique filtres (et charge si besoin)
      refresh(false);
    }, 250);
  };
  [elAuthor, elYearMin, elYearMax, elOnlyPubs, elSort].forEach((el) => {
    el?.addEventListener('input', schedule);
    el?.addEventListener('change', schedule);
  });

  // Save inline on blur
  $('#cvName')?.addEventListener('blur', saveInline);
  $('#cvContact')?.addEventListener('blur', saveInline);

  // ---------- Init
  loadInline();
  loadFilters();
  initMdBlocks();
  refresh();
})();
