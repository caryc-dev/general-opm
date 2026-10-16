/* Occupations (page 10) and the occupation filter on pages 2 and 3 (page-spec 7.10, occupation-spec 5.1 and 5.2).
   Pure; no DOM. Page 10 picks rows of the occupations cube, sums columns and divides (ratio of sums). Under the
   filter, rows shaped like the core cube's are built from the monthly occupation cubes exactly as core defines its
   columns (metric spec section 3): stocks take the period's last month, flows sum over its months, and rates are a sum
   of flows over the mean of the month-end headcounts (method A: the 12 months ending in the period's last month;
   B: the fiscal year, year to date when partial; C: the period, times 12 over its months). Flags come from the core
   row of the same entity, grain and period. "Not reported" (NR, KDI-011) has counts only, never a rate. */
(function (root, factory) {
  var api = factory(root.OPM ? root.OPM.core : require('./core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.occModel = api; }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var NR = 'NR';
  var FIRST_A = '2012-09'; // method A has no value before the 12th month of the series (metric spec section 3)
  var FLAG_COLS = ['entity', 'grain', 'period', 'fiscal_year', 'fiscal_quarter', 'period_first_month', 'period_last_month', 'months_in_period', 'months_published',
    'time_basis', 'provisional', 'partial', 'reissued', 'opm_incomplete', 'kdi_ids'];

  function objects(columns, rows) { return rows.map(function (r) { var o = {}; columns.forEach(function (c, i) { o[c] = r[i]; }); return o; }); }
  function shiftMonth(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }

  /* ---- names: "0301 Miscellaneous Administration and Program", "03 General ...", "Not reported" */
  function nameMaps(meta) {
    return { series: meta.occupations.series || {}, family: meta.occupations.family || {} };
  }
  function occName(maps, level, code, nrLabel) {
    if (code === NR) return nrLabel;
    var n = maps[level] && maps[level][code];
    return n ? code + ' ' + C.titleCase(n) : code;
  }

  /* ---- page 10: the occupations file of one entity */
  function index(file) {
    var rows = {}, periods = {};
    objects(file.columns, file.rows).forEach(function (r) { var k = r.grain + '|' + r.period + '|' + r.level; (rows[k] = rows[k] || []).push(r); });
    objects(file.period_columns, file.periods).forEach(function (p) { periods[p.grain + '|' + p.period] = p; });
    return { rows: rows, periods: periods };
  }
  function periodsOf(idx, grain) {
    return Object.keys(idx.periods).filter(function (k) { return k.split('|')[0] === grain; }).map(function (k) { return idx.periods[k]; })
      .sort(function (a, b) { return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : a.period < b.period ? -1 : 1; });
  }
  /* every occupation of one window and level, with its rates (cube numerator over cube denominator) and share of the
     entity's hires and departures (the occupation's count over the sum of the level's counts) */
  function list(idx, grain, period, level) {
    var rows = (idx.rows[grain + '|' + period + '|' + level] || []).slice();
    var hires = 0, deps = 0;
    rows.forEach(function (r) { hires += r.hires || 0; deps += r.departures || 0; });
    return rows.map(function (r) {
      var nr = r.occupation === NR;
      return { code: r.occupation, nr: nr, hires: r.hires, departures: r.departures, net: r.hires - r.departures, transferIn: r.acc_transfer_in, transferOut: r.sep_transfer_out,
        drp: r.sep_drp, headcount: r.headcount, hireRate: nr ? null : C.ratio(r.hire_num, r.rate_den), depRate: nr ? null : C.ratio(r.attrition_num, r.rate_den),
        small: !nr && r.rate_small_base === true, hireShare: C.ratio(r.hires, hires), depShare: C.ratio(r.departures, deps) };
    });
  }
  function totals(items) {
    var o = { hires: 0, departures: 0, withHires: 0, withDepartures: 0 };
    items.forEach(function (x) {
      o.hires += x.hires || 0; o.departures += x.departures || 0;
      if (!x.nr && x.hires > 0) o.withHires++;
      if (!x.nr && x.departures > 0) o.withDepartures++;
    });
    return o;
  }
  /* the hired or departed list: occupations with at least one hire (departure), by count or by rate, largest first;
     occupations with no rate (Not reported, or no employees) follow those with one when sorting by rate */
  function ranked(items, kind, by) {
    var cnt = kind === 'hires' ? 'hires' : 'departures', rt = kind === 'hires' ? 'hireRate' : 'depRate';
    return items.filter(function (x) { return x[cnt] > 0; }).sort(function (a, b) {
      if (by === 'rate') {
        if (a[rt] === null && b[rt] !== null) return 1;
        if (b[rt] === null && a[rt] !== null) return -1;
        if (a[rt] !== b[rt]) return (b[rt] || 0) - (a[rt] || 0);
      }
      return b[cnt] - a[cnt] || (a.code < b.code ? -1 : 1);
    });
  }

  /* ---- the filter on pages 2 and 3 */
  /* monthly file(s) of occ_family_monthly or occ_series_monthly -> { month: { headcount, hires, departures } } for one code,
     and the occupation codes present */
  function monthly(files, dim, code) {
    var out = {};
    files.forEach(function (f) {
      var ci = f.columns.indexOf(dim), m = f.columns.indexOf('month'), hc = f.columns.indexOf('headcount'), hi = f.columns.indexOf('hires'), de = f.columns.indexOf('departures');
      f.rows.forEach(function (r) { if (r[ci] === code) out[r[m]] = { headcount: r[hc], hires: r[hi], departures: r[de] }; });
    });
    return out;
  }
  function codes(files, dim) {
    var seen = {};
    files.forEach(function (f) { var ci = f.columns.indexOf(dim); f.rows.forEach(function (r) { seen[r[ci]] = true; }); });
    return Object.keys(seen).sort();
  }
  /* which parts of a split monthly cube a view needs: every part ending on or after the earliest month used */
  function partsNeeded(files, earliest) {
    return Object.keys(files).filter(function (k) { return !earliest || files[k].last_month >= earliest; }).sort();
  }
  /* the earliest month a set of period rows reads: a method A window and the previous period's stock reach 12 months back */
  function earliestMonth(rows) {
    var first = null;
    rows.forEach(function (r) { if (!first || r.period_first_month < first) first = r.period_first_month; });
    return first ? shiftMonth(first, -12) : null;
  }

  /* rows shaped like core's for one occupation. coreRows: the entity's core rows (all grains); occ: { month: counts }
     (a month with no entry has none of that occupation); opts.nr: Not reported (no rates); opts.knownFrom: the first
     month whose occupation counts are loaded (earlier months make a figure empty, never zero) */
  function synth(coreRows, occ, opts) {
    opts = opts || {};
    var spine = coreRows.filter(function (r) { return r.grain === 'month'; }).map(function (r) { return r.period; }).sort();
    var pos = {};
    spine.forEach(function (m, i) { pos[m] = i; });
    function val(m, col) {
      if (opts.knownFrom && m < opts.knownFrom) return null;
      var x = occ[m];
      return x ? x[col] : 0;
    }
    /* sums and the mean headcount over spine months first..last; null when any month is not loaded */
    function win(first, last) {
      var s = { hires: 0, departures: 0, hc: 0, n: 0, ok: true };
      for (var i = 0; i < spine.length; i++) {
        var m = spine[i];
        if (m < first || m > last) continue;
        var hc = val(m, 'headcount'), hi = val(m, 'hires'), de = val(m, 'departures');
        if (hc === null) { s.ok = false; continue; }
        s.hires += hi; s.departures += de; s.hc += hc; s.n++;
      }
      return s;
    }
    function rates(o, key, s, factor) {
      var den = s && s.ok && s.n ? s.hc / s.n : null;
      if (opts.nr || den === null || den === 0) { o['attrition_' + key + '_num'] = null; o['hire_' + key + '_num'] = null; o['rate_' + key + '_den'] = null; o['rate_' + key + '_small_base'] = null; }
      else {
        o['attrition_' + key + '_num'] = s.departures * factor(s.n); o['hire_' + key + '_num'] = s.hires * factor(s.n);
        o['rate_' + key + '_den'] = den; o['rate_' + key + '_small_base'] = den < 30;
      }
      o['rate_' + key + '_months'] = s && s.ok ? s.n : null;
    }
    var one = function () { return 1; }, annual = function (n) { return 12 / n; };
    var out = [], prev = {};
    coreRows.slice().sort(function (a, b) { return a.grain < b.grain ? -1 : a.grain > b.grain ? 1 : a.period_first_month < b.period_first_month ? -1 : 1; }).forEach(function (r) {
      if (['month', 'quarter', 'fy'].indexOf(r.grain) < 0) return;
      var o = {};
      FLAG_COLS.forEach(function (c) { if (c in r) o[c] = r[c]; });
      if (opts.nr) o.kdi_ids = (r.kdi_ids || []).concat((r.kdi_ids || []).indexOf('KDI-011') < 0 ? ['KDI-011'] : []).sort();
      var s = win(r.period_first_month, r.period_last_month);
      o.hires = s.ok ? s.hires : null; o.departures = s.ok ? s.departures : null; o.net_flow = s.ok ? s.hires - s.departures : null;
      o.headcount = val(r.period_last_month, 'headcount');
      var p = prev[r.grain];
      o.headcount_change = p && p.headcount !== null && o.headcount !== null ? o.headcount - p.headcount : null;
      prev[r.grain] = o;
      // method A: the 12 months ending in the period's last month, from the series' and the entity's 12th month
      var li = pos[r.period_last_month];
      var a = r.period_last_month >= FIRST_A && li !== undefined && li >= 11 ? win(spine[li - 11], r.period_last_month) : null;
      rates(o, 'a', a, one);
      rates(o, 'b', r.grain === 'fy' ? s : null, one);
      rates(o, 'c', s, annual);
      out.push(o);
    });
    return out;
  }

  return { NR: NR, objects: objects, shiftMonth: shiftMonth, nameMaps: nameMaps, occName: occName, index: index, periodsOf: periodsOf, list: list, totals: totals, ranked: ranked,
    monthly: monthly, codes: codes, partsNeeded: partsNeeded, earliestMonth: earliestMonth, synth: synth };
});
