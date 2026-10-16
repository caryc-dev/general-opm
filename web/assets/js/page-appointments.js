/* Page 7, Appointments (page-spec 7.6, copy 8.7). The appointments cube of the selected entity: counts of hires and
   departures by appointment group; per month in office = an administration's count over its published months. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, CH = root.OPM.charts, K = root.OPM.common, h = S.h;
  var GROUPS = ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy'];
  var POLITICAL = [['political', 'p7.group.political'], ['schedule_c', 'p7.sub.schedule_c'], ['noncareer_ses', 'p7.sub.noncareer_ses'], ['executive', 'p7.sub.executive']];
  var t, meta, admins, names, rows, periods, state, F = {}, ctl = {}, tilesBox;

  function readState() {
    var p = S.params();
    return { entity: S.resolveEntity(function (e) { return !!meta.files[e]; }), view: ['fy', 't12', 'admin'].indexOf(p.get('view')) >= 0 ? p.get('view') : 't12',
      period: p.get('period') || null, pol: POLITICAL.some(function (x) { return x[0] === p.get('group'); }) ? p.get('group') : 'political' };
  }
  function list() { return periods.filter(function (p) { return p.grain === state.view; }); }
  function writeState() {
    var l = list();
    S.setParams({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 't12' ? null : state.view,
      period: l.length && state.period === l[l.length - 1].period ? null : state.period, group: state.pol === 'political' ? null : state.pol });
  }
  function adminName(id) { var a = admins.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function periodText(p) {
    if (p.grain === 'fy') { var x = t('shared.period.fy', { yyyy: p.period.slice(2) }); return p.partial ? t('shared.period.partial', { period: x }) : x; }
    if (p.grain === 't12') return t('shared.period.t12', { month: C.monthLabel(p.period) });
    return adminName(p.period);
  }
  function row(grain, period, group) { return rows.filter(function (r) { return r.grain === grain && r.period === period && r.appt_group === group; })[0] || null; }
  function emptyMark() { return t('shared.mark.empty'); }

  function controls() {
    ctl.entity = S.selectField({ label: t('p1.control.entity'), cls: 'field--entity', options: S.entityChoices(meta.entities, names, ['department', 'agency'], t('p1.control.entity.all')),
      value: state.entity, onChange: function (v) { state.entity = v; load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: [['fy', 'shared.view.fy'], ['t12', 'shared.view.t12'], ['admin', 'shared.view.admin']].map(function (v) { return { value: v[0], text: t(v[1]) }; }),
      value: state.view, note: t('shared.view.note'), onChange: function (v) { state.view = v; state.period = null; render(); } });
    ctl.period = S.selectField({ label: t('shared.period'), options: [], onChange: function (v) { state.period = v; render(); } });
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.view.el, ctl.period.el]);
  }

  function render() {
    var l = list();
    if (!state.period || !l.some(function (p) { return p.period === state.period; })) state.period = l.length ? l[l.length - 1].period : null;
    ctl.entity.set(state.entity); ctl.view.set(state.view);
    ctl.period.fill(l.slice().reverse().map(function (p) { return { value: p.period, text: periodText(p) }; }), state.period);
    var p = l.filter(function (x) { return x.period === state.period; })[0];

    // 7.6.1 tiles: political appointees in the Trump II window
    var tw = row('admin', 'trump2', 'political');
    S.clear(tilesBox);
    tilesBox.appendChild(K.tile(t('p7.tile.hires'), tw ? C.int(tw.hires) : null));
    tilesBox.appendChild(K.tile(t('p7.tile.departures'), tw ? C.int(tw.departures) : null));

    // 7.6.2 hires and departures by group, for the chosen period
    var g = GROUPS.map(function (id) { return { id: id, label: t('p7.group.' + id), r: p ? row(state.view, p.period, id) : null }; });
    var unk = p ? row(state.view, p.period, 'unknown') : null;
    F.groups.setTitle(t('p7.chart.groups'));
    F.groups.setSub(names[state.entity] + '. ' + (p ? periodText(p) : ''));
    F.groups.draw({ type: 'bar', data: { labels: g.map(function (x) { return x.label; }), datasets: [
      { label: t('p3.chart.flows.hires'), data: g.map(function (x) { return x.r ? x.r.hires : null; }), backgroundColor: CH.PALETTE.hires },
      { label: t('p3.chart.flows.departures'), data: g.map(function (x) { return x.r ? x.r.departures : null; }), backgroundColor: CH.PALETTE.departures }] },
      options: Object.assign(K.baseOptions({}), { indexAxis: 'y', scales: { x: { grid: { color: '#262c34' }, ticks: { color: '#9da7b3', precision: 0, callback: function (v) { return C.int(v); } } }, y: { grid: { display: false }, ticks: { color: '#c9d1d9', autoSkip: false } } } }),
      aria: t('p7.chart.groups') }, 360);
    var unknownCount = unk ? (unk.hires || 0) + (unk.departures || 0) : 0;
    var notes = [unknownCount ? t('p7.note.unknown', { count: C.int(unknownCount) }) : null, t('p7.note.conversions'), t('p7.note.schedulePolicy'), t('p7.note.executive'), t('p7.note.noHeadcount')];
    if (p) notes = notes.concat(S.flagNotes({ provisional: p.provisional, partial: p.partial && p.grain === 'fy' ? p : null, partialLabel: p.period, ytd: true, incomplete: p.opm_incomplete, kdi: p.kdi_ids }));
    F.groups.setNotes(notes);
    F.groups.setTable(S.dataTable(t('p7.chart.groups'), ['', t('p3.chart.flows.hires'), t('p3.chart.flows.departures')], g.map(function (x) { return [x.label, x.r ? C.int(x.r.hires) : emptyMark(), x.r ? C.int(x.r.departures) : emptyMark()]; })));

    // 7.6.3 political appointees per month in office, by administration
    var ad = periods.filter(function (q) { return q.grain === 'admin'; });
    var per = ad.map(function (q) { var r = row('admin', q.period, state.pol); return { q: q, h: r ? C.ratio(r.hires, q.months_in_period) : null, d: r ? C.ratio(r.departures, q.months_in_period) : null }; });
    ctl.pol.set(state.pol);
    F.pol.setTitle(t('p7.chart.political'));
    F.pol.setSub(t(POLITICAL.filter(function (x) { return x[0] === state.pol; })[0][1]) + '. ' + t('p7.chart.political.note'));
    F.pol.draw({ type: 'bar', data: { labels: per.map(function (x) { return adminName(x.q.period); }), datasets: [
      { label: t('p3.chart.flows.hires'), data: per.map(function (x) { return x.h; }), backgroundColor: CH.PALETTE.hires },
      { label: t('p3.chart.flows.departures'), data: per.map(function (x) { return x.d; }), backgroundColor: CH.PALETTE.departures }] },
      options: (function () { var o = K.baseOptions({}); o.scales.y.ticks.precision = undefined; o.scales.y.ticks.callback = function (v) { return (Math.round(v * 10) / 10).toLocaleString('en-US'); };
        o.plugins.tooltip.callbacks.label = function (ctx) { return ctx.dataset.label + ': ' + (ctx.raw === null ? emptyMark() : ctx.raw.toFixed(1)); }; return o; })(),
      aria: t('p7.chart.political') }, 300);
    var pfl = { provisional: ad.some(function (q) { return q.provisional; }), incomplete: ad.some(function (q) { return q.opm_incomplete; }), kdi: [] };
    F.pol.setNotes([t('p7.note.executive')].concat(S.flagNotes(pfl)));
    F.pol.setTable(S.dataTable(t('p7.chart.political'), [t('p1.control.admins'), t('p3.chart.flows.hires'), t('p3.chart.flows.departures')],
      per.map(function (x) { return [adminName(x.q.period), x.h === null ? emptyMark() : x.h.toFixed(1), x.d === null ? emptyMark() : x.d.toFixed(1)]; })));

    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  function objects(cols, rs) { return rs.map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }); }
  function load() {
    document.body.removeAttribute('data-ready');
    return S.getJson('data/appointments/' + state.entity + '.json').then(function (f) {
      rows = objects(f.columns, f.rows);
      periods = objects(f.period_columns, f.periods).sort(function (a, b) { return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : 0; });
      render();
    }, function () { var m = document.getElementById('main'); S.clear(m); S.empty(m); document.body.setAttribute('data-ready', 'true'); });
  }

  S.init('appointments').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/appointments.meta.json'), S.getJson('data/admin.meta.json')]).then(function (ms) {
      meta = { files: ms[0].files, entities: ms[1].entities };
      admins = (ms[0].administrations || ms[1].administrations).list;
      S.setDataMonth(ms[0].range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p7.title') }), h('p', { text: t('p7.intro') }), controls()]));
      tilesBox = h('div', { class: 'tiles' }); main.appendChild(tilesBox);
      ctl.pol = S.segmented({ label: t('p7.group.political'), options: POLITICAL.map(function (x) { return { value: x[0], text: t(x[1]) }; }), value: state.pol, onChange: function (v) { state.pol = v; render(); } });
      F.groups = K.chartFrame({ id: 'groups', file: 'appointments-groups' });
      F.pol = K.chartFrame({ id: 'political', file: 'appointments-political', headExtra: ctl.pol.el });
      main.appendChild(F.groups.el); main.appendChild(F.pol.el);
      root.OPM.page = { frames: F, state: function () { return state; } };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
