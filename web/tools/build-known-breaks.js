#!/usr/bin/env node
/* Write web/assets/known-breaks.json for page 9 (Reading the data) from the signed list pipeline/known_breaks.csv,
   with each entity-year's name, gap and gap as a percent of average employees taken from the cube build's
   warehouse/cubes/known_breaks_candidates.csv (values copied, not computed). pipeline/ is not served.
   Usage: node web/tools/build-known-breaks.js [--check]   (--check: exit 1 if the file is not current) */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const REPO = path.resolve(WEB, '..');
const SIGNED = path.join(REPO, 'pipeline', 'known_breaks.csv');
const CANDIDATES = path.join(REPO, 'warehouse', 'cubes', 'known_breaks_candidates.csv');
const OUT = path.join(WEB, 'assets', 'known-breaks.json');

/* RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function build() {
  const signed = parseCsv(fs.readFileSync(SIGNED, 'utf8'));
  const cand = new Map(parseCsv(fs.readFileSync(CANDIDATES, 'utf8')).map(r => [r.entity + '|' + r.fiscal_year, r]));
  const rows = signed.map(s => {
    const c = cand.get(s.entity + '|' + s.fiscal_year);
    if (!c) throw new Error('no candidate row for ' + s.entity + ' FY' + s.fiscal_year);
    return { entity: s.entity, fiscal_year: +s.fiscal_year, name: c.name, gap: +c.gap, gap_pct: +c.gap_pct, decision: s.decision };
  });
  return { _note: 'Written by web/tools/build-known-breaks.js from pipeline/known_breaks.csv (signed) and warehouse/cubes/known_breaks_candidates.csv. Do not edit by hand.',
    gap: 'headcount change minus net flow over the fiscal year (people); gap_pct: as a percent of average month-end employees', rows };
}
function text() { return JSON.stringify(build(), null, 1) + '\n'; }

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const ok = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text();
    console.log(ok ? 'known-breaks.json is current' : 'known-breaks.json is not current; run node web/tools/build-known-breaks.js');
    process.exit(ok ? 0 : 1);
  }
  fs.writeFileSync(OUT, text());
  console.log('wrote ' + path.relative(REPO, OUT) + ' (' + build().rows.length + ' rows)');
}
module.exports = { parseCsv, build, text, OUT, SIGNED, CANDIDATES };
