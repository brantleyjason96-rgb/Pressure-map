// Local effects: land and sea breeze. Finds the nearest water, then shows how the land-versus-water temperature difference
// over a day turns the breeze on and off. Uses the place's temperatures over the PAST 48 hours to show its daily cycle.
import { $, esc, fmtT, fmtS, fmtD, compass, tempOut, tempIn, tUnit } from './util.js';
import { S, sample } from './data.js';
import { P, pastSeries } from './place.js';
import { view, redraw } from './mapview.js';
import { Mask, coastInfo, destination } from './geo.js';
import { fitDiurnal, crossings, hourText } from './physics.js';

const NE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/';
let land, lakes, loading;
const C = { info: null, fit: null, sea: null, seaModel: null, wind: null, range: null, hour: 14, timer: null };

async function masks() {
  if (land) return;
  loading ||= Promise.all(['ne_50m_land', 'ne_50m_lakes'].map(n => fetch(`${NE}${n}.geojson`).then(r => r.json()).then(j => j.features || []))).then(([l, k]) => { land = new Mask(l); lakes = new Mask(k, 40); });
  await loading;
}
const localHours = ser => ser.hours.map(h => (((Date.parse(S.D.cycle) / 3600e3 + h) % 24) + P.place.lon / 15 + 48) % 24);   // local solar time of each frame

async function compute() {
  const pl = P.place, ser = pastSeries(pl), n = S.nPast - 1;
  C.wind = { spd: ser.spd[n], mean: ser.spd.reduce((a, b) => a + b, 0) / ser.spd.length };
  C.fit = fitDiurnal(localHours(ser), ser.t); C.range = C.fit ? 2 * C.fit.amp : null;
  C.info = coastInfo(pl.lat, pl.lon, land, lakes);
  if (C.info.seaward != null) {
    const out = destination(pl.lat, pl.lon, C.info.seaward, Math.max(C.info.km + 80, 120));
    C.seaModel = S.D.f.t.slice(0, S.nPast).reduce((a, g) => a + sample(g, out.lat, out.lon), 0) / S.nPast; C.sea = C.seaModel;
  }
}

// ---- pictures
function labSVG() {
  const { info, fit } = C, h = C.hour, W = 360, H = 200, landT = fit.at(h), diff = landT - C.sea, kind = diff > 1 ? 'sea' : diff < -1 ? 'land' : 'none';
  const water = info.type === 'lake' ? 'lake' : 'sea', fromSea = compass(info.seaward), fromLand = compass(info.seaward + 180);
  const day = h >= 6 && h < 18, f = (h - 6) / 12, sx = 40 + f * 280, sy = 62 - Math.sin(Math.PI * f) * 38, nf = ((h + 6) % 24) / 12, mx = 40 + nf * 280, my = 62 - Math.sin(Math.PI * nf) * 38;
  const warmX = kind === 'sea' ? 270 : 90, coolX = kind === 'sea' ? 90 : 270;
  let g = `<rect width="${W}" height="${H}" fill="${day ? '#a9d4f5' : '#0e1830'}"/>`;
  g += day ? `<circle cx="${sx}" cy="${sy}" r="14" fill="#ffd23f"/>` : `<circle cx="${mx}" cy="${my}" r="11" fill="#e8ecf5"/><circle cx="${mx + 5}" cy="${my - 3}" r="10" fill="#0e1830"/>`;
  g += `<rect x="0" y="130" width="170" height="70" fill="#2c6fb5"/><rect x="170" y="130" width="190" height="70" fill="#8a7a55"/><path d="M0 130 Q 21 124 42 130 T 85 130 T 127 130 T 170 130" fill="none" stroke="#bfe0ff" stroke-width="2"/>`;
  g += `<text x="85" y="170" text-anchor="middle" class="lb">${water === 'lake' ? 'LAKE' : 'SEA'} ${esc(fmtT(C.sea))}</text><text x="265" y="170" text-anchor="middle" class="lb">LAND ${esc(fmtT(landT))}</text>`;
  if (kind !== 'none') {
    g += `<text x="${warmX}" y="104" text-anchor="middle" font-size="22" fill="#e0472b">↑</text><text x="${warmX}" y="118" text-anchor="middle" class="lb2">warm air rises · L</text>`;
    g += `<text x="${coolX}" y="104" text-anchor="middle" font-size="22" fill="#1f6fbf">↓</text><text x="${coolX}" y="118" text-anchor="middle" class="lb2">cool air sinks · H</text>`;
    const r = kind === 'sea' ? '→' : '←';
    g += `<text x="180" y="150" text-anchor="middle" font-size="30" fill="#fff" stroke="#000" stroke-width=".6">${r}${r}</text><text x="180" y="52" text-anchor="middle" font-size="30" fill="#fff" opacity=".85" stroke="#000" stroke-width=".6">${kind === 'sea' ? '←' : '→'}</text>`;
    g += `<text x="180" y="20" text-anchor="middle" class="lt">${kind === 'sea' ? (water === 'lake' ? 'LAKE' : 'SEA') + ' BREEZE: wind from the ' + fromSea : 'LAND BREEZE: wind from the ' + fromLand}</text>`;
    g += `<text x="180" y="190" text-anchor="middle" class="lb2">(surface wind near the ground; opposite flow above)</text>`;
  } else g += `<text x="180" y="20" text-anchor="middle" class="lt">No local breeze: land and water about the same temperature</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="xsec">${g}</svg>`;
}
function chartSVG() {
  const { fit } = C, W = 360, H = 120, L = 8, B = 22, Tp = 8, sea = C.sea, hs = Array.from({ length: 97 }, (_, i) => i / 4), vs = hs.map(fit.at);
  const lo = Math.min(sea, ...vs) - 1, hi = Math.max(sea, ...vs) + 1, X = h => L + h / 24 * (W - 2 * L), Y = v => H - B - (v - lo) / (hi - lo) * (H - B - Tp);
  const line = hs.map((h, i) => `${X(h)},${Y(vs[i])}`).join(' '), cx = crossings(fit.at, sea);
  let band = ''; // shade where the land is warmer than the water
  { let run = null; hs.forEach((h, i) => { const up = vs[i] > sea; if (up && run == null) run = h; if ((!up || i === hs.length - 1) && run != null) { band += `<rect x="${X(run)}" y="${Tp}" width="${X(h) - X(run)}" height="${H - B - Tp}" fill="#ff9a3c" opacity=".22"/>`; run = null; } }); }
  let g = `<rect width="${W}" height="${H}" fill="#0c1118"/>${band}<line x1="${L}" x2="${W - L}" y1="${Y(sea)}" y2="${Y(sea)}" stroke="#4aa3ff" stroke-dasharray="5 4" stroke-width="2"/><text x="${W - L}" y="${Y(sea) - 4}" text-anchor="end" class="cw">${C.info.type === 'lake' ? 'lake' : 'sea'} ${esc(fmtT(sea))}</text>`;
  g += `<polyline points="${line}" fill="none" stroke="#ff7b54" stroke-width="2.5"/><text x="${L + 4}" y="${Y(vs[0]) < 24 ? Y(vs[0]) + 14 : Y(vs[0]) - 6}" class="cl">land</text>`;
  [0, 6, 12, 18, 24].forEach(h => g += `<text x="${X(h)}" y="${H - 6}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}" class="ct">${['12 AM', '6 AM', 'noon', '6 PM', '12 AM'][h / 6]}</text><line x1="${X(h)}" x2="${X(h)}" y1="${H - B}" y2="${H - B + 3}" stroke="#889"/>`);
  g += `<line x1="${X(C.hour)}" x2="${X(C.hour)}" y1="${Tp}" y2="${H - B}" stroke="#ffd23f" stroke-width="2"/><circle cx="${X(C.hour)}" cy="${Y(fit.at(C.hour))}" r="5" fill="#ffd23f"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="xsec">${g}</svg>`;
}

// ---- text
function verdict() {
  const { info, wind, range } = C, d = info.km, w = wind.spd;
  const near = d <= 50 ? ['ok', 'Close enough'] : d <= 100 ? ['mid', 'Borderline'] : ['no', 'Too far'];
  const calm = w < 5 ? ['ok', 'Weak enough'] : w < 8 ? ['mid', 'Borderline'] : ['no', 'Too strong'];
  const heat = range >= 6 ? ['ok', 'Big swing'] : range >= 3 ? ['mid', 'Moderate'] : ['no', 'Small swing'];
  return [
    [near, `Near the water`, `You are ${fmtD(d)} from the ${info.type === 'lake' ? 'lake' : 'sea'}. Breezes usually reach only about 20–50 km (12–30 mi) inland.`],
    [calm, `Weak background wind`, `The model wind at your place right now is ${fmtS(w)} (about ${fmtS(wind.mean)} on average over 48 h). Strong winds from a large pressure pattern overpower a local breeze.`],
    [heat, `Strong daytime heating`, `Your place’s temperature swings about ${tempSwing(range)} between night and afternoon. The bigger the swing, the more the land outheats the water.`],
  ];
}
const tempSwing = r => Math.round(tempOut(r) - tempOut(0)) + tUnit();   // a difference, so no +32 offset
const ICON = { ok: '✅', mid: '🟡', no: '❌' };
function render() {
  const { info, fit } = C, pl = P.place;
  const water = info.type === 'lake' ? 'lake' : 'sea', cx = crossings(fit.at, C.sea), up = cx.find(c => c.up), dn = cx.find(c => !c.up);
  $('cfacts').innerHTML = `<div class="kv"><span>Nearest water</span><b>${water === 'lake' ? 'a big lake' : 'the sea'}, ${esc(fmtD(info.km))} away</b><span>Direction to the water</span><b>${compass(info.seaward)} (${Math.round(info.seaward)}°)</b>
    <span>A ${water} breeze blows</span><b>from the ${compass(info.seaward)}, toward land</b><span>A land breeze blows</span><b>from the ${compass(info.seaward + 180)}, toward the ${water}</b></div>`;
  $('csvg').innerHTML = labSVG(); $('cchart').innerHTML = chartSVG();
  $('chtxt').textContent = hourText(C.hour); $('cwater').value = Math.round(tempOut(C.sea)); $('cwu').textContent = tUnit();
  const when = cx.length ? `From the last 48 h, the land is warmer than the ${water} ${up && dn ? `from about <b>${hourText(up.h)}</b> to about <b>${hourText(dn.h)}</b>` : up ? `starting about <b>${hourText(up.h)}</b>` : dn ? `until about <b>${hourText(dn.h)}</b>` : ''} (local solar time). A real breeze usually starts 1–3 hours after the switch.`
    : (fit.mean > C.sea ? `The land stays warmer than the ${water} all day, so there is no switch.` : `The land stays cooler than the ${water} all day, so there is no switch.`);
  $('ctext').innerHTML = when + ` <span class="muted small">Daily peak at about ${hourText(fit.hmax)}.</span>`;
  const vv = verdict(); $('cchk').innerHTML = vv.map(([[k, w], t, d]) => `<li><span>${ICON[k]}</span><div><b>${t}: ${w}</b><br><small class="muted">${d}</small></div></li>`).join('');
  const all = vv.every(v => v[0][0] === 'ok'), any = vv.some(v => v[0][0] === 'no');
  $('cverdict').textContent = all ? 'Conditions look good for a breeze.' : any ? 'A breeze is unlikely or weak under today’s conditions.' : 'A breeze is possible but may be weak.';
  const note = `${pl.name}: ${water} is ${fmtD(info.km)} to the ${compass(info.seaward)}. A ${water} breeze would blow from the ${compass(info.seaward)}; a land breeze from the ${compass(info.seaward + 180)}. ${when.replace(/<[^>]+>/g, '')} Breeze checks: near water ${vv[0][0][1].toLowerCase()}; background wind ${vv[1][0][1].toLowerCase()} (${fmtS(C.wind.spd)}); daily temperature swing ${vv[2][0][1].toLowerCase()}.`;
  $('cpin').dataset.text = note; $('cpin').disabled = false; $('cpin').textContent = '📌 Add to notes';
  view.coast = { place: pl, coast: info.coast, seaward: info.seaward }; redraw();
}
async function refresh() {
  const ok = !!(P.place && S.D); $('cbody').hidden = !ok; if (!ok) { view.coast = null; redraw(); return; }
  $('cmsg').textContent = 'Finding the nearest coast…'; $('cmsg').hidden = false; $('clab').hidden = true; $('cfacts').innerHTML = '';
  try { await masks(); await compute(); } catch { $('cmsg').textContent = 'Coastline lookup needs an internet connection. Try again in a moment.'; return; }
  if (C.info.onWater) { $('cmsg').textContent = 'This place is over water. Pick a place on land to study land and sea breezes.'; return; }
  if (C.info.none) { $('cmsg').textContent = 'No coastline found in the data.'; return; }
  $('cmsg').hidden = true; $('clab').hidden = false; render();
}
export const refreshCoast = refresh;
export async function coastFor(pl) { await masks(); return coastInfo(pl.lat, pl.lon, land, lakes); }   // used by the ocean-current tool

export function initCoast() {
  $('cbody').innerHTML = `<p id="cmsg" class="muted"></p><div id="cfacts"></div>
    <div id="clab" hidden>
      <div id="csvg"></div>
      <label class="block">Time of day (local solar time): <b id="chtxt"></b><input type="range" id="chour" min="0" max="23.5" step=".5" aria-label="Time of day"></label>
      <div class="inline"><button id="cplay">▶ Play a day</button></div>
      <p id="ctext"></p><div id="cchart"></div>
      <p class="small muted">Orange shading: hours when the land is warmer than the water.</p>
      <div class="inline"><label>Water temperature <input type="number" id="cwater" step="1"> <span id="cwu"></span></label><button id="cwreset" class="ghost">Use model</button></div>
      <p class="small muted">The water temperature is the model’s air temperature over the water, a stand-in. Change it to test other conditions.</p>
      <h4>What a breeze needs, and how your place measures up now</h4><ul id="cchk" class="chk"></ul><p><b id="cverdict"></b></p>
      <button id="cpin" class="pinbtn" data-topic="breeze">📌 Add to notes</button>
    </div>`;
  $('chour').value = C.hour;
  $('chour').oninput = e => { C.hour = +e.target.value; if (C.fit) render(); };
  $('cwater').onchange = e => { C.sea = tempIn(+e.target.value); render(); };
  $('cwreset').onclick = () => { C.sea = C.seaModel; render(); };
  $('cplay').onclick = () => {
    if (C.timer) { clearInterval(C.timer); C.timer = null; $('cplay').textContent = '▶ Play a day'; return; }
    $('cplay').textContent = '❚❚ Pause'; C.timer = setInterval(() => { C.hour = (C.hour + .5) % 24; $('chour').value = C.hour; if (C.fit) render(); if ($('tab-local').hidden) { clearInterval(C.timer); C.timer = null; $('cplay').textContent = '▶ Play a day'; } }, 180);
  };
  $('cpin').onclick = () => { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: 'breeze', text: $('cpin').dataset.text } })); $('cpin').textContent = '✓ Added to notes'; $('cpin').disabled = true; };
  document.addEventListener('units', () => { if (C.fit && !$('clab').hidden) render(); });
}
