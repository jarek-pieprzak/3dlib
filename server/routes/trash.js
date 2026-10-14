// The Trash (mounted at /api/trash): deleted models and deleted files of other models.
// Everything here is purged for good after the retention period, see server/utils/trash.js.
const express = require('express');
const router = express.Router();

const { get, all } = require('../database');
const { authenticate } = require('../middleware/auth');
const { canEditModel, getThumbUrl, getFileUrl } = require('../utils/modelHelpers');
const trash = require('../utils/trash');

function requireEditor(req, res, next) {
  if (!req.user || req.user.role === 'viewer') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Ids of the models this user may change, out of `modelIds`
function editableModelIds(user, modelIds) {
  return (Array.isArray(modelIds) ? modelIds : []).filter(id => canEditModel(user, get('SELECT id, user_id FROM models WHERE id = ?', [Number(id)])));
}

function editableFileIds(user, fileIds) {
  return (Array.isArray(fileIds) ? fileIds : []).filter(id => {
    const row = get('SELECT m.id, m.user_id FROM files f JOIN models m ON m.id = f.model_id WHERE f.id = ?', [Number(id)]);
    return canEditModel(user, row);
  });
}

// ─── GET /api/trash ──────────────────────────────────────────────────────────
router.get('/', authenticate, requireEditor, (req, res) => {
  try {
    const own = req.user.role === 'admin' ? '' : ' AND m.user_id = ?';
    const params = req.user.role === 'admin' ? [] : [req.user.id];
    const models = all(`SELECT m.id, m.name, m.thumbnail, m.library_path, m.deleted_at, m.is_adult,
        (SELECT COUNT(*) FROM files WHERE model_id = m.id AND (library_path IS NULL OR library_path NOT LIKE '%::%')) as file_count,
        (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE model_id = m.id AND (library_path IS NULL OR library_path NOT LIKE '%::%')) as total_size
      FROM models m WHERE m.deleted_at IS NOT NULL${own} ORDER BY m.deleted_at DESC`, params)
      .map(m => ({ ...m, thumbnail_url: getThumbUrl(m.thumbnail, m.library_path), library_path: undefined, thumbnail: undefined }));

    const rows = all(`SELECT f.id, f.model_id, f.original_name, f.filename, f.file_type, f.file_size, f.library_path, f.is_archive_entry, f.deleted_at,
        m.name as model_name, m.is_adult
      FROM files f JOIN models m ON m.id = f.model_id
      WHERE f.deleted_at IS NOT NULL AND m.deleted_at IS NULL${own} ORDER BY f.deleted_at DESC`, params);
    // Entries of a deleted archive are listed with the archive itself
    const deletedPaths = new Set(rows.map(r => r.library_path).filter(Boolean));
    const files = rows
      .filter(r => !(r.library_path && r.library_path.includes('::') && deletedPaths.has(r.library_path.split('::')[0])))
      .map(r => ({ ...r, url: getFileUrl(r), library_path: undefined }));

    res.json({ retention_days: trash.retentionDays(), models, files });
  } catch (e) {
    console.error('[Trash] List error:', e);
    res.status(500).json({ error: 'Failed to load the Trash' });
  }
});

// ─── POST /api/trash/restore { model_ids, file_ids } ─────────────────────────
router.post('/restore', authenticate, requireEditor, (req, res) => {
  try {
    const models = trash.restoreModels(editableModelIds(req.user, req.body.model_ids));
    const files = trash.restoreFiles(editableFileIds(req.user, req.body.file_ids));
    res.json({ success: true, models, files });
  } catch (e) {
    console.error('[Trash] Restore error:', e);
    res.status(500).json({ error: 'Failed to restore' });
  }
});

// ─── POST /api/trash/purge { model_ids, file_ids }: delete for good now ──────
router.post('/purge', authenticate, requireEditor, (req, res) => {
  try {
    const models = trash.purgeModels(editableModelIds(req.user, req.body.model_ids));
    const files = trash.purgeFiles(editableFileIds(req.user, req.body.file_ids));
    res.json({ success: true, models, files });
  } catch (e) {
    console.error('[Trash] Purge error:', e);
    res.status(500).json({ error: 'Failed to delete permanently' });
  }
});

// ─── POST /api/trash/empty: delete everything in the Trash for good ──────────
router.post('/empty', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const models = trash.purgeModels(all('SELECT id FROM models WHERE deleted_at IS NOT NULL').map(r => r.id));
    const files = trash.purgeFiles(all('SELECT id FROM files WHERE deleted_at IS NOT NULL').map(r => r.id));
    res.json({ success: true, models, files });
  } catch (e) {
    console.error('[Trash] Empty error:', e);
    res.status(500).json({ error: 'Failed to empty the Trash' });
  }
});

module.exports = router;
