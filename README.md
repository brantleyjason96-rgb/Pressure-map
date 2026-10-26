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
