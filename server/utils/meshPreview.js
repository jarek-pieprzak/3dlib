// A light copy of a big STL for previews: the same shape with about TARGET triangles instead of
// millions (VAULT's modules have up to 7 million, 350 MB), small enough for the 3D Studio, card
// and row pictures to load in a moment. Files are streamed twice, so memory follows the target,
// not the file:
//   1. the bounding box and the surface area, which set the size of a grid of cubic cells
//      (about TARGET / 2.2 cells on the surface);
//   2. every corner goes to its cell, every cell sums the planes of its triangles (an error
//      quadric); a triangle whose corners fall in three cells is kept once.
// Each cell becomes one vertex where its planes meet best (the quadric's minimum, near the mean
// of its corners and inside the cell), so flat faces stay flat and edges stay sharp
// (vertex clustering with quadrics, Lindstrom 2000). Walls thinner than a cell (about 1-2 mm on
// VAULT's parts) can show small dents; the full file is a click away.
// simplify(path) resolves to a binary STL Buffer; binary and text STL are read.
const fs = require('fs');

const TARGET = 160000;
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

async function simplify(path, target = TARGET) {
  // 1. Box and area
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let area = 0;
  let triangles = 0;
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
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    triangles++;
  });
  if (!triangles || !(area > 0)) throw new Error('No geometry in the file');

  // 2. Cells: a surface cell gives about 2.2 triangles
  const span = max.map((v, i) => v - min[i]);
  const cell = Math.max(Math.sqrt((2.2 * area) / target), Math.max(...span) / 4096, 1e-6);
  const dims = span.map(s => Math.max(1, Math.floor(s / cell) + 1));
  const cellOf = (x, y, z) => {
    const ix = Math.min(dims[0] - 1, Math.floor((x - min[0]) / cell));
    const iy = Math.min(dims[1] - 1, Math.floor((y - min[1]) / cell));
    const iz = Math.min(dims[2] - 1, Math.floor((z - min[2]) / cell));
    return (iz * dims[1] + iy) * dims[0] + ix;
  };
  // Per cell: quadric a11 a12 a13 a22 a23 a33 b1 b2 b3 (10th unused), sum of corners, count
  const W = 14;
  const index = new Map();
  let data = new Float64Array(W * 65536);
  let cells = 0;
  const slot = (key) => {
    let i = index.get(key);
    if (i === undefined) {
      i = cells++;
      index.set(key, i);
      if (cells * W > data.length) { const d = new Float64Array(data.length * 2); d.set(data); data = d; }
    }
    return i;
  };
  const seen = new Map(); // first two cells -> Set of third cells
  let tris = new Uint32Array(3 * 65536);
  let kept = 0;
  const c = [0, 0, 0];
  await eachTriangle(path, (t) => {
    if (!finite(t)) return;
    for (let v = 0; v < 3; v++) c[v] = slot(cellOf(t[v * 3], t[v * 3 + 1], t[v * 3 + 2]));
    const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
    const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    for (let v = 0; v < 3; v++) {
      const o = c[v] * W;
      if (len > 0) {
        // The triangle's plane, weighted by its area
        const w = len / 2;
        const ux = nx / len, uy = ny / len, uz = nz / len;
        const d = -(ux * t[0] + uy * t[1] + uz * t[2]);
        data[o] += w * ux * ux; data[o + 1] += w * ux * uy; data[o + 2] += w * ux * uz;
        data[o + 3] += w * uy * uy; data[o + 4] += w * uy * uz; data[o + 5] += w * uz * uz;
        data[o + 6] += w * ux * d; data[o + 7] += w * uy * d; data[o + 8] += w * uz * d;
      }
      data[o + 10] += t[v * 3]; data[o + 11] += t[v * 3 + 1]; data[o + 12] += t[v * 3 + 2]; data[o + 13] += 1;
    }
    if (c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) return;
    // The same triangle whichever corner it starts with (the turn, and so the normal, kept)
    let a = c[0], b = c[1], e = c[2];
    if (b < a && b < e) [a, b, e] = [b, e, a];
    else if (e < a && e < b) [a, b, e] = [e, a, b];
    const key = a * 4194304 + b;
    let thirds = seen.get(key);
    if (!thirds) seen.set(key, thirds = new Set());
    if (thirds.has(e)) return;
    thirds.add(e);
    if ((kept + 1) * 3 > tris.length) { const d = new Uint32Array(tris.length * 2); d.set(tris); tris = d; }
    tris[kept * 3] = a; tris[kept * 3 + 1] = b; tris[kept * 3 + 2] = e;
    kept++;
  });
  if (cells >= 4194304) throw new Error('Too many cells');

  // Every cell's vertex: from the mean, along the directions its planes pin down, to the
  // quadric's minimum (directions with a small eigenvalue stay at the mean); kept near the cell
  const pos = new Float32Array(cells * 3);
  const limit = cell * 0.75;
  for (let i = 0; i < cells; i++) {
    const o = i * W;
    const n = data[o + 13];
    const mx = data[o + 10] / n, my = data[o + 11] / n, mz = data[o + 12] / n;
    const A = [data[o], data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5]];
    const gx = A[0] * mx + A[1] * my + A[2] * mz + data[o + 6];
    const gy = A[1] * mx + A[3] * my + A[4] * mz + data[o + 7];
    const gz = A[2] * mx + A[4] * my + A[5] * mz + data[o + 8];
    let px = mx, py = my, pz = mz;
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
    pos[i * 3] = near(px, mx);
    pos[i * 3 + 1] = near(py, my);
    pos[i * 3 + 2] = near(pz, mz);
  }

  // Binary STL with flat normals
  const out = Buffer.alloc(84 + kept * 50);
  out.write('3DLib preview', 0, 'latin1');
  out.writeUInt32LE(kept, 80);
  for (let f = 0; f < kept; f++) {
    const o = 84 + f * 50;
    const p0 = tris[f * 3] * 3, p1 = tris[f * 3 + 1] * 3, p2 = tris[f * 3 + 2] * 3;
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
  return { stl: out, triangles, kept, cell };
}

module.exports = { simplify, TARGET };
