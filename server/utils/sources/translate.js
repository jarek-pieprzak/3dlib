// Translation of the short names a site leaves in its own language (MakerWorld translates titles,
// descriptions and tags, not the names of plates, objects and files: those stay Chinese for a
// Chinese design). Names written in another script than Latin get a translation next to them:
// "配料台 (Stół do przygotowywania składników)", so the original stays recognisable.
//
// MyMemory (api.mymemory.translated.net): a free translation API without a key, about 5000
// characters a day per address; the source language is detected. Every translation is kept in the
// database (source_translations), so a name is asked for once. Google's free address answers
// automated requests with its bot check, so it is not used.
const API = 'https://api.mymemory.translated.net/get';
const MAX_PER_RUN = 80; // names asked for in one copy (the daily allowance is small)

// Names in Latin letters (with digits, punctuation, symbols) are left as they are
const LATIN = /^[\s\d\p{P}\p{S}\p{Script=Latin}]*$/u;
const needsTranslation = (s) => typeof s === 'string' && s.trim() !== '' && !LATIN.test(s);

// "<original> (<translation>)", or the original when there is nothing to add
function dual(original, translation) {
  const t = String(translation || '').trim();
  return t && t !== original && !original.includes(`(${t})`) ? `${original} (${t})` : original;
}

// A file or folder name with its translation before the extension: "甜甜圈.stl" -> "甜甜圈 (Pączek).stl"
function dualFileName(name, translation) {
  const m = /^(.*?)(\.[^./\s]{1,8})?$/.exec(name);
  const base = m[1] || name;
  const ext = m[2] || '';
  return `${dual(base, translation)}${ext}`;
}

// The stem of a file name, the part that is translated
const stemOf = (name) => (/^(.*?)(\.[^./\s]{1,8})?$/.exec(name)[1] || name);

// A translator for one copy: lang ('en', 'pl'...; 'original': none), db ({ get, run } of the
// database, for the cache), http (sources/http.js). translator.translate(texts) -> Map(original ->
// translation) for the texts that need one and could be translated.
function translator(lang, { db, http }) {
  let asked = 0;
  const off = !lang || lang === 'original';
  const translateOne = async (text) => {
    const cached = db.get('SELECT text FROM source_translations WHERE src = ? AND lang = ?', [text, lang]);
    if (cached) return cached.text;
    if (asked >= MAX_PER_RUN) return null;
    asked++;
    try {
      const r = await http.json(`${API}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`Autodetect|${lang}`)}`);
      const t = r && r.responseData && String(r.responseData.translatedText || '').trim();
      if (!t || Number(r.responseStatus) !== 200 || r.quotaFinished || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(t)) return null;
      db.run('INSERT OR REPLACE INTO source_translations (src, lang, text) VALUES (?, ?, ?)', [text, lang, t], true);
      return t;
    } catch (e) {
      return null;
    }
  };
  return {
    lang,
    async translate(texts) {
      const out = new Map();
      if (off) return out;
      for (const text of new Set((texts || []).filter(needsTranslation))) {
        const t = await translateOne(text);
        if (t) out.set(text, t);
      }
      return out;
    }
  };
}

module.exports = { translator, needsTranslation, dual, dualFileName, stemOf, API };
