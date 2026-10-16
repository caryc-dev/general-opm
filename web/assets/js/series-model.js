/* Pages 2 and 3 (Workforce size, Hiring and departures): rows of the core cube by view, date range presets, tiles
   and series. Pure; no DOM. Every figure is a cube value, a sum of one cube column over rows, or a ratio of two
   such sums. */
(function (root, factory) {
  var api = factory(root.OPM ? root.OPM.core : require('./core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.seriesModel = api; }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var GRAINS = { fy: 'fy', fq: 'quarter', month: 'month' };
  var REASONS = [ // the seven reasons, labels p1.reason.*
    { id: 'drp', col: 'sep_drp' }, { id: 'transfer', col: 'sep_transfer_out_nondrp' }, { id: 'quit', col: 'sep_quit_nondrp' },
    { id: 'retire', col: 'sep_retirement_nondrp' }, { id: 'rif', col: 'sep_rif_nondrp' }, { id: 'term', col: 'sep_termination_nondrp' },
    { id: 'other', col: 'sep_other_nondrp' }];
  /* departures from federal service: the five categories that are not transfers out, from the same row (D-007) */
  var FEDERAL = ['sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];

  function objects(file) {
    return file.rows.map(function (r) { var o = {}; file.columns.forEach(function (c, i) { o[c] = r[i]; }); return o; });
  }
  function byGrain(rows, grain) {
    return rows.filter(function (r) { return r.grain === grain; }).sort(function (a, b) { return a.period_first_month < b.period_first_month ? -1 : 1; });
  }
  function sum(rows, col) { var s = 0; rows.forEach(function (r) { if (r[col] !== null && r[col] !== undefined) s += r[col]; }); return s; }

  /* date range presets: full range, and each administration's window */
  function presets(admins) {
    return [{ id: 'full', first: null, last: null }].concat(admins.map(function (a) { return { id: a.id, name: a.name, first: a.first_month, last: a.last_month }; }));
  }
  /* periods of the view overlapping the preset's months */
  function inRange(rows, preset) {
    if (!preset || !preset.first) return rows.slice();
    return rows.filter(function (r) { return r.period_last_month >= preset.first && r.period_first_month <= preset.last; });
  }

  /* period label: 'FY2025', 'FY2025Q3' as in the cube, months as 'Aug 2026' */
  function label(r) { return r.grain === 'month' ? C.monthLabel(r.period) : r.period; }

  /* ---- page 2 tiles (7.1.1) */
  function sizeTiles(months, range) {
    var last = months[months.length - 1];
    var l12 = months.slice(-12), before = months.length >= 13 ? months[months.length - 13] : null;
    var change12 = l12.length === 12 && l12.every(function (r) { return r.headcount_change !== null; }) ? sum(l12, 'headcount_change') : null;
    var rr = range.filter(function (r) { return r.headcount_change !== null; });
    var first = rr[0], prevIdx = first ? range.indexOf(first) : -1;
    return {
      headcount: last ? last.headcount : null, asof: last ? last.period : null,
      change12: change12, change12Pct: change12 === null || !before ? null : C.ratio(change12, before.headcount),
      changeRange: rr.length ? sum(rr, 'headcount_change') : null,
      rangeStart: rr.length ? rr[0] : null, rangeEnd: rr.length ? rr[rr.length - 1] : null,
      rangeFrom: first ? (prevIdx > 0 ? range[prevIdx - 1] : null) : null
    };
  }

  /* ---- page 3 tiles (7.2.1) */
  function flowTiles(months) {
    var l12 = months.slice(-12), p12 = months.slice(-24, -12), last = months[months.length - 1], ago = months.length >= 13 ? months[months.length - 13] : null;
    return {
      hires: l12.length === 12 ? sum(l12, 'hires') : null, hiresPrior: p12.length === 12 ? sum(p12, 'hires') : null,
      departures: l12.length === 12 ? sum(l12, 'departures') : null, departuresPrior: p12.length === 12 ? sum(p12, 'departures') : null,
      rate: last ? C.ratio(last.attrition_a_num, last.rate_a_den) : null, rateSmall: !!(last && last.rate_a_small_base),
      ratePrior: ago ? C.ratio(ago.attrition_a_num, ago.rate_a_den) : null, ratePriorSmall: !!(ago && ago.rate_a_small_base),
      last: last ? last.period : null, ago: ago ? ago.period : null
    };
  }

  /* ---- rates by method: a = trailing 12 months, b = fiscal year (fy grain only), c = annualized */
  function rate(r, kind, m) {
    var num = r[(kind === 'dep' ? 'attrition_' : 'hire_') + m + '_num'], den = r['rate_' + m + '_den'];
    return C.ratio(num, den);
  }
  function small(r, m) { return r['rate_' + m + '_small_base'] === true; }
  function federal(r) { var s = 0; FEDERAL.forEach(function (c) { s += r[c] || 0; }); return s; }

  /* notes for the rows on view: provisional, partial (latest partial period), small base under the chosen method */
  function flags(rows) {
    var prov = rows.some(function (r) { return r.provisional; });
    var partial = rows.filter(function (r) { return r.partial && r.grain !== 'month'; });
    var lastPartial = partial.length && partial[partial.length - 1] === rows[rows.length - 1] ? partial[partial.length - 1] : null;
    var inc = rows.some(function (r) { return r.opm_incomplete; });
    var kdi = {};
    rows.forEach(function (r) { (r.kdi_ids || []).forEach(function (k) { kdi[k] = true; }); });
    return { provisional: prov, partial: lastPartial, incomplete: inc, kdi: Object.keys(kdi).sort() };
  }

  return { GRAINS: GRAINS, REASONS: REASONS, FEDERAL: FEDERAL, objects: objects, byGrain: byGrain, sum: sum, presets: presets, inRange: inRange,
    label: label, sizeTiles: sizeTiles, flowTiles: flowTiles, rate: rate, small: small, federal: federal, flags: flags };
});
