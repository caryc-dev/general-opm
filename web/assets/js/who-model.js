/* Pages 5 and 6 (Who is leaving, Who is joining): groups of the leaving and joining cubes by window. Pure; no DOM.
   Every figure is a cube value, a sum of one column over rows, or a ratio of two such sums. OPM's age values
   "Less than 20" and "20 to 24" are shown together as "Under 25" by summing their numerators and denominators. */
(function (root, factory) {
  var api = factory(root.OPM ? root.OPM.core : require('./core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.whoModel = api; }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  /* panels: cube dimension, panel title key, dimension name key (for the unknown line), group label prefix */
  var LEAVING = [
    { dim: 'los', title: 'p5.panel.los', name: 'dim.los', prefix: 'group.los.' },
    { dim: 'age', title: 'p5.panel.age', name: 'dim.age', prefix: 'group.age.' },
    { dim: 'supervisory', title: 'p5.panel.sup', name: 'dim.sup', prefix: 'group.sup.' },
    { dim: 'education', title: 'p5.panel.edu', name: 'dim.edu', prefix: 'group.edu.' },
    { dim: 'veteran', title: 'p5.panel.vet', name: 'dim.vet', prefix: 'group.vet.' },
    { dim: 'grade', title: 'p5.panel.grade', name: 'dim.grade', prefix: 'group.grade.' }];
  var JOINING = [
    { dim: 'age', title: 'p6.panel.age', name: 'dim.age', prefix: 'group.age.' },
    { dim: 'education', title: 'p6.panel.edu', name: 'dim.edu', prefix: 'group.edu.' },
    { dim: 'veteran', title: 'p6.panel.vet', name: 'dim.vet', prefix: 'group.vet.' },
    { dim: 'grade', title: 'p6.panel.grade', name: 'dim.grade', prefix: 'group.grade.' },
    { dim: 'prior_service', title: 'p6.panel.prior', name: 'dim.prior', prefix: 'group.prior.', share: true },
    { dim: 'pathways', title: 'p6.panel.programs', name: null, prefix: 'group.prog.', share: true }];
  var UNDER25 = ['lt20', '20_24'];

  function objects(columns, rows) { return rows.map(function (r) { var o = {}; columns.forEach(function (c, i) { o[c] = r[i]; }); return o; }); }
  /* a leaving or joining file -> { rows by "grain|period|dimension": [row], periods by "grain|period": period row } */
  function index(file) {
    var rows = {}, periods = {};
    objects(file.columns, file.rows).forEach(function (r) { var k = r.grain + '|' + r.period + '|' + r.dimension; (rows[k] = rows[k] || []).push(r); });
    objects(file.period_columns, file.periods).forEach(function (p) { periods[p.grain + '|' + p.period] = p; });
    return { rows: rows, periods: periods };
  }
  function periodsOf(idx, grain) {
    return Object.keys(idx.periods).filter(function (k) { return k.split('|')[0] === grain; }).map(function (k) { return idx.periods[k]; })
      .sort(function (a, b) { return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : a.period < b.period ? -1 : 1; });
  }
  /* the same window a year earlier: the previous fiscal year, or the 12 months ending 12 months before */
  function priorPeriod(grain, period) {
    if (grain === 'fy') return 'FY' + (+period.slice(2) - 1);
    if (grain === 't12') { var y = +period.slice(0, 4), m = period.slice(5); return (y - 1) + '-' + m; }
    return null;
  }

  function labelOf(dim, value) { // -> { key, vars }
    if (dim === 'age') {
      if (value === 'under25') return { key: 'group.age.under25' };
      if (value === '65plus') return { key: 'group.age.65plus' };
      var p = value.split('_');
      return { key: 'group.age.range', vars: { lo: p[0], hi: p[1] } };
    }
    var pre = { los: 'group.los.', supervisory: 'group.sup.', education: 'group.edu.', veteran: 'group.vet.', grade: 'group.grade.', prior_service: 'group.prior.', pathways: 'group.prog.' }[dim];
    return { key: pre + value };
  }

  /* groups of one dimension in one window. count: 'departures' or 'hires'; order: meta dimensions; threshold: the
     small-base threshold of the meta (applied to the merged "Under 25" denominator, as the cube applies it) */
  function groups(idx, grain, period, dim, count, order, threshold) {
    var rows = (idx.rows[grain + '|' + period + '|' + dim] || []).slice();
    if (!rows.length) return null;
    var pos = {};
    (order || []).forEach(function (v, i) { pos[v.value] = v.order; });
    rows.sort(function (a, b) { return (pos[a.value] || 0) - (pos[b.value] || 0); });
    var out = [], unknown = 0, total = 0, merged = null;
    rows.forEach(function (r) {
      total += r[count] || 0;
      if (r.value === 'unknown') { unknown += r[count] || 0; return; }
      if (dim === 'age' && UNDER25.indexOf(r.value) >= 0) {
        if (!merged) { merged = { value: 'under25', count: 0, num: 0, den: 0, na: true, shareDen: null, anyRate: false }; out.push(merged); }
        merged.count += r[count] || 0;
        if (r.rate_num !== null && r.rate_num !== undefined) { merged.num += r.rate_num; merged.anyRate = true; }
        if (r.rate_den !== null && r.rate_den !== undefined) merged.den += r.rate_den;
        merged.na = merged.na && r.rate_not_applicable === true;
        return;
      }
      out.push({ value: r.value, count: r[count] || 0, num: r.rate_num, den: r.rate_den, na: r.rate_not_applicable === true, small: r.rate_small_base === true, shareDen: r.share_den });
    });
    out.forEach(function (g) {
      if (g.value === 'under25') { g.rate = g.anyRate && g.den > 0 ? C.ratio(g.num, g.den) : null; g.small = g.rate !== null && g.den < threshold; }
      else g.rate = g.na ? null : C.ratio(g.num, g.den);
      g.share = g.shareDen !== null && g.shareDen !== undefined ? C.ratio(g.count, g.shareDen) : null;
      g.label = labelOf(dim, g.value);
    });
    return { groups: out, unknown: unknown, total: total };
  }

  /* the window's total count (every value of one dimension, unknown included, partitions the count) */
  function total(idx, grain, period, count, col) {
    var rows = idx.rows[grain + '|' + period + '|age'];
    if (!rows) return null;
    return rows.reduce(function (s, r) { return s + (r[col || count] || 0); }, 0);
  }

  /* years of experience lost over a window, from core month or fiscal-year rows: sums, and the average per departure
     with a known length of service (ratio of sums) and its coverage */
  function yearsLost(coreRows, grain, p) {
    var rows;
    if (grain === 'fy') rows = coreRows.filter(function (r) { return r.grain === 'fy' && r.period === p.period; });
    else rows = coreRows.filter(function (r) { return r.grain === 'month' && r.period >= p.period_first_month && r.period <= p.period_last_month; });
    if (!rows.length) return null;
    var sum = function (c) { return rows.reduce(function (s, r) { return s + (r[c] || 0); }, 0); };
    var lost = sum('years_of_service_lost'), known = sum('yos_known'), deps = sum('departures');
    return { lost: lost, avg: C.ratio(lost, known), coverage: C.ratio(known, deps), months: rows.length };
  }

  return { LEAVING: LEAVING, JOINING: JOINING, UNDER25: UNDER25, index: index, periodsOf: periodsOf, priorPeriod: priorPeriod, labelOf: labelOf, groups: groups, total: total, yearsLost: yearsLost };
});
