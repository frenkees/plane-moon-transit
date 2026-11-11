# 🌕 LUNA·TRANSIT

Webová aplikace pro **predikci přeletů letadel a družic přes kotouč Měsíce nebo Slunce** z konkrétního stanoviště. Počítá topocentrickou polohu cíle, extrapoluje dráhy letadel z živých ADS-B dat a hlásí (zvukem, hlasem, vibrací, notifikací), kdy a odkud bude přelet vidět.

> **Slunce vždy jen s certifikovaným slunečním filtrem před objektivem.**

---

## 📁 Struktura

```
index.html              – celá aplikace (HTML + CSS + JS v jednom souboru, bez buildu)
api/aircraft.js         – Vercel funkce: proxy na ADS-B data (adsb.lol, adsb.fi)
api/tle.js              – Vercel funkce: proxy na dráhové elementy družic (CelesTrak)
manifest.webmanifest    – instalace na plochu telefonu (PWA)
icon-*.png              – ikony aplikace
tests/                  – headless testy (node:test + jsdom), do nasazení nejdou
.github/workflows/      – testy se spustí při každém pushi
```

Aplikace je záměrně **jeden soubor** — rozdělení do modulů se v minulosti při nasazení neosvědčilo. Uvnitř `index.html` je kód členěn do sekcí (`config`, `util`, `astro`, `geo`, `predict`, `data`, `render`, `app`).

---

## 🚀 Nasazení

Repozitář je napojený na **Vercel**: push do `main` = nové nasazení. Vercel sám nasadí statické soubory i funkce ve složce `api/` (bez konfigurace, bez závislostí, bez klíčů).

- Mimo Vercel (GitHub Pages, `file://`) funguje jen **SIMULACE** — živá data a družice potřebují proxy z `api/`.
- GPS, kompas, notifikace, Wake Lock, hlas a instalace na plochu vyžadují **https**.

Kontrola po nasazení:

```
/api/aircraft?src=lol&lat=50.08&lon=14.44&r=100   → JSON s klíči ac, now
/api/tle?id=25544                                 → JSON s klíči name, l1, l2
```

---

## 🌐 Data

| Co | Odkud | Poznámka |
|---|---|---|
| Letadla | **adsb.lol** (primární), **adsb.fi** (záloha) | formát ADSBExchange v2, limit ~1 dotaz/s |
| Družice | **CelesTrak** (TLE) | cache 2 h |
| Mapa | **OpenStreetMap** + Leaflet | načítá se až po zapnutí mapy |

Veřejná ADS-B API neposílají CORS hlavičky, proto je aplikace volá přes vlastní proxy `/api/aircraft`. Ta zároveň odpověď **odlehčí**: vrací jen pole, která aplikace čte, a zahodí letadla na zemi, mimo zadané hladiny a se starou fixací.

Dotazy jsou **dvourychlostní**: celá zóna se načítá jednou za ≥ 20 s, mezi tím jen úzký okruh kolem kandidátů. Když žádný kandidát není, mezi širokými dotazy se nestahuje nic. Při události bližší než 150 s se úzký dotaz zrychlí na 1,5 s. Po chybě se odstup pokusů prodlužuje (5–60 s).

Původní zdroje airplanes.live (HTTP 403, přístup jen na žádost) a adsb.one (zrušeno) byly vyřazeny.

---

## 🎯 Predikce

1. **Efemerida** — Měsíc dle Meeuse (kap. 47) s nutací a vektorovou topocentrickou paralaxou nad WGS-84; Slunce dle kap. 25. Při startu se ověřuje proti publikovanému příkladu Meeus 47.a (chip **EFEM**).
2. **Dráha letadla** — dead reckoning z poslední fixace. Zatáčky po oblouku (úhlová rychlost z hlášeného `track_rate` / náklonu, jinak z historie fixací). Stoupání a klesání končí na zvolené hladině (`nav_altitude_mcp`).
3. **Minimum odstupu** — hrubý sken → zlatý řez na ~0,05 s → kontaktní časy, trvání, tětiva.
4. **Diferenciální refrakce** — cíl se láme celou atmosférou, letadlo jen její částí (≈ 3′ při elevaci 10°).
5. **Nejistota σ a P(zásah)** — ze stáří fixace, stability kurzu, zdroje polohy (ADS-B × MLAT) a zdroje výšky (GNSS × baro).
6. **Kalibrace** — predikce pořízená ~60 s předem se porovná se skutečnou polohou letadla; od 20 vzorků se σ škáluje podle naměřených chyb. Vzorky jsou v `localStorage`, jdou exportovat do CSV.

---

## 🗺 V terénu

- **Mapa · osa tranzitu** — čára, ze které kandidát projde středem kotouče, a pás, ze kterého protne aspoň jeho okraj. Patička říká, kolik metrů a kterým směrem je nejbližší bod osy, s odkazy do Google Map a Mapy.cz.
- **Terénní režim** — celoobrazovkový odpočet, pípání v posledních 10 s, volitelně **hlas** (60/30/20/10/5 s) a **vibrace**.
- **Naváděcí korekce** — šipka vázaná na kompas telefonu.
- **Instalace** — nabídka prohlížeče → *Přidat na plochu*. Výpočet potřebuje otevřenou aplikaci a zapnutý displej (Wake Lock se zapíná sám).

---

## 🛰 Družice

Panel **Družice** stáhne aktuální TLE (ISS nebo Tiangong), modelem SGP4 projde příštích 10 dní a vypíše průlety, při kterých družice z dosažitelného okolí přejde přes Měsíc nebo Slunce: čas, kam dojet, úhlovou velikost, trvání. Tlačítko *Mapa* zakreslí osu, *Použít* přepne stanoviště na bod osy.

Přesnost TLE je řádově kilometr a s časem klesá — hledání opakuj den předem a v den přeletu a výsledek si ověř (např. transit-finder.com). Výška terénu cílového bodu se nezapočítává.

---

## 🧪 Testy

```bash
cd tests
npm install
npm test
```

Testy načtou `index.html` do jsdom a ověřují výpočetní funkce (refrakce, dráhy, osa tranzitu, kalibrace, hledání družic), obě proxy funkce a průchod stránkou (start, failover, backoff, simulace). Na GitHubu běží automaticky při každém pushi.

---

## 💾 Soukromí

Souřadnice, nastavení, uložené pozice i kalibrační vzorky zůstávají v `localStorage` prohlížeče. Na server odchází jen střed a poloměr dotazované zóny (proxy → ADS-B zdroj).

Data letadel © přispěvatelé adsb.lol (ODbL) a adsb.fi. Mapové podklady © přispěvatelé OpenStreetMap.
