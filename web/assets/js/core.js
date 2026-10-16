/* Pure helpers shared by every page: copy lookup, number and month formats, entity display names.
   No DOM. Loaded in the browser as OPM.core and in node tests through require(). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.core = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- copy: every visible string comes from copy.json through t() */
  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? String(vars[k]) : all; });
  }
  function createCopy(json) {
    var strings = json.strings || {}, used = {};
    function t(key, vars) {
      if (!Object.prototype.hasOwnProperty.call(strings, key)) throw new Error('copy.json has no ' + key);
      used[key] = true;
      return fill(strings[key], vars);
    }
    return { t: t, has: function (k) { return Object.prototype.hasOwnProperty.call(strings, k); }, used: function () { return Object.keys(used).sort(); } };
  }

  /* ---- numbers. The minus sign is the ASCII hyphen-minus, as the spec writes figures. */
  var NUM = new Intl.NumberFormat('en-US');
  function int(v) { return v === null || v === undefined || !isFinite(v) ? null : NUM.format(Math.round(v)); }
  function signedInt(v) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    var r = Math.round(v);
    return (r > 0 ? '+' : r < 0 ? '-' : '') + NUM.format(Math.abs(r));
  }
  /* a ratio as a percent with one decimal; signed adds + or - (never "-0.0%") */
  function pct(ratio, signed) {
    if (ratio === null || ratio === undefined || !isFinite(ratio)) return null;
    var t = Math.abs(ratio * 100).toFixed(1);
    if (+t === 0) return '0.0%';
    var sign = ratio < 0 ? '-' : (signed ? '+' : '');
    return sign + t + '%';
  }
  /* ratio of two sums, or null when the denominator is empty or zero (never 0/0) */
  function ratio(num, den) {
    if (num === null || num === undefined || den === null || den === undefined || !isFinite(num) || !isFinite(den) || den === 0) return null;
    return num / den;
  }

  /* ---- months and dates */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(ym) { // 'YYYY-MM' -> 'Aug 2026'
    var m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    return m ? MON[+m[2] - 1] + ' ' + m[1] : '';
  }
  function stampDate(stamp) { // 'YYYYMMDD-HHMMSS' -> 'Oct 16, 2026'
    var d = /^(\d{4})(\d{2})(\d{2})/.exec(stamp || '');
    return d ? MON[+d[2] - 1] + ' ' + (+d[3]) + ', ' + d[1] : '';
  }
  /* months from first to last inclusive, both 'YYYY-MM' (calendar arithmetic, not a data figure) */
  function monthsBetween(first, last) {
    var a = /^(\d{4})-(\d{2})$/.exec(first), b = /^(\d{4})-(\d{2})$/.exec(last);
    if (!a || !b) return 0;
    return (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) + 1;
  }

  /* ---- entity names: OPM's names in title case; where two names match, the lower level gets its code */
  var SMALL = { a: 1, an: 1, and: 1, as: 1, at: 1, by: 1, for: 1, from: 1, in: 1, of: 1, on: 1, or: 1, the: 1, to: 1, with: 1 };
  var KEEP = { 'U.S.': 1, US: 1, CHIP: 1 };
  function titleWord(w, first) {
    if (!w) return w;
    if (KEEP[w] || /^\(.*\)$/.test(w) || /^([A-Z]\.)+$/.test(w)) return w;
    var lower = w.toLowerCase();
    if (!first && SMALL[lower]) return lower;
    return lower.split('-').map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join('-');
  }
  function titleCase(name) {
    var words = String(name || '').trim().split(/\s+/);
    var out = [], first = true;
    words.forEach(function (w) {
      var parts = w.split('/');
      out.push(parts.map(function (p, i) { return titleWord(p, first || i > 0); }).join('/'));
      first = /:$/.test(w);
    });
    return out.join(' ');
  }
  var LEVEL_RANK = { government: 0, department: 1, agency: 2, subelement: 3 };
  /* entities: { key: { level, code, name } } -> { key: display name }; GOV takes allName */
  function displayNames(entities, allName) {
    var out = {}, byName = {};
    Object.keys(entities).forEach(function (k) {
      var e = entities[k];
      out[k] = k === 'GOV' ? allName : titleCase(e.name);
      (byName[out[k]] = byName[out[k]] || []).push(k);
    });
    Object.keys(byName).forEach(function (n) {
      var keys = byName[n];
      if (keys.length < 2) return;
      keys.sort(function (a, b) { return (LEVEL_RANK[entities[a].level] || 9) - (LEVEL_RANK[entities[b].level] || 9); });
      keys.slice(1).forEach(function (k) { out[k] = n + ' (' + (entities[k].code || k) + ')'; });
    });
    return out;
  }

  return { fill: fill, createCopy: createCopy, int: int, signedInt: signedInt, pct: pct, ratio: ratio,
    monthLabel: monthLabel, stampDate: stampDate, monthsBetween: monthsBetween, titleCase: titleCase, displayNames: displayNames };
});
