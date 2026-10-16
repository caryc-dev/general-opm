/* Page 10, Occupations (page-spec 7.10, occupation-spec 5.1, copy 8.10). The occupations cube of the selected entity:
   tiles, the most hired and most departed occupations, and a table of every occupation, at job series or
   occupational family level. Every figure is a cube value, a sum of one column over rows, or a ratio of two sums. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, O = root.OPM.occModel, K = root.OPM.common, SVG = root.OPM.svg, h = S.h;
  var COLOR = { hires: '#4dabf7', departures: '#ff8c2e' };
  /* table columns: key, copy key, kind */
  var COLS = [['name', 'p10.col.occupation', 'text'], ['headcount', 'p10.col.employees', 'int'], ['hires', 'p10.col.hires', 'int'], ['departures', 'p10.col.departures', 'int'],
    ['net', 'p10.col.net', 'signed'], ['transferIn', 'p10.col.transferIn', 'int'], ['transferOut', 'p10.col.transferOut', 'int'], ['drp', 'p10.col.drp', 'int'],
    ['hireRate', 'p10.col.hireRate', 'rate'], ['depRate', 'p10.col.departureRate', 'rate']];
  var t, meta, maps, names, idx, state, F = {}, ctl = {}, tilesBox, cur = null;

  function defaultLevel(e) { return e === 'GOV' ? 'series' : 'family'; }
  function readState() {
    var p = S.params(), e = S.resolveEntity(function (x) { return !!meta.files[x]; });
    return { entity: e, view: ['fy', 't12', 'admin'].indexOf(p.get('view')) >= 0 ? p.get('view') : 't12', period: p.get('period') || null, firstN: p.get('term') !== 'whole',
      level: ['series', 'family'].indexOf(p.get('level')) >= 0 ? p.get('level') : defaultLevel(e),
      hiresBy: 'count', departuresBy: 'count', hiresAll: false, departuresAll: false, tsort: null };
  }
  function grain() { return state.view === 'admin' ? (state.firstN ? 'admin_n' : 'admin') : state.view; }
  function writeState() {
    var list = O.periodsOf(idx, grain()), latest = list.length ? list[list.length - 1].period : null;
    S.setParams({ entity: state.entity === 'GOV' ? null : state.entity, view: state.view === 't12' ? null : state.view, period: state.period === latest ? null : state.period,
      term: state.view === 'admin' && !state.firstN ? 'whole' : null, level: state.level === defaultLevel(state.entity) ? null : state.level });
  }
  function adminName(id) { var a = meta.administrations.list.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function periodText(p) {
    if (p.grain === 'fy') { var x = t('shared.period.fy', { yyyy: p.period.slice(2) }); return p.partial ? t('shared.period.partial', { period: x }) : x; }
    if (p.grain === 't12') return t('shared.period.t12', { month: C.monthLabel(p.period) });
    return adminName(p.period);
  }
  function empty() { return t('shared.mark.empty'); }
  function occLabel(code) { return O.occName(maps, state.level, code, t('p10.notReported')); }

  /* where a row leads (occupation-spec 5.1): a family to page 3 filtered to it for the same entity; a series at
     government level to page 3 filtered to it; a series below government to the Look-Up filtered to it and the entity */
  function linkFor(x, kind) {
    var ent = state.entity === 'GOV' ? '' : 'entity=' + encodeURIComponent(state.entity) + '&';
    if (state.level === 'family') return 'hiring-and-departures.html?' + ent + 'family=' + encodeURIComponent(x.code);
    if (state.entity === 'GOV') return 'hiring-and-departures.html?series=' + encodeURIComponent(x.code);
    if (x.nr) return null; // OPM left the series blank or invalid: there is no single value to filter on
    var lm = cur.period_last_month, fy = cur.fiscal_year || (+lm.slice(0, 4) + (+lm.slice(5) >= 10 ? 1 : 0)); // the fiscal year of the window's last month
    var ds = kind === 'hires' ? 'accessions' : 'separations';
    return 'look-up.html?' + ent + 'records=' + ds + '&file=' + ds + '_FY' + fy + '&occ=' + encodeURIComponent(x.code);
  }
  function nameCell(x, kind) {
    var href = linkFor(x, kind);
    return href ? h('a', { href: href, text: x.name, title: x.name }) : h('span', { text: x.name, title: x.name });
  }

  function controls() {
    ctl.entity = S.selectField({ label: t('p1.control.entity'), cls: 'field--entity', options: S.entityChoices(meta.entities, names, ['department', 'agency', 'subelement'], t('p1.control.entity.all')),
      value: state.entity, onChange: function (v) { state.entity = v; state.level = defaultLevel(v); state.tsort = null; load(); } });
    ctl.view = S.segmented({ label: t('shared.view'), options: [['fy', 'shared.view.fy'], ['t12', 'shared.view.t12'], ['admin', 'shared.view.admin']].map(function (v) { return { value: v[0], text: t(v[1]) }; }),
      value: state.view, note: t('shared.view.note'), onChange: function (v) { state.view = v; state.period = null; render(); } });
    ctl.period = S.selectField({ label: t('shared.period'), options: [], onChange: function (v) { state.period = v; render(); } });
    ctl.term = S.segmented({ label: t('shared.view.admin'), options: [{ value: 'n', text: t('shared.admin.firstN', { n: meta.admin_n_months }) }, { value: 'whole', text: t('shared.admin.whole') }],
      value: state.firstN ? 'n' : 'whole', onChange: function (v) { state.firstN = v === 'n'; render(); } });
    ctl.level = S.segmented({ label: t('p10.level.label'), options: [{ value: 'series', text: t('p10.level.series') }, { value: 'family', text: t('p10.level.family') }],
      value: state.level, onChange: function (v) { state.level = v; state.tsort = null; render(); } });
    return h('div', { class: 'controls' }, [ctl.entity.el, ctl.view.el, ctl.period.el, ctl.term.el, ctl.level.el]);
  }
  function syncControls(list) {
    ctl.entity.set(state.entity); ctl.view.set(state.view); ctl.term.set(state.firstN ? 'n' : 'whole'); ctl.level.set(state.level);
    ctl.term.el.hidden = state.view !== 'admin';
    ctl.period.fill(list.slice().reverse().map(function (p) { return { value: p.period, text: periodText(p) }; }), state.period);
  }

  function flagNotes(p) {
    return S.flagNotes({ provisional: p.provisional, partial: p.partial && p.grain === 'fy' ? { period_last_month: p.period_last_month } : null, partialLabel: p.period, ytd: true,
      incomplete: p.opm_incomplete, kdi: p.kdi_ids });
  }
  function nrNote() { return S.readingLink(t('p10.note.notReported'), 'kdi-011'); }

  /* ---- 10.2 and 10.3: the most hired and most departed occupations */
  function renderList(f, kind, items, p) {
    var hires = kind === 'hires', by = state[kind + 'By'], all = state[kind + 'All'];
    var cnt = hires ? 'hires' : 'departures', rt = hires ? 'hireRate' : 'depRate', sh = hires ? 'hireShare' : 'depShare';
    var ranked = O.ranked(items, kind, by), shown = all ? ranked : ranked.slice(0, 25);
    var metric = function (x) { return by === 'rate' ? x[rt] : x[cnt]; };
    var max = Math.max.apply(null, shown.map(function (x) { return metric(x) || 0; }).concat([0]));
    var barText = function (x) { return t(hires ? 'p10.bar.hired' : 'p10.bar.departed', { count: C.int(x[cnt]), share: C.pct(x[sh]) || empty() }); };
    var rateText = function (x) { return x[rt] === null ? empty() : C.pct(x[rt]) + (x.small ? ' *' : ''); };
    var details = function (x) {
      var parts = hires ? [[t('p10.col.transferIn'), C.int(x.transferIn)]] : [[t('p10.col.transferOut'), C.int(x.transferOut)], [t('p10.col.drp'), C.int(x.drp)]];
      return parts.concat([[t(hires ? 'p10.col.hireRate' : 'p10.col.departureRate'), rateText(x)]]).map(function (d) { return d[0] + ' ' + d[1]; }).join(' · ');
    };
    f.setTitle(t(hires ? 'p10.hired.title' : 'p10.departed.title'));
    f.setSub(names[state.entity] + '. ' + periodText(p));
    ctl[kind + 'Sort'].set(by);
    var wrap = h('div', { class: 'occ-bars', 'data-kind': kind });
    shown.forEach(function (x) {
      var v = metric(x);
      wrap.appendChild(h('div', { class: 'occ-row' + (x.nr ? ' is-nr' : ''), 'data-code': x.code }, [
        h('span', { class: 'occ-row__name' }, nameCell(x, kind)),
        h('span', { class: 'bar-track' }, v === null || !max ? null : h('span', { class: 'bar-fill' + (by === 'rate' && x.small ? ' is-small' : ''), style: '--swatch:' + COLOR[cnt] + ';width:' + (v / max * 100).toFixed(1) + '%' })),
        h('span', { class: 'occ-row__val', text: barText(x) }),
        h('span', { class: 'occ-row__more', text: details(x) })]));
    });
    if (!shown.length) wrap.appendChild(h('p', { class: 'status', text: t('shell.empty') }));
    f.setBody(wrap);
    var more = ctl[kind + 'More'];
    more.hidden = ranked.length <= 25;
    more.textContent = all ? t('shared.showFewer') : t('shared.showAll');
    more.setAttribute('aria-expanded', all ? 'true' : 'false');
    var notes = [ranked.some(function (x) { return x.nr; }) ? nrNote() : null, shown.some(function (x) { return x.small; }) ? '* ' + t('shared.flag.small') : null].concat(flagNotes(p));
    f.setNotes(notes);
    var rateHead = t(hires ? 'p10.col.hireRate' : 'p10.col.departureRate');
    var head = [t('p10.col.occupation'), t(hires ? 'p10.col.hires' : 'p10.col.departures')].concat(hires ? [t('p10.col.transferIn')] : [t('p10.col.transferOut'), t('p10.col.drp')]).concat([rateHead]);
    f.setTable(S.dataTable(f.titleText, head, ranked.map(function (x) {
      return [x.name, barText(x)].concat(hires ? [C.int(x.transferIn)] : [C.int(x.transferOut), C.int(x.drp)]).concat([rateText(x)]);
    })));
    f.onSvg(function () {
      return { filename: 'occupations-' + state.entity + '-' + kind + '.svg', svg: SVG.hbars({ title: f.titleText, subtitle: names[state.entity] + '. ' + periodText(p),
        rows: shown.map(function (x) { var v = metric(x); return { name: x.name, frac: v === null || !max ? null : v / max, text: by === 'rate' ? rateText(x) : C.int(x[cnt]) + ' · ' + (C.pct(x[sh]) || empty()), color: COLOR[cnt], small: by === 'rate' && x.small }; }),
        notes: notes.filter(Boolean).map(function (x) { return typeof x === 'string' ? x : x.textContent; }) }) };
    });
  }

  /* ---- 10.4: every occupation, every column sorts, CSV download */
  function cellText(x, c) {
    var v = c[0] === 'name' ? x.name : x[c[0]];
    if (c[2] === 'text') return v;
    if (v === null || v === undefined) return empty();
    if (c[2] === 'rate') return C.pct(v) + (x.small ? ' *' : '');
    return c[2] === 'signed' ? C.signedInt(v) : C.int(v);
  }
  function sortItems(items) {
    var col = state.tsort ? state.tsort.col : 'headcount', dir = state.tsort ? state.tsort.dir : 'desc';
    return { col: col, dir: dir, rows: items.slice().sort(function (a, b) {
      if (col === 'name') return (dir === 'asc' ? 1 : -1) * (a.nr - b.nr || a.code.localeCompare(b.code));
      var x = a[col], y = b[col];
      if (x === null || x === undefined) return y === null || y === undefined ? a.code.localeCompare(b.code) : 1;
      if (y === null || y === undefined) return -1;
      return x === y ? a.code.localeCompare(b.code) : (dir === 'asc' ? 1 : -1) * (x - y);
    }) };
  }
  function renderTable(items, p) {
    var f = F.table, s = sortItems(items);
    f.setTitle(periodText(p));
    f.setSub([names[state.entity] + '. ', t('shared.sort')]);
    var head = h('tr', {}, COLS.map(function (c) {
      var on = s.col === c[0];
      return h('th', { scope: 'col', 'aria-sort': on ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, h('button', { type: 'button', 'data-sort': c[0], onclick: function () {
        state.tsort = { col: c[0], dir: on ? (s.dir === 'asc' ? 'desc' : 'asc') : c[0] === 'name' ? 'asc' : 'desc' }; renderTable(items, p);
        var b = document.querySelector('#occ-table button[data-sort="' + c[0] + '"]'); if (b) b.focus();
      } }, [t(c[1]), ' ', h('span', { class: 'heat__arrow', 'aria-hidden': 'true', text: on ? (s.dir === 'asc' ? '▲' : '▼') : '' })]));
    }));
    var body = s.rows.map(function (x) {
      var href = linkFor(x, 'departures');
      return h('tr', { class: (x.nr ? 'is-nr' : '') + (href ? ' is-link' : ''), 'data-code': x.code, onclick: href ? function (e) { if (e.target.tagName !== 'A') root.location.href = href; } : null },
        COLS.map(function (c, i) { return i === 0 ? h('th', { scope: 'row' }, nameCell(x, 'departures')) : h('td', { text: cellText(x, c) }); }));
    });
    f.setBody(h('div', { class: 'scroll occ-table-box' }, h('table', { class: 'data-table sortable', id: 'occ-table' }, [h('caption', { class: 'visually-hidden', text: periodText(p) }), h('thead', {}, head), h('tbody', {}, body)])));
    var notes = [items.some(function (x) { return x.nr; }) ? nrNote() : null, t('p10.note.moves'),
      state.level === 'series' && state.entity !== 'GOV' ? h('span', {}, S.linked(t('p10.note.seriesBelowGov'), S.pageLabel('look-up'), S.pageHref('look-up.html'))) : null,
      items.some(function (x) { return x.small; }) ? '* ' + t('shared.flag.small') : null].concat(flagNotes(p));
    f.setNotes(notes);
    f.setTable(S.dataTable(periodText(p), COLS.map(function (c) { return t(c[1]); }), s.rows.map(function (x) { return COLS.map(function (c) { return cellText(x, c); }); })));
    f.onSvg(function () {
      return { filename: 'occupations-' + state.entity + '-table.svg', svg: SVG.heatmap({ title: periodText(p), subtitle: names[state.entity], firstHead: t('p10.col.occupation'), sizeHead: t('p10.col.employees'),
        headers: COLS.slice(2).map(function (c) { return { text: t(c[1]), color: '#9da7b3' }; }),
        rows: s.rows.map(function (x) { return { name: x.name, size: cellText(x, COLS[1]), cells: COLS.slice(2).map(function (c) { return { text: cellText(x, c), bg: '#161b22', fg: '#e6edf3' }; }) }; }),
        notes: notes.filter(Boolean).map(function (x) { return typeof x === 'string' ? x : x.textContent; }) }) };
    });
    F.tableRows = s.rows;
  }
  /* the table as CSV: the column headings, then each occupation; counts as integers, rates as fractions */
  function csv() {
    var q = function (v) { if (v === null || v === undefined) return ''; var x = String(v); return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lines = [COLS.map(function (c) { return q(t(c[1])); }).join(',')];
    (F.tableRows || []).forEach(function (x) {
      lines.push(COLS.map(function (c) { var v = c[0] === 'name' ? x.name : x[c[0]]; return q(c[2] === 'rate' && v !== null ? +v.toFixed(6) : v); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function download() {
    var blob = new Blob([csv()], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'occupations-' + state.entity + '-' + cur.period + '-' + state.level + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function render() {
    var list = O.periodsOf(idx, grain());
    if (!list.length) { S.clear(tilesBox); document.body.setAttribute('data-ready', 'true'); return; }
    if (!state.period || !list.some(function (p) { return p.period === state.period; })) state.period = list[list.length - 1].period;
    syncControls(list);
    var p = cur = list.filter(function (x) { return x.period === state.period; })[0];
    var items = O.list(idx, grain(), p.period, state.level);
    items.forEach(function (x) { x.name = occLabel(x.code); });
    // 10.1 tiles
    var tot = O.totals(items);
    S.clear(tilesBox);
    tilesBox.appendChild(K.tile(t('p10.tile.hires'), C.int(tot.hires), [periodText(p)]));
    tilesBox.appendChild(K.tile(t('p10.tile.departures'), C.int(tot.departures), [periodText(p)]));
    tilesBox.appendChild(K.tile(t('p10.tile.withHires'), C.int(tot.withHires), [t(state.level === 'series' ? 'p10.level.series' : 'p10.level.family')]));
    tilesBox.appendChild(K.tile(t('p10.tile.withDepartures'), C.int(tot.withDepartures), [t(state.level === 'series' ? 'p10.level.series' : 'p10.level.family')]));
    renderList(F.hires, 'hires', items, p);
    renderList(F.departures, 'departures', items, p);
    renderTable(items, p);
    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  function load() {
    document.body.removeAttribute('data-ready');
    return S.getJson('data/' + meta.files[state.entity].path).then(function (f) { idx = O.index(f); render(); },
      function () { var m = document.getElementById('main'); S.clear(m); S.empty(m); document.body.setAttribute('data-ready', 'true'); });
  }

  function listFrame(kind) {
    ctl[kind + 'Sort'] = S.segmented({ label: t('p10.sort.label'), options: [{ value: 'count', text: t('p10.sort.count') }, { value: 'rate', text: t('p10.sort.rate') }], value: 'count',
      onChange: function (v) { state[kind + 'By'] = v; render(); } });
    ctl[kind + 'More'] = h('button', { type: 'button', class: 'btn', onclick: function () { state[kind + 'All'] = !state[kind + 'All']; render(); } });
    return S.frame({ id: 'occ-' + kind, panel: true, headExtra: h('div', { class: 'occ-head' }, [ctl[kind + 'Sort'].el, ctl[kind + 'More']]) });
  }

  S.init('occupations').then(function (cp) {
    t = cp.t;
    return S.getJson('data/occupations.meta.json').then(function (m) {
      meta = m; maps = O.nameMaps(m);
      S.setDataMonth(m.range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p10.title') }), h('p', { text: t('p10.intro') }), controls()]));
      tilesBox = h('div', { class: 'tiles' });
      main.appendChild(tilesBox);
      F.hires = listFrame('hires');
      F.departures = listFrame('departures');
      main.appendChild(h('div', { class: 'panels occ-panels' }, [F.hires.el, F.departures.el]));
      F.table = S.frame({ id: 'occ-all', headExtra: h('button', { type: 'button', class: 'btn', id: 'occ-download', text: t('p8.download'), onclick: download }) });
      main.appendChild(F.table.el);
      // the frames' titles are kept for the SVG export
      [F.hires, F.departures, F.table].forEach(function (f) { var st = f.setTitle; f.setTitle = function (x) { f.titleText = x; st(x); }; });
      root.OPM.page = { frames: { 'occ-hires': F.hires, 'occ-departures': F.departures, 'occ-all': F.table }, state: function () { return state; }, csv: csv };
      return load();
    });
  }).catch(function (e) { console.warn(String(e)); var m = document.getElementById('main'); if (S.copy()) { S.clear(m); S.empty(m); } document.body.setAttribute('data-ready', 'true'); });
})(self);
