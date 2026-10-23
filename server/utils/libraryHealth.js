// The library folder is missing or empty when its share is not mounted: the container then sees
// the bare mount point (config.js even creates a missing one). Every indexed file would count as
// deleted, and removing them would wipe the whole index with its tags, collections and print
// history. The scan and the hourly sync remove nothing while the library is not available.
const fs = require('fs');

// True when the folder has at least one entry that is not hidden (3DLib itself creates
// .slicer-saves, so a dot folder does not count)
function libraryAvailable(root = require('../config').LIBRARY_PATH) {
  try {
    return fs.readdirSync(root).some(name => !name.startsWith('.'));
  } catch (e) {
    return false;
  }
}

module.exports = { libraryAvailable };
