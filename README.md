# 🌕 LUNA·TRANSIT

Webová aplikace pro **predikci přeletů letadel přes lunární kotouč** z vaší pozorovací pozice. Počítá topocentrickou polohu Měsíce, extrapoluje dráhy letadel z živých ADS-B dat a hlásí (zvukem + notifikací + overlayem), kdy a kde nějaký spoj Měsíc protne.

---

## 📁 Struktura projektu

Aplikace byla z původního jednoho HTML souboru **rozdělena do přehledných modulů** — kvůli snadné údržbě a rozšiřování. Každý soubor má jednu odpovědnost:

```
luna-transit/
├── index.html          – struktura stránky (žádná logika)
├── css/
│   └── styles.css       – veškerý vzhled + responzivita (desktop i mobil)
└── js/
    ├── config.js        – KONFIGURACE: konstanty, výchozí hodnoty, datové zdroje, limity
    ├── astro.js         – astronomie: poloha Měsíce/Slunce, fáze, východ/západ
    ├── geo.js           – geometrie: az/el letadla, vzdálenosti, azimuty
    ├── prediction.js    – predikce přeletů, zóna dotazu, naváděcí korekce
    ├── data.js          – načítání dat (LIVE API / simulace)
    ├── render.js        – vykreslování SVG (klenba oblohy + radar)
    ├── storage.js       – ukládání pozic a nastavení do localStorage
    └── app.js           – propojení všeho, UI, hlavní smyčka
```

> **Proč rozdělit, a ne jeden soubor?** Jeden 1500řádkový soubor se těžko upravuje a každá změna riskuje rozbití nesouvisející části. Moduly mají jasné hranice, jdou testovat samostatně a nová funkce se přidá do jednoho místa. Aplikace zůstává čistě statická — žádný build, žádné závislosti.

---

## 🚀 Nasazení (veřejně, zdarma)

Aplikace je **statický web** — funguje na jakémkoli hostingu statických souborů. Protože používá ES moduly, **musí běžet přes http(s)**, ne přes `file://`.

Nejjednodušší zdarma varianty:

1. **GitHub Pages** — nahrajte složku do repozitáře, v *Settings → Pages* zvolte větev. Web pojede na `https://uzivatel.github.io/repo/`.
2. **Netlify / Cloudflare Pages / Vercel** — přetáhněte složku do webového rozhraní (drag & drop). Hotovo za pár vteřin, dostanete veřejnou HTTPS adresu.
3. **Vlastní server** — stačí `nginx`/`apache` nebo i `python3 -m http.server` ve složce.

Lokální test:
```bash
cd luna-transit
python3 -m http.server 8000
# otevřete http://localhost:8000
```

---

## 🌐 Datový zdroj a CORS

Živá data: **adsb.lol** (primární) a **adsb.fi** (záloha), formát ADSBExchange v2. Tato API neposílají CORS hlavičky, proto je aplikace volá přes vlastní same-origin proxy **`/api/aircraft`** — Vercel serverless funkce v `api/aircraft.js` (bez závislostí, bez klíčů). Vercel ji nasadí automaticky, stačí mít složku `api/` v repozitáři.

- `GET /api/aircraft?src=lol|fi&lat=..&lon=..&r=..` (poloměr v námořních mílích, max 250)
- Původní zdroje **airplanes.live** (HTTP 403, přístup jen na žádost, 500 dotazů/den) a **adsb.one** (zrušeno) byly vyřazeny.
- Mimo Vercel (GitHub Pages, `file://`) funguje jen **SIMULACE**.
- Limit zdrojů ~1 dotaz/s; při chybě aplikace prodlužuje odstup pokusů (5–60 s).

---

## ⚙️ Výkon — proč už nežere CPU

Původní verze při každém snímku animace přepočítávala kompletní predikci pro všechna letadla, a v každém kroku znovu počítala polohu Měsíce → desetitisíce výpočtů za vteřinu.

Opravy:
- **Oddělené smyčky** — síťový *dotaz* (výchozí 5 s) a *překreslení* (výchozí 1 s) běží nezávisle a obě jsou v UI **plně nastavitelné posuvníkem**.
- **Sdílená dráha Měsíce** — poloha Měsíce v čase se spočítá jednou za cyklus (`buildMoonTrack`) a sdílí napříč všemi letadly, místo opakovaného výpočtu pro každé.
- **Výpočet běží i na pozadí** (kvůli alarmu), ale **kreslení se na skryté záložce vynechá**.

V panelu *Výkon · frekvence* si frekvence libovolně doladíte.

---

## 💾 Ukládání

Vlastní GPS souřadnice i nastavení se ukládají do **localStorage** prohlížeče — zůstanou zachované po zavření i restartu. Pojmenované pozice spravujete v panelu *Uložené pozice*.

---

## ➕ Jak přidat nový datový zdroj

Stačí přidat položku do pole `DATA_SOURCES` v `js/config.js`:

```js
{ id: 'mujzdroj', label: 'Můj zdroj',
  url: 'https://api.priklad.cz/v2/point/{lat}/{lon}/{radius}' }
```

Tlačítko v UI se vygeneruje automaticky. Formát odpovědi musí odpovídat ADSBExchange v2 (pole `ac` / `aircraft`), jinak upravte `mapAircraft()` v `js/data.js`.

---

## 🔬 Přesnost

Poloha Měsíce: zkrácená lunární teorie (Schlyter) + topocentrická paralaxa, přesnost ≈ 1′. Dráha letadla se extrapoluje z reportovaného kurzu, rychlosti a stáří poslední fixace polohy (dead reckoning). Přelet = úhlový odstup < (poloměr kotouče + tolerance).
