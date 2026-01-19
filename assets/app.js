function addAuthorRow() {
  const list = document.getElementById('authors-list');
  const div = document.createElement('div');
  div.className = 'author-row';
  div.innerHTML = `
    <div class="two-cols">
      <input placeholder="Prénom">
      <input placeholder="Nom *">
    </div>
  `;
  list.appendChild(div);
}

function getAuthors() {
  return [...document.querySelectorAll('.author-row')].map(row => {
    const [fn, ln] = row.querySelectorAll('input');
    return { firstName: fn.value.trim(), lastName: ln.value.trim() };
  }).filter(a => a.firstName || a.lastName);
}

document.getElementById('add-author-btn').onclick = addAuthorRow;
addAuthorRow();

document.getElementById('pubType').onchange = e => {
  document.getElementById('book-fields').style.display =
    e.target.value === 'book' ? 'block' : 'none';
  document.getElementById('section-fields').style.display =
    e.target.value === 'bookSection' ? 'block' : 'none';
};

document.getElementById('pub-form').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;

  const payload = {
    kind: 'publication',
    pubType: f.pubType.value,
    title: f.title.value,
    authors: getAuthors(),
    date: f.date.value,
    publisher: f.publisher?.value,
    place: f.place?.value,
    isbn: f.isbn?.value,
    abstract: f.abstract?.value,
    language: f.language?.value,
    bookTitle: f.bookTitle?.value,
    pages: f.pages?.value,
    series: f.series?.value,
    seriesNumber: f.seriesNumber?.value,
    volume: f.volume?.value,
    edition: f.edition?.value,
    extra: f.extra.value
  };

  const r = await fetch('/.netlify/functions/zotero-create-item', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  document.getElementById('pub-status').textContent =
    r.ok ? '✅ Envoyé vers Zotero' : '❌ Erreur Zotero';
};
