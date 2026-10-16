/* The occupation filter on pages 2 and 3 (occupation-spec 5.2): a control, the banner under the page title, the URL
   (family=<code> at any level, series=<code> at government level only) and the rows of the chosen occupation, built
   by OPM.occModel.synth from the monthly occupation cubes and the entity's core rows. Browser only. */
(function (root) {
  'use strict';
  var S = root.OPM.shell, O = root.OPM.occModel, h = S.h;
  var t, fmeta, smeta, maps, cur = null, files = {}, sel, banner, onChange;

  function ok(level, code, entity) {
    if (!maps || !code) return false;
    if (level === 'series' && entity !== 'GOV') return false;
    return Object.prototype.hasOwnProperty.call(maps[level], code);
  }
  /* the filter in the URL, valid for the entity, or none (an invalid one is removed from the URL) */
  function read(entity) {
    var p = S.params(), f = p.get('family'), s = p.get('series');
    cur = f && ok('family', f, entity) ? { level: 'family', code: f } : s && ok('series', s, entity) ? { level: 'series', code: s } : null;
    if ((f || s) && !cur) S.setParams({ family: null, series: null });
    return cur;
  }
  function params() { return { family: cur && cur.level === 'family' ? cur.code : null, series: cur && cur.level === 'series' ? cur.code : null }; }
  function label(level, code) { return O.occName(maps, level, code, t('p10.notReported')); }
  function sorted(level) { return Object.keys(maps[level]).sort(function (a, b) { return a === O.NR ? 1 : b === O.NR ? -1 : a < b ? -1 : 1; }); }

  /* the select: All occupations, then families, then (government only) job series */
  function control() {
    var id = 'ctl-occ';
    sel = h('select', { id: id, onchange: function () {
      var v = sel.value, i = v.indexOf(':');
      cur = v ? { level: v.slice(0, i), code: v.slice(i + 1) } : null;
      S.setParams(params()); paintBanner(); onChange();
    } });
    return h('div', { class: 'field field--occ' }, [h('label', { for: id, text: t('filter.occ.label') }), sel]);
  }
  function fill(entity) {
    S.clear(sel);
    sel.parentNode.hidden = !maps;
    if (!maps) return;
    sel.appendChild(h('option', { value: '', text: t('filter.occ.all') }));
    [['family', 'p10.level.family']].concat(entity === 'GOV' ? [['series', 'p10.level.series']] : []).forEach(function (g) {
      sel.appendChild(h('optgroup', { label: t(g[1]) }, sorted(g[0]).map(function (c) { return h('option', { value: g[0] + ':' + c, text: label(g[0], c) }); })));
    });
    sel.value = cur ? cur.level + ':' + cur.code : '';
  }
  function paintBanner() {
    S.clear(banner);
    banner.hidden = !cur;
    if (!cur) return;
    banner.appendChild(document.createTextNode(t('filter.occ.banner', { occupation: label(cur.level, cur.code) }) + ' '));
    banner.appendChild(h('button', { type: 'button', class: 'btn', id: 'occ-clear', text: t('filter.occ.clear'), onclick: function () {
      cur = null; S.setParams(params()); sel.value = ''; paintBanner(); onChange();
    } }));
  }

  /* when the entity changes: a job series is government only */
  function setEntity(entity) {
    if (cur && !ok(cur.level, cur.code, entity)) { cur = null; S.setParams(params()); }
    fill(entity); paintBanner();
  }

  function getFile(path) { if (!files[path]) files[path] = S.getJson('data/' + path).catch(function (e) { delete files[path]; throw e; }); return files[path]; }
  /* rows of the chosen occupation shaped like core's; viewRows: the core rows on view (their months decide which
     parts of the split series cube are needed) */
  function rows(coreRows, entity, viewRows) {
    if (!cur) return Promise.resolve(coreRows);
    var nr = cur.code === O.NR;
    if (cur.level === 'family') {
      var fe = fmeta.files[entity];
      if (!fe) return Promise.reject(new Error('no occupation file for ' + entity));
      return getFile(fe.path).then(function (f) { return O.synth(coreRows, O.monthly([f], 'family', cur.code), { nr: nr }); });
    }
    var months = coreRows.filter(function (r) { return r.grain === 'month'; }).slice(-24); // the tiles read the latest 24 months
    var keys = O.partsNeeded(smeta.files, O.earliestMonth(viewRows.concat(months)));
    var knownFrom = null;
    keys.forEach(function (k) { if (!knownFrom || smeta.files[k].first_month < knownFrom) knownFrom = smeta.files[k].first_month; });
    if (knownFrom === smeta.range.first_month) knownFrom = null;
    return Promise.all(keys.map(function (k) { return getFile(smeta.files[k].path); })).then(function (fs) {
      return O.synth(coreRows, O.monthly(fs, 'series', cur.code), { nr: nr, knownFrom: knownFrom });
    });
  }

  /* a section that has no figures for one occupation: its body, table view and SVG say so */
  function unavailable(f, file) {
    if (f.clearChart) f.clearChart();
    var msg = t('filter.occ.unavailable');
    f.setBody(h('p', { class: 'status', role: 'status', text: msg }));
    f.setTable(h('p', { class: 'status', text: msg }));
    f.setNotes([]);
    f.onSvg(function () { return { filename: file + '.svg', svg: root.OPM.svg.document(640, 20, { title: f.titleText || '', notes: [msg] }, function () { return ''; }) }; });
  }

  function init(copy, change) {
    t = copy.t; onChange = change;
    banner = h('p', { class: 'occ-banner', role: 'status', hidden: true });
    // without the occupation cubes (not yet promoted) the page works as before, with no filter
    return Promise.all([S.getJson('data/occ_family_monthly.meta.json'), S.getJson('data/occ_series_monthly.meta.json')]).then(function (ms) {
      fmeta = ms[0]; smeta = ms[1]; maps = O.nameMaps(fmeta);
    }, function () { maps = null; });
  }

  root.OPM.occFilter = { init: init, read: read, control: control, banner: function () { return banner; }, setEntity: setEntity, params: params, rows: rows,
    current: function () { return cur; }, label: function () { return cur ? label(cur.level, cur.code) : null; }, unavailable: unavailable };
})(self);
