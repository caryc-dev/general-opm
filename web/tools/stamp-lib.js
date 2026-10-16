/* Cache-busting stamp: one build stamp on every served asset URL.
   web/build-stamp.json records the stamp and a SHA-256 of every served file as of that stamp. If a served file's
   hash no longer matches, the file changed without a bump: checkStamp() reports it and web/tests/stamp.test.js
   fails. Fix: node web/tools/bump-stamp.js. Scripts append the same stamp to the files they fetch (shell.asset). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEB_DIR = path.resolve(__dirname, '..');
const RECORD = 'build-stamp.json';
// not served as part of the site: dev tools, tests, screenshots, the record itself, notes
const EXCLUDE_DIRS = new Set(['tests', 'tools', '_screens', 'node_modules']);
const EXCLUDE_FILES = new Set([RECORD, 'README.md']);

const META_RE = /(<meta name="opm-build" content=")([^"]*)(")/;
const ATTR_RE = /\b(src|href)="([^"]+)"/g;

function servedFiles(dir = WEB_DIR) {
  const out = [];
  (function walk(rel) {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { if (!(rel === '' && EXCLUDE_DIRS.has(ent.name))) walk(r); }
      else if (!(rel === '' && EXCLUDE_FILES.has(ent.name))) out.push(r);
    }
  })('');
  return out.sort();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function hashFiles(dir = WEB_DIR) { const h = {}; for (const f of servedFiles(dir)) h[f] = sha256(path.join(dir, f)); return h; }
function readRecord(dir = WEB_DIR) { const p = path.join(dir, RECORD); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function writeRecord(dir, stamp, files) {
  const rec = { _note: 'Written by web/tools/bump-stamp.js. Do not edit by hand.', stamp, files };
  fs.writeFileSync(path.join(dir, RECORD), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}
function diffHashes(recorded, current) {
  const changed = [], added = [], removed = [];
  for (const f of Object.keys(current)) { if (!(f in recorded)) added.push(f); else if (recorded[f] !== current[f]) changed.push(f); }
  for (const f of Object.keys(recorded)) if (!(f in current)) removed.push(f);
  return { changed, added, removed, any: changed.length + added.length + removed.length > 0 };
}
function isLocalAsset(url) { return !/^(https?:|\/\/|#|mailto:|data:|javascript:)/i.test(url) && !/\.html(\?|#|$)/.test(url); }
function localAssets(html) {
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(html))) {
    if (!isLocalAsset(m[2])) continue;
    const q = /[?&]v=([^&#]*)/.exec(m[2]);
    out.push({ url: m[2], base: m[2].split('?')[0], v: q ? q[1] : null });
  }
  return out;
}
function stampHtml(html, stamp) {
  return html.replace(META_RE, (_, a, _old, c) => a + stamp + c)
    .replace(ATTR_RE, (all, attr, url) => isLocalAsset(url) ? attr + '="' + url.split('?')[0] + '?v=' + stamp + '"' : all);
}
function applyStamp(dir, stamp) {
  for (const f of servedFiles(dir).filter(f => f.endsWith('.html'))) {
    const p = path.join(dir, f), before = fs.readFileSync(p, 'utf8'), after = stampHtml(before, stamp);
    if (after !== before) fs.writeFileSync(p, after);
  }
}
function newStamp(date = new Date()) { return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); } // YYYYMMDD-HHMMSS UTC

/* Every problem that would make a browser serve a stale file. Empty list = pass. */
function checkStamp(dir = WEB_DIR) {
  const problems = [], rec = readRecord(dir);
  if (!rec || !rec.stamp || !rec.files) return ['no ' + RECORD + '; run node web/tools/bump-stamp.js'];
  const d = diffHashes(rec.files, hashFiles(dir));
  if (d.any) problems.push('served files changed but the stamp did not (' + rec.stamp + '): ' +
    [...d.changed.map(f => 'changed ' + f), ...d.added.map(f => 'added ' + f), ...d.removed.map(f => 'removed ' + f)].join(', ') + '. Run node web/tools/bump-stamp.js');
  for (const f of servedFiles(dir).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8'), meta = META_RE.exec(html);
    if (!meta) problems.push(f + ': no <meta name="opm-build">');
    else if (meta[2] !== rec.stamp) problems.push(f + ': meta stamp ' + meta[2] + ' is not ' + rec.stamp);
    for (const a of localAssets(html)) {
      if (a.v !== rec.stamp) problems.push(f + ': ' + a.url + ' does not carry ?v=' + rec.stamp);
      if (!fs.existsSync(path.join(dir, path.dirname(f), a.base))) problems.push(f + ': ' + a.base + ' does not exist');
    }
  }
  return problems;
}

module.exports = { WEB_DIR, RECORD, servedFiles, hashFiles, readRecord, writeRecord, diffHashes, localAssets, stampHtml, applyStamp, newStamp, checkStamp };
