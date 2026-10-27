// Teacher-only extras from outside weather services. Nothing here runs unless the teacher has unlocked the Teacher view, so students
// never trigger these requests and never see these results.
//   1. A 3-day forecast for any place on Earth from Open-Meteo, shown for several forecast models side by side.
//   2. NOAA forecasters' charts for the coming days (North America).
//   3. A check of the computer-found fronts against NOAA's hand-drawn fronts, so the front finder can be tuned on real data.
import { $, esc, fmtT, fmtS, fmtRain, compass } from './util.js';
import { S, frameTime } from './data.js';
import { nearestOnPolyline } from './geo.js';
import { fetchFrontCharts, forecastCharts } from './mapview.js';
import { listFronts } from './tools.js';

const VARS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_direction_10m_dominant', 'weather_code'];
const MODEL_NAMES = { ecmwf_ifs025: 'ECMWF (Europe)', icon_global: 'ICON (Germany)', gfs_global: 'GFS (USA)', gfs_seamless: 'GFS (USA)', 'best match': 'Best match' };
const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
const wmo = c => c == null ? '—' : WMO[c] || `code ${c}`;

// ---- 1. a forecast from weather services for one place
const cache = new Map();
export function parseService(r) { // variable names get the model appended when several models are asked for: temperature_2m_max_icon_global
  const d = r && r.daily; if (!d || !d.time) return null;
  const models = {};
  for (const k of Object.keys(d)) {
    if (k === 'time') continue;
    const base = VARS.filter(v => k === v || k.startsWith(v + '_')).sort((a, b) => b.length - a.length)[0]; if (!base) continue;
    const model = k === base ? 'best match' : k.slice(base.length + 1);
    (models[model] ||= {})[base] = d[k];
  }
  return Object.keys(models).length ? { times: d.time, models } : null;
}
export async function fetchService(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`; if (cache.has(key)) return cache.get(key);
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=${VARS.join(',')}&wind_speed_unit=ms&timezone=auto&forecast_days=4`;
  for (const url of [`${base}&models=ecmwf_ifs025,icon_global,gfs_global`, base]) {   // several models if the service allows it, otherwise its best guess
    try { const p = parseService(await (await fetch(url)).json()); if (p) { cache.set(key, p); return p; } } catch { /* try the plain request */ }
  }
  throw new Error('no forecast');
}
export function serviceHTML(p) {
  const days = [1, 2, 3].filter(i => i < p.times.length), names = Object.keys(p.models);
  const cell = (m, i) => {
    const v = k => p.models[m][k] && p.models[m][k][i];
    if (v('temperature_2m_max') == null) return '<td class="muted">—</td>';
    return `<td><b>${fmtT(v('temperature_2m_max'))} / ${fmtT(v('temperature_2m_min'))}</b><br>${esc(wmo(v('weather_code')))}<br>${fmtRain(v('precipitation_sum'))}${v('precipitation_probability_max') != null ? ` (${Math.round(v('precipitation_probability_max'))}%)` : ''}<br>${v('wind_direction_10m_dominant') != null ? compass(v('wind_direction_10m_dominant')) + ' ' : ''}${v('wind_speed_10m_max') != null ? fmtS(v('wind_speed_10m_max')) : ''}</td>`;
  };
  return `<table class="tt svc-t"><tr><th></th>${names.map(m => `<th>${esc(MODEL_NAMES[m] || m)}</th>`).join('')}</tr>` +
    days.map(i => `<tr><td>Day ${i}<br><small class="muted">${esc(p.times[i].slice(5))}</small></td>${names.map(m => cell(m, i)).join('')}</tr>`).join('') + '</table>' +
    '<p class="small muted">Each cell: high / low, sky, rain (chance), wind. Where the models disagree, the forecast is less certain. Weather data by <b>Open-Meteo.com</b> (CC BY 4.0).</p>';
}
export async function fillServices(root) { // fills every placeholder in `root`, one request per place
  for (const el of root.querySelectorAll('.svc[data-lat]')) {
    if (el.dataset.done) continue; el.dataset.done = '1';
    try { el.innerHTML = serviceHTML(await fetchService(+el.dataset.lat, +el.dataset.lon)); }
    catch { el.innerHTML = '<p class="muted small">The weather-service forecast could not be loaded (it needs an internet connection).</p>'; }
  }
}
export const servicePlaceholder = (lat, lon) => `<h4>Weather-service forecast, 3 days</h4><div class="svc" data-lat="${lat}" data-lon="${lon}"><span class="muted small">Loading…</span></div>`;

// ---- 2. forecasters' fronts for the coming days
export async function loadForecasterCharts() {
  const today = new Date().toISOString().slice(0, 10), got = (await fetchFrontCharts()).filter(c => c.key > today);
  for (const c of got) forecastCharts[c.key] = c;
  return got.map(c => c.date).sort();
}

// ---- 3. how well do the computer-found fronts match NOAA's?
const NA = { lat: [15, 75], lon: [-170, -50] };
const inNA = ([la, lo]) => la >= NA.lat[0] && la <= NA.lat[1] && lo >= NA.lon[0] && lo <= NA.lon[1];
export function compareFronts(noaa, found) { // each is a list of { type, pts: [[lat, lon], ...] }
  const nearest = (pt, list) => { let best = null; for (const f of list) { const r = nearestOnPolyline(pt[0], pt[1], f.pts); if (r && (!best || r.km < best.km)) best = { km: r.km, type: f.type }; } return best; };
  let n = 0, hit = 0, same = 0;
  for (const f of noaa) for (const pt of f.pts) { n++; const b = nearest(pt, found); if (b && b.km <= 300) { hit++; if (b.type === f.type) same++; } }
  const cand = found.filter(f => f.pts.some(inNA)); let alarms = 0;
  for (const f of cand) { const far = f.pts.filter(inNA).every(pt => { const b = nearest(pt, noaa); return !b || b.km > 400; }); if (far) alarms++; }
  return { noaaPoints: n, matched: hit, typeSame: same, candidates: cand.length, falseAlarms: alarms };
}
export function frontCheckHTML() {
  const noaa = listFronts().filter(f => f.src === 'NOAA'), found = ((S.D.fr && S.D.fr[S.nPast - 1]) || []).map(f => ({ type: f.t, pts: f.p }));
  if (!noaa.length) return '<p class="muted small">NOAA’s chart is not loaded, so there is nothing to compare with. (It covers North America only.)</p>';
  const r = compareFronts(noaa, found), pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  return `<table class="tt"><tr><td>NOAA front points with a computer-found front within 300 km</td><td><b>${pct(r.matched, r.noaaPoints)}</b> (${r.matched} of ${r.noaaPoints})</td></tr>
    <tr><td>…and the computer got the type right (cold / warm / stationary)</td><td><b>${pct(r.typeSame, r.matched)}</b></td></tr>
    <tr><td>Computer-found fronts in North America with no NOAA front within 400 km</td><td><b>${r.falseAlarms} of ${r.candidates}</b></td></tr></table>
    <p class="small muted">If the first number is low, the finder is missing fronts: lower the settings below. If the last is high, it is inventing them: raise them. To change them, open the Actions tab, choose publish-map, press Run workflow, and enter <b>front_grad_min</b> (default 0.022) or <b>front_min_km</b> (default 900).</p>`;
}
