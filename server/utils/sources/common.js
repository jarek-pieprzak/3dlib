// What the source import (server/services/sourceImport.js) shares between the sites it copies
// (sources/makerworld.js, printables.js): HTML -> Markdown, the files a page brings
// and its README. Pure functions, no I/O; the tests load this file directly.
//
// A site module turns its data into a page:
//   { site, id, url, title, author, published, license,
//     description (HTML), sections: [{ title, html | markdown }],
//     pictures: [{ url, name }], documents: [{ url, name }], tags: [names],
//     hardware: [{ name, qty, note }],
//     files: [{ url, name, folder, unzip }] (the model files: STL, 3MF profiles...; unzip: a ZIP
//     whose entries go into the project folder) }

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
// Widgets and code of a page, not part of the text ("Boost me" is MakerWorld's tip box)
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

// ─── What a page brings along ────────────────────────────────────────────────

// A name that is a valid file name on SMB shares (the project folder lives on one)
function safeFileName(name, fallback) {
  let s = String(name || '').replace(/[<>:"/\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/ +(\.[^. ]+)$/, '$1').replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > 120) {
    const ext = (/\.[a-z0-9]{1,8}$/i.exec(s) || [''])[0];
    s = s.slice(0, 120 - ext.length).trim() + ext;
  }
  return s || fallback;
}

function extOf(url, fallback) {
  try {
    const m = /\.([a-z0-9]{1,8})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : fallback;
  } catch (e) { return fallback; }
}

// A file name with an extension ("Front view" from a picture URL ending in .jpg: "Front view.jpg");
// base: the name without an extension when there is none
function fileNameOf(name, url, base, defExt) {
  let n = safeFileName(name, base);
  if (!/\.[a-z0-9]{1,8}$/i.test(n)) n += `.${extOf(url, defExt)}`;
  return n;
}

// The HTML of a page that holds pictures: its description and the sections written in HTML
const htmlParts = (page) => [page.description || '', ...(page.sections || []).map(s => s.html || '')];

// The files to download, with where they go in the project folder:
// [{ url, rel, kind: 'description' | 'gallery' | 'document' | 'model' | 'archive' }]. Pictures of
// the description are numbered by their place in it, gallery pictures, documents and model files
// keep their names (model files in their folder of the site). isAsset(url): the hosts the site
// keeps its files on (nothing else is downloaded).
function assetsOf(page, isAsset) {
  const out = [];
  const taken = new Set();
  // extra: { size } when the site says how big the file is; { trusted } for a link the site's own
  // API gave (a signed link of its cloud storage)
  const add = (url, rel, kind, extra = {}) => {
    if (!url || !(isAsset(url) || (extra.trusted && /^https:\/\//i.test(url))) || out.some(a => a.url === url)) return;
    let r = rel;
    for (let i = 2; taken.has(r.toLowerCase()); i++) r = rel.replace(/(\.[^./]+)?$/, m => ` (${i})${m}`);
    taken.add(r.toLowerCase());
    out.push({ url, rel: r, kind, size: Number(extra.size) || 0 });
  };
  const inText = [];
  for (const html of htmlParts(page)) for (const src of imagesOf(html)) if (!inText.includes(src)) inText.push(src);
  inText.forEach((url, i) => add(url, `images/description-${String(i + 1).padStart(2, '0')}.${extOf(url, 'jpg')}`, 'description'));
  (page.pictures || []).forEach((p, i) => add(p.url, `images/${fileNameOf(p.name, p.url, `picture-${String(i + 1).padStart(2, '0')}`, 'jpg')}`, 'gallery'));
  for (const d of page.documents || []) add(d.url, fileNameOf(d.name, d.url, 'document', 'pdf'), 'document');
  for (const m of page.files || []) {
    const folder = String(m.folder || '').split(/[\\/]+/).map(p => safeFileName(p, '')).filter(Boolean).join('/');
    const name = fileNameOf(m.name, m.url, 'file', m.unzip ? 'zip' : 'bin');
    add(m.url, folder ? `${folder}/${name}` : name, m.unzip ? 'archive' : 'model', { size: m.size, trusted: m.trusted });
  }
  return out;
}

// First line of an imported README: a later import may overwrite only a README that has it
const marker = (url) => `<!-- 3dlib-source: ${url} -->`;
const hasMarker = (text) => /^\s*<!-- 3dlib-source: /.test(String(text || ''));

const day = (iso) => (/^\d{4}-\d{2}-\d{2}/.exec(String(iso || '')) || [''])[0];

// The README of the project: where it comes from and who made it, the description, the sections
// of the site (print profiles, settings, instructions), hardware, documents and the gallery.
// local(url): the project-relative path of a downloaded file (null: the file keeps its URL).
// today: "YYYY-MM-DD".
function buildReadme(page, { local = () => null, today = '' } = {}) {
  const target = (url) => local(url) || url;
  const lines = [marker(page.url), `# ${String(page.title || `${page.site} model ${page.id}`).trim()}`, ''];

  const facts = [`${page.author ? `By **${page.author}** on` : 'On'} [${page.site}](${mdTarget(page.url)})`];
  if (day(page.published)) facts.push(`published ${day(page.published)}`);
  if (page.license) facts.push(page.license);
  lines.push(facts.join(' · '));
  if (today) lines.push(`Copied by 3DLib on ${today}.`);
  lines.push('');

  const description = htmlToMarkdown(page.description || '', { image: target });
  if (description) lines.push(description, '');

  for (const s of page.sections || []) {
    const body = s.markdown !== undefined ? String(s.markdown).trim() : htmlToMarkdown(s.html || '', { image: target });
    if (body) lines.push(`## ${s.title}`, '', body, '');
  }

  const hardware = page.hardware || [];
  if (hardware.length) {
    lines.push('## Hardware', '');
    for (const h of hardware) lines.push(`- ${h.qty} × ${h.name}${h.note ? ` (${h.note})` : ''}`);
    lines.push('');
  }

  const documents = (page.documents || []).filter(d => d && d.url);
  if (documents.length) {
    lines.push('## Documents', '');
    for (const d of documents) lines.push(`- [${String(d.name || 'Document').replace(/[[\]]/g, '')}](${mdTarget(target(d.url))})`);
    lines.push('');
  }

  const files = (page.files || []).filter(m => m && m.url);
  if (files.length) {
    lines.push('## Files', '');
    for (const m of files) {
      const where = local(m.url);
      const label = [m.folder, m.name].filter(Boolean).join('/').replace(/[[\]]/g, '');
      if (m.unzip) lines.push(`- ${label}: ${where ? 'unpacked into this folder' : 'not downloaded'}`);
      else lines.push(where ? `- [${label}](${mdTarget(where)})` : `- ${label} (not downloaded)`);
    }
    lines.push('');
  }

  const pictures = (page.pictures || []).filter(p => p && p.url);
  if (pictures.length) {
    lines.push('## Gallery', '');
    lines.push(pictures.map(p => `![${String(p.name || '').replace(/[[\]]/g, '')}](${mdTarget(target(p.url))})`).join(' '));
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Plain text with line breaks as HTML (descriptions some sites keep as text)
function textToHtml(text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// "https:" URL whose host is one of `hosts` or under one of them
function onHosts(url, hosts) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch (e) { return false; }
}

module.exports = {
  htmlToMarkdown, imagesOf, mdTarget, safeFileName, extOf, assetsOf, buildReadme, marker, hasMarker,
  day, textToHtml, onHosts
};
