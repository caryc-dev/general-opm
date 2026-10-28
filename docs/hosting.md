# Hosting the dashboard (GitHub Pages)

The site is the `web/` folder. It goes live at **https://caryc-dev.github.io/general-opm/**.
A workflow in `.github/workflows/pages.yml` tests and publishes it on every push to `main`.

## 1. Turn on GitHub Pages (once)
1. On GitHub, open the repository **caryc-dev/general-opm** (it must be public, or on a paid plan).
2. Go to **Settings > Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or open **Actions > Deploy the dashboard to GitHub Pages > Run workflow**).

The workflow runs the web unit tests, collects `web/` (without screenshots, tests and dev tools) and publishes it.
Tests that need `warehouse/` or the database skip, because those are not in git. If a test fails, nothing is
published and the live site stays as it was.

## 2. Check the live site
- Open **Actions** and wait for the run to show a green check. The deploy step links to the site.
- Open https://caryc-dev.github.io/general-opm/ and click through every page.
- The footer shows the "Last updated" date and the latest data month. The date comes from the build stamp, which
  should match `web/build-stamp.json` in the commit you pushed. If a page still shows an older date, reload once;
  GitHub can take a minute or two.

Page addresses (all under https://caryc-dev.github.io/general-opm/):

| Page | File |
|---|---|
| Administrations | `index.html` |
| Workforce size | `workforce-size.html` |
| Hiring and departures | `hiring-and-departures.html` |
| Departments compared | `departments-compared.html` |
| Who is leaving | `who-is-leaving.html` |
| Who is joining | `who-is-joining.html` |
| Appointments | `appointments.html` |
| Occupations | `occupations.html` |
| Look-Up | `look-up.html` |
| Reading the data | `reading-the-data.html` |

## 3. Run it locally
`node web/tools/dev-server.js` serves the site at http://127.0.0.1:8000/ with the staged data from `warehouse/`.
To see exactly what is published, serve the promoted data instead:
`node web/tools/dev-server.js --cubes web/data --lookup web/data/lookup`.

## 4. Refreshing the data
When OPM publishes new months: download the new files into `data/` and run `.venv/bin/python pipeline/build_db.py`
until it prints ALL LOADED, then rebuild the cubes and the Look-Up files in `warehouse/`. Run
`.venv/bin/python tests/gate.py` until every check passes (except `promoted_matches_staged`, which promotion clears).
Promote with `.venv/bin/python pipeline/promote.py` (it takes no arguments and copies every staged set into
`web/data/`), then run `node web/tools/bump-stamp.js`. Run the web tests (`node web/tests/smoke.mjs`, then
`node --test 'web/tests/*.test.js'`) and the gate again, commit, and push: the push to `main` publishes the new data.
