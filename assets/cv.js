/* ==========================================================
   assets/cv.js — Option 2a (Markdown blocks in-CV)
   - Publications via /.netlify/functions/public-suivi
   - Filtres + tri
   - Blocs texte en Markdown (Edit/Aperçu) sauvegardés en localStorage
   - Export HTML / PDF (html2pdf) / DOCX
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
      // Prevent raw HTML injection by stripping tags before parsing (simple guard)
      const noHtml = src.replace(/<[^>]*>/g, '');
      return window.marked.parse(noHtml, { gfm: true, breaks: true });
    }
    // Fallback: plain text with <br>
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

  // ---------- Markdown blocks (Option 2a)
  function loadMdStore() {
    try {
      const raw = localStorage.getItem(MD_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveMdStore(store) {
    try {
      localStorage.setItem(MD_KEY, JSON.stringify(store));
    } catch {}
  }

  function getDefaultMd(block) {
    // defaults are stored as HTML-escaped newlines in attribute
    const d = block.getAttribute('data-md-default');
    if (!d) return '';
    return d
      .replace(/&#10;/g, '\n')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function initMdBlocks() {
    const store = loadMdStore();

    document.querySelectorAll('.mdblock[data-md-key]').forEach((block) => {
      const key = block.getAttribute('data-md-key');
      const edit = block.querySelector('.mdedit');
      const preview = block.querySelector('.mdpreview');
      const tabs = block.querySelectorAll('.mdtabs .tab');

      if (!key || !edit || !preview) return;

      const initial = (typeof store[key] === 'string')
        ? store[key]
        : getDefaultMd(block);

      edit.value = initial;
      preview.innerHTML = mdToHtml(initial);

      function setMode(mode) {
        // mode: 'edit' or 'preview'
        tabs.forEach(t => {
          const isActive = t.getAttribute('data-tab') === mode;
          t.classList.toggle('active', isActive);
        });

        if (mode === 'edit') {
          edit.hidden = false;
          preview.hidden = true;
          edit.focus();
        } else {
          preview.hidden = false;
          edit.hidden = true;
        }
      }

      // Default mode: preview
      setMode('preview');

      // Tab click
      tabs.forEach((t) => {
        t.addEventListener('click', () => {
          const mode = t.getAttribute('data-tab');
          if (mode === 'edit') setMode('edit');
          else setMode('preview');
        });
      });

      // Live render while typing (debounced)
      let timer = null;
      edit.addEventListener('input', () => {
        const md = edit.value;
        clearTimeout(timer);
        timer = setTimeout(() => {
          preview.innerHTML = mdToHtml(md);
          store[key] = md;
          saveMdStore(store);
        }, 180);
      });

      // Save on blur
      edit.addEventListener('blur', () => {
        const md = edit.value;
        preview.innerHTML = mdToHtml(md);
        store[key] = md;
        saveMdStore(store);
      });
    });
  }

  function saveAllMdBlocksNow() {
    const store = loadMdStore();
    document.querySelectorAll('.mdblock[data-md-key]').forEach((block) => {
      const key = block.getAttribute('data-md-key');
      const edit = block.querySelector('.mdedit');
      if (!key || !edit) return;
      store[key] = edit.value;
    });
    saveMdStore(store);
  }

  // ---------- Filters persistence
  function loadFilters() {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const f = JSON.parse(raw);
      if (typeof f.author === 'string') elAuthor.value = f.author;
      if (typeof f.yearMin === 'string') elYearMin.value = f.yearMin;
      if (typeof f.yearMax === 'string') elYearMax.value = f.yearMax;
      if (typeof f.onlyPubs === 'string') elOnlyPubs.value = f.onlyPubs;
      if (typeof f.sort === 'string') elSort.value = f.sort;
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
    const url = '/.netlify/functions/public-suivi';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    const text = await res.text();

    if (!res.ok) throw new Error('Function public-suivi: HTTP ' + res.status + ' – ' + text.slice(0, 500));

    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error('Réponse JSON invalide depuis public-suivi : ' + text.slice(0, 200)); }

    if (Array.isArray(json)) return { items: json, fetchedAt: new Date().toISOString() };
    if (json && Array.isArray(json.items)) return json;

    throw new Error('Format inattendu depuis public-suivi (pas de items[]).');
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
    const sortMode = elSort.value || 'date_desc';

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
      .slice()
      .sort((a, b) => compareItems(a, b, sortMode));
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
      const iss = String(item.issue || '').trim();
      const pages = String(item.pages || '').trim();

      let jPart = '';
      if (j) jPart += '<em>' + escapeHtml(j) + '</em>';
      const vPart = [vol, iss ? '(' + iss + ')' : ''].filter(Boolean).join('');
      if (vPart) jPart += (jPart ? ', ' : '') + escapeHtml(vPart);
      if (pages) jPart += (jPart ? ', ' : '') + 'p. ' + escapeHtml(pages);
      if (jPart) parts.push(jPart + '.');

      const doi = String(item.doi || '').trim();
      if (doi) parts.push('DOI: ' + escapeHtml(doi) + '.');
    } else if (it === 'bookSection') {
      const bt = String(item.bookTitle || '').trim();
      const pages = String(item.pages || '').trim();
      if (bt) {
        let s = 'In <em>' + escapeHtml(bt) + '</em>';
        if (pages) s += ', p. ' + escapeHtml(pages);
        s += '.';
        parts.push(s);
      }
      const pub = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pp = [place, pub].filter(Boolean).join(' : ');
      if (pp) parts.push(escapeHtml(pp) + '.');
    } else if (it === 'book') {
      const pub = String(item.publisher || '').trim();
      const place = String(item.place || '').trim();
      const pp = [place, pub].filter(Boolean).join(' : ');
      if (pp) parts.push(escapeHtml(pp) + '.');
    }

    return parts.join(' ');
  }

  function renderList(items) {
    elPubList.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const li = document.createElement('li');
      li.innerHTML = formatOne(it);
      frag.appendChild(li);
    }
    elPubList.appendChild(frag);

    const n = items.length;
    elPubCount.textContent = n + (n > 1 ? ' références' : ' référence');
  }

  // ---------- Build export clone with Markdown preview applied
  function buildExportClone() {
    const clone = elCvRoot.cloneNode(true);

    // Replace mdblocks by their preview content only
    clone.querySelectorAll('.mdblock').forEach((b) => {
      const prev = b.querySelector('.mdpreview');
      const edit = b.querySelector('.mdedit');
      const tabs = b.querySelector('.mdtabs');
      if (tabs) tabs.remove();
      if (edit) edit.remove();

      if (prev) {
        // Ensure preview visible
        prev.hidden = false;
      }
      // Keep b container but remove its border in exports
      b.style.border = 'none';
      b.style.padding = '0';
    });

    // Remove pills in exports
    clone.querySelectorAll('.pill').forEach(n => n.remove());

    return clone;
  }

  // ---------- Export HTML
  function buildStandaloneHtmlFromClone(clone) {
    const name = ($('#cvName')?.textContent || 'CV').trim();
    const styles = document.querySelector('style')?.textContent || '';
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)} – CV</title>
  <style>${styles}</style>
</head>
<body>
  <div class="page">${clone.outerHTML}</div>
</body>
</html>`;
  }

  function exportHtml() {
    try {
      const clone = buildExportClone();
      const html = buildStandaloneHtmlFromClone(clone);
      const name = ($('#cvName')?.textContent || 'cv').trim();
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeFilenameBase(name) + '.html');
      setStatus('✅ Export HTML généré.');
    } catch (e) {
      setStatus('❌ Export HTML impossible : ' + (e?.message || e), false);
      console.error('[CV] exportHtml error:', e);
    }
  }

  // ---------- Export PDF (html2pdf) — FIX page blanche
  async function exportPdf() {
    let wrap = null;
    try {
      if (!window.html2pdf) {
        setStatus('❌ Export PDF impossible : html2pdf.js ne s’est pas chargé (CDN bloqué ?).', false);
        return;
      }
      if (!elCvRoot) {
        setStatus('❌ Export PDF impossible : zone CV introuvable (#cvRoot).', false);
        return;
      }

      setStatus('⏳ Génération du PDF…');

      const clone = buildExportClone();
      clone.style.border = 'none';
      clone.style.borderRadius = '0';
      clone.style.padding = '0';
      clone.style.background = '#fff';
      clone.style.boxShadow = 'none';

      // Avoid breaks inside publication items
      clone.querySelectorAll('#pubList li').forEach(li => {
        li.style.breakInside = 'avoid';
        li.style.pageBreakInside = 'avoid';
      });

      // Wrapper in viewport but invisible (avoid blank canvas)
      wrap = document.createElement('div');
      wrap.style.position = 'absolute';
      wrap.style.left = '0';
      wrap.style.top = '0';
      wrap.style.width = '794px';
      wrap.style.padding = '24px';
      wrap.style.background = '#fff';
      wrap.style.opacity = '0';
      wrap.style.pointerEvents = 'none';
      wrap.style.zIndex = '-1';
      wrap.appendChild(clone);
      document.body.appendChild(wrap);

      // let browser paint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const name = ($('#cvName')?.textContent || 'CV').trim();
      const filename = safeFilenameBase(name) + '.pdf';

      const opt = {
        margin: [10, 10, 12, 10], // mm
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      await window.html2pdf().set(opt).from(clone).save();

      setStatus('✅ PDF généré.');
    } catch (e) {
      setStatus('❌ Export PDF impossible : ' + (e?.message || e), false);
      console.error('[CV] exportPdf error:', e);
    } finally {
      try { if (wrap && wrap.remove) wrap.remove(); } catch {}
    }
  }

  // ---------- Export DOCX (riche)
  async function exportDocx() {
    try {
      if (!window.docx || !window.docx.Document) {
        setStatus('❌ La bibliothèque DOCX ne s’est pas chargée (CDN bloqué ?).', false);
        return;
      }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

      const name = ($('#cvName')?.textContent || 'Nom Prénom').trim();
      const contact = ($('#cvContact')?.textContent || '').trim();

      // Helper: get markdown source for a mdblock by key
      const mdStore = loadMdStore();
      function mdText(key) {
        if (typeof mdStore[key] === 'string') return mdStore[key].trim();
        // fallback: read current textarea
        const b = document.querySelector(`.mdblock[data-md-key="${CSS.escape(key)}"]`);
        const t = b?.querySelector('.mdedit');
        return (t?.value || '').trim();
      }

      // Convert markdown to plain text for DOCX (lightweight)
      function mdToPlain(md) {
        // very simple: remove links formatting, emphasis, code fences
        let t = String(md || '');
        t = t.replace(/\r/g, '');
        t = t.replace(/`{3}[\s\S]*?`{3}/g, '');          // fenced code blocks
        t = t.replace(/`([^`]+)`/g, '$1');              // inline code
        t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'); // links
        t = t.replace(/\*\*([^*]+)\*\*/g, '$1');        // bold
        t = t.replace(/\*([^*]+)\*/g, '$1');            // italic
        t = t.replace(/#+\s*/g, '');                    // headings
        return t.trim();
      }

      // For lists: lines starting with "- " become separate paragraphs
      function paragraphsFromMd(md) {
        const plain = mdToPlain(md);
        const lines = plain.split('\n').map(x => x.trim());
        const out = [];
        for (const line of lines) {
          if (!line) continue;
          if (/^[-*]\s+/.test(line)) out.push(line.replace(/^[-*]\s+/, '• '));
          else out.push(line);
        }
        return out;
      }

      const sections = [
        { title: 'Présentation', lines: paragraphsFromMd(mdText('cv.presentation')) },
        { title: 'Titres et fonctions', lines: paragraphsFromMd(mdText('cv.titles')) },
        { title: 'Principaux diplômes', lines: paragraphsFromMd(mdText('cv.degrees')) },
        { title: 'Productions principales en recherche', lines: (elPubList?.innerText || '').split('\n').map(x => x.trim()).filter(Boolean) },
        { title: 'Investissement pédagogique et diffusion de la connaissance', lines: paragraphsFromMd(mdText('cv.teaching')) },
      ];

      const children = [];
      children.push(new Paragraph({ text: name, heading: HeadingLevel.TITLE }));
      if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact })] }));
      children.push(new Paragraph({ text: ' ' }));

      for (const s of sections) {
        if (!s.lines || s.lines.length === 0) continue;
        children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
        for (const line of s.lines) {
          children.push(new Paragraph({ children: [new TextRun(line)] }));
        }
        children.push(new Paragraph({ text: ' ' }));
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
  async function refresh() {
    saveFilters();
    setStatus('⏳ Récupération des publications…');

    try {
      if (btnRefresh) btnRefresh.disabled = true;

      const payload = await fetchPublicItems();
      const items = Array.isArray(payload.items) ? payload.items : [];
      const filtered = applyFilters(items);

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
  btnRefresh?.addEventListener('click', refresh);
  btnSaveText?.addEventListener('click', saveAllTexts);
  btnExportHtml?.addEventListener('click', exportHtml);
  btnExportPdf?.addEventListener('click', exportPdf);
  btnExportDocx?.addEventListener('click', exportDocx);

  // Auto refresh on filter change (debounced)
  let t = null;
  const schedule = () => {
    saveFilters();
    clearTimeout(t);
    t = setTimeout(() => refresh(), 250);
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
