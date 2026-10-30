"""Find weather fronts anywhere on Earth from model fields (no hand analysis needed).

Method: the Thermal Front Parameter (Hewson 1998). Fronts sit where the temperature/moisture contrast is sharpest across the front.
  1. theta_e: equivalent potential temperature at 850 hPa (about 5,000 ft), which carries both temperature and moisture.
  2. TFP = -grad(|grad theta_e|) . grad(theta_e)/|grad theta_e|. A front lies along TFP = 0 where the contrast is strong enough.
  3. The wind component across the front decides the type: cold air advancing -> cold front, warm air advancing -> warm front,
     little motion -> stationary front.
  4. Each line is oriented so the front's symbols (triangles / half-circles) are drawn on the side it is moving toward.
These are rough, computer-found fronts, not forecasters' analyses. Pure numpy; no plotting or GRIB libraries.
"""
import numpy as np

K = np.pi / 180
DEFAULT = dict(grad_min=0.035,      # K per km: weakest contrast that can be a front (3.5 K per 100 km after smoothing)
               min_km=1200,         # shortest line kept
               lat_lo=20, lat_hi=82,
               curvature=True,      # keep only the sharpest ridge of contrast (a maximum, not a minimum) - Hewson's second condition
               strong_min=0.0,      # mean contrast along the whole line must be at least this (K per km); 0 = off
               terrain_hpa=880,     # 850 mb is underground where surface pressure is below this: ignore those places
               wind_min=2.0)        # m/s across the front below which it is called stationary


def theta_e(T, RH, p=850.0):
    """Equivalent potential temperature (K), Bolton 1980. T in K, RH in percent, p in hPa."""
    Tc = T - 273.15
    es = 6.112 * np.exp(17.67 * Tc / (Tc + 243.5))
    e = np.clip(RH, 1, 100) / 100 * es
    ln = np.log(e / 6.112)
    Td = 243.5 * ln / (17.67 - ln) + 273.15
    TL = 1 / (1 / (Td - 56) + np.log(T / Td) / 800) + 56
    r = 1000 * 0.622 * e / (p - e)                                   # mixing ratio, g/kg
    return T * (1000 / (p - e)) ** 0.2854 * (1 - 0.28e-3 * r) * np.exp((3.376 / TL - 0.00254) * r * (1 + 0.81e-3 * r))


def _smooth(a, n=1):  # 3x3 box blur, wrapping in longitude
    for _ in range(n):
        p = np.pad(a, ((1, 1), (0, 0)), mode="edge")
        p = np.concatenate([p[:, -1:], p, p[:, :1]], axis=1)
        a = sum(p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)) / 9
    return a


def _grad(f, lat):  # per km on a 1-degree global grid, rows south->north, 360 columns wrapping
    gy = np.gradient(f, axis=0) / 111.0
    dx = 111.0 * np.maximum(np.cos(lat[:, None] * K), 0.05)
    gx = (np.roll(f, -1, axis=1) - np.roll(f, 1, axis=1)) / (2 * dx)
    return gx, gy


def _zero_segments(F, ok):
    """Marching squares for F = 0 on cells whose four corners are all `ok`. Returns {edge: (lat, lon)} and a list of edge pairs."""
    nl, nn = F.shape
    Fe = np.concatenate([F, F[:, :1]], axis=1); Oe = np.concatenate([ok, ok[:, :1]], axis=1)       # a wrapped extra column
    a, b, c, d = Fe[:-1, :-1], Fe[:-1, 1:], Fe[1:, 1:], Fe[1:, :-1]
    good = Oe[:-1, :-1] & Oe[:-1, 1:] & Oe[1:, 1:] & Oe[1:, :-1]
    sgn = np.stack([a > 0, b > 0, c > 0, d > 0])
    mixed = good & (sgn.any(axis=0)) & (~sgn.all(axis=0))
    pos, segs = {}, []
    def cross(e):                                               # where on this cell edge F crosses zero
        if e in pos: return e
        kind, i, j = e; i, j = int(i), int(j)
        if kind == "h": f0, f1, la, lo0 = Fe[i, j], Fe[i, j + 1], i, j; t = f0 / (f0 - f1); pos[e] = (la - 90, lo0 + t)
        else: f0, f1 = Fe[i, j], Fe[i + 1, j]; t = f0 / (f0 - f1); pos[e] = (i + t - 90, j)
        return e
    for i, j in zip(*np.where(mixed)):
        corners = [(Fe[i, j] > 0), (Fe[i, j + 1] > 0), (Fe[i + 1, j + 1] > 0), (Fe[i + 1, j] > 0)]
        edges = [("h", i, j), ("v", i, j + 1), ("h", i + 1, j), ("v", i, j)]           # top, right, bottom, left
        hit = [edges[k] for k in range(4) if corners[k] != corners[(k + 1) % 4]]
        if len(hit) == 2: segs.append((cross(hit[0]), cross(hit[1])))
        elif len(hit) == 4: segs += [(cross(hit[0]), cross(hit[1])), (cross(hit[2]), cross(hit[3]))]
    return pos, segs


def _chains(pos, segs):
    adj = {}
    for p, q in segs: adj.setdefault(p, []).append(q); adj.setdefault(q, []).append(p)
    seen, out = set(), []
    starts = [e for e, n in adj.items() if len(n) == 1] + [e for e, n in adj.items() if len(n) != 1 or True]
    for s in starts:
        if s in seen: continue
        chain, cur, prev = [s], s, None; seen.add(s)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt: break
            prev, cur = cur, nxt[0]; chain.append(cur); seen.add(cur)
        out.append([pos[e] for e in chain])
    return out


def _chaikin(pts, n=2):
    for _ in range(n):
        if len(pts) < 3: break
        q = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]): q += [(.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]), (.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1])]
        pts = q + [pts[-1]]
    return pts


def _thin(pts, k=3):
    return pts[::k] + ([pts[-1]] if (len(pts) - 1) % k else [])


def detect_fronts(theta, u, v, cfg=None, surface_hpa=None):
    """theta: equivalent potential temperature (K) on a 1-degree global grid, shape (181, 360), rows S->N, columns 0..359 E.
    u, v: wind (m/s) at the same level and grid. surface_hpa: surface pressure (hPa) on the same grid, used to ignore places where
    the 850 mb level is below ground (the model invents contrast there). Returns [{"t": "Cold Front", "g": 0.052, "p": [[lat, lon], ...]}, ...]."""
    c = {**DEFAULT, **(cfg or {})}
    lat = np.arange(-90, 91, dtype=float)
    th = _smooth(theta, 1)
    gx, gy = _grad(th, lat); mag = np.hypot(gx, gy)
    mag_s = _smooth(mag, 1)
    nx, ny = gx / np.maximum(mag, 1e-9), gy / np.maximum(mag, 1e-9)                 # unit vector toward warmer / moister air
    mx, my = _grad(mag_s, lat)
    sn = mx * nx + my * ny                                                           # how the contrast changes across the front
    tfp = -sn
    ok = (mag_s > c["grad_min"]) & (np.abs(lat)[:, None] >= c["lat_lo"]) & (np.abs(lat)[:, None] <= c["lat_hi"])
    if c["curvature"]:
        sx, sy = _grad(sn, lat); ok &= (sx * nx + sy * ny) < 0                       # a maximum of contrast, not a minimum
    if surface_hpa is not None and c["terrain_hpa"]:
        ok &= _smooth((surface_hpa < c["terrain_hpa"]).astype(float), 2) < 0.02     # also a margin of 2 grid cells around high ground
    pos, segs = _zero_segments(tfp, ok)
    out = []
    for ch in _chains(pos, segs):
        if len(ch) < 6: continue
        ch = [(la, lo % 360) for la, lo in ch]
        km = sum(np.hypot((b[0] - a[0]) * 111, ((b[1] - a[1] + 180) % 360 - 180) * 111 * np.cos(np.radians((a[0] + b[0]) / 2))) for a, b in zip(ch[:-1], ch[1:]))
        if km < c["min_km"]: continue
        ch = _chaikin(ch, 2)
        strength = float(np.mean([mag_s[int(np.clip(round(la + 90), 0, 180)), int(round(lo)) % 360] for la, lo in ch]))
        if strength < c["strong_min"]: continue
        # sample the gradient direction and the wind along the line
        def at(f, la, lo):
            y, x = la + 90, lo % 360; i, j = int(np.clip(np.floor(y), 0, 179)), int(np.floor(x)) % 360; fy, fx = y - i, x - np.floor(x)
            j2 = (j + 1) % 360
            return (f[i, j] * (1 - fx) + f[i, j2] * fx) * (1 - fy) + (f[i + 1, j] * (1 - fx) + f[i + 1, j2] * fx) * fy
        nn = np.array([[at(nx, la, lo), at(ny, la, lo)] for la, lo in ch]); vn = np.array([at(u, la, lo) * at(nx, la, lo) + at(v, la, lo) * at(ny, la, lo) for la, lo in ch])
        med = float(np.median(vn))
        kind = "Stationary Front" if abs(med) < c["wind_min"] else "Cold Front" if med > 0 else "Warm Front"
        motion = nn if med >= 0 else -nn                                            # the side the symbols belong on
        d = np.array([[((b[1] - a[1] + 180) % 360 - 180) * np.cos(np.radians(a[0])), b[0] - a[0]] for a, b in zip(ch[:-1], ch[1:])])
        left = np.stack([-d[:, 1], d[:, 0]], axis=1)                                # left of the direction of travel (east, north)
        score = float(np.sum(left * motion[:-1]))
        if score < 0: ch = ch[::-1]
        # split where the line crosses the date line, and write plain -180..180 longitudes
        part, parts = [], []
        for la, lo in ch:
            lo = lo - 360 if lo > 180 else lo
            if part and abs(lo - part[-1][1]) > 180: parts.append(part); part = []
            part.append([round(float(la), 1), round(float(lo), 1)])
        parts.append(part)
        out += [{"t": kind, "g": round(strength, 3), "p": _thin(p)} for p in parts if len(p) >= 8]
    return out


# ---- following fronts through time, so the loop shows ONE front moving instead of a new set of lines on every frame
NPTS = 24                                                            # every line is resampled to this many points, so point i matches point i in the next frame


def _unwrap(pts):
    out = [list(pts[0])]
    for la, lo in pts[1:]: out.append([la, out[-1][1] + (lo - out[-1][1] + 180) % 360 - 180])
    return out


def resample(pts, n=NPTS):
    """n points evenly spaced along the line (arc length). Longitudes are unwrapped while measuring, then written back as -180..180."""
    u = np.array(_unwrap(pts), dtype=float)
    seg = np.hypot(np.diff(u[:, 0]) * 111, np.diff(u[:, 1]) * 111 * np.cos(np.radians((u[:-1, 0] + u[1:, 0]) / 2)))
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] <= 0: return [[round(float(u[0, 0]), 1), round(float(((u[0, 1] + 180) % 360) - 180), 1)]] * n
    t = np.linspace(0, s[-1], n)
    la, lo = np.interp(t, s, u[:, 0]), np.interp(t, s, u[:, 1])
    return [[round(float(a), 1), round(float(((b + 180) % 360) - 180), 1)] for a, b in zip(la, lo)]


def _mean_km(A, B):
    a, b = np.array(A), np.array(B)
    dl = (b[:, 1] - a[:, 1] + 180) % 360 - 180
    return float(np.mean(np.hypot((b[:, 0] - a[:, 0]) * 111, dl * 111 * np.cos(np.radians((a[:, 0] + b[:, 0]) / 2)))))


def _lerp(A, B, t):
    out = []
    for (la0, lo0), (la1, lo1) in zip(A, B):
        lo = lo0 + ((lo1 - lo0 + 180) % 360 - 180) * t
        out.append([round(la0 + (la1 - la0) * t, 1), round(((lo + 180) % 360) - 180, 1)])
    return out


def track_fronts(frames, match_km=500, max_gap=2, start_g=0.0, min_frames=3, prior=None):
    """frames: a list (one per time step, oldest first) of front lists as returned by detect_fronts.
    Returns the same shape with every front given an "id" that stays the same as it moves, and:
      - hysteresis: a line weaker than start_g only survives if it continues a front already being followed
      - gaps of up to max_gap frames are bridged by interpolating the line
      - the front keeps one type (the commonest along its track), so it stops flipping between cold, warm and stationary
      - a front that flickers on for fewer than min_frames frames in the middle of the record is dropped
    prior: the already-tracked fronts (with ids) of the frame just BEFORE frames[0]; they are continued, keeping their ids. This lets the
    teacher's forecast frames carry on from the public past frames without the public file ever being tracked using the future."""
    n = len(frames); tracks = []; open_ = []                         # a track: {"pts": {frame: line}, "g": {...}, "t": [...], "last": frame, "id": n}
    for f in prior or []:
        tr = {"pts": {-1: f["p"]}, "g": {-1: f.get("g", 0)}, "t": [(f["t"], 1)], "last": -1, "id": f["id"]}; tracks.append(tr); open_.append(tr)
    nid = max([f["id"] for f in prior or []] + [0])
    for i, fl in enumerate(frames):
        cands = [(resample(f["p"]), f) for f in fl]
        pairs = sorted((_mean_km(tr["pts"][tr["last"]], c[0]), ti, ci) for ti, tr in enumerate(open_) for ci, c in enumerate(cands) if i - tr["last"] <= max_gap + 1)
        pairs = [p for p in pairs if p[0] < match_km]
        usedT, usedC = set(), set()
        for d, ti, ci in pairs:
            if ti in usedT or ci in usedC: continue
            usedT.add(ti); usedC.add(ci); tr = open_[ti]
            tr["pts"][i], tr["g"][i] = cands[ci][0], cands[ci][1].get("g", 0); tr["t"].append((cands[ci][1]["t"], len(cands[ci][0]))); tr["last"] = i
        for ci, (line, f) in enumerate(cands):
            if ci in usedC or f.get("g", 1) < start_g: continue
            nid += 1; tr = {"pts": {i: line}, "g": {i: f.get("g", 0)}, "t": [(f["t"], 1)], "last": i, "id": nid}; tracks.append(tr); open_.append(tr)
        open_ = [tr for tr in open_ if i - tr["last"] <= max_gap]
    out = [[] for _ in range(n)]
    for tr in tracks:
        fs = sorted(tr["pts"])
        if fs == [-1]: continue                                                      # a prior front with no continuation
        if len(fs) < min_frames and fs[0] > 0 and fs[-1] < n - 1: continue         # a flicker, not a front (ends of the record may legitimately be short)
        votes = {}
        for t, w in tr["t"]: votes[t] = votes.get(t, 0) + w
        kind = max(votes, key=votes.get)
        for a, b in zip(fs[:-1], fs[1:]):                                            # bridge any gap
            for j in range(a + 1, b):
                tr["pts"][j] = _lerp(tr["pts"][a], tr["pts"][b], (j - a) / (b - a)); tr["g"][j] = (tr["g"][a] + tr["g"][b]) / 2
        for j in sorted(tr["pts"]):
            if j >= 0: out[j].append({"id": tr["id"], "t": kind, "g": round(float(tr["g"][j]), 3), "p": tr["pts"][j]})
    return out
