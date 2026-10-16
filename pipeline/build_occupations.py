"""Build the occupation cubes from warehouse/opm.duckdb into warehouse/cubes/ (staging; never web/data/).

Usage (from anywhere):  .venv/bin/python pipeline/build_occupations.py
Reads emp_occ_month (employment headcount per month x organization x series x group, built one employment file at a
time by pipeline/build_db.py), the stored action rows and the core monthly aggregates (through build_cubes helpers),
never the employment files, so one run fits a single shell call. Idempotent and deterministic: a file is rewritten
only when its bytes change, and no output carries a build time.

Definitions: docs/metric-spec.md (signed; sections 3, 4, 7 KDI-011, 9 M-1). Container: docs/cube-plan.md Amendment 2
and docs/occupation-spec.md sections 4b, 5, 8 (signed, D-039, D-040).

Occupation (two levels, both kept as their own rows, so the browser never builds a grouping)
  series   occupational_series_code as published (4 digits)
  family   occupational_group_code as published by OPM (D-039), never derived from the series digits
  'NR'     "Not reported" (KDI-011), its own occupation at each level: series blank, ' ' or '*' (INVALID); family when
           the series is not reported or the published group code is NULL or blank. Never dropped or shared out.
  The build stops on any other value that is not a 4-digit series or a 2-digit group code.

Entities (file keys, as the core cube): GOV, departments, DOD-AF/AR/DD/NV, subelements; every entity with a core file.
An entity's span is its first to last month with headcount or an effective hire or departure (the core cube's span).

Cubes (one file per entity key unless noted, plus <cube>.meta.json)
  occupations/<key>.json   one row per period and occupation at level 'series' and at level 'family': hires,
                           departures, transfers in (AA + AB), transfers out (SA + SB), deferred resignations (DRP),
                           headcount at the period's last month, hire and attrition rate numerators, rate denominator
                           (mean month-end headcount of the occupation over the period's published months), small base.
                           A row exists when the occupation has a hire, a departure or headcount at period end.
      grains  fy       every fiscal year in the entity's span; rate = method B (year to date when partial)
              t12      the latest 12-month window only (ending at the latest month), for every entity with a month in
                       it, over its months in the window (partial when fewer than 12); rate = method A
              admin    an administration's whole window; rate annualized (x 12 / months)
              admin_n  months 1..N in office for every administration, N = the open administration's months so far
      period table (period_columns, periods): one row per window with its months and flags (provisional, partial,
              reissued, opm_incomplete, known data issue ids, KDI-011 when a Not reported row is in the window), so
              the per-occupation rows do not repeat them; rows join it on grain and period.
  occ_family_monthly/<key>.json   per month and family: headcount, hires, departures (rows with any of the three)
  occ_series_monthly/GOV_to_2020-09.json, GOV_from_2020-10.json   GOV only, per month and series: the same, split
                           by month to meet the 3 MB cap (cube plan Amendment 2)
Format of a file: {"cube", "entity", ["part",] "columns", "rows": [[values in column order]] [, "period_columns",
"periods"]}; null is kept distinct from 0.
"""
import csv, hashlib, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cubes as bc        # helpers only; main() is not run on import
import build_breakdowns as bb   # windows, administrations, period rows

import duckdb

T0 = time.time()
OUT = bc.OUT
NR = 'NR'
NR_NAME = 'Not reported'
LEVELS = ('series', 'family')
GRAIN_ORDER = {'fy': 0, 't12': 1, 'admin': 2, 'admin_n': 3}
CUBES = ('occupations', 'occ_family_monthly', 'occ_series_monthly')
SPLIT = '2020-10'   # occ_series_monthly: months before / from this month
SERIES_PARTS = (('GOV_to_2020-09', 'to_2020-09'), ('GOV_from_2020-10', 'from_2020-10'))
OCC_COLUMNS = ['grain', 'period', 'level', 'occupation', 'hires', 'departures', 'acc_transfer_in', 'sep_transfer_out',
               'sep_drp', 'headcount', 'hire_num', 'attrition_num', 'rate_den', 'rate_small_base']
FAM_COLUMNS = ['month', 'family', 'headcount', 'hires', 'departures']
SER_COLUMNS = ['month', 'series', 'headcount', 'hires', 'departures']

SERIES_NR = "(occupational_series_code IS NULL OR trim(occupational_series_code) = '' OR occupational_series_code = '*')"
SERIES_SQL = f"CASE WHEN {SERIES_NR} THEN '{NR}' ELSE occupational_series_code END"
FAMILY_SQL = (f"CASE WHEN {SERIES_NR} OR occupational_group_code IS NULL OR trim(occupational_group_code) = '' "
              f"THEN '{NR}' ELSE occupational_group_code END")
ENTITY_KEYS = ("SELECT 'GOV' AS e, * FROM oc UNION ALL SELECT d, * FROM oc UNION ALL SELECT 'DOD-' || a, * FROM oc WHERE d = 'DOD' "
               "UNION ALL SELECT CASE WHEN trim(coalesce(s, '')) = '' THEN a || '_NR' ELSE replace(s, '*', '_') END, * FROM oc")


def connect():
    con = duckdb.connect()
    con.execute(f"SET memory_limit='{os.environ.get('OPM_DB_MEMORY', '1500MB')}'; SET threads=4; "
                "SET temp_directory='warehouse/duckdb_tmp'; SET preserve_insertion_order=false")
    con.execute(f"ATTACH '{bc.DB}' AS w (READ_ONLY); USE w")   # temp tables still go to the temp catalog
    return con


def cells(con):
    """Temp table oc(m, d, a, s, series, family, h, hires, departures, tin, tout, drp): employment headcount and
    effective-month actions per month, organization and occupation (both levels on each row)."""
    z6 = '0 AS hires, 0 AS departures, 0 AS tin, 0 AS tout, 0 AS drp'
    con.execute(f"""CREATE OR REPLACE TEMP TABLE oc AS
      WITH mo AS (SELECT DISTINCT period AS m FROM w.emp_occ_month),
      u AS (
        SELECT period AS m, department_code AS d, agency_code AS a, agency_subelement_code AS s, {SERIES_SQL} AS series,
               {FAMILY_SQL} AS family, headcount AS h, {z6} FROM w.emp_occ_month
        UNION ALL
        SELECT r.effective_month, r.department_code, r.agency_code, r.agency_subelement_code, {SERIES_SQL.replace('occupational', 'r.occupational')},
               {FAMILY_SQL.replace('occupational', 'r.occupational')}, 0, 1, 0, CAST(c.category = 'transfer_in' AS INT), 0, 0
        FROM w.accession_rows r LEFT JOIN w.xw_accession_codes c ON c.code = r.action_code WHERE NOT r.effective_before_range
        UNION ALL
        SELECT r.effective_month, r.department_code, r.agency_code, r.agency_subelement_code, {SERIES_SQL.replace('occupational', 'r.occupational')},
               {FAMILY_SQL.replace('occupational', 'r.occupational')}, 0, 0, 1, 0, CAST(c.category = 'transfer_out' AS INT),
               CAST(r.drp_indicator = 'Y' AS INT)
        FROM w.separation_rows r LEFT JOIN w.xw_separation_codes c ON c.code = r.action_code WHERE NOT r.effective_before_range)
      SELECT m, d, a, s, series, family, sum(h) AS h, sum(hires) AS hires, sum(departures) AS departures, sum(tin) AS tin,
             sum(tout) AS tout, sum(drp) AS drp
      FROM u WHERE m IN (SELECT m FROM mo) GROUP BY ALL""")
    bad = con.execute(f"""SELECT 'series', series, sum(h + hires + departures) FROM oc
                          WHERE series <> '{NR}' AND NOT regexp_full_match(series, '[0-9]{{4}}') GROUP BY ALL
                          UNION ALL SELECT 'family', family, sum(h + hires + departures) FROM oc
                          WHERE family <> '{NR}' AND NOT regexp_full_match(family, '[0-9]{{2}}') GROUP BY ALL""").fetchall()
    if bad:
        sys.exit(f'occupation cubes NOT built: occupation codes that are neither published codes nor Not reported: {bad[:5]}')
    unc = con.execute("SELECT count(*) FROM oc WHERE (hires > 0 AND tin IS NULL) OR (departures > 0 AND tout IS NULL)").fetchone()[0]
    if unc:
        sys.exit(f'occupation cubes NOT built: {unc} action cells with an unmapped action code')
    # entity-level cells, both levels: ec(e, m, lvl, occ, h, hires, departures, tin, tout, drp)
    con.execute("CREATE OR REPLACE TEMP TABLE ec (e VARCHAR, m DATE, lvl VARCHAR, occ VARCHAR, h BIGINT, hires BIGINT, "
                "departures BIGINT, tin BIGINT, tout BIGINT, drp BIGINT)")
    for lvl in LEVELS:
        con.execute(f"""INSERT INTO ec SELECT e, m, '{lvl}', {lvl}, sum(h), sum(hires), sum(departures), sum(tin), sum(tout), sum(drp)
                        FROM ({ENTITY_KEYS}) GROUP BY ALL""")


def names(con):
    """{'series': {code: name}, 'family': {code: name}}: each code's published name, latest spelling (latest month with a
    non-null name; employment before actions in the same month), plus Not reported."""
    out = {}
    for lvl, code, nm, enm in (('series', 'occupational_series_code', 'occupational_series', 'series_name'),
                               ('family', 'occupational_group_code', 'occupational_group', 'group_name')):
        expr = SERIES_SQL if lvl == 'series' else FAMILY_SQL
        rs = con.execute(f"""WITH x AS (
              SELECT {expr} AS k, {enm} AS n, period AS p, 2 AS r FROM w.emp_occ_month
              UNION ALL SELECT {expr}, {nm}, period, 1 FROM w.accession_rows
              UNION ALL SELECT {expr}, {nm}, period, 1 FROM w.separation_rows)
            SELECT k, arg_max(n, (p, r)) FILTER (WHERE n IS NOT NULL AND trim(n) <> '') FROM x WHERE k <> '{NR}' GROUP BY k ORDER BY k""").fetchall()
        out[lvl] = {k: n for k, n in rs}
        out[lvl][NR] = NR_NAME
    return out


def window_list(months, ent, starts, ends, admins, n_now):
    """{key: [(grain, period, fiscal_year, first label, [published month indexes], months_in_period, partial)]}:
    fiscal years, admin and admin_n as the breakdown cubes; t12 the latest window only, over the entity's months in it."""
    latest = len(months) - 1
    out = {}
    for k in ent:
        if ends[k] is None:
            continue
        ws = [w for w in bb.windows(months, starts[k], ends[k], admins, n_now) if w[0] != 't12']
        pub = [i for i in range(latest - 11, latest + 1) if starts[k] <= i <= ends[k]]
        if pub:
            ws.append(('t12', bc.ym(months[latest]), bc.fy_of(months[latest]), bc.ym(months[latest - 11]), pub, 12, len(pub) < 12))
        ws.sort(key=lambda w: GRAIN_ORDER[w[0]])
        out[k] = ws
    return out


def occupation_rows(con, wins, months):
    """{key: rows} of the occupations cube from one windowed aggregation over ec (each window a contiguous month range)."""
    vals = []
    for k, ws in wins.items():
        for g, p, fy, first, pub, n_in, partial in ws:
            vals.append((k, g, p, months[pub[0]], months[pub[-1]], len(pub)))
    con.execute("CREATE OR REPLACE TEMP TABLE win (e VARCHAR, grain VARCHAR, period VARCHAR, am DATE, bm DATE, n INTEGER)")
    con.executemany("INSERT INTO win VALUES (?, ?, ?, ?, ?, ?)", vals)
    cur = con.execute(f"""
      SELECT w.e, w.grain, w.period, c.lvl, c.occ, sum(c.hires), sum(c.departures), sum(c.tin), sum(c.tout), sum(c.drp),
             coalesce(sum(c.h) FILTER (WHERE c.m = w.bm), 0) AS h_end, sum(c.h) AS h_sum, any_value(w.n) AS n
      FROM win w JOIN ec c ON c.e = w.e AND c.m BETWEEN w.am AND w.bm
      GROUP BY w.e, w.grain, w.period, c.lvl, c.occ
      HAVING sum(c.hires) > 0 OR sum(c.departures) > 0 OR h_end > 0""")
    out = {}
    while True:
        chunk = cur.fetchmany(200_000)
        if not chunk:
            break
        for e, g, p, lvl, occ, hi, de, ti, to, drp, h_end, h_sum, n in chunk:
            admin = g in ('admin', 'admin_n')
            if occ == NR:            # KDI-011: counts only, no rate (its headcount and its flows are not the same people)
                rate = [None, None, None, None]
            else:
                den = h_sum / n
                if den == 0:
                    rate = [None, None, None, None]
                else:
                    rate = [bc.r4(hi * 12 / n) if admin else hi, bc.r4(de * 12 / n) if admin else de, bc.r4(den), den < bc.SMALL_BASE]
            out.setdefault(e, []).append([g, p, lvl, occ, hi, de, ti, to, drp, h_end] + rate)
    order = {}
    for k, ws in wins.items():
        order[k] = {(w[0], w[1]): i for i, w in enumerate(ws)}
    for e, rs in out.items():
        rs.sort(key=lambda r: (order[e][(r[0], r[1])], r[2] != 'series', r[3] == NR, r[3]))
    return out


def monthly_rows(con, lvl, entity=None):
    """{key: [[YYYY-MM, occupation, headcount, hires, departures]]} for one level (rows with any of the three)."""
    where = f"AND e = '{entity}'" if entity else ''
    cur = con.execute(f"""SELECT e, strftime(m, '%Y-%m'), occ, h, hires, departures FROM ec
                          WHERE lvl = '{lvl}' AND (h > 0 OR hires > 0 OR departures > 0) {where}
                          ORDER BY e, m, occ = '{NR}', occ""")
    out = {}
    while True:
        chunk = cur.fetchmany(200_000)
        if not chunk:
            break
        for e, m, occ, h, hi, de in chunk:
            out.setdefault(e, []).append([m, occ, h, hi, de])
    return out


# ---------------------------------------------------------------- column dictionaries
PERIOD_NOTE = ("rows join the file's period table on grain and period; its months_published is the number of month-end "
               "headcounts averaged into rate_den")


def occ_dictionary():
    d = {
        'grain': ('dimension', "'fy' (fiscal year), 't12' (the latest 12 months only, ending at the latest month), 'admin' (an "
                               "administration's whole window) or 'admin_n' (its months 1..N in office, N = admin_n_months)"),
        'period': ('dimension', "'FYyyyy' at fy grain; 'YYYY-MM' (the latest month) at t12 grain; the administration id at admin "
                                "and admin_n grain; " + PERIOD_NOTE),
        'level': ('dimension', "'series' (occupational_series_code as published) or 'family' (OPM's published "
                               'occupational_group_code, D-039); each level partitions the entity on its own'),
        'occupation': ('dimension', f"the series or family code; '{NR}' = Not reported (KDI-011): series blank, ' ' or '*' "
                                    '(INVALID), and at family level also a series with no published group code; names in '
                                    'meta occupations'),
        'hires': ('flow', 'accession rows effective in the window with this occupation (new hires and transfers in)'),
        'departures': ('flow', 'separation rows effective in the window with this occupation (transfers out and DRP included)'),
        'acc_transfer_in': ('flow', 'hires with accession code AA + AB (transfers in)'),
        'sep_transfer_out': ('flow', 'departures with separation code SA + SB (transfers out)'),
        'sep_drp': ('flow', "departures with drp_indicator = 'Y' (deferred resignations), any code"),
        'headcount': ('stock', "employment rows with this occupation in the file of the period's period_last_month; not derived "
                               'from flows: employees also change series without a hire or departure (invariant 7)'),
        'hire_num': ('rate_numerator', 'hire rate numerator: hires (admin and admin_n: x 12 / months_published, annualized); '
                                       'rate = hire_num / rate_den; null when there is no rate'),
        'attrition_num': ('rate_numerator', 'departure rate numerator: departures (admin and admin_n: x 12 / months_published, '
                                            'annualized); rate = attrition_num / rate_den; null when there is no rate'),
        'rate_den': ('rate_denominator', "mean month-end headcount of the occupation over the period's published months "
                                         '(fy: method B, year to date when partial; t12: method A; admin grains: the window); '
                                         f"null (never 0) when that mean is 0, and on '{NR}' rows (KDI-011: counts only)"),
        'rate_small_base': ('flag', f'rate_den < {bc.SMALL_BASE} (invariant 9): shown with a flag, never hidden; null when '
                                    'there is no rate'),
    }
    out = []
    for c in OCC_COLUMNS:
        e = {'name': c, 'kind': d[c][0], 'description': d[c][1]}
        if c in ('hire_num', 'attrition_num'):
            e.update({'denominator': 'rate_den', 'small_base': 'rate_small_base', 'months': 'period table months_published'})
        out.append(e)
    return out


def monthly_dictionary(lvl):
    occ = 'family' if lvl == 'family' else 'series'
    d = {
        'month': ('dimension', "calendar month 'YYYY-MM' (effective month for flows, the employment file month for headcount); "
                               'flags for the month are those of the core cube month row of the same entity'),
        occ: ('dimension', (f"OPM's published occupational_group_code (D-039); '{NR}' = Not reported (KDI-011)" if lvl == 'family'
                            else f"occupational_series_code as published; '{NR}' = Not reported (KDI-011)") + '; names in meta occupations'),
        'headcount': ('stock', 'employment rows with this occupation in the month (never summed across months)'),
        'hires': ('flow', 'accession rows effective in the month with this occupation'),
        'departures': ('flow', 'separation rows effective in the month with this occupation (transfers out and DRP included)'),
    }
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1]} for c in (FAM_COLUMNS if lvl == 'family' else SER_COLUMNS)]


def write_cube(name, key, payload, files, extra=None):
    rel = f'{name}/{key}.json'
    path = f'{OUT}/{rel}'
    changed = bc.write_if_changed(path, bc.dumps_compact(payload))
    files[key] = {'path': rel, 'sha256': bc.sha(path), 'bytes': os.path.getsize(path), 'rows': len(payload['rows']), **(extra or {})}
    return changed


def main():
    for c in CUBES:
        os.makedirs(f'{OUT}/{c}', exist_ok=True)
    con = connect()
    months = [r[0] for r in con.execute('SELECT DISTINCT month FROM w.monthly_org ORDER BY 1').fetchall()]
    emp_months = [r[0] for r in con.execute('SELECT DISTINCT period FROM w.emp_occ_month ORDER BY 1').fetchall()]
    if emp_months != months:
        sys.exit('occupation cubes NOT built: emp_occ_month months differ from monthly_org (run pipeline/build_db.py)')
    # entity spans and entity-month KDI flags, exactly as the core cube (build_cubes helpers on the same tables)
    base = bc.load_base(con)
    ent = bc.entity_table()
    midx = {m: i for i, m in enumerate(months)}
    vec, kdi, _ = bc.entity_months(base, ent, len(months), midx, bc.incomplete_scope(con))
    del base
    starts = {k: bc.first_index(vec[k]) for k in ent}
    ends = {k: bc.last_index(vec[k]) for k in ent}
    core_vec = {k: vec[k] for k in ent if ends[k] is not None}
    del vec
    keys = [k for k in ent if ends[k] is not None]
    print(f'core spans for {len(keys)} entities at {time.time() - T0:.1f}s', flush=True)

    cells(con)
    occ_names = names(con)
    print(f'cells at {time.time() - T0:.1f}s: ' + ', '.join(f'{n} {con.execute(f"SELECT count(*) FROM {n}").fetchone()[0]:,}' for n in ('oc', 'ec')), flush=True)
    orphan = [r[0] for r in con.execute('SELECT DISTINCT e FROM ec').fetchall() if r[0] not in core_vec]
    if orphan:
        sys.exit(f'occupation cubes NOT built: entities {orphan[:5]} have occupation cells but no core file')

    mhash, vers = bc.manifest_hash(), bc.versions_by_month()
    bl = bc.revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    ctx = {'prov': set(range(len(months) - bc.PROVISIONAL_MONTHS, len(months))),
           'reissued': {m for m, v in vers.items() if prior and m in prior and prior[m] != v}}
    admins = bb.administrations(months)
    open_ix = [ix for _, _, ix, o in admins if o]
    n_now = len(open_ix[-1]) if open_ix else None
    wins = window_list(months, {k: ent[k] for k in keys}, starts, ends, admins, n_now)

    files = {c: {} for c in CUBES}
    written = {c: 0 for c in CUBES}
    kdi_scope = {c: {} for c in CUBES}
    def scope(cube, i, e, n=1):
        s = kdi_scope[cube].setdefault(i, {'rows': 0, 'entities': set()})
        s['rows'] += n
        s['entities'].add(e)

    occ = occupation_rows(con, wins, months)
    print(f'occupation rows at {time.time() - T0:.1f}s: {sum(len(v) for v in occ.values()):,}', flush=True)
    for k in keys:
        rs = occ.pop(k, [])
        nr_periods = {(r[0], r[1]) for r in rs if r[3] == NR}
        periods = []
        for w in wins[k]:
            p = bb.period_row(w, months, ctx, kdi[k])
            if (w[0], w[1]) in nr_periods:
                p[-1] = sorted(set(p[-1]) | {'KDI-011'})
            for i in p[-1]:
                scope('occupations', i, k)
            periods.append(p)
        payload = {'cube': 'occupations', 'entity': k, 'columns': OCC_COLUMNS, 'rows': rs,
                   'period_columns': bb.PERIOD_COLUMNS, 'periods': periods}
        written['occupations'] += write_cube('occupations', k, payload, files['occupations'])
    del occ

    fam = monthly_rows(con, 'family')
    for k in keys:
        rs = fam.pop(k, [])
        for m in sorted({r[0] for r in rs if r[1] == NR}):
            scope('occ_family_monthly', 'KDI-011', k)
        for i in range(starts[k], ends[k] + 1):
            for x in kdi[k][i]:
                scope('occ_family_monthly', x, k)
        written['occ_family_monthly'] += write_cube('occ_family_monthly', k, {'cube': 'occ_family_monthly', 'entity': k,
                                                    'columns': FAM_COLUMNS, 'rows': rs}, files['occ_family_monthly'])
    del fam

    ser = monthly_rows(con, 'series', 'GOV').get('GOV', [])
    for key, part in SERIES_PARTS:
        rs = [r for r in ser if (r[0] < SPLIT) == part.startswith('to_')]
        for m in sorted({r[0] for r in rs if r[1] == NR}):
            scope('occ_series_monthly', 'KDI-011', 'GOV')
        for r_m in sorted({r[0] for r in rs}):
            for x in kdi['GOV'][[bc.ym(m) for m in months].index(r_m)]:
                scope('occ_series_monthly', x, 'GOV')
        written['occ_series_monthly'] += write_cube('occ_series_monthly', key, {
            'cube': 'occ_series_monthly', 'entity': 'GOV', 'part': part, 'first_month': rs[0][0], 'last_month': rs[-1][0],
            'columns': SER_COLUMNS, 'rows': rs}, files['occ_series_monthly'],
            {'entity': 'GOV', 'first_month': rs[0][0], 'last_month': rs[-1][0]})
    con.close()
    for c in CUBES:   # this script's own stale outputs
        for f in sorted(os.listdir(f'{OUT}/{c}')):
            if f.endswith('.tmp') or (f.endswith('.json') and f[:-5] not in files[c]):
                os.remove(f'{OUT}/{c}/{f}')
                print(f'removed stale {c}/{f}')
    print(f'files written at {time.time() - T0:.1f}s: ' + ', '.join(f'{c} {len(files[c])} ({written[c]} rewritten)' for c in CUBES), flush=True)

    kdis = [r for r in csv.DictReader(open(bc.KDI_FILE, encoding='utf-8')) if r['status'] == 'active']
    common = {
        'manifest_sha256': mhash,
        'manifest_hash_method': 'sha256 of data/opm_manifest.json canonical content: records sorted by (dataset, filename), '
                                'json.dumps(sort_keys=True, separators=(",", ":"))',
        'spec': 'docs/metric-spec.md (signed; sections 3, 4, 7 KDI-011, 9 M-1, D-040); docs/cube-plan.md Amendment 2 and '
                'docs/occupation-spec.md sections 4b, 5, 8 (signed, D-039, D-040)',
        'time_basis': 'effective',
        'range': {'first_month': bc.ym(months[0]), 'last_month': bc.ym(months[-1])},
        'provisional_months': [bc.ym(months[i]) for i in sorted(ctx['prov'])],
        'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': {'file': 'revision_baseline.json', 'manifest_sha256': bl['manifest_sha256'],
                              'prior_manifest_sha256': bl.get('prior_manifest_sha256')},
        'small_base_threshold': bc.SMALL_BASE,
        'known_data_issues': {'file': bc.KDI_FILE, 'sha256': bc.sha(bc.KDI_FILE),
                              'applied': [{'id': i, 'treatment': t, 'decision': d} for i, t, d in
                                          sorted({(r['id'], r['treatment'], r['decision']) for r in kdis})]},
        'not_reported': {'code': NR, 'name': NR_NAME, 'kdi': 'KDI-011',
                         'rule': f"series: occupational_series_code NULL, blank (' ', published as \"NO DATA REPORTED\") or '*' "
                                 f"(INVALID); family: the series is not reported, or occupational_group_code is NULL or blank "
                                 f"(a series with no published family). Its own occupation at each level, never dropped or "
                                 f"shared out; counts only, no rate (the occupations cube)"},
        'occupations': {'name_rule': "each code's published name, latest spelling (the latest month with a non-null name; the "
                                     'employment file before the action files of the same month); families are OPM\'s published '
                                     'occupational_group_code and occupational_group (D-039), never derived from the series digits',
                        'series': occ_names['series'], 'family': occ_names['family']},
        'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
    }
    ent_meta = lambda ks: {k: {'level': ent[k]['level'], 'code': ent[k]['code'], 'parent': ent[k]['parent'], 'name': ent[k]['name'],
                               'first_month': bc.ym(months[starts[k]]), 'last_month': bc.ym(months[ends[k]])} for k in ks}
    def kscope(c):
        return {i: {'rows': s['rows'], 'entities': sorted(s['entities'])} for i, s in sorted(kdi_scope[c].items())}
    grains = {'fy': 'fiscal year, every year in the entity span; rate = method B (year to date over its published months when '
                    'partial, not annualized)',
              't12': 'the latest 12 months only (the window ending at the latest month), for every entity with a month inside '
                     "it, over the entity's months in the window (partial when fewer than 12); headcount at the entity's last "
                     'month in the window; rate = method A',
              'admin': "an administration's whole window (Trump II so far); rate annualized x 12 / months",
              'admin_n': "months 1..N in office for every administration, N = admin_n_months (the open administration's "
                         'months so far); rate annualized as admin'}
    rate_methods = ('Each row carries one rate denominator, the method its grain defines (metric spec section 3, as the '
                    'leaving and joining cubes): fy rows method B, t12 rows method A, admin rows annualized; method C at '
                    'quarter or month grain is not carried because the cube has no quarter or month rows, and the monthly '
                    'occupation cubes carry headcount, hires and departures from which the page computes all three methods.')
    size = bb.size_stats
    metas = {
        'occupations': {'cube': 'occupations',
                        'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows", "period_columns", '
                                  '"periods": [[values in period_columns order]]}; rows join the period table on grain and period',
                        **common, 'grains': grains, 'admin_n_months': n_now, 'rate_methods': rate_methods,
                        'levels': {'series': 'occupational_series_code as published', 'family': "OPM's occupational_group_code as published (D-039)"},
                        'row_rule': 'one row per period, level and occupation with a hire, a departure or headcount at period end',
                        'entities': ent_meta(keys),
                        'administrations': {'file': bb.ADMIN_FILE, 'sha256': bc.sha(bb.ADMIN_FILE),
                                            'list': [{'id': a, 'name': nm, 'month_0': bc.ym(months[ix[0] - 1]), 'first_month': bc.ym(months[ix[0]]),
                                                      'last_month': bc.ym(months[ix[-1]]), 'open': o} for a, nm, ix, o in admins]},
                        'kdi_in_scope': kscope('occupations'),
                        'columns': occ_dictionary(), 'period_columns': bb.period_dictionary(
                            'known data issue ids touching a month of the window: entity-month flags of the entity and the '
                            f"entities inside it, and KDI-011 when the window has a '{NR}' (Not reported) row"),
                        'files': files['occupations'], 'files_sha256': bb.digest(files['occupations']),
                        'size': size(files['occupations'])},
        'occ_family_monthly': {'cube': 'occ_family_monthly',
                               'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows"}',
                               **common, 'grains': ['month'],
                               'row_rule': "one row per month and family with headcount, a hire or a departure, months of the entity's span",
                               'flags_rule': 'per-month flags (provisional, opm_incomplete, known data issues) are those of the core cube '
                                             'month row of the same entity and month; KDI-011 rows are the family NR',
                               'entities': ent_meta(keys), 'kdi_in_scope': kscope('occ_family_monthly'),
                               'columns': monthly_dictionary('family'),
                               'files': files['occ_family_monthly'], 'files_sha256': bb.digest(files['occ_family_monthly']),
                               'size': size(files['occ_family_monthly'])},
        'occ_series_monthly': {'cube': 'occ_series_monthly',
                               'format': 'GOV only, two JSON files split by month, files[<key>].path: {"cube", "entity", "part", '
                                         '"first_month", "last_month", "columns", "rows"}',
                               **common, 'grains': ['month'], 'split_month': SPLIT,
                               'row_rule': 'one row per month and series with headcount, a hire or a departure',
                               'flags_rule': 'per-month flags are those of the core cube GOV month row; KDI-011 rows are the series NR',
                               'entities': ent_meta(['GOV']), 'kdi_in_scope': kscope('occ_series_monthly'),
                               'columns': monthly_dictionary('series'),
                               'files': files['occ_series_monthly'], 'files_sha256': bb.digest(files['occ_series_monthly']),
                               'size': size(files['occ_series_monthly'])},
    }
    for c, m in metas.items():
        bc.write_if_changed(f'{OUT}/{c}.meta.json', bc.dumps_meta(m))
    tot = sum(m['size']['total_bytes'] for m in metas.values())
    print('; '.join(f"{c} {m['size']['files']} files {m['size']['total_bytes']:,} B (largest {m['size']['largest']['key']} "
                    f"{m['size']['largest']['bytes']:,})" for c, m in metas.items()) + f'; total {tot:,} B; {time.time() - T0:.1f}s')


if __name__ == '__main__':
    main()
