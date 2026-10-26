// The map: Leaflet base + one canvas that draws shading, isobars, H/L, wind, tracks and fronts for the current frame.
import { $, on, range, ramp, fmtT, fmtS, fmtP, fmtRain, fmtD, windFrom, compass, esc, distKm, U } from './util.js';
import { S, fld, sample, windAt, contour, frameInfo, frameTime, isForecast, motionOf, gradientGrid } from './data.js';

export const view = { hint: null, place: null, light: false, section: null, coast: null, layers: {} };   // layers: name -> fn(g, map, canvasLayer) for modules that draw on the map
export const hooks = { click: [] };            // other modules (quiz, place picker) get first look at map clicks
export let map, layer;

const PCOL = [[980, [40, 80, 220]], [1000, [90, 170, 240]], [1013, [235, 235, 235]], [1030, [250, 170, 60]], [1045, [210, 40, 40]]];
const TCOL = [[-40, [150, 80, 200]], [-20, [80, 100, 230]], [0, [120, 200, 240]], [10, [120, 220, 150]], [20, [250, 230, 90]], [30, [250, 140, 50]], [40, [220, 50, 40]], [50, [150, 20, 40]]];
const DCOL = [[-30, [170, 130, 90]], [-10, [210, 190, 120]], [0, [170, 220, 150]], [10, [90, 200, 140]], [18, [40, 170, 170]], [24, [40, 110, 200]]];
const RCOL = [[0.3, [140, 215, 150]], [1, [60, 175, 90]], [3, [30, 130, 60]], [6, [240, 220, 60]], [12, [245, 150, 40]], [25, [220, 50, 40]], [50, [200, 40, 200]]];
const JCOL = [[30, [150, 200, 255]], [50, [90, 230, 200]], [70, [120, 235, 100]], [90, [250, 230, 70]], [110, [250, 140, 50]], [130, [230, 50, 50]], [150, [220, 60, 220]]];
const SCOL = [[-2, [50, 30, 130]], [5, [40, 100, 200]], [12, [60, 180, 200]], [20, [120, 210, 120]], [26, [250, 220, 70]], [30, [240, 120, 40]], [33, [200, 40, 40]]];
const ACOL = [[-6, [30, 60, 200]], [-3, [110, 170, 255]], [0, [235, 235, 235]], [3, [255, 170, 110]], [6, [210, 40, 40]]];
const GCOL = [[0.4, [255, 245, 160]], [1.2, [255, 200, 70]], [2.5, [245, 120, 40]], [4.5, [205, 40, 60]]];
const dC = c => U.sys === 'us' ? Math.round(c * 1.8) : Math.round(c);   // a temperature difference, so no +32
const flipped = stops => stops.map(([v], i) => [v, stops[stops.length - 1 - i][1]]);
export const MODES = {
  p: { f: 'p', stops: PCOL, col: p => [...ramp(on('flip') ? flipped(PCOL) : PCOL, Math.max(980, p)), 150], l: () => ['980', '1013', '1045 hPa'] },
  t: { f: 't', stops: TCOL, col: v => [...ramp(TCOL, v), 140], l: () => [fmtT(-40), fmtT(10), fmtT(50)] },
  d: { f: 'd', stops: DCOL, col: v => [...ramp(DCOL, Math.max(-30, v)), 150], l: () => ['dry ' + fmtT(-30), fmtT(0), 'humid ' + fmtT(24)] },
  pr: { f: 'pr', stops: RCOL, col: v => { const c = ramp(RCOL, v); return c && [...c, Math.min(190, (v - 0.3) * 600)]; }, l: () => ['0.3 mm', '6', '50+ mm in the 6 h before'] },
  sst: { grid: () => S.D.sst, stops: SCOL, col: v => [...ramp(SCOL, Math.max(-2, v)), 175], l: () => [fmtT(-2), fmtT(20), fmtT(33)] },
  sstA: { grid: () => S.D.sstA, stops: ACOL, col: v => [...ramp(ACOL, Math.max(-6, Math.min(6, v))), Math.min(190, 70 + Math.abs(v) * 30)], l: () => [`${dC(6)}° colder`, 'normal for the latitude', `${dC(6)}° warmer`] },
  tg: { grid: () => gradientGrid(S.cur), stops: GCOL, col: v => { const c = ramp(GCOL, v); return c && [...c, Math.min(200, 40 + (v - .4) * 150)]; }, l: () => [`${dC(0.4)}°`, `${dC(2.5)}°`, `${dC(4.5)}°+ per 100 km`] },
  w5: { f: 'w5', stops: JCOL, col: v => { const c = ramp(JCOL, v); return c && [...c, 170]; }, l: () => ['30 kt', '90', '150+ kt'] },
};
const PLEV = range(948, 1068, 4), HLEV = range(4800, 6000, 60);
const FCOL = { 'Cold Front': '#3b82ff', 'Warm Front': '#ff3b3b', 'Stationary Front': '#3b82ff', 'Occluded Front': '#b043ff', 'Trough': '#d9a066' };
const frType = f => f.properties.feat.replace(' Valid', '');
const frLines = (f, m) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]).map(l => l.map(([x, y]) => m.latLngToContainerPoint([y, x])));

let borders = [], fronts = null, pin = null;
const BASES = {
  dark: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', max: 16, light: false },
  terrain: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', max: 13, light: true },
};
let baseLayer;
function setBase(k) {
  if (baseLayer) map.removeLayer(baseLayer);
  const b = BASES[k]; view.light = b.light;
  baseLayer = L.tileLayer(b.url, { maxZoom: b.max, attribution: 'Esri · borders: Natural Earth, PublicaMundi · weather data: NOAA GFS · fronts: NOAA WPC' }).addTo(map);
  baseLayer.bringToBack(); if (layer) layer.draw();
}

const Cv = L.Layer.extend({
  onAdd(m) {
    this._m = m; this.c = L.DomUtil.create('canvas', 'leaflet-zoom-hide'); this.c.style.pointerEvents = 'none';
    m.getPanes().overlayPane.appendChild(this.c); m.on('moveend zoomend resize', this.draw, this); this.draw();
  },
  onRemove(m) { this.c.remove(); m.off('moveend zoomend resize', this.draw, this); },
  draw() {
    const m = this._m; if (!m) return; const s = m.getSize(), c = this.c;
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0])); c.width = s.x; c.height = s.y;
    if (s.x < 1 || s.y < 1) return;
    const g = c.getContext('2d'), mode = MODES[$('shade').value];
    if (!S.D) return;
    const info = frameInfo(S.cur);
    const grid = mode && (mode.grid ? mode.grid() : S.D.f[mode.f][S.cur]);
    if (grid) {
      const f = grid, q = 6, w = Math.ceil(s.x / q), h = Math.ceil(s.y / q), t = document.createElement('canvas'); t.width = w; t.height = h;
      const tg = t.getContext('2d'), im = tg.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ll = m.containerPointToLatLng([x * q, y * q]), v = sample(f, ll.lat, ll.lng); if (isNaN(v)) continue;
        const col = mode.col(v); if (col) im.data.set(col, (y * w + x) * 4);
      }
      tg.putImageData(im, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(t, 0, 0, s.x, s.y);
    }
    if (on('stt')) this.borders(g);
    if (on('iso')) { info.segs ||= contour(S.D.f.p[S.cur], PLEV); this.iso(g, info.segs, PLEV, v => v, L => L % 20 === 0); }
    if (on('h5l')) { info.h5 ||= contour(S.D.f.h5[S.cur], HLEV); this.iso(g, info.h5, HLEV, v => Math.round(v / 10), L => L % 300 === 0, [6, 4]); }
    if (on('trk')) this.tracks(g);
    if (on('wind')) this.wind(g);
    if (on('hl')) this.hl(g, info.ex);
    if (on('fr') && fronts && S.cur === S.nPast - 1) this.drawFronts(g, fronts.gj);
    for (const fn of Object.values(view.layers)) fn(g, m, this);
    if (view.section) this.section(g);
    if (view.coast) this.coast(g);
    if (view.hint && view.hint.ll) { const p = m.latLngToContainerPoint(view.hint.ll); g.strokeStyle = '#ffd23f'; g.lineWidth = 4; g.beginPath(); g.arc(p.x, p.y, 28, 0, 7); g.stroke(); }
  },
  borders(g) {
    g.strokeStyle = view.light ? '#0007' : '#fff6'; g.lineWidth = 1; g.beginPath();
    for (const f of borders) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) ring.forEach(([x, y], i) => { const p = this._m.latLngToContainerPoint([y, x]); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
    }
    g.stroke();
  },
  iso(g, segs, levels, fmt, bold, dash) { // lines + a label about every 110 px
    const m = this._m, placed = [], lt = view.light; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 11px system-ui';
    for (const L of levels) {
      g.strokeStyle = dash ? (lt ? '#6a2ca0' : '#d6b3ff') : bold(L) ? (lt ? '#000' : '#fff') : (lt ? '#000a' : '#fffa'); g.lineWidth = bold(L) ? 1.8 : 1; g.setLineDash(dash || []); g.beginPath();
      const Sg = segs[L].map(([a, b, c, d]) => [m.latLngToContainerPoint([a, b]), m.latLngToContainerPoint([c, d])]);
      for (const [p, q] of Sg) { g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); }
      g.stroke(); g.setLineDash([]);
      for (const [p, q] of Sg) {
        const x = (p.x + q.x) / 2, y = (p.y + q.y) / 2;
        if (x < 20 || y < 20 || x > g.canvas.width - 20 || y > g.canvas.height - 20 || Math.hypot(p.x - q.x, p.y - q.y) < 3) continue;
        if (placed.some(o => Math.hypot(o[0] - x, o[1] - y) < 110)) continue;
        placed.push([x, y]); let a = Math.atan2(q.y - p.y, q.x - p.x); if (Math.abs(a) > Math.PI / 2) a += Math.PI;
        g.save(); g.translate(x, y); g.rotate(a); g.lineWidth = 3; g.strokeStyle = lt ? '#fff' : '#000'; g.fillStyle = lt ? '#000' : dash ? '#e6d2ff' : '#fff';
        g.strokeText(fmt(L), 0, 0); g.fillText(fmt(L), 0, 0); g.restore();
      }
    }
    g.textBaseline = 'alphabetic';
  },
  wind(g) { // real model winds; arrow length grows with speed
    const m = this._m, s = m.getSize(), STEP = 52;
    for (let x = STEP / 2; x < s.x; x += STEP) for (let y = STEP / 2; y < s.y; y += STEP) {
      const ll = m.containerPointToLatLng([x, y]), w = windAt(ll.lat, ll.lng); if (!w) continue;
      const sp = Math.hypot(w.u, w.v), len = Math.min(44, 4 + sp * 3.2), a = Math.atan2(-w.v, w.u);
      g.save(); g.translate(x, y); g.rotate(a);
      for (const [lw, col] of [[4, view.light ? '#fffa' : '#000a'], [2, view.light ? '#000' : '#fff']]) {
        g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
        g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.moveTo(len / 2 - 6, -4); g.lineTo(len / 2, 0); g.lineTo(len / 2 - 6, 4); g.stroke();
      }
      g.restore();
    }
  },
  hl(g, ex) {
    g.textAlign = 'center'; const big = this._m.getZoom() < 4, fs = big ? 15 : 22;
    for (const e of ex) {
      const p = this._m.latLngToContainerPoint([e.lat, e.lon]);
      if (p.x < 0 || p.y < 0 || p.x > g.canvas.width || p.y > g.canvas.height) continue;
      g.strokeStyle = '#000'; g.fillStyle = e.t === 'H' ? '#8bbcff' : '#ff9a9a'; g.font = `bold ${fs}px system-ui`; g.lineWidth = 4; g.strokeText(e.t, p.x, p.y); g.fillText(e.t, p.x, p.y);
      g.fillStyle = '#fff'; g.font = `bold ${big ? 9 : 11}px system-ui`; g.lineWidth = 3; g.strokeText(Math.round(e.v), p.x, p.y + fs * .6); g.fillText(Math.round(e.v), p.x, p.y + fs * .6);
    }
  },
  tracks(g) { // where each H/L has been: a dotted trail, one dot per 6 h
    for (const tr of S.tracks) {
      const pts = tr.pts.filter(p => p.i <= S.cur); if (pts.length < 2 || pts.at(-1).i !== S.cur) continue;
      const P = pts.map(p => this._m.latLngToContainerPoint([p.lat, p.lon]));
      g.strokeStyle = tr.t === 'H' ? '#8bbcff' : '#ff9a9a'; g.fillStyle = g.strokeStyle; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
      P.forEach((p, i) => (i && Math.abs(pts[i].lon - pts[i - 1].lon) < 180) ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
      P.forEach((p, i) => { if (i < P.length - 1) { g.beginPath(); g.arc(p.x, p.y, 2.5, 0, 7); g.fill(); } });
    }
  },
  section(g) { // the wind line used for the mountain cross-section
    const s = view.section, m = this._m, P0 = s.pts.map(p => m.latLngToContainerPoint([p.lat, p.lon])), [a, b] = P0;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 4) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      for (const [lw, col, dash] of [[6, '#000a', []], [3, '#ffd23f', [9, 6]]]) { g.lineWidth = lw; g.strokeStyle = col; g.setLineDash(dash); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      g.setLineDash([]); g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.save(); g.translate(b.x, b.y); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.lineTo(-14, -7); g.lineTo(-14, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#fff'; g.strokeText('upwind', a.x, a.y - 8); g.fillText('upwind', a.x, a.y - 8);
    if (s.ridge) { const r = m.latLngToContainerPoint([s.ridge.lat, s.ridge.lon]); g.fillStyle = '#ff7b54'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(r.x, r.y - 9); g.lineTo(r.x - 7, r.y + 5); g.lineTo(r.x + 7, r.y + 5); g.closePath(); g.fill(); g.stroke(); }
  },
  coast(g) { // line from the place to the nearest water
    const c = view.coast, m = this._m, a = m.latLngToContainerPoint([c.place.lat, c.place.lon]), b = m.latLngToContainerPoint([c.coast.lat, c.coast.lon]);
    g.lineWidth = 5; g.strokeStyle = '#000a'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = '#4aa3ff'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    g.font = '18px system-ui'; g.textAlign = 'center'; g.fillText('🌊', b.x, b.y + 6);
  },
  drawFronts(g, gj) {
    const SP = 26;
    for (const f of gj.features) {
      const type = frType(f), col = FCOL[type] || '#fff';
      for (const P of frLines(f, this._m)) {
        if (view.hint && view.hint.feat === f) { g.lineWidth = 9; g.strokeStyle = '#ffd23f'; g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); }
        g.lineWidth = 2.5; g.strokeStyle = col; g.setLineDash(type === 'Trough' ? [8, 6] : []);
        g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
        if (type === 'Trough') continue;
        let acc = SP / 2, n = 0;
        for (let i = 1; i < P.length; i++) {
          const a = P[i - 1], b = P[i], d = Math.hypot(b.x - a.x, b.y - a.y); if (!d) continue;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          while (acc <= d) {
            const x = a.x + Math.cos(ang) * acc, y = a.y + Math.sin(ang) * acc;
            const kind = type === 'Cold Front' ? 'cold' : type === 'Warm Front' ? 'warm' : (n % 2 ? 'warm' : 'cold');
            this.sym(g, x, y, ang, kind, type === 'Stationary Front' && n % 2 ? '#ff3b3b' : col); n++; acc += SP;
          }
          acc -= d;
        }
      }
    }
  },
  sym(g, x, y, ang, kind, col) {
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.beginPath();
    if (kind === 'cold') { g.moveTo(-6, 0); g.lineTo(6, 0); g.lineTo(0, -10); } else g.arc(0, 0, 6, Math.PI, 0);
    g.closePath(); g.fill(); g.restore();
  },
});
export const redraw = () => layer && layer.draw();
export const frontLines = () => fronts && fronts.gj.features;
export const frontsNote = () => fronts ? `Fronts: NOAA WPC surface chart for ${fronts.date}, shown on the newest map only.` : 'No NOAA front chart loaded (fronts are North America only).';
export { frType, frLines };

// ---- frame control (the slider only reaches back 48 h to "now"; teacher mode adds forecast frames after it)
export function setFrame(i) {
  S.cur = i; const t = frameTime(i), h = S.hours[i];
  const rel = h === 0 ? 'Now (newest model analysis)' : h < 0 ? `${-h} h ago` : `FORECAST +${h} h`;
  $('when').className = isForecast(i) ? 'fc' : '';
  $('when').innerHTML = `<b>${rel}</b><small>${t.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</small>`;
  $('slider').value = i; legend(); layer.draw();
  shadeNote();
  document.dispatchEvent(new CustomEvent('frame', { detail: i }));
}
function shadeNote() {
  const sh = $('shade').value;
  $('note2').textContent = sh === 'pr' && S.D && !S.D.f.pr[S.cur] ? 'No rain total for this frame.' : sh === 'sst' || sh === 'sstA' ? 'Sea temperature is from the newest analysis and is the same on every frame.' : sh === 'tg' ? 'Orange and red bands are where temperature changes quickly with distance. Fronts sit along them.' : '';
}
export function legend() {
  shadeNote();
  $('fliprow').hidden = $('shade').value !== 'p';
  const m = MODES[$('shade').value]; $('legend').style.visibility = m ? 'visible' : 'hidden';
  if (!m) { ['l0', 'l1', 'l2'].forEach(i => $(i).textContent = ''); return; }
  $('legend').style.background = 'linear-gradient(90deg,' + m.stops.map(([v]) => `rgb(${(m.col(v) || m.stops[0][1]).slice(0, 3).map(Math.round)})`).join(',') + ')';
  [0, 1, 2].forEach(i => $('l' + i).textContent = m.l()[i]);
}

// ---- place pin
export function setPin(p) {
  if (pin) { map.removeLayer(pin); pin = null; }
  if (!p) return;
  pin = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pin', html: '<span>📍</span>', iconSize: [28, 28], iconAnchor: [14, 26] }), keyboard: false, interactive: false }).addTo(map);
}
export const flyTo = (lat, lon, z) => map.flyTo([lat, lon], Math.max(map.getZoom(), z ?? 5), { duration: .8 });

// ---- clicks: other modules first, then H/L info, then a probe of the values at that spot
const shortTime = () => frameTime(S.cur).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const inHgNote = p => p >= 1013 ? 'above' : 'below';
function probe(e) {
  const { lat, lng } = e.latlng, f = k => sample(fld(k), lat, lng), p = f('p'); if (isNaN(p)) return;
  const w = windAt(lat, lng), pr = S.D.f.pr[S.cur] && sample(S.D.f.pr[S.cur], lat, lng);
  L.popup().setLatLng(e.latlng).setContent(
    `<b>${esc(fmtP(p))}</b> — ${inHgNote(p)} average (1013): ${p >= 1013 ? 'high' : 'low'}-pressure side<br>` +
    `Temperature ${fmtT(f('t'))} · dewpoint ${fmtT(f('d'))}<br>` + (w ? `Wind from the ${compass(windFrom(w.u, w.v))} at ${fmtS(Math.hypot(w.u, w.v))}<br>` : '') +
    (S.D.sst && !isNaN(sample(S.D.sst, lat, lng)) ? `Sea surface: ${fmtT(sample(S.D.sst, lat, lng))} (${dC(sample(S.D.sstA, lat, lng)) >= 0 ? '+' : ''}${dC(sample(S.D.sstA, lat, lng))}° vs. normal for the latitude)<br>` : '') +
    (pr == null ? '' : `Rain in the 6 h before: ${fmtRain(pr)}<br>`) + `500 mb: ${Math.round(f('h5'))} m high, wind ${Math.round(f('w5'))} kt<br>` +
    `<button class="usebtn" data-lat="${lat.toFixed(3)}" data-lon="${lng.toFixed(3)}">Use this as my place</button> ` +
    `<button class="pinbtn" data-topic="general" data-text="${esc(`At ${lat.toFixed(1)}, ${lng.toFixed(1)} (${shortTime()}): pressure ${fmtP(p)}, temperature ${fmtT(f('t'))}, dewpoint ${fmtT(f('d'))}` + (w ? `, wind from the ${compass(windFrom(w.u, w.v))} at ${fmtS(Math.hypot(w.u, w.v))}` : '') + '.')}">📌 Add to notes</button>`).openOn(map);
}
function systemPopup(e, pt) {
  let best = null;
  for (const s of frameInfo(S.cur).ex) { const p = map.latLngToContainerPoint([s.lat, s.lon]), d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < 24 && (!best || d < best.d)) best = { s, d }; }
  if (!best) return false;
  const { s } = best, tr = S.tracks.find(t => t.pts.some(p => p.i === S.cur && p.lat === s.lat && p.lon === s.lon)), mo = tr && motionOf(tr, S.cur);
  const name = s.t === 'H' ? 'High' : 'Low', dp = mo && mo.dp;
  const trend = !mo ? '' : s.t === 'L' ? (dp < -2 ? 'getting stronger (pressure falling)' : dp > 2 ? 'weakening (pressure rising)' : 'about the same strength')
    : (dp > 2 ? 'getting stronger (pressure rising)' : dp < -2 ? 'weakening (pressure falling)' : 'about the same strength');
  L.popup().setLatLng([s.lat, s.lon]).setContent(`<b>${name}: ${Math.round(s.v)} hPa</b><br>` + (mo
    ? `Moving toward the ${compass(mo.dir)} at ${fmtS(mo.kmh / 3.6)}<br>Change over ${mo.hrs} h: ${dp > 0 ? '+' : ''}${dp.toFixed(1)} hPa — ${trend}<br><small>Measured from its past positions (dotted trail).</small>`
    : '<small>This system is new in the last 48 h, so its motion can’t be measured yet.</small>') +
    `<br><button class="pinbtn" data-topic="hl" data-text="${esc(`${name} ${Math.round(s.v)} hPa near ${s.lat.toFixed(1)}, ${s.lon.toFixed(1)} (${shortTime()}): ` + (mo ? `moving toward the ${compass(mo.dir)} at ${fmtS(mo.kmh / 3.6)}, pressure change ${dp > 0 ? '+' : ''}${dp.toFixed(1)} hPa in ${mo.hrs} h — ${trend}.` : 'new in the last 48 h, motion not measurable yet.'))}">📌 Add to notes</button>`).openOn(map);
  return true;
}

export function initMap() {
  map = L.map('map', { center: [39.99, -99.77], zoom: 4, minZoom: 2, zoomControl: false, worldCopyJump: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  layer = new Cv().addTo(map); setBase('dark');
  $('base').onchange = e => setBase(e.target.value);
  map.on('click', e => {
    const pt = map.latLngToContainerPoint(e.latlng);
    if (hooks.click.some(fn => fn(e, pt))) return;
    if (systemPopup(e, pt)) return;
    probe(e);
  });
  map.on('popupopen', e => {
    const pb = e.popup.getElement().querySelector('.pinbtn');
    if (pb) pb.onclick = () => { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: pb.dataset.topic, text: pb.dataset.text } })); pb.textContent = '✓ Added to notes'; pb.disabled = true; };
    const b = e.popup.getElement().querySelector('.usebtn'); if (b) b.onclick = () => { map.closePopup(); document.dispatchEvent(new CustomEvent('usepoint', { detail: { lat: +b.dataset.lat, lon: +b.dataset.lon } })); }; });
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => map.setView(...JSON.parse(b.dataset.view)));
  document.querySelectorAll('#tab-explore input[type=checkbox], #shade').forEach(c => c.onchange = () => { legend(); layer.draw(); });
  $('slider').oninput = e => setFrame(+e.target.value);
  let timer = null;
  $('play').onclick = () => {
    if (timer) { clearInterval(timer); timer = null; $('play').textContent = '▶ Play the past 48 h'; return; }
    $('play').textContent = '❚❚ Pause'; if (S.cur >= S.nPast - 1) setFrame(0);
    timer = setInterval(() => { if (S.cur >= S.nPast - 1) { clearInterval(timer); timer = null; $('play').textContent = '▶ Play the past 48 h'; return; } setFrame(S.cur + 1); }, 800);
  };
  document.addEventListener('units', () => { if (S.D) { legend(); layer.draw(); } });
  legend();
  // borders: countries (Natural Earth) + US states
  const getJ = u => fetch(u).then(r => r.json()).then(j => j.features || []).catch(() => []);
  Promise.all([getJ('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson'),
    getJ('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json')]).then(a => { borders = a.flat(); layer.draw(); });
}

// ---- fronts: NOAA WPC charts, North America only. Only a chart dated today or earlier is used (never a Day 2/3 chart).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export async function loadFronts() {
  const today = new Date().toISOString().slice(0, 10), found = [];
  await Promise.all([2, 14, 26].map(id => fetch(`https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer/${id}/query?where=1%3D1&outFields=feat,popupconte&f=geojson`)
    .then(r => r.json()).then(gj => {
      gj.features = gj.features.filter(f => f.geometry);
      const m = (gj.features[0]?.properties.popupconte || '').match(/(\w{3}) (\d+) (\d{4})/); if (!m) return;
      const key = new Date(Date.UTC(+m[3], MON.indexOf(m[1]), +m[2])).toISOString().slice(0, 10);
      if (key <= today) found.push({ key, gj, date: `${m[1]} ${m[2]}` });
    }).catch(() => {})));
  found.sort((a, b) => a.key < b.key ? 1 : -1); fronts = found[0] || null;
  $('frnote').textContent = frontsNote(); layer && layer.draw(); document.dispatchEvent(new Event('cardrender'));   // the place card lists nearby fronts
}
