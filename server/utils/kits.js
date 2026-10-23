// Kit configurators on the server. The kits are the browser's code (public/js/kits/*), loaded
// here too, so both always agree.
//  * An archive: a project whose files a kit recognises (VaultKit.detect). It gets
//    models.kit_archive and becomes read-only the first time it is recognised: the app never
//    changes its files. Turning read-only off in Edit sticks, it is not turned on again.
//  * A configuration: a model without files of its own. kit_source_id is the model of the
//    archive, kit_config the choices (JSON). Its parts are files of the archive, so they keep
//    the archive's access rules.
const { get, all, run, saveDb } = require('../database');
require('../../public/js/kits/ussa-vault.js');

const VaultKit = globalThis.VaultKit;
const KIT = 'ussa-vault';
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
    if (!VaultKit.detect(archiveFiles(id))) continue;
    run('UPDATE models SET kit_archive = ?, is_readonly = 1 WHERE id = ?', [KIT, id], true);
    found++;
  }
  if (found) saveDb();
  return found;
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

// The archive of a configuration and its parts list: { source, files, bom }, or null when the
// archive is gone or in the Trash
function partsOf(model) {
  const source = get('SELECT * FROM models WHERE id = ?', [model.kit_source_id]);
  if (!source || source.deleted_at) return null;
  const files = archiveFiles(source.id);
  const cat = VaultKit.buildCatalog(files);
  return { source, files, cat, bom: VaultKit.computeBom(cat, configOf(model)) };
}

// What the ZIP of a configuration holds: the files to print (each once), the instruction PDFs
// when the configuration asks for them, and the parts list
function zipSelection(model) {
  const parts = partsOf(model);
  if (!parts) return null;
  const { bom, cat, source } = parts;
  const ids = new Set(bom.parts.filter(p => p.qty > 0).map(p => p.file.id));
  if (bom.cfg.docs) for (const f of cat.docs) ids.add(f.id);
  return {
    source,
    files: parts.files.filter(f => ids.has(f.id)),
    text: { name: `${model.name} parts list.txt`, content: VaultKit.bomText(bom, `${source.name}: ${model.name}`) }
  };
}

module.exports = { KIT, VaultKit, refreshArchives, isConfiguration, configOf, readConfig, partsOf, zipSelection };
