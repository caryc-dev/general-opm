'use strict';
/* Page 1 figures from the staged cubes (through the page's own model), against values the task fixes and an
   independent pick of the same cube rows here. Skipped when the staged cubes are not present (a plain clone). */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/core.js');
const M = require('../assets/js/admin-model.js');
const { cube, haveCubes } = require('./_spec.js');

const skip = !haveCubes() && 'staged cubes not present';
const ALL = ['obama2', 'trump1', 'biden', 'trump2'];
let meta, matrix, gov, dj, names;
if (!skip) {
  meta = cube('admin.meta.json');
  matrix = M.indexMatrix(cube('matrix/matrix.json'));
  gov = M.indexAdmin(cube('admin/GOV.json'));
  dj = M.indexAdmin(cube('admin/DJ.json'));
  names = C.displayNames(meta.entities, 'All departments and agencies');
}
/* independent: the raw row, picked here without the model */
function raw(key, admin, n) {
  const f = cube('admin/' + key + '.json'), col = c => f.columns.indexOf(c);
  const r = f.rows.find(r => r[col('administration')] === admin && r[col('months_in_office')] === n);
  return Object.fromEntries(f.columns.map((c, i) => [c, r[i]]));
}

test('N runs to 20 with all administrations on (Trump II, Aug 2026)', { skip }, () => {
  assert.equal(M.maxMonths(meta, ALL), 20);
  assert.equal(M.maxMonths(meta, ['obama2', 'biden']), 48);
});

test('GOV, Trump II, N=20: change -287,469 (-12.4%), departure rate 14.2%, hire rate 6.8%', { skip }, () => {
  const card = M.scoreboard(gov, meta, ALL, 20).cards.find(c => c.id === 'trump2');
  assert.equal(C.signedInt(card.change), '-287,469');
  assert.equal(C.pct(card.pct, true), '-12.4%');
  const r = M.rates(gov, meta, ALL, 20).find(x => x.id === 'trump2');
  assert.equal(C.pct(r.dep), '14.2%');
  assert.equal(C.pct(r.hire), '6.8%');
  const x = raw('GOV', 'trump2', 20);
  assert.equal(card.change, x.headcount_change);
  assert.equal(r.dep, x.attrition_num / x.rate_den);
});

test('DJ, Trump II, N=20: change -9,863, departures 21,244, departure rate 11.5%', { skip }, () => {
  const card = M.scoreboard(dj, meta, ALL, 20).cards.find(c => c.id === 'trump2');
  assert.equal(C.signedInt(card.change), '-9,863');
  assert.equal(C.int(card.departures), '21,244');
  assert.equal(C.pct(M.rates(dj, meta, ALL, 20).find(x => x.id === 'trump2').dep), '11.5%');
});

test('the heat map row for DJ equals the DJ admin cube (matrix copies admin)', { skip }, () => {
  const hm = M.heat(matrix, gov, meta, names, { entity: 'DJ', chosen: ALL, n: 20, metric: 'dep', showAll: false });
  const row = hm.rows.find(r => r.key === 'DJ');
  assert.ok(row.highlight);
  assert.equal(C.pct(row.cells.trump2.value), '11.5%');
});

test('why people left: the seven reasons sum to departures (shares sum to 1)', { skip }, () => {
  const rs = M.reasons(gov, meta, ['trump2'], 20);
  const sum = rs.reduce((s, r) => s + r.cells[0].share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, String(sum));
  const before = M.reasons(gov, meta, ['biden'], 20).find(r => r.id === 'drp');
  assert.equal(before.cells[0].na, true);
});

test('heat map default rows: GOV first, then the 20 departments of 5,000 or more at the Trump II start', { skip }, () => {
  const hm = M.heat(matrix, gov, meta, names, { entity: 'GOV', chosen: ALL, n: 20, metric: 'change', showAll: false });
  assert.equal(hm.rows[0].key, 'GOV');
  assert.equal(hm.rows.length, 21);
  assert.ok(hm.rows.slice(1).every(r => r.size >= 5000));
  // default sort: latest administration, change ascending
  const v = hm.rows.slice(1).map(r => r.cells.trump2.value);
  assert.deepEqual(v, v.slice().sort((a, b) => a - b));
  assert.equal(hm.filtered, true);
});

test('D-028: a missing matrix row shows n/a; with show all, no entity with no row for any chosen administration', { skip }, () => {
  const hm = M.heat(matrix, gov, meta, names, { entity: 'GOV', chosen: ALL, n: 20, metric: 'change', showAll: true });
  assert.ok(hm.rows.length > 21);
  for (const r of hm.rows) assert.ok(ALL.some(a => !r.cells[a].na), r.key + ' is all n/a');
  // OY, VB, YG ended before month 1 of a term they are not listed for (D-028 reading 1): their cells are n/a
  const without = meta.entities_without_comparison;
  for (const r of hm.rows) for (const a of without[r.key] || []) assert.equal(r.cells[a].na, true, r.key + ' ' + a);
  const vb = M.heat(matrix, gov, meta, names, { entity: 'VB', chosen: ALL, n: 1, metric: 'change', showAll: true }).rows.find(r => r.key === 'VB');
  if (vb) for (const a of ALL) if (!matrix.VB[a] || !matrix.VB[a][1]) assert.equal(vb.cells[a].na, true);
  // only Trump II chosen: an entity that ended before 2025 is left out entirely
  const t2 = M.heat(matrix, gov, meta, names, { entity: 'GOV', chosen: ['trump2'], n: 20, metric: 'change', showAll: true });
  assert.ok(!t2.rows.some(r => r.key === 'BZ'), 'BZ ended in 2017');
});

test('Defense view: Defense first, then its 4 agencies', { skip }, () => {
  const hm = M.heat(matrix, gov, meta, names, { entity: 'DOD-NV', chosen: ALL, n: 20, metric: 'change', showAll: false });
  assert.equal(hm.view, 'defense');
  assert.equal(hm.rows[0].key, 'DOD');
  assert.deepEqual(hm.rows.slice(1).map(r => r.key).sort(), ['DOD-AF', 'DOD-AR', 'DOD-DD', 'DOD-NV']);
  assert.ok(hm.rows.find(r => r.key === 'DOD-NV').highlight);
});

test('entity names: title case, and the Defense agency named like its department carries its code', { skip }, () => {
  assert.equal(names.HU, 'Department of Housing and Urban Development');
  assert.equal(names.DOD, 'Department of Defense');
  assert.equal(names['DOD-DD'], 'Department of Defense (DD)');
  assert.equal(names.GOV, 'All departments and agencies');
});
