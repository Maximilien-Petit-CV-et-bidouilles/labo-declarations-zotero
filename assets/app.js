// assets/app.js

function setStatus(message, kind = 'info') {
  const el = document.getElementById('pub-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'status';
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'err') el.classList.add('err');
}

function clearStatus() {
  setStatus('', 'info');
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function addAuthorRow(firstName = '', lastName = '') {
  const list = document.getElementById('authors-list');
  const div = document.createElement('div');
  div.className = 'author-row';

  div.innerHTML = `
    <div class="two-cols">
      <input placeholder="Prénom" value="${escapeHtml(firstName)}">
      <input placeholder="Nom *" value="${escapeHtml(lastName)}">
    </div>
  `;

  list.appendChild(div);
}

function resetAuthors() {
  const list = document.getElementById('authors-list');
  if (!list) return;
  list.innerHTML = '';
  addAuthorRow();
}

function getAuthors() {
  return [...document.querySelectorAll('.author-row')]
    .map(row => {
      const [fn, ln] = row.querySelectorAll('input');
      return { firstName: (fn.value || '').trim(), lastName: (ln.value || '').trim() };
    })
    .filter(a => a.firstName || a.lastName);
}

function togglePubType(pubType) {
  document.getElementById('book-fields').style.display =
    pubType === 'book' ? 'block' : 'none';
  document.getElementById('section-fields').style.display =
    pubType === 'bookSection' ? 'block' : 'none';

  // UX: ne pas laisser un vieux "✅ Envoyé" traîner
  clearStatus();
}

// --- Init
const form = document.getElementById('pub-form');
const submitBtn = form.querySelector('button[type="submit"]');

document.getElementById('add-author-btn').addEventListener('click', () => addAuthorRow());
resetAuthors();

const pubTypeSelect = document.getElementById('pubType');
pubTypeSelect.addEventListener('change', (e) => togglePubType(e.target.value));
togglePubType(pubTypeSelect.value);

// --- Submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  clearStatus();
  setStatus('⏳ Envoi en cours…');
  submitBtn.disabled = true;

  try {
    const authors = getAuthors();
    const hasLastName = authors.some(a => (a.lastName || '')
