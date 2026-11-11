// ============================================================================
//  /api/tle — same-origin proxy na dráhové elementy (TLE) z CelesTraku.
//  GET /api/tle?id=25544      (25544 = ISS, 48274 = Tiangong)
//  Odpověď: { id, name, l1, l2 }. Cache 2 h na edge — CelesTrak žádá nestahovat
//  stejná data častěji, elementy se stejně aktualizují jen několikrát denně.
// ============================================================================
const ALLOWED = { 25544: 'ISS', 48274: 'Tiangong' };
const UA = 'luna-transit/2.1 (+https://github.com/frenkees/plane-moon-transit)';

// Vytáhne z textu CelesTraku jméno a dva řádky elementů. Čistá funkce (testovaná).
function parseTle(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trimEnd()).filter(Boolean);
  const i1 = lines.findIndex(l => /^1 \d{5}/.test(l));
  if (i1 < 0 || !lines[i1 + 1] || !/^2 \d{5}/.test(lines[i1 + 1])) return null;
  const l1 = lines[i1], l2 = lines[i1 + 1];
  if (l1.length < 60 || l2.length < 60) return null;
  return { name: i1 > 0 ? lines[i1 - 1].trim() : '', l1, l2 };
}

async function handler(req, res) {
  const id = String((req.query || {}).id || '25544');
  if (!ALLOWED[id]) { res.status(400).json({ error: 'nepodporovaný objekt' }); return; }
  const url = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=' + id + '&FORMAT=TLE';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const up = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    const body = await up.text();
    if (!up.ok) { res.status(up.status).json({ error: 'upstream HTTP ' + up.status }); return; }
    const tle = parseTle(body);
    if (!tle) { res.status(502).json({ error: 'CelesTrak nevrátil platné TLE' }); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=21600');
    res.status(200).json({ id, name: tle.name || ALLOWED[id], l1: tle.l1, l2: tle.l2 });
  } catch (e) {
    const timeout = e && e.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({ error: timeout ? 'upstream timeout' : 'upstream nedostupný' });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.parseTle = parseTle;
