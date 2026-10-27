// "Make my slides": turns the plan and notes into text for each slide, to paste into Google Slides or PowerPoint.
import { $, tempOut, tUnit, spdOut, sUnit } from './util.js';
import { S } from './data.js';
import { P } from './place.js';
import { getNotes } from './notes.js';
import { PLAN, dayName } from './planner.js';
import { markEvid } from './evid.js';

const num = (c, f) => c == null ? '___' : Math.round(f(c));
function build() {
  const N = getNotes(), pl = P.place, L = [], notes = k => N.items.filter(i => i.k === k).map(i => '• ' + i.text.replace(/\s+/g, ' '));
  const slide = (n, title, lines) => L.push(`SLIDE ${n}: ${title}`, ...lines, '');
  slide(1, `My 3-Day Forecast for ${pl ? pl.name : '(my city)'}`, [`By ${N.student || '(my name)'}`, `Date: ${new Date().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`, '[Add a picture of the map with my city]']);
  const today = ['• Location (latitude, longitude) and elevation: ___', '• Normal high and low for this time of year: ___', '• Today: temperature ___, wind ___, pressure ___', ...notes('hl'), ...notes('front')];
  slide(2, 'My place and the weather systems near it', [...today, '[Add the map picture and the place charts]']);
  PLAN.days.forEach((d, i) => slide(3 + i, `Day ${i + 1}: ${dayName(i + 1)}`, [
    `• High ${num(d.hi, tempOut)}${tUnit()}, low ${num(d.lo, tempOut)}${tUnit()}`, `• Sky: ${d.sky || '___'}`,
    `• Rain or snow: ${d.prec === 'None' ? 'none' : (d.prec || '___') + (d.chance ? ` (${d.chance}% chance)` : '')}`,
    `• Wind: from the ${d.wdir || '___'} at ${num(d.wspd, spdOut)} ${sUnit()}`, `• Pressure: ${(d.trend || '___').toLowerCase()}`, `• Why: ${d.why.replace(/\s+/g, ' ').trim() || '___'}`,
    '[Add one picture as evidence: map, chart or my projection]']));
  const local = [...notes('oro'), ...notes('breeze'), ...notes('current')];
  slide(6, 'Local effects: mountains, coast and ocean', [...(local.length ? local : ['• ___']), '[Add the cross-section or breeze picture]']);
  slide(7, 'What could make my forecast wrong?', [PLAN.unsure.trim() ? '• ' + PLAN.unsure.replace(/\s+/g, ' ').trim() : '• ___']);
  slide(8, 'Sources', [`• Weather data: NOAA GFS model analysis through ${S.D ? new Date(Date.parse(S.D.cycle)).toUTCString() : ''}`, '• Normals and elevation: Open-Meteo', '• Maps: Esri, Natural Earth, NOAA']);
  return L.join('\n');
}
export function initSlides() {
  const show = () => { $('sltext').value = build(); markEvid('slides'); };
  $('slgo').onclick = show;
  $('slcopy').onclick = async () => { show(); try { await navigator.clipboard.writeText($('sltext').value); $('slcopy').textContent = '✓ Copied'; setTimeout(() => $('slcopy').textContent = 'Copy', 1500); } catch { alert('Copy was blocked. Use “Download” instead.'); } };
  $('sldl').onclick = () => { show(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('sltext').value], { type: 'text/plain' })); a.download = 'my-slides.txt'; a.click(); URL.revokeObjectURL(a.href); };
}
