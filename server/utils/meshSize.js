// The size of a 3D file: the bounding box of its geometry in millimetres, as placed in the file
// (the orientation it is printed in). Files are streamed, so a 350 MB STL needs little memory.
//   STL (binary and text), OBJ: every vertex.
//   3MF: every build item with its transform and components (Bambu / Orca projects keep objects
//        in 3D/Objects/*.model); the largest size per axis over the items.
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

// Reads one .model part: the box of every mesh object, components, build items
function readModel(stream, part, objects, items) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let current = null;
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
          current = { key: `${part}#${attr(attrs, 'id')}`, box: new Box(), components: [] };
          objects.set(current.key, current);
          if (/\/\s*$/.test(attrs)) current = null;
        } else if (name === 'vertex' && current) {
          current.box.add(Number(attr(attrs, 'x')), Number(attr(attrs, 'y')), Number(attr(attrs, 'z')));
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

function measure3mf(path) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const objects = new Map();
      const items = [];
      let failed = false;
      const fail = (e) => { if (!failed) { failed = true; zip.close(); reject(e); } };
      zip.on('error', fail);
      zip.on('entry', (entry) => {
        if (!/\.model$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return fail(e);
          readModel(stream, normPath(entry.fileName), objects, items).then(() => zip.readEntry(), fail);
        });
      });
      zip.on('end', () => {
        if (failed) return;
        try {
          // The box of an object under a transform: its own mesh and its components
          const boxOf = (key, matrix, out, depth = 0) => {
            const o = objects.get(key);
            if (!o || depth > 20) return;
            if (!o.box.empty) {
              for (const x of [o.box.min[0], o.box.max[0]]) for (const y of [o.box.min[1], o.box.max[1]]) for (const z of [o.box.min[2], o.box.max[2]]) out.add(...apply(matrix, x, y, z));
            }
            for (const c of o.components) boxOf(c.key, multiply(c.matrix, matrix), out, depth + 1);
          };
          const list = items.length ? items : [...objects.keys()].map(key => ({ key, matrix: IDENTITY }));
          const size = [0, 0, 0];
          let any = false;
          for (const item of list) {
            const b = new Box();
            boxOf(item.key, item.matrix, b);
            if (b.empty) continue;
            any = true;
            b.size().forEach((v, i) => { if (v > size[i]) size[i] = v; });
          }
          if (!any) throw new Error('No geometry in the file');
          resolve(size);
        } catch (e) { reject(e); }
      });
      zip.readEntry();
    });
  });
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
