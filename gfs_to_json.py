"""Fetch the latest NOAA GFS forecast (f000..f072, 6-hourly, 1°, Northern Hemisphere) and write data/pressure.json:
sea-level pressure, 6-h precipitation, 500 mb height + wind speed (all thinned to 2°), plus per-city readouts.
Needs: pygrib numpy."""
import json, tempfile, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
import numpy as np, pygrib

HOURS = list(range(0, 73, 6))
# name,lat,lon,kind  (cap = US state capital, world = other major NH city)
CITIES = """Montgomery,32.377,-86.300;Juneau,58.302,-134.420;Phoenix,33.448,-112.074;Little Rock,34.746,-92.290;Sacramento,38.576,-121.494;Denver,39.739,-104.990;Hartford,41.764,-72.682;Dover,39.158,-75.524;Tallahassee,30.438,-84.281;Atlanta,33.749,-84.388;Honolulu,21.307,-157.858;Boise,43.618,-116.215;Springfield,39.798,-89.644;Indianapolis,39.768,-86.158;Des Moines,41.591,-93.604;Topeka,39.048,-95.678;Frankfort,38.200,-84.873;Baton Rouge,30.451,-91.187;Augusta,44.311,-69.779;Annapolis,38.979,-76.492;Boston,42.360,-71.058;Lansing,42.733,-84.555;Saint Paul,44.954,-93.091;Jackson,32.299,-90.185;Jefferson City,38.577,-92.173;Helena,46.589,-112.039;Lincoln,40.814,-96.703;Carson City,39.164,-119.767;Concord,43.207,-71.538;Trenton,40.220,-74.756;Santa Fe,35.687,-105.938;Albany,42.653,-73.756;Raleigh,35.780,-78.639;Bismarck,46.808,-100.784;Columbus,39.961,-82.999;Oklahoma City,35.468,-97.516;Salem,44.943,-123.035;Harrisburg,40.274,-76.884;Providence,41.824,-71.413;Columbia,34.000,-81.035;Pierre,44.368,-100.351;Nashville,36.163,-86.782;Austin,30.267,-97.743;Salt Lake City,40.760,-111.891;Montpelier,44.260,-72.575;Richmond,37.541,-77.436;Olympia,47.038,-122.901;Charleston,38.350,-81.633;Madison,43.073,-89.401;Cheyenne,41.140,-104.820""".split(";")
CITIES = [(n, float(a), float(o), "cap") for n, a, o in (c.split(",") for c in CITIES)]
CITIES += [(n, a, o, "world") for n, a, o in [
    ("Ottawa", 45.42, -75.70), ("Vancouver", 49.28, -123.12), ("Edmonton", 53.55, -113.49), ("Winnipeg", 49.90, -97.14),
    ("Toronto", 43.65, -79.38), ("Mexico City", 19.43, -99.13), ("Havana", 23.11, -82.37), ("Reykjavik", 64.15, -21.94),
    ("London", 51.51, -0.13), ("Paris", 48.86, 2.35), ("Madrid", 40.42, -3.70), ("Rome", 41.90, 12.50), ("Berlin", 52.52, 13.40),
    ("Cairo", 30.04, 31.24), ("Moscow", 55.76, 37.62), ("Istanbul", 41.01, 28.98), ("Delhi", 28.61, 77.21), ("Beijing", 39.90, 116.41),
    ("Seoul", 37.57, 126.98), ("Tokyo", 35.68, 139.69), ("Anchorage", 61.22, -149.90)]]

def fetch(t, fh):
    d, c = t.strftime("%Y%m%d"), t.strftime("%H")
    url = ("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
           f"?file=gfs.t{c}z.pgrb2.1p00.f{fh:03d}&var_PRMSL=on&var_APCP=on&var_HGT=on&var_UGRD=on&var_VGRD=on&var_TMP=on"
           "&lev_mean_sea_level=on&lev_surface=on&lev_500_mb=on&lev_10_m_above_ground=on&lev_2_m_above_ground=on"
           f"&subregion=&leftlon=0&rightlon=360&toplat=90&bottomlat=0&dir=%2Fgfs.{d}%2F{c}%2Fatmos")
    raw = urllib.request.urlopen(url, timeout=120).read()
    out = {}
    with tempfile.NamedTemporaryFile(suffix=".grib2") as f:
        f.write(raw); f.flush()
        for m in pygrib.open(f.name):
            key = {("prmsl", 0): "p", ("gh", 500): "z5", ("u", 500): "u5", ("v", 500): "v5", ("2t", 2): "t2",
                   ("10u", 10): "u10", ("10v", 10): "v10"}.get((m.shortName, m.level))
            if m.shortName == "tp":  # want the 6-hour bucket (GFS also writes 0-N h totals)
                a, b = map(int, m.stepRange.split("-"))
                if b - a == 6: key = "pr"
            if not key: continue
            v = m.values
            if m.latlons()[0][0, 0] > 0: v = v[::-1]  # GFS rows already run 0N->90N; guard in case NOAA flips them
            out[key] = np.ma.filled(v, 0).astype(float)
    return out  # rows 0..90 N (S->N), cols lon 0..359

def smooth(a, n):  # 3x3 box blur
    for _ in range(n):
        p = np.pad(a, 1, mode="edge")
        a = sum(p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)) / 9
    return a

def to_pm180(a):  # lon 0..359 -> -180..180 (181 cols, last = first so the map seam closes), thin to 2°
    a = np.roll(a, 180, axis=1)
    a = np.concatenate([a, a[:, :1]], axis=1)
    return a[::2, ::2]

def bilin(a, lat, lon):  # a: raw 1° grid, rows 0..90N, cols 0..359E
    lon %= 360; y, x = lat, lon; i, j = int(y), int(x); fy, fx = y - i, x - j
    i2, j2 = min(i + 1, a.shape[0] - 1), (j + 1) % 360
    return (a[i, j] * (1 - fx) + a[i, j2] * fx) * (1 - fy) + (a[i2, j] * (1 - fx) + a[i2, j2] * fx) * fy

now = datetime.now(timezone.utc) - timedelta(hours=5)  # newest cycle takes ~4-5h to publish in full
for back in range(0, 30, 6):
    t = (now - timedelta(hours=back)).replace(minute=0, second=0, microsecond=0)
    t = t.replace(hour=t.hour // 6 * 6)
    try:
        raw = [fetch(t, fh) for fh in HOURS]
        break
    except urllib.error.URLError:
        continue
else:
    raise SystemExit("no complete GFS cycle available")

r1 = lambda x: round(float(x), 1)
fields = {"p": [], "pr": [], "h5": [], "w5": []}
for k, r in enumerate(raw):
    fields["p"].append(to_pm180(smooth(r["p"], 3)) / 100)
    fields["pr"].append(to_pm180(smooth(r["pr"], 1)) if "pr" in r else None)  # no accumulation at analysis time
    fields["h5"].append(to_pm180(smooth(r["z5"], 1)))
    fields["w5"].append(to_pm180(smooth(np.hypot(r["u5"], r["v5"]), 1)) * 1.944)  # m/s -> knots
cities = [{"n": n, "lat": a, "lon": o, "k": k, "v": [
    [r1(bilin(r["t2"], a, o) - 273.15), r1(bilin(r["p"], a, o) / 100), r1(bilin(r["u10"], a, o)), r1(bilin(r["v10"], a, o)),
     r1(bilin(r["pr"], a, o)) if "pr" in r else None] for r in raw]} for n, a, o, k in CITIES]
enc = lambda fr, nd: None if fr is None else [[round(float(v), nd) if nd else int(round(v)) for v in row] for row in fr]
json.dump({"cycle": t.isoformat(), "hours": HOURS, "lat0": 0, "lon0": -180, "d": 2,
           "p": [enc(f, 1) for f in fields["p"]], "pr": [enc(f, 1) for f in fields["pr"]],
           "h5": [enc(f, 0) for f in fields["h5"]], "w5": [enc(f, 0) for f in fields["w5"]], "cities": cities},
          open("data/pressure.json", "w"), separators=(",", ":"))
print("wrote", t, len(raw), fields["p"][0].shape)
