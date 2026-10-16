/* Page 2, Workforce size (page-spec 7.1, copy 8.1). Core cube of the selected entity; compare cube for 7.1.4. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, SM = root.OPM.seriesModel, CH = root.OPM.charts, K = root.OPM.common, h = S.h;
  var t, meta, adminList, names, rows, state, F = {}, ctl = {}, compareCache = {};
  var VIEWS = [['fy', 'shared.view.fy'], ['fq', 'shared.view.fq'], ['month', 'shared.view.month']];

  function readState() {
    var p = S.params();
    return { entity: S.resolveEntity(function (e) { return !!meta.files[e]; }), view: ['fy', 'fq', 'month'].indexOf(p.get('view')) >= 0 ? p.get('view') : 'fy',
      range: p.get('range') && adminList.some(function (a) { return a.id === p.get('range'); }) ? p.get('range') : 'full', all: p.get('all') === '1' };
  }
  function writeState() { S.setParams({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 'fy' ? null : state.view, range: state.range === 'full' ? null : state.range, all: state.all ? '1' : null }); }

  function controls() {
    ctl.entity = S.selectField({ label: t('p1.control.entity'), cls: 'field--entity', options: S.entityChoices(meta.entities, names, ['department', 'agency', 'subelement'], t('p1.control.entity.all')),
      value: state.entity, onChange: function (v) { state.entity = v; load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: VIEWS.map(function (v) { return { value: v[0], text: t(v[1]) }; }), value: state.view, note: t('shared.view.note'),
      onChange: function (v) { state.view = v; render(); } });
    ctl.range = S.selectField({ label: t('shared.range'), options: [{ value: 'full', text: t('shared.range.full') }].concat(adminList.map(function (a) { return { value: a.id, text: a.name }; })),
      value: state.range, onChange: function (v) { state.range = v; render(); } });
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.view.el, ctl.range.el]);
  }

  function render() {
    var grain = SM.GRAINS[state.view], view = SM.byGrain(rows, grain), months = SM.byGrain(rows, 'month');
    var preset = SM.presets(adminList).filter(function (p) { return p.id === state.range; })[0];
    var range = SM.inRange(view, preset);
    var fl = SM.flags(range);
    var notes = S.flagNotes({ provisional: fl.provisional, partial: fl.partial, partialLabel: fl.partial ? fl.partial.period : '', ytd: fl.partial && fl.partial.grain === 'fy', incomplete: fl.incomplete, kdi: fl.kdi });

    // 7.1.1 tiles
    var tl = SM.sizeTiles(months, range);
    S.clear(F.tiles);
    F.tiles.appendChild(K.tile(t('p2.tile.headcount'), C.int(tl.headcount), [t('p2.tile.asof', { month: C.monthLabel(tl.asof) })]));
    F.tiles.appendChild(K.tile(t('p2.tile.change12'), C.signedInt(tl.change12), [tl.change12Pct === null ? null : C.pct(tl.change12Pct, true)]));
    if (tl.rangeStart) F.tiles.appendChild(K.tile(t('p2.tile.changeRange', { start: SM.label(tl.rangeStart), end: SM.label(tl.rangeEnd) }), C.signedInt(tl.changeRange),
      [tl.rangeFrom ? t('p2.tile.firstNote', { period: SM.label(tl.rangeFrom) }) : t('p2.tile.firstNote', { period: SM.label(tl.rangeStart) })]));

    var labels = range.map(SM.label), prov = range.map(function (r) { return !!r.provisional; });
    var bands = CH.adminBands(range, adminList);

    // 7.1.2 employees over time
    F.head.setTitle(t('p2.chart.headcount'));
    F.head.setSub(names[state.entity]);
    var line = { label: t('p2.tile.headcount'), data: range.map(function (r) { return r.headcount; }), borderColor: CH.PALETTE.line, backgroundColor: CH.PALETTE.line,
      pointRadius: range.length > 40 ? 0 : 2, borderWidth: 2, segment: CH.dashProvisional(prov), _provisional: prov };
    F.head.draw({ type: 'line', data: { labels: labels, datasets: [line] }, options: K.baseOptions({ bands: bands, legend: false, zero: false }), aria: t('p2.chart.headcount') }, 320);
    F.head.setNotes(notes);
    F.head.setTable(S.dataTable(t('p2.chart.headcount'), [t('shared.period'), t('p2.tile.headcount')], range.map(function (r) { return [K.periodText(r), C.int(r.headcount)]; })));

    // 7.1.3 change in employees vs hires minus departures, known breaks marked at Yearly view
    var breaks = {};
    (meta.known_breaks && meta.known_breaks.signed || []).forEach(function (b) { if (b.entity === state.entity) breaks['FY' + b.fiscal_year] = true; });
    var marks = state.view === 'fy' ? range.map(function (r) { return !!breaks[r.period]; }) : null;
    F.flow.setTitle(t('p2.chart.flow'));
    F.flow.setSub(t('p2.chart.flow.note'));
    F.flow.draw({ type: 'bar', data: { labels: labels, datasets: [
      { label: t('p2.chart.flow.change'), data: range.map(function (r) { return r.headcount_change; }), backgroundColor: CH.PALETTE.change, _provisional: prov },
      { label: t('p2.chart.flow.net'), data: range.map(function (r) { return r.net_flow; }), backgroundColor: CH.PALETTE.net, _provisional: prov }] },
      options: K.baseOptions({ bands: bands, signed: true, marks: marks }), aria: t('p2.chart.flow') }, 300);
    F.flow.setNotes(notes.concat(marks && marks.some(Boolean) ? [S.readingLink(t('shared.flag.break'), 'known-breaks')] : []));
    F.flow.setTable(S.dataTable(t('p2.chart.flow'), [t('shared.period'), t('p2.chart.flow.change'), t('p2.chart.flow.net')],
      range.map(function (r) { return [K.periodText(r) + (marks && breaks[r.period] ? ' !' : ''), C.signedInt(r.headcount_change), C.signedInt(r.net_flow)]; })));

    writeState();
    return renderChildren();
  }

  /* 7.1.4 employees by department (government) or by subelement (a department or Defense agency) */
  function childSource() {
    var e = meta.entities[state.entity];
    if (state.entity === 'GOV') return { parent: 'GOV', level: 'department', title: 'p2.chart.byDept' };
    if (!e || e.level === 'subelement') return null;
    if (e.level === 'agency') return { parent: e.parent, level: 'subelement', within: state.entity, title: 'p2.chart.bySub' };
    return { parent: state.entity, level: 'subelement', title: 'p2.chart.bySub' };
  }
  function renderChildren() {
    var src = childSource();
    F.kids.el.hidden = !src;
    if (!src) { F.kids.clearChart(); document.body.setAttribute('data-ready', 'true'); return Promise.resolve(); }
    var p = compareCache[src.parent] ? Promise.resolve(compareCache[src.parent]) : S.getJson('data/compare/' + src.parent + '.json').then(function (f) { compareCache[src.parent] = SM.objects(f); return compareCache[src.parent]; });
    return p.then(function (cr) {
      var list = cr.filter(function (r) { return r.grain === 't12' && r.child_level === src.level && (!src.within || (meta.entities[r.child] && meta.entities[r.child].parent === src.within)); })
        .sort(function (a, b) { return b.headcount - a.headcount || names[a.child].localeCompare(names[b.child]); });
      var shown = state.all ? list : list.slice(0, 25);
      F.kids.setTitle(t(src.title));
      F.kids.setSub(list.length ? t('p2.tile.asof', { month: C.monthLabel(list[0].period_last_month) }) : '');
      F.kids.draw({ type: 'bar', data: { labels: shown.map(function (r) { return names[r.child] || r.child; }), datasets: [{ label: t('p2.tile.headcount'), data: shown.map(function (r) { return r.headcount; }), backgroundColor: CH.PALETTE.hires }] },
        options: Object.assign(K.baseOptions({ legend: false }), { indexAxis: 'y', scales: { x: { grid: { color: '#262c34' }, ticks: { color: '#9da7b3', callback: function (v) { return C.int(v); } } }, y: { grid: { display: false }, ticks: { color: '#c9d1d9', autoSkip: false, font: { size: 11 } } } } }),
        aria: t(src.title) }, Math.max(160, shown.length * 22 + 40));
      F.kids.setNotes([]);
      ctl.more.hidden = list.length <= 25;
      ctl.more.textContent = state.all ? t('shared.showFewer') : t('shared.showAll');
      ctl.more.setAttribute('aria-expanded', state.all ? 'true' : 'false');
      F.kids.setTable(S.dataTable(t(src.title), [t('p4.col.name'), t('p2.tile.headcount')], list.map(function (r) { return [names[r.child] || r.child, C.int(r.headcount)]; })));
      document.body.setAttribute('data-ready', 'true');
    }, function () { F.kids.el.hidden = true; document.body.setAttribute('data-ready', 'true'); });
  }

  function load() {
    document.body.removeAttribute('data-ready');
    return S.getJson('data/' + meta.files[state.entity].path).then(function (f) { rows = SM.objects(f); return render(); }, function () { S.clear(document.getElementById('main')); S.empty(document.getElementById('main')); document.body.setAttribute('data-ready', 'true'); });
  }

  S.init('workforce-size').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/core.meta.json'), K.admins()]).then(function (ms) {
      meta = ms[0]; adminList = ms[1].administrations.list;
      S.setDataMonth(meta.range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p2.title') }), h('p', { text: t('p2.intro') }), controls()]));
      F.tiles = h('div', { class: 'tiles' });
      main.appendChild(F.tiles);
      F.head = K.chartFrame({ id: 'headcount', file: 'workforce-size-headcount' });
      F.flow = K.chartFrame({ id: 'flow', file: 'workforce-size-change' });
      ctl.more = h('button', { type: 'button', class: 'btn', onclick: function () { state.all = !state.all; writeState(); renderChildren(); } });
      F.kids = K.chartFrame({ id: 'children', file: 'workforce-size-by-child', headExtra: ctl.more });
      main.appendChild(F.head.el); main.appendChild(F.flow.el); main.appendChild(F.kids.el);
      root.OPM.page = { frames: F, state: function () { return state; } };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
