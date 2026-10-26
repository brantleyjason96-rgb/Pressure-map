// Local effects: windward and leeward. Cuts a terrain profile along the wind through the place, says which side of the
// mountains the place is on, and steps an air parcel over the ridge. All from the present wind and fixed terrain.
import { $, esc, fmtT, fmtElev, fmtD, compass, tempOut, tempIn, tUnit, U } from './util.js';
import { S, sample } from './data.js';
import { P, pastSeries } from './place.js';
import { view, hooks, map, redraw } from './mapview.js';
import { destination, flatFrame } from './geo.js';
import { classify, parcel, rh } from './physics.js';

const T = { fromDeg: null, modelWind: null, modelT: null, modelTd: null, prof: null, res: null, par: null, step: 0, T0: null, Td0: null, custom: null, drawing: 0, key: '', busy: false };
const cache = new Map(), STEP = 5, UP = 150, DOWN = 100;
const dirName = d => compass(d);
const dT = c => U.sys === 'us' ? Math.round(c * 1.8) + '°F' : Math.round(c) + '°C';
const rate = c => U.sys === 'us' ? (c * 1.8 / 3.281).toFixed(1) + '°F per 1,000 ft' : c + '°C per km';   // a cooling rate (a difference, so no +32)

async function elevations(pts) { // Open-Meteo elevation API: up to 100 points per call
  const key = pts.map(p => p.lat.toFixed(3) + ',' + p.lon.toFixed(3)).join(';');
  if (cache.has(key)) return cache.get(key);
  const r = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p.lat.toFixed(4)).join(',')}&longitude=${pts.map(p => p.lon.toFixed(4)).join(',')}`)).json();
  if (!Array.isArray(r.elevation)) throw new Error('no elevation');
  cache.set(key, r.elevation); return r.elevation;
}
const lineThrough = (pl, from) => { const a = destination(pl.lat, pl.lon, from, UP); return Array.from({ length: (UP + DOWN) / STEP + 1 }, (_, i) => i ? destination(a.lat, a.lon, from + 180, i * STEP) : a); };

function modelNow() {
  const ser = pastSeries(P.place), n = S.nPast - 1;
  T.modelWind = { dir: ser.dir[n], spd: ser.spd[n] }; T.modelT = ser.t[n]; T.modelTd = ser.d[n];
}
function setStart(zs, zp) { // air at the upwind end: take the place's model temperature and dewpoint down/up to that height
  const dz = (zp - zs) / 1000; T.T0 = T.modelT + 6.5 * dz; T.Td0 = Math.min(T.T0, T.modelTd + 2 * dz);
}

async function analyze() {
  const pl = P.place; if (!pl || !S.D) return;
  const mine = T.custom, from = T.fromDeg, key = mine ? 'c' + mine.a.lat + mine.b.lat : `${pl.lat},${pl.lon},${from}`;
  $('mres').innerHTML = '<span class="muted">Reading the terrain…</span>';
  T.busy = true;
  try {
    let pts, step, p; const fit = T.fit; T.fit = false;
    if (mine) {
      const F = flatFrame(mine.a.lat, mine.a.lon), [bx, by] = F.xy(mine.b.lat, mine.b.lon), L = Math.hypot(bx, by), n = Math.min(80, Math.max(10, Math.round(L / STEP) + 1));
      pts = Array.from({ length: n }, (_, i) => F.ll(bx * i / (n - 1), by * i / (n - 1))); step = L / (n - 1);
      const [px, py] = F.xy(pl.lat, pl.lon), t = Math.max(0, Math.min(1, (px * bx + py * by) / (L * L))), off = Math.hypot(px - bx * t, py - by * t);
      p = off <= 25 ? Math.round(t * (n - 1)) : null;
    } else { pts = lineThrough(pl, from); step = STEP; p = UP / STEP; }
    const z = (await elevations(pts)).map(v => Math.max(0, v));
    if (key !== (mine ? 'c' + mine.a.lat + mine.b.lat : `${pl.lat},${pl.lon},${T.fromDeg}`)) return;   // the student moved on while we waited
    T.prof = { pts, z, step, p }; T.res = classify(z, step, p);
    const zs = z[0], zp = p == null ? zs : z[p];
    if (mine) { const n = S.nPast - 1, t = sample(S.D.f.t[n], mine.a.lat, mine.a.lon), d = sample(S.D.f.d[n], mine.a.lat, mine.a.lon); T.T0 = t; T.Td0 = Math.min(t, d); } else setStart(zs, zp);
    T.step = 0; T.busy = false; drawAll();
    if (fit) map.flyToBounds(L.latLngBounds(pts.map(q => [q.lat, q.lon])), { maxZoom: 8, padding: [60, 60], duration: .8 });
  } catch { $('mres').innerHTML = '<span class="warn">Terrain lookup needs an internet connection. Try again in a moment.</span>'; T.busy = false; }
}

// ---- drawing the section
function svg() {
  const { z, p, step, pts } = T.prof, N = z.length, W = 360, H = 215, L = 10, R = 10, Tp = 40, B = 28;
  const zmax = Math.max(600, Math.max(...z) * 1.15), X = i => L + i * (W - L - R) / (N - 1), Y = v => H - B - v / zmax * (H - Tp - B), pr = T.par, st = T.step;
  let g = `<rect width="${W}" height="${H}" fill="#0c1118"/>`;
  g += `<polygon points="${X(0)},${Y(0)} ${z.map((v, i) => X(i) + ',' + Y(v)).join(' ')} ${X(N - 1)},${Y(0)}" fill="#6f5d43" stroke="#a98d62" stroke-width="1.5"/>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#4aa3ff" stroke-width="1" stroke-dasharray="3 3"/><text x="${L + 2}" y="${Y(0) + 12}" class="t2">sea level</text>`;
  if (p != null) g += `<line x1="${X(p)}" x2="${X(p)}" y1="${Y(z[p]) - 4}" y2="${Tp - 8}" stroke="#ffd23f" stroke-dasharray="2 3"/><text x="${X(p)}" y="${Tp - 12}" text-anchor="middle" class="tp">📍 you</text>`;
  const c = pr.c; g += `<text x="${X(c)}" y="${Y(z[c]) - 26}" text-anchor="middle" class="tl">▲ ${esc(fmtElev(z[c]))}</text>`;
  if (pr.sat && st >= 1) { // cloud on the lifted slope; rain once it is above the cloud base
    for (let i = pr.iL; i <= c; i += 2) { g += `<ellipse cx="${X(i)}" cy="${Y(z[i]) - 15}" rx="12" ry="6.5" fill="#e7edf6" opacity=".92"/>`; if (st >= 2) g += [-4, 0, 4].map(o => `<line x1="${X(i) + o}" x2="${X(i) + o - 2}" y1="${Y(z[i]) - 8}" y2="${Y(z[i]) - 2}" stroke="#5aaeff" stroke-width="1.5"/>`).join(''); }
  }
  if (st >= 3) for (let i = c + 3; i < N - 1; i += 4) g += `<text x="${X(i)}" y="${Y(z[i]) - 14}" text-anchor="middle" class="dn">↓</text>`;
  const upto = [0, pr.sat ? pr.iL : c, c, N - 1][st], path = z.slice(0, upto + 1).map((v, i) => X(i) + ',' + (Y(v) - 7)).join(' ');
  if (upto > 0) g += `<polyline points="${path}" fill="none" stroke="#ff7b54" stroke-width="2.4" stroke-linecap="round"/>`;
  const at = [pr.start, pr.lcl || pr.crest, pr.crest, pr.end][st];
  g += `<circle cx="${X(at.i)}" cy="${Y(z[at.i]) - 7}" r="6" fill="#ff7b54" stroke="#fff" stroke-width="1.5"/>`;
  const lab = (pt, name) => `<text x="${Math.min(W - 40, Math.max(36, X(pt.i)))}" y="${Y(z[pt.i]) + 15}" text-anchor="middle" class="tt2">${name} ${esc(fmtT(pt.T))}</text>`;
  g += lab(pr.start, 'start');
  if (st >= 1 && pr.lcl) g += lab(pr.lcl, 'cloud base');
  if (st >= 2) g += lab(pr.crest, 'crest');
  if (st >= 3) g += lab(pr.end, 'end');
  g += `<text x="${W / 2}" y="14" text-anchor="middle" class="tw">Air flows → from the ${dirName(T.custom ? bearingOf(pts[0], pts.at(-1)) + 180 : T.fromDeg)} (${esc(fmtD(step * (N - 1)))} line)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="xsec">${g}</svg>`;
}
const bearingOf = (a, b) => { const F = flatFrame(a.lat, a.lon), [x, y] = F.xy(b.lat, b.lon); return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; };

const STEPS = pr => {
  const f = fmtElev, up = (a, b) => dT(a - b);
  return [
    `<b>1 · Start.</b> Air at the upwind end (${f(pr.zs)}): ${fmtT(pr.start.T)}, dewpoint ${fmtT(pr.start.Td)}, relative humidity about ${Math.round(pr.start.rh)}%. The wind pushes it toward the mountains.`,
    pr.sat ? `<b>2 · Rising and cooling.</b> Forced up the slope the air expands and cools about ${rate(9.8)}. At ${f(pr.zl)} it has cooled to its dewpoint (${fmtT(pr.lcl.T)}). Water vapor condenses: <b>clouds form</b> here (the cloud base).`
      : `<b>2 · Rising and cooling.</b> The air would have to rise to ${f(pr.zl)} to reach its dewpoint, but the crest is only ${f(pr.zc)}. <b>The air stays unsaturated, so no clouds form from lifting.</b> It cools about ${rate(9.8)} all the way.`,
    pr.sat ? `<b>3 · Rain on the windward side.</b> Above the cloud base condensation releases heat, so it cools more slowly (about ${rate(6)}). Rain falls on the windward slope. At the crest it is ${fmtT(pr.crest.T)}.`
      : `<b>3 · Over the top.</b> The air reaches the crest at ${fmtT(pr.crest.T)}, with no rain made by the mountain.`,
    pr.sat ? `<b>4 · Sinking on the leeward side.</b> The air has lost its water. Sinking, it warms about ${rate(9.8)}. At the end of the line it is <b>${fmtT(pr.end.T)}</b>: <b>${up(pr.end.T, pr.start.T)} warmer</b> than it started, and relative humidity is only about ${Math.round(pr.end.rh)}%. This warm, dry zone is the <b>rain shadow</b>.`
      : `<b>4 · Sinking.</b> Going down the far side the air warms about ${rate(9.8)} and reaches ${fmtT(pr.end.T)} (relative humidity about ${Math.round(pr.end.rh)}%).`,
  ];
};

const KIND = r => {
  const m = r.ridge && fmtElev(r.ridge.z), d = r.dKm != null ? fmtD(Math.abs(r.dKm)) : '';
  return {
    windward: ['windward', `Your place is on the <b>windward</b> side. Air coming from the ${dirName(T.fromDeg)} must rise to cross a ${m} crest about ${d} downwind (a climb of about ${fmtElev(r.gain)}). Rising air cools, so this side tends to be <b>cloudier and wetter</b>.`],
    leeward: ['leeward', `Your place is on the <b>leeward</b> side. A ${m} crest lies about ${d} upwind, to the ${dirName(T.fromDeg)}. Air that crossed it is sinking, so this side tends to be <b>drier and warmer</b> (a rain shadow).`],
    crest: ['on the crest', `Your place is on or very close to the <b>top of the range</b> (${m}). Cloud and wind are strongest at the crest; you are not clearly windward or leeward.`],
    far: ['far from the range', `The nearest significant mountains (${m}) are about ${d} away. That is too far for a strong windward or leeward effect right now. Try another wind direction.`],
    flat: ['no mountains in the way', `There are <b>no significant mountains</b> along this wind line (the ground varies by only ${fmtElev(r.relief)}). Try another wind direction.`],
    line: ['', `The highest ridge on your line is ${m}.`],
  }[r.kind];
};
function summary() {
  const [lab, txt] = KIND(T.res), pl = P.place;
  const base = T.custom ? 'my cross-section line' : `wind from the ${dirName(T.fromDeg)}`, pr = T.par;
  const note = `${pl.name}, ${base}: ${lab ? lab + '. ' : ''}${txt.replace(/<[^>]+>/g, '')}` + (pr.sat ? ` Air starting at ${fmtT(pr.start.T)} (dewpoint ${fmtT(pr.start.Td)}) forms cloud at ${fmtElev(pr.zl)}, and sinks to ${fmtT(pr.end.T)} (about ${Math.round(pr.end.rh)}% humidity) on the leeward side.` : ` The air stays too dry to make cloud from lifting.`);
  return { lab, txt, note };
}
function drawAll() {
  if (!T.prof) return;
  T.par = parcel(T.prof.z, T.prof.step, T.T0, T.Td0);
  const { lab, txt, note } = summary();
  $('mres').innerHTML = `${lab ? `<div class="verdict ${T.res.kind}">${esc(lab[0].toUpperCase() + lab.slice(1))}</div>` : ''}<p>${txt}</p><button class="pinbtn" data-topic="oro" data-text="${esc(note)}">📌 Add to notes</button>`;
  $('msvg').innerHTML = svg(); $('mtext').innerHTML = STEPS(T.par)[T.step]; $('mstep').textContent = `Step ${T.step + 1} of 4`;
  $('mprev').disabled = T.step === 0; $('mnext').disabled = T.step === 3;
  $('mT0').value = Math.round(tempOut(T.T0)); $('mTd0').value = Math.round(tempOut(T.Td0));
  $('mTu').textContent = tUnit(); $('mTu2').textContent = tUnit();
  const P0 = T.prof.pts, rp = T.prof.pts[T.par.c];
  view.section = { pts: [P0[0], P0.at(-1)], ridge: rp, place: P.place, custom: !!T.custom }; redraw();
}

function setWind(deg) { T.custom = null; T.fromDeg = (Math.round(deg / 5) * 5 + 360) % 360; $('wslide').value = T.fromDeg; windText(); clearTimeout(setWind.t); setWind.t = setTimeout(analyze, 250); }
const windText = () => { const m = T.modelWind; $('wtxt').innerHTML = `${dirName(T.fromDeg)} (${T.fromDeg}°)`; $('wmodel').textContent = m ? `Model wind right now: from the ${dirName(m.dir)} (${Math.round(m.dir)}°)` : ''; };

export function refreshMountains() {
  const ok = !!(P.place && S.D); $('mbody').hidden = !ok; if (!ok) { view.section = null; redraw(); return; }
  modelNow(); T.custom = null; T.drawing = 0; $('mdraw').textContent = '✏️ Draw my own cross-section'; $('mdraw').classList.remove('active');
  T.fromDeg = (Math.round(T.modelWind.dir / 5) * 5 + 360) % 360; $('wslide').value = T.fromDeg; windText(); T.fit = true; analyze();
}

export function initTerrain() {
  $('mbody').innerHTML = `
    <div class="windctl"><b>Wind from the <span id="wtxt"></span></b> <small id="wmodel" class="muted"></small>
      <input type="range" id="wslide" min="0" max="355" step="5" aria-label="Wind direction">
      <div class="cardinals">${[['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]].map(([n, d]) => `<button data-d="${d}">${n}</button>`).join('')}<button id="wmodelbtn" class="ghost">Use model wind</button></div></div>
    <div id="mres"></div><div id="msvg"></div>
    <div class="steps"><button id="mprev">◀ Back</button><b id="mstep"></b><button id="mnext" class="primary">Next ▶</button></div>
    <p id="mtext"></p>
    <details><summary>Change the starting air</summary><p class="small muted">The air’s temperature and dewpoint at the upwind end, estimated from your place. Try other values to see when clouds form.</p>
      <div class="inline"><label>Temperature <input type="number" id="mT0" step="1"> <span id="mTu"></span></label><label>Dewpoint <input type="number" id="mTd0" step="1"> <span id="mTu2"></span></label><button id="mreset" class="ghost">Reset</button></div></details>
    <div class="inline"><button id="mdraw">✏️ Draw my own cross-section</button><button id="mterr" class="ghost">Show terrain map</button></div>
    <p class="small muted">Elevation: Copernicus 90 m data via Open-Meteo. Temperatures use simple textbook rates (dry air cools 9.8 °C per km, about 5.4 °F per 1,000 ft; saturated air about 6 °C per km, 3.3 °F per 1,000 ft).</p>`;
  $('wslide').oninput = e => setWind(+e.target.value);
  document.querySelectorAll('#mbody .cardinals [data-d]').forEach(b => b.onclick = () => setWind(+b.dataset.d));
  $('wmodelbtn').onclick = () => setWind(T.modelWind.dir);
  $('mprev').onclick = () => { T.step = Math.max(0, T.step - 1); drawAll(); };
  $('mnext').onclick = () => { T.step = Math.min(3, T.step + 1); drawAll(); };
  const air = () => { T.T0 = tempIn(+$('mT0').value); T.Td0 = Math.min(T.T0, tempIn(+$('mTd0').value)); drawAll(); };
  $('mT0').onchange = air; $('mTd0').onchange = air;
  $('mreset').onclick = () => { if (T.prof) { const z = T.prof.z; if (T.custom) { const n = S.nPast - 1; T.T0 = sample(S.D.f.t[n], T.custom.a.lat, T.custom.a.lon); T.Td0 = Math.min(T.T0, sample(S.D.f.d[n], T.custom.a.lat, T.custom.a.lon)); } else setStart(z[0], z[T.prof.p]); drawAll(); } };
  $('mterr').onclick = () => { $('base').value = 'terrain'; $('base').dispatchEvent(new Event('change')); };
  $('mdraw').onclick = () => { T.drawing = T.drawing ? 0 : 1; T.a = null; $('mdraw').classList.toggle('active', !!T.drawing); $('mdraw').textContent = T.drawing ? 'Click the UPWIND end on the map… (cancel)' : '✏️ Draw my own cross-section'; };
  hooks.click.push(e => {
    if (!T.drawing) return false;
    if (T.drawing === 1) { T.a = { lat: e.latlng.lat, lon: e.latlng.lng }; T.drawing = 2; view.section = { pts: [T.a, T.a], place: P.place, custom: true }; redraw(); $('mdraw').textContent = 'Now click the DOWNWIND end (max 400 km)…'; return true; }
    const b = { lat: e.latlng.lat, lon: e.latlng.lng }, F = flatFrame(T.a.lat, T.a.lon), [x, y] = F.xy(b.lat, b.lon);
    if (Math.hypot(x, y) > 400 || Math.hypot(x, y) < 20) { $('mdraw').textContent = 'Line must be 20–400 km. Click the DOWNWIND end again…'; return true; }
    T.custom = { a: T.a, b }; T.drawing = 0; $('mdraw').classList.remove('active'); $('mdraw').textContent = '✏️ Draw another cross-section'; T.fit = false; analyze(); return true;
  });
  $('mres').addEventListener('click', e => { const b = e.target.closest('.pinbtn'); if (b) { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: b.dataset.topic, text: b.dataset.text } })); b.textContent = '✓ Added to notes'; b.disabled = true; } });
  document.addEventListener('units', () => { if (T.prof && !$('tab-local').hidden) drawAll(); });
}
