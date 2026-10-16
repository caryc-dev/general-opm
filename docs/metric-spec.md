# Metric specification (government-wide)

Status: signed 2026-10-14; amended and signed 2026-10-14 (KDI-008; GG and GW in the GS bands; entity start rows,
KDI-009, section 8 list sentence; KDI-010 and Look-Up fields 2026-10-15). Changes need a new
signature.
Source: OPM Federal Workforce Data, Employment (month-end on-board snapshot), Accessions and Separations (personnel
actions), October 2011 to the latest published month. All figures are counts of rows; one row is one person.

## 1. Entities
| Level | Key | Notes |
|---|---|---|
| Government | all rows | The default view. Equals the sum of departments exactly. |
| Department | `department_code` | 125 in Aug 2026. Shown under its latest name. |
| DOD agency | `agency_code` within DOD | AF, AR, DD, NV: an extra layer inside Defense only. Elsewhere agency equals department. |
| Subelement | `agency_subelement_code` | 514 in Aug 2026; most are small and carry small-base flags. |
- Grouping is always by code, never by name. Each code is one entity with its whole history under its latest name;
  codes are not merged across reorganizations.
- An entity's rows begin at its first month with headcount or actions and end at its last; its first and last
  quarter and fiscal year are partial. A
  month with no rows keeps headcount 0 as published; rates with a zero denominator are empty, never 0/0.
  Exception (D-034): the trailing-12-month comparison includes every entity with a month inside the window, so
  children sum exactly to their parent; an entity that ended inside the window carries its in-window flows and
  has headcount 0 after its last month.
- Rows whose department code is missing or "No Data Reported" are placed in the department of their
  agency code (every agency code belongs to exactly one department in every other month), and flagged as a known
  data issue (KDI-004, KDI-005). This keeps every person in exactly one department.

## 2. Time
- Hires and departures are counted by the month the action took effect, not the month OPM processed it. The newest
  3 effective months are provisional and flagged.
- Actions effective before October 2011 that appear in later files are outside the monthly series (those months
  are incomplete); they remain in the Look-Up.
- Grains: month, fiscal quarter, fiscal year (FY2025 = Oct 2024 to Sep 2025). Stocks take the period's last month;
  flows sum; rates recompute from sums. Unfinished periods are marked partial.
- Administrations: Obama II 2013-01 to 2016-12, Trump I 2017-01 to 2020-12, Biden 2021-01 to 2024-12, Trump II
  2025-01 to the latest month. Month 1 = January of the inauguration year; month 0 = the month before.

## 3. Core metrics
| Metric | Definition |
|---|---|
| Headcount | Rows in the month's employment file, as published. A stock: a quarter or year shows its last month. Never summed across months. |
| Hires | Accession rows effective in the period. |
| Departures | Separation rows effective in the period. Transfers out and DRP included. |
| Net flow | Hires minus departures. Not derived from, and not reconciled to, headcount change. |
| Headcount change | Headcount at the period's end minus headcount at the previous period's end. Its own series. |
| Attrition rate | Departures / average month-end headcount. Methods, chosen by the viewer: (A, default) trailing 12 months, none before Sep 2012; (B) fiscal year, year to date when partial, not annualized; (C) annualized per period (x 12 / months, over published months when partial). |
| Hire rate | Hires / average month-end headcount, same three methods. |
| Small base | Average headcount (of the chosen method) below 30: the rate is shown with a flag, never hidden. |
| Years of service lost | Sum of length of service over departures, with coverage; KDI-001 and missing values count as unknown. |

## 4. Categories
| Series | Codes |
|---|---|
| Transfer out | SA + SB |
| Quit | SC |
| Retirement | SD + SE + SG |
| RIF | SH |
| Termination: expired appointment or other | SJ |
| Other | SL |
| DRP | `drp_indicator = 'Y'`: an overlay on all series; in "why people left" charts a seventh reason, taken out of the six so the seven sum to departures. |
| New hire | AC + AD + AE |
| Transfer in | AA + AB (AB: mass transfer in) |
- Appointment groups as in the DOJ crosswalk, with type 65 (limited emergency SES) in the SES group and type `*`
  (INVALID) as its own unknown group. Every code found in the files is mapped; the gate fails on an unmapped code.

## 5. Transfers between agencies
Government totals include every hire and departure, so departments sum to the government. Transfers in and
transfers out are always available as their own series, so departures from federal service can be read without
them. Nothing is netted: transfers cannot be paired (there is no person ID) and out exceeds in every year.

## 6. Redaction
Never imputed. Numeric and date fields become empty with a redacted flag; text fields keep `REDACTED`. Any figure on
a partly redacted field shows its coverage. Pay, location, bargaining unit and personnel office are redacted on about
47% of employment rows (100% of DOD); grade is redacted on about 0.1% (Energy and one other agency).

## 7. Known data issues
| ID | Issue | Treatment |
|---|---|---|
| KDI-001 | Length of service 124 to 126 years (counted from 1900): 7,665 separations (Jun 2024 to Jul 2025 files) and 5,391 accessions (Jun 2024 to Mar 2025 files). | Unknown in cubes; kept as published in the Look-Up. |
| KDI-002 | Occupational category empty or "NO DATA REPORTED" on 82% of separations from the Jun 2024 file. | Not used for separations from that file on. |
| KDI-003 | Exact duplicate rows in single DOD entity-months: Jun 2026 DD34, DD01, DD06, ARXF; May 2026 DD15 (DOD Jun 2026 overstated by about 13,000). | Counted as published; those entity-months and their totals flagged. |
| KDI-004 | HUD rows Oct 2024 to Mar 2025 (410 to 460 a month) with department "No Data Reported" and a blank subelement code. | Department from agency code (HU); subelement shown as "Not reported"; flagged. |
| KDI-005 | Air Force AF2D rows Feb to Apr 2015 (26 to 235) with no department code. | Department from agency code (DOD); flagged. |
| KDI-006 | Department of War components incomplete in Jun and Jul 2026 (OPM notice). | Every DOD entity-month in Jun and Jul 2026, and the government total, flagged. Covers those months' headcount and their effective-month flows. |
| KDI-007 | Grade REDACTED on about 0.1% of employment rows (Energy and one other agency). | Grade bands show an unknown value with coverage. |
| KDI-008 | One accession in the Aug 2016 file (agency HB, subelement HB00) with no department code. | Department from agency code (HB); flagged. |
| KDI-009 | Length of service over 100 years outside KDI-001 (for example 1,826.7 years, DOD, Feb 2025 separations file; 123.0, Transportation, Jun 2024). | Unknown in cubes, with coverage; kept as published in the Look-Up. |
| KDI-010 | Length of service below 0 on 7 accessions (Mar, Jun and Aug 2026 files). | Unknown in cubes, with coverage; kept as published in the Look-Up. |

## 8. Reconciliation and known breaks
For each department and the government, each fiscal year: gap = headcount change - net flow. The gate fails when the
gap exceeds both 5% of average month-end headcount and 20 people, unless that entity-year is on the signed
known-breaks list. The check runs at government and department level; subelements are not checked (most
are small, and their gaps carry no signal beyond their department's). The signed list is
`pipeline/known_breaks.csv`. Government FY2025 (4.12%) and DOD FY2022 (3.50%) are under the rule and are not on it;
the page explains the FY2025 September timing in copy.

## 9. Breakdowns (labels signed with the page specs)
Who is leaving and who is joining, at government and department level only (not subelement), at fiscal-year,
trailing-12-month and administration grain only, never month or quarter, so small cells do not single out
Look-Up rows: age bracket, length of service bands (<1, 1-4, 5-9, 10-19, 20-24, 25-29, 30+), supervisory group,
education, veteran status, grade level bands (GS and equivalents, meaning pay plans GS, GL, GP, GM, GG and GW, at grades 1-7, 8-11, 12-13, 14-15; senior executives;
federal wage system; all other plans). Occupation per department is left to the page specs.

## 10. Look-Up
Every accession and separation row, all agencies, split into files by effective fiscal year (actions effective
before October 2011 in their own file); the latest month's employment snapshot, split by department. Only fields
OPM published, REDACTED kept as written, no join across months. Each file under 100 MB. Fields:
- Departures (27): department_code, department, agency_code, agency, agency_subelement_code, agency_subelement,
  personnel_action_effective_date_yyyymm, period (the source file's month, as YYYYMM), separation_category,
  drp_indicator, occupational_series_code, occupational_series, occupational_group_code, occupational_group, pay_plan_code, grade, age_bracket,
  length_of_service_years, supervisory_status, appointment_type_code, appointment_type, tenure, education_level, veteran_indicator,
  work_schedule, annualized_adjusted_basic_pay, duty_station_state.
- Hires (26): the same without drp_indicator, with accession_category in place of separation_category.
- Employees (24): snapshot_yyyymm, the six organization fields and the 17 fields from occupational_series_code to
  duty_station_state above.
Department, agency and subelement are as published; the department used in cubes when the published one is missing
(KDI-004, KDI-005, KDI-008) is not added.
