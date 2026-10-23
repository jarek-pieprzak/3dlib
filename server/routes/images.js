// Small versions of images for cards and tiles (mounted at /thumbs, outside the /api rate limit):
//   GET /thumbs?u=<URL of an image under /uploads or /library-files>&w=<width>
// A cover can be a full-size photo from a project folder; a browser decodes a 12 MP photo into
// about 48 MB, for every card. The small version is a WebP (transparency kept), made with sharp
// and cached in <data>/cache/img, keyed by the file, its size and modification time.
// Same access rules as the original: password-protected files stay hidden (protection.js).
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR, UPLOADS_DIR, LIBRARY_PATH } = require('../config');
const protection = require('../utils/protection');

const CACHE_DIR = path.join(DATA_DIR, 'cache', 'img');
const WIDTHS = [160, 320, 480, 960, 1600];
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_JOBS = 2; // images resized at the same time: a big photo needs a lot of memory

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (e) {
  console.warn('[Images] sharp is not available, images are served at full size');
}

let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= MAX_JOBS) await new Promise(resolve => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    if (waiting.length) waiting.shift()();
  }
}

// The file behind an /uploads or /library-files URL, inside its folder, or null
function resolveImage(url) {
  let decoded;
  try { decoded = decodeURIComponent(String(url).split('?')[0]); } catch (e) { return null; }
  const mounts = [['/uploads/', 'uploads', UPLOADS_DIR], ['/library-files/', 'library', LIBRARY_PATH]];
  for (const [prefix, kind, root] of mounts) {
    if (!decoded.startsWith(prefix)) continue;
    const rel = decoded.slice(prefix.length - 1); // keeps the leading "/"
    // Like express.static: no hidden files or folders
    if (rel.split('/').some(s => s.startsWith('.'))) return null;
    const base = path.resolve(root);
    const abs = path.resolve(base, '.' + rel);
    if (!abs.startsWith(base + path.sep) || !IMAGE_FILE.test(abs)) return null;
    return { kind, root, rel, abs };
  }
  return null;
}

router.get('/', async (req, res) => {
  const original = String(req.query.u || '');
  const image = resolveImage(original);
  if (!image) return res.status(400).type('text/plain').send('Not an image of the library');
  if (protection.blocksStatic(req, image.kind, image.root, image.rel)) return res.status(404).type('text/plain').send('Not found');

  let stat;
  try { stat = fs.statSync(image.abs); } catch (e) { return res.status(404).type('text/plain').send('Not found'); }
  if (!sharp) return res.redirect(original);

  const width = WIDTHS.find(w => w >= Number(req.query.w)) || 480;
  const key = crypto.createHash('sha1').update(`${image.abs}|${stat.size}|${stat.mtimeMs}|${width}`).digest('hex');
  const cached = path.join(CACHE_DIR, `${key}.webp`);
  const send = () => res.sendFile(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  if (fs.existsSync(cached)) return send();

  try {
    await withSlot(async () => {
      if (fs.existsSync(cached)) return;
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = `${cached}.${process.pid}.${Date.now()}.tmp`;
      await sharp(image.abs, { limitInputPixels: 100e6 })
        .rotate() // photos taken upright are stored rotated with an EXIF flag
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(tmp);
      fs.renameSync(tmp, cached);
    });
    send();
  } catch (e) {
    // A file sharp cannot read: the browser gets the original, as before
    console.warn('[Images] Could not resize', image.abs, e.message);
    res.redirect(original);
  }
});

// Cached versions not used for a while are deleted by the hourly sync; they come back on demand
function purgeCache(maxAgeDays = 90) {
  let removed = 0;
  let entries;
  try { entries = fs.readdirSync(CACHE_DIR); } catch (e) { return 0; }
  const cutoff = Date.now() - maxAgeDays * 86400000;
  for (const name of entries) {
    const p = path.join(CACHE_DIR, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
    } catch (e) { /* gone */ }
  }
  return removed;
}

module.exports = { router, purgeCache, resolveImage, CACHE_DIR };
