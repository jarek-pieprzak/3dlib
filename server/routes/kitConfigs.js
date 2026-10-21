// Saved configurations of a kit configurator (public/js/kits/*: the USSA VAULT one). Every user
// keeps named configurations per model. They hold the choices only, never file lists, so a
// rescan of the library does not break them; the kit checks them against the archive on load.
const express = require('express');
const router = express.Router();

const { get, all, run } = require('../database');
const { authenticate } = require('../middleware/auth');
const adultLock = require('../utils/adult');

const MAX_CONFIG_BYTES = 64 * 1024;

// The model, when it exists, is not in the Trash and the user may open it
function openModel(req, res) {
  const model = get('SELECT id, is_adult FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!model || !adultLock.canOpenModel(req, model)) {
    res.status(404).json({ error: 'Model not found' });
    return null;
  }
  return model;
}

// { name, config } from a request body; partial: fields left out stay as they are
function readBody(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 100) return { error: 'Give the configuration a name (at most 100 characters)' };
    out.name = name;
  }
  if (!partial || body.config !== undefined) {
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return { error: 'The configuration is missing' };
    out.config = JSON.stringify(body.config);
    if (Buffer.byteLength(out.config, 'utf8') > MAX_CONFIG_BYTES) return { error: 'The configuration is too large' };
  }
  return out;
}

const toJson = (r) => {
  let config = {};
  try { config = JSON.parse(r.config); } catch (e) {}
  return { id: r.id, model_id: r.model_id, kit: r.kit, name: r.name, config, created_at: r.created_at, updated_at: r.updated_at };
};

// ─── GET /api/models/:id/kit-configs?kit= ─────────────────────────────────────
router.get('/:id/kit-configs', authenticate, (req, res) => {
  try {
    const model = openModel(req, res);
    if (!model) return;
    const kit = typeof req.query.kit === 'string' ? req.query.kit : null;
    const rows = all(`SELECT * FROM kit_configs WHERE model_id=? AND user_id=?${kit ? ' AND kit=?' : ''} ORDER BY updated_at DESC, id DESC`,
      kit ? [model.id, req.user.id, kit] : [model.id, req.user.id]);
    res.json(rows.map(toJson));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to list configurations' }); }
});

// ─── POST /api/models/:id/kit-configs ─────────────────────────────────────────
router.post('/:id/kit-configs', authenticate, (req, res) => {
  try {
    const model = openModel(req, res);
    if (!model) return;
    const kit = typeof req.body.kit === 'string' ? req.body.kit : '';
    if (!/^[a-z0-9-]{1,40}$/.test(kit)) return res.status(400).json({ error: 'Unknown kit' });
    const data = readBody(req.body, false);
    if (data.error) return res.status(400).json({ error: data.error });
    const { lastId } = run('INSERT INTO kit_configs (model_id, user_id, kit, name, config) VALUES (?, ?, ?, ?, ?)', [model.id, req.user.id, kit, data.name, data.config]);
    res.status(201).json(toJson(get('SELECT * FROM kit_configs WHERE id=?', [lastId])));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the configuration' }); }
});

// ─── PUT /api/models/:id/kit-configs/:configId ────────────────────────────────
router.put('/:id/kit-configs/:configId', authenticate, (req, res) => {
  try {
    const model = openModel(req, res);
    if (!model) return;
    const row = get('SELECT * FROM kit_configs WHERE id=? AND model_id=? AND user_id=?', [Number(req.params.configId), model.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Configuration not found' });
    const data = readBody(req.body, true);
    if (data.error) return res.status(400).json({ error: data.error });
    run("UPDATE kit_configs SET name=?, config=?, updated_at=datetime('now') WHERE id=?", [data.name || row.name, data.config || row.config, row.id]);
    res.json(toJson(get('SELECT * FROM kit_configs WHERE id=?', [row.id])));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the configuration' }); }
});

// ─── DELETE /api/models/:id/kit-configs/:configId ─────────────────────────────
router.delete('/:id/kit-configs/:configId', authenticate, (req, res) => {
  try {
    const model = openModel(req, res);
    if (!model) return;
    const { changes } = run('DELETE FROM kit_configs WHERE id=? AND model_id=? AND user_id=?', [Number(req.params.configId), model.id, req.user.id]);
    if (!changes) return res.status(404).json({ error: 'Configuration not found' });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete the configuration' }); }
});

module.exports = router;
