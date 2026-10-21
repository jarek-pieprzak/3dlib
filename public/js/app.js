const App = {
  el: null,
  currentUser: null,
  searchTimeout: null,
  cache: { categories: [], tags: [], materials: [], users: [] },
  pendingFiles: [],
  selectedModelIds: [],
  lastSelectedModelId: null,
  selectedBrowsePaths: [],
  versionInfo: null,
  libraryViewMode: 'grid',

  // ── Init ──
  async init() {
    this.el = document.getElementById('app');
    // The 3D Studio part selector switched files: follow it in the file list
    document.addEventListener('gv:preview-file', (e) => this.highlightPreviewFile(e.detail && e.detail.fileId));
    // Slicer menus inside the scrolling file list open upwards when there is no room below
    document.addEventListener('mouseover', (e) => {
      const dd = e.target.closest && e.target.closest('.detail-files-body .dropdown');
      if (!dd) return;
      const list = dd.closest('.detail-files-body');
      dd.classList.toggle('drop-up', list.getBoundingClientRect().bottom - dd.getBoundingClientRect().bottom < 200);
    });
    const savedUser = localStorage.getItem('pv_user');
    if (savedUser) {
      try { this.currentUser = JSON.parse(savedUser); } catch(e) { localStorage.removeItem('pv_user'); }
    }
    
    if (this.currentUser) {
      try {
        const user = await API.getMe();
        if (user && user.csrfToken) {
          localStorage.setItem('pv_csrf_token', user.csrfToken);
          this.currentUser = user;
          localStorage.setItem('pv_user', JSON.stringify(user));
        } else {
          localStorage.removeItem('pv_user');
          localStorage.removeItem('pv_csrf_token');
          this.currentUser = null;
        }
      } catch (e) {
        localStorage.removeItem('pv_user');
        localStorage.removeItem('pv_csrf_token');
        this.currentUser = null;
      }
    }
    
    try {
      this.publicConfig = await API.getPublicConfig();
    } catch(e) { this.publicConfig = {}; }

    // Auto-resume scan monitoring if background scan is active
    if (this.currentUser && this.currentUser.role === 'admin') {
      fetch('/api/library/scan/status', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .then(status => {
          if (status && status.isScanning) {
            this.monitorScanProgress();
          }
        })
        .catch(() => {});
    }
    
    if (this.publicConfig.require_login_to_view && !this.currentUser) {
      document.getElementById('app').innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-color)"><h1 style="margin-bottom:20px">GyroidVault</h1><button class="btn btn-primary btn-lg" onclick="App.showLogin()">Login to Access GyroidVault</button></div>';
      this.showLogin();
      return;
    }
    
    // An unlock from an earlier page load must not open a protected model without the password
    this.adultUnlock = null;
    API.lockAdult().catch(() => {});
    window.addEventListener('hashchange', () => this.route());
    
    // Setup keyboard shortcuts (Ctrl+K for search, Ctrl+B for sidebar toggle)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('topbar-search-input') || document.getElementById('search-input');
        if (input) { input.focus(); input.select(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.toggleSidebarCollapse();
      }
    });

    // Restore sidebar collapse state
    const savedCollapsed = localStorage.getItem('gv_sidebar_collapsed') === 'true';
    if (savedCollapsed) {
      document.getElementById('app-sidebar')?.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }

    await this.loadCache();
    await this.loadViewMode();
    this.renderSidebarCategories();
    this.renderSidebarCollections();
    this.checkUpdates();
    this.updateUserNav();
    this.updateThemeIcon();
    this.initPrinters();
    this.route();
    this.checkWhatsNew();
  },

  WHATS_NEW_VERSION: '2.0.2',

  checkWhatsNew() {
    const seenVersion = localStorage.getItem('gv_last_seen_version');
    // Recognize both '2.0.0' (saved by previous versions) and current WHATS_NEW_VERSION so it never repeats on refresh (#79)
    if (seenVersion === '2.0.0' || seenVersion === this.WHATS_NEW_VERSION) {
      if (seenVersion !== this.WHATS_NEW_VERSION) {
        localStorage.setItem('gv_last_seen_version', this.WHATS_NEW_VERSION);
      }
      return;
    }
    localStorage.setItem('gv_last_seen_version', this.WHATS_NEW_VERSION);
    setTimeout(() => {
      this.openWhatsNew();
    }, 500);
  },

  async openWhatsNew() {
    localStorage.setItem('gv_last_seen_version', this.WHATS_NEW_VERSION || '2.0.2');
    try {
      const res = await API.getReleaseNotes().catch(() => ({ notes: [] }));
      this.cachedReleaseNotes = res.notes || [];
      this.openModal('Welcome to GyroidVault 2.0', UI.whatsNewModal('2.2.1', this.cachedReleaseNotes), 'modal-lg');
    } catch (e) {
      this.openModal('Welcome to GyroidVault 2.0', UI.whatsNewModal('2.2.1', []), 'modal-lg');
    }
  },

  switchWhatsNewTab(tab) {
    const highlightsContent = document.getElementById('whatsnew-content-highlights');
    const changelogContent = document.getElementById('whatsnew-content-changelog');
    const highlightsBtn = document.getElementById('whatsnew-tab-btn-highlights');
    const changelogBtn = document.getElementById('whatsnew-tab-btn-changelog');

    if (tab === 'highlights') {
      if (highlightsContent) highlightsContent.style.display = 'block';
      if (changelogContent) changelogContent.style.display = 'none';
      if (highlightsBtn) highlightsBtn.classList.add('active');
      if (changelogBtn) changelogBtn.classList.remove('active');
    } else {
      if (highlightsContent) highlightsContent.style.display = 'none';
      if (changelogContent) changelogContent.style.display = 'block';
      if (highlightsBtn) highlightsBtn.classList.remove('active');
      if (changelogBtn) changelogBtn.classList.add('active');
    }
  },

  selectWhatsNewVersion(ver) {
    const note = (this.cachedReleaseNotes || []).find(n => n.version === ver);
    const body = document.getElementById('whatsnew-changelog-body');
    if (note && body) {
      body.innerHTML = UI.renderMarkdown(note.content);
    }
    document.querySelectorAll('.changelog-version-pill').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`whatsnew-ver-${ver.replace(/\./g, '-')}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
  },

  dismissWhatsNew() {
    localStorage.setItem('gv_last_seen_version', this.WHATS_NEW_VERSION || '2.0.2');
    this.closeModal();
  },

  toggleSidebarCollapse() {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
    localStorage.setItem('gv_sidebar_collapsed', isCollapsed);
  },

  toggleMobileSidebar(force = null) {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    const isOpen = force !== null ? force : !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', isOpen);
    if (backdrop) backdrop.classList.toggle('active', isOpen);
  },

  renderSidebarCategories() {
    const list = document.getElementById('sidebar-categories-list');
    const group = document.getElementById('sidebar-categories-group');
    if (!list) return;
    if (!this.cache.categories || this.cache.categories.length === 0) {
      if (group) group.style.display = 'none';
      return;
    }
    if (group) group.style.display = 'flex';
    list.innerHTML = this.cache.categories.slice(0, 10).map(c => `
      <a href="#/models?category=${c.id}" class="sidebar-sub-item" title="${c.name}">
        <span class="dot" style="background:${c.color || 'var(--accent-cyan)'}"></span>
        <span>${c.name}</span>
      </a>
    `).join('');
  },

  async renderSidebarCollections() {
    const list = document.getElementById('sidebar-collections-list');
    const group = document.getElementById('sidebar-collections-group');
    if (!list) return;
    if (!this.currentUser) {
      if (group) group.style.display = 'none';
      return;
    }
    try {
      const projects = await API.getProjects();
      if (!projects || projects.length === 0) {
        list.innerHTML = `<span style="font-size:0.75rem;color:var(--text-muted);padding:4px 10px;font-style:italic">No collections yet</span>`;
        if (group) group.style.display = 'flex';
        return;
      }
      if (group) group.style.display = 'flex';
      list.innerHTML = projects.slice(0, 8).map(p => `
        <a href="#/projects/${p.id}" class="sidebar-sub-item" title="${p.name} (${p.model_count || 0} models)">
          <span style="display:inline-flex;align-items:center;color:${p.visibility === 'private' ? 'var(--accent-purple)' : '#f59e0b'};opacity:0.95">
            ${p.visibility === 'private'
              ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
              : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            }
          </span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${p.name}</span>
          <span style="font-size:0.65rem;color:var(--text-muted)">${p.model_count || 0}</span>
        </a>
      `).join('');
    } catch(e) {
      if (group) group.style.display = 'none';
    }
  },

  handleTopSearch(query) {
    clearTimeout(this.topSearchTimeout);
    this.topSearchTimeout = setTimeout(() => {
      const q = (query || '').trim();
      if (location.hash.startsWith('#/models')) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.value = q;
          this.handleFilter();
        } else {
          this.navigate(q ? `/models?search=${encodeURIComponent(q)}` : '/models');
        }
      } else if (location.hash.startsWith('#/collections') || location.hash.startsWith('#/projects')) {
        this.collectionsSearchQuery = q;
        this.updateCollectionsGrid();
      } else if (q) {
        this.navigate(`/models?search=${encodeURIComponent(q)}`);
      }
    }, 200);
  },

  async initPrinters() {
    if (!this.currentUser || this.currentUser.role !== 'admin') return;
    try {
      const config = await API.getSystemSettings();
      if (!config.printers) return;
      const printers = JSON.parse(config.printers);
      if (!printers || printers.length === 0) return;
      
      const container = document.getElementById('nav-printers-widget');
      if (!container) return;
      
      this.printerSockets = this.printerSockets || {};
      this.printerStatus = this.printerStatus || {};
      
      container.innerHTML = printers.map(p => `
        <div id="printer-widget-${p.id}" class="sidebar-printer-card">
          <div class="sidebar-printer-header">
            <span style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis">
              <span class="status-dot" style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);display:inline-block;flex-shrink:0"></span>
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span>
            </span>
          </div>
          <div class="sidebar-printer-temps" style="display:none">
            <span class="nozzle-temp">N: --°C</span>
            <span class="bed-temp">B: --°C</span>
          </div>
        </div>
      `).join('');
      
      printers.forEach(p => {
        if (this.printerSockets[p.id]) return;
        
        try {
          const wsUrl = new URL('/websocket', p.url);
          wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
          const ws = new WebSocket(wsUrl.toString());
          this.printerSockets[p.id] = ws;
          
          ws.onopen = () => {
            const widget = document.getElementById(`printer-widget-${p.id}`);
            if(widget) {
              const dot = widget.querySelector('.status-dot');
              if (dot) dot.style.background = 'var(--accent-green)';
              const temps = widget.querySelector('.sidebar-printer-temps');
              if (temps) temps.style.display = 'flex';
            }
            // Subscribe to temperature updates
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "printer.objects.subscribe",
              params: {
                objects: {
                  extruder: ["temperature", "target"],
                  heater_bed: ["temperature", "target"]
                }
              },
              id: 1
            }));
          };
          
          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.method === 'notify_status_update' && msg.params && msg.params[0]) {
                const status = msg.params[0];
                const widget = document.getElementById(`printer-widget-${p.id}`);
                if (!widget) return;
                
                if (status.extruder && status.extruder.temperature !== undefined) {
                  const nt = widget.querySelector('.nozzle-temp');
                  if (nt) nt.innerText = `N: ${Math.round(status.extruder.temperature)}°C`;
                }
                if (status.heater_bed && status.heater_bed.temperature !== undefined) {
                  const bt = widget.querySelector('.bed-temp');
                  if (bt) bt.innerText = `B: ${Math.round(status.heater_bed.temperature)}°C`;
                }
              }
              if (msg.id === 1 && msg.result && msg.result.status) {
                // Initial response
                const status = msg.result.status;
                const widget = document.getElementById(`printer-widget-${p.id}`);
                if (!widget) return;
                if (status.extruder) {
                  const nt = widget.querySelector('.nozzle-temp');
                  if (nt) nt.innerText = `N: ${Math.round(status.extruder.temperature)}°C`;
                }
                if (status.heater_bed) {
                  const bt = widget.querySelector('.bed-temp');
                  if (bt) bt.innerText = `B: ${Math.round(status.heater_bed.temperature)}°C`;
                }
              }
            } catch(e){}
          };
          
          ws.onclose = () => {
            const widget = document.getElementById(`printer-widget-${p.id}`);
            if(widget) {
              const dot = widget.querySelector('.status-dot');
              if (dot) dot.style.background = 'var(--error)';
              widget.querySelector('.printer-temps').style.display = 'none';
            }
            delete this.printerSockets[p.id];
          };
        } catch(e) {
          console.error('Failed to connect to printer WS', p.url, e);
        }
      });
    } catch(err) { console.error('Failed to init printers', err); }
  },

  async checkUpdates() {
    try {
      const info = await API.getUpdateStatus();
      if (info) {
        this.versionInfo = info;
        const verEl = document.getElementById('app-version');
        if (verEl) verEl.textContent = `v${info.currentVersion}`;
        
        if (info.hasUpdate) {
          const badge = document.getElementById('update-badge');
          if (badge) badge.style.display = 'inline-flex';
        }
      }
    } catch(e) { console.warn('Update check failed', e); }
  },

  showUpdateInfo() {
    if (this.versionInfo) {
      this.openModal('Update Available', UI.aboutSection(this.versionInfo));
    }
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || localStorage.getItem('gv_theme') || 'glass';
    const nextTheme = current === 'light' ? 'glass' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('gv_theme', nextTheme);
    this.updateThemeIcon();
    document.dispatchEvent(new CustomEvent('gv:theme')); // 3D scenes follow (viewer.js)
  },

  updateThemeIcon() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btn.innerHTML = isLight 
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    btn.title = isLight ? "Switch to Dark Mode" : "Switch to Light Mode";
  },

  async loadCache() {
    try {
      const [cats, tags, mats] = await Promise.all([
        API.getCategories(), API.getTags(), API.getMaterials()
      ]);
      this.cache.categories = cats || [];
      this.cache.tags = tags || [];
      this.cache.materials = mats || [];
      
      // Only try to fetch users if logged in
      if (this.currentUser) {
        try {
          this.cache.users = await API.getUsers();
        } catch(e) { /* user might not have permissions, just ignore */ }
      }
    } catch (e) { console.error('Cache load failed:', e); }
  },

  async loadViewMode() {
    try {
      const res = await API.getViewMode();
      if (res) this.libraryViewMode = res.library_view_mode || 'grid';
    } catch(e) { /* default to grid */ }
  },

  // ── Routing ──
  route() {
    const hash = location.hash.slice(1) || '/';
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query || '');

    this.toggleMobileSidebar(false);
    this.kitHideTip(true);
    this.kitDispose3D();

    // Leaving an unlocked protected model locks it again: the next visit asks for the password
    if (this.adultUnlock && path !== `/models/${this.adultUnlock.id}`) {
      this.adultUnlock = null;
      API.lockAdult().catch(() => {});
    }

    const links = document.querySelectorAll('.sidebar-nav-item, .sidebar-sub-item');
    links.forEach(l => l.classList.remove('active'));
    
    // Clear the selection when navigating, except within the model list (other page, filter,
    // sort): models picked on page 1 stay selected on page 2
    const stayInList = path === '/models' && this.lastRoutePath === '/models';
    this.lastRoutePath = path;
    if (!stayInList) {
      this.selectedModelIds = [];
      this.lastSelectedModelId = null;
    }
    this.selectedBrowsePaths = [];
    this.renderBulkBar();
    this.renderBulkBrowseBar();

    if (path === '/' || path === '/dashboard') {
      document.getElementById('nav-dashboard')?.classList.add('active');
      this.renderDashboard();
    } else if (path === '/models') {
      document.getElementById('nav-models')?.classList.add('active');
      this.renderModels(Object.fromEntries(params));
    } else if (path.startsWith('/models/')) {
      // ?trash=1: a model in the Trash, opened from the Trash. ?view=files: the file list of a
      // model that opens in its kit configurator; ?c=: a configurator configuration
      const fromTrash = params.has('trash');
      document.getElementById(fromTrash ? 'nav-trash' : 'nav-models')?.classList.add('active');
      this.renderModelDetail(path.split('/')[2], { trash: fromTrash, view: params.get('view'), c: params.get('c') });
    } else if (path === '/trash') {
      document.getElementById('nav-trash')?.classList.add('active');
      this.renderTrash();
    } else if (path === '/slicer-saves') {
      document.getElementById('nav-slicer-saves')?.classList.add('active');
      this.renderSlicerSaves();
    } else if (path === '/projects' || path === '/collections') {
      document.getElementById('nav-collections')?.classList.add('active');
      this.renderProjects();
    } else if (path.startsWith('/projects/') || path.startsWith('/collections/')) {
      document.getElementById('nav-collections')?.classList.add('active');
      this.renderProjectDetail(path.split('/')[2]);
    } else if (path.startsWith('/share/')) {
      this.renderSharedModel(path.split('/')[2]);
    } else if (path === '/profile') {
      this.renderProfile();
    } else if (path === '/settings') {
      if (!this.currentUser || this.currentUser.role !== 'admin') {
        this.toast('Admin access required', 'error');
        this.navigate('/');
        return;
      }
      document.getElementById('nav-settings')?.classList.add('active');
      this.renderSettings(params.get('tab') || 'categories');
    } else if (path === '/register') {
      this.showRegister(params.get('token') || params.get('invite'));
    } else if (path === '/reset-password') {
      this.showResetPassword(params.get('token'));
    } else {
      this.renderDashboard();
    }
  },

  navigate(path) {
    location.hash = path;
  },

  previewTheme() {
    const t = document.getElementById('theme-selector').value;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('gv_theme', t);
    this.updateThemeIcon();
    document.dispatchEvent(new CustomEvent('gv:theme')); // 3D scenes follow (viewer.js)
  },

  setAccent(a) {
    document.documentElement.setAttribute('data-accent', a);
    localStorage.setItem('gv_accent', a);
  },

  // ── Toast ──
  toast(msg, type = 'success') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
  },

  // ── Modal ──
  openModal(title, content, modalClass = '') {
    const modal = document.getElementById('modal');
    if (modal) {
      modal.className = 'modal' + (modalClass ? ` ${modalClass}` : '');
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal-overlay').classList.add('active');

    // Snapshot initial form state for dirty confirmation check on dismiss
    setTimeout(() => {
      const form = document.querySelector('#modal-body form');
      if (form) {
        this.initialModalFormSnapshot = new URLSearchParams(new FormData(form)).toString();
      } else {
        this.initialModalFormSnapshot = null;
      }
    }, 50);
  },

  isModalFormDirty() {
    const form = document.querySelector('#modal-body form');
    if (!form) return false;
    if (this.pendingFiles && this.pendingFiles.length > 0) return true;
    if (this.initialModalFormSnapshot !== null) {
      const currentSnapshot = new URLSearchParams(new FormData(form)).toString();
      return currentSnapshot !== this.initialModalFormSnapshot;
    }
    return false;
  },

  dismissModal() {
    if (this.isModalFormDirty()) {
      if (!confirm('You have unsaved changes. Are you sure you want to close and discard them?')) {
        return;
      }
    }
    this.closeModal();
  },

  closeModal() {
    const title = document.getElementById('modal-title')?.textContent || '';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost && (title.includes('GyroidVault 2.0') || title.includes('GyroidVault v2'))) {
      localStorage.setItem('gv_last_seen_version', '2.0.0');
    }
    document.getElementById('modal-overlay').classList.remove('active');
    const modal = document.getElementById('modal');
    if (modal) {
      modal.className = 'modal';
    }
    this.initialModalFormSnapshot = null;
  },

  // ─── Dashboard ────────────────────────────────────────────────────────
  async renderDashboard() {
    this.el.innerHTML = `<div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Your 3D printing overview</p></div></div><div class="stats-grid"><div class="stat-card"><div class="skeleton" style="width:60%;height:32px;margin-top:40px"></div></div><div class="stat-card"><div class="skeleton" style="width:60%;height:32px;margin-top:40px"></div></div><div class="stat-card"><div class="skeleton" style="width:60%;height:32px;margin-top:40px"></div></div><div class="stat-card"><div class="skeleton" style="width:60%;height:32px;margin-top:40px"></div></div></div>`;
    try {
      const stats = await API.getStats();
      this.el.innerHTML = `
        <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Your 3D printing overview</p></div></div>
        ${UI.statsCards(stats)}
        <div class="dashboard-panels">
          <div class="glass-panel"><div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Recent Models</div></div><div class="panel-body">${UI.recentModels(stats.recentModels)}</div></div>
          <div class="glass-panel"><div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>Recent Prints</div></div><div class="panel-body">${UI.recentPrints(stats.recentPrints)}</div></div>
          <div class="glass-panel"><div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>Material Usage</div></div><div class="panel-body">${UI.materialChart(stats.materialUsage)}</div></div>
        </div>`;
    } catch (e) {
      this.el.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Failed to load dashboard</div></div>';
    }
  },

  // ─── Models List ──────────────────────────────────────────────────────
  async renderModels(params = {}) {
    // check if we should show folder view instead (only when no search/category/tag/format filter is active)
    const hasActiveFilter = !!(params.search || params.category || params.tag || (params.format && params.format !== 'all') || params.user || params.printed || params.project_id);
    if (this.libraryViewMode === 'folder' && !hasActiveFilter) {
      return this.renderBrowse(params.path || '');
    }

    // Reset format filter when navigating to a new category or route without format param (Issue #76)
    const activeFormat = params.format || 'all';
    this.currentFormatFilter = activeFormat;
    this.lastCategoryFilter = params.category || '';
    const toolbar = UI.toolbar(this.cache.categories, this.cache.tags, this.cache.users, activeFormat);
    this.el.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Models</h1><p class="page-subtitle">Manage your 3D model library</p></div>
      </div>
      ${toolbar}
      <div id="models-grid"><div class="model-grid">${'<div class="model-card"><div class="model-card-thumb"><div class="skeleton" style="width:100%;height:100%"></div></div><div class="model-card-body"><div class="skeleton" style="width:70%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:40%;height:14px"></div></div></div>'.repeat(6)}</div></div>`;

    // Restore filter values
    if (params.search) {
      const sInput = document.getElementById('search-input');
      if (sInput) sInput.value = params.search;
      const topInput = document.getElementById('topbar-search-input');
      if (topInput && topInput.value !== params.search) topInput.value = params.search;
    }
    if (params.category) document.getElementById('filter-category').value = params.category;
    if (params.tag) document.getElementById('filter-tag').value = params.tag;
    if (params.user) document.getElementById('filter-user').value = params.user;
    if (params.printed) document.getElementById('filter-printed').value = params.printed;
    if (params.sort) document.getElementById('filter-sort').value = params.sort;
    if (params.limit) {
      const limitSelect = document.getElementById('filter-limit');
      if (limitSelect) limitSelect.value = params.limit;
    }

    // Hide scan if not admin
    if (!this.currentUser || this.currentUser.role !== 'admin') {
      const scanBtn = document.getElementById('scan-btn');
      if (scanBtn) scanBtn.style.display = 'none';
    }

    await this.fetchAndRenderModels(params);
  },

  // ─── Folder Browser ─────────────────────────────────────────────────
  async renderBrowse(browsePath = '') {
    this.currentBrowsePath = browsePath;
    const toolbar = UI.toolbar(this.cache.categories, this.cache.tags, this.cache.users);
    this.el.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Browse Library</h1><p class="page-subtitle">Explore your files on disk</p></div>
      </div>
      ${toolbar}
      <div id="browse-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; min-height:36px;"></div>
      <div id="browse-wrapper" style="display:flex;gap:20px;align-items:flex-start">
        <div id="browse-tree" style="min-width:240px"><div class="skeleton" style="width:240px;height:300px;border-radius:8px"></div></div>
        <div id="browse-content" style="flex:1;min-width:0"><div class="model-grid">${'<div class="model-card"><div class="model-card-thumb"><div class="skeleton" style="width:100%;height:100%"></div></div><div class="model-card-body"><div class="skeleton" style="width:70%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:40%;height:14px"></div></div></div>'.repeat(6)}</div></div>
      </div>`;

    try {
      // fetch tree and current folder in parallel
      const [tree, data] = await Promise.all([
        API.getFolderTree(),
        API.browseLibrary(browsePath)
      ]);

      // render tree sidebar
      const treeEl = document.getElementById('browse-tree');
      if (treeEl) treeEl.innerHTML = UI.folderTree(tree, browsePath);

      // render header with breadcrumbs, New Folder button, and search
      const headerEl = document.getElementById('browse-header');
      if (headerEl) {
        const fileCount = data.files.filter(f => f.type !== 'image').length;
        headerEl.innerHTML = `
          <div style="flex:1;display:flex;align-items:center;gap:12px">
            ${UI.breadcrumbs(data.currentPath)}
            ${this.currentUser ? `<button class="btn btn-secondary btn-sm" onclick="App.handleCreateFolder('${data.currentPath}')">+ New Folder</button>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:0.85rem;color:var(--text-muted);white-space:nowrap" id="browse-counter">Showing ${data.folders.length} Folders / ${fileCount} Files</span>
            <div style="width:250px">
              <input type="text" id="browse-search" placeholder="Filter this folder..." class="form-input" onkeyup="App.handleBrowseSearch(event)" style="padding:6px 12px; font-size:.9rem;">
            </div>
          </div>
        `;
      }

      // render folder contents
      const container = document.getElementById('browse-content');
      if (!container) return;

      const sortMode = document.getElementById('filter-sort')?.value || 'name';
      if (sortMode === 'name') {
        data.files.sort((a,b) => a.name.localeCompare(b.name));
      } else if (sortMode === 'updated' || sortMode === 'created') {
        data.files.sort((a,b) => (b.mtime || 0) - (a.mtime || 0));
      }

      const foldersHtml = data.folders.map(f => UI.folderCard(f)).join('');
      const filesHtml = data.files.filter(f => f.type !== 'image').map(f => UI.browseFileCard(f)).join('');

      if (!data.folders.length && !data.files.length) {
        container.innerHTML = `
          <div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><div class="empty-state-text">This folder is empty</div><div class="empty-state-sub">No 3D files or subfolders found here</div></div>`;
        return;
      }

      container.innerHTML = `
        <div class="model-grid">
          ${foldersHtml}
          ${filesHtml}
        </div>`;

      this.renderBulkBrowseBar();

      // trigger STL thumbnail rendering
      if (typeof Viewer !== 'undefined' && Viewer.generateThumbnails) {
        setTimeout(() => Viewer.generateThumbnails(), 50);
      }
    } catch(e) {
      console.error(e);
      const container = document.getElementById('browse-content');
      if (container) container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Failed to load folder</div></div>';
    }
  },

  browseTo(folderPath) {
    this.navigate(`/models?path=${encodeURIComponent(folderPath)}`);
  },

  handleBrowseSearch(e) {
    const q = e.target.value;
    clearTimeout(this.browseSearchTimeout);
    this.browseSearchTimeout = setTimeout(async () => {
      const container = document.getElementById('browse-content');
      if (!container) return;
      
      container.innerHTML = '<div class="model-grid">' + '<div class="model-card"><div class="model-card-thumb"><div class="skeleton" style="width:100%;height:100%"></div></div><div class="model-card-body"><div class="skeleton" style="width:70%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:40%;height:14px"></div></div></div>'.repeat(6) + '</div>';
      
      try {
        const data = q ? await API.searchLibrary(q) : await API.browseLibrary(new URLSearchParams(location.hash.split('?')[1]).get('path') || '');
        
        // Filter based on toolbar settings
        const sortMode = document.getElementById('filter-sort')?.value || 'name';
        if (sortMode === 'name') {
          data.files.sort((a,b) => a.name.localeCompare(b.name));
        } else if (sortMode === 'updated' || sortMode === 'created') {
          data.files.sort((a,b) => (b.mtime || 0) - (a.mtime || 0));
        }

        const foldersHtml = data.folders.map(f => UI.folderCard(f)).join('');
        const filesHtml = data.files.filter(f => f.type !== 'image').map(f => UI.browseFileCard(f)).join('');
        
        if (!data.folders.length && !data.files.length) {
          container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><div class="empty-state-text">No matches found</div></div>`;
          return;
        }
        
        container.innerHTML = `<div class="model-grid">${foldersHtml}${filesHtml}</div>`;
        this.renderBulkBrowseBar();
        if (typeof Viewer !== 'undefined' && Viewer.generateThumbnails) setTimeout(() => Viewer.generateThumbnails(), 50);
      } catch(err) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Search failed</div></div>';
      }
    }, 400);
  },

  handleDragStart(e, itemPath) {
    e.dataTransfer.setData('text/plain', itemPath);
    e.dataTransfer.effectAllowed = 'move';

    const dragIcon = document.createElement('div');
    dragIcon.style.position = 'absolute';
    dragIcon.style.top = '-1000px';
    dragIcon.style.background = 'var(--accent-cyan)';
    dragIcon.style.color = '#fff';
    dragIcon.style.padding = '6px 12px';
    dragIcon.style.borderRadius = '20px';
    dragIcon.style.fontWeight = 'bold';
    dragIcon.style.fontSize = '12px';
    dragIcon.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
    dragIcon.style.pointerEvents = 'none';
    dragIcon.innerText = itemPath.split('/').pop();
    
    document.body.appendChild(dragIcon);
    e.dataTransfer.setDragImage(dragIcon, 10, 10);
    setTimeout(() => dragIcon.remove(), 100);
  },

  async handleDrop(e, targetFolderPath) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    
    const sourceItemPath = e.dataTransfer.getData('text/plain');
    if (!sourceItemPath || sourceItemPath === targetFolderPath) return;
    
    try {
      await API.moveItem(sourceItemPath, targetFolderPath);
      this.toast('Moved successfully');
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) {
      this.toast(err.message, 'error');
    }
  },

  async handleCreateFolder(parentPath) {
    const name = prompt('Enter new folder name:');
    if (!name) return;
    try {
      await API.createFolder(parentPath, name);
      this.toast('Folder created');
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) {
      this.toast(err.message, 'error');
    }
  },

  setFormatFilter(format, btn) {
    this.currentFormatFilter = format || 'all';
    document.querySelectorAll('.format-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else {
      const el = document.getElementById(`pill-format-${format}`);
      if (el) el.classList.add('active');
    }
    this.handleFilter();
  },

  async fetchAndRenderModels(params = {}) {
    try {
      if (params.format) this.currentFormatFilter = params.format;
      const queryParams = { ...params };
      if (this.currentFormatFilter && this.currentFormatFilter !== 'all') {
        queryParams.format = this.currentFormatFilter;
      }
      
      const response = await API.getModels(queryParams);
      
      // Handle the new paginated response format or fallback to array
      const models = Array.isArray(response) ? response : (response.models || []);
      const totalPages = response.totalPages || 1;
      const currentPage = response.currentPage || 1;

      // Update dynamic library summary counter in toolbar
      const statsCounter = document.getElementById('library-summary-stats');
      if (statsCounter) {
        const sizeStr = response.totalStorageBytes ? ` • ${UI.formatSize(response.totalStorageBytes)}` : '';
        statsCounter.textContent = `${response.totalItems || 0} models${sizeStr}`;
      }

      const grid = document.getElementById('models-grid');
      if (!grid) return;
      if (!models.length) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div><div class="empty-state-text">No models found</div><div class="empty-state-sub">Try changing your filters or create a new model</div></div>';
        return;
      }
      
      const viewMode = localStorage.getItem('gv_view_mode') || 'grid';
      grid.innerHTML = `
        <div class="model-grid ${viewMode === 'list' ? 'models-list-view' : ''}">${models.map(m => UI.modelCard(m)).join('')}</div>
        ${UI.pagination(totalPages, currentPage)}
      `;
      this.setViewMode(viewMode); // highlight correct button
      this.renderBulkBar();
      if (typeof Viewer !== 'undefined' && Viewer.generateThumbnails) {
        setTimeout(() => Viewer.generateThumbnails(), 50);
      }
    } catch (e) {
      console.error(e);
      document.getElementById('models-grid').innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Failed to load models</div></div>';
    }
  },

  setViewMode(mode) {
    localStorage.setItem('gv_view_mode', mode);
    const viewGridBtn = document.getElementById('view-mode-grid');
    const viewListBtn = document.getElementById('view-mode-list');
    if (viewGridBtn) viewGridBtn.style.color = mode === 'grid' ? 'var(--accent-cyan)' : 'inherit';
    if (viewListBtn) viewListBtn.style.color = mode === 'list' ? 'var(--accent-cyan)' : 'inherit';
    
    const gridContainer = document.querySelector('#models-grid .model-grid');
    if (gridContainer) {
      if (mode === 'list') {
        gridContainer.classList.add('models-list-view');
      } else {
        gridContainer.classList.remove('models-list-view');
      }
    }
  },

  renderBulkBar() {
    let bar = document.getElementById('bulk-action-bar-container');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bulk-action-bar-container';
      document.body.appendChild(bar);
    }
    bar.innerHTML = UI.bulkActionBar(this.selectedModelIds.length);
  },

  toggleModelSelection(e, id) {
    if (!this.currentUser || this.currentUser.role === 'viewer') return;
    if (e) e.stopPropagation();
    if (e?.shiftKey && this.lastSelectedModelId !== null) {
      this.selectModelRange(this.lastSelectedModelId, id);
      this.lastSelectedModelId = id;
      return;
    }

    const idx = this.selectedModelIds.indexOf(id);
    if (idx > -1) this.selectedModelIds.splice(idx, 1);
    else this.selectedModelIds.push(id);
    this.lastSelectedModelId = id;
    
    // Update UI without full re-render
    const card = document.querySelector(`.model-card[data-model-id="${id}"]`);
    if (card) card.classList.toggle('selected');
    this.renderBulkBar();
  },

  handleModelCardClick(e, id) {
    if (e?.shiftKey || e?.ctrlKey || e?.metaKey) {
      this.toggleModelSelection(e, id);
      return;
    }

    if (this.selectedModelIds.length > 0) {
      this.toggleModelSelection(e, id);
    } else {
      this.navigate(`/models/${id}`);
    }
  },

  selectModelRange(startId, endId) {
    const cards = Array.from(document.querySelectorAll('.model-card[data-model-id]'));
    const startIndex = cards.findIndex(c => Number(c.dataset.modelId) === startId);
    const endIndex = cards.findIndex(c => Number(c.dataset.modelId) === endId);
    if (startIndex === -1 || endIndex === -1) {
      this.toggleModelSelection(null, endId);
      return;
    }

    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    const ids = cards.slice(from, to + 1).map(c => Number(c.dataset.modelId));
    this.selectedModelIds = Array.from(new Set([...this.selectedModelIds, ...ids]));
    cards.forEach(c => c.classList.toggle('selected', this.selectedModelIds.includes(Number(c.dataset.modelId))));
    this.renderBulkBar();
  },

  clearSelection() {
    this.selectedModelIds = [];
    this.lastSelectedModelId = null;
    document.querySelectorAll('.model-card.selected').forEach(c => c.classList.remove('selected'));
    this.renderBulkBar();
  },

  selectAll() {
    if (!this.currentUser || this.currentUser.role === 'viewer') return;
    const cards = document.querySelectorAll('.model-card');
    // Adds this page to models selected on other pages
    const pageIds = Array.from(cards).map(c => Number(c.dataset.modelId));
    this.selectedModelIds = Array.from(new Set([...this.selectedModelIds, ...pageIds]));
    this.lastSelectedModelId = pageIds.at(-1) || null;
    cards.forEach(c => c.classList.add('selected'));
    this.renderBulkBar();
  },

  openBulkDelete() { this.openModal('Bulk Delete', UI.bulkDeleteForm(this.selectedModelIds.length)); },
  async handleBulkDelete(e) {
    e.preventDefault();
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.toast('You must be logged in as an uploader or admin to delete models', 'error');
      return;
    }
    try {
      await API.bulkDeleteModels(this.selectedModelIds);
      this.toast(`${this.selectedModelIds.length} models moved to the Trash`);
      this.clearSelection();
      this.closeModal();
      this.route();
    } catch(e) { this.toast(e.message, 'error'); }
  },
  openBulkTag() { this.openModal('Bulk Tag Models', UI.bulkTagForm(this.cache.tags)); },
  async handleBulkTagSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const selectedTags = fd.getAll('tags');
    const inlineTagInput = document.getElementById('new-bulk-tag-input');
    const tagMode = fd.get('tag_mode') || 'add';
    
    let tagsToApply = [...selectedTags];
    if (inlineTagInput && inlineTagInput.value.trim()) {
      const inlineTags = inlineTagInput.value.split(',').map(t => t.trim()).filter(Boolean);
      tagsToApply = tagsToApply.concat(inlineTags);
    }
    
    if (tagsToApply.length === 0) {
      this.toast('Please select or enter at least one tag', 'error');
      return;
    }
    
    try {
      if (tagMode === 'replace') {
        await API.bulkUpdateModels(this.selectedModelIds, { tags: tagsToApply });
      } else {
        await API.bulkUpdateModels(this.selectedModelIds, { add_tags: tagsToApply });
      }
      this.toast(`Updated tags on ${this.selectedModelIds.length} models`);
      this.closeModal();
      this.cache.tags = await API.getTags().catch(() => this.cache.tags);
      this.route();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  async openBulkMove() {
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.toast('You must be logged in as an uploader or admin to modify models', 'error');
      return;
    }
    if (!this.selectedModelIds?.length) return;
    try {
      if (!this.cache.categories || this.cache.categories.length === 0) {
        this.cache.categories = await API.getCategories();
      }
    } catch (e) {}
    this.openModal('Assign Category', UI.bulkMoveForm(this.cache.categories || [], this.selectedModelIds.length));
  },
  async handleBulkMove(e) {
    e.preventDefault();
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.toast('You must be logged in as an uploader or admin to modify models', 'error');
      return;
    }
    const fd = new FormData(e.target);
    const catVal = fd.get('category_id');
    const catId = catVal ? Number(catVal) : null;
    const count = this.selectedModelIds.length;
    try {
      await API.bulkUpdateModels(this.selectedModelIds, { category_id: catId });
      this.toast(`Updated category on ${count} model${count > 1 ? 's' : ''}`);
      this.closeModal();
      this.cache.categories = await API.getCategories().catch(() => this.cache.categories);
      this.renderSidebarCategories();
      this.route();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  async openBulkAddToCollection() {
    const projects = await API.getProjects();
    this.openModal('Add to Collection', UI.bulkCollectionForm(projects));
  },
  async handleBulkAddToCollectionSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await API.bulkAddModelsToProject(fd.get('project_id'), this.selectedModelIds);
      this.toast(`Added ${this.selectedModelIds.length} models to collection`);
      this.closeModal();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  renderBulkBrowseBar() {
    let bar = document.getElementById('bulk-browse-action-bar-container');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bulk-browse-action-bar-container';
      document.body.appendChild(bar);
    }
    
    // Check if all rendered items are selected
    const allCards = document.querySelectorAll('#browse-content .model-card');
    const allPaths = Array.from(allCards).map(c => c.dataset.path).filter(Boolean);
    const isAllSelected = allPaths.length > 0 && allPaths.every(p => this.selectedBrowsePaths.includes(p));

    bar.innerHTML = UI.bulkBrowseActionBar(this.selectedBrowsePaths.length, isAllSelected);
  },

  toggleBrowseSelection(path) {
    const idx = this.selectedBrowsePaths.indexOf(path);
    if (idx > -1) this.selectedBrowsePaths.splice(idx, 1);
    else this.selectedBrowsePaths.push(path);
    
    // Update UI without full re-render
    const escapedPath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const card = document.querySelector(`.model-card[data-path="${escapedPath}"]`);
    if (card) card.classList.toggle('selected');
    this.renderBulkBrowseBar();
  },

  clearBrowseSelection() {
    this.selectedBrowsePaths = [];
    document.querySelectorAll('#browse-content .model-card.selected').forEach(c => c.classList.remove('selected'));
    this.renderBulkBrowseBar();
  },

  toggleBrowseSelectAll() {
    const allCards = document.querySelectorAll('#browse-content .model-card');
    const allPaths = Array.from(allCards).map(c => c.dataset.path).filter(Boolean);
    
    const isAllSelected = allPaths.length > 0 && allPaths.every(p => this.selectedBrowsePaths.includes(p));
    
    if (isAllSelected) {
      // Deselect only the currently rendered ones
      this.selectedBrowsePaths = this.selectedBrowsePaths.filter(p => !allPaths.includes(p));
      allCards.forEach(c => c.classList.remove('selected'));
    } else {
      // Select all rendered ones
      allPaths.forEach(p => {
        if (!this.selectedBrowsePaths.includes(p)) this.selectedBrowsePaths.push(p);
      });
      allCards.forEach(c => c.classList.add('selected'));
    }
    this.renderBulkBrowseBar();
  },

  openBulkBrowseMove() {
    this.openModal('Move Items', UI.bulkBrowseMoveForm());
  },
  
  async handleBulkBrowseMoveSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await API.bulkMoveItems(this.selectedBrowsePaths, fd.get('target_path'));
      this.toast(`Moved ${this.selectedBrowsePaths.length} items`);
      this.clearBrowseSelection();
      this.closeModal();
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) { this.toast(err.message, 'error'); }
  },

  openBulkBrowseDelete() {
    this.openModal('Bulk Delete', UI.bulkBrowseDeleteForm(this.selectedBrowsePaths.length));
  },

  async handleBulkBrowseDeleteSubmit(e) {
    e.preventDefault();
    try {
      await API.bulkDeleteItems(this.selectedBrowsePaths);
      this.toast(`${this.selectedBrowsePaths.length} items moved to the Trash`);
      this.clearBrowseSelection();
      this.closeModal();
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) { this.toast(err.message, 'error'); }
  },

  openBulkBrowseTag() {
    this.openModal('Bulk Tag Items', UI.bulkBrowseTagForm(this.cache.tags));
  },

  async handleBulkBrowseTagSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const selectedTags = fd.getAll('tags');
    const inlineTagInput = document.getElementById('new-bulk-tag-input');
    
    let tagsToApply = [...selectedTags];
    if (inlineTagInput && inlineTagInput.value.trim()) {
      const inlineTags = inlineTagInput.value.split(',').map(t => t.trim()).filter(Boolean);
      tagsToApply = tagsToApply.concat(inlineTags);
    }
    
    if (tagsToApply.length === 0) {
      this.toast('Please select or enter at least one tag', 'error');
      return;
    }
    
    try {
      await API.bulkTagItems(this.selectedBrowsePaths, tagsToApply);
      this.toast(`Tagged ${this.selectedBrowsePaths.length} items`);
      this.clearBrowseSelection();
      this.closeModal();
      // Tagging might not immediately reflect in folder view without a backend rescan or re-fetch, but re-render is safe
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) { this.toast(err.message, 'error'); }
  },

  async openBulkBrowseCategory() {
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.toast('You must be logged in as an uploader or admin to modify models', 'error');
      return;
    }
    if (!this.selectedBrowsePaths?.length) return;
    try {
      if (!this.cache.categories || this.cache.categories.length === 0) {
        this.cache.categories = await API.getCategories();
      }
    } catch(e) {}
    this.openModal('Assign Category', UI.bulkBrowseCategoryForm(this.cache.categories || [], this.selectedBrowsePaths.length));
  },

  async handleBulkBrowseCategorySubmit(e) {
    e.preventDefault();
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.toast('You must be logged in as an uploader or admin to modify models', 'error');
      return;
    }
    const fd = new FormData(e.target);
    const catVal = fd.get('category_id');
    const catId = catVal ? Number(catVal) : null;
    const count = this.selectedBrowsePaths.length;
    try {
      await API.bulkCategoryItems(this.selectedBrowsePaths, catId);
      this.toast(`Updated category on ${count} item${count > 1 ? 's' : ''}`);
      this.clearBrowseSelection();
      this.closeModal();
      this.cache.categories = await API.getCategories().catch(() => this.cache.categories);
      this.renderSidebarCategories();
      this.renderBrowse(this.currentBrowsePath);
    } catch(err) { this.toast(err.message || 'Failed to update category', 'error'); }
  },

  handleSearch(val) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.handleFilter(), 300);
  },

  handleFilter() {
    const params = new URLSearchParams();
    const search = document.getElementById('search-input')?.value;
    const category = document.getElementById('filter-category')?.value;
    const tag = document.getElementById('filter-tag')?.value;
    const user = document.getElementById('filter-user')?.value;
    const printed = document.getElementById('filter-printed')?.value;
    const sort = document.getElementById('filter-sort')?.value;
    const limit = document.getElementById('filter-limit')?.value;

    // Reset format filter when switching categories in the toolbar dropdown (Issue #76)
    if ((category || '') !== (this.lastCategoryFilter || '')) {
      this.currentFormatFilter = 'all';
    }
    this.lastCategoryFilter = category || '';

    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    if (this.currentFormatFilter && this.currentFormatFilter !== 'all') params.set('format', this.currentFormatFilter);
    if (user) params.set('user', user);
    if (printed) params.set('printed', printed);
    if (sort && sort !== 'updated') params.set('sort', sort);
    if (limit && limit !== '24') params.set('limit', limit);
    params.set('page', '1');

    const hasActiveFilter = !!(search || category || tag || (this.currentFormatFilter && this.currentFormatFilter !== 'all') || user || printed);
    if (this.libraryViewMode === 'folder' && !hasActiveFilter) {
      this.renderBrowse(this.currentBrowsePath);
    } else {
      window.location.hash = `/models?${params.toString()}`;
    }
  },

  goToPage(pageNumber) {
    const params = new URLSearchParams();
    const search = document.getElementById('search-input')?.value;
    const category = document.getElementById('filter-category')?.value;
    const tag = document.getElementById('filter-tag')?.value;
    const user = document.getElementById('filter-user')?.value;
    const printed = document.getElementById('filter-printed')?.value;
    const sort = document.getElementById('filter-sort')?.value;
    const limit = document.getElementById('filter-limit')?.value;

    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    if (this.currentFormatFilter && this.currentFormatFilter !== 'all') params.set('format', this.currentFormatFilter);
    if (user) params.set('user', user);
    if (printed) params.set('printed', printed);
    if (sort && sort !== 'updated') params.set('sort', sort);
    if (limit && limit !== '24') params.set('limit', limit);
    params.set('page', pageNumber);

    window.location.hash = `/models?${params.toString()}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // ── Auth ──
  showLogin() { 
    const allowReg = this.publicConfig && this.publicConfig.open_registration;
    this.openModal('Login', UI.loginForm(allowReg)); 
  },
  showRegister(token = '') { this.openModal('Register', UI.registerForm(token)); },
  showForgotPassword() { this.openModal('Reset Password', UI.forgotPasswordForm()); },
  showResetPassword(token) { if (token) this.openModal('Choose New Password', UI.resetPasswordForm(token)); },
  
  async handleLogin(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await API.login(fd.get('username'), fd.get('password'));
      if (!res || !res.csrfToken) {
        this.toast('Invalid username or password', 'error');
        return;
      }
      if (res.error) throw new Error(res.error);
      localStorage.setItem('pv_csrf_token', res.csrfToken);
      localStorage.setItem('pv_user', JSON.stringify(res.user));
      this.currentUser = res.user;
      this.toast('Welcome back, ' + res.user.username);
      this.closeModal();
      this.updateUserNav();
      await this.loadCache();
      this.route();
    } catch(e) { this.toast(e.message, 'error'); }
  },
  
  async handleRegister(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await API.register(fd.get('username'), fd.get('email'), fd.get('password'), fd.get('token'));
      this.toast('Registration successful! Please login.');
      this.showLogin();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  async handleInviteUser(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    const fd = new FormData(e.target);
    try {
      await API.inviteUser(fd.get('email'));
      this.toast('Invitation sent successfully', 'success');
      e.target.reset();
    } catch(err) {
      this.toast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Invite'; }
    }
  },

  async changeUserRole(userId, selectElem) {
    try {
      const newRole = selectElem.value;
      await API.updateUserRole(userId, newRole);
      this.toast('User role updated successfully', 'success');
      // trigger refresh of settings tab
      const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');
      if (usersBtn) usersBtn.click();
    } catch (err) {
      this.toast(err.message, 'error');
      // Revert select on error
      const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');
      if (usersBtn) usersBtn.click();
    }
  },

  async deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    try {
      await API.deleteUser(userId);
      this.toast('User deleted successfully', 'success');
      // trigger refresh of settings tab
      const usersBtn = document.querySelector('.tab-btn[data-tab="users"]');
      if (usersBtn) usersBtn.click();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },


  async handleForgotPassword(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await API.forgotPassword(fd.get('email'));
      this.toast(res.message);
      this.closeModal();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  async handleResetPassword(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('password') !== fd.get('confirm')) return this.toast('Passwords do not match', 'error');
    try {
      const res = await API.resetPassword(fd.get('token'), fd.get('password'));
      this.toast(res.message);
      this.closeModal();
      window.location.hash = '#/';
      this.showLogin();
    } catch(e) { this.toast(e.message, 'error'); }
  },
  
  async handleUpdateProfile(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { username: fd.get('username'), email: fd.get('email') };
    if (fd.get('password')) data.password = fd.get('password');
    if (fd.has('preferred_slicer')) data.preferred_slicer = fd.get('preferred_slicer');
    try {
      await API.updateProfile(data);
      this.toast('Profile updated successfully');
      // Refresh user info
      const user = await API.getMe();
      this.currentUser = user;
      localStorage.setItem('pv_user', JSON.stringify(user));
      this.updateUserNav();
    } catch(e) { this.toast(e.message, 'error'); }
  },

  async generateApiKey() {
    try {
      const res = await API.generateApiKey();
      if (res.api_key) {
        const resultDiv = document.getElementById('api-key-result');
        if (resultDiv) {
          resultDiv.textContent = res.api_key;
          resultDiv.style.display = 'block';
          this.toast('API Key generated successfully', 'success');
        }
      }
    } catch(e) { this.toast(e.message || 'Failed to generate API key', 'error'); }
  },

  async handleSaveSMTP(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    try {
      await API.saveSMTPSettings(data);
      this.toast('SMTP settings saved');
    } catch(e) { this.toast(e.message, 'error'); }
  },
  
  async handleToggleSystemSetting(key, isChecked, label) {
    try {
      await API.saveSystemSettings({ [key]: isChecked ? 'true' : 'false' });
      this.toast(`${label} ${isChecked ? 'enabled' : 'disabled'}`);
    } catch (e) {
      this.toast(e.message || 'Failed to update setting', 'error');
    }
  },

  async handleSaveSystemSettings(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (e.target.querySelector('[name="open_registration"]')) {
      data.open_registration = fd.has('open_registration') ? 'true' : 'false';
    }
    if (e.target.querySelector('[name="require_login_to_view"]')) {
      data.require_login_to_view = fd.has('require_login_to_view') ? 'true' : 'false';
    }
    if (e.target.querySelector('[name="scan_zip_archives"]')) {
      data.scan_zip_archives = fd.has('scan_zip_archives') ? 'true' : 'false';
    }
    try {
      await API.saveSystemSettings(data);
      await this.loadViewMode(); // refresh the cached view mode
      this.toast('System settings saved');
    } catch(e) { this.toast(e.message, 'error'); }
  },

    async handleAddPrinter(e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newPrinter = { 
        id: Date.now().toString(), 
        name: fd.get('name'), 
        url: fd.get('url').replace(/\/$/, ''),
        api_key: fd.get('api_key') || ''
      };
    
    try {
      const config = await API.getSystemSettings();
      let printers = [];
      try { if (config.printers) printers = JSON.parse(config.printers); } catch(e){}
      printers.push(newPrinter);
      await API.saveSystemSettings({ printers: JSON.stringify(printers) });
      this.toast('Printer added');
      this.renderSettings();
    } catch(err) { this.toast(err.message, 'error'); }
  },

  async deletePrinter(id) {
    if (!confirm('Remove this printer?')) return;
    try {
      const config = await API.getSystemSettings();
      let printers = [];
      try { if (config.printers) printers = JSON.parse(config.printers); } catch(e){}
      printers = printers.filter(p => p.id !== id);
      await API.saveSystemSettings({ printers: JSON.stringify(printers) });
      this.toast('Printer removed');
      this.renderSettings();
    } catch(err) { this.toast(err.message, 'error'); }
  },
  
  async testSMTP(e) {
    if (e) e.preventDefault();
    const btn = e?.target;
    
    // First, save current settings so we test what is on screen
    const form = btn.closest('form');
    if (form) {
      try {
        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());
        await API.saveSMTPSettings(data);
      } catch(e) { 
        return this.toast('Failed to save settings before test: ' + e.message, 'error'); 
      }
    }
    
    this.openModal('Test SMTP Connection', UI.smtpTestModal(this.currentUser?.email || ""));
  },

  async handleSendTestEmail(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('test_email');
    const btn = document.getElementById('send-test-btn');

    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
      await API.testSMTP({ email });
      this.toast('Test email sent successfully! Check your inbox.', 'success');
      this.closeModal();
    } catch(e) { 
      this.toast(e.message, 'error'); 
      if (btn) { btn.disabled = false; btn.textContent = 'Send Test'; }
    }
  },
  
  async handleLogout() {
    try { await API.logout(); } catch(e) {}
    localStorage.removeItem('pv_csrf_token');
    localStorage.removeItem('pv_user');
    this.currentUser = null;
    this.toast('Logged out');
    this.updateUserNav();
    this.route();
  },
  
  updateUserNav() {
    const avatar = document.getElementById('sidebar-user-avatar');
    const username = document.getElementById('sidebar-username');
    const role = document.getElementById('sidebar-user-role');
    const wrapper = document.getElementById('nav-login-wrapper');
    const settingsLink = document.getElementById('nav-settings');
    const trashLink = document.getElementById('nav-trash');
    if (trashLink) trashLink.style.display = this.currentUser && this.currentUser.role !== 'viewer' ? '' : 'none';
    const slicerLink = document.getElementById('nav-slicer-saves');
    if (slicerLink) slicerLink.style.display = this.currentUser && this.currentUser.role === 'admin' ? '' : 'none';

    if (this.currentUser) {
      if (avatar) avatar.textContent = (this.currentUser.username || 'U').charAt(0).toUpperCase();
      if (username) username.textContent = this.currentUser.username;
      if (role) role.textContent = this.currentUser.role ? `${this.currentUser.role.charAt(0).toUpperCase()}${this.currentUser.role.slice(1)}` : 'Member';
      if (settingsLink) {
        settingsLink.style.display = (this.currentUser.role === 'admin') ? 'flex' : 'none';
      }
      if (wrapper) {
        wrapper.innerHTML = `
          <button class="btn-icon" onclick="App.handleLogout()" title="Log Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>`;
      }
    } else {
      if (avatar) avatar.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      if (username) username.textContent = 'Guest User';
      if (role) role.textContent = 'Click to login';
      if (settingsLink) settingsLink.style.display = 'none';
      if (wrapper) {
        wrapper.innerHTML = `
          <button class="btn-icon" onclick="App.showLogin()" title="Login">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          </button>`;
      }
    }
  },

  handleUserProfileClick() {
    if (this.currentUser) {
      this.navigate('/profile');
    } else {
      this.showLogin();
    }
  },

  async renderProfile() {
    if (!this.currentUser) return this.navigate('/');
    
    this.el.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your account settings and preferences</p></div>
      </div>
      <div class="settings-tabs" style="display:flex;gap:8px;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:1px">
        <button class="tab-btn active" data-tab="account" style="background:none;border:none;color:var(--text-secondary);padding:10px 20px;cursor:pointer;font-weight:600;border-bottom:2px solid transparent;transition:all .2s">Account Details</button>
        <button class="tab-btn" data-tab="appearance" style="background:none;border:none;color:var(--text-secondary);padding:10px 20px;cursor:pointer;font-weight:600;border-bottom:2px solid transparent;transition:all .2s">Local Appearance</button>
        <button class="tab-btn" data-tab="api" style="background:none;border:none;color:var(--text-secondary);padding:10px 20px;cursor:pointer;font-weight:600;border-bottom:2px solid transparent;transition:all .2s">API & Integrations</button>
      </div>
      <div id="profile-content"></div>`;

    const content = this.el.querySelector('#profile-content');
    const tabs = this.el.querySelectorAll('.tab-btn');
    const user = this.currentUser;

    const switchTab = (tab) => {
      tabs.forEach(t => {
        const active = t.dataset.tab === tab;
        t.style.color = active ? 'var(--accent-cyan)' : 'var(--text-secondary)';
        t.style.borderBottomColor = active ? 'var(--accent-cyan)' : 'transparent';
      });

      if (tab === 'account') {
        content.innerHTML = `
          <div class="glass-panel">
            <div class="panel-header"><div class="panel-title">Account Details</div></div>
            <div class="panel-body">
              <form onsubmit="App.handleUpdateProfile(event)" class="form-grid">
                <div class="form-group">
                  <label class="form-label">Username</label>
                  <input type="text" name="username" value="${user.username}" required class="form-input">
                </div>
                <div class="form-group">
                  <label class="form-label">Email Address</label>
                  <input type="email" name="email" value="${user.email || ''}" required class="form-input">
                </div>
                <div class="form-group">
                  <label class="form-label">New Password</label>
                  <input type="password" name="password" placeholder="Leave blank to keep current" class="form-input">
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px;">Must be at least 8 characters and contain letters and numbers.</p>
                </div>
                <div class="form-group">
                  <label class="form-label">Preferred Slicer</label>
                  <select name="preferred_slicer" class="form-select">
                    <option value="" ${!user.preferred_slicer ? 'selected' : ''}>None (Ask every time)</option>
                    <option value="orcaslicer" ${user.preferred_slicer === 'orcaslicer' ? 'selected' : ''}>OrcaSlicer</option>
                    <option value="elegooslicer" ${user.preferred_slicer === 'elegooslicer' ? 'selected' : ''}>Elegoo Slicer</option>
                    <option value="cura" ${user.preferred_slicer === 'cura' ? 'selected' : ''}>Ultimaker Cura</option>
                    <option value="bambustudio" ${user.preferred_slicer === 'bambustudio' ? 'selected' : ''}>Bambu Studio</option>
                  </select>
                </div>
                <div style="margin-top:24px; padding-top:20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end;">
                  <button type="submit" class="btn btn-primary">Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        `;
      } else if (tab === 'appearance') {
        content.innerHTML = `
          <div class="glass-panel">
            <div class="panel-header"><div class="panel-title">Local Appearance</div></div>
            <div class="panel-body">
              <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 20px;">These UI settings are saved only to your current browser context.</p>
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">App Theme</label>
                  <select id="theme-selector" class="form-select" onchange="App.previewTheme()">
                    <option value="glass" ${localStorage.getItem('gv_theme') === 'glass' || !localStorage.getItem('gv_theme') ? 'selected' : ''}>Glass (Default)</option>
                    <option value="industrial" ${localStorage.getItem('gv_theme') === 'industrial' ? 'selected' : ''}>Industrial</option>
                  </select>
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Accent Color</label>
                  <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px">Choose your preferred studio accent color</p>
                  <div style="display:flex; gap:12px; margin-top:6px; flex-wrap:wrap;">
                    <button type="button" class="accent-color-btn" style="background:#3b82f6; outline: ${(localStorage.getItem('gv_accent') === 'blue' || localStorage.getItem('gv_accent') === 'cyan' || !localStorage.getItem('gv_accent')) ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('blue'); App.renderProfile();" title="Studio Blue (Default)"></button>
                    <button type="button" class="accent-color-btn" style="background:#10b981; outline: ${localStorage.getItem('gv_accent') === 'emerald' || localStorage.getItem('gv_accent') === 'green' ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('emerald'); App.renderProfile();" title="Emerald Green"></button>
                    <button type="button" class="accent-color-btn" style="background:#f59e0b; outline: ${localStorage.getItem('gv_accent') === 'amber' || localStorage.getItem('gv_accent') === 'orange' ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('amber'); App.renderProfile();" title="Amber Gold"></button>
                    <button type="button" class="accent-color-btn" style="background:#f43f5e; outline: ${localStorage.getItem('gv_accent') === 'rose' || localStorage.getItem('gv_accent') === 'red' ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('rose'); App.renderProfile();" title="Coral Rose"></button>
                    <button type="button" class="accent-color-btn" style="background:#8b5cf6; outline: ${localStorage.getItem('gv_accent') === 'violet' || localStorage.getItem('gv_accent') === 'purple' ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('violet'); App.renderProfile();" title="Studio Violet"></button>
                    <button type="button" class="accent-color-btn" style="background:#14b8a6; outline: ${localStorage.getItem('gv_accent') === 'teal' ? '2px solid #ffffff' : 'none'}" onclick="App.setAccent('teal'); App.renderProfile();" title="Teal Sage"></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (tab === 'api') {
        content.innerHTML = `
          <div class="glass-panel">
            <div class="panel-header"><div class="panel-title">API & Integrations</div></div>
            <div class="panel-body">
              <div class="form-group" style="margin-bottom:0">
                <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5;">Generate an API key to allow external tools (like OrcaSlicer post-processing scripts) to securely interact with your GyroidVault account. Keep this key secret.</p>
                <div id="api-key-result" style="display:none; margin-bottom:15px; background:rgba(16,185,129,0.1); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--success); color:var(--success); word-break:break-all; font-family:monospace; font-size:0.85rem"></div>
                <button type="button" class="btn btn-secondary" onclick="App.generateApiKey()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                  Generate New API Key
                </button>
              </div>
            </div>
          </div>
        `;
      }
    };

    tabs.forEach(t => t.addEventListener('click', () => {
      localStorage.setItem('gv_profile_tab', t.dataset.tab);
      switchTab(t.dataset.tab);
    }));
    
    const defaultTab = localStorage.getItem('gv_profile_tab') || 'account';
    switchTab(defaultTab);
  },

  // ─── Collections ────────────────────────────────────────────────────────
  cachedProjects: [],
  selectedCollectionIds: [],
  collectionsSortBy: 'recent',
  collectionsSearchQuery: '',
  selectedCollectionModelIds: [],
  currentProject: null,
  collectionModelSearchQuery: '',

  async renderProjects() {
    if (!this.currentUser) {
      this.el.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><div class="empty-state-text">Login to view collections</div><div class="empty-state-sub">Collections are private and require an account</div><button class="btn btn-primary btn-sm" onclick="App.showLogin()" style="margin-top:16px">Login</button></div>';
      return;
    }
    this.el.innerHTML = '<div class="skeleton-grid"></div>';
    try {
      this.cachedProjects = await API.getProjects();
      this.el.innerHTML = UI.projectsPage(this.cachedProjects, this.collectionsSortBy, this.collectionsSearchQuery);
      this.renderSidebarCollections();
    } catch (e) { this.toast('Failed to load collections', 'error'); }
  },

  handleCollectionsSearch(query) {
    this.collectionsSearchQuery = query || '';
    this.updateCollectionsGrid();
  },

  handleCollectionsSort(sort) {
    this.collectionsSortBy = sort || 'recent';
    this.updateCollectionsGrid();
  },

  updateCollectionsGrid() {
    const grid = document.getElementById('collections-grid');
    if (!grid) {
      this.el.innerHTML = UI.projectsPage(this.cachedProjects, this.collectionsSortBy, this.collectionsSearchQuery);
      return;
    }
    let filtered = (this.cachedProjects || []).slice();
    if (this.collectionsSearchQuery?.trim()) {
      const q = this.collectionsSearchQuery.toLowerCase().trim();
      filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    if (this.collectionsSortBy === 'name') {
      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (this.collectionsSortBy === 'models') {
      filtered.sort((a, b) => (b.model_count || 0) - (a.model_count || 0));
    } else {
      filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    grid.innerHTML = filtered.map(p => UI.projectCard(p)).join('') || `
      <div class="empty-state" style="grid-column: 1/-1">
        <div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div class="empty-state-text">No collections found</div>
        <div class="empty-state-sub">Try a different search query</div>
      </div>
    `;
  },

  handleCollectionCardClick(e, id) {
    if (e.target.closest('.model-card-checkbox') || e.target.closest('.model-card-hover-actions') || e.target.closest('button') || e.target.closest('a')) {
      return;
    }
    this.navigate('/projects/' + id);
  },

  toggleCollectionSelection(e, id) {
    e?.stopPropagation();
    const numId = Number(id);
    if (!this.selectedCollectionIds) this.selectedCollectionIds = [];
    const idx = this.selectedCollectionIds.indexOf(numId);
    if (idx >= 0) {
      this.selectedCollectionIds.splice(idx, 1);
    } else {
      this.selectedCollectionIds.push(numId);
    }
    this.el.innerHTML = UI.projectsPage(this.cachedProjects, this.collectionsSortBy, this.collectionsSearchQuery);
  },

  clearCollectionSelection() {
    this.selectedCollectionIds = [];
    this.el.innerHTML = UI.projectsPage(this.cachedProjects, this.collectionsSortBy, this.collectionsSearchQuery);
  },

  async bulkDeleteCollections() {
    if (!this.selectedCollectionIds?.length) return;
    const count = this.selectedCollectionIds.length;
    if (!confirm(`Are you sure you want to delete ${count} collection${count > 1 ? 's' : ''}? Models inside them will remain safely in your library.`)) return;
    try {
      await API.bulkDeleteProjects(this.selectedCollectionIds);
      this.toast(`Deleted ${count} collection${count > 1 ? 's' : ''}`);
      this.selectedCollectionIds = [];
      this.renderProjects();
    } catch (e) {
      this.toast(e.message || 'Failed to delete collections', 'error');
    }
  },

  async bulkSetCollectionsVisibility(visibility) {
    if (!this.selectedCollectionIds?.length) return;
    const count = this.selectedCollectionIds.length;
    try {
      await API.bulkSetProjectsVisibility(this.selectedCollectionIds, visibility);
      this.toast(`Updated ${count} collection${count > 1 ? 's' : ''} to ${visibility}`);
      this.selectedCollectionIds = [];
      this.renderProjects();
    } catch (e) {
      this.toast(e.message || 'Failed to update visibility', 'error');
    }
  },

  async renderProjectDetail(id) {
    this.selectedCollectionModelIds = [];
    this.collectionModelSearchQuery = '';
    this.el.innerHTML = '<div class="skeleton-grid"></div>';
    try {
      // A collection only references models: its tiles come from the model list query, so they
      // are the same tiles (covers, badges, counts) as on the main list
      const [project, list] = await Promise.all([
        API.getProject(id),
        API.getModels({ project_id: id, limit: 1000, sort: 'name' })
      ]);
      project.models = list.models || [];
      this.currentProject = project;
      this.el.innerHTML = UI.projectDetail(this.currentProject, this.collectionModelSearchQuery);
      if (typeof Viewer !== 'undefined' && Viewer.generateThumbnails) {
        setTimeout(() => Viewer.generateThumbnails(), 50);
      }
    } catch (e) { this.toast('Failed to load collection', 'error'); }
  },

  handleCollectionModelsSearch(query) {
    this.collectionModelSearchQuery = query || '';
    if (this.currentProject) {
      this.el.innerHTML = UI.projectDetail(this.currentProject, this.collectionModelSearchQuery);
    }
  },

  toggleCollectionModelSelection(e, modelId) {
    e?.stopPropagation();
    const numId = Number(modelId);
    if (!this.selectedCollectionModelIds) this.selectedCollectionModelIds = [];
    const idx = this.selectedCollectionModelIds.indexOf(numId);
    if (idx >= 0) {
      this.selectedCollectionModelIds.splice(idx, 1);
    } else {
      this.selectedCollectionModelIds.push(numId);
    }
    if (this.currentProject) {
      this.el.innerHTML = UI.projectDetail(this.currentProject, this.collectionModelSearchQuery);
    }
  },

  clearCollectionModelSelection() {
    this.selectedCollectionModelIds = [];
    if (this.currentProject) {
      this.el.innerHTML = UI.projectDetail(this.currentProject, this.collectionModelSearchQuery);
    }
  },

  async openAddModelsToCollectionModal(projectId) {
    try {
      const res = await API.getModels({ limit: 500 });
      const allModels = res.models || res || [];
      const currentModelIds = (this.currentProject?.models || []).map(m => m.id);
      this.openModal('Add Models to Collection', UI.addModelsToCollectionModal(allModels, currentModelIds, projectId));
    } catch (e) {
      this.toast('Failed to load library models: ' + e.message, 'error');
    }
  },

  filterModelPickerList(query) {
    const q = (query || '').toLowerCase().trim();
    const items = document.querySelectorAll('#model-picker-list .collection-model-picker-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  toggleSelectAllPickerModels() {
    const checkboxes = document.querySelectorAll('#model-picker-list input[type="checkbox"]:not([style*="display: none"])');
    if (!checkboxes.length) return;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
  },

  async handleAddModelsToCollectionSubmit(e, projectId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const modelIds = fd.getAll('model_ids').map(Number);
    try {
      // First, get currently assigned models to compute additions & removals
      const currentIds = (this.currentProject?.models || []).map(m => m.id);
      const toAdd = modelIds.filter(id => !currentIds.includes(id));
      const toRemove = currentIds.filter(id => !modelIds.includes(id));

      if (toAdd.length > 0) {
        await API.bulkAddModelsToProject(projectId, toAdd);
      }
      if (toRemove.length > 0) {
        await API.bulkRemoveModelsFromProject(projectId, toRemove);
      }

      this.toast(`Collection updated (${toAdd.length} added, ${toRemove.length} removed)`);
      this.closeModal();
      this.renderProjectDetail(projectId);
      this.renderSidebarCollections();
    } catch (err) {
      this.toast(err.message || 'Failed to update collection models', 'error');
    }
  },

  async removeFromProject(projectId, modelId) {
    if (!confirm('Remove this model from the collection?')) return;
    try {
      await API.removeModelFromProject(projectId, modelId);
      this.toast('Model removed from collection');
      this.renderProjectDetail(projectId);
      this.renderSidebarCollections();
    } catch (e) {
      this.toast(e.message || 'Failed to remove model', 'error');
    }
  },

  async bulkRemoveFromCollection(projectId) {
    if (!this.selectedCollectionModelIds?.length) return;
    const count = this.selectedCollectionModelIds.length;
    if (!confirm(`Remove ${count} model${count > 1 ? 's' : ''} from this collection?`)) return;
    try {
      await API.bulkRemoveModelsFromProject(projectId, this.selectedCollectionModelIds);
      this.toast(`Removed ${count} model${count > 1 ? 's' : ''} from collection`);
      this.selectedCollectionModelIds = [];
      this.renderProjectDetail(projectId);
      this.renderSidebarCollections();
    } catch (e) {
      this.toast(e.message || 'Failed bulk removal', 'error');
    }
  },

  async bulkAddSelectedToAnotherCollection(currentProjectId) {
    if (!this.selectedCollectionModelIds?.length) return;
    try {
      const projects = await API.getProjects();
      const otherProjects = projects.filter(p => p.id !== Number(currentProjectId));
      if (!otherProjects.length) {
        this.toast('No other collections found to copy to', 'error');
        return;
      }
      this.openModal('Copy Models to Collection', UI.collectionSelectForm(otherProjects, [], null));
    } catch (e) {
      this.toast(e.message, 'error');
    }
  },

  downloadCollectionZip(projectId) {
    this.toast('Generating collection ZIP...', 'info');
    const a = document.createElement('a');
    a.href = `/api/projects/${projectId}/download`;
    a.download = `collection_${projectId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  showCreateProject() {
    this.openModal('New Collection', UI.projectForm());
  },

  async handleProjectSubmit(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name'),
      description: fd.get('description'),
      visibility: fd.get('visibility') || 'public'
    };
    try {
      if (id) {
        await API.updateProject(id, data);
        this.toast('Collection updated');
        this.closeModal();
        if (location.hash.startsWith('#/projects/') || location.hash.startsWith('#/collections/')) {
          this.renderProjectDetail(id);
        } else {
          this.renderProjects();
        }
      } else {
        await API.createProject(data);
        this.toast('Collection created');
        this.closeModal();
        this.renderProjects();
      }
      this.renderSidebarCollections();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async openEditProjectModal(projectId) {
    try {
      const project = await API.getProject(projectId);
      this.openModal('Edit Collection', UI.editProjectModal(project));
    } catch (e) {
      this.toast('Failed to load collection: ' + e.message, 'error');
    }
  },

  async handleProjectUpdateSubmit(e, projectId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name'),
      description: fd.get('description'),
      visibility: fd.get('visibility')
    };
    try {
      await API.updateProject(projectId, data);
      this.toast('Collection updated');
      this.closeModal();
      if (location.hash.startsWith('#/projects/') || location.hash.startsWith('#/collections/')) {
        this.renderProjectDetail(projectId);
      } else {
        this.renderProjects();
      }
      this.renderSidebarCollections();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async deleteProject(id) {
    if (!confirm('Are you sure you want to delete this collection? Models will not be deleted.')) return;
    try {
      await API.deleteProject(id);
      this.toast('Collection deleted');
      this.navigate('/collections');
      this.renderSidebarCollections();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async addToProject(modelId) {
    return this.openModelCollectionsModal(modelId);
  },

  async openModelCollectionsModal(modelId) {
    try {
      const [model, projects] = await Promise.all([API.getModel(modelId), API.getProjects()]);
      const selectedIds = (model.projects || []).map(p => p.id);
      this.openModal('Manage Collections', UI.collectionSelectForm(projects, selectedIds, modelId));
    } catch (e) {
      this.toast('Failed to load collections: ' + e.message, 'error');
    }
  },

  async handleCollectionSelectionSubmit(e, modelId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const selectedProjectIds = fd.getAll('project_ids').map(Number);
    try {
      if (modelId) {
        await API.syncModelProjects(modelId, selectedProjectIds);
        this.toast('Collections updated successfully');
        this.closeModal();
        if (location.hash.startsWith('#/models/')) {
          this.renderModelDetail(modelId);
        } else {
          this.fetchAndRenderModels();
        }
      } else if (this.selectedModelIds?.length > 0) {
        // Bulk add
        for (const pid of selectedProjectIds) {
          await API.bulkAddModelsToProject(pid, this.selectedModelIds);
        }
        this.toast(`Added ${this.selectedModelIds.length} models to ${selectedProjectIds.length} collection(s)`);
        this.closeModal();
      }
      this.renderSidebarCollections();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  filterCollectionList(query) {
    const q = (query || '').toLowerCase().trim();
    const items = document.querySelectorAll('.collection-checkbox-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  // ─── Sharing ─────────────────────────────────────────────────────────
  showShareModal(modelId) {
    this.openModal('Share Model', UI.shareModal(modelId));
  },

  async generateShare(modelId) {
    const days = document.getElementById('share-expiry').value;
    try {
      const { slug } = await API.createShare(modelId, days);
      const link = `${window.location.origin}/#/share/${slug}`;
      const res = document.getElementById('share-result');
      const input = document.getElementById('share-link-input');
      input.value = link;
      res.style.display = 'block';
    } catch (e) { this.toast(e.message, 'error'); }
  },

  copyShareLink() {
    const input = document.getElementById('share-link-input');
    if (input) {
      this.copyToClipboard(input.value, 'Link copied to clipboard');
    }
  },

  showCreateVersion(id, name) {
    const modelName = name || this.currentModel?.name || 'Model';
    const safeName = UI.escapeHtml(modelName);
    const html = `
      <form onsubmit="App.handleVersionSubmit(event, ${id})" class="form-grid">
        <div class="form-group">
          <label>Version Name</label>
          <input type="text" name="name" value="${safeName} (v2)" required class="form-input" placeholder="e.g. My Model v2">
        </div>
        <div class="form-group">
          <label>Description of changes (optional)</label>
          <textarea name="description" class="form-textarea" placeholder="What changed in this version?"></textarea>
        </div>
        <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:8px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Version</button>
        </div>
      </form>`;
    this.openModal('New Version', html);
  },

  async handleVersionSubmit(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = { name: fd.get('name'), description: fd.get('description') };
    try {
      const res = await API.createVersion(id, data);
      this.toast('Version created');
      this.closeModal();
      this.navigate(`/models/${res.id}`);
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async renderSharedModel(slug) {
    this.el.innerHTML = '<div style="padding:40px;text-align:center">Loading shared model...</div>';
    try {
      const model = await API.getSharedModel(slug);
      this.el.innerHTML = UI.publicModelDetail(model);
      
      const stlFile = model.files.find(f => f.file_type === 'stl') || model.files.find(f => f.file_type === '3mf') || model.files.find(f => f.file_type === 'step');
      if (stlFile && typeof Viewer !== 'undefined') {
        setTimeout(() => {
          Viewer.create('public-viewer', stlFile.url, stlFile.file_type);
        }, 100);
      }
    } catch (e) {
      this.el.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Share link invalid or expired</div></div>`;
    }
  },

  openInSlicer(fileUrl, slicer) {
    const absoluteUrl = window.location.origin + fileUrl;
    let protocol = '';
    if (slicer === 'bambustudio') protocol = 'bambustudio://open?file=';
    else if (slicer === 'prusaslicer') protocol = 'prusaslicer://';
    else if (slicer === 'orcaslicer') protocol = 'orcaslicer://open?file=';
    
    if (protocol) {
      window.location.href = protocol + absoluteUrl;
      this.toast(`Opening in ${slicer}...`);
    } else {
      // Fallback for Cura: just download?
      window.open(fileUrl, '_blank');
    }
  },

  // ─── Model Detail ────────────────────────────────────────────────────
  // opts.trash: the model is in the Trash and opened from there
  async renderModelDetail(id, opts = {}) {
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    this.kitDispose3D();
    this.currentModelOpts = opts;
    this.el.innerHTML = '<div style="padding:40px;text-align:center"><div class="skeleton" style="width:200px;height:30px;margin:0 auto 20px"></div><div class="skeleton" style="width:100%;height:200px"></div></div>';
    try {
      const model = await API.getModel(id, opts.trash);
      this.trashRetentionDays = model.trash_retention_days;
      const config = await API.getSystemSettings().catch(() => ({}));
      let printers = [];
      try { if (config.printers) printers = JSON.parse(config.printers); } catch(e){}
      const hasPrinters = printers.length > 0;

      this.currentModel = model;
      // A kit archive (USSA VAULT) opens in its configurator; ?view=files shows the file list
      const kit = opts.trash ? null : this.kitFor(model);
      const view = kit && opts.view !== 'files' ? 'configure' : 'files';
      this.el.innerHTML = `
        ${UI.modelDetail(model, hasPrinters, { kit, view })}`;
      if (view === 'configure') return this.initKit(model, opts);
      this.kit = null;
      this.fitFileTree(document.getElementById('tab-content-files'));
      // Coming from the Trash page: open the model's Trash tab
      if (this.pendingFilesTab) {
        this.selectFilesTab(this.pendingFilesTab);
        this.pendingFilesTab = null;
      }
      // Initialize 3D viewer using chosen 3D preview file or first stl/3mf
      const files = model.files || [];
      const cadFiles = files.filter(f => UI.previewKind(f) === '3d');
      const firstPreview = UI.defaultPreviewFile(model);
      const previewCadFile = firstPreview && UI.previewKind(firstPreview) === '3d' ? firstPreview : null;

      this.loadReadme(model);
      // Images, videos, documents and G-code open through the same path as a row click
      if (firstPreview && !previewCadFile) {
        setTimeout(() => this.previewFile(model.id, firstPreview.id, { initial: true }), 100);
      }
      // A large 3D file (USSA VAULT has 350 MB STLs) is loaded only on request
      if (previewCadFile && typeof Viewer !== 'undefined' && Number(previewCadFile.file_size) > Viewer.MAX_AUTO_PREVIEW_BYTES) {
        setTimeout(() => this.showLargePreviewPrompt(model.id, previewCadFile), 100);
      } else if (previewCadFile && typeof Viewer !== 'undefined') {
        const stlUrl = `${previewCadFile.url || '/uploads/'+previewCadFile.filename}?t=${Date.now()}`;
        setTimeout(async () => {
          const v = Viewer.create(`stl-viewer-${model.id}`, stlUrl, previewCadFile.file_type, {
            modelId: model.id,
            activeFileId: previewCadFile.id,
            modelFiles: cadFiles
          });
          this.highlightPreviewFile(previewCadFile.id);
          if (v && !model.thumbnail_url && !model.thumbnail) {
            Promise.resolve(v.ready).then(() => {
              setTimeout(() => Viewer.takeSnapshot(model.id, v.renderer, v.scene, v.camera), 2500);
            });
          }
        }, 100);
      }
    } catch (e) {
      if (e.status === 423) return this.renderAdultLock(id, (e.data && e.data.name) || '');
      this.el.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent-yellow)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-state-text">Model not found</div></div>';
    }
  },

  // ─── Kit configurators (public/js/kits): USSA VAULT ─────────────────────
  // this.kit: { modelId, cat (parts catalog), cfg, bom, choices, saved, savedId, previewId }.
  // Every change recomputes the parts list, keeps the configuration in the URL (?c=, without a
  // new history entry) and in localStorage, and redraws the builder and the list.
  kitFor(model) {
    return typeof VaultKit !== 'undefined' && !model.deleted_at && VaultKit.detect(model.files || []) ? 'ussa-vault' : null;
  },

  async initKit(model, opts) {
    const stored = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
    const fromUrl = opts.c ? VaultKit.decodeConfig(opts.c) : null;
    // A re-render of the page (after Edit, an unlock) must not bring back the URL it opened with
    if (this.currentModelOpts) this.currentModelOpts.c = null;
    const last = stored(`gv_kit_${model.id}`) || {};
    // A link with another configuration is not the saved one that was open (a reload is)
    const otherLink = fromUrl && JSON.stringify(fromUrl) !== JSON.stringify(last.cfg);
    this.kit = { modelId: model.id, cat: VaultKit.buildCatalog(model.files || []), saved: [], savedId: otherLink ? null : last.savedId || null, previewId: null, view: 'tower' };
    this.kitApply(fromUrl || last.cfg || VaultKit.defaultConfig());
    this.kitBindTips();
    if (!this.currentUser) return;
    try {
      const saved = await API.getKitConfigs(model.id, 'ussa-vault');
      if (!this.kit || this.kit.modelId !== model.id) return;
      this.kit.saved = saved;
      if (!saved.some(s => s.id === this.kit.savedId)) this.kit.savedId = null;
      this.kitRenderBuilder();
    } catch (e) {}
  },

  kitApply(input) {
    const kit = this.kit;
    if (!kit) return;
    kit.bom = VaultKit.computeBom(kit.cat, input);
    kit.cfg = kit.bom.cfg;
    kit.choices = VaultKit.choices(kit.cat, kit.cfg);
    try { localStorage.setItem(`gv_kit_${kit.modelId}`, JSON.stringify({ cfg: kit.cfg, savedId: kit.savedId })); } catch (e) {}
    if (location.hash.startsWith(`#/models/${kit.modelId}`)) {
      history.replaceState(null, '', `#/models/${kit.modelId}?c=${VaultKit.encodeConfig(kit.cfg)}`);
    }
    this.kitRenderBuilder();
    this.kitRenderParts();
    if (kit.view === 'tower') this.kitShowTower();
    // A pinned tip follows the configuration (its control was redrawn)
    if (this.kitTipPinned && this.kitTipAnchor) {
      const el = this.kitTipAnchorEl();
      if (el) this.kitShowTip(el, true); else this.kitHideTip(true);
    }
  },

  kitState() {
    const kit = this.kit;
    const saved = kit.saved.find(s => s.id === kit.savedId);
    return { ...kit, loggedIn: Boolean(this.currentUser), dirty: Boolean(saved) && JSON.stringify(saved.config) !== JSON.stringify(kit.cfg) };
  },

  // The builder and the list scroll on their own: keep where they were when they are redrawn
  kitRenderBuilder() {
    const el = document.getElementById('kit-builder');
    if (!el || !this.kit) return;
    const top = el.scrollTop;
    el.innerHTML = UI.kitBuilder(this.kitState());
    el.scrollTop = top;
  },

  kitRenderParts() {
    const el = document.getElementById('kit-parts');
    if (!el || !this.kit) return;
    const body = el.querySelector('.kit-parts-body');
    const top = body ? body.scrollTop : 0;
    el.innerHTML = UI.kitParts(this.kitState());
    const next = el.querySelector('.kit-parts-body');
    if (next) next.scrollTop = top;
  },

  // Changes to a copy of the configuration; the kit checks it against the archive
  kitUpdate(change) {
    if (!this.kit) return;
    const cfg = JSON.parse(JSON.stringify(this.kit.cfg));
    change(cfg);
    this.kitApply(cfg);
  },

  kitSet(field, value) {
    this.kitUpdate(cfg => { cfg[field] = field === 'depth' ? Number(value) : value; });
  },

  kitMod(field, value) {
    this.kitUpdate(cfg => {
      cfg.mods[field] = value;
      // A wheeled base stands on its feet at the front
      if (field === 'base' && value === 'wheels') cfg.mods.feet = true;
    });
  },

  kitFloor(fi, field, value) {
    this.kitUpdate(cfg => { if (cfg.floors[fi]) cfg.floors[fi][field] = value; });
  },

  kitSlot(fi, si, field, value) {
    this.kitUpdate(cfg => {
      const floor = cfg.floors[fi];
      if (!floor || !floor.slots[si]) return;
      if (field === 'type') floor.slots[si] = VaultKit.defaultSlot(value);
      else floor.slots[si][field] = value;
    });
  },

  kitAddFloor() {
    this.kitUpdate(cfg => {
      const top = cfg.floors[cfg.floors.length - 1];
      cfg.floors.push(top ? JSON.parse(JSON.stringify(top)) : VaultKit.newFloor(cfg.width));
    });
  },

  kitCopyFloor(fi) {
    this.kitUpdate(cfg => { if (cfg.floors[fi]) cfg.floors.splice(fi + 1, 0, JSON.parse(JSON.stringify(cfg.floors[fi]))); });
  },

  kitRemoveFloor(fi) {
    this.kitUpdate(cfg => { if (cfg.floors.length > 1) cfg.floors.splice(fi, 1); });
  },

  // dir: 1 moves the floor up the tower, -1 down
  kitMoveFloor(fi, dir) {
    this.kitUpdate(cfg => {
      const to = fi + dir;
      if (to < 0 || to >= cfg.floors.length) return;
      [cfg.floors[fi], cfg.floors[to]] = [cfg.floors[to], cfg.floors[fi]];
    });
  },

  // A print count changed by hand; '' goes back to the computed one
  kitQty(key, value) {
    if (!key) return;
    this.kitUpdate(cfg => {
      const n = Math.floor(Number(value));
      const row = this.kit.bom.parts.find(p => p.key === key);
      const auto = row ? (row.auto !== undefined ? row.auto : row.qty) : null;
      if (value === '' || !Number.isFinite(n) || n < 0 || n === auto) delete cfg.qty[key];
      else cfg.qty[key] = Math.min(n, 999);
    });
  },

  // Any file of the project can be added to the list (an alternative part, a photo, a PDF)
  kitAddExtra(name) {
    const file = (this.currentModel.files || []).find(f => f.original_name === name);
    if (!file) return;
    const key = VaultKit.classify(file.original_name) || `path:${file.original_name}`;
    this.kitUpdate(cfg => { cfg.extra[key] = (cfg.extra[key] || 0) + 1; });
  },

  kitRemoveExtra(key) {
    this.kitUpdate(cfg => { delete cfg.extra[key]; delete cfg.qty[key]; });
  },

  kitReset() {
    if (!this.kit) return;
    this.kit.savedId = null;
    this.kitApply(VaultKit.defaultConfig());
  },

  // A row of the list opens its file in the 3D Studio: only that file, the list is the selector.
  // Large STLs (up to 350 MB in VAULT) wait for a click.
  kitPreview(fileId, force = false) {
    const model = this.currentModel;
    const file = model && (model.files || []).find(f => f.id === Number(fileId));
    if (!file || !this.kit) return;
    this.kit.previewId = file.id;
    this.kitLeaveTower('part');
    const title = document.querySelector('.kit-preview-panel .detail-viewer-title');
    if (title) title.textContent = '3D Studio';
    document.querySelectorAll('.kit-part.is-active').forEach(el => el.classList.remove('is-active'));
    document.querySelectorAll(`.kit-part[data-file-id="${file.id}"]`).forEach(el => el.classList.add('is-active'));
    if (!force && UI.previewKind(file) === '3d' && typeof Viewer !== 'undefined' && Number(file.file_size) > Viewer.MAX_AUTO_PREVIEW_BYTES) {
      Viewer.cleanup();
      return this.showLargePreviewPrompt(model.id, file, `App.kitPreview(${file.id}, true)`);
    }
    this.previewFile(model.id, file.id, { modelFiles: [file] });
  },

  kitListText() {
    const saved = this.kit.saved.find(s => s.id === this.kit.savedId);
    return VaultKit.bomText(this.kit.bom, saved ? `${this.currentModel.name}: ${saved.name}` : this.currentModel.name);
  },

  kitCopyList() {
    if (this.kit) this.copyToClipboard(this.kitListText(), 'Parts list copied');
  },

  // The chosen files (each once), the instruction PDFs and the parts list as one ZIP, streamed
  // by the server; the POST keeps the selection under a token, the link downloads it
  async kitDownload() {
    const kit = this.kit;
    const model = this.currentModel;
    if (!kit || !model) return;
    const ids = [...new Set([...kit.bom.parts.filter(p => p.qty > 0).map(p => p.file.id), ...kit.bom.docs.map(f => f.id)])];
    if (!ids.length) return this.toast('Nothing to download', 'error');
    const saved = kit.saved.find(s => s.id === kit.savedId);
    const label = saved ? saved.name : VaultKit.describe(kit.cfg).split(' · ')[0];
    try {
      const res = await API.prepareSelectionDownload(model.id, {
        file_ids: ids,
        name: `${model.name} ${label}`,
        text: { name: `${model.name} parts list.txt`, content: this.kitListText() }
      });
      const a = document.createElement('a');
      a.href = res.url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.toast(`Downloading ${ids.length} files, ${UI.formatSize(kit.bom.totals.bytes)}`, 'info');
    } catch (e) {
      this.toast(e.message, 'error');
    }
  },

  // ── Saved configurations ──
  kitOpenSaved(id) {
    const kit = this.kit;
    if (!kit) return;
    const saved = kit.saved.find(s => String(s.id) === String(id));
    kit.savedId = saved ? saved.id : null;
    if (saved) this.kitApply(saved.config);
    else this.kitApply(kit.cfg);
  },

  async kitSave() {
    const kit = this.kit;
    if (!kit || !kit.savedId) return this.kitSaveAs();
    try {
      const row = await API.updateKitConfig(kit.modelId, kit.savedId, { config: kit.cfg });
      kit.saved = kit.saved.map(s => (s.id === row.id ? row : s));
      this.kitRenderBuilder();
      this.toast('Configuration saved');
    } catch (e) { this.toast(e.message, 'error'); }
  },

  kitSaveAs() {
    if (!this.kit) return;
    const saved = this.kit.saved.find(s => s.id === this.kit.savedId);
    this.kitNameOp = 'create';
    this.openModal('Save configuration', UI.kitNameForm({ value: saved ? `${saved.name} (copy)` : VaultKit.describe(this.kit.cfg), submitLabel: 'Save' }));
    setTimeout(() => document.getElementById('kit-name-input')?.select(), 60);
  },

  kitRenameSaved() {
    const saved = this.kit && this.kit.saved.find(s => s.id === this.kit.savedId);
    if (!saved) return;
    this.kitNameOp = 'rename';
    this.openModal('Rename configuration', UI.kitNameForm({ value: saved.name, submitLabel: 'Rename' }));
    setTimeout(() => document.getElementById('kit-name-input')?.select(), 60);
  },

  async kitSubmitName(e) {
    e.preventDefault();
    const kit = this.kit;
    if (!kit) return;
    const name = String(new FormData(e.target).get('name') || '').trim();
    try {
      if (this.kitNameOp === 'rename') {
        const row = await API.updateKitConfig(kit.modelId, kit.savedId, { name });
        kit.saved = kit.saved.map(s => (s.id === row.id ? row : s));
      } else {
        const row = await API.createKitConfig(kit.modelId, { kit: 'ussa-vault', name, config: kit.cfg });
        kit.saved = [row, ...kit.saved];
        kit.savedId = row.id;
      }
      this.closeModal();
      this.kitApply(kit.cfg);
      this.toast('Configuration saved');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async kitDeleteSaved() {
    const kit = this.kit;
    const saved = kit && kit.saved.find(s => s.id === kit.savedId);
    if (!saved || !confirm(`Delete the saved configuration "${saved.name}"? The tower stays in the builder.`)) return;
    try {
      await API.deleteKitConfig(kit.modelId, saved.id);
      kit.saved = kit.saved.filter(s => s.id !== saved.id);
      kit.savedId = null;
      this.kitApply(kit.cfg);
      this.toast('Configuration deleted');
    } catch (e) { this.toast(e.message, 'error'); }
  },

  // ── The tower drawing and the manual in the preview panel ──
  // The panel shows the tower (front and side, to scale) until a part or a manual page is opened;
  // "Show the tower" brings it back
  kitShowTower() {
    const kit = this.kit;
    const container = kit && document.getElementById(`stl-viewer-${kit.modelId}`);
    if (!container) return;
    if (kit.view !== 'tower' && typeof Viewer !== 'undefined') Viewer.cleanup();
    kit.view = 'tower';
    kit.previewId = null;
    document.querySelectorAll('.kit-part.is-active').forEach(el => el.classList.remove('is-active'));
    const mode = this.kitTowerModeNow();
    let shown3d = false;
    if (mode === '3d' && typeof VaultKit3D !== 'undefined') {
      // The scene stays and only rebuilds the tower; it is made again when it left the panel
      if (kit.scene3d && container.contains(kit.scene3d.canvas)) {
        kit.scene3d.update(kit.cfg);
        shown3d = true;
      } else {
        this.kitDispose3D();
        kit.scene3d = VaultKit3D.mount(container, kit.cfg, {
          background: typeof Viewer !== 'undefined' ? Viewer.sceneColors().background : undefined,
          onHover: (fi) => this.kitHoverFloor(fi),
          onClick: (fi) => this.kitFocusFloor(fi)
        });
        shown3d = Boolean(kit.scene3d);
      }
    }
    if (!shown3d) {
      this.kitDispose3D();
      container.innerHTML = UI.kitDrawing(kit.cfg, kit.bom.height);
    }
    const panel = container.closest('.detail-viewer-panel');
    const title = panel && panel.querySelector('.detail-viewer-title');
    const hint = panel && panel.querySelector('.detail-viewer-hint');
    const button = panel && panel.querySelector('.kit-tower-btn');
    const modes = panel && panel.querySelector('.kit-tower-modes');
    if (title) title.textContent = 'Tower';
    if (button) button.hidden = true;
    if (modes) {
      modes.hidden = false;
      modes.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('is-active', b.dataset.mode === (shown3d ? '3d' : '2d')));
    }
    if (hint) {
      if (hint.dataset.defaultHtml === undefined) hint.dataset.defaultHtml = hint.innerHTML;
      hint.classList.remove('is-media');
      hint.textContent = shown3d
        ? 'Drag to turn · scroll to zoom · right-drag to move · click a floor to edit it'
        : 'Front and side, to scale · click a floor to edit it · click a part in the list to see it in 3D';
    }
  },

  // The tower in 3D (a model of simple shapes) or as the drawing with dimensions; remembered
  kitTowerModeNow() {
    try { return localStorage.getItem('gv_kit_tower') === '2d' ? '2d' : '3d'; } catch (e) { return '3d'; }
  },

  kitTowerMode(mode) {
    try { localStorage.setItem('gv_kit_tower', mode === '2d' ? '2d' : '3d'); } catch (e) {}
    if (this.kit) { this.kit.view = 'tower'; this.kitShowTower(); }
  },

  // Free the 3D tower's WebGL context (leaving the tower view or the page)
  kitDispose3D() {
    if (this.kit && this.kit.scene3d) {
      this.kit.scene3d.dispose();
      this.kit.scene3d = null;
    }
  },

  // Something else than the tower is in the panel: offer the way back
  kitLeaveTower(view) {
    if (!this.kit) return;
    this.kitDispose3D();
    this.kit.view = view;
    const button = document.querySelector('.kit-preview-panel .kit-tower-btn');
    const modes = document.querySelector('.kit-preview-panel .kit-tower-modes');
    if (button) button.hidden = false;
    if (modes) modes.hidden = true;
  },

  // A page of an instruction PDF from the archive in the preview panel (the browser's viewer)
  kitShowManual(name, page) {
    const model = this.currentModel;
    const file = model && (model.files || []).find(f => f.original_name === name);
    const container = model && document.getElementById(`stl-viewer-${model.id}`);
    if (!file || !container) return this.toast(`${name} is not in this project`, 'error');
    this.kitHideTip(true);
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    const url = file.url || `/uploads/${file.filename}`;
    container.dataset.previewToken = String(Date.now() + Math.random());
    this.setPreviewHint(container, file, 'pdf', url);
    this.renderMediaPreview(container, file, 'pdf', `${url}#page=${Number(page) || 1}`);
    this.kitLeaveTower('manual');
    const r = container.getBoundingClientRect();
    if (r.top < 56 || r.bottom > window.innerHeight) (container.closest('.glass-panel') || container).scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // A floor of the drawing was clicked: bring its card into view in the builder
  kitFocusFloor(fi) {
    const card = document.querySelector(`.kit-floor[data-fi="${Number(fi)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.classList.remove('is-focused');
    void card.offsetWidth;
    card.classList.add('is-focused');
  },

  // The floor under the pointer is marked in the builder and in the drawing (fi null: none)
  kitHoverFloor(fi) {
    document.querySelectorAll('.kit-floor.is-hover, .kd-floor.is-hover').forEach(el => el.classList.remove('is-hover'));
    if (this.kit && this.kit.scene3d) this.kit.scene3d.highlight(fi === null || fi === undefined ? null : Number(fi));
    if (fi === null || fi === undefined) return;
    document.querySelectorAll(`.kit-floor[data-fi="${Number(fi)}"], .kd-floor[data-fi="${Number(fi)}"]`).forEach(el => el.classList.add('is-hover'));
  },

  // ── Tips (VaultKit.TIPS) ──
  // A control with data-tip shows its tip after a short hover or on focus; its ⓘ button pins the
  // tip, which then stays until a click outside or Escape. A pinned tip with choices changes the
  // option with a click on a card. data-tip-set says where the value lives:
  // 'cfg:<field>', 'mod:<field>', 'floor:<fi>:<field>', 'slot:<fi>:<si>:<field>'.
  kitTipValue(set) {
    const cfg = this.kit && this.kit.cfg;
    const [kind, a, b, c] = String(set || '').split(':');
    if (!cfg || !kind) return undefined;
    if (kind === 'cfg') return String(cfg[a]);
    if (kind === 'mod') return String(cfg.mods[a]);
    if (kind === 'floor') return cfg.floors[a] && String(cfg.floors[a][b]);
    if (kind === 'slot') return cfg.floors[a] && cfg.floors[a].slots[b] && String(cfg.floors[a].slots[b][c]);
    return undefined;
  },

  // { relevant, available } choices of a tip: the layouts of this width, what the archive offers
  kitTipOptions(set) {
    const ch = this.kit && this.kit.choices;
    const [kind, a, b, c] = String(set || '').split(':');
    if (!ch) return {};
    if (kind === 'cfg' && a === 'roof') return { available: ['none', ...ch.roofs] };
    if (kind === 'mod' && a === 'base') return { available: ch.bases };
    if (kind === 'mod' && a === 'backbone') return { available: ch.backbones };
    if (kind === 'floor' && b === 'layout' && ch.floors[a]) return { relevant: ch.floors[a].layouts.map(l => l.id), available: ch.floors[a].layouts.filter(l => l.available).map(l => l.id) };
    if (kind === 'slot' && ch.floors[a] && ch.floors[a].slots[b]) {
      const sc = ch.floors[a].slots[b];
      if (c === 'type') return { available: sc.types };
      if (c === 'interior') return { relevant: sc.interiors, available: sc.interiors };
    }
    return {};
  },

  kitShowTip(el, pinned = false) {
    const key = el && el.dataset.tip;
    const tip = key && typeof VaultKit !== 'undefined' && VaultKit.TIPS[key];
    if (!tip || !this.kit) return;
    if (!pinned && this.kitTipPinned) return;
    let box = document.getElementById('kit-tip');
    if (!box) {
      box = document.createElement('div');
      box.id = 'kit-tip';
      box.className = 'kit-tip';
      box.setAttribute('role', 'tooltip');
      box.addEventListener('mouseenter', () => clearTimeout(this.kitTipTimer));
      box.addEventListener('mouseleave', () => this.kitHideTip());
      document.body.appendChild(box);
    }
    const set = el.dataset.tipSet || '';
    // A second click on the ⓘ of the pinned tip closes it
    if (pinned && this.kitTipPinned && !box.hidden && this.kitTipAnchor && this.kitTipAnchor.key === key && this.kitTipAnchor.set === set && el.classList.contains('kit-tip-btn') && this.kitTipClicked === el) {
      this.kitTipClicked = null;
      return this.kitHideTip(true);
    }
    if (pinned) this.kitTipClicked = el;
    this.kitTipPinned = pinned;
    this.kitTipAnchor = { key, set };
    box.classList.toggle('is-pinned', pinned);
    box.innerHTML = UI.kitTipContent(tip, { value: this.kitTipValue(set), set, ...this.kitTipOptions(set) });
    box.hidden = false;
    this.kitPlaceTip(box, el);
  },

  // Next to the builder when there is room, else under (or over) the control
  kitPlaceTip(box, el) {
    const r = el.getBoundingClientRect();
    const panel = document.querySelector('.kit-builder-panel');
    const p = panel ? panel.getBoundingClientRect() : r;
    const w = Math.min(380, window.innerWidth - 16);
    box.style.width = `${w}px`;
    const h = box.offsetHeight;
    let left;
    let top;
    if (window.innerWidth - p.right >= w + 16) {
      left = p.right + 10;
      top = Math.min(Math.max(r.top - 24, 12), window.innerHeight - h - 12);
    } else {
      left = Math.min(Math.max(r.left, 8), window.innerWidth - w - 8);
      top = r.bottom + 8 + h <= window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    }
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(Math.max(8, top))}px`;
  },

  kitHideTip(force = false) {
    clearTimeout(this.kitTipTimer);
    if (this.kitTipPinned && !force) return;
    const box = document.getElementById('kit-tip');
    if (box) box.hidden = true;
    this.kitTipPinned = false;
  },

  // A card of a pinned tip changes the option; kitApply shows the tip again with the new value
  kitTipPick(set, value) {
    const [kind, a, b, c] = String(set || '').split(':');
    if (kind === 'cfg') this.kitSet(a, value);
    else if (kind === 'mod') this.kitMod(a, value);
    else if (kind === 'floor') this.kitFloor(Number(a), b, value);
    else if (kind === 'slot') this.kitSlot(Number(a), Number(b), c, value);
  },

  // The ⓘ button of the pinned tip after the builder was redrawn
  kitTipAnchorEl() {
    const a = this.kitTipAnchor;
    if (!a) return null;
    const set = a.set ? `[data-tip-set="${a.set}"]` : ':not([data-tip-set])';
    return document.querySelector(`.kit-tip-btn[data-tip="${a.key}"]${set}`);
  },

  // Hover and focus on the builder's controls; once per page, the builder is redrawn inside
  kitBindTips() {
    const target = (e) => e.target.closest && e.target.closest('[data-tip]');
    for (const id of ['kit-builder', 'kit-parts']) {
      const root = document.getElementById(id);
      if (!root || root.dataset.tips) continue;
      root.dataset.tips = '1';
      // The ⓘ answers at once, the controls after a short pause (so moving across them is quiet)
      root.addEventListener('mouseover', (e) => {
        const el = target(e);
        if (!el) return;
        clearTimeout(this.kitTipTimer);
        this.kitTipTimer = setTimeout(() => this.kitShowTip(el), el.classList.contains('kit-tip-btn') ? 120 : 450);
      });
      root.addEventListener('mouseout', (e) => {
        if (!target(e)) return;
        clearTimeout(this.kitTipTimer);
        this.kitTipTimer = setTimeout(() => this.kitHideTip(), 200);
      });
      root.addEventListener('focusin', (e) => { const el = target(e); if (el) this.kitShowTip(el); });
      root.addEventListener('focusout', () => this.kitHideTip());
    }
    if (!this.kitTipDocBound) {
      this.kitTipDocBound = true;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.kitHideTip(true); });
      // The 3D tower follows the light / dark theme like the other scenes
      document.addEventListener('gv:theme', () => {
        if (this.kit && this.kit.scene3d && typeof Viewer !== 'undefined') this.kit.scene3d.setBackground(Viewer.sceneColors().background);
      });
      document.addEventListener('mousedown', (e) => {
        if (!this.kitTipPinned) return;
        if (e.target.closest && (e.target.closest('#kit-tip') || e.target.closest('.kit-tip-btn'))) return;
        this.kitHideTip(true);
      });
    }
  },

  // ─── Password-protected models ───────────────────────────────────────
  renderAdultLock(id, name) {
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    this.el.innerHTML = `
      <div class="adult-lock">
        <form class="glass-panel adult-lock-card" onsubmit="App.submitAdultUnlock(event, ${Number(id)})">
          <span class="badge badge-adult"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Protected</span>
          <div class="adult-lock-title">${UI.escapeHtml(name || 'Protected model')}</div>
          <div class="adult-lock-text">This model is password protected. Enter the password to open it.</div>
          <input type="text" class="form-input masked-input" name="unlock_code" id="adult-password-input" placeholder="Password" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" required>
          <div class="adult-lock-error" id="adult-lock-error"></div>
          <div class="adult-lock-actions">
            <a href="#/models" class="btn btn-ghost btn-sm">Back to library</a>
            <button type="submit" class="btn btn-primary btn-sm">Open</button>
          </div>
        </form>
      </div>`;
    setTimeout(() => { UI.maskFallback(this.el); document.getElementById('adult-password-input')?.focus(); }, 50);
  },

  async submitAdultUnlock(e, id) {
    e.preventDefault();
    const input = e.target.querySelector('[name="unlock_code"]');
    const errEl = document.getElementById('adult-lock-error');
    try {
      const r = await API.unlockModel(id, input.value);
      this.adultUnlock = { id: Number(id), token: r.token };
      this.renderModelDetail(id);
    } catch (err) {
      if (errEl) errEl.textContent = err.status === 403 ? 'Wrong password' : (err.message || 'Could not unlock');
      input.value = '';
      input.focus();
    }
  },

  openBulkAdult() {
    const n = this.selectedModelIds.length;
    this.openModal('Password protection', `
      <div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:16px">${n} selected model${n === 1 ? '' : 's'}. Opening a protected model asks for the password set in Settings → Security; its thumbnail is blurred in lists.</div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.applyBulkAdult(false)">Remove protection</button>
        <button type="button" class="btn btn-primary" onclick="App.applyBulkAdult(true)">Protect</button>
      </div>`);
  },

  async applyBulkAdult(isAdult) {
    try {
      await API.bulkUpdateModels(this.selectedModelIds, { is_adult: isAdult });
      this.toast(isAdult ? 'Password protection on' : 'Password protection removed');
      this.closeModal();
      this.route();
    } catch (e) { this.toast(e.message || 'Failed to update', 'error'); }
  },

  async saveAdultPassword(e) {
    e.preventDefault();
    const pw = e.target.querySelector('[name="new_unlock_code"]').value;
    try {
      await API.setAdultPassword(pw);
      this.publicConfig = { ...(this.publicConfig || {}), adult_password_set: true };
      this.toast('Password saved');
      this.renderSettings('security');
    } catch (err) { this.toast(err.message || 'Failed to save the password', 'error'); }
  },

  async removeAdultPassword() {
    try {
      await API.setAdultPassword('');
      this.publicConfig = { ...(this.publicConfig || {}), adult_password_set: false };
      this.toast('Password removed');
      this.renderSettings('security');
    } catch (err) { this.toast(err.message || 'Failed to remove the password', 'error'); }
  },

  async setPreviewFile(modelId, fileId) {
    try {
      await API.setPreviewFile(modelId, fileId);
      this.toast('Primary preview file updated');
      this.renderModelDetail(modelId);
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  switchModelDetailTab(tabName) {
    document.querySelectorAll('.model-detail-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.model-detail-tab-pane').forEach(pane => {
      pane.style.display = pane.id === `tab-pane-${tabName}` ? 'block' : 'none';
    });
  },

  setDefaultMaterial(val) {
    localStorage.setItem('gv_default_material', val);
    this.toast('Default print material updated');
  },

  toggleDescTab(tab) {
    const writeTab = document.getElementById('desc-tab-write');
    const prevTab = document.getElementById('desc-tab-preview');
    const input = document.getElementById('model-description-input');
    const preview = document.getElementById('model-description-preview');
    if (!writeTab || !prevTab || !input || !preview) return;

    if (tab === 'write') {
      writeTab.classList.add('active');
      prevTab.classList.remove('active');
      input.style.display = 'block';
      preview.style.display = 'none';
    } else {
      prevTab.classList.add('active');
      writeTab.classList.remove('active');
      input.style.display = 'none';
      preview.style.display = 'block';
      preview.innerHTML = UI.renderMarkdown(input.value) || '<div style="color:var(--text-muted);font-style:italic">No description entered yet.</div>';
    }
  },

  openBrowseFileModal(fileJsonEncoded) {
    let file;
    try {
      file = JSON.parse(decodeURIComponent(fileJsonEncoded));
    } catch (e) {
      console.error('Failed to parse file json', e);
      return;
    }

    const is3D = file.type === 'stl' || file.type === '3mf' || file.type === 'step';
    const isGcode = file.type === 'gcode';
    const meta = file.metadata || {};

    let metadataRows = '';
    const metaEntries = [];
    if (meta.printTime) metaEntries.push({ label: 'Est. Print Time', val: meta.printTime });
    if (meta.filamentType) metaEntries.push({ label: 'Filament', val: meta.filamentType });
    if (meta.tempNozzle) metaEntries.push({ label: 'Nozzle Temp', val: `${meta.tempNozzle}°C` });
    if (meta.tempBed) metaEntries.push({ label: 'Bed Temp', val: `${meta.tempBed}°C` });
    if (meta.layerHeight) metaEntries.push({ label: 'Layer Height', val: `${meta.layerHeight} mm` });
    if (meta.fillDensity) metaEntries.push({ label: 'Infill', val: meta.fillDensity });
    if (meta.slicer) metaEntries.push({ label: 'Slicer', val: meta.slicer });
    if (meta.printerModel) metaEntries.push({ label: 'Printer Model', val: meta.printerModel });
    if (meta.filamentWeight) metaEntries.push({ label: 'Filament Used', val: `${meta.filamentWeight}g` });

    if (metaEntries.length > 0) {
      metadataRows = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:8px;margin-bottom:16px">
          ${metaEntries.map(e => `
            <div style="background:var(--bg-input);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border)">
              <div style="color:var(--text-muted);font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em">${e.label}</div>
              <div style="font-weight:600;font-size:0.85rem;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.val}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let viewerArea = '';
    if (is3D || isGcode) {
      viewerArea = `
        <div id="browse-file-viewer-container" style="width:100%;height:320px;background:var(--bg-secondary);border-radius:var(--radius-md);overflow:hidden;position:relative;margin-bottom:16px;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Loading 3D Preview...</div>
        </div>
      `;
    } else if (file.type === 'image') {
      viewerArea = `
        <div style="width:100%;max-height:360px;display:flex;align-items:center;justify-content:center;background:var(--bg-secondary);border-radius:var(--radius-md);overflow:hidden;margin-bottom:16px;border:1px solid var(--border)">
          <img src="${file.url}" style="max-width:100%;max-height:360px;object-fit:contain" alt="${file.name}">
        </div>
      `;
    }

    const modalContent = `
      <div>
        ${viewerArea}
        ${metadataRows}
        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap">
          <div style="font-size:0.8rem;color:var(--text-muted);display:flex;align-items:center;gap:6px">
            <span>Size: <strong>${UI.formatSize(file.size)}</strong></span>
            ${file.folderPath ? `<span>·</span><span style="display:inline-flex;align-items:center;gap:3px;color:#f59e0b"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${file.folderPath}</span>` : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${(is3D || isGcode) ? `<button class="btn btn-secondary btn-sm" onclick="App.previewFileModal('${file.url}', '${file.name.replace(/'/g, "\\'")}', '${file.type}')">Full Screen</button>` : ''}
            ${file.id ? `<a href="/api/files/${file.id}/download" class="btn btn-primary btn-sm" download>Download</a>` : `<a href="${file.url}" class="btn btn-primary btn-sm" download="${file.name}">Download</a>`}
          </div>
        </div>
      </div>
    `;

    this.openModal(file.name, modalContent);

    if (is3D || isGcode) {
      setTimeout(() => {
        if (typeof Viewer !== 'undefined') {
          Viewer.create('browse-file-viewer-container', file.url, file.type);
        }
      }, 100);
    }
  },

  scanPollTimer: null,

  async handleScanLibrary() {
    return this.scanLibrary();
  },

  async scanLibrary() {
    const btn = document.getElementById('scan-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-icon rotating"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span> Starting...';
    }

    try {
      const csrfToken = localStorage.getItem('pv_csrf_token');
      const res = await fetch('/api/library/scan', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken }
      });
      const data = await res.json();
      if (res.ok || res.status === 409) {
        this.toast(res.status === 409 ? 'A scan is already in progress. Monitoring...' : 'Library scan started in background.');
        this.monitorScanProgress();
      } else {
        if (res.status === 401) this.toast('Please login as admin to scan', 'error');
        else this.toast('Scan start failed: ' + (data.error || 'Unknown error'), 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span class="btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span> Scan Library';
        }
      }
    } catch (e) {
      console.error(e);
      this.toast('Failed to reach server to start scan', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span> Scan Library';
      }
    }
  },

  monitorScanProgress() {
    if (this.scanPollTimer) return;

    const updateUI = (status) => {
      const btn = document.getElementById('scan-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-icon rotating"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span> ${status.foldersScanned || 0} folders (${status.filesAdded || 0} files)`;
      }
    };

    this.scanPollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/library/scan/status', { credentials: 'same-origin' });
        if (!res.ok) return;
        const status = await res.json();

        if (status.isScanning) {
          updateUI(status);
        } else {
          clearInterval(this.scanPollTimer);
          this.scanPollTimer = null;

          const btn = document.getElementById('scan-btn');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></span> Scan Library';
          }

          if (status.error) {
            this.toast('Scan stopped with error: ' + status.error, 'error');
          } else {
            const addedModels = status.lastResults?.modelsAdded || 0;
            const addedFiles = status.lastResults?.filesAdded || 0;
            this.toast(`✓ Scan completed! ${addedModels} models and ${addedFiles} files added (${status.elapsedSeconds || 0}s).`);
            this.fetchAndRenderModels();
          }
        }
      } catch (e) {
        console.warn('Could not poll scan status:', e);
      }
    }, 1500);
  },

  previewFileModal(url, name, fileType = null) {
    if (typeof Viewer === 'undefined') return;
    const modalHtml = `
      <div class="modal-overlay active" id="preview-file-overlay" style="z-index:9999;background:rgba(0,0,0,0.85)">
        <div class="modal" style="width:96vw;max-width:1400px;height:92vh;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">
          <div class="modal-header" style="padding:16px 24px">
            <h5 class="modal-title" style="margin:0">${name}</h5>
            <button type="button" class="modal-close" onclick="App.closePreviewFileModal(event)">✕</button>
          </div>
          <div class="modal-body" style="flex:1;padding:0;overflow:hidden;position:relative">
            <div id="full-preview-viewer" style="width:100%;height:100%">
              <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Loading 3D Viewer...</div>
            </div>
          </div>
        </div>
      </div>
    `;
    const container = document.createElement('div');
    container.id = 'preview-modal-container';
    container.innerHTML = modalHtml;
    document.body.appendChild(container);

    const overlay = container.querySelector('#preview-file-overlay');
    let overlayDown = false;
    if (overlay) {
      overlay.addEventListener('mousedown', (e) => {
        overlayDown = (e.target === overlay);
      });
      overlay.addEventListener('mouseup', (e) => {
        if (overlayDown && e.target === overlay) {
          this.closePreviewFileModal();
        }
        overlayDown = false;
      });
    }
    
    this.previewKeyHandler = (e) => { if (e.key === 'Escape') this.closePreviewFileModal(); };
    document.addEventListener('keydown', this.previewKeyHandler);
    
    const resolvedType = fileType || (name.toLowerCase().endsWith('.3mf') ? '3mf' : (name.toLowerCase().endsWith('.gcode') || name.toLowerCase().endsWith('.bgcode') ? 'gcode' : 'stl'));

    setTimeout(() => {
      Viewer.create('full-preview-viewer', url, resolvedType);
    }, 100);
  },

  closePreviewFileModal(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    const el = document.getElementById('preview-modal-container');
    if (el) el.remove();
    if (this.previewKeyHandler) {
      document.removeEventListener('keydown', this.previewKeyHandler);
      this.previewKeyHandler = null;
    }
  },

  // Show a file of the current model in the preview area (clicking a row in the file list):
  // 3D models and G-code in the 3D Studio, images / videos / PDFs / text in their own viewer
  previewFile(modelId, fileId, opts = {}) {
    const model = this.currentModel && this.currentModel.id === modelId ? this.currentModel : null;
    const trashed = model && (model.trash_files || []).find(f => f.id === fileId);
    const file = model && ((model.files || []).find(f => f.id === fileId) || trashed);
    const container = document.getElementById(`stl-viewer-${modelId}`);
    // The README lives in the description section: its row expands that section instead
    if (file && file === UI.readmeFile(model)) return this.toggleInfoExpand(modelId, true);
    const kind = file && UI.previewKind(file);
    if (!file || !kind || !container || typeof Viewer === 'undefined') return;
    const main = container.closest('.detail-main');
    if (main && main.classList.contains('is-info-expanded')) {
      main.classList.remove('is-info-expanded');
      this.updateInfoToggle();
    }

    const baseUrl = file.url || '/uploads/' + file.filename;
    Viewer.cleanup();
    container.dataset.previewToken = String(Date.now() + Math.random());
    this.setPreviewHint(container, file, kind, baseUrl);

    if (kind === '3d' || kind === 'gcode') {
      // A file in the Trash is shown on its own, outside the assembly of the model's parts;
      // opts.modelFiles: the parts the viewer offers (the configurator: only this file)
      const cadFiles = opts.modelFiles || (trashed ? [trashed] : (model.files || []).filter(f => UI.previewKind(f) === '3d'));
      const url = `${baseUrl}?t=${Date.now()}`;
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Loading...</div>';
      container.dataset.stlUrl = url;
      setTimeout(() => {
        Viewer.create(`stl-viewer-${modelId}`, url, file.file_type,
          kind === 'gcode' ? {} : { modelId, activeFileId: file.id, modelFiles: cadFiles });
      }, 50);
    } else {
      this.renderMediaPreview(container, file, kind, baseUrl);
    }
    this.highlightPreviewFile(file.id);

    // On narrow screens the viewer sits above the list: bring the preview back into view
    const r = container.getBoundingClientRect();
    if (!opts.initial && (r.top < 56 || r.bottom > window.innerHeight)) {
      (container.closest('.glass-panel') || container).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  // The preview area of a 3D file too large to load by itself: its name, size and a load button
  // (load: the button's onclick, by default the model page's preview)
  showLargePreviewPrompt(modelId, file, load) {
    const container = document.getElementById(`stl-viewer-${modelId}`);
    if (!container) return;
    const name = String(file.original_name || file.filename || '').split('/').pop();
    container.innerHTML = `
      <div class="large-preview">
        <div class="large-preview-name">${UI.escapeHtml(name)}</div>
        <div>${UI.formatSize(file.file_size)}: too large to load automatically.</div>
        <button class="btn btn-secondary btn-sm" onclick="${load || `App.previewFile(${Number(modelId)}, ${Number(file.id)})`}">Load 3D preview</button>
      </div>`;
    this.highlightPreviewFile(file.id);
  },

  // The strip under the preview: viewer hints for 3D, file name and open / download links otherwise
  setPreviewHint(container, file, kind, url) {
    const hint = container.closest('.detail-viewer-panel') && container.closest('.detail-viewer-panel').querySelector('.detail-viewer-hint');
    const title = container.closest('.detail-viewer-panel') && container.closest('.detail-viewer-panel').querySelector('.detail-viewer-title');
    if (title) title.textContent = (kind === '3d' || kind === 'gcode') ? '3D Studio' : 'Preview';
    if (!hint) return;
    if (hint.dataset.defaultHtml === undefined) hint.dataset.defaultHtml = hint.innerHTML;
    if (kind === '3d' || kind === 'gcode') {
      hint.classList.remove('is-media');
      hint.innerHTML = hint.dataset.defaultHtml;
      return;
    }
    const labels = { image: 'Image', video: 'Video', pdf: 'PDF', text: 'Text' };
    const tip = kind === 'image' ? '<span class="hint-tip">Scroll to zoom · drag to pan · double-click to reset</span>' : '';
    hint.classList.add('is-media');
    hint.innerHTML = `
      <span class="hint-file"><span class="badge badge-category">${labels[kind]}</span><span class="hint-name">${UI.escapeHtml(file.original_name || file.filename)}</span>${tip}</span>
      <span class="hint-actions">
        <a href="${UI.escapeHtml(url)}" target="_blank" rel="noopener">Open in new tab</a>
        <a href="/api/files/${file.id}/download">Download</a>
      </span>`;
  },

  renderMediaPreview(container, file, kind, url) {
    const token = container.dataset.previewToken;
    const name = file.original_name || file.filename || '';
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = `media-preview media-${kind}`;
    container.appendChild(wrap);
    const message = (text) => {
      wrap.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'media-message';
      el.textContent = text;
      wrap.appendChild(el);
    };

    if (kind === 'image') {
      const img = document.createElement('img');
      img.alt = name;
      img.draggable = false;
      img.onerror = () => message('This image could not be loaded.');
      img.src = url;
      wrap.appendChild(img);
      this.enableImageZoom(wrap, img);
    } else if (kind === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.onerror = () => message('The browser cannot play this video (unsupported format or codec). Use Download to watch it.');
      video.src = url;
      wrap.appendChild(video);
    } else if (kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.title = name;
      frame.src = url;
      wrap.appendChild(frame);
    } else if (kind === 'text') {
      const MAX_TEXT = 2 * 1024 * 1024;
      if (file.file_size > MAX_TEXT) return message('This file is too large to preview. Use Download to open it.');
      message('Loading...');
      fetch(url, { credentials: 'same-origin' })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(text => {
          if (container.dataset.previewToken !== token) return; // another file was opened meanwhile
          wrap.innerHTML = '';
          const box = document.createElement('div');
          box.className = 'media-text';
          if (/\.md$/i.test(name)) {
            box.innerHTML = UI.renderMarkdown(text); // escapes the source, links are protocol-checked
          } else {
            const pre = document.createElement('pre');
            pre.textContent = text;
            box.appendChild(pre);
          }
          wrap.appendChild(box);
        })
        .catch(() => { if (container.dataset.previewToken === token) message('This document could not be loaded.'); });
    }
  },

  // Wheel zoom around the cursor, drag to pan, double-click toggles 2.5x / fit
  enableImageZoom(wrap, img) {
    let scale = 1, x = 0, y = 0, drag = null;
    const apply = () => {
      if (scale <= 1) { scale = 1; x = 0; y = 0; }
      img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      wrap.classList.toggle('is-zoomed', scale > 1);
    };
    const zoomAt = (clientX, clientY, next) => {
      const r = wrap.getBoundingClientRect();
      const cx = clientX - r.left - r.width / 2, cy = clientY - r.top - r.height / 2;
      next = Math.min(10, Math.max(1, next));
      x = cx - (cx - x) * next / scale;
      y = cy - (cy - y) * next / scale;
      scale = next;
      apply();
    };
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    }, { passive: false });
    wrap.addEventListener('dblclick', (e) => {
      if (scale > 1) { scale = 1; apply(); } else zoomAt(e.clientX, e.clientY, 2.5);
    });
    wrap.addEventListener('pointerdown', (e) => {
      if (scale <= 1 || e.button !== 0) return;
      drag = { sx: e.clientX - x, sy: e.clientY - y };
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('is-dragging');
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag) return;
      x = e.clientX - drag.sx;
      y = e.clientY - drag.sy;
      apply();
    });
    const end = () => { drag = null; wrap.classList.remove('is-dragging'); };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  },

  // README of the project folder: fetched once and rendered in the description section
  loadReadme(model) {
    const readme = UI.readmeFile(model);
    const box = readme && document.querySelector(`.detail-readme[data-readme-id="${readme.id}"] .detail-readme-body`);
    const info = document.querySelector('.detail-info');
    if (info && typeof ResizeObserver !== 'undefined') {
      if (this.infoResizeObserver) this.infoResizeObserver.disconnect();
      this.infoResizeObserver = new ResizeObserver(() => this.updateInfoToggle());
      this.infoResizeObserver.observe(info);
    }
    this.updateInfoToggle();
    if (!box) return;
    const name = readme.original_name || '';
    if (readme.file_size > 1024 * 1024) { box.textContent = 'README is too large to show here. Use Download to open it.'; return; }
    fetch(readme.url || '/uploads/' + readme.filename, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(text => {
        if (/\.(md|markdown)$/i.test(name) || !/\.txt$/i.test(name)) {
          box.innerHTML = UI.renderMarkdown(text); // escapes the source, links are protocol-checked
        } else {
          box.innerHTML = '';
          const pre = document.createElement('pre');
          pre.textContent = text;
          box.appendChild(pre);
        }
        this.updateInfoToggle();
      })
      .catch(() => { box.textContent = 'README could not be loaded.'; this.updateInfoToggle(); });
  },

  // "Expand" when the description section is cut off, "Collapse" while it is expanded
  updateInfoToggle() {
    const panel = document.querySelector('.detail-info-panel');
    if (!panel) return;
    const btn = panel.querySelector('.detail-info-toggle');
    const info = panel.querySelector('.detail-info');
    const expanded = panel.closest('.detail-main').classList.contains('is-info-expanded');
    const cutOff = info.scrollHeight > info.clientHeight + 2;
    btn.hidden = !expanded && !cutOff;
    btn.innerHTML = expanded
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>Collapse'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>Expand';
  },

  // Expanded, the description section takes the whole column and the 3D preview is switched off;
  // collapsing brings back the file that was on screen
  toggleInfoExpand(modelId, force) {
    const model = this.currentModel && this.currentModel.id === modelId ? this.currentModel : null;
    const panel = document.querySelector('.detail-info-panel');
    const main = panel && panel.closest('.detail-main');
    if (!model || !main) return;
    const expand = force === undefined ? !main.classList.contains('is-info-expanded') : force;
    if (expand === main.classList.contains('is-info-expanded')) {
      if (expand) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const container = document.getElementById(`stl-viewer-${modelId}`);
    if (expand) {
      this.fileBeforeExpand = this.previewedFileId;
      if (typeof Viewer !== 'undefined') Viewer.cleanup();
      if (container) { container.dataset.previewToken = ''; container.innerHTML = ''; }
      main.classList.add('is-info-expanded');
      const readme = UI.readmeFile(model);
      this.highlightPreviewFile(readme ? readme.id : null);
      this.updateInfoToggle();
      const r = panel.getBoundingClientRect();
      if (r.top < 56 || r.top > window.innerHeight * 0.6) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      main.classList.remove('is-info-expanded');
      this.updateInfoToggle();
      const back = this.fileBeforeExpand || (UI.defaultPreviewFile(model) || {}).id;
      if (back && container) this.previewFile(modelId, back, { initial: true });
      else this.highlightPreviewFile(null);
    }
  },

  // Mark the rows of the file that is on screen (Files and Documentation tabs), open the folders
  // around them and keep the visible one in view inside its scrolling list (without moving the page)
  highlightPreviewFile(fileId) {
    document.querySelectorAll('.file-item-card.is-active').forEach(el => el.classList.remove('is-active'));
    this.previewedFileId = fileId === null || fileId === undefined ? null : Number(fileId);
    if (fileId === null || fileId === undefined) return;
    const rows = document.querySelectorAll(`.file-item-card[data-file-id="${Number(fileId)}"]`);
    rows.forEach(row => {
      row.classList.add('is-active');
      for (let d = row.parentElement && row.parentElement.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
        d.open = true;
      }
    });
    const row = [...rows].find(r => r.offsetParent !== null);
    const list = row && row.closest('.detail-files-body');
    if (list) {
      const lr = list.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      if (rr.top < lr.top || rr.bottom > lr.bottom) list.scrollTop += rr.top - lr.top - lr.height / 3;
    }
  },

  showPrintHistory(modelId) {
    const model = this.currentModel && this.currentModel.id === modelId ? this.currentModel : null;
    if (!model) return;
    this.openModal(`Print History · ${model.name}`, UI.printHistoryModal(model));
  },

  previewStl(modelId, url, fileType = null) {
    if (typeof Viewer === 'undefined') return;
    Viewer.cleanup();
    const container = document.getElementById(`stl-viewer-${modelId}`);
    if (container) {
      if (container.nextElementSibling) {
        container.nextElementSibling.style.visibility = 'visible';
      }
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Loading...</div>';
      container.dataset.stlUrl = url;
      setTimeout(() => {
        Viewer.create(`stl-viewer-${modelId}`, url, fileType);
      }, 50);
    }
  },

  async renderSettings(initialTab = 'categories') {
    const isAdmin = this.currentUser?.role === 'admin';

    this.el.innerHTML = `
      <div class="page-header" style="margin-bottom:20px">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure and personalize your GyroidVault 2.0 instance</p>
        </div>
      </div>

      <div class="settings-layout">
        <!-- Modern Left Navigation Sub-Sidebar -->
        <aside class="settings-nav-sidebar">
          <div class="settings-nav-group">
            <div class="settings-nav-group-title">Taxonomies</div>
            <button class="settings-nav-btn active" data-tab="categories">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>Categories</span>
            </button>
            <button class="settings-nav-btn" data-tab="tags">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <span>Tags</span>
            </button>
            <button class="settings-nav-btn" data-tab="materials">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <span>Materials</span>
            </button>
          </div>

          ${isAdmin ? `
            <div class="settings-nav-group">
              <div class="settings-nav-group-title">Hardware</div>
              <button class="settings-nav-btn" data-tab="printers">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                <span>3D Printers</span>
              </button>
              <button class="settings-nav-btn" data-tab="smtp">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span>SMTP & Mail</span>
              </button>
            </div>

            <div class="settings-nav-group">
              <div class="settings-nav-group-title">Administration</div>
              <button class="settings-nav-btn" data-tab="security">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Security</span>
              </button>
              <button class="settings-nav-btn" data-tab="users">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>Users & Roles</span>
              </button>
              <button class="settings-nav-btn" data-tab="system">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>System</span>
              </button>
              <button class="settings-nav-btn" data-tab="maintenance">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span>Maintenance & Logs</span>
              </button>
            </div>
          ` : ''}

          <div class="settings-nav-group">
            <div class="settings-nav-group-title">System Info</div>
            <button class="settings-nav-btn" data-tab="about">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span>About GyroidVault</span>
            </button>
          </div>
        </aside>

        <!-- Right Content Area -->
        <main id="settings-content" style="min-width:0"></main>
      </div>`;

    const content = this.el.querySelector('#settings-content');
    const navBtns = this.el.querySelectorAll('.settings-nav-btn');

    const switchTab = async (tab) => {
      navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      content.innerHTML = '<div class="skeleton" style="height:320px;width:100%;border-radius:10px"></div>';

      try {
        if (tab === 'categories') {
          const cats = await API.getCategories();
          content.innerHTML = `<div class="settings-grid">${UI.settingsPanel('Categories', cats, 'categories')}</div>`;
        } else if (tab === 'tags') {
          const tags = await API.getTags();
          content.innerHTML = `<div class="settings-grid">${UI.settingsPanel('Tags', tags, 'tags')}</div>`;
        } else if (tab === 'materials') {
          const mats = await API.getMaterials();
          content.innerHTML = `<div class="settings-grid">${UI.settingsPanel('Materials', mats, 'materials')}</div>`;
        } else if (tab === 'printers') {
          const config = await API.getSystemSettings();
          let printers = [];
          try { if (config.printers) printers = JSON.parse(config.printers); } catch(e){}
          content.innerHTML = `
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>3D Printers (Moonraker)</div></div>
              <div class="panel-body">${UI.printersSettingsForm(printers)}</div>
            </div>`;
        } else if (tab === 'security') {
          const config = await API.getSystemSettings();
          content.innerHTML = `
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Security & Access Control</div></div>
              <div class="panel-body">${UI.securitySettingsForm(config)}</div>
            </div>`;
          setTimeout(() => { App.loadBlockedIps(); UI.maskFallback(content); }, 50);
        } else if (tab === 'maintenance') {
          const logs = await API.getSystemLogs();
          content.innerHTML = `
            <div class="glass-panel" style="margin-bottom:24px">
              <div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Maintenance & Duplicates</div></div>
              <div class="panel-body">${UI.maintenanceSettingsForm()}</div>
            </div>
            <div class="glass-panel">
              <div class="panel-header">
                <div class="panel-title">System Event Logs</div>
                <button class="btn btn-ghost btn-xs" onclick="App.handleClearLogs()" style="color:var(--error)">Clear Logs</button>
              </div>
              <div class="panel-body no-pad">
                <div id="system-logs-list" style="max-height:400px;overflow-y:auto;font-family:monospace;font-size:.75rem">
                  ${logs.length ? logs.map(l => `
                    <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;${l.level === 'warning' ? 'background:rgba(245,158,11,0.05);' : ''}">
                      <span style="color:var(--text-muted);white-space:nowrap">${new Date(l.created_at).toLocaleString()}</span>
                      <span style="color:var(--accent-${l.level === 'warning' ? 'pink' : 'cyan'});font-weight:700;width:60px">[${l.level.toUpperCase()}]</span>
                      <span style="color:var(--text-secondary)">${l.message}</span>
                    </div>
                  `).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted)">No logs available</div>'}
                </div>
              </div>
            </div>`;
        } else if (tab === 'smtp') {
          const config = await API.getSMTPSettings();
          content.innerHTML = `
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title">SMTP Mail Configuration</div></div>
              <div class="panel-body">${UI.smtpSettingsForm(config)}</div>
            </div>`;
        } else if (tab === 'system') {
          const config = await API.getSystemSettings();
          content.innerHTML = `
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title">System Settings</div></div>
              <div class="panel-body">${UI.systemSettingsForm(config)}</div>
            </div>`;
        } else if (tab === 'users') {
          const users = await API.getUsers();
          content.innerHTML = `
            <div class="glass-panel" style="margin-bottom:20px">
              <div class="panel-header"><div class="panel-title">Invite User</div></div>
              <div class="panel-body">
                <form onsubmit="App.handleInviteUser(event)" style="display:flex;gap:10px;flex-wrap:wrap">
                  <input type="email" name="email" required placeholder="Email address to invite" class="form-input" style="max-width:320px">
                  <button type="submit" class="btn btn-primary">Send Invite</button>
                </form>
              </div>
            </div>
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title">User Accounts & Roles</div></div>
              <div class="panel-body no-pad" style="overflow-x:auto">
                <table class="settings-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th style="text-align:right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>${users.map(u => `
                    <tr>
                      <td>#${u.id}</td>
                      <td style="font-weight:600;color:var(--text-primary)">${u.username}</td>
                      <td>${u.email || '-'}</td>
                      <td>
                        <select class="form-input" style="padding:4px 8px;font-size:.85rem;width:auto;display:inline-block" onchange="App.changeUserRole(${u.id}, this)" ${u.id === 1 ? 'disabled' : ''}>
                          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                          <option value="uploader" ${u.role === 'uploader' ? 'selected' : ''}>Uploader</option>
                          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                        </select>
                        ${u.id === 1 ? '<span style="font-size:0.7rem;color:var(--accent-cyan);margin-left:6px;font-weight:600">Master Admin</span>' : ''}
                      </td>
                      <td style="text-align:right">
                        ${u.id !== 1 ? `<button class="btn btn-danger btn-xs" onclick="App.deleteUser(${u.id})" style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>` : ''}
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>`;
        } else if (tab === 'about') {
          content.innerHTML = UI.aboutSection({ currentVersion: '2.0.2' });
        }
      } catch (e) { console.error(e); }
    };

    navBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    switchTab(initialTab);
  },

  // ─── Actions ──────────────────────────────────────────────────────────
  async showCreateModel() {
    await this.loadCache();
    this.pendingFiles = [];
    let formHtml = UI.modelForm(null, this.cache.categories, this.cache.tags);
    
    if (this.libraryViewMode === 'folder' && this.currentBrowsePath) {
      const folderOptionsHtml = `
        <div class="form-group">
          <input type="hidden" name="parent_folder" value="${this.currentBrowsePath}">
          <label><input type="checkbox" name="create_subfolder" value="true" checked> Create subfolder for this model</label>
        </div>
      `;
      // Inject before form-actions
      formHtml = formHtml.replace('<div class="form-actions">', folderOptionsHtml + '<div class="form-actions">');
    }
    
    this.openModal('New Model', formHtml);
    setTimeout(() => document.getElementById('model-name-input')?.focus(), 100);
  },



  handleCreateFileSelect(e) {
    const files = Array.from(e.target.files);
    this.addPendingFiles(files);
  },

  handleCreateFileDrop(e) {
    const files = Array.from(e.dataTransfer.files);
    this.addPendingFiles(files);
  },

  switchFilesTab(e, tab) {
    const container = e.target.closest('.glass-panel');
    const tabEl = e.currentTarget || e.target.closest('div[onclick]');
    this.showFilesTab(container, tab, tabEl);
  },

  // Files / Documentation / Trash tabs of the model page
  showFilesTab(container, tab, tabEl) {
    if (!container) return;
    const tabs = container.querySelectorAll('.panel-header div[onclick]');
    tabs.forEach(t => {
      t.style.borderBottomColor = 'transparent';
      t.style.color = 'var(--text-muted)';
    });
    if (tabEl) {
      tabEl.style.borderBottomColor = 'var(--accent-cyan)';
      tabEl.style.color = 'var(--text)';
    }
    let shown = null;
    for (const name of ['files', 'docs', 'trash']) {
      const content = container.querySelector(`#tab-content-${name}`);
      if (!content) continue;
      content.style.display = name === tab ? 'block' : 'none';
      if (name === tab) shown = content;
    }
    this.fitFileTree(shown);
  },

  selectFilesTab(tab) {
    const content = document.getElementById(`tab-content-${tab}`);
    const container = content && content.closest('.glass-panel');
    if (!container) return;
    const tabEl = [...container.querySelectorAll('.panel-header div[onclick]')].find(t => t.getAttribute('onclick').includes(`'${tab}'`));
    this.showFilesTab(container, tab, tabEl);
  },

  // ── Files and folders of a project (rename / move / new folder / delete, on disk) ──
  entryFrom(el) {
    const row = el && el.closest('[data-entry-path]');
    if (!row) return null;
    return {
      path: row.dataset.entryPath,
      kind: row.dataset.entryKind,
      onDisk: row.dataset.entryKind === 'folder' || row.dataset.entryDisk === '1',
      fileId: row.dataset.fileId ? Number(row.dataset.fileId) : null
    };
  },

  reloadModel() {
    if (this.currentModel) this.renderModelDetail(this.currentModel.id, this.currentModelOpts || {});
  },

  renameEntry(el) {
    const entry = this.entryFrom(el);
    if (!entry || !this.currentModel) return;
    this.pendingEntry = { ...entry, op: 'rename' };
    const name = entry.path.split('/').pop();
    this.openModal(entry.kind === 'folder' ? 'Rename Folder' : 'Rename File', UI.entryNameForm({
      label: entry.kind === 'folder' ? 'Folder name' : 'File name',
      value: name,
      submitLabel: 'Rename',
      hint: 'The file or folder is renamed in the library on disk too.'
    }));
    setTimeout(() => {
      const input = document.getElementById('entry-name-input');
      if (!input) return;
      input.focus();
      // Select the name without its extension
      const dot = entry.kind === 'file' ? name.lastIndexOf('.') : -1;
      input.setSelectionRange(0, dot > 0 ? dot : name.length);
    }, 60);
  },

  // el: a folder row (new folder inside it) or null (in the project folder)
  newFolder(el) {
    if (!this.currentModel) return;
    const parent = el ? (this.entryFrom(el) || {}).path || '' : '';
    this.pendingEntry = { op: 'mkdir', path: parent };
    this.openModal('New Folder', UI.entryNameForm({
      label: 'Folder name',
      submitLabel: 'Create',
      hint: parent ? `Inside "${UI.escapeHtml(parent)}"` : 'In the project folder'
    }));
    setTimeout(() => document.getElementById('entry-name-input')?.focus(), 60);
  },

  async handleEntryNameSubmit(e) {
    e.preventDefault();
    const entry = this.pendingEntry;
    const model = this.currentModel;
    if (!entry || !model) return;
    const name = String(new FormData(e.target).get('name') || '').trim();
    try {
      if (entry.op === 'mkdir') {
        await API.createProjectFolder(model.id, entry.path, name);
        this.toast('Folder created');
      } else {
        await API.renameProjectEntry(model.id, entry.path, name);
        this.toast('Renamed');
      }
      this.pendingEntry = null;
      this.closeModal();
      this.reloadModel();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  moveEntry(el) {
    const entry = this.entryFrom(el);
    const model = this.currentModel;
    if (!entry || !model) return;
    this.pendingEntry = { ...entry, op: 'move' };
    // A folder cannot go into itself or one of its subfolders
    const folders = ['', ...(model.folders || [])]
      .filter(f => entry.kind !== 'folder' || (f !== entry.path && !f.startsWith(entry.path + '/')));
    const current = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    this.openModal('Move', UI.entryMoveForm(entry.path.split('/').pop(), folders, current));
  },

  async handleEntryMoveSubmit(e) {
    e.preventDefault();
    const entry = this.pendingEntry;
    const model = this.currentModel;
    if (!entry || !model) return;
    const target = String(new FormData(e.target).get('target') ?? '');
    try {
      await API.moveProjectEntries(model.id, [entry.path], target);
      this.toast('Moved');
      this.pendingEntry = null;
      this.closeModal();
      this.reloadModel();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  deleteEntry(el) {
    const entry = this.entryFrom(el);
    if (!entry || !this.currentModel) return;
    this.pendingEntry = { ...entry, op: 'delete' };
    this.openModal(entry.kind === 'folder' ? 'Delete Folder' : 'Delete File', UI.deleteEntryForm(entry.path.split('/').pop() || entry.path, entry.kind === 'folder'));
  },

  async handleEntryDeleteSubmit(e) {
    e.preventDefault();
    const entry = this.pendingEntry;
    const model = this.currentModel;
    if (!entry || !model) return;
    try {
      // Uploads outside the library and entries inside archives have no path on disk
      if (entry.kind === 'file' && !entry.onDisk && entry.fileId) await API.deleteFile(entry.fileId);
      else await API.deleteProjectEntries(model.id, [entry.path]);
      this.toast('Moved to the Trash');
      this.pendingEntry = null;
      this.closeModal();
      this.reloadModel();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Trash ──
  async renderTrash() {
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      this.el.innerHTML = '<div class="empty-state"><div class="empty-state-text">Log in to see the Trash</div></div>';
      return;
    }
    this.el.innerHTML = '<div style="padding:40px"><div class="skeleton" style="width:200px;height:30px;margin-bottom:20px"></div><div class="skeleton" style="width:100%;height:200px"></div></div>';
    try {
      const data = await API.getTrash();
      this.trashRetentionDays = data.retention_days;
      this.el.innerHTML = UI.trashPage(data);
    } catch (e) {
      this.el.innerHTML = `<div class="empty-state"><div class="empty-state-text">${UI.escapeHtml(e.message || 'Failed to load the Trash')}</div></div>`;
    }
  },

  // After a Trash action: refresh the page it was done on
  refreshAfterTrash(modelIds) {
    const onModel = this.currentModel && location.hash.startsWith(`#/models/${this.currentModel.id}`);
    if (!onModel) return this.renderTrash();
    if (modelIds.includes(this.currentModel.id)) return null;
    return this.reloadModel();
  },

  async restoreTrashItems(modelIds, fileIds) {
    try {
      await API.restoreFromTrash(modelIds, fileIds);
      this.toast(modelIds.length ? 'Model restored' : `${fileIds.length} file${fileIds.length === 1 ? '' : 's'} restored`);
      const onThisModel = this.currentModel && modelIds.includes(this.currentModel.id) && location.hash.startsWith(`#/models/${this.currentModel.id}`);
      if (onThisModel) this.navigate(`/models/${this.currentModel.id}`);
      else this.refreshAfterTrash(modelIds);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async purgeTrashItems(modelIds, fileIds) {
    const what = modelIds.length ? 'this model and all its files' : (fileIds.length === 1 ? 'this file' : `${fileIds.length} files`);
    if (!confirm(`Delete ${what} from disk for good? This cannot be undone.`)) return;
    try {
      await API.purgeFromTrash(modelIds, fileIds);
      this.toast('Deleted permanently');
      const onThisModel = this.currentModel && modelIds.includes(this.currentModel.id) && location.hash.startsWith(`#/models/${this.currentModel.id}`);
      if (onThisModel) this.navigate('/trash');
      else this.refreshAfterTrash(modelIds);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async confirmEmptyTrash() {
    if (!confirm('Delete everything in the Trash from disk for good? This cannot be undone.')) return;
    try {
      await API.emptyTrash();
      this.toast('Trash emptied');
      this.renderTrash();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  openModelTrashTab() {
    this.pendingFilesTab = 'trash';
  },

  // ── Regenerate covers (Settings > Maintenance): rendered in this tab, one model at a time ──
  async regenerateCovers() {
    if (this.coversRun) {
      this.coversRun.cancel = true; // the button reads "Stop" while it runs
      return;
    }
    if (typeof Viewer === 'undefined' || !Viewer.renderCover) return;
    const el = (id) => document.getElementById(id);
    let list;
    try {
      list = await API.getPendingCovers();
    } catch (e) {
      return this.toast(e.message, 'error');
    }
    const models = list.models || [];
    const skippedNote = list.skipped_protected ? ` ${list.skipped_protected} password-protected models were skipped.` : '';
    if (!models.length) {
      if (el('regenerate-covers-status')) el('regenerate-covers-status').textContent = `No covers to render.${skippedNote}`;
      return;
    }

    const run = this.coversRun = { cancel: false };
    if (el('regenerate-covers-btn')) el('regenerate-covers-btn').textContent = 'Stop';
    let done = 0;
    let failed = 0;
    for (const m of models) {
      if (run.cancel) break;
      const status = el('regenerate-covers-status');
      if (status) {
        const pct = Math.round(((done + failed) / models.length) * 100);
        status.innerHTML = `<div class="covers-progress"><div style="width:${pct}%"></div></div>
          <div>${done + failed} / ${models.length} · ${UI.escapeHtml(m.name)}</div>`;
      }
      try {
        const blob = await Viewer.renderCover(m.url, m.file_type);
        if (!blob) throw new Error('Nothing rendered');
        await API.uploadThumbnail(m.id, new File([blob], `cover_${m.id}.png`, { type: 'image/png' }));
        done++;
      } catch (e) {
        failed++;
        console.warn('[Covers] Could not render', m.name, e);
      }
    }
    this.coversRun = null;
    if (el('regenerate-covers-btn')) el('regenerate-covers-btn').textContent = 'Regenerate Covers';
    if (el('regenerate-covers-status')) {
      el('regenerate-covers-status').textContent = `${run.cancel ? 'Stopped' : 'Done'}: ${done} covers rendered${failed ? `, ${failed} failed (see the browser console)` : ''}.${skippedNote}`;
    }
  },

  // ── File history (.versions) ──
  async showFileHistory(el) {
    const entry = this.entryFrom(el);
    const model = this.currentModel;
    const file = entry && model && (model.files || []).find(f => f.id === entry.fileId);
    if (!file) return;
    try {
      this.historyFile = file;
      this.historyVersions = await API.getFileVersions(file.id);
      const canEdit = !model.deleted_at && (this.currentUser?.role === 'admin' || (this.currentUser?.role !== 'viewer' && model.user_id === this.currentUser?.id));
      this.openModal(`History of ${file.original_name.split('/').pop()}`, UI.fileHistoryModal(file, this.historyVersions, canEdit));
    } catch (err) { this.toast(err.message, 'error'); }
  },

  previewFileVersion(versionId) {
    const v = (this.historyVersions || []).find(x => x.id === versionId);
    const file = this.historyFile;
    if (!v || !file) return;
    this.previewFileModal(v.url, UI.escapeHtml(`${file.original_name} · ${UI.sqlDate(v.created_at).toLocaleString()}`), file.file_type);
  },

  async restoreFileVersion(versionId) {
    const file = this.historyFile;
    if (!file) return;
    try {
      await API.restoreFileVersion(file.id, versionId);
      this.toast('Version restored');
      this.closeModal();
      this.reloadModel();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteFileVersion(versionId) {
    const file = this.historyFile;
    if (!file || !confirm('Delete this version from disk for good?')) return;
    try {
      await API.deleteFileVersion(file.id, versionId);
      this.toast('Version deleted');
      this.closeModal();
      this.reloadModel();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Slicer saves (.slicer-saves) ──
  async renderSlicerSaves() {
    if (typeof Viewer !== 'undefined') Viewer.cleanup();
    if (!this.currentUser || this.currentUser.role !== 'admin') {
      this.el.innerHTML = '<div class="empty-state"><div class="empty-state-text">Admin access required</div></div>';
      return;
    }
    try {
      const data = await API.getSlicerSaves();
      this.slicerSaves = data.saves || [];
      this.el.innerHTML = UI.slicerSavesPage(data);
    } catch (e) {
      this.el.innerHTML = `<div class="empty-state"><div class="empty-state-text">${UI.escapeHtml(e.message || 'Failed to load slicer saves')}</div></div>`;
    }
  },

  async checkSlicerSaves() {
    try {
      await API.checkSlicerSaves();
      this.renderSlicerSaves();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async cleanupSlicerSaves() {
    try {
      const r = await API.cleanupSlicerSaves();
      this.toast(r.removed ? `${r.removed} file${r.removed === 1 ? '' : 's'} deleted from .slicer-saves` : 'Nothing to clean up');
      this.renderSlicerSaves();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async importSlicerSave(id) {
    try {
      await API.importSlicerSave(id);
      this.toast('Imported');
      this.renderSlicerSaves();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteSlicerSave(id) {
    if (!confirm('Delete this file from .slicer-saves? A slicer that still has it open can save it again.')) return;
    try {
      await API.deleteSlicerSave(id);
      this.renderSlicerSaves();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  previewSlicerSave(id) {
    const s = (this.slicerSaves || []).find(x => x.id === id);
    if (s) this.previewFileModal(s.url, UI.escapeHtml(s.name), (s.name.match(/\.([^.]+)$/) || [])[1].toLowerCase());
  },

  showAssignSlicerSave(id) {
    const s = (this.slicerSaves || []).find(x => x.id === id);
    if (!s) return;
    this.assignSave = s;
    this.openModal('Assign Slicer Save', UI.slicerAssignForm(s));
    setTimeout(() => document.getElementById('assign-model-search')?.focus(), 60);
  },

  async searchAssignModels() {
    const q = document.getElementById('assign-model-search')?.value.trim() || '';
    const box = document.getElementById('assign-model-results');
    if (!box) return;
    try {
      const { models } = await API.getModels({ search: q, limit: 20, sort: 'name' });
      document.getElementById('assign-model-files').innerHTML = '';
      box.innerHTML = models.length
        ? models.map(m => `<button type="button" class="slicer-assign-model" onclick="App.pickAssignModel(${m.id})">${UI.escapeHtml(m.name)}</button>`).join('')
        : '<div class="slicer-assign-or">No models found</div>';
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async pickAssignModel(modelId) {
    const box = document.getElementById('assign-model-files');
    if (!box) return;
    try {
      const model = await API.getModel(modelId);
      const files = (model.files || []).filter(f => f.library_path && !f.is_archive_entry && !String(f.library_path).includes('::'));
      document.querySelectorAll('.slicer-assign-model').forEach(b => b.classList.toggle('is-active', b.getAttribute('onclick').includes(`(${modelId})`)));
      box.innerHTML = `
        <div class="slicer-assign-or">In <strong>${UI.escapeHtml(model.name)}</strong>:</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="App.assignSlicerSave({ model_id: ${model.id} })">Add as a new file</button>
        ${files.length ? `<div class="slicer-assign-or">or as a new version of</div>
        <div class="slicer-assign-results">${files.map(f => `<button type="button" class="slicer-assign-model" onclick="App.assignSlicerSave({ file_id: ${f.id} })">${UI.escapeHtml(f.original_name)}</button>`).join('')}</div>` : ''}`;
    } catch (err) {
      this.toast(err.status === 423 ? 'This model is password protected' : err.message, 'error');
    }
  },

  async assignSlicerSave(target) {
    if (!this.assignSave) return;
    try {
      const r = await API.assignSlicerSave(this.assignSave.id, target);
      this.toast(r.message || 'Done');
      this.assignSave = null;
      this.closeModal();
      this.renderSlicerSaves();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // A file tree is rendered fully open. If it does not fit the list without scrolling, collapse
  // every folder. Done once per tab, the first time it is visible, so manual toggles stay.
  fitFileTree(content) {
    if (!content || content.dataset.fitted || content.offsetParent === null) return;
    const list = content.closest('.detail-files-body');
    if (!list || !list.clientHeight) return;
    content.dataset.fitted = '1';
    if (list.scrollHeight > list.clientHeight + 1) {
      content.querySelectorAll('details.file-folder[open]').forEach(d => { d.open = false; });
    }
  },

  addPendingFiles(files) {
    const MAX_SIZE = 500 * 1024 * 1024; // 500MB
    const validFiles = [];
    for (const f of files) {
      if (f.size > MAX_SIZE) {
        this.toast(`File "${f.name}" exceeds the 500MB size limit.`, 'error');
      } else {
        validFiles.push(f);
      }
    }
    if (validFiles.length) {
      this.pendingFiles.push(...validFiles);
      this.renderPendingFiles();
    }
  },

  removePendingFile(index) {
    this.pendingFiles.splice(index, 1);
    this.renderPendingFiles();
  },

  renderPendingFiles() {
    const list = document.getElementById('create-file-list');
    if (!list) return;
    if (!this.pendingFiles.length) { list.style.display = 'none'; return; }
    list.style.display = 'block';
    list.innerHTML = this.pendingFiles.map((f, i) =>
      `<div class="upload-file-item">
        <span class="badge badge-${f.name.split('.').pop().toLowerCase()}">${f.name.split('.').pop().toUpperCase()}</span>
        <span>${f.name}</span>
        <span style="color:var(--text-muted);font-size:.7rem">${UI.formatSize(f.size)}</span>
        <button class="remove-file" onclick="event.preventDefault();App.removePendingFile(${i})">×</button>
      </div>`
    ).join('');
  },

  addInlineTag() {
    const input = document.getElementById('new-tag-input');
    const container = document.getElementById('model-tags-container');
    if (!input || !container) return;
    const val = input.value.trim();
    if (!val) return;
    
    const label = document.createElement('label');
    label.className = 'tag-pill-checkbox';
    // Use a prefix to identify it as a new tag string rather than an ID
    label.innerHTML = `
      <input type="checkbox" name="tags" value="NEW:${val}" checked> 
      <span class="tag-pill new">${val}</span>`;
    container.appendChild(label);
    input.value = '';
    input.focus();
  },

  addCustomMetaField() {
    const container = document.getElementById('custom-meta-container');
    if (!container) return;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; gap:8px; margin-bottom:8px;';
    div.className = 'custom-meta-row';
    div.innerHTML = `
      <input type="text" class="form-input" name="meta_keys[]" placeholder="Key (e.g. Designer)" style="flex:1" required>
      <input type="text" class="form-input" name="meta_values[]" placeholder="Value" style="flex:2" required>
      <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(div);
  },

  async showEditModel(id) {
    try {
      const [model] = await Promise.all([API.getModel(id), this.loadCache()]);
      this.openModal('Edit Model', UI.modelForm(model, this.cache.categories, this.cache.tags));
    } catch (e) { this.toast('Failed to load model', 'error'); }
  },

  async handleModelSubmit(e, id) {
    e.preventDefault();
    const form = new FormData(e.target);
    const tags = Array.from(e.target.querySelectorAll('input[name="tags"]:checked')).map(c => {
      if (c.value.startsWith('NEW:')) return c.value.substring(4);
      return parseInt(c.value);
    });
    
    const metaKeys = form.getAll('meta_keys[]');
    const metaValues = form.getAll('meta_values[]');
    const customMeta = {};
    for (let i = 0; i < metaKeys.length; i++) {
      if (metaKeys[i].trim()) customMeta[metaKeys[i].trim()] = metaValues[i].trim();
    }
    
    const data = {
      name: form.get('name'),
      description: form.get('description'),
      print_tips: form.get('print_tips'),
      source_url: form.get('source_url'),
      category_id: form.get('category_id') || null,
      custom_meta: customMeta,
      tags,
    };
    if (id && e.target.querySelector('[name="is_adult"]')) data.is_adult = form.has('is_adult');
    
    if (form.has('parent_folder')) {
      data.parent_folder = form.get('parent_folder');
    }
    if (form.has('create_subfolder')) {
      data.create_subfolder = form.get('create_subfolder') === 'true';
    }

    try {
      if (id) {
        await API.updateModel(id, data);
        this.toast('Model updated');
        this.closeModal();
        this.renderModelDetail(id);
      } else {
        const model = await API.createModel(data);
        // Upload pending files if any
        if (this.pendingFiles.length > 0) {
          const submitBtn = document.getElementById('model-submit-btn');
          if (submitBtn) { submitBtn.disabled = true; submitBtn.innerText = 'Uploading files...'; }
          const progress = document.getElementById('create-upload-progress');
          try {
            const uploadOpts = {
              parent_folder: data.parent_folder,
              create_subfolder: data.create_subfolder
            };
            await API.uploadFiles(model.id, this.pendingFiles, uploadOpts, (p) => {
              if (progress) progress.innerHTML = UI.uploadProgressBox(p);
            });
            this.toast(`Model created with ${this.pendingFiles.length} file(s)`);
          } catch (ue) {
            this.toast('Model created but file upload failed: ' + ue.message, 'error');
          }
          this.pendingFiles = [];
        } else {
          this.toast('Model created');
        }
        this.closeModal();
        this.navigate(`/models/${model.id}`);
      }
    } catch (e) {
      if (e.suggested_names?.length || e.suggested_name || (e.message && e.message.includes('already exists'))) {
        const banner = document.getElementById('duplicate-warning-banner');
        const warnText = document.getElementById('duplicate-warning-text');
        const container = document.getElementById('duplicate-suggestions-container');
        if (banner) {
          banner.style.display = 'block';
          if (warnText) warnText.textContent = e.message || 'A model with this name already exists.';
          const suggestions = e.suggested_names && e.suggested_names.length ? e.suggested_names : (e.suggested_name ? [e.suggested_name] : []);
          this.pendingSuggestedName = suggestions[0] || null;
          if (container) {
            container.innerHTML = suggestions.map(s => `
              <button type="button" class="btn btn-secondary btn-xs" onclick="App.applySuggestedName('${s.replace(/'/g, "\\'")}')" style="background:var(--bg-input);border:1px solid var(--border-hover);color:var(--text-primary);padding:4px 10px;font-size:0.75rem;border-radius:6px;display:inline-flex;align-items:center;gap:4px">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> ${s}
              </button>
            `).join('');
          }
          return;
        }
      }
      this.toast(e.message, 'error');
    }
  },

  applySuggestedName(chosenName = null) {
    const nameToUse = chosenName || this.pendingSuggestedName;
    if (nameToUse) {
      const input = document.getElementById('model-name-input');
      if (input) input.value = nameToUse;
      const banner = document.getElementById('duplicate-warning-banner');
      if (banner) banner.style.display = 'none';
    }
  },

  async quickPreviewModel(modelId) {
    try {
      const model = await API.getModel(modelId);
      const stlFile = (model.files || []).find(f => f.file_type === 'stl' || f.file_type === '3mf' || f.file_type === 'gcode');
      if (stlFile) {
        const fileUrl = stlFile.url || `/uploads/${stlFile.filename}`;
        this.openBrowseFileModal(encodeURIComponent(JSON.stringify({
          name: stlFile.original_name || stlFile.filename,
          type: stlFile.file_type,
          url: fileUrl,
          size: stlFile.file_size
        })));
      } else if (model.thumbnail_url) {
        this.openModal(model.name, `<div style="display:flex;justify-content:center;align-items:center;background:var(--bg-dark);height:400px"><img src="${model.thumbnail_url}" style="max-width:100%;max-height:100%;object-fit:contain"></div>`);
      } else {
        this.navigate(`/models/${modelId}`);
      }
    } catch (e) {
      this.navigate(`/models/${modelId}`);
    }
  },

  confirmDeleteModel(id, name) {
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      return this.toast('You must be logged in to delete models', 'error');
    }
    const modelName = name || this.currentModel?.name || '';
    this.openModal('Delete Model', UI.deleteModelForm(id, modelName));
  },

  async handleDeleteModel(e, id) {
    e.preventDefault();
    try {
      await API.deleteModel(id);
      this.toast('Model moved to the Trash');
      this.closeModal();
      this.navigate('/models');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  copyToClipboard(text, message = 'Copied') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => this.toast(message));
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        this.toast(message);
      } catch (err) {
        console.error('Fallback copy failed', err);
        this.toast('Failed to copy', 'error');
      }
      document.body.removeChild(textArea);
    }
  },

  // ── Files ──
  showUploadFiles(modelId) {
    this.openModal('Upload Files', UI.uploadForm(modelId));
  },

  async handleFileSelect(e, modelId) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    await this.uploadFilesAction(modelId, files);
  },

  async handleFileDrop(e, modelId) {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    await this.uploadFilesAction(modelId, files);
  },

  async uploadFilesAction(modelId, files) {
    const MAX_SIZE = 500 * 1024 * 1024; // 500MB
    const tooLarge = files.find(f => f.size > MAX_SIZE);
    if (tooLarge) {
      this.toast(`File "${tooLarge.name}" exceeds the 500MB size limit.`, 'error');
      return;
    }
    const progress = document.getElementById('upload-progress');
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    if (progress) progress.innerHTML = UI.uploadProgressBox({ percent: 0, loaded: 0, total: totalSize, speed: 0, etaSec: 0 });
    
    try {
      await API.uploadFiles(modelId, files, {}, (p) => {
        if (progress) progress.innerHTML = UI.uploadProgressBox(p);
      });
      this.toast(`${files.length} file(s) uploaded`);
      this.closeModal();
      this.renderModelDetail(modelId);
    } catch (e) {
      this.toast(e.message, 'error');
      if (progress) progress.innerHTML = `<div style="color:var(--error);font-size:.875rem;margin-top:8px;display:flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>${e.message}</div>`;
    }
  },

  confirmDeleteFile(fileId, filename, modelId) {
    if (!this.currentUser || this.currentUser.role === 'viewer') {
      return this.toast('You must be logged in to delete files', 'error');
    }
    this.openModal('Delete File', UI.deleteFileForm(fileId, filename, modelId));
  },

  async handleDeleteFile(e, fileId, modelId) {
    e.preventDefault();
    try {
      await API.deleteFile(fileId);
      this.toast('File moved to the Trash');
      this.closeModal();
      this.renderModelDetail(modelId);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async sendToPrinter(fileId) {
    try {
      const config = await API.getSystemSettings();
      let printers = [];
      try { if (config.printers) printers = JSON.parse(config.printers); } catch(e){}
      
      if (printers.length === 0) {
        return this.toast('No printers configured. Go to Settings > Printers.', 'error');
      }
      
      if (printers.length === 1) {
        this.toast('Sending to ' + printers[0].name + '...', 'info');
        await API.sendToPrinter(fileId, printers[0].id);
        return this.toast('G-Code sent successfully to ' + printers[0].name);
      }
      
      this.openModal('Send to Moonraker', UI.sendToPrinterForm(fileId, printers));
    } catch(err) {
      this.toast(err.message, 'error');
    }
  },

  async handleSendToPrinter(e, fileId) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const printerId = fd.get('printer_id');
    const select = e.target.querySelector('select');
    const printerName = select.options[select.selectedIndex].text.split(' (')[0];
    try {
      this.toast('Sending to ' + printerName + '...', 'info');
      this.closeModal();
      await API.sendToPrinter(fileId, printerId);
      this.toast('G-Code sent successfully to ' + printerName);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Prints ──
  async showLogPrint(modelId) {
    await this.loadCache();
    this.openModal('Log Print', UI.printForm(modelId, this.cache.materials));
  },

  async handlePrintSubmit(e, modelId) {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await API.addPrint(modelId, {
        material_id: form.get('material_id') || null,
        successful: e.target.querySelector('[name="successful"]').checked,
        notes: form.get('notes'),
        printed_at: form.get('printed_at'),
      });
      this.toast('Print logged');
      this.closeModal();
      this.renderModelDetail(modelId);
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async deletePrint(printId, modelId) {
    if (!confirm('Delete this print entry?')) return;
    try {
      await API.deletePrint(printId);
      this.toast('Print entry deleted');
      const historyOpen = !!document.querySelector('#modal-overlay.active .print-history-modal');
      await this.renderModelDetail(modelId);
      if (historyOpen) this.showPrintHistory(modelId); // refresh the open list
    } catch (e) { this.toast(e.message, 'error'); }
  },

  // ── Settings Items ──
  async addSettingsItem(type) {
    const input = document.getElementById(`add-${type}-input`);
    const name = input?.value?.trim();
    if (!name) return;

    try {
      const data = { name };
      if (type === 'categories') {
        data.color = document.getElementById(`add-${type}-color`)?.value || '#8b5cf6';
      }
      if (type === 'categories') await API.createCategory(data);
      else if (type === 'tags') await API.createTag(data);
      else if (type === 'materials') await API.createMaterial(data);

      this.toast(`${type.slice(0,-1)} added`);
      await this.loadCache();
      this.renderSettings();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async deleteSettingsItem(type, id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      if (type === 'categories') await API.deleteCategory(id);
      else if (type === 'tags') await API.deleteTag(id);
      else if (type === 'materials') await API.deleteMaterial(id);

      this.toast(`${type.slice(0,-1)} deleted`);
      await this.loadCache();
      this.renderSettings();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async handleClearLogs() {
    if (!confirm('Clear all system logs?')) return;
    try {
      await API.clearSystemLogs();
      this.toast('Logs cleared');
      this.switchSettingsTab('system');
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async switchSettingsTab(tab) {
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    // Trigger the switch logic already defined in renderSettings
    const activeTab = Array.from(tabs).find(t => t.dataset.tab === tab);
    if (activeTab) activeTab.click();
  },

  async loadBlockedIps() {
    const el = document.getElementById('blocked-ips-list');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem">Loading blocked IPs...</div>';
    try {
      const ips = await API.getBlockedIps();
      if (!ips || ips.length === 0) {
        el.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0">No IP addresses are currently blocked.</div>';
        return;
      }
      el.innerHTML = `
        <table class="table" style="width:100%;font-size:.85rem">
          <thead><tr><th>IP Address</th><th>Failed Attempts</th><th>Blocked At</th><th>Action</th></tr></thead>
          <tbody>
            ${ips.map(item => `
              <tr>
                <td><strong>${item.ip}</strong></td>
                <td>${item.attempts}</td>
                <td>${UI.formatDate(item.blockedAt)}</td>
                <td><button type="button" class="btn btn-danger btn-xs" onclick="App.unblockIp('${item.ip}')">Unblock</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--error);font-size:.85rem">${e.message || 'Failed to fetch blocked IPs'}</div>`;
    }
  },

  async unblockIp(ip) {
    try {
      await API.unblockIp(ip);
      this.toast(`Unblocked IP ${ip}`);
      this.loadBlockedIps();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  },

  async scanForDuplicates() {
    const el = document.getElementById('duplicates-results');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--accent-cyan);font-size:.85rem">⏳ Scanning library using SHA-256 hashes... Please wait.</div>';
    try {
      const res = await API.scanDuplicates();
      if (!res.groups || res.groups.length === 0) {
        el.innerHTML = '<div style="color:var(--accent-green);font-size:.85rem;padding:8px 0">✓ Great news! No duplicate 3D model files found in your library.</div>';
        return;
      }
      el.innerHTML = `
        <div style="margin-bottom:10px;font-weight:600;color:var(--error)">Found ${res.duplicatesCount} group(s) of identical files:</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${res.groups.map(group => `
            <div style="background:var(--bg-input);padding:12px;border-radius:6px;border:1px solid var(--border)">
              <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px">SHA256: <code>${group.hash.substring(0, 16)}...</code> (${UI.formatSize(group.size)})</div>
              <div style="display:flex;flex-direction:column;gap:4px">
                ${group.files.map(f => `
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem">
                    <span style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><strong>${f.original_name}</strong> in model <a href="#/models/${f.model_id}" style="color:var(--accent-cyan)">${f.model_name || 'Model #'+f.model_id}</a></span>
                    <a href="#/models/${f.model_id}" class="btn btn-ghost btn-xs">View Model</a>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--error);font-size:.85rem">${e.message || 'Failed to scan duplicates'}</div>`;
    }
  }
};

// ── Drag-Safe Overlay Dismiss Handler (PR #51) ──
let overlayMouseDownTarget = null;
const modalOverlayEl = document.getElementById('modal-overlay');

if (modalOverlayEl) {
  modalOverlayEl.addEventListener('mousedown', (e) => {
    overlayMouseDownTarget = e.target;
  });

  modalOverlayEl.addEventListener('mouseup', (e) => {
    if (overlayMouseDownTarget === modalOverlayEl && e.target === modalOverlayEl) {
      App.dismissModal();
    }
    overlayMouseDownTarget = null;
  });

  window.addEventListener('mouseup', () => {
    overlayMouseDownTarget = null;
  });
}

// ── Close modal on Escape & Ctrl+K search shortcut ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const previewContainer = document.getElementById('preview-modal-container');
    if (previewContainer) {
      App.closePreviewFileModal();
    } else if (document.getElementById('modal-overlay')?.classList.contains('active')) {
      App.dismissModal();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.focus();
  }
});

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => App.init());
