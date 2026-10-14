/**
 * GyroidVault Automated Pre-Release Test Suite
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

  vm.createContext(sandbox);
  vm.runInContext(`${apiCode}\n${compCode}\n${appCode}\nthis.__API = API; this.__UI = UI; this.__App = App;`, sandbox);

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
      ['UI.deleteEntryForm', () => UI.deleteEntryForm('Parts', true)]
    ];

    for (const [label, fn] of renders) {
      const html = fn();
      assert(typeof html === 'string' && html.trim().length > 10, `${label} returned empty or non-string output`);
    }
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

  await check('WhatsNew popup only triggers once and Detail Header CSS does not overflow button row (Issues #79 & #80 guard)', () => {
    let openedCount = 0;
    const origOpen = App.openWhatsNew;
    App.openWhatsNew = function () {
      openedCount++;
      sandbox.localStorage.setItem('gv_last_seen_version', this.WHATS_NEW_VERSION || '2.0.2');
    };
    const origSetTimeout = sandbox.setTimeout;
    sandbox.setTimeout = (fn) => { fn(); return 1; };

    // Legacy '2.0.0' seen value should be recognized and NOT trigger popup
    sandbox.localStorage.setItem('gv_last_seen_version', '2.0.0');
    App.checkWhatsNew();
    assert(openedCount === 0, 'Expected checkWhatsNew not to open when gv_last_seen_version is 2.0.0 (Issue #79)');
    assert(sandbox.localStorage.getItem('gv_last_seen_version') === App.WHATS_NEW_VERSION, 'Expected 2.0.0 to upgrade to WHATS_NEW_VERSION');

    // Fresh user: triggers once, then subsequent refreshes never trigger again
    sandbox.localStorage.removeItem('gv_last_seen_version');
    App.checkWhatsNew();
    assert(openedCount === 1, 'Expected checkWhatsNew to open once for fresh user');
    App.checkWhatsNew();
    assert(openedCount === 1, 'Expected checkWhatsNew NOT to open on second refresh (Issue #79)');

    sandbox.setTimeout = origSetTimeout;
    App.openWhatsNew = origOpen;

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

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gyroidvault-test-'));
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
    while (Date.now() - start < 8000) {
      try {
        const r = await fetch(`${baseUrl}/healthz`);
        if (r.ok) return;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Server did not start within 8s. Logs:\n${serverLogs}`);
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
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          const st = await apiReq('/api/library/scan/status', { session: adminSession });
          if (st.status === 200 && !st.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 4s');
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
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 100));
          const s = await apiReq('/api/library/scan/status', { session: adminSession });
          if (s.status === 200 && !s.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 6s');
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
      for (let i = 0; i < 60; i++) {
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
      assert(unlockCookie.startsWith('gv_adult='), 'Unlock must set the gv_adult cookie');

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
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 100));
          const s = await apiReq('/api/library/scan/status', { session: adminSession });
          if (s.status === 200 && !s.data.isScanning) return;
        }
        throw new Error('Library scanner did not complete within 6s');
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
  console.log('\x1b[1;36m═══ GyroidVault Automated Pre-Release Verification Suite ═══\x1b[0m');
  const start = Date.now();
  await runStaticAndUiChecks();
  await runE2ETests();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n\x1b[1mSummary:\x1b[0m \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m (${elapsed}s)`);
  if (failed > 0) {
    process.exit(1);
  }
})();