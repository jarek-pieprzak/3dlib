// Worker thread of services/dimensions.js: measures one file per message
const { parentPort } = require('worker_threads');
const { measure } = require('../utils/meshSize');

parentPort.on('message', async ({ id, path, type }) => {
  try {
    parentPort.postMessage({ id, size: await measure(path, type) });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e).slice(0, 200) });
  }
});
