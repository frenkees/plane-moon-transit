// ============================================================================
//  storage.js — Perzistence v localStorage (uložené pozice + nastavení)
//  Data jsou u každého návštěvníka lokálně v prohlížeči, nic se nikam neodesílá.
// ============================================================================
import { LS } from './config.js';

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

// ---- Uložené pozice pozorovatele ----
export function loadPositions() {
  return safeParse(localStorage.getItem(LS.positions), []);
}
export function savePositions(arr) {
  try { localStorage.setItem(LS.positions, JSON.stringify(arr)); } catch {}
}
export function addPosition(pos) {
  const arr = loadPositions();
  arr.unshift(pos);
  if (arr.length > 20) arr.splice(20);
  savePositions(arr);
  return arr;
}
export function removePosition(index) {
  const arr = loadPositions();
  arr.splice(index, 1);
  savePositions(arr);
  return arr;
}

// ---- Nastavení (poslední poloha + parametry) ----
export function loadSettings() {
  return safeParse(localStorage.getItem(LS.settings), null);
}
export function saveSettings(obj) {
  try { localStorage.setItem(LS.settings, JSON.stringify(obj)); } catch {}
}
