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

## Print tracking (to be discussed)

My own rules, not the old Kanban idea ("to print / printing / printed / assembled").

- **Parts list per project (agreed 2026-10-23, next to build).** The USSA VAULT configurator
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
  - Later: the list as text, "Download ZIP" of the listed files only (the selection download
    of VAULT).
- **Status from the printer, if it can be done:** Bambu printers (P1S) report the print status
  (started, progress, finished) over MQTT on the local network, with LAN-only / Developer mode
  and the access code. That could mark files as printed by itself; without it, marking stays
  manual. No separate printer monitor (camera, temperatures).
- **Filament:** Spoolman has a REST API (spools with material, colour and what is left): pick
  the spool when logging a print and take off the filament the G-code / 3MF says it uses. The
  AMS slots (type, colour; what is left only for Bambu RFID spools) come over the same MQTT
  connection. Community tools already sync AMS with Spoolman, so 3DLib may only need Spoolman.
