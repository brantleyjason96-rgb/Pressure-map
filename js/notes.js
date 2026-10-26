// "My Notes": a place to collect evidence while they work, organized by the five concepts, for a presentation they build elsewhere.
// Nothing here is a forecast form and nothing is pre-filled from the model. "Pin" buttons copy what the map shows into the notes.
import { $, esc, store, fmtT, fmtElev } from './util.js';
import { S, frameTime } from './data.js';
import { P } from './place.js';

export const TOPICS = [
  { k: 'general', icon: '📝', name: 'General', ask: 'Anything else: your place, what you noticed, questions, ideas for your slides.', frames: [] },
  { k: 'hl', icon: '🔵', name: 'Highs and Lows', ask: 'Which High or Low controls my weather? Where is it going, and what will it do to my pressure and sky?',
    frames: ['The nearest ___ is ___ away and moving toward the ___.', 'Because pressure is ___, the sky will be ___.', 'On Day ___ the ___ will be over my place, so the weather will be ___.'] },
  { k: 'front', icon: '🟦', name: 'Fronts', ask: 'Will a front reach my place? When? What changes when it passes?',
    frames: ['A ___ front is ___ away and moving about ___.', 'It will reach my place on Day ___ because distance ÷ speed = ___ hours.', 'After it passes, the temperature will ___ and the wind will change from ___ to ___.'] },
  { k: 'breeze', icon: '🌊', name: 'Land Breeze and Sea Breeze', ask: 'Is my place near a coast or a big lake? When will a breeze blow, and from where?',
    frames: ['My place is near ___, so a ___ breeze can happen.', 'In the daytime the land heats ___ than the water, so air moves from the ___ to the ___.', 'At night the land cools ___, so the breeze blows from the ___.'] },
  { k: 'oro', icon: '⛰️', name: 'Windward and Leeward', ask: 'Which way is the wind blowing compared with the mountains? Is my place on the windward or leeward side?',
    frames: ['The wind comes from the ___, so my place is on the ___ side.', 'Air that is forced up the mountain ___ and cools, so clouds and rain form on the ___ side.', 'Air that sinks on the other side ___, so it is ___ and dry (a rain shadow).'] },
  { k: 'current', icon: '🌀', name: 'Ocean Currents', ask: 'What is the nearest ocean current? Is it warm or cold? How does it change my air?',
    frames: ['The nearest ocean current is the ___ current, and it is ___ (warm / cold).', 'Air over it becomes ___ and ___, so my place will be ___.', 'This is why my temperatures are ___ than other places at the same latitude.'] },
];
let N = Object.assign({ student: '', items: [], seq: 0, group: 'topic' }, store.get('notes', {}));
const save = () => { store.set('notes', N); cover(); document.dispatchEvent(new Event('noteschanged')); };
export const noteCount = () => N.items.length;
export const getNotes = () => N;
const stamp = () => frameTime(S.nPast - 1).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const topic = k => TOPICS.find(t => t.k === k) || TOPICS[0];

function cover() { // how many notes per topic: a nudge, not a gate
  $('ncover').innerHTML = TOPICS.slice(1).map(t => { const n = N.items.filter(i => i.k === t.k).length; return `<span class="chip ${n ? 'has' : ''}">${t.icon} ${esc(t.name)} <b>${n}</b></span>`; }).join('');
  $('nplace').textContent = P.place ? `Place: ${P.place.name}` : 'No place chosen yet — pick one on the My Place tab.';
}
const dayKey = t => t ? new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : 'Earlier';
const addedAt = t => t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const noteHTML = i => `
      <div class="note" data-id="${i.id}">
        <span class="pinned">${i.pin ? '📌 map data from ' + esc(i.when) + ' · ' : ''}${i.created ? 'added ' + esc(addedAt(i.created)) : ''}${N.group === 'day' ? ' · ' + esc(topic(i.k).name) : ''}</span>
        <textarea rows="${Math.min(8, Math.max(2, Math.ceil(i.text.length / 40)))}" data-id="${i.id}" aria-label="Note: ${esc(topic(i.k).name)}">${esc(i.text)}</textarea>
        <button class="ghost del" data-del="${i.id}" title="Delete this note">Delete</button>
      </div>`;
function renderList() {
  let groups;
  if (N.group === 'day') { const m = new Map(); [...N.items].sort((a, b) => (b.created || 0) - (a.created || 0)).forEach(i => { const k = dayKey(i.created); (m.get(k) || m.set(k, []).get(k)).push(i); }); groups = [...m].map(([name, items]) => ({ name: '📅 ' + name, items })); }
  else groups = TOPICS.map(t => ({ name: `${t.icon} ${t.name}`, items: N.items.filter(i => i.k === t.k) }));
  $('nlist').innerHTML = groups.filter(g => g.items.length).map(g => `<details class="topic" open><summary>${esc(g.name)} <small class="muted">(${g.items.length})</small></summary>${g.items.map(noteHTML).join('')}</details>`).join('')
    || '<p class="empty small">No notes yet. Write one above, or use the 📌 buttons on the map and the other tabs to save evidence.</p>';
  cover();
}
function add(k, text, pin) {
  text = text.trim(); if (!text) return;
  N.items.push({ id: ++N.seq, k, text, pin: !!pin, when: stamp(), created: Date.now() }); save(); renderList();
}
const plain = () => {
  const pl = P.place, nm = P.normals, lines = [`WEATHER NOTES — ${N.student || '(name)'}`];
  if (pl) lines.push(`Place: ${pl.name} (${pl.lat.toFixed(2)}, ${pl.lon.toFixed(2)}), elevation ${fmtElev(pl.elev)}`);
  if (pl && nm && nm !== 'loading' && nm !== 'error') lines.push(`Normal for this time of year: high ${fmtT(nm.hi)}, low ${fmtT(nm.lo)}`);
  lines.push(`Map data: model analysis through ${S.D ? new Date(Date.parse(S.D.cycle)).toUTCString() : ''}${S.D && S.D.sample ? ' (SAMPLE DATA)' : ''}`, '');
  TOPICS.forEach(t => { const items = N.items.filter(i => i.k === t.k); if (items.length) { lines.push(`== ${t.name} ==`); items.forEach(i => lines.push(`- ${i.text.replace(/\n+/g, ' ')}`)); lines.push(''); } });
  return lines.join('\n');
};
function printNotes() {
  const pl = P.place, nm = P.normals, ok = nm && nm !== 'loading' && nm !== 'error';
  $('printReport').innerHTML = `<h1>My Weather Notes</h1><p><b>Name:</b> ${esc(N.student) || '________________'} &nbsp; <b>Place:</b> ${pl ? esc(pl.name) + ` (${pl.lat.toFixed(2)}, ${pl.lon.toFixed(2)}, ${esc(fmtElev(pl.elev))})` : '—'}</p>
    ${ok ? `<p><b>Normal for this time of year:</b> high ${fmtT(nm.hi)}, low ${fmtT(nm.lo)}</p>` : ''}
    <p class="small">Map data: model analysis through ${S.D ? new Date(Date.parse(S.D.cycle)).toUTCString().replace(':00:00 GMT', ' UTC') : ''}${S.D && S.D.sample ? ' (SAMPLE DATA)' : ''}</p>` +
    TOPICS.map(t => { const items = N.items.filter(i => i.k === t.k); return items.length ? `<h2>${t.icon} ${esc(t.name)}</h2>` + items.map(i => `<div class="rc"><p>${i.pin ? '📌 ' : ''}${esc(i.text).replace(/\n/g, '<br>')}</p></div>`).join('') : ''; }).join('');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); document.body.classList.add('printing'); setTimeout(() => window.print(), 50);
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const fname = () => (N.student || 'my').replace(/\W+/g, '_');

export function initNotes() {
  $('ngroup').value = N.group; $('ngroup').onchange = e => { N.group = e.target.value; save(); renderList(); };
  $('nname').value = N.student; $('nname').oninput = e => { N.student = e.target.value; save(); };
  $('ntopic').innerHTML = TOPICS.map(t => `<option value="${t.k}">${t.icon} ${esc(t.name)}</option>`).join('');
  const showAsk = () => { const t = topic($('ntopic').value); $('nask').textContent = t.ask; $('nframes').innerHTML = t.frames.map((f, j) => `<button type="button" data-j="${j}">${esc(f)}</button>`).join(''); };
  $('ntopic').onchange = showAsk; showAsk();
  $('nframes').onclick = e => { const b = e.target.closest('button'); if (!b) return; const ta = $('ntext'); ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + topic($('ntopic').value).frames[+b.dataset.j]; ta.focus(); };
  $('nadd').onclick = () => { add($('ntopic').value, $('ntext').value, false); $('ntext').value = ''; };
  $('nlist').addEventListener('input', e => { const i = N.items.find(x => x.id === +e.target.dataset.id); if (i) { i.text = e.target.value; store.set('notes', N); } });
  $('nlist').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b && confirm('Delete this note?')) { N.items = N.items.filter(i => i.id !== +b.dataset.del); save(); renderList(); } });
  $('ncopy').onclick = async () => { try { await navigator.clipboard.writeText(plain()); $('ncopy').textContent = '✓ Copied'; setTimeout(() => $('ncopy').textContent = 'Copy all notes', 1500); } catch { alert('Copy was blocked. Use “Download notes” instead.'); } };
  $('ndl').onclick = () => download(`notes-${fname()}.txt`, plain(), 'text/plain');
  $('nprint').onclick = printNotes;
  $('nclear').onclick = () => { if (confirm('Delete ALL my notes?')) { N = { student: N.student, items: [], seq: 0 }; save(); renderList(); } };
  // "pin" buttons elsewhere (map popups, place card) send their text here
  document.addEventListener('pinnote', e => { add(e.detail.topic, e.detail.text, true); });
  document.addEventListener('placechange', cover);
  renderList();
}
