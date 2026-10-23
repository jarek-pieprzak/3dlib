// Names with Polish letters. SQLite's LIKE, LOWER() and ORDER BY know only A-Z (and order by
// bytes: "benchy" after "Zebra", "Łożysko" after "Zębatka"), and localeCompare() without a locale
// follows the server's locale (POSIX in the Docker image: upper case first). The database
// registers fold, ulower and sortkey as SQL functions (server/database.js); the browser has the
// same rules in UI.foldText and UI.compareNames (public/js/components.js).

// Search form: lower case, accents dropped, "ł" as "l": "lozysko" finds "Łożysko M8"
function fold(s) {
  if (s == null) return null;
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

// Order like a Polish dictionary: case ignored, other accents dropped, a Polish letter right after
// its base letter ("a" < "ą" < "b", "z" < "ź" < "ż": U+FFFF sorts after every letter), numbers by
// value ("Part 2" before "Part 10")
const PL_LETTERS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
function sortKey(s) {
  if (s == null) return null;
  return Array.from(String(s).toLowerCase(), c => (PL_LETTERS[c] ? PL_LETTERS[c] + (c === 'ż' ? '\uffff\uffff' : '\uffff') : c))
    .join('').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, n => n.padStart(12, '0'));
}

// The same order in JS
const compareNames = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' }).compare;

module.exports = { fold, sortKey, compareNames };
