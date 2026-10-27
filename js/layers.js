// "Pick one thing to look at": each button sets the map's shading, lines and symbols for one topic so students don't
// have to combine a dozen settings. The individual controls (under "Change the map yourself") stay as the single source of truth.
import { $ } from './util.js';
import { S } from './data.js';

const BOXES = ['iso', 'h5l', 'hl', 'trk', 'wind', 'frd', 'fr', 'cur'];
const mk = (shade, ...on) => ({ shade, on });
export const PRESETS = {
  hl: { icon: '🌀', name: 'Highs & Lows', ...mk('p', 'iso', 'hl', 'trk'),
    what: 'Colors show <b>air pressure</b>: red = low, blue = high. White lines (<b>isobars</b>) connect places with the same pressure. <b>H</b> and <b>L</b> mark the centers, and dotted trails show where they have been.',
    look: 'Lows usually bring clouds and rain. Highs usually bring clear, calm weather. Lines packed close together mean strong wind.' },
  wind: { icon: '💨', name: 'Wind', ...mk('p', 'iso', 'hl', 'wind'),
    what: 'Arrows show the <b>wind direction</b> from the model. Longer arrows mean stronger wind. Colors and lines still show pressure.',
    look: 'In the Northern Hemisphere, wind spirals counterclockwise and inward around a Low, and clockwise and outward around a High. In the Southern Hemisphere it is the opposite.' },
  fr: { icon: '❄️', name: 'Fronts', ...mk('none', 'hl', 'frd', 'fr'),
    what: '<b>Fronts</b> are the boundaries between warm and cold air. The symbols point the way each front is moving.',
    look: 'When a cold front passes, expect a temperature drop, a wind shift and sometimes storms. Fronts usually stretch out from a Low.' },
  temp: { icon: '🌡', name: 'Temperature', ...mk('t', 'hl'),
    what: 'Colors show the <b>air temperature</b> near the ground.',
    look: 'Temperature often changes quickly across a front. Compare this map with the Fronts view.' },
  rain: { icon: '🌧', name: 'Rain', ...mk('pr', 'hl', 'frd'),
    what: 'Colors show how much <b>rain or melted snow</b> fell in the 6 hours before the time on the slider. Green = light, yellow and orange = heavy, red and purple = very heavy.',
    look: 'Compare the rain with the Lows and fronts. Where do they line up?' },
  jet: { icon: '🛩', name: 'Jet stream', ...mk('w5', 'h5l'),
    what: 'Colors show <b>wind speed about 18,000 ft up</b>. Dashed purple lines show the jet stream’s dips (<b>troughs</b>) and bulges (<b>ridges</b>).',
    look: 'Storms at the surface tend to form under dips and travel along the fastest wind (red and pink).' },
  ocean: { icon: '🌊', name: 'Ocean', ...mk('sstA', 'cur'),
    what: 'Colored bands show where the sea is <b>warmer or colder than normal</b> for its latitude. Lines show the major <b>ocean currents</b> (red = warm, blue = cold). Click a current to read about it.',
    look: 'Warm currents warm the air and coasts nearby. Cold currents cool the air and often bring fog.' },
};
const state = () => ({ shade: $('shade').value, on: BOXES.filter(id => $(id).checked) });
const same = (p, s) => p.shade === s.shade && p.on.length === s.on.length && p.on.every(id => s.on.includes(id));
export const current = () => Object.keys(PRESETS).find(k => same(PRESETS[k], state())) || null;

function show() {   // light up the matching button, describe it, and show the front key when fronts are on
  const k = current(), p = PRESETS[k];
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === k)));
  $('pdesc').innerHTML = p ? `<p>${p.what}</p><p><b>Look for:</b> ${p.look}</p>` : '<p>This is a <b>custom view</b> you made with the options below. Press a button above to start over.</p>';
  $('frkey').hidden = !($('fr').checked || $('frd').checked);
}
export function applyPreset(k) {
  const p = PRESETS[k]; if (!p) return;
  const sst = S.D && S.D.sst;
  $('shade').value = !sst && /^sst/.test(p.shade) ? 'none' : p.shade;
  BOXES.forEach(id => $(id).checked = p.on.includes(id));
  $('shade').dispatchEvent(new Event('change', { bubbles: true }));   // redraws and saves
}
export function initLayers() {
  $('presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" aria-pressed="false"><span class="pi">${p.icon}</span>${p.name}</button>`).join('');
  $('presets').onclick = e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.p); };
  $('tab-explore').addEventListener('change', show);
  if (!current()) applyPreset('hl'); else show();   // first visit starts on the simplest view; a saved view is kept
}
export const refreshPresets = show;
