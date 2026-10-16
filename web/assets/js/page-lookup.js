/* Page 8, Look-Up (page-spec 7.7, copy 8.8). Reads one Look-Up Parquet file at a time (never joins files) with the
   vendored reader, and shows, filters, counts and downloads its rows exactly as OPM published them. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, LM = root.OPM.lookupModel, h = S.h;
  var PAGE_SIZE = 50;
  /* the seven appointment groups page 7 shows, labelled with its signed group labels (D-035) */
  var APPT_GROUPS = ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy'];
  var t, lmeta, ents, names, rules = [], appt = null, state, ctl = {}, box = {}, data = null;

  function datasetOf(rec) { return rec === 'separations' ? 'separations' : rec === 'accessions' ? 'accessions' : 'employment'; }
  function fyFiles(ds) {
    return Object.keys(lmeta.files).filter(function (k) { return lmeta.files[k].dataset === ds; }).sort(function (a, b) {
      var x = /before/.test(a) ? '0' : a, y = /before/.test(b) ? '0' : b; return x < y ? 1 : -1; });
  }
  function fyText(name) { return /before/.test(name) ? t('p8.ctl.fy.before') : t('shared.period.fy', { yyyy: name.slice(-4) }); }
  /* the entity in the URL as a preset filter, and the department whose employees load first */
  function entityPreset() {
    var e = S.entityParam(), x = ents[e];
    if (e === 'GOV' || !x) return { filters: {}, dept: null };
    if (x.level === 'department') return { filters: { department: x.code }, dept: x.code };
    if (x.level === 'agency') return { filters: { agency: x.code }, dept: x.parent };
    if (x.level === 'subelement') { var p = ents[x.parent]; return { filters: { subelement: x.code }, dept: p && p.level === 'agency' ? p.parent : x.parent }; }
    return { filters: {}, dept: null };
  }
  function readState() {
    var p = S.params(), rec = ['separations', 'accessions', 'employment'].indexOf(p.get('records')) >= 0 ? p.get('records') : 'separations';
    var pre = entityPreset();
    return { rec: rec, file: p.get('file') || null, dept: p.get('dept') || pre.dept, filters: pre.filters, search: '', countBy: 'reason', sort: null, page: 0 };
  }
  function writeState() { S.setParams({ records: state.rec === 'separations' ? null : state.rec, file: state.rec !== 'employment' && state.file ? state.file : null, dept: state.rec === 'employment' ? state.dept : null }); }

  function controls() {
    ctl.rec = S.segmented({ label: t('p8.ctl.records'), options: ['separations', 'accessions', 'employment'].map(function (r) { return { value: r, text: t('p8.ctl.records.' + r) }; }),
      value: state.rec, onChange: function (v) { state.rec = v; state.file = null; state.countBy = v === 'employment' ? 'occupation' : v === 'accessions' ? 'hireType' : 'reason'; sync(); load(); } });
    ctl.fy = S.selectField({ label: t('p8.ctl.fy'), options: [], onChange: function (v) { state.file = v; load(); } });
    var depts = Object.keys(lmeta.files).filter(function (k) { return lmeta.files[k].dataset === 'employment'; }).map(function (k) { return k.replace('employment_latest_', ''); })
      .sort(function (a, b) { return (names[a] || a).localeCompare(names[b] || b); });
    ctl.dept = S.selectField({ label: t('p8.ctl.dept'), options: [{ value: '', text: '' }].concat(depts.map(function (d) { return { value: d, text: names[d] || d }; })),
      note: t('p8.ctl.dept.choose', { month: C.monthLabel(lmeta.latest_employment_month.slice(0, 4) + '-' + lmeta.latest_employment_month.slice(4)) }),
      onChange: function (v) { state.dept = v || null; load(); } });
    return h('div', { class: 'controls' }, [ctl.rec.el, ctl.fy.el, ctl.dept.el]);
  }
  function sync() {
    ctl.rec.set(state.rec);
    var emp = state.rec === 'employment';
    ctl.fy.el.hidden = emp; ctl.dept.el.hidden = !emp;
    if (!emp) {
      var files = fyFiles(datasetOf(state.rec));
      if (!state.file || files.indexOf(state.file) < 0) state.file = files[0];
      ctl.fy.fill(files.map(function (f) { return { value: f, text: fyText(f) }; }), state.file);
    } else ctl.dept.set(state.dept || '');
  }

  function fileName() { return state.rec === 'employment' ? (state.dept ? 'employment_latest_' + state.dept : null) : state.file; }
  function load() {
    sync(); writeState();
    var name = fileName();
    S.clear(box.results);
    data = null;
    if (!name || !lmeta.files[name]) { box.results.appendChild(h('p', { class: 'status', role: 'status', text: state.rec === 'employment' ? t('p8.ctl.dept.choose', { month: C.monthLabel(lmeta.latest_employment_month.slice(0, 4) + '-' + lmeta.latest_employment_month.slice(4)) }) : t('shell.empty') })); document.body.setAttribute('data-ready', 'true'); return Promise.resolve(); }
    document.body.removeAttribute('data-ready');
    box.results.appendChild(h('p', { class: 'status', role: 'status', text: '…' }));
    var ds = lmeta.files[name].dataset;
    return fetch(S.asset('data/' + lmeta.files[name].path)).then(function (r) { if (!r.ok) throw new Error(name + ' ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return root.OPMParquet.parquetReadObjects({ file: buf, compressors: root.OPMParquet.compressors }); })
      .then(function (rows) {
        if (fileName() !== name) return; // another file was chosen meanwhile
        var fields = lmeta.fields[ds];
        data = { name: name, ds: ds, rows: rows, fields: fields, cols: LM.columns(fields, { appointment: appt }) };
        data.filterCols = data.cols.filter(function (c) { return LM.FILTERS.indexOf(c.key) >= 0; });
        data.options = {};
        data.filterCols.forEach(function (c) { data.options[c.key] = LM.distinct(rows, c); });
        Object.keys(state.filters).forEach(function (k) { if (!data.options[k] || !data.options[k].some(function (o) { return o.value === state.filters[k]; })) delete state.filters[k]; });
        if (!data.filterCols.some(function (c) { return c.key === state.countBy; })) state.countBy = data.filterCols[0].key;
        state.page = 0; state.sort = null;
        buildFilters(); refresh();
      }).catch(function (e) { console.warn(String(e)); S.clear(box.results); S.empty(box.results); document.body.setAttribute('data-ready', 'true'); });
  }

  function colLabel(c) { return t('p8.col.' + c.key); }
  function buildFilters() {
    S.clear(box.results);
    var grid = h('div', { class: 'controls lookup-filters' });
    data.filterCols.forEach(function (c) {
      var f = S.selectField({ label: colLabel(c), options: [{ value: '__all', text: t('p8.ctl.filter.all') }].concat(data.options[c.key].map(function (o) { return { value: o.value, text: (o.label || o.value) + ' (' + C.int(o.count) + ')' }; })),
        value: state.filters[c.key] || '__all', onChange: function (v) { if (v === '__all') delete state.filters[c.key]; else state.filters[c.key] = v; state.page = 0; refresh(); } });
      f.el.setAttribute('data-filter', c.key);
      grid.appendChild(f.el);
    });
    var sid = 'lookup-search', search = h('input', { type: 'search', id: sid, placeholder: t('p8.ctl.search.placeholder'), value: state.search });
    var timer = null;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { state.search = search.value; state.page = 0; refresh(); }, 250); });
    grid.appendChild(h('div', { class: 'field' }, [h('label', { for: sid, text: t('p8.ctl.search') }), search]));
    var countBy = S.selectField({ label: t('p8.ctl.countBy'), options: data.filterCols.map(function (c) { return { value: c.key, text: colLabel(c) }; }), value: state.countBy,
      onChange: function (v) { state.countBy = v; refresh(); } });
    grid.appendChild(countBy.el);
    grid.appendChild(h('div', { class: 'field' }, [h('span', { class: 'field__label', text: ' ' }), h('button', { type: 'button', class: 'btn', id: 'lookup-clear', text: t('p8.ctl.clear'), onclick: function () { state.filters = {}; state.search = ''; state.page = 0; buildFilters(); refresh(); } })]));
    box.results.appendChild(h('h2', { class: 'visually-hidden', text: t('p8.ctl.filters') }));
    box.results.appendChild(grid);
    box.summary = h('div', { class: 'lookup-summary' });
    box.table = h('div', { class: 'lookup-table-box' });
    box.results.appendChild(box.summary);
    box.results.appendChild(box.table);
    box.results.appendChild(h('div', { class: 'frame__actions' }, [h('button', { type: 'button', class: 'btn', id: 'lookup-download', text: t('p8.download'), onclick: download })]));
    box.results.appendChild(h('div', { class: 'frame__notes' }, [h('p', { text: t('p8.download.note') }), h('p', {}, S.readingLink(t('p8.kdi.marker'), 'known-data-issues'))]));
  }

  function filtered() { return LM.apply(data.rows, data.filterCols, state.filters, state.search, data.fields); }
  function refresh() {
    var rows = filtered();
    if (state.sort) rows = LM.sortRows(rows, data.cols.filter(function (c) { return c.key === state.sort.col; })[0], state.sort.dir);
    data.current = rows;
    // summary: matching records and counts by the chosen field
    S.clear(box.summary);
    box.summary.appendChild(h('p', { class: 'lookup-count', role: 'status', text: rows.length ? t('p8.summary.count', { count: C.int(rows.length) }) : t('p8.summary.none') }));
    var cb = data.filterCols.filter(function (c) { return c.key === state.countBy; })[0];
    if (cb && rows.length) {
      var cnt = LM.counts(rows, cb).slice(0, 25);
      box.summary.appendChild(h('div', { class: 'scroll' }, S.dataTable(t('p8.ctl.countBy') + ' ' + colLabel(cb), [colLabel(cb), t('p8.summary.count', { count: '' }).trim()], cnt.map(function (o) { return [o.label || o.value, C.int(o.count)]; }))));
    }
    // the table, 50 rows a page
    S.clear(box.table);
    if (!rows.length) { document.body.setAttribute('data-ready', 'true'); return; }
    var pages = Math.ceil(rows.length / PAGE_SIZE);
    state.page = Math.min(state.page, pages - 1);
    var slice = rows.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    var head = h('tr', {}, data.cols.map(function (c) {
      var on = state.sort && state.sort.col === c.key, dir = on ? state.sort.dir : null;
      return h('th', { scope: 'col', 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }, h('button', { type: 'button', 'data-sort': c.key, onclick: function () {
        state.sort = { col: c.key, dir: on && dir === 'asc' ? 'desc' : 'asc' }; state.page = 0; refresh(); var b = document.querySelector('#lookup-table button[data-sort="' + c.key + '"]'); if (b) b.focus();
      } }, [colLabel(c), ' ', h('span', { class: 'heat__arrow', 'aria-hidden': 'true', text: on ? (dir === 'asc' ? '▲' : '▼') : '' })]));
    }));
    var body = slice.map(function (r) {
      var marks = LM.kdiMarks(r, data.ds, rules);
      return h('tr', {}, data.cols.map(function (c) {
        var id = null;
        c.fields.forEach(function (f) { if (marks[f]) id = marks[f]; });
        var txt = LM.cellText(r, c);
        if (!id) return h('td', { text: txt, title: txt.length > 30 ? txt : null });
        return h('td', { class: 'is-kdi' }, h('a', { href: S.pageHref('reading-the-data.html') + '#kdi-' + id.slice(4), 'data-page-link': 'reading-the-data.html', title: id + ': ' + t('p8.kdi.marker'), text: txt === '' ? id : txt }));
      }));
    });
    box.table.appendChild(h('div', { class: 'scroll' }, h('table', { class: 'data-table sortable lookup-table', id: 'lookup-table' }, [h('caption', { class: 'visually-hidden', text: t('p8.title') }), h('thead', {}, head), h('tbody', {}, body)])));
    box.table.appendChild(h('div', { class: 'pager' }, [
      h('button', { type: 'button', class: 'btn', id: 'lookup-prev', disabled: state.page === 0, text: t('p8.table.prev'), onclick: function () { state.page--; refresh(); } }),
      h('span', { role: 'status', text: t('p8.table.page', { page: C.int(state.page + 1), pages: C.int(pages) }) }),
      h('button', { type: 'button', class: 'btn', id: 'lookup-next', disabled: state.page >= pages - 1, text: t('p8.table.next'), onclick: function () { state.page++; refresh(); } })]));
    document.body.setAttribute('data-ready', 'true');
  }

  function download() {
    if (!data) return;
    var blob = new Blob([LM.csv(data.current || [], data.fields)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = data.name + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  S.init('look-up').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/lookup.meta.json'), S.getJson('data/admin.meta.json'), S.getJson('assets/lookup-kdi.json'), S.getJson('data/appointments.meta.json')]).then(function (ms) {
      lmeta = ms[0]; ents = ms[1].entities; rules = ms[2].rows;
      appt = LM.appointmentGroups(ms[3].groups.list, function (id) { return APPT_GROUPS.indexOf(id) >= 0 ? t('p7.group.' + id) : null; });
      S.setDataMonth(ms[1].range.last_month);
      names = C.displayNames(ents, t('p1.control.entity.all'));
      var e = S.entityParam();
      var more = e !== 'GOV' && !ents[e] ? S.getJson('data/core.meta.json').then(function (cm) { ents = Object.assign({}, cm.entities, ents); }, function () {}) : Promise.resolve();
      return more.then(function () {
        state = readState();
        var main = document.getElementById('main');
        main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p8.title') }), h('p', { text: t('p8.intro') }), h('p', { text: t('p8.privacy') }), controls()]));
        box.results = h('section', { class: 'lookup', id: 'lookup', 'aria-label': t('p8.title') });
        main.appendChild(box.results);
        root.OPM.page = { state: function () { return state; }, data: function () { return data; }, frames: {} };
        return load();
      });
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
