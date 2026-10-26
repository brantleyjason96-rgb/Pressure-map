// The frame around the map: tabs, hiding the side panel (with a dock to bring it back), dialogs, toasts and the little badges.
import { $ } from './util.js';
import { map, flyTo } from './mapview.js';
import { noteCount } from './notes.js';
import { P } from './place.js';

const TABS = ['explore', 'place', 'local', 'predict', 'notes', 'teacher'];
export const currentTab = () => TABS.find(t => !$('tab-' + t).hidden);
export const isCollapsed = () => $('app').classList.contains('collapsed');

export function setCollapsed(v) {
  $('app').classList.toggle('collapsed', v); $('dock').hidden = !v; $('hide').setAttribute('aria-expanded', String(!v));
  setTimeout(() => map && map.invalidateSize(), 260); document.dispatchEvent(new Event('layout'));
}
export function goTab(name, { expand = true } = {}) {
  if (expand && isCollapsed()) setCollapsed(false);
  document.querySelectorAll('#tabs button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + name);
  $('side').scrollTop = 0; if (window.innerWidth <= 800) window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('tabshow', { detail: name }));
}
let toastT;
export function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

// ---- dialogs: Escape and the backdrop close them, Tab stays inside, focus returns to where it was
let lastFocus = null;
export function openModal(id) {
  const m = $(id); lastFocus = document.activeElement; m.hidden = false;
  const first = m.querySelector('input:not([type=hidden]), button.primary, button'); if (first) setTimeout(() => first.focus(), 30);
}
export function closeModal(id) { $(id).hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); document.dispatchEvent(new CustomEvent('modalclosed', { detail: id })); }
const openModalEl = () => [...document.querySelectorAll('.modal')].find(m => !m.hidden);

export function initShell() {
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => goTab(b.dataset.tab));
  $('tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const bs = [...document.querySelectorAll('#tabs button')].filter(b => !b.hidden), i = bs.findIndex(b => b.dataset.tab === currentTab());
    const n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; goTab(n.dataset.tab); n.focus(); e.preventDefault();
  });
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) goTab(g.dataset.go); });
  document.querySelectorAll('[data-dock]').forEach(b => b.onclick = () => goTab(b.dataset.dock));
  $('hide').onclick = () => setCollapsed(true);
  $('notechip').onclick = () => goTab('notes');
  $('goplace').onclick = () => { if (P.place) flyTo(P.place.lat, P.place.lon, 6); else { toast('Choose your place first'); goTab('place'); } };
  $('helpbtn').onclick = () => openModal('help'); $('helpclose').onclick = () => closeModal('help');
  document.addEventListener('keydown', e => {
    const m = openModalEl(); if (!m) return;
    if (e.key === 'Escape') closeModal(m.id);
    if (e.key === 'Tab') { const f = [...m.querySelectorAll('input,button,select,textarea,a[href]')].filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f.at(-1);
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  });
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); }));
  // badges: a check on My Place once a place is chosen, a count on Notes
  const badges = () => { $('bplace').textContent = P.place ? '✓' : ''; const n = noteCount(); $('bnotes').textContent = n ? n : ''; $('ncount').textContent = n; };
  document.addEventListener('placechange', badges); document.addEventListener('noteschanged', badges); badges();
  document.addEventListener('pinnote', () => toast('📌 Added to your notes'));
}
