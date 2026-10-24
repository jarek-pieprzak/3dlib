# 3DLib - notes for Claude

3DLib is my self-hosted 3D model library, a private fork of
[TeeCodeDev/GyroidVault](https://github.com/TeeCodeDev/GyroidVault) renamed at v1.0.0. It runs on
my TrueNAS. I am the only user and the only developer. The license stays AGPL-3.0, and the About
page and footer credit GyroidVault; keep that.

## How we work

- Talk to me in Polish. Code, comments and commit messages are in English.
- **Never commit and never push.** When a change is ready, tell me and propose a commit message.
  I review the diff, commit and push myself, straight to `main`.
- Git identity for this repo is `Jarek Pieprzak <jarekpiep@gmail.com>` (set in the repo config).
  Never use my work identity (`...@arteia.com`).
- Remotes:
  - `origin` = `jarek-pieprzak/3dlib` (private; `gyroidvault-custom` before the rename). The only
    repo that gets pushes.
  - `upstream` = TeeCodeDev/GyroidVault. Fetch only; its push URL is `DISABLED` on purpose.
    Never push to it and never open PRs there unless I ask.
- Keep answers short; show me at most the next 2 steps.
- Ask before starting anything big or ambiguous. Small, clear fixes: just do them.

## Run and test

- `npm ci`, then `npm test` (= `node tests/release-check.js`). It must stay green. It includes
  syntax checks, an AST scope scanner, UI template rendering and end-to-end API tests on a
  temporary data dir and library.
- The AST scanner flags identifiers used before their declaration (TDZ) and undeclared globals.
  Example: write `const css = window.CSS` instead of a bare `CSS.supports(...)`.
- `npm run dev` starts the server with `--watch`. Useful env vars: `PORT`, `DATA_DIR`,
  `LIBRARY_PATH`, `NODE_ENV`.
- Add a test to `tests/release-check.js` for server behaviour you change (scanner, access rules).
- For UI work, check the page in a browser at desktop width (1440x900) and narrow (820px).
- `*.3mf` in the repo root is git-excluded locally (`.git/info/exclude`); those are my test files.

## Deploy (TrueNAS)

- A push to `main` runs `.github/workflows/custom-image.yml`. It runs the tests, then builds
  `ghcr.io/jarek-pieprzak/3dlib:latest` (amd64; the name is fixed in the workflow, not taken from
  the repository name). Images before the rename were `ghcr.io/jarek-pieprzak/gyroidvault-custom`.
- TrueNAS app `lib3d` (app names must start with a letter; custom YAML app,
  `pull_policy: always`, port 3457, data `/mnt/tank/3dlib`,
  library `/mnt/tank/media/Modele3D` mounted at `/library`). The mount must be read-write: the
  app renames, moves and purges files there (otherwise 503). Before the rename the app was
  `gyroidvault` with data in `/mnt/tank/gyroidvault`.
- **To deploy a new image: Apps -> lib3d -> Edit -> Save.** Restart does NOT pull the image.
- Then Ctrl+F5 in the browser. After scanner changes: Scan Library in the app.
- Script tags in `public/index.html` have a `?v=N` cache buster; bump it when JS changes a lot.

## Code map

- Login tokens last 30 days, so `userFromToken` (`server/middleware/auth.js`, used by
  `authenticate` and the gatekeeper) reads the account and its role from the database on every
  request: a demoted or deleted user loses the rights at once, and a model unlock token (same
  secret) is no login. A new password (profile or reset) raises `users.token_version` (`tv` in
  the token): every other session is logged out, the one that changed it gets a new cookie. API
  keys (no csrfToken) are not affected.
- Backend: Node/Express, sql.js (SQLite in memory, saved to disk). `server/index.js` (security
  middleware, gatekeeper, static routes), `server/routes/*.js`, `server/utils/*.js`,
  `server/database.js` (schema + migrations via `ALTER TABLE ... ADD COLUMN` checks). The database
  file is `<data>/3dlib.db`. sql.js reopens the database on every save (`db.export()`), dropping
  pragmas and SQL functions; `prepareConnection` sets them again.
- Names with Polish letters (`server/utils/names.js`): SQLite's LIKE, LOWER() and ORDER BY know
  only A-Z, and `localeCompare()` without a locale follows the server's (POSIX in Docker: "Zebra"
  before "apple"). Searches: `fold(column) LIKE fold(?)` (case and accents ignored, "lozysko"
  finds "Łożysko"); logins: `ulower()`; name order: `ORDER BY sortkey(name)`; in JS
  `compareNames` (Polish alphabet, numbers by value). The browser has `UI.foldText` and
  `UI.compareNames`. The test server runs with `LC_ALL=C`, like the image. Names that differ only
  in case are one name: tags (`tagIdFor` in `modelHelpers.js` for every tag given by name),
  categories, materials, user names and emails, model names and folders (409 / "taken").
- Download headers with a file name: `contentDisposition()` (`server/utils/modelHelpers.js`).
  Node refuses a header with "Ł" or "ś" (500); `res.download` / `res.attachment` are fine.
- Frontend: vanilla JS, no build step. `public/js/api.js` (API client), `public/js/components.js`
  (`UI.*` HTML templates), `public/js/app.js` (`App.*` router and handlers), `public/js/viewer.js`
  (three.js r138 viewer), `public/js/vendor/*` (three.js loaders, 3MFLoader is patched).
- Inline `onclick="App.x(...)"` handlers are the norm; the test suite checks that every
  referenced `App.*` and `API.*` exists.
- Escape anything from the library or users with `UI.escapeHtml` (file names, folder names, tags).
  A string argument of an inline handler goes through `UI.jsArg` instead, without quotes around
  it: `onclick="App.browseTo(${UI.jsArg(path)})"`. `escapeHtml` inside `'...'` is not enough there
  (the browser turns `&#39;` back into `'` before it runs the code).

## Library layout rules (server/utils/library.js)

- Everything directly in the library root is a project (model):
  - a loose model file (STL, 3MF, G-code, ...) is one project; same-named images and documents
    next to it join it (`Benchy.3mf` + `Benchy.jpg`); the model's `library_path` is the file
    itself;
  - a folder is one project with its whole subfolder tree. File names keep their path relative
    to the folder (`Gantry Adapters/3DFused/spacer.stl`) and the model page shows a collapsible
    tree.
- Every file of a project folder is indexed. Unsupported ones become `other` (info-only rows);
  system clutter (`.DS_Store`, `Thumbs.db`, `desktop.ini`, dotfiles) is skipped.
- Models that older scans created inside a project folder are merged into it (tags, collections
  and print history move along).
- Files that disappear from disk are purged after a scan; a missing `/library-files/...` path is a
  real 404, never the SPA page.
- Nothing is purged while the library folder is missing or empty: an unmounted share would
  otherwise wipe the index (`server/utils/libraryHealth.js`, used by the scan and the hourly
  sync). The sync removes a model without files only when its folder is gone from disk; the
  scan's cleanup of document-only folders (#78) removes only scanner models nobody touched (no
  user, tags, collections, prints, category or description).
- A file replaced on disk keeps its row (and id); a scan updates its `file_size` when it changed,
  so the printer fit check measures it again and a preview the viewer rendered of it is dropped.
  To update an archive, overwrite files in place; deleting the folder first lets the hourly sync
  purge its files and the then empty model.

## What the fork adds (newest first)

- Hero Me Gen7 configurator (`public/js/kits/hero-me-gen7.js`, `window.HeroMeKit`; pure functions,
  the tests load it too). Kits are a registry now: `server/utils/kits.js` `KITS` / `kitIdOf`
  (`models.kit_archive` holds the kit id, `kit_source.kit` on a configuration's page), in the
  browser `App.kitLibs()` / `App.kitLib()`, `this.kit.kitId` / `this.kit.lib`; saved
  configurations, their ZIP, progress and counters are the same code for both kits.
  - The project (`HeroMe` on the NAS) holds four releases, one folder each: 7.4 (`Hero Me Gen7
    Release V4`, cumulative), 7.3, 7.0 (`HMG7 Release V1.0`) and the Magnet Edition (its base and
    gantry adapters; the other steps come from 7.0, `partsFrom`). A configuration picks the
    release (`cfg.release`) and only that folder's files. The release is the top folder, the
    category the folder under it (Base, Gantry Adapters, Hotend Mounts, Part Cooling Ducts, ABL
    Mounts...), parts are recognised by name. `tests/fixtures/hero-me-gen7-files.tsv`: the 1364
    files of the real project (2026-10-24); every STL of every release has a place.
  - Steps: release, printer (gantry adapter + the files of its folder that go with it,
    `autoGantryExtras`: contained printer words, else shared words; Box X carriage sets),
    base, hotend mount + skirt (`bestSkirt`: shared words, the start of the name first) + cap +
    collar spacer (1 mm for collar mounts) + Bowden standoff, part cooling (fans 1 / 2, size,
    height: long for Vyper / Kobra / Neptune 3 / MSDD, tall for Volcano / Rapido Plus; Gen7
    left + right ducts, a Gen6 "dual" duct is both sides in one print), ABL (sensor family, side,
    mount, wing, spacers; the cable tower goes on the other side), extruder mount + risers,
    cable tower, ADXL345, options. "Auto" shows what the kit picked; ticked lists keep hand
    picks with `<field>Of` (another adapter or sensor starts automatic again).
  - Another release maps a choice to the nearest name (`closest`; 7.0's "OEM-MK8-MS" is the
    Creality OEM mount) with a note; the configuration keeps the asked id, so back in its
    release the part is chosen again (`choices().ids` say what the lists show).
  - The stock Neptune 3 Pro / Plus / Max shroud (`Gantry Adapters/Elegoo Neptune/...STOCK`) is
    a setup of its own: no base, hotend, ducts or tower; 2 × 5015, 10 inserts, 14 screws (its
    PDF). Insert and screw counts elsewhere are estimates (the joints the 7.0 instructions name).
  - The instructions (`bom.manuals`): the release's PDFs and the documents next to the chosen
    parts (Beacon3D readme, Neptune PDF...). The 56-page selection guide is paid, not in the
    folder.
  - The printhead in 3D (`public/js/kits/hero-me-gen7-3d.js`, `window.HeroMe3D`, like
    `VaultKit3D`), from `bom.head` (`headOf`: each part with its file ids and what its name
    says: side, wing reach, front / rear stepper, riser and tower heights; `head.src`: file id
    -> path, size, url). The bed is y = 0 with the nozzle on it, x the printer's X, z to the
    front.
  - It is put together from the project's own STLs (`buildReal`; `planReal` is the plan
    without three.js): `public/js/kits/hero-me-gen7-poses.json` gives each file a turn `m` (3×3,
    rows), a shift `t` and its box in that frame, made offline by `scripts/hero-me-poses.js
    <the HeroMe folder> [out.json]` (~75 s; run it again only if the files change). The script
    finds the M3 holes, slots and bores of each STL and puts it on Hero Me's mounting patterns
    of the 7.4 Universal Base V2: the 30 mm pair on top (hotend mounts), 22 mm below (skirts),
    the 32 × 12.4 rectangle at the back (gantry), the rear 18 mm pairs on the sides (cable
    towers, ABL wings); parts that sit on another (clips, sensor mounts) get a place per
    parent (`on`). ADXL345 mounts go under the front of the base, on the 14 mm pair of
    inserts every skirt has (the "Spacer for Skirt Mount" options go between) or on the
    "6Deg-ADXL" duct, never below the nozzle; `board` ({ p, n }, in the mount's own frame) is
    where the board sits: the open ends of the mount's other pair of holes. (The base's own
    14 mm pair at the front, behind the heat sink fan, is not theirs.) Ducts are turned walls
    to the side and scored: as
    many slots as possible on side holes (a Gen7 duct has two slot columns 22.5 mm apart, like
    the base's two hole columns; on one only it sat 22.5 mm too far forward), outlet by the
    nozzle, the fan's ring outside, nothing in the hotend's column or behind the base; a left /
    right pair placed unlike each other is fitted again, one like the other. The Read Me First
    photos (7.4) and the Neptune PDF's bottom view are the reference: the fans beside the
    base's front, the outlets centred front to back under the nozzle.
    Risers and extruder mounts are stacked at run time on the mount's `top` (+ `height`). A
    standing motor plate (BMG, Titan, Creality...: a 22-28 mm round opening facing the side
    or the back) gets `motor` ({ p, n }: the opening, the side away from the hotend): the
    stepper is drawn there, the extruder on the plate's other side; a flat mount (Orbiter,
    Sherpa) has them on top.
    A pose is used only when the file's size matches (a changed file falls back). Hotend,
    stepper and extruder, sensor, ADXL board and carriage are drawn shapes; fans are not drawn
    at all (not wanted). A duct without a place ("Centered" Gen6 ducts) is drawn as a shape.
    No place: Magnet Edition adapters (no M3
    rectangle), some gantry extras and ABL mounts; the hint under the panel names them.
    Without a placed base (the stock Neptune shroud) the old model of shapes is drawn (`build`).
  - The page fetches the poses once (`App.kitHeroPoses`, `?v=` in the URL) and keeps loaded
    STLs (`App.kitLoadStl`); each file shows as a see-through box until it is in. Hover lights
    a part and its rows (`App.kitHoverPart`), a row lights its part (`kitHoverFile`), a click
    opens the part in the 3D Studio ("Show the printhead"). Saved configurations get it as
    their cover (`kitRenderCover`, waits up to 8 s for the STLs). Without WebGL the first part
    opens instead.
- Parts list of any project (the "Parts" tab of the model page; `UI.partsTab` / `partsEditor`,
  `App.parts*`): files of the project with how many to print, hardware (name, how many, "have
  it"), notes, in `models.parts_list` (JSON; `PUT /api/models/:id/parts-list`, an empty list
  removes it; read-only projects too, a configuration has its kit's list). Progress works like
  the VAULT configurations: `kits.hasParts` / `refreshNeeds` turn the list into `kit_needs`, so
  the counters, "Mark all printed" (`prints/fill`), "−" and Reset (`prints/parts`) and
  `kit_progress` on the cards are the same code.

- Renamed to 3DLib, version 1.0.0. Logo `public/img/logo.svg` (an isometric cube printed in
  layers); `favicon.png`, `favicon.ico` and `icon.png` in `public/` are rendered from it with sharp.
  No upstream update check, "What's new" window, website or Ko-fi links;
  `GET /api/system/version` gives the footer and About page the version from `package.json`.
  Internal names use `3dl`: localStorage `3dl_*`, events `3dl:*`, cookies `3dl_token` (login) and
  `3dl_unlock`, slicer links `_3dl-<token>`. The code that carried over the old names (database
  file, cookies, localStorage keys) was removed once everything had moved.
- USSA VAULT configurator (`public/js/kits/ussa-vault.js`, `window.VaultKit`; pure functions, the
  tests load it too):
  - A project whose files are the VAULT archive (`VaultKit.detect`: the three top folders and 40+
    known parts) opens in the configurator; the "Files" tab (`#/models/:id?view=files`) is the usual
    model page. From the Trash it always opens as files.
  - Parts are recognised by normalised name patterns (`classify`), never by paths; the app never
    changes the archive. The test covers every STL of the real archive (`tests/fixtures/ussa-vault-files.tsv`:
    its 751 file names and sizes: the archive of 2026-10-21, `261021_VAULT_USSA_S.zip`, plus the
    three older Gridfinity baseplates and `03_Sustainers Assembly.pdf` that it dropped and that stay
    in my folder). M4 drawers have a second set of baseplates ("M4 Gridfinity Baseplate ..."); the
    names every family uses win.
  - `computeBom(catalog, config)`: files with print counts, hardware, notes. A count is prints of a
    file: springs, geared rails, rods, bottom hinges and the L-XL hinge top hold a pair; runner
    guides and slides are single parts since the 2026-10 archive (two per box). S and M sustainers
    have one lock and one hinge top (L and XL two). L² / XL² are one L / XL module with two drawer
    columns (S+S / S+M). Where the PDFs say nothing, the STL files decide (the archive is on the
    NAS share `Z:\Modele3D\VAULT_USSA`): facade bolts are the holes (S 2 / 4 / 4, M and L
    4 / 6 / 6, XL 4), sustainer dividers and seal dividers are a full set of the module's slots
    (`DIVIDER_SLOTS`, `SEAL_SLOTS`; the 3D tower draws the same counts, with the hinges, rods and
    runners of the list), every grid divider strip ends in a straight edge piece at the
    wall (4 for the cross). Counts the PDFs do not give are marked "estimate"; parts they do not
    show at all (grid divider pins, rounded edge pieces) are "optional" rows with 0 prints when
    Grid dividers is chosen, hidden on a locked configuration until counted. Manual supports
    (`x3`-`x7`, triangular braces) go with the parts printed standing: grid, table, bowl and
    under-table roofs and whole sustainer lids. Every count can be changed by hand. Roof `heavycut`
    (`XLn Heavyweight Roof Cut`, the heavyweight roof cut to fit a 350 × 320 bed) is a roof choice
    of its own, XL only.
  - `normalize` checks a configuration against the archive (unavailable choices fall back, with a
    note). The configuration lives in the URL (`?c=` base64url JSON, `history.replaceState`) and in
    localStorage `3dl_kit_<model id>`.
  - Saved configurations are models of their own (`server/utils/kits.js`): no files and no
    folder, `models.kit_source_id` = the archive's model, `models.kit_config` = the choices (JSON).
    Listed, searched, tagged, protected and trashed like any model; their ZIP is the parts of the
    archive plus the parts list (a collection ZIP gets the parts list only); they cannot be
    shared. `/api/models/:id/kit-configs` (archive id; `server/routes/kitConfigs.js`) lists,
    creates, renames and trashes them; `PUT /api/models/:id/kit-config` saves the choices from the
    configuration's own page. The old `kit_configs` table was migrated into models and dropped.
  - The server loads `VaultKit` too: after each scan (and at start) `kits.refreshArchives()` sets
    `models.kit_archive` on a recognised archive and makes it read-only, once.
  - UI: the archive's configurator is a draft ("Save as configuration..." creates the model and
    opens it; its list opens saved ones). A configuration's page (`App.renderConfigPage`,
    `kit.mode` 'view' / 'edit') loads the archive's files: locked it shows only the parts list
    (Open in slicer per file, the configuration ZIP) and the preview; "Edit configuration" in the
    header brings the builder (`?edit=1&c=`), Save / Cancel go back. Its cover is the 3D tower
    (`App.kitRenderCover`, `VaultKit3D` `snapshotParts`).
  - The tower drawing (`UI.kitDrawing`) has a chain of heights (lift, base, every floor, lip +
    roof) and the whole height with the roof, and a list of them beside it (under it in a
    panel under 560 px: container query). Heights from the archive's files: 48 mm per F in the
    stack (a printed module is 9 mm taller: its lip), base 52, roofs grid 10, table 14, bowl
    21, under-table 20, heavyweight 87 mm (in their files turned 45°); lifts are estimates.
  - Print progress of a configuration: print history entries with the part's file
    (`print_history.file_id`, a file of the archive). The locked parts list has a counter per
    part (− / n/qty / +, a click on the count opens that part's prints and a form with
    details), a bar "done of total" with Mark all printed (`POST .../prints/fill`) and Reset
    progress (`DELETE .../prints/parts`, `?file_id=` undoes one). Failed prints do not count.
    `models.kit_needs` ({ file id: count }, `kits.refreshNeeds` on save and page load) lets the
    model list show `kit_progress` on the cards.
  - Open in slicer for a file with versions in a read-only project opens the chooser
    (`UI.slicerChooser`, `App.openSlicerChooser`): the original or a version, a table of their
    settings and changes, name / pin / delete per version.
  - "Download ZIP": `POST /api/models/:id/download-selection` (CSRF, the access rules of the model
    ZIP) keeps the file ids and the parts list under a 15-minute token
    (`server/utils/downloadSelections.js`, memory only); `GET .../download-selection/:token` streams
    them, for the user who asked only. Viewers cannot save configurations or prepare this download
    (all their writes are refused).
- Streamed ZIPs (`server/utils/zipStream.js`, yazl): model, collection and selection ZIPs are read
  from disk one file at a time, entries stored, exact Content-Length, ZIP64 past 4 GB. Entries come
  from `zipEntriesForFiles` (`server/utils/modelHelpers.js`); collection ZIPs have one folder per
  model with its subfolders. The access rules of model ZIPs are `zipAccessError`
  (`server/routes/models.js`). The model page loads a 3D file over 50 MB
  (`Viewer.MAX_AUTO_PREVIEW_BYTES`) only after a click.
- Browser memory: card images go through `/thumbs?w=&u=` (`server/routes/images.js`, sharp,
  WebP cached in `<data>/cache/img`, same password rules as `/library-files` via
  `protection.blocksStatic`; outside `/api` because of its rate limit). Card previews of 3D files
  render only when the card is on screen, one at a time (`Viewer.generateThumbnails`); Folder
  Explorer stores them as file thumbnails (`POST /api/files/:id/thumbnail`). Leaving a model
  page disposes its scene and WebGL context.
- Light theme fixes and transparent covers: active nav items, the 3D scene (background, grid,
  toolbars; `3dl:theme` event re-colours open viewers) follow the theme. Covers rendered by the
  viewer (`Viewer.renderCover`, `takeSnapshot`) are transparent PNGs without the grid. Settings
  -> Maintenance -> Regenerate Covers re-renders, in the browser, the viewer covers (upload
  names `<ms>-<16 hex>.png`) and missing STL/3MF covers (`GET /api/covers/pending`).
- 3MF colours from BambuStudio / OrcaSlicer (patched `3MFLoader.js`, `applyFileColors`):
  filament colours from `Metadata/project_settings.config`, the filament of each object / part
  from `model_settings.config`, painted triangles from `paint_color` (split triangles on a colour
  border get the colour covering most of them). The viewer's multicolour swatch ("Colours from
  the file") is on by default for such files and switches the tinted studio lights to white.
- Slicer round trip and file history:
  - Every file has a random `files.slicer_token`; "Open in slicer" links end with
    `<ascii name>_3dl-<token>.<ext>` (Bambu decodes the link, so no spaces or %-signs).
  - The slicer's save folder is `<library>/.slicer-saves` (dot folders are never scanned).
    `server/services/slicerSaves.js` checks it every 30 s: a file identical to what a link sent
    (`slicer_downloads` hashes) is only the download; a changed file matched by its token
    replaces the library file `slicer_quiet_minutes` (default 5) after the last save. Copied,
    never moved. An STL saved as 3MF adds `<name>.3mf` next to it as the main file; a loose
    root file first becomes a folder of its name. Unmatched saves wait on `#/slicer-saves`.
  - Copies of one file (`x_3dl-t.3mf`, `x_3dl-t(2).3mf`: Bambu adds "(2)" when the old copy is
    still there) are imported oldest first; `files.slicer_saved_at` keeps an older save from
    replacing a newer one ("superseded"). Spent copies (download / imported / superseded) go at
    once when a newer copy exists, else after `slicer_cleanup_days` (default 1); "Clean up now".
  - The replaced content goes to `<project>/.versions/<file path>/<timestamp>.<ext>`
    (`file_versions`, `server/utils/fileVersions.js`, keep `file_versions_keep`, default 10,
    pinned versions besides); the file's "..." menu shows History (preview, restore, delete).
  - Read-only projects (`models.is_readonly`, Edit; the VAULT archive automatically): nothing
    in the app changes their files (fs menus, file and model delete, Folder Explorer, upload,
    rename, restore: 409, `projectFiles.assertWritable` / `assertPathWritable`). A slicer save of
    one of their files never replaces it: `fileVersions.addVersion` adds it to the file's
    history with what it is set up with (`server/utils/slicerSettings.js` reads only
    `project_settings.config`, `model_settings.config`, `slice_info.config` and the build items:
    `file_versions.summary`) and what changed from the version before (`changes`). A save set up
    like an earlier version (`settings_key`) is not kept twice. Versions have a `label` and
    `pinned` (`PUT /api/files/:id/versions/:vid`), a plate picture (`.../thumbnail`); a slicer
    link to a version is `.../versions/:vid/file/<name>_3dl-<token>.3mf` (download recorded).
- Trash and file operations on disk:
  - Delete (model, file, folder, Folder Explorer, bulk) only sets `deleted_at` on `models` /
    `files`; the file stays where it is. Trashed rows are hidden everywhere (lists, search,
    counts, collections, dashboard, ZIPs, shares, Folder Explorer) except the Trash: sidebar page
    `#/trash`, the model's Trash tab (with preview) and `#/models/:id?trash=1`.
  - Restore clears the flag; a scan never restores. After `trash_retention_days` (Settings ->
    General, default 30, 0 = never) the hourly sync purges from disk (`server/utils/trash.js`).
  - Model page "..." menus: rename, move, new folder, delete (`/api/models/:id/fs/*`,
    `server/utils/projectFiles.js`). Renaming a model in Edit renames its folder, or a loose file
    with its same-named companions. Names must be valid on SMB; conflicts are 409.
  - The file tree is fully open unless it does not fit the list; then all folders start closed.
- Password-protected models (`models.is_protected` column; the UI says "Password protected"):
  - Marked in Edit or with the bulk action bar ("Protect").
  - In lists: lock badge and a permanently blurred thumbnail.
  - The admin sets the password in Settings -> Security (bcrypt hash in `system_settings`
    `protection_password_hash`, never sent to the client).
  - Every opening asks for the password. `POST /api/models/:id/unlock` returns a token, kept in
    memory and sent as `X-Model-Unlock`, plus a `3dl_unlock` cookie for file requests. The cookie
    is cleared when the page leaves the model.
  - `server/utils/protection.js` guards `/library-files`, `/uploads`, file stream/download/3mf and
    the model ZIP. The cover thumbnail stays reachable. Slicer links carry `?unlock=`.
  - Password inputs are `type="text"` masked with CSS (`.masked-input`) so Chrome does not offer
    to save them.
- Model page:
  - Clicking a file row previews it: 3D (STL, 3MF, STEP, OBJ), G-code, image (zoom/pan),
    video, PDF (browser viewer), TXT/MD/SCAD as text.
  - Files tab = all files as a tree; Documentation tab = PDF/TXT/MD only.
  - The project README is shown in the description section. Collapsed it takes at most 25% of the
    window; Expand (or a click on the README row) gives it the whole column and switches the 3D
    preview off.
  - On wide screens the page is one window tall; only the file list scrolls.
  - Print history opens in a modal from the header.
- Bambu Studio / OrcaSlicer multi-plate 3MF: one build plate at a time with a plate selector
  (`3MFLoader.js` reads `Metadata/model_settings.config` and resolves `p:path` components).
- `.github/workflows/custom-image.yml`: private image for TrueNAS.

## Known gaps / ideas

Feature ideas are in `TODO.md`.

- Collections marked "private" do not hide their models from the model list, search or the
  dashboard, and `/library-files` does not check collection privacy. Only matters with more
  than one account.
- Slicers fetch files without browser cookies, so with "Private instance mode" on, "Open in
  slicer" links fail (upstream behaviour).
