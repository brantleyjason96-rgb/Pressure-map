import { $, U, setUnits } from './util.js';
import { S, loadData } from './data.js';
import { initMap, setFrame, loadFronts } from './mapview.js';
import { initPlace } from './place.js';
import { initForecast } from './forecast.js';
import { initTeacher } from './teacher.js';
import { initQuiz } from './quiz.js';

// tabs
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + b.dataset.tab);
  $('side').scrollTop = 0;
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
    initQuiz(); initPlace(); initForecast();
    setFrame(S.cur);
    loadFronts();
  } catch (e) { $('st').textContent = 'Could not load the weather data: ' + e.message; }
})();
