const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { get, all, run, saveDb } = require('../database');
const { LIBRARY_PATH, UPLOADS_DIR } = require('../config');
const { authenticate, requireUploader } = require('../middleware/auth');
const { upload, getFileType } = require('../middleware/upload');
const { validatePathConfinement, safeUrl } = require('../middleware/security');
const { getFileUrl, getThumbUrl, getZipEntryBuffer, zipEntriesForFiles, getSettingBool, canEditModel, tagIdFor } = require('../utils/modelHelpers');
const { sendZip, entryName } = require('../utils/zipStream');
const downloadSelections = require('../utils/downloadSelections');
const kits = require('../utils/kits');
const protection = require('../utils/protection');
const printFit = require('../utils/printFit');
const trashUtil = require('../utils/trash');
const projectFiles = require('../utils/projectFiles');
const { ensureTokens } = require('../utils/slicerToken');
const bcrypt = require('bcryptjs');
const { authLimiter } = require('../middleware/rateLimit');

// ─── Password-protected models ─────────────────────────────────────────────────────────────────
// POST /api/models/protected/lock: forget the unlock cookie (the page leaves a protected model)
router.post('/protected/lock', (req, res) => {
  res.clearCookie(protection.COOKIE, { path: '/' });
  res.json({ success: true });
});

// POST /api/models/:id/unlock { password }: open a password-protected model once
router.post('/:id/unlock', authLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT id, is_protected FROM models WHERE id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (protection.isLocked(model)) {
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (!(await bcrypt.compare(password, protection.passwordHash()))) return res.status(403).json({ error: 'Wrong password' });
    }
    const token = protection.issueToken(id);
    res.cookie(protection.COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: 6 * 3600 * 1000 });
    res.json({ token });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to unlock' }); }
});

// ─── GET /api/models ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { search, category, tag, format, user, printed, sort = 'updated', order, project_id, page = 1, limit = 24 } = req.query;
    const needsFileCountSort = sort === 'files';
    const needsPrintCountSort = sort === 'prints';
    let query = `SELECT m.*, c.name as category_name, c.color as category_color, u.username as uploader_name
      ${needsFileCountSort ? ',(SELECT COUNT(*) FROM files WHERE model_id=m.id AND deleted_at IS NULL) as file_count' : ''}
      ${needsPrintCountSort ? ',(SELECT COUNT(*) FROM print_history WHERE model_id=m.id) as print_count' : ''}
      FROM models m
      LEFT JOIN categories c ON m.category_id=c.id
      LEFT JOIN users u ON m.user_id=u.id`;
    
    // Models and files in the Trash are listed only in the Trash
    const conds = ['m.deleted_at IS NULL'], params = [];

    // Filter out versions in main view
    if (!project_id) {
      conds.push("m.parent_id IS NULL");
    }

    if (search) {
      // fold(): case and Polish letters ignored, "lozysko" finds "Łożysko" (utils/names.js)
      const s = `%${search}%`;
      conds.push(`(
        fold(m.name) LIKE fold(?)
        OR fold(m.description) LIKE fold(?)
        OR m.category_id IN (SELECT id FROM categories WHERE fold(name) LIKE fold(?))
        OR m.id IN (SELECT mt.model_id FROM model_tags mt JOIN tags t ON mt.tag_id = t.id WHERE fold(t.name) LIKE fold(?))
        OR m.id IN (SELECT pm.model_id FROM project_models pm JOIN projects p ON pm.project_id = p.id WHERE fold(p.name) LIKE fold(?))
      )`);
      params.push(s, s, s, s, s);
    }
    if (category) { conds.push("m.category_id=?"); params.push(Number(category)); }
    if (tag) { conds.push("m.id IN (SELECT model_id FROM model_tags WHERE tag_id=?)"); params.push(Number(tag)); }
    if (format && format !== 'all') {
      conds.push("m.id IN (SELECT DISTINCT model_id FROM files WHERE file_type=? AND deleted_at IS NULL)");
      params.push(format.toLowerCase());
    }
    if (user) { conds.push("m.user_id=?"); params.push(Number(user)); }
    if (printed === 'true') conds.push("m.id IN (SELECT DISTINCT model_id FROM print_history)");
    else if (printed === 'false') conds.push("m.id NOT IN (SELECT DISTINCT model_id FROM print_history)");
    if (project_id) { conds.push("m.id IN (SELECT model_id FROM project_models WHERE project_id=?)"); params.push(Number(project_id)); }
    // ?fits=<printer id | any>: only models whose every measured 3D file fits that printer
    if (req.query.fits) {
      const ids = printFit.fittingModelIds(String(req.query.fits));
      conds.push(ids.length ? `m.id IN (${ids.join(',')})` : '0');
    }

    let countQuery = 'SELECT COUNT(m.id) as total FROM models m';
    if (conds.length) {
      const whereClause = ' WHERE ' + conds.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }
    
    const totalItems = get(countQuery, params).total;
    const parsedLimit = Number(limit) || 24;
    const parsedPage = Math.max(1, Number(page) || 1);
    const totalPages = Math.ceil(totalItems / parsedLimit);
    const offset = (parsedPage - 1) * parsedLimit;

    const sortMap = { name:'sortkey(m.name)', created:'m.created_at', updated:'m.updated_at', prints:'print_count', files:'file_count' };
    const sqlOrder = order ? (order === 'asc' ? 'ASC' : 'DESC') : (sort === 'name' ? 'ASC' : 'DESC');
    query += ` ORDER BY ${sortMap[sort]||'m.updated_at'} ${sqlOrder} LIMIT ? OFFSET ?`;
    params.push(parsedLimit, offset);
    
    const rawModels = all(query, params);
    const modelIds = rawModels.map(m => m.id);

    // High-performance batched tag, project, file stats, and preview fetching for current page
    const tagsByModel = {};
    const projectsByModel = {};
    const fileStatsByModel = {};
    const printCountByModel = {};
    const stlByModel = {};
    const mfByModel = {};
    const previewFileById = {};

    if (modelIds.length) {
      const placeholders = modelIds.map(() => '?').join(',');
      const allTags = all(`SELECT mt.model_id, t.id, t.name FROM tags t JOIN model_tags mt ON mt.tag_id=t.id WHERE mt.model_id IN (${placeholders})`, modelIds);
      allTags.forEach(t => {
        if (!tagsByModel[t.model_id]) tagsByModel[t.model_id] = [];
        tagsByModel[t.model_id].push({ id: t.id, name: t.name });
      });

      const allProjects = all(`SELECT pm.model_id, p.id, p.name, p.visibility FROM projects p JOIN project_models pm ON pm.project_id=p.id WHERE pm.model_id IN (${placeholders})`, modelIds);
      allProjects.forEach(p => {
        if (!projectsByModel[p.model_id]) projectsByModel[p.model_id] = [];
        projectsByModel[p.model_id].push({ id: p.id, name: p.name, visibility: p.visibility });
      });

      const fileCounts = all(`SELECT model_id, COUNT(*) as file_count, GROUP_CONCAT(DISTINCT file_type) as file_types FROM files WHERE model_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY model_id`, modelIds);
      fileCounts.forEach(r => { fileStatsByModel[r.model_id] = r; });

      const printCounts = all(`SELECT model_id, COUNT(*) as print_count FROM print_history WHERE model_id IN (${placeholders}) GROUP BY model_id`, modelIds);
      printCounts.forEach(r => { printCountByModel[r.model_id] = r.print_count; });

      // Most-recent stl/3mf per model, in one pass (newest-first)
      const previewCandidates = all(`SELECT id, model_id, filename, library_path, file_type, uploaded_at FROM files WHERE model_id IN (${placeholders}) AND file_type IN ('stl','3mf') AND deleted_at IS NULL ORDER BY uploaded_at DESC`, modelIds);
      previewCandidates.forEach(f => {
        if (f.file_type === 'stl' && !stlByModel[f.model_id]) stlByModel[f.model_id] = f;
        if (f.file_type === '3mf' && !mfByModel[f.model_id]) mfByModel[f.model_id] = f;
        previewFileById[f.id] = f;
      });

      // Handle any explicit preview_file_id not already fetched
      const previewIds = [...new Set(rawModels.map(m => m.preview_file_id).filter(id => id != null && !previewFileById[id]))];
      if (previewIds.length) {
        const pPlaceholders = previewIds.map(() => '?').join(',');
        const extraPreview = all(`SELECT id, filename, library_path, file_type FROM files WHERE id IN (${pPlaceholders}) AND file_type IN ('stl','3mf') AND deleted_at IS NULL`, previewIds);
        extraPreview.forEach(f => { previewFileById[f.id] = f; });
      }
    }

    // How the model's 3D files fit my printers (the badge on its card)
    const fitByModel = printFit.modelFits(modelIds);
    // Configurations: how many of the prints they need are done
    const progressByModel = kits.progressOf(rawModels);
    const models = rawModels.map(m => {
      const preview = m.preview_file_id != null ? previewFileById[m.preview_file_id] : null;
      const stlFallback = stlByModel[m.id];
      const stl_file_name = preview ? preview.filename : (stlFallback ? stlFallback.filename : null);
      const stl_file_libpath = preview ? preview.library_path : (stlFallback ? stlFallback.library_path : null);
      const mfEntry = mfByModel[m.id];

      let stl_url = null;
      if (stl_file_name) {
        stl_url = getFileUrl({ filename: stl_file_name, library_path: stl_file_libpath });
      } else if (mfEntry) {
        stl_url = getFileUrl({ filename: mfEntry.filename, library_path: mfEntry.library_path });
      }
      
      let thumb_url = getThumbUrl(m.thumbnail, m.library_path);

      const fit = fitByModel.get(m.id) || null;
      const fstats = fileStatsByModel[m.id];
      const print_count = printCountByModel[m.id] || 0;

      return {
        ...m,
        thumbnail: thumb_url,
        fit,
        stl_file: stl_url,
        file_count: fstats ? fstats.file_count : 0,
        file_types: fstats && fstats.file_types ? [...new Set(fstats.file_types.split(','))] : [],
        print_count,
        tags: tagsByModel[m.id] || [],
        projects: projectsByModel[m.id] || [],
        has_printed: print_count > 0,
        ...(progressByModel[m.id] ? { kit_progress: progressByModel[m.id] } : {}),
      };
    });

    const totalSizeObj = get('SELECT SUM(f.file_size) as total_bytes FROM files f JOIN models m ON m.id=f.model_id WHERE f.deleted_at IS NULL AND m.deleted_at IS NULL');
    const totalStorageBytes = totalSizeObj?.total_bytes || 0;
    
    res.json({
      models,
      totalItems,
      totalPages,
      currentPage: parsedPage,
      limit: parsedLimit,
      totalStorageBytes
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch models' }); }
});

// ─── GET /api/models/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT m.*,c.name as category_name,c.color as category_color, u.username as uploader_name FROM models m LEFT JOIN categories c ON m.category_id=c.id LEFT JOIN users u ON m.user_id=u.id WHERE m.id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    // A model in the Trash opens only from the Trash (?trash=1), for those who may restore it
    const canEdit = canEditModel(req.user, model);
    if (model.deleted_at && !(req.query.trash && canEdit)) return res.status(404).json({ error: 'Model not found' });
    if (!protection.canOpenModel(req, model, { headerOnly: true })) {
      return res.status(423).json({ error: 'This model is password protected', locked: true, id: model.id, name: model.name });
    }

    // Enforce private collection access control
    const privateProjects = all('SELECT p.id, p.user_id FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=? AND p.visibility="private"', [id]);
    const publicProjects = all('SELECT p.id FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=? AND p.visibility="public"', [id]);
    if (privateProjects.length > 0 && publicProjects.length === 0) {
      if (!req.user || (req.user.role !== 'admin' && !privateProjects.some(p => p.user_id === req.user.id) && model.user_id !== req.user.id)) {
        return res.status(403).json({ error: 'Access denied to private model' });
      }
    }

    if (model.thumbnail) {
      model.thumbnail_url = getThumbUrl(model.thumbnail, model.library_path);
    }

    const allFiles = all('SELECT f.*, u.username as uploader_name FROM files f LEFT JOIN users u ON f.user_id=u.id WHERE f.model_id=? ORDER BY (CASE WHEN f.id = ? THEN 0 ELSE 1 END), f.uploaded_at DESC', [model.id, model.preview_file_id || 0]).map(f => ({
      ...f,
      is_preview: Boolean(model.preview_file_id && f.id === model.preview_file_id && !f.deleted_at),
      url: getFileUrl(f)
    }));
    model.files = ensureTokens(allFiles.filter(f => !f.deleted_at));
    // Number of earlier versions in each file's history (.versions)
    const versionCounts = Object.fromEntries(all('SELECT v.file_id, COUNT(*) as n FROM file_versions v JOIN files f ON f.id = v.file_id WHERE f.model_id = ? GROUP BY v.file_id', [model.id]).map(r => [r.file_id, r.n]));
    for (const f of model.files) f.version_count = versionCounts[f.id] || 0;
    // Deleted files are shown in the model's Trash tab; entries of a deleted archive go with it
    const deletedPaths = new Set(allFiles.filter(f => f.deleted_at && f.library_path).map(f => f.library_path));
    model.trash_files = canEdit
      ? allFiles.filter(f => f.deleted_at && !(f.library_path && f.library_path.includes('::') && deletedPaths.has(f.library_path.split('::')[0])))
      : [];
    model.folders = projectFiles.visibleFolders(model, allFiles);
    const info = projectFiles.projectInfo(model);
    model.layout = info ? (info.isFolder ? 'folder' : 'file') : 'none';
    model.trash_retention_days = trashUtil.retentionDays();
    model.prints = all('SELECT ph.*,mat.name as material_name, u.username as printer_name FROM print_history ph LEFT JOIN materials mat ON ph.material_id=mat.id LEFT JOIN users u ON ph.user_id=u.id WHERE ph.model_id=? ORDER BY ph.printed_at DESC', [model.id]);
    model.tags = all('SELECT t.id,t.name FROM tags t JOIN model_tags mt ON mt.tag_id=t.id WHERE mt.model_id=?', [model.id]);
    model.projects = all('SELECT p.id, p.name, p.visibility FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=?', [model.id]);
    model.has_printed = model.prints.length > 0;
    if (kits.isConfiguration(model)) {
      // The parts needed follow the archive (a rescan may have changed its files)
      model.kit_needs = JSON.stringify(kits.refreshNeeds(model));
      saveDb();
      model.kit_progress = kits.progressOf([model])[model.id];
      const src = get('SELECT id, name, is_protected, deleted_at, kit_archive FROM models WHERE id = ?', [model.kit_source_id]);
      model.kit_source = src ? { id: src.id, name: src.name, is_protected: src.is_protected, deleted_at: src.deleted_at, kit: kits.kitIdOf(src) } : null;
    } else if (kits.partsListOf(model)) {
      // The parts list counts the files still there (one may have gone to the Trash)
      model.kit_needs = JSON.stringify(kits.refreshNeeds(model));
      saveDb();
      model.kit_progress = kits.progressOf([model])[model.id];
    }

    // Versions
    const rootId = model.parent_id || model.id;
    model.versions = all(`
      SELECT id, name, created_at, 
      (SELECT COUNT(*) FROM files WHERE model_id = models.id AND deleted_at IS NULL) as file_count
      FROM models
      WHERE (id = ? OR parent_id = ?) AND id != ? AND deleted_at IS NULL
      ORDER BY created_at DESC`, [rootId, rootId, model.id]);

    res.json(model);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch model' }); }
});

// ─── PUT /api/models/:id/preview-file ─────────────────────────────────────────
// ??? GET /api/models/:id/download (Issue #75) ?????????????????????????????????
// Who may download a model's files as a ZIP (the whole model or a selection): null when allowed,
// else { status, error }. A share link opens its own model to anyone.
function zipAccessError(req, model, shareSlug) {
  if (!model) return { status: 404, error: 'Model not found' };
  if (!shareSlug && !protection.canOpenModel(req, model)) return { status: 404, error: 'Model not found' };
  if (shareSlug) {
    const share = get("SELECT * FROM shares WHERE id=? AND (expires_at IS NULL OR expires_at > datetime('now'))", [shareSlug]);
    return !share || share.model_id !== model.id ? { status: 403, error: 'Invalid or expired share link' } : null;
  }
  if (!req.user) return { status: 401, error: 'Authentication required to download model archives' };
  const privateProjects = all('SELECT p.id, p.user_id FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=? AND p.visibility="private"', [model.id]);
  const publicProjects = all('SELECT p.id FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=? AND p.visibility="public"', [model.id]);
  if (privateProjects.length > 0 && publicProjects.length === 0) {
    if (req.user.role !== 'admin' && !privateProjects.some(p => p.user_id === req.user.id) && model.user_id !== req.user.id) {
      return { status: 403, error: 'Access denied to private model' };
    }
  }
  return null;
}

router.get('/:id/download', (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [id]);
    const denied = zipAccessError(req, model, req.query.share);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    if (kits.isConfiguration(model)) {
      const selection = kits.zipSelection(model);
      if (!selection) return res.status(404).json({ error: 'The archive of this configuration is gone or in the Trash' });
      // The parts are files of the archive: its access rules apply too
      const deniedSource = req.query.share ? { status: 403, error: 'Configurations cannot be shared' } : zipAccessError(req, selection.source);
      if (deniedSource) return res.status(deniedSource.status).json({ error: deniedSource.error });
      const entries = zipEntriesForFiles(selection.files);
      const buf = Buffer.from(selection.text.content, 'utf8');
      entries.unshift({ name: entryName(selection.text.name) || 'parts list.txt', size: buf.length, read: () => buf });
      if (!sendZip(res, model.name || 'configuration', entries)) return res.status(404).json({ error: 'No physical files found on disk for this configuration' });
      return;
    }
    const files = all('SELECT * FROM files WHERE model_id=? AND deleted_at IS NULL ORDER BY uploaded_at ASC', [id]);
    if (!files.length) return res.status(400).json({ error: 'No files in this model to download' });

    // Streamed from disk: a project can be many GB
    if (!sendZip(res, model.name || 'model', zipEntriesForFiles(files))) {
      return res.status(404).json({ error: 'No physical files found on disk for this model' });
    }
  } catch (e) {
    console.error('Error creating model zip:', e);
    res.status(500).json({ error: 'Failed to create model zip' });
  }
});

// ─── POST /api/models/:id/download-selection ──────────────────────────────────
// A ZIP of some files of a model (the parts a kit configurator picked), with an optional text
// file (the parts list). The POST checks access and keeps the selection under a short-lived
// token; the browser then downloads GET .../download-selection/:token as a normal link.
router.post('/:id/download-selection', authenticate, (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [id]);
    const denied = zipAccessError(req, model);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const ids = [...new Set((Array.isArray(req.body.file_ids) ? req.body.file_ids : []).map(Number).filter(Number.isInteger))];
    if (!ids.length || ids.length > 5000) return res.status(400).json({ error: 'Choose between 1 and 5000 files' });
    const found = all(`SELECT id FROM files WHERE model_id=? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, [id, ...ids]);
    if (found.length !== ids.length) return res.status(400).json({ error: 'Some files are not part of this model' });

    let text = null;
    const t = req.body.text;
    if (t && typeof t === 'object' && typeof t.content === 'string') {
      if (Buffer.byteLength(t.content, 'utf8') > 64 * 1024) return res.status(400).json({ error: 'The text file is too large' });
      text = { name: entryName(String(t.name || '')) || 'parts list.txt', content: t.content };
    }
    const name = String(req.body.name || model.name || 'selection').slice(0, 120);
    const token = downloadSelections.create({ modelId: id, userId: req.user.id, fileIds: ids, text, name });
    res.json({ token, url: `/api/models/${id}/download-selection/${token}`, expires_in: Math.round(downloadSelections.TTL_MS / 1000) });
  } catch (e) {
    console.error('Error preparing selection download:', e);
    res.status(500).json({ error: 'Failed to prepare the download' });
  }
});

// ─── GET /api/models/:id/download-selection/:token ────────────────────────────
router.get('/:id/download-selection/:token', (req, res) => {
  try {
    const id = Number(req.params.id);
    const selection = downloadSelections.get(req.params.token);
    if (!selection || selection.modelId !== id || !req.user || selection.userId !== req.user.id) {
      return res.status(404).json({ error: 'This download link has expired: download again from the model page' });
    }
    // Access is checked again: the model may have been locked or trashed since
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [id]);
    const denied = zipAccessError(req, model);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const ids = selection.fileIds;
    const files = all(`SELECT * FROM files WHERE model_id=? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')}) ORDER BY sortkey(original_name)`, [id, ...ids]);
    const entries = zipEntriesForFiles(files);
    if (selection.text) {
      const buf = Buffer.from(selection.text.content, 'utf8');
      entries.unshift({ name: selection.text.name, size: buf.length, read: () => buf });
    }
    if (!sendZip(res, selection.name, entries)) {
      return res.status(404).json({ error: 'No physical files found on disk for this selection' });
    }
  } catch (e) {
    console.error('Error creating selection zip:', e);
    res.status(500).json({ error: 'Failed to create the zip' });
  }
});

router.put('/:id/preview-file', authenticate, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { file_id } = req.body;
    const model = get('SELECT * FROM models WHERE id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (req.user.role !== 'admin' && model.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const file = get('SELECT * FROM files WHERE id=? AND model_id=? AND deleted_at IS NULL', [Number(file_id), id]);
    if (!file) return res.status(404).json({ error: 'File not found on this model' });

    run("UPDATE models SET preview_file_id=?, updated_at=datetime('now') WHERE id=?", [file.id, id]);

    // If file has a thumbnail or is an image, update model thumbnail; if 3D, clear old snapshot so 3D preview renders
    if (file.thumbnail) {
      run('UPDATE models SET thumbnail=? WHERE id=?', [file.thumbnail, id]);
    } else if (file.file_type === 'image') {
      let thumbName = file.filename;
      if (file.library_path && fs.existsSync(file.library_path) && !fs.existsSync(path.join(UPLOADS_DIR, thumbName))) {
        try {
          const dest = path.join(UPLOADS_DIR, `thumb_${file.id}_${path.basename(file.library_path)}`);
          fs.copyFileSync(file.library_path, dest);
          thumbName = path.basename(dest);
        } catch (e) {
          console.warn('[preview-file] Could not copy library image to uploads:', e.message);
        }
      }
      run('UPDATE models SET thumbnail=? WHERE id=?', [thumbName, id]);
    } else if (file.file_type === 'stl' || file.file_type === '3mf') {
      run('UPDATE models SET thumbnail=NULL WHERE id=?', [id]);
    }

    res.json({ success: true, preview_file_id: file.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to set preview file' });
  }
});

// ─── POST /api/models/:id/versions ───────────────────────────────────────────
router.post('/:id/versions', authenticate, (req, res) => {
  try {
    const id = Number(req.params.id);
    const parent = get('SELECT * FROM models WHERE id = ?', [id]);
    if (!parent) return res.status(404).json({ error: 'Parent model not found' });

    const rootId = parent.parent_id || parent.id;
    const { name, description } = req.body;
    
    const r = run(`
      INSERT INTO models (name, description, category_id, user_id, parent_id) 
      VALUES (?, ?, ?, ?, ?)`, 
      [name || `${parent.name} (New Version)`, description || parent.description, parent.category_id, req.user.id, rootId]
    );
    
    // Copy tags
    const tags = all('SELECT tag_id FROM model_tags WHERE model_id = ?', [id]);
    for (const t of tags) {
      run('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)', [r.lastId, t.tag_id]);
    }

    res.status(201).json({ id: r.lastId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create version' }); }
});

// ─── POST /api/models ─────────────────────────────────────────────────────────
router.post('/', authenticate, requireUploader, (req, res) => {
  const userId = req.user.id;
  try {
    let { name, description, print_tips, source_url, category_id, tags, custom_meta, parent_folder, create_subfolder, auto_rename } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    
    let trimmedName = name.trim();
    let safeName = trimmedName.replace(/[<>:"/\\|?*]/g, '').trim() || `model_${Date.now()}`;
    
    // Strict path confinement check on parent_folder
    let basePath = LIBRARY_PATH;
    if (parent_folder) {
      const confined = validatePathConfinement(LIBRARY_PATH, parent_folder);
      if (!confined) return res.status(400).json({ error: 'Invalid parent folder path' });
      basePath = confined;
    }

    let libPath = create_subfolder !== false && create_subfolder !== 'false' ? path.join(basePath, safeName) : basePath;
    const confinedLib = validatePathConfinement(LIBRARY_PATH, path.relative(LIBRARY_PATH, libPath));
    if (!confinedLib) return res.status(400).json({ error: 'Invalid model folder path' });
    libPath = confinedLib;

    if (source_url) {
      source_url = safeUrl(source_url);
    }

    // Check if model with this name or library_path already exists. Case is ignored: on a share
    // that ignores it, "benchy" would be the folder of "Benchy"
    const existingModel = get('SELECT id, name, library_path FROM models WHERE ulower(name) = ulower(?) OR ulower(library_path) = ulower(?)', [trimmedName, libPath]);
    if (existingModel) {
      const isAvailable = (candidate) => {
        const safe = candidate.replace(/[<>:"/\\|?*]/g, '').trim();
        const p = create_subfolder !== false && create_subfolder !== 'false' ? path.join(basePath, safe) : basePath;
        return !get('SELECT id FROM models WHERE ulower(name) = ulower(?) OR ulower(library_path) = ulower(?)', [candidate, p]);
      };

      const suggestions = [];
      const currentYear = new Date().getFullYear();

      // 1. Versioning: detect if name ends with v1, v2, etc. Only the end is matched: a lazy
      // "^(.*?)\s*" in front took seconds on a long name full of spaces.
      const versionMatch = /\(?v(\d+)\)?$/i.exec(trimmedName);
      if (versionMatch) {
        const base = trimmedName.slice(0, versionMatch.index).trim();
        const nextVer = parseInt(versionMatch[1], 10) + 1;
        const vCandidate = `${base} v${nextVer}`;
        if (isAvailable(vCandidate)) suggestions.push(vCandidate);
      } else {
        const vCandidate = `${trimmedName} (v2)`;
        if (isAvailable(vCandidate)) suggestions.push(vCandidate);
      }

      // 2. Creative / Workflow suffixes
      const contextualVariants = [
        `${trimmedName} - Remix`,
        `${trimmedName} (Mod)`,
        `${trimmedName} - Variant`,
        `${trimmedName} [${currentYear}]`,
        `${trimmedName} (Copy)`
      ];

      for (const v of contextualVariants) {
        if (isAvailable(v) && !suggestions.includes(v)) {
          suggestions.push(v);
        }
      }

      // 3. Numbered fallback
      let counter = 2;
      while (suggestions.length < 5 && counter < 100) {
        const numCandidate = `${trimmedName} (${counter})`;
        if (isAvailable(numCandidate) && !suggestions.includes(numCandidate)) {
          suggestions.push(numCandidate);
        }
        counter++;
      }

      const primarySuggestion = suggestions[0] || `${trimmedName} (2)`;

      if (auto_rename !== true && auto_rename !== 'true') {
        return res.status(409).json({
          error: `A model with the name "${trimmedName}" already exists.`,
          suggested_name: primarySuggestion,
          suggested_names: suggestions
        });
      }

      trimmedName = primarySuggestion;
      safeName = trimmedName.replace(/[<>:"/\\|?*]/g, '').trim();
      libPath = create_subfolder !== false && create_subfolder !== 'false' ? path.join(basePath, safeName) : basePath;
      const reconfined = validatePathConfinement(LIBRARY_PATH, path.relative(LIBRARY_PATH, libPath));
      if (!reconfined) return res.status(400).json({ error: 'Invalid model folder path' });
      libPath = reconfined;
    }

    try {
      if (!fs.existsSync(libPath)) fs.mkdirSync(libPath, { recursive: true });
    } catch (dirErr) {
      console.warn('Could not create library folder for model:', dirErr);
    }

    let metaStr = '{}';
    if (custom_meta !== undefined) {
      metaStr = typeof custom_meta === 'string' ? custom_meta : JSON.stringify(custom_meta);
    }

    const r = run('INSERT INTO models (name,description,print_tips,source_url,category_id,custom_meta,user_id,library_path) VALUES (?,?,?,?,?,?,?,?)',
      [trimmedName, description||'', print_tips||'', source_url||'', category_id||null, metaStr, userId, libPath]);
    if (tags?.length) { 
      for (const t of tags) {
        let tagId = t;
        if (typeof t === 'string') {
          const cleanTag = t.startsWith('NEW:') ? t.substring(4).trim() : t.trim();
          if (!cleanTag) continue;
          tagId = tagIdFor(cleanTag);
        }
        run('INSERT OR IGNORE INTO model_tags (model_id,tag_id) VALUES (?,?)', [r.lastId, tagId]); 
      }
    }
    res.status(201).json(get('SELECT * FROM models WHERE id=?', [r.lastId]));
  } catch (e) {
    console.error('Failed to create model:', e);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

// ─── PUT /api/models/:id ──────────────────────────────────────────────────────
router.put('/:id', authenticate, (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (req.user.role !== 'admin' && model.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { name, description, print_tips, source_url, category_id, tags, custom_meta, is_protected, is_readonly } = req.body;
    if (model.deleted_at) return res.status(404).json({ error: 'Model not found' });
    const readOnly = is_readonly !== undefined ? (is_readonly ? 1 : 0) : (Number(model.is_readonly) === 1 ? 1 : 0);

    // A new name renames the project folder (or loose file) in the library too
    const newName = typeof name === 'string' && name.trim() ? name.trim() : model.name;
    if (newName !== model.name) {
      try {
        projectFiles.renameProject({ ...model, is_readonly: readOnly }, newName);
      } catch (e) {
        if (e instanceof projectFiles.FsError) return res.status(e.status).json({ error: e.message });
        throw e;
      }
    }

    let metaStr = model.custom_meta;
    if (custom_meta !== undefined) {
      metaStr = typeof custom_meta === 'string' ? custom_meta : JSON.stringify(custom_meta);
    }

    let cleanSourceUrl = model.source_url;
    if (source_url !== undefined) {
      cleanSourceUrl = safeUrl(source_url);
    }

    run("UPDATE models SET name=?,description=?,print_tips=?,source_url=?,category_id=?,custom_meta=?,is_protected=?,is_readonly=?,updated_at=datetime('now') WHERE id=?",
      [newName, description!==undefined?description:model.description, print_tips!==undefined?print_tips:model.print_tips, cleanSourceUrl, category_id!==undefined?category_id:model.category_id, metaStr,
       is_protected !== undefined ? (is_protected ? 1 : 0) : (model.is_protected ? 1 : 0), readOnly, id]);
    if (tags !== undefined) {
      run('DELETE FROM model_tags WHERE model_id=?', [id]);
      if (tags?.length) {
        for (const t of tags) {
          let tagId = t;
          if (typeof t === 'string') {
          const cleanTag = t.startsWith('NEW:') ? t.substring(4).trim() : t.trim();
          if (!cleanTag) continue;
          tagId = tagIdFor(cleanTag);
        }
          run('INSERT OR IGNORE INTO model_tags (model_id,tag_id) VALUES (?,?)', [id, tagId]);
        }
      }
    }
    res.json(get('SELECT * FROM models WHERE id=?', [id]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update model' }); }
});

// ─── DELETE /api/models/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
  try {
    if (!req.user || req.user.role === 'viewer') return res.status(403).json({ error: 'Viewer accounts cannot delete data' });
    const id = Number(req.params.id);
    const model = get('SELECT user_id, name, is_readonly FROM models WHERE id=? AND deleted_at IS NULL', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (req.user.role !== 'admin' && model.user_id && model.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    try { projectFiles.assertWritable(model); } catch (e) { return res.status(e.status).json({ error: e.message }); }
    // To the Trash; purged with its files after the retention period
    trashUtil.trashModels([id]);
    res.json({ success: true, trashed: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete model' }); }
});

// ─── POST /api/models/bulk-delete ─────────────────────────────────────────────
router.post('/bulk-delete', authenticate, (req, res) => {
  try {
    if (!req.user || req.user.role === 'viewer') return res.status(403).json({ error: 'Viewer accounts cannot delete data' });
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });
    const allowed = [];
    const readOnly = [];
    for (const id of ids) {
      const numId = Number(id);
      const model = get('SELECT user_id, name, is_readonly FROM models WHERE id=? AND deleted_at IS NULL', [numId]);
      if (!model || !(req.user.role === 'admin' || !model.user_id || model.user_id === req.user.id)) continue;
      // Read-only projects stay; the answer names them
      if (Number(model.is_readonly) === 1) readOnly.push(model.name);
      else allowed.push(numId);
    }
    trashUtil.trashModels(allowed);
    res.json({ success: true, count: allowed.length, trashed: true, read_only: readOnly });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed bulk delete' }); }
});

// ─── POST /api/models/bulk-update ─────────────────────────────────────────────
router.post('/bulk-update', authenticate, (req, res) => {
  try {
    const { ids, category_id, tags, add_tags, remove_tags, is_protected } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });
    
    for (const id of ids) {
      if (req.user.role !== 'admin') {
        const model = get('SELECT user_id FROM models WHERE id=?', [id]);
        if (model && model.user_id !== req.user.id) continue;
      }
      
      if (category_id !== undefined) {
        run("UPDATE models SET category_id=?, updated_at=datetime('now') WHERE id=?", [category_id || null, id]);
      }
      if (is_protected !== undefined) {
        run("UPDATE models SET is_protected=?, updated_at=datetime('now') WHERE id=?", [is_protected ? 1 : 0, id]);
      }

      if (add_tags && Array.isArray(add_tags)) {
        for (const rawTag of add_tags) {
          if (!rawTag) continue;
          const t = typeof rawTag === 'string' ? (rawTag.startsWith('NEW:') ? rawTag.substring(4).trim() : rawTag.trim()) : rawTag;
          if (!t) continue;
          if (typeof t === 'number') {
            run('INSERT OR IGNORE INTO model_tags (model_id,tag_id) VALUES (?,?)', [id, t]);
          } else {
            const tagId = tagIdFor(t);
            if (tagId) run('INSERT OR IGNORE INTO model_tags (model_id,tag_id) VALUES (?,?)', [id, tagId]);
          }
        }
      }

      if (remove_tags && Array.isArray(remove_tags)) {
        for (const t of remove_tags) {
          if (!t) continue;
          // Every tag of that name, whatever its case
          for (const tagRow of all('SELECT id FROM tags WHERE ulower(name) = ulower(?)', [String(t).trim()])) {
            run('DELETE FROM model_tags WHERE model_id=? AND tag_id=?', [id, tagRow.id]);
          }
        }
      }

      if (tags !== undefined) {
        run('DELETE FROM model_tags WHERE model_id=?', [id]);
        if (tags?.length) {
          for (const t of tags) {
            let tagId = t;
            if (typeof t === 'string') {
              const cleanTag = t.startsWith('NEW:') ? t.substring(4).trim() : t.trim();
              if (!cleanTag) continue;
              tagId = tagIdFor(cleanTag);
            }
            if (tagId) {
              run('INSERT OR IGNORE INTO model_tags (model_id,tag_id) VALUES (?,?)', [id, tagId]);
            }
          }
        }
      }
    }
    res.json({ success: true, count: ids.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed bulk update' }); }
});

// ─── POST /api/models/:id/files ───────────────────────────────────────────────
router.post('/:id/files', authenticate, upload.array('files', 20), (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (req.user.role !== 'admin' && model.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    if (kits.isConfiguration(model)) return res.status(400).json({ error: 'A configuration has no files of its own' });
    try { projectFiles.assertWritable(model); } catch (e) { return res.status(e.status).json({ error: e.message }); }
    const { parseGcodeMetadata, extractGcodeThumbnail } = require('../utils/gcode');
    const { extract3mfThumbnail } = require('../utils/3mf');
    const { extractF3dThumbnail } = require('../utils/f3d');
    const uploaded = [];

    // Ensure model has a library directory
    let libPath = model.library_path;
    if (!libPath || !fs.existsSync(libPath)) {
      const safeName = model.name.replace(/[<>:"/\\|?*]/g, '').trim() || `model_${id}`;
      let basePath = LIBRARY_PATH;
      if (req.body.parent_folder) {
        const confined = validatePathConfinement(LIBRARY_PATH, req.body.parent_folder);
        if (!confined) return res.status(400).json({ error: 'Invalid parent folder path' });
        basePath = confined;
      }
      libPath = req.body.create_subfolder !== 'false' ? path.join(basePath, safeName) : basePath;
      const confinedLib = validatePathConfinement(LIBRARY_PATH, path.relative(LIBRARY_PATH, libPath));
      if (!confinedLib) return res.status(400).json({ error: 'Invalid model library path' });
      libPath = confinedLib;
      if (!fs.existsSync(libPath)) fs.mkdirSync(libPath, { recursive: true });
      run('UPDATE models SET library_path=? WHERE id=?', [libPath, id]);
      model.library_path = libPath;
    }

    for (const file of req.files) {
      // Malware Scanning / Magic Bytes validation
      try {
        const buffer = Buffer.alloc(4);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        const hex = buffer.toString('hex').toUpperCase();
        // MZ = 4D5A, ELF = 7F454C46, Script = 2321 (#!...)
        if (hex.startsWith('4D5A') || hex.startsWith('7F454C46') || hex.startsWith('2321')) {
          fs.unlinkSync(file.path);
          console.error(`[SECURITY] Blocked upload of ${file.originalname}: Executable magic bytes detected (${hex})`);
          continue;
        }
      } catch (err) {
        console.error('Failed to validate magic bytes for', file.originalname, err);
      }
      
      const safeOriginalName = path.basename(file.originalname);
      const ft = getFileType(safeOriginalName);
      
      // Move file into library folder with strict path confinement
      let finalDest = path.join(libPath, safeOriginalName);
      try {
        let counter = 1;
        while (fs.existsSync(finalDest)) {
          const ext = path.extname(safeOriginalName);
          const base = path.basename(safeOriginalName, ext);
          finalDest = path.join(libPath, `${base}_${counter}${ext}`);
          counter++;
        }
        const confinedDest = validatePathConfinement(libPath, path.relative(libPath, finalDest));
        if (!confinedDest) {
          fs.unlinkSync(file.path);
          continue;
        }
        fs.copyFileSync(file.path, confinedDest);
        finalDest = confinedDest;
        fs.unlinkSync(file.path);
      } catch (err) {
        console.error('Failed to move uploaded file to library:', err);
        finalDest = file.path;
      }

      let metadata = null;
      let fileThumbnail = null;

      if (ft === 'gcode') {
        const meta = parseGcodeMetadata(finalDest);
        if (meta) metadata = JSON.stringify(meta);
        fileThumbnail = extractGcodeThumbnail(finalDest, UPLOADS_DIR);
        if (fileThumbnail && !model.thumbnail) {
          run('UPDATE models SET thumbnail=? WHERE id=?', [fileThumbnail, id]);
          model.thumbnail = fileThumbnail;
        }
      } else if (ft === '3mf') {
        fileThumbnail = extract3mfThumbnail(finalDest, UPLOADS_DIR);
        if (fileThumbnail && !model.thumbnail) {
          run('UPDATE models SET thumbnail=? WHERE id=?', [fileThumbnail, id]);
          model.thumbnail = fileThumbnail;
        }
      } else if (ft === 'f3d') {
        fileThumbnail = extractF3dThumbnail(finalDest, UPLOADS_DIR);
        if (fileThumbnail && !model.thumbnail) {
          run('UPDATE models SET thumbnail=? WHERE id=?', [fileThumbnail, id]);
          model.thumbnail = fileThumbnail;
        }
      } else if (ft === 'image') {
        fileThumbnail = path.basename(finalDest);
        if (!model.thumbnail) {
          run('UPDATE models SET thumbnail=? WHERE id=?', [fileThumbnail, id]);
          model.thumbnail = fileThumbnail;
        }
      }

      const r = run('INSERT INTO files (model_id,filename,original_name,file_type,file_size,metadata,library_path,thumbnail) VALUES (?,?,?,?,?,?,?,?)',
        [id, path.basename(finalDest), file.originalname, ft, file.size, metadata, finalDest, fileThumbnail]);
      
      // If model has no preview file set, default to first STL or 3MF
      if (!model.preview_file_id && (ft === 'stl' || ft === '3mf')) {
        run('UPDATE models SET preview_file_id=? WHERE id=?', [r.lastId, id]);
        model.preview_file_id = r.lastId;
      }

      uploaded.push({ id: r.lastId, model_id: id, filename: path.basename(finalDest), original_name: file.originalname, file_type: ft, file_size: file.size, metadata, library_path: finalDest, thumbnail: fileThumbnail });

      // Inspect internal files in uploaded ZIP archive without full disk extraction (when enabled, #78)
      if (ft === 'zip' && getSettingBool('scan_zip_archives', true)) {
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(finalDest);
          const entries = zip.getEntries();
          const { SUPPORTED_EXTENSIONS, IMAGE_EXTENSIONS } = require('../utils/library');
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryExt = path.extname(entry.entryName).toLowerCase();
            if (SUPPORTED_EXTENSIONS.includes(entryExt) || IMAGE_EXTENSIONS.includes(entryExt)) {
              const entryVirtualPath = finalDest + '::' + entry.entryName;
              const entryFt = getFileType(entry.name);
              let entryThumb = null;

              if (entryFt === 'image' && !model.thumbnail) {
                try {
                  const thumbFilename = `thumb_${Date.now()}_${path.basename(entry.entryName)}`;
                  const outPath = path.join(UPLOADS_DIR, thumbFilename);
                  fs.writeFileSync(outPath, getZipEntryBuffer(entry));
                  entryThumb = thumbFilename;
                  run('UPDATE models SET thumbnail=? WHERE id=?', [thumbFilename, id]);
                  model.thumbnail = thumbFilename;
                } catch (e) {}
              }

              const entryR = run('INSERT INTO files (model_id, filename, original_name, file_type, file_size, library_path, is_archive_entry, archive_entry_path, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, entry.name, entry.entryName, entryFt, entry.header.size, entryVirtualPath, 1, entry.entryName, entryThumb]);

              if (!model.preview_file_id && (entryFt === 'stl' || entryFt === '3mf')) {
                run('UPDATE models SET preview_file_id=? WHERE id=?', [entryR.lastId, id]);
                model.preview_file_id = entryR.lastId;
              }

              uploaded.push({ id: entryR.lastId, model_id: id, filename: entry.name, original_name: entry.entryName, file_type: entryFt, file_size: entry.header.size, library_path: entryVirtualPath, thumbnail: entryThumb });
            }
          }
        } catch (zipErr) {
          console.warn('Could not inspect uploaded zip archive:', zipErr);
        }
      }
    }
    run("UPDATE models SET updated_at=datetime('now') WHERE id=?", [id]);
    res.status(201).json(uploaded);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to upload files' }); }
});

// ─── POST /api/models/:id/thumbnail ───────────────────────────────────────────
router.post('/:id/thumbnail', authenticate, upload.single('thumbnail'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (req.user.role !== 'admin' && model.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (model.thumbnail) { const p = path.join(UPLOADS_DIR, model.thumbnail); if (fs.existsSync(p)) fs.unlinkSync(p); }
    run("UPDATE models SET thumbnail=?,updated_at=datetime('now') WHERE id=?", [req.file.filename, id]);
    res.json({ thumbnail: req.file.filename });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to upload thumbnail' }); }
});

// ─── PUT /api/models/:id/projects ─────────────────────────────────────────────
router.put('/:id/projects', authenticate, (req, res) => {
  try {
    const modelId = Number(req.params.id);
    const model = get('SELECT id FROM models WHERE id=?', [modelId]);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const { project_ids } = req.body;
    if (!Array.isArray(project_ids)) return res.status(400).json({ error: 'project_ids array required' });

    // Remove existing assignments
    run('DELETE FROM project_models WHERE model_id=?', [modelId]);

    // Insert new assignments
    for (const pid of project_ids) {
      run('INSERT OR IGNORE INTO project_models (project_id, model_id) VALUES (?, ?)', [Number(pid), modelId]);
    }

    const updatedProjects = all('SELECT p.id, p.name, p.visibility FROM projects p JOIN project_models pm ON p.id=pm.project_id WHERE pm.model_id=?', [modelId]);
    res.json({ success: true, projects: updatedProjects });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to sync model projects' });
  }
});

// The file a print of a model may be of: one of its files, or for a configuration one of its
// archive's files; null when `fileId` is none of them
function printableFile(model, fileId) {
  const owner = kits.isConfiguration(model) ? model.kit_source_id : model.id;
  return get('SELECT id, original_name FROM files WHERE id = ? AND model_id = ? AND deleted_at IS NULL', [Number(fileId), owner]);
}

// ─── POST /api/models/:id/prints { material_id, successful, notes, printed_at, file_id } ─
// file_id: the part printed (the progress of a configuration)
router.post('/:id/prints', authenticate, (req, res) => {
  try {
    const id = Number(req.params.id);
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    const { material_id, successful = true, notes = '', printed_at, file_id } = req.body;
    if (file_id && !printableFile(model, file_id)) return res.status(400).json({ error: 'This file is not part of the model' });
    const date = printed_at || new Date().toISOString();
    const r = run('INSERT INTO print_history (model_id,material_id,successful,notes,printed_at,user_id,file_id) VALUES (?,?,?,?,?,?,?)',
      [id, material_id||null, successful?1:0, notes, date, req.user.id, file_id ? Number(file_id) : null]);
    run("UPDATE models SET updated_at=datetime('now') WHERE id=?", [id]);
    res.status(201).json(get('SELECT ph.*,mat.name as material_name FROM print_history ph LEFT JOIN materials mat ON ph.material_id=mat.id WHERE ph.id=?', [r.lastId]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to add print' }); }
});

// ─── POST /api/models/:id/prints/fill { material_id } ────────────────────────
// "Mark all printed": every part of a configuration or parts list gets the successful prints it
// still needs
router.post('/:id/prints/fill', authenticate, (req, res) => {
  try {
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!model || !kits.hasParts(model)) return res.status(404).json({ error: 'No parts list' });
    if (!canEditModel(req.user, model)) return res.status(403).json({ error: 'Forbidden' });
    const done = Object.fromEntries(all('SELECT file_id, COUNT(*) AS n FROM print_history WHERE model_id = ? AND successful = 1 AND file_id IS NOT NULL GROUP BY file_id', [model.id]).map(r => [r.file_id, r.n]));
    const material = req.body.material_id ? Number(req.body.material_id) : null;
    const date = new Date().toISOString();
    let added = 0;
    for (const [fileId, n] of Object.entries(kits.needsOf(model))) {
      for (let i = done[fileId] || 0; i < n; i++) {
        run('INSERT INTO print_history (model_id,material_id,successful,notes,printed_at,user_id,file_id) VALUES (?,?,1,?,?,?,?)', [model.id, material, '', date, req.user.id, Number(fileId)], true);
        added++;
      }
    }
    run("UPDATE models SET updated_at=datetime('now') WHERE id=?", [model.id], true);
    saveDb();
    res.json({ success: true, added, progress: kits.progressOf([model])[model.id] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to mark the parts printed' }); }
});

// ─── DELETE /api/models/:id/prints/parts?file_id= ────────────────────────────
// With file_id: "−", the newest successful print of that part. Without: "Reset progress", every
// print of a part (prints of the whole model stay).
router.delete('/:id/prints/parts', authenticate, (req, res) => {
  try {
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (!canEditModel(req.user, model)) return res.status(403).json({ error: 'Forbidden' });
    let removed = 0;
    if (req.query.file_id) {
      const last = get('SELECT id FROM print_history WHERE model_id = ? AND file_id = ? AND successful = 1 ORDER BY printed_at DESC, id DESC LIMIT 1', [model.id, Number(req.query.file_id)]);
      if (last) { run('DELETE FROM print_history WHERE id = ?', [last.id], true); removed = 1; }
    } else {
      removed = run('DELETE FROM print_history WHERE model_id = ? AND file_id IS NOT NULL', [model.id], true).changes;
    }
    saveDb();
    res.json({ success: true, removed, progress: kits.hasParts(model) ? kits.progressOf([model])[model.id] : null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to undo the print' }); }
});

// ─── PUT /api/models/:id/parts-list { files, hardware, notes } ──────────────
// The parts list of a project, made by hand: files of the project with how many to print,
// hardware (name, how many, "have it") and notes. It lives in the database, so read-only
// projects have one too. An empty list removes it.
router.put('/:id/parts-list', authenticate, (req, res) => {
  try {
    const model = get('SELECT * FROM models WHERE id=? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (kits.isConfiguration(model)) return res.status(409).json({ error: 'A configuration has the parts list of its kit' });
    if (!canEditModel(req.user, model)) return res.status(403).json({ error: 'Forbidden' });
    const own = new Set(all('SELECT id FROM files WHERE model_id = ?', [model.id]).map(f => f.id));
    const count = (v) => Math.min(9999, Math.max(0, Math.floor(Number(v) || 0)));
    const body = req.body || {};
    const files = [];
    for (const f of Array.isArray(body.files) ? body.files : []) {
      const id = Number(f && f.file_id);
      if (!own.has(id)) return res.status(400).json({ error: 'A file of another model' });
      if (!files.some(x => x.file_id === id)) files.push({ file_id: id, qty: count(f.qty) });
    }
    const hardware = (Array.isArray(body.hardware) ? body.hardware : [])
      .map(h => ({ name: String((h && h.name) || '').trim().slice(0, 120), qty: count(h && h.qty), have: Boolean(h && h.have) }))
      .filter(h => h.name);
    const notes = String(body.notes || '').slice(0, 5000);
    const empty = !files.length && !hardware.length && !notes.trim();
    run("UPDATE models SET parts_list = ?, kit_needs = NULL, updated_at = datetime('now') WHERE id = ?",
      [empty ? null : JSON.stringify({ files, hardware, notes }), model.id], true);
    const fresh = get('SELECT * FROM models WHERE id = ?', [model.id]);
    if (!empty) kits.refreshNeeds(fresh);
    saveDb();
    res.json({ parts_list: kits.partsListOf(fresh), progress: empty ? null : kits.progressOf([fresh])[model.id] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save the parts list' }); }
});

module.exports = router;

