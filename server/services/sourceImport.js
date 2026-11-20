// Copies the documentation of a model's source page into its project folder, so it stays when the
// page changes or goes: README.md (who made it, the description, print profiles, hardware), the
// pictures under images/ and the attached documents (PDF manuals). Pages 3DLib knows: MakerWorld
// (server/utils/makerworld.js).
//
// It starts by itself when a model is saved with such a Source URL (a new URL, or one whose last
// copy failed) and runs in the background; models.source_import keeps the outcome for the model
// page: { url, status: 'running' | 'done' | 'error', at, message }.
//  * Files already in the folder stay as they are (a second import downloads only what is new);
//    a download the project already has under another name or folder (same content) is dropped
//    and the README links that file.
//  * A README that 3DLib did not write is kept: the copy goes to "MakerWorld.md" next to it.
//  * A project made of one loose file becomes a folder first; read-only projects are left alone.
//  * Tags of the page are added; the hardware fills the Parts tab when it has no list yet.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { get, all, run, saveDb } = require('../database');
const { getFileType, getScanStatus } = require('../utils/library');
const projectFiles = require('../utils/projectFiles');
const makerworld = require('../utils/makerworld');
const { tagIdFor, logEvent, hashFileStream } = require('../utils/modelHelpers');
const { newToken } = require('../utils/slicerToken');
const { version } = require('../../package.json');

const USER_AGENT = `3DLib/${version} (self-hosted model library)`;
const MAX_JSON_BYTES = 30 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const TIMEOUT_MS = 60000;

// The tests answer for makerworld.com and the CDN: https://<host>/<path> -> <origin>/<host>/<path>
const TEST_ORIGIN = process.env.NODE_ENV === 'test' ? (process.env.SOURCE_IMPORT_TEST_ORIGIN || '') : '';
const requestUrl = (url) => (TEST_ORIGIN ? `${TEST_ORIGIN}/${url.replace(/^https?:\/\//, '')}` : url);

const running = new Set();

function statusOf(model) {
  try { return model && model.source_import ? JSON.parse(model.source_import) : null; } catch (e) { return null; }
}

function setStatus(modelId, status) {
  run('UPDATE models SET source_import = ? WHERE id = ?', [JSON.stringify({ ...status, at: new Date().toISOString() }), modelId], true);
  saveDb();
}

// The page a URL points to, or null when 3DLib cannot copy it
function sourceOf(url) {
  const id = makerworld.designIdOf(url);
  return id ? { site: 'MakerWorld', id } : null;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

function open(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const target = requestUrl(url);
    const lib = target.startsWith('https:') ? https : http;
    const req = lib.get(target, { headers: { 'user-agent': USER_AGENT, accept: '*/*' }, timeout: TIMEOUT_MS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).href; } catch (e) { return reject(new Error('Bad redirect')); }
        if (!makerworld.isAssetUrl(next) && new URL(next).hostname !== new URL(url).hostname) {
          return reject(new Error(`Redirected to ${new URL(next).hostname}`));
        }
        return resolve(open(next, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const res = await open(url);
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) { res.destroy(); throw new Error('The answer is too large'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// A hidden ".<name>.part" next to the destination: the scanner skips dotfiles
const partOf = (dest) => path.join(path.dirname(dest), `.${path.basename(dest)}.part`);

// Into `part` (the caller renames it or drops it)
async function download(url, part) {
  fs.mkdirSync(path.dirname(part), { recursive: true });
  const res = await open(url);
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

// The database row of a file in the project folder: indexed like the scanner does, a row in the
// Trash comes back (the import asked for the file again)
function indexFile(model, root, abs) {
  const size = fs.statSync(abs).size;
  const row = get('SELECT id, deleted_at FROM files WHERE library_path = ?', [abs]);
  if (row) {
    run('UPDATE files SET file_size = ?, deleted_at = NULL WHERE id = ?', [size, row.id], true);
    return row.id;
  }
  const filename = path.basename(abs);
  const r = run('INSERT INTO files (model_id, filename, original_name, file_type, file_size, library_path, slicer_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [model.id, filename, projectFiles.relOf(root, abs), getFileType(filename), size, abs, newToken()], true);
  return r.lastId;
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
function fillPartsList(model, hardware) {
  if (!hardware.length || get('SELECT parts_list FROM models WHERE id = ?', [model.id]).parts_list) return false;
  const list = {
    files: [],
    hardware: hardware.map(h => ({ name: h.name, qty: h.qty, have: false })),
    notes: ['Hardware from MakerWorld.', ...hardware.filter(h => h.note).map(h => `${h.name}: ${h.note}`)].join('\n')
  };
  run('UPDATE models SET parts_list = ?, kit_needs = NULL WHERE id = ?', [JSON.stringify(list), model.id], true);
  require('../utils/kits').refreshNeeds(get('SELECT * FROM models WHERE id = ?', [model.id]));
  return true;
}

async function importMakerWorld(modelId, url, id) {
  let design;
  try {
    design = await fetchJson(makerworld.apiUrl(id));
  } catch (e) {
    if (e.status === 403 || e.status === 429) throw new Error(`MakerWorld refused the request (${e.message}); try again later`);
    if (e.status === 404) throw new Error('MakerWorld has no model with this number');
    throw new Error(`MakerWorld could not be reached: ${e.message}`);
  }
  if (!design || Number(design.id) !== id) throw new Error('MakerWorld sent no model data');

  await waitForScan();
  const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [modelId]);
  if (!model) throw new Error('The model is gone');
  const root = projectFiles.ensureProjectFolder(model); // read-only: FsError; a loose file: a folder now
  model.library_path = root;

  // Files: what is already there stays. A file at its place is kept as it is; one whose content
  // the project already has elsewhere is not added twice, the README links that file instead.
  const local = new Map();
  const failed = [];
  const reused = [];
  const counts = { description: 0, gallery: 0, document: 0 };
  const touched = [];
  const own = all("SELECT library_path FROM files WHERE model_id = ? AND deleted_at IS NULL AND library_path IS NOT NULL AND library_path NOT LIKE '%::%'", [modelId])
    .map(f => f.library_path);
  for (const asset of makerworld.assetsOf(design)) {
    const dest = path.join(root, ...asset.rel.split('/'));
    const part = partOf(dest);
    try {
      if (projectFiles.exists(dest)) {
        local.set(asset.url, asset.rel);
        touched.push(dest);
      } else {
        await download(asset.url, part);
        const twin = await sameContent(part, own);
        if (twin) {
          fs.unlinkSync(part);
          const rel = projectFiles.relOf(root, twin);
          local.set(asset.url, rel);
          reused.push(rel);
        } else {
          fs.renameSync(part, dest);
          local.set(asset.url, asset.rel);
          touched.push(dest);
          own.push(dest);
        }
      }
      counts[asset.kind]++;
    } catch (e) {
      try { fs.unlinkSync(part); } catch (x) { /* none */ }
      failed.push(`${asset.rel} (${e.message})`);
    }
  }

  // README.md, unless the project has a README of its own
  let readmeName = 'README.md';
  for (const name of ['README.md', 'MakerWorld.md']) {
    readmeName = name;
    const p = path.join(root, name);
    if (!projectFiles.exists(p) || makerworld.hasMarker(fs.readFileSync(p, 'utf8').slice(0, 300))) break;
    readmeName = null;
  }
  if (readmeName) {
    const today = new Date().toISOString().slice(0, 10);
    writeText(path.join(root, readmeName), makerworld.buildReadme(design, { local: u => local.get(u) || null, today }));
    touched.push(path.join(root, readmeName));
  }

  const fresh = get('SELECT * FROM models WHERE id = ?', [modelId]);
  for (const abs of touched) indexFile(fresh, root, abs);
  const tags = addTags(fresh, design.tags);
  const parts = fillPartsList(fresh, makerworld.hardwareOf(design));
  run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [modelId], true);
  saveDb();

  const n = (k, one, many) => `${counts[k]} ${counts[k] === 1 ? one : many}`;
  const bits = [readmeName ? `the description (${readmeName})` : 'no description (README.md is not from 3DLib)',
    n('description', 'picture of it', 'pictures of it'), n('gallery', 'gallery picture', 'gallery pictures'), n('document', 'document', 'documents')];
  let message = `Copied ${bits.join(', ')} from MakerWorld`;
  if (tags) message += `; ${tags} tag${tags === 1 ? '' : 's'} added`;
  if (parts) message += '; hardware in the Parts tab';
  if (reused.length) message += `. Already in the project: ${reused.join(', ')}`;
  if (failed.length) message += `. Not downloaded: ${failed.join(', ')}`;
  return { message, failed: failed.length };
}

async function runImport(modelId, url) {
  const source = sourceOf(url);
  running.add(modelId);
  setStatus(modelId, { url, status: 'running', message: `Copying the documentation from ${source.site}...` });
  try {
    const r = await importMakerWorld(modelId, url, source.id);
    setStatus(modelId, { url, status: 'done', message: r.message });
    logEvent(r.failed ? 'warning' : 'info', `Source import, model ${modelId}: ${r.message}`);
  } catch (e) {
    const message = e instanceof projectFiles.FsError ? e.message : (e.message || 'The copy failed');
    if (get('SELECT id FROM models WHERE id = ?', [modelId])) setStatus(modelId, { url, status: 'error', message });
    logEvent('warning', `Source import, model ${modelId} (${url}): ${message}`);
  } finally {
    running.delete(modelId);
  }
}

// After a model is saved: copies its source page when the URL is new or its last copy failed.
// True when a copy started.
function maybeStart(model, previousUrl) {
  const url = model && model.source_url;
  if (!url || !sourceOf(url) || running.has(model.id) || model.kit_source_id) return false;
  const last = statusOf(model);
  if (url === previousUrl && last && last.url === url && last.status === 'done') return false;
  runImport(model.id, url).catch(() => {});
  return true;
}

// At start: a copy cut off by a restart is marked failed (saving the model again retries it)
function resetInterrupted() {
  for (const m of all("SELECT id, source_import FROM models WHERE source_import LIKE '%\"running\"%'")) {
    const s = statusOf(m);
    if (s && s.status === 'running') setStatus(m.id, { url: s.url, status: 'error', message: 'The copy was cut off by a restart: save the model again to retry' });
  }
}

module.exports = { maybeStart, sourceOf, statusOf, resetInterrupted, isRunning: (id) => running.has(id) };
