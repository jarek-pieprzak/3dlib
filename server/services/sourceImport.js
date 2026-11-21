// Copies a model's source page into its project folder, so it stays when the page changes or
// goes: README.md (who made it, the description, print profiles or settings, hardware), the
// pictures under images/, the attached documents (PDF manuals) and the model files (STLs,
// G-codes, profile 3MFs, raw files). Sites: MakerWorld and Printables (server/utils/sources/).
// MakerWorld gives its files only to a logged-in user: the Bambu Lab login of the user who saved
// the model (utils/bambuAccount.js); without it the page's documentation is copied, not its files.
//
// It starts by itself when a model is saved with such a Source URL (a new URL, or one whose last
// copy failed) and runs in the background; "Check for updates" on the model page runs it again
// (POST /api/models/:id/source-import). models.source_import keeps the outcome for the model page:
// { url, site, status: 'running' | 'done' | 'error', at, message, files: 'login_needed' |
// 'login_refused' }.
//  * Pictures and documents already in the folder stay; a download the project already has under
//    another name or folder (same content) is dropped and the README links that file.
//  * The first copy never replaces a file already in the folder (it may be the user's own).
//    "Check for updates" replaces a model file whose size on the site differs from the one in the
//    folder (or, when the site does not say, whose content differs); the old content goes to the
//    file's history (.versions), like a slicer save. A ZIP of raw files is unpacked the same way,
//    entry by entry.
//  * A README that 3DLib did not write is kept: the copy goes to "<Site>.md" next to it.
//  * A project made of one loose file becomes a folder first; read-only projects are left alone.
//  * Tags of the page are added; hardware fills the Parts tab when it has no list yet.
const fs = require('fs');
const path = require('path');
const { get, all, run, saveDb } = require('../database');
const { DATA_DIR } = require('../config');
const { getFileType, getScanStatus, isIgnoredFile } = require('../utils/library');
const projectFiles = require('../utils/projectFiles');
const fileVersions = require('../utils/fileVersions');
const bambuAccount = require('../utils/bambuAccount');
const { sourceOf } = require('../utils/sources');
const { assetsOf, buildReadme, hasMarker } = require('../utils/sources/common');
const http = require('../utils/sources/http');
const { tagIdFor, logEvent, hashFileStream } = require('../utils/modelHelpers');
const { newToken } = require('../utils/slicerToken');

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const running = new Set();

function statusOf(model) {
  try { return model && model.source_import ? JSON.parse(model.source_import) : null; } catch (e) { return null; }
}

function setStatus(modelId, status) {
  run('UPDATE models SET source_import = ? WHERE id = ?', [JSON.stringify({ ...status, at: new Date().toISOString() }), modelId], true);
  saveDb();
}

// A hidden ".<name>.part" next to the destination: the scanner skips dotfiles
const partOf = (dest) => path.join(path.dirname(dest), `.${path.basename(dest)}.part`);

// Into `part` (the caller renames it or drops it)
async function download(url, part, opts) {
  fs.mkdirSync(path.dirname(part), { recursive: true });
  const res = await http.open(url, opts);
  let size = 0;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part);
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) res.destroy(new Error('The file is too large'));
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
  } catch (e) {
    try { fs.unlinkSync(part); } catch (x) { /* never written */ }
    throw e;
  }
}

// ─── Into the project ────────────────────────────────────────────────────────

// The database row of a file in the project folder: indexed like the scanner does (with the
// thumbnail of a 3MF / G-code), a row in the Trash comes back (the import asked for it again)
function indexFile(model, root, abs) {
  const size = fs.statSync(abs).size;
  const row = get('SELECT * FROM files WHERE library_path = ?', [abs]);
  if (row) {
    run('UPDATE files SET file_size = ?, deleted_at = NULL WHERE id = ?', [size, row.id], true);
    return row.id;
  }
  const filename = path.basename(abs);
  const r = run('INSERT INTO files (model_id, filename, original_name, file_type, file_size, library_path, slicer_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [model.id, filename, projectFiles.relOf(root, abs), getFileType(filename), size, abs, newToken()], true);
  const file = get('SELECT * FROM files WHERE id = ?', [r.lastId]);
  if (['3mf', 'gcode'].includes(file.file_type)) {
    try { fileVersions.refreshFileInfo(model, file); } catch (e) { /* the scanner reads it later */ }
  }
  return r.lastId;
}

async function sameFile(a, b) {
  return fs.statSync(a).size === fs.statSync(b).size && (await hashFileStream(a)) === (await hashFileStream(b));
}

// A file of the project with the same content (the manual saved by hand under another name or in
// another folder), or null. candidates: absolute paths; same size first, then SHA-256.
async function sameContent(file, candidates) {
  const size = fs.statSync(file).size;
  let hash = null;
  for (const c of candidates) {
    let st;
    try { st = fs.statSync(c); } catch (e) { continue; }
    if (st.size !== size) continue;
    hash = hash || await hashFileStream(file);
    if (await hashFileStream(c) === hash) return c;
  }
  return null;
}

function writeText(dest, text) {
  const part = partOf(dest);
  fs.writeFileSync(part, text, 'utf8');
  fs.renameSync(part, dest);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForScan() {
  for (let i = 0; i < 900 && getScanStatus().isScanning; i++) await sleep(2000);
  projectFiles.assertNotScanning();
}

function addTags(model, tags) {
  let added = 0;
  for (const t of tags || []) {
    const name = String(t || '').trim().slice(0, 60);
    if (!name) continue;
    const r = run('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)', [model.id, tagIdFor(name)], true);
    if (r && r.changes) added++;
  }
  return added;
}

// The hardware of the page as the Parts tab's list, when the project has none yet
function fillPartsList(model, hardware, site) {
  if (!hardware.length || get('SELECT parts_list FROM models WHERE id = ?', [model.id]).parts_list) return false;
  const list = {
    files: [],
    hardware: hardware.map(h => ({ name: h.name, qty: h.qty, have: false })),
    notes: [`Hardware from ${site}.`, ...hardware.filter(h => h.note).map(h => `${h.name}: ${h.note}`)].join('\n')
  };
  run('UPDATE models SET parts_list = ?, kit_needs = NULL WHERE id = ?', [JSON.stringify(list), model.id], true);
  require('../utils/kits').refreshNeeds(get('SELECT * FROM models WHERE id = ?', [model.id]));
  return true;
}

// The entries of a ZIP: [{ rel, read(dest) }] (folders, system clutter and unsafe paths left out)
function zipEntries(zipPath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('entry', (e) => {
        const parts = String(e.fileName).replace(/\\/g, '/').split('/').filter(Boolean);
        const safe = parts.length && !parts.some(p => p === '..' || p === '.' || p.startsWith('.') || p === '__MACOSX' || /[<>:"|?*\x00-\x1f]/.test(p));
        if (!/\/$/.test(e.fileName) && safe && !isIgnoredFile(parts[parts.length - 1])) {
          entries.push({
            rel: parts.join('/'),
            read: (dest) => new Promise((ok, bad) => zip.openReadStream(e, (er, stream) => {
              if (er) return bad(er);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              const out = fs.createWriteStream(dest);
              stream.on('error', bad);
              out.on('error', bad);
              out.on('finish', ok);
              stream.pipe(out);
            }))
          });
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve({ entries, close: () => zip.close() }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// The page of the site, with errors in words for the model page
async function loadPage(source, id, userId) {
  const token = source.usesBambuLogin ? await bambuAccount.tokenFor(userId) : null;
  try {
    const page = await source.load(id, http, { token });
    if (token && page.filesNote === 'login_refused') { bambuAccount.mark(userId, 'invalid'); saveDb(); }
    else if (token && page.files && page.files.length) bambuAccount.mark(userId, 'ok');
    return page;
  } catch (e) {
    if (e.status === 403 || e.status === 429) throw new Error(`${source.site} refused the request (${e.message}); try again later`);
    if (e.status === 404) throw new Error(`${source.site} has no model with this number`);
    if (e.status || e.code) throw new Error(`${source.site} could not be reached: ${e.message}`);
    throw e;
  }
}

async function importPage(modelId, found, userId, force) {
  const { source, id } = found;
  const page = await loadPage(source, id, userId);

  await waitForScan();
  const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [modelId]);
  if (!model) throw new Error('The model is gone');
  const root = projectFiles.ensureProjectFolder(model); // read-only: FsError; a loose file: a folder now
  model.library_path = root;

  const local = new Map();
  const failed = [];
  const reused = [];
  const counts = { description: 0, gallery: 0, document: 0, model: 0, archive: 0 };
  let updated = 0;
  const touched = [];
  const own = all("SELECT library_path FROM files WHERE model_id = ? AND deleted_at IS NULL AND library_path IS NOT NULL AND library_path NOT LIKE '%::%'", [modelId])
    .map(f => f.library_path);

  // A downloaded file (at `part`) for `dest`: kept when the project has its content, put in place
  // when new; replace: a different file at `dest` is replaced (its old content to the history),
  // else it stays
  const place = async (part, dest, replace) => {
    if (projectFiles.exists(dest)) {
      if (!replace || await sameFile(part, dest)) { fs.unlinkSync(part); return { rel: projectFiles.relOf(root, dest) }; }
      const row = get('SELECT * FROM files WHERE library_path = ? AND model_id = ?', [dest, modelId]);
      if (row) {
        try { fileVersions.replaceWithVersion(model, row, part, source.site); } finally { try { fs.unlinkSync(part); } catch (e) { /* moved */ } }
      } else {
        fs.renameSync(part, dest);
      }
      updated++;
      touched.push(dest);
      return { rel: projectFiles.relOf(root, dest) };
    }
    const twin = await sameContent(part, own);
    if (twin) {
      fs.unlinkSync(part);
      const rel = projectFiles.relOf(root, twin);
      reused.push(rel);
      return { rel };
    }
    fs.renameSync(part, dest);
    touched.push(dest);
    own.push(dest);
    return { rel: projectFiles.relOf(root, dest) };
  };

  for (const asset of assetsOf(page, source.isAsset)) {
    const dest = path.join(root, ...asset.rel.split('/'));
    const part = partOf(dest);
    const opts = { allow: source.isAsset };
    try {
      if (asset.kind === 'archive') {
        // Raw files: into the folder entry by entry, the ZIP itself is not kept
        const tmp = path.join(DATA_DIR, 'tmp', `source-${modelId}-${Date.now()}.zip`);
        await download(asset.url, tmp, opts);
        try {
          const zip = await zipEntries(tmp);
          try {
            for (const e of zip.entries) {
              const out = path.join(root, ...e.rel.split('/'));
              const ep = partOf(out);
              try {
                await e.read(ep);
                await place(ep, out, force);
                counts.archive++;
              } catch (er) {
                try { fs.unlinkSync(ep); } catch (x) { /* none */ }
                failed.push(`${e.rel} (${er.message})`);
              }
            }
          } finally { zip.close(); }
        } finally { try { fs.unlinkSync(tmp); } catch (x) { /* gone */ } }
        local.set(asset.url, '.');
        continue;
      }
      const isModel = asset.kind === 'model';
      if (projectFiles.exists(dest)) {
        // A picture or document in place stays, and so does every file on the first copy (it may
        // be the user's own); "Check for updates" fetches a model file again when it may have
        // changed: another size on the site, or no size given
        const size = fs.statSync(dest).size;
        const changed = isModel && force && (asset.size ? asset.size !== size : true);
        if (!changed) {
          local.set(asset.url, asset.rel);
          touched.push(dest);
          counts[asset.kind]++;
          continue;
        }
      }
      await download(asset.url, part, opts);
      const r = await place(part, dest, isModel && force);
      local.set(asset.url, r.rel);
      counts[asset.kind]++;
    } catch (e) {
      try { fs.unlinkSync(part); } catch (x) { /* none */ }
      failed.push(`${asset.rel} (${e.message})`);
    }
  }

  // README.md, unless the project has a README of its own
  let readmeName = null;
  for (const name of ['README.md', `${source.site}.md`]) {
    const p = path.join(root, name);
    if (!projectFiles.exists(p) || hasMarker(fs.readFileSync(p, 'utf8').slice(0, 300))) { readmeName = name; break; }
  }
  if (readmeName) {
    const today = new Date().toISOString().slice(0, 10);
    writeText(path.join(root, readmeName), buildReadme(page, { local: u => local.get(u) || null, today }));
    touched.push(path.join(root, readmeName));
  }

  const fresh = get('SELECT * FROM models WHERE id = ?', [modelId]);
  for (const abs of touched) indexFile(fresh, root, abs);
  const tags = addTags(fresh, page.tags);
  const parts = fillPartsList(fresh, page.hardware || [], source.site);
  run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [modelId], true);
  saveDb();

  const n = (k, one, many) => `${counts[k]} ${counts[k] === 1 ? one : many}`;
  const bits = [readmeName ? `the description (${readmeName})` : 'no description (README.md is not from 3DLib)',
    n('description', 'picture of it', 'pictures of it'), n('gallery', 'gallery picture', 'gallery pictures'), n('document', 'document', 'documents')];
  if (counts.model || counts.archive) bits.push(`${counts.model + counts.archive} model file${counts.model + counts.archive === 1 ? '' : 's'}`);
  let message = `Copied ${bits.join(', ')} from ${source.site}`;
  if (updated) message += `; ${updated} changed file${updated === 1 ? '' : 's'} updated (old versions in their history)`;
  if (tags) message += `; ${tags} tag${tags === 1 ? '' : 's'} added`;
  if (parts) message += '; hardware in the Parts tab';
  if (page.filesNote === 'login_needed') message += `. Model files: log in to ${source.site} in Profile -> API & Integrations`;
  if (page.filesNote === 'login_refused') message += `. Model files: ${source.site} refused your login, log in again in Profile -> API & Integrations`;
  if (reused.length) message += `. Already in the project: ${reused.join(', ')}`;
  if (failed.length) message += `. Not downloaded: ${failed.join(', ')}`;
  return { message, failed: failed.length, files: page.filesNote };
}

async function runImport(modelId, url, userId, force) {
  const found = sourceOf(url);
  const site = found.source.site;
  running.add(modelId);
  setStatus(modelId, { url, site, status: 'running', message: `Copying ${site}...` });
  try {
    const r = await importPage(modelId, found, userId, force);
    setStatus(modelId, { url, site, status: 'done', message: r.message, files: r.files });
    logEvent(r.failed ? 'warning' : 'info', `Source import, model ${modelId}: ${r.message}`);
  } catch (e) {
    const message = e.message || 'The copy failed';
    if (get('SELECT id FROM models WHERE id = ?', [modelId])) setStatus(modelId, { url, site, status: 'error', message });
    logEvent('warning', `Source import, model ${modelId} (${url}): ${message}`);
  } finally {
    running.delete(modelId);
  }
}

// After a model is saved by userId: copies its source page when the URL is new or its last copy
// failed; opts.force ("Check for updates") copies it again. True when a copy started.
function maybeStart(model, previousUrl, userId, opts = {}) {
  const url = model && model.source_url;
  if (!url || !sourceOf(url) || running.has(model.id) || model.kit_source_id) return false;
  const last = statusOf(model);
  if (!opts.force && url === previousUrl && last && last.url === url && last.status === 'done') return false;
  runImport(model.id, url, userId, Boolean(opts.force)).catch(() => {});
  return true;
}

// At start: a copy cut off by a restart is marked failed (saving the model again retries it)
function resetInterrupted() {
  for (const m of all("SELECT id, source_import FROM models WHERE source_import LIKE '%\"running\"%'")) {
    const s = statusOf(m);
    if (s && s.status === 'running') setStatus(m.id, { url: s.url, site: s.site, status: 'error', message: 'The copy was cut off by a restart: use Check for updates to retry' });
  }
}

module.exports = { maybeStart, statusOf, resetInterrupted, sourceOf, isRunning: (id) => running.has(id) };
