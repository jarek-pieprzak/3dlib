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

// Images and documents of a design live on Bambu Lab's CDNs; the signed links of its model files
// may lead to the cloud storage behind them
const isAsset = (url) => onHosts(url, ['bblmw.com', 'bblcdn.com', 'bambulab.com', 'amazonaws.com', 'cloudfront.net']);

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

// A text in the user's language: MakerWorld translates titles, descriptions, profile names and tags
// itself (the request header x-bbl-language: en / pl...); 'original' keeps the designer's own
function pick(original, translated, lang) {
  return lang && lang !== 'original' && translated && String(translated).trim() ? translated : original;
}

// The designer's own print profiles (the others are uploads of other users) as Markdown
function profilesOf(design, lang) {
  const all = (design.instances || []).filter(i => i && i.title);
  const uid = design.designCreator && design.designCreator.uid;
  const own = all.filter(i => uid && i.instanceCreator && i.instanceCreator.uid === uid);
  return (own.length ? own : all).map(p => {
    const out = [`### ${String(pick(p.title, p.titleTranslated, lang)).trim()}`];
    const facts = [];
    if (Number(p.prediction) > 0) facts.push(`${(Number(p.prediction) / 3600).toFixed(1)} h`);
    if (Number(p.weight) > 0) facts.push(`${Math.round(Number(p.weight))} g`);
    if (Number(p.materialColorCnt) > 0) facts.push(`${p.materialColorCnt} colour${Number(p.materialColorCnt) === 1 ? '' : 's'}`);
    if (p.needAms) facts.push('AMS');
    if (facts.length) out.push(facts.join(' · '));
    // One setting per paragraph: one per line here
    const settings = htmlToMarkdown(pick(p.summary, p.summaryTranslated, lang) || '').replace(/\n{2,}/g, '\n');
    if (settings) out.push(settings);
    const fil = (p.instanceFilaments || []).filter(f => f && (f.type || f.color))
      .map(f => [f.type, f.color, Number(f.usedG) > 0 ? `${Math.round(Number(f.usedG))} g` : ''].filter(Boolean).join(' '));
    if (fil.length) out.push(`Filaments: ${fil.join(', ')}`);
    return out.join('\n\n');
  }).join('\n\n');
}

// The design as a page of sources/common.js; lang: the language of its texts ('original': as the
// designer wrote them)
function pageOf(design, { lang = 'original' } = {}) {
  const ext = design.designExtension || {};
  const profiles = profilesOf(design, lang);
  const tags = design.tags || [];
  const tagsTr = design.tagsTranslated;
  return {
    site: 'MakerWorld',
    id: Number(design.id),
    url: pageUrl(design.id),
    title: pick(design.title, design.titleTranslated, lang),
    author: design.designCreator && design.designCreator.name,
    published: design.createTime,
    license: design.license,
    description: pick(design.summary, design.summaryTranslated, lang) || '',
    sections: profiles ? [{ title: 'Print profiles', markdown: profiles }] : [],
    pictures: (ext.design_pictures || []).filter(p => p && p.url).map(p => ({ url: p.url, name: p.name })),
    documents: [...(ext.design_other || []), ...(ext.design_guide || [])].filter(d => d && d.url).map(d => ({ url: d.url, name: d.name })),
    tags: lang !== 'original' && Array.isArray(tagsTr) && tagsTr.length === tags.length && tagsTr.every(t => t && String(t).trim()) ? tagsTr : tags,
    hardware: hardwareOf(design)
  };
}

// The designer's own print profiles (instances of the design)
function ownProfiles(design) {
  const all = (design.instances || []).filter(i => i && i.id);
  const uid = design.designCreator && design.designCreator.uid;
  const own = all.filter(i => uid && i.instanceCreator && i.instanceCreator.uid === uid);
  return own.length ? own : all;
}

const hasFiles = (design) => (design.instances || []).length > 0 || ((design.designExtension || {}).model_files || []).length > 0;

// The link of a download answer: { url, name } (the shape MakerWorld answers with; a nested
// "data" is taken too)
function linkOf(j) {
  const d = j && (j.url ? j : j.data);
  return d && typeof d.url === 'string' && /^https:/.test(d.url) ? { url: d.url, name: d.name || '' } : null;
}

// The model files of a design for a logged-in user (token: the Bambu Lab access token): the
// profile 3MF of each of the designer's print profiles and the raw files (a ZIP of the design's
// folders, unpacked into the project). { files, refused }: refused when MakerWorld does not take
// the token (401 / 403).
async function filesOf(design, http, token, lang) {
  const headers = { authorization: `Bearer ${token}`, cookie: `token=${token}` };
  const files = [];
  let refused = false;
  const ask = async (url) => {
    try {
      return linkOf(await http.json(url, { headers }));
    } catch (e) {
      if (e.status === 401 || e.status === 403) refused = true;
      return null;
    }
  };
  for (const p of ownProfiles(design)) {
    const link = await ask(`${SITE}/api/v1/design-service/instance/${p.id}/f3mf?type=download`);
    if (!link) continue;
    const info = (p.extention && p.extention.modelInfo && p.extention.modelInfo.f3mf) || {};
    // Named after the profile, in the user's language (a Chinese profile gets an English name)
    const title = String(pick(p.title, p.titleTranslated, lang) || '').trim();
    const name = title ? `${title}.3mf` : (/\.3mf$/i.test(link.name) ? link.name : `Profile ${p.id}.3mf`);
    files.push({ url: link.url, name, size: Number(info.size) || 0, trusted: true });
  }
  if (((design.designExtension || {}).model_files || []).length) {
    // "Download all" of the page's raw files (modelType=all: one ZIP)
    const link = await ask(`${SITE}/api/v1/design-service/design/${design.id}/model?modelType=all&type=download`);
    if (link) {
      const name = link.name || `${String(design.title || 'Model').trim()} - files.zip`;
      const zip = /\.zip$/i.test(name) || /\.zip(\?|$)/i.test(link.url);
      files.push({ url: link.url, name, unzip: zip, trusted: true });
    }
  }
  return { files, refused };
}

// The raw files of the design as the "Download all" ZIP holds them: [{ rel: "Case/Case Body.stl", size }]
function rawFilesOf(design) {
  const out = [];
  const walk = (nodes, dir) => {
    for (const n of nodes || []) {
      if (!n) continue;
      if (n.isDir) walk(n.children, dir ? `${dir}/${n.dirName}` : n.dirName);
      else {
        const name = n.modelName || n.modelFileName;
        if (name) out.push({ rel: dir ? `${dir}/${name}` : name, size: Number(n.modelSize) || 0 });
      }
    }
  };
  walk((design.designExtension || {}).model_files, '');
  return out;
}

// The page in the user's language (lang: 'en', 'pl'... or 'original'); with a token (the user's
// Bambu Lab login) also the model files. page.filesNote says why there are none: 'login_needed'
// (no login) / 'login_refused' (MakerWorld refused it). page.archiveEntries: the raw files the ZIP
// holds ({ rel, size }), so a check for updates can compare them without downloading it.
async function load(id, http, { token, lang = 'en' } = {}) {
  const design = await http.json(apiUrl(id), { headers: lang && lang !== 'original' ? { 'x-bbl-language': lang } : undefined });
  if (!design || Number(design.id) !== id) throw new Error('MakerWorld sent no model data');
  const page = pageOf(design, { lang });
  if (!hasFiles(design)) return page;
  if (!token) return { ...page, filesNote: 'login_needed' };
  const { files, refused } = await filesOf(design, http, token, lang);
  return { ...page, files, archiveEntries: files.some(f => f.unzip) ? rawFilesOf(design) : [], filesNote: refused && !files.length ? 'login_refused' : undefined };
}

module.exports = { site: 'MakerWorld', usesBambuLogin: true, idOf, pageUrl, isAsset, load, pageOf, hardwareOf, apiUrl, linkOf, rawFilesOf };
