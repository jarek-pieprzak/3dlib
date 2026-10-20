/* ─── API Client ──────────────────────────────────────────────────────── */
const API = {
  async request(url, options = {}) {
    const csrfToken = localStorage.getItem('pv_csrf_token');
    // Don't even try profile calls if no token is present
    if (url.startsWith('/api/auth/') && !['login', 'register', 'forgot-password', 'reset-password', 'logout'].some(p => url.includes(p)) && !csrfToken) {
      return null;
    }
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    // The unlock token of the password-protected model that is open
    if (typeof App !== 'undefined' && App.adultUnlock && App.adultUnlock.token) headers['X-Adult-Unlock'] = App.adultUnlock.token;

    const res = await fetch(url, {
      credentials: 'same-origin',
      headers,
      ...options,
    });
    if (res.status === 401) {
      if (url.includes('/api/auth/login')) {
        const err = await res.json().catch(() => ({ error: 'Invalid credentials' }));
        throw new Error(err.error || 'Invalid credentials');
      }
      if (url.includes('/api/auth/me')) {
        return null;
      }
      const err = await res.json().catch(() => ({ error: 'Unauthorized - please log in' }));
      throw new Error(err.error || 'Unauthorized - please log in');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      const error = new Error(err.error || 'Request failed');
      error.status = res.status;
      error.data = err;
      error.suggested_name = err.suggested_name;
      error.suggested_names = err.suggested_names || (err.suggested_name ? [err.suggested_name] : []);
      throw error;
    }
    return res.json();
  },

  // Auth
  login(username, password) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  },
  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  },
  register(username, email, password, token = null) {
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, invite_token: token }) });
  },
  getMe() { return this.request('/api/auth/me'); },
  updateProfile(data) {
    return this.request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) });
  },
  generateApiKey() {
    return this.request('/api/auth/api-key', { method: 'POST' });
  },
  forgotPassword(email) {
    return this.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  resetPassword(token, password) {
    return this.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
  },
  getUsers() { return this.request('/api/users'); },
  updateUserRole(userId, role) { return this.request(`/api/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }); },
  deleteUser(userId) { return this.request(`/api/users/${userId}`, { method: 'DELETE' }); },
  inviteUser(email) { return this.request('/api/auth/invite', { method: 'POST', body: JSON.stringify({ email }) }); },

  // Settings
  getSystemSettings() { return this.request('/api/settings/system'); },
  saveSystemSettings(data) { return this.request('/api/settings/system', { method: 'POST', body: JSON.stringify(data) }); },
  getSMTPSettings() { return this.request('/api/settings/smtp'); },
  saveSMTPSettings(data) { return this.request('/api/settings/smtp', { method: 'POST', body: JSON.stringify(data) }); },
  testSMTP(data) { return this.request('/api/settings/smtp/test', { method: 'POST', body: JSON.stringify(data) }); },
  getViewMode() { return this.request('/api/settings/view-mode'); },

  // Library browser
  browseLibrary(browsePath = '') {
    const qs = browsePath ? `?path=${encodeURIComponent(browsePath)}` : '';
    return this.request(`/api/browse${qs}`);
  },
  searchLibrary(q) {
    return this.request(`/api/browse/search?q=${encodeURIComponent(q)}`);
  },
  getFolderTree() { return this.request('/api/browse/tree'); },
  moveItem(source, target) { return this.request('/api/browse/move', { method: 'POST', body: JSON.stringify({ source, target }) }); },
  createFolder(parentPath, folderName) { return this.request('/api/browse/mkdir', { method: 'POST', body: JSON.stringify({ parentPath, folderName }) }); },
  bulkMoveItems(paths, target) { return this.request('/api/browse/bulk-move', { method: 'POST', body: JSON.stringify({ paths, target }) }); },
  bulkDeleteItems(paths) { return this.request('/api/browse/bulk-delete', { method: 'POST', body: JSON.stringify({ paths }) }); },
  bulkTagItems(paths, tags) { return this.request('/api/browse/bulk-tag', { method: 'POST', body: JSON.stringify({ paths, tags }) }); },
  bulkCategoryItems(paths, category_id) { return this.request('/api/browse/bulk-category', { method: 'POST', body: JSON.stringify({ paths, category_id }) }); },

  // Models
  getModels(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== '' && v != null)).toString();
    return this.request(`/api/models${qs ? '?' + qs : ''}`);
  },
  // inTrash: a model in the Trash opens only with ?trash=1
  getModel(id, inTrash = false) { return this.request(`/api/models/${id}${inTrash ? '?trash=1' : ''}`); },
  createModel(data) {
    return this.request('/api/models', { method: 'POST', body: JSON.stringify(data) });
  },
  importModelUrl(url) {
    return this.request('/api/models/import', { method: 'POST', body: JSON.stringify({ url }) });
  },
  updateModel(id, data) {
    return this.request(`/api/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteModel(id) {
    return this.request(`/api/models/${id}`, { method: 'DELETE' });
  },
  createVersion(id, data) {
    return this.request(`/api/models/${id}/versions`, { method: 'POST', body: JSON.stringify(data) });
  },
  bulkDeleteModels(ids) {
    return this.request('/api/models/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
  },

  // Files and folders of a project, on disk (paths relative to the project folder)
  renameProjectEntry(modelId, path, name) {
    return this.request(`/api/models/${modelId}/fs/rename`, { method: 'POST', body: JSON.stringify({ path, name }) });
  },
  moveProjectEntries(modelId, paths, target) {
    return this.request(`/api/models/${modelId}/fs/move`, { method: 'POST', body: JSON.stringify({ paths, target }) });
  },
  createProjectFolder(modelId, path, name) {
    return this.request(`/api/models/${modelId}/fs/mkdir`, { method: 'POST', body: JSON.stringify({ path, name }) });
  },
  deleteProjectEntries(modelId, paths) {
    return this.request(`/api/models/${modelId}/fs/delete`, { method: 'POST', body: JSON.stringify({ paths }) });
  },

  // Trash
  getTrash() { return this.request('/api/trash'); },
  restoreFromTrash(modelIds = [], fileIds = []) {
    return this.request('/api/trash/restore', { method: 'POST', body: JSON.stringify({ model_ids: modelIds, file_ids: fileIds }) });
  },
  purgeFromTrash(modelIds = [], fileIds = []) {
    return this.request('/api/trash/purge', { method: 'POST', body: JSON.stringify({ model_ids: modelIds, file_ids: fileIds }) });
  },
  emptyTrash() { return this.request('/api/trash/empty', { method: 'POST' }); },

  // Covers the 3D viewer can render again (Settings > Maintenance)
  getPendingCovers() { return this.request('/api/covers/pending'); },

  // File history (.versions)
  getFileVersions(fileId) { return this.request(`/api/files/${fileId}/versions`); },
  restoreFileVersion(fileId, versionId) { return this.request(`/api/files/${fileId}/versions/${versionId}/restore`, { method: 'POST' }); },
  deleteFileVersion(fileId, versionId) { return this.request(`/api/files/${fileId}/versions/${versionId}`, { method: 'DELETE' }); },

  // Projects saved by the slicer into .slicer-saves
  getSlicerSaves() { return this.request('/api/slicer-saves'); },
  checkSlicerSaves() { return this.request('/api/slicer-saves/scan', { method: 'POST' }); },
  cleanupSlicerSaves() { return this.request('/api/slicer-saves/cleanup', { method: 'POST' }); },
  importSlicerSave(id) { return this.request(`/api/slicer-saves/${id}/import`, { method: 'POST' }); },
  assignSlicerSave(id, target) { return this.request(`/api/slicer-saves/${id}/assign`, { method: 'POST', body: JSON.stringify(target) }); },
  deleteSlicerSave(id) { return this.request(`/api/slicer-saves/${id}`, { method: 'DELETE' }); },
  bulkUpdateModels(ids, data) {
    return this.request('/api/models/bulk-update', { method: 'POST', body: JSON.stringify({ ids, ...data }) });
  },

  // Files
  uploadFiles(modelId, files, options = {}, onProgress = null) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      if (options.parent_folder) form.append('parent_folder', options.parent_folder);
      if (options.create_subfolder !== undefined) form.append('create_subfolder', options.create_subfolder);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/models/${modelId}/files`);
      xhr.withCredentials = true;

      const csrfToken = localStorage.getItem('pv_csrf_token');
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      const startTime = Date.now();
      if (xhr.upload && typeof onProgress === 'function') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.min(99, Math.round((e.loaded / e.total) * 100));
            const elapsed = Math.max(0.1, (Date.now() - startTime) / 1000);
            const speed = e.loaded / elapsed; // bytes/sec
            const remaining = Math.max(0, e.total - e.loaded);
            const etaSec = speed > 0 ? Math.round(remaining / speed) : 0;
            
            onProgress({
              percent,
              loaded: e.loaded,
              total: e.total,
              speed,
              etaSec
            });
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (err) {
            resolve(xhr.responseText);
          }
        } else {
          let errMessage = 'Upload failed';
          try {
            const res = JSON.parse(xhr.responseText);
            if (res.error) errMessage = res.error;
          } catch (e) {}
          reject(new Error(errMessage));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    });
  },
  async uploadThumbnail(modelId, file) {
    const form = new FormData();
    form.append('thumbnail', file);
    const csrfToken = localStorage.getItem('pv_csrf_token');
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const res = await fetch(`/api/models/${modelId}/thumbnail`, { method: 'POST', body: form, headers, credentials: 'same-origin' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
    return res.json();
  },
  // A preview rendered in the browser for one 3D file (Folder Explorer), stored on the server
  async uploadFileThumbnail(fileId, file) {
    const form = new FormData();
    form.append('thumbnail', file);
    const csrfToken = localStorage.getItem('pv_csrf_token');
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const res = await fetch(`/api/files/${fileId}/thumbnail`, { method: 'POST', body: form, headers, credentials: 'same-origin' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
    return res.json();
  },
  setPreviewFile(modelId, fileId) {
    return this.request(`/api/models/${modelId}/preview-file`, {
      method: 'PUT',
      body: JSON.stringify({ file_id: fileId })
    });
  },
  deleteFile(id) {
    return this.request(`/api/files/${id}`, { method: 'DELETE' });
  },

  sendToPrinter(id, printerId) {
    return this.request(`/api/files/${id}/send-to-printer`, { method: 'POST', body: JSON.stringify({ printer_id: printerId }) });
  },

  // Prints
  addPrint(modelId, data) {
    return this.request(`/api/models/${modelId}/prints`, { method: 'POST', body: JSON.stringify(data) });
  },
  deletePrint(id) { return this.request(`/api/prints/${id}`, { method: 'DELETE' }); },

  // Categories, Tags, Materials
  getCategories() { return this.request('/api/categories'); },
  createCategory(data) { return this.request('/api/categories', { method: 'POST', body: JSON.stringify(data) }); },
  updateCategory(id, data) { return this.request(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  deleteCategory(id) { return this.request(`/api/categories/${id}`, { method: 'DELETE' }); },

  getTags() { return this.request('/api/tags'); },
  createTag(data) { return this.request('/api/tags', { method: 'POST', body: JSON.stringify(data) }); },
  deleteTag(id) { return this.request(`/api/tags/${id}`, { method: 'DELETE' }); },

  getMaterials() { return this.request('/api/materials'); },
  createMaterial(data) { return this.request('/api/materials', { method: 'POST', body: JSON.stringify(data) }); },
  deleteMaterial(id) { return this.request(`/api/materials/${id}`, { method: 'DELETE' }); },

  // Projects / Collections
  getProjects() { return this.request('/api/projects'); },
  getProject(id) { return this.request(`/api/projects/${id}`); },
  createProject(data) { return this.request('/api/projects', { method: 'POST', body: JSON.stringify(data) }); },
  updateProject(id, data) { return this.request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  deleteProject(id) { return this.request(`/api/projects/${id}`, { method: 'DELETE' }); },
  bulkDeleteProjects(projectIds) { return this.request('/api/projects/bulk-delete', { method: 'POST', body: JSON.stringify({ project_ids: projectIds }) }); },
  bulkSetProjectsVisibility(projectIds, visibility) { return this.request('/api/projects/bulk-visibility', { method: 'POST', body: JSON.stringify({ project_ids: projectIds, visibility }) }); },
  addModelToProject(projectId, modelId) { return this.request(`/api/projects/${projectId}/models`, { method: 'POST', body: JSON.stringify({ model_id: modelId }) }); },
  syncModelProjects(modelId, projectIds) { return this.request(`/api/models/${modelId}/projects`, { method: 'PUT', body: JSON.stringify({ project_ids: projectIds }) }); },
  bulkAddModelsToProject(projectId, modelIds) { return this.request(`/api/projects/${projectId}/models/bulk`, { method: 'POST', body: JSON.stringify({ model_ids: modelIds }) }); },
  bulkRemoveModelsFromProject(projectId, modelIds) { return this.request(`/api/projects/${projectId}/models/bulk-remove`, { method: 'POST', body: JSON.stringify({ model_ids: modelIds }) }); },
  removeModelFromProject(projectId, modelId) { return this.request(`/api/projects/${projectId}/models/${modelId}`, { method: 'DELETE' }); },

  // Sharing
  createShare(modelId, expiresDays) { return this.request('/api/shares', { method: 'POST', body: JSON.stringify({ model_id: modelId, expires_days: expiresDays }) }); },
  getSharedModel(slug) { return this.request(`/api/shares/${slug}`); },

  // Stats & System
  getStats() { return this.request('/api/stats'); },
  getUpdateStatus() { return this.request('/api/system/updates'); },
  getSystemLogs() { return this.request('/api/system/logs'); },
  clearSystemLogs() { return this.request('/api/system/logs', { method: 'DELETE' }); },
  getPublicConfig() { return this.request('/api/system/public-config'); },
  unlockModel(id, password) { return this.request(`/api/models/${id}/unlock`, { method: 'POST', body: JSON.stringify({ password }) }); },
  lockAdult() { return this.request('/api/models/adult/lock', { method: 'POST', body: '{}' }); },
  setAdultPassword(password) { return this.request('/api/settings/adult-password', { method: 'PUT', body: JSON.stringify({ password }) }); },
  getBlockedIps() { return this.request('/api/system/blocked-ips'); },
  unblockIp(ip) { return this.request('/api/system/unblock-ip', { method: 'POST', body: JSON.stringify({ ip }) }); },
  scanDuplicates() { return this.request('/api/system/duplicates'); },
  getReleaseNotes() { return this.request('/api/system/release-notes'); }
};
