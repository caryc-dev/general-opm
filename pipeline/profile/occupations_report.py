"""Queries and writer for pipeline/profile/OCCUPATIONS.md (L-025). Run through occupations.py report.

Every figure in the report comes from a query below; results are cached in warehouse/profile/occ_results/<id>.json
so a report can be finished over several short shell calls. `report Q2.1 Q4.3` recomputes only those ids;
`report` alone computes the missing ones (stopping after about 150 s) and writes the file when all are present.
"""
import json, os, sys, time
import duckdb
from occupations_views import VIEWS
from occupations_notes import NOTES, HEADER, RECOMMENDATION

RESULTS = 'warehouse/profile/occ_results'
OUT = 'pipeline/profile/OCCUPATIONS.md'
TMP = os.environ.get('PROFILE_TMP', 'warehouse/duckdb_tmp')

VALID = "regexp_full_match(occupational_series_code, '\\d{4}')"
FY = "(year({m}) + CASE WHEN month({m}) >= 10 THEN 1 ELSE 0 END)"

# Helper tables, created on demand (each query names the helpers it needs).
HELPERS = {
    # windows: grain, period, month; one row per month inside the window. fy FY2012 to FY2026 (partial), t12 every
    # end month from 2012-09 (as the breakdown cubes), admin = whole term to date, admin_n = first N months where
    # N = months of the current term (as the breakdown cubes), period_end = the window's last published month.
    'windows': f"""
CREATE OR REPLACE TEMP TABLE months AS
  SELECT range::DATE AS month FROM range(DATE '2011-10-01', DATE '2026-09-01', INTERVAL 1 MONTH);
CREATE OR REPLACE TEMP TABLE adm AS SELECT * FROM (VALUES
  ('obama2', DATE '2013-01-01', DATE '2016-12-01'), ('trump1', DATE '2017-01-01', DATE '2020-12-01'),
  ('biden', DATE '2021-01-01', DATE '2024-12-01'), ('trump2', DATE '2025-01-01', DATE '2026-08-01')) t(id, f, l);
CREATE OR REPLACE TEMP TABLE windows AS
  SELECT 'fy' AS grain, 'FY' || {FY.format(m='month')} AS period, month FROM months
  UNION ALL
  SELECT 't12', strftime(e.month, '%Y-%m'), m.month FROM months e JOIN months m
    ON m.month > e.month - INTERVAL 12 MONTH AND m.month <= e.month WHERE e.month >= DATE '2012-09-01'
  UNION ALL
  SELECT 'admin', id, month FROM adm JOIN months ON month BETWEEN f AND l
  UNION ALL
  SELECT 'admin_n', a.id, month FROM adm a JOIN months ON month BETWEEN a.f AND a.f + INTERVAL 19 MONTH;
CREATE OR REPLACE TEMP TABLE window_end AS
  SELECT grain, period, max(month) AS period_end, count(*) AS n_months FROM windows GROUP BY ALL;
""",
    # flows per entity x series x effective month, at four levels; the GOV and department rows are the cube set
    # (GOV, 141 departments, 4 DOD agencies = 146 entities), plus every subelement for the finer level.
    'flows': """
CREATE OR REPLACE TEMP TABLE flows AS
WITH a AS (
  SELECT 'hires' AS flow, effective_month AS month, department_code, agency_code, agency_subelement_code,
         occupational_series_code AS series, (action_code IN ('AA', 'AB')) AS transfer FROM acc
  UNION ALL
  SELECT 'departures', effective_month, department_code, agency_code, agency_subelement_code,
         occupational_series_code, (action_code IN ('SA', 'SB')) FROM sep)
SELECT flow, month, level, entity, series, count(*) AS n, count(*) FILTER (WHERE transfer) AS n_transfer FROM (
  SELECT *, 'gov' AS level, 'GOV' AS entity FROM a
  UNION ALL SELECT *, 'department', department_code FROM a
  UNION ALL SELECT *, 'agency', 'DOD-' || agency_code FROM a WHERE department_code = 'DOD'
  UNION ALL SELECT *, 'subelement', agency_subelement_code FROM a)
GROUP BY ALL;
""",
    # month-end headcount per entity x series x month (GOV, departments, DOD agencies)
    'stock': """
CREATE OR REPLACE TEMP TABLE stock AS
SELECT period AS month, level, entity, occupational_series_code AS series, sum(headcount) AS headcount FROM (
  SELECT *, 'gov' AS level, 'GOV' AS entity FROM emp
  UNION ALL SELECT *, 'department', department_code FROM emp
  UNION ALL SELECT *, 'agency', 'DOD-' || agency_code FROM emp WHERE department_code = 'DOD')
GROUP BY ALL;
""",
    'names': f"""
CREATE OR REPLACE TEMP TABLE series_name AS
SELECT occupational_series_code AS series, arg_max(occupational_series, period) AS latest_name FROM (
  SELECT period, occupational_series_code, occupational_series FROM emp_names
  UNION ALL SELECT period, occupational_series_code, occupational_series FROM acc
  UNION ALL SELECT period, occupational_series_code, occupational_series FROM sep)
GROUP BY 1;
""",
    # section 8: month-end headcount at all four levels (the `stock` rows plus every subelement, keyed by its code)
    'stock_all': """
CREATE OR REPLACE TEMP TABLE stock_all AS
SELECT month, level, entity, series, headcount FROM stock
UNION ALL
SELECT period, 'subelement', agency_subelement_code, occupational_series_code, sum(headcount) FROM emp GROUP BY ALL;
""",
}

BAD_CLASS = """CASE WHEN occupational_series_code IS NULL OR trim(occupational_series_code) = '' THEN 'blank'
  WHEN occupational_series_code = '*' THEN 'star_invalid'
  WHEN occupational_series_code = 'REDACTED' OR occupational_series = 'REDACTED' THEN 'redacted'
  WHEN NOT regexp_full_match(occupational_series_code, '\\d{4}') THEN 'other_non_4_digit'
  WHEN occupational_series IN ('NO DATA REPORTED', 'INVALID') THEN 'valid_code_bad_name'
  ELSE 'ok' END"""

ALL3 = """(SELECT 'accessions' AS dataset, period, effective_month AS month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1::BIGINT AS n FROM acc
  UNION ALL SELECT 'separations', period, effective_month, department_code, occupational_series_code,
          occupational_series, occupational_group_code, occupational_group, occupational_category_code,
          occupational_category, pay_plan_code, 1 FROM sep
  UNION ALL SELECT 'employment', period, period, NULL, occupational_series_code, occupational_series,
          occupational_group_code, occupational_group, occupational_category_code, occupational_category,
          pay_plan_code, rows FROM emp_names)"""

T12 = "BETWEEN DATE '2025-09-01' AND DATE '2026-08-01'"
FY25 = "BETWEEN DATE '2024-10-01' AND DATE '2025-09-01'"


def top_sql(entity_filter, flow, win):
    return f"""
WITH f AS (SELECT entity, series, sum(n) AS n, sum(n_transfer) AS n_transfer FROM flows
           WHERE flow = '{flow}' AND month {win} AND {entity_filter} GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY entity ORDER BY n DESC, series) AS rnk,
             sum(n) OVER (PARTITION BY entity) AS total FROM f)
SELECT entity, rnk, series, latest_name, n AS {flow}, round(100.0 * n / total, 2) AS pct_of_total,
       round(100.0 * n_transfer / n, 1) AS pct_transfer
FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 15 ORDER BY entity, rnk"""


BIG5 = """entity IN (SELECT department_code FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1
                    ORDER BY sum(headcount) DESC LIMIT 5)"""

Q = []


def q(qid, title, sql, needs=()):
    Q.append(dict(id=qid, title=title, sql=sql.strip(), needs=list(needs)))


# ---------------------------------------------------------------- 1. fields
q('Q1.1', 'Occupation and pay plan columns: files containing each column, first and last file (parquet metadata of '
  'all 537 source files)', """
SELECT CASE WHEN file_name LIKE '%/Accessions/%' THEN 'accessions' WHEN file_name LIKE '%/Separations/%'
            THEN 'separations' ELSE 'employment' END AS dataset,
       name AS column_name, count(DISTINCT file_name) AS files,
       min(regexp_extract(file_name, '_(\\d{6})_', 1)) AS first_file, max(regexp_extract(file_name, '_(\\d{6})_', 1)) AS last_file,
       string_agg(DISTINCT type, ',') AS parquet_type
FROM parquet_schema('data/*/*.parquet')
WHERE name LIKE 'occupational%' OR name LIKE 'stem%' OR name LIKE 'pay_plan%'
GROUP BY ALL ORDER BY column_name, dataset""")

q('Q1.2', 'Files per dataset (denominator for Q1.1)', """
SELECT CASE WHEN file_name LIKE '%/Accessions/%' THEN 'accessions' WHEN file_name LIKE '%/Separations/%'
            THEN 'separations' ELSE 'employment' END AS dataset, count(DISTINCT file_name) AS files
FROM parquet_schema('data/*/*.parquet') GROUP BY 1 ORDER BY 1""")

q('Q1.3', 'NULL values per occupation field, all files (employment = person-months)', f"""
SELECT dataset, sum(n) AS rows_,
  sum(n) FILTER (WHERE occupational_series_code IS NULL) AS series_code_null,
  sum(n) FILTER (WHERE occupational_series IS NULL) AS series_name_null,
  sum(n) FILTER (WHERE occupational_group_code IS NULL) AS group_code_null,
  sum(n) FILTER (WHERE occupational_category_code IS NULL) AS category_code_null,
  sum(n) FILTER (WHERE occupational_category IS NULL) AS category_name_null,
  sum(n) FILTER (WHERE pay_plan_code IS NULL) AS pay_plan_code_null
FROM {ALL3} GROUP BY 1 ORDER BY 1""")

q('Q1.4', 'Occupational category values (all files, all three datasets; employment = person-months)', f"""
SELECT occupational_category_code, occupational_category,
  sum(n) FILTER (WHERE dataset = 'accessions') AS accessions,
  sum(n) FILTER (WHERE dataset = 'separations') AS separations,
  sum(n) FILTER (WHERE dataset = 'employment') AS employment_person_months
FROM {ALL3} GROUP BY ALL ORDER BY 1, 2""")

# ---------------------------------------------------------------- 2. codes
q('Q2.1', 'Distinct series codes per dataset: all files and the latest 12 months (effective / snapshot months Sep 2025 '
  'to Aug 2026), all values and 4-digit codes only', f"""
SELECT dataset,
  count(DISTINCT occupational_series_code) AS codes_all_time,
  count(DISTINCT occupational_series_code) FILTER (WHERE {VALID}) AS four_digit_all_time,
  count(DISTINCT occupational_series_code) FILTER (WHERE month {T12}) AS codes_t12,
  count(DISTINCT occupational_series_code) FILTER (WHERE month {T12} AND {VALID}) AS four_digit_t12,
  count(DISTINCT occupational_series_code) FILTER (WHERE month = DATE '2026-08-01' AND {VALID}) AS four_digit_aug2026
FROM {ALL3} GROUP BY 1
UNION ALL
SELECT 'any of the three', count(DISTINCT occupational_series_code),
  count(DISTINCT occupational_series_code) FILTER (WHERE {VALID}),
  count(DISTINCT occupational_series_code) FILTER (WHERE month {T12}),
  count(DISTINCT occupational_series_code) FILTER (WHERE month {T12} AND {VALID}), NULL
FROM {ALL3} ORDER BY 1""")

q('Q2.2', 'Spelling drift: 4-digit codes with more than one published series name across all files (any dataset)',
  f"""
WITH n AS (SELECT occupational_series_code AS code, occupational_series AS name, min(period) AS first_file,
                  max(period) AS last_file, sum(n) AS rows_ FROM {ALL3} WHERE {VALID} GROUP BY ALL)
SELECT (SELECT count(DISTINCT code) FROM n) AS codes,
       (SELECT count(*) FROM (SELECT code FROM n GROUP BY 1 HAVING count(*) > 1)) AS codes_with_2plus_names,
       (SELECT max(c) FROM (SELECT count(*) c FROM n GROUP BY code)) AS max_names_per_code,
       (SELECT count(*) FROM (SELECT name FROM n GROUP BY 1 HAVING count(DISTINCT code) > 1)) AS names_on_2plus_codes""")

q('Q2.3', 'Spelling drift detail: every code with more than one name, each name with its first and last file month',
  f"""
WITH n AS (SELECT occupational_series_code AS code, occupational_series AS name, min(period) AS first_file,
                  max(period) AS last_file, sum(n) AS rows_ FROM {ALL3} WHERE {VALID} GROUP BY ALL)
SELECT code, name, strftime(first_file, '%Y-%m') AS first_file, strftime(last_file, '%Y-%m') AS last_file, rows_
FROM n WHERE code IN (SELECT code FROM n GROUP BY 1 HAVING count(*) > 1) ORDER BY code, first_file""")

q('Q2.4', 'Values that are not a 4-digit code, and 4-digit codes with a placeholder name, by dataset (all files)', f"""
SELECT dataset, {BAD_CLASS} AS class, '[' || coalesce(occupational_series_code, 'NULL') || ']' AS code_as_published,
       occupational_series AS name, sum(n) AS rows_
FROM {ALL3} WHERE {BAD_CLASS} <> 'ok' GROUP BY ALL ORDER BY dataset, rows_ DESC""")

q('Q2.5', 'Rate of unusable series codes (blank, *, REDACTED, other non-4-digit) by dataset and fiscal year of the '
  'effective month (employment: person-months of the fiscal year)', f"""
SELECT dataset, 'FY' || {FY.format(m='month')} AS fy, sum(n) AS rows_,
  sum(n) FILTER (WHERE {BAD_CLASS} = 'blank') AS blank,
  sum(n) FILTER (WHERE {BAD_CLASS} = 'star_invalid') AS star_invalid,
  sum(n) FILTER (WHERE {BAD_CLASS} = 'redacted') AS redacted,
  sum(n) FILTER (WHERE {BAD_CLASS} = 'other_non_4_digit') AS other,
  round(100.0 * sum(n) FILTER (WHERE {BAD_CLASS} NOT IN ('ok', 'valid_code_bad_name')) / sum(n), 3) AS pct_unusable
FROM {ALL3} GROUP BY ALL ORDER BY dataset, fy""")

q('Q2.6', 'Top 10 departments by unusable-code rate, per action dataset, all effective months (departments with '
  'at least 1,000 actions) and the latest 12 months (at least 100)', f"""
WITH d AS (
  SELECT dataset, 'all' AS span, department_code, count(*) AS rows_,
         count(*) FILTER (WHERE {BAD_CLASS} NOT IN ('ok', 'valid_code_bad_name')) AS unusable
  FROM {ALL3} WHERE dataset <> 'employment' GROUP BY ALL HAVING count(*) >= 1000
  UNION ALL
  SELECT dataset, 't12', department_code, count(*),
         count(*) FILTER (WHERE {BAD_CLASS} NOT IN ('ok', 'valid_code_bad_name'))
  FROM {ALL3} WHERE dataset <> 'employment' AND month {T12} GROUP BY ALL HAVING count(*) >= 100),
r AS (SELECT *, round(100.0 * unusable / rows_, 2) AS pct,
             row_number() OVER (PARTITION BY dataset, span ORDER BY unusable / rows_ DESC, department_code) AS rnk FROM d)
SELECT dataset, span, rnk, department_code, rows_, unusable, pct FROM r WHERE rnk <= 10 ORDER BY dataset, span, rnk""")

q('Q2.7', 'Employment: top 10 departments by unusable-code rate, Aug 2026 snapshot (departments of 100+)', f"""
WITH d AS (SELECT department_code, sum(headcount) AS headcount,
                  sum(headcount) FILTER (WHERE NOT {VALID}) AS unusable
           FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1 HAVING sum(headcount) >= 100)
SELECT department_code, headcount, coalesce(unusable, 0) AS unusable,
       round(100.0 * coalesce(unusable, 0) / headcount, 2) AS pct
FROM d ORDER BY pct DESC, department_code LIMIT 10""")

q('Q2.8', 'KDI-002 and the series code: separations, files before and from Jun 2024', f"""
SELECT CASE WHEN period >= DATE '2024-06-01' THEN 'Jun 2024 to Aug 2026 files' ELSE 'Oct 2011 to May 2024 files' END AS files,
  count(*) AS separations,
  count(*) FILTER (WHERE occupational_category IS NULL OR occupational_category = 'NO DATA REPORTED') AS category_bad,
  count(*) FILTER (WHERE (occupational_category IS NULL OR occupational_category = 'NO DATA REPORTED') AND {VALID})
    AS category_bad_series_4_digit,
  count(*) FILTER (WHERE NOT {VALID}) AS series_not_4_digit,
  round(100.0 * count(*) FILTER (WHERE NOT {VALID}) / count(*), 2) AS pct_series_not_4_digit,
  count(*) FILTER (WHERE occupational_group_code IS NULL OR occupational_group_code IN ('NO DATA REPORTED', '*', 'INVALID'))
    AS group_bad
FROM sep GROUP BY 1 ORDER BY 1 DESC""")

q('Q2.9', 'Separations with a blank series code, by file month, Jun 2024 onward (KDI-002 period)', """
SELECT strftime(period, '%Y-%m') AS file_month, count(*) AS separations,
       count(*) FILTER (WHERE trim(occupational_series_code) = '') AS blank_series,
       round(100.0 * count(*) FILTER (WHERE trim(occupational_series_code) = '') / count(*), 2) AS pct
FROM sep WHERE period >= DATE '2024-06-01' GROUP BY 1 ORDER BY 1""")

# ---------------------------------------------------------------- 3. families
q('Q3.1', 'Does occupational_group_code equal the first two digits of the series code? (distinct code pairs, all '
  'files)', f"""
SELECT dataset, count(*) AS code_group_pairs,
  count(*) FILTER (WHERE grp = left(code, 2)) AS equal_first_two,
  count(*) FILTER (WHERE grp IS NULL) AS group_null,
  count(*) FILTER (WHERE grp IS NOT NULL AND grp <> left(code, 2)) AS differ
FROM (SELECT DISTINCT dataset, occupational_series_code AS code, occupational_group_code AS grp FROM {ALL3}
      WHERE {VALID}) GROUP BY 1 ORDER BY 1""")

q('Q3.2', '4-digit codes published with a NULL group code (rows, all files)', f"""
SELECT dataset, occupational_series_code AS code, occupational_series AS name, sum(n) AS rows_,
       strftime(min(period), '%Y-%m') AS first_file, strftime(max(period), '%Y-%m') AS last_file
FROM {ALL3} WHERE {VALID} AND occupational_group_code IS NULL GROUP BY ALL ORDER BY dataset, code""")

q('Q3.3', 'Families as OPM publishes them: group code, names over all files, codes, Aug 2026 headcount', f"""
SELECT occupational_group_code AS grp, count(DISTINCT occupational_group) AS names_all_files,
  arg_max(occupational_group, period) AS latest_name,
  count(DISTINCT occupational_series_code) FILTER (WHERE period = DATE '2026-08-01') AS codes_aug2026,
  sum(n) FILTER (WHERE period = DATE '2026-08-01' AND dataset = 'employment') AS headcount_aug2026
FROM {ALL3} WHERE {VALID} GROUP BY 1 ORDER BY 1""")

q('Q3.4', 'Group codes with more than one published group name (all files)', f"""
SELECT occupational_group_code AS grp, occupational_group AS name, sum(n) AS rows_
FROM {ALL3} WHERE occupational_group_code IN (SELECT occupational_group_code FROM {ALL3}
  GROUP BY 1 HAVING count(DISTINCT occupational_group) > 1) GROUP BY ALL ORDER BY 1, 2""")

q('Q3.5', 'Blue collar by code: 4-digit codes 2500 and above vs occupational category, all files', f"""
SELECT dataset, occupational_series_code >= '2500' AS code_2500_plus, occupational_category_code, sum(n) AS rows_
FROM {ALL3} WHERE {VALID} GROUP BY ALL ORDER BY 1, 2, 3""")

q('Q3.6', 'Blue collar by pay plan: wage-grade pay plans (code starting W) vs code 2500 and above, Aug 2026 employment '
  'and all actions', f"""
SELECT dataset, occupational_series_code >= '2500' AS code_2500_plus, left(pay_plan_code, 1) = 'W' AS pay_plan_w,
       sum(n) AS rows_
FROM {ALL3} WHERE {VALID} AND (dataset <> 'employment' OR period = DATE '2026-08-01') GROUP BY ALL ORDER BY 1, 2, 3""")

q('Q3.7', 'Wage codes (2500+) on pay plans not starting W, Aug 2026 employment: top 15 pay plans', f"""
SELECT pay_plan_code, sum(rows) AS headcount FROM emp_names
WHERE period = DATE '2026-08-01' AND {VALID} AND occupational_series_code >= '2500' AND left(pay_plan_code, 1) <> 'W'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15""")

# ---------------------------------------------------------------- 4. concentration
for flow in ('hires', 'departures'):
    for wl, win in (('FY2025', FY25), ('t12', T12)):
        q(f'Q4.{"1" if flow == "hires" else "2"}{"a" if wl == "FY2025" else "b"}',
          f'Top 15 series by {flow}, {"FY2025" if wl == "FY2025" else "latest 12 months (Sep 2025 to Aug 2026)"}: '
          f'GOV and the 5 largest departments (Aug 2026 headcount); pct_transfer = share of the series\' {flow} that '
          f'are transfers ({"AA, AB" if flow == "hires" else "SA, SB"})',
          f"""{top_sql(f"(entity = 'GOV' OR {BIG5}) AND level IN ('gov', 'department')", flow, win)}""",
          needs=('flows', 'names'))

q('Q4.3', 'Share of all hires and departures covered by the top 10 and top 25 series (by that flow), GOV and the 5 '
  'largest departments, FY2025 and the latest 12 months', f"""
WITH f AS (SELECT CASE WHEN month {FY25} THEN 'FY2025' END AS w1, CASE WHEN month {T12} THEN 't12' END AS w2,
                  flow, entity, series, n FROM flows
           WHERE level IN ('gov', 'department') AND (entity = 'GOV' OR {BIG5})),
g AS (SELECT w1 AS win, flow, entity, series, sum(n) AS n FROM f WHERE w1 IS NOT NULL GROUP BY ALL
      UNION ALL SELECT w2, flow, entity, series, sum(n) FROM f WHERE w2 IS NOT NULL GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY win, flow, entity ORDER BY n DESC, series) AS rnk FROM g)
SELECT win, flow, entity, sum(n) AS total, count(*) AS series_with_events,
  round(100.0 * sum(n) FILTER (WHERE rnk <= 10) / sum(n), 1) AS pct_top10,
  round(100.0 * sum(n) FILTER (WHERE rnk <= 25) / sum(n), 1) AS pct_top25
FROM r GROUP BY ALL ORDER BY win, flow, total DESC""", needs=('flows',))

q('Q4.4', 'Transfer share of the top 10 series government-wide (hires: AA, AB; departures: SA, SB) against the '
  'all-series transfer share', f"""
WITH f AS (SELECT CASE WHEN month {FY25} THEN 'FY2025' END AS w1, CASE WHEN month {T12} THEN 't12' END AS w2,
                  flow, series, n, n_transfer FROM flows WHERE level = 'gov'),
g AS (SELECT w1 AS win, flow, series, sum(n) AS n, sum(n_transfer) AS t FROM f WHERE w1 IS NOT NULL GROUP BY ALL
      UNION ALL SELECT w2, flow, series, sum(n), sum(n_transfer) FROM f WHERE w2 IS NOT NULL GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY win, flow ORDER BY n DESC, series) AS rnk FROM g)
SELECT win, flow, sum(n) FILTER (WHERE rnk <= 10) AS top10_events, sum(t) FILTER (WHERE rnk <= 10) AS top10_transfers,
  round(100.0 * sum(t) FILTER (WHERE rnk <= 10) / sum(n) FILTER (WHERE rnk <= 10), 1) AS pct_transfer_top10,
  round(100.0 * sum(t) / sum(n), 1) AS pct_transfer_all_series,
  round(100.0 * sum(t) FILTER (WHERE rnk <= 10) / sum(t), 1) AS top10_pct_of_all_transfers
FROM r GROUP BY ALL ORDER BY 1, 2""", needs=('flows',))

# ---------------------------------------------------------------- 5. cell sizes
CELL = """
WITH c AS (SELECT w.grain, w.period, f.flow, f.level, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ({levels}) GROUP BY ALL)
SELECT level, flow, {grain_col} AS grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, count(*) FILTER (WHERE n < 30) AS lt30,
  round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM c {where} GROUP BY ALL ORDER BY level, flow, grain"""
q('Q5.1', '(entity, period, series) cells with at least one event, GOV and departments, by grain (fy FY2012 to '
  'FY2026; t12 = all 168 trailing windows as the breakdown cubes; admin and admin_n 4 each)',
  CELL.format(levels="'gov', 'department'", grain_col='grain', where=''), needs=('windows', 'flows'))
q('Q5.2', 'Same, latest periods only: FY2025, t12 to Aug 2026, admin trump2',
  CELL.format(levels="'gov', 'department'", grain_col="grain || ' ' || period",
              where="WHERE (grain, period) IN (('fy', 'FY2025'), ('t12', '2026-08'), ('admin', 'trump2'))"),
  needs=('windows', 'flows'))
q('Q5.3', 'Same at agency (the 4 DOD agencies; every other agency equals its department) and subelement level, all '
  'grains', CELL.format(levels="'agency', 'subelement'", grain_col='grain', where=''), needs=('windows', 'flows'))
q('Q5.4', 'Agency and subelement level, latest periods only',
  CELL.format(levels="'agency', 'subelement'", grain_col="grain || ' ' || period",
              where="WHERE (grain, period) IN (('fy', 'FY2025'), ('t12', '2026-08'), ('admin', 'trump2'))"),
  needs=('windows', 'flows'))

q('Q5.5', 'Rates by series: (entity, series) cells with events or headcount, and how many have an average month-end '
  'headcount below 30 (small-base flag) or of 0 (rate left empty), FY2025 and t12 to Aug 2026', """
WITH st AS (SELECT w.grain, w.period, s.level, s.entity, s.series, sum(s.headcount) / any_value(e.n_months) AS avg_hc
            FROM stock s JOIN windows w USING (month) JOIN window_end e USING (grain, period)
            WHERE (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08')) AND s.level IN ('gov', 'department')
            GROUP BY ALL),
fl AS (SELECT w.grain, w.period, f.level, f.entity, f.series, sum(f.n) AS n FROM flows f JOIN windows w USING (month)
       WHERE (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08')) AND f.level IN ('gov', 'department')
       GROUP BY ALL)
SELECT grain || ' ' || period AS window, level, count(*) AS cells,
  count(*) FILTER (WHERE coalesce(avg_hc, 0) = 0) AS avg_headcount_0,
  count(*) FILTER (WHERE avg_hc > 0 AND avg_hc < 30) AS small_base,
  round(100.0 * count(*) FILTER (WHERE coalesce(avg_hc, 0) < 30) / count(*), 1) AS pct_empty_or_small
FROM st FULL JOIN fl USING (grain, period, level, entity, series) GROUP BY ALL ORDER BY 1, 2 DESC""",
  needs=('windows', 'flows', 'stock'))

# ---------------------------------------------------------------- 6. sizes
# Row byte length as compact JSON: strings quoted, integers bare, floats with up to 4 decimals, plus 1 comma per row.
SIZE_A = """
WITH c AS (SELECT w.grain, w.period, f.flow, f.entity, f.series, sum(f.n) AS n
           FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency') GROUP BY ALL),
r AS (SELECT *, row_number() OVER (PARTITION BY grain, period, flow, entity ORDER BY n DESC, series) AS rnk FROM c),
k AS (SELECT grain, period, flow, entity, CASE WHEN rnk <= 25 THEN series ELSE 'other' END AS series, sum(n) AS n
      FROM r {where} GROUP BY ALL)
SELECT count(DISTINCT entity) AS files, count(*) AS rows_,
  round(sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n || '],'))
        / 1e6 + count(DISTINCT entity) * 130 / 1e6, 2) AS mb,
  round(max(b) / 1e6, 3) AS largest_file_mb, arg_max(entity, b) AS largest_entity
FROM k JOIN (SELECT entity, sum(length('["' || grain || '","' || period || '","' || flow || '","' || series || '",' || n
             || '],')) AS b FROM k GROUP BY 1) USING (entity)"""
q('Q6.1', 'Option A: top 25 series by hires and by departures plus "other", per GOV, department and DOD agency (one '
  'file each; 145 have actions), fy, all t12 windows, admin and admin_n; row ["t12","2026-08","hires","0610",1234]',
  SIZE_A.format(where=''), needs=('windows', 'flows'))
q('Q6.2', 'Option A with only the latest t12 window (fy, t12 2026-08, admin, admin_n)',
  SIZE_A.format(where="WHERE grain <> 't12' OR period = '2026-08'"), needs=('windows', 'flows'))

SIZE_B = """
WITH fl AS (SELECT w.grain, w.period, f.entity, f.series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ('gov', 'department', 'agency') {wf} GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.entity, s.series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock s JOIN windows w USING (month) JOIN window_end e USING (grain, period) WHERE TRUE {wf} GROUP BY ALL),
k AS (SELECT grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, entity, series)),
b AS (SELECT entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY 1)
SELECT count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb, round(max(bytes) / 1e6, 2) AS largest_file_mb,
       arg_max(entity, bytes) AS largest_entity, count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b"""
q('Q6.3', 'Option B: every series per GOV, department and DOD agency, fy, all t12 windows, admin, admin_n; row '
  '[grain, period, series, hires, departures, transfer in, transfer out, headcount at period end, average headcount, '
  'small-base flag]', SIZE_B.format(wf=''), needs=('windows', 'flows', 'stock'))
q('Q6.4', 'Option B with only the latest t12 window', SIZE_B.format(wf="AND (w.grain <> 't12' OR w.period = '2026-08')"),
  needs=('windows', 'flows', 'stock'))

SIZE_C = """
WITH fl AS (SELECT month, level, entity, {key} AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ({levels}) GROUP BY ALL),
st AS (SELECT month, level, entity, {key} AS series, sum(headcount) AS headcount FROM {stock}
       WHERE level IN ({levels}) GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY 1 ORDER BY 1"""
q('Q6.5', 'Option C by series: monthly [month, series, headcount, hires, departures] per entity file, Oct 2011 to Aug '
  '2026', SIZE_C.format(key='series', levels="'gov', 'department', 'agency'", stock='stock'),
  needs=('flows', 'stock'))
q('Q6.6', 'Option C by family (first two digits of a 4-digit code; other values kept as published)',
  SIZE_C.format(key="CASE WHEN regexp_full_match(series, '\\d{4}') THEN left(series, 2) ELSE series END",
                levels="'gov', 'department', 'agency'", stock='stock'), needs=('flows', 'stock'))
q('Q6.7', 'Option C by series at subelement level (what a subelement filter would add)', """
WITH fl AS (SELECT month, entity, series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows WHERE level = 'subelement' GROUP BY ALL),
st AS (SELECT period AS month, agency_subelement_code AS entity, occupational_series_code AS series,
              sum(headcount) AS headcount FROM emp GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, entity, series)),
b AS (SELECT entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 1) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap FROM b""", needs=('flows',))
q('Q6.8', 'Option C by series, GOV file only, if limited to the months since Oct 2020 (a layout lever)', """
WITH fl AS (SELECT month, series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows WHERE level = 'gov' GROUP BY ALL),
st AS (SELECT month, series, headcount FROM stock WHERE level = 'gov'),
k AS (SELECT * FROM fl FULL JOIN st USING (month, series))
SELECT month >= DATE '2020-10-01' AS since_oct2020, count(*) AS rows_,
  round(sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' || coalesce(headcount, 0) || ',' ||
        coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) / 1e6, 2) AS mb
FROM k GROUP BY 1 ORDER BY 1""", needs=('flows', 'stock'))
q('Q6.9', 'Option D: the Look-Up files a browser filter over one series would load (file sizes in warehouse/lookup/)',
  """
SELECT CASE WHEN filename LIKE '%/separations%' THEN 'separations' WHEN filename LIKE '%/accessions%' THEN 'accessions'
            ELSE 'employment' END AS dataset, count(*) AS files, round(sum(size) / 1e6, 1) AS mb,
       round(max(size) / 1e6, 2) AS largest_mb
FROM read_blob('warehouse/lookup/*.parquet') GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST""")

# ---------------------------------------------------------------- 7. reclassification
RECON = """
WITH h AS (SELECT level, entity, series, {fy_m} AS fy, headcount FROM stock WHERE month(month) = 9 AND level IN ({levels})),
d AS (SELECT a.level, a.entity, a.series, a.fy, a.headcount - coalesce(p.headcount, 0) AS dh FROM h a
      LEFT JOIN h p ON p.level = a.level AND p.entity = a.entity AND p.series = a.series AND p.fy = a.fy - 1
      UNION ALL  -- series that vanished: present last September, absent this September
      SELECT p.level, p.entity, p.series, p.fy + 1, -p.headcount FROM h p
      WHERE NOT EXISTS (SELECT 1 FROM h a WHERE a.level = p.level AND a.entity = p.entity AND a.series = p.series AND a.fy = p.fy + 1)
        AND p.fy < 2025),
n AS (SELECT level, entity, series, {fy_m} AS fy, coalesce(sum(n) FILTER (WHERE flow = 'hires'), 0) - coalesce(sum(n) FILTER (WHERE flow = 'departures'), 0)
             AS net_raw, sum(n) FILTER (WHERE flow = 'hires') AS hires FROM flows WHERE level IN ({levels}) GROUP BY ALL),
g AS (SELECT level, entity, fy, series, coalesce(dh, 0) - coalesce(net_raw, 0) AS gap, coalesce(hires, 0) AS hires
      FROM d FULL JOIN n USING (level, entity, series, fy) WHERE fy BETWEEN 2013 AND 2025),
e AS (SELECT level, entity, fy, sum(gap) AS gap_total, sum(abs(gap)) AS sum_abs_gap, sum(hires) AS hires FROM g GROUP BY ALL)
"""
q('Q7.1', 'Headcount change minus net flow by series, government-wide, FY2013 to FY2025 (September to September); '
  'min_moves = (sum of |series gap| - |total gap|) / 2, a lower bound on people whose series changed without a hire '
  'or departure', RECON.format(fy_m=FY.format(m='month'), levels="'gov'") + """
SELECT 'FY' || fy AS fy, gap_total, sum_abs_gap, (sum_abs_gap - abs(gap_total)) // 2 AS min_moves, hires,
  round(100.0 * ((sum_abs_gap - abs(gap_total)) / 2) / hires, 1) AS min_moves_pct_of_hires
FROM e ORDER BY fy""", needs=('flows', 'stock'))
q('Q7.2', 'The 10 series with the largest |headcount change - net flow|, government-wide, FY2023 to FY2025', RECON.format(
  fy_m=FY.format(m='month'), levels="'gov'") + """
, r AS (SELECT *, row_number() OVER (PARTITION BY fy ORDER BY abs(gap) DESC, series) AS rnk FROM g WHERE fy >= 2023)
SELECT 'FY' || fy AS fy, rnk, series, latest_name, gap FROM r LEFT JOIN series_name USING (series) WHERE rnk <= 10
ORDER BY fy, rnk""", needs=('flows', 'stock', 'names'))
q('Q7.3', 'Department level, FY2025: the 10 departments with the largest lower-bound moves', RECON.format(fy_m=FY.format(m='month'), levels="'department'") + """
SELECT entity, gap_total, sum_abs_gap, (sum_abs_gap - abs(gap_total)) // 2 AS min_moves, hires
FROM e WHERE fy = 2025 ORDER BY min_moves DESC LIMIT 10""", needs=('flows', 'stock'))
q('Q7.4', 'Sum over departments of the lower-bound moves vs the government-wide figure, FY2023 to FY2025 (moves '
  'between departments that keep the series show at department level as a gap, not at GOV level)',
  RECON.format(fy_m=FY.format(m='month'), levels="'gov', 'department'") + """
SELECT 'FY' || fy AS fy, level, sum((sum_abs_gap - abs(gap_total)) // 2) AS min_moves, sum(hires) AS hires
FROM e WHERE fy >= 2023 GROUP BY ALL ORDER BY 1, 2 DESC""", needs=('flows', 'stock'))


# ---------------------------------------------------------------- 8. subelement level (L-028)
ALL4 = "'gov', 'department', 'agency', 'subelement'"
FAMILY = "CASE WHEN regexp_full_match({c}, '\\d{{4}}') THEN left({c}, 2) ELSE {c} END"
LATEST = "(w.grain <> 't12' OR w.period = '2026-08')"
# Option B per level, same row and byte convention as Q6.3/Q6.4; {fkey}/{skey} pick series or family
SIZE_B8 = """
WITH fl AS (SELECT w.grain, w.period, f.level, f.entity, {fkey} AS series,
                   sum(f.n) FILTER (WHERE flow = 'hires') AS hires, sum(f.n) FILTER (WHERE flow = 'departures') AS departures,
                   sum(f.n_transfer) FILTER (WHERE flow = 'hires') AS acc_transfer_in,
                   sum(f.n_transfer) FILTER (WHERE flow = 'departures') AS sep_transfer_out
            FROM flows f JOIN windows w USING (month) WHERE f.level IN ({levels}) AND {latest} GROUP BY ALL),
st AS (SELECT w.grain, w.period, s.level, s.entity, {skey} AS series, sum(s.headcount) AS hc_sum,
              sum(s.headcount) FILTER (WHERE s.month = e.period_end) AS headcount, any_value(e.n_months) AS n_months
       FROM stock_all s JOIN windows w USING (month) JOIN window_end e USING (grain, period)
       WHERE s.level IN ({levels}) AND {latest} GROUP BY ALL),
k AS (SELECT level, grain, period, entity, series, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(acc_transfer_in, 0) AS ti, coalesce(sep_transfer_out, 0) AS tout, coalesce(headcount, 0) AS hc,
             round(coalesce(hc_sum, 0) / coalesce(n_months, 12), 4) AS den
      FROM fl FULL JOIN st USING (grain, period, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || grain || '","' || period || '","' || series || '",' || hires
             || ',' || departures || ',' || ti || ',' || tout || ',' || hc || ',' || den::VARCHAR || ',' ||
             CASE WHEN den < 30 THEN 'true' ELSE 'false' END || '],')) + 200 AS bytes FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level"""
q('Q8.1', 'Option B by series at all four levels (GOV, departments, DOD agencies, subelements), latest t12 window only '
  '(fy FY2012 to FY2026, t12 2026-08, admin, admin_n); row as Q6.3; the first three levels reproduce Q6.4',
  SIZE_B8.format(fkey='f.series', skey='s.series', levels=ALL4, latest=LATEST), needs=('windows', 'flows', 'stock', 'stock_all'))
q('Q8.2', 'Option B by family (first two digits of a 4-digit code; other values kept as published) at all four levels, '
  'latest t12 window only', SIZE_B8.format(fkey=FAMILY.format(c='f.series'), skey=FAMILY.format(c='s.series'),
                                           levels=ALL4, latest=LATEST), needs=('windows', 'flows', 'stock', 'stock_all'))

# Option C per level, same row and byte convention as Q6.5 to Q6.7, from a given month
SIZE_C8 = """
WITH fl AS (SELECT month, level, entity, {key} AS series, sum(n) FILTER (WHERE flow = 'hires') AS hires,
                   sum(n) FILTER (WHERE flow = 'departures') AS departures FROM flows
            WHERE level IN ({levels}) AND month >= DATE '{since}' GROUP BY ALL),
st AS (SELECT month, level, entity, {key} AS series, sum(headcount) AS headcount FROM stock_all
       WHERE level IN ({levels}) AND month >= DATE '{since}' GROUP BY ALL),
k AS (SELECT * FROM fl FULL JOIN st USING (month, level, entity, series)),
b AS (SELECT level, entity, count(*) AS rows_, sum(length('["' || strftime(month, '%Y-%m') || '","' || series || '",' ||
             coalesce(headcount, 0) || ',' || coalesce(hires, 0) || ',' || coalesce(departures, 0) || '],')) + 200 AS bytes
      FROM k GROUP BY ALL)
SELECT coalesce(level, 'all') AS level, count(*) AS files, sum(rows_) AS rows_, round(sum(bytes) / 1e6, 2) AS mb,
       round(max(bytes) / 1e6, 2) AS largest_file_mb, arg_max(entity, bytes) AS largest_entity,
       count(*) FILTER (WHERE bytes > 3000000) AS files_over_3mb_cap
FROM b GROUP BY ROLLUP (level) ORDER BY level = 'all', level"""
q('Q8.3', 'Option C1: monthly by family [month, family, headcount, hires, departures] per entity file at all four '
  'levels, Oct 2011 to Aug 2026; the first three levels reproduce Q6.6',
  SIZE_C8.format(key=FAMILY.format(c='series'), levels=ALL4, since='2011-10-01'), needs=('flows', 'stock', 'stock_all'))
q('Q8.4', 'Option C2: monthly by series at all four levels, Oct 2011 to Aug 2026 (reproduces Q6.5 and Q6.7)',
  SIZE_C8.format(key='series', levels=ALL4, since='2011-10-01'), needs=('flows', 'stock', 'stock_all'))
q('Q8.5', 'Option C2 limited to the months since Oct 2020 (Oct 2020 to Aug 2026), all four levels',
  SIZE_C8.format(key='series', levels=ALL4, since='2020-10-01'), needs=('flows', 'stock', 'stock_all'))

q('Q8.6', 'Subelement cells with at least one event, by series and by family, FY2025 and t12 to Aug 2026 (Q5.4 '
  'convention)', f"""
WITH c AS (SELECT w.grain || ' ' || w.period AS grain, f.flow, f.entity, f.series AS series, {FAMILY.format(c='f.series')} AS family, f.n
           FROM flows f JOIN windows w USING (month)
           WHERE f.level = 'subelement' AND (w.grain, w.period) IN (('fy', 'FY2025'), ('t12', '2026-08'))),
s AS (SELECT 'series' AS key, grain, flow, entity, series AS k, sum(n) AS n FROM c GROUP BY ALL
      UNION ALL SELECT 'family', grain, flow, entity, family, sum(n) FROM c GROUP BY ALL)
SELECT key, flow, grain, count(*) AS cells_with_events,
  count(*) FILTER (WHERE n < 10) AS lt10, round(100.0 * count(*) FILTER (WHERE n < 10) / count(*), 1) AS pct_lt10,
  count(*) FILTER (WHERE n < 30) AS lt30, round(100.0 * count(*) FILTER (WHERE n < 30) / count(*), 1) AS pct_lt30
FROM s GROUP BY ALL ORDER BY key DESC, flow, grain""", needs=('windows', 'flows'))
q('Q8.7', 'Subelement codes by Aug 2026 headcount (employment file rows by agency_subelement_code); band 0 = no '
  'employees that month (ended, or actions only), 1 = 1 to 29, 2 = 30 to 499, 3 = 500 to 4,999, 4 = 5,000 and over; '
  'blank = all codes', """
WITH h AS (SELECT agency_subelement_code AS entity, sum(headcount) AS hc FROM emp WHERE period = DATE '2026-08-01' GROUP BY 1),
codes AS (SELECT agency_subelement_code AS entity FROM emp UNION SELECT entity FROM flows WHERE level = 'subelement')
SELECT CASE WHEN hc IS NULL THEN 0 WHEN hc < 30 THEN 1 WHEN hc < 500 THEN 2 WHEN hc < 5000 THEN 3 ELSE 4 END AS band,
       count(*) AS subelements, coalesce(sum(hc), 0) AS employees
FROM codes LEFT JOIN h USING (entity) GROUP BY ROLLUP (band) ORDER BY band NULLS LAST""", needs=('flows',))

# ---------------------------------------------------------------- runner and writer
def connect():
    con = duckdb.connect()
    con.execute(f"SET memory_limit='1800MB'; SET threads=4; SET temp_directory='{TMP}'; "
                "SET preserve_insertion_order=false")
    con.execute("ATTACH 'warehouse/opm.duckdb' AS w (READ_ONLY)")
    con.execute(VIEWS)
    return con


def fmt(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, int):
        return f'{v:,}'
    if isinstance(v, float):
        return f'{v:,.4f}'.rstrip('0').rstrip('.')
    return str(v)


def table(cols, rows):
    if not rows:
        return '(no rows)'
    s = [[fmt(v) for v in r] for r in rows]
    w = [max(len(c), *(len(r[i]) for r in s)) for i, c in enumerate(cols)]
    num = [all((r[i] == '' or r[i].replace(',', '').replace('.', '').replace('-', '').isdigit()) for r in s) for i in range(len(cols))]
    line = lambda r: '  '.join((x.rjust(w[i]) if num[i] else x.ljust(w[i])) for i, x in enumerate(r)).rstrip()
    return '\n'.join([line(cols), '  '.join('-' * x for x in w), *(line(r) for r in s)])


def compute(ids, budget=150):
    os.makedirs(RESULTS, exist_ok=True)
    t0 = time.time()
    con = None
    made = set()
    for item in Q:
        path = f"{RESULTS}/{item['id']}.json"
        if ids and item['id'] not in ids:
            continue
        if not ids and os.path.exists(path):
            continue
        if time.time() - t0 > budget:
            print('budget used; run again'); return False
        if con is None:
            con = connect()
        for h in item['needs']:
            if h not in made:
                t = time.time(); con.execute(HELPERS[h]); made.add(h)
                print(f'  helper {h} {time.time() - t:.0f}s', flush=True)
        t = time.time()
        r = con.execute(item['sql'])
        cols = [d[0].rstrip('_') for d in r.description]
        rows = [list(x) for x in r.fetchall()]
        rows = [[(float(v) if hasattr(v, 'as_tuple') else v.isoformat() if hasattr(v, 'isoformat') else v) for v in x]
                for x in rows]
        json.dump(dict(cols=cols, rows=rows, seconds=round(time.time() - t, 1)), open(path, 'w'))
        print(f"{item['id']} {len(rows)} rows {time.time() - t:.1f}s", flush=True)
    return True


def write():
    missing = [x['id'] for x in Q if not os.path.exists(f"{RESULTS}/{x['id']}.json")]
    if missing:
        print('missing results:', missing); return
    out = [HEADER.strip(), '']
    sec = None
    titles = {'1': '1. Occupation fields', '2': '2. Series codes: counts, drift and unusable values',
              '3': '3. Families and blue collar', '4': '4. Concentration', '5': '5. Cell sizes',
              '6': '6. Size estimates', '7': '7. Headcount change vs net flow by occupation',
              '8': '8. Subelement level and full-build totals'}
    for item in Q:
        s = item['id'][1]
        if s != sec:
            sec = s
            out += [f'## {titles[s]}', '']
            if f'S{s}' in NOTES:
                out += [NOTES[f'S{s}'].strip(), '']
        res = json.load(open(f"{RESULTS}/{item['id']}.json"))
        out += [f"{item['title']}  [query {item['id']}]", '```', table(res['cols'], res['rows']), '```']
        if item['id'] in NOTES:
            out += [NOTES[item['id']].strip()]
        out += ['']
    out += ['## Recommendation', '', RECOMMENDATION.strip(), '', '## Appendix: query SQL', '',
            'Views (pipeline/profile/occupations_views.py), run against warehouse/opm.duckdb attached read-only as `w`:',
            '```sql', VIEWS.strip(), '```', '']
    for h, sql in HELPERS.items():
        out += [f'Helper `{h}`:', '```sql', sql.strip(), '```', '']
    for item in Q:
        out += [f"{item['id']}" + (f" (helpers: {', '.join(item['needs'])})" if item['needs'] else ''),
                '```sql', item['sql'], '```', '']
    open(OUT, 'w').write('\n'.join(out).rstrip() + '\n')
    print('wrote', OUT)


def report(args):
    ids = [a for a in args if a.startswith('Q')]
    if compute(ids) and (not ids or all(os.path.exists(f"{RESULTS}/{x['id']}.json") for x in Q)):
        write()
