// Loads the model data and does the math on it: sampling, contours, H/L detection and tracking.
// The public data file only ever holds the PAST (frames every 3 h up to "now"). Teacher mode appends forecast frames in memory.
// Time is continuous: S.t is an hour (0 = now, -24 = a day ago) and everything between two frames is blended, so the map glides.
// S.cur is the nearest whole frame, for the parts of the app that think in frames (place card, quiz, projection).
import { distKm, bearing } from './util.js';

export const S = { D: null, lats: [], lons: [], LAT0: 0, LON0: 0, d: 2, hours: [], nPast: 0, cur: 0, t: 0, cache: [], tracks: [], teacher: false };
export const fld = (k, i = S.cur) => S.D.f[k][i];
export const frameTime = i => timeAt(S.hours[i]);
export const timeAt = h => new Date(Date.parse(S.D.cycle) + h * 3600e3);
export const isForecast = i => i >= S.nPast;

export async function loadData() {
  const D = await (await fetch('data/pressure.json')).json();
  S.D = D; S.LAT0 = D.lat0; S.LON0 = D.lon0; S.d = D.d; S.hours = D.hours.slice(); S.nPast = S.hours.length; S.cur = S.nPast - 1; S.t = S.hours[S.cur];
  const g = D.f.p[0];
  S.lats = g.map((_, i) => S.LAT0 + i * S.d); S.lons = g[0].map((_, i) => S.LON0 + i * S.d);
  D.fr = D.fr || []; if (D.sst) D.sstA = anomaly(D.sst);
  fillRain(); buildTracks();
  return D;
}

// ---- continuous time
const wrap = x => ((x + 540) % 360) - 180;                                  // longitude back into -180..180
const lerpLon = (a, b, w) => wrap(a + wrap(b - a) * w);
export function bracket(t) { // the two frames either side of hour t, and how far (0..1) t is toward the later one
  const H = S.hours, n = H.length;
  if (t <= H[0]) return { a: 0, b: 0, w: 0 }; if (t >= H[n - 1]) return { a: n - 1, b: n - 1, w: 0 };
  let a = 0; while (a < n - 2 && H[a + 1] <= t) a++;
  return { a, b: a + 1, w: (t - H[a]) / (H[a + 1] - H[a]) };
}
export const nearestIdx = t => { let b = 0; S.hours.forEach((h, i) => { if (Math.abs(h - t) < Math.abs(S.hours[b] - t)) b = i; }); return b; };
const mix = (A, B, w) => A.map((row, i) => row.map((v, j) => v == null || B[i][j] == null ? v : v + (B[i][j] - v) * w));
const bl = new Map(), cc = new Map(), keep = (m, k, v, max) => { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; };
export const resetCaches = () => { bl.clear(); cc.clear(); };
export function fldT(k, t = S.t) { // a field at any hour: the two surrounding frames blended
  const { a, b, w } = bracket(t), A = S.D.f[k][a], B = S.D.f[k][b];
  if (!w || !A || !B) return A || B;
  const key = `${k}@${a}:${w.toFixed(3)}`; return bl.get(key) || keep(bl, key, mix(A, B, w), 40);
}
export const changeGrid = (k, t = S.t, back = 24) => { // how much a field changed over the last `back` hours (the earlier map is the oldest one if there is less history)
  const t0 = Math.max(S.hours[0], t - back), key = `chg:${k}@${t.toFixed(2)}:${t0.toFixed(2)}`;
  return bl.get(key) || keep(bl, key, fldT(k, t).map((row, i) => { const o = fldT(k, t0)[i]; return row.map((v, j) => v - o[j]); }), 40);
};
function fillRain() { // the 6-h rain total only exists at the 6-hourly cycles; in between, average the frames either side
  const P = S.D.f.pr;
  P.forEach((g, i) => { if (g || !P[i - 1] || !P[i + 1]) return; P[i] = P[i - 1].map((row, y) => row.map((v, x) => Math.round((v + P[i + 1][y][x]) * 5) / 10)); });
}

// sea temperature minus the ocean average at that latitude: warm and cold currents stand out as warm and cold bands
function anomaly(g) {
  return g.map(row => { const ok = row.filter(v => v != null), m = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0; return row.map(v => v == null ? null : Math.round((v - m) * 10) / 10); });
}
// how fast the 2 m temperature changes with distance (°C per 100 km). Fronts sit along bands of strong contrast.
export const gradientAt = (t = S.t) => { const { a, b, w } = bracket(t), A = gradientGrid(a); return w ? mix(A, gradientGrid(b), w) : A; };
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
  S.D.fr.push(...(T.fr || T.hours.map(() => []))); S.hours.push(...T.hours); S.teacher = true; S.cache = []; resetCaches(); fillRain(); buildTracks();
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
export function windAt(lat, lon, t = S.t) { // real model 10 m wind (m/s), not estimated
  const u = sample(fldT('u', t), lat, lon), v = sample(fldT('v', t), lat, lon);
  return isNaN(u) ? null : { u, v };
}

export function contourAt(k, levels, t = S.t, R = 1) { // isobars at any hour (cached); R = 2 is a coarser, quicker version used while the map is moving
  const { a, w } = bracket(t), key = `${k}@${a}:${w.toFixed(2)}:${R}`;
  return cc.get(key) || keep(cc, key, contour(fldT(k, t), levels, R), 24);
}
function resample(f, R) { // the grid cubic-smoothed onto points R degrees apart: one pass along each row, then one down each column
  const nl = S.lats.length, nn = S.lons.length, ny = Math.round((nl - 1) * S.d / R), nx = Math.round((nn - 1) * S.d / R), cl = (v, n) => Math.max(0, Math.min(n - 1, v));
  const at = (o, n) => { const x = o * R / S.d, i = Math.min(Math.floor(x), n - 2); return [i, x - i]; };
  const tmp = f.map(row => Array.from({ length: nx + 1 }, (_, b) => { const [j, fx] = at(b, nn); return fx ? cr(row[cl(j - 1, nn)], row[j], row[j + 1], row[cl(j + 2, nn)], fx) : row[j]; }));
  return Array.from({ length: ny + 1 }, (_, a) => { const [i, fy] = at(a, nl), r0 = tmp[cl(i - 1, nl)], r1 = tmp[i], r2 = tmp[i + 1], r3 = tmp[cl(i + 2, nl)]; return fy ? r1.map((_, b) => cr(r0[b], r1[b], r2[b], r3[b], fy)) : r1; });
}
export function contour(f, levels, R = 1) { // marching squares on a resampling of the cubic surface (R degrees apart). `levels` must be evenly spaced.
  const F = resample(f, R), ny = F.length - 1, nx = F[0].length - 1, segs = {}; levels.forEach(L => segs[L] = []);
  const L0 = levels[0], step = levels.length > 1 ? levels[1] - L0 : 1, last = levels.length - 1;
  const pt = [[0, 1], [1, 2], [2, 3], [3, 0]], cx = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let a = 0; a < ny; a++) {
    const r0 = F[a], r1 = F[a + 1];
    for (let b = 0; b < nx; b++) {
      const v0 = r0[b], v1 = r0[b + 1], v2 = r1[b + 1], v3 = r1[b], lo = Math.min(v0, v1, v2, v3), hi = Math.max(v0, v1, v2, v3);
      for (let k = Math.max(0, Math.ceil((lo - L0) / step)), k1 = Math.min(last, Math.floor((hi - L0) / step)); k <= k1; k++) {   // only the levels this cell can cross
        const L = levels[k], v = [v0, v1, v2, v3], c = [];
        pt.forEach(([i, j]) => { if ((v[i] - L) * (v[j] - L) < 0) { const t = (L - v[i]) / (v[j] - v[i]);
          c.push([S.LAT0 + (a + cx[i][1] + (cx[j][1] - cx[i][1]) * t) * R, S.LON0 + (b + cx[i][0] + (cx[j][0] - cx[i][0]) * t) * R]); } });
        if (c.length === 2) segs[L].push([...c[0], ...c[1]]);
        else if (c.length === 4) segs[L].push([...c[0], ...c[3]], [...c[1], ...c[2]]);
      }
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

// Link each H/L to the nearest same-type system in the frame before (or the one before that, if it dipped under the H/L cutoff for a
// frame) -> tracks. Used for "how fast and which way is it moving?" and to glide the markers between frames.
const MAX_KMH = 135;
function buildTracks() {
  const n = S.hours.length; S.tracks = [];
  let open = [];
  for (let i = 0; i < n; i++) {
    const ex = frameInfo(i).ex, pairs = [];
    ex.forEach((e, ei) => open.forEach((tr, ti) => { const L = tr.pts.at(-1); if (tr.t === e.t && i - L.i <= 2) { const d = distKm(L.lat, L.lon, e.lat, e.lon); if (d < MAX_KMH * (S.hours[i] - S.hours[L.i])) pairs.push([d, ei, ti]); } }));
    pairs.sort((a, b) => a[0] - b[0]);
    const usedE = new Set(), usedT = new Set();
    for (const [, ei, ti] of pairs) if (!usedE.has(ei) && !usedT.has(ti)) { usedE.add(ei); usedT.add(ti); open[ti].pts.push({ i, ...ex[ei] }); }
    ex.forEach((e, ei) => { if (!usedE.has(ei)) { const tr = { t: e.t, pts: [{ i, ...e }] }; S.tracks.push(tr); open.push(tr); } });
    open = open.filter(tr => i - tr.pts.at(-1).i < 2);
  }
}
// Motion of a system as of frame i, from up to the last 24 h of its track (only frames <= i, so never the future for students)
export function motionOf(track, i) {
  const all = track.pts.filter(p => p.i <= i); if (!all.length) return null;
  const b = all.at(-1), pts = all.filter(p => S.hours[p.i] >= S.hours[b.i] - 24);
  if (pts.length < 2) return null;
  const a = pts[0], hrs = S.hours[b.i] - S.hours[a.i], km = distKm(a.lat, a.lon, b.lat, b.lon);
  return { kmh: km / hrs, dir: bearing(a.lat, a.lon, b.lat, b.lon), hrs, dp: b.v - a.v };
}
// Every High and Low alive at hour t, at its blended position. `a` is how visible it is (0..1): one that starts or stops being a
// High/Low fades in or out over one frame instead of popping.
export function systemsAt(t = S.t) {
  const H = S.hours, n = H.length, out = [];
  for (const track of S.tracks) {
    const P = track.pts, f = P[0], l = P.at(-1), t0 = f.i ? H[f.i - 1] : H[0], t1 = l.i < n - 1 ? H[l.i + 1] : H[n - 1];
    if (t < t0 || t > t1) continue;
    let e = f, a = 1;
    if (t <= H[f.i]) a = f.i ? (t - t0) / (H[f.i] - t0) : 1;
    else if (t >= H[l.i]) { e = l; a = l.i < n - 1 ? (t1 - t) / (t1 - H[l.i]) : 1; }
    else { const k = P.findIndex((p, j) => H[p.i] <= t && t < H[P[j + 1].i]), p = P[k], q = P[k + 1], w = (t - H[p.i]) / (H[q.i] - H[p.i]); e = { lat: p.lat + (q.lat - p.lat) * w, lon: lerpLon(p.lon, q.lon, w), v: p.v + (q.v - p.v) * w }; }
    out.push({ t: track.t, lat: e.lat, lon: e.lon, v: e.v, a, track });
  }
  return out;
}
// Computer-found fronts at hour t. A front with the same id in both frames is moved along (its points blended); one that appears or
// ends fades over one frame. Each is { id, t: type, p: [[lat, lon], ...], a: visibility 0..1 }.
export function frontsAt(t = S.t) {
  const { a, b, w } = bracket(t), A = S.D.fr[a] || [], B = S.D.fr[b] || [];
  if (!w) return A.map(f => ({ id: f.id, t: f.t, p: f.p, a: 1 }));
  const byId = new Map(B.filter(f => f.id != null).map(f => [f.id, f])), used = new Set(), out = [];
  for (const f of A) {
    const m = f.id != null && byId.get(f.id);
    if (m && m.p.length === f.p.length) { used.add(m); out.push({ id: f.id, t: f.t, p: f.p.map(([la, lo], k) => [la + (m.p[k][0] - la) * w, lerpLon(lo, m.p[k][1], w)]), a: 1 }); }
    else out.push({ id: f.id, t: f.t, p: f.p, a: 1 - w });
  }
  for (const f of B) if (!used.has(f)) out.push({ id: f.id, t: f.t, p: f.p, a: w });
  return out;
}
export function nearestSystem(lat, lon, type, i = S.cur) { // closest H or L at frame i, with the track it belongs to
  let best = null;
  for (const e of frameInfo(i).ex) if (!type || e.t === type) { const d = distKm(lat, lon, e.lat, e.lon); if (!best || d < best.d) best = { e, d }; }
  if (!best) return null;
  const track = S.tracks.find(tr => tr.pts.some(p => p.i === i && p.lat === best.e.lat && p.lon === best.e.lon));
  return { ...best, track, motion: track && motionOf(track, i), brg: bearing(lat, lon, best.e.lat, best.e.lon) };
}

// ---- measuring the past motion of a High, Low or front (student helpers: all of it is from frames at or before "now")
const K = Math.PI / 180;
export function trackPos(track, h) { // where an H/L was at hour h (blended between frames), or null if it did not exist then
  const P = track.pts, H = S.hours;
  for (let j = 0; j < P.length; j++) {
    if (H[P[j].i] === h) return P[j];
    if (j < P.length - 1 && H[P[j].i] < h && h < H[P[j + 1].i]) { const p = P[j], q = P[j + 1], w = (h - H[p.i]) / (H[q.i] - H[p.i]); return { lat: p.lat + (q.lat - p.lat) * w, lon: lerpLon(p.lon, q.lon, w), v: p.v + (q.v - p.v) * w }; }
  }
  return null;
}
export function trackTrend(track, i) { // km/h over the last 12 h compared with the 12 h before that (null if the system is too new)
  const h = S.hours[i], P = [-24, -12, 0].map(d => trackPos(track, h + d)); if (P.some(x => !x)) return null;
  const sp = (a, b) => distKm(a.lat, a.lon, b.lat, b.lon) / 12; return { before: sp(P[0], P[1]), after: sp(P[1], P[2]) };
}
export function frontMotion(id, i, span = 24) { // how fast a computer-found front moved ACROSS itself (toward the side its symbols are on), from its own past positions
  const tr = []; for (let k = 0; k <= i; k++) { const f = (S.D.fr[k] || []).find(x => x.id === id); if (f) tr.push({ i: k, p: f.p }); }
  if (tr.length < 2) return null;
  const b = tr.at(-1), a = tr.find(x => S.hours[x.i] >= S.hours[b.i] - span); if (a === b || a.p.length !== b.p.length) return null;
  const hrs = S.hours[b.i] - S.hours[a.i]; let sn = 0, nx = 0, ny = 0;
  b.p.forEach(([la, lo], k) => {
    const p0 = b.p[Math.max(0, k - 1)], p1 = b.p[Math.min(b.p.length - 1, k + 1)], c = Math.cos(la * K);
    const tx = wrap(p1[1] - p0[1]) * 111 * c, ty = (p1[0] - p0[0]) * 111, L = Math.hypot(tx, ty) || 1, lx = -ty / L, ly = tx / L;   // left of the way the line runs = the symbol side
    sn += wrap(lo - a.p[k][1]) * 111 * c * lx + (la - a.p[k][0]) * 111 * ly; nx += lx; ny += ly;
  });
  const dist = sn / b.p.length, brg = (Math.atan2(nx, ny) / K + 360) % 360;
  return { kmh: Math.abs(dist) / hrs, dir: dist >= 0 ? brg : (brg + 180) % 360, hrs, dp: 0 };
}
export function frontTrend(id, i) {
  const a = frontMotion(id, i, 12), b = frontMotion(id, nearestIdx(S.hours[i] - 12), 12); return a && b ? { before: b.kmh, after: a.kmh } : null;
}
export function steerAt(lat, lon, i = S.nPast - 1) { // the 500 mb (about 18,000 ft) flow: direction from the height lines (wind runs along them), speed from the model
  const z = S.D.f.h5[i], d = 2, dz = (la, lo) => sample(z, la, lo), s = lat >= 0 ? 1 : -1;
  const gy = (dz(lat + d, lon) - dz(lat - d, lon)) / (222 * d), gx = (dz(lat, lon + d) - dz(lat, lon - d)) / (222 * d * Math.max(.2, Math.cos(lat * K)));
  const u = -s * gy, v = s * gx, kt = sample(S.D.f.w5[i], lat, lon);
  return isFinite(u + v + kt) && Math.hypot(u, v) > 1e-6 ? { dir: (Math.atan2(u, v) / K + 360) % 360, ms: kt / 1.944 } : null;
}
