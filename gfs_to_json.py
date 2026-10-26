"""Fetch NOAA GFS data and write the files the map loads.

data/pressure.json   PUBLIC, students load it. Holds ONLY the past: the model analysis (f000) of the last 9 six-hourly
                     cycles (-48 h .. now), global, thinned to 2 degrees. Nothing in it is a forecast; the script refuses
                     to write it if any frame is later than the newest cycle.
data/teacher.enc     OPTIONAL. The 6-h .. 96-h forecast, gzipped and encrypted with AES-GCM under the passphrase in the
                     TEACHER_PASSWORD environment variable. Only written when that variable is set.

Needs: pygrib numpy cryptography (cryptography only for the teacher file)."""
import base64, gzip, json, os, tempfile, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
import numpy as np, pygrib

PAST = list(range(-48, 1, 6))      # hours relative to the newest cycle; 0 = newest analysis
FUTURE = list(range(6, 97, 6))     # teacher file only (96 h so Day 3 is covered whenever the cycle is a few hours old)
ALL_VARS = "var_PRMSL=on&var_APCP=on&var_HGT=on&var_UGRD=on&var_VGRD=on&var_TMP=on&var_DPT=on&var_LAND=on&var_ICEC=on"
LEVELS = "lev_mean_sea_level=on&lev_surface=on&lev_500_mb=on&lev_10_m_above_ground=on&lev_2_m_above_ground=on"
KEYS = {("prmsl", 0): "p", ("gh", 500): "z5", ("u", 500): "u5", ("v", 500): "v5", ("2t", 2): "t2", ("2d", 2): "d2",
        ("10u", 10): "u10", ("10v", 10): "v10"}


def fetch(t, fh, precip_only=False):
    """One GFS file (cycle t, forecast hour fh). Returns {key: 2D array, rows S->N, cols lon 0..359}."""
    d, c = t.strftime("%Y%m%d"), t.strftime("%H")
    variables = "var_APCP=on" if precip_only else ALL_VARS
    url = ("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
           f"?file=gfs.t{c}z.pgrb2.1p00.f{fh:03d}&{variables}&{LEVELS}"
           f"&subregion=&leftlon=0&rightlon=360&toplat=90&bottomlat=-90&dir=%2Fgfs.{d}%2F{c}%2Fatmos")
    raw = urllib.request.urlopen(url, timeout=120).read()
    out = {}
    with tempfile.NamedTemporaryFile(suffix=".grib2") as f:
        f.write(raw); f.flush()
        for m in pygrib.open(f.name):
            key = KEYS.get((m.shortName, m.level))
            if m.shortName == "tp":  # want the 6-hour bucket (GFS also writes 0-N h totals)
                a, b = map(int, m.stepRange.split("-"))
                if b - a == 6: key = "pr"
            if not key and m.typeOfLevel == "surface":  # skin temperature, land mask and sea-ice fraction (for sea-surface temperature)
                nm = m.name.lower()
                if m.shortName in ("t", "skt") or nm in ("temperature", "skin temperature"): key = "tsfc"
                elif m.shortName in ("lsm", "landn") or nm.startswith("land"): key = "land"
                elif m.shortName == "ci" or nm.startswith("ice"): key = "ice"
            if not key or (precip_only and key != "pr"): continue
            lat = m.latlons()[0]
            v = m.values
            if lat[0, 0] > lat[-1, 0]: v = v[::-1]  # make rows run south -> north
            out[key] = np.ma.filled(v, 0).astype(float)
    return out


def smooth(a, n):  # 3x3 box blur
    for _ in range(n):
        p = np.pad(a, 1, mode="edge")
        a = sum(p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)) / 9
    return a


def to_pm180(a):  # lon 0..359 -> -180..180 (181 cols, last = first so the map seam closes), thin to 2 degrees
    a = np.roll(a, 180, axis=1)
    a = np.concatenate([a, a[:, :1]], axis=1)
    return a[::2, ::2]


def encode(fr, nd):
    return None if fr is None else [[round(float(v), nd) if nd else int(round(v)) for v in row] for row in fr]


def fields_for(r, pr):
    """Turn the raw arrays of one frame into the thinned, rounded grids the app uses. pr = 6-h precip array or None."""
    return {"p": encode(to_pm180(smooth(r["p"], 3)) / 100, 1),
            "t": encode(to_pm180(smooth(r["t2"], 1)) - 273.15, 1),
            "d": encode(to_pm180(smooth(r["d2"], 1)) - 273.15, 1),
            "u": encode(to_pm180(smooth(r["u10"], 1)), 1),
            "v": encode(to_pm180(smooth(r["v10"], 1)), 1),
            "h5": encode(to_pm180(smooth(r["z5"], 1)), 0),
            "w5": encode(to_pm180(smooth(np.hypot(r["u5"], r["v5"]), 1)) * 1.944, 0),  # m/s -> knots
            "pr": encode(to_pm180(smooth(pr, 1)), 1) if pr is not None else None}


def make_sst(r):
    """Sea-surface temperature (deg C) on the 2-degree grid, None over land and sea ice. Analysis only (newest cycle). Returns None
    if the NOAA file did not have the fields, in which case the map simply hides the sea-temperature layers."""
    if not all(k in r for k in ("tsfc", "land", "ice")): return None
    sea = (r["land"] < 0.5) & (r["ice"] < 0.15)
    g = to_pm180(np.where(sea, r["tsfc"] - 273.15, np.nan))   # no smoothing, so coastlines stay sharp
    return [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in g]


def collect(frames):
    out = {k: [] for k in ("p", "t", "d", "u", "v", "h5", "w5", "pr")}
    for fr in frames:
        for k in out: out[k].append(fr[k])
    return out


now = datetime.now(timezone.utc) - timedelta(hours=5)  # newest cycle takes ~4-5 h to publish in full
for back in range(0, 30, 6):
    t0 = (now - timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
    t0 = t0.replace(hour=t0.hour // 6 * 6)
    try:
        # past frame at hour h = analysis of the cycle at t0+h; its 6-h rain = f006 of the cycle 6 h earlier (valid at t0+h)
        past = []
        for h in PAST:
            tv = t0 + timedelta(hours=h)
            r = fetch(tv, 0)
            if h == 0: raw0 = r
            rain = fetch(tv - timedelta(hours=6), 6, precip_only=True).get("pr")
            past.append(fields_for(r, rain))
        break
    except urllib.error.URLError:
        continue
else:
    raise SystemExit("no complete GFS cycle available")

assert max(PAST) == 0 and t0 <= datetime.now(timezone.utc), "public file must never contain forecast frames"
os.makedirs("data", exist_ok=True)
grid = {"lat0": -90, "lon0": -180, "d": 2}
sst = make_sst(raw0)
print("sea-surface temperature:", "ok" if sst else "NOT available (layers will be hidden)")
json.dump({"cycle": t0.isoformat(), "hours": PAST, **grid, "sst": sst, "f": collect(past)},
          open("data/pressure.json", "w"), separators=(",", ":"))
print("wrote data/pressure.json for cycle", t0, "past frames only:", PAST)

pw = os.environ.get("TEACHER_PASSWORD")
if not pw:
    print("TEACHER_PASSWORD not set: no teacher forecast file written")
else:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    fut = []
    for h in FUTURE:
        r = fetch(t0, h)
        fut.append(fields_for(r, r.get("pr")))
    plain = gzip.compress(json.dumps({"cycle": t0.isoformat(), "hours": FUTURE, **grid, "f": collect(fut)},
                                     separators=(",", ":")).encode())
    salt, iv, iters = os.urandom(16), os.urandom(12), 250000
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, iters).derive(pw.encode())
    b64 = lambda b: base64.b64encode(b).decode()
    json.dump({"v": 1, "iters": iters, "salt": b64(salt), "iv": b64(iv), "ct": b64(AESGCM(key).encrypt(iv, plain, None))},
              open("data/teacher.enc", "w"))
    print("wrote data/teacher.enc (encrypted forecast)")
