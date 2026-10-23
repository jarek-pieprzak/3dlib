const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { get, all, run, UPLOADS_DIR } = require('../database');
const { LIBRARY_PATH } = require('../config');

/**
 * Generates the public accessible URL for a given file record
 */
function getFileUrl(file) {
  if (file.is_archive_entry || (file.library_path && file.library_path.includes('::'))) {
    return `/api/files/${file.id}/stream`;
  }
  if (file.library_path) {
    const relPath = path.relative(LIBRARY_PATH, file.library_path).replace(/\\/g, '/');
    const encodedPath = relPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `/library-files/${encodedPath}`;
  }
  return `/uploads/${file.filename}`;
}

/**
 * Generates the thumbnail URL, checking uploads and folder paths
 */
function getThumbUrl(thumbnail, folderPath = null) {
  if (!thumbnail) return null;
  if (thumbnail.startsWith('http')) return thumbnail;
  
  if (fs.existsSync(path.join(UPLOADS_DIR, thumbnail))) {
    return `/uploads/${thumbnail}`;
  }
  
  if (folderPath) {
    // A project made of one file in the library root has that file as its path: its images
    // sit next to it
    try { if (fs.statSync(folderPath).isFile()) folderPath = path.dirname(folderPath); } catch (e) { /* missing: keep */ }
    const thumbPath = path.join(folderPath, thumbnail);
    if (fs.existsSync(thumbPath)) {
      return getFileUrl({ filename: thumbnail, library_path: thumbPath });
    }
  }
  
  return `/uploads/${thumbnail}`;
}

/**
 * Internal deletion helper for models and their underlying files on disk
 */
function deleteModelInternal(id, deleteDisk = false) {
  const model = get('SELECT * FROM models WHERE id=?', [id]);
  if (!model) return false;
  const files = all('SELECT filename, library_path FROM files WHERE model_id=?', [id]);

  for (const f of files) { 
    const p = path.join(UPLOADS_DIR, f.filename); 
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (err) {}
    }
    if (deleteDisk && f.library_path && fs.existsSync(f.library_path)) {
      try { fs.unlinkSync(f.library_path); } catch (err) { console.error('Failed to delete physical file:', err); }
    }
  }
  
  if (model.thumbnail) { 
    const p = path.join(UPLOADS_DIR, model.thumbnail); 
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (err) {}
    }
    if (deleteDisk && model.library_path && fs.existsSync(path.join(model.library_path, model.thumbnail))) {
      try { fs.unlinkSync(path.join(model.library_path, model.thumbnail)); } catch (err) { console.error('Failed to delete physical thumbnail:', err); }
    }
  }
  
  if (deleteDisk && model.library_path && fs.existsSync(model.library_path)) {
    try {
      if (fs.readdirSync(model.library_path).length === 0) {
        fs.rmdirSync(model.library_path);
      }
    } catch (err) {}
  }
  // Explicitly remove child records in addition to FK cascade (#74)
  run('DELETE FROM files WHERE model_id=?', [id], true);
  run('DELETE FROM model_tags WHERE model_id=?', [id], true);
  run('DELETE FROM project_models WHERE model_id=?', [id], true);
  run('DELETE FROM print_history WHERE model_id=?', [id], true);
  run('DELETE FROM shares WHERE model_id=?', [id], true);
  run('DELETE FROM models WHERE id=?', [id]);
  return true;
}

/**
 * Who may change a model, its files and its Trash: an admin, or the owner unless a viewer
 */
function canEditModel(user, model) {
  if (!user || !model) return false;
  if (user.role === 'admin') return true;
  return user.role !== 'viewer' && model.user_id === user.id;
}

/**
 * Fetches boolean system setting by key
 */
function getSettingBool(key, defaultValue = false) {
  const row = get('SELECT value FROM system_settings WHERE key=?', [key]);
  if (!row) return defaultValue;
  return row.value === 'true' || row.value === '1';
}

/**
 * Records system event log in SQLite
 */
function logEvent(level, message) {
  try {
    run('INSERT INTO system_logs (level, message) VALUES (?, ?)', [level, message]);
  } catch (e) {
    console.error('Failed to log event:', e);
  }
}

/**
 * Stream-based SHA256 file hashing
 */
function hashFileStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}


/**
 * Safely extracts an AdmZip entry buffer, falling back to raw zlib inflate + central directory
 * CRC32 check when streaming ZIP64 data descriptors cause ADM-ZIP DESCRIPTOR_FAULTY (#77).
 */
function getZipEntryBuffer(entry) {
  try {
    return entry.getData();
  } catch (err) {
    const compressed = entry.getCompressedData();
    const method = entry.header ? entry.header.method : 8;
    let out;
    if (method === 0) {
      out = Buffer.from(compressed);
    } else if (method === 8) {
      // No more than the central directory declares: this path skips adm-zip's size cap
      out = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.header.size || 0) });
    } else {
      throw err;
    }
    if (entry.header && entry.header.crc && typeof zlib.crc32 === 'function') {
      const actualCrc = zlib.crc32(out) >>> 0;
      const expectedCrc = entry.header.crc >>> 0;
      if (actualCrc !== expectedCrc) {
        throw new Error('ZIP entry CRC32 mismatch');
      }
    }
    return out;
  }
}

/**
 * The id of the tag with this name, created when missing. Case is ignored, also of Polish letters
 * (ulower, utils/names.js): "pla" is the tag "PLA", not a second one (tags.name is unique only by
 * its bytes).
 */
function tagIdFor(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const row = get('SELECT id FROM tags WHERE ulower(name) = ulower(?) ORDER BY id LIMIT 1', [clean]);
  return row ? row.id : run('INSERT INTO tags (name) VALUES (?)', [clean]).lastId;
}

/**
 * Content-Disposition header for any file name. Node refuses a header with letters past U+00FF
 * ("Łożysko.3mf": 500), so the name goes as UTF-8 in filename* (RFC 6266) and plain ASCII in
 * filename for older clients.
 */
function contentDisposition(type, name) {
  const base = path.basename(String(name || '')) || 'download';
  const ascii = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, m => (m === 'ł' ? 'l' : 'L'))
    .replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const utf8 = encodeURIComponent(base).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * ZIP download entries (utils/zipStream) for model files: library and uploaded files are read
 * from disk; files found inside a ZIP archive are read from it, unless the archive itself is
 * in the list. folder: optional folder inside the download (collections: one per model).
 */
function zipEntriesForFiles(files, folder = '') {
  const AdmZip = require('adm-zip');
  const { validatePathConfinement } = require('../middleware/security');
  const prefix = folder ? `${folder}/` : '';
  const physicalZips = new Set(files.filter(f => !f.is_archive_entry && f.file_type === 'zip' && f.library_path).map(f => f.library_path));
  const archives = new Map(); // archive path -> AdmZip, opened once per download
  const entries = [];
  for (const file of files) {
    if (file.is_archive_entry && file.library_path && file.library_path.includes('::')) {
      const [zipPath, entryPath] = file.library_path.split('::');
      if (physicalZips.has(zipPath)) continue;
      const confinedZip = validatePathConfinement(LIBRARY_PATH, path.relative(LIBRARY_PATH, zipPath));
      if (!confinedZip || !fs.existsSync(confinedZip)) continue;
      try {
        if (!archives.has(confinedZip)) archives.set(confinedZip, new AdmZip(confinedZip));
        const entry = archives.get(confinedZip).getEntry(entryPath);
        if (entry) {
          entries.push({ name: prefix + (file.archive_entry_path || file.original_name || file.filename), size: entry.header.size, read: () => getZipEntryBuffer(entry) });
        }
      } catch (e) {}
      continue;
    }
    let filePath = null;
    if (file.library_path && fs.existsSync(file.library_path)) {
      filePath = validatePathConfinement(LIBRARY_PATH, path.relative(LIBRARY_PATH, file.library_path));
    } else if (file.filename) {
      const upCandidate = path.join(UPLOADS_DIR, file.filename);
      if (fs.existsSync(upCandidate)) filePath = validatePathConfinement(UPLOADS_DIR, path.relative(UPLOADS_DIR, upCandidate));
    }
    if (filePath) entries.push({ name: prefix + (file.original_name || file.filename), path: filePath });
  }
  return entries;
}

module.exports = {
  getZipEntryBuffer,
  contentDisposition,
  tagIdFor,
  zipEntriesForFiles,
  getFileUrl,
  getThumbUrl,
  deleteModelInternal,
  canEditModel,
  getSettingBool,
  logEvent,
  hashFileStream
};
