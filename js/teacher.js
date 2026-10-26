// Teacher view. The forecast lives in data/teacher.enc, encrypted with a passphrase only the teacher has.
// Unlocking decrypts it in memory for this browser tab; reloading locks it again. Nothing is saved.
import { $, esc, fmtT, fmtS, fmtRain, tempOut, tUnit } from './util.js';
import { P } from './place.js';
import { S, addForecast, sample, frameTime } from './data.js';
import { setFrame, flyTo } from './mapview.js';
import { CONCEPTS, SKYL, PTYPEL, TRENDL, label } from './forecast.js';

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
    const d = days.find(x => x.date === key(frameTime(i))); if (!d) continue;
    const f = k => sample(S.D.f[k][i], lat, lon);
    d.t.push(f('t')); d.spd.push(Math.hypot(f('u'), f('v'))); d.pr.push(f('pr') || 0); d.p.push(f('p'));
  }
  return days.map(d => d.t.length ? { date: d.date, n: d.t.length, hi: Math.max(...d.t), lo: Math.min(...d.t), wmax: Math.max(...d.spd), rain: d.pr.reduce((a, b) => a + b, 0), dp: d.p.at(-1) - d.p[0] } : { date: d.date, n: 0 });
}
const row = (d, i) => d.n ? `<tr><td>Day ${i + 1}${d.n < 3 ? ' <small class="muted">(' + d.n + '/4 times)</small>' : ''}</td><td>${fmtT(d.hi)} / ${fmtT(d.lo)}</td><td>${fmtS(d.wmax)}</td><td>${fmtRain(d.rain)}</td><td>${d.dp > 0 ? '+' : ''}${d.dp.toFixed(1)}</td></tr>` : `<tr><td>Day ${i + 1}</td><td colspan="4" class="muted">not covered by the forecast</td></tr>`;
const MODEL_NOTE = 'Approximate: from 6-hourly model values at a ~200 km grid, so highs run a little low and lows a little high.';

function renderTeacher() {
  const pl = P.place;
  $('tbody').innerHTML = `<p class="tb">Teacher view is ON. Forecast frames are loaded in this tab only. The time slider now continues past “Now” into orange <b>FORECAST</b> frames. Reload the page to lock.</p>
    <h4>Model forecast for the place on this browser</h4>` + (pl ? modelTable(pl.name, pl.lat, pl.lon) : '<p class="muted">No place chosen yet in this browser.</p>') +
    `<h4>Check a student’s file</h4><p class="small muted">Choose a forecast file a student saved (“Save my forecast file”). It is compared with the model at their place.</p>
    <input type="file" id="tfile" accept=".json"><div id="tcmp"></div>
    <p><button id="tlock">Lock teacher view</button></p>`;
  $('tfile').onchange = async e => { const f = e.target.files[0]; if (f) compare(JSON.parse(await f.text())); };
  $('tlock').onclick = () => location.reload();
}
const modelTable = (name, lat, lon) => `<p><b>${esc(name)}</b></p><table class="tt"><tr><th></th><th>High / Low</th><th>Max wind</th><th>Rain</th><th>hPa change</th></tr>${modelDays(lat, lon).map(row).join('')}</table><p class="small muted">${MODEL_NOTE}</p>`;

function compare(o) {
  if (o.app !== 'pressure-map' || !o.place) { $('tcmp').innerHTML = '<p class="warn">Not a forecast file from this map.</p>'; return; }
  const m = modelDays(o.place.lat, o.place.lon), F = o.forecast, stale = o.cycle !== S.D.cycle;
  const diff = (st, md) => st == null || md == null ? '—' : (tempOut(st) - tempOut(md) > 0 ? '+' : '') + Math.round(tempOut(st) - tempOut(md));
  const cd = CONCEPTS.filter(c => F.concepts[c.k] && F.concepts[c.k].applies && F.concepts[c.k].text.trim().length >= 20).length;
  $('tcmp').innerHTML = `<p><b>${esc(o.student || '(no name)')}</b> — ${esc(o.place.name)} <button id="tgo">Show on map</button></p>
    ${stale ? '<p class="warn">This file was made from an older data cycle than the one loaded now, so differences can come from model updates.</p>' : ''}
    <table class="tt"><tr><th></th><th>Student H / L</th><th>Model H / L</th><th>Off by (H / L)</th></tr>` + F.days.map((d, i) =>
      `<tr><td>Day ${i + 1}</td><td>${d.hi == null ? '—' : fmtT(d.hi)} / ${d.lo == null ? '—' : fmtT(d.lo)}</td><td>${m[i].n ? fmtT(m[i].hi) + ' / ' + fmtT(m[i].lo) : '—'}</td><td>${m[i].n ? diff(d.hi, m[i].hi) + ' / ' + diff(d.lo, m[i].lo) + ' ' + tUnit() : '—'}</td></tr>
      <tr><td></td><td colspan="3" class="small">${esc(label(SKYL, d.sky))}, ${d.pc === '' ? '—' : d.pc + '%'} ${esc(label(PTYPEL, d.ptype))}, wind ${d.wdir || '—'} ${d.wspd == null ? '' : fmtS(d.wspd)}, pressure ${esc(label(TRENDL, d.ptrend))}<br><i>${esc(d.why) || 'no reasoning written'}</i></td></tr>`).join('') +
    `</table><p>Concepts explained: <b>${cd}/5</b></p><p class="small muted">${MODEL_NOTE}</p>`;
  $('tgo').onclick = () => { flyTo(o.place.lat, o.place.lon, 5); setFrame(S.nPast - 1); };
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
    close(); document.body.classList.add('teacher'); $('slider').max = S.hours.length - 1; $('tbtn').hidden = true;
    renderTeacher(); document.querySelector('[data-tab="teacher"]').hidden = false; document.querySelector('[data-tab="teacher"]').click();
    document.addEventListener('placechange', renderTeacher);
  };
}
