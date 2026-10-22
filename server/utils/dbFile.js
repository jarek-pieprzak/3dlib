const fs = require('fs');
const path = require('path');

const DB_FILE = '3dlib.db';
// The name the database had before the project became 3DLib
const LEGACY_DB_FILE = 'gyroidvault.db';

/**
 * The database file to open in dataDir. A database that exists only under its old name is copied
 * to the new one (byte for byte, checked, then renamed into place); the old file is never changed
 * or removed. When the copy fails the old file stays in use, so the server never starts on an
 * empty database while the real one is still there.
 */
function resolveDbPath(dataDir, log = console) {
  const dbPath = path.join(dataDir, DB_FILE);
  const legacyPath = path.join(dataDir, LEGACY_DB_FILE);
  if (fs.existsSync(dbPath) || !fs.existsSync(legacyPath)) return dbPath;

  const tmpPath = dbPath + '.migrating';
  try {
    fs.copyFileSync(legacyPath, tmpPath);
    if (!fs.readFileSync(tmpPath).equals(fs.readFileSync(legacyPath))) {
      throw new Error('the copy differs from the original');
    }
    fs.renameSync(tmpPath, dbPath);
    log.log(`[Config] Database copied from ${LEGACY_DB_FILE} to ${DB_FILE}; the old file is kept unchanged.`);
    return dbPath;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    log.error(`[Config] Could not copy ${LEGACY_DB_FILE} to ${DB_FILE} (${err.message}); using ${LEGACY_DB_FILE}.`);
    return legacyPath;
  }
}

module.exports = { DB_FILE, LEGACY_DB_FILE, resolveDbPath };
