/* ─── USSA VAULT kit: the tower in 3D ──────────────────────────────────────
 * A model of a configuration (VaultKit config) built from simple shapes in real sizes
 * (millimetres, measured on the archive's STLs): hollow modules, drawer boxes with their facades,
 * sustainers with lids and locks, interiors, roofs, base, wheels or casters, backbone, pegboards,
 * handles and wall mounts. The archive's own STLs are far too heavy to assemble in a browser
 * (a tower is gigabytes).
 *
 * Drawers slide out and sustainer lids open (click them); everything above an open sustainer
 * rises so its lid can swing, as when the stack is taken apart.
 *
 * build(cfg) makes a THREE.Group (no DOM, the tests run it in Node); targets() says where the
 * moving parts go; mount() puts it in a container with orbit controls and returns a handle the
 * configurator updates and disposes. The scene renders on demand (camera moves, hover, opening
 * animations, updates), never in a loop.
 */
globalThis.VaultKit3D = (function () {
  const MM = { S: 165, M: 254, L: 330, XL: 419 };
  const F = { '1F': 1, '2F': 2, '4F': 4 };
  const P = 48; // mm per F
  const WALL = 4; // module walls
  const GRID = 42; // Gridfinity unit
  // Light grey PLA with orange latches and dark boxes, like the renders in the manual
  const COLORS = {
    module: 0xd9dce1, facade: 0xf2f3f5, sustainer: 0xe7e9ec, dark: 0x2d3036, orange: 0xf06a24, roof: 0xcfd3d9,
    base: 0xc5cad1, tyre: 0x26282d, disk: 0xb4bac3, wood: 0xa8774a, wall: 0xdfe2e6, peg: 0xe9ebee, highlight: 0x9fdcf2,
    box: 0x3a3d44, bin: 0xf58a4d, divider: 0x5a5e66, inner: 0xc9cdd3
  };

  // A box with rounded front corners and softly bevelled edges, centred on the origin
  function roundedBox(w, h, d, r) {
    const b = Math.min(1.5, w / 6, h / 6, d / 6);
    const sw = w - 2 * b;
    const sh = h - 2 * b;
    const rr = Math.max(0, Math.min(r, sw / 2 - 0.01, sh / 2 - 0.01));
    const s = new THREE.Shape();
    const x = -sw / 2;
    const y = -sh / 2;
    s.moveTo(x + rr, y);
    s.lineTo(x + sw - rr, y);
    s.quadraticCurveTo(x + sw, y, x + sw, y + rr);
    s.lineTo(x + sw, y + sh - rr);
    s.quadraticCurveTo(x + sw, y + sh, x + sw - rr, y + sh);
    s.lineTo(x + rr, y + sh);
    s.quadraticCurveTo(x, y + sh, x, y + sh - rr);
    s.lineTo(x, y + rr);
    s.quadraticCurveTo(x, y, x + rr, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.1, d - 2 * b), bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 1, curveSegments: 3 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    return g;
  }

  function build(cfg) {
    const materials = new Map();
    const mat = (name) => {
      if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({ color: COLORS[name], roughness: name === 'tyre' ? 0.9 : 0.72, metalness: 0.04 }));
      return materials.get(name);
    };
    const group = new THREE.Group();
    const floorGroups = [];
    const floorMeshes = [];
    const openables = [];
    // The roof and the handles rise with the floors when a sustainer below is opened
    const topGroup = new THREE.Group();
    group.add(topGroup);
    const floorGroup = (fi) => {
      if (!floorGroups[fi]) { floorGroups[fi] = new THREE.Group(); group.add(floorGroups[fi]); }
      return floorGroups[fi];
    };
    // o: { fi (floor, for hover and highlight), kind ('module' is highlighted), parent, openId }
    const place = (geometry, color, x, y, z, o = {}) => {
      const mesh = new THREE.Mesh(geometry, mat(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (o.fi !== undefined) {
        mesh.userData.fi = o.fi;
        mesh.userData.kind = o.kind || '';
        (floorMeshes[o.fi] = floorMeshes[o.fi] || []).push(mesh);
      }
      if (o.openId) mesh.userData.openId = o.openId;
      (o.parent || (o.fi !== undefined ? floorGroup(o.fi) : group)).add(mesh);
      return mesh;
    };
    const box = (w, h, d, color, x, y, z, r = 0, o) => place(r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, h), Math.max(0.1, d)), color, x, y, z, o);
    // A cylinder along the x axis (wheels), the z axis (keys) or upright (rods)
    const cylinder = (radius, length, color, x, y, z, axis, o) => {
      const g = new THREE.CylinderGeometry(radius, radius, length, 28);
      if (axis === 'x') g.rotateZ(Math.PI / 2);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      return place(g, color, x, y, z, o);
    };

    const W = MM[cfg.width] || 330;
    const D = 146 + 42 * (Number(cfg.depth) - 3);
    const front = D / 2;
    const back = -D / 2;
    const mods = cfg.mods || {};
    const floors = cfg.floors || [];
    const layouts = (globalThis.VaultKit && VaultKit.LAYOUTS[cfg.width]) || [];
    const layoutOf = (f) => layouts.find(l => l.id === f.layout) || layouts[0];
    const hasBase = mods.base && mods.base !== 'none';
    const hasBackbone = mods.backbone && mods.backbone !== 'none';
    const lift = mods.base === 'wheels' ? 40 : mods.base === 'casters' ? 46 : (hasBase && mods.feet ? 24 : 0);
    const baseH = hasBase ? 34 : 0;

    // Gridfinity: a baseplate with its grid and a few bins on it (x, z: centre; w, d: inner size)
    const gridfinity = (x, floorY, z, w, d, binH, o) => {
      box(w, 3, d, 'orange', x, floorY + 1.5, z, 0, o);
      const nx = Math.max(1, Math.floor(w / GRID));
      const nz = Math.max(1, Math.floor(d / GRID));
      const x0 = x - (nx * GRID) / 2;
      const z0 = z - (nz * GRID) / 2;
      for (let i = 0; i <= nx; i++) box(2, 3, nz * GRID, 'bin', x0 + i * GRID, floorY + 4.5, z, 0, o);
      for (let k = 0; k <= nz; k++) box(nx * GRID, 3, 2, 'bin', x, floorY + 4.5, z0 + k * GRID, 0, o);
      // Bins: a 1×1 at the front left, a 2×1 behind it, a 1×2 on the right, where they fit
      const bin = (ix, iz, sx, sz) => {
        if (ix + sx > nx || iz + sz > nz) return;
        box(sx * GRID - 4, binH, sz * GRID - 4, 'bin', x0 + (ix + sx / 2) * GRID, floorY + 6 + binH / 2, z0 + (iz + sz / 2) * GRID, 3, o);
      };
      bin(0, nz - 1, 1, 1);
      bin(0, nz - 3, 2, 1);
      bin(nx - 1, 0, 1, 2);
    };
    // Divider walls: one across (along the width) and one along the depth, or a grid of them
    const dividers = (x, floorY, z, w, d, h, across, along, o) => {
      for (let i = 1; i <= along; i++) box(3, h, d, 'divider', x - w / 2 + (w * i) / (along + 1), floorY + h / 2, z, 0, o);
      for (let k = 1; k <= across; k++) box(w, h, 3, 'divider', x, floorY + h / 2, z - d / 2 + (d * k) / (across + 1), 0, o);
    };

    // Base, wheels or casters, feet
    if (hasBase) box(W, baseH, D, 'base', 0, lift + baseH / 2, 0, 5);
    if (mods.base === 'wheels') {
      for (const side of [-1, 1]) {
        const x = side * (W / 2 + 19);
        cylinder(71, 30, 'tyre', x, 71, back + 60, 'x');
        cylinder(52, 34, 'disk', x, 71, back + 60, 'x');
        cylinder(16, 48, 'dark', x - side * 8, 71, back + 60, 'x');
      }
    }
    if (mods.base === 'casters') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - 24);
        const z = sz * (D / 2 - 24);
        box(10, lift - 22, 10, 'dark', x, 22 + (lift - 22) / 2, z);
        cylinder(14, 12, 'tyre', x, 14, z, 'x');
      }
    }
    if (hasBase && mods.feet && lift) box(W * 0.5, lift, 70, 'dark', 0, lift / 2, front - 44, 4);

    // The floors, bottom to top: hollow modules, open at the front for drawers
    let y = lift + baseH;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      const layout = layoutOf(floor);
      if (!layout) return;
      const slots = VaultKit.slotsOf(layout);
      const fo = { fi };
      const shell = { fi, kind: 'module' };
      let mx = -W / 2;
      layout.modules.forEach((mod, mi) => {
        const mw = MM[mod.w];
        const first = slots.findIndex(s => s.mi === mi);
        const sustainer = !mod.cols && (floor.slots[first] || {}).type === 'sustainer';
        const x0 = mx + 1.5;
        const w = mw - 3;
        box(w, WALL, D, 'module', x0 + w / 2, y + WALL / 2, 0, 1, shell);
        if (!sustainer) box(w, WALL, D, 'module', x0 + w / 2, y + h - WALL / 2, 0, 1, shell);
        box(WALL, h, D, 'module', x0 + WALL / 2, y + h / 2, 0, 1, shell);
        box(WALL, h, D, 'module', x0 + w - WALL / 2, y + h / 2, 0, 1, shell);
        box(w, h, WALL, 'module', x0 + w / 2, y + h / 2, back + WALL / 2, 1, shell);
        // Orange latch marks on the outer sides, one per F near the front
        for (let k = 0; k < (F[floor.height] || 1); k++) {
          if (mi === 0) box(2, 6, 20, 'orange', mx - 0.5, y + 24 + k * P, front - 34, 0, fo);
          if (mi === layout.modules.length - 1) box(2, 6, 20, 'orange', mx + mw - 2.5, y + 24 + k * P, front - 34, 0, fo);
        }
        let cx = mx;
        slots.forEach((s, si) => {
          if (s.mi !== mi) return;
          const cw = MM[s.w];
          const slot = floor.slots[si] || {};
          if (cx > mx) box(WALL, h - 2 * WALL, D - WALL, 'module', cx, y + h / 2, WALL / 2, 0, shell); // the middle wall of L² / XL²
          if (slot.type === 'sustainer') {
            // The facade is the front wall; the lid turns on hinges at the back
            const id = `${fi}:${si}`;
            const so = { fi, openId: id };
            box(cw - 3, h - 2, 8, 'sustainer', cx + cw / 2, y + h / 2, front + 4, 4, { ...so, kind: 'facade' }); // facades are as big as the module (S1F: 164.8 × 47 mm)
            for (const at of [0.22, 0.78]) box(26, 16, 14, 'dark', cx + cw * at, y + h - 15, front + 9, 3, so);
            box(34, 10, 2, 'roof', cx + cw / 2, y + h - 15, front + 8.5, 2, so); // label slot between the locks
            const inner = { x: cx + cw / 2, floorY: y + WALL, z: WALL / 2, w: cw - 2 * WALL - 6, d: D - WALL - 10 };
            if (slot.interior === 'gridfinity') gridfinity(inner.x, inner.floorY, inner.z, inner.w, inner.d, Math.min(h - 20, 40), so);
            if (slot.interior === 'dividers') dividers(inner.x, inner.floorY, inner.z, inner.w, inner.d, h - 16, 2, 1, so);
            if (slot.interior === 'sealed') dividers(inner.x, inner.floorY, inner.z, inner.w, inner.d, h - 12, 1, 1, so);
            const lid = new THREE.Group();
            lid.position.set(cx + cw / 2, y + h, back);
            floorGroup(fi).add(lid);
            box(cw - 4, 6, D, 'roof', 0, -3, D / 2, 3, { ...so, parent: lid });
            openables.push({ id, kind: 'sustainer', fi, node: lid, angle: -1.9 });
          } else {
            // Every box slides out with its facade, key, label and interior
            let top = y + h;
            String(slot.boxes || floor.height).split('+').forEach((bh, bi) => {
              const bH = (F[bh] || 1) * P;
              const id = `${fi}:${si}:${bi}`;
              const node = new THREE.Group();
              floorGroup(fi).add(node);
              const bo = { fi, openId: id, parent: node };
              // Measured on the facade STLs: the key in the middle of the top 1F band, the label
              // slot at the right edge (the label slides in from the side), the cap hole on the left
              const ky = top - P / 2;
              box(cw - 3, bH - 2, 8, 'facade', cx + cw / 2, top - bH / 2, front + 4, 4, { ...bo, kind: 'facade' });
              cylinder(11, 8, 'dark', cx + cw / 2, ky, front + 11, 'z', bo);
              box(6, 18, 8, 'dark', cx + cw / 2, ky, front + 18, 2, bo);
              box(Math.min(40, cw * 0.22), 10, 2, 'roof', cx + cw - 8 - Math.min(20, cw * 0.11), ky, front + 8.5, 2, bo);
              cylinder(4, 3, 'roof', cx + Math.min(26, cw * 0.15), ky, front + 9, 'z', bo);
              // The box: a dark tray behind the facade
              const bw = cw - 26;
              const bx = cx + cw / 2;
              const floorY = top - bH + 5;
              const wallH = bH - 12;
              const bd = D - 12;
              box(bw, 3, bd, 'box', bx, floorY + 1.5, 0, 0, bo);
              box(3, wallH, bd, 'box', bx - bw / 2 + 1.5, floorY + wallH / 2, 0, 0, bo);
              box(3, wallH, bd, 'box', bx + bw / 2 - 1.5, floorY + wallH / 2, 0, 0, bo);
              box(bw, wallH, 3, 'box', bx, floorY + wallH / 2, back + 7.5, 0, bo);
              if (slot.interior === 'gridfinity') gridfinity(bx, floorY + 3, -2, bw - 8, bd - 10, Math.max(12, wallH - 14), bo);
              if (slot.interior === 'dividers') dividers(bx, floorY + 3, -2, bw - 8, bd - 10, slot.low ? 20 : wallH - 4, 1, 1, bo);
              openables.push({ id, kind: 'drawer', fi, node, out: D * 0.72 });
              top -= bH;
            });
          }
          cx += cw;
        });
        mx += mw;
      });
      y += h;
    });
    const topY = y;
    const tp = { parent: topGroup };

    // The roof on the drawer modules of the top floor (sustainers have their own lids); the cut
    // heavyweight roof is drawn like the full one
    const top = floors[floors.length - 1];
    const kind = cfg.roof && cfg.roof !== 'none' ? (cfg.roof === 'heavycut' ? 'heavy' : cfg.roof) : null;
    let roofTop = topY;
    if (kind && top) {
      const layout = layoutOf(top);
      const slots = VaultKit.slotsOf(layout);
      let mx = -W / 2;
      layout.modules.forEach((mod, mi) => {
        const mw = MM[mod.w];
        const cx = mx + mw / 2;
        const first = slots.findIndex(s => s.mi === mi);
        if (mod.cols || (top.slots[first] || {}).type !== 'sustainer') {
          if (kind === 'grid') {
            box(mw - 4, 10, D - 4, 'roof', cx, topY + 5, 0, 4, tp);
            for (let gx = mx + GRID; gx < mx + mw - 10; gx += GRID) box(2, 3, D - 12, 'module', gx, topY + 11.5, 0, 0, tp);
            for (let gz = back + GRID; gz < front - 10; gz += GRID) box(mw - 12, 3, 2, 'module', cx, topY + 11.5, gz, 0, tp);
            box(Math.min(120, mw * 0.6), 26, 34, 'dark', cx, topY + 10 + 13, 0, 10, tp);
            roofTop = Math.max(roofTop, topY + 36);
          }
          if (kind === 'table') { box(mw + 4, 8, D + 4, 'roof', cx, topY + 4, 0, 4, tp); roofTop = Math.max(roofTop, topY + 8); }
          if (kind === 'bowl') {
            box(mw - 4, 6, D - 4, 'roof', cx, topY + 3, 0, 4, tp);
            box(mw - 4, 18, 5, 'roof', cx, topY + 15, front - 4.5, 0, tp); box(mw - 4, 18, 5, 'roof', cx, topY + 15, back + 4.5, 0, tp);
            box(5, 18, D - 14, 'roof', mx + 4.5, topY + 15, 0, 0, tp); box(5, 18, D - 14, 'roof', mx + mw - 4.5, topY + 15, 0, 0, tp);
            roofTop = Math.max(roofTop, topY + 24);
          }
          if (kind === 'heavy') {
            box(mw - 4, 8, D - 4, 'roof', cx, topY + 4, 0, 4, tp);
            for (const side of [-1, 1]) box(mw * 0.3, 54, D - 12, 'roof', cx + side * (mw * 0.35 - 4), topY + 8 + 27, 0, 6, tp);
            cylinder(9, mw * 0.4, 'dark', cx, topY + 44, 0, 'x', tp);
            roofTop = Math.max(roofTop, topY + 62);
          }
          if (kind === 'undertable') { box(mw + 20, 8, D + 20, 'roof', cx, topY + 4, 0, 3, tp); roofTop = Math.max(roofTop, topY + 8); }
        }
        mx += mw;
      });
      if (kind === 'undertable') { box(W + 260, 22, D + 240, 'wood', 0, topY + 8 + 11, -20, 4, tp); roofTop = topY + 30; }
    }

    // Along the back: backbone boards (two per 4F floor), pegboards, wall mounts, handles
    let by = lift + baseH;
    let backZ = back;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      const fo = { fi };
      if (hasBackbone) {
        let uy = by;
        for (const uh of floor.height === '4F' ? [h / 2, h / 2] : [h]) {
          if (mods.backbone === 'universal') for (const side of [-1, 1]) box(70, uh - 4, 14, 'dark', side * (W / 2 - 37), uy + uh / 2, back - 7, 3, fo);
          else box(W - 6, uh - 4, 14, 'dark', 0, uy + uh / 2, back - 7, 3, fo);
          uy += uh;
        }
        if (mods.pegboard && mods.pegboard !== 'none') {
          box(W - 24, h - 12, 6, 'peg', 0, by + h / 2, back - 17, 2, fo);
          for (let k = 1; k < (F[floor.height] || 1) * 2; k++) box(W - 60, 3, 2, 'dark', 0, by + k * (P / 2), back - 20.5, 0, fo);
        }
      }
      if (mods.wallMount) {
        const z = back - (hasBackbone ? 14 : 0) - 5;
        let mx = -W / 2;
        layoutOf(floor).modules.forEach(mod => { box(MM[mod.w] - 8, h - 6, 10, 'base', mx + MM[mod.w] / 2, by + h / 2, z, 3, fo); mx += MM[mod.w]; });
      }
      by += h;
    });
    if (hasBackbone) backZ = back - 14 - (mods.pegboard && mods.pegboard !== 'none' ? 6 : 0);
    if (mods.wallMount) {
      const wallZ = back - (hasBackbone ? 14 : 0) - 10 - 6;
      box(W + 500, Math.max(roofTop, topY) + 300, 12, 'wall', 0, (Math.max(roofTop, topY) + 300) / 2, wallZ);
    }
    if (hasBackbone && top && mods.pullHandle) {
      const rodTop = Math.max(roofTop, topY) + 150;
      for (const side of [-1, 1]) cylinder(8, rodTop - (lift + baseH), 'disk', side * (W / 2 - 42), (rodTop + lift + baseH) / 2, backZ - 14, null, tp);
      box(W - 40, 22, 30, 'dark', 0, rodTop + 11, backZ - 14, 8, tp);
    }
    if (hasBackbone && top && mods.stationaryHandle) {
      const th = (F[top.height] || 1) * P;
      const hy = topY - th / 2;
      box(W * 0.5, 18, 18, 'dark', 0, hy, backZ - 44, 6, tp);
      for (const side of [-1, 1]) box(18, 18, 40, 'dark', side * (W * 0.25 - 9), hy, backZ - 22, 4, tp);
    }

    const size = { width: W, depth: D, height: Math.max(roofTop, topY) };
    return { group, topGroup, floorGroups, floorMeshes, openables, materials, size };
  }

  // Where the moving parts go when the parts in `open` (ids) are open: drawers slide out,
  // sustainer lids turn up, and every floor above an open sustainer (and the roof) rises by
  // about the depth so the lid can swing. Returns { floors: [dy], top: dy, parts: [{ o, value }] }.
  function targets(model, open) {
    const rise = model.size.depth + 40;
    const sustainers = new Set(model.openables.filter(o => o.kind === 'sustainer' && open.has(o.id)).map(o => o.fi));
    const floors = [];
    let up = 0;
    for (let fi = 0; fi < model.floorGroups.length; fi++) {
      floors.push(up);
      if (sustainers.has(fi)) up += rise;
    }
    const parts = model.openables.map(o => ({ o, value: open.has(o.id) ? (o.kind === 'drawer' ? o.out : o.angle) : 0 }));
    return { floors, top: up, parts };
  }

  function disposeGroup(model) {
    if (!model) return;
    model.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    for (const m of model.materials.values()) m.dispose();
  }

  // opts: { background (number), onHover(fi | null), onClick(fi), onOpen(count, total) }.
  // Returns null without WebGL.
  function mount(container, cfg, opts = {}) {
    if (typeof THREE === 'undefined' || !THREE.OrbitControls) return null;
    let renderer;
    try {
      // Transparent where the scene has no background: the cover of a configuration
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      return null;
    }
    const width = () => Math.max(1, container.clientWidth);
    const height = () => Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width(), height());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.background !== undefined ? opts.background : 0x161625);
    const camera = new THREE.PerspectiveCamera(32, width() / height(), 5, 30000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a909c, 0.78));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28);
    scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI * 0.495;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    let model = null;
    let fitted = null;
    let hovered = null;
    const open = new Set();
    const highlightMat = new THREE.MeshStandardMaterial({ color: COLORS.highlight, roughness: 0.6, metalness: 0.04 });

    // Camera from the front right, a little above, like the manual's renders
    function fit(size) {
      const center = new THREE.Vector3(0, size.height / 2, 0);
      const radius = Math.sqrt(size.width * size.width + size.height * size.height + size.depth * size.depth) / 2;
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
      const dir = new THREE.Vector3(0.62, 0.42, 1).normalize();
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.near = dist / 50;
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = radius * 0.4;
      controls.maxDistance = dist * 4;
      controls.update();
    }

    // Where the camera goes for a tower this tall, looking from where it looks now
    function pose(totalHeight) {
      const s = model.size;
      const center = new THREE.Vector3(0, totalHeight / 2, 0);
      const radius = Math.sqrt(s.width * s.width + totalHeight * totalHeight + s.depth * s.depth) / 2;
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
      const dir = camera.position.clone().sub(controls.target).normalize();
      return { target: center, position: center.clone().addScaledVector(dir, dist) };
    }

    // The moving parts follow targets(): at once, or eased over about a third of a second.
    // When the tower grows or shrinks (sustainers opened), the camera keeps it in view.
    let anim = 0;
    let shownHeight = 0;
    function applyOpen(instant) {
      if (!model) return;
      const t = targets(model, open);
      const moves = [];
      const height = model.size.height + t.top;
      if (!instant && shownHeight && Math.abs(height - shownHeight) > 1) {
        const to = pose(height);
        const cam = camera.position.clone();
        const tgt = controls.target.clone();
        moves.push({ get: () => 0, set: k => { camera.position.lerpVectors(cam, to.position, k); controls.target.lerpVectors(tgt, to.target, k); camera.lookAt(controls.target); }, to: 1 });
        controls.maxDistance = Math.max(controls.maxDistance, to.position.distanceTo(to.target) * 4);
      }
      shownHeight = height;
      model.floorGroups.forEach((g, fi) => { if (g) moves.push({ get: () => g.position.y, set: v => { g.position.y = v; }, to: t.floors[fi] }); });
      moves.push({ get: () => model.topGroup.position.y, set: v => { model.topGroup.position.y = v; }, to: t.top });
      for (const { o, value } of t.parts) {
        if (o.kind === 'drawer') moves.push({ get: () => o.node.position.z, set: v => { o.node.position.z = v; }, to: value });
        else moves.push({ get: () => o.node.rotation.x, set: v => { o.node.rotation.x = v; }, to: value });
      }
      if (anim) cancelAnimationFrame(anim);
      anim = 0;
      if (instant) { moves.forEach(m => m.set(m.to)); render(); return; }
      const done = () => { controls.update(); render(); };
      const from = moves.map(m => m.get());
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / 340);
        const e = 1 - Math.pow(1 - k, 3);
        moves.forEach((m, i) => m.set(from[i] + (m.to - from[i]) * e));
        render();
        anim = k < 1 ? requestAnimationFrame(step) : 0;
        if (!anim) done();
      };
      anim = requestAnimationFrame(step);
      if (opts.onOpen) opts.onOpen(open.size, model.openables.length);
    }

    function update(next) {
      if (model) { scene.remove(model.group); disposeGroup(model); }
      model = build(next);
      scene.add(model.group);
      model.group.traverse(m => { if (m.isMesh) m.userData.baseMaterial = m.material; });
      // Parts that no longer exist are forgotten; the others stay open
      const ids = new Set(model.openables.map(o => o.id));
      for (const id of [...open]) if (!ids.has(id)) open.delete(id);
      const s = model.size;
      // Lights and the ground follow the tower; the camera only when its size changed a lot
      const span = Math.max(s.width, s.depth, s.height);
      sun.position.set(span * 0.9, span * 2.2, span * 1.6);
      sun.target.position.set(0, s.height / 3, 0);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -span * 1.4;
      sc.right = sc.top = span * 1.4;
      sc.near = span * 0.2;
      sc.far = span * 7;
      sc.updateProjectionMatrix();
      fill.position.set(-span * 1.5, span * 0.8, span * 0.6);
      ground.scale.set(span * 6, span * 6, 1);
      const changed = !fitted || Math.abs(s.height - fitted.height) > fitted.height * 0.25 || s.width !== fitted.width || s.depth !== fitted.depth;
      if (changed) { fit(s); fitted = s; }
      hovered = null;
      applyOpen(true);
      if (opts.onOpen) opts.onOpen(open.size, model.openables.length);
    }

    function highlight(fi) {
      if (!model) return;
      model.floorMeshes.forEach((meshes, i) => (meshes || []).forEach(m => {
        if (m.userData.kind !== 'module') return;
        m.material = i === fi ? highlightMat : m.userData.baseMaterial || m.material;
      }));
      render();
    }

    function toggle(id) {
      if (open.has(id)) open.delete(id);
      else open.add(id);
      applyOpen(false);
    }

    // Hover and click (a click is a press without a drag): a drawer or a sustainer opens or
    // closes, another part of a floor brings the floor up in the builder
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = model && raycaster.intersectObject(model.group, true).find(h => h.object.userData.fi !== undefined);
      return hit ? hit.object.userData : null;
    };
    let frame = 0;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const hit = pick(e);
        const fi = hit ? hit.fi : null;
        renderer.domElement.style.cursor = hit && hit.openId ? 'pointer' : '';
        if (fi === hovered) return;
        hovered = fi;
        if (opts.onHover) opts.onHover(fi);
      });
    };
    const onLeave = () => { if (hovered !== null && opts.onHover) opts.onHover(null); hovered = null; };
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const hit = pick(e);
      if (!hit) return;
      if (hit.openId) toggle(hit.openId);
      else if (opts.onClick) opts.onClick(hit.fi);
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      renderer.setSize(width(), height());
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      render();
    }) : null;
    if (resizeObserver) resizeObserver.observe(container);

    update(cfg);

    return {
      container,
      canvas: renderer.domElement,
      update,
      highlight,
      toggle,
      // Open everything, or close everything when all is open
      toggleAll() {
        if (!model) return;
        const all = model.openables.length && model.openables.every(o => open.has(o.id));
        open.clear();
        if (!all) model.openables.forEach(o => open.add(o.id));
        applyOpen(false);
      },
      openCount: () => open.size,
      // For Viewer.takeSnapshot (a cover)
      snapshotParts: () => ({ renderer, scene, camera }),
      setBackground(color) { scene.background.set(color); render(); },
      // Back to the first view of the tower
      reset() {
        if (!model) return;
        fit(model.size);
        fitted = model.size;
        // A tower with open sustainers is taller: keep it all in view
        const to = pose(model.size.height + targets(model, open).top);
        camera.position.copy(to.position);
        controls.target.copy(to.target);
        controls.update();
        render();
      },
      dispose() {
        if (frame) cancelAnimationFrame(frame);
        if (anim) cancelAnimationFrame(anim);
        if (resizeObserver) resizeObserver.disconnect();
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointerup', onUp);
        controls.dispose();
        disposeGroup(model);
        highlightMat.dispose();
        ground.geometry.dispose();
        ground.material.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        model = null;
      }
    };
  }

  return { build, targets, mount, COLORS };
})();
