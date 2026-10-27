// "Quiz me": click-the-High/Low/front questions on the live map, plus concept questions.
import { $ } from './util.js';
import { S, frameInfo } from './data.js';
import { applyPreset } from './layers.js';
import { view, hooks, map, redraw, frontLines, frType, frLines } from './mapview.js';

export const CONCEPTS = [
  { q: 'In the Northern Hemisphere, winds around a LOW blow…', o: ['clockwise and outward', 'counterclockwise and inward', 'straight toward the High', 'in no set pattern'], a: 1, why: 'Air flows toward low pressure and Earth’s rotation bends it right, giving a counterclockwise, inward spiral.' },
  { q: 'In the Southern Hemisphere, winds around a LOW blow…', o: ['clockwise and inward', 'counterclockwise and inward', 'clockwise and outward', 'counterclockwise and outward'], a: 0, why: 'South of the equator Earth’s rotation bends moving air to the left, so everything flips: clockwise and inward around a Low.' },
  { q: 'Isobars packed closely together mean…', o: ['light wind', 'strong wind', 'no clouds', 'a front is present'], a: 1, why: 'Tight isobars = a steep pressure gradient, which drives stronger wind.' },
  { q: 'Which usually brings clear, calm weather?', o: ['A Low', 'A High', 'A trough', 'An occluded front'], a: 1, why: 'Air sinks in a High, which suppresses clouds.' },
  { q: 'What usually happens as a cold front passes?', o: ['Temperature rises', 'Temperature drops and winds shift', 'Pressure keeps falling', 'Skies stay clear'], a: 1, why: 'Cold, dense air replaces warm air; lifting ahead of the front often triggers showers or storms.' },
  { q: 'Winds around a HIGH in the Northern Hemisphere are…', o: ['clockwise and outward', 'counterclockwise and outward', 'clockwise and inward', 'counterclockwise and inward'], a: 0, why: 'Air flows out of a High and is bent right: clockwise, spiraling outward.' },
  { q: 'Where is the jet stream strongest at 500 mb?', o: ['Where height lines are far apart', 'Where height lines are packed tightly', 'Directly over a High', 'Only near the equator'], a: 1, why: 'Like isobars, closely spaced height lines mean a steep gradient and fast wind.' },
  { q: 'Surface Lows often develop…', o: ['under a ridge in the jet stream', 'under a trough (dip) in the jet stream', 'only over oceans', 'where the air is calm'], a: 1, why: 'Upper-level troughs help lift air, which lowers surface pressure underneath.' },
  { q: 'On a sunny afternoon at the coast, a sea breeze blows…', o: ['from the land toward the sea', 'from the sea toward the land', 'along the coast only', 'straight up'], a: 1, why: 'Land heats faster than water. Air rises over the warm land, and cooler, denser air from the sea flows in to replace it.' },
  { q: 'At night the land cools faster than the sea. The breeze then blows…', o: ['from the land toward the sea', 'from the sea toward the land', 'there is never a breeze', 'only upward'], a: 0, why: 'The sea is now the warmer surface, so air rises over the water and cooler land air flows out to replace it: a land breeze.' },
  { q: 'Rain is usually heaviest on the…', o: ['windward side of mountains', 'leeward side of mountains', 'top of flat plains', 'center of a High'], a: 0, why: 'Wind pushes moist air up the windward slope. It cools, its water vapor condenses, and clouds and rain form.' },
  { q: 'Why is the leeward side of a mountain range usually dry?', o: ['Sinking air warms and dries out', 'Rising air cools', 'The ocean is always far away', 'It is always colder'], a: 0, why: 'After losing moisture on the windward side, the air sinks down the other side, warms and dries — a rain shadow.' },
  { q: 'A cold ocean current along a coast usually makes the nearby land…', o: ['cooler, foggy and dry', 'warm and very rainy', 'hotter and more humid', 'stormy all year'], a: 0, why: 'Air cooled by cold water is stable and holds little moisture; fog forms, but rain is rare (the Atacama and Namib deserts sit beside cold currents).' },
  { q: 'Western Europe is milder than places at the same latitude in Canada. Which current helps most?', o: ['The warm North Atlantic Drift (Gulf Stream)', 'The cold Labrador Current', 'The cold Humboldt Current', 'No current matters'], a: 0, why: 'Warm water carried north warms the air above it, and westerly winds bring that warmth onto the land.' },
];
let Q = null; const score = [0, 0], pick = a => a[Math.floor(Math.random() * a.length)];
const inView = e => map.getBounds().contains([e.lat, e.lon]);
const fronts = () => S.cur === S.nPast - 1 ? frontLines() : null;

export function nextQ() {
  view.hint = null; const ex = frameInfo(S.cur).ex.filter(inView), pool = [], fr = fronts();
  ['H', 'L'].forEach(t => ex.some(e => e.t === t) && pool.push({ k: 'pt', t }));
  if (fr) ['Cold Front', 'Warm Front'].forEach(t => fr.some(f => frType(f) === t) && pool.push({ k: 'fr', t }));
  CONCEPTS.forEach(c => pool.push({ k: 'mc', ...c }));
  Q = pick(pool); Q.done = false; const b = $('qbox'); $('qgo').textContent = 'Next question';
  if (Q.k === 'fr' && !$('fr').checked) applyPreset('fr');   // the question needs the forecasters' fronts showing
  if (Q.k === 'pt') b.innerHTML = `Click the center of a <b>${Q.t === 'H' ? 'High' : 'Low'}</b>-pressure system on the map.<p><button data-show>Show me where</button></p>`;
  else if (Q.k === 'fr') b.innerHTML = `Click on a <b>${Q.t.toLowerCase()}</b>.<p><button data-show>Show me where</button></p>`;
  else b.innerHTML = `<b>${Q.q}</b>` + Q.o.map((o, i) => `<button data-i="${i}">${o}</button>`).join('');
  redraw();
}
function result(ok, msg) {
  Q.done = ok || Q.done; if (!Q.tried) { score[1]++; if (ok) score[0]++; } Q.tried = true;   // only the first attempt counts
  $('score').textContent = `Score: ${score[0]} right out of ${score[1]} (first tries only)`;
  $('qbox').innerHTML += `<p class="${ok ? 'ok' : 'no'}">${ok ? '✔ ' : '✘ '}${msg}</p>`;
}
function answerClick(e) {
  let ok = false, msg;
  if (Q.k === 'pt') {
    const hit = frameInfo(S.cur).ex.find(v => v.t === Q.t && Math.hypot(v.lat - e.latlng.lat, (v.lon - e.latlng.lng) * Math.cos(v.lat * Math.PI / 180)) < 7);
    ok = !!hit; msg = ok ? `That ${Q.t === 'H' ? 'High' : 'Low'} is about ${Math.round(hit.v)} hPa. Press “Next question” to continue.` :
      `Look for the ${Q.t === 'H' ? 'highest' : 'lowest'} pressure — closed isobar circles around an ${Q.t}. Try again or press “Show me where”.`;
  } else {
    const pt = map.latLngToContainerPoint(e.latlng);
    ok = fronts().filter(f => frType(f) === Q.t).some(f => frLines(f, map).some(P => P.some((p, i) => {
      if (!i) return false; const a = P[i - 1], dx = p.x - a.x, dy = p.y - a.y, t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) < 25; })));
    msg = ok ? 'Yes — blue lines with triangles are cold fronts; the triangles point the way the front moves.' : `Not on one. ${Q.t === 'Cold Front' ? 'Cold fronts are blue with triangles.' : 'Warm fronts are red with semicircles.'}`;
  }
  result(ok, msg); if (ok) { view.hint = null; redraw(); }
}
export function initQuiz() {
  $('qgo').onclick = nextQ;
  $('qbox').onclick = e => {
    const b = e.target.closest('button'); if (!b || !Q) return;
    if ('show' in b.dataset) {
      if (Q.k === 'pt') { const x = frameInfo(S.cur).ex.find(v => v.t === Q.t && inView(v)); view.hint = { ll: [x.lat, x.lon] }; }
      else view.hint = { feat: fronts().find(f => frType(f) === Q.t) };
      return redraw();
    }
    if (Q.k === 'mc' && !Q.done) { const ok = +b.dataset.i === Q.a; result(ok, ok ? Q.why : 'Not quite — try another answer.'); if (ok) Q.done = true; }
  };
  hooks.click.push(e => { if (Q && (Q.k === 'pt' || Q.k === 'fr') && !Q.done) { answerClick(e); return true; } return false; });
  document.addEventListener('frame', () => { if (Q && Q.k !== 'mc') nextQ(); });
}
