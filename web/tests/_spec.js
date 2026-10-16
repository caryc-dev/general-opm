'use strict';
/* Read-only helpers for tests: the copy tables of docs/page-spec.md and the staged cube files. */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const REPO = path.join(WEB, '..');
const SPEC = fs.readFileSync(path.join(REPO, 'docs', 'page-spec.md'), 'utf8');

/* the "| key | text |" rows of one "### <heading>" section */
function specTable(heading) {
  const parts = SPEC.split('\n### ' + heading + '\n');
  if (parts.length !== 2) throw new Error('page-spec has no section ' + heading);
  const sec = parts[1].split(/\n#{2,3} /)[0], out = {};
  for (const line of sec.split('\n')) {
    const m = /^\| ([a-zA-Z0-9._]+) \| (.+) \|$/.exec(line.trim());
    if (m && m[1] !== 'Key') out[m[1]] = m[2];
  }
  return out;
}
/* every copy table of sections 6 and 8 */
function allSpecCopy() {
  const heads = SPEC.split('\n').filter(l => /^### [68]\.\d+ /.test(l)).map(l => l.slice(4));
  return Object.assign({}, ...heads.map(specTable));
}
const CUBES = process.env.OPM_CUBES || path.join(REPO, 'warehouse', 'cubes');
function cube(rel) { return JSON.parse(fs.readFileSync(path.join(CUBES, rel), 'utf8')); }
function haveCubes() { return fs.existsSync(path.join(CUBES, 'admin.meta.json')) && fs.existsSync(path.join(CUBES, 'matrix', 'matrix.json')); }

module.exports = { WEB, REPO, SPEC, specTable, allSpecCopy, cube, haveCubes, CUBES };
