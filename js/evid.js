// Small shared state for the helper panels: what the student has done outside the notes (saved a chart or map picture, made slide text)
// and what the Local tab found out about their place. Both are read by "Check my work".
import { store } from './util.js';

export const EV = Object.assign({ chart: false, pic: false, slides: false }, store.get('evid', {}));
export function markEvid(k) { if (EV[k]) return; EV[k] = true; store.set('evid', EV); document.dispatchEvent(new Event('evidchange')); }
export const LS = { oro: null, coast: null, cur: null };   // set by terrain.js, coast.js and currents.js
export function setLocal(k, v) { LS[k] = v; document.dispatchEvent(new Event('localsummary')); }
