const test = require('node:test');
const assert = require('node:assert');
const aircraft = require('../api/aircraft.js');
const tle = require('../api/tle.js');

const mkRes = () => { const r = { h: {}, code: 0, body: null };
  r.setHeader = (k, v) => { r.h[k] = v; }; r.status = c => { r.code = c; return r; };
  r.json = o => { r.body = o; return r; }; r.send = b => { r.body = b; return r; }; return r; };
const upstream = (body, status = 200, hdr = {}) => async (u) => { upstream.last = u;
  return { ok: status < 400, status, headers: { get: k => hdr[k] || null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; };

const SAMPLE = { now: 1700000000000, ac: [
  { hex: 'a1', flight: 'CSA123 ', t: 'A320', lat: 50, lon: 14, alt_baro: 35000, alt_geom: 36000, gs: 450, track: 90, seen_pos: 1, squawk: '1000', rssi: -3, mlat: [], nav_altitude_mcp: 36000 },
  { hex: 'a2', lat: 50, lon: 14, alt_baro: 'ground', gs: 100 },
  { hex: 'a3', lat: 50, lon: 14, alt_baro: 3000, gs: 10 },
  { hex: 'a4', lat: 50, lon: 14, alt_baro: 200, gs: 120 },
  { hex: 'a5', lat: 50, lon: 14, alt_baro: 30000, gs: 400, seen_pos: 75 },
  { hex: 'a6', alt_baro: 30000, gs: 400 },
] };

test('proxy: správná upstream URL pro oba zdroje, poloměr omezen', async () => {
  global.fetch = upstream(SAMPLE);
  let r = mkRes(); await aircraft({ query: { src: 'lol', lat: '50.0755', lon: '14.4378', r: '120' } }, r);
  assert.equal(r.code, 200);
  assert.equal(upstream.last, 'https://api.adsb.lol/v2/point/50.0755/14.4378/120');
  r = mkRes(); await aircraft({ query: { src: 'fi', lat: '50', lon: '14', r: '9999' } }, r);
  assert.equal(upstream.last, 'https://opendata.adsb.fi/api/v2/lat/50.0000/lon/14.0000/dist/250');
});

test('proxy: odlehčení — jen potřebná pole, bez země, pomalých, starých a bez polohy', async () => {
  global.fetch = upstream(SAMPLE);
  const r = mkRes(); await aircraft({ query: { lat: '50', lon: '14', hmin: '600', hmax: '13000' } }, r);
  assert.deepEqual(r.body.ac.map(a => a.hex), ['a1']);      // a4 je pod hmin − 500 m
  assert.equal(r.body.now, SAMPLE.now);
  assert.equal(r.body.raw, 6);
  assert.ok(!('squawk' in r.body.ac[0]) && !('rssi' in r.body.ac[0]));
  assert.equal(r.body.ac[0].nav_altitude_mcp, 36000);
  const all = aircraft.slim(SAMPLE, NaN, NaN);
  assert.deepEqual(all.ac.map(a => a.hex), ['a1', 'a4']);   // bez hladin projde i a4
});

test('proxy: chybné vstupy a chyby upstreamu', async () => {
  let r = mkRes(); await aircraft({ query: { lat: 'x', lon: '14' } }, r);
  assert.equal(r.code, 400);
  global.fetch = upstream('slow down', 429, { 'retry-after': '5' });
  r = mkRes(); await aircraft({ query: { lat: '50', lon: '14' } }, r);
  assert.equal(r.code, 429); assert.equal(r.h['Retry-After'], '5');
  global.fetch = upstream('<html>', 200);
  r = mkRes(); await aircraft({ query: { lat: '50', lon: '14' } }, r);
  assert.equal(r.code, 502);
  global.fetch = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
  r = mkRes(); await aircraft({ query: { lat: '50', lon: '14' } }, r);
  assert.equal(r.code, 504);
});

test('tle: parsování a whitelist', async () => {
  const txt = 'ISS (ZARYA)             \r\n1 25544U 98067A   26315.50000000  .00016717  00000-0  30000-3 0  9990\r\n2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    10\r\n';
  const p = tle.parseTle(txt);
  assert.equal(p.name, 'ISS (ZARYA)'); assert.ok(p.l1.startsWith('1 25544')); assert.ok(p.l2.startsWith('2 25544'));
  assert.equal(tle.parseTle('No GP data found'), null);
  global.fetch = upstream(txt);
  let r = mkRes(); await tle({ query: { id: '25544' } }, r);
  assert.equal(r.code, 200); assert.equal(r.body.name, 'ISS (ZARYA)');
  assert.match(r.h['Cache-Control'], /s-maxage=7200/);
  r = mkRes(); await tle({ query: { id: '99999' } }, r);
  assert.equal(r.code, 400);
});
