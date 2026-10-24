#!/usr/bin/env node
/* Hero Me Gen7: where every printed part goes on the printhead.
 *
 *   node scripts/hero-me-poses.js <the Hero Me project folder> [out.json]
 *
 * The STLs are printed in their print orientation, wherever their author left them, so they
 * cannot be assembled as they are. Hero Me Gen7 has fixed mounting points, though, and this
 * script finds them: it slices every STL along its axes, finds the round M3 holes and the
 * slots (stadiums), and moves each part so its holes sit on the base's: the hotend mount on
 * the 30 mm pair on top, the skirt on the 22 mm pair underneath, the gantry adapter on the
 * 32 x 12.4 mm rectangle at the back, cable towers and ABL wings on the 18 mm pair at the rear
 * of each side, the extruder mount and risers on the 30 mm pair of the part under them. ABL
 * sensor mounts, ADXL345 mounts (on the skirt's 14 mm pair) and the parts that go with a
 * gantry adapter (clips, back plates) sit on the holes of the part they belong to. Ducts are
 * printed tilted: their big flat walls are turned to face the base's side, their slots go over
 * the side holes, mid height.
 *
 * The result (public/js/kits/hero-me-gen7-poses.json) is read by HeroMe3D: for each file (its
 * path in the project, its size) a rotation and a translation into the printhead's frame (x
 * right, y up, z to the front, the hotend's axis at x = z = 0); stack parts (extruder mounts,
 * risers, caps) go on top of what is under them at run time. Parts it cannot place are left
 * out: the 3D printhead draws its own shape for them.
 */
const fs = require('fs');
const path = require('path');
require('../public/js/kits/hero-me-gen7.js');

const K = globalThis.HeroMeKit;
const ROOT = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '../public/js/kits/hero-me-gen7-poses.json');
if (!ROOT) {
  console.error('Usage: node scripts/hero-me-poses.js <the Hero Me project folder> [out.json]');
  process.exit(1);
}

// ── Vectors and the 24 rotations that keep the axes ──
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));
const perp = (a, e) => sub(a, scale(e, dot(a, e)));
const apply = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const matmul = (a, b) => [0, 1, 2].map(i => [0, 1, 2].map(j => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
const transpose = (m) => [0, 1, 2].map(i => [0, 1, 2].map(j => m[j][i]));
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ROTATIONS = [];
for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
  for (let s = 0; s < 8; s++) {
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) m[i][p[i]] = (s >> i) & 1 ? -1 : 1;
    const det = dot(m[0], cross(m[1], m[2]));
    if (det === 1) ROTATIONS.push(m);
  }
}
// The rotation that turns direction a onto direction b (both unit)
function rotationTo(a, b) {
  const v = cross(a, b);
  const c = dot(a, b);
  if (c > 0.999999) return IDENTITY;
  if (c < -0.999999) {
    const ax = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [0, 1, 2].map(i => [0, 1, 2].map(j => 2 * ax[i] * ax[j] - (i === j ? 1 : 0)));
  }
  const k = 1 / (1 + c);
  const vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]];
  const vx2 = matmul(vx, vx);
  return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + vx[i][j] + vx2[i][j] * k));
}

// ── STL ──
function readStl(file) {
  const buf = fs.readFileSync(file);
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (84 + n * 50 === buf.length) {
    const V = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) V[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4);
    return V;
  }
  const v = [...buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => [+m[1], +m[2], +m[3]]);
  return Float32Array.from(v.slice(0, v.length - (v.length % 9)));
}
function rotated(V, m) {
  const out = new Float32Array(V.length);
  for (let i = 0; i < V.length; i += 3) {
    const p = apply(m, [V[i], V[i + 1], V[i + 2]]);
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  return out;
}
function bounds(V) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], V[i + k]); mx[k] = Math.max(mx[k], V[i + k]); }
  return { mn, mx };
}
function centroid(V) {
  const c = [0, 0, 0];
  for (let i = 0; i < V.length; i += 3) { c[0] += V[i]; c[1] += V[i + 1]; c[2] += V[i + 2]; }
  return scale(c, 3 / V.length);
}

// ── Holes, slots and bores: closed loops of slices across each axis ──
function sliceLoops(V, tris, a, b, c, t) {
  const segs = [];
  for (const i of tris) {
    const o = i * 9;
    const d = [V[o + a] - t, V[o + 3 + a] - t, V[o + 6 + a] - t];
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const f = (e + 1) % 3;
      if ((d[e] < 0) !== (d[f] < 0)) {
        const k = d[e] / (d[e] - d[f]);
        pts.push([V[o + e * 3 + b] + (V[o + f * 3 + b] - V[o + e * 3 + b]) * k, V[o + e * 3 + c] + (V[o + f * 3 + c] - V[o + e * 3 + c]) * k]);
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  const key = (p) => `${Math.round(p[0] * 500)},${Math.round(p[1] * 500)}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    let end = segs[i][1];
    for (let guard = 0; guard < 20000; guard++) {
      const next = (at.get(key(end)) || []).find(j => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      end = key(segs[next][0]) === key(end) ? segs[next][1] : segs[next][0];
      loop.push(end);
    }
    if (loop.length > 6 && key(end) === key(loop[0])) loops.push(loop);
  }
  return loops;
}

function classify(loop) {
  const n = loop.length;
  const cx = loop.reduce((s, p) => s + p[0], 0) / n;
  const cy = loop.reduce((s, p) => s + p[1], 0) / n;
  const rs = loop.map(p => Math.hypot(p[0] - cx, p[1] - cy));
  const r = rs.reduce((s, v) => s + v, 0) / n;
  const dev = Math.max(...rs.map(v => Math.abs(v - r)));
  if (r >= 1.2 && r <= 2.8 && dev < 0.3) return { kind: 'hole', c: [cx, cy], r };
  if (r >= 6 && r <= 28 && dev < Math.max(0.5, r * 0.04)) return { kind: 'bore', c: [cx, cy], r };
  // A slot: the points stay at one distance from a straight segment
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of loop) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = [Math.cos(ang), Math.sin(ang)];
  const along = loop.map(p => (p[0] - cx) * dir[0] + (p[1] - cy) * dir[1]);
  const across = loop.map(p => -(p[0] - cx) * dir[1] + (p[1] - cy) * dir[0]);
  const half = Math.max(...across.map(Math.abs));
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  if (half < 1.3 || half > 2.6 || hi - lo < 2 * half + 1) return null;
  const mid = (lo + hi) / 2;
  const straight = (hi - lo) / 2 - half;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-straight, Math.min(straight, along[i] - mid));
    if (Math.abs(Math.hypot(along[i] - mid - s, across[i]) - half) > 0.35) return null;
  }
  return { kind: 'slot', c: [cx + dir[0] * mid, cy + dir[1] * mid], r: half, dir, straight };
}

function features(V, step = 0.5) {
  const { mn, mx } = bounds(V);
  const n = V.length / 9;
  const out = { holes: [], slots: [], bores: [] };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    const count = Math.max(1, Math.ceil((mx[a] - mn[a]) / step));
    const buckets = Array.from({ length: count }, () => []);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const lo = Math.min(V[o + a], V[o + 3 + a], V[o + 6 + a]);
      const hi = Math.max(V[o + a], V[o + 3 + a], V[o + 6 + a]);
      const s0 = Math.max(0, Math.floor((lo - mn[a]) / step - 0.5));
      const s1 = Math.min(count - 1, Math.ceil((hi - mn[a]) / step - 0.5));
      for (let s = s0; s <= s1; s++) buckets[s].push(i);
    }
    const groups = new Map();
    for (let s = 0; s < count; s++) {
      const t = mn[a] + (s + 0.5) * step;
      for (const loop of sliceLoops(V, buckets[s], a, b, c, t)) {
        const f = classify(loop);
        if (!f) continue;
        const k = `${f.kind}|${Math.round(f.c[0])}|${Math.round(f.c[1])}${f.kind === 'slot' ? `|${Math.round(Math.atan2(f.dir[1], f.dir[0]) * 6) % 19}` : ''}`;
        const g = groups.get(k) || { ...f, ts: [], rs: [], cs: [] };
        g.ts.push(t); g.rs.push(f.r); g.cs.push(f.c);
        groups.set(k, g);
      }
    }
    for (const g of groups.values()) {
      if (g.ts.length < 3) continue;
      const from = Math.min(...g.ts);
      const to = Math.max(...g.ts);
      const c2 = [g.cs.reduce((s, v) => s + v[0], 0) / g.cs.length, g.cs.reduce((s, v) => s + v[1], 0) / g.cs.length];
      const p = [0, 0, 0];
      p[a] = (from + to) / 2; p[b] = c2[0]; p[c] = c2[1];
      const f = { a, d: AXES[a], p, r: g.rs.reduce((s, v) => s + v, 0) / g.rs.length, from, to };
      if (g.kind === 'slot') {
        const dir = [0, 0, 0];
        dir[b] = g.dir[0]; dir[c] = g.dir[1];
        out.slots.push({ ...f, dir, straight: g.straight });
      } else out[g.kind === 'hole' ? 'holes' : 'bores'].push(f);
    }
  }
  // A hole found twice along its length (a counterbore splits it) is one hole
  out.holes = out.holes.filter((h, i) => !out.holes.some((o, j) => j < i && o.a === h.a && norm(perp(sub(o.p, h.p), h.d)) < 0.6 && Math.abs(o.r - h.r) < 0.6
    && Math.min(o.to, h.to) - Math.max(o.from, h.from) > -1.5 && (Object.assign(o, { from: Math.min(o.from, h.from), to: Math.max(o.to, h.to) }), true)));
  return out;
}

// A part ready for fitting: its vertices (pre-rotated, for ducts), features, centroid, bounds
function load(file, pre = IDENTITY) {
  const raw = readStl(file);
  const V = pre === IDENTITY ? raw : rotated(raw, pre);
  return { file, pre, V, f: features(V), c: centroid(V), b: bounds(V) };
}

const placeBox = (part, R, t) => {
  const corners = [];
  for (const x of [part.b.mn[0], part.b.mx[0]]) for (const y of [part.b.mn[1], part.b.mx[1]]) for (const z of [part.b.mn[2], part.b.mx[2]]) corners.push(add(apply(R, [x, y, z]), t));
  const mn = [0, 1, 2].map(k => Math.min(...corners.map(p => p[k])));
  const mx = [0, 1, 2].map(k => Math.max(...corners.map(p => p[k])));
  return { mn, mx, c: scale(add(mn, mx), 0.5) };
};

// The material round a hole (1-5 mm from its axis), as part vertices
function ring(part, h, inner = 1, outer = 5) {
  const out = [];
  const V = part.V;
  for (let i = 0; i < V.length; i += 3) {
    const w = [V[i] - h.p[0], V[i + 1] - h.p[1], V[i + 2] - h.p[2]];
    const rr = norm(perp(w, h.d));
    if (rr > h.r + inner && rr < h.r + outer) out.push([V[i], V[i + 1], V[i + 2]]);
  }
  return out;
}
const extent = (points, R, dir) => {
  const w = apply(transpose(R), dir);
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { const v = dot(p, w); if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi };
};

// Holes of a part onto a target pair (or more): its holes i, j on q1, q2, the material round
// them touching the face (a coordinate along out). prefer(placed) -> lower is better.
function fitPair(part, target, prefer, opts = {}) {
  const H = part.f.holes.filter(h => !opts.r || Math.abs(h.r - opts.r) < 0.6);
  const span = norm(sub(target.q[1], target.q[0]));
  const v = perp(sub(target.q[1], target.q[0]), target.out);
  const rings = new Map();
  let best = null;
  for (const R of ROTATIONS) {
    for (let i = 0; i < H.length; i++) for (let j = 0; j < H.length; j++) {
      if (i === j || H[i].a !== H[j].a) continue;
      if (Math.abs(Math.abs(dot(apply(R, H[i].d), target.out)) - 1) > 1e-6) continue;
      if (Math.abs(norm(sub(H[j].p, H[i].p)) - span) > 0.45) continue;
      const u = perp(apply(R, sub(H[j].p, H[i].p)), target.out);
      if (norm(sub(u, v)) > 0.6) continue;
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (!rings.has(key)) rings.set(key, [...ring(part, H[i]), ...ring(part, H[j])]);
      const pts = rings.get(key);
      if (!pts.length) continue;
      let t = perp(sub(target.q[0], apply(R, H[i].p)), target.out);
      t = add(t, scale(target.out, target.face - extent(pts, R, target.out).lo));
      // Other holes of the target the part covers too (the gantry rectangle)
      let matched = 2;
      for (const q of target.more || []) {
        if (H.some(h => norm(perp(sub(add(apply(R, h.p), t), q), target.out)) < 0.7)) matched++;
      }
      const placed = { R, t, box: placeBox(part, R, t), c: add(apply(R, part.c), t), matched, ringTop: extent(pts, R, target.out).hi + dot(t, target.out) };
      const score = prefer(placed) - matched * 50;
      if (!best || score < best.score) best = { ...placed, score };
    }
  }
  return best;
}

// Holes of a part onto the holes of another placed part: at least two must meet. The part sits
// on one side of the parent's material round the holes (local: round the holes it meets
// only, for a big parent like a duct); prefer picks the side.
function fitOn(part, parent, prefer, local = false) {
  const P = parent.holes;
  const H = part.f.holes;
  let best = null;
  for (const R of ROTATIONS) {
    for (let i = 0; i < H.length; i++) {
      const d = apply(R, H[i].d);
      for (const k of P) {
        if (Math.abs(Math.abs(dot(d, k.d)) - 1) > 1e-6 || Math.abs(k.r - H[i].r) > 0.7) continue;
        const t0 = perp(sub(k.p, apply(R, H[i].p)), k.d);
        const meet = (h) => P.find(q => Math.abs(Math.abs(dot(q.d, k.d)) - 1) < 1e-6 && norm(perp(sub(add(apply(R, h.p), t0), q.p), k.d)) < 0.7);
        const hits = H.filter(h => Math.abs(Math.abs(dot(apply(R, h.d), k.d)) - 1) < 1e-6 && meet(h));
        if (hits.length < 2) continue;
        const pts = hits.flatMap(h => ring(part, h));
        if (!pts.length) continue;
        const e = extent(pts, R, k.d);
        // The parent's material along this axis round the same holes
        const along = local ? parent.extentNear(k.d, hits.map(meet)) : parent.extentAlong(k.d);
        for (const side of [1, -1]) {
          const face = side > 0 ? along.hi : along.lo;
          const t = add(t0, scale(k.d, side > 0 ? face - e.lo : face - e.hi));
          const placed = { R, t, box: placeBox(part, R, t), c: add(apply(R, part.c), t), matched: hits.length };
          const score = prefer(placed) - hits.length * 50;
          if (!best || score < best.score) best = { ...placed, score };
        }
      }
    }
  }
  return best;
}

// A placed part as a parent: its holes in the base frame and its material along a direction
function asParent(part, pose) {
  const holes = part.f.holes.map((h, i) => ({ ...h, p: add(apply(pose.R, h.p), pose.t), d: apply(pose.R, h.d), i }));
  const material = part.f.holes.flatMap(h => ring(part, h));
  const memo = new Map();
  return {
    holes,
    // Round some of its holes only
    extentNear(dir, near) {
      const e = extent(near.flatMap(q => ring(part, part.f.holes[q.i])), pose.R, dir);
      return { lo: e.lo + dot(pose.t, dir), hi: e.hi + dot(pose.t, dir) };
    },
    extentAlong(dir) {
      const k = dir.join(',');
      if (!memo.has(k)) {
        const e = extent(material, pose.R, dir);
        memo.set(k, { lo: e.lo + dot(pose.t, dir), hi: e.hi + dot(pose.t, dir) });
      }
      return memo.get(k);
    }
  };
}

// ── The reference base: its mounting points ──
function mountPoints(base) {
  const H = base.f.holes;
  const pairs = (list, span) => {
    const out = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.abs(norm(sub(list[j].p, list[i].p)) - span) < 0.5) out.push([list[i], list[j]]);
    return out;
  };
  const z = H.filter(h => h.a === 2);
  const top = pairs(z, 30).sort((p, q) => Math.max(q[0].to, q[1].to) - Math.max(p[0].to, p[1].to))[0];
  const bottom = pairs(z, 22).sort((p, q) => Math.min(p[0].from, p[1].from) - Math.min(q[0].from, q[1].from))[0];
  const yMax = base.b.mx[1];
  const back = H.filter(h => h.a === 1 && h.to > yMax - 6 && h.r > 1.7);
  const x = H.filter(h => h.a === 0);
  const side = pairs(x, 18).sort((p, q) => q[0].p[1] - p[0].p[1])[0];
  const ductHoles = x.filter(h => !side.includes(h));
  const faceOf = (holes, dir, hi) => { const e = extent(holes.flatMap(h => ring(base, h)), IDENTITY, dir); return hi ? e.hi : e.lo; };
  const axisBore = base.f.bores.filter(b => b.a === 2 && b.r > 7 && b.r < 16).sort((p, q) => q.to - q.from - (p.to - p.from))[0];
  const axis = axisBore ? [axisBore.p[0], axisBore.p[1]] : [(top[0].p[0] + top[1].p[0]) / 2, (top[0].p[1] + top[1].p[1]) / 2];
  return {
    axis,
    top, topFace: faceOf(top, [0, 0, 1], true),
    bottom, bottomFace: -faceOf(bottom, [0, 0, 1], false),
    back, backFace: faceOf(back, [0, 1, 0], true),
    side, leftFace: -faceOf(side, [1, 0, 0], false), rightFace: faceOf(side, [1, 0, 0], true),
    ductHoles, ductLeft: base.b.mn[0], ductRight: base.b.mx[0],
    center: scale(add(base.b.mn, base.b.mx), 0.5),
    box: base.b
  };
}

// ── Ducts: big flat walls to the base's side, the slot over the side holes ──
// The two biggest opposite normals of the mesh: the walls of the duct
function wallNormal(V) {
  const bins = new Map();
  for (let i = 0; i < V.length; i += 9) {
    const u = [V[i + 3] - V[i], V[i + 4] - V[i + 1], V[i + 5] - V[i + 2]];
    const w = [V[i + 6] - V[i], V[i + 7] - V[i + 1], V[i + 8] - V[i + 2]];
    const n = cross(u, w);
    const ar = norm(n) / 2;
    if (!ar) continue;
    const nn = scale(n, 1 / (2 * ar));
    const k = nn.map(x => Math.round(x * 20)).join(',');
    const bin = bins.get(k) || { n: [0, 0, 0], area: 0 };
    bin.n = add(bin.n, scale(nn, ar));
    bin.area += ar;
    bins.set(k, bin);
  }
  let best = null;
  for (const [k, b] of bins) {
    const opp = bins.get(k.split(',').map(x => -Number(x)).join(','));
    if (!opp) continue;
    const area = Math.min(b.area, opp.area);
    if (!best || area > best.area) best = { area, n: unit(b.n) };
  }
  return best ? best.n : [1, 0, 0];
}

// tipZ: where the outlets of the ducts placed so far are (the reference duct's), null at first;
// twin: the box the duct's other side would have, mirrored (a left / right pair is alike)
function fitDuct(file, mp, sideWanted, tipZ, twin = null) {
  const n = wallNormal(readStl(file));
  const pre = rotationTo(n, [1, 0, 0]);
  const part = load(file, pre);
  const slots = part.f.slots.filter(s => s.a === 0);
  // The fan: a round opening for its hub, or else the middle of its two screw ears (a 5015
  // blower is held by two corners, 35-60 mm apart)
  let fanBore = part.f.bores.filter(b => b.a === 0).sort((p, q) => q.r - p.r)[0] || null;
  if (!fanBore) {
    const ears = part.f.holes.filter(h => h.a === 0);
    let pair = null;
    for (let i = 0; i < ears.length; i++) for (let j = i + 1; j < ears.length; j++) {
      const d = norm(sub(ears[j].p, ears[i].p));
      if (d >= 35 && d <= 60 && (!pair || d > pair.d)) pair = { d, p: scale(add(ears[i].p, ears[j].p), 0.5) };
    }
    if (pair) fanBore = { a: 0, d: [1, 0, 0], p: pair.p, r: pair.d / 2, ears: true };
  }
  const width = part.b.mx[0] - part.b.mn[0];
  const both = width > (mp.ductRight - mp.ductLeft) + 10;
  const cols = [...new Set(mp.ductHoles.map(h => Math.round(h.p[1] * 2) / 2))];
  const rowsZ = [...new Set(mp.ductHoles.map(h => Math.round(h.p[2] * 2) / 2))];
  const midZ = mp.ductHoles.reduce((s, h) => s + h.p[2], 0) / mp.ductHoles.length;
  const baseW = mp.ductRight - mp.ductLeft;
  const cx = (mp.ductLeft + mp.ductRight) / 2;
  const backY = mp.backFace;
  let best = null;
  // Rotations that keep the walls facing the side: four turns about x, and the same flipped
  for (const R of ROTATIONS.filter(m => Math.abs(m[0][0]) === 1)) {
    const box0 = placeBox(part, R, [0, 0, 0]);
    // A slot set up and down (Gen7: the height is set) or front to back (Gen6)
    const vslots = slots.filter(s => Math.abs(apply(R, s.dir)[2]) > 0.9);
    const hslots = slots.filter(s => Math.abs(apply(R, s.dir)[1]) > 0.9);
    const options = [...vslots.map(s => ({ s, up: true })), ...hslots.map(s => ({ s, up: false }))];
    if (!options.length) options.push({ s: null });
    for (const side of both ? ['both'] : sideWanted ? [sideWanted] : ['left', 'right']) {
      for (const { s: s0, up } of options) {
        // Across: against the side of the base (a dual duct spans the base)
        let tx;
        if (side === 'both') tx = cx - (box0.mn[0] + box0.mx[0]) / 2;
        else {
          // The wall that touches the base: the slot's material (or the inner face of the box)
          const pts = s0 ? ring(part, { p: s0.p, d: s0.d, r: s0.r + s0.straight }, 0.8, 4) : [];
          const e = pts.length ? extent(pts, R, [1, 0, 0]) : { lo: box0.mn[0], hi: box0.mx[0] };
          tx = side === 'left' ? mp.ductLeft - e.hi : mp.ductRight - e.lo;
        }
        // Front to back: the slot on a column of side holes; up and down: a slot set up and
        // down has its middle on the holes' middle (where the height is set when it is
        // fitted), one set front to back sits on a row of holes
        const places = !s0 ? [[mp.axis[1] - (box0.mn[1] + box0.mx[1]) / 2, 0]]
          : up ? cols.map(col => [col - apply(R, s0.p)[1], midZ - apply(R, s0.p)[2]])
            : cols.flatMap(col => rowsZ.map(z => [col - apply(R, s0.p)[1], z - apply(R, s0.p)[2]]));
        for (const [ty, tz] of places) {
          const t = [tx, ty, tz];
          const box = placeBox(part, R, t);
          const c = add(apply(R, part.c), t);
          // The outlet: the end of the channel farthest from the fan's ring (or the lowest point
          // without a ring), under the hotend and below the fan; the body outside the base,
          // never behind it (the printer's carriage is there)
          const fc = fanBore ? add(apply(R, fanBore.p), t) : null;
          let low = null;
          let lowL = null;
          let lowR = null;
          let far = -1;
          let behind = 0;
          // Nothing in the hotend's column between the base and the nozzle, nothing in the base
          let column = 0;
          let inside = 0;
          const bb = mp.box;
          const colTop = -mp.bottomFace - 1;
          const colLow = (tipZ !== null ? tipZ : bb.mn[2] - 20) + 4;
          for (let i = 0; i < part.V.length; i += 3) {
            const p = add(apply(R, [part.V[i], part.V[i + 1], part.V[i + 2]]), t);
            if (p[2] > colLow && p[2] < colTop && Math.hypot(p[0] - mp.axis[0], p[1] - mp.axis[1]) < 9) column++;
            if (p[0] > bb.mn[0] + 2 && p[0] < bb.mx[0] - 2 && p[1] > bb.mn[1] + 2 && p[1] < bb.mx[1] - 2 && p[2] > bb.mn[2] + 2 && p[2] < bb.mx[2] - 2) inside++;
            if (fc) {
              const dd = Math.hypot(p[1] - fc[1], p[2] - fc[2]);
              if (dd > far) { far = dd; low = p; }
            } else if (!low || p[2] < low[2]) low = p;
            if (p[1] > backY + 2) behind++;
            if (p[0] < cx - 4 && (!lowL || p[2] < lowL[2])) lowL = p;
            if (p[0] > cx + 4 && (!lowR || p[2] < lowR[2])) lowR = p;
          }
          // Every slot on a side hole: a Gen7 duct has two slot columns 22.5 mm apart, like the
          // base's two hole columns, and sits on both
          const onHoles = new Set();
          for (const s of slots) {
            const sp = add(apply(R, s.p), t);
            const sd = apply(R, s.dir);
            for (const h of mp.ductHoles) {
              const along = (h.p[1] - sp[1]) * sd[1] + (h.p[2] - sp[2]) * sd[2];
              const across = Math.hypot(h.p[1] - sp[1] - along * sd[1], h.p[2] - sp[2] - along * sd[2]);
              if (across < 1.5 && Math.abs(along) <= s.straight + 1) onHoles.add(`${Math.round(sp[1])},${Math.round(sp[2])}`);
            }
          }
          const fanLow = fc && fc[2] - low[2] < 12 ? 40 : 0;
          const reach = side === 'both' ? Math.abs(c[0] - cx) : Math.abs(low[0] - cx);
          const outside = side === 'both' ? 0 : Math.max(0, baseW / 2 + 2 - Math.abs(c[0] - cx));
          // The fan on the outer wall, never against the base
          const fp = fanBore ? add(apply(R, fanBore.p), t) : null;
          const fanIn = fp && side !== 'both' && (side === 'left' ? fp[0] > mp.ductLeft - 2 : fp[0] < mp.ductRight + 2) ? 25 : 0;
          // A duct round both sides has its outlets either side of the nozzle, not one under it
          const midLow = side === 'both' && Math.abs(low[0] - cx) < 5 ? 40 : 0;
          // ...and both of them down by the nozzle
          const twoLow = side === 'both' && lowL && lowR && tipZ !== null ? (Math.abs(lowL[2] - tipZ) + Math.abs(lowR[2] - tipZ)) * 0.8 : 0;
          const twinGap = twin ? [0, 1, 2].reduce((s, k) => s + Math.abs(box.mn[k] - twin.mn[k]) + Math.abs(box.mx[k] - twin.mx[k]), 0) * 2 : 0;
          const score = twinGap - 20 * onHoles.size + fanIn + fanLow + midLow + twoLow + Math.hypot(low[1] - mp.axis[1], reach * (side === 'both' ? 0.2 : 1)) + outside * 4
            + (c[2] < low[2] + 5 ? 30 : 0) + (s0 ? 0 : 15) + Math.max(0, box.mx[2] - (mp.topFace + 25)) * 1.2
            + (behind / (part.V.length / 3)) * 600 +(column ? 10 + (column / (part.V.length / 3)) * 300 : 0) + (inside / (part.V.length / 3)) * 200 + (tipZ !== null ? Math.abs(low[2] - tipZ) * 0.6 : 0) + (up ? 0 : 1);
          if (!best || score < best.score) best = { R, t, box, low, side, score, both, slot: Boolean(s0) };
        }
      }
    }
  }
  if (!best) return null;
  const R = matmul(best.R, pre);
  return { R, t: best.t, side: best.side, low: best.low, slot: best.slot, box: best.box, score: best.score };
}

// A box mirrored to the base's other side
function mirrorBox(box, mp) {
  const c = mp.ductLeft + mp.ductRight;
  return { mn: [c - box.mx[0], box.mn[1], box.mn[2]], mx: [c - box.mn[0], box.mx[1], box.mx[2]] };
}
const boxGap = (a, b) => [0, 1, 2].reduce((s, k) => s + Math.abs(a.mn[k] - b.mn[k]) + Math.abs(a.mx[k] - b.mx[k]), 0);

// ── Bases: each one onto the reference base, by as many holes as they share ──
function fitBase(part, ref) {
  const Q = ref.f.holes;
  let best = null;
  for (const R of ROTATIONS) {
    for (const h of part.f.holes) {
      const d = apply(R, h.d);
      for (const q of Q) {
        if (q.a !== AXES.findIndex(ax => Math.abs(dot(ax, d)) > 0.99) || Math.abs(q.r - h.r) > 0.4) continue;
        const t0 = sub(q.p, apply(R, h.p));
        const hits = [];
        for (const g of part.f.holes) {
          const p = add(apply(R, g.p), t0);
          const gd = apply(R, g.d);
          const m = Q.find(o => Math.abs(Math.abs(dot(o.d, gd)) - 1) < 1e-6 && norm(perp(sub(o.p, p), o.d)) < 0.8 && Math.abs(o.r - g.r) < 0.5);
          if (m) hits.push([p, m, gd]);
        }
        if (hits.length < 3 || (best && hits.length <= best.hits)) continue;
        // Refine: each axis's holes say where the part is across that axis
        const t = t0.slice();
        for (let k = 0; k < 3; k++) {
          const across = hits.filter(([, m]) => m.a !== k).map(([p, m]) => m.p[k] - p[k]);
          if (across.length) t[k] += across.reduce((s, v) => s + v, 0) / across.length;
        }
        best = { R, t, hits: hits.length };
      }
    }
  }
  return best;
}

// ── Run ──
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else out.push({ id: out.length + 1, original_name: r, file_size: fs.statSync(full).size });
    }
  };
  walk(dir, '');
  return out;
}

function main() {
  const started = Date.now();
  const files = listFiles(ROOT);
  const cat = K.buildCatalog(files);
  const abs = (f) => path.join(ROOT, ...f.original_name.split('/'));
  const cache = new Map();
  const get = (f, pre) => {
    const k = `${f.original_name}|${pre ? JSON.stringify(pre) : ''}`;
    if (!cache.has(k)) {
      // Parents are asked for again; the rest is forgotten after a while
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      cache.set(k, load(abs(f), pre || IDENTITY));
    }
    return cache.get(k);
  };
  const ref = cat.byId['7.4'] || cat.releases[0];
  const refBaseFile = (ref.slots.bases.find(o => /universal base/i.test(o.label)) || ref.slots.bases[0]).files[0];
  const refBase = get(refBaseFile);
  const mp = mountPoints(refBase);
  console.log('reference base', refBaseFile.original_name, 'axis', mp.axis.map(v => v.toFixed(2)), 'top face', mp.topFace.toFixed(2), 'bottom face', mp.bottomFace.toFixed(2),
    'back holes', mp.back.length, 'duct holes', mp.ductHoles.length);

  const poses = {};
  const report = {};
  // The same file (name and size) in another release has the same place
  const known = new Map();
  const note = (kind, ok) => { report[kind] = report[kind] || { ok: 0, no: 0 }; report[kind][ok ? 'ok' : 'no']++; };
  const save = (f, kind, pose, extra = {}) => {
    poses[f.original_name] = { size: f.file_size, kind, R: pose.R, t: pose.t, box: pose.box, ...extra };
    known.set(`${f.original_name.split('/').pop()}|${f.file_size}`, poses[f.original_name]);
  };
  const reuse = (f) => {
    const p = known.get(`${f.original_name.split('/').pop()}|${f.file_size}`);
    if (p && !p.on) poses[f.original_name] = { ...p, size: f.file_size };
    return Boolean(p && !p.on);
  };
  const dist2 = (c, p) => Math.hypot(c[0] - p[0], c[1] - p[1]);
  const top = { q: [mp.top[0].p, mp.top[1].p], out: [0, 0, 1], face: mp.topFace };
  const bottom = { q: [mp.bottom[0].p, mp.bottom[1].p], out: [0, 0, -1], face: mp.bottomFace };
  const backPair = (() => { let b = null; for (const h of mp.back) for (const g of mp.back) if (!b || norm(sub(g.p, h.p)) > norm(sub(b[1].p, b[0].p))) b = [h, g]; return b; })();
  const back = { q: [backPair[0].p, backPair[1].p], out: [0, 1, 0], face: mp.backFace, more: mp.back.filter(h => !backPair.includes(h)).map(h => h.p) };
  const sideTarget = (side) => (side === 'right'
    ? { q: mp.side.map(h => [mp.rightFace, h.p[1], h.p[2]]), out: [1, 0, 0], face: mp.rightFace }
    : { q: mp.side.map(h => [-mp.leftFace, h.p[1], h.p[2]]), out: [-1, 0, 0], face: mp.leftFace });
  const stack = { q: [[mp.top[0].p[0], mp.top[0].p[1], 0], [mp.top[1].p[0], mp.top[1].p[1], 0]], out: [0, 0, 1], face: 0 };
  const sideOf = (label) => (/(^|[^a-z])right([^a-z]|$)/i.test(label) ? 'right' : 'left');

  // The reference duct (7.4, standard, Gen7 left 5015) first: the others' outlets go where its
  // outlet is (tall and long ones lower, they are for longer hotends)
  let tipZ = null;
  {
    const d = (cat.byId['7.4'] || ref).slots.ducts.find(x => x.id === 'standard:5015:gen7-single');
    const f = d && d.sides.left;
    const p = f && fitDuct(abs(f), mp, 'left', null);
    if (p) tipZ = p.low[2];
    console.log('reference duct tip', tipZ && tipZ.toFixed(2));
  }
  // ONLY=7.4 (ids, comma separated) fits those releases only, for a quick look
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const r of cat.releases.filter(x => !only || only.includes(x.id))) {
    const s = r.slots;
    const own = new Set(r.files.map(f => f.original_name));
    const mine = (o) => o.files.filter(f => own.has(f.original_name) && !poses[f.original_name] && !reuse(f));
    // Bases
    for (const o of s.bases) for (const f of mine(o)) {
      const part = get(f);
      const p = f.original_name === refBaseFile.original_name ? { R: IDENTITY, t: [0, 0, 0], hits: 99 } : fitBase(part, refBase);
      note('base', Boolean(p));
      if (p) save(f, 'base', { ...p, box: placeBox(part, p.R, p.t) });
    }
    // Hotend mounts: on top, the clamp down in the base, round the hotend's axis
    for (const o of s.hotends) for (const f of mine(o)) {
      const p = fitPair(get(f), top, (x) => dist2(x.c, mp.axis) + 0.3 * (x.c[2] - mp.topFace));
      note('hotend', Boolean(p));
      if (p) save(f, 'hotend', p, { top: p.ringTop });
    }
    // Skirts under the base
    for (const o of s.skirts) for (const f of mine(o)) {
      const p = fitPair(get(f), bottom, (x) => dist2(x.c, mp.axis) + 0.3 * (x.c[2] - (-mp.bottomFace)));
      note('skirt', Boolean(p));
      if (p) save(f, 'skirt', p);
    }
    // Stack parts on the 30 mm pair: caps, risers, extruder mounts (front / rear by name)
    for (const [list, kind] of [[s.caps, 'cap'], [s.risers, 'riser'], [s.extruders, 'extruder']]) {
      for (const o of list) for (const f of mine(o)) {
        const label = o.label;
        const way = kind !== 'extruder' ? 0 : /rear/i.test(label) && !/front-rear/i.test(label) ? 1 : /front/i.test(label) && !/front-rear/i.test(label) ? -1 : 0;
        const part = get(f);
        const p = fitPair(part, stack, (x) => dist2(x.c, mp.axis) * (way ? 0.1 : 1) - 0.3 * x.c[2] - way * (x.c[1] - mp.axis[1]));
        note(kind, Boolean(p));
        if (!p) continue;
        const extra = kind === 'riser' ? { height: p.ringTop } : {};
        // A standing motor plate: the round opening for the stepper's boss (22-28 mm). The
        // stepper goes on the side away from the hotend, the extruder on the other
        const boss = kind === 'extruder' && part.f.bores.filter(b => b.r > 9 && b.r < 14).sort((a, b) => b.r - a.r)[0];
        if (boss) {
          const c = add(apply(p.R, boss.p), p.t);
          let n = apply(p.R, AXES[boss.a]);
          if (dot(n, sub(c, [mp.axis[0], mp.axis[1], c[2]])) < 0) n = scale(n, -1);
          if (Math.abs(n[2]) < 0.5) extra.motor = { p: c, n };
        }
        save(f, 'stack', p, extra);
      }
    }
    // Gantry adapters (and X carriages) on the back rectangle, the parts that go with them on
    // their holes, behind them
    // (a part placed in another release is a parent here too)
    const placed = (o) => o.files.filter(f => poses[f.original_name] && own.has(f.original_name));
    const placedMains = [];
    for (const o of s.mains) {
      for (const f of mine(o)) {
        const p = fitPair(get(f), back, (x) => Math.hypot(x.c[0] - mp.center[0], x.c[2] - mp.center[2]) + (x.matched < 3 ? 40 : 0));
        const ok = p && p.matched >= 3;
        note('gantry', ok);
        if (ok) save(f, 'gantry', p);
      }
      for (const f of placed(o)) placedMains.push({ o, f, part: get(f), p: poses[f.original_name] });
    }
    for (const [folder, extras] of Object.entries(s.gantryExtras)) {
      const parents = placedMains.filter(m => m.o.folder === folder);
      for (const o of extras) for (const f of o.files.filter(x => own.has(x.original_name))) {
        const on = {};
        for (const m of parents) {
          const p = fitOn(get(f), asParent(m.part, m.p), (x) => -x.c[1]);
          if (p) on[m.f.original_name] = { R: p.R, t: p.t, box: p.box };
        }
        note('gantry extra', Object.keys(on).length > 0);
        if (Object.keys(on).length) poses[f.original_name] = { size: f.file_size, kind: 'on', on };
      }
    }
    // Cable towers and ABL wings on the side's rear pair; sensor mounts on their wing (or on
    // the side, or on a skirt for the Beacon3D under it)
    for (const o of s.cables) for (const f of mine(o)) {
      const p = fitPair(get(f), sideTarget(sideOf(o.label)), (x) => -x.box.mx[2]);
      note('cable', Boolean(p));
      if (p) save(f, 'side', p);
    }
    const placedWings = [];
    for (const o of s.ablWings) {
      const side = sideOf(o.label);
      for (const f of mine(o)) {
        const p = fitPair(get(f), sideTarget(side), (x) => -Math.abs(x.c[0] - mp.center[0]) + 0.2 * x.c[2]);
        note('abl wing', Boolean(p));
        if (p) save(f, 'side', p);
      }
      for (const f of placed(o)) placedWings.push({ o, f, part: get(f), p: poses[f.original_name], side });
    }
    const placedSkirts = Object.entries(poses).filter(([k, v]) => v.kind === 'skirt' && own.has(k)).map(([k, v]) => ({ name: k, part: get({ original_name: k }), p: v }));
    for (const o of s.ablMounts) for (const f of o.files.filter(x => own.has(x.original_name) && !poses[x.original_name])) {
      const part = get(f);
      const side = o.side || null;
      const direct = side ? fitPair(part, sideTarget(side), (x) => -Math.abs(x.c[0] - mp.center[0])) : null;
      if (direct) { save(f, 'side', direct); note('abl mount', true); continue; }
      const on = {};
      for (const w of placedWings.filter(x => !side || x.side === side)) {
        const p = fitOn(part, asParent(w.part, w.p), (x) => x.c[2]);
        if (p) on[w.f.original_name] = { R: p.R, t: p.t, box: p.box };
      }
      if (!Object.keys(on).length && /beacon/i.test(o.label)) {
        for (const sk of placedSkirts) {
          const p = fitOn(part, asParent(sk.part, sk.p), (x) => x.c[2] - x.c[1]);
          if (p) on[sk.name] = { R: p.R, t: p.t, box: p.box };
        }
      }
      note('abl mount', Object.keys(on).length > 0);
      if (Object.keys(on).length) poses[f.original_name] = { size: f.file_size, kind: 'on', on };
    }
    // Ducts
    for (const d of s.ducts) {
      const list = d.kind === 'side' ? Object.entries(d.sides).map(([side, f]) => [f, side]) : d.files.map(f => [f, null]);
      const todo = list.filter(([f]) => own.has(f.original_name) && !poses[f.original_name] && !reuse(f));
      // A duct with its fan in front, under the hotend's front ("Centered"): its slots and
      // ring say too little to place it; the printhead draws its own shape for it
      if (/centered/i.test(d.label)) { todo.forEach(() => note('duct centered', false)); continue; }
      const fits = todo.map(([f, side]) => [f, side, fitDuct(abs(f), mp, side, tipZ)]);
      // A left / right pair placed unlike each other: one of them again, like the other (the
      // pair with the better scores wins)
      if (fits.length === 2 && fits[0][2] && fits[1][2] && boxGap(mirrorBox(fits[0][2].box, mp), fits[1][2].box) > 8) {
        const [[fa, sa, a], [fb, sb, b]] = fits;
        const a2 = fitDuct(abs(fa), mp, sa, tipZ, mirrorBox(b.box, mp));
        const b2 = fitDuct(abs(fb), mp, sb, tipZ, mirrorBox(a.box, mp));
        if (a2.score + b.score < a.score + b2.score) fits[0][2] = a2;
        else fits[1][2] = b2;
      }
      for (const [f, , p] of fits) {
        note(`duct ${d.kind}`, Boolean(p && p.slot));
        if (p) save(f, 'duct', p, { side: p.side, low: p.low, slot: p.slot });
      }
    }
    // ADXL345 mounts under the skirt (every skirt has a 14 mm pair of inserts for them; the
    // "Spacer for Skirt Mount" options go between) or under a duct made for one ("6Deg-ADXL"):
    // a place per parent (the duct first: when it is chosen, the mount goes on it), by the
    // mount's pair of M3 holes, in front and low but never below the nozzle
    const adxlParents = [];
    for (const d of s.ducts.filter(x => /adxl/i.test(x.label))) {
      for (const f of d.files.filter(x => poses[x.original_name] && own.has(x.original_name))) {
        const pre = rotationTo(wallNormal(readStl(abs(f))), [1, 0, 0]);
        const v = poses[f.original_name];
        adxlParents.push({ name: f.original_name, part: get(f, pre), p: { R: matmul(v.R, transpose(pre)), t: v.t } });
      }
    }
    adxlParents.push(...placedSkirts);
    const nozzleZ = tipZ !== null ? tipZ - 1.6 : -Infinity;
    for (const o of s.adxls) for (const f of o.files.filter(x => own.has(x.original_name) && !poses[x.original_name])) {
      const whole = get(f);
      const part = { ...whole, f: { ...whole.f, holes: whole.f.holes.filter(h => h.r < 1.9) } };
      const on = {};
      for (const par of adxlParents) {
        const p = fitOn(part, asParent(par.part, par.p), (x) => x.c[1] + x.c[2] + Math.max(0, nozzleZ + 3 - x.box.mn[2]) * 20, true);
        if (p) on[par.name] = { R: p.R, t: p.t, box: p.box };
      }
      note('adxl', Object.keys(on).length > 0);
      if (!Object.keys(on).length) continue;
      // The board: on the open ends of its holes (the mount's other pair, inserts first), in
      // the mount's own frame
      const hs = whole.f.holes;
      let pair = null;
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        if (hs[i].a !== hs[j].a) continue;
        const d = norm(sub(hs[i].p, hs[j].p));
        if (Math.abs(d - 14) < 0.6 && hs[i].r < 1.9) continue;
        const score = (hs[i].r >= 1.9 ? 100 : 0) + d;
        if (!pair || score > pair.score) pair = { score, both: [hs[i], hs[j]] };
      }
      let board = null;
      if (pair) {
        const { both } = pair;
        const a = both[0].a;
        const mid = scale(both.reduce((sum, h) => add(sum, h.p), [0, 0, 0]), 1 / both.length);
        const high = whole.b.mx[a] - Math.max(...both.map(h => h.to)) < Math.min(...both.map(h => h.from)) - whole.b.mn[a];
        mid[a] = high ? whole.b.mx[a] : whole.b.mn[a];
        board = { p: mid, n: scale(AXES[a], high ? 1 : -1) };
      }
      poses[f.original_name] = { size: f.file_size, kind: 'on', on, board };
    }
    console.log(`${r.id}: ${Object.keys(poses).length} placed so far (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }

  // Into the printhead's frame: x right, y up, z to the front; the hotend's axis at x = z = 0;
  // the reference duct's tip 1.6 mm above the bed
  const refDuct = Object.entries(poses).find(([k, v]) => v.kind === 'duct' && /Release V4\/.*Standard Single 5015 Left Duct/.test(k));
  const bedZ = refDuct ? refDuct[1].low[2] - 1.6 : mp.bottomFace * -1 - 14;
  const A = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const shift = [-mp.axis[0], -bedZ, mp.axis[1]];
  const toFrame = (pose, stackPart) => {
    const R = matmul(A, pose.R);
    const lift = stackPart ? [0, bedZ, 0] : [0, 0, 0];
    const t = add(add(apply(A, pose.t), shift), lift);
    const out = { m: R.flat().map(v => +v.toFixed(6)), t: t.map(v => +v.toFixed(3)) };
    if (pose.box) {
      const corners = [];
      for (const x of [pose.box.mn[0], pose.box.mx[0]]) for (const y of [pose.box.mn[1], pose.box.mx[1]]) for (const z of [pose.box.mn[2], pose.box.mx[2]]) corners.push(add(add(apply(A, [x, y, z]), shift), lift));
      out.box = [0, 1, 2].map(k => +Math.min(...corners.map(c => c[k])).toFixed(1)).concat([0, 1, 2].map(k => +Math.max(...corners.map(c => c[k])).toFixed(1)));
    }
    return out;
  };
  const baseBox = toFrame({ R: IDENTITY, t: [0, 0, 0], box: refBase.b }).box;
  const out = { version: 1, base: { box: baseBox, top: +(mp.topFace - bedZ).toFixed(2), bottom: +(-mp.bottomFace - bedZ).toFixed(2) }, frame: 'x right, y up, z front; the hotend axis at x = z = 0, the bed at y = 0 (the 7.4 standard duct tips 1.6 mm above it)', parts: {} };
  for (const [name, p] of Object.entries(poses)) {
    const e = { size: p.size, kind: p.kind };
    if (p.on) {
      e.on = {};
      for (const [parent, q] of Object.entries(p.on)) e.on[parent] = toFrame(q);
    } else Object.assign(e, toFrame(p, p.kind === 'stack'));
    if (p.top !== undefined) e.top = +(p.top - bedZ).toFixed(3);
    if (p.height !== undefined) e.height = +p.height.toFixed(3);
    if (p.side) e.side = p.side;
    if (p.low) e.tip = +(p.low[2] - bedZ).toFixed(3);
    if (p.board) e.board = { p: p.board.p.map(v => +v.toFixed(2)), n: p.board.n };
    if (p.motor) e.motor = { p: add(add(apply(A, p.motor.p), shift), [0, bedZ, 0]).map(v => +v.toFixed(2)), n: apply(A, p.motor.n).map(v => Math.round(v)) };
    out.parts[name] = e;
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('\nplaced / not placed:');
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(14)} ${String(v.ok).padStart(4)} / ${v.no}`);
  console.log(`\n${Object.keys(out.parts).length} files -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

main();
