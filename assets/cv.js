/* ==========================================================
   assets/cv.js — CV generator
   - Publications via /.netlify/functions/public-suivi (paged)
   - Markdown blocks editable + saved in localStorage
   - Exports: HTML / PDF / DOCX
   ========================================================== */

(() => {
  'use strict';

  // ---------- Helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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
  function safeFilenameBase(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return base || 'cv';
  }
  function nowFr() {
    return new Date().toLocaleString('fr-FR');
  }

  // ---------- Elements
  const btnRefresh = $('#refreshBtn');
  const btnSaveText = $('#saveTextBtn');
  const btnExportHtml = $('#exportHtmlBtn');
  const btnExportPdf = $('#exportPdfBtn');
  const btnExportDocx = $('#exportDocxBtn');

  const elName = $('#cvName');
  const elContact = $('#cvContact');
  const elMeta = $('#cvMeta');
  const elStatus = $('#cv-status');

  const elAuthor = $('#authorFilter');
  const elYearMin = $('#yearMin');
  const elYearMax = $('#yearMax');
  const elOnlyPubs = $('#onlyPublications');
  const elSort = $('#sortMode');

  const elPubList = $('#pubList');
  const elPubCount = $('#pubCount');

  // ---------- Storage keys
  const LS_INLINE = 'cv.inline.v3';
  const LS_MD = 'cv.mdblocks.v3';
  const LS_FILTERS = 'cv.filters.v3';

  // ---------- Status
  function setStatus(msg, ok = true) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.className = 'status ' + (ok ? 'ok' : 'err');
  }

  // ---------- Filters
  function hasFullNameQuery(q) {
    const tokens = norm(q).split(' ').filter(Boolean);
    return tokens.length >= 2 && tokens.every(t => t.length >= 2);
  }

  function loadFilters() {
    try {
      const raw = localStorage.getItem(LS_FILTERS);
      if (!raw) return;
      const f = JSON.parse(raw);
      if (elAuthor && typeof f.author === 'string') elAuthor.value = f.author;
      if (elYearMin && typeof f.yearMin === 'string') elYearMin.value = f.yearMin;
      if (elYearMax && typeof f.yearMax === 'string') elYearMax.value = f.yearMax;
      if (elOnlyPubs && typeof f.onlyPubs === 'string') elOnlyPubs.value = f.onlyPubs;
      if (elSort && typeof f.sort === 'string') elSort.value = f.sort;
    } catch {}
  }
  function saveFilters() {
    try {
      const f = {
        author: elAuthor?.value || '',
        yearMin: elYearMin?.value || '',
        yearMax: elYearMax?.value || '',
        onlyPubs: elOnlyPubs?.value || 'yes',
        sort: elSort?.value || 'date_desc'
      };
      localStorage.setItem(LS_FILTERS, JSON.stringify(f));
    } catch {}
  }

  // ---------- Inline blocks (Name / contact)
  function loadInline() {
    try {
      const raw = localStorage.getItem(LS_INLINE);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (elName && typeof data.name === 'string') elName.textContent = data.name;
      if (elContact && typeof data.contact === 'string') elContact.textContent = data.contact;
    } catch {}
  }
  function saveInline() {
    try {
      localStorage.setItem(LS_INLINE, JSON.stringify({
        name: elName?.textContent?.trim() || '',
        contact: elContact?.textContent?.trim() || ''
      }));
    } catch {}
  }

  // ---------- Markdown blocks
  function getMdBlocks() {
    return $$('section[data-mdblock]').map(sec => {
      return {
        key: sec.getAttribute('data-mdblock'),
        sec,
        toggle: sec.querySelector('.mdtoggle'),
        edit: sec.querySelector('.mdedit'),
        preview: sec.querySelector('.mdpreview')
      };
    }).filter(b => b.key && b.toggle && b.edit && b.preview);
  }

  function renderMarkdown(md) {
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(md || '');
    }
    // fallback
    return '<pre>' + String(md || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;') + '</pre>';
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
    } catch {}
  }

  function saveAllMdBlocksNow() {
    const out = {};
    for (const b of getMdBlocks()) out[b.key] = b.edit.value || '';
    try { localStorage.setItem(LS_MD, JSON.stringify(out)); } catch {}
  }

  function initMdBlocks() {
    const blocks = getMdBlocks();
    for (const b of blocks) {
      updatePreview(b);
      showEdit(b, false);
      b.toggle.addEventListener('click', () => {
        const nowEdit = b.edit.hidden;
        showEdit(b, nowEdit);
        if (!nowEdit) updatePreview(b);
      });
      b.edit.addEventListener('input', () => updatePreview(b));
    }
    loadMdBlocks();
  }

  // ---------- Publications
  let PUBS_CACHE = null;
  let PUBS_FETCHED_AT = null;

  function creatorsToText(creators) {
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

  function extractYear(dateStr) {
    const m = String(dateStr || '').match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : null;
  }

  function matchesAuthor(creatorsText, query) {
    const q = norm(query);
    if (!q) return true;
    const hay = norm(creatorsText || '');
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(t => hay.includes(t));
  }

  function isPublicationType(t) {
    return t === 'book' || t === 'bookSection' || t === 'journalArticle' || t === 'conferencePaper';
  }

  async function fetchPublicItems() {
    const all = [];
    let start = 0;
    const limit = 200;

    for (let guard = 0; guard < 200; guard++) {
      const url = `/.netlify/functions/public-suivi?start=${start}&limit=${limit}`;
      const r = await fetch(url, { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Erreur serveur (${r.status})`);
      const items = Array.isArray(data.items) ? data.items : [];
      all.push(...items);
      if (!data.hasMore) break;
      if (!items.length) break;
      start += items.length;
    }
    return { items: all, fetchedAt: new Date().toISOString() };
  }

  function formatCitation(it) {
    const authors = (it.creatorsText || '').trim();
    const year = extractYear(it.date);
    const title = String(it.title || '').trim();
    const t = it.itemType;

    const esc = (s) => String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");

    const parts = [];
    if (authors) parts.push(esc(authors) + (year ? ` (${year}).` : '.'));
    else if (year) parts.push(`(${year}).`);

    if (title) parts.push(`<span class="t">${esc(title)}</span>.`);

    if (t === 'journalArticle') {
      const j = String(it.publicationTitle || '').trim();
      const vol = String(it.volume || '').trim();
      const iss = String(it.issue || '').trim();
      const pages = String(it.pages || '').trim();
      const doi = String(it.doi || '').trim();
      const tail = [];
      if (j) tail.push(`<i>${esc(j)}</i>`);
      if (vol) tail.push(`vol. ${esc(vol)}`);
      if (iss) tail.push(`n° ${esc(iss)}`);
      if (pages) tail.push(`pp. ${esc(pages)}`);
      if (doi) tail.push(`DOI: ${esc(doi)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'book') {
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const isbn = String(it.isbn || '').trim();
      const tail = [];
      if (place) tail.push(esc(place));
      if (publisher) tail.push(esc(publisher));
      if (isbn) tail.push(`ISBN: ${esc(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'bookSection') {
      const bookTitle = String(it.bookTitle || '').trim();
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const pages = String(it.pages || '').trim();
      const isbn = String(it.isbn || '').trim();
      const tail = [];
      if (bookTitle) tail.push(`Dans : <i>${esc(bookTitle)}</i>`);
      const ed = [];
      if (place) ed.push(esc(place));
      if (publisher) ed.push(esc(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push(`pp. ${esc(pages)}`);
      if (isbn) tail.push(`ISBN: ${esc(isbn)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    } else if (t === 'conferencePaper') {
      const conf = String(it.conferenceName || '').trim();
      const publisher = String(it.publisher || '').trim();
      const place = String(it.place || '').trim();
      const pages = String(it.pages || '').trim();
      const tail = [];
      if (conf) tail.push(`<i>${esc(conf)}</i>`);
      const ed = [];
      if (place) ed.push(esc(place));
      if (publisher) ed.push(esc(publisher));
      if (ed.length) tail.push(ed.join(', '));
      if (pages) tail.push(`pp. ${esc(pages)}`);
      if (tail.length) parts.push(tail.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function applyFilters(items) {
    const authorQuery = elAuthor?.value || '';
    const minY = parseInt(elYearMin?.value || '', 10);
    const maxY = parseInt(elYearMax?.value || '', 10);
    const hasMin = Number.isFinite(minY);
    const hasMax = Number.isFinite(maxY);
    const only = (elOnlyPubs?.value || 'yes') === 'yes';
    const sort = elSort?.value || 'date_desc';

    let arr = (items || [])
      .map(it => ({
        ...it,
        creatorsText: it.creatorsText || creatorsToText(it.creators || [])
      }))
      .filter(it => !only || isPublicationType(it.itemType))
      .filter(it => matchesAuthor(it.creatorsText, authorQuery));

    if (hasMin || hasMax) {
      arr = arr.filter(it => {
        const y = extractYear(it.date);
        if (!y) return true;
        if (hasMin && y < minY) return false;
        if (hasMax && y > maxY) return false;
        return true;
      });
    }

    arr.sort((a, b) => {
      const ya = extractYear(a.date) || 0;
      const yb = extractYear(b.date) || 0;
      if (sort === 'date_desc') {
        if (yb !== ya) return yb - ya;
        return String(b.date || '').localeCompare(String(a.date || ''));
      }
      if (sort === 'date_asc') {
        if (ya !== yb) return ya - yb;
        return String(a.date || '').localeCompare(String(b.date || ''));
      }
      if (sort === 'title_asc') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' });
      }
      return 0;
    });

    return arr;
  }

  function renderPublications(items) {
    const arr = Array.isArray(items) ? items : [];
    if (elPubCount) elPubCount.textContent = arr.length + ' référence(s)';
    if (!elPubList) return;
    elPubList.innerHTML = arr.map(it => `<li>${formatCitation(it)}</li>`).join('');
  }

  // ---------- Exports (HTML/DOCX sont OK: on ne touche plus)
  function buildExportDocumentHtml() {
    // Ensure previews are up to date
    for (const b of getMdBlocks()) updatePreview(b);

    // Clone the CV root
    const root = $('#cvRoot');
    const clone = root.cloneNode(true);

    // Remove status/meta/toolbars
    clone.querySelector('#cvMeta')?.remove();
    clone.querySelector('#cv-status')?.remove();
    clone.querySelectorAll('.mdtabs')?.forEach(n => n.remove());
    clone.querySelectorAll('textarea.mdedit')?.forEach(n => n.remove());
    clone.querySelectorAll('[contenteditable]')?.forEach(n => n.removeAttribute('contenteditable'));

    const title = (elName?.textContent || 'CV').trim() || 'CV';

    // Inline styles
    const styles = $$('style').map(s => s.textContent || '').join('\n');

    const html = `
      <div class="page" style="width:210mm; padding:12mm 14mm; box-sizing:border-box; background:#fff;">
        ${clone.outerHTML}
      </div>
      <style>
        ${styles}
        /* force export clean (no controls/status) */
        #cv-status, #cvMeta, .toolbar, .controls, .status { display:none !important; }
        .cv{ border:none !important; border-radius:0 !important; background:transparent !important; padding:0 !important; }
        .mdblock{ border:none !important; background:transparent !important; padding:0 !important; }
      </style>
    `;

    return { html, title };
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

  async function exportHtml() {
    try {
      const { html, title } = buildExportDocumentHtml();
      const filename = safeFilenameBase(title) + '.html';
      const out = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body>${html}</body></html>`;
      downloadBlob(new Blob([out], { type: 'text/html;charset=utf-8' }), filename);
      setStatus('✅ Export HTML généré.');
    } catch (e) {
      setStatus('❌ Export HTML impossible : ' + (e?.message || e), false);
      console.error('[CV] exportHtml error:', e);
    }
  }

  // ---------- Export PDF (robuste)
  // - utilise html2pdf (déjà présent via CDN)
  // - évite les "pages blanches" en rendant le contenu dans le viewport (quasi invisible)
  // - expose aussi exportPDF() pour compatibilité (anciens boutons)
  async function exportPdf() {
    let host = null;
    try {
      if (!window.html2pdf) throw new Error('html2pdf.js introuvable (CDN).');

      const { html, title } = buildExportDocumentHtml();
      setStatus('⏳ Génération PDF…');

      // Host dans le viewport (pas hors écran), sinon html2canvas peut capturer du vide.
      host = document.createElement('div');
      host.id = 'pdf-export-host';
      host.style.position = 'fixed';
      host.style.left = '0';
      host.style.top = '0';
      host.style.width = '210mm';          // A4
      host.style.background = '#fff';
      host.style.color = '#111';
      host.style.opacity = '0.01';         // IMPORTANT: pas 0
      host.style.pointerEvents = 'none';
      host.style.zIndex = '999999';
      host.style.boxSizing = 'border-box';

      host.innerHTML = html;
      document.body.appendChild(host);

      const exportRoot = host.querySelector('.page') || host;
      // Stabiliser fonts + layout
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const opt = {
        margin: [8, 8, 8, 8],
        filename: safeFilenameBase(title) + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          scrollX: 0,
          // si l'utilisateur a scrollé, ça évite un canvas vide selon les navigateurs
          scrollY: -window.scrollY
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };

      await window.html2pdf().set(opt).from(exportRoot).save();

      setStatus('✅ Export PDF (pandoc-like) généré.');
    } catch (e) {
      setStatus('❌ Export PDF impossible : ' + (e?.message || e), false);
      console.error('[CV] exportPdf error:', e);
    } finally {
      try { host?.remove(); } catch {}
    }
  }

  // Compat: certains anciens boutons/appels utilisent exportPDF()
  function exportPDF() { return exportPdf(); }
  window.exportPDF = exportPdf;
  window.exportPdf = exportPdf;

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

    for (const ln of lines) {
      if (/^\s*[-*]\s+/.test(ln)) {
        flushPara();
        blocks.push({ type: 'li', text: ln.replace(/^\s*[-*]\s+/, '') });
      } else if (/^\s*$/.test(ln)) {
        flushPara();
      } else {
        buf.push(ln);
      }
    }
    flushPara();
    return blocks;
  }

  function htmlToRuns(node, style) {
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
    const next = { ...cur };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italics = true;

    if (tag === 'br') {
      runs.push(new TextRun({ text: '\n', bold: cur.bold, italics: cur.italics }));
      return runs;
    }

    if (tag === 'a') {
      const text = node.textContent || '';
      if (text) runs.push(new TextRun({ text, bold: next.bold, italics: next.italics }));
      return runs;
    }

    for (const child of Array.from(node.childNodes)) {
      runs.push(...htmlToRuns(child, next));
    }
    return runs;
  }

  function parseHtmlToNodes(html) {
    const dp = new DOMParser();
    const doc = dp.parseFromString(`<div>${html || ''}</div>`, 'text/html');
    return doc.body.firstChild ? Array.from(doc.body.firstChild.childNodes) : [];
  }

  function blockToDocxParagraphsFromPreview(previewEl) {
    const { Paragraph } = window.docx;
    const paras = [];

    const nodes = parseHtmlToNodes(previewEl.innerHTML || '');

    function walk(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(node.querySelectorAll(':scope > li'));
          items.forEach(li => walk(li));
          return;
        }

        if (tag === 'li') {
          const runs = [];
          for (const ch of Array.from(node.childNodes)) {
            if (ch.nodeType === Node.ELEMENT_NODE) {
              const ct = ch.tagName.toLowerCase();
              if (ct === 'ul' || ct === 'ol') continue;
            }
            runs.push(...htmlToRuns(ch, { bold: false, italics: false }));
          }
          paras.push(new Paragraph({ children: runs, bullet: { level: 0 }, spacing: { after: 120 } }));
          Array.from(node.childNodes).forEach(ch => {
            if (ch.nodeType === Node.ELEMENT_NODE) {
              const ct = ch.tagName.toLowerCase();
              if (ct === 'ul' || ct === 'ol') walk(ch);
            }
          });
          return;
        }

        if (tag === 'p' || tag === 'div') {
          const runs = htmlToRuns(node, { bold: false, italics: false });
          const textOnly = (node.textContent || '').trim();
          if (runs.length && textOnly) paras.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
          return;
        }
      }

      if ((node.textContent || '').trim()) {
        const runs = htmlToRuns(node, { bold: false, italics: false });
        paras.push(new window.docx.Paragraph({ children: runs, spacing: { after: 120 } }));
      }
    }

    nodes.forEach(n => walk(n));
    return paras;
  }

  async function exportDocx() {
    try {
      if (!window.docx) throw new Error('docx.js introuvable (CDN).');
      const { Document, Packer, Paragraph, TextRun } = window.docx;

      const { html, title } = buildExportDocumentHtml();
      const filename = safeFilenameBase(title) + '.docx';

      // Create a clone root to traverse sections
      const host = document.createElement('div');
      host.innerHTML = html;
      const page = host.querySelector('.page');
      if (!page) throw new Error('Export root introuvable (.page).');

      const children = [];

      const name = (elName?.textContent || '').trim();
      const contact = (elContact?.textContent || '').trim();
      if (name) children.push(new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 36 })], spacing: { after: 120 } }));
      if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact, size: 22 })], spacing: { after: 240 } }));

      const sections = Array.from(page.querySelectorAll('section.section'));
      for (const sec of sections) {
        const h3 = sec.querySelector('h3');
        const heading = h3 ? (h3.textContent || '').trim() : '';
        if (heading) {
          children.push(new Paragraph({ children: [new TextRun({ text: heading, bold: true, size: 26 })], spacing: { before: 160, after: 120 } }));
        }

        const pubs = sec.querySelector('#pubList');
        if (pubs) {
          const lis = Array.from(sec.querySelectorAll('#pubList li'));
          for (const li of lis) {
            const runs = htmlToRuns(li, { bold: false, italics: false });
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
      const blob = await Packer.toBlob(doc);

      if (window.saveAs) window.saveAs(blob, filename);
      else downloadBlob(blob, filename);

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

      const filtered = applyFilters(PUBS_CACHE || []);
      renderPublications(filtered);

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
