/* ==========================================================
   assets/cv.js
   Générateur de CV connecté au site (Zotero via Netlify)
   - Chargement des publications
   - Filtres (auteur, années, type)
   - Edition inline + localStorage
   - Export HTML / PDF (html2pdf) / DOCX
   ========================================================== */

(function () {
  'use strict';

  /* ---------- Helpers DOM ---------- */
  const $ = (s) => document.querySelector(s);

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

  const TEXT_KEY = 'cv.text.blocks.v1';
  const FILTER_KEY = 'cv.filters.v1';

  /* ---------- Utils ---------- */
  function setStatus(msg, ok = true) {
    elStatus.textContent = msg || '';
    elStatus.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function extractYear(str) {
    const m = String(str || '').match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  }

  function safeName(s) {
    return norm(s).replace(/\s+/g, '-').replace(/-+/g, '-') || 'cv';
  }

  /* ---------- Sauvegarde des blocs texte ---------- */
  function loadTextBlocks() {
    try {
      const raw = localStorage.getItem(TEXT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      document.querySelectorAll('[data-key]').forEach(el => {
        const k = el.dataset.key;
        if (data[k]) el.innerHTML = data[k];
      });
    } catch {}
  }

  function saveTextBlocks() {
    try {
      const data = {};
      document.querySelectorAll('[data-key]').forEach(el => {
        data[el.dataset.key] = el.innerHTML;
      });
      localStorage.setItem(TEXT_KEY, JSON.stringify(data));
      setStatus('✅ Textes sauvegardés.');
    } catch (e) {
      setStatus('❌ Sauvegarde impossible', false);
    }
  }

  /* ---------- Sauvegarde filtres ---------- */
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem(FILTER_KEY));
      if (!f) return;
      elAuthor.value = f.author || '';
      elYearMin.value = f.ymin || '';
      elYearMax.value = f.ymax || '';
      elOnlyPubs.value = f.only || 'yes';
      elSort.value = f.sort || 'date_desc';
    } catch {}
  }

  function saveFilters() {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      author: elAuthor.value,
      ymin: elYearMin.value,
      ymax: elYearMax.value,
      only: elOnlyPubs.value,
      sort: elSort.value
    }));
  }

  /* ---------- Chargement Zotero ---------- */
  async function fetchPublications() {
    const res = await fetch('/.netlify/functions/public-suivi', { cache: 'no-store' });
    if (!res.ok) throw new Error('Erreur Zotero');
    const json = await res.json();
    return Array.isArray(json) ? json : json.items || [];
  }

  /* ---------- Filtres ---------- */
  function isPublication(it) {
    return ['book', 'bookSection', 'journalArticle'].includes(it.itemType);
  }

  function applyFilters(items) {
    const q = norm(elAuthor.value);
    const ymin = parseInt(elYearMin.value, 10);
    const ymax = parseInt(elYearMax.value, 10);
    const only = elOnlyPubs.value === 'yes';

    return items.filter(it => {
      if (only && !isPublication(it)) return false;
      if (q && !norm(it.creatorsText || '').includes(q)) return false;

      const y = extractYear(it.date);
      if (!isNaN(ymin) && (!y || y < ymin)) return false;
      if (!isNaN(ymax) && (!y || y > ymax)) return false;

      return true;
    }).sort((a, b) => {
      if (elSort.value === 'title_asc')
        return (a.title || '').localeCompare(b.title || '', 'fr');
      return (extractYear(b.date) || 0) - (extractYear(a.date) || 0);
    });
  }

  /* ---------- Format publication ---------- */
  function formatPub(it) {
    const parts = [];
    if (it.creatorsText) parts.push(it.creatorsText);
    if (it.date) parts.push('(' + extractYear(it.date) + ')');
    if (it.title) parts.push(`<em>${it.title}</em>`);

    if (it.publicationTitle)
      parts.push(it.publicationTitle);

    if (it.publisher)
      parts.push(it.publisher);

    return parts.join('. ') + '.';
  }

  function renderList(items) {
    elPubList.innerHTML = '';
    items.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = formatPub(it);
      elPubList.appendChild(li);
    });
    elPubCount.textContent = `${items.length} référence${items.length > 1 ? 's' : ''}`;
  }

  /* ---------- Refresh ---------- */
  async function refresh() {
    saveFilters();
    setStatus('⏳ Chargement des publications…');
    try {
      const items = await fetchPublications();
      const filtered = applyFilters(items);
      renderList(filtered);
      elMeta.textContent = 'MAJ : ' + new Date().toLocaleDateString('fr-FR');
      setStatus(`✅ ${filtered.length} référence(s).`);
    } catch (e) {
      setStatus('❌ Impossible de charger Zotero', false);
    }
  }

  /* ---------- EXPORT HTML ---------- */
  function exportHtml() {
    const html = `
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>CV</title>
<style>${document.querySelector('style').innerHTML}</style>
</head>
<body>
<div class="page">${elCvRoot.outerHTML}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName($('#cvName').textContent) + '.html';
    a.click();
    setStatus('✅ Export HTML généré.');
  }

  /* ---------- EXPORT PDF (html2pdf) ---------- */
  async function exportPdf() {
    if (!window.html2pdf) {
      setStatus('❌ html2pdf non chargé', false);
      return;
    }

    setStatus('⏳ Génération du PDF…');

    const clone = elCvRoot.cloneNode(true);
    clone.style.border = 'none';
    clone.style.padding = '0';
    clone.querySelectorAll('.pill').forEach(e => e.remove());

    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-10000px';
    wrap.style.top = '0';
    wrap.style.width = '794px';
    wrap.style.background = '#fff';
    wrap.style.padding = '24px';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);

    await html2pdf().set({
      margin: 10,
      filename: safeName($('#cvName').textContent) + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: '#fff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all'] }
    }).from(wrap).save();

    wrap.remove();
    setStatus('✅ PDF généré.');
  }

  /* ---------- EXPORT DOCX ---------- */
  async function exportDocx() {
    if (!window.docx) {
      setStatus('❌ DOCX non chargé', false);
      return;
    }

    const { Document, Packer, Paragraph, HeadingLevel } = window.docx;

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: $('#cvName').innerText, heading: HeadingLevel.TITLE }),
          new Paragraph($('#cvContact').innerText),
          new Paragraph(''),

          new Paragraph({ text: 'Publications', heading: HeadingLevel.HEADING_1 }),
          ...Array.from(elPubList.children).map(li =>
            new Paragraph(li.innerText)
          )
        ]
      }]
    });

    const blob = await Packer.toBlob(doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName($('#cvName').textContent) + '.docx';
    a.click();

    setStatus('✅ DOCX généré.');
  }

  /* ---------- Events ---------- */
  btnRefresh.onclick = refresh;
  btnSaveText.onclick = saveTextBlocks;
  btnExportHtml.onclick = exportHtml;
  btnExportPdf.onclick = exportPdf;
  btnExportDocx.onclick = exportDocx;

  [elAuthor, elYearMin, elYearMax, elOnlyPubs, elSort].forEach(el => {
    el.addEventListener('change', refresh);
  });

  /* ---------- Init ---------- */
  loadTextBlocks();
  loadFilters();
  refresh();

})();
