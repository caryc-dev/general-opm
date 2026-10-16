"""Build the core and compare cubes from warehouse/opm.duckdb into warehouse/cubes/ (staging; never web/data/).

Usage (from anywhere):  .venv/bin/python pipeline/build_cubes.py
Reads only the monthly aggregates (monthly_org, monthly_org_kdi) and one grouped pass over the stored separation
rows, never the employment files, so one run fits a single shell call. Idempotent and deterministic: a file is
rewritten only when its bytes change, and no output carries a build time, so rebuilding unchanged inputs gives
byte-identical files. An interrupted run is resumed by running it again.

Definitions: docs/metric-spec.md (signed, D-014, D-015, D-018). Container: docs/cube-plan.md (signed, D-016).

Entities (file keys)
  GOV                 the government: the exact sum of all departments
  <department code>   each department_code (resolved department, spec section 1)
  DOD-AF, DOD-AR, DOD-DD, DOD-NV   the four DOD agencies
  <subelement key>    each agency_subelement_code; '*' becomes '_' (AB** -> AB__) and the blank code (KDI-004)
                      becomes <agency>_NR ("Not reported"), so every key is a safe file name
Rows run from the entity's first month to its last month: the first and last month with headcount or with an
effective hire or departure (spec section 1, D-018); no rows before it existed or after it ended, so its first and
last quarter and fiscal year are partial. A month with no rows inside that span keeps headcount 0, and its rates are
empty. Method A (trailing 12 months) needs 12 of the entity's months, as it needs 12 published months from Oct 2011.

Outputs (warehouse/cubes/)
  core/<key>.json      month, fiscal quarter and fiscal year rows for one entity
  compare/<key>.json   one row per child per period (fiscal year; the trailing 12 months ending at the latest
                       month) for a parent: GOV over departments, each department over its subelements, DOD also
                       over its four agencies
  core.meta.json, compare.meta.json   column dictionary with kinds, manifest hash, per-file SHA-256, known data
                       issues and known breaks in scope, provisional and reissued months, size statistics
  revision_baseline.json   file versions per month for the current manifest and the previous one
  known_breaks_candidates.csv   government and department fiscal years over the D-009 reconciliation rule
Format of a cube file: {"cube", "entity" or "parent", "columns": [names], "rows": [[values in column order]]};
null is kept distinct from 0.
"""
import csv, datetime, hashlib, json, os, sys, time

import duckdb

T0 = time.time()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DB = 'warehouse/opm.duckdb'
OUT = 'warehouse/cubes'
XW = 'pipeline/crosswalks'
KDI_FILE = 'pipeline/known_data_issues.csv'
KNOWN_BREAKS = 'pipeline/known_breaks.csv'
MANIFEST = 'data/opm_manifest.json'
SMALL_BASE = 30            # invariant 9, spec section 3
PROVISIONAL_MONTHS = 3     # invariant 8, spec section 2
BREAK_PCT, BREAK_PEOPLE = 5.0, 20   # D-009, spec section 8
SEP = ['transfer_out', 'quit', 'retirement', 'rif', 'termination', 'other']   # spec section 4, display order
ACC = ['transfer_in', 'new_hire']
SEP_CODES = {'transfer_out': 'SA + SB', 'quit': 'SC', 'retirement': 'SD + SE + SG', 'rif': 'SH', 'termination': 'SJ',
             'other': 'SL'}
ACC_CODES = {'transfer_in': 'AA + AB', 'new_hire': 'AC + AD + AE'}
GRAINS = ('month', 'quarter', 'fy')

# per (month, organization) vector, in this order
F = (['headcount', 'hires', 'departures'] + [f'sep_{c}' for c in SEP] + ['sep_drp'] + [f'sep_{c}_nondrp' for c in SEP]
     + [f'acc_{c}' for c in ACC] + ['los_tenths', 'yos_known', 'yos_unknown_issue', 'yos_unknown_missing'])
FI = {c: i for i, c in enumerate(F)}
S_COLS = {f'sep_{c}_nondrp' for c in SEP} | {'los_tenths', 'yos_known', 'yos_unknown_issue', 'yos_unknown_missing'}
FLOWS = ['hires', 'departures'] + [f'sep_{c}' for c in SEP] + ['sep_drp'] + [f'sep_{c}_nondrp' for c in SEP] + [f'acc_{c}' for c in ACC]


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def manifest_hash():
    """sha256 of the manifest's canonical content: records sorted by (dataset, filename), keys sorted, compact
    separators. Insensitive to key order and whitespace; sensitive to any value."""
    recs = sorted(json.load(open(MANIFEST)), key=lambda x: (x['dataset'], x['filename']))
    return hashlib.sha256(json.dumps(recs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def versions_by_month():
    v = {}
    for x in json.load(open(MANIFEST)):
        v.setdefault(f"{int(x['year']):04d}-{int(x['month']):02d}", {})[x['dataset']] = int(x['version'])
    return {k: v[k] for k in sorted(v)}


def sub_key(code, agency):
    """File key of a subelement code: '*' -> '_', blank -> <agency>_NR."""
    c = (code or '').strip()
    return f'{agency}_NR' if not c else c.replace('*', '_')


def ym(d):
    return d.strftime('%Y-%m')


def fy_of(d):
    return d.year + (1 if d.month >= 10 else 0)


def fq_of(d):
    return (d.month + 2) % 12 // 3 + 1


def r4(x):
    return None if x is None else round(x, 4)


def write_if_changed(path, text):
    """Atomic write, skipped when the bytes are unchanged (so a rebuild does not touch an unchanged file)."""
    data = text.encode('utf-8')
    if os.path.exists(path) and open(path, 'rb').read() == data:
        return False
    tmp = path + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, path)
    return True


def dumps_compact(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False) + '\n'


def dumps_meta(obj):
    return json.dumps(obj, indent=1, ensure_ascii=False) + '\n'


# ---------------------------------------------------------------- inputs
def check_crosswalks():
    """The categories the cube names must be exactly the crosswalk categories (the gate checks the codes)."""
    sep = {r['category'] for r in csv.DictReader(open(f'{XW}/separation_codes.csv', encoding='utf-8'))}
    acc = {r['category'] for r in csv.DictReader(open(f'{XW}/accession_codes.csv', encoding='utf-8'))}
    if sep != set(SEP) or acc != set(ACC):
        sys.exit(f'cubes NOT built: crosswalk categories {sorted(sep)} / {sorted(acc)} != {SEP} / {ACC}')


def load_base(con):
    """[(month, department, agency, subelement, vector, kdi ids, length-of-service issue ids)] from monthly_org, the
    separation rows (non-DRP categories, length of service; KDI-001 and KDI-009 values unknown) and monthly_org_kdi. Length of service is summed in tenths of a year (exact
    integers: every published value has one decimal), so the sums do not depend on summation order."""
    tenths = con.execute("SELECT count(*) FROM separation_rows WHERE length_of_service_years * 10 <> "
                         "round(length_of_service_years * 10)").fetchone()[0]
    if tenths:
        sys.exit(f'cubes NOT built: {tenths} length_of_service_years values with more than one decimal')
    nd = ', '.join(f"count(*) FILTER (WHERE category = {q(c)} AND drp_indicator IS DISTINCT FROM 'Y') AS sep_{c}_nondrp" for c in SEP)
    keys = 'department_code, agency_code, agency_subelement_code'
    sql = f"""
      WITH s AS (SELECT effective_month AS month, {keys}, {nd},
                        sum(CAST(round(length_of_service_years * 10) AS BIGINT)) FILTER (WHERE NOT los_known_issue) AS los_tenths,
                        count(length_of_service_years) FILTER (WHERE NOT los_known_issue) AS yos_known,
                        count(*) FILTER (WHERE los_known_issue) AS yos_unknown_issue,
                        count(*) FILTER (WHERE length_of_service_years IS NULL AND NOT los_known_issue) AS yos_unknown_missing,
                        list(DISTINCT los_issue_id ORDER BY los_issue_id) FILTER (WHERE los_known_issue) AS los_ids
                 FROM v_separations WHERE NOT effective_before_range GROUP BY ALL)
      SELECT m.month, m.department_code, m.agency_code, m.agency_subelement_code,
             {', '.join(f'CAST(coalesce({"s." if c in S_COLS else "m."}{c}, 0) AS BIGINT)' for c in F)}, k.kdi_ids, s.los_ids
      FROM monthly_org m LEFT JOIN s USING (month, {keys}) LEFT JOIN monthly_org_kdi k USING (month, {keys})
      ORDER BY m.month, {keys}"""
    out = con.execute(sql).fetchall()
    orphan = con.execute(f"""SELECT count(*) FROM (SELECT effective_month AS month, {keys} FROM separation_rows
        WHERE NOT effective_before_range GROUP BY ALL) s ANTI JOIN monthly_org m USING (month, {keys})""").fetchone()[0]
    if orphan:
        sys.exit(f'cubes NOT built: {orphan} separation cells have no monthly_org row')
    return [(r[0], r[1], r[2], r[3], list(r[4:4 + len(F)]), sorted(r[4 + len(F)] or []), sorted(r[5 + len(F)] or []))
            for r in out]


def mass_transfers(con):
    """{(department, effective month): (AB transfers in, SB transfers out)}: evidence for cause hints only."""
    out = {}
    for d, m, ab in con.execute("SELECT department_code, effective_month, count(*) FROM accession_rows WHERE action_code = 'AB' "
                                "AND NOT effective_before_range GROUP BY ALL").fetchall():
        out[(d, m)] = [ab, 0]
    for d, m, sb in con.execute("SELECT department_code, effective_month, count(*) FROM separation_rows WHERE action_code = 'SB' "
                                "AND NOT effective_before_range GROUP BY ALL").fetchall():
        out.setdefault((d, m), [0, 0])[1] = sb
    return out


def entity_table():
    """Entities from pipeline/crosswalks/entities.csv: {key: {level, code, parent, name}}; parents are keys."""
    rows = list(csv.DictReader(open(f'{XW}/entities.csv', encoding='utf-8')))
    ag_dept = {r['code']: r['parent_code'] for r in rows if r['level'] == 'agency'}
    ent = {'GOV': {'level': 'government', 'code': None, 'parent': None, 'name': 'All departments and agencies'}}
    for r in rows:
        if r['level'] == 'department':
            ent[r['code']] = {'level': 'department', 'code': r['code'], 'parent': 'GOV', 'name': r['latest_name']}
    for r in rows:
        if r['level'] == 'agency' and r['parent_code'] == 'DOD':
            ent[f"DOD-{r['code']}"] = {'level': 'agency', 'code': r['code'], 'parent': 'DOD', 'name': r['latest_name']}
    for r in rows:
        if r['level'] == 'subelement':
            k = sub_key(r['code'], r['parent_code'])
            if k in ent:
                sys.exit(f'cubes NOT built: subelement key {k} collides')
            d = ag_dept[r['parent_code']]
            ent[k] = {'level': 'subelement', 'code': r['code'], 'parent': f"DOD-{r['parent_code']}" if d == 'DOD' else d,
                      'department': d, 'name': r['latest_name']}
    return ent


def known_breaks_signed():
    if not os.path.exists(KNOWN_BREAKS):
        return []
    return [dict(r) for r in csv.DictReader(open(KNOWN_BREAKS, encoding='utf-8'))]


def revision_baseline(mhash, vers):
    """warehouse/cubes/revision_baseline.json: file versions per month for the current manifest and the previous
    one. Rewritten only when the manifest changes. The first build has no prior, so no month is reissued."""
    path = f'{OUT}/revision_baseline.json'
    old = json.load(open(path)) if os.path.exists(path) else None
    if old and old.get('manifest_sha256') == mhash:
        return old
    new = {'manifest_sha256': mhash, 'versions': vers,
           'prior_manifest_sha256': old['manifest_sha256'] if old else None,
           'prior_versions': old['versions'] if old else None,
           'note': 'versions = file version per month and dataset for manifest_sha256; prior_versions = the same for '
                   'the previous manifest (null on the first build, which is the baseline). A month is reissued when '
                   'any of its three versions differs from prior_versions.'}
    write_if_changed(path, dumps_meta(new))
    return new


# ---------------------------------------------------------------- aggregation
def entity_months(base, ent, n_months, midx):
    """{key: [vector per month index]}, {key: [set of entity-month KDI ids per month index]} (monthly_org_kdi) and
    {key: [the same plus the ids of departures' unknown length of service]}: every base row added to its
    government, department, DOD agency and subelement."""
    vec = {k: [[0] * len(F) for _ in range(n_months)] for k in ent}
    kdi = {k: [set() for _ in range(n_months)] for k in ent}
    flags = {k: [set() for _ in range(n_months)] for k in ent}
    for m, d, a, s, v, ids, los_ids in base:
        i = midx[m]
        keys = ['GOV', d] + ([f'DOD-{a}'] if d == 'DOD' else []) + [sub_key(s, a)]
        for k in keys:
            if k not in vec:
                sys.exit(f'cubes NOT built: organization {k} ({d}/{a}/{s!r}) is not in entities.csv')
            row = vec[k][i]
            for j, x in enumerate(v):
                row[j] += x
            kdi[k][i].update(ids)
            flags[k][i].update(ids)
            flags[k][i].update(los_ids)
    return vec, kdi, flags


def active(v):
    return bool(v[FI['headcount']] or v[FI['hires']] or v[FI['departures']])


def first_index(vs):
    """First month index with headcount or any flow; None when the entity has none (spec section 1, D-018)."""
    return next((i for i in range(len(vs)) if active(vs[i])), None)


def last_index(vs):
    """Last month index with headcount or any flow; None when the entity has none."""
    return next((i for i in range(len(vs) - 1, -1, -1) if active(vs[i])), None)


def periods(months):
    """[(grain, label, fiscal year, quarter, [month indexes expected])]; indexes may exceed the published range."""
    first, last = months[0], months[-1]
    def idx(y, mo):
        return (y - first.year) * 12 + mo - first.month
    out = [('month', ym(m), fy_of(m), fq_of(m), [i]) for i, m in enumerate(months)]
    fys = list(range(fy_of(first), fy_of(last) + 1))
    for fy in fys:
        for qq in range(1, 5):
            cal = [((fy - 1, 10 + j) if j < 3 else (fy, j - 2)) for j in range(12)][(qq - 1) * 3: qq * 3]
            ix = [idx(y, mo) for y, mo in cal]
            if any(0 <= i < len(months) for i in ix):
                out.append(('quarter', f'FY{fy}Q{qq}', fy, qq, ix))
    for fy in fys:
        cal = [((fy - 1, 10 + j) if j < 3 else (fy, j - 2)) for j in range(12)]
        out.append(('fy', f'FY{fy}', fy, None, [idx(y, mo) for y, mo in cal]))
    return out


def rate_part(vs, ix, factor):
    """(attrition numerator, hire numerator, denominator, months, small base) over month indexes ix: numerators are
    sums times factor, the denominator is the mean month-end headcount; an empty rate when that mean is 0."""
    den = sum(vs[i][FI['headcount']] for i in ix) / len(ix)
    if den == 0:
        return None, None, None, len(ix), None
    return (r4(sum(vs[i][FI['departures']] for i in ix) * factor), r4(sum(vs[i][FI['hires']] for i in ix) * factor),
            r4(den), len(ix), den < SMALL_BASE)


def row_values(vs, ks, pub, months, ctx, grain, start):
    """Every figure of one period over the published month indexes pub (in order), for an entity whose rows begin at
    month index start. ks: KDI ids per month, including those of departures' unknown length of service."""
    last = pub[-1]
    flows = {c: sum(vs[i][FI[c]] for i in pub) for c in FLOWS}
    known = sum(vs[i][FI['yos_known']] for i in pub)
    issue = sum(vs[i][FI['yos_unknown_issue']] for i in pub)
    ids = set()
    for i in pub:
        ids |= ks[i]
    dep = flows['departures']
    out = {
        'file_version': [ctx['fv'][i] for i in pub],
        'provisional': any(i in ctx['prov'] for i in pub),
        'reissued': any(ym(months[i]) in ctx['reissued'] for i in pub),
        'opm_incomplete': 'KDI-006' in ids,
        'kdi_ids': sorted(ids),
        'headcount': vs[last][FI['headcount']],
        **flows,
        'net_flow': flows['hires'] - flows['departures'],
        'years_of_service_lost': round(sum(vs[i][FI['los_tenths']] for i in pub) / 10, 1),
        'yos_known': known, 'yos_unknown_issue': issue,
        'yos_unknown_missing': sum(vs[i][FI['yos_unknown_missing']] for i in pub),
        'years_of_service_lost_coverage': r4(known / dep) if dep else None,
    }
    a = rate_part(vs, list(range(last - 11, last + 1)), 1) if last - 11 >= start else (None,) * 5
    b = rate_part(vs, pub, 1) if grain == 'fy' else (None,) * 5
    c = rate_part(vs, pub, 12 / len(pub)) if grain != 't12' else (None,) * 5
    for m, t in (('a', a), ('b', b), ('c', c)):
        out.update({f'attrition_{m}_num': t[0], f'hire_{m}_num': t[1], f'rate_{m}_den': t[2], f'rate_{m}_months': t[3],
                    f'rate_{m}_small_base': t[4]})
    return out


RATE_COLS = [c for m in 'abc' for c in (f'attrition_{m}_num', f'hire_{m}_num', f'rate_{m}_den', f'rate_{m}_months', f'rate_{m}_small_base')]
CORE_COLUMNS = (['entity', 'grain', 'period', 'fiscal_year', 'fiscal_quarter', 'period_first_month', 'period_last_month',
                 'months_in_period', 'months_published', 'time_basis', 'file_version',
                 'provisional', 'partial', 'reissued', 'opm_incomplete', 'kdi_ids',
                 'headcount', 'headcount_change'] + FLOWS + ['net_flow',
                 'years_of_service_lost', 'yos_known', 'yos_unknown_issue', 'yos_unknown_missing', 'years_of_service_lost_coverage']
                + RATE_COLS)
COMPARE_COLUMNS = (['parent', 'child_level', 'child', 'grain', 'period', 'fiscal_year', 'period_first_month', 'period_last_month',
                    'months_in_period', 'months_published', 'time_basis',
                    'provisional', 'partial', 'reissued', 'opm_incomplete', 'kdi_ids',
                    'headcount', 'hires', 'departures', 'acc_transfer_in', 'acc_new_hire', 'sep_transfer_out', 'sep_drp']
                   + [f'sep_{c}_nondrp' for c in SEP] + RATE_COLS)


def core_rows(key, vs, ks, start, end, months, ctx):
    """All period rows of one entity: stocks take the period's last published month, flows are summed, rates are
    ratio-of-sums (methods A, B, C). Rows begin at the entity's first month (start) and stop at its last (end)."""
    rows, prev = [], {}
    for grain, label, fy, qq, exp in ctx['periods']:
        pub = [i for i in exp if start <= i <= end]
        if not pub:
            continue
        v = row_values(vs, ks, pub, months, ctx, grain, start)
        first = exp[0]
        row = {'entity': key, 'grain': grain, 'period': label, 'fiscal_year': fy,
               'fiscal_quarter': qq if grain != 'fy' else None,
               'period_first_month': ctx['label'](first), 'period_last_month': ym(months[pub[-1]]),
               'months_in_period': len(exp), 'months_published': len(pub), 'time_basis': 'effective',
               'partial': len(pub) < len(exp), **v,
               'headcount_change': v['headcount'] - prev[grain] if grain in prev else None}
        prev[grain] = v['headcount']
        rows.append([row[c] for c in CORE_COLUMNS])
    return rows


def compare_rows(parent, children, vec, kdi, starts, ends, months, ctx):
    """One row per child per period: every fiscal year the child has rows in, and the trailing 12 months ending at
    the latest month for each child whose rows reach it (partial, over its own months, when the child began inside
    the window)."""
    rows = []
    latest = len(months) - 1
    fy_periods = [p for p in ctx['periods'] if p[0] == 'fy']
    for level, key in children:
        start, end = starts[key], ends[key]
        if end is None:
            continue
        vs, ks = vec[key], kdi[key]
        for grain, label, fy, _, exp in fy_periods:
            pub = [i for i in exp if start <= i <= end]
            if not pub:
                continue
            v = row_values(vs, ks, pub, months, ctx, 'fy', start)
            row = {'parent': parent, 'child_level': level, 'child': key, 'grain': 'fy', 'period': label, 'fiscal_year': fy,
                   'period_first_month': ctx['label'](exp[0]), 'period_last_month': ym(months[pub[-1]]),
                   'months_in_period': 12, 'months_published': len(pub), 'time_basis': 'effective',
                   'partial': len(pub) < 12, **v}
            rows.append([row[c] for c in COMPARE_COLUMNS])
        if end == latest and latest >= 11:
            pub = list(range(max(start, latest - 11), latest + 1))
            v = row_values(vs, ks, pub, months, ctx, 't12', start)
            row = {'parent': parent, 'child_level': level, 'child': key, 'grain': 't12', 'period': ym(months[latest]),
                   'fiscal_year': None, 'period_first_month': ym(months[latest - 11]), 'period_last_month': ym(months[latest]),
                   'months_in_period': 12, 'months_published': len(pub), 'time_basis': 'effective', 'partial': len(pub) < 12,
                   **v}
            rows.append([row[c] for c in COMPARE_COLUMNS])
    return rows


# ---------------------------------------------------------------- reconciliation (spec section 8, D-009)
def reconciliation(ent, vec, kdi, starts, months, ab_sb):
    """Government and department fiscal years: gap = headcount change - net flow. Headcount at the year's last
    published month minus the month before the year's first month, flows from the year's first month; FY2012 starts
    at Oct 2011, the first file, with flows from Nov 2011. In an entity's first fiscal year the year starts at the
    entity's first month (D-018): the month before holds no rows (headcount 0) and the first month's flows count.
    Months without rows after the first count 0. Average = mean of the year's month-end headcounts from the
    year's first month."""
    out = []
    keys = ['GOV'] + sorted(k for k, e in ent.items() if e['level'] == 'department')
    fys = sorted({fy_of(m) for m in months})
    for k in keys:
        vs, first = vec[k], starts[k]
        if first is None:
            continue
        for fy in fys:
            ix = [i for i, m in enumerate(months) if fy_of(m) == fy and i >= first]
            if not ix:
                continue
            start = ix[0] if ix[0] == 0 else ix[0] - 1
            flow_ix = [i for i in ix if i > start]
            end = ix[-1]
            h0, h1 = vs[start][FI['headcount']], vs[end][FI['headcount']]
            hires = sum(vs[i][FI['hires']] for i in flow_ix)
            deps = sum(vs[i][FI['departures']] for i in flow_ix)
            avg = sum(vs[i][FI['headcount']] for i in ix) / len(ix)
            if not (h0 or h1 or hires or deps or avg):
                continue
            gap = (h1 - h0) - (hires - deps)
            pct = 100.0 * gap / avg if avg else None
            over = abs(gap) > BREAK_PEOPLE and (avg == 0 or abs(gap) > BREAK_PCT / 100 * avg)
            if not over:
                continue
            drp = sum(vs[i][FI['sep_drp']] for i in flow_ix)
            dep_end, drp_end = vs[end][FI['departures']], vs[end][FI['sep_drp']]
            dep_start, drp_start = vs[start][FI['departures']], vs[start][FI['sep_drp']]
            adj = gap - dep_end + dep_start
            hints = []
            if abs(adj) <= abs(gap) / 2:
                hints.append(f'month-end timing: {dep_end:,} departures effective {ym(months[end])} (DRP {drp_end:,}) are still on '
                             f'that file and {dep_start:,} effective {ym(months[start])} (DRP {drp_start:,}) leave it inside the '
                             f'year; gap without them {adj:+,}')
            if h1 == 0 and h0 > 0:
                lm = max((i for i in range(len(months)) if vs[i][FI['headcount']]), default=None)
                hints.append(f'headcount leaves the file after {ym(months[lm])} without matching departures (entity ends)')
            if h0 == 0 and h1 > 0:
                fm = min(i for i in range(len(months)) if vs[i][FI['headcount']])
                hints.append(f'headcount first appears in {ym(months[fm])} without matching hires (entity starts)')
            depts = [k] if k != 'GOV' else None
            ab = sum(n[0] for (d, m), n in ab_sb.items() if (depts is None or d in depts) and m in {months[i] for i in flow_ix})
            sb = sum(n[1] for (d, m), n in ab_sb.items() if (depts is None or d in depts) and m in {months[i] for i in flow_ix})
            if ab and ab >= abs(gap) / 4:
                hints.append(f'mass transfers in (AB) {ab:,} against mass transfers out (SB) {sb:,}')
            elif sb and sb >= abs(gap) / 4:
                hints.append(f'mass transfers out (SB) {sb:,} against mass transfers in (AB) {ab:,}')
            flagged = sorted(kdi[k][start] | kdi[k][end])
            if flagged:
                hints.append(f"start or end month carries {', '.join(flagged)}")
            mg = [((vs[i][FI['headcount']] - vs[i - 1][FI['headcount']]) - (vs[i][FI['hires']] - vs[i][FI['departures']]), i)
                  for i in flow_ix]
            g, gi = max(mg, key=lambda x: (abs(x[0]), -x[1]))
            if not hints or abs(g) >= abs(gap) / 2:
                hints.append(f'largest monthly gap {ym(months[gi])} {g:+,} (headcount change {vs[gi][FI["headcount"]] - vs[gi - 1][FI["headcount"]]:+,}, '
                             f'net flow {vs[gi][FI["hires"]] - vs[gi][FI["departures"]]:+,})')
            if avg < SMALL_BASE:
                hints.append(f'small base (average headcount {avg:,.1f})')
            out.append({'level': ent[k]['level'], 'entity': k, 'name': ent[k]['name'], 'fiscal_year': fy,
                        'months_published': len(ix), 'start_month': ym(months[start]), 'end_month': ym(months[end]),
                        'headcount_start': h0, 'headcount_end': h1, 'headcount_change': h1 - h0, 'hires': hires,
                        'departures': deps, 'net_flow': hires - deps, 'gap': gap, 'avg_headcount': round(avg, 1),
                        'gap_pct': None if pct is None else round(pct, 2), 'drp_departures': drp,
                        'departures_end_month': dep_end, 'departures_start_month': dep_start, 'gap_without_timing': adj,
                        'cause_hint': '; '.join(hints) or 'no cause found in the data'})
    out.sort(key=lambda r: (r['fiscal_year'], r['level'] != 'government', r['entity']))
    return out


# ---------------------------------------------------------------- column dictionaries
METHOD = {'a': "method A, trailing 12 months ending in period_last_month (null before the 12th month, Sep 2012, and "
               "before the entity's 12th month)",
          'b': 'method B, fiscal year only (null at month and quarter grain); a partial fiscal year is year to date '
               'over its published months, not annualized',
          'c': 'method C, annualized per period: sums times 12 / rate_c_months over its published months'}


def column_dictionary(columns, cube):
    d = {
        'entity': ('dimension', "entity key: 'GOV', a department_code, 'DOD-' + a DOD agency_code, or a subelement key "
                                "(agency_subelement_code with '*' as '_', the blank code as <agency>_NR); see entities in this meta"),
        'parent': ('dimension', 'parent entity key of every row in the file'),
        'child_level': ('dimension', "'department', 'agency' (DOD only) or 'subelement'"),
        'child': ('dimension', 'child entity key (same keys as the core cube)'),
        'grain': ('dimension', "'month', 'quarter' (fiscal) or 'fy' (FY2025 = Oct 2024 to Sep 2025)" if cube == 'core' else
                               "'fy' (fiscal year) or 't12' (the trailing 12 months ending at period_last_month)"),
        'period': ('dimension', "'YYYY-MM', 'FYyyyyQn' or 'FYyyyy'" if cube == 'core' else "'FYyyyy', or for t12 the last month 'YYYY-MM'"),
        'fiscal_year': ('dimension', 'fiscal year of the period; null for t12'),
        'fiscal_quarter': ('dimension', 'fiscal quarter 1 to 4 (Q1 = Oct to Dec); null at fy grain'),
        'period_first_month': ('dimension', 'first calendar month of the period (YYYY-MM), published or not'),
        'period_last_month': ('dimension', 'last published month of the period up to the entity\'s last month: the month stocks are taken from'),
        'months_in_period': ('dimension', 'calendar months in the period: 1, 3 or 12'),
        'months_published': ('dimension', "months of the period with a published employment file, from the entity's first month to its last"),
        'time_basis': ('dimension', "'effective': flows counted by personnel_action_effective_date_yyyymm (invariant 6)"),
        'file_version': ('dimension', "one entry per published month of the period: 'YYYY-MM eN aN sN' = employment, "
                                      'accessions and separations file versions in the current manifest'),
        'provisional': ('flag', f'the period contains any of the newest {PROVISIONAL_MONTHS} months (invariant 8)'),
        'partial': ('flag', "the period has months not yet published, or months before the entity's first month or after its last"),
        'reissued': ('flag', 'a month of the period changed file version since the previous manifest '
                             '(revision_baseline.json); false on the first build, which is the baseline'),
        'opm_incomplete': ('flag', 'a month of the period is one OPM marks incomplete for this entity (KDI-006: DOD entities '
                                   'and the government, Jun and Jul 2026)'),
        'kdi_ids': ('flag', 'known data issue ids (pipeline/known_data_issues.csv) touching a month of the period: '
                            'entity-month flags of the entity and the entities inside it, and KDI-001 when a departure '
                            "of the period has a length of service treated as unknown (KDI-001, KDI-009)"),
        'headcount': ('stock', 'rows in the employment file of period_last_month, as published; 0 when the entity has none that month'),
        'headcount_change': ('stock_change', 'headcount minus the headcount of the previous period of the same grain and '
                                             'entity; null for the first period; not derived from flows (invariant 7)'),
        'hires': ('flow', 'accession rows effective in the period (new hires and transfers in)'),
        'departures': ('flow', 'separation rows effective in the period (every code; transfers out and DRP included)'),
        'sep_drp': ('flow', "departures with drp_indicator = 'Y', any code: an overlay on the six categories, and with the six "
                            '_nondrp columns the seventh reason'),
        'net_flow': ('flow', 'hires minus departures; not derived from or reconciled to headcount change (invariant 7)'),
        'years_of_service_lost': ('flow', 'sum of length_of_service_years (years, one decimal, as published) over departures '
                                          'effective in the period; null values and KDI-001 and KDI-009 values are left out, see coverage'),
        'yos_known': ('flow', 'departures with a known length_of_service_years (not null, not KDI-001 or KDI-009): the coverage numerator'),
        'yos_unknown_issue': ('flow', 'departures whose length_of_service_years is a KDI-001 or KDI-009 value, treated as unknown'),
        'yos_unknown_missing': ('flow', 'departures with no length_of_service_years published'),
        'years_of_service_lost_coverage': ('coverage', 'yos_known / departures for years_of_service_lost; null when there are '
                                                       'no departures'),
    }
    for c in SEP:
        d[f'sep_{c}'] = ('flow', f'departures with separation code {SEP_CODES[c]}; the six categories partition departures')
        d[f'sep_{c}_nondrp'] = ('flow', f"departures with separation code {SEP_CODES[c]} and drp_indicator not 'Y'; sep_drp plus "
                                        'the six _nondrp columns partition departures (the seven reasons)')
    for c in ACC:
        d[f'acc_{c}'] = ('flow', f'hires with accession code {ACC_CODES[c]}; the two categories partition hires')
    for m in 'abc':
        d[f'attrition_{m}_num'] = ('rate_numerator', f'attrition rate numerator, {METHOD[m]}: departures; rate = '
                                                     f'attrition_{m}_num / rate_{m}_den')
        d[f'hire_{m}_num'] = ('rate_numerator', f'hire rate numerator, {METHOD[m]}: hires; rate = hire_{m}_num / rate_{m}_den')
        d[f'rate_{m}_den'] = ('rate_denominator', f'shared denominator of the attrition and hire rates, {METHOD[m]}: mean of '
                                                  f'the month-end headcounts of rate_{m}_months months; null, with null '
                                                  'numerators and flag, when that mean is 0 (never 0/0)')
        d[f'rate_{m}_months'] = ('rate_denominator', f'number of month-end headcounts averaged into rate_{m}_den')
        d[f'rate_{m}_small_base'] = ('flag', f'rate_{m}_den < {SMALL_BASE} (invariant 9): shown with a flag, never hidden; '
                                             'null when the rate is empty')
    if cube == 'compare':
        for m in 'bc':
            d[f'rate_{m}_den'] = (d[f'rate_{m}_den'][0], d[f'rate_{m}_den'][1] + '; fy rows only (null on t12 rows, where '
                                  'method A is the window itself)')
    out = []
    for c in columns:
        kind, desc = d[c]
        e = {'name': c, 'kind': kind, 'description': desc}
        if c in ('years_of_service_lost', 'yos_known', 'yos_unknown_issue', 'yos_unknown_missing'):
            e['source_fields'] = ['length_of_service_years']
        if c == 'years_of_service_lost':
            e['coverage_column'] = 'years_of_service_lost_coverage'
        elif c in e.get('source_fields', []) or c.startswith('yos_'):
            e['coverage_part_of'] = 'years_of_service_lost'
        if c == 'years_of_service_lost_coverage':
            e['coverage_for'] = 'years_of_service_lost'
        out.append(e)
    return out


# ---------------------------------------------------------------- main
def main():
    check_crosswalks()
    os.makedirs(f'{OUT}/core', exist_ok=True)
    os.makedirs(f'{OUT}/compare', exist_ok=True)
    con = duckdb.connect(DB, read_only=True, config={'memory_limit': '1500MB', 'threads': 4,
                                                     'temp_directory': 'warehouse/duckdb_tmp'})
    months = [r[0] for r in con.execute('SELECT DISTINCT month FROM monthly_org ORDER BY 1').fetchall()]
    if any((b.year * 12 + b.month) - (a.year * 12 + a.month) != 1 for a, b in zip(months, months[1:])):
        sys.exit('cubes NOT built: months are not contiguous')
    base = load_base(con)
    ab_sb = mass_transfers(con)
    con.close()
    print(f'read {len(base):,} organization-months in {time.time() - T0:.1f}s', flush=True)

    ent = entity_table()
    midx = {m: i for i, m in enumerate(months)}
    vec, kdi, flags = entity_months(base, ent, len(months), midx)
    starts = {k: first_index(vec[k]) for k in ent}
    ends = {k: last_index(vec[k]) for k in ent}
    mhash, vers = manifest_hash(), versions_by_month()
    bl = revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    first = months[0]
    ctx = {'periods': periods(months),
           'prov': set(range(len(months) - PROVISIONAL_MONTHS, len(months))),
           'reissued': {m for m, v in vers.items() if prior and m in prior and prior[m] != v},
           'fv': [f"{ym(m)} e{vers[ym(m)]['employment']} a{vers[ym(m)]['accessions']} s{vers[ym(m)]['separations']}" for m in months],
           'label': lambda i: f'{first.year + (first.month - 1 + i) // 12:04d}-{(first.month - 1 + i) % 12 + 1:02d}'}

    # core: one file per entity
    core_files, written = {}, 0
    for k in ent:
        if ends[k] is None:
            continue
        rows = core_rows(k, vec[k], flags[k], starts[k], ends[k], months, ctx)
        rel = f'core/{k}.json'
        written += write_if_changed(f'{OUT}/{rel}', dumps_compact({'cube': 'core', 'entity': k, 'columns': CORE_COLUMNS, 'rows': rows}))
        core_files[k] = {'path': rel, 'sha256': sha(f'{OUT}/{rel}'), 'bytes': os.path.getsize(f'{OUT}/{rel}'), 'rows': len(rows)}
    print(f'core: {len(core_files)} files ({written} rewritten) at {time.time() - T0:.1f}s', flush=True)

    # compare: one file per parent
    parents = {'GOV': [('department', k) for k in ent if ent[k]['level'] == 'department']}
    for k, e in ent.items():
        if e['level'] == 'subelement':
            parents.setdefault(e['department'], []).append(('subelement', k))
        elif e['level'] == 'agency':
            parents.setdefault('DOD', []).append(('agency', k))
    cmp_files, written = {}, 0
    for p in ['GOV'] + sorted(k for k in parents if k != 'GOV'):
        ch = sorted(parents[p], key=lambda x: ({'department': 0, 'agency': 1, 'subelement': 2}[x[0]], x[1]))
        rows = compare_rows(p, ch, vec, flags, starts, ends, months, ctx)
        rel = f'compare/{p}.json'
        written += write_if_changed(f'{OUT}/{rel}', dumps_compact({'cube': 'compare', 'parent': p, 'columns': COMPARE_COLUMNS, 'rows': rows}))
        cmp_files[p] = {'path': rel, 'sha256': sha(f'{OUT}/{rel}'), 'bytes': os.path.getsize(f'{OUT}/{rel}'), 'rows': len(rows),
                        'children': len(ch)}
    print(f'compare: {len(cmp_files)} files ({written} rewritten) at {time.time() - T0:.1f}s', flush=True)

    # this script's own stale outputs (entities no longer present, interrupted writes)
    for sub, keep in (('core', core_files), ('compare', cmp_files)):
        for f in sorted(os.listdir(f'{OUT}/{sub}')):
            if f.endswith('.tmp') or (f.endswith('.json') and f[:-5] not in keep):
                os.remove(f'{OUT}/{sub}/{f}')
                print(f'removed stale {sub}/{f}')

    # reconciliation candidates
    rec = reconciliation(ent, vec, kdi, starts, months, ab_sb)
    cols = list(rec[0]) if rec else ['level', 'entity', 'fiscal_year', 'gap']
    import io
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(cols)
    for r in rec:
        w.writerow(['' if r[c] is None else r[c] for c in cols])
    write_if_changed(f'{OUT}/known_breaks_candidates.csv', buf.getvalue())

    # metas
    signed = known_breaks_signed()
    kdis = [r for r in csv.DictReader(open(KDI_FILE, encoding='utf-8')) if r['status'] == 'active']
    def kdi_scope(files, col_kdi, entity_of):
        scope = {}
        for k, fi in files.items():
            data = json.load(open(f"{OUT}/{fi['path']}"))
            ci = data['columns'].index(col_kdi)
            for r in data['rows']:
                for i in r[ci]:
                    s = scope.setdefault(i, {'rows': 0, 'entities': set()})
                    s['rows'] += 1
                    s['entities'].add(entity_of(data, r))
        return {i: {'rows': s['rows'], 'entities': sorted(s['entities'])} for i, s in sorted(scope.items())}

    def size_stats(files):
        big = max(files.items(), key=lambda x: (x[1]['bytes'], x[0]))
        tot = sum(f['bytes'] for f in files.values())
        return {'files': len(files), 'total_bytes': tot, 'mean_bytes': round(tot / len(files)),
                'largest': {'key': big[0], 'bytes': big[1]['bytes']}}

    def digest(files):
        return hashlib.sha256(''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path'])).encode()).hexdigest()

    common = {
        'manifest_sha256': mhash,
        'manifest_hash_method': 'sha256 of data/opm_manifest.json canonical content: records sorted by (dataset, filename), '
                                'json.dumps(sort_keys=True, separators=(",", ":"))',
        'spec': 'docs/metric-spec.md (signed, D-014, D-015, D-018); docs/cube-plan.md (signed, D-016)',
        'time_basis': 'effective',
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'provisional_months': [ym(months[i]) for i in sorted(ctx['prov'])],
        'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': {'file': 'revision_baseline.json', 'manifest_sha256': bl['manifest_sha256'],
                              'prior_manifest_sha256': bl.get('prior_manifest_sha256')},
        'small_base_threshold': SMALL_BASE,
        'known_breaks': {'signed_file': KNOWN_BREAKS, 'signed': signed,
                         'rule': f'|gap| > {BREAK_PCT:g}% of average month-end headcount and > {BREAK_PEOPLE} people (D-009), '
                                 'government and department fiscal years',
                         'candidates_file': 'known_breaks_candidates.csv', 'candidates': len(rec)},
        'known_data_issues': {'file': KDI_FILE, 'sha256': sha(KDI_FILE),
                              'applied': sorted({(r['id'], r['treatment'], r['decision']) for r in kdis})},
    }
    common['known_data_issues']['applied'] = [{'id': i, 'treatment': t, 'decision': d} for i, t, d in common['known_data_issues']['applied']]
    gov_first = core_files['GOV']['bytes'] + cmp_files['GOV']['bytes']
    core_meta = {'cube': 'core',
                 'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows": [[values in column order]]}',
                 **common,
                 'grains': list(GRAINS),
                 'entities': {k: {'level': e['level'], 'code': e['code'], 'parent': e['parent'], 'name': e['name'],
                                  'first_month': ym(months[starts[k]]) if starts[k] is not None else None,
                                  'last_month': ym(months[ends[k]]) if ends[k] is not None else None}
                              for k, e in ent.items()},
                 'entities_without_rows': sorted(k for k in ent if ends[k] is None),
                 'kdi_in_scope': kdi_scope(core_files, 'kdi_ids', lambda d, r: d['entity']),
                 'columns': column_dictionary(CORE_COLUMNS, 'core'),
                 'files': core_files, 'files_sha256': digest(core_files),
                 'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
                 'size': {**size_stats(core_files), 'gov_first_load_bytes': gov_first,
                          'gov_first_load_files': ['core/GOV.json', 'compare/GOV.json']}}
    cmp_meta = {'cube': 'compare',
                'format': 'one JSON file per parent, files[<key>].path: {"cube", "parent", "columns", "rows": [[values in column order]]}',
                **common,
                'grains': ['fy', 't12'],
                't12_window': {'last_month': ym(months[-1]), 'first_month': ym(months[-12]),
                               'note': 'the trailing 12 months ending at the latest month, for each child whose rows reach it; partial, '
                                        'over its own months, for a child whose rows begin inside the window'},
                'parents': {p: {'children': f['children']} for p, f in cmp_files.items()},
                'kdi_in_scope': kdi_scope(cmp_files, 'kdi_ids', lambda d, r: r[2]),
                'columns': column_dictionary(COMPARE_COLUMNS, 'compare'),
                'files': cmp_files, 'files_sha256': digest(cmp_files),
                'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
                'size': {**size_stats(cmp_files), 'gov_first_load_bytes': gov_first}}
    for name, meta in (('core', core_meta), ('compare', cmp_meta)):
        write_if_changed(f'{OUT}/{name}.meta.json', dumps_meta(meta))
    tot = core_meta['size']['total_bytes'] + cmp_meta['size']['total_bytes']
    print(f"core {core_meta['size']['files']} files {core_meta['size']['total_bytes']:,} B (largest {core_meta['size']['largest']}); "
          f"compare {cmp_meta['size']['files']} files {cmp_meta['size']['total_bytes']:,} B (largest {cmp_meta['size']['largest']}); "
          f"total {tot:,} B; GOV first load {gov_first:,} B; {len(rec)} known-break candidates; {time.time() - T0:.1f}s")


if __name__ == '__main__':
    main()
