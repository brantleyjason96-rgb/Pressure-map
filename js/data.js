// Loads the model data and does the math on it: sampling, contours, H/L detection and tracking.
// The public data file only ever holds the PAST (analyses up to "now"). Teacher mode appends forecast frames in memory.
import { distKm, bearing } from './util.js';

export const S = { D: null, lats: [], lons: [], LAT0: 0, LON0: 0, d: 2, hours: [], nPast: 0, cur: 0, cache: [], tracks: [], teacher: false };
export const fld = (k, i = S.cur) => S.D.f[k][i];
export const frameTime = i => new Date(Date.parse(S.D.cycle) + S.hours[i] * 3600e3);
export const isForecast = i => i >= S.nPast;

export async function loadData() {
  const D = await (await fetch('data/pressure.json')).json();
  S.D = D; S.LAT0 = D.lat0; S.LON0 = D.lon0; S.d = D.d; S.hours = D.hours.slice(); S.nPast = S.hours.length; S.cur = S.nPast - 1;
  const g = D.f.p[0];
  S.lats = g.map((_, i) => S.LAT0 + i * S.d); S.lons = g[0].map((_, i) => S.LON0 + i * S.d);
  D.fr = D.fr || []; if (D.sst) D.sstA = anomaly(D.sst);
  buildTracks();
  return D;
}

// sea temperature minus the ocean average at that latitude: warm and cold currents stand out as warm and cold bands
function anomaly(g) {
  return g.map(row => { const ok = row.filter(v => v != null), m = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0; return row.map(v => v == null ? null : Math.round((v - m) * 10) / 10); });
}
// how fast the 2 m temperature changes with distance (°C per 100 km). Fronts sit along bands of strong contrast.
export function gradientGrid(i) {
  const c = frameInfo(i); if (c.tg) return c.tg;
  const T = S.D.f.t[i], nl = S.lats.length, nn = S.lons.length, dy = S.d * 111;
  return c.tg = T.map((row, a) => row.map((_, b) => {
    const a0 = Math.max(0, a - 1), a1 = Math.min(nl - 1, a + 1), b0 = (b - 1 + nn - 1) % (nn - 1), b1 = (b + 1) % (nn - 1);   // the last column repeats the first
    const dx = S.d * 111 * Math.max(.2, Math.cos(S.lats[a] * Math.PI / 180)), gx = (T[a][b1] - T[a][b0]) / (2 * dx), gy = (T[a1][b] - T[a0][b]) / ((a1 - a0) * dy);
    return Math.round(Math.hypot(gx, gy) * 1000) / 10;
  }));
}

// Teacher mode: append the decrypted forecast frames (same grid). Never persisted.
export function addForecast(T) {
  for (const k of Object.keys(S.D.f)) S.D.f[k].push(...T.f[k]);
  S.D.fr.push(...(T.fr || T.hours.map(() => []))); S.hours.push(...T.hours); S.teacher = true; S.cache = []; buildTracks();
}

export function sample(f, lat, lon) { // bilinear; NaN outside the grid
  const y = (lat - S.LAT0) / S.d, x = (lon - S.LON0) / S.d;
  if (y < 0 || x < 0 || y > S.lats.length - 1 || x > S.lons.length - 1) return NaN;
  const i = Math.min(Math.floor(y), S.lats.length - 2), j = Math.min(Math.floor(x), S.lons.length - 2), fy = y - i, fx = x - j;
  const a = f[i][j], b = f[i][j + 1], c = f[i + 1][j], d = f[i + 1][j + 1];
  if (a == null || b == null || c == null || d == null) return NaN;     // sea-temperature grids have gaps over land
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
const cr = (p0, p1, p2, p3, t) => p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
export function cubic(f, lat, lon) { // Catmull-Rom: smooth enough for contours
  const y = (lat - S.LAT0) / S.d, x = (lon - S.LON0) / S.d, i = Math.floor(y), j = Math.floor(x), fy = y - i, fx = x - j;
  const G = (a, b) => f[Math.max(0, Math.min(S.lats.length - 1, a))][Math.max(0, Math.min(S.lons.length - 1, b))];
  const row = a => cr(G(a, j - 1), G(a, j), G(a, j + 1), G(a, j + 2), fx);
  return cr(row(i - 1), row(i), row(i + 1), row(i + 2), fy);
}
export function windAt(lat, lon, i = S.cur) { // real model 10 m wind (m/s), not estimated
  const u = sample(S.D.f.u[i], lat, lon), v = sample(S.D.f.v[i], lat, lon);
  return isNaN(u) ? null : { u, v };
}

export function contour(f, levels) { // marching squares on a 1° resampling of the cubic surface
  const R = 1, LAT1 = S.lats.at(-1), LON1 = S.lons.at(-1), ny = Math.round((LAT1 - S.LAT0) / R), nx = Math.round((LON1 - S.LON0) / R), F = [];
  for (let a = 0; a <= ny; a++) { F.push([]); for (let b = 0; b <= nx; b++) F[a].push(cubic(f, Math.min(LAT1 - 1e-6, S.LAT0 + a * R), Math.min(LON1 - 1e-6, S.LON0 + b * R))); }
  const segs = {}; levels.forEach(L => segs[L] = []);
  const pt = [[0, 1], [1, 2], [2, 3], [3, 0]], cx = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
    const v = [F[a][b], F[a][b + 1], F[a + 1][b + 1], F[a + 1][b]], lo = Math.min(...v), hi = Math.max(...v);
    for (const L of levels) {
      if (L < lo || L > hi) continue; const c = [];
      pt.forEach(([i, j]) => { if ((v[i] - L) * (v[j] - L) < 0) { const t = (L - v[i]) / (v[j] - v[i]);
        c.push([S.LAT0 + (a + cx[i][1] + (cx[j][1] - cx[i][1]) * t) * R, S.LON0 + (b + cx[i][0] + (cx[j][0] - cx[i][0]) * t) * R]); } });
      if (c.length === 2) segs[L].push([...c[0], ...c[1]]);
      else if (c.length === 4) segs[L].push([...c[0], ...c[3]], [...c[1], ...c[2]]);
    }
  }
  return segs;
}

// local max/min of pressure within ~10°. Highs/Lows must be meaningfully off average and outside the tropics.
function extrema(f) {
  const R = Math.round(10 / S.d), E = 3, out = [], nl = S.lats.length, nn = S.lons.length;
  for (let i = E; i < nl - E; i++) for (let j = E; j < nn - E; j++) {
    if (Math.abs(S.lats[i]) < 15) continue;
    const v = f[i][j]; let hi = v > 1016, lo = v < 1010;
    if (!hi && !lo) continue;
    for (let a = Math.max(-R, -i); a <= Math.min(R, nl - 1 - i) && (hi || lo); a++) for (let b = Math.max(-R, -j); b <= Math.min(R, nn - 1 - j); b++) {
      if (!a && !b) continue; const n = f[i + a][j + b];
      const tie = n === v && (a < 0 || (a === 0 && b < 0));
      if (n > v || tie) hi = false; if (n < v || tie) lo = false;
    }
    if (hi || lo) out.push({ lat: S.lats[i], lon: S.lons[j], v, t: hi ? 'H' : 'L' });
  }
  return out;
}
export function frameInfo(i) {
  if (!S.cache[i]) S.cache[i] = {};
  const c = S.cache[i];
  if (!c.ex) c.ex = extrema(S.D.f.p[i]);
  return c;
}

// Link each H/L to the nearest same-type system 6 h earlier -> tracks. Used for "how fast and which way is it moving?"
function buildTracks() {
  const n = S.hours.length, MAX = 800; S.tracks = [];
  let open = [];
  for (let i = 0; i < n; i++) {
    const ex = frameInfo(i).ex, pairs = [];
    ex.forEach((e, ei) => open.forEach((tr, ti) => { if (tr.t === e.t) { const L = tr.pts.at(-1), d = distKm(L.lat, L.lon, e.lat, e.lon); if (d < MAX) pairs.push([d, ei, ti]); } }));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedE = new Set(), usedT = new Set(), next = [];
    for (const [, ei, ti] of pairs) if (!usedE.has(ei) && !usedT.has(ti)) { usedE.add(ei); usedT.add(ti); open[ti].pts.push({ i, ...ex[ei] }); next.push(open[ti]); }
    ex.forEach((e, ei) => { if (!usedE.has(ei)) { const tr = { t: e.t, pts: [{ i, ...e }] }; S.tracks.push(tr); next.push(tr); } });
    open = next;
  }
}
// Motion of a system as of frame i, from up to the last 24 h of its track (only frames <= i, so never the future for students)
export function motionOf(track, i) {
  const pts = track.pts.filter(p => p.i <= i).slice(-5);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts.at(-1), hrs = S.hours[b.i] - S.hours[a.i], km = distKm(a.lat, a.lon, b.lat, b.lon);
  return { kmh: km / hrs, dir: bearing(a.lat, a.lon, b.lat, b.lon), hrs, dp: b.v - a.v };
}
export function nearestSystem(lat, lon, type, i = S.cur) { // closest H or L at frame i, with the track it belongs to
  let best = null;
  for (const e of frameInfo(i).ex) if (!type || e.t === type) { const d = distKm(lat, lon, e.lat, e.lon); if (!best || d < best.d) best = { e, d }; }
  if (!best) return null;
  const track = S.tracks.find(tr => tr.pts.some(p => p.i === i && p.lat === best.e.lat && p.lon === best.e.lon));
  return { ...best, track, motion: track && motionOf(track, i), brg: bearing(lat, lon, best.e.lat, best.e.lon) };
}
