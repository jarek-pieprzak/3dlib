// Worker thread of services/dimensions.js: measures one file per message
const { parentPort } = require('worker_threads');
const { measureMesh } = require('../utils/meshSize');

parentPort.on('message', async ({ id, path, type }) => {
  try {
    const { size, volume, area } = await measureMesh(path, type);
    parentPort.postMessage({ id, size, volume, area });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e).slice(0, 200) });
  }
});
