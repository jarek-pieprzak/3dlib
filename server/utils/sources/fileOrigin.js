// Where a slicer project came from, by what the site wrote into it. A 3MF downloaded from
// MakerWorld (or opened from it in Bambu Studio) has metadata at the top of 3D/3dmodel.model, and
// saving it in Bambu Studio keeps them: Title, Designer, DesignerUserId, DesignProfileId (the
// print profile), DesignModelId ("US338d0dc47e5a39", not the number in the page link),
// ProfileTitle. Only that head of the file is read, never its meshes.
const MODEL_FILE = '3d/3dmodel.model';
const HEAD_BYTES = 512 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] || m;
  });
}

// { name: value } of the <metadata> elements before the model's resources
function metadataOf(text) {
  const head = text.split(/<(?:\w+:)?resources\b/)[0];
  const out = {};
  const re = /<(?:\w+:)?metadata\s+name="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/(?:\w+:)?metadata>)/g;
  let m;
  while ((m = re.exec(head))) out[m[1]] = decode(m[2] || '').trim();
  return out;
}

// The metadata of a 3MF file; {} when it has none (or is no 3MF)
function readMetadata(filePath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      let done = false;
      const finish = (value, error) => {
        if (done) return;
        done = true;
        try { zip.close(); } catch (e) { /* closed */ }
        error ? reject(error) : resolve(value);
      };
      zip.on('error', e => finish(null, e));
      zip.on('end', () => finish({}));
      zip.on('entry', (entry) => {
        if (entry.fileName.toLowerCase() !== MODEL_FILE) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return finish(null, e);
          let text = '';
          const stop = () => { stream.destroy(); finish(metadataOf(text)); };
          stream.on('data', (chunk) => {
            text += chunk.toString('utf8');
            if (text.length >= HEAD_BYTES || /<(?:\w+:)?resources\b/.test(text)) stop();
          });
          stream.on('end', () => finish(metadataOf(text)));
          stream.on('error', () => finish(metadataOf(text)));
        });
      });
      zip.readEntry();
    });
  });
}

const clip = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// MakerWorld's part of the metadata: { site, designerUid, profileId, modelId, title, designer,
// profileTitle }, or null for a file that did not come from MakerWorld
function makerWorldOf(meta) {
  const designerUid = Number(meta && meta.DesignerUserId) || 0;
  const profileId = Number(meta && meta.DesignProfileId) || 0;
  const modelId = /^[A-Za-z0-9]{6,40}$/.test((meta && meta.DesignModelId) || '') ? meta.DesignModelId : '';
  if (!designerUid || (!profileId && !modelId)) return null;
  return { site: 'MakerWorld', designerUid, profileId, modelId, title: clip(meta.Title), designer: clip(meta.Designer, 80), profileTitle: clip(meta.ProfileTitle) };
}

module.exports = { readMetadata, metadataOf, makerWorldOf };
