// Password-protected models (models.is_adult): once the admin has set a password, every
// time such a model is opened the password is asked again. The unlock token lives in the
// page's memory (X-Adult-Unlock header) and in a cookie that the page clears when it leaves
// the model. The cookie lets <img>, <video>, the 3D viewer and downloads load files; slicer
// links carry the token as ?unlock= because a slicer has no cookies.
const path = require('path');
const jwt = require('jsonwebtoken');
const { get } = require('../database');
const { getJwtSecret } = require('../middleware/auth');

const COOKIE = 'gv_adult';
const TOKEN_TTL = '6h';

function passwordHash() {
  const row = get("SELECT value FROM system_settings WHERE key = 'adult_password_hash'");
  return row && row.value ? row.value : null;
}

function isLocked(model) {
  return Boolean(model && Number(model.is_adult) === 1 && passwordHash());
}

function issueToken(modelId) {
  return jwt.sign({ adult: Number(modelId) }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

function tokenMatches(token, modelId) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return payload && payload.adult === Number(modelId);
  } catch (e) {
    return false;
  }
}

// headerOnly: the model page itself (JSON) needs the in-memory token, so a leftover cookie
// never skips the password prompt
function isUnlocked(req, modelId, { headerOnly = false } = {}) {
  if (tokenMatches(req.get('X-Adult-Unlock'), modelId)) return true;
  if (headerOnly) return false;
  if (tokenMatches(req.cookies && req.cookies[COOKIE], modelId)) return true;
  return tokenMatches(req.query && req.query.unlock, modelId);
}

function canOpenModel(req, model, opts) {
  return !isLocked(model) || isUnlocked(req, model.id, opts);
}

function canOpenModelId(req, modelId) {
  return canOpenModel(req, get('SELECT id, is_adult FROM models WHERE id = ?', [Number(modelId)]));
}

// Guards /library-files and /uploads: files of a protected model need the unlock cookie.
// The model's cover thumbnail stays reachable, the lists show it blurred.
function staticGuard(kind, rootDir) {
  const { getThumbUrl } = require('./modelHelpers');
  const mount = kind === 'library' ? '/library-files' : '/uploads';
  return (req, res, next) => {
    if (!passwordHash()) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch (e) { return next(); }
    const row = kind === 'library'
      ? get('SELECT m.id, m.is_adult, m.thumbnail, m.library_path FROM files f JOIN models m ON m.id = f.model_id WHERE f.library_path = ?', [path.join(path.resolve(rootDir), rel)])
      : get('SELECT m.id, m.is_adult, m.thumbnail, m.library_path FROM files f JOIN models m ON m.id = f.model_id WHERE f.filename = ? AND f.library_path IS NULL', [rel.replace(/^\/+/, '')]);
    if (!row || Number(row.is_adult) !== 1 || isUnlocked(req, row.id)) return next();
    const thumbUrl = getThumbUrl(row.thumbnail, row.library_path);
    if (thumbUrl) {
      let thumbPath = thumbUrl.split('?')[0];
      try { thumbPath = decodeURIComponent(thumbPath); } catch (e) { /* keep as is */ }
      if (thumbPath === mount + rel) return next();
    }
    return res.status(404).type('text/plain').send('Not found');
  };
}

module.exports = { COOKIE, TOKEN_TTL, passwordHash, isLocked, issueToken, isUnlocked, canOpenModel, canOpenModelId, staticGuard };
