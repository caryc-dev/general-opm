"""Build the matrix cube from the staged admin cube into warehouse/cubes/ (staging; never web/data/).

Usage (from anywhere):  .venv/bin/python pipeline/build_matrix.py
Also run at the end of pipeline/build_breakdowns.py, so a breakdown rebuild always refreshes it.
Reads only warehouse/cubes/admin.meta.json and warehouse/cubes/admin/<key>.json (no database, no source files).
Deterministic: a file is rewritten only when its bytes change, and no output carries a build time.

Container: docs/cube-plan.md, amendment 1 (signed 2026-10-15): one file for every department and the 4 Defense
agencies (not GOV, not subelements), one row per entity, administration and month in office. Every value is copied
from the admin cube row of the same entity, administration and month; nothing is recomputed. Entities without a
comparison for an administration (admin meta entities_without_comparison, D-020) have no admin rows for it and so
no matrix rows.

Output
  matrix/matrix.json   {"cube": "matrix", "columns": [...], "rows": [[...], ...]}; rows in admin meta file order
                       (departments by code, then DOD-AF, DOD-AR, DOD-DD, DOD-NV), then admin row order
  matrix.meta.json     columns with kinds (copied from the admin meta), manifest hash, per-file SHA-256, the admin
                       cube it was copied from, known data issues in scope, provisional months
"""
import hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cubes as bc   # helpers only; its main() is not run on import

ROOT, OUT = bc.ROOT, bc.OUT
LEVELS = ('department', 'agency')   # departments and the 4 DOD agencies
SOURCE_COLUMNS = ['administration', 'months_in_office', 'headcount_0', 'headcount_change', 'departures', 'sep_drp',
                  'hire_num', 'attrition_num', 'rate_den', 'rate_small_base', 'provisional', 'opm_incomplete', 'kdi_ids']
COLUMNS = ['entity'] + SOURCE_COLUMNS
ENTITY_COLUMN = {'name': 'entity', 'kind': 'dimension',
                 'description': 'entity key: a department code or DOD-AF, DOD-AR, DOD-DD, DOD-NV (meta entities); the admin '
                                'cube file the row is copied from'}
# admin meta keys carried over unchanged (the matrix is built from that cube, so it shares its build context)
COMMON = ('manifest_sha256', 'manifest_hash_method', 'time_basis', 'range', 'provisional_months', 'reissued_months',
          'revision_baseline', 'small_base_threshold', 'known_data_issues', 'administrations', 'files_digest_method')


def digest(files):
    return hashlib.sha256(''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path'])).encode()).hexdigest()


def main():
    os.chdir(ROOT)
    admin = json.load(open(f'{OUT}/admin.meta.json', encoding='utf-8'))
    keys = [k for k in admin['files'] if admin['entities'][k]['level'] in LEVELS]
    rows, kdi_seen, per_entity = [], set(), {}
    for k in keys:
        fi = admin['files'][k]
        p = f"{OUT}/{fi['path']}"
        if bc.sha(p) != fi['sha256']:
            sys.exit(f'matrix NOT built: {fi["path"]} differs from admin.meta.json (rerun pipeline/build_breakdowns.py)')
        d = json.load(open(p, encoding='utf-8'))
        if d['cube'] != 'admin' or d['entity'] != k:
            sys.exit(f'matrix NOT built: {fi["path"]} header is not admin {k}')
        ix = [d['columns'].index(c) for c in SOURCE_COLUMNS]
        for r in d['rows']:
            rows.append([k] + [r[i] for i in ix])
            kdi_seen.update(r[d['columns'].index('kdi_ids')])
        per_entity[k] = len(d['rows'])
    os.makedirs(f'{OUT}/matrix', exist_ok=True)
    rel = 'matrix/matrix.json'
    path = f'{OUT}/{rel}'
    changed = bc.write_if_changed(path, bc.dumps_compact({'cube': 'matrix', 'columns': COLUMNS, 'rows': rows}))
    files = {'matrix': {'path': rel, 'sha256': bc.sha(path), 'bytes': os.path.getsize(path), 'rows': len(rows)}}
    for f in sorted(os.listdir(f'{OUT}/matrix')):   # this script's own stale outputs
        if f.endswith('.tmp'):
            os.remove(f'{OUT}/matrix/{f}')
    coldict = {c['name']: c for c in admin['columns']}
    columns = [ENTITY_COLUMN] + [coldict[c] for c in SOURCE_COLUMNS]
    applied = {x['id'] for x in admin['known_data_issues']['applied']}
    meta = {
        'cube': 'matrix',
        'format': 'one JSON file for all entities, files["matrix"].path: {"cube", "columns", "rows"}; one row per entity, '
                  'administration and month in office',
        **{k: admin[k] for k in COMMON[:3]},
        'spec': 'docs/cube-plan.md (signed, D-016; amendment 1, signed 2026-10-15: matrix cube); definitions as the admin cube: '
                + admin['spec'],
        **{k: admin[k] for k in COMMON[3:]},
        'known_data_issues_in_rows': sorted(kdi_seen),
        'source': {'cube': 'admin', 'meta': 'admin.meta.json', 'files_sha256': admin['files_sha256'],
                   'rule': 'every value copied from the admin cube row of the same entity, administration and month in '
                           'office; no recomputation'},
        'entities': {k: admin['entities'][k] for k in keys},
        'entities_without_comparison': {k: v for k, v in admin['entities_without_comparison'].items() if k in per_entity},
        'entities_without_comparison_rule': admin['entities_without_comparison_rule'],
        'rows_per_entity': per_entity,
        'columns': columns,
        'files': files,
        'files_sha256': digest(files),
        'size': {'files': 1, 'total_bytes': files['matrix']['bytes'], 'mean_bytes': files['matrix']['bytes'],
                 'largest': {'key': 'matrix', 'bytes': files['matrix']['bytes']}},
    }
    if not kdi_seen <= applied:
        sys.exit(f'matrix NOT built: known data issue ids {sorted(kdi_seen - applied)} are not in the admin meta')
    bc.write_if_changed(f'{OUT}/matrix.meta.json', bc.dumps_meta(meta))
    print(f"matrix: {len(keys)} entities, {len(rows):,} rows, {files['matrix']['bytes']:,} B "
          f"({'rewritten' if changed else 'unchanged'})", flush=True)


if __name__ == '__main__':
    main()
