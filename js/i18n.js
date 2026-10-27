// Language switcher. Every English string in the page is a key into lang/<code>.json; a DOM pass swaps text (and title / placeholder /
// aria-label) for the translation, and a MutationObserver translates whatever the app draws later. Strings with numbers also match
// as a template ("{#} of {#} done"). Anything without a translation stays English. The map and Teacher view are not translated.
import { $, store } from './util.js';

export const LANGS = { en: ['English', 'ltr'], es: ['Español', 'ltr'], fr: ['Français', 'ltr'], ht: ['Kreyòl ayisyen', 'ltr'], pt: ['Português', 'ltr'], ar: ['العربية', 'rtl'] };
const WORD = /\p{L}/u, FMT = new Set(['B', 'I', 'SMALL', 'EM', 'STRONG', 'BR']), SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CANVAS', 'svg', 'SVG']), ATTRS = ['title', 'placeholder', 'aria-label'];
const norm = s => s.replace(/\s+/g, ' ').trim();
let dict = {}, lang = 'en', obs = null, collecting = false;
export const missing = new Set();

function lookup(key) {
  if (!WORD.test(key)) return null;
  if (dict[key] != null) return dict[key];
  let tpl = key; const nums = [];
  if (/\d/.test(key)) { tpl = key.replace(/\d+(?:[.,]\d+)*/g, m => (nums.push(m), '{#}')); if (dict[tpl] != null) { let i = 0; return dict[tpl].replace(/\{#\}/g, () => nums[i++] ?? ''); } }
  if (collecting) missing.add(tpl);
  return null;
}
const skipped = e => SKIP.has(e.tagName) || e.hasAttribute('data-i18n-skip') || e.id === 'map' || e.id === 'tab-teacher' || e.id === 'tmodal';

function text(n) {   // one text node
  const cur = n.nodeValue, en = n.__tr === cur ? n.__en : cur, key = norm(en); if (!WORD.test(key)) return;
  const v = lookup(key), out = v == null ? en : en.match(/^\s*/)[0] + v + en.match(/\s*$/)[0];
  n.__en = en; n.__tr = out; if (out !== cur) n.nodeValue = out;
}
function attrs(e) {
  for (const a of ATTRS) {
    if (!e.hasAttribute(a)) continue;
    const cur = e.getAttribute(a), st = e.__a || (e.__a = {}), en = st[a] && st[a].tr === cur ? st[a].en : cur, v = lookup(norm(en)), out = v == null ? en : v;
    st[a] = { en, tr: out }; if (out !== cur) e.setAttribute(a, out);
  }
}
function walk(e) {
  if (e.nodeType === 3) return text(e);
  if (e.nodeType !== 1 || skipped(e)) return;
  attrs(e);
  const kids = [...e.childNodes], inline = kids.some(n => n.nodeType === 1 && FMT.has(n.tagName)) && kids.some(n => n.nodeType === 3 && WORD.test(n.nodeValue))
    && kids.every(n => n.nodeType === 3 || n.nodeType === 8 || (n.nodeType === 1 && FMT.has(n.tagName)));
  if (inline) {   // text with <b> / <i> inside: translate the whole thing, tags included
    const cur = e.innerHTML, en = e.__tr === cur ? e.__en : cur, v = lookup(norm(en));
    if (v != null || e.__tr === cur) { const out = v == null ? en : v; e.__en = en; e.__tr = out; if (out !== cur) { e.innerHTML = out; e.__tr = e.innerHTML; } return; }
  }
  kids.forEach(walk);
}
function apply(root) { if (obs) obs.disconnect(); walk(root); if (obs) { obs.takeRecords(); watch(); } }
function watch() { obs.observe(document.body, { childList: true, subtree: true, characterData: true }); }
let pending = new Set(), timer = 0;
function onMutations(list) {
  if (lang === 'en' && !collecting) return;
  for (const m of list) {
    const t = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (!t || t.closest('.leaflet-map-pane:not(:has(.leaflet-popup))') && !t.closest('.leaflet-popup')) continue;
    pending.add(t);
  }
  if (!timer) timer = setTimeout(() => { timer = 0; const ts = [...pending]; pending = new Set(); obs.disconnect(); ts.forEach(t => t.isConnected && walk(t)); obs.takeRecords(); watch(); }, 30);
}

export async function setLang(code) {
  if (!LANGS[code]) code = 'en';
  lang = code; store.set('lang', code); $('lang').value = code;
  dict = {};
  if (code !== 'en') { try { dict = await (await fetch(`lang/${code}.json`)).json(); } catch { dict = {}; } }
  const rtl = LANGS[code][1] === 'rtl';
  document.documentElement.lang = code;
  for (const el of document.querySelectorAll('#side, .modal, #printReport')) el.dir = rtl ? 'rtl' : 'ltr';
  document.body.classList.toggle('rtl', rtl);
  if (!obs) obs = new MutationObserver(onMutations);
  apply(document.body); document.title = dict['Weather Forecast Project'] || 'Weather Forecast Project';
  document.dispatchEvent(new Event('langchange'));
}
export function initI18n() {
  $('lang').innerHTML = Object.entries(LANGS).map(([c, [n]]) => `<option value="${c}">${n}</option>`).join('');
  $('lang').onchange = e => setLang(e.target.value);
  collecting = new URLSearchParams(location.search).has('i18n');
  return setLang(store.get('lang', 'en'));
}
export const t = s => { const v = lang === 'en' ? null : dict[norm(s)]; return v == null ? s : v; };   // for strings built in script
