// History of a file (mounted at /api/files): list, open, restore and delete earlier versions
// kept in the project's .versions folder (server/utils/fileVersions.js). Versions of slicer
// projects carry what they are set up with (summary) and what changed from the one before.
const express = require('express');
const router = express.Router();

const { get } = require('../database');
const { authenticate } = require('../middleware/auth');
const { canEditModel, getSettingBool } = require('../utils/modelHelpers');
const protection = require('../utils/protection');
const fileVersions = require('../utils/fileVersions');
const { FsError } = require('../utils/projectFiles');
const { tokenFromName } = require('../utils/slicerToken');
const slicerSettings = require('../utils/slicerSettings');

const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } };

// The file and its model, if this request may see them
function load(req, res) {
  const file = get('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
  const model = file && get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [file.model_id]);
  if (!file || !model) { res.status(404).json({ error: 'File not found' }); return null; }
  if (!protection.canOpenModel(req, model)) { res.status(404).json({ error: 'File not found' }); return null; }
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
  res.json(fileVersions.list(ctx.file.id).map(v => {
    const { settings_key, ...rest } = v;
    const summary = parse(v.summary);
    return {
      ...rest, pinned: Boolean(v.pinned), summary, changes: parse(v.changes),
      url: `/api/files/${ctx.file.id}/versions/${v.id}/file`,
      thumbnail_url: summary && summary.thumbnail ? `/api/files/${ctx.file.id}/versions/${v.id}/thumbnail` : null
    };
  }));
});

// ─── GET /api/files/:id/versions/:vid/file/:filename? ────────────────────────
router.get('/:id/versions/:vid/file/:filename?', viewAuth, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(req.params.vid), ctx.file.id]);
  const p = version && fileVersions.absPath(ctx.model, version);
  if (!p) return res.status(404).json({ error: 'Version not found' });
  const send = () => res.sendFile(p, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'The version is no longer on disk' }); });
  // "Open in slicer": the link names the file's token, so a save comes back to this file. What
  // was sent is remembered: the same content saved again is only the download.
  if (!tokenFromName(req.params.filename)) return send();
  const { hashFileStream } = require('../utils/modelHelpers');
  const slicerSaves = require('../services/slicerSaves');
  hashFileStream(p).then(hash => slicerSaves.recordDownload(ctx.file.id, hash)).catch(() => {}).then(send);
});

// ─── GET /api/files/:id/versions/:vid/thumbnail ──────────────────────────────
// The plate picture of a slicer project, read from the 3MF
router.get('/:id/versions/:vid/thumbnail', viewAuth, async (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(req.params.vid), ctx.file.id]);
  const summary = version && parse(version.summary);
  const p = version && fileVersions.absPath(ctx.model, version);
  if (!summary || !summary.thumbnail || !p) return res.status(404).json({ error: 'No picture' });
  try {
    const png = await slicerSettings.readEntry(p, summary.thumbnail);
    if (!png) return res.status(404).json({ error: 'No picture' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(png);
  } catch (e) { res.status(404).json({ error: 'No picture' }); }
});

// ─── PUT /api/files/:id/versions/:vid { label, pinned } ──────────────────────
// A name for the version (empty: the one made from its settings) and whether pruning keeps it
router.put('/:id/versions/:vid', authenticate, (req, res) => {
  const ctx = load(req, res);
  if (!ctx) return;
  if (!canEditModel(req.user, ctx.model)) return res.status(403).json({ error: 'Forbidden' });
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(req.params.vid), ctx.file.id]);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const b = req.body || {};
  let label = version.label;
  if (b.label !== undefined) {
    label = typeof b.label === 'string' ? b.label.trim().replace(/\s+/g, ' ') : '';
    if (label.length > 100) return res.status(400).json({ error: 'The name is too long (at most 100 characters)' });
    label = label || null;
  }
  const pinned = b.pinned !== undefined ? (b.pinned ? 1 : 0) : (Number(version.pinned) ? 1 : 0);
  const { run, saveDb } = require('../database');
  run('UPDATE file_versions SET label = ?, pinned = ? WHERE id = ?', [label, pinned, version.id], true);
  saveDb();
  res.json({ success: true, label, pinned: Boolean(pinned) });
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
