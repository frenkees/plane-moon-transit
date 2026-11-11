const test = require('node:test');
const assert = require('node:assert');
const { loadApp, wait } = require('./helper');
const satLib = require('satellite.js');
// jsdom má vlastní Date → satellite.js (instanceof Date) by cizí instance nepoznal; v prohlížeči se to neděje
const sat = { ...satLib, propagate: (r, d) => satLib.propagate(r, new Date(+d)), gstime: d => satLib.gstime(new Date(+d)) };

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (±${tol})`);

// Scéna se zaručeným kandidátem: demo letadlo mířící na Měsíc v okamžiku, kdy je 25–60° vysoko
const SCENE = `(() => {
  const obs = { lat: 50, lon: 14, hMsl: 300, geoid: 44.5, hEll: 344.5 };
  let t = Date.now(); for (let i = 0; i < 30*96; i++){ const m = targetTopoC(t, obs.lat, obs.lon, obs.hEll, 'moon'); if (m.el > 25 && m.el < 60) break; t += 900000; }
  const opt = { horizonMin: 5, horizonSec: 300, stepSec: 5, tolDeg: 0.25, hmin: 600, hmax: 13000, vmax: 950 };
  const fleet = makeDemoFleet(obs, computeZone(new Date(t), obs, opt, 'moon'), new Date(t), 'moon');
  const tr = buildTrack(t, obs, opt, 'moon');
  return { obs, t, opt, tr, a: enrich(t, [fleet[0]], obs, opt, tr, t)[0] };
})()`;

test('osa tranzitu: prochází stanovištěm, bod osy dává nulový odstup, pás má rozumnou šířku', () => {
  const app = loadApp(); const { w, ev } = app;
  const sc = ev(SCENE);
  const ax = w.transitAxis(sc.a, sc.obs, sc.tr, sc.a.seenPos);
  assert.ok(ax && ax.pts.length > 20);
  assert.ok(ax.foot.dist < 30, 'demo spoj míří přímo na stanoviště: ' + ax.foot.dist);
  near(ax.foot.t, sc.a.tHit, 0.3, 'čas průchodu osou');
  // kontrola nezávislým výpočtem: z bodu osy 3 km od stanoviště musí být odstup ~0
  const p = ax.pts.reduce((b, q) => Math.abs(Math.hypot(q.e, q.n) - 3000) < Math.abs(Math.hypot(b.e, b.n) - 3000) ? q : b);
  // (dráha cíle se musí přepočítat pro nové místo — místní svislice je tam jinak natočená)
  const o2 = { ...sc.obs, lat: p.lat, lon: p.lon };
  const sep = w.offsetAt(sc.a, p.t, o2, w.buildTrack(sc.t, o2, sc.opt, 'moon'), sc.a.seenPos).sep;
  assert.ok(sep < 0.01, 'odstup z bodu osy ' + sep + '°');
  // okraj pásu: odstup ≈ poloměr kotouče
  const i = ax.pts.indexOf(p), e = ax.left[i];
  const o3 = { ...sc.obs, lat: e[0], lon: e[1] };
  const sepE = w.offsetAt(sc.a, p.t, o3, w.buildTrack(sc.t, o3, sc.opt, 'moon'), sc.a.seenPos).sep;
  assert.ok(sepE > 0.15 && sepE < 0.30, 'odstup z okraje pásu ' + sepE + '° (R ≈ 0,26°)');
  assert.ok(ax.foot.w > 40 && ax.foot.w < 400, 'půlšířka pásu ' + ax.foot.w + ' m');
  app.close();
});

test('mapa: drawMap proběhne nad (falešným) Leafletem a vypíše pokyn', () => {
  const app = loadApp(); const { w, ev } = app;
  const calls = [];
  const obj = name => new Proxy({}, { get: (_, k) => (...a) => { calls.push(name + '.' + String(k)); return obj(name); } });
  w.L = new Proxy({}, { get: (_, k) => (...a) => { calls.push('L.' + String(k)); return obj(String(k)); } });
  ev(`(() => { const sc = ${SCENE};
    S.obs = sc.obs; S.opt = sc.opt; S.track = sc.tr; S.enriched = [sc.a]; S.lastComputeMs = sc.t; S.anchorMs = sc.t; S.running = true;
    S.mapOn = true; MAP.map = L.map(); MAP.layer = L.layerGroup(); drawMap(); })()`);
  assert.ok(calls.includes('L.polygon') && calls.includes('L.polyline'), 'kreslí pás i osu');
  assert.match(app.$('mapInfo').textContent, /CSA1337 · stojíš v pásu · osa \d+ m/);
  assert.match(app.$('mapInfo').innerHTML, /google\.com\/maps.*mapy\.cz/);
  assert.deepEqual(app.errors, []);
  app.close();
});

test('hlas a vibrace: alarm mluví a vibruje jen když je to zapnuté', () => {
  const app = loadApp(); const { w, ev } = app;
  const said = [], buzzed = [];
  w.SpeechSynthesisUtterance = function (t) { this.text = t; };
  w.speechSynthesis = { cancel() {}, speak(u) { said.push(u.text); } };
  w.navigator.vibrate = p => { buzzed.push(p); return true; };
  assert.equal(ev(`sayRel(135)`), '2 minuty 15 sekund');
  assert.equal(ev(`sayRel(60)`), '1 minutu');
  assert.equal(ev(`sayRel(5)`), '5 sekund');
  ev(`S.voiceOn = false; S.vibOn = false; say('x'); buzz(10)`);
  assert.equal(said.length + buzzed.length, 0);
  ev(`S.voiceOn = true; S.vibOn = true;
      triggerAlarm({ cs:'CSA123', tHit: 75, sep: 0.1, p: 0.6, altMsl: 10000 }); dismissAlarm();`);
  assert.equal(said[0], 'Přelet. C S A 1 2 3. Za 1 minutu 15 sekund.');
  assert.equal(buzzed.length, 1);
  app.close();
});

// TLE s epochou 2026-11-11 12:00 UTC (den 315,5) — jen pro geometrii, ne skutečná dráha
const L1 = '1 25544U 98067A   26315.50000000  .00010000  00000-0  18000-3 0  9990';
const L2 = '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    10';

test('družice: nalezené události sedí s nezávislým přepočtem a bod osy dává nulový odstup', () => {
  const app = loadApp(); const { w } = app;
  const satFn = w.makeSatFn(sat, sat.twoline2satrec(L1, L2));
  const t0 = Date.UTC(2026, 10, 11, 12, 0, 0);
  const P = satFn(t0);
  assert.ok(P.hEll > 380e3 && P.hEll < 440e3 && Math.abs(P.lat) < 52, 'poloha ISS: ' + JSON.stringify(P));
  const obs = { lat: 50, lon: 14, hMsl: 300, geoid: 44.5, hEll: 344.5 };
  const t1 = Date.now();
  const evs = w.satFindEvents(satFn, obs, t0, 10, 10, 109);
  const ms = Date.now() - t1;
  assert.ok(evs.length >= 1, 'za 10 dní aspoň jeden průchod do 10°');
  assert.ok(ms < 20000, 'výpočet trval ' + ms + ' ms');
  for (const e of evs) {
    assert.ok(e.sep <= 10 && e.el >= 4, `sep ${e.sep} el ${e.el}`);
    // minimum je opravdu minimum
    const s = dt => w.satSep(obs, satFn(e.t + dt), e.t + dt, e.target).sep;
    assert.ok(s(0) <= s(-300) + 1e-6 && s(0) <= s(300) + 1e-6, 'lokální minimum');
    near(s(0), e.sep, 1e-6);
    // z bodu osy je družice ve středu kotouče
    const o2 = { lat: e.align.lat, lon: e.align.lon, hEll: obs.hEll };
    const r = w.satSep(o2, satFn(e.align.t), e.align.t, e.target).sep;
    assert.ok(r < 0.01, 'reziduum z bodu osy ' + r + '°');
    assert.ok(e.dur > 0.2 && e.dur < 6, 'trvání ' + e.dur);
    assert.ok(e.sizeArcsec > 5 && e.sizeArcsec < 70, 'velikost ' + e.sizeArcsec);
    // bod osy je nejbližší: posun po ose o 1 s letu je dál od stanoviště
    for (const dt of [-1000, 1000]) {
      const nb = w.alignObserver(obs, satFn(e.align.t + dt), e.align.t + dt, e.target);
      // (jen v dosahu, který UI nabízí — dál už rovinná projekce paty ztrácí přesnost)
      if (nb && e.align.dist < 300e3) assert.ok(nb.dist >= e.align.dist - 100, `pata kolmice: ${nb.dist} vs ${e.align.dist}`);
    }
  }
  const close = evs.filter(e => e.align.dist < 300e3).length;
  console.log('   do 300 km: ' + close + ', nejbližší osa ' + Math.round(Math.min(...evs.map(e => e.align.dist))/1000) + ' km');
  console.log('   událostí: ' + evs.length + ', výpočet ' + ms + ' ms, první: ' + JSON.stringify({ t: new Date(evs[0].t).toISOString(), tgt: evs[0].target, sep: +evs[0].sep.toFixed(2), km: +(evs[0].align.dist/1000).toFixed(1) }));
  app.close();
});

test('družice: UI — hledání přes /api/tle vyplní tabulku, „Použít" přepne stanoviště', async () => {
  const app = loadApp({ fetch: async (u) => u.startsWith('/api/tle')
    ? { ok: true, status: 200, json: async () => ({ id: '25544', name: 'ISS', l1: L1, l2: L2 }) }
    : { ok: true, status: 200, json: async () => ({ now: Date.now(), ac: [] }) } });
  const { w, ev, $ } = app;
  await wait(100);
  w.satellite = sat;                                   // knihovna „už načtená"
  ev(`_libs[CDN.satellite[0]] = Promise.resolve(); $('issMaxKm').value = '300';`);
  // TLE má epochu 2026-11-11; ať test nezávisí na dnešním datu, posuň hodiny aplikace na epochu
  ev(`(() => { const off = Date.UTC(2026, 10, 11, 12) - Date.now(), N = Date.now.bind(Date); Date.now = () => N() + off; })()`);
  $('issGo').click();
  for (let i = 0; i < 100 && ev('ISS.busy || !ISS.sat'); i++) await wait(100);
  assert.match($('issStatus').textContent, /ISS: \d+ udál/);
  assert.equal(app.urls.filter(u => u.startsWith('/api/tle')).join(), '/api/tle?id=25544');
  const n = ev('ISS.events.length');
  if (n) {
    assert.equal($('issRows').children.length, n);
    const lat0 = $('lat').value;
    $('issRows').querySelector('[data-act=use]').click();
    assert.notEqual($('lat').value, lat0);
    near(+$('lat').value, ev('ISS.events[0].align.lat'), 1e-5);
  }
  assert.deepEqual(app.errors, []);
  app.close();
});
