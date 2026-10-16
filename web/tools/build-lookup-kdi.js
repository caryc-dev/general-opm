#!/usr/bin/env node
/* Write web/assets/lookup-kdi.json: the active scope rows of pipeline/known_data_issues.csv that touch a Look-Up field,
   so the Look-Up can mark values in a known data issue's scope (shown as published, never changed). pipeline/ is not
   served. Usage: node web/tools/build-lookup-kdi.js [--check] */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./build-known-breaks.js');

const WEB = path.resolve(__dirname, '..');
const REPO = path.resolve(WEB, '..');
const SRC = path.join(REPO, 'pipeline', 'known_data_issues.csv');
const FIELDS = path.join(REPO, 'pipeline', 'crosswalks', 'lookup_fields.csv');
const OUT = path.join(WEB, 'assets', 'lookup-kdi.json');

function build() {
  const fields = {};
  parseCsv(fs.readFileSync(FIELDS, 'utf8')).forEach(r => { (fields[r.dataset] = fields[r.dataset] || []).push(r.lookup_column); });
  const rows = parseCsv(fs.readFileSync(SRC, 'utf8')).filter(r => r.status === 'active')
    .filter(r => r.field === '*' || ['separations', 'accessions', 'employment'].some(d => (fields[d] || []).includes(r.field)))
    .map(r => ({ id: r.id, dataset: r.dataset, field: r.field, first: r.first_file_month.replace('-', ''), last: (r.last_file_month || '9999-12').replace('-', ''),
      level: r.entity_level, entities: r.entities ? r.entities.split(';') : [], min: r.value_min === '' ? null : +r.value_min, max: r.value_max === '' ? null : +r.value_max, treatment: r.treatment }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { _note: 'Written by web/tools/build-lookup-kdi.js from pipeline/known_data_issues.csv (active rows on Look-Up fields). Do not edit by hand.', rows };
}
function text() { return JSON.stringify(build(), null, 1) + '\n'; }

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const ok = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text();
    console.log(ok ? 'lookup-kdi.json is current' : 'lookup-kdi.json is not current; run node web/tools/build-lookup-kdi.js');
    process.exit(ok ? 0 : 1);
  }
  fs.writeFileSync(OUT, text());
  console.log('wrote ' + path.relative(REPO, OUT) + ' (' + build().rows.length + ' rows)');
}
module.exports = { build, text, OUT };
