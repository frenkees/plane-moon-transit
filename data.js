// ============================================================================
//  data.js — Datové zdroje: živé API (airplanes.live / adsb.one) + simulace
// ============================================================================
import { DATA_SOURCES } from './config.js';
import { moonTopo, rev } from './astro.js';
import { dest, aircraftAzEl } from './geo.js';

export function sourceById(id) {
  return DATA_SOURCES.find(s => s.id === id) || DATA_SOURCES[0];
}

// Normalizace záznamu z ADSBExchange-v2 kompatibilního API
function mapAircraft(a) {
  const altFt = (a.alt_baro === 'ground' ? 0 : (a.alt_baro ?? a.alt_geom ?? 0));
  return {
    cs:   (a.flight || a.r || a.hex || '?').trim(),
    lat0: a.lat, lon0: a.lon, alt0: altFt * 0.3048,   // kotva = poloha v čase fixace
    trk:  a.track ?? a.true_heading ?? 0,
    gsMs: (a.gs ?? 0) * 0.514444,
    vrMs: ((a.baro_rate ?? a.geom_rate ?? 0)) * 0.3048 / 60,
    seenPos: (a.seen_pos ?? a.seen ?? 0),             // stáří fixace [s]
  };
}

// Živé API. Záměrně NEpoužíváme custom hlavičky → "simple request" bez CORS preflightu.
export async function fetchLive(sourceId, obs, zone, proxy) {
  const src = sourceById(sourceId);
  const radiusNm = Math.min(250, Math.ceil(zone.radius / 1852) + 5);
  const c = zone.center;
  let url = src.url
    .replace('{lat}', c[0].toFixed(4))
    .replace('{lon}', c[1].toFixed(4))
    .replace('{radius}', radiusNm);
  if (proxy) url = proxy + encodeURIComponent(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const list = j.ac || j.aircraft || [];
  return list
    .filter(a => a.lat && a.lon && (a.alt_baro || a.alt_geom))
    .map(mapAircraft);
}

// Horizontální vzdálenost, kde má letadlo ve výšce h přesně elevaci targetEl
function solveDist(obs, h, brg, targetEl) {
  let lo = 1000, hi = 500000;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    const p = dest(obs.lat, obs.lon, brg, mid);
    const ae = aircraftAzEl(obs.lat, obs.lon, obs.h, p[0], p[1], h);
    if (ae.el > targetEl) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Simulace — perzistentní flotila; jedno letadlo přesně míří přes kotouč.
function makeDemoFleet(obs, zone, now) {
  const fleet = [];
  if (zone && zone.valid) {
    const tCross = 95, h = 10500;
    const mF = moonTopo(new Date(now.getTime() + tCross * 1000), obs.lat, obs.lon);
    const dCross = solveDist(obs, h, mF.az, mF.el);
    const CP = dest(obs.lat, obs.lon, mF.az, dCross);
    const trk = rev(mF.az - 90), gs = 240;
    const st = dest(CP[0], CP[1], rev(trk + 180), gs * tCross);
    fleet.push({ cs: 'CSA1337', lat0: st[0], lon0: st[1], alt0: h, trk, gsMs: gs, vrMs: 0, seenPos: 0 });
  }
  const rng = () => Math.random();
  const tags = ['RYR', 'EZY', 'DLH', 'AFR', 'KLM', 'WZZ', 'BAW', 'SWR'];
  for (let i = 0; i < 8; i++) {
    const brg = rng() * 360, dist = (15 + rng() * 130) * 1000, p = dest(obs.lat, obs.lon, brg, dist);
    fleet.push({
      cs: tags[i % 8] + Math.floor(1000 + rng() * 8000),
      lat0: p[0], lon0: p[1], alt0: 7500 + rng() * 4500,
      trk: rng() * 360, gsMs: 190 + rng() * 80, vrMs: (rng() - 0.5) * 4, seenPos: 0,
    });
  }
  return fleet;
}

// Stav simulace drží volající (state), aby byl modul bezstavový a snadno testovatelný.
export function fetchDemo(demoState, obs, zone, now) {
  if (!demoState.fleet) {
    demoState.fleet = makeDemoFleet(obs, zone, now);
    demoState.time = now.getTime();
  }
  const dt = (now.getTime() - demoState.time) / 1000;
  demoState.time = now.getTime();
  demoState.fleet.forEach(a => {
    const p = dest(a.lat0, a.lon0, a.trk, a.gsMs * dt);
    a.lat0 = p[0]; a.lon0 = p[1]; a.alt0 = Math.max(0, a.alt0 + a.vrMs * dt);
  });
  return demoState.fleet.map(a => ({ ...a }));
}
