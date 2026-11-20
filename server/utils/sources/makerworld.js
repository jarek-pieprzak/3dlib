// MakerWorld (makerworld.com). The page sits behind a bot check, its data does not:
// GET /api/v1/design-service/design/<id> gives the design as JSON: `summary` (the description,
// HTML), `designExtension.design_pictures` (the gallery), `design_other` (attached documents: the
// PDF manuals), `boms` / `boms_of_other_part_list` (hardware), `instances` (the print profiles),
// `tags`, `designCreator`, `license`, `createTime`. No token needed.
const { htmlToMarkdown, onHosts } = require('./common');

const SITE = 'https://makerworld.com';

// "https://makerworld.com/pl/models/786733-vault-assault?from=recommend#profileId-1" -> 786733
function idOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?makerworld\.com$/i.test(u.hostname)) return null;
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?models\/(\d+)(?:[-/]|$)/i.exec(u.pathname);
  return m ? Number(m[1]) : null;
}

const apiUrl = (id) => `${SITE}/api/v1/design-service/design/${id}`;
const pageUrl = (id) => `${SITE}/en/models/${id}`;

// Images and documents of a design live on Bambu Lab's CDNs
const isAsset = (url) => onHosts(url, ['bblmw.com', 'bblcdn.com', 'bambulab.com']);

// Hardware of the design: [{ name, qty, note }]. Store items come in packs ("M3x10 ... (20PCS)"),
// their quantity counts packs.
function hardwareOf(design) {
  const ext = design.designExtension || {};
  const out = [];
  for (const b of ext.boms || []) {
    let name = String(b.displayTitle || b.title || '').replace(/\s+-\s+[A-Z]{1,3}\d{2,4}$/, '').trim();
    // "0.4x3x10 mm (10PCS)" says what size, its parent what it is ("Extension Springs")
    const parent = String(b.displayParentTitle || b.parentTitle || '').trim();
    if (parent && !/[a-z]{3,}/i.test(name.replace(/\(\d+\s*PCS\)|\bmm\b/gi, ''))) name = `${parent} ${name}`;
    if (name) out.push({ name: name.slice(0, 120), qty: Math.max(1, Number(b.quantity) || 1), note: '' });
  }
  for (const p of ext.boms_of_other_part_list || []) {
    const name = String(p.name || '').replace(/_/g, ' ').trim();
    const note = String(p.note || '').replace(/_/g, ' ').replace(/^\((.*)\)$/, '$1').trim();
    if (name) out.push({ name: name.slice(0, 120), qty: Math.max(1, Number(p.quantity) || 1), note });
  }
  return out;
}

// The designer's own print profiles (the others are uploads of other users) as Markdown
function profilesOf(design) {
  const all = (design.instances || []).filter(i => i && i.title);
  const uid = design.designCreator && design.designCreator.uid;
  const own = all.filter(i => uid && i.instanceCreator && i.instanceCreator.uid === uid);
  return (own.length ? own : all).map(p => {
    const out = [`### ${String(p.title).trim()}`];
    const facts = [];
    if (Number(p.prediction) > 0) facts.push(`${(Number(p.prediction) / 3600).toFixed(1)} h`);
    if (Number(p.weight) > 0) facts.push(`${Math.round(Number(p.weight))} g`);
    if (Number(p.materialColorCnt) > 0) facts.push(`${p.materialColorCnt} colour${Number(p.materialColorCnt) === 1 ? '' : 's'}`);
    if (p.needAms) facts.push('AMS');
    if (facts.length) out.push(facts.join(' · '));
    // One setting per paragraph: one per line here
    const settings = htmlToMarkdown(p.summary || '').replace(/\n{2,}/g, '\n');
    if (settings) out.push(settings);
    const fil = (p.instanceFilaments || []).filter(f => f && (f.type || f.color))
      .map(f => [f.type, f.color, Number(f.usedG) > 0 ? `${Math.round(Number(f.usedG))} g` : ''].filter(Boolean).join(' '));
    if (fil.length) out.push(`Filaments: ${fil.join(', ')}`);
    return out.join('\n\n');
  }).join('\n\n');
}

// The design as a page of sources/common.js
function pageOf(design) {
  const ext = design.designExtension || {};
  const profiles = profilesOf(design);
  return {
    site: 'MakerWorld',
    id: Number(design.id),
    url: pageUrl(design.id),
    title: design.title,
    author: design.designCreator && design.designCreator.name,
    published: design.createTime,
    license: design.license,
    description: design.summary || '',
    sections: profiles ? [{ title: 'Print profiles', markdown: profiles }] : [],
    pictures: (ext.design_pictures || []).filter(p => p && p.url).map(p => ({ url: p.url, name: p.name })),
    documents: [...(ext.design_other || []), ...(ext.design_guide || [])].filter(d => d && d.url).map(d => ({ url: d.url, name: d.name })),
    tags: design.tags || [],
    hardware: hardwareOf(design)
  };
}

async function load(id, http) {
  const design = await http.json(apiUrl(id));
  if (!design || Number(design.id) !== id) throw new Error('MakerWorld sent no model data');
  return pageOf(design);
}

module.exports = { site: 'MakerWorld', idOf, pageUrl, isAsset, load, pageOf, hardwareOf, apiUrl };
