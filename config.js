// ============================================================================
//  config.js — Centrální konfigurace aplikace LUNA·TRANSIT
//  Vše, co se typicky ladí nebo rozšiřuje, je na jednom místě.
// ============================================================================

// Fyzikální konstanty
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EARTH_R = 6371008.8; // střední poloměr Země [m]

// localStorage klíče
export const LS = {
  positions: 'lunar_transit_positions_v2',
  settings:  'lunar_transit_settings_v2',
};

// Dostupné datové zdroje letadel.
// Pro přidání dalšího zdroje (kompatibilního s ADSBExchange v2 formátem)
// stačí přidat položku sem — UI tlačítko se vygeneruje automaticky.
export const DATA_SOURCES = [
  {
    id:    'live',
    label: 'LIVE · airplanes.live',
    // {lat} {lon} {radius} se nahradí; radius je v námořních mílích
    url:   'https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}',
    note:  'Veřejné API, bez klíče. Limit ~1 dotaz/s.',
  },
  {
    id:    'adsbone',
    label: 'LIVE · adsb.one',
    url:   'https://api.adsb.one/v2/point/{lat}/{lon}/{radius}',
    note:  'Záložní zrcadlo (stejný formát).',
  },
  {
    id:    'demo',
    label: 'SIMULACE',
    url:   null, // syntetická data
    note:  'Lokální syntetický provoz pro test logiky (jedno letadlo projde kotoučem).',
  },
];

// Výchozí hodnoty (přepíší se uloženým nastavením návštěvníka)
export const DEFAULTS = {
  lat: 50.0755,
  lon: 14.4378,
  elev: 200,
  horizonMin: 20,     // výhled do budoucna [min]
  stepSec: 5,         // krok výpočtu [s]
  tolPct: 25,         // tolerance 0..100 → 0..1.0°
  hmin: 600,          // min. hladina [m]
  hmax: 13000,        // max. hladina [m]
  vmax: 950,          // max. rychlost [km/h]
  source: 'live',
  proxy: '',
  pollMs: 5000,       // interval dotazu na data [ms] (min 1000 dle limitu API)
  refreshMs: 1000,    // interval přepočtu + vykreslení [ms]
  alarmVol: 70,
  alarmThSec: 120,
  minSkyEl: 5,        // pod touto elevací se nezobrazují nekandidátní letadla
};

// Hranice ovládacích prvků
export const LIMITS = {
  pollMs:    { min: 1000, max: 30000, step: 1000 },
  refreshMs: { min: 250,  max: 5000,  step: 250 },
};
