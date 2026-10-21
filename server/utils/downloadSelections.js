// Selections waiting to be downloaded as a ZIP (POST /api/models/:id/download-selection): the
// browser downloads them with a plain link, which cannot carry the CSRF header, so the POST
// keeps the selection here under a random token for a short time. Memory only: a restart only
// means asking for the download again.
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const MAX = 200;
const selections = new Map(); // token -> { modelId, userId, fileIds, text, name, expires }

function prune(now = Date.now()) {
  for (const [token, s] of selections) if (s.expires <= now) selections.delete(token);
  // Oldest first (Map keeps insertion order)
  while (selections.size >= MAX) selections.delete(selections.keys().next().value);
}

function create(selection) {
  prune();
  const token = crypto.randomBytes(16).toString('hex');
  selections.set(token, { ...selection, expires: Date.now() + TTL_MS });
  return token;
}

function get(token) {
  const s = selections.get(String(token || ''));
  if (!s) return null;
  if (s.expires <= Date.now()) { selections.delete(token); return null; }
  return s;
}

module.exports = { create, get, TTL_MS };
