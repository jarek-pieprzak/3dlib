// File operations inside a project, on disk (the library share) and in the database:
// rename, move, new folder, delete (to the Trash) and renaming the project itself.
// Paths are relative to the project folder with "/" separators; "" is the project folder.
// A project made of one loose file in the library root has no folder: only its files can be
// renamed there.
const fs = require('fs');
const path = require('path');
const { get, all, run, saveDb } = require('../database');
const { LIBRARY_PATH } = require('../config');
const { getFileType, getScanStatus } = require('./library');
const trash = require('./trash');

class FsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Names that work on SMB shares (Windows rules) and that the scanner does not skip
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Name is required';
  if (name !== name.trim()) return 'Name cannot start or end with a space';
  if (name.length > 255) return 'Name is too long';
  if (name === '.' || name === '..' || name.startsWith('.')) return 'Name cannot start with a dot';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return 'Name cannot contain < > : " / \\ | ? *';
  if (name.endsWith('.')) return 'Name cannot end with a dot';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) return 'This name is reserved on Windows';
  return null;
}

function assertName(name) {
  const err = validateName(name);
  if (err) throw new FsError(400, err);
}

function assertNotScanning() {
  if (getScanStatus().isScanning) throw new FsError(409, 'A library scan is running, try again when it has finished');
}

function inLibrary(p) {
  return path.resolve(p).startsWith(path.resolve(LIBRARY_PATH) + path.sep);
}

// { root, isFolder } of a project that lives in the library, or null
function projectInfo(model) {
  if (!model || !model.library_path || !inLibrary(model.library_path)) return null;
  let stat;
  try { stat = fs.statSync(model.library_path); } catch (e) { return null; }
  return stat.isDirectory()
    ? { root: path.resolve(model.library_path), isFolder: true }
    : { root: path.dirname(path.resolve(model.library_path)), isFolder: false };
}

function requireProject(model) {
  const info = projectInfo(model);
  if (!info) throw new FsError(400, 'This model has no folder in the library');
  return info;
}

function requireFolder(info) {
  if (!info.isFolder) throw new FsError(400, 'A single-file project has no folders');
}

function resolveRel(info, rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (clean.split('/').some(s => s === '..')) throw new FsError(400, 'Invalid path');
  const abs = path.resolve(info.root, clean);
  if (abs !== info.root && !abs.startsWith(info.root + path.sep)) throw new FsError(400, 'Invalid path');
  return abs;
}

function relOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function exists(p) {
  try { fs.lstatSync(p); return true; } catch (e) { return false; }
}

// A rename that only changes letter case hits the same entry on case-insensitive shares
function sameEntry(a, b) {
  try {
    const sa = fs.statSync(a, { bigint: true });
    const sb = fs.statSync(b, { bigint: true });
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch (e) { return false; }
}

function assertFree(src, dest) {
  if (exists(dest) && !sameEntry(src, dest)) throw new FsError(409, `"${path.basename(dest)}" already exists there`);
}

function renameOnDisk(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (['EROFS', 'EACCES', 'EPERM'].includes(e.code)) throw new FsError(503, 'The library is read-only or not writable for 3DLib');
    throw e;
  }
}

// Point the database rows of `model` from oldAbs (a file, an archive or a folder) to newAbs.
// root is the project folder after the change.
function repointFiles(model, root, oldAbs, newAbs) {
  const rows = all('SELECT id, library_path, original_name, thumbnail FROM files WHERE model_id = ?', [model.id]);
  for (const r of rows) {
    const lp = r.library_path;
    if (!lp) continue;
    let rest = null;
    if (lp === oldAbs) rest = '';
    else if (lp.startsWith(oldAbs + path.sep) || lp.startsWith(oldAbs + '::')) rest = lp.slice(oldAbs.length);
    if (rest === null) continue;
    const newLp = newAbs + rest;
    if (newLp.includes('::')) { // entry inside an archive: keeps its name
      run('UPDATE files SET library_path = ? WHERE id = ?', [newLp, r.id], true);
      continue;
    }
    const newRel = relOf(root, newLp);
    const base = path.basename(newLp);
    const thumb = r.thumbnail && r.thumbnail === r.original_name ? newRel : r.thumbnail;
    run('UPDATE files SET library_path = ?, filename = ?, original_name = ?, file_type = ?, thumbnail = ? WHERE id = ?',
      [newLp, base, newRel, getFileType(base), thumb, r.id], true);
    // Images are the cover by their path relative to the project
    if (r.original_name !== newRel) run('UPDATE models SET thumbnail = ? WHERE id = ? AND thumbnail = ?', [newRel, model.id, r.original_name], true);
  }
  if (model.library_path === oldAbs) {
    run('UPDATE models SET library_path = ? WHERE id = ?', [newAbs, model.id], true);
    model.library_path = newAbs;
  }
  run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [model.id], true);
}

function renameEntry(model, rel, newName) {
  assertNotScanning();
  const info = requireProject(model);
  assertName(newName);
  const abs = resolveRel(info, rel);
  if (abs === info.root) throw new FsError(400, 'Rename the project in Edit');
  if (!exists(abs)) throw new FsError(404, 'Not found on disk');
  if (!info.isFolder && !get('SELECT id FROM files WHERE model_id = ? AND library_path = ?', [model.id, abs])) {
    throw new FsError(404, 'Not a file of this project');
  }
  const dest = path.join(path.dirname(abs), newName);
  if (dest === abs) return;
  assertFree(abs, dest);
  renameOnDisk(abs, dest);
  repointFiles(model, info.root, abs, dest);
  saveDb();
}

function moveEntries(model, rels, targetRel) {
  assertNotScanning();
  const info = requireProject(model);
  requireFolder(info);
  if (!Array.isArray(rels) || !rels.length) throw new FsError(400, 'Nothing to move');
  const target = resolveRel(info, targetRel);
  try { if (!fs.statSync(target).isDirectory()) throw new Error(); } catch (e) { throw new FsError(404, 'Target folder not found'); }

  const moves = [];
  for (const rel of rels) {
    const abs = resolveRel(info, rel);
    if (abs === info.root) throw new FsError(400, 'The project folder cannot be moved here');
    if (!exists(abs)) throw new FsError(404, `"${rel}" not found on disk`);
    if (target === abs || target.startsWith(abs + path.sep)) throw new FsError(400, 'A folder cannot be moved into itself');
    const dest = path.join(target, path.basename(abs));
    if (dest === abs) continue;
    if (moves.some(m => m.dest === dest)) throw new FsError(409, `Two items are called "${path.basename(abs)}"`);
    assertFree(abs, dest);
    moves.push({ abs, dest });
  }
  for (const { abs, dest } of moves) {
    renameOnDisk(abs, dest);
    repointFiles(model, info.root, abs, dest);
  }
  saveDb();
  return moves.length;
}

function makeFolder(model, parentRel, name) {
  assertNotScanning();
  const info = requireProject(model);
  requireFolder(info);
  assertName(name);
  const parent = resolveRel(info, parentRel);
  const dest = path.join(parent, name);
  if (exists(dest)) throw new FsError(409, `"${name}" already exists there`);
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (e) {
    if (['EROFS', 'EACCES', 'EPERM'].includes(e.code)) throw new FsError(503, 'The library is read-only or not writable for 3DLib');
    throw e;
  }
}

// Files go to the Trash; an empty folder (nothing indexed in it) is removed right away
function deleteEntries(model, rels) {
  assertNotScanning();
  const info = requireProject(model);
  if (!Array.isArray(rels) || !rels.length) throw new FsError(400, 'Nothing to delete');
  const rows = all('SELECT id, library_path, deleted_at FROM files WHERE model_id = ?', [model.id]);
  const fileIds = [];
  const emptyDirs = [];
  for (const rel of rels) {
    const abs = resolveRel(info, rel);
    if (abs === info.root) throw new FsError(400, 'Delete the whole project with the Delete button');
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch (e) { throw new FsError(404, `"${rel}" not found on disk`); }
    if (isDir) {
      const inside = rows.filter(r => r.library_path && r.library_path.startsWith(abs + path.sep));
      const active = inside.filter(r => !r.deleted_at);
      if (active.length) fileIds.push(...active.map(r => r.id));
      else if (!inside.length) emptyDirs.push(abs);
    } else {
      const row = rows.find(r => r.library_path === abs);
      if (!row) throw new FsError(404, `"${rel}" is not indexed yet, run Scan Library first`);
      if (!row.deleted_at) fileIds.push(row.id);
    }
  }
  for (const dir of emptyDirs) {
    trash.removeEmptyTree(dir);
    if (exists(dir)) throw new FsError(409, `"${relOf(info.root, dir)}" holds files that are not indexed yet, run Scan Library first`);
  }
  trash.trashFiles(fileIds);
  return { files: fileIds.length, folders: emptyDirs.length };
}

// "Benchy.gcode.3mf" -> "Benchy" (the scanner names loose-file projects the same way)
function stemOf(filename) {
  return filename.replace(/(\.gcode)?\.[^.]+$/i, '') || filename;
}

// Renaming a project renames its folder, or for a loose file the file and the same-named
// images and documents next to it ("Benchy.3mf" + "Benchy.jpg")
function renameProject(model, newName) {
  const info = projectInfo(model);
  if (!info || model.parent_id) return;
  assertNotScanning();
  assertName(newName);

  if (info.isFolder) {
    const dest = path.join(path.dirname(info.root), newName);
    if (dest === info.root) return;
    assertFree(info.root, dest);
    renameOnDisk(info.root, dest);
    repointFiles(model, dest, info.root, dest);
    saveDb();
    return;
  }

  const main = path.resolve(model.library_path);
  const oldStem = stemOf(path.basename(main));
  if (oldStem === newName) return;
  const rows = all('SELECT library_path FROM files WHERE model_id = ? AND library_path IS NOT NULL', [model.id])
    .map(r => r.library_path)
    .filter(lp => !lp.includes('::') && path.dirname(lp) === info.root && stemOf(path.basename(lp)).toLowerCase() === oldStem.toLowerCase());
  if (!rows.includes(main)) rows.push(main);
  const renames = rows.map(src => ({ src, dest: path.join(info.root, newName + path.basename(src).slice(oldStem.length)) }));
  for (const { src, dest } of renames) assertFree(src, dest);
  for (const { src, dest } of renames) {
    renameOnDisk(src, dest);
    repointFiles(model, info.root, src, dest);
  }
  saveDb();
}

// A project made of a loose file in the library root becomes a folder of the same name
// ("Benchy.3mf" + "Benchy.jpg" -> "Benchy/Benchy.3mf" + "Benchy/Benchy.jpg"), so it can hold
// new files and the .versions history. Returns the project folder.
function ensureProjectFolder(model) {
  const info = requireProject(model);
  if (info.isFolder) return info.root;
  const folder = path.join(info.root, stemOf(path.basename(model.library_path)));
  if (exists(folder)) throw new FsError(409, `"${path.basename(folder)}" already exists in the library`);
  const rows = all('SELECT library_path FROM files WHERE model_id = ? AND library_path IS NOT NULL', [model.id])
    .map(r => r.library_path)
    .filter(lp => !lp.includes('::') && path.dirname(lp) === info.root);
  try {
    fs.mkdirSync(folder);
  } catch (e) {
    if (['EROFS', 'EACCES', 'EPERM'].includes(e.code)) throw new FsError(503, 'The library is read-only or not writable for 3DLib');
    throw e;
  }
  for (const src of rows) {
    const dest = path.join(folder, path.basename(src));
    renameOnDisk(src, dest);
    repointFiles(model, folder, src, dest);
  }
  run('UPDATE models SET library_path = ? WHERE id = ?', [folder, model.id], true);
  model.library_path = folder;
  saveDb();
  return folder;
}

// Folders of a project for its file tree: every folder on disk except those that only hold
// files in the Trash. Empty folders are listed too, so they can get files or be removed.
function visibleFolders(model, files) {
  const info = projectInfo(model);
  if (!info || !info.isFolder) return [];
  const ancestors = (rel, set) => {
    const parts = String(rel).split('/');
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
  };
  const active = new Set();
  const deleted = new Set();
  for (const f of files) {
    if (!f.library_path || f.library_path.includes('::')) continue;
    ancestors(relOf(info.root, f.library_path), f.deleted_at ? deleted : active);
  }
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || out.length >= 5000) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (active.has(childRel) || !deleted.has(childRel)) out.push(childRel);
      walk(path.join(dir, e.name), childRel);
    }
  };
  walk(info.root, '');
  return out;
}

module.exports = {
  FsError, validateName, projectInfo, renameEntry, moveEntries, makeFolder, deleteEntries,
  renameProject, visibleFolders, ensureProjectFolder, stemOf, relOf, exists, assertNotScanning
};
