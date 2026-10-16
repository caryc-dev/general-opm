# web/ - the dashboard (static site)

Developer notes, not served copy.

## Run it locally

    node web/tools/dev-server.js            # http://127.0.0.1:8000/  (--port, --host, --cubes, --lookup)

The server serves `web/` and maps `/data/` to the staged cubes in `warehouse/cubes/` and `/data/lookup/` to
`warehouse/lookup/`, read-only (GET and HEAD only). Pages fetch `data/<cube>/...`, the promoted layout, so the same
code reads `web/data/` once cubes are promoted. Nothing is copied into `web/data/` by these tools.

## Tests

- Unit tests (Node 22 or later, no packages): `node --test web/tests/*.test.js`
- Browser smoke test and screenshots (needs Google Chrome): `node web/tests/smoke.mjs` (writes `web/_screens/`)

## Rules the code keeps

- Every visible string lives in `copy.json` (`strings`), keyed and worded exactly as the copy tables of
  `docs/page-spec.md`; plain text only, links added by code. `copy.test.js` compares them word for word.
- The browser only picks cube rows, sums cube columns and divides (ratio of sums): `assets/js/admin-model.js`.
- Every local asset URL carries `?v=<stamp>`, and scripts add it to what they fetch. After changing any served file:
  `node web/tools/bump-stamp.js` (the stamp test fails until you do).

## Files

- `index.html` (Administrations) and the other nine pages (`occupations.html` is page 10, shown between Appointments and Look-Up); `assets/css/site.css` (tokens and layout)
- `assets/js/core.js` (copy, formats, entity names), `svg.js` (SVG export), `shell.js` (header, nav, footer, URL,
  section frame), `admin-model.js` (page 1 figures), `page-admin.js` (page 1)
- `tools/dev-server.js`, `tools/bump-stamp.js`, `tools/stamp-lib.js`
- `assets/js/occ-model.js` (page 10 lists; rows of one occupation for the filter on pages 2 and 3, rates as core defines them),
  `occ-filter.js` (the filter's control, banner and URL: `family=<code>`, or `series=<code>` at government level),
  `page-occupations.js` (page 10); the Look-Up takes `occ=<series>` from page 10's links
