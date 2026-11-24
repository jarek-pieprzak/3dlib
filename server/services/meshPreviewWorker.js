// Worker thread of services/meshPreviews.js: one light copy per message, written gzipped
const fs = require('fs');
const zlib = require('zlib');
const { parentPort } = require('worker_threads');
const { simplify } = require('../utils/meshPreview');

parentPort.on('message', async ({ name, src, dest }) => {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    const { stl } = await simplify(src);
    fs.writeFileSync(tmp, zlib.gzipSync(stl, { level: 6 }));
    fs.renameSync(tmp, dest);
    parentPort.postMessage({ name });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (err) { /* not written */ }
    parentPort.postMessage({ name, error: String((e && e.message) || e).slice(0, 200) });
  }
});
