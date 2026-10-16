'use strict';
/* Copy discipline: copy.json holds the approved strings of docs/page-spec.md word for word, plain text only, and
   every key the code asks for exists. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WEB, specTable, allSpecCopy } = require('./_spec.js');

const copy = JSON.parse(fs.readFileSync(path.join(WEB, 'copy.json'), 'utf8'));
const strings = copy.strings;

test('every key of page-spec 6.1 (shell) and 6.2 (page 1) is in copy.json with the exact text', () => {
  for (const sec of ['6.1 Shell', '6.2 Page 1, Administrations']) {
    const spec = specTable(sec);
    assert.ok(Object.keys(spec).length > 5, sec + ' parsed');
    for (const [k, v] of Object.entries(spec)) assert.equal(strings[k], v, sec + ': ' + k);
  }
});

test('every key of page-spec 8.0 to 8.9 (pages 2 to 9) is in copy.json with the exact text', () => {
  const { SPEC } = require('./_spec.js');
  const heads = SPEC.split('\n').filter(l => /^### 8\.\d+ /.test(l)).map(l => l.slice(4));
  assert.deepEqual(heads.map(x => x.split(' ')[0]), ['8.0', '8.1', '8.2', '8.3', '8.4', '8.5', '8.6', '8.7', '8.8', '8.9']);
  let n = 0;
  for (const sec of heads) for (const [k, v] of Object.entries(specTable(sec))) { assert.equal(strings[k], v, sec + ': ' + k); n++; }
  assert.ok(n > 250, 'section 8 keys: ' + n);
});

test('no key appears twice in the page-spec copy tables with different text', () => {
  const { SPEC } = require('./_spec.js');
  const seen = {};
  for (const sec of SPEC.split('\n').filter(l => /^### [68]\.\d+ /.test(l)).map(l => l.slice(4))) {
    for (const [k, v] of Object.entries(specTable(sec))) { if (k in seen) assert.equal(v, seen[k], k); seen[k] = v; }
  }
});

test('every key in copy.json is a key of a page-spec copy table, word for word', () => {
  const spec = allSpecCopy();
  for (const [k, v] of Object.entries(strings)) {
    assert.ok(k in spec, k + ' is not in page-spec sections 6 or 8');
    assert.equal(v, spec[k], k);
  }
});

test('copy.json is plain text: no markup, no links', () => {
  for (const [k, v] of Object.entries(strings)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(!/[<>]/.test(v), k + ' has markup');
    assert.ok(!/https?:|www\.|\]\(/i.test(v), k + ' has a link');
  }
});

test('every copy key named in the page scripts exists', () => {
  const js = fs.readdirSync(path.join(WEB, 'assets', 'js')).filter(f => /^(shell|page-.*)\.js$/.test(f)).map(f => fs.readFileSync(path.join(WEB, 'assets', 'js', f), 'utf8')).join('\n');
  const keys = new Set();
  for (const m of js.matchAll(/\bt\('([a-z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of js.matchAll(/'((?:p\d|shell|shared|group|dim)\.[a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  assert.ok(keys.size > 30, 'found ' + keys.size);
  for (const k of keys) {
    // a key prefix completed in code (p1.heat.sub. + metric, p9.issues.kdi + number) must start a real key
    if (!(k in strings)) assert.ok(/[.a-z]$/.test(k) && Object.keys(strings).some(x => x.startsWith(k) && x !== k), 'missing ' + k);
  }
  for (let i = 1; i <= 10; i++) assert.ok('p9.issues.kdi' + String(i).padStart(3, '0') in strings);
  // keys built from a prefix: every completion exists
  for (const m of ['change', 'dep', 'hire', 'drp']) assert.ok('p1.heat.sub.' + m in strings);
  for (const r of ['drp', 'transfer', 'quit', 'retire', 'rif', 'term', 'other']) assert.ok('p1.reason.' + r in strings);
});

test('the HTML title is the site name, and pages carry no hard-coded visible text', () => {
  for (const f of fs.readdirSync(WEB).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], strings['shell.site_name'], f);
    const body = html.split(/<body[^>]*>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.equal(body, '', f + ' has text outside copy.json: ' + body);
  }
});

test('the nine page tabs come from shell.nav, in the order of page-spec section 2', () => {
  assert.deepEqual(strings['shell.nav'].split(' · '), ['Administrations', 'Workforce size', 'Hiring and departures', 'Departments compared',
    'Who is leaving', 'Who is joining', 'Appointments', 'Look-Up', 'Reading the data']);
});
