'use strict';
/* Text contrast of at least 4.5:1 (WCAG 1.4.3) for the design tokens where text sits on them, the heat map cells
   (with their hatching), the administration colors, and the color-only marks at 3:1. Read from the files. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../assets/js/admin-model.js');
const { WEB } = require('./_spec.js');

const css = fs.readFileSync(path.join(WEB, 'assets', 'css', 'site.css'), 'utf8');
function token(name) { const m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(css); if (!m) throw new Error('no token --' + name); return m[1]; }
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function lum(c) { return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]); }
function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function blend(bg, over, alpha) { return bg.map((v, i) => v * (1 - alpha) + over[i] * alpha); }

const TEXT = [['ink', 'bg'], ['ink', 'panel'], ['ink', 'bg-header'], ['muted', 'bg'], ['muted', 'panel'], ['muted', 'bg-header'], ['ink-soft', 'panel'],
  ['link', 'bg'], ['link', 'panel'], ['tab-on-ink', 'tab-on-bg'], ['ink', 'nav-on-bg'], ['loss', 'panel'],
  ['admin-obama2', 'panel'], ['admin-trump1', 'panel'], ['admin-biden', 'panel'], ['admin-trump2', 'panel']];

test('text tokens reach 4.5:1 where text sits on them', () => {
  for (const [fg, bg] of TEXT) { const r = ratio(rgb(token(fg)), rgb(token(bg))); assert.ok(r >= 4.5, fg + ' on ' + bg + ': ' + r.toFixed(2)); }
});

test('control borders and the focus ring reach 3:1', () => {
  for (const [fg, bg] of [['control-border', 'bg'], ['control-border', 'panel'], ['focus', 'bg'], ['focus', 'panel']]) {
    const r = ratio(rgb(token(fg)), rgb(token(bg))); assert.ok(r >= 3, fg + ' on ' + bg + ': ' + r.toFixed(2));
  }
});

test('every heat map cell reaches 4.5:1, plain and hatched', () => {
  const white = [255, 255, 255], dark = rgb('#0d1117');
  for (const [metric, bins] of Object.entries(M.BINS)) {
    for (const b of bins) {
      const bg = rgb(b.bg), fg = rgb(b.fg);
      assert.ok(ratio(fg, bg) >= 4.5, metric + ' ' + b.label + ': ' + ratio(fg, bg).toFixed(2));
      // hatching: light stripes under dark text, dark stripes under light text (page-admin.js, svg.js)
      const stripe = b.fg.toLowerCase() === '#0d1117' ? blend(bg, white, 0.22) : blend(bg, dark, 0.3);
      assert.ok(ratio(fg, stripe) >= 4.5, metric + ' ' + b.label + ' hatched: ' + ratio(fg, stripe).toFixed(2));
    }
  }
  assert.ok(ratio(rgb(M.NA_STYLE.fg), rgb(token('bg'))) >= 4.5, 'n/a cells');
});
