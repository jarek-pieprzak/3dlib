// Printables (printables.com). The page sits behind a bot check, its GraphQL API does not and needs
// no login: print(id) gives the name, summary, description (HTML), author, licence, tags, pictures
// (media.printables.com/<filePath>), the page as a PDF Printables makes (pdfFilePath), the print
// settings and its files: STLs, G-codes, SLA files and "other files" (manuals, STEPs...), whose
// download links come from the getDownloadLink mutation (files.printables.com, valid a day), one
// request per file. Documents among the other files go next to the README, the rest in their
// Printables folder ("MK4S G-codes/x.bgcode").
const { onHosts, textToHtml } = require('./common');

const SITE = 'https://www.printables.com';
const API = 'https://api.printables.com/graphql/';
const MEDIA = 'https://media.printables.com/';

// "https://www.printables.com/pl/model/3161-3d-benchy/files" -> 3161
function idOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?printables\.com$/i.test(u.hostname)) return null;
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?model\/(\d+)(?:[-/]|$)/i.exec(u.pathname);
  return m ? Number(m[1]) : null;
}

const pageUrl = (id) => `${SITE}/model/${id}`;
const isAsset = (url) => onHosts(url, ['printables.com']);

const QUERY = `query Print($id: ID!) { print(id: $id) {
  id name summary description datePublished license { name } user { publicUsername handle } tags { name }
  images { filePath } pdfFilePath printDuration numPieces weight nozzleDiameters layerHeights materials { name }
  stls { id name folder fileSize } gcodes { id name folder fileSize } slas { id name folder fileSize } otherFiles { id name folder fileSize }
} }`;
const LINK = `mutation Link($id: ID!, $printId: ID!, $fileType: DownloadFileTypeEnum!, $source: DownloadSourceEnum!) {
  getDownloadLink(id: $id, printId: $printId, fileType: $fileType, source: $source) { ok output { link } }
}`;

// Other files that are documentation (next to the README); the others are model files
const DOCUMENT = /\.(pdf|txt|md|docx?|odt|rtf|png|jpe?g|gif|webp)$/i;

// The kinds of files of a print with the fileType of their download link
const KINDS = [['stls', 'stl'], ['gcodes', 'gcode'], ['slas', 'sla'], ['otherFiles', 'other']];
const linkKey = (type, id) => `${type}:${id}`;

const media = (filePath) => (filePath ? MEDIA + String(filePath).replace(/^\/+/, '') : null);
const list = (v) => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && String(x).trim()) : []);

function settingsOf(p) {
  const out = [];
  if (Number(p.printDuration) > 0) out.push(`- Print time: ${Number(p.printDuration).toFixed(1)} h`);
  if (Number(p.numPieces) > 0) out.push(`- Pieces: ${Number(p.numPieces)}`);
  if (Number(p.weight) > 0) out.push(`- Weight: ${Math.round(Number(p.weight))} g`);
  if (list(p.nozzleDiameters).length) out.push(`- Nozzle: ${list(p.nozzleDiameters).join(', ')} mm`);
  if (list(p.layerHeights).length) out.push(`- Layer height: ${list(p.layerHeights).join(', ')} mm`);
  const materials = list((p.materials || []).map(m => m && m.name));
  if (materials.length) out.push(`- Materials: ${materials.join(', ')}`);
  return out.join('\n');
}

// The print as a page of sources/common.js; links: { "<fileType>:<id>": download URL }
function pageOf(p, links = {}) {
  const summary = String(p.summary || '').trim();
  const description = String(p.description || '');
  const plain = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // The summary above the description, unless the description starts with it anyway
  const lead = summary && !plain.includes(summary.replace(/\s+/g, ' ').slice(0, 60)) ? textToHtml(summary) : '';
  const settings = settingsOf(p);
  const documents = [];
  const files = [];
  for (const [field, type] of KINDS) {
    for (const f of p[field] || []) {
      const url = f && links[linkKey(type, f.id)];
      if (!url) continue;
      if (type === 'other' && DOCUMENT.test(f.name || '') && !f.folder) documents.push({ url, name: f.name });
      else files.push({ url, name: f.name, folder: f.folder || '', size: Number(f.fileSize) || 0 });
    }
  }
  if (p.pdfFilePath) documents.push({ url: media(p.pdfFilePath), name: 'Printables page.pdf' });
  return {
    site: 'Printables',
    id: Number(p.id),
    url: pageUrl(p.id),
    title: p.name,
    author: p.user && (p.user.publicUsername || p.user.handle),
    published: p.datePublished,
    license: p.license && p.license.name,
    description: lead + description,
    sections: settings ? [{ title: 'Print settings', markdown: settings }] : [],
    pictures: (p.images || []).filter(i => i && i.filePath).map(i => ({ url: media(i.filePath), name: String(i.filePath).split('/').pop() })),
    documents,
    tags: (p.tags || []).map(t => t && t.name).filter(Boolean),
    hardware: [],
    files
  };
}

async function load(id, http) {
  const r = await http.json(API, { body: { query: QUERY, variables: { id: String(id) } } });
  if (r && r.errors && r.errors.length) throw new Error(`Printables: ${r.errors[0].message}`);
  const p = r && r.data && r.data.print;
  if (!p) throw Object.assign(new Error('Printables has no model with this number'), { status: 404 });
  // Download links of every file (one request each)
  const links = {};
  for (const [field, type] of KINDS) {
    for (const f of (p[field] || []).filter(Boolean)) {
      try {
        const l = await http.json(API, { body: { query: LINK, variables: { id: String(f.id), printId: String(id), fileType: type, source: 'model_detail' } } });
        const link = l && l.data && l.data.getDownloadLink && l.data.getDownloadLink.output && l.data.getDownloadLink.output.link;
        if (link && isAsset(link)) links[linkKey(type, f.id)] = link;
      } catch (e) { /* that file is listed without a copy */ }
    }
  }
  return pageOf(p, links);
}

module.exports = { site: 'Printables', idOf, pageUrl, isAsset, load, pageOf };
