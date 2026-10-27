// Map tools for working out where fronts are and how far away: a ruler, a draw-your-own-front tool, and the "Fronts near you"
// block on the place card. Everything is measured from the newest analysis; nothing here predicts.
import { $, esc, store, fmtD, fmtS, spdIn, compass, distKm, bearing, U } from './util.js';
import { S, frameTime } from './data.js';
import { P } from './place.js';
import { view, hooks, map, redraw, frontLines, frType } from './mapview.js';
import { nearestOnPolyline } from './geo.js';

let drawn = store.get('drawn', []);                 // [{ type, pts: [[lat, lon], ...], t: valid time of the map it was drawn on }]
const D = { on: false, type: 'Cold Front', pts: [] }, R = { on: false, a: null, b: null };
let speed = store.get('fspeed', 25);                // in the displayed speed unit
const key = i => frameTime(i).toISOString();
const feat = f => ({ geometry: { type: 'LineString', coordinates: f.pts.map(([la, lo]) => [lo, la]) }, properties: { feat: f.type } });
const NAMES = { 'Cold Front': 'cold front', 'Warm Front': 'warm front', 'Stationary Front': 'stationary front', 'Occluded Front': 'occluded front', 'Trough': 'trough' };

// ---- drawing on the map
view.layers.tools = (g, m, cv) => {
  if (!S.D) return;
  const mine = drawn.filter(f => f.t === key(S.cur));
  if (mine.length) {
    cv.drawFronts(g, { features: mine.map(feat) });
    g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#fff';
    for (const f of mine) { const p = m.latLngToContainerPoint(f.pts[0]); g.strokeText('mine', p.x + 6, p.y - 6); g.fillText('mine', p.x + 6, p.y - 6); }
  }
  if (D.on && D.pts.length) {
    const P0 = D.pts.map(p => m.latLngToContainerPoint(p));
    g.lineWidth = 3; g.strokeStyle = '#ffd23f'; g.setLineDash([7, 5]); g.beginPath(); P0.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1.5; P0.forEach(p => { g.beginPath(); g.arc(p.x, p.y, 5, 0, 7); g.fill(); g.stroke(); });
  }
  if (R.a) {
    const a = m.latLngToContainerPoint(R.a), b = R.b && m.latLngToContainerPoint(R.b);
    g.fillStyle = '#7dffa0'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    for (const p of [a, b]) if (p) { g.beginPath(); g.arc(p.x, p.y, 6, 0, 7); g.fill(); g.stroke(); }
    if (b) { g.lineWidth = 5; g.strokeStyle = '#000a'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.lineWidth = 2.5; g.strokeStyle = '#7dffa0'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  }
};
const save = () => { store.set('drawn', drawn); redraw(); fillFronts(); };

// ---- ruler
function ruler(e) {
  const ll = [e.latlng.lat, e.latlng.lng];
  if (!R.a || R.b) { R.a = ll; R.b = null; $('rulerout').textContent = 'Now click the second point…'; }
  else {
    R.b = ll; R.on = false; $('ruler').classList.remove('active'); $('ruler').textContent = '📏 Measure again'; map.getContainer().style.cursor = '';
    const km = distKm(...R.a, ...R.b), brg = bearing(...R.a, ...R.b), txt = `${fmtD(km)} toward the ${compass(brg)} (${Math.round(brg)}°)`;
    $('rulerout').innerHTML = `<b>${esc(txt)}</b> <button class="pinbtn" data-topic="front" data-text="${esc('Measured on the map: ' + txt + '.')}">📌</button>`;
  }
  redraw();
}

// ---- nearest fronts: NOAA's chart (North America) and the ones the student drew
// every front on the newest map as {src, type, pts: [[lat, lon], ...]}: NOAA's, the computer-found ones, and the ones the student drew
export function listFronts() {
  const out = [];
  for (const f of frontLines() || []) {
    const type = frType(f); if (type === 'Trough') continue;
    for (const l of f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]) out.push({ src: 'NOAA', type, pts: l.map(([x, y]) => [y, x]) });
  }
  for (const f of (S.D.fr && S.D.fr[S.nPast - 1]) || []) out.push({ src: 'model', type: f.t, pts: f.p });
  for (const f of drawn.filter(f => f.t === key(S.nPast - 1))) out.push({ src: 'mine', type: f.type, pts: f.pts });
  return out;
}
export function nearestFronts(pl, n = 4) {
  const out = [];
  for (const f of listFronts()) { const b = nearestOnPolyline(pl.lat, pl.lon, f.pts); if (b) out.push({ ...f, ...b }); }
  return out.sort((a, b) => a.km - b.km).slice(0, n);
}
const who = f => f.src === 'mine' ? 'My' : f.src === 'model' ? 'Computer-found' : 'NOAA';
function fillFronts() {
  const el = $('pfronts'); if (!el) return;
  const pl = P.place; if (!pl || !S.D) { el.innerHTML = ''; return; }
  const list = nearestFronts(pl), when = frameTime(S.nPast - 1).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  if (!list.length) { el.innerHTML = `<h4>Fronts near you</h4><p class="muted small">No fronts were found near here. On the Explore tab, use <b>Temperature contrast</b> shading to find them, then <b>Draw a front</b>. Fronts you draw will be measured here.</p>`; return; }
  const near = list[0], kmh = () => U.sys === 'us' ? speed / 0.6214 : speed;
  el.innerHTML = `<h4>Fronts near you</h4><ul class="sys">` + list.map(f => {
    const txt = `${who(f)} ${NAMES[f.type]}: ${fmtD(f.km)} to the ${compass(f.toward)} of ${pl.name} (${when})`;
    return `<li><b>${esc(who(f))} ${esc(NAMES[f.type])}</b>: ${esc(fmtD(f.km))} to the ${compass(f.toward)}. <button class="pinbtn" data-topic="front" data-text="${esc(txt + '.')}">📌 Add to notes</button></li>`;
  }).join('') + `</ul>
    <div class="calc">If the nearest front (the ${esc(who(near) === 'NOAA' ? 'NOAA' : who(near).toLowerCase())} ${esc(NAMES[near.type])}, ${esc(fmtD(near.km))} away) moved straight toward you at
      <input type="number" id="fspd" min="1" step="1" value="${speed}" aria-label="Front speed in ${U.sys === 'us' ? 'miles per hour' : 'kilometers per hour'}"> ${U.sys === 'us' ? 'mph' : 'km/h'}, it would arrive in about <b id="fhrs"></b>.
      <small class="muted">distance ÷ speed. Estimate the speed yourself from the 48-hour loop.</small></div>`;
  const calc = () => { const h = near.km / Math.max(1, kmh()); $('fhrs').textContent = h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`; };
  calc(); $('fspd').oninput = e => { speed = +e.target.value || 1; store.set('fspeed', speed); calc(); };
}

function setMode(mode) {
  D.on = mode === 'draw'; R.on = mode === 'ruler'; if (!D.on) D.pts = [];
  $('fdraw').classList.toggle('active', D.on); $('ruler').classList.toggle('active', R.on); $('ffinish').hidden = !D.on;
  $('fdraw').textContent = D.on ? '✏️ Click points along the front…' : '✏️ Draw a front';
  $('ruler').textContent = R.on ? '📏 Click two points… (cancel)' : '📏 Measure distance';
  $('fhelp').textContent = D.on ? 'Click along the front, from one end to the other, then press Finish. Use the temperature contrast, dewpoint and wind shifts to decide where it is.' : '';
  map.getContainer().style.cursor = D.on || R.on ? 'crosshair' : ''; redraw();
}

export function initTools() {
  $('ruler').onclick = () => { if (R.on) setMode(null); else { R.a = R.b = null; $('rulerout').textContent = ''; setMode('ruler'); } };
  $('fdraw').onclick = () => { if (D.on) setMode(null); else { D.type = $('ftype').value; D.pts = []; setMode('draw'); } };
  $('ftype').onchange = e => { D.type = e.target.value; };
  $('ffinish').onclick = () => {
    if (D.pts.length < 2) { $('fhelp').textContent = 'A front needs at least two points. Keep clicking along it.'; return; }
    drawn.push({ type: D.type, pts: D.pts.slice(), t: key(S.cur) }); setMode(null); save();
  };
  $('fundo').onclick = () => {
    if (D.on && D.pts.length) D.pts.pop(); else { const i = drawn.map(f => f.t).lastIndexOf(key(S.cur)); if (i >= 0) drawn.splice(i, 1); }
    save();
  };
  $('fclear').onclick = () => { const n = drawn.filter(f => f.t === key(S.cur)).length; if (n && confirm(`Erase the ${n} front(s) you drew on this map?`)) { drawn = drawn.filter(f => f.t !== key(S.cur)); save(); } };
  hooks.click.push(e => {
    if (R.on) { ruler(e); return true; }
    if (D.on) { D.pts.push([e.latlng.lat, e.latlng.lng]); redraw(); return true; }
    return false;
  });
  $('rulerout').addEventListener('click', e => { const b = e.target.closest('.pinbtn'); if (b) { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: b.dataset.topic, text: b.dataset.text } })); b.textContent = '✓'; b.disabled = true; } });
  document.addEventListener('cardrender', fillFronts); document.addEventListener('units', fillFronts);
  fillFronts();
}
