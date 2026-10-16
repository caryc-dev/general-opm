'use strict';
/* Page 10 and the occupation filter (occupation-spec 5.1 and 5.2): the model's lists, Not reported (KDI-011), the
   partition of each list into the entity's totals, and the filter's rows, whose rates must reproduce the core cube's
   own when fed the entity's own monthly totals. Reads the staged cubes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const O = require('../assets/js/occ-model.js');
const { cube, CUBES } = require('./_spec.js');

const skip = !fs.existsSync(path.join(CUBES, 'occupations.meta.json')) && 'occupation cubes not built';
const core = key => O.objects(cube('core/' + key + '.json').columns, cube('core/' + key + '.json').rows);
const RATE_COLS = ['headcount', 'headcount_change', 'hires', 'departures', 'net_flow'];
['a', 'b', 'c'].forEach(m => RATE_COLS.push('attrition_' + m + '_num', 'hire_' + m + '_num', 'rate_' + m + '_den', 'rate_' + m + '_months', 'rate_' + m + '_small_base'));
function same(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'number') return typeof b === 'number' && Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a));
  return a === b;
}
const monthTotals = rows => { const o = {}; rows.filter(r => r.grain === 'month').forEach(r => { o[r.period] = { headcount: r.headcount, hires: r.hires, departures: r.departures }; }); return o; };

test('filter rates: fed an entity\'s own monthly totals, the browser reproduces core\'s rows for methods A, B and C at every grain', { skip }, () => {
  const meta = cube('core.meta.json');
  // the government, Defense and one of its agencies, Justice and the FBI, an entity that starts late (DA, Nov 2021),
  // one that ended (BZ, Jan 2017), and every entity whose month rows have a gap (a month with no employees inside its span)
  const keys = ['GOV', 'DOD', 'DOD-AR', 'DJ', 'DJ02', 'DA', 'BZ'];
  for (const k of Object.keys(meta.files)) {
    if (keys.length >= 40) break;
    const rows = core(k).filter(r => r.grain === 'month');
    if (rows.some(r => r.headcount === 0) && !keys.includes(k)) keys.push(k);
  }
  let n = 0;
  for (const k of keys) {
    const rows = core(k), got = {};
    O.synth(rows, monthTotals(rows), {}).forEach(r => { got[r.grain + '|' + r.period] = r; });
    for (const r of rows.filter(x => ['month', 'quarter', 'fy'].includes(x.grain))) {
      const x = got[r.grain + '|' + r.period];
      assert.ok(x, k + ' ' + r.period);
      for (const c of RATE_COLS) assert.ok(same(r[c], x[c]), `${k} ${r.grain} ${r.period} ${c}: core ${r[c]}, browser ${x[c]}`);
      for (const c of ['provisional', 'partial', 'opm_incomplete', 'kdi_ids']) assert.deepEqual(x[c], r[c], `${k} ${r.period} ${c}`);
      n++;
    }
  }
  assert.ok(keys.length >= 10 && n > 5000, keys.length + ' entities, ' + n + ' rows');
});

test('filter: the families of an entity sum to its core months; at government level so do the job series', { skip }, () => {
  for (const k of ['GOV', 'DJ', 'DOD-NV', 'DJ02']) {
    const f = cube('occ_family_monthly/' + k + '.json'), c = monthTotals(core(k)), sum = {};
    const ci = n => f.columns.indexOf(n);
    f.rows.forEach(r => { const s = sum[r[ci('month')]] = sum[r[ci('month')]] || { headcount: 0, hires: 0, departures: 0 }; s.headcount += r[ci('headcount')]; s.hires += r[ci('hires')]; s.departures += r[ci('departures')]; });
    for (const m of Object.keys(c)) assert.deepEqual(sum[m] || { headcount: 0, hires: 0, departures: 0 }, c[m], k + ' ' + m);
  }
  const sm = cube('occ_series_monthly.meta.json'), parts = Object.keys(sm.files).map(k => cube(sm.files[k].path)), c = monthTotals(core('GOV')), sum = {};
  parts.forEach(f => f.rows.forEach(r => { const s = sum[r[0]] = sum[r[0]] || { headcount: 0, hires: 0, departures: 0 }; s.headcount += r[2]; s.hires += r[3]; s.departures += r[4]; }));
  assert.deepEqual(sum, c);
  // and the rows built for each family add up to core's period rows (stocks at the last month, flows summed)
  const rows = core('DJ'), f = cube('occ_family_monthly/DJ.json'), fy = {};
  for (const code of O.codes([f], 'family')) O.synth(rows, O.monthly([f], 'family', code), { nr: code === 'NR' }).filter(r => r.grain === 'fy').forEach(r => {
    const s = fy[r.period] = fy[r.period] || { headcount: 0, hires: 0, departures: 0 }; s.headcount += r.headcount; s.hires += r.hires; s.departures += r.departures; });
  rows.filter(r => r.grain === 'fy').forEach(r => assert.deepEqual(fy[r.period], { headcount: r.headcount, hires: r.hires, departures: r.departures }, 'DJ ' + r.period));
});

test('filter: Not reported has counts and no rate, and carries KDI-011', { skip }, () => {
  const rows = core('GOV'), f = cube('occ_family_monthly/GOV.json');
  const nr = O.synth(rows, O.monthly([f], 'family', 'NR'), { nr: true });
  const fy25 = nr.find(r => r.grain === 'fy' && r.period === 'FY2025');
  assert.equal(fy25.departures, 10227); // the occupations cube's family "Not reported" departures, GOV FY2025 (gate occupations_partition)
  for (const r of nr) {
    for (const m of ['a', 'b', 'c']) assert.equal(r['rate_' + m + '_den'], null);
    assert.ok(r.kdi_ids.includes('KDI-011'));
  }
});

test('filter: a split series history loads only the parts a view needs, and an unloaded month is empty, never zero', { skip }, () => {
  const sm = cube('occ_series_monthly.meta.json'), rows = core('GOV');
  const fy = rows.filter(r => r.grain === 'fy');
  assert.deepEqual(O.partsNeeded(sm.files, O.earliestMonth(fy.filter(r => r.period >= 'FY2025'))), ['GOV_from_2020-10']);
  assert.deepEqual(O.partsNeeded(sm.files, O.earliestMonth(fy)), ['GOV_from_2020-10', 'GOV_to_2020-09']);
  assert.deepEqual(O.partsNeeded(sm.files, O.earliestMonth(fy.filter(r => r.period === 'FY2021'))), ['GOV_from_2020-10', 'GOV_to_2020-09']);
  const from = cube(sm.files['GOV_from_2020-10'].path);
  const s = O.synth(rows, O.monthly([from], 'series', '0301'), { knownFrom: '2020-10' });
  const at = p => s.find(r => r.grain === 'month' && r.period === p);
  assert.equal(at('2020-09').headcount, null);
  assert.equal(at('2020-10').headcount_change, null);
  assert.equal(at('2021-08').rate_a_den, null); // its 12-month window reaches Sep 2020
  assert.ok(at('2021-09').rate_a_den > 0);
});

test('page 10: each level\'s list sums to the entity\'s hires, departures and employees; Not reported is a row with no rate', { skip }, () => {
  const idx = O.index(cube('occupations/GOV.json')), c = core('GOV').filter(r => r.grain === 'month' && r.period >= '2025-09' && r.period <= '2026-08');
  const hires = c.reduce((s, r) => s + r.hires, 0), deps = c.reduce((s, r) => s + r.departures, 0), hc = c[c.length - 1].headcount;
  assert.deepEqual([hires, deps], [160466, 329623]);
  for (const level of ['series', 'family']) {
    const items = O.list(idx, 't12', '2026-08', level), tot = O.totals(items);
    assert.equal(tot.hires, hires, level);
    assert.equal(tot.departures, deps, level);
    assert.equal(items.reduce((s, x) => s + x.headcount, 0), hc, level);
    assert.ok(Math.abs(items.reduce((s, x) => s + (x.depShare || 0), 0) - 1) < 1e-9);
    const nr = items.find(x => x.code === 'NR');
    assert.ok(nr && nr.nr && nr.hireRate === null && nr.depRate === null && !nr.small, level);
    assert.equal(tot.withHires, items.filter(x => x.code !== 'NR' && x.hires > 0).length);
  }
  const s = O.list(idx, 't12', '2026-08', 'series');
  assert.deepEqual(O.ranked(s, 'hires', 'count').slice(0, 5).map(x => [x.code, x.hires]), [['1801', 8524], ['0610', 8369], ['0303', 5779], ['0456', 5213], ['0301', 4775]]);
  assert.deepEqual(O.ranked(s, 'departures', 'count').slice(0, 5).map(x => [x.code, x.departures]), [['0301', 19987], ['0343', 15850], ['2210', 15467], ['0303', 9995], ['NR', 8847]]);
  assert.deepEqual([O.totals(s).withHires, O.totals(s).withDepartures], [551, 636]);
  // by rate: occupations with a rate first, Not reported last
  const byRate = O.ranked(s, 'departures', 'rate');
  const firstNull = byRate.findIndex(x => x.depRate === null);
  assert.ok(firstNull > 0 && byRate.slice(firstNull).every(x => x.depRate === null) && byRate.slice(firstNull).some(x => x.code === 'NR'));
  for (let i = 1; i < firstNull; i++) assert.ok(byRate[i - 1].depRate >= byRate[i].depRate);
  // a rate is the cube's numerator over its denominator
  const raw = cube('occupations/GOV.json'), ci = n => raw.columns.indexOf(n), r = raw.rows.find(x => x[ci('grain')] === 't12' && x[ci('level')] === 'series' && x[ci('occupation')] === '0610');
  assert.equal(s.find(x => x.code === '0610').hireRate, r[ci('hire_num')] / r[ci('rate_den')]);
});

test('page 10: names come from the meta; Not reported and a code with no published name', { skip }, () => {
  const maps = O.nameMaps(cube('occupations.meta.json'));
  assert.equal(O.occName(maps, 'series', '0301', 'Not reported'), '0301 Miscellaneous Administration and Program');
  assert.equal(O.occName(maps, 'series', 'NR', 'Not reported'), 'Not reported');
  assert.equal(O.occName(maps, 'series', '0000', 'Not reported'), '0000');
  assert.match(O.occName(maps, 'family', '03', 'x'), /^03 General Administrative/);
  assert.equal(O.shiftMonth('2020-10', -12), '2019-10');
  assert.equal(O.shiftMonth('2021-01', -1), '2020-12');
});
