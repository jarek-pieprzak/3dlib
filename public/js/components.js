/* ─── UI Components ───────────────────────────────────────────────────── */
const UI = {
  // The 3D file types the server measures for the printer fit check (server/utils/meshSize.js)
  MEASURABLE: ['stl', 'obj', '3mf', 'step'],

  // Names in order: Polish alphabet, case ignored, numbers by value ("Part 2" before "Part 10");
  // the server orders the same way (server/utils/names.js)
  compareNames: new Intl.Collator('pl', { numeric: true, sensitivity: 'base' }).compare,

  // Search form of a text, as the server's fold(): lower case, accents dropped, "ł" as "l"
  // ("lozysko" finds "Łożysko")
  foldText(s) {
    return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  },

  // HTML entity escaping helper
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // A string argument for an inline handler, quotes included: onclick="App.browseTo(${UI.jsArg(path)})".
  // escapeHtml alone is not enough there: the browser decodes &#39; back to ' before it runs
  // the code, so a name with a quote would end the string.
  jsArg(value) {
    return this.escapeHtml(JSON.stringify(value === null || value === undefined ? '' : String(value)));
  },

  // How a file can be shown in the model page's preview area (null = info only)
  previewKind(f) {
    const t = f && f.file_type;
    if (['stl', '3mf', 'step', 'obj'].includes(t)) return '3d';
    if (t === 'gcode' || t === 'bgcode') return 'gcode';
    if (t === 'image') return 'image';
    if (t === 'video') return 'video';
    if (t === 'document') return /\.pdf$/i.test(f.filename || f.original_name || '') ? 'pdf' : 'text';
    if (t === 'scad') return 'text';
    return null;
  },

  // The password fields of protected models are text inputs masked with CSS, so the browser's
  // password manager does not offer to save them. Browsers without -webkit-text-security
  // (older Firefox) get a real password field instead.
  maskFallback(root = document) {
    const css = window.CSS;
    if (css && css.supports && css.supports('-webkit-text-security', 'disc')) return;
    root.querySelectorAll('input.masked-input').forEach(i => { i.type = 'password'; });
  },

  // README / README.md / README.txt in the project folder itself (not in a subfolder)
  readmeFile(model) {
    const found = (model.files || []).filter(f => /^readme(\.(md|markdown|txt))?$/i.test(String(f.original_name || '')));
    return found.find(f => /\.(md|markdown)$/i.test(f.original_name)) || found[0] || null;
  },

  // What the preview area opens with: the chosen 3D preview, else the first 3D file, else the
  // chosen cover / first image, G-code, video or document
  defaultPreviewFile(model) {
    const readme = this.readmeFile(model);
    const files = (model.files || []).filter(f => this.previewKind(f) && f !== readme);
    const chosen = files.find(f => f.id === model.preview_file_id);
    const order = ['3d', 'image', 'gcode', 'video', 'pdf', 'text'];
    if (chosen && this.previewKind(chosen) === '3d') return chosen;
    const first3d = files.find(f => this.previewKind(f) === '3d');
    if (first3d) return first3d;
    if (chosen) return chosen;
    for (const kind of order) {
      const f = files.find(x => this.previewKind(x) === kind);
      if (f) return f;
    }
    return null;
  },

  // Files of a project folder keep their path relative to it ("Gantry adapters/Creality/mount.stl").
  // Show them as a collapsible folder tree, rendered fully open; App.fitFileTree collapses every
  // folder when the open tree does not fit the list. Models without subfolders stay a flat list.
  // opts.folders: folder paths to show even when empty; opts.folderActions(path): HTML for the
  // actions of a folder row
  fileTree(files, renderFile, opts = {}) {
    const nameOf = (f) => String(f.original_name || f.filename || '');
    const extraFolders = opts.folders || [];
    if (!extraFolders.length && !files.some(f => nameOf(f).includes('/'))) return files.map(f => renderFile(f, nameOf(f))).join('');

    const newNode = (p) => ({ path: p, folders: new Map(), files: [] });
    const root = newNode('');
    const nodeAt = (parts) => {
      let node = root;
      for (const part of parts) {
        if (!node.folders.has(part)) node.folders.set(part, newNode(node.path ? `${node.path}/${part}` : part));
        node = node.folders.get(part);
      }
      return node;
    };
    for (const folder of extraFolders) nodeAt(String(folder).split('/').filter(Boolean));
    for (const f of files) {
      const parts = nameOf(f).split('/').filter(Boolean);
      const base = parts.pop() || nameOf(f);
      nodeAt(parts).files.push({ f, base });
    }

    const countOf = (node) => node.files.length + [...node.folders.values()].reduce((n, child) => n + countOf(child), 0);
    const render = (node) => {
      const filesHtml = node.files.map(({ f, base }) => renderFile(f, base)).join('');
      const foldersHtml = [...node.folders.entries()]
        .sort((a, b) => this.compareNames(a[0], b[0]))
        .map(([name, child]) => {
          const count = countOf(child);
          const actions = opts.folderActions ? opts.folderActions(child.path) : '';
          return `
          <details class="file-folder" open data-entry-path="${this.escapeHtml(child.path)}" data-entry-kind="folder">
            <summary>
              <svg class="file-folder-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-cyan)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span class="file-folder-name">${this.escapeHtml(name)}</span>
              <span class="file-folder-count">${count}</span>
              ${actions}
            </summary>
            <div class="file-folder-body">${render(child) || '<div class="file-folder-empty">Empty folder</div>'}</div>
          </details>`;
        }).join('');
      return filesHtml + foldersHtml;
    };
    return render(root);
  },

  // "Xmas_tree_210_3dl-7k3m9q2x.3mf": the file name an "Open in slicer" link ends with.
  // Bambu Studio decodes the link before it downloads, so a space or any other %-encoded sign
  // would reach the server raw and fail (400): ASCII letters, digits, "_", "-" and "." only.
  slicerFileName(f, ext) {
    const base = String(f.original_name || f.filename || '').split('/').pop().replace(/\.[^.]+$/, '');
    const stem = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[łŁ]/g, m => (m === 'ł' ? 'l' : 'L'))
      .replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 100) || 'model';
    return `${stem}${f.slicer_token ? `_3dl-${f.slicer_token}` : ''}.${ext}`;
  },

  // "Open in slicer" links of a file, or of one of its versions (a slicer project, always a
  // 3MF). A slicer downloads the file itself, without the browser's cookies: an unlocked
  // protected model passes its unlock token along. The URL ends with the file's name and token,
  // so a project saved by the slicer comes back to this file.
  slicerLinks(f, modelId, versionId = null) {
    const unlockQ = (App.modelUnlock && App.modelUnlock.id === modelId) ? `?unlock=${App.modelUnlock.token}` : '';
    const abs = (p) => encodeURI(`${window.location.origin}${p}${unlockQ}`);
    const ext = ((String(f.original_name || f.filename || '').match(/\.([a-z0-9]+)$/i) || [])[1] || f.file_type).toLowerCase();
    const file = versionId
      ? abs(`/api/files/${f.id}/versions/${versionId}/file/${this.slicerFileName(f, '3mf')}`)
      : abs(`/api/files/${f.id}/download/${this.slicerFileName(f, ext)}`);
    // Bambu Studio refuses a link that does not end in .3mf: an STL is served as a 3MF
    const bambu = versionId ? file : abs(`/api/files/${f.id}/3mf/${this.slicerFileName(f, '3mf')}`);
    return {
      orcaslicer: { name: 'OrcaSlicer', url: `orcaslicer://open?file=${file}` },
      elegooslicer: { name: 'Elegoo Slicer', url: `elegooslicer://open?file=${file}` },
      cura: { name: 'Ultimaker Cura', url: `cura://open?file=${file}` },
      bambustudio: { name: 'Bambu Studio', url: `bambustudio://open?file=${bambu}` }
    };
  },

  // The icon of a slicer (public/img/slicers, from the slicers' own repositories); without one
  // (no default slicer) a generic print icon
  slicerIcon(id) {
    return id && App.SLICERS && App.SLICERS[id]
      ? `<img class="slicer-icon" src="/img/slicers/${id}.png" alt="" width="16" height="16">`
      : '<svg class="slicer-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
  },

  // "Open in slicer": the button with the icon of the default slicer (top bar / profile) opens
  // it, the arrow lists the other slicers. onclick: the button opens the slicer chooser instead
  // (a file with saved slicer projects; versions: how many). compact: the icon alone, for lists;
  // its menu is placed against the window (App.placeMenu), so a scrolling list does not cut it.
  slicerButton(links, { onclick = null, versions = 0, compact = false } = {}) {
    const pref = App.currentUser?.preferred_slicer;
    const chevron = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const main = pref && links[pref] ? links[pref] : null;
    const icon = this.slicerIcon(main ? pref : null);
    const label = compact ? '' : `<span>OPEN IN ${(main ? main.name : 'slicer').toUpperCase()}</span>`;
    const count = versions ? `<span class="slicer-count" title="${Number(versions)} saved version${Number(versions) === 1 ? '' : 's'}">${Number(versions)}</span>` : '';
    const cls = `btn btn-ghost btn-xs slicer-btn slicer-main${compact ? ' is-compact' : ''}`;
    const others = Object.entries(links).filter(([k]) => !main || k !== pref);
    const item = ([id, s]) => `<a href="${s.url}">${this.slicerIcon(id)}${s.name}</a>`;
    const first = onclick
      ? `<button type="button" class="${cls} is-joined" title="Open in ${this.escapeHtml(main ? main.name : 'a slicer')}: the original or a saved version" onclick="event.stopPropagation();${onclick}">${icon}${label}${count}</button>`
      : main ? `<a href="${main.url}" class="${cls} is-joined" title="Open in ${main.name}">${icon}${label}</a>` : '';
    // Without a default slicer (and nothing to choose from) the menu is the button
    if (!first) {
      return `
      <div class="dropdown slicer-split" onclick="event.stopPropagation()"${compact ? ' onmouseenter="App.placeMenu(this)"' : ''}>
        <button type="button" class="${cls}" title="Open in Slicer">${icon}${compact ? '' : '<span>OPEN IN SLICER</span>'}${chevron}</button>
        <div class="dropdown-content slicer-menu">
          <div class="dropdown-header">Open in Slicer</div>
          ${others.map(item).join('')}
        </div>
      </div>`;
    }
    return `
      <div class="slicer-split${compact ? ' is-compact' : ''}" onclick="event.stopPropagation()">
        ${first}
        <div class="dropdown"${compact ? ' onmouseenter="App.placeMenu(this)"' : ''}>
          <button type="button" class="btn btn-ghost btn-xs slicer-btn slicer-more" aria-label="${main ? 'Other slicers' : 'Open in a slicer'}">${chevron}</button>
          <div class="dropdown-content slicer-menu">
            <div class="dropdown-header">${onclick ? 'The original in' : 'Other Slicers'}</div>
            ${(onclick ? Object.entries(links) : others).map(item).join('')}
          </div>
        </div>
      </div>`;
  },

  // A small version of a library image for cards and tiles (server/routes/images.js): a cover
  // can be a full-size photo, which would cost the browser tens of MB per card
  imgSrc(url, width) {
    if (!url || typeof url !== 'string') return url;
    const plain = url.split('?')[0];
    if (!/^\/(uploads|library-files)\//.test(plain) || !/\.(png|jpe?g|webp|gif)$/i.test(plain)) return url;
    return `/thumbs?w=${width}&u=${encodeURIComponent(plain)}`;
  },

  // Icon of a file row: unknown and archive types show their extension
  fileIconType(f) {
    const ext = (String(f.original_name || f.filename || '').match(/\.([^./]+)$/) || [])[1] || '';
    return ['other', 'zip', 'f3d', 'scad'].includes(f.file_type) ? (ext.toLowerCase() || f.file_type) : f.file_type;
  },

  // SQLite datetime('now') values are UTC without a zone
  sqlDate(value) {
    if (!value) return null;
    return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? new Date(value.replace(' ', 'T') + 'Z') : new Date(value);
  },

  // "12 days left" until something in the Trash is deleted for good
  trashCountdown(deletedAt, retentionDays) {
    const days = retentionDays === undefined || retentionDays === null ? 30 : Number(retentionDays);
    if (days <= 0) return 'kept until the Trash is emptied';
    const deleted = this.sqlDate(deletedAt);
    if (!deleted || isNaN(deleted)) return '';
    const left = Math.ceil(days - (Date.now() - deleted.getTime()) / 86400000);
    if (left <= 0) return 'deleted for good at the next cleanup';
    return `${left} day${left === 1 ? '' : 's'} left`;
  },

  // One text field: rename a file or folder, name a new folder
  entryNameForm({ label, value = '', submitLabel, hint = '' }) {
    return `
      <form onsubmit="App.handleEntryNameSubmit(event)">
        <div class="form-group">
          <label class="form-label">${this.escapeHtml(label)}</label>
          <input class="form-input" name="name" id="entry-name-input" value="${this.escapeHtml(value)}" autocomplete="off" spellcheck="false" required maxlength="255">
          ${hint ? `<div class="form-hint" style="margin-top:6px;font-size:.75rem;color:var(--text-muted)">${hint}</div>` : ''}
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${this.escapeHtml(submitLabel)}</button>
        </div>
      </form>`;
  },

  // Pick the folder of the project to move a file or folder to
  entryMoveForm(name, folders, current) {
    const firstFree = folders.find(f => f !== current);
    const options = folders.map(f => `<option value="${this.escapeHtml(f)}"${f === current ? ' disabled' : ''}${f === firstFree ? ' selected' : ''}>${f ? this.escapeHtml(f) : '(project folder)'}${f === current ? ' (current)' : ''}</option>`).join('');
    return `
      <form onsubmit="App.handleEntryMoveSubmit(event)">
        <div style="margin-bottom:14px;color:var(--text-secondary)">Move <strong>${this.escapeHtml(name)}</strong> to:</div>
        <div class="form-group">
          <select class="form-select" name="target" size="${Math.min(10, Math.max(3, folders.length))}" style="width:100%;background-image:none;padding-right:12px">${options}</select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"${firstFree === undefined ? ' disabled' : ''}>Move</button>
        </div>
      </form>`;
  },

  deleteEntryForm(name, isFolder) {
    return `
      <form onsubmit="App.handleEntryDeleteSubmit(event)">
        <div style="margin-bottom:16px;color:var(--text-secondary)">
          Delete ${isFolder ? 'the folder' : ''} <strong>"${this.escapeHtml(name)}"</strong>${isFolder ? ' with everything in it' : ''}?
        </div>
        ${this.trashNote()}
        <div class="form-actions" style="margin-top:24px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-danger">Delete</button>
        </div>
      </form>`;
  },

  // ── Trash page (sidebar) ──
  trashPage(data) {
    const days = data.retention_days;
    const models = data.models || [];
    const files = data.files || [];
    const restoreIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const purgeIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const placeholder = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';

    const modelRows = models.map(m => `
      <div class="trash-row">
        <a class="trash-thumb${m.is_protected ? ' is-protected' : ''}" href="#/models/${m.id}?trash=1" title="Open">
          ${m.thumbnail_url ? `<img src="${this.escapeHtml(this.imgSrc(m.thumbnail_url, 160))}" alt="" loading="lazy">` : placeholder}
        </a>
        <div class="trash-info">
          <a class="trash-name" href="#/models/${m.id}?trash=1">${this.escapeHtml(m.name)}</a>
          <div class="trash-meta">${m.file_count} file${m.file_count === 1 ? '' : 's'} · ${this.formatSize(m.total_size)} · deleted ${this.formatDateShort(this.sqlDate(m.deleted_at))} · <span class="trash-countdown">${this.trashCountdown(m.deleted_at, days)}</span></div>
        </div>
        <div class="trash-actions">
          <button type="button" class="btn btn-secondary btn-xs" onclick="App.restoreTrashItems([${m.id}], [])">${restoreIcon}Restore</button>
          <button type="button" class="file-action-btn delete" title="Delete permanently" onclick="App.purgeTrashItems([${m.id}], [])">${purgeIcon}</button>
        </div>
      </div>`).join('');

    // Deleted files of models that are not in the Trash, grouped by model
    const groups = new Map();
    for (const f of files) {
      if (!groups.has(f.model_id)) groups.set(f.model_id, { name: f.model_name, files: [] });
      groups.get(f.model_id).files.push(f);
    }
    const fileGroups = [...groups.entries()].map(([modelId, g]) => `
      <div class="trash-group">
        <div class="trash-group-head">
          <a href="#/models/${modelId}" onclick="App.openModelTrashTab(${modelId})">${this.escapeHtml(g.name)}</a>
          <span>${g.files.length} file${g.files.length === 1 ? '' : 's'}</span>
          <button type="button" class="btn btn-ghost btn-xs" onclick="App.restoreTrashItems([], [${g.files.map(f => f.id).join(',')}])">Restore all</button>
        </div>
        ${g.files.map(f => `
        <div class="trash-row is-file">
          ${this.fileTypeIcon(this.fileIconType(f))}
          <div class="trash-info">
            <a class="trash-name" href="#/models/${modelId}" onclick="App.openModelTrashTab(${modelId})" title="Open the model's Trash tab to preview">${this.escapeHtml(f.original_name)}</a>
            <div class="trash-meta">${this.formatSize(f.file_size)} · deleted ${this.formatDateShort(this.sqlDate(f.deleted_at))} · <span class="trash-countdown">${this.trashCountdown(f.deleted_at, days)}</span></div>
          </div>
          <div class="trash-actions">
            <button type="button" class="file-action-btn restore" title="Restore" onclick="App.restoreTrashItems([], [${f.id}])">${restoreIcon}</button>
            <button type="button" class="file-action-btn delete" title="Delete permanently" onclick="App.purgeTrashItems([], [${f.id}])">${purgeIcon}</button>
          </div>
        </div>`).join('')}
      </div>`).join('');

    const empty = !models.length && !files.length;
    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">Trash</h1>
          <div class="page-subtitle">${days > 0 ? `Deleted models and files stay on disk for ${days} days, then they are deleted for good.` : 'Deleted models and files stay on disk until the Trash is emptied.'}</div>
        </div>
        ${!empty && App.currentUser?.role === 'admin' ? `<button class="btn btn-danger btn-sm" onclick="App.confirmEmptyTrash()">Empty Trash</button>` : ''}
      </div>
      ${empty ? `
      <div class="empty-state">
        <div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div>
        <div class="empty-state-text">The Trash is empty</div>
      </div>` : ''}
      ${models.length ? `<div class="glass-panel trash-section"><div class="panel-header"><div class="panel-title">Models (${models.length})</div></div><div class="panel-body no-pad">${modelRows}</div></div>` : ''}
      ${files.length ? `<div class="glass-panel trash-section"><div class="panel-header"><div class="panel-title">Files (${files.length})</div></div><div class="panel-body no-pad">${fileGroups}</div></div>` : ''}`;
  },

  // ── File history (.versions) ──
  fileHistoryModal(file, versions, canEdit) {
    const sources = { slicer: 'Before a slicer save', restore: 'Before a restore' };
    const is3d = ['stl', '3mf', 'obj', 'step'].includes(file.file_type);
    const rows = versions.map(v => `
      <div class="trash-row">
        ${this.fileTypeIcon(this.fileIconType(file))}
        <div class="trash-info">
          <div class="trash-name" style="cursor:default">${this.escapeHtml(this.sqlDate(v.created_at).toLocaleString())}</div>
          <div class="trash-meta">${this.formatSize(v.file_size)} · ${sources[v.source] || this.escapeHtml(v.source || '')}</div>
        </div>
        <div class="trash-actions">
          ${is3d ? `<button type="button" class="btn btn-ghost btn-xs" onclick="App.previewFileVersion(${v.id})">Preview</button>` : ''}
          <a class="file-action-btn" href="${this.escapeHtml(v.url)}" download title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
          ${canEdit ? `
          <button type="button" class="btn btn-secondary btn-xs" onclick="App.restoreFileVersion(${v.id})">Restore</button>
          <button type="button" class="file-action-btn delete" title="Delete this version" onclick="App.deleteFileVersion(${v.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
        </div>
      </div>`).join('');
    return `
      <div style="margin-bottom:12px;color:var(--text-secondary);font-size:.85rem">
        Earlier contents of <strong>${this.escapeHtml(file.original_name)}</strong>, newest first. Restore keeps the current content as a version too.
      </div>
      <div class="glass-panel" style="max-height:60vh;overflow:auto">${rows || '<div class="empty-state" style="padding:24px"><div class="empty-state-text">No earlier versions</div></div>'}</div>`;
  },

  // ── "Open in slicer" with saved slicer projects ──
  // The versions of a read-only file are slicer projects saved from it (server/utils/
  // slicerSettings.js): what each is set up with and what changed from the one before.

  // A name for a version: its own, else made from its settings ("PETG · 25% · supports")
  slicerVersionName(v) {
    if (v.label) return v.label;
    const s = v.summary;
    if (!s) return 'Saved project';
    const parts = [[...new Set((s.filaments || []).map(f => f.type).filter(Boolean))].join(' + ')];
    if (s.infill && s.infill.density) parts.push(s.infill.density);
    if (s.supports && (s.supports.enabled || s.supports.objects_on)) parts.push('supports');
    return parts.filter(Boolean).join(' · ') || 'Saved project';
  },

  // What changed from the version before (`prev`, the next row): the settings people choose, by
  // name, at most six, the rest counted. Materials compare the filaments the part prints with,
  // not every slot of the project.
  slicerVersionChanges(v, prev = null) {
    if (!v.changes) {
      const s = v.summary;
      const geometry = s && s.original_faces && s.faces && s.original_faces !== s.faces;
      return { items: [geometry ? 'first save · geometry changed' : 'first save'], other: 0 };
    }
    const used = (x) => ((x && x.summary && x.summary.filaments) || []);
    const types = (x) => [...new Set(used(x).map(f => f.type).filter(Boolean))].join(' + ');
    const items = [];
    let other = 0;
    if (prev && prev.summary && v.summary) {
      if (types(prev) !== types(v)) items.push(`material ${types(prev) || '?'} → ${types(v) || '?'}`);
      else if (used(prev).map(f => f.colour).join() !== used(v).map(f => f.colour).join()) items.push('colour');
      else if (used(prev).map(f => f.name).join() !== used(v).map(f => f.name).join()) items.push('filament');
    }
    const named = [
      [/^filament_type$/, 'material', true], [/^filament_colour$/, 'colour'], [/^filament_settings_id$/, 'filament'],
      [/^sparse_infill_density$/, 'infill', true], [/^sparse_infill_pattern$/, 'infill pattern'], [/^layer_height$/, 'layer', true],
      [/^wall_loops$/, 'walls', true], [/^(top|bottom)_shell_layers$/, 'top / bottom layers'], [/^(enable_support|support_type)$/, 'supports'],
      [/^printer_settings_id$/, 'printer'], [/^print_settings_id$/, 'process'], [/^curr_bed_type$/, 'plate type'], [/^brim_type$/, 'brim'],
      [/: turn$/, 'turned'], [/: faces$/, 'geometry'], [/^object .*: (enable_support|support_)/, 'supports of a part'],
      [/^object /, 'part settings'], [/^(plates|plate \d+:)/, 'plates'], [/^objects$/, 'objects']
    ];
    // In the order of the list above: infill and layer before turns and plates
    const hits = [];
    for (const c of v.changes) {
      const at = named.findIndex(([re]) => re.test(c.key));
      // Filament slots: the comparison above says what changed for this part
      if (at < 0 || (prev && /^filament_/.test(c.key))) { other++; continue; }
      hits.push({ at, c });
    }
    hits.sort((a, b) => a.at - b.at);
    for (const { at, c } of hits) {
      const [, name, values] = named[at];
      const text = values && c.from !== null && c.to !== null && String(c.from).length < 24 && String(c.to).length < 24 ? `${name} ${c.from} → ${c.to}` : name;
      if (items.some(i => i === text || i.startsWith(name + ' '))) continue;
      if (items.length < 6) items.push(text); else other++;
    }
    if (!items.length && !other) items.push('no changes');
    return { items, other };
  },

  // The modal: the original and the versions as rows of a table; the chosen one opens below.
  // ctx: { modelId, canEdit, selected: version id, 0 for the original }
  slicerChooser(file, versions, ctx) {
    const esc = (s) => this.escapeHtml(s);
    const dash = '<span class="sv-none">—</span>';
    const icon = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const swatch = (c) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(c || '')) ? `<span class="sv-swatch" style="background:${c}"></span>` : '');
    const pin = icon('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>');
    // "Bambu Lab X1 Carbon 0.4 nozzle" -> "X1 Carbon 0.4": the full name is the title
    const printer = (name) => String(name).replace(/^Bambu Lab\s+/i, '').replace(/\s+nozzle$/i, '');
    const row = (v, i) => {
      const s = v.summary || {};
      const ch = this.slicerVersionChanges(v, versions[i + 1]);
      const supports = !s.supports ? null
        : s.supports.enabled ? `supports ${s.supports.type || 'on'}`
          : s.supports.objects_on ? `supports on ${s.supports.objects_on} part${s.supports.objects_on === 1 ? '' : 's'}` : 'no supports';
      const settings = [
        s.layer_height ? `${s.layer_height} mm layers` : null,
        s.infill ? `${s.infill.density || '?'} ${s.infill.pattern || ''} infill` : null,
        s.walls ? `${s.walls} wall${s.walls === '1' ? '' : 's'}` : null,
        supports
      ].filter(Boolean);
      const details = (v.changes || []).map(c => `<li><code>${esc(c.key)}</code> ${esc(c.from === null ? '—' : c.from)} → ${esc(c.to === null ? '—' : c.to)}</li>`).join('');
      return `
        <tr class="sv-row${ctx.selected === v.id ? ' is-selected' : ''}" data-version="${v.id}" onclick="App.slicerChooserPick(${v.id})">
          <td class="sv-pick"><input type="radio" name="sv-pick" aria-label="Choose this version"${ctx.selected === v.id ? ' checked' : ''}></td>
          <td>
            <div class="sv-saved">
              ${v.thumbnail_url ? `<img class="sv-thumb" src="${esc(v.thumbnail_url)}" alt="" loading="lazy">` : '<span class="sv-thumb"></span>'}
              <div class="sv-saved-text">
                <div class="sv-name">${v.pinned ? `<span class="sv-pin" title="Pinned: never pruned">${pin}</span>` : ''}<span>${esc(this.slicerVersionName(v))}</span></div>
                <div class="sv-date">${esc(this.sqlDate(v.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}${s.sliced ? ` · ${Math.round(s.sliced.time / 60)} min · ${s.sliced.weight} g` : ''}</div>
                ${ctx.canEdit ? `
                <div class="sv-row-actions" onclick="event.stopPropagation()">
                  <button type="button" class="kit-icon-btn" title="Name this version" onclick="App.slicerVersionLabel(${v.id})">${icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>')}</button>
                  <button type="button" class="kit-icon-btn${v.pinned ? ' is-on' : ''}" title="${v.pinned ? 'Unpin: may be pruned' : 'Pin: never pruned'}" onclick="App.slicerVersionPin(${v.id}, ${v.pinned ? 'false' : 'true'})">${pin}</button>
                  <button type="button" class="kit-icon-btn is-danger" title="Delete this version" onclick="App.slicerVersionDelete(${v.id})">${icon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')}</button>
                </div>` : ''}
              </div>
            </div>
          </td>
          <td>${(s.filaments || []).length ? s.filaments.map(f => `<div class="sv-line sv-filament" title="${esc(f.name || '')}">${swatch(f.colour)}<span>${esc(f.type || '?')}</span><span class="sv-sub">${esc(f.vendor || '')}</span></div>`).join('') : dash}</td>
          <td>${settings.length ? settings.map(t => `<div class="sv-line">${esc(t)}</div>`).join('') : dash}</td>
          <td>${s.printer ? `<div class="sv-line" title="${esc(s.printer)}">${esc(printer(s.printer))}</div>` : dash}</td>
          <td class="sv-changes">
            <div class="sv-change-list">${ch.items.map(t => `<span class="sv-change">${esc(t)}</span>`).join('')}${ch.other ? `<span class="sv-change is-more">+${ch.other} other</span>` : ''}</div>
            ${details ? `<details class="sv-details" onclick="event.stopPropagation()"><summary>All changes</summary><ul>${details}</ul></details>` : ''}
          </td>
        </tr>`;
    };
    return `
      <div class="sv-intro">Open <strong>${esc(file.original_name)}</strong> as it is in the archive, or a project saved from it in the slicer (newest first). Saving in the slicer adds a new version; the archive file never changes.</div>
      <div class="sv-table-wrap">
        <table class="sv-table">
          <thead><tr><th></th><th>Saved</th><th>Material</th><th>Settings</th><th>Printer</th><th>Changes</th></tr></thead>
          <tbody>
            <tr class="sv-row${!ctx.selected ? ' is-selected' : ''}" data-version="0" onclick="App.slicerChooserPick(0)">
              <td class="sv-pick"><input type="radio" name="sv-pick" aria-label="Choose the original"${!ctx.selected ? ' checked' : ''}></td>
              <td><div class="sv-saved"><span class="sv-thumb"></span><div class="sv-saved-text"><div class="sv-name">Original</div><div class="sv-date">${esc(this.formatSize(file.file_size))} · as in the archive</div></div></div></td>
              <td colspan="4"><span class="sv-sub">No slicer settings: the slicer starts with its own defaults</span></td>
            </tr>
            ${versions.map(row).join('')}
            ${versions.length ? '' : `<tr class="sv-empty"><td></td><td colspan="5">No saved versions yet. Open the original, save the project in the slicer (to <code>.slicer-saves</code>) and it comes back here with its settings.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="sv-footer" id="sv-footer">${this.slicerChooserFooter(file, ctx.modelId, ctx.selected)}</div>`;
  },

  // Open / download the chosen one: the original file, or version `versionId`
  slicerChooserFooter(file, modelId, versionId) {
    const links = this.slicerLinks(file, modelId, versionId || null);
    const download = versionId ? `/api/files/${file.id}/versions/${versionId}/file` : `/api/files/${file.id}/download`;
    return `
      <span class="sv-chosen">${versionId ? 'The chosen version' : 'The original'}</span>
      ${this.slicerButton(links)}
      <a class="btn btn-secondary btn-xs" href="${download}" download>Download</a>`;
  },

  // ── Slicer saves page (sidebar) ──
  slicerSavesPage(data) {
    const saves = data.saves || [];
    const by = (status) => saves.filter(s => s.status === status);
    const ago = (ms) => this.formatDateShort(new Date(ms)) + ' ' + new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const modelLink = (id, name, fileName) => id ? `<a href="#/models/${id}">${this.escapeHtml(name || '')}</a>${fileName ? ` / ${this.escapeHtml(fileName)}` : ''}` : '';
    const row = (s, meta, actions) => `
      <div class="trash-row">
        ${this.fileTypeIcon(this.fileIconType({ original_name: s.name, file_type: (s.name.match(/\.([^.]+)$/) || [])[1] }))}
        <div class="trash-info">
          <div class="trash-name" style="cursor:default" title="${this.escapeHtml(s.name)}">${this.escapeHtml(s.name)}</div>
          <div class="trash-meta">${this.formatSize(s.file_size)} · saved ${ago(s.mtime_ms)}${meta ? ` · ${meta}` : ''}</div>
        </div>
        <div class="trash-actions">${actions}</div>
      </div>`;
    const preview = (s) => /\.(3mf|stl|obj)$/i.test(s.name) ? `<button type="button" class="btn btn-ghost btn-xs" onclick="App.previewSlicerSave(${s.id})">Preview</button>` : '';
    const discard = (s) => `<button type="button" class="file-action-btn delete" title="Delete this saved file" onclick="App.deleteSlicerSave(${s.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    const section = (title, hint, items) => items.length ? `
      <div class="glass-panel trash-section">
        <div class="panel-header"><div class="panel-title">${title} (${items.length})</div>${hint ? `<div class="slicer-hint">${hint}</div>` : ''}</div>
        <div class="panel-body no-pad">${items.join('')}</div>
      </div>` : '';

    const quietMs = data.quiet_minutes * 60000;
    const pending = by('pending').map(s => {
      const left = Math.max(1, Math.ceil((quietMs - (data.now - s.mtime_ms)) / 60000));
      return row(s, `for ${modelLink(s.model_id, s.model_name, s.file_name)} · imports in ${left} min`,
        `${preview(s)}<button type="button" class="btn btn-primary btn-xs" onclick="App.importSlicerSave(${s.id})">Import now</button>`);
    });
    const errors = by('error').map(s => row(s, `<span style="color:var(--error)">${this.escapeHtml(s.message || 'Import failed')}</span>`,
      `<button type="button" class="btn btn-secondary btn-xs" onclick="App.importSlicerSave(${s.id})">Retry</button>${discard(s)}`));
    const unmatched = by('unmatched').map(s => row(s, 'no matching file',
      `${preview(s)}<button type="button" class="btn btn-primary btn-xs" onclick="App.showAssignSlicerSave(${s.id})">Assign...</button>${discard(s)}`));
    const imported = by('imported').map(s => row(s, `${this.escapeHtml(s.message || 'Imported')} · ${modelLink(s.imported_model_id, s.imported_model_name, s.imported_name)}`, ''));
    const superseded = by('superseded').map(s => row(s, `${this.escapeHtml(s.message || '')} · ${modelLink(s.model_id, s.model_name, s.file_name)}`, `${preview(s)}<button type="button" class="btn btn-secondary btn-xs" onclick="App.showAssignSlicerSave(${s.id})">Assign...</button>${discard(s)}`));
    const downloads = by('download').map(s => row(s, `opened from ${modelLink(s.model_id, s.model_name, s.file_name) || 'the library'}, not changed`, ''));
    const empty = !saves.length;

    return `
      <div class="page-header">
        <div>
          <h1 class="page-title">Slicer saves</h1>
          <div class="page-subtitle">Projects your slicer saves to the library's <code>.slicer-saves</code> folder. A changed file replaces the file it was opened from
            ${data.quiet_minutes > 0 ? `${data.quiet_minutes} minute${data.quiet_minutes === 1 ? '' : 's'} after the last save` : 'right away'}; the old content stays in its History.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="App.checkSlicerSaves()">Check now</button>
          <button class="btn btn-secondary btn-sm" onclick="App.cleanupSlicerSaves()" title="Delete the files that hold nothing new: imported, older or unchanged">Clean up now</button>
        </div>
      </div>
      ${empty ? `<div class="empty-state"><div class="empty-state-text">Nothing saved by the slicer yet</div><div class="empty-state-sub">Set the slicer's save folder to <code>.slicer-saves</code> in the library share.</div></div>` : ''}
      ${section('Needs a decision', 'These files match no library file.', unmatched)}
      ${section('Failed', '', errors)}
      ${section('Waiting', 'Imported once the slicer has not saved them for a while.', pending)}
      ${section('Imported', data.cleanup_days > 0 ? `Deleted from .slicer-saves ${data.cleanup_days} day${data.cleanup_days === 1 ? '' : 's'} after the last save, or as soon as the file is saved again.` : 'Deleted as soon as the file is saved again.', imported)}
      ${section('Older saves', 'A newer save of the same file is in the library already; they are not imported on their own.', superseded)}
      ${section('Opened, not changed', '', downloads)}`;
  },

  slicerAssignForm(save) {
    return `
      <div style="margin-bottom:14px;color:var(--text-secondary);font-size:.85rem">Where should <strong>${this.escapeHtml(save.name)}</strong> go?</div>
      <div class="slicer-assign">
        <button type="button" class="btn btn-secondary" onclick="App.assignSlicerSave({ new_model: true })">New model "${this.escapeHtml(save.clean_name.replace(/\.[^.]+$/, ''))}"</button>
        <div class="slicer-assign-or">or put it into a model</div>
        <form onsubmit="event.preventDefault();App.searchAssignModels()" style="display:flex;gap:8px">
          <input class="form-input" id="assign-model-search" placeholder="Search models..." autocomplete="off" style="flex:1">
          <button type="submit" class="btn btn-secondary">Search</button>
        </form>
        <div id="assign-model-results" class="slicer-assign-results"></div>
        <div id="assign-model-files"></div>
      </div>`;
  },

  // The "..." menu of a file or folder row in a project's file list. The row carries
  // data-entry-path / data-entry-kind; the handlers read them from there.
  entryMenu(items) {
    if (!items.length) return '';
    const icons = {
      rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
      move: '<path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
      history: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><polyline points="12 7 12 12 15 14"/>',
      delete: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
    };
    return `
      <div class="dropdown entry-menu" onclick="event.preventDefault();event.stopPropagation()">
        <button type="button" class="file-action-btn" title="More actions" aria-label="More actions"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
        <div class="dropdown-content">
          ${items.map(it => `<a href="#" class="${it.danger ? 'is-danger' : ''}" onclick="event.preventDefault();event.stopPropagation();App.${it.action}(this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[it.icon]}</svg>${it.label}</a>`).join('')}
        </div>
      </div>`;
  },

  // Safe URL protocol validator (only http, https, mailto allowed)
  safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) return trimmed;
    return '';
  },

  // Gradient generator based on string hash
  gradient(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    const h1 = Math.abs(h % 360), h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1},70%,25%), hsl(${h2},60%,15%))`;
  },

  formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i < 0) i = 0;
    if (i >= u.length) i = u.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  },

  formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  formatDateShort(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  fileTypeIcon(type) {
    const icons = {
      stl: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
      gcode: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12H9"></path><path d="M15 9H9"></path><path d="M12 15H9"></path></svg>',
      bgcode: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12H9"></path><path d="M15 9H9"></path><path d="M12 15H9"></path></svg>',
      image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      '3mf': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
      step: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11.5 2.1-4.8 1.4c-.6.2-1 .6-1.1 1.2l-.7 4.2c-.1.5.1 1 .5 1.3l3.2 2.7c.4.3.9.4 1.4.2l4.8-1.4c.6-.2 1-.6 1.1-1.2l.7-4.2c.1-.5-.1-1-.5-1.3L12.9 2.3c-.4-.3-.9-.4-1.4-.2Z"></path><path d="M6 15v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4"></path><path d="m12 11 4 3"></path><path d="m12 11-4 3"></path><path d="M12 11v6"></path></svg>',
      f3d: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.27 6.96L12 12.01l8.73-5.05"></path><path d="M12 22.08V12"></path></svg>',
      obj: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
      video: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="15" height="14" rx="2"></rect><polygon points="22 7 17 11 17 13 22 17 22 7"></polygon></svg>',
      document: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'
    };
    const label = String(type || '').replace(/[^a-z0-9]/gi, '').toUpperCase().substring(0, 4) || '?';
    const icon = icons[type] || `<span style="font-size:.6rem;font-weight:700">${label}</span>`;
    return `<div class="file-icon ${String(type).replace(/[^a-z0-9]/gi, '')}">${icon}</div>`;
  },

  // dashboard stats 
  statsCards(stats) {
    return `<div class="stats-grid">
      <div class="stat-card"><div class="stat-icon cyan"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div><div class="stat-value">${stats.totalModels}</div><div class="stat-label">Total Models</div></div>
      <div class="stat-card"><div class="stat-icon green"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><div class="stat-value">${stats.printedModels}</div><div class="stat-label">Printed Models</div></div>
      <div class="stat-card"><div class="stat-icon purple"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div><div class="stat-value">${stats.successRate}%</div><div class="stat-label">Success Rate</div></div>
      <div class="stat-card"><div class="stat-icon pink"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><div class="stat-value">${stats.totalFiles}</div><div class="stat-label">Total Files (${this.formatSize(stats.totalSize)})</div></div>
    </div>`;
  },
  // breadcrumb nav for folder browser
  breadcrumbs(currentPath) {
    const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];
    let crumbs = `<a href="#" onclick="event.preventDefault();App.browseTo('')" style="color:var(--accent-cyan);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Home</a>`;
    
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
      accumulated += (accumulated ? '/' : '') + parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        crumbs += ` <span style="color:var(--text-muted);margin:0 6px">›</span> <span style="color:var(--text-primary);font-weight:600">${this.escapeHtml(parts[i])}</span>`;
      } else {
        const pathCopy = accumulated;
        crumbs += ` <span style="color:var(--text-muted);margin:0 6px">›</span> <a href="#" onclick="event.preventDefault();App.browseTo(${this.jsArg(pathCopy)})" style="color:var(--accent-cyan);text-decoration:none">${this.escapeHtml(parts[i])}</a>`;
      }
    }
    
    return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:0;font-size:.9rem">${crumbs}</div>`;
  },

  // sidebar tree for folder browser
  folderTree(nodes, activePath = '') {
    const js = (s) => this.jsArg(s);
    const esc = (s) => this.escapeHtml(s);
    function renderNode(node, depth = 0) {
      const isActive = activePath === node.path;
      const isParent = activePath.startsWith(node.path + '/');
      const isOpen = isActive || isParent;
      const hasChildren = node.children && node.children.length > 0;
      const indent = depth * 16;
      
      const arrow = hasChildren 
        ? `<span style="display:inline-block;width:14px;font-size:10px;transition:transform .2s;transform:rotate(${isOpen ? '90' : '0'}deg);cursor:pointer" onclick="event.stopPropagation();const childDiv = this.parentElement.nextElementSibling; if(childDiv && childDiv.classList.contains('tree-children')) { childDiv.classList.toggle('collapsed'); childDiv.style.display = childDiv.style.display === 'none' ? 'block' : 'none'; } this.style.transform=this.style.transform.includes('90')?'rotate(0deg)':'rotate(90deg)'">▶</span>`
        : `<span style="display:inline-block;width:14px"></span>`;
      
      let html = `<div class="tree-node" style="padding:4px 8px 4px ${8 + indent}px;cursor:pointer;border-radius:4px;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isActive ? 'background:var(--accent-cyan);background:rgba(0,212,255,0.15);color:var(--accent-cyan);font-weight:600' : 'color:var(--text-secondary)'}" onclick="App.browseTo(${js(node.path)})" title="${esc(node.name)}" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="App.handleDrop(event, ${js(node.path)})">
        ${arrow} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;color:#f59e0b"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${esc(node.name)}
      </div>`;
      
      if (hasChildren) {
        const childrenHtml = node.children.map(c => renderNode(c, depth + 1)).join('');
        html += `<div class="tree-children ${isOpen ? '' : 'collapsed'}" style="${isOpen ? '' : 'display:none'}">${childrenHtml}</div>`;
      }
      return html;
    }
    
    // root item
    const isRootActive = activePath === '';
    let html = `<div class="tree-node" style="padding:4px 8px;cursor:pointer;border-radius:4px;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:6px;${isRootActive ? 'background:rgba(0,212,255,0.15);color:var(--accent-cyan)' : 'color:var(--text-secondary)'}" onclick="App.browseTo('')" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="App.handleDrop(event, '')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Library Root
    </div>`;
    
    html += nodes.map(n => renderNode(n, 0)).join('');
    
    return `<div class="folder-tree-sidebar" style="width:25%;min-width:260px;max-width:500px;resize:horizontal;max-height:calc(100vh - 200px);overflow-y:auto;overflow-x:hidden;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 4px">
      ${html}
    </div>`;
  },

  folderCard(folder) {
    const isSelected = App.selectedBrowsePaths?.includes(folder.path);
    return `<div class="model-card ${isSelected ? 'selected' : ''}" data-path="${this.escapeHtml(folder.path)}" onclick="App.browseTo(${this.jsArg(folder.path)})" style="cursor:pointer" draggable="true" ondragstart="App.handleDragStart(event, ${this.jsArg(folder.path)})" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="App.handleDrop(event, ${this.jsArg(folder.path)})">
      <div class="model-card-checkbox" onclick="event.stopPropagation(); App.toggleBrowseSelection(${this.jsArg(folder.path)})"></div>
      <div class="model-card-thumb">
        ${folder.thumbnails && folder.thumbnails.length > 0 
          ? (folder.thumbnails.length === 1
            ? `<img src="${this.imgSrc(folder.thumbnails[0], 480)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async">`
            : `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:${folder.thumbnails.length > 2 ? '1fr 1fr' : '1fr'};width:100%;height:100%;gap:1px;background:var(--bg-card)">
                ${folder.thumbnails.map((t, i) => `<img src="${this.imgSrc(t, 320)}" style="width:100%;height:100%;object-fit:cover;${folder.thumbnails.length === 3 && i === 2 ? 'grid-column:span 2' : ''}" loading="lazy">`).join('')}
              </div>`)
          : `<div class="model-card-placeholder" style="background:linear-gradient(135deg, hsl(220,50%,22%), hsl(240,40%,16%));display:flex;align-items:center;justify-content:center;color:var(--text-muted);opacity:.5"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>`
        }
      </div>
      <div class="model-card-body">
        <div class="model-card-name">${this.escapeHtml(folder.name)}</div>
        <div class="model-card-meta"><span class="badge badge-stl">${folder.itemCount} items</span></div>
      </div>
    </div>`;
  },

  browseFileCard(file) {
    const is3D = file.type === 'stl' || file.type === '3mf';
    const isGcode = file.type === 'gcode';
    let thumb;
    if (file.thumbnailUrl) {
      thumb = `<img src="${this.imgSrc(file.thumbnailUrl, 480)}" alt="${this.escapeHtml(file.name)}" loading="lazy" decoding="async">`;
    } else if (is3D) {
      // Rendered when the card comes into view and stored as the file's preview (viewer.js)
      thumb = `<div class="model-card-placeholder stl-thumb-target" data-stl-url="${this.escapeHtml(file.url)}"${file.id ? ` data-file-id="${file.id}"` : ''} data-size="${Number(file.size) || 0}" style="background:${this.gradient(file.name)};display:flex;align-items:center;justify-content:center"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.4"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;
    } else if (file.type === 'image') {
      thumb = `<img src="${this.imgSrc(file.url, 480)}" alt="${this.escapeHtml(file.name)}" loading="lazy" decoding="async">`;
    } else if (isGcode) {
      thumb = `<div class="model-card-placeholder" style="background:linear-gradient(135deg, #78350f, #b45309);color:#fbbf24;display:flex;align-items:center;justify-content:center"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.6"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></div>`;
    } else {
      thumb = `<div class="model-card-placeholder" style="background:${this.gradient(file.name)};display:flex;align-items:center;justify-content:center"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.4"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;
    }
    
    const folderLabel = file.folderPath ? `<div style="font-size:0.65rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;display:flex;align-items:center;gap:3px" title="${this.escapeHtml(file.folderPath)}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#f59e0b"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${this.escapeHtml(file.folderPath)}</div>` : '';
    const itemPath = `${file.folderPath ? file.folderPath+'/' : ''}${file.name}`;
    const isSelected = App.selectedBrowsePaths?.includes(itemPath);
    
    // Metadata summary chips
    let metaChips = '';
    if (file.metadata) {
      const chips = [];
      if (file.metadata.printTime) chips.push(`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${this.escapeHtml(file.metadata.printTime)}`);
      if (file.metadata.filamentType) chips.push(`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>${this.escapeHtml(file.metadata.filamentType)}`);
      if (file.metadata.tempNozzle) chips.push(`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>${this.escapeHtml(file.metadata.tempNozzle)}°C`);
      if (chips.length) {
        metaChips = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${chips.map(c => `<span style="font-size:0.65rem;background:var(--bg-input);padding:1px 5px;border-radius:4px;color:var(--text-secondary);border:1px solid var(--border)">${c}</span>`).join('')}</div>`;
      }
    }

    const clickData = encodeURIComponent(JSON.stringify(file));
    const clickHandler = `onclick="App.openBrowseFileModal(${this.jsArg(clickData)})" style="cursor:pointer"`;

    const canBrowseManage = App.currentUser?.role === 'admin';
    const browseCheckboxHtml = canBrowseManage ? `<div class="model-card-checkbox" onclick="event.stopPropagation(); App.toggleBrowseSelection(${this.jsArg(itemPath)})"></div>` : '';

    return `<div class="model-card ${isSelected ? 'selected' : ''}" data-path="${this.escapeHtml(itemPath)}" draggable="true" ondragstart="App.handleDragStart(event, ${this.jsArg(itemPath)})" ${clickHandler}>
      ${browseCheckboxHtml}
      <div class="model-card-thumb">${thumb}<div class="model-card-badges"><span class="badge badge-${file.ext || file.type}">${file.ext || file.type}</span></div></div>
      <div class="model-card-body">
        <div class="model-card-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
        <div class="model-card-body-badges"><span class="badge badge-${file.ext || file.type}">${file.ext || file.type}</span></div>
        ${folderLabel}
        <div class="model-card-meta" style="font-size:.75rem;color:var(--text-muted)">${this.formatSize(file.size)}</div>
        ${metaChips}
      </div>
    </div>`;
  },

  // ── Model Card ──
  modelCard(m) {
    let thumb;
    if (m.thumbnail) {
      const thumbUrl = m.thumbnail.startsWith('/') ? m.thumbnail : `/uploads/${m.thumbnail}`;
      thumb = `<img src="${this.imgSrc(thumbUrl, 480)}" alt="${this.escapeHtml(m.name)}" loading="lazy" decoding="async">`;
    } else if (m.stl_file) {
      const stlUrl = m.stl_file.startsWith('/') ? m.stl_file : `/uploads/${m.stl_file}`;
      thumb = `<div class="model-card-placeholder stl-thumb-target" data-stl-url="${this.escapeHtml(stlUrl)}" style="background:${this.gradient(m.name)};display:flex;align-items:center;justify-content:center"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.35"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;
    } else {
      thumb = `<div class="model-card-placeholder" style="background:${this.gradient(m.name)};display:flex;align-items:center;justify-content:center"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.35"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>`;
    }
    const types = (m.file_types || []).filter(t => t !== 'image').map(t =>
      `<span class="badge badge-${t}" style="cursor:pointer" onclick="event.stopPropagation();App.setFormatFilter('${t.toLowerCase()}')" title="Filter by ${t.toUpperCase()}">${t}</span>`
    ).join('');
    const printed = m.has_printed
      ? '<span class="badge badge-printed">✓ Printed</span>'
      : '<span class="badge badge-not-printed">Not printed</span>';
    const cat = m.category_name
      ? `<span class="badge badge-category" style="background:${this.escapeHtml(m.category_color)}20;color:${this.escapeHtml(m.category_color)};border:1px solid ${this.escapeHtml(m.category_color)}33;cursor:pointer" onclick="event.stopPropagation();App.navigate('/models?category=${m.category_id}')" title="Filter by category: ${this.escapeHtml(m.category_name)}">${this.escapeHtml(m.category_name)}</span>`
      : '';
    const canManage = App.currentUser && App.currentUser.role !== 'viewer';
    const canEdit = App.currentUser?.role === 'admin' || (canManage && m.user_id === App.currentUser?.id);
    const plusBtn = canEdit ? `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();App.addToProject(${m.id})" title="Add to project" style="margin-top:-4px;margin-right:-8px;padding:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>` : '';

    const isSelected = App.selectedModelIds?.includes(m.id);
    const checkboxHtml = canManage ? `<div class="model-card-checkbox" onclick="App.toggleModelSelection(event, ${m.id})"></div>` : '';

    const protectedBadge = m.is_protected ? '<span class="badge badge-protected" title="Password protected"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Protected</span>' : '';
    // A saved configuration of a kit: no files of its own, its parts are the archive's
    const kitBadge = m.kit_source_id ? '<span class="badge badge-kit" title="A saved configuration of a kit">Configuration</span>' : '';
    // Prints of a configuration or of a parts list
    const p = m.kit_progress;
    const progress = p && p.total ? `${p.done >= p.total ? '✓ ' : ''}${p.done}/${p.total} printed` : '';
    return `<div class="model-card ${isSelected ? 'selected' : ''}${m.is_protected ? ' is-protected' : ''}" onclick="App.handleModelCardClick(event, ${m.id})" data-model-id="${m.id}">
      ${checkboxHtml}
      <div class="model-card-thumb">${thumb}<div class="model-card-badges">${protectedBadge}${kitBadge}${types}</div></div>
      <div class="model-card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div class="model-card-name" style="flex:1">${this.escapeHtml(m.name)}</div>
          ${plusBtn}
        </div>
        <div class="model-card-meta">${cat} ${printed} ${this.fitBadge(m)}</div>
        ${(protectedBadge || kitBadge || types) ? `<div class="model-card-body-badges">${protectedBadge}${kitBadge}${types}</div>` : ''}
      </div>
      <div class="model-card-footer">
        <span style="font-size:.75rem;color:var(--text-muted)">${progress || (m.kit_source_id ? 'Configuration' : `${m.file_count || 0} files`)}</span>
        <span style="font-size:.75rem;color:var(--text-muted)">${this.formatDate(m.updated_at)}</span>
      </div>
    </div>`;
  },

  // The fit badge of a model card: do its 3D files fit the printer chosen in the top bar?
  // Whether a model's 3D files fit the default printer (top bar); when they do not, whether
  // another of my printers takes them
  fitBadge(m) {
    const fit = m.fit;
    if (!fit || !fit.total) return '';
    const beds = App.printerBeds || [];
    const chosen = App.fitPrinterId();
    const bed = beds.find(b => b.id === chosen);
    const name = this.escapeHtml(bed ? bed.name : 'any of your printers');
    const misfit = (fit.misfit && fit.misfit[bed ? bed.id : 'any']) || 0;
    if (misfit) {
      const whole = beds.filter(b => b.id !== chosen && fit.misfit && fit.misfit[b.id] === 0);
      if (bed && whole.length) {
        return `<span class="badge badge-fit is-other" title="${misfit} of ${fit.total} 3D files are too big for ${name}; everything fits ${this.escapeHtml(whole.map(b => b.name).join(', '))}">⚠ ${this.escapeHtml(whole[0].name)}</span>`;
      }
      if (bed && fit.misfit && fit.misfit.any === 0) {
        return `<span class="badge badge-fit is-other" title="${misfit} of ${fit.total} 3D files are too big for ${name}; each of them fits one of your other printers">⚠ Other printers</span>`;
      }
      return `<span class="badge badge-fit is-bad" title="${misfit} of ${fit.total} 3D files are too big for ${name}">✗ ${misfit} too big</span>`;
    }
    if (fit.pending) return '<span class="badge badge-fit" title="The 3D files are being measured">Measuring</span>';
    if (fit.total === fit.failed) return '';
    return `<span class="badge badge-fit is-ok" title="Every 3D file fits ${name}">✓ Fits</span>`;
  },

  bulkActionBar(count) {
    return `
      <div class="bulk-action-bar ${count > 0 ? 'active' : ''}">
        <div class="bulk-count">${count} items selected</div>
        <div class="bulk-actions">
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkTag()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>Tag</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkMove()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Category</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkProtect()" title="Password protection" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Protect</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkAddToCollection()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>Collection</button>
          <button class="btn btn-danger btn-sm" onclick="App.openBulkDelete()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>
          <button class="btn btn-ghost btn-sm" onclick="App.clearSelection()">✕ Clear</button>
        </div>
      </div>`;
  },

  bulkBrowseActionBar(count, isAllSelected) {
    return `
      <div class="bulk-action-bar ${count > 0 ? 'active' : ''}">
        <div class="bulk-count">${count} items selected</div>
        <div class="bulk-actions">
          <button class="btn btn-secondary btn-sm" onclick="App.toggleBrowseSelectAll()">${isAllSelected ? '✕ Deselect All' : '✓ Select All'}</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkBrowseMove()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Move</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkBrowseTag()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>Tag</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openBulkBrowseCategory()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Category</button>
          <button class="btn btn-danger btn-sm" onclick="App.openBulkBrowseDelete()" style="display:inline-flex;align-items:center;gap:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>
          <button class="btn btn-ghost btn-sm" onclick="App.clearBrowseSelection()">✕ Clear</button>
        </div>
      </div>`;
  },

  // What "Delete" means since the Trash: nothing is removed from disk right away
  trashNote() {
    const days = (App.trashRetentionDays === undefined || App.trashRetentionDays === null) ? 30 : Number(App.trashRetentionDays);
    const when = days > 0 ? `After ${days} day${days === 1 ? '' : 's'} they are deleted from disk for good.` : 'They stay there until you empty the Trash.';
    return `<div class="trash-note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      <span>The files move to the <a href="#/trash" onclick="App.closeModal()">Trash</a>, where you can preview and restore them. ${when}</span>
    </div>`;
  },

  bulkDeleteForm(count) {
    return `
      <form id="bulk-delete-form" onsubmit="App.handleBulkDelete(event)">
        <div style="margin-bottom: 16px; color: var(--text-secondary)">
          Delete <strong>${count} models</strong>?
        </div>
        ${this.trashNote()}
        <div class="form-actions" style="margin-top: 24px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-danger">Delete ${count} Models</button>
        </div>
      </form>`;
  },

  bulkMoveForm(categories = [], count = 0) {
    if (!categories || categories.length === 0) {
      return `
        <div style="text-align:center;padding:24px 10px;color:var(--text-muted)">
          <div style="font-size:1.5rem;margin-bottom:8px">📁</div>
          <p style="font-size:.9rem;margin-bottom:14px">No categories found in the system.</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">Close</button>
        </div>`;
    }
    const options = categories.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
    return `
      <form onsubmit="App.handleBulkMove(event)">
        <div style="margin-bottom:16px;color:var(--text-secondary);font-size:0.9rem">
          Select a category to assign to the <strong>${count || App.selectedModelIds?.length || 0} selected models</strong>:
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-select" name="category_id">
            <option value="">(None / Remove Category)</option>
            ${options}
          </select>
        </div>
        <div class="form-actions" style="margin-top:20px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Assign Category</button>
        </div>
      </form>`;
  },

  bulkBrowseCategoryForm(categories = [], count = 0) {
    if (!categories || categories.length === 0) {
      return `
        <div style="text-align:center;padding:24px 10px;color:var(--text-muted)">
          <div style="font-size:1.5rem;margin-bottom:8px">📁</div>
          <p style="font-size:.9rem;margin-bottom:14px">No categories found in the system.</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.closeModal()">Close</button>
        </div>`;
    }
    const options = categories.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
    return `
      <form onsubmit="App.handleBulkBrowseCategorySubmit(event)">
        <div style="margin-bottom:16px;color:var(--text-secondary);font-size:0.9rem">
          Select a category to assign to models within the <strong>${count || App.selectedBrowsePaths?.length || 0} selected items</strong>:
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-select" name="category_id">
            <option value="">(None / Remove Category)</option>
            ${options}
          </select>
        </div>
        <div class="form-actions" style="margin-top:20px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Assign Category</button>
        </div>
      </form>`;
  },

  bulkCollectionForm(projects = []) {
    const options = projects.map(p => `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`).join('');
    return `
      <form onsubmit="App.handleBulkAddToCollectionSubmit(event)">
        <div class="form-group">
          <label class="form-label">Select Collection</label>
          <select class="form-select" name="project_id">
            ${options}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add to Collection</button>
        </div>
      </form>`;
  },

  collectionSelectForm(projects = [], selectedIds = [], modelId = null) {
    if (!projects || projects.length === 0) {
      return `
        <div style="text-align:center;padding:24px 10px;color:var(--text-muted)">
          <div style="font-size:1.5rem;margin-bottom:8px">📁</div>
          <p style="font-size:.9rem;margin-bottom:14px">No collections found.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick="App.closeModal();App.showCreateProject()">Create Collection</button>
        </div>`;
    }

    const items = projects.map(p => {
      const isChecked = selectedIds.includes(p.id) ? 'checked' : '';
      return `
        <label class="collection-checkbox-item" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;cursor:pointer;user-select:none;transition:background 0.15s ease;">
          <input type="checkbox" name="project_ids" value="${p.id}" ${isChecked} style="accent-color:var(--accent-primary);width:16px;height:16px;cursor:pointer;">
          <span style="font-weight:500;font-size:.88rem;color:var(--text-primary);flex:1">${this.escapeHtml(p.name)}</span>
          ${p.visibility === 'private' ? '<span style="font-size:.7rem;color:var(--text-muted);background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;border:1px solid var(--border)">🔒 Private</span>' : ''}
        </label>
      `;
    }).join('');

    return `
      <form onsubmit="App.handleCollectionSelectionSubmit(event, ${modelId ? Number(modelId) : 'null'})">
        <div style="margin-bottom:12px">
          <input type="text" class="form-input" placeholder="Search collections..." oninput="App.filterCollectionList(this.value)" style="width:100%;font-size:.85rem;padding:8px 12px">
        </div>
        <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-bottom:18px;border:1px solid var(--border);border-radius:8px;padding:6px;background:var(--bg-secondary)">
          ${items}
        </div>
        <div class="form-actions" style="display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Collections</button>
        </div>
      </form>`;
  },


  bulkBrowseMoveForm() {
    return `
      <form onsubmit="App.handleBulkBrowseMoveSubmit(event)">
        <div class="form-group">
          <label class="form-label">Destination Path</label>
          <input type="text" class="form-input" name="target_path" placeholder="e.g. /3dprints/toys" required>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Move Items</button>
        </div>
      </form>`;
  },

  bulkBrowseDeleteForm(count) {
    return `
      <form onsubmit="App.handleBulkBrowseDeleteSubmit(event)">
        <div style="margin-bottom: 16px; color: var(--text-secondary)">
          Delete <strong>${count} items</strong>?
        </div>
        ${this.trashNote()}
        <div class="form-actions" style="margin-top: 24px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-danger">Delete ${count} Items</button>
        </div>
      </form>`;
  },

  bulkBrowseTagForm(tags = []) {
    const tagCheckboxes = tags.map(t =>
      `<label class="tag-pill-checkbox">
        <input type="checkbox" name="tags" value="${this.escapeHtml(t.name)}">
        <span class="tag-pill">${this.escapeHtml(t.name)}</span>
      </label>`
    ).join('');

    return `
      <form onsubmit="App.handleBulkBrowseTagSubmit(event)">
        <div class="form-group">
          <label class="form-label">Tags</label>
          <div id="bulk-browse-tags-container" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            ${tagCheckboxes}
          </div>
          <div class="add-inline" style="max-width:250px;margin-top:4px">
            <input type="text" id="new-bulk-tag-input" class="form-input" placeholder="Add new tag (comma separated)...">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Tag Items</button>
        </div>
      </form>`;
  },

  bulkTagForm(tags = []) {
    const tagCheckboxes = tags.map(t =>
      `<label class="tag-pill-checkbox">
        <input type="checkbox" name="tags" value="${this.escapeHtml(t.name)}">
        <span class="tag-pill">${this.escapeHtml(t.name)}</span>
      </label>`
    ).join('');

    return `
      <form onsubmit="App.handleBulkTagSubmit(event)">
        <div class="form-group">
          <label class="form-label">Tags</label>
          <div id="bulk-tags-container" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            ${tagCheckboxes}
          </div>
          <div class="add-inline" style="max-width:250px;margin-top:4px">
            <input type="text" id="new-bulk-tag-input" class="form-input" placeholder="Add new tag (comma separated)...">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Tag Models</button>
        </div>
      </form>`;
  },

  // opts.kit: the kit configurator of the model's files ('ussa-vault'), shown as the first view
  // instead of the file list; opts.view 'configure' or 'files'
  modelDetail(model, hasPrinters = false, opts = {}) {
    // A model in the Trash is shown read-only, with Restore / Delete permanently
    const inTrash = Boolean(model.deleted_at);
    // A saved configuration of a kit (opts.kitConfig): its own page, the configurator with the
    // archive's files; no files of its own
    const isConfig = Boolean(opts.kitConfig);
    const configure = isConfig || (Boolean(opts.kit) && opts.view === 'configure');
    const viewSwitch = opts.kit && !isConfig ? `
      <div class="detail-views" role="tablist">
        <a href="#/models/${model.id}" role="tab" class="detail-view-tab${configure ? ' is-active' : ''}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="6" rx="1"/><rect x="4" y="11" width="7" height="5" rx="1"/><rect x="13" y="11" width="7" height="5" rx="1"/><rect x="4" y="18" width="16" height="3" rx="1"/></svg>Configurator</a>
        <a href="#/models/${model.id}?view=files" role="tab" class="detail-view-tab${configure ? '' : ' is-active'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>Files (${(model.files || []).length})</a>
      </div>` : '';
    const canEdit = !inTrash && (App.currentUser?.role === 'admin' || (App.currentUser?.role !== 'viewer' && model.user_id === App.currentUser?.id));
    // A read-only project (the VAULT archive): its files are never changed, renamed or deleted
    const readOnly = Number(model.is_readonly) === 1;
    const canChange = canEdit && !readOnly;
    // The Parts tab: what to print and the hardware (a list in the database, read-only projects too)
    const partsShown = !inTrash && !isConfig && (canEdit || Boolean(this.partsListOf(model)));
    const partsLabel = model.kit_progress && model.kit_progress.total ? ` (${model.kit_progress.done}/${model.kit_progress.total})` : '';
    // Files of a project in the library can be renamed / moved on disk ('folder' projects also
    // have folders); uploads outside the library and entries inside archives can only be deleted
    const layout = model.layout || 'none';
    const onDisk = (f) => layout !== 'none' && Boolean(f.library_path) && !f.is_archive_entry && !String(f.library_path).includes('::');
    const cat = model.category_name
      ? `<span class="badge badge-category" style="background:${this.escapeHtml(model.category_color)}20;color:${this.escapeHtml(model.category_color)};border:1px solid ${this.escapeHtml(model.category_color)}33">${this.escapeHtml(model.category_name)}</span>`
      : '';
    const tags = (model.tags || []).map(t => `<span class="badge badge-tag" style="cursor:pointer" onclick="App.navigate('/models?tag=${t.id}')" title="Filter by tag: ${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</span>`).join('');
    const printed = model.has_printed
      ? '<span class="badge badge-printed">✓ Printed</span>'
      : '<span class="badge badge-not-printed">Not printed</span>';
    const cleanSourceUrl = this.safeUrl(model.source_url);
    const sourceLink = cleanSourceUrl
      ? `<a href="${this.escapeHtml(cleanSourceUrl)}" target="_blank" rel="noopener noreferrer" class="badge badge-category" style="background:var(--bg-tertiary);color:var(--accent-cyan);text-decoration:none;border:1px solid var(--border)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Source</a>`
      : '';

    // A README in the project folder is shown in the description section
    const readme = this.readmeFile(model);
    // File shown in the preview area when the page opens (3D model, image, video, document)
    const stlFile = this.defaultPreviewFile(model);
    let viewerHtml;

    if (stlFile) {
      viewerHtml = `
      <div class="glass-panel detail-viewer-panel" style="overflow:visible">
        <div class="panel-header">
          <div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg><span class="detail-viewer-title">3D Studio</span></div>
        </div>
        <div class="panel-body no-pad">
          <div class="viewer-container" id="stl-viewer-${model.id}" data-stl-url="${this.escapeHtml(stlFile.url || '/uploads/'+stlFile.filename)}" data-fallback-thumbnail="${this.escapeHtml(model.thumbnail_url || '')}">
            <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">Loading 3D preview...</div>
          </div>
          <div class="detail-viewer-hint" style="padding:12px 16px;font-size:.7rem;color:var(--text-muted);border-top:1px solid var(--border);background:rgba(0,0,0,0.1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Drag to rotate · Scroll to zoom · Right-click to pan
          </div>
        </div>
      </div>`;
    } else if (model.thumbnail_url) {
      viewerHtml = `
      <div class="glass-panel detail-viewer-panel" style="overflow:hidden">
        <div class="panel-header">
          <div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Model Preview</div>
        </div>
        <div class="panel-body no-pad detail-thumb-body" style="height:400px;background:var(--bg-dark);display:flex;align-items:center;justify-content:center">
          <img src="${this.escapeHtml(model.thumbnail_url)}" style="max-width:100%;max-height:100%;object-fit:contain">
        </div>
      </div>`;
    } else {
      viewerHtml = `
      <div class="glass-panel detail-viewer-panel" style="overflow:visible">
        <div class="panel-header">
          <div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>3D Studio</div>
        </div>
        <div class="panel-body">
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:350px;color:var(--text-muted);text-align:center">
            <div style="margin-bottom:16px;opacity:.25;color:var(--text-muted)"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>
            <div style="font-size:1.1rem;font-weight:600;color:var(--text-secondary)">No 3D Preview Available</div>
            <div style="font-size:.85rem;margin-top:6px;max-width:280px">Upload an STL or 3MF file to this model to enable the interactive 3D viewer.</div>
          </div>
        </div>
      </div>`;
    }

    const gcodeFiles = (model.files || []).filter(f => f.file_type === 'gcode');
    let gcodeHtml = '';
    if (gcodeFiles.length > 0) {
      gcodeHtml = `
        <div class="glass-panel" style="margin-bottom:16px; border: 1px solid var(--accent-cyan); box-shadow: 0 0 10px rgba(0, 212, 255, 0.1);">
          <div class="panel-header">
            <div class="panel-title" style="color:var(--accent-cyan)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>G-Code Profiles</div>
          </div>
          <div class="panel-body no-pad">
            ${gcodeFiles.map(f => {
              // Values from the file's own text: escaped once for the whole panel
              const raw = typeof f.metadata === 'string' ? JSON.parse(f.metadata) : f.metadata || {};
              const meta = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? this.escapeHtml(v) : v]));
              return `
              <div style="padding:16px; border-bottom:1px solid var(--border)">
                <div style="font-weight:600; margin-bottom:10px; word-break:break-all; font-size: 0.9rem;">${this.escapeHtml(f.original_name || f.filename)}</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.85rem;">
                  <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                    <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Est. Time</div>
                    <div style="font-weight:600">${meta.printTime || 'Unknown'}</div>
                  </div>
                  <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                    <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Weight</div>
                    <div style="font-weight:600">${meta.weight ? meta.weight + 'g' : 'Unknown'}</div>
                  </div>
                  <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                    <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Material</div>
                    <div style="font-weight:600">${meta.filamentType || 'Unknown'}</div>
                  </div>
                  <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                    <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Layer Height</div>
                    <div style="font-weight:600">${meta.layerHeight ? meta.layerHeight + 'mm' : 'Unknown'}</div>
                  </div>
                  
                  ${(meta.infill || meta.infillPattern || meta.tempNozzle || meta.tempBed || meta.supports !== undefined || meta.slicer || meta.printerModel || meta.wallLoops || meta.topBottomLayers || meta.filamentCost || meta.maxVolumetricSpeed) ? `
                  <div id="gcode-extra-${f.id}" style="display:none; grid-column: span 2; margin-top:4px;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.85rem;">
                      ${meta.infill || meta.infillPattern ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Infill</div>
                        <div style="font-weight:600">${meta.infill ? meta.infill + (!String(meta.infill).endsWith('%') ? '%' : '') : ''} ${meta.infillPattern ? '(' + meta.infillPattern + ')' : ''}</div>
                      </div>` : ''}
                      ${meta.wallLoops || meta.topBottomLayers ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Walls & Layers</div>
                        <div style="font-weight:600">${meta.wallLoops ? meta.wallLoops + ' Walls' : ''} ${meta.topBottomLayers ? (meta.wallLoops ? ' / ' : '') + meta.topBottomLayers + ' Top/Bot' : ''}</div>
                      </div>` : ''}
                      ${meta.tempNozzle ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Nozzle Temp</div>
                        <div style="font-weight:600">${meta.tempNozzle}</div>
                      </div>` : ''}
                      ${meta.tempBed ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Bed Temp</div>
                        <div style="font-weight:600">${meta.tempBed}</div>
                      </div>` : ''}
                      ${meta.supports !== undefined ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Supports</div>
                        <div style="font-weight:600">${meta.supports === '1' || meta.supports === 1 || meta.supports === 'true' ? 'Yes' : 'No'}</div>
                      </div>` : ''}
                      ${meta.maxVolumetricSpeed ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Max Vol. Speed</div>
                        <div style="font-weight:600">${meta.maxVolumetricSpeed} mm³/s</div>
                      </div>` : ''}
                      ${meta.filamentCost ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Print Cost</div>
                        <div style="font-weight:600">${meta.filamentCost}</div>
                      </div>` : ''}
                      ${meta.slicer ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Slicer</div>
                        <div style="font-weight:600">${meta.slicer}</div>
                      </div>` : ''}
                      ${meta.printerModel ? `
                      <div style="background:var(--bg-input); padding:8px; border-radius:var(--radius-sm)">
                        <div style="color:var(--text-muted); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.05em">Printer</div>
                        <div style="font-weight:600">${meta.printerModel}</div>
                      </div>` : ''}
                    </div>
                  </div>
                  <div style="grid-column: span 2; text-align:center; margin-top:4px;">
                    <button class="btn btn-ghost btn-xs" style="color:var(--text-muted)" onclick="const el = document.getElementById('gcode-extra-${f.id}'); const isHidden = el.style.display === 'none'; el.style.display = isHidden ? 'block' : 'none'; this.innerText = isHidden ? 'Hide Details' : 'Show More Details';">Show More Details</button>
                  </div>
                  ` : ''}
                </div>
                <div style="margin-top:12px; display:flex; gap:8px">
                  <button class="btn btn-ghost btn-sm" style="color:var(--accent-cyan);border:1px solid rgba(0,212,255,0.4);" onclick="App.previewFile(${model.id}, ${f.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Preview G-Code</button>
                  ${hasPrinters ? `<button class="btn btn-primary btn-sm" style="flex:1" onclick="App.sendToPrinter(${f.id})">Send to Printer</button>` : ''}
                  <a href="/api/files/${f.id}/download/${encodeURIComponent(f.filename)}" class="btn btn-secondary btn-sm" download>Download</a>
                </div>
              </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    const renderFileCard = (f, displayName = f.original_name) => {
      let metaHtml = '';
      const isPreview = Boolean(f.is_preview || f.id === model.preview_file_id);
      const is3D = ['stl', '3mf', 'step', 'obj'].includes(f.file_type);
      const isImage = f.file_type === 'image';
      const isGcode = f.file_type === 'gcode' || f.file_type === 'bgcode';
      const canBePreview = is3D || isImage;

      // A file of a read-only project with saved slicer projects opens a chooser: the original
      // or one of the versions
      const slicerBtnHtml = !is3D ? '' : this.slicerButton(this.slicerLinks(f, model.id),
        { onclick: readOnly && f.version_count ? `App.openSlicerChooser(${model.id}, ${f.id})` : null, versions: readOnly ? f.version_count : 0 });

      const hasBottomBar = (canEdit && !isPreview && canBePreview) || is3D;
      // Rows of files the preview area can show open there when clicked anywhere on the row;
      // other files are listed for information only
      const canOpen = Boolean(this.previewKind(f)) || f === readme;
      const openAttrs = canOpen
        ? ` data-file-id="${f.id}" role="button" tabindex="0" title="Show in preview" onclick="App.previewFile(${model.id}, ${f.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.previewFile(${model.id}, ${f.id})}"`
        : ` data-file-id="${f.id}" title="No preview for this file type"`;
      const iconType = this.fileIconType(f);
      // The history of a read-only file holds slicer projects: shown in the slicer chooser
      const historyItem = !f.version_count ? []
        : [{ action: readOnly ? 'showSlicerVersions' : 'showFileHistory', icon: 'history', label: `${readOnly ? 'Slicer versions' : 'History'} (${f.version_count})` }];
      const menuItems = !canChange ? historyItem : onDisk(f)
        ? [
          ...historyItem,
          { action: 'renameEntry', icon: 'rename', label: 'Rename' },
          ...(layout === 'folder' ? [{ action: 'moveEntry', icon: 'move', label: 'Move to...' }] : []),
          { action: 'deleteEntry', icon: 'delete', label: 'Delete', danger: true }
        ]
        : [{ action: 'deleteEntry', icon: 'delete', label: 'Delete', danger: true }];

      return `
      <div class="file-item-card${canOpen ? ' is-openable' : ' is-info'}"${openAttrs} data-entry-path="${this.escapeHtml(f.original_name || f.filename || '')}" data-entry-kind="file" data-entry-disk="${onDisk(f) ? 1 : 0}" style="padding:10px 14px;border-bottom:1px solid var(--border);transition:background var(--transition)">
        <!-- Top Row: Icon, File Details, Quick Action Buttons -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
            ${this.fileTypeIcon(iconType)}
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span class="file-name" style="font-weight:600;font-size:0.85rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%" title="${this.escapeHtml(f.original_name)}">${this.escapeHtml(displayName)}</span>
                ${isPreview ? `<span class="badge badge-primary badge-xs" style="font-size:0.65rem;padding:2px 6px;background:rgba(0,212,255,0.15);color:var(--accent-cyan);border:1px solid rgba(0,212,255,0.3);display:inline-flex;align-items:center;gap:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${isImage ? 'Cover Image' : 'Primary 3D'}</span>` : ''}
              </div>
              <div class="file-meta" style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px">
                <span>${this.formatSize(f.file_size)}</span>
                ${this.MEASURABLE.includes(f.file_type) ? `<span class="fit-dim" data-dim-file="${Number(f.id)}"></span>` : ''}
                <span>·</span>
                <span>${this.formatDateShort(f.uploaded_at)}</span>
                <span>·</span>
                <span style="display:inline-flex;align-items:center;gap:3px">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;opacity:0.8"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
                  ${this.escapeHtml(f.uploader_name || 'System')}
                </span>
              </div>
            </div>
          </div>
          <!-- Quick Actions: 3D Preview Eye, Download, Delete -->
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
            <a href="/api/files/${f.id}/download" class="file-action-btn" title="Download file" onclick="event.stopPropagation()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
            ${this.entryMenu(menuItems)}
          </div>
        </div>

        <!-- Optional Bottom Action Bar (Slicer / Set Preview / Set Cover) -->
        ${hasBottomBar ? `
        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(255,255,255,0.06);flex-wrap:wrap;cursor:default">
          ${(canEdit && !isPreview && canBePreview) ? `<button class="btn btn-ghost btn-xs" style="color:var(--text-secondary);font-size:0.7rem;border:1px solid var(--border);padding:3px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px;transition:all var(--transition)" onclick="event.stopPropagation();App.setPreviewFile(${model.id}, ${f.id})" title="${isImage ? 'Set this image as model cover thumbnail' : 'Use this file as model 3D preview'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${isImage ? 'Set as Cover' : 'Set as Preview'}</button>` : ''}
          ${slicerBtnHtml}
        </div>` : ''}
      </div>`;
    };
    // Files: every file of the project; Documentation: only the text documents (PDF, TXT, MD).
    // Both keep the folder structure and open the clicked file in the preview area.
    const folderActions = (canChange && layout === 'folder') ? () => this.entryMenu([
      { action: 'newFolder', icon: 'folder', label: 'New folder inside' },
      { action: 'renameEntry', icon: 'rename', label: 'Rename' },
      { action: 'moveEntry', icon: 'move', label: 'Move to...' },
      { action: 'deleteEntry', icon: 'delete', label: 'Delete', danger: true }
    ]) : null;
    const filesHtml = this.fileTree(model.files || [], renderFileCard, { folders: model.folders || [], folderActions });
    const docFiles = (model.files || []).filter(f => f.file_type === 'document');
    const docsHtml = docFiles.length ? this.fileTree(docFiles, renderFileCard) : '';

    // Trash tab: files of this model in the Trash, with preview, Restore and Delete permanently
    const retention = model.trash_retention_days;
    const renderTrashCard = (f, displayName = f.original_name) => {
      const canOpen = Boolean(this.previewKind(f));
      const openAttrs = canOpen
        ? ` role="button" tabindex="0" title="Show in preview" onclick="App.previewFile(${model.id}, ${f.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.previewFile(${model.id}, ${f.id})}"`
        : ' title="No preview for this file type"';
      return `
      <div class="file-item-card is-trashed${canOpen ? ' is-openable' : ' is-info'}" data-file-id="${f.id}"${openAttrs}>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
            ${this.fileTypeIcon(this.fileIconType(f))}
            <div style="min-width:0;flex:1">
              <span class="file-name" title="${this.escapeHtml(f.original_name)}">${this.escapeHtml(displayName)}</span>
              <div class="file-meta">
                <span>${this.formatSize(f.file_size)}</span><span>·</span>
                <span>Deleted ${this.formatDateShort(this.sqlDate(f.deleted_at))}</span><span>·</span>
                <span class="trash-countdown">${this.trashCountdown(f.deleted_at, retention)}</span>
              </div>
            </div>
          </div>
          ${inTrash ? '' : `
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
            <button type="button" class="file-action-btn restore" title="Restore" onclick="event.stopPropagation();App.restoreTrashItems([], [${f.id}])"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
            <button type="button" class="file-action-btn delete" title="Delete permanently" onclick="event.stopPropagation();App.purgeTrashItems([], [${f.id}])"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>`}
        </div>
      </div>`;
    };
    const trashFiles = model.trash_files || [];
    const trashHtml = trashFiles.length ? this.fileTree(trashFiles, renderTrashCard) : '';
    const trashBanner = inTrash ? `
      <div class="trash-banner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>This model is in the Trash since ${this.formatDate(this.sqlDate(model.deleted_at))} · ${this.trashCountdown(model.deleted_at, retention)}</span>
        <span class="trash-banner-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.restoreTrashItems([${model.id}], [])">Restore</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="App.purgeTrashItems([${model.id}], [])">Delete permanently</button>
        </span>
      </div>` : '';

    const breadcrumbs = `
      <div class="breadcrumbs">
        <a href="#/models">Library</a>
        <span>/</span>
        ${model.category_id ? `<a href="#/models?category=${model.category_id}">${this.escapeHtml(model.category_name)}</a><span>/</span>` : ''}
        ${isConfig && model.kit_source ? `<a href="#/models/${Number(model.kit_source.id)}">${this.escapeHtml(model.kit_source.name)}</a><span>/</span>` : ''}
        <span class="current">${this.escapeHtml(model.name)}</span>
      </div>
    `;

    return `
      <div class="detail-page${inTrash ? ' is-in-trash' : ''}">
      ${inTrash ? `<div class="breadcrumbs"><a href="#/trash">Trash</a><span>/</span><span class="current">${this.escapeHtml(model.name)}</span></div>` : breadcrumbs}
      ${trashBanner}
      <div class="detail-header">
        <div>
          <div class="detail-title">${this.escapeHtml(model.name)}</div>
          <div class="detail-meta">${model.is_protected ? '<span class="badge badge-protected"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Protected</span>' : ''} ${readOnly ? '<span class="badge badge-readonly" title="Read-only: 3DLib never changes, renames or deletes its files. Slicer saves become versions of a file.">Read-only</span>' : ''} ${isConfig ? `<span class="badge badge-kit" title="A saved configuration of ${this.escapeHtml(model.kit_source ? model.kit_source.name : 'a kit')}">Configuration</span>` : ''} ${cat} ${printed}</div>
        </div>
        <div class="detail-actions">
          ${(App.currentUser && !inTrash && !isConfig && model.files && model.files.length > 0) ? `
          <a href="/api/models/${model.id}/download" class="btn btn-secondary btn-sm" download title="Download all files as .zip" style="display:inline-flex;align-items:center;gap:5px;text-decoration:none;white-space:nowrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download All (.zip)
          </a>` : ''}
          ${canEdit ? `
          ${isConfig ? '' : `<button class="btn btn-secondary btn-sm" onclick="App.showShareModal(${model.id})" title="Share Model">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
          </button>`}
          <button class="btn btn-secondary btn-sm" onclick="App.addToProject(${model.id})" title="Add to Collection">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Collection
          </button>
          ${isConfig ? '' : `<button class="btn btn-secondary btn-sm" onclick="App.showCreateVersion(${model.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Version
          </button>`}
          ` : ''}
          ${isConfig && canEdit ? `
          <button type="button" class="btn btn-primary btn-sm" id="kit-edit-btn" onclick="App.kitEditConfig()"${opts.edit ? ' hidden' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Edit configuration
          </button>` : ''}
          ${App.currentUser ? `
          <button class="btn btn-secondary btn-sm" onclick="App.showPrintHistory(${model.id})" title="Print history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print History${(model.prints || []).length ? ` (${model.prints.length})` : ''}
          </button>
          ` : ''}
          ${canEdit ? `
          <button class="btn btn-secondary btn-sm" onclick="App.showEditModel(${model.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          ${readOnly ? '' : `<button class="btn btn-danger btn-sm" onclick="App.confirmDeleteModel(${model.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            Delete
          </button>`}
          ` : ''}
        </div>
      </div>
      ${viewSwitch}
      ${configure ? this.kitView(model, isConfig && !opts.edit) : `
      <div class="detail-layout">
        <div class="detail-main">
          ${viewerHtml}
          ${(model.description || readme || tags || sourceLink || model.versions?.length || model.print_tips) ? `
          <div class="glass-panel detail-info-panel">
            <button type="button" class="detail-info-toggle" onclick="App.toggleInfoExpand(${model.id})" hidden></button>
            <div class="detail-info">
            ${(tags || sourceLink) ? `<div class="detail-info-row">${tags}${sourceLink}</div>` : ''}
            ${model.print_tips ? `
            <div class="detail-info-row detail-tips">
              <span class="detail-info-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>Print tips</span>
              <span>${this.escapeHtml(model.print_tips)}</span>
            </div>` : ''}
            ${model.versions?.length ? `
            <div class="detail-info-row">
              <span class="detail-info-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>Other versions</span>
              ${model.versions.map(v => `<a class="detail-version-chip" href="#/models/${v.id}" title="${this.formatDateShort(v.created_at)} · ${v.file_count} files">${this.escapeHtml(v.name)}</a>`).join('')}
            </div>` : ''}
            ${model.description ? `<div class="detail-description">${this.renderMarkdown(model.description)}</div>` : ''}
            ${readme ? `
            <div class="detail-readme" data-readme-id="${readme.id}">
              <span class="detail-info-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${this.escapeHtml(readme.original_name)}</span>
              <div class="detail-description detail-readme-body"><span style="color:var(--text-muted)">Loading...</span></div>
            </div>` : ''}
            </div>
          </div>` : ''}
        </div>

        <div class="detail-side">
          ${gcodeHtml ? `<div class="detail-gcode">${gcodeHtml}</div>` : ''}
          <div class="glass-panel detail-files-panel">
            <div class="panel-header" style="border-bottom:1px solid var(--border-color);padding:0">
              <div style="display:flex;width:100%;align-items:center;">
                <div class="files-tabs" style="display:flex;gap:20px;padding:16px 16px 0 16px;flex:1">
                  <div onclick="App.switchFilesTab(event, 'files')" style="font-size:0.95rem;font-weight:600;line-height:1.4;padding-bottom:12px;cursor:pointer;border-bottom:2px solid var(--accent-cyan);color:var(--text);display:inline-flex;align-items:center;gap:6px">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                    Files (${model.files?.length || 0})
                  </div>
                  ${docsHtml ? `<div onclick="App.switchFilesTab(event, 'docs')" style="font-size:0.95rem;font-weight:600;line-height:1.4;padding-bottom:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--text-muted);display:inline-flex;align-items:center;gap:6px">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Documentation (${docFiles.length})
                  </div>` : ''}
                  ${trashHtml ? `<div onclick="App.switchFilesTab(event, 'trash')" title="Deleted files of this model" style="font-size:0.95rem;font-weight:600;line-height:1.4;padding-bottom:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--text-muted);display:inline-flex;align-items:center;gap:6px">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Trash (${trashFiles.length})
                  </div>` : ''}
                  ${partsShown ? `<div onclick="App.switchFilesTab(event, 'parts')" title="What to print and how many, the hardware" style="font-size:0.95rem;font-weight:600;line-height:1.4;padding-bottom:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--text-muted);display:inline-flex;align-items:center;gap:6px">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    <span class="parts-tab-label">Parts${partsLabel}</span>
                  </div>` : ''}
                </div>
                <div style="padding:12px 16px;display:flex;gap:8px;align-items:center">
                  ${canChange && layout === 'folder' ? `<button class="btn btn-secondary btn-xs" onclick="App.newFolder(null)" title="New folder in the project folder" style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>Folder</button>` : ''}
                  ${canChange ? `<button class="btn btn-primary btn-xs" onclick="App.showUploadFiles(${model.id})" style="display:inline-flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload</button>` : ''}
                </div>
              </div>
            </div>
            ${(model.files || []).some(f => this.MEASURABLE.includes(f.file_type)) ? '<div class="fit-bar" data-fit-bar="files"></div>' : ''}
            <div class="panel-body no-pad detail-files-body">
              <div id="tab-content-files">
                ${filesHtml || '<div class="empty-state" style="padding:30px"><div class="empty-state-text">No files yet</div><div class="empty-state-sub">Upload STL, Gcode, or 3MF files</div></div>'}
              </div>
              ${docsHtml ? `
              <div id="tab-content-docs" style="display:none">
                ${docsHtml}
              </div>` : ''}
              ${trashHtml ? `
              <div id="tab-content-trash" style="display:none">
                <div class="trash-tab-note">${inTrash ? 'Files deleted on their own before the model went to the Trash.' : 'Deleted files stay on disk until they are deleted for good. Click a file to preview it.'}</div>
                ${trashHtml}
              </div>` : ''}
              ${partsShown ? `<div id="tab-content-parts" style="display:none">${this.partsTab(model, canEdit)}</div>` : ''}
            </div>
          </div>

        </div>
      </div>`}
      </div>`;
  },

  // ─── Kit configurators (public/js/kits): USSA VAULT ────────────────────
  // The configurator view of a model page. App.initKit fills the builder and the parts list;
  // the preview panel is the model page's 3D Studio (App.previewFile). locked: a saved
  // configuration's page, the list and the preview only (the builder shows while editing)
  kitView(model, locked = false) {
    return `
      <div class="kit-layout${locked ? ' is-locked' : ''}">
        <div class="glass-panel kit-builder-panel">
          <div class="kit-builder" id="kit-builder"><div class="kit-empty">Loading...</div></div>
        </div>
        <div class="kit-result">
          <div class="glass-panel detail-viewer-panel kit-preview-panel" style="overflow:visible">
            <div class="panel-header">
              <div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg><span class="detail-viewer-title">Tower</span></div>
              <div class="kit-seg kit-tower-modes" hidden><button type="button" class="kit-seg-btn" data-mode="3d" onclick="App.kitTowerMode('3d')">3D</button><button type="button" class="kit-seg-btn" data-mode="2d" onclick="App.kitTowerMode('2d')">Drawing</button></div>
              <button type="button" class="btn btn-secondary btn-xs kit-open-btn" onclick="App.kitToggleOpen()" title="Open or close every drawer and sustainer" hidden>Open all</button>
              <button type="button" class="btn btn-secondary btn-xs kit-tower-btn" onclick="App.kitShowTower()" hidden>Show the tower</button>
            </div>
            <div class="panel-body no-pad">
              <div class="viewer-container" id="stl-viewer-${model.id}">
                <div class="large-preview">Loading...</div>
              </div>
              <div class="detail-viewer-hint" style="padding:10px 16px;font-size:.7rem;color:var(--text-muted);border-top:1px solid var(--border);background:rgba(0,0,0,0.1)">Drag to rotate · Scroll to zoom · Right-click to pan</div>
            </div>
          </div>
          <div class="glass-panel kit-parts-panel">
            <div class="kit-parts" id="kit-parts"></div>
          </div>
        </div>
        <datalist id="kit-file-list">${(model.files || []).map(f => `<option value="${this.escapeHtml(f.original_name || '')}">`).join('')}</datalist>
      </div>`;
  },

  // A small drawing of the tower, top floor first: drawers, sustainers, roof and base
  kitTower(cfg) {
    const mm = { S: 165, M: 254, L: 330, XL: 419 };
    const F = { '1F': 1, '2F': 2, '4F': 4 };
    const layouts = VaultKit.LAYOUTS[cfg.width] || [];
    const floors = (cfg.floors || []).map((floor) => {
      const layout = layouts.find(l => l.id === floor.layout) || layouts[0];
      const slots = VaultKit.slotsOf(layout);
      const mods = layout.modules.map((mod, mi) => {
        const cols = slots.map((s, si) => ({ s, slot: floor.slots[si] || {} })).filter(x => x.s.mi === mi);
        const inner = cols.map(({ s, slot }) => {
          const boxes = slot.type === 'sustainer' ? 1 : String(slot.boxes || floor.height).split('+').length;
          return `<div class="kit-tower-col is-${slot.type === 'sustainer' ? 'sustainer' : 'drawer'}" style="flex:${mm[s.w]}">${'<span></span>'.repeat(boxes)}</div>`;
        }).join('');
        return `<div class="kit-tower-mod" style="flex:${mm[mod.w]}">${inner}</div>`;
      }).join('');
      return `<div class="kit-tower-floor" style="height:${F[floor.height] * 13}px">${mods}</div>`;
    }).reverse().join('');
    const mods = cfg.mods || {};
    return `
      <div class="kit-tower" style="width:${Math.round(mm[cfg.width] / 419 * 132)}px" aria-hidden="true">
        ${cfg.roof && cfg.roof !== 'none' ? `<div class="kit-tower-roof is-${cfg.roof}"></div>` : ''}
        ${floors}
        ${mods.base && mods.base !== 'none' ? `<div class="kit-tower-base">${mods.base === 'wheels' ? '<i></i><i></i>' : mods.base === 'casters' ? '<b></b><b></b>' : ''}</div>` : ''}
      </div>`;
  },

  // The ⓘ button of an option: hover shows its tip (VaultKit.TIPS), a click pins it. set: where
  // its value lives ('cfg:roof', 'mod:base', 'floor:0:layout', 'slot:0:1:interior'), so a pinned
  // tip with choices can change it
  kitTip(key, set) {
    const tip = VaultKit.TIPS[key];
    if (!tip) return '';
    return `<button type="button" class="kit-tip-btn" data-tip="${key}"${set ? ` data-tip-set="${set}"` : ''} onclick="App.kitShowTip(this, true)" aria-label="About: ${this.escapeHtml(tip.title)}">i</button>`;
  },

  // A tip: its text, the illustration (or one card per choice, the current one marked; a click
  // on a card picks it), what it adds to the lists and where the manual shows it.
  // ctx: { value, relevant (choices that apply here), available, set }
  kitTipContent(tip, ctx = {}) {
    const esc = (s) => this.escapeHtml(s);
    const img = (name, alt) => (name ? `<img class="kit-tip-img" src="/img/kits/ussa-vault/${esc(name)}.webp" alt="${esc(alt || '')}" loading="lazy">` : '');
    const manual = (m) => (m ? `<button type="button" class="kit-tip-manual" onclick="App.kitShowManual(${this.jsArg(m[0])}, ${Number(m[1])})">Manual: ${esc(m[0].replace(/^\d+_/, '').replace(/\.pdf$/i, ''))}, page ${Number(m[1])}</button>` : '');
    const choices = tip.choices || null;
    const keys = choices ? (ctx.relevant || Object.keys(choices)).filter(k => choices[k]) : [];
    const current = choices && choices[ctx.value];
    const cards = keys.map(k => {
      const c = choices[k];
      const off = ctx.available && !ctx.available.includes(k);
      return `<button type="button" class="kit-tip-choice${k === ctx.value ? ' is-current' : ''}"${off || !ctx.set ? ' disabled' : ''}${off ? ' title="Not available for this size"' : ''} onclick="App.kitTipPick(${this.jsArg(ctx.set || '')}, ${this.jsArg(k)})">
          ${img(c.image, c.label)}
          <span class="kit-tip-choice-label">${esc(c.label)}${k === ctx.value ? ' <small>current</small>' : ''}</span>
          <span class="kit-tip-choice-text">${esc(c.text)}</span>
        </button>`;
    }).join('');
    return `
      <div class="kit-tip-head"><span class="kit-tip-title">${esc(tip.title)}</span><button type="button" class="kit-icon-btn" aria-label="Close" onclick="App.kitHideTip(true)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
      ${tip.text ? `<p class="kit-tip-text">${esc(tip.text)}</p>` : ''}
      ${!choices ? img(tip.image, tip.title) : ''}
      ${cards ? `<div class="kit-tip-choices${keys.some(k => choices[k].image) ? ' has-images' : ''}">${cards}</div>` : ''}
      ${tip.adds ? `<p class="kit-tip-adds">${esc(tip.adds)}</p>` : ''}
      <div class="kit-tip-foot">${manual((current && current.manual) || tip.manual)}</div>`;
  },

  // The tower to scale, front and side, with its dimensions (millimetres), shown in the 3D
  // Studio panel while no part is open. Floors are clickable (App.kitFocusFloor).
  // Heights as the archive's files measure: a module is 48 mm per F in the stack and printed
  // 9 mm taller (the lip on top: 57 / 105 / 201 mm), the base 52 mm, the roofs (turned 45° on
  // the plate in their files) grid 10, table 14, bowl 21, under-table mount 20, heavyweight
  // 87 mm. The lift of feet, wheels and casters is estimated.
  kitDrawing(cfg) {
    const mm = { S: 165, M: 254, L: 330, XL: 419 };
    const F = { '1F': 1, '2F': 2, '4F': 4 };
    const P = 48;
    const LIP = 9;
    const ROOF_H = { grid: 10, table: 14, bowl: 21, heavy: 87, undertable: 20 };
    const W = mm[cfg.width] || 330;
    const D = 146 + 42 * (Number(cfg.depth) - 3);
    const mods = cfg.mods || {};
    const floors = cfg.floors || [];
    const layouts = VaultKit.LAYOUTS[cfg.width] || [];
    const layoutOf = (f) => layouts.find(l => l.id === f.layout) || layouts[0];
    const hasBase = mods.base && mods.base !== 'none';
    const lift = mods.base === 'wheels' ? 40 : mods.base === 'casters' ? 46 : (hasBase && mods.feet ? 24 : 0);
    const baseH = hasBase ? 52 : 0;
    const floorsH = floors.reduce((n, f) => n + (F[f.height] || 1) * P, 0);
    const lipH = floors.length ? LIP : 0;
    // The cut heavyweight roof looks like the full one at this scale
    const roofKind = cfg.roof && cfg.roof !== 'none' ? (cfg.roof === 'heavycut' ? 'heavy' : cfg.roof) : null;
    // The top floor: below its lip; the roof sits on the lip
    const stackTop = -lift - baseH - floorsH;
    const topY = stackTop - lipH;
    const fs = Math.round(Math.max(W + D + 200, floorsH + 250) / 30);
    const wheelX = mods.base === 'wheels' ? 46 : 0;
    const sx = W + wheelX + 40 + fs * 2;
    const back = sx + D;
    const r = (cls, x, y, w, h, rx = 0) => `<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}"${rx ? ` rx="${rx}"` : ''}/>`;
    const text = (x, y, s, anchor = 'middle', extra = '') => `<text class="kd-text" x="${x}" y="${y}" font-size="${fs}" text-anchor="${anchor}"${extra}>${this.escapeHtml(s)}</text>`;
    const dimH = (x1, x2, y, label) => `<path class="kd-dim" d="M${x1} ${y}H${x2}M${x1} ${y - 8}V${y + 8}M${x2} ${y - 8}V${y + 8}"/>${text((x1 + x2) / 2, y + fs + 4, label)}`;

    // A drawer column: one facade with key and label per box; a sustainer: facade, locks (one in
    // the middle on S and M, two on L and XL), label
    const column = (slot, x, y, w, h, floorHeight, size) => {
      if (slot.type === 'sustainer') {
        const locks = size === 'S' || size === 'M' ? [0.5] : [0.22, 0.78];
        return r('kd-sus', x + 5, y + 5, w - 10, h - 10, 3) + locks.map(at => r('kd-dark', x + w * at - 9, y + 8, 18, 12, 2)).join('') + r('kd-label', x + w / 2 - 16, y + h / 2 - 5, 32, 10, 2);
      }
      let out = '';
      let by = y;
      for (const bh of String(slot.boxes || floorHeight).split('+')) {
        const bH = (F[bh] || 1) * P;
        // As on the facade STLs: key in the middle of the top band, label slot at the right edge
        const ky = by + P / 2;
        out += r('kd-drawer', x + 5, by + 4, w - 10, bH - 8, 3) + `<circle class="kd-dark" cx="${x + w / 2}" cy="${ky}" r="8"/>` + r('kd-label', x + w - 8 - Math.min(40, w * 0.22), ky - 5, Math.min(40, w * 0.22), 10, 2) + `<circle class="kd-label" cx="${x + Math.min(26, w * 0.15)}" cy="${ky}" r="3.5"/>`;
        by += bH;
      }
      return out;
    };

    let y = -lift - baseH;
    const front = [];
    const side = [];
    floors.forEach((floor, fi) => {
      const h = (F[floor.height] || 1) * P;
      y -= h;
      const layout = layoutOf(floor);
      const slots = VaultKit.slotsOf(layout);
      let mx = 0;
      let parts = '';
      layout.modules.forEach((mod, mi) => {
        const mw = mm[mod.w];
        parts += r('kd-mod', mx + 1, y + 1, mw - 2, h - 2, 4);
        let cx = mx;
        slots.forEach((s, si) => {
          if (s.mi !== mi) return;
          parts += column(floor.slots[si] || {}, cx, y, mm[s.w], h, floor.height, s.w);
          if (cx > mx) parts += `<path class="kd-wall" d="M${cx} ${y + 3}V${y + h - 3}"/>`;
          cx += mm[s.w];
        });
        mx += mw;
      });
      const label = `Floor ${fi + 1}: ${floor.height}, ${layout.label}`;
      const hover = `data-fi="${fi}" onclick="App.kitFocusFloor(${fi})" onmouseenter="App.kitHoverFloor(${fi})" onmouseleave="App.kitHoverFloor(null)"`;
      front.push(`<g class="kd-floor" ${hover}><title>${this.escapeHtml(label)}</title>${parts}${text(-14, y + h / 2 + fs / 3, String(fi + 1), 'end')}</g>`);
      const firstType = (floor.slots[0] || {}).type === 'sustainer' ? 'kd-sus' : 'kd-drawer';
      let boards = '';
      if (mods.backbone && mods.backbone !== 'none') {
        const units = floor.height === '4F' ? [h / 2, h / 2] : [h];
        let uy = y;
        units.forEach(uh => { boards += r('kd-dark', back, uy + 2, 14, uh - 4, 2); uy += uh; });
        if (mods.pegboard && mods.pegboard !== 'none') boards += r('kd-peg', back + 14, y + 6, 8, h - 12, 1);
      }
      if (mods.wallMount) boards += r('kd-mount', back + (mods.backbone && mods.backbone !== 'none' ? 14 : 0), y + 3, 10, h - 6, 1);
      side.push(`<g class="kd-floor" ${hover}><title>${this.escapeHtml(label)}</title>${r('kd-mod', sx, y + 1, D, h - 2, 4)}${r(firstType, sx - 5, y + 5, 7, h - 10, 2)}${boards}</g>`);
    });

    // The lip of the top floor's modules, the roof on its drawer modules (sustainers have their
    // own lids)
    let roof = '';
    let lip = '';
    const top = floors[floors.length - 1];
    if (top) {
      let mx = 0;
      for (const mod of layoutOf(top).modules) { lip += r('kd-mod', mx + 1, topY, mm[mod.w] - 2, lipH, 2); mx += mm[mod.w]; }
      lip += r('kd-mod', sx, topY, D, lipH, 2);
    }
    if (roofKind && top) {
      const layout = layoutOf(top);
      const slots = VaultKit.slotsOf(layout);
      const h = ROOF_H[roofKind];
      let mx = 0;
      layout.modules.forEach((mod, mi) => {
        const mw = mm[mod.w];
        const first = slots.findIndex(s => s.mi === mi);
        const drawer = mod.cols || (top.slots[first] || {}).type !== 'sustainer';
        if (drawer) {
          if (roofKind === 'grid') roof += r('kd-roof', mx + 2, topY - h, mw - 4, h, 2) + r('kd-dark', mx + mw / 2 - Math.min(40, mw * 0.2), topY - h + 3, Math.min(80, mw * 0.4), 4, 2);
          if (roofKind === 'table') roof += r('kd-roof', mx - 2, topY - h, mw + 4, h, 2);
          if (roofKind === 'bowl') roof += r('kd-roof', mx + 2, topY - h, mw - 4, h, 4) + r('kd-hollow', mx + 10, topY - h + 4, mw - 20, 9, 3);
          if (roofKind === 'heavy') roof += r('kd-roof', mx + 2, topY - 8, mw - 4, 8, 2) + r('kd-roof', mx + 4, topY - h, mw * 0.3, h - 8, 4) + r('kd-roof', mx + mw * 0.7 - 4, topY - h, mw * 0.3, h - 8, 4) + r('kd-dark', mx + mw * 0.3 + 4, topY - h + 22, mw * 0.4 - 8, 14, 5);
          if (roofKind === 'undertable') roof += r('kd-roof', mx - 10, topY - h, mw + 20, h, 2);
        }
        mx += mw;
      });
      if (roofKind === 'undertable') roof += r('kd-table', -60, topY - h - 22, W + 120, 22, 2);
      const sideRoof = { grid: r('kd-roof', sx + 2, topY - h, D - 4, h, 2), table: r('kd-roof', sx - 2, topY - h, D + 4, h, 2),
        bowl: r('kd-roof', sx + 2, topY - h, D - 4, h, 4), heavy: r('kd-roof', sx + 4, topY - h, D - 8, h, 4), undertable: r('kd-roof', sx - 10, topY - h, D + 20, h, 2) + r('kd-table', sx - 40, topY - h - 22, D + 80, 22, 2) }[roofKind];
      if (roof && sideRoof) roof += sideRoof;
    }
    // Only a roof that is drawn counts (a top floor of sustainers has none)
    const roofH = roof ? ROOF_H[roofKind] : 0;
    const handleTop = mods.pullHandle && mods.backbone !== 'none' ? topY - roofH - 150 : topY - roofH;

    // Base, wheels, casters, feet, handles
    let under = '';
    let sideWheel = '';
    if (hasBase) under += r('kd-base', 0, -lift - baseH, W, baseH, 4) + r('kd-base', sx, -lift - baseH, D, baseH, 4);
    if (mods.base === 'wheels') {
      under += r('kd-wheel', -45, -160, 41, 160, 12) + r('kd-wheel', W + 4, -160, 41, 160, 12);
      // Seen from the side the wheel is in front of the modules
      sideWheel = `<circle class="kd-wheel" cx="${back - 70}" cy="-80" r="80"/><circle class="kd-hub" cx="${back - 70}" cy="-80" r="30"/>`;
    }
    if (mods.base === 'casters') {
      [16, W - 16].forEach(x => { under += r('kd-dark', x - 4, -lift, 8, 18) + `<circle class="kd-wheel" cx="${x}" cy="-14" r="14"/>`; });
      [sx + 22, back - 22].forEach(x => { under += r('kd-dark', x - 4, -lift, 8, 18) + `<circle class="kd-wheel" cx="${x}" cy="-14" r="14"/>`; });
    }
    if (hasBase && mods.feet && lift) under += r('kd-dark', W * 0.25, -lift, W * 0.5, lift, 3) + r('kd-dark', sx + 6, -lift, 70, lift, 3);
    let handles = '';
    if (mods.backbone && mods.backbone !== 'none' && top) {
      if (mods.pullHandle) handles += `<path class="kd-rod" d="M${back + 26} ${-lift - baseH}V${handleTop + 14}"/>` + r('kd-dark', back + 12, handleTop, 30, 14, 4);
      if (mods.stationaryHandle) {
        const th = (F[top.height] || 1) * P;
        handles += `<path class="kd-handle" d="M${back + 14} ${topY + th * 0.25}h46v${th * 0.5}h-46"/>`;
      }
    }
    const wall = mods.wallMount ? r('kd-wallside', back + (mods.backbone && mods.backbone !== 'none' ? 24 : 10), handleTop - 30, 14, -handleTop + 30) : '';

    // The stack from the ground up: lift, base, every floor, the lip with the roof on it
    const roofName = { grid: 'Grid roof', table: 'Table roof', bowl: 'Bowl roof', heavy: 'Heavyweight roof', undertable: 'Under-table mount' }[roofKind];
    const liftName = { wheels: 'Wheels', casters: 'Casters' }[mods.base] || 'Feet';
    const parts = [
      ...(lift ? [{ h: lift, label: `~${lift}`, name: `${liftName} (lift)`, value: `~${lift} mm` }] : []),
      ...(baseH ? [{ h: baseH, label: String(baseH), name: 'Base', value: `${baseH} mm` }] : []),
      ...floors.map((f, fi) => ({ h: (F[f.height] || 1) * P, label: String((F[f.height] || 1) * P), name: `Floor ${fi + 1} · ${f.height}`, value: `${(F[f.height] || 1) * P} mm`, fi })),
      ...(lipH ? [{ h: lipH + roofH, label: roofH ? `${lipH}+${roofH}` : String(lipH), name: 'Top lip', value: `${lipH} mm` }] : [])
    ];
    const total = parts.reduce((n, p) => n + p.h, 0);
    const roofTop = -total;
    const cx = -fs * 2.2;
    const tx = -fs * 4.6;
    let chain = `<path class="kd-dim" d="M${cx} 0V${roofTop}"/>`;
    let at = 0;
    const tick = (y) => `<path class="kd-dim" d="M${cx - 7} ${y}H${cx + 7}"/>`;
    chain += tick(0);
    for (const p of parts) {
      chain += tick(at - p.h) + text(cx - 8, at - p.h / 2 + fs * 0.28, p.label, 'end', ` font-size="${Math.round(fs * 0.72)}"`);
      at -= p.h;
    }
    const minY = Math.min(handleTop, roofTop) - fs * 1.5;
    const maxX = back + 100;
    const minX = tx - fs * 1.4;
    const maxY = 30 + fs * 3.2;
    const dims = dimH(0, W, 26, `${W} mm`) + dimH(sx, back, 26, `${D} mm`) + chain +
      `<path class="kd-dim" d="M${tx} 0V${roofTop}M${tx - 8} 0H${tx + 8}M${tx - 8} ${roofTop}H${tx + 8}"/>` +
      text(tx - fs * 0.45, roofTop / 2, `${lift ? '≈ ' : ''}${total} mm`, 'middle', ` transform="rotate(-90 ${tx - fs * 0.45} ${roofTop / 2})"`) +
      text(W / 2, 30 + fs * 2.6, 'Front', 'middle', ' class="kd-text kd-caption"') + text(sx + D / 2, 30 + fs * 2.6, 'Side', 'middle', ' class="kd-text kd-caption"');
    // The list next to the drawing, top floor first like the builder
    const item = (name, value, extra = '') => `<div class="kd-item"${extra}><dt>${this.escapeHtml(name)}</dt><dd>${this.escapeHtml(value)}</dd></div>`;
    const list = [
      item('Width', `${W} mm`), item('Depth', `${D} mm`),
      item('Height', `${lift ? '≈ ' : ''}${total} mm`, ' class="kd-item is-total"'),
      ...(roofH ? [item(roofName, `${roofH} mm`)] : []),
      ...(lipH ? [item('Top lip', `${lipH} mm`)] : []),
      ...parts.filter(p => p.fi !== undefined).reverse().map(p => item(p.name, p.value, ` data-fi="${p.fi}" onmouseenter="App.kitHoverFloor(${p.fi})" onmouseleave="App.kitHoverFloor(null)"`)),
      ...parts.filter(p => p.fi === undefined && p.name !== 'Top lip').reverse().map(p => item(p.name, p.value))
    ].join('');
    return `
      <div class="kit-drawing-wrap">
        <svg class="kit-drawing" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The tower from the front and the side, with its dimensions">
          <path class="kd-ground" d="M${minX + fs * 2} 0H${maxX - 10}"/>
          ${wall}${under}${front.join('')}${side.join('')}${lip}${sideWheel}${roof}${handles}${dims}
        </svg>
        <dl class="kd-list" title="A module is 48 mm per F in the stack; printed it is 9 mm taller (57 / 105 / 201 mm), the lip that goes into the next one">${list}</dl>
      </div>`;
  },

  // The builder: saved configurations, footprint, floors (top floor first), roof, options and
  // modifications. kit: the configurator state of App (cfg, choices, bom, saved, mode) plus
  // loggedIn and dirty. kit.mode: 'archive' (the archive's page: a draft that can be saved as a
  // configuration), 'view' (a configuration's page: no builder, only the list and the preview)
  // or 'edit'. Controls with data-tip show their tip on hover and focus.
  kitBuilder(kit) {
    if (kit.mode === 'view') return '';
    const { cfg, choices: ch } = kit;
    const esc = (s) => this.escapeHtml(s);
    const tip = (key, set) => this.kitTip(key, set);
    const on = (key, set) => ` data-tip="${key}" data-tip-set="${set}"`;
    const opt = (value, label, selected, disabled) => `<option value="${esc(value)}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${esc(label)}</option>`;
    const seg = (field, values, current, available) => `<div class="kit-seg"${on(field, `cfg:${field}`)}>${values.map(v => `<button type="button" class="kit-seg-btn${String(v) === String(current) ? ' is-active' : ''}"${available.includes(v) ? '' : ' disabled'} onclick="App.kitSet('${field}', '${v}')">${v}</button>`).join('')}</div>`;
    const check = (label, checked, onchange, disabled, tipKey, set) => `<span class="kit-check-wrap"><label class="kit-check${disabled ? ' is-disabled' : ''}"${tipKey ? on(tipKey, set || '') : ''}><input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} onchange="${onchange}">${esc(label)}</label>${tipKey ? tip(tipKey, set) : ''}</span>`;
    const icon = (path) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const boxLabels = { '1F': 'One 1F box', '2F': 'One 2F box', '4F': 'One 4F box', '1F+1F': 'Two 1F boxes', '2F+2F': 'Two 2F boxes', '2F+1F+1F': '2F + two 1F boxes', '1F+1F+1F+1F': 'Four 1F boxes' };
    const drawerInteriors = { empty: 'Empty', gridfinity: 'Gridfinity baseplate', dividers: 'Grid dividers' };
    const sustainerInteriors = { flat: 'Flat', gridfinity: 'Gridfinity baseplate', dividers: 'Dividers', sealed: 'Sealed compartments' };
    const n = cfg.floors.length;
    const hasSustainer = cfg.floors.some(f => f.slots.some(s => s.type === 'sustainer'));

    const floors = cfg.floors.map((floor, fi) => {
      const fc = ch.floors[fi];
      const layoutSelect = fc.layouts.length > 1 ? `<select class="form-select kit-select" onchange="App.kitFloor(${fi}, 'layout', this.value)"${on('layout', `floor:${fi}:layout`)}>${fc.layouts.map(l => opt(l.id, l.label, l.id === floor.layout, !l.available)).join('')}</select>` : '';
      const slots = floor.slots.map((slot, si) => {
        const sc = fc.slots[si];
        const name = sc.double ? `${sc.width} drawer ${si === 0 ? 'left' : 'right'}` : (floor.slots.length > 1 ? `${sc.width} ${si === 0 ? 'left' : 'right'}` : sc.width);
        const set = (field) => `slot:${fi}:${si}:${field}`;
        const type = sc.types.length > 1
          ? `<select class="form-select kit-select" onchange="App.kitSlot(${fi}, ${si}, 'type', this.value)"${on('type', set('type'))}>${sc.types.map(t => opt(t, t === 'drawer' ? 'Drawer' : 'Sustainer', t === slot.type)).join('')}</select>`
          : `<span class="kit-slot-type"${on('type', set('type'))}>${slot.type === 'drawer' ? 'Drawer' : 'Sustainer'}</span>`;
        let rest;
        if (slot.type === 'sustainer') {
          rest = `<select class="form-select kit-select" onchange="App.kitSlot(${fi}, ${si}, 'interior', this.value)"${on('sustainerInterior', set('interior'))}>${sc.interiors.map(i => opt(i, sustainerInteriors[i] || i, i === slot.interior)).join('')}</select>`;
        } else {
          rest = [
            sc.boxes.length > 1 ? `<select class="form-select kit-select" onchange="App.kitSlot(${fi}, ${si}, 'boxes', this.value)"${on('boxes', set('boxes'))}>${sc.boxes.map(b => opt(b, boxLabels[b] || b, b === slot.boxes)).join('')}</select>` : '',
            `<select class="form-select kit-select" onchange="App.kitSlot(${fi}, ${si}, 'interior', this.value)"${on('drawerInterior', set('interior'))}>${sc.interiors.map(i => opt(i, drawerInteriors[i] || i, i === slot.interior)).join('')}</select>`,
            slot.interior === 'gridfinity' && sc.handles.length > 1 ? `<select class="form-select kit-select" onchange="App.kitSlot(${fi}, ${si}, 'handles', this.value)"${on('handles', set('handles'))}>${sc.handles.map(h => opt(h, h === '0' ? 'No handles' : `${h} handle${h === '1' ? '' : 's'}`, h === slot.handles)).join('')}</select>` : '',
            slot.interior === 'dividers' ? check('Low (20 mm)', slot.low, `App.kitSlot(${fi}, ${si}, 'low', this.checked)`, false, 'low') : ''
          ].join('');
        }
        return `<div class="kit-slot"><span class="kit-slot-name">${esc(name)}</span><div class="kit-slot-controls">${type}${rest}</div></div>`;
      }).join('');
      return `
        <div class="kit-floor" data-fi="${fi}" onmouseenter="App.kitHoverFloor(${fi})" onmouseleave="App.kitHoverFloor(null)">
          <div class="kit-floor-head">
            <span class="kit-floor-title">Floor ${fi + 1}${fi === 0 ? '<small>bottom</small>' : ''}${fi === n - 1 && n > 1 ? '<small>top</small>' : ''}</span>
            <select class="form-select kit-select kit-select-height" onchange="App.kitFloor(${fi}, 'height', this.value)"${on('height', `floor:${fi}:height`)}>${fc.heights.map(h => opt(h, h, h === floor.height)).join('')}</select>
            ${layoutSelect}
            <span class="kit-floor-tools">
              <button type="button" class="kit-icon-btn" title="Move up" onclick="App.kitMoveFloor(${fi}, 1)"${fi === n - 1 ? ' disabled' : ''}>${icon('<polyline points="18 15 12 9 6 15"/>')}</button>
              <button type="button" class="kit-icon-btn" title="Move down" onclick="App.kitMoveFloor(${fi}, -1)"${fi === 0 ? ' disabled' : ''}>${icon('<polyline points="6 9 12 15 18 9"/>')}</button>
              <button type="button" class="kit-icon-btn" title="Duplicate floor" onclick="App.kitCopyFloor(${fi})">${icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}</button>
              <button type="button" class="kit-icon-btn is-danger" title="Remove floor" onclick="App.kitRemoveFloor(${fi})"${n === 1 ? ' disabled' : ''}>${icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')}</button>
            </span>
          </div>
          ${slots}
        </div>`;
    }).reverse().join('');

    const mode = kit.mode || 'archive';
    const pencil = icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>');
    let saved = '';
    if (mode === 'archive' && kit.loggedIn) {
      // Each saved configuration is a project of its own: picking one opens its page
      saved = `
      <div class="kit-section kit-saved">
        <select class="form-select kit-select" onchange="App.kitOpenSaved(this.value)" title="Open a saved configuration">
          ${opt('', kit.saved.length ? `Saved configurations (${kit.saved.length})` : 'No saved configurations', true)}
          ${kit.saved.map(s => opt(s.id, s.locked ? `${s.name} (protected)` : s.name, false)).join('')}
        </select>
        <button type="button" class="btn btn-primary btn-xs" onclick="App.kitSaveAs()">Save as configuration...</button>
        ${tip('saved')}
      </div>`;
    } else if (mode === 'archive') {
      saved = `
      <div class="kit-section kit-saved">
        <span class="kit-locked-note">Log in to save configurations and open saved ones</span>
        <button type="button" class="btn btn-secondary btn-xs" onclick="App.showLogin()">Log in</button>
        ${tip('saved')}
      </div>`;
    } else if (mode === 'edit') {
      saved = `
      <div class="kit-section kit-saved">
        <span class="kit-locked-note">${pencil}Editing</span>
        <button type="button" class="btn btn-${kit.dirty ? 'primary' : 'secondary'} btn-xs" onclick="App.kitSaveConfig()"${kit.dirty ? '' : ' disabled'}>Save</button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="App.kitCancelEdit()">Cancel</button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="App.kitSaveAs()">Save as copy...</button>
      </div>`;
    }

    const mods = cfg.mods;
    const noBackbone = mods.backbone === 'none';
    const depthMm = 146 + 42 * (cfg.depth - 3);
    const widthMm = { S: 165, M: 254, L: 330, XL: 419 }[cfg.width];
    const body = `
      <div class="kit-section kit-footprint">
        ${this.kitTower(cfg)}
        <div class="kit-footprint-fields">
          <div class="kit-field"><span class="kit-label">Width</span>${seg('width', VaultKit.WIDTHS, cfg.width, ch.widths)}${tip('width', 'cfg:width')}</div>
          <div class="kit-field"><span class="kit-label">Depth</span>${seg('depth', VaultKit.DEPTHS, cfg.depth, ch.depths)}${tip('depth', 'cfg:depth')}</div>
          <div class="kit-dims">About ${widthMm} × ${depthMm} mm, ${kit.bom.height} mm high${mods.base !== 'none' ? ' with the base' : ''}</div>
          <button type="button" class="btn btn-ghost btn-xs" onclick="App.kitReset()">Start over</button>
        </div>
      </div>
      <div class="kit-section">
        <div class="kit-section-head"><span class="kit-label">Floors, top to bottom ${tip('floors')}</span><button type="button" class="btn btn-secondary btn-xs" onclick="App.kitAddFloor()">+ Floor on top</button></div>
        ${floors || '<div class="kit-empty">No floors yet.</div>'}
      </div>
      <div class="kit-section">
        <div class="kit-field"><span class="kit-label">Roof</span>${ch.roofs.length
          ? `<select class="form-select kit-select" onchange="App.kitSet('roof', this.value)"${on('roof', 'cfg:roof')}>${opt('none', 'No roof', cfg.roof === 'none')}${ch.roofs.map(r => opt(r, (VaultKit.ROOFS.find(x => x.id === r) || {}).label || r, r === cfg.roof)).join('')}</select>${tip('roof', 'cfg:roof')}`
          : '<span class="kit-muted">Sustainers on top have their own lids.</span>'}</div>
        <div class="kit-field"><span class="kit-label">Drawer key</span><select class="form-select kit-select" onchange="App.kitSet('key', this.value)"${on('key', 'cfg:key')}>${opt('standard', 'Key with cap', cfg.key === 'standard')}${opt('hidden', 'Hidden key', cfg.key === 'hidden')}</select>${tip('key', 'cfg:key')}</div>
        ${hasSustainer ? `<div class="kit-field"><span class="kit-label">Sustainer facades</span><select class="form-select kit-select" onchange="App.kitSet('sustainerFacade', this.value)"${on('sustainerFacade', 'cfg:sustainerFacade')}>${opt('family', 'Standard', cfg.sustainerFacade === 'family')}${opt('universal', 'Plain (Universal folder)', cfg.sustainerFacade === 'universal')}</select>${tip('sustainerFacade', 'cfg:sustainerFacade')}</div>` : ''}
        <div class="kit-checks">
          ${ch.canSplit ? check('Bases and sustainer lids in two parts', cfg.split, "App.kitSet('split', this.checked)", false, 'split') : ''}
          ${check('Geared rails in every box', cfg.gearedRails === 'all', "App.kitSet('gearedRails', this.checked ? 'all' : 'auto')", false, 'gearedRails')}
          ${check('Manual supports for roofs and lids', cfg.manualSupports, "App.kitSet('manualSupports', this.checked)", false, 'manualSupports')}
        </div>
      </div>
      <div class="kit-section">
        <div class="kit-section-head"><span class="kit-label">Modifications</span></div>
        <div class="kit-field"><span class="kit-label">Base</span><select class="form-select kit-select" onchange="App.kitMod('base', this.value)"${on('base', 'mod:base')}>${ch.bases.map(b => opt(b, { none: 'None', plain: 'Base', wheels: 'Base with wheels', casters: 'Base with casters' }[b], b === mods.base)).join('')}</select>${tip('base', 'mod:base')}
          ${mods.base !== 'none' ? check('Feet', mods.feet, "App.kitMod('feet', this.checked)", false, 'feet') : ''}</div>
        <div class="kit-field"><span class="kit-label">Backbone</span><select class="form-select kit-select" onchange="App.kitMod('backbone', this.value)"${on('backbone', 'mod:backbone')}>${ch.backbones.map(b => opt(b, { none: 'None', wide: `${cfg.width} boards`, universal: 'Universal boards' }[b], b === mods.backbone)).join('')}</select>${tip('backbone', 'mod:backbone')}</div>
        <div class="kit-field"><span class="kit-label">Pegboard</span><select class="form-select kit-select" onchange="App.kitMod('pegboard', this.value)"${noBackbone ? ' disabled' : ''}${on('pegboard', 'mod:pegboard')}>${VaultKit.PEGBOARDS.map(p => opt(p, { none: 'None', ikea: 'IKEA Skådis', ussa: 'USSA' }[p], p === mods.pegboard)).join('')}</select>${tip('pegboard', noBackbone ? '' : 'mod:pegboard')}</div>
        <div class="kit-checks">
          ${check('Pull-out handle', mods.pullHandle, "App.kitMod('pullHandle', this.checked)", noBackbone, 'pullHandle')}
          ${check('Stationary handle', mods.stationaryHandle, "App.kitMod('stationaryHandle', this.checked)", noBackbone, 'stationaryHandle')}
          ${check('Wall mount', mods.wallMount, "App.kitMod('wallMount', this.checked)", false, 'wallMount')}
        </div>
        ${noBackbone ? '<div class="kit-muted">Handles and pegboards attach to the backbone.</div>' : ''}
      </div>`;
    return `${saved}${body}`;
  },

  // The result: files to print with print counts (editable), hardware, notes, download
  kitParts(kit) {
    const { bom } = kit;
    const esc = (s) => this.escapeHtml(s);
    const t = bom.totals;
    const locked = kit.mode === 'view';
    // A saved configuration tracks its prints: kit.printed { file id: successful prints }
    const track = locked && Boolean(kit.printed);
    const printedOf = (p) => Math.min(p.qty, (kit.printed || {})[p.file.id] || 0);
    const needed = bom.parts.filter(p => p.qty > 0);
    const progress = { done: needed.reduce((n, p) => n + printedOf(p), 0), total: needed.reduce((n, p) => n + p.qty, 0) };
    const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const counter = (p) => {
      const n = (kit.printed || {})[p.file.id] || 0;
      const id = Number(p.file.id);
      return `
          <div class="kit-progress${n >= p.qty ? ' is-done' : ''}" onclick="event.stopPropagation()">
            ${kit.canEdit ? `<button type="button" class="kit-step" title="Undo the last print" aria-label="One print less" onclick="App.kitPrinted(${id}, -1)"${n ? '' : ' disabled'}>−</button>` : ''}
            <button type="button" class="kit-count" title="Prints of this part: history, a print with details" onclick="App.kitPartPrints(${id})">${n >= p.qty ? '✓ ' : ''}${n}/${p.qty}</button>
            ${kit.canEdit ? `<button type="button" class="kit-step is-add" title="Printed one" aria-label="One print more" onclick="App.kitPrinted(${id}, 1)">+</button>` : ''}
          </div>`;
    };
    // The star opens the preferred slicer, the arrow the others; a file with saved slicer
    // projects (a read-only archive) opens the chooser from the star
    const slicer = (f) => (this.MEASURABLE.includes(f.file_type) ? this.slicerButton(this.slicerLinks(f, f.model_id),
      { compact: true, versions: f.version_count, onclick: f.version_count ? `App.openSlicerChooser(${Number(f.model_id)}, ${Number(f.id)})` : null }) : '<span class="slicer-slot"></span>');
    // One file on its own, like the download button of the model's file list
    const download = (f) => `<a href="/api/files/${Number(f.id)}/download" class="kit-icon-btn kit-download" title="Download ${esc(String(f.original_name || '').split('/').pop())}" aria-label="Download" download onclick="event.stopPropagation()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>`;
    const rows = [];
    let group = null;
    for (const p of bom.parts) {
      // Optional parts nobody asked for are only offered while the configuration is edited
      if (locked && p.optional && !p.qty) continue;
      if (p.group !== group) {
        group = p.group;
        rows.push(`<div class="kit-group-title">${esc(group)}</div>`);
      }
      const path = String(p.file.original_name || '');
      const extra = p.group === 'Extra files';
      rows.push(`
        <div class="kit-part${p.qty === 0 ? ' is-off' : ''}${track && p.qty > 0 && printedOf(p) >= p.qty ? ' is-printed' : ''}${p.file.id === kit.previewId ? ' is-active' : ''}" data-key="${esc(p.key)}" data-file-id="${Number(p.file.id)}" onclick="App.kitPreview(${Number(p.file.id)})" title="${esc(path)}">
          ${track && p.qty > 0 ? counter(p) : locked ? `<span class="kit-qty is-static" title="Prints">${p.qty}</span>` : `<input type="number" class="kit-qty" min="0" max="999" value="${p.qty}" aria-label="Prints" onclick="event.stopPropagation()" onchange="App.kitQty(this.closest('.kit-part').dataset.key, this.value)">`}
          <div class="kit-part-main">
            <div class="kit-part-label">${esc(p.label)}${p.estimate ? ' <span class="kit-est" title="Estimated: the manual does not give this quantity">estimate</span>' : ''}${p.optional ? ' <span class="kit-est" title="Not in the manual: set how many you need">optional</span>' : ''}</div>
            <div class="kit-part-path">${esc(path)}</div>
            ${locked ? `<div class="kit-part-meta">${this.formatSize(p.file.file_size)}${this.MEASURABLE.includes(p.file.file_type) ? ` <span class="fit-dim" data-dim-file="${Number(p.file.id)}"></span>` : ''}</div>` : ''}
          </div>
          ${p.auto !== undefined && !locked ? `<button type="button" class="kit-reset" title="Back to the computed ${p.auto}" onclick="event.stopPropagation(); App.kitQty(this.closest('.kit-part').dataset.key, '')">↺ ${p.auto}</button>` : ''}
          ${locked ? '' : `${this.MEASURABLE.includes(p.file.file_type) ? `<span class="fit-dim" data-dim-file="${Number(p.file.id)}"></span>` : ''}
          <span class="kit-part-size">${this.formatSize(p.file.file_size)}</span>`}
          ${locked ? slicer(p.file) : ''}
          ${download(p.file)}
          ${extra && !locked ?`<button type="button" class="kit-icon-btn is-danger" title="Remove from the list" onclick="event.stopPropagation(); App.kitRemoveExtra(this.closest('.kit-part').dataset.key)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
        </div>`);
    }
    const notes = [
      ...bom.warnings.map(w => `<li class="is-warning">${esc(w)}</li>`),
      ...bom.notes.map(w => `<li>${esc(w)}</li>`)
    ].join('');
    const hardware = bom.hardware.map(h => `
      <div class="kit-hw"><span class="kit-hw-qty">${h.qty} ×</span><span>${esc(h.name)}${h.note ? ` <span class="kit-muted">(${esc(h.note)})</span>` : ''}${h.estimate ? ' <span class="kit-est">estimate</span>' : ''}</span></div>`).join('');
    return `
      <div class="kit-parts-head">
        <div>
          <div class="kit-parts-title">Files to print</div>
          <div class="kit-parts-sub">${t.files} files · ${t.prints} prints · ${this.formatSize(t.bytes)} to download</div>
        </div>
        <div class="kit-parts-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.kitCopyList()">Copy list</button>
          ${!kit.loggedIn ? '' : locked
            ? (t.files ? `<a class="btn btn-primary btn-sm" href="/api/models/${Number(kit.modelId)}/download" download>Download ZIP</a>` : '')
            : `<button type="button" class="btn btn-primary btn-sm" onclick="App.kitDownload()"${t.files ? '' : ' disabled'}>Download ZIP</button>`}
        </div>
      </div>
      ${track && progress.total ? `
      <div class="kit-print-progress${progress.done >= progress.total ? ' is-done' : ''}">
        <div class="kit-print-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.done}"><span style="width:${pct}%"></span></div>
        <span class="kit-print-text">${progress.done >= progress.total ? '✓ All printed' : `${progress.done} of ${progress.total} prints done`} · ${pct}%</span>
        ${kit.canEdit ? `
        ${progress.done < progress.total ? '<button type="button" class="btn btn-ghost btn-xs" onclick="App.kitFillPrints()">Mark all printed</button>' : ''}
        ${progress.done ? '<button type="button" class="btn btn-ghost btn-xs" onclick="App.kitResetPrints()">Reset progress</button>' : ''}` : ''}
      </div>` : ''}
      <div class="fit-bar" data-fit-bar="parts"></div>
      <div class="kit-parts-body">
        ${notes ? `<ul class="kit-notes">${notes}</ul>` : ''}
        ${rows.join('') || '<div class="kit-empty">Nothing to print yet.</div>'}
        ${locked ? '' : `<div class="kit-add">
          <input class="form-input" list="kit-file-list" placeholder="Add a file from the project..." aria-label="Add a file" onchange="App.kitAddExtra(this.value)">
        </div>`}
        ${hardware ? `<div class="kit-group-title">Hardware to buy</div>${hardware}` : ''}
        ${kit.cat.docs.length ? `<div class="kit-group-title">Instructions</div>
        ${kit.cat.docs.map(f => `
        <div class="kit-doc">
          <button type="button" class="kit-doc-name" onclick="App.kitShowManual(${this.jsArg(f.original_name)}, 1)" title="Open in the preview">${esc(f.original_name)}</button>
          <span class="kit-part-size">${this.formatSize(f.file_size)}</span>
          ${download(f)}
        </div>`).join('')}
        ${locked ? (bom.cfg.docs ? `<div class="kit-muted kit-docs-note">The ${kit.cat.docs.length} instruction PDFs are in the ZIP.</div>` : '')
          : `<span class="kit-check-wrap"><label class="kit-check"><input type="checkbox"${bom.cfg.docs ? ' checked' : ''} onchange="App.kitSet('docs', this.checked)">Add the ${kit.cat.docs.length} instruction PDFs to the ZIP</label>${this.kitTip('docs')}</span>`}` : ''}
      </div>`;
  },

  kitNameForm({ value = '', submitLabel }) {
    return `
      <form onsubmit="App.kitSubmitName(event)">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" name="name" id="kit-name-input" value="${this.escapeHtml(value)}" autocomplete="off" spellcheck="false" required maxlength="100">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${this.escapeHtml(submitLabel)}</button>
        </div>
      </form>`;
  },

  // ── Print History (modal opened from the model header) ──
  // The prints of one part of a configuration: newest first, and a print with details
  partPrintsModal(model, file, part, materials = []) {
    const prints = (model.prints || []).filter(p => p.file_id === file.id);
    const done = prints.filter(p => p.successful).length;
    const canEdit = App.currentUser?.role === 'admin' || (App.currentUser?.role !== 'viewer' && model.user_id === App.currentUser?.id);
    const rows = prints.map(p => `
      <div class="print-item">
        <div class="print-status ${p.successful ? 'success' : 'failed'}"></div>
        <div class="print-info">
          <div class="print-material">${this.escapeHtml(p.material_name || 'Unknown material')} ${p.successful ? '' : '<span style="color:var(--error);font-size:.75rem"> — Failed</span>'}</div>
          <div class="print-date">${this.formatDate(p.printed_at)}</div>
          ${p.notes ? `<div class="print-notes">${this.escapeHtml(p.notes)}</div>` : ''}
        </div>
        ${canEdit ? `<button class="btn btn-ghost" style="padding:6px;color:var(--error)" onclick="App.deletePrint(${p.id},${model.id})" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}
      </div>`).join('');
    return `
      <div class="print-history-modal">
        <div class="kit-muted" style="margin-bottom:10px">${this.escapeHtml(file.original_name)} · ${done} of ${part ? part.qty : '?'} printed</div>
        <div class="print-history-list">${rows || '<div style="color:var(--text-muted);font-size:.875rem;text-align:center;padding:12px 0">No prints of this part yet</div>'}</div>
        ${canEdit ? `<div class="kit-group-title" style="padding:14px 0 6px">Log a print</div>${this.printForm(model.id, materials, { fileId: file.id })}` : ''}
      </div>`;
  },

  printHistoryModal(model) {
    const canEdit = App.currentUser?.role === 'admin' || (App.currentUser?.role !== 'viewer' && model.user_id === App.currentUser?.id);
    // A configuration's prints of single parts: the part's file name
    const names = new Map((model.files || []).map(f => [f.id, String(f.original_name || '').split('/').pop()]));
    const partName = (id) => names.get(id) || '';
    const printsHtml = (model.prints || []).map(p => `
      <div class="print-item">
        <div class="print-status ${p.successful ? 'success' : 'failed'}"></div>
        <div class="print-info">
          <div class="print-material">${this.escapeHtml(p.material_name || 'Unknown material')} ${p.successful ? '' : '<span style="color:var(--error);font-size:.75rem"> — Failed</span>'}</div>
          ${p.file_id && partName(p.file_id) ? `<div class="print-part">${this.escapeHtml(partName(p.file_id))}</div>` : ''}
          <div class="print-date">${this.formatDate(p.printed_at)}</div>
          ${p.notes ? `<div class="print-notes">${this.escapeHtml(p.notes)}</div>` : ''}
        </div>
        ${canEdit ? `<button class="btn btn-ghost" style="padding:6px;color:var(--error)" onclick="App.deletePrint(${p.id},${model.id})" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}
      </div>
    `).join('');
    return `
      <div class="print-history-modal">
        ${canEdit ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="App.showLogPrint(${model.id})">+ Log Print</button></div>` : ''}
        <div class="print-history-list">
          ${printsHtml || '<div style="color:var(--text-muted);font-size:.875rem;text-align:center;padding:16px 0">No prints recorded yet</div>'}
        </div>
      </div>`;
  },

  // ── Create/Edit Model Form ──
  modelForm(model = null, categories = [], tags = []) {
    const isEdit = !!model;
    const selTags = model?.tags?.map(t => t.id) || [];
    const catOptions = categories.map(c =>
      `<option value="${c.id}" ${model?.category_id == c.id ? 'selected' : ''}>${this.escapeHtml(c.name)}</option>`
    ).join('');
    const tagCheckboxes = tags.map(t =>
      `<label class="tag-pill-checkbox">
        <input type="checkbox" name="tags" value="${t.id}" ${selTags.includes(t.id) ? 'checked' : ''}>
        <span class="tag-pill">${this.escapeHtml(t.name)}</span>
      </label>`
    ).join('');

    return `
      <form id="model-form" onsubmit="App.handleModelSubmit(event,${model?.id || 'null'})">
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" name="name" required value="${this.escapeHtml(model?.name || '')}" placeholder="e.g. Phone Stand v2" id="model-name-input">
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-select" name="category_id">
            <option value="">No category</option>${catOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Source URL (optional)</label>
          <input class="form-input" type="url" name="source_url" value="${this.escapeHtml(model?.source_url || '')}" placeholder="e.g. https://www.printables.com/...">
        </div>
        <div class="form-group">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label class="form-label" style="margin-bottom:0">Description (Markdown)</label>
            <div style="display:flex;gap:4px">
              <button type="button" class="btn btn-ghost btn-xs active" id="desc-tab-write" onclick="App.toggleDescTab('write')" style="padding:2px 8px;font-size:0.75rem">Write</button>
              <button type="button" class="btn btn-ghost btn-xs" id="desc-tab-preview" onclick="App.toggleDescTab('preview')" style="padding:2px 8px;font-size:0.75rem">Preview</button>
            </div>
          </div>
          <textarea class="form-textarea" id="model-description-input" name="description" placeholder="Describe this model using Markdown formatting, lists, links, images..." rows="4">${this.escapeHtml(model?.description || '')}</textarea>
          <div id="model-description-preview" class="glass-panel" style="display:none;padding:12px;min-height:90px;max-height:220px;overflow-y:auto;background:var(--bg-input)"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Print Tips</label>
          <textarea class="form-textarea" name="print_tips" placeholder="Recommended settings, supports needed, etc...">${this.escapeHtml(model?.print_tips || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Tags</label>
          <div id="model-tags-container" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            ${tagCheckboxes}
          </div>
          <div class="add-inline" style="max-width:250px;margin-top:4px">
            <input type="text" id="new-tag-input" class="form-input" placeholder="Add new tag..." onkeydown="if(event.key==='Enter'){event.preventDefault();App.addInlineTag();}">
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.addInlineTag()">Add</button>
          </div>
        </div>
        ${isEdit ? `
        <div class="form-group">
          <label class="protected-check">
            <input type="checkbox" name="is_protected" value="1" ${model.is_protected ? 'checked' : ''}>
            <span><strong>Password protected</strong> — opening this model asks for the password set in Settings → Security</span>
          </label>
        </div>
        ${model.kit_source_id || model.layout === 'none' ? '' : `
        <div class="form-group">
          <label class="protected-check">
            <input type="checkbox" name="is_readonly" value="1" ${Number(model.is_readonly) === 1 ? 'checked' : ''}>
            <span><strong>Read-only</strong> — 3DLib never changes, renames or deletes the files of this project; a slicer save of one of them becomes a version of that file</span>
          </label>
        </div>`}` : ''}
        ${!isEdit ? `
        <div class="form-group">
          <label class="form-label">Files (Optional)</label>
          <div class="upload-zone" id="create-upload-zone" onclick="document.getElementById('create-file-input').click()"
            ondragover="event.preventDefault();this.classList.add('dragover')"
            ondragleave="this.classList.remove('dragover')"
            ondrop="event.preventDefault();this.classList.remove('dragover');App.handleCreateFileDrop(event)">
            <div class="upload-zone-icon" style="color:var(--accent-cyan);opacity:0.8"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
            <div class="upload-zone-text"><strong>Click to browse</strong> or drag & drop files</div>
            <div style="color:var(--text-muted);font-size:.7rem;margin-top:4px">STL · Gcode · BGCODE · 3MF · OBJ · STEP · F3D · Images · Documents</div>
            <input type="file" id="create-file-input" multiple accept=".stl,.gcode,.bgcode,.3mf,.obj,.step,.stp,.f3d,.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md" onchange="App.handleCreateFileSelect(event)">
          </div>
          <div id="create-file-list" class="upload-file-list" style="display:none"></div>
          <div id="create-upload-progress" style="margin-top:12px"></div>
        </div>` : ''}
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="model-submit-btn">${isEdit ? 'Save Changes' : 'Create Model'}</button>
        </div>
      </form>`;
  },

  // ── Upload Files Form ──
  uploadForm(modelId) {
    return `
      <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()"
        ondragover="event.preventDefault();this.classList.add('dragover')"
        ondragleave="this.classList.remove('dragover')"
        ondrop="event.preventDefault();this.classList.remove('dragover');App.handleFileDrop(event,${modelId})">
        <div class="upload-zone-icon" style="color:var(--accent-cyan);opacity:0.8"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
        <div class="upload-zone-text"><strong>Click to browse</strong> or drag & drop files</div>
        <div style="color:var(--text-muted);font-size:.75rem;margin-top:6px">STL · Gcode · BGCODE · 3MF · OBJ · STEP · F3D · Images · Documents</div>
        <input type="file" id="file-input" multiple accept=".stl,.gcode,.bgcode,.3mf,.obj,.step,.stp,.f3d,.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md" onchange="App.handleFileSelect(event,${modelId})">
      </div>
      <div id="upload-progress" style="margin-top:14px"></div>`;
  },

  // ── Log Print Form ──
  // opts.fileId: a print of one part of a configuration
  printForm(modelId, materials = [], opts = {}) {
    const matOptions = materials.map(m =>
      `<option value="${m.id}">${this.escapeHtml(m.name)}${m.is_preset ? '' : ' (custom)'}</option>`
    ).join('');

    return `
      <form id="print-form" onsubmit="App.handlePrintSubmit(event,${modelId})">
        ${opts.fileId ? `<input type="hidden" name="file_id" value="${Number(opts.fileId)}">` : ''}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Material</label>
            <select class="form-select" name="material_id">${matOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Date</label>
            <input class="form-input" type="date" name="printed_at" value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-checkbox" style="font-weight:600">
            <input type="checkbox" name="successful" checked> Successful print
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Notes (optional)</label>
          <textarea class="form-textarea" name="notes" placeholder="Print settings, observations..." rows="2"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Log Print</button>
        </div>
      </form>`;
  },

  // ── Delete Confirmations ──
  deleteModelForm(id, name) {
    const safeName = this.escapeHtml(name || '');
    return `
      <form id="delete-model-form" onsubmit="App.handleDeleteModel(event, ${id})">
        <div style="margin-bottom: 16px; color: var(--text-secondary)">
          Delete <strong>"${safeName}"</strong> with all its files?
        </div>
        ${this.trashNote()}
        <div class="form-actions" style="margin-top: 24px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-danger">Delete Model</button>
        </div>
      </form>
    `;
  },

  deleteFileForm(fileId, filename, modelId) {
    return `
      <form id="delete-file-form" onsubmit="App.handleDeleteFile(event, ${fileId}, ${modelId})">
        <div style="margin-bottom: 16px; color: var(--text-secondary)">
          Delete <strong>"${this.escapeHtml(filename)}"</strong>?
        </div>
        ${this.trashNote()}
        <div class="form-actions" style="margin-top: 24px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-danger">Delete File</button>
        </div>
      </form>
    `;
  },

  // ── Toolbar ──
  toolbar(categories = [], tags = [], users = [], activeFormat = 'all') {
    const catOpts = categories.map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
    const tagOpts = tags.map(t => `<option value="${t.id}">${this.escapeHtml(t.name)}</option>`).join('');
    const userOpts = users.map(u => `<option value="${u.id}">${this.escapeHtml(u.username)}</option>`).join('');
    const formats = [
      { id: 'all', label: 'All' },
      { id: 'stl', label: 'STL' },
      { id: '3mf', label: '3MF' },
      { id: 'step', label: 'STEP' },
      { id: 'gcode', label: 'G-Code' },
      { id: 'obj', label: 'OBJ' }
    ];
    const formatPills = formats.map(f =>
      `<button type="button" id="pill-format-${f.id}" class="format-pill ${activeFormat === f.id ? 'active' : ''}" onclick="App.setFormatFilter('${f.id}', this)">${f.label}</button>`
    ).join('');

    return `
      <div class="toolbar">
        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search models, tags, categories..." id="search-input" oninput="App.handleSearch(this.value)">
        </div>
        <select class="filter-select" id="filter-category" onchange="App.handleFilter()">
          <option value="">All Categories</option>${catOpts}
        </select>
        <select class="filter-select" id="filter-tag" onchange="App.handleFilter()">
          <option value="">All Tags</option>${tagOpts}
        </select>
        <select class="filter-select" id="filter-user" onchange="App.handleFilter()">
          <option value="">All Users</option>${userOpts}
        </select>
        <select class="filter-select" id="filter-printed" onchange="App.handleFilter()">
          <option value="">All Status</option>
          <option value="true">Printed</option>
          <option value="false">Not Printed</option>
        </select>
        <select class="filter-select" id="filter-fits" onchange="App.handleFilter()" title="Only models whose 3D files fit the printer chosen in the top bar, or any of your printers">
          <option value="">All sizes</option>
          <option value="1">Fits my printer</option>
          <option value="any">Fits any of my printers</option>
        </select>
        <select class="filter-select" id="filter-sort" onchange="App.handleFilter()">
          <option value="updated">Last Updated</option>
          <option value="created">Date Created</option>
          <option value="name">Name</option>
          <option value="prints">Most Printed</option>
        </select>
        <select class="filter-select" id="filter-limit" onchange="App.handleFilter()">
          <option value="24">24 per page</option>
          <option value="48">48 per page</option>
          <option value="96">96 per page</option>
        </select>
        <div style="display:flex;gap:4px;margin-left:auto;border-left:1px solid var(--border);padding-left:12px">
          <button class="btn btn-ghost btn-sm" id="view-mode-grid" onclick="App.setViewMode('grid')" title="Grid View" style="padding:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </button>
          <button class="btn btn-ghost btn-sm" id="view-mode-list" onclick="App.setViewMode('list')" title="List View" style="padding:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="App.selectAll()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          Select All
        </button>
        <button class="btn btn-primary btn-sm" id="scan-btn" onclick="App.handleScanLibrary()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Scan Library
        </button>
        <div class="format-filter-bar" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid var(--border);flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-right:2px">Format:</span>
            ${formatPills}
          </div>
          <div id="library-summary-stats" style="font-size:0.8rem;color:var(--text-muted);font-weight:500;margin-left:auto"></div>
        </div>
      </div>`;
  },

  // ── Pagination ──
  pagination(totalPages, currentPage) {
    if (totalPages <= 1) return '';
    
    let buttons = '';
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // Always render Prev button to prevent UI jumping
    const prevDisabled = currentPage <= 1 ? 'disabled style="opacity:0.3;cursor:default"' : `onclick="App.goToPage(${currentPage - 1})"`;
    buttons += `<button class="btn btn-secondary btn-sm" ${prevDisabled}>← Prev</button>`;

    if (startPage > 1) {
      buttons += `<button class="btn btn-secondary btn-sm" onclick="App.goToPage(1)">1</button>`;
      if (startPage > 2) buttons += `<span style="padding: 4px 8px; color: var(--text-muted)">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      const activeClass = i === currentPage ? 'btn-primary' : 'btn-secondary';
      buttons += `<button class="btn ${activeClass} btn-sm" onclick="App.goToPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) buttons += `<span style="padding: 4px 8px; color: var(--text-muted)">...</span>`;
      buttons += `<button class="btn btn-secondary btn-sm" onclick="App.goToPage(${totalPages})">${totalPages}</button>`;
    }

    // Always render Next button to prevent UI jumping
    const nextDisabled = currentPage >= totalPages ? 'disabled style="opacity:0.3;cursor:default"' : `onclick="App.goToPage(${currentPage + 1})"`;
    buttons += `<button class="btn btn-secondary btn-sm" ${nextDisabled}>Next →</button>`;

    return `
      <div class="pagination-container" style="display: flex; justify-content: center; gap: 6px; margin-top: 32px; padding-bottom: 24px;">
        ${buttons}
      </div>
    `;
  },

  // ── Parts list of a project (models.parts_list), made by hand ──
  partsListOf(model) {
    if (!model || !model.parts_list) return null;
    try {
      const list = typeof model.parts_list === 'string' ? JSON.parse(model.parts_list) : model.parts_list;
      return { files: list.files || [], hardware: list.hardware || [], notes: list.notes || '' };
    } catch (e) { return null; }
  },

  // The Parts tab: the files to print with a counter each (successful prints with the file, as
  // for configurations), the hardware with a "have it" tick, notes
  partsTab(model, canEdit) {
    const esc = (s) => this.escapeHtml(s);
    const list = this.partsListOf(model);
    if (!list) {
      return `<div class="empty-state" style="padding:30px"><div class="empty-state-text">No parts list yet</div>
        <div class="empty-state-sub">What to print and how many, and the hardware to buy</div>
        ${canEdit ? `<div class="parts-toolbar" style="justify-content:center">
          <button type="button" class="btn btn-primary btn-sm" onclick="App.partsAddAll3d()">Add all 3D files, 1 each</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="App.partsEdit()">Edit list</button></div>` : ''}</div>`;
    }
    const files = new Map((model.files || []).map(f => [f.id, f]));
    const printed = {};
    for (const p of model.prints || []) if (p.successful && p.file_id) printed[p.file_id] = (printed[p.file_id] || 0) + 1;
    const parts = list.files.filter(p => p.qty > 0 && files.has(p.file_id));
    const done = parts.reduce((n, p) => n + Math.min(p.qty, printed[p.file_id] || 0), 0);
    const total = parts.reduce((n, p) => n + p.qty, 0);
    const rows = parts.map(p => {
      const f = files.get(p.file_id);
      const n = printed[p.file_id] || 0;
      const id = Number(p.file_id);
      const name = String(f.original_name || f.filename || '');
      return `
        <div class="kit-part${n >= p.qty ? ' is-printed' : ''}" title="${esc(name)}">
          <div class="kit-progress${n >= p.qty ? ' is-done' : ''}">
            ${canEdit ? `<button type="button" class="kit-step" title="Undo the last print" aria-label="One print less" onclick="App.partsPrinted(${id}, -1)"${n ? '' : ' disabled'}>−</button>` : ''}
            <button type="button" class="kit-count" title="Prints of this part: history, a print with details" onclick="App.partsPrints(${id})">${n >= p.qty ? '✓ ' : ''}${n}/${p.qty}</button>
            ${canEdit ? `<button type="button" class="kit-step is-add" title="Printed one" aria-label="One print more" onclick="App.partsPrinted(${id}, 1)">+</button>` : ''}
          </div>
          <div class="kit-part-main">
            <div class="kit-part-label">${esc(name.split('/').pop())}</div>
            ${name.includes('/') ? `<div class="kit-part-path">${esc(name)}</div>` : ''}
          </div>
          <span class="kit-part-size">${this.formatSize(f.file_size)}</span>
        </div>`;
    }).join('');
    const hardware = list.hardware.map((h, i) => `
        <label class="parts-hw${h.have ? ' is-have' : ''}">
          <input type="checkbox"${h.have ? ' checked' : ''}${canEdit ? '' : ' disabled'} onchange="App.partsHave(${i}, this.checked)" aria-label="Have it">
          <span class="parts-hw-qty">${Number(h.qty) || 0}×</span><span>${esc(h.name)}</span>
        </label>`).join('');
    return `
      ${total ? `<div class="kit-print-progress${done >= total ? ' is-done' : ''}">
        <div class="kit-print-bar"><span style="width:${Math.round(done / total * 100)}%"></span></div>
        <span class="kit-print-text">${done >= total ? '✓ ' : ''}${done} of ${total} printed</span>
        ${canEdit ? `<button type="button" class="btn btn-ghost btn-xs" onclick="App.partsFill()">Mark all printed</button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="App.partsReset()"${done ? '' : ' disabled'}>Reset progress</button>` : ''}
      </div>` : ''}
      <div class="parts-toolbar">
        <button type="button" class="btn btn-ghost btn-xs" onclick="App.partsDownloadText()">List as text</button>
        ${total && App.currentUser && App.currentUser.role !== 'viewer' ? '<button type="button" class="btn btn-ghost btn-xs" title="The files of the list and the list" onclick="App.partsDownloadZip()">Download ZIP</button>' : ''}
        ${canEdit ? '<button type="button" class="btn btn-secondary btn-xs" onclick="App.partsEdit()">Edit list</button>' : ''}
      </div>
      ${rows ? `<div class="kit-group-title">To print</div>${rows}` : ''}
      ${hardware ? `<div class="kit-group-title">Hardware</div>${hardware}` : ''}
      ${list.notes.trim() ? `<div class="kit-group-title">Notes</div><div class="parts-notes">${esc(list.notes)}</div>` : ''}`;
  },

  // Editing the parts list: every file of the project with how many to print (0: not on the
  // list), hardware rows, notes
  partsEditor(model) {
    const esc = (s) => this.escapeHtml(s);
    const list = this.partsListOf(model) || { files: [], hardware: [], notes: '' };
    const qty = new Map(list.files.map(p => [p.file_id, p.qty]));
    const files = (model.files || []).slice().sort((a, b) => this.compareNames(a.original_name || '', b.original_name || ''));
    const rows = files.map(f => {
      const name = String(f.original_name || f.filename || '');
      return `
        <div class="kit-part" data-file-id="${Number(f.id)}">
          <input type="number" class="kit-qty" min="0" max="9999" value="${Number(qty.get(f.id)) || 0}" aria-label="How many to print">
          <div class="kit-part-main">
            <div class="kit-part-label">${esc(name.split('/').pop())}</div>
            ${name.includes('/') ? `<div class="kit-part-path">${esc(name)}</div>` : ''}
          </div>
          <span class="kit-part-size">${this.formatSize(f.file_size)}</span>
        </div>`;
    }).join('');
    return `
      <div class="parts-editor">
        <div class="parts-toolbar">
          <span class="kit-print-text" style="margin-right:auto">How many of each file to print (0: not on the list)</span>
          <button type="button" class="btn btn-secondary btn-xs" onclick="App.partsCancel()">Cancel</button>
          <button type="button" class="btn btn-primary btn-xs" onclick="App.partsSave()">Save</button>
        </div>
        <div class="kit-group-title">Files</div>
        ${rows || '<div class="parts-notes">No files</div>'}
        <div class="kit-group-title">Hardware</div>
        <div id="parts-hw-rows">${list.hardware.map(h => this.partsHardwareRow(h)).join('')}</div>
        <div class="parts-toolbar" style="justify-content:flex-start"><button type="button" class="btn btn-ghost btn-xs" onclick="App.partsAddHardware()">+ Add hardware</button></div>
        <div class="kit-group-title">Notes</div>
        <div style="padding:0 16px 16px"><textarea class="form-textarea" id="parts-notes" rows="3" maxlength="5000" placeholder="Print settings, order of assembly...">${esc(list.notes)}</textarea></div>
      </div>`;
  },

  partsHardwareRow(h = { name: '', qty: 1, have: false }) {
    return `
      <div class="parts-hw-edit" data-have="${h.have ? 1 : 0}">
        <input type="number" class="kit-qty" min="0" max="9999" value="${Number(h.qty) || 0}" aria-label="How many">
        <input type="text" class="form-input" maxlength="120" value="${this.escapeHtml(h.name)}" placeholder="e.g. Screw M3×8" aria-label="Hardware">
        <button type="button" class="kit-icon-btn is-danger" title="Remove" onclick="this.closest('.parts-hw-edit').remove()">×</button>
      </div>`;
  },

  // ── Settings panels ──
  settingsPanel(title, items, type) {
    const listHtml = items.map(item => {
      const color = item.color ? `<span class="color-dot" style="background:${this.escapeHtml(item.color)}"></span>` : '';
      const preset = item.is_preset ? '<span style="font-size:.7rem;color:var(--text-muted);margin-left:4px">(preset)</span>' : '';
      const count = item.model_count != null ? `<span style="font-size:.75rem;color:var(--text-muted)">${item.model_count || item.usage_count || 0}</span>` : '';
      const canDelete = type === 'materials' ? !item.is_preset : true;
      const isAdmin = App.currentUser?.role === 'admin';
      return `<div class="settings-item">
        <span class="settings-item-name">${color} ${this.escapeHtml(item.name)}${preset}</span>
        <div class="settings-item-actions">
          ${count}
          ${canDelete && isAdmin ? `<button class="btn btn-ghost btn-xs" style="color:var(--error);padding:4px" onclick="App.deleteSettingsItem('${type}',${item.id},${this.jsArg(item.name)})"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>` : ''}
        </div>
      </div>`;
    }).join('');

    const colorInput = type === 'categories' ? `
      <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:2px solid var(--border);position:relative">
        <input type="color" id="add-${type}-color" value="#8b5cf6" style="width:150%;height:150%;position:absolute;top:-25%;left:-25%;border:none;background:none;cursor:pointer">
      </div>` : '';

    const iconMap = {
      categories: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.6"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
      tags: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.6"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
      materials: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.6"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>'
    };

    const defaultMatBlock = type === 'materials' ? `
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <label class="form-label" style="margin-bottom:6px">Default Print Material</label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select class="form-select" id="default-material-select" onchange="App.setDefaultMaterial(this.value)" style="max-width:220px">
            ${items.map(m => {
              const def = localStorage.getItem('3dl_default_material') || 'PLA';
              const isSel = (String(m.id) === String(def) || m.name.toLowerCase() === def.toLowerCase());
              return `<option value="${m.id}" ${isSel ? 'selected' : ''}>${this.escapeHtml(m.name)}</option>`;
            }).join('')}
          </select>
          <span style="font-size:0.75rem;color:var(--text-muted)">Pre-selected when logging new prints</span>
        </div>
      </div>` : '';

    return `<div class="glass-panel">
      <div class="panel-header"><div class="panel-title">${iconMap[type] || ''} ${title}</div></div>
      <div class="panel-body">
        ${defaultMatBlock}
        ${listHtml || '<div style="color:var(--text-muted);font-size:.875rem;padding:8px 0">None yet</div>'}
        ${App.currentUser?.role === 'admin' ? `
        <div class="add-inline" style="margin-top:14px">
          <input class="form-input" id="add-${type}-input" placeholder="Add new ${type.slice(0,-1)}...">
          ${colorInput}
          <button class="btn btn-primary btn-sm" onclick="App.addSettingsItem('${type}')">Add</button>
        </div>` : ''}
      </div>
    </div>`;
  },

  // ── Dashboard sections ──
  recentModels(models) {
    if (!models.length) return '<div style="color:var(--text-muted);padding:8px 0;font-size:.875rem">No models yet</div>';
    return models.map(m => `
      <div class="activity-item" style="cursor:pointer" onclick="App.navigate('/models/${m.id}')">
        <div class="activity-dot" style="background:${this.escapeHtml(m.category_color || 'var(--text-muted)')}"></div>
        <div style="flex:1;font-weight:500">${this.escapeHtml(m.name)}</div>
        <span style="font-size:.75rem;color:var(--text-muted)">${this.formatDateShort(m.created_at)}</span>
      </div>`).join('');
  },

  recentPrints(prints) {
    if (!prints.length) return '<div style="color:var(--text-muted);padding:8px 0;font-size:.875rem">No prints logged yet</div>';
    return prints.map(p => `
      <div class="activity-item" style="cursor:pointer" onclick="App.navigate('/models/${p.model_id}')">
        <div class="print-status ${p.successful ? 'success' : 'failed'}"></div>
        <div style="flex:1"><span style="font-weight:500">${this.escapeHtml(p.model_name)}</span> <span style="color:var(--text-muted);font-size:.8rem">— ${this.escapeHtml(p.material_name || 'Unknown')}</span></div>
        <span style="font-size:.75rem;color:var(--text-muted)">${this.formatDateShort(p.printed_at)}</span>
      </div>`).join('');
  },

  materialChart(usage) {
    if (!usage.length) return '<div style="color:var(--text-muted);padding:8px 0;font-size:.875rem">No data yet</div>';
    const max = Math.max(...usage.map(u => u.count));
    return usage.map(u => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="width:50px;font-size:.8rem;font-weight:600;text-align:right">${this.escapeHtml(u.name)}</span>
        <div style="flex:1;height:24px;background:var(--bg-input);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${(u.count/max)*100}%;background:var(--accent-gradient);border-radius:6px;transition:width .5s ease"></div>
        </div>
        <span style="font-size:.75rem;color:var(--text-muted);width:24px">${u.count}</span>
      </div>`).join('');
  },

  loginForm(allowRegistration = false) {
    return `
      <form onsubmit="App.handleLogin(event)" class="form-grid">
        <div class="form-group">
          <label>Username or Email</label>
          <input type="text" name="username" required placeholder="Enter username or email" class="form-input">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required placeholder="Enter password" class="form-input">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px">
          <div style="display:flex; flex-direction:column; gap:4px">
            ${allowRegistration ? `<a href="#" onclick="event.preventDefault();App.showRegister()" style="font-size:.85rem;color:var(--accent-cyan)">No account? Register</a>` : ''}
            <a href="#" onclick="event.preventDefault();App.showForgotPassword()" style="font-size:.75rem;color:var(--text-muted)">Forgot password?</a>
          </div>
          <button type="submit" class="btn btn-primary">Login</button>
        </div>
      </form>`;
  },

  registerForm(token = '') {
    return `
      <form onsubmit="App.handleRegister(event)" class="form-grid">
        <input type="hidden" name="token" value="${this.escapeHtml(token)}">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" required placeholder="Choose username" class="form-input">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" required placeholder="Your email address" class="form-input">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" required placeholder="Choose password" class="form-input">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px">
          <a href="#" onclick="event.preventDefault();App.showLogin()" style="font-size:.85rem;color:var(--accent-cyan)">Already have an account? Login</a>
          <button type="submit" class="btn btn-primary">Register</button>
        </div>
      </form>`;
  },

  forgotPasswordForm() {
    return `
      <form onsubmit="App.handleForgotPassword(event)" class="form-grid">
        <p style="color:var(--text-secondary);font-size:.85rem;margin-bottom:16px">Enter your email and we'll send you a reset link.</p>
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" required placeholder="Your email address" class="form-input">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px">
          <a href="#" onclick="event.preventDefault();App.showLogin()" style="font-size:.85rem;color:var(--accent-cyan)">Back to Login</a>
          <button type="submit" class="btn btn-primary">Send Link</button>
        </div>
      </form>`;
  },

  resetPasswordForm(token) {
    return `
      <form onsubmit="App.handleResetPassword(event)" class="form-grid">
        <input type="hidden" name="token" value="${this.escapeHtml(token)}">
        <div class="form-group">
          <label>New Password</label>
          <input type="password" name="password" required placeholder="Enter new password" class="form-input">
        </div>
        <div class="form-group">
          <label>Confirm Password</label>
          <input type="password" name="confirm" required placeholder="Confirm new password" class="form-input">
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:20px">
          <button type="submit" class="btn btn-primary">Reset Password</button>
        </div>
      </form>`;
  },

  // ─── Printer fit check (public/js/printfit.js, App.paintFit) ────────────
  // The bar in the corner of a file list: how the files fare against the printer chosen in the
  // top bar (App.setFitPrinter).
  // s: PrintFit.summarize(); what: 'files' or 'parts'
  // s: PrintFit.summarize for the chosen printer. others, for the parts too big for it:
  // { names: my other printers that take all of them, none: how many fit no printer of mine }
  fitBar(beds, chosen, s, what = 'files', others = null) {
    const esc = (t) => this.escapeHtml(t);
    const bed = (beds || []).find(b => b.id === chosen);
    const target = bed ? bed.name : 'one of your printers';
    const none = others ? others.none : s.misfit.length;
    const elsewhere = s.misfit.length - none;
    let status = '';
    if (!(beds || []).length) status = '<span class="fit-status">Add your printers in Settings → Printers</span>';
    else if (!s.total) status = '';
    else if (s.misfit.length && bed && !none) {
      status = `<span class="fit-status is-other" title="Marked ⚠ in the list, with a printer that takes them">⚠ ${s.misfit.length} of ${s.total} ${what} too big for ${esc(bed.name)}; ${others.names.length ? `they fit ${esc(others.names.join(', '))}` : 'each fits another of your printers'}</span>`;
    } else if (s.misfit.length && bed && elsewhere) {
      status = `<span class="fit-status is-bad" title="✗ in the list: too big for all of your printers; ⚠: another printer takes it">✗ ${s.misfit.length} of ${s.total} ${what} too big for ${esc(bed.name)}: ${elsewhere} fit another printer, ${none} none</span>`;
    } else if (s.misfit.length) status = `<span class="fit-status is-bad" title="Too big for ${esc(bed ? bed.name : 'all of your printers')}: marked ✗ in the list">✗ ${s.misfit.length} of ${s.total} ${what} too big for ${esc(bed ? `${bed.name} and your other printers` : 'all your printers')}</span>`;
    else if (s.pending) status = `<span class="fit-status">Measuring ${s.pending} of ${s.total} ${what}...</span>`;
    else status = `<span class="fit-status is-ok">✓ All ${s.measured} ${what} fit ${esc(target)}${s.failed ? ` (${s.failed} could not be measured)` : ''}</span>`;
    if (s.misfit.length && s.pending) status += `<span class="fit-status">, measuring ${s.pending}...</span>`;
    return `<svg class="fit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>${status}<span class="fit-hint">printer: top bar</span>`;
  },

  // The size of one 3D file and whether it fits: ✓, or ✗ with the printers it does fit
  fitDim(size, error, beds, chosen) {
    if (error) return '<span class="fit-dim-text" title="This file could not be measured">size unknown</span>';
    if (!size) return '<span class="fit-dim-text">measuring...</span>';
    const list = chosen && chosen !== 'any' ? (beds || []).filter(b => b.id === chosen) : (beds || []);
    const ok = PrintFit.fitting(size, list);
    const all = PrintFit.fitting(size, beds || []);
    const how = (f) => (PrintFit.howText(f.fit) ? ` ${PrintFit.howText(f.fit)}` : '');
    const title = all.length ? `Fits: ${all.map(f => `${f.bed.name}${how(f)}`).join('; ')}` : 'Too big for all of your printers';
    const first = ok.length ? ok[0].fit : null;
    const chosenBed = (beds || []).find(b => b.id === chosen);
    const other = !first && chosenBed && all.length ? all[0] : null;
    const flag = !(beds || []).length ? '' : first
      ? `<span class="fit-flag is-ok" title="${this.escapeHtml(title)}">✓${first.up !== 'z' ? ' on side' : ''}${first.angle ? ` ${first.angle}°` : ''}</span>`
      : other
        ? `<span class="fit-flag is-other" title="${this.escapeHtml(`Too big for ${chosenBed.name}. ${title}`)}">⚠ ${this.escapeHtml(other.bed.name)}</span>`
        : `<span class="fit-flag is-bad" title="${this.escapeHtml(title)}">✗ too big</span>`;
    return `<span class="fit-dim-text">${PrintFit.sizeText(size)}</span>${flag}`;
  },

  // Settings -> Printers: the build volumes the fit check uses
  printerBedsForm(beds = []) {
    const row = (b) => `
      <div class="bed-row" data-bed-id="${this.escapeHtml(b.id || '')}">
        <input class="form-input bed-name" value="${this.escapeHtml(b.name || '')}" placeholder="Printer name" maxlength="60" aria-label="Printer name">
        <input class="form-input bed-num" type="number" min="10" max="2000" step="0.1" value="${b.x ?? ''}" placeholder="X" aria-label="Width X (mm)">
        <input class="form-input bed-num" type="number" min="10" max="2000" step="0.1" value="${b.y ?? ''}" placeholder="Y" aria-label="Depth Y (mm)">
        <input class="form-input bed-num" type="number" min="10" max="2000" step="0.1" value="${b.z ?? ''}" placeholder="Z" aria-label="Height Z (mm)">
        <input class="form-input bed-num" type="number" min="0" max="50" step="0.5" value="${b.margin ?? 0}" placeholder="0" aria-label="Margin at the edges (mm)">
        <button type="button" class="btn btn-ghost btn-xs" onclick="this.closest('.bed-row').remove()" title="Remove">Remove</button>
      </div>`;
    return `
      <p class="form-hint" style="margin:0 0 12px;font-size:.8rem;color:var(--text-muted)">The model page and the configurator check every 3D file against these build volumes: the height must fit, the footprint straight, turned 90° or on the diagonal; a part too big as placed is also tried laid on its side. Margin: space kept free at the edges of the bed.</p>
      <div class="bed-head"><span>Printer</span><span>X mm</span><span>Y mm</span><span>Z mm</span><span>Margin</span><span></span></div>
      <div id="bed-rows">${beds.map(row).join('')}</div>
      <template id="bed-row-template">${row({ margin: 0 })}</template>
      <div class="form-actions" style="justify-content:flex-start">
        <button type="button" class="btn btn-secondary" onclick="App.addPrinterBedRow()">+ Add printer</button>
        <button type="button" class="btn btn-primary" onclick="App.savePrinterBeds()">Save</button>
      </div>`;
  },

  printersSettingsForm(printers = []) {
    const list = printers.map(p => `
      <div class="settings-item">
        <div style="flex:1">
          <div style="font-weight:500">${this.escapeHtml(p.name)}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);display:flex;align-items:center;gap:4px">${this.escapeHtml(p.url)} ${p.api_key ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent-yellow)" title="API Key Configured"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3M18.5 4.5l3 3"/></svg>' : ''}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="App.deletePrinter('${p.id}')">Delete</button>
      </div>
    `).join('');
    
    return `
      ${list || '<div style="color:var(--text-muted);font-size:.875rem;padding:8px 0">No printers configured</div>'}
      <form onsubmit="App.handleAddPrinter(event)" class="form-grid" style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border)">
        <h4>Add Moonraker / Klipper Printer</h4>
        <div class="form-group">
          <label>Printer Name</label>
          <input type="text" name="name" required class="form-input" placeholder="e.g. Voron 2.4">
        </div>
        <div class="form-group">
          <label>Printer URL</label>
          <input type="url" name="url" required class="form-input" placeholder="e.g. http://192.168.1.100">
        </div>
        <div class="form-group">
          <label>API Key (Optional)</label>
          <input type="password" name="api_key" class="form-input" placeholder="If required by Moonraker">
        </div>
        <div>
          <button type="submit" class="btn btn-primary">Add Printer</button>
        </div>
      </form>
    `;
  },

  sendToPrinterForm(fileId, printers = []) {
    const options = printers.map(p => `<option value="${p.id}">${this.escapeHtml(p.name)} (${this.escapeHtml(p.url)})</option>`).join('');
    return `
      <form onsubmit="App.handleSendToPrinter(event, ${fileId})">
        <div class="form-group">
          <label class="form-label">Select Printer</label>
          <select class="form-select" name="printer_id">
            ${options}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Send to Printer</button>
        </div>
      </form>`;
  },

  systemSettingsForm(config = {}) {
    config = config || {};
    return `
      <form onsubmit="App.handleSaveSystemSettings(event)" class="form-grid">
        <h3 style="grid-column: 1 / -1; margin-bottom: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 5px;">General Settings</h3>
        <div class="form-group" style="grid-column: 1 / -1">
          <label style="font-weight:600">Default Library View Mode</label>
          <select name="library_view_mode" class="form-input" style="max-width:420px;margin-bottom:12px">
            <option value="grid" ${(config.library_view_mode || 'grid') === 'grid' ? 'selected' : ''}>All Models (Flat Grid Gallery)</option>
            <option value="folder" ${config.library_view_mode === 'folder' ? 'selected' : ''}>Folder View (Disk Directory Hierarchy)</option>
          </select>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;margin-top:4px">
            <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start">
              <div style="width:36px;height:36px;border-radius:6px;background:rgba(59,130,246,0.1);color:var(--accent-cyan);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </div>
              <div>
                <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:3px">All Models (Flat Grid Gallery)</div>
                <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.4">Displays all indexed 3D models across subfolders in a single unified gallery. Best for fast global searching, tag filtering, and print status tracking.</div>
              </div>
            </div>
            <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start">
              <div style="width:36px;height:36px;border-radius:6px;background:rgba(245,158,11,0.1);color:var(--warning);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div>
                <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:3px">Folder View (Directory Hierarchy)</div>
                <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.4">Mirrors your exact storage directory layout on disk. Browse and drill down through nested folders and collections just like a file manager.</div>
              </div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Auto-Scan Interval (Hours)</label>
          <input type="number" name="auto_scan_interval" value="${config.auto_scan_interval !== undefined ? config.auto_scan_interval : 24}" min="0" max="168" class="form-input">
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Set to 0 to disable background scanning. Default is 24.</p>
        </div>
        <div class="form-group">
          <label>Keep Deleted Items in the Trash (Days)</label>
          <input type="number" name="trash_retention_days" value="${config.trash_retention_days !== undefined ? config.trash_retention_days : 30}" min="0" max="3650" class="form-input">
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Then they are deleted from disk for good (checked every hour). Set to 0 to keep them until the Trash is emptied. Default is 30.</p>
        </div>
        <div class="form-group">
          <label>Slicer Saves: Wait After the Last Save (Minutes)</label>
          <input type="number" name="slicer_quiet_minutes" value="${config.slicer_quiet_minutes !== undefined ? config.slicer_quiet_minutes : 5}" min="0" max="1440" class="form-input">
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">A project saved to <code>.slicer-saves</code> replaces its library file once the slicer has not saved it for this long, so quick saves in a row make one version. 0 = right away. Default is 5.</p>
        </div>
        <div class="form-group">
          <label>Slicer Saves: Clean Up After (Days)</label>
          <input type="number" name="slicer_cleanup_days" value="${config.slicer_cleanup_days !== undefined ? config.slicer_cleanup_days : 1}" min="0" max="3650" class="form-input">
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Unchanged downloads and imported files are deleted from <code>.slicer-saves</code> this long after the last save, older copies of a file saved again at once. Unimported changes are never deleted. 0 = only older copies. Default is 1.</p>
        </div>
        <div class="form-group">
          <label>File History: Versions Kept per File</label>
          <input type="number" name="file_versions_keep" value="${config.file_versions_keep !== undefined ? config.file_versions_keep : 10}" min="1" max="1000" class="form-input">
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Earlier contents kept in the project's hidden <code>.versions</code> folder; older ones are deleted. Default is 10.</p>
        </div>
        <div class="form-group" style="grid-column: 1 / -1; margin-top: 10px;">
          <label class="toggle-item">
            <div>
              <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">Scan & Index ZIP Archives</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Deep inspect .zip archive files to index internal 3D models and images without unpacking to disk.</div>
            </div>
            <input type="checkbox" name="scan_zip_archives" value="true" ${config.scan_zip_archives === 'false' || config.scan_zip_archives === false ? '' : 'checked'} onchange="App.handleToggleSystemSetting('scan_zip_archives', this.checked, 'ZIP archive scanning')">
            <span class="toggle-switch"></span>
          </label>
        </div>

        <div style="grid-column: 1 / -1; margin-top:20px">
          <button type="submit" class="btn btn-primary">Save General Settings</button>
        </div>
      </form>`;
  },

  securitySettingsForm(config = {}) {
    config = config || {};
    return `
      <form onsubmit="App.handleSaveSystemSettings(event)" style="display:flex;flex-direction:column;gap:20px">
        <div style="display:flex;flex-direction:column;gap:14px">
          <label class="toggle-item">
            <div>
              <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">Enable Open Registration</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Allows anyone to register an account without needing an invite code.</div>
            </div>
            <input type="checkbox" name="open_registration" value="true" ${config.open_registration === 'true' ? 'checked' : ''} onchange="App.handleToggleSystemSetting('open_registration', this.checked, 'Open registration')">
            <span class="toggle-switch"></span>
          </label>

          <label class="toggle-item">
            <div>
              <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">Private Instance Mode</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">Forces all guests to log in before viewing any models or library files.</div>
            </div>
            <input type="checkbox" name="require_login_to_view" value="true" ${config.require_login_to_view === 'true' ? 'checked' : ''} onchange="App.handleToggleSystemSetting('require_login_to_view', this.checked, 'Private instance mode')">
            <span class="toggle-switch"></span>
          </label>
        </div>

        <div>
          <button type="submit" class="btn btn-primary">Save Security Settings</button>
        </div>
      </form>

      <div style="margin-top:32px; border-top:1px solid var(--border); padding-top:20px">
        <h3 style="margin-bottom:8px; font-size:1.1rem; color:var(--text-primary); display:flex; align-items:center; gap:8px"><svg style="color:var(--accent-purple)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Password-protected Models</h3>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px;max-width:640px">
          Mark a model as password protected in its Edit form. Every opening of such a model asks for this password; its files cannot be opened or downloaded without it. In lists its thumbnail is blurred.
          <div style="margin-top:6px;color:var(--text-secondary)">Status: ${App.publicConfig && App.publicConfig.protection_password_set ? '<strong style="color:var(--success, #22c55e)">password set</strong>' : '<strong style="color:var(--accent-yellow, #fbbf24)">no password</strong> — protected models open without one'}</div>
        </div>
        <form onsubmit="App.saveProtectionPassword(event)" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="text" name="new_unlock_code" class="form-input masked-input" placeholder="New password" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" minlength="4" required style="max-width:260px">
          <button type="submit" class="btn btn-primary btn-sm">${App.publicConfig && App.publicConfig.protection_password_set ? 'Change password' : 'Set password'}</button>
          ${App.publicConfig && App.publicConfig.protection_password_set ? '<button type="button" class="btn btn-ghost btn-sm" onclick="App.removeProtectionPassword()">Remove password</button>' : ''}
        </form>
      </div>

      <div style="margin-top:32px; border-top:1px solid var(--border); padding-top:20px">
        <h3 style="margin-bottom:12px; font-size:1.1rem; color:var(--text-primary); display:flex; align-items:center; gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent-purple)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Blocked IP Addresses</h3>
        <div id="blocked-ips-container">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="App.loadBlockedIps()">Refresh Blocked IPs</button>
            <span style="font-size:0.75rem;color:var(--text-muted)">Unblock IP addresses flagged for failed login attempts.</span>
          </div>
          <div id="blocked-ips-list"></div>
        </div>
      </div>`;
  },

  maintenanceSettingsForm() {
    return `
      <div style="display:flex;flex-direction:column;gap:24px">
        <div>
          <h3 style="margin-bottom:8px; font-size:1.1rem; color:var(--text-primary); display:flex; align-items:center; gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent-cyan)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Duplicate File Finder</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px">Scans your library using SHA-256 file hashes to find identical 3D model files across different folders or models.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick="App.scanForDuplicates()">Scan for Duplicate Files</button>
          <div id="duplicates-results" style="margin-top:16px"></div>
        </div>
        <div>
          <h3 style="margin-bottom:8px; font-size:1.1rem; color:var(--text-primary); display:flex; align-items:center; gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent-cyan)"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Regenerate Covers</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px">Renders again the covers made by the 3D viewer (now with a transparent background that fits both themes), and covers for STL / 3MF models that have none. Covers from 3MF thumbnails and images are kept. Runs in this browser tab: keep it open until it finishes.</p>
          <button type="button" class="btn btn-primary btn-sm" id="regenerate-covers-btn" onclick="App.regenerateCovers()">Regenerate Covers</button>
          <div id="regenerate-covers-status" class="covers-status"></div>
        </div>
      </div>`;
  },

  smtpSettingsForm(config = {}) {
    config = config || {};
    return `
      <form onsubmit="App.handleSaveSMTP(event)" class="form-grid">
        <div class="form-group">
          <label>SMTP Host</label>
          <input type="text" name="smtp_host" value="${this.escapeHtml(config.smtp_host || '')}" placeholder="smtp.gmail.com" class="form-input">
        </div>
        <div class="form-group">
          <label>SMTP Port</label>
          <input type="number" name="smtp_port" value="${this.escapeHtml(config.smtp_port || 587)}" class="form-input">
        </div>
        <div class="form-group">
          <label>SMTP User</label>
          <input type="text" name="smtp_user" value="${this.escapeHtml(config.smtp_user || '')}" class="form-input">
        </div>
        <div class="form-group">
          <label>SMTP Password</label>
          <input type="password" name="smtp_pass" value="${this.escapeHtml(config.smtp_pass || '')}" class="form-input">
        </div>
        <div class="form-group">
          <label>From Email</label>
          <input type="text" name="smtp_from" value="${this.escapeHtml(config.smtp_from || '')}" placeholder="3DLib <noreply@example.com>" class="form-input">
        </div>
        <div class="form-group">
          <label>Secure (SSL/TLS)</label>
          <select name="smtp_secure" class="form-input">
            <option value="false" ${config.smtp_secure === 'false' ? 'selected' : ''}>STARTTLS (Port 587)</option>
            <option value="true" ${config.smtp_secure === 'true' ? 'selected' : ''}>SSL (Port 465)</option>
          </select>
        </div>
        <div style="margin-top:20px; display:flex; gap:10px;">
          <button type="submit" class="btn btn-primary">Save SMTP Settings</button>
          <button type="button" class="btn btn-secondary" onclick="App.testSMTP(event)">Send Test Email</button>
        </div>
      </form>`;
  },

  profilePage(user) {
    return `
      <div class="page-header">
        <div><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your account settings</p></div>
      </div>
      <div class="card" style="max-width:600px">
        <form onsubmit="App.handleUpdateProfile(event)" class="form-grid">
          <div class="form-group">
            <label>Username</label>
            <input type="text" name="username" value="${this.escapeHtml(user.username)}" required class="form-input">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" value="${this.escapeHtml(user.email || '')}" required class="form-input">
          </div>
          <div class="form-group">
            <label>New Password (leave blank to keep current)</label>
            <input type="password" name="password" placeholder="••••••••" class="form-input">
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Must be at least 8 characters and contain both letters and numbers.</p>
          </div>
          <div class="form-group">
            <label>Preferred Slicer</label>
            <select name="preferred_slicer" class="form-input">
              <option value="" ${!user.preferred_slicer ? 'selected' : ''}>None (Ask every time)</option>
              <option value="orcaslicer" ${user.preferred_slicer === 'orcaslicer' ? 'selected' : ''}>OrcaSlicer</option>
              <option value="elegooslicer" ${user.preferred_slicer === 'elegooslicer' ? 'selected' : ''}>Elegoo Slicer</option>
              <option value="cura" ${user.preferred_slicer === 'cura' ? 'selected' : ''}>Ultimaker Cura</option>
              <option value="bambustudio" ${user.preferred_slicer === 'bambustudio' ? 'selected' : ''}>Bambu Studio</option>
            </select>
          </div>
          <div style="margin-top:20px">
            <button type="submit" class="btn btn-primary">Update Profile</button>
          </div>
        </form>
      </div>`;
  },

  projectsPage(projects) {
    const list = projects.map(p => this.projectCard(p)).join('');
    return `
      <div class="page-header">
        <div><h1 class="page-title">Collections</h1><p class="page-subtitle">Group models into collections</p></div>
        ${App.currentUser?.role !== 'viewer' ? '<button class="btn btn-primary" onclick="App.showCreateProject()">+ New Collection</button>' : ''}
      </div>
      <div class="model-grid" id="collections-grid">
        ${list || '<div class="empty-state" style="grid-column: 1/-1">No collections yet</div>'}
      </div>`;
  },

  projectCard(p) {
    return `
      <div class="model-card" onclick="App.navigate('/projects/${p.id}')">
        <div class="model-card-thumb">
          ${p.thumbnail ? `<img src="${this.imgSrc('/uploads/' + p.thumbnail, 480)}" loading="lazy" decoding="async">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);opacity:.35"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>'}
        </div>
        <div class="model-card-body">
          <div class="model-card-title">${p.visibility === 'private' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;color:var(--accent-purple)"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}${this.escapeHtml(p.name)}</div>
          <div class="model-card-meta">${p.model_count} models</div>
        </div>
      </div>`;
  },

  projectDetail(project) {
    const models = project.models.map(m => this.modelCard(m)).join('');
    return `
      <div class="page-header">
        <div>
          <div class="breadcrumbs" style="margin-bottom:8px">
            <a href="#/collections"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Back to Collections</a>
          </div>
          <h1 class="page-title">${project.visibility === 'private' ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px;color:var(--accent-purple)"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}${this.escapeHtml(project.name)}</h1>
          <p class="page-subtitle">${this.escapeHtml(project.description || 'No description')}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-danger btn-sm" onclick="App.deleteProject(${project.id})" style="display:inline-flex;align-items:center;gap:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete</button>
        </div>
      </div>
      <div class="model-grid">
        ${models || '<div class="empty-state" style="grid-column: 1/-1">No models in this collection yet</div>'}
      </div>`;
  },

  projectForm(project = null) {
    return `
      <form onsubmit="App.handleProjectSubmit(event, ${project?.id || 'null'})" class="form-grid">
        <div class="form-group">
          <label>Collection Name</label>
          <input type="text" name="name" value="${this.escapeHtml(project?.name || '')}" required class="form-input" placeholder="e.g. Iron Man Helm">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" class="form-textarea" placeholder="What is this collection about?">${this.escapeHtml(project?.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Visibility</label>
          <select name="visibility" class="form-input">
            <option value="public" ${project?.visibility === 'public' ? 'selected' : ''}>Public (Visible to everyone)</option>
            <option value="private" ${project?.visibility === 'private' ? 'selected' : ''}>Private (Only you can see this)</option>
          </select>
        </div>
        <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:8px">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${project ? 'Save' : 'Create'}</button>
        </div>
      </form>`;
  },

  smtpTestModal(defaultEmail = '') {
    return `
      <form onsubmit="App.handleSendTestEmail(event)" class="form-grid">
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 16px;">
          Enter the email address where you would like to receive the test message.
        </p>
        <div class="form-group">
          <label>Recipient Email</label>
          <input type="email" name="test_email" value="${defaultEmail}" required placeholder="e.g. you@example.com" class="form-input">
        </div>
        <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="send-test-btn">Send Test</button>
        </div>
      </form>`;
  },

  shareModal(modelId) {
    return `
      <div class="form-grid">
        <p style="color:var(--text-secondary);font-size:.9rem;margin-bottom:16px">Create a public link to share this model with others.</p>
        <div class="form-group">
          <label>Expiry (optional)</label>
          <select id="share-expiry" class="form-input">
            <option value="">Never expires</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="App.generateShare(${modelId})" style="width:100%;margin-top:10px">Generate Link</button>
        <div id="share-result" style="margin-top:20px;display:none">
          <label>Public Link</label>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input type="text" id="share-link-input" readonly class="form-input" style="flex:1">
            <button class="btn btn-secondary" onclick="App.copyShareLink()">Copy</button>
          </div>
        </div>
      </div>`;
  },

  publicModelDetail(model) {
    // Simplified version of modelDetail for public viewing
    const stlFile = model.files.find(f => f.file_type === 'stl') || model.files.find(f => f.file_type === '3mf') || model.files.find(f => f.file_type === 'step');
    return `
      <div style="max-width:1000px;margin:0 auto;padding:20px">
        <div class="detail-header">
          <div><h1 class="page-title">${this.escapeHtml(model.name)}</h1><p class="page-subtitle">Public Shared Model</p></div>
        </div>
        <div class="detail-layout">
          <div>
            ${stlFile ? `
              <div class="glass-panel" style="margin-bottom:24px">
                <div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>3D Studio Preview</div></div>
                <div class="panel-body no-pad">
                  <div class="viewer-container" id="public-viewer" data-stl-url="${this.escapeHtml(stlFile.url)}"></div>
                </div>
              </div>` : ''}
            <div class="glass-panel">
              <div class="panel-header"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Description</div></div>
              <div class="panel-body">${model.description ? this.renderMarkdown(model.description) : 'No description'}</div>
            </div>
          </div>
          <div>
            <div class="glass-panel">
              <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center"><div class="panel-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Files</div>${(model.files && model.files.length > 0) ? `<a href="/api/models/${model.id}/download${model.share_slug ? '?share=' + encodeURIComponent(model.share_slug) : ''}" class="btn btn-primary btn-xs" download style="display:inline-flex;align-items:center;gap:4px;text-decoration:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download All (.zip)</a>` : ''}</div>
              <div class="panel-body no-pad">
                ${model.files.map(f => `
                  <div class="file-item">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
                      ${this.fileTypeIcon(f.file_type)}
                      <div style="min-width:0;flex:1">
                        <div class="file-name" title="${this.escapeHtml(f.original_name)}">${this.escapeHtml(f.original_name)}</div>
                        <div class="file-meta">${this.formatSize(f.file_size)}</div>
                      </div>
                    </div>
                    <a href="${this.escapeHtml(f.url)}" download class="file-action-btn" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>`;
  },

  aboutSection(version) {
    return `
      <div class="glass-panel">
        <div class="panel-header"><div class="panel-title">About 3DLib</div></div>
        <div class="panel-body">
          <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">
            <div style="display:flex;align-items:center;justify-content:center">
              <img src="/img/logo.svg?v=1" alt="3DLib" style="width:84px;height:84px;object-fit:contain">
            </div>
            <div style="flex:1;min-width:220px">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
                <h3 style="margin:0;font-size:1.4rem;background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent">3DLib</h3>
                ${version ? `<span class="badge badge-tag" style="background:var(--bg-input)">v${this.escapeHtml(version)}</span>` : ''}
              </div>
              <p style="margin:0;font-size:.9rem;color:var(--text-secondary)">Self-hosted library of 3D printing models.</p>
            </div>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:20px;font-size:.85rem;line-height:1.6;color:var(--text-secondary)">
            3DLib is based on <a href="https://github.com/TeeCodeDev/GyroidVault" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);font-weight:600">GyroidVault</a> by TeeCodeDev and, like it, is licensed under the
            <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);font-weight:600">GNU Affero General Public License v3.0</a>.
          </div>
        </div>
      </div>`;
  },

  renderMarkdown(text) {
    if (!text) return '';
    let escaped = String(text)
      .replace(/\u0000/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Code waits aside while the other rules run ("# comment" in a code block is no heading)
    const code = [];
    const keep = html => `\u0000${code.push(html) - 1}\u0000`;

    // Fenced code blocks
    escaped = escaped.replace(/```([\s\S]*?)```/g, (m, src) => keep(`<pre><code>${src.trim()}</code></pre>`));

    // Inline code
    escaped = escaped.replace(/`([^`]+)`/g, (m, src) => keep(`<code>${src}</code>`));

    // Headers
    escaped = escaped.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    escaped = escaped.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Lists: each run of "- item" or "1. item" lines becomes one <ul> or <ol>
    // (before emphasis, which would take the "*" of a "* item" line)
    const list = (tag, marker) => run => {
      const lines = run.replace(/\n$/, '').split('\n');
      const first = parseInt(lines[0].trim(), 10);
      const start = tag === 'ol' && first !== 1 ? ` start="${first}"` : '';
      return `<${tag}${start}>${lines.map(l => `<li>${l.replace(marker, '')}</li>`).join('')}</${tag}>\n`;
    };
    escaped = escaped.replace(/(?:^[ \t]*[-*+][ \t]+.*(?:\n|$))+/gm, list('ul', /^[ \t]*[-*+][ \t]+/));
    escaped = escaped.replace(/(?:^[ \t]*\d+\.[ \t]+.*(?:\n|$))+/gm, list('ol', /^[ \t]*\d+\.[ \t]+/));

    // Bold / Italic / Strike
    escaped = escaped.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // Blockquotes ("&gt;": the source is escaped above)
    escaped = escaped.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>');

    // Horizontal Rule
    escaped = escaped.replace(/^---$/gim, '<hr>');

    // Images: enforce safe protocol on src and safe alt text
    escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const cleanSrc = this.safeUrl(src);
      if (!cleanSrc) return '';
      return `<img src="${this.escapeHtml(cleanSrc)}" alt="${this.escapeHtml(alt)}" loading="lazy">`;
    });

    // Links: enforce safe protocol on href
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
      const cleanHref = this.safeUrl(href);
      if (!cleanHref) return label;
      return `<a href="${this.escapeHtml(cleanHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    escaped = escaped.replace(/\u0000(\d+)\u0000/g, (m, i) => code[i]);

    // Newlines to BR (not after block elements, which already break the line; the margin of a
    // list stands for the blank line after it)
    escaped = escaped.replace(/(<\/[uo]l>)\n\n?/g, '$1');
    escaped = escaped.replace(/(<\/h[1-4]>|<\/blockquote>|<hr>|<\/pre>)\n/g, '$1');
    escaped = escaped.replace(/\n/gim, '<br>');

    return `<div class="markdown-body">${escaped}</div>`;
  },

  uploadProgressBox(progress = {}) {
    const { percent = 0, loaded = 0, total = 0, speed = 0, etaSec = 0 } = progress;
    const speedStr = speed > 1024 * 1024 
      ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s` 
      : `${(speed / 1024).toFixed(0)} KB/s`;
    
    let etaStr = '';
    if (etaSec > 60) {
      const m = Math.floor(etaSec / 60);
      const s = etaSec % 60;
      etaStr = `~${m}m ${s}s remaining`;
    } else if (etaSec > 0) {
      etaStr = `~${etaSec}s remaining`;
    } else {
      etaStr = 'Finishing...';
    }

    return `
      <div class="upload-progress-box">
        <div class="upload-progress-header">
          <span style="color:var(--accent-cyan)">⏳ Uploading...</span>
          <span style="font-weight:700">${percent}%</span>
        </div>
        <div class="upload-progress-track">
          <div class="upload-progress-fill" style="width:${percent}%"></div>
        </div>
        <div class="upload-progress-footer">
          <span>${this.formatSize(loaded)} / ${this.formatSize(total)} (${speedStr})</span>
          <span>${etaStr}</span>
        </div>
      </div>
    `;
  }
};
