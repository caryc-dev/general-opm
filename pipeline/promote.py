"""Promote the staged cubes and Look-Up into web/data/ (D-036). Run from anywhere: .venv/bin/python pipeline/promote.py

Copies every staged meta (warehouse/cubes/*.meta.json and warehouse/lookup/lookup.meta.json) and every file each meta
lists into web/data/, in the layout web/tools/dev-server.js serves: lookup.meta.json and lookup/... from
warehouse/lookup/, everything else from warehouse/cubes/. Nothing a meta does not list is promoted (so never
revision_baseline.json or known_breaks_candidates.csv).

Idempotent and resumable: a file whose sha256 already equals its staged source is skipped; every copy goes to a
temporary name in the same folder and is renamed into place, so an interrupted run leaves no partial file under a real
name. Metas are written last, so a half-finished run never shows a meta whose files are missing. Promoted files that
no staged meta lists any more are removed, inside web/data/ only, and each is reported.
Check: tests/gate.py promoted_matches_staged."""
import hashlib, json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUBES, LOOKUP = os.path.join(ROOT, 'warehouse', 'cubes'), os.path.join(ROOT, 'warehouse', 'lookup')
WEB_DATA = os.environ.get('PROMOTE_TARGET') or os.path.join(ROOT, 'web', 'data')   # override only to test on a scratch copy
TMP = '.promote-tmp'


def staged_source(rel):
    if rel == 'lookup.meta.json': return os.path.join(LOOKUP, 'lookup.meta.json')
    if rel.startswith('lookup/'): return os.path.join(LOOKUP, rel[len('lookup/'):])
    return os.path.join(CUBES, rel)


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def plan():
    """{promoted relative path: staged source}: every staged meta and every file it lists."""
    metas = sorted(f for f in os.listdir(CUBES) if f.endswith('.meta.json'))
    if os.path.isfile(os.path.join(LOOKUP, 'lookup.meta.json')): metas.append('lookup.meta.json')
    out = {}
    for m in metas:
        meta = json.load(open(staged_source(m)))
        if m == 'lookup.meta.json' and meta.get('complete') is not True: sys.exit('lookup.meta.json says the build is incomplete; not promoting')
        for fi in meta['files'].values():
            rel = fi['path']
            if os.path.isabs(rel) or '..' in rel.split('/') or rel.endswith('.meta.json'): sys.exit(f'{m} lists an unsafe path {rel!r}')
            out[rel] = staged_source(rel)
        out[m] = staged_source(m)
    missing = sorted(r for r, s in out.items() if not os.path.isfile(s))
    if missing: sys.exit(f'{len(missing)} staged file(s) missing, e.g. {missing[:3]}; rebuild before promoting')
    return out


def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + TMP
    shutil.copyfile(src, tmp)
    if sha(tmp) != sha(src): os.remove(tmp); sys.exit(f'copy of {src} does not match its source')
    os.replace(tmp, dst)


def main():
    want = plan()
    real_web_data = os.path.realpath(WEB_DATA)
    copied = skipped = 0
    # data files first, metas last
    for rel in sorted(want, key=lambda r: (r.endswith('.meta.json'), r)):
        dst = os.path.join(WEB_DATA, rel)
        if os.path.isfile(dst) and sha(dst) == sha(want[rel]): skipped += 1; continue
        copy(want[rel], dst); copied += 1
    removed = []
    for r, ds, fs in os.walk(WEB_DATA, topdown=False):
        for f in fs:
            p = os.path.join(r, f); rel = os.path.relpath(p, WEB_DATA).replace(os.sep, '/')
            if rel in want: continue
            if not os.path.realpath(p).startswith(real_web_data + os.sep): sys.exit(f'refusing to remove {p}: outside web/data')
            os.remove(p); removed.append(rel); print(f'removed {rel} (no staged meta lists it)')
        if r != WEB_DATA and not os.listdir(r): os.rmdir(r)
    total = sum(os.path.getsize(os.path.join(WEB_DATA, r)) for r in want)
    big = max(want, key=lambda r: os.path.getsize(os.path.join(WEB_DATA, r)))
    metas = sorted(r for r in want if r.endswith('.meta.json'))
    print(f"{len(want):,} files in {os.path.relpath(WEB_DATA, ROOT)} ({len(metas)} metas: {', '.join(m[:-10] for m in metas)}): {copied:,} copied, "
          f"{skipped:,} already current, {len(removed)} removed; {total / 1e6:.1f} MB; largest {big} "
          f"{os.path.getsize(os.path.join(WEB_DATA, big)) / 1e6:.2f} MB")


if __name__ == '__main__':
    main()
