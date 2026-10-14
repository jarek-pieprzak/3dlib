// History of a file (mounted at /api/files): list, open, restore and delete earlier versions
// kept in the project's .versions folder (server/utils/fileVersions.js)
const express = require('express');
const router = express.Router();

const { get } = require('../database');
const { authenticate } = require('../middleware/auth');
const { canEditModel, getSettingBool } = require('../utils/modelHelpers');
const adultLock = require('../utils/adult');
const fileVersions = require('../utils/fileVersions');
const { FsError } = require('../utils/projectFiles');

// The file and its model, if this request may see them
function load(req, res) {
  const file = get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
  const model = file && get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [file.model_id]);
  if (!file || !model) { res.status(404).json({ error: 'File not found' }); return null; }
  if (!adultLock.canOpenModel(req, model)) { res.status(404).json({ error: 'File not found' }); return null; }
  return { file, model };
}

function fail(res, e) {
  if (e instanceof FsError) return res.status(e.status).json({ error: e.message });
  console.error('[Versions] Error:', e);
  res.status(500).json({ error: 'File history operation failed' });
}

const viewAuth = (req, res, next) => (getSettingBool('require_login_to_view') ? authenticate(req, res, next) : next());

// ─── GET /api/files/:id/versions ─────────────────────────────────────────────
router.get('/:id/versions', viewAuth, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  res.json(fileVersions.list(ctx.file.id).map(v => ({ ...v, url: `/api/files/${ctx.file.id}/versions/${v.id}/file` })));
});

// ─── GET /api/files/:id/versions/:vid/file/:filename? ────────────────────────
router.get('/:id/versions/:vid/file/:filename?', viewAuth, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(req.params.vid), ctx.file.id]);
  const p = version && fileVersions.absPath(ctx.model, version);
  if (!p) return res.status(404).json({ error: 'Version not found' });
  res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'The version is no longer on disk' }); });
});

// ─── POST /api/files/:id/versions/:vid/restore ───────────────────────────────
router.post('/:id/versions/:vid/restore', authenticate, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  if (!canEditModel(req.user, ctx.model)) return res.status(403).json({ error: 'Forbidden' });
  try {
    fileVersions.restore(ctx.model, ctx.file, req.params.vid);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ─── DELETE /api/files/:id/versions/:vid ─────────────────────────────────────
router.delete('/:id/versions/:vid', authenticate, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  if (!canEditModel(req.user, ctx.model)) return res.status(403).json({ error: 'Forbidden' });
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(req.params.vid), ctx.file.id]);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  try {
    fileVersions.remove(ctx.model, version);
    require('../database').saveDb();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
