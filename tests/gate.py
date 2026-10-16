"""Government-wide OPM workforce gate. Run from anywhere: .venv/bin/python tests/gate.py
Each check guards an invariant in the project's invariants file or a process rule.
Prints PASS/FAIL per check and "N of M checks pass"; exits 1 if any check fails.
Checks listed as PLAN guard things not built yet; each must be implemented before that thing ships.
The Phase 1 database checks recompute from the raw Parquet in data/: actions in full, employment for a fixed set of
sampled months (SAMPLE) plus whole-history row counts from the Parquet footers. Needs warehouse/opm.duckdb (built by
pipeline/build_db.py) and no writer holding it."""
import json, os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DATASETS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
RESULTS = []

ONLY = [x for x in os.environ.get('GATE_ONLY', '').split(',') if x]   # run only these checks (e.g. a mutation test)

def check(name, guards):
    def wrap(fn):
        if ONLY and name not in ONLY:
            return fn
        t = time.time()
        try:
            ok, detail = fn()
        except Exception as e:  # a check that cannot run is a failure, not a skip
            ok, detail = False, f'error: {e}'
        RESULTS.append((name, ok))
        print(f"{'PASS' if ok else 'FAIL'}  {name:28s} [{guards}] {detail} ({time.time() - t:.1f}s)")
        if os.environ.get('GATE_MEM'):
            import resource; print(f'      peak RSS so far {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9:.2f} GB')
        return fn
    return wrap

def git(*args):
    return subprocess.run(['git', '-c', 'safe.directory=*', *args], capture_output=True, text=True, check=True).stdout

def tracked_files():
    """Files git would commit: tracked plus untracked-but-not-ignored."""
    return [f for f in git('ls-files', '--cached', '--others', '--exclude-standard').splitlines() if f]

TEXT = ('.md', '.py', '.js', '.mjs', '.css', '.html', '.json', '.csv', '.txt', '.yml', '.yaml', '.sql')
LOCAL = ['CLAUDE.md', '.claude', 'ops']  # working files: kept out of git by .git/info/exclude

def local_files():
    out = []
    for top in LOCAL:
        if os.path.isfile(top): out.append(top)
        elif os.path.isdir(top): out += [os.path.join(d, f) for d, _, fs in os.walk(top) for f in fs]
    return out

# ---- process rules ----
@check('size_caps', 'process')
def _():
    caps = {'.claude/skills/opm-invariants/SKILL.md': 8192, '.claude/skills/opm-context/SKILL.md': 30720, 'CLAUDE.md': 5120}
    sizes = {p: os.path.getsize(p) for p in caps}
    over = [f'{p} {s} > {caps[p]}' for p, s in sizes.items() if s > caps[p]]
    return not over, '; '.join(over) or ', '.join(f'{os.path.basename(os.path.dirname(p)) or p} {s} B' for p, s in sizes.items())

@check('no_em_dash', 'process')
def _():
    hits = []
    for f in sorted(set(tracked_files() + local_files())):
        if f.endswith(TEXT) and not f.startswith(('data/', 'warehouse/')):
            try:
                if chr(0x2014) in open(f, encoding='utf-8').read(): hits.append(f)
            except (UnicodeDecodeError, FileNotFoundError):
                pass
    return not hits, ', '.join(hits) or 'none in tracked or local text files'

@check('local_files_excluded', 'process')
def _():
    committable = tracked_files()
    leaked = [f for f in committable if f == 'CLAUDE.md' or f.startswith(('.claude/', 'ops/'))]
    ignored_by = []
    for p in LOCAL:  # excluded via .git/info/exclude, not .gitignore (which is public)
        src = git('check-ignore', '-v', '--no-index', p).split(':', 1)[0] if os.path.exists(p) else ''
        if src and not src.endswith('info/exclude'): ignored_by.append(f'{p} ignored by {src}')
    gi = open('.gitignore', encoding='utf-8').read() if os.path.exists('.gitignore') else ''
    in_gi = [p for p in LOCAL if re.search(rf'^/?{re.escape(p)}/?$', gi, re.M)]
    bad = leaked + ignored_by + [f'{p} named in .gitignore' for p in in_gi]
    return not bad, '; '.join(bad) or f'{", ".join(LOCAL)} excluded by .git/info/exclude; none committable'

@check('public_hygiene', 'process')
def _():
    terms = [l.strip() for l in open('ops/hygiene_terms.txt', encoding='utf-8') if l.strip() and not l.startswith('#')]
    pat = re.compile('|'.join(terms), re.I)
    hits = []
    for f in tracked_files():
        if os.path.exists(f) and f.endswith(TEXT + ('LICENSE', '.gitignore')):
            try:
                if pat.search(f) or pat.search(open(f, encoding='utf-8').read()): hits.append(f)
            except UnicodeDecodeError:
                pass
    return not hits, ', '.join(hits) or f'{len(tracked_files())} committable files free of {len(terms)} local terms'

# ---- invariant 1: the manifest is the source of truth ----
@check('manifest_files', 'inv 1')
def _():
    man = json.load(open('data/opm_manifest.json'))
    problems, listed = [], set()
    if os.path.islink('data'): problems.append('data/ is a symlink')
    keys = [(x['dataset'], x['year'], x['month']) for x in man]
    dup = {k for k in keys if keys.count(k) > 1}
    problems += [f'more than one version of {d} {y}-{m}' for d, y, m in sorted(dup)]
    for x in man:
        p = f"data/{DATASETS[x['dataset']]}/{x['filename']}.parquet"; listed.add(p)
        if not os.path.exists(p): problems.append(f'missing {p}')
        elif os.path.islink(p): problems.append(f'symlink {p}')
        elif x.get('size') is not None and os.path.getsize(p) != x['size']: problems.append(f'size {p}')
    extra = [f'data/{d}/{f}' for d in DATASETS.values() for f in os.listdir(f'data/{d}')
             if f.endswith('.parquet') and f'data/{d}/{f}' not in listed]
    problems += [f'unlisted {e}' for e in extra]
    return not problems, '; '.join(problems[:5]) or f'{len(man)} files present, sizes match, one version per month, none unlisted'

# ---- Phase 1 database, crosswalks and monthly aggregates ----
# Every check below recomputes its figures from the raw Parquet files in data/, never from the tables it checks.
# Accessions and separations are recomputed in full. Employment (381M rows) is never scanned in one go: the
# org, breakdown and coverage recomputations read a fixed set of months (SAMPLE), and whole-history totals come
# from the Parquet footers (row counts), which need no scan.
DB = 'warehouse/opm.duckdb'
XW = 'pipeline/crosswalks'
MAN = json.load(open('data/opm_manifest.json'))
EMP_FILES = {f"{x['year']}-{x['month']}": f"data/Employment/{x['filename']}.parquet" for x in MAN if x['dataset'] == 'employment'}
LATEST = max(EMP_FILES)
SAMPLE = sorted({'2011-10', '2014-12', '2015-01', '2015-02', '2024-10', '2025-09', '2025-10', '2026-05', '2026-06',
                 '2026-07', LATEST} & set(EMP_FILES))
SAMPLE_NOTE = f'employment recomputed from raw for {len(SAMPLE)} fixed months ({" ".join(SAMPLE)})'
# signed constants (docs/metric-spec.md section 4; D-012): the crosswalks must say exactly this
SEP_SIGNED = {'transfer_out': {'SA', 'SB'}, 'quit': {'SC'}, 'retirement': {'SD', 'SE', 'SG'}, 'rif': {'SH'},
              'termination': {'SJ'}, 'other': {'SL'}}
ACC_SIGNED = {'new_hire': {'AC', 'AD', 'AE'}, 'transfer_in': {'AA', 'AB'}}
APPT_SIGNED = {'10': ('career', ''), '15': ('career_conditional', ''), '30': ('excepted', ''), '32': ('excepted', ''),
               '35': ('excepted', ''), '38': ('excepted', ''), '20': ('temporary', ''), '40': ('temporary', ''),
               '42': ('temporary', ''), '45': ('temporary', ''), '48': ('temporary', ''), '50': ('ses', ''),
               '60': ('ses', ''), '65': ('ses', ''), '44': ('political', 'schedule_c'), '55': ('political', 'noncareer_ses'),
               '46': ('political', 'executive'), '36': ('political', 'executive'), '67': ('schedule_policy', ''),
               '68': ('schedule_policy', ''), '*': ('unknown', '')}
BAD_DEPT = "({c} IS NULL OR trim({c}) = '' OR upper({c}) = 'NO DATA REPORTED')"
FILE_YM = "regexp_extract(filename, '_(\\d{4})(\\d{2})_\\d+\\.parquet$', ['y', 'm'])"
_DB, _CACHE = None, {}


def db():
    global _DB
    if _DB is None:
        import duckdb
        os.makedirs('warehouse/duckdb_tmp', exist_ok=True)
        _DB = duckdb.connect(DB, read_only=True, config={'memory_limit': os.environ.get('GATE_DB_MEMORY', '1500MB'), 'threads': 4,
                                                         'temp_directory': 'warehouse/duckdb_tmp'})
    return _DB


def rows(sql):
    return db().execute(sql).fetchall()


def raw(ds):
    return f"read_parquet('data/{DATASETS[ds]}/{ds}_*.parquet', filename=true)"


def ym_sql(col='filename'):
    return f"regexp_extract({col}, '_(\\d{{4}})(\\d{{2}})_\\d+\\.parquet$', 1) || '-' || regexp_extract({col}, '_\\d{{4}}(\\d{{2}})_\\d+\\.parquet$', 1)"


def csv_rows(path):
    import csv
    return list(csv.DictReader(open(path, encoding='utf-8')))


def raw_actions_org(ds):
    """Raw accessions or separations per (file month, effective month, department, agency, subelement, code, DRP):
    department from the agency code where missing or 'No Data Reported' (spec section 1), using the department each
    agency code has on every other action row of the dataset. Cached."""
    if ds in _CACHE: return _CACHE[ds]
    code = 'accession_category_code' if ds == 'accessions' else 'separation_category_code'
    drp = 'drp_indicator' if ds == 'separations' else 'NULL'
    r = rows(f"""
      WITH r AS (SELECT {ym_sql()} AS fm, personnel_action_effective_date_yyyymm AS eff, department_code AS d,
                        agency_code AS a, agency_subelement_code AS s, {code} AS code, {drp} AS drp FROM {raw(ds)}),
           mp AS (SELECT a, min(d) AS dd, count(DISTINCT d) AS nd FROM r WHERE NOT {BAD_DEPT.format(c='d')} GROUP BY a)
      SELECT fm, eff, CASE WHEN {BAD_DEPT.format(c='d')} THEN mp.dd ELSE d END, a, s, code, drp,
             {BAD_DEPT.format(c='d')}, coalesce(mp.nd, 0), count(*)
      FROM r LEFT JOIN mp USING (a) GROUP BY ALL""")
    _CACHE[ds] = r
    return r


def raw_emp(ym):
    """One sampled employment month from its raw file: org counts, breakdown counts and coverage counts. Cached."""
    if ym in _CACHE: return _CACHE[ym]
    rel = f"read_parquet('{EMP_FILES[ym]}')"
    fix = (f"WITH mp AS (SELECT agency_code, min(department_code) AS dd, count(DISTINCT department_code) AS nd FROM {rel} "
           f"WHERE NOT {BAD_DEPT.format(c='department_code')} GROUP BY 1), "
           f"t AS (SELECT r.*, CASE WHEN {BAD_DEPT.format(c='r.department_code')} THEN mp.dd ELSE r.department_code END AS dept, "
           f"{BAD_DEPT.format(c='r.department_code')} AS bad, coalesce(mp.nd, 0) AS nd FROM {rel} r LEFT JOIN mp USING (agency_code))")
    org = rows(f"{fix} SELECT dept, bad, agency_code, agency_subelement_code, max(nd), count(*) FROM t GROUP BY ALL")
    dims = gate_bands()
    sel = ', '.join(f'{sql} AS "{d}"' for d, sql in dims.items())
    dim = rows(f"{fix} SELECT dept, agency_code, dimension, value, count(*) FROM (SELECT dept, agency_code, {sel} FROM t) "
               f"UNPIVOT (value FOR dimension IN ({', '.join(chr(34) + d + chr(34) for d in dims)})) GROUP BY ALL")
    fields = [r[0] for r in rows("SELECT DISTINCT field FROM emp_cov_month")]
    cov = []
    for f in fields:
        cov += [(d, f, n, red, nul) for d, n, red, nul in rows(
            f"{fix} SELECT dept, count(*), count(*) FILTER (WHERE {f} = 'REDACTED'), count(*) FILTER (WHERE {f} IS NULL) FROM t GROUP BY 1")]
    appt = {str(r[0]) for r in rows(f"SELECT DISTINCT appointment_type_code FROM {rel}")}
    _CACHE[ym] = (org, dim, cov, appt)
    return _CACHE[ym]


# Signed constant (spec section 9, D-015): the pay plans counted as GS and equivalents. Held here, not read from
# breakdown_bands.csv, so the recomputation is independent of the crosswalk; monthly_basis checks that the crosswalk
# and the spec text both list exactly these plans.
GS_EQUIV_PLANS = ['GS', 'GL', 'GP', 'GM', 'GG', 'GW']


def spec_gs_plans():
    m = re.search(r'GS and equivalents, meaning pay plans ([A-Z, ]+?) and ([A-Z]{2}),', open('docs/metric-spec.md', encoding='utf-8').read())
    return [p.strip() for p in m.group(1).split(',')] + [m.group(2)] if m else None


def gate_bands():
    """Breakdown bands as SQL over the published text columns, written here independently of the pipeline from the
    definitions in breakdown_bands.csv: unknown first (NULL, blank, REDACTED, listed codes; for grade also a REDACTED
    grade or a GS-equivalent plan with a grade outside every band), then the bands in order, then rest or unknown."""
    by = {}
    for r in sorted(csv_rows(f'{XW}/breakdown_bands.csv'), key=lambda r: (r['dimension'], int(r['value_order']))):
        by.setdefault(r['dimension'], []).append(r)
    out = {}
    lit = lambda v: "'" + v.replace("'", "''") + "'"
    inl = lambda col, codes: f"{col} IN ({', '.join(lit(c) for c in codes)})"
    for d, rs in by.items():
        f = rs[0]['source_field']
        if rs[0]['rule'] == 'raw':
            out[d] = f"coalesce({f}, 'NULL')"; continue
        unk = [r for r in rs if r['rule'] == 'unknown'][0]
        ucodes = [c for c in unk['codes'].split('|') if c]
        rest = [r['value'] for r in rs if r['rule'] == 'rest']
        if f == 'pay_plan_code|grade':
            pg = [r for r in rs if r['rule'] == 'plan_grade']
            plans = GS_EQUIV_PLANS
            g = 'TRY_CAST(grade AS INTEGER)'
            cond = (f"pay_plan_code IS NULL OR trim(pay_plan_code) = '' OR {inl('pay_plan_code', ucodes)} OR grade = 'REDACTED' "
                    f"OR ({inl('pay_plan_code', plans)} AND NOT coalesce({g} >= {min(int(r['lo']) for r in pg)} AND {g} < {max(int(r['hi']) for r in pg)}, false))")
            parts = [f"WHEN {cond} THEN {lit(unk['value'])}"]
            for r in rs:
                cs = GS_EQUIV_PLANS if r['rule'] == 'plan_grade' else r['codes'].split('|')
                if r['rule'] == 'plan_grade': parts.append(f"WHEN {inl('pay_plan_code', cs)} AND {g} >= {r['lo']} AND {g} < {r['hi']} THEN {lit(r['value'])}")
                if r['rule'] == 'codes': parts.append(f"WHEN {inl('pay_plan_code', cs)} THEN {lit(r['value'])}")
                if r['rule'] == 'prefix': parts.append(f"WHEN {' OR '.join(f'pay_plan_code LIKE {lit(c + chr(37))}' for c in cs)} THEN {lit(r['value'])}")
        else:
            cond = f"{f} IS NULL OR trim({f}) = '' OR {f} = 'REDACTED'" + (f" OR {inl(f, ucodes)}" if ucodes else '')
            parts = [f"WHEN {cond} THEN {lit(unk['value'])}"]
            for r in rs:
                if r['rule'] == 'codes': parts.append(f"WHEN {inl(f, r['codes'].split('|'))} THEN {lit(r['value'])}")
                if r['rule'] == 'range':
                    v = f'TRY_CAST({f} AS DOUBLE)'
                    parts.append(f"WHEN {v} >= {r['lo']}" + (f" AND {v} < {r['hi']}" if r['hi'] else '') + f" THEN {lit(r['value'])}")
        out[d] = 'CASE ' + ' '.join(parts) + f" ELSE {lit(rest[0] if rest else unk['value'])} END"
    return out


def kdi_rows():
    return csv_rows('pipeline/known_data_issues.csv')


def in_scope(k, ds, ym, dept=None, agency=None, sub=None):
    if k['dataset'] != ds or ym < k['first_file_month'] or (k['last_file_month'] and ym > k['last_file_month']): return False
    ents = [e for e in k['entities'].split(';') if e]
    if not ents: return True
    return {'department': dept, 'agency': agency, 'subelement': sub}.get(k['entity_level']) in ents


def fmt_ym(d):
    return d.strftime('%Y-%m')


@check('load_log_matches_manifest', 'inv 1')
def _():
    bad = []
    log = {(d, f): (v, rr, rs, b) for d, f, v, rr, rs, b in
           rows('SELECT dataset, source_file, file_version, rows_read, rows_stored, bands_sha FROM load_log')}
    want = {(x['dataset'], x['filename']): x['version'] for x in MAN}
    if set(log) != set(want):
        bad.append(f'load_log has {len(set(log) - set(want))} files not in the manifest, lacks {len(set(want) - set(log))}')
    bad += [f'{f} logged version {log[(d, f)][0]} != manifest {v}' for (d, f), v in want.items() if (d, f) in log and log[(d, f)][0] != v]
    # rows per file from the Parquet footers (no scan) against rows read, rows stored and the stored tables
    meta = {}
    for ds, d in DATASETS.items():
        for fn, n in rows(f"SELECT file_name, num_rows FROM parquet_file_metadata('data/{d}/{ds}_*.parquet')"):
            meta[(ds, os.path.basename(fn)[:-8])] = n
    bad += [f'{f} rows read/stored {v[1]}/{v[2]} != Parquet {meta.get((d, f))}' for (d, f), v in log.items()
            if not (v[1] == v[2] == meta.get((d, f)))]
    stored = dict(((('accessions', f) if t == 'a' else ('separations', f)), n) for t, f, n in rows(
        "SELECT 'a', source_file, count(*) FROM accession_rows GROUP BY 2 UNION ALL SELECT 's', source_file, count(*) FROM separation_rows GROUP BY 2"))
    stored.update({('employment', f): n for f, n in rows('SELECT source_file, sum(headcount) FROM emp_org_month GROUP BY 1')})
    bad += [f'{d} {f} stored {stored.get((d, f))} != Parquet {n}' for (d, f), n in meta.items() if stored.get((d, f)) != n]
    import hashlib
    sha = hashlib.sha256(open(f'{XW}/breakdown_bands.csv', 'rb').read()).hexdigest()
    stale = [f for (d, f), v in log.items() if d == 'employment' and v[3] != sha]
    if stale: bad.append(f'{len(stale)} employment months built with other breakdown bands, e.g. {stale[:2]}')
    return not bad, '; '.join(bad[:5]) or (f'{len(log)} files loaded at the manifest version; rows read = rows stored = '
        f'Parquet row counts for every file ({sum(meta.values()):,} rows); employment bands current')


@check('org_continuity_2015', 'inv 2')
def _():
    # Threshold 5%, from profile Q2.10 to Q2.12: departments of 500+ moved a median 0.90% from Dec 2014 to Jan 2015;
    # all but one within 3.86% (Treasury, seasonal hiring, Q2.11). A lost layout or code would move far more.
    LIMIT, MIN_SIZE = 5.0, 500
    EXCEPT = {'LP': 'GPO: 100 separations effective Dec 2014 (mostly retirements) leave the Jan 2015 file; the level holds after'}
    hc = {}
    for ym in ('2014-12', '2015-01'):
        org = raw_emp(ym)[0]
        hc[ym] = {}
        for dept, _, _, _, _, n in org: hc[ym][dept] = hc[ym].get(dept, 0) + n
    stored = {(fmt_ym(p), d): n for p, d, n in rows(
        "SELECT period, department_code, sum(headcount) FROM emp_org_month WHERE period IN ('2014-12-01', '2015-01-01') GROUP BY ALL")}
    bad = [f'{ym} {d} stored {stored.get((ym, d))} != raw {n}' for ym in hc for d, n in hc[ym].items() if stored.get((ym, d)) != n]
    big = sorted(d for d, n in hc['2014-12'].items() if n >= MIN_SIZE)
    moves, exc = {}, []
    for d in big:
        b = hc['2015-01'].get(d, 0); a = hc['2014-12'][d]
        moves[d] = 100.0 * (b - a) / a
        if abs(moves[d]) > LIMIT:
            if d in EXCEPT:
                seps = sum(n for fm, eff, dd, *_x, n in raw_actions_org('separations') if eff == '201412' and dd == d)
                if seps < abs(b - a): bad.append(f'{d} exception no longer explained: {seps} Dec 2014 separations < change {b - a}')
                else: exc.append(f'{d} {moves[d]:+.2f}% ({EXCEPT[d]}; {seps} separations effective Dec 2014)')
            else:
                bad.append(f'{d} {a:,} -> {b:,} ({moves[d]:+.2f}%)')
    vals = sorted(abs(v) for v in moves.values())
    med = (vals[(len(vals) - 1) // 2] + vals[len(vals) // 2]) / 2 if vals else None
    return not bad, '; '.join(bad[:5]) or (f'{len(big)} departments of {MIN_SIZE}+ (raw, Dec 2014 to Jan 2015): median move '
        f'{med:.2f}%, all within {LIMIT}% except {"; ".join(exc) or "none"}; stored = raw for both months')


@check('org_partition', 'inv 2')
def _():
    bad = []
    # 1. stored tables: each subelement under one agency, each agency under one department, no department missing
    for t in ('emp_org_month', 'accession_rows', 'separation_rows', 'monthly_org'):
        n_sub, n_ag, n_null = rows(f"""SELECT (SELECT count(*) FROM (SELECT agency_subelement_code FROM {t} GROUP BY 1 HAVING count(DISTINCT agency_code) > 1)),
            (SELECT count(*) FROM (SELECT agency_code FROM {t} GROUP BY 1 HAVING count(DISTINCT department_code) > 1)),
            (SELECT count(*) FROM {t} WHERE department_code IS NULL OR upper(department_code) = 'NO DATA REPORTED' OR trim(department_code) = '')""")[0]
        if n_sub or n_ag or n_null: bad.append(f'{t}: {n_sub} subelements with 2+ agencies, {n_ag} agencies with 2+ departments, {n_null} rows without a department')
    # 2. raw: the same partition holds in the source (agency to department across all action rows)
    for ds in ('accessions', 'separations'):
        multi = {a for _, _, _, a, _, _, _, _, nd, _ in raw_actions_org(ds) if nd > 1}
        if multi: bad.append(f'raw {ds}: agencies under 2+ departments {sorted(multi)}')
    # 3. sums: every month, subelements sum to the government total = Parquet rows; breakdowns and coverage too
    meta = {os.path.basename(f)[:-8]: n for f, n in rows("SELECT file_name, num_rows FROM parquet_file_metadata('data/Employment/employment_*.parquet')")}
    per = rows("""SELECT o.source_file, o.n, d.n, d.k, c.n, c.k FROM
        (SELECT period, source_file, sum(headcount) n FROM emp_org_month GROUP BY ALL) o
        JOIN (SELECT period, sum(headcount) n, count(DISTINCT dimension) k FROM emp_dim_month GROUP BY 1) d USING (period)
        JOIN (SELECT period, sum(rows) n, count(DISTINCT field) k FROM emp_cov_month GROUP BY 1) c USING (period)""")
    for f, o, dn, dk, cn, ck in per:
        if not (o == meta.get(f) and dn == o * dk and cn == o * ck): bad.append(f'{f}: org {o}, Parquet {meta.get(f)}, dims {dn}/{dk}, coverage {cn}/{ck}')
    if len(per) != len(meta): bad.append(f'{len(per)} months aggregated, {len(meta)} employment files')
    dsum = rows("""SELECT count(*) FROM (SELECT period, department_code, dimension, sum(headcount) n FROM emp_dim_month GROUP BY ALL) d
        FULL JOIN (SELECT period, department_code, sum(headcount) n FROM emp_org_month GROUP BY ALL) o USING (period, department_code)
        WHERE d.n IS DISTINCT FROM o.n""")[0][0]
    if dsum: bad.append(f'{dsum} department-month-dimensions whose bands do not sum to the department headcount')
    # 4. raw recomputation: sampled employment months per entity, and every action row per entity
    for ym in SAMPLE:
        org = raw_emp(ym)[0]
        want = {}
        for dept, b, a, s, nd, n in org:
            if nd > 1: bad.append(f'{ym} agency {a} under 2+ departments')
            want[(dept, a, s)] = want.get((dept, a, s), 0) + n
        got = {(d, a, s): n for d, a, s, n in rows(f"SELECT department_code, agency_code, agency_subelement_code, sum(headcount) "
                                                  f"FROM emp_org_month WHERE period = '{ym}-01' GROUP BY ALL")}
        if got != want: bad.append(f'{ym}: {len(set(got.items()) ^ set(want.items()))} entity headcounts differ from raw')
    for ds, t in (('accessions', 'accession_rows'), ('separations', 'separation_rows')):
        want = {}
        for fm, eff, d, a, s, *_x, n in raw_actions_org(ds): want[(d, a, s)] = want.get((d, a, s), 0) + n
        got = {(d, a, s): n for d, a, s, n in rows(f"SELECT department_code, agency_code, agency_subelement_code, count(*) FROM {t} GROUP BY ALL")}
        if got != want: bad.append(f'{t}: {len(set(got.items()) ^ set(want.items()))} entity counts differ from raw')
    return not bad, '; '.join(bad[:5]) or (f'one agency per subelement and one department per agency in every stored table and in the raw '
        f'actions; {len(per)} months: subelements, breakdowns and coverage sum to the Parquet row count; entity counts = raw '
        f'for all actions and {len(SAMPLE)} sampled months')


@check('no_name_grouping', 'inv 2')
def _():
    bad = []
    NAMES = r'\b(department|agency|agency_subelement)\b(?!_)'
    for f in sorted(os.listdir('pipeline')):
        if not f.endswith('.py'): continue
        code = '\n'.join(l.split('#', 1)[0] for l in open(f'pipeline/{f}', encoding='utf-8'))
        for m in re.finditer(r'(GROUP\s+BY|PARTITION\s+BY)\s+(.+?)(\)|"""|$|\bHAVING\b|\bORDER\b)', code, re.I | re.M | re.S):
            if re.search(NAMES, m.group(2)) and 'ALL' not in m.group(2).upper().split():
                bad.append(f'pipeline/{f}: {m.group(1)} {m.group(2)[:60].strip()}')
    # GROUP BY ALL takes every non-aggregate column: the aggregate tables must have no bare name column
    for t in ('emp_org_month', 'emp_dim_month', 'emp_cov_month', 'monthly_org'):
        cols = [r[0] for r in rows(f'DESCRIBE {t}')]
        bad += [f'{t} has name column {c}' for c in cols if re.fullmatch(NAMES, c)]
    for t, key in (('emp_org_month', 'period, department_code, department_code_published, agency_code, agency_subelement_code'),
                   ('monthly_org', 'month, department_code, agency_code, agency_subelement_code'),
                   ('emp_dim_month', 'period, department_code, agency_code, dimension, value'), ('emp_cov_month', 'period, department_code, field')):
        dup = rows(f'SELECT count(*) FROM (SELECT {key} FROM {t} GROUP BY ALL HAVING count(*) > 1)')[0][0]
        if dup: bad.append(f'{t}: {dup} code keys on more than one row (a name split them)')
    ent = csv_rows(f'{XW}/entities.csv')
    keys = [(r['level'], r['code']) for r in ent]
    if len(keys) != len(set(keys)): bad.append('entities.csv repeats a (level, code)')
    renamed = sum(int(r['published_names']) > 1 for r in ent)
    return not bad, '; '.join(bad[:5]) or (f'no GROUP BY or PARTITION BY on a name in pipeline/; aggregate tables keyed by codes only; '
        f'entities.csv one row per code ({len(ent)}; {renamed} with more than one published name)')


@check('redaction_preserved', 'inv 4')
def _():
    bad = []
    num = ['annualized_adjusted_basic_pay', 'length_of_service_years', 'service_computation_date_leave', 'appointment_not_to_exceed_date']
    txt = ['grade', 'duty_station_state', 'bargaining_unit_code', 'personnel_office_identifier_code']
    for ds, t in (('accessions', 'accession_rows'), ('separations', 'separation_rows')):
        r = rows(f"SELECT {', '.join(f'count(*) FILTER (WHERE {c} = {chr(39)}REDACTED{chr(39)}), count(*) FILTER (WHERE {c} IS NULL)' for c in num + txt)} FROM {raw(ds)}")[0]
        s = rows(f"SELECT {', '.join(f'count(*) FILTER (WHERE {c}_redacted), count(*) FILTER (WHERE {c} IS NULL)' for c in num)}, "
                 f"{', '.join(f'count(*) FILTER (WHERE {c} = {chr(39)}REDACTED{chr(39)}), count(*) FILTER (WHERE {c} IS NULL)' for c in txt)} FROM {t}")[0]
        for i, c in enumerate(num + txt):
            red, nul, sred, snul = r[2 * i], r[2 * i + 1], s[2 * i], s[2 * i + 1]
            want_null = nul + red if c in num else nul
            if sred != red or snul != want_null: bad.append(f'{t}.{c}: REDACTED {sred} vs raw {red}; NULL {snul} vs {want_null}')
    # employment: coverage counts per department and field = raw, sampled months; and present for every month
    for ym in SAMPLE:
        want = {(d, f): (n, red, nul) for d, f, n, red, nul in raw_emp(ym)[2]}
        got = {(d, f): (n, red, nul) for d, f, n, red, nul in rows(f"SELECT department_code, field, rows, n_redacted, n_null FROM emp_cov_month WHERE period = '{ym}-01'")}
        if got != want: bad.append(f'{ym}: {len(set(got.items()) ^ set(want.items()))} coverage cells differ from raw')
    full = rows("SELECT count(DISTINCT period), count(DISTINCT field) FROM emp_cov_month")[0]
    if full[0] != len(EMP_FILES): bad.append(f'emp_cov_month covers {full[0]} of {len(EMP_FILES)} months')
    pay = rows("SELECT round(100.0 * sum(n_redacted) / sum(rows), 2) FROM emp_cov_month WHERE field = 'annualized_adjusted_basic_pay' "
               f"AND period = '{LATEST}-01'")[0][0]
    return not bad, '; '.join(bad[:5]) or (f'actions: REDACTED and NULL counts = raw for {len(num)} typed and {len(txt)} text fields '
        f'(typed NULL = raw NULL + REDACTED; text keeps REDACTED); employment coverage = raw in {len(SAMPLE)} sampled months, '
        f'{full[1]} fields x {full[0]} months stored ({LATEST} pay {pay}% REDACTED)')


@check('known_data_issues', 'inv 4')
def _():
    bad = []
    ks = kdi_rows()
    cols = ['id', 'dataset', 'field', 'first_file_month', 'last_file_month', 'entity_level', 'entities', 'value_min',
            'value_max', 'treatment', 'status', 'decision', 'issue', 'spec_treatment']
    if ks and list(ks[0]) != cols: bad.append(f'columns {list(ks[0])}')
    spec = {}
    for line in open('docs/metric-spec.md', encoding='utf-8'):
        m = re.match(r'\| (KDI-\d{3}) \| (.+) \| (.+) \|\s*$', line)
        if m: spec[m.group(1)] = (m.group(2), m.group(3))
    if sorted({k['id'] for k in ks}) != sorted(spec) or sorted(spec) != [f'KDI-{i:03d}' for i in range(1, max(len(spec), 10) + 1)]:
        bad.append(f"issue ids {sorted({k['id'] for k in ks})} != spec section 7 {sorted(spec)}")
    bad += [f"{k['id']} {k['dataset']} text differs from spec section 7" for k in ks if spec.get(k['id']) != (k['issue'], k['spec_treatment'])]
    keys = [(k['id'], k['dataset'], k['field'], k['first_file_month']) for k in ks]
    if len(keys) != len(set(keys)): bad.append('duplicate (id, dataset, field, first_file_month)')
    decisions = set(re.findall(r'^## (D-\d+)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M)) if os.path.exists('ops/DECISIONS.md') else None
    if decisions is not None: bad += [f"{k['id']} cites {k['decision']}, not a decision" for k in ks if k['decision'] not in decisions]
    T = {'unknown', 'unusable', 'counted_flagged', 'department_from_agency', 'flagged_incomplete', 'unknown_with_coverage'}
    bad += [f"{k['id']} treatment {k['treatment']}" for k in ks if k['treatment'] not in T]
    act = [k for k in ks if k['status'] == 'active']
    notes = []
    # KDI-001, KDI-009, KDI-010 (value rules): every raw value in an issue's range is attributed to the lowest-id issue
    # whose scope (file month, entity) holds it, so KDI-009 ("outside KDI-001") takes only what KDI-001 does not;
    # counts = spec where the text gives counts, the example values are attributed, and the stored views make them
    # unknown. Bounds are inclusive and an empty bound is open; they are exact because every published value carries
    # at most one decimal (checked here: 100.1 means over 100, -0.1 below 0).
    for ds in ('accessions', 'separations'):
        ks1 = sorted([k for k in act if k['treatment'] == 'unknown' and k['dataset'] == ds], key=lambda k: k['id'])
        if not ks1: continue
        v_sql = 'TRY_CAST(length_of_service_years AS DOUBLE)'
        rng = lambda k: ' AND '.join(([f"{v_sql} >= {float(k['value_min'])}"] if k['value_min'] else [])
                                     + ([f"{v_sql} <= {float(k['value_max'])}"] if k['value_max'] else [])) or 'true'
        odd = f"(length_of_service_years <> 'REDACTED' AND ({v_sql} IS NULL OR length_of_service_years LIKE '%.__%'))"
        vals = rows(f"SELECT {ym_sql()}, department_code, {v_sql} AS v, {odd} AS odd, count(*) FROM {raw(ds)} "
                    f"WHERE {' OR '.join(sorted({f'({rng(k)})' for k in ks1}) + [odd])} GROUP BY ALL")
        fmt = sum(x[4] for x in vals if x[3])
        if fmt: bad.append(f'{ds}: {fmt} length_of_service_years values not a number with at most one decimal (the issue bounds assume one)')
        vals = [(ym, d, v, n) for ym, d, v, o, n in vals if not o]
        in_range = lambda k, v: (not k['value_min'] or v >= float(k['value_min'])) and (not k['value_max'] or v <= float(k['value_max']))
        att, unatt = {}, {}
        for ym, d, v, n in vals:
            who = next((k['id'] for k in ks1 if in_range(k, v) and in_scope(k, ds, ym, d)), None)
            if who: att.setdefault(who, []).append((ym, d, v, n))
            for k in ks1:
                if in_range(k, v) and who is None: unatt[k['id']] = unatt.get(k['id'], 0) + n
        stored = dict(((i, (n, nb)) for i, n, nb in rows(f"SELECT los_issue_id, count(*), count(*) FILTER (WHERE band_los <> 'unknown') "
                                                         f"FROM v_{ds} WHERE los_known_issue GROUP BY 1")))
        for k in ks1:
            n_in = sum(x[3] for x in att.get(k['id'], []))
            if unatt.get(k['id']): bad.append(f"{k['id']} {ds}: {unatt[k['id']]} rows with the value outside every issue's scope")
            spec_n = re.search(rf'([\d,]+) {ds} \(', k['issue'])
            if spec_n and int(spec_n.group(1).replace(',', '')) != n_in: bad.append(f"{k['id']} {ds}: {n_in} rows in scope, spec says {spec_n.group(1)}")
            if not spec_n and ds == 'separations':
                for ex in re.findall(r'(\d[\d,]*\.\d)', k['issue']):
                    if not any(abs(x[2] - float(ex.replace(',', ''))) < 1e-9 for x in att.get(k['id'], [])):
                        bad.append(f"{k['id']} {ds}: example value {ex} not attributed to it")
            if stored.get(k['id'], (0, 0)) != (n_in, 0): bad.append(f"{k['id']} v_{ds}: {stored.get(k['id'])} rows flagged (not unknown), raw {n_in}")
            if f"{k['id']} {ds} {n_in:,}" not in notes: notes.append(f"{k['id']} {ds} {n_in:,}")
        extra = set(stored) - {k['id'] for k in ks1}
        if extra: bad.append(f'v_{ds} flags length of service under ids {sorted(extra)} that have no active scope row')
    # KDI-002 (unusable field): the issue starts at the scoped file; no breakdown reads the field
    for k in [k for k in act if k['treatment'] == 'unusable']:
        sh = rows(f"""SELECT {ym_sql()} >= '{k['first_file_month']}', avg(CASE WHEN {k['field']} IS NULL OR trim({k['field']}) = ''
                     OR upper({k['field']}) = 'NO DATA REPORTED' THEN 1.0 ELSE 0 END) FROM {raw(k['dataset'])} GROUP BY 1 ORDER BY 1""")
        sh = dict(sh)
        if not (sh.get(True, 0) >= 0.5 and sh.get(False, 0) < 0.01): bad.append(f"{k['id']} {k['field']}: share bad before/after {sh}")
        if any(k['field'] in r['source_field'].split('|') for r in csv_rows(f'{XW}/breakdown_bands.csv')):
            bad.append(f"{k['id']}: breakdown_bands.csv reads {k['field']}")
    notes.append(f"KDI-002 {100 * sh.get(True, 0):.0f}% bad from {k['first_file_month']}")
    # KDI-003 (duplicates): the scoped entity-months have exact duplicate rows in the raw file, and are flagged
    flagged3 = set()
    for k in [k for k in act if k['treatment'] == 'counted_flagged']:
        for ym in sorted(m for m in EMP_FILES if k['first_file_month'] <= m <= (k['last_file_month'] or '9999')):
            for s in k['entities'].split(';'):
                n, nd = rows(f"SELECT count(*), (SELECT count(*) FROM (SELECT DISTINCT * FROM read_parquet('{EMP_FILES[ym]}') WHERE agency_subelement_code = '{s}')) "
                             f"FROM read_parquet('{EMP_FILES[ym]}') WHERE agency_subelement_code = '{s}'")[0]
                if not n > nd: bad.append(f"{k['id']} {ym} {s}: {n} rows, {nd} distinct (no duplicates)")
                flagged3.add((ym, s))
    got3 = {(fmt_ym(m), s) for m, s in rows("SELECT month, agency_subelement_code FROM monthly_org_kdi WHERE list_contains(kdi_ids, 'KDI-003')")}
    if got3 != flagged3: bad.append(f'KDI-003 flags {sorted(got3)} != scope {sorted(flagged3)}')
    # KDI-004, KDI-005, KDI-008 (department from agency): every raw row with a missing or 'No Data Reported' department is in
    # a scoped issue (actions in full; employment in the sampled months and, for all months, the stored flag)
    dfa = [k for k in act if k['treatment'] == 'department_from_agency']
    unscoped = {}
    def note(ds, ym, d, a, s, n):
        if not any(in_scope(k, ds, ym, d, a, s) for k in dfa): unscoped[(ds, ym, d, a, s)] = unscoped.get((ds, ym, d, a, s), 0) + n
    for ds in ('accessions', 'separations'):
        for fm, eff, d, a, s, code, drp, isbad, nd, n in raw_actions_org(ds):
            if isbad: note(ds, fm, d, a, s, n)
    for ym in SAMPLE:
        for d, b, a, s, nd, n in raw_emp(ym)[0]:
            if b: note('employment', ym, d, a, s, n)
    for p, d, a, s, n in rows("SELECT period, department_code, agency_code, agency_subelement_code, sum(headcount) FROM emp_org_month WHERE department_from_agency GROUP BY ALL"):
        if fmt_ym(p) not in SAMPLE: note('employment', fmt_ym(p), d, a, s, n)
    if unscoped: bad.append('department taken from the agency code outside every known data issue: ' +
                            ', '.join(f'{ds} {ym} {d}/{a}/{s!r} {n} row(s)' for (ds, ym, d, a, s), n in sorted(unscoped.items())))
    dfa_ids = sorted({k['id'] for k in dfa})
    unflag = rows(f"SELECT count(*) FROM monthly_org_kdi WHERE rows_department_from_agency > 0 AND NOT list_has_any(kdi_ids, {dfa_ids})")[0][0]
    if unflag: bad.append(f"{unflag} entity-month(s) hold re-assigned rows but carry no {'/'.join(dfa_ids)} flag")
    # each department-from-agency issue flags exactly the entity-months that hold its re-assigned rows
    for k in dfa:
        lvl = {'department': 'department_code', 'agency': 'agency_code', 'subelement': 'agency_subelement_code'}[k['entity_level']]
        ents = ', '.join(repr(e) for e in k['entities'].split(';'))
        got = rows(f"SELECT count(*) FILTER (WHERE rows_department_from_agency > 0 AND NOT list_contains(kdi_ids, '{k['id']}')), "
                   f"count(*) FILTER (WHERE list_contains(kdi_ids, '{k['id']}')) FROM monthly_org_kdi WHERE {lvl} IN ({ents}) "
                   f"AND strftime(month, '%Y-%m') BETWEEN '{k['first_file_month']}' AND '{k['last_file_month'] or '9999'}'")[0]
        if got[0]: bad.append(f"{k['id']} {k['dataset']}: {got[0]} scoped entity-month(s) with re-assigned rows unflagged")
        if k['id'] == 'KDI-008': notes.append(f"KDI-008 {got[1]} entity-month flagged")
    # KDI-006 (incomplete months): every DOD entity-month in scope flagged, nothing else
    for k in [k for k in act if k['treatment'] == 'flagged_incomplete']:
        exp = rows(f"""SELECT count(*) FILTER (WHERE in_s AND NOT has), count(*) FILTER (WHERE has AND NOT in_s), count(*) FILTER (WHERE in_s) FROM (
            SELECT strftime(month, '%Y-%m') BETWEEN '{k['first_file_month']}' AND '{k['last_file_month'] or '9999'}' AND department_code IN ({', '.join(repr(e) for e in k['entities'].split(';'))}) AS in_s,
                   list_contains(kdi_ids, '{k['id']}') AS has FROM monthly_org_kdi)""")[0]
        if exp[0] or exp[1]: bad.append(f"{k['id']}: {exp[0]} scoped entity-months unflagged, {exp[1]} flagged outside scope")
        notes.append(f"{k['id']} {exp[2]} entity-months")
    # KDI-007 (REDACTED grade): only inside the scope (actions in full; employment all months from coverage, sampled raw)
    k7 = [k for k in act if k['treatment'] == 'unknown_with_coverage']
    out7 = []
    for ds in ('accessions', 'separations'):
        for ym, d, n in rows(f"SELECT {ym_sql()}, department_code, count(*) FROM {raw(ds)} WHERE grade = 'REDACTED' GROUP BY ALL"):
            if not any(in_scope(k, ds, ym, d) for k in k7): out7.append(f'{ds} {ym} {d} {n}')
    for p, d, n in rows("SELECT period, department_code, n_redacted FROM emp_cov_month WHERE field = 'grade' AND n_redacted > 0"):
        if not any(in_scope(k, 'employment', fmt_ym(p), d) for k in k7): out7.append(f'employment {fmt_ym(p)} {d} {n}')
    if out7: bad.append(f'grade REDACTED outside KDI-007 scope: {out7[:4]}')
    return not bad, '; '.join(bad[:4]) or (f"{len(ks)} scope rows for KDI-001 to {max(spec)}, text = spec section 7; checked against raw: "
        + '; '.join(notes) + '; every re-assigned department in scope; grade REDACTED only in scope')


@check('codes_mapped_and_partition', 'inv 5')
def _():
    bad = []
    sep, acc = csv_rows(f'{XW}/separation_codes.csv'), csv_rows(f'{XW}/accession_codes.csv')
    for rs, signed, key in ((sep, SEP_SIGNED, 'counts_in_departures'), (acc, ACC_SIGNED, 'counts_in_hires')):
        got = {}
        for r in rs: got.setdefault(r['category'], set()).add(r['code'])
        if got != signed: bad.append(f'crosswalk {got} != signed {signed}')
        bad += [f"{r['code']} not counted" for r in rs if r[key] != 'Y']
        codes = [r['code'] for r in rs]
        if len(codes) != len(set(codes)): bad.append('duplicate code rows')
    cat = {c: k for k, cs in {**SEP_SIGNED, **ACC_SIGNED}.items() for c in cs}
    # every code in the raw files is mapped (NULL counts as an unmapped code)
    for ds in ('accessions', 'separations'):
        found = {str(r[5]) for r in raw_actions_org(ds)}
        if found - set(cat): bad.append(f'unmapped {ds} codes {sorted(found - set(cat))}')
    # every org code in the raw files is in entities.csv, at each level, with one parent
    ent = {(r['level'], r['code']): r for r in csv_rows(f'{XW}/entities.csv')}
    seen = set()
    for ds in ('accessions', 'separations'):
        for fm, eff, d, a, s, *_x in raw_actions_org(ds): seen |= {('department', d), ('agency', a), ('subelement', s)}
    for ym in SAMPLE:
        for d, b, a, s, nd, n in raw_emp(ym)[0]: seen |= {('department', d), ('agency', a), ('subelement', s)}
    seen |= {(l, c) for l, c in rows("SELECT DISTINCT 'department', department_code FROM emp_org_month UNION SELECT DISTINCT 'agency', agency_code "
                                     "FROM emp_org_month UNION SELECT DISTINCT 'subelement', agency_subelement_code FROM emp_org_month")}
    miss = sorted(seen - set(ent), key=str)
    if miss: bad.append(f'org codes missing from entities.csv: {miss[:5]}')
    multi = [k for k, r in ent.items() if ';' in r['parent_code']]
    if multi: bad.append(f'entities with more than one parent: {multi[:5]}')
    # categories partition hires and departures, per effective month and department, against raw
    want = {}
    for ds, pre in (('accessions', 'acc_'), ('separations', 'sep_')):
        for fm, eff, d, a, s, code, drp, isbad, nd, n in raw_actions_org(ds):
            if eff < '201110': continue
            k = (eff[:4] + '-' + eff[4:], d)
            w = want.setdefault(k, {})
            w[pre + cat.get(code, '?')] = w.get(pre + cat.get(code, '?'), 0) + n
            if drp == 'Y': w['sep_drp'] = w.get('sep_drp', 0) + n
    names = sorted({'acc_' + c for c in ACC_SIGNED} | {'sep_' + c for c in SEP_SIGNED})
    have = [r[0] for r in rows('DESCRIBE monthly_org')]
    extra = [c for c in have if c.startswith(('acc_', 'sep_')) and c not in names + ['sep_drp']]
    if extra or not set(names) <= set(have): bad.append(f'monthly_org category columns {sorted(c for c in have if c.startswith(("acc_", "sep_")))} != {names}')
    got = {}
    if not bad:
        for r in rows(f"SELECT strftime(month, '%Y-%m'), department_code, hires, departures, {', '.join(names)}, sep_drp FROM monthly_org"):
            k, hires, deps, vals = (r[0], r[1]), r[2], r[3], dict(zip(names + ['sep_drp'], r[4:]))
            if hires != sum(v for c, v in vals.items() if c.startswith('acc_')) or deps != sum(v for c, v in vals.items() if c.startswith('sep_') and c != 'sep_drp'):
                bad.append(f'{k}: categories do not sum to hires/departures'); break
            g = got.setdefault(k, {})
            for c, v in vals.items(): g[c] = g.get(c, 0) + v
        clean = lambda dct: {k: {c: v for c, v in x.items() if v} for k, x in dct.items() if any(x.values())}
        months = {fmt_ym(m) for (m,) in rows('SELECT DISTINCT month FROM monthly_org')}
        w2 = {k: v for k, v in clean(want).items() if k[0] in months}
        if clean(got) != w2: bad.append(f'{len(set(clean(got)) ^ set(w2))} month-department keys differ; e.g. {sorted(set(clean(got)) ^ set(w2))[:2]}; '
                                        f'values differ in {sum(clean(got).get(k) != v for k, v in w2.items())}')
    return not bad, '; '.join(bad[:4]) or (f'separation and accession crosswalks = signed categories (AB in transfer_in); all raw codes mapped; '
        f'{len(seen)} org codes in entities.csv with one parent each; categories and DRP per month and department = raw '
        f'({len(got)} month-department rows)')


@check('appointment_codes_mapped', 'inv 5')
def _():
    bad = []
    rs = csv_rows(f'{XW}/appointment_groups.csv')
    got = {r['code']: (r['group'], r['subgroup']) for r in rs}
    if len(rs) != len(got): bad.append('duplicate codes')
    if got != APPT_SIGNED: bad.append(f'appointment_groups.csv differs from the signed mapping: {sorted(set(got.items()) ^ set(APPT_SIGNED.items()))}')
    found = {}
    for ds in ('accessions', 'separations'):
        found[ds] = {str(r[0]) for r in rows(f'SELECT DISTINCT appointment_type_code FROM {raw(ds)}')}
    found['employment (sampled raw)'] = set().union(*(raw_emp(ym)[3] for ym in SAMPLE))
    found['employment (all months, emp_dim_month)'] = {r[0] for r in rows("SELECT DISTINCT value FROM emp_dim_month WHERE dimension = 'appointment'")}
    for k, v in found.items():
        if v - set(got): bad.append(f'unmapped appointment codes in {k}: {sorted(v - set(got))}')
    return not bad, '; '.join(bad) or (f'{len(got)} codes = signed groups (65 in ses, * its own unknown group); every code mapped in raw '
        f"accessions ({len(found['accessions'])}), separations ({len(found['separations'])}), sampled employment and all employment months")


@check('time_basis_effective', 'inv 6')
def _():
    bad = []
    nb = rows("SELECT count(*) FILTER (WHERE time_basis IS DISTINCT FROM 'effective'), count(*) FROM monthly_org")[0]
    if nb[0]: bad.append(f'{nb[0]} monthly_org rows not on the effective basis')
    got = {fmt_ym(m): (h, d) for m, h, d in rows('SELECT month, sum(hires), sum(departures) FROM monthly_org GROUP BY 1')}
    eff, proc, pre, stored_pre = {}, {}, {}, {}
    for i, ds in enumerate(('accessions', 'separations')):
        for fm, e, *_x, n in raw_actions_org(ds):
            ek = e[:4] + '-' + e[4:]
            if e < '201110': pre[ds] = pre.get(ds, 0) + n; continue
            eff.setdefault(ek, [0, 0])[i] += n
            proc.setdefault(fm, [0, 0])[i] += n
        stored_pre[ds] = rows(f"SELECT count(*) FILTER (WHERE effective_before_range) FROM {'accession_rows' if i == 0 else 'separation_rows'}")[0][0]
    diff = [m for m in got if got[m] != tuple(eff.get(m, [0, 0]))]
    if diff: bad.append(f'{len(diff)} months differ from raw counts by effective month, e.g. {diff[:3]}')
    not_proc = sum(got[m] != tuple(proc.get(m, [0, 0])) for m in got)
    if not_proc == 0: bad.append('every month equals the processing-month count: the basis cannot be told apart')
    if stored_pre != pre: bad.append(f'effective before Oct 2011: stored flags {stored_pre} != raw {pre}')
    return not bad, '; '.join(bad) or (f'{nb[1]:,} rows effective basis; hires and departures = raw by effective month in all {len(got)} months '
        f'({not_proc} differ from processing-month counts); before Oct 2011 kept and flagged, outside the series: '
        f"{pre.get('accessions', 0):,} accessions, {pre.get('separations', 0):,} separations")


@check('monthly_basis', 'inv 6')
def _():
    bad = []
    months = sorted(fmt_ym(m) for (m,) in rows('SELECT DISTINCT month FROM monthly_org'))
    if months != sorted(EMP_FILES): bad.append(f'monthly_org has {len(months)} months, employment files {len(EMP_FILES)}')
    prov = sorted(fmt_ym(m) for (m,) in rows('SELECT DISTINCT month FROM monthly_org WHERE provisional'))
    if prov != sorted(EMP_FILES)[-3:]: bad.append(f'provisional {prov} != newest 3 {sorted(EMP_FILES)[-3:]}')
    nf = rows('SELECT count(*) FROM monthly_org WHERE net_flow IS DISTINCT FROM hires - departures')[0][0]
    if nf: bad.append(f'{nf} rows net_flow != hires - departures')
    meta = {os.path.basename(f)[:-8]: n for f, n in rows("SELECT file_name, num_rows FROM parquet_file_metadata('data/Employment/employment_*.parquet')")}
    hc = {fmt_ym(m): n for m, n in rows('SELECT month, sum(headcount) FROM monthly_org GROUP BY 1')}
    by_ym = {ym: meta[os.path.basename(p)[:-8]] for ym, p in EMP_FILES.items()}
    off = [m for m in by_ym if hc.get(m) != by_ym[m]]
    if off: bad.append(f'headcount != file rows in {off[:3]}')
    for ym in SAMPLE:
        want = {}
        for d, b, a, s, nd, n in raw_emp(ym)[0]: want[(d, a, s)] = want.get((d, a, s), 0) + n
        got = {(d, a, s): n for d, a, s, n in rows(f"SELECT department_code, agency_code, agency_subelement_code, headcount FROM monthly_org "
                                                  f"WHERE month = '{ym}-01' AND headcount > 0")}
        if got != want: bad.append(f'{ym}: {len(set(got.items()) ^ set(want.items()))} entity headcounts differ from raw')
    # GS-equivalent plans: the gate's signed constant = the crosswalk = spec section 9
    xw = sorted({c for r in csv_rows(f'{XW}/breakdown_bands.csv') if r['rule'] == 'plan_grade' for c in r['codes'].split('|')})
    if xw != sorted(GS_EQUIV_PLANS): bad.append(f'breakdown_bands.csv GS-equivalent plans {xw} != signed {GS_EQUIV_PLANS}')
    if spec_gs_plans() != GS_EQUIV_PLANS: bad.append(f'spec section 9 GS-equivalent plans {spec_gs_plans()} != signed {GS_EQUIV_PLANS}')
    # breakdown counts per department and agency, sampled months, against the gate's own band SQL over raw
    for ym in SAMPLE:
        want = {(d, a, dim, v): n for d, a, dim, v, n in raw_emp(ym)[1]}
        got = {(d, a, dim, v): n for d, a, dim, v, n in rows(f"SELECT department_code, agency_code, dimension, value, headcount FROM emp_dim_month WHERE period = '{ym}-01'")}
        if got != want: bad.append(f'{ym}: {len(set(got.items()) ^ set(want.items()))} breakdown cells differ from raw')
    return not bad, '; '.join(bad[:5]) or (f'{len(months)} months, one per employment file; headcount = file rows every month; provisional '
        f'{" ".join(prov)}; net_flow = hires - departures on every row; entity headcounts and breakdown cells = raw '
        f'(GS equivalents {", ".join(GS_EQUIV_PLANS)} = crosswalk = spec); {SAMPLE_NOTE}')

# ---- Phase 2 cubes (warehouse/cubes/, staged by pipeline/build_cubes.py) ----
# These checks never import the cube code. Every figure is recomputed in SQL from the stored tables (emp_org_month for
# headcount, accession_rows and separation_rows for actions) with the gate's own category constants, entity keys and
# known-data-issue reading, then compared with the cube files.
CUBES = 'warehouse/cubes'
BREAKDOWN_CUBES = ('leaving', 'joining', 'admin', 'appointments')   # Phase 2b (pipeline/build_breakdowns.py)
MATRIX_CUBES = ('matrix',)   # docs/cube-plan.md amendment 1 (pipeline/build_matrix.py, copied from admin)
ALL_CUBES = ('core', 'compare') + BREAKDOWN_CUBES + MATRIX_CUBES
CUBE_FILE_MAX = 3_000_000      # bytes per file (docs/cube-plan.md section 3)
FIRST_LOAD_MAX = 3_000_000     # GOV core + GOV compare (docs/cube-plan.md section 3)
SMALL_BASE = 30                # invariant 9
KINDS = {'dimension', 'flag', 'stock', 'stock_change', 'flow', 'rate_numerator', 'rate_denominator', 'coverage', 'share_denominator'}
SEP_ORDER = ['transfer_out', 'quit', 'retirement', 'rif', 'termination', 'other']
FIRST_MONTH = '2011-10-01'


def cube_meta(name):
    key = f'meta_{name}'
    if key not in _CACHE:
        p = f'{CUBES}/{name}.meta.json'
        if not os.path.exists(p): raise RuntimeError(f'{p} missing (run pipeline/build_cubes.py)')
        _CACHE[key] = json.load(open(p))
    return _CACHE[key]


def cube_rows(name):
    """{file key: (columns, [row dicts])} for every file listed in the cube's meta."""
    key = f'rows_{name}'
    if key not in _CACHE:
        out = {}
        for k, fi in cube_meta(name)['files'].items():
            d = json.load(open(f"{CUBES}/{fi['path']}"))
            out[k] = (d['columns'], [dict(zip(d['columns'], r)) for r in d['rows']])
        _CACHE[key] = out
    return _CACHE[key]


def canonical_manifest_hash():
    import hashlib
    recs = sorted(MAN, key=lambda x: (x['dataset'], x['filename']))
    return hashlib.sha256(json.dumps(recs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def manifest_versions():
    v = {}
    for x in MAN: v.setdefault(f"{int(x['year']):04d}-{int(x['month']):02d}", {})[x['dataset']] = int(x['version'])
    return v


def los_id_sql(ds='separations'):
    """The known data issue id of an action row's length of service (separations by default), read from the CSV (treatment 'unknown'): in-scope
    file month (processing period), entity and value range (inclusive; an empty bound is open); the lowest id wins, so
    KDI-009 takes only values outside KDI-001. NULL when the value is not in any issue."""
    whens = []
    for k in sorted(kdi_rows(), key=lambda k: k['id']):
        if not (k['status'] == 'active' and k['dataset'] == ds and k['field'] == 'length_of_service_years'
                and k['treatment'] == 'unknown'): continue
        ents = [e for e in k['entities'].split(';') if e]
        whens.append(f"WHEN strftime(period, '%Y-%m') >= '{k['first_file_month']}' AND strftime(period, '%Y-%m') <= '{k['last_file_month'] or '9999-12'}' "
                     + (f" AND length_of_service_years >= {float(k['value_min'])}" if k['value_min'] else '')
                     + (f" AND length_of_service_years <= {float(k['value_max'])}" if k['value_max'] else '')
                     + (f" AND department_code IN {IN(ents)}" if ents else '') + f" THEN '{k['id']}'")
    return '(CASE ' + ' '.join(whens) + ' END)' if whens else '(NULL)'


def los_ids(ds):
    """The active length-of-service issue ids (treatment unknown) of one action dataset, sorted."""
    return sorted({k['id'] for k in kdi_rows() if k['status'] == 'active' and k['dataset'] == ds
                   and k['field'] == 'length_of_service_years' and k['treatment'] == 'unknown'})


def los_issue_sql():
    return f'({los_id_sql()} IS NOT NULL)'


GATE_KEY = "CASE WHEN trim(coalesce(s, '')) = '' THEN a || '_NR' ELSE replace(s, '*', '_') END"
IN = lambda codes: '(' + ', '.join(f"'{c}'" for c in sorted(codes)) + ')'


def cell_cte():
    """CTE text: cell(m, d, a, s, <figures>) per month and organization, from the stored tables."""
    iss = los_issue_sql()
    sep = ''.join(f", count(*) FILTER (WHERE action_code IN {IN(SEP_SIGNED[c])}) AS sep_{c}" for c in SEP_ORDER)
    nd = ''.join(f", count(*) FILTER (WHERE action_code IN {IN(SEP_SIGNED[c])} AND coalesce(drp_indicator, '') <> 'Y') AS sep_{c}_nondrp" for c in SEP_ORDER)
    flows = (['hires', 'acc_transfer_in', 'acc_new_hire', 'departures'] + [f'sep_{c}' for c in SEP_ORDER] + ['sep_drp']
             + [f'sep_{c}_nondrp' for c in SEP_ORDER] + ['los_tenths', 'yos_known', 'yos_unknown_issue', 'yos_unknown_missing'])
    z = lambda cols: ', '.join(f'0 AS {c}' for c in cols)
    acc_cols = ['hires', 'acc_transfer_in', 'acc_new_hire']
    sep_cols = [c for c in flows if c not in acc_cols]
    return flows, f"""
      hc AS (SELECT period AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s, sum(headcount) AS h,
                    {z(flows)} FROM emp_org_month GROUP BY ALL),
      ac AS (SELECT effective_month AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s, 0 AS h,
                    count(*) AS hires, count(*) FILTER (WHERE action_code IN {IN(ACC_SIGNED['transfer_in'])}) AS acc_transfer_in,
                    count(*) FILTER (WHERE action_code IN {IN(ACC_SIGNED['new_hire'])}) AS acc_new_hire, {z(sep_cols)}
             FROM accession_rows WHERE effective_month >= DATE '{FIRST_MONTH}' GROUP BY ALL),
      sp AS (SELECT effective_month AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s, 0 AS h, {z(acc_cols)},
                    count(*) AS departures {sep}, count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp {nd},
                    coalesce(sum(CAST(round(length_of_service_years * 10) AS BIGINT)) FILTER (WHERE length_of_service_years IS NOT NULL AND NOT {iss}), 0) AS los_tenths,
                    count(*) FILTER (WHERE length_of_service_years IS NOT NULL AND NOT {iss}) AS yos_known,
                    count(*) FILTER (WHERE {iss}) AS yos_unknown_issue,
                    count(*) FILTER (WHERE length_of_service_years IS NULL) AS yos_unknown_missing
             FROM separation_rows WHERE effective_month >= DATE '{FIRST_MONTH}' GROUP BY ALL),
      cell AS (SELECT m, d, a, s, sum(h) AS h, {', '.join(f'sum({c}) AS {c}' for c in flows)}
               FROM (SELECT * FROM hc UNION ALL BY NAME SELECT * FROM ac UNION ALL BY NAME SELECT * FROM sp)
               WHERE m IN (SELECT DISTINCT period FROM emp_org_month) GROUP BY ALL)"""


def keyed_sql(rel, cols):
    """Each organization row of rel counted in the government, its department, its DOD agency and its subelement."""
    c = ', '.join(cols)
    return (f"SELECT 'GOV' AS e, {c} FROM {rel} UNION ALL SELECT d, {c} FROM {rel} UNION ALL "
            f"SELECT 'DOD-' || a, {c} FROM {rel} WHERE d = 'DOD' UNION ALL SELECT {GATE_KEY}, {c} FROM {rel}")


def independent_cubes():
    """Every core row recomputed: {(entity, grain, period): row}, plus t12 windows {(entity, last month): row},
    entity last months and the parent-child map."""
    if 'indep' in _CACHE: return _CACHE['indep']
    flows, cte = cell_cte()
    fl = ['h'] + flows
    sums = ', '.join(f'sum({c}) AS {c}' for c in fl)
    tw = ', '.join(f'sum({c}) OVER w AS t_{c}' for c in flows if c not in ('los_tenths',))
    sql = f"""WITH {cte},
      ek AS ({keyed_sql('cell', ['m'] + fl)}),
      ec AS (SELECT e, m, {sums} FROM ek GROUP BY e, m),
      lastm AS (SELECT e, min(m) AS fm, max(m) AS lm FROM ec WHERE h > 0 OR hires > 0 OR departures > 0 GROUP BY e),
      mo AS (SELECT DISTINCT period AS m FROM emp_org_month),
      g AS MATERIALIZED (SELECT e, m, year(m + INTERVAL 3 MONTH) AS fy, (month(m) + 2) % 12 // 3 + 1 AS q,
                                {', '.join(f'coalesce(ec.{c}, 0) AS {c}' for c in fl)}
                         FROM lastm CROSS JOIN mo LEFT JOIN ec USING (e, m) WHERE m >= fm AND m <= lm),
      t AS MATERIALIZED (SELECT e, m, {tw}, avg(h) OVER w AS t_mean_h, count(*) OVER w AS t_n FROM g
                         WINDOW w AS (PARTITION BY e ORDER BY m ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)),
      p AS MATERIALIZED (
        SELECT e, 'month' AS grain, strftime(m, '%Y-%m') AS period, fy, q, m AS first_m, m AS last_m, 1 AS n_exp, 1 AS n,
               {', '.join(fl)}, h AS mean_h FROM g
        UNION ALL
        SELECT e, 'quarter', 'FY' || fy || 'Q' || q, fy, q, NULL, max(m), 3, count(*), arg_max(h, m), {', '.join(f'sum({c})' for c in flows)}, avg(h)
        FROM g GROUP BY e, fy, q
        UNION ALL
        SELECT e, 'fy', 'FY' || fy, fy, NULL, NULL, max(m), 12, count(*), arg_max(h, m), {', '.join(f'sum({c})' for c in flows)}, avg(h)
        FROM g GROUP BY e, fy)
      SELECT p.*, p.h - lag(p.h) OVER (PARTITION BY p.e, p.grain ORDER BY p.last_m) AS h_chg, t.* EXCLUDE (e, m)
      FROM p JOIN t ON t.e = p.e AND t.m = p.last_m"""
    cur = db().execute(sql)
    names = [x[0] for x in cur.description]
    out = {}
    for x in cur.fetchall():
        r = dict(zip(names, x))
        out[(r['e'], r['grain'], r['period'])] = r
    span = rows(f"""WITH {cte}, ek AS ({keyed_sql('cell', ['m', 'h', 'hires', 'departures'])})
        SELECT e, min(m), max(m) FROM ek WHERE h > 0 OR hires > 0 OR departures > 0 GROUP BY e""")
    lastm = {e: fmt_ym(m) for e, f, m in span}
    firstm = {e: fmt_ym(f) for e, f, m in span}
    # parents: departments under GOV; subelements under their department; DOD agencies under DOD
    orgs = rows(f"WITH {cte} SELECT DISTINCT d, a, {GATE_KEY} FROM cell")
    children = {'GOV': {('department', d) for d, a, s in orgs}}
    for d, a, s in orgs:
        children.setdefault(d, set()).add(('subelement', s))
        if d == 'DOD': children[d].add(('agency', f'DOD-{a}'))
    # entity-month known data issue ids: monthly_org_kdi keyed, plus the issue id (KDI-001, KDI-009) of every departure
    # whose length of service is unknown
    kd = {}
    for e, m, ids in rows(f"""WITH x AS (SELECT month AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s,
                                       unnest(kdi_ids) AS id FROM monthly_org_kdi),
                              k AS ({keyed_sql('x', ['m', 'id'])})
                              SELECT e, m, list(DISTINCT id) FROM k GROUP BY e, m"""):
        kd[(e, fmt_ym(m))] = set(ids)
    li = rows(f"""WITH x AS (SELECT effective_month AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s,
                                  {los_id_sql()} AS id FROM separation_rows WHERE effective_month >= DATE '{FIRST_MONTH}'),
                       k AS ({keyed_sql('x', ['m', 'id'])})
                  SELECT DISTINCT e, m, id FROM k WHERE id IS NOT NULL""")
    for e, m, i in li:
        kd.setdefault((e, fmt_ym(m)), set()).add(i)
    present = {(e, fmt_ym(m)) for e, m in rows(f"WITH {cte}, k AS ({keyed_sql('cell', ['m'])}) SELECT DISTINCT e, m FROM k")}
    _CACHE['indep'] = (out, lastm, children, kd, present, flows, firstm)
    return _CACHE['indep']


def months_of(grain, period, fy, q, months, last=None, first=None):
    """Published months (YYYY-MM) of a period, from its grain and fiscal year/quarter, from the entity's first month
    to its last."""
    if grain == 'month': ms = [period]
    elif grain == 't12':
        i = months.index(period); ms = months[i - 11: i + 1]
    else:
        cal = [f'{fy - 1}-{x:02d}' for x in (10, 11, 12)] + [f'{fy}-{x:02d}' for x in range(1, 10)]
        ms = cal[(q - 1) * 3: q * 3] if grain == 'quarter' else cal
    return [m for m in ms if m in months and (last is None or m <= last) and (first is None or m >= first)]


def expected_figures(w, grain, flows):
    """Cube figures implied by one independent row w (core and compare share the names)."""
    n = w['n']
    exp = {'headcount': w['h'], 'net_flow': w['hires'] - w['departures'], 'months_published': n,
           'years_of_service_lost': round(w['los_tenths'] / 10, 1),
           'years_of_service_lost_coverage': round(w['yos_known'] / w['departures'], 4) if w['departures'] else None}
    exp.update({c: w[c] for c in flows if c != 'los_tenths'})
    def rate(on, dep, hire, den, months, fac):
        if not on: return (None, None, None, None, None)
        if den == 0: return (None, None, None, months, None)
        return (dep * fac, hire * fac, den, months, den < SMALL_BASE)
    A = rate(w['t_n'] == 12, w['t_departures'], w['t_hires'], w['t_mean_h'], 12, 1)
    B = rate(grain == 'fy', w['departures'], w['hires'], w['mean_h'], n, 1)
    C = rate(grain != 't12', w['departures'], w['hires'], w['mean_h'], n, 12 / n)
    for m, t in (('a', A), ('b', B), ('c', C)):
        exp.update(dict(zip([f'attrition_{m}_num', f'hire_{m}_num', f'rate_{m}_den', f'rate_{m}_months', f'rate_{m}_small_base'], t)))
    return exp


def t12_row(w, flows):
    """An independent trailing-12 row (the window ending at w's month, over the entity's months in it) in the shape
    expected_figures reads."""
    r = {'n': w['t_n'], 'h': w['h'], 'mean_h': w['t_mean_h'], 't_n': w['t_n'], 't_departures': w['t_departures'], 't_hires': w['t_hires'], 't_mean_h': w['t_mean_h']}
    for c in flows:
        if c != 'los_tenths': r[c] = w[f't_{c}']
    r['los_tenths'] = 0
    return r


def near(x, y, tol):
    if x is None or y is None: return x is None and y is None
    if isinstance(x, (bool, str, list)) or isinstance(y, (bool, str, list)): return x == y
    return abs(x - y) <= tol


@check('output_manifest_hash', 'inv 1')
def _():
    import hashlib
    want, bad, n = canonical_manifest_hash(), [], 0
    for name in ALL_CUBES:
        meta = cube_meta(name)
        if meta.get('manifest_sha256') != want: bad.append(f"{name} manifest {str(meta.get('manifest_sha256'))[:12]} != current {want[:12]}")
        for k, fi in meta['files'].items():
            p = f"{CUBES}/{fi['path']}"; n += 1
            if not os.path.exists(p): bad.append(f'{name} {fi["path"]} missing'); continue
            if hashlib.sha256(open(p, 'rb').read()).hexdigest() != fi['sha256']: bad.append(f'{name} {fi["path"]} sha256 differs from its meta')
            if os.path.getsize(p) != fi['bytes']: bad.append(f'{name} {fi["path"]} size differs from its meta')
            head = open(p, encoding='utf-8').read(300)   # the header only: the files are written {"cube", "entity"|"parent", ...}
            hdr = {'cube': name} if name in MATRIX_CUBES else {'cube': name, 'parent' if name == 'compare' else 'entity': k}
            if not head.startswith(json.dumps(hdr, separators=(',', ':'))[:-1] + ','):
                bad.append(f'{name} {fi["path"]} header names another cube or key')
        digest = hashlib.sha256(''.join(f"{fi['path']} {fi['sha256']}\n" for fi in sorted(meta['files'].values(), key=lambda f: f['path'])).encode()).hexdigest()
        if meta.get('files_sha256') != digest: bad.append(f'{name} files_sha256 does not match its listed files')
        listed = {os.path.basename(fi['path']) for fi in meta['files'].values()}
        extra = sorted(set(os.listdir(f'{CUBES}/{name}')) - listed)
        if extra: bad.append(f'{name}/ holds unlisted files {extra[:3]}')
        if re.search(r'"(built_at|generated|timestamp)"', open(f'{CUBES}/{name}.meta.json', encoding='utf-8').read()):
            bad.append(f'{name}.meta.json carries a build time (outputs must be deterministic)')
    bl = json.load(open(f'{CUBES}/revision_baseline.json'))
    if bl.get('manifest_sha256') != want: bad.append('revision_baseline.json is not for the current manifest')
    # the Look-Up meta (warehouse/lookup/lookup.meta.json) the same way
    lk, nl = 'warehouse/lookup', 0
    if not os.path.exists(f'{lk}/lookup.meta.json'): bad.append('lookup.meta.json missing')
    else:
        lm = json.load(open(f'{lk}/lookup.meta.json'))
        if lm.get('manifest_sha256') != want: bad.append(f"lookup manifest {str(lm.get('manifest_sha256'))[:12]} != current {want[:12]}")
        for k, fi in lm.get('files', {}).items():
            p = f"warehouse/{fi['path']}"; nl += 1
            if not os.path.exists(p): bad.append(f'lookup {fi["path"]} missing'); continue
            if hashlib.sha256(open(p, 'rb').read()).hexdigest() != fi['sha256'] or os.path.getsize(p) != fi['bytes']: bad.append(f'lookup {fi["path"]} sha256 or size differs from its meta')
        digest = hashlib.sha256(''.join(f"{fi['path']} {fi['sha256']}\n" for fi in sorted(lm.get('files', {}).values(), key=lambda f: f['path'])).encode()).hexdigest()
        if lm.get('files_sha256') != digest: bad.append('lookup files_sha256 does not match its listed files')
        extra = sorted(set(os.listdir(lk)) - {os.path.basename(fi['path']) for fi in lm.get('files', {}).values()} - {'lookup.meta.json'})
        if extra: bad.append(f'lookup/ holds unlisted files {extra[:3]}')
        if re.search(r'"(built_at|generated|timestamp)"', open(f'{lk}/lookup.meta.json', encoding='utf-8').read()): bad.append('lookup.meta.json carries a build time')
    return not bad, '; '.join(bad[:5]) or (f'{len(ALL_CUBES)} cubes ({", ".join(ALL_CUBES)}) and the Look-Up built from manifest {want[:12]}; '
        f'{n} cube and {nl} Look-Up file hashes and sizes match their meta; no unlisted files; no build time in the metas')


@check('stock_flow_rollups', 'inv 3')
def _():
    bad = []
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    months = sorted(EMP_FILES)
    for name in ('core', 'compare'):
        meta = cube_meta(name)
        kinds = {d['name']: d.get('kind') for d in meta['columns']}
        for k, (cols, _) in cube_rows(name).items():
            if [d['name'] for d in meta['columns']] != cols: bad.append(f'{name} {k}: meta column dictionary does not list the file columns in order'); break
        bad += [f'{name}.{c} kind {kinds[c]}' for c in kinds if kinds[c] not in KINDS]
        bad += [f'{name}.{d["name"]} has no description' for d in meta['columns'] if not d.get('description')]
    # core: every entity, grain and period against the independent recomputation
    core = cube_rows('core')
    got_keys = {(r['entity'], r['grain'], r['period']) for _, rs in core.values() for r in rs}
    if got_keys != set(want):
        bad.append(f'core row set: {len(got_keys - set(want))} extra, {len(set(want) - got_keys)} missing, e.g. {sorted(set(want) ^ got_keys)[:3]}')
    n_cmp, mism = 0, 0
    for k, (cols, rs) in core.items():
        for r in rs:
            w = want.get((r['entity'], r['grain'], r['period']))
            if w is None: continue
            exp = expected_figures(w, r['grain'], flows)
            exp.update({'headcount_change': w['h_chg'], 'months_in_period': w['n_exp'], 'partial': w['n'] < w['n_exp'],
                        'period_last_month': fmt_ym(w['last_m'])})
            for c, v in exp.items():
                tol = 0.051 if c == 'years_of_service_lost' else 1e-3
                if not near(r[c], v, tol) and r[c] != v:
                    mism += 1
                    if mism <= 5: bad.append(f"core {r['entity']} {r['period']} {c} {r[c]} != {v}")
            n_cmp += 1
            # partitions: six categories and the seven reasons sum to departures; two categories to hires
            if sum(r[f'sep_{c}'] for c in SEP_ORDER) != r['departures'] or sum(r[f'sep_{c}_nondrp'] for c in SEP_ORDER) + r['sep_drp'] != r['departures'] \
               or r['acc_transfer_in'] + r['acc_new_hire'] != r['hires']:
                mism += 1
                if mism <= 5: bad.append(f"core {r['entity']} {r['period']} categories do not partition")
    # rows begin at each entity's first month and end at its last (no rows before or after; spec section 1, D-018)
    ends, begins = {}, {}
    for k, (cols, rs) in core.items():
        ends[k] = max(r['period_last_month'] for r in rs)
        begins[k] = min(r['period'] for r in rs if r['grain'] == 'month')
    off = [k for k in ends if ends[k] != lastm.get(k)]
    if off: bad.append(f'{len(off)} entities whose rows do not end at their last month, e.g. {off[:3]}')
    off = [k for k in begins if begins[k] != firstm.get(k)]
    if off: bad.append(f'{len(off)} entities whose rows do not begin at their first month, e.g. {off[:3]}')
    ment = cube_meta('core')['entities']
    off = [k for k in core if ment.get(k, {}).get('first_month') != firstm.get(k) or ment.get(k, {}).get('last_month') != lastm.get(k)]
    if off: bad.append(f'{len(off)} entities whose meta first or last month differs, e.g. {off[:3]}')
    late = sorted(k for k in core if firstm.get(k) > months[0])
    # government = exact sum of departments, DOD = sum of its agencies, each department = sum of its subelements (month grain)
    def by_period(key):
        return {r['period']: r for r in core[key][1] if r['grain'] == 'month'} if key in core else {}
    gov = by_period('GOV')
    figs = ['headcount'] + [c for c in flows if c != 'los_tenths'] + ['years_of_service_lost']
    def sums(keys):
        out = {}
        for key in keys:
            for p, r in by_period(key).items():
                o = out.setdefault(p, {c: 0 for c in figs})
                for c in figs: o[c] += r[c]
        return out
    for parent, kids in [('GOV', [c for _, c in children['GOV']]), ('DOD', [c for l, c in children['DOD'] if l == 'agency'])] + \
                        [(d, [c for l, c in children[d] if l == 'subelement']) for d in sorted(children) if d != 'GOV']:
        s, pr = sums(kids), by_period(parent)
        diff = [p for p in pr if any(abs(s.get(p, {}).get(c, 0) - pr[p][c]) > 0.05 for c in figs)]
        if diff: bad.append(f'{parent} month rows differ from the sum of its {len(kids)} children in {len(diff)} months, e.g. {diff[:2]}')
    # compare: one row per child per fiscal year and the latest trailing 12 months, against the same recomputation
    latest = months[-1]
    cmp = cube_rows('compare')
    exp_parents = set(children)
    if set(cmp) != exp_parents: bad.append(f'compare parents {len(cmp)} != {len(exp_parents)}: {sorted(set(cmp) ^ exp_parents)[:4]}')
    n_c = 0
    for p, (cols, rs) in cmp.items():
        kids = children.get(p, set())
        want_keys = set()
        for lvl, c in kids:
            for (e, g, per), w in want.items():
                if e == c and g == 'fy': want_keys.add((lvl, c, 'fy', per))
            if lastm.get(c) == latest: want_keys.add((lvl, c, 't12', latest))
        got = {(r['child_level'], r['child'], r['grain'], r['period']) for r in rs}
        if got != want_keys: bad.append(f'compare {p}: {len(got - want_keys)} extra, {len(want_keys - got)} missing rows')
        for r in rs:
            if r['grain'] == 'fy':
                w = want.get((r['child'], 'fy', r['period'])); g = 'fy'
                if w is None: continue
                partial = w['n'] < 12
            else:
                w0 = want.get((r['child'], 'month', r['period']))
                if w0 is None: continue
                w = t12_row(w0, flows); g = 't12'; partial = w0['t_n'] < 12
            exp = expected_figures(w, g, flows)
            exp['partial'] = partial
            for c in cols:
                if c in exp and c not in ('years_of_service_lost', 'years_of_service_lost_coverage', 'net_flow') and not near(r[c], exp[c], 1e-3):
                    mism += 1
                    if mism <= 8: bad.append(f"compare {p} {r['child']} {r['grain']} {r['period']} {c} {r[c]} != {exp[c]}")
            n_c += 1
    gfy = [r for r in core['GOV'][1] if r['grain'] == 'fy'][-1]
    t12 = [r for r in cmp['GOV'][1] if r['grain'] == 't12']
    gov_a = next(r['attrition_a_num'] for r in core['GOV'][1] if r['grain'] == 'month' and r['period'] == latest)
    ended = sorted(k for k in ends if ends[k] < latest)
    return not bad, '; '.join(bad[:6]) + (f' ({mism} mismatches)' if mism > 6 else '') or (
        f"{sum(len(rs) for _, rs in core.values()):,} core rows ({len(core)} entities: GOV, {sum(1 for l, _ in children['GOV'])} departments, "
        f"4 DOD agencies, every subelement, {len(late)} beginning after {months[0]}, {len(ended)} ending before {latest}) and {n_c:,} compare rows ({len(cmp)} parents) = independent SQL "
        f"recomputation from emp_org_month and the action rows; every column declares a kind; incl. partial {gfy.get('period')} "
        f"({gfy.get('months_published')} of 12 months, headcount {gfy.get('headcount', 0):,}) and the trailing 12 months to {latest} "
        f"({len(t12)} departments in GOV compare, departures {sum(r['departures'] for r in t12):,}; GOV method A numerator {gov_a:,}); categories and the seven reasons partition; GOV = sum of departments, DOD = sum of "
        f"its agencies, each department = sum of its subelements, every month")


@check('coverage_columns', 'inv 4')
def _():
    bad, n, low = [], 0, None
    fields = {}
    for name in ('core', 'compare'):
        meta = cube_meta(name)
        dic = {d['name']: d for d in meta['columns']}
        for d in meta['columns']:
            for f in d.get('source_fields', []):
                if f not in fields:
                    fields[f] = rows(f"SELECT count(*) FILTER (WHERE {f} IS NULL OR {f}_redacted OR {los_issue_sql() if f == 'length_of_service_years' else 'false'}) FROM separation_rows")[0][0]
                if not fields[f] or d.get('coverage_part_of') or d.get('kind') == 'coverage': continue
                n += 1
                cov = d.get('coverage_column')
                if not cov or dic.get(cov, {}).get('kind') != 'coverage' or dic[cov].get('coverage_for') != d['name']:
                    bad.append(f"{name}.{d['name']} uses {f} ({fields[f]:,} unknown rows) without a coverage column")
    for k, (cols, rs) in cube_rows('core').items():
        for r in rs:
            if r['yos_known'] + r['yos_unknown_issue'] + r['yos_unknown_missing'] != r['departures']:
                bad.append(f"core {k} {r['period']} known + unknown != departures"); break
            want = round(r['yos_known'] / r['departures'], 4) if r['departures'] else None
            if r['years_of_service_lost_coverage'] != want:
                bad.append(f"core {k} {r['period']} coverage {r['years_of_service_lost_coverage']} != {want}"); break
            if want is not None and (low is None or want < low[0]): low = (want, k, r['period'])
    gov = {r['period']: r for r in cube_rows('core')['GOV'][1]}
    return not bad, '; '.join(bad[:5]) or (f"{n} figure(s) on partly unknown fields ({', '.join(f'{f} {v:,} unknown rows' for f, v in fields.items())}), "
        f"each with its coverage column; known + {'/'.join(los_ids('separations'))} + missing = departures on every core row "
        f"(accession-only length-of-service issues {'/'.join(sorted(set(los_ids('accessions')) - set(los_ids('separations')))) or 'none'} "
        f"are covered by the joining share denominators, breakdown_rollups); GOV FY2025 coverage "
        f"{gov['FY2025']['years_of_service_lost_coverage']}; lowest {low[0]} ({low[1]} {low[2]})")


def known_breaks_signed():
    path = 'pipeline/known_breaks.csv'
    if not os.path.exists(path): return None
    return csv_rows(path)


@check('reconciliation_fy', 'inv 7')
def _():
    """Government and department fiscal years, recomputed from emp_org_month and the action rows: gap = headcount
    change - net flow (FY2012 from Oct 2011 with flows from Nov 2011; an entity's first fiscal year from its first
    month, D-018, against headcount 0 the month before, with that month's flows; months without rows after the first
    count 0). D-009: fails when |gap| > 5% of average month-end headcount and > 20 people, unless the entity-year is on
    the signed list. A signed entity-year that is no longer over the rule is a warning, not a failure."""
    g = rows(f"""WITH hc AS (SELECT period AS m, department_code AS e, sum(headcount) AS h FROM emp_org_month GROUP BY ALL
                             UNION ALL SELECT period, 'GOV', sum(headcount) FROM emp_org_month GROUP BY ALL),
                      fl AS (SELECT effective_month AS m, department_code AS e, count(*) AS n, count(*) AS a FROM accession_rows GROUP BY ALL
                             UNION ALL SELECT effective_month, 'GOV', count(*), count(*) FROM accession_rows GROUP BY ALL
                             UNION ALL SELECT effective_month, department_code, -count(*), count(*) FROM separation_rows GROUP BY ALL
                             UNION ALL SELECT effective_month, 'GOV', -count(*), count(*) FROM separation_rows GROUP BY ALL),
                      net AS (SELECT m, e, sum(n) AS net, sum(a) AS acts FROM fl GROUP BY ALL),
                      mo AS (SELECT DISTINCT period AS m FROM emp_org_month),
                      ents AS (SELECT DISTINCT e FROM hc UNION SELECT DISTINCT e FROM net)
                 SELECT e, m, coalesce(h, 0), coalesce(net, 0), coalesce(acts, 0) FROM ents CROSS JOIN mo LEFT JOIN hc USING (e, m) LEFT JOIN net USING (e, m)
                 ORDER BY e, m""")
    ser = {}
    for e, m, h, n, a in g: ser.setdefault(e, []).append((m, h, n, a))
    over = {}
    for e, s0 in ser.items():
        f0 = next((i for i, x in enumerate(s0) if x[1] or x[3]), None)
        if f0 is None: continue
        s = [x[:3] for x in s0]
        fys = sorted({m.year + (m.month >= 10) for m, _, _ in s})
        for fy in fys:
            ix = [i for i, (m, _, _) in enumerate(s) if m.year + (m.month >= 10) == fy and i >= f0]
            if not ix: continue
            start = ix[0] if ix[0] == 0 else ix[0] - 1
            avg = sum(s[i][1] for i in ix) / len(ix)
            gap = (s[ix[-1]][1] - s[start][1]) - sum(s[i][2] for i in ix if i > start)
            if abs(gap) > 20 and (avg == 0 or abs(gap) > 0.05 * avg): over[(e, fy)] = gap
    cand = {(r['entity'], int(r['fiscal_year'])): int(r['gap']) for r in csv_rows(f'{CUBES}/known_breaks_candidates.csv')}
    bad = []
    if cand != over: bad.append(f'known_breaks_candidates.csv differs from the recomputation: {sorted(set(cand.items()) ^ set(over.items()))[:4]}')
    signed = known_breaks_signed()
    if signed is None: return False, 'pipeline/known_breaks.csv missing'
    if signed and list(signed[0]) != ['entity', 'fiscal_year', 'decision', 'cause']: bad.append(f'known_breaks.csv columns {list(signed[0])}')
    keys = [(r['entity'], r['fiscal_year']) for r in signed]
    if len(keys) != len(set(keys)): bad.append('known_breaks.csv repeats an entity-year')
    bad += [f"known_breaks.csv {r['entity']} FY{r['fiscal_year']} has no cause" for r in signed if not (r.get('cause') or '').strip()]
    decisions = set(re.findall(r'^## (D-\d+)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M)) if os.path.exists('ops/DECISIONS.md') else set()
    ok_signed = {(r['entity'], int(r['fiscal_year'])) for r in signed if r.get('decision') in decisions}
    bad += [f"known_breaks.csv {r['entity']} FY{r['fiscal_year']} cites {r.get('decision')!r}, not a decision" for r in signed
            if r.get('decision') not in decisions]
    unsigned = sorted(set(over) - ok_signed)
    by = {}
    for e, fy in unsigned: by[f'FY{fy}'] = by.get(f'FY{fy}', 0) + 1
    gov = [f'FY{fy}' for e, fy in unsigned if e == 'GOV']
    if unsigned:
        bad.insert(0, f"{len(unsigned)} entity-years over the D-009 rule are not on the signed known-breaks list "
                      f"({len(ok_signed)} signed; {len(unsigned) - len(gov)} department-years, government {', '.join(gov) or 'none'}; "
                      f"by year {', '.join(f'{k} {v}' for k, v in sorted(by.items()))}); candidates in {CUBES}/known_breaks_candidates.csv")
    stale = sorted(ok_signed - set(over))
    note = f'; WARNING {len(stale)} signed entity-year(s) no longer over the rule (not a failure): {stale}' if stale else ''
    return not bad, '; '.join(bad[:3]) + note or f'{len(over)} entity-years over the rule, all on the signed list{note}'


@check('provisional_and_revisions', 'inv 8')
def _():
    bad = []
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    months = sorted(EMP_FILES); prov = set(months[-3:]); vers = manifest_versions()
    bl = json.load(open(f'{CUBES}/revision_baseline.json'))
    if bl.get('versions') != vers: bad.append('revision baseline versions != manifest versions')
    prior = bl.get('prior_versions')
    reissued = {m for m, v in vers.items() if prior and m in prior and prior[m] != v}
    k6 = [k for k in kdi_rows() if k['status'] == 'active' and k['treatment'] == 'flagged_incomplete']
    def incomplete(e, m):
        dod = e in ('GOV', 'DOD') or e.startswith('DOD-') or cube_meta('core')['entities'].get(e, {}).get('parent', '').startswith('DOD-')
        return dod and (e, m) in present and any(k['first_file_month'] <= m <= (k['last_file_month'] or '9999') for k in k6)
    n, flagged_prov, flagged_inc = 0, set(), 0
    for name in ('core', 'compare'):
        for key, (cols, rs) in cube_rows(name).items():
            for r in rs:
                e = r['entity'] if name == 'core' else r['child']
                ms = months_of(r['grain'], r['period'], r['fiscal_year'], r.get('fiscal_quarter'), months, lastm.get(e), firstm.get(e))
                ids = set()
                for m in ms: ids |= kd.get((e, m), set())
                exp = {'provisional': any(m in prov for m in ms), 'reissued': any(m in reissued for m in ms),
                       'opm_incomplete': any(incomplete(e, m) for m in ms), 'kdi_ids': sorted(ids)}
                if name == 'core':
                    exp['file_version'] = [f"{m} e{vers[m]['employment']} a{vers[m]['accessions']} s{vers[m]['separations']}" for m in ms]
                for c, v in exp.items():
                    if r[c] != v:
                        bad.append(f"{name} {key} {e} {r['period']} {c} {r[c]} != {v}"); break
                if r['opm_incomplete'] != ('KDI-006' in r['kdi_ids']): bad.append(f"{name} {e} {r['period']} opm_incomplete disagrees with kdi_ids")
                if r['time_basis'] != 'effective': bad.append(f"{name} {e} {r['period']} time basis {r['time_basis']}")
                n += 1
                if r['provisional'] and e == 'GOV' and name == 'core': flagged_prov.add(r['period'])
                flagged_inc += bool(r['opm_incomplete'])
                if len(bad) > 5: break
    for name in ALL_CUBES:   # the breakdown cubes' period tables and admin rows are checked in breakdown_rollups, admin_comparison and appointments_partition
        meta = cube_meta(name)
        if meta.get('provisional_months') != sorted(prov) or meta.get('reissued_months') != sorted(reissued):
            bad.append(f'{name} meta provisional or reissued months differ')
    return not bad, '; '.join(bad[:5]) or (f"{n:,} rows: provisional = newest 3 months {sorted(prov)} (GOV core periods {sorted(flagged_prov)}); "
        f"baseline {'prior ' + str(bl.get('prior_manifest_sha256'))[:12] if prior else 'is this first build, no prior'}, {len(reissued)} reissued; "
        f"opm_incomplete (KDI-006) on {flagged_inc:,} rows; known data issue ids and file versions = recomputation on every row")


# ---- Phase 2b cubes: leaving, joining, admin, appointments (warehouse/cubes/, staged by pipeline/build_breakdowns.py) ----
# Recomputed without the cube code: band headcount from emp_dim_month (itself checked against raw in monthly_basis),
# action counts from the stored action rows with the gate's own band SQL (gate_bands), known-data-issue reading
# (los_id_sql) and the signed constants below, windows by SQL window functions and group-bys.
LEAVING_DIMS_SIGNED = ['age', 'los', 'supervisory', 'education', 'veteran', 'grade']   # spec section 9
JOINING_RATED_SIGNED = ['age', 'education', 'veteran', 'grade']                         # D-100 adapted: no occupation (D-014)
# D-100: prior federal service at hire (years of length of service, lower bound inclusive) and early-career programs,
# shown as shares of hires with a known value (no rate); pathways_group NULL = all other hires
PRIOR_SERVICE_SIGNED = [('lt1', 0, 1), ('1_4', 1, 5), ('5_9', 5, 10), ('10plus', 10, None)]
PATHWAYS_SIGNED = {'INTERN': 'intern_student', 'STUDENT TRAINEE': 'intern_student', 'RECENT GRAD': 'recent_grad', 'PMF': 'pmf'}
SHARE_VALUES = {'prior_service': [v for v, _, _ in PRIOR_SERVICE_SIGNED] + ['unknown'], 'pathways': ['intern_student', 'recent_grad', 'pmf', 'other']}
# spec section 2: administrations (month 1 = January of the inauguration year; month 0 = the month before)
ADMIN_SIGNED = [('obama2', '2013-01', '2016-12'), ('trump1', '2017-01', '2020-12'), ('biden', '2021-01', '2024-12'), ('trump2', '2025-01', None)]
ADMIN_GRAINS = ('admin', 'admin_n')


def iter_cube(name):
    """(key, file dict) for every file of a cube, one at a time (the breakdown cubes are too large to hold at once)."""
    for k, fi in cube_meta(name)['files'].items():
        yield k, json.load(open(f"{CUBES}/{fi['path']}"))


def band_value_lists():
    """{dimension: (values in order, unknown value)} from breakdown_bands.csv (the gate's band SQL reads it too)."""
    by = {}
    for r in sorted(csv_rows(f'{XW}/breakdown_bands.csv'), key=lambda r: int(r['value_order'])):
        by.setdefault(r['dimension'], ([], []))
        by[r['dimension']][0].append(r['value'])
        if r['rule'] == 'unknown': by[r['dimension']][1].append(r['value'])
    return {d: (v, u[0] if u else None) for d, (v, u) in by.items()}


def b_entities():
    """Breakdown entities (GOV, departments with rows, DOD agencies) with their spans, from the independent core
    recomputation: {key: (first YYYY-MM, last YYYY-MM)}."""
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    keys = ['GOV'] + sorted(c for _, c in children['GOV']) + sorted(c for l, c in children['DOD'] if l == 'agency')
    return {k: (firstm[k], lastm[k]) for k in keys if k in lastm}


def b_windows(span):
    """{(grain, period): (fiscal_year, first label, [published YYYY-MM], months_in_period, partial)} for one entity."""
    months = sorted(EMP_FILES)
    f, l = span
    inspan = [m for m in months if f <= m <= l]
    out = {}
    for fy in range(int(months[0][:4]) + (months[0][5:] >= '10'), int(months[-1][:4]) + (months[-1][5:] >= '10') + 1):
        cal = [f'{fy - 1}-{x:02d}' for x in (10, 11, 12)] + [f'{fy}-{x:02d}' for x in range(1, 10)]
        pub = [m for m in cal if m in inspan]
        if pub: out[('fy', f'FY{fy}')] = (fy, cal[0], pub, 12, len(pub) < 12)
    for i in range(11, len(inspan)):
        m = inspan[i]
        out[('t12', m)] = (int(m[:4]) + (m[5:] >= '10'), inspan[i - 11], inspan[i - 11: i + 1], 12, False)
    n_now = len([m for m in months if m >= ADMIN_SIGNED[-1][1]])
    for a, first, last in ADMIN_SIGNED:
        exp_full = [m for m in months if m >= first and (last is None or m <= last)]
        for g, exp in (('admin', exp_full), ('admin_n', exp_full[:n_now])):
            pub = [m for m in exp if m in inspan]
            if exp and pub: out[(g, a)] = (None, exp[0], pub, len(exp), last is None or len(pub) < len(exp))
    return out


def b_org_ids():
    """{(entity, YYYY-MM): set of entity-month KDI ids} for the breakdown entities (monthly_org_kdi keyed), and the
    ids of length-of-service values treated as unknown, per dataset."""
    if 'b_ids' in _CACHE: return _CACHE['b_ids']
    lv = lambda rel, cols: (f"SELECT 'GOV' AS e, {cols} FROM {rel} UNION ALL SELECT d, {cols} FROM {rel} "
                            f"UNION ALL SELECT 'DOD-' || a, {cols} FROM {rel} WHERE d = 'DOD'")
    org = {}
    for e, m, ids in rows(f"""WITH x AS (SELECT month AS m, department_code AS d, agency_code AS a, unnest(kdi_ids) AS id FROM monthly_org_kdi)
                              SELECT e, m, list(DISTINCT id) FROM ({lv('x', 'm, id')}) GROUP BY ALL"""):
        org[(e, fmt_ym(m))] = set(ids)
    los = {}
    for ds, t in (('separations', 'separation_rows'), ('accessions', 'accession_rows')):
        los[ds] = {}
        for e, m, i in rows(f"""WITH x AS (SELECT effective_month AS m, department_code AS d, agency_code AS a, {los_id_sql(ds)} AS id
                                          FROM {t} WHERE effective_month >= DATE '{FIRST_MONTH}')
                                SELECT DISTINCT e, m, id FROM ({lv('x', 'm, id')}) WHERE id IS NOT NULL"""):
            los[ds].setdefault((e, fmt_ym(m)), set()).add(i)
    _CACHE['b_ids'] = (org, los)
    return _CACHE['b_ids']


def b_period_expected(e, span, extra_ids):
    """Expected period table rows of one entity: {(grain, period): [values in the period table's column order]}."""
    months = sorted(EMP_FILES); prov = set(months[-3:])
    org, _ = b_org_ids()
    vers = manifest_versions(); prior = json.load(open(f'{CUBES}/revision_baseline.json')).get('prior_versions')
    reissued = {m for m, v in vers.items() if prior and m in prior and prior[m] != v}
    k6 = [k for k in kdi_rows() if k['status'] == 'active' and k['treatment'] == 'flagged_incomplete']
    dod = e in ('GOV', 'DOD') or e.startswith('DOD-')
    out = {}
    for (g, p), (fy, first, pub, n_in, partial) in b_windows(span).items():
        ids = set()
        for m in pub: ids |= org.get((e, m), set()) | (extra_ids.get((e, m), set()) if extra_ids else set())
        inc = dod and any(k['first_file_month'] <= m <= (k['last_file_month'] or '9999') for m in pub for k in k6)
        out[(g, p)] = [g, p, fy, first, pub[-1], n_in, len(pub), 'effective', any(m in prov for m in pub), partial,
                       any(m in reissued for m in pub), inc, sorted(ids)]
    return out


def b_window_rows(base, keycols, sums, h, spans, values):
    """SQL over a CTE text `base` giving kf(e, m, <keycols>, <sums>[, h]) monthly: every series (entity x value of
    `values`) made dense over the entity's span (months without rows count 0), then summed per fiscal year, trailing
    12 months (12 rows of the span ending at each month), administration and its first N months. Returns rows of
    (e, grain, period, <keycols>, <sums>, h at the window's last month, mean h, months, last month). Each grain runs as
    its own query (one UNION ALL of the four over the materialized CTEs was very slow in DuckDB 1.5)."""
    kc = ', '.join(keycols)
    sp = ', '.join(f"('{e}', DATE '{f}-01', DATE '{l}-01')" for e, (f, l) in spans.items())
    vl = ', '.join('(' + ', '.join(f"'{x}'" for x in v) + ')' for v in values)
    months = sorted(EMP_FILES)
    n_now = len([m for m in months if m >= ADMIN_SIGNED[-1][1]])
    adm = []
    for a, f, l in ADMIN_SIGNED:
        win = [m for m in months if m >= f and (l is None or m <= l)]
        adm.append(f"('{a}', DATE '{win[0]}-01', DATE '{win[-1]}-01', DATE '{win[:n_now][-1]}-01')")
    adm = ', '.join(adm)
    hx = 'coalesce(kf.h, 0)' if h else '0'
    ssum = ', '.join(f'sum({c}) AS {c}' for c in sums)
    sql = f"""WITH {base},
      sp(e, fm, lm) AS (VALUES {sp}), vals({kc}) AS (VALUES {vl}), an(id, af, al, aln) AS (VALUES {adm}),
      mo AS (SELECT DISTINCT period AS m FROM emp_org_month),
      dn AS MATERIALIZED (SELECT sp.e, mo.m, vals.* FROM sp JOIN mo ON mo.m BETWEEN sp.fm AND sp.lm CROSS JOIN vals),
      kfm AS MATERIALIZED (SELECT * FROM kf),
      g AS MATERIALIZED (SELECT dn.*, {', '.join(f'coalesce(kfm.{c}, 0) AS {c}' for c in sums)}, {hx.replace('kf.', 'kfm.')} AS h
            FROM dn LEFT JOIN kfm ON kfm.e = dn.e AND kfm.m = dn.m AND {' AND '.join(f'kfm.{c} = dn.{c}' for c in keycols)})
      SELECT e, 'fy' AS grain, 'FY' || year(m + INTERVAL 3 MONTH) AS period, {kc}, {ssum}, arg_max(h, m), avg(h), count(*), max(m)
        FROM g GROUP BY e, year(m + INTERVAL 3 MONTH), {kc}
      UNION ALL
      SELECT e, 't12', strftime(m, '%Y-%m'), {kc}, {', '.join(f'w_{c}' for c in sums)}, h, w_mean, w_cnt, m FROM (
             SELECT e, m, {kc}, h, {', '.join(f'sum({c}) OVER w AS w_{c}' for c in sums)}, avg(h) OVER w AS w_mean, count(*) OVER w AS w_cnt
             FROM g WINDOW w AS (PARTITION BY e, {kc} ORDER BY m ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)) WHERE w_cnt = 12
      UNION ALL
      SELECT e, 'admin', an.id, {kc}, {ssum}, arg_max(h, m), avg(h), count(*), max(m) FROM g JOIN an ON m BETWEEN an.af AND an.al GROUP BY e, an.id, {kc}
      UNION ALL
      SELECT e, 'admin_n', an.id, {kc}, {ssum}, arg_max(h, m), avg(h), count(*), max(m) FROM g JOIN an ON m BETWEEN an.af AND an.aln GROUP BY e, an.id, {kc}"""
    head, parts = sql.split('      SELECT e, \'fy\'', 1)
    parts = ("      SELECT e, 'fy'" + parts).split('      UNION ALL\n')
    out = []
    for q in parts:
        out += db().execute(head + q).fetchall()
    return out


def b_action_sql(kind):
    """CTE text kf(e, m, dim, v, n, <categories>[, drp], h): action counts per entity, month, dimension and value with
    the gate's own band SQL, plus band headcount from emp_dim_month."""
    bands, vals = gate_bands(), band_value_lists()
    leaving = kind == 'leaving'
    t, ds = ('separation_rows', 'separations') if leaving else ('accession_rows', 'accessions')
    rated = LEAVING_DIMS_SIGNED if leaving else JOINING_RATED_SIGNED
    cats = SEP_SIGNED if leaving else ACC_SIGNED
    order = SEP_ORDER if leaving else ['transfer_in', 'new_hire']
    pre = 'sep' if leaving else 'acc'
    dims = [f"CASE WHEN kdi_los THEN '{vals['los'][1]}' ELSE {bands['los']} END AS los" if d == 'los' else f'{bands[d]} AS {d}' for d in rated]
    if not leaving:
        ps = ' '.join(f"WHEN los_num >= {lo}" + (f" AND los_num < {hi}" if hi is not None else '') + f" THEN '{v}'" for v, lo, hi in PRIOR_SERVICE_SIGNED)
        dims.append(f"CASE WHEN kdi_los OR los_num IS NULL THEN 'unknown' {ps} ELSE 'unknown' END AS prior_service")
        pw = ' '.join(f"WHEN pathways_group = '{c}' THEN '{v}'" for c, v in PATHWAYS_SIGNED.items())
        dims.append(f"CASE WHEN pathways_group IS NULL THEN 'other' {pw} ELSE '__unlisted__' END AS pathways")
    names = rated + ([] if leaving else ['prior_service', 'pathways'])
    cat_sql = ''.join(f", count(*) FILTER (WHERE action_code IN {IN(cats[c])}) AS {pre}_{c}" for c in order)
    drp = ", count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp" if leaving else ''
    sums = ['n'] + [f'{pre}_{c}' for c in order] + (['sep_drp'] if leaving else [])
    lv = lambda rel, cols: (f"SELECT 'GOV' AS e, {cols} FROM {rel} UNION ALL SELECT d AS e, {cols} FROM {rel} "
                            f"UNION ALL SELECT 'DOD-' || a AS e, {cols} FROM {rel} WHERE d = 'DOD'")
    sc = ', '.join(sums)
    base = f"""x AS (SELECT *, {los_id_sql(ds)} IS NOT NULL AS kdi_los FROM {t} WHERE effective_month >= DATE '{FIRST_MONTH}'),
      y AS (SELECT * REPLACE (CAST(length_of_service_years AS VARCHAR) AS length_of_service_years), length_of_service_years AS los_num FROM x),
      b AS (SELECT effective_month AS m, department_code AS d, agency_code AS a, action_code{', drp_indicator' if leaving else ''}, {', '.join(dims)} FROM y),
      f AS ({' UNION ALL '.join(f"SELECT m, d, a, '{x}' AS dim, {x} AS v, count(*) AS n{cat_sql}{drp} FROM b GROUP BY ALL" for x in names)}),
      hc AS (SELECT period AS m, department_code AS d, agency_code AS a, dimension AS dim, value AS v, sum(headcount) AS h
             FROM emp_dim_month WHERE dimension IN {IN(rated)} GROUP BY ALL),
      c AS (SELECT m, d, a, dim, v, {', '.join(f'coalesce(f.{x}, 0) AS {x}' for x in sums)}, coalesce(hc.h, 0) AS h
            FROM f FULL JOIN hc USING (m, d, a, dim, v)),
      kf AS (SELECT e, m, dim, v, {', '.join(f'sum({x}) AS {x}' for x in sums + ['h'])} FROM ({lv('c', f'm, dim, v, {sc}, h')}) GROUP BY ALL)"""
    values = [(d, v) for d in rated for v in vals[d][0]] + ([] if leaving else [(d, v) for d in ('prior_service', 'pathways') for v in SHARE_VALUES[d]])
    unknown = {d: vals[d][1] for d in rated}
    if not leaving: unknown['prior_service'] = 'unknown'
    return base, sums, values, unknown


def b_expected_chunks(kind, chunk=30):
    """Recomputed leaving or joining figures, entity group by entity group (memory stays small): the monthly action
    and headcount cells are materialized once in a temp table, then windowed per group of entities. Returns (generator
    of ({entity: span}, {(entity, grain, period, dim, value): figures}), sums, unknown values, count of action cells
    whose value is outside the signed lists)."""
    base, sums, values, unknown = b_action_sql(kind)
    t = f'gate_kf_{kind}'
    t0 = time.time()
    db().execute(f'CREATE OR REPLACE TEMP TABLE {t} AS WITH {base} SELECT * FROM kf')
    if os.environ.get('GATE_MEM'): print(f'      {kind} cells materialized in {time.time() - t0:.1f}s', flush=True)
    unl = rows(f"SELECT count(*) FROM {t} WHERE v = '__unlisted__'")[0][0]
    spans = b_entities(); keys = list(spans)
    def gen():
        for i in range(0, len(keys), chunk):
            sub = {k: spans[k] for k in keys[i:i + chunk]}
            out = {}
            for r in b_window_rows(f'kf AS (SELECT * FROM {t} WHERE e IN {IN(sub)})', ['dim', 'v'], sums, True, sub, values):
                out[r[:5]] = r[5:]
            if os.environ.get('GATE_MEM'): print(f'      {kind} chunk {i} windowed at {time.time() - t0:.1f}s', flush=True)
            yield sub, out
        db().execute(f'DROP TABLE {t}')
    return gen(), sums, unknown, unl


def _window_months(p, months):
    """Published months of a period-table row: period_last_month back over months_published months (windows are contiguous)."""
    i = months.index(p[4])
    return months[i - p[6] + 1: i + 1]


@check('breakdown_rollups', 'inv 3')
def _():
    """leaving and joining: every column declares a kind; the row and period sets are those the entity spans imply;
    every figure (counts, categories, DRP, headcount, rate parts, shares, coverage) = an independent SQL recomputation;
    admin and appointments column kinds."""
    # memory (3 GB machine): drop cached raw recomputations and parsed core/compare rows that later checks reload if needed
    for key in [k for k in _CACHE if k in ('accessions', 'separations', 'rows_core', 'rows_compare') or k in EMP_FILES]:
        del _CACHE[key]
    import gc; gc.collect()
    bad, n, mism = [], 0, 0
    for name in BREAKDOWN_CUBES:
        meta = cube_meta(name)
        for part in ('columns', 'period_columns'):
            if part not in meta: continue
            bad += [f'{name}.{d["name"]} kind {d.get("kind")}' for d in meta[part] if d.get('kind') not in KINDS]
            bad += [f'{name}.{d["name"]} has no description' for d in meta[part] if not d.get('description')]
    spans = b_entities()
    _, los = b_org_ids()
    stats = {}
    for kind, ds in (('leaving', 'separations'), ('joining', 'accessions')):
        chunks, sums, unknown, unl = b_expected_chunks(kind)
        if unl: bad.append(f'{kind}: {unl} action cells with a value outside the signed lists')
        meta = cube_meta(kind)
        if set(meta['files']) != set(spans): bad.append(f'{kind} entities {len(meta["files"])} != {len(spans)}: {sorted(set(meta["files"]) ^ set(spans))[:4]}')
        cnt = 'departures' if kind == 'leaving' else 'hires'
        stats[kind] = 0
        for sub, exp in chunks:
          got_keys = set()
          for k in sub:
            if k not in meta['files']: continue
            d = json.load(open(f"{CUBES}/{meta['files'][k]['path']}"))
            cols, pcols = d['columns'], d['period_columns']
            if [c['name'] for c in meta['columns']] != cols or [c['name'] for c in meta['period_columns']] != pcols:
                bad.append(f'{kind} {k}: columns differ from the meta dictionary'); break
            pe = b_period_expected(k, spans[k], los[ds])
            pg = {(p[0], p[1]): p for p in d['periods']}
            if set(pg) != set(pe): bad.append(f'{kind} {k}: period set {len(pg)} != {len(pe)}')
            for key, want in pe.items():
                if key in pg and pg[key] != want:
                    mism += 1
                    if mism <= 5: bad.append(f'{kind} {k} period {key}: {pg[key]} != {want}')
            ci = {c: i for i, c in enumerate(cols)}
            grp = {}
            for r in d['rows']:
                key = (k, r[0], r[1], r[2], r[3]); got_keys.add(key)
                w = exp.get(key)
                if w is None: continue
                s = dict(zip(sums, w[:len(sums)])); h_last, mean_h, months_n = w[len(sums)], w[len(sums) + 1], w[len(sums) + 2]
                g = grp.setdefault((r[0], r[1], r[2]), [0, 0])
                g[0] += s['n']; g[1] += s['n'] if r[3] == unknown.get(r[2]) else 0
                share = r[2] in SHARE_VALUES
                want = {cnt: s['n'], **{c: s[c] for c in sums[1:]}, 'headcount': None if share else h_last}
                if share or r[3] == unknown.get(r[2]):
                    want.update(rate_num=None, rate_den=None, rate_months=None, rate_small_base=None, rate_not_applicable=None)
                elif mean_h == 0:
                    want.update(rate_num=None, rate_den=None, rate_months=months_n, rate_small_base=None, rate_not_applicable=True)
                else:
                    want.update(rate_num=s['n'] * 12 / months_n if r[0] in ADMIN_GRAINS else s['n'], rate_den=mean_h,
                                rate_months=months_n, rate_small_base=mean_h < SMALL_BASE, rate_not_applicable=False)
                for c, v in want.items():
                    if not near(r[ci[c]], v, 1e-3):
                        mism += 1
                        if mism <= 5: bad.append(f'{kind} {k} {r[0]} {r[1]} {r[2]}={r[3]} {c} {r[ci[c]]} != {v}')
                n += 1
            for r in d['rows']:   # coverage and share denominators from the recomputed group totals
                tot, unk = grp.get((r[0], r[1], r[2]), (None, None))
                if tot is None: continue
                if not near(r[ci['coverage']], round((tot - unk) / tot, 4) if tot else None, 1e-9):
                    mism += 1
                    if mism <= 5: bad.append(f"{kind} {k} {r[0]} {r[1]} {r[2]} coverage {r[ci['coverage']]} != {(tot - unk) / tot if tot else None}")
                if kind == 'joining':
                    sd = ((tot - unk) or None) if r[2] in SHARE_VALUES and r[3] != unknown.get(r[2]) else None
                    if r[ci['share_den']] != sd:
                        mism += 1
                        if mism <= 5: bad.append(f"{kind} {k} {r[0]} {r[1]} {r[2]}={r[3]} share_den {r[ci['share_den']]} != {sd}")
          miss = set(exp) - got_keys; extra = got_keys - set(exp)
          if miss or extra: bad.append(f'{kind} row set: {len(extra)} extra, {len(miss)} missing, e.g. {sorted(miss | extra)[:2]}')
          stats[kind] += len(got_keys)
    return not bad, '; '.join(bad[:6]) + (f' ({mism} mismatches)' if mism > 5 else '') or (
        f"{stats['leaving']:,} leaving and {stats['joining']:,} joining rows ({len(spans)} entities: GOV, departments, DOD agencies; "
        f"grains fy, t12, admin, admin_n) and their period tables = independent SQL recomputation from emp_dim_month and the "
        f"action rows (counts, categories, DRP, headcount, rate parts, shares, coverage); every column of the 4 cubes declares a kind")


@check('breakdown_partition', 'inv 4')
def _():
    """On every row group (entity, window, dimension) of leaving and joining: the values, unknown included, sum to the
    entity's departures or hires and (rated dimensions) to its headcount in the independent core recomputation; the
    categories partition each row's count; unknown values carry no rate, share dimensions no headcount and no rate."""
    bad, groups = [], 0
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    spans = b_entities()
    months = sorted(EMP_FILES)
    for kind in ('leaving', 'joining'):
        cnt = 'departures' if kind == 'leaving' else 'hires'
        cats = [f'sep_{c}' for c in SEP_ORDER] if kind == 'leaving' else ['acc_transfer_in', 'acc_new_hire']
        unknown = {d: u for d, (_, u) in band_value_lists().items()}; unknown['prior_service'] = 'unknown'
        for k, d in iter_cube(kind):
            ci = {c: i for i, c in enumerate(d['columns'])}
            per = {(p[0], p[1]): p for p in d['periods']}
            tot = {}
            for r in d['rows']:
                if sum(r[ci[c]] for c in cats) != r[ci[cnt]]: bad.append(f'{kind} {k} {r[0]} {r[1]} {r[2]}={r[3]}: categories do not sum to {cnt}')
                if kind == 'leaving' and r[ci['sep_drp']] > r[ci[cnt]]: bad.append(f'{kind} {k} {r[0]} {r[1]}: DRP above departures')
                is_unk, share = r[3] == unknown.get(r[2]), r[2] in SHARE_VALUES
                if (is_unk or share) and any(r[ci[c]] is not None for c in ('rate_num', 'rate_den', 'rate_small_base', 'rate_not_applicable')):
                    bad.append(f'{kind} {k} {r[0]} {r[1]} {r[2]}={r[3]}: a rate on an unknown or share value')
                if share and r[ci['headcount']] is not None: bad.append(f'{kind} {k} {r[2]}: headcount on a share dimension')
                t = tot.setdefault((r[0], r[1], r[2]), [0, 0])
                t[0] += r[ci[cnt]]; t[1] += r[ci['headcount']] or 0
            for (g, p, dim), (n, h) in tot.items():
                groups += 1
                pub = _window_months(per[(g, p)], months)
                wn = sum(want[(k, 'month', m)][cnt] for m in pub)
                wh = want[(k, 'month', pub[-1])]['h']
                if n != wn or (dim not in SHARE_VALUES and h != wh):
                    bad.append(f'{kind} {k} {g} {p} {dim}: values sum to {cnt} {n}, headcount {h}; entity {wn}, {wh}')
                if len(bad) > 8: break
    return not bad, '; '.join(bad[:6]) or (f'{groups:,} entity-window-dimension groups in leaving and joining: values, unknown included, '
        f'sum to the entity departures or hires and headcount of the independent core recomputation; categories partition every '
        f'row; unknown values and share dimensions carry no rate')



@check('admin_comparison', 'inv 7')
def _():
    """admin = recomputation from the independent core months for every administration (spec section 2) and entity:
    headcount at month 0 and N, employee change, running flows and the seven reasons, annualized rate parts, flags; an
    entity whose first month is after month 0 has no rows for that administration; rows stop at its last month."""
    bad, n, mism, skipped = [], 0, 0, 0
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    org, _ = b_org_ids()
    spans = b_entities()
    months = sorted(EMP_FILES); prov = set(months[-3:])
    k6 = [k for k in kdi_rows() if k['status'] == 'active' and k['treatment'] == 'flagged_incomplete']
    vers = manifest_versions(); prior = json.load(open(f'{CUBES}/revision_baseline.json')).get('prior_versions')
    reissued = {m for m, v in vers.items() if prior and m in prior and prior[m] != v}
    meta = cube_meta('admin')
    if set(meta['files']) != set(spans): bad.append(f'admin entities differ: {sorted(set(meta["files"]) ^ set(spans))[:4]}')
    if [d['name'] for d in meta['columns']][:1] != ['administration']: bad.append('admin columns')
    run_cols = ['hires', 'departures'] + [f'sep_{c}' for c in SEP_ORDER] + ['sep_drp'] + [f'sep_{c}_nondrp' for c in SEP_ORDER] + ['acc_transfer_in', 'acc_new_hire']
    reasons_ok = 0
    for k, d in iter_cube('admin'):
        cols = d['columns']
        got = {(r[0], r[1]): dict(zip(cols, r)) for r in d['rows']}
        exp_keys = set()
        f, l = spans[k]
        dod = k in ('GOV', 'DOD') or k.startswith('DOD-')
        for a, first, last in ADMIN_SIGNED:
            win = [m for m in months if m >= first and (last is None or m <= last)]
            m0 = months[months.index(win[0]) - 1]
            if f > m0:
                skipped += 1; continue
            pub = [m for m in win if m <= l]
            run = {c: 0 for c in run_cols}; hs = 0; ids = set(org.get((k, m0), set()))
            for i, m in enumerate(pub, 1):
                w = want[(k, 'month', m)]
                for c in run_cols: run[c] += w[c]
                hs += w['h']; ids |= org.get((k, m), set())
                den = hs / i
                h0 = want[(k, 'month', m0)]['h']
                e = {'months_in_office': i, 'admin_months': len(pub), 'month_0': m0, 'month_n': m, 'time_basis': 'effective',
                     'provisional': any(x in prov for x in pub[:i]), 'partial': last is None or len(pub) < len(win),
                     'reissued': any(x in reissued for x in [m0] + pub[:i]),
                     'opm_incomplete': dod and any(kk['first_file_month'] <= x <= (kk['last_file_month'] or '9999') for x in [m0] + pub[:i] for kk in k6),
                     'kdi_ids': sorted(ids), 'headcount_0': h0, 'headcount_n': w['h'], 'headcount_change': w['h'] - h0, **run,
                     'attrition_num': None if den == 0 else run['departures'] * 12 / i, 'hire_num': None if den == 0 else run['hires'] * 12 / i,
                     'rate_den': None if den == 0 else den, 'rate_months': i, 'rate_small_base': None if den == 0 else den < SMALL_BASE}
                exp_keys.add((a, i))
                r = got.get((a, i))
                if r is None: continue
                for c, v in e.items():
                    if not near(r[c], v, 1e-3):
                        mism += 1
                        if mism <= 5: bad.append(f'admin {k} {a} N={i} {c} {r[c]} != {v}')
                if sum(r[f'sep_{c}_nondrp'] for c in SEP_ORDER) + r['sep_drp'] == r['departures']: reasons_ok += 1
                else: bad.append(f'admin {k} {a} N={i}: the seven reasons do not sum to departures')
                n += 1
        if set(got) != exp_keys: bad.append(f'admin {k}: {len(set(got) - exp_keys)} extra, {len(exp_keys - set(got))} missing rows')
    skip_meta = sum(len(v) for v in meta.get('entities_without_comparison', {}).values())
    if skip_meta != skipped: bad.append(f'meta lists {skip_meta} entity-administrations without comparison, recomputation {skipped}')
    gd = json.load(open(f'{CUBES}/admin/GOV.json'))
    g = {(r[0], r[1]): dict(zip(gd['columns'], r)) for r in gd['rows']}
    t2 = max((x for x in g if x[0] == 'trump2'), key=lambda x: x[1], default=None)
    note = f"; GOV trump2 N={t2[1]}: change {g[t2]['headcount_change']:+,} from {g[t2]['headcount_0']:,}" if t2 else ''
    return not bad, '; '.join(bad[:6]) + (f' ({mism} mismatches)' if mism > 5 else '') or (
        f'{n:,} admin rows ({len(spans)} entities x 4 administrations x months in office) = recomputation from the independent '
        f'core months; seven reasons sum to departures on {reasons_ok:,} rows; {skipped} entity-administrations without a '
        f'month 0 have no rows{note}')


# docs/cube-plan.md amendment 1 (signed 2026-10-15): the matrix holds, for every department and DOD agency, the admin
# rows of these columns, in this order, copied unchanged
MATRIX_COLUMNS_SIGNED = ['entity', 'administration', 'months_in_office', 'headcount_0', 'headcount_change', 'departures',
                         'sep_drp', 'hire_num', 'attrition_num', 'rate_den', 'rate_small_base', 'provisional',
                         'opm_incomplete', 'kdi_ids']


@check('matrix_matches_admin', 'cube plan A1')
def _():
    """matrix = the admin cube rows of every department and DOD agency (not GOV, not subelements), every column equal
    for the same entity, administration and month in office; nothing missing, nothing extra; under the per-file cap;
    the file's bytes equal the gate's own serialization of the admin rows (a rebuild is byte-identical)."""
    bad, mism = [], 0
    meta, am = cube_meta('matrix'), cube_meta('admin')
    spans = b_entities()
    ents = [k for k in am['files'] if k != 'GOV']
    lev = {k: am['entities'][k]['level'] for k in am['files']}
    if sorted(ents) != sorted(k for k in spans if k != 'GOV'): bad.append('admin entities other than GOV differ from the departments and DOD agencies')
    if any(lev[k] not in ('department', 'agency') for k in ents): bad.append('a matrix entity is not a department or DOD agency')
    if list(meta['files']) != ['matrix']: bad.append(f"matrix meta lists files {list(meta['files'])}")
    fi = meta['files'].get('matrix', {}); p = f"{CUBES}/{fi.get('path')}"
    raw_bytes = open(p, 'rb').read()
    d = json.loads(raw_bytes)
    if d.get('columns') != MATRIX_COLUMNS_SIGNED: bad.append(f"matrix columns {d.get('columns')} != signed")
    if [c['name'] for c in meta['columns']] != MATRIX_COLUMNS_SIGNED: bad.append('matrix meta columns != signed')
    acol = {c['name']: c for c in am['columns']}
    for c in meta['columns']:
        if c['kind'] not in KINDS: bad.append(f"matrix column {c['name']} kind {c['kind']}")
        if c['name'] != 'entity' and c != acol.get(c['name']): bad.append(f"matrix column {c['name']} declared differently from admin")
    for k in ('manifest_sha256', 'provisional_months', 'reissued_months', 'known_data_issues', 'administrations', 'small_base_threshold'):
        if meta.get(k) != am.get(k): bad.append(f'matrix meta {k} differs from admin meta')
    if meta.get('source', {}).get('files_sha256') != am['files_sha256']: bad.append('matrix meta source is not the current admin cube')
    ewc = {k: v for k, v in am.get('entities_without_comparison', {}).items() if k in ents}
    if meta.get('entities_without_comparison') != ewc: bad.append('matrix entities_without_comparison differs from admin')
    got = {}
    for r in d['rows']:
        key = (r[0], r[1], r[2])
        if key in got: bad.append(f'matrix duplicate row {key}')
        got[key] = r
    want_rows, n, skipped = [], 0, 0
    for k in ents:
        a = json.load(open(f"{CUBES}/{am['files'][k]['path']}"))
        ix = [a['columns'].index(c) for c in MATRIX_COLUMNS_SIGNED[1:]]
        have = {r[0] for r in a['rows']}
        for adm in ewc.get(k, []):
            skipped += 1
            if adm in have: bad.append(f'admin {k} has rows for {adm}, listed without comparison')
        for r in a['rows']:
            e = [k] + [r[i] for i in ix]
            want_rows.append(e)
            m = got.pop((k, r[0], r[1]), None)
            if m is None:
                mism += 1
                if mism <= 5: bad.append(f'matrix lacks {k} {r[0]} N={r[1]}')
                continue
            n += 1
            for c, x, y in zip(MATRIX_COLUMNS_SIGNED, m, e):
                if x != y or type(x) is not type(y):
                    mism += 1
                    if mism <= 5: bad.append(f'matrix {k} {r[0]} N={r[1]} {c} {x!r} != admin {y!r}')
    if got: bad.append(f'matrix holds {len(got)} rows not in admin, e.g. {sorted(got)[:2]}')
    if (json.dumps({'cube': 'matrix', 'columns': MATRIX_COLUMNS_SIGNED, 'rows': want_rows}, separators=(',', ':'), ensure_ascii=False) + '\n').encode() != raw_bytes:
        bad.append('matrix bytes differ from the serialization of the admin rows (not a deterministic copy)')
    if len(raw_bytes) > CUBE_FILE_MAX: bad.append(f'matrix {len(raw_bytes):,} B > {CUBE_FILE_MAX:,}')
    dj = next((r for r in d['rows'] if r[0] == 'DJ' and r[1] == 'trump2' and r[2] == 20), None)
    note = (f"; DJ trump2 N=20: headcount_0 {dj[3]:,}, change {dj[4]:+,}, departures {dj[5]:,}, DRP {dj[6]:,}") if dj else ''
    return not bad, '; '.join(bad[:6]) + (f' ({mism} mismatches)' if mism > 5 else '') or (
        f"{n:,} matrix rows ({len(ents)} entities: departments and DOD agencies) = the admin rows on all {len(MATRIX_COLUMNS_SIGNED)} "
        f"columns (values and types); none missing, none extra; {skipped} entity-administrations without comparison have no rows; "
        f"bytes = the gate's own serialization of the admin rows; {len(raw_bytes):,} B (cap {CUBE_FILE_MAX:,}){note}")


@check('appointments_partition', 'inv 5')
def _():
    """appointments = recomputation from the action rows with the signed code-to-group constant: groups (unknown
    included) partition 'all', the political subgroups partition political, and 'all' = the entity's hires and
    departures in the independent core recomputation, at fy, t12 and admin grain."""
    bad, n, mism = [], 0, 0
    want, lastm, children, kd, present, flows, firstm = independent_cubes()
    spans = b_entities()
    months = sorted(EMP_FILES)
    org, _ = b_org_ids()
    grp = lambda col: 'CASE ' + ' '.join(f"WHEN {col} = '{c}' THEN '{g}'" for c, (g, _) in APPT_SIGNED.items()) + " ELSE '__unmapped__' END"
    sub = lambda col: 'CASE ' + ' '.join(f"WHEN {col} = '{c}' THEN '{s}'" for c, (_, s) in APPT_SIGNED.items() if s) + ' ELSE NULL END'
    lv = lambda rel, cols: (f"SELECT 'GOV' AS e, {cols} FROM {rel} UNION ALL SELECT d AS e, {cols} FROM {rel} "
                            f"UNION ALL SELECT 'DOD-' || a AS e, {cols} FROM {rel} WHERE d = 'DOD'")
    base = f"""x AS (SELECT m, d, a, c, sum(hi) AS hi, sum(de) AS de FROM (
                     SELECT effective_month AS m, department_code AS d, agency_code AS a, appointment_type_code AS c, 1 AS hi, 0 AS de
                     FROM accession_rows WHERE effective_month >= DATE '{FIRST_MONTH}'
                     UNION ALL SELECT effective_month, department_code, agency_code, appointment_type_code, 0, 1
                     FROM separation_rows WHERE effective_month >= DATE '{FIRST_MONTH}') GROUP BY ALL),
      y AS (SELECT m, d, a, 'all' AS grp, hi, de FROM x UNION ALL SELECT m, d, a, {grp('c')}, hi, de FROM x
            UNION ALL SELECT m, d, a, {sub('c')}, hi, de FROM x WHERE {sub('c')} IS NOT NULL),
      kf AS (SELECT e, m, grp, sum(hi) AS hires, sum(de) AS departures FROM ({lv('y', 'm, grp, hi, de')}) GROUP BY ALL)"""
    gids = ['all'] + sorted({g for g, _ in APPT_SIGNED.values()}) + sorted({s for _, s in APPT_SIGNED.values() if s})
    unmapped = rows(f"SELECT count(*) FROM (SELECT appointment_type_code AS c FROM accession_rows UNION ALL SELECT appointment_type_code "
                    f"FROM separation_rows) WHERE c IS NULL OR c NOT IN {IN(APPT_SIGNED)}")[0][0]
    if unmapped: bad.append(f'{unmapped} action rows with an appointment code outside the signed mapping')
    exp = {}
    for r in b_window_rows(base, ['grp'], ['hires', 'departures'], False, spans, [(g,) for g in gids]):
        if r[1] != 'admin_n': exp[(r[0], r[1], r[2], r[3])] = r[4:6]
    parent = {g: 'all' for g, _ in APPT_SIGNED.values()}
    parent.update({s: g for g, s in APPT_SIGNED.values() if s})
    meta = cube_meta('appointments')
    ml = {x['id']: x for x in meta['groups']['list']}
    if set(ml) != set(gids) or any(ml[g]['parent'] != parent.get(g) for g in ml if g != 'all'):
        bad.append(f'meta groups {sorted(ml)} differ from the signed groups')
    got_keys = set()
    for k, d in iter_cube('appointments'):
        cols = d['columns']; ci = {c: i for i, c in enumerate(cols)}
        pe = {key: v for key, v in b_period_expected(k, spans[k], None).items() if key[0] != 'admin_n'}
        pg = {(p[0], p[1]): p for p in d['periods']}
        if pg != {key: v for key, v in pe.items()}: bad.append(f'appointments {k}: period table differs from recomputation')
        sums = {}
        for r in d['rows']:
            key = (k, r[ci['grain']], r[ci['period']], r[ci['appt_group']]); got_keys.add(key)
            w = exp.get(key, (0, 0))
            if (r[ci['hires']], r[ci['departures']]) != tuple(w):
                mism += 1
                if mism <= 5: bad.append(f'appointments {k} {key[1:]} {r[ci["hires"]]}/{r[ci["departures"]]} != {w}')
            if r[ci['appt_group']] != 'all':
                p = parent.get(r[ci['appt_group']])
                s = sums.setdefault((key[1], key[2], p), [0, 0])
                s[0] += r[ci['hires']]; s[1] += r[ci['departures']]
            n += 1
        byg = {(r[ci['grain']], r[ci['period']], r[ci['appt_group']]): (r[ci['hires']], r[ci['departures']]) for r in d['rows']}
        for (g, p, par), s in sums.items():
            if tuple(s) != byg.get((g, p, par)): bad.append(f'appointments {k} {g} {p}: children of {par} sum to {s}, not {byg.get((g, p, par))}')
        for (g, p, gr), (h, dp) in byg.items():
            if gr != 'all': continue
            ms = _window_months(pg[(g, p)], months)
            if (h, dp) != (sum(want[(k, 'month', m)]['hires'] for m in ms), sum(want[(k, 'month', m)]['departures'] for m in ms)):
                bad.append(f'appointments {k} {g} {p}: all != the entity hires and departures')
        if len(bad) > 8: break
    want_keys = set(exp)
    if got_keys != want_keys: bad.append(f'appointments row set: {len(got_keys - want_keys)} extra, {len(want_keys - got_keys)} missing')
    return not bad, '; '.join(bad[:6]) + (f' ({mism} mismatches)' if mism > 5 else '') or (
        f'{n:,} appointments rows ({len(spans)} entities, fy, t12 and admin) = recomputation from the action rows with the signed '
        f'code-to-group mapping; groups partition all, subgroups partition political, all = the entity hires and departures')


def breakdown_rate_scan():
    """Rates in leaving, joining and admin (part of small_base_flags): a rate has a positive denominator and the
    small-base flag is exactly rate_den < 30; an empty rate carries no numerator and no flag; a structural zero is never
    flagged small."""
    bad, n, flagged, na = [], 0, {}, 0
    for name in ('leaving', 'joining', 'admin'):
        nums = ['rate_num'] if name != 'admin' else ['attrition_num', 'hire_num']
        for k, d in iter_cube(name):
            ci = {c: i for i, c in enumerate(d['columns'])}
            for r in d['rows']:
                den, flag = r[ci['rate_den']], r[ci['rate_small_base']]
                if den is None:
                    if any(r[ci[x]] is not None for x in nums) or flag is not None: bad.append(f'{name} {k} {r[:4]}: numerator or flag without denominator')
                    if name != 'admin' and r[ci['rate_not_applicable']]: na += 1
                    continue
                n += 1
                if den <= 0: bad.append(f'{name} {k} {r[:4]}: rate_den {den} (never 0)')
                if flag != (den < SMALL_BASE): bad.append(f'{name} {k} {r[:4]}: small base {flag} with den {den}')
                if name != 'admin' and r[ci['rate_not_applicable']] is not False: bad.append(f'{name} {k} {r[:4]}: a rate marked not applicable')
                if flag: flagged[name] = flagged.get(name, 0) + 1
                if len(bad) > 5: break
    return bad, n, flagged, na


@check('small_base_flags', 'inv 9')
def _():
    bad, n, flagged, empty = [], 0, {}, 0
    for name in ('core', 'compare'):
        cols = [d['name'] for d in cube_meta(name)['columns']]
        for m in 'abc':
            nums, den, mo, flag = [f'attrition_{m}_num', f'hire_{m}_num'], f'rate_{m}_den', f'rate_{m}_months', f'rate_{m}_small_base'
            if not all(c in cols for c in nums + [den, mo, flag]): bad.append(f'{name} method {m} lacks a rate column'); continue
            for key, d0 in iter_cube(name):   # one file at a time (memory)
                for r in (dict(zip(d0['columns'], x)) for x in d0['rows']):
                    if r[den] is None:
                        if any(r[x] is not None for x in nums) or r[flag] is not None: bad.append(f'{name} {key} {r["period"]} method {m}: numerator or flag without denominator')
                        if r[mo] is not None: empty += 1
                        continue
                    n += 1
                    if r[den] <= 0: bad.append(f'{name} {key} {r["period"]} {den} = {r[den]} (never 0)')
                    if r[flag] != (r[den] < SMALL_BASE): bad.append(f'{name} {key} {r["period"]} {flag} {r[flag]} with den {r[den]}')
                    if r[flag]: flagged[f'{name} {m.upper()}'] = flagged.get(f'{name} {m.upper()}', 0) + 1
                    if len(bad) > 5: break
    b2, n2, f2, na = breakdown_rate_scan()
    bad += b2; n += n2; flagged.update(f2)
    return not bad, '; '.join(bad[:5]) or (f'{n:,} rates scanned in core, compare, leaving, joining and admin, none on a zero denominator '
        f'({empty:,} empty core and compare rates where the mean headcount is 0; {na:,} leaving and joining structural zeros, not '
        f'applicable and unflagged); small base (< {SMALL_BASE}) flagged: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(flagged.items())))


@check('cube_size', 'cube plan 3')
def _():
    bad, tot, big = [], 0, {}
    for name in ALL_CUBES:
        for k, fi in cube_meta(name)['files'].items():
            s = os.path.getsize(f"{CUBES}/{fi['path']}"); tot += s
            if s > CUBE_FILE_MAX: bad.append(f"{fi['path']} {s:,} B > {CUBE_FILE_MAX:,}")
            if s > big.get(name, ('', 0))[1]: big[name] = (fi['path'], s)
    first = sum(os.path.getsize(f'{CUBES}/{c}/GOV.json') for c in ('core', 'compare', 'leaving'))
    if first > FIRST_LOAD_MAX: bad.append(f'GOV first load {first:,} B > {FIRST_LOAD_MAX:,}')
    return not bad, '; '.join(bad[:5]) or (f"every file under {CUBE_FILE_MAX:,} B (largest: " + ', '.join(f'{p} {b:,}' for p, b in big.values())
        + f"); GOV first load (core + compare + leaving) {first:,} B; all cube files {tot:,} B")


# ---- invariant 10: the Look-Up republishes OPM's release, never more ----
LOOKUP = 'warehouse/lookup'
LOOKUP_MAX = 100_000_000
LOOKUP_ENCODINGS = {'PLAIN', 'PLAIN_DICTIONARY', 'RLE_DICTIONARY', 'RLE', 'BIT_PACKED'}
LOOKUP_PERIOD = "regexp_extract(filename, '_([0-9]{6})_[0-9]+[.]parquet$', 1)"   # the source file's month, YYYYMM


def lookup_spec_fields():
    """{dataset: [columns]} parsed from docs/metric-spec.md section 10: the departures list as written, hires and
    employees by the rules the section states; each list's length must equal the count the section gives."""
    sec = open('docs/metric-spec.md', encoding='utf-8').read().split('## 10. Look-Up', 1)[1].split('\n## ', 1)[0]
    flat = ' '.join(sec.split())
    m = re.search(r'- Departures \((\d+)\): (.+?)\. - Hires \((\d+)\): (.+?)\. - Employees \((\d+)\): (.+?)\.', flat)
    if not m: raise ValueError('spec section 10 field lists not found')
    dep = [re.sub(r'\s*\(.*?\)', '', c).strip() for c in re.sub(r'\([^)]*\)', '', m.group(2)).split(',')]
    if m.group(4) != 'the same without drp_indicator, with accession_category in place of separation_category':
        raise ValueError(f'spec hires rule changed: {m.group(4)!r}')
    hires = [('accession_category' if c == 'separation_category' else c) for c in dep if c != 'drp_indicator']
    if m.group(6) != 'snapshot_yyyymm, the six organization fields and the 14 fields from occupational_series_code to duty_station_state above':
        raise ValueError(f'spec employees rule changed: {m.group(6)!r}')
    emp = ['snapshot_yyyymm'] + dep[:6] + dep[dep.index('occupational_series_code'):dep.index('duty_station_state') + 1]
    out = {'separations': dep, 'accessions': hires, 'employment': emp}
    for ds, n in zip(out, (m.group(1), m.group(3), m.group(5))):
        if len(out[ds]) != int(n): raise ValueError(f'spec section 10 {ds}: {len(out[ds])} fields listed, the section says {n}')
    return out


def lookup_plan():
    """{file name: (dataset, where-clause over the raw rows)}, recomputed from the raw files: one file per effective
    fiscal year of each action dataset (before Oct 2011 in before_FY2012), one per published department of the latest
    employment month (missing or 'No Data Reported' department in NOT_REPORTED)."""
    out = {}
    fy = ("(CAST(substr(personnel_action_effective_date_yyyymm, 1, 4) AS INTEGER) "
          "+ CAST(CAST(substr(personnel_action_effective_date_yyyymm, 5, 2) AS INTEGER) >= 10 AS INTEGER))")
    for ds in ('separations', 'accessions'):
        for (y,) in rows(f"SELECT DISTINCT {fy} FROM {raw(ds)}"):
            name = f'{ds}_FY{y}' if y >= 2012 else f'{ds}_before_FY2012'
            out[name] = (ds, f'{fy} = {y}' if y >= 2012 else f'{fy} < 2012')
    bad_d = "(department_code IS NULL OR trim(department_code) = '' OR upper(department_code) = 'NO DATA REPORTED')"
    for (d,) in rows(f"SELECT DISTINCT CASE WHEN {bad_d} THEN 'NOT_REPORTED' ELSE department_code END FROM read_parquet('{EMP_FILES[LATEST]}')"):
        out[f'employment_latest_{d}'] = ('employment', f"{bad_d}" if d == 'NOT_REPORTED' else f"NOT {bad_d} AND department_code = '{d}'")
    return out


def lookup_los_issue_sql(ds):
    """Length-of-service issue id (treatment unknown) of a Look-Up action row, from the CSV: period (file month),
    entity and value range on the published text; lowest id first. NULL outside every issue."""
    whens = []
    for k in sorted(kdi_rows(), key=lambda k: k['id']):
        if not (k['status'] == 'active' and k['dataset'] == ds and k['field'] == 'length_of_service_years' and k['treatment'] == 'unknown'): continue
        v = 'TRY_CAST(length_of_service_years AS DOUBLE)'
        ents = [e for e in k['entities'].split(';') if e]
        whens.append(f"WHEN period BETWEEN '{k['first_file_month'].replace('-', '')}' AND '{(k['last_file_month'] or '9999-12').replace('-', '')}'"
                     + (f" AND {v} >= {float(k['value_min'])}" if k['value_min'] else '') + (f" AND {v} <= {float(k['value_max'])}" if k['value_max'] else '')
                     + (f" AND department_code IN {IN(ents)}" if ents else '') + f" THEN '{k['id']}'")
    return '(CASE ' + ' '.join(whens) + ' END)' if whens else '(NULL)'


@check('lookup_allowlist_and_size', 'inv 10')
def _():
    import hashlib
    bad = []
    mpath = f'{LOOKUP}/lookup.meta.json'
    if not os.path.exists(mpath): return False, f'{mpath} missing (run pipeline/build_lookup.py)'
    meta = json.load(open(mpath))
    spec = lookup_spec_fields()
    flds = {}
    for r in csv_rows(f'{XW}/lookup_fields.csv'):
        flds.setdefault(r['dataset'], []).append((int(r['order']), r['lookup_column'], r['opm_source_column']))
    flds = {d: [(c, s_) for _, c, s_ in sorted(v)] for d, v in flds.items()}
    if set(flds) != set(spec): bad.append(f'lookup_fields.csv datasets {sorted(flds)} != spec section 10 {sorted(spec)}')
    for ds, want in spec.items():
        got = [c for c, _ in flds.get(ds, [])]
        if got != want: bad.append(f'lookup_fields.csv {ds} {got} != spec section 10 {want}')
        bad += [f'lookup_fields.csv {ds}.{c} source {s_}' for c, s_ in flds.get(ds, []) if s_ != ('FILE_MONTH' if c == 'period' else c)]
    if meta.get('fields') != spec: bad.append('meta fields != spec section 10')
    h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    plan = lookup_plan()
    on_disk = {f[:-8] for f in os.listdir(LOOKUP) if f.endswith('.parquet')}
    other = sorted(f for f in os.listdir(LOOKUP) if not f.endswith('.parquet') and f != 'lookup.meta.json')
    if on_disk != set(plan): bad.append(f'files on disk differ from the plan: {sorted(on_disk ^ set(plan))[:4]}')
    if set(meta.get('files', {})) != set(plan): bad.append(f"meta lists {sorted(set(meta.get('files', {})) ^ set(plan))[:4]} unlike the plan")
    bad += [f'unexpected file {LOOKUP}/{f}' for f in other]
    if meta.get('complete') is not True: bad.append('meta says the build is incomplete')
    if meta.get('fields_file', {}).get('sha256') != h(f'{XW}/lookup_fields.csv'): bad.append('meta built from a different lookup_fields.csv')
    # every file: allow-list columns in order, all VARCHAR, plain Parquet v1 + ZSTD, no key-value metadata, under 100 MB
    sizes = {}
    for name in sorted(on_disk & set(plan)):
        ds = plan[name][0]; path = f'{LOOKUP}/{name}.parquet'; fi = meta.get('files', {}).get(name, {})
        sizes[name] = os.path.getsize(path)
        if sizes[name] >= LOOKUP_MAX: bad.append(f'{name}.parquet {sizes[name] / 1e6:.1f} MB is not under 100 MB')
        sch = rows(f"SELECT name, type, converted_type FROM parquet_schema('{path}') WHERE name <> 'duckdb_schema' AND num_children IS NULL")
        if [r[0] for r in sch] != spec[ds]: bad.append(f'{name} columns {[r[0] for r in sch]} != spec section 10'); continue
        if any(r[1] != 'BYTE_ARRAY' or r[2] != 'UTF8' for r in sch): bad.append(f'{name} has non-VARCHAR columns')
        pm = rows(f"SELECT list(DISTINCT compression), list(DISTINCT encodings), count(*) FILTER (WHERE bloom_filter_offset IS NOT NULL) FROM parquet_metadata('{path}')")[0]
        encs = {e.strip() for x in pm[1] for e in x.split(',')}
        fv = rows(f"SELECT format_version FROM parquet_file_metadata('{path}')")[0][0]
        if set(pm[0]) != {'ZSTD'} or not encs <= LOOKUP_ENCODINGS or pm[2] or fv != 1:
            bad.append(f'{name} is not plain Parquet v1 + ZSTD (compression {pm[0]}, encodings {sorted(encs)}, bloom {pm[2]}, format {fv})')
        if rows(f"SELECT count(*) FROM parquet_kv_metadata('{path}')")[0][0]: bad.append(f'{name} carries key-value metadata')
        if fi.get('sha256') != h(path) or fi.get('bytes') != sizes[name] or fi.get('path') != f'lookup/{name}.parquet': bad.append(f'{name} sha256, size or path differs from the meta')
    # one-to-one with the raw rows: EXCEPT ALL empty both ways for every file, and row, REDACTED and NULL counts equal
    # per source month for each dataset (all action files; the latest employment month in full)
    n_rows = {}
    for ds in ('separations', 'accessions', 'employment'):
        cols = spec[ds]
        sel = ', '.join(f'{LOOKUP_PERIOD} AS period' if c == 'period' else c for c in cols)
        src = raw(ds) if ds != 'employment' else f"read_parquet('{EMP_FILES[LATEST]}', filename=true)"
        names = sorted(n for n, (d, _) in plan.items() if d == ds and n in on_disk)
        for name in names:
            w = plan[name][1]; lk = f"read_parquet('{LOOKUP}/{name}.parquet')"
            a = rows(f"SELECT count(*) FROM (SELECT {', '.join(cols)} FROM {lk} EXCEPT ALL SELECT {sel} FROM {src} WHERE {w})")[0][0]
            b = rows(f"SELECT count(*) FROM (SELECT {sel} FROM {src} WHERE {w} EXCEPT ALL SELECT {', '.join(cols)} FROM {lk})")[0][0]
            if a or b: bad.append(f'{name}: {a} Look-Up rows not in the source, {b} source rows not in the Look-Up')
        key = 'snapshot_yyyymm' if ds == 'employment' else 'period'
        agg = ', '.join(f"count(*) FILTER (WHERE {c} = 'REDACTED'), count(*) FILTER (WHERE {c} IS NULL)" for c in cols)
        lfiles = ', '.join(f"'{LOOKUP}/{n}.parquet'" for n in names)
        lc = {x[0]: x[1:] for x in rows(f"SELECT {key}, count(*), {agg} FROM read_parquet([{lfiles}]) GROUP BY 1")}
        rc = {x[0]: x[1:] for x in rows(f"SELECT {key}, count(*), {agg} FROM (SELECT {sel} FROM {src}) GROUP BY 1")}
        if lc != rc: bad.append(f'{ds}: row, REDACTED or NULL counts differ from the raw rows in source month(s) {sorted(k for k in set(lc) | set(rc) if lc.get(k) != rc.get(k))[:3]}')
        n_rows[ds] = (len(names), sum(v[0] for v in lc.values()), len(lc))
        if sum(v[0] for v in lc.values()) != sum(fi['rows'] for n, fi in meta.get('files', {}).items() if n in names): bad.append(f'{ds}: meta row counts != files')
    # KDI-001, KDI-009, KDI-010 values kept as published: per file and issue, the Look-Up rows in scope = the meta's
    # count, and per issue the total = the raw rows in scope; KDI-007 REDACTED grade kept (counted above per month)
    kdi_n = {}
    for ds in ('separations', 'accessions'):
        iss = lookup_los_issue_sql(ds)
        names = sorted(n for n, (d, _) in plan.items() if d == ds and n in on_disk)
        got = {}
        for n, i, c in rows(f"SELECT regexp_extract(filename, '([^/]+)[.]parquet$', 1), {iss} AS i, count(*) FROM read_parquet([{', '.join(repr(f'{LOOKUP}/{x}.parquet') for x in names)}], filename=true) WHERE i IS NOT NULL GROUP BY ALL"):
            got.setdefault(n, {})[i] = c
        for n in names:
            m_ = {i: v for i, v in meta['files'][n].get('kdi', {}).items() if i in {k['id'] for k in kdi_rows() if k['field'] == 'length_of_service_years'}}
            if got.get(n, {}) != m_: bad.append(f'{n}: length-of-service issue rows {got.get(n, {})} != meta {m_}')
        raw_iss = iss.replace('WHEN period', f'WHEN {LOOKUP_PERIOD}')
        for i, c in rows(f"SELECT {raw_iss} AS i, count(*) FROM {raw(ds)} WHERE i IS NOT NULL GROUP BY 1"):
            tot = sum(v.get(i, 0) for v in got.values())
            if tot != c: bad.append(f'{ds} {i}: {tot} Look-Up rows, raw {c}')
            kdi_n[f'{i} {ds}'] = tot
    # the build script cannot link rows across files or months
    code = '\n'.join(l.split('#', 1)[0] for l in open('pipeline/build_lookup.py', encoding='utf-8'))
    for pat, what in ((r'(?<![.\w])join\b', 'JOIN'), (r'\bover\s*\(', 'window function'),
                      (r'\b(row_number|dense_rank|rank|lag|lead|first_value|last_value|nth_value|ntile|percent_rank|cume_dist)\s*\(|\bqualify\b', 'window function'),
                      (r'select\s+(?:distinct\s+)?(?:\w+\.)?\*', 'SELECT *')):
        if re.search(pat, code, re.I): bad.append(f'pipeline/build_lookup.py contains {what}')
    big = max(sizes.items(), key=lambda x: x[1]) if sizes else ('none', 0)
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"{len(sizes)} files ({', '.join(f'{ds} {v[0]} files {v[1]:,} rows from {v[2]} source months' for ds, v in n_rows.items())}): "
        f"columns = lookup_fields.csv = spec section 10 (24/23/21), all VARCHAR, plain Parquet v1 + ZSTD, no key-value metadata; "
        f"every file EXCEPT ALL empty both ways against the raw rows (all action files, latest employment month {LATEST} in full); "
        f"row, REDACTED and NULL counts equal per source month; length-of-service issues kept as published ({', '.join(f'{k} {v:,}' for k, v in sorted(kdi_n.items()))}); "
        f"largest {big[0]}.parquet {big[1] / 1e6:.2f} MB (limit 100 MB); total {sum(sizes.values()) / 1e6:.1f} MB; "
        f"no join, window function or SELECT * in build_lookup.py")


# name, invariant, the phase whose output it guards
PLANNED = [
    ('promoted_matches_staged', 'inv 1', 'Phase 4 promotion'),
]
for name, guards, phase in PLANNED:
    print(f"PLAN  {name:28s} [{guards}] not built yet; required before {phase} ships")

n_pass = sum(ok for _, ok in RESULTS)
print(f"\n{n_pass} of {len(RESULTS)} checks pass ({len(PLANNED)} planned)" + (f'; SUBSET only: GATE_ONLY={",".join(ONLY)}' if ONLY else ''))
sys.exit(0 if n_pass == len(RESULTS) else 1)
