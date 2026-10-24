/* ─── Hero Me Gen7 kit: the printhead in 3D ─────────────────────────────────
 * A model of a configuration (HeroMeKit bom.head) built from simple shapes in real sizes
 * (millimetres, from the parts' STLs and the components the PDFs name): the base, the hotend in
 * it and the skirt under it, the gantry adapter on the printer's X carriage (V-wheels or a
 * linear rail), part cooling ducts (one or two, for 4010 to 5020 fans, standard, long or tall;
 * the fans themselves are not drawn), the ABL sensor on its wing, the cable tower, risers and
 * the extruder with its stepper (front or rear), the ADXL345 board. The parts' own STLs are
 * printed in their print orientation, wherever their author left them; with the places
 * scripts/hero-me-poses.js found for them (buildReal) the printhead is put together from them
 * instead, and the model is only drawn where they have no place.
 *
 * The bed is y = 0 with the nozzle on it; x is the printer's X axis (right), z points to the
 * front. Printed parts are light grey, bought parts dark or metal, the printer's own parts dim.
 *
 * build(head) / buildReal(head, poses) make a THREE.Group (no DOM, the tests run them in
 * Node); mount() puts it in a
 * container with orbit controls and returns a handle the configurator updates and disposes.
 * The scene renders on demand (camera moves, hover, updates), never in a loop.
 */
globalThis.HeroMe3D = (function () {
  const COLORS = {
    printed: 0xdcdfe4, metal: 0xb9bec7, block: 0xc9cdd4, brass: 0xd2a74a,
    ptfe: 0xf2f2f2, sensor: 0xf0f0ee, black: 0x25272c, pcb: 0x2f7a4d, printer: 0x5d636c, extrusion: 0x6f757e,
    wheel: 0x1f2126, stepper: 0x2c2e34, band: 0xaeb3bb, magnet: 0x50555e, highlight: 0x9fdcf2, ghost: 0xdcdfe4
  };
  // The base (Universal Base V2: 41.6 × 38.5 × 51.2 mm), the hotend's axis 8 mm in front of
  // the base's middle, the base's bottom by hotend length (long and tall ducts are for longer
  // hotends); a duct's height by the size of its fan
  const BASE = { w: 42, h: 38.5, d: 51 };
  const AXIS_Z = 8;
  const BASE_BOTTOM = { standard: 20, long: 28, tall: 30 };
  const FANS = { 4010: [40, 10], 4020: [40, 20], 5015: [51.2, 15], 5020: [51.2, 20] };
  const SENSOR_LENGTH = { 8: 55, 12: 45, 18: 50 };

  // The shapes both printheads (the model and the real parts) are drawn with, into group;
  // parts: { key: { label, files, meshes } } for hover, click and the list
  function tools(group, parts, materials) {
    const mat = (name) => {
      if (!materials.has(name)) {
        const opts = { color: COLORS[name], roughness: ['metal', 'block', 'brass', 'band'].includes(name) ? 0.38 : 0.72, metalness: ['metal', 'block', 'brass', 'band'].includes(name) ? 0.55 : 0.04 };
        if (name === 'ptfe') Object.assign(opts, { transparent: true, opacity: 0.85 });
        if (name === 'ghost') Object.assign(opts, { transparent: true, opacity: 0.25, depthWrite: false });
        materials.set(name, new THREE.MeshStandardMaterial(opts));
      }
      return materials.get(name);
    };
    // key: the part of the list it belongs to ({ label, files }); printer: dimmed context
    const place = (geometry, color, x, y, z, key, rot) => {
      const mesh = new THREE.Mesh(geometry, mat(color));
      mesh.position.set(x, y, z);
      if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (key && parts[key]) { mesh.userData.part = key; parts[key].meshes.push(mesh); }
      group.add(mesh);
      return mesh;
    };
    const part = (key, info) => { if (info && !parts[key]) parts[key] = { label: info.label, files: info.files || [], meshes: [] }; return info ? key : null; };
    const box = (w, hh, d, color, x, y, z, key, rot) => place(new THREE.BoxGeometry(Math.max(0.1, w), Math.max(0.1, hh), Math.max(0.1, d)), color, x, y, z, key, rot);
    // A cylinder standing on the y axis (rot turns it)
    const cyl = (r1, r2, hh, color, x, y, z, key, rot, seg = 24) => place(new THREE.CylinderGeometry(r1, r2, hh, seg), color, x, y, z, key, rot);
    // A flat shape ([x, y] points, holes as more point lists) made thick along z, centred on z
    const shape = (points, holes = []) => {
      const s = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
      for (const hole of holes) s.holes.push(new THREE.Path(hole.map(([px, py]) => new THREE.Vector2(px, py))));
      return s;
    };
    const prism = (points, thickness, color, x, y, z, key, rot, holes) => {
      const g = new THREE.ExtrudeGeometry(shape(points, holes), { depth: thickness, bevelEnabled: false, curveSegments: 20 });
      g.translate(0, 0, -thickness / 2);
      return place(g, color, x, y, z, key, rot);
    };

    // The printer's X carriage: wheels on a 2040 beam, or a rail and its block
    const carriage = (kind, cy, zBack) => {
      if (kind === 'rail') {
        box(170, 40, 20, 'extrusion', 0, cy, zBack - 32, null);
        box(220, 12, 8, 'metal', 0, cy, zBack - 18, null);
        box(27, 27, 13, 'metal', 0, cy, zBack - 7, null);
        return zBack;
      }
      box(170, 40, 20, 'extrusion', 0, cy, zBack - 22, null);
      box(76, 92, 6, 'printer', 0, cy, zBack - 3, null);
      for (const [wx, wy] of [[-26, cy + 32], [26, cy + 32], [0, cy - 32]]) cyl(12, 12, 10, 'wheel', wx, wy, zBack - 12, null, [Math.PI / 2, 0, 0]);
      return zBack;
    };
    return { mat, place, part, box, cyl, prism, carriage };
  }

  function build(head) {
    const h = head || {};
    const materials = new Map();
    const group = new THREE.Group();
    const parts = {};
    const { part, box, cyl, prism, carriage } = tools(group, parts, materials);
    const size = { width: 0, height: 0, depth: 0 };

    if (h.standalone) {
      // The stock Neptune 3 printhead in the Hero Me shroud: body and front cap
      const key = part('gantry', h.gantry);
      const yb = 12;
      prism([[-31, 0], [31, 0], [31, 58], [24, 70], [-24, 70], [-31, 58]], 50, 'printed', 0, yb, 0, key);
      // The front cap (open: the stepper shows through), the ducts' noses under the shroud,
      // vents on top, the ADXL345 board on the versions for it
      const label = `${h.gantry.label} ${h.gantry.files.length > 1 ? 'cap' : ''}`;
      box(58, 50, 4, 'printed', 0, yb + 28, 26, key);
      if (/open|vents/i.test(h.gantry.label)) box(36, 22, 1, 'black', 0, yb + 40, 28.2);
      for (const s of [-1, 1]) prism([[0, 0], [10, 0], [s * 4 + 4, -9], [-2, -9]].map(([px, py]) => [s * px, py]), 16, 'printed', s * 20, yb, 0, key);
      if (/vents/i.test(label)) for (let i = 0; i < 5; i++) box(40, 1, 3, 'black', 0, yb + 70.1, -16 + i * 7);
      if (/adxl/i.test(label)) box(20, 1.6, 15, 'pcb', 0, yb + 71.5, 14);
      cyl(0.6, 3.2, 3, 'brass', 0, 1.5, 0);
      box(20, 9, 16, 'block', 0, 7.5, 0);
      carriage('wheels', yb + 40, -25);
      box(46, 36, 40, 'printer', 0, yb + 70 + 18, -6, null);
      Object.assign(size, { width: 80, height: yb + 110, depth: 90 });
      return { group, parts, materials, size };
    }

    const height = h.hotend ? h.hotend.height : 'standard';
    const bb = BASE_BOTTOM[height] || BASE_BOTTOM.standard;
    const bt = bb + BASE.h;
    const zFront = AXIS_Z + 9.5;
    const zBack = zFront - BASE.d;
    const zMid = (zFront + zBack) / 2;

    // The base: a box sloping down to the back; the Magnet Edition shows its magnets on the back
    const baseKey = part('base', h.base);
    prism([[zBack, bb], [zFront, bb], [zFront, bt], [zBack + 14, bt], [zBack, bt - 10]], BASE.w, 'printed', 0, 0, 0, baseKey, [0, -Math.PI / 2, 0]);
    if (h.base && h.base.magnet) for (const s of [-1, 1]) cyl(4, 4, 1.6, 'magnet', s * 12, bb + 18, zBack - 0.6, baseKey, [Math.PI / 2, 0, 0]);

    // The hotend: nozzle, heater block (tall for a Volcano), heat break, the heat sink in the base
    const block = height === 'tall' ? 20 : 11.5;
    cyl(0.6, 3.2, 3, 'brass', 0, 1.5, 0);
    cyl(4.6, 4.6, 2.2, 'brass', 0, 4, 0, null, null, 6);
    box(20, block, 16, 'block', 4, 5 + block / 2, 0);
    cyl(1.6, 1.6, bb - 5 - block + 3, 'metal', 0, 5 + block + (bb - 5 - block + 3) / 2 - 1.5, 0);
    cyl(11, 11, 26, 'metal', 0, bb + 15, 0);

    // The skirt under the base: a plate around the heater block, open to the front
    const skirtKey = part('skirt', h.skirt);
    if (h.skirt) {
      const sk = [[-17.5, zBack + 6], [17.5, zBack + 6], [17.5, zFront + 2], [11, zFront + 2], [11, zFront - 22], [-11, zFront - 22], [-11, zFront + 2], [-17.5, zFront + 2]];
      prism(sk, 7.6, 'printed', 0, bb - 3.8, 0, skirtKey, [Math.PI / 2, 0, 0]);
    }

    // The hotend mount on top of the base, a standoff behind it
    const mountKey = part('hotend', h.hotend);
    let top = bt;
    if (h.hotend) {
      box(BASE.w, 6, 36, 'printed', 0, bt + 3, AXIS_Z - 12, mountKey);
      cyl(9, 9, 4, 'printed', 0, bt + 8, 0, mountKey);
      top = bt + 10;
    }
    const standoffKey = part('standoff', h.standoff);
    if (h.standoff) box(30, 10, 8, 'printed', 0, bt - 6, zBack - 4, standoffKey);

    // The gantry adapter on the printer's carriage
    const gantryKey = part('gantry', h.gantry);
    const carriageY = bb + BASE.h / 2;
    if (h.gantry) {
      box(65, 40, 5, 'printed', 0, carriageY, zBack - 2.5, gantryKey);
      carriage(h.gantry.kind, carriageY, zBack - 5);
    } else {
      carriage('wheels', carriageY, zBack);
    }

    // Risers, the extruder mount, the extruder and its stepper (front or rear); Bowden: the
    // coupler and the PTFE tube
    (h.risers || []).forEach((r, i) => {
      const key = part(`riser-${i}`, r);
      box(BASE.w, r.mm, 36, 'printed', 0, top + r.mm / 2, AXIS_Z - 12, key);
      top += r.mm;
    });
    const extruderKey = part('extruder', h.extruder);
    if (h.extruder) {
      const e = h.extruder;
      box(46, 6, 42, 'printed', 0, top + 3, AXIS_Z - 10, extruderKey);
      top += 6;
      const body = e.small ? [28, 26, 30] : [34, 30, 36];
      const motor = e.small ? [22, 36, 36] : [34, 42, 42];
      const dx = e.mirror ? -5 : 5;
      box(body[0], body[1], body[2], 'black', dx, top + body[1] / 2, 0);
      const mz = (e.rear ? -1 : 1) * (body[2] / 2 + motor[2] / 2 - 4);
      box(motor[0], motor[1], motor[2], 'stepper', dx, top + motor[1] / 2, mz);
      box(motor[0] + 0.6, 3, motor[2] + 0.6, 'band', dx, top + motor[1] - 6, mz);
      cyl(2, 2, 12, 'ptfe', dx, top + body[1] + 6, 0);
      top += Math.max(body[1], motor[1]) + 12;
    } else if (h.hotend) {
      cyl(4, 4, 8, 'metal', 0, top + 4, 0);
      cyl(2, 2, 50, 'ptfe', 0, top + 33, 0);
      top += 58;
    }

    // Part cooling: ducts down the sides of the base to the nozzle
    const c = h.cooling;
    let halfWidth = BASE.w / 2;
    if (c) {
      const fs = c.fan === 'cpap' ? 0 : (FANS[c.fan] || FANS[5015])[0];
      // The fan's outlet at the level of the base's bottom, the duct below it
      const yFanBottom = bb + 2;
      const yFanTop = c.fan === 'cpap' ? bb + 24 : yFanBottom + fs;
      const dz = zMid + 10;
      // A duct seen from the front: up the side of the base, then a nose to the nozzle
      const duct = (s, key, column = true) => {
        const outer = BASE.w / 2 + 10;
        const pts = column
          ? [[BASE.w / 2, Math.max(yFanTop, bb + 12)], [outer, Math.max(yFanTop, bb + 12)], [outer, 16], [13, 1.6], [7, 1.6], [7, 6.5], [BASE.w / 2, 17]]
          : [[BASE.w / 2, 19], [BASE.w / 2 + 5, 17], [13, 1.6], [7, 1.6], [7, 6.5], [BASE.w / 2 - 2, 15]];
        prism(pts.map(([px, py]) => [s * px, py]), 22, 'printed', 0, 0, dz, key);
      };
      if (c.layout === 'sides' || c.layout === 'side') {
        for (const s of [-1, 1]) {
          const side = s < 0 ? 'left' : 'right';
          if (!c.files[side].length) continue;
          const key = part(`duct-${side}`, { label: c.label, files: c.files[side] });
          duct(s, key);
          halfWidth = Math.max(halfWidth, BASE.w / 2 + 10);
        }
      } else if (c.layout === 'wrap') {
        // One fan, a duct round the front to both sides of the nozzle
        const s = c.side === 'right' ? 1 : -1;
        const key = part(`duct-${c.side}`, { label: c.label, files: c.files[c.side] });
        duct(s, key);
        duct(-s, key, false);
        box(BASE.w + 8, 7, 8, 'printed', 0, 14, zFront + 2, key);
        halfWidth = Math.max(halfWidth, BASE.w / 2 + 10);
      } else if (c.layout === 'front') {
        // One fan in front, under the heat sink fan
        const key = part('duct-front', { label: c.label, files: c.files.front });
        for (const s of [-1, 1]) duct(s, key, false);
        box(BASE.w + 8, 10, 10, 'printed', 0, 14, zFront + 4, key);
      }
    }

    // ABL: the wing on the side of the base, the sensor's mount, the sensor
    const a = h.abl;
    if (a) {
      const s = a.side === 'right' ? 1 : -1;
      const wingKey = part('abl-wing', a.wing);
      const mountKey2 = part('abl-mount', a.mount);
      // Behind the fans: the wing comes from the base's rear mount point
      const sz = zBack + 4;
      if (a.under) {
        // A Beacon3D under the skirt, 30.6 mm in front of the nozzle, 2-2.6 mm above the bed
        box(16, bb - 8 - 6, 4, 'printed', 0, (bb - 8 + 6) / 2, zFront + 8, mountKey2);
        box(30, 4, 20, 'black', 0, 4.3, 30.6);
        box(26, 1, 16, 'pcb', 0, 6.8, 30.6);
      } else {
        const reach = a.reach || (a.mount && /close/i.test(a.mount.label) ? 32 : a.mount && /no duct/i.test(a.mount.label) ? 22 : 36);
        const sx = s * (BASE.w / 2 + reach);
        const wy = bb + (a.low ? 2 : 8);
        const armKey = wingKey || mountKey2;
        box(reach + 6, 6, 12, 'printed', s * (BASE.w / 2 + (reach + 6) / 2 - 3), wy, sz, armKey);
        box(18, 16, 4, 'printed', sx, wy - 5, sz + 7, mountKey2 || armKey);
        if (['bltouch', 'crtouch'].includes(a.family)) {
          const colour = a.family === 'crtouch' ? 'black' : 'sensor';
          box(13, 36, 11.5, colour, sx, 8 + 18, sz);
          box(26, 2, 11.5, colour, sx, 8 + 36, sz);
          cyl(1, 1, 4, 'metal', sx, 6, sz);
        } else if (a.family === 'beacon') {
          box(30, 4, 20, 'black', sx, 4.3, sz);
          box(4, wy - 8, 4, 'printed', sx, (wy + 4) / 2, sz + 7, mountKey2 || armKey);
        } else if (['euclid', 'touchmi'].includes(a.family)) {
          box(14, 40, 14, 'black', sx, 2 + 20, sz);
        } else {
          const d = a.size || 18;
          const len = SENSOR_LENGTH[d] || 48;
          cyl(d / 2, d / 2, len, 'metal', sx, 2 + len / 2, sz);
          for (const ny of [wy - 10, wy + 6]) cyl(d / 2 + 3, d / 2 + 3, 3, 'band', sx, ny, sz, null, null, 6);
        }
        halfWidth = Math.max(halfWidth, BASE.w / 2 + reach + 16);
      }
    }

    // The cable tower at a rear corner of the base, beside the hotend stack
    const t = h.cable;
    if (t) {
      const s = t.side === 'right' ? 1 : -1;
      const key = part('cable', t);
      const x = s * (BASE.w / 2 + 3 + t.offset);
      const y0 = bb + 12;
      if (t.tube) cyl(5, 5, t.height, 'printed', x, y0 + t.height / 2, zBack + 6, key);
      else box(5, t.height, 10.4, 'printed', x, y0 + t.height / 2, zBack + 6, key);
      if (t.bent) cyl(5, 5, 24, 'printed', x, y0 + t.height + 8, zBack - 2, key, [-0.8, 0, 0]);
      box(Math.abs(x) - BASE.w / 2 + 4, 8, 10, 'printed', s * (BASE.w / 2 + (Math.abs(x) - BASE.w / 2) / 2), y0 + 4, zBack + 6, key);
      top = Math.max(top, y0 + t.height + 10);
    }

    // The ADXL345 board on top of the base, at the front
    const adxlKey = part('adxl', h.adxl);
    if (h.adxl) {
      if (h.adxl.vertical) {
        box(16, 14, 6, 'printed', 0, bt - 4, zFront + 14, adxlKey);
        box(20, 15, 1.6, 'pcb', 0, bt + 4, zFront + 17.8);
      } else {
        box(16, 8, 10, 'printed', 0, bt + 4, zFront - 2, adxlKey);
        box(20, 1.6, 15, 'pcb', 0, bt + 8.8, zFront + 2);
      }
    }

    Object.assign(size, { width: Math.max(halfWidth * 2, 90), height: Math.max(top, bt + 20), depth: zFront - zBack + 50 });
    return { group, parts, materials, size };
  }

  // ── The real parts: the project's own STLs where scripts/hero-me-poses.js placed them ──
  // A plan, without three.js: each chosen file with its place ({ key, label, files, id, url,
  // m, t, dy, box }), the nozzle's height (the outlets of the ducts 1.6 mm above the bed), the
  // top of the hotend stack, where the ABL sensor hangs. null when the base has no place (a
  // base of its own, the stock Neptune shroud): the model is drawn then.
  function planReal(head, poses) {
    const h = head || {};
    if (!poses || !poses.parts || !poses.base || !h.base || h.standalone) return null;
    const src = h.src || {};
    const chosen = new Set(Object.values(src).map(s => s.path));
    // A part that sits on another (a clip on its adapter, a sensor mount on its wing) takes
    // the place it has on the one that is chosen
    const poseOf = (id) => {
      const s = src[id];
      const p = s && poses.parts[s.path];
      if (!p || (p.size && s.size && p.size !== s.size)) return null;
      if (!p.on) return p;
      const parent = Object.keys(p.on).find(k => chosen.has(k));
      return parent ? { ...p.on[parent], kind: 'on', board: p.board } : null;
    };
    if (!poseOf(h.base.files[0])) return null;
    const items = [];
    const missing = [];
    const add = (key, info, ids, dy = 0) => {
      const placed = [];
      for (const id of ids || []) {
        const p = poseOf(id);
        if (!p) { missing.push(info.label); continue; }
        const b = p.box || [0, 0, 0, 0, 0, 0];
        const item = { key, label: info.label, files: info.files || ids, id, url: src[id] && src[id].url, m: p.m, t: p.t, dy, box: [b[0], b[1] + dy, b[2], b[3], b[4] + dy, b[5]], pose: p };
        items.push(item);
        placed.push(item);
      }
      return placed;
    };
    add('base', h.base, h.base.files);
    const mount = h.hotend ? add('hotend', h.hotend, h.hotend.files) : [];
    if (h.skirt) add('skirt', h.skirt, h.skirt.files);
    if (h.gantry) add('gantry', h.gantry, h.gantry.files);
    // The stack on the hotend mount: risers, then the extruder mount
    let level = mount.reduce((top, it) => Math.max(top, it.pose.top || 0), 0) || poses.base.top + 8;
    (h.risers || []).forEach((r, i) => {
      for (const it of add(`riser-${i}`, r, r.files, level)) level += it.pose.height || it.box[4] - it.box[1];
    });
    let stackTop = level;
    if (h.extruder) for (const it of add('extruder', h.extruder, h.extruder.files, level)) stackTop = Math.max(stackTop, it.box[4]);
    // Ducts: a Gen6 dual duct is one part on both sides
    const c = h.cooling;
    const ducts = [];
    let ductsMissing = false;
    if (c) {
      const sides = ['left', 'right', 'front'].filter(s => c.files[s].length);
      const same = sides.length === 2 && c.files.left.join() === c.files.right.join();
      for (const s of same ? ['both'] : sides) {
        const ids = s === 'both' ? c.files.left : c.files[s];
        const placed = add(`duct-${s}`, { label: c.label, files: ids }, ids);
        if (!placed.length) ductsMissing = true;
        ducts.push(...placed);
      }
    }
    const tips = ducts.map(it => it.pose.tip).filter(v => typeof v === 'number');
    const nozzle = tips.length ? Math.min(...tips) - 1.6 : 0;
    let sensor = null;
    if (h.abl) {
      const wing = h.abl.wing ? add('abl-wing', h.abl.wing, h.abl.wing.files) : [];
      const am = h.abl.mount ? add('abl-mount', h.abl.mount, h.abl.mount.files) : [];
      const holder = am[0] || wing[0] || null;
      if (holder) sensor = { box: holder.box, side: h.abl.side, family: h.abl.family, size: h.abl.size, under: h.abl.under };
    }
    if (h.cable) add('cable', h.cable, h.cable.files);
    const adxl = h.adxl ? add('adxl', h.adxl, h.adxl.files)[0] || null : null;
    const gantry = items.filter(it => it.key === 'gantry');
    const back = gantry.length ? Math.min(...gantry.map(it => it.box[2])) : poses.base.box[2];
    return { items, missing: [...new Set(missing)], nozzle, stackTop, ductsMissing, sensor, adxl, back, base: poses.base, extruder: h.extruder || null, hotend: h.hotend || null, cooling: c || null, gantryKind: h.gantry ? h.gantry.kind : 'wheels' };
  }

  function buildReal(head, poses) {
    const plan = planReal(head, poses);
    if (!plan) return null;
    const materials = new Map();
    const group = new THREE.Group();
    const parts = {};
    const T = tools(group, parts, materials);
    const B = plan.base.box;
    // Each file stands as a see-through box until its STL is in
    for (const it of plan.items) {
      const key = T.part(it.key, { label: it.label, files: it.files });
      const b = it.box;
      const ghost = T.box(b[3] - b[0], b[4] - b[1], b[5] - b[2], 'ghost', (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, key);
      ghost.userData.placeholder = it.id;
      ghost.castShadow = false;
    }
    // The hotend: nozzle, heater block (tall for a Volcano), heat break, the heat sink in the base
    const n = plan.nozzle;
    const height = plan.hotend ? plan.hotend.height : 'standard';
    const block = height === 'tall' ? 20 : 11.5;
    T.cyl(0.6, 3.2, 3, 'brass', 0, n + 1.5, 0);
    T.cyl(4.6, 4.6, 2.2, 'brass', 0, n + 4, 0, null, null, 6);
    T.box(20, block, 16, 'block', 4, n + 5 + block / 2, 0);
    const breakLen = Math.max(2, plan.base.bottom - (n + 5 + block));
    T.cyl(1.6, 1.6, breakLen, 'metal', 0, n + 5 + block + breakLen / 2, 0);
    T.cyl(11, 11, 26, 'metal', 0, plan.base.bottom + 15, 0);
    // A duct the poses could not place: its outline from the model, by the base
    if (plan.ductsMissing && plan.cooling) {
      const key = T.part(`duct-${plan.cooling.files.front.length ? 'front' : plan.cooling.side}`, { label: plan.cooling.label, files: [...plan.cooling.files.left, ...plan.cooling.files.right, ...plan.cooling.files.front] });
      const half = (B[3] - B[0]) / 2;
      for (const s of [-1, 1]) T.prism([[half, n + 19], [half + 5, n + 17], [13, n + 1.6], [7, n + 1.6], [7, n + 6.5], [half - 2, n + 15]].map(([px, py]) => [s * px, py]), 22, 'printed', 0, 0, 0, key);
      T.box(B[3] - B[0] + 8, 10, 10, 'printed', 0, n + 14, B[5] + 4, key);
    }
    // The extruder and its stepper on the stack (front or rear); Bowden: coupler and PTFE tube.
    // A standing motor plate holds the stepper on its far side (its boss in the plate's round
    // opening, or else the middle of a tall plate's top) and the extruder on the hotend's side
    const top = plan.stackTop;
    const mount = plan.items.find(it => it.key === 'extruder');
    const tall = mount && !mount.pose.motor && mount.box[4] - mount.box[1] > 20;
    const plate = mount && (mount.pose.motor
      ? { p: [mount.pose.motor.p[0], mount.pose.motor.p[1] + mount.dy, mount.pose.motor.p[2]], n: mount.pose.motor.n }
      : tall ? { p: [(mount.box[0] + mount.box[3]) / 2, mount.box[4] - 21, plan.extruder.rear ? mount.box[2] + 2 : mount.box[5] - 2], n: [0, 0, plan.extruder.rear ? -1 : 1] } : null);
    if (plan.extruder && plate) {
      const { p, n } = plate;
      const along = (d) => [p[0] + n[0] * d, p[1], p[2] + n[2] * d];
      const size = (thick, face) => (n[0] ? [thick, face, face] : [face, face, thick]);
      const len = plan.extruder.small ? 23 : 34;
      const thick = plan.extruder.small ? 20 : 28;
      const sm = along(3 + len / 2);
      T.box(...size(len, 42), 'stepper', sm[0], sm[1], sm[2]);
      const band = along(3 + len - 6);
      T.box(...size(3, 42.6), 'band', band[0], band[1], band[2]);
      const body = along(-3 - thick / 2);
      T.box(...size(thick, 42), 'black', body[0], body[1], body[2]);
      T.cyl(2, 2, 12, 'ptfe', 0, p[1] + 27, 0);
    } else if (plan.extruder) {
      const e = plan.extruder;
      const body = e.small ? [28, 26, 30] : [34, 30, 36];
      const motor = e.small ? [22, 36, 36] : [34, 42, 42];
      const dx = e.mirror ? -5 : 5;
      T.box(body[0], body[1], body[2], 'black', dx, top + body[1] / 2, 0);
      const mz = (e.rear ? -1 : 1) * (body[2] / 2 + motor[2] / 2 - 4);
      T.box(motor[0], motor[1], motor[2], 'stepper', dx, top + motor[1] / 2, mz);
      T.box(motor[0] + 0.6, 3, motor[2] + 0.6, 'band', dx, top + motor[1] - 6, mz);
      T.cyl(2, 2, 12, 'ptfe', dx, top + body[1] + 6, 0);
    } else if (plan.hotend) {
      T.cyl(4, 4, 8, 'metal', 0, top + 4, 0);
      T.cyl(2, 2, 50, 'ptfe', 0, top + 33, 0);
    }
    // The ABL sensor under its mount (a Beacon3D in front, under the skirt)
    const sn = plan.sensor;
    if (sn) {
      const b = sn.box;
      const sx = sn.side === 'right' ? b[3] - 7 : b[0] + 7;
      const sz = (b[2] + b[5]) / 2;
      if (sn.under || sn.family === 'beacon') {
        T.box(30, 4, 20, 'black', sn.under ? 0 : sx, n + 4.3, sn.under ? 30.6 : sz);
      } else if (['bltouch', 'crtouch'].includes(sn.family)) {
        const colour = sn.family === 'crtouch' ? 'black' : 'sensor';
        T.box(13, 36, 11.5, colour, sx, n + 8 + 18, sz);
        T.box(26, 2, 11.5, colour, sx, n + 8 + 36, sz);
        T.cyl(1, 1, 4, 'metal', sx, n + 6, sz);
      } else if (['euclid', 'touchmi'].includes(sn.family)) {
        T.box(14, 40, 14, 'black', sx, n + 22, sz);
      } else {
        const d = sn.size || 18;
        const len = Math.max(20, Math.min(SENSOR_LENGTH[d] || 48, b[4] - n));
        T.cyl(d / 2, d / 2, len, 'metal', sx, n + 2 + len / 2, sz);
      }
    }
    // The ADXL345 board on the open ends of its mount's inserts (poses: board, in the mount's
    // own frame); without them standing in front of a vertical mount, lying on a horizontal one
    if (plan.adxl) {
      const it = plan.adxl;
      const bd = it.pose.board;
      const b = it.box;
      if (bd) {
        const m = it.m;
        const turn = (q) => [m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[3] * q[0] + m[4] * q[1] + m[5] * q[2], m[6] * q[0] + m[7] * q[1] + m[8] * q[2]];
        const n = turn(bd.n);
        const c = turn(bd.p).map((v, k) => v + [it.t[0], it.t[1] + it.dy, it.t[2]][k] + n[k] * 0.8);
        const size = Math.abs(n[0]) > 0.5 ? [1.6, 15, 20] : Math.abs(n[1]) > 0.5 ? [20, 1.6, 15] : [20, 15, 1.6];
        T.box(...size, 'pcb', c[0], c[1], c[2]);
      } else if (head.adxl && head.adxl.vertical) T.box(20, 15, 1.6, 'pcb', (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5] + 1);
      else T.box(20, 1.6, 15, 'pcb', (b[0] + b[3]) / 2, b[4] + 0.8, (b[2] + b[5]) / 2);
    }
    // The printer's X carriage behind the adapter
    T.carriage(plan.gantryKind, (B[1] + B[4]) / 2, plan.back);
    // The nozzle on the bed
    group.position.y = -n;
    const box = new THREE.Box3().setFromObject(group);
    const sizeOf = { width: box.max.x - box.min.x, height: box.max.y - Math.max(0, box.min.y), depth: box.max.z - box.min.z };
    return { group, parts, materials, size: sizeOf, mat: T.mat, plan };
  }

  function disposeGroup(model) {
    if (!model) return;
    // Loaded STLs are shared with the next printhead (the page's cache keeps them)
    model.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    for (const m of model.materials.values()) m.dispose();
  }

  // opts: { background (number), onHover(key | null, part), onClick(key, part), poses (the
  // parsed hero-me-gen7-poses.json: the real parts), load(url) -> Promise<BufferGeometry> }.
  // Returns null without WebGL.
  function mount(container, head, opts = {}) {
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
    const camera = new THREE.PerspectiveCamera(32, width() / height(), 1, 5000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a909c, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.72);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    scene.add(fill);
    // The bed under the nozzle
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.24 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI * 0.495;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    let model = null;
    let hovered = null;
    let lit = null;
    let fitted = false;
    let poses = opts.poses || null;
    let shown = null;
    let generation = 0;
    const highlightMat = new THREE.MeshStandardMaterial({ color: COLORS.highlight, roughness: 0.6, metalness: 0.04 });

    // Camera from the front right, a little above
    function fit(size) {
      const center = new THREE.Vector3(0, size.height / 2, -8);
      const radius = Math.sqrt(size.width * size.width + size.height * size.height + size.depth * size.depth) / 2;
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 0.8;
      const dir = new THREE.Vector3(0.62, 0.36, 1).normalize();
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.near = dist / 50;
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = radius * 0.5;
      controls.maxDistance = dist * 4;
      controls.update();
    }

    function update(next) {
      if (model) { scene.remove(model.group); disposeGroup(model); }
      shown = next;
      model = (poses && buildReal(next, poses)) || build(next);
      scene.add(model.group);
      model.group.traverse(m => { if (m.isMesh) m.userData.baseMaterial = m.material; });
      const s = model.size;
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
      if (!fitted) { fit(s); fitted = true; }
      hovered = null;
      paint(lit);
      if (model.plan) loadParts(model, ++generation);
    }

    // The real STLs, one by one in place of their see-through boxes; a newer printhead stops
    // the older one's loading
    function loadParts(m, gen) {
      m.pending = [];
      if (!opts.load) return;
      for (const it of m.plan.items) {
        if (!it.url) continue;
        m.pending.push(opts.load(it.url).then((geometry) => {
          if (gen !== generation || model !== m || !geometry) return;
          const mesh = new THREE.Mesh(geometry, m.mat('printed'));
          mesh.matrixAutoUpdate = false;
          const a = it.m;
          mesh.matrix.set(a[0], a[1], a[2], it.t[0], a[3], a[4], a[5], it.t[1] + it.dy, a[6], a[7], a[8], it.t[2], 0, 0, 0, 1);
          mesh.matrixWorldNeedsUpdate = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          Object.assign(mesh.userData, { part: it.key, shared: true, baseMaterial: mesh.material });
          const entry = m.parts[it.key];
          for (const g of m.group.children.filter(o => o.userData.placeholder === it.id)) {
            m.group.remove(g);
            g.geometry.dispose();
            if (entry) entry.meshes = entry.meshes.filter(x => x !== g);
          }
          m.group.add(mesh);
          if (entry) entry.meshes.push(mesh);
          paint(lit);
        }).catch(() => {}));
      }
    }

    // One part lit (its meshes in the highlight colour), by its key
    function paint(key) {
      lit = key && model && model.parts[key] ? key : null;
      if (!model) return;
      model.group.traverse(m => {
        if (!m.isMesh) return;
        m.material = lit && m.userData.part === lit ? highlightMat : m.userData.baseMaterial || m.material;
      });
      render();
    }
    const keyOfFile = (fileId) => {
      if (!model || fileId === null || fileId === undefined) return null;
      return Object.keys(model.parts).find(k => model.parts[k].files.includes(Number(fileId))) || null;
    };

    // Hover lights a part and tells the page (its rows in the list); a click (a press without
    // a drag) opens it
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = model && raycaster.intersectObject(model.group, true).find(x => x.object.userData.part);
      return hit ? hit.object.userData.part : null;
    };
    let frame = 0;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const key = pick(e);
        renderer.domElement.style.cursor = key ? 'pointer' : '';
        if (key === hovered) return;
        hovered = key;
        paint(key);
        if (opts.onHover) opts.onHover(key, key ? model.parts[key] : null);
      });
    };
    const onLeave = () => {
      if (hovered !== null) { paint(null); if (opts.onHover) opts.onHover(null, null); }
      hovered = null;
    };
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const key = pick(e);
      if (key && opts.onClick) opts.onClick(key, model.parts[key]);
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

    update(head);

    return {
      container,
      canvas: renderer.domElement,
      update,
      // The real parts' places arrive after the printhead is shown
      setPoses(next) { poses = next; fitted = false; if (shown) update(shown); },
      // The parts the real printhead left out (no place for them)
      missing: () => (model && model.plan ? model.plan.missing : []),
      // Settles when the shown printhead's STLs are in (a cover waits for them)
      loaded: () => Promise.all((model && model.pending) || []),
      real: () => Boolean(model && model.plan),
      // The part a row of the list belongs to (null: none)
      highlightFile(fileId) { paint(keyOfFile(fileId)); },
      highlight: paint,
      // For Viewer.takeSnapshot (a cover)
      snapshotParts: () => ({ renderer, scene, camera }),
      setBackground(color) { scene.background.set(color); render(); },
      reset() { if (model) { fit(model.size); render(); } },
      dispose() {
        if (frame) cancelAnimationFrame(frame);
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

  return { build, buildReal, planReal, mount, COLORS };
})();
