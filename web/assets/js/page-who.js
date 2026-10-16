/* Pages 5 and 6, Who is leaving and Who is joining (page-spec 7.4 and 7.5, copy 8.4 to 8.6). The leaving or joining
   cube of the selected entity; for page 5's years of experience lost, its core cube. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, W = root.OPM.whoModel, CH = root.OPM.charts, K = root.OPM.common, SVG = root.OPM.svg, h = S.h;
  var LEAVE = document.body.getAttribute('data-page') === 'who-is-leaving';
  var P = LEAVE ? 'p5' : 'p6', CUBE = LEAVE ? 'leaving' : 'joining', COUNT = LEAVE ? 'departures' : 'hires', PANELS = LEAVE ? W.LEAVING : W.JOINING;
  var GROUP_COLORS = ['#4dabf7', '#ff8c2e', '#56d4c4', '#c297ff', '#f2cc60', '#ff6b9a', '#a5d8ff', '#ffb454', '#8ddb8c', '#e6edf3', '#ff6b6b'];
  var t, meta, adminMeta, names, idx, core, state, F = [], ctl = {}, tilesBox;

  function readState() {
    var p = S.params();
    return { entity: S.resolveEntity(function (e) { return !!meta.files[e]; }), view: ['fy', 't12', 'admin'].indexOf(p.get('view')) >= 0 ? p.get('view') : 't12',
      period: p.get('period') || null, firstN: p.get('term') !== 'whole' };
  }
  function grain() { return state.view === 'admin' ? (state.firstN ? 'admin_n' : 'admin') : state.view; }
  function writeState() {
    var list = W.periodsOf(idx, grain()), latest = list.length ? list[list.length - 1].period : null;
    S.setParams({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 't12' ? null : state.view,
      period: state.period === latest ? null : state.period, term: state.view === 'admin' && !state.firstN ? 'whole' : null });
  }
  function adminName(id) { var a = adminMeta.administrations.list.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function periodText(p) {
    if (p.grain === 'fy') { var x = t('shared.period.fy', { yyyy: p.period.slice(2) }); return p.partial ? t('shared.period.partial', { period: x }) : x; }
    if (p.grain === 't12') return t('shared.period.t12', { month: C.monthLabel(p.period) });
    return adminName(p.period);
  }
  function shortText(p) { return p.grain === 'fy' ? p.period : p.grain === 't12' ? C.monthLabel(p.period) : adminName(p.period); }
  function emptyMark() { return t('shared.mark.empty'); }
  function label(g) { return t(g.label.key, g.label.vars); }

  function controls() {
    ctl.entity = S.selectField({ label: t('p1.control.entity'), cls: 'field--entity', options: S.entityChoices(meta.entities, names, ['department', 'agency'], t('p1.control.entity.all')),
      value: state.entity, onChange: function (v) { state.entity = v; load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: [['fy', 'shared.view.fy'], ['t12', 'shared.view.t12'], ['admin', 'shared.view.admin']].map(function (v) { return { value: v[0], text: t(v[1]) }; }),
      value: state.view, note: t('shared.view.note'), onChange: function (v) { state.view = v; state.period = null; render(); } });
    ctl.period = S.selectField({ label: t('shared.period'), options: [], onChange: function (v) { state.period = v; render(); } });
    ctl.term = S.segmented({ label: t('shared.view.admin'), options: [{ value: 'n', text: t('shared.admin.firstN', { n: adminMeta.n }) }, { value: 'whole', text: t('shared.admin.whole') }],
      value: state.firstN ? 'n' : 'whole', onChange: function (v) { state.firstN = v === 'n'; render(); } });
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.view.el, ctl.period.el, ctl.term.el]);
  }
  function syncControls(list) {
    ctl.entity.set(state.entity); ctl.view.set(state.view); ctl.term.set(state.firstN ? 'n' : 'whole');
    ctl.term.el.hidden = state.view !== 'admin';
    ctl.period.fill(list.slice().reverse().map(function (p) { return { value: p.period, text: periodText(p) }; }), state.period);
  }

  /* ---- tiles (7.4.1, 7.5.1) */
  function renderTiles(p) {
    S.clear(tilesBox);
    var g = grain(), now = W.total(idx, g, p.period, COUNT), prior = W.priorPeriod(g, p.period), before = prior ? W.total(idx, g, prior, COUNT) : null;
    var priorLine = before === null || before === undefined ? null : t('shared.prior', { value: C.int(before) });
    if (LEAVE) {
      tilesBox.appendChild(K.tile(t('p5.tile.departures'), C.int(now), [priorLine]));
      var yl = core ? W.yearsLost(core, g, p) : null;
      var cov = yl && yl.coverage !== null && yl.coverage < 1 ? t('p5.tile.coverage', { pct: C.pct(yl.coverage) }) : null;
      tilesBox.appendChild(K.tile(t('p5.tile.yearsLost'), yl ? C.int(yl.lost) : null, [cov]));
      tilesBox.appendChild(K.tile(t('p5.tile.avgYears'), yl && yl.avg !== null ? yl.avg.toFixed(1) : null, [cov]));
    } else {
      tilesBox.appendChild(K.tile(t('p6.tile.hires'), C.int(now), [priorLine]));
      tilesBox.appendChild(K.tile(t('p6.tile.new'), C.int(W.total(idx, g, p.period, COUNT, 'acc_new_hire')), []));
      tilesBox.appendChild(K.tile(t('p6.tile.transfer'), C.int(W.total(idx, g, p.period, COUNT, 'acc_transfer_in')), []));
    }
  }

  /* ---- one panel: snapshot bars and the trend */
  function renderPanel(pf, panel, p, list) {
    var g = grain(), order = (meta.dims[panel.dim] || {}).values, thr = meta.threshold;
    var now = W.groups(idx, g, p.period, panel.dim, COUNT, order, thr);
    var priorKey = W.priorPeriod(g, p.period), prior = priorKey ? W.groups(idx, g, priorKey, panel.dim, COUNT, order, thr) : null;
    var value = function (x) { return panel.share ? x.share : x.rate; };
    pf.snap.setTitle(t(panel.title));
    pf.snap.setSub(periodText(p));
    if (!now) { pf.snap.setBody(h('p', { class: 'status', text: t('shell.empty') })); pf.snap.setNotes([]); pf.trend.clearChart(); return; }
    var priorBy = {};
    if (prior) prior.groups.forEach(function (x) { priorBy[x.value] = x; });
    var max = 0;
    now.groups.forEach(function (x) { max = Math.max(max, value(x) || 0, priorBy[x.value] ? value(priorBy[x.value]) || 0 : 0); });
    var anySmall = false, wrap = h('div', { class: 'bars who' });
    if (prior) wrap.appendChild(h('div', { class: 'key' }, [h('span', { style: '--swatch:' + (LEAVE ? '#ff8c2e' : '#4dabf7'), text: shortText(p) }), h('span', { style: '--swatch:#6e7681', text: t('p5.bar.prior') })]));
    var tableRows = [], svgRows = [];
    now.groups.forEach(function (x) {
      var v = value(x), pr = priorBy[x.value], pv = pr ? value(pr) : null, small = !panel.share && x.small;
      if (small) anySmall = true;
      var txt = !panel.share && x.na ? t('shared.na') : v === null ? emptyMark() : t(P + '.bar.label', { rate: C.pct(v) + (small ? ' *' : ''), count: C.int(x.count) });
      var color = LEAVE ? '#ff8c2e' : '#4dabf7';
      wrap.appendChild(h('div', { class: 'who-row' }, [h('span', { class: 'who-row__name', text: label(x) }),
        h('span', { class: 'who-row__bars' }, [
          h('span', { class: 'bar-track' }, v === null ? null : h('span', { class: 'bar-fill' + (small ? ' is-small' : ''), style: '--swatch:' + color + ';width:' + (max ? v / max * 100 : 0).toFixed(1) + '%' })),
          prior ? h('span', { class: 'bar-track bar-track--prior' }, pv === null ? null : h('span', { class: 'bar-fill', style: '--swatch:#6e7681;width:' + (max ? pv / max * 100 : 0).toFixed(1) + '%' })) : null]),
        h('span', { class: 'who-row__val', text: txt })]));
      tableRows.push([label(x), C.int(x.count), panel.share ? (C.pct(x.share) || emptyMark()) : x.na ? t('shared.na') : (C.pct(x.rate) || emptyMark()) + (small ? ' *' : '')].concat(prior ? [pv === null ? emptyMark() : C.pct(pv)] : []));
      svgRows.push({ name: label(x), frac: v === null || !max ? null : v / max, text: txt, color: color, small: small });
      if (prior) svgRows.push({ name: t('p5.bar.prior'), frac: pv === null || !max ? null : pv / max, text: pv === null ? emptyMark() : C.pct(pv), color: '#6e7681' });
    });
    pf.snap.setBody(wrap);
    var notes = [panel.share ? t('p6.share.note') : t(P + '.chart.note')];
    if (now.unknown && panel.name) notes.push(t('shared.unknown', { count: C.int(now.unknown), dimension: t(panel.name) }));
    if (anySmall) notes.push('* ' + t('shared.flag.small'));
    var fl = p;
    notes = notes.concat(S.flagNotes({ provisional: fl.provisional, partial: fl.partial && p.grain === 'fy' ? { period_last_month: p.period_last_month } : null, partialLabel: p.period, ytd: true, incomplete: fl.opm_incomplete, kdi: fl.kdi_ids }));
    pf.snap.setNotes(notes);
    var head = [t(panel.title), LEAVE ? t('p5.tile.departures') : t('p6.tile.hires'), panel.share ? t('p6.share.note') : LEAVE ? t('p4.col.dep') : t('p4.col.hire')].concat(prior ? [t('p5.bar.prior')] : []);
    pf.snap.setTable(S.dataTable(t(panel.title), head, tableRows));
    pf.snap.onSvg(function () {
      return { filename: CUBE + '-' + state.entity + '-' + panel.dim + '.svg', svg: SVG.hbars({ title: t(panel.title), subtitle: names[state.entity] + '. ' + periodText(p), rows: svgRows,
        notes: notes.map(function (x) { return typeof x === 'string' ? x : x.textContent; }) }) };
    });

    // trend: every period of the view (one point per administration under By administration)
    pf.trend.setTitle(t(P + '.chart.trend'));
    pf.trend.setSub(t(panel.title));
    var series = {}, labels = list.map(shortText), prov = list.map(function (x) { return !!x.provisional; });
    list.forEach(function (q, i) {
      var gq = W.groups(idx, g, q.period, panel.dim, COUNT, order, thr);
      (gq ? gq.groups : []).forEach(function (x) {
        var s = series[x.value] = series[x.value] || { label: label(x), data: list.map(function () { return null; }) };
        s.data[i] = panel.share ? x.share : x.na ? null : x.rate;
      });
    });
    var keys = now.groups.map(function (x) { return x.value; });
    pf.trend.draw({ type: 'line', data: { labels: labels, datasets: keys.filter(function (k) { return series[k]; }).map(function (k, i) {
      var c = GROUP_COLORS[i % GROUP_COLORS.length];
      return { label: series[k].label, data: series[k].data, borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: list.length > 30 ? 0 : 3, segment: CH.dashProvisional(prov), _provisional: prov };
    }) }, options: K.baseOptions({ pct: true }), aria: t(P + '.chart.trend') + ': ' + t(panel.title) }, 300);
    pf.trend.setNotes([panel.share ? t('p6.share.note') : t(P + '.chart.note')]);
    pf.trend.setTable(S.dataTable(t(P + '.chart.trend'), [t('shared.period')].concat(keys.map(function (k) { return series[k] ? series[k].label : k; })),
      list.map(function (q, i) { return [periodText(q)].concat(keys.map(function (k) { var v = series[k] ? series[k].data[i] : null; return v === null ? emptyMark() : C.pct(v); })); })));
  }

  function render() {
    var list = W.periodsOf(idx, grain());
    if (!list.length) { S.clear(tilesBox); return; }
    if (!state.period || !list.some(function (p) { return p.period === state.period; })) state.period = list[list.length - 1].period;
    syncControls(list);
    var p = list.filter(function (x) { return x.period === state.period; })[0];
    renderTiles(p);
    PANELS.forEach(function (panel, i) { renderPanel(F[i], panel, p, list); });
    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  function load() {
    document.body.removeAttribute('data-ready');
    var need = [S.getJson('data/' + CUBE + '/' + state.entity + '.json')];
    if (LEAVE) need.push(S.getJson('data/core/' + state.entity + '.json'));
    return Promise.all(need).then(function (fs) {
      idx = W.index(fs[0]);
      core = fs[1] ? fs[1].rows.map(function (r) { var o = {}; fs[1].columns.forEach(function (c, i) { o[c] = r[i]; }); return o; }) : null;
      render();
    }, function () { var m = document.getElementById('main'); S.clear(m); S.empty(m); document.body.setAttribute('data-ready', 'true'); });
  }

  S.init(LEAVE ? 'who-is-leaving' : 'who-is-joining').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/' + CUBE + '.meta.json'), S.getJson('data/admin.meta.json')]).then(function (ms) {
      var cm = ms[0];
      meta = { files: cm.files, dims: cm.dimensions, threshold: cm.small_base_threshold, entities: ms[1].entities };
      adminMeta = { administrations: cm.administrations || ms[1].administrations, n: cm.admin_n_months };
      S.setDataMonth(cm.range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t(P + '.title') }), h('p', { text: t(P + '.intro') }), controls()]));
      tilesBox = h('div', { class: 'tiles' });
      main.appendChild(tilesBox);
      PANELS.forEach(function (panel) {
        var pf = { snap: S.frame({ id: 'snap-' + panel.dim, panel: true }), trend: K.chartFrame({ id: 'trend-' + panel.dim, panel: true, file: CUBE + '-trend-' + panel.dim }) };
        F.push(pf);
        main.appendChild(h('div', { class: 'panels' }, [pf.snap.el, pf.trend.el]));
      });
      var frames = {};
      F.forEach(function (pf, i) { frames['snap-' + PANELS[i].dim] = pf.snap; frames['trend-' + PANELS[i].dim] = pf.trend; });
      root.OPM.page = { frames: frames, state: function () { return state; } };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
