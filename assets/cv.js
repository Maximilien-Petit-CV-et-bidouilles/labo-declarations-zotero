/* assets/cv.js
   Générateur de CV connecté au site (Netlify Function public-suivi).
   - Récupère les items Zotero via /.netlify/functions/public-suivi
   - Filtre par auteur + années + type
   - Tri
   - Edition inline des blocs texte + sauvegarde locale
   - Exports: HTML, PDF (print), DOCX
*/

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

  const TEXT_KEY = 'dlab.cv.textBlocks.v1';
  const FILTER_KEY = 'dlab.cv.filters.v1';

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
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
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

  function safeFilename(name) {
    const base = norm(name).replace(/\s+/g, '-').replace(/-+/g, '-');
    return (base || 'cv') + '.html';
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

  // ---------- Text blocks persistence
  function loadTextBlocks() {
    try {
      const raw = localStorage.getItem(TEXT_KEY);
      if (!raw) return;
      const map = JSON.parse(raw);
      document.querySelectorAll('[data-key]').forEach((node) => {
        const k = node.getAttribute('data-key');
        if (!k) return;
        if (typeof map[k] === 'string' && map[k].trim()) node.innerHTML = map[k];
      });
    } catch { /* ignore */ }
  }

  function saveTextBlocks() {
    try {
      const map = {};
      document.querySelectorAll('[data-key]').forEach((node) => {
        const k = node.getAttribute('data-key');
        if (!k) return;
        map[k] = node.innerHTML;
      });
      localStorage.setItem(TEXT_KEY, JSON.stringify(map));
      setStatus('✅ Textes sauvegardés localement (' + nowFr() + ').');
    } catch (e) {
      setStatus('❌ Impossible de sauvegarder les textes : ' + (e?.message || e), false);
    }
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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }

  // ---------- Data fetch
  async function fetchPublicItems() {
    const url = '/.netlify/functions/public-suivi';

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error('Function public-suivi: HTTP ' + res.status + ' – ' + text.slice(0, 500));
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Réponse JSON invalide depuis public-suivi : ' + text.slice(0, 200));
    }

    // Supporte 2 formats : {items:[...]} OU directement [...]
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

  // ---------- Formatting
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

  // ---------- Exports
  function buildStandaloneHtml() {
    const name = ($('#cvName')?.textContent || 'CV').trim();
    const styles = document.querySelector('style')?.textContent || '';
    const body = elCvRoot?.outerHTML || '';

    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)} – CV</title>
  <style>${styles}</style>
</head>
<body>
  <div class="page">${body}</div>
</body>
</html>`;
  }

  function exportHtml() {
    try {
      const html = buildStandaloneHtml();
      const name = ($('#cvName')?.textContent || 'cv').trim();
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeFilename(name));
      setStatus('✅ Export HTML généré.');
    } catch (e) {
      setStatus('❌ Export HTML impossible : ' + (e?.message || e), false);
    }
  }

  function exportPdf() {
    try {
      setStatus('ℹ️ Impression ouverte : choisis “Enregistrer en PDF”.');
      window.print();
    } catch (e) {
      setStatus('❌ Impression/PDF impossible : ' + (e?.message || e), false);
    }
  }

  async function exportDocx() {
    try {
      if (!window.docx || !window.docx.Document) {
        setStatus('❌ La bibliothèque DOCX ne s’est pas chargée (CDN bloqué ?).', false);
        return;
      }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;
      const name = ($('#cvName')?.textContent || 'Nom Prénom').trim();
      const contact = ($('#cvContact')?.textContent || '').trim();

      const blockText = (id) => {
        const el = document.getElementById(id);
        if (!el) return '';
        return el.innerText.replace(/\n{3,}/g, '\n\n').trim();
      };

      const sections = [
        { title: 'Présentation', text: blockText('cvPresentation') },
        { title: 'Titres et fonctions', text: blockText('cvTitles') },
        { title: 'Principaux diplômes', text: blockText('cvDegrees') },
        { title: 'Productions principales en recherche', text: (elPubList?.innerText || '').trim() },
        { title: 'Investissement pédagogique et diffusion de la connaissance', text: blockText('cvTeaching') },
      ];

      const children = [];
      children.push(new Paragraph({ text: name, heading: HeadingLevel.TITLE }));
      if (contact) children.push(new Paragraph({ children: [new TextRun({ text: contact })] }));
      children.push(new Paragraph({ text: ' ' }));

      for (const s of sections) {
        if (!s.text) continue;
        children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
        const lines = s.text.split('\n').map(x => x.trim()).filter(Boolean);
        for (const line of lines) children.push(new Paragraph({ children: [new TextRun(line)] }));
        children.push(new Paragraph({ text: ' ' }));
      }

      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      const filename = safeFilename(name).replace(/\.html$/i, '.docx');
      downloadBlob(blob, filename);
      setStatus('✅ Export DOCX généré.');
    } catch (e) {
      setStatus('❌ Export DOCX impossible : ' + (e?.message || e), false);
    }
  }

  // ---------- Main render
  async function refresh() {
    saveFilters();
    setStatus('⏳ Récupération des publications…');

    try {
      btnRefresh.disabled = true;

      const payload = await fetchPublicItems();
      const items = Array.isArray(payload.items) ? payload.items : [];
      const filtered = applyFilters(items);

      renderList(filtered);

      elMeta.textContent = 'MAJ: ' + nowFr() + ' · source: Zotero';
      setStatus('✅ ' + filtered.length + ' référence(s) affichée(s).');
    } catch (e) {
      setStatus(
        '❌ Publications non chargées.\n' +
        '👉 Teste: /.netlify/functions/public-suivi\n' +
        'Détail: ' + String(e?.message || e),
        false
      );
      elMeta.textContent = '';
      elPubList.innerHTML = '';
      elPubCount.textContent = '0 référence';
    } finally {
      btnRefresh.disabled = false;
    }
  }

  // ---------- Events
  btnRefresh?.addEventListener('click', refresh);
  btnSaveText?.addEventListener('click', saveTextBlocks);
  btnExportHtml?.addEventListener('click', exportHtml);
  btnExportPdf?.addEventListener('click', exportPdf);
  btnExportDocx?.addEventListener('click', exportDocx);

  // auto refresh on filter change (debounced)
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

  // ---------- Init
  loadTextBlocks();
  loadFilters();
  refresh();
})();
