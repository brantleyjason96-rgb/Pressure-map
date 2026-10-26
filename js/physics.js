// Pure science used by the Local effects tab: terrain along a wind line, an air parcel crossing a mountain, and the daily
// temperature cycle. No DOM and no network, so each piece can be tested alone.

// ---- terrain along a line. z = elevations (m) in the direction the air flows (upwind end first); p = index of the place or null.
const smooth = z => z.map((_, i) => (z[Math.max(0, i - 1)] + z[i] + z[Math.min(z.length - 1, i + 1)]) / 3);
export function ridges(z, minProm = 300) { // local highs that stand at least minProm m above the lowest ground on the lower side
  const s = smooth(z), out = [];
  for (let i = 1; i < s.length - 1; i++) {
    if (!(s[i] >= s[i - 1] && s[i] > s[i + 1])) continue;
    const left = Math.min(...s.slice(0, i + 1)), right = Math.min(...s.slice(i)), prom = s[i] - Math.max(left, right);
    if (prom >= minProm) out.push({ i, z: z[i], prom });
  }
  return out;
}
// Where is the place relative to the nearest significant ridge in the wind's path?
export function classify(z, step, p) {
  const r = ridges(z), relief = Math.max(...z) - Math.min(...z);
  if (!r.length) return { kind: 'flat', relief, ridge: null };
  if (p == null) { const top = r.reduce((a, b) => b.z > a.z ? b : a); return { kind: 'line', relief, ridge: top }; }
  const near = r.reduce((a, b) => Math.abs(b.i - p) < Math.abs(a.i - p) ? b : a), d = (near.i - p) * step;   // d > 0: ridge is downwind
  const gain = near.z - z[p];
  let kind;
  if (Math.abs(d) <= 8 || gain < 150) kind = 'crest';
  else if (d > 0) kind = gain >= 250 && d <= 100 ? 'windward' : 'far';
  else kind = gain >= 250 && -d <= 150 ? 'leeward' : 'far';
  return { kind, relief, ridge: near, dKm: d, gain };
}

// ---- an air parcel crossing the main ridge. Temperatures in °C, heights in m, heights measured from sea level.
const DRY = 9.8, MOIST = 6, DEW = 1.8;   // °C per km: dry-adiabatic cooling, moist-adiabatic cooling, dewpoint change on sinking
export const rh = (t, td) => Math.min(100, 100 * Math.exp(17.625 * td / (243.04 + td)) / Math.exp(17.625 * t / (243.04 + t)));
export function parcel(z, step, T0, Td0) {
  const zs = z[0], c = z.reduce((b, v, i) => v > z[b] ? i : b, 0), zc = z[c], zl = zs + 125 * Math.max(0, T0 - Td0);
  const sat = zl < zc, iL = sat ? z.findIndex((v, i) => i <= c && v >= zl) : null;
  const Tl = T0 - DRY * (zl - zs) / 1000;
  const Tc = sat ? Tl - MOIST * (zc - zl) / 1000 : T0 - DRY * (zc - zs) / 1000, Tdc = sat ? Tc : Td0 - 2 * (zc - zs) / 1000;
  const ze = z.at(-1), Te = Tc + DRY * (zc - ze) / 1000, Tde = Tdc - DEW * (zc - ze) / 1000;
  return {
    sat, c, iL, zl, zc, ze, zs, step,
    start: { i: 0, z: zs, T: T0, Td: Td0, rh: rh(T0, Td0) },
    lcl: sat ? { i: iL, z: zl, T: Tl, Td: Tl } : null,
    crest: { i: c, z: zc, T: Tc, Td: Tdc, rh: rh(Tc, Tdc) },
    end: { i: z.length - 1, z: ze, T: Te, Td: Tde, rh: rh(Te, Tde) },
  };
}

// ---- the daily temperature cycle: T(h) = mean + a cos(wh) + b sin(wh), fitted to frames at local solar hours.
export function fitDiurnal(hours, temps) {
  const w = 2 * Math.PI / 24, n = hours.length, A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
  for (let k = 0; k < n; k++) { const x = [1, Math.cos(w * hours[k]), Math.sin(w * hours[k])]; for (let i = 0; i < 3; i++) { B[i] += x[i] * temps[k]; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; } }
  for (let c = 0; c < 3; c++) { // Gaussian elimination on the 3x3 normal equations
    let m = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]]; [B[c], B[m]] = [B[m], B[c]];
    if (Math.abs(A[c][c]) < 1e-9) return null;
    for (let r = c + 1; r < 3; r++) { const f = A[r][c] / A[c][c]; for (let j = c; j < 3; j++) A[r][j] -= f * A[c][j]; B[r] -= f * B[c]; }
  }
  const s = [0, 0, 0]; for (let i = 2; i >= 0; i--) s[i] = (B[i] - A[i].slice(i + 1).reduce((t, v, j) => t + v * s[i + 1 + j], 0)) / A[i][i];
  const amp = Math.hypot(s[1], s[2]), hmax = ((Math.atan2(s[2], s[1]) / w) % 24 + 24) % 24;
  return { mean: s[0], amp, hmax, at: h => s[0] + s[1] * Math.cos(w * h) + s[2] * Math.sin(w * h) };
}
export function crossings(f, sea) { // local hours (0-24) at which the fitted land temperature crosses the sea temperature
  const out = []; let prev = f(0) - sea;
  for (let h = .25; h <= 24; h += .25) { const v = f(h) - sea; if ((v > 0) !== (prev > 0)) out.push({ h: h - .125, up: v > 0 }); prev = v; }
  return out;
}
export const hourText = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60), H = mm === 60 ? hh + 1 : hh; return `${(H % 12) || 12}:${String(mm === 60 ? 0 : mm).padStart(2, '0')} ${H % 24 < 12 ? 'AM' : 'PM'}`; };
