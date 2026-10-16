/* Charts for pages 2 to 7: Chart.js 4 with the Briefing theme, administration bands, provisional dashes and marks,
   and an SVG export read off the drawn chart (the same geometry the screen shows). Browser only. */
(function (root) {
  'use strict';
  var SVG = root.OPM.svg, T = SVG.TOKENS;
  var ADMIN_COLORS = { obama2: '#c297ff', trump1: '#f2cc60', biden: '#56d4c4', trump2: '#f0f6fc' };
  /* series colors on the dark ground, each at least 3:1 against the panel (tests/contrast.test.js) */
  var PALETTE = { hires: '#4dabf7', departures: '#ff8c2e', line: '#e6edf3', change: '#a5d8ff', net: '#ffb454',
    seven: ['#ff6b9a', '#4dabf7', '#ffb454', '#c297ff', '#ff6b6b', '#56d4c4', '#9da7b3'],
    two: ['#4dabf7', '#56d4c4'], three: ['#4dabf7', '#ff8c2e', '#f2cc60'], prior: '#6e7681' };
  var FONT = "'IBM Plex Sans', Arial, sans-serif", MONO = "'IBM Plex Mono', Menlo, monospace";

  var registered = false;
  function register() {
    if (registered || !root.Chart) return;
    registered = true;
    var C = root.Chart;
    C.defaults.color = T.muted;
    C.defaults.borderColor = T.rule;
    C.defaults.font.family = FONT;
    C.defaults.font.size = 12;
    C.defaults.animation = false;
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.labels.boxWidth = 12;
    C.defaults.plugins.legend.labels.color = T.soft;
    C.defaults.plugins.tooltip.backgroundColor = '#010409';
    C.defaults.plugins.tooltip.borderColor = T.line;
    C.defaults.plugins.tooltip.borderWidth = 1;
    /* administration bands behind the plot: opts.bands = [{ from, to (category indexes), color, label }] */
    C.register({
      id: 'opmBands',
      beforeDatasetsDraw: function (chart, args, opts) {
        if (!opts || !opts.bands || !opts.bands.length) return;
        var xs = chart.scales.x, a = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        opts.bands.forEach(function (b) {
          var x0 = bandEdge(xs, b.from, -1), x1 = bandEdge(xs, b.to, 1);
          x0 = Math.max(a.left, x0); x1 = Math.min(a.right, x1);
          if (x1 <= x0) return;
          ctx.globalAlpha = 0.09; ctx.fillStyle = b.color; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
          ctx.globalAlpha = 1; ctx.fillStyle = b.color; ctx.font = '600 11px ' + FONT; ctx.textBaseline = 'bottom';
          if (ctx.measureText(b.label).width + 6 < x1 - x0) ctx.fillText(b.label, x0 + 4, a.top - 2);
        });
        ctx.restore();
      }
    });
    /* marks above chosen categories (known breaks): opts.flags = [bool per index], opts.glyph */
    C.register({
      id: 'opmMarks',
      afterDatasetsDraw: function (chart, args, opts) {
        if (!opts || !opts.flags) return;
        var xs = chart.scales.x, a = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        opts.flags.forEach(function (on, i) {
          if (!on) return;
          var x = xs.getPixelForValue(i);
          ctx.strokeStyle = T.ink; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = T.ink; ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(opts.glyph || '!', x, a.top + 11);
        });
        ctx.restore();
      }
    });
  }
  function bandEdge(xs, i, side) {
    var p = xs.getPixelForValue(i), n = xs.ticks ? xs.max - xs.min : 0;
    var step = n > 0 ? (xs.getPixelForValue(xs.max) - xs.getPixelForValue(xs.min)) / n : (xs.right - xs.left);
    return p + side * step / 2;
  }

  /* bands for a list of period rows: each administration over the periods that end inside its window, so bands
     never overlap (a fiscal year belongs to the administration in office at its last month) */
  function adminBands(rows, admins) {
    return admins.map(function (a) {
      var idx = [];
      rows.forEach(function (r, i) { if (r.period_last_month >= a.first_month && r.period_last_month <= a.last_month) idx.push(i); });
      return idx.length ? { from: idx[0], to: idx[idx.length - 1], color: ADMIN_COLORS[a.id] || T.muted, label: a.name } : null;
    }).filter(Boolean);
  }

  /* a chart in a box of the given height. config is a Chart.js config; returns the Chart */
  function make(box, config, height) {
    register();
    var wrap = document.createElement('div');
    wrap.className = 'chart-box';
    wrap.style.height = (height || 300) + 'px';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    if (config.aria) canvas.setAttribute('aria-label', config.aria);
    wrap.appendChild(canvas);
    box.appendChild(wrap);
    config.options = config.options || {};
    config.options.responsive = true;
    return new root.Chart(canvas.getContext('2d'), config);
  }

  /* dashed segment into a provisional point: segment option for a line dataset */
  function dashProvisional(flags) {
    return { borderDash: function (ctx) { return flags[ctx.p1DataIndex] ? [5, 4] : undefined; } };
  }
  /* a lighter, hatched fill for provisional bars */
  function hatch(color) {
    var c = document.createElement('canvas'); c.width = 6; c.height = 6;
    var x = c.getContext('2d');
    x.fillStyle = color; x.globalAlpha = 0.45; x.fillRect(0, 0, 6, 6);
    x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(-1, 7); x.lineTo(7, -1); x.stroke();
    return x.createPattern(c, 'repeat');
  }

  /* ---- SVG export of a drawn chart */
  function n(v) { return Math.round(v * 100) / 100; }
  function tickLabel(l) { return Array.isArray(l) ? l.join(' ') : String(l); }
  function chartSvg(chart, o) {
    var W = chart.width + 40, H = chart.height, a = chart.chartArea;
    var legendItems = [];
    chart.data.datasets.forEach(function (ds, i) {
      if (!chart.isDatasetVisible(i) || ds.hideInLegend) return;
      legendItems.push({ label: ds.label, color: typeof ds.borderColor === 'string' && ds.type !== 'bar' && chart.config.type !== 'bar' ? ds.borderColor : (typeof ds.backgroundColor === 'string' ? ds.backgroundColor : ds._color || T.muted) });
    });
    var legH = legendItems.length ? 26 : 0;
    var body = function () {
      var out = [], lx = 0;
      legendItems.forEach(function (k) {
        out.push('<rect x="' + n(lx) + '" y="2" width="11" height="11" rx="2" fill="' + SVG.esc(k.color) + '"/>');
        out.push('<text x="' + n(lx + 16) + '" y="12" font-size="12" fill="' + T.soft + '">' + SVG.esc(k.label) + '</text>');
        lx += 30 + String(k.label).length * 6.6;
      });
      out.push('<g transform="translate(0,' + legH + ')">');
      var bands = chart.options.plugins && chart.options.plugins.opmBands && chart.options.plugins.opmBands.bands;
      var xs = chart.scales.x, ys = chart.scales.y;
      (bands || []).forEach(function (b) {
        var x0 = Math.max(a.left, bandEdge(xs, b.from, -1)), x1 = Math.min(a.right, bandEdge(xs, b.to, 1));
        if (x1 <= x0) return;
        out.push('<rect x="' + n(x0) + '" y="' + n(a.top) + '" width="' + n(x1 - x0) + '" height="' + n(a.bottom - a.top) + '" fill="' + b.color + '" fill-opacity="0.09"/>');
        out.push('<text x="' + n(x0 + 4) + '" y="' + n(a.top - 3) + '" font-size="11" font-weight="600" fill="' + b.color + '">' + SVG.esc(b.label) + '</text>');
      });
      var horizontal = chart.options.indexAxis === 'y';
      var vScale = horizontal ? xs : ys, cScale = horizontal ? ys : xs;
      vScale.ticks.forEach(function (t, i) {
        var p = vScale.getPixelForTick(i);
        if (horizontal) {
          out.push('<line x1="' + n(p) + '" x2="' + n(p) + '" y1="' + n(a.top) + '" y2="' + n(a.bottom) + '" stroke="' + T.rule + '"/>');
          out.push('<text x="' + n(p) + '" y="' + n(a.bottom + 16) + '" font-size="11" text-anchor="middle" fill="' + T.muted + '">' + SVG.esc(tickLabel(t.label)) + '</text>');
        } else {
          out.push('<line x1="' + n(a.left) + '" x2="' + n(a.right) + '" y1="' + n(p) + '" y2="' + n(p) + '" stroke="' + T.rule + '"/>');
          out.push('<text x="' + n(a.left - 6) + '" y="' + n(p + 4) + '" font-size="11" text-anchor="end" fill="' + T.muted + '">' + SVG.esc(tickLabel(t.label)) + '</text>');
        }
      });
      cScale.ticks.forEach(function (t, i) {
        var p = cScale.getPixelForTick(i), lab = tickLabel(t.label);
        if (horizontal) out.push('<text x="' + n(a.left - 6) + '" y="' + n(p + 4) + '" font-size="11" text-anchor="end" fill="' + T.muted + '">' + SVG.esc(lab) + '</text>');
        else out.push('<text x="' + n(p) + '" y="' + n(a.bottom + 16) + '" font-size="11" text-anchor="middle" fill="' + T.muted + '">' + SVG.esc(lab) + '</text>');
      });
      chart.data.datasets.forEach(function (ds, i) {
        if (!chart.isDatasetVisible(i)) return;
        var meta = chart.getDatasetMeta(i), isBar = (ds.type || chart.config.type) === 'bar';
        var color = isBar ? (typeof ds.backgroundColor === 'string' ? ds.backgroundColor : ds._color || T.muted) : ds.borderColor;
        if (isBar) {
          meta.data.forEach(function (el, j) {
            var v = ds.data[j];
            if (v === null || v === undefined) return;
            var p = el.getProps(['x', 'y', 'base', 'width', 'height'], true), fill = Array.isArray(ds.backgroundColor) ? ds._colors && ds._colors[j] || color : color;
            var faded = ds._provisional && ds._provisional[j];
            if (horizontal) { var l = Math.min(p.x, p.base), r = Math.max(p.x, p.base); out.push('<rect x="' + n(l) + '" y="' + n(p.y - p.height / 2) + '" width="' + n(r - l) + '" height="' + n(p.height) + '" fill="' + SVG.esc(fill) + '"' + (faded ? ' fill-opacity="0.5"' : '') + '/>'); }
            else { var t2 = Math.min(p.y, p.base), b2 = Math.max(p.y, p.base); out.push('<rect x="' + n(p.x - p.width / 2) + '" y="' + n(t2) + '" width="' + n(p.width) + '" height="' + n(b2 - t2) + '" fill="' + SVG.esc(fill) + '"' + (faded ? ' fill-opacity="0.5"' : '') + '/>'); }
          });
        } else {
          var pts = meta.data.map(function (el, j) { var v = ds.data[j]; if (v === null || v === undefined) return null; var p = el.getProps(['x', 'y'], true); return { x: p.x, y: p.y, dash: !!(ds._provisional && ds._provisional[j]) }; });
          var seg = null;
          for (var j = 1; j < pts.length; j++) {
            if (!pts[j - 1] || !pts[j]) { seg = null; continue; }
            out.push('<line x1="' + n(pts[j - 1].x) + '" y1="' + n(pts[j - 1].y) + '" x2="' + n(pts[j].x) + '" y2="' + n(pts[j].y) + '" stroke="' + SVG.esc(color) + '" stroke-width="2"' + (pts[j].dash ? ' stroke-dasharray="5 4"' : '') + '/>');
          }
          if (pts.length === 1 && pts[0]) out.push('<circle cx="' + n(pts[0].x) + '" cy="' + n(pts[0].y) + '" r="3" fill="' + SVG.esc(color) + '"/>');
        }
      });
      var marks = chart.options.plugins && chart.options.plugins.opmMarks && chart.options.plugins.opmMarks.flags;
      (marks || []).forEach(function (on, i) {
        if (!on) return;
        var x = xs.getPixelForValue(i);
        out.push('<line x1="' + n(x) + '" x2="' + n(x) + '" y1="' + n(a.top) + '" y2="' + n(a.bottom) + '" stroke="' + T.ink + '" stroke-dasharray="2 3"/>');
        out.push('<text x="' + n(x) + '" y="' + n(a.top + 11) + '" font-size="12" font-weight="700" text-anchor="middle" fill="' + T.ink + '">!</text>');
      });
      out.push('</g>');
      return out.join('');
    };
    return SVG.document(W, H + legH, { title: o.title, subtitle: o.subtitle, notes: o.notes }, body);
  }

  root.OPM = root.OPM || {};
  root.OPM.charts = { ADMIN_COLORS: ADMIN_COLORS, PALETTE: PALETTE, FONT: FONT, MONO: MONO, make: make, adminBands: adminBands, dashProvisional: dashProvisional, hatch: hatch, chartSvg: chartSvg, register: register };
})(self);
