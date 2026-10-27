// 📷 Save map picture: draws the map's tiles and the weather layers onto one canvas and downloads it as a PNG with a caption.
import { $ } from './util.js';
import { map, layer } from './mapview.js';
import { current, PRESETS } from './layers.js';
import { P } from './place.js';
import { toast } from './shell.js';
import { markEvid } from './evid.js';

function save() {
  const box = map.getContainer(), r = box.getBoundingClientRect(), c = document.createElement('canvas'), CAP = 44;
  c.width = Math.round(r.width); c.height = Math.round(r.height) + CAP;
  const g = c.getContext('2d'); g.fillStyle = '#1b232e'; g.fillRect(0, 0, c.width, c.height);
  const rel = el => { const b = el.getBoundingClientRect(); return [b.left - r.left, b.top - r.top, b.width, b.height]; };
  try {
    // the base-map tiles come from another site that does not allow copying them, so the picture shows the weather layers, borders and labels on a plain background
    g.drawImage(layer.c, ...rel(layer.c));
    const k = current(), view = k ? PRESETS[k].name : 'Custom map';
    g.fillStyle = '#000c'; g.fillRect(0, r.height, c.width, CAP); g.fillStyle = '#fff'; g.font = 'bold 14px system-ui'; g.textBaseline = 'middle';
    g.fillText(`${P.place ? P.place.name + ' · ' : ''}${view} · ${$('when').innerText.replace(/\n.*/s, '')}`, 10, r.height + 15);
    g.font = '11px system-ui'; g.fillStyle = '#ccc'; g.fillText('Weather data: NOAA GFS · Map: Esri, Natural Earth', 10, r.height + 33);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'my-weather-map.png'; a.click(); URL.revokeObjectURL(a.href); markEvid('pic'); toast('📷 Picture saved'); });
  } catch { toast('The browser blocked the picture. Use your device’s screenshot tool instead.'); }
}
export const initMapPic = () => { $('picbtn').onclick = save; };
