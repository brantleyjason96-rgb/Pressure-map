// "My Forecast": the blank 3-day forecast the student builds, the five concept explanations, save/load and the printable report.
// Nothing is pre-filled from the model. These are the student's own predictions.
import { $, esc, store, fmtT, fmtS, fmtP, fmtElev, tempOut, tempIn, spdOut, spdIn, tUnit, sUnit, compass } from './util.js';
import { S } from './data.js';
import { P, pastSeries, chartsHTML } from './place.js';

export const CONCEPTS = [
  { k: 'hl', icon: '🔵', name: 'Highs and Lows', ask: 'Which High or Low controls my weather? Where is it going, and what will it do to my pressure and sky?',
    frames: ['The nearest ___ is ___ away and moving toward the ___.', 'Because pressure is ___, the sky will be ___.', 'On Day ___ the ___ will be over my place, so the weather will be ___.'] },
  { k: 'front', icon: '🟦', name: 'Fronts', ask: 'Will a front reach my place? When? What changes when it passes?',
    frames: ['A ___ front is ___ away and moving about ___.', 'It will reach my place on Day ___ because distance ÷ speed = ___ hours.', 'After it passes, the temperature will ___ and the wind will change from ___ to ___.'] },
  { k: 'breeze', icon: '🌊', name: 'Land Breeze and Sea Breeze', ask: 'Is my place near a coast or a big lake? When will a breeze blow, and from where?',
    frames: ['My place is near ___, so a ___ breeze can happen.', 'In the daytime the land heats ___ than the water, so air moves from the ___ to the ___.', 'At night the land cools ___, so the breeze blows from the ___.'] },
  { k: 'oro', icon: '⛰️', name: 'Windward and Leeward', ask: 'Which way is the wind blowing compared with the mountains? Is my place on the windward or leeward side?',
    frames: ['The wind comes from the ___, so my place is on the ___ side.', 'Air that is forced up the mountain ___ and cools, so clouds and rain form on the ___ side.', 'Air that sinks on the other side ___, so it is ___ and dry (a rain shadow).'] },
  { k: 'current', icon: '🌀', name: 'Ocean Currents', ask: 'What is the nearest ocean current? Is it warm or cold? How does it change my air?',
    frames: ['The nearest ocean current is the ___ current, and it is ___ (warm / cold).', 'Air over it becomes ___ and ___, so my place will be ___.', 'This is why my temperatures are ___ than other places at the same latitude.'] },
];
const blankDay = () => ({ hi: null, lo: null, sky: '', pc: '', ptype: '', wdir: '', wspd: null, ptrend: '', why: '' });
const blank = () => ({ student: '', days: [blankDay(), blankDay(), blankDay()], concepts: Object.fromEntries(CONCEPTS.map(c => [c.k, { applies: '', text: '' }])) });
export let F = Object.assign(blank(), store.get('fc', {}));
const save = () => { F.cycle = S.D.cycle; store.set('fc', F); progress(); };

const SKY = [['clear', '☀️ Clear'], ['pc', '🌤️ Partly cloudy'], ['mc', '⛅ Mostly cloudy'], ['oc', '☁️ Overcast']];
const PTYPE = [['none', 'None'], ['rain', '🌧️ Rain'], ['tstorm', '⛈️ Thunderstorms'], ['snow', '🌨️ Snow'], ['mix', '🌨️ Wintry mix']];
const TREND = [['rising', '↗ Rising'], ['steady', '→ Steady'], ['falling', '↘ Falling']];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const label = (arr, v) => (arr.find(a => a[0] === v) || [, '—'])[1];
export const SKYL = SKY, PTYPEL = PTYPE, TRENDL = TREND;
const dayDate = k => new Date(Date.now() + (k + 1) * 864e5).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const opts = (arr, v) => '<option value="">Choose…</option>' + arr.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');

function dayDone(d) { return d.hi != null && d.lo != null && d.sky && d.pc !== '' && d.ptype && d.wdir && d.wspd != null && d.ptrend && d.why.trim().length >= 15; }
const conceptDone = c => c.applies && c.text.trim().length >= 20;
function progress() {
  const dd = F.days.filter(dayDone).length, cd = CONCEPTS.filter(c => conceptDone(F.concepts[c.k])).length;
  $('fprog').innerHTML = `<span class="${dd === 3 ? 'ok' : ''}">Days ${dd}/3</span> · <span class="${cd === 5 ? 'ok' : ''}">Concepts ${cd}/5</span> · <span class="${P.place ? 'ok' : ''}">Place ${P.place ? '✓' : 'not chosen'}</span>`;
  F.days.forEach((d, i) => { const e = $('dtag' + i); if (e) { e.textContent = dayDone(d) ? '✓ complete' : ''; } const w = $('dwarn' + i); if (w) w.textContent = d.hi != null && d.lo != null && d.lo > d.hi ? 'The low is higher than the high — check your numbers.' : ''; });
  CONCEPTS.forEach(c => { const e = $('ctag' + c.k); if (e) e.textContent = conceptDone(F.concepts[c.k]) ? '✓' : ''; });
}

function render() {
  $('fname').value = F.student || '';
  $('fdays').innerHTML = F.days.map((d, i) => `
    <details class="day" ${i === 0 ? 'open' : ''}><summary>Day ${i + 1} <small>${esc(dayDate(i))}</small> <span class="tag" id="dtag${i}"></span></summary>
      <div class="grid2">
        <label>High (${tUnit()})<input type="number" step="1" data-d="${i}" data-k="hi" value="${d.hi == null ? '' : Math.round(tempOut(d.hi))}"></label>
        <label>Low (${tUnit()})<input type="number" step="1" data-d="${i}" data-k="lo" value="${d.lo == null ? '' : Math.round(tempOut(d.lo))}"></label>
        <label>Sky<select data-d="${i}" data-k="sky">${opts(SKY, d.sky)}</select></label>
        <label>Chance of precipitation<select data-d="${i}" data-k="pc"><option value="">Choose…</option>${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => `<option value="${v}"${String(d.pc) === String(v) ? ' selected' : ''}>${v}%</option>`).join('')}</select></label>
        <label>Precipitation type<select data-d="${i}" data-k="ptype">${opts(PTYPE, d.ptype)}</select></label>
        <label>Pressure<select data-d="${i}" data-k="ptrend">${opts(TREND, d.ptrend)}</select></label>
        <label>Wind from the<select data-d="${i}" data-k="wdir"><option value="">Choose…</option>${DIRS.map(v => `<option${v === d.wdir ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Wind speed (${sUnit()})<input type="number" min="0" step="1" data-d="${i}" data-k="wspd" value="${d.wspd == null ? '' : Math.round(spdOut(d.wspd))}"></label>
      </div>
      <p class="warn" id="dwarn${i}"></p>
      <label class="block">Why? <small class="muted">Use evidence from the map: which system, front, wind or place feature explains this day?</small>
        <textarea rows="3" data-d="${i}" data-k="why" placeholder="On Day ${i + 1}, … because …">${esc(d.why)}</textarea></label>
    </details>`).join('');
  $('fconcepts').innerHTML = CONCEPTS.map(c => {
    const v = F.concepts[c.k];
    return `<details class="concept"><summary>${c.icon} ${c.name} <span class="tag" id="ctag${c.k}"></span></summary>
      <p class="ask">${esc(c.ask)}</p>
      <label class="block">Does this apply to my place?<select data-c="${c.k}" data-k="applies"><option value="">Choose…</option>
        <option value="yes"${v.applies === 'yes' ? ' selected' : ''}>Yes — it changes my forecast</option><option value="no"${v.applies === 'no' ? ' selected' : ''}>No — and I explain why not</option></select></label>
      <div class="frames">${c.frames.map((f, j) => `<button type="button" data-frame="${c.k}" data-j="${j}">${esc(f)}</button>`).join('')}</div>
      <textarea rows="4" data-c="${c.k}" data-k="text" placeholder="Click a sentence frame above to start, then fill in the blanks.">${esc(v.text)}</textarea></details>`;
  }).join('');
  progress();
}

function readBack(e) {
  const t = e.target, k = t.dataset.k; if (!k) return;
  if (t.dataset.d != null) {
    const d = F.days[+t.dataset.d]; let v = t.value;
    if (k === 'hi' || k === 'lo') d[k] = v === '' ? null : tempIn(+v); else if (k === 'wspd') d[k] = v === '' ? null : spdIn(+v); else d[k] = v;
  } else if (t.dataset.c) F.concepts[t.dataset.c][k] = t.value;
  save();
}

// ---- printable report (uses the browser's Print -> Save as PDF)
function reportHTML() {
  const pl = P.place, n = S.nPast - 1, miss = [];
  F.days.forEach((d, i) => { if (!dayDone(d)) miss.push(`Day ${i + 1}`); });
  const ser = pl ? pastSeries(pl) : null, cyc = new Date(Date.parse(S.D.cycle));
  const table = `<table class="rt"><tr><th></th>${F.days.map((_, i) => `<th>Day ${i + 1}<br><small>${esc(dayDate(i))}</small></th>`).join('')}</tr>
    <tr><td>High / Low</td>${F.days.map(d => `<td>${d.hi == null ? '—' : fmtT(d.hi)} / ${d.lo == null ? '—' : fmtT(d.lo)}</td>`).join('')}</tr>
    <tr><td>Sky</td>${F.days.map(d => `<td>${esc(label(SKY, d.sky))}</td>`).join('')}</tr>
    <tr><td>Precipitation</td>${F.days.map(d => `<td>${d.pc === '' ? '—' : d.pc + '%'} ${d.ptype ? esc(label(PTYPE, d.ptype)) : ''}</td>`).join('')}</tr>
    <tr><td>Wind</td>${F.days.map(d => `<td>${d.wdir ? 'from the ' + d.wdir : '—'} ${d.wspd == null ? '' : 'at ' + fmtS(d.wspd)}</td>`).join('')}</tr>
    <tr><td>Pressure</td>${F.days.map(d => `<td>${esc(label(TREND, d.ptrend))}</td>`).join('')}</tr>
    <tr><td>Why</td>${F.days.map(d => `<td class="why">${esc(d.why) || '—'}</td>`).join('')}</tr></table>`;
  return `<h1>3-Day Weather Forecast</h1>
    <p><b>Forecaster:</b> ${esc(F.student) || '________________'} &nbsp; <b>Place:</b> ${pl ? esc(pl.name) : '—'} ${pl ? `(${pl.lat.toFixed(2)}, ${pl.lon.toFixed(2)}, elevation ${esc(fmtElev(pl.elev))})` : ''}</p>
    <p class="small">Made with model analysis from ${cyc.toUTCString().replace(':00:00 GMT', ' UTC')}${S.D.sample ? ' (SAMPLE DATA)' : ''}. The student built this forecast from observations; no forecast was provided.</p>
    ${pl && P.normals && P.normals !== 'loading' && P.normals !== 'error' ? `<p><b>Normal for this time of year:</b> high ${fmtT(P.normals.hi)}, low ${fmtT(P.normals.lo)}</p>` : ''}
    ${pl ? `<h2>What the map showed (past 48 hours at my place)</h2><div class="rcharts">${chartsHTML(ser, null)}</div>
      <p class="small">Now: ${fmtT(ser.t[n])}, dewpoint ${fmtT(ser.d[n])}, ${esc(fmtP(ser.p[n]))}, wind from the ${compass(ser.dir[n])} at ${fmtS(ser.spd[n])}.</p>` : ''}
    <h2>My forecast</h2>${table}${miss.length ? `<p class="small">Not finished: ${miss.join(', ')}.</p>` : ''}
    <h2>My reasoning</h2>${CONCEPTS.map(c => { const v = F.concepts[c.k]; return `<div class="rc"><h3>${c.icon} ${c.name} — ${v.applies === 'yes' ? 'applies to my place' : v.applies === 'no' ? 'does not apply' : 'not answered'}</h3><p>${esc(v.text) || '—'}</p></div>`; }).join('')}`;
}
export function printReport() {
  if (!S.D) return; $('printReport').innerHTML = reportHTML();
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); document.body.classList.add('printing'); setTimeout(() => window.print(), 50);
}

// ---- save / load a file the student can turn in (teacher view can open it)
export function exportObject() { return { app: 'pressure-map', v: 1, student: F.student, place: P.place, cycle: S.D.cycle, units: store.get('units', 'us'), forecast: F }; }
function download() {
  const blob = new Blob([JSON.stringify(exportObject(), null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `forecast-${(F.student || 'student').replace(/\W+/g, '_')}.json`; a.click(); URL.revokeObjectURL(a.href);
}

export function initForecast() {
  render();
  for (const id of ['fdays', 'fconcepts']) for (const ev of ['input', 'change']) $(id).addEventListener(ev, readBack);
  $('fconcepts').addEventListener('click', e => {
    const b = e.target.closest('[data-frame]'); if (!b) return;
    const c = CONCEPTS.find(x => x.k === b.dataset.frame), ta = b.closest('details').querySelector('textarea');
    ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + c.frames[+b.dataset.j]; ta.focus(); F.concepts[c.k].text = ta.value; save();
  });
  $('fname').oninput = e => { F.student = e.target.value; save(); };
  $('fprint').onclick = printReport; $('fsave').onclick = download;
  $('fload').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const o = JSON.parse(await f.text()); if (o.app !== 'pressure-map') throw 0; F = Object.assign(blank(), o.forecast); store.set('fc', F); render();
      if (o.place) document.dispatchEvent(new CustomEvent('loadplace', { detail: o.place })); } catch { alert('That file is not a forecast saved from this map.'); }
    e.target.value = '';
  };
  $('freset').onclick = () => { if (confirm('Erase my whole forecast and start over?')) { F = blank(); store.set('fc', F); render(); } };
  document.addEventListener('units', render); document.addEventListener('placechange', progress);
  document.addEventListener('loadplace', e => import('./place.js').then(m => m.setPlace(e.detail, false)));
}
