"""Read-only, resumable profile of the OPM source files (Phase 1a).

One source file at a time; each file yields small part files under warehouse/profile/parts/<kind>/<file>.parquet.
Parts already present are skipped, so the job can be rerun until complete within short shell calls.

Usage (from the project folder):
  .venv/bin/python pipeline/profile/profile.py run [--budget SECONDS]   # process files until the budget is used
  .venv/bin/python pipeline/profile/profile.py status                   # parts done / to do
  .venv/bin/python pipeline/profile/profile.py combine                  # parts -> warehouse/profile/combined/*.parquet
  .venv/bin/python pipeline/profile/profile.py lookup_sizing            # ZSTD sizes for the Look-Up estimate

Set PROFILE_TMP to a scratch directory for DuckDB spill files (defaults to the system temp directory).
Part kinds:
  schema     every file: column name, position, type
  entity     employment: headcount per department, agency, subelement codes and names
  flows      accessions, separations: counts per processing month, effective month, org codes and names,
             action code, appointment type, DRP indicator, KDI-001 flag (length of service 124 to 126),
             KDI-002 status of occupational_category
  redaction  every file: per department_code, rows and, per column, REDACTED / NULL / empty counts
"""
import json, os, sys, tempfile, time
import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
OUT = 'warehouse/profile'
PARTS = f'{OUT}/parts'
DIRS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
ACTION = {'accessions': ('accession_category_code', 'accession_category'),
          'separations': ('separation_category_code', 'separation_category')}


def connect():
    con = duckdb.connect()
    tmp = os.environ.get('PROFILE_TMP', tempfile.gettempdir())
    con.execute(f"SET memory_limit='1500MB'; SET threads=4; SET temp_directory='{tmp}'; "
                "SET preserve_insertion_order=false")
    return con


def manifest():
    m = json.load(open('data/opm_manifest.json'))
    # small datasets first, then employment oldest to newest
    order = {'accessions': 0, 'separations': 1, 'employment': 2}
    return sorted(m, key=lambda x: (order[x['dataset']], x['year'], x['month']))


def src(x):
    return f"data/{DIRS[x['dataset']]}/{x['filename']}.parquet"


def kinds(ds):
    return ['schema', 'redaction'] + (['entity'] if ds == 'employment' else ['flows'])


def part_path(kind, x):
    return f"{PARTS}/{kind}/{x['filename']}.parquet"


def q(s):
    return "'" + s.replace("'", "''") + "'"


def ident(c):
    return '"' + c.replace('"', '""') + '"'


def copy(con, sql, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.tmp'
    con.execute(f"COPY ({sql}) TO {q(tmp)} (FORMAT parquet, COMPRESSION zstd)")
    os.replace(tmp, dest)


def col_or_null(cols, c):
    return ident(c) if c in cols else 'NULL::VARCHAR'


def build(con, kind, x):
    path, ds = src(x), x['dataset']
    period = f"{x['year']}{x['month']}"
    meta = f"{q(ds)} AS dataset, {q(x['filename'])} AS file, {q(period)} AS period"
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet({q(path)})").fetchall()]
    rel = f"read_parquet({q(path)})"
    if kind == 'schema':
        sql = (f"SELECT {meta}, column_name, row_number() OVER () AS position, column_type "
               f"FROM (DESCRIBE SELECT * FROM {rel})")
    elif kind == 'entity':
        org = ', '.join(col_or_null(cols, c) + f' AS {c}' for c in
                        ['department_code', 'department', 'agency_code', 'agency', 'agency_subelement_code',
                         'agency_subelement'])
        sql = f"SELECT {meta}, {org}, count(*) AS n FROM {rel} GROUP BY ALL"
    elif kind == 'flows':
        code, label = ACTION[ds]
        f = {c: col_or_null(cols, c) for c in
             ['department_code', 'department', 'agency_code', 'agency', 'agency_subelement_code', 'agency_subelement',
              code, label, 'appointment_type_code', 'appointment_type', 'drp_indicator',
              'personnel_action_effective_date_yyyymm', 'length_of_service_years', 'occupational_category',
              'occupational_category_code']}
        los = f"TRY_CAST({f['length_of_service_years']} AS DOUBLE)"
        occ = f"""CASE WHEN {f['occupational_category']} IS NULL THEN 'NULL'
                       WHEN trim({f['occupational_category']}) = '' THEN 'EMPTY'
                       WHEN upper({f['occupational_category']}) = 'NO DATA REPORTED' THEN 'NO DATA REPORTED'
                       WHEN {f['occupational_category']} = 'REDACTED' THEN 'REDACTED' ELSE 'OK' END"""
        sql = f"""SELECT {meta},
                    {f['personnel_action_effective_date_yyyymm']} AS effective_yyyymm,
                    {f['department_code']} AS department_code, {f['department']} AS department,
                    {f['agency_code']} AS agency_code, {f['agency']} AS agency,
                    {f['agency_subelement_code']} AS agency_subelement_code,
                    {f['agency_subelement']} AS agency_subelement,
                    {f[code]} AS action_code, {f[label]} AS action,
                    {f['appointment_type_code']} AS appointment_type_code, {f['appointment_type']} AS appointment_type,
                    {f['drp_indicator']} AS drp_indicator,
                    coalesce({los} BETWEEN 124 AND 126, false) AS los_kdi001,
                    {f['length_of_service_years']} = 'REDACTED' AS los_redacted,
                    {occ} AS occcat_status,
                    count(*) AS n
                  FROM {rel} GROUP BY ALL"""
    elif kind == 'redaction':
        dept = col_or_null(cols, 'department_code')
        aggs = []
        for c in cols:
            if c == 'count':
                continue
            i = ident(c)
            aggs.append(f"struct_pack(col := {q(c)}, redacted := count(*) FILTER (WHERE {i} = 'REDACTED'), "
                        f"nulls := count(*) FILTER (WHERE {i} IS NULL), "
                        f"empty := count(*) FILTER (WHERE trim({i}) = ''))")
        inner = (f"SELECT {dept} AS department_code, count(*) AS rows, [{', '.join(aggs)}] AS s "
                 f"FROM {rel} GROUP BY 1")
        sql = (f"SELECT {meta}, department_code, rows, u.s.col AS column_name, u.s.redacted AS n_redacted, "
               f"u.s.nulls AS n_null, u.s.empty AS n_empty FROM ({inner}), unnest(s) AS u(s)")
    copy(con, sql, part_path(kind, x))


def todo():
    return [(k, x) for x in manifest() for k in kinds(x['dataset']) if not os.path.exists(part_path(k, x))]


def run(budget):
    t0, con, done = time.time(), connect(), 0
    for k, x in todo():
        if time.time() - t0 > budget:
            break
        t = time.time()
        build(con, k, x)
        done += 1
        print(f"{x['filename']:28s} {k:10s} {time.time() - t:5.1f}s", flush=True)
    left = len(todo())
    print(f"built {done} parts in {time.time() - t0:.0f}s; {left} to do")


def combine():
    con = connect()
    os.makedirs(f'{OUT}/combined', exist_ok=True)
    for k in ['schema', 'entity', 'flows', 'redaction']:
        dest = f'{OUT}/combined/{k}.parquet'
        copy(con, f"SELECT * FROM read_parquet('{PARTS}/{k}/*.parquet', union_by_name=true)", dest)
        n = con.execute(f"SELECT count(*) FROM {q(dest)}").fetchone()[0]
        print(f'{k}: {n} rows -> {dest}')


def lookup_sizing():
    """Write recent and old months of each dataset as all-text ZSTD Parquet, whole and per large department."""
    con = connect()
    d = f'{OUT}/lookup_sizing'
    os.makedirs(d, exist_ok=True)
    rows = []
    for ds, fn in [('employment', 'employment_202608_1'), ('employment', 'employment_201501_4'),
                   ('accessions', 'accessions_202608_1'), ('separations', 'separations_202608_1')]:
        path = f"data/{DIRS[ds]}/{fn}.parquet"
        if not os.path.exists(path):
            matches = [f for f in os.listdir(f"data/{DIRS[ds]}") if f.startswith(fn.rsplit('_', 1)[0] + '_')]
            path = f"data/{DIRS[ds]}/{matches[0]}"
        rel = f"read_parquet({q(path)})"
        dest = f"{d}/{os.path.basename(path)}"
        copy(con, f"SELECT * FROM {rel}", dest)
        n = con.execute(f"SELECT count(*) FROM {rel}").fetchone()[0]
        rows.append((ds, os.path.basename(path), 'ALL', n, os.path.getsize(dest), os.path.getsize(path)))
        if fn.endswith('202608_1') and ds == 'employment':
            top = con.execute(f"SELECT department_code, count(*) FROM {rel} GROUP BY 1 ORDER BY 2 DESC LIMIT 10").fetchall()
            for code, n in top:
                dd = f"{d}/{ds}_{code}.parquet"
                copy(con, f"SELECT * FROM {rel} WHERE department_code = {q(code)}", dd)
                rows.append((ds, os.path.basename(path), code, n, os.path.getsize(dd), None))
    with open(f'{d}/sizes.csv', 'w') as fh:
        fh.write('dataset,source_file,department_code,rows,zstd_bytes,source_bytes\n')
        for r in rows:
            fh.write(','.join('' if v is None else str(v) for v in r) + '\n')
            print(r)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'run':
        budget = float(sys.argv[sys.argv.index('--budget') + 1]) if '--budget' in sys.argv else 150
        run(budget)
    elif cmd == 'status':
        t = todo()
        print(f'{len(t)} parts to do; first: {t[:1]}')
    elif cmd == 'combine':
        combine()
    elif cmd == 'lookup_sizing':
        lookup_sizing()
