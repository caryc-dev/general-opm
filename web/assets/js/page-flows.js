/* Page 3, Hiring and departures (page-spec 7.2, copy 8.2). Core cube of the selected entity; under the occupation
   filter (occupation-spec 5.2), rows built from the monthly occupation cubes by OPM.occFilter. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, SM = root.OPM.seriesModel, CH = root.OPM.charts, K = root.OPM.common, OF = root.OPM.occFilter, h = S.h;
  var t, meta, adminList, names, coreRows, rows, state, F = {}, ctl = {}, seq = 0;
  var VIEWS = [['fy', 'shared.view.fy'], ['fq', 'shared.view.fq'], ['month', 'shared.view.month']];

  function readState() {
    var p = S.params();
    return { entity: S.resolveEntity(function (e) { return !!meta.files[e]; }), view: ['fy', 'fq', 'month'].indexOf(p.get('view')) >= 0 ? p.get('view') : 'fy',
      range: p.get('range') && adminList.some(function (a) { return a.id === p.get('range'); }) ? p.get('range') : 'full',
      method: ['a', 'b', 'c'].indexOf(p.get('rate')) >= 0 ? p.get('rate') : 'a' };
  }
  function writeState() { S.setParams(Object.assign({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 'fy' ? null : state.view, range: state.range === 'full' ? null : state.range, rate: state.method === 'a' ? null : state.method }, OF.params())); }

  function controls() {
    ctl.entity = S.selectField({ label: t('p1.control.entity'), cls: 'field--entity', options: S.entityChoices(meta.entities, names, ['department', 'agency', 'subelement'], t('p1.control.entity.all')),
      value: state.entity, onChange: function (v) { state.entity = v; OF.setEntity(v); load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: VIEWS.map(function (v) { return { value: v[0], text: t(v[1]) }; }), value: state.view, note: t('shared.view.note'),
      onChange: function (v) { state.view = v; render(); } });
    ctl.range = S.selectField({ label: t('shared.range'), options: [{ value: 'full', text: t('shared.range.full') }].concat(adminList.map(function (a) { return { value: a.id, text: a.name }; })),
      value: state.range, onChange: function (v) { state.range = v; render(); } });
    ctl.occ = OF.control();
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.occ, ctl.view.el, ctl.range.el]);
  }

  function table(title, head, range, cells) { return S.dataTable(title, [t('shared.period')].concat(head), range.map(function (r) { return [K.periodText(r)].concat(cells(r)); })); }

  /* the rows on view: core's, or the chosen occupation's (fetched for the months the view needs) */
  function render() {
    var token = ++seq, preset = SM.presets(adminList).filter(function (p) { return p.id === state.range; })[0];
    document.body.removeAttribute('data-ready');
    return OF.rows(coreRows, state.entity, SM.inRange(SM.byGrain(coreRows, SM.GRAINS[state.view]), preset)).then(function (rs) { if (token === seq) { rows = rs; draw(); } }, failed);
  }
  function failed(e) { console.warn(String(e)); var m = document.getElementById('main'); S.clear(m); S.empty(m); document.body.setAttribute('data-ready', 'true'); }

  function draw() {
    var occ = OF.current();
    var view = SM.byGrain(rows, SM.GRAINS[state.view]), months = SM.byGrain(rows, 'month');
    var preset = SM.presets(adminList).filter(function (p) { return p.id === state.range; })[0];
    var range = SM.inRange(view, preset), fl = SM.flags(range);
    var notes = S.flagNotes({ provisional: fl.provisional, partial: fl.partial, partialLabel: fl.partial ? fl.partial.period : '', ytd: fl.partial && fl.partial.grain === 'fy', incomplete: fl.incomplete, kdi: fl.kdi });
    var labels = range.map(SM.label), prov = range.map(function (r) { return !!r.provisional; }), bands = CH.adminBands(range, adminList);

    // 7.2.1 tiles
    var tl = SM.flowTiles(months);
    S.clear(F.tiles);
    F.tiles.appendChild(K.tile(t('p3.tile.hires'), C.int(tl.hires), [tl.hiresPrior === null ? null : t('shared.prior', { value: C.int(tl.hiresPrior) })]));
    F.tiles.appendChild(K.tile(t('p3.tile.departures'), C.int(tl.departures), [tl.departuresPrior === null ? null : t('shared.prior', { value: C.int(tl.departuresPrior) })]));
    F.tiles.appendChild(K.tile(t('p3.tile.rate'), C.pct(tl.rate), [tl.ratePrior === null ? null : t('shared.prior', { value: C.pct(tl.ratePrior) }), tl.rateSmall ? t('shared.flag.small') : null]));

    // 7.2.2 hires and departures
    F.flows.setTitle(t('p3.chart.flows')); F.flows.setSub(names[state.entity]);
    F.flows.draw({ type: 'bar', data: { labels: labels, datasets: [
      { label: t('p3.chart.flows.hires'), data: range.map(function (r) { return r.hires; }), backgroundColor: CH.PALETTE.hires, _provisional: prov },
      { label: t('p3.chart.flows.departures'), data: range.map(function (r) { return r.departures; }), backgroundColor: CH.PALETTE.departures, _provisional: prov }] },
      options: K.baseOptions({ bands: bands }), aria: t('p3.chart.flows') }, 300);
    var nrNotes = notes.concat(occ && occ.code === 'NR' ? [S.readingLink(t('p10.note.notReported'), 'kdi-011')] : []);
    F.flows.setNotes(nrNotes);
    F.flows.setTable(table(t('p3.chart.flows'), [t('p3.chart.flows.hires'), t('p3.chart.flows.departures')], range, function (r) { return [C.int(r.hires), C.int(r.departures)]; }));

    // 7.2.3 why people left: the seven reasons, stacked (not available for one occupation)
    F.reasons.setTitle(t('p3.chart.reasons')); F.reasons.setSub(occ ? '' : t('p3.chart.reasons.note'));
    if (occ) OF.unavailable(F.reasons, 'hiring-and-departures-reasons'); else {
      F.reasons.draw({ type: 'bar', data: { labels: labels, datasets: SM.REASONS.map(function (rs, i) {
        return { label: t('p1.reason.' + rs.id), data: range.map(function (r) { return r[rs.col]; }), backgroundColor: CH.PALETTE.seven[i], _provisional: prov };
      }) }, options: K.baseOptions({ bands: bands, stacked: true }), aria: t('p3.chart.reasons') }, 340);
      F.reasons.setNotes(notes);
      F.reasons.setTable(table(t('p3.chart.reasons'), SM.REASONS.map(function (rs) { return t('p1.reason.' + rs.id); }).concat([t('p3.chart.flows.departures')]), range,
        function (r) { return SM.REASONS.map(function (rs) { return C.int(r[rs.col]); }).concat([C.int(r.departures)]); }));
    }

    // 7.2.4 rates over time, by method
    renderRates(range, labels, prov, bands, nrNotes);

    // 7.2.5 hires by type and 7.2.6 transfers (not available for one occupation)
    F.types.setTitle(t('p3.chart.types')); F.types.setSub('');
    F.transfers.setTitle(t('p3.chart.transfers'));
    if (occ) { F.transfers.setSub(''); OF.unavailable(F.types, 'hiring-and-departures-types'); OF.unavailable(F.transfers, 'hiring-and-departures-transfers'); writeState(); document.body.setAttribute('data-ready', 'true'); return; }
    F.types.draw({ type: 'bar', data: { labels: labels, datasets: [
      { label: t('p3.chart.types.new'), data: range.map(function (r) { return r.acc_new_hire; }), backgroundColor: CH.PALETTE.two[0], _provisional: prov },
      { label: t('p3.chart.types.transfer'), data: range.map(function (r) { return r.acc_transfer_in; }), backgroundColor: CH.PALETTE.two[1], _provisional: prov }] },
      options: K.baseOptions({ bands: bands, stacked: true }), aria: t('p3.chart.types') }, 300);
    F.types.setNotes(notes);
    F.types.setTable(table(t('p3.chart.types'), [t('p3.chart.types.new'), t('p3.chart.types.transfer')], range, function (r) { return [C.int(r.acc_new_hire), C.int(r.acc_transfer_in)]; }));

    // 7.2.6 transfers between agencies, never netted; departures from federal service = the five non-transfer categories
    F.transfers.setSub(t('p3.chart.transfers.note'));
    F.transfers.draw({ type: 'bar', data: { labels: labels, datasets: [
      { label: t('p3.chart.transfers.in'), data: range.map(function (r) { return r.acc_transfer_in; }), backgroundColor: CH.PALETTE.three[0], _provisional: prov },
      { label: t('p3.chart.transfers.out'), data: range.map(function (r) { return r.sep_transfer_out; }), backgroundColor: CH.PALETTE.three[1], _provisional: prov },
      { label: t('p3.chart.transfers.federal'), data: range.map(SM.federal), backgroundColor: CH.PALETTE.three[2], _provisional: prov }] },
      options: K.baseOptions({ bands: bands }), aria: t('p3.chart.transfers') }, 320);
    F.transfers.setNotes(notes);
    F.transfers.setTable(table(t('p3.chart.transfers'), [t('p3.chart.transfers.in'), t('p3.chart.transfers.out'), t('p3.chart.transfers.federal')], range,
      function (r) { return [C.int(r.acc_transfer_in), C.int(r.sep_transfer_out), C.int(SM.federal(r))]; }));

    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  function renderRates(range, labels, prov, bands, notes) {
    var m = state.method;
    F.rates.setTitle(t('p3.chart.rates'));
    F.rates.setSub([t('p3.chart.rates.note'), ' ', t('shared.rate.help.' + m)]);
    ctl.rate.set(m);
    if (m === 'b' && state.view !== 'fy') {
      F.rates.clearChart();
      F.rates.setBody(h('p', { class: 'status', role: 'status', text: t('shared.rate.none') }));
      F.rates.setNotes([]);
      F.rates.setTable(h('p', { class: 'status', text: t('shared.rate.none') }));
      F.rates.onSvg(function () { return { filename: 'hiring-and-departures-rates.svg', svg: root.OPM.svg.document(640, 20, { title: t('p3.chart.rates'), notes: [t('shared.rate.none')] }, function () { return ''; }) }; });
      return;
    }
    var dep = range.map(function (r) { return SM.rate(r, 'dep', m); }), hire = range.map(function (r) { return SM.rate(r, 'hire', m); });
    var anySmall = range.some(function (r) { return SM.small(r, m); });
    var ds = function (label, data, color) { return { label: label, data: data, borderColor: color, backgroundColor: color, pointRadius: range.length > 40 ? 0 : 2, borderWidth: 2, spanGaps: false, segment: CH.dashProvisional(prov), _provisional: prov }; };
    F.rates.draw({ type: 'line', data: { labels: labels, datasets: [ds(t('p3.chart.rates.dep'), dep, CH.PALETTE.departures), ds(t('p3.chart.rates.hire'), hire, CH.PALETTE.hires)] },
      options: K.baseOptions({ bands: bands, pct: true }), aria: t('p3.chart.rates') }, 300);
    F.rates.setNotes(notes.concat(anySmall ? ['* ' + t('shared.flag.small')] : []));
    F.rates.setTable(table(t('p3.chart.rates'), [t('p3.chart.rates.dep'), t('p3.chart.rates.hire')], range, function (r, i) {
      var sm = SM.small(r, m) ? ' *' : '';
      return [C.pct(SM.rate(r, 'dep', m)) || t('shared.mark.empty'), C.pct(SM.rate(r, 'hire', m)) || t('shared.mark.empty')].map(function (v) { return v === t('shared.mark.empty') ? v : v + sm; });
    }));
  }

  function load() {
    document.body.removeAttribute('data-ready');
    return S.getJson('data/' + meta.files[state.entity].path).then(function (f) { coreRows = SM.objects(f); return render(); }, failed);
  }

  S.init('hiring-and-departures').then(function (cp) {
    t = cp.t;
    return Promise.all([S.getJson('data/core.meta.json'), K.admins(), OF.init(cp, function () { writeState(); render(); })]).then(function (ms) {
      meta = ms[0]; adminList = ms[1].administrations.list;
      S.setDataMonth(meta.range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      OF.read(state.entity);
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p3.title') }), OF.banner(), h('p', { text: t('p3.intro') }), controls()]));
      OF.setEntity(state.entity);
      F.tiles = h('div', { class: 'tiles' }); main.appendChild(F.tiles);
      ctl.rate = S.segmented({ label: t('shared.rate'), options: ['a', 'b', 'c'].map(function (m) { return { value: m, text: t('shared.rate.' + m) }; }), value: state.method,
        onChange: function (v) { state.method = v; render(); } });
      F.flows = K.chartFrame({ id: 'flows', file: 'hiring-and-departures-flows' });
      F.reasons = K.chartFrame({ id: 'reasons', file: 'hiring-and-departures-reasons' });
      F.rates = K.chartFrame({ id: 'rates', file: 'hiring-and-departures-rates', headExtra: ctl.rate.el });
      F.types = K.chartFrame({ id: 'types', file: 'hiring-and-departures-types' });
      F.transfers = K.chartFrame({ id: 'transfers', file: 'hiring-and-departures-transfers' });
      ['flows', 'reasons', 'rates', 'types', 'transfers'].forEach(function (k) { main.appendChild(F[k].el); });
      root.OPM.page = { frames: F, state: function () { return state; } };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
