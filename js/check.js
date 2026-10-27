// "Check my work": the five rubric categories as a short checklist that ticks itself, plus the evidence tracker and "do these fit together?" nudges.
import { $ } from './util.js';
import { P } from './place.js';
import { getNotes } from './notes.js';
import { PLAN, planDone, planTotal, planFlags, daysWithReason } from './planner.js';
import { hasProjection } from './predict.js';
import { EV, LS } from './evid.js';
import { status, noted } from './localsum.js';

const li = (ok, text, cls = '') => `<li class="${ok ? 'ok' : cls || 'todo'}"><span aria-hidden="true">${ok ? '✓' : cls === 'warn' ? '⚠' : '○'}</span><span>${text}</span></li>`;
const group = (title, items) => `<h4>${title}</h4><ul class="chk">${items.join('')}</ul>`;
function compute() {
  const N = getNotes().items, has = k => N.filter(i => i.k === k).length > 0, flags = planFlags(), st = status(), main = [];
  const add = (ok, text) => { main.push(ok); return li(ok, text); };
  const ev = [['Map data saved to my notes (📌) or a map picture', N.some(i => i.pin) || EV.pic], ['A chart picture from My Place', EV.chart], ['A note I wrote myself', N.some(i => !i.pin)], ['My own projection (Predict tab)', hasProjection()]];
  const kinds = ev.filter(e => e[1]).length, total = planTotal(), local = [];
  for (const [k, names] of [['oro', ['Mountains: I saved a note', 'Mountains: save a note (it applies to my place)', 'Mountains: save a note (it might apply)', 'Mountains: does not apply to my place']],
    ['coast', ['Coast: I saved a note', 'Coast: save a note (it applies to my place)', 'Coast: save a note (it might apply)', 'Coast: does not apply to my place']],
    ['cur', ['Ocean current: I saved a note', 'Ocean current: save a note (it applies to my place)', 'Ocean current: save a note (it might apply)', 'Ocean current: does not apply to my place']]]) {
    const s = st[k]; if (!s) continue;
    local.push(s === 'no' ? add(true, names[3]) : noted(k) ? add(true, names[0]) : add(false, s === 'yes' ? names[1] : names[2]));
  }
  const html = [
    group('1 · Place and weather systems', [add(!!P.place, 'I chose my place'), add(has('hl'), 'I saved a note about a High or a Low'), add(has('front'), 'I saved a note about a front')]),
    group('2 · Daily forecast', [add(planDone() === total, `${planDone()} of ${total} forecast boxes are filled in`), ...flags.map(f => li(false, f, 'warn'))]),
    group('3 · Reasoning and evidence', [add(daysWithReason() === 3, `${daysWithReason()} of 3 days have a reason written`), add(kinds >= 3, `I used ${kinds} of 4 kinds of evidence (I need at least 3)`),
      `<li class="sub"><ul class="chk">${ev.map(e => li(e[1], e[0])).join('')}</ul></li>`, add(!!PLAN.unsure.trim(), 'I wrote what could make my forecast wrong')]),
    group('4 · Local effects', local.length ? local : [li(false, 'Open the Local tab to find out which local effects apply to my place')]),
    group('5 · Presentation', [add(EV.slides, 'I made my slide text (Notes tab, “Make my slides”)'), add(EV.pic, 'I saved a picture of the map (📷 button on the map)')]),
  ].join('') + '<p class="small muted">Tip: practice saying each day out loud without reading the slides. Use the 📖 Words button to practice the English weather words.</p>';
  return { html, done: main.filter(Boolean).length, count: main.length + (local.length ? 0 : 1) };
}
function render() {
  if (!$('chk')) return; const r = compute(); $('chk').innerHTML = r.html; $('chkcount').textContent = `${r.done} of ${r.count} done`;
}
export function initCheck() {
  for (const ev of ['noteschanged', 'placechange', 'planchange', 'evidchange', 'localsummary', 'projchanged']) document.addEventListener(ev, render);
  render();
}
