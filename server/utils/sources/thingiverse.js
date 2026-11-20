// Thingiverse (thingiverse.com). Its API (api.thingiverse.com) answers only with a token
// (Authorization: Bearer): every 3DLib user pastes their own App Token in Profile -> API &
// Integrations (users.thingiverse_token). /things/<id> gives the name, creator, licence, date,
// the description and instructions (details_parts, or description_html / instructions_html),
// tags; /things/<id>/images the pictures in several sizes; /things/<id>/files the files with
// their CDN URLs (direct_url). A 401 means the token is wrong or revoked.
const { onHosts, textToHtml } = require('./common');

const SITE = 'https://www.thingiverse.com';
const API = 'https://api.thingiverse.com';

// "https://www.thingiverse.com/thing:763622/files" -> 763622
function idOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?thingiverse\.com$/i.test(u.hostname)) return null;
  const m = /^\/thing:(\d+)(?:[/#?]|$)/i.exec(u.pathname);
  return m ? Number(m[1]) : null;
}

const pageUrl = (id) => `${SITE}/thing:${id}`;
const isAsset = (url) => onHosts(url, ['thingiverse.com']);

// Files that are documentation (the models themselves are added by hand)
const DOCUMENT = /\.(pdf|txt|md|docx?|odt|rtf|png|jpe?g|gif|webp)$/i;

class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const MISSING = 'Thingiverse needs your API token: add it in Profile -> API & Integrations';
const INVALID = 'Thingiverse refused your API token (it is wrong or was revoked): paste a new one in Profile -> API & Integrations';

// HTML of a text Thingiverse may keep as HTML or as plain text
const html = (s) => {
  const t = String(s || '').trim();
  if (!t) return '';
  return /<[a-z][\s\S]*>/i.test(t) ? t : textToHtml(t);
};

// The biggest picture of an image: display / large first
function bestImage(img) {
  const rank = (s) => (s.type === 'display' ? 30 : s.type === 'preview' ? 20 : 10) + ({ large: 5, featured: 4, medium: 3, card: 2, small: 1 }[s.size] || 0);
  const sizes = (Array.isArray(img && img.sizes) ? img.sizes : []).filter(s => s && s.url && isAsset(s.url));
  sizes.sort((a, b) => rank(b) - rank(a));
  return sizes.length ? sizes[0].url : (img && img.url && isAsset(img.url) && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(img.url) ? img.url : null);
}

// The print settings part as a list
function settingsOf(data) {
  const names = { printer: 'Printer', printer_brand: 'Printer brand', rafts: 'Rafts', supports: 'Supports', resolution: 'Resolution', infill: 'Infill', filament_brand: 'Filament brand', filament_color: 'Filament colour', filament_material: 'Filament material', notes: 'Notes' };
  const out = [];
  for (const d of data) {
    for (const [k, label] of Object.entries(names)) {
      const v = d && d[k] !== undefined && d[k] !== null ? String(d[k]).replace(/\s+/g, ' ').trim() : '';
      if (v) out.push(`- ${label}: ${v}`);
    }
  }
  return out.join('\n');
}

// The thing as a page of sources/common.js
function pageOf(thing, images = [], files = [], tags = null) {
  let description = '';
  const sections = [];
  const parts = Array.isArray(thing.details_parts) ? thing.details_parts : [];
  if (parts.length) {
    for (const p of parts) {
      const data = Array.isArray(p && p.data) ? p.data : [];
      if (p.type === 'settings') {
        const list = settingsOf(data);
        if (list) sections.push({ title: p.name || 'Print settings', markdown: list });
        continue;
      }
      const body = data.map(d => html(d && d.content)).filter(Boolean).join('');
      if (!body) continue;
      if (p.type === 'summary' && !description) description = body;
      else sections.push({ title: p.name || 'Details', html: body });
    }
  } else {
    description = html(thing.description_html || thing.description);
    const instructions = html(thing.instructions_html || thing.instructions);
    if (instructions) sections.push({ title: 'Instructions', html: instructions });
  }
  const creator = thing.creator || {};
  return {
    site: 'Thingiverse',
    id: Number(thing.id),
    url: pageUrl(thing.id),
    title: thing.name,
    author: creator.name || [creator.first_name, creator.last_name].filter(Boolean).join(' '),
    published: thing.added,
    license: thing.license,
    description,
    sections,
    pictures: (Array.isArray(images) ? images : []).map(i => ({ url: bestImage(i), name: i && i.name })).filter(p => p.url),
    documents: (Array.isArray(files) ? files : []).filter(f => f && DOCUMENT.test(f.name || ''))
      .map(f => ({ url: [f.direct_url, f.download_url].find(u => u && isAsset(u)), name: f.name })).filter(d => d.url),
    tags: (Array.isArray(tags) ? tags : Array.isArray(thing.tags) ? thing.tags : []).map(t => (typeof t === 'string' ? t : t && t.name)).filter(Boolean),
    hardware: []
  };
}

const auth = (token) => ({ authorization: `Bearer ${token}` });

// Headers for a URL of this site: the token for the API (a download_url), nothing for the CDN
function headersFor(url, token) {
  return token && String(url).startsWith(`${API}/`) ? auth(token) : undefined;
}

async function load(id, http, { token } = {}) {
  if (!token) throw new TokenError('token_missing', MISSING);
  const get = async (path) => {
    try {
      return await http.json(`${API}${path}`, { headers: auth(token) });
    } catch (e) {
      if (e.status === 401) throw new TokenError('token_invalid', INVALID);
      throw e;
    }
  };
  const thing = await get(`/things/${id}`);
  if (!thing || Number(thing.id) !== id) throw new Error('Thingiverse sent no model data');
  const optional = (path) => get(path).catch(e => { if (e instanceof TokenError) throw e; return []; });
  const images = await optional(`/things/${id}/images`);
  const files = await optional(`/things/${id}/files`);
  const tags = Array.isArray(thing.tags) ? null : await optional(`/things/${id}/tags`);
  return pageOf(thing, images, files, tags);
}

// Whether Thingiverse takes a token: 'ok', 'invalid' (401) or throws when it cannot be asked.
// Any thing does; 3DBenchy is there for good (a 404 still means the token got through)
async function checkToken(token, http) {
  try {
    await http.json(`${API}/things/763622`, { headers: auth(token) });
    return 'ok';
  } catch (e) {
    if (e.status === 401) return 'invalid';
    if (e.status === 404) return 'ok';
    throw e;
  }
}

module.exports = { site: 'Thingiverse', needsToken: true, idOf, pageUrl, isAsset, load, pageOf, headersFor, checkToken, TokenError };
