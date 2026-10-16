"""Read-only, resumable occupation profile (L-025): feeds pipeline/profile/OCCUPATIONS.md.

Employment is read one source file at a time into small part files; accessions and separations are read from the
typed action rows already in warehouse/opm.duckdb (opened read-only). Nothing in the DB or the cubes is changed.

Usage (from the project folder):
  .venv/bin/python pipeline/profile/occupations.py run [--budget SECONDS]   # employment parts until the budget is used
  .venv/bin/python pipeline/profile/occupations.py status                   # parts done / to do
  .venv/bin/python pipeline/profile/occupations.py report [Q ...]           # run the queries, write OCCUPATIONS.md

Parts (warehouse/profile/parts/<kind>/<file>.parquet), one per employment file:
  occ_emp    period, agency_code, agency_subelement_code, occupational_series_code, headcount
  occ_names  period, occupational_series_code, occupational_series, occupational_group_code, occupational_group,
             occupational_category_code, occupational_category, pay_plan_code, rows
Report results are cached per query in warehouse/profile/occ_results/<id>.json so the report can be built across
several short calls; delete a result file to recompute it.
"""
import json, os, sys, time
import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
PARTS = 'warehouse/profile/parts'
RESULTS = 'warehouse/profile/occ_results'
TMP = os.environ.get('PROFILE_TMP', 'warehouse/duckdb_tmp')


def connect(db=False):
    con = duckdb.connect()
    con.execute(f"SET memory_limit='1500MB'; SET threads=4; SET temp_directory='{TMP}'; "
                "SET preserve_insertion_order=false")
    if db:
        con.execute("ATTACH 'warehouse/opm.duckdb' AS w (READ_ONLY)")
    return con


def emp_files():
    m = json.load(open('data/opm_manifest.json'))
    return sorted([x for x in m if x['dataset'] == 'employment'], key=lambda x: (int(x['year']), int(x['month'])))


def part(kind, x):
    return f"{PARTS}/{kind}/{x['filename']}.parquet"


def run(budget):
    t0 = time.time()
    for k in ('occ_emp', 'occ_names'):
        os.makedirs(f'{PARTS}/{k}', exist_ok=True)
    con = connect()
    done = 0
    for x in emp_files():
        if all(os.path.exists(part(k, x)) for k in ('occ_emp', 'occ_names')):
            continue
        if time.time() - t0 > budget:
            break
        src = f"data/Employment/{x['filename']}.parquet"
        per = f"DATE '{int(x['year']):04d}-{int(x['month']):02d}-01'"
        for kind, sql in (
            ('occ_emp', f"""SELECT {per} AS period, agency_code, agency_subelement_code, occupational_series_code,
                               count(*)::BIGINT AS headcount
                            FROM read_parquet('{src}') GROUP BY ALL"""),
            ('occ_names', f"""SELECT {per} AS period, occupational_series_code, occupational_series,
                                 occupational_group_code, occupational_group, occupational_category_code,
                                 occupational_category, pay_plan_code, count(*)::BIGINT AS rows
                              FROM read_parquet('{src}') GROUP BY ALL""")):
            out = part(kind, x)
            con.execute(f"COPY ({sql}) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)")
            os.replace(f'{out}.tmp', out)
        done += 1
    print(f'{done} files processed in {time.time() - t0:.0f}s')
    status()


def status():
    fs = emp_files()
    n = sum(all(os.path.exists(part(k, x)) for k in ('occ_emp', 'occ_names')) for x in fs)
    print(f'employment parts: {n} of {len(fs)} done')
    return n == len(fs)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'run':
        b = 150
        if '--budget' in sys.argv:
            b = int(sys.argv[sys.argv.index('--budget') + 1])
        run(b)
    elif cmd == 'status':
        status()
    elif cmd == 'report':
        from occupations_report import report
        report(sys.argv[2:])
