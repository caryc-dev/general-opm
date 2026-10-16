"""Build the Workforce Look-Up files into warehouse/lookup/ (staged; promotion is a separate, approved step).

    .venv/bin/python pipeline/build_lookup.py [seconds_budget]      rerun until it prints ALL BUILT

Invariant 10: OPM's release, never more. Fields and container: docs/metric-spec.md section 10 (D-021).
  separations_FY<yyyy>.parquet, accessions_FY<yyyy>.parquet
        every row of every current Separations or Accessions file whose personnel_action_effective_date_yyyymm falls
        in fiscal year yyyy (Oct yyyy-1 to Sep yyyy, invariant 6); a late action lands in its effective year's file
  separations_before_FY2012.parquet, accessions_before_FY2012.parquet
        the rows effective before Oct 2011
  employment_latest_<DEPT>.parquet
        the rows of the latest employment file, one file per published department_code; rows whose published
        department is missing or "No Data Reported" go to employment_latest_NOT_REPORTED.parquet (only when the
        latest month has any)
  lookup.meta.json
        fields, and per file: rows, bytes, sha256, source files and versions, the known data issues that touch it;
        the manifest hash; files_sha256. No build time, so a rebuild is byte-identical.
Columns: exactly pipeline/crosswalks/lookup_fields.csv, in its order, every value the published text (REDACTED kept,
nothing cast, nothing derived) except `period`, the source file's month as YYYYMM (release metadata). The
department, agency and subelement are as published: the department the cubes use when the published one is missing
(KDI-004, KDI-005, KDI-008) is not added.
Rows: each output reads whole source files row for row and filters them by a value of the row itself; nothing
links rows from different files or months, and no row is dropped, merged or added.
Sort: actions by effective month, department, agency, subelement, period; employment by agency, subelement, series,
grade; then every other column, so the output bytes are deterministic.
Resumable: a file is rewritten only when its inputs (source files and versions, the field list, the writer
settings, the text of its query) change; a run stops starting new files after the budget (default 140 s) and the
meta says complete: false until every planned file is current. Memory capped at 2 GB.
"""
import csv, hashlib, json, os, re, sys, time

T0 = time.time()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cubes import ROOT, manifest_hash, write_if_changed, dumps_meta   # noqa: E402  (build_cubes sets the cwd to ROOT)
import duckdb   # noqa: E402

OUT = 'warehouse/lookup'
FIELDS = 'pipeline/crosswalks/lookup_fields.csv'
KDI_FILE = 'pipeline/known_data_issues.csv'
MANIFEST = 'data/opm_manifest.json'
FOLDERS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
BUILD_VERSION = 1
# Plain Parquet for common JavaScript readers: format version 1 pages, standard ZSTD, row groups of 100k rows, no
# bloom filters, no key-value metadata, strings as BYTE_ARRAY with the UTF8 annotation.
PARQUET_OPTS = "FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000, PARQUET_VERSION V1, WRITE_BLOOM_FILTER false"
FILE_MONTH = 'FILE_MONTH'          # lookup_fields.csv source of `period`
FIRST_FY = 2012                    # spec section 2: the series starts Oct 2011
NOT_REPORTED = 'NOT_REPORTED'      # file key for employment rows without a published department
EFF = 'personnel_action_effective_date_yyyymm'
PERIOD_SQL = "regexp_extract(filename, '_([0-9]{6})_[0-9]+[.]parquet$', 1)"
INVALID_DEPT = "(department_code IS NULL OR trim(department_code) = '' OR upper(department_code) = 'NO DATA REPORTED')"
DEPT_KEY = f"(CASE WHEN {INVALID_DEPT} THEN '{NOT_REPORTED}' ELSE department_code END)"
SORT = {'separations': [EFF, 'department_code', 'agency_code', 'agency_subelement_code', 'period'],
        'accessions': [EFF, 'department_code', 'agency_code', 'agency_subelement_code', 'period'],
        'employment': ['agency_code', 'agency_subelement_code', 'occupational_series_code', 'grade']}


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def fields():
    """lookup_fields.csv -> {dataset: [(lookup_column, opm_source_column)] in order}."""
    out = {}
    for r in csv.DictReader(open(FIELDS, encoding='utf-8')):
        out.setdefault(r['dataset'], []).append((int(r['order']), r['lookup_column'], r['opm_source_column']))
    return {d: [(c, s) for _, c, s in sorted(v)] for d, v in out.items()}


def manifest_by_dataset():
    man = json.load(open(MANIFEST))
    return {ds: sorted((x for x in man if x['dataset'] == ds), key=lambda x: (int(x['year']), int(x['month']))) for ds in FOLDERS}


def src_sql(dataset, recs):
    paths = ', '.join(q(f"data/{FOLDERS[dataset]}/{x['filename']}.parquet") for x in recs)
    return f"read_parquet([{paths}], union_by_name=true, filename=true)"


def fy_where(label):
    """The effective-month filter of one action file: FY<yyyy> or before_FY2012 (yyyymm text compares as a number;
    plan() has checked every value is a six-digit month)."""
    if label == f'before_FY{FIRST_FY}':
        return f"{EFF} < '{FIRST_FY - 1}10'"
    y = int(label[2:])
    return f"{EFF} >= '{y - 1}10' AND {EFF} <= '{y}09'"


def plan(con):
    """[(name, dataset, [manifest records], where)] for every file the Look-Up should hold (spec section 10)."""
    by = manifest_by_dataset()
    out = []
    for ds in ('separations', 'accessions'):
        src = src_sql(ds, by[ds])
        bad = con.execute(f"SELECT count(*) FROM {src} WHERE {EFF} IS NULL "
                          f"OR NOT regexp_full_match({EFF}, '(19|20)[0-9]{{2}}(0[1-9]|1[0-2])')").fetchone()[0]
        if bad:
            sys.exit(f'lookup NOT built: {bad} {ds} rows have no six-digit effective month; no fiscal-year file would hold them')
        fys = con.execute(f"""SELECT DISTINCT CASE WHEN {EFF} < '{FIRST_FY - 1}10' THEN 'before_FY{FIRST_FY}'
                  ELSE 'FY' || (CAST(substr({EFF}, 1, 4) AS INTEGER) + CASE WHEN substr({EFF}, 5, 2) >= '10' THEN 1 ELSE 0 END) END
                  FROM {src} ORDER BY 1""").fetchall()
        out += [(f'{ds}_{fy}', ds, by[ds], fy_where(fy)) for (fy,) in fys]
    latest = by['employment'][-1]
    depts = [d for (d,) in con.execute(f"SELECT DISTINCT {DEPT_KEY} FROM {src_sql('employment', [latest])} ORDER BY 1").fetchall()]
    for d in depts:
        if d != NOT_REPORTED and not re.fullmatch(r'[A-Z0-9]+', d):
            sys.exit(f'lookup NOT built: department code {d!r} cannot name a file')
        out.append((f'employment_latest_{d}', 'employment', [latest], f'{DEPT_KEY} = {q(d)}'))
    return out


def select_sql(con, dataset, recs, cols, where):
    """The query for one output: the listed source columns of the rows of whole source files that pass `where`."""
    src = src_sql(dataset, recs)
    paths = ', '.join(q(f"data/{FOLDERS[dataset]}/{x['filename']}.parquet") for x in recs)
    names = {r[0] for r in con.execute(f"SELECT DISTINCT name FROM parquet_schema([{paths}])").fetchall()}
    parts = []
    for col, source in cols:
        if source == FILE_MONTH:
            parts.append(f'{PERIOD_SQL} AS {col}')
        else:
            if source not in names:
                sys.exit(f'lookup NOT built: {source} is not a column of the {dataset} files')
            parts.append(f'{source} AS {col}' if source != col else col)
    keys = SORT[dataset] + [c for c, _ in cols if c not in SORT[dataset]]
    return f"SELECT {', '.join(parts)} FROM {src} WHERE {where} ORDER BY {', '.join(keys)}"


# ---------------------------------------------------------------- known data issues touching each file
def kdi_conditions(dataset, cols):
    """[(id, SQL condition over a Look-Up file of `dataset`)] for the active scope rows of
    pipeline/known_data_issues.csv. An issue touches a file when a row of the file is in its scope: dataset and file
    month (an incomplete-month issue on employment also covers the actions effective in those months, spec KDI-006),
    entity, and the issue's own condition on the field. Value-range issues follow the lowest-id rule of the cube
    views, so KDI-009 takes only values outside KDI-001."""
    month = 'snapshot_yyyymm' if dataset == 'employment' else 'period'
    names = {c for c, _ in cols}
    out, ranges = [], {}
    rows = sorted((r for r in csv.DictReader(open(KDI_FILE, encoding='utf-8')) if r['status'] == 'active'), key=lambda r: r['id'])
    for k in rows:
        m = month
        if k['dataset'] != dataset:
            if not (k['dataset'] == 'employment' and k['treatment'] == 'flagged_incomplete' and dataset != 'employment'):
                continue
            m = EFF
        lo, hi = k['first_file_month'].replace('-', ''), (k['last_file_month'] or '9999-12').replace('-', '')
        cond = [f"{m} >= '{lo}'", f"{m} <= '{hi}'"]
        ents = [e for e in k['entities'].split(';') if e]
        if ents:
            col = {'department': 'department_code', 'agency': 'agency_code', 'subelement': 'agency_subelement_code'}[k['entity_level']]
            cond.append(f"{col} IN ({', '.join(q(e) for e in ents)})")
        f, t = k['field'], k['treatment']
        if f != '*' and f not in names:
            continue                       # the field is not published in the Look-Up
        if t == 'unknown':
            v = f'TRY_CAST({f} AS DOUBLE)'
            rng = ([f"{v} >= {float(k['value_min'])}"] if k['value_min'] else []) + ([f"{v} <= {float(k['value_max'])}"] if k['value_max'] else [])
            this = '(' + ' AND '.join(cond + rng) + ')'
            lower = [c for i, c in ranges.get(f, []) if i < k['id']]
            ranges.setdefault(f, []).append((k['id'], this))
            out.append((k['id'], this + ''.join(f' AND NOT {c}' for c in lower)))
            continue
        if t == 'unusable':
            cond.append(f"({f} IS NULL OR trim({f}) = '' OR upper({f}) = 'NO DATA REPORTED')")
        elif t == 'department_from_agency':
            cond.append(INVALID_DEPT)
        elif t == 'unknown_with_coverage':
            cond.append(f"{f} = 'REDACTED'")
        out.append((k['id'], '(' + ' AND '.join(cond) + ')'))
    return out


def kdi_touching(con, path, dataset, cols):
    """{issue id: rows of the file in its scope}, issues with no row left out."""
    conds = kdi_conditions(dataset, cols)
    if not conds:
        return {}
    ids = sorted({i for i, _ in conds})
    agg = ', '.join(f"count(*) FILTER (WHERE {' OR '.join(c for j, c in conds if j == i)})" for i in ids)
    got = con.execute(f"SELECT {agg} FROM read_parquet({q(path)})").fetchone()
    return {i: n for i, n in zip(ids, got) if n}


def remove_stale(keep):
    """Delete this script's own outputs in warehouse/lookup/ that are not in the current plan (a .parquet whose
    name is not kept, or a leftover .parquet.tmp), printing each removal. Nothing else is touched."""
    for f in sorted(os.listdir(OUT)):
        if (f.endswith('.parquet') and f[:-len('.parquet')] not in keep) or f.endswith('.parquet.tmp'):
            os.remove(os.path.join(OUT, f))
            print(f'lookup: removed stale {OUT}/{f}')


def files_digest(files):
    lines = ''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path']))
    return hashlib.sha256(lines.encode()).hexdigest()


def build(budget=140.0):
    """Write every planned file whose inputs changed, within the time budget. Returns the number still to do."""
    os.makedirs(OUT, exist_ok=True)
    tmpdir = 'warehouse/duckdb_tmp'
    os.makedirs(tmpdir, exist_ok=True)
    flds, fields_sha = fields(), sha(FIELDS)
    meta_path = f'{OUT}/lookup.meta.json'
    old = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    old_files = old.get('files', {})
    con = duckdb.connect()
    con.execute(f"SET memory_limit='2GB'; SET threads=4; SET preserve_insertion_order=true; SET temp_directory={q(tmpdir)}")
    files, todo, wrote = {}, 0, 0
    the_plan = plan(con)
    for name, dataset, recs, where in the_plan:
        sources = [x['filename'] for x in recs]   # OPM's file names carry the version
        sql = select_sql(con, dataset, recs, flds[dataset], where)   # its text is part of the inputs
        inputs = hashlib.sha256(json.dumps([sources, fields_sha, PARQUET_OPTS, BUILD_VERSION, sql], sort_keys=True).encode()).hexdigest()
        path = f'{OUT}/{name}.parquet'
        prev = old_files.get(name)
        if not (prev and prev.get('inputs_sha256') == inputs and os.path.exists(path) and sha(path) == prev.get('sha256')):
            if time.time() - T0 > budget:
                todo += 1
                continue
            tmp = path + '.tmp'
            con.execute(f"COPY ({sql}) TO {q(tmp)} ({PARQUET_OPTS})")
            os.replace(tmp, path)
            wrote += 1
        rows = con.execute(f"SELECT count(*) FROM read_parquet({q(path)})").fetchone()[0]
        files[name] = {'path': f'lookup/{name}.parquet', 'dataset': dataset, 'rows': rows, 'bytes': os.path.getsize(path),
                       'sha256': sha(path), 'sources': sources, 'kdi': kdi_touching(con, path, dataset, flds[dataset]),
                       'inputs_sha256': inputs}
    con.close()
    remove_stale({n for n, _, _, _ in the_plan})   # every planned name is kept, built this run or not
    latest = manifest_by_dataset()['employment'][-1]
    by_ds = {}
    for f in files.values():
        b = by_ds.setdefault(f['dataset'], {'files': 0, 'rows': 0, 'bytes': 0})
        b['files'] += 1; b['rows'] += f['rows']; b['bytes'] += f['bytes']
    meta = {'set': 'lookup', 'complete': todo == 0, 'manifest_sha256': manifest_hash(),
            'latest_employment_month': f"{latest['year']}{int(latest['month']):02d}",
            'fields': {ds: [c for c, _ in cols] for ds, cols in flds.items()},
            'fields_file': {'path': FIELDS, 'sha256': fields_sha},
            'parquet': {'writer_options': PARQUET_OPTS, 'format_version': 1, 'compression': 'ZSTD',
                        'row_group_rows': 100000, 'bloom_filters': False, 'string_type': 'BYTE_ARRAY UTF8',
                        'key_value_metadata': False},
            'totals': {**{ds: by_ds[ds] for ds in sorted(by_ds)},
                       'all': {'files': len(files), 'rows': sum(f['rows'] for f in files.values()),
                               'bytes': sum(f['bytes'] for f in files.values())}},
            'files_sha256': files_digest(files),
            'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
            'kdi_method': 'issue id: rows of the file in the scope of an active row of pipeline/known_data_issues.csv '
                          '(dataset, file month, entity and the issue condition; values kept as published)',
            'files': {k: files[k] for k in sorted(files)},
            'decisions': ['D-021']}
    changed = write_if_changed(meta_path, dumps_meta(meta))
    t = meta['totals']['all']
    print(f"lookup: {len(files)} files current ({wrote} written), {todo} remaining; {t['rows']:,} rows, {t['bytes']:,} B; "
          f"meta {'rewritten' if changed else 'unchanged'}; {time.time() - T0:.1f}s" + ('  ALL BUILT' if todo == 0 else ''))
    return todo


if __name__ == '__main__':
    build(float(sys.argv[1]) if len(sys.argv) > 1 else 140.0)
