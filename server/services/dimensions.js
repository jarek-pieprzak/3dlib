// Sizes of 3D files (utils/meshSize.js): measured one at a time in a worker thread, so a big file
// never blocks the server, and kept in files.dim_x / dim_y / dim_z (mm, as placed in the file).
// dim_bytes is the file size they belong to: a file that changed is measured again; dim_error
// keeps a failure until the file changes. Models someone has open go first (prioritize).
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { get, all, run, saveDb, UPLOADS_DIR } = require('../database');
const { MEASURABLE } = require('../utils/meshSize');

const PENDING = `deleted_at IS NULL AND COALESCE(is_archive_entry, 0) = 0 AND COALESCE(library_path, '') NOT LIKE '%::%'
  AND file_type IN (${MEASURABLE.map(t => `'${t}'`).join(',')}) AND (dim_bytes IS NULL OR dim_bytes != file_size)`;

let worker = null;
let current = null; // { id, size } being measured
let urgent = [];
let saveTimer = null;
let intervalId = null;
let stopped = false;

function filePath(f) {
  if (f.library_path && !String(f.library_path).includes('::')) return f.library_path;
  return f.filename ? path.join(UPLOADS_DIR, f.filename) : null;
}

function store(id, bytes, size, error) {
  run('UPDATE files SET dim_x=?, dim_y=?, dim_z=?, dim_bytes=?, dim_error=? WHERE id=?',
    [size ? size[0] : null, size ? size[1] : null, size ? size[2] : null, bytes, error || null, id], true);
  // Many small files are measured in a row: save the database once in a while, not every time
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveDb(); }, 5000);
}

function spawn() {
  worker = new Worker(path.join(__dirname, 'dimensionsWorker.js'), { resourceLimits: { maxOldGenerationSizeMb: 1536 } });
  worker.on('message', ({ id, size, error }) => {
    if (current && current.id === id) store(id, current.bytes, size || null, error);
    current = null;
    setImmediate(kick);
  });
  // A file that brings the worker down (out of memory) is marked and skipped
  const lost = (why) => {
    if (current) store(current.id, current.bytes, null, `Measuring failed: ${why}`);
    current = null;
    worker = null;
    if (!stopped) setTimeout(kick, 1000);
  };
  worker.on('error', (e) => lost(e && e.message ? e.message : 'worker error'));
  worker.on('exit', (code) => { if (worker) lost(`worker exited (${code})`); });
}

function next() {
  while (urgent.length) {
    const f = get(`SELECT * FROM files WHERE id=? AND ${PENDING}`, [urgent.shift()]);
    if (f) return f;
  }
  return get(`SELECT * FROM files WHERE ${PENDING} ORDER BY id LIMIT 1`);
}

// Measure the next file waiting, if none is being measured
function kick() {
  if (current || stopped) return;
  const f = next();
  if (!f) return;
  const p = filePath(f);
  if (!p || !fs.existsSync(p)) { store(f.id, f.file_size, null, 'File not found'); return setImmediate(kick); }
  if (!worker) spawn();
  current = { id: f.id, bytes: f.file_size };
  worker.postMessage({ id: f.id, path: p, type: f.file_type });
}

// The files of a model go first (of them, `first`: the ones on screen); returns how many wait
function prioritize(modelId, first = []) {
  const waiting = all(`SELECT id FROM files WHERE model_id=? AND ${PENDING}`, [modelId]).map(r => r.id);
  const front = new Set(first.filter(id => waiting.includes(id)));
  const ids = [...front, ...waiting.filter(id => !front.has(id))];
  urgent = [...ids, ...urgent.filter(id => !ids.includes(id))];
  kick();
  return ids.length;
}

function pendingCount(modelId) {
  return modelId
    ? get(`SELECT COUNT(*) AS n FROM files WHERE model_id=? AND ${PENDING}`, [modelId]).n
    : get(`SELECT COUNT(*) AS n FROM files WHERE ${PENDING}`).n;
}

function start() {
  stopped = false;
  setTimeout(kick, 8000);
  // New and changed files (scans, uploads, slicer saves) are picked up within a minute
  intervalId = setInterval(kick, 60 * 1000);
}

function stop() {
  stopped = true;
  if (intervalId) clearInterval(intervalId);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveDb(); }
  if (worker) { const w = worker; worker = null; w.terminate(); }
}

module.exports = { start, stop, kick, prioritize, pendingCount };
