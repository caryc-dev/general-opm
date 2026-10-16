/* Page 1, Administrations (page-spec sections 5 and 6.2). Browser only; figures come from OPM.adminModel. */
(function (root) {
  'use strict';
  var C = root.OPM.core, M = root.OPM.adminModel, S = root.OPM.shell, SVG = root.OPM.svg, h = S.h;
  var MARK_PROV = '†', MARK_INC = '‡'; // footnote marks on heat map column headings
  var COLORS = { obama2: '#c297ff', trump1: '#f2cc60', biden: '#56d4c4', trump2: '#f0f6fc' };
  var TAB_KEYS = { change: 'p1.heat.tab.change', dep: 'p1.heat.tab.dep', hire: 'p1.heat.tab.hire', drp: 'p1.heat.tab.drp' };
  var copy, t, meta, names, govIdx, mIdx, entIdx = {}, state, frames = {}, controls = {};

  function color(id) { return COLORS[id] || '#e6edf3'; }
  function naText() { return t('p1.heat.na').split(':')[0]; }
  function emptyMark() { return t('shared.mark.empty'); }
  function pctOr(v, signed) { var s = C.pct(v, signed); return s === null ? emptyMark() : s; }

  /* ---- state from and to the URL */
  function readState() {
    var p = S.params(), all = M.administrations(meta).map(function (a) { return a.id; });
    var entity = p.get('entity') || 'GOV';
    if (!meta.files[entity]) entity = 'GOV'; // page 1 has no subelements (page-spec section 3)
    var chosen = (p.get('admins') || '').split(',').filter(function (id) { return all.indexOf(id) >= 0; });
    if (!chosen.length) chosen = all.slice();
    var max = M.maxMonths(meta, chosen), n = parseInt(p.get('n'), 10);
    var metric = M.METRICS.indexOf(p.get('metric')) >= 0 ? p.get('metric') : 'change';
    var sort = null, sp = /^([\w]+)\.(asc|desc)$/.exec(p.get('sort') || '');
    if (sp && (sp[1] === 'name' || sp[1] === 'size' || chosen.indexOf(sp[1]) >= 0)) sort = { col: sp[1], dir: sp[2] };
    return { entity: entity, chosen: chosen, n: n >= 1 && n <= max ? n : max, atMax: !(n >= 1 && n < max), metric: metric, sort: sort, showAll: p.get('all') === '1' };
  }
  function writeState() {
    var all = M.administrations(meta).map(function (a) { return a.id; });
    S.setParams({ entity: state.entity === 'GOV' ? null : state.entity,
      admins: state.chosen.length === all.length ? null : state.chosen.join(','),
      n: state.atMax ? null : String(state.n), metric: state.metric === 'change' ? null : state.metric,
      sort: state.sort ? state.sort.col + '.' + state.sort.dir : null, all: state.showAll ? '1' : null });
  }

  /* ---- controls */
  function entityOptions(sel) {
    var ents = meta.entities, keys = Object.keys(meta.files);
    var depts = keys.filter(function (k) { return ents[k].level === 'department'; }).sort(function (a, b) { return names[a].localeCompare(names[b]); });
    sel.appendChild(h('option', { value: 'GOV', text: t('p1.control.entity.all') }));
    depts.forEach(function (k) {
      sel.appendChild(h('option', { value: k, text: names[k] }));
      keys.filter(function (a) { return ents[a].level === 'agency' && ents[a].parent === k; })
        .sort(function (a, b) { return names[a].localeCompare(names[b]); })
        .forEach(function (a) { sel.appendChild(h('option', { value: a, text: '   ' + names[a] })); });
    });
  }
  function buildControls() {
    var sel = h('select', { id: 'ctl-entity', onchange: function () { state.entity = sel.value; state.sort = null; load(); } });
    entityOptions(sel);
    controls.entity = sel;
    var checks = h('div', { class: 'checks' });
    controls.checks = M.administrations(meta).map(function (a) {
      var box = h('input', { type: 'checkbox', value: a.id, onchange: function () {
        var on = M.administrations(meta).map(function (x) { return x.id; }).filter(function (id) {
          return controls.checks.some(function (c) { return c.value === id && c.checked; });
        });
        if (!on.length) { box.checked = true; return; }
        state.chosen = on;
        if (state.sort && ['name', 'size'].indexOf(state.sort.col) < 0 && on.indexOf(state.sort.col) < 0) state.sort = null;
        var max = M.maxMonths(meta, on);
        if (state.atMax || state.n > max) { state.n = max; state.atMax = true; }
        render();
      } });
      checks.appendChild(h('label', { class: 'check', style: '--swatch:' + color(a.id) }, [box, h('span', { class: 'check__swatch', 'aria-hidden': 'true' }), a.name]));
      return box;
    });
    var months = h('select', { id: 'ctl-months', onchange: function () {
      state.n = +months.value; state.atMax = state.n === M.maxMonths(meta, state.chosen); render();
    } });
    controls.months = months;
    controls.limit = h('p', { class: 'field__note' });
    return h('div', { class: 'controls' }, [
      h('div', { class: 'field field--entity' }, [h('label', { for: 'ctl-entity', text: t('p1.control.entity') }), sel]),
      h('fieldset', { class: 'field' }, [h('legend', { text: t('p1.control.admins') }), checks]),
      h('div', { class: 'field' }, [h('label', { for: 'ctl-months', text: t('p1.control.months') }), months,
        h('p', { class: 'field__note', text: t('p1.control.months.note') }), controls.limit])
    ]);
  }
  function syncControls() {
    controls.entity.value = state.entity;
    controls.checks.forEach(function (c) { c.checked = state.chosen.indexOf(c.value) >= 0; c.disabled = c.checked && state.chosen.length === 1; });
    var max = M.maxMonths(meta, state.chosen);
    S.clear(controls.months);
    for (var k = max; k >= 1; k--) controls.months.appendChild(h('option', { value: String(k), text: t('p1.control.months.value', { n: k }) }));
    controls.months.value = String(state.n);
    var limited = max < M.longestMonths(meta);
    controls.limit.textContent = limited ? t('p1.control.months.limit', { max: max }) : '';
    controls.limit.hidden = !limited;
  }

  /* ---- notes under a section */
  function noteNodes(nt, marks) {
    var out = [];
    nt.provisional.forEach(function (a) { out.push((marks ? MARK_PROV + ' ' : '') + t('p1.note.provisional', { admin: a })); });
    if (nt.incomplete) out.push((marks ? MARK_INC + ' ' : '') + t('p1.note.incomplete'));
    if (nt.kdi.length) {
      var s = t('p1.note.issues', { ids: nt.kdi.join(', ') }), label = S.pageLabel('reading-the-data');
      var parts = S.linked(s, label, S.pageHref('reading-the-data.html'));
      var span = h('span', {}, parts);
      var a = span.querySelector('a'); if (a) a.setAttribute('data-page-link', 'reading-the-data.html');
      out.push(span);
    }
    return out;
  }
  function years(c) { return t('p1.admin.years', { start: C.monthLabel(c.start), end: C.monthLabel(c.end) }); }
  function slug() { return 'administrations-' + state.entity + '-n' + state.n; }

  /* ---- 5.2 scoreboard */
  function renderScore() {
    var f = frames.score, sb = M.scoreboard(entIdx[state.entity], meta, state.chosen, state.n);
    f.setTitle(t('p1.score.title', { n: state.n }));
    var grid = h('div', { class: 'cards' });
    sb.cards.forEach(function (c) {
      var top = h('div', { class: 'card__top' }, [h('span', { class: 'card__name', text: c.name }), c.empty ? null : h('span', { class: 'card__years', text: years(c) })]);
      if (c.empty) { grid.appendChild(h('div', { class: 'card', style: '--swatch:' + color(c.id) }, [top, h('p', { class: 'card__empty', text: t('shell.empty') })])); return; }
      var sub = t('p1.score.change', { change: C.signedInt(c.change) });
      var svgWrap = h('div');
      svgWrap.innerHTML = '<svg viewBox="0 0 200 64" preserveAspectRatio="none" role="img" aria-label="' + SVG.esc(c.name + ': ' + sub) + '">' +
        SVG.sparkline(c.trend, sb.scale, 200, 64, color(c.id)).replace(/<(polyline|line)/g, '<$1 vector-effect="non-scaling-stroke"') + '</svg>';
      grid.appendChild(h('div', { class: 'card', style: '--swatch:' + color(c.id) }, [top,
        h('span', { class: 'card__big' + (c.pct !== null && c.pct < -0.05 ? ' card__big--loss' : '') , text: pctOr(c.pct, true) }),
        h('span', { class: 'card__sub', text: sub }), svgWrap.firstChild,
        h('dl', { class: 'card__rows' }, [h('dt', { text: t('p1.score.hires') }), h('dd', { text: C.int(c.hires) }),
          h('dt', { text: t('p1.score.departures') }), h('dd', { text: C.int(c.departures) })])]));
    });
    f.setBody(grid);
    var nt = M.entityNotes(entIdx[state.entity], meta, state.chosen, state.n);
    f.setNotes([t('p1.score.note')].concat(noteNodes(nt)));
    var live = sb.cards.filter(function (c) { return !c.empty; });
    var head = [t('p1.control.months')].concat(sb.cards.map(function (c) { return c.name; }));
    var rows = [];
    for (var k = 0; k <= state.n; k++) rows.push([String(k)].concat(sb.cards.map(function (c) { var p = c.trend && c.trend[k]; return p ? C.signedInt(p.v) : emptyMark(); })));
    var cell = function (c, fn) { return c.empty ? emptyMark() : fn(c); };
    f.setTable(S.dataTable(t('p1.score.title', { n: state.n }), head, rows, [
      [t('p1.heat.tab.change')].concat(sb.cards.map(function (c) { return cell(c, function (x) { return pctOr(x.pct, true); }); })),
      [t('p1.score.hires')].concat(sb.cards.map(function (c) { return cell(c, function (x) { return C.int(x.hires); }); })),
      [t('p1.score.departures')].concat(sb.cards.map(function (c) { return cell(c, function (x) { return C.int(x.departures); }); }))
    ]));
    f.onSvg(function () {
      return { filename: slug() + '-scoreboard.svg', svg: SVG.scoreboard({
        title: t('p1.score.title', { n: state.n }), subtitle: names[state.entity], scale: sb.scale,
        notes: [t('p1.score.note')].concat(textNotes(nt)),
        cards: sb.cards.map(function (c) {
          return c.empty ? { name: c.name, color: color(c.id), empty: true, emptyText: t('shell.empty') } : { name: c.name, color: color(c.id), years: years(c),
            big: pctOr(c.pct, true), bigColor: c.pct !== null && c.pct < -0.05 ? '#ffa657' : '#e6edf3', sub: t('p1.score.change', { change: C.signedInt(c.change) }),
            trend: c.trend, rows: [[t('p1.score.hires'), C.int(c.hires)], [t('p1.score.departures'), C.int(c.departures)]] };
        }) }) };
    });
    return live.length;
  }
  function textNotes(nt, marks) { return noteNodes(nt, marks).map(function (x) { return typeof x === 'string' ? x : x.textContent; }); }

  /* ---- 5.3 heat map */
  function cellText(c) {
    if (c.na) return naText();
    if (c.value === null || c.value === undefined) return emptyMark();
    return C.pct(c.value, state.metric === 'change');
  }
  function cellStyle(c) {
    if (c.na || c.value === null || c.value === undefined) return M.NA_STYLE;
    return M.bin(state.metric, c.value);
  }
  function headMarks(fl) { return (fl.provisional ? MARK_PROV : '') + (fl.incomplete ? MARK_INC : ''); }
  function renderHeat() {
    var f = frames.heat;
    var hm = M.heat(mIdx, govIdx, meta, names, { entity: state.entity, chosen: state.chosen, n: state.n, metric: state.metric, showAll: state.showAll, sort: state.sort });
    f.setTitle(t('p1.heat.title'));
    f.setSub([t('p1.heat.sub.' + state.metric, { n: state.n }), ' ', t('p1.heat.sort')]);
    controls.tabs.forEach(function (b) {
      var on = b.getAttribute('data-metric') === state.metric;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    function sortHead(col, label, cls, styleColor, marks) {
      var on = hm.sort.col === col;
      var btn = h('button', { type: 'button', style: styleColor ? 'color:' + styleColor : null, onclick: function () {
        var dir = on ? (hm.sort.dir === 'asc' ? 'desc' : 'asc') : (col === 'name' ? 'asc' : state.metric === 'change' && col !== 'size' ? 'asc' : 'desc');
        state.sort = { col: col, dir: dir }; render(); focusSort(col);
      } }, [label, marks ? h('span', { class: 'heat__mark', text: marks }) : null, ' ', h('span', { class: 'heat__arrow', 'aria-hidden': 'true', text: on ? (hm.sort.dir === 'asc' ? '▲' : '▼') : '' })]);
      btn.setAttribute('data-sort', col);
      return h('th', { scope: 'col', class: cls || null, 'aria-sort': on ? (hm.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, btn);
    }
    var thead = h('thead', {}, h('tr', {}, [sortHead('name', t('p1.heat.col.entity')), sortHead('size', t('p1.heat.col.size'), 'heat__size')]
      .concat(hm.admins.map(function (a) { return sortHead(a.id, a.name, 'heat__admin', color(a.id), headMarks(hm.flags[a.id])); }))));
    var tbody = h('tbody', {}, hm.rows.map(function (r) {
      return h('tr', { class: (r.pinned ? 'is-pinned ' : '') + (r.highlight ? 'is-highlight' : ''), 'data-entity': r.key }, [
        h('th', { scope: 'row', text: r.name }), h('td', { class: 'heat__size', text: r.size === null ? emptyMark() : C.int(r.size) })
      ].concat(hm.admins.map(function (a) {
        var c = r.cells[a.id], st = cellStyle(c), small = c.small && !c.na && c.value !== null && c.value !== undefined;
        var hatch = st.fg === '#0d1117' ? 'rgba(255,255,255,0.22)' : 'rgba(13,17,23,0.3)';
        return h('td', { class: 'heat__cell' + (c.na ? ' is-na' : '') + (small ? ' is-small' : ''), 'data-admin': a.id,
          style: 'background-color:' + st.bg + ';color:' + st.fg + ';--hatch:' + hatch, text: cellText(c) });
      })));
    }));
    var caption = h('caption', { class: 'visually-hidden', text: t('p1.heat.title') + '. ' + t('p1.heat.sub.' + state.metric, { n: state.n }) });
    var table = h('table', { class: 'heat', id: 'heat-grid' }, [caption, thead, tbody]);
    var box = h('div', { class: 'heat-box', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.metric, tabindex: '0' }, table);
    var legend = h('div', { class: 'legend', 'aria-hidden': 'true' }, M.BINS[state.metric].map(function (b) { return h('span', { style: 'background:' + b.bg + ';color:' + b.fg, text: b.label }); }));
    var foot = h('div', { class: 'heat-foot mono' }, [
      hm.filtered ? h('span', { class: 'status', text: t('p1.heat.filter') }) : null,
      hm.view === 'defense' ? null : h('label', { class: 'switch' }, [h('input', { type: 'checkbox', id: 'ctl-all', checked: state.showAll, onchange: function (e) { state.showAll = e.target.checked; render(); } }), t('p1.heat.switch')]),
      legend
    ]);
    f.setBody(h('div', {}, [box, foot]));
    f.setNotes([t('p1.heat.na'), hm.anySmall ? t('p1.heat.small') : null].concat(noteNodes(hm.notes, true)));
    var head = [t('p1.heat.col.entity'), t('p1.heat.col.size')].concat(hm.admins.map(function (a) { return a.name + headMarks(hm.flags[a.id]); }));
    f.setTable(S.dataTable(t('p1.heat.title'), head, hm.rows.map(function (r) {
      return [r.name, r.size === null ? emptyMark() : C.int(r.size)].concat(hm.admins.map(function (a) { return cellText(r.cells[a.id]); }));
    })));
    f.onSvg(function () {
      return { filename: slug() + '-heat-' + state.metric + '.svg', svg: SVG.heatmap({
        title: t('p1.heat.title') + ': ' + t(TAB_KEYS[state.metric]), subtitle: t('p1.heat.sub.' + state.metric, { n: state.n }),
        firstHead: t('p1.heat.col.entity'), sizeHead: t('p1.heat.col.size'),
        headers: hm.admins.map(function (a) { return { text: a.name + headMarks(hm.flags[a.id]), color: color(a.id) }; }),
        rows: hm.rows.map(function (r) {
          return { name: r.name, size: r.size === null ? emptyMark() : C.int(r.size), bold: r.pinned || r.highlight, highlight: r.highlight,
            cells: hm.admins.map(function (a) { var c = r.cells[a.id], st = cellStyle(c); return { text: cellText(c), bg: st.bg, fg: st.fg, small: c.small && !c.na && c.value !== null && c.value !== undefined }; }) };
        }),
        legend: M.BINS[state.metric], notes: (hm.filtered ? [t('p1.heat.filter')] : []).concat([t('p1.heat.na')], hm.anySmall ? [t('p1.heat.small')] : [], textNotes(hm.notes, true)) }) };
    });
  }
  function focusSort(col) { var b = document.querySelector('#heat-grid button[data-sort="' + col + '"]'); if (b) b.focus(); }

  /* ---- 5.4 rates */
  function renderRates() {
    var f = frames.rates, rs = M.rates(entIdx[state.entity], meta, state.chosen, state.n);
    f.setTitle(t('p1.rates.title', { n: state.n }));
    f.setSub(t('p1.rates.note'));
    var max = 0;
    rs.forEach(function (r) { if (!r.empty) { max = Math.max(max, r.dep || 0, r.hire || 0); } });
    var groups = [['dep', 'p1.rates.dep'], ['hire', 'p1.rates.hire']].map(function (g) {
      return { key: g[0], title: t(g[1]), rows: rs.map(function (r) {
        var v = r.empty ? null : r[g[0]];
        return { name: r.name, color: color(r.id), frac: v === null || !max ? null : v / max, text: v === null ? emptyMark() : C.pct(v), small: !r.empty && r.small };
      }) };
    });
    var wrap = h('div', { class: 'bars' });
    groups.forEach(function (g) {
      wrap.appendChild(h('h3', { text: g.title }));
      g.rows.forEach(function (r) {
        wrap.appendChild(h('div', { class: 'bar-row', 'data-group': g.key }, [h('span', { text: r.name }),
          h('span', { class: 'bar-track', 'aria-hidden': 'true' }, r.frac === null ? null : h('span', { class: 'bar-fill' + (r.small ? ' is-small' : ''), style: '--swatch:' + r.color + ';width:' + (r.frac * 100).toFixed(1) + '%' })),
          h('span', { class: 'bar-val', text: r.text })]));
      });
    });
    f.setBody(wrap);
    var anySmall = rs.some(function (r) { return !r.empty && r.small; });
    var nt = M.entityNotes(entIdx[state.entity], meta, state.chosen, state.n);
    f.setNotes([anySmall ? t('p1.heat.small') : null].concat(noteNodes(nt)));
    f.setTable(S.dataTable(t('p1.rates.title', { n: state.n }), [t('p1.control.admins'), t('p1.rates.dep'), t('p1.rates.hire')],
      rs.map(function (r, i) { return [r.name, groups[0].rows[i].text, groups[1].rows[i].text]; })));
    f.onSvg(function () {
      return { filename: slug() + '-rates.svg', svg: SVG.bars({ title: t('p1.rates.title', { n: state.n }), subtitle: names[state.entity] + '. ' + t('p1.rates.note'),
        groups: groups, notes: (anySmall ? [t('p1.heat.small')] : []).concat(textNotes(nt)) }) };
    });
  }

  /* ---- 5.5 why people left */
  function renderReasons() {
    var f = frames.reasons, admins = M.ordered(meta, state.chosen), rs = M.reasons(entIdx[state.entity], meta, state.chosen, state.n);
    f.setTitle(t('p1.reasons.title', { n: state.n }));
    f.setSub(t('p1.reasons.note'));
    function txt(c) { return c.na ? naText() : c.share === null || c.share === undefined ? emptyMark() : C.pct(c.share); }
    var table = h('table', { class: 'reasons' }, [
      h('caption', { class: 'visually-hidden', text: t('p1.reasons.title', { n: state.n }) }),
      h('thead', {}, h('tr', {}, [h('td')].concat(admins.map(function (a) { return h('th', { scope: 'col', style: 'color:' + color(a.id), text: a.name }); })))),
      h('tbody', {}, rs.map(function (r) {
        return h('tr', { 'data-reason': r.id }, [h('th', { scope: 'row', text: t('p1.reason.' + r.id) })].concat(r.cells.map(function (c) {
          var w = c.share ? Math.max(1, Math.round(c.share * 120)) : 0;
          return h('td', {}, [w ? h('span', { class: 'mini', 'aria-hidden': 'true', style: '--swatch:' + color(c.id) + ';width:' + w + 'px' }) : null, txt(c)]);
        })));
      }))
    ]);
    f.setBody(h('div', { class: 'scroll' }, table));
    var nt = M.entityNotes(entIdx[state.entity], meta, state.chosen, state.n);
    f.setNotes(noteNodes(nt));
    f.setTable(S.dataTable(t('p1.reasons.title', { n: state.n }), [''].concat(admins.map(function (a) { return a.name; })),
      rs.map(function (r) { return [t('p1.reason.' + r.id)].concat(r.cells.map(txt)); })));
    f.onSvg(function () {
      return { filename: slug() + '-reasons.svg', svg: SVG.reasons({ title: t('p1.reasons.title', { n: state.n }), subtitle: names[state.entity] + '. ' + t('p1.reasons.note'),
        firstHead: '', headers: admins.map(function (a) { return { text: a.name, color: color(a.id) }; }),
        rows: rs.map(function (r) { return { label: t('p1.reason.' + r.id), cells: r.cells.map(function (c) { return { text: txt(c), frac: c.share || 0, color: color(c.id) }; }) }; }),
        notes: textNotes(nt) }) };
    });
  }

  function render() {
    syncControls();
    renderScore(); renderHeat(); renderRates(); renderReasons();
    writeState();
    document.body.setAttribute('data-ready', 'true');
  }

  /* the selected entity's admin cube (GOV is always loaded for the heat map's first row) */
  function load() {
    document.body.removeAttribute('data-ready');
    var key = state.entity;
    var p = entIdx[key] ? Promise.resolve() : S.getJson('data/' + meta.files[key].path).then(function (f) { entIdx[key] = M.indexAdmin(f); });
    return p.then(render, function () { showEmpty(); });
  }
  function showEmpty() {
    var main = document.getElementById('main');
    S.clear(main); S.empty(main);
    document.body.setAttribute('data-ready', 'true');
  }

  function tabs() {
    var list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('p1.heat.title') });
    controls.tabs = M.METRICS.map(function (m) {
      var b = h('button', { type: 'button', role: 'tab', id: 'tab-' + m, 'data-metric': m, text: t(TAB_KEYS[m]), onclick: function () { pickMetric(m); } });
      b.addEventListener('keydown', function (e) {
        var i = M.METRICS.indexOf(m), j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? M.METRICS.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        var next = M.METRICS[(j + M.METRICS.length) % M.METRICS.length];
        pickMetric(next); document.getElementById('tab-' + next).focus();
      });
      list.appendChild(b);
      return b;
    });
    return list;
  }
  function pickMetric(m) { state.metric = m; state.sort = null; render(); }

  S.init('administrations').then(function (cp) {
    copy = cp; t = cp.t;
    return Promise.all([S.getJson('data/admin.meta.json'), S.getJson('data/matrix.meta.json')]).then(function (ms) {
      meta = ms[0];
      S.setDataMonth(meta.range.last_month);
      names = C.displayNames(meta.entities, t('p1.control.entity.all'));
      return Promise.all([S.getJson('data/' + meta.files.GOV.path), S.getJson('data/' + ms[1].files.matrix.path)]);
    }).then(function (fs) {
      govIdx = M.indexAdmin(fs[0]); entIdx.GOV = govIdx; mIdx = M.indexMatrix(fs[1]);
      state = readState();
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p1.title') }), h('p', { text: t('p1.intro') }), buildControls()]));
      frames.score = S.frame({ id: 'score' });
      frames.heat = S.frame({ id: 'heat', headExtra: tabs() });
      frames.rates = S.frame({ id: 'rates', panel: true });
      frames.reasons = S.frame({ id: 'reasons', panel: true });
      main.appendChild(frames.score.el);
      main.appendChild(frames.heat.el);
      main.appendChild(h('div', { class: 'pair' }, [frames.rates.el, frames.reasons.el]));
      root.OPM.page = { state: function () { return state; }, frames: frames };
      return load();
    });
  }).catch(function (e) { if (root.console) console.warn(String(e)); if (S.copy()) showEmpty(); });
})(self);
