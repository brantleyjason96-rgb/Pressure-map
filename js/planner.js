// "My 3-day forecast plan": a place for the student to write down THEIR forecast, one card per day, so the slides can be built from it.
// It holds only what the student types. Nothing here comes from the model forecast. Temperatures are stored in °C and speeds in m/s.
import { $, esc, store, tempOut, tempIn, tUnit, spdOut, spdIn, sUnit, compass8 } from './util.js';
import { P } from './place.js';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SKY = ['Clear', 'Partly cloudy', 'Mostly cloudy', 'Overcast'];
const PREC = ['None', 'Rain', 'Snow', 'Rain and snow mix', 'Thunderstorms'];
const CHANCE = [10, 30, 50, 70, 90];
const TREND = ['Rising', 'Steady', 'Falling'];
export const blankDay = () => ({ hi: null, lo: null, sky: '', prec: '', chance: '', wdir: '', wspd: null, trend: '', why: '' });
export const PLAN = Object.assign({ days: [blankDay(), blankDay(), blankDay()], unsure: '' }, store.get('plan', {}));
while (PLAN.days.length < 3) PLAN.days.push(blankDay());
const save = () => { store.set('plan', PLAN); document.dispatchEvent(new Event('planchange')); };

const need = d => ['hi', 'lo', 'sky', 'prec', 'wdir', 'wspd', 'trend', 'why'].concat(d.prec && d.prec !== 'None' ? ['chance'] : []);
const done = d => need(d).filter(k => d[k] !== null && d[k] !== '').length;
export const dayName = n => { const t = new Date(); t.setDate(t.getDate() + n); return t.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
const opts = (list, cur, fmt = x => x) => '<option value="">Choose…</option>' + list.map(x => `<option value="${x}" ${String(cur) === String(x) ? 'selected' : ''}>${esc(fmt(x))}</option>`).join('');
const num = (c, f) => c == null ? '' : Math.round(f(c));

const GUIDE = `<details class="grp"><summary>💡 How do I get the numbers? (rules of thumb)</summary>
  <p class="small muted">You will not find tomorrow's temperature on the map. You work it out from evidence. These are rules of thumb, not exact answers. Check each one against the map.</p>
  <table class="tt guide"><tr><th>Decide</th><th>Look at</th><th>Rule of thumb</th></tr>
  <tr><td><b>High and low temperature</b></td><td>My Place: normal high and low, and today's temperature</td><td>Start from the <b>normal</b>. If today is warmer than normal, Day 1 usually starts warmer too. A <b>cold front</b> passing usually makes it about 10 to 20 °F (5 to 10 °C) cooler. Winds from the south (north in the Southern Hemisphere) bring warm air. Clear nights get colder than cloudy nights. The low rarely drops far below the dewpoint. Sea breezes cool a coastal afternoon. Air cools about 3.5 °F per 1,000 ft (6.5 °C per km) of height.</td></tr>
  <tr><td><b>Sky</b></td><td>Pressure change, dewpoint, the Highs, Lows and fronts</td><td><b>Falling pressure</b> and a dewpoint within 5 °F (3 °C) of the temperature mean more clouds. A <b>High</b> overhead means clear skies. Fronts bring a band of clouds. Cloud forms on windward slopes.</td></tr>
  <tr><td><b>Rain or snow, and the chance</b></td><td>Fronts and Lows near you, the Rain map layer, Local tab</td><td>You need <b>moisture</b> (dewpoint close to the temperature) plus <b>lift</b> (a front, a Low, or a windward slope). If a front or Low reaches your place that day, the chance is high. If it passes nearby, the chance is low or medium. Snow if the air near the ground is at or below 32 °F (0 °C). Near freezing, choose a mix.</td></tr>
  <tr><td><b>Wind direction and speed</b></td><td>Wind arrows on the Explore tab, isobars, My Place</td><td>Wind spirals <b>counterclockwise and inward</b> around a Low and <b>clockwise and outward</b> around a High (Northern Hemisphere). Closer isobars mean stronger wind. When a cold front passes, the wind usually shifts clockwise, for example from southwest to northwest.</td></tr>
  <tr><td><b>Pressure trend</b></td><td>My Place: pressure change in 24 hours</td><td>Pressure <b>falls</b> as a Low or front approaches and <b>rises</b> after it passes. Under a High it stays high and steady.</td></tr>
  <tr><td><b>When things change</b></td><td>Predict tab, front arrival calculator</td><td>Distance ÷ speed gives the hours until a system arrives. Hours ÷ 24 tells you which day the change belongs on.</td></tr></table>
</details>`;

function render() {
  const u = tUnit(), su = sUnit();
  $('planbody').innerHTML = `<p class="small muted">Write <b>your</b> forecast here. Open one day at a time. Your slides will use these cards. ${P.place ? 'Place: <b>' + esc(P.place.name) + '</b>.' : '<b>Choose your place first</b> on the My Place tab.'}</p>` + GUIDE +
    PLAN.days.map((d, i) => `<details class="topic day" name="planday" data-i="${i}" ${i === 0 ? 'open' : ''}><summary>Day ${i + 1} · ${esc(dayName(i + 1))} <small class="muted" data-count>${done(d)} of ${need(d).length} done</small></summary>
      <div class="pgrid">
        <label>High (${u}) <input type="number" data-f="hi" value="${num(d.hi, tempOut)}"></label>
        <label>Low (${u}) <input type="number" data-f="lo" value="${num(d.lo, tempOut)}"></label>
        <label>Sky <select data-f="sky">${opts(SKY, d.sky)}</select></label>
        <label>Rain or snow <select data-f="prec">${opts(PREC, d.prec)}</select></label>
        <label>Chance of it <select data-f="chance">${opts(CHANCE, d.chance, c => c + '%')}</select></label>
        <label>Pressure <select data-f="trend">${opts(TREND, d.trend)}</select></label>
        <label>Wind from the <select data-f="wdir">${opts(DIRS, d.wdir)}</select></label>
        <label>Wind speed (${su}) <input type="number" min="0" data-f="wspd" value="${num(d.wspd, spdOut)}"></label>
      </div>
      <label class="block">Why? Name the High, Low, front or local effect behind these numbers.
        <textarea rows="3" data-f="why" placeholder="Because the ___ is moving toward ___, so ___.">${esc(d.why)}</textarea></label>
    </details>`).join('') +
    `<label class="block">What could make my forecast wrong? <span class="muted small">(Name the biggest uncertainty and how it would change things.)</span>
      <textarea rows="3" id="punsure" placeholder="The biggest unknown is ___. If it moves faster, then ___.">${esc(PLAN.unsure)}</textarea></label>
    <p class="small muted">Saved automatically. It prints with your notes.</p>`;
}
function onInput(e) {
  const el = e.target, card = el.closest('.day'); if (el.id === 'punsure') { PLAN.unsure = el.value; save(); return; }
  if (!card || !el.dataset.f) return;
  const d = PLAN.days[+card.dataset.i], f = el.dataset.f, raw = el.value;
  d[f] = f === 'hi' || f === 'lo' ? (raw === '' ? null : tempIn(+raw)) : f === 'wspd' ? (raw === '' ? null : spdIn(+raw)) : f === 'chance' ? (raw === '' ? '' : +raw) : raw;
  if (f === 'prec' && raw === 'None') d.chance = '';
  save(); card.querySelector('[data-count]').textContent = `${done(d)} of ${need(d).length} done`;
  card.querySelector('[data-f=chance]').closest('label').hidden = d.prec === 'None';
}
export const planTotal = () => PLAN.days.reduce((n, d) => n + need(d).length, 0);
export function planFlags() {   // gentle "do these fit together?" nudges, not errors
  const f = [], D = PLAN.days;
  D.forEach((d, i) => { const n = i + 1;
    if (d.hi != null && d.lo != null && d.lo > d.hi) f.push(`Day ${n}: the low is higher than the high.`);
    if (d.prec === 'Snow' && d.hi != null && d.hi > 4) f.push(`Day ${n}: snow is unlikely when the high is above 40°F (4°C).`);
    if (d.prec && d.prec !== 'None' && d.sky === 'Clear') f.push(`Day ${n}: rain or snow does not fit with a clear sky.`);
    if (d.trend === 'Falling' && d.sky === 'Clear') f.push(`Day ${n}: pressure is falling but the sky is clear. Falling pressure usually brings clouds.`);
  });
  if (D.every(d => d.hi != null && d.sky && d.prec && d.wdir && d.trend) && ['hi', 'lo', 'sky', 'prec', 'wdir', 'trend'].every(k => D.every(d => d[k] === D[0][k]))) f.push('All three days look the same. Will anything change as the systems move?');
  return f;
}
export const daysWithReason = () => PLAN.days.filter(d => d.why.trim()).length;
export function planDone() { return PLAN.days.reduce((n, d) => n + done(d), 0); }
export function planText() {
  const f = d => `High ${num(d.hi, tempOut)}${tUnit()}, low ${num(d.lo, tempOut)}${tUnit()}; sky: ${d.sky || '?'}; ${d.prec === 'None' ? 'no rain or snow' : (d.prec || '?') + (d.chance ? ' (' + d.chance + '% chance)' : '')}; wind from the ${d.wdir || '?'} at ${num(d.wspd, spdOut)} ${sUnit()}; pressure ${(d.trend || '?').toLowerCase()}. Why: ${d.why || '—'}`;
  return PLAN.days.map((d, i) => `Day ${i + 1} (${dayName(i + 1)}): ${f(d)}`).concat(['Biggest uncertainty: ' + (PLAN.unsure || '—')]);
}
export function planHTML() {
  const c = (d, k, f) => d[k] == null || d[k] === '' ? '—' : esc(f ? f(d[k]) : d[k]);
  return `<h2>📅 My 3-day forecast</h2><table class="rt"><tr><th></th>${PLAN.days.map((_, i) => `<th>Day ${i + 1}<br><span class="small">${esc(dayName(i + 1))}</span></th>`).join('')}</tr>` +
    [['High / low', d => `${c(d, 'hi', x => Math.round(tempOut(x)) + tUnit())} / ${c(d, 'lo', x => Math.round(tempOut(x)) + tUnit())}`], ['Sky', d => c(d, 'sky')],
      ['Rain or snow', d => d.prec === 'None' ? 'None' : c(d, 'prec') + (d.chance ? ` (${d.chance}%)` : '')], ['Wind', d => `${c(d, 'wdir')} ${c(d, 'wspd', x => Math.round(spdOut(x)) + ' ' + sUnit())}`],
      ['Pressure', d => c(d, 'trend')], ['Why', d => esc(d.why).replace(/\n/g, '<br>') || '—']].map(([h, fn]) => `<tr><th>${h}</th>${PLAN.days.map(d => `<td>${fn(d)}</td>`).join('')}</tr>`).join('') +
    `</table><p><b>What could make my forecast wrong:</b> ${esc(PLAN.unsure) || '—'}</p>`;
}
export function initPlanner() {
  render();
  $('planbody').addEventListener('input', onInput); $('planbody').addEventListener('change', onInput);
  for (const ev of ['units', 'placechange']) document.addEventListener(ev, () => { if (!$('planbody').contains(document.activeElement)) render(); });
  $('planbody').querySelectorAll('.day').forEach((c, i) => { c.querySelector('[data-f=chance]').closest('label').hidden = PLAN.days[i].prec === 'None'; });
}
