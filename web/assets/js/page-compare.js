/* Page 4, Departments compared (page-spec 7.3, copy 8.3). Compare cube of the parent; the parent's core cube for its
   own row; the matrix cube for the government-level size rule (as page 1). */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, M = root.OPM.adminModel, CM = root.OPM.compareModel, SVG = root.OPM.svg, CH = root.OPM.charts, K = root.OPM.common, h = S.h;
  var t, meta, names, state, F = {}, ctl = {}, data = {}, sizes = null;
  var METRIC_TABS = [['dep', 'p4.heat.tab.dep'], ['hire', 'p4.heat.tab.hire'], ['drp', 'p4.heat.tab.drp']];
  var METHOD_TEXT = { a: 'shared.rate.a', b: 'shared.rate.b', c: 'shared.rate.c' };

  function ok(e) { return !!CM.source(e, meta.entities) && (e === 'GOV' || !!meta.parents[CM.source(e, meta.entities).file]); }
  function readState() {
    var p = S.params();
    return { entity: S.resolveEntity(ok), view: p.get('view') === 't12' ? 't12' : 'fy', period: p.get('period') || null,
      method: ['a', 'b', 'c'].indexOf(p.get('rate')) >= 0 ? p.get('rate') : 'a', metric: ['dep', 'hire', 'drp'].indexOf(p.get('metric')) >= 0 ? p.get('metric') : 'dep',
      all: p.get('all') === '1', sort: null, tsort: null, allRank: false, allReasons: false };
  }
  function writeState() {
    S.setParams({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 'fy' ? null : 't12', period: state.view === 'fy' && state.period !== data.years[data.years.length - 1].period ? state.period : null,
      rate: state.method === 'a' ? null : state.method, metric: state.metric === 'dep' ? null : state.metric, all: state.all ? '1' : null });
  }
  function emptyMark() { return t('shared.mark.empty'); }
  function naText() { return t('p4.heat.na').split(':')[0]; }
  function fyLabel(y) { var txt = t('shared.period.fy', { yyyy: y.period.slice(2) }); return y.partial ? t('shared.period.partial', { period: txt }) : txt; }
  function methods() { return state.view === 't12' ? ['a'] : ['a', 'b', 'c']; }

  function controls() {
    var choices = S.entityChoices(meta.entities, names, ['department', 'agency'], t('p1.control.entity.all')).filter(function (o) { return ok(o.value); });
    ctl.entity = S.selectField({ label: t('p4.parent'), cls: 'field--entity', options: choices, value: state.entity, onChange: function (v) { state.entity = v; state.sort = state.tsort = null; load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: [{ value: 'fy', text: t('shared.view.fy') }, { value: 't12', text: t('shared.view.t12') }], value: state.view, note: t('shared.view.note'),
      onChange: function (v) { state.view = v; if (methods().indexOf(state.method) < 0) state.method = 'a'; render(); } });
    ctl.period = S.selectField({ label: t('shared.period'), options: [], onChange: function (v) { state.period = v; render(); } });
    ctl.rate = S.segmented({ label: t('shared.rate'), options: ['a', 'b', 'c'].map(function (m) { return { value: m, text: t(METHOD_TEXT[m]) }; }), value: state.method,
      onChange: function (v) { if (methods().indexOf(v) < 0) { ctl.rate.set(state.method); return; } state.method = v; render(); } });
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.view.el, ctl.period.el, ctl.rate.el]);
  }
  function syncControls() {
    ctl.entity.set(state.entity);
    ctl.view.set(state.view);
    ctl.period.fill(data.years.slice().reverse().map(function (y) { return { value: y.period, text: fyLabel(y) }; }), state.period);
    ctl.period.el.hidden = state.view !== 'fy';
    ctl.rate.set(state.method);
    ctl.rate.group.querySelectorAll('button').forEach(function (b) { b.disabled = methods().indexOf(b.getAttribute('data-value')) < 0; });
  }

  /* ---- rows for the chosen period: children, and the parent pinned on top */
  function periodRows() {
    var key = state.view === 'fy' ? state.period : data.t12;
    var kids = data.kids.filter(function (r) { return r.grain === state.view && r.period === key; });
    return { kids: kids, parent: CM.parentRow(data.core, state.view, key), key: key };
  }
  function periodLabel() {
    if (state.view === 't12') return t('shared.period.t12', { month: C.monthLabel(data.t12) });
    return fyLabel(data.years.filter(function (y) { return y.period === state.period; })[0]);
  }

  /* ---- 7.3.1 heat map by fiscal year */
  function renderHeat() {
    var f = F.heat, years = data.years, m = state.method; // columns are fiscal years, where methods A, B and C all exist
    var byChild = {};
    data.kids.forEach(function (r) { if (r.grain === 'fy') (byChild[r.child] = byChild[r.child] || {})[r.period] = r; });
    var latest = {};
    data.kids.forEach(function (r) { if (r.grain === 't12') latest[r.child] = r.headcount; });
    var list = Object.keys(byChild).map(function (k) { return { key: k, name: names[k] || k, size: sizes && data.src.parent === 'GOV' ? sizes[k] : latest[k], rows: byChild[k] }; });
    var gov = data.src.parent === 'GOV', filtered = gov && !state.all;
    if (filtered) list = list.filter(function (r) { return r.size !== null && r.size !== undefined && r.size >= M.SIZE_RULE; });
    var parentRows = {};
    data.core.forEach(function (r) { if (r.grain === 'fy') parentRows[r.period] = r; });
    var col = state.sort ? state.sort.col : years[years.length - 1].period, dir = state.sort ? state.sort.dir : 'desc';
    function val(r) { var y = years.filter(function (x) { return x.period === col; })[0]; var c = r.rows ? CM.cell(r.rows[col], state.metric, m, y && y.fiscal_year) : null; return c && !c.na ? c.value : null; }
    list.sort(function (a, b) {
      if (col === 'name') return (dir === 'asc' ? 1 : -1) * a.name.localeCompare(b.name);
      if (col === 'size') return (dir === 'asc' ? 1 : -1) * ((a.size || 0) - (b.size || 0));
      var x = val(a), y = val(b);
      if (x === null && y === null) return a.name.localeCompare(b.name);
      if (x === null) return 1; if (y === null) return -1;
      return x === y ? a.name.localeCompare(b.name) : (dir === 'asc' ? 1 : -1) * (x - y);
    });
    var rows = [{ key: state.entity, name: names[state.entity], pinned: true, rows: parentRows }].concat(list);
    F.heat.setTitle(t('p4.heat.title'));
    F.heat.setSub([t(METHOD_TEXT[m]) + '. ' + t('shared.rate.help.' + m), ' ', t('shared.sort')]);
    ctl.tabs.forEach(function (b) { var on = b.getAttribute('data-metric') === state.metric; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    function th(colKey, label) {
      var on = col === colKey;
      var b = h('button', { type: 'button', 'data-sort': colKey, onclick: function () { state.sort = { col: colKey, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : colKey === 'name' ? 'asc' : 'desc' }; renderHeat(); var x = document.querySelector('#cmp-heat button[data-sort="' + colKey + '"]'); if (x) x.focus(); } },
        [label, ' ', h('span', { class: 'heat__arrow', 'aria-hidden': 'true', text: on ? (dir === 'asc' ? '▲' : '▼') : '' })]);
      return h('th', { scope: 'col', class: colKey === 'name' ? null : 'heat__admin', 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }, b);
    }
    var anySmall = false, cells = [];
    var body = rows.map(function (r) {
      return h('tr', { class: r.pinned ? 'is-pinned' : '', 'data-entity': r.key }, [h('th', { scope: 'row', text: r.name })].concat(years.map(function (y) {
        var c = CM.cell(r.rows[y.period], state.metric, m, y.fiscal_year), has = !c.na && c.value !== null && c.value !== undefined;
        var st = has ? M.bin(state.metric, c.value) : M.NA_STYLE, sm = has && c.small;
        if (sm) anySmall = true;
        if (c.row) cells.push(c.row);
        var txt = c.na ? naText() : has ? C.pct(c.value) : emptyMark();
        r.cellsOut = (r.cellsOut || []).concat([{ text: txt, bg: st.bg, fg: st.fg, small: sm }]);
        return h('td', { class: 'heat__cell' + (c.na ? ' is-na' : '') + (sm ? ' is-small' : ''), style: 'background-color:' + st.bg + ';color:' + st.fg + ';--hatch:' + (st.fg === '#0d1117' ? 'rgba(255,255,255,0.22)' : 'rgba(13,17,23,0.3)'), text: txt });
      })));
    });
    var table = h('table', { class: 'heat', id: 'cmp-heat' }, [h('caption', { class: 'visually-hidden', text: t('p4.heat.title') }),
      h('thead', {}, h('tr', {}, [th('name', t('p4.col.name'))].concat(years.map(function (y) { return th(y.period, fyLabel(y)); })))), h('tbody', {}, body)]);
    var foot = h('div', { class: 'heat-foot mono' }, [filtered ? h('span', { class: 'status', text: t('p1.heat.filter') }) : null,
      gov ? h('label', { class: 'switch' }, [h('input', { type: 'checkbox', id: 'cmp-all', checked: state.all, onchange: function (e) { state.all = e.target.checked; writeState(); renderHeat(); } }), t('p1.heat.switch')]) : null,
      h('div', { class: 'legend', 'aria-hidden': 'true' }, M.BINS[state.metric].map(function (b) { return h('span', { style: 'background:' + b.bg + ';color:' + b.fg, text: b.label }); }))]);
    var hb = h('div', { class: 'heat-box', role: 'tabpanel', 'aria-labelledby': 'cmp-tab-' + state.metric, tabindex: '0' }, table);
    f.setBody(h('div', {}, [hb, foot]));
    hb.scrollLeft = hb.scrollWidth; // the latest fiscal years first in view
    var fl = flagsOf(cells);
    var notes = [t('p4.heat.na'), anySmall ? t('p1.heat.small') : null].concat(S.flagNotes({ provisional: fl.provisional, incomplete: fl.incomplete, kdi: fl.kdi, partial: lastPartial(), partialLabel: lastPartial() ? lastPartial().period : '', ytd: true }));
    f.setNotes(notes);
    f.setTable(S.dataTable(t('p4.heat.title'), [t('p4.col.name')].concat(years.map(fyLabel)), rows.map(function (r) { return [r.name].concat(r.cellsOut.map(function (c) { return c.text; })); })));
    f.onSvg(function () {
      return { filename: 'departments-compared-' + state.entity + '-' + state.metric + '.svg', svg: SVG.heatmap({ title: t('p4.heat.title') + ': ' + t('p4.heat.tab.' + state.metric), subtitle: names[state.entity] + '. ' + t(METHOD_TEXT[m]),
        firstHead: t('p4.col.name'), sizeHead: '', headers: years.map(function (y) { return { text: fyLabel(y), color: '#e6edf3' }; }),
        rows: rows.map(function (r) { return { name: r.name, size: '', bold: r.pinned, cells: r.cellsOut }; }), legend: M.BINS[state.metric], notes: notes.map(function (x) { return typeof x === 'string' ? x : x && x.textContent; }).filter(Boolean) }) };
    });
  }
  function lastPartial() { var y = data.years[data.years.length - 1]; return y.partial ? { period: fyLabel(y).replace(/ \(.*\)$/, ''), period_last_month: y.last } : null; }
  function flagsOf(rows) {
    var kdi = {};
    rows.forEach(function (r) { (r.kdi_ids || []).forEach(function (k) { kdi[k] = true; }); });
    return { provisional: rows.some(function (r) { return r.provisional; }), incomplete: rows.some(function (r) { return r.opm_incomplete; }), kdi: Object.keys(kdi).sort() };
  }

  /* ---- 7.3.2 table for the chosen period */
  var COLS = [['name', 'p4.col.name'], ['headcount', 'p4.col.employees'], ['hires', 'p4.col.hires'], ['departures', 'p4.col.departures'], ['acc_transfer_in', 'p4.col.tin'],
    ['sep_transfer_out', 'p4.col.tout'], ['dep', 'p4.col.dep'], ['hire', 'p4.col.hire'], ['sep_drp', 'p4.col.drp']];
  function cellOf(r, c) {
    if (c === 'name') return r._name;
    if (c === 'dep' || c === 'hire') return CM.rate(r, c, state.method);
    return r[c];
  }
  function textOf(r, c) {
    var v = cellOf(r, c);
    if (c === 'name') return v;
    if (v === null || v === undefined) return emptyMark();
    return c === 'dep' || c === 'hire' ? C.pct(v) + (CM.small(r, state.method) ? ' *' : '') : C.int(v);
  }
  function renderTable(pr) {
    var f = F.table, col = state.tsort ? state.tsort.col : 'headcount', dir = state.tsort ? state.tsort.dir : 'desc';
    var kids = pr.kids.map(function (r) { var o = Object.assign({}, r); o._name = names[r.child] || r.child; return o; });
    kids.sort(function (a, b) {
      var x = cellOf(a, col), y = cellOf(b, col);
      if (col === 'name') return (dir === 'asc' ? 1 : -1) * x.localeCompare(y);
      if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      return x === y ? a._name.localeCompare(b._name) : (dir === 'asc' ? 1 : -1) * (x - y);
    });
    var parent = pr.parent ? Object.assign({ _name: names[state.entity] }, pr.parent) : null;
    f.setTitle(t('p4.table.title'));
    f.setSub([t('p4.table.caption', { period: periodLabel(), method: t(METHOD_TEXT[state.method]) }), ' ', t('shared.sort')]);
    var head = h('tr', {}, COLS.map(function (c, i) {
      var on = col === c[0];
      return h('th', { scope: 'col', 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }, h('button', { type: 'button', 'data-sort': c[0], onclick: function () {
        state.tsort = { col: c[0], dir: on ? (dir === 'asc' ? 'desc' : 'asc') : c[0] === 'name' ? 'asc' : 'desc' }; renderTable(pr); var x = document.querySelector('#cmp-table button[data-sort="' + c[0] + '"]'); if (x) x.focus();
      } }, [t(c[1]), ' ', h('span', { class: 'heat__arrow', 'aria-hidden': 'true', text: on ? (dir === 'asc' ? '▲' : '▼') : '' })]));
    }));
    var rowEl = function (r, pinned) { return h('tr', { class: pinned ? 'is-pinned' : '' }, COLS.map(function (c, i) { return i === 0 ? h('th', { scope: 'row', text: textOf(r, c[0]) }) : h('td', { text: textOf(r, c[0]) }); })); };
    var table = h('table', { class: 'data-table sortable', id: 'cmp-table' }, [h('caption', { class: 'visually-hidden', text: t('p4.table.title') }), h('thead', {}, head),
      h('tbody', {}, (parent ? [rowEl(parent, true)] : []).concat(kids.map(function (r) { return rowEl(r, false); })))]);
    f.setBody(h('div', { class: 'scroll' }, table));
    var anySmall = kids.some(function (r) { return CM.small(r, state.method); }) || CM.small(parent, state.method);
    var fl = flagsOf(pr.kids.concat(parent ? [parent] : []));
    f.setNotes([anySmall ? '* ' + t('shared.flag.small') : null].concat(S.flagNotes({ provisional: fl.provisional, incomplete: fl.incomplete, kdi: fl.kdi })));
    f.setTable(S.dataTable(t('p4.table.title'), COLS.map(function (c) { return t(c[1]); }), (parent ? [parent] : []).concat(kids).map(function (r) { return COLS.map(function (c) { return textOf(r, c[0]); }); })));
    f.onSvg(function () {
      return { filename: 'departments-compared-' + state.entity + '-table.svg', svg: SVG.heatmap({ title: t('p4.table.title'), subtitle: t('p4.table.caption', { period: periodLabel(), method: t(METHOD_TEXT[state.method]) }),
        firstHead: t('p4.col.name'), sizeHead: t('p4.col.employees'), headers: COLS.slice(2).map(function (c) { return { text: t(c[1]), color: '#9da7b3' }; }),
        rows: (parent ? [parent] : []).concat(kids).map(function (r, i) { return { name: textOf(r, 'name'), size: textOf(r, 'headcount'), bold: parent && i === 0, cells: COLS.slice(2).map(function (c) { return { text: textOf(r, c[0]), bg: '#161b22', fg: '#e6edf3' }; }) }; }) }) };
    });
  }

  /* ---- 7.3.3 departure rate ranking */
  function largest(kids, all) { var s = kids.slice().sort(function (a, b) { return (b.headcount || 0) - (a.headcount || 0); }); return all ? s : s.slice(0, 25); }
  function renderRank(pr) {
    var f = F.rank, m = state.method;
    var list = largest(pr.kids, state.allRank).map(function (r) { return { name: names[r.child] || r.child, v: CM.rate(r, 'dep', m), small: CM.small(r, m) }; })
      .sort(function (a, b) { if (a.v === null) return 1; if (b.v === null) return -1; return b.v - a.v || a.name.localeCompare(b.name); });
    var ref = CM.rate(pr.parent, 'dep', m), max = Math.max.apply(null, list.map(function (r) { return r.v || 0; }).concat([ref || 0, 0.0001]));
    f.setTitle(t('p4.ranking.title'));
    var refText = ref === null ? null : t('p4.ranking.reference', { name: names[state.entity], rate: C.pct(ref) });
    f.setSub([t('p4.table.caption', { period: periodLabel(), method: t(METHOD_TEXT[m]) }), refText ? ' ' + refText : '']);
    var wrap = h('div', { class: 'rank', style: 'position:relative' });
    list.forEach(function (r) {
      wrap.appendChild(h('div', { class: 'hbar-row' }, [h('span', { title: r.name, text: r.name }), h('span', { class: 'bar-row', style: 'grid-template-columns:minmax(0,1fr) 64px;margin:0' }, [
        h('span', { class: 'bar-track', style: 'position:relative' }, [r.v === null ? null : h('span', { class: 'bar-fill' + (r.small ? ' is-small' : ''), style: '--swatch:#ff8c2e;width:' + (r.v / max * 100).toFixed(1) + '%' }),
          ref === null ? null : h('span', { 'aria-hidden': 'true', style: 'position:absolute;top:-3px;bottom:-3px;left:' + (ref / max * 100).toFixed(1) + '%;border-left:2px dashed #e6edf3' })]),
        h('span', { class: 'bar-val', text: r.v === null ? emptyMark() : C.pct(r.v) })])]));
    });
    f.setBody(wrap);
    ctl.moreRank.hidden = pr.kids.length <= 25;
    ctl.moreRank.textContent = state.allRank ? t('shared.showFewer') : t('shared.showAll');
    var anySmall = list.some(function (r) { return r.small; });
    f.setNotes([anySmall ? t('p1.heat.small') : null]);
    f.setTable(S.dataTable(t('p4.ranking.title'), [t('p4.col.name'), t('p4.col.dep')], list.map(function (r) { return [r.name, r.v === null ? emptyMark() : C.pct(r.v)]; })));
    f.onSvg(function () {
      return { filename: 'departments-compared-' + state.entity + '-ranking.svg', svg: SVG.hbars({ title: t('p4.ranking.title'), subtitle: t('p4.table.caption', { period: periodLabel(), method: t(METHOD_TEXT[m]) }),
        rows: list.map(function (r) { return { name: r.name, frac: r.v === null ? null : r.v / max, text: r.v === null ? emptyMark() : C.pct(r.v), color: '#ff8c2e', small: r.small }; }),
        ref: ref === null ? null : { frac: ref / max, text: refText }, notes: anySmall ? [t('p1.heat.small')] : [] }) };
    });
  }

  /* ---- 7.3.4 why people left, by child */
  function renderReasons(pr) {
    var f = F.reasons, list = largest(pr.kids, state.allReasons);
    var keys = CM.REASONS.map(function (x, i) { return { label: t('p1.reason.' + x[0]), color: CH.PALETTE.seven[i] }; });
    f.setTitle(t('p4.reasons.title'));
    f.setSub(t('p4.reasons.note', { period: periodLabel() }));
    var wrap = h('div', {}, [h('div', { class: 'key' }, keys.map(function (k) { return h('span', { style: '--swatch:' + k.color, text: k.label }); }))]);
    var out = list.map(function (r) { return { name: names[r.child] || r.child, parts: CM.reasonShares(r) }; });
    out.forEach(function (r) {
      wrap.appendChild(h('div', { class: 'hbar-row' }, [h('span', { title: r.name, text: r.name }), r.parts ? h('span', { class: 'hundred', role: 'img', 'aria-label': r.name + ': ' + keys.map(function (k, i) { return k.label + ' ' + C.pct(r.parts[i]); }).join(', ') },
        r.parts.map(function (p, i) { return h('span', { style: 'width:' + ((p || 0) * 100).toFixed(2) + '%;background:' + keys[i].color }); })) : h('span', { class: 'status', text: t('p4.reasons.none') })]));
    });
    f.setBody(wrap);
    ctl.moreReasons.hidden = pr.kids.length <= 25;
    ctl.moreReasons.textContent = state.allReasons ? t('shared.showFewer') : t('shared.showAll');
    f.setNotes([t('p3.chart.reasons.note')]);
    f.setTable(S.dataTable(t('p4.reasons.title'), [t('p4.col.name')].concat(keys.map(function (k) { return k.label; })), out.map(function (r) {
      return [r.name].concat(r.parts ? r.parts.map(function (p) { return C.pct(p) || emptyMark(); }) : keys.map(function (k, i) { return i === 0 ? t('p4.reasons.none') : ''; }));
    })));
    f.onSvg(function () {
      return { filename: 'departments-compared-' + state.entity + '-reasons.svg', svg: SVG.stacks({ title: t('p4.reasons.title'), subtitle: t('p4.reasons.note', { period: periodLabel() }), keys: keys,
        rows: out.map(function (r) { return { name: r.name, parts: r.parts, text: t('p4.reasons.none') }; }), notes: [t('p3.chart.reasons.note')] }) };
    });
  }

  function render() {
    if (!state.period || !data.years.some(function (y) { return y.period === state.period; })) state.period = data.years[data.years.length - 1].period;
    syncControls();
    renderHeat();
    var pr = periodRows();
    renderTable(pr); renderRank(pr); renderReasons(pr);
    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  function load() {
    document.body.removeAttribute('data-ready');
    var src = CM.source(state.entity, meta.entities);
    var need = [S.getJson('data/compare/' + src.file + '.json'), S.getJson('data/core/' + state.entity + '.json')];
    if (src.parent === 'GOV' && !sizes) need.push(S.getJson('data/matrix/matrix.json'));
    return Promise.all(need).then(function (fs) {
      var rows = root.OPM.seriesModel.objects(fs[0]);
      data = { src: src, kids: CM.childRows(rows, src, meta.entities), core: root.OPM.seriesModel.objects(fs[1]) };
      data.years = CM.fiscalYears(data.kids);
      data.t12 = (data.kids.filter(function (r) { return r.grain === 't12'; })[0] || {}).period;
      if (fs[2]) { var mx = M.indexMatrix(fs[2]); sizes = {}; Object.keys(mx).forEach(function (k) { var r = M.pick(mx[k], M.SIZE_ADMIN, 1); if (r) sizes[k] = r.headcount_0; }); }
      render();
    }, function () { var m = document.getElementById('main'); S.clear(m); S.empty(m); document.body.setAttribute('data-ready', 'true'); });
  }

  function tabs() {
    var list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('p4.heat.title') });
    ctl.tabs = METRIC_TABS.map(function (mt, i) {
      var b = h('button', { type: 'button', role: 'tab', id: 'cmp-tab-' + mt[0], 'data-metric': mt[0], text: t(mt[1]), onclick: function () { state.metric = mt[0]; state.sort = null; writeState(); renderHeat(); } });
      b.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
        if (j === null) return;
        e.preventDefault();
        var next = METRIC_TABS[(j + METRIC_TABS.length) % METRIC_TABS.length][0];
        state.metric = next; state.sort = null; writeState(); renderHeat(); document.getElementById('cmp-tab-' + next).focus();
      });
      list.appendChild(b);
      return b;
    });
    return list;
  }

  S.init('departments-compared').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/compare.meta.json'), S.getJson('data/core.meta.json')]).then(function (ms) {
      meta = { parents: ms[0].parents, entities: ms[1].entities, files: ms[1].files };
      S.setDataMonth(ms[1].range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p4.title') }), h('p', { text: t('p4.intro') }), controls()]));
      F.heat = S.frame({ id: 'heat', headExtra: tabs() });
      F.table = S.frame({ id: 'side' });
      ctl.moreRank = h('button', { type: 'button', class: 'btn', onclick: function () { state.allRank = !state.allRank; renderRank(periodRows()); } });
      ctl.moreReasons = h('button', { type: 'button', class: 'btn', onclick: function () { state.allReasons = !state.allReasons; renderReasons(periodRows()); } });
      F.rank = S.frame({ id: 'ranking', headExtra: ctl.moreRank });
      F.reasons = S.frame({ id: 'reasons', headExtra: ctl.moreReasons });
      [F.heat, F.table, F.rank, F.reasons].forEach(function (f) { main.appendChild(f.el); });
      root.OPM.page = { frames: F, state: function () { return state; } };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
