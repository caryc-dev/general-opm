# Page specification (Phase 3)

Status: sections 1 to 4 (container) signed 2026-10-15. Contents and copy per page follow, each signed before it is
built. Contents per page and copy follow in later sections,
each signed before anything is built. Look: design option B, "Briefing" (D-023). Metrics are those of
`docs/metric-spec.md`; cubes are those of `docs/cube-plan.md`; nothing here changes a definition.

## 1. Shell (every page)
- Header: site name "Reworked OPM Data Dashboard" (working title; also the browser tab) and the page tabs of
  section 2. No publisher name.
- Entity selector on every data page: government (default), a department, a Defense agency inside Defense, and a
  subelement where the page supports it (section 3). The choice carries across pages in the URL.
- Footer: source link to OPM's data API page, "Last updated" date, latest data month.
- One dark theme. Every chart has a table view and an SVG download. Phone width works without sideways page scroll;
  wide tables scroll inside their box.
- The browser only sums cube columns and divides; it never derives a definition.

## 2. Pages
| # | Page | Purpose | Cubes read | Sections, in order |
|---|---|---|---|---|
| 1 | Administrations (home) | Compare the first N months of each administration | admin, matrix (section 4) | scoreboard (one card per administration); departments-by-administrations heat map (change, departure rate, hire rate, deferred resignation share; sortable); departure and hire rate bars; why people left |
| 2 | Workforce size | Headcount over time | core; occ_family_monthly, occ_series_monthly under an occupation filter (D-040) | headcount line by month, quarter or fiscal year with administration bands; change table |
| 3 | Hiring and departures | Flows over time | core; occ_family_monthly, occ_series_monthly under an occupation filter (D-040) | hires and departures with categories, DRP and transfers as their own series; rates with the three methods |
| 4 | Departments compared | Children of the selected entity side by side | compare | heat map and table of each child, fiscal year or trailing 12 months |
| 5 | Who is leaving | Departures by group | leaving | breakdowns of metric-spec section 9, fiscal year, trailing 12 months or administration |
| 6 | Who is joining | Hires by group | joining | as page 5, for hires |
| 7 | Appointments | Hires and departures by appointment group | appointments | groups and political subgroups by period |
| 10 | Occupations | Most hired and most departed occupations (D-040) | occupations | tiles, most hired, most departed, table; series or family (docs/occupation-spec.md section 5.1); shown in the menu between Appointments and Look-Up |
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

## 4. Container decisions (answered 2026-10-15)
1. Heat map data: one new file, the matrix cube (amendment 1 to `docs/cube-plan.md`, signed separately). Measured
   from a prototype: 145 entities (141 departments and the 4 Defense agencies), 20,854 rows, 1.54 MB (0.34 MB
   compressed), one request.
2. Heat map rows: departments with 5,000 or more employees at the Trump II start by default (20 departments), with a
   switch to show all; small-base cells marked, never hidden; entities that did not exist at an administration's
   month 0 shown as "n/a" (D-020).
3. Site name: "Reworked OPM Data Dashboard", a working title, in the header and the browser tab.
4. No AI use disclaimer on the Reading the data page, for now.

## 5. Contents: page 1, Administrations (signed 2026-10-15)
Reads the admin cube of the selected entity and the matrix cube. Labels and notes are placeholders until the copy
section is signed. "N" is the months-in-office setting; "chosen" means the administrations switched on.

### 5.1 Controls
| Control | Values | Default |
|---|---|---|
| Entity | government; a department; a Defense agency (section 3) | government |
| Administrations | Obama II, Trump I, Biden, Trump II, each on or off; at least one on | all on |
| Months in office (N) | 1 to the shortest chosen administration's published months (Trump II: 20 in Aug 2026) | the maximum |

### 5.2 Scoreboard: one card per chosen administration, for the selected entity at month N
| Item | Definition (admin cube) |
|---|---|
| Percent change | headcount_change / headcount_0 |
| Change in employees | headcount_change |
| Trend line | headcount_change for months 0 to N (month 0 = 0); one vertical scale shared by all cards |
| Hires, departures | hires, departures at month N (running totals) |
| Marks | provisional months dashed; OPM-incomplete and known data issues in scope listed under the cards |

### 5.3 Heat map: rows by administration at month N (matrix cube)
| Item | Rule |
|---|---|
| Rows, government view | the government total first, then departments; by default those with headcount_0 of 5,000 or more at the Trump II start, with a switch to show all |
| Rows, department view | as the government view, with the selected department's row highlighted |
| Rows, Defense view | Defense first, then its 4 agencies |
| Columns | the chosen administrations, plus employees at the Trump II start |
| Metric tabs | change: headcount_change / headcount_0; departure rate: attrition_num / rate_den; hire rate: hire_num / rate_den; deferred resignation share: sep_drp / departures |
| Sorting | select a column heading; default by the latest chosen administration: change ascending, the other metrics descending |
| Colors | change: 7 steps, losses orange and gains blue, breaks at -30, -15, -5, 0, +5, +15%; rates and share: 5 steps, departure rate breaks 8, 12, 16, 24%, hire rate 5, 10, 15, 25%, share 15, 35, 55%; brighter means larger; every cell also shows its value |
| Empty and flagged cells | no comparison (D-020): "n/a"; deferred resignation share before Trump II: "n/a" (the program began in 2025); small base: hatched, value shown; provisional or OPM-incomplete: marked in the column heading |

### 5.4 Rates: bar comparison for the selected entity at month N
Departure rate and hire rate (annualized, as 5.3), one bar per chosen administration; small base flagged.

### 5.5 Why people left: share of departures at month N
Rows: deferred resignation, transfer out, quit, retirement, reduction in force, termination or expired appointment,
other (the seven-reason partition: sep_drp and the six *_nondrp columns, which sum to departures). One column per
chosen administration, each cell a percent with a short bar. Deferred resignation shows "n/a" before Trump II.

### 5.6 Every section
A table view and an SVG download; the notes under a section list its provisional months, OPM-incomplete months and
known data issues in scope, from the cube meta.

## 6. Copy: shell and page 1 (approved 2026-10-15, D-029)
Every string below is exact. {braces} are filled by code; links are added by code. Entity names are OPM's, shown in
title case ("Department of Housing and Urban Development"); where two names match, the code follows in brackets
("Department of Defense (DD)").

### 6.1 Shell
| Key | Text |
|---|---|
| shell.site_name | Reworked OPM Data Dashboard |
| shell.nav | Administrations · Workforce size · Hiring and departures · Departments compared · Who is leaving · Who is joining · Appointments · Occupations · Look-Up · Reading the data |
| shell.footer.source | Source: OPM Federal Workforce Data |
| shell.footer.updated | Last updated {date}. Data through {month}. |
| shell.chart.table | Show table |
| shell.chart.svg | Download SVG |
| shell.empty | No data for this selection. |

### 6.2 Page 1, Administrations
| Key | Text |
|---|---|
| p1.title | Compare administrations |
| p1.intro | How the federal workforce changed in the first months of each administration, for every department and agency. |
| p1.control.entity | Department or agency |
| p1.control.entity.all | All departments and agencies |
| p1.control.admins | Administrations |
| p1.control.months | Months in office |
| p1.control.months.value | First {n} months |
| p1.control.months.note | Month 1 is January of the inauguration year. Change is measured from the end of the December before. |
| p1.control.months.limit | Limited to {max} months: the shortest administration chosen. |
| p1.admin.years | {start} to {end} |
| p1.score.title | First {n} months in office |
| p1.score.change | {change} employees |
| p1.score.hires | Hires |
| p1.score.departures | Departures |
| p1.score.note | Same vertical scale on every card. |
| p1.heat.title | Every department, every administration |
| p1.heat.tab.change | Change |
| p1.heat.tab.dep | Departure rate |
| p1.heat.tab.hire | Hire rate |
| p1.heat.tab.drp | Deferred resignations |
| p1.heat.sub.change | Percent change in employees after {n} months in office. |
| p1.heat.sub.dep | Departures per year as a share of the average number of employees, first {n} months. |
| p1.heat.sub.hire | Hires per year as a share of the average number of employees, first {n} months. |
| p1.heat.sub.drp | Deferred resignations as a share of all departures, first {n} months. |
| p1.heat.sort | Select a column heading to sort. |
| p1.heat.col.entity | Department |
| p1.heat.col.size | Employees, Dec 2024 |
| p1.heat.filter | Showing departments with 5,000 or more employees in December 2024. |
| p1.heat.switch | Show all departments |
| p1.heat.na | n/a: the department did not exist at the start of that administration, or the Deferred Resignation Program had not begun (it began in 2025). |
| p1.heat.small | Hatched: fewer than 30 employees on average, so a few people move the rate a lot. |
| p1.rates.title | Departure and hire rates, first {n} months |
| p1.rates.dep | Departure rate |
| p1.rates.hire | Hire rate |
| p1.rates.note | Per year, as a share of the average number of employees. |
| p1.reasons.title | Why people left, first {n} months |
| p1.reasons.note | Share of departures. Deferred resignations are their own reason and are not counted again under the others. |
| p1.reason.drp | Deferred resignation |
| p1.reason.transfer | Transfer to another agency |
| p1.reason.quit | Quit |
| p1.reason.retire | Retirement |
| p1.reason.rif | Reduction in force |
| p1.reason.term | Termination or expired appointment |
| p1.reason.other | Other |
| p1.note.provisional | {admin}'s latest three months are provisional and may change. |
| p1.note.incomplete | OPM reports that Defense data were incomplete in June and July 2026. |
| p1.note.issues | Known data issues in this view: {ids}. See Reading the data. |

## 7. Contents: pages 2 to 9 (signed 2026-10-15)
Modeled on the DOJ pages. Every item reads columns that exist in the staged cubes; the browser picks rows, sums
columns and divides, nothing more. Entity levels per section 3. Shared rules: provisional periods dashed or hatched
with the provisional note; partial periods marked; small-base rates shown with a flag, never hidden; unknown values
counted in totals and named in a note, never a group; coverage shown when below 100%; every chart has a table view
and an SVG download. Rate methods (metric spec section 3): "Past 12 months" (A), "Fiscal year" (B, Yearly view
only), "Annual pace" (C).

### 7.1 Page 2, Workforce size (core; compare for 7.1.4)
| Item | Contents |
|---|---|
| Controls | entity; view: Yearly, Quarterly, Monthly (default Yearly); date range Oct 2011 to the latest month, with administration presets (default: full range) |
| 7.1.1 Tiles | employees in the latest month; change over 12 months (sum of the last 12 monthly headcount_change, and as a percent of the earlier month); change over the chosen range (sum of headcount_change in the range) |
| 7.1.2 Employees over time | headcount by period, administration bands shaded |
| 7.1.3 Change in employees vs hires minus departures | headcount_change and net_flow as paired bars per period; known breaks (pipeline/known_breaks.csv) marked at Yearly view and linked to Reading the data |
| 7.1.4 Employees by department | government view only: latest headcount of each department from the compare cube (latest 12-month row), largest first, top 25 with "show all"; department view: its subelements |

### 7.2 Page 3, Hiring and departures (core)
| Item | Contents |
|---|---|
| Controls | entity; view; date range; rate based on (A, B, C) in 7.2.4 |
| 7.2.1 Tiles | hires and departures in the past 12 months, each with the 12 months before as a second number; departure rate, method A, latest month, with the same month a year earlier |
| 7.2.2 Hires and departures | paired bars per period |
| 7.2.3 Why people left | stacked bars per period of the seven reasons (sep_drp and the six *_nondrp columns), which sum to departures |
| 7.2.4 Rates over time | departure rate (attrition_<m>_num / rate_<m>_den) and hire rate (hire_<m>_num / rate_<m>_den) by period, chosen method |
| 7.2.5 Hires by type | new hires (acc_new_hire) and transfers in (acc_transfer_in), stacked |
| 7.2.6 Transfers between agencies | transfers in (acc_transfer_in) and transfers out (sep_transfer_out) per period as their own series, never netted (D-007); with "departures from federal service" = the sum of sep_quit, sep_retirement, sep_rif, sep_termination and sep_other |

### 7.3 Page 4, Departments compared (compare)
| Item | Contents |
|---|---|
| Controls | entity (the parent: government, a department, or Defense); view: Yearly (any fiscal year, latest by default) or Past 12 months (the latest 12 months only: the compare cube holds one such window); rate based on (A, B, C as available) |
| 7.3.1 Heat map, children by fiscal year | rows: the parent's children (departments, subelements, or Defense's 4 agencies), the parent pinned on top; columns FY2012 to the latest fiscal year (partial marked); metric tabs: departure rate, hire rate, deferred resignation share (n/a before FY2025); same colors and "show all" rule as page 1 (5,000 or more employees by default at government level; all children otherwise) |
| 7.3.2 Table for the chosen period | one row per child, parent pinned: employees, hires, departures, transfers in, transfers out, departure rate, hire rate, deferred resignations; every column sorts |
| 7.3.3 Departure rate ranking | horizontal bars, highest first, a reference line at the parent's rate; the 25 largest children by employees, with "show all" |
| 7.3.4 Why people left, by child | one 100% bar per child of the seven reasons; the 25 largest children, with "show all"; "no departures" where none |

### 7.4 Page 5, Who is leaving (leaving; core for years lost)
| Item | Contents |
|---|---|
| Controls | entity; view: Yearly, Past 12 months, By administration (default Past 12 months); period; under By administration, "whole term" or "first N months" (admin and admin_n grains; N = Trump II's months so far) |
| 7.4.1 Tiles | departures, with the same period a year earlier (none under By administration); years of experience lost and average years per departure with coverage (core: years_of_service_lost, yos_known; the administration window as the sum of its month rows) |
| 7.4.2 Panels, one per dimension | years of service; age (OPM's "Less than 20" and "20 to 24" shown together as "Under 25"); supervisors and managers vs everyone else; education; veteran status; grade (GS and equivalents 1-7, 8-11, 12-13, 14-15; senior executives; wage system; all other plans) |
| Each panel | snapshot: departure rate per group (rate_num / rate_den) with departures, and a lighter bar for the period a year earlier (Yearly, Past 12 months); trend: the rate per group over every period of the view (one point per administration under By administration); unknown count in a line under the chart; not applicable shown as text |

### 7.5 Page 6, Who is joining (joining)
| Item | Contents |
|---|---|
| Controls | as page 5 |
| 7.5.1 Tiles | hires, with the same period a year earlier; new hires and transfers in |
| 7.5.2 Rate panels | age, education, veteran status, grade: hire rate per group (rate_num / rate_den), snapshot and trend as page 5 |
| 7.5.3 Share panels | prior federal service and early-career programs (interns and students, recent graduates, Presidential Management Fellows, other): share of hires (hires / share_den), no rate |

### 7.6 Page 7, Appointments (appointments)
| Item | Contents |
|---|---|
| Controls | entity; view: Yearly, Past 12 months, By administration |
| 7.6.1 Tiles | political appointee hires and departures since January 2025 (Trump II window) |
| 7.6.2 Hires and departures by group | the seven groups (career, career-conditional, excepted service, temporary and term, Senior Executive Service, political appointees, Schedule Policy/Career), paired bars for the chosen period; unknown named in a note |
| 7.6.3 Political appointees by administration | hires and departures per month in office for each administration (the admin window's count / its months), for all political appointees and each subgroup (Schedule C, noncareer SES, executive appointments), toggles as on the DOJ page |
| 7.6.4 Notes | conversions between appointment types are neither hires nor departures; no headcount by group in version 1 |

### 7.7 Page 8, Look-Up (Look-Up files)
| Item | Contents |
|---|---|
| Controls | records: Departures, Hires, Employees; for Departures and Hires a fiscal year (one file each, FY2012 to the latest, plus actions effective before October 2011), default the latest; for Employees a department (one file each, the latest month), chosen before anything loads |
| Filters | department, agency, subelement, effective month, reason or hire type, occupation, occupational family (OPM's published group, D-037), grade, age, supervisory status, appointment type (grouped as on page 7); free-text search; "count by" any filter field; "clear filters" |
| Summary and table | matching record count and counts by the chosen field; one row per record in the order of the signed fields (metric spec section 10), values as published, REDACTED as written, known data issue values marked and linked to Reading the data; 50 rows per page, every column sorts |
| Download | the filtered rows as CSV, OPM column names, values exactly as published |
The browser reads one file at a time and never joins files (invariant: Look-Up allowlist).

### 7.8 Page 9, Reading the data (fixed text)
Sections with anchors: data origin; how things are counted (employees, effective month, provisional months, fiscal
years, transfers between agencies); rates and categories (the three methods, small base, the seven reasons,
deferred resignations); known data issues (KDI-001 to KDI-010, from pipeline/known_data_issues.csv); known breaks
(the signed list, as a table by entity and fiscal year); redaction and coverage; revised files. No charts or
controls. No AI use section (D-025).

### 7.10 Page 10, Occupations, and the occupation filter on pages 2 and 3 (signed 2026-10-16, D-040)
Contents as `docs/occupation-spec.md` sections 5.1 and 5.2. Cube details (cube plan Amendment 2): "Not reported" is
code `NR` at both levels, with no rate; names come from the meta; one rate method per grain (fiscal year B, past 12
months A, administration annualized), as pages 5 and 6; flags from each file's period table; on pages 2 and 3 the
monthly cubes support all three methods, and series history at government level is split into `GOV_to_2020-09` and
`GOV_from_2020-10`.

### 7.9 Left out of version 1 (each needs a cube change, signed separately)
Quit and retirement rates (core holds departure and hire rate numerators only); departures and hires by occupation
(no occupation dimension, metric spec section 9); headcount by appointment group (the appointments cube holds counts
of hires and departures only, D-020); growth since a start year by child (DOJ's Components compared panel 3).

## 8. Copy: pages 2 to 9 (approved in advance, D-029)
Exact strings, as section 6. Reason labels reuse p1.reason.*; entity names as section 6. Figures quoted in 8.9 are
fixed text measured on the Aug 2026 data (warehouse/profile/REPORT.md, opm-context section 5).

### 8.0 Shared
| Key | Text |
|---|---|
| shared.view | View |
| shared.view.fy | Yearly |
| shared.view.fq | Quarterly |
| shared.view.month | Monthly |
| shared.view.t12 | Past 12 months |
| shared.view.admin | By administration |
| shared.view.note | Years run October to September, the federal fiscal year. |
| shared.range | Date range |
| shared.range.full | Full range |
| shared.period | Period |
| shared.period.fy | FY{yyyy} |
| shared.period.t12 | 12 months ending {month} |
| shared.period.partial | {period} (partial) |
| shared.admin.whole | Whole term |
| shared.admin.firstN | First {n} months |
| shared.rate | Rate based on |
| shared.rate.a | Past 12 months |
| shared.rate.b | Fiscal year |
| shared.rate.c | Annual pace |
| shared.rate.help.a | People who left in the 12 months up to each point, over the average number of employees in those months. |
| shared.rate.help.b | People who left in each fiscal year, over its average number of employees. A year still in progress shows the year so far. Yearly view only. |
| shared.rate.help.c | People who left in each period, scaled to a full year, over the period's average number of employees. |
| shared.rate.none | This rate is only available in the Yearly view. |
| shared.flag.provisional | Provisional: the latest three months may change as OPM updates its files. |
| shared.flag.partial | Partial: {period} so far runs through {month}. |
| shared.flag.ytd | {period}: year so far, not a full year. |
| shared.flag.small | Based on fewer than 30 employees on average: read with care. |
| shared.flag.break | Known gap; see Reading the data. |
| shared.prior | Year before: {value} |
| shared.unknown | {count} with unknown {dimension} are counted in the total but not shown as a group. |
| shared.na | not applicable: no employees in this group |
| shared.showAll | Show all |
| shared.showFewer | Show the 25 largest |
| shared.sort | Select a column heading to sort. |
| shared.mark.empty | - |

### 8.1 Page 2, Workforce size
| Key | Text |
|---|---|
| p2.title | Workforce size |
| p2.intro | How many people each department and agency employs, month by month since October 2011. |
| p2.tile.headcount | Employees |
| p2.tile.asof | As of {month} |
| p2.tile.change12 | Change over 12 months |
| p2.tile.changeRange | Change, {start} to {end} |
| p2.tile.firstNote | Measured from the end of {period}. |
| p2.chart.headcount | Employees over time |
| p2.chart.flow | Change in employees vs. hires minus departures |
| p2.chart.flow.change | Change in employees |
| p2.chart.flow.net | Hires minus departures |
| p2.chart.flow.note | These come from different OPM files and do not always match. Departures that take effect in September often leave the employee count in October. |
| p2.chart.byDept | Employees by department |
| p2.chart.bySub | Employees by subelement |

### 8.2 Page 3, Hiring and departures
| Key | Text |
|---|---|
| p3.title | Hiring and departures |
| p3.intro | Who was hired and who left, month by month since October 2011, counted in the month each action took effect. |
| p3.tile.hires | Hires, past 12 months |
| p3.tile.departures | Departures, past 12 months |
| p3.tile.rate | Departure rate, past 12 months |
| p3.chart.flows | Hires and departures |
| p3.chart.flows.hires | Hires |
| p3.chart.flows.departures | Departures |
| p3.chart.reasons | Why people left |
| p3.chart.reasons.note | Deferred resignations are their own reason and are not counted again under the others. |
| p3.chart.rates | Departure and hire rates |
| p3.chart.rates.dep | Departure rate |
| p3.chart.rates.hire | Hire rate |
| p3.chart.rates.note | Share of the average number of employees. |
| p3.chart.types | Hires by type |
| p3.chart.types.new | New hires |
| p3.chart.types.transfer | Transfers in from another agency |
| p3.chart.transfers | Transfers between agencies |
| p3.chart.transfers.in | Transfers in |
| p3.chart.transfers.out | Transfers out |
| p3.chart.transfers.federal | Departures from federal service |
| p3.chart.transfers.note | A transfer is a departure for one agency and a hire for another. Transfers are shown on their own and never netted: OPM's files have no personal identifier, so a transfer out cannot be matched to a transfer in. Departures from federal service leave transfers out. |

### 8.3 Page 4, Departments compared
| Key | Text |
|---|---|
| p4.title | Departments compared |
| p4.intro | How departments, or the parts of one department, compare on size, hiring and departures. |
| p4.parent | Compare the parts of |
| p4.heat.title | By fiscal year |
| p4.heat.tab.dep | Departure rate |
| p4.heat.tab.hire | Hire rate |
| p4.heat.tab.drp | Deferred resignations |
| p4.heat.na | n/a: not in OPM's files that year, or before the Deferred Resignation Program (2025). |
| p4.table.title | Side by side |
| p4.table.caption | {period}. Rates: {method}. |
| p4.col.name | Name |
| p4.col.employees | Employees |
| p4.col.hires | Hires |
| p4.col.departures | Departures |
| p4.col.tin | Transfers in |
| p4.col.tout | Transfers out |
| p4.col.dep | Departure rate |
| p4.col.hire | Hire rate |
| p4.col.drp | Deferred resignations |
| p4.ranking.title | Departure rate |
| p4.ranking.reference | {name} overall: {rate} |
| p4.reasons.title | Why people left |
| p4.reasons.note | Share of each one's departures in {period}. |
| p4.reasons.none | no departures |

### 8.4 Page 5, Who is leaving
| Key | Text |
|---|---|
| p5.title | Who is leaving |
| p5.intro | Departures by years of service, age, supervisory role, education, veteran status and grade. Groups are shown by fiscal year, 12-month period or administration, never month by month, so small groups do not point to individuals. |
| p5.tile.departures | Departures |
| p5.tile.yearsLost | Years of experience lost |
| p5.tile.avgYears | Average years of service per departure |
| p5.tile.coverage | Based on {pct} of departures with a known length of service. |
| p5.panel.los | By years of service |
| p5.panel.age | By age |
| p5.panel.sup | Supervisors and managers vs. everyone else |
| p5.panel.edu | By education |
| p5.panel.vet | By veteran status |
| p5.panel.grade | By grade |
| p5.bar.label | {rate} · {count} left |
| p5.bar.prior | Year before |
| p5.chart.note | Departure rate: share of the group's average number of employees who left in the period. |
| p5.chart.trend | Over time |

### 8.5 Page 6, Who is joining
| Key | Text |
|---|---|
| p6.title | Who is joining |
| p6.intro | Hires by age, education, veteran status, grade, prior federal service and early-career programs. Groups are shown by fiscal year, 12-month period or administration, never month by month. |
| p6.tile.hires | Hires |
| p6.tile.new | New hires |
| p6.tile.transfer | Transfers in |
| p6.panel.age | By age |
| p6.panel.edu | By education |
| p6.panel.vet | By veteran status |
| p6.panel.grade | By grade |
| p6.panel.prior | By prior federal service |
| p6.panel.programs | Early-career programs |
| p6.bar.label | {rate} · {count} hired |
| p6.chart.note | Hire rate: hires in the group, over the group's average number of employees in the period. |
| p6.share.note | Share of all hires in the period. |
| p6.chart.trend | Over time |

### 8.6 Group labels (pages 5 and 6)
| Key | Text |
|---|---|
| group.los.lt1 | Under 1 year |
| group.los.1_4 | 1 to 4 years |
| group.los.5_9 | 5 to 9 years |
| group.los.10_19 | 10 to 19 years |
| group.los.20_24 | 20 to 24 years |
| group.los.25_29 | 25 to 29 years |
| group.los.30plus | 30 years or more |
| group.age.under25 | Under 25 |
| group.age.range | {lo} to {hi} |
| group.age.65plus | 65 or older |
| group.sup.supervisor | Supervisors and managers |
| group.sup.other | Everyone else |
| group.edu.hs_or_less | High school or less |
| group.edu.some_college | Some college |
| group.edu.bachelors | Bachelor's degree |
| group.edu.masters_prof | Master's or professional degree |
| group.edu.doctorate | Doctorate |
| group.vet.veteran | Veterans |
| group.vet.nonveteran | Not veterans |
| group.grade.gs_1_7 | GS and equivalent, grades 1 to 7 |
| group.grade.gs_8_11 | GS and equivalent, grades 8 to 11 |
| group.grade.gs_12_13 | GS and equivalent, grades 12 to 13 |
| group.grade.gs_14_15 | GS and equivalent, grades 14 to 15 |
| group.grade.senior_exec | Senior executives |
| group.grade.wage | Federal Wage System |
| group.grade.other_plans | All other pay plans |
| group.prior.lt1 | Under 1 year of prior federal service |
| group.prior.1_4 | 1 to 4 years |
| group.prior.5_9 | 5 to 9 years |
| group.prior.10plus | 10 years or more |
| group.prog.intern_student | Interns and students |
| group.prog.recent_grad | Recent graduates |
| group.prog.pmf | Presidential Management Fellows |
| group.prog.other | All other hires |
| dim.los | years of service |
| dim.age | age |
| dim.sup | supervisory status |
| dim.edu | education |
| dim.vet | veteran status |
| dim.grade | grade |
| dim.prior | prior federal service |

### 8.7 Page 7, Appointments
| Key | Text |
|---|---|
| p7.title | Appointments |
| p7.intro | Hires and departures by type of appointment, from career staff to political appointees, compared across administrations. |
| p7.group.career | Career |
| p7.group.career_conditional | Career-conditional |
| p7.group.excepted | Excepted service |
| p7.group.temporary | Temporary and term |
| p7.group.ses | Senior Executive Service |
| p7.group.political | Political appointees |
| p7.group.schedule_policy | Schedule Policy/Career |
| p7.sub.schedule_c | Schedule C |
| p7.sub.noncareer_ses | Noncareer SES |
| p7.sub.executive | Executive appointments |
| p7.tile.hires | Political appointee hires since January 2025 |
| p7.tile.departures | Political appointee departures since January 2025 |
| p7.chart.groups | Hires and departures by type of appointment |
| p7.chart.political | Political appointees: hires and departures per month in office |
| p7.chart.political.note | Each administration's total divided by its months in office, so terms of different lengths compare. |
| p7.note.conversions | Moves between appointment types inside an agency, such as conversion to Schedule Policy/Career, are neither hires nor departures, so they do not appear here. |
| p7.note.executive | Executive appointments are positions OPM codes as executive excepted appointments (appointment types 36 and 46). |
| p7.note.schedulePolicy | Schedule Policy/Career began in June 2026. OPM classes it as a career appointment; it is shown on its own because it covers policy-influencing positions. |
| p7.note.unknown | {count} with an invalid appointment code are counted in the total but not shown as a group. |
| p7.note.noHeadcount | This version shows hires and departures only, not the number of employees in each type of appointment. |

### 8.8 Page 8, Look-Up
| Key | Text |
|---|---|
| p8.title | Look-Up |
| p8.intro | The individual records behind the dashboard: every hire and departure since October 2011, and every employee in the latest month, exactly as OPM published them. |
| p8.privacy | OPM publishes these records without names or personal identifiers. Where OPM withheld a value, it shows as REDACTED. |
| p8.ctl.records | Records |
| p8.ctl.records.separations | Departures |
| p8.ctl.records.accessions | Hires |
| p8.ctl.records.employment | Employees |
| p8.ctl.fy | Fiscal year the action took effect |
| p8.ctl.fy.before | Before October 2011 |
| p8.ctl.dept | Department |
| p8.ctl.dept.choose | Choose a department to load its employees as of {month}. |
| p8.ctl.filters | Filter |
| p8.ctl.filter.all | All |
| p8.ctl.search | Search |
| p8.ctl.search.placeholder | Search these records |
| p8.ctl.clear | Clear filters |
| p8.ctl.countBy | Count by |
| p8.summary.count | {count} matching records |
| p8.summary.none | No records match these filters. |
| p8.col.department | Department |
| p8.col.agency | Agency |
| p8.col.subelement | Subelement |
| p8.col.effective | Took effect |
| p8.col.processed | Processed |
| p8.col.reason | Reason |
| p8.col.hireType | Hire type |
| p8.col.drp | Deferred resignation |
| p8.col.occupation | Occupation |
| p8.col.family | Occupational family |
| p8.col.payPlan | Pay plan |
| p8.col.grade | Grade |
| p8.col.age | Age |
| p8.col.service | Years of service |
| p8.col.supervisory | Supervisory status |
| p8.col.appointment | Appointment type |
| p8.col.tenure | Tenure |
| p8.col.education | Education |
| p8.col.veteran | Veteran |
| p8.col.schedule | Work schedule |
| p8.col.pay | Annual pay |
| p8.col.state | Duty state |
| p8.col.snapshot | As of |
| p8.table.prev | Previous |
| p8.table.next | Next |
| p8.table.page | Page {page} of {pages} |
| p8.kdi.marker | OPM's value is shown as published; see Reading the data. |
| p8.download | Download CSV |
| p8.download.note | Downloads the records that match your filters, with OPM's column names and values exactly as published. |

### 8.9 Page 9, Reading the data
| Key | Text |
|---|---|
| p9.title | Reading the data |
| p9.intro | Where the data comes from, how it is counted, and what to watch for. Figures on this page are as of the August 2026 data. |
| p9.toc | On this page |
| p9.source.title | Data origin |
| p9.source.p1 | All data comes from the U.S. Office of Personnel Management's Federal Workforce Data. OPM publishes three monthly files: a snapshot of every employee at the end of the month, the hires (accessions) and the departures (separations). |
| p9.source.p2 | The dashboard covers October 2011 through the latest month OPM has published, and is updated when OPM releases new files. |
| p9.source.p3 | Departments, agencies and subelements are grouped by OPM's codes, not by name, and each is shown under its latest name with its whole history. Within Defense, OPM reports four agencies: the Departments of the Army, the Navy and the Air Force, and a fourth it also names Department of Defense, shown here as Department of Defense (DD). |
| p9.source.p4 | Each record is one person, but OPM's files have no personal identifier, so the dashboard cannot follow anyone from month to month or from one agency to another. |
| p9.count.title | How things are counted |
| p9.count.p1 | Employees are counted at the end of each month. For a quarter or a year, the count is the one at the end of its last month, never an average or a sum. |
| p9.count.p2 | Hires and departures are counted in the month they took effect, not the month OPM processed them. 97.9% of hires and 94.4% of departures are processed in the month they take effect. |
| p9.count.p3 | The latest three months are provisional: late actions can still add to them, so they are always marked. |
| p9.count.p4 | Years run from October to September, the federal fiscal year. A year or quarter still in progress is marked partial and covers only the months published so far. |
| p9.count.p5 | Change in employees and hires minus departures come from different files, so they do not always match. The dashboard shows both and never adjusts one to fit the other. |
| p9.count.p6 | Government totals include every transfer between agencies: a transfer is a departure for one agency and a hire for another. Transfers out have exceeded transfers in every year except fiscal year 2022, when Defense's move of military treatment facilities recorded 38,613 transfers in. |
| p9.rates.title | Rates and categories |
| p9.rates.p1 | A departure rate is the number of people who left, divided by the average number of employees over the same months, using month-end counts. A hire rate works the same way. |
| p9.rates.p2 | You can choose how a rate is measured: past 12 months, fiscal year, or annual pace. |
| p9.rates.p3 | When a rate is based on fewer than 30 employees on average it is shown with a flag, because a few people can move it a lot. |
| p9.rates.p4 | Each departure has one reason, from OPM's separation codes: transfer to another agency, quit, retirement, reduction in force, termination or expired appointment, or other. |
| p9.rates.p5 | Departures under the Deferred Resignation Program are flagged by OPM. In the "why people left" charts they are their own reason and are not counted again under the others; elsewhere they count under their original reason. |
| p9.issues.title | Known data issues |
| p9.issues.intro | Problems found in OPM's files and how the dashboard handles them. |
| p9.issues.kdi001 | Length of service counted from 1900: in OPM's files from June 2024 to July 2025, 7,665 departures and 5,391 hires show 124 to 126 years of service. They are treated as unknown; the Look-Up shows them as published. |
| p9.issues.kdi002 | Occupational category missing: from June 2024, OPM's departure files leave the broad occupational category empty on most records, so it is not used. |
| p9.issues.kdi003 | Duplicate rows: a few Defense units in May and June 2026 have exact duplicate rows, which overstate Defense in June 2026 by about 13,000. They are counted as published and flagged. |
| p9.issues.kdi004 | Housing and Urban Development rows from October 2024 to March 2025 have no department code; they are placed in HUD by their agency code and flagged. |
| p9.issues.kdi005 | Air Force rows from February to April 2015 have no department code; they are placed in Defense by their agency code and flagged. |
| p9.issues.kdi006 | OPM reports that Defense data were incomplete in June and July 2026; those months are flagged for Defense and the government total. |
| p9.issues.kdi007 | Grade is withheld on about 0.1% of employee records; grade groups show it as unknown. |
| p9.issues.kdi008 | One hire in the August 2016 file has no department code; it is placed by its agency code and flagged. |
| p9.issues.kdi009 | A few records show more than 100 years of service outside the 1900 problem; they are treated as unknown. |
| p9.issues.kdi010 | Seven hires in 2026 files show a negative length of service; they are treated as unknown. |
| p9.issues.kdi011 | Job series missing: some records have a blank or invalid job series (most years under 0.15%; among departures, 1.7% in fiscal 2016, 0.6% in 2024, 2.8% in 2025 and 1.9% in 2026). They are shown as "Not reported" in every occupation list, never dropped. |
| p9.breaks.title | Known breaks |
| p9.breaks.p1 | For each department and fiscal year, the dashboard compares the change in employees with hires minus departures. Where they differ by more than 5% of the average number of employees and more than 20 people, the year is listed below. Most come from September departures that leave the employee count in October: in September 2025, 132,949 departures took effect, 106,883 of them deferred resignations, while the employee count fell 28,342 in September and 92,685 in October. |
| p9.breaks.col.entity | Department |
| p9.breaks.col.fy | Fiscal year |
| p9.breaks.col.gap | Difference |
| p9.redact.title | Withheld values |
| p9.redact.p1 | OPM withholds pay, duty location and some other fields for many employees: about 47% of employee records in August 2026, including every Defense record. The dashboard therefore shows no pay or location breakdowns; the Look-Up shows REDACTED where a value was withheld. |
| p9.revisions.title | Revised files |
| p9.revisions.p1 | OPM sometimes reissues a month's files; in October 2026 it reissued every file. When that happens the dashboard reloads them, and figures can change. |

### 8.10 Page 10, Occupations, and the occupation filter (approved under D-029, signed D-040)
| Key | Text |
|---|---|
| p10.title | Occupations |
| p10.intro | Which jobs agencies are hiring for and losing, by job series or occupational family, as OPM classifies them. |
| p10.level.label | Group by |
| p10.level.series | Job series |
| p10.level.family | Occupational family |
| p10.tile.hires | Hires |
| p10.tile.departures | Departures |
| p10.tile.withHires | Occupations with hires |
| p10.tile.withDepartures | Occupations with departures |
| p10.hired.title | Most hired |
| p10.departed.title | Most departed |
| p10.sort.label | Sort by |
| p10.sort.count | Number |
| p10.sort.rate | Rate |
| p10.bar.hired | {count} hired · {share} of hires |
| p10.bar.departed | {count} left · {share} of departures |
| p10.col.occupation | Occupation |
| p10.col.employees | Employees at end of period |
| p10.col.hires | Hires |
| p10.col.departures | Departures |
| p10.col.net | Hires minus departures |
| p10.col.transferIn | Transfers in |
| p10.col.transferOut | Transfers out |
| p10.col.drp | Deferred resignations |
| p10.col.hireRate | Hire rate |
| p10.col.departureRate | Departure rate |
| p10.notReported | Not reported |
| p10.note.notReported | "Not reported" counts records where OPM left the job series or family blank or invalid. See Reading the data. |
| p10.note.moves | Employees also move between job series without being hired or leaving, so the change in employees in an occupation can differ from its hires minus departures. |
| p10.note.seriesBelowGov | Single job series over time is shown government-wide only. Below that level, open the Look-Up for the records. |
| filter.occ.label | Occupation |
| filter.occ.all | All occupations |
| filter.occ.banner | Showing {occupation} only. |
| filter.occ.clear | Clear |
| filter.occ.unavailable | Not available for a single occupation. |
