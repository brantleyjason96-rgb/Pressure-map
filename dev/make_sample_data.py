"""Write SYNTHETIC data in the same format as gfs_to_json.py, so the app can be developed and previewed offline.
Not real weather. Usage: python3 dev/make_sample_data.py   (teacher password for data/teacher.enc is "sample")"""
import base64, gzip, json, os
import datetime, sys
import numpy as np
sys.path.insert(0, '.')
from frontfind import detect_fronts

T0 = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0)
T0 = T0.replace(hour=T0.hour // 6 * 6) - datetime.timedelta(hours=6)

LAT0, LON0, D = -90, -180, 2
lat = np.arange(-90, 91, D)[:, None] * np.ones((1, 181))
lon = np.ones((91, 1)) * np.arange(-180, 181, D)[None, :]
K = np.pi / 180
PAST, FUTURE = list(range(-48, 1, 6)), list(range(6, 97, 6))
# (lat, lon at hour 0, deg east per hour, deg north per hour, hPa amplitude, radius deg)  - negative amp = low
SYSTEMS = [(48, -92, .33, .05, -26, 11), (43, -140, .30, .03, -20, 10), (55, -30, .25, .06, -30, 13), (35, 150, .35, .02, -17, 10),
           (36, -125, .08, -.02, 20, 14), (33, -45, .05, 0, 18, 15), (52, -108, -.05, -.05, 16, 9), (-45, 60, .4, 0, -24, 12),
           (-40, -120, .3, .02, -18, 11), (-30, -95, .05, 0, 17, 14), (-32, 25, .06, 0, 16, 12), (-55, -30, .35, 0, -28, 12)]


def dist2(la, lo, la0, lo0):
    dl = (lon - lo0 + 180) % 360 - 180
    return (lat - la0) ** 2 + (dl * np.cos(lat * K)) ** 2


def frame(h, localhr_offset=0):
    p = 1013 + 4 * np.cos(lat * K * 4) * (np.abs(lat) < 70)
    for la, lo, ve, vn, amp, rad in SYSTEMS:
        p = p + amp * np.exp(-dist2(la + vn * h, lo + ve * h, la + vn * h, lo + ve * h) * 0 -
                             dist2(0, 0, 0, 0) * 0 - ((lat - (la + vn * h)) ** 2 + (((lon - (lo + ve * h) + 180) % 360 - 180) * np.cos(lat * K)) ** 2) / (2 * rad ** 2))
    # temperature: warm tropics, cold poles, diurnal swing following the sun, cold air west of each low
    t = 28 - 0.45 * np.abs(lat) - 0.0012 * lat ** 2 / 2 * 0 + 5 * np.cos((((T0.hour + h) + lon / 15) % 24 - 15) * 2 * np.pi / 24)
    for la, lo, ve, vn, amp, rad in SYSTEMS:
        if amp < 0:
            dl = (lon - (lo + ve * h) + 180) % 360 - 180
            t = t - 6 * np.exp(-((lat - la - vn * h) ** 2 + (dl + 8) ** 2) / (2 * 9 ** 2)) + 5 * np.exp(-((lat - la - vn * h + 6) ** 2 + (dl - 10) ** 2) / (2 * 8 ** 2))
    d = t - 3 - 6 * (1 - np.exp(-np.abs(lat) / 40)) * 0.6
    # wind from the pressure gradient (geostrophic, then friction), capped
    dpdy = np.gradient(p, axis=0) * 100 / (D * K * 6371e3)
    dpdx = np.gradient(p, axis=1) * 100 / (D * K * 6371e3 * np.cos(np.clip(lat, -80, 80) * K))
    f = 2 * 7.292e-5 * np.sin(lat * K); f = np.where(np.abs(lat) < 12, np.sign(f + 1e-9) * 2 * 7.292e-5 * np.sin(12 * K), f)
    ug, vg = -dpdy / (1.2 * f), dpdx / (1.2 * f)
    th = np.where(lat >= 0, 30, -30) * K
    u, v = .6 * (ug * np.cos(th) - vg * np.sin(th)), .6 * (ug * np.sin(th) + vg * np.cos(th))
    sp = np.hypot(u, v); cap = np.minimum(1, 28 / np.maximum(sp, 1e-6)); u, v = u * cap, v * cap
    h5 = 5750 - 9 * (np.abs(lat) - 30) + 25 * (p - 1013) * np.exp(-((np.abs(lat) - 45) / 25) ** 2) + 40 * np.sin((lon + 3 * h) * K * 3) * (np.abs(lat) > 25)
    w5 = np.clip(20 + 90 * np.exp(-((np.abs(lat) - 42) / 12) ** 2) * (1 + .3 * np.sin((lon + 3 * h) * K * 3)), 0, 160)
    pr = np.clip((1010 - p) / 4, 0, 40) * (np.abs(lat) > 8) * (0.5 + 0.5 * np.sin(lon * K * 5 + h / 5))
    pr = np.where(pr > 0.3, pr, 0)
    r = lambda a, n: np.round(a, n).tolist() if n else np.round(a).astype(int).tolist()
    return {"p": r(p, 1), "t": r(t, 1), "d": r(d, 1), "u": r(u, 1), "v": r(v, 1), "h5": r(h5, 0), "w5": r(w5, 0), "pr": r(pr, 1)}


def make_sst():
    """Crude continents + sea temperatures that fall off with latitude, with warm/cold bands along data/currents.json."""
    boxes = [(32, 49, -124, -67), (49, 70, -141, -55), (15, 32, -105, -82), (60, 72, -168, -141), (-55, 12, -80, -35), (35, 71, -10, 40), (10, 75, 40, 142), (31, 45, 130, 145), (-35, 37, -17, 51),
             (-39, -11, 113, 154), (-90, -65, -180, 180), (60, 84, -75, -12)]
    land = np.zeros(lat.shape, bool)
    for la0, la1, lo0, lo1 in boxes: land |= (lat >= la0) & (lat <= la1) & (lon >= lo0) & (lon <= lo1)
    sst = np.maximum(-1.8, 29 * np.cos(lat * K) ** 1.3 - 1)
    for c in json.load(open("data/currents.json"))["currents"]:
        amp, f = (3.5 if c["kind"] == "warm" else -3.5), np.zeros(lat.shape)
        for path in c["paths"]:
            for (a0, o0), (a1, o1) in zip(path[:-1], path[1:]):
                for t in np.linspace(0, 1, 6):
                    la, lo = a0 + (a1 - a0) * t, o0 + (o1 - o0) * t
                    f = np.maximum(f, np.exp(-((lat - la) ** 2 + (((lon - lo + 180) % 360 - 180) * np.cos(la * K)) ** 2) / (2 * 3.0 ** 2)))
        sst = sst + amp * f
    return [[None if land[i, j] else round(float(sst[i, j]), 1) for j in range(181)] for i in range(91)]


def front_fields(h):
    """Synthetic 1-degree equivalent potential temperature and wind with a cold front and a warm front on every low, so the
    front finder has something to find. (Real data comes from gfs_to_json.py.)"""
    la1 = np.arange(-90, 91)[:, None] * np.ones((1, 360)); lo1 = np.ones((181, 1)) * np.arange(360)[None, :]
    th = 300 + 20 * np.cos(la1 * K) ** 2; u = np.zeros_like(th); v = np.zeros_like(th)
    for la, lo, ve, vn, amp, rad in SYSTEMS:
        if amp >= 0: continue
        c0, c1 = la + vn * h, (lo + ve * h) % 360; s = 1 if la > 0 else -1          # mirror the shapes in the Southern Hemisphere
        lines = [([(-2, -1), (-8, -5), (-15, -8), (-22, -10)], 1), ([(-1, 2), (-3, 9), (-2, 16)], -1)]     # cold front, warm front
        for offs, warm_left in lines:
            pts = [(c0 + s * a, c1 + b) for a, b in offs]
            best_d = np.full(th.shape, 1e9); best_side = np.zeros(th.shape); best_n = [np.zeros(th.shape), np.zeros(th.shape)]
            for (a0, b0), (a1, b1) in zip(pts[:-1], pts[1:]):
                kx = np.cos(np.radians(la1))
                px, py = ((lo1 - b0 + 180) % 360 - 180) * kx * 111, (la1 - a0) * 111
                dx, dy = ((b1 - b0 + 180) % 360 - 180) * np.cos(np.radians(a0)) * 111, (a1 - a0) * 111
                L2 = dx * dx + dy * dy; t = np.clip((px * dx + py * dy) / L2, 0, 1)
                d = np.hypot(px - t * dx, py - t * dy); side = np.sign(dx * (py - t * dy) - dy * (px - t * dx))     # + = left of travel
                nl = np.hypot(dx, dy); closer = d < best_d
                best_d = np.where(closer, d, best_d); best_side = np.where(closer, side, best_side)
                best_n = [np.where(closer, -dy / nl, best_n[0]), np.where(closer, dx / nl, best_n[1])]
            env = np.exp(-(best_d / 600) ** 2)
            th += 8 * env * np.tanh(best_side * warm_left * s * best_d / 150)
            u += s * 10 * env * np.exp(-(best_d / 300) ** 2) * best_n[0]; v += s * 10 * env * np.exp(-(best_d / 300) ** 2) * best_n[1]   # s flips the side in the Southern Hemisphere
    return th, u, v


def fronts(hours):
    return [detect_fronts(*front_fields(h)) for h in hours]


def pack(hours):
    fr = [frame(h) for h in hours]
    return {k: [f[k] for f in fr] for k in fr[0]}


t0 = T0
grid = {"lat0": LAT0, "lon0": LON0, "d": D}
os.makedirs("data", exist_ok=True)
json.dump({"cycle": t0.isoformat(), "hours": PAST, **grid, "sample": True, "sst": make_sst(), "fr": fronts(PAST), "f": pack(PAST)}, open("data/pressure.json", "w"), separators=(",", ":"))
print("wrote data/pressure.json (SAMPLE)")
try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    plain = gzip.compress(json.dumps({"cycle": t0.isoformat(), "hours": FUTURE, **grid, "fr": fronts(FUTURE), "f": pack(FUTURE)}, separators=(",", ":")).encode())
    salt, iv, iters = os.urandom(16), os.urandom(12), 250000
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, iters).derive(b"sample")
    b = lambda x: base64.b64encode(x).decode()
    json.dump({"v": 1, "iters": iters, "salt": b(salt), "iv": b(iv), "ct": b(AESGCM(key).encrypt(iv, plain, None))}, open("data/teacher.enc", "w"))
    print('wrote data/teacher.enc (SAMPLE, password "sample")')
except ImportError:
    print("cryptography not installed; skipped teacher.enc")
