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
for a place, and you can open a student's saved file to compare it with the model. Reloading the page locks it again.

## Student hand-in
In **My Forecast**, students can print or save a PDF report, or save a `.json` file that the Teacher tab can open.

## Develop offline
`python3 dev/make_sample_data.py` writes **synthetic** data (teacher passphrase `sample`), then `python3 -m http.server`.
Needs `numpy` and `cryptography`. Sample data shows an orange "SAMPLE DATA" banner and is not real weather.
