/* ─── USSA VAULT kit: the tower in 3D ──────────────────────────────────────
 * A model of a configuration (VaultKit config) built from simple shapes in real sizes
 * (millimetres, measured on the archive's STLs): hollow modules, drawer boxes with their facades
 * and runners, sustainers with lids, hinges and locks, interiors (as many dividers as the parts
 * list has), roofs, base, wheels or casters, backbone, pegboards, handles and wall mounts. The
 * archive's own STLs are far too heavy to assemble in a browser (a tower is gigabytes).
 *
 * Drawers slide out and sustainer lids open (click them); everything above an open sustainer
 * rises so its lid can swing, as when the stack is taken apart.
 *
 * Every mesh that stands for a file of the parts list carries that row's key, or the start of
 * it (userData.bom, tagMatches): a row of the list lights its parts in the tower, the rest of
 * the tower turns see-through so parts inside show; a part under the pointer names its rows.
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
  const LID = 14; // a sustainer lid: a tray on top of the module walls
  const GRID = 42; // Gridfinity unit
  // Sustainer depth dividers stand this far either side of the middle (the slots of the width
  // dividers); built-in walls of the XL sealed module (STL)
  const DEPTH_DIVIDERS = { L: 41, XL: 85.5 };
  const XL_SEAL_WALLS = 62.5;
  const RAILS = { S: 121, M: 166, L: 203, XL: 248 }; // geared rail length by box width
  // Covers rendered before this (ms; commit 9a55f30, 2026-11-24) show the old tower, lighter and
  // without edges: App.kitCoverOutdated renders them again
  const COVER_LOOK = 1795559504000;
  // Light grey PLA with orange latches and dark boxes, like the renders in the manual
  const COLORS = {
    module: 0xd9dce1, facade: 0xf2f3f5, sustainer: 0xe7e9ec, dark: 0x2d3036, orange: 0xf06a24, roof: 0xcfd3d9,
    base: 0xc5cad1, tyre: 0x26282d, disk: 0xb4bac3, wood: 0xa8774a, wall: 0xdfe2e6, peg: 0xe9ebee, highlight: 0x9fdcf2,
    box: 0x3a3d44, bin: 0xf58a4d, divider: 0x5a5e66, inner: 0xc9cdd3
  };

  // The large light parts get thin dark edges, so drawers, modules and the roof do not run into
  // one white block
  const EDGED = new Set(['module', 'facade', 'sustainer', 'roof', 'base']);
  const EDGE_OPACITY = 0.55;

  // Does a mesh with these tags (userData.bom) stand for the parts list row `key`? A tag is the
  // whole key or its start up to a colon ('d:box:L4:2F' is 'd:box:L4:2F:part1' too).
  function tagMatches(tags, key) {
    return Boolean(tags && key) && tags.some(t => key === t || key.startsWith(`${t}:`));
  }

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
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x5b616b, transparent: true, opacity: EDGE_OPACITY });
    materials.set('edge', edgeMat);
    // o: { fi (floor, for hover and highlight), kind ('module' is highlighted), parent, openId,
    // bom (tags of the parts list rows) }
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
      if (o.part) mesh.userData.part = o.part;
      if (o.bom) mesh.userData.bom = o.bom;
      // Edges on the light parts, not on thin bars (the grid of a roof)
      if (EDGED.has(color)) {
        geometry.computeBoundingBox();
        const s = geometry.boundingBox.getSize(new THREE.Vector3());
        if ([s.x, s.y, s.z].sort((a, b) => a - b)[1] > 3.5) {
          const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 35), edgeMat);
          lines.layers.set(1);
          mesh.add(lines);
        }
      }
      (o.parent || (o.fi !== undefined ? floorGroup(o.fi) : group)).add(mesh);
      return mesh;
    };
    const box = (w, h, d, color, x, y, z, r = 0, o) => place(r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, h), Math.max(0.1, d)), color, x, y, z, o);
    // A flat shape ([x, y] points) made thick along z, centred on z
    const prism = (points, thickness, color, x, y, z, o) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py))), { depth: thickness, bevelEnabled: false });
      g.translate(0, 0, -thickness / 2);
      return place(g, color, x, y, z, o);
    };
    // A cylinder along the x axis (wheels), the z axis (keys) or upright (rods)
    const cylinder = (radius, length, color, x, y, z, axis, o) => {
      const g = new THREE.CylinderGeometry(radius, radius, length, 28);
      if (axis === 'x') g.rotateZ(Math.PI / 2);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      return place(g, color, x, y, z, o);
    };

    const W = MM[cfg.width] || 330;
    const depth = Number(cfg.depth);
    const D = 146 + 42 * (depth - 3);
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
    // o.bom: the baseplate's row (the bins are not files of the archive)
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
        box(sx * GRID - 4, binH, sz * GRID - 4, 'bin', x0 + (ix + sx / 2) * GRID, floorY + 6 + binH / 2, z0 + (iz + sz / 2) * GRID, 3, { ...o, bom: null });
      };
      bin(0, nz - 1, 1, 1);
      bin(0, nz - 3, 2, 1);
      bin(nx - 1, 0, 1, 2);
    };
    // Divider walls: `across` of them along the width, spread over the depth, and walls along the
    // depth at the offsets `along` (from the middle); tags: { across, along } (their rows)
    const dividers = (x, floorY, z, w, d, h, across, along, o, tags = {}) => {
      for (const ax of along) box(3, h, d, 'divider', x + ax, floorY + h / 2, z, 0, { ...o, part: 'divider', bom: tags.along });
      for (let k = 1; k <= across; k++) box(w, h, 3, 'divider', x, floorY + h / 2, z - d / 2 + (d * k) / (across + 1), 0, { ...o, part: 'divider', bom: tags.across });
    };
    // A sustainer's interior, with the parts list's counts: S and M dividers along the width; L and
    // XL two depth dividers crossed by width dividers; sealed modules have built-in walls (L one in
    // the middle, XL two) and seal dividers along the width in every compartment. o.bom: the
    // module's row (the built-in walls)
    const slotsFor = (table, w) => (((globalThis.VaultKit && VaultKit[table]) || {})[w] || [])[Number(cfg.depth) - 3] || 1;
    const sustainerInterior = (size, fh, interior, inner, h, o) => {
      const { x, floorY, z, w, d } = inner;
      if (interior === 'gridfinity') gridfinity(x, floorY, z, w, d, Math.min(h - 8, 40), { ...o, bom: [`s:baseplate:${size}${depth}`] });
      if (interior === 'dividers') {
        const n = slotsFor('DIVIDER_SLOTS', size);
        const depthAt = DEPTH_DIVIDERS[size];
        const dh = size === 'XL' ? '1F' : fh;
        const tags = depthAt ? { along: [`s:depthdivider:${size}${depth}:${dh}`], across: [`s:widthdivider:${size}:${dh}`] } : { across: [`s:divider:${size}:${fh}`] };
        dividers(x, floorY, z, w, d, h - 4, n, depthAt ? [-depthAt, depthAt] : [], o, tags);
      }
      if (interior === 'sealed') {
        const n = slotsFor('SEAL_SLOTS', size);
        const walls = size === 'XL' ? [-XL_SEAL_WALLS, XL_SEAL_WALLS] : [0];
        walls.forEach(wx => box(6, h, d, 'sustainer', x + wx, floorY + h / 2, z, 0, { ...o, part: 'seal-wall' }));
        const edges = [-w / 2, ...walls.flatMap(wx => [wx - 3, wx + 3]), w / 2];
        for (let c = 0; c < edges.length; c += 2) {
          const cw = edges[c + 1] - edges[c];
          // XL: a centre compartment between two sides
          const seal = size === 'XL' ? `s:sealdivider:XL:${c === 2 ? 'center' : 'sides'}` : `s:sealdivider:L:${fh}`;
          dividers(x + edges[c] + cw / 2, floorY, z, cw - 2, d, h - 2, n, [], o, { across: [seal] });
        }
      }
    };

    // Base, wheels or casters, feet
    if (hasBase) box(W, baseH, D, 'base', 0, lift + baseH / 2, 0, 5, { bom: [`m:base:${cfg.width}${depth}`, 'm:baseconnector'] });
    if (mods.base === 'wheels') {
      for (const side of [-1, 1]) {
        const x = side * (W / 2 + 19);
        cylinder(71, 30, 'tyre', x, 71, back + 60, 'x', { bom: ['m:tyre'] });
        cylinder(52, 34, 'disk', x, 71, back + 60, 'x', { bom: ['m:disk', 'm:wheelcover'] });
        cylinder(16, 48, 'dark', x - side * 8, 71, back + 60, 'x', { bom: ['m:bushing'] });
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
    if (hasBase && mods.feet && lift) box(W * 0.5, lift, 70, 'dark', 0, lift / 2, front - 44, 4, { bom: [`m:feet:${cfg.width}`] });

    // The floors, bottom to top: hollow modules, open at the front for drawers
    let y = lift + baseH;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      const layout = layoutOf(floor);
      if (!layout) return;
      const slots = VaultKit.slotsOf(layout);
      const fo = { fi };
      let mx = -W / 2;
      layout.modules.forEach((mod, mi) => {
        const mw = MM[mod.w];
        const first = slots.findIndex(s => s.mi === mi);
        const sustainer = !mod.cols && (floor.slots[first] || {}).type === 'sustainer';
        const moduleKey = sustainer ? `s:module:${mod.w}${depth}:${floor.height}` : VaultKit.drawerModuleKey(mod, depth, floor.height);
        const shell = { fi, kind: 'module', bom: [moduleKey] };
        const x0 = mx + 1.5;
        const w = mw - 3;
        // A sustainer's walls end under its lid
        const wh = sustainer ? h - LID : h;
        box(w, WALL, D, 'module', x0 + w / 2, y + WALL / 2, 0, 1, shell);
        if (!sustainer) box(w, WALL, D, 'module', x0 + w / 2, y + h - WALL / 2, 0, 1, shell);
        box(WALL, wh, D, 'module', x0 + WALL / 2, y + wh / 2, 0, 1, shell);
        box(WALL, wh, D, 'module', x0 + w - WALL / 2, y + wh / 2, 0, 1, shell);
        box(w, wh, WALL, 'module', x0 + w / 2, y + wh / 2, back + WALL / 2, 1, shell);
        // Orange latch marks on the outer sides, one per F near the front, standing 0.6 mm out of
        // the wall (flush with it the two faces flicker); a drawer module's latch is a file
        const latch = { ...fo, part: 'latch', bom: sustainer ? null : ['d:latch'] };
        for (let k = 0; k < (F[floor.height] || 1); k++) {
          if (mi === 0) box(2, 6, 20, 'orange', x0 + 0.4, y + 24 + k * P, front - 34, 0, latch);
          if (mi === layout.modules.length - 1) box(2, 6, 20, 'orange', x0 + w - 0.4, y + 24 + k * P, front - 34, 0, latch);
        }
        let cx = mx;
        slots.forEach((s, si) => {
          if (s.mi !== mi) return;
          const cw = MM[s.w];
          const slot = floor.slots[si] || {};
          if (cx > mx) box(WALL, h - 2 * WALL, D - WALL, 'module', cx, y + h / 2, WALL / 2, 0, { ...shell, bom: [moduleKey, `d:l2acc:${depth}`] }); // the middle wall of L² / XL²
          if (slot.type === 'sustainer') {
            // The facade is the front wall; the lid, a shallow tray, turns on hinges at the back
            const id = `${fi}:${si}`;
            const so = { fi, openId: id };
            const sx = cx + cw / 2;
            const wallTop = y + h - LID;
            box(cw - 3, h - LID - 2, 8, 'sustainer', sx, y + (h - LID) / 2, front + 4, 4, { ...so, kind: 'facade', bom: [`s:facade:${s.w}:${floor.height}`, `s:facadeu:${s.w}:${floor.height}`] }); // as wide as the module (S1F: 164.8 × 46 mm)
            // S and M have one lock in the middle (the label slot under it), L and XL two with the
            // label slot between them; the locks reach up over the lid
            const oneLock = s.w === 'S' || s.w === 'M';
            for (const at of oneLock ? [0.5] : [0.22, 0.78]) box(26, 16, 14, 'dark', cx + cw * at, y + h - 15, front + 9, 3, { ...so, bom: ['s:lockholder', 's:lockinner', `s:lockouter:${floor.height === '1F' ? 1 : 24}`, 's:lockpins'] });
            box(34, 10, 2, 'roof', sx, oneLock ? y + h - 32 : wallTop - 10, front + 8.5, 2, { ...so, bom: ['s:label'] });
            const inner = { x: sx, floorY: y + WALL, z: WALL / 2, w: cw - 2 * WALL - 6, d: D - WALL - 10 };
            sustainerInterior(s.w, floor.height, slot.interior, inner, wallTop - inner.floorY - 2, { ...so, bom: [moduleKey] });
            const hinges = VaultKit.sustainerHingeKeys(s.w, floor.height);

            // Hinges along the top of the back wall: S and M one hinge top on the lid between two
            // bottom hinges (63 / 99 mm, 40 mm), L and XL two pairs (40 mm on the lid, 50 mm on
            // the module); the rods' orange ends show at both ends of every knuckle line
            const lid = new THREE.Group();
            lid.position.set(sx, wallTop, back);
            floorGroup(fi).add(lid);
            const lo = { ...so, parent: lid };
            const plateH = Math.min(wallTop - y - 12, h > P ? 58 : 34);
            // The knuckles lie on the lid's axis (the top back edge), so the lid's own turn in place
            const knuckle = (len, at, onLid) => onLid
              ? cylinder(5, len, 'dark', at, 0, 0, 'x', { ...lo, part: 'hinge-knuckle', bom: [hinges.top] })
              : cylinder(5, len, 'dark', sx + at, wallTop, back, 'x', { ...so, part: 'hinge-knuckle', bom: [hinges.hinge] });
            const bottomHinge = (len, at) => {
              box(len, plateH, 3, 'dark', sx + at, wallTop - plateH / 2, back + WALL + 1.5, 1, { ...so, part: 'hinge-bottom', bom: [hinges.hinge] });
              knuckle(len, at, false);
            };
            const topHinge = (len, at) => {
              box(len, 3, 46, 'dark', at, LID - 5.5, 25, 1, { ...lo, part: 'hinge-top', bom: [hinges.top] });
              knuckle(len, at, true);
            };
            const rod = (from, to) => cylinder(2.5, to - from + 6, 'orange', sx + (from + to) / 2, wallTop, back, 'x', { ...so, part: 'hinge-rod', bom: [hinges.rods] });
            if (oneLock) {
              const top = s.w === 'S' ? 63 : 99;
              topHinge(top, 0);
              for (const side of [-1, 1]) bottomHinge(40, side * (top / 2 + 20.5));
              rod(-(top / 2 + 41), top / 2 + 41);
            } else {
              for (const side of [-1, 1]) {
                const at = side * cw * 0.22;
                bottomHinge(50, at + side * 22.5);
                topHinge(40, at - side * 22.5);
                rod(Math.min(at - side * 42.5, at + side * 47.5), Math.max(at - side * 42.5, at + side * 47.5));
              }
            }
            // The lid: a plate with a rim all round, on top of the walls
            const lw = cw - 4;
            const lidPart = { ...lo, bom: [`s:roof:${s.w}${depth}`, `s:roofconnector:${s.w}${depth}`] };
            box(lw, 4, D, 'roof', 0, LID - 2, D / 2, 3, lidPart);
            box(lw, LID - 4, 3, 'roof', 0, (LID - 4) / 2, D - 1.5, 0, lidPart);
            box(lw, LID - 4, 3, 'roof', 0, (LID - 4) / 2, 1.5, 0, lidPart);
            for (const side of [-1, 1]) box(3, LID - 4, D - 6, 'roof', side * (lw / 2 - 1.5), (LID - 4) / 2, D / 2, 0, lidPart);
            openables.push({ id, kind: 'sustainer', fi, node: lid, angle: -1.9 });
          } else {
            // Every box slides out with its facade, key, label and interior. Geared rails, as the
            // parts list has them (several boxes in the module, or "in every box"): two toothed
            // racks across the box front behind the facade, above and below the key's gear, which
            // moves them when the key turns: an extra lock of the drawer front
            const boxes = String(slot.boxes || floor.height).split('+');
            const rails = boxes.length > 1 || cfg.gearedRails === 'all';
            let top = y + h;
            boxes.forEach((bh, bi) => {
              const bH = (F[bh] || 1) * P;
              const id = `${fi}:${si}:${bi}`;
              const node = new THREE.Group();
              floorGroup(fi).add(node);
              const bo = { fi, openId: id, parent: node };
              // Measured on the facade STLs: the key in the middle of the top 1F band, the label
              // slot at the right edge (the label slides in from the side), the cap hole on the left
              const ky = top - P / 2;
              const keys = ['d:key', 'd:keycap', 'd:hiddenkey', 'd:hiddenkey2'];
              box(cw - 3, bH - 2, 8, 'facade', cx + cw / 2, top - bH / 2, front + 4, 4, { ...bo, kind: 'facade', bom: [`d:facade:${s.w}:${bh}`] });
              cylinder(11, 8, 'dark', cx + cw / 2, ky, front + 11, 'z', { ...bo, bom: keys });
              box(6, 18, 8, 'dark', cx + cw / 2, ky, front + 18, 2, { ...bo, bom: keys });
              box(Math.min(40, cw * 0.22), 10, 2, 'roof', cx + cw - 8 - Math.min(20, cw * 0.11), ky, front + 8.5, 2, { ...bo, bom: ['d:label'] });
              cylinder(4, 3, 'roof', cx + Math.min(26, cw * 0.15), ky, front + 9, 'z', { ...bo, bom: ['d:facadecap'] });
              // The box: a dark tray behind the facade (an XL box has a back panel of its own)
              const bw = cw - 26;
              const bx = cx + cw / 2;
              const floorY = top - bH + 5;
              const wallH = bH - 12;
              const bd = D - 12;
              const tray = { ...bo, bom: [`d:box:${s.w}${depth}:${bh}`] };
              box(bw, 3, bd, 'box', bx, floorY + 1.5, 0, 0, tray);
              box(3, wallH, bd, 'box', bx - bw / 2 + 1.5, floorY + wallH / 2, 0, 0, tray);
              box(3, wallH, bd, 'box', bx + bw / 2 - 1.5, floorY + wallH / 2, 0, 0, tray);
              box(bw, wallH, 3, 'box', bx, floorY + wallH / 2, back + 7.5, 0, { ...tray, bom: [...tray.bom, `d:backpanel:XL${depth}`] });
              box(bw, wallH, 3, 'box', bx, floorY + wallH / 2, bd / 2 - 1.5, 0, tray);
              if (rails) for (const dy of [13.5, -13.5]) box(RAILS[s.w] || bw - 10, 5, 4, 'orange', bx, ky + dy, bd / 2 + 2.5, 0, { ...bo, part: 'geared-rail', bom: [`d:rails:${s.w}`] });
              // Runners low on both sides (one size for every box height): the slide in the box
              // side comes out with the box, the guide stays in the module
              const rk = s.w === 'XL' ? `XL${depth}` : `x${depth}`;
              for (const side of [-1, 1]) {
                box(3, 12, bd - 26, 'facade', bx + side * (bw / 2 + 0.5), floorY + 14, -4, 0, { ...bo, part: 'runner-slide', bom: [`d:runnerslide:${rk}`] });
                box(3, 20, bd - 4, 'roof', bx + side * (bw / 2 + 4.7), floorY + 14, 0, 0, { ...shell, part: 'runner-guide', bom: [`d:runnerguide:${rk}`] });
              }
              if (slot.interior === 'gridfinity') gridfinity(bx, floorY + 3, -2, bw - 8, bd - 10, Math.max(12, wallH - 14), { ...bo, bom: [`d:baseplate:${s.w}${depth}`] });
              if (slot.interior === 'dividers') {
                const tall = slot.low ? '20' : (bh === '1F' ? '34.5' : '82.5');
                const strips = [`d:griddivider:${tall}`, `d:gridedge:${tall}`];
                dividers(bx, floorY + 3, -2, bw - 8, bd - 10, slot.low ? 20 : wallH - 4, 1, [0], bo, { along: strips, across: strips });
              }
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
          const rp = { ...tp, bom: [`d:roof:${mod.w}${depth}:${cfg.roof}`] };
          if (kind === 'grid') {
            box(mw - 4, 10, D - 4, 'roof', cx, topY + 5, 0, 4, rp);
            for (let gx = mx + GRID; gx < mx + mw - 10; gx += GRID) box(2, 3, D - 12, 'module', gx, topY + 11.5, 0, 0, rp);
            for (let gz = back + GRID; gz < front - 10; gz += GRID) box(mw - 12, 3, 2, 'module', cx, topY + 11.5, gz, 0, rp);
            box(Math.min(120, mw * 0.6), 26, 34, 'dark', cx, topY + 10 + 13, 0, 10, { ...tp, bom: ['d:tophandle'] });
            roofTop = Math.max(roofTop, topY + 36);
          }
          if (kind === 'table') { box(mw + 4, 8, D + 4, 'roof', cx, topY + 4, 0, 4, rp); roofTop = Math.max(roofTop, topY + 8); }
          if (kind === 'bowl') {
            box(mw - 4, 6, D - 4, 'roof', cx, topY + 3, 0, 4, rp);
            box(mw - 4, 18, 5, 'roof', cx, topY + 15, front - 4.5, 0, rp); box(mw - 4, 18, 5, 'roof', cx, topY + 15, back + 4.5, 0, rp);
            box(5, 18, D - 14, 'roof', mx + 4.5, topY + 15, 0, 0, rp); box(5, 18, D - 14, 'roof', mx + mw - 4.5, topY + 15, 0, 0, rp);
            roofTop = Math.max(roofTop, topY + 24);
          }
          if (kind === 'heavy') {
            // As the STL's profile: a 10 mm floor, a bowl at each end (thin outer wall, front and
            // back walls) and two 21 mm posts 119 mm apart that hold the handle. The cut roof's
            // outer top corners are cut off at 45°, 39 mm down the outer wall
            const H = 84;
            const cut = cfg.roof === 'heavycut' ? 39 : 0;
            box(mw - 4, 10, D - 4, 'roof', cx, topY + 5, 0, 3, rp);
            for (const side of [-1, 1]) {
              const outer = mw / 2 - 2;
              box(21, H - 10, D - 4, 'roof', cx + side * 70, topY + 10 + (H - 10) / 2, 0, 3, rp);
              box(4, H - 10 - cut, D - 4, 'roof', cx + side * (outer - 2), topY + 10 + (H - 10 - cut) / 2, 0, 1, { ...rp, part: 'roof-outer' });
              // Front and back walls of the bowl, from the post to the outer wall (x outwards)
              const corner = cut ? [[outer, H - cut], [outer - cut, H]] : [[outer, H]];
              const shape = [[80.5, 10], [outer, 10], ...corner, [80.5, H]].map(([px, py]) => [side * px, py]);
              for (const z of [front - 4, back + 4]) prism(shape, 4, 'roof', cx, topY, z, rp);
            }
            cylinder(13, 157, 'dark', cx, topY + H - 16, 0, 'x', { ...tp, bom: ['d:heavyhandle', 'd:heavyinsert'] });
            roofTop = Math.max(roofTop, topY + H);
          }
          if (kind === 'undertable') { box(mw + 20, 8, D + 20, 'roof', cx, topY + 4, 0, 3, rp); roofTop = Math.max(roofTop, topY + 8); }
        }
        mx += mw;
      });
      // The table top: flush with the drawer fronts (front + 8) and 60 mm past the tower at the
      // sides and the back, so the mount plate under it shows
      if (kind === 'undertable') { box(W + 120, 22, D + 68, 'wood', 0, topY + 8 + 11, -26, 4, tp); roofTop = topY + 30; }
    }

    // Along the back: backbone boards (two per 4F floor), pegboards, wall mounts, handles
    let by = lift + baseH;
    let backZ = back;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      const fo = { fi };
      if (hasBackbone) {
        let uy = by;
        const board = { ...fo, bom: ['m:backbone'] };
        for (const uh of floor.height === '4F' ? [h / 2, h / 2] : [h]) {
          if (mods.backbone === 'universal') for (const side of [-1, 1]) box(70, uh - 4, 14, 'dark', side * (W / 2 - 37), uy + uh / 2, back - 7, 3, board);
          else box(W - 6, uh - 4, 14, 'dark', 0, uy + uh / 2, back - 7, 3, board);
          uy += uh;
        }
        if (mods.pegboard && mods.pegboard !== 'none') {
          const peg = { ...fo, bom: ['m:pegboard'] };
          box(W - 24, h - 12, 6, 'peg', 0, by + h / 2, back - 17, 2, peg);
          for (let k = 1; k < (F[floor.height] || 1) * 2; k++) box(W - 60, 3, 2, 'dark', 0, by + k * (P / 2), back - 20.5, 0, peg);
        }
      }
      if (mods.wallMount) {
        const z = back - (hasBackbone ? 14 : 0) - 5;
        let mx = -W / 2;
        layoutOf(floor).modules.forEach(mod => { box(MM[mod.w] - 8, h - 6, 10, 'base', mx + MM[mod.w] / 2, by + h / 2, z, 3, { ...fo, bom: [`m:wallmount:${mod.w}:${floor.height}`] }); mx += MM[mod.w]; });
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
      const pull = { ...tp, bom: ['m:pullhandle', 'm:pullcover', 'm:pulllock', 'm:knob'] };
      for (const side of [-1, 1]) cylinder(8, rodTop - (lift + baseH), 'disk', side * (W / 2 - 42), (rodTop + lift + baseH) / 2, backZ - 14, null, pull);
      box(W - 40, 22, 30, 'dark', 0, rodTop + 11, backZ - 14, 8, pull);
    }
    if (hasBackbone && top && mods.stationaryHandle) {
      const th = (F[top.height] || 1) * P;
      const hy = topY - th / 2;
      const stat = { ...tp, bom: ['m:stathandle'] };
      box(W * 0.5, 18, 18, 'dark', 0, hy, backZ - 44, 6, stat);
      for (const side of [-1, 1]) box(18, 18, 40, 'dark', side * (W * 0.25 - 9), hy, backZ - 22, 4, stat);
    }

    const size = { width: W, depth: D, height: Math.max(roofTop, topY) };
    return { group, topGroup, floorGroups, floorMeshes, openables, materials, size };
  }

  // The meshes that stand for any of these parts list rows (keys)
  function partMeshes(model, keys) {
    const out = [];
    if (!model || !keys || !keys.length) return out;
    model.group.traverse(m => { if (m.isMesh && keys.some(k => tagMatches(m.userData.bom, k))) out.push(m); });
    return out;
  }

  // Where the moving parts go when the parts in `open` (ids) are open: drawers slide out,
  // sustainer lids turn up, and every floor above an open sustainer (and the roof) rises by
  // about the depth so the lid can swing. Returns { floors: [dy], top: dy, out: how far the open
  // drawers reach out at the front, parts: [{ o, value }] }.
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
    const out = parts.reduce((m, p) => (p.o.kind === 'drawer' ? Math.max(m, p.value) : m), 0);
    return { floors, top: up, out, parts };
  }

  // Where the camera must stand to see the whole tower: the sphere around it (taller with open
  // sustainers, deeper at the front with open drawers) fits the narrower of the view's two
  // angles, so a panel taller than wide does not cut off the sides. t: targets(), or none
  // (closed); view: { fov (vertical, degrees), aspect }. Returns { center: [x, y, z], radius, dist }.
  function cameraFrame(size, t, view) {
    const height = size.height + (t ? t.top : 0);
    const out = t ? t.out : 0;
    const depth = size.depth + out;
    const radius = Math.sqrt(size.width * size.width + height * height + depth * depth) / 2;
    const half = (view.fov * Math.PI) / 360;
    const angle = Math.min(half, Math.atan(Math.tan(half) * view.aspect));
    return { center: [0, height / 2, out / 2], radius, dist: radius / Math.sin(angle) * 1.05 };
  }

  function disposeGroup(model) {
    if (!model) return;
    model.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    for (const m of model.materials.values()) m.dispose();
  }

  // opts: { background (number), onHover(fi | null, tags of the part | null), onClick(fi),
  // onOpen(count, total) }. Returns null without WebGL.
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
    // Lights that leave the light grey parts grey: brighter, the fronts all turned the same white
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a909c, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
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
    // The rest of the tower while parts of the list are lit: see-through, so parts inside show
    const ghostMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.8, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false });
    let litFloor = null;
    let litParts = null; // Set of meshes, or null

    // Every mesh's material from what is lit: parts of the list (the rest see-through), else the
    // modules of the floor under the pointer
    function paint() {
      if (!model) return;
      const edges = model.materials.get('edge');
      if (edges) edges.opacity = litParts ? 0.12 : EDGE_OPACITY;
      model.group.traverse(m => {
        if (!m.isMesh) return;
        const base = m.userData.baseMaterial || m.material;
        if (litParts) {
          m.material = litParts.has(m) ? highlightMat : ghostMat;
          m.castShadow = litParts.has(m);
        } else {
          m.material = litFloor !== null && m.userData.fi === litFloor && m.userData.kind === 'module' ? highlightMat : base;
          m.castShadow = true;
        }
      });
      render();
    }

    // Camera from the front right, a little above, like the manual's renders
    function fit(size, t) {
      const f = cameraFrame(size, t, camera);
      const center = new THREE.Vector3(...f.center);
      const dir = new THREE.Vector3(0.62, 0.42, 1).normalize();
      camera.position.copy(center).addScaledVector(dir, f.dist);
      camera.near = f.dist / 50;
      camera.far = f.dist * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = f.radius * 0.4;
      controls.maxDistance = f.dist * 4;
      controls.update();
    }

    // Where the camera goes to see the tower with these parts open, looking from where it looks now
    function pose(t) {
      const f = cameraFrame(model.size, t, camera);
      const center = new THREE.Vector3(...f.center);
      const dir = camera.position.clone().sub(controls.target).normalize();
      return { target: center, position: center.clone().addScaledVector(dir, f.dist) };
    }

    // The moving parts follow targets(): at once, or eased over about a third of a second.
    // When the tower grows or shrinks (sustainers, drawers opened), the camera keeps it in view.
    let anim = 0;
    let shown = null;
    function applyOpen(instant) {
      if (!model) return;
      const t = targets(model, open);
      const moves = [];
      if (!instant && shown && (Math.abs(t.top - shown.top) > 1 || Math.abs(t.out - shown.out) > 1)) {
        const to = pose(t);
        const cam = camera.position.clone();
        const tgt = controls.target.clone();
        moves.push({ get: () => 0, set: k => { camera.position.lerpVectors(cam, to.position, k); controls.target.lerpVectors(tgt, to.target, k); camera.lookAt(controls.target); }, to: 1 });
        controls.maxDistance = Math.max(controls.maxDistance, to.position.distanceTo(to.target) * 4);
      }
      shown = t;
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
      if (changed) { fit(s, targets(model, open)); fitted = s; }
      hovered = null;
      litFloor = null;
      litParts = null;
      applyOpen(true);
      if (opts.onOpen) opts.onOpen(open.size, model.openables.length);
    }

    // The modules of a floor (fi; null: none)
    function highlight(fi) {
      litFloor = fi === undefined ? null : fi;
      paint();
    }

    // The parts of these rows of the parts list (keys; empty: none). A row the tower does not
    // draw (springs, runner stoppers) lights nothing and leaves the tower as it is.
    function highlightParts(keys) {
      const meshes = partMeshes(model, keys);
      litParts = meshes.length ? new Set(meshes) : null;
      paint();
      return meshes.length;
    }

    function toggle(id) {
      if (open.has(id)) open.delete(id);
      else open.add(id);
      applyOpen(false);
    }

    // Hover and click (a click is a press without a drag): a drawer or a sustainer opens or
    // closes, another part of a floor brings the floor up in the builder. The edges are on
    // layer 1, which the camera draws and the pointer does not test.
    camera.layers.enable(1);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = model && raycaster.intersectObject(model.group, true).find(h => h.object.userData.fi !== undefined || h.object.userData.bom);
      return hit ? hit.object.userData : null;
    };
    let frame = 0;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const hit = pick(e);
        const fi = hit && hit.fi !== undefined ? hit.fi : null;
        const tags = (hit && hit.bom) || null;
        renderer.domElement.style.cursor = hit && hit.openId ? 'pointer' : '';
        const key = hit ? `${fi}|${tags ? tags.join(',') : ''}` : null;
        if (key === hovered) return;
        hovered = key;
        if (opts.onHover) opts.onHover(fi, tags);
      });
    };
    const onLeave = () => { if (hovered !== null && opts.onHover) opts.onHover(null, null); hovered = null; };
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const hit = pick(e);
      if (!hit) return;
      if (hit.openId) toggle(hit.openId);
      else if (opts.onClick && hit.fi !== undefined) opts.onClick(hit.fi);
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    // A panel of another shape (a narrow or a wide layout) frames the tower again, from where
    // the camera looks now
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const before = camera.aspect;
      renderer.setSize(width(), height());
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      if (model && !anim && Math.abs(camera.aspect - before) > before * 0.05) {
        const to = pose(targets(model, open));
        camera.position.copy(to.position);
        controls.target.copy(to.target);
        controls.update();
      }
      render();
    }) : null;
    if (resizeObserver) resizeObserver.observe(container);

    update(cfg);

    return {
      container,
      canvas: renderer.domElement,
      update,
      highlight,
      highlightParts,
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
        // With what is open now in view
        fit(model.size, targets(model, open));
        fitted = model.size;
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
        ghostMat.dispose();
        ground.geometry.dispose();
        ground.material.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        model = null;
      }
    };
  }

  return { build, targets, cameraFrame, tagMatches, partMeshes, mount, COLORS, COVER_LOOK };
})();
