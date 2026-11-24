// A light copy of a big STL for previews: the same shape with about TARGET triangles instead of
// millions (VAULT's modules have up to 7 million, 350 MB), small enough for the 3D Studio, card
// and row pictures to load in a moment.
//
// Vertex clustering with quadrics (Lindstrom 2000): space is cut into cubic cells, every corner
// goes to its cell and every cell sums the planes of its triangles (an error quadric). A
// triangle whose corners fall in three cells is kept once; each cell becomes one vertex where
// its planes meet best (the quadric's minimum, near the mean of its corners, inside the cell),
// so flat faces stay flat and edges stay sharp.
//
// Every body of the file (the triangles joined by shared corners) gets a grid of its own: the
// big ones the size that gives about TARGET triangles in all (about TARGET / 2.2 cells on the
// surface), a small one a finer grid, at least MIN_CELLS cells across, so a small part next to
// a big one never melts into a crumb or vanishes, and two bodies never run into each other. A
// body whose fine grid would keep about as many triangles as it has stays as it is. Details on
// a body smaller than its cells (letters, holes under about 2 mm on VAULT's modules, walls
// thinner than a cell) can still go or dent; the full file is a click away.
//
// Files of up to MAX_TRIANGLES are read into memory once (corners shared by their exact
// coordinates; about 40 bytes a triangle). Bigger ones are streamed twice with one grid for all
// (memory follows the target, not the file).
// simplify(path) resolves to { stl: a binary STL Buffer, triangles, kept, cell, bodies };
// binary and text STL are read.
const fs = require('fs');

const TARGET = 160000;
const MIN_CELLS = 24;
// The base grid takes this share of the target, splitting the worst cells (up to REFINE times,
// each a cell of half the size) the rest
const BASE = 0.5;
const REFINE = 3;
const MAX_TRIANGLES = 10000000;
// More bodies than this, or corners not shared at all: a triangle soup, taken as one body
const MAX_BODIES = 20000;
const CHUNK = 4 * 1024 * 1024;

function isBinaryStl(path) {
  const size = fs.statSync(path).size;
  if (size < 84) return false;
  const fd = fs.openSync(path, 'r');
  const head = Buffer.alloc(84);
  try { fs.readSync(fd, head, 0, 84, 0); } finally { fs.closeSync(fd); }
  return 84 + head.readUInt32LE(80) * 50 === size;
}

// Calls fn(t) for every triangle, t = [x0 y0 z0 x1 y1 z1 x2 y2 z2] (the same array each time)
async function eachTriangle(path, fn) {
  const t = new Float64Array(9);
  if (isBinaryStl(path)) {
    let carry = Buffer.alloc(0);
    let skip = 84;
    for await (const chunk of fs.createReadStream(path, { highWaterMark: CHUNK })) {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      let o = 0;
      if (skip) { const s = Math.min(skip, buf.length); o = s; skip -= s; }
      for (; o + 50 <= buf.length; o += 50) {
        for (let k = 0; k < 9; k++) t[k] = buf.readFloatLE(o + 12 + k * 4);
        fn(t);
      }
      carry = buf.subarray(o);
    }
    return;
  }
  // Text: three "vertex x y z" lines a facet
  const re = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/gm;
  let k = 0;
  let rest = '';
  const take = (text) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      t[k] = Number(m[1]); t[k + 1] = Number(m[2]); t[k + 2] = Number(m[3]);
      k += 3;
      if (k === 9) { k = 0; fn(t); }
    }
  };
  for await (const chunk of fs.createReadStream(path, { encoding: 'latin1', highWaterMark: CHUNK })) {
    const text = rest + chunk;
    const end = text.lastIndexOf('\n');
    rest = end < 0 ? text : text.slice(end + 1);
    if (end >= 0) take(text.slice(0, end));
  }
  take(rest);
}

const finite = (t) => {
  for (let k = 0; k < 9; k++) if (!Number.isFinite(t[k])) return false;
  return true;
};

// Eigenvalues and eigenvectors (columns of v) of a symmetric 3x3 [a11 a12 a13 a22 a23 a33] (Jacobi)
function eigSym(a) {
  const m = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 16; sweep++) {
    if (Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]) < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(m[p][q]) < 1e-15) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const tan = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(tan * tan + 1);
      const s = tan * c;
      for (let k = 0; k < 3; k++) {
        const kp = m[k][p], kq = m[k][q];
        m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = m[p][k], qk = m[q][k];
        m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq;
      }
    }
  }
  return { values: [m[0][0], m[1][1], m[2][2]], vectors: v };
}

// ── Cells: per cell a quadric (a11 a12 a13 a22 a23 a33 b1 b2 b3 ... c), how far its vertex may
// go from the mean (negative: an exact corner, kept where it is), the sum and count of corners.
// The quadric's trace is the area of its triangles (counted once a corner), so
// (pᵀAp + 2bᵀp + c) / trace is the mean squared distance of those planes from the vertex p ──
const W = 15;
class Cells {
  constructor() { this.data = new Float64Array(W * 65536); this.n = 0; }
  add(limit) {
    const i = this.n++;
    if (this.n * W > this.data.length) { const d = new Float64Array(this.data.length * 2); d.set(this.data); this.data = d; }
    this.data[i * W + 9] = limit;
    return i;
  }
  // Sums back to zero (the limits stay): the corners are gathered again
  reset() {
    const a = this.data;
    for (let i = 0; i < this.n; i++) {
      const o = i * W;
      for (let k = 0; k < W; k++) if (k !== 9) a[o + k] = 0;
    }
  }
  plane(i, w, ux, uy, uz, d) {
    const o = i * W, a = this.data;
    a[o] += w * ux * ux; a[o + 1] += w * ux * uy; a[o + 2] += w * ux * uz;
    a[o + 3] += w * uy * uy; a[o + 4] += w * uy * uz; a[o + 5] += w * uz * uz;
    a[o + 6] += w * ux * d; a[o + 7] += w * uy * d; a[o + 8] += w * uz * d;
    a[o + 14] += w * d * d;
  }
  // How badly each cell's one vertex (pos) stands for its triangles: the mean squared distance
  // (mm²) of their planes, 0 for exact corners and empty cells
  errors(pos) {
    const e = new Float64Array(this.n);
    const a = this.data;
    for (let i = 0; i < this.n; i++) {
      const o = i * W;
      const trace = a[o] + a[o + 3] + a[o + 5];
      if (!(a[o + 9] > 0) || !(trace > 0)) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const q = a[o] * x * x + a[o + 3] * y * y + a[o + 5] * z * z
        + 2 * (a[o + 1] * x * y + a[o + 2] * x * z + a[o + 4] * y * z)
        + 2 * (a[o + 6] * x + a[o + 7] * y + a[o + 8] * z) + a[o + 14];
      e[i] = Math.max(0, q) / trace;
    }
    return e;
  }
  area(i) { const o = i * W; return (this.data[o] + this.data[o + 3] + this.data[o + 5]) / 3; }
  size(i) { return this.data[i * W + 9] / 0.75; }
  used(i) { return this.data[i * W + 13] > 0; }
  corner(i, x, y, z) {
    const o = i * W, a = this.data;
    a[o + 10] += x; a[o + 11] += y; a[o + 12] += z; a[o + 13] += 1;
  }
  // Every cell's vertex: from the mean, along the directions its planes pin down, to the
  // quadric's minimum (directions with a small eigenvalue stay at the mean); kept near the cell
  positions() {
    const pos = new Float32Array(this.n * 3);
    const a = this.data;
    for (let i = 0; i < this.n; i++) {
      const o = i * W;
      const n = a[o + 13] || 1;
      const mx = a[o + 10] / n, my = a[o + 11] / n, mz = a[o + 12] / n;
      let px = mx, py = my, pz = mz;
      const limit = a[o + 9];
      if (limit > 0) {
        const A = [a[o], a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5]];
        const gx = A[0] * mx + A[1] * my + A[2] * mz + a[o + 6];
        const gy = A[1] * mx + A[3] * my + A[4] * mz + a[o + 7];
        const gz = A[2] * mx + A[4] * my + A[5] * mz + a[o + 8];
        const { values, vectors } = eigSym(A);
        const top = Math.max(Math.abs(values[0]), Math.abs(values[1]), Math.abs(values[2]));
        if (top > 0) {
          for (let k = 0; k < 3; k++) {
            if (Math.abs(values[k]) < top * 0.02) continue;
            const ex = vectors[0][k], ey = vectors[1][k], ez = vectors[2][k];
            const s = -(ex * gx + ey * gy + ez * gz) / values[k];
            px += s * ex; py += s * ey; pz += s * ez;
          }
        }
        const near = (p, m) => Math.max(m - limit, Math.min(m + limit, p));
        px = near(px, mx); py = near(py, my); pz = near(pz, mz);
      }
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
    }
    return pos;
  }
}

// Triangles of cell ids, each once whichever corner it starts with (the turn, and so the
// normal, kept); triangles with two corners in one cell are dropped
class Triangles {
  constructor() { this.list = new Uint32Array(3 * 65536); this.n = 0; this.seen = new Map(); }
  add(c0, c1, c2) {
    if (c0 === c1 || c1 === c2 || c0 === c2) return false;
    let a = c0, b = c1, e = c2;
    if (b < a && b < e) [a, b, e] = [b, e, a];
    else if (e < a && e < b) [a, b, e] = [e, a, b];
    const key = a * 4194304 + b;
    let thirds = this.seen.get(key);
    if (!thirds) this.seen.set(key, thirds = new Set());
    if (thirds.has(e)) return false;
    thirds.add(e);
    if ((this.n + 1) * 3 > this.list.length) { const d = new Uint32Array(this.list.length * 2); d.set(this.list); this.list = d; }
    this.list[this.n * 3] = a; this.list[this.n * 3 + 1] = b; this.list[this.n * 3 + 2] = e;
    this.n++;
    return true;
  }
}

// Binary STL with flat normals
function writeStl(tris, pos) {
  const out = Buffer.alloc(84 + tris.n * 50);
  out.write('3DLib preview', 0, 'latin1');
  out.writeUInt32LE(tris.n, 80);
  const t = tris.list;
  for (let f = 0; f < tris.n; f++) {
    const o = 84 + f * 50;
    const p0 = t[f * 3] * 3, p1 = t[f * 3 + 1] * 3, p2 = t[f * 3 + 2] * 3;
    const ux = pos[p1] - pos[p0], uy = pos[p1 + 1] - pos[p0 + 1], uz = pos[p1 + 2] - pos[p0 + 2];
    const vx = pos[p2] - pos[p0], vy = pos[p2 + 1] - pos[p0 + 1], vz = pos[p2 + 2] - pos[p0 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out.writeFloatLE(nx / l, o); out.writeFloatLE(ny / l, o + 4); out.writeFloatLE(nz / l, o + 8);
    let q = o + 12;
    for (const p of [p0, p1, p2]) {
      out.writeFloatLE(pos[p], q); out.writeFloatLE(pos[p + 1], q + 4); out.writeFloatLE(pos[p + 2], q + 8);
      q += 12;
    }
  }
  return out;
}

const cellFor = (area, target) => Math.sqrt((2.2 * area) / target);

// ── The file in memory: corners shared by their exact coordinates, triangles as corner ids ──
async function readMesh(path, expected) {
  let cap = 4096;
  while (cap < expected) cap *= 2;
  let keys = new Uint32Array(cap * 3);
  let ids = new Int32Array(cap).fill(-1);
  let pos = new Float32Array(3 * Math.max(4096, Math.ceil(expected / 2)));
  let verts = 0;
  let tri = new Int32Array(3 * Math.max(4096, expected));
  let count = 0;
  const f32 = new Float32Array(3);
  const u32 = new Uint32Array(f32.buffer);
  // Round coordinates (0.5, 12, 100 mm) have float bits ending in zeros: every bit of the key
  // is mixed in (MurmurHash3's finalizer), or most corners would share a few slots
  const fmix = (h) => {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    return h ^ (h >>> 16);
  };
  const slotOf = (a, b, c) => {
    let i = fmix(a ^ fmix(b ^ fmix(c))) & (cap - 1);
    for (;;) {
      if (ids[i] === -1 || (keys[i * 3] === a && keys[i * 3 + 1] === b && keys[i * 3 + 2] === c)) return i;
      i = (i + 1) & (cap - 1);
    }
  };
  const grow = () => {
    const oldKeys = keys, oldIds = ids, oldCap = cap;
    cap *= 2;
    keys = new Uint32Array(cap * 3);
    ids = new Int32Array(cap).fill(-1);
    for (let j = 0; j < oldCap; j++) {
      if (oldIds[j] === -1) continue;
      const i = slotOf(oldKeys[j * 3], oldKeys[j * 3 + 1], oldKeys[j * 3 + 2]);
      keys[i * 3] = oldKeys[j * 3]; keys[i * 3 + 1] = oldKeys[j * 3 + 1]; keys[i * 3 + 2] = oldKeys[j * 3 + 2];
      ids[i] = oldIds[j];
    }
  };
  const corner = (x, y, z) => {
    // -0 and 0 are one corner
    f32[0] = x || 0; f32[1] = y || 0; f32[2] = z || 0;
    const i = slotOf(u32[0], u32[1], u32[2]);
    if (ids[i] !== -1) return ids[i];
    ids[i] = verts;
    keys[i * 3] = u32[0]; keys[i * 3 + 1] = u32[1]; keys[i * 3 + 2] = u32[2];
    if ((verts + 1) * 3 > pos.length) { const d = new Float32Array(pos.length * 2); d.set(pos); pos = d; }
    pos[verts * 3] = f32[0]; pos[verts * 3 + 1] = f32[1]; pos[verts * 3 + 2] = f32[2];
    const id = verts++;
    if (verts > cap * 0.7) grow();
    return id;
  };
  let tooBig = false;
  await eachTriangle(path, (t) => {
    if (tooBig || !finite(t)) return;
    if (count >= MAX_TRIANGLES) { tooBig = true; return; }
    if ((count + 1) * 3 > tri.length) { const d = new Int32Array(tri.length * 2); d.set(tri); tri = d; }
    tri[count * 3] = corner(t[0], t[1], t[2]);
    tri[count * 3 + 1] = corner(t[3], t[4], t[5]);
    tri[count * 3 + 2] = corner(t[6], t[7], t[8]);
    count++;
  });
  return tooBig ? null : { pos, verts, tri, count };
}

// opts.refine: false keeps one grid a body (the tests compare)
async function simplify(path, target = TARGET, opts = {}) {
  const binary = isBinaryStl(path);
  const size = fs.statSync(path).size;
  const expected = binary ? (size - 84) / 50 : Math.ceil(size / 200);
  const mesh = expected <= MAX_TRIANGLES ? await readMesh(path, expected) : null;
  if (!mesh) return simplifyStreamed(path, target);
  const { pos, verts, tri, count } = mesh;
  if (!count) throw new Error('No geometry in the file');

  // Bodies: corners joined by the edges of the triangles (union-find)
  const parent = new Int32Array(verts);
  for (let i = 0; i < verts; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let f = 0; f < count; f++) {
    const a = find(tri[f * 3]);
    for (let k = 1; k < 3; k++) {
      const b = find(tri[f * 3 + k]);
      if (a !== b) parent[b] = a;
    }
  }
  const bodyOf = new Int32Array(verts);
  const rootBody = new Int32Array(verts).fill(-1);
  let bodies = 0;
  for (let i = 0; i < verts; i++) {
    const r = find(i);
    if (rootBody[r] === -1) rootBody[r] = bodies++;
    bodyOf[i] = rootBody[r];
  }
  if (bodies > MAX_BODIES || verts > count * 2.4) { bodyOf.fill(0); bodies = 1; }

  // Per body: box, area, triangles
  const box = new Float64Array(bodies * 6);
  for (let b = 0; b < bodies; b++) { box[b * 6] = box[b * 6 + 1] = box[b * 6 + 2] = Infinity; box[b * 6 + 3] = box[b * 6 + 4] = box[b * 6 + 5] = -Infinity; }
  for (let i = 0; i < verts; i++) {
    const o = bodyOf[i] * 6;
    for (let k = 0; k < 3; k++) {
      const v = pos[i * 3 + k];
      if (v < box[o + k]) box[o + k] = v;
      if (v > box[o + 3 + k]) box[o + 3 + k] = v;
    }
  }
  const area = new Float64Array(bodies);
  const tris = new Int32Array(bodies);
  let total = 0;
  for (let f = 0; f < count; f++) {
    const p0 = tri[f * 3] * 3, p1 = tri[f * 3 + 1] * 3, p2 = tri[f * 3 + 2] * 3;
    const ax = pos[p1] - pos[p0], ay = pos[p1 + 1] - pos[p0 + 1], az = pos[p1 + 2] - pos[p0 + 2];
    const bx = pos[p2] - pos[p0], by = pos[p2 + 1] - pos[p0 + 1], bz = pos[p2 + 2] - pos[p0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const a = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    const b = bodyOf[tri[f * 3]];
    area[b] += a;
    tris[b]++;
    total += a;
  }
  if (!(total > 0)) throw new Error('No geometry in the file');

  // Cells: the size for BASE of the target (all of it without refining), finer for small bodies
  // (MIN_CELLS across, fewer if that would give far more than the target); a body its cells
  // would keep about whole stays as it is
  let span = 0;
  for (let b = 0; b < bodies; b++) for (let k = 0; k < 3; k++) span = Math.max(span, box[b * 6 + 3 + k] - box[b * 6 + k]);
  const refine = opts.refine !== false;
  const big = Math.max(cellFor(total, refine ? target * BASE : target), span / 4096, 1e-6);
  const cell = new Float64Array(bodies);
  const whole = new Uint8Array(bodies);
  for (const across of [MIN_CELLS, 16, 12, 8, 6]) {
    let estimate = 0;
    for (let b = 0; b < bodies; b++) {
      const dx = box[b * 6 + 3] - box[b * 6], dy = box[b * 6 + 4] - box[b * 6 + 1], dz = box[b * 6 + 5] - box[b * 6 + 2];
      const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cell[b] = Math.max(Math.min(big, diag / across), diag / 4096);
      const left = cell[b] > 0 ? (2.2 * area[b]) / (cell[b] * cell[b]) : Infinity;
      whole[b] = left >= tris[b] * 0.8 ? 1 : 0;
      estimate += whole[b] ? tris[b] : left;
    }
    if (estimate <= target * 2) break;
  }

  // Every corner to its cell (a corner of a body kept whole is a cell of its own). A cell of
  // level L is the body's cell halved L times; the grids of a body share their origin, so a cell
  // splits into eight of the next level
  const cells = new Cells();
  const cellOf = new Int32Array(verts);
  const levelOf = new Uint8Array(verts);
  const grids = new Map();
  const assign = (i, level) => {
    const b = bodyOf[i];
    const o = b * 6;
    const s = cell[b] / (1 << level);
    const nx = Math.floor((box[o + 3] - box[o]) / s) + 1;
    const ny = Math.floor((box[o + 4] - box[o + 1]) / s) + 1;
    const ix = Math.min(nx - 1, Math.floor((pos[i * 3] - box[o]) / s));
    const iy = Math.min(ny - 1, Math.floor((pos[i * 3 + 1] - box[o + 1]) / s));
    const iz = Math.floor((pos[i * 3 + 2] - box[o + 2]) / s);
    const key = (iz * ny + iy) * nx + ix;
    let grid = grids.get(b * 8 + level);
    if (!grid) grids.set(b * 8 + level, grid = new Map());
    let c = grid.get(key);
    if (c === undefined) { c = cells.add(s * 0.75); grid.set(key, c); }
    cellOf[i] = c;
    levelOf[i] = level;
  };
  for (let i = 0; i < verts; i++) {
    if (whole[bodyOf[i]]) cellOf[i] = cells.add(-1);
    else assign(i, 0);
  }
  // The corners and the planes of the triangles into their cells
  const gather = () => {
    cells.reset();
    for (let i = 0; i < verts; i++) cells.corner(cellOf[i], pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let f = 0; f < count; f++) {
      const v0 = tri[f * 3], v1 = tri[f * 3 + 1], v2 = tri[f * 3 + 2];
      if (whole[bodyOf[v0]]) continue;
      const p0 = v0 * 3, p1 = v1 * 3, p2 = v2 * 3;
      const ax = pos[p1] - pos[p0], ay = pos[p1 + 1] - pos[p0 + 1], az = pos[p1 + 2] - pos[p0 + 2];
      const bx = pos[p2] - pos[p0], by = pos[p2 + 1] - pos[p0 + 1], bz = pos[p2 + 2] - pos[p0 + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(len > 0)) continue;
      const ux = nx / len, uy = ny / len, uz = nz / len;
      const d = -(ux * pos[p0] + uy * pos[p0 + 1] + uz * pos[p0 + 2]);
      cells.plane(cellOf[v0], len / 2, ux, uy, uz, d);
      cells.plane(cellOf[v1], len / 2, ux, uy, uz, d);
      cells.plane(cellOf[v2], len / 2, ux, uy, uz, d);
    }
  };
  // Detail where it shows: the cells whose one vertex stands worst for their triangles (holes,
  // letters, fillets, thin walls; flat faces and sharp edges stand well) split in eight, the
  // worst first, while the estimate (2.2 triangles a cell of the surface; a split one gives
  // four times as many) stays within the target
  let refined = 0;
  for (let round = 0; refine && round < REFINE; round++) {
    gather();
    const err = cells.errors(cells.positions());
    let estimate = 0;
    const candidates = [];
    for (let c = 0; c < cells.n; c++) {
      if (!cells.used(c)) continue;
      const s = cells.size(c);
      const est = s > 0 ? (2.2 * cells.area(c)) / (s * s) : 1;
      estimate += s > 0 ? est : 1;
      if (s > 0 && err[c] > s * s * 1e-3) candidates.push({ c, e: err[c], est });
    }
    candidates.sort((x, y) => y.e - x.e);
    const split = new Uint8Array(cells.n);
    let n = 0;
    for (const k of candidates) {
      if (estimate + 3 * k.est > target) continue;
      estimate += 3 * k.est;
      split[k.c] = 1;
      n++;
    }
    if (!n) break;
    refined += n;
    for (let i = 0; i < verts; i++) if (split[cellOf[i]]) assign(i, levelOf[i] + 1);
  }
  gather();
  if (cells.n >= 4194304) throw new Error('Too many cells');

  // The triangles that span three cells
  const out = new Triangles();
  const kept = new Int32Array(bodies);
  for (let f = 0; f < count; f++) {
    const v0 = tri[f * 3];
    if (out.add(cellOf[v0], cellOf[tri[f * 3 + 1]], cellOf[tri[f * 3 + 2]])) kept[bodyOf[v0]]++;
  }
  // A body that kept nothing (a speck its cells swallowed) comes as it is
  for (let b = 0; b < bodies; b++) {
    if (kept[b] || !tris[b]) continue;
    const own = new Map();
    const exact = (v) => {
      let c = own.get(v);
      if (c === undefined) { c = cells.add(-1); cells.corner(c, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); own.set(v, c); }
      return c;
    };
    for (let f = 0; f < count; f++) {
      if (bodyOf[tri[f * 3]] !== b) continue;
      out.add(exact(tri[f * 3]), exact(tri[f * 3 + 1]), exact(tri[f * 3 + 2]));
    }
  }
  return { stl: writeStl(out, cells.positions()), triangles: count, kept: out.n, cell: big, bodies, refined };
}

// Files over MAX_TRIANGLES: streamed twice, one grid for all
async function simplifyStreamed(path, target) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let total = 0;
  let count = 0;
  await eachTriangle(path, (t) => {
    if (!finite(t)) return;
    for (let v = 0; v < 9; v += 3) {
      for (let k = 0; k < 3; k++) {
        const x = t[v + k];
        if (x < min[k]) min[k] = x;
        if (x > max[k]) max[k] = x;
      }
    }
    const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
    const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    count++;
  });
  if (!count || !(total > 0)) throw new Error('No geometry in the file');
  const span = max.map((v, i) => v - min[i]);
  const cell = Math.max(cellFor(total, target), Math.max(...span) / 4096, 1e-6);
  const dims = span.map(s => Math.max(1, Math.floor(s / cell) + 1));
  const cellKey = (x, y, z) => {
    const ix = Math.min(dims[0] - 1, Math.floor((x - min[0]) / cell));
    const iy = Math.min(dims[1] - 1, Math.floor((y - min[1]) / cell));
    const iz = Math.min(dims[2] - 1, Math.floor((z - min[2]) / cell));
    return (iz * dims[1] + iy) * dims[0] + ix;
  };
  const cells = new Cells();
  const index = new Map();
  const slot = (key) => {
    let i = index.get(key);
    if (i === undefined) { i = cells.add(cell * 0.75); index.set(key, i); }
    return i;
  };
  const out = new Triangles();
  const c = [0, 0, 0];
  await eachTriangle(path, (t) => {
    if (!finite(t)) return;
    for (let v = 0; v < 3; v++) {
      c[v] = slot(cellKey(t[v * 3], t[v * 3 + 1], t[v * 3 + 2]));
      cells.corner(c[v], t[v * 3], t[v * 3 + 1], t[v * 3 + 2]);
    }
    const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
    const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      const ux = nx / len, uy = ny / len, uz = nz / len;
      const d = -(ux * t[0] + uy * t[1] + uz * t[2]);
      for (let v = 0; v < 3; v++) cells.plane(c[v], len / 2, ux, uy, uz, d);
    }
    out.add(c[0], c[1], c[2]);
  });
  if (cells.n >= 4194304) throw new Error('Too many cells');
  return { stl: writeStl(out, cells.positions()), triangles: count, kept: out.n, cell, bodies: 1 };
}

module.exports = { simplify, TARGET, MIN_CELLS };
