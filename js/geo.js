// Pure geometry: points on the sphere, a flat local projection, land/water masks and the nearest coastline.
// No DOM and no network, so it can be tested on its own.
const K = Math.PI / 180;

export function destination(lat, lon, brg, km) {
  const d = km / 6371, b = brg * K, p1 = lat * K, l1 = lon * K;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / K, lon: ((l2 / K + 540) % 360) - 180 };
}
export function flatFrame(lat0, lon0) { // km east/north of (lat0, lon0); good to a few hundred km
  const kx = 111.32 * Math.cos(lat0 * K), ky = 110.57;
  return {
    xy: (lat, lon) => [(((lon - lon0 + 540) % 360) - 180) * kx, (lat - lat0) * ky],
    ll: (x, y) => ({ lat: lat0 + y / ky, lon: lon0 + x / kx }),
  };
}
export const bearingXY = (x, y) => (Math.atan2(x, y) / K + 360) % 360;   // 0 = north, 90 = east

function inRing(ring, lat, lon) { // ring = [[lon, lat], ...]
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// A set of polygons (GeoJSON features) that can answer "is this point inside?" and "where is the nearest edge?"
export class Mask {
  constructor(features = [], minSizeKm = 0) {
    this.polys = [];
    for (const f of features) {
      const g = f.geometry; if (!g) continue;
      for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        if (Math.hypot((x1 - x0) * 111 * Math.cos((y0 + y1) / 2 * K), (y1 - y0) * 111) < minSizeKm) continue;   // skip ponds
        this.polys.push({ rings: poly, bbox: [x0, y0, x1, y1] });
      }
    }
  }
  inside(lat, lon) {
    for (const p of this.polys) {
      const [x0, y0, x1, y1] = p.bbox; if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
      if (inRing(p.rings[0], lat, lon) && !p.rings.slice(1).some(h => inRing(h, lat, lon))) return true;
    }
    return false;
  }
  nearest(lat, lon) { // closest point on any edge: { km, lat, lon, dx, dy } where (dx, dy) is the edge direction (km units)
    const F = flatFrame(lat, lon); let best = null;
    for (const p of this.polys) {
      const [x0, y0, x1, y1] = p.bbox;
      if (best) { const pad = best.km / 100 + .5; if (lon < x0 - pad * 2 || lon > x1 + pad * 2 || lat < y0 - pad || lat > y1 + pad) continue; }
      for (const ring of p.rings) for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = F.xy(ring[i - 1][1], ring[i - 1][0]), [bx, by] = F.xy(ring[i][1], ring[i][0]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx, qy);
        if (!best || d < best.km) best = { km: d, qx, qy, dx, dy };
      }
    }
    if (!best) return null;
    return { km: best.km, ...F.ll(best.qx, best.qy), dx: best.dx, dy: best.dy };
  }
}

// Where is the water relative to this place? null if the place itself is over water.
export function coastInfo(lat, lon, land, lakes) {
  const water = (la, lo) => !land.inside(la, lo) || lakes.inside(la, lo);
  if (water(lat, lon)) return { onWater: true };
  const a = land.nearest(lat, lon), b = lakes.nearest(lat, lon), q = !b || (a && a.km <= b.km) ? a : b;
  if (!q) return { none: true };                                   // no coast in the data at all
  const F = flatFrame(lat, lon), [qx, qy] = F.xy(q.lat, q.lon), L = Math.hypot(q.dx, q.dy) || 1;
  let nx = -q.dy / L, ny = q.dx / L, seaward = null;
  for (const s of [1, -1]) { const p = F.ll(qx + s * nx * 3, qy + s * ny * 3); if (water(p.lat, p.lon)) { seaward = [s * nx, s * ny]; break; } }
  if (!seaward) { const d = Math.hypot(qx, qy) || 1; seaward = [qx / d, qy / d]; }   // thin strip / island: just face the nearest edge
  const probe = F.ll(qx + seaward[0] * 3, qy + seaward[1] * 3);
  return { km: q.km, coast: { lat: q.lat, lon: q.lon }, seaward: bearingXY(seaward[0], seaward[1]), type: lakes.inside(probe.lat, probe.lon) ? 'lake' : 'sea' };
}
