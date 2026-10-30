// "Predict": the student's own play-forward tool. They pick Highs, Lows and fronts from the newest map, set how each one moves
// (the measured motion is filled in, and they can change it), and play three days. It only slides the systems along the path they
// chose. There is no temperature, wind or rain here, and nothing comes from the model's forecast: it is their guess.
import { $, esc, store, fmtD, fmtS, spdOut, spdIn, sUnit, compass, distKm, bearing, U } from './util.js';
import { S, frameInfo, motionOf, frameTime, trackTrend, frontMotion, frontTrend, steerAt } from './data.js';
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
// What the student's OWN projection says about Day n (n = 1..3, the calendar day in their time zone): for each thing they projected, how close it
// gets to their place that day. Used by the plan checks. [] if there is no projection or no place yet.
export function projectionDay(n) {
  const pl = P.place; if (!pl || !PR.items.length) return [];
  const day = new Date(); day.setDate(day.getDate() + n); const key = day.toDateString(), out = [];
  for (const it of PR.items) {
    let best = null;
    for (let t = 0; t <= HORIZON; t++) {
      if (when(t).toDateString() !== key) continue;
      const km = it.kind === 'front' ? nearestOnPolyline(pl.lat, pl.lon, shifted(it, t)).km : distKm(pl.lat, pl.lon, pos(it, t).lat, pos(it, t).lon);
      if (!best || km < best.km) best = { km, t };
    }
    if (best) out.push({ kind: it.kind, type: it.type, word: WORD(it), ...best });
  }
  return out;
}
const label = it => it.kind === 'front' ? `${NAMES[it.type]}${it.src === 'mine' ? ' (mine)' : it.src === 'model' ? ' (computer-found)' : ' (NOAA)'}` : `${it.kind === 'H' ? 'High' : 'Low'}, ${Math.round(it.p)} hPa`;

// ---- where an item is after t hours
const pos = (it, t) => destination(it.lat, it.lon, it.dir, it.spd * t);
const shifted = (it, t) => it.pts.map(([la, lo]) => { const d = destination(la, lo, it.dir, it.spd * t); return [d.lat, d.lon]; });
const pressureAt = (it, t) => it.p + it.dp * t / 24;
const coneKm = (it, t) => 40 + .15 * it.spd * t;     // a rule of thumb, not a measured error

// ---- adding things to the projection
const near = (a, b) => distKm(a.lat, a.lon, b.lat, b.lon) < 150;
function addSystem(s) { // s: { t: 'H'|'L', lat, lon, v } from the newest map
  if (PR.items.length >= MAX_ITEMS) return say(`You can project up to ${MAX_ITEMS} things at once. Remove one first.`);
  if (PR.items.some(i => i.kind === s.t && near(i, s))) return say('That one is already in your projection.');
  const tr = S.tracks.find(t => t.pts.some(p => p.i === newest() && p.lat === s.lat && p.lon === s.lon)), m = tr && motionOf(tr, newest());
  PR.items.push({ id: ++PR.seq, kind: s.t, lat: s.lat, lon: s.lon, p: s.v, dir: m ? Math.round(m.dir) : 90, spd: m ? Math.round(m.kmh) : 0, dp: m ? Math.round(m.dp * 24 / m.hrs * 10) / 10 : 0,
    m: m ? { dir: m.dir, kmh: m.kmh, dp: m.dp, hrs: m.hrs } : null, trend: tr ? trackTrend(tr, newest()) : null, from: S.D.cycle });
  done();
}
function addFront(f) {
  if (PR.items.length >= MAX_ITEMS) return say(`You can project up to ${MAX_ITEMS} things at once. Remove one first.`);
  if (PR.items.some(i => i.kind === 'front' && i.type === f.type && near(i, { lat: f.pts[0][0], lon: f.pts[0][1] }) && i.pts.length === f.pts.length)) return say('That front is already in your projection.');
  const F = flatFrame(f.pts[0][0], f.pts[0][1]), a = F.xy(...f.pts[0]), b = F.xy(...f.pts.at(-1)), dx = b[0] - a[0], dy = b[1] - a[1];
  const m = f.src === 'model' && f.id != null ? frontMotion(f.id, newest()) : null;   // computer-found fronts are followed through time, so their speed can be measured
  PR.items.push({ id: ++PR.seq, kind: 'front', type: f.type, src: f.src, pts: f.pts, lat: f.pts[0][0], lon: f.pts[0][1], dir: Math.round(m ? m.dir : bearingXY(-dy, dx)), spd: m ? Math.round(m.kmh) : 0, dp: 0,   // the symbols' side: left of the way the line runs
    m, trend: m ? frontTrend(f.id, newest()) : null, from: S.D.cycle });
  done();
}
function done() { save(); renderItems(); setT(0); redraw(); document.dispatchEvent(new Event('projchanged')); }
function say(msg) { $('pradd').textContent = msg; setTimeout(() => $('pradd').textContent = '', 3500); }

// ---- the drawing on the map
view.layers.predict = (g, m, cv) => {
  if (!view.predictOn || !S.D) return;
  const MAG = '#ff4fd8', P0 = ll => m.latLngToContainerPoint(ll);
  if ($('prcone').checked) for (const it of PR.items) if (it.spd > 0) {   // the farther ahead, the less sure: a cone 15% of the distance traveled wide
    const mid = it.kind === 'front' ? it.pts[Math.floor(it.pts.length / 2)] : [it.lat, it.lon]; g.fillStyle = 'rgba(255,79,216,.07)'; g.beginPath();
    for (let t = 6; t <= HORIZON; t += 6) {
      const c = destination(mid[0], mid[1], it.dir, it.spd * t), e = destination(c.lat, c.lon, 90, coneKm(it, t)), pc = P0([c.lat, c.lon]), r = Math.abs(P0([e.lat, e.lon]).x - pc.x);
      g.moveTo(pc.x + r, pc.y); g.arc(pc.x, pc.y, r, 0, 7);
    }
    g.fill();
  }
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
  PR.t = t; $('prt').value = t; const d = when(t), rt = Math.round(t);
  $('prwhen').innerHTML = `<b>${rt === 0 ? 'Now (start)' : '+' + rt + ' hours'}</b> <small>${d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>`;
  $('prbadge').hidden = !(view.predictOn && PR.items.length); $('prbadgeT').textContent = rt === 0 ? 'start' : `+${rt} h`;
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
  const days = pl ? DAYS.map((t, i) => `Day ${i + 1} (+${t} h) at ${pl.name}: ` + meaning(t).map(r => r.html.replace(/<[^>]+>/g, '')).join(' ')) : [];
  return days.concat(PR.items.map(it => {
    const mv = it.spd > 0 ? `moves toward the ${compass(it.dir)} at ${esc(Math.round(spdOut(it.spd / 3.6)))} ${sUnit()}` : 'stays where it is';
    const lines = [`My projection from the ${from} map: the ${label(it).replace(/ \((mine|NOAA|computer-found)\)/, '')} ${mv}${it.kind !== 'front' && it.dp ? `, ${it.dp > 0 ? 'strengthening' : 'weakening'} ${Math.abs(it.dp)} hPa a day` : ''}.`];
    if (pl) { const r = readout(it).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); lines.push(r); }
    return lines.join(' ');
  })).join('\n');
}
// ---- evidence for each guess: what the past shows and what is typical. The student still chooses every number.
const TYPICAL = { H: [10, 45], L: [15, 70], 'Cold Front': [25, 60], 'Warm Front': [10, 40], 'Stationary Front': [0, 15], 'Occluded Front': [10, 40] };
const WORD = it => it.kind === 'front' ? NAMES[it.type] : it.kind === 'H' ? 'High' : 'Low';
const ms = kmh => fmtS(kmh / 3.6);
export function speedNote(it) { // a gentle "check this" when the speed is far beyond what that kind of system ever does; '' otherwise
  const [lo, hi] = TYPICAL[it.kind === 'front' ? it.type : it.kind] || [0, 80];
  return it.spd > hi * 1.6 ? `${ms(it.spd)} is faster than a ${WORD(it)} usually moves (typically ${ms(lo)} to ${ms(hi)}). Check your speed and units.` : '';
}
export const speedNotes = () => PR.items.map(it => ({ it, note: speedNote(it) })).filter(x => x.note);
function evidence(it) {
  const mid = it.kind === 'front' ? it.pts[Math.floor(it.pts.length / 2)] : [it.lat, it.lon], st = steerAt(mid[0], mid[1]), rows = [], [lo, hi] = TYPICAL[it.kind === 'front' ? it.type : it.kind] || [0, 80];
  if (it.trend) { const a = it.trend.before, b = it.trend.after; rows.push(Math.abs(b - a) < Math.max(5, .2 * a) ? `Its speed has been about steady (${ms(b)}).` : `It has been <b>${b > a ? 'speeding up' : 'slowing down'}</b>: ${ms(a)} from 24 to 12 h ago, ${ms(b)} over the last 12 h.`); }
  if (st) rows.push(`About 18,000 ft up, the wind here blows toward the <b>${compass(st.dir)}</b> at ${fmtS(st.ms)}.`);
  rows.push(it.kind === 'L' ? (st ? `Lows tend to follow that wind, at about ½ to ⅔ of its speed (${ms(st.ms * 3.6 * .5)} to ${ms(st.ms * 3.6 * .67)}).` : 'Lows tend to follow the high-altitude wind.')
    : it.kind === 'H' ? `Highs usually move more slowly than Lows (typically ${ms(lo)} to ${ms(hi)}) and often curve with the flow.`
    : it.type === 'Stationary Front' ? 'A stationary front barely moves until a Low or a change in the wind pushes it.'
    : `${it.type === 'Cold Front' ? 'Cold' : 'Warm'} fronts usually move ${ms(lo)} to ${ms(hi)}.${it.type === 'Cold Front' ? ' A stronger high-altitude wind pushes them faster.' : ''}`);
  return `<ul class="small">${rows.map(r => `<li>${r}</li>`).join('')}</ul>`;
}
// ---- "what this means at my place": the student's OWN projection, read with textbook rules. Directions and trends only: no temperatures, no rain amounts.
const wrap360 = x => ((x % 360) + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function windFromRule(kind, lat, brg) { // brg = bearing from the place to the system. Around a Low the air spirals inward (counterclockwise in the north), around a High outward (clockwise).
  const nh = lat >= 0; return wrap360(kind === 'L' ? (nh ? brg - 110 : brg + 110) : (nh ? brg + 70 : brg - 70));
}
const FRONT_RULE = {
  'Cold Front': { ahead: 'ahead of it: warmer, wind from the warm side, clouds building, pressure falling', at: 'passing: a band of showers or storms is possible, the wind shifts (clockwise in the north), temperature drops', behind: 'behind it: cooler and drier, wind shifted, pressure rising, skies clearing' },
  'Warm Front': { ahead: 'ahead of it: cooler, clouds thickening, steady rain or snow possible, pressure falling', at: 'passing: rain or drizzle, the wind shifts a little, temperature starts to rise', behind: 'behind it: warmer and more humid, clouds breaking, pressure steady' },
  'Stationary Front': { ahead: 'it is not moving much: weather on both sides stays similar', at: 'sitting over you: clouds and showers can last', behind: 'it is not moving much: weather stays similar' },
  'Occluded Front': { ahead: 'ahead of it: clouds thickening, pressure falling', at: 'passing: rain, then clearing', behind: 'behind it: clearing, cooler, pressure rising' },
};
function meaning(t) { // rows [{k, html}] about the place at hour t of the projection
  const pl = P.place, rows = [];
  for (const it of PR.items) {
    if (it.kind === 'front') {
      const r = nearestOnPolyline(pl.lat, pl.lon, shifted(it, t)), rule = FRONT_RULE[it.type] || FRONT_RULE['Cold Front'], name = NAMES[it.type];
      const ahead = it.spd > 0 && angDiff(it.dir, wrap360(r.toward + 180)) < 90, phase = r.km <= 75 ? 'at' : it.spd <= 0 ? 'ahead' : ahead ? 'ahead' : 'behind';
      rows.push({ k: 'front', km: r.km, html: `<b>${esc(name)}</b>: ${r.km <= 75 ? 'over your place' : `${esc(fmtD(r.km))} to the ${compass(r.toward)}${it.spd > 0 ? (ahead ? ', still approaching' : ', already passed') : ''}`}. ${rule[phase]}.` });
    } else {
      const c = pos(it, t), km = distKm(pl.lat, pl.lon, c.lat, c.lon), brg = bearing(pl.lat, pl.lon, c.lat, c.lon), c0 = pos(it, Math.max(0, t - 6)), km0 = distKm(pl.lat, pl.lon, c0.lat, c0.lon);
      const closer = km < km0 - 5, farther = km > km0 + 5, name = it.kind === 'H' ? 'High' : 'Low';
      const press = km > 2000 ? '' : it.kind === 'L' ? (closer ? 'Pressure is falling (the Low is getting closer).' : farther ? 'Pressure is rising (the Low is moving away).' : 'Pressure is steady.') : (closer ? 'Pressure is rising (the High is getting closer).' : farther ? 'Pressure is falling (the High is moving away).' : 'Pressure is steady.');
      const wind = km < 1500 ? `Wind rule: ${it.kind === 'L' ? 'inward and ' + (pl.lat >= 0 ? 'counterclockwise' : 'clockwise') : 'outward and ' + (pl.lat >= 0 ? 'clockwise' : 'counterclockwise')} around it, so about <b>from the ${compass(windFromRule(it.kind, pl.lat, brg))}</b>${km < 400 ? ' (it is close: wind is lighter near the center)' : ''}.` : 'Too far away to control your wind.';
      const weather = it.kind === 'L' ? (km < 500 ? 'Under or near a Low: clouds and rain or snow are likely.' : km < 1500 ? 'Edge of a Low: more clouds, a chance of rain or snow.' : '') : (km < 700 ? 'Under or near a High: mostly clear and calm.' : '');
      rows.push({ k: it.kind, km, html: `<b>${name}</b> (${Math.round(pressureAt(it, t))} hPa): ${esc(fmtD(km))} to the ${compass(brg)}. ${wind} ${press} ${weather}` });
    }
  }
  return rows.sort((a, b) => a.km - b.km);
}
const DAYS = [24, 48, 72];
function meanHTML() {
  if (!P.place) return '<p class="small muted">Choose your place on the My Place tab to see what your projection means there.</p>';
  return '<p class="small muted">Textbook rules applied to <b>your</b> projection. They tell you directions and trends, not temperatures or rain amounts. Turning them into numbers is your job.</p>' +
    DAYS.map((t, i) => `<details class="grp small" name="prmean" ${i === 0 ? 'open' : ''}><summary>Day ${i + 1} · +${t} h <span class="muted">${esc(when(t).toLocaleString([], { weekday: 'short', hour: 'numeric' }))}</span></summary><ul>${meaning(t).map(r => `<li>${r.html}</li>`).join('') || '<li>Nothing in your projection yet.</li>'}</ul></details>`).join('');
}
const renderMean = () => { const el = $('prmean'); if (el) el.innerHTML = PR.items.length ? meanHTML() : ''; };
const evOpen = new Set();
function renderItems() {
  const box = $('pritems');
  box.innerHTML = PR.items.length ? PR.items.map(it => `
    <div class="pitem" data-id="${it.id}">
      <div class="phead"><b>${it.kind === 'front' ? '〰️' : it.kind === 'H' ? '🔵' : '🔴'} ${esc(label(it))}</b><button class="ghost" data-act="del" aria-label="Remove ${esc(label(it))}">✕</button></div>
      ${it.from !== S.D.cycle ? '<p class="warn small">Starts from an older map. Remove and add it again to start from the newest map.</p>' : ''}
      ${it.m ? `<p class="small muted">Measured over the last ${it.m.hrs} h: toward the ${compass(it.m.dir)} at ${esc(Math.round(spdOut(it.m.kmh / 3.6)))} ${sUnit()}${it.kind !== 'front' ? `, ${it.m.dp > 0 ? '+' : ''}${it.m.dp.toFixed(1)} hPa` : ''}.</p>`
        : it.kind === 'front' ? '<p class="small muted">The symbols point the way it is moving. Measure how far it moved in the last 24 hours (turn on <b>Ghosts</b> on the Explore tab and use the ruler), then type its speed.</p>' : '<p class="small muted">This system is new in the last 48 h, so its motion is unknown. Make your best estimate.</p>'}
      <div class="pgrid">
        <label>Moves toward (°)<input type="number" min="0" max="359" step="1" data-k="dir" value="${Math.round(it.dir)}" aria-label="Direction it moves toward, in degrees"></label>
        <label>Speed (${sUnit()})<input type="number" min="0" step="1" data-k="spd" value="${Math.round(fromKmh(it.spd))}" aria-label="Speed in ${U.sys === 'us' ? 'miles per hour' : 'kilometers per hour'}"></label>
        ${it.kind === 'front' ? '' : `<label>Pressure change (hPa per day)<input type="number" step="0.5" data-k="dp" value="${it.dp}" aria-label="Pressure change in hectopascals per day"></label>`}
      </div>
      <p class="small dirtxt">Toward the <b>${compass(it.dir)}</b></p>
      <div class="pread">${readout(it)}</div>
      <p class="warn small spdwarn">${esc(speedNote(it))}</p>
      <details class="grp small evid" data-id="${it.id}" ${evOpen.has(it.id) ? 'open' : ''}><summary>🔎 Evidence for your guess</summary>${evidence(it)}</details>
      <button class="ghost" data-act="show">Show on the map</button>
    </div>`).join('') : '<p class="empty small">Nothing is in your projection yet. Add a High, Low or front below, or click one on the map.</p>';
  $('prplayrow').hidden = !PR.items.length; $('prpin').hidden = !PR.items.length; renderMean();
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
  $('prdays').querySelectorAll('button').forEach((b, i) => { b.textContent = `Day ${i + 1} · +${b.dataset.h} h`; b.title = when(+b.dataset.h).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); });
}
const playOff = () => { cancelAnimationFrame(PR.timer); PR.timer = null; $('prplay').textContent = '▶ Play my projection'; };

export function initPredict() {
  $('prt').max = HORIZON; $('prt').step = 1;
  $('prt').oninput = e => { playOff(); setT(+e.target.value); };
  $('prplay').onclick = () => {
    if (PR.timer) return playOff();
    if (PR.t >= HORIZON) setT(0);
    $('prplay').textContent = '❚❚ Pause'; let last = performance.now();
    const tick = now => { if (!PR.timer) return; const t = PR.t + 15 * Math.min(.1, (now - last) / 1000); last = now; if (t >= HORIZON) { setT(HORIZON); return playOff(); } setT(t); PR.timer = requestAnimationFrame(tick); };   // 15 hours per second, continuous
    PR.timer = requestAnimationFrame(tick);
  };
  $('prreset').onclick = () => { playOff(); setT(0); };
  $('prdays').onclick = e => { const b = e.target.closest('button'); if (b) { playOff(); setT(+b.dataset.h); } };
  $('prcone').onchange = () => redraw();
  $('pradds').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sys != null) addSystem($('pradds')._sys[+b.dataset.sys]); else if (b.dataset.fr != null) addFront($('pradds')._fr[+b.dataset.fr]);
  };
  $('pritems').addEventListener('input', e => {
    const k = e.target.dataset.k, el = e.target.closest('.pitem'); if (!k || !el) return; const it = PR.items.find(i => i.id === +el.dataset.id); if (!it) return;
    const v = +e.target.value; if (!isFinite(v)) return;
    if (k === 'dir') { it.dir = ((v % 360) + 360) % 360; el.querySelector('.dirtxt').innerHTML = `Toward the <b>${compass(it.dir)}</b>`; } else if (k === 'spd') it.spd = Math.max(0, kmh(v)); else it.dp = v;
    el.querySelector('.pread').innerHTML = readout(it); el.querySelector('.spdwarn').textContent = speedNote(it); renderMean(); save(); redraw(); document.dispatchEvent(new Event('projchanged'));
  });
  $('pritems').addEventListener('toggle', e => { const d = e.target.closest('.evid'); if (d) d.open ? evOpen.add(+d.dataset.id) : evOpen.delete(+d.dataset.id); }, true);
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
    if (!view.predictOn || Math.abs(S.t - S.hours[newest()]) > .01) return false;
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
