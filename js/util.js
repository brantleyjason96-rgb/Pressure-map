// Small helpers shared by every module: DOM, units, geometry, color ramps.
export const $ = id => document.getElementById(id);
export const on = id => $(id).checked;
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const range = (a, b, s) => { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; };
export const store = {
  get(k, d) { try { const v = localStorage.getItem('pm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('pm.' + k, JSON.stringify(v)); if (!['touched', 'backup', 'ui', 'seenHelp'].includes(k) && !k.startsWith('norm:')) localStorage.setItem('pm.touched', String(Date.now())); }
    catch { /* private window: just don't remember */ }
  },
  del(k) { try { localStorage.removeItem('pm.' + k); } catch { /* ignore */ } },
};

// ---- units: everything is stored in metric (°C, m/s, km, mm, hPa); these format for the chosen system
export const U = { sys: store.get('units', 'us') };
export const setUnits = s => { U.sys = s; store.set('units', s); document.dispatchEvent(new Event('units')); };
const us = () => U.sys === 'us';
export const tempOut = c => us() ? c * 9 / 5 + 32 : c;                 // number in the display unit
export const tempIn = x => us() ? (x - 32) * 5 / 9 : x;                 // display unit -> °C
export const tUnit = () => us() ? '°F' : '°C';
export const spdOut = ms => us() ? ms * 2.237 : ms * 3.6;
export const spdIn = x => us() ? x / 2.237 : x / 3.6;
export const sUnit = () => us() ? 'mph' : 'km/h';
export const fmtT = c => c == null || isNaN(c) ? '–' : Math.round(tempOut(c)) + tUnit();
export const fmtS = ms => Math.round(spdOut(ms)) + ' ' + sUnit();
export const fmtD = km => us() ? Math.round(km * 0.6214).toLocaleString() + ' mi' : Math.round(km).toLocaleString() + ' km';
export const fmtRain = mm => mm == null ? '–' : us() ? (mm / 25.4).toFixed(2) + ' in' : mm.toFixed(1) + ' mm';
export const fmtP = h => `${h.toFixed(1)} hPa` + (us() ? ` (${(h * 0.02953).toFixed(2)} inHg)` : '');
export const fmtElev = m => m == null ? 'n/a' : us() ? Math.round(m * 3.281).toLocaleString() + ' ft' : Math.round(m).toLocaleString() + ' m';

// ---- geometry on the sphere
const K = Math.PI / 180;
export function distKm(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * K / 2) ** 2 + Math.cos(la1 * K) * Math.cos(la2 * K) * Math.sin((lo2 - lo1) * K / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
export function bearing(la1, lo1, la2, lo2) { // degrees clockwise from north, from point 1 toward point 2
  const y = Math.sin((lo2 - lo1) * K) * Math.cos(la2 * K), x = Math.cos(la1 * K) * Math.sin(la2 * K) - Math.sin(la1 * K) * Math.cos(la2 * K) * Math.cos((lo2 - lo1) * K);
  return (Math.atan2(y, x) / K + 360) % 360;
}
const C16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => C16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
export const compass8 = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
export const windFrom = (u, v) => (Math.atan2(-u, -v) / K + 360) % 360;   // meteorological: the direction the wind blows FROM

// ---- color ramps. Return [r,g,b] or null (transparent below the first stop)
export function ramp(stops, v) {
  if (v < stops[0][0]) return null;
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (v - a) / (b - a);
    return ca.map((c, k) => c + (cb[k] - c) * f);
  }
  return stops.at(-1)[1];
}
