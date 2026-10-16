# Occupations: feasibility and container spec (draft for signature)

Two features: lists of the occupations most hired and most departed, and a filter by occupation. Evidence:
`pipeline/profile/OCCUPATIONS.md` (L-025; every figure below cites its query there). Status: container signed
2026-10-16 (D-037), subelements included. Contents and copy follow once the container is signed (container, then contents, then copy).

## 1. Feasibility: yes

- **The field is clean.** Every file Oct 2011 to Aug 2026, in all three datasets, carries `occupational_series_code`
  and its name. It is never NULL and never REDACTED, and each code has one spelling (Q1, Q2.1 to Q2.3). 721 codes
  overall, 669 in the latest 12 months.
- **Families come from OPM.** OPM publishes `occupational_group_code` and `occupational_group` on every row, from its
  handbook of occupational groups and families; the cubes use these fields as published, never the series digits
  (D-039). The published group always equals the series' first two digits, one spelling per code, 59 families in Aug 2026 (23 white-collar groups,
  36 wage-system families) (Q3.1 to Q3.4). No crosswalk and no name grouping is needed (invariant 2).
- **Blue collar is the code, not the pay plan.** Codes 2500 and above are exactly OPM's blue-collar category; 5,810
  wage-code employees are not on a W pay plan (Q3.5 to Q3.7).
- **One data issue.** Departures with a blank series ("NO DATA REPORTED"): under 0.15% almost everywhere, but 2.77%
  of FY2025 departures and 1.94% of FY2026, tied to KDI-002 (from the Jun 2024 file; blank codes peak at 10.1% of the Mar 2026 file, 10.2% with `*`)
  (Q2.4, Q2.8, Q2.9). It ranks 5th among government-wide departures (FY2025: 9,988 blank plus 231 `*` = 10,219 Not reported). Proposed KDI-011 below.
- **Lists are spread out government-wide, concentrated in departments.** Top 10 series = about 33% of all hires and
  departures government-wide, top 25 about 52%; within departments the top 10 is 31% (DOD) to 87% (HS) of hires
  (Q4.3).
- **Small numbers.** Government-wide, 20 to 28% of FY2025 series cells have under 10 events; by department, 59 to
  67%, and two thirds of department-by-series rates would carry the small-base flag (Q5.2, Q5.5). The Look-Up already
  publishes every row with its series, so this is a readability issue, not a disclosure one.
- **Series changes without a hire or departure.** At least 21,000 to 33,000 people a year (8 to 15% of hires) change
  series in place (Q7.1). By occupation, headcount change and hires minus departures will differ by thousands in the
  big general series (0343, 0301, 2210), so both are shown as separate series (invariant 7) and the known-breaks
  rule is not applied per series.

## 2. Options and size (cubes today: 236.5 MB; cap 3 MB per file)

| Option | What it gives | Size |
|---|---|---|
| A. Top lists | top 25 series by hires and by departures plus "all other", GOV, departments, DOD agencies; fiscal year, latest 12 months, administration | 3.0 MB |
| B. Every series | every series with hires, departures, transfers, headcount at period end, rates; same entities and grains | 11.0 MB |
| C1. Filter by family | monthly headcount, hires, departures per family; GOV, departments, DOD agencies | 8.5 MB |
| C2. Filter by series | the same per series | 42.6 MB; GOV file 3.4 MB (over the cap, needs a split) |
| C3. Series by subelement | C2 one level down | +119.8 MB |
| D. Look-Up only | already built: row filter by occupation | 0 new; no counts over time |

(Q6.1 to Q6.9. Keeping every past 12-month window instead of the latest only would make A 23 MB and B 88 MB.)

## 3. Recommendation

1. **Build B, latest 12-month window only (11 MB).** It gives the top lists and lets the page rank by hires,
   departures, net or rate, at series or family level, with transfers shown per row. A is a cut of B.
2. **Build C1 (family filter, 8.5 MB) and C2 for GOV only (3.4 MB, split into two files by year range).** Department
   pages filter by family; the government view can also filter by single series, where counts are large enough.
   Skip C3 and department-level series history.
3. **KDI-011:** blank series on departures from the Jun 2024 file onward is shown as its own row, "Not reported",
   never dropped and never shared out, with its count on every list it touches.
4. Total about 23 MB of new cubes (to about 259 MB). Gate checks: new cubes partition to their core totals (series
   rows sum exactly to the entity's hires, departures and headcount), stock and flow rollups, small-base flags,
   cube size.

## 4. Container decisions (for signature)

| # | Decision | Recommendation |
|---|---|---|
| O1 | Where the top lists live | A new page 10, "Occupations": hires and departures lists side by side for the selected entity and period, toggle series or family, sort by count or rate, click a row to filter |
| O2 | Which pages take the occupation filter | Page 2 (Workforce size) and page 3 (Hiring and departures): family at every level, series government-wide. Not pages 1, 4 to 7 in this round (their cubes would each need an occupation dimension) |
| O3 | Periods on the Occupations page | Fiscal year, latest 12 months, administration (whole term and first N months), as pages 5 and 6 |
| O4 | Levels | Government, department, DOD agency; not subelement |
| O5 | Data issue | KDI-011 as in section 3 (a known-data-issues entry, signed) |
| O6 | Look-Up | Unchanged: it already filters by occupation; optionally add the family code and name (a Look-Up field change) |

Once O1 to O6 are answered, sections 5 (contents) and 6 (copy) follow here, then a cube-plan amendment for the
data engineer.

## 4a. Answers (2026-10-16, D-037)
O1, O2, O3, O5 as recommended. O4: subelements included (the FBI is subelement DJ02 of Justice; department DJ and
agency DJ are the same entity, and only DOD has agencies between). O6: the Look-Up adds the family code and name.
Open, sizing: subelement lists and family filter are in; whether the single-series monthly history reaches
subelements (+119.8 MB, 653 files, Q6.7) is settled by the cube-plan amendment's size budget, for signature.

## 4b. Scope (2026-10-16, D-039)
Scenario S1 (OCCUPATIONS.md section 8, about 88 MB): option B (every series and every family; fiscal year, latest
12 months, administration) and option C1 (monthly by family) at government, department, DOD agency and subelement;
option C2 (monthly by single series) at government only, split to meet the 3 MB cap. Rows with no published family
(8 of 369,153 FY2025 departures; codes 0000, 0182, 0183) count under "Not reported" with KDI-011.

## 5. Contents (signed 2026-10-16, D-040)
Every item reads columns of the cubes in section 7; the browser picks rows, sums columns and divides, nothing more.
"Occupation" means a job series (4-digit code) or an occupational family (OPM's group), chosen by a level switch.
Shared rules as page-spec section 7 (provisional, partial, small-base flags, table view and SVG download per chart).

### 5.1 Page 10, Occupations (occupations cube)
| Item | Contents |
|---|---|
| Controls | entity (government, department, DOD agency, subelement); view: Yearly, Past 12 months, By administration (default Past 12 months); period; under By administration "whole term" or "first N months" (as page 5); level: Job series or Occupational family (default Job series at government, Occupational family elsewhere) |
| 10.1 Tiles | hires and departures in the period; number of occupations with at least one hire, and with at least one departure |
| 10.2 Most hired | horizontal bars, the 25 occupations with the most hires, with "show all": hires, share of the entity's hires, transfers in; sort by count (default) or hire rate |
| 10.3 Most departed | the same for departures: departures, share, transfers out, deferred resignations; sort by count (default) or departure rate |
| 10.4 Table | every occupation with activity or employees: employees at period end, hires, departures, hires minus departures, transfers in, transfers out, deferred resignations, hire rate, departure rate; every column sorts; CSV download |
| Row click | a family: opens page 3 filtered to that family for the same entity; a series at government level: page 3 filtered to that series; a series below government: the Look-Up filtered to that series and department (no series history below government, D-039) |
| Notes | "Not reported" row (KDI-011) shown in every list and table, never dropped; rates on small bases flagged; a line that headcount by occupation also moves when employees change series without a hire or departure (section 1) |

### 5.2 Occupation filter on page 2 (Workforce size) and page 3 (Hiring and departures)
| Item | Contents |
|---|---|
| Control | "Occupation": All (default), any occupational family; at government level also any job series; carried in the URL so page 10 can link to it |
| Page 2 with a filter | 7.1.1 tiles, 7.1.2 employees over time and 7.1.3 change vs hires minus departures, from the monthly occupation cubes (stocks take the period's last month, flows sum); 7.1.3 carries the series-change note; 7.1.4 by department is replaced by a note that it is not available for one occupation |
| Page 3 with a filter | 7.2.1 tiles, 7.2.2 hires and departures and 7.2.4 rates (all three methods, computed from the monthly headcount and flows as the metric spec defines them); 7.2.3 why people left, 7.2.5 hires by type and 7.2.6 transfers are replaced by a note that they are not available for one occupation (the monthly cubes hold headcount, hires and departures only) |
| Banner | while a filter is on, a line under the page title names the occupation, with "clear" |

## 6. Copy (approved in advance under D-029; strings land in copy.json from this table)
| Key | Text |
|---|---|
| shell.nav (changed) | Administrations · Workforce size · Hiring and departures · Departments compared · Who is leaving · Who is joining · Appointments · Occupations · Look-Up · Reading the data |
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
| p9.issues.kdi011 | Job series missing: some records have a blank or invalid job series (most years under 0.15%; among departures, 1.7% in fiscal 2016, 0.6% in 2024, 2.8% in 2025 and 1.9% in 2026). They are shown as "Not reported" in every occupation list, never dropped. |

## 7. Changes to signed documents (signed 2026-10-16, D-040)
- **Metric spec M-1, section 9:** add "Occupation (job series and family) is exempt from this section's level and grain
  limits: it is published by government, department, DOD agency and subelement, and monthly by family (by series at
  government level only), because the Look-Up already publishes every action with its subelement, effective month and
  series, so these counts disclose nothing the Look-Up does not (OCCUPATIONS.md Q5). Small-base flags apply as
  everywhere." The page 5 and 6 intros ("never month by month") stay true for their own breakdowns.
- **Metric spec KDI-011** (known data issues table and `pipeline/known_data_issues.csv`): "Occupational series blank
  (' ', "NO DATA REPORTED") or `*` INVALID: under 0.15% of records in most years; separations 1.72% in FY2016, 0.63% in
  FY2024, 2.77% in FY2025, 1.94% in FY2026 (from the Jun 2024 file, alongside KDI-002); and rows with a series but no published family
  (21 separations, 17 accessions, and 1,058 employee records in the March 2018 file)." Treatment: "Counted as their own 'Not reported' occupation in every occupation
  cube and list; never dropped or shared out; kept as published in the Look-Up."
- **Cube plan Amendment 2:** section 8 below, also appended to `docs/cube-plan.md` as a draft.
- **Page spec:** page 10 added to the shell's page list (section 2) and navigation; page 2 and 3 contents gain section
  5.2's filter rows; page 9 gains KDI-011.

## 8. Cube plan Amendment 2 (signed 2026-10-16, D-040): occupation cubes
| Cube | Entities | Grains | Contents | One file per | Size (OCCUPATIONS.md) |
|---|---|---|---|---|---|
| occupations | all (about 800: GOV, departments, DOD agencies, subelements) | fiscal year (every year), latest 12 months, administration whole term and first N months | one row per period and occupation, at series level and at family level: hires, departures, transfers in, transfers out, deferred resignations, headcount at period end, rate numerators and denominator (average month-end headcount), small-base flag, provisional and partial flags | entity | 42.3 MB series (Q8.1) + 11.4 MB family (Q8.2); largest GOV about 1 MB |
| occ_family_monthly | all (about 800) | month | per month and family: headcount, hires, departures (option C1) | entity | 42.1 MB (Q8.3); largest 0.32 MB |
| occ_series_monthly | GOV only | month | per month and series: headcount, hires, departures (option C2) | GOV, split Oct 2011 to Sep 2020 and Oct 2020 onward | 3.4 MB in two files (Q6.8) |
Total about 99 MB, about 11 MB more than the S1 estimate: S1 did not count the family rows of the occupations cube,
which are kept as their own rows so the browser never builds a grouping. Site total with the Look-Up about 0.39 GB,
under the 1 GB budget. "Not reported" (KDI-011) is a row like any occupation. Families are OPM's published fields
(D-039).
Gate checks, built with the cubes: `occupations_partition` (series rows and family rows each sum exactly to core's
hires, departures, transfers, DRP and period-end headcount for the entity and period); `occ_monthly_matches_core`
(monthly family rows, and GOV series rows, sum to core's monthly headcount, hires and departures); `occ_family_from_rows`
(each family row equals the raw recount grouped by the published group, independent of the series rows); plus the
existing stock_flow_rollups, small_base_flags, cube_size, output_manifest_hash and promoted_matches_staged, which
cover the new metas automatically.
