// Every file gets a random token that travels in the file name of "Open in slicer" links:
// "Xmas_tree_210_3dl-7k3m9q2x.3mf". When the slicer saves the project under that name, the
// token tells which library file it came from. Random rather than the row id, so a token never
// points at another file after the database was rebuilt.
const crypto = require('crypto');
// The database is loaded on first use: tokenFromName stays usable without it (tests)
const db = () => require('../database');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (i/l/1, o/0)
// "..._3dl-7k3m9q2x.3mf", also with a suffix the slicer adds ("..._3dl-7k3m9q2x(2).3mf")
const TOKEN_RE = /(?:^|[^a-z0-9])3dl-([a-z2-9]{8})(?![a-z0-9])/i;

function newToken() {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const token = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
    if (!db().get('SELECT id FROM files WHERE slicer_token = ?', [token])) return token;
  }
}

// Give the files without a token one; returns them with their token set
function ensureTokens(files) {
  let changed = false;
  for (const f of files) {
    if (f.slicer_token) continue;
    f.slicer_token = newToken();
    db().run('UPDATE files SET slicer_token = ? WHERE id = ?', [f.slicer_token, f.id], true);
    changed = true;
  }
  if (changed) db().saveDb();
  return files;
}

// The token in a file name saved by a slicer, or null
function tokenFromName(name) {
  const m = TOKEN_RE.exec(String(name || ''));
  return m ? m[1].toLowerCase() : null;
}

function fileByToken(token) {
  return token ? db().get('SELECT * FROM files WHERE slicer_token = ?', [token]) : null;
}

module.exports = { ensureTokens, tokenFromName, fileByToken, newToken };
