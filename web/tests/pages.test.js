'use strict';
/* Pages 2 to 4 and 9: figures from the staged cubes through the pages' own models, checked against independent
   picks of the same cube rows; the known breaks file against the signed CSV. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../assets/js/core.js');
const SM = require('../assets/js/series-model.js');
const CM = require('../assets/js/compare-model.js');
const KB = require('../tools/build-known-breaks.js');
const { cube, haveCubes, REPO } = require('./_spec.js');

const skip = !haveCubes() && 'staged cubes not present';
let gov, govMonths, coreMeta;
if (!skip) {
  gov = SM.objects(cube('core/GOV.json'));
  govMonths = SM.byGrain(gov, 'month');
  coreMeta = cube('core.meta.json');
}

test('page 2 tiles, GOV: employees in the latest month and the 12-month change', { skip }, () => {
  const tl = SM.sizeTiles(govMonths, SM.byGrain(gov, 'fy'));
  assert.equal(tl.asof, '2026-08');
  assert.equal(C.int(tl.headcount), '2,024,832');
  const last = govMonths[govMonths.length - 1], ago = govMonths[govMonths.length - 13];
  assert.equal(tl.change12, last.headcount - ago.headcount); // the sum of monthly changes telescopes to the stock difference
  assert.equal(C.signedInt(tl.change12), '-193,729');
  // full range at fiscal-year grain: measured from the end of FY2012 (FY2012 has no change; it is the first period)
  assert.equal(tl.rangeStart.period, 'FY2013');
  assert.equal(tl.rangeFrom.period, 'FY2012');
});

test('page 2 range presets: Trump II at fiscal-year grain covers FY2025 and FY2026', { skip }, () => {
  const admins = cube('admin.meta.json').administrations.list;
  const p = SM.presets(admins).find(x => x.id === 'trump2');
  assert.deepEqual(SM.inRange(SM.byGrain(gov, 'fy'), p).map(r => r.period), ['FY2025', 'FY2026']);
});

test('page 3 tiles, GOV: past-12-month departures equal the method A numerator of the latest month', { skip }, () => {
  const tl = SM.flowTiles(govMonths);
  const last = govMonths[govMonths.length - 1];
  assert.equal(tl.departures, last.attrition_a_num);
  assert.equal(tl.departures, 329623);
  assert.equal(tl.hires, last.hire_a_num);
  assert.equal(tl.rate, last.attrition_a_num / last.rate_a_den);
});

test('page 3: departures from federal service plus transfers out equal departures on every row', { skip }, () => {
  for (const r of gov) assert.equal(SM.federal(r) + r.sep_transfer_out, r.departures, r.grain + ' ' + r.period);
  for (const r of gov) assert.equal(SM.REASONS.reduce((s, x) => s + r[x.col], 0), r.departures, 'seven reasons ' + r.period);
});

test('page 4: GOV children sum to the government; DOD shows its 4 agencies; a Defense agency its subelements', { skip }, () => {
  const ents = coreMeta.entities;
  const kids = CM.childRows(SM.objects(cube('compare/GOV.json')), CM.source('GOV', ents), ents);
  const t12 = kids.filter(r => r.grain === 't12');
  assert.equal(t12.reduce((s, r) => s + r.headcount, 0), 2024832);
  const fy25 = kids.filter(r => r.grain === 'fy' && r.period === 'FY2025');
  const p = CM.parentRow(gov, 'fy', 'FY2025');
  assert.equal(fy25.reduce((s, r) => s + r.departures, 0), p.departures);
  assert.equal(p.departures, 369153);
  const pt = CM.parentRow(gov, 't12', '2026-08');
  assert.equal(pt.departures, pt.attrition_a_num);
  const dod = CM.childRows(SM.objects(cube('compare/DOD.json')), CM.source('DOD', ents), ents);
  assert.deepEqual([...new Set(dod.map(r => r.child))].sort(), ['DOD-AF', 'DOD-AR', 'DOD-DD', 'DOD-NV']);
  const ar = CM.childRows(SM.objects(cube('compare/DOD.json')), CM.source('DOD-AR', ents), ents);
  assert.ok(ar.length > 0 && ar.every(r => ents[r.child].parent === 'DOD-AR'));
  // deferred resignation share: n/a before FY2025
  assert.equal(CM.cell(fy25[0], 'drp', 'a', 2024).na, true);
  assert.equal(CM.cell(null, 'dep', 'a', 2020).na, true);
});

test('page 4, past 12 months (D-034): IP and RE, which ended inside the window, show with no employees and children sum to the government', { skip }, () => {
  const ents = coreMeta.entities;
  const kids = CM.childRows(SM.objects(cube('compare/GOV.json')), CM.source('GOV', ents), ents).filter(r => r.grain === 't12');
  assert.equal(kids.length, 127);
  const ip = kids.find(r => r.child === 'IP'), re = kids.find(r => r.child === 'RE');
  assert.equal(ents.IP.last_month, '2025-11');
  assert.equal(ents.RE.last_month, '2025-09');
  assert.deepEqual([ip.headcount, ip.departures, ip.hires], [0, 2, 0]);
  assert.deepEqual([re.headcount, re.departures, re.hires], [0, 14, 0]);
  // rates are the cube's ratio of sums over the window's average employees, flagged small base
  for (const r of [ip, re]) { assert.equal(CM.small(r, 'a'), true); assert.equal(CM.rate(r, 'dep', 'a'), r.attrition_a_num / r.rate_a_den); }
  assert.equal(C.pct(CM.rate(ip, 'dep', 'a')), '800.0%');
  assert.equal(C.pct(CM.rate(re, 'dep', 'a')), '1200.0%');
  assert.equal(CM.rate(ip, 'hire', 'a'), 0);
  assert.deepEqual(CM.reasonShares(re), [0, 0, 0, 1, 0, 0, 0]);
  const p = CM.parentRow(gov, 't12', '2026-08');
  for (const c of ['headcount', 'hires', 'departures', 'acc_transfer_in', 'sep_transfer_out', 'sep_drp'].concat(CM.REASONS.map(x => x[1])))
    assert.equal(kids.reduce((s, r) => s + r[c], 0), p[c], c);
  assert.equal(p.departures, 329623);
});

test('known breaks: web/assets/known-breaks.json is current and lists the signed CSV rows in order', { skip }, () => {
  const csv = KB.parseCsv(fs.readFileSync(path.join(REPO, 'pipeline', 'known_breaks.csv'), 'utf8'));
  const json = JSON.parse(fs.readFileSync(KB.OUT, 'utf8'));
  assert.equal(fs.readFileSync(KB.OUT, 'utf8'), KB.text(), 'run node web/tools/build-known-breaks.js');
  assert.deepEqual(json.rows.map(r => r.entity + ' ' + r.fiscal_year), csv.map(r => r.entity + ' ' + r.fiscal_year));
  assert.equal(json.rows.length, 78);
  const gov26 = json.rows.find(r => r.entity === 'GOV' && r.fiscal_year === 2026);
  assert.equal(gov26.gap, -116920);
});

test('CSV parser handles quotes, commas and doubled quotes', () => {
  assert.deepEqual(KB.parseCsv('a,b\n1,"x, ""y"""\n'), [{ a: '1', b: 'x, "y"' }]);
});

/* ---- pages 5 to 8 */
const WM = require('../assets/js/who-model.js');
const LM = require('../assets/js/lookup-model.js');
const LK = require('../tools/build-lookup-kdi.js');

test('page 5: "Under 25" sums the two youngest age values; groups and unknown partition departures', { skip }, () => {
  const meta = cube('leaving.meta.json'), f = cube('leaving/GOV.json'), idx = WM.index(f);
  const g = WM.groups(idx, 'fy', 'FY2012', 'age', 'departures', meta.dimensions.age.values, meta.small_base_threshold);
  const raw = v => { const c = n => f.columns.indexOf(n); return f.rows.find(r => r[c('grain')] === 'fy' && r[c('period')] === 'FY2012' && r[c('dimension')] === 'age' && r[c('value')] === v); };
  const u = g.groups[0], a = raw('lt20'), b = raw('20_24'), c = n => f.columns.indexOf(n);
  assert.equal(u.value, 'under25');
  assert.equal(u.count, a[c('departures')] + b[c('departures')]);
  assert.equal(u.rate, (a[c('rate_num')] + b[c('rate_num')]) / (a[c('rate_den')] + b[c('rate_den')]));
  assert.equal(g.groups.length, 10);
  assert.equal(g.groups.reduce((s, x) => s + x.count, 0) + g.unknown, g.total);
  assert.equal(WM.total(idx, 'fy', 'FY2025', 'departures'), 369153);
  assert.equal(WM.priorPeriod('t12', '2026-08'), '2025-08');
});

test('page 5: years of experience lost over a window is the sum of core rows; by administration, its month rows', { skip }, () => {
  const core = SM.objects(cube('core/GOV.json')), idx = WM.index(cube('leaving/GOV.json'));
  const fy = WM.yearsLost(core, 'fy', { period: 'FY2025' });
  assert.equal(fy.lost, 4660522.8);
  assert.equal(fy.avg, 4660522.8 / 362615);
  const p = idx.periods['admin_n|trump2'];
  const yl = WM.yearsLost(core, 'admin_n', p);
  assert.equal(yl.months, 20);
  const months = core.filter(r => r.grain === 'month' && r.period >= '2025-01' && r.period <= '2026-08');
  assert.ok(Math.abs(yl.lost - months.reduce((s, r) => s + r.years_of_service_lost, 0)) < 1e-6);
});

test('page 6: share groups use hires over hires with a known value', { skip }, () => {
  const meta = cube('joining.meta.json'), idx = WM.index(cube('joining/GOV.json'));
  const g = WM.groups(idx, 'fy', 'FY2025', 'prior_service', 'hires', meta.dimensions.prior_service.values, 30);
  assert.ok(Math.abs(g.groups.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  assert.ok(g.groups.every(x => x.rate === null || x.rate === undefined || isFinite(x.rate)));
});

test('page 7: political appointees since January 2025 and per month in office', { skip }, () => {
  const f = cube('appointments/GOV.json'), c = n => f.columns.indexOf(n), pc = n => f.period_columns.indexOf(n);
  const r = f.rows.find(x => x[c('grain')] === 'admin' && x[c('period')] === 'trump2' && x[c('appt_group')] === 'political');
  const p = f.periods.find(x => x[pc('grain')] === 'admin' && x[pc('period')] === 'trump2');
  assert.equal(r[c('hires')], 4105);
  assert.equal(r[c('departures')], 3565);
  assert.equal(p[pc('months_in_period')], 20);
  assert.equal(cube('admin/GOV.json').rows.find(x => x[0] === 'trump2' && x[1] === 20)[2], 20); // admin_months agrees
});

test('page 8: lookup-kdi.json is current; marks match the Look-Up meta counts on sample files', { skip }, async () => {
  assert.equal(fs.readFileSync(LK.OUT, 'utf8'), LK.text(), 'run node web/tools/build-lookup-kdi.js');
  const rules = JSON.parse(fs.readFileSync(LK.OUT, 'utf8')).rows;
  const PQ = new Function(fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'hyparquet-bundle.js'), 'utf8') + ';return OPMParquet;')();
  const lmeta = JSON.parse(fs.readFileSync(path.join(REPO, 'warehouse', 'lookup', 'lookup.meta.json'), 'utf8'));
  const appt = LM.appointmentGroups(cube('appointments.meta.json').groups.list, id => APPT_SHOWN.includes(id) ? 'label ' + id : null);
  const apf = cube('appointments/GOV.json'), ac2 = n => apf.columns.indexOf(n);
  for (const name of ['separations_FY2025', 'accessions_FY2026', 'accessions_FY2016', 'employment_latest_DN']) {
    const b = fs.readFileSync(path.join(REPO, 'warehouse', 'lookup', name + '.parquet'));
    const rows = await PQ.parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), compressors: PQ.compressors });
    assert.equal(rows.length, lmeta.files[name].rows, name + ' rows');
    const ds = lmeta.files[name].dataset, got = {};
    for (const r of rows) for (const id of new Set(Object.values(LM.kdiMarks(r, ds, rules)))) got[id] = (got[id] || 0) + 1;
    assert.deepEqual(got, lmeta.files[name].kdi, name);
    if (ds !== 'employment') {
      // appointment type grouped as on page 7 (D-035): each group's count = the appointments cube's GOV count
      const cols = LM.columns(lmeta.fields[ds], { appointment: appt }), ac = cols.find(x => x.key === 'appointment');
      assert.deepEqual(ac.fields, ['appointment_type_code', 'appointment_type']);
      const fy = name.slice(-6), col = ds === 'separations' ? 'departures' : 'hires', got2 = {};
      for (const o of LM.distinct(rows, ac)) got2[o.value] = o.count;
      const want = {};
      for (const r of apf.rows) if (r[ac2('grain')] === 'fy' && r[ac2('period')] === fy && r[ac2('appt_level')] === 'group' && r[ac2(col)] > 0)
        want[r[ac2('appt_group')] === 'unknown' ? '*' : 'group:' + r[ac2('appt_group')]] = r[ac2(col)];
      assert.deepEqual(got2, want, name + ' appointment groups');
      const pol = LM.apply(rows, cols.filter(x => LM.FILTERS.includes(x.key)), { appointment: 'group:political' }, '', lmeta.fields[ds]);
      assert.equal(pol.length, want['group:political']);
      assert.ok(pol.every(r => ['36', '44', '46', '55'].includes(r.appointment_type_code)));
    }
    if (name === 'separations_FY2025') {
      const cols = LM.columns(lmeta.fields[ds]);
      assert.equal(cols.length, 21); // the 27 fields, codes shown with their names
      assert.deepEqual([].concat(...cols.map(x => x.fields)), lmeta.fields[ds]);
      // occupational family (D-037): code and name in one cell, right after Occupation, a filter and a count-by field;
      // the 8 rows with no family published (series 0000, 0182, 0183) are an empty cell and their own option
      const ki = cols.map(x => x.key), fam = cols.find(x => x.key === 'family');
      assert.equal(ki.indexOf('family'), ki.indexOf('occupation') + 1);
      assert.deepEqual(fam.fields, ['occupational_group_code', 'occupational_group']);
      assert.ok(LM.FILTERS.includes('family'));
      const fo = LM.distinct(rows, fam);
      assert.equal(fo.length, 62);
      assert.deepEqual(fo.find(o => o.value === ''), { value: '', label: '', count: 8 });
      assert.equal(fo[0].label, '03 GENERAL ADMINISTRATIVE, CLERICAL, AND OFFICE SERVICES GROUP');
      assert.equal(fo[0].count, 71096);
      const fcols = cols.filter(x => LM.FILTERS.includes(x.key));
      const none = LM.apply(rows, fcols, { family: '' }, '', lmeta.fields[ds]);
      assert.equal(none.length, 8);
      assert.ok(none.every(r => r.occupational_group_code === null && LM.cellText(r, fam) === ''));
      assert.equal(LM.apply(rows, fcols, { family: '03', department: 'HU' }, '', lmeta.fields[ds]).length, 1220);
      const hu = LM.apply(rows, cols.filter(x => LM.FILTERS.includes(x.key)), { department: 'HU' }, '', lmeta.fields[ds]);
      assert.equal(hu.length, 2825);
      const text = LM.csv(hu.slice(0, 2), lmeta.fields[ds]);
      assert.equal(text.split('\r\n')[0], lmeta.fields[ds].join(','));
    }
  }
});

const APPT_SHOWN = ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy'];
test('page 8: appointment groups, page 7 order first; a code outside them (unknown "*" or unmapped) is its own option as published', () => {
  const list = [{ id: 'all', level: 'total', codes: ['10', '44', '*'] }, { id: 'career', level: 'group', codes: ['10'] }, { id: 'political', level: 'group', codes: ['44'] },
    { id: 'schedule_c', level: 'subgroup', codes: ['44'] }, { id: 'unknown', level: 'group', codes: ['*'] }];
  const g = LM.appointmentGroups(list, id => APPT_SHOWN.includes(id) ? 'L ' + id : null);
  const col = LM.columns(['appointment_type_code', 'appointment_type'], { appointment: g })[0];
  const rows = [['10', 'CAREER'], ['44', 'SCHEDULE C'], ['44', 'SCHEDULE C'], ['44', 'SCHEDULE C'], ['*', 'INVALID'], ['99', 'NEW CODE'], ['99', 'NEW CODE']]
    .map(x => ({ appointment_type_code: x[0], appointment_type: x[1] }));
  assert.deepEqual(LM.distinct(rows, col), [{ value: 'group:career', label: 'L career', count: 1 }, { value: 'group:political', label: 'L political', count: 3 },
    { value: '99', label: '99 NEW CODE', count: 2 }, { value: '*', label: '* INVALID', count: 1 }]);
  assert.equal(LM.cellText(rows[1], col), '44 SCHEDULE C'); // code and name in one cell (D-033)
  assert.equal(LM.apply(rows, [col], { appointment: '*' }, '', ['appointment_type_code']).length, 1);
  assert.equal(LM.csv(rows.slice(0, 1), ['appointment_type_code', 'appointment_type']), 'appointment_type_code,appointment_type\r\n10,CAREER\r\n');
  // without the groups the column filters by the code as published
  assert.equal(LM.filterValue(rows[0], LM.columns(['appointment_type_code', 'appointment_type'])[0]), '10');
});

test('page 8: a NULL value is an empty cell, its own filter option and count, and an empty CSV field', () => {
  const col = LM.columns(['occupational_group_code', 'occupational_group'])[0];
  assert.equal(col.key, 'family');
  const rows = [{ occupational_group_code: '03', occupational_group: 'G' }, { occupational_group_code: null, occupational_group: null }, { occupational_group_code: '03', occupational_group: 'G' }];
  assert.equal(LM.cellText(rows[1], col), '');
  assert.deepEqual(LM.distinct(rows, col), [{ value: '03', label: '03 G', count: 2 }, { value: '', label: '', count: 1 }]);
  assert.deepEqual(LM.apply(rows, [col], { family: '' }, '', []), [rows[1]]);
  assert.equal(LM.apply(rows, [col], { family: '__all' }, '', []).length, 3);
  assert.equal(LM.csv(rows.slice(1, 2), col.fields), 'occupational_group_code,occupational_group\r\n,\r\n');
});

test('page 8: CSV keeps values as published and quotes only when needed', () => {
  assert.equal(LM.csv([{ a: 'x, y', b: null, c: 'REDACTED' }], ['a', 'b', 'c']), 'a,b,c\r\n"x, y",,REDACTED\r\n');
});
