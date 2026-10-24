/* ─── Hero Me Gen7 kit: printhead parts by release ─────────────────────────
 * Hero Me Gen7 (MediaMan3D, merlinmedia.com) is a printhead platform: one base with swappable
 * parts for the printer's X carriage, the hotend, part cooling, ABL sensors and extruders. A
 * project holds its releases side by side, one folder each: 7.0 ("HMG7 Release V1.0"), 7.3,
 * 7.4 (cumulative: the newest files of 7.0-7.4) and the Magnet Edition (its base and gantry
 * adapters; the other parts come from 7.0). A configuration picks the release and uses only
 * that folder's files; another release maps the choices by name.
 *
 * The rules come from the PDFs ("Preliminary Gen7 Parts Selection and Assembly Instructions",
 * the Read Me First, Change Log and Printer-Component Support of 7.3 / 7.4): 1 base, 1 gantry
 * adapter (+ its clip or X carriage parts), 1 hotend mount, its skirt, 1-2 part cooling ducts,
 * 1 cable tower; optional an ABL wing and mount, a direct drive extruder mount with risers, a
 * collar spacer, ADXL345, LED and other options. The 56-page selection guide is paid and not in
 * the folder, so the pairs come from the file names: a skirt, a clip or a wing goes with the
 * part whose name it shares (scored, no fixed list), and every automatic choice can be changed.
 *
 * Nearly every part is printed once (the STL files hold one body each; belt clips a pair).
 * Gen6 "dual" ducts are both sides in one print, joined by a brace. Pure functions, no DOM:
 * window.HeroMeKit in the browser, globalThis.HeroMeKit on the server and in the tests.
 */
globalThis.HeroMeKit = (function () {
  // One order in the browser and on the server, whatever their locale (UI.compareNames)
  const compareNames = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' }).compare;
  const GROUPS = ['Base', 'Gantry', 'Hotend', 'Part cooling', 'ABL', 'Extruder', 'Cable management', 'ADXL345', 'Options', 'Extra files'];
  const FANS = ['4010', '4020', '5015', '5020', 'cpap'];
  const FAN_LABELS = { 4010: '4010', 4020: '4020', 5015: '5015', 5020: '5020', cpap: 'CPAP' };
  const HEIGHTS = ['standard', 'long', 'tall', 'cpap'];
  const HEIGHT_LABELS = { standard: 'Standard', long: 'Long', tall: 'Tall', cpap: 'CPAP (beta)' };
  // Known releases, newest first; another folder with Hero Me parts is a release of its name
  const RELEASES = [
    { id: '7.4', test: /gen ?7 release v?4\b/i, label: '7.4', date: 'July 2023' },
    { id: '7.3', test: /gen ?7 release v?3\b/i, label: '7.3', date: 'April 2023' },
    { id: '7.0', test: /(hmg7|gen ?7) release v?1(\.0)?\b/i, label: '7.0', date: 'November 2022' },
    { id: 'me', test: /magnet edition/i, label: 'Magnet Edition', date: 'with the 7.0 parts', partsFrom: '7.0' }
  ];
  // The folder under the release says what its files are
  const CATEGORIES = [
    ['base', /^base$/i], ['gantry', /gantry adapters$/i], ['hotend', /^hotend mounts$/i], ['duct', /^part cooling/i],
    ['abl', /^abl mounts$/i], ['adxl', /^adxl345/i], ['cable', /^cable management$/i], ['extruder', /^extruder/i], ['options', /^options$/i]
  ];
  const ABL_FAMILIES = [
    { id: 'bltouch', label: 'BLTouch', test: /bl-?touch|bl-cr touch/i },
    { id: 'crtouch', label: 'CR Touch', test: /cr-?touch|bl-cr touch/i },
    { id: 'beacon', label: 'Beacon3D', test: /beacon/i },
    { id: 'euclid', label: 'Euclid probe', test: /euclid/i },
    { id: 'ezabl', label: 'EZABL', test: /ezabl/i },
    { id: 'oem', label: 'Creality OEM', test: /\boem\b/i },
    { id: 'pinda', label: 'PINDA', test: /pinda/i },
    { id: 'hallon', label: 'HallON', test: /hallon/i },
    { id: 'pl08n', label: 'PL-08N / Omron', test: /pl-08n|omron/i },
    { id: 'ta', label: 'TA sensor', test: /\bta\b/i },
    { id: 'touchmi', label: 'Touch-Mi', test: /touch-?mi/i },
    { id: 'eryone', label: 'Eryone ER-20', test: /eryone|er-20/i }
  ];
  // Words that name what a gantry part is, not which printer it is for
  const ROLE_WORDS = new Set(['gantry', 'adapter', 'clip', 'clips', 'x', 'carriage', 'belt', 'lock', 'bracket', 'back', 'backplate',
    'plate', 'base', 'front', 'top', 'bottom', 'stand', 'offs', 'spacer', 'brace', 'support', 'internal', 'extruder', 'alt', 'shroud', 'body', 'cap']);
  const STOP_WORDS = new Set(['mount', 'mounts', 'for', 'with', 'the', 'and', 'of', 'mm', 'stl']);
  // Ducts: the long ones are for these printers' X carriages, the tall ones for long hotends
  const LONG_DUCTS = /vyper|kobra|neptune 3|msdd|micro swiss dd/i;
  const TALL_DUCTS = /volcano|rapido.?(plus|uhf)/i;
  const PREFIX = /^HMG[67](?:\.\d+)?(?:[\s-]+ME)?[\s-]+/i;

  // "HMG7.4 Standard Single 5015 Left Duct V5.stl" -> "Standard Single 5015 Left Duct"
  function clean(name) {
    return String(name || '').split('/').pop()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/_/g, ' ')
      .replace(PREFIX, '')
      .replace(/[\s-]+v\d+(?:\.\d+)?$/i, '')
      .replace(/\s+/g, ' ').trim();
  }
  // A row of the parts list: the file name without the release prefix (the version stays)
  const rowLabel = (f) => String(f.original_name || '').split('/').pop().replace(/\.stl$/i, '').replace(PREFIX, '').trim();
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  function tokens(text) {
    return String(text || '').toLowerCase()
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .split(/[^a-z0-9]+/).filter(t => t && !STOP_WORDS.has(t));
  }
  // A word that tells parts apart (not a number or a single letter)
  const significant = (t) => t.length > 1 && !/^\d+$/.test(t);
  const printerTokens = (text) => [...new Set(tokens(text).filter(t => !ROLE_WORDS.has(t)))];
  function sideOf(text) {
    const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    if (t.includes(' left ')) return 'left';
    if (t.includes(' right ')) return 'right';
    return null;
  }
  const flipSide = (id) => String(id).replace(/(^|-)(left|right)(?=-|$)/, (m, a, s) => `${a}${s === 'left' ? 'right' : 'left'}`);
  // A Box X carriage (linear rails): front, bottom, top and back parts
  const isBox = (n) => /box (linear rail )?x carriage/i.test(n);
  const overlap = (a, b) => { const set = new Set(b); return [...new Set(a)].filter(t => set.has(t)).length; };

  // Options of a slot, one per name. Parts split in two or three (Mount A / B, Part 1 / 2) are
  // one option when merge is set; files whose names only differ by a version stay apart.
  function makeOptions(entries, merge = false) {
    const groups = new Map();
    for (const e of entries) {
      const base = merge ? e.name.replace(/\s+part\s+[1-3a-c](?=\s|$)/i, '').replace(/(\bmount)\s+[a-c]$/i, '$1') : e.name;
      const key = slug(base);
      const g = groups.get(key) || { key, label: base.replace(/\s{2,}/g, ' '), split: base !== e.name, entries: [] };
      if (base === e.name) g.split = false;
      g.entries.push(e);
      groups.set(key, g);
    }
    const out = [];
    for (const g of groups.values()) {
      const one = (id, label, list) => out.push({ id, label, files: list.map(e => e.file), entries: list, folder: list[0].folder, side: list[0].side });
      if (g.entries.length === 1 || g.split) one(g.key, g.label, g.entries);
      else g.entries.forEach(e => one(slug(rowLabel(e.file)), rowLabel(e.file), [e]));
    }
    return out.sort((a, b) => compareNames(a.label, b.label));
  }

  function releaseOf(folder) {
    const known = RELEASES.find(r => r.test.test(folder));
    if (known) return { id: known.id, label: known.label, date: known.date, partsFrom: known.partsFrom || null };
    return { id: folder || 'files', label: folder || 'Files', date: '', partsFrom: null };
  }

  function categoryOf(top) {
    const hit = CATEGORIES.find(([, re]) => re.test(top || ''));
    return hit ? hit[0] : null;
  }

  // ── The catalogue: every release with its slots ──
  function buildCatalog(files) {
    const byFolder = new Map();
    for (const f of files || []) {
      if (!f || f.deleted_at) continue;
      const path = String(f.original_name || '');
      const parts = path.split('/');
      // A project may also be one release on its own (Base/, Gantry Adapters/... at its root)
      const folder = parts.length > 1 && !categoryOf(parts[0]) ? parts[0] : '';
      const rel = folder ? parts.slice(1) : parts;
      if (!byFolder.has(folder)) byFolder.set(folder, { folder, entries: [], docs: [] });
      const r = byFolder.get(folder);
      if (!/\.stl$/i.test(path)) { r.docs.push({ file: f, rel: rel.join('/'), dir: rel.slice(0, -1).join('/') }); continue; }
      const cat = rel.length > 1 ? categoryOf(rel[0]) : null;
      const sub = rel.slice(cat ? 1 : 0, -1);
      const name = clean(path);
      r.entries.push({ file: f, rel: rel.join('/'), cat: cat || 'options', top: cat ? rel[0] : '', sub, folder: rel.slice(0, -1).join('/'), name, side: sideOf(name) });
    }
    const releases = [];
    for (const r of byFolder.values()) {
      if (!r.entries.length) continue;
      const info = releaseOf(r.folder);
      if (releases.some(x => x.id === info.id)) info.id = r.folder;
      releases.push({ ...info, folder: r.folder, files: r.entries.map(e => e.file), docs: r.docs, slots: buildSlots(r.entries) });
    }
    const rank = (r) => { const i = RELEASES.findIndex(k => k.id === r.id); return i < 0 ? RELEASES.length : i; };
    releases.sort((a, b) => rank(a) - rank(b) || compareNames(a.label, b.label));
    const byId = {};
    releases.forEach(r => { byId[r.id] = r; });
    // The Magnet Edition has its base and gantry adapters; the other slots are its parent's
    for (const r of releases) {
      const from = r.partsFrom && byId[r.partsFrom];
      if (!from) continue;
      for (const [key, value] of Object.entries(from.slots)) {
        const own = r.slots[key];
        const empty = Array.isArray(own) ? !own.length : !own || !Object.keys(own).length;
        if (empty) r.slots[key] = value;
      }
      r.parentDocs = from.docs;
    }
    // The names of every option, for the notes when another release has no such part
    const labels = {};
    for (const r of releases) {
      for (const value of Object.values(r.slots)) {
        const list = Array.isArray(value) ? value : Object.values(value).flat();
        for (const o of list) if (o && o.id && o.label && !labels[o.id]) labels[o.id] = o.label;
      }
    }
    return { releases, byId, labels, docs: releases.length ? releases[0].docs.map(d => d.file) : [] };
  }

  function buildSlots(entries) {
    const by = (cat) => entries.filter(e => e.cat === cat);
    const s = {};
    s.bases = makeOptions(by('base').filter(e => !/skirt/i.test(e.name)));

    // Gantry: the adapters (and X carriages, Box X carriage fronts, stock shrouds) are the
    // choice; the other files of their folder go with them (clips, back plates, belt parts)
    const allGantry = by('gantry');
    const isStandoff = (e) => /standoff/i.test(e.sub.join('/'));
    s.standoffs = makeOptions(allGantry.filter(isStandoff));
    const gantry = allGantry.filter(e => !isStandoff(e));
    const adapters = gantry.filter(e => /gantry adapter/i.test(e.name));
    const isMain = (e) => {
      const n = e.name;
      if (/gantry adapter/i.test(n)) return true;
      if (isBox(n)) return /front$/i.test(n);
      if (/shroud/i.test(n)) return /body|shorty/i.test(n);
      if (!/x carriage/i.test(n) || /belt|spacer|brace|end ?stop|\b(top|bottom|back)$/i.test(n)) return false;
      // An X carriage that goes with an adapter of its folder is a part of that adapter
      const t = printerTokens(n);
      return !adapters.some(a => a.folder === e.folder && printerTokens(a.name).every(x => t.includes(x)));
    };
    const mains = gantry.filter(isMain);
    const mainFolders = new Set(mains.map(e => e.folder));
    const owner = (folder) => {
      let f = folder;
      for (;;) {
        if (mainFolders.has(f)) return f;
        if (!f.includes('/')) return mainFolders.has('') ? '' : null;
        f = f.slice(0, f.lastIndexOf('/'));
      }
    };
    s.mains = makeOptions(mains).map(o => ({ ...o, group: gantryGroup(o.entries[0]) }));
    s.gantryExtras = {};
    for (const folder of mainFolders) {
      s.gantryExtras[folder] = makeOptions(gantry.filter(e => !isMain(e) && owner(e.folder) === folder));
    }

    // Hotend: mounts, skirts (the Universal Skirt of 7.4 is in Base), caps and collar spacers
    const hot = by('hotend');
    const isCap = (n) => /\bcap\b|base cover/i.test(n) || (!/mount/i.test(n) && /colett?e|p4m10|pc4/i.test(n));
    s.skirts = makeOptions([...hot.filter(e => /skirt/i.test(e.name)), ...by('base').filter(e => /skirt/i.test(e.name))]);
    s.spacers = makeOptions(hot.filter(e => /spacer/i.test(e.name) && !/skirt/i.test(e.name)));
    s.caps = makeOptions(hot.filter(e => !/skirt|spacer/i.test(e.name) && isCap(e.name)));
    s.hotends = makeOptions(hot.filter(e => !/skirt|spacer/i.test(e.name) && !isCap(e.name)), true);

    // Part cooling: height (the folder), fan size, design; left / right files are one design
    s.ducts = [];
    s.ductSpacers = [];
    s.heightHints = {};
    const designs = new Map();
    for (const e of by('duct')) {
      const top = e.sub[0] || '';
      const height = /cpap/i.test(top) ? 'cpap' : /tall/i.test(top) ? 'tall' : /long/i.test(top) ? 'long' : 'standard';
      const hint = /\s-\s(.+)$/.exec(top);
      if (hint && !s.heightHints[height]) s.heightHints[height] = hint[1];
      const fm = /(\d{4}) fans/i.exec(e.sub.join('/')) || /(4010|4020|5015|5020)/.exec(e.name);
      const fan = height === 'cpap' ? 'cpap' : fm ? fm[1] : null;
      if (!fan) continue;
      if (/fan mount spacer/i.test(e.name)) { s.ductSpacers.push({ height, fan, option: makeOptions([e])[0] }); continue; }
      const gen6 = /^HMG6/i.test(String(e.file.original_name).split('/').pop());
      let text = e.name.replace(/-/g, gen6 ? ' ' : '-')
        .replace(/(^|[^a-z])(left|right)(?=[^a-z]|$)/ig, '$1')
        .replace(/\b(standard|long|tall)\b/ig, '')
        .replace(/(4010|4020|5015|5020)([lw])?\b/ig, (m, f, v) => (v ? `${v.toUpperCase()} ` : ''))
        .replace(/\bducts?\b|\bfans?\b/ig, '')
        .replace(/[\s-]{2,}/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '');
      if (!text) text = height === 'cpap' ? 'CPAP' : 'Duct';
      text = text.charAt(0).toUpperCase() + text.slice(1);
      const label = `${gen6 ? 'Gen6' : 'Gen7'} ${text}`;
      const id = `${height}:${fan}:${slug(label)}`;
      const d = designs.get(id) || { id, label, height, fan, gen6, sides: {}, files: [], folder: e.folder };
      if (e.side) d.sides[e.side] = e.file; else d.files.push(e.file);
      designs.set(id, d);
    }
    for (const d of designs.values()) {
      d.kind = Object.keys(d.sides).length ? 'side' : d.gen6 && /\bdual\b/i.test(d.label) ? 'dual' : 'single';
      s.ducts.push(d);
    }
    s.ducts.sort((a, b) => HEIGHTS.indexOf(a.height) - HEIGHTS.indexOf(b.height) || compareNames(a.label, b.label));

    // ABL: wings / brackets on the base, the sensor's mount, spacers
    const abl = by('abl');
    const withAbl = (o) => {
      const families = ABL_FAMILIES.filter(f => f.test.test(o.label)).map(f => f.id);
      return { ...o, families, side: o.side || (/left side/i.test(o.folder) ? 'left' : null) };
    };
    s.ablWings = makeOptions(abl.filter(e => /wing|bracket/i.test(e.name)), true).map(withAbl);
    s.ablExtras = makeOptions(abl.filter(e => /spacer/i.test(e.name) && !/wing|bracket/i.test(e.name))).map(withAbl);
    s.ablMounts = makeOptions(abl.filter(e => !/wing|bracket|spacer/i.test(e.name)), true).map(withAbl);
    s.ablFamilies = ABL_FAMILIES.filter(f => s.ablMounts.some(o => o.families.includes(f.id))).map(f => ({ id: f.id, label: f.label }));

    // ADXL345 mounts (7.0 has them in Options), cable towers, extruder mounts and risers
    const isAdxl = (e) => /adxl/i.test(e.name);
    s.adxls = makeOptions([...by('adxl'), ...by('options').filter(isAdxl)]);
    s.cables = makeOptions(by('cable'));
    const ext = by('extruder');
    s.risers = makeOptions(ext.filter(e => /riser/i.test(e.name)));
    s.extruders = makeOptions(ext.filter(e => !/riser/i.test(e.name)), true).map(o => ({ ...o, group: o.entries[0].sub[0] || 'Other extruders' }));

    // Options: the rest, by their folder (or what they are, where the folder is flat)
    const optionGroup = (e) => {
      if (e.sub[0]) return e.sub[0];
      if (/fan guard/i.test(e.name)) return 'Fan Guards';
      if (/\bled\b|neo ?pixel/i.test(e.name)) return 'LED Mounts';
      if (/endoscope|cable clip/i.test(e.name)) return 'Endoscope Mounts';
      if (/pen plotter/i.test(e.name)) return 'Pen Mounts';
      return 'Other options';
    };
    s.options = makeOptions(by('options').filter(e => !isAdxl(e))).map(o => ({ ...o, group: optionGroup(o.entries[0]) }));
    return s;
  }

  // The heading of a gantry adapter in the list: its folder ("Creality", "Linear Rails ›
  // Ender 5 Style..."); 7.0 keeps its Gen6 and Gen7 folders apart
  function gantryGroup(e) {
    const gen = /^(gen\d) /i.exec(e.top || '');
    const path = e.sub.join(' › ') || 'Other printers';
    return gen ? `${gen[1].replace(/^g/, 'G')} · ${path}` : path;
  }

  // The option whose name is nearest to an id of another release (or a changed name): the
  // words that tell parts apart, not "screw" or "gantry adapter" that many names share
  // 7.0's "OEM-MK8-MS" mount and skirt are the Creality OEM ones of 7.3 / 7.4
  const GENERIC_WORDS = new Set(['screw', 'collar', 'gantry', 'adapter', 'skirt']);
  const RENAMED = [[/\boem mk8 ms\b/g, 'creality oem cr10s ender3 5']];
  function closest(list, id) {
    const words = (text) => {
      const plain = RENAMED.reduce((t, [re, to]) => t.replace(re, to), String(text).toLowerCase().replace(/[-:]/g, ' '));
      return new Set(tokens(plain).filter(t => significant(t) && !GENERIC_WORDS.has(t)));
    };
    const want = words(id);
    let best = null;
    let bestScore = 0;
    for (const o of list) {
      const have = words(o.id);
      const common = [...have].filter(t => want.has(t)).length;
      if (!common) continue;
      const score = common / (want.size + have.size - common);
      if (score > bestScore) { best = o; bestScore = score; }
    }
    return best;
  }

  // The skirt whose name fits the hotend's best: the words they share, most of all at the
  // start ("Phaetus X Voron Dragon" before "Phaetus Dragon ST-HF-UHF"), less the skirt's own
  // words; numbers only tell close ones apart. null when no word is shared.
  // The PC4-M10 coupling and "2-Screw" say how the hotend is held, not which one it is; the
  // Spider "CR 300" is the 350 °C one, the High Temp the 500 °C one (Printer-Component Support)
  const HOTEND_ALIASES = [[/\bp(?:c)?4[\s-]*m10\b/ig, ' '], [/\b\d-screw\b/ig, ' '], [/\bcr 300\b/ig, '350'], [/\bhigh temp\b/ig, 'high temp 500']];
  function bestSkirt(skirts, hotend) {
    if (!hotend) return null;
    const name = HOTEND_ALIASES.reduce((t, [re, to]) => t.replace(re, to), hotend.label);
    const want = tokens(name).filter(t => t !== 'screw');
    const wantSig = want.filter(significant);
    let best = null;
    let bestScore = 0;
    for (const o of skirts) {
      const have = tokens(o.label).filter(t => t !== 'skirt');
      const haveSig = have.filter(significant);
      const strong = overlap(wantSig, haveSig);
      // "Collar" alone says how it is held, not which hotend it is
      if (!overlap(wantSig.filter(t => t !== 'collar'), haveSig)) continue;
      let prefix = 0;
      while (prefix < wantSig.length && wantSig[prefix] === haveSig[prefix]) prefix++;
      const score = strong + 2 * prefix - 0.1 * haveSig.filter(t => !wantSig.includes(t)).length + 0.2 * overlap(want, have);
      if (score > bestScore) { best = o; bestScore = score; }
    }
    return best;
  }

  // The files that go with a gantry adapter. An extra file belongs to the adapters whose
  // printer words it contains (the most specific ones), else to those sharing most words (at
  // least two); a Box X carriage takes its bottom, an MGN12-H top, a plain back and the first
  // belt clips. Of two alternatives (same kind of part) the simpler or "standard" one stays.
  function autoGantryExtras(main, extras, mains) {
    const words = (o) => printerTokens(o.label);
    const picks = [];
    if (isBox(main.label)) {
      const role = (re, prefer) => {
        const list = extras.filter(x => re.test(x.label) && !/endstop/i.test(x.label));
        const hit = prefer.map(p => list.find(x => p.test(x.label))).find(Boolean) || list[0];
        if (hit) picks.push(hit);
      };
      role(/\bbottom$/i, []);
      role(/\btop$/i, [/mgn12-h/i]);
      role(/\bback$/i, [/plain/i, /short/i]);
      role(/clips$/i, []);
      return picks;
    }
    for (const x of extras) {
      if (/internal.?support/i.test(x.label)) { picks.push(x); continue; }
      // Ducts and ADXL345 adapters are choices of their own
      if (/duct|adxl345 .*mount|kusba/i.test(x.label)) continue;
      const xt = words(x);
      const contained = mains.filter(m => { const t = words(m); return t.length && t.every(w => xt.includes(w)); });
      let owners;
      if (contained.length) {
        const most = Math.max(...contained.map(m => words(m).length));
        owners = contained.filter(m => words(m).length === most);
      } else {
        // Words first, numbers only between equals ("Ender 3 V Wheel" goes with the Ender 3)
        const strong = (m) => overlap(words(m).filter(significant), xt.filter(significant));
        const score = (m) => (strong(m) >= 2 ? strong(m) * 10 + overlap(words(m), xt) : 0);
        const best = Math.max(0, ...mains.map(score));
        owners = best ? mains.filter(m => score(m) === best) : [];
      }
      if (owners.some(m => m.id === main.id)) picks.push(x);
    }
    const mt = words(main);
    const extra = (o) => words(o).filter(t => !mt.includes(t)).length;
    const shared = (o) => overlap(words(o), mt);
    const better = (x, rival) => extra(x) < extra(rival) || (extra(x) === extra(rival) && (shared(x) > shared(rival)
      || (shared(x) === shared(rival) && /standard/i.test(x.label) && !/standard/i.test(rival.label))));
    const kinds = new Map();
    for (const x of picks) {
      const kind = tokens(x.label).filter(t => ROLE_WORDS.has(t)).sort().join(' ');
      const rival = kinds.get(kind);
      if (!rival || better(x, rival)) kinds.set(kind, x);
    }
    return picks.filter(x => [...kinds.values()].includes(x));
  }

  function defaultConfig() {
    // A stock Ender 3 V2: its adapter, the Creality OEM hotend, Bowden, two 5015 fans
    return {
      release: '', base: 'auto', gantry: 'ender-3-v2-gantry-adapter', gantryWith: null,
      hotend: 'creality-oem-cr10s-ender3-5-2-screw-mount', skirt: 'auto', cap: 'none', spacer: 'auto', standoff: 'none',
      fan: '5015', fans: 2, height: 'auto', duct: 'auto', side: 'left',
      abl: 'none', ablSide: 'left', ablMount: 'auto', ablWing: 'auto', ablWith: null,
      extruder: 'none', risers: [], cable: 'auto', adxl: 'none', options: [],
      qty: {}, extra: {}, docs: false
    };
  }

  const EMPTY = { id: '', label: 'No release', date: '', folder: '', docs: [], files: [], slots: buildSlots([]) };

  // The configuration checked against the catalogue ({ cfg, changes }) and what it resolves
  // to: the release, the chosen option of every slot, and the lists the builder offers.
  function plan(cat, input) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const def = defaultConfig();
    const changes = [];
    const r = cat.byId[src.release] || cat.releases[0] || EMPTY;
    if (src.release && !cat.byId[src.release]) changes.push(`Release ${src.release} is not in the project: ${r.label} instead.`);
    const s = r.slots;
    const cfg = { ...def, release: r.id };
    const words = (id) => (cat.labels && cat.labels[id]) || String(id).replace(/-/g, ' ');
    // One choice of a list: an id, or 'auto' / 'none' where they are allowed. An id the
    // release does not have stays in the configuration (back in its release it is chosen
    // again) and the nearest name stands in for it, with a note when the configuration asked
    const mapped = {};
    const one = (field, list, allow = []) => {
      const asked = src[field] !== undefined;
      const v = asked ? src[field] : def[field];
      if (allow.includes(v)) return v;
      const fallback = allow[0] || (list[0] ? list[0].id : 'none');
      if (typeof v !== 'string' || !v || v.length > 200) return fallback;
      if (list.some(o => o.id === v)) return v;
      const near = closest(list, v);
      if (asked) changes.push(near ? `${r.label}: no “${words(v)}”, “${near.label}” instead.` : `${r.label}: no “${words(v)}”.`);
      if (!near) return fallback;
      mapped[field] = near.id;
      return v;
    };
    const idOf = (field) => mapped[field] || cfg[field];
    // Ticked parts: ids of other releases stay too, only this release's count
    const many = (field) => (Array.isArray(src[field]) ? [...new Set(src[field].filter(id => typeof id === 'string' && id.length <= 200))].slice(0, 200) : []);
    const find = (list, id) => list.find(o => o.id === id) || null;

    cfg.base = one('base', s.bases, ['auto']);
    // The upright base: the face-down one needs a well tuned printer (7.0 instructions)
    const base = cfg.base === 'auto'
      ? s.bases.find(o => /universal/i.test(o.label) && /upright/i.test(o.label)) || s.bases.find(o => /universal/i.test(o.label))
        || s.bases.find(o => /upright/i.test(o.label)) || s.bases[0] || null
      : find(s.bases, idOf('base'));

    cfg.gantry = one('gantry', s.mains, ['none']);
    if (cfg.gantry === 'none' && src.gantry === undefined && s.mains.length) cfg.gantry = s.mains[0].id;
    const main = find(s.mains, idOf('gantry'));
    const extras = main ? s.gantryExtras[main.folder] || [] : [];
    cfg.gantryWith = Array.isArray(src.gantryWith) && src.gantryWithOf === cfg.gantry ? many('gantryWith') : null;
    if (cfg.gantryWith) cfg.gantryWithOf = cfg.gantry;
    const autoExtras = main ? autoGantryExtras(main, extras, s.mains.filter(m => m.folder === main.folder)) : [];
    const gantryWith = cfg.gantryWith ? extras.filter(o => cfg.gantryWith.includes(o.id)) : autoExtras;
    // The stock Neptune 3 shroud replaces the printhead cover: no Hero Me base
    const standalone = Boolean(main && /stock/i.test(main.folder) && /shroud/i.test(main.label));

    cfg.hotend = one('hotend', s.hotends, ['none']);
    if (cfg.hotend === 'none' && src.hotend === undefined && s.hotends.length) cfg.hotend = s.hotends[0].id;
    const hotend = find(s.hotends, idOf('hotend'));
    cfg.skirt = one('skirt', s.skirts, ['auto', 'none']);
    const autoSkirt = bestSkirt(s.skirts.filter(o => !/universal/i.test(o.label)), hotend) || s.skirts.find(o => /universal/i.test(o.label)) || null;
    const skirt = cfg.skirt === 'auto' ? (hotend ? autoSkirt : null) : find(s.skirts, idOf('skirt'));
    cfg.cap = one('cap', s.caps, ['none']);
    const cap = find(s.caps, idOf('cap'));
    cfg.spacer = one('spacer', s.spacers, ['auto', 'none']);
    const collar = Boolean(hotend && /collar/i.test(hotend.label));
    const autoSpacer = collar ? s.spacers.find(o => /(^|\D)1 ?mm/i.test(o.label)) || null : null;
    const spacer = cfg.spacer === 'auto' ? autoSpacer : find(s.spacers, idOf('spacer'));
    cfg.standoff = one('standoff', s.standoffs, ['none']);
    const standoff = find(s.standoffs, idOf('standoff'));

    // Part cooling: the height decides the fan sizes, they decide the designs
    const heights = HEIGHTS.filter(h => s.ducts.some(d => d.height === h));
    cfg.height = heights.includes(src.height) ? src.height : 'auto';
    const autoHeight = main && LONG_DUCTS.test(`${main.label} ${main.folder}`) && heights.includes('long') ? 'long'
      : hotend && TALL_DUCTS.test(hotend.label) && heights.includes('tall') ? 'tall' : heights.includes('standard') ? 'standard' : heights[0] || 'standard';
    const height = cfg.height === 'auto' ? autoHeight : cfg.height;
    const fanSizes = FANS.filter(f => s.ducts.some(d => d.height === height && d.fan === f));
    cfg.fan = fanSizes.includes(String(src.fan)) ? String(src.fan) : fanSizes.includes(def.fan) ? def.fan : fanSizes[0] || def.fan;
    if (src.fan !== undefined && String(src.fan) !== cfg.fan && fanSizes.length) changes.push(`${HEIGHT_LABELS[height]} ducts: no ${FAN_LABELS[src.fan] || src.fan} fans, ${FAN_LABELS[cfg.fan]} instead.`);
    cfg.fans = Number(src.fans) === 1 ? 1 : 2;
    const fits = (d) => d.kind === 'side' || (d.kind === 'dual' ? cfg.fans === 2 : cfg.fans === 1);
    const designs = s.ducts.filter(d => d.height === height && d.fan === cfg.fan && fits(d));
    const wanted = typeof src.duct === 'string' && src.duct !== 'auto' ? src.duct : null;
    const sameDesign = wanted && designs.find(d => d.id === wanted || d.id.split(':')[2] === wanted.split(':')[2]);
    cfg.duct = sameDesign ? sameDesign.id : 'auto';
    const autoDuct = designs.find(d => !d.gen6 && d.kind === 'side' && !/tipped|neptune|cpap|box/i.test(d.label))
      || designs.find(d => d.gen6 && d.kind === (cfg.fans === 2 ? 'dual' : 'single'))
      || designs.find(d => d.kind === 'side') || designs[0] || null;
    const duct = cfg.duct === 'auto' ? autoDuct : find(designs, cfg.duct);
    cfg.side = src.side === 'right' ? 'right' : 'left';

    // ABL: the sensor decides the mounts and wings of its side
    cfg.abl = s.ablFamilies.some(f => f.id === src.abl) ? src.abl : 'none';
    cfg.ablSide = src.ablSide === 'right' ? 'right' : 'left';
    const fam = cfg.abl === 'none' ? null : cfg.abl;
    const onSide = (o) => !o.side || o.side === cfg.ablSide;
    const ablMounts = fam ? s.ablMounts.filter(o => o.families.includes(fam) && onSide(o)) : [];
    const ablWings = fam ? s.ablWings.filter(o => (!o.families.length || o.families.includes(fam)) && onSide(o)) : [];
    const ablExtras = fam ? s.ablExtras.filter(o => !o.families.length || o.families.includes(fam)) : [];
    const sided = (list, v) => (find(list, v) ? v : find(list, flipSide(v)) ? flipSide(v) : null);
    cfg.ablMount = typeof src.ablMount === 'string' && src.ablMount !== 'auto' ? sided(ablMounts, src.ablMount) || 'auto' : 'auto';
    const autoMount = ablMounts.find(o => /standard/i.test(o.label)) || ablMounts.find(o => /medium/i.test(o.label)) || ablMounts[0] || null;
    const ablMount = fam ? (cfg.ablMount === 'auto' ? autoMount : find(ablMounts, cfg.ablMount)) : null;
    cfg.ablWing = src.ablWing === 'none' ? 'none' : typeof src.ablWing === 'string' && src.ablWing !== 'auto' ? sided(ablWings, src.ablWing) || 'auto' : 'auto';
    let autoWing = null;
    if (ablMount && !(fam === 'beacon' && !ablMount.side)) {
      const folderOf = (o) => o.folder;
      const up = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
      autoWing = ablWings.find(o => o.folder === folderOf(ablMount) && o.families.length === 0 && /gen6/i.test(o.folder))
        || ablWings.find(o => /gen6/i.test(ablMount.folder) && o.folder === up(ablMount.folder))
        || (/gen6/i.test(ablMount.folder) ? null : ablWings.filter(o => o.families.includes(fam)).sort((a, b) => Number(/medium(?!-)/i.test(b.label)) - Number(/medium(?!-)/i.test(a.label)))[0])
        || null;
    }
    const ablWing = fam ? (cfg.ablWing === 'auto' ? autoWing : cfg.ablWing === 'none' ? null : find(ablWings, cfg.ablWing)) : null;
    cfg.ablWith = Array.isArray(src.ablWith) && src.ablWithOf === cfg.abl ? many('ablWith') : null;
    if (cfg.ablWith) cfg.ablWithOf = cfg.abl;
    const ablWith = cfg.ablWith ? ablExtras.filter(o => cfg.ablWith.includes(o.id)) : [];

    cfg.extruder = one('extruder', s.extruders, ['none']);
    const extruder = find(s.extruders, idOf('extruder'));
    cfg.risers = many('risers');
    const risers = s.risers.filter(o => cfg.risers.includes(o.id));
    cfg.cable = one('cable', s.cables, ['auto', 'none']);
    // The tower goes on the side the ABL sensor leaves free
    const towerSide = fam ? (cfg.ablSide === 'left' ? 'right' : 'left') : 'left';
    const autoCable = s.cables.find(o => new RegExp(`standard ${towerSide}$`, 'i').test(o.label)) || s.cables.find(o => o.side === towerSide) || s.cables[0] || null;
    const cable = cfg.cable === 'auto' ? autoCable : find(s.cables, idOf('cable'));
    cfg.adxl = one('adxl', s.adxls, ['none']);
    const adxl = find(s.adxls, idOf('adxl'));
    cfg.options = many('options');
    const options = s.options.filter(o => cfg.options.includes(o.id));

    const qty = src.qty && typeof src.qty === 'object' && !Array.isArray(src.qty) ? src.qty : {};
    cfg.qty = {};
    for (const [k, v] of Object.entries(qty)) { const n = Math.floor(Number(v)); if (Number.isFinite(n) && n >= 0) cfg.qty[k] = Math.min(n, 999); }
    const extra = src.extra && typeof src.extra === 'object' && !Array.isArray(src.extra) ? src.extra : {};
    cfg.extra = {};
    for (const [k, v] of Object.entries(extra)) { const n = Math.floor(Number(v)); if (k.startsWith('path:') && Number.isFinite(n) && n > 0) cfg.extra[k] = Math.min(n, 999); }
    cfg.docs = Boolean(src.docs);

    const sel = { base, main, gantryWith, autoExtras, standalone, hotend, skirt, autoSkirt, cap, spacer, autoSpacer, collar, standoff, height, autoHeight, duct, autoDuct,
      fam, ablMount, autoMount, ablWing, autoWing, ablWith, extruder, risers, cable, autoCable, adxl, options };
    // What each list shows as chosen (a part of another release shows its stand-in)
    const shown = (field, option) => (['auto', 'none'].includes(cfg[field]) ? cfg[field] : option ? option.id : 'none');
    const ch = {
      ids: { base: shown('base', base), gantry: shown('gantry', main), hotend: shown('hotend', hotend), skirt: shown('skirt', skirt), cap: shown('cap', cap),
        spacer: shown('spacer', spacer), standoff: shown('standoff', standoff), extruder: shown('extruder', extruder), cable: shown('cable', cable), adxl: shown('adxl', adxl) },
      releases: cat.releases.map(x => ({ id: x.id, label: x.label, date: x.date, count: x.files.length })),
      release: { id: r.id, label: r.label, date: r.date },
      standalone,
      bases: s.bases, mains: s.mains, extras, hotends: s.hotends, skirts: s.skirts, caps: s.caps, spacers: s.spacers, standoffs: s.standoffs,
      heights: heights.map(h => ({ id: h, label: HEIGHT_LABELS[h], hint: s.heightHints[h] || '' })),
      fanSizes: fanSizes.map(f => ({ id: f, label: FAN_LABELS[f] })),
      ducts: designs,
      fanCounts: [1, 2].filter(n => s.ducts.some(d => d.height === height && d.fan === cfg.fan && (d.kind === 'side' || (d.kind === 'dual' ? n === 2 : n === 1)))),
      ablFamilies: s.ablFamilies, ablMounts, ablWings, ablExtras,
      extruders: s.extruders, risers: s.risers, cables: s.cables, adxls: s.adxls, options: s.options
    };
    return { cfg, changes, r, sel, ch };
  }

  function normalize(cat, input) {
    const { cfg, changes } = plan(cat, input);
    return { cfg, changes };
  }

  function choices(cat, input) {
    const { sel, ch } = plan(cat, input);
    return { ...ch, sel };
  }

  // ── Parts list ──
  function computeBom(cat, input) {
    const { cfg, changes, r, sel } = plan(cat, input);
    const parts = new Map();
    const hardware = new Map();
    const warnings = changes.slice();
    const notes = [];
    const relOf = (f) => String(f.original_name || '').split('/').slice(r.folder && String(f.original_name).startsWith(`${r.folder}/`) ? 1 : 0).join('/');
    const addFile = (group, f, qty, estimate, optional) => {
      const key = `p:${relOf(f)}`;
      const row = parts.get(key) || { key, file: f, qty: 0, group, label: rowLabel(f), estimate: false };
      row.qty += qty;
      if (estimate) row.estimate = true;
      if (optional && !row.qty) row.optional = true;
      parts.set(key, row);
    };
    const add = (group, option, qty = 1, estimate = false) => { if (option) option.files.forEach(f => addFile(group, f, qty, estimate)); };
    const hw = (name, qty, note, estimate) => {
      if (!qty) return;
      const row = hardware.get(name) || { name, qty: 0, notes: new Set(), estimate: false };
      row.qty += qty;
      if (note) row.notes.add(note);
      if (estimate) row.estimate = true;
      hardware.set(name, row);
    };

    if (sel.main) {
      add('Gantry', sel.main);
      sel.gantryWith.forEach(o => add('Gantry', o));
      if (/^gen6/i.test(sel.main.group)) notes.push('A Gen6 gantry adapter: trim the small fence around the ABL mount on the left (or block it in the slicer), the Gen7 base needs a flat front.');
    }
    if (sel.standalone) {
      notes.push('The stock Neptune 3 Pro / Plus / Max shroud replaces the printhead cover: no Hero Me base, hotend mount, ducts or cable tower. Only its ADXL345 adapters go with it.');
      hw('5015 radial blower fan', 2, 'sealed dual ball bearing, not hydraulic');
      hw('M3 threaded insert (4.6 mm OD, 3-4 mm long)', 10, '6 in the shroud, 2 per fan');
      hw('M3 screw, 6 or 8 mm', 14, 'reuse the stock ones that fit');
    } else {
      if (sel.base) add('Base', sel.base);
      if (sel.base && /seckit/i.test(sel.base.label)) notes.push('The Seckit SK-GO custom base is only for the stock hotend and extruder mounted in the X carriage.');
      if (sel.hotend) {
        add('Hotend', sel.hotend);
        hw(`Hotend for the ${sel.hotend.label}`, 1);
        hw('40 mm axial fan (4010 or 4020)', 1, 'heat sink, on the front of the base');
      }
      if (sel.skirt) add('Hotend', sel.skirt);
      else if (sel.hotend && cfg.skirt === 'auto') warnings.push(`No skirt of ${r.label} matches the ${sel.hotend.label}: pick one.`);
      if (sel.cap) add('Hotend', sel.cap);
      if (sel.spacer) add('Hotend', sel.spacer);
      if (sel.collar && cfg.spacer === 'auto' && sel.spacer) notes.push('Collar mount: an E3D V6 and true clones take one 1 mm spacer in the collar; test-fit with the screws to find yours (1-2.5 mm).');
      if (sel.standoff) add('Gantry', sel.standoff);
      if (sel.hotend && !sel.cap) {
        const caps = (r.slots.caps || []).filter(o => overlap(printerTokens(o.label).filter(significant), printerTokens(sel.hotend.label).filter(significant)) >= 2);
        if (caps.length) notes.push(`Caps for this hotend (Bowden coupling): ${caps.map(o => o.label).join(', ')}.`);
      }
      if (sel.hotend && !sel.extruder && !sel.standoff) {
        const standoffs = (r.slots.standoffs || []).filter(o => overlap(printerTokens(o.label).filter(significant), printerTokens(sel.hotend.label).filter(significant)) >= 1);
        if (standoffs.length) notes.push(`Some Bowden setups need a hotend-gantry standoff: ${standoffs.map(o => o.label).join(', ')}.`);
      }

      const d = sel.duct;
      if (d) {
        if (d.kind === 'side') {
          const sides = cfg.fans === 2 ? ['left', 'right'] : [cfg.side];
          for (const side of sides) {
            const f = d.sides[side] || d.sides[side === 'left' ? 'right' : 'left'];
            if (f) addFile('Part cooling', f, 1, false);
          }
        } else {
          d.files.forEach(f => addFile('Part cooling', f, 1, false));
          if (d.kind === 'dual') notes.push('Gen6 dual ducts: both sides in one print, joined by a brace under the base.');
        }
        if (cfg.fan === 'cpap') hw('CPAP blower with its hose', 1, 'part cooling', true);
        else hw(`${cfg.fan} radial blower fan`, cfg.fans, 'part cooling');
        const spacer = (r.slots.ductSpacers || []).find(x => x.fan === cfg.fan && x.height === sel.height);
        if (spacer) spacer.option.files.forEach(f => addFile('Part cooling', f, 0, false, true));
      } else {
        warnings.push(`${r.label} has no ${HEIGHT_LABELS[sel.height] || sel.height} duct for ${cfg.fans} × ${FAN_LABELS[cfg.fan] || cfg.fan} fans.`);
      }

      if (sel.fam) {
        if (sel.ablWing) add('ABL', sel.ablWing);
        if (sel.ablMount) add('ABL', sel.ablMount);
        else warnings.push(`${r.label} has no ${ABL_FAMILIES.find(f => f.id === sel.fam).label} mount for the ${cfg.ablSide} side.`);
        sel.ablWith.forEach(o => add('ABL', o));
        hw(`${ABL_FAMILIES.find(f => f.id === sel.fam).label} sensor`, 1);
        if (sel.ablMount && /gen6/i.test(sel.ablMount.folder)) notes.push('Gen6 ABL mounts attach to the Gen7 base with the Gen6 ABL bracket.');
      }
      if (sel.extruder) {
        add('Extruder', sel.extruder);
        hw(`Extruder for the ${sel.extruder.label}`, 1);
        hw('PTFE tube', 1, 'from the heat sink through the mounts into the extruder, cut to length');
        if (/rear/i.test(sel.extruder.label) && !sel.risers.length) notes.push('Rear extruder: if the stepper hits the X carriage, add risers (4, 6, 10 mm) between the hotend mount and the extruder mount, or take the front mount.');
      }
      sel.risers.forEach(o => add('Extruder', o));
      if (sel.cable) add('Cable management', sel.cable);
      // The joints the instructions name; every other round hole takes an insert as well
      const fans = d && cfg.fan !== 'cpap' ? cfg.fans : 0;
      const inserts = 2 + (sel.collar ? 2 : 0) + 2 * fans;
      const screws = 2 + (sel.skirt ? 2 : 0) + (sel.collar ? 2 : 0) + 2 * fans;
      hw('M3 threaded insert (4.6 mm OD, 3-4 mm long)', inserts, 'one in every round hole except the filament path', true);
      hw('M3 screw', screws, sel.extruder ? 'two long ones through the extruder mount, risers and hotend mount' : 'hotend mount, skirt, fans', true);
    }
    // The stock Neptune shroud takes its own ADXL345 adapters (they go with the shroud)
    if (sel.adxl && !sel.standalone) { add('ADXL345', sel.adxl); hw('ADXL345 board', 1); }
    sel.options.forEach(o => add('Options', o));

    // Files of the project added by hand
    const all = new Map();
    for (const x of cat.releases) for (const f of x.files) all.set(f.original_name, f);
    for (const x of cat.releases) for (const doc of x.docs) all.set(doc.file.original_name, doc.file);
    for (const [key, q] of Object.entries(cfg.extra)) {
      const f = all.get(key.slice(5));
      if (!f) continue;
      const row = parts.get(key) || { key, file: f, qty: 0, group: 'Extra files', label: rowLabel(f), estimate: false };
      row.qty += q;
      parts.set(key, row);
    }
    // Quantities changed by hand
    for (const [key, q] of Object.entries(cfg.qty)) {
      const row = parts.get(key);
      if (row && q !== row.qty) { row.auto = row.qty; row.qty = q; }
    }
    if ([...parts.values()].some(p => p.estimate) || [...hardware.values()].some(h => h.estimate)) {
      notes.push('Quantities marked as estimates are not stated in the instructions: check them before printing.');
    }

    const list = [...parts.values()].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || compareNames(a.label, b.label));
    // The instructions: the release's PDFs and the documents next to the chosen parts
    const chosen = list.filter(p => p.qty > 0 && p.group !== 'Extra files');
    const dirs = new Set(chosen.map(p => p.key.slice(2).split('/').slice(0, -1).join('/')));
    const manuals = [];
    for (const doc of [...r.docs, ...(r.parentDocs || [])]) {
      const top = !doc.dir;
      const near = dirs.has(doc.dir) && (doc.dir.includes('/') || chosen.some(p => overlap(printerTokens(clean(doc.rel)).filter(significant), printerTokens(p.label).filter(significant)) >= 2));
      if ((top || near) && !manuals.includes(doc.file)) manuals.push(doc.file);
    }
    // The release's own PDFs first
    manuals.sort((a, b) => Number(a.original_name.split('/').length > (r.folder ? 2 : 1)) - Number(b.original_name.split('/').length > (r.folder ? 2 : 1)));
    const docs = cfg.docs ? manuals.slice() : [];
    const printed = list.filter(p => p.qty > 0);
    const size = (f) => Number(f.file_size) || 0;
    return {
      cfg,
      parts: list,
      hardware: [...hardware.values()].map(h => ({ name: h.name, qty: h.qty, note: [...h.notes].join(', '), estimate: h.estimate })),
      warnings,
      notes: [...new Set(notes)],
      docs,
      manuals,
      resolved: {
        gantryWith: sel.gantryWith.map(o => o.id), gantryWithOf: cfg.gantry,
        ablWith: sel.ablWith.map(o => o.id), ablWithOf: cfg.abl
      },
      head: headOf(cfg, sel),
      totals: {
        files: printed.length,
        prints: printed.reduce((n, p) => n + p.qty, 0),
        bytes: printed.reduce((n, p) => n + size(p.file), 0) + docs.reduce((n, f) => n + size(f), 0)
      }
    };
  }

  // What the 3D printhead (HeroMe3D) draws: each part with its label and file ids (hover and
  // click find the part in the list) and what the names say about it: which side, how far out,
  // front or rear stepper, how tall a riser or a tower is.
  function headOf(cfg, sel) {
    const ids = (option) => (option ? option.files.map(f => f.id) : []);
    const part = (option, extra) => (option ? { label: option.label, files: ids(option), ...extra } : null);
    const mm = (label, fallback) => { const m = /(\d+(?:\.\d+)?) ?mm/i.exec(label || ''); return m ? Number(m[1]) : fallback; };
    const head = {
      standalone: sel.standalone,
      gantry: sel.main ? {
        label: sel.main.label, files: [...ids(sel.main), ...sel.gantryWith.flatMap(ids)],
        kind: sel.standalone ? 'shroud' : /mgn|linear rail|box (linear rail )?x carriage|hevort|hypercube|voron|mercury/i.test(`${sel.main.label} ${sel.main.group}`) ? 'rail' : 'wheels'
      } : null
    };
    if (sel.standalone) return withSources(head, sel);
    head.base = part(sel.base, { magnet: /magnet edition|(^|\/)HMG7 ME /i.test(sel.base ? sel.base.files[0].original_name : '') });
    head.hotend = part(sel.hotend, { collar: sel.collar, height: sel.height === 'cpap' ? 'standard' : sel.height });
    head.skirt = part(sel.skirt);
    head.standoff = part(sel.standoff);
    const d = sel.duct;
    if (d) {
      const files = { left: [], right: [], front: [] };
      let layout;
      if (d.kind === 'side') {
        layout = cfg.fans === 2 ? 'sides' : 'side';
        for (const side of cfg.fans === 2 ? ['left', 'right'] : [cfg.side]) {
          const f = d.sides[side] || d.sides[side === 'left' ? 'right' : 'left'];
          if (f) files[side].push(f.id);
        }
      } else if (d.kind === 'dual') {
        layout = 'sides';
        files.left = d.files.map(f => f.id);
        files.right = d.files.map(f => f.id);
      } else {
        layout = /centered/i.test(d.label) ? 'front' : 'wrap';
        (layout === 'front' ? files.front : files[cfg.side]).push(...d.files.map(f => f.id));
      }
      head.cooling = { label: d.label, fan: cfg.fan, fans: cfg.fans, side: cfg.side, layout, height: sel.height, files, tipped: /tipped/i.test(d.label) };
    }
    if (sel.fam) {
      const wing = sel.ablWing ? sel.ablWing.label : '';
      const reach = !wing ? 0 : /ex-narrow/i.test(wing) ? 24 : /compact/i.test(wing) ? 26 : /narrow/i.test(wing) ? 30
        : /medium-wide/i.test(wing) ? 48 : /medium/i.test(wing) ? 40 : /wide/i.test(wing) ? 56 : 36;
      const mount = sel.ablMount ? sel.ablMount.label : '';
      head.abl = {
        family: sel.fam, side: cfg.ablSide, reach, low: /low/i.test(wing),
        // A Beacon3D on its 17-21 mm mounts hangs in front, under the skirt (its read-me)
        under: sel.fam === 'beacon' && sel.ablMount && !sel.ablMount.side,
        size: /(\d+) ?mm/i.test(mount) && sel.fam !== 'beacon' ? mm(mount, 18) : 18,
        wing: part(sel.ablWing), mount: part(sel.ablMount), extras: sel.ablWith.flatMap(ids)
      };
    }
    if (sel.extruder) {
      const l = sel.extruder.label;
      head.extruder = part(sel.extruder, {
        rear: /rear/i.test(l) && !/front-rear/i.test(l), mirror: /mirror/i.test(l),
        small: /orbiter|sherpa|sailfin|nimble|lgx lite|tbg-lite|apus|hextrudort|zesty|dyze/i.test(l)
      });
    }
    head.risers = sel.risers.map(o => part(o, { mm: mm(o.label, 6) }));
    if (sel.cable) {
      const l = sel.cable.label;
      head.cable = part(sel.cable, {
        side: sel.cable.side || 'left', height: /tall/i.test(l) ? 90 : /medium/i.test(l) ? 55 : /short/i.test(l) ? 45 : 70,
        offset: mm(l, 0), tube: /tube/i.test(l), bent: /bent/i.test(l)
      });
    }
    head.adxl = part(sel.adxl, { vertical: /vertical/i.test(sel.adxl ? sel.adxl.label : '') });
    return withSources(head, sel);
  }

  // The files the printhead draws, by id: their path in the project (the poses' key), size
  // and URL, so the 3D printhead can load the real STLs
  function withSources(head, sel) {
    const src = {};
    const track = (f) => { if (f && !src[f.id]) src[f.id] = { path: f.original_name, size: Number(f.file_size) || 0, url: f.url || null }; };
    const options = [sel.main, ...sel.gantryWith, sel.base, sel.hotend, sel.skirt, sel.standoff, sel.ablWing, sel.ablMount, ...sel.ablWith, sel.extruder, ...sel.risers, sel.cable, sel.adxl];
    options.forEach(o => { if (o) o.files.forEach(track); });
    if (sel.duct) [...sel.duct.files, ...Object.values(sel.duct.sides)].forEach(track);
    head.src = src;
    return head;
  }

  // A one-line summary: "7.4 · Ender 3 V2 · Creality OEM-CR10S-Ender3-5 2-Screw · 2 × 5015"
  function describe(cfg, cat) {
    const c = cfg || {};
    if (!cat) return `Hero Me ${c.release || ''}`.trim();
    const { r, sel } = plan(cat, c);
    const bits = [
      r.label,
      sel.main ? sel.main.label.replace(/\s*gantry adapter\s*/i, ' ').trim() : '',
      sel.standalone ? '' : sel.hotend ? sel.hotend.label.replace(/\s*mount\s*/i, ' ').trim() : '',
      sel.standalone || !sel.duct ? '' : `${c.fans === 1 ? 1 : 2} × ${FAN_LABELS[c.fan] || c.fan}`,
      sel.fam ? ABL_FAMILIES.find(f => f.id === sel.fam).label : '',
      sel.extruder ? sel.extruder.label.replace(/\s*mount\s*/i, ' ').trim() : ''
    ].filter(Boolean);
    return bits.join(' · ').slice(0, 100);
  }

  function bomText(bom, title, cat) {
    const lines = [`${title || 'Hero Me Gen7'}: parts list`];
    if (cat) lines.push(describe(bom.cfg, cat));
    lines.push('', `${bom.totals.files} files, ${bom.totals.prints} prints. * = estimated quantity`, '');
    let group = null;
    for (const p of bom.parts.filter(row => row.qty > 0)) {
      if (p.group !== group) { group = p.group; lines.push(`## ${group}`); }
      lines.push(`${String(p.qty).padStart(3)} x${p.estimate ? '*' : ' '} ${p.file.original_name}`);
    }
    lines.push('', '## Hardware');
    for (const h of bom.hardware) lines.push(`${String(h.qty).padStart(3)} x${h.estimate ? '*' : ' '} ${h.name}${h.note ? `  (${h.note})` : ''}`);
    if (bom.manuals.length) { lines.push('', '## Instructions'); bom.manuals.forEach(f => lines.push(`      ${f.original_name}`)); }
    const notes = [...bom.warnings, ...bom.notes];
    if (notes.length) { lines.push('', '## Notes'); notes.forEach(n => lines.push(`- ${n}`)); }
    return lines.join('\n') + '\n';
  }

  // A project with Hero Me Gen7 releases: base files in a Base folder and enough HMG parts
  function detect(files) {
    const list = (files || []).filter(f => f && !f.deleted_at && /\.stl$/i.test(String(f.original_name || '')));
    const hmg = list.filter(f => /^HMG[67]/i.test(String(f.original_name).split('/').pop())).length;
    const base = list.some(f => /(^|\/)Base\/HMG7[^/]*base[^/]*\.stl$/i.test(String(f.original_name)));
    return base && hmg >= 40;
  }

  // Configurations travel in the URL (?c=) as base64url JSON
  function encodeConfig(cfg) {
    let bin = '';
    new TextEncoder().encode(JSON.stringify(cfg)).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeConfig(text) {
    try {
      const bin = atob(String(text || '').replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    } catch (e) {
      return null;
    }
  }

  return {
    ID: 'hero-me-gen7', GROUPS, FANS, FAN_LABELS, HEIGHTS, HEIGHT_LABELS, ABL_FAMILIES, TIPS: {},
    clean, buildCatalog, detect, defaultConfig, normalize, choices, computeBom, describe, bomText, encodeConfig, decodeConfig,
    classify: () => null
  };
})();
