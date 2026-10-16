"""Build or refresh warehouse/opm.duckdb from the OPM Federal Workforce Data Parquet files.

Usage (from anywhere; rerun until it prints ALL LOADED):
    .venv/bin/python pipeline/build_db.py [--budget SECONDS]      default budget 140 s
    .venv/bin/python pipeline/build_db.py status
Each run does as many file steps as fit in the budget, one file per transaction, and skips files already loaded.
A step is keyed by the file name (which carries OPM's version) and, for employment, the hash of the breakdown band
definitions, so a reissued month or a changed band definition rebuilds that month only. It is also the refresh
command. Query the DB with the working directory set to the project root: its views read data/... by relative path.
Memory and threads are capped (OPM_DB_MEMORY, default 1500MB; 4 threads); DuckDB spill files go to OPM_TMP
(default warehouse/duckdb_tmp).

Objects
  files               the manifest (data/opm_manifest.json), one row per source file
  load_log            one row per loaded source file: rows read, rows stored, version, band hash, seconds
  raw_<ds>            text views over the Parquet files, as published (ds = employment, accessions, separations)
  <ds>                typed views over raw_<ds> (all rows, read on the fly)
  accession_rows      every accession row, typed, stored, with derived columns (see ACTION_DERIVED)
  separation_rows     every separation row, the same
  emp_org_month       employment headcount per month x department x agency x subelement (codes, not names)
  emp_dim_month       employment headcount per month x department x agency x breakdown dimension x band (agency
                      equals department except DOD, whose four agencies the breakdown cubes need)
  emp_cov_month       employment rows, REDACTED and NULL counts per month x department x field
  known_data_issues   pipeline/known_data_issues.csv
  xw_*                the crosswalks in pipeline/crosswalks/
  kdi_scope           view: known data issue scope expanded to (dataset, file month, entity level, code)
  v_accessions, v_separations   views over the stored rows with category, appointment group, breakdown bands
                      and KDI flags (KDI-001, KDI-009 and KDI-010 values become unknown; los_issue_id names the issue)
  monthly_org         per effective month x department x agency x subelement: headcount, hires, departures, their
                      categories, DRP overlay, net flow, provisional flag, time basis. Rebuilt when all files are loaded.
  pipeline/crosswalks/entities.csv   written when all files are loaded: every org code with its latest name,
                      parent, first and last month.
Typing rules (invariant 4)
  * Numeric and date fields become NULL when REDACTED, with a <field>_redacted flag; text fields keep REDACTED.
  * A non-REDACTED value that does not parse stops the build (it would otherwise become a silent NULL).
Organization (invariant 2, spec section 1)
  * department_code is the department used everywhere: the published code, or, where it is missing or
    "No Data Reported", the department of the row's agency code (department_from_agency = true, KDI-004, KDI-005, KDI-008).
    The published value is kept in department_code_published.
"""
import csv, hashlib, json, os, sys, time
import duckdb

T0 = time.time()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DB = 'warehouse/opm.duckdb'
XW = 'pipeline/crosswalks'
KDI = 'pipeline/known_data_issues.csv'
DIRS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
ACTION_TABLE = {'accessions': 'accession_rows', 'separations': 'separation_rows'}
ACTION_CODE = {'accessions': 'accession_category_code', 'separations': 'separation_category_code'}
NUMERIC = {'count': 'INTEGER', 'annualized_adjusted_basic_pay': 'DOUBLE', 'length_of_service_years': 'DOUBLE'}
DATES = ['service_computation_date_leave', 'appointment_not_to_exceed_date']
YYYYMM = {'snapshot_yyyymm': 'snapshot_month', 'personnel_action_effective_date_yyyymm': 'effective_month'}
FIRST_MONTH = '2011-10-01'   # spec section 2: actions effective earlier are outside the monthly series
COVERAGE_FIELDS = ['annualized_adjusted_basic_pay', 'grade', 'pay_plan_code', 'duty_station_state', 'bargaining_unit_code',
                   'personnel_office_identifier_code', 'length_of_service_years', 'age_bracket', 'supervisory_status_code',
                   'education_level_bracket', 'veteran_indicator', 'appointment_type_code', 'occupational_series_code',
                   'occupational_category_code']
INVALID_DEPT = "({c} IS NULL OR trim({c}) = '' OR upper({c}) = 'NO DATA REPORTED')"


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def src(x):
    return f"data/{DIRS[x['dataset']]}/{x['filename']}.parquet"


def period_of(x):
    return f"{x['year']}-{x['month']}-01"


def connect():
    tmp = os.environ.get('OPM_TMP', 'warehouse/duckdb_tmp')
    os.makedirs(tmp, exist_ok=True)
    con = duckdb.connect(DB)
    con.execute(f"SET memory_limit='{os.environ.get('OPM_DB_MEMORY', '1500MB')}'; SET threads=4; "
                f"SET temp_directory={q(tmp)}; SET preserve_insertion_order=false")
    return con


def file_sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


# ---------------------------------------------------------------- breakdown bands (spec section 9)
def bands():
    rows = list(csv.DictReader(open(f'{XW}/breakdown_bands.csv', encoding='utf-8')))
    out = {}
    for r in rows:
        out.setdefault(r['dimension'], []).append(r)
    for d in out.values():
        d.sort(key=lambda r: int(r['value_order']))
    return out


def band_sql(dim_rows, unknown_extra=None, typed=False):
    """CASE expression for one dimension over the published text columns. Unknown is tested first; then the bands
    in value_order; 'rest' takes what is left; otherwise unknown. unknown_extra: an SQL condition that also makes
    the value unknown (a known data issue with treatment unknown). typed: the columns are the stored typed ones, where
    a REDACTED numeric value is already NULL."""
    field = dim_rows[0]['source_field']
    if typed and field in NUMERIC:
        field = f'CAST({field} AS VARCHAR)'
    if dim_rows[0]['rule'] == 'raw':
        return f"coalesce({field}, 'NULL')"
    unk = next(r for r in dim_rows if r['rule'] == 'unknown')
    whens = []
    if field == 'pay_plan_code|grade':
        plans = sorted({c for r in dim_rows if r['rule'] == 'plan_grade' for c in r['codes'].split('|')})
        los = min(int(r['lo']) for r in dim_rows if r['rule'] == 'plan_grade')
        his = max(int(r['hi']) for r in dim_rows if r['rule'] == 'plan_grade')
        ucodes = [c for c in unk['codes'].split('|') if c]
        cond = (f"pay_plan_code IS NULL OR trim(pay_plan_code) = '' OR pay_plan_code IN ({', '.join(map(q, ucodes))}) "
                f"OR grade = 'REDACTED' OR (pay_plan_code IN ({', '.join(map(q, plans))}) AND "
                f"coalesce(NOT (TRY_CAST(grade AS INTEGER) >= {los} AND TRY_CAST(grade AS INTEGER) < {his}), true))")
        whens.append(f"WHEN {cond} THEN {q(unk['value'])}")
        rest = None
        for r in dim_rows:
            codes = [c for c in r['codes'].split('|') if c]
            if r['rule'] == 'plan_grade':
                whens.append(f"WHEN pay_plan_code IN ({', '.join(map(q, codes))}) AND TRY_CAST(grade AS INTEGER) >= {int(r['lo'])} "
                             f"AND TRY_CAST(grade AS INTEGER) < {int(r['hi'])} THEN {q(r['value'])}")
            elif r['rule'] == 'codes':
                whens.append(f"WHEN pay_plan_code IN ({', '.join(map(q, codes))}) THEN {q(r['value'])}")
            elif r['rule'] == 'prefix':
                whens.append('WHEN ' + ' OR '.join(f"starts_with(pay_plan_code, {q(c)})" for c in codes) + f" THEN {q(r['value'])}")
            elif r['rule'] == 'rest':
                rest = r['value']
        else_ = q(rest) if rest else q(unk['value'])
    else:
        ucodes = [c for c in unk['codes'].split('|') if c]
        cond = f"{field} IS NULL OR trim({field}) = '' OR {field} = 'REDACTED'"
        if ucodes:
            cond += f" OR {field} IN ({', '.join(map(q, ucodes))})"
        whens.append(f"WHEN {cond} THEN {q(unk['value'])}")
        rest = None
        for r in dim_rows:
            if r['rule'] == 'codes':
                whens.append(f"WHEN {field} IN ({', '.join(q(c) for c in r['codes'].split('|'))}) THEN {q(r['value'])}")
            elif r['rule'] == 'range':
                v = f"TRY_CAST({field} AS DOUBLE)"
                hi = f" AND {v} < {float(r['hi'])}" if r['hi'] else ''
                whens.append(f"WHEN {v} >= {float(r['lo'])}{hi} THEN {q(r['value'])}")
            elif r['rule'] == 'rest':
                rest = r['value']
        else_ = q(rest) if rest else q(unk['value'])
    if unknown_extra:
        whens.insert(0, f"WHEN {unknown_extra} THEN {q(unk['value'])}")
    return 'CASE ' + ' '.join(whens) + f' ELSE {else_} END'


# ---------------------------------------------------------------- setup: manifest, views, crosswalk tables
def setup(con, man):
    con.execute("CREATE OR REPLACE TABLE files AS SELECT *, make_date(CAST(year AS INT), CAST(month AS INT), 1) AS period "
                "FROM read_json_auto('data/opm_manifest.json')")
    con.execute("""CREATE TABLE IF NOT EXISTS load_log (dataset VARCHAR, source_file VARCHAR, period DATE,
                   file_version INTEGER, rows_read BIGINT, rows_stored BIGINT, bands_sha VARCHAR, seconds DOUBLE,
                   loaded_at TIMESTAMP)""")
    for ds, d in DIRS.items():
        con.execute(f"CREATE OR REPLACE VIEW raw_{ds} AS SELECT * FROM read_parquet('data/{d}/{ds}_*.parquet', "
                    f"union_by_name=true, filename=true)")
        cols = [r[0] for r in con.execute(f"DESCRIBE raw_{ds}").fetchall() if r[0] != 'filename']
        con.execute(f"CREATE OR REPLACE VIEW {ds} AS SELECT {file_meta('filename')}, {typed_cols(cols)} FROM raw_{ds}")
    # crosswalk and known-data-issue tables (small; reloaded every run)
    for name in ['separation_codes', 'accession_codes', 'appointment_groups', 'administrations', 'breakdown_bands']:
        con.execute(f"CREATE OR REPLACE TABLE xw_{name} AS SELECT * FROM read_csv('{XW}/{name}.csv', header=true, all_varchar=true)")
    con.execute(f"CREATE OR REPLACE TABLE known_data_issues AS SELECT * FROM read_csv('{KDI}', header=true, all_varchar=true)")
    # scope expanded: one row per issue row x dataset x file month x entity code ('*' = all entities)
    con.execute("""CREATE OR REPLACE VIEW kdi_scope AS
      SELECT k.id, k.dataset, k.field, k.treatment, f.period AS file_month, k.entity_level,
             unnest(CASE WHEN coalesce(k.entities, '') = '' THEN ['*'] ELSE string_split(k.entities, ';') END) AS entity_code,
             TRY_CAST(k.value_min AS DOUBLE) AS value_min, TRY_CAST(k.value_max AS DOUBLE) AS value_max
      FROM known_data_issues k JOIN files f ON f.dataset = k.dataset
       AND strftime(f.period, '%Y-%m') >= k.first_file_month
       AND (coalesce(k.last_file_month, '') = '' OR strftime(f.period, '%Y-%m') <= k.last_file_month)
      WHERE k.status = 'active'""")


def file_meta(fcol):
    return (f"make_date(CAST(regexp_extract({fcol}, '_(\\d{{4}})\\d{{2}}_\\d+\\.parquet$', 1) AS INT), "
            f"CAST(regexp_extract({fcol}, '_\\d{{4}}(\\d{{2}})_\\d+\\.parquet$', 1) AS INT), 1) AS period, "
            f"CAST(regexp_extract({fcol}, '_(\\d+)\\.parquet$', 1) AS INT) AS file_version, "
            f"regexp_extract({fcol}, '([^/]+)\\.parquet$', 1) AS source_file")


def typed_cols(cols):
    sel = []
    for c in cols:
        if c in NUMERIC:
            sel.append(f"TRY_CAST(NULLIF({c}, 'REDACTED') AS {NUMERIC[c]}) AS {c}")
            if c != 'count':
                sel.append(f"coalesce({c} = 'REDACTED', false) AS {c}_redacted")
        elif c in DATES:
            sel += [f"TRY_CAST(NULLIF({c}, 'REDACTED') AS DATE) AS {c}", f"coalesce({c} = 'REDACTED', false) AS {c}_redacted"]
        elif c in YYYYMM:
            sel += [c, f"TRY_STRPTIME({c}, '%Y%m')::DATE AS {YYYYMM[c]}"]
        else:
            sel.append(c)
    return ', '.join(sel)


def unparsed_check(con, rel, cols):
    """Values neither NULL nor REDACTED that fail to parse: must be none (they would become silent NULLs)."""
    parts = []
    for c in cols:
        if c in NUMERIC:
            parts.append(f"count(*) FILTER (WHERE {c} IS NOT NULL AND {c} <> 'REDACTED' AND TRY_CAST({c} AS {NUMERIC[c]}) IS NULL)")
        elif c in DATES:
            parts.append(f"count(*) FILTER (WHERE {c} IS NOT NULL AND {c} <> 'REDACTED' AND TRY_CAST({c} AS DATE) IS NULL)")
        elif c in YYYYMM:
            parts.append(f"count(*) FILTER (WHERE TRY_STRPTIME({c}, '%Y%m') IS NULL)")
    bad = con.execute(f"SELECT {' + '.join(parts)} FROM {rel}").fetchone()[0]
    if bad:
        raise SystemExit(f'{rel}: {bad} values that are neither REDACTED nor parseable; stopping (invariant 4)')


def dept_map_sql(rel_list):
    """agency_code -> department_code from rows with a valid department code in the given relations."""
    union = ' UNION ALL '.join(f"SELECT agency_code, department_code FROM {r} WHERE NOT {INVALID_DEPT.format(c='department_code')}"
                               for r in rel_list)
    return (f"SELECT agency_code, min(department_code) AS dept, count(DISTINCT department_code) AS n_dept "
            f"FROM ({union}) GROUP BY agency_code")


def resolve_departments(con, x, rel):
    """Temp table dmap(agency_code, dept) for the agencies of rows with a missing or 'No Data Reported' department
    code: learned from the same file, else the employment file of the same month. Stops if an agency maps to no
    department or to more than one."""
    con.execute(f"CREATE OR REPLACE TEMP TABLE bad_ag AS SELECT DISTINCT agency_code FROM {rel} "
                f"WHERE {INVALID_DEPT.format(c='department_code')}")
    con.execute("CREATE OR REPLACE TEMP TABLE dmap (agency_code VARCHAR, dept VARCHAR)")
    if not con.execute("SELECT count(*) FROM bad_ag").fetchone()[0]:
        return 0
    rels = [rel]
    emp = f"data/Employment/employment_{x['year']}{x['month']}_"
    match = [f for f in os.listdir('data/Employment') if f.startswith(os.path.basename(emp))]
    if x['dataset'] != 'employment' and match:
        rels.append(f"read_parquet({q('data/Employment/' + match[0])})")
    for r in rels:
        m = con.execute(f"SELECT b.agency_code, m.dept, m.n_dept FROM bad_ag b LEFT JOIN ({dept_map_sql([r])}) m USING (agency_code)").fetchall()
        multi = [a for a, d, n in m if n and n > 1]
        if multi:
            raise SystemExit(f"{x['filename']}: agency codes {multi} sit under more than one department (invariant 2)")
        if all(d for _, d, _ in m):
            con.execute(f"INSERT INTO dmap SELECT b.agency_code, m.dept FROM bad_ag b JOIN ({dept_map_sql([r])}) m USING (agency_code)")
            return len(m)
    raise SystemExit(f"{x['filename']}: no department found for agency codes {[a for a, d, _ in m if not d]}")


DEPT_RESOLVED = (f"CASE WHEN {INVALID_DEPT.format(c='t.department_code')} THEN dmap.dept ELSE t.department_code END")


# ---------------------------------------------------------------- accessions and separations: typed rows
def load_actions(con, x):
    ds, table = x['dataset'], ACTION_TABLE[x['dataset']]
    rel = f"read_parquet({q(src(x))})"
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()]
    unparsed_check(con, rel, cols)
    resolve_departments(con, x, rel)
    sel = f"""SELECT {q(period_of(x))}::DATE AS period, {int(x['version'])} AS file_version, {q(x['filename'])} AS source_file,
                {DEPT_RESOLVED} AS department_code_resolved,
                {INVALID_DEPT.format(c='t.department_code')} AS department_from_agency,
                TRY_STRPTIME(t.personnel_action_effective_date_yyyymm, '%Y%m')::DATE < DATE '{FIRST_MONTH}' AS effective_before_range,
                t.{ACTION_CODE[ds]} AS action_code,
                {typed_cols(cols)}
              FROM {rel} t LEFT JOIN dmap USING (agency_code)"""
    exists = con.execute(f"SELECT count(*) FROM duckdb_tables() WHERE table_name = {q(table)}").fetchone()[0]
    if not exists:
        con.execute(f"CREATE TABLE {table} AS SELECT * FROM ({sel}) WHERE false")
        # department_code: the department used everywhere (resolved); the published value is kept beside it
        con.execute(f"ALTER TABLE {table} RENAME COLUMN department_code TO department_code_published")
        con.execute(f"ALTER TABLE {table} RENAME COLUMN department_code_resolved TO department_code")
    renamed = (f"SELECT * RENAME (department_code AS department_code_published, "
               f"department_code_resolved AS department_code) FROM ({sel})")
    con.execute(f"DELETE FROM {table} WHERE period = {q(period_of(x))}::DATE")
    con.execute(f"INSERT INTO {table} BY NAME {renamed}")
    n_read = con.execute(f"SELECT count(*) FROM {rel}").fetchone()[0]
    n_stored = con.execute(f"SELECT count(*) FROM {table} WHERE source_file = {q(x['filename'])}").fetchone()[0]
    if n_read != n_stored:
        raise SystemExit(f"{x['filename']}: read {n_read} rows, stored {n_stored}")
    return n_read, n_stored, None


# ---------------------------------------------------------------- employment: monthly aggregates
EMP_COLS = ['department_code', 'department', 'agency_code', 'agency', 'agency_subelement_code', 'agency_subelement',
            'age_bracket', 'length_of_service_years', 'supervisory_status_code', 'education_level_bracket',
            'veteran_indicator', 'pay_plan_code', 'grade', 'appointment_type_code', 'annualized_adjusted_basic_pay',
            'duty_station_state', 'bargaining_unit_code', 'personnel_office_identifier_code', 'occupational_series_code',
            'occupational_category_code']


def create_emp_tables(con):
    con.execute("""CREATE TABLE IF NOT EXISTS emp_org_month (period DATE, source_file VARCHAR, department_code VARCHAR,
        department_code_published VARCHAR, department_from_agency BOOLEAN, agency_code VARCHAR,
        agency_subelement_code VARCHAR, headcount BIGINT, department_name VARCHAR, agency_name VARCHAR,
        subelement_name VARCHAR)""")
    con.execute("""CREATE TABLE IF NOT EXISTS emp_dim_month (period DATE, department_code VARCHAR, dimension VARCHAR,
        value VARCHAR, headcount BIGINT, agency_code VARCHAR)""")
    # emp_dim_month built before it carried agency_code: add the column and mark every employment month for reload
    # (resumable like any load; the months are rebuilt one by one)
    if 'agency_code' not in [r[0] for r in con.execute('DESCRIBE emp_dim_month').fetchall()]:
        con.execute('BEGIN')
        con.execute('ALTER TABLE emp_dim_month ADD COLUMN agency_code VARCHAR')
        con.execute("UPDATE load_log SET bands_sha = 'reload: emp_dim_month gains agency_code' WHERE dataset = 'employment'")
        con.execute('COMMIT')
        print('emp_dim_month: agency_code added; every employment month marked for reload')
    con.execute("""CREATE TABLE IF NOT EXISTS emp_cov_month (period DATE, department_code VARCHAR, field VARCHAR,
        rows BIGINT, n_redacted BIGINT, n_null BIGINT)""")


def load_employment(con, x, bsets):
    p = q(period_of(x)) + '::DATE'
    rel = f"read_parquet({q(src(x))})"
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()]
    missing = [c for c in EMP_COLS if c not in cols]
    if missing:
        raise SystemExit(f"{x['filename']}: layout lacks {missing}")
    unparsed_check(con, rel, [c for c in cols if c in NUMERIC or c in YYYYMM])
    con.execute(f"CREATE OR REPLACE TEMP TABLE m AS SELECT {', '.join(EMP_COLS)} FROM {rel}")
    resolve_departments(con, x, 'm')
    con.execute(f"""CREATE OR REPLACE TEMP TABLE mr AS SELECT t.* EXCLUDE (department_code),
                      t.department_code AS department_code_published, {DEPT_RESOLVED} AS department_code,
                      {INVALID_DEPT.format(c='t.department_code')} AS department_from_agency
                    FROM m t LEFT JOIN dmap USING (agency_code)""")
    for t in ('emp_org_month', 'emp_dim_month', 'emp_cov_month'):
        con.execute(f"DELETE FROM {t} WHERE period = {p}")
    # names are carried as aggregates for the entities list, never used as grouping keys (invariant 2)
    con.execute(f"""INSERT INTO emp_org_month SELECT {p}, {q(x['filename'])}, department_code, department_code_published,
                      department_from_agency, agency_code, agency_subelement_code, count(*),
                      min(department), min(agency), min(agency_subelement)
                    FROM mr GROUP BY department_code, department_code_published, department_from_agency, agency_code,
                      agency_subelement_code""")
    dims = {d: band_sql(rows) for d, rows in bsets.items()}
    sel = ', '.join(f"{e} AS {d}" for d, e in dims.items())
    con.execute(f"""INSERT INTO emp_dim_month BY NAME SELECT {p} AS period, department_code, agency_code, dimension, value,
                      count(*) AS headcount
                    FROM (SELECT department_code, agency_code, {sel} FROM mr)
                    UNPIVOT (value FOR dimension IN ({', '.join(dims)}))
                    GROUP BY department_code, agency_code, dimension, value""")
    structs = ', '.join(f"struct_pack(f := {q(c)}, r := count(*) FILTER (WHERE {c} = 'REDACTED'), "
                        f"n := count(*) FILTER (WHERE {c} IS NULL))" for c in COVERAGE_FIELDS)
    con.execute(f"""INSERT INTO emp_cov_month SELECT {p}, department_code, u.s.f, rows, u.s.r, u.s.n
                    FROM (SELECT department_code, count(*) AS rows, [{structs}] AS s FROM mr GROUP BY department_code),
                         unnest(s) AS u(s)""")
    n_read = con.execute("SELECT count(*) FROM m").fetchone()[0]
    sums = con.execute(f"""SELECT (SELECT sum(headcount) FROM emp_org_month WHERE period = {p}),
                                  (SELECT sum(headcount) FROM emp_dim_month WHERE period = {p}),
                                  (SELECT count(DISTINCT dimension) FROM emp_dim_month WHERE period = {p})""").fetchone()
    if sums[0] != n_read or sums[1] != n_read * len(dims):
        raise SystemExit(f"{x['filename']}: read {n_read}, org sum {sums[0]}, dimension sum {sums[1]} over {sums[2]} dimensions")
    con.execute("DROP TABLE m; DROP TABLE mr")
    return n_read, sums[0], None


# ---------------------------------------------------------------- derived objects (cheap; rebuilt every run)
def build_views(con, bsets):
    sep = {r['code']: r['category'] for r in csv.DictReader(open(f'{XW}/separation_codes.csv', encoding='utf-8'))}
    acc = {r['code']: r['category'] for r in csv.DictReader(open(f'{XW}/accession_codes.csv', encoding='utf-8'))}
    for ds, table in ACTION_TABLE.items():
        if not con.execute(f"SELECT count(*) FROM duckdb_tables() WHERE table_name = {q(table)}").fetchone()[0]:
            continue
        cw = 'xw_separation_codes' if ds == 'separations' else 'xw_accession_codes'
        # 'unknown' issues on length of service (KDI-001, KDI-009, KDI-010): in scope by dataset, file month, entity
        # and value range (value_min and value_max inclusive; an empty bound is open; published values carry one
        # decimal, so 100.1 means over 100 and -0.1 below 0). A value in the scope of several issues is attributed
        # to the lowest id, so KDI-009 ("outside KDI-001") takes only what KDI-001 does not.
        los_id = (f"(SELECT min(k.id) FROM kdi_scope k WHERE k.dataset = {q(ds)} AND k.field = 'length_of_service_years' "
                  f"AND k.treatment = 'unknown' AND k.file_month = r.period AND (k.entity_code = '*' OR k.entity_code = r.department_code) "
                  f"AND (k.value_min IS NULL OR r.length_of_service_years >= k.value_min) "
                  f"AND (k.value_max IS NULL OR r.length_of_service_years <= k.value_max))")
        los_issue = f"({los_id} IS NOT NULL)"
        bcols = ', '.join(f"{band_sql(rows, los_issue if d == 'los' else None, typed=True)} AS band_{d}"
                          for d, rows in bsets.items() if d != 'appointment')
        con.execute(f"""CREATE OR REPLACE VIEW v_{ds} AS
          SELECT r.*, c.category, a."group" AS appointment_group, a.subgroup AS appointment_subgroup,
                 {los_id} AS los_issue_id, {los_issue} AS los_known_issue, {bcols}
          FROM {table} r LEFT JOIN {cw} c ON c.code = r.action_code
          LEFT JOIN xw_appointment_groups a ON a.code = r.appointment_type_code""")
    return sep, acc


def build_monthly(con, sep, acc):
    """monthly_org: one row per effective month x department x agency x subelement, Oct 2011 to the latest
    employment month. Headcount from emp_org_month; hires and departures counted by effective month (invariant 6);
    categories partition them per the crosswalks; DRP is an overlay; net flow = hires - departures (invariant 7);
    the newest 3 months are provisional."""
    scat = sorted(set(sep.values()))
    acat = sorted(set(acc.values()))
    sf = ', '.join(f"count(*) FILTER (WHERE category = {q(c)}) AS sep_{c}" for c in scat)
    af = ', '.join(f"count(*) FILTER (WHERE category = {q(c)}) AS acc_{c}" for c in acat)
    keys = 'department_code, agency_code, agency_subelement_code'
    con.execute(f"""CREATE OR REPLACE TABLE monthly_org AS
      WITH e AS (SELECT period AS month, {keys}, sum(headcount) AS headcount,
                        sum(headcount) FILTER (WHERE department_from_agency) AS e_dfa FROM emp_org_month GROUP BY ALL),
           a AS (SELECT effective_month AS month, {keys}, count(*) AS hires, {af},
                        count(*) FILTER (WHERE department_from_agency) AS a_dfa
                 FROM v_accessions WHERE NOT effective_before_range GROUP BY ALL),
           s AS (SELECT effective_month AS month, {keys}, count(*) AS departures, {sf},
                        count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp,
                        count(*) FILTER (WHERE department_from_agency) AS s_dfa
                 FROM v_separations WHERE NOT effective_before_range GROUP BY ALL),
           months AS (SELECT DISTINCT period AS month FROM emp_org_month),
           newest AS (SELECT month FROM months ORDER BY month DESC LIMIT 3)
      SELECT month, {keys}, 'effective' AS time_basis, month IN (SELECT month FROM newest) AS provisional,
             coalesce(headcount, 0) AS headcount, coalesce(hires, 0) AS hires, coalesce(departures, 0) AS departures,
             coalesce(hires, 0) - coalesce(departures, 0) AS net_flow,
             {', '.join(f'coalesce(acc_{c}, 0) AS acc_{c}' for c in acat)},
             {', '.join(f'coalesce(sep_{c}, 0) AS sep_{c}' for c in scat)}, coalesce(sep_drp, 0) AS sep_drp,
             coalesce(e_dfa, 0) + coalesce(a_dfa, 0) + coalesce(s_dfa, 0) AS rows_department_from_agency
      FROM e FULL JOIN a USING (month, department_code, agency_code, agency_subelement_code)
             FULL JOIN s USING (month, department_code, agency_code, agency_subelement_code)
      WHERE month IN (SELECT month FROM months)
      ORDER BY month, {keys}""")
    # entity-month known data issue flags (KDI scope as data): a view, so a changed scope needs no rebuild.
    # department_from_agency issues flag only entity-months that hold re-assigned rows; a row re-assigned outside
    # every issue's scope gets no id here, and the gate reports it.
    con.execute("""CREATE OR REPLACE VIEW monthly_org_kdi AS
      SELECT m.month, m.department_code, m.agency_code, m.agency_subelement_code, m.rows_department_from_agency,
             coalesce(list(DISTINCT k.id ORDER BY k.id) FILTER (WHERE k.id IS NOT NULL), []) AS kdi_ids
      FROM monthly_org m LEFT JOIN kdi_scope k ON k.file_month = m.month
        AND (k.treatment IN ('counted_flagged', 'flagged_incomplete')
             OR (k.treatment = 'department_from_agency' AND m.rows_department_from_agency > 0))
        AND (k.entity_code = '*'
             OR (k.entity_level = 'department' AND k.entity_code = m.department_code)
             OR (k.entity_level = 'agency' AND k.entity_code = m.agency_code)
             OR (k.entity_level = 'subelement' AND k.entity_code = m.agency_subelement_code))
      GROUP BY ALL""")


def write_entities(con):
    """pipeline/crosswalks/entities.csv: every org code in any file, at each level, with its latest name (from the
    latest employment month it appears in, else the latest action file), parent, first and last month."""
    con.execute("""CREATE OR REPLACE TEMP TABLE ent_src AS
      SELECT 'employment' AS src, period, department_code, department_from_agency, agency_code, agency_subelement_code,
             department_name, agency_name, subelement_name, headcount AS n FROM emp_org_month
      UNION ALL SELECT 'accessions', period, department_code, department_from_agency, agency_code, agency_subelement_code,
             department, agency, agency_subelement, 1 FROM accession_rows
      UNION ALL SELECT 'separations', period, department_code, department_from_agency, agency_code, agency_subelement_code,
             department, agency, agency_subelement, 1 FROM separation_rows""")
    latest = con.execute("SELECT max(period) FROM emp_org_month").fetchone()[0]
    rows = con.execute(f"""
      WITH lv AS (
        SELECT 'department' AS level, department_code AS code, NULL AS parent_code,
               CASE WHEN department_from_agency THEN NULL ELSE department_name END AS name, src, period, n FROM ent_src
        UNION ALL SELECT 'agency', agency_code, department_code, agency_name, src, period, n FROM ent_src
        UNION ALL SELECT 'subelement', agency_subelement_code, agency_code, subelement_name, src, period, n FROM ent_src)
      SELECT level, code,
             coalesce(arg_max(name, epoch(period) + CASE WHEN src = 'employment' THEN 1e10 ELSE 0 END) FILTER (WHERE name IS NOT NULL), '') AS latest_name,
             CASE level WHEN 'department' THEN '' ELSE string_agg(DISTINCT parent_code, ';' ORDER BY parent_code) END AS parent_code,
             strftime(min(period) FILTER (WHERE src = 'employment'), '%Y-%m') AS first_month,
             strftime(max(period) FILTER (WHERE src = 'employment'), '%Y-%m') AS last_month,
             count(DISTINCT period) FILTER (WHERE src = 'employment') AS employment_months,
             coalesce(sum(n) FILTER (WHERE src = 'employment' AND period = DATE '{latest}'), 0) AS headcount_latest,
             strftime(min(period) FILTER (WHERE src <> 'employment'), '%Y-%m') AS first_action_file,
             strftime(max(period) FILTER (WHERE src <> 'employment'), '%Y-%m') AS last_action_file,
             count(DISTINCT name) AS published_names
      FROM lv GROUP BY level, code
      ORDER BY CASE level WHEN 'department' THEN 1 WHEN 'agency' THEN 2 ELSE 3 END, code""").fetchall()
    cols = ['level', 'code', 'latest_name', 'parent_code', 'first_month', 'last_month', 'employment_months',
            'headcount_latest', 'first_action_file', 'last_action_file', 'published_names']
    tmp = f'{XW}/entities.csv.tmp'
    with open(tmp, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow(['' if v is None else v for v in r])
    os.replace(tmp, f'{XW}/entities.csv')
    con.execute("DROP TABLE ent_src")
    return len(rows)


# ---------------------------------------------------------------- main loop
def todo(con, man, bsha):
    done = {(d, f): b for d, f, b in con.execute("SELECT dataset, source_file, bands_sha FROM load_log").fetchall()}
    order = {'accessions': 0, 'separations': 1, 'employment': 2}
    out = []
    for x in sorted(man, key=lambda x: (order[x['dataset']], x['year'], x['month'])):
        key = (x['dataset'], x['filename'])
        if key not in done or (x['dataset'] == 'employment' and done[key] != bsha):
            out.append(x)
    return out


def main():
    budget = float(sys.argv[sys.argv.index('--budget') + 1]) if '--budget' in sys.argv else 140
    man = json.load(open('data/opm_manifest.json'))
    con = connect()
    setup(con, man)
    create_emp_tables(con)
    bsets = bands()
    bsha = file_sha(f'{XW}/breakdown_bands.csv')
    # rows from a file no longer in the manifest (a reissue replaced it): removed, and the month reloaded
    current = {x['filename'] for x in man}
    for ds, sf in con.execute("SELECT dataset, source_file FROM load_log").fetchall():
        if sf not in current:
            tables = [ACTION_TABLE[ds]] if ds in ACTION_TABLE else ['emp_org_month', 'emp_dim_month', 'emp_cov_month']
            per = con.execute("SELECT period FROM load_log WHERE source_file = ?", [sf]).fetchone()[0]
            con.execute("BEGIN")
            for t in tables:
                if con.execute(f"SELECT count(*) FROM duckdb_tables() WHERE table_name = {q(t)}").fetchone()[0]:
                    con.execute(f"DELETE FROM {t} WHERE period = ?", [per])
            con.execute("DELETE FROM load_log WHERE source_file = ?", [sf])
            con.execute("COMMIT")
            print('superseded, removed:', sf)
    work = todo(con, man, bsha)
    if sys.argv[1:2] == ['status']:
        print(f"{len(work)} files to load; next: {[x['filename'] for x in work[:3]]}")
        return
    done = 0
    est = {'employment': 12.0, 'accessions': 2.0, 'separations': 2.0}
    for x in work:
        if time.time() - T0 + est[x['dataset']] > budget:
            break
        t = time.time()
        con.execute("BEGIN")
        if x['dataset'] == 'employment':
            n_read, n_stored, _ = load_employment(con, x, bsets)
        else:
            n_read, n_stored, _ = load_actions(con, x)
        con.execute("DELETE FROM load_log WHERE dataset = ? AND (source_file = ? OR period = ?::DATE)",
                    [x['dataset'], x['filename'], period_of(x)])
        con.execute("INSERT INTO load_log VALUES (?, ?, ?::DATE, ?, ?, ?, ?, ?, now())",
                    [x['dataset'], x['filename'], period_of(x), int(x['version']), n_read, n_stored,
                     bsha if x['dataset'] == 'employment' else None, round(time.time() - t, 2)])
        con.execute("COMMIT")
        est[x['dataset']] = max(est[x['dataset']] * 0.5, (time.time() - t) * 1.5)
        done += 1
        print(f"{x['filename']:28s} {n_read:>10,} rows {time.time() - t:5.1f}s", flush=True)
    left = len(work) - done
    sep, acc = build_views(con, bsets)
    if left == 0:
        build_monthly(con, sep, acc)
        n_ent = write_entities(con)
        print(f'monthly_org rebuilt; entities.csv {n_ent} codes')
    con.execute("CHECKPOINT")
    con.close()
    print(f"loaded {done} files in {time.time() - T0:.0f}s; {left} remaining" + ("  ALL LOADED" if left == 0 else ""))


if __name__ == '__main__':
    main()
