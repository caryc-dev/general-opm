/* Helpers shared by pages 2 to 7: loading metas, entity names, period labels, tiles, chart frames. Browser only. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, CH = root.OPM.charts, h = S.h;

  /* the administrations list and the latest month, from the admin cube meta */
  function admins() { return S.getJson('data/admin.meta.json'); }

  /* a tile: name, big value, small lines */
  function tile(name, value, subs, cls) {
    return h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, [h('span', { class: 'tile__name', text: name }), h('span', { class: 'tile__value', text: value === null || value === undefined ? S.copy().t('shared.mark.empty') : value })]
      .concat((subs || []).filter(Boolean).map(function (s) { return h('span', { class: 'tile__sub', text: s }); })));
  }

  /* a period label for tables and notes: partial periods say so */
  function periodText(r) {
    var t = S.copy().t, base = r.grain === 'month' ? C.monthLabel(r.period) : r.grain === 't12' ? t('shared.period.t12', { month: C.monthLabel(r.period) }) : r.period;
    return r.partial && r.grain !== 'month' ? t('shared.period.partial', { period: base }) : base;
  }

  /* a chart section: the frame with a canvas, re-drawn on every render. draw(box) returns the Chart. */
  function chartFrame(opts) {
    var f = S.frame(opts), chart = null;
    f.draw = function (config, height) {
      if (chart) { chart.destroy(); chart = null; }
      var box = h('div');
      f.setBody(box);
      chart = CH.make(box, config, height);
      f.chart = chart;
      f.onSvg(function () {
        return { filename: (opts.file || opts.id) + '.svg', svg: CH.chartSvg(chart, { title: f.titleText, subtitle: f.subText, notes: f.noteTexts || [] }) };
      });
      return chart;
    };
    var setTitle = f.setTitle, setNotes = f.setNotes, setSub = f.setSub;
    f.setTitle = function (x) { f.titleText = x; setTitle(x); };
    f.setSub = function (x) { f.subText = Array.isArray(x) ? x.map(function (p) { return typeof p === 'string' ? p : p.textContent; }).join('') : x; setSub(x); };
    f.setNotes = function (list) { f.noteTexts = list.filter(Boolean).map(function (x) { return typeof x === 'string' ? x : x.textContent; }); setNotes(list); };
    f.clearChart = function () { if (chart) { chart.destroy(); chart = null; } };
    return f;
  }

  /* number formats for axes and tooltips */
  function axisInt(v) { return C.int(v); }
  function axisPct(v) { var x = Math.round(v * 1000) / 10; return (x % 1 ? x.toFixed(1) : x.toFixed(0)) + '%'; }
  function baseOptions(o) {
    o = o || {};
    return {
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: o.legend !== false, position: 'bottom', align: 'start' },
        opmBands: { bands: o.bands || [] }, opmMarks: { flags: o.marks || null },
        tooltip: { callbacks: { label: function (ctx) { var v = ctx.raw; return ctx.dataset.label + ': ' + (v === null || v === undefined ? S.copy().t('shared.mark.empty') : o.pct ? C.pct(v) : o.signed ? C.signedInt(v) : C.int(v)); } } } },
      scales: {
        x: { stacked: !!o.stacked, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, color: '#9da7b3' } },
        y: { stacked: !!o.stacked, beginAtZero: o.zero !== false, grid: { color: '#262c34' }, ticks: { color: '#9da7b3', precision: o.pct ? undefined : 0, callback: o.pct ? axisPct : o.signed ? function (v) { return C.signedInt(v); } : axisInt } }
      },
      layout: { padding: { top: o.bands && o.bands.length ? 16 : 4 } }
    };
  }

  root.OPM.common = { admins: admins, tile: tile, periodText: periodText, chartFrame: chartFrame, baseOptions: baseOptions };
})(self);
