// "Predict": the student's own play-forward tool. They pick Highs, Lows and fronts from the newest map, set how each one moves
// (the measured motion is filled in, and they can change it), and play three days. It only slides the systems along the path they
// chose. There is no temperature, wind or rain here, and nothing comes from the model's forecast: it is their guess.
import { $, esc, store, fmtD, spdOut, spdIn, sUnit, compass, distKm, bearing, U } from './util.js';
import { S, frameInfo, motionOf, frameTime } from './data.js';
import { P } from './place.js';
import { view, hooks, map, redraw, flyTo } from './mapview.js';
import { destination, nearestOnPolyline, flatFrame, bearingXY } from './geo.js';
import { listFronts, nearestFronts } from './tools.js';

const HORIZON = 72, STEP = 3, MAX_ITEMS = 6;
const PR = { items: [], seq: 0, t: 0, timer: null, ...store.get('proj', {}) };
if (!Array.isArray(PR.items)) PR.items = [];
PR.t = 0; PR.timer = null;
const NAMES = { 'Cold Front': 'cold front', 'Warm Front': 'warm front', 'Stationary Front': 'stationary front', 'Occluded Front': 'occluded front' };
const FCOL = { 'Cold Front': '#3b82ff', 'Warm Front': '#ff3b3b', 'Stationary Front': '#3b82ff', 'Occluded Front': '#b043ff' };
const save = () => store.set('proj', { items: PR.items, seq: PR.seq });
const kmh = x => U.sys === 'us' ? x * 1.609344 : x;          // the box shows mph or km/h; items are stored in km/h
const fromKmh = x => U.sys === 'us' ? x / 1.609344 : x;
const newest = () => S.nPast - 1;
export const hasProjection = () => PR.items.length > 0;
const label = it => it.kind === 'front' ? `${NAMES[it.type]}${it.src === 'mine' ? ' (mine)' : it.src === 'model' ? ' (computer-found)' : ' (NOAA)'}` : `${it.kind === 'H' ? 'High' : 'Low'}, ${Math.round(it.p)} hPa`;

// ---- where an item is after t hours
const pos = (it, t) => destination(it.lat, it.lon, it.dir, it.spd * t);
const shifted = (it, t) => it.pts.map(([la, lo]) => { const d = destination(la, lo, it.dir, it.spd * t); return [d.lat, d.lon]; });
const pressureAt = (it, t) => it.p + it.dp * t / 24;

// ---- adding things to the projection
const near = (a, b) => distKm(a.lat, a.lon, b.lat, b.lon) < 150;
function addSystem(s) { // s: { t: 'H'|'L', lat, lon, v } from the newest map
  if (PR.items.length >= MAX_ITEMS) return say(`You can project up to ${MAX_ITEMS} things at once. Remove one first.`);
  if (PR.items.some(i => i.kind === s.t && near(i, s))) return say('That one is already in your projection.');
  const tr = S.tracks.find(t => t.pts.some(p => p.i === newest() && p.lat === s.lat && p.lon === s.lon)), m = tr && motionOf(tr, newest());
  PR.items.push({ id: ++PR.seq, kind: s.t, lat: s.lat, lon: s.lon, p: s.v, dir: m ? Math.round(m.dir) : 90, spd: m ? Math.round(m.kmh) : 0, dp: m ? Math.round(m.dp * 24 / m.hrs * 10) / 10 : 0,
    m: m ? { dir: m.dir, kmh: m.kmh, dp: m.dp, hrs: m.hrs } : null, from: S.D.cycle });
  done();
}
function addFront(f) {
  if (PR.items.length >= MAX_ITEMS) return say(`You can project up to ${MAX_ITEMS} things at once. Remove one first.`);
  if (PR.items.some(i => i.kind === 'front' && i.type === f.type && near(i, { lat: f.pts[0][0], lon: f.pts[0][1] }) && i.pts.length === f.pts.length)) return say('That front is already in your projection.');
  const F = flatFrame(f.pts[0][0], f.pts[0][1]), a = F.xy(...f.pts[0]), b = F.xy(...f.pts.at(-1)), dx = b[0] - a[0], dy = b[1] - a[1];
  PR.items.push({ id: ++PR.seq, kind: 'front', type: f.type, src: f.src, pts: f.pts, lat: f.pts[0][0], lon: f.pts[0][1], dir: Math.round(bearingXY(-dy, dx)), spd: 0, dp: 0, from: S.D.cycle });   // the symbols' side: left of the way the line runs
  done();
}
function done() { save(); renderItems(); setT(0); redraw(); document.dispatchEvent(new Event('projchanged')); }
function say(msg) { $('pradd').textContent = msg; setTimeout(() => $('pradd').textContent = '', 3500); }

// ---- the drawing on the map
view.layers.predict = (g, m, cv) => {
  if (!view.predictOn || !S.D) return;
  const MAG = '#ff4fd8', P0 = ll => m.latLngToContainerPoint(ll);
  for (const it of PR.items) {
    if (it.kind === 'front') {
      const cur = shifted(it, PR.t), end = shifted(it, HORIZON);
      if (it.spd > 0) {   // where the line's middle goes over the three days
        const mid = it.pts[Math.floor(it.pts.length / 2)]; g.setLineDash([4, 6]); g.lineWidth = 2; g.strokeStyle = MAG; g.beginPath();
        for (let t = 0; t <= HORIZON; t += 6) { const d = destination(mid[0], mid[1], it.dir, it.spd * t), p = P0([d.lat, d.lon]); t ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
      }
      for (const [lw, col, a] of [[8, MAG, .35]]) { g.globalAlpha = a; g.lineWidth = lw; g.strokeStyle = col; g.lineJoin = 'round'; g.beginPath(); cur.forEach((q, i) => { const p = P0(q); (i && Math.abs(q[1] - cur[i - 1][1]) < 180) ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); g.stroke(); g.globalAlpha = 1; }
      cv.drawFronts(g, { features: [{ geometry: { type: 'LineString', coordinates: cur.map(([la, lo]) => [lo, la]) }, properties: { feat: it.type } }] }, { alpha: 1, w: 3, sp: 28 });
      const lp = P0(cur[Math.floor(cur.length / 2)]); g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#ffd6f6';
      g.strokeText(`my ${NAMES[it.type]}`, lp.x, lp.y - 12); g.fillText(`my ${NAMES[it.type]}`, lp.x, lp.y - 12);
    } else {
      const start = P0([it.lat, it.lon]), now = pos(it, PR.t), c = P0([now.lat, now.lon]), col = it.kind === 'H' ? '#8bbcff' : '#ff9a9a';
      if (it.spd > 0) {
        g.setLineDash([4, 6]); g.lineWidth = 2; g.strokeStyle = MAG; g.beginPath(); g.moveTo(start.x, start.y);
        for (let t = 6; t <= HORIZON; t += 6) { const d = pos(it, t), p = P0([d.lat, d.lon]); g.lineTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
        g.font = '10px system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#ffd6f6';
        for (const t of [24, 48, 72]) { const d = pos(it, t), p = P0([d.lat, d.lng ?? d.lon]); g.fillStyle = MAG; g.beginPath(); g.arc(p.x, p.y, 3.5, 0, 7); g.fill(); g.fillStyle = '#ffd6f6'; g.strokeText(`+${t}h`, p.x, p.y + 14); g.fillText(`+${t}h`, p.x, p.y + 14); }
      }
      g.globalAlpha = .45; g.strokeStyle = '#000'; g.lineWidth = 3; g.fillStyle = col; g.font = 'bold 20px system-ui'; g.textAlign = 'center'; g.strokeText(it.kind, start.x, start.y + 7); g.fillText(it.kind, start.x, start.y + 7); g.globalAlpha = 1;   // where it is now
      g.beginPath(); g.arc(c.x, c.y, 17, 0, 7); g.strokeStyle = MAG; g.lineWidth = 3; g.stroke();
      g.font = 'bold 22px system-ui'; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = col; g.strokeText(it.kind, c.x, c.y + 8); g.fillText(it.kind, c.x, c.y + 8);
      g.font = 'bold 11px system-ui'; g.lineWidth = 3; g.fillStyle = '#fff'; const txt = String(Math.round(pressureAt(it, PR.t))); g.strokeText(txt, c.x, c.y + 28); g.fillText(txt, c.x, c.y + 28);
    }
  }
};

// ---- the panel
const when = t => new Date(frameTime(newest()).getTime() + t * 3600e3);
function setT(t) {
  PR.t = t; $('prt').value = t; const d = when(t);
  $('prwhen').innerHTML = `<b>${t === 0 ? 'Now (start)' : '+' + t + ' hours'}</b> <small>${d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>`;
  $('prbadge').hidden = !(view.predictOn && PR.items.length); $('prbadgeT').textContent = t === 0 ? 'start' : `+${t} h`;
  redraw();
}
function readout(it) {
  const pl = P.place; if (!pl) return '';
  const at = t => it.kind === 'front' ? nearestOnPolyline(pl.lat, pl.lon, shifted(it, t)) : { km: distKm(pl.lat, pl.lon, pos(it, t).lat, pos(it, t).lon), toward: bearing(pl.lat, pl.lon, pos(it, t).lat, pos(it, t).lon) };
  let best = null, hit = null;
  for (let t = 0; t <= HORIZON; t++) { const r = at(t); if (!best || r.km < best.km) best = { ...r, t }; if (hit == null && r.km <= 75) hit = t; }
  const rows = [24, 48, 72].map(t => { const r = at(t); return `<span>+${t} h</span><b>${esc(fmtD(r.km))} to the ${compass(r.toward)}</b>`; }).join('');
  const end = it.kind === 'front' ? (hit != null ? `Your projection has this front <b>reaching ${esc(pl.name)} at about +${hit} h</b>.` : `In your projection this front <b>does not reach ${esc(pl.name)}</b> in 3 days (closest: ${esc(fmtD(best.km))} at about +${best.t} h).`)
    : (best.km <= 300 ? `It passes closest, about <b>${esc(fmtD(best.km))}</b> away, at about +${best.t} h.` : `It stays at least ${esc(fmtD(best.km))} away.`);
  return `<div class="kv small">${rows}</div><p class="small">${end}</p>`;
}
function summary() {
  const pl = P.place, from = when(0).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  return PR.items.map(it => {
    const mv = it.spd > 0 ? `moves toward the ${compass(it.dir)} at ${esc(Math.round(spdOut(it.spd / 3.6)))} ${sUnit()}` : 'stays where it is';
    const lines = [`My projection from the ${from} map: the ${label(it).replace(/ \((mine|NOAA|computer-found)\)/, '')} ${mv}${it.kind !== 'front' && it.dp ? `, ${it.dp > 0 ? 'strengthening' : 'weakening'} ${Math.abs(it.dp)} hPa a day` : ''}.`];
    if (pl) { const r = readout(it).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); lines.push(r); }
    return lines.join(' ');
  }).join('\n');
}
function renderItems() {
  const box = $('pritems');
  box.innerHTML = PR.items.length ? PR.items.map(it => `
    <div class="pitem" data-id="${it.id}">
      <div class="phead"><b>${it.kind === 'front' ? '〰️' : it.kind === 'H' ? '🔵' : '🔴'} ${esc(label(it))}</b><button class="ghost" data-act="del" aria-label="Remove ${esc(label(it))}">✕</button></div>
      ${it.from !== S.D.cycle ? '<p class="warn small">Starts from an older map. Remove and add it again to start from the newest map.</p>' : ''}
      ${it.m ? `<p class="small muted">Measured over the last ${it.m.hrs} h: toward the ${compass(it.m.dir)} at ${esc(Math.round(spdOut(it.m.kmh / 3.6)))} ${sUnit()}${it.kind !== 'front' ? `, ${it.m.dp > 0 ? '+' : ''}${it.m.dp.toFixed(1)} hPa` : ''}.</p>`
        : it.kind === 'front' ? '<p class="small muted">The symbols point the way it is moving. Measure how far it moved in the last 24 hours (play the loop and use the ruler), then type its speed.</p>' : '<p class="small muted">This system is new in the last 48 h, so its motion is unknown. Make your best estimate.</p>'}
      <div class="pgrid">
        <label>Moves toward (°)<input type="number" min="0" max="359" step="1" data-k="dir" value="${Math.round(it.dir)}" aria-label="Direction it moves toward, in degrees"></label>
        <label>Speed (${sUnit()})<input type="number" min="0" step="1" data-k="spd" value="${Math.round(fromKmh(it.spd))}" aria-label="Speed in ${U.sys === 'us' ? 'miles per hour' : 'kilometers per hour'}"></label>
        ${it.kind === 'front' ? '' : `<label>Pressure change (hPa per day)<input type="number" step="0.5" data-k="dp" value="${it.dp}" aria-label="Pressure change in hectopascals per day"></label>`}
      </div>
      <p class="small dirtxt">Toward the <b>${compass(it.dir)}</b></p>
      <div class="pread">${readout(it)}</div>
      <button class="ghost" data-act="show">Show on the map</button>
    </div>`).join('') : '<p class="empty small">Nothing is in your projection yet. Add a High, Low or front below, or click one on the map.</p>';
  $('prplayrow').hidden = !PR.items.length; $('prpin').hidden = !PR.items.length;
}
function renderAdd() {
  const c = P.place || map.getCenter(), c2 = { lat: c.lat, lon: c.lon ?? c.lng };
  const sys = frameInfo(newest()).ex.map(e => ({ ...e, d: distKm(c2.lat, c2.lon, e.lat, e.lon) })).sort((a, b) => a.d - b.d).slice(0, 3);
  const fr = nearestFronts(c2, 2);
  $('pradds').innerHTML = (sys.length || fr.length ? '' : '<p class="muted small">No systems found.</p>') + sys.map((s, i) => `<button data-sys="${i}"><b>${s.t === 'H' ? '🔵 High' : '🔴 Low'}</b>, ${Math.round(s.v)} hPa <small>${esc(fmtD(s.d))} from ${P.place ? 'your place' : 'the map center'}</small></button>`).join('')
    + fr.map((f, i) => `<button data-fr="${i}"><b>〰️ ${esc(NAMES[f.type])}</b> <small>${f.src === 'mine' ? 'mine' : f.src === 'model' ? 'computer-found' : 'NOAA'} · ${esc(fmtD(f.km))} away</small></button>`).join('');
  $('pradds')._sys = sys; $('pradds')._fr = fr;
}
function refresh() {
  if (!S.D) return; $('prplace').textContent = P.place ? `Distances are measured from ${P.place.name}.` : 'Choose a place on the My Place tab to see distances from it.';
  renderAdd(); renderItems(); setT(PR.t);
}
const playOff = () => { clearInterval(PR.timer); PR.timer = null; $('prplay').textContent = '▶ Play my projection'; };

export function initPredict() {
  $('prt').max = HORIZON; $('prt').step = STEP;
  $('prt').oninput = e => { playOff(); setT(+e.target.value); };
  $('prplay').onclick = () => {
    if (PR.timer) return playOff();
    if (PR.t >= HORIZON) setT(0);
    $('prplay').textContent = '❚❚ Pause'; PR.timer = setInterval(() => { if (PR.t >= HORIZON) return playOff(); setT(PR.t + STEP); if (PR.t >= HORIZON) playOff(); }, 260);
  };
  $('prreset').onclick = () => { playOff(); setT(0); };
  $('pradds').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sys != null) addSystem($('pradds')._sys[+b.dataset.sys]); else if (b.dataset.fr != null) addFront($('pradds')._fr[+b.dataset.fr]);
  };
  $('pritems').addEventListener('input', e => {
    const k = e.target.dataset.k, el = e.target.closest('.pitem'); if (!k || !el) return; const it = PR.items.find(i => i.id === +el.dataset.id); if (!it) return;
    const v = +e.target.value; if (!isFinite(v)) return;
    if (k === 'dir') { it.dir = ((v % 360) + 360) % 360; el.querySelector('.dirtxt').innerHTML = `Toward the <b>${compass(it.dir)}</b>`; } else if (k === 'spd') it.spd = Math.max(0, kmh(v)); else it.dp = v;
    el.querySelector('.pread').innerHTML = readout(it); save(); redraw(); document.dispatchEvent(new Event('projchanged'));
  });
  $('pritems').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'), el = e.target.closest('.pitem'); if (!b || !el) return; const it = PR.items.find(i => i.id === +el.dataset.id); if (!it) return;
    if (b.dataset.act === 'del') { PR.items = PR.items.filter(i => i !== it); save(); renderItems(); redraw(); document.dispatchEvent(new Event('projchanged')); }
    else flyTo(it.lat, it.lon, 4);
  });
  $('prpin').onclick = () => { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: 'general', text: summary() } })); };
  $('prclear').onclick = () => { if (PR.items.length && confirm('Remove everything from your projection?')) { PR.items = []; save(); renderItems(); setT(0); redraw(); document.dispatchEvent(new Event('projchanged')); } };
  // "Add to my projection" buttons in map popups, and clicks on fronts
  document.addEventListener('addproj', e => addSystem(e.detail));
  hooks.click.push((e, pt) => {
    if (!view.predictOn || S.cur !== newest()) return false;
    for (const f of listFronts()) for (let i = 1; i < f.pts.length; i++) {
      const a = map.latLngToContainerPoint(f.pts[i - 1]), b = map.latLngToContainerPoint(f.pts[i]), dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) < 10) {
        window._pf = f; L.popup().setLatLng(e.latlng).setContent(`<b>${esc(NAMES[f.type])}</b> <small>(${f.src === 'mine' ? 'mine' : f.src === 'model' ? 'found by computer' : 'NOAA'})</small><br><button class="projbtn" id="pfadd">🔮 Add to my projection</button>`).openOn(map);
        setTimeout(() => { const b2 = document.getElementById('pfadd'); if (b2) b2.onclick = () => { map.closePopup(); addFront(window._pf); }; }, 0); return true;
      }
    }
    return false;
  });
  for (const ev of ['units', 'placechange', 'frame']) document.addEventListener(ev, () => { if (S.D && !$('tab-predict').hidden) refresh(); });
  document.addEventListener('tabshow', e => { if (e.detail === 'predict') refresh(); else playOff(); });
  refresh();
}
export const projectionSummary = () => PR.items.map(it => ({ kind: it.kind, type: it.type, src: it.src, p: it.p, dir: it.dir, kmh: Math.round(it.spd), dp: it.dp }));
