/* ─── USSA VAULT kit: the tower in 3D ──────────────────────────────────────
 * A model of a configuration (VaultKit config) built from simple shapes in real sizes
 * (millimetres, measured on the archive's STLs): modules, facades with keys or locks, roofs,
 * base, wheels or casters, backbone, pegboards, handles and wall mounts. The archive's own STLs
 * are far too heavy to assemble in a browser (a tower is gigabytes).
 *
 * build(cfg) makes a THREE.Group (no DOM, the tests run it in Node); mount() puts it in a
 * container with orbit controls and returns a handle the configurator updates and disposes.
 * The scene renders on demand (camera moves, hover, updates), never in a loop.
 */
globalThis.VaultKit3D = (function () {
  const MM = { S: 165, M: 254, L: 330, XL: 419 };
  const F = { '1F': 1, '2F': 2, '4F': 4 };
  const P = 48; // mm per F
  // Light grey PLA with orange latches, like the renders in the manual
  const COLORS = {
    module: 0xd9dce1, facade: 0xf2f3f5, sustainer: 0xe7e9ec, dark: 0x2d3036, orange: 0xf06a24, roof: 0xcfd3d9,
    base: 0xc5cad1, tyre: 0x26282d, disk: 0xb4bac3, wood: 0xa8774a, wall: 0xdfe2e6, peg: 0xe9ebee, highlight: 0x9fdcf2
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
    const floorMeshes = [];
    const place = (geometry, color, x, y, z, fi, kind) => {
      const mesh = new THREE.Mesh(geometry, mat(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (fi !== undefined) {
        mesh.userData.fi = fi;
        mesh.userData.kind = kind || '';
        (floorMeshes[fi] = floorMeshes[fi] || []).push(mesh);
      }
      group.add(mesh);
      return mesh;
    };
    const box = (w, h, d, color, x, y, z, r = 0, fi, kind) => place(r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), color, x, y, z, fi, kind);
    // A cylinder along the x axis (wheels) or the z axis (keys) or upright (rods)
    const cylinder = (radius, length, color, x, y, z, axis, fi) => {
      const g = new THREE.CylinderGeometry(radius, radius, length, 28);
      if (axis === 'x') g.rotateZ(Math.PI / 2);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      return place(g, color, x, y, z, fi);
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

    // The floors, bottom to top
    let y = lift + baseH;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      const layout = layoutOf(floor);
      if (!layout) return;
      const slots = VaultKit.slotsOf(layout);
      let mx = -W / 2;
      layout.modules.forEach((mod, mi) => {
        const mw = MM[mod.w];
        box(mw - 3, h - 2, D, 'module', mx + mw / 2, y + h / 2, 0, 7, fi, 'module');
        // Orange latch marks on the outer sides, one per F near the front
        for (let k = 0; k < (F[floor.height] || 1); k++) {
          if (mi === 0) box(2, 6, 20, 'orange', mx - 0.5, y + 24 + k * P, front - 34, 0, fi);
          if (mi === layout.modules.length - 1) box(2, 6, 20, 'orange', mx + mw - 2.5, y + 24 + k * P, front - 34, 0, fi);
        }
        let cx = mx;
        slots.forEach((s, si) => {
          if (s.mi !== mi) return;
          const cw = MM[s.w];
          const slot = floor.slots[si] || {};
          if (cx > mx) box(3, h - 8, 6, 'dark', cx, y + h / 2, front + 1, 0, fi); // the middle wall of L² / XL²
          if (slot.type === 'sustainer') {
            box(cw - 10, h - 8, 8, 'sustainer', cx + cw / 2, y + h / 2, front + 4, 4, fi, 'facade');
            box(cw - 14, 2, 2, 'dark', cx + cw / 2, y + h - 16, front + 8.5, 0, fi); // lid edge
            for (const at of [0.22, 0.78]) box(26, 16, 14, 'dark', cx + cw * at, y + h - 15, front + 9, 3, fi);
          } else {
            let top = y + h;
            for (const bh of String(slot.boxes || floor.height).split('+')) {
              const bH = (F[bh] || 1) * P;
              const cy = top - bH / 2;
              box(cw - 10, bH - 6, 8, 'facade', cx + cw / 2, cy, front + 4, 4, fi, 'facade');
              cylinder(10, 10, 'dark', cx + cw - 30, cy, front + 11, 'z', fi);
              box(34, 10, 2, 'roof', cx + 32, cy, front + 8.5, 2, fi);
              top -= bH;
            }
          }
          cx += cw;
        });
        mx += mw;
      });
      y += h;
    });
    const topY = y;

    // The roof on the drawer modules of the top floor (sustainers have their own lids)
    const top = floors[floors.length - 1];
    const kind = cfg.roof && cfg.roof !== 'none' ? cfg.roof : null;
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
            box(mw - 4, 10, D - 4, 'roof', cx, topY + 5, 0, 4);
            for (let gx = mx + 42; gx < mx + mw - 10; gx += 42) box(2, 3, D - 12, 'module', gx, topY + 11.5, 0);
            for (let gz = back + 42; gz < front - 10; gz += 42) box(mw - 12, 3, 2, 'module', cx, topY + 11.5, gz);
            box(Math.min(120, mw * 0.6), 26, 34, 'dark', cx, topY + 10 + 13, 0, 10);
            roofTop = Math.max(roofTop, topY + 36);
          }
          if (kind === 'table') { box(mw + 4, 8, D + 4, 'roof', cx, topY + 4, 0, 4); roofTop = Math.max(roofTop, topY + 8); }
          if (kind === 'bowl') {
            box(mw - 4, 6, D - 4, 'roof', cx, topY + 3, 0, 4);
            box(mw - 4, 18, 5, 'roof', cx, topY + 15, front - 4.5); box(mw - 4, 18, 5, 'roof', cx, topY + 15, back + 4.5);
            box(5, 18, D - 14, 'roof', mx + 4.5, topY + 15, 0); box(5, 18, D - 14, 'roof', mx + mw - 4.5, topY + 15, 0);
            roofTop = Math.max(roofTop, topY + 24);
          }
          if (kind === 'heavy') {
            box(mw - 4, 8, D - 4, 'roof', cx, topY + 4, 0, 4);
            for (const side of [-1, 1]) box(mw * 0.3, 54, D - 12, 'roof', cx + side * (mw * 0.35 - 4), topY + 8 + 27, 0, 6);
            cylinder(9, mw * 0.4, 'dark', cx, topY + 44, 0, 'x');
            roofTop = Math.max(roofTop, topY + 62);
          }
          if (kind === 'undertable') { box(mw + 20, 8, D + 20, 'roof', cx, topY + 4, 0, 3); roofTop = Math.max(roofTop, topY + 8); }
        }
        mx += mw;
      });
      if (kind === 'undertable') { box(W + 260, 22, D + 240, 'wood', 0, topY + 8 + 11, -20, 4); roofTop = topY + 30; }
    }

    // Along the back: backbone boards (two per 4F floor), pegboards, wall mounts, handles
    let by = lift + baseH;
    let backZ = back;
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      if (hasBackbone) {
        let uy = by;
        for (const uh of floor.height === '4F' ? [h / 2, h / 2] : [h]) {
          if (mods.backbone === 'universal') for (const side of [-1, 1]) box(70, uh - 4, 14, 'dark', side * (W / 2 - 37), uy + uh / 2, back - 7, 3, fi);
          else box(W - 6, uh - 4, 14, 'dark', 0, uy + uh / 2, back - 7, 3, fi);
          uy += uh;
        }
        if (mods.pegboard && mods.pegboard !== 'none') {
          box(W - 24, h - 12, 6, 'peg', 0, by + h / 2, back - 17, 2, fi);
          for (let k = 1; k < (F[floor.height] || 1) * 2; k++) box(W - 60, 3, 2, 'dark', 0, by + k * (P / 2), back - 20.5, 0, fi);
        }
      }
      if (mods.wallMount) {
        const z = back - (hasBackbone ? 14 : 0) - 5;
        let mx = -W / 2;
        layoutOf(floor).modules.forEach(mod => { box(MM[mod.w] - 8, h - 6, 10, 'base', mx + MM[mod.w] / 2, by + h / 2, z, 3, fi); mx += MM[mod.w]; });
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
      for (const side of [-1, 1]) cylinder(8, rodTop - (lift + baseH), 'disk', side * (W / 2 - 42), (rodTop + lift + baseH) / 2, backZ - 14, null);
      box(W - 40, 22, 30, 'dark', 0, rodTop + 11, backZ - 14, 8);
    }
    if (hasBackbone && top && mods.stationaryHandle) {
      const th = (F[top.height] || 1) * P;
      const hy = topY - th / 2;
      box(W * 0.5, 18, 18, 'dark', 0, hy, backZ - 44, 6);
      for (const side of [-1, 1]) box(18, 18, 40, 'dark', side * (W * 0.25 - 9), hy, backZ - 22, 4);
    }

    const size = { width: W, depth: D, height: Math.max(roofTop, topY) };
    return { group, floorMeshes, materials, size };
  }

  function disposeGroup(model) {
    if (!model) return;
    model.group.traverse(c => { if (c.geometry) c.geometry.dispose(); });
    for (const m of model.materials.values()) m.dispose();
  }

  // opts: { background (number), onHover(fi | null), onClick(fi) }. Returns null without WebGL.
  function mount(container, cfg, opts = {}) {
    if (typeof THREE === 'undefined' || !THREE.OrbitControls) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
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
      controls.minDistance = radius * 0.6;
      controls.maxDistance = dist * 4;
      controls.update();
    }

    function update(next) {
      if (model) { scene.remove(model.group); disposeGroup(model); }
      model = build(next);
      scene.add(model.group);
      const s = model.size;
      // Lights and the ground follow the tower; the camera only when its size changed a lot
      const span = Math.max(s.width, s.depth, s.height);
      sun.position.set(span * 0.9, span * 2.2, span * 1.6);
      sun.target.position.set(0, s.height / 3, 0);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -span * 1.2;
      sc.right = sc.top = span * 1.2;
      sc.near = span * 0.2;
      sc.far = span * 6;
      sc.updateProjectionMatrix();
      fill.position.set(-span * 1.5, span * 0.8, span * 0.6);
      ground.scale.set(span * 6, span * 6, 1);
      const changed = !fitted || Math.abs(s.height - fitted.height) > fitted.height * 0.25 || s.width !== fitted.width || s.depth !== fitted.depth;
      if (changed) { fit(s); fitted = s; }
      hovered = null;
      render();
    }

    function highlight(fi) {
      if (!model) return;
      model.floorMeshes.forEach((meshes, i) => (meshes || []).forEach(m => {
        if (m.userData.kind !== 'module') return;
        m.material = i === fi ? highlightMat : m.userData.baseMaterial || m.material;
      }));
      render();
    }

    // Hover and click on a floor (a click is a press without a drag)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = model && raycaster.intersectObjects(model.group.children, false).find(h => h.object.userData.fi !== undefined);
      return hit ? hit.object.userData.fi : null;
    };
    let frame = 0;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const fi = pick(e);
        if (fi === hovered) return;
        hovered = fi;
        renderer.domElement.style.cursor = fi === null ? '' : 'pointer';
        if (opts.onHover) opts.onHover(fi);
      });
    };
    const onLeave = () => { if (hovered !== null && opts.onHover) opts.onHover(null); hovered = null; };
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const fi = pick(e);
      if (fi !== null && opts.onClick) opts.onClick(fi);
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
    model.floorMeshes.forEach(meshes => (meshes || []).forEach(m => { m.userData.baseMaterial = m.material; }));
    const keepBase = () => model.floorMeshes.forEach(meshes => (meshes || []).forEach(m => { if (!m.userData.baseMaterial) m.userData.baseMaterial = m.material; }));

    return {
      container,
      canvas: renderer.domElement,
      update(next) { update(next); keepBase(); },
      highlight,
      setBackground(color) { scene.background.set(color); render(); },
      // Back to the first view of the tower
      reset() { if (model) { fit(model.size); fitted = model.size; render(); } },
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

  return { build, mount, COLORS };
})();
