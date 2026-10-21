// ZIP downloads streamed straight from disk: a project can be many GB (USSA VAULT is 23 GB of
// STL), so the archive is never built in memory. Entries are stored, not compressed (3D files
// barely shrink and stored entries let the exact size be known up front: Content-Length, so the
// browser shows progress). Files are read one at a time; yazl switches to ZIP64 past 4 GB.
const fs = require('fs');
const { Readable } = require('stream');
const yazl = require('yazl');

// A safe relative name inside the archive: forward slashes, no drive, no leading slash, no ".."
function entryName(name) {
  const parts = String(name || '').replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '')
    .split('/').filter(p => p && p !== '.' && p !== '..');
  return parts.join('/');
}

// entries: { name, path } for a file on disk, or { name, size, read() } where read() returns a
// Buffer when the entry's turn comes (files inside ZIP archives). Missing files are skipped.
// Returns false when nothing could be added (the caller answers with an error instead).
function sendZip(res, downloadName, entries) {
  const zip = new yazl.ZipFile();
  const used = new Set();
  let current = null;
  let added = 0;
  for (const e of entries) {
    let name = entryName(e.name);
    if (!name) continue;
    // Two entries with one name would hide each other when unpacked
    for (let i = 2; used.has(name.toLowerCase()); i++) name = entryName(e.name).replace(/(\.[^./]*)?$/, ` (${i})$1`);
    if (e.path) {
      let st;
      try { st = fs.statSync(e.path); } catch (err) { continue; }
      if (!st.isFile()) continue;
      zip.addReadStreamLazy(name, { size: st.size, mtime: st.mtime, compress: false }, (cb) => {
        current = fs.createReadStream(e.path);
        current.on('error', (err) => zip.emit('error', err));
        cb(null, current);
      });
    } else if (typeof e.read === 'function' && Number.isFinite(e.size)) {
      zip.addReadStreamLazy(name, { size: e.size, compress: false }, (cb) => {
        try { current = Readable.from([e.read()]); } catch (err) { return cb(err); }
        cb(null, current);
      });
    } else continue;
    used.add(name.toLowerCase());
    added++;
  }
  if (!added) return false;

  zip.on('error', (err) => {
    console.error('ZIP download failed:', err.message);
    res.destroy(err);
  });
  // The browser cancelled: stop reading
  res.on('close', () => {
    if (res.writableFinished) return;
    if (current) current.destroy();
    zip.outputStream.destroy();
  });
  zip.end((size) => {
    res.attachment(`${downloadName.replace(/[/\\?%*:|"<>]/g, '_') || 'download'}.zip`);
    if (size >= 0) res.setHeader('Content-Length', size);
    zip.outputStream.pipe(res);
  });
  return true;
}

module.exports = { sendZip, entryName };
