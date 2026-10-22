// The printer fit check: the build volumes of my printers (Settings -> Printers) and the sizes
// of a model's 3D files (services/dimensions.js). The fit itself is computed in the browser
// (public/js/printfit.js).
const express = require('express');
const router = express.Router();

const { get, all, run } = require('../database');
const { authenticate } = require('../middleware/auth');
const adultLock = require('../utils/adult');
const dimensions = require('../services/dimensions');
const { beds, DEFAULT_BEDS } = require('../utils/printFit');

// ─── GET /api/printer-beds ────────────────────────────────────────────────────
router.get('/printer-beds', (req, res) => res.json(beds()));

// ─── PUT /api/printer-beds  [{ id?, name, x, y, z, margin? }] ─────────────────
router.put('/printer-beds', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const list = Array.isArray(req.body) ? req.body : req.body && req.body.printers;
  if (!Array.isArray(list) || list.length > 50) return res.status(400).json({ error: 'Send a list of printers' });
  const clean = [];
  const ids = new Set();
  for (const p of list) {
    const name = typeof (p && p.name) === 'string' ? p.name.trim().replace(/\s+/g, ' ') : '';
    const num = (v, lo, hi) => { const n = Math.round(Number(v) * 10) / 10; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    const x = num(p.x, 10, 2000);
    const y = num(p.y, 10, 2000);
    const z = num(p.z, 10, 2000);
    const margin = p.margin === undefined || p.margin === '' ? 0 : num(p.margin, 0, 50);
    if (!name || name.length > 60 || x === null || y === null || z === null || margin === null) {
      return res.status(400).json({ error: `Check the printer "${name || '?'}": a name and a build volume of 10-2000 mm per axis` });
    }
    let id = typeof p.id === 'string' && /^[a-z0-9-]{1,60}$/.test(p.id) ? p.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'printer';
    while (ids.has(id)) id += '-2';
    ids.add(id);
    clean.push({ id, name, x, y, z, margin });
  }
  run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('printer_beds', ?)", [JSON.stringify(clean)]);
  res.json(clean);
});

// ─── GET /api/models/:id/sizes ────────────────────────────────────────────────
// { sizes: { <file id>: [x, y, z] }, errors: { <file id>: message }, pending } for the model's 3D
// files; its files waiting to be measured go first in the queue (?first=: these before the others)
router.get('/models/:id/sizes', (req, res) => {
  try {
    const model = get('SELECT id, is_adult FROM models WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!model || !adultLock.canOpenModel(req, model)) return res.status(404).json({ error: 'Model not found' });
    // ?first=1,2,3: the files on screen (the configurator's parts) are measured before the rest
    const first = String(req.query.first || '').split(',').map(Number).filter(Number.isInteger).slice(0, 2000);
    const pending = dimensions.prioritize(model.id, first);
    const sizes = {};
    const errors = {};
    for (const f of all('SELECT id, dim_x, dim_y, dim_z, dim_error FROM files WHERE model_id = ? AND deleted_at IS NULL AND dim_bytes IS NOT NULL', [model.id])) {
      if (f.dim_error) errors[f.id] = f.dim_error;
      else if (f.dim_x !== null) sizes[f.id] = [f.dim_x, f.dim_y, f.dim_z];
    }
    res.json({ sizes, errors, pending });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to read the sizes' }); }
});

module.exports = router;
module.exports.DEFAULT_BEDS = DEFAULT_BEDS;
