// ============================================================================
//  app.js — Hlavní aplikace: stav, smyčky, UI, alarm, GPS, perzistence
//  Architektura smyček (kvůli CPU):
//    • POLL    — síťový dotaz na data            (interval = pollMs, default 5 s)
//    • REFRESH — přepočet predikcí + vykreslení  (interval = refreshMs, default 1 s)
//  Přepočet i vykreslení jsou oddělené od pollu; obojí lze zpomalit posuvníky.
//  Na pozadí (skrytá záložka) běží přepočet kvůli alarmu, ale kreslení se vynechá.
// ============================================================================
import { DEFAULTS, LIMITS, DATA_SOURCES } from './config.js';
import { moonTopo, nextMoonEvent, rev } from './astro.js';
import { haversine, dest, compass } from './geo.js';
import { acPosAt, buildMoonTrack, predict, computeZone, correctionFor } from './prediction.js';
import { fetchLive, fetchDemo, sourceById } from './data.js';
import { drawSky, drawRadar } from './render.js';
import * as store from './storage.js';
import { aircraftAzEl } from './geo.js';

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- stav
const S = {
  running: false, source: DEFAULTS.source,
  pollTimer: null, refreshTimer: null, cdTimer: null,
  pollMs: DEFAULTS.pollMs, refreshMs: DEFAULTS.refreshMs,
  nextPoll: 0,
  aircraft: [], enriched: [], obs: null, opt: null,
  fetchClientMs: Date.now(), selected: null, radarPts: [],
  demo: { fleet: null, time: 0 },
  navOn: false, gpsWatch: null, compassHeading: null,
};

// ---------------------------------------------------------------- čtení DOM
function readObs() {
  return { lat: parseFloat($('lat').value), lon: parseFloat($('lon').value), h: parseFloat($('elev').value) || 0 };
}
function readOpt() {
  return {
    horizonMin: +$('horizon').value, horizonSec: +$('horizon').value * 60,
    stepSec: +$('step').value,
    tolDeg: (+$('tol').value) / 100,
    hmin: +$('hmin').value, hmax: +$('hmax').value,
    vmax: +$('vmax').value, minSkyEl: DEFAULTS.minSkyEl,
  };
}

// ---------------------------------------------------------------- readouty Měsíce
function updateMoonReadout() {
  const obs = readObs(); if (isNaN(obs.lat)) return null;
  const now = new Date();
  const m = moonTopo(now, obs.lat, obs.lon);
  const m2 = moonTopo(new Date(now.getTime() + 600000), obs.lat, obs.lon);
  $('mAz').textContent = m.az.toFixed(2) + '°';
  $('mEl').textContent = m.el.toFixed(2) + '°';
  $('mEl').style.color = m.el > 0 ? 'var(--cyan)' : 'var(--red)';
  $('mDia').innerHTML = (m.diam * 60).toFixed(1) + '<small> ′</small>';
  $('mDist').innerHTML = Math.round(m.distKm).toLocaleString('cs') + '<small> km</small>';
  $('mPhase').textContent = m.phaseName + ' (' + Math.round(m.phaseFrac * 100) + '%)';
  const dAz = rev(m2.az - m.az); const drift = dAz > 180 ? dAz - 360 : dAz;
  $('mDrift').innerHTML = (drift > 0 ? '→ ' : '← ') + Math.abs(drift).toFixed(2) + '°<small>/10min</small>';
  const ev = nextMoonEvent(now, obs.lat, obs.lon);
  if (ev) {
    const h = Math.floor(ev.mins / 60), mm = Math.round(ev.mins % 60);
    const tStr = (h > 0 ? h + 'h ' : '') + mm + 'm';
    const loc = ev.when.toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' });
    $('mEventK').textContent = ev.rising ? 'Do východu' : 'Do západu';
    $('mEvent').innerHTML = (ev.rising ? '↑ ' : '↓ ') + tStr + ' <small>(' + loc + ')</small>';
    $('mEvent').style.color = ev.rising ? 'var(--amber)' : 'var(--cyan)';
  } else { $('mEvent').textContent = '—'; }
  return m;
}

function updateZoneReadout() {
  const obs = readObs(), opt = readOpt(); if (isNaN(obs.lat)) return null;
  const z = computeZone(new Date(), obs.lat, obs.lon, obs.h, opt.hmin, opt.hmax, opt.horizonMin, opt.vmax, opt.tolDeg);
  const distC = haversine(obs.lat, obs.lon, z.center[0], z.center[1]) / 1000;
  if (!z.valid) {
    $('zone').innerHTML = '<div class="note" style="color:#ffb3b3">⚠ Měsíc je pod obzorem (elevace ' +
      z.moonEl.toFixed(1) + '°). Přelet kotoučem teď není možný — zkus jiný čas.</div>';
    return z;
  }
  $('zone').innerHTML = `
    <div class="zrow"><span class="lbl">Azimut koridoru</span><span class="num">${z.azMid.toFixed(1)}°</span></div>
    <div class="zrow"><span class="lbl">Koridor (hladiny)</span><span class="num">${(z.dNear / 1000).toFixed(1)}–${(z.dFar / 1000).toFixed(1)} km</span></div>
    <div class="zrow"><span class="lbl">Střed zóny</span><span class="num">${distC.toFixed(1)} km @ ${z.azMid.toFixed(0)}°</span></div>
    <div class="zrow"><span class="lbl">Dolet letadel za ${opt.horizonMin} min</span><span class="num">${(z.reach / 1000).toFixed(0)} km</span></div>
    <div class="zrow ztot"><span class="lbl" style="color:var(--amber)">⌀ Poloměr dotazu</span><span class="num" style="font-size:17px">${(z.radius / 1000).toFixed(0)} km</span></div>
    <div class="note" style="margin-top:6px">Dotaz pokrývá jen výseč ve směru Měsíce + dolet — místo tisíců letadel jen relevantní hrstka.</div>`;
  return z;
}

// ---------------------------------------------------------------- predikce
function buildEnriched(list, obs, opt) {
  const nowMs = Date.now();
  const track = buildMoonTrack(nowMs, obs, opt.horizonSec, opt.stepSec); // 1× pro všechna letadla
  return list.map(a => {
    const p = acPosAt(a, 0, S.fetchClientMs);
    const cur = aircraftAzEl(obs.lat, obs.lon, obs.h, p.lat, p.lon, p.altM);
    const pr = predict(a, obs, track, S.fetchClientMs);
    return {
      ...a, lat: p.lat, lon: p.lon, altM: p.altM,
      az: cur.az, el: cur.el, distNow: cur.dist,
      predAz: pr.az, predEl: pr.el, predLa: pr.la, predLo: pr.lo,
      sep: pr.sep, tHit: pr.t, mDiam: pr.diam || 0.52,
    };
  });
}

// COMPUTE — přepočet (běží i na pozadí kvůli alarmu)
function compute() {
  S.obs = readObs(); S.opt = readOpt();
  if (isNaN(S.obs.lat)) return;
  S.enriched = buildEnriched(S.aircraft, S.obs, S.opt);
  S.enriched.sort((a, b) => a.sep - b.sep);
  if (S.running) checkAlarms(S.enriched, S.opt);
}

// DRAW — vykreslení (přeskočeno na skryté záložce)
function draw() {
  if (document.hidden) return;
  const obs = S.obs, opt = S.opt;
  const moon = updateMoonReadout();
  const zone = updateZoneReadout();
  const enriched = S.enriched;
  const hits = [], cands = [];
  enriched.forEach(a => {
    const thresh = a.mDiam / 2 + opt.tolDeg;
    if (a.sep < thresh * 4) cands.push(a);
    if (a.sep < thresh) hits.push(a);
  });
  const view = { selected: S.selected, tolDeg: opt.tolDeg, minSkyEl: opt.minSkyEl };
  drawSky($('sky'), moon, enriched, hits, view);
  S.radarPts = drawRadar($('radar'), obs, zone, enriched, hits, view);

  // tabulka
  const tb = $('rows'); tb.innerHTML = '';
  const show = enriched.filter(a => a.predEl > -2).slice(0, 14);
  if (!show.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">Žádná letadla v zóně…</td></tr>';
  }
  show.forEach(a => {
    const thresh = a.mDiam / 2 + opt.tolDeg;
    const isHit = a.sep < thresh, imminent = isHit && a.tHit < 60;
    const tr = document.createElement('tr');
    if (imminent) tr.className = 'imminent'; else if (isHit) tr.className = 'hit';
    if (a.cs === S.selected) tr.classList.add('selrow');
    let badge = `<span class="badge near">${a.sep.toFixed(2)}°</span>`;
    if (imminent) badge = '<span class="badge now">TEĎ</span>';
    else if (isHit) badge = '<span class="badge hit">PŘELET</span>';
    const mm = Math.floor(a.tHit / 60), ss = Math.round(a.tHit % 60);
    tr.style.cursor = 'pointer';
    tr.innerHTML = `<td class="cs">${a.cs}</td>
      <td>${a.tHit > 0 ? (mm > 0 ? mm + 'm' : '') + ss + 's' : '—'}</td>
      <td class="sep" style="color:${isHit ? 'var(--green)' : 'var(--txt)'}">${a.sep < 99 ? a.sep.toFixed(3) + '°' : '—'}</td>
      <td>${Math.round(a.altM)} m</td>
      <td>${badge}</td>`;
    tr.onclick = () => { S.selected = (S.selected === a.cs ? null : a.cs); draw(); };
    tb.appendChild(tr);
  });
  $('acCount').textContent = S.aircraft.length;
  $('candCount').textContent = cands.length;
  $('hitCount').textContent = hits.length;
  renderNav(enriched, obs, opt);
}

function refresh() {
  compute();
  draw();
}

// ---------------------------------------------------------------- naváděcí korekce
function renderNav(enriched, obs) {
  if (!S.navOn) return;
  const list = $('navList');
  const cands = enriched.filter(a => a.sep != null && a.sep <= 2.0 && a.predEl > 0)
                        .sort((x, y) => x.sep - y.sep).slice(0, 5);
  if (!cands.length) { list.innerHTML = '<div class="pos-empty">Žádná letadla do 2° odchylky.</div>'; return; }
  list.innerHTML = '';
  cands.forEach(a => {
    const co = correctionFor(a, obs, S.fetchClientMs);
    if (!co) return;
    const tight = co.dist < 25;
    const mm = Math.floor(co.tHit / 60), ss = Math.round(co.tHit % 60);
    const card = document.createElement('div');
    card.className = 'nav-card' + (tight ? ' tight' : '');
    if (a.cs === S.selected) card.style.boxShadow = 'inset 3px 0 0 var(--amber)';
    const headRef = (S.compassHeading != null) ? S.compassHeading : 0;
    const arrowRot = rev(co.brg - headRef);
    card.innerHTML = `
      <div class="nc-top"><span class="nc-cs">${a.cs}</span><span class="nc-miss">míjí o ${co.origSep.toFixed(2)}°</span></div>
      <div class="nc-main">
        <div class="nav-arrow"><svg viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="20" fill="none" stroke="#1d2731" stroke-width="1.5"/>
          <g transform="rotate(${arrowRot} 22 22)">
            <path d="M22 6 L29 30 L22 24 L15 30 Z" fill="${tight ? '#5ee08a' : '#ff9d2f'}" stroke="#03110f" stroke-width=".5"/>
          </g>
        </svg></div>
        <div class="nav-figs">
          <div class="nf-dist">${tight ? '✓ na místě' : Math.round(co.dist) + ' m'}</div>
          <div class="nf-dir">${tight ? 'drž pozici' : compass(co.brg) + ' · ' + Math.round(co.brg) + '°'}</div>
          <div class="nf-gps">${co.tgtLat.toFixed(6)}, ${co.tgtLon.toFixed(6)}</div>
        </div>
      </div>
      <div class="nc-foot"><span>přelet za ${mm > 0 ? mm + 'm ' : ''}${ss}s</span><span>po přesunu: <b>${co.residSep.toFixed(2)}°</b></span></div>`;
    card.onclick = () => { S.selected = (S.selected === a.cs ? null : a.cs); draw(); };
    card.style.cursor = 'pointer';
    list.appendChild(card);
  });
  if (!list.children.length) list.innerHTML = '<div class="pos-empty">Letadla do 2°, ale Měsíc je nízko / pod obzorem.</div>';
}

// ---------------------------------------------------------------- POLL
async function poll() {
  S.obs = readObs(); S.opt = readOpt();
  if (isNaN(S.obs.lat)) return;
  try {
    const z = computeZone(new Date(), S.obs.lat, S.obs.lon, S.obs.h, S.opt.hmin, S.opt.hmax, S.opt.horizonMin, S.opt.vmax, S.opt.tolDeg);
    if (!z.valid) setPill('err', 'MĚSÍC POD OBZOREM');
    if (S.source === 'demo') {
      S.aircraft = fetchDemo(S.demo, S.obs, z, new Date());
      S.fetchClientMs = Date.now();
      setPill('demo', 'SIMULACE'); $('src').textContent = 'synth';
    } else {
      S.aircraft = await fetchLive(S.source, S.obs, z, $('proxy').value.trim());
      S.fetchClientMs = Date.now();
      const src = sourceById(S.source);
      setPill('live', 'LIVE'); $('src').textContent = src.url.split('//')[1].split('/')[0];
      hideWarn();
    }
  } catch (e) {
    setPill('err', 'CHYBA SPOJENÍ'); $('src').textContent = '—';
    showWarn('Nepodařilo se načíst LIVE data: ' + e.message +
      '. Pravděpodobně CORS — zkus jiný LIVE zdroj, SIMULACI, nebo zadej proxy URL.');
  }
  refresh();
  S.nextPoll = Math.round(S.pollMs / 1000);
}

function setPill(cls, txt) { $('pill').className = 'pill ' + cls; $('mode').textContent = txt; }
function showWarn(t) { $('warn').textContent = t; $('warn').classList.add('show'); }
function hideWarn() { $('warn').classList.remove('show'); }

// ---------------------------------------------------------------- start/stop + plánování smyček
function scheduleLoops() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  if (S.refreshTimer) clearInterval(S.refreshTimer);
  S.pollTimer = setInterval(poll, S.pollMs);
  S.refreshTimer = setInterval(refresh, S.refreshMs);
}

function start() {
  S.obs = readObs(); S.opt = readOpt();
  if (isNaN(S.obs.lat) || isNaN(S.obs.lon)) { alert('Zadej platné GPS souřadnice.'); return; }
  S.running = true; S.demo.fleet = null;
  $('start').style.display = 'none'; $('stop').style.display = 'block';
  poll();
  scheduleLoops();
  if (S.cdTimer) clearInterval(S.cdTimer);
  S.cdTimer = setInterval(() => {
    if (S.nextPoll > 0) S.nextPoll--;
    $('cd').textContent = S.running ? S.nextPoll + 's' : '—';
  }, 1000);
  saveCurrentSettings();
}
function stop() {
  S.running = false;
  clearInterval(S.pollTimer); clearInterval(S.refreshTimer); clearInterval(S.cdTimer);
  $('start').style.display = 'block'; $('stop').style.display = 'none';
  setPill('', 'STANDBY'); $('cd').textContent = '—';
}

// ---------------------------------------------------------------- UI BINDING
$('horizon').oninput = e => { $('hzVal').textContent = e.target.value + ' min'; updateZoneReadout(); persistSoon(); };
$('step').oninput = e => { $('stepVal').textContent = e.target.value + ' s'; persistSoon(); };
$('tol').oninput = e => { $('tolVal').textContent = (e.target.value / 100).toFixed(2) + '°'; updateZoneReadout(); persistSoon(); };
['lat', 'lon', 'elev', 'hmin', 'hmax', 'vmax'].forEach(id => $(id).oninput = () => { updateMoonReadout(); updateZoneReadout(); persistSoon(); });

// Výkon — posuvníky frekvencí
$('pollRate').oninput = e => {
  S.pollMs = +e.target.value;
  $('pollRateVal').textContent = (S.pollMs / 1000).toFixed(0) + ' s';
  if (S.running) scheduleLoops();
  persistSoon();
};
$('refreshRate').oninput = e => {
  S.refreshMs = +e.target.value;
  const s = S.refreshMs / 1000;
  $('refreshRateVal').textContent = s.toFixed(2).replace(/\.?0+$/, '') + ' s · ' + (1 / s).toFixed(1) + ' fps';
  if (S.running) scheduleLoops();
  persistSoon();
};

// Datové zdroje — vygenerované z configu
function buildSourceButtons() {
  const seg = $('srcSeg'); seg.innerHTML = '';
  DATA_SOURCES.forEach(s => {
    const b = document.createElement('button');
    b.dataset.src = s.id; b.textContent = s.label; b.title = s.note;
    if (s.id === S.source) b.classList.add('on');
    b.onclick = () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); S.source = s.id; persistSoon();
    };
    seg.appendChild(b);
  });
}

$('start').onclick = start;
$('stop').onclick = stop;
$('setNow').onclick = () => { updateMoonReadout(); updateZoneReadout(); };
$('geo').onclick = () => {
  if (!navigator.geolocation) { alert('Geolokace není dostupná.'); return; }
  navigator.geolocation.getCurrentPosition(p => {
    $('lat').value = p.coords.latitude.toFixed(4);
    $('lon').value = p.coords.longitude.toFixed(4);
    if (p.coords.altitude) $('elev').value = Math.round(p.coords.altitude);
    updateMoonReadout(); updateZoneReadout(); persistSoon();
  }, err => alert('Geolokace selhala: ' + err.message));
};

// radar hover/klik
(function () {
  const svg = $('radar'), tip = $('radarTip');
  function nearest(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * 560, sy = (clientY - r.top) / r.height * 560;
    let best = null, bd = 16 * 16;
    (S.radarPts || []).forEach(p => { const dx = p.x - sx, dy = p.y - sy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } });
    return best;
  }
  svg.addEventListener('mousemove', e => {
    const p = nearest(e.clientX, e.clientY);
    if (p) {
      tip.style.display = 'block';
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      tip.innerHTML = `<div class="rt-cs">${p.cs}</div>
        <div class="rt-row">Rychlost <b>${Math.round(p.gsMs * 3.6)} km/h</b></div>
        <div class="rt-row">Výška <b>${Math.round(p.altM)} m</b></div>
        <div class="rt-row">Kurz <b>${Math.round(p.trk)}°</b></div>`;
      svg.style.cursor = 'pointer';
    } else { tip.style.display = 'none'; svg.style.cursor = 'default'; }
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  const tap = (cx, cy) => { const p = nearest(cx, cy); if (p) { S.selected = (S.selected === p.cs ? null : p.cs); draw(); } };
  svg.addEventListener('click', e => tap(e.clientX, e.clientY));
})();

// ---------------------------------------------------------------- naváděcí korekce / GPS / kompas
$('navOn').onchange = e => {
  S.navOn = e.target.checked;
  $('navBody').classList.toggle('disabled-look', !S.navOn);
  if (S.navOn && S.running) draw();
  else if (!S.navOn) $('navList').innerHTML = '<div class="pos-empty">Korekce vypnuta.</div>';
};
function setGpsStatus(txt, cls) { const s = $('gpsStatus'); s.textContent = txt; s.className = 'notif-status' + (cls ? ' ' + cls : ''); }
$('gpsLive').onclick = () => {
  if (!navigator.geolocation) { alert('Geolokace není dostupná.'); return; }
  setGpsStatus('GPS: zaměřuji…');
  S.gpsWatch = navigator.geolocation.watchPosition(p => {
    const { latitude, longitude, altitude, accuracy } = p.coords;
    $('lat').value = latitude.toFixed(6);
    $('lon').value = longitude.toFixed(6);
    if (altitude != null && !isNaN(altitude)) $('elev').value = Math.round(altitude);
    S.obs = { lat: latitude, lon: longitude, h: parseFloat($('elev').value) || 0 };
    setGpsStatus('GPS: aktivní · ±' + Math.round(accuracy) + ' m', 'ok');
    updateMoonReadout(); updateZoneReadout();
    if (S.running) draw();
  }, err => setGpsStatus('GPS chyba: ' + err.message, 'err'),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  $('gpsLive').style.display = 'none'; $('gpsStop').style.display = 'block';
  enableCompass();
};
$('gpsStop').onclick = () => {
  if (S.gpsWatch != null) { navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; }
  setGpsStatus('GPS: vypnuto');
  $('gpsLive').style.display = 'block'; $('gpsStop').style.display = 'none';
  S.compassHeading = null;
};
function enableCompass() {
  const handler = ev => {
    let h = null;
    if (ev.webkitCompassHeading != null) h = ev.webkitCompassHeading;
    else if (ev.alpha != null) h = 360 - ev.alpha;
    if (h != null) S.compassHeading = h;
  };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') window.addEventListener('deviceorientation', handler, true); }).catch(() => {});
  } else if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handler, true);
  } else {
    window.addEventListener('deviceorientation', handler, true);
  }
}

// ---------------------------------------------------------------- AUDIO ALARM
let audioCtx = null, alarmNodes = [], alarmMuted = false;
function getCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
function playAlarm() {
  if (alarmMuted) return;
  stopAlarmAudio();
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const vol = +$('alarmVol').value / 100;
    const pattern = [0, 0.18, 0.36];
    for (let rep = 0; rep < 100; rep++) {
      pattern.forEach(pt => {
        const t = ctx.currentTime + rep * 1.4 + pt;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(pt < 0.3 ? 880 : 1320, t);
        osc.frequency.setValueAtTime(pt < 0.3 ? 1100 : 1320, t + 0.06);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol * 0.6, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t); osc.stop(t + 0.15);
        alarmNodes.push(osc, gain);
      });
    }
  } catch (e) { console.warn('Audio error', e); }
}
function stopAlarmAudio() { alarmNodes.forEach(n => { try { n.disconnect(); } catch (_) {} }); alarmNodes = []; }
$('alarmVol').oninput = e => { $('volVal').textContent = e.target.value + '%'; persistSoon(); };
$('alarmTh').oninput = e => { $('alarmThVal').textContent = e.target.value + ' s'; persistSoon(); };

// ---------------------------------------------------------------- notifikace
function updateNotifStatus() {
  const s = $('notifStatus');
  if (!('Notification' in window)) { s.textContent = 'Notifikace: nepodporovány'; s.className = 'notif-status err'; return; }
  if (Notification.permission === 'granted') { s.textContent = 'Notifikace: povoleny ✓'; s.className = 'notif-status ok'; }
  else if (Notification.permission === 'denied') { s.textContent = 'Notifikace: zakázány v prohlížeči'; s.className = 'notif-status err'; }
  else { s.textContent = 'Notifikace: čeká na povolení'; s.className = 'notif-status'; }
}
$('notifReq').onclick = async () => {
  if (!('Notification' in window)) { alert('Prohlížeč notifikace nepodporuje.'); return; }
  await Notification.requestPermission(); updateNotifStatus();
};
function sendBrowserNotif(title, body) {
  if (('Notification' in window) && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23ffe9b0"/></svg>' }); } catch (_) {}
  }
}

// ---------------------------------------------------------------- ALARM stav
const ALARM = { active: false, dismissed: new Set(), lastTrigger: null };
let alarmWatchdog = null;
function resetAlarmWatchdog() { clearTimeout(alarmWatchdog); alarmWatchdog = setTimeout(() => { if (ALARM.active) dismissAlarm(); }, 30000); }
function triggerAlarm(ac, sepDeg, tHitSec) {
  if (ALARM.active || ALARM.dismissed.has(ac.cs)) return;
  ALARM.active = true; ALARM.lastTrigger = ac.cs;
  const mm = Math.floor(tHitSec / 60), ss = Math.round(tHitSec % 60);
  $('alarmCs').textContent = ac.cs;
  $('alarmDetail').innerHTML =
    `Za: <b>${mm > 0 ? mm + 'm ' : ''} ${ss}s</b> &nbsp;·&nbsp; Odstup: <b>${sepDeg.toFixed(3)}°</b><br>` +
    `Hladina: <b>${Math.round(ac.altM)} m</b> &nbsp;·&nbsp; Kurz: <b>${Math.round(ac.trk)}°</b>`;
  $('alarm').classList.add('show');
  playAlarm();
  sendBrowserNotif('🌕 PŘELET MĚSÍCE — ' + ac.cs,
    `Za ${mm > 0 ? mm + 'm ' : ''} ${ss}s · Odstup ${sepDeg.toFixed(3)}° · ${Math.round(ac.altM)} m`);
}
function dismissAlarm() {
  ALARM.active = false;
  if (ALARM.lastTrigger) ALARM.dismissed.add(ALARM.lastTrigger);
  $('alarm').classList.remove('show');
  stopAlarmAudio(); alarmMuted = false;
  setTimeout(() => { if (ALARM.lastTrigger) ALARM.dismissed.delete(ALARM.lastTrigger); }, 180000);
}
function muteAlarm() { alarmMuted = true; stopAlarmAudio(); }
$('alarmDismiss').onclick = dismissAlarm;
$('alarmMute').onclick = muteAlarm;

function checkAlarms(enriched, opt) {
  const thSec = +$('alarmTh').value;
  let best = null;
  enriched.forEach(a => {
    const thresh = (a.mDiam || 0.52) / 2 + opt.tolDeg;
    if (a.sep < thresh && a.tHit <= thSec) { if (!best || a.tHit < best.tHit) best = a; }
  });
  if (best) { resetAlarmWatchdog(); triggerAlarm(best, best.sep, best.tHit); }
  else if (ALARM.active) { resetAlarmWatchdog(); }
}

// ---------------------------------------------------------------- uložené pozice
function renderPosList() {
  const arr = store.loadPositions(); const wrap = $('posList'); wrap.innerHTML = '';
  if (!arr.length) { wrap.innerHTML = '<div class="pos-empty">Žádné uložené pozice</div>'; return; }
  arr.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'pos-item'; d.title = 'Klikni pro načtení';
    d.innerHTML = `<div><div class="pos-name">${p.name}</div><div class="pos-coords">${p.lat} · ${p.lon} · ${p.elev}m</div></div>
      <button class="pos-del" title="Smazat" aria-label="Smazat">✕</button>`;
    d.querySelector('.pos-del').onclick = e => { e.stopPropagation(); store.removePosition(i); renderPosList(); };
    d.onclick = () => { $('lat').value = p.lat; $('lon').value = p.lon; $('elev').value = p.elev; updateMoonReadout(); updateZoneReadout(); persistSoon(); };
    wrap.appendChild(d);
  });
}
$('posSave').onclick = () => {
  const name = $('posName').value.trim() || 'Pozice ' + new Date().toLocaleTimeString('cs');
  store.addPosition({ name, lat: $('lat').value, lon: $('lon').value, elev: $('elev').value || 0 });
  renderPosList(); $('posName').value = '';
};

// ---------------------------------------------------------------- perzistence nastavení
let persistTimer = null;
function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(saveCurrentSettings, 400); }
function saveCurrentSettings() {
  store.saveSettings({
    lat: $('lat').value, lon: $('lon').value, elev: $('elev').value,
    horizon: $('horizon').value, step: $('step').value, tol: $('tol').value,
    hmin: $('hmin').value, hmax: $('hmax').value, vmax: $('vmax').value,
    source: S.source, proxy: $('proxy').value,
    pollMs: S.pollMs, refreshMs: S.refreshMs,
    alarmVol: $('alarmVol').value, alarmTh: $('alarmTh').value,
  });
}
function applySettings(s) {
  if (!s) return;
  const set = (id, v) => { if (v != null && $(id)) $(id).value = v; };
  set('lat', s.lat); set('lon', s.lon); set('elev', s.elev);
  set('horizon', s.horizon); set('step', s.step); set('tol', s.tol);
  set('hmin', s.hmin); set('hmax', s.hmax); set('vmax', s.vmax);
  set('proxy', s.proxy);
  set('alarmVol', s.alarmVol); set('alarmTh', s.alarmTh);
  if (s.source && DATA_SOURCES.some(d => d.id === s.source)) S.source = s.source;
  if (s.pollMs) S.pollMs = Math.min(LIMITS.pollMs.max, Math.max(LIMITS.pollMs.min, s.pollMs));
  if (s.refreshMs) S.refreshMs = Math.min(LIMITS.refreshMs.max, Math.max(LIMITS.refreshMs.min, s.refreshMs));
}

// ---------------------------------------------------------------- UTC hodiny
setInterval(() => {
  const d = new Date();
  $('utc').textContent = d.toISOString().substr(11, 8);
  $('utcd').textContent = 'UTC · LOC ' + d.toTimeString().substr(0, 5);
}, 1000);

// ---------------------------------------------------------------- INIT
function syncLabels() {
  $('hzVal').textContent = $('horizon').value + ' min';
  $('stepVal').textContent = $('step').value + ' s';
  $('tolVal').textContent = (+$('tol').value / 100).toFixed(2) + '°';
  $('volVal').textContent = $('alarmVol').value + '%';
  $('alarmThVal').textContent = $('alarmTh').value + ' s';
  $('pollRate').value = S.pollMs; $('pollRateVal').textContent = (S.pollMs / 1000).toFixed(0) + ' s';
  $('refreshRate').value = S.refreshMs;
  const s = S.refreshMs / 1000;
  $('refreshRateVal').textContent = s.toFixed(2).replace(/\.?0+$/, '') + ' s · ' + (1 / s).toFixed(1) + ' fps';
}

function init() {
  applySettings(store.loadSettings());
  buildSourceButtons();
  syncLabels();
  $('navBody').classList.add('disabled-look');
  renderPosList();
  updateNotifStatus();
  updateMoonReadout();
  updateZoneReadout();
  const view = { selected: null, tolDeg: readOpt().tolDeg, minSkyEl: DEFAULTS.minSkyEl };
  drawSky($('sky'), updateMoonReadout(), [], [], view);
  drawRadar($('radar'), readObs(), null, [], [], view);
  setPill('', 'STANDBY');
  // překreslení při návratu na záložku
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running) draw(); });
}

init();
