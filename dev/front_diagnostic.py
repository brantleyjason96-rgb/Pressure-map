"""Check the computer-found fronts against NOAA's hand-drawn fronts on REAL data. Read-only: it prints a report, writes nothing the site uses.

Run by the "front-diagnostic" GitHub workflow (GitHub's servers can reach NOAA; the development sandbox cannot):
    python dev/front_diagnostic.py            # real data
    python dev/front_diagnostic.py --selftest # fake data, to check the script itself

It reports: what NOAA's chart service offers; how many fronts the finder makes with each setting; how well each setting matches NOAA
(NOAA front points with a computer front within 300 km, type agreement, computer fronts with no NOAA front nearby); a text map of
North America; and every front near the US/Canada border."""
import itertools, json, math, os, re, sys, urllib.request
from datetime import datetime, timezone
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import gfs_to_json as G
from frontfind import detect_fronts, theta_e, DEFAULT

BASE = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer"
NA = dict(lat=(20, 72), lon=(-170, -50))
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SELFTEST = "--selftest" in sys.argv


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# ---- distances (vectorised: each point against every vertex)
def hav(la1, lo1, la2, lo2):
    p1, p2 = np.radians(la1), np.radians(la2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lo2 - lo1) / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def densify(pts, step_km=60):
    out = [pts[0]]
    for (a, b), (c, d) in zip(pts[:-1], pts[1:]):
        n = max(1, int(hav(a, b, c, d) // step_km))
        for k in range(1, n + 1): out.append((a + (c - a) * k / n, b + (d - b) * k / n))
    return out


def vertex_table(fronts):  # fronts: [{type, pts}] -> arrays of lat, lon, type index, front index
    la, lo, ty, fi = [], [], [], []
    for i, f in enumerate(fronts):
        for a, b in densify(f["pts"]): la.append(a); lo.append(b); ty.append(f["type"]); fi.append(i)
    return np.array(la), np.array(lo), np.array(ty), np.array(fi)


def nearest(pla, plo, table):
    la, lo, ty, fi = table
    if not len(la): return np.full(len(pla), 1e9), np.array([""] * len(pla)), np.full(len(pla), -1)
    d = hav(pla[:, None], plo[:, None], la[None, :], lo[None, :]); j = d.argmin(axis=1)
    return d[np.arange(len(pla)), j], ty[j], fi[j]


def inbox(la, lo, box=NA): return (la >= box["lat"][0]) & (la <= box["lat"][1]) & (lo >= box["lon"][0]) & (lo <= box["lon"][1])


def compare(noaa_tab, comp_tab, comp_fronts):
    nla, nlo, nty, _ = noaa_tab
    if not len(nla): return None
    d, ty, _ = nearest(nla, nlo, comp_tab)
    hit = d <= 300; cover = hit.mean(); same = (ty[hit] == nty[hit]).mean() if hit.any() else 0.0
    # computer fronts in North America whose in-box points are all > 400 km from any NOAA front
    bad = tot = 0
    cla, clo, _, cfi = comp_tab
    for i, f in enumerate(comp_fronts):
        m = (cfi == i) & inbox(cla, clo)
        if not m.any(): continue
        tot += 1; dd, _, _ = nearest(cla[m], clo[m], noaa_tab)
        if (dd > 400).all(): bad += 1
    prec = 1 - bad / tot if tot else 0.0
    f1 = 2 * cover * prec / (cover + prec) if cover + prec else 0.0
    return dict(cover=cover, same=same, found=tot, bad=bad, prec=prec, f1=f1)


# ---- NOAA charts
def parse_date(txt):
    m = re.search(r"(\w{3}) (\d+) (\d{4})", txt or "")
    return datetime(int(m.group(3)), MON.index(m.group(1)) + 1, int(m.group(2)), tzinfo=timezone.utc) if m and m.group(1) in MON else None


def noaa_charts():
    if SELFTEST: return fake_noaa()
    out = []
    try: meta = get_json(BASE + "?f=json")
    except Exception as e: print("NOAA service listing failed:", e); meta = {"layers": []}
    print("\n=== NOAA chart service layers ===")
    for L in meta.get("layers", []): print(f"  id {L['id']:>3}  {L.get('name')}  (parent {L.get('parentLayerId')}, subLayers {len(L.get('subLayerIds') or [])})")
    ids = [2, 14, 26] + [L["id"] for L in meta.get("layers", []) if re.search(r"front|analysis", L.get("name", ""), re.I) and L["id"] not in (2, 14, 26) and not L.get("subLayerIds")]
    for i in ids:
        try:
            gj = get_json(f"{BASE}/{i}/query?where=1%3D1&outFields=*&f=geojson")
        except Exception as e:
            print(f"layer {i}: query failed: {e}"); continue
        feats = [f for f in gj.get("features", []) if f.get("geometry")]
        if not feats: print(f"layer {i}: no features"); continue
        props = feats[0].get("properties", {}); date = parse_date(props.get("popupconte"))
        kinds = {}
        for f in feats: kinds[f["properties"].get("feat")] = kinds.get(f["properties"].get("feat"), 0) + 1
        print(f"layer {i}: {len(feats)} features, date {date.date() if date else '?'} | property keys: {sorted(props)[:8]} | popup: {str(props.get('popupconte'))[:110]!r} | kinds: {kinds}")
        out.append(dict(id=i, date=date, feats=feats))
    return out


def noaa_fronts(chart):
    out = []
    for f in chart["feats"]:
        kind = (f["properties"].get("feat") or "").replace(" Valid", "")
        if kind not in ("Cold Front", "Warm Front", "Stationary Front", "Occluded Front"): continue
        g = f["geometry"]; lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]] if g["type"] == "LineString" else []
        for l in lines:
            if len(l) >= 2: out.append(dict(type=kind, pts=[(y, x) for x, y in l]))
    return out


# ---- text map
def ascii_map(noaa_tab, comp_tab, title):
    print(f"\n--- {title}  (N = NOAA only, C = computer only, B = both within the same 2 degree cell, . = none) ---")
    la_edges, lo_edges = np.arange(72, 19, -2), np.arange(-170, -48, 2)
    def cells(tab):
        s = set()
        for a, b in zip(tab[0], tab[1]):
            if NA["lat"][0] <= a < NA["lat"][1] and NA["lon"][0] <= b < NA["lon"][1]: s.add((int((72 - a) // 2), int((b + 170) // 2)))
        return s
    n, c = cells(noaa_tab), cells(comp_tab)
    print("      " + "".join(str(abs(int(x)) // 10 % 10) if x % 10 == 0 else " " for x in lo_edges) + "   (longitude: tens digit of degrees W, every 10)")
    for r, la in enumerate(la_edges):
        print(f"{la:>4}N " + "".join("B" if (r, k) in n and (r, k) in c else "N" if (r, k) in n else "C" if (r, k) in c else "." for k in range(len(lo_edges))))


def describe(fronts, tab, noaa_tab, box, label):
    print(f"\n--- {label} ---")
    rows = []
    for i, f in enumerate(fronts):
        la = np.array([p[0] for p in f["pts"]]); lo = np.array([p[1] for p in f["pts"]])
        if not inbox(la, lo, box).any(): continue
        d, _, _ = nearest(la, lo, noaa_tab) if noaa_tab is not None and len(noaa_tab[0]) else (np.array([np.nan]), None, None)
        rows.append(f"  {f['type']:<17} strength {f.get('g', 0):.3f}  from ({f['pts'][0][0]:.1f}, {f['pts'][0][1]:.1f}) to ({f['pts'][-1][0]:.1f}, {f['pts'][-1][1]:.1f}), {len(f['pts'])} pts, median distance to a NOAA front {np.nanmedian(d):.0f} km")
    print("\n".join(rows) if rows else "  (none)")


# ---- real or fake inputs
def fake_noaa():
    line = lambda pts, t: {"properties": {"feat": t + " Valid", "popupconte": "Valid Oct 27 2026"}, "geometry": {"type": "LineString", "coordinates": [(b, a) for a, b in pts]}}
    return [dict(id=2, date=datetime(2026, 10, 27, tzinfo=timezone.utc), feats=[line([(52, -110), (48, -104), (44, -98), (40, -96)], "Cold Front"), line([(46, -90), (47, -80), (49, -70)], "Warm Front")])]


def fake_fields():
    lat = np.arange(-90, 91)[:, None] * np.ones((1, 360)); lon = np.ones((181, 1)) * np.arange(360)[None, :]
    dl = (lon - 255 + 180) % 360 - 180
    r = dict(t850=283 - 0.5 * np.abs(lat) + 22 * np.tanh((lat - 46) * 111 / 150) * np.exp(-(dl / 40) ** 2), r850=60 + 0 * lat, u850=np.zeros_like(lat), v850=np.full_like(lat, 10.0), sp=np.full((181, 360), 101000.0))
    return datetime(2026, 10, 27, tzinfo=timezone.utc), r


def main():
    t0, r = fake_fields() if SELFTEST else G.newest_cycle()
    print(f"GFS cycle {t0:%Y-%m-%d %H}Z; fields: {sorted(r)}")
    for k in ("t850", "r850", "u850", "v850", "sp"):
        print(f"  {k}: " + (f"min {r[k].min():.1f} max {r[k].max():.1f}" if k in r else "MISSING"))
    if not all(k in r for k in ("t850", "r850", "u850", "v850")): print("The 850 mb fields are missing, so no fronts can be found."); return
    th = theta_e(r["t850"], r["r850"], 850.0); th = np.where(np.isfinite(th), th, np.nanmean(th)); sp = r["sp"] / 100 if "sp" in r else None
    print(f"  theta_e: min {th.min():.1f} max {th.max():.1f}" + (f"; surface pressure below 880 hPa (850 mb underground) at {(sp < 880).mean() * 100:.1f}% of the globe" if sp is not None else ""))
    charts = noaa_charts()
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    usable = [c for c in charts if c["date"] and c["date"] <= today]
    chart = sorted(usable, key=lambda c: c["date"])[-1] if usable else None
    print("\nChart used for comparison (the one the app shows):", f"layer {chart['id']}, {chart['date'].date()}" if chart else "NONE (no chart dated today or earlier)")
    noaa = noaa_fronts(chart) if chart else []
    ntab = vertex_table(noaa)
    kinds = {k: sum(1 for f in noaa if f["type"] == k) for k in sorted({f["type"] for f in noaa})}
    print(f"NOAA fronts in that chart: {len(noaa)} lines {kinds}; {len(ntab[0])} points after densifying")

    # ---- try a grid of settings
    def run(cfg):
        fr = detect_fronts(th, r["u850"], r["v850"], cfg, surface_hpa=sp)
        return [dict(type=f["t"], g=f["g"], pts=[tuple(p) for p in f["p"]]) for f in fr]
    grid = [dict(grad_min=g, min_km=m, curvature=c, terrain_hpa=(DEFAULT["terrain_hpa"] if t else 0)) for g, m, c, t in itertools.product((0.035, 0.05, 0.07, 0.1), (1200, 1800), (True, False), (True, False))]
    results = []
    print("\n=== Settings compared with NOAA (North America) ===")
    print("  grad_min min_km curv terrain | global  NA | NOAA covered  type ok | computer fronts in NA  without NOAA nearby  precision |  score")
    for cfg in grid:
        fr = run(cfg); tab = vertex_table(fr); cm = compare(ntab, tab, fr)
        nna = sum(1 for f in fr if inbox(np.array([p[0] for p in f["pts"]]), np.array([p[1] for p in f["pts"]])).any())
        results.append((cm["f1"] if cm else 0, cfg, fr, tab, cm))
        if cm: print(f"  {cfg['grad_min']:<8} {cfg['min_km']:<6} {str(cfg['curvature'])[0]:<4} {str(bool(cfg['terrain_hpa']))[0]:<7} | {len(fr):>6} {nna:>3} | {cm['cover'] * 100:>9.0f}% {cm['same'] * 100:>7.0f}% | {cm['found']:>20} {cm['bad']:>19} {cm['prec'] * 100:>9.0f}% | {cm['f1']:.2f}")
        else: print(f"  {cfg}: {len(fr)} fronts (no NOAA fronts to compare)")
    default_fr = run({}); default_tab = vertex_table(default_fr)
    dcm = compare(ntab, default_tab, default_fr)
    print(f"\nCurrent defaults {({k: DEFAULT[k] for k in ('grad_min', 'min_km', 'curvature', 'terrain_hpa', 'lat_lo')})}: {len(default_fr)} fronts worldwide" + (f"; NOAA covered {dcm['cover'] * 100:.0f}%, type ok {dcm['same'] * 100:.0f}%, {dcm['bad']} of {dcm['found']} computer fronts in North America have no NOAA front nearby" if dcm else ""))
    results.sort(key=lambda x: -x[0]); best = results[0]
    print(f"Best of the grid by score: {best[1]} -> {len(best[2])} fronts worldwide, score {best[0]:.2f}")
    ascii_map(ntab, default_tab, "Current defaults vs NOAA"); ascii_map(ntab, best[3], "Best grid setting vs NOAA")

    # ---- the US / Canada border
    border = dict(lat=(42, 56), lon=(-128, -60))
    print("\n=== Fronts near the US/Canada border (lat 42-56N, lon 128-60W) ===")
    describe(noaa, ntab, None, border, "NOAA (hand-drawn)")
    describe(default_fr, default_tab, ntab, border, "Computer-found, current defaults")
    describe(best[2], best[3], ntab, border, "Computer-found, best grid setting")

    # ---- worldwide sanity
    print("\n=== Worldwide (current defaults) ===")
    by = {}
    for f in default_fr: by[f["type"]] = by.get(f["type"], 0) + 1
    print("fronts by type:", by, "| northern:", sum(1 for f in default_fr if f["pts"][0][0] > 0), "southern:", sum(1 for f in default_fr if f["pts"][0][0] < 0))
    st = sorted(f["g"] for f in default_fr)
    if st: print(f"strength (K/km) min {st[0]:.3f} median {st[len(st) // 2]:.3f} max {st[-1]:.3f}")


if __name__ == "__main__":
    main()
