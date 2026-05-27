// ============================================================================
//  render.js — Vykreslování: klenba oblohy (az/el) a radarová mapa
//  Funkce jsou bezstavové — dostávají vše parametrem (snadné testování/rozšíření).
// ============================================================================
import { D2R } from './config.js';
import { haversine, dest } from './geo.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// Elevace 90 = střed, 0 = okraj
function skyXY(cx, cy, R, az, elev) {
  const rr = R * (90 - elev) / 90;
  const a = (az - 90) * D2R; // sever nahoru
  return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
}

// Osvětlená výseč Měsíce (polygon)
function moonPhasePoly(R, k, waxing, N = 28) {
  const T = R * (1 - 2 * k); let s = '';
  for (let i = 0; i <= N; i++) {
    const y = -R + 2 * R * i / N, xc = Math.sqrt(Math.max(0, R * R - y * y));
    s += (waxing ? xc : -xc).toFixed(2) + ',' + y.toFixed(2) + ' ';
  }
  for (let i = 0; i <= N; i++) {
    const y = R - 2 * R * i / N, xc = Math.sqrt(Math.max(0, R * R - y * y)), xt = T * xc / R;
    s += (waxing ? xt : -xt).toFixed(2) + ',' + y.toFixed(2) + ' ';
  }
  return s.trim();
}

export function drawSky(svg, moon, aircraft, hits, view) {
  const { selected, tolDeg, minSkyEl = 5 } = view;
  svg.innerHTML = '';
  const cx = 280, cy = 280, R = 250;
  svg.appendChild(el('circle', { cx, cy, r: R, fill: '#060a0e', stroke: '#1d2731', 'stroke-width': 1.5 }));
  [0, 30, 60].forEach(e => {
    const rr = R * (90 - e) / 90;
    svg.appendChild(el('circle', { cx, cy, r: rr, fill: 'none', stroke: '#13202b', 'stroke-width': 1 }));
    const lab = el('text', { x: cx + 4, y: cy - rr + 13, fill: '#3a4c58', 'font-size': 10, 'font-family': 'IBM Plex Mono' });
    lab.textContent = e + '°'; svg.appendChild(lab);
  });
  svg.appendChild(el('circle', { cx, cy, r: 2.5, fill: '#3a4c58' }));
  for (let a = 0; a < 360; a += 30) {
    const [x2, y2] = skyXY(cx, cy, R, a, 0);
    svg.appendChild(el('line', { x1: cx, y1: cy, x2, y2, stroke: '#0f1a22', 'stroke-width': 1 }));
  }
  [['S', 0], ['V', 90], ['J', 180], ['Z', 270]].forEach(([n, a]) => {
    const [x, y] = skyXY(cx, cy, R + 20, a, 0);
    const t = el('text', { x, y: y + 4, fill: '#6b7d8a', 'font-size': 14, 'font-family': 'Chakra Petch', 'font-weight': 600, 'text-anchor': 'middle' });
    t.textContent = n; svg.appendChild(t);
  });

  const isCand = a => a.sep != null && a.sep < ((a.mDiam || 0.52) / 2 + tolDeg) * 4;

  // Dráhy letu — jen kandidáti/přelet/vybrané (odplevelení)
  aircraft.forEach(a => {
    const isHit = hits.some(h => h.cs === a.cs), isSel = a.cs === selected;
    if (!(isHit || isSel || isCand(a))) return;
    if (a.el < -2 || a.predEl == null || a.predEl < -2) return;
    const [x1, y1] = skyXY(cx, cy, R, a.az, Math.max(a.el, 0));
    const [x2, y2] = skyXY(cx, cy, R, a.predAz, Math.max(a.predEl, 0));
    svg.appendChild(el('line', {
      x1, y1, x2, y2, stroke: isHit ? '#5ee08a' : '#c4761c',
      'stroke-width': isHit ? 2 : 1.4, 'stroke-dasharray': isHit ? '' : '3 3', opacity: isHit ? 0.9 : 0.55,
    }));
  });

  // Letadla
  aircraft.forEach(a => {
    if (a.el < 0) return;
    const isHit = hits.some(h => h.cs === a.cs), isSel = a.cs === selected, cand = isCand(a);
    const climbingIn = a.predEl != null && a.predEl > a.el;
    if (a.el < minSkyEl && !(isHit || isSel || cand || climbingIn)) return;
    const [x, y] = skyXY(cx, cy, R, a.az, a.el);
    const col = isHit ? '#5ee08a' : (isSel ? '#ff9d2f' : '#35e0d8');
    if (isSel) svg.appendChild(el('circle', { cx: x, cy: y, r: 13, fill: 'rgba(255,157,47,.15)', stroke: '#ff9d2f', 'stroke-width': 1.5 }));
    if (isHit) svg.appendChild(el('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: '#5ee08a', 'stroke-width': 1.2, opacity: 0.7 }));
    const g = el('g', { transform: `translate(${x},${y}) rotate(${a.trk})` });
    g.appendChild(el('path', { d: 'M0,-6 L4,5 L0,2 L-4,5 Z', fill: col, stroke: '#03110f', 'stroke-width': 0.5 }));
    svg.appendChild(g);
    if (isHit || isSel || cand || a.el >= 22) {
      const lab = el('text', { x: x + 8, y: y + 3, fill: col, 'font-size': 9.5, 'font-weight': isSel ? 600 : 400, 'font-family': 'IBM Plex Mono' });
      lab.textContent = a.cs; svg.appendChild(lab);
    }
  });

  // Měsíc s fází
  if (moon && moon.el > -2) {
    const [mx, my] = skyXY(cx, cy, R, moon.az, Math.max(moon.el, 0));
    const visR = Math.max(8, R * (moon.diam / 90) * 7);
    svg.appendChild(el('circle', { cx: mx, cy: my, r: visR + 5, fill: 'none', stroke: '#ffe9b0', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.5 }));
    svg.appendChild(el('circle', { cx: mx, cy: my, r: visR, fill: '#2a2418', opacity: moon.el > 0 ? 0.85 : 0.4 }));
    const poly = el('polygon', {
      points: moonPhasePoly(visR, moon.phaseFrac, moon.waxing),
      transform: `translate(${mx},${my})`, fill: '#ffe9b0', opacity: moon.el > 0 ? 0.97 : 0.45,
    });
    poly.setAttribute('style', 'filter:drop-shadow(0 0 7px rgba(255,233,176,.6))');
    svg.appendChild(poly);
    if (moon.el <= 0) {
      const t = el('text', { x: mx, y: my - visR - 6, fill: '#caa45e', 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono' });
      t.textContent = 'pod obzorem'; svg.appendChild(t);
    }
  }
}

export function drawRadar(svg, obs, zone, aircraft, hits, view) {
  const { selected } = view;
  svg.innerHTML = '';
  const cx = 280, cy = 280, R = 250;
  const rangeKm = Math.max(80, (zone ? (zone.radius + haversine(obs.lat, obs.lon, zone.center[0], zone.center[1])) / 1000 : 150) * 1.15);
  const kmToPx = R / rangeKm;
  svg.appendChild(el('rect', { x: 30, y: 30, width: 500, height: 500, fill: '#060a0e', stroke: '#1d2731', rx: 6 }));
  const ringStep = rangeKm <= 100 ? 25 : (rangeKm <= 300 ? 50 : 100);
  for (let k = ringStep; k <= rangeKm; k += ringStep) {
    svg.appendChild(el('circle', { cx, cy, r: k * kmToPx, fill: 'none', stroke: '#13202b', 'stroke-width': 1 }));
    const t = el('text', { x: cx + 2, y: cy - k * kmToPx + 12, fill: '#3a4c58', 'font-size': 9, 'font-family': 'IBM Plex Mono' });
    t.textContent = k + 'km'; svg.appendChild(t);
  }
  svg.appendChild(el('line', { x1: cx, y1: 30, x2: cx, y2: 530, stroke: '#0f1a22' }));
  svg.appendChild(el('line', { x1: 30, y1: cy, x2: 530, y2: cy, stroke: '#0f1a22' }));
  [['S', cx, 40], ['J', cx, 524], ['V', 524, cy + 3], ['Z', 38, cy + 3]].forEach(([n, x, y]) => {
    const t = el('text', { x, y, fill: '#6b7d8a', 'font-size': 12, 'font-family': 'Chakra Petch', 'text-anchor': 'middle', 'font-weight': 600 });
    t.textContent = n; svg.appendChild(t);
  });
  const toXY = (lat, lon) => {
    const dN = haversine(obs.lat, obs.lon, lat, obs.lon) * (lat >= obs.lat ? 1 : -1);
    const dE = haversine(obs.lat, obs.lon, obs.lat, lon) * (lon >= obs.lon ? 1 : -1);
    return [cx + dE / 1000 * kmToPx, cy - dN / 1000 * kmToPx];
  };
  if (zone && zone.valid) {
    const [zx, zy] = toXY(zone.center[0], zone.center[1]);
    svg.appendChild(el('circle', { cx: zx, cy: zy, r: zone.radius / 1000 * kmToPx, fill: 'rgba(53,224,216,.05)', stroke: '#1a9b95', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }));
    const [nx, ny] = toXY(...dest(obs.lat, obs.lon, zone.azMid, zone.dNear));
    const [fx, fy] = toXY(...dest(obs.lat, obs.lon, zone.azMid, zone.dFar));
    svg.appendChild(el('line', { x1: nx, y1: ny, x2: fx, y2: fy, stroke: '#ff9d2f', 'stroke-width': 3, opacity: 0.6, 'stroke-linecap': 'round' }));
    const lbl = el('text', { x: fx + 6, y: fy, fill: '#c4761c', 'font-size': 9, 'font-family': 'IBM Plex Mono' });
    lbl.textContent = 'koridor Měsíce'; svg.appendChild(lbl);
  }
  svg.appendChild(el('circle', { cx, cy, r: 4, fill: '#ff4d4d' }));
  svg.appendChild(el('circle', { cx, cy, r: 8, fill: 'none', stroke: '#ff4d4d', opacity: 0.5 }));

  const radarPts = [];
  aircraft.forEach(a => {
    const [x, y] = toXY(a.lat, a.lon);
    if (x < 30 || x > 530 || y < 30 || y > 530) return;
    const isHit = hits.some(h => h.cs === a.cs), isSel = a.cs === selected;
    radarPts.push({ cs: a.cs, x, y, gsMs: a.gsMs, altM: a.altM, trk: a.trk });
    if (isSel) svg.appendChild(el('circle', { cx: x, cy: y, r: 11, fill: 'rgba(255,157,47,.18)', stroke: '#ff9d2f', 'stroke-width': 1.5 }));
    const col = isHit ? '#5ee08a' : (isSel ? '#ff9d2f' : '#35e0d8');
    const g = el('g', { transform: `translate(${x},${y}) rotate(${a.trk})` });
    g.appendChild(el('path', { d: 'M0,-5 L3.5,4 L0,1.5 L-3.5,4 Z', fill: col }));
    svg.appendChild(g);
    if (isHit) svg.appendChild(el('circle', { cx: x, cy: y, r: 8, fill: 'none', stroke: '#5ee08a', opacity: 0.7 }));
  });
  return radarPts; // volající si je uloží pro hover/klik
}
