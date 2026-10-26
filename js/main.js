import { $, U, setUnits, store } from './util.js';
import { S, loadData } from './data.js';
import { initMap, setFrame, loadFronts, view, redraw } from './mapview.js';
import { initPlace, P } from './place.js';
import { initNotes } from './notes.js';
import { initTeacher } from './teacher.js';
import { initQuiz } from './quiz.js';
import { initTerrain, refreshMountains } from './terrain.js';
import { initCoast, refreshCoast } from './coast.js';
import { initCurrents, refreshCurrents, loadCurrents } from './currents.js';
import { initTools } from './tools.js';
import { initPredict } from './predict.js';
import { initShell, openModal } from './shell.js';
import { initSession, restoreUI } from './session.js';

$('units').value = U.sys; $('units').onchange = e => setUnits(e.target.value);
if ($('ver').textContent.includes('__BUILD__')) $('ver').textContent = 'local copy (not published)';

initMap();
initTeacher();
initShell();
(async () => {
  try {
    const D = await loadData();
    $('slider').max = S.hours.length - 1;
    $('st').textContent = 'Model analysis through ' + new Date(Date.parse(D.cycle)).toUTCString().slice(5, 22) + ' UTC';
    if (D.sample) $('samplebanner').hidden = false;
    initQuiz(); initPlace(); initNotes(); initTerrain(); initCoast(); initCurrents(); initTools(); initPredict();
    initSession();
    await loadCurrents();
    if (!D.sst) document.querySelectorAll('#shade option[value=sst], #shade option[value=sstA]').forEach(o => o.remove());   // this data file has no sea temperature
    // the local-effects tools fetch data, so they only run while that tab is open and the place has changed
    let dirty = true; const local = () => !$('tab-local').hidden;
    const run = () => { dirty = false; $('lempty').hidden = !!P.place; $('lplace').textContent = P.place ? 'Place: ' + P.place.name : ''; refreshMountains(); refreshCoast(); refreshCurrents(); };
    document.addEventListener('placechange', () => { dirty = true; if (local()) run(); });
    document.addEventListener('tabshow', e => {
      view.localOn = e.detail === 'local'; view.predictOn = e.detail === 'predict';
      if (view.predictOn && S.cur !== S.nPast - 1 && (!S.teacher || S.cur < S.nPast)) setFrame(S.nPast - 1);   // a projection always starts from the newest map
      redraw(); if (e.detail === 'local' && dirty) run();
    });
    setFrame(S.cur);
    restoreUI();
    loadFronts();
    $('loading').hidden = true;
    if (!store.get('seenHelp', false)) { openModal('help'); store.set('seenHelp', true); }
  } catch (e) {
    $('st').textContent = 'Could not load the weather data.';
    $('loading').innerHTML = `Could not load the weather data (${e.message}).<br><button class="primary" onclick="location.reload()">Try again</button>`;
  }
})();
