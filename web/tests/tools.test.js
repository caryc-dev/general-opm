'use strict';
/* The development server's mapping (read-only, staged data at /data/), the SVG builders and the core formats. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const D = require('../tools/dev-server.js');
const SVG = require('../assets/js/svg.js');
const C = require('../assets/js/core.js');
const { WEB, REPO, haveCubes } = require('./_spec.js');

test('dev server maps /data/ to warehouse/cubes and /data/lookup/ to warehouse/lookup, and stays inside its roots', () => {
  const rts = D.roots({});
  assert.equal(D.resolve('/index.html', rts), path.join(WEB, 'index.html'));
  assert.equal(D.resolve('/', rts), path.join(WEB, 'index.html'));
  if (haveCubes()) {
    assert.equal(D.resolve('/data/admin/GOV.json?v=1', rts), path.join(REPO, 'warehouse', 'cubes', 'admin', 'GOV.json'));
    assert.equal(D.resolve('/data/lookup/lookup.meta.json', rts), path.join(REPO, 'warehouse', 'lookup', 'lookup.meta.json'));
    assert.equal(D.resolve('/data/lookup.meta.json', rts), path.join(REPO, 'warehouse', 'lookup', 'lookup.meta.json'));
    assert.equal(D.resolve('/data/lookup/separations_FY2025.parquet', rts), path.join(REPO, 'warehouse', 'lookup', 'separations_FY2025.parquet'));
  }
  for (const bad of ['/../LICENSE', '/data/../../LICENSE', '/%2e%2e/LICENSE', '/data/%2e%2e/opm.duckdb', '/assets/', '/data/admin']) assert.equal(D.resolve(bad, rts), null, bad);
});

test('dev server refuses writes', async () => {
  const srv = D.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const status = method => new Promise((res, rej) => { const q = http.request({ port, host: '127.0.0.1', path: '/copy.json', method }, r => { r.resume(); res(r.statusCode); }); q.on('error', rej); q.end(); });
  assert.equal(await status('GET'), 200);
  assert.equal(await status('PUT'), 405);
  assert.equal(await status('DELETE'), 405);
  srv.close();
});

test('SVG builders return one well-formed svg with no NaN', () => {
  const trend = [{ n: 0, v: 0 }, { n: 1, v: -5 }, { n: 2, v: -9, provisional: true }];
  const outs = [
    SVG.scoreboard({ title: 'T', cards: [{ name: 'A', color: '#fff', years: 'y', big: '-1.0%', bigColor: '#fff', sub: 's', trend, rows: [['h', '1']] }, { name: 'B', color: '#fff', empty: true, emptyText: 'e' }], scale: { min: -9, max: 0 }, notes: ['n & <x>'] }),
    SVG.heatmap({ title: 'T', firstHead: 'D', sizeHead: 'S', headers: [{ text: 'A', color: '#fff' }], rows: [{ name: 'x', size: '1', cells: [{ text: '1%', bg: '#000', fg: '#fff', small: true }] }], legend: [{ bg: '#000', fg: '#fff', label: '1%' }] }),
    SVG.bars({ title: 'T', groups: [{ title: 'g', rows: [{ name: 'a', color: '#fff', frac: 0.5, text: '1%' }, { name: 'b', color: '#fff', frac: null, text: '-' }] }] }),
    SVG.reasons({ title: 'T', firstHead: '', headers: [{ text: 'A', color: '#fff' }], rows: [{ label: 'r', cells: [{ text: '1%', frac: 0.01, color: '#fff' }] }] })
  ];
  for (const s of outs) {
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal((s.match(/<svg/g) || []).length, 1);
    assert.ok(!/NaN|undefined/.test(s));
    assert.ok(s.endsWith('</svg>'));
  }
  assert.match(outs[0], /n &amp; &lt;x&gt;/);
  assert.match(SVG.sparkline(trend, { min: -9, max: 0 }, 200, 64, '#fff'), /stroke-dasharray="4 3"/);
});

test('formats: signed figures with a hyphen-minus, never -0.0%, empty ratios', () => {
  assert.equal(C.signedInt(-287469), '-287,469');
  assert.equal(C.signedInt(8861), '+8,861');
  assert.equal(C.pct(-0.0004, true), '0.0%');
  assert.equal(C.pct(0.142), '14.2%');
  assert.equal(C.ratio(1, 0), null);
  assert.equal(C.ratio(1, null), null);
  assert.equal(C.monthLabel('2024-12'), 'Dec 2024');
  assert.equal(C.stampDate('20261016-042721'), 'Oct 16, 2026');
  assert.equal(C.titleCase('MEDICAID AND CHIP PAYMENT AND ACCESS COMMISSION'), 'Medicaid and CHIP Payment and Access Commission');
  assert.equal(C.titleCase('U.S. AGENCY FOR GLOBAL MEDIA'), 'U.S. Agency for Global Media');
});
