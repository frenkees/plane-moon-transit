const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./helper');

const app = loadApp();
const { w, ev } = app;
test.after(() => app.close());
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (±${tol})`);

test('refrakce: astronomická a diferenciální', () => {
  near(w.refrDeg(10)*60, 5.3, 0.3, 'R(10°) [′]');
  near(w.refrDeg(45)*60, 1.0, 0.1, 'R(45°) [′]');
  near(w.diffRefr(10, 10000)/w.refrDeg(10), 0.59, 0.02, 'podíl pro letadlo 10 km');
  assert.ok(w.diffRefr(10, 400000)/w.refrDeg(10) < 0.03, 'ISS téměř bez rozdílu');
  near(w.diffRefr(10, 0)/w.refrDeg(10), 1, 0.01, 'objekt u země se neláme');
});

test('DR výšky: stoupání končí na zvolené hladině', () => {
  const a = { lat0: 50, lon0: 14, alt0: 5000, trk: 90, gsMs: 200, vrMs: 10, omega: 0, navAltEll: 6000 };
  near(w.acPosAt(a, 50).altEll, 5500, 1e-6);
  near(w.acPosAt(a, 300).altEll, 6000, 1e-6);
  near(w.acPosAt({ ...a, navAltEll: null }, 300).altEll, 8000, 1e-6);
  near(w.acPosAt({ ...a, navAltEll: 3000 }, 300).altEll, 8000, 1e-6, 'hladina proti směru se ignoruje');
  near(w.acPosAt({ ...a, vrMs: -10, navAltEll: 4000 }, 300).altEll, 4000, 1e-6);
});

test('mapAircraft: záměr, zdroj polohy, sanitace volačky', () => {
  const m = w.mapAircraft({ hex: 'abc', flight: 'CSA<b>1 ', t: 'a320', lat: 50, lon: 14, alt_geom: 20000, alt_baro: 19500,
    gs: 400, track: 100, track_rate: 1.5, roll: 20, nav_altitude_mcp: 30000, type: 'mlat', seen_pos: 2 });
  assert.equal(m.cs, 'CSAb1'); assert.equal(m.type, 'A320');
  assert.equal(m.trackRate, 1.5); assert.equal(m.posSrc, 'mlat');
  near(m.navAltEll, (30000 + 500)*0.3048, 0.01, 'MCP hladina posunutá o geom − baro');
  assert.ok(ev('isWeakPos')(m));
  const b = w.mapAircraft({ hex: 'x', lat: 50, lon: 14, alt_baro: 10000, gs: 300, track: 0, nav_altitude_mcp: 12000 });
  assert.equal(b.navNeedsGeoid, true); assert.equal(b.trackRate, null);
});

test('updateHistory: hlášený track_rate / náklon má přednost', () => {
  const hist = new w.Map();
  const a = { hex: 'h1', trk: 90, gsMs: 230, seenPos: 0, trackRate: 1.2, roll: null };
  w.updateHistory(hist, [a], Date.now());
  near(a.omega, 1.2, 1e-9); assert.equal(a.turning, true);
  const b = { hex: 'h2', trk: 90, gsMs: 230, seenPos: 0, trackRate: null, roll: 25 };
  w.updateHistory(hist, [b], Date.now());
  near(b.omega, 57.2958*9.81*Math.tan(25*Math.PI/180)/230, 1e-3);
  const c = { hex: 'h3', trk: 90, gsMs: 230, seenPos: 0, trackRate: null, roll: null };
  w.updateHistory(hist, [c], Date.now());
  assert.equal(c.omega, 0);
});

test('mergeFixes: kotvení stáří, aktualizace, vyřazení starých', () => {
  const t0 = 1e12;
  let list = w.mergeFixes([], [{ hex: 'a', seenPos: 2 }, { hex: 'b', seenPos: 1 }], t0, true);
  assert.equal(list[0].fixMs, t0 - 2000);
  list = w.mergeFixes(list, [{ hex: 'a', seenPos: 0.5 }, { hex: 'c', seenPos: 0 }], t0 + 5000, false);
  const by = Object.fromEntries(list.map(x => [x.hex, x]));
  near(by.a.seenPos, 0.5, 1e-9); near(by.b.seenPos, 6, 1e-9, 'b stárne ke nové kotvě');
  assert.ok(by.c);
  list = w.mergeFixes(list, [], t0 + 200000, false);
  assert.equal(list.length, 0, 'fixace starší než 90 s vypadnou');
});

test('narrowZone: bez kandidátů null, shluk → malý okruh, rozptyl → wide', () => {
  const opt = { tolDeg: 0.25 };
  assert.equal(w.narrowZone([], opt, 400000), null);
  const c = (lat, lon) => ({ refined: true, sep: 0.4, tHit: 60, mDiam: 0.52, lat, lon });
  const z = w.narrowZone([c(50, 14), c(50.05, 14.05)], opt, 400000);
  assert.ok(z.radius > 12000 && z.radius < 20000); near(z.center[0], 50.025, 1e-6);
  assert.equal(w.narrowZone([c(50, 14), c(53, 20)], opt, 400000).wide, true);
  assert.equal(w.narrowZone([{ ...c(50, 14), sep: 3 }], opt, 400000), null);
});

test('kalibrace: rozklad chyby na příčnou a podélnou, robustní měřítko', () => {
  const obs = { lat: 50, lon: 14, hEll: 300 };
  // letadlo letí na východ 20 km severně; predikce je o 200 m severněji (čistě příčná chyba)
  const f1 = { t: 0, lat: 50.18, lon: 13.99, alt: 10000 }, f2 = { t: 10000, lat: 50.18, lon: 14.03, alt: 10000 };
  const mid = { lat: 50.18, lon: 14.01 };
  const p = { tAbs: 5000, lead: 60, cs: 'T', la: mid.lat + 200/111320, lo: mid.lon, alt: 10000, sigma: 0.3, obs, altSrc: 'geom', turning: false };
  const r = w.calibResolve(p, f1, f2);
  assert.ok(Math.abs(r.along) < 0.02, 'podélná ~0: ' + r.along);
  near(Math.abs(r.cross), 0.25, 0.1, 'příčná [°]');
  // posun predikce po dráze o 1 s letu → čistě podélná chyba ≈ 1 s
  const v = 0.04/10;   // °lon za s
  const p2 = { ...p, la: mid.lat, lo: mid.lon + v };
  const r2 = w.calibResolve(p2, f1, f2);
  assert.ok(Math.abs(r2.cross) < 0.01); near(Math.abs(r2.alongS), 1, 0.05, 'časová chyba [s]');
  const recs = Array.from({ length: 30 }, (_, i) => ({ cross: (i % 2 ? 1 : -1)*0.2, crossM: 100, alongS: 1, sigma: 0.1 }));
  const st = w.calibStats(recs);
  near(st.kRaw, 2/0.6745, 1e-6); assert.equal(st.k, 2/0.6745 > 3 ? 3 : st.kRaw);
  assert.equal(w.calibStats(recs.slice(0, 5)).k, 1, 'pod 20 vzorků se nekalibruje');
});

test('predikce end-to-end: letadlo mířící na kotouč se najde s odstupem < R', () => {
  const res = ev(`(() => {
    const obs = { lat: 50, lon: 14, hMsl: 300, geoid: 44.5, hEll: 344.5 };
    const now = Date.now();
    // najdi čas v příštích 30 dnech, kdy je Měsíc 25–60° vysoko
    let t = now; for (let i = 0; i < 30*96; i++){ const m = targetTopoC(t, obs.lat, obs.lon, obs.hEll, 'moon'); if (m.el > 25 && m.el < 60) break; t += 900000; }
    const opt = { horizonMin: 5, horizonSec: 300, stepSec: 5, tolDeg: 0.25, hmin: 600, hmax: 13000, vmax: 950 };
    const z = computeZone(new Date(t), obs, opt, 'moon');
    const fleet = makeDemoFleet(obs, z, new Date(t), 'moon');
    const tr = buildTrack(t, obs, opt, 'moon');
    const e = enrich(t, [fleet[0]], obs, opt, tr, t)[0];
    return { sep: e.sep, tHit: e.tHit, R: e.mDiam/2, dur: e.dur, p: e.p, sigma: e.sigma, raw: e.sigmaRaw };
  })()`);
  assert.ok(res.sep < 0.02, 'odstup od středu ' + res.sep);
  near(res.tHit, 95, 0.5, 'čas průchodu');
  assert.ok(res.dur > 0.2 && res.dur < 5, 'trvání ' + res.dur);
  assert.equal(res.sigma, res.raw, 'bez kalibrace k = 1');
});
