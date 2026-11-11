// Načte index.html do jsdom a zpřístupní globální funkce aplikace.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadApp(opts = {}) {
  const urls = [];
  const state = { mode: 'ok', ac: opts.ac || [] };
  const vc = new VirtualConsole();           // potlač "Not implemented" hlášky jsdom
  const errors = [];
  vc.on('jsdomError', e => { if (!/Not implemented/.test(String(e.message))) errors.push(e.message); });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: opts.url || 'https://luna.example/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u) => {
        u = String(u); urls.push(u);
        if (opts.fetch) return opts.fetch(u, state);
        if (state.mode === 'fail' || (state.mode === 'lolDown' && u.includes('src=lol')))
          return { ok: false, status: 403, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ now: Date.now(), ac: state.ac }) };
      };
    },
  });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  return { w, $: id => w.document.getElementById(id), urls, state, errors, ev: code => w.eval(code),
    close: () => w.close() };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
module.exports = { loadApp, wait };
