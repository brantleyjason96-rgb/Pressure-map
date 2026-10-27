# Weather Forecast Project (pressure map)

A map for the 8th grade Earth Science final project. Each student picks a place on Earth and builds their **own** 3-day forecast
from the information on the map: highs and lows, fronts, land/sea breeze, windward/leeward, and ocean currents.

## Students never get a forecast
- The public file `data/pressure.json` holds **only the past**: the model analysis of the last 48 hours, up to now.
  `gfs_to_json.py` refuses to write it if any frame is later than the newest model cycle.
- Place pages show the present, the past 48 hours, and the normal high/low for the time of year (an average of the last 15 years).
- The forecast itself is published only as `data/teacher.enc`, encrypted with a passphrase.

## Teacher view
1. In the repo go to Settings → Secrets and variables → Actions → New repository secret.
2. Name it `TEACHER_PASSWORD` and use a long passphrase (several random words). The file is public but encrypted, so its
   strength is the strength of this passphrase.
3. Re-run the `publish-map` workflow. Click **Teacher** on the site and enter the passphrase.

Unlocked, the time slider continues past "Now" into orange FORECAST frames, the Teacher tab shows the model's highs/lows/wind/rain
for a place (pick a student's place on My Place), plus every 6 hours of the model forecast, to check their presentation. Reloading the page locks it again.

## Local effects (mountains and coast)
The **Local** tab has two tools. Both use only the present wind and temperatures, the past 48 hours, and fixed geography.
- **Windward / leeward.** Cuts a terrain profile along the wind through the place (elevation from Open-Meteo), says whether the
  place is on the windward or leeward side of the nearest range, and steps an air parcel over the ridge (cooling, cloud base,
  rain, then warming and drying on the far side). Students can change the wind direction or the starting air, or draw their own
  cross-section on the map.
- **Land and sea breeze.** Finds the nearest sea or large lake (Natural Earth coastlines), shows a day/night cross-section driven by
  the place's own daily temperature cycle, and a checklist of what a breeze needs (near water, weak background wind, big daytime heating).

## Where the data comes from, and its limits
| What | Source | Covers | Notes |
|---|---|---|---|
| Pressure, temperature, wind, rain, jet stream (past 48 h) | NOAA GFS analyses | whole world | public file, students see it |
| Forecast frames (to +96 h) | NOAA GFS | whole world | encrypted, **teacher only** |
| Fronts drawn by forecasters | NOAA WPC / unified surface analysis | the Americas and the Atlantic and Pacific only (roughly the equator to 80°N, 130°E eastward to 10°E) | no free machine-readable official fronts were found for Europe, Africa, Asia or the Southern Hemisphere |
| Fronts everywhere | `frontfind.py` on GFS 850 mb data | whole world | computer-found, rough, past frames for students, forecast frames for the teacher |
| 3-day forecast for any place | Open-Meteo (ECMWF, ICON, GFS), non-commercial use, attribution required | whole world | **teacher only**, fetched only after the teacher unlocks |
| Forecasters' fronts for the coming days | NOAA WPC Day 2 and 3 charts | North America | **teacher only** |

Research notes: [WPC coded surface bulletin](http://www.wpc.ncep.noaa.gov/html/read_coded_bull.shtml) and [NOAA's unified analysis page](https://ocean.weather.gov/unified_analysis.php)
describe the official fronts; [Open-Meteo terms](https://open-meteo.com/en/terms) cover the forecast service. The sandbox this was built in could not reach
any of them, so the request and response shapes for Open-Meteo and the NOAA chart service are written defensively but **were only tested against mock
responses**. If something does not show up on the live site, check the browser console and the publish log first.

**Teacher front check.** The Teacher tab compares the computer-found fronts with NOAA's hand-drawn fronts wherever both exist (North America) and reports
how many NOAA fronts it matched, how often it got the type right, and how many computer-found fronts have no NOAA front nearby. If it misses fronts
or invents them, open Actions, choose publish-map, press **Run workflow**, and set `front_grad_min` (default 0.022; lower finds more fronts) or
`front_min_km` (default 900). Leave them blank for the defaults.

## Fronts worldwide
`frontfind.py` finds fronts anywhere on Earth from the model, using the thermal front parameter on 850 mb equivalent potential temperature:
fronts lie along the sharpest temperature and moisture change; the wind across the line gives cold, warm or stationary. The data script
runs it on every frame, so the loop shows fronts moving. They are drawn thinner than NOAA's hand-drawn fronts (North America only), are
rough, and are clearly labeled "computer-found". Past frames are in the public file; forecast frames are only in the encrypted teacher file.
`python3 dev/test_frontfind.py` checks it on synthetic fronts.

In the teacher view the Play button runs from 48 hours ago straight through the model forecast to +96 hours.

## Ocean currents and fronts
- **Currents.** `data/currents.json` is a fixed, simplified teaching map of 21 major surface currents (path, warm or cold, plain-language
  weather effects). The Explore tab can draw them (click one for its description) and shade **sea-surface temperature** or **sea
  temperature vs. normal for the latitude**, which shows warm and cold currents as bands. The Local tab's **Ocean currents** tool finds
  the nearest current, the sea temperature offshore from the place, and compares the water with the air (fog, showers, or neither).
  Sea temperature comes from NOAA GFS surface temperature over ocean (the newest analysis only). If NOAA's file lacks those fields,
  the pipeline writes `sst: null` and the sea-temperature layers are hidden.
- **Fronts.** The **Temperature contrast** shading highlights bands where temperature changes fast, which is where fronts sit.
  A **ruler** measures distance and direction. **Draw a front** lets students mark fronts anywhere on Earth (outside the NOAA North
  America chart too). The My Place card lists the nearest fronts (NOAA and student-drawn) and a distance ÷ speed arrival calculator
  where the student supplies the speed.

## Predict: students play it forward themselves
The **Predict** tab lets a student pick Highs, Lows and fronts from the newest map, set how each one moves (direction, speed, and for
Highs/Lows how fast pressure changes), and press Play to watch their own projection over 72 hours. The measured motion of a High or Low is
filled in (editable); a front starts at zero speed because estimating it from the 48-hour loop is the student's job. Readouts show how far each
system is from their place at +24, +48 and +72 hours and when a front would reach it, always "in your projection".
- It only moves the systems along the path the student chose. It has no temperature, wind or rain, and it never touches the model forecast
  (the public data has none). It is labeled "not a forecast" on the tab and on the map.
- Projections save with the student's work file and show in the teacher's view of a student file.

## Working over several days
- **Saves automatically.** The place, notes, drawn fronts, units and the map view and settings are remembered in the student's browser, so
  they can close the page and continue tomorrow on the same computer.
- **💾 My work** downloads everything to one `.json` file and opens it again, on any computer. This is the backup: browser data is lost if
  cookies and site data are cleared or a different computer is used. A small orange dot on the button, and a banner in Notes, remind
  students when they have changes that are not in a backup file yet.
- **Teachers** can open a student's file in the Teacher tab to read their notes next to the model forecast for their place.
- **Hide / dock.** The side panel can be hidden to see the whole map; a dock of four buttons brings it back. Each tab's sections also
  collapse. Arrow keys move between tabs.
- **Help** (❓) explains the five steps and opens on a student's first visit.
- **Version.** The footer of the panel shows which version is live (the commit and publish time are stamped in by the workflow).

## Student notes
Students present their forecast themselves. The **My Notes** tab has a **3-day forecast plan** (one card per day: high and low, sky, rain or snow and chance, wind, pressure trend, a reason, and the biggest uncertainty) with a rules-of-thumb guide for getting the numbers. It holds only what the student types, never the model forecast, and it prints and saves with their work. Below it, the tab collects evidence by topic
(highs and lows, fronts, breeze, windward/leeward, currents). The 📌 buttons on the map and the place card pin what the
map shows into the notes. Notes can be printed, saved as PDF, copied, or downloaded as text, and the place charts can be
downloaded as a picture for slides. Everything stays in the student's own browser.

## Develop offline
`python3 dev/make_sample_data.py` writes **synthetic** data (teacher passphrase `sample`), then `python3 -m http.server`.
Needs `numpy` and `cryptography`. Sample data shows an orange "SAMPLE DATA" banner and is not real weather.

## Languages
The **🌐 language menu** in the panel header switches the whole site between English, Español, Français, Kreyòl ayisyen, Português and العربية (Arabic switches the panel to right-to-left). The choice is remembered in the browser.
- Translations live in `lang/<code>.json`, one object per language mapping each English string to its translation. `js/i18n.js` swaps the text on the page and in anything the app draws later. Sentences with numbers match as templates (`{#}` stands for a number).
- Anything without a translation stays in English. Known gaps: the step-by-step explanations on the **Local** tab (mountain, sea breeze and ocean-current text built from the place's data), the Teacher view, and the map's own labels.
- The translations were machine-written and have not been checked by a fluent speaker. Have one review them, especially the weather vocabulary, and fix any line directly in the JSON file.
- To add or fix text: open the site with `?i18n=1`, which records untranslated strings in `missing` of the i18n module, then add them to each `lang/*.json`.
