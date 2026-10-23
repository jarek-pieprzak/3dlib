const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const { DATA_DIR, DB_PATH, UPLOADS_DIR } = require('./config');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let db = null;

// Save database to disk periodically and on changes
let saveTimeout = null;
let isSaving = false;

function saveDb(sync = false) {
  if (!db) return;
  
  if (sync) {
    try {
      const data = db.export();
      db.run('PRAGMA foreign_keys = ON');
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      console.log('✓ Database written synchronously (shutdown).');
    } catch (err) {
      console.error('CRITICAL: Failed to write database during shutdown:', err);
    }
    return;
  }

  // Debounce regular saves
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (isSaving) {
      saveDb(); // Retry later if already saving
      return;
    }
    isSaving = true;
    try {
      const data = db.export();
      db.run('PRAGMA foreign_keys = ON');
      fs.writeFile(DB_PATH, Buffer.from(data), (err) => {
        isSaving = false;
        if (err) console.error('CRITICAL: Failed to write database asynchronously:', err);
      });
    } catch (err) {
      isSaving = false;
      console.error('CRITICAL: Failed to export database:', err);
    }
  }, 1000); // 1-second debounce
}

// Graceful shutdown hooks to prevent corruption
process.on('SIGINT', () => {
  saveDb(true);
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveDb(true);
  process.exit(0);
});

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // ─── Schema ──────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      preferred_slicer TEXT,
      password_reset_token TEXT,
      password_reset_expires DATETIME,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_invites (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      thumbnail TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_models (
      project_id INTEGER NOT NULL,
      model_id INTEGER NOT NULL,
      PRIMARY KEY (project_id, model_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY, -- Unique slug/token
      model_id INTEGER NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#8b5cf6',
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_preset INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      print_tips TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      category_id INTEGER,
      thumbnail TEXT,
      library_path TEXT UNIQUE, -- Path to the model directory
      custom_meta TEXT DEFAULT '{}',
      user_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS model_tags (
      model_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (model_id, tag_id),
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      metadata TEXT,
      library_path TEXT UNIQUE, -- Path to the original file
      user_id INTEGER,
      thumbnail TEXT,
      uploaded_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS print_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      printed_at DATETIME DEFAULT (datetime('now')),
      material_id INTEGER,
      user_id INTEGER,
      successful INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  // History of a file: earlier contents kept in the project's hidden ".versions" folder.
  // path is relative to the project folder, so renaming the project keeps it valid.
  db.run(`
    CREATE TABLE IF NOT EXISTS file_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      source TEXT DEFAULT 'slicer',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id)');

  // Slicer round trips (server/services/slicerSaves.js): what "Open in slicer" sent (to tell a
  // plain download from a save) and the files found in the library's ".slicer-saves" folder
  db.run(`
    CREATE TABLE IF NOT EXISTS slicer_downloads (
      hash TEXT PRIMARY KEY,
      file_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS slicer_saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      file_size INTEGER DEFAULT 0,
      mtime_ms INTEGER DEFAULT 0,
      hash TEXT,
      status TEXT DEFAULT 'pending',
      file_id INTEGER,
      imported_hash TEXT,
      imported_file_id INTEGER,
      imported_at DATETIME,
      message TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  // Migration: Ensure user_id columns exist
  try {
    const mCols = all("PRAGMA table_info(models)");
    if (!mCols.some(c => c.name === 'user_id')) {
      db.run('ALTER TABLE models ADD COLUMN user_id INTEGER');
    }
    const fCols = all("PRAGMA table_info(files)");
    if (!fCols.some(c => c.name === 'user_id')) {
      db.run('ALTER TABLE files ADD COLUMN user_id INTEGER');
    }
    if (!fCols.some(c => c.name === 'thumbnail')) {
      db.run('ALTER TABLE files ADD COLUMN thumbnail TEXT');
    }
    const pCols = all("PRAGMA table_info(print_history)");
    const prjCols = all("PRAGMA table_info(projects)");
    if (!prjCols.some(c => c.name === 'visibility')) {
      db.run("ALTER TABLE projects ADD COLUMN visibility TEXT DEFAULT 'public'");
    }
    if (!pCols.some(c => c.name === 'user_id')) {
      db.run('ALTER TABLE print_history ADD COLUMN user_id INTEGER');
    }
    const uCols = all("PRAGMA table_info(users)");
    if (!uCols.some(c => c.name === 'email')) db.run('ALTER TABLE users ADD COLUMN email TEXT');
    if (!uCols.some(c => c.name === 'password_reset_token')) db.run('ALTER TABLE users ADD COLUMN password_reset_token TEXT');
    if (!uCols.some(c => c.name === 'password_reset_expires')) db.run('ALTER TABLE users ADD COLUMN password_reset_expires DATETIME');
    if (!uCols.some(c => c.name === 'preferred_slicer')) db.run('ALTER TABLE users ADD COLUMN preferred_slicer TEXT');
    // The printer of the fit check (an id of Settings -> Printers), chosen in the top bar
    if (!uCols.some(c => c.name === 'preferred_printer')) db.run('ALTER TABLE users ADD COLUMN preferred_printer TEXT');
    
    // Auto-migrate the very first user (id 1) to admin to prevent lockout when roles are enforced
    db.run("UPDATE users SET role = 'admin' WHERE id = 1 AND role != 'admin'");
    
    if (!mCols.some(c => c.name === 'parent_id')) db.run('ALTER TABLE models ADD COLUMN parent_id INTEGER');
    if (!mCols.some(c => c.name === 'source_url')) db.run('ALTER TABLE models ADD COLUMN source_url TEXT');
    if (!mCols.some(c => c.name === 'preview_file_id')) db.run('ALTER TABLE models ADD COLUMN preview_file_id INTEGER');
    // Password-protected models (the password is set in Settings > Security). Older databases
    // call the column is_adult and the password adult_password_hash.
    if (mCols.some(c => c.name === 'is_adult')) db.run('ALTER TABLE models RENAME COLUMN is_adult TO is_protected');
    else if (!mCols.some(c => c.name === 'is_protected')) db.run('ALTER TABLE models ADD COLUMN is_protected INTEGER DEFAULT 0');
    db.run("UPDATE system_settings SET key = 'protection_password_hash' WHERE key = 'adult_password_hash' AND NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'protection_password_hash')");
    // Trash: a deleted model or file is only flagged; server/utils/trash.js purges it later
    if (!mCols.some(c => c.name === 'deleted_at')) db.run('ALTER TABLE models ADD COLUMN deleted_at DATETIME');
    if (!all("PRAGMA table_info(files)").some(c => c.name === 'deleted_at')) db.run('ALTER TABLE files ADD COLUMN deleted_at DATETIME');
    // Random per-file token in the names of "Open in slicer" downloads: a file saved by the
    // slicer can be matched back to the file it came from (server/utils/slicerToken.js)
    if (!all("PRAGMA table_info(files)").some(c => c.name === 'slicer_token')) db.run('ALTER TABLE files ADD COLUMN slicer_token TEXT');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_files_slicer_token ON files(slicer_token)');
    // Modification time (ms) of the last slicer save imported into the file: an older save that
    // turns up later must not replace it
    if (!all("PRAGMA table_info(files)").some(c => c.name === 'slicer_saved_at')) db.run('ALTER TABLE files ADD COLUMN slicer_saved_at INTEGER');
    // Size of a 3D file in mm as placed in it (services/dimensions.js); dim_bytes: the file size it
    // was measured at, so a changed file is measured again
    for (const col of ['dim_x REAL', 'dim_y REAL', 'dim_z REAL', 'dim_bytes INTEGER', 'dim_error TEXT']) {
      if (!all("PRAGMA table_info(files)").some(c => c.name === col.split(' ')[0])) db.run(`ALTER TABLE files ADD COLUMN ${col}`);
    }
    // 3MF sizes measured from the corners of each object's box were too big for parts turned on
    // the plate: measure every 3MF again once
    if (!get("SELECT value FROM system_settings WHERE key = 'dim_3mf_vertices'")) {
      db.run("UPDATE files SET dim_bytes = NULL WHERE file_type = '3mf'");
      db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('dim_3mf_vertices', 'true')");
    }
    // Read-only projects (Edit): the app never changes their files on disk, slicer saves become
    // versions in the history of the file instead. kit_archive: the kit whose archive the project
    // is (utils/kits.js makes it read-only when it first recognises it).
    if (!mCols.some(c => c.name === 'is_readonly')) db.run('ALTER TABLE models ADD COLUMN is_readonly INTEGER DEFAULT 0');
    if (!mCols.some(c => c.name === 'kit_archive')) db.run('ALTER TABLE models ADD COLUMN kit_archive TEXT');
    // Configurations of a kit (utils/kits.js): models without files of their own. kit_source_id is
    // the model of the archive, kit_config the choices as JSON.
    if (!mCols.some(c => c.name === 'kit_source_id')) db.run('ALTER TABLE models ADD COLUMN kit_source_id INTEGER');
    if (!mCols.some(c => c.name === 'kit_config')) db.run('ALTER TABLE models ADD COLUMN kit_config TEXT');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_kit_source ON models(kit_source_id)');
    // Versions of a file: pinned ones are never pruned; a slicer project keeps what it is set up
    // with (utils/slicerSettings.js) and what changed from the version before it
    const vCols = all("PRAGMA table_info(file_versions)");
    for (const col of ['pinned INTEGER DEFAULT 0', 'label TEXT', 'summary TEXT', 'changes TEXT', 'settings_key TEXT']) {
      if (!vCols.some(c => c.name === col.split(' ')[0])) db.run(`ALTER TABLE file_versions ADD COLUMN ${col}`);
    }
    // Saved configurations were rows of kit_configs: each one becomes a configuration model
    if (get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kit_configs'")) {
      db.run('BEGIN');
      try {
        for (const k of all('SELECT * FROM kit_configs ORDER BY id')) {
          if (!get('SELECT id FROM models WHERE id = ?', [k.model_id])) continue;
          const owner = k.user_id && get('SELECT id FROM users WHERE id = ?', [k.user_id]) ? k.user_id : null;
          db.run("INSERT INTO models (name, user_id, kit_source_id, kit_config, created_at, updated_at) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))",
            [k.name, owner, k.model_id, k.config, k.created_at, k.updated_at]);
        }
        db.run('DROP TABLE kit_configs');
        db.run('COMMIT');
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    }
  } catch (e) { console.error('User migration failed:', e); }

  // Ensure metadata and library_path columns exist for existing databases
  try {
    const fCols2 = all("PRAGMA table_info(files)");
    if (!fCols2.some(c => c.name === 'metadata')) {
      db.run('ALTER TABLE files ADD COLUMN metadata TEXT');
    }
    if (!fCols2.some(c => c.name === 'library_path')) {
      db.run('ALTER TABLE files ADD COLUMN library_path TEXT');
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_files_library_path ON files(library_path)');
    }
    if (!fCols2.some(c => c.name === 'is_archive_entry')) {
      db.run('ALTER TABLE files ADD COLUMN is_archive_entry INTEGER DEFAULT 0');
    }
    if (!fCols2.some(c => c.name === 'archive_entry_path')) {
      db.run('ALTER TABLE files ADD COLUMN archive_entry_path TEXT');
    }

    const mCols2 = all("PRAGMA table_info(models)");
    if (!mCols2.some(c => c.name === 'library_path')) {
      db.run('ALTER TABLE models ADD COLUMN library_path TEXT');
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_models_library_path ON models(library_path)');
    }
    if (!mCols2.some(c => c.name === 'custom_meta')) {
      db.run('ALTER TABLE models ADD COLUMN custom_meta TEXT DEFAULT "{}"');
    }
    if (!mCols2.some(c => c.name === 'preview_file_id')) {
      db.run('ALTER TABLE models ADD COLUMN preview_file_id INTEGER');
    }

    // High-performance composite and foreign key indexes for scaling to 1M+ files
    db.run('CREATE INDEX IF NOT EXISTS idx_files_model_id ON files(model_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_model_tags_model_id ON model_tags(model_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_project_models_model_id ON project_models(model_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_project_models_project_id ON project_models(project_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_print_history_model_id ON print_history(model_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_category_id ON models(category_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_parent_id ON models(parent_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_updated_at ON models(updated_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_created_at ON models(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_files_library_path ON files(library_path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_files_file_size ON files(file_size)');
    db.run('CREATE INDEX IF NOT EXISTS idx_files_thumbnail ON files(thumbnail)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_name ON models(name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_models_deleted_at ON models(deleted_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at)');

    // Self-heal any orphaned rows created when sql.js db.export() reset PRAGMA foreign_keys (#74)
    db.run('DELETE FROM files WHERE model_id NOT IN (SELECT id FROM models)');
    db.run('DELETE FROM model_tags WHERE model_id NOT IN (SELECT id FROM models) OR tag_id NOT IN (SELECT id FROM tags)');
    db.run('DELETE FROM project_models WHERE model_id NOT IN (SELECT id FROM models) OR project_id NOT IN (SELECT id FROM projects)');
    db.run('DELETE FROM print_history WHERE model_id NOT IN (SELECT id FROM models)');
    db.run('DELETE FROM shares WHERE model_id NOT IN (SELECT id FROM models)');
  } catch (e) { console.error('Migration failed:', e); }

  // ─── Seed Data (One-time only on initial setup) ───────────────────────
  const seeded = get("SELECT value FROM system_settings WHERE key = 'seeded_defaults'");
  if (!seeded) {
    const existingCats = all("SELECT id FROM categories");
    const existingMats = all("SELECT id FROM materials");
    
    if (existingCats.length === 0 && existingMats.length === 0) {
      const seedMaterials = [
        { name: 'PLA', is_preset: 1 },
        { name: 'PETG', is_preset: 1 },
        { name: 'ABS', is_preset: 1 },
        { name: 'ASA', is_preset: 1 },
        { name: 'TPU', is_preset: 1 },
      ];

      const seedCategories = [
        { name: 'Functional', color: '#00d4ff' },
        { name: 'Decorative', color: '#8b5cf6' },
        { name: 'Mechanical', color: '#f59e0b' },
        { name: 'Figurines', color: '#ec4899' },
        { name: 'Tools', color: '#10b981' },
        { name: 'Other', color: '#64748b' },
      ];

      for (const m of seedMaterials) {
        db.run('INSERT OR IGNORE INTO materials (name, is_preset) VALUES (?, ?)', [m.name, m.is_preset]);
      }
      for (const c of seedCategories) {
        db.run('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)', [c.name, c.color]);
      }
    }
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('seeded_defaults', 'true')");
  }

  saveDb();
  console.log('✓ Database initialized');

  // Auto-save every 30 seconds
  setInterval(saveDb, 30000);

  return db;
}

// ─── Helper functions to wrap sql.js API ─────────────────────────────────

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function get(sql, params = []) {
  const results = all(sql, params);
  return results[0] || null;
}

function run(sql, params = [], skipSave = false) {
  db.run(sql, params);
  const lastIdResult = all('SELECT last_insert_rowid() as id');
  const lastId = lastIdResult[0]?.id || 0;
  const changes = db.getRowsModified();
  if (!skipSave) {
    saveDb();
  }
  return { lastId, changes };
}

module.exports = { initDatabase, getDb, all, get, run, saveDb, UPLOADS_DIR, DATA_DIR };
