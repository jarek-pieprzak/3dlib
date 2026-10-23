// What a slicer project (a Bambu Studio / OrcaSlicer 3MF) is set up with, for the versions of a
// file. Only the small files of the project are read, never its meshes:
//   Metadata/project_settings.config  every setting: printer, process, filaments (JSON)
//   Metadata/model_settings.config    the objects (their filament, own settings, faces), plates
//   Metadata/slice_info.config        time and weight, when the project was sliced
//   3D/3dmodel.model                  the application and how each object is turned (streamed:
//                                     some files keep their meshes in it)
// read(path) -> { summary, settings }: `summary` is what the versions table shows, `settings` a
// flat map of every setting for comparing two versions (diff).
const crypto = require('crypto');

const SMALL_ENTRY = 8 * 1024 * 1024;
const SMALL_FILES = ['metadata/project_settings.config', 'metadata/model_settings.config', 'metadata/slice_info.config'];
const MODEL_FILE = '3d/3dmodel.model';
const THUMBNAILS = ['metadata/plate_1.png', 'metadata/thumbnail.png', 'metadata/plate_1_small.png'];

// Settings that change without the user changing anything, or follow other settings anyway
const NOISE = new Set(['version', 'name', 'different_settings_to_system', 'inherits_group', 'inherits', 'upward_compatible_machine',
  'print_compatible_printers', 'compatible_printers', 'compatible_prints', 'compatible_printers_condition', 'compatible_prints_condition',
  'filament_settings_id_backup']);
// Metadata of objects, parts and plates that is not a setting
const OBJECT_INFO = new Set(['name', 'extruder', 'matrix', 'source_file', 'source_object_id', 'source_volume_id', 'source_offset_x',
  'source_offset_y', 'source_offset_z', 'object_id', 'instance_id', 'identify_id']);
const PLATE_INFO = new Set(['plater_id', 'plater_name', 'locked', 'thumbnail_file', 'thumbnail_no_light_file', 'top_file', 'pick_file',
  'pattern_file', 'pattern_bbox_file', 'filament_map_mode', 'filament_maps', 'filament_volume_maps', 'gcode_file', 'object_id', 'instance_id', 'identify_id']);

// The entries of a 3MF this needs: { files: { lowercase name: text }, model: { app, items }, thumbnail }
function readEntries(filePath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const out = { files: {}, model: { app: null, items: [] }, thumbnail: null };
      let failed = false;
      const fail = (e) => { if (!failed) { failed = true; zip.close(); reject(e); } };
      zip.on('error', fail);
      zip.on('entry', (entry) => {
        const name = entry.fileName.toLowerCase();
        if (THUMBNAILS.includes(name) && (!out.thumbnail || THUMBNAILS.indexOf(name) < THUMBNAILS.indexOf(out.thumbnail.toLowerCase()))) out.thumbnail = entry.fileName;
        const small = SMALL_FILES.includes(name) && entry.uncompressedSize <= SMALL_ENTRY;
        if (!small && name !== MODEL_FILE) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return fail(e);
          (small ? readText(stream).then(text => { out.files[name] = text; }) : readModel(stream, out.model))
            .then(() => zip.readEntry(), fail);
        });
      });
      zip.on('end', () => { if (!failed) resolve(out); });
      zip.readEntry();
    });
  });
}

function readText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

// The application and the build items (their transforms) of 3dmodel.model, streamed
function readModel(stream, model) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const take = (text, end) => {
      const app = /<metadata\s+name="Application"\s*>([^<]*)<\/metadata>/.exec(text);
      if (app && !model.app) model.app = app[1].trim();
      const tag = /<(?:\w+:)?item\b([^>]*)>/g;
      let m;
      let last = 0;
      while ((m = tag.exec(text))) {
        last = tag.lastIndex;
        model.items.push(attr(m[1], 'transform'));
      }
      if (end) return '';
      // Keep what may be the start of a tag cut by the chunk
      const open = text.lastIndexOf('<');
      return text.slice(Math.max(last, open >= last ? open : text.length)).slice(-4096);
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { buf = take(buf + chunk, false); });
    stream.on('end', () => { take(buf, true); resolve(); });
    stream.on('error', reject);
  });
}

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs || '');
  return m ? m[1] : null;
}

// <metadata key="k" value="v"/> pairs directly in `xml` (not in nested blocks taken out before)
function metadataOf(xml) {
  const out = {};
  for (const m of xml.matchAll(/<metadata\s+key="([^"]*)"\s+value="([^"]*)"\s*\/>/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
}

function unescapeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Objects (with their parts) and plates of model_settings.config
function parseModelSettings(xml) {
  const objects = [];
  for (const m of String(xml || '').matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
    const body = m[1];
    const parts = [...body.matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map(p => metadataOf(p[1]));
    const own = metadataOf(body.replace(/<part\b[\s\S]*?<\/part>/g, ''));
    const faces = /<metadata\s+face_count="(\d+)"/.exec(body);
    objects.push({ meta: own, parts, faces: faces ? Number(faces[1]) : null });
  }
  const plates = [...String(xml || '').matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/g)]
    .map(m => metadataOf(m[1].replace(/<model_instance\b[\s\S]*?<\/model_instance>/g, '')));
  return { objects, plates };
}

// Time (s) and weight (g) of every sliced plate, summed; null when nothing was sliced
function parseSliceInfo(xml) {
  let time = 0;
  let weight = 0;
  let any = false;
  for (const m of String(xml || '').matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/g)) {
    const meta = metadataOf(m[1]);
    if (meta.prediction) { time += Number(meta.prediction) || 0; any = true; }
    if (meta.weight) { weight += Number(meta.weight) || 0; any = true; }
  }
  return any ? { time: Math.round(time), weight: Math.round(weight * 10) / 10 } : null;
}

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const text = (v) => (Array.isArray(v) ? v.join('; ') : v === undefined || v === null ? null : String(v));

// The turn of a build item ("1 0 0 0 1 0 0 0 1 x y z"): its 3 × 3 part, rounded; the place on
// the plate does not count
function turnOf(transform) {
  const n = String(transform || '1 0 0 0 1 0 0 0 1 0 0 0').trim().split(/\s+/).map(Number);
  return n.slice(0, 9).map(v => (Math.abs(v) < 5e-4 ? 0 : Math.round(v * 1000) / 1000)).join(' ');
}

function summarize(entries) {
  let s = {};
  try { s = JSON.parse(entries.files['metadata/project_settings.config'] || '{}') || {}; } catch (e) { s = {}; }
  const { objects, plates } = parseModelSettings(entries.files['metadata/model_settings.config']);

  // The filaments the objects and their parts print with (1-based slots)
  const slots = new Set();
  for (const o of objects) {
    slots.add(String(o.meta.extruder || '1'));
    for (const p of o.parts) if (p.extruder) slots.add(String(p.extruder));
  }
  if (!slots.size) slots.add('1');
  const at = (key, i) => list(s[key])[i - 1];
  const filaments = [...slots].map(Number).filter(n => n > 0).sort((a, b) => a - b).map(n => ({
    slot: n, type: at('filament_type', n) || null, vendor: at('filament_vendor', n) || null,
    name: at('filament_settings_id', n) || null, colour: at('filament_colour', n) || null
  }));
  const own = (key) => objects.filter(o => o.meta[key] !== undefined);
  const faces = objects.some(o => o.faces) ? objects.reduce((n, o) => n + (o.faces || 0), 0) : null;

  const summary = {
    app: entries.model.app || (s.version ? `BambuStudio-${s.version}` : null),
    printer: text(s.printer_settings_id) || text(s.printer_model),
    nozzle: list(s.nozzle_diameter)[0] || null,
    process: text(s.print_settings_id),
    layer_height: text(s.layer_height),
    filaments,
    infill: s.sparse_infill_density !== undefined ? { density: text(s.sparse_infill_density), pattern: text(s.sparse_infill_pattern) } : null,
    walls: text(s.wall_loops),
    top_layers: text(s.top_shell_layers),
    bottom_layers: text(s.bottom_shell_layers),
    supports: s.enable_support !== undefined || own('enable_support').length ? {
      enabled: text(s.enable_support) === '1',
      type: text(s.support_type),
      objects_on: own('enable_support').filter(o => o.meta.enable_support === '1').length,
      objects_off: own('enable_support').filter(o => o.meta.enable_support === '0').length
    } : null,
    bed: text(s.curr_bed_type),
    brim: text(s.brim_type),
    objects: objects.length || entries.model.items.length,
    plates: plates.length || 1,
    faces,
    // Settings of the objects that differ from the project's (supports for one part, ...)
    object_settings: [...new Set(objects.flatMap(o => Object.keys(o.meta).filter(k => !OBJECT_INFO.has(k))))].sort(),
    preset_changes: list(s.different_settings_to_system)[0] ? String(list(s.different_settings_to_system)[0]).split(';').filter(Boolean) : [],
    sliced: parseSliceInfo(entries.files['metadata/slice_info.config']),
    thumbnail: entries.thumbnail
  };

  // Every setting as text, for comparing versions
  const settings = {};
  for (const [k, v] of Object.entries(s)) {
    if (NOISE.has(k) || /_gcode$/.test(k)) continue;
    settings[k] = text(v);
  }
  objects.forEach((o, i) => {
    const label = `object ${i + 1}${o.meta.name ? ` (${o.meta.name})` : ''}`;
    settings[`${label}: filament`] = String(o.meta.extruder || '1');
    for (const [k, v] of Object.entries(o.meta)) if (!OBJECT_INFO.has(k)) settings[`${label}: ${k}`] = v;
    o.parts.forEach((p, j) => {
      for (const [k, v] of Object.entries(p)) if (!OBJECT_INFO.has(k)) settings[`${label} part ${j + 1}: ${k}`] = v;
      if (p.extruder) settings[`${label} part ${j + 1}: filament`] = String(p.extruder);
    });
    if (o.faces) settings[`${label}: faces`] = String(o.faces);
  });
  plates.forEach((p, i) => {
    for (const [k, v] of Object.entries(p)) if (!PLATE_INFO.has(k)) settings[`plate ${i + 1}: ${k}`] = v;
  });
  entries.model.items.forEach((t, i) => { settings[`item ${i + 1}: turn`] = turnOf(t); });
  settings['objects'] = String(summary.objects);
  settings['plates'] = String(summary.plates);
  return { summary, settings };
}

async function read(filePath) {
  return summarize(await readEntries(filePath));
}

// Same settings, objects, turns and faces: one key (the place on the plate does not count)
function keyOf(settings) {
  const sorted = Object.keys(settings).sort().map(k => [k, settings[k]]);
  return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

// What changed from `before` to `after`: [{ key, from, to }], at most `max`
function diff(before, after, max = 300) {
  const out = [];
  for (const key of [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort()) {
    const from = before && before[key] !== undefined ? before[key] : null;
    const to = after && after[key] !== undefined ? after[key] : null;
    if (from !== to) out.push({ key, from, to });
    if (out.length >= max) break;
  }
  return out;
}

// One entry of a 3MF as a buffer (a plate thumbnail), or null
function readEntry(filePath, entryName) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      let found = null;
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        if (entry.fileName !== entryName || entry.uncompressedSize > SMALL_ENTRY) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('end', () => { found = Buffer.concat(chunks); zip.close(); resolve(found); });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => { if (!found) resolve(null); });
      zip.readEntry();
    });
  });
}

module.exports = { read, summarize, keyOf, diff, readEntry, turnOf };
