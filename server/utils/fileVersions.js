// File history: before a file is overwritten (a project saved by the slicer, a restored
// version) its content is copied to the project's hidden ".versions" folder:
//   <project>/.versions/<path of the file>/<YYYY-MM-DD HH-mm-ss>.<ext>
// The scanner skips dot folders. Only the newest file_versions_keep (default 10) are kept.
const fs = require('fs');
const path = require('path');
const { get, all, run, saveDb, UPLOADS_DIR } = require('../database');
const projectFiles = require('./projectFiles');

const DEFAULT_KEEP = 10;

function keepCount() {
  const row = get("SELECT value FROM system_settings WHERE key = 'file_versions_keep'");
  const n = row ? Number(row.value) : DEFAULT_KEEP;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_KEEP;
}

function projectRoot(model) {
  const info = projectFiles.projectInfo(model);
  return info && info.isFolder ? info.root : null;
}

function absPath(model, version) {
  const root = projectRoot(model);
  return root ? path.join(root, ...version.path.split('/')) : null;
}

function list(fileId) {
  return all('SELECT id, file_id, path, file_size, source, created_at FROM file_versions WHERE file_id = ? ORDER BY created_at DESC, id DESC', [fileId]);
}

// Size, thumbnail and G-code metadata of a file whose content changed
function refreshFileInfo(model, file) {
  const stat = fs.statSync(file.library_path);
  let thumbnail = file.thumbnail;
  let metadata = file.metadata;
  if (file.file_type === '3mf') {
    const { extract3mfThumbnail } = require('./3mf');
    thumbnail = extract3mfThumbnail(file.library_path, UPLOADS_DIR) || thumbnail;
  } else if (file.file_type === 'gcode') {
    const { parseGcodeMetadata, extractGcodeThumbnail } = require('./gcode');
    const meta = parseGcodeMetadata(file.library_path);
    if (meta) metadata = JSON.stringify(meta);
    thumbnail = extractGcodeThumbnail(file.library_path, UPLOADS_DIR) || thumbnail;
  }
  run('UPDATE files SET file_size = ?, thumbnail = ?, metadata = ? WHERE id = ?', [stat.size, thumbnail, metadata, file.id], true);
  if (thumbnail !== file.thumbnail) {
    run('UPDATE models SET thumbnail = ? WHERE id = ? AND (thumbnail IS NULL OR thumbnail = ?)', [thumbnail, model.id, file.thumbnail], true);
  }
  run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [model.id], true);
}

function prune(model, fileId) {
  for (const v of list(fileId).slice(keepCount())) remove(model, v);
}

function remove(model, version) {
  const p = absPath(model, version);
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { console.error('[Versions] Could not delete', p, e.message); }
  run('DELETE FROM file_versions WHERE id = ?', [version.id], true);
  if (p) {
    const root = projectRoot(model);
    require('./trash').removeEmptyDirs(path.dirname(p), path.join(root, '.versions'));
  }
}

// Keep the current content of `file` as a version, then copy `srcPath` over it
function replaceWithVersion(model, file, srcPath, source) {
  const root = projectRoot(model);
  if (!root) throw new projectFiles.FsError(400, 'Only files of a project folder have a history');
  const rel = projectFiles.relOf(root, file.library_path);
  const dir = path.join(root, '.versions', ...rel.split('/'));
  const ext = path.extname(file.library_path);
  const stamp = new Date().toISOString().replace('T', ' ').replace(/:/g, '-').slice(0, 19);
  let name = `${stamp}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stamp} (${i})${ext}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file.library_path, path.join(dir, name));
    fs.copyFileSync(srcPath, file.library_path);
  } catch (e) {
    if (['EROFS', 'EACCES', 'EPERM'].includes(e.code)) throw new projectFiles.FsError(503, 'The library is read-only or not writable for GyroidVault');
    throw e;
  }
  const size = fs.statSync(path.join(dir, name)).size;
  run('INSERT INTO file_versions (file_id, path, file_size, source) VALUES (?, ?, ?, ?)',
    [file.id, `.versions/${rel}/${name}`, size, source], true);
  refreshFileInfo(model, file);
  prune(model, file.id);
  saveDb();
}

function restore(model, file, versionId) {
  const version = get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', [Number(versionId), file.id]);
  if (!version) throw new projectFiles.FsError(404, 'Version not found');
  const p = absPath(model, version);
  if (!p || !fs.existsSync(p)) throw new projectFiles.FsError(404, 'The version is no longer on disk');
  // The version stays in the history; the content it replaces becomes a version too
  const tmp = `${p}.restoring`;
  fs.copyFileSync(p, tmp);
  try {
    replaceWithVersion(model, file, tmp, 'restore');
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* gone */ }
  }
}

// All versions of a file go when the file is purged
function removeAll(model, fileId) {
  for (const v of list(fileId)) remove(model, v);
}

module.exports = { DEFAULT_KEEP, keepCount, list, absPath, replaceWithVersion, restore, remove, removeAll, refreshFileInfo };
