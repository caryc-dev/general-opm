#!/usr/bin/env node
/* Bump the build stamp after changing any served file under web/.
   Usage: node web/tools/bump-stamp.js [--force] [--dir <web dir>]
   Without --force it keeps the stamp when no served file changed. */
'use strict';
const path = require('path');
const S = require('./stamp-lib.js');

function bump(dir, force, now) {
  const rec = S.readRecord(dir);
  if (rec && !force && !S.diffHashes(rec.files, S.hashFiles(dir)).any && S.checkStamp(dir).length === 0) return { bumped: false, stamp: rec.stamp };
  let stamp = S.newStamp(now);
  if (rec && stamp <= rec.stamp) stamp = rec.stamp + 'b'; // stamps only move forward
  S.applyStamp(dir, stamp);
  S.writeRecord(dir, stamp, S.hashFiles(dir));
  return { bumped: true, stamp, previous: rec ? rec.stamp : null };
}

if (require.main === module) {
  const args = process.argv.slice(2), di = args.indexOf('--dir');
  const r = bump(di >= 0 ? path.resolve(args[di + 1]) : S.WEB_DIR, args.includes('--force'));
  console.log(r.bumped ? 'stamp ' + (r.previous || '(none)') + ' -> ' + r.stamp : 'no served file changed; stamp stays ' + r.stamp);
}
module.exports = { bump };
