/* SVG drawing for page sections. Each builder is pure: it takes a laid-out view (strings already from copy.json,
   values already formatted) and returns a standalone SVG string, used for the "Download SVG" button. sparkline()
   also draws the scoreboard trend lines on screen. download() saves a file (browser only). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.svg = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var T = { bg: '#0d1117', panel: '#161b22', line: '#30363d', rule: '#262c34', ink: '#e6edf3', soft: '#c9d1d9', muted: '#9da7b3', track: '#21262d', zero: '#6e7681' };
  var SANS = "'IBM Plex Sans', Arial, sans-serif", MONO = "'IBM Plex Mono', Menlo, monospace";

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function n(v) { return Math.round(v * 100) / 100; }
  function textW(s, size, mono) { return String(s).length * size * (mono ? 0.6 : 0.54); }
  function text(x, y, s, o) {
    o = o || {};
    return '<text x="' + n(x) + '" y="' + n(y) + '" font-size="' + (o.size || 13) + '"' + (o.mono ? ' font-family="' + esc(MONO) + '"' : '') +
      (o.weight ? ' font-weight="' + o.weight + '"' : '') + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
      ' fill="' + esc(o.fill || T.ink) + '">' + esc(s) + '</text>';
  }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(Math.max(0, w)) + '" height="' + n(Math.max(0, h)) + '" fill="' + esc(fill) + '"' + (extra || '') + '/>';
  }
  /* lines of wrapped text within a width */
  function wrap(s, width, size) {
    var words = String(s).split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (textW(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  var HATCH_DEFS = '<defs>' +
    '<pattern id="hatch-light" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="#ffffff" fill-opacity="0.22"/></pattern>' +
    '<pattern id="hatch-dark" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="#0d1117" fill-opacity="0.3"/></pattern>' +
    '</defs>';
  /* hatch over a cell: light stripes under light text, dark stripes under dark text, so text contrast only rises */
  function hatchFor(fg) { return /^#(0d1117|000000)$/i.test(fg) ? 'url(#hatch-light)' : 'url(#hatch-dark)'; }

  /* the document: title, optional subtitle, body (already positioned below `top`), notes under it */
  function doc(width, bodyH, o, body) {
    var pad = 20, y = pad + 18, head = [];
    head.push(text(pad, y, o.title, { size: 18, weight: 700 }));
    if (o.subtitle) wrap(o.subtitle, width - pad * 2, 13).forEach(function (l) { y += 20; head.push(text(pad, y, l, { size: 13, fill: T.muted })); });
    var top = y + 18, foot = [], fy = top + bodyH + 8;
    (o.notes || []).forEach(function (t) {
      wrap(t, width - pad * 2, 12).forEach(function (l) { fy += 17; foot.push(text(pad, fy, l, { size: 12, fill: T.muted })); });
    });
    var H = fy + pad;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(width) + '" height="' + n(H) + '" viewBox="0 0 ' + n(width) + ' ' + n(H) + '" font-family="' + esc(SANS) + '">' +
      '<title>' + esc(o.title) + '</title>' + HATCH_DEFS + rect(0, 0, width, H, T.bg) + head.join('') +
      '<g transform="translate(' + pad + ',' + n(top) + ')">' + body(width - pad * 2) + '</g>' + foot.join('') + '</svg>';
  }

  /* ---- trend line: points [{n, v, provisional} | null] over months 0..N, on a shared scale.
     Returns path elements for a w x h box; a segment into a provisional month is dashed. */
  function sparkline(points, scale, w, h, color) {
    var N = Math.max(1, points.length - 1), lo = scale.min, hi = scale.max;
    if (hi === lo) { hi = lo + 1; }
    var px = function (k) { return 2 + (w - 4) * k / N; }, py = function (v) { return 4 + (h - 8) * (hi - v) / (hi - lo); };
    var out = ['<line x1="0" x2="' + n(w) + '" y1="' + n(py(0)) + '" y2="' + n(py(0)) + '" stroke="' + T.zero + '" stroke-dasharray="2 3" stroke-width="1"/>'];
    var seg = null, segs = [];
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (!a || !b) { seg = null; continue; }
      var dash = !!b.provisional;
      if (!seg || seg.dash !== dash) { seg = { dash: dash, pts: [[px(a.n), py(a.v)]] }; segs.push(seg); }
      seg.pts.push([px(b.n), py(b.v)]);
    }
    segs.forEach(function (s) {
      out.push('<polyline points="' + s.pts.map(function (p) { return n(p[0]) + ',' + n(p[1]); }).join(' ') + '" fill="none" stroke="' + esc(color) +
        '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + '/>');
    });
    if (points.length === 1 && points[0]) out.push('<circle cx="' + n(px(0)) + '" cy="' + n(py(points[0].v)) + '" r="2.5" fill="' + esc(color) + '"/>');
    return out.join('');
  }

  /* ---- scoreboard: cards [{ name, color, years, big, bigColor, sub, trend, rows: [[label, value]] } | { name, color, empty }] */
  function scoreboard(o) {
    var W = 1160, gap = 14, cols = Math.min(4, Math.max(1, o.cards.length)), cw = (W - 40 - gap * (cols - 1)) / cols, ch = 236;
    var rowsN = Math.ceil(o.cards.length / cols);
    return doc(W, rowsN * ch + (rowsN - 1) * gap, o, function () {
      var out = [];
      o.cards.forEach(function (c, i) {
        var x = (i % cols) * (cw + gap), y = Math.floor(i / cols) * (ch + gap);
        out.push(rect(x, y, cw, ch, T.panel, ' stroke="' + T.line + '" rx="6"'), rect(x, y, cw, 3, c.color));
        out.push(text(x + 16, y + 30, c.name, { size: 16, weight: 600 }));
        if (c.years) out.push(text(x + cw - 16, y + 30, c.years, { size: 11, mono: true, fill: T.muted, anchor: 'end' }));
        if (c.empty) { out.push(text(x + 16, y + 70, c.emptyText, { size: 13, fill: T.muted })); return; }
        out.push(text(x + 16, y + 78, c.big, { size: 38, weight: 600, mono: true, fill: c.bigColor }));
        out.push(text(x + 16, y + 102, c.sub, { size: 13, mono: true, fill: T.soft }));
        out.push('<g transform="translate(' + n(x + 16) + ',' + n(y + 114) + ')">' + sparkline(c.trend, o.scale, cw - 32, 56, c.color) + '</g>');
        out.push('<line x1="' + n(x + 16) + '" x2="' + n(x + cw - 16) + '" y1="' + n(y + 182) + '" y2="' + n(y + 182) + '" stroke="' + T.rule + '"/>');
        c.rows.forEach(function (r, j) {
          out.push(text(x + 16, y + 202 + j * 20, r[0], { size: 12, mono: true, fill: T.muted }));
          out.push(text(x + cw - 16, y + 202 + j * 20, r[1], { size: 12, mono: true, anchor: 'end' }));
        });
      });
      return out.join('');
    });
  }

  /* ---- heat map: headers [{ text, color }], rows [{ name, size, bold, highlight, cells: [{ text, bg, fg, small }] }],
     legend [{ bg, fg, label }], firstHead, sizeHead */
  function heatmap(o) {
    var nameW = Math.min(460, Math.max(160, Math.max.apply(null, o.rows.map(function (r) { return textW(r.name, 13); }).concat([textW(o.firstHead, 13)])) + 20));
    var sizeW = Math.max(120, textW(o.sizeHead, 12) + 20), cellW = 112, rh = 28, gap = 3;
    var W = Math.max(720, 40 + nameW + sizeW + o.headers.length * (cellW + gap));
    var bodyH = 34 + o.rows.length * (rh + gap) + 40;
    return doc(W, bodyH, o, function () {
      var out = [], x0 = nameW + sizeW;
      out.push(text(0, 20, o.firstHead, { size: 12, fill: T.muted }), text(nameW + sizeW - 12, 20, o.sizeHead, { size: 12, fill: T.muted, anchor: 'end' }));
      o.headers.forEach(function (h, i) { out.push(text(x0 + i * (cellW + gap) + cellW / 2, 20, h.text, { size: 13, weight: 600, fill: h.color, anchor: 'middle' })); });
      o.rows.forEach(function (r, j) {
        var y = 34 + j * (rh + gap);
        if (r.highlight) out.push(rect(-4, y - 1, x0 + o.headers.length * (cellW + gap) + 4, rh + 2, 'none', ' stroke="#f0f6fc" stroke-width="1.5" rx="3"'));
        out.push(text(4, y + 18, r.name, { size: 13, weight: r.bold ? 700 : 400 }));
        out.push(text(nameW + sizeW - 12, y + 18, r.size, { size: 12, mono: true, fill: T.muted, anchor: 'end' }));
        r.cells.forEach(function (c, i) {
          var x = x0 + i * (cellW + gap);
          out.push(rect(x, y, cellW, rh, c.bg, ' rx="3"'));
          if (c.small) out.push(rect(x, y, cellW, rh, hatchFor(c.fg), ' rx="3"'));
          out.push(text(x + cellW / 2, y + 18, c.text, { size: 13, mono: true, weight: 500, fill: c.fg, anchor: 'middle' }));
        });
      });
      var ly = 34 + o.rows.length * (rh + gap) + 14, lx = 0;
      (o.legend || []).forEach(function (k) {
        var w = textW(k.label, 12, true) + 16;
        out.push(rect(lx, ly, w, 22, k.bg), text(lx + 8, ly + 15, k.label, { size: 12, mono: true, fill: k.fg }));
        lx += w;
      });
      return out.join('');
    });
  }

  /* ---- bar groups: groups [{ title, rows: [{ name, color, frac, text, small }] }] */
  function bars(o) {
    var W = 760, labelW = 110, valW = 70, rh = 22, gap = 9;
    var bodyH = o.groups.reduce(function (s, g) { return s + 30 + g.rows.length * (rh + gap); }, 0);
    return doc(W, bodyH, o, function (inner) {
      var out = [], y = 0, track = inner - labelW - valW - 20;
      o.groups.forEach(function (g) {
        out.push(text(0, y + 16, g.title, { size: 12, mono: true, fill: T.muted }));
        y += 30;
        g.rows.forEach(function (r) {
          out.push(text(0, y + 16, r.name, { size: 14 }));
          out.push(rect(labelW, y, track, rh, T.track));
          if (r.frac !== null && r.frac !== undefined) {
            out.push(rect(labelW, y, track * Math.min(1, r.frac), rh, r.color));
            if (r.small) out.push(rect(labelW, y, track * Math.min(1, r.frac), rh, 'url(#hatch-dark)'));
          }
          out.push(text(inner, y + 16, r.text, { size: 13, mono: true, weight: 600, anchor: 'end' }));
          y += rh + gap;
        });
      });
      return out.join('');
    });
  }

  /* ---- reasons table: headers [{ text, color }], rows [{ label, cells: [{ text, frac, color }] }] */
  function reasons(o) {
    var labelW = Math.max(200, Math.max.apply(null, o.rows.map(function (r) { return textW(r.label, 14); })) + 20), colW = 130, rh = 34;
    var W = Math.max(640, 40 + labelW + o.headers.length * colW);
    return doc(W, 30 + o.rows.length * rh, o, function () {
      var out = [];
      out.push(text(0, 18, o.firstHead, { size: 13, fill: T.muted }));
      o.headers.forEach(function (h, i) { out.push(text(labelW + (i + 1) * colW - 6, 18, h.text, { size: 13, weight: 600, fill: h.color, anchor: 'end' })); });
      o.rows.forEach(function (r, j) {
        var y = 30 + j * rh;
        out.push('<line x1="0" x2="' + n(labelW + o.headers.length * colW) + '" y1="' + n(y) + '" y2="' + n(y) + '" stroke="' + T.rule + '"/>');
        out.push(text(0, y + 22, r.label, { size: 14 }));
        r.cells.forEach(function (c, i) {
          var right = labelW + (i + 1) * colW - 6, tw = textW(c.text, 13, true);
          out.push(text(right, y + 22, c.text, { size: 13, mono: true, anchor: 'end' }));
          if (c.frac) out.push(rect(right - tw - 8 - 60 * Math.min(1, c.frac), y + 14, 60 * Math.min(1, c.frac), 7, c.color));
        });
      });
      return out.join('');
    });
  }

  /* ---- horizontal bars with labels and an optional reference line:
     rows [{ name, frac, text, color, small }], ref { frac, text } */
  function hbars(o) {
    var W = 900, labelW = 300, valW = 80, rh = 18, gap = 6;
    var bodyH = (o.ref ? 22 : 0) + o.rows.length * (rh + gap);
    return doc(W, bodyH, o, function (inner) {
      var out = [], track = inner - labelW - valW - 10, y0 = o.ref ? 22 : 0;
      o.rows.forEach(function (r, i) {
        var y = y0 + i * (rh + gap);
        out.push(text(labelW - 8, y + 13, r.name, { size: 12, anchor: 'end' }), rect(labelW, y, track, rh, T.track));
        if (r.frac !== null && r.frac !== undefined) {
          out.push(rect(labelW, y, track * Math.min(1, r.frac), rh, r.color || '#ff8c2e'));
          if (r.small) out.push(rect(labelW, y, track * Math.min(1, r.frac), rh, 'url(#hatch-dark)'));
        }
        out.push(text(inner, y + 13, r.text, { size: 12, mono: true, anchor: 'end' }));
      });
      if (o.ref && o.ref.frac !== null && o.ref.frac !== undefined) {
        var x = labelW + track * Math.min(1, o.ref.frac);
        out.push('<line x1="' + n(x) + '" x2="' + n(x) + '" y1="16" y2="' + n(bodyH) + '" stroke="' + T.ink + '" stroke-dasharray="4 3" stroke-width="1.5"/>');
        out.push(text(x + 4, 12, o.ref.text, { size: 12, mono: true }));
      }
      return out.join('');
    });
  }
  /* ---- 100% bars: keys [{ label, color }], rows [{ name, parts: [share], text }] */
  function stacks(o) {
    var W = 1000, labelW = 300, rh = 16, gap = 8;
    var bodyH = 26 + o.rows.length * (rh + gap);
    return doc(W, bodyH, o, function (inner) {
      var out = [], lx = 0, track = inner - labelW;
      o.keys.forEach(function (k) {
        out.push(rect(lx, 2, 10, 10, k.color), text(lx + 14, 11, k.label, { size: 11, fill: T.soft }));
        lx += 26 + textW(k.label, 11);
      });
      o.rows.forEach(function (r, i) {
        var y = 26 + i * (rh + gap), x = labelW;
        out.push(text(labelW - 8, y + 12, r.name, { size: 12, anchor: 'end' }));
        if (!r.parts) { out.push(text(labelW, y + 12, r.text, { size: 12, mono: true, fill: T.muted })); return; }
        r.parts.forEach(function (p, j) { var w = track * (p || 0); out.push(rect(x, y, w, rh, o.keys[j].color)); x += w; });
      });
      return out.join('');
    });
  }

  /* ---- browser only: save an SVG string as a file */
  function download(svg, filename) {
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { document: doc, wrap: wrap, hbars: hbars, stacks: stacks, esc: esc, sparkline: sparkline, scoreboard: scoreboard, heatmap: heatmap, bars: bars, reasons: reasons, download: download, TOKENS: T };
});
