// Kit configurators on the server. The kits are the browser's code (public/js/kits/*), loaded
// here too, so both always agree: USSA VAULT ('ussa-vault') and Hero Me Gen7 ('hero-me-gen7').
//  * An archive: a project whose files a kit recognises (its detect). It gets
//    models.kit_archive and becomes read-only the first time it is recognised: the app never
//    changes its files. Turning read-only off in Edit sticks, it is not turned on again.
//  * A configuration: a model without files of its own. kit_source_id is the model of the
//    archive, kit_config the choices (JSON). Its parts are files of the archive, so they keep
//    the archive's access rules.
const { get, all, run, saveDb } = require('../database');
require('../../public/js/kits/ussa-vault.js');
require('../../public/js/kits/hero-me-gen7.js');

const VaultKit = globalThis.VaultKit;
const HeroMeKit = globalThis.HeroMeKit;
// The kit of archives marked before there were more kits
const KIT = 'ussa-vault';
const KITS = { 'ussa-vault': VaultKit, 'hero-me-gen7': HeroMeKit };
const MAX_CONFIG_BYTES = 64 * 1024;

function archiveFiles(modelId) {
  return all('SELECT * FROM files WHERE model_id = ? AND deleted_at IS NULL', [modelId]);
}

// Marks the archives that are not marked yet; returns how many were found
function refreshArchives() {
  const candidates = all(`SELECT m.id FROM models m
    WHERE m.kit_archive IS NULL AND m.kit_source_id IS NULL AND m.library_path IS NOT NULL
      AND (SELECT COUNT(*) FROM files f WHERE f.model_id = m.id AND f.file_type = 'stl' AND f.deleted_at IS NULL) >= 40`);
  let found = 0;
  for (const { id } of candidates) {
    const files = archiveFiles(id);
    const kit = Object.keys(KITS).find(k => KITS[k].detect(files));
    if (!kit) continue;
    run('UPDATE models SET kit_archive = ?, is_readonly = 1 WHERE id = ?', [kit, id], true);
    found++;
  }
  if (found) saveDb();
  return found;
}

// The kit of an archive: its mark, else the kit that knows its files
function kitIdOf(archive, files) {
  if (archive && KITS[archive.kit_archive]) return archive.kit_archive;
  const list = files || (archive ? archiveFiles(archive.id) : []);
  return Object.keys(KITS).find(k => KITS[k].detect(list)) || KIT;
}

function isConfiguration(model) {
  return Boolean(model && model.kit_source_id);
}

function configOf(model) {
  try {
    const cfg = JSON.parse(model.kit_config || '{}');
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch (e) {
    return {};
  }
}

// The choices of a request body as JSON text, or { error }
function readConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The configuration is missing' };
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) return { error: 'The configuration is too large' };
  return { text };
}

// The archive of a configuration and its parts list: { source, files, kit, cat, bom }, or null
// when the archive is gone or in the Trash
function partsOf(model) {
  const source = get('SELECT * FROM models WHERE id = ?', [model.kit_source_id]);
  if (!source || source.deleted_at) return null;
  const files = archiveFiles(source.id);
  const kit = KITS[kitIdOf(source, files)];
  const cat = kit.buildCatalog(files);
  return { source, files, kit, cat, bom: kit.computeBom(cat, configOf(model)) };
}

// The parts list of a project made by hand (models.parts_list), or null
function partsListOf(model) {
  if (!model || !model.parts_list) return null;
  try {
    const list = JSON.parse(model.parts_list);
    return { files: list.files || [], hardware: list.hardware || [], notes: list.notes || '' };
  } catch (e) { return null; }
}

// A model whose parts are counted: a configuration of a kit, or a project with a parts list
function hasParts(model) {
  return isConfiguration(model) || Boolean(partsListOf(model));
}

// The prints a configuration or a parts list needs: { file id: count } (none when the archive is
// gone; files of a list that are gone or in the Trash do not count), stored in models.kit_needs
// for the lists
function refreshNeeds(model) {
  const needs = {};
  const list = !isConfiguration(model) && partsListOf(model);
  if (list) {
    const live = new Set(all('SELECT id FROM files WHERE model_id = ? AND deleted_at IS NULL', [model.id]).map(f => f.id));
    for (const f of list.files) if (f.qty > 0 && live.has(f.file_id)) needs[f.file_id] = (needs[f.file_id] || 0) + f.qty;
  } else {
    const parts = partsOf(model);
    if (parts) for (const p of parts.bom.parts) if (p.qty > 0) needs[p.file.id] = (needs[p.file.id] || 0) + p.qty;
  }
  run('UPDATE models SET kit_needs = ? WHERE id = ?', [JSON.stringify(needs), model.id], true);
  return needs;
}

function needsOf(model) {
  if (model.kit_needs) {
    try { return JSON.parse(model.kit_needs) || {}; } catch (e) { /* computed again */ }
  }
  const needs = refreshNeeds(model);
  saveDb();
  return needs;
}

// Progress of configurations and parts lists: { model id: { done, total } }. done counts the successful prints
// of each part up to what it needs.
function progressOf(models) {
  const configs = (models || []).filter(hasParts);
  const out = {};
  if (!configs.length) return out;
  const printed = {};
  for (const r of all(`SELECT model_id, file_id, COUNT(*) AS n FROM print_history
    WHERE successful = 1 AND file_id IS NOT NULL AND model_id IN (${configs.map(() => '?').join(',')}) GROUP BY model_id, file_id`, configs.map(m => m.id))) {
    printed[`${r.model_id}:${r.file_id}`] = r.n;
  }
  for (const m of configs) {
    const needs = needsOf(m);
    let done = 0;
    let total = 0;
    for (const [fileId, n] of Object.entries(needs)) {
      total += n;
      done += Math.min(n, printed[`${m.id}:${fileId}`] || 0);
    }
    out[m.id] = { done, total };
  }
  return out;
}

// What the ZIP of a configuration holds: the files to print (each once), the instruction PDFs
// when the configuration asks for them, and the parts list
function zipSelection(model) {
  const parts = partsOf(model);
  if (!parts) return null;
  const { bom, cat, source, kit } = parts;
  const ids = new Set(bom.parts.filter(p => p.qty > 0).map(p => p.file.id));
  if (bom.cfg.docs) for (const f of bom.manuals || cat.docs) ids.add(f.id);
  return {
    source,
    files: parts.files.filter(f => ids.has(f.id)),
    text: { name: `${model.name} parts list.txt`, content: kit.bomText(bom, `${source.name}: ${model.name}`, cat) }
  };
}

module.exports = { KIT, KITS, VaultKit, HeroMeKit, kitIdOf, refreshArchives, isConfiguration, configOf, readConfig, partsOf, partsListOf, hasParts, zipSelection, refreshNeeds, needsOf, progressOf };
