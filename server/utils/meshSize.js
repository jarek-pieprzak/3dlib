// The size of a 3D file: the bounding box of its geometry in millimetres, as placed in the file
// (the orientation it is printed in). Files are streamed, so a 350 MB STL needs little memory.
//   STL (binary and text), OBJ: every vertex.
//   3MF: every vertex of each build item under its transform and components (Bambu / Orca
//        projects keep objects in 3D/Objects/*.model). With several items (plates): the largest
//        size per axis over the items, each one's footprint long side first.
//   STEP / STP: tessellated by OpenCascade (occt-import-js), in memory: STEP files are small.
// measure(path, type) resolves to [x, y, z] or throws.
const fs = require('fs');

class Box {
  constructor() { this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; }
  add(x, y, z) {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
    if (x < this.min[0]) this.min[0] = x; if (x > this.max[0]) this.max[0] = x;
    if (y < this.min[1]) this.min[1] = y; if (y > this.max[1]) this.max[1] = y;
    if (z < this.min[2]) this.min[2] = z; if (z > this.max[2]) this.max[2] = z;
  }
  get empty() { return this.min[0] === Infinity; }
  size() {
    if (this.empty) throw new Error('No geometry in the file');
    return this.max.map((v, i) => Math.round((v - this.min[i]) * 100) / 100);
  }
}

const CHUNK = 4 * 1024 * 1024;

async function measureBinaryStl(path, size) {
  const box = new Box();
  let carry = Buffer.alloc(0);
  let skip = 84;
  for await (const chunk of fs.createReadStream(path, { highWaterMark: CHUNK })) {
    let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let o = 0;
    if (skip) { const s = Math.min(skip, buf.length); o = s; skip -= s; }
    for (; o + 50 <= buf.length; o += 50) {
      for (let v = 0; v < 3; v++) {
        const p = o + 12 + v * 12;
        box.add(buf.readFloatLE(p), buf.readFloatLE(p + 4), buf.readFloatLE(p + 8));
      }
    }
    carry = buf.subarray(o);
  }
  return box.size();
}

// Text formats line by line: STL "vertex x y z", OBJ "v x y z"
async function measureLines(path, re) {
  const box = new Box();
  let rest = '';
  for await (const chunk of fs.createReadStream(path, { encoding: 'latin1', highWaterMark: CHUNK })) {
    const text = rest + chunk;
    const end = text.lastIndexOf('\n');
    const lines = end < 0 ? '' : text.slice(0, end);
    rest = end < 0 ? text : text.slice(end + 1);
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(lines))) box.add(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(rest))) box.add(Number(m[1]), Number(m[2]), Number(m[3]));
  return box.size();
}

async function measureStl(path) {
  const size = fs.statSync(path).size;
  const fd = fs.openSync(path, 'r');
  const head = Buffer.alloc(84);
  try { fs.readSync(fd, head, 0, 84, 0); } finally { fs.closeSync(fd); }
  if (size >= 84 && 84 + head.readUInt32LE(80) * 50 === size) return measureBinaryStl(path, size);
  return measureLines(path, /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/gm);
}

// ── 3MF ──
// 3MF transforms are "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (row vectors)
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseMatrix = (s) => {
  const n = String(s || '').trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY;
};
// a then b
const multiply = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]
];
const apply = (m, x, y, z) => [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const normPath = (p) => '/' + String(p || '').replace(/^\/+/, '');

// Reads one .model part. First pass (no `uses`): the objects with their components, and the
// build items. Second pass: every vertex of an object goes, under each transform that places it,
// into the box of its item (`uses`: object key -> [{ box, matrix }]).
function readModel(stream, part, objects, items, uses) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let current = null; // the object being read; in the second pass, its uses
    const tag = /<(\/?)(?:\w+:)?(object|vertex|component|item)\b([^>]*)>/g;
    const take = (text) => {
      tag.lastIndex = 0;
      let m;
      let last = 0;
      while ((m = tag.exec(text))) {
        last = tag.lastIndex;
        const [, close, name, attrs] = m;
        if (name === 'object') {
          if (close) { current = null; continue; }
          const key = `${part}#${attr(attrs, 'id')}`;
          if (uses) current = uses.get(key) || null;
          else objects.set(key, current = { components: [] });
          if (/\/\s*$/.test(attrs)) current = null;
        } else if (uses) {
          if (name !== 'vertex' || !current) continue;
          const x = Number(attr(attrs, 'x'));
          const y = Number(attr(attrs, 'y'));
          const z = Number(attr(attrs, 'z'));
          for (const u of current) u.box.add(...apply(u.matrix, x, y, z));
        } else if (name === 'component' && current) {
          const path = attr(attrs, 'path');
          current.components.push({ key: `${path ? normPath(path) : part}#${attr(attrs, 'objectid')}`, matrix: parseMatrix(attr(attrs, 'transform')) });
        } else if (name === 'item' && !close) {
          const path = attr(attrs, 'path');
          items.push({ key: `${path ? normPath(path) : part}#${attr(attrs, 'objectid')}`, matrix: parseMatrix(attr(attrs, 'transform')) });
        }
      }
      return last;
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const used = take(buf);
      // Keep what may be the start of a tag cut by the chunk
      const open = buf.lastIndexOf('<');
      buf = buf.slice(Math.max(used, open >= used ? open : buf.length));
      if (buf.length > 1 << 20) buf = buf.slice(-4096);
    });
    stream.on('end', () => { take(buf); resolve(); });
    stream.on('error', reject);
  });
}

// Reads the .model parts of a 3MF one after the other: onPart(stream, part) resolves when done
function eachModelPart(path, onPart) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      let failed = false;
      const fail = (e) => { if (!failed) { failed = true; zip.close(); reject(e); } };
      zip.on('error', fail);
      zip.on('entry', (entry) => {
        if (!/\.model$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return fail(e);
          onPart(stream, normPath(entry.fileName)).then(() => zip.readEntry(), fail);
        });
      });
      zip.on('end', () => { if (!failed) resolve(); });
      zip.readEntry();
    });
  });
}

// Two passes: first how the items are put together, then their vertices under the transforms.
// Turning only the corners of an object's box would make a part turned on the plate too big
// (a 252 × 172 mm part turned 45° measured 300 × 300 mm).
async function measure3mf(path) {
  const objects = new Map();
  const items = [];
  await eachModelPart(path, (stream, part) => readModel(stream, part, objects, items));
  const list = items.length ? items : [...objects.keys()].map(key => ({ key, matrix: IDENTITY }));
  const uses = new Map();
  // An object and its components under a transform, all into the box of one item
  const place = (key, matrix, box, depth = 0) => {
    const o = objects.get(key);
    if (!o || depth > 20) return;
    if (!uses.has(key)) uses.set(key, []);
    uses.get(key).push({ box, matrix });
    for (const c of o.components) place(c.key, multiply(c.matrix, matrix), box, depth + 1);
  };
  const boxes = list.map((item) => { const box = new Box(); place(item.key, item.matrix, box); return box; });
  await eachModelPart(path, (stream, part) => readModel(stream, part, null, null, uses));
  const sizes = boxes.filter(b => !b.empty).map(b => b.size());
  if (!sizes.length) throw new Error('No geometry in the file');
  if (sizes.length === 1) return sizes[0];
  // The fit check turns parts on the bed anyway, so a part placed along Y counts as one along X
  const size = [0, 0, 0];
  for (const [x, y, z] of sizes) [Math.max(x, y), Math.min(x, y), z].forEach((v, i) => { if (v > size[i]) size[i] = v; });
  return size;
}

let occt = null;
async function measureStep(path) {
  if (!occt) occt = await require('occt-import-js')();
  const result = occt.ReadStepFile(new Uint8Array(fs.readFileSync(path)), null);
  if (!result || !result.success) throw new Error('STEP file could not be read');
  const box = new Box();
  for (const mesh of result.meshes || []) {
    const p = mesh.attributes && mesh.attributes.position && mesh.attributes.position.array;
    for (let i = 0; p && i + 2 < p.length; i += 3) box.add(p[i], p[i + 1], p[i + 2]);
  }
  return box.size();
}

const MEASURABLE = ['stl', 'obj', '3mf', 'step'];

async function measure(path, type) {
  const t = String(type || '').toLowerCase();
  if (t === 'stl') return measureStl(path);
  if (t === 'obj') return measureLines(path, /^v\s+(\S+)\s+(\S+)\s+(\S+)/gm);
  if (t === '3mf') return measure3mf(path);
  if (t === 'step' || t === 'stp') return measureStep(path);
  throw new Error(`Cannot measure ${t} files`);
}

module.exports = { measure, MEASURABLE };
