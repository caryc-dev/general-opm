# Page specification (Phase 3)

Status: draft, container only (sections 1 to 4), for signature. Contents per page and copy follow in later sections,
each signed before anything is built. Look: design option B, "Briefing" (D-023). Metrics are those of
`docs/metric-spec.md`; cubes are those of `docs/cube-plan.md`; nothing here changes a definition.

## 1. Shell (every page)
- Header: site name (to be decided, section 4) and the page tabs of section 2. No publisher name.
- Entity selector on every data page: government (default), a department, a Defense agency inside Defense, and a
  subelement where the page supports it (section 3). The choice carries across pages in the URL.
- Footer: source link to OPM's data API page, "Last updated" date, latest data month.
- One dark theme. Every chart has a table view and an SVG download. Phone width works without sideways page scroll;
  wide tables scroll inside their box.
- The browser only sums cube columns and divides; it never derives a definition.

## 2. Pages
| # | Page | Purpose | Cubes read | Sections, in order |
|---|---|---|---|---|
| 1 | Administrations (home) | Compare the first N months of each administration | admin, plus the matrix of section 4 | scoreboard (one card per administration); departments-by-administrations heat map (change, departure rate, hire rate, deferred resignation share; sortable); departure and hire rate bars; why people left |
| 2 | Workforce size | Headcount over time | core | headcount line by month, quarter or fiscal year with administration bands; change table |
| 3 | Hiring and departures | Flows over time | core | hires and departures with categories, DRP and transfers as their own series; rates with the three methods |
| 4 | Departments compared | Children of the selected entity side by side | compare | heat map and table of each child, fiscal year or trailing 12 months |
| 5 | Who is leaving | Departures by group | leaving | breakdowns of metric-spec section 9, fiscal year, trailing 12 months or administration |
| 6 | Who is joining | Hires by group | joining | as page 5, for hires |
| 7 | Appointments | Hires and departures by appointment group | appointments | groups and political subgroups by period |
| 8 | Look-Up | Row-level records | Look-Up | filters, table, CSV download |
| 9 | Reading the data | Method, known data issues, known breaks | metadata | definitions, KDI list, break list, sources |

## 3. Entity levels per page
| Page | Government | Department | Defense agency | Subelement |
|---|---|---|---|---|
| 1 Administrations | yes | yes (scoreboard, bars, reasons; the heat map highlights its row, or lists the 4 agencies for Defense) | yes | no (no admin cube, D-016) |
| 2, 3 | yes | yes | yes | yes |
| 4 | yes (its departments) | yes (its subelements) | yes (Defense: its agencies) | no |
| 5, 6, 7 | yes | yes | yes | no (spec section 9) |
| 8 | filters by any level | | | |

## 4. Open container questions
1. Heat map data. The heat map needs every department at the chosen month. Reading the 141 department admin files
   is 3.7 MB in 146 requests, over the 3 MB first-load budget. Proposal: one new small file (a "matrix" cube: per
   department, administration and month in office, the numerators and denominators of the four heat map metrics,
   with small-base and no-comparison flags). This changes `docs/cube-plan.md` and needs its own signature;
   data-engineer measures it before you sign.
2. Heat map rows. Default: departments with 5,000 or more employees at the Trump II start (20 departments), with
   a switch to show all; small-base cells marked, never hidden; entities that did not exist at an administration's
   month 0 shown as "n/a" (D-020).
3. Site name for the header and browser tab. No branding, but the page needs a name.
4. Reading the data page: the DOJ site ends it with an AI use disclaimer. This repo's rule is no mention of AI in
   committed files. Proposal: drop it.
