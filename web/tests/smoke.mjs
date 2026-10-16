#!/usr/bin/env node
/* Browser smoke test. Starts web/tools/dev-server.js (staged cubes at /data/), drives headless Chrome over the
   DevTools protocol (Node's built-in WebSocket; no packages), checks page 1 and the shell, and saves screenshots
   to web/_screens/. Usage: node web/tests/smoke.mjs [--screens <dir>] */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..');
const argv = process.argv;
const SCREENS = argv.includes('--screens') ? path.resolve(argv[argv.indexOf('--screens') + 1]) : path.join(WEB, '_screens');
const { createServer } = require('../tools/dev-server.js');
const COPY = JSON.parse(readFileSync(path.join(WEB, 'copy.json'), 'utf8')).strings;
const NAV = COPY['shell.nav'].split(' · ');
const FILES = ['index.html', 'workforce-size.html', 'hiring-and-departures.html', 'departments-compared.html', 'who-is-leaving.html',
  'who-is-joining.html', 'appointments.html', 'occupations.html', 'look-up.html', 'reading-the-data.html'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); }

const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port, BASE = `http://127.0.0.1:${PORT}/`;
const DBG = 9400 + Math.floor(Math.random() * 300);
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const chromePath = CHROMES.find(existsSync);
if (!chromePath) { console.error('no Chrome found'); process.exit(2); }
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + mkdtempSync(path.join(tmpdir(), 'opm-chrome-')),
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
function cleanup() { try { chrome.kill(); } catch {} try { server.close(); } catch {} }
process.on('exit', cleanup);

async function getJson(url) { for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(250); } throw new Error('no response from ' + url); }
let ws, nextId = 0; const waiting = new Map(); const events = [];
function send(method, params = {}) { const id = ++nextId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => waiting.set(id, { res, rej })); }
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr.slice(0, 160) + ' ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function waitFor(expr, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await evaluate(expr)) return true; } catch {} await sleep(100); } return false; }
async function viewport(width) { await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); }
async function go(url) { await send('Page.navigate', { url }); await sleep(200); return waitFor('document.body && document.body.dataset.ready === "true"'); }
async function shot(file) {
  await sleep(400);
  const m = await send('Page.getLayoutMetrics');
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(m.cssContentSize.width), height: Math.ceil(m.cssContentSize.height), scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
/* the page must never scroll sideways; content inside a scroll box that itself fits does not count */
const noScroll = `(() => {
  const clipped = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX;
    if ((o === 'auto' || o === 'scroll' || o === 'hidden') && a.getBoundingClientRect().right <= window.innerWidth + 0.5) return true; } return false; };
  return { sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !clipped(e)).map(e => e.tagName + '.' + e.className).slice(0, 5) }; })()`;
const text = sel => evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const card = name => evaluate(`(() => { const c = [...document.querySelectorAll('#score .card')].find(c => c.querySelector('.card__name').textContent === ${JSON.stringify(name)});
  return c ? { big: c.querySelector('.card__big').textContent, sub: c.querySelector('.card__sub').textContent, dd: [...c.querySelectorAll('dd')].map(d => d.textContent) } : null; })()`);
const rate = (group, name) => evaluate(`(() => { const r = [...document.querySelectorAll('#rates .bar-row[data-group="${group}"]')].find(r => r.firstChild.textContent === ${JSON.stringify(name)}); return r ? r.querySelector('.bar-val').textContent : null; })()`);

try {
  await getJson(BASE + 'copy.json');
  const page = (await getJson(`http://127.0.0.1:${DBG}/json/list`)).find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') events.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn'].includes(d.params.type)) events.push('console.' + d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(d.params.entry.url || '')) events.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  if (!existsSync(SCREENS)) mkdirSync(SCREENS, { recursive: true });
  const shots = [];

  for (const width of [1280, 390]) {
    await viewport(width);
    events.length = 0;
    check(`${width}: page 1 loads`, await go(BASE + 'index.html'));
    await evaluate('document.fonts.ready.then(() => true)');
    const ns = await evaluate(noScroll);
    check(`${width}: no sideways page scroll`, ns.sw <= ns.iw && ns.wide.length === 0, JSON.stringify(ns));
    check(`${width}: browser tab and header carry the site name`, (await evaluate('document.title')) === COPY['shell.site_name'] && (await text('.site-name')) === COPY['shell.site_name']);
    check(`${width}: ten page tabs in order`, JSON.stringify(await evaluate(`[...document.querySelectorAll('.site-nav a')].map(a => a.textContent)`)) === JSON.stringify(NAV));
    const t2 = await card('Trump II');
    check(`${width}: GOV Trump II card at N=20`, t2 && t2.big === '-12.4%' && t2.sub === '-287,469 employees' && t2.dd[1] === '505,259', JSON.stringify(t2));
    check(`${width}: GOV Trump II departure rate 14.2%, hire rate 6.8%`, (await rate('dep', 'Trump II')) === '14.2%' && (await rate('hire', 'Trump II')) === '6.8%');
    const hr = await evaluate(`[...document.querySelectorAll('#heat-grid tbody tr')].map(r => r.dataset.entity)`);
    check(`${width}: heat map has the government row and 20 departments`, hr.length === 21 && hr[0] === 'GOV', JSON.stringify(hr));
    shots.push(await shot(path.join(SCREENS, `administrations-${width}.png`)));
    check(`${width}: no console errors`, events.length === 0, events.join(' | '));
  }

  // page 1, Department of Justice
  await viewport(1280);
  events.length = 0;
  check('DJ: page loads', await go(BASE + 'index.html?entity=DJ'));
  const dj = await card('Trump II');
  check('DJ Trump II change -9,863 and departures 21,244', dj && dj.sub === '-9,863 employees' && dj.dd[1] === '21,244', JSON.stringify(dj));
  check('DJ Trump II departure rate 11.5%', (await rate('dep', 'Trump II')) === '11.5%');
  check('DJ: its heat map row is highlighted', await evaluate(`!!document.querySelector('#heat-grid tr.is-highlight[data-entity="DJ"]')`));
  check('DJ: every nav link carries the entity', await evaluate(`[...document.querySelectorAll('.site-nav a')].every(a => /[?&]entity=DJ\\b/.test(a.getAttribute('href')))`));
  check('DJ: entity selector shows it', (await evaluate(`document.getElementById('ctl-entity').value`)) === 'DJ');
  check('footer: source link and last updated line', await evaluate(`(() => { const a = document.querySelector('.site-footer a'); return a && a.href === 'https://data.opm.gov/get-data/api-access' && a.textContent === 'OPM Federal Workforce Data'; })()`) &&
    /^Last updated [A-Z][a-z]{2} \d{1,2}, \d{4}\. Data through Aug 2026\.$/.test(await text('.site-footer__updated')), await text('.site-footer__updated'));
  shots.push(await shot(path.join(SCREENS, 'administrations-DJ-1280.png')));

  // every section: a table view and an SVG download
  const frames = await evaluate(`[...document.querySelectorAll('section.frame')].map(s => ({ id: s.id, buttons: [...s.querySelectorAll('.frame__actions button')].map(b => b.textContent) }))`);
  check('four sections, each with Show table and Download SVG', frames.length === 4 && frames.every(f => f.buttons.join('|') === COPY['shell.chart.table'] + '|' + COPY['shell.chart.svg']), JSON.stringify(frames));
  for (const f of frames) {
    const ok = await evaluate(`(() => { const s = document.getElementById('${f.id}'); const b = s.querySelector('.frame__actions button'); b.click();
      const tb = s.querySelector('.frame__table'); const open = !tb.hidden && b.getAttribute('aria-expanded') === 'true' && !!tb.querySelector('table tbody tr'); b.click(); return open && tb.hidden; })()`);
    check(`${f.id}: table view opens and closes`, ok);
    const svg = await evaluate(`(() => { const r = OPM.page.frames['${f.id}'].svg(); const d = new DOMParser().parseFromString(r.svg, 'image/svg+xml');
      return { ok: !d.querySelector('parsererror') && d.documentElement.nodeName === 'svg', nan: /NaN|undefined/.test(r.svg), file: r.filename, size: r.svg.length }; })()`);
    check(`${f.id}: SVG export is well formed`, svg.ok && !svg.nan && /\.svg$/.test(svg.file), JSON.stringify(svg));
  }
  // download really triggers (Blob link click)
  check('Download SVG click raises no error', await evaluate(`(() => { const b = document.querySelectorAll('#heat .frame__actions button')[1]; b.click(); return true; })()`));

  // keyboard: metric tabs move with the arrow keys; sort header is a button
  await evaluate(`document.getElementById('tab-change').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await sleep(150);
  check('keyboard: ArrowRight selects Departure rate and focuses it', await evaluate(`document.activeElement.id === 'tab-dep' && document.getElementById('tab-dep').getAttribute('aria-selected') === 'true' && /metric=dep/.test(location.search)`));
  check('departure rate default sort: latest administration descending', await evaluate(`document.querySelector('#heat-grid th[aria-sort="descending"] button').dataset.sort === 'trump2'`));
  await evaluate(`document.querySelector('#heat-grid button[data-sort="trump2"]').click()`);
  check('sorting toggles with a heading click', await evaluate(`document.querySelector('#heat-grid th[aria-sort="ascending"] button').dataset.sort === 'trump2'`));

  // show all and the D-028 rule: no row of n/a only
  await go(BASE + 'index.html');
  await evaluate(`document.getElementById('ctl-all').click()`);
  const all = await evaluate(`[...document.querySelectorAll('#heat-grid tbody tr')].map(r => [...r.querySelectorAll('td.heat__cell')].map(c => c.textContent))`);
  check('show all: more rows, none with n/a in every column', all.length > 21 && all.every(r => r.some(v => v !== 'n/a')), all.length);
  // Deferred resignations: n/a before Trump II
  await evaluate(`document.getElementById('tab-drp').click()`);
  check('deferred resignation share: n/a before Trump II', await evaluate(`[...document.querySelectorAll('#heat-grid td.heat__cell:not([data-admin="trump2"])')].every(c => c.textContent === 'n/a')`));
  // fewer administrations limit N
  await go(BASE + 'index.html?admins=obama2,trump1');
  check('two full terms: N runs to 48 and the limit note is hidden', (await evaluate(`document.getElementById('ctl-months').options.length`)) === 48 && await evaluate(`document.querySelector('.controls .field__note[hidden]') !== null`));
  // Defense view
  await go(BASE + 'index.html?entity=DOD-AR');
  check('Defense agency: Defense first, then its 4 agencies, the agency highlighted', (await evaluate(`[...document.querySelectorAll('#heat-grid tbody tr')].map(r => r.dataset.entity)`)).join() .replace(/^DOD,/, 'DOD|').split('|').map((x, i) => i ? x.split(',').sort().join() : x).join('|') === 'DOD|DOD-AF,DOD-AR,DOD-DD,DOD-NV' &&
    await evaluate(`!!document.querySelector('#heat-grid tr.is-highlight[data-entity="DOD-AR"]')`));

  // pages 2 to 4 and 9 at both widths: loads, no sideways scroll, every section's table view and SVG, figures
  const tile = name => evaluate(`(() => { const t = [...document.querySelectorAll('.tile')].find(t => t.querySelector('.tile__name').textContent === ${JSON.stringify(name)}); return t ? t.querySelector('.tile__value').textContent : null; })()`);
  async function frameChecks(label) {
    const fr = await evaluate(`[...document.querySelectorAll('section.frame')].filter(s => !s.hidden).map(s => s.id)`);
    let ok = fr.length > 0, detail = [];
    for (const id of fr) {
      const r = await evaluate(`(() => { const s = document.getElementById('${id}'); const bs = [...s.querySelectorAll(':scope > .frame__actions button')];
        if (bs.length !== 2 || bs[0].textContent !== ${JSON.stringify(COPY['shell.chart.table'])} || bs[1].textContent !== ${JSON.stringify(COPY['shell.chart.svg'])}) return 'buttons';
        bs[0].click(); const tb = s.querySelector(':scope > .frame__table'); const open = !tb.hidden && !!tb.querySelector('table, p'); bs[0].click(); if (!open || !tb.hidden) return 'table';
        const f = OPM.page.frames[Object.keys(OPM.page.frames).find(k => OPM.page.frames[k].el === s)]; const x = f.svg();
        const d = new DOMParser().parseFromString(x.svg, 'image/svg+xml'); if (d.querySelector('parsererror') || /NaN|undefined/.test(x.svg)) return 'svg'; return 'ok'; })()`);
      if (r !== 'ok') { ok = false; detail.push(id + ':' + r); }
    }
    check(`${label}: ${fr.length} sections, each with table view and SVG download`, ok, detail.join(' '));
  }
  // [file, nav position, title key]
  const BUILT = [['workforce-size.html', 1, 'p2'], ['hiring-and-departures.html', 2, 'p3'], ['departments-compared.html', 3, 'p4'], ['who-is-leaving.html', 4, 'p5'], ['who-is-joining.html', 5, 'p6'],
    ['appointments.html', 6, 'p7'], ['occupations.html', 7, 'p10'], ['look-up.html', 8, 'p8'], ['reading-the-data.html', 9, 'p9']];
  for (const width of [1280, 390]) {
    await viewport(width);
    for (const [file, i, pk] of BUILT) {
      events.length = 0;
      check(`${width} ${file}: loads`, await go(BASE + file));
      await evaluate('document.fonts.ready.then(() => true)');
      const ns2 = await evaluate(noScroll);
      check(`${width} ${file}: no sideways page scroll`, ns2.sw <= ns2.iw && ns2.wide.length === 0, JSON.stringify(ns2));
      check(`${width} ${file}: title and tab`, (await text('main h1')) === COPY[pk + '.title'] && (await text('.site-nav a[aria-current="page"]')) === NAV[i]);
      if (file !== 'reading-the-data.html' && file !== 'look-up.html') await frameChecks(`${width} ${file}`);
      shots.push(await shot(path.join(SCREENS, file.replace('.html', '') + `-${width}.png`)));
      check(`${width} ${file}: no console errors`, events.length === 0, events.join(' | '));
    }
  }
  await viewport(1280);
  await go(BASE + 'workforce-size.html');
  check('page 2 GOV: Employees 2,024,832, change over 12 months -193,729', (await tile(COPY['p2.tile.headcount'])) === '2,024,832' && (await tile(COPY['p2.tile.change12'])) === '-193,729');
  await go(BASE + 'workforce-size.html?entity=AF02&view=month');
  check('page 2 keeps a subelement in the URL and shows it', /entity=AF02/.test(await evaluate('location.search')) && (await evaluate(`document.querySelector('.field--entity select').value`)) === 'AF02' &&
    await evaluate(`document.getElementById('children').hidden`));
  await go(BASE + 'hiring-and-departures.html');
  check('page 3 GOV: departures, past 12 months 329,623', (await tile(COPY['p3.tile.departures'])) === '329,623');
  await evaluate(`document.querySelector('#rates .seg button[data-value="b"]').click()`);
  await evaluate(`document.querySelector('.seg button[data-value="month"]').click()`);
  check('page 3: fiscal-year rate in the Monthly view says it is Yearly only', (await text('#rates .frame__body')) === COPY['shared.rate.none']);
  await go(BASE + 'departments-compared.html');
  check('page 4 GOV FY2026: the government row first, departures 196,674', await evaluate(`(() => { const r = document.querySelector('#cmp-table tbody tr'); return r.classList.contains('is-pinned') && r.children[3].textContent === '196,674'; })()`));
  check('page 4 GOV: heat map shows 20 departments of 5,000 or more and the government', (await evaluate(`document.querySelectorAll('#cmp-heat tbody tr').length`)) === 21);
  await go(BASE + 'departments-compared.html?view=t12');
  const t12rows = await evaluate(`[...document.querySelectorAll('#cmp-table tbody tr')].map(r => [...r.children].map(c => c.textContent))`);
  const ipRow = t12rows.find(r => /intellectual property enforcement/i.test(r[0])), reRow = t12rows.find(r => /navajo and hopi/i.test(r[0]));
  check('page 4 past 12 months (D-034): 127 departments and the government row', t12rows.length === 128, t12rows.length);
  check('page 4 past 12 months: IP and RE shown with 0 employees, departures 2 and 14, small-base rates', !!ipRow && !!reRow &&
    ipRow[1] === '0' && ipRow[3] === '2' && reRow[1] === '0' && reRow[3] === '14' && / \*$/.test(ipRow[6]) && / \*$/.test(reRow[6]), JSON.stringify([ipRow, reRow]));
  check('page 4 past 12 months: departments sum to the government row (employees, hires, departures)', [1, 2, 3].every(i => t12rows.slice(1).reduce((s, r) => s + Number(r[i].replace(/,/g, '')), 0) === Number(t12rows[0][i].replace(/,/g, ''))),
    JSON.stringify(t12rows[0]));
  await evaluate(`document.querySelector('#ranking .frame__head > button').click()`);
  await evaluate(`document.querySelector('#reasons .frame__head > button').click()`);
  check('page 4 past 12 months, show all: ranking and reasons list every department, no NaN', (await evaluate(`document.querySelectorAll('#ranking .hbar-row').length`)) === 127 &&
    (await evaluate(`document.querySelectorAll('#reasons .hbar-row').length`)) === 127 && !/NaN|undefined/.test(await text('main')));
  await frameChecks('page 4 past 12 months, show all');
  await go(BASE + 'departments-compared.html?entity=DOD');
  check('page 4 Defense: its 4 agencies', JSON.stringify((await evaluate(`[...document.querySelectorAll('#cmp-heat tbody tr')].map(r => r.dataset.entity)`)).slice(1).sort()) === JSON.stringify(['DOD-AF', 'DOD-AR', 'DOD-DD', 'DOD-NV']));
  await go(BASE + 'departments-compared.html?entity=AF02');
  check('page 4 falls back to the government for a subelement', (await evaluate(`document.querySelector('.field--entity select').value`)) === 'GOV' && !/entity=/.test(await evaluate('location.search')));
  await go(BASE + 'reading-the-data.html');
  check('page 9: eleven known data issues (KDI-011 last) and 78 known breaks', (await evaluate(`document.querySelectorAll('.kdi-list li').length`)) === 11 &&
    (await text('#kdi-011')) === 'KDI-011 ' + COPY['p9.issues.kdi011'] && (await evaluate(`document.querySelectorAll('#known-breaks tbody tr').length`)) === 78);
  check('page 9: every section has its anchor', await evaluate(`['data-origin','counting','rates','known-data-issues','known-breaks','withheld-values','revised-files'].every(id => !!document.getElementById(id))`));

  // page 10, Occupations (figures: the occupations cube, GOV, 12 months to Aug 2026; see web/tests/occ.test.js)
  events.length = 0;
  await go(BASE + 'occupations.html');
  check('page 10 GOV: tiles hires 160,466, departures 329,623, 551 series with hires, 636 with departures', (await tile(COPY['p10.tile.hires'])) === '160,466' &&
    (await tile(COPY['p10.tile.departures'])) === '329,623' && (await tile(COPY['p10.tile.withHires'])) === '551' && (await tile(COPY['p10.tile.withDepartures'])) === '636');
  const codes = sel => evaluate(`[...document.querySelectorAll('${sel} .occ-row')].map(r => r.dataset.code)`);
  check('page 10 GOV: most hired 1801, 0610, 0303, 0456, 0301; 25 rows', JSON.stringify((await codes('#occ-hires')).slice(0, 5)) === '["1801","0610","0303","0456","0301"]' && (await codes('#occ-hires')).length === 25);
  check('page 10 GOV: most departed 0301, 0343, 2210, 0303, then Not reported (8,847)', JSON.stringify((await codes('#occ-departures')).slice(0, 5)) === '["0301","0343","2210","0303","NR"]' &&
    (await evaluate(`document.querySelector('#occ-departures .occ-row[data-code="NR"] .occ-row__val').textContent`)) === '8,847 left · 2.7% of departures' &&
    (await evaluate(`document.querySelector('#occ-departures .occ-row[data-code="NR"] .occ-row__name').textContent`)) === COPY['p10.notReported']);
  check('page 10 GOV: the hired bar text', (await evaluate(`document.querySelector('#occ-hires .occ-row .occ-row__val').textContent`)) === '8,524 hired · 5.3% of hires');
  check('page 10 GOV: the table lists every series with activity or employees (668), Not reported included, and its notes', (await evaluate(`document.querySelectorAll('#occ-table tbody tr').length`)) === 668 &&
    await evaluate(`!!document.querySelector('#occ-table tr[data-code="NR"]')`) && /Not reported/.test(await text('#occ-all .frame__notes')) && (await text('#occ-all .frame__notes')).includes(COPY['p10.note.moves']));
  await evaluate(`document.querySelector('#occ-table button[data-sort="departures"]').click()`);
  check('page 10: a table heading sorts', (await evaluate(`document.querySelector('#occ-table tbody tr').dataset.code`)) === '0301' && await evaluate(`document.querySelector('#occ-table th[aria-sort="descending"] button').dataset.sort === 'departures'`));
  check('page 10: CSV has the column headings and one line per occupation', await evaluate(`(() => { const c = OPM.page.csv().split(String.fromCharCode(13, 10)); return c[0].startsWith(${JSON.stringify(COPY['p10.col.occupation'] + ',' + COPY['p10.col.employees'])}) && c.length === 670; })()`));
  check('page 10: Download CSV raises no error', await evaluate(`(() => { document.getElementById('occ-download').click(); return true; })()`));
  await evaluate(`document.querySelector('#occ-departures .seg button[data-value="rate"]').click()`);
  check('page 10: sort by rate puts the highest departure rate first', await evaluate(`(() => { const r = OPM.page.state(); return r.departuresBy === 'rate'; })()`) &&
    (await codes('#occ-departures')).length === 25);
  await evaluate(`document.querySelector('#occ-hires .frame__head .btn').click()`);
  check('page 10: show all lists every series with a hire (552 incl. Not reported)', (await codes('#occ-hires')).length === 552);
  check('page 10 GOV: a series links to page 3 filtered to it', (await evaluate(`document.querySelector('#occ-hires .occ-row[data-code="0610"] a').getAttribute('href')`)) === 'hiring-and-departures.html?series=0610');
  await frameChecks('page 10 GOV');
  await evaluate(`document.querySelector('.seg button[data-value="family"]').click()`);
  check('page 10 GOV, family level: 60 rows incl. Not reported; links to page 3 by family; level in the URL', (await evaluate(`document.querySelectorAll('#occ-table tbody tr').length`)) === 60 &&
    (await evaluate(`document.querySelector('#occ-table tr[data-code="22"] a').getAttribute('href')`)) === 'hiring-and-departures.html?family=22' && /level=family/.test(await evaluate('location.search')));
  await go(BASE + 'occupations.html?entity=DJ&level=series');
  check('page 10 DJ, job series: a series links to the Look-Up with the series and department; the note on series below government', (await evaluate(`document.querySelector('#occ-departures .occ-row[data-code="0905"] a').getAttribute('href')`)) ===
    'look-up.html?entity=DJ&records=separations&file=separations_FY2026&occ=0905' && (await text('#occ-all .frame__notes')).includes(COPY['p10.note.seriesBelowGov']));
  await go(BASE + 'occupations.html?entity=DJ');
  check('page 10 DJ: family level by default, 47 families, hires 8,630', (await evaluate(`OPM.page.state().level`)) === 'family' && (await evaluate(`document.querySelectorAll('#occ-table tbody tr').length`)) === 47 && (await tile(COPY['p10.tile.hires'])) === '8,630');
  check('page 10 DJ: a family links to page 3 filtered to it for Justice', /^hiring-and-departures\.html\?entity=DJ&family=\d\d$/.test(await evaluate(`document.querySelector('#occ-table tbody tr a').getAttribute('href')`)));
  await evaluate(`document.querySelector('.seg button[data-value="fy"]').click()`);
  check('page 10 DJ: Yearly view, latest fiscal year (partial) chosen', /FY2026/.test(await evaluate(`document.querySelectorAll('.field select')[1].selectedOptions[0].textContent`)));
  await evaluate(`document.querySelector('.seg button[data-value="admin"]').click()`);
  check('page 10 DJ: by administration, Trump II', (await evaluate(`document.querySelectorAll('.field select')[1].value`)) === 'trump2' && /view=admin/.test(await evaluate('location.search')));
  check('page 10: no console errors', events.length === 0, events.join(' | '));
  // the Look-Up takes the series and department from page 10
  await go(BASE + 'look-up.html?entity=DJ&records=separations&file=separations_FY2026&occ=0905');
  await waitFor(`!!document.querySelector('.lookup-count')`, 30000);
  check('Look-Up from page 10: DJ, series 0905, FY2026 departures: 1,500 records (DuckDB on the Look-Up file)', (await text('.lookup-count')) === '1,500 matching records' &&
    (await evaluate(`document.querySelector('[data-filter="occupation"] select').value`)) === '0905' && (await evaluate(`document.querySelector('[data-filter="department"] select').value`)) === 'DJ');

  // the occupation filter on pages 2 and 3 (occupation-spec 5.2)
  events.length = 0;
  await go(BASE + 'workforce-size.html?family=22');
  check('page 2, family 22: employees 84,894 and change over 12 months -12,688 (occ_family_monthly)', (await tile(COPY['p2.tile.headcount'])) === '84,894' && (await tile(COPY['p2.tile.change12'])) === '-12,688');
  check('page 2 filtered: banner names the family; by department not available; series-change note', (await text('.occ-banner')).startsWith('Showing 22 ') && (await text('#children .frame__body')) === COPY['filter.occ.unavailable'] &&
    (await text('#flow .frame__notes')).includes(COPY['p10.note.moves']));
  await frameChecks('page 2 filtered');
  shots.push(await shot(path.join(SCREENS, 'workforce-size-occupation-1280.png')));
  await evaluate(`document.getElementById('occ-clear').click()`);
  await waitFor('document.body.dataset.ready === "true"');
  check('page 2: Clear removes the filter', (await tile(COPY['p2.tile.headcount'])) === '2,024,832' && !/family=/.test(await evaluate('location.search')) && await evaluate(`document.querySelector('.occ-banner').hidden`));
  await go(BASE + 'hiring-and-departures.html?series=0610');
  check('page 3, series 0610: hires 8,369 (year before 5,568), departures 8,440 (9,312), departure rate 7.9% (8.5%)', (await tile(COPY['p3.tile.hires'])) === '8,369' && (await tile(COPY['p3.tile.departures'])) === '8,440' &&
    (await tile(COPY['p3.tile.rate'])) === '7.9%' && await evaluate(`[...document.querySelectorAll('.tile .tile__sub')].map(x => x.textContent).join('|')`) === 'Year before: 5,568|Year before: 9,312|Year before: 8.5%');
  check('page 3 filtered: reasons, hires by type and transfers not available', await evaluate(`['reasons', 'types', 'transfers'].every(id => document.querySelector('#' + id + ' .frame__body').textContent === ${JSON.stringify(COPY['filter.occ.unavailable'])})`));
  await frameChecks('page 3 filtered');
  await evaluate(`document.querySelector('.field select:not(#ctl-occ)') && (() => { const s = document.querySelectorAll('.controls select')[2]; s.value = 'obama2'; s.dispatchEvent(new Event('change')); })()`);
  await waitFor('document.body.dataset.ready === "true"');
  check('page 3 filtered, Obama II range: loads the earlier series file, rates filled', /range=obama2/.test(await evaluate('location.search')) && /series=0610/.test(await evaluate('location.search')) &&
    await evaluate(`OPM.page.frames.rates.chart.data.datasets[0].data.every(v => typeof v === 'number' && v > 0)`));
  shots.push(await shot(path.join(SCREENS, 'hiring-and-departures-occupation-1280.png')));
  await go(BASE + 'hiring-and-departures.html?entity=DJ&series=0610');
  check('page 3: a job series filter is government only (dropped for Justice)', !/series=/.test(await evaluate('location.search')) && await evaluate(`document.querySelector('.occ-banner').hidden`) &&
    !(await evaluate(`[...document.querySelectorAll('#ctl-occ option')].some(o => o.value.startsWith('series:'))`)));
  await go(BASE + 'hiring-and-departures.html?entity=DJ&family=NR');
  check('page 3, Justice, Not reported: counts, no rates, KDI-011 note', /^[\d,]+$/.test(await tile(COPY['p3.tile.departures'])) && (await tile(COPY['p3.tile.rate'])) === COPY['shared.mark.empty'] &&
    (await text('#rates .frame__notes')).includes('KDI-011'));
  check('pages 2 and 3 filtered: no console errors', events.length === 0, events.join(' | '));

  // pages 5 to 8
  await go(BASE + 'who-is-leaving.html');
  check('page 5 GOV: departures in the 12 months to Aug 2026 are 329,623, with the year before', (await tile(COPY['p5.tile.departures'])) === '329,623' &&
    /^Year before: [\d,]+$/.test(await evaluate(`[...document.querySelectorAll('.tile')][0].querySelector('.tile__sub').textContent`)));
  check('page 5: the age panel starts with "Under 25"', (await evaluate(`document.querySelector('#snap-age .who-row__name').textContent`)) === COPY['group.age.under25']);
  check('page 5: six panels, each with a trend', (await evaluate(`document.querySelectorAll('section.frame[id^="snap-"]').length`)) === 6 && (await evaluate(`document.querySelectorAll('section.frame[id^="trend-"] canvas').length`)) === 6);
  await evaluate(`document.querySelector('.seg button[data-value="admin"]').click()`);
  check('page 5 by administration: Trump II, first 20 months; years lost tile filled', (await evaluate(`document.querySelectorAll('.field select')[1].value`)) === 'trump2' &&
    /^[\d,]+$/.test(await tile(COPY['p5.tile.yearsLost'])) && /view=admin/.test(await evaluate('location.search')));
  await go(BASE + 'who-is-joining.html?entity=DJ&view=fy&period=FY2025');
  check('page 6 DJ FY2025: hires, new hires and transfers in tiles; share panels present', /^[\d,]+$/.test(await tile(COPY['p6.tile.hires'])) &&
    (await evaluate(`!!document.getElementById('snap-prior_service') && !!document.getElementById('snap-pathways')`)));
  await go(BASE + 'appointments.html');
  check('page 7 GOV: political appointee hires 4,105 and departures 3,565 since January 2025', (await tile(COPY['p7.tile.hires'])) === '4,105' && (await tile(COPY['p7.tile.departures'])) === '3,565');
  await evaluate(`document.querySelector('#political .seg button[data-value="schedule_c"]').click()`);
  check('page 7: subgroup toggle', /group=schedule_c/.test(await evaluate('location.search')));
  events.length = 0;
  await go(BASE + 'look-up.html?file=separations_FY2025');
  await waitFor(`!!document.querySelector('.lookup-count')`, 30000);
  check('page 8: FY2025 departures, 369,153 matching records', (await text('.lookup-count')) === '369,153 matching records');
  await evaluate(`(() => { const s = document.querySelector('[data-filter="department"] select'); s.value = 'HU'; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: department filter HU gives 2,825', (await text('.lookup-count')) === '2,825 matching records');
  check('page 8: 50 rows a page and the pager', (await evaluate(`document.querySelectorAll('#lookup-table tbody tr').length`)) === 50 && (await text('.pager span')) === 'Page 1 of 57');
  await evaluate(`document.getElementById('lookup-next').click()`);
  check('page 8: next page', (await text('.pager span')) === 'Page 2 of 57');
  await evaluate(`document.getElementById('lookup-clear').click()`);
  await evaluate(`(() => { const i = document.getElementById('lookup-search'); i.value = 'PAINTING'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(500);
  check('page 8: free-text search narrows the rows', /^[\d,]+ matching records$/.test(await text('.lookup-count')) && (await text('.lookup-count')) !== '369,153 matching records');
  await go(BASE + 'look-up.html?records=employment&dept=DN');
  await waitFor(`!!document.querySelector('#lookup-table')`, 30000);
  await evaluate(`document.querySelector('#lookup-table button[data-sort="grade"]').click()`);
  await evaluate(`document.querySelector('#lookup-table button[data-sort="grade"]').click()`);
  check('page 8: a withheld grade in a known data issue is marked and linked', await evaluate(`(() => { const a = document.querySelector('#lookup-table td.is-kdi a'); return !!a && a.textContent === 'REDACTED' && /reading-the-data\.html.*#kdi-007$/.test(a.getAttribute('href')); })()`));
  check('page 8: Download CSV raises no error', await evaluate(`(() => { document.getElementById('lookup-download').click(); return true; })()`));
  // D-035: appointment type grouped as on page 7, code and name in one cell, the code its own CSV column
  await go(BASE + 'look-up.html?file=separations_FY2025');
  await waitFor(`!!document.querySelector('#lookup-table')`, 30000);
  const apOpts = await evaluate(`[...document.querySelectorAll('[data-filter="appointment"] option')].map(o => [o.value, o.textContent])`);
  const P7 = ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political'].map(k => COPY['p7.group.' + k]);
  check('page 8: appointment filter lists the page 7 groups in order, then "* INVALID"', JSON.stringify(apOpts.slice(1).map(o => o[1].replace(/ \([\d,]+\)$/, ''))) === JSON.stringify(P7.concat(['* INVALID'])) &&
    apOpts[apOpts.length - 1][1] === '* INVALID (133)', JSON.stringify(apOpts));
  await evaluate(`(() => { const s = document.querySelector('[data-filter="appointment"] select'); s.value = 'group:political'; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: political appointees in FY2025 departures, 2,931 (the appointments cube)', (await text('.lookup-count')) === '2,931 matching records');
  const apCells = await evaluate(`(() => { const i = [...document.querySelectorAll('#lookup-table thead th')].findIndex(th => th.textContent.trim().startsWith(${JSON.stringify(COPY['p8.col.appointment'])}));
    return [...document.querySelectorAll('#lookup-table tbody tr')].map(r => r.children[i].textContent); })()`);
  check('page 8: appointment cell shows the code and its name', apCells.length === 50 && apCells.every(c => /^(36|44|46|55) [A-Z]/.test(c)), JSON.stringify(apCells.slice(0, 3)));
  const csvHead = await evaluate(`(() => { const d = OPM.page.data(); return OPM.lookupModel.csv(d.current.slice(0, 1), d.fields).split(String.fromCharCode(13, 10))[0].split(','); })()`);
  check('page 8: CSV has appointment_type_code beside appointment_type', csvHead.indexOf('appointment_type_code') >= 0 && csvHead.indexOf('appointment_type') === csvHead.indexOf('appointment_type_code') + 1, csvHead.join(','));
  await evaluate(`(() => { const s = [...document.querySelectorAll('.lookup-filters select')].pop(); s.value = 'appointment'; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: count by appointment type uses the group label', (await evaluate(`[...document.querySelectorAll('.lookup-summary tbody tr')].map(r => r.children[0].textContent).join('|')`)) === COPY['p7.group.political']);
  // D-037: occupational family, code and name in one cell after Occupation; a filter and a count-by field; the 8 FY2025
  // departures with no family published are an empty cell and their own option (figures: DuckDB on the Look-Up file)
  await go(BASE + 'look-up.html?file=separations_FY2025');
  await waitFor(`!!document.querySelector('#lookup-table')`, 30000);
  const heads = await evaluate(`[...document.querySelectorAll('#lookup-table thead th')].map(th => th.textContent.trim())`);
  check('page 8: Occupational family column follows Occupation', heads.indexOf(COPY['p8.col.family']) === heads.indexOf(COPY['p8.col.occupation']) + 1 && heads.indexOf(COPY['p8.col.family']) > 0, heads.join('|'));
  const famOpts = await evaluate(`[...document.querySelectorAll('[data-filter="family"] option')].map(o => [o.value, o.textContent])`);
  check('page 8: family filter lists 62 values, largest 03 (71,096), no family published (8)', famOpts.length === 63 &&
    famOpts[1][1] === '03 GENERAL ADMINISTRATIVE, CLERICAL, AND OFFICE SERVICES GROUP (71,096)' && famOpts.some(o => o[0] === '' && o[1] === ' (8)'), JSON.stringify(famOpts.slice(0, 3)));
  await evaluate(`(() => { const s = document.querySelector('[data-filter="family"] select'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: family filter on no published family gives 8', (await text('.lookup-count')) === '8 matching records');
  const famCells = await evaluate(`(() => { const i = [...document.querySelectorAll('#lookup-table thead th')].findIndex(th => th.textContent.trim().startsWith(${JSON.stringify(COPY['p8.col.family'])}));
    return [...document.querySelectorAll('#lookup-table tbody tr')].map(r => r.children[i].textContent); })()`);
  check('page 8: no published family shows as an empty cell', famCells.length === 8 && famCells.every(c => c === ''), JSON.stringify(famCells));
  await evaluate(`(() => { const s = document.querySelector('[data-filter="family"] select'); s.value = '03'; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: family filter 03 gives 71,096', (await text('.lookup-count')) === '71,096 matching records');
  await evaluate(`(() => { const s = [...document.querySelectorAll('.lookup-filters select')].pop(); s.value = 'family'; s.dispatchEvent(new Event('change')); })()`);
  check('page 8: count by occupational family', (await evaluate(`[...document.querySelectorAll('.lookup-summary tbody tr')].map(r => r.children[0].textContent + '=' + r.children[1].textContent).join('|')`)) ===
    '03 GENERAL ADMINISTRATIVE, CLERICAL, AND OFFICE SERVICES GROUP=71,096');
  check('page 8: no console errors', events.length === 0, events.join(' | '));
  await go(BASE + 'look-up.html?records=employment');
  check('page 8: employees wait for a department', (await evaluate(`!document.querySelector('#lookup-table') && /Choose a department/.test(document.getElementById('lookup').textContent)`)));
  await viewport(390);
  await go(BASE + 'look-up.html');
  const ns = await evaluate(noScroll);
  check('390: stub page has no sideways scroll', ns.sw <= ns.iw, JSON.stringify(ns));
  check('no console errors across the run', events.length === 0, events.join(' | '));
  console.log('screenshots:\n  ' + shots.join('\n  '));
} catch (e) {
  check('smoke run completed', false, e.stack);
}
cleanup();
const failed = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + String(r.detail).slice(0, 500)));
console.log(`${results.length - failed.length} of ${results.length} smoke checks pass`);
process.exit(failed.length ? 1 : 0);
