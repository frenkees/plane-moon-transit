const test = require('node:test');
const assert = require('node:assert');
const { loadApp, wait } = require('./helper');

const AC = [{ hex: '49d0a1', flight: 'CSA123 ', t: 'A320', lat: 50.3, lon: 14.6, alt_geom: 36000, alt_baro: 35800, track: 270, gs: 450, seen_pos: 0.4 }];

test('stránka naběhne bez chyb a nabídne zdroje', async () => {
  const app = loadApp();
  await wait(200);
  assert.deepEqual([...app.$('srcSeg').children].map(b => b.textContent), ['LIVE · adsb.lol', 'LIVE · adsb.fi', 'SIMULACE']);
  assert.match(app.$('modelChip').textContent, /EFEM ✓/);
  assert.deepEqual(app.errors, []);
  app.close();
});

test('LIVE: dotaz jde přes proxy s hladinami, failover a backoff fungují', async () => {
  const app = loadApp({ ac: AC });
  await wait(150);
  app.$('start').click(); await wait(300);
  assert.match(app.urls[0], /^\/api\/aircraft\?src=lol&lat=[-\d.]+&lon=[-\d.]+&r=\d+&hmin=600&hmax=13000$/);
  assert.equal(app.$('src').textContent, 'adsb.lol');
  assert.equal(app.$('acCount').textContent, '1');
  app.$('stop').click(); app.state.mode = 'lolDown'; app.urls.length = 0;
  app.$('start').click(); await wait(300);
  assert.equal(app.urls.length, 2); assert.equal(app.$('src').textContent, 'adsb.fi');
  app.$('stop').click(); app.state.mode = 'fail';
  app.$('start').click(); await wait(300);
  assert.equal(app.$('mode').textContent, 'CHYBA SPOJENÍ');
  assert.match(app.$('warn').textContent, /Další pokus za 5 s/);
  assert.deepEqual(app.errors, []);
  app.$('stop').click(); app.close();
});

test('dvourychlostní poll: bez kandidátů se mezi širokými dotazy nic nestahuje', async () => {
  const app = loadApp({ ac: AC });
  await wait(150);
  app.$('start').click(); await wait(300);
  const n = app.urls.length;
  await app.ev('poll()'); await app.ev('poll()');
  assert.equal(app.urls.length, n, 'úzký dotaz bez kandidátů = žádný request');
  app.ev('S.lastWideMs = Date.now() - 60000');
  await app.ev('poll()');
  assert.equal(app.urls.length, n + 1, 'po uplynutí intervalu přijde široký dotaz');
  app.$('stop').click(); app.close();
});

test('SIMULACE: spoj CSA1337 skončí v tabulce jako přelet (je-li cíl nad obzorem)', async () => {
  const app = loadApp();
  await wait(150);
  app.ev(`S.source = 'demo'`);
  // najdi cíl, který je teď nad obzorem; jinak test přeskoč
  const up = app.ev(`['moon','sun'].find(t => targetTopoC(Date.now(), 50.0755, 14.4378, 244, t).el > 3) || null`);
  if (!up) { app.close(); return; }
  app.ev(`S.target = '${up}'`);
  app.$('start').click(); await wait(400);
  const best = app.ev(`(() => { const a = S.enriched.find(x => x.cs === 'CSA1337'); return a && { sep: a.sep, R: a.mDiam/2, t: a.tHit }; })()`);
  assert.ok(best && best.sep < best.R, 'CSA1337 protíná kotouč: ' + JSON.stringify(best));
  assert.match(app.$('rows').textContent, /CSA1337/);
  assert.deepEqual(app.errors, []);
  app.$('stop').click(); app.close();
});
