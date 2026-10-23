// Covers rendered by the browser (mounted at /api/covers). The 3D viewer renders a cover and
// uploads it through POST /api/models/:id/thumbnail, which names it "<ms>-<16 hex>.png"; those
// covers, and models with no cover at all, can be rendered again from Settings -> Maintenance.
// Covers taken from 3MF / G-code thumbnails or from images of the project are left alone.
const express = require('express');
const router = express.Router();

const { all } = require('../database');
const { authenticate } = require('../middleware/auth');
const { getFileUrl } = require('../utils/modelHelpers');
const protection = require('../utils/protection');

const VIEWER_COVER = /^\d{10,}-[0-9a-f]{16}\.png$/i;

// ─── GET /api/covers/pending: models whose cover the viewer can (re)render ────
router.get('/pending', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const locked = Boolean(protection.passwordHash());
    const models = all('SELECT id, name, thumbnail, preview_file_id, is_protected FROM models WHERE deleted_at IS NULL ORDER BY sortkey(name)');
    const files = all(`SELECT f.id, f.model_id, f.filename, f.library_path, f.file_type, f.is_archive_entry
      FROM files f JOIN models m ON m.id = f.model_id
      WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL AND f.file_type IN ('stl', '3mf')
      ORDER BY f.uploaded_at DESC`);
    const byModel = {};
    for (const f of files) (byModel[f.model_id] = byModel[f.model_id] || []).push(f);

    const pending = [];
    let skippedProtected = 0;
    for (const m of models) {
      const reason = !m.thumbnail ? 'missing' : (VIEWER_COVER.test(m.thumbnail) ? 'viewer' : null);
      const candidates = byModel[m.id];
      if (!reason || !candidates) continue;
      // Files of a protected model need its password: they cannot be rendered in bulk
      if (locked && Number(m.is_protected) === 1) { skippedProtected++; continue; }
      const file = candidates.find(f => f.id === m.preview_file_id)
        || candidates.find(f => f.file_type === 'stl')
        || candidates[0];
      pending.push({ id: m.id, name: m.name, reason, file_type: file.file_type, url: getFileUrl(file) });
    }
    res.json({ models: pending, skipped_protected: skippedProtected });
  } catch (e) {
    console.error('[Covers] Error:', e);
    res.status(500).json({ error: 'Failed to list covers' });
  }
});

module.exports = router;
