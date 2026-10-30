// Teacher view. The forecast lives in data/teacher.enc, encrypted with a passphrase only the teacher has.
// Unlocking decrypts it in memory for this browser tab; reloading locks it again. Nothing is saved.
import { $, esc, fmtT, fmtS, fmtRain, compass, windFrom } from './util.js';
import { P } from './place.js';
import { TOPICS } from './notes.js';
import { S, addForecast, sample, frameTime } from './data.js';
import { initTime } from './mapview.js';
import { servicePlaceholder, fillServices, loadForecasterCharts, frontCheckHTML } from './services.js';

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(pw) {
  const r = await fetch('data/teacher.enc'); if (!r.ok) throw new Error('missing');
  const o = await r.json(), enc = new TextEncoder();
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(o.salt), iterations: o.iters, hash: 'SHA-256' },
    await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(o.iv) }, key, b64(o.ct));   // throws on a wrong passphrase
  return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

// Model values for the 3 local calendar days after today at a place (approximate: built from 6-hourly values).
export function modelDays(lat, lon) {
  const off = lon / 15 * 3600e3, key = t => new Date(t.getTime() + off).toISOString().slice(0, 10), today = Date.now();
  const days = [0, 1, 2].map(k => ({ date: key(new Date(today + (k + 1) * 864e5)), t: [], spd: [], pr: [], p: [] }));
  for (let i = S.nPast; i < S.hours.length; i++) {
    if (S.hours[i] % 6) continue;                                   // the 6-h rain totals are only real on the 6-hourly frames
    const d = days.find(x => x.date === key(frameTime(i))); if (!d) continue;
    const f = k => sample(S.D.f[k][i], lat, lon);
    d.t.push(f('t')); d.spd.push(Math.hypot(f('u'), f('v'))); d.pr.push(f('pr') || 0); d.p.push(f('p'));
  }
  return days.map(d => d.t.length ? { date: d.date, n: d.t.length, hi: Math.max(...d.t), lo: Math.min(...d.t), wmax: Math.max(...d.spd), rain: d.pr.reduce((a, b) => a + b, 0), dp: d.p.at(-1) - d.p[0] } : { date: d.date, n: 0 });
}
const row = (d, i) => d.n ? `<tr><td>Day ${i + 1}${d.n < 3 ? ' <small class="muted">(' + d.n + '/4 times)</small>' : ''}</td><td>${fmtT(d.hi)} / ${fmtT(d.lo)}</td><td>${fmtS(d.wmax)}</td><td>${fmtRain(d.rain)}</td><td>${d.dp > 0 ? '+' : ''}${d.dp.toFixed(1)}</td></tr>` : `<tr><td>Day ${i + 1}</td><td colspan="4" class="muted">not covered by the forecast</td></tr>`;
const MODEL_NOTE = 'Approximate: from 6-hourly model values at a ~200 km grid, so highs run a little low and lows a little high.';

function detail(lat, lon) { // every 6-hourly forecast frame at the place, in the place's local time
  const off = lon / 15 * 3600e3;
  return S.hours.map((h, i) => i).filter(i => i >= S.nPast && S.hours[i] % 6 === 0).map(i => {
    const f = k => sample(S.D.f[k][i], lat, lon), u = f('u'), v = f('v'), loc = new Date(frameTime(i).getTime() + off);
    return `<tr><td>${loc.toLocaleString([], { weekday: 'short', hour: 'numeric', timeZone: 'UTC' })}</td><td>${fmtT(f('t'))}</td><td>${fmtT(f('d'))}</td><td>${Math.round(f('p'))}</td><td>${compass(windFrom(u, v))} ${fmtS(Math.hypot(u, v))}</td><td>${fmtRain(f('pr') || 0)}</td></tr>`;
  }).join('');
}
const modelTable = (name, lat, lon) => `<p><b>${esc(name)}</b></p><table class="tt"><tr><th></th><th>High / Low</th><th>Max wind</th><th>Rain</th><th>hPa change</th></tr>${modelDays(lat, lon).map(row).join('')}</table><p class="small muted">${MODEL_NOTE}</p>
  <details><summary>Every 6 hours (place’s local time)</summary><table class="tt"><tr><th>Time</th><th>Temp</th><th>Dewpt</th><th>hPa</th><th>Wind</th><th>Rain / 6 h</th></tr>${detail(lat, lon)}</table></details>` + servicePlaceholder(lat, lon);

let chartsNote = 'Loading…';
function renderTeacher() {
  const pl = P.place;
  $('tbody').innerHTML = `<p class="tb">Teacher view is ON. Forecast frames are loaded in this tab only. The time slider now continues past “Now” into orange <b>FORECAST</b> frames. Reload the page to lock.</p>
    <h4>Model forecast for the chosen place</h4><p class="small muted">To check a student’s presentation, pick their place on the My Place tab; this table updates.</p>` +
    (pl ? modelTable(pl.name, pl.lat, pl.lon) : '<p class="muted">No place chosen yet in this browser.</p>') +
    `<h4>NOAA forecasters’ fronts for the coming days</h4><p id="tcharts" class="small">${esc(chartsNote)}</p>
    <h4>Front check: computer-found vs. NOAA</h4>${frontCheckHTML()}
    <h4>Open a student’s saved work</h4><p class="small muted">Choose the file a student saved with 💾 My work. You will see their notes next to the model forecast for their place.</p>
    <input type="file" id="tfile" accept=".json" aria-label="Student work file"><div id="tstudent"></div><p><button id="tlock">Lock teacher view</button></p>`;
  fillServices($('tbody'));
  $('tfile').onchange = async e => { const f = e.target.files[0]; if (f) { try { showStudent(JSON.parse(await f.text())); fillServices($('tstudent')); } catch { $('tstudent').innerHTML = '<p class="warn">Could not read that file.</p>'; } } };
  $('tlock').onclick = () => location.reload();
}

function showStudent(o) {
  if (o.app !== 'pressure-map') { $('tstudent').innerHTML = '<p class="warn">That is not a weather project file.</p>'; return; }
  const pl = o.place, items = (o.notes && o.notes.items) || [], by = TOPICS.map(t => ({ t, items: items.filter(i => i.k === t.k) })).filter(g => g.items.length);
  const pj = (o.proj && o.proj.items) || [], CN = { 'Cold Front': 'cold front', 'Warm Front': 'warm front', 'Stationary Front': 'stationary front', 'Occluded Front': 'occluded front' };
  const proj = pj.length ? '<h4>🔮 Their projection (their own guess)</h4>' + pj.map(i => `<p class="tnote">${i.kind === 'front' ? esc(CN[i.type] || 'front') : (i.kind === 'H' ? 'High' : 'Low') + ' ' + Math.round(i.p) + ' hPa'}: toward ${Math.round(i.dir)}° at ${Math.round(i.spd * 0.621)} mph${i.kind !== 'front' && i.dp ? ', ' + (i.dp > 0 ? '+' : '') + i.dp + ' hPa/day' : ''}</p>`).join('') : '';
  $('tstudent').innerHTML = `<h3>${esc(o.student || '(no name)')}</h3><p class="small muted">Saved ${o.savedAt ? new Date(o.savedAt).toLocaleString() : ''} · ${items.length} notes</p>` +
    (pl ? modelTable(pl.name, pl.lat, pl.lon) : '<p class="muted">This student has not chosen a place yet.</p>') + proj +
    (by.map(g => `<h4>${g.t.icon} ${esc(g.t.name)}</h4>` + g.items.map(i => `<p class="tnote">${i.pin ? '📌 ' : ''}${esc(i.text).replace(/\n/g, '<br>')}</p>`).join('')).join('') || '<p class="muted">No notes yet.</p>');
}

export function initTeacher() {
  const modal = $('tmodal'), close = () => { modal.hidden = true; $('tpw').value = ''; $('terr').textContent = ''; };
  $('tbtn').onclick = () => { modal.hidden = false; $('tpw').focus(); };
  $('tcancel').onclick = close;
  $('tform').onsubmit = async e => {
    e.preventDefault(); $('terr').textContent = 'Unlocking…';
    try { addForecast(await decrypt($('tpw').value)); } catch (err) {
      $('terr').textContent = err.message === 'missing' ? 'Teacher view is not set up on this site yet (no teacher.enc file).' : 'That passphrase did not work.'; return;
    }
    close(); document.body.classList.add('teacher'); initTime(); $('tbtn').hidden = true;
    loadForecasterCharts().then(d => { chartsNote = d.length ? `Forecaster-drawn fronts for ${d.join(', ')} are shown on the matching forecast days of the map (one chart per day) when “Fronts drawn by NOAA forecasters” is checked.` : 'No forecaster charts for coming days were available.'; if ($('tcharts')) $('tcharts').textContent = chartsNote; })
      .catch(() => { chartsNote = 'Forecaster charts could not be loaded.'; if ($('tcharts')) $('tcharts').textContent = chartsNote; });
    renderTeacher(); document.querySelector('[data-tab="teacher"]').hidden = false; document.querySelector('[data-tab="teacher"]').click();
    document.addEventListener('placechange', renderTeacher); document.addEventListener('units', renderTeacher);   // the forecast table is built from cached data, so no new requests
  };
}
