"""Narrative for pipeline/profile/OCCUPATIONS.md. Every figure quoted here is in a query result table of the report
(the query id is cited); if a rebuild changes a table, update the sentence that quotes it."""

HEADER = """
# Occupations feasibility profile (L-025)

Read-only profile for two proposed features: lists of the occupations most hired and most departed, and a filter by
occupation (job) on the dashboard. Built by `pipeline/profile/occupations.py` (employment parts, one source file at a
time, 179 files in about 30 s) and `pipeline/profile/occupations_report.py` (queries; each result cached under
`warehouse/profile/occ_results/`). Source: the 537 files of manifest 86d0cd47076a (Oct 2011 to Aug 2026).
Accessions and separations come from the warehouse action rows (`accession_rows`, `separation_rows`, effective month,
resolved department, actions effective before Oct 2011 excluded), so totals equal the cubes (GOV FY2025 departures
369,153 and t12 departures 329,623, Q4.3). Employment comes from per-file parts that reproduce `emp_org_month`
exactly (22,371 month-department rows, 381,459,856 person-months, 0 differences; checked when the parts were built).
"Series" means `occupational_series_code` as published. Hires = accession rows, departures = separation rows (metric
spec section 3); transfers are AA, AB in and SA, SB out. t12 = Sep 2025 to Aug 2026. The SQL for every table is in
the appendix.
"""

NOTES = {
'S1': """
**Answer.** All three datasets carry the same occupation fields in every one of the 179 files: the series
(`occupational_series_code`, `occupational_series`), OPM's family (`occupational_group_code`, `occupational_group`),
the PATCOB category (`occupational_category_code`, `occupational_category`), `stem_occupation` and
`stem_occupation_type`, and the pay plan (`pay_plan_code`, `pay_plan`) (Q1.1, Q1.2). The series code is never NULL
(Q1.3) and never REDACTED (Q2.4). The category is the weak field: on separations it is NULL 151,633 times and
"NO DATA REPORTED" 384,971 times (KDI-002, Q1.4), so it cannot be used for departures from Jun 2024.
""",
'S2': """
**Answer.** 721 distinct 4-digit series codes appear over all files (any dataset), 669 in the latest 12 months; 663
in the Aug 2026 employment file (Q2.1). There is no spelling drift: no code ever has two different spellings. The only
"second name" is a NULL name on 7 codes, on a handful of rows (Mar 2018 files; three codes in 2024 to 2026
separations) (Q2.2, Q2.3, Q3.2). One name sits on two codes legitimately: ELECTRICIAN is 2805 and 9940 (vessel jobs).
Unusable values are of two kinds only: `*` INVALID (accessions 2,379, separations 2,050, employment 155,963
person-months) and a blank code `' '` named "NO DATA REPORTED" (separations 19,140, accessions 7) (Q2.4). No REDACTED,
no other non-4-digit value. Rates stay under 0.15% everywhere (Q2.5) except separations FY2016 (1.72%, the Mar and Apr
2016 files), FY2024 (0.63%), FY2025 (2.77%) and FY2026 (1.94%).

**KDI-002 does reach the series code, but only a little.** In the Jun 2024 to Aug 2026 separations files, 532,342
rows have a bad category, and 517,002 of those still carry a valid 4-digit series (Q2.8). The blank-series rate rises
from 0.19% (files before Jun 2024) to 2.37%, peaking at 10.14% in the Mar 2026 file (Q2.9). Worst departments,
latest 12 months of separations: AM 11.83%, AG 6.75%, TR 6.43%, DN 6.33%, ST 5.62% (Q2.6). Employment is clean
(worst Aug 2026: RF 1.29% of 232; VA 0.26%; Q2.7). The blank code would rank 5th among government-wide departures
in FY2025 (9,988) and the latest 12 months (8,642) (Q4.2a, Q4.2b), so any list must show it as its own "not
reported" row with its count, not drop it. Recording it would need a known data issue entry (a KDI-002 scope
extension or a new KDI), which needs the owner's sign-off.
""",
'S3': """
**Answer.** OPM publishes the family. `occupational_group_code` equals the first two digits of the series code in
every published code-group pair (0 differ, Q3.1); it is NULL only for 7 codes on a few rows (Q3.2). The family name
is in `occupational_group`, with one spelling per code over all files (Q3.3, Q3.4 no variants). Aug 2026 has 59
families: 23 white-collar groups (00 to 22, named "... GROUP", for example 03 General Administrative, Clerical, and
Office Services 268,107; 06 Medical, Hospital, Dental, and Public Health 340,526; 22 Information Technology 84,894
with 3 codes) and 36 wage-system families (25 to 99, named "... FAMILY", for example 28 Electrical Installation and
Maintenance, 57 Transportation/Mobile Equipment Operation) (Q3.3).

Blue collar is distinguishable by the code, not the pay plan. Every 4-digit code of 2500 and above is category B
(BLUE COLLAR) and no code below 2500 is, in all three datasets over all files (Q3.5; the separations rows with a
blank category are KDI-002). Pay plan is not a clean test: in Aug 2026 employment, 161,482 people in wage codes are on
a W pay plan and 5,810 are not (BB 1,399, NA 1,229, XF 428, CY 412 and others, Q3.6, Q3.7); no code below 2500 is ever
on a W plan (Q3.6). So "blue collar" can be defined as series code 2500 and above (identical to OPM's category B
where the category is populated), which also works for separations where KDI-002 blanks the category.
""",
'S4': """
**Answer.** Government-wide the spread is wide: 582 series had hires and 646 had departures in FY2025; the top 10
cover 32.3% of hires and 33.8% of departures, the top 25 51.3% and 52.1% (Q4.3). Top hires FY2025: 1802 Compliance
Inspection and Support 8,317 (8,243 of them in HS), 0301 8,254, 0303 6,101, 0610 Nurse 5,561, 2210 IT 4,553 (Q4.1a).
Top departures FY2025: 0301 24,530, 0343 18,209, 2210 16,458, 0303 12,288, then the blank code 9,988 (Q4.2a).
Departments are far more concentrated: top 10 share of FY2025 hires HS 87.1%, TR 85.2%, DJ 76.4%, VA 65.2%,
DOD 30.9%; in the latest 12 months TR's 4,289 hires come from 38 series, 98.2% in the top 10 (Q4.3).

Transfers: among the top 10 government-wide, transfers are 5.0% of FY2025 departures (all series 4.4%) and 3.9% of
hires (all series 4.2%); the top 10 hold 26 to 38% of all transfers (Q4.4). Shares vary widely by series: 0201 Human
Resources Management hires are 33.7% transfers in FY2025, 0343 16.6%, 1102 Contracting 16.1% (Q4.1a). A top list
should therefore carry the transfer count per series, as the other pages do.
""",
'S5': """
**Answer.** At government level most series cells are usable: FY2025 departures 646 cells, 128 (19.8%) under 10 and
220 (34.1%) under 30; hires 582 cells, 28.4% under 10 and 47.1% under 30 (Q5.2). At department level small cells
dominate at every grain: FY2025 departures 4,654 cells, 59.4% under 10 and 76.0% under 30; hires 3,065 cells, 67.0%
and 83.2% (Q5.2); at fy and t12 grain over all years 63 to 64% under 10 and 80% under 30, admin grain 54 to 61% under 10 (Q5.1). Subelement level is 72 to
82% under 10 in the latest periods (Q5.4). For rates, 66.5% of department-series cells in FY2025 have an average headcount below 30 or of
0 (4,447 small base, 44 zero) against 11.9% at government level (Q5.5). Since the Look-Up already publishes every row
with its series and department, small cells disclose nothing new; the issue is noise and a page full of small-base
flags, not privacy.
""",
'S6': """
**Answer.** Sizes are the summed byte length of each row as compact JSON (the cube writer's convention), plus a small
per-file header; they are estimates within a few percent. For scale: all cubes today are 236.5 MB and the per-file cap
is 3 MB. A: top 25 plus "other" is 23.0 MB with every t12 window as the breakdown cubes have (GOV 0.40 MB), or 2.98 MB
with only the latest t12 window (Q6.1, Q6.2). B: every series is 87.9 MB with every t12 window and 8 files over the
3 MB cap (GOV 7.05 MB), or 11.0 MB with only the latest t12 window (GOV 0.88 MB, none over the cap) (Q6.3, Q6.4).
C: monthly by series is 3.4 MB for GOV (over the cap; 1.33 MB from Oct 2020), 30.9 MB for the 141 departments
(largest DOD 2.88 MB) and 8.3 MB for the 4 DOD agencies, about 42.6 MB in all; by family it is 8.5 MB in all with
GOV 0.32 MB (Q6.5, Q6.6, Q6.8). Subelement by series would add 119.8 MB in 653 files (largest AF1M 1.58 MB) (Q6.7).
D: the Look-Up already has the series on every action row, but its files are split by fiscal year, not by series:
one series over all years means loading all 32 action files, 43.1 MB, and the employment files hold only the latest
month (125 files, 8.0 MB), so D gives no headcount history at all (Q6.9).
""",
'S7': """
**Answer.** There is no person ID, so changes of series cannot be followed. A cheap lower bound: per fiscal year, the
gap between a series' September-to-September headcount change and its net flow; series gaps that offset each other
must be people who moved between series without a hire or departure. The total gap equals the core cube's
reconciliation gap (FY2013 944, FY2022 -29,450, FY2025 93,325, checked against `warehouse/cubes/core/GOV.json`).
Government-wide at least 20,950 to 33,096 people a year changed series in FY2013 to FY2024, 8 to 15% of the year's
hires (Q7.1); the FY2025 bound (12,018) is depressed by the large same-sign gap of that year (September departures
still in the September file). The gaps concentrate in the general series people are promoted or reassigned into:
FY2025 0343 +7,889, 2210 +6,524, 0301 +5,616, 0962 +4,295 (Q7.2). Summed over departments the bound is larger (FY2023
37,584 vs 33,096 government-wide, Q7.4), because moves between departments in the same series also show there.
Consequence: by occupation, headcount change and net flow differ by thousands a year in the largest series, so the
two must stay separate series (invariant 7) and the reconciliation rule cannot be applied per series.
""",
'S8': """
**Answer.** Signed scope (occupation spec, D-037): occupations at government, department, DOD agency and subelement
level. Same conventions as section 6 (compact JSON row bytes plus a 200 B header per file; one file per entity and
option; subelements are all 653 codes the core cubes have, including ended ones). The first three levels of Q8.1,
Q8.3 and Q8.4 reproduce the rows of Q6.4, Q6.6 and Q6.5, and the Q8.4 subelement row reproduces Q6.7.

- (a) Option B by series, latest t12 window only: subelements add 653 files, 674,174 rows, 31.35 MB, largest AF1M
  0.40 MB, none over 3 MB; all four levels 799 files, 900,874 rows, 42.31 MB, largest GOV 0.88 MB (Q8.1).
- (b) Option B by family: subelements 653 files, 196,617 rows, 9.13 MB, largest AF1M 0.06 MB; all four levels 799
  files, 11.43 MB, largest GOV 0.09 MB (Q8.2).
- (c) Option C1, monthly by family: subelements 653 files, 1,394,089 rows, 33.51 MB, largest AF1M 0.24 MB; all four
  levels 799 files, 42.05 MB, largest GOV 0.32 MB, none over the cap (Q8.3).
- (d) Option C2, monthly by series: subelements 653 files, 4,686,275 rows, 119.78 MB, largest AF1M 1.58 MB (as Q6.7);
  all four levels 799 files, 162.39 MB, with GOV 3.39 MB the one file over the cap (Q8.4). From Oct 2020 only:
  subelements 582 files, 45.98 MB, largest AF1M 0.59 MB; all four levels 720 files, 62.47 MB, GOV 1.33 MB, none over
  the cap (Q8.5).

Small cells dominate at subelement level: by series, 74.1% of FY2025 departure cells (16,186) and 75.1% at t12
(15,656) have under 10 departures; hires 81.9% (9,727 cells) and 79.2% (6,969). By family, 58.3% and 58.9% of
departure cells and 69.2% and 69.4% of hire cells are under 10 (Q8.6; the series rows equal Q5.4). In Aug 2026, 81
subelements have 1 to 29 employees (1,218 people in all), 187 have 30 to 499, 175 have 500 to 4,999 and 71 have 5,000
or more; 139 of the 653 codes have no employees that month (Q8.7).

Totals for a full occupations build (all four levels; one file per entity and option):

- S1 = B by series + C1 by family at all four levels + C2 by series at GOV only: 799 + 799 + 1 = 1,599 files,
  2,760,868 rows, 42.31 + 42.05 + 3.39 = 87.75 MB; the GOV C2 file (3.39 MB) is the one over the 3 MB cap, and
  limiting it to Oct 2020 onward makes S1 85.69 MB with none over (Q8.1, Q8.3, Q8.4, Q8.5).
- S2 = S1 + C2 at departments, DOD agencies and subelements: 799 + 799 + 799 = 2,397 files, 8,955,628 rows,
  42.31 + 42.05 + 162.39 = 246.75 MB, more than all cubes today (236.5 MB); the subelement C2 files alone are
  119.78 MB. With C2 from Oct 2020 only at every level: 799 + 799 + 720 = 2,318 files, 146.83 MB, none over the cap
  (Q8.1, Q8.3, Q8.5).
""",
}

RECOMMENDATION = """
Feasible, with the family as a free second level. The series code is complete, never redacted and spelled one way,
and OPM's family code and name come with every row, so no crosswalk or name grouping is needed; the one data issue to
sign is the blank separations code from Jun 2024 (KDI-002 scope), shown as its own "not reported" row. For the top
lists, option A at fy, latest t12 and administration grain costs about 3 MB (23 MB if every t12 window is kept, as the
breakdown cubes do); for flexibility, option B with only the latest t12 window (11 MB, no file over the cap) gives the
same lists plus rates and lets the page rank by either flow, so B is the better build, with A as the fallback. For the
filter, a family filter (option C by family, 8.5 MB for GOV, departments and DOD agencies) fits easily; a series
filter is 42.6 MB and needs GOV split (for example by year range) to meet the 3 MB cap; subelement level (another
120 MB) and the Look-Up route (43 MB per query, no headcount history) are not worth it. Department-series cells are
mostly under 10 events and two thirds of department-series rates would carry small-base flags, so department views
should default to families or to the top lists, with the series level offered government-wide. Headcount change and
net flow by occupation must stay separate and be labeled as such, since tens of thousands change series each year
without a hire or departure.
"""
