// netlify/functions/admin-update-status.js
// Met à jour le champ Extra dans Zotero en modifiant le bloc [DLAB] (hal_done / comms_done)

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
    if (!isAuthorized(event)) return json(401, { error: 'Unauthorized' });

    const apiKey = process.env.ZOTERO_API_KEY;
    const libraryType = process.env.ZOTERO_LIBRARY_TYPE; // 'users' ou 'groups'
    const libraryId = process.env.ZOTERO_LIBRARY_ID;

    if (!apiKey || !libraryType || !libraryId) {
      return json(500, { error: 'Missing Zotero env vars' });
    }

    const body = JSON.parse(event.body || '{}');
    const key = (body.key || '').trim();
    if (!key) return json(400, { error: 'Missing item key' });

    // valeurs attendues: 'yes' / 'no'
    const hal_done = normalizeBool((body.hal_done || '').trim());
    const comms_done = normalizeBool((body.comms_done || '').trim());

    // 1) GET item (pour récupérer version + extra actuel)
    const getUrl = `https://api.zotero.org/${libraryType}/${libraryId}/items/${key}`;
    const getRes = await fetch(getUrl, {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3'
      }
    });

    const getRaw = await getRes.text();
    if (!getRes.ok) return json(getRes.status, { error: 'Zotero GET error', details: getRaw });

    const item = JSON.parse(getRaw);
    const version = item?.data?.version;
    if (!version) return json(500, { error: 'Missing Zotero version' });

    const currentExtra = item.data.extra || '';

    // 2) Update DLAB block
    const updatedExtra = upsertDLAB(currentExtra, {
      ...(hal_done ? { hal_done } : {}),
      ...(comms_done ? { comms_done } : {})
    });

    // 3) PUT item (avec contrôle de version)
    item.data.extra = updatedExtra;

    const putRes = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3',
        'If-Unmodified-Since-Version': String(version)
      },
      body: JSON.stringify(item.data)
    });

    const putText = await putRes.text();
    if (!putRes.ok) return json(putRes.status, { error: 'Zotero PUT error', details: putText });

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: 'Server error', message: err.message });
  }
};

function isAuthorized(event) {
  const token = (event.headers?.['x-admin-token'] || event.headers?.['X-Admin-Token'] || '').trim();
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  return expected && token && token === expected;
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

function normalizeBool(v) {
  const x = String(v || '').toLowerCase();
  if (x === 'yes' || x === 'true' || x === 'oui') return 'yes';
  if (x === 'no' || x === 'false' || x === 'non') return 'no';
  return ''; // si vide ou invalide, on n’écrit pas
}

// Insère ou met à jour un bloc [DLAB] en conservant le reste du champ Extra
function upsertDLAB(extra, updates) {
  const s = String(extra || '');
  const start = s.indexOf('[DLAB]');
  const end = s.indexOf('[/DLAB]');

  let before = s;
  let block = '';
  let after = '';

  if (start !== -1 && end !== -1 && end > start) {
    before = s.slice(0, start).trimEnd();
    block = s.slice(start + 6, end).trim();
    after = s.slice(end + 7).trimStart();
  } else {
    before = s.trimEnd();
    block = ''; // bloc absent
    after = '';
  }

  const map = parseBlockToMap(block);

  for (const [k,v] of Object.entries(updates || {})) {
    if (v === 'yes' || v === 'no') map[k] = v;
  }

  const newBlock = mapToBlock(map);

  const parts = [];
  if (before) parts.push(before);
  parts.push(`[DLAB]\n${newBlock}\n[/DLAB]`);
  if (after) parts.push(after);

  return parts.join('\n\n').trim() + '\n';
}

function parseBlockToMap(block) {
  const map = {};
  const lines = String(block || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().toLowerCase();
    if (!k) continue;
    if (v === 'yes' || v === 'no' || v === 'true' || v === 'false' || v === 'oui' || v === 'non') {
      map[k] = normalizeBool(v) || v;
    } else {
      map[k] = v;
    }
  }
  return map;
}

function mapToBlock(map) {
  // ordre stable (lisible)
  const order = ['hal_create','comms_publish','hal_done','comms_done','hal_done_date','comms_done_date','hal_id','comms_link'];
  const keys = [...new Set([...order, ...Object.keys(map || {})])].filter(k => map[k] !== undefined);
  return keys.map(k => `${k}: ${map[k]}`).join('\n');
}
