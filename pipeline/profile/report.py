"""Phase 1a profile report: reads warehouse/profile/combined/*.parquet (made by profile.py combine) and
warehouse/profile/lookup_sizing/sizes.csv, writes warehouse/profile/REPORT.md plus entities.csv and
reconciliation.csv. Every table in the report names the query (Q<section>.<n>) that produced it; the SQL of every
query is printed in the report's appendix. Reference code lists (copies of the predecessor project's crosswalks) are
read from warehouse/profile/ref/.

Usage: .venv/bin/python pipeline/profile/report.py
"""
import csv, os, time
import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
P = 'warehouse/profile'
con = duckdb.connect()
con.execute("SET memory_limit='1500MB'; SET threads=4")
for k in ['schema', 'entity', 'flows', 'redaction']:
    con.execute(f"CREATE VIEW {k} AS SELECT * FROM '{P}/combined/{k}.parquet'")
for k in ['separation_codes', 'accession_codes', 'appointment_groups']:
    con.execute(f"CREATE VIEW ref_{k} AS SELECT * FROM read_csv('{P}/ref/{k}.csv', all_varchar=true)")
con.execute(f"CREATE VIEW sizes AS SELECT * FROM read_csv('{P}/lookup_sizing/sizes.csv')")

# Shared helper views. fy(m) = fiscal year of a YYYYMM string.
con.execute("""
CREATE MACRO fy(m) AS CAST(substr(m,1,4) AS INT) + CASE WHEN CAST(substr(m,5,2) AS INT) >= 10 THEN 1 ELSE 0 END;
CREATE MACRO mi(m) AS CAST(substr(m,1,4) AS INT) * 12 + CAST(substr(m,5,2) AS INT);
CREATE VIEW flows_fy AS SELECT *, fy(effective_yyyymm)::VARCHAR AS efy, mi(period) - mi(effective_yyyymm) AS lag FROM flows;
""")

OUT, QUERIES = [], []


def fmt(v, col=''):
    if col in ('fy', 'efy') and v is not None:
        return str(v)
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'Y' if v else 'N'
    if isinstance(v, int):
        return f'{v:,}'
    if isinstance(v, float):
        return f'{v:,.2f}'
    return str(v)


def table(qid, sql, title=None, note=None):
    QUERIES.append((qid, sql.strip()))
    r = con.sql(sql)
    cols, rows = r.columns, r.fetchall()
    cells = [[fmt(v, c) for v, c in zip(row, cols)] for row in rows]
    w = [max([len(c)] + [len(row[i]) for row in cells]) for i, c in enumerate(cols)]
    num = [all((row[i] == '' or row[i].replace(',', '').replace('.', '').lstrip('-').isdigit()) for row in cells)
           for i in range(len(cols))]
    line = lambda vals: '  '.join(v.rjust(w[i]) if num[i] else v.ljust(w[i]) for i, v in enumerate(vals)).rstrip()
    OUT.append(f"{title or ''}  [query {qid}]".strip())
    if note:
        OUT.append(note)
    OUT.append('```')
    OUT.append(line(cols))
    OUT.append('  '.join('-' * x for x in w))
    OUT.extend(line(row) for row in cells)
    if not rows:
        OUT.append('(no rows)')
    OUT.append('```')
    OUT.append('')
    return rows


def h(text):
    OUT.append(text)
    OUT.append('')


def scalar(sql):
    return con.execute(sql).fetchone()


t0 = time.time()
h('# Phase 1a profile: government-wide source files')
h('Read-only profile of the 537 files listed in data/opm_manifest.json (Oct 2011 to Aug 2026, three datasets). '
  'Built by pipeline/profile/profile.py (per-file parts, then combine) and this report by '
  'pipeline/profile/report.py. Every table cites its query; the SQL is in the appendix. Views used: '
  '`entity` (employment headcount per file month and org codes and names), `flows` (accessions and separations '
  'counts per file month, effective month, org, action code, appointment type, DRP, KDI flags), `redaction` '
  '(per file and department: REDACTED / NULL / empty counts per column), `schema`. '
  '"period" is the file (processing) month; "effective" is personnel_action_effective_date_yyyymm; fiscal year '
  'FY2025 = Oct 2024 to Sep 2025. Reference code lists are copies of the predecessor (DOJ) project crosswalks.')

# ---------------- 1. schema ----------------
h('## 1. Schema')
table('Q1.1', """
WITH s AS (SELECT dataset, period, string_agg(column_name, ',' ORDER BY position) AS cols, count(*) AS ncol
           FROM schema GROUP BY ALL)
SELECT dataset, count(DISTINCT cols) AS distinct_layouts, min(ncol) AS min_cols, max(ncol) AS max_cols,
       min(period) AS first_file, max(period) AS last_file, count(*) AS files
FROM s GROUP BY 1 ORDER BY 1""", 'Distinct column layouts (names and order) per dataset')
table('Q1.2', """
SELECT dataset, column_type, count(*) AS file_columns FROM schema GROUP BY ALL ORDER BY 1""", 'Column types')
table('Q1.3', """
WITH a AS (SELECT dataset, column_name FROM schema WHERE period = '201412'),
     b AS (SELECT dataset, column_name FROM schema WHERE period = '201501')
SELECT coalesce(a.dataset, b.dataset) AS dataset, coalesce(a.column_name, b.column_name) AS column_name,
       a.column_name IS NOT NULL AS in_dec2014, b.column_name IS NOT NULL AS in_jan2015
FROM a FULL JOIN b USING (dataset, column_name)
WHERE a.column_name IS NULL OR b.column_name IS NULL""", 'Columns differing between Dec 2014 and Jan 2015 files')
table('Q1.4', """
SELECT dataset, list(column_name ORDER BY position) AS columns FROM schema WHERE period = '202608' GROUP BY 1 ORDER BY 1""",
      'Column list (identical in every file of a dataset, per Q1.1)')

# ---------------- 2. entity hierarchy ----------------
h('## 2. Entity hierarchy (employment)')
h('Codes only; names are reported beside them. The full per-code table (latest names, parent, first and last month, '
  'months present, gap months, Aug 2026 headcount) is warehouse/profile/entities.csv (query Q2.0).')
QUERIES.append(('Q2.0', ENT_SQL := """
WITH months AS (SELECT period, row_number() OVER (ORDER BY period) AS i FROM (SELECT DISTINCT period FROM entity)),
lv AS (
  SELECT 'department' AS level, department_code AS code, department AS name, NULL AS parent_code, period, n FROM entity
  UNION ALL SELECT 'agency', agency_code, agency, nullif(department_code, 'No Data Reported'), period, n FROM entity
  UNION ALL SELECT 'subelement', agency_subelement_code, agency_subelement, agency_code, period, n FROM entity),
g AS (SELECT level, code, period, sum(n) AS n FROM lv GROUP BY ALL)
SELECT g.level, g.code,
  (SELECT arg_max(name, period) FROM lv WHERE lv.level = g.level AND lv.code IS NOT DISTINCT FROM g.code) AS latest_name,
  (SELECT count(DISTINCT name) FROM lv WHERE lv.level = g.level AND lv.code IS NOT DISTINCT FROM g.code) AS names,
  (SELECT string_agg(DISTINCT parent_code, '|') FROM lv WHERE lv.level = g.level AND lv.code IS NOT DISTINCT FROM g.code) AS parents,
  min(g.period) AS first_month, max(g.period) AS last_month, count(*) AS months_present,
  max(i) - min(i) + 1 - count(*) AS gap_months,
  sum(n) FILTER (WHERE g.period = '202608') AS headcount_202608, max(n) AS max_headcount
FROM g JOIN months USING (period) GROUP BY g.level, g.code ORDER BY 1, 2"""))
con.execute(f"CREATE TABLE ent AS {ENT_SQL}")
con.execute(f"COPY ent TO '{P}/entities.csv' (HEADER)")

table('Q2.1', """
SELECT level, count(*) FILTER (WHERE headcount_202608 > 0) AS codes_aug2026, count(*) AS codes_all_time,
       sum(headcount_202608) AS headcount_aug2026
FROM ent GROUP BY 1 ORDER BY 3""", 'Codes per level, Aug 2026 and all time (a NULL or blank code counts as one code)')
table('Q2.2', """
SELECT department_code, any_value(department) AS department, count(DISTINCT agency_code) AS agencies,
       count(DISTINCT agency_subelement_code) AS subelements, sum(n) AS headcount
FROM entity WHERE period = '202608' GROUP BY 1 HAVING count(DISTINCT agency_code) > 1 OR
      count(DISTINCT agency_code) = 1 AND any_value(agency_code) <> department_code ORDER BY 5 DESC""",
      'Departments whose agency level differs from the department level, Aug 2026 (all others: one agency, same code)')
table('Q2.3', """
SELECT 'agency under more than one department, within a month' AS test,
       count(*) AS cases FROM (SELECT period, agency_code FROM entity GROUP BY ALL HAVING count(DISTINCT department_code) > 1)
UNION ALL SELECT 'agency under more than one department, across all months',
       count(*) FROM (SELECT agency_code FROM entity GROUP BY ALL HAVING count(DISTINCT department_code) > 1)
UNION ALL SELECT 'same, ignoring department_code ''No Data Reported''',
       count(*) FROM (SELECT agency_code FROM entity WHERE department_code <> 'No Data Reported' GROUP BY ALL HAVING count(DISTINCT department_code) > 1)
UNION ALL SELECT 'subelement under more than one agency, within a month',
       count(*) FROM (SELECT period, agency_subelement_code FROM entity GROUP BY ALL HAVING count(DISTINCT agency_code) > 1)
UNION ALL SELECT 'subelement under more than one agency, across all months',
       count(*) FROM (SELECT agency_subelement_code FROM entity GROUP BY ALL HAVING count(DISTINCT agency_code) > 1)
UNION ALL SELECT 'subelement under more than one department, across all months',
       count(*) FROM (SELECT agency_subelement_code FROM entity WHERE department_code <> 'No Data Reported' GROUP BY ALL HAVING count(DISTINCT department_code) > 1)""",
      'Hierarchy partition tests (count(DISTINCT) ignores NULL codes)')
table('Q2.4', """
SELECT period, department_code, department, agency_code, agency, '[' || agency_subelement_code || ']' AS subelement_code,
       agency_subelement, n
FROM entity
WHERE department_code IS NULL OR trim(department_code) = '' OR department_code = 'REDACTED' OR department_code ILIKE 'no data%'
   OR agency_code IS NULL OR trim(agency_code) = '' OR agency_code = 'REDACTED'
   OR agency_subelement_code IS NULL OR trim(agency_subelement_code) = '' OR agency_subelement_code = 'REDACTED'
ORDER BY period""", 'Rows with an empty, NULL, REDACTED or "No Data Reported" org code (all months)')
table('Q2.5', """
SELECT level, count(*) AS codes,
  count(*) FILTER (WHERE first_month = '201110' AND last_month = '202608' AND gap_months = 0) AS every_month,
  count(*) FILTER (WHERE first_month > '201110') AS first_after_oct2011,
  count(*) FILTER (WHERE last_month < '202608') AS last_before_aug2026,
  count(*) FILTER (WHERE gap_months > 0) AS with_gaps, sum(gap_months) AS total_gap_months,
  count(*) FILTER (WHERE names > 1) AS codes_with_name_change,
  count(*) FILTER (WHERE parents LIKE '%|%') AS codes_with_parent_change
FROM ent WHERE code IS NOT NULL AND trim(code) <> '' AND code <> 'No Data Reported' GROUP BY 1 ORDER BY 2""",
      'Lifespans, gaps, name changes and parent changes per level (valid codes only; a gap = a month missing between first and last; the HU rows under department "No Data Reported" are not counted as a parent change)')
table('Q2.6', """
SELECT level, code, latest_name, first_month, last_month, months_present, gap_months, headcount_202608, max_headcount
FROM ent WHERE level = 'department' AND code IS NOT NULL AND code <> 'No Data Reported'
  AND (first_month > '201110' OR last_month < '202608' OR gap_months > 0) ORDER BY max_headcount DESC""",
      'Departments that start late, end early or have gaps')
table('Q2.7', """
SELECT level, code, list(DISTINCT name) AS names FROM (
  SELECT 'department' AS level, department_code AS code, department AS name FROM entity
  UNION ALL SELECT 'agency', agency_code, agency FROM entity)
GROUP BY ALL HAVING count(DISTINCT name) > 1 ORDER BY 1, 2""", 'Department and agency codes with more than one name')
table('Q2.8', """
SELECT level, code, latest_name, names, first_month, last_month, max_headcount
FROM ent WHERE level = 'subelement' AND names > 1 ORDER BY max_headcount DESC LIMIT 15""",
      'Largest subelements with more than one name (top 15 of the count in Q2.5)')
table('Q2.9', """
WITH a AS (SELECT level, code, headcount_202608 AS h FROM ent WHERE headcount_202608 > 0)
SELECT level, count(*) FILTER (WHERE h < 30) AS lt_30, count(*) FILTER (WHERE h BETWEEN 30 AND 499) AS h30_499,
       count(*) FILTER (WHERE h BETWEEN 500 AND 4999) AS h500_4999, count(*) FILTER (WHERE h >= 5000) AS h5000_plus,
       count(*) AS total
FROM a GROUP BY 1 ORDER BY 6""", 'Size distribution, Aug 2026 headcount')
table('Q2.10', """
WITH d AS (SELECT department_code, any_value(department) AS department,
                  sum(n) FILTER (WHERE period = '201412') AS dec2014, sum(n) FILTER (WHERE period = '201501') AS jan2015
           FROM entity WHERE period IN ('201412', '201501') GROUP BY 1)
SELECT *, jan2015 - dec2014 AS change, round(100.0 * (jan2015 - dec2014) / dec2014, 2) AS pct
FROM d WHERE dec2014 IS NULL OR jan2015 IS NULL OR abs(jan2015 - dec2014) > 0.02 * dec2014 ORDER BY dec2014 DESC NULLS LAST""",
      'Departments whose headcount changes more than 2% from Dec 2014 to Jan 2015 (or appear on one side only)')
table('Q2.11', """
WITH m AS (SELECT period, sum(n) AS h FROM entity WHERE department_code = 'TR' GROUP BY 1),
     y AS (SELECT period, h, lag(h) OVER (ORDER BY period) AS prev FROM m)
SELECT substr(period, 1, 4) AS jan_of, round(100.0 * (h - prev) / prev, 2) AS treasury_dec_to_jan_pct
FROM y WHERE substr(period, 5, 2) = '01' AND prev IS NOT NULL ORDER BY 1""",
      'Context for Treasury in Q2.10: its Dec to Jan change every year (seasonal filing-season hiring)')
table('Q2.12', """
WITH d AS (SELECT department_code, sum(n) FILTER (WHERE period = '201412') AS a, sum(n) FILTER (WHERE period = '201501') AS b
           FROM entity WHERE period IN ('201412', '201501') GROUP BY 1)
SELECT count(*) AS departments, count(*) FILTER (WHERE a IS NULL OR b IS NULL) AS on_one_side_only,
       count(*) FILTER (WHERE a >= 500) AS with_500_plus,
       round(median(abs(100.0 * (b - a) / a)) FILTER (WHERE a >= 500), 2) AS median_abs_pct_500_plus,
       round(max(abs(100.0 * (b - a) / a)) FILTER (WHERE a >= 500), 2) AS max_abs_pct_500_plus
FROM d""", 'Dec 2014 to Jan 2015 summary')

# ---------------- 3. codes ----------------
h('## 3. Codes in Accessions and Separations')
h('Counts are by effective fiscal year, from every file (all processing months). FY2010 and FY2011 hold late actions '
  'processed from Oct 2011 on; FY2026 is partial (to Aug 2026).')
table('Q3.1', """
PIVOT (SELECT dataset, action_code, action, efy, n FROM flows_fy) ON efy USING sum(n)
GROUP BY dataset, action_code, action ORDER BY dataset, action_code""", 'Personnel action codes by effective fiscal year')
table('Q3.2', """
SELECT f.dataset, f.action_code, any_value(f.action) AS action, sum(n) AS rows,
       coalesce(s.code, a.code) IS NOT NULL AS in_doj_crosswalk
FROM flows f
LEFT JOIN ref_separation_codes s ON f.dataset = 'separations' AND s.code = f.action_code
LEFT JOIN ref_accession_codes a ON f.dataset = 'accessions' AND a.code = f.action_code
GROUP BY f.dataset, f.action_code, s.code, a.code ORDER BY 1, 2""", 'Action codes against the DOJ crosswalks')
table('Q3.3', """
SELECT f.appointment_type_code AS code, list(DISTINCT f.appointment_type) AS label,
       sum(n) FILTER (WHERE dataset = 'accessions') AS accessions, sum(n) FILTER (WHERE dataset = 'separations') AS separations,
       g."group" AS doj_group, g.code IS NOT NULL AS in_doj_crosswalk
FROM flows f LEFT JOIN ref_appointment_groups g ON g.code = f.appointment_type_code
GROUP BY f.appointment_type_code, g.code, g."group" ORDER BY 1""", 'Appointment type codes, all files, against DOJ appointment_groups.csv')
for ds in ['accessions', 'separations']:
    table(f"Q3.{4 if ds == 'accessions' else 5}", f"""
PIVOT (SELECT appointment_type_code, efy, n FROM flows_fy WHERE dataset = '{ds}') ON efy USING sum(n)
GROUP BY appointment_type_code ORDER BY 1""", f'Appointment type codes by effective fiscal year, {ds}')
table('Q3.6', """
PIVOT (SELECT coalesce(drp_indicator, 'NULL') AS drp_indicator, efy, n FROM flows_fy WHERE dataset = 'separations')
ON drp_indicator USING sum(n) GROUP BY efy ORDER BY efy""", 'DRP indicator values by effective fiscal year (separations)')
table('Q3.7', """
PIVOT (SELECT action_code, efy, n FROM flows_fy WHERE dataset = 'separations' AND drp_indicator = 'Y')
ON action_code USING sum(n) GROUP BY efy ORDER BY efy""", 'DRP = Y separations by separation code and effective fiscal year')

# ---------------- 4. transfers ----------------
h('## 4. Transfers')
h('SA, SB = transfer out (individual, mass); AA, AB = transfer in (individual, mass). AB is not in the DOJ '
  'crosswalk. There is no person ID, so this compares aggregates only.')
table('Q4.1', """
SELECT efy,
  sum(n) FILTER (WHERE action_code = 'SA') AS sa, sum(n) FILTER (WHERE action_code = 'SB') AS sb,
  sum(n) FILTER (WHERE action_code = 'AA') AS aa, sum(n) FILTER (WHERE action_code = 'AB') AS ab,
  sum(n) FILTER (WHERE action_code IN ('SA', 'SB')) - sum(n) FILTER (WHERE action_code IN ('AA', 'AB')) AS out_minus_in,
  sum(n) FILTER (WHERE action_code = 'SA') - sum(n) FILTER (WHERE action_code = 'AA') AS sa_minus_aa,
  sum(n) FILTER (WHERE action_code = 'SB') - sum(n) FILTER (WHERE action_code = 'AB') AS sb_minus_ab,
  round(100.0 * sum(n) FILTER (WHERE action_code IN ('SA', 'SB')) / sum(n) FILTER (WHERE dataset = 'separations'), 1) AS out_pct_of_seps,
  round(100.0 * sum(n) FILTER (WHERE action_code IN ('AA', 'AB')) / sum(n) FILTER (WHERE dataset = 'accessions'), 1) AS in_pct_of_hires
FROM flows_fy GROUP BY 1 ORDER BY 1""", 'Government-wide transfers by effective fiscal year')
table('Q4.2', """
SELECT department_code, any_value(department) AS department,
  sum(n) FILTER (WHERE action_code = 'SA') AS sa, sum(n) FILTER (WHERE action_code = 'SB') AS sb,
  sum(n) FILTER (WHERE action_code = 'AA') AS aa, sum(n) FILTER (WHERE action_code = 'AB') AS ab,
  coalesce(sum(n) FILTER (WHERE action_code IN ('AA', 'AB')), 0) - coalesce(sum(n) FILTER (WHERE action_code IN ('SA', 'SB')), 0) AS net_in,
  sum(n) FILTER (WHERE action_code IN ('SA', 'SB', 'AA', 'AB')) AS volume
FROM flows_fy WHERE efy = '2025' GROUP BY 1 ORDER BY volume DESC LIMIT 15""",
      'Top 15 departments by transfer volume (out + in), FY2025')

table('Q4.3', """
SELECT action_code, department_code, agency_code, agency_subelement_code, any_value(agency_subelement) AS subelement, sum(n) AS rows
FROM flows_fy WHERE efy = '2022' AND action_code IN ('AB', 'SB') GROUP BY ALL HAVING sum(n) >= 300 ORDER BY 1, 6 DESC""",
      'FY2022 mass transfers (AB in, SB out) by subelement, 300+ rows')

# ---------------- 5. time basis ----------------
h('## 5. Time basis: processing month minus effective month (lag, months)')
table('Q5.1', """
SELECT dataset,
  sum(n) FILTER (WHERE lag < 0) AS negative, sum(n) FILTER (WHERE lag = 0) AS lag0, sum(n) FILTER (WHERE lag = 1) AS lag1,
  sum(n) FILTER (WHERE lag = 2) AS lag2, sum(n) FILTER (WHERE lag = 3) AS lag3, sum(n) FILTER (WHERE lag BETWEEN 4 AND 6) AS lag4_6,
  sum(n) FILTER (WHERE lag BETWEEN 7 AND 12) AS lag7_12, sum(n) FILTER (WHERE lag > 12) AS lag13_plus, max(lag) AS max_lag,
  round(100.0 * sum(n) FILTER (WHERE lag = 0) / sum(n), 1) AS pct_lag0, round(100.0 * sum(n) FILTER (WHERE lag <= 3) / sum(n), 2) AS pct_within3
FROM flows_fy GROUP BY 1 ORDER BY 1""", 'Lag distribution, all actions')
table('Q5.2', """
SELECT dataset, substr(effective_yyyymm, 5, 2) = '09' AS effective_in_september,
  sum(n) AS actions, round(100.0 * sum(n) FILTER (WHERE lag = 0) / sum(n), 1) AS pct_lag0,
  round(100.0 * sum(n) FILTER (WHERE lag = 1) / sum(n), 1) AS pct_lag1, round(100.0 * sum(n) FILTER (WHERE lag = 2) / sum(n), 1) AS pct_lag2,
  round(100.0 * sum(n) FILTER (WHERE lag = 3) / sum(n), 1) AS pct_lag3, round(100.0 * sum(n) FILTER (WHERE lag > 3) / sum(n), 2) AS pct_lag4_plus
FROM flows_fy WHERE effective_yyyymm BETWEEN '201110' AND '202505' GROUP BY 1, 2 ORDER BY 1, 2""",
      'Lag for actions effective in September vs other months (effective Oct 2011 to May 2025, so every lag up to 15 months is observable)')
table('Q5.3', """
SELECT dataset, substr(effective_yyyymm, 5, 2) AS effective_month, sum(n) AS actions,
  round(100.0 * sum(n) / sum(sum(n)) OVER (PARTITION BY dataset), 1) AS pct_of_year
FROM flows_fy WHERE effective_yyyymm BETWEEN '201110' AND '202509' GROUP BY 1, 2 ORDER BY 1, 2""",
      'Seasonality of actions by effective calendar month (FY2012 to FY2025)')
table('Q5.4', """
SELECT dataset, period AS processing_month, sum(n) AS actions,
  sum(n) FILTER (WHERE lag > 0) AS effective_earlier, round(100.0 * sum(n) FILTER (WHERE lag > 0) / sum(n), 1) AS pct_late
FROM flows_fy WHERE period >= '202406' GROUP BY 1, 2 ORDER BY 1, 2""", 'Share of each recent file made of earlier-effective actions')

# ---------------- 6. redaction ----------------
h('## 6. Redaction')
h('Redaction counts are per file (processing month). "FY2025 separations" here = separations files Oct 2024 to '
  'Sep 2025 (processing basis, since the redaction parts are per file). A field counts as REDACTED only when its '
  'value is the literal text REDACTED.')
table('Q6.1', """
SELECT column_name, count(DISTINCT file) FILTER (WHERE n_redacted > 0) AS files_with_redacted,
  sum(n_redacted) FILTER (WHERE dataset = 'employment') AS employment_rows,
  sum(n_redacted) FILTER (WHERE dataset = 'accessions') AS accession_rows,
  sum(n_redacted) FILTER (WHERE dataset = 'separations') AS separation_rows,
  string_agg(DISTINCT department_code, ',') FILTER (WHERE n_redacted > 0 AND column_name IN ('grade', 'step_or_rate_type', 'step_or_rate_type_code')) AS depts_if_grade
FROM redaction GROUP BY 1 HAVING sum(n_redacted) > 0 ORDER BY 1""", 'Fields ever REDACTED (all 537 files)')
for qid, ds, cond, label in [('Q6.2', 'employment', "period = '202608'", 'Aug 2026 employment'),
                             ('Q6.3', 'separations', "period BETWEEN '202410' AND '202509'", 'FY2025 separations files')]:
    table(qid, f"""
WITH t AS (SELECT column_name, sum(n_redacted) AS r, sum(n_null) AS nl, sum(n_empty) AS e, sum(rows) AS rows
           FROM redaction WHERE dataset = '{ds}' AND {cond} GROUP BY 1)
SELECT column_name, r AS redacted, rows, round(100.0 * r / rows, 2) AS pct_redacted FROM t
WHERE r > 0 ORDER BY pct_redacted DESC, column_name""", f'Share REDACTED per field, {label}, government-wide')
    table(qid + 'b', f"""
WITH t AS (SELECT department_code, column_name, sum(n_redacted) AS r, sum(rows) AS rows
           FROM redaction WHERE dataset = '{ds}' AND {cond} GROUP BY 1, 2),
     top AS (SELECT department_code, max(rows) AS rows FROM t GROUP BY 1 ORDER BY 2 DESC LIMIT 15)
SELECT department_code, top.rows,
  round(100.0 * max(r) FILTER (WHERE column_name = 'annualized_adjusted_basic_pay') / top.rows, 1) AS pay,
  round(100.0 * max(r) FILTER (WHERE column_name = 'duty_station_state') / top.rows, 1) AS duty_station_state,
  round(100.0 * max(r) FILTER (WHERE column_name = 'duty_station_country') / top.rows, 1) AS duty_station_country,
  round(100.0 * max(r) FILTER (WHERE column_name = 'bargaining_unit_code') / top.rows, 1) AS bargaining_unit,
  round(100.0 * max(r) FILTER (WHERE column_name = 'personnel_office_identifier_code') / top.rows, 1) AS personnel_office,
  round(100.0 * max(r) FILTER (WHERE column_name = 'grade') / top.rows, 1) AS grade
FROM t JOIN top USING (department_code) GROUP BY 1, 2 ORDER BY 2 DESC""",
          f'Share REDACTED (%) by department, {label}, 15 largest by rows (location fields other than country match duty_station_state, see Q6.1)')
table('Q6.4', """
WITH t AS (SELECT department_code, sum(rows) FILTER (WHERE column_name = 'annualized_adjusted_basic_pay') AS rows,
                  sum(n_redacted) FILTER (WHERE column_name = 'annualized_adjusted_basic_pay') AS pay_r
           FROM redaction WHERE dataset = 'employment' AND period = '202608' GROUP BY 1)
SELECT count(*) AS departments, count(*) FILTER (WHERE pay_r = 0) AS none_redacted,
  count(*) FILTER (WHERE pay_r = rows) AS all_redacted, count(*) FILTER (WHERE pay_r > 0 AND pay_r < rows) AS partly_redacted
FROM t""", 'Pay redaction per department, Aug 2026 employment: all, none or part')
table('Q6.5', """
SELECT period, round(100.0 * sum(n_redacted) / sum(rows), 1) AS pay_pct_redacted
FROM redaction WHERE dataset = 'employment' AND column_name = 'annualized_adjusted_basic_pay'
  AND substr(period, 5, 2) = '09' GROUP BY 1 ORDER BY 1""", 'Pay REDACTED share over time, September employment files')

# ---------------- 7. known issues ----------------
h('## 7. Known data issues')
table('Q7.1', """
SELECT dataset, period AS file_month, sum(n) FILTER (WHERE los_kdi001) AS los_124_126_years, sum(n) AS rows
FROM flows GROUP BY 1, 2 HAVING sum(n) FILTER (WHERE los_kdi001) > 0 ORDER BY 1, 2""",
      'KDI-001: length_of_service_years between 124 and 126, by file month (accessions included for comparison)')
table('Q7.2', """
SELECT dataset, sum(n) FILTER (WHERE los_kdi001) AS los_124_126_years FROM flows GROUP BY 1 ORDER BY 1""", 'KDI-001 totals')
table('Q7.3', """
PIVOT (SELECT dataset, period, occcat_status, n FROM flows WHERE period >= '202401') ON occcat_status USING sum(n)
GROUP BY dataset, period ORDER BY dataset, period""", 'KDI-002: occupational_category status by file month, from Jan 2024')
table('Q7.4', """
SELECT dataset, min(period) FILTER (WHERE occcat_status <> 'OK') AS first_bad_file, sum(n) FILTER (WHERE occcat_status <> 'OK' AND period < '202406') AS bad_before_jun2024
FROM flows GROUP BY 1""", 'KDI-002: first file month with a non-OK occupational category')
table('Q7.5', """
SELECT department_code, any_value(department) AS department, sum(n) AS rows,
  sum(n) FILTER (WHERE occcat_status = 'EMPTY') AS empty, sum(n) FILTER (WHERE occcat_status = 'NULL') AS null_,
  sum(n) FILTER (WHERE occcat_status = 'NO DATA REPORTED') AS no_data_reported,
  round(100.0 * sum(n) FILTER (WHERE occcat_status <> 'OK') / sum(n), 1) AS pct_not_ok
FROM flows WHERE dataset = 'separations' AND period >= '202406' GROUP BY 1 ORDER BY rows DESC LIMIT 20""",
      'KDI-002 by department: separations files Jun 2024 to Aug 2026, 20 largest by rows')
table('Q7.6', """
WITH d AS (SELECT department_code, sum(n) AS rows, coalesce(sum(n) FILTER (WHERE occcat_status <> 'OK'), 0) AS bad
           FROM flows WHERE dataset = 'separations' AND period >= '202406' GROUP BY 1)
SELECT count(*) AS departments, count(*) FILTER (WHERE bad = 0) AS clean, count(*) FILTER (WHERE bad = rows) AS all_bad,
  count(*) FILTER (WHERE bad > 0 AND bad < rows) AS partly_bad, sum(bad) AS bad_rows, sum(rows) AS rows
FROM d""", 'KDI-002 summary over departments, separations files Jun 2024 to Aug 2026')
table('Q7.7', """
SELECT dataset, sum(n_null) FILTER (WHERE column_name = 'occupational_category') AS occcat_null,
  sum(n_empty) FILTER (WHERE column_name = 'occupational_category') AS occcat_empty,
  sum(rows) FILTER (WHERE column_name = 'occupational_category') AS rows
FROM redaction GROUP BY 1 ORDER BY 1""", 'occupational_category NULL or empty, all files, per dataset (employment cross-check)')

# ---------------- 8. Department of Defense ----------------
h('## 8. Department of Defense / Department of War (department_code DOD)')
table('Q8.1', """
PIVOT (SELECT agency_code, period, n FROM entity WHERE department_code = 'DOD' AND period BETWEEN '202601' AND '202608')
ON period USING sum(n) GROUP BY agency_code ORDER BY 1""", 'Headcount by agency_code, Jan to Aug 2026')
table('Q8.2', """
PIVOT (SELECT dataset, agency_code, effective_yyyymm, n FROM flows WHERE department_code = 'DOD' AND effective_yyyymm BETWEEN '202601' AND '202608')
ON effective_yyyymm USING sum(n) GROUP BY dataset, agency_code ORDER BY 1, 2""",
      'Accessions and separations by agency_code and effective month, Jan to Aug 2026 (newest 3 months provisional)')
table('Q8.3', """
PIVOT (SELECT dataset, agency_code, period, n FROM flows WHERE department_code = 'DOD' AND period BETWEEN '202601' AND '202608')
ON period USING sum(n) GROUP BY dataset, agency_code ORDER BY 1, 2""",
      'Same by processing (file) month')
table('Q8.4', """
WITH p AS (PIVOT (SELECT agency_subelement_code AS sub, period, n FROM entity WHERE department_code = 'DOD' AND period BETWEEN '202604' AND '202608')
           ON period USING sum(n) GROUP BY sub),
     nm AS (SELECT code AS sub, latest_name FROM ent WHERE level = 'subelement')
SELECT sub, latest_name, "202604", "202605", "202606", "202607", "202608",
  round(100.0 * ("202606" - "202605") / "202605", 1) AS jun_vs_may_pct, round(100.0 * ("202607" - "202605") / "202605", 1) AS jul_vs_may_pct
FROM p JOIN nm USING (sub)
WHERE "202605" >= 300 AND (abs(coalesce("202606", 0) - "202605") > 0.05 * "202605" OR abs(coalesce("202607", 0) - "202605") > 0.05 * "202605")
ORDER BY "202605" DESC""", 'DOD subelements (May 2026 headcount 300+) whose Jun or Jul headcount differs from May by more than 5%')
table('Q8.5', """
WITH p AS (SELECT agency_subelement_code AS sub, period, sum(n) AS h FROM entity WHERE department_code = 'DOD' AND period BETWEEN '202605' AND '202608' GROUP BY 1, 2),
     w AS (PIVOT p ON period USING sum(h) GROUP BY sub)
SELECT count(*) AS subelements_may, count(*) FILTER (WHERE "202606" IS NULL) AS missing_jun, count(*) FILTER (WHERE "202607" IS NULL) AS missing_jul,
  count(*) FILTER (WHERE "202608" IS NULL) AS missing_aug,
  count(*) FILTER (WHERE "202606" > 1.5 * "202605") AS jun_over_150pct, count(*) FILTER (WHERE "202606" < 0.9 * "202605") AS jun_under_90pct,
  count(*) FILTER (WHERE "202607" < 0.9 * "202605") AS jul_under_90pct
FROM w WHERE "202605" > 0""", 'DOD subelements: missing or abnormal in Jun and Jul 2026, relative to May')

table('Q8.6', """
WITH p AS (SELECT agency_subelement_code AS sub, period, sum(n) AS h FROM entity WHERE department_code = 'DOD' AND period BETWEEN '202605' AND '202608' GROUP BY 1, 2),
     w AS (PIVOT p ON period USING sum(h) GROUP BY sub),
     nm AS (SELECT code AS sub, latest_name, last_month FROM ent WHERE level = 'subelement')
SELECT sub, latest_name, last_month, "202605", "202606", "202607", "202608" FROM w JOIN nm USING (sub)
WHERE "202605" > 0 AND ("202606" IS NULL OR "202607" IS NULL OR "202608" IS NULL) ORDER BY "202605" DESC""", 'DOD subelements present in May 2026 but missing in Jun, Jul or Aug 2026')

table('Q8.9', """
PIVOT (SELECT substr(period, 1, 4) AS year, substr(period, 5, 2) AS month, n FROM entity
       WHERE agency_subelement_code = 'DD16' AND period >= '202201') ON month USING sum(n) GROUP BY year ORDER BY year""",
      'DD16 (education activity) headcount by month: the Jun and Jul dip recurs every year')
dup_sql = ' UNION ALL '.join(
    f"""SELECT '{per}' AS month, '{sub}' AS subelement, count(*) AS rows,
  (SELECT count(*) FROM (SELECT DISTINCT * FROM read_parquet('data/Employment/employment_{per}_*.parquet') WHERE agency_subelement_code = '{sub}')) AS distinct_rows
FROM read_parquet('data/Employment/employment_{per}_*.parquet') WHERE agency_subelement_code = '{sub}'"""
    for per in ['202605', '202606', '202607'] for sub in ['DD34', 'DD01', 'DD06', 'ARXF', 'DD15', 'DD16'])
table('Q8.7', f"SELECT *, rows - distinct_rows AS extra_rows FROM ({dup_sql}) ORDER BY subelement, month",
      'Rows vs fully distinct rows (all columns) in the source files for the anomalous subelements. Some identical rows are '
      'expected (no person ID; same attributes); a jump in the difference marks duplicated records')
table('Q8.8', """
WITH s AS (SELECT agency_subelement_code AS sub, period, sum(n) AS h FROM entity GROUP BY 1, 2),
     w AS (SELECT *, lag(h) OVER (PARTITION BY sub ORDER BY period) AS prev, lead(h) OVER (PARTITION BY sub ORDER BY period) AS next FROM s)
SELECT w.sub, e.latest_name, w.period, w.prev, w.h AS headcount, w.next, round(w.h / ((w.prev + w.next) / 2.0), 2) AS ratio_to_neighbours
FROM w JOIN ent e ON e.level = 'subelement' AND e.code = w.sub
WHERE w.h >= 100 AND (w.h > 1.5 * w.prev AND w.h > 1.5 * w.next OR w.h < 0.67 * w.prev AND w.h < 0.67 * w.next)
ORDER BY w.period, w.sub""", 'All subelements, all months: one-month spikes or dips (headcount 100+, over 1.5x or under 0.67x both neighbouring months)')

# ---------------- 9. reconciliation ----------------
h('## 9. Reconciliation: headcount change vs net flow, per fiscal year')
h('For FY y: change = headcount(Sep y) - headcount(Sep y-1); net = accessions - separations with effective month in '
  'Oct y-1 to Sep y, from all files; gap = change - net; average = mean of the 12 month-end headcounts. FY2012 '
  'starts at Oct 2011 (no Sep 2011 file): change = Sep 2012 - Oct 2011 and net counts effective Nov 2011 to Sep 2012. '
  'Size band is by average headcount. Full table: warehouse/profile/reconciliation.csv.')
QUERIES.append(('Q9.0', REC_SQL := """
WITH hc AS (
  SELECT 'department' AS level, department_code AS code, period, sum(n) AS h FROM entity GROUP BY ALL
  UNION ALL SELECT 'agency', agency_code, period, sum(n) FROM entity GROUP BY ALL
  UNION ALL SELECT 'government', 'ALL', period, sum(n) FROM entity GROUP BY ALL),
fl AS (
  SELECT 'department' AS level, department_code AS code, effective_yyyymm AS m, dataset, sum(n) AS n FROM flows GROUP BY ALL
  UNION ALL SELECT 'agency', agency_code, effective_yyyymm, dataset, sum(n) FROM flows GROUP BY ALL
  UNION ALL SELECT 'government', 'ALL', effective_yyyymm, dataset, sum(n) FROM flows GROUP BY ALL),
codes AS (SELECT DISTINCT level, code FROM hc WHERE code IS NOT NULL),
fys AS (SELECT range AS fy FROM range(2012, 2026)),
grid AS (SELECT level, code, fy, CASE WHEN fy = 2012 THEN '201110' ELSE (fy - 1)::VARCHAR || '09' END AS start_m,
                fy::VARCHAR || '09' AS end_m FROM codes, fys)
SELECT g.level, g.code, g.fy,
  coalesce((SELECT h FROM hc WHERE hc.level = g.level AND hc.code = g.code AND hc.period = g.start_m), 0) AS start_hc,
  coalesce((SELECT h FROM hc WHERE hc.level = g.level AND hc.code = g.code AND hc.period = g.end_m), 0) AS end_hc,
  coalesce((SELECT sum(h) FROM hc WHERE hc.level = g.level AND hc.code = g.code AND fy(hc.period) = g.fy), 0) / 12.0 AS avg_hc,
  coalesce((SELECT sum(n) FROM fl WHERE fl.level = g.level AND fl.code = g.code AND fl.dataset = 'accessions' AND fl.m > g.start_m AND fl.m <= g.end_m), 0) AS hires,
  coalesce((SELECT sum(n) FROM fl WHERE fl.level = g.level AND fl.code = g.code AND fl.dataset = 'separations' AND fl.m > g.start_m AND fl.m <= g.end_m), 0) AS departures
FROM grid g"""))
con.execute(f"""CREATE TABLE rec AS SELECT *, end_hc - start_hc AS change, hires - departures AS net,
  (end_hc - start_hc) - (hires - departures) AS gap,
  CASE WHEN avg_hc > 0 THEN 100.0 * ((end_hc - start_hc) - (hires - departures)) / avg_hc END AS gap_pct,
  CASE WHEN avg_hc < 30 THEN '1: <30' WHEN avg_hc < 500 THEN '2: 30-499' WHEN avg_hc < 5000 THEN '3: 500-4,999'
       ELSE '4: 5,000+' END AS size_band
FROM ({REC_SQL}) WHERE start_hc > 0 OR end_hc > 0 OR hires > 0 OR departures > 0""")
con.execute(f"COPY (SELECT * FROM rec ORDER BY level, code, fy) TO '{P}/reconciliation.csv' (HEADER)")
table('Q9.1', """
SELECT fy, start_hc, end_hc, change, hires, departures, net, gap, round(gap_pct, 2) AS gap_pct
FROM rec WHERE level = 'government' ORDER BY fy""", 'Government total')
table('Q9.2', """
SELECT level, size_band, count(*) AS entity_years,
  round(median(abs(gap)), 0) AS median_abs_gap, round(quantile_cont(abs(gap), 0.9), 0) AS p90_abs_gap, max(abs(gap)) AS max_abs_gap,
  round(median(abs(gap_pct)), 2) AS median_abs_pct, round(quantile_cont(abs(gap_pct), 0.9), 2) AS p90_abs_pct,
  round(quantile_cont(abs(gap_pct), 0.99), 2) AS p99_abs_pct,
  count(*) FILTER (WHERE abs(gap_pct) > 2) AS over_2pct, count(*) FILTER (WHERE abs(gap_pct) > 5) AS over_5pct,
  count(*) FILTER (WHERE abs(gap_pct) > 10) AS over_10pct, count(*) FILTER (WHERE abs(gap) >= 500) AS over_500_people
FROM rec WHERE level <> 'government' AND avg_hc > 0 GROUP BY 1, 2 ORDER BY 1 DESC, 2""",
      'Distribution of the gap by entity size (FY2012 to FY2025; entity-years with some headcount)')
table('Q9.3', """
SELECT fy, count(*) AS departments, round(median(gap_pct), 2) AS median_gap_pct, round(median(abs(gap_pct)), 2) AS median_abs_gap_pct,
  count(*) FILTER (WHERE abs(gap_pct) > 5) AS over_5pct
FROM rec WHERE level = 'department' AND avg_hc >= 500 GROUP BY 1 ORDER BY 1""",
      'Departments with average headcount 500+: gap by fiscal year')
table('Q9.4', """
SELECT r.level, r.code, e.latest_name, r.fy, round(r.avg_hc, 0) AS avg_hc, r.change, r.net, r.gap, round(r.gap_pct, 1) AS gap_pct
FROM rec r LEFT JOIN ent e ON e.level = r.level AND e.code = r.code
WHERE r.level = 'department' AND r.avg_hc >= 500 ORDER BY abs(r.gap_pct) DESC LIMIT 25""",
      'Largest gaps (% of average), departments with average headcount 500+')

table('Q9.5', """
WITH r AS (SELECT *, CASE WHEN fy = 2025 THEN 'FY2025' ELSE 'FY2012-FY2024' END AS years FROM rec WHERE level = 'department' AND avg_hc > 0)
SELECT years, size_band, count(*) AS entity_years,
  count(*) FILTER (WHERE abs(gap) >= 500) AS abs_gap_500,
  count(*) FILTER (WHERE abs(gap_pct) > 2) AS pct_over_2,
  count(*) FILTER (WHERE abs(gap_pct) > 5) AS pct_over_5,
  count(*) FILTER (WHERE abs(gap_pct) > 2 AND abs(gap) >= 50) AS pct2_and_50,
  count(*) FILTER (WHERE abs(gap_pct) > 5 AND abs(gap) >= 20) AS pct5_and_20,
  count(*) FILTER (WHERE abs(gap_pct) > 1 AND abs(gap) >= 500) AS pct1_and_500
FROM r GROUP BY 1, 2 ORDER BY 1, 2""", 'Department entity-years flagged under candidate thresholds (illustrative; thresholds are a Phase 1 decision)')
table('Q9.6', """
WITH h AS (SELECT period AS m, sum(n) AS headcount FROM entity WHERE period BETWEEN '202506' AND '202603' GROUP BY 1),
     f AS (SELECT effective_yyyymm AS m, sum(n) FILTER (WHERE dataset = 'accessions') AS hires,
                  sum(n) FILTER (WHERE dataset = 'separations') AS departures,
                  sum(n) FILTER (WHERE dataset = 'separations' AND drp_indicator = 'Y') AS drp
           FROM flows WHERE effective_yyyymm BETWEEN '202506' AND '202603' GROUP BY 1)
SELECT m AS month, headcount, headcount - lag(headcount) OVER (ORDER BY m) AS change, hires, departures, drp,
  hires - departures AS net FROM h JOIN f USING (m) ORDER BY m""",
      'Fiscal year end 2025, government-wide: separations effective in September leave the employment file in October')

# ---------------- 10. Look-Up sizing ----------------
h('## 10. Look-Up sizing')
h('Each sample file was rewritten as Parquet with ZSTD, all columns as text (pipeline/profile/profile.py lookup_sizing, '
  'results in warehouse/profile/lookup_sizing/sizes.csv). Extrapolation = bytes per row x total rows.')
table('Q10.1', """
SELECT dataset, source_file, department_code, rows, zstd_bytes, round(zstd_bytes / rows, 1) AS bytes_per_row,
  round(zstd_bytes / 1e6, 1) AS zstd_mb FROM sizes ORDER BY dataset, department_code = 'ALL' DESC, rows DESC""", 'Measured samples')
table('Q10.2', """
WITH tot AS (SELECT 'employment' AS dataset, sum(n) AS rows FROM entity
             UNION ALL SELECT dataset, sum(n) FROM flows GROUP BY 1),
     bpr AS (SELECT dataset, min(zstd_bytes / rows) AS lo, max(zstd_bytes / rows) AS hi FROM sizes WHERE department_code = 'ALL' GROUP BY 1)
SELECT dataset, rows AS total_rows, round(lo, 1) AS bytes_per_row_low, round(hi, 1) AS bytes_per_row_high,
  round(rows * lo / 1e9, 2) AS est_gb_low, round(rows * hi / 1e9, 2) AS est_gb_high,
  (SELECT count(DISTINCT period) FROM entity) AS months
FROM tot JOIN bpr USING (dataset) ORDER BY 1""", 'Extrapolated full government-wide Look-Up (all 179 months)')
table('Q10.3', """
WITH s AS (SELECT department_code, zstd_bytes / rows AS bpr, rows AS rows_aug, zstd_bytes FROM sizes WHERE department_code <> 'ALL'),
     emp AS (SELECT department_code, sum(n) AS rows FROM entity GROUP BY 1),
     fl AS (SELECT department_code, sum(n) AS rows FROM flows GROUP BY 1),
     fbpr AS (SELECT sum(zstd_bytes) / sum(rows) AS b FROM sizes WHERE dataset <> 'employment')
SELECT s.department_code, round(s.zstd_bytes / 1e6, 1) AS aug2026_employment_mb, emp.rows AS employment_rows_all_months,
  round(emp.rows * s.bpr / 1e9, 2) AS employment_gb, fl.rows AS action_rows,
  round(fl.rows * (SELECT b FROM fbpr) / 1e6, 0) AS actions_mb,
  round((emp.rows * s.bpr + fl.rows * (SELECT b FROM fbpr)) / 1e9, 2) AS total_gb
FROM s JOIN emp USING (department_code) JOIN fl USING (department_code) ORDER BY s.rows_aug DESC""",
      'Per department, 10 largest (employment bytes per row measured per department in Aug 2026; actions use the pooled accessions + separations rate)')

# ---------------- appendix ----------------
OUT.append('## Appendix: query SQL')
OUT.append('')
for qid, sql in QUERIES:
    OUT.append(f'### {qid}')
    OUT.append('```sql')
    OUT.append(sql)
    OUT.append('```')
    OUT.append('')
text = '\n'.join(OUT) + '\n'
assert chr(0x2014) not in text
open(f'{P}/REPORT.md', 'w', encoding='utf-8').write(text)
print(f'wrote {P}/REPORT.md ({len(text):,} bytes, {len(QUERIES)} queries) in {time.time() - t0:.0f}s')
