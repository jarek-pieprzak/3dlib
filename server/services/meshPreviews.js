// Light copies of big STLs (utils/meshPreview.js) for the 3D Studio and for the pictures of cards
// and rows. Made in a worker thread when first asked for, one file at a time, and kept gzipped in
// <data>/cache/mesh/<file id>-<size>-<mtime>-v<VERSION>.stl.gz: a file changed on disk gets a
// new copy and its old one goes. The hourly sync drops copies of files that are gone or changed,
// of another VERSION, and copies nobody opened for 90 days (prune).
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { DATA_DIR, LIBRARY_PATH, UPLOADS_DIR } = require('../config');
const { all } = require('../database');

// Smaller files are shown and pictured from themselves (UI.ROW_PREVIEW_MAX_BYTES)
const MIN_BYTES = 20 * 1024 * 1024;
const CACHE_DIR = path.join(DATA_DIR, 'cache', 'mesh');
// Raised when the simplification changes: copies of another version are made again, and the
// hourly prune drops the old ones (their names do not match)
const VERSION = 2;
const NAME = /^(\d+)-(\d+)-(\d+)-v(\d+)\.stl\.gz$/;

let worker = null;
let idleTimer = null;
let current = null; // job being made
const queue = [];
const jobs = new Map(); // cache name -> job { name, src, dest, promise, resolve, reject }
const failed = new Map(); // cache name -> error message (until the file changes or a restart)

function eligible(file) {
  return Boolean(file) && file.file_type === 'stl' && Number(file.file_size) > MIN_BYTES
    && !file.is_archive_entry && !String(file.library_path || '').includes('::');
}

function sourceOf(file) {
  const src = file.library_path || (file.filename ? path.join(UPLOADS_DIR, file.filename) : null);
  if (!src) return null;
  const root = file.library_path ? LIBRARY_PATH : UPLOADS_DIR;
  const rel = path.relative(root, src);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? src : null;
}

function spawn() {
  worker = new Worker(path.join(__dirname, 'meshPreviewWorker.js'), { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
  worker.on('message', ({ name, error }) => {
    const job = current;
    current = null;
    if (job && job.name === name) {
      jobs.delete(name);
      if (error) { failed.set(name, error); job.reject(new Error(error)); } else job.resolve(job.dest);
    }
    setImmediate(next);
  });
  // A file that brings the worker down (out of memory) fails; the next one gets a new worker
  const lost = (why) => {
    const job = current;
    current = null;
    worker = null;
    if (job) { jobs.delete(job.name); failed.set(job.name, why); job.reject(new Error(why)); }
    setImmediate(next);
  };
  worker.on('error', (e) => lost(`Preview failed: ${e && e.message ? e.message : 'worker error'}`));
  worker.on('exit', (code) => { if (worker) lost(`Preview failed: worker exited (${code})`); });
}

function next() {
  if (current) return;
  const job = queue.shift();
  if (!job) {
    // An idle worker gives its memory back
    if (worker && !idleTimer) idleTimer = setTimeout(() => { idleTimer = null; if (!current && !queue.length && worker) { const w = worker; worker = null; w.terminate(); } }, 30000);
    return;
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!worker) spawn();
  current = job;
  worker.postMessage({ name: job.name, src: job.src, dest: job.dest });
}

// The copy of a file: { state: 'ready' | 'queued' | 'failed' | 'missing', dest, promise, error }.
// A new job goes to the front (someone waits for it) or, in the background, to the back; a
// queued job someone now waits for moves to the front
function request(file, background) {
  if (!eligible(file)) return { state: 'missing', error: 'No light preview for this file' };
  const src = sourceOf(file);
  let stat;
  try { stat = src && fs.statSync(src); } catch (e) { stat = null; }
  if (!stat) return { state: 'missing', error: 'File not found' };
  const name = `${Number(file.id)}-${stat.size}-${Math.floor(stat.mtimeMs)}-v${VERSION}.stl.gz`;
  const dest = path.join(CACHE_DIR, name);
  if (fs.existsSync(dest)) return { state: 'ready', dest };
  if (failed.has(name)) return { state: 'failed', error: failed.get(name) };
  let job = jobs.get(name);
  if (job) {
    const at = queue.indexOf(job);
    if (!background && at > 0) { queue.splice(at, 1); queue.unshift(job); }
    return { state: 'queued', promise: job.promise };
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Older copies of this file (it changed)
  for (const old of listCache()) if (old.id === Number(file.id) && old.name !== name) remove(old.name);
  job = { name, src, dest };
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  job.promise.catch(() => {});
  jobs.set(name, job);
  if (background) queue.push(job); else queue.unshift(job);
  next();
  return { state: 'queued', promise: job.promise };
}

// The light copy of a file: resolves to its path in the cache, made first if needed (before the
// copies made ahead)
function ensure(file) {
  const r = request(file, false);
  if (r.state === 'ready') return Promise.resolve(r.dest);
  if (r.state === 'queued') return r.promise;
  return Promise.reject(Object.assign(new Error(r.error), { status: r.state === 'failed' ? 422 : 404 }));
}

// A copy made ahead, in the background (a configuration's parts): 'ready', 'queued' or why not.
// A ready copy asked for by an open page counts as used (prune keeps it)
function prefetch(file) {
  const r = request(file, true);
  if (r.state === 'ready') touch(r.dest);
  return r.state;
}

function listCache() {
  let names;
  try { names = fs.readdirSync(CACHE_DIR); } catch (e) { return []; }
  return names.map(name => { const m = NAME.exec(name); return m ? { name, id: Number(m[1]), size: Number(m[2]), version: Number(m[4]) } : { name, id: null }; });
}

function remove(name) {
  try { fs.unlinkSync(path.join(CACHE_DIR, name)); } catch (e) { /* gone */ }
}

// A copy was opened: it stays (prune drops copies nobody opened for a long time)
function touch(dest) {
  const now = new Date();
  fs.utimes(dest, now, now, () => {});
}

// Copies of files that are gone or changed, unopened ones, left-over temporary files
function prune(maxAgeDays = 90) {
  const entries = listCache();
  if (!entries.length) return 0;
  const sizes = new Map(all('SELECT id, file_size FROM files').map(f => [f.id, Number(f.file_size)]));
  const cutoff = Date.now() - maxAgeDays * 86400000;
  let removed = 0;
  for (const e of entries) {
    if (jobs.has(e.name)) continue;
    let mtime;
    try { mtime = fs.statSync(path.join(CACHE_DIR, e.name)).mtimeMs; } catch (err) { continue; }
    // A temporary file is the worker's until it is renamed
    const stale = e.id === null ? mtime < Date.now() - 3600000 : e.version !== VERSION || sizes.get(e.id) !== e.size || mtime < cutoff;
    if (stale) { remove(e.name); removed++; }
  }
  return removed;
}

function stop() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (worker) { const w = worker; worker = null; w.terminate(); }
}

module.exports = { ensure, prefetch, eligible, touch, prune, stop, MIN_BYTES, CACHE_DIR };
