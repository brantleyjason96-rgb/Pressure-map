import { $, U, setUnits } from './util.js';
import { S, loadData } from './data.js';
import { initMap, setFrame, loadFronts } from './mapview.js';
import { initPlace } from './place.js';
import { initNotes } from './notes.js';
import { initTeacher } from './teacher.js';
import { initQuiz } from './quiz.js';
import { initTerrain, refreshMountains } from './terrain.js';
import { initCoast, refreshCoast } from './coast.js';
import { P } from './place.js';
import { initCurrents, refreshCurrents, loadCurrents } from './currents.js';
import { initTools } from './tools.js';

// tabs
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + b.dataset.tab);
  $('side').scrollTop = 0; document.dispatchEvent(new CustomEvent('tabshow', { detail: b.dataset.tab }));
  if (window.innerWidth <= 800) window.scrollTo(0, 0);
  setTimeout(() => import('./mapview.js').then(m => m.map.invalidateSize()), 0);
});
$('units').value = U.sys; $('units').onchange = e => setUnits(e.target.value);

initMap();
initTeacher();
(async () => {
  try {
    const D = await loadData();
    $('slider').max = S.hours.length - 1;
    $('st').textContent = 'Model analysis through ' + new Date(Date.parse(D.cycle)).toUTCString().slice(5, 22) + ' UTC';
    if (D.sample) $('samplebanner').hidden = false;
    initQuiz(); initPlace(); initNotes(); initTerrain(); initCoast(); initCurrents(); initTools();
    await loadCurrents();
    if (!D.sst) document.querySelectorAll('#shade option[value=sst], #shade option[value=sstA]').forEach(o => o.remove());   // this data file has no sea temperature
    // the local-effects tools fetch data, so they only run while that tab is open and the place has changed
    let dirty = true; const local = () => !$('tab-local').hidden;
    const run = () => { dirty = false; $('lplace').textContent = P.place ? 'Place: ' + P.place.name : ''; refreshMountains(); refreshCoast(); refreshCurrents(); };
    document.addEventListener('placechange', () => { dirty = true; if (local()) run(); });
    document.addEventListener('tabshow', e => { if (e.detail === 'local' && dirty) run(); });
    setFrame(S.cur);
    loadFronts();
  } catch (e) { $('st').textContent = 'Could not load the weather data: ' + e.message; }
})();
