// File operations inside a project (mounted at /api/models): rename, move, new folder and
// delete to the Trash. They change the library on disk; see server/utils/projectFiles.js.
const express = require('express');
const router = express.Router();

const { get } = require('../database');
const { authenticate } = require('../middleware/auth');
const { canEditModel } = require('../utils/modelHelpers');
const adultLock = require('../utils/adult');
const projectFiles = require('../utils/projectFiles');

function handle(op) {
  return (req, res) => {
    try {
      const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
      if (!model) return res.status(404).json({ error: 'Model not found' });
      if (!canEditModel(req.user, model)) return res.status(403).json({ error: 'Forbidden' });
      if (!adultLock.canOpenModel(req, model)) return res.status(423).json({ error: 'This model is password protected', locked: true });
      const result = op(model, req.body || {});
      res.json({ success: true, ...(result && typeof result === 'object' ? result : {}) });
    } catch (e) {
      if (e instanceof projectFiles.FsError) return res.status(e.status).json({ error: e.message });
      console.error('[Project files] Error:', e);
      res.status(500).json({ error: 'File operation failed' });
    }
  };
}

// POST /api/models/:id/fs/rename { path, name }
router.post('/:id/fs/rename', authenticate, handle((model, b) => projectFiles.renameEntry(model, b.path, b.name)));

// POST /api/models/:id/fs/move { paths: [...], target }
router.post('/:id/fs/move', authenticate, handle((model, b) => ({ moved: projectFiles.moveEntries(model, b.paths, b.target) })));

// POST /api/models/:id/fs/mkdir { path, name }: new folder `name` inside `path`
router.post('/:id/fs/mkdir', authenticate, handle((model, b) => projectFiles.makeFolder(model, b.path, b.name)));

// POST /api/models/:id/fs/delete { paths: [...] }: files go to the Trash
router.post('/:id/fs/delete', authenticate, handle((model, b) => projectFiles.deleteEntries(model, b.paths)));

module.exports = router;
