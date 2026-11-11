// ============================================================================
//  /api/aircraft — same-origin proxy na veřejná ADS-B API (Vercel serverless).
//  Důvod: adsb.lol ani adsb.fi neposílají CORS hlavičky, prohlížeč je napřímo
//  nezavolá. Funkce dotaz přepošle a odpověď ODLEHČÍ: ponechá jen pole, která
//  aplikace čte, a zahodí letadla na zemi / mimo hladiny / se starou fixací.
//
//  GET /api/aircraft?src=lol|fi&lat=50.08&lon=14.44&r=120[&hmin=600&hmax=13000]
//      r v námořních mílích (max 250), hmin/hmax v metrech (volitelné)
//  Bez závislostí, bez klíčů. Cizí weby ji z prohlížeče nepoužijí (žádné CORS).
// ============================================================================
const UPSTREAMS = {
  lol: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  fi:  (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
};
const UA = 'luna-transit/2.1 (+https://github.com/frenkees/plane-moon-transit)';

// Pole, která klient skutečně používá (viz mapAircraft v index.html)
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track',
  'true_heading', 'baro_rate', 'geom_rate', 'seen_pos', 'seen', 'track_rate', 'roll',
  'nav_altitude_mcp', 'nav_altitude_fms', 'nac_p', 'type'];

const FT = 0.3048;

// Odlehčení odpovědi. Čistá funkce — testuje se v tests/proxy.test.js.
function slim(json, hminM, hmaxM) {
  const src = (json && (json.ac || json.aircraft)) || [];
  const lo = isFinite(hminM) ? hminM - 500 : -Infinity;   // rezerva na geoid a baro odchylku
  const hi = isFinite(hmaxM) ? hmaxM + 500 : Infinity;
  const ac = [];
  for (const a of src) {
    if (a == null || a.lat == null || a.lon == null) continue;
    if (a.alt_baro === 'ground') continue;
    if (!(a.gs > 29)) continue;                             // ≈ 15 m/s, stejně jako klient
    if ((a.seen_pos ?? a.seen ?? 0) >= 60) continue;
    const altFt = isFinite(a.alt_geom) ? a.alt_geom : a.alt_baro;
    if (isFinite(altFt)) { const m = altFt * FT; if (m < lo || m > hi) continue; }
    const o = {};
    for (const k of KEEP) if (a[k] != null) o[k] = a[k];
    ac.push(o);
  }
  return { now: json && json.now != null ? json.now : Date.now(), total: ac.length, raw: src.length, ac };
}

async function handler(req, res) {
  const q = req.query || {};
  const src = UPSTREAMS[q.src] ? q.src : 'lol';
  const lat = Number(q.lat), lon = Number(q.lon);
  let r = Number(q.r);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat/lon mimo rozsah' });
    return;
  }
  r = Math.round(Math.min(250, Math.max(1, isFinite(r) ? r : 100)));
  const hmin = q.hmin != null && q.hmin !== '' ? Number(q.hmin) : NaN;
  const hmax = q.hmax != null && q.hmax !== '' ? Number(q.hmax) : NaN;

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
    let json;
    try { json = JSON.parse(body); } catch (e) {
      res.status(502).json({ error: 'upstream nevrátil JSON', src });
      return;
    }
    // 1 s na edge: více záložek / pozorovatelů nezatíží upstream nad limit 1 req/s
    res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=1');
    res.status(200).json(slim(json, hmin, hmax));
  } catch (e) {
    const timeout = e && e.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({ error: timeout ? 'upstream timeout' : 'upstream nedostupný', src });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.slim = slim;
