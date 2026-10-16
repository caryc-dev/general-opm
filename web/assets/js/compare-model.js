/* Page 4 (Departments compared): rows of the compare cube for a parent, the parent's own row from its core cube,
   and the values shown. Pure; no DOM. Values are cube values, sums of one column over rows, or ratios of sums. */
(function (root, factory) {
  var api = factory(root.OPM ? root.OPM.core : require('./core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.compareModel = api; }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var DRP_FROM_FY = 2025; // the Deferred Resignation Program began in 2025 (FY2025)
  var REASONS = [['drp', 'sep_drp'], ['transfer', 'sep_transfer_out_nondrp'], ['quit', 'sep_quit_nondrp'], ['retire', 'sep_retirement_nondrp'],
    ['rif', 'sep_rif_nondrp'], ['term', 'sep_termination_nondrp'], ['other', 'sep_other_nondrp']];

  /* which compare file and which children a selected entity shows (page-spec section 3) */
  function source(key, entities) {
    var e = entities[key];
    if (key === 'GOV') return { file: 'GOV', level: 'department', parent: 'GOV' };
    if (key === 'DOD') return { file: 'DOD', level: 'agency', parent: 'DOD' };
    if (e && e.level === 'agency') return { file: e.parent, level: 'subelement', within: key, parent: key };
    if (e && e.level === 'department') return { file: key, level: 'subelement', parent: key };
    return null;
  }
  function childRows(rows, src, entities) {
    return rows.filter(function (r) { return r.child_level === src.level && (!src.within || (entities[r.child] && entities[r.child].parent === src.within)); });
  }
  function fiscalYears(rows) {
    var s = {};
    rows.forEach(function (r) { if (r.grain === 'fy') s[r.period] = r; });
    return Object.keys(s).sort().map(function (p) { return { period: p, fiscal_year: s[p].fiscal_year, partial: s[p].partial, provisional: s[p].provisional, last: s[p].period_last_month }; });
  }

  /* the parent's own row for a period: a fiscal year row of its core cube, or for the trailing 12 months its latest
     month row (stocks and method A rates) with the window's flows summed over the 12 month rows */
  function parentRow(core, view, period) {
    if (view === 'fy') return core.filter(function (r) { return r.grain === 'fy' && r.period === period; })[0] || null;
    var months = core.filter(function (r) { return r.grain === 'month'; }).sort(function (a, b) { return a.period < b.period ? -1 : 1; });
    var i = months.map(function (r) { return r.period; }).indexOf(period);
    if (i < 0) return null;
    var w = months.slice(Math.max(0, i - 11), i + 1), last = months[i], out = { headcount: last.headcount, attrition_a_num: last.attrition_a_num, hire_a_num: last.hire_a_num,
      rate_a_den: last.rate_a_den, rate_a_small_base: last.rate_a_small_base, provisional: w.some(function (r) { return r.provisional; }), opm_incomplete: w.some(function (r) { return r.opm_incomplete; }), kdi_ids: [] };
    ['hires', 'departures', 'acc_transfer_in', 'sep_transfer_out', 'sep_drp'].concat(REASONS.map(function (x) { return x[1]; })).forEach(function (c) {
      out[c] = w.reduce(function (s, r) { return s + (r[c] || 0); }, 0);
    });
    return out;
  }

  function rate(r, kind, m) { return r ? C.ratio(r[(kind === 'dep' ? 'attrition_' : 'hire_') + m + '_num'], r['rate_' + m + '_den']) : null; }
  function small(r, m) { return !!(r && r['rate_' + m + '_small_base'] === true); }
  /* a heat map cell: metric dep, hire (method m) or drp (share of departures, n/a before FY2025) */
  function cell(r, metric, m, fy) {
    if (!r) return { na: true };
    if (metric === 'drp') {
      if (fy !== null && fy !== undefined && fy < DRP_FROM_FY) return { na: true };
      return { value: C.ratio(r.sep_drp, r.departures), small: small(r, m), row: r };
    }
    return { value: rate(r, metric, m), small: small(r, m), row: r };
  }
  function reasonShares(r) {
    if (!r || !r.departures) return null;
    return REASONS.map(function (x) { return C.ratio(r[x[1]], r.departures); });
  }

  return { REASONS: REASONS, DRP_FROM_FY: DRP_FROM_FY, source: source, childRows: childRows, fiscalYears: fiscalYears, parentRow: parentRow, rate: rate, small: small, cell: cell, reasonShares: reasonShares };
});
