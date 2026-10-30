// "My Place": pick a spot, then show only what a forecaster needs: the present, the recent past, and the normals.
// Nothing here looks forward in time.
import { $, esc, store, fmtT, fmtS, fmtP, fmtD, fmtRain, fmtElev, compass, windFrom, tempOut, spdOut, tUnit, sUnit, distKm, bearing, range } from './util.js';
import { S, sample, nearestSystem, frameTime } from './data.js';
import { markEvid } from './evid.js';
import { hooks, setPin, flyTo, map, redraw } from './mapview.js';

export const P = { place: store.get('place', null), picking: false, normals: null };
const STARTERS = [
  ['Seattle, WA', 47.61, -122.33, 53, 'mountains · coast'], ['Hilo, HI', 19.72, -155.09, 11, 'island · mountains'],
  ['Denver, CO', 39.74, -104.99, 1609, 'mountains · plains'], ['San Francisco, CA', 37.77, -122.42, 16, 'coast · ocean current'],
  ['Miami, FL', 25.76, -80.19, 2, 'coast · ocean current'], ['Chicago, IL', 41.88, -87.63, 181, 'big lake · fronts'],
  ['Boston, MA', 42.36, -71.06, 10, 'coast · fronts'], ['Anchorage, AK', 61.22, -149.9, 31, 'mountains · coast'],
  ['Lima, Peru', -12.05, -77.04, 154, 'coast · ocean current'], ['Bergen, Norway', 60.39, 5.32, 12, 'mountains · ocean current'],
  ['Reykjavik, Iceland', 64.15, -21.94, 14, 'island · lows'], ['Perth, Australia', -31.95, 115.86, 31, 'coast · Southern Hemisphere'],
  ['Cape Town, South Africa', -33.92, 18.42, 25, 'mountains · ocean current'], ['Christchurch, New Zealand', -43.53, 172.64, 20, 'mountains · Southern Hemisphere'],
  ['Tokyo, Japan', 35.68, 139.69, 40, 'coast · ocean current'], ['Salt Lake City, UT', 40.76, -111.89, 1288, 'mountains · lake'],
];

const now = () => S.nPast - 1;
const at = h => S.hours.indexOf(h);                              // index of the frame h hours before now (frames are 3 h apart)
const dayTicks = n => Array.from({ length: n }, (_, i) => i).filter(i => S.hours[i] % 24 === 0);   // -48, -24 and now
const when = () => frameTime(now()).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const pinBtn = (topic, text) => `<button class="pinbtn" data-topic="${topic}" data-text="${esc(text)}">📌 Add to notes</button>`;
export function pastSeries(pl = P.place) { // model analysis at the place for each past frame (never forecast)
  const o = { hours: S.hours.slice(0, S.nPast), t: [], d: [], p: [], spd: [], dir: [], pr: [] };
  for (let i = 0; i < S.nPast; i++) {
    const f = k => sample(S.D.f[k][i], pl.lat, pl.lon), u = f('u'), v = f('v');
    o.t.push(f('t')); o.d.push(f('d')); o.p.push(f('p')); o.spd.push(Math.hypot(u, v)); o.dir.push(windFrom(u, v)); o.pr.push(S.D.f.pr[i] ? f2(S.D.f.pr[i], pl) : null);
  }
  return o;
}
const f2 = (g, pl) => sample(g, pl.lat, pl.lon);

// ---- Open-Meteo: place search + the normal high/low (average of past years around today's date; history, not forecast)
async function geocode(q) {
  const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`)).json();
  return (r.results || []).map(x => ({ name: [x.name, x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude, elev: x.elevation }));
}
async function fetchElev(lat, lon) { // USGS (US, very accurate), then Open-Meteo (worldwide); separate from the history lookup
  try {
    const r = await (await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Meters&wkid=4326`)).json(), v = parseFloat(r.value);
    if (isFinite(v) && v > -500) return v;
  } catch {}
  const r = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`)).json();
  return Array.isArray(r.elevation) ? r.elevation[0] : null;
}
async function fetchNormals(lat, lon) {
  const td = new Date(), key = `norm:${lat.toFixed(1)},${lon.toFixed(1)}:${td.getUTCMonth()}-${td.getUTCDate()}`, hit = store.get(key, null);
  if (hit) return hit;
  const y = td.getUTCFullYear(); let D, r = {};
  try { // NASA POWER daily history (no key, generous limits)
    const j = await (await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN&community=ag&longitude=${lon}&latitude=${lat}&start=${y - 15}0101&end=${y - 1}1231&format=json`)).json(), q = j.properties.parameter, t = Object.keys(q.T2M_MAX);
    const ok = v => v > -900 ? v : null;
    D = { time: t.map(k => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`), temperature_2m_max: t.map(k => ok(q.T2M_MAX[k])), temperature_2m_min: t.map(k => ok(q.T2M_MIN[k])) };
  } catch { // backup: Open-Meteo
    r = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${y - 15}-01-01&end_date=${y - 1}-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=auto`)).json(); D = r.daily;
  }
  if (!D) throw new Error('no data');
  const doy = (m, d) => Date.UTC(2001, m, d) / 864e5, today = doy(td.getUTCMonth(), td.getUTCDate());
  let hs = 0, hn = 0, ls = 0, ln = 0;
  D.time.forEach((s, i) => {
    const m = +s.slice(5, 7) - 1, d = +s.slice(8, 10); let diff = Math.abs(doy(m, d) - today); diff = Math.min(diff, 365 - diff);
    if (diff > 7) return;
    if (D.temperature_2m_max[i] != null) { hs += D.temperature_2m_max[i]; hn++; }
    if (D.temperature_2m_min[i] != null) { ls += D.temperature_2m_min[i]; ln++; }
  });
  if (!hn || !ln) throw new Error('no data');
  const out = { hi: hs / hn, lo: ls / ln, elev: r.elevation, years: 15 };
  store.set(key, out); return out;
}

// ---- choosing the place
export async function setPlace(pl, fly = true) {
  P.place = { name: pl.name, lat: +pl.lat, lon: +pl.lon, elev: pl.elev ?? null }; P.normals = 'loading';
  store.set('place', P.place); setPin(P.place); if (fly) flyTo(P.place.lat, P.place.lon, 5);
  renderCard(); document.dispatchEvent(new Event('placechange'));
  if (!$('tab-place').hidden) { $('pstartd').open = false; $('pcard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (P.place.elev == null) fetchElev(P.place.lat, P.place.lon).then(e => { if (e != null && P.place) { P.place.elev = e; store.set('place', P.place); renderCard(); } }).catch(() => {});
  try {
    const n = await fetchNormals(P.place.lat, P.place.lon);
    if (P.place.elev == null && n.elev != null) P.place.elev = n.elev, store.set('place', P.place);
    P.normals = n;
  } catch { P.normals = 'error'; }
  renderCard(); document.dispatchEvent(new Event('placechange'));
}
function startPicking(on) {
  P.picking = on; $('ppick').classList.toggle('active', on); $('ppick').textContent = on ? 'Click the map… (cancel)' : '📍 Pick on the map';
  $('map').style.cursor = on ? 'crosshair' : '';
}

// ---- small charts
function spark(vals, { fmt, color, cur, arrows }) {
  const W = 300, H = 66, pd = 5, n = vals.length, ok = vals.filter(v => v != null && !isNaN(v));
  if (!ok.length) return '';
  let lo = Math.min(...ok), hi = Math.max(...ok); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const X = i => pd + i * (W - 2 * pd) / (n - 1), Y = v => H - pd - (v - lo) / (hi - lo) * (H - 2 * pd);
  const pts = vals.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
  let g = '';
  dayTicks(n).forEach(i => { g += `<line x1="${X(i)}" x2="${X(i)}" y1="0" y2="${H}" stroke="#fff2"/><text x="${Math.min(Math.max(X(i), 14), W - 14)}" y="${H + 12}" text-anchor="middle">${i === n - 1 ? 'now' : '−' + -S.hours[i] + ' h'}</text>`; });
  if (arrows) vals.forEach((v, i) => { if (S.hours[i] % 6 === 0) g += `<text transform="translate(${X(i)} 12) rotate(${arrows[i]})" text-anchor="middle" class="arr">↓</text>`; });
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="spark"><text x="3" y="${arrows ? 26 : 10}" class="lab">${esc(fmt(hi))}</text><text x="3" y="${H - 2}" class="lab">${esc(fmt(lo))}</text>${g}` +
    `<polyline fill="none" stroke="${color}" stroke-width="2.2" points="${pts.map(p => p.join(',')).join(' ')}"/>` +
    (cur != null && vals[cur] != null ? `<circle cx="${X(cur)}" cy="${Y(vals[cur])}" r="4" fill="#fff" stroke="${color}" stroke-width="2"/>` : '') + '</svg>';
}
export const chartsHTML = (s, cur) => `
  <div class="ch"><b>Pressure</b> (hPa)${spark(s.p, { fmt: v => v.toFixed(0), color: '#6ab0ff', cur })}</div>
  <div class="ch"><b>Temperature</b> (${tUnit()})${spark(s.t, { fmt: v => Math.round(tempOut(v)) + '°', color: '#ff9a5a', cur })}</div>
  <div class="ch"><b>Dewpoint</b> (${tUnit()})${spark(s.d, { fmt: v => Math.round(tempOut(v)) + '°', color: '#5ae0b4', cur })}</div>
  <div class="ch"><b>Wind speed</b> (${sUnit()}) <small>arrows show where the wind blows <i>toward</i></small>${spark(s.spd, { fmt: v => Math.round(spdOut(v)), color: '#e6d36a', cur, arrows: s.dir })}</div>`;

// ---- the place card
function relDir(bear, mdir) { // does a system's path point toward the place?
  const diff = Math.abs(((mdir - bear + 540) % 360) - 180);
  return diff < 40 ? 'its path points toward your place' : diff > 140 ? 'it is moving away from your place' : 'it is passing to one side of your place';
}
function sysLine(type, pl) {
  const s = nearestSystem(pl.lat, pl.lon, type, now()); if (!s) return `<li>No ${type === 'H' ? 'High' : 'Low'} found nearby.</li>`;
  const m = s.motion, name = type === 'H' ? 'High' : 'Low';
  const head = `Nearest ${name}: ${Math.round(s.e.v)} hPa, ${fmtD(s.d)} to the ${compass(s.brg)} of ${pl.name}`;
  const mot = m ? `Moving toward the ${compass(m.dir)} at ${fmtS(m.kmh / 3.6)} (${m.dp > 0 ? '+' : ''}${m.dp.toFixed(1)} hPa in ${m.hrs} h)${s.d < 4000 ? ' — ' + relDir(bearing(s.e.lat, s.e.lon, pl.lat, pl.lon), m.dir) : ' — too far away to matter soon'}.` : 'New in the last 48 h; motion not measurable yet.';
  return `<li><b>Nearest ${name}:</b> ${Math.round(s.e.v)} hPa, <b>${fmtD(s.d)}</b> to the ${compass(s.brg)} of you.<br>${mot}<br>${pinBtn('hl', `${head} (${when()}). ${mot}`)}</li>`;
}
const OPEN = { sys: false, hist: false };   // which sections the student has opened; the card is redrawn often, so remember them
export function renderCard() {
  const el = $('pcard'), pl = P.place;
  $('pname').value = pl ? pl.name : ''; $('pname').disabled = !pl;
  if (!pl || !S.D) { el.innerHTML = '<p class="muted">Choose a place above to see what the model analysis says about it.</p>'; return; }
  const ser = pastSeries(pl), n = now(), t = ser.t[n], p = ser.p[n], dp24 = p - ser.p[at(-24)], dp6 = p - ser.p[at(-6)];
  const tend = Math.abs(dp24) < 1 ? 'steady' : dp24 > 0 ? 'rising' : 'falling';
  const nm = P.normals;
  const normals = nm === 'loading' ? '<span class="muted">looking up…</span>' : nm && nm !== 'error'
    ? `<b>${fmtT(nm.hi)}</b> high · <b>${fmtT(nm.lo)}</b> low <small class="muted">(average of the last ${nm.years} years, within a week of today’s date)</small>`
    : '<span class="muted">unavailable right now (needs an internet connection, or the free history service is busy; try again later)</span>';
  el.innerHTML = `
    <div class="kv"><span>Location</span><b>${Math.abs(pl.lat).toFixed(2)}°${pl.lat >= 0 ? 'N' : 'S'}, ${Math.abs(pl.lon).toFixed(2)}°${pl.lon >= 0 ? 'E' : 'W'}</b>
      <span>Elevation</span><b>${esc(fmtElev(pl.elev))}</b></div>
    <h4>Normal for this time of year</h4><p>${normals}</p>
    <h4>Right now <small>(newest model analysis)</small></h4>
    <div class="kv"><span>Temperature</span><b>${fmtT(t)}</b><span>Dewpoint</span><b>${fmtT(ser.d[n])}</b>
      <span>Pressure</span><b>${esc(fmtP(p))}</b><span>Pressure change</span><b>${dp24 > 0 ? '+' : ''}${dp24.toFixed(1)} hPa / 24 h → ${tend}</b>
      <span>Wind</span><b>from the ${compass(ser.dir[n])} at ${fmtS(ser.spd[n])}</b><span>Rain, last 6 h</span><b>${fmtRain(ser.pr[n])}</b></div>
    ${pinBtn('general', `${pl.name}, ${when()}: temperature ${fmtT(t)}, dewpoint ${fmtT(ser.d[n])}, pressure ${fmtP(p)} (${tend}, ${dp24 > 0 ? '+' : ''}${dp24.toFixed(1)} hPa in 24 h), wind from the ${compass(ser.dir[n])} at ${fmtS(ser.spd[n])}, rain in the last 6 h ${fmtRain(ser.pr[n])}.`)}
    <details class="grp" data-k="sys" ${OPEN.sys ? 'open' : ''}><summary>🌀 Highs, lows and fronts near you</summary>
      <p class="small muted">These are the weather systems closest to your place. Press 📌 to save one to your notes.</p>
      <h4>Highs and lows</h4><ul class="sys">${sysLine('H', pl)}${sysLine('L', pl)}</ul>
      <div id="pfronts"></div></details>
    <details class="grp" data-k="hist" ${OPEN.hist ? 'open' : ''}><summary>📈 The past 48 hours here (charts)</summary>
      <p class="small muted">How pressure, temperature, dewpoint and wind changed at your place. A falling pressure often means a Low or a front is coming.</p>
      ${chartsHTML(ser, S.cur < S.nPast ? S.cur : n)}
      <button id="pchartdl" class="wide">⬇ Download these charts as a picture (for slides)</button></details>
    <p class="muted small">Model values are averages over a square about 200 km (125 mi) wide. Hills, lakes and the coast are <i>not</i> in them — that is part of what you add with your own reasoning.</p>`;
  document.dispatchEvent(new Event('cardrender'));
}

// ---- charts as a standalone PNG the student can drop into slides (inline styles, white background, no outside files)
function chartsPNG() {
  const pl = P.place; if (!pl) return; const s = pastSeries(pl), W = 340, H = 150, M = 16;
  const specs = [['Pressure (hPa)', s.p, '#2f6fd0', v => v.toFixed(0)], [`Temperature (${tUnit()})`, s.t, '#e0702a', v => Math.round(tempOut(v)) + '°'],
    [`Dewpoint (${tUnit()})`, s.d, '#1aa37a', v => Math.round(tempOut(v)) + '°'], [`Wind speed (${sUnit()})`, s.spd, '#b08d00', v => Math.round(spdOut(v))]];
  const panel = ([title, vals, col, fmt], k) => {
    const ox = M + (k % 2) * (W + M), oy = 62 + Math.floor(k / 2) * (H + 34), n = vals.length;
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const X = i => ox + 30 + i * (W - 40) / (n - 1), Y = v => oy + H - 18 - (v - lo) / (hi - lo) * (H - 38);
    return `<text x="${ox}" y="${oy + 4}" font-size="13" font-weight="700" fill="#111">${esc(title)}</text>` +
      dayTicks(n).map(i => `<line x1="${X(i)}" x2="${X(i)}" y1="${oy + 10}" y2="${oy + H - 18}" stroke="#ddd"/><text x="${X(i)}" y="${oy + H - 3}" font-size="10" text-anchor="middle" fill="#555">${i === n - 1 ? 'now' : '−' + -S.hours[i] + ' h'}</text>`).join('') +
      `<text x="${ox}" y="${oy + 22}" font-size="10" fill="#111">${esc(fmt(hi))}</text><text x="${ox}" y="${oy + H - 20}" font-size="10" fill="#111">${esc(fmt(lo))}</text>` +
      `<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${vals.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/><circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="4" fill="${col}"/>`;
  };
  const w = M * 3 + W * 2, h = 62 + (H + 34) * 2 + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="${M}" y="22" font-size="16" font-weight="700" fill="#111">${esc(pl.name)} — past 48 hours</text><text x="${M}" y="38" font-size="10" fill="#555">NOAA GFS model analysis through ${esc(when())}${S.D.sample ? ' (SAMPLE DATA)' : ''}</text>${specs.map(panel).join('')}</svg>`;
  const img = new Image(); img.onload = () => {
    const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const g = c.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `charts-${pl.name.replace(/\W+/g, '_')}.png`; a.click(); URL.revokeObjectURL(a.href); });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function initPlace() {
  $('pcard').addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.k; if (k) OPEN[k] = e.target.open; }, true);
  $('pcard').addEventListener('click', e => {
    const b = e.target.closest('.pinbtn');
    if (b) { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: b.dataset.topic, text: b.dataset.text } })); b.textContent = '✓ Added to notes'; b.disabled = true; return; }
    if (e.target.id === 'pchartdl') { chartsPNG(); markEvid('chart'); }
  });
  $('pgo').onclick = async () => {
    const q = $('pq').value.trim(); if (!q) return;
    $('pres').innerHTML = '<span class="muted">searching…</span>';
    try {
      const rs = await geocode(q);
      $('pres').innerHTML = rs.length ? rs.map((r, i) => `<button data-i="${i}">${esc(r.name)}</button>`).join('') : '<span class="muted">No match. Try a bigger city nearby.</span>';
      $('pres').onclick = e => { const b = e.target.closest('button'); if (b) { setPlace(rs[+b.dataset.i]); $('pres').innerHTML = ''; } };
    } catch { $('pres').innerHTML = '<span class="muted">Search needs an internet connection. Use the list below or pick on the map.</span>'; }
  };
  $('pq').onkeydown = e => { if (e.key === 'Enter') $('pgo').click(); };
  $('ppick').onclick = () => startPicking(!P.picking);
  $('pstart').innerHTML = STARTERS.map((s, i) => `<button data-i="${i}"><b>${esc(s[0])}</b><small>${esc(s[4])}</small></button>`).join('');
  $('pstart').onclick = e => { const b = e.target.closest('button'); if (b) { const s = STARTERS[+b.dataset.i]; setPlace({ name: s[0], lat: s[1], lon: s[2], elev: s[3] }); } };
  $('pname').oninput = e => { if (P.place) { P.place.name = e.target.value; store.set('place', P.place); document.dispatchEvent(new Event('placechange')); } };
  hooks.click.push(e => {
    if (!P.picking) return false;
    startPicking(false); setPlace({ name: `Custom place (${e.latlng.lat.toFixed(1)}, ${e.latlng.lng.toFixed(1)})`, lat: e.latlng.lat, lon: e.latlng.lng }, false); return true;
  });
  document.addEventListener('usepoint', e => { setPlace({ name: `Custom place (${e.detail.lat.toFixed(1)}, ${e.detail.lon.toFixed(1)})`, lat: e.detail.lat, lon: e.detail.lon }, false); document.querySelector('[data-tab="place"]').click(); });
  document.addEventListener('frame', renderCard); document.addEventListener('units', renderCard);
  if (P.place) { setPin(P.place); setPlace(P.place, false); } else renderCard();
}
