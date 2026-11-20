// MakerWorld (makerworld.com) model pages: what 3DLib copies of them into the project folder, so
// the documentation stays when the page changes or goes. Pure functions, no I/O (the browser-free
// download is server/services/sourceImport.js); the tests load this file directly.
//
// The page itself sits behind a bot check, its data does not: GET /api/v1/design-service/design/<id>
// gives the design as JSON: `summary` (the description, HTML), `designExtension.design_pictures`
// (the gallery), `design_other` (attached documents: the PDF manuals), `boms` / `boms_of_other_part_list`
// (hardware), `instances` (the print profiles), `tags`, `designCreator`, `license`, `createTime`.

const SITE = 'https://makerworld.com';

// "https://makerworld.com/pl/models/786733-vault-assault?from=recommend#profileId-1" -> 786733
function designIdOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?makerworld\.com$/i.test(u.hostname)) return null;
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?models\/(\d+)(?:[-/]|$)/i.exec(u.pathname);
  return m ? Number(m[1]) : null;
}

const apiUrl = (id) => `${SITE}/api/v1/design-service/design/${id}`;
const pageUrl = (id) => `${SITE}/en/models/${id}`;

// Images and documents of a design live on Bambu Lab's CDNs; nothing else is downloaded
function isAssetUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(bblmw|bblcdn|bambulab)\.com$/i.test(u.hostname);
  } catch (e) { return false; }
}

// ─── HTML -> Markdown (what UI.renderMarkdown shows) ─────────────────────────

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®',
  trade: '™', deg: '°', times: '×', plusmn: '±', euro: '€', pound: '£', shy: ''
};

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (n === 160) return ' ';
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function attrOf(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs || '');
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'embed', 'param', 'track']);
// Widgets and code of the page, not part of the text ("Boost me" is MakerWorld's tip box)
const DROP = new Set(['script', 'style', 'noscript', 'svg', 'button', 'form', 'boostme']);

// A forgiving tree: unclosed tags close with their parent, stray closing tags are ignored
function parseHtml(html) {
  const root = { tag: '#root', attrs: '', children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (!m[2]) { top.children.push({ text: decodeEntities(m[4] === undefined ? '<' : m[4]) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const node = { tag, attrs: m[3] || '', children: [] };
    top.children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(node.attrs)) stack.push(node);
  }
  return root;
}

function textOf(node) {
  if (node.text !== undefined) return node.text;
  if (DROP.has(node.tag)) return '';
  return node.children.map(textOf).join('');
}

// Every image of a description, in order (to download them before converting)
function imagesOf(html) {
  const out = [];
  const walk = (n) => {
    if (n.text !== undefined || DROP.has(n.tag)) return;
    if (n.tag === 'img') {
      const src = attrOf(n.attrs, 'src') || attrOf(n.attrs, 'data-src');
      if (src && !out.includes(src)) out.push(src);
    }
    n.children.forEach(walk);
  };
  walk(parseHtml(html));
  return out;
}

// A path or URL as a Markdown link target: no spaces or parentheses (UI.renderMarkdown ends the
// target at the first ")")
function mdTarget(url) {
  return String(url).replace(/[ ()]/g, c => ({ ' ': '%20', '(': '%28', ')': '%29' })[c]);
}

// "**x**" around text, with its outer spaces outside and once per line (emphasis does not cross
// lines in UI.renderMarkdown)
function wrap(mark, s) {
  return s.split('\n').map(line => {
    const core = line.trim();
    if (!core) return line;
    const lead = line.match(/^\s*/)[0];
    const trail = line.match(/\s*$/)[0];
    return `${lead}${mark}${core}${mark}${trail}`;
  }).join('\n');
}

const BLOCK = new Set(['p', 'div', 'section', 'article', 'figure', 'figcaption', 'center', 'header', 'footer', 'main', 'aside', 'details', 'summary', 'dl', 'dt', 'dd']);

// HTML -> Markdown. opts.image(src) gives the target of an image (the local copy); without it the
// image keeps its URL.
function htmlToMarkdown(html, opts = {}) {
  const imageTarget = opts.image || (src => src);

  const render = (node, ctx) => {
    if (node.text !== undefined) return ctx.pre ? node.text : node.text.replace(/\s+/g, ' ');
    const tag = node.tag;
    if (DROP.has(tag)) return '';
    const inner = (c = ctx) => node.children.map(n => render(n, c)).join('');

    if (BLOCK.has(tag)) return `\n\n${inner()}\n\n`;
    const h = /^h([1-6])$/.exec(tag);
    if (h) {
      const title = textOf(node).replace(/\s+/g, ' ').trim();
      return title ? `\n\n${'#'.repeat(Math.min(4, Number(h[1])))} ${title}\n\n` : '';
    }
    switch (tag) {
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': return wrap('**', inner());
      case 'em': case 'i': return wrap('*', inner());
      case 'del': case 's': case 'strike': return wrap('~~', inner());
      case 'code': {
        if (ctx.pre) return textOf(node);
        const t = textOf(node).replace(/`/g, "'").replace(/\s+/g, ' ').trim();
        return t ? '`' + t + '`' : '';
      }
      case 'pre': return `\n\n\`\`\`\n${textOf(node).replace(/```/g, "'''").replace(/^\n+|\s+$/g, '')}\n\`\`\`\n\n`;
      case 'blockquote': {
        const body = tidy(inner());
        return body ? `\n\n${body.split('\n').map(l => `> ${l}`).join('\n')}\n\n` : '';
      }
      case 'img': {
        const src = attrOf(node.attrs, 'src') || attrOf(node.attrs, 'data-src');
        if (!src) return '';
        const alt = attrOf(node.attrs, 'alt').replace(/[[\]\n]/g, ' ').trim();
        return `![${alt}](${mdTarget(imageTarget(src))}) `;
      }
      case 'a': {
        const href = attrOf(node.attrs, 'href');
        const label = inner();
        if (!/^(https?:|mailto:)/i.test(href) || !label.trim()) return label;
        // A picture that links to itself (click to enlarge) is the picture
        if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(label)) return label;
        return `[${label.trim().replace(/[[\]]/g, '')}](${mdTarget(href)})`;
      }
      case 'ul': case 'ol': {
        const depth = ctx.depth || 0;
        let n = Number(attrOf(node.attrs, 'start')) || 1;
        const items = node.children.filter(c => c.tag === 'li').map(li => {
          const body = tidy(li.children.map(c => render(c, { ...ctx, depth: depth + 1 })).join(''));
          const bullet = tag === 'ol' ? `${n++}. ` : '- ';
          const pad = '  '.repeat(depth);
          // A nested list keeps its own lines; other line breaks of an item join its text (an item
          // is one line in UI.renderMarkdown)
          const lines = [];
          for (const l of body.split('\n').filter(x => x.trim())) {
            if (!lines.length || /^\s*([-*+]|\d+\.)\s/.test(l)) lines.push(l);
            else lines[lines.length - 1] += ' ' + l.trim();
          }
          const first = lines.shift() || '';
          return [pad + bullet + first.trim(), ...lines].join('\n');
        });
        return items.length ? `\n\n${items.join('\n')}\n\n` : '';
      }
      case 'table': {
        const rows = [];
        const walkRows = (n) => {
          if (n.text !== undefined) return;
          if (n.tag === 'tr') rows.push(n.children.filter(c => c.tag === 'td' || c.tag === 'th').map(c => tidy(render(c, ctx)).replace(/\n+/g, ' ').replace(/\|/g, '/')));
          else n.children.forEach(walkRows);
        };
        walkRows(node);
        return rows.length ? `\n\n${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}\n\n` : '';
      }
      case 'video': case 'iframe': case 'embed': {
        const src = attrOf(node.attrs, 'src') || (node.children.find(c => c.tag === 'source') ? attrOf(node.children.find(c => c.tag === 'source').attrs, 'src') : '');
        return /^https?:/i.test(src) ? `\n\n[Video](${mdTarget(src)})\n\n` : '';
      }
      default: return inner();
    }
  };

  return tidy(render(parseHtml(html), { depth: 0, pre: false }));
}

// Lines without stray spaces (list indents stay), at most one blank line between blocks
function tidy(md) {
  const fences = [];
  let s = String(md).replace(/```[\s\S]*?```/g, f => `\u0000${fences.push(f) - 1}\u0000`);
  s = s.split('\n').map(line => {
    const t = line.replace(/[ \t]+$/, '').replace(/(\S)[ \t]{2,}/g, '$1 ');
    return /^\s+([-*+]|\d+\.)\s/.test(t) ? t : t.replace(/^[ \t]+/, '');
  }).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => fences[i]);
}

// ─── What a design brings along ──────────────────────────────────────────────

// A name that is a valid file name on SMB shares (the project folder lives on one)
function safeFileName(name, fallback) {
  let s = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/ +(\.[^. ]+)$/, '$1').replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > 120) {
    const ext = (/\.[a-z0-9]{1,5}$/i.exec(s) || [''])[0];
    s = s.slice(0, 120 - ext.length).trim() + ext;
  }
  return s || fallback;
}

function extOf(url, fallback) {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : fallback;
  } catch (e) { return fallback; }
}

// The files to download, with where they go in the project folder:
// [{ url, rel, kind: 'description' | 'gallery' | 'document' }]. Description images are numbered in
// their order, gallery pictures and documents keep their names.
function assetsOf(design) {
  const ext = design.designExtension || {};
  const out = [];
  const taken = new Set();
  const add = (url, rel, kind) => {
    if (!url || !isAssetUrl(url) || out.some(a => a.url === url)) return;
    let r = rel;
    for (let i = 2; taken.has(r.toLowerCase()); i++) r = rel.replace(/(\.[^./]+)?$/, m => ` (${i})${m}`);
    taken.add(r.toLowerCase());
    out.push({ url, rel: r, kind });
  };
  imagesOf(design.summary || '').forEach((url, i) => {
    add(url, `images/description-${String(i + 1).padStart(2, '0')}.${extOf(url, 'jpg')}`, 'description');
  });
  (ext.design_pictures || []).forEach((p, i) => {
    const e = extOf(p.url, 'jpg');
    const fallback = `picture-${String(i + 1).padStart(2, '0')}.${e}`;
    let name = safeFileName(p.name, fallback);
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${e}`;
    add(p.url, `images/${name}`, 'gallery');
  });
  for (const d of [...(ext.design_other || []), ...(ext.design_guide || [])]) {
    const e = extOf(d.url, 'pdf');
    let name = safeFileName(d.name, `document.${e}`);
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${e}`;
    add(d.url, name, 'document');
  }
  return out;
}

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

const day = (iso) => (/^\d{4}-\d{2}-\d{2}/.exec(String(iso || '')) || [''])[0];

// First line of an imported README: a re-import may overwrite only a README that has it
function marker(id) {
  return `<!-- 3dlib-source: ${pageUrl(id)} -->`;
}
const hasMarker = (text) => /^\s*<!-- 3dlib-source: /.test(String(text || ''));

// The README of the project: who made it and where it comes from, the description, the print
// profiles, hardware, documents and the gallery. local(url) gives the project-relative path of a
// downloaded file (or null: the file keeps its URL). today: "YYYY-MM-DD".
function buildReadme(design, { local = () => null, today = '' } = {}) {
  const id = design.id;
  const ext = design.designExtension || {};
  const target = (url) => local(url) || url;
  const lines = [marker(id), `# ${String(design.title || `MakerWorld model ${id}`).trim()}`, ''];

  const by = design.designCreator && design.designCreator.name ? `by **${design.designCreator.name}** ` : '';
  const facts = [`${by}on [MakerWorld](${pageUrl(id)})`];
  if (day(design.createTime)) facts.push(`published ${day(design.createTime)}`);
  if (design.license) facts.push(design.license);
  lines.push(facts.join(' · ').replace(/^by/, 'By').replace(/^on/, 'On'));
  if (today) lines.push(`Copied by 3DLib on ${today}.`);
  lines.push('');

  const description = htmlToMarkdown(design.summary || '', { image: target });
  if (description) lines.push(description, '');

  // The designer's own print profiles (the others are uploads of other users)
  const all = (design.instances || []).filter(i => i && i.title);
  const uid = design.designCreator && design.designCreator.uid;
  const own = all.filter(i => uid && i.instanceCreator && i.instanceCreator.uid === uid);
  const profiles = own.length ? own : all;
  if (profiles.length) {
    lines.push('## Print profiles', '');
    for (const p of profiles) {
      lines.push(`### ${String(p.title).trim()}`, '');
      const facts = [];
      if (Number(p.prediction) > 0) facts.push(`${(Number(p.prediction) / 3600).toFixed(1)} h`);
      if (Number(p.weight) > 0) facts.push(`${Math.round(Number(p.weight))} g`);
      if (Number(p.materialColorCnt) > 0) facts.push(`${p.materialColorCnt} colour${Number(p.materialColorCnt) === 1 ? '' : 's'}`);
      if (p.needAms) facts.push('AMS');
      if (facts.length) lines.push(facts.join(' · '), '');
      // One setting per paragraph: one per line here
      const settings = htmlToMarkdown(p.summary || '', { image: target }).replace(/\n{2,}/g, '\n');
      if (settings) lines.push(settings, '');
      const fil = (p.instanceFilaments || []).filter(f => f && (f.type || f.color))
        .map(f => [f.type, f.color, Number(f.usedG) > 0 ? `${Math.round(Number(f.usedG))} g` : ''].filter(Boolean).join(' '));
      if (fil.length) lines.push(`Filaments: ${fil.join(', ')}`, '');
    }
  }

  const hardware = hardwareOf(design);
  if (hardware.length) {
    lines.push('## Hardware', '');
    for (const h of hardware) lines.push(`- ${h.qty} × ${h.name}${h.note ? ` (${h.note})` : ''}`);
    lines.push('');
  }

  const documents = [...(ext.design_other || []), ...(ext.design_guide || [])].filter(d => d && d.url);
  if (documents.length) {
    lines.push('## Documents', '');
    for (const d of documents) lines.push(`- [${String(d.name || 'Document').replace(/[[\]]/g, '')}](${mdTarget(target(d.url))})`);
    lines.push('');
  }

  const pictures = (ext.design_pictures || []).filter(p => p && p.url);
  if (pictures.length) {
    lines.push('## Gallery', '');
    lines.push(pictures.map(p => `![${String(p.name || '').replace(/[[\]]/g, '')}](${mdTarget(target(p.url))})`).join(' '));
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = {
  designIdOf, apiUrl, pageUrl, isAssetUrl, htmlToMarkdown, imagesOf, assetsOf, hardwareOf,
  buildReadme, marker, hasMarker, safeFileName
};
