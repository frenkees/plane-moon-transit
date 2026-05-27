// ============================================================================
//  geo.js — Geometrie: poloha letadla → az/el, posun po dráze, úhlový odstup
// ============================================================================
import { D2R, R2D, EARTH_R } from './config.js';
import { sind, cosd, tand, asind, atan2d, rev } from './astro.js';

export function ecef(lat, lon, h) {
  const r = EARTH_R + h;
  return [r * cosd(lat) * cosd(lon), r * cosd(lat) * sind(lon), r * sind(lat)];
}

// Az/el letadla z místa pozorovatele (sférická Země, zahrnuje zakřivení)
export function aircraftAzEl(latO, lonO, hO, lat, lon, h) {
  const o = ecef(latO, lonO, hO), p = ecef(lat, lon, h);
  const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
  const e = -sind(lonO) * dx + cosd(lonO) * dy;
  const n = -sind(latO) * cosd(lonO) * dx - sind(latO) * sind(lonO) * dy + cosd(latO) * dz;
  const u =  cosd(latO) * cosd(lonO) * dx + cosd(latO) * sind(lonO) * dy + sind(latO) * dz;
  const az = rev(atan2d(e, n));
  const el = atan2d(u, Math.sqrt(e * e + n * n));
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { az, el, dist };
}

// Cílový bod ve vzdálenosti dist (m) a azimutu brg (°) od (lat,lon)
export function dest(lat, lon, brg, dist) {
  const dr = dist / EARTH_R, la1 = lat * D2R, b = brg * D2R, lo1 = lon * D2R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la1),
                               Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return [la2 * R2D, ((lo2 * R2D + 540) % 360) - 180];
}

// Úhlový odstup dvou bodů na obloze (az/el ve °)
export function angSep(az1, el1, az2, el2) {
  const c = sind(el1) * sind(el2) + cosd(el1) * cosd(el2) * cosd(az1 - az2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const dla = (lat2 - lat1) * D2R, dlo = (lon2 - lon1) * D2R;
  const a = Math.sin(dla / 2) ** 2 + cosd(lat1) * cosd(lat2) * Math.sin(dlo / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * D2R;
  const y = Math.sin(dLon) * cosd(lat2);
  const x = cosd(lat1) * sind(lat2) - sind(lat1) * cosd(lat2) * Math.cos(dLon);
  return rev(atan2d(y, x));
}

// Světová strana zkratkou (česky)
const COMPASS = ['S', 'SSV', 'SV', 'VSV', 'V', 'VJV', 'JV', 'JJV',
                 'J', 'JJZ', 'JZ', 'ZJZ', 'Z', 'ZSZ', 'SZ', 'SSZ'];
export function compass(b) {
  return COMPASS[Math.round(rev(b) / 22.5) % 16];
}
