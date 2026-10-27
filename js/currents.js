// Ocean currents: a fixed teaching dataset (data/currents.json) drawn on the map, plus the "Ocean currents" tool in the Local tab.
// The tool finds the nearest current, the sea temperature offshore from the place (newest analysis), and compares water with air.
import { $, on, esc, fmtT, fmtD, compass, tempOut, tUnit } from './util.js';
import { setLocal } from './evid.js';
import { S, sample } from './data.js';
import { P, pastSeries } from './place.js';
import { view, hooks, map, redraw, flyTo } from './mapview.js';
import { nearestOnPolyline, destination } from './geo.js';
import { coastFor } from './coast.js';

export let CUR = null;
const COL = { warm: '#ff5a3c', cold: '#3aa0ff' };

export async function loadCurrents() { try { CUR = (await (await fetch('data/currents.json')).json()).currents; } catch { CUR = null; } }

const pathPts = (c, m) => c.paths.map(p => p.map(([la, lo]) => m.latLngToContainerPoint([la, lo])));
view.layers.currents = (g, m) => {
  if (!CUR || !$('cur') || !on('cur')) return;
  for (const c of CUR) {
    const col = COL[c.kind];
    for (const P0 of pathPts(c, m)) {
      for (const [lw, st, a] of [[8, '#000', .35], [4.5, col, .9]]) { g.globalAlpha = a; g.lineWidth = lw; g.strokeStyle = st; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); P0.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); }
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.2;
      let acc = 40;                                              // a chevron about every 150 px, pointing the way the water flows
      for (let i = 1; i < P0.length; i++) {
        const a = P0[i - 1], b = P0[i], d = Math.hypot(b.x - a.x, b.y - a.y); if (!d) continue; const ang = Math.atan2(b.y - a.y, b.x - a.x);
        while (acc <= d) { const x = a.x + Math.cos(ang) * acc, y = a.y + Math.sin(ang) * acc; g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.stroke(); g.restore(); acc += 150; }
        acc -= d;
      }
    }
    if (m.getZoom() >= 3) { // name at the middle of the longest path
      const P1 = pathPts(c, m).reduce((a, b) => b.length > a.length ? b : a), mid = P1[Math.floor(P1.length / 2)];
      if (mid.x > 0 && mid.y > 0 && mid.x < g.canvas.width && mid.y < g.canvas.height) { g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = col === COL.warm ? '#ffb4a3' : '#a9d4ff'; g.strokeText(c.name, mid.x, mid.y - 8); g.fillText(c.name, mid.x, mid.y - 8); }
    }
  }
};
const badge = c => `<span class="badge ${c.kind}">${c.kind === 'warm' ? 'WARM' : 'COLD'} current</span>`;
const noteFor = c => `${c.name} (${c.kind} current): ${c.desc} ${c.effects.join(' ')}`;
const info = c => `<b>${esc(c.name)}</b> ${badge(c)}<br>${esc(c.desc)}<ul class="eff">${c.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul><button class="pinbtn" data-topic="current" data-text="${esc(noteFor(c))}">📌 Add to notes</button>`;

function nearestCurrents(lat, lon, n = 3) {
  return CUR.map(c => { const best = c.paths.map(p => nearestOnPolyline(lat, lon, p)).reduce((a, b) => b.km < a.km ? b : a); return { c, ...best }; }).sort((a, b) => a.km - b.km).slice(0, n);
}

// ---- the Local-tab tool
const dT = c => Math.round(tempOut(c) - tempOut(0)) + tUnit();
export async function refreshCurrents() {
  const ok = !!(P.place && S.D && CUR); $('curbody').hidden = !ok; if (!ok) return;
  const pl = P.place, ser = pastSeries(pl), n = S.nPast - 1, air = ser.t[n], dew = ser.d[n], near = nearestCurrents(pl.lat, pl.lon), top = near[0];
  let coast = null; try { coast = await coastFor(pl); } catch { /* coastline files unavailable: skip the offshore sea-temperature part */ }
  const parts = [];
  parts.push(`<p><b>Nearest current:</b> ${esc(top.c.name)} ${badge(top.c)}<br>${esc(fmtD(top.km))} to the ${compass(top.toward)}. The water there flows toward the ${compass(top.flow)}.</p>
    <p>${esc(top.c.desc)}</p><ul class="eff">${top.c.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`);
  setLocal('cur', { name: top.c.name, kind: top.c.kind, km: top.km });
  const reach = top.km <= 400 ? 'This current is <b>close</b>: it can strongly change the air over your coast.' : top.km <= 1500 ? 'This current is <b>within reach</b>: winds blowing from the ocean toward you can bring its effects.' : 'This current is <b>far away</b>. Think about whether winds ever carry its air to you.';
  parts.push(`<p>${reach}</p>`);
  if (near.length > 1) parts.push(`<p class="small muted">Other currents nearby: ${near.slice(1).map(x => `${esc(x.c.name)} (${x.c.kind}, ${esc(fmtD(x.km))})`).join('; ')}.</p>`);
  let sea = null;
  if (S.D.sst && coast && !coast.onWater && coast.seaward != null && coast.km < 500) {   // first ocean value 60-400 km past the coast along the sea direction
    for (let d = coast.km + 60; d <= coast.km + 400 && sea == null; d += 60) { const q = destination(pl.lat, pl.lon, coast.seaward, d), v = sample(S.D.sst, q.lat, q.lon); if (!isNaN(v)) sea = { v, a: sample(S.D.sstA, q.lat, q.lon), d }; }
  }
  let cmp = '';
  if (sea) {
    const diff = air - sea.v, anomTxt = Math.abs(sea.a) < 1 ? 'about normal for this latitude' : `${dT(Math.abs(sea.a))} ${sea.a < 0 ? 'colder' : 'warmer'} than normal for this latitude`;
    const why = diff >= 2 ? `The air at your place (${fmtT(air)}) is <b>warmer than the water</b> (${fmtT(sea.v)}). Air moving over the water is cooled from below, so it becomes stable. ${dew > sea.v ? `The water is colder than the air’s dewpoint (${fmtT(dew)}), so <b>fog</b> can form when this air moves over it.` : 'Clouds and showers are less likely over the cool water.'}`
      : diff <= -2 ? `The water (${fmtT(sea.v)}) is <b>warmer than the air</b> (${fmtT(air)}). Warm water heats and moistens the air from below, so the air rises: <b>clouds and showers</b> are more likely, and coastal temperatures stay mild.`
      : `The water (${fmtT(sea.v)}) and the air (${fmtT(air)}) are close in temperature, so the water is not strongly warming or cooling the air right now.`;
    cmp = `<h4>Sea temperature near you</h4><p>About ${esc(fmtD(sea.d))} offshore (to the ${compass(coast.seaward)}): <b>${fmtT(sea.v)}</b>, ${anomTxt}.</p><p>${why}</p>`;
    parts.push(cmp);
  } else if (coast && !coast.onWater && coast.km >= 500) parts.push(`<p class="muted">Your place is ${esc(fmtD(coast.km))} from the sea, so currents affect it only through the winds.</p>`);
  const text = `${pl.name}: nearest current is the ${top.c.name} (${top.c.kind}), ${fmtD(top.km)} to the ${compass(top.toward)}. ${top.c.effects.join(' ')}` + (sea ? ` Sea temperature offshore ${fmtT(sea.v)} (${anomTxt0(sea.a)}); air ${fmtT(air)}.` : '');
  parts.push(`<button class="pinbtn" data-topic="current" data-text="${esc(text)}">📌 Add to notes</button>`);
  $('curres').innerHTML = parts.join('');
}
const anomTxt0 = a => Math.abs(a) < 1 ? 'about normal for the latitude' : `${dT(Math.abs(a))} ${a < 0 ? 'colder' : 'warmer'} than normal for the latitude`;

export function initCurrents() {
  $('curbody').innerHTML = `<div class="inline"><button id="curshow">🌀 Show currents and sea temperature on the map</button></div><div id="curres"></div>
    <p class="small muted">Current paths are a simplified teaching map of the major surface currents. Sea temperatures are NOAA GFS values on a 2° grid, so narrow currents look broader than they are.</p>`;
  $('curshow').onclick = () => {
    $('cur').checked = true; if (S.D && S.D.sst) { $('shade').value = 'sstA'; $('shade').dispatchEvent(new Event('change')); } else redraw();
    if (P.place) flyTo(P.place.lat, P.place.lon, 3);
  };
  $('cur').onchange = () => redraw();
  $('curres').addEventListener('click', e => { const b = e.target.closest('.pinbtn'); if (b) { document.dispatchEvent(new CustomEvent('pinnote', { detail: { topic: b.dataset.topic, text: b.dataset.text } })); b.textContent = '✓ Added to notes'; b.disabled = true; } });
  hooks.click.push((e, pt) => { // clicking a current shows what it is and what it does
    if (!CUR || !on('cur')) return false;
    for (const c of CUR) for (const P0 of pathPts(c, map)) for (let i = 1; i < P0.length; i++) {
      const a = P0[i - 1], b = P0[i], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) < 10) { L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(info(c)).openOn(map); return true; }
    }
    return false;
  });
}
