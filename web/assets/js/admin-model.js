/* Page 1 (Administrations): the view model, from the admin cube of the selected entity, the GOV admin cube and the
   matrix cube. Pure; no DOM. The browser only picks rows and divides one cube column by another (ratio of sums);
   every figure here is a cube value or such a ratio. */
(function (root, factory) {
  var api = factory(root.OPM ? root.OPM.core : require('./core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.adminModel = api; }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var SIZE_RULE = 5000;          // page-spec 4.2 and 5.3: departments with 5,000 or more employees at the Trump II start
  var SIZE_ADMIN = 'trump2';     // the administration whose month 0 sets the size column and the default rows
  var DRP_FROM = '2025-01';      // the Deferred Resignation Program began in 2025: its share is n/a for terms before

  /* the seven-reason partition (page-spec 5.5): sep_drp and the six *_nondrp columns sum to departures */
  var REASONS = [
    { id: 'drp', col: 'sep_drp' },
    { id: 'transfer', col: 'sep_transfer_out_nondrp' },
    { id: 'quit', col: 'sep_quit_nondrp' },
    { id: 'retire', col: 'sep_retirement_nondrp' },
    { id: 'rif', col: 'sep_rif_nondrp' },
    { id: 'term', col: 'sep_termination_nondrp' },
    { id: 'other', col: 'sep_other_nondrp' }
  ];

  /* heat map colors (page-spec 5.3, design B): a value v (in percent) falls in the first bin with v < lt.
     fg is the cell text; every pair is checked for 4.5:1 in web/tests/contrast.test.js. */
  var BINS = {
    change: [
      { lt: -30, bg: '#ff8c2e', fg: '#0d1117', label: '< -30%' },
      { lt: -15, bg: '#c2560f', fg: '#ffffff', label: '-30%' },
      { lt: -5, bg: '#6b3a12', fg: '#ffe8cc', label: '-15%' },
      { lt: 0, bg: '#2e2219', fg: '#ffd8a8', label: '-5%' },
      { lt: 5, bg: '#16263a', fg: '#a5d8ff', label: '0%' },
      { lt: 15, bg: '#1f5a8f', fg: '#ffffff', label: '+5%' },
      { lt: Infinity, bg: '#4dabf7', fg: '#0d1117', label: '+15%' }
    ],
    dep: [
      { lt: 8, bg: '#2b2118', fg: '#ffd8a8', label: '< 8%' },
      { lt: 12, bg: '#5c3a12', fg: '#ffe8cc', label: '8%' },
      { lt: 16, bg: '#9a5b0e', fg: '#ffffff', label: '12%' },
      { lt: 24, bg: '#d9822b', fg: '#0d1117', label: '16%' },
      { lt: Infinity, bg: '#ffb454', fg: '#0d1117', label: '24%' }
    ],
    hire: [
      { lt: 5, bg: '#15233a', fg: '#a5d8ff', label: '< 5%' },
      { lt: 10, bg: '#1c3f66', fg: '#e7f5ff', label: '5%' },
      { lt: 15, bg: '#1f6aa5', fg: '#ffffff', label: '10%' },
      { lt: 25, bg: '#4dabf7', fg: '#0d1117', label: '15%' },
      { lt: Infinity, bg: '#a5d8ff', fg: '#0d1117', label: '25%' }
    ],
    drp: [
      { lt: 15, bg: '#2b2118', fg: '#ffd8a8', label: '< 15%' },
      { lt: 35, bg: '#5c3a12', fg: '#ffe8cc', label: '15%' },
      { lt: 55, bg: '#9a5b0e', fg: '#ffffff', label: '35%' },
      { lt: Infinity, bg: '#ffb454', fg: '#0d1117', label: '55%' }
    ]
  };
  var NA_STYLE = { bg: '#161b22', fg: '#9da7b3' };
  var METRICS = ['change', 'dep', 'hire', 'drp'];

  function bin(metric, ratio) {
    var v = ratio * 100, list = BINS[metric];
    for (var i = 0; i < list.length; i++) if (v < list[i].lt) return list[i];
    return list[list.length - 1];
  }

  /* ---- cube access: rows to objects, indexed by entity, administration and month in office */
  function objects(columns, rows) {
    return rows.map(function (r) { var o = {}; columns.forEach(function (c, i) { o[c] = r[i]; }); return o; });
  }
  function indexAdmin(file) { // one admin cube file -> { admin: { n: row } }
    var idx = {};
    objects(file.columns, file.rows).forEach(function (o) { (idx[o.administration] = idx[o.administration] || {})[o.months_in_office] = o; });
    return idx;
  }
  function indexMatrix(file) { // the matrix cube -> { entity: { admin: { n: row } } }
    var idx = {};
    objects(file.columns, file.rows).forEach(function (o) {
      var e = idx[o.entity] = idx[o.entity] || {};
      (e[o.administration] = e[o.administration] || {})[o.months_in_office] = o;
    });
    return idx;
  }
  function pick(idx, admin, n) { return idx && idx[admin] ? idx[admin][n] || null : null; }

  /* ---- administrations and months in office */
  function administrations(meta) { return meta.administrations.list; }
  function adminById(meta, id) { return administrations(meta).filter(function (a) { return a.id === id; })[0]; }
  function publishedMonths(a) { return C.monthsBetween(a.first_month, a.last_month); }
  /* N runs from 1 to the shortest chosen administration's published months */
  function maxMonths(meta, chosen) {
    var m = Infinity;
    chosen.forEach(function (id) { var a = adminById(meta, id); if (a) m = Math.min(m, publishedMonths(a)); });
    return isFinite(m) ? m : 1;
  }
  function longestMonths(meta) { return Math.max.apply(null, administrations(meta).map(publishedMonths)); }
  function ordered(meta, chosen) { return administrations(meta).filter(function (a) { return chosen.indexOf(a.id) >= 0; }); }

  /* ---- 5.2 scoreboard */
  function scoreboard(idx, meta, chosen, n) {
    var prov = {};
    meta.provisional_months.forEach(function (m) { prov[m] = true; });
    var cards = ordered(meta, chosen).map(function (a) {
      var row = pick(idx, a.id, n);
      if (!row) return { id: a.id, name: a.name, empty: true };
      var trend = [{ n: 0, v: 0, month: row.month_0, provisional: false }];
      for (var k = 1; k <= n; k++) {
        var r = pick(idx, a.id, k);
        trend.push(r ? { n: k, v: r.headcount_change, month: r.month_n, provisional: !!prov[r.month_n] } : null);
      }
      return { id: a.id, name: a.name, row: row, start: a.first_month, end: row.month_n,
        pct: C.ratio(row.headcount_change, row.headcount_0), change: row.headcount_change, hires: row.hires, departures: row.departures, trend: trend };
    });
    var lo = 0, hi = 0;
    cards.forEach(function (c) { (c.trend || []).forEach(function (p) { if (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); } }); });
    return { cards: cards, scale: { min: lo, max: hi } };
  }

  /* ---- 5.4 rates: annualized departure and hire rates */
  function rates(idx, meta, chosen, n) {
    return ordered(meta, chosen).map(function (a) {
      var row = pick(idx, a.id, n);
      if (!row) return { id: a.id, name: a.name, empty: true };
      return { id: a.id, name: a.name, dep: C.ratio(row.attrition_num, row.rate_den), hire: C.ratio(row.hire_num, row.rate_den), small: row.rate_small_base === true };
    });
  }

  /* ---- 5.5 why people left: each reason's share of departures */
  function drpApplies(a) { return a.first_month >= DRP_FROM; }
  function reasons(idx, meta, chosen, n) {
    var admins = ordered(meta, chosen);
    return REASONS.map(function (rs) {
      return { id: rs.id, cells: admins.map(function (a) {
        var row = pick(idx, a.id, n);
        if (!row) return { id: a.id, na: true };
        if (rs.id === 'drp' && !drpApplies(a)) return { id: a.id, na: true };
        return { id: a.id, share: C.ratio(row[rs.col], row.departures) };
      }) };
    });
  }

  /* ---- notes: provisional administrations, OPM-incomplete months and known data issues in the rows shown */
  function notes(rowsWithAdmin, meta) {
    var prov = [], inc = false, kdi = {};
    administrations(meta).forEach(function (a) {
      var any = rowsWithAdmin.some(function (x) { return x.admin === a.id && x.row && x.row.provisional; });
      if (any) prov.push(a.name);
    });
    rowsWithAdmin.forEach(function (x) {
      if (!x.row) return;
      if (x.row.opm_incomplete) inc = true;
      (x.row.kdi_ids || []).forEach(function (id) { kdi[id] = true; });
    });
    return { provisional: prov, incomplete: inc, kdi: Object.keys(kdi).sort() };
  }
  function entityNotes(idx, meta, chosen, n) {
    return notes(chosen.map(function (id) { return { admin: id, row: pick(idx, id, n) }; }), meta);
  }

  /* ---- 5.3 heat map */
  function cellValue(metric, row, a) {
    if (!row) return { na: true };
    if (metric === 'drp' && !drpApplies(a)) return { na: true };
    var r = metric === 'change' ? C.ratio(row.headcount_change, row.headcount_0)
      : metric === 'dep' ? C.ratio(row.attrition_num, row.rate_den)
      : metric === 'hire' ? C.ratio(row.hire_num, row.rate_den)
      : C.ratio(row.sep_drp, row.departures);
    return { value: r, small: row.rate_small_base === true, row: row };
  }
  function isDefense(key) { return key === 'DOD' || /^DOD-/.test(key); }
  function sizeOf(entIdx) { var r = pick(entIdx, SIZE_ADMIN, 1); return r ? r.headcount_0 : null; }

  /* state: { entity, chosen, n, metric, showAll, sort: { col, dir } | null } */
  function heat(mIdx, govIdx, meta, names, state) {
    var admins = ordered(meta, state.chosen), n = state.n, metric = state.metric;
    var view = isDefense(state.entity) ? 'defense' : state.entity === 'GOV' ? 'government' : 'department';
    var ents = meta.entities, list = [];
    function rowFor(key, idx, pinned) {
      var cells = {};
      admins.forEach(function (a) { cells[a.id] = cellValue(metric, pick(idx, a.id, n), a); });
      var hasAny = admins.some(function (a) { return !!pick(idx, a.id, n); });
      return { key: key, name: names[key], size: sizeOf(idx), pinned: !!pinned, highlight: key === state.entity && view !== 'government', cells: cells, hasAny: hasAny };
    }
    var filtered = false;
    if (view === 'defense') {
      list.push(rowFor('DOD', mIdx.DOD, true));
      Object.keys(ents).filter(function (k) { return ents[k].level === 'agency' && ents[k].parent === 'DOD'; }).forEach(function (k) { list.push(rowFor(k, mIdx[k], false)); });
    } else {
      list.push(rowFor('GOV', govIdx, true));
      filtered = !state.showAll;
      Object.keys(ents).filter(function (k) { return ents[k].level === 'department'; }).forEach(function (k) {
        var r = rowFor(k, mIdx[k], false);
        if (!r.hasAny) return; // D-028 (2): no row for any chosen administration: left out
        if (!state.showAll && !(r.size !== null && r.size >= SIZE_RULE) && k !== state.entity) return;
        list.push(r);
      });
    }
    var sort = state.sort || defaultSort(meta, state.chosen, metric);
    var pinned = list.filter(function (r) { return r.pinned; }), body = list.filter(function (r) { return !r.pinned; });
    body.sort(comparator(sort));
    var rows = pinned.concat(body);
    var flags = {};
    admins.forEach(function (a) {
      flags[a.id] = {
        provisional: rows.some(function (r) { return r.cells[a.id].row && r.cells[a.id].row.provisional; }),
        incomplete: rows.some(function (r) { return r.cells[a.id].row && r.cells[a.id].row.opm_incomplete; })
      };
    });
    var shown = [];
    rows.forEach(function (r) { admins.forEach(function (a) { shown.push({ admin: a.id, row: r.cells[a.id].row || null }); }); });
    return { view: view, admins: admins, rows: rows, filtered: filtered && view !== 'defense', sort: sort, flags: flags, notes: notes(shown, meta),
      anySmall: rows.some(function (r) { return admins.some(function (a) { var c = r.cells[a.id]; return c.small && c.value !== null && c.value !== undefined; }); }) };
  }
  function defaultSort(meta, chosen, metric) {
    var latest = ordered(meta, chosen).slice(-1)[0];
    return { col: latest ? latest.id : 'name', dir: metric === 'change' ? 'asc' : 'desc' };
  }
  function comparator(sort) {
    var sgn = sort.dir === 'asc' ? 1 : -1;
    return function (a, b) {
      var x, y;
      if (sort.col === 'name') return sgn * a.name.localeCompare(b.name);
      if (sort.col === 'size') { x = a.size; y = b.size; }
      else { x = a.cells[sort.col] ? a.cells[sort.col].value : null; y = b.cells[sort.col] ? b.cells[sort.col].value : null; }
      var xm = x === null || x === undefined, ym = y === null || y === undefined;
      if (xm && ym) return a.name.localeCompare(b.name);
      if (xm) return 1;
      if (ym) return -1;
      return x === y ? a.name.localeCompare(b.name) : sgn * (x - y);
    };
  }

  return { REASONS: REASONS, BINS: BINS, NA_STYLE: NA_STYLE, METRICS: METRICS, SIZE_RULE: SIZE_RULE, SIZE_ADMIN: SIZE_ADMIN,
    bin: bin, indexAdmin: indexAdmin, indexMatrix: indexMatrix, pick: pick, administrations: administrations, adminById: adminById,
    maxMonths: maxMonths, longestMonths: longestMonths, ordered: ordered, scoreboard: scoreboard, rates: rates, reasons: reasons,
    entityNotes: entityNotes, heat: heat, defaultSort: defaultSort, isDefense: isDefense, drpApplies: drpApplies };
});
