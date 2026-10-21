/* ─── Printer fit check ────────────────────────────────────────────────────
 * Does a part fit a printer? Its size (x × y × z mm as placed in the file, measured by the server)
 * against the build volume less a margin at the edges: the height must fit, and the footprint as
 * it is, turned 90° or turned by any angle on the bed (1° steps). A w × d rectangle turned by a
 * takes (w·cos a + d·sin a) × (w·sin a + d·cos a): exact for box-shaped parts, cautious for others
 * (a part that only fits by clever placing is reported as not fitting, never the other way).
 *
 * Pure functions: window.PrintFit in the browser, globalThis.PrintFit in the tests.
 */
globalThis.PrintFit = (function () {
  const EPS = 1e-6;

  // { ok, angle (0-90, the turn on the bed), reason ('height' | 'footprint') } or null without a size
  function fits(size, bed) {
    if (!Array.isArray(size) || size.length < 3 || !bed) return null;
    const m = Number(bed.margin) || 0;
    const X = Number(bed.x) - 2 * m;
    const Y = Number(bed.y) - 2 * m;
    const [w, d, h] = size.map(Number);
    if (h > Number(bed.z) + EPS) return { ok: false, angle: null, reason: 'height' };
    // Straight and turned 90° first, then the diagonals
    for (const a of [0, 90, ...Array.from({ length: 89 }, (_, i) => i + 1)]) {
      const r = (a * Math.PI) / 180;
      const c = Math.abs(Math.cos(r));
      const s = Math.abs(Math.sin(r));
      if (w * c + d * s <= X + EPS && w * s + d * c <= Y + EPS) return { ok: true, angle: a };
    }
    return { ok: false, angle: null, reason: 'footprint' };
  }

  // The printers of `beds` the part fits, with the turn each one needs
  function fitting(size, beds) {
    return (beds || []).map(bed => ({ bed, fit: fits(size, bed) })).filter(x => x.fit && x.fit.ok);
  }

  // A summary of parts [{ id, size, error }] for one printer (`chosen`: a bed id) or for any of
  // them ('any'): { total, measured, pending, failed, fit, misfit: [ids], sizes per id }
  function summarize(parts, beds, chosen) {
    const list = chosen && chosen !== 'any' ? (beds || []).filter(b => b.id === chosen) : (beds || []);
    const out = { total: 0, measured: 0, pending: 0, failed: 0, fit: 0, misfit: [] };
    for (const p of parts || []) {
      out.total++;
      if (p.error) { out.failed++; continue; }
      if (!p.size) { out.pending++; continue; }
      out.measured++;
      if (fitting(p.size, list).length) out.fit++;
      else out.misfit.push(p.id);
    }
    return out;
  }

  const sizeText = (size) => (Array.isArray(size) ? `${size.map(v => Math.round(v)).join(' × ')} mm` : '');

  return { fits, fitting, summarize, sizeText };
})();
