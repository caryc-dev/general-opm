#!/usr/bin/env node
/* Local development server, for preview and tests. Serves web/ and maps the promoted data layout onto the staged
   files, read-only:
     /data/lookup/...  -> warehouse/lookup/...
     /data/lookup.meta.json -> warehouse/lookup/lookup.meta.json (beside the folder, as its file paths 'lookup/...' read)
     /data/...         -> warehouse/cubes/...
     everything else   -> web/...
   Nothing is copied into web/data/. Only GET and HEAD; no directory listings; paths cannot leave their root.
   Usage: node web/tools/dev-server.js [--port 8000] [--host 127.0.0.1] [--cubes <dir>] [--lookup <dir>] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const REPO = path.resolve(WEB, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.parquet': 'application/octet-stream', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2' };

function roots(opts) {
  return [
    { exact: '/data/lookup.meta.json', file: path.join(path.resolve(opts.lookup || path.join(REPO, 'warehouse', 'lookup')), 'lookup.meta.json') },
    { prefix: '/data/lookup/', dir: path.resolve(opts.lookup || path.join(REPO, 'warehouse', 'lookup')) },
    { prefix: '/data/', dir: path.resolve(opts.cubes || path.join(REPO, 'warehouse', 'cubes')) },
    { prefix: '/', dir: WEB }
  ];
}

/* URL path -> file on disk, or null when it is outside its root or not a file */
function resolve(urlPath, rts) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch (e) { return null; }
  if (p.indexOf('\0') >= 0) return null;
  if (p.endsWith('/')) p += 'index.html';
  for (const r of rts) {
    if (r.exact) { if (p === r.exact) { try { return fs.statSync(r.file).isFile() ? r.file : null; } catch (e) { return null; } } continue; }
    if (!p.startsWith(r.prefix)) continue;
    const file = path.resolve(r.dir, '.' + path.sep + p.slice(r.prefix.length));
    if (file !== r.dir && !file.startsWith(r.dir + path.sep)) return null;
    if (r.prefix === '/' && file.startsWith(path.join(WEB, 'data') + path.sep)) return null; // /data/ is always the staged files here
    try { if (fs.statSync(file).isFile()) return file; } catch (e) { /* fall through */ }
    return null;
  }
  return null;
}

function createServer(opts = {}) {
  const rts = roots(opts);
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const file = resolve(req.url, rts);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const size = fs.statSync(file).size;
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const port = +arg('--port', 8000), host = arg('--host', '127.0.0.1');
  const opts = { cubes: arg('--cubes'), lookup: arg('--lookup') };
  createServer(opts).listen(port, host, () => {
    const r = roots(opts);
    console.log('serving http://' + host + ':' + port + '/  (web: ' + path.relative(REPO, r[3].dir) + ', /data/: ' + path.relative(REPO, r[2].dir) + ', /data/lookup/: ' + path.relative(REPO, r[1].dir) + ', read-only)');
  });
}
module.exports = { createServer, resolve, roots };
