/**
 * 3DLib Automated Pre-Release Test Suite
 * Run via: npm test (or node tests/release-check.js)
 *
 * Covers:
 *  1. JS syntax & accidental duplicate template literal check (Issue #72 guard)
 *  2. Frontend UI.* component rendering smoke test with realistic data
 *  3. Frontend button/handler integrity (every onclick/onsubmit/onchange App.* & API.* exists)
 *  4. Live E2E API & Security tests against an isolated temporary database & library:
 *     - Health check (/healthz)
 *     - Auth & RBAC (Admin vs Viewer vs Unauthenticated)
 *     - Model creation & 3D file upload
 *     - Tagging, Category assignment (single & bulk), Collection assignment
 *     - Collection editing (name, description, visibility)
 *     - Unauthorized model/collection deletion blocked (Unauthenticated=401, Viewer=403, No-CSRF=403)
 *     - Authorized model deletion (single & bulk)
 *     - Settings toggle persistence (Issue #70 guard)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { spawn, execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}

function fail(name, err) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  failures.push({ name, msg });
  console.error(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m→ ${msg}\x1b[0m`);
}

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ─── 1. STATIC SYNTAX & TEMPLATE LITERAL CHECKS ─────────────────────────────

function getJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      out.push(...getJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

async function runStaticAndUiChecks() {
  console.log('\n\x1b[1m[1/2] Frontend, Buttons & Static Integrity Checks\x1b[0m');

  const jsFiles = [
    ...getJsFiles(path.join(ROOT_DIR, 'server')),
    ...getJsFiles(path.join(ROOT_DIR, 'public', 'js'))
  ];

  await check(`All ${jsFiles.length} server & frontend JS files pass syntax check (node -c)`, () => {
    for (const f of jsFiles) {
      const stat = fs.statSync(f);
      assert(stat.size > 0, `File is empty (0 bytes): ${path.relative(ROOT_DIR, f)}`);
      execFileSync(process.execPath, ['-c', f], { stdio: 'pipe' });
    }
  });

  await check('No accidental back-to-back template literals (`...` `...`) in JS files (Issue #72 guard)', () => {
    for (const f of jsFiles) {
      const content = fs.readFileSync(f, 'utf8');
      const match = /`\s*\r?\n\s*`/.exec(content);
      if (match) {
        const line = content.substring(0, match.index).split('\n').length;
        throw new Error(`Back-to-back template literal found in ${path.relative(ROOT_DIR, f)}:${line}`);
      }
    }
  });

  await check('Static AST scope & undeclared identifier scanner across all server & client JS files (Issue #81 guard)', () => {
    const { checkAllScopes } = require('./ast-scope-checker');
    checkAllScopes(ROOT_DIR);
  });

  // Load API, UI, and App into a browser-like sandbox
  const sandbox = {
    window: { location: { hash: '', origin: 'http://localhost:3000', pathname: '/' }, addEventListener: () => {} },
    document: {
      getElementById: () => ({ innerHTML: '', textContent: '', style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
      body: { appendChild: () => {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, style: {} },
      addEventListener: () => {}
    },
    localStorage: {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    location: { hash: '', reload: () => {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    FormData: class {},
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;

  const apiCode = fs.readFileSync(path.join(ROOT_DIR, 'public/js/api.js'), 'utf8');
  const compCode = fs.readFileSync(path.join(ROOT_DIR, 'public/js/components.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app.js'), 'utf8');
  const kitCode = fs.readFileSync(path.join(ROOT_DIR, 'public/js/kits/ussa-vault.js'), 'utf8');

  vm.createContext(sandbox);
  vm.runInContext(`${kitCode}\n${apiCode}\n${compCode}\n${appCode}\nthis.__API = API; this.__UI = UI; this.__App = App;`, sandbox);

  const { __API: API, __UI: UI, __App: App } = sandbox;
  App.currentUser = { id: 1, username: 'admin', email: 'admin@example.com', role: 'admin' };
  App.selectedModelIds = [1];
  App.selectedBrowsePaths = ['folderA/test.stl'];
  App.currentFormatFilter = 'all';

  const mockCategories = [{ id: 1, name: 'Functional', color: '#00d4ff', model_count: 5 }];
  const mockTags = [{ id: 1, name: 'gridfinity', model_count: 3 }];
  const mockUsers = [{ id: 1, username: 'admin', email: 'admin@example.com', role: 'admin', model_count: 5 }];
  const mockProjects = [{ id: 1, name: 'Voron Build', description: 'Printer parts', visibility: 'public', user_id: 1, model_count: 2, thumbnails: [] }];
  const mockModel = {
    id: 1,
    name: 'Voron Stealthburner',
    description: '# Stealthburner\nPrint in ABS.',
    category_id: 1,
    category_name: 'Functional',
    category_color: '#00d4ff',
    user_id: 1,
    uploader_name: 'admin',
    file_count: 2,
    file_types: ['stl', '3mf', 'step', 'gcode'],
    has_printed: true,
    print_count: 1,
    thumbnail: '/uploads/thumb.png',
    stl_file: '/uploads/part.stl',
    updated_at: '2026-09-27 12:00:00',
    created_at: '2026-09-27 12:00:00',
    tags: mockTags,
    projects: mockProjects,
    versions: [],
    files: [
      { id: 10, model_id: 1, filename: 'main_body.stl', original_name: 'main_body.stl', file_type: 'stl', file_size: 102400, url: '/uploads/main_body.stl', is_preview: true },
      { id: 11, model_id: 1, filename: 'plate.gcode', original_name: 'plate.gcode', file_type: 'gcode', file_size: 204800, url: '/uploads/plate.gcode', metadata: JSON.stringify({ printTime: '2h 15m', filamentType: 'PLA', weight: 42 }) }
    ],
    prints: [{ id: 1, material_name: 'PLA', success: 1, notes: 'Clean print', printed_at: '2026-09-27' }]
  };

  await check('All UI.* template functions render without runtime errors on populated data', () => {
    const renders = [
      ['UI.modelCard', () => UI.modelCard(mockModel)],
      ['UI.toolbar', () => UI.toolbar(mockCategories, mockTags, mockUsers, 'all')],
      ['UI.modelDetail', () => UI.modelDetail(mockModel, true)],
      ['UI.projectsPage', () => UI.projectsPage(mockProjects)],
      ['UI.projectCard', () => UI.projectCard(mockProjects[0])],
      ['UI.projectDetail', () => UI.projectDetail({ ...mockProjects[0], models: [mockModel] })],
      ['UI.folderCard', () => UI.folderCard({ name: 'Subfolder', path: 'Subfolder', itemCount: 4, thumbnails: ['/uploads/a.png', '/uploads/b.png'] })],
      ['UI.browseFileCard', () => UI.browseFileCard({ name: 'part.stl', type: 'stl', ext: 'stl', size: 50000, url: '/library-files/part.stl', folderPath: 'Subfolder', metadata: { printTime: '1h', filamentType: 'PETG', tempNozzle: 240 } })],
      ['UI.bulkActionBar', () => UI.bulkActionBar(2)],
      ['UI.bulkBrowseActionBar', () => UI.bulkBrowseActionBar(2, false)],
      ['UI.bulkTagForm', () => UI.bulkTagForm(mockTags)],
      ['UI.bulkMoveForm', () => UI.bulkMoveForm(mockCategories, 2)],
      ['UI.bulkBrowseCategoryForm', () => UI.bulkBrowseCategoryForm(mockCategories, 2)],
      ['UI.bulkCollectionForm', () => UI.bulkCollectionForm(mockProjects)],
      ['UI.collectionSelectForm', () => UI.collectionSelectForm(mockProjects, [1], 1)],
      ['UI.bulkDeleteForm', () => UI.bulkDeleteForm(2)],
      ['UI.bulkBrowseDeleteForm', () => UI.bulkBrowseDeleteForm(2)],
      ['UI.modelForm', () => UI.modelForm(mockModel, mockCategories, mockTags)],
      ['UI.projectForm', () => UI.projectForm(mockProjects[0])],
      ['UI.systemSettingsForm', () => UI.systemSettingsForm({ scan_zip_archives: 'true', default_view_mode: 'grid' })],
      ['UI.securitySettingsForm', () => UI.securitySettingsForm({ private_instance: 'false', open_registration: 'false' })],
      ['UI.maintenanceSettingsForm', () => UI.maintenanceSettingsForm()],
      ['UI.pagination', () => UI.pagination(5, 2)],
      ['UI.modelDetail (folder project with Trash)', () => UI.modelDetail({
        ...mockModel, layout: 'folder', folders: ['Parts', 'Empty'], trash_retention_days: 30,
        files: [...mockModel.files, { id: 12, model_id: 1, filename: 'arm.stl', original_name: 'Parts/arm.stl', file_type: 'stl', file_size: 10, library_path: '/library/Voron/Parts/arm.stl', url: '/library-files/Voron/Parts/arm.stl' }],
        trash_files: [{ id: 13, model_id: 1, filename: 'old.stl', original_name: 'Parts/old.stl', file_type: 'stl', file_size: 10, deleted_at: '2026-10-01 10:00:00', url: '/library-files/Voron/Parts/old.stl' }]
      })],
      ['UI.modelDetail (model in the Trash)', () => UI.modelDetail({ ...mockModel, deleted_at: '2026-10-01 10:00:00', trash_retention_days: 30 })],
      ['UI.trashPage', () => UI.trashPage({ retention_days: 30,
        models: [{ id: 2, name: 'Old <b>model</b>', file_count: 3, total_size: 1000, deleted_at: '2026-10-01 10:00:00', thumbnail_url: null }],
        files: [{ id: 5, model_id: 1, model_name: 'Voron', original_name: 'Parts/old.stl', file_type: 'stl', file_size: 10, deleted_at: '2026-10-01 10:00:00' }] })],
      ['UI.trashPage (empty)', () => UI.trashPage({ retention_days: 30, models: [], files: [] })],
      ['UI.entryNameForm', () => UI.entryNameForm({ label: 'File name', value: 'a "b".stl', submitLabel: 'Rename' })],
      ['UI.entryMoveForm', () => UI.entryMoveForm('arm.stl', ['', 'Parts', 'Spare'], 'Parts')],
      ['UI.deleteEntryForm', () => UI.deleteEntryForm('Parts', true)],
      ['UI.fileHistoryModal', () => UI.fileHistoryModal({ id: 10, original_name: 'Parts/gear.3mf', file_type: '3mf' },
        [{ id: 1, file_size: 100, source: 'slicer', created_at: '2026-10-14 10:00:00', url: '/api/files/10/versions/1/file' }], true)],
      ['UI.slicerSavesPage', () => UI.slicerSavesPage({ quiet_minutes: 5, cleanup_days: 7, now: Date.now(), saves: [
        { id: 1, name: 'gear_3dl-abcdefgh.3mf', clean_name: 'gear.3mf', status: 'pending', file_size: 10, mtime_ms: Date.now(), model_id: 1, model_name: 'Box', file_name: 'gear.3mf' },
        { id: 2, name: 'Mystery_part.3mf', clean_name: 'Mystery part.3mf', status: 'unmatched', file_size: 10, mtime_ms: Date.now() },
        { id: 3, name: 'x.3mf', clean_name: 'x.3mf', status: 'imported', file_size: 10, mtime_ms: Date.now(), message: 'New version of x.3mf', imported_model_id: 1, imported_model_name: 'Box', imported_name: 'x.3mf' },
        { id: 4, name: 'y.3mf', clean_name: 'y.3mf', status: 'error', file_size: 10, mtime_ms: Date.now(), message: 'Read-only' },
        { id: 5, name: 'z.stl', clean_name: 'z.stl', status: 'download', file_size: 10, mtime_ms: Date.now() },
        { id: 6, name: 'z_3dl-abcdefgh(2).3mf', clean_name: 'z.3mf', status: 'superseded', file_size: 10, mtime_ms: Date.now(), message: 'A newer save of this file is already in the library', model_id: 1, model_name: 'Box', file_name: 'z.3mf' }] })],
      ['UI.slicerSavesPage (empty)', () => UI.slicerSavesPage({ quiet_minutes: 5, cleanup_days: 7, now: Date.now(), saves: [] })],
      ['UI.slicerAssignForm', () => UI.slicerAssignForm({ id: 2, name: 'Mystery_part.3mf', clean_name: 'Mystery part.3mf' })],
      ['UI.aboutSection', () => UI.aboutSection('1.0.0')]
    ];

    for (const [label, fn] of renders) {
      const html = fn();
      assert(typeof html === 'string' && html.trim().length > 10, `${label} returned empty or non-string output`);
    }
  });

  await check('Names with quotes and HTML stay data in inline handlers (Folder Explorer, breadcrumbs, settings lists)', () => {
    const evil = `a'b"c<b>x</b>\\d');alert(1);('`;
    const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    // Runs every App.* handler of the HTML, as the browser would after decoding the attribute,
    // with a fake App that records the string arguments
    const handlerArgs = (html) => {
      const args = [];
      const fakeApp = new Proxy({}, { get: () => (...a) => { args.push(...a.filter(x => typeof x === 'string')); } });
      for (const m of html.matchAll(/\son[a-z]+="([^"]*)"/g)) {
        const code = decode(m[1]);
        if (!/\bApp\./.test(code)) continue;
        let fn;
        try { fn = new Function('App', 'event', code); } catch (e) { throw new Error(`Handler does not compile: ${code}`); }
        try { fn.call({ classList: { add() {}, remove() {} } }, fakeApp, { preventDefault() {}, stopPropagation() {} }); } catch (e) {}
      }
      return args;
    };
    const renders = {
      breadcrumbs: UI.breadcrumbs(`top/${evil}/leaf`),
      folderTree: UI.folderTree([{ name: evil, path: evil, children: [] }], ''),
      folderCard: UI.folderCard({ name: evil, path: evil, itemCount: 1, thumbnails: [] }),
      browseFileCard: UI.browseFileCard({ name: `${evil}.stl`, type: 'stl', ext: 'stl', size: 1, url: '/library-files/x.stl', folderPath: evil }),
      settingsPanel: UI.settingsPanel('Tags', [{ id: 1, name: evil, model_count: 0 }], 'tags')
    };
    for (const [label, html] of Object.entries(renders)) {
      assert(!html.includes('<b>x</b>'), `${label}: the name must be escaped`);
      const args = handlerArgs(html);
      assert(args.some(a => a.includes(evil)), `${label}: handlers must get the name unchanged, got ${JSON.stringify(args)}`);
    }
    const file = JSON.parse(decodeURIComponent(handlerArgs(renders.browseFileCard).find(a => a.startsWith('%7B'))));
    assert(file.name === `${evil}.stl`, 'The file card must hand over the whole file');
    assert(!/\son[a-z]+="[^"]*\.replace\(\/'\/g/.test(appCode + compCode), 'Handler arguments go through UI.jsArg, not a quote replace');
  });

  await check('VAULT configurator view renders: builder, parts list, view switch; library names are escaped', () => {
    const K = sandbox.VaultKit;
    const files = fs.readFileSync(path.join(__dirname, 'fixtures/ussa-vault-files.tsv'), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line, i) => { const [size, name] = line.split('\t'); return { id: i + 1, file_size: Number(size), original_name: name, file_type: /\.stl$/i.test(name) ? 'stl' : 'other' }; });
    files.push({ id: 999, file_size: 1, original_name: 'Extra/<img src=x onerror=alert(1)>.png', file_type: 'image' });
    const vault = { ...mockModel, name: 'VAULT_USSA', files };
    const cat = K.buildCatalog(files);
    const cfg = { ...K.defaultConfig(), floors: [...K.defaultConfig().floors, { height: '2F', layout: 'S+S', slots: [{ type: 'sustainer', interior: 'dividers' }, { type: 'drawer', boxes: '1F+1F', interior: 'gridfinity' }] }],
      mods: { base: 'wheels', feet: true, backbone: 'wide', pullHandle: true, pegboard: 'ikea', wallMount: true }, qty: { 'd:latch': 9 }, extra: { 'path:Extra/<img src=x onerror=alert(1)>.png': 1 } };
    const bom = K.computeBom(cat, cfg);
    const state = { modelId: 1, cat, cfg: bom.cfg, bom, choices: K.choices(cat, bom.cfg), saved: [{ id: 7, name: '<b>Garage</b>', config: bom.cfg }], savedId: 7, previewId: null, loggedIn: true, dirty: true };
    const builder = UI.kitBuilder(state);
    const parts = UI.kitParts(state);
    const page = UI.modelDetail(vault, false, { kit: 'ussa-vault', view: 'configure' });
    const filesView = UI.modelDetail(vault, false, { kit: 'ussa-vault', view: 'files' });
    assert(builder.includes('Floor 4') && builder.includes('App.kitSlot(3, 1') && builder.includes('kit-tower'), 'The builder must list every floor with its slots');
    assert(!builder.includes('<b>Garage</b>') && builder.includes('&lt;b&gt;Garage&lt;/b&gt;'), 'Saved configuration names must be escaped');
    const latch = bom.parts.find(p => p.key === 'd:latch');
    assert(latch.qty === 9 && latch.auto === 5, `Latches: 9 by hand, 5 computed, got ${latch.qty} / ${latch.auto}`);
    assert(parts.includes('Hardware to buy') && parts.includes('↺ 5') && parts.includes('estimate'), 'The list must show hardware, hand-changed counts and estimates');
    assert(!parts.includes('<img src=x') && !page.includes('<img src=x'), 'File names from the library must be escaped');
    const downloads = parts.match(/href="\/api\/files\/\d+\/download"/g) || [];
    assert(downloads.length === bom.parts.length + cat.docs.length && parts.includes('href="/api/files/999/download"'), `Every listed file and instruction PDF downloads on its own, got ${downloads.length} links for ${bom.parts.length} files and ${cat.docs.length} PDFs`);
    assert(parts.includes('App.kitShowManual(&quot;01_Instructions Manual.pdf&quot;, 1)'), 'Instruction PDFs open in the preview');
    assert(page.includes('id="kit-builder"') && page.includes('id="stl-viewer-1"') && !page.includes('tab-content-files'), 'The configurator replaces the file list');
    assert(filesView.includes('tab-content-files') && filesView.includes('?view=files') && !filesView.includes('id="kit-builder"'), 'The Files view keeps the file list and the view switch');
    assert(!UI.modelDetail(mockModel, false).includes('detail-views'), 'Other models have no view switch');
    assert(App.kitFor(vault) === 'ussa-vault' && App.kitFor(mockModel) === null, 'Only the VAULT archive opens in the configurator');

    // Tips: every option of the builder has one, every picture and manual page exists
    const tipKeys = [...new Set([...builder.matchAll(/data-tip="([^"]+)"/g), ...parts.matchAll(/data-tip="([^"]+)"/g)].map(m => m[1]))];
    const missingTips = tipKeys.filter(k => !K.TIPS[k]);
    assert(tipKeys.length >= 20 && !missingTips.length, `Every option needs a tip (${tipKeys.length} used), missing: ${missingTips.join(', ')}`);
    const docs = new Set(cat.docs.map(f => f.original_name));
    for (const [key, tip] of Object.entries(K.TIPS)) {
      for (const t of [tip, ...Object.values(tip.choices || {})]) {
        if (t.image) assert(fs.existsSync(path.join(ROOT_DIR, 'public/img/kits/ussa-vault', `${t.image}.webp`)), `Tip ${key}: no picture ${t.image}.webp`);
        if (t.manual) assert(docs.has(t.manual[0]) && t.manual[1] >= 1, `Tip ${key}: no manual ${t.manual[0]}`);
      }
    }
    // Model cards show whether their 3D files fit the printer chosen in the top bar
    App.printerBeds = [{ id: 'p1s', name: 'P1S', x: 256, y: 256, z: 256 }];
    assert(UI.modelCard({ ...mockModel, fit: { total: 2, pending: 0, failed: 0, misfit: { any: 1, p1s: 1 } } }).includes('✗ 1 too big'), 'A card marks a model that is too big');
    assert(UI.modelCard({ ...mockModel, fit: { total: 2, pending: 0, failed: 0, misfit: { any: 0, p1s: 0 } } }).includes('✓ Fits'), 'A card marks a model that fits');
    assert(!UI.modelCard({ ...mockModel, fit: null }).includes('badge-fit'), 'No badge without 3D files');
    App.printerBeds = null;
    const roofTip = UI.kitTipContent(K.TIPS.roof, { value: 'bowl', set: 'cfg:roof', available: ['none', 'grid', 'bowl'] });
    assert(/is-current[^>]*onclick="App.kitTipPick\(&quot;cfg:roof&quot;, &quot;bowl&quot;\)"/.test(roofTip) && /disabled[^>]*onclick="App.kitTipPick\(&quot;cfg:roof&quot;, &quot;heavy&quot;\)"/.test(roofTip), 'A tip marks the current choice and disables the unavailable ones');

    // The drawing: every roof, base and modification, no broken numbers
    for (const roof of ['grid', 'table', 'bowl', 'heavy', 'undertable', 'none']) {
      for (const base of ['none', 'plain', 'wheels', 'casters']) {
        const c = { ...bom.cfg, roof, mods: { base, feet: true, backbone: 'universal', pullHandle: true, stationaryHandle: true, pegboard: 'ussa', wallMount: true } };
        const svg = UI.kitDrawing(c, 450);
        assert(svg.includes('<svg') && !/NaN|undefined/.test(svg), `Tower drawing broken for roof ${roof}, base ${base}`);
      }
    }
    const drawing = UI.kitDrawing(bom.cfg, bom.height);
    assert((drawing.match(/class="kd-floor"/g) || []).length === bom.cfg.floors.length * 2, 'Every floor is drawn from the front and the side');

    // The 3D tower, built with the real three.js (no WebGL needed to build it)
    const three = { console };
    vm.createContext(three);
    vm.runInContext(`${fs.readFileSync(path.join(ROOT_DIR, 'public/js/vendor/three.min.js'), 'utf8')}\n${kitCode}\n${fs.readFileSync(path.join(ROOT_DIR, 'public/js/kits/ussa-vault-3d.js'), 'utf8')}`, three);
    const F = { '1F': 1, '2F': 2, '4F': 4 };
    for (const roof of ['grid', 'heavy', 'undertable', 'none']) {
      const c = { ...bom.cfg, roof, mods: { base: 'wheels', feet: true, backbone: 'universal', pullHandle: true, stationaryHandle: true, pegboard: 'ikea', wallMount: roof === 'none' } };
      const model = three.VaultKit3D.build(c);
      const floorsH = c.floors.reduce((n, f) => n + F[f.height] * 48, 0);
      assert(model.floorMeshes.length === c.floors.length && model.floorMeshes.every(m => m && m.length >= 2), `3D: every floor needs its meshes (roof ${roof})`);
      assert(model.size.height >= 40 + 34 + floorsH && model.size.height <= 40 + 34 + floorsH + 70, `3D: tower height ${model.size.height} (roof ${roof})`);
      let bad = 0;
      model.group.traverse(o => { if (o.isMesh && ![o.position.x, o.position.y, o.position.z].every(Number.isFinite)) bad++; });
      let meshes = 0;
      model.group.traverse(o => { if (o.isMesh) meshes++; });
      assert(!bad && meshes > 60, `3D: ${meshes} meshes, ${bad} with broken positions (roof ${roof})`);
    }

    // Every box and every sustainer opens; floors above an open sustainer rise
    const openCfg = { ...bom.cfg, floors: [{ height: '1F', layout: 'S+S', slots: [{ type: 'sustainer', interior: 'sealed' }, { type: 'drawer', boxes: '1F', interior: 'gridfinity' }] },
      { height: '2F', layout: 'L', slots: [{ type: 'drawer', boxes: '1F+1F', interior: 'dividers' }] }, { height: '2F', layout: 'L', slots: [{ type: 'sustainer', interior: 'gridfinity' }] }] };
    const om = three.VaultKit3D.build(openCfg);
    const ids = om.openables.map(o => o.id);
    assert(ids.length === 5 && new Set(ids).size === 5, `3D: 2 sustainers and 3 boxes open, got ${ids.join(', ')}`);
    const closed = three.VaultKit3D.targets(om, new Set());
    assert(closed.floors.every(v => v === 0) && closed.top === 0 && closed.parts.every(p => p.value === 0), 'Closed: nothing moves');
    const opened = three.VaultKit3D.targets(om, new Set(['0:0', '1:0:1']));
    assert(opened.floors[0] === 0 && opened.floors[1] > om.size.depth && opened.floors[2] === opened.floors[1] && opened.top === opened.floors[1], `An open sustainer lifts what is above it: ${JSON.stringify(opened.floors)} / ${opened.top}`);
    const drawerPart = opened.parts.find(p => p.o.id === '1:0:1');
    assert(drawerPart.value > om.size.depth * 0.5 && opened.parts.find(p => p.o.id === '0:0').value < -1.5, 'A drawer slides out, a sustainer lid turns up');
    const topOpen = three.VaultKit3D.targets(om, new Set(['2:0']));
    assert(topOpen.floors.every(v => v === 0) && topOpen.top > 0, 'A sustainer on top lifts only the roof and handles');
  });

  await check('Every onclick / onchange / onsubmit App.* handler in HTML & components.js exists on App', () => {
    const htmlSources = [
      fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8'),
      compCode,
      appCode
    ].join('\n');

    const handlerRegex = /\bApp\.([a-zA-Z0-9_]+)\s*\(/g;
    const missingHandlers = new Set();
    let m;
    while ((m = handlerRegex.exec(htmlSources)) !== null) {
      const fnName = m[1];
      if (typeof App[fnName] !== 'function') {
        missingHandlers.add(`App.${fnName}`);
      }
    }
    // Actions of the "..." menus on file and folder rows (UI.entryMenu builds App.<action>(this))
    const menuActions = /action:\s*'([a-zA-Z0-9_]+)'/g;
    while ((m = menuActions.exec(compCode)) !== null) {
      if (typeof App[m[1]] !== 'function') missingHandlers.add(`App.${m[1]}`);
    }
    assert(missingHandlers.size === 0, `Missing App handlers: ${[...missingHandlers].join(', ')}`);
  });

  await check('Detail Header CSS does not overflow button row and guests get no ZIP button (Issue #80 guard)', () => {
    // Guest vs Logged-in Download All (.zip) & no duplicate ZIP button check
    const savedUser = App.currentUser;
    App.currentUser = null;
    const guestDetailHtml = UI.modelDetail(mockModel, false);
    assert(!guestDetailHtml.includes('Download All (.zip)'), 'Guest user should NOT see Download All (.zip) button');
    assert(!guestDetailHtml.includes('+ Log Print'), 'Guest user should NOT see + Log Print button');

    App.currentUser = savedUser;
    const authDetailHtml = UI.modelDetail(mockModel, false);
    const dlMatches = authDetailHtml.split('/api/models/1/download');
    assert(dlMatches.length - 1 === 1, `Expected exactly 1 model ZIP download button for logged-in user, found ${dlMatches.length - 1}`);

        // Issue #80 CSS check
    const cssContent = fs.readFileSync(path.join(ROOT_DIR, 'public/css/style.css'), 'utf8');
    assert(!cssContent.includes('.detail-header{display:grid;grid-template-columns:minmax(0, 1fr) var(--detail-sidebar-width)'), 'Expected .detail-header not to constrain actions to --detail-sidebar-width (Issue #80)');
    assert(cssContent.includes('.detail-actions .btn{white-space:nowrap'), 'Expected .detail-actions .btn to have white-space:nowrap (Issue #80)');
  });

  await check('Format filter resets when changing categories or navigating without format param (Issue #76 guard)', () => {
    const appSrc = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app.js'), 'utf8');
    assert(appSrc.includes("const activeFormat = params.format || 'all';"), 'renderModels must reset activeFormat to "all" when params.format is omitted');
    assert(appSrc.includes("this.lastCategoryFilter"), 'handleFilter must track lastCategoryFilter to reset format when switching categories');
  });

  await check('"Open in slicer" file names are plain ASCII (Bambu Studio decodes the link: a raw space fails with 400)', () => {
    const name = UI.slicerFileName({ original_name: 'Parts/Część łoża (v2) #1.stl', slicer_token: 'abcdefgh' }, '3mf');
    assert(name === 'Czesc_loza_v2_1_3dl-abcdefgh.3mf', `Unexpected slicer file name: ${name}`);
    assert(UI.slicerFileName({ original_name: '¿¿.stl' }, 'stl') === 'model.stl', 'A name with nothing usable falls back to "model"');
    const html = UI.modelDetail({ ...mockModel, files: [{ ...mockModel.files[0], slicer_token: 'abcdefgh', original_name: 'Main body.stl' }] }, false);
    const links = html.match(/[a-z]+:\/\/open\?file=[^"]+/g) || [];
    assert(links.length && links.every(l => /^[a-z]+:\/\/open\?file=[A-Za-z0-9:/._?=-]+$/.test(l)), `Slicer links must need no %-encoding: ${links.join(' ')}`);
  });

  await check('USSA VAULT kit: every STL of the archive is recognised; parts lists follow the manual', () => {
    require(path.join(ROOT_DIR, 'public/js/kits/ussa-vault.js'));
    const K = globalThis.VaultKit;
    // The real archive: "<size>\t<path in the project folder>" for its 737 files
    const files = fs.readFileSync(path.join(__dirname, 'fixtures/ussa-vault-files.tsv'), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line, i) => { const [size, name] = line.split('\t'); return { id: i + 1, file_size: Number(size), original_name: name }; });
    const unknownStl = files.filter(f => /\.stl$/i.test(f.original_name) && !K.classify(f.original_name)).map(f => f.original_name);
    assert(!unknownStl.length, `Every STL of the archive must be a known part, not: ${unknownStl.slice(0, 5).join(', ')}`);
    const byKey = {};
    files.forEach(f => { const k = K.classify(f.original_name); if (k) (byKey[k] = byKey[k] || []).push(f.original_name); });
    const shared = Object.keys(byKey).filter(k => byKey[k].length > 1).sort();
    assert(shared.join() === 'd:baseplate:M4:0,d:baseplate:M4:2', `Only the alternative M4 baseplates may share a part, got: ${shared.join(', ')}`);
    const cat = K.buildCatalog(files);
    assert(cat.byKey['d:baseplate:M4:0'].original_name.endsWith('M4 Baseplate.stl'), 'The baseplate name every family uses must win');
    assert(cat.docs.length === 5, `The five instruction PDFs go with the download, got ${cat.docs.length}`);
    assert(K.detect(files), 'The archive must be detected');
    assert(!K.detect(files.slice(0, 30)) && !K.detect([{ original_name: 'Benchy.stl' }]), 'Other projects must not be detected');

    const bom = (cfg) => K.computeBom(cat, cfg);
    const qty = (b, end) => b.parts.filter(p => p.file.original_name.endsWith(end)).reduce((n, p) => n + p.qty, 0);
    const hw = (b, start) => b.hardware.filter(h => h.name.startsWith(start)).reduce((n, h) => n + h.qty, 0);
    const expect = (b, label, pairs) => {
      for (const [end, n] of pairs) assert(qty(b, end) === n, `${label}: expected ${n} x ${end}, got ${qty(b, end)}`);
    };
    const drawer = (extra = {}) => ({ type: 'drawer', interior: 'empty', ...extra });

    // Default: L4 with 2F L, 1F S+S, 2F L drawers and a grid roof. Runner guides and slides are
    // pairs in one file: one print per box
    const def = bom(K.defaultConfig());
    expect(def, 'Default tower', [['L4 Module 2F.stl', 2], ['S4 Module 1f.stl', 2], ['L4 Box 2F.stl', 2], ['S4 Box 1F.stl', 2],
      ['x4 Runner Guides.stl', 4], ['x4 Runner Slides.stl', 4], ['Runner Stopper.stl', 8], ['Springs.stl', 4], ['Latch.stl', 4],
      ['L4 Grid Roof.stl', 1], ['Top Handle (Turn On Supports).stl', 1], ['Rails.stl', 0]]);
    assert(hw(def, 'M4 × 14') === 20 && hw(def, 'M6 × 50') === 2, 'Default tower: 4 + 6 M4x14 per 1F / 2F box, 2 M6x50 for the handle');
    assert(def.warnings.length === 0, `Default tower: no warnings expected, got ${def.warnings.join(' | ')}`);

    // L² holds two S drawer columns; several boxes in one module need geared rails (a pair per box)
    const l2 = bom({ width: 'L', depth: 4, roof: 'table', floors: [{ height: '4F', layout: 'L2', slots: [drawer({ boxes: '2F+2F', interior: 'gridfinity', handles: '2' }), drawer({ boxes: '1F+1F+1F+1F', interior: 'dividers' })] }] });
    expect(l2, 'L² floor', [['L4² Module 4F.stl', 1], ['Latch.stl', 1], ['S Rails.stl', 6], ['S4 Box 2F.stl', 2], ['S4 Box 1F.stl', 4],
      ['x4 Accessory 1st.stl', 1], ['x4 Accessory 2nd.stl', 1], ['S4 Baseplate_With 2 Handles.stl', 2], ['L4 Table Roof.stl', 1],
      ['34.5MM TALL (full height of 1F drawers)/10-S, x3.stl', 4], ['34.5MM TALL (full height of 1F drawers)/14, x4.stl', 4]]);

    // Sustainers: S-M hinge tops are single parts, the L-XL top and every bottom hinge file a pair
    const sus = bom({ width: 'L', depth: 4, floors: [{ height: '2F', layout: 'S+S', slots: [{ type: 'sustainer', interior: 'dividers' }, { type: 'sustainer', interior: 'gridfinity' }] }, { height: '2F', layout: 'L', slots: [{ type: 'sustainer', interior: 'sealed' }] }] });
    expect(sus, 'Sustainers', [['S4 2F Module.stl', 2], ['L4 2F Sealed Module.stl', 1], ['S4 Roof.stl', 2], ['L4 Roof.stl', 1],
      ['S-M 2-4F Hinge.stl', 2], ['L 2-4F Hinge.stl', 1], ['S Hinge Top.stl', 4], ['L-XL Hinge Top.stl', 1], ['S-M Rods.stl', 2], ['L-XL Rods.stl', 1],
      ['LOCK HOLDER.stl', 6], ['LOCK OUTER PART 2-4F.stl', 6], ['S4 Baseplate.stl', 1], ['Grid Roof.stl', 0]]);
    assert(hw(sus, 'M4 × 10') === 24 && hw(sus, 'M4 × 14') === 48 && hw(sus, 'M4 × 20') === 21, 'Sustainers: 8 / 16 / 7 bolts each');

    // XL: 3-5 deep boxes have a back panel, 6-7 deep boxes and baseplates come in two parts
    expect(bom({ width: 'XL', depth: 3, floors: [{ height: '1F', layout: 'XL', slots: [drawer()] }] }), 'XL3 drawer', [['XL3 Box 1F.stl', 1], ['XL3 Back Panel.stl', 1], ['XL Facade 1F.stl', 1], ['XL3 Runner Guides.stl', 1]]);
    expect(bom({ width: 'XL', depth: 6, floors: [{ height: '1F', layout: 'XL', slots: [drawer({ interior: 'gridfinity' })] }] }), 'XL6 drawer',
      [['XL6 Box 1F Part 1.stl', 1], ['XL6 Box 1F Part 2.stl', 1], ['XL6 Baseplate Part 1.stl', 1], ['XL6 Baseplate Part 2.stl', 1], ['Back Panel.stl', 0]]);

    // Modifications: wheels, a universal backbone (two boards per level, a 4F floor is two 2F
    // levels), wall mounts (one cleat per 1F / 2F mount, two per 4F)
    const mods = bom({ width: 'S', depth: 5, floors: ['2F', '1F', '4F'].map(height => ({ height, layout: 'S', slots: [drawer()] })),
      mods: { base: 'wheels', feet: true, backbone: 'universal', pullHandle: true, wallMount: true } });
    expect(mods, 'Modifications', [['S5 Base.stl', 1], ['Disk.stl', 2], ['Tyre (TPU).stl', 2], ['Jig.stl', 1], ['S Feet.stl', 1],
      ['Universal 2F Backbone.stl', 6], ['Universal 1F Backbone.stl', 2], ['Universal Pull-out Handle Lock.stl', 2], ['Handle Lock Knob Part 1.stl', 2],
      ['S2F Wall Mount.stl', 1], ['S1F Wall Mount.stl', 1], ['S4F Wall Mount.stl', 1], ['Wall Mount Second Part.stl', 4]]);
    assert(hw(mods, 'M16 threaded rod, 248') === 1 && hw(mods, '6205ZZ') === 2 && hw(mods, 'M4 × 25') === 12, 'Wheels: S rod 248 mm, 2 bearings, 12 M4x25');
    assert(hw(mods, 'M4 bolt, 60-100') === 32, `Backbone: 4 bolts per board (8 boards), got ${hw(mods, 'M4 bolt, 60-100')}`);
    assert(!mods.notes.some(n => /above the base/.test(n)) && mods.notes.some(n => /below the roof/.test(n)), `The manual's 2F advice: ${mods.notes.join(' | ')}`);
    assert(mods.height === 400, `Tower height: base 52 mm + 7 F x 48 mm + 9 mm, about 400 mm, got ${mods.height}`);
    const noBackbone = bom({ width: 'S', depth: 5, floors: [{ height: '1F', layout: 'S', slots: [drawer()] }], mods: { pullHandle: true } });
    assert(noBackbone.warnings.some(w => /choose a backbone/.test(w)) && qty(noBackbone, 'Pull-out Handle.stl') === 0, 'A pull-out handle needs a backbone');

    // Saved and linked configurations are checked against the archive
    const fixed = K.normalize(cat, { width: 'XL', depth: 9, roof: 'nope', floors: [{ height: '2F', layout: 'XL', slots: [{ type: 'sustainer', interior: 'sealed' }] }], qty: { 'd:latch': '3', bad: -1 } });
    assert(fixed.cfg.depth === 4 && fixed.cfg.roof === 'grid' && fixed.cfg.floors[0].layout === 'S+M', `Unavailable choices must fall back: ${JSON.stringify(fixed.cfg.floors[0])}`);
    assert(fixed.changes.some(c => /XL is not available in 2F/.test(c)), `The change must be reported: ${fixed.changes.join(' | ')}`);
    assert(fixed.cfg.qty['d:latch'] === 3 && !('bad' in fixed.cfg.qty), 'Quantities by hand are kept when valid');
    const edited = bom({ ...K.defaultConfig(), qty: { 'd:latch': 6 }, extra: { 'm:moduleconnector:1F': 2, 'path:01. DRAWERS/Drawers Naming.png': 1 } });
    const latch = edited.parts.find(p => p.key === 'd:latch');
    assert(latch.qty === 6 && latch.auto === 4, 'A quantity changed by hand keeps the computed one');
    assert(qty(edited, 'Connector for Modules 1F.stl') === 2 && qty(edited, 'Drawers Naming.png') === 1, 'Files added by hand are in the list');
    const text = K.bomText(edited, 'VAULT');
    assert(text.includes('## Hardware to buy') && text.includes('  6 x  01. DRAWERS/07. Universal/Latch.stl'), 'The parts list text names every file with its quantity');
    const code = K.encodeConfig(edited.cfg);
    assert(/^[A-Za-z0-9_-]+$/.test(code) && JSON.stringify(K.decodeConfig(code)) === JSON.stringify(edited.cfg), 'Configurations survive the URL');
    assert(K.decodeConfig('%%%') === null, 'A broken ?c= is ignored');
  });

  await check('Printer fit: sizes of STL / OBJ / 3MF files, parts checked straight, turned and on the diagonal', async () => {
    const os = require('os');
    const { measure } = require(path.join(ROOT_DIR, 'server/utils/meshSize'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3dlib-size-'));
    try {
      // Binary STL: one triangle 0..30 × 0..20 × 0..10
      const bin = Buffer.alloc(84 + 50 * 2);
      bin.writeUInt32LE(2, 80);
      [[0, 0, 0, 30, 0, 0, 0, 20, 0], [0, 0, 0, 30, 20, 10, 0, 20, 10]].forEach((t, i) => t.forEach((v, k) => bin.writeFloatLE(v, 84 + i * 50 + 12 + k * 4)));
      fs.writeFileSync(path.join(dir, 'a.stl'), bin);
      fs.writeFileSync(path.join(dir, 'b.stl'), 'solid t\nfacet normal 0 0 1\nouter loop\nvertex -5 0 0\nvertex 5 2 0\nvertex 0 0 7.5\nendloop\nendfacet\nendsolid t\n');
      fs.writeFileSync(path.join(dir, 'c.obj'), '# x\nv 0 0 0\nv 12 0 0\nv 0 4 3\nvt 1 1\nf 1 2 3\n');
      // A Bambu / Orca style 3MF: the mesh in 3D/Objects, a component shifted, the item turned 90°
      const yazl = require('yazl');
      const zip = new yazl.ZipFile();
      zip.addBuffer(Buffer.from('<?xml version="1.0"?><model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 5 5 0"/></components></object></resources><build><item objectid="2" transform="0 1 0 -1 0 0 0 0 1 100 100 0"/></build></model>'), '3D/3dmodel.model');
      zip.addBuffer(Buffer.from('<?xml version="1.0"?><model><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="40" y="10" z="0"/><vertex x="0" y="10" z="5"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>'), '3D/Objects/object_1.model');
      zip.end();
      const chunks = [];
      for await (const c of zip.outputStream) chunks.push(c);
      fs.writeFileSync(path.join(dir, 'd.3mf'), Buffer.concat(chunks));
      // Two plates: the same part turned 90° and a 20 × 20 mm diamond turned 45° on the plate (a
      // 14.14 mm square; turning the corners of its box would give 28.28 mm)
      const zip2 = new yazl.ZipFile();
      zip2.addBuffer(Buffer.from('<?xml version="1.0"?><model><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="40" y="10" z="0"/><vertex x="0" y="10" z="5"/></vertices></mesh></object><object id="2" type="model"><mesh><vertices><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="-10" y="0" z="2"/><vertex x="0" y="-10" z="2"/></vertices></mesh></object></resources><build><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 100 100 0"/><item objectid="2" transform="0.707106781 -0.707106781 0 0.707106781 0.707106781 0 0 0 1 300 100 0"/></build></model>'), '3D/3dmodel.model');
      zip2.end();
      const chunks2 = [];
      for await (const c of zip2.outputStream) chunks2.push(c);
      fs.writeFileSync(path.join(dir, 'e.3mf'), Buffer.concat(chunks2));
      const sizes = {
        stl: await measure(path.join(dir, 'a.stl'), 'stl'), ascii: await measure(path.join(dir, 'b.stl'), 'stl'),
        obj: await measure(path.join(dir, 'c.obj'), 'obj'), threemf: await measure(path.join(dir, 'd.3mf'), '3mf'),
        plates: await measure(path.join(dir, 'e.3mf'), '3mf')
      };
      assert(JSON.stringify(sizes) === JSON.stringify({ stl: [30, 20, 10], ascii: [10, 2, 7.5], obj: [12, 4, 3], threemf: [10, 40, 5], plates: [40, 14.14, 5] }), `Unexpected sizes: ${JSON.stringify(sizes)}`);
      let failed = false;
      try { await measure(path.join(dir, 'c.obj'), 'gcode'); } catch (e) { failed = true; }
      assert(failed, 'Other file types are not measured');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, 'public/js/printfit.js'), 'utf8'), ctx);
    const PF = ctx.PrintFit;
    const p1s = { id: 'p1s', name: 'P1S', x: 256, y: 256, z: 256, margin: 0 };
    const u1 = { id: 'u1', name: 'U1', x: 270, y: 270, z: 270, margin: 0 };
    const l3 = [268.2, 268.2, 146.1]; // the L3 module, already on the diagonal in its file
    assert(!PF.fits(l3, p1s).ok && PF.fits(l3, u1).ok && PF.fits(l3, u1).angle === 0, 'The L3 module fits the U1 only');
    assert(PF.fits([200, 250, 100], { ...p1s, x: 260, y: 210 }).angle === 90, 'Turned 90° on a long bed');
    const diag = PF.fits([300, 30, 20], p1s);
    assert(diag.ok && diag.angle > 30 && diag.angle < 60, `A long thin part fits the diagonal: ${JSON.stringify(diag)}`);
    assert(PF.fits([100, 100, 300], u1).reason === 'height', 'Too tall is too tall');
    assert(PF.fits([250, 250, 250], p1s).ok && !PF.fits([250, 250, 250], { ...p1s, margin: 5 }).ok, 'The margin keeps the edges free');
    // The L2F drawer facade lies flat in its file: too big that way, it fits stood on its edge
    // across the diagonal
    const facade = PF.fits([329.6, 95, 10.26], p1s);
    assert(facade.ok && facade.up === 'y' && facade.angle >= 40 && facade.angle <= 50, `The L2F facade fits on its side: ${JSON.stringify(facade)}`);
    assert(PF.howText(facade) === `on its side (Y up), turned ${facade.angle}°` && PF.fits([200, 100, 50], p1s).up === 'z' && PF.howText(PF.fits([200, 100, 50], p1s)) === '', 'A part that fits as placed stays as placed');
    const s = PF.summarize([{ id: 1, size: l3 }, { id: 2, size: [50, 50, 50] }, { id: 3 }, { id: 4, error: 'x' }], [p1s, u1], 'p1s');
    assert(s.total === 4 && s.fit === 1 && s.misfit.join() === '1' && s.pending === 1 && s.failed === 1, `Summary for one printer: ${JSON.stringify(s)}`);
    assert(PF.summarize([{ id: 1, size: l3 }], [p1s, u1], 'any').misfit.length === 0, 'Any printer: the U1 takes it');
  });

    await check('Every API.* method called in app.js & components.js exists on API in api.js', () => {
    const frontendSources = `${compCode}\n${appCode}`;
    const apiCallRegex = /\bAPI\.([a-zA-Z0-9_]+)\s*\(/g;
    const missingApi = new Set();
    let m;
    while ((m = apiCallRegex.exec(frontendSources)) !== null) {
      const fnName = m[1];
      if (typeof API[fnName] !== 'function') {
        missingApi.add(`API.${fnName}`);
      }
    }
    assert(missingApi.size === 0, `Missing API methods: ${[...missingApi].join(', ')}`);
  });
}

// ─── 2. END-TO-END API, FUNCTIONAL & SECURITY TESTS ─────────────────────────

async function runE2ETests() {
  console.log('\n\x1b[1m[2/2] End-to-End API, Functional & Security Tests\x1b[0m');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), '3dlib-test-'));
  const tmpDataDir = path.join(tmpRoot, 'data');
  const tmpLibDir = path.join(tmpRoot, 'library');
  fs.mkdirSync(tmpDataDir, { recursive: true });
  fs.mkdirSync(tmpLibDir, { recursive: true });

  const testPort = 3498;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  const serverProc = spawn(process.execPath, [path.join(ROOT_DIR, 'server/index.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(testPort),
      DATA_DIR: tmpDataDir,
      LIBRARY_PATH: tmpLibDir,
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  serverProc.stdout.on('data', d => { serverLogs += d.toString(); });
  serverProc.stderr.on('data', d => { serverLogs += d.toString(); });

  const waitReady = async () => {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      try {
        const r = await fetch(`${baseUrl}/healthz`);
        if (r.ok) return;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Server did not start within 20s. Logs:\n${serverLogs}`);
  };

  async function apiReq(endpoint, { method = 'GET', body = null, session = null, includeCsrf = true, headers = {} } = {}) {
    const reqHeaders = { ...headers };
    if (body && !(body instanceof FormData)) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (session?.cookie) {
      reqHeaders['Cookie'] = session.cookie;
    }
    if (includeCsrf && session?.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      reqHeaders['X-CSRF-Token'] = session.csrfToken;
    }
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: reqHeaders,
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body
    });
    const setCookie = res.headers.get('set-cookie');
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data, setCookie };
  }

  try {
    await check('Server starts cleanly and /healthz returns 200 OK', async () => {
      await waitReady();
      const { status, data } = await apiReq('/healthz');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.status === 'ok', `Expected status="ok", got ${JSON.stringify(data)}`);
    });

    const adminSession = { cookie: '', csrfToken: '' };
    const viewerSession = { cookie: '', csrfToken: '' };

    await check('First registered user becomes Admin; can log in and create a Viewer user', async () => {
      const reg1 = await apiReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'admin_test', email: 'admin@test.local', password: 'Password123!' }
      });
      assert(reg1.status === 201 || reg1.status === 200, `Admin register failed (${reg1.status}): ${JSON.stringify(reg1.data)}`);
      assert(reg1.data.role === 'admin', `Expected first user role="admin", got "${reg1.data.role}"`);

      // Login as Admin to get session cookie & CSRF token
      const login1 = await apiReq('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin_test', password: 'Password123!' }
      });
      assert(login1.status === 200, `Admin login failed (${login1.status}): ${JSON.stringify(login1.data)}`);
      adminSession.cookie = (login1.setCookie || '').split(';')[0];
      adminSession.csrfToken = login1.data.csrfToken;
      assert(adminSession.cookie && adminSession.csrfToken, 'Missing cookie or csrfToken for admin');
      assert(adminSession.cookie.startsWith('3dl_token='), `Login must set the 3dl_token cookie: ${adminSession.cookie}`);

      // Enable open registration temporarily so we can register a second user
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { open_registration: 'true' }
      });

      const reg2 = await apiReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'viewer_test', email: 'viewer@test.local', password: 'Password123!' }
      });
      assert(reg2.status === 201 || reg2.status === 200, `Second user register failed (${reg2.status}): ${JSON.stringify(reg2.data)}`);

      // Set second user's role explicitly to 'viewer'
      const roleRes = await apiReq(`/api/users/${reg2.data.id}/role`, {
        method: 'PUT',
        session: adminSession,
        body: { role: 'viewer' }
      });
      assert(roleRes.status === 200, `Setting viewer role failed (${roleRes.status}): ${JSON.stringify(roleRes.data)}`);

      // Login as Viewer
      const login2 = await apiReq('/api/auth/login', {
        method: 'POST',
        body: { username: 'viewer_test', password: 'Password123!' }
      });
      assert(login2.status === 200, `Viewer login failed (${login2.status})`);
      assert(login2.data.user?.role === 'viewer', `Expected role="viewer", got "${login2.data.user?.role}"`);
      viewerSession.cookie = (login2.setCookie || '').split(';')[0];
      viewerSession.csrfToken = login2.data.csrfToken;
    });

    await check('Security: /uploads and /library-files never serve files outside their folder (database, other files)', async () => {
      fs.writeFileSync(path.join(tmpDataDir, 'uploads', 'probe.png'), 'probe');
      fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'secret');
      const ok = await fetch(`${baseUrl}/uploads/probe.png`);
      assert(ok.status === 200 && await ok.text() === 'probe', `An upload must still load: ${ok.status}`);
      const missing = await fetch(`${baseUrl}/uploads/nothing.png`);
      assert(missing.status === 404, `A missing upload is a 404, got ${missing.status}`);
      for (const p of ['/uploads/..%2F3dlib.db', '/uploads/%2E%2E%2F3dlib.db', '/uploads/..%5C3dlib.db', '/uploads/..%2F..%2Fsecret.txt',
        '/uploads/sub/..%2F..%2F3dlib.db', '/library-files/..%2F..%2Fsecret.txt', '/library-files/..%2Fdata%2F3dlib.db']) {
        const r = await fetch(`${baseUrl}${p}`);
        const body = await r.text();
        assert(r.status !== 200 && !body.includes('SQLite format 3') && !body.includes('secret'), `${p} must not leave its folder: ${r.status} ${body.slice(0, 40)}`);
      }
    });

    let createdModelId = null;

    await check('Can create a model and upload a 3D (.stl) file', async () => {
      const createRes = await apiReq('/api/models', {
        method: 'POST',
        session: adminSession,
        body: { name: 'Gridfinity 1x2 Bin', description: 'Storage bin with magnet holes' }
      });
      assert((createRes.status === 200 || createRes.status === 201) && createRes.data.id, `Model create failed (${createRes.status}): ${JSON.stringify(createRes.data)}`);
      createdModelId = createRes.data.id;

      const stlContent = 'solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test\n';
      const form = new FormData();
      form.append('files', new Blob([stlContent], { type: 'model/stl' }), 'gridfinity_bin.stl');

      const upRes = await apiReq(`/api/models/${createdModelId}/files`, {
        method: 'POST',
        session: adminSession,
        body: form
      });
      assert(upRes.status === 200 || upRes.status === 201, `File upload failed (${upRes.status}): ${JSON.stringify(upRes.data)}`);

      const listRes = await apiReq('/api/models', { session: adminSession });
      assert(listRes.status === 200, `GET /api/models failed (${listRes.status})`);
      const found = (listRes.data.models || []).find(m => m.id === createdModelId);
      assert(found, 'Created model not returned in GET /api/models');
      assert(found.file_count === 1, `Expected file_count=1, got ${found.file_count}`);
      assert(Array.isArray(found.file_types) && found.file_types.includes('stl'), `Expected file_types to include "stl", got ${JSON.stringify(found.file_types)}`);
    });

    let matrixModelId = null;

    await check('Multi-format file upload matrix (.stl, .zip archive with internal scan, .3mf, .gcode, .step, images)', async () => {
      const createRes = await apiReq('/api/models', {
        method: 'POST',
        session: adminSession,
        body: { name: 'Multi-Format Matrix Model', description: 'Testing multi-format file uploads' }
      });
      assert((createRes.status === 200 || createRes.status === 201) && createRes.data.id, 'Failed to create matrix model');
      matrixModelId = createRes.data.id;

      const AdmZip = require('adm-zip');
      const { meshTo3mf, stlToMesh } = require('../server/utils/3mf');

      const stlContent = 'solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test\n';
      const gcodeContent = '; generated by PrusaSlicer 2.7\n; filament used [mm] = 120.5\n; estimated printing time = 15m\nG28\nG1 Z10\n';
      const stepContent = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'STEP AP214\'),\'1\');\nFILE_NAME(\'cube.step\',\'2026-10-01\',(\'Author\'),(\'Org\'),\'\',\'\',\'\');\nFILE_SCHEMA((\'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }\'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
      const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

      const mesh = stlToMesh(Buffer.from(stlContent, 'utf8'));
      const threeMfBuf = meshTo3mf(mesh);

      const zip = new AdmZip();
      zip.addFile('nested_part.stl', Buffer.from(stlContent, 'utf8'));
      zip.addFile('docs/readme.txt', Buffer.from('Archive info', 'utf8'));
      const zipBuf = zip.toBuffer();

      const form = new FormData();
      form.append('files', new Blob([zipBuf], { type: 'application/zip' }), 'archive_bundle.zip');
      form.append('files', new Blob([threeMfBuf], { type: 'model/3mf' }), 'matrix_cube.3mf');
      form.append('files', new Blob([gcodeContent], { type: 'text/x-gcode' }), 'test_toolpath.gcode');
      form.append('files', new Blob([stepContent], { type: 'model/step' }), 'matrix_bracket.step');
      form.append('files', new Blob([pngBuf], { type: 'image/png' }), 'render_photo.png');

      const upRes = await apiReq(`/api/models/${matrixModelId}/files`, {
        method: 'POST',
        session: adminSession,
        body: form
      });
      assert(upRes.status === 200 || upRes.status === 201, `Multi-format file upload failed (${upRes.status}): ${JSON.stringify(upRes.data)}`);

      const getRes = await apiReq(`/api/models/${matrixModelId}`, { session: adminSession });
      assert(getRes.status === 200, `GET /api/models/${matrixModelId} failed (${getRes.status})`);
      const files = getRes.data.files || [];
      const types = files.map(f => f.file_type);

      assert(types.includes('zip'), 'ZIP archive file type missing from model files');
      assert(types.includes('3mf'), '3MF file type missing from model files');
      assert(types.includes('gcode'), 'Gcode file type missing from model files');
      assert(types.includes('step'), 'STEP file type missing from model files');
      assert(types.includes('image'), 'Image file type missing from model files');

      const zipInternalEntry = files.find(f => f.library_path && f.library_path.includes('::nested_part.stl'));
      assert(zipInternalEntry, 'Internal STL inside uploaded ZIP archive was not indexed');
      assert(zipInternalEntry.file_type === 'stl', `Expected internal zip file to be "stl", got ${zipInternalEntry.file_type}`);
    });

    await check('Direct slicer file upload endpoint (/api/upload-slicer)', async () => {
      const gcodeContent = '; generated by PrusaSlicer 2.7\n; filament used [mm] = 250.0\n; estimated printing time = 30m\nG28\nG1 Z15\n';
      const form = new FormData();
      form.append('file', new Blob([gcodeContent], { type: 'text/x-gcode' }), 'slicer_direct_print.gcode');

      const slicerRes = await apiReq('/api/upload-slicer', {
        method: 'POST',
        session: adminSession,
        body: form
      });
      assert(slicerRes.status === 201, `Slicer upload failed (${slicerRes.status}): ${JSON.stringify(slicerRes.data)}`);
      assert(slicerRes.data.model_id, 'Slicer upload response missing model_id');

      const getRes = await apiReq(`/api/models/${slicerRes.data.model_id}`, { session: adminSession });
      assert(getRes.status === 200, 'Failed to fetch model created by slicer upload');
      assert(getRes.data.files && getRes.data.files.length >= 1, 'No files associated with slicer model');
      assert(getRes.data.files[0].file_type === 'gcode', `Expected slicer file type "gcode", got ${getRes.data.files[0].file_type}`);

      // The name comes from the client: "...gcode" parses to the name "..", which once made the
      // project folder the library's parent
      for (const evil of ['...gcode', '../../evil.gcode', '.hidden.gcode', 'a:b*?.gcode']) {
        const f = new FormData();
        f.append('file', new Blob([gcodeContent], { type: 'text/x-gcode' }), evil);
        const r = await apiReq('/api/upload-slicer', { method: 'POST', session: adminSession, body: f });
        assert(r.status === 201, `Upload of "${evil}" failed (${r.status}): ${JSON.stringify(r.data)}`);
        const m = await apiReq(`/api/models/${r.data.model_id}`, { session: adminSession });
        const file = m.data.files[0];
        const rel = path.relative(tmpLibDir, file.library_path);
        assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `"${evil}" must stay in the library: ${file.library_path}`);
        assert(!rel.split(/[\\/]/).some(part => part.startsWith('.')), `"${evil}" must not make a hidden file or folder: ${rel}`);
        assert(fs.existsSync(file.library_path), `"${evil}" must be on disk at ${file.library_path}`);
      }
      assert(!fs.readdirSync(tmpRoot).some(n => n.endsWith('.gcode')), `Nothing may land next to the library: ${fs.readdirSync(tmpRoot)}`);
    });

    await check('A taken model name suggests the next version ("Gear v2" -> "Gear v3", "Gear (v2)" -> "Gear v3")', async () => {
      for (const name of ['Gear v2', 'Gear (v2)']) {
        const first = await apiReq('/api/models', { method: 'POST', session: adminSession, body: { name } });
        assert(first.status === 200 || first.status === 201, `Create "${name}" failed (${first.status})`);
        const again = await apiReq('/api/models', { method: 'POST', session: adminSession, body: { name } });
        assert(again.status === 409 && (again.data.suggested_names || []).includes('Gear v3'), `"${name}" taken: ${again.status} ${JSON.stringify(again.data.suggested_names)}`);
      }
    });

    let categoryId = null;
    let projectId = null;

    await check('Can assign Category, Tags, and Collection to a model (single & bulk)', async () => {
      const catRes = await apiReq('/api/categories', {
        method: 'POST',
        session: adminSession,
        body: { name: 'Workshop Organization', color: '#10b981' }
      });
      assert((catRes.status === 200 || catRes.status === 201) && catRes.data.id, `Category create failed: ${JSON.stringify(catRes.data)}`);
      categoryId = catRes.data.id;

      const bulkCatRes = await apiReq('/api/models/bulk-update', {
        method: 'POST',
        session: adminSession,
        body: { ids: [createdModelId], category_id: categoryId, add_tags: ['NEW:gridfinity', 'NEW:modular'] }
      });
      assert(bulkCatRes.status === 200, `Bulk update category/tags failed: ${JSON.stringify(bulkCatRes.data)}`);

      const projRes = await apiReq('/api/projects', {
        method: 'POST',
        session: adminSession,
        body: { name: 'Desk Setup', description: 'Desk organization parts', visibility: 'public' }
      });
      assert((projRes.status === 200 || projRes.status === 201) && projRes.data.id, `Collection create failed: ${JSON.stringify(projRes.data)}`);
      projectId = projRes.data.id;

      const syncProjRes = await apiReq(`/api/models/${createdModelId}/projects`, {
        method: 'PUT',
        session: adminSession,
        body: { project_ids: [projectId] }
      });
      assert(syncProjRes.status === 200, `Sync model collections failed: ${JSON.stringify(syncProjRes.data)}`);

      const detailRes = await apiReq(`/api/models/${createdModelId}`, { session: adminSession });
      assert(detailRes.status === 200, 'GET /api/models/:id failed');
      assert(detailRes.data.category_id === categoryId, `Expected category_id=${categoryId}, got ${detailRes.data.category_id}`);
      assert(detailRes.data.tags.some(t => t.name === 'gridfinity'), `Expected tag "gridfinity" on model, got ${JSON.stringify(detailRes.data.tags)}`);
      assert(detailRes.data.projects.some(p => p.id === projectId), `Expected project ${projectId} on model`);
    });

    await check('Search finds models by Name, Tag, Category, and Collection (Issue #73 guard)', async () => {
      for (const query of ['1x2 Bin', 'magnet holes', 'modular', 'Workshop Organization', 'Desk Setup']) {
        const res = await apiReq(`/api/models?search=${encodeURIComponent(query)}`, { session: adminSession });
        assert(res.status === 200, `Search for "${query}" failed with status ${res.status}`);
        const found = (res.data.models || []).some(m => m.id === createdModelId);
        assert(found, `Expected search for "${query}" to return model ${createdModelId}, got ${JSON.stringify(res.data.models?.map(m => m.name))}`);
      }
      const emptyRes = await apiReq('/api/models?search=nonexistent_xyz_999', { session: adminSession });
      assert(emptyRes.status === 200 && (emptyRes.data.models || []).length === 0, 'Expected 0 results for nonexistent search query');
    });

    await check('Can edit a Collection (name, description, visibility)', async () => {
      const editRes = await apiReq(`/api/projects/${projectId}`, {
        method: 'PUT',
        session: adminSession,
        body: { name: 'Ultimate Desk Setup', description: 'Updated collection description', visibility: 'private' }
      });
      assert(editRes.status === 200, `Collection edit failed (${editRes.status}): ${JSON.stringify(editRes.data)}`);

      const getProj = await apiReq(`/api/projects/${projectId}`, { session: adminSession });
      assert(getProj.status === 200, `GET /api/projects/${projectId} failed`);
      assert(getProj.data.name === 'Ultimate Desk Setup', `Expected updated name, got "${getProj.data.name}"`);
      assert(getProj.data.description === 'Updated collection description', 'Expected updated description');
      assert(getProj.data.visibility === 'private', `Expected visibility="private", got "${getProj.data.visibility}"`);
    });

    await check('Security: Unauthenticated user CANNOT delete or modify models/collections (returns 401)', async () => {
      const delSingle = await apiReq(`/api/models/${createdModelId}`, { method: 'DELETE' });
      assert(delSingle.status === 401, `Unauthenticated DELETE /api/models/:id should be 401, got ${delSingle.status}`);

      const delBulk = await apiReq('/api/models/bulk-delete', { method: 'POST', body: { ids: [createdModelId] } });
      assert(delBulk.status === 401, `Unauthenticated bulk-delete should be 401, got ${delBulk.status}`);

      const updBulk = await apiReq('/api/models/bulk-update', { method: 'POST', body: { ids: [createdModelId], category_id: null } });
      assert(updBulk.status === 401, `Unauthenticated bulk-update should be 401, got ${updBulk.status}`);

      const delProj = await apiReq(`/api/projects/${projectId}`, { method: 'DELETE' });
      assert(delProj.status === 401, `Unauthenticated DELETE /api/projects/:id should be 401, got ${delProj.status}`);
    });

    await check('Security: Viewer role CANNOT delete or modify models/collections (returns 403)', async () => {
      const delSingle = await apiReq(`/api/models/${createdModelId}`, { method: 'DELETE', session: viewerSession });
      assert(delSingle.status === 403, `Viewer DELETE /api/models/:id should be 403, got ${delSingle.status}`);

      const delBulk = await apiReq('/api/models/bulk-delete', { method: 'POST', session: viewerSession, body: { ids: [createdModelId] } });
      assert(delBulk.status === 403, `Viewer bulk-delete should be 403, got ${delBulk.status}`);

      const updBulk = await apiReq('/api/models/bulk-update', { method: 'POST', session: viewerSession, body: { ids: [createdModelId], category_id: null } });
      assert(updBulk.status === 403, `Viewer bulk-update should be 403, got ${updBulk.status}`);

      const browseCat = await apiReq('/api/browse/bulk-category', { method: 'POST', session: viewerSession, body: { paths: ['test'], category_id: null } });
      assert(browseCat.status === 403, `Viewer browse bulk-category should be 403, got ${browseCat.status}`);
    });

    await check('Security: Admin request without CSRF token is rejected (returns 403)', async () => {
      const noCsrf = await apiReq(`/api/models/${createdModelId}`, {
        method: 'DELETE',
        session: adminSession,
        includeCsrf: false
      });
      assert(noCsrf.status === 403, `Request without CSRF token should be 403, got ${noCsrf.status}`);

      const checkStillThere = await apiReq(`/api/models/${createdModelId}`, { session: adminSession });
      assert(checkStillThere.status === 200, 'Model was unexpectedly deleted!');
    });

    await check('Settings: Toggling a General Setting does not reset Security Settings (Issue #70 guard)', async () => {
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { private_instance: 'true' }
      });
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { scan_zip_archives: 'false' }
      });

      const sysRes = await apiReq('/api/settings/system', { session: adminSession });
      assert(sysRes.status === 200, 'GET /api/settings/system failed');
      assert(sysRes.data.private_instance === 'true', `Expected private_instance="true", got "${sysRes.data.private_instance}"`);
      assert(sysRes.data.scan_zip_archives === 'false', `Expected scan_zip_archives="false", got "${sysRes.data.scan_zip_archives}"`);
    });

    await check('3D Viewer Streaming, File Download & 3MF Conversion work (/api/files/:id/*)', async () => {
      const detailRes = await apiReq(`/api/models/${createdModelId}`, { session: adminSession });
      assert(detailRes.status === 200 && detailRes.data.files?.length === 1, 'Expected 1 file on model');
      const fileId = detailRes.data.files[0].id;

      const streamRes = await fetch(`${baseUrl}/api/files/${fileId}/stream`, {
        headers: { Cookie: adminSession.cookie }
      });
      assert(streamRes.status === 200, `Expected 200 from /api/files/:id/stream, got ${streamRes.status}`);
      const streamText = await streamRes.text();
      assert(streamText.includes('solid test'), 'Streamed STL content did not match uploaded STL');

      const dlRes = await fetch(`${baseUrl}/api/files/${fileId}/download`, {
        headers: { Cookie: adminSession.cookie }
      });
      assert(dlRes.status === 200, `Expected 200 from /api/files/:id/download, got ${dlRes.status}`);

      const mfRes = await fetch(`${baseUrl}/api/files/${fileId}/3mf`, {
        headers: { Cookie: adminSession.cookie }
      });
      assert(mfRes.status === 200, `Expected 200 from /api/files/:id/3mf, got ${mfRes.status}`);
      const mfBuf = Buffer.from(await mfRes.arrayBuffer());
      assert(mfBuf.length > 4 && mfBuf[0] === 0x50 && mfBuf[1] === 0x4b, 'Expected valid ZIP/3MF PK header');

      // Download All files of a model as .zip (Issue #75 guard)
      const zipAllRes = await fetch(`${baseUrl}/api/models/${createdModelId}/download`, {
        headers: { Cookie: adminSession.cookie }
      });
      assert(zipAllRes.status === 200, `Expected 200 from /api/models/:id/download (Issue #75), got ${zipAllRes.status}`);
      const zipAllBuf = Buffer.from(await zipAllRes.arrayBuffer());
      const AdmZip = require('adm-zip');
      const dlZip = new AdmZip(zipAllBuf);
      assert(dlZip.getEntries().some(e => e.entryName === 'gridfinity_bin.stl'), 'Expected gridfinity_bin.stl inside model ZIP download');
    });

    await check('Materials & Print History logging work (/api/materials & /api/models/:id/prints)', async () => {
      const matRes = await apiReq('/api/materials', {
        method: 'POST',
        session: adminSession,
        body: { name: 'PLA Matte Black' }
      });
      assert((matRes.status === 200 || matRes.status === 201) && matRes.data.id, `Material create failed: ${JSON.stringify(matRes.data)}`);

      const printRes = await apiReq(`/api/models/${createdModelId}/prints`, {
        method: 'POST',
        session: adminSession,
        body: { material_id: matRes.data.id, successful: true, notes: 'Clean first layer' }
      });
      assert(printRes.status === 200 || printRes.status === 201, `Print log failed: ${JSON.stringify(printRes.data)}`);

      const detailRes = await apiReq(`/api/models/${createdModelId}`, { session: adminSession });
      assert(detailRes.data.prints?.length === 1, `Expected 1 print record, got ${detailRes.data.prints?.length}`);

      const listRes = await apiReq('/api/models?printed=true', { session: adminSession });
      assert((listRes.data.models || []).some(m => m.id === createdModelId), 'Expected model in ?printed=true filter');
    });

    await check('Public Share Links work for unauthenticated visitors even on private instance (/api/shares)', async () => {
      const shareRes = await apiReq('/api/shares', {
        method: 'POST',
        session: adminSession,
        body: { model_id: createdModelId, expires_days: 7 }
      });
      assert((shareRes.status === 200 || shareRes.status === 201) && shareRes.data.slug, `Share create failed: ${JSON.stringify(shareRes.data)}`);
      const slug = shareRes.data.slug;

      // Unauthenticated visitor accesses share metadata
      const pubShare = await apiReq(`/api/shares/${slug}`);
      assert(pubShare.status === 200 && pubShare.data.id === createdModelId, `Unauthenticated share fetch failed (${pubShare.status})`);

      // Unauthenticated visitor streams file using share token
      const fileId = pubShare.data.files[0].id;
      const pubStream = await fetch(`${baseUrl}/api/files/${fileId}/stream?share=${slug}`);
      assert(pubStream.status === 200, `Public share file stream failed (${pubStream.status})`);

      // Invalid share token is rejected
      const badStream = await fetch(`${baseUrl}/api/files/${fileId}/stream?share=invalid_slug_123`);
      assert(badStream.status === 403, `Expected 403 for invalid share token, got ${badStream.status}`);
    });

    await check('Security: Standard User can manage own models, but CANNOT modify Admin models or view Private Collections', async () => {
      // Enable open registration temporarily to create standard user
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { open_registration: 'true' }
      });
      const regUser = await apiReq('/api/auth/register', {
        method: 'POST',
        body: { username: 'maker_user', email: 'maker@example.com', password: 'UserPass123!' }
      });
      assert(regUser.status === 200 || regUser.status === 201, `User registration failed: ${JSON.stringify(regUser.data)}`);

      const loginUser = await apiReq('/api/auth/login', {
        method: 'POST',
        body: { username: 'maker_user', password: 'UserPass123!' }
      });
      const userSession = {
        cookie: (loginUser.setCookie || '').split(';')[0],
        csrfToken: loginUser.data.csrfToken
      };

      // Cannot delete or update Admin's model
      const delAdminModel = await apiReq(`/api/models/${createdModelId}`, { method: 'DELETE', session: userSession });
      assert(delAdminModel.status === 403, `User should get 403 deleting Admin model, got ${delAdminModel.status}`);
      const editAdminModel = await apiReq(`/api/models/${createdModelId}`, { method: 'PUT', session: userSession, body: { name: 'Hacked' } });
      assert(editAdminModel.status === 403, `User should get 403 editing Admin model, got ${editAdminModel.status}`);

      // Cannot view Admin's private collection
      const privProj = await apiReq(`/api/projects/${projectId}`, { session: userSession });
      assert(privProj.status === 403, `User should get 403 viewing Admin private collection, got ${privProj.status}`);

      // Can create, edit, and delete own model
      const ownModel = await apiReq('/api/models', { method: 'POST', session: userSession, body: { name: 'My Custom Bracket' } });
      assert((ownModel.status === 200 || ownModel.status === 201) && ownModel.data.id, 'User failed to create own model');
      const editOwn = await apiReq(`/api/models/${ownModel.data.id}`, { method: 'PUT', session: userSession, body: { name: 'My Custom Bracket v2' } });
      assert(editOwn.status === 200, 'User failed to edit own model');
      const delOwn = await apiReq(`/api/models/${ownModel.data.id}`, { method: 'DELETE', session: userSession });
      assert(delOwn.status === 200, 'User failed to delete own model');
    });

    await check('Library Scanner indexes nested folders, ZIP+cover folders (with deep ZIP scan off), and re-scans cleanly after DB delete (Issue #74 guard)', async () => {
      // 1. Nested subfolder with STL: the top-level "Toolbox" folder is the project model,
      //    the subfolder survives in the file's relative name
      const nestedFolder = path.join(tmpLibDir, 'Toolbox', 'Scanned Cable Clip');
      fs.mkdirSync(nestedFolder, { recursive: true });
      const stlContent = 'solid clip\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid clip\n';
      fs.writeFileSync(path.join(nestedFolder, 'cable_clip.stl'), stlContent, 'utf8');

      // 2. Folder with ONLY a cover image and a .zip file while scan_zip_archives is 'false'
      const zipOnlyFolder = path.join(tmpLibDir, 'Zip Only Model');
      fs.mkdirSync(zipOnlyFolder, { recursive: true });
      fs.writeFileSync(path.join(zipOnlyFolder, 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const AdmZip = require('adm-zip');
      const z = new AdmZip();
      z.addFile('part.stl', Buffer.from(stlContent, 'utf8'));
      z.writeZip(path.join(zipOnlyFolder, 'archive.zip'));

      const runScanAndWait = async () => {
        const startScan = await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
        assert(startScan.status === 200, `Scan start failed (${startScan.status}): ${JSON.stringify(startScan.data)}`);
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 100));
          const st = await apiReq('/api/library/scan/status', { session: adminSession });
          if (st.status === 200 && !st.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 30s');
      };

      await runScanAndWait();

      const searchScanned = await apiReq('/api/models?search=Toolbox', { session: adminSession });
      const scannedModel = (searchScanned.data.models || []).find(m => m.name === 'Toolbox');
      assert(scannedModel, 'Scanner did not index the "Toolbox" project folder');
      assert(scannedModel.file_count === 1, `Expected the Toolbox project model to have 1 file, got ${scannedModel.file_count}`);
      const scannedDetail = await apiReq(`/api/models/${scannedModel.id}`, { session: adminSession });
      assert((scannedDetail.data.files || []).some(f => f.original_name === 'Scanned Cable Clip/cable_clip.stl'),
        `Expected the nested file to keep its subfolder path, got ${JSON.stringify((scannedDetail.data.files || []).map(f => f.original_name))}`);

      const searchZipModel = await apiReq('/api/models?search=Zip%20Only%20Model', { session: adminSession });
      const zipModel = (searchZipModel.data.models || []).find(m => m.name === 'Zip Only Model');
      assert(zipModel, 'Scanner did not index "Zip Only Model" folder');
      assert(zipModel.file_count === 2, `Expected Zip Only Model (cover.jpg + archive.zip with deep scan off) to have 2 files, got ${zipModel.file_count}`);
      assert(zipModel.thumbnail, 'Expected cover.jpg to be set as thumbnail on Zip Only Model');

      // 3. Delete both models (to the Trash) after saveDb debounce (>1.1s) and re-scan: the scan must
      // not bring them back; restoring them brings back all their files (#74 regression check)
      await new Promise(r => setTimeout(r, 1100)); // ensure saveDb() / db.export() has run
      await apiReq(`/api/models/${scannedModel.id}`, { method: 'DELETE', session: adminSession });
      await apiReq(`/api/models/${zipModel.id}`, { method: 'DELETE', session: adminSession });

      await runScanAndWait();

      const hidden = await apiReq('/api/models?search=Toolbox', { session: adminSession });
      assert(!(hidden.data.models || []).some(m => m.name === 'Toolbox'), 'A model in the Trash must stay hidden after a re-scan');
      const restore = await apiReq('/api/trash/restore', { method: 'POST', session: adminSession, body: { model_ids: [scannedModel.id, zipModel.id] } });
      assert(restore.status === 200, `Restoring from the Trash failed (${restore.status})`);

      const rescan1 = await apiReq('/api/models?search=Toolbox', { session: adminSession });
      const rescannedModel = (rescan1.data.models || []).find(m => m.name === 'Toolbox');
      assert(rescannedModel && rescannedModel.file_count === 1, `After Trash + re-scan + restore, expected file_count=1, got ${rescannedModel?.file_count} (Issue #74)`);

      const rescan2 = await apiReq('/api/models?search=Zip%20Only%20Model', { session: adminSession });
      const rescannedZip = (rescan2.data.models || []).find(m => m.name === 'Zip Only Model');
      assert(rescannedZip && rescannedZip.file_count === 2, `After Trash + re-scan + restore, expected Zip Only Model file_count=2, got ${rescannedZip?.file_count} (Issue #74)`);

      const browseRes = await apiReq('/api/browse', { session: adminSession });
      assert(browseRes.status === 200 && (browseRes.data.folders || []).some(f => f.name === 'Toolbox'), 'Expected "Toolbox" in /api/browse folders');

      // 4. Streaming ZIP with 64-bit ZIP64 Data Descriptor (Printables format, Issue #77 guard)
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { scan_zip_archives: 'true' }
      });
      const zlib = require('zlib');
      const stlBuf = Buffer.from(stlContent, 'utf8');
      const rawDeflated = zlib.deflateRawSync(stlBuf);
      const crc = zlib.crc32(stlBuf);
      const fname = Buffer.from('printables_part.stl');
      const lfh = Buffer.alloc(30 + fname.length);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(45, 4);
      lfh.writeUInt16LE(0x0008, 6); // Bit 3: Data Descriptor
      lfh.writeUInt16LE(8, 8);
      lfh.writeUInt16LE(fname.length, 26);
      fname.copy(lfh, 30);
      const dd = Buffer.alloc(24); // 64-bit ZIP64 descriptor that triggers ADM-ZIP DESCRIPTOR_FAULTY
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc >>> 0, 4);
      dd.writeBigUInt64LE(BigInt(rawDeflated.length), 8);
      dd.writeBigUInt64LE(BigInt(stlBuf.length), 16);
      const cdOffset = lfh.length + rawDeflated.length + dd.length;
      const cdh = Buffer.alloc(46 + fname.length);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(45, 4);
      cdh.writeUInt16LE(45, 6);
      cdh.writeUInt16LE(0x0008, 8);
      cdh.writeUInt16LE(8, 10);
      cdh.writeUInt32LE(crc >>> 0, 16);
      cdh.writeUInt32LE(rawDeflated.length, 20);
      cdh.writeUInt32LE(stlBuf.length, 24);
      cdh.writeUInt16LE(fname.length, 28);
      fname.copy(cdh, 46);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(1, 8);
      eocd.writeUInt16LE(1, 10);
      eocd.writeUInt32LE(cdh.length, 12);
      eocd.writeUInt32LE(cdOffset, 16);

      const printablesFolder = path.join(tmpLibDir, 'Printables Zip64 Model');
      fs.mkdirSync(printablesFolder, { recursive: true });
      fs.writeFileSync(path.join(printablesFolder, 'modular-desk-organizer-model_files.zip'), Buffer.concat([lfh, rawDeflated, dd, cdh, eocd]));

      await runScanAndWait();

      const pSearch = await apiReq('/api/models?search=Printables%20Zip64%20Model', { session: adminSession });
      const pModel = (pSearch.data.models || []).find(m => m.name === 'Printables Zip64 Model');
      assert(pModel, 'Expected Printables Zip64 Model to be indexed');
      const pDetail = await apiReq(`/api/models/${pModel.id}`, { session: adminSession });
      const zipEntryFile = (pDetail.data.files || []).find(f => f.is_archive_entry === 1 && f.filename === 'printables_part.stl');
      assert(zipEntryFile, 'Expected printables_part.stl archive entry to be indexed');

      const zStream = await fetch(`${baseUrl}/api/files/${zipEntryFile.id}/stream`, { headers: { Cookie: adminSession.cookie } });
      assert(zStream.status === 200, `Expected 200 streaming Printables ZIP64 entry (Issue #77), got ${zStream.status}`);
      const zText = await zStream.text();
      assert(zText.includes('solid clip'), 'Streamed Printables ZIP64 STL did not match original');

      // 5. Subfolders named "stl files" / "Version 1" / "Version 2" & doc-only folders + disabled ZIP scan cleanup (Issue #78 guard)
      await apiReq('/api/settings/system', {
        method: 'POST',
        session: adminSession,
        body: { scan_zip_archives: 'false' }
      });

      const standRoot = path.join(tmpLibDir, 'Blue Curved Stand');
      fs.mkdirSync(path.join(standRoot, 'Version 1', 'stl files'), { recursive: true });
      fs.mkdirSync(path.join(standRoot, 'Version 2', 'stl files'), { recursive: true });
      fs.writeFileSync(path.join(standRoot, 'Version 1', 'stl files', 'stand_v1.stl'), stlContent, 'utf8');
      fs.writeFileSync(path.join(standRoot, 'Version 2', 'readme.txt'), 'Print instructions', 'utf8');
      fs.writeFileSync(path.join(standRoot, 'Version 2', 'changelog.pdf'), '%PDF-1.4', 'utf8');
      fs.writeFileSync(path.join(standRoot, 'Version 2', 'stl files', 'stand_v2.stl'), stlContent, 'utf8');

      const docsOnlyDir = path.join(tmpLibDir, 'Random Notes Folder');
      fs.mkdirSync(docsOnlyDir, { recursive: true });
      fs.writeFileSync(path.join(docsOnlyDir, 'notes.txt'), 'Just text notes, no 3D files', 'utf8');

      await runScanAndWait();

      const allScannedRes = await apiReq('/api/models?limit=100', { session: adminSession });
      const allScannedModels = allScannedRes.data.models || [];
      const bogusSubfolderModel = allScannedModels.find(m => ['stl files', 'Version 1', 'Version 2', 'Random Notes Folder'].includes(m.name));
      assert(!bogusSubfolderModel, `Expected no standalone model named "${bogusSubfolderModel?.name}" (Issue #78)`);

      const standModel = allScannedModels.find(m => m.name === 'Blue Curved Stand');
      assert(standModel, 'Expected parent folder "Blue Curved Stand" to be indexed as a single model (Issue #78)');
      assert(standModel.file_count === 4, `Expected "Blue Curved Stand" to have all 4 files from its Version/stl subfolders, got ${standModel.file_count}`);

      const pDetailAfterDisable = await apiReq(`/api/models/${pModel.id}`, { session: adminSession });
      const remainingArchiveEntries = (pDetailAfterDisable.data.files || []).filter(f => f.is_archive_entry === 1);
      assert(remainingArchiveEntries.length === 0, `Expected 0 virtual archive entries after disabling scan_zip_archives, got ${remainingArchiveEntries.length} (Issue #78)`);
    });

    await check('Library layout: every file or folder in the library root is one project; folders keep their subfolder tree; moved files are purged', async () => {
      const { meshTo3mf } = require(path.join(ROOT_DIR, 'server/utils/3mf'));
      const tri = { verts: [[0, 0, 0], [10, 0, 0], [0, 10, 0]], tris: [[0, 1, 2]] };
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      const put = (rel, data) => {
        const full = path.join(tmpLibDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
      };
      put('Loose Benchy.3mf', meshTo3mf(tri));                     // loose files in the root: one project each
      put('Loose Benchy.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // same name: belongs to that project
      put('Loose Bracket.stl', stl);
      put('Ready Prints/Chess Set.3mf', meshTo3mf(tri));            // folders: one project with their tree
      put('Ready Prints/Games/Poker Chips.gcode.3mf', meshTo3mf(tri));
      put('Hero_Me/Hero Me Gen7.3mf', meshTo3mf(tri));
      put('Hero_Me/Gantry Adapters/3DFused/spacer.stl', stl);
      put('Hero_Me/Part Cooling Ducts/Standard Ducts/5015 fans/duct.stl', stl);
      put('HeroXMe/other.stl', stl);                                 // LIKE "_" wildcard guard
      put('Hero_Me/Media/timelapse.mp4', Buffer.from('fake mp4'));   // videos are listed as "video"
      put('Hero_Me/source.blend', Buffer.from('BLENDER'));          // unsupported: listed for information
      put('Hero_Me/.DS_Store', Buffer.from([0]));                   // system clutter: never listed
      put('Hero_Me/Thumbs.db', Buffer.from([0]));

      const scan = async () => {
        const st = await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
        assert(st.status === 200, `Scan start failed (${st.status})`);
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 100));
          const s = await apiReq('/api/library/scan/status', { session: adminSession });
          if (s.status === 200 && !s.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 30s');
      };
      const byName = async (name) => {
        const r = await apiReq(`/api/models?search=${encodeURIComponent(name)}`, { session: adminSession });
        return (r.data.models || []).filter(m => m.name === name);
      };
      const filesOf = async (model) => {
        const d = await apiReq(`/api/models/${model.id}`, { session: adminSession });
        return (d.data.files || []).map(f => f.original_name).sort();
      };

      await scan();
      await scan(); // a re-scan must not duplicate or reshuffle anything

      const benchy = await byName('Loose Benchy');
      assert(benchy.length === 1 && JSON.stringify(await filesOf(benchy[0])) === JSON.stringify(['Loose Benchy.3mf', 'Loose Benchy.jpg']),
        `Expected "Loose Benchy" with its 3MF and same-named image, got ${JSON.stringify(benchy.length ? await filesOf(benchy[0]) : [])}`);
      const bracket = await byName('Loose Bracket');
      assert(bracket.length === 1 && bracket[0].file_count === 1, 'A loose STL in the root must be its own project');

      const ready = await byName('Ready Prints');
      assert(ready.length === 1 && JSON.stringify(await filesOf(ready[0])) === JSON.stringify(['Chess Set.3mf', 'Games/Poker Chips.gcode.3mf']),
        'A folder of 3MFs must stay one project with its subfolder tree');
      assert((await byName('Chess Set')).length === 0, '3MFs inside a project folder must not become separate models');

      const hero = await byName('Hero_Me');
      assert(hero.length === 1, `Expected one "Hero_Me" project, got ${hero.length}`);
      const heroNames = await filesOf(hero[0]);
      assert(JSON.stringify(heroNames) === JSON.stringify(['Gantry Adapters/3DFused/spacer.stl', 'Hero Me Gen7.3mf', 'Media/timelapse.mp4', 'Part Cooling Ducts/Standard Ducts/5015 fans/duct.stl', 'source.blend']),
        `Hero_Me files should keep their subfolder paths, list every file and skip system files, got ${JSON.stringify(heroNames)}`);
      const heroTypes = Object.fromEntries(((await apiReq(`/api/models/${hero[0].id}`, { session: adminSession })).data.files || []).map(f => [f.original_name, f.file_type]));
      assert(heroTypes['Media/timelapse.mp4'] === 'video' && heroTypes['source.blend'] === 'other',
        `Expected video / other file types, got ${JSON.stringify(heroTypes)}`);
      for (const sub of ['Gantry Adapters', '3DFused', '5015 fans']) {
        assert((await byName(sub)).length === 0, `Subfolder "${sub}" must not become a model`);
      }
      const other = await byName('HeroXMe');
      assert(other.length === 1 && other[0].file_count === 1, 'A sibling folder whose name matches the LIKE pattern must stay its own project');

      // Moving a folder on disk: the next scan drops the stale files instead of serving index.html for them
      fs.renameSync(path.join(tmpLibDir, 'Hero_Me', 'Gantry Adapters'), path.join(tmpLibDir, 'HeroXMe', 'Gantry Adapters'));
      await scan();
      const heroAfter = await filesOf((await byName('Hero_Me'))[0]);
      assert(!heroAfter.some(n => n.startsWith('Gantry Adapters/')), `Moved files must leave the old project, got ${JSON.stringify(heroAfter)}`);
      const otherAfter = await filesOf((await byName('HeroXMe'))[0]);
      assert(otherAfter.includes('Gantry Adapters/3DFused/spacer.stl'), `Moved files must show up in the new project, got ${JSON.stringify(otherAfter)}`);

      const missing = await fetch(`${baseUrl}/library-files/Hero_Me/Gantry%20Adapters/3DFused/spacer.stl`);
      assert(missing.status === 404, `A missing library file must return 404, got ${missing.status}`);
    });

    await check('Password-protected models stay in lists; with a password every opening and every file needs it', async () => {
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      fs.mkdirSync(path.join(tmpLibDir, 'Adult Test'), { recursive: true });
      fs.writeFileSync(path.join(tmpLibDir, 'Adult Test', 'part.stl'), stl);
      fs.writeFileSync(path.join(tmpLibDir, 'Adult Test', 'notes.txt'), 'secret notes');
      await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        const st = await apiReq('/api/library/scan/status', { session: adminSession });
        if (st.status === 200 && !st.data.isScanning) break;
      }
      const find = async () => ((await apiReq('/api/models?search=Adult%20Test', { session: adminSession })).data.models || []).filter(m => m.name === 'Adult Test');
      const [model] = await find();
      assert(model, 'Adult Test project was not scanned');

      const mark = await apiReq('/api/models/bulk-update', { method: 'POST', session: adminSession, body: { ids: [model.id], is_adult: true } });
      assert(mark.status === 200, `bulk-update is_adult failed (${mark.status})`);
      const listed = await find();
      assert(listed.length === 1 && listed[0].is_adult === 1, 'A protected model must stay in the list, flagged is_adult');

      // No password yet: the model still opens
      assert((await apiReq(`/api/models/${model.id}`, { session: adminSession })).status === 200, 'Without a password an protected model must open');

      const setPw = await apiReq('/api/settings/adult-password', { method: 'PUT', session: adminSession, body: { password: 'tajne123' } });
      assert(setPw.status === 200, `Setting the password failed (${setPw.status})`);
      const sys = await apiReq('/api/settings/system', { session: adminSession });
      assert(!('adult_password_hash' in sys.data), 'The password hash must never be sent to the client');

      const locked = await apiReq(`/api/models/${model.id}`, { session: adminSession });
      assert(locked.status === 423 && locked.data.locked === true, `Locked protected model must answer 423, got ${locked.status}`);
      const files = (await apiReq(`/api/models/${model.id}`, { session: adminSession, headers: { 'X-Adult-Unlock': 'garbage' } }));
      assert(files.status === 423, 'A forged unlock token must not open the model');

      const wrong = await apiReq(`/api/models/${model.id}/unlock`, { method: 'POST', session: adminSession, body: { password: 'nope' } });
      assert(wrong.status === 403, `Wrong password must be refused, got ${wrong.status}`);
      const ok = await apiReq(`/api/models/${model.id}/unlock`, { method: 'POST', session: adminSession, body: { password: 'tajne123' } });
      assert(ok.status === 200 && ok.data.token, `Right password must unlock, got ${ok.status}`);
      const unlockCookie = (ok.setCookie || '').split(';')[0];
      assert(unlockCookie.startsWith('3dl_adult='), 'Unlock must set the 3dl_adult cookie');

      const open = await apiReq(`/api/models/${model.id}`, { session: adminSession, headers: { 'X-Adult-Unlock': ok.data.token } });
      assert(open.status === 200, `Unlocked protected model must open, got ${open.status}`);
      const txt = open.data.files.find(f => f.original_name === 'notes.txt');

      const get = (url, cookie) => fetch(`${baseUrl}${url}`, { headers: { Cookie: cookie } });
      const withLock = `${adminSession.cookie}`;
      const withUnlock = `${adminSession.cookie}; ${unlockCookie}`;
      assert((await get(txt.url, withLock)).status === 404, 'Library file of a locked protected model must be 404 without the unlock cookie');
      assert((await get(txt.url, withUnlock)).status === 200, 'Library file must load with the unlock cookie');
      assert((await get(`/api/files/${txt.id}/stream`, withLock)).status === 404, 'File stream of a locked protected model must be 404');
      assert((await get(`/api/files/${txt.id}/download?unlock=${ok.data.token}`, withLock)).status === 200, 'A slicer link with ?unlock= must download');
      assert((await get(`/api/models/${model.id}/download`, withLock)).status === 404, 'ZIP of a locked protected model must be 404');

      const other = (await apiReq('/api/models?limit=100', { session: adminSession, })).data.models.find(m => m.id !== model.id);
      if (other) {
        const wrongModel = await apiReq(`/api/models/${other.id}`, { session: adminSession, headers: { 'X-Adult-Unlock': ok.data.token } });
        assert(wrongModel.status === 200, 'An unlock token must not break opening other models');
      }

      await apiReq('/api/settings/adult-password', { method: 'PUT', session: adminSession, body: { password: '' } });
      await apiReq('/api/models/bulk-update', { method: 'POST', session: adminSession, body: { ids: [model.id], is_adult: false } });
    });

    await check('Project files: rename, move, new folder, delete to the Trash, restore, purge; renaming a project renames it on disk', async () => {
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      const lib = (rel) => path.join(tmpLibDir, ...rel.split('/'));
      const put = (rel, data) => { fs.mkdirSync(path.dirname(lib(rel)), { recursive: true }); fs.writeFileSync(lib(rel), data); };
      put('Workshop/base.stl', stl);
      put('Workshop/Parts/arm.stl', stl);
      put('Workshop/Parts/leg.stl', stl);
      put('Workshop/notes.txt', 'notes');
      put('Loose Gear.stl', stl);
      put('Loose Gear.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const scan = async () => {
        await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 100));
          const s = await apiReq('/api/library/scan/status', { session: adminSession });
          if (s.status === 200 && !s.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 30s');
      };
      const byName = async (name) => ((await apiReq(`/api/models?search=${encodeURIComponent(name)}`, { session: adminSession })).data.models || []).find(m => m.name === name);
      const detail = async (id, q = '') => (await apiReq(`/api/models/${id}${q}`, { session: adminSession })).data;
      const names = (list) => (list || []).map(f => f.original_name).sort();
      const fsOp = (id, op, body) => apiReq(`/api/models/${id}/fs/${op}`, { method: 'POST', session: adminSession, body });

      await scan();
      const ws = await byName('Workshop');
      assert(ws, 'Workshop project was not scanned');

      // Rename a file, with name checks
      assert((await fsOp(ws.id, 'rename', { path: 'Parts/arm.stl', name: 'arm-v2.stl' })).status === 200, 'Renaming a file failed');
      assert(fs.existsSync(lib('Workshop/Parts/arm-v2.stl')) && !fs.existsSync(lib('Workshop/Parts/arm.stl')), 'A rename must happen on disk');
      assert(names((await detail(ws.id)).files).includes('Parts/arm-v2.stl'), 'A renamed file must keep its database row under the new name');
      assert((await fsOp(ws.id, 'rename', { path: 'Parts/leg.stl', name: 'bad:name.stl' })).status === 400, 'A name with ":" must be refused');
      assert((await fsOp(ws.id, 'rename', { path: 'Parts/leg.stl', name: 'arm-v2.stl' })).status === 409, 'Renaming onto an existing file must be refused');
      assert((await fsOp(ws.id, 'rename', { path: '../Loose Gear.stl', name: 'x.stl' })).status === 400, 'Paths outside the project must be refused');

      // New folder, move, rename a folder
      assert((await fsOp(ws.id, 'mkdir', { path: '', name: 'Spare' })).status === 200, 'Creating a folder failed');
      assert((await detail(ws.id)).folders.includes('Spare'), 'An empty folder must be listed');
      assert((await fsOp(ws.id, 'move', { paths: ['Parts/leg.stl'], target: 'Spare' })).status === 200, 'Moving a file failed');
      assert(fs.existsSync(lib('Workshop/Spare/leg.stl')), 'A move must happen on disk');
      assert((await fsOp(ws.id, 'rename', { path: 'Parts', name: 'Arms' })).status === 200, 'Renaming a folder failed');
      assert((await fsOp(ws.id, 'move', { paths: ['Arms'], target: 'Arms' })).status === 400, 'A folder cannot move into itself');
      let d = await detail(ws.id);
      assert(JSON.stringify(names(d.files)) === JSON.stringify(['Arms/arm-v2.stl', 'Spare/leg.stl', 'base.stl', 'notes.txt']),
        `Unexpected files after rename/move: ${JSON.stringify(names(d.files))}`);

      // Delete a folder: its files go to the Trash and stay on disk
      assert((await fsOp(ws.id, 'delete', { paths: ['Arms'] })).status === 200, 'Deleting a folder failed');
      d = await detail(ws.id);
      assert(!names(d.files).includes('Arms/arm-v2.stl') && names(d.trash_files).includes('Arms/arm-v2.stl'), 'Deleted files must move to the Trash tab');
      assert(!d.folders.includes('Arms'), 'A folder holding only deleted files must be hidden');
      assert(fs.existsSync(lib('Workshop/Arms/arm-v2.stl')), 'A deleted file stays on disk until it is purged');
      assert((await byName('Workshop')).file_count === 3, 'Deleted files must not count in lists');
      const browse = await apiReq('/api/browse?path=Workshop', { session: adminSession });
      assert(!(browse.data.folders || []).some(f => f.name === 'Arms'), 'The folder browser must hide folders that are in the Trash');
      const trashList = await apiReq('/api/trash', { session: adminSession });
      const trashed = (trashList.data.files || []).find(f => f.original_name === 'Arms/arm-v2.stl');
      assert(trashed && trashList.data.retention_days === 30, 'The Trash must list deleted files and the retention period');
      await scan();
      assert(names((await detail(ws.id)).trash_files).includes('Arms/arm-v2.stl'), 'A scan must not restore deleted files');

      // Restore, then delete and purge for good
      assert((await apiReq('/api/trash/restore', { method: 'POST', session: adminSession, body: { file_ids: [trashed.id] } })).status === 200, 'Restore failed');
      assert(names((await detail(ws.id)).files).includes('Arms/arm-v2.stl'), 'A restored file must be back in Files');
      assert((await apiReq(`/api/files/${trashed.id}`, { method: 'DELETE', session: adminSession })).status === 200, 'Deleting a file failed');
      assert((await apiReq('/api/trash/purge', { method: 'POST', session: adminSession, body: { file_ids: [trashed.id] } })).status === 200, 'Purge failed');
      assert(!fs.existsSync(lib('Workshop/Arms')), 'Purging the last file of a folder must remove the empty folder');
      assert(!names((await detail(ws.id)).trash_files).length, 'A purged file must leave the Trash');
      assert((await fsOp(ws.id, 'mkdir', { path: '', name: 'Empty' })).status === 200 && (await fsOp(ws.id, 'delete', { paths: ['Empty'] })).status === 200
        && !fs.existsSync(lib('Workshop/Empty')), 'An empty folder is removed right away');

      // Renaming the project renames its folder; a loose file takes its same-named image along
      const ren = await apiReq(`/api/models/${ws.id}`, { method: 'PUT', session: adminSession, body: { name: 'Workshop Renamed' } });
      assert(ren.status === 200 && fs.existsSync(lib('Workshop Renamed/base.stl')) && !fs.existsSync(lib('Workshop')), 'Renaming a project must rename its folder');
      const base = (await detail(ws.id)).files.find(f => f.original_name === 'base.stl');
      assert((await fetch(`${baseUrl}${base.url}`, { headers: { Cookie: adminSession.cookie } })).status === 200, 'Files of a renamed project must still load');
      const gear = await byName('Loose Gear');
      assert((await apiReq(`/api/models/${gear.id}`, { method: 'PUT', session: adminSession, body: { name: 'Loose Cog' } })).status === 200, 'Renaming a loose-file project failed');
      assert(fs.existsSync(lib('Loose Cog.stl')) && fs.existsSync(lib('Loose Cog.jpg')) && !fs.existsSync(lib('Loose Gear.jpg')), 'A loose file must be renamed with its same-named image');
      await scan();
      assert(await byName('Loose Cog') && !(await byName('Loose Gear')), 'A scan after a rename must not create duplicates');

      // A deleted model opens only from the Trash, and its purge removes the folder
      assert((await apiReq(`/api/models/${ws.id}`, { method: 'DELETE', session: adminSession })).status === 200, 'Deleting a model failed');
      assert((await apiReq(`/api/models/${ws.id}`, { session: adminSession })).status === 404, 'A deleted model must be 404 outside the Trash');
      assert((await detail(ws.id, '?trash=1')).deleted_at, 'A deleted model must open from the Trash');
      assert(!(await byName('Workshop Renamed')), 'A deleted model must leave the lists');
      assert(((await apiReq('/api/trash', { session: adminSession })).data.models || []).some(m => m.id === ws.id), 'The Trash must list the deleted model');
      assert((await apiReq('/api/trash/purge', { method: 'POST', session: adminSession, body: { model_ids: [ws.id] } })).status === 200, 'Purging a model failed');
      assert(!fs.existsSync(lib('Workshop Renamed')), 'Purging a model must delete its folder');
    });

    await check('Every file gets a unique slicer token; slicer links named "<name>_3dl-<token>.<ext>" download the file', async () => {
      const list = (await apiReq('/api/models?limit=100', { session: adminSession })).data.models || [];
      const tokens = [];
      let sample = null;
      for (const m of list) {
        const d = (await apiReq(`/api/models/${m.id}`, { session: adminSession })).data;
        for (const f of d.files || []) {
          assert(/^[a-z2-9]{8}$/.test(f.slicer_token || ''), `File ${f.original_name} has no valid slicer token: ${f.slicer_token}`);
          tokens.push(f.slicer_token);
          if (!sample && f.library_path && ['stl', '3mf'].includes(f.file_type)) sample = f;
        }
      }
      assert(tokens.length && new Set(tokens).size === tokens.length, 'Slicer tokens must be unique per file');
      const again = (await apiReq(`/api/models/${sample.model_id}`, { session: adminSession })).data.files.find(f => f.id === sample.id);
      assert(again.slicer_token === sample.slicer_token, 'A file must keep its slicer token');
      const { tokenFromName } = require(path.join(ROOT_DIR, 'server/utils/slicerToken'));
      const t = sample.slicer_token;
      assert(tokenFromName(`Xmas_tree_210_3dl-${t}.3mf`) === t, 'The token must be read back from a saved file name');
      assert(tokenFromName(`Xmas_tree_210_3dl-${t}(2).3mf`) === t, 'A "(2)" suffix added by the slicer must not hide the token');
      assert(tokenFromName(`Xmas tree 210 3dl-${t.toUpperCase()}.3mf`) === t, 'Spaces and letter case must not hide the token');
      assert(tokenFromName('model(2).3mf') === null && tokenFromName(`x3dl-${t}.3mf`) === null, 'A name without a token has none');
      const dl = await fetch(`${baseUrl}/api/files/${sample.id}/3mf/Xmas_tree_210_3dl-${t}.3mf`, { headers: { Cookie: adminSession.cookie } });
      assert(dl.status === 200, `A slicer link with the file name and token must download, got ${dl.status}`);
    });

    await check('Slicer saves: downloads are ignored, changed saves become file versions, STL saves add a 3MF, unmatched saves are assigned by hand', async () => {
      const { meshTo3mf } = require(path.join(ROOT_DIR, 'server/utils/3mf'));
      // Each mesh is built once: the 3MF zip stores its creation time, so two builds can differ
      const meshes = {};
      const mesh = (n) => (meshes[n] = meshes[n] || meshTo3mf({ verts: [[0, 0, 0], [n, 0, 0], [0, n, 0]], tris: [[0, 1, 2]] }));
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      const lib = (rel) => path.join(tmpLibDir, ...rel.split('/'));
      const put = (rel, data) => { fs.mkdirSync(path.dirname(lib(rel)), { recursive: true }); fs.writeFileSync(lib(rel), data); };
      const scanLibrary = async () => {
        await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 100));
          const s = await apiReq('/api/library/scan/status', { session: adminSession });
          if (s.status === 200 && !s.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 30s');
      };
      const byName = async (name) => ((await apiReq(`/api/models?search=${encodeURIComponent(name)}`, { session: adminSession })).data.models || []).find(m => m.name === name);
      const detail = async (id) => (await apiReq(`/api/models/${id}`, { session: adminSession })).data;
      const saves = async () => {
        assert((await apiReq('/api/slicer-saves/scan', { method: 'POST', session: adminSession })).status === 200, 'Checking .slicer-saves failed');
        return (await apiReq('/api/slicer-saves', { session: adminSession })).data.saves;
      };
      const download = async (url) => Buffer.from(await (await fetch(`${baseUrl}${url}`, { headers: { Cookie: adminSession.cookie } })).arrayBuffer());
      const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

      put('Gear Box/gear.3mf', mesh(10));
      put('Loose Xmas.stl', stl);
      await scanLibrary();
      await apiReq('/api/settings/system', { method: 'POST', session: adminSession, body: { slicer_quiet_minutes: '0' } });
      const gearModel = await byName('Gear Box');
      const gear = (await detail(gearModel.id)).files.find(f => f.original_name === 'gear.3mf');
      const saveName = `gear_3dl-${gear.slicer_token}.3mf`;

      // The slicer drops the downloaded file into .slicer-saves: not a save
      const sent = await download(`/api/files/${gear.id}/download/${saveName}`);
      put(`.slicer-saves/${saveName}`, sent);
      let s = (await saves()).find(x => x.name === saveName);
      assert(s && s.status === 'download', `An unchanged download must be ignored, got ${s && s.status}`);
      assert(same(fs.readFileSync(lib('Gear Box/gear.3mf')), mesh(10)), 'A download must not touch the library file');

      // A real save replaces the file; the old content goes to its history
      put(`.slicer-saves/${saveName}`, mesh(20));
      s = (await saves()).find(x => x.name === saveName);
      assert(s.status === 'imported' && same(fs.readFileSync(lib('Gear Box/gear.3mf')), mesh(20)), `A changed save must replace the file, got ${s.status} ${s.message || ''}`);
      assert(fs.existsSync(lib('.slicer-saves/' + saveName)), 'A save is copied, not moved');
      let versions = (await apiReq(`/api/files/${gear.id}/versions`, { session: adminSession })).data;
      assert(versions.length === 1 && same(await download(versions[0].url), mesh(10)), 'The replaced content must be kept as a version');
      assert((await saves()).find(x => x.name === saveName).status === 'imported' && (await apiReq(`/api/files/${gear.id}/versions`, { session: adminSession })).data.length === 1,
        'The same save must not be imported twice');
      assert((await detail(gearModel.id)).files.find(f => f.id === gear.id).version_count === 1, 'The model page must show the version count');

      // Restore brings the old content back and keeps the current one as a version
      assert((await apiReq(`/api/files/${gear.id}/versions/${versions[0].id}/restore`, { method: 'POST', session: adminSession })).status === 200, 'Restoring a version failed');
      versions = (await apiReq(`/api/files/${gear.id}/versions`, { session: adminSession })).data;
      assert(same(fs.readFileSync(lib('Gear Box/gear.3mf')), mesh(10)) && versions.length === 2, 'Restore must swap the content and keep both in the history');

      // The scanner skips .versions and .slicer-saves
      await scanLibrary();
      assert(!(await byName('.slicer-saves')), 'The save folder must not become a model');
      assert(JSON.stringify((await detail(gearModel.id)).files.map(f => f.original_name)) === '["gear.3mf"]', 'Versions must not be indexed as files');

      // A 3MF saved from a loose STL: the project becomes a folder and the 3MF its main file
      const xmasModel = await byName('Loose Xmas');
      const xmasStl = (await detail(xmasModel.id)).files[0];
      const xmasSave = `Loose_Xmas_3dl-${xmasStl.slicer_token}.3mf`;
      put(`.slicer-saves/${xmasSave}`, await download(`/api/files/${xmasStl.id}/3mf/${xmasSave}`));
      assert((await saves()).find(x => x.name === xmasSave).status === 'download', 'The converted STL download must be ignored too');
      put(`.slicer-saves/${xmasSave}`, mesh(30));
      s = (await saves()).find(x => x.name === xmasSave);
      assert(s.status === 'imported', `The STL save must be imported, got ${s.status} ${s.message || ''}`);
      assert(fs.existsSync(lib('Loose Xmas/Loose Xmas.stl')) && fs.existsSync(lib('Loose Xmas/Loose Xmas.3mf')) && !fs.existsSync(lib('Loose Xmas.stl')),
        'A loose file must move into a folder of its name, next to the new 3MF');
      const xd = await detail(xmasModel.id);
      const new3mf = xd.files.find(f => f.original_name === 'Loose Xmas.3mf');
      assert(new3mf && xd.preview_file_id === new3mf.id && xd.files.some(f => f.original_name === 'Loose Xmas.stl'), 'The 3MF must become the main file and the STL stay');

      // A save that matches nothing waits to be assigned
      put('.slicer-saves/Mystery_part.3mf', mesh(40));
      s = (await saves()).find(x => x.name === 'Mystery_part.3mf');
      assert(s.status === 'unmatched' && s.clean_name === 'Mystery part.3mf', `A save without a match must wait, got ${s.status}`);
      const created = await apiReq(`/api/slicer-saves/${s.id}/assign`, { method: 'POST', session: adminSession, body: { new_model: true } });
      assert(created.status === 200 && fs.existsSync(lib('Mystery part/Mystery part.3mf')) && await byName('Mystery part'), `Assigning a new model failed: ${JSON.stringify(created.data)}`);
      await apiReq('/api/settings/system', { method: 'POST', session: adminSession, body: { slicer_quiet_minutes: '5' } });
    });

    await check('Slicer saves of one file ("x_3dl-t.3mf", "x_3dl-t(2).3mf"): newest wins, older copies are cleaned up', async () => {
      const { meshTo3mf } = require(path.join(ROOT_DIR, 'server/utils/3mf'));
      const meshes = {};
      const mesh = (n) => (meshes[n] = meshes[n] || meshTo3mf({ verts: [[0, 0, 0], [n, 0, 0], [0, n, 0]], tris: [[0, 1, 2]] }));
      const saves = path.join(tmpLibDir, '.slicer-saves');
      const libFile = path.join(tmpLibDir, 'Gear Box', 'gear.3mf');
      const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
      const check = async () => {
        assert((await apiReq('/api/slicer-saves/scan', { method: 'POST', session: adminSession })).status === 200, 'Checking .slicer-saves failed');
        return (await apiReq('/api/slicer-saves', { session: adminSession })).data.saves;
      };
      const gearModel = ((await apiReq('/api/models?search=Gear%20Box', { session: adminSession })).data.models || []).find(m => m.name === 'Gear Box');
      const gear = (await apiReq(`/api/models/${gearModel.id}`, { session: adminSession })).data.files.find(f => f.original_name === 'gear.3mf');
      const name = (suffix) => `gear_3dl-${gear.slicer_token}${suffix}.3mf`;
      const put = (suffix, data, mtimeSec) => {
        const p = path.join(saves, name(suffix));
        fs.writeFileSync(p, data);
        if (mtimeSec) fs.utimesSync(p, mtimeSec, mtimeSec);
      };
      await apiReq('/api/settings/system', { method: 'POST', session: adminSession, body: { slicer_quiet_minutes: '0' } });
      // Modification times in whole seconds, never in the future (a save still being written)
      const nowSec = async (waitMs) => { await new Promise(r => setTimeout(r, waitMs)); return Math.floor(Date.now() / 1000); };
      const t0 = await nowSec(1100); // newer than the save imported by the test above

      // Opened again while the first copy is still there: the new copy replaces it
      put('(2)', mesh(50), t0);
      let list = await check();
      assert(same(fs.readFileSync(libFile), mesh(50)), 'The newest save must be in the library');
      assert(!fs.existsSync(path.join(saves, name(''))) && fs.existsSync(path.join(saves, name('(2)'))), 'The older, imported copy must be deleted at once');

      // An older save turning up later must not replace a newer one
      put('(3)', mesh(60), t0 - 3600);
      list = await check();
      assert(same(fs.readFileSync(libFile), mesh(50)), 'An older save must not go back in time');
      assert(!fs.existsSync(path.join(saves, name('(3)'))) && !list.some(s => s.name === name('(3)')), 'An older save of a file with a newer copy is deleted at once');

      // Two new saves in one pass: imported oldest first, whatever their names
      const t1 = await nowSec(2100);
      put('(7)', mesh(70), t1);
      put('(8)', mesh(80), t1 - 1);
      list = await check();
      assert(same(fs.readFileSync(libFile), mesh(70)), 'Saves must be imported in the order they were saved');
      assert(fs.existsSync(path.join(saves, name('(7)'))) && !fs.existsSync(path.join(saves, name('(8)'))) && !fs.existsSync(path.join(saves, name('(2)'))),
        'Only the newest copy of a file may stay');

      // Clean up now: nothing that holds anything new is left
      const cleaned = await apiReq('/api/slicer-saves/cleanup', { method: 'POST', session: adminSession });
      assert(cleaned.status === 200 && cleaned.data.removed >= 2, `Clean up now failed: ${JSON.stringify(cleaned.data)}`);
      assert(!fs.readdirSync(saves).some(n => n.startsWith(`gear_3dl-${gear.slicer_token}`)), 'Clean up now must delete imported and older copies');
      await apiReq('/api/settings/system', { method: 'POST', session: adminSession, body: { slicer_quiet_minutes: '5' } });
    });

    await check('Regenerate covers lists viewer-rendered and missing covers, not covers from images', async () => {
      const pending = async () => (await apiReq('/api/covers/pending', { session: adminSession })).data.models || [];
      const find = async (name) => ((await apiReq(`/api/models?search=${encodeURIComponent(name)}`, { session: adminSession })).data.models || []).find(m => m.name === name);
      const gear = await find('Gear Box');
      const benchy = await find('Loose Benchy');
      assert((await pending()).some(m => m.id === gear.id && m.reason === 'missing' && m.url), 'A model without a cover must be listed as missing');
      assert(!(await pending()).some(m => m.id === benchy.id), 'A cover taken from an image of the project must be kept');
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      const form = new FormData();
      form.append('thumbnail', new Blob([png], { type: 'image/png' }), `thumb_${gear.id}.png`);
      const up = await apiReq(`/api/models/${gear.id}/thumbnail`, { method: 'POST', session: adminSession, body: form });
      assert(up.status === 200, `Uploading a viewer cover failed (${up.status})`);
      assert((await pending()).some(m => m.id === gear.id && m.reason === 'viewer'), 'A cover rendered by the viewer must be listed for regeneration');
      assert((await apiReq('/api/covers/pending', { session: viewerSession })).status === 403, 'Only an admin may regenerate covers');

      // A preview rendered for a file in the Folder Explorer is stored, so it is rendered once
      const gearFile = (await apiReq(`/api/models/${gear.id}`, { session: adminSession })).data.files.find(f => f.file_type === '3mf');
      const fileForm = new FormData();
      fileForm.append('thumbnail', new Blob([png], { type: 'image/png' }), `preview_${gearFile.id}.png`);
      const fileUp = await apiReq(`/api/files/${gearFile.id}/thumbnail`, { method: 'POST', session: adminSession, body: fileForm });
      assert(fileUp.status === 200, `Storing a file preview failed (${fileUp.status})`);
      const browsed = (await apiReq('/api/browse?path=Gear%20Box', { session: adminSession })).data.files || [];
      const gearCard = browsed.find(f => f.id === gearFile.id);
      assert(gearCard && gearCard.thumbnailUrl === `/uploads/${fileUp.data.thumbnail}`, `The Folder Explorer must show the stored preview, got ${gearCard && gearCard.thumbnailUrl}`);
      const viewerForm = new FormData();
      viewerForm.append('thumbnail', new Blob([png], { type: 'image/png' }), 'x.png');
      assert((await apiReq(`/api/files/${gearFile.id}/thumbnail`, { method: 'POST', session: viewerSession, body: viewerForm })).status === 403, 'A viewer must not store file previews');

      // A collection shows the covers of the model list (a cover may be an image in the project folder)
      const col = await apiReq('/api/projects', { method: 'POST', session: adminSession, body: { name: 'Cover check' } });
      await apiReq(`/api/projects/${col.data.id}/models/bulk`, { method: 'POST', session: adminSession, body: { model_ids: [gear.id, benchy.id] } });
      const inCollection = (await apiReq(`/api/projects/${col.data.id}`, { session: adminSession })).data.models || [];
      for (const listed of [await find('Gear Box'), benchy]) {
        const m = inCollection.find(x => x.id === listed.id);
        assert(m && m.thumbnail === listed.thumbnail, `A collection must show the list cover of ${listed.name}: ${m && m.thumbnail} vs ${listed.thumbnail}`);
        assert(!m.stl_file || m.stl_file.startsWith('/'), `stl_file of a collection model must be a URL, got ${m.stl_file}`);
      }
      assert((await fetch(`${baseUrl}${inCollection.find(x => x.id === benchy.id).thumbnail}`, { headers: { Cookie: adminSession.cookie } })).status === 200,
        'An image cover of a collection model must load');
    });

    await check('Small cover images: /thumbs resizes and caches library images, with the same access rules', async () => {
      const sharp = require('sharp');
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      const dir = path.join(tmpLibDir, 'Photo Project');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'part.stl'), stl);
      const photo = (r) => sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r, g: 80, b: 120 } } }).png().toBuffer();
      fs.writeFileSync(path.join(dir, 'a-photo.png'), await photo(200));
      fs.writeFileSync(path.join(dir, 'b-photo.png'), await photo(20));
      await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (!(await apiReq('/api/library/scan/status', { session: adminSession })).data.isScanning) break;
      }
      const model = ((await apiReq('/api/models?search=Photo%20Project', { session: adminSession })).data.models || []).find(m => m.name === 'Photo Project');
      assert(model && /^\/library-files\/.*\.png$/.test(model.thumbnail), `The project cover must be one of its photos, got ${model && model.thumbnail}`);

      const img = (u, w = 480, cookie = adminSession.cookie) => fetch(`${baseUrl}/thumbs?w=${w}&u=${encodeURIComponent(u)}`, { headers: { Cookie: cookie }, redirect: 'manual' });
      const small = await img(model.thumbnail);
      assert(small.status === 200 && small.headers.get('content-type') === 'image/webp', `/thumbs must answer a WebP, got ${small.status} ${small.headers.get('content-type')}`);
      const meta = await sharp(Buffer.from(await small.arrayBuffer())).metadata();
      assert(meta.width === 480 && meta.height === 360, `A 2000x1500 photo must come back as 480x360, got ${meta.width}x${meta.height}`);
      const cacheDir = path.join(tmpDataDir, 'cache', 'img');
      const cachedCount = fs.readdirSync(cacheDir).length;
      assert((await img(model.thumbnail)).status === 200 && fs.readdirSync(cacheDir).length === cachedCount, 'The second request must come from the cache');
      assert((await img('/library-files/../../etc/passwd.png')).status === 400, 'Paths outside the library must be refused');
      assert((await img('/library-files/Photo%20Project/part.stl')).status === 400, 'Only images are resized');

      // A protected model keeps its other images hidden; its cover stays reachable
      await apiReq('/api/models/bulk-update', { method: 'POST', session: adminSession, body: { ids: [model.id], is_adult: true } });
      await apiReq('/api/settings/adult-password', { method: 'PUT', session: adminSession, body: { password: 'tajne123' } });
      const other = model.thumbnail.includes('a-photo') ? '/library-files/Photo%20Project/b-photo.png' : '/library-files/Photo%20Project/a-photo.png';
      assert((await img(other)).status === 404, 'An image of a locked protected model must be 404');
      assert((await img(model.thumbnail)).status === 200, 'The cover of a protected model stays reachable (shown blurred)');
      await apiReq('/api/settings/adult-password', { method: 'PUT', session: adminSession, body: { password: '' } });
      await apiReq('/api/models/bulk-update', { method: 'POST', session: adminSession, body: { ids: [model.id], is_adult: false } });
    });

    await check('ZIP downloads stream from disk: subfolders kept, exact Content-Length, one folder per model in collections', async () => {
      const AdmZip = require('adm-zip');
      const stl = 'solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 0 0\nvertex 0 5 0\nendloop\nendfacet\nendsolid p\n';
      const big = require('crypto').randomBytes(3 * 1024 * 1024);
      const dir = path.join(tmpLibDir, 'Zip Project');
      fs.mkdirSync(path.join(dir, 'Sub Folder'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'part.stl'), stl);
      fs.writeFileSync(path.join(dir, 'Sub Folder', 'inner.stl'), stl);
      fs.writeFileSync(path.join(dir, 'Sub Folder', 'big.stl'), big);
      await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (!(await apiReq('/api/library/scan/status', { session: adminSession })).data.isScanning) break;
      }
      const model = ((await apiReq('/api/models?search=Zip%20Project', { session: adminSession })).data.models || []).find(m => m.name === 'Zip Project');
      assert(model, 'The library folder "Zip Project" must become a model');

      const download = async (url) => {
        const res = await fetch(`${baseUrl}${url}`, { headers: { Cookie: adminSession.cookie } });
        assert(res.status === 200, `${url} must answer 200, got ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert(Number(res.headers.get('content-length')) === buf.length, `${url}: Content-Length ${res.headers.get('content-length')} must be the exact size ${buf.length}`);
        return { zip: new AdmZip(buf), disposition: res.headers.get('content-disposition') || '' };
      };
      const names = (zip) => zip.getEntries().map(e => e.entryName).sort().join(', ');

      const one = await download(`/api/models/${model.id}/download`);
      assert(one.disposition.includes('filename="Zip Project.zip"'), `Unexpected Content-Disposition: ${one.disposition}`);
      assert(names(one.zip) === 'Sub Folder/big.stl, Sub Folder/inner.stl, part.stl', `The model ZIP must keep the subfolders, got: ${names(one.zip)}`);
      assert(one.zip.getEntry('Sub Folder/big.stl').getData().equals(big), 'A file must come out of the ZIP unchanged');

      const coll = await apiReq('/api/projects', { method: 'POST', session: adminSession, body: { name: 'Zip Collection', visibility: 'public' } });
      await apiReq(`/api/projects/${coll.data.id}/models`, { method: 'POST', session: adminSession, body: { model_id: model.id } });
      const all = await download(`/api/projects/${coll.data.id}/download`);
      assert(names(all.zip) === 'Zip Project/Sub Folder/big.stl, Zip Project/Sub Folder/inner.stl, Zip Project/part.stl', `The collection ZIP must hold one folder per model, got: ${names(all.zip)}`);
      await apiReq(`/api/projects/${coll.data.id}`, { method: 'DELETE', session: adminSession });
    });

    await check('Kit configurators: a selection of files downloads as a streamed ZIP with its parts list; saved configurations belong to their user', async () => {
      const AdmZip = require('adm-zip');
      const model = ((await apiReq('/api/models?search=Zip%20Project', { session: adminSession })).data.models || []).find(m => m.name === 'Zip Project');
      const detail = (await apiReq(`/api/models/${model.id}`, { session: adminSession })).data;
      const fileId = (name) => detail.files.find(f => f.original_name === name).id;
      const other = (await apiReq(`/api/models/${createdModelId}`, { session: adminSession })).data.files[0];
      const body = { file_ids: [fileId('part.stl'), fileId('Sub Folder/inner.stl')], name: 'VAULT L4', text: { name: 'VAULT parts list.txt', content: 'parts: 2\n' } };

      const noCsrf = await apiReq(`/api/models/${model.id}/download-selection`, { method: 'POST', session: adminSession, includeCsrf: false, body });
      assert(noCsrf.status === 403, `A selection needs the CSRF token, got ${noCsrf.status}`);
      const foreign = await apiReq(`/api/models/${model.id}/download-selection`, { method: 'POST', session: adminSession, body: { file_ids: [other.id] } });
      assert(foreign.status === 400, `Files of another model must be refused, got ${foreign.status}`);
      const prepared = await apiReq(`/api/models/${model.id}/download-selection`, { method: 'POST', session: adminSession, body });
      assert(prepared.status === 200 && /^\/api\/models\/\d+\/download-selection\/[0-9a-f]{32}$/.test(prepared.data.url), `Unexpected answer: ${JSON.stringify(prepared.data)}`);

      const res = await fetch(`${baseUrl}${prepared.data.url}`, { headers: { Cookie: adminSession.cookie } });
      assert(res.status === 200, `The selection must download, got ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      assert(Number(res.headers.get('content-length')) === buf.length, 'The selection ZIP must have an exact Content-Length');
      assert((res.headers.get('content-disposition') || '').includes('filename="VAULT L4.zip"'), `Unexpected name: ${res.headers.get('content-disposition')}`);
      const zip = new AdmZip(buf);
      const names = zip.getEntries().map(e => e.entryName).sort().join(', ');
      assert(names === 'Sub Folder/inner.stl, VAULT parts list.txt, part.stl', `Only the chosen files and the parts list: ${names}`);
      assert(zip.getEntry('VAULT parts list.txt').getData().toString() === 'parts: 2\n', 'The parts list must be in the ZIP');
      assert((await fetch(`${baseUrl}${prepared.data.url}`)).status === 404, 'The link only works for the user who asked for it');
      assert((await fetch(`${baseUrl}/api/models/${model.id}/download-selection/${'0'.repeat(32)}`, { headers: { Cookie: adminSession.cookie } })).status === 404, 'Unknown tokens are 404');

      // Saved configurations: per user and model
      const url = `/api/models/${model.id}/kit-configs`;
      assert((await apiReq(url, { method: 'POST', session: adminSession, body: { kit: 'ussa-vault', name: ' ', config: {} } })).status === 400, 'A configuration needs a name');
      assert((await apiReq(url, { method: 'POST', session: adminSession, body: { kit: 'No Kit', name: 'x', config: {} } })).status === 400, 'Kit names are checked');
      const saved = await apiReq(url, { method: 'POST', session: adminSession, body: { kit: 'ussa-vault', name: 'Garage  tower', config: { v: 1, width: 'L', depth: 4 } } });
      assert(saved.status === 201 && saved.data.name === 'Garage tower' && saved.data.config.width === 'L', `Save failed: ${JSON.stringify(saved.data)}`);
      const renamed = await apiReq(`${url}/${saved.data.id}`, { method: 'PUT', session: adminSession, body: { name: 'Desk tower' } });
      assert(renamed.status === 200 && renamed.data.name === 'Desk tower' && renamed.data.config.depth === 4, 'Renaming keeps the configuration');
      const list = await apiReq(`${url}?kit=ussa-vault`, { session: adminSession });
      assert(list.data.length === 1 && list.data[0].id === saved.data.id, `Expected one saved configuration, got ${JSON.stringify(list.data)}`);

      const login = await apiReq('/api/auth/login', { method: 'POST', body: { username: 'maker_user', password: 'UserPass123!' } });
      const maker = { cookie: (login.setCookie || '').split(';')[0], csrfToken: login.data.csrfToken };
      assert((await apiReq(`${url}?kit=ussa-vault`, { session: maker })).data.length === 0, "Another user must not see someone's configurations");
      assert((await apiReq(`${url}/${saved.data.id}`, { method: 'PUT', session: maker, body: { name: 'Mine' } })).status === 404, "Another user must not change someone's configuration");
      assert((await apiReq(`${url}/${saved.data.id}`, { method: 'DELETE', session: maker })).status === 404, "Another user must not delete someone's configuration");
      assert((await apiReq(`${url}/${saved.data.id}`, { method: 'DELETE', session: adminSession })).status === 200, 'The owner deletes a configuration');
      assert((await apiReq(url, { session: adminSession })).data.length === 0, 'A deleted configuration is gone');
    });

    await check('Printer fit: the three default printers, an edited list, sizes of a model measured in the background', async () => {
      const beds = await apiReq('/api/printer-beds');
      assert(beds.status === 200 && beds.data.map(b => b.id).join() === 'bambu-p1s,snapmaker-u1,creality-sparkx-i8', `Default printers: ${JSON.stringify(beds.data)}`);
      assert(beds.data[2].x === 260 && beds.data[2].z === 255, 'SparkX i8: 260 × 260 × 255 mm');
      assert((await apiReq('/api/printer-beds', { method: 'PUT', session: adminSession, body: [{ name: 'Tiny', x: 5, y: 5, z: 5 }] })).status === 400, 'A build volume under 10 mm is refused');
      const login = await apiReq('/api/auth/login', { method: 'POST', body: { username: 'maker_user', password: 'UserPass123!' } });
      const maker = { cookie: (login.setCookie || '').split(';')[0], csrfToken: login.data.csrfToken };
      assert((await apiReq('/api/printer-beds', { method: 'PUT', session: maker, body: beds.data })).status === 403, 'Only an admin changes the printers');
      const saved = await apiReq('/api/printer-beds', { method: 'PUT', session: adminSession, body: [...beds.data, { name: 'Voron 2.4 350', x: 350, y: 350, z: 340, margin: 2 }] });
      assert(saved.status === 200 && saved.data.length === 4 && saved.data[3].id === 'voron-2-4-350', `Saved printers: ${JSON.stringify(saved.data)}`);
      assert((await apiReq('/api/printer-beds')).data.length === 4, 'The edited list is kept');
      await apiReq('/api/printer-beds', { method: 'PUT', session: adminSession, body: beds.data });

      // The STL files of a library project get their sizes
      const model = ((await apiReq('/api/models?search=Zip%20Project', { session: adminSession })).data.models || []).find(m => m.name === 'Zip Project');
      let sizes;
      for (let i = 0; i < 100; i++) {
        sizes = await apiReq(`/api/models/${model.id}/sizes`, { session: adminSession });
        if (sizes.data.pending === 0) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const files = (await apiReq(`/api/models/${model.id}`, { session: adminSession })).data.files;
      const part = files.find(f => f.original_name === 'part.stl');
      const big = files.find(f => f.original_name === 'Sub Folder/big.stl');
      assert(sizes.data.pending === 0, `All files measured, ${sizes.data.pending} still waiting`);
      assert(JSON.stringify(sizes.data.sizes[part.id]) === '[5,5,0]', `part.stl is 5 × 5 × 0 mm, got ${JSON.stringify(sizes.data.sizes[part.id])}`);
      assert(sizes.data.errors[big.id] || sizes.data.sizes[big.id], 'Random bytes as an STL are measured or marked as failed, never left waiting');
      assert(part.dim_x === 5 && part.dim_bytes === part.file_size, 'The model page gets the size with its files');

      // The model list: a badge per model and the "Fits my printer" filter
      const longBar = 'solid l\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 400 0 0\nvertex 0 10 10\nendloop\nendfacet\nendsolid l\n';
      fs.mkdirSync(path.join(tmpLibDir, 'Long Bar'), { recursive: true });
      fs.writeFileSync(path.join(tmpLibDir, 'Long Bar', 'bar.stl'), longBar);
      await apiReq('/api/library/scan', { method: 'POST', session: adminSession });
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (!(await apiReq('/api/library/scan/status', { session: adminSession })).data.isScanning) break;
      }
      const bar = ((await apiReq('/api/models?search=Long%20Bar', { session: adminSession })).data.models || []).find(m => m.name === 'Long Bar');
      for (let i = 0; i < 100 && (await apiReq(`/api/models/${bar.id}/sizes`, { session: adminSession })).data.pending; i++) await new Promise(r => setTimeout(r, 200));
      const listed = (await apiReq('/api/models?limit=96', { session: adminSession })).data.models;
      const barFit = listed.find(m => m.id === bar.id).fit;
      const zipFit = listed.find(m => m.id === model.id).fit;
      assert(barFit && barFit.total === 1 && barFit.misfit.any === 1 && barFit.misfit['bambu-p1s'] === 1, `A 400 mm bar fits none of the printers: ${JSON.stringify(barFit)}`);
      assert(zipFit && zipFit.misfit.any === 0 && zipFit.pending === 0, `Zip Project fits: ${JSON.stringify(zipFit)}`);
      const fitting = (await apiReq('/api/models?fits=bambu-p1s&limit=96', { session: adminSession })).data.models.map(m => m.name);
      assert(fitting.includes('Zip Project') && !fitting.includes('Long Bar'), `Fits my printer: ${fitting.join(', ')}`);
      assert(!(await apiReq('/api/models?fits=any&limit=96', { session: adminSession })).data.models.some(m => m.name === 'Long Bar'), 'Fits any printer: not the long bar');
      const card = (await apiReq('/api/models?search=Long%20Bar', { session: adminSession })).data.models[0];
      assert(card.fit.misfit.any === 1, 'The search results carry the fit too');
    });

    await check('Authorized Admin CAN delete models (single & bulk)', async () => {
      const delRes = await apiReq(`/api/models/${createdModelId}?deleteDisk=true`, {
        method: 'DELETE',
        session: adminSession
      });
      assert(delRes.status === 200, `Admin DELETE /api/models/:id failed (${delRes.status}): ${JSON.stringify(delRes.data)}`);

      const afterGet = await apiReq(`/api/models/${createdModelId}`, { session: adminSession });
      assert(afterGet.status === 404, `Expected 404 after delete, got ${afterGet.status}`);

      const m2 = await apiReq('/api/models', { method: 'POST', session: adminSession, body: { name: 'Bulk Del 1' } });
      const m3 = await apiReq('/api/models', { method: 'POST', session: adminSession, body: { name: 'Bulk Del 2' } });
      const bulkDel = await apiReq('/api/models/bulk-delete', {
        method: 'POST',
        session: adminSession,
        body: { ids: [m2.data.id, m3.data.id], deleteDisk: true }
      });
      assert(bulkDel.status === 200, `Bulk delete failed: ${JSON.stringify(bulkDel.data)}`);
    });

  } finally {
    serverProc.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  }
}

(async () => {
  console.log('\x1b[1;36m═══ 3DLib Automated Pre-Release Verification Suite ═══\x1b[0m');
  const start = Date.now();
  await runStaticAndUiChecks();
  await runE2ETests();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n\x1b[1mSummary:\x1b[0m \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m (${elapsed}s)`);
  if (failed > 0) {
    process.exit(1);
  }
})();