// Requests of the source import to the sites it copies (and their CDNs), with Node's https module:
// MakerWorld's bot check turns away Node's fetch (403), plain https.get with an honest user agent
// gets the data. Redirects are followed only to hosts the site allows (allow(url)); headers go to
// the first host only (a token never reaches a CDN).
const http = require('http');
const https = require('https');
const { version } = require('../../../package.json');

const USER_AGENT = `3DLib/${version} (self-hosted model library)`;
const MAX_JSON_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 60000;

// The tests answer for the sites: https://<host>/<path> -> <origin>/<host>/<path>
const TEST_ORIGIN = process.env.NODE_ENV === 'test' ? (process.env.SOURCE_IMPORT_TEST_ORIGIN || '') : '';
const requestUrl = (url) => (TEST_ORIGIN ? `${TEST_ORIGIN}/${url.replace(/^https?:\/\//, '')}` : url);

// The response stream of a GET (or POST with opts.body, sent as JSON); errors carry .status
function open(url, opts = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    const target = requestUrl(url);
    const lib = target.startsWith('https:') ? https : http;
    const body = opts.body === undefined ? null : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    const headers = { 'user-agent': USER_AGENT, accept: opts.accept || '*/*', ...(opts.headers || {}) };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = body.length; }
    const req = lib.request(target, { method: body ? 'POST' : 'GET', headers, timeout: TIMEOUT_MS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).href; } catch (e) { return reject(new Error('Bad redirect')); }
        const sameHost = new URL(next).hostname === new URL(url).hostname;
        if (!sameHost && !(opts.allow && opts.allow(next))) return reject(new Error(`Redirected to ${new URL(next).hostname}`));
        // Another host gets no headers of ours (an API token stays with the API)
        return resolve(open(next, { allow: opts.allow, headers: sameHost ? opts.headers : undefined }, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function json(url, opts = {}) {
  const res = await open(url, { accept: 'application/json', ...opts });
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) { res.destroy(); throw new Error('The answer is too large'); }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    throw new Error('The answer is not JSON');
  }
}

module.exports = { open, json, USER_AGENT };
