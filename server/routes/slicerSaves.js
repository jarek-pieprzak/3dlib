// "Slicer saves" page (mounted at /api/slicer-saves): what the slicer saved into the library's
// .slicer-saves folder, and assigning the files that matched nothing (services/slicerSaves.js)
const express = require('express');
const router = express.Router();
const fs = require('fs');

const { get, all } = require('../database');
const { authenticate } = require('../middleware/auth');
const slicerSaves = require('../services/slicerSaves');
const { FsError } = require('../utils/projectFiles');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function loadSave(req, res) {
  const rec = get('SELECT * FROM slicer_saves WHERE id = ?', [Number(req.params.id)]);
  if (!rec || !fs.existsSync(slicerSaves.savePath(rec))) {
    res.status(404).json({ error: 'Saved file not found' });
    return null;
  }
  return rec;
}

function fail(res, e) {
  if (e instanceof FsError) return res.status(e.status).json({ error: e.message });
  console.error('[Slicer saves] Error:', e);
  res.status(500).json({ error: 'Slicer save operation failed' });
}

// ─── GET /api/slicer-saves ───────────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, (req, res) => {
  const rows = all(`SELECT s.*, f.original_name as file_name, f.model_id, m.name as model_name,
      fi.original_name as imported_name, fi.model_id as imported_model_id, mi.name as imported_model_name
    FROM slicer_saves s
    LEFT JOIN files f ON f.id = s.file_id LEFT JOIN models m ON m.id = f.model_id
    LEFT JOIN files fi ON fi.id = s.imported_file_id LEFT JOIN models mi ON mi.id = fi.model_id
    ORDER BY s.mtime_ms DESC`);
  res.json({
    quiet_minutes: slicerSaves.quietMinutes(),
    cleanup_days: slicerSaves.cleanupDays(),
    now: Date.now(),
    saves: rows.map(r => ({ ...r, clean_name: slicerSaves.cleanName(r.name), url: `/api/slicer-saves/${r.id}/file/${encodeURIComponent(r.name)}` }))
  });
});

// ─── POST /api/slicer-saves/scan: check the folder now ───────────────────────
router.post('/scan', authenticate, requireAdmin, async (req, res) => {
  try {
    await slicerSaves.processSaves();
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

// ─── POST /api/slicer-saves/cleanup: delete every file that holds nothing new ─
router.post('/cleanup', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, removed: await slicerSaves.cleanupNow() });
  } catch (e) { fail(res, e); }
});

// ─── GET /api/slicer-saves/:id/file/:name? (preview) ─────────────────────────
router.get('/:id/file/:name?', authenticate, requireAdmin, (req, res) => {
  const rec = loadSave(req, res);
  if (rec) res.sendFile(slicerSaves.savePath(rec));
});

// ─── POST /api/slicer-saves/:id/import: import a matched save without waiting ─
router.post('/:id/import', authenticate, requireAdmin, async (req, res) => {
  const rec = loadSave(req, res);
  if (!rec) return;
  try {
    await slicerSaves.processSaves({ importNow: [rec.id] });
    const after = get('SELECT status, message FROM slicer_saves WHERE id = ?', [rec.id]);
    if (after && after.status === 'error') return res.status(409).json({ error: after.message });
    res.json({ success: true, status: after && after.status });
  } catch (e) { fail(res, e); }
});

// ─── POST /api/slicer-saves/:id/assign { file_id } | { model_id } | { new_model: true } ─
router.post('/:id/assign', authenticate, requireAdmin, (req, res) => {
  const rec = loadSave(req, res);
  if (!rec) return;
  try {
    const b = req.body || {};
    let result;
    if (b.file_id) result = slicerSaves.assignToFile(rec, Number(b.file_id));
    else if (b.model_id) result = slicerSaves.addToModel(rec, Number(b.model_id));
    else if (b.new_model) result = slicerSaves.newModel(rec, req.user.id);
    else return res.status(400).json({ error: 'Choose a file, a model or a new model' });
    res.json({ success: true, ...result });
  } catch (e) { fail(res, e); }
});

// ─── DELETE /api/slicer-saves/:id: discard the saved file ────────────────────
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const rec = loadSave(req, res);
  if (!rec) return;
  try {
    fs.unlinkSync(slicerSaves.savePath(rec));
    require('../database').run('DELETE FROM slicer_saves WHERE id = ?', [rec.id]);
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
