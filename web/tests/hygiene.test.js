'use strict';
/* Public-site hygiene: no em dash anywhere under web/, and served files name no publisher, no tool and no former
   look. Terms are built from parts so this file does not contain them. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../tools/stamp-lib.js');
const { WEB } = require('./_spec.js');

const TEXT = /\.(html|js|mjs|css|json|md|txt|svg|csv)$/;
function allFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...allFiles(dir, r)); else out.push(r);
  }
  return out;
}

test('no em dash in any file under web/', () => {
  const EM = String.fromCharCode(0x2014);
  for (const f of allFiles(WEB).filter(f => TEXT.test(f))) {
    assert.ok(!fs.readFileSync(path.join(WEB, f), 'utf8').includes(EM), f);
  }
});

test('served files do not mention the publisher, tools or the former look', () => {
  const terms = [
    new RegExp(['Justice', 'Connection'].join('\\s+'), 'i'),
    new RegExp('\\b' + ['LI', 'ONS'].join('') + '\\b'),
    new RegExp('\\b' + ['Fra', 'mer'].join('') + '\\b', 'i'),
    new RegExp('\\b' + ['Cla', 'ude'].join('') + '\\b', 'i'),
    new RegExp('\\b' + ['A', 'I'].join('') + '\\b'),
    new RegExp(['Anci', 'zar'].join(''), 'i'),
    new RegExp('#' + ['eaf5', '4c'].join(''), 'i')
  ];
  const served = S.servedFiles();
  assert.ok(served.length >= 15, 'served files found: ' + served.length);
  for (const f of served.filter(f => TEXT.test(f))) {
    const s = fs.readFileSync(path.join(WEB, f), 'utf8');
    for (const re of terms) assert.ok(!re.test(s), f + ' matches ' + re);
  }
});

test('nothing under web/data/ (cubes are not promoted)', () => {
  assert.ok(!fs.existsSync(path.join(WEB, 'data')), 'web/data exists');
});
