"""Build the leaving, joining, admin and appointments cubes from warehouse/opm.duckdb into warehouse/cubes/ (staging;
never web/data/).

Usage (from anywhere):  .venv/bin/python pipeline/build_breakdowns.py
Reads the monthly aggregates (monthly_org, monthly_org_kdi, emp_dim_month) and grouped passes over the stored action
rows (v_accessions, v_separations), never the employment files, so one run fits a single shell call. Idempotent and
deterministic: a file is rewritten only when its bytes change, and no output carries a build time.

Definitions: docs/metric-spec.md (signed; sections 2, 3, 4, 9), with the definitions it adopts (who is leaving and
who is joining: groups, unknowns, structural zeros, shares, hire rate; administrations, months in office, employee
change, running flows, annualized departure rate, why people left with DRP as a seventh reason; appointment groups).
Container: docs/cube-plan.md (signed, section 2). Breakdowns are at government, department and DOD-agency level only.

Entities (file keys): GOV, each department_code with rows, DOD-AF, DOD-AR, DOD-DD, DOD-NV. An entity's span is its
first to last month with headcount or an effective hire or departure, as in the core cube.

Cubes (one file per entity key, plus <cube>.meta.json)
  leaving/<key>.json       departures by group (age, los, supervisory, education, veteran, grade), with the six
                           categories and the DRP overlay, the group's headcount and a departure rate per group
  joining/<key>.json       hires by group (age, education, veteran, grade: rated; prior_service, pathways: shares of
                           hires with a known value, no rate), with the two hire categories
      grains  fy       fiscal year; rate = method B (year to date when partial, not annualized)
              t12      the 12 months ending at each month from the entity's 12th month; rate = method A
              admin    an administration's whole window (Trump II so far); rate annualized (x 12 / months)
              admin_n  months 1..N in office for every administration, N = the open administration's months so far
      rate    count in the window / mean month-end headcount of the group over the window's published months
              (admin grains: count x 12 / months). Unknown values: counts only. A group with mean headcount 0 over
              the window is a structural zero: empty rate, rate_not_applicable true, never a small-base flag.
      periods each file also holds a period table (period_columns, periods): one row per window with its months,
              flags and known data issue ids, so the per-group rows do not repeat them.
  admin/<key>.json         per administration x months in office N (month 1 = January of the inauguration year,
                           month 0 = the month before): headcount at month 0 and N, the change, running hires,
                           departures, categories, DRP and the six non-DRP reasons over months 1..N, annualized
                           departure and hire rate numerators over the mean month-end headcount of months 1..N.
                           An entity whose span begins after month 0 has no rows for that administration (it did
                           not exist when the administration took office); rows stop at the entity's last month.
  matrix/matrix.json       built at the end by pipeline/build_matrix.py: departments and DOD agencies x administration x
                           months in office, every value copied from admin (docs/cube-plan.md amendment 1)
  appointments/<key>.json  hires and departures by appointment group (pipeline/crosswalks/appointment_groups.csv):
                           'all', the groups (partitioning all, unknown included) and the political subgroups
                           (partitioning political), at fy, t12 and admin grain; counts only, no rates.
Group values are codes; labels are copy, signed with the page specs (label_status pending_signoff).
"""
import csv, hashlib, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cubes as bc   # helpers only; its main() is not run on import

import duckdb

T0 = time.time()
ROOT, OUT, XW = bc.ROOT, bc.OUT, bc.XW
os.chdir(ROOT)
SEP, ACC = bc.SEP, bc.ACC
LEAVING_DIMS = ['age', 'los', 'supervisory', 'education', 'veteran', 'grade']   # spec section 9
JOINING_RATED = ['age', 'education', 'veteran', 'grade']                         # D-100 adapted (no occupation)
JOINING_SHARES = ['prior_service', 'pathways']                                   # D-100: shares, no rate
SHARES_FILE = f'{XW}/joining_shares.csv'
BANDS_FILE = f'{XW}/breakdown_bands.csv'
APPT_FILE = f'{XW}/appointment_groups.csv'
ADMIN_FILE = f'{XW}/administrations.csv'
LEVELS = ('government', 'department', 'agency')
CUBES = ('leaving', 'joining', 'admin', 'appointments')


def q(s):
    return bc.q(s)


def r4(x):
    return bc.r4(x)


# ---------------------------------------------------------------- crosswalks
def band_values():
    """{dimension: [(value, order, role)]} from breakdown_bands.csv (role 'unknown' or 'rated')."""
    out = {}
    for r in csv.DictReader(open(BANDS_FILE, encoding='utf-8')):
        out.setdefault(r['dimension'], []).append((r['value'], int(r['value_order']), 'unknown' if r['rule'] == 'unknown' else 'rated'))
    return {d: sorted(v, key=lambda x: x[1]) for d, v in out.items()}


def share_dims():
    """{dimension: [rows]} from joining_shares.csv, validated: one unknown at most, unique values."""
    out = {}
    for r in csv.DictReader(open(SHARES_FILE, encoding='utf-8')):
        out.setdefault(r['dimension'], []).append(r)
    for d, rs in out.items():
        rs.sort(key=lambda r: int(r['value_order']))
        if len({r['value'] for r in rs}) != len(rs) or sum(r['rule'] == 'unknown' for r in rs) > 1 \
                or any(r['rule'] not in ('codes', 'null', 'unknown') for r in rs) or len({r['source_field'] for r in rs}) != 1:
            sys.exit(f'breakdown cubes NOT built: {SHARES_FILE} dimension {d} is inconsistent')
    if sorted(out) != sorted(JOINING_SHARES):
        sys.exit(f'breakdown cubes NOT built: {SHARES_FILE} dimensions {sorted(out)} != {JOINING_SHARES}')
    return out


def share_case(rs):
    """SQL CASE over v_accessions for one share dimension; a value no rule takes is '__unmapped__' (the build stops)."""
    f = rs[0]['source_field']
    whens = []
    for r in rs:
        if r['rule'] in ('codes', 'unknown'):
            whens.append(f"WHEN {f} IN ({', '.join(q(c) for c in r['codes'].split('|'))}) THEN {q(r['value'])}")
        elif r['rule'] == 'null':
            whens.append(f"WHEN {f} IS NULL THEN {q(r['value'])}")
    return 'CASE ' + ' '.join(whens) + " ELSE '__unmapped__' END"


def appointment_groups():
    """(ordered [{id, level, parent, codes, order, label_status}], {group: parent}) from appointment_groups.csv."""
    rows = list(csv.DictReader(open(APPT_FILE, encoding='utf-8')))
    codes = [r['code'] for r in rows]
    if len(codes) != len(set(codes)):
        sys.exit(f'appointments NOT built: duplicate codes in {APPT_FILE}')
    out = [{'id': 'all', 'level': 'total', 'parent': None, 'codes': codes, 'label_status': None}]
    for r in sorted(rows, key=lambda r: (int(r['group_order']), r['code'])):
        g = next((x for x in out if x['id'] == r['group']), None)
        if g is None:
            g = {'id': r['group'], 'level': 'group', 'parent': 'all', 'codes': [], 'label_status': r['label_status']}
            out.append(g)
        g['codes'].append(r['code'])
    subs = []
    for r in sorted(rows, key=lambda r: (int(r['group_order']), r['code'])):
        if r['subgroup']:
            s = next((x for x in subs if x['id'] == r['subgroup']), None)
            if s is None:
                s = {'id': r['subgroup'], 'level': 'subgroup', 'parent': r['group'], 'codes': [], 'label_status': r['label_status']}
                subs.append(s)
            s['codes'].append(r['code'])
    order = []
    for g in out:
        order.append(g)
        order += [s for s in subs if s['parent'] == g['id']]
    return order


def administrations(months):
    """[(id, name, [month indexes of the window that are published], open)] in file order (spec section 2)."""
    out = []
    for r in csv.DictReader(open(ADMIN_FILE, encoding='utf-8')):
        first = r['first_month']
        last = bc.ym(months[-1]) if r['last_month'] == 'latest' else r['last_month']
        ix = [i for i, m in enumerate(months) if first <= bc.ym(m) <= last]
        out.append((r['id'], r['name'], ix, r['last_month'] == 'latest'))
    return out


# ---------------------------------------------------------------- inputs
def entities_and_core(con, months):
    """Entities (GOV, departments, DOD agencies) with their spans, core monthly vectors and KDI sets (bc helpers)."""
    base = bc.load_base(con)
    ent_all = bc.entity_table()
    midx = {m: i for i, m in enumerate(months)}
    vec, kdi, flags = bc.entity_months(base, ent_all, len(months), midx)
    keep = [k for k, e in ent_all.items() if e['level'] in LEVELS]
    starts = {k: bc.first_index(vec[k]) for k in keep}
    ends = {k: bc.last_index(vec[k]) for k in keep}
    keys = ['GOV'] + sorted(k for k in keep if ent_all[k]['level'] == 'department' and ends[k] is not None) + \
           sorted(k for k in keep if ent_all[k]['level'] == 'agency' and ends[k] is not None)
    ent = {k: ent_all[k] for k in keys}
    return ent, {k: vec[k] for k in keys}, {k: kdi[k] for k in keys}, {k: flags[k] for k in keys}, \
        {k: starts[k] for k in keys}, {k: ends[k] for k in keys}


def keys_of(d, a):
    return ['GOV', d] + ([f'DOD-{a}'] if d == 'DOD' else [])


def band_headcount(con, months, dims):
    """{(key, dim, value): [headcount per month]} from emp_dim_month (department and agency level)."""
    midx = {m: i for i, m in enumerate(months)}
    H = {}
    for m, d, a, dim, v, h in con.execute(f"""SELECT period, department_code, agency_code, dimension, value, sum(headcount)
            FROM emp_dim_month WHERE dimension IN ({', '.join(q(x) for x in dims)}) GROUP BY ALL""").fetchall():
        i = midx[m]
        for k in keys_of(d, a):
            arr = H.get((k, dim, v))
            if arr is None:
                arr = H[(k, dim, v)] = [0] * len(months)
            arr[i] += h
    return H


def band_flows(con, months, view, dim_sql, cats, drp):
    """{(key, dim, value): [[count, categories..., (drp)] per month]} from a grouped, unpivoted pass over the action
    rows (effective month, inside the series)."""
    midx = {m: i for i, m in enumerate(months)}
    sel = ', '.join(f'{sql} AS "{d}"' for d, sql in dim_sql.items())
    cat_sql = ''.join(f", count(*) FILTER (WHERE category = {q(c)})" for c in cats)
    drp_sql = ", count(*) FILTER (WHERE drp_indicator = 'Y')" if drp else ''
    width = 1 + len(cats) + (1 if drp else 0)
    F = {}
    for row in con.execute(f"""SELECT effective_month, department_code, agency_code, dim, v, count(*){cat_sql}{drp_sql}
            FROM (SELECT effective_month, department_code, agency_code, category{', drp_indicator' if drp else ''}, {sel}
                  FROM {view} WHERE NOT effective_before_range)
            UNPIVOT (v FOR dim IN ({', '.join(f'"{d}"' for d in dim_sql)}))
            GROUP BY ALL""").fetchall():
        m, d, a, dim, v = row[:5]
        if v == '__unmapped__':
            sys.exit(f'breakdown cubes NOT built: {view} {dim} has a value no crosswalk rule takes ({bc.ym(m)}, {d})')
        i = midx[m]
        for k in keys_of(d, a):
            arr = F.get((k, dim, v))
            if arr is None:
                arr = F[(k, dim, v)] = [[0] * width for _ in range(len(months))]
            cell = arr[i]
            for j, x in enumerate(row[5:]):
                cell[j] += x
    return F


def los_issue_ids(con, months, view):
    """{key: [set of KDI ids of length-of-service values treated as unknown, per month]} for one action view."""
    midx = {m: i for i, m in enumerate(months)}
    out = {}
    for m, d, a, i_d in con.execute(f"""SELECT DISTINCT effective_month, department_code, agency_code, los_issue_id FROM {view}
            WHERE NOT effective_before_range AND los_known_issue""").fetchall():
        for k in keys_of(d, a):
            out.setdefault(k, [set() for _ in months])[midx[m]].add(i_d)
    return out


def appt_flows(con, months, order):
    """{(key, group): [[hires, departures] per month]}: each action row counted in 'all', its group and its
    subgroup. Stops on an unmapped appointment type."""
    midx = {m: i for i, m in enumerate(months)}
    code_groups = {}
    for g in order:
        for c in g['codes']:
            code_groups.setdefault(c, []).append(g['id'])
    out = {}
    for j, view in enumerate(('v_accessions', 'v_separations')):
        for m, d, a, code, n in con.execute(f"""SELECT effective_month, department_code, agency_code, appointment_type_code, count(*)
                FROM {view} WHERE NOT effective_before_range GROUP BY ALL""").fetchall():
            if code not in code_groups:
                sys.exit(f'appointments NOT built: appointment_type_code {code!r} is not in {APPT_FILE}')
            for k in keys_of(d, a):
                for g in code_groups[code]:
                    arr = out.get((k, g))
                    if arr is None:
                        arr = out[(k, g)] = [[0, 0] for _ in range(len(months))]
                    arr[midx[m]][j] += n
    return out


# ---------------------------------------------------------------- windows
def windows(months, start, end, admins, n_now):
    """[(grain, period, fiscal_year, first label, [published month indexes], months_in_period, partial)] for an
    entity whose span is start..end. Every window is a contiguous index range."""
    out = []
    first = months[0]
    label = lambda i: f'{first.year + (first.month - 1 + i) // 12:04d}-{(first.month - 1 + i) % 12 + 1:02d}'
    for fy in range(bc.fy_of(months[0]), bc.fy_of(months[-1]) + 1):
        exp0 = (fy - 1 - first.year) * 12 + 10 - first.month
        exp = list(range(exp0, exp0 + 12))
        pub = [i for i in exp if start <= i <= end]
        if pub:
            out.append(('fy', f'FY{fy}', fy, label(exp0), pub, 12, len(pub) < 12))
    for last in range(start + 11, end + 1):
        out.append(('t12', bc.ym(months[last]), bc.fy_of(months[last]), bc.ym(months[last - 11]), list(range(last - 11, last + 1)), 12, False))
    for grain in ('admin', 'admin_n'):
        for a_id, _, ix, is_open in admins:
            exp = ix if grain == 'admin' else ix[:n_now]
            if not exp:
                continue
            pub = [i for i in exp if start <= i <= end]
            if pub:
                out.append((grain, a_id, None, bc.ym(months[exp[0]]), pub, len(exp), is_open or len(pub) < len(exp)))
    return out


PERIOD_COLUMNS = ['grain', 'period', 'fiscal_year', 'period_first_month', 'period_last_month', 'months_in_period',
                  'months_published', 'time_basis', 'provisional', 'partial', 'reissued', 'opm_incomplete', 'kdi_ids']


def period_row(w, months, ctx, ids_by_month):
    g, label, fy, first, pub, n_in, partial = w
    ids = set()
    for i in pub:
        ids |= ids_by_month[i]
    return [g, label, fy, first, bc.ym(months[pub[-1]]), n_in, len(pub), 'effective',
            any(i in ctx['prov'] for i in pub), partial, any(bc.ym(months[i]) in ctx['reissued'] for i in pub),
            'KDI-006' in ids, sorted(ids)]


def prefix(arr):
    """Prefix sums of a list of numbers or of equal-length vectors."""
    if arr and isinstance(arr[0], list):
        out = [[0] * len(arr[0])]
        for v in arr:
            out.append([a + b for a, b in zip(out[-1], v)])
        return out
    out = [0]
    for v in arr:
        out.append(out[-1] + v)
    return out


# ---------------------------------------------------------------- leaving and joining
def breakdown_rows(kind, key, wins, dims, Hp, Fp, H, months, width):
    """Rows of one entity for leaving or joining. dims: [(dim, [(value, order, role)])], role rated, unknown or share."""
    rows = []
    zero_v, zero_h = [[0] * width for _ in range(len(months) + 1)], [0] * (len(months) + 1)
    for g, label, fy, first, pub, n_in, partial in wins:
        a, b, n = pub[0], pub[-1], len(pub)
        admin = g in ('admin', 'admin_n')
        for dim, values in dims:
            share_dim = any(role == 'share' for _, _, role in values)
            cells = []
            for v, _, role in values:
                fp = Fp.get((key, dim, v), zero_v)
                f = [x - y for x, y in zip(fp[b + 1], fp[a])]
                cells.append((v, role, f))
            total = sum(c[2][0] for c in cells)
            unk = sum(c[2][0] for c in cells if c[1] == 'unknown')
            known = total - unk
            coverage = r4(known / total) if total else None
            for v, role, f in cells:
                if share_dim:   # no on-board count exists for these groups: no headcount, no rate
                    hc = None
                    rate = [None] * 5
                    share_den = (known or None) if role == 'share' else None
                else:
                    hc = H.get((key, dim, v), zero_h)[b]
                    share_den = None
                    if role == 'unknown':
                        rate = [None] * 5
                    else:
                        hp = Hp.get((key, dim, v), zero_h)
                        den = (hp[b + 1] - hp[a]) / n
                        if den == 0:
                            rate = [None, None, n, None, True]
                        else:
                            rate = [r4(f[0] * 12 / n) if admin else f[0], r4(den), n, den < bc.SMALL_BASE, False]
                row = [g, label, dim, v] + f + [hc] + rate
                if kind == 'joining':
                    row.append(share_den)
                row.append(coverage)
                rows.append(row)
    return rows


def breakdown_columns(kind):
    flows = (['departures'] + [f'sep_{c}' for c in SEP] + ['sep_drp']) if kind == 'leaving' else (['hires'] + [f'acc_{c}' for c in ACC])
    return (['grain', 'period', 'dimension', 'value'] + flows + ['headcount', 'rate_num', 'rate_den', 'rate_months',
            'rate_small_base', 'rate_not_applicable'] + (['share_den'] if kind == 'joining' else []) + ['coverage'])


def breakdown_dictionary(kind):
    cnt = 'departures' if kind == 'leaving' else 'hires'
    d = {
        'grain': ('dimension', "'fy' (fiscal year), 't12' (the 12 months ending at period_last_month), 'admin' (an "
                               "administration's whole window) or 'admin_n' (its months 1..N in office, N = admin_n_months); "
                               'never month or quarter (spec section 9)'),
        'period': ('dimension', "'FYyyyy' at fy grain; 'YYYY-MM' (the window's last month) at t12 grain; the administration id "
                                '(meta administrations) at admin and admin_n grain; the key into the period table'),
        'dimension': ('dimension', 'the breakdown (meta dimensions)'),
        'value': ('dimension', 'value code within the dimension (meta dimensions: order and role); labels are copy, pending sign-off'),
        'departures': ('flow', 'separation rows effective in the window with this value (transfers out and DRP included)'),
        'sep_drp': ('flow', "departures with drp_indicator = 'Y', any code: an overlay on the six categories"),
        'hires': ('flow', 'accession rows effective in the window with this value (new hires and transfers in)'),
        'headcount': ('stock', "rows with this value in the employment file of the period's period_last_month; null in a share "
                               'dimension (no on-board count exists for those groups)'),
        'rate_num': ('rate_numerator', f'{cnt} in the window with this value (admin and admin_n grains: x 12 / rate_months, '
                                       f'annualized); rate = rate_num / rate_den; null for an unknown value, a structural zero '
                                       f'or a share dimension'),
        'rate_den': ('rate_denominator', 'mean month-end headcount with this value over the window\'s published months (fy: '
                                         'method B, year to date when partial; t12: method A); null for an unknown value or a '
                                         'share dimension, and null (never 0) when that mean is 0'),
        'rate_months': ('rate_denominator', 'number of month-end headcounts averaged into rate_den (also set on a structural zero)'),
        'rate_small_base': ('flag', f'rate_den < {bc.SMALL_BASE} (invariant 9); null when there is no rate'),
        'rate_not_applicable': ('flag', 'structural zero: nobody with this value on board in any month of the window, so no rate '
                                        '(never a small-base flag); null for an unknown value or a share dimension'),
        'share_den': ('share_denominator', 'share dimensions only (prior_service, pathways): hires in the window whose value is '
                                           'known; share = hires / share_den; null on unknown rows, on rated dimensions and when '
                                           'no hire has a known value (never 0)'),
        'coverage': ('coverage', f"share of the window's {cnt} whose value for this dimension is known (not the unknown value); "
                                 f'null when there are none'),
    }
    for c in SEP:
        d[f'sep_{c}'] = ('flow', f'departures with separation code {bc.SEP_CODES[c]}; the six categories partition departures')
    for c in ACC:
        d[f'acc_{c}'] = ('flow', f'hires with accession code {bc.ACC_CODES[c]}; the two categories partition hires')
    out = []
    for c in breakdown_columns(kind):
        e = {'name': c, 'kind': d[c][0], 'description': d[c][1]}
        if c == 'value':
            e['coverage_column'] = 'coverage'
        if c == 'coverage':
            e['coverage_for'] = 'value'
        if c == 'rate_num':
            e.update({'denominator': 'rate_den', 'small_base': 'rate_small_base', 'months': 'rate_months'})
        if c == 'share_den':
            e['share_of'] = 'hires'
        out.append(e)
    return out


def period_dictionary():
    d = {
        'grain': ('dimension', 'as in the rows'), 'period': ('dimension', 'as in the rows'),
        'fiscal_year': ('dimension', 'fiscal year of the period (of its last month at t12 grain); null at admin grains'),
        'period_first_month': ('dimension', 'first calendar month of the window (YYYY-MM), published or not'),
        'period_last_month': ('dimension', "last published month of the window within the entity's span: the month stocks are taken from"),
        'months_in_period': ('dimension', 'months in the full window: 12; admin grain: the administration\'s published months '
                                          '(Trump II so far); admin_n grain: N'),
        'months_published': ('dimension', "months of the window with a published employment file within the entity's span"),
        'time_basis': ('dimension', "'effective': flows counted by personnel_action_effective_date_yyyymm (invariant 6)"),
        'provisional': ('flag', f'the window contains any of the newest {bc.PROVISIONAL_MONTHS} months (invariant 8)'),
        'partial': ('flag', "a fiscal year with months not yet published or outside the entity's span; at admin grains, an "
                            'administration still in office (Trump II) or a window cut by the entity\'s span'),
        'reissued': ('flag', 'a month of the window changed file version since the previous manifest (revision_baseline.json)'),
        'opm_incomplete': ('flag', 'a month of the window OPM marks incomplete for this entity (KDI-006)'),
        'kdi_ids': ('flag', 'known data issue ids touching a month of the window: entity-month flags, plus the ids of '
                            'length-of-service values treated as unknown on the cube\'s action rows (KDI-001, KDI-009, KDI-010)'),
    }
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1]} for c in PERIOD_COLUMNS]


# ---------------------------------------------------------------- admin
ADMIN_FLOWS = (['hires', 'departures'] + [f'sep_{c}' for c in SEP] + ['sep_drp'] + [f'sep_{c}_nondrp' for c in SEP]
               + [f'acc_{c}' for c in ACC])
ADMIN_COLUMNS = (['administration', 'months_in_office', 'admin_months', 'month_0', 'month_n', 'time_basis', 'provisional',
                  'partial', 'reissued', 'opm_incomplete', 'kdi_ids', 'headcount_0', 'headcount_n', 'headcount_change']
                 + ADMIN_FLOWS + ['attrition_num', 'hire_num', 'rate_den', 'rate_months', 'rate_small_base'])


def admin_rows(key, vs, ks, start, end, admins, months, ctx):
    """Every administration x months in office N for one entity (no rows for an administration whose month 0 is
    before the entity's first month; rows stop at its last month)."""
    rows, skipped = [], []
    hi = bc.FI['headcount']
    for a_id, _, ix, is_open in admins:
        m0 = ix[0] - 1
        if m0 < start:
            skipped.append(a_id)
            continue
        pub = [i for i in ix if i <= end]
        if not pub:
            continue
        run = {c: 0 for c in ADMIN_FLOWS}
        hsum, ids = 0, set(ks[m0])
        for n, i in enumerate(pub, 1):
            for c in ADMIN_FLOWS:
                run[c] += vs[i][bc.FI[c]]
            hsum += vs[i][hi]
            ids |= ks[i]
            den = hsum / n
            row = {'administration': a_id, 'months_in_office': n, 'admin_months': len(pub), 'month_0': bc.ym(months[m0]),
                   'month_n': bc.ym(months[i]), 'time_basis': 'effective',
                   'provisional': any(x in ctx['prov'] for x in pub[:n]), 'partial': is_open or len(pub) < len(ix),
                   'reissued': any(bc.ym(months[x]) in ctx['reissued'] for x in [m0] + pub[:n]),
                   'opm_incomplete': 'KDI-006' in ids, 'kdi_ids': sorted(ids),
                   'headcount_0': vs[m0][hi], 'headcount_n': vs[i][hi], 'headcount_change': vs[i][hi] - vs[m0][hi], **run}
            if den == 0:
                row.update({'attrition_num': None, 'hire_num': None, 'rate_den': None, 'rate_months': n, 'rate_small_base': None})
            else:
                row.update({'attrition_num': r4(run['departures'] * 12 / n), 'hire_num': r4(run['hires'] * 12 / n),
                            'rate_den': r4(den), 'rate_months': n, 'rate_small_base': den < bc.SMALL_BASE})
            rows.append([row[c] for c in ADMIN_COLUMNS])
    return rows, skipped


def admin_dictionary():
    d = {
        'administration': ('dimension', 'administration id (meta administrations; pipeline/crosswalks/administrations.csv)'),
        'months_in_office': ('dimension', 'N: months in office, month 1 = January of the inauguration year'),
        'admin_months': ('dimension', "published months of the administration's window within the entity's span"),
        'month_0': ('dimension', 'the month before month 1 (YYYY-MM): the baseline of the employee change'),
        'month_n': ('dimension', 'calendar month of month N (YYYY-MM)'),
        'time_basis': ('dimension', "'effective': flows counted by personnel_action_effective_date_yyyymm (invariant 6)"),
        'provisional': ('flag', f'months 1..N contain any of the newest {bc.PROVISIONAL_MONTHS} months (invariant 8)'),
        'partial': ('flag', "the administration is still in office (Trump II), or the entity's rows end inside the window"),
        'reissued': ('flag', 'month 0 or a month of 1..N changed file version since the previous manifest'),
        'opm_incomplete': ('flag', 'month 0 or a month of 1..N is one OPM marks incomplete for this entity (KDI-006)'),
        'kdi_ids': ('flag', 'entity-month known data issue ids of month 0 and months 1..N'),
        'headcount_0': ('stock', 'headcount at month 0'),
        'headcount_n': ('stock', 'headcount at the end of month N'),
        'headcount_change': ('stock_change', 'employee change in office: headcount_n minus headcount_0 (as a percent: / '
                                             'headcount_0); not derived from flows (invariant 7)'),
        'hires': ('flow', 'running sum over months 1..N of accession rows by effective month'),
        'departures': ('flow', 'running sum over months 1..N of separation rows by effective month (transfers out and DRP included)'),
        'sep_drp': ('flow', "running sum of departures with drp_indicator = 'Y': the seventh reason with the six _nondrp columns"),
        'attrition_num': ('rate_numerator', 'departures over months 1..N x 12 / N (annualized departure rate numerator); rate = '
                                            'attrition_num / rate_den'),
        'hire_num': ('rate_numerator', 'hires over months 1..N x 12 / N (annualized hire rate numerator); rate = hire_num / rate_den'),
        'rate_den': ('rate_denominator', 'mean month-end headcount over months 1..N; null (never 0) when that mean is 0'),
        'rate_months': ('rate_denominator', 'N, the months averaged into rate_den'),
        'rate_small_base': ('flag', f'rate_den < {bc.SMALL_BASE} (invariant 9); null when the rate is empty'),
    }
    for c in SEP:
        d[f'sep_{c}'] = ('flow', f'running sum of departures with separation code {bc.SEP_CODES[c]} (DRP included)')
        d[f'sep_{c}_nondrp'] = ('flow', f"running sum of departures with separation code {bc.SEP_CODES[c]} and drp_indicator not "
                                        f"'Y'; with sep_drp the seven reasons partition departures (why people left)")
    for c in ACC:
        d[f'acc_{c}'] = ('flow', f'running sum of hires with accession code {bc.ACC_CODES[c]}')
    out = []
    for c in ADMIN_COLUMNS:
        e = {'name': c, 'kind': d[c][0], 'description': d[c][1]}
        if c in ('attrition_num', 'hire_num'):
            e.update({'denominator': 'rate_den', 'small_base': 'rate_small_base', 'months': 'rate_months'})
        out.append(e)
    return out


# ---------------------------------------------------------------- appointments
APPT_COLUMNS = ['grain', 'period', 'appt_group', 'appt_level', 'hires', 'departures']


def appt_rows(key, wins, order, Ap, months):
    rows = []
    zero = [[0, 0] for _ in range(len(months) + 1)]
    for g, label, fy, first, pub, n_in, partial in wins:
        if g == 'admin_n':
            continue
        a, b = pub[0], pub[-1]
        for grp in order:
            p = Ap.get((key, grp['id']), zero)
            rows.append([g, label, grp['id'], grp['level'], p[b + 1][0] - p[a][0], p[b + 1][1] - p[a][1]])
    return rows


def appt_dictionary():
    d = {
        'grain': ('dimension', "'fy' (fiscal year), 't12' (the 12 months ending at period_last_month) or 'admin' (an "
                               "administration's whole window, Trump II so far)"),
        'period': ('dimension', "'FYyyyy', 'YYYY-MM' (t12: the window's last month) or the administration id; the key into the period table"),
        'appt_group': ('dimension', "'all', an appointment group or a political subgroup (meta groups; codes, labels pending sign-off)"),
        'appt_level': ('dimension', "'total' (all), 'group' (the groups partition all, unknown included) or 'subgroup' "
                                    '(the subgroups partition political)'),
        'hires': ('flow', 'accession rows whose appointment_type_code is in the group, effective in the window (transfers in included)'),
        'departures': ('flow', 'separation rows whose appointment_type_code is in the group, effective in the window '
                               '(transfers out and DRP included)'),
    }
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1]} for c in APPT_COLUMNS]


# ---------------------------------------------------------------- output
def write_cube(name, key, payload, files):
    rel = f'{name}/{key}.json'
    path = f'{OUT}/{rel}'
    changed = bc.write_if_changed(path, bc.dumps_compact(payload))
    files[key] = {'path': rel, 'sha256': bc.sha(path), 'bytes': os.path.getsize(path), 'rows': len(payload['rows'])}
    return changed


def digest(files):
    return hashlib.sha256(''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path'])).encode()).hexdigest()


def size_stats(files):
    big = max(files.items(), key=lambda x: (x[1]['bytes'], x[0]))
    tot = sum(f['bytes'] for f in files.values())
    return {'files': len(files), 'total_bytes': tot, 'mean_bytes': round(tot / len(files)),
            'largest': {'key': big[0], 'bytes': big[1]['bytes']}}


def main():
    bc.check_crosswalks()
    for c in CUBES:
        os.makedirs(f'{OUT}/{c}', exist_ok=True)
    con = duckdb.connect(bc.DB, read_only=True, config={'memory_limit': os.environ.get('OPM_DB_MEMORY', '700MB'), 'threads': 4,
                                                        'temp_directory': 'warehouse/duckdb_tmp'})
    months = [r[0] for r in con.execute('SELECT DISTINCT month FROM monthly_org ORDER BY 1').fetchall()]
    emp_months = [r[0] for r in con.execute('SELECT DISTINCT period FROM emp_dim_month ORDER BY 1').fetchall()]
    if emp_months != months:
        sys.exit('breakdown cubes NOT built: emp_dim_month months differ from monthly_org')
    if con.execute('SELECT count(*) FROM emp_dim_month WHERE agency_code IS NULL').fetchone()[0]:
        sys.exit('breakdown cubes NOT built: emp_dim_month rows without agency_code (rerun pipeline/build_db.py)')
    ent, vec, kdi, flags, starts, ends = entities_and_core(con, months)
    bands = band_values()
    shares = share_dims()
    order = appointment_groups()
    H = band_headcount(con, months, sorted(set(LEAVING_DIMS) | set(JOINING_RATED)))
    Fl = band_flows(con, months, 'v_separations', {d: f'band_{d}' for d in LEAVING_DIMS}, SEP, True)
    Fj = band_flows(con, months, 'v_accessions', {**{d: f'band_{d}' for d in JOINING_RATED},
                                                  **{d: share_case(rs) for d, rs in shares.items()}}, ACC, False)
    acc_los = los_issue_ids(con, months, 'v_accessions')
    Ap = appt_flows(con, months, order)
    con.close()
    print(f'read inputs in {time.time() - T0:.1f}s', flush=True)

    Hp = {k: prefix(v) for k, v in H.items()}
    Flp = {k: prefix(v) for k, v in Fl.items()}
    Fjp = {k: prefix(v) for k, v in Fj.items()}
    App = {k: prefix(v) for k, v in Ap.items()}
    mhash, vers = bc.manifest_hash(), bc.versions_by_month()
    bl = bc.revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    ctx = {'prov': set(range(len(months) - bc.PROVISIONAL_MONTHS, len(months))),
           'reissued': {m for m, v in vers.items() if prior and m in prior and prior[m] != v}}
    admins = administrations(months)
    open_ix = [ix for _, _, ix, o in admins if o]
    n_now = len(open_ix[-1]) if open_ix else None

    leaving_dims = [(d, bands[d]) for d in LEAVING_DIMS]
    joining_dims = [(d, bands[d]) for d in JOINING_RATED] + \
                   [(d, [(r['value'], int(r['value_order']), 'unknown' if r['rule'] == 'unknown' else 'share') for r in shares[d]])
                    for d in JOINING_SHARES]
    files = {c: {} for c in CUBES}
    written = {c: 0 for c in CUBES}
    skipped_admin = {}
    no_ids = [set() for _ in months]
    for k in ent:
        wins = windows(months, starts[k], ends[k], admins, n_now)
        acc_ids = [kdi[k][i] | acc_los.get(k, no_ids)[i] for i in range(len(months))]
        for name, dims, Fp, ids, width in (('leaving', leaving_dims, Flp, flags[k], 2 + len(SEP)),
                                            ('joining', joining_dims, Fjp, acc_ids, 1 + len(ACC))):
            payload = {'cube': name, 'entity': k, 'columns': breakdown_columns(name),
                       'rows': breakdown_rows(name, k, wins, dims, Hp, Fp, H, months, width),
                       'period_columns': PERIOD_COLUMNS, 'periods': [period_row(w, months, ctx, ids) for w in wins]}
            written[name] += write_cube(name, k, payload, files[name])
        rows, skipped = admin_rows(k, vec[k], kdi[k], starts[k], ends[k], admins, months, ctx)
        if skipped:
            skipped_admin[k] = skipped
        written['admin'] += write_cube('admin', k, {'cube': 'admin', 'entity': k, 'columns': ADMIN_COLUMNS, 'rows': rows}, files['admin'])
        aw = [w for w in wins if w[0] != 'admin_n']
        payload = {'cube': 'appointments', 'entity': k, 'columns': APPT_COLUMNS, 'rows': appt_rows(k, aw, order, App, months),
                   'period_columns': PERIOD_COLUMNS, 'periods': [period_row(w, months, ctx, kdi[k]) for w in aw]}
        written['appointments'] += write_cube('appointments', k, payload, files['appointments'])
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
        'spec': 'docs/metric-spec.md (signed, D-014, D-015, D-018; sections 2, 3, 4, 9 and the definitions it adopts); '
                'docs/cube-plan.md (signed, D-016, section 2)',
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
        'entities': {k: {'level': e['level'], 'code': e['code'], 'parent': e['parent'], 'name': e['name'],
                         'first_month': bc.ym(months[starts[k]]), 'last_month': bc.ym(months[ends[k]])} for k, e in ent.items()},
        'administrations': {'file': ADMIN_FILE, 'sha256': bc.sha(ADMIN_FILE),
                            'list': [{'id': a, 'name': nm, 'month_0': bc.ym(months[ix[0] - 1]), 'first_month': bc.ym(months[ix[0]]),
                                      'last_month': bc.ym(months[ix[-1]]), 'open': o} for a, nm, ix, o in admins]},
        'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
    }
    dims_meta = lambda dims, src: {d: {'source': src.get(d, BANDS_FILE), 'values': [{'value': v, 'order': o, 'role': r} for v, o, r in vals]}
                                   for d, vals in dims}
    gov_first = sum(json.load(open(f'{OUT}/{c}.meta.json'))['files']['GOV']['bytes'] for c in ('core', 'compare')) + files['leaving']['GOV']['bytes']
    grains = {'fy': 'fiscal year; rate = method B (year to date over its published months when partial, not annualized)',
              't12': "the 12 months ending at period_last_month, from the entity's 12th month; rate = method A",
              'admin': "an administration's whole window (Trump II so far); rate annualized x 12 / months",
              'admin_n': 'months 1..N in office for every administration, N = admin_n_months (the open administration\'s '
                         'months so far); rate annualized as admin'}
    period_fmt = ('"period_columns", "periods": [[values in period_columns order]] (one row per window the entity has; '
                  'rows join it on grain and period)')
    metas = {
        'leaving': {'cube': 'leaving', 'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows", ' + period_fmt + '}',
                    **common, 'grains': grains, 'admin_n_months': n_now,
                    'dimensions': dims_meta(leaving_dims, {}),
                    'dimension_roles': 'rated: count, headcount and rate per 100 of the value\'s mean headcount; unknown: counts '
                                       'and headcount only, no rate; every dimension\'s values, unknown included, partition '
                                       'departures and headcount',
                    'columns': breakdown_dictionary('leaving'), 'period_columns': period_dictionary(),
                    'files': files['leaving'], 'files_sha256': digest(files['leaving']),
                    'size': {**size_stats(files['leaving']), 'gov_first_load_bytes': gov_first,
                             'gov_first_load_files': ['core/GOV.json', 'compare/GOV.json', 'leaving/GOV.json']}},
        'joining': {'cube': 'joining', 'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows", ' + period_fmt + '}',
                    **common, 'grains': grains, 'admin_n_months': n_now,
                    'dimensions': dims_meta(joining_dims, {d: SHARES_FILE for d in JOINING_SHARES}),
                    'dimension_roles': 'rated: count, headcount and rate per 100 of the value\'s mean headcount; share: hires '
                                       'and share_den (hires with a known value), no headcount and no rate; unknown: counts '
                                       'only; every dimension\'s values, unknown included, partition hires',
                    'columns': breakdown_dictionary('joining'), 'period_columns': period_dictionary(),
                    'files': files['joining'], 'files_sha256': digest(files['joining']), 'size': size_stats(files['joining'])},
        'admin': {'cube': 'admin', 'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows"}',
                  **common,
                  'entities_without_comparison': {k: v for k, v in sorted(skipped_admin.items())},
                  'entities_without_comparison_rule': 'an entity whose first month is after an administration\'s month 0 did '
                                                      'not exist when that administration took office: no rows for it',
                  'columns': admin_dictionary(), 'files': files['admin'], 'files_sha256': digest(files['admin']),
                  'size': size_stats(files['admin'])},
        'appointments': {'cube': 'appointments', 'format': 'one JSON file per entity, files[<key>].path: {"cube", "entity", "columns", "rows", ' + period_fmt + '}',
                         **common, 'grains': {k: v for k, v in grains.items() if k != 'admin_n'},
                         'groups': {'file': APPT_FILE, 'sha256': bc.sha(APPT_FILE),
                                    'list': [{k2: g[k2] for k2 in ('id', 'level', 'parent', 'codes', 'label_status')} for g in order]},
                         'columns': appt_dictionary(), 'period_columns': period_dictionary(),
                         'files': files['appointments'], 'files_sha256': digest(files['appointments']),
                         'size': size_stats(files['appointments'])},
    }
    for c, m in metas.items():
        bc.write_if_changed(f'{OUT}/{c}.meta.json', bc.dumps_meta(m))
    tot = sum(m['size']['total_bytes'] for m in metas.values())
    print('; '.join(f"{c} {m['size']['files']} files {m['size']['total_bytes']:,} B (largest {m['size']['largest']['key']} "
                    f"{m['size']['largest']['bytes']:,})" for c, m in metas.items())
          + f'; total {tot:,} B; GOV first load {gov_first:,} B; {time.time() - T0:.1f}s')
    import build_matrix   # the matrix cube (cube plan amendment 1) is copied from the admin cube just written
    build_matrix.main()


if __name__ == '__main__':
    main()
