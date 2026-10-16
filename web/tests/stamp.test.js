'use strict';
/* Every served file is recorded at the current stamp and every local asset URL carries ?v=<stamp>. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../tools/stamp-lib.js');
const { bump } = require('../tools/bump-stamp.js');

test('the stamp is current (else run node web/tools/bump-stamp.js)', () => {
  assert.deepEqual(S.checkStamp(), []);
});

test('scripts fetch through the stamped helper', () => {
  const shell = fs.readFileSync(path.join(S.WEB_DIR, 'assets', 'js', 'shell.js'), 'utf8');
  assert.match(shell, /fetch\(asset\(url\)\)/);
  for (const f of fs.readdirSync(path.join(S.WEB_DIR, 'assets', 'js'))) {
    const js = fs.readFileSync(path.join(S.WEB_DIR, 'assets', 'js', f), 'utf8');
    assert.ok(!/\bfetch\((?!(S\.)?asset\()/.test(js), f + ' fetches without the stamp');
  }
});

test('bump stamps a page and its assets, and a change without a bump is caught', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), '1');
  fs.writeFileSync(path.join(dir, 'index.html'), '<meta name="opm-build" content=""><script src="assets/a.js"></script><a href="other.html">x</a>');
  const r = bump(dir, false, new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
  assert.equal(r.stamp, '20260102-030405');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /assets\/a\.js\?v=20260102-030405/);
  assert.match(html, /href="other\.html"/);
  assert.deepEqual(S.checkStamp(dir), []);
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), '2');
  assert.equal(S.checkStamp(dir).length, 1);
});
