// Copies a model's source page into its project folder, so it stays when the page changes or
// goes: README.md (who made it, the description, print profiles or settings, hardware), the
// pictures under images/, the attached documents (PDF manuals) and the model files (STLs,
// G-codes, profile 3MFs, raw files). Sites: MakerWorld and Printables (server/utils/sources/).
// MakerWorld gives its files only to a logged-in user: the Bambu Lab login of the user who saved
// the model (utils/bambuAccount.js); without it the page's documentation is copied, not its files.
//
// Texts come in the language the user chose in Profile (MakerWorld translates them; English by
// default).
//
// It starts by itself when a model is saved with such a Source URL (a new URL, or one whose last
// copy failed) and runs in the background. models.source_import keeps the outcome for the model
// page: { url, site, status: 'running' | 'done' | 'error', at, message, files: 'login_needed' |
// 'login_refused', version: id of a new version }.
//  * Files already in the folder stay, never replaced (they may be the user's own); a download the
//    project already has under another name or folder (same content) is dropped and the README
//    links that file.
//  * "Check for updates" (POST /api/models/:id/source-import) compares the site's model files with
//    the folder (missing, or another size). Nothing changed: new pictures and documents come in, the
//    README is written again. Something changed: the page is copied as a new version of the model
//    ("<name> (v2)", its own folder next to the project, models.parent_id), the project stays as it
//    is. A model never copied yet gets its first copy instead.
//  * A README that 3DLib did not write is kept: the copy goes to "<Site>.md" next to it.
//  * A project made of one loose file becomes a folder first; read-only projects are left alone.
//  * Tags of the page are added; hardware fills the Parts tab when it has no list yet.
const fs = require('fs');
const path = require('path');
const { get, all, run, saveDb } = require('../database');
const { DATA_DIR } = require('../config');
const { getFileType, getScanStatus, isIgnoredFile } = require('../utils/library');
const projectFiles = require('../utils/projectFiles');
const fileVersions = require('../utils/fileVersions');
const bambuAccount = require('../utils/bambuAccount');
const { sourceOf } = require('../utils/sources');
const { assetsOf, buildReadme, hasMarker, safeFileName } = require('../utils/sources/common');
const translateMod = require('../utils/sources/translate');
const { translator } = translateMod;
const names3mf = require('../utils/sources/names3mf');
const http = require('../utils/sources/http');
const { tagIdFor, logEvent, hashFileStream } = require('../utils/modelHelpers');
const { newToken } = require('../utils/slicerToken');

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const running = new Set();

function statusOf(model) {
  try { return model && model.source_import ? JSON.parse(model.source_import) : null; } catch (e) { return null; }
}

function setStatus(modelId, status) {
  run('UPDATE models SET source_import = ? WHERE id = ?', [JSON.stringify({ ...status, at: new Date().toISOString() }), modelId], true);
  saveDb();
}

// A hidden ".<name>.part" next to the destination: the scanner skips dotfiles
const partOf = (dest) => path.join(path.dirname(dest), `.${path.basename(dest)}.part`);

// Into `part` (the caller renames it or drops it)
async function download(url, part, opts) {
  fs.mkdirSync(path.dirname(part), { recursive: true });
  const res = await http.open(url, opts);
  let size = 0;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part);
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) res.destroy(new Error('The file is too large'));
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
  } catch (e) {
    try { fs.unlinkSync(part); } catch (x) { /* never written */ }
    throw e;
  }
}

// ─── Into the project ────────────────────────────────────────────────────────

// The database row of a file in the project folder: indexed like the scanner does (with the
// thumbnail of a 3MF / G-code), a row in the Trash comes back (the import asked for it again)
// sourceSize: the size the site gave the file, when 3DLib changed it (names translated in a 3MF)
function indexFile(model, root, abs, sourceSize = null) {
  const size = fs.statSync(abs).size;
  const row = get('SELECT * FROM files WHERE library_path = ?', [abs]);
  if (row) {
    run('UPDATE files SET file_size = ?, deleted_at = NULL, source_size = COALESCE(?, source_size) WHERE id = ?', [size, sourceSize, row.id], true);
    return row.id;
  }
  const filename = path.basename(abs);
  const r = run('INSERT INTO files (model_id, filename, original_name, file_type, file_size, library_path, slicer_token, source_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [model.id, filename, projectFiles.relOf(root, abs), getFileType(filename), size, abs, newToken(), sourceSize], true);
  const file = get('SELECT * FROM files WHERE id = ?', [r.lastId]);
  if (['3mf', 'gcode'].includes(file.file_type)) {
    try { fileVersions.refreshFileInfo(model, file); } catch (e) { /* the scanner reads it later */ }
  }
  return r.lastId;
}

// A file of the project with the same content (the manual saved by hand under another name or in
// another folder), or null. candidates: absolute paths; same size first, then SHA-256.
async function sameContent(file, candidates) {
  const size = fs.statSync(file).size;
  let hash = null;
  for (const c of candidates) {
    let st;
    try { st = fs.statSync(c); } catch (e) { continue; }
    if (st.size !== size) continue;
    hash = hash || await hashFileStream(file);
    if (await hashFileStream(c) === hash) return c;
  }
  return null;
}

function writeText(dest, text) {
  const part = partOf(dest);
  fs.writeFileSync(part, text, 'utf8');
  fs.renameSync(part, dest);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForScan() {
  for (let i = 0; i < 900 && getScanStatus().isScanning; i++) await sleep(2000);
  projectFiles.assertNotScanning();
}

function addTags(model, tags) {
  let added = 0;
  for (const t of tags || []) {
    const name = String(t || '').trim().slice(0, 60);
    if (!name) continue;
    const r = run('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)', [model.id, tagIdFor(name)], true);
    if (r && r.changes) added++;
  }
  return added;
}

// The hardware of the page as the Parts tab's list, when the project has none yet
function fillPartsList(model, hardware, site) {
  if (!hardware.length || get('SELECT parts_list FROM models WHERE id = ?', [model.id]).parts_list) return false;
  const list = {
    files: [],
    hardware: hardware.map(h => ({ name: h.name, qty: h.qty, have: false })),
    notes: [`Hardware from ${site}.`, ...hardware.filter(h => h.note).map(h => `${h.name}: ${h.note}`)].join('\n')
  };
  run('UPDATE models SET parts_list = ?, kit_needs = NULL WHERE id = ?', [JSON.stringify(list), model.id], true);
  require('../utils/kits').refreshNeeds(get('SELECT * FROM models WHERE id = ?', [model.id]));
  return true;
}

// The entries of a ZIP: [{ rel, read(dest) }] (folders, system clutter and unsafe paths left out)
function zipEntries(zipPath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('entry', (e) => {
        const parts = String(e.fileName).replace(/\\/g, '/').split('/').filter(Boolean);
        const safe = parts.length && !parts.some(p => p === '..' || p === '.' || p.startsWith('.') || p === '__MACOSX' || /[<>:"|?*\x00-\x1f]/.test(p));
        if (!/\/$/.test(e.fileName) && safe && !isIgnoredFile(parts[parts.length - 1])) {
          entries.push({
            rel: parts.join('/'),
            read: (dest) => new Promise((ok, bad) => zip.openReadStream(e, (er, stream) => {
              if (er) return bad(er);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              const out = fs.createWriteStream(dest);
              stream.on('error', bad);
              out.on('error', bad);
              out.on('finish', ok);
              stream.pipe(out);
            }))
          });
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve({ entries, close: () => zip.close() }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// The language the user wants copied pages in (Profile; MakerWorld translates them)
function languageOf(userId) {
  const u = userId ? get('SELECT source_language FROM users WHERE id = ?', [userId]) : null;
  return (u && u.source_language) || 'en';
}

// The page of the site, with errors in words for the model page
async function loadPage(source, id, userId) {
  const token = source.usesBambuLogin ? await bambuAccount.tokenFor(userId) : null;
  try {
    const page = await source.load(id, http, { token, lang: languageOf(userId) });
    if (token && page.filesNote === 'login_refused') { bambuAccount.mark(userId, 'invalid'); saveDb(); }
    else if (token && page.files && page.files.length) bambuAccount.mark(userId, 'ok');
    return page;
  } catch (e) {
    if (e.status === 403 || e.status === 429) throw new Error(`${source.site} refused the request (${e.message}); try again later`);
    if (e.status === 404) throw new Error(`${source.site} has no model with this number`);
    if (e.status || e.code) throw new Error(`${source.site} could not be reached: ${e.message}`);
    throw e;
  }
}

// The title of a page (for a model made from a link), in the user's language
async function titleOf(url, userId) {
  const found = sourceOf(url);
  if (!found) return null;
  const page = await loadPage({ ...found.source, usesBambuLogin: false }, found.id, userId);
  return { site: found.source.site, title: String(page.title || '').trim() };
}

// Copies the page (loaded already) into the model's folder; lang: the user's language, for the
// names the site leaves untranslated (files, folders, plates and objects inside 3MFs)
async function importPage(modelId, found, page, lang = 'original') {
  const { source } = found;
  await waitForScan();
  const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [modelId]);
  if (!model) throw new Error('The model is gone');
  const root = projectFiles.ensureProjectFolder(model); // read-only: FsError; a loose file: a folder now
  model.library_path = root;

  const local = new Map();
  const failed = [];
  const reused = [];
  const counts = { description: 0, gallery: 0, document: 0, model: 0, archive: 0 };
  const touched = [];
  const sourceSizes = new Map(); // abs path -> size as the site gave it (names changed after)
  let renamed = 0;
  const own = all("SELECT library_path FROM files WHERE model_id = ? AND deleted_at IS NULL AND library_path IS NOT NULL AND library_path NOT LIKE '%::%'", [modelId])
    .map(f => f.library_path);

  // Names in another script get their translation next to them: file and folder names, and the
  // plates and objects inside a 3MF ("配料台 (Stół do przygotowywania składników)")
  const tr = translator(lang, { db: { get, run }, http });
  const names = new Map();
  const learn = async (texts) => { for (const [k, v] of await tr.translate(texts.filter(t => !names.has(t)))) names.set(k, v); };
  const relIn = (rel) => rel.split('/').map((seg, i, all) => {
    const stem = i === all.length - 1 ? translateMod.stemOf(seg) : seg;
    const t = names.get(stem);
    if (!t) return seg;
    return safeFileName(i === all.length - 1 ? translateMod.dualFileName(seg, t) : translateMod.dual(seg, t), seg);
  }).join('/');
  const segmentsOf = (rels) => rels.flatMap(rel => rel.split('/').map((seg, i, all) => (i === all.length - 1 ? translateMod.stemOf(seg) : seg)));
  const renameInside = async (abs) => {
    if (!/\.3mf$/i.test(abs)) return;
    const inside = names3mf.namesOf(abs).filter(translateMod.needsTranslation);
    if (!inside.length) return;
    await learn(inside);
    const size = fs.statSync(abs).size;
    if (names3mf.renameAll(abs, n => (names.has(n) ? translateMod.dual(n, names.get(n)) : n))) {
      sourceSizes.set(abs, size);
      renamed++;
    }
  };
  const assets = assetsOf(page, source.isAsset);
  await learn(segmentsOf(assets.filter(a => a.kind !== 'description').map(a => a.rel)));

  // A downloaded file (at `part`) for `dest`: a file already at `dest` stays; content the project
  // has elsewhere is not added twice; otherwise it is put in place
  const place = async (part, dest) => {
    if (projectFiles.exists(dest)) { fs.unlinkSync(part); return { rel: projectFiles.relOf(root, dest) }; }
    const twin = await sameContent(part, own);
    if (twin) {
      fs.unlinkSync(part);
      const rel = projectFiles.relOf(root, twin);
      reused.push(rel);
      return { rel };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(part, dest);
    touched.push(dest);
    own.push(dest);
    return { rel: projectFiles.relOf(root, dest), placed: true };
  };

  for (const asset of assets) {
    const rel = asset.kind === 'description' ? asset.rel : relIn(asset.rel);
    const dest = path.join(root, ...rel.split('/'));
    const part = partOf(dest);
    const opts = { allow: source.isAsset };
    try {
      if (asset.kind === 'archive') {
        // Raw files: into the folder entry by entry, the ZIP itself is not kept
        const tmp = path.join(DATA_DIR, 'tmp', `source-${modelId}-${Date.now()}.zip`);
        await download(asset.url, tmp, opts);
        try {
          const zip = await zipEntries(tmp);
          try {
            await learn(segmentsOf(zip.entries.map(e => e.rel)));
            for (const e of zip.entries) {
              const out = path.join(root, ...relIn(e.rel).split('/'));
              const ep = partOf(out);
              try {
                if (projectFiles.exists(out)) { touched.push(out); counts.archive++; continue; }
                await e.read(ep);
                const r = await place(ep, out);
                if (r.placed) await renameInside(out);
                counts.archive++;
              } catch (er) {
                try { fs.unlinkSync(ep); } catch (x) { /* none */ }
                failed.push(`${e.rel} (${er.message})`);
              }
            }
          } finally { zip.close(); }
        } finally { try { fs.unlinkSync(tmp); } catch (x) { /* gone */ } }
        local.set(asset.url, '.');
        continue;
      }
      if (projectFiles.exists(dest)) {
        local.set(asset.url, rel);
        touched.push(dest);
        counts[asset.kind]++;
        continue;
      }
      await download(asset.url, part, opts);
      const r = await place(part, dest);
      if (r.placed && asset.kind === 'model') await renameInside(dest);
      local.set(asset.url, r.rel);
      counts[asset.kind]++;
    } catch (e) {
      try { fs.unlinkSync(part); } catch (x) { /* none */ }
      failed.push(`${rel} (${e.message})`);
    }
  }

  // README.md, unless the project has a README of its own
  let readmeName = null;
  for (const name of ['README.md', `${source.site}.md`]) {
    const p = path.join(root, name);
    if (!projectFiles.exists(p) || hasMarker(fs.readFileSync(p, 'utf8').slice(0, 300))) { readmeName = name; break; }
  }
  if (readmeName) {
    const today = new Date().toISOString().slice(0, 10);
    writeText(path.join(root, readmeName), buildReadme(page, { local: u => local.get(u) || null, today }));
    touched.push(path.join(root, readmeName));
  }

  const fresh = get('SELECT * FROM models WHERE id = ?', [modelId]);
  for (const abs of touched) indexFile(fresh, root, abs, sourceSizes.get(abs) || null);
  const tags = addTags(fresh, page.tags);
  const parts = fillPartsList(fresh, page.hardware || [], source.site);
  run("UPDATE models SET updated_at = datetime('now') WHERE id = ?", [modelId], true);
  saveDb();

  const n = (k, one, many) => `${counts[k]} ${counts[k] === 1 ? one : many}`;
  const bits = [readmeName ? `the description (${readmeName})` : 'no description (README.md is not from 3DLib)',
    n('description', 'picture of it', 'pictures of it'), n('gallery', 'gallery picture', 'gallery pictures'), n('document', 'document', 'documents')];
  if (counts.model || counts.archive) bits.push(`${counts.model + counts.archive} model file${counts.model + counts.archive === 1 ? '' : 's'}`);
  let message = `Copied ${bits.join(', ')} from ${source.site}`;
  if (tags) message += `; ${tags} tag${tags === 1 ? '' : 's'} added`;
  if (parts) message += '; hardware in the Parts tab';
  if (renamed) message += `; plate and object names translated in ${renamed} 3MF file${renamed === 1 ? '' : 's'}`;
  if (page.filesNote === 'login_needed') message += `. Model files: log in to ${source.site} in Profile -> API & Integrations`;
  if (page.filesNote === 'login_refused') message += `. Model files: ${source.site} refused your login, log in again in Profile -> API & Integrations`;
  if (reused.length) message += `. Already in the project: ${reused.join(', ')}`;
  if (failed.length) message += `. Not downloaded: ${failed.join(', ')}`;
  return { message, failed: failed.length, files: page.filesNote };
}

// The site's model files against the project: { changed: missing or of another size, present:
// in the folder } ([{ rel, size }]; the raw files of a ZIP by the list the site gives of them)
function compareFiles(model, page, source, lang = 'original') {
  const info = projectFiles.projectInfo(model);
  if (!info || !info.isFolder) return { changed: [], present: [] };
  const expected = [
    ...assetsOf(page, source.isAsset).filter(a => a.kind === 'model').map(a => ({ rel: a.rel, size: a.size })),
    ...(page.archiveEntries || [])
  ];
  // A file of the same size under another name is the same file (a profile 3MF is named in the
  // user's language: another language renames it). Sizes are the site's: a 3MF whose names 3DLib
  // translated keeps the size it was downloaded with (files.source_size)
  const rows = all('SELECT library_path, file_size, source_size FROM files WHERE model_id = ? AND deleted_at IS NULL', [model.id]);
  const sizeOf = new Map(rows.map(f => [f.library_path, Number(f.source_size || f.file_size)]));
  const sizes = new Set(sizeOf.values());
  const changed = [];
  const present = [];
  for (const e of expected) {
    // At its name, or at the name with its translation next to it (as the copy named it)
    let abs = null;
    for (const rel of [e.rel, ...cachedRels(e.rel, lang)]) {
      const p = path.join(info.root, ...rel.split('/'));
      if (projectFiles.exists(p)) { abs = p; break; }
    }
    if (!abs && e.size && sizes.has(e.size)) { present.push(e); continue; }
    if (abs) present.push(e);
    const size = abs ? (sizeOf.get(abs) || fs.statSync(abs).size) : 0;
    if (!abs || (e.size && size !== e.size)) changed.push(e);
  }
  return { changed, present };
}

// The path with the translations a copy may have put next to its names: the user's language first,
// then the others in the cache of translations (a copy made before the language was changed)
function cachedRels(rel, lang) {
  if (!rel.split('/').some(translateMod.needsTranslation)) return [];
  const langs = [...new Set([lang, ...all('SELECT DISTINCT lang FROM source_translations').map(r => r.lang)])].filter(l => l && l !== 'original');
  return langs.map(l => rel.split('/').map((seg, i, segs) => {
    const last = i === segs.length - 1;
    const stem = last ? translateMod.stemOf(seg) : seg;
    if (!translateMod.needsTranslation(stem)) return seg;
    const row = get('SELECT text FROM source_translations WHERE src = ? AND lang = ?', [stem, l]);
    if (!row) return seg;
    return safeFileName(last ? translateMod.dualFileName(seg, row.text) : translateMod.dual(seg, row.text), seg);
  }).join('/'));
}

// A new version of the model for a changed page: "<name> (vN)" in a folder next to the project,
// linked to the first model of its family (models.parent_id), with its tags
function createVersion(model, userId) {
  const head = (model.parent_id && get('SELECT * FROM models WHERE id = ?', [model.parent_id])) || model;
  const family = all('SELECT id FROM models WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL', [head.id, head.id]).length;
  const info = projectFiles.projectInfo(model);
  const parentDir = path.dirname(info.root);
  for (let n = family + 1; n < 1000; n++) {
    const name = `${head.name} (v${n})`;
    const folder = path.join(parentDir, name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim());
    if (get('SELECT id FROM models WHERE ulower(name) = ulower(?) OR library_path = ?', [name, folder]) || projectFiles.exists(folder)) continue;
    fs.mkdirSync(folder);
    const r = run('INSERT INTO models (name, description, print_tips, source_url, category_id, custom_meta, user_id, parent_id, library_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, model.description || '', model.print_tips || '', model.source_url, model.category_id || null, model.custom_meta || '{}', userId || model.user_id, head.id, folder]);
    for (const t of all('SELECT tag_id FROM model_tags WHERE model_id = ?', [model.id])) {
      run('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)', [r.lastId, t.tag_id], true);
    }
    saveDb();
    return { id: r.lastId, name };
  }
  throw new Error('No free name for a new version');
}

async function runImport(modelId, url, userId) {
  const found = sourceOf(url);
  const site = found.source.site;
  running.add(modelId);
  setStatus(modelId, { url, site, status: 'running', message: `Copying ${site}...` });
  try {
    const page = await loadPage(found.source, found.id, userId);
    const r = await importPage(modelId, found, page, languageOf(userId));
    setStatus(modelId, { url, site, status: 'done', message: r.message, files: r.files });
    logEvent(r.failed ? 'warning' : 'info', `Source import, model ${modelId}: ${r.message}`);
  } catch (e) {
    const message = e.message || 'The copy failed';
    if (get('SELECT id FROM models WHERE id = ?', [modelId])) setStatus(modelId, { url, site, status: 'error', message });
    logEvent('warning', `Source import, model ${modelId} (${url}): ${message}`);
  } finally {
    running.delete(modelId);
  }
}

async function runCheck(modelId, url, userId) {
  const found = sourceOf(url);
  const site = found.source.site;
  running.add(modelId);
  setStatus(modelId, { url, site, status: 'running', message: `Checking ${site} for updates...` });
  try {
    const page = await loadPage(found.source, found.id, userId);
    const model = get('SELECT * FROM models WHERE id = ? AND deleted_at IS NULL', [modelId]);
    if (!model) throw new Error('The model is gone');
    const { changed, present } = compareFiles(model, page, found.source, languageOf(userId));
    // Nothing changed, or the project has none of the site's files yet (copied without a login
    // before): this model gets what is new
    if (!changed.length || !present.length) {
      const r = await importPage(modelId, found, page, languageOf(userId));
      const message = changed.length ? r.message : `No new or changed model files on ${site}. ${r.message}`;
      setStatus(modelId, { url, site, status: 'done', message, files: r.files });
      logEvent('info', `Source update check, model ${modelId}: ${message}`);
      return;
    }
    // Something changed: a new version gets the page, this model stays as it is
    await waitForScan();
    const version = createVersion(model, userId);
    running.add(version.id);
    setStatus(version.id, { url, site, status: 'running', message: `Copying ${site}...` });
    try {
      const r = await importPage(version.id, found, page, languageOf(userId));
      setStatus(version.id, { url, site, status: 'done', message: r.message, files: r.files });
    } finally { running.delete(version.id); }
    const list = changed.slice(0, 5).map(c => c.rel).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
    const message = `${changed.length} new or changed file${changed.length === 1 ? '' : 's'} on ${site} (${list}): copied as the new version "${version.name}"`;
    setStatus(modelId, { url, site, status: 'done', message, version: version.id, files: page.filesNote });
    logEvent('info', `Source update check, model ${modelId}: ${message}`);
  } catch (e) {
    const message = e.message || 'The check failed';
    if (get('SELECT id FROM models WHERE id = ?', [modelId])) setStatus(modelId, { url, site, status: 'error', message });
    logEvent('warning', `Source update check, model ${modelId} (${url}): ${message}`);
  } finally {
    running.delete(modelId);
  }
}

// After a model is saved by userId: copies its source page when the URL is new or its last copy
// failed. True when a copy started.
function maybeStart(model, previousUrl, userId) {
  const url = model && model.source_url;
  if (!url || !sourceOf(url) || running.has(model.id) || model.kit_source_id) return false;
  const last = statusOf(model);
  if (url === previousUrl && last && last.url === url && last.status === 'done') return false;
  runImport(model.id, url, userId).catch(() => {});
  return true;
}

// "Check for updates": a model copied already from its Source URL is compared with the site
// (runCheck); one never copied gets its first copy
function checkForUpdates(model, userId) {
  const url = model && model.source_url;
  if (!url || !sourceOf(url) || running.has(model.id) || model.kit_source_id) return false;
  const last = statusOf(model);
  const copied = last && last.url === url && last.status === 'done';
  if (copied) runCheck(model.id, url, userId).catch(() => {});
  else runImport(model.id, url, userId).catch(() => {});
  return true;
}

// At start: a copy cut off by a restart is marked failed (Check for updates retries it)
function resetInterrupted() {
  for (const m of all("SELECT id, source_import FROM models WHERE source_import LIKE '%\"running\"%'")) {
    const s = statusOf(m);
    if (s && s.status === 'running') setStatus(m.id, { url: s.url, site: s.site, status: 'error', message: 'The copy was cut off by a restart: use Check for updates to retry' });
  }
}

module.exports = { maybeStart, checkForUpdates, titleOf, statusOf, resetInterrupted, sourceOf, isRunning: (id) => running.has(id) };
