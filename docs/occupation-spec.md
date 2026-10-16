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
  of FY2025 departures and 1.94% of FY2026, tied to KDI-002 (from the Jun 2024 file; peak 10.1% in the Mar 2026 file)
  (Q2.4, Q2.8, Q2.9). It ranks 5th among government-wide departures (9,988 in FY2025). Proposed KDI-011 below.
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
