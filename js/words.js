// 📖 Word bank: the weather words students need to use in their presentation. The English word always stays visible (they will say it in
// English); the translated word and definition show beside it when another language is chosen.
import { $, esc } from './util.js';
import { openModal, closeModal } from './shell.js';

const WORDS = [
  ['Pressure and wind', [
    ['🔵', 'High', 'A place where the air pressure is higher than the air around it. Air sinks, so skies are usually clear and calm.', 'The High is ___ miles from my city, so the sky will be ___.'],
    ['🔴', 'Low', 'A place where the air pressure is lower than the air around it. Air rises, so clouds and rain are more likely.', 'The Low is moving toward ___, so I expect ___.'],
    ['⏲️', 'Air pressure', 'The weight of the air pushing down on us. We measure it in hPa (hectopascals).', 'The pressure is ___ (rising or falling), so the weather is ___.'],
    ['〰️', 'Isobar', 'A line on the map that connects places with the same air pressure. Lines close together mean strong wind.', 'The isobars are ___ together, so the wind is ___.'],
    ['🧭', 'Wind direction', 'The direction the wind comes FROM. A west wind blows from the west toward the east.', 'The wind is from the ___ at ___ miles per hour.'],
    ['🛩️', 'Jet stream', 'A fast river of air high above the ground (about 18,000 ft). It steers Lows and fronts.', 'The jet stream is over ___, so the storm will move ___.']]],
  ['Moisture', [
    ['💧', 'Dewpoint', 'The temperature at which air is full of water vapor and clouds or fog form. If the air temperature is close to the dewpoint, clouds are likely.', 'The temperature is ___ degrees from the dewpoint, so clouds are ___.']]],
  ['Fronts and troughs', [
    ['🔷', 'Cold front', 'The edge of a cold air mass moving in. It often brings storms, then cooler temperatures and a wind shift.', 'After the cold front passes, the temperature will ___.'],
    ['🔶', 'Warm front', 'The edge of a warm air mass moving in. It often brings steady rain, then warmer weather.', 'The warm front will bring ___, then ___ air.'],
    ['🟣', 'Occluded front', 'A cold front that has caught up to a warm front. It often brings clouds and rain.', 'An occluded front is ___ miles away, so the sky will be ___.'],
    ['⏸️', 'Stationary front', 'A front that is not moving. It can bring clouds and rain for days.', 'The stationary front will stay over ___ for ___ days.'],
    ['📉', 'Trough', 'A stretched-out area of low pressure, or a dip in the jet stream. It often brings clouds and rain.', 'A trough is ___, so I expect ___.'],
    ['📈', 'Ridge', 'A stretched-out area of high pressure, or a bulge in the jet stream. It often brings clear weather.', 'A ridge is over ___, so the weather will be ___.']]],
  ['Mountains, coast and ocean', [
    ['⛰️', 'Windward', 'The side of a mountain that the wind hits first. Air rises and cools, so it is cloudier and wetter.', 'My city is on the ___ side, so it will be ___.'],
    ['🏜️', 'Leeward', 'The side of a mountain away from the wind. Air sinks and warms, so it is drier and warmer.', 'My city is on the ___ side, so it will be ___.'],
    ['🌵', 'Rain shadow', 'A dry area on the leeward side of mountains.', 'My city is in a rain shadow because ___.'],
    ['🌊', 'Sea breeze', 'On a sunny day, cooler air from the sea moves toward the warmer land.', 'In the ___ a sea breeze will blow from the ___.'],
    ['🌙', 'Land breeze', 'At night, cooler air from the land moves toward the warmer sea.', 'At night a land breeze will blow from the ___ toward the ___.'],
    ['🌀', 'Ocean current', 'A large stream of ocean water. Warm currents warm the air above them. Cold currents cool it.', 'The ___ current is ___ (warm or cold), so my air will be ___.']]],
  ['Forecasting', [
    ['📅', 'Forecast', 'A prediction of future weather, based on evidence.', 'My forecast for ___ is ___ with a ___ percent chance of ___.'],
    ['🔍', 'Evidence', 'Facts from the map, charts or notes that support your forecast.', 'My evidence is ___, which shows ___.']]],
];
export function initWords() {
  $('wbbody').innerHTML = WORDS.map(([g, list]) => `<h4>${g}</h4>` + list.map(([em, term, def, say]) => `<div class="wb"><div class="wbt"><span aria-hidden="true">${em}</span><b data-i18n-skip>${esc(term)}</b><span class="wbtr">${esc(term)}</span></div>
    <p class="wbd">${esc(def)}</p><p class="wbx" data-i18n-skip><i>Say:</i> “${esc(say)}”</p></div>`).join('')).join('');
  $('wordsbtn').onclick = () => openModal('words'); $('wbclose').onclick = () => closeModal('words');
}
