// Keeping work across days: the map view and settings are remembered, and "My work" saves everything to a file and opens it again.
// The place, notes and drawn fronts already save themselves in the browser (see util.js store). This adds a portable backup.
import { $, store, esc } from './util.js';
import { map } from './mapview.js';
import { currentTab, goTab, setCollapsed, isCollapsed, toast, openModal, closeModal } from './shell.js';
import { noteCount, getNotes } from './notes.js';
import { P } from './place.js';
import { planDone } from './planner.js';

const KEYS = ['place', 'notes', 'plan', 'drawn', 'fspeed', 'proj', 'units'];       // what a work file carries
const checks = () => [...document.querySelectorAll('#tab-explore input[type=checkbox]')];

// ---- remember the map view and settings
let saveT, ready = false;
function writeUI() {
  if (!ready) return;                                   // don't overwrite the saved view with defaults before it has been restored
  const c = map.getCenter(), tab = currentTab();
  store.set('ui', { tab: tab === 'teacher' ? 'explore' : tab, collapsed: isCollapsed(), shade: $('shade').value, base: $('base').value,
    checks: Object.fromEntries(checks().map(x => [x.id, x.checked])), view: { lat: c.lat, lon: c.lng, z: map.getZoom() } });
}
export function saveUI() { clearTimeout(saveT); saveT = setTimeout(writeUI, 300); }
export function restoreUI() {
  const u = store.get('ui', null); if (!u) { ready = true; return; }
  for (const [id, v] of Object.entries(u.checks || {})) if ($(id)) $(id).checked = v;
  if (u.shade && [...$('shade').options].some(o => o.value === u.shade)) $('shade').value = u.shade;
  if (u.base) { $('base').value = u.base; $('base').dispatchEvent(new Event('change')); }
  if (u.view && isFinite(u.view.lat)) map.setView([u.view.lat, u.view.lon], u.view.z, { animate: false });
  if (u.tab) goTab(u.tab, { expand: false });
  setCollapsed(!!u.collapsed); $('shade').dispatchEvent(new Event('change')); ready = true;
}


// ---- save and open a work file
export function exportWork() {
  const o = { app: 'pressure-map', v: 2, savedAt: new Date().toISOString(), student: getNotes().student };
  for (const k of KEYS) o[k] = store.get(k, null);
  o.ui = store.get('ui', null); return o;
}
const touched = () => +localStorage.getItem('pm.touched') || 0, backedUp = () => +localStorage.getItem('pm.backup') || 0;
const hasWork = () => !!(P.place || noteCount() || planDone() || (store.get('drawn', []).length) || ((store.get('proj', {}) || {}).items || []).length);
export const needsBackup = () => hasWork() && touched() > backedUp();
const when = t => t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

function status() {
  const t = touched(), b = backedUp();
  $('workstatus').innerHTML = `<div class="kv"><span>Place</span><b>${P.place ? esc(P.place.name) : 'not chosen yet'}</b><span>Notes</span><b>${noteCount()}</b>
    <span>Last change</span><b>${when(t) || 'none yet'}</b><span>Last backup file</span><b>${b ? when(b) : 'never'}</b></div>
    <p class="${needsBackup() ? 'warn' : 'muted'}">${needsBackup() ? 'You have changes that are not in a backup file yet.' : hasWork() ? 'Everything is in your latest backup file.' : ''}</p>`;
}
function refresh() { status(); $('workdot').hidden = !needsBackup(); $('nbackup').hidden = !(noteCount() && needsBackup()); }
function download() {
  const o = exportWork(), name = (o.student || 'my').replace(/\W+/g, '_'), day = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' })); a.download = `weather-project-${name}-${day}.json`; a.click(); URL.revokeObjectURL(a.href);
  store.set('backup', Date.now()); localStorage.setItem('pm.backup', String(Date.now())); refresh(); toast('💾 Saved. Keep the file somewhere safe, like Google Drive.');
}
async function open(file) {
  let o; try { o = JSON.parse(await file.text()); } catch { o = null; }
  if (!o || o.app !== 'pressure-map') { alert('That file is not a weather project saved from this site.'); return; }
  if (hasWork() && !confirm('Opening this file will REPLACE the work on this computer. Save a file of your current work first if you want to keep it.\n\nOpen it now?')) return;
  for (const k of KEYS) { if (o[k] != null) store.set(k, o[k]); else store.del(k); }
  if (o.ui) store.set('ui', o.ui);
  localStorage.setItem('pm.backup', String(Date.now() + 1)); location.reload();
}
function fresh() {
  if (!confirm('Start a NEW project? This erases the place, notes and fronts on this computer.\n\nSave a file first if you want to keep them.')) return;
  for (const k of ['place', 'notes', 'plan', 'drawn', 'fspeed', 'proj', 'backup', 'ui']) store.del(k); location.reload();
}

export function initSession() {
  $('mywork').onclick = () => { status(); openModal('work'); };
  $('wclose').onclick = () => closeModal('work'); $('wsave').onclick = download; $('nbackupbtn').onclick = download; $('wnew').onclick = fresh;
  $('wopen').onchange = e => { const f = e.target.files[0]; if (f) open(f); e.target.value = ''; };
  for (const ev of ['noteschanged', 'placechange', 'projchanged']) document.addEventListener(ev, refresh);
  setInterval(refresh, 60000); refresh();
  map.on('moveend', saveUI); $('tab-explore').addEventListener('change', saveUI);
  for (const ev of ['tabshow', 'layout']) document.addEventListener(ev, saveUI);
  addEventListener('pagehide', () => { clearTimeout(saveT); writeUI(); });   // a quick reload or close must not lose the last change
}
