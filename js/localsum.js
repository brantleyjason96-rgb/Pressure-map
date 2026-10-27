// Top of the Local tab: which of the three local effects matter at the student's place, so they open the right tool and save a note for it.
import { $, esc, fmtD } from './util.js';
import { LS } from './evid.js';
import { getNotes } from './notes.js';
import { P } from './place.js';

const NOTE_TOPIC = { oro: 'oro', coast: 'breeze', cur: 'current' }, TOOL = { oro: 'ltop-oro', coast: 'ltop-coast', cur: 'ltop-cur' };
export function status() {   // 'yes' | 'maybe' | 'no' | null (not worked out yet) for each effect
  const o = LS.oro, c = LS.coast, u = LS.cur;
  return {
    oro: !o ? null : ({ windward: 'yes', leeward: 'yes', crest: 'yes', far: 'maybe' }[o.kind] || 'no'),
    coast: !c ? null : c.over ? 'no' : c.km <= 50 ? 'yes' : c.km <= 150 ? 'maybe' : 'no',
    cur: !u ? null : u.km <= 400 ? 'yes' : u.km <= 1500 ? 'maybe' : 'no',
  };
}
export const noted = k => getNotes().items.filter(i => i.k === NOTE_TOPIC[k]).length;
const STATE = { yes: 'Applies to my place', maybe: 'Might apply', no: 'Probably does not apply' };
const ORO = { windward: 'Windward side', leeward: 'Leeward side', crest: 'On the crest of the mountains', far: 'The mountains are far away', flat: 'No mountains in the way' };
function detail(k) {   // facts only: the student works out what they mean
  if (k === 'oro') return ORO[LS.oro.kind] || ORO.flat;
  if (k === 'coast') return LS.coast.over ? 'This place is over water' : `Water is about ${fmtD(LS.coast.km)} away`;
  return `— a ${LS.cur.kind} current, ${fmtD(LS.cur.km)} away`;
}
const NAME = { oro: ['⛰️', 'Mountains'], coast: ['🌊', 'Coast'], cur: ['🌀', 'Ocean current'] };
function render() {
  const el = $('lsum'); if (!P.place) { el.innerHTML = ''; return; }
  const st = status();
  el.innerHTML = '<h4>Which local effects matter at my place?</h4>' + ['oro', 'coast', 'cur'].map(k => {
    const s = st[k], n = noted(k);
    return `<div class="lchip ${s || ''}"><div class="lh"><span>${NAME[k][0]} <b>${NAME[k][1]}</b></span><span class="st">${s ? STATE[s] : 'Checking…'}</span></div>
      ${s ? `<div class="ld">${k === 'cur' ? `<b data-i18n-skip>${esc(LS.cur.name)}</b> ` : ''}<span>${esc(detail(k))}</span></div>` : ''}
      <div class="lb"><button class="ghost" data-open="${k}">Open this tool ▶</button><span class="${n ? 'ok' : 'muted'}">${n ? '✓ Note saved' : 'No note yet'}</span></div></div>`;
  }).join('');
}
export function initLocalSum() {
  $('lsum').onclick = e => { const b = e.target.closest('[data-open]'); if (!b) return; const d = $(TOOL[b.dataset.open]); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  for (const ev of ['localsummary', 'placechange', 'noteschanged']) document.addEventListener(ev, render);
  render();
}
