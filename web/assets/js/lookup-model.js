/* Page 8 (Look-Up): columns, filters, search, sort, counts, CSV, and the known data issue marks. Pure; no DOM. One
   file at a time, rows as OPM published them; nothing is joined, inferred or changed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.lookupModel = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EFF = 'personnel_action_effective_date_yyyymm';
  /* display columns in the order of the signed fields: copy key and the field(s) shown (a code with its name) */
  var COLUMNS = [
    ['snapshot', ['snapshot_yyyymm']], ['department', ['department_code', 'department']], ['agency', ['agency_code', 'agency']],
    ['subelement', ['agency_subelement_code', 'agency_subelement']], ['effective', [EFF]], ['processed', ['period']],
    ['reason', ['separation_category']], ['hireType', ['accession_category']], ['drp', ['drp_indicator']],
    ['occupation', ['occupational_series_code', 'occupational_series']], ['payPlan', ['pay_plan_code']], ['grade', ['grade']],
    ['age', ['age_bracket']], ['service', ['length_of_service_years']], ['supervisory', ['supervisory_status']],
    ['appointment', ['appointment_type']], ['tenure', ['tenure']], ['education', ['education_level']], ['veteran', ['veteran_indicator']],
    ['schedule', ['work_schedule']], ['pay', ['annualized_adjusted_basic_pay']], ['state', ['duty_station_state']]];
  /* filters of page-spec 7.7, by column: department, agency, subelement, effective month, reason or hire type,
     occupation, grade, age, supervisory status, appointment type */
  var FILTERS = ['department', 'agency', 'subelement', 'effective', 'reason', 'hireType', 'occupation', 'grade', 'age', 'supervisory', 'appointment'];

  function columns(fields) {
    return COLUMNS.filter(function (c) { return c[1].every(function (f) { return fields.indexOf(f) >= 0; }); }).map(function (c) { return { key: c[0], fields: c[1] }; });
  }
  function cellText(row, col) {
    return col.fields.map(function (f) { return row[f] === null || row[f] === undefined ? '' : String(row[f]); }).filter(function (v) { return v !== ''; }).join(' ');
  }
  function filterValue(row, col) { return row[col.fields[0]] === null || row[col.fields[0]] === undefined ? '' : String(row[col.fields[0]]); }

  /* distinct values of a column (by its first field, labelled with the whole cell), most frequent first */
  function distinct(rows, col) {
    var m = {};
    rows.forEach(function (r) { var v = filterValue(r, col); var e = m[v] || (m[v] = { value: v, label: cellText(r, col), count: 0 }); e.count++; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  /* rows that pass every chosen filter { columnKey: value } and the search text (any field, case-insensitive) */
  function apply(rows, cols, filters, search, fields) {
    var active = cols.filter(function (c) { return filters[c.key] !== undefined && filters[c.key] !== null && filters[c.key] !== '__all'; });
    var q = (search || '').trim().toLowerCase();
    return rows.filter(function (r) {
      for (var i = 0; i < active.length; i++) if (filterValue(r, active[i]) !== filters[active[i].key]) return false;
      if (!q) return true;
      for (var j = 0; j < fields.length; j++) { var v = r[fields[j]]; if (v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) >= 0) return true; }
      return false;
    });
  }
  /* sort by one column: numbers as numbers when both values are numbers, else text */
  function sortRows(rows, col, dir) {
    var s = dir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var x = cellText(a, col), y = cellText(b, col), nx = Number(x), ny = Number(y);
      if (x !== '' && y !== '' && isFinite(nx) && isFinite(ny)) return s * (nx - ny);
      return s * (x < y ? -1 : x > y ? 1 : 0);
    });
  }
  function counts(rows, col) { return distinct(rows, col); }

  /* CSV of the rows with OPM's column names, values exactly as published (empty for a missing value) */
  function csv(rows, fields) {
    var q = function (v) { if (v === null || v === undefined) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [fields.join(',')].concat(rows.map(function (r) { return fields.map(function (f) { return q(r[f]); }).join(','); })).join('\r\n') + '\r\n';
  }

  /* known data issues: { field: id } of the cells of a row in an issue's scope (assets/lookup-kdi.json), mirroring the
     Look-Up build's scope rules: dataset and file month, entity, and the issue's condition on its field. A value range
     takes the lowest id first (KDI-009 only outside KDI-001). A whole-row issue marks the row's month column. */
  var LEVEL_COL = { department: 'department_code', agency: 'agency_code', subelement: 'agency_subelement_code' };
  function kdiMarks(row, dataset, rules) {
    var out = {}, monthCol = dataset === 'employment' ? 'snapshot_yyyymm' : 'period';
    for (var i = 0; i < rules.length; i++) {
      var k = rules[i], m = monthCol;
      if (k.dataset !== dataset) {
        if (!(k.dataset === 'employment' && k.treatment === 'flagged_incomplete' && dataset !== 'employment')) continue;
        m = EFF;
      }
      var mv = row[m];
      if (mv === null || mv === undefined || mv < k.first || mv > k.last) continue;
      if (k.entities.length && k.entities.indexOf(row[LEVEL_COL[k.level]]) < 0) continue;
      var f = k.field;
      if (f === '*') { var mc = dataset === 'employment' ? 'snapshot_yyyymm' : EFF; if (!out[mc]) out[mc] = k.id; continue; }
      if (!(f in row)) continue;
      var v = row[f];
      if (k.treatment === 'unknown') {
        var x = v === null || v === undefined || v === '' ? NaN : Number(v);
        if (!isFinite(x)) continue;
        if (k.min !== null && x < k.min) continue;
        if (k.max !== null && x > k.max) continue;
        if (!out[f]) out[f] = k.id;
      } else if (k.treatment === 'department_from_agency') {
        var d = row.department_code;
        if ((d === null || d === undefined || String(d).trim() === '' || String(d).toUpperCase() === 'NO DATA REPORTED') && !out.department_code) out.department_code = k.id;
      } else if (k.treatment === 'unknown_with_coverage') {
        if (v === 'REDACTED' && !out[f]) out[f] = k.id;
      }
    }
    return out;
  }

  return { EFF: EFF, COLUMNS: COLUMNS, FILTERS: FILTERS, columns: columns, cellText: cellText, filterValue: filterValue, distinct: distinct, apply: apply,
    sortRows: sortRows, counts: counts, csv: csv, kdiMarks: kdiMarks };
});
