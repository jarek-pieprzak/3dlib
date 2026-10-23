/* ─── USSA VAULT kit: parts catalog and bill of materials ──────────────────
 * VAULT (ussadesign.com) is a modular storage system sold as an archive of ~740 STL files
 * (~23 GB). A project with that archive gets a configurator on its model page: build a tower
 * (footprint, floors of drawers / sustainers, roof, modifications) and get the files to print,
 * how many prints of each, and the hardware to buy.
 *
 * Files are recognised by normalised name patterns, never by fixed paths: the archive's names
 * are not consistent ("Module 4f" / "4F", "M3 1F Module .stl", "L4F' Facade", double spaces,
 * "Roof" / "Roofs" folders, "Heawyweight"). The archive itself is never changed.
 *
 * Quantities count prints of a file. Some files hold a pair (springs, geared rails, rods,
 * bottom hinges, the L-XL hinge top): one print per box or sustainer. Runner guides and slides
 * are single parts since the October 2026 archive: two prints per box. The rules come from the
 * five PDFs in the archive root; quantities the PDFs leave open are marked as estimates and can
 * be changed by hand (cfg.qty). Parts the PDFs do not show at all are listed with 0 prints
 * (optional) when their option is chosen.
 *
 * Pure functions, no DOM: window.VaultKit in the browser, globalThis.VaultKit in the tests.
 */
globalThis.VaultKit = (function () {
  const WIDTHS = ['S', 'M', 'L', 'XL'];
  const DEPTHS = [3, 4, 5, 6, 7];
  const HEIGHTS = ['1F', '2F', '4F'];
  const F = { '1F': 1, '2F': 2, '4F': 4 };
  // One floor: modules side by side. L is as wide as S+S and XL as S+M ("Stacking Options");
  // L² / XL² are a single L / XL drawer module with a wall in the middle: two drawer columns
  const LAYOUTS = {
    S: [{ id: 'S', label: 'S', modules: [{ w: 'S' }] }],
    M: [{ id: 'M', label: 'M', modules: [{ w: 'M' }] }],
    L: [
      { id: 'L', label: 'L', modules: [{ w: 'L' }] },
      { id: 'L2', label: 'L² (two S drawers)', modules: [{ w: 'L', cols: ['S', 'S'] }] },
      { id: 'S+S', label: 'S + S', modules: [{ w: 'S' }, { w: 'S' }] }
    ],
    XL: [
      { id: 'XL', label: 'XL', modules: [{ w: 'XL' }] },
      { id: 'XL2', label: 'XL² (S + M drawers)', modules: [{ w: 'XL', cols: ['S', 'M'] }] },
      { id: 'S+M', label: 'S + M', modules: [{ w: 'S' }, { w: 'M' }] },
      { id: 'M+S', label: 'M + S', modules: [{ w: 'M' }, { w: 'S' }] }
    ]
  };
  // A taller drawer module can hold several lower boxes (geared rails keep them in place)
  const BOX_SPLITS = { '1F': ['1F'], '2F': ['2F', '1F+1F'], '4F': ['4F', '2F+2F', '2F+1F+1F', '1F+1F+1F+1F'] };
  const ROOFS = [
    { id: 'grid', label: 'Grid (Gridfinity top, handle)' },
    { id: 'table', label: 'Table' },
    { id: 'bowl', label: 'Bowl' },
    { id: 'heavy', label: 'Heavyweight (handle, two bowls)' },
    { id: 'heavycut', label: 'Heavyweight, cut (350 × 320 bed)' },
    { id: 'undertable', label: 'Under-table mount' }
  ];
  const DRAWER_INTERIORS = ['empty', 'gridfinity', 'dividers'];
  const SUSTAINER_INTERIORS = ['flat', 'gridfinity', 'dividers', 'sealed'];
  const BASES = ['none', 'plain', 'wheels', 'casters'];
  const BACKBONES = ['none', 'wide', 'universal'];
  const PEGBOARDS = ['none', 'ikea', 'ussa'];
  // Grid divider lengths ("Grid Dividers": 10-S x3, 14 x4, 18-M x5, 22 x6, 26-L x7, 32-XL)
  const DIVIDER_WIDTH = { S: 10, M: 18, L: 26, XL: 32 };
  const dividerDepth = (d) => 10 + 4 * (d - 3);
  const M16_BASE_ROD = { S: 248, M: 338, L: 414, XL: 504 };
  // Measured on the STL files: a module is 9 mm + 48 mm per F tall, the base 52 mm
  const MODULE_PITCH = 48, MODULE_LIP = 9, BASE_HEIGHT = 52;
  const GROUPS = ['Drawer modules', 'Drawer boxes', 'Small drawer parts', 'Sustainers', 'Sustainer parts',
    'Interiors', 'Roof', 'Base & wheels', 'Backbone & handles', 'Wall mount', 'Extra files'];

  // ── Help for the builder: what an option does and how it looks ──
  // image: an illustration cropped from the archive's PDFs (public/img/kits/ussa-vault/<image>.webp);
  // manual: [PDF in the archive root, page]; adds: what the option puts on the lists. choices:
  // the same for every value of a select.
  const MANUAL = '01_Instructions Manual.pdf';
  const DRAWER_PDF = '02_Drawer Assembly.pdf';
  const SUSTAINER_PDF = '03_Sustainers Assembly.pdf';
  const MODS_PDF = '04_Modifications.pdf';
  const MOUNT_PDF = '05_Mounting Instructions.pdf';
  const TIPS = {
    saved: { title: 'Saved configurations', text: 'Save the tower as a configuration: a project of its own in the library, with its parts list, its ZIP and Open in slicer for every file. It opens locked; Edit configuration changes it.' },
    width: { title: 'Width', image: 'sizes', manual: [MANUAL, 6],
      text: 'How wide the tower is: S 165 mm, M 254 mm, L 330 mm, XL 419 mm. L is as wide as two S modules and XL as an S and an M, so an L or XL tower can have floors of smaller modules side by side. XL modules exist only in 1F.' },
    depth: { title: 'Depth', image: 'sizes', manual: [MANUAL, 6],
      text: 'Depth in Gridfinity units of 42 mm: 3 is about 146 mm deep, every step adds 42 mm, 7 is about 314 mm. Deeper modules hold more but need a bigger print bed; 6 and 7 deep bases and sustainer lids can be printed in two parts.' },
    floors: { title: 'Floors', image: 'stacking', manual: [MANUAL, 8],
      text: 'The tower from top to bottom. Every floor is one or more modules side by side; modules of the same width and depth stack on each other, drawers and sustainers mix freely. Use the arrows to move a floor, the copy button to repeat it.' },
    height: { title: 'Floor height', image: 'sizes', manual: [MANUAL, 6],
      text: '1F, 2F or 4F: 48 mm per F (a 1F module is 57 mm tall with its stacking lip). There is no 3F, everything divides by two. A 2F or 4F drawer module can hold several lower boxes.' },
    layout: { title: 'Modules side by side', image: 'stacking', manual: [MANUAL, 8],
      text: 'One module as wide as the tower, or smaller modules next to each other.',
      choices: {
        S: { label: 'S', text: 'One S module.' }, M: { label: 'M', text: 'One M module.' },
        L: { label: 'L', text: 'One L module: one wide drawer or sustainer.' },
        L2: { label: 'L² (two S drawers)', text: 'One L module printed in one piece with a wall in the middle: two S drawers side by side. Drawers only.' },
        'S+S': { label: 'S + S', text: 'Two separate S modules; each can be a drawer or a sustainer.' },
        XL: { label: 'XL', text: 'One XL module (1F only).' },
        XL2: { label: 'XL² (S + M drawers)', text: 'One XL module with a wall in the middle: an S and an M drawer side by side. Drawers only, 1F only.' },
        'S+M': { label: 'S + M', text: 'Separate S and M modules, the S on the left.' },
        'M+S': { label: 'M + S', text: 'Separate M and S modules, the M on the left.' }
      } },
    type: { title: 'Drawer or sustainer', manual: [MANUAL, 5],
      choices: {
        drawer: { label: 'Drawer', image: 'type-drawer', text: 'A box that slides out on runners, with a turn key in the facade. Good for small parts you reach for often.' },
        sustainer: { label: 'Sustainer', image: 'type-sustainer', text: 'A module with a hinged lid and two locks at the front. Good for bigger or longer items and sealed compartments.' }
      } },
    boxes: { title: 'Boxes in the module', image: 'geared-rails', manual: [DRAWER_PDF, 4],
      text: 'A 2F or 4F drawer module holds one tall box or several lower boxes stacked inside, each with its own facade and key. With more than one box, geared rails (added automatically) keep them in place.' },
    drawerInterior: { title: 'Drawer interior', manual: [MANUAL, 9],
      choices: {
        empty: { label: 'Empty', image: 'drawer-empty', text: 'The bare box with its perforated floor.' },
        gridfinity: { label: 'Gridfinity baseplate', image: 'drawer-gridfinity', text: 'A 42 mm Gridfinity grid in the box for Gridfinity bins; with 0, 1 or 2 handles to lift it out.' },
        dividers: { label: 'Grid dividers', image: 'drawer-dividers', text: 'Slotted strips that cross to make compartments: one along the width and one along the depth (estimate, add more by hand). The rounded and straight edge pieces and the pins (loose or tight fit) are listed with 0 prints: the manual does not show them, set how many you need.' }
      } },
    handles: { title: 'Baseplate handles', image: 'drawer-gridfinity', manual: [MANUAL, 9],
      text: 'Handles on the Gridfinity baseplate to lift it out of the box with the bins on it. Not every size has every variant.' },
    low: { title: 'Low dividers', image: 'drawer-dividers', manual: [MANUAL, 9],
      text: 'Grid dividers 20 mm tall instead of the full box height (34.5 mm for 1F boxes, 82.5 mm for 2F and 4F).' },
    sustainerInterior: { title: 'Sustainer interior', manual: [MANUAL, 9],
      choices: {
        flat: { label: 'Flat', image: 'sus-flat', text: 'An open module with a flat floor.' },
        gridfinity: { label: 'Gridfinity baseplate', image: 'sus-gridfinity', text: 'A Gridfinity baseplate on the flat floor for Gridfinity bins.' },
        dividers: { label: 'Dividers', image: 'sus-dividers', text: 'Divider walls along and across the module (counts are estimates, change them in the list).' },
        sealed: { label: 'Sealed compartments', image: 'sus-sealed', text: 'A module with closed compartments and seal dividers, so small parts cannot wander between them. L and XL only.' }
      } },
    roof: { title: 'Roof', manual: [MANUAL, 10], adds: 'One roof on every drawer module of the top floor; sustainers have their own lids.',
      choices: {
        none: { label: 'No roof', text: 'The top floor stays open (sustainers on top bring their own lids).' },
        grid: { label: 'Grid', image: 'roof-grid', text: 'A Gridfinity grid on top with a carry handle (2 × M6 50 mm bolts).' },
        table: { label: 'Table', image: 'roof-table', text: 'A flat top to put things on.' },
        bowl: { label: 'Bowl', image: 'roof-bowl', text: 'A tray with a raised rim for loose items.' },
        heavy: { label: 'Heavyweight', image: 'roof-heavy', text: 'Two bowls with a handle between them, to carry the tower. L and XL only.' },
        heavycut: { label: 'Heavyweight, cut', image: 'roof-heavy-cut', text: 'The heavyweight roof with the outer corners of both bowls cut off, so it fits a 350 × 320 mm bed: 337 × 320 mm on the plate instead of 366 × 348 mm (picture: both on that bed). Same handle and inserts; XL only. Not in the manual (October 2026 archive).' },
        undertable: { label: 'Under-table mount', image: 'undertable-mount', text: 'A plate screwed under a table top; the tower hangs from it, as many modules as you like.', manual: [MOUNT_PDF, 10] }
      } },
    key: { title: 'Drawer key', image: 'key', manual: [DRAWER_PDF, 1],
      choices: {
        standard: { label: 'Key with cap', image: 'key', text: 'A turn key in the facade with a cap pressed on.' },
        hidden: { label: 'Hidden key', text: 'A key that sits flush in the facade (two parts; the cap is left out, check before printing).' }
      } },
    sustainerFacade: { title: 'Sustainer facades', manual: [MANUAL, 12],
      choices: {
        family: { label: 'Standard', image: 'type-sustainer', text: 'The facades from the size folders.' },
        universal: { label: 'Plain (Universal folder)', text: 'A second set in the Universal folder: same size, simpler surface.' }
      } },
    split: { title: 'Two-part bases and lids',
      text: 'Bases and sustainer lids of depth 6 and 7 are large: print them whole, or in two parts that a connector joins.' },
    gearedRails: { title: 'Geared rails', image: 'geared-rails', manual: [DRAWER_PDF, 4],
      text: 'Toothed rails on the top and bottom of a box (one print per box: the file holds the pair). Always used when a module holds several boxes; in single boxes they add locking force.' },
    manualSupports: { title: 'Manual supports', image: 'manual-supports', manual: [DRAWER_PDF, 3],
      text: 'Separate support strips for printing the boxes (Manual Supports folder, one per box); remove them after printing.' },
    base: { title: 'Base', manual: [MODS_PDF, 2], adds: 'A base as wide and deep as the tower.',
      choices: {
        none: { label: 'None', text: 'The bottom module stands on the table or floor.' },
        plain: { label: 'Base', text: 'A base plate under the bottom floor; add feet to raise it.' },
        wheels: { label: 'Base with wheels', image: 'wheels', manual: [MODS_PDF, 2], text: 'Two 142 mm wheels on an M16 axle with 6205ZZ bearings and SCSAW collars; tyres printed in TPU; feet at the front. Tilt and roll like a hand truck.' },
        casters: { label: 'Base with casters', image: 'casters', manual: [MODS_PDF, 17], text: 'Four casters with M8 threads screwed into the base.' }
      } },
    feet: { title: 'Feet', image: 'feet', manual: [MODS_PDF, 6], text: 'A foot block under the base (2 × M6 90 mm bolts). With wheels it holds the tower upright at the front.' },
    backbone: { title: 'Backbone', manual: [MODS_PDF, 1], adds: 'Boards along the back, one per floor (two per 4F floor), with M4 60-100 mm bolts; the holes are drilled through.',
      text: 'Boards on the back of the tower that tie the modules together. Handles and pegboards attach to them.',
      choices: {
        none: { label: 'None', text: 'Modules only lock onto each other.' },
        wide: { label: 'Wide boards', image: 'backbone-wide', text: 'One board as wide as the tower on every floor.' },
        universal: { label: 'Universal boards', image: 'backbone-universal', text: 'Two narrow boards on the edges of every floor; fit any width.' }
      } },
    pegboard: { title: 'Pegboard', image: 'pegboard', manual: [MODS_PDF, 15],
      text: 'Pegboard panels on the backbone for hanging tools (4 × M4 40 mm bolts each).',
      choices: {
        none: { label: 'None', text: 'No pegboard.' },
        ikea: { label: 'IKEA Skådis', image: 'pegboard', text: 'Panels with the IKEA Skådis hole pattern.' },
        ussa: { label: 'USSA', image: 'pegboard', text: 'Panels for USSA pegboard accessories.' }
      } },
    pullHandle: { title: 'Pull-out handle', image: 'pullout-handle', manual: [MODS_PDF, 14],
      text: 'A telescopic handle on two M16 rods along the backbone, locked by two knobs: pull it out to roll the tower on its wheels. The rods are cut to the tower height.' },
    stationaryHandle: { title: 'Stationary handle', image: 'stationary-handle', manual: [MODS_PDF, 12],
      text: 'A fixed handle on a backbone board (8 × M4 60 mm bolts); it goes on before the board is bolted to the module.' },
    wallMount: { title: 'Wall mount', image: 'wallmount-hung', manual: [MOUNT_PDF, 1],
      text: 'A plate on the back of every module and cleats ("second parts") screwed to the wall: the tower hangs on the wall. One cleat per 1F or 2F mount, two per 4F. The first mount is a template for drilling.' },
    docs: { title: 'Instructions in the ZIP', text: 'Adds the five assembly PDFs from the archive to the download.' }
  };

  // ── File names ──
  const norm = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
  function splitPath(originalName) {
    const parts = String(originalName || '').split('/').map(norm).filter(Boolean);
    const file = parts.pop() || '';
    const ext = (file.match(/\.([a-z0-9]+)$/) || [])[1] || '';
    return { dirs: parts, name: norm(file.replace(/\.[a-z0-9]+$/, '')), ext };
  }
  const W = '(s|m|l|xl)';
  const up = (s) => String(s).toUpperCase();
  const re = (s) => new RegExp(s);

  // The catalog key of one archive file, or null when it is not a known part
  function classify(originalName) {
    const { dirs, name, ext } = splitPath(originalName);
    if (ext !== 'stl') return null;
    const section = dirs.find(d => /drawers|sustainers|modifications/.test(d)) || '';
    const inDir = (r) => dirs.some(d => r.test(d));
    let m;
    if (/drawers/.test(section)) {
      if ((m = name.match(/^(l|xl)([3-7])² module ([124])f$/))) return `d:module2:${up(m[1])}${m[2]}:${m[3]}F`;
      if ((m = name.match(re(`^${W}([3-7]) module ([124])f$`)))) return `d:module:${up(m[1])}${m[2]}:${m[3]}F`;
      if ((m = name.match(re(`^${W}([3-7]) box ([124])f(?: part ([12]))?$`)))) return `d:box:${up(m[1])}${m[2]}:${m[3]}F${m[4] ? `:part${m[4]}` : ''}`;
      if ((m = name.match(/^xl([3-7]) back panel$/))) return `d:backpanel:XL${m[1]}`;
      // "S3 Baseplate", "S3 Baseplate_With 2 Handles", "M4 Gridfinity Baseplate No_Handles", "XL6 Baseplate Part 1"
      if ((m = name.match(re(`^${W}([3-7])(?: gridfinity)? baseplate(?:[ _](?:with )?(no|[12])[ _]handles?)?(?: part ([12]))?$`)))) {
        const handles = m[3] && m[3] !== 'no' ? m[3] : '0';
        return `d:baseplate:${up(m[1])}${m[2]}:${handles}${m[4] ? `:part${m[4]}` : ''}`;
      }
      // "XL3 Heavyweight Roof Cut": the heavyweight roof cut down to fit a 350 x 320 bed
      if ((m = name.match(re(`^${W}([3-7]) (bowl|grid|table|under table mount|heawyweight|heavyweight) roof( cut)?$`)))) {
        const kind = { bowl: 'bowl', grid: 'grid', table: 'table', 'under table mount': 'undertable', heawyweight: 'heavy', heavyweight: 'heavy' }[m[3]];
        if (m[4] && kind !== 'heavy') return null;
        return `d:roof:${up(m[1])}${m[2]}:${kind}${m[4] ? 'cut' : ''}`;
      }
      if ((m = name.match(re(`^${W}([124])f \\(turn on supports\\)$`))) && inDir(/facades/)) return `d:facade:${up(m[1])}:${m[2]}F`;
      if ((m = name.match(/^xl facade ([124])f$/))) return `d:facade:XL:${m[1]}F`;
      if ((m = name.match(re(`^${W} rails$`)))) return `d:rails:${up(m[1])}`;
      // One runner per file: "x3 Runner Guide", "XL Runners/x3 Runner Slide XL"
      if ((m = name.match(/^x([3-7]) runner (guide|slide)( xl)?$/))) return `d:runner${m[2]}:${m[3] ? 'XL' : 'x'}${m[1]}`;
      if (name === 'runner stopper') return 'd:runnerstopper';
      if ((m = name.match(/^x([3-7])$/)) && inDir(/manual supports/)) return `d:support:${m[1]}`;
      if ((m = name.match(/^x([3-7]) accessory (1st|2nd)$/))) return `d:l2acc:${m[1]}:${m[2]}`;
      if (inDir(/grid dividers/)) {
        if ((m = name.match(/^grid divider pin_(loose|tight)$/))) return `d:gridpin:${m[1]}`;
        const h = (dirs.find(d => /tall/.test(d)) || '').match(/^([\d.]+)mm/);
        if ((m = name.match(/^(\d+)(?:-(?:s|m|l|xl))?(?:, x[3-7])?$/))) return h ? `d:griddivider:${h[1]}:${m[1]}` : null;
        // "Rounded Edge Piece 20MM", "Straight Edge Piece 1F" in the folder of their height
        if ((m = name.match(/^(rounded|straight) edge piece (?:20mm|[12]f)$/))) return h ? `d:gridedge:${h[1]}:${m[1]}` : null;
      }
      const universal = {
        'facade cap': 'd:facadecap', 'heawyweight roof handle': 'd:heavyhandle', 'heavyweight roof handle': 'd:heavyhandle',
        'heawyweight roof insert': 'd:heavyinsert', 'heavyweight roof insert': 'd:heavyinsert',
        'hidden key (turn on supports)': 'd:hiddenkey', 'hidden key part 2 (turn on supports)': 'd:hiddenkey2',
        'key (turn on supports)': 'd:key', 'key cap': 'd:keycap', label: 'd:label', latch: 'd:latch', springs: 'd:springs',
        'top handle (turn on supports)': 'd:tophandle'
      };
      return universal[name] || null;
    }
    if (/sustainers/.test(section)) {
      if ((m = name.match(re(`^${W}([3-7]) ([124])f(?: (dividers|flat|sealed))? module$`)))) return `s:module:${up(m[1])}${m[2]}:${m[3]}F:${m[4] || 'plain'}`;
      if ((m = name.match(re(`^${W}([3-7]) roof(?: (whole|part 1|part 2))?$`)))) return `s:roof:${up(m[1])}${m[2]}:${(m[3] || 'whole').replace(' ', '')}`;
      if (name === 'connector for split roof') {
        const fam = dirs.map(d => d.match(re(`^${W}([3-7])$`))).find(Boolean);
        return fam ? `s:roofconnector:${up(fam[1])}${fam[2]}` : null;
      }
      if ((m = name.match(re(`^${W}([124])f facade$`)))) return `s:facade:${up(m[1])}:${m[2]}F`;
      if ((m = name.match(re(`^${W}([124])f$`))) && inDir(/facades/)) return `s:facadeu:${up(m[1])}:${m[2]}F`;
      if ((m = name.match(re(`^${W}([3-7])(?: part ([12]))?(?: gridfinity)? baseplate$`)))) return `s:baseplate:${up(m[1])}${m[2]}:${m[3] ? `part${m[3]}` : 'whole'}`;
      if ((m = name.match(/^(s|m)([124])f divider$/))) return `s:divider:${up(m[1])}:${m[2]}F`;
      if ((m = name.match(/^l([3-7])-([124])f depth divider$/))) return `s:depthdivider:L${m[1]}:${m[2]}F`;
      if ((m = name.match(/^l-([124])f (width|seal) divider$/))) return `s:${m[2]}divider:L:${m[1]}F`;
      if ((m = name.match(/^xl([3-7]) depth divider$/))) return `s:depthdivider:XL${m[1]}:1F`;
      if (name === 'xl width divider') return 's:widthdivider:XL:1F';
      if ((m = name.match(/^xl seal divider \((center|sides)\)$/))) return `s:sealdivider:XL:${m[1]}`;
      const parts = {
        'l 2-4f hinge': 's:hinge:L:24', 'l-xl 1f hinge': 's:hinge:LXL:1', 's-m 1f hinge': 's:hinge:SM:1', 's-m 2-4f hinge': 's:hinge:SM:24',
        'l-xl hinge top': 's:hingetop:LXL', 'm hinge top': 's:hingetop:M', 's hinge top': 's:hingetop:S',
        '1 set of pins for 1 lock': 's:lockpins', 'lock holder': 's:lockholder', 'lock inner part': 's:lockinner',
        'lock outer part 1f': 's:lockouter:1', 'lock outer part 2-4f': 's:lockouter:24',
        'l-xl rods': 's:rods:LXL', 's-m rods': 's:rods:SM', 'label for sustainers': 's:label'
      };
      return parts[name] || null;
    }
    if (/modifications/.test(section)) {
      if ((m = name.match(re(`^${W}([12])f backbone$`)))) return `m:backbone:${up(m[1])}:${m[2]}F`;
      if ((m = name.match(/^universal ([12])f backbone$/))) return `m:backbone:U:${m[1]}F`;
      if ((m = name.match(/^connector for modules ([12])f$/))) return `m:moduleconnector:${m[1]}F`;
      if ((m = name.match(/^handle lock knob part ([12])$/))) return `m:knob:${m[1]}`;
      if ((m = name.match(/^(s|m|l|xl|universal) pull-out handle lock( part 2)?$/))) return `m:pulllock:${m[1] === 'universal' ? 'U' : up(m[1])}${m[2] ? ':2' : ''}`;
      if ((m = name.match(re(`^${W} pull-out handle$`)))) return `m:pullhandle:${up(m[1])}`;
      if ((m = name.match(re(`^${W} stationary handle$`)))) return `m:stathandle:${up(m[1])}`;
      if ((m = name.match(re(`^${W}([3-7]) base(?: (whole|part 1|part 2))?$`)))) return `m:base:${up(m[1])}${m[2]}:${(m[3] || 'whole').replace(' ', '')}`;
      if (name === 'base connector') return 'm:baseconnector';
      if ((m = name.match(re(`^${W} feet$`)))) return `m:feet:${up(m[1])}`;
      if ((m = name.match(re(`^${W}([124])f wall mount$`)))) return `m:wallmount:${up(m[1])}:${m[2]}F`;
      if (name === 'wall mount second part') return 'm:wallmount2';
      if ((m = name.match(re(`^${W}([12])f$`))) && inDir(/pegboard/)) return `m:pegboard:${inDir(/ikea/) ? 'ikea' : 'ussa'}:${up(m[1])}:${m[2]}F`;
      const wheels = { bushing: 'm:bushing', cover: 'm:wheelcover', disk: 'm:disk', jig: 'm:jig', 'tyre (tpu)': 'm:tyre' };
      return wheels[name] || null;
    }
    return null;
  }

  // ── Catalog: key -> file ──
  // M4 drawers also have an alternative set of baseplates ("M4 Gridfinity Baseplate No_Handles",
  // 3 mm instead of 4): the names every family uses win, the others can be added by hand
  const isAlternative = (f) => /^\S+ gridfinity baseplate /.test(splitPath(f.original_name).name) && /drawers/.test(norm(f.original_name));
  function buildCatalog(files) {
    const byKey = {};
    const byPath = {};
    const unknown = [];
    const docs = [];
    for (const f of files || []) {
      if (f.deleted_at) continue;
      byPath[f.original_name] = f;
      const key = classify(f.original_name);
      if (key && (!byKey[key] || (isAlternative(byKey[key]) && !isAlternative(f)))) byKey[key] = f;
      if (key) continue;
      unknown.push(f);
      // The instruction PDFs in the archive root go along with the download
      if (!String(f.original_name || '').includes('/') && /\.pdf$/i.test(f.original_name || '')) docs.push(f);
    }
    docs.sort((a, b) => String(a.original_name).localeCompare(String(b.original_name)));
    return { byKey, byPath, unknown, docs, count: Object.keys(byKey).length };
  }

  // The archive is recognised by its three top folders and enough recognised parts
  function detect(files) {
    const tops = new Set((files || []).map(f => norm(String(f.original_name || '').split('/')[0])));
    const hasTops = ['drawers', 'sustainers', 'modifications'].every(t => [...tops].some(x => x.includes(t)));
    return hasTops && buildCatalog(files).count >= 40;
  }

  // ── What the archive offers ──
  const has = (cat, key) => !!cat.byKey[key];
  const layoutOf = (width, id) => (LAYOUTS[width] || []).find(l => l.id === id) || null;
  // The columns of a floor, left to right: one per module, two for an L² / XL² module
  function slotsOf(layout) {
    const out = [];
    (layout ? layout.modules : []).forEach((mod, mi) => {
      if (mod.cols) mod.cols.forEach(w => out.push({ mi, w, double: true, moduleW: mod.w }));
      else out.push({ mi, w: mod.w, double: false, moduleW: mod.w });
    });
    return out;
  }
  function drawerModuleKey(mod, d, h) {
    return mod.cols ? `d:module2:${mod.w}${d}:${h}` : `d:module:${mod.w}${d}:${h}`;
  }
  function sustainerInteriors(cat, w, d, h) {
    const v = (variant) => has(cat, `s:module:${w}${d}:${h}:${variant}`);
    const out = [];
    if (v('plain') || v('flat')) out.push('flat', 'gridfinity');
    if (v('dividers') || (v('plain') && has(cat, `s:divider:${w}:${h}`))) out.push('dividers');
    if (v('sealed')) out.push('sealed');
    return out;
  }
  function slotTypes(cat, slot, d, h) {
    const out = [];
    const mod = slot.double ? { w: slot.moduleW, cols: [] } : { w: slot.w };
    if (has(cat, drawerModuleKey(mod, d, h))) out.push('drawer');
    if (!slot.double && sustainerInteriors(cat, slot.w, d, h).length) out.push('sustainer');
    return out;
  }
  function layoutAvailable(cat, layout, d, h) {
    return layout.modules.every(mod => mod.cols
      ? has(cat, drawerModuleKey(mod, d, h))
      : has(cat, drawerModuleKey(mod, d, h)) || sustainerInteriors(cat, mod.w, d, h).length > 0);
  }
  function drawerInteriors(cat, w, d) {
    const out = ['empty'];
    if (Object.keys(cat.byKey).some(k => k.startsWith(`d:baseplate:${w}${d}:`))) out.push('gridfinity');
    if (has(cat, `d:griddivider:34.5:${DIVIDER_WIDTH[w]}`)) out.push('dividers');
    return out;
  }
  function baseplateHandles(cat, w, d) {
    return ['0', '1', '2'].filter(n => has(cat, `d:baseplate:${w}${d}:${n}`) || (n === '0' && has(cat, `d:baseplate:${w}${d}:0:part1`)));
  }
  function slotChoices(cat, slot, d, h, type) {
    const types = slotTypes(cat, slot, d, h);
    const t = types.includes(type) ? type : types[0];
    return {
      types,
      interiors: t === 'sustainer' ? sustainerInteriors(cat, slot.w, d, h) : drawerInteriors(cat, slot.w, d),
      boxes: t === 'drawer' ? BOX_SPLITS[h] : [],
      handles: t === 'drawer' ? baseplateHandles(cat, slot.w, d) : []
    };
  }
  // The drawer modules on top of the tower, which get the roof (sustainers bring their own lid)
  function topDrawerModules(cfg) {
    const floors = cfg.floors || [];
    const top = floors[floors.length - 1];
    const layout = top && layoutOf(cfg.width, top.layout);
    if (!layout) return [];
    const slots = slotsOf(layout);
    return layout.modules.filter((mod, mi) => mod.cols || ((top.slots || [])[slots.findIndex(s => s.mi === mi)] || {}).type !== 'sustainer');
  }
  function roofChoices(cat, cfg) {
    const mods = topDrawerModules(cfg);
    if (!mods.length) return [];
    return ROOFS.filter(r => mods.every(mod => has(cat, `d:roof:${mod.w}${cfg.depth}:${r.id}`))).map(r => r.id);
  }
  // Everything the builder can offer for the configuration, for its selects
  function choices(cat, cfg) {
    const d = cfg.depth;
    return {
      widths: WIDTHS.filter(w => DEPTHS.some(dd => HEIGHTS.some(h => (LAYOUTS[w] || []).some(l => layoutAvailable(cat, l, dd, h))))),
      depths: DEPTHS.filter(dd => HEIGHTS.some(h => (LAYOUTS[cfg.width] || []).some(l => layoutAvailable(cat, l, dd, h)))),
      floors: (cfg.floors || []).map(floor => {
        const layout = layoutOf(cfg.width, floor.layout);
        return {
          heights: HEIGHTS.filter(h => (LAYOUTS[cfg.width] || []).some(l => layoutAvailable(cat, l, d, h))),
          layouts: (LAYOUTS[cfg.width] || []).map(l => ({ id: l.id, label: l.label, available: layoutAvailable(cat, l, d, floor.height) })),
          slots: slotsOf(layout).map((slot, si) => ({ ...slotChoices(cat, slot, d, floor.height, ((floor.slots || [])[si] || {}).type), width: slot.w, double: slot.double }))
        };
      }),
      roofs: roofChoices(cat, cfg),
      bases: BASES.filter(b => b === 'none' || has(cat, `m:base:${cfg.width}${d}:whole`) || has(cat, `m:base:${cfg.width}${d}:part1`)),
      backbones: BACKBONES.filter(b => b !== 'wide' || has(cat, `m:backbone:${cfg.width}:1F`)),
      canSplit: d >= 6
    };
  }

  function defaultSlot(type) {
    return type === 'sustainer' ? { type: 'sustainer', interior: 'flat' } : { type: 'drawer', boxes: '', interior: 'empty', handles: '0', low: false };
  }
  function newFloor(width) {
    return { height: '1F', layout: (LAYOUTS[width] || LAYOUTS.L)[0].id, slots: [defaultSlot('drawer')] };
  }
  function defaultConfig() {
    return {
      v: 1,
      width: 'L',
      depth: 4,
      floors: [
        { height: '2F', layout: 'L', slots: [defaultSlot('drawer')] },
        { height: '1F', layout: 'S+S', slots: [defaultSlot('drawer'), defaultSlot('drawer')] },
        { height: '2F', layout: 'L', slots: [defaultSlot('drawer')] }
      ],
      roof: 'grid',
      key: 'standard',
      split: false,
      manualSupports: false,
      gearedRails: 'auto',
      sustainerFacade: 'family',
      docs: true,
      mods: { base: 'none', feet: false, backbone: 'none', pullHandle: false, stationaryHandle: false, pegboard: 'none', wallMount: false },
      qty: {},
      extra: {}
    };
  }

  // A valid configuration for this archive: unknown or unavailable choices fall back to the
  // first available one (a saved or linked configuration may be older than the archive)
  function normalize(cat, input) {
    const def = defaultConfig();
    const src = input && typeof input === 'object' ? input : {};
    const changes = [];
    const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
    const cfg = {
      v: 1,
      width: pick(src.width, WIDTHS, def.width),
      depth: pick(Number(src.depth), DEPTHS, def.depth),
      floors: [],
      roof: src.roof === 'none' ? 'none' : pick(src.roof, ROOFS.map(r => r.id), def.roof),
      key: pick(src.key, ['standard', 'hidden'], def.key),
      split: !!src.split,
      manualSupports: !!src.manualSupports,
      gearedRails: pick(src.gearedRails, ['auto', 'all'], def.gearedRails),
      sustainerFacade: pick(src.sustainerFacade, ['family', 'universal'], def.sustainerFacade),
      docs: src.docs !== false,
      mods: {},
      qty: {},
      extra: {}
    };
    const d = cfg.depth;
    const floorsIn = Array.isArray(src.floors) ? src.floors.slice(0, 30) : def.floors;
    floorsIn.forEach((f, fi) => {
      const floor = f && typeof f === 'object' ? f : {};
      const where = `Floor ${fi + 1}`;
      const layouts = LAYOUTS[cfg.width];
      const heights = HEIGHTS.filter(h => layouts.some(l => layoutAvailable(cat, l, d, h)));
      if (!heights.length) return;
      let height = pick(floor.height, heights, heights[0]);
      if (height !== floor.height && floor.height) changes.push(`${where}: no ${cfg.width}${d} ${floor.height} modules, set to ${height}.`);
      let layout = layoutOf(cfg.width, floor.layout);
      if (!layout || !layoutAvailable(cat, layout, d, height)) {
        const next = layouts.find(l => layoutAvailable(cat, l, d, height));
        if (layout && floor.layout) changes.push(`${where}: ${layout.label} is not available in ${height}, set to ${next.label}.`);
        layout = next;
      }
      const slotsIn = Array.isArray(floor.slots) ? floor.slots : [];
      const columns = slotsOf(layout);
      const slots = columns.map((slot, si) => {
        const s = slotsIn[si] && typeof slotsIn[si] === 'object' ? slotsIn[si] : {};
        const types = slotTypes(cat, slot, d, height);
        const type = pick(s.type, types, types[0]);
        const ch = slotChoices(cat, slot, d, height, type);
        const what = `${where}${columns.length > 1 ? `, ${slot.w} ${si === 0 ? 'left' : 'right'}` : ''}`;
        if (s.type && type !== s.type) changes.push(`${what}: no ${slot.w}${d} ${height} ${s.type}, set to ${type}.`);
        const interior = pick(s.interior, ch.interiors, type === 'sustainer' ? ch.interiors[0] : 'empty');
        if (s.interior && s.type === type && interior !== s.interior) changes.push(`${what}: no ${s.interior} interior for this ${type}, set to ${interior}.`);
        if (type === 'sustainer') return { type, interior };
        return {
          type,
          boxes: pick(s.boxes, ch.boxes, ch.boxes[0]),
          interior,
          handles: pick(String(s.handles), ch.handles, ch.handles[0] || '0'),
          low: !!s.low
        };
      });
      cfg.floors.push({ height, layout: layout.id, slots });
    });
    const roofs = roofChoices(cat, cfg);
    if (cfg.roof !== 'none' && roofs.length && !roofs.includes(cfg.roof)) {
      changes.push(`No ${cfg.roof} roof for the top floor, set to ${roofs[0]}.`);
      cfg.roof = roofs[0];
    }
    const mods = src.mods && typeof src.mods === 'object' ? src.mods : {};
    cfg.mods = {
      base: pick(mods.base, BASES, 'none'),
      feet: !!mods.feet,
      backbone: pick(mods.backbone, BACKBONES, 'none'),
      pullHandle: !!mods.pullHandle,
      stationaryHandle: !!mods.stationaryHandle,
      pegboard: pick(mods.pegboard, PEGBOARDS, 'none'),
      wallMount: !!mods.wallMount
    };
    if (cfg.mods.base === 'none') cfg.mods.feet = false;
    for (const [field, target] of [['qty', cfg.qty], ['extra', cfg.extra]]) {
      const obj = src[field] && typeof src[field] === 'object' ? src[field] : {};
      for (const [k, v] of Object.entries(obj)) {
        const n = Math.floor(Number(v));
        if (Number.isFinite(n) && n >= 0 && n <= 999) target[k] = n;
      }
    }
    return { cfg, changes };
  }

  function towerUnits(cfg) {
    return (cfg.floors || []).reduce((n, f) => n + (F[f.height] || 0), 0);
  }
  // Rough tower height (base + modules) for the pull-out handle rods; measure before cutting
  function towerHeight(cfg) {
    const units = towerUnits(cfg);
    if (!units) return 0;
    const h = (cfg.mods && cfg.mods.base !== 'none' ? BASE_HEIGHT : 0) + MODULE_PITCH * units + MODULE_LIP;
    return Math.round(h / 10) * 10;
  }

  // ── Bill of materials ──
  function computeBom(cat, input) {
    const { cfg, changes } = normalize(cat, input);
    const parts = new Map(); // key -> { key, file, qty, group, label, estimate }
    const hardware = new Map();
    const warnings = changes.slice();
    const notes = [];
    const missing = new Set();
    const add = (key, qty, group, label, estimate) => {
      if (!qty) return;
      const file = cat.byKey[key];
      if (!file) { missing.add(label || key); return; }
      const row = parts.get(key) || { key, file, qty: 0, group, label: label || file.original_name.split('/').pop().replace(/\.stl$/i, ''), estimate: false };
      row.qty += qty;
      if (estimate) row.estimate = true;
      parts.set(key, row);
    };
    const hw = (name, qty, note, estimate) => {
      if (!qty) return;
      const row = hardware.get(name) || { name, qty: 0, notes: new Set(), estimate: false };
      row.qty += qty;
      if (note) row.notes.add(note);
      if (estimate) row.estimate = true;
      hardware.set(name, row);
    };
    // A part the manual does not show: listed with 0 prints, the count is set by hand
    const option = (key, group, label) => {
      const file = cat.byKey[key];
      if (file && !parts.has(key)) parts.set(key, { key, file, qty: 0, group, label, estimate: false, optional: true });
    };
    const d = cfg.depth;
    const width = cfg.width;
    const split = cfg.split && d >= 6;
    if (!cfg.floors.length) warnings.push('Add at least one floor.');

    const addDrawerBox = (w, bh, slot, rails) => {
      const rk = w === 'XL' ? `XL${d}` : `x${d}`;
      if (has(cat, `d:box:${w}${d}:${bh}`)) add(`d:box:${w}${d}:${bh}`, 1, 'Drawer boxes', `${w}${d} ${bh} box`);
      else {
        // XL6 / XL7 boxes only come in two parts
        add(`d:box:${w}${d}:${bh}:part1`, 1, 'Drawer boxes', `${w}${d} ${bh} box, part 1`);
        add(`d:box:${w}${d}:${bh}:part2`, 1, 'Drawer boxes', `${w}${d} ${bh} box, part 2`);
      }
      add(`d:facade:${w}:${bh}`, 1, 'Drawer boxes', `${w}${bh} drawer facade`);
      if (w === 'XL' && has(cat, `d:backpanel:XL${d}`)) add(`d:backpanel:XL${d}`, 1, 'Drawer boxes', `XL${d} back panel`);
      add(`d:runnerguide:${rk}`, 2, 'Drawer boxes', `${rk} runner guide`);
      add(`d:runnerslide:${rk}`, 2, 'Drawer boxes', `${rk} runner slide`);
      if (rails) add(`d:rails:${w}`, 1, 'Drawer boxes', `${w} geared rails (top and bottom)`);
      add('d:runnerstopper', 2, 'Small drawer parts', 'Runner stopper');
      if (cfg.key === 'hidden') {
        add('d:hiddenkey', 1, 'Small drawer parts', 'Hidden key', true);
        add('d:hiddenkey2', 1, 'Small drawer parts', 'Hidden key, part 2', true);
      } else {
        add('d:key', 1, 'Small drawer parts', 'Key');
        add('d:keycap', 1, 'Small drawer parts', 'Key cap');
      }
      add('d:springs', 1, 'Small drawer parts', 'Springs (pair)');
      add('d:facadecap', 1, 'Small drawer parts', 'Facade cap');
      add('d:label', 1, 'Small drawer parts', 'Label');
      if (cfg.manualSupports) add(`d:support:${d}`, 1, 'Small drawer parts', `x${d} manual supports`, true);
      hw('M4 × 14 mm bolt', bh === '1F' ? 4 : 6, 'drawer facades');
      if (slot.interior === 'gridfinity') {
        const n = slot.handles || '0';
        if (has(cat, `d:baseplate:${w}${d}:${n}`)) add(`d:baseplate:${w}${d}:${n}`, 1, 'Interiors', `${w}${d} Gridfinity baseplate${n === '0' ? '' : `, ${n} handle${n === '1' ? '' : 's'}`}`);
        else {
          add(`d:baseplate:${w}${d}:0:part1`, 1, 'Interiors', `${w}${d} Gridfinity baseplate, part 1`);
          add(`d:baseplate:${w}${d}:0:part2`, 1, 'Interiors', `${w}${d} Gridfinity baseplate, part 2`);
        }
      }
      if (slot.interior === 'dividers') {
        const tall = slot.low ? '20' : (bh === '1F' ? '34.5' : '82.5');
        add(`d:griddivider:${tall}:${DIVIDER_WIDTH[w]}`, 1, 'Interiors', `Grid divider ${DIVIDER_WIDTH[w]} (${w} width, ${tall} mm)`, true);
        add(`d:griddivider:${tall}:${dividerDepth(d)}`, 1, 'Interiors', `Grid divider ${dividerDepth(d)} (depth ${d}, ${tall} mm)`, true);
        option(`d:gridedge:${tall}:rounded`, 'Interiors', `Rounded edge piece (${tall} mm)`);
        option(`d:gridedge:${tall}:straight`, 'Interiors', `Straight edge piece (${tall} mm)`);
        option('d:gridpin:loose', 'Interiors', 'Grid divider pin, loose fit');
        option('d:gridpin:tight', 'Interiors', 'Grid divider pin, tight fit');
      }
    };

    const addSustainer = (w, h, slot) => {
      const sm = w === 'S' || w === 'M';
      const interior = slot.interior;
      const variant = sm ? 'plain' : (interior === 'dividers' ? 'dividers' : interior === 'sealed' ? 'sealed' : 'flat');
      add(`s:module:${w}${d}:${h}:${variant}`, 1, 'Sustainers', `${w}${d} ${h} sustainer module${variant === 'plain' ? '' : ` (${variant})`}`);
      if (split && has(cat, `s:roof:${w}${d}:part1`)) {
        add(`s:roof:${w}${d}:part1`, 1, 'Sustainers', `${w}${d} sustainer lid, part 1`);
        add(`s:roof:${w}${d}:part2`, 1, 'Sustainers', `${w}${d} sustainer lid, part 2`);
        add(`s:roofconnector:${w}${d}`, 1, 'Sustainers', `${w}${d} connector for split lid`, true);
      } else add(`s:roof:${w}${d}:whole`, 1, 'Sustainers', `${w}${d} sustainer lid`);
      const facades = cfg.sustainerFacade === 'universal' ? [`s:facadeu:${w}:${h}`, `s:facade:${w}:${h}`] : [`s:facade:${w}:${h}`, `s:facadeu:${w}:${h}`];
      add(facades.find(k => has(cat, k)) || facades[0], 1, 'Sustainers', `${w}${h} sustainer facade`);
      add(sm ? `s:hinge:SM:${h === '1F' ? 1 : 24}` : (w === 'L' && h !== '1F' ? 's:hinge:L:24' : 's:hinge:LXL:1'), 1, 'Sustainer parts', 'Bottom hinges (pair)');
      if (sm) add(`s:hingetop:${w}`, 2, 'Sustainer parts', `${w} hinge top`);
      else add('s:hingetop:LXL', 1, 'Sustainer parts', 'L-XL hinge tops (pair)');
      add(sm ? 's:rods:SM' : 's:rods:LXL', 1, 'Sustainer parts', 'Hinge rods (pair)');
      add('s:lockholder', 2, 'Sustainer parts', 'Lock holder');
      add('s:lockinner', 2, 'Sustainer parts', 'Lock inner part');
      add(`s:lockouter:${h === '1F' ? 1 : 24}`, 2, 'Sustainer parts', `Lock outer part ${h === '1F' ? '1F' : '2-4F'}`);
      add('s:lockpins', 2, 'Sustainer parts', 'Pins for one lock');
      add('s:label', 1, 'Sustainer parts', 'Label for sustainers');
      hw('M4 × 10 mm bolt', 8, 'sustainer hinges');
      hw('M4 × 14 mm bolt', 16, 'sustainer locks and hinges');
      hw('M4 × 20 mm bolt', 7, 'sustainer facades');
      if (interior === 'gridfinity') {
        if (has(cat, `s:baseplate:${w}${d}:whole`)) add(`s:baseplate:${w}${d}:whole`, 1, 'Interiors', `${w}${d} sustainer Gridfinity baseplate`);
        else {
          add(`s:baseplate:${w}${d}:part1`, 1, 'Interiors', `${w}${d} sustainer Gridfinity baseplate, part 1`);
          add(`s:baseplate:${w}${d}:part2`, 1, 'Interiors', `${w}${d} sustainer Gridfinity baseplate, part 2`);
        }
      } else if (interior === 'dividers') {
        if (sm) add(`s:divider:${w}:${h}`, 1, 'Interiors', `${w}${h} sustainer divider`, true);
        else {
          const dh = w === 'XL' ? '1F' : h;
          add(`s:depthdivider:${w}${d}:${dh}`, 1, 'Interiors', `${w}${d} ${dh} depth divider`, true);
          add(`s:widthdivider:${w}:${dh}`, 2, 'Interiors', `${w} ${dh} width divider`, true);
        }
      } else if (interior === 'sealed') {
        if (w === 'XL') {
          add('s:sealdivider:XL:center', 1, 'Interiors', 'XL seal divider (center)', true);
          add('s:sealdivider:XL:sides', 2, 'Interiors', 'XL seal divider (sides)', true);
        } else add(`s:sealdivider:L:${h}`, 2, 'Interiors', `L ${h} seal divider`, true);
      }
    };

    // The floors, bottom to top
    cfg.floors.forEach((floor, fi) => {
      const layout = layoutOf(width, floor.layout);
      const h = floor.height;
      const slots = slotsOf(layout);
      layout.modules.forEach((mod, mi) => {
        const modSlots = slots.map((s, si) => ({ s, slot: floor.slots[si] })).filter(x => x.s.mi === mi);
        const first = modSlots[0].slot;
        if (!mod.cols && first.type === 'sustainer') return addSustainer(mod.w, h, first);
        add(drawerModuleKey(mod, d, h), 1, 'Drawer modules', `${mod.w}${mod.cols ? '²' : ''}${d} ${h} drawer module`);
        add('d:latch', 1, 'Small drawer parts', 'Latch');
        if (mod.cols && mod.w === 'L') {
          // The middle wall of an L² module: the PDFs do not show these parts
          add(`d:l2acc:${d}:1st`, 1, 'Small drawer parts', `x${d} L² accessory, 1st`, true);
          add(`d:l2acc:${d}:2nd`, 1, 'Small drawer parts', `x${d} L² accessory, 2nd`, true);
        }
        modSlots.forEach(({ s, slot }) => {
          const boxes = (slot.boxes || h).split('+');
          const rails = boxes.length > 1 || cfg.gearedRails === 'all';
          boxes.forEach(bh => addDrawerBox(s.w, bh, slot, rails));
        });
      });
      if (fi === 0 && cfg.floors.length && (cfg.mods.base !== 'none' || cfg.mods.backbone !== 'none') && h !== '2F') {
        notes.push('The manual recommends a 2F module right above the base.');
      }
    });
    if (cfg.floors.some(f => f.layout === 'XL2')) notes.push('XL² modules: the manual does not say whether they need the L² accessories.');

    // The roof on every drawer module of the top floor
    if (cfg.roof !== 'none') {
      const roofMods = topDrawerModules(cfg);
      roofMods.forEach(mod => {
        add(`d:roof:${mod.w}${d}:${cfg.roof}`, 1, 'Roof', cfg.roof === 'heavycut' ? `${mod.w}${d} heavyweight roof, cut`
          : `${mod.w}${d} ${(ROOFS.find(r => r.id === cfg.roof) || {}).label || cfg.roof} roof`);
        if (cfg.roof === 'grid') { add('d:tophandle', 1, 'Roof', 'Top handle'); hw('M6 × 50 mm bolt', 2, 'top handle'); }
        if (cfg.roof === 'heavy' || cfg.roof === 'heavycut') { add('d:heavyhandle', 1, 'Roof', 'Heavyweight roof handle'); add('d:heavyinsert', 2, 'Roof', 'Heavyweight roof insert', true); }
      });
      const top = cfg.floors[cfg.floors.length - 1];
      if (roofMods.length && top && top.height !== '2F' && (cfg.mods.base !== 'none' || cfg.mods.backbone !== 'none')) {
        notes.push('The manual recommends a 2F module right below the roof.');
      }
    }

    // Modifications
    const mods = cfg.mods;
    if (mods.base !== 'none') {
      if (split && has(cat, `m:base:${width}${d}:part1`)) {
        add(`m:base:${width}${d}:part1`, 1, 'Base & wheels', `${width}${d} base, part 1`);
        add(`m:base:${width}${d}:part2`, 1, 'Base & wheels', `${width}${d} base, part 2`);
        add('m:baseconnector', 1, 'Base & wheels', 'Base connector', true);
      } else add(`m:base:${width}${d}:whole`, 1, 'Base & wheels', `${width}${d} base`);
      if (mods.base === 'wheels') {
        add('m:disk', 2, 'Base & wheels', 'Wheel disk');
        add('m:bushing', 2, 'Base & wheels', 'Wheel bushing');
        add('m:wheelcover', 2, 'Base & wheels', 'Wheel cover');
        add('m:tyre', 2, 'Base & wheels', 'Tyre (print in TPU)');
        add('m:jig', 1, 'Base & wheels', 'Bushing jig');
        hw(`M16 threaded rod, ${M16_BASE_ROD[width]} mm`, 1, 'wheel axle');
        hw('6205ZZ bearing (25 × 52 × 15 mm)', 2, 'wheels');
        hw('SCSAW 16 mm shaft collar (16 × 30 × 10 mm)', 2, 'wheels');
        hw('M4 × 25 mm bolt', 12, 'wheel covers');
      }
      if (mods.base === 'casters') hw('Caster with M8 thread', 4, 'base');
      if (mods.feet) { add(`m:feet:${width}`, 1, 'Base & wheels', `${width} feet`); hw('M6 × 90 mm bolt', 2, 'feet'); }
    }
    // Backbone boards along every floor: a 2F floor gets a 2F board, a 4F floor two
    const levels = [];
    cfg.floors.forEach(f => { if (f.height === '4F') levels.push('2F', '2F'); else levels.push(f.height); });
    if (mods.backbone !== 'none') {
      let boards = 0;
      levels.forEach(u => {
        if (mods.backbone === 'wide' && has(cat, `m:backbone:${width}:${u}`)) { add(`m:backbone:${width}:${u}`, 1, 'Backbone & handles', `${width}${u} backbone`); boards += 1; }
        else if (mods.backbone === 'wide' && has(cat, `m:backbone:${width}:1F`)) { add(`m:backbone:${width}:1F`, 2, 'Backbone & handles', `${width}1F backbone`); boards += 2; }
        else { add(`m:backbone:U:${u}`, 2, 'Backbone & handles', `Universal ${u} backbone`); boards += 2; }
      });
      hw('M4 bolt, 60-100 mm (fits the module)', 4 * boards, 'backbone boards');
      if (mods.pullHandle) {
        add(`m:pullhandle:${width}`, 1, 'Backbone & handles', `${width} pull-out handle`);
        if (mods.backbone === 'wide' && has(cat, `m:pulllock:${width}`)) {
          add(`m:pulllock:${width}`, 1, 'Backbone & handles', `${width} pull-out handle lock`);
          if (has(cat, `m:pulllock:${width}:2`)) add(`m:pulllock:${width}:2`, 1, 'Backbone & handles', `${width} pull-out handle lock, part 2`);
        } else add('m:pulllock:U', 2, 'Backbone & handles', 'Universal pull-out handle lock', true);
        add('m:knob:1', 2, 'Backbone & handles', 'Handle lock knob, part 1');
        add('m:knob:2', 2, 'Backbone & handles', 'Handle lock knob, part 2');
        hw('M6 × 30 mm bolt', 4, 'pull-out handle');
        hw('M6 × 35 mm hex bolt', 2, 'handle lock');
        hw('M6 × 8 × 8 heat insert', 2, 'handle lock knobs');
        hw(`M16 threaded rod, about ${towerHeight(cfg)} mm (tower height, measure before cutting)`, 2, 'pull-out handle', true);
      }
      if (mods.stationaryHandle) { add(`m:stathandle:${width}`, 1, 'Backbone & handles', `${width} stationary handle`); hw('M4 × 60 mm bolt', 8, 'stationary handle'); }
      if (mods.pegboard !== 'none') {
        const kind = mods.pegboard === 'ikea' ? 'IKEA Skådis' : 'USSA';
        levels.forEach(u => {
          const own = has(cat, `m:pegboard:${mods.pegboard}:${width}:${u}`);
          const n = own ? 1 : 2;
          add(`m:pegboard:${mods.pegboard}:${width}:${own ? u : '1F'}`, n, 'Backbone & handles', `${kind} pegboard ${width}${own ? u : '1F'}`);
          hw('M4 × 40 mm bolt', 4 * n, 'pegboards');
        });
      }
    } else if (mods.pullHandle || mods.stationaryHandle || mods.pegboard !== 'none') {
      warnings.push('Handles and pegboards attach to backbone boards: choose a backbone.');
    }
    if (mods.wallMount) {
      let cleats = 0;
      cfg.floors.forEach(f => {
        layoutOf(width, f.layout).modules.forEach(mod => {
          if (!has(cat, `m:wallmount:${mod.w}:${f.height}`)) { warnings.push(`No ${mod.w}${f.height} wall mount in the archive.`); return; }
          add(`m:wallmount:${mod.w}:${f.height}`, 1, 'Wall mount', `${mod.w}${f.height} wall mount`);
          cleats += f.height === '4F' ? 2 : 1; // one cleat opening per 1F / 2F mount, two per 4F
        });
      });
      add('m:wallmount2', cleats, 'Wall mount', 'Wall mount second part (wall cleat)');
      hw('Wall plug and screw (or wood screw)', 3 * cleats, 'wall cleats', true);
      notes.push('The manual does not list the bolts that hold the wall mounts on the tower.');
    }

    // Files added by hand
    for (const [key, q] of Object.entries(cfg.extra)) {
      const file = key.startsWith('path:') ? cat.byPath[key.slice(5)] : cat.byKey[key];
      if (!file || !q) continue;
      const row = parts.get(key) || { key, file, qty: 0, group: 'Extra files', label: file.original_name.split('/').pop().replace(/\.stl$/i, ''), estimate: false };
      row.qty += q;
      parts.set(key, row);
    }
    // Quantities changed by hand
    for (const [key, q] of Object.entries(cfg.qty)) {
      const row = parts.get(key);
      if (row && q !== row.qty) { row.auto = row.qty; row.qty = q; }
    }
    for (const m of missing) warnings.push(`Not found in the archive: ${m}.`);
    if ([...parts.values()].some(p => p.estimate) || [...hardware.values()].some(h => h.estimate)) {
      notes.push('Quantities marked as estimates are not stated in the manual: check them before printing.');
    }

    const list = [...parts.values()].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.label.localeCompare(b.label));
    const docs = cfg.docs ? cat.docs.slice() : [];
    const printed = list.filter(p => p.qty > 0);
    const size = (f) => Number(f.file_size) || 0;
    return {
      cfg,
      parts: list,
      hardware: [...hardware.values()].map(h => ({ name: h.name, qty: h.qty, note: [...h.notes].join(', '), estimate: h.estimate })),
      warnings,
      notes: [...new Set(notes)],
      docs,
      height: towerHeight(cfg),
      totals: {
        files: printed.length,
        prints: printed.reduce((n, p) => n + p.qty, 0),
        bytes: printed.reduce((n, p) => n + size(p.file), 0) + docs.reduce((n, f) => n + size(f), 0)
      }
    };
  }

  // A one-line summary: "L4 · 2F / 1F S + S / 2F · grid roof · wheels, backbone"
  function describe(cfg) {
    const floors = (cfg.floors || []).map(f => {
      const layout = layoutOf(cfg.width, f.layout);
      return layout && layout.id !== cfg.width ? `${f.height} ${layout.label.replace(/ \(.*\)$/, '')}` : f.height;
    }).join(' / ');
    const mods = cfg.mods || {};
    const extras = [
      mods.base && mods.base !== 'none' ? (mods.base === 'plain' ? 'base' : mods.base) : '',
      mods.backbone && mods.backbone !== 'none' ? 'backbone' : '',
      mods.pullHandle ? 'pull-out handle' : '', mods.stationaryHandle ? 'handle' : '',
      mods.pegboard && mods.pegboard !== 'none' ? 'pegboard' : '', mods.wallMount ? 'wall mount' : ''
    ].filter(Boolean);
    const roof = cfg.roof && cfg.roof !== 'none' ? `${{ undertable: 'under-table', heavycut: 'heavy cut' }[cfg.roof] || cfg.roof} roof` : '';
    return [`${cfg.width}${cfg.depth}`, floors, roof, extras.join(', ')].filter(Boolean).join(' · ');
  }

  // Plain-text parts list for the ZIP and the clipboard
  function bomText(bom, title) {
    const cfg = bom.cfg;
    const lines = [`${title || 'VAULT'}: parts list`, describe(cfg), ''];
    lines.push(`Floors, bottom to top: ${cfg.floors.map((f, i) => `${i + 1}. ${f.height} ${(layoutOf(cfg.width, f.layout) || {}).label || f.layout} (${f.slots.map(s => s.type === 'sustainer' ? `sustainer, ${s.interior}` : `drawer ${s.boxes}${s.interior !== 'empty' ? `, ${s.interior}` : ''}`).join(' | ')})`).join('; ')}`);
    lines.push(`${bom.totals.files} files, ${bom.totals.prints} prints. * = estimated quantity`, '');
    let group = null;
    for (const p of bom.parts.filter(r => r.qty > 0)) {
      if (p.group !== group) { group = p.group; lines.push(`## ${group}`); }
      lines.push(`${String(p.qty).padStart(3)} x${p.estimate ? '*' : ' '} ${p.file.original_name}`);
    }
    lines.push('', '## Hardware to buy');
    for (const h of bom.hardware) lines.push(`${String(h.qty).padStart(3)} x${h.estimate ? '*' : ' '} ${h.name}${h.note ? `  (${h.note})` : ''}`);
    if (bom.docs.length) { lines.push('', '## Instructions'); bom.docs.forEach(f => lines.push(`      ${f.original_name}`)); }
    const notes = [...bom.warnings, ...bom.notes];
    if (notes.length) { lines.push('', '## Notes'); notes.forEach(n => lines.push(`- ${n}`)); }
    return lines.join('\n') + '\n';
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
    WIDTHS, DEPTHS, HEIGHTS, LAYOUTS, BOX_SPLITS, ROOFS, DRAWER_INTERIORS, SUSTAINER_INTERIORS, BASES, BACKBONES, PEGBOARDS, GROUPS, TIPS,
    classify, buildCatalog, detect, slotsOf, choices, defaultConfig, newFloor, defaultSlot, normalize, towerHeight,
    computeBom, describe, bomText, encodeConfig, decodeConfig
  };
})();
