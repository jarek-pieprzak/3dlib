// The names of plates, objects and parts inside a Bambu Studio / OrcaSlicer 3MF
// (Metadata/model_settings.config: <metadata key="plater_name" value="..."/> of a plate,
// <metadata key="name" value="..."/> of an object or part). The source import gives names in
// another script their translation next to them, so the slicer and 3DLib's plate list read them.
const AdmZip = require('adm-zip');

const ENTRY = 'Metadata/model_settings.config';
const NAME = /(<metadata\s+key="(?:plater_name|name)"\s+value=")([^"]*)(")/g;

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
});
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function settingsOf(file) {
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntry(ENTRY);
    return entry ? { zip, entry, text: entry.getData().toString('utf8') } : null;
  } catch (e) {
    return null; // not a 3MF (ZIP)
  }
}

// The names in the file ([text]), empty when it has none or is no 3MF
function namesOf(file) {
  const s = settingsOf(file);
  if (!s) return [];
  return [...new Set([...s.text.matchAll(NAME)].map(m => decode(m[2])).filter(Boolean))];
}

// Every name through rename(name) -> new name (or the same); true when the file changed
function renameAll(file, rename) {
  const s = settingsOf(file);
  if (!s) return false;
  let changed = false;
  const text = s.text.replace(NAME, (m, a, value, b) => {
    const name = decode(value);
    const next = rename(name);
    if (!next || next === name) return m;
    changed = true;
    return `${a}${encode(next)}${b}`;
  });
  if (!changed) return false;
  s.zip.updateFile(s.entry, Buffer.from(text, 'utf8'));
  s.zip.writeZip(file);
  return true;
}

module.exports = { namesOf, renameAll, ENTRY };
