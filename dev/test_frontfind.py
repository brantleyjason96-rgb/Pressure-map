"""Checks for frontfind.py on synthetic fields with known fronts. Run: python3 dev/test_frontfind.py"""
import sys
import numpy as np
sys.path.insert(0, ".")
from frontfind import detect_fronts, theta_e

lat = np.arange(-90, 91)[:, None] * np.ones((1, 360)); lon = np.ones((181, 1)) * np.arange(360)[None, :]
fails = 0
CFG = dict(grad_min=0.022, min_km=900, lat_lo=15)     # the synthetic fronts are gentler than real ones
def ok(cond, msg):
    global fails
    print(("ok   " if cond else "FAIL ") + msg); fails += (not cond)

def step_field(lat0, lon0, width_deg=40, amp=8.0, wide_km=150):
    """warm (high theta_e) toward the equator side of lat0, only near lon0 so the front has two ends"""
    dl = (lon - lon0 + 180) % 360 - 180
    taper = np.exp(-(dl / width_deg) ** 2)
    sgn = 1 if lat0 > 0 else 1                                  # warm air to the north of the line in both hemispheres
    return 300 + 20 * np.cos(np.radians(lat)) ** 2 + amp * taper * np.tanh((lat - lat0) * 111 / wide_km) * sgn

def run(lat0, lon0, vwind):
    th = step_field(lat0, lon0)
    u = np.zeros_like(th); v = np.full_like(th, vwind)
    return detect_fronts(th, u, v, CFG)

for lat0 in (45, -45):
    fr = run(lat0, 180 if False else 120, 10.0)
    ok(len(fr) == 1, f"lat {lat0}: exactly one front found ({len(fr)})")
    if fr:
        f = fr[0]; P = np.array(f["p"])
        ok(abs(np.median(P[:, 0]) - lat0) < 1.5, f"lat {lat0}: line sits at {np.median(P[:, 0]):.1f}")
        ok(f["t"] == "Cold Front", f"lat {lat0}: wind from the cold side -> {f['t']}")
        ok(P[0, 1] < P[-1, 1], f"lat {lat0}: cold front moving north is drawn west->east (symbols on the north side)")
    fw = run(lat0, 120, -10.0)
    ok(len(fw) == 1 and fw[0]["t"] == "Warm Front", f"lat {lat0}: wind from the warm side -> {fw[0]['t'] if fw else None}")
    if fw: ok(fw[0]["p"][0][1] > fw[0]["p"][-1][1], f"lat {lat0}: warm front moving south is drawn east->west")
    fs = run(lat0, 120, 0.5)
    ok(len(fs) == 1 and fs[0]["t"] == "Stationary Front", f"lat {lat0}: little cross wind -> {fs[0]['t'] if fs else None}")

import json
ok(len(json.dumps(run(45, 120, 10.0))) > 50, "output is plain JSON (no numpy types)")
ok(detect_fronts(np.full((181, 360), 300.0), np.zeros((181, 360)), np.zeros((181, 360)), CFG) == [], "a uniform field has no fronts")
tropic = 300 + 8 * np.tanh((lat - 5) * 111 / 150) * np.exp(-(((lon - 120 + 180) % 360 - 180) / 40) ** 2)
ok(detect_fronts(tropic, np.zeros_like(tropic), np.full_like(tropic, 10.0), CFG) == [], "no fronts are reported in the deep tropics")
weak = 300 + 0.5 * np.tanh((lat - 45) * 111 / 150) * np.exp(-(((lon - 120 + 180) % 360 - 180) / 40) ** 2)
ok(detect_fronts(weak, np.zeros_like(weak), np.full_like(weak, 10.0), CFG) == [], "a very weak contrast is not called a front")
fd = run(45, 180, 10.0)
jumps = [abs(b[1] - a[1]) for f in fd for a, b in zip(f["p"][:-1], f["p"][1:])]
ok(len(fd) >= 1 and (not jumps or max(jumps) < 20), f"a front across the date line is split, no wild jumps (max step {max(jumps) if jumps else 0:.1f} deg)")
# a front over high ground (850 mb underground) is ignored, and the same front over low ground is kept
th = step_field(45, 120); u0 = np.zeros_like(th); v0 = np.full_like(th, 10.0)
low, high = np.full_like(th, 1000.0), np.full_like(th, 800.0)
ok(len(detect_fronts(th, u0, v0, CFG, surface_hpa=low)) == 1, "a front over low ground is kept")
ok(detect_fronts(th, u0, v0, CFG, surface_hpa=high) == [], "a front where 850 mb is below ground is ignored")
# two parallel fronts with a weak minimum of contrast between them: with the curvature rule only the two real fronts survive
dl = (lon - 120 + 180) % 360 - 180; taper = np.exp(-(dl / 40) ** 2)
two = 300 + 20 * np.cos(np.radians(lat)) ** 2 + 8 * taper * (np.tanh((lat - 40) * 111 / 150) + np.tanh((lat - 44.5) * 111 / 150))
loose = dict(grad_min=0.008, min_km=900, lat_lo=15)
band = lambda fr: [f for f in fr if 35 < np.median([q[0] for q in f["p"]]) < 50]
with_rule, without_rule = band(detect_fronts(two, u0, v0, {**loose, "curvature": True})), band(detect_fronts(two, u0, v0, {**loose, "curvature": False}))
ok(len(with_rule) == 2 and len(without_rule) == 3, f"curvature rule drops the weak minimum between two fronts ({len(without_rule)} lines -> {len(with_rule)})")
ok(all("g" in f and f["g"] > 0 for f in with_rule), "each front reports its strength")
ok(detect_fronts(step_field(45, 120), u0, v0, {**CFG, "strong_min": 0.5}) == [], "strong_min filters out fronts that are not strong enough")
# theta_e is sensible: warmer and wetter air has higher theta_e
a, b = theta_e(np.array([283.0]), np.array([40.0])), theta_e(np.array([283.0]), np.array([90.0])); c = theta_e(np.array([290.0]), np.array([90.0]))
ok(300 < a[0] < 320 and b > a and c > b, f"theta_e rises with moisture and temperature ({a[0]:.1f}, {b[0]:.1f}, {c[0]:.1f} K)")
print("ALL PASSED" if not fails else f"{fails} FAILED"); sys.exit(1 if fails else 0)
