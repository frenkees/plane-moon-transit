// ============================================================================
//  astro.js — Astronomie: poloha Měsíce (Schlyter, topocentricky), Slunce, čas
//  Přesnost polohy Měsíce ~1′ (zkrácená lunární teorie + paralaxa).
// ============================================================================
import { D2R, R2D, EARTH_R } from './config.js';

export const rev   = x => { x = x % 360; return x < 0 ? x + 360 : x; };
export const sind  = x => Math.sin(x * D2R);
export const cosd  = x => Math.cos(x * D2R);
export const tand  = x => Math.tan(x * D2R);
export const asind = x => Math.asin(Math.max(-1, Math.min(1, x))) * R2D;
export const atan2d = (y, x) => Math.atan2(y, x) * R2D;

// Dní od 2000 Jan 0.0 (= 1999-12-31 00:00 UT)
export function dayNumber(date) {
  return date.getTime() / 86400000 - 10957.5;
}

// Geocentrická poloha Měsíce → RA/Dec + vzdálenost (v poloměrech Země)
export function moonGeo(d) {
  const N = rev(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = rev(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.054900;
  const M = rev(115.3654 + 13.0649929509 * d);
  // Keplerova rovnice
  let E = M + R2D * e * sind(M) * (1 + e * cosd(M));
  for (let k = 0; k < 6; k++) {
    E = E - (E - R2D * e * sind(E) - M) / (1 - e * cosd(E));
  }
  const xv = a * (cosd(E) - e), yv = a * Math.sqrt(1 - e * e) * sind(E);
  const v = atan2d(yv, xv);
  let r = Math.sqrt(xv * xv + yv * yv);
  const xe = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i));
  const ye = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i));
  const ze = r * (sind(v + w) * sind(i));
  let lon = atan2d(ye, xe), lat = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
  // Slunce — pro poruchy + siderický čas
  const ws = 282.9404 + 4.70935e-5 * d, Ms = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);
  const Lm = rev(N + w + M);
  const Dm = rev(Lm - Ls);
  const F  = rev(Lm - N);
  // Poruchy v délce (°)
  lon += -1.274 * sind(M - 2 * Dm) + 0.658 * sind(2 * Dm) - 0.186 * sind(Ms)
       - 0.059 * sind(2 * M - 2 * Dm) - 0.057 * sind(M - 2 * Dm + Ms) + 0.053 * sind(M + 2 * Dm)
       + 0.046 * sind(2 * Dm - Ms) + 0.041 * sind(M - Ms) - 0.035 * sind(Dm)
       - 0.031 * sind(M + Ms) - 0.015 * sind(2 * F - 2 * Dm) + 0.011 * sind(M - 4 * Dm);
  // Poruchy v šířce (°)
  lat += -0.173 * sind(F - 2 * Dm) - 0.055 * sind(M - F - 2 * Dm) - 0.046 * sind(M + F - 2 * Dm)
       + 0.033 * sind(F + 2 * Dm) + 0.017 * sind(2 * M + F);
  // Porucha vzdálenosti
  r += -0.58 * cosd(M - 2 * Dm) - 0.46 * cosd(2 * Dm);
  // Ekliptika → rovník
  const ecl = 23.4393 - 3.563e-7 * d;
  const xg = cosd(lon) * cosd(lat), yg = sind(lon) * cosd(lat), zg = sind(lat);
  const xq = xg, yq = yg * cosd(ecl) - zg * sind(ecl), zq = yg * sind(ecl) + zg * cosd(ecl);
  const RA = rev(atan2d(yq, xq)), Dec = asind(zq);
  return { RA, Dec, r, Ls, lon, Dm };
}

export function sunLon(d) {
  const ws = 282.9404 + 4.70935e-5 * d, Ms = rev(356.0470 + 0.9856002585 * d), e = 0.016709 - 1.151e-9 * d;
  const E = Ms + R2D * e * sind(Ms) * (1 + e * cosd(Ms));
  const xv = cosd(E) - e, yv = Math.sqrt(1 - e * e) * sind(E);
  const v = atan2d(yv, xv);
  return rev(v + ws);
}

const PHASE_NAMES = [
  'Nov', 'Dorůstající srpek', 'První čtvrť', 'Dorůstající měsíc',
  'Úplněk', 'Couvající měsíc', 'Poslední čtvrť', 'Couvající srpek',
];
export function moonPhaseName(ang) {
  return PHASE_NAMES[Math.round(rev(ang) / 45) % 8];
}

// Topocentrická poloha Měsíce (az/el) z pozorovacího místa
export function moonTopo(date, latO, lonO) {
  const d = dayNumber(date);
  const g = moonGeo(d);
  const UT = date.getUTCHours() + date.getUTCMinutes() / 60 +
             date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3.6e6;
  const GMST0 = rev(g.Ls + 180);
  const LST = rev(GMST0 + UT * 15 + lonO);
  let HA = rev(LST - g.RA); if (HA > 180) HA -= 360;

  // Topocentrická korekce (paralaxa)
  const mpar  = asind(1 / g.r);                 // horizontální paralaxa (~0.95°)
  const gclat = latO - 0.1924 * sind(2 * latO);
  const rho   = 0.99833 + 0.00167 * cosd(2 * latO);
  const gAux  = atan2d(tand(gclat), cosd(HA));
  const topRA = g.RA - mpar * rho * cosd(gclat) * sind(HA) / cosd(g.Dec);
  let topDec;
  if (Math.abs(sind(gAux)) < 1e-6) {
    // Ochrana proti dělení nulou poblíž rovníku / krajních HA
    topDec = g.Dec - mpar * rho * sind(gclat) * cosd(HA);
  } else {
    topDec = g.Dec - mpar * rho * sind(gclat) * sind(gAux - g.Dec) / sind(gAux);
  }
  let HA2 = rev(LST - topRA); if (HA2 > 180) HA2 -= 360;

  const sinEl = sind(latO) * sind(topDec) + cosd(latO) * cosd(topDec) * cosd(HA2);
  const el = asind(sinEl);
  let az = atan2d(sind(HA2), cosd(HA2) * sind(latO) - tand(topDec) * cosd(latO));
  az = rev(az + 180);

  const diam = 2 * asind(0.2725 * (1 / g.r));   // úhlový průměr Měsíce (°)
  const phaseAng = rev(g.lon - sunLon(d));      // 0=nov, 180=úplněk
  const elong = Math.acos(Math.max(-1, Math.min(1, cosd(phaseAng)))) * R2D;
  const phaseFrac = (1 - Math.cos(elong * D2R)) / 2;
  const waxing = phaseAng < 180;

  return {
    az, el, diam,
    distER: g.r, distKm: g.r * EARTH_R / 1000,
    phaseFrac, phaseName: moonPhaseName(phaseAng), phaseAng, waxing, HA: HA2,
  };
}

// Nejbližší budoucí východ/západ Měsíce
export function nextMoonEvent(now, lat, lon) {
  const h0 = -0.83, t0 = now.getTime();
  const elAt = ms => moonTopo(new Date(ms), lat, lon).el - h0;
  let prev = elAt(t0);
  for (let m = 5; m <= 1500; m += 5) {
    const e = elAt(t0 + m * 60000);
    if ((prev < 0) !== (e < 0)) {
      let lo = m - 5, hi = m, flo = elAt(t0 + lo * 60000);
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2, fm = elAt(t0 + mid * 60000);
        if ((flo < 0) !== (fm < 0)) hi = mid; else { lo = mid; flo = fm; }
      }
      const mins = (lo + hi) / 2;
      return { rising: elAt(t0 + hi * 60000) > 0, mins, when: new Date(t0 + mins * 60000) };
    }
    prev = e;
  }
  return null;
}
