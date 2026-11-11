// ============================================================================
//  /api/aircraft — same-origin proxy na veřejná ADS-B API (Vercel serverless).
//  Důvod: adsb.lol ani adsb.fi neposílají CORS hlavičky, prohlížeč je napřímo
//  nezavolá. Funkce jen přepošle dotaz a vrátí JSON beze změny (ADSBx v2 formát).
//
//  GET /api/aircraft?src=lol|fi&lat=50.08&lon=14.44&r=120     (r v nám. mílích)
//  Bez závislostí, bez klíčů. Cizí weby ji z prohlížeče nepoužijí (žádné CORS).
// ============================================================================
const UPSTREAMS = {
  lol: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  fi:  (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
};
const UA = 'luna-transit/1.0 (+https://github.com/frenkees/plane-moon-transit)';

module.exports = async (req, res) => {
  const q = req.query || {};
  const src = UPSTREAMS[q.src] ? q.src : 'lol';
  const lat = Number(q.lat), lon = Number(q.lon);
  let r = Number(q.r);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat/lon mimo rozsah' });
    return;
  }
  r = Math.round(Math.min(250, Math.max(1, isFinite(r) ? r : 100)));

  const url = UPSTREAMS[src](lat.toFixed(4), lon.toFixed(4), r);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const up = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    const body = await up.text();
    res.setHeader('X-Upstream', src);
    if (!up.ok) {
      const ra = up.headers.get('retry-after');
      if (ra) res.setHeader('Retry-After', ra);
      res.status(up.status).json({ error: 'upstream HTTP ' + up.status, src, detail: body.slice(0, 200) });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 1 s na edge: více záložek / pozorovatelů nezatíží upstream nad limit 1 req/s
    res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=1');
    res.status(200).send(body);
  } catch (e) {
    const timeout = e && e.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({ error: timeout ? 'upstream timeout' : 'upstream nedostupný', src });
  } finally {
    clearTimeout(timer);
  }
};
