// ============================================================================
//  prediction.js — Predikce přeletů, zóna dotazu, naváděcí korekce
//  KLÍČOVÁ OPTIMALIZACE: poloha Měsíce v každém kroku se počítá JEDNOU
//  (buildMoonTrack) a sdílí se napříč všemi letadly — místo N×kroků volání.
// ============================================================================
import { moonTopo, rev, atan2d, sind, cosd, tand } from './astro.js';
import { aircraftAzEl, dest, angSep } from './geo.js';

// Extrapolovaná poloha letadla v čase (teď + tSecFuture) z kotvy fixace.
// fetchClientMs = klientský čas přijetí snímku (kotva dead reckoningu).
export function acPosAt(a, tSecFuture, fetchClientMs) {
  const dt = (a.seenPos || 0) + (Date.now() - fetchClientMs) / 1000 + (tSecFuture || 0);
  const [la, lo] = dest(a.lat0, a.lon0, a.trk, a.gsMs * dt);
  const alt = Math.max(0, a.alt0 + a.vrMs * dt);
  return { lat: la, lon: lo, altM: alt, dt };
}

// Předpočítaná efemerida Měsíce přes celý výhled (sdílená pro všechna letadla)
export function buildMoonTrack(nowMs, obs, horizonSec, stepSec) {
  const track = [];
  for (let t = 0; t <= horizonSec; t += stepSec) {
    const m = moonTopo(new Date(nowMs + t * 1000), obs.lat, obs.lon);
    track.push({ t, az: m.az, el: m.el, diam: m.diam });
  }
  return track;
}

// Pro jedno letadlo najdi krok s minimálním úhlovým odstupem od Měsíce.
export function predict(a, obs, track, fetchClientMs) {
  let best = { sep: 1e9, t: 0, az: 0, el: 0, la: null, lo: null, alt: 0,
               mAz: 0, mEl: 0, diam: 0.52, predEl: -99 };
  for (let i = 0; i < track.length; i++) {
    const mt = track[i];
    if (mt.el < 0) continue;
    const p = acPosAt(a, mt.t, fetchClientMs);
    const ae = aircraftAzEl(obs.lat, obs.lon, obs.h, p.lat, p.lon, p.altM);
    if (ae.el < 0) continue;
    const sep = angSep(ae.az, ae.el, mt.az, mt.el);
    if (sep < best.sep) {
      best = { sep, t: mt.t, az: ae.az, el: ae.el, la: p.lat, lo: p.lon,
               alt: p.altM, mAz: mt.az, mEl: mt.el, diam: mt.diam };
    }
  }
  return best;
}

// Zóna dotazu — kde hledat letadla (jen relevantní výsek oblohy)
export function computeZone(now, latO, lonO, hO, hmin, hmax, horizonMin, vmaxKmh, tolDeg) {
  const t0 = moonTopo(now, latO, lonO);
  const t1 = moonTopo(new Date(now.getTime() + horizonMin * 60000), latO, lonO);
  const elMin = Math.max(0.5, Math.min(t0.el, t1.el));
  const elMax = Math.max(t0.el, t1.el);
  const azMid = (() => {
    let a = t0.az, b = t1.az;
    if (Math.abs(a - b) > 180) { if (a < b) a += 360; else b += 360; }
    return rev((a + b) / 2);
  })();
  const dNear = hmin / tand(elMax);
  const dFar  = hmax / tand(elMin);
  const dMid  = (dNear + dFar) / 2;
  const reach = vmaxKmh * 1000 / 3600 * horizonMin * 60;
  const center = dest(latO, lonO, azMid, dMid);
  const radius = (dFar - dNear) / 2 + reach + dMid * tand(t0.diam / 2 + tolDeg) + 2000;
  return {
    center, radius, azMid, dNear, dFar, dMid, reach,
    elMin, elMax, moonEl: t0.el, moonAz: t0.az, diam: t0.diam, valid: t0.el > 0.5,
  };
}

// Naváděcí korekce — kam se přesunout, abych zachytil přelet (2D minimalizace).
export function correctionFor(a, obs, fetchClientMs) {
  if (a.sep == null || a.sep > 2.0 || a.tHit == null) return null;
  const A = { lat: a.predLa, lon: a.predLo, alt: a.altM };
  if (A.lat == null) return null;
  const mt = moonTopo(new Date(Date.now() + a.tHit * 1000), obs.lat, obs.lon);
  if (mt.el <= 0) return null;
  const cosLat = cosd(obs.lat);
  const evalSep = (de, dn) => {
    const dlat = dn / 111320, dlon = de / (111320 * cosLat);
    const ae = aircraftAzEl(obs.lat + dlat, obs.lon + dlon, obs.h, A.lat, A.lon, A.alt);
    return angSep(ae.az, ae.el, mt.az, mt.el);
  };
  let best = { sep: 9, de: 0, dn: 0 };
  for (let de = -2000; de <= 2000; de += 40)
    for (let dn = -2000; dn <= 2000; dn += 40) {
      const s = evalSep(de, dn); if (s < best.sep) best = { sep: s, de, dn };
    }
  for (let de = best.de - 40; de <= best.de + 40; de += 4)
    for (let dn = best.dn - 40; dn <= best.dn + 40; dn += 4) {
      const s = evalSep(de, dn); if (s < best.sep) best = { sep: s, de, dn };
    }
  const dlat = best.dn / 111320, dlon = best.de / (111320 * cosLat);
  const dist = Math.hypot(best.de, best.dn);
  const brg = rev(atan2d(best.de, best.dn));
  return {
    tgtLat: obs.lat + dlat, tgtLon: obs.lon + dlon,
    dist, brg, residSep: best.sep, tHit: a.tHit, origSep: a.sep,
  };
}
