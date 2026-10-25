// The printer fit check on the server: my printers (Settings -> Printers) and which models fit
// them, for the model list (a badge per card, the "Fits my printer" filter). The fit itself is
// the browser's code (public/js/printfit.js), loaded here too, so both always agree.
const { get, all } = require('../database');
require('../../public/js/printfit.js');

const PrintFit = globalThis.PrintFit;

// Used until the list is changed in Settings
const DEFAULT_BEDS = [
  { id: 'bambu-p1s', name: 'Bambu Lab P1S', x: 256, y: 256, z: 256, margin: 0 },
  { id: 'snapmaker-u1', name: 'Snapmaker U1', x: 270, y: 270, z: 270, margin: 0 },
  { id: 'creality-sparkx-i8', name: 'Creality SparkX i8', x: 260, y: 260, z: 255, margin: 0 },
  { id: 'voron-24-350', name: 'Voron 2.4 350', x: 350, y: 350, z: 255, margin: 0 }
];
// The 3D files the server measures (utils/meshSize.js)
const MEASURABLE_SQL = "file_type IN ('stl','obj','3mf','step') AND deleted_at IS NULL AND COALESCE(is_archive_entry, 0) = 0 AND COALESCE(library_path, '') NOT LIKE '%::%'";

function beds() {
  const row = get("SELECT value FROM system_settings WHERE key = 'printer_beds'");
  if (!row) return DEFAULT_BEDS;
  try {
    const list = JSON.parse(row.value);
    return Array.isArray(list) ? list : DEFAULT_BEDS;
  } catch (e) {
    return DEFAULT_BEDS;
  }
}

// Per model id: { total, pending, failed, misfit: { any: n, <bed id>: n } }: how many of its 3D
// files wait to be measured, could not be measured, and are too big for each printer ("any":
// for all of them). modelIds: the models to look at, or null for every model.
function modelFits(modelIds) {
  const list = beds();
  const out = new Map();
  if (modelIds && !modelIds.length) return out;
  const rows = all(`SELECT model_id, file_size, dim_x, dim_y, dim_z, dim_bytes, dim_error FROM files WHERE ${MEASURABLE_SQL}${modelIds ? ` AND model_id IN (${modelIds.map(Number).join(',')})` : ''}`);
  for (const f of rows) {
    let m = out.get(f.model_id);
    if (!m) {
      m = { total: 0, pending: 0, failed: 0, misfit: { any: 0 } };
      for (const b of list) m.misfit[b.id] = 0;
      out.set(f.model_id, m);
    }
    m.total++;
    if (f.dim_bytes !== f.file_size) { m.pending++; continue; }
    if (f.dim_error || f.dim_x === null) { m.failed++; continue; }
    const size = [f.dim_x, f.dim_y, f.dim_z];
    let fitsAny = false;
    for (const b of list) {
      const fit = PrintFit.fits(size, b);
      if (fit && fit.ok) fitsAny = true;
      else m.misfit[b.id]++;
    }
    if (!fitsAny) m.misfit.any++;
  }
  return out;
}

// Ids of the models whose every measured 3D file fits the printer ('any': at least one of mine),
// with none waiting to be measured
function fittingModelIds(bedId) {
  const key = bedId && bedId !== 'any' && beds().some(b => b.id === bedId) ? bedId : 'any';
  const ids = [];
  for (const [id, m] of modelFits(null)) {
    if (m.pending || m.total === m.failed) continue;
    if (!m.misfit[key]) ids.push(id);
  }
  return ids;
}

module.exports = { DEFAULT_BEDS, beds, modelFits, fittingModelIds };
