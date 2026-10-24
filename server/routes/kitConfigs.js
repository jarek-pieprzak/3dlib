// Saved configurations of a kit configurator (public/js/kits/*: USSA VAULT, Hero Me Gen7). Each one is
// a model of its own in the library (utils/kits.js): no files, kit_source_id = the archive's
// model, kit_config = the choices. They hold the choices only, never file lists, so a rescan of
// the library does not break them; the kit checks them against the archive on load.
const express = require('express');
const router = express.Router();

const { get, all, run, saveDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const { canEditModel } = require('../utils/modelHelpers');
const protection = require('../utils/protection');
const trash = require('../utils/trash');
const kits = require('../utils/kits');

// The archive, when it exists, is not in the Trash and the user may open it
function openArchive(req, res) {
  const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!model || kits.isConfiguration(model) || !protection.canOpenModel(req, model)) {
    res.status(404).json({ error: 'Model not found' });
    return null;
  }
  return model;
}

function readName(body) {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 100) return { error: 'Give the configuration a name (at most 100 characters)' };
  return { name };
}

// A locked configuration (password protected) shows its name only; kit: the archive's kit
const toJson = (req, m, kit) => {
  const locked = !protection.canOpenModel(req, m);
  return {
    id: m.id, model_id: m.kit_source_id, kit, name: m.name, config: locked ? null : kits.configOf(m),
    is_protected: Boolean(m.is_protected), locked, created_at: m.created_at, updated_at: m.updated_at
  };
};

// The configuration `configId` of the archive, for a change by this user
function editable(req, res, archive) {
  const m = get('SELECT * FROM models WHERE id=? AND kit_source_id=? AND deleted_at IS NULL', [Number(req.params.configId), archive.id]);
  if (!m) { res.status(404).json({ error: 'Configuration not found' }); return null; }
  if (!canEditModel(req.user, m)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  if (!protection.canOpenModel(req, m)) { res.status(423).json({ error: 'This configuration is password protected', locked: true }); return null; }
  return m;
}

// ─── GET /api/models/:id/kit-configs ─────────────────────────────────────────
router.get('/:id/kit-configs', authenticate, (req, res) => {
  try {
    const archive = openArchive(req, res);
    if (!archive) return;
    const rows = all('SELECT * FROM models WHERE kit_source_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC', [archive.id]);
    const kit = kits.kitIdOf(archive);
    res.json(rows.map(m => toJson(req, m, kit)));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to list configurations' }); }
});

// ─── POST /api/models/:id/kit-configs { name, config } ───────────────────────
// A new configuration model
router.post('/:id/kit-configs', authenticate, (req, res) => {
  try {
    const archive = openArchive(req, res);
    if (!archive) return;
    if (req.user.role === 'viewer') return res.status(403).json({ error: 'Viewer accounts cannot save configurations' });
    const n = readName(req.body);
    if (n.error) return res.status(400).json({ error: n.error });
    const c = kits.readConfig(req.body.config);
    if (c.error) return res.status(400).json({ error: c.error });
    const { lastId } = run('INSERT INTO models (name, user_id, kit_source_id, kit_config) VALUES (?, ?, ?, ?)', [n.name, req.user.id, archive.id, c.text], true);
    kits.refreshNeeds(get('SELECT * FROM models WHERE id=?', [lastId]));
    saveDb();
    res.status(201).json(toJson(req, get('SELECT * FROM models WHERE id=?', [lastId]), kits.kitIdOf(archive)));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the configuration' }); }
});

// ─── PUT /api/models/:id/kit-configs/:configId { name?, config? } ────────────
router.put('/:id/kit-configs/:configId', authenticate, (req, res) => {
  try {
    const archive = openArchive(req, res);
    if (!archive) return;
    const m = editable(req, res, archive);
    if (!m) return;
    let name = m.name;
    if (req.body.name !== undefined) {
      const n = readName(req.body);
      if (n.error) return res.status(400).json({ error: n.error });
      name = n.name;
    }
    let config = m.kit_config;
    if (req.body.config !== undefined) {
      const c = kits.readConfig(req.body.config);
      if (c.error) return res.status(400).json({ error: c.error });
      config = c.text;
    }
    run("UPDATE models SET name=?, kit_config=?, updated_at=datetime('now') WHERE id=?", [name, config, m.id], true);
    if (config !== m.kit_config) kits.refreshNeeds(get('SELECT * FROM models WHERE id=?', [m.id]));
    saveDb();
    res.json(toJson(req, get('SELECT * FROM models WHERE id=?', [m.id]), kits.kitIdOf(archive)));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the configuration' }); }
});

// ─── DELETE /api/models/:id/kit-configs/:configId ────────────────────────────
// To the Trash, like any model
router.delete('/:id/kit-configs/:configId', authenticate, (req, res) => {
  try {
    const archive = openArchive(req, res);
    if (!archive) return;
    const m = editable(req, res, archive);
    if (!m) return;
    trash.trashModels([m.id]);
    res.json({ success: true, trashed: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete the configuration' }); }
});

// ─── PUT /api/models/:id/kit-config { config } ───────────────────────────────
// The choices of a configuration model, from its own page
router.put('/:id/kit-config', authenticate, (req, res) => {
  try {
    const m = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!m || !kits.isConfiguration(m)) return res.status(404).json({ error: 'Configuration not found' });
    if (!canEditModel(req.user, m)) return res.status(403).json({ error: 'Forbidden' });
    if (!protection.canOpenModel(req, m)) return res.status(423).json({ error: 'This configuration is password protected', locked: true });
    const c = kits.readConfig(req.body.config);
    if (c.error) return res.status(400).json({ error: c.error });
    run("UPDATE models SET kit_config=?, updated_at=datetime('now') WHERE id=?", [c.text, m.id], true);
    kits.refreshNeeds(get('SELECT * FROM models WHERE id=?', [m.id]));
    saveDb();
    res.json({ success: true, config: kits.configOf(get('SELECT * FROM models WHERE id=?', [m.id])) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the configuration' }); }
});

module.exports = router;
