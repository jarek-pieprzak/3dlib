// Slicer round trips. "Open in slicer" links end with "<name>_gv-<token>.<ext>"; the slicer
// downloads the file into its save folder, the library's hidden ".slicer-saves", and saves the
// project there under the same name. Every 30 s this folder is checked:
//  * a file identical to what a link sent is only the download: ignored;
//  * a changed file whose token (or, without one, its unique name) matches a library file
//    replaces that file once it has not changed for slicer_quiet_minutes (default 5); the old
//    content goes to the file's history (.versions). A 3MF saved from an STL becomes
//    "<name>.3mf" next to it and the model's main file;
//  * a file that matches nothing waits on the "Slicer saves" page to be assigned by hand.
// Files are copied, never moved, so a slicer that keeps the project open can save again.
// Downloads and imported files are deleted slicer_cleanup_days (default 1) after the last save,
// older copies of a file saved again at once.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { get, all, run, saveDb } = require('../database');
const { LIBRARY_PATH } = require('../config');
const { tokenFromName, fileByToken, newToken } = require('../utils/slicerToken');
const { hashFileStream } = require('../utils/modelHelpers');
const { getFileType } = require('../utils/library');
const projectFiles = require('../utils/projectFiles');
const fileVersions = require('../utils/fileVersions');

const SAVES_DIR = path.join(LIBRARY_PATH, '.slicer-saves');
const SAVE_EXTS = ['.3mf', '.stl', '.step', '.stp', '.obj', '.gcode', '.bgcode'];
const INTERVAL_MS = 30000;

function numberSetting(key, def) {
  const row = get('SELECT value FROM system_settings WHERE key = ?', [key]);
  const n = row ? Number(row.value) : def;
  return Number.isFinite(n) && n >= 0 ? n : def;
}
const quietMinutes = () => numberSetting('slicer_quiet_minutes', 5);
const cleanupDays = () => numberSetting('slicer_cleanup_days', 1);

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// What an "Open in slicer" link sent: a later file with the same content is that download
function recordDownload(fileId, hash) {
  if (hash) run('INSERT OR REPLACE INTO slicer_downloads (hash, file_id) VALUES (?, ?)', [hash, fileId]);
}

function activeFile(id) {
  return id ? get(`SELECT f.* FROM files f JOIN models m ON m.id = f.model_id
    WHERE f.id = ? AND f.deleted_at IS NULL AND m.deleted_at IS NULL AND f.library_path IS NOT NULL AND f.library_path NOT LIKE '%::%'`, [id]) : null;
}

// "Xmas_tree_150_gv-udh2zend(2).3mf" -> "Xmas tree 150.3mf"
function cleanName(name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length)
    .replace(/[_ ]?gv-[a-z2-9]{8}/i, '').replace(/\s*\(\d+\)$/, '').replace(/_+/g, ' ').trim();
  return (stem || 'Slicer save') + ext.toLowerCase();
}

// The library file a save belongs to: by its token, else the one file with exactly that name
function matchSave(name) {
  const token = tokenFromName(name);
  if (token) {
    const f = fileByToken(token);
    return activeFile(f && f.id);
  }
  const stem = cleanName(name).replace(/\.[^.]+$/, '').toLowerCase();
  const rows = all(`SELECT f.id, f.filename FROM files f JOIN models m ON m.id = f.model_id
    WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL AND f.library_path IS NOT NULL AND f.library_path NOT LIKE '%::%'
      AND LOWER(f.filename) LIKE ?`, [`${stem}.%`])
    .filter(f => f.filename.replace(/\.[^.]+$/, '').toLowerCase() === stem);
  return rows.length === 1 ? activeFile(rows[0].id) : null;
}

// A new file in a project folder, indexed like the scanner does
function addFile(model, srcPath, destPath, { makeMain = false } = {}) {
  if (projectFiles.exists(destPath)) throw new projectFiles.FsError(409, `"${path.basename(destPath)}" already exists there`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const root = projectFiles.projectInfo(model).root;
  const filename = path.basename(destPath);
  const ft = getFileType(filename);
  const r = run('INSERT INTO files (model_id, filename, original_name, file_type, file_size, library_path, slicer_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [model.id, filename, projectFiles.relOf(root, destPath), ft, fs.statSync(destPath).size, destPath, newToken()], true);
  const file = get('SELECT * FROM files WHERE id = ?', [r.lastId]);
  fileVersions.refreshFileInfo(model, file);
  if (makeMain && ['stl', '3mf', 'step', 'obj'].includes(ft)) run('UPDATE models SET preview_file_id = ? WHERE id = ?', [file.id, model.id], true);
  saveDb();
  return file;
}

// Bring a saved file into the library as a new version of `target`. A save of another type
// (an STL saved as a 3MF) goes to "<name>.<ext>" next to the target instead.
function importSave(savePath, target) {
  projectFiles.assertNotScanning();
  const model = get('SELECT * FROM models WHERE id = ?', [target.model_id]);
  projectFiles.ensureProjectFolder(model); // a loose file becomes a folder first
  const file = get('SELECT * FROM files WHERE id = ?', [target.id]);
  const saveExt = path.extname(savePath).toLowerCase();
  if (path.extname(file.library_path).toLowerCase() === saveExt) {
    fileVersions.replaceWithVersion(model, file, savePath, 'slicer');
    return { fileId: file.id, message: `New version of ${file.original_name}` };
  }
  const sibling = path.join(path.dirname(file.library_path), projectFiles.stemOf(file.filename) + saveExt);
  const existing = get('SELECT * FROM files WHERE library_path = ? AND deleted_at IS NULL', [sibling]);
  if (existing) {
    fileVersions.replaceWithVersion(model, existing, savePath, 'slicer');
    return { fileId: existing.id, message: `New version of ${existing.original_name}` };
  }
  const added = addFile(model, savePath, sibling, { makeMain: true });
  return { fileId: added.id, message: `Added ${added.original_name}` };
}

// Passes run one after another: a pass asked for while one runs (the timer, "Import now")
// waits for it instead of being dropped
let queue = Promise.resolve();
function processSaves(opts) {
  const pass = queue.then(() => processOnce(opts));
  queue = pass.catch(() => {});
  return pass;
}

// The library file a save would replace (null: the save adds a new file next to the target)
function destinationOf(target, saveExt) {
  if (path.extname(target.library_path).toLowerCase() === saveExt) return target;
  const sibling = path.join(path.dirname(target.library_path), projectFiles.stemOf(target.filename) + saveExt);
  return get('SELECT * FROM files WHERE library_path = ? AND deleted_at IS NULL', [sibling]);
}

// Statuses whose file holds nothing the library does not have
const SPENT = ['download', 'imported', 'superseded'];

async function removeSave(rec) {
  try { await fsp.unlink(savePath(rec)); } catch (err) { if (err.code !== 'ENOENT') return false; }
  run('DELETE FROM slicer_saves WHERE id = ?', [rec.id], true);
  return true;
}

// One pass over the save folder. importNow: ids of saves to import without waiting
async function processOnce({ importNow = [] } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(SAVES_DIR, { withFileTypes: true });
  } catch (e) {
    try { await fsp.mkdir(SAVES_DIR); } catch (err) { /* read-only library: nothing to watch */ }
    entries = [];
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.') || !SAVE_EXTS.includes(path.extname(e.name).toLowerCase())) continue;
    try { files.push({ name: e.name, p: path.join(SAVES_DIR, e.name), st: await fsp.stat(path.join(SAVES_DIR, e.name)) }); } catch (err) { /* gone */ }
  }
  // Oldest first: when the slicer saved one file twice ("Lamp_gv-x.3mf", "Lamp_gv-x(2).3mf"),
  // the newest save is imported last and stays the library file
  files.sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);

  const seen = new Set(files.map(f => f.name));
  for (const { name, p, st } of files) {
    let rec = get('SELECT * FROM slicer_saves WHERE name = ?', [name]);
    if (!rec) {
      run('INSERT INTO slicer_saves (name) VALUES (?)', [name], true);
      rec = get('SELECT * FROM slicer_saves WHERE name = ?', [name]);
    }
    const mtime = Math.floor(st.mtimeMs);
    let hash = rec.hash;
    if (!hash || rec.file_size !== st.size || rec.mtime_ms !== mtime) {
      try { hash = await hashFileStream(p); } catch (err) { continue; }
      run('UPDATE slicer_saves SET file_size = ?, mtime_ms = ?, hash = ? WHERE id = ?', [st.size, mtime, hash, rec.id], true);
    }

    const target = matchSave(name);
    const destination = target && destinationOf(target, path.extname(name).toLowerCase());
    let status;
    let message = null;
    if (hash === rec.imported_hash) {
      status = 'imported';
      message = rec.message;
    } else if (get('SELECT hash FROM slicer_downloads WHERE hash = ?', [hash])) {
      status = 'download';
    } else if (!target) {
      status = 'unmatched';
    } else if (destination && destination.slicer_saved_at && mtime < destination.slicer_saved_at) {
      // A newer save of this file is in the library already: do not go back to this one
      status = 'superseded';
      message = 'A newer save of this file is already in the library';
    } else if (Date.now() - st.mtimeMs >= quietMinutes() * 60000 || importNow.includes(rec.id)) {
      try {
        const r = importSave(p, target);
        run("UPDATE slicer_saves SET imported_hash = ?, imported_file_id = ?, imported_at = datetime('now') WHERE id = ?", [hash, r.fileId, rec.id], true);
        run('UPDATE files SET slicer_saved_at = ? WHERE id = ?', [mtime, r.fileId], true);
        status = 'imported';
        message = r.message;
      } catch (err) {
        status = 'error';
        message = err.message;
        if (!(err instanceof projectFiles.FsError)) console.error('[Slicer saves] Import failed:', err);
      }
    } else {
      status = 'pending';
    }
    run('UPDATE slicer_saves SET status = ?, file_id = ?, message = ? WHERE id = ?', [status, target ? target.id : null, message, rec.id], true);
  }

  // Spent copies go: older copies of a file saved again at once (the slicer names a new download
  // "(2)" while the old one is still here), the others after slicer_cleanup_days. Deleting is
  // safe: a slicer that still has the project open writes the file again on its next save.
  const days = cleanupDays();
  const newestByToken = {};
  const rows = all('SELECT * FROM slicer_saves ORDER BY mtime_ms');
  for (const r of rows) {
    const token = tokenFromName(r.name);
    if (token) newestByToken[token] = r.id;
  }
  for (const r of rows) {
    if (!seen.has(r.name) || !SPENT.includes(r.status)) continue;
    const token = tokenFromName(r.name);
    const replaced = token && newestByToken[token] !== r.id;
    const old = days > 0 && Date.now() - r.mtime_ms > days * 86400000;
    if ((replaced || old) && await removeSave(r)) seen.delete(r.name);
  }

  for (const r of all('SELECT id, name FROM slicer_saves')) {
    if (!seen.has(r.name)) run('DELETE FROM slicer_saves WHERE id = ?', [r.id], true);
  }
  run("DELETE FROM slicer_downloads WHERE created_at < datetime('now', '-90 days')", [], true);
  saveDb();
  return true;
}

// "Clean up now": every file that holds nothing new
async function cleanupNow() {
  await processSaves();
  let removed = 0;
  for (const r of all(`SELECT * FROM slicer_saves WHERE status IN (${SPENT.map(() => '?').join(',')})`, SPENT)) {
    if (await removeSave(r)) removed++;
  }
  saveDb();
  return removed;
}

function savePath(rec) {
  return path.join(SAVES_DIR, path.basename(rec.name));
}

// Assign a save by hand: as a new version of a file, or as a new file in a model
function assignToFile(rec, fileId) {
  const target = activeFile(fileId);
  if (!target) throw new projectFiles.FsError(404, 'File not found');
  const r = importSave(savePath(rec), target);
  run('UPDATE files SET slicer_saved_at = ? WHERE id = ?', [rec.mtime_ms, r.fileId], true);
  run("UPDATE slicer_saves SET status = 'imported', imported_hash = hash, imported_file_id = ?, imported_at = datetime('now'), message = ? WHERE id = ?", [r.fileId, r.message, rec.id]);
  return r;
}

function addToModel(rec, modelId) {
  projectFiles.assertNotScanning();
  const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [Number(modelId)]);
  if (!model) throw new projectFiles.FsError(404, 'Model not found');
  const folder = projectFiles.ensureProjectFolder(model);
  const file = addFile(model, savePath(rec), path.join(folder, cleanName(rec.name)));
  const message = `Added ${file.original_name}`;
  run("UPDATE slicer_saves SET status = 'imported', imported_hash = hash, imported_file_id = ?, imported_at = datetime('now'), message = ? WHERE id = ?", [file.id, message, rec.id]);
  return { fileId: file.id, modelId: model.id, message };
}

// A new project folder in the library root, named after the save
function newModel(rec, userId) {
  projectFiles.assertNotScanning();
  const name = cleanName(rec.name);
  const stem = name.replace(/\.[^.]+$/, '');
  const err = projectFiles.validateName(stem);
  if (err) throw new projectFiles.FsError(400, err);
  const folder = path.join(LIBRARY_PATH, stem);
  if (projectFiles.exists(folder)) throw new projectFiles.FsError(409, `"${stem}" already exists in the library`);
  fs.mkdirSync(folder);
  const r = run('INSERT INTO models (name, library_path, user_id) VALUES (?, ?, ?)', [stem, folder, userId || null], true);
  const model = get('SELECT * FROM models WHERE id = ?', [r.lastId]);
  const file = addFile(model, savePath(rec), path.join(folder, name), { makeMain: true });
  const message = `New model ${stem}`;
  run("UPDATE slicer_saves SET status = 'imported', imported_hash = hash, imported_file_id = ?, imported_at = datetime('now'), message = ? WHERE id = ?", [file.id, message, rec.id]);
  return { fileId: file.id, modelId: model.id, message };
}

let intervalId = null;
function start() {
  if (intervalId) return;
  const tick = () => processSaves().catch(e => console.error('[Slicer saves] Error:', e));
  setTimeout(tick, 5000);
  intervalId = setInterval(tick, INTERVAL_MS);
}
function stop() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

module.exports = {
  SAVES_DIR, hashBuffer, recordDownload, processSaves, cleanupNow, importSave, assignToFile, addToModel, newModel,
  cleanName, savePath, quietMinutes, cleanupDays, start, stop
};
