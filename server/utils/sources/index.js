// The sites the source import copies (server/services/sourceImport.js). Each module has
// { site, idOf(url), pageUrl(id), isAsset(url), load(id, http, { token }) -> page of common.js },
// a site that needs a token of the user also needsToken, headersFor(url, token), checkToken.
const SOURCES = [require('./makerworld'), require('./printables'), require('./thingiverse')];

// { source, id } of a page link, or null when 3DLib cannot copy it
function sourceOf(url) {
  for (const source of SOURCES) {
    const id = source.idOf(url);
    if (id) return { source, id };
  }
  return null;
}

module.exports = { SOURCES, sourceOf };
