// Trash: deleting a model or a file only flags it (deleted_at); the file stays where it is on
// disk. Flagged rows are hidden everywhere except the Trash views. After the retention period
// (system setting trash_retention_days, default 30, 0 = keep forever) the background sync
// deletes them from disk and from the database.
const fs = require('fs');
const path = require('path');
const { get, all, run, saveDb, UPLOADS_DIR } = require('../database');
const { LIBRARY_PATH } = require('../config');
const { isIgnoredFile } = require('./library');

const DEFAULT_RETENTION_DAYS = 30;

function retentionDays() {
  const row = get("SELECT value FROM system_settings WHERE key = 'trash_retention_days'");
  const days = row ? Number(row.value) : DEFAULT_RETENTION_DAYS;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_RETENTION_DAYS;
}

function ids(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

function inLibrary(p) {
  const resolved = path.resolve(p);
  return resolved.startsWith(path.resolve(LIBRARY_PATH) + path.sep);
}

// Entries indexed inside an archive share its fate (LIKE wildcards are confirmed in JS)
function archiveEntryIds(file) {
  if (!file.library_path || file.library_path.includes('::')) return [];
  const prefix = file.library_path + '::';
  return all('SELECT id, library_path FROM files WHERE library_path LIKE ?', [prefix + '%'])
    .filter(e => e.library_path.startsWith(prefix)).map(e => e.id);
}

function trashFiles(fileIds) {
  const list = ids(fileIds);
  for (const id of list) {
    const f = get('SELECT id, model_id, thumbnail, library_path FROM files WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!f) continue;
    for (const entryId of [id, ...archiveEntryIds(f)]) {
      run("UPDATE files SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL", [entryId], true);
    }
    // A deleted image must not stay the model's cover
    if (f.thumbnail) run('UPDATE models SET thumbnail = NULL WHERE id = ? AND thumbnail = ?', [f.model_id, f.thumbnail], true);
    run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [f.model_id], true);
  }
  saveDb();
  return list.length;
}

function restoreFiles(fileIds) {
  const list = ids(fileIds);
  for (const id of list) {
    const f = get('SELECT id, model_id, thumbnail, library_path FROM files WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!f) continue;
    for (const entryId of [id, ...archiveEntryIds(f)]) run('UPDATE files SET deleted_at = NULL WHERE id = ?', [entryId], true);
    if (f.thumbnail) run('UPDATE models SET thumbnail = ? WHERE id = ? AND thumbnail IS NULL', [f.thumbnail, f.model_id], true);
  }
  saveDb();
  return list.length;
}

function trashModels(modelIds) {
  const list = ids(modelIds);
  for (const id of list) run("UPDATE models SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL", [id], true);
  saveDb();
  return list.length;
}

function restoreModels(modelIds) {
  const list = ids(modelIds);
  for (const id of list) run('UPDATE models SET deleted_at = NULL WHERE id = ?', [id], true);
  saveDb();
  return list.length;
}

// Remove `dir` and its parents while they are empty (system clutter does not count), never
// going above `stopAt` or the library root
function removeEmptyDirs(dir, stopAt) {
  const root = path.resolve(LIBRARY_PATH);
  const limit = stopAt ? path.resolve(stopAt) : root;
  let current = path.resolve(dir);
  while (current !== root && (current === limit || current.startsWith(limit + path.sep)) && inLibrary(current)) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
    if (entries.some(e => e.isDirectory() || !isIgnoredFile(e.name))) return;
    try {
      for (const e of entries) fs.unlinkSync(path.join(current, e.name));
      fs.rmdirSync(current);
    } catch (e) { return; }
    current = path.dirname(current);
  }
}

function unlinkQuietly(p) {
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.unlinkSync(p); } catch (e) { console.error('[Trash] Could not delete', p, e.message); }
}

// Delete one file from disk and from the database
function purgeFileRow(file, stopAt) {
  const isEntry = file.is_archive_entry || (file.library_path && file.library_path.includes('::'));
  if (!isEntry) {
    if (file.library_path && inLibrary(file.library_path)) {
      unlinkQuietly(file.library_path);
      for (const entryId of archiveEntryIds(file)) run('DELETE FROM files WHERE id = ?', [entryId], true);
      removeEmptyDirs(path.dirname(file.library_path), stopAt);
    } else if (!file.library_path && file.filename) {
      unlinkQuietly(path.join(UPLOADS_DIR, path.basename(file.filename)));
    }
  }
  run('DELETE FROM files WHERE id = ?', [file.id], true);
}

function projectRoot(model) {
  if (!model || !model.library_path || !inLibrary(model.library_path)) return null;
  try { return fs.statSync(model.library_path).isDirectory() ? model.library_path : path.dirname(model.library_path); } catch (e) { return null; }
}

function purgeFiles(fileIds) {
  let count = 0;
  for (const id of ids(fileIds)) {
    const file = get('SELECT * FROM files WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!file) continue;
    const model = get('SELECT id, library_path FROM models WHERE id = ?', [file.model_id]);
    require('./fileVersions').removeAll(model, file.id);
    purgeFileRow(file, projectRoot(model));
    count++;
  }
  saveDb();
  return count;
}

function purgeModels(modelIds) {
  const { deleteModelInternal } = require('./modelHelpers');
  let count = 0;
  for (const id of ids(modelIds)) {
    const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!model) continue;
    const files = all('SELECT * FROM files WHERE model_id = ?', [id]);
    run('DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE model_id = ?)', [id], true);
    for (const f of files) purgeFileRow(f, null);
    if (model.library_path && inLibrary(model.library_path)) {
      try {
        if (fs.statSync(model.library_path).isDirectory()) {
          // The file history of the project goes with it
          fs.rmSync(path.join(model.library_path, '.versions'), { recursive: true, force: true });
          removeEmptyTree(model.library_path);
        }
      } catch (e) { /* gone */ }
    }
    deleteModelInternal(id, false);
    count++;
  }
  saveDb();
  return count;
}

// Remove the empty folders of a purged project folder, deepest first
function removeEmptyTree(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) removeEmptyTree(path.join(dir, e.name));
  removeEmptyDirs(dir, dir);
}

// Called by the background sync: everything that has been in the Trash longer than the
// retention period is deleted for good
function purgeExpired() {
  const days = retentionDays();
  if (days <= 0) return { models: 0, files: 0 };
  const cutoff = `-${days} days`;
  const modelIds = all("SELECT id FROM models WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', ?)", [cutoff]).map(r => r.id);
  const fileIds = all(`SELECT f.id FROM files f JOIN models m ON m.id = f.model_id
    WHERE f.deleted_at IS NOT NULL AND f.deleted_at <= datetime('now', ?) AND m.deleted_at IS NULL`, [cutoff]).map(r => r.id);
  return { models: purgeModels(modelIds), files: purgeFiles(fileIds) };
}

module.exports = {
  DEFAULT_RETENTION_DAYS, retentionDays, trashFiles, restoreFiles, trashModels, restoreModels,
  purgeFiles, purgeModels, purgeExpired, removeEmptyDirs, removeEmptyTree
};
