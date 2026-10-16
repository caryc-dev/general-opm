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
  'who-is-joining.html', 'appointments.html', 'look-up.html', 'reading-the-data.html'];
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
    check(`${width}: nine page tabs in order`, JSON.stringify(await evaluate(`[...document.querySelectorAll('.site-nav a')].map(a => a.textContent)`)) === JSON.stringify(NAV));
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
  const BUILT = [['workforce-size.html', 1], ['hiring-and-departures.html', 2], ['departments-compared.html', 3], ['who-is-leaving.html', 4], ['who-is-joining.html', 5],
    ['appointments.html', 6], ['look-up.html', 7], ['reading-the-data.html', 8]];
  for (const width of [1280, 390]) {
    await viewport(width);
    for (const [file, i] of BUILT) {
      events.length = 0;
      check(`${width} ${file}: loads`, await go(BASE + file));
      await evaluate('document.fonts.ready.then(() => true)');
      const ns2 = await evaluate(noScroll);
      check(`${width} ${file}: no sideways page scroll`, ns2.sw <= ns2.iw && ns2.wide.length === 0, JSON.stringify(ns2));
      check(`${width} ${file}: title and tab`, (await text('main h1')) === COPY['p' + (i + 1) + '.title'] && (await text('.site-nav a[aria-current="page"]')) === NAV[i]);
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
  await go(BASE + 'departments-compared.html?entity=DOD');
  check('page 4 Defense: its 4 agencies', JSON.stringify((await evaluate(`[...document.querySelectorAll('#cmp-heat tbody tr')].map(r => r.dataset.entity)`)).slice(1).sort()) === JSON.stringify(['DOD-AF', 'DOD-AR', 'DOD-DD', 'DOD-NV']));
  await go(BASE + 'departments-compared.html?entity=AF02');
  check('page 4 falls back to the government for a subelement', (await evaluate(`document.querySelector('.field--entity select').value`)) === 'GOV' && !/entity=/.test(await evaluate('location.search')));
  await go(BASE + 'reading-the-data.html');
  check('page 9: ten known data issues and 78 known breaks', (await evaluate(`document.querySelectorAll('.kdi-list li').length`)) === 10 && (await evaluate(`document.querySelectorAll('#known-breaks tbody tr').length`)) === 78);
  check('page 9: every section has its anchor', await evaluate(`['data-origin','counting','rates','known-data-issues','known-breaks','withheld-values','revised-files'].every(id => !!document.getElementById(id))`));

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
