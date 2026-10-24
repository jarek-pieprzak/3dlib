# 3DLib - ideas

Ideas kept from the GyroidVault roadmap (reviewed 2026-10-22), plus my own. Nothing here is
planned yet; each one gets discussed before work starts.

## Library and UI

- **Module switches in Settings:** hide what I do not use (categories, collections, tags,
  favorites, Folder Explorer, statistics, print history, sharing, printers) in the sidebar,
  toolbar, cards, model page and bulk bar.
- **Start page:** choose what opens first (All Models, Folder Explorer, Collections) instead of
  the Dashboard.
- **Card density:** compact / comfortable / large cards, and switches for what a card shows
  (format badges, size, file count).
- **"Uncategorized" and "Untagged" filters:** find unsorted models in one click and sort them
  with the bulk bar.
- **Collection badges on the model page:** clickable, next to the category and tags.
- **3MF object tree:** show and hide single objects and parts in the 3D preview. Colours from
  Bambu Studio / OrcaSlicer and the plate selector are done; `3MFLoader.js` already knows the
  objects and parts.

## Kit configurators

- **Hero Me Gen7 (built 2026-10-24; see CLAUDE.md).** Project "HeroMe" (`/library/HeroMe`, id
  153 on the NAS) is the Hero Me Gen7 printhead platform by MediaMan3D: one base with swappable
  parts. Its files will not change. A configurator like the USSA VAULT one.
  - Releases are folders of their own and stay apart: 7.0 (`HMG7 Release V1.0`, 293 STL), 7.3
    (`Hero Me Gen7 Release 3`, 405), 7.4 (`Hero Me Gen7 Release V4`, 600; cumulative, it holds
    the newest files of 7.0-7.4) and the Magnet Edition (`HMG7 Magnet Edition V1`, 41: a
    magnetic base and its gantry adapters, the other parts from 7.0). A configuration picks the
    release (default 7.4) and only that folder's files. Changing the release maps the choices
    by name (`normalize`), with a note where a part has no counterpart.
  - Rules from the PDFs (`Preliminary Gen7 Parts Selection and Assembly Instructions.pdf`, the
    7.3 / 7.4 Read Me First, Change Log and Printer-Component Support). Needed: 1 base, 1 gantry
    adapter (+ its clip or X carriage parts), 1 hotend mount, its skirt, 1-2 part cooling ducts,
    1 cable tower. Optional: ABL wing + mount (left or right), direct drive extruder mount
    (front / rear / mirror) with 0-2 risers (4, 6, 10 mm), collar spacer (1-2.5 mm) for collar
    hotends, Bowden hotend standoff, fan guard, ADXL345, LED, endoscope. The 56-page selection
    guide is paid (Patreon) and not in the folder, so the pairs come from the file names.
  - Steps, each offering only what fits: printer -> gantry adapter; hotend -> mount, skirt and
    duct height (Standard; Tall for Volcano / Rapido UHF; Long for Vyper / Kobra / Neptune 3 /
    Micro Swiss DD); fans (4010 / 4020 / 5015 / 5020, one or two) -> duct design (Gen7 left /
    right ducts, Gen6 single / dual / lightweight forward, 5015 centered); ABL sensor -> wing,
    mount, side; extruder (none = Bowden) -> mount, risers; cable tower; options.
  - Special setups: Neptune 3 Pro / Plus / Max STOCK (a shroud of its own without the base, only
    ADXL345 options), the Seckit SK-GO, DropEffect and Switchwire Afterburner bases, the linear
    rail Box X carriages (sets of 8-12 parts, MGN9-H / MGN12-C / MGN12-H, their own 5015 ducts),
    the Sovol SV06-Plus extruder mount (parts A, B, C).
  - Counts: nearly every part is printed once (the STL files have one body each; belt clips
    hold a pair). A Gen6 "dual" duct is both sides in one print (joined by a brace). Hardware:
    the fans the choices need, M3 threaded inserts and screws as estimates (the PDFs count them
    only for the Neptune 3 shroud: 10 inserts, 14 screws).
  - Code: a kit registry instead of `VaultKit` alone (`detect`, `buildCatalog`, `normalize`,
    `computeBom`, `describe`, `bomText`, ...; `models.kit_archive` already holds the kit id).
    `public/js/kits/hero-me-gen7.js` (`HeroMeKit`, pure functions): the release is the top
    folder, parts are recognised by name. Saved configurations, their ZIP, print progress,
    the counters and `kit_progress` on the cards stay the same code. The archive becomes
    read-only like VAULT. The tests get a fixture of every file name and size
    (`tests/fixtures/hero-me-gen7-files.tsv`).
  - UI: the steps as a form, the parts list as in VAULT, a 3D preview of the clicked part. The
    printhead in 3D is put together from the real STLs: the files do not say where the parts
    sit, so `scripts/hero-me-poses.js` finds it from their mounting holes (see CLAUDE.md).
  - Default configuration: a stock Ender 3 V2 (its gantry adapter, the Creality OEM hotend
    mount and skirt, Bowden, two 5015 fans with the standard ducts, no ABL, a standard cable
    tower). Not my own printer's setup.
  - Later, a topic of its own: my Ender 3 V2 becomes a pen plotter with these parts (pen plotter
    mounts in `Options/Pen Mounts` of 7.4).

## Print tracking (to be discussed)

My own rules, not the old Kanban idea ("to print / printing / printed / assembled").

- **Parts list per project (built 2026-10-23; see CLAUDE.md).** The USSA VAULT configurator
  has one; other models often come without instructions, so this list is made by hand.
  - A "Parts" tab on the model page next to Files / Documentation, for any project, read-only
    ones too (the list lives in the database, not in the files). It shows the list with
    progress; "Edit list" switches to editing, Save / Cancel go back (like "Edit
    configuration" of VAULT). "Add all 3D files, 1 each" to start.
  - Rows: files of the project with how many to print; hardware with a name, how many and a
    "have it" tick (screws, magnets, bearings); notes.
  - Printed or not: from the print history with the part's file, like the VAULT configurations
    (− / n of qty / + per part, a click on the count shows its prints, "done of total" bar,
    Mark all printed, Reset progress; failed prints do not count). Later the printer's MQTT
    status can add these entries by itself.
  - Progress on the model cards, like `kit_progress` of configurations.
  - "List as text" and "Download ZIP" (the files of the list and the list, by the selection
    download of VAULT).
- **Status from the printer, if it can be done:** Bambu printers (P1S) report the print status
  (started, progress, finished) over MQTT on the local network, with LAN-only / Developer mode
  and the access code. That could mark files as printed by itself; without it, marking stays
  manual. No separate printer monitor (camera, temperatures).
- **Filament:** Spoolman has a REST API (spools with material, colour and what is left): pick
  the spool when logging a print and take off the filament the G-code / 3MF says it uses. The
  AMS slots (type, colour; what is left only for Bambu RFID spools) come over the same MQTT
  connection. Community tools already sync AMS with Spoolman, so 3DLib may only need Spoolman.
