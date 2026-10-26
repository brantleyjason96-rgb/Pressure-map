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
Students present their forecast themselves, so there is no forecast form. The **My Notes** tab collects evidence by topic
(highs and lows, fronts, breeze, windward/leeward, currents). The 📌 buttons on the map and the place card pin what the
map shows into the notes. Notes can be printed, saved as PDF, copied, or downloaded as text, and the place charts can be
downloaded as a picture for slides. Everything stays in the student's own browser.

## Develop offline
`python3 dev/make_sample_data.py` writes **synthetic** data (teacher passphrase `sample`), then `python3 -m http.server`.
Needs `numpy` and `cryptography`. Sample data shows an orange "SAMPLE DATA" banner and is not real weather.
