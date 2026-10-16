/* The shell on every page: header with the site name and the ten page tabs, footer, the entity carried in the URL,
   the section frame (title, body, "Show table", "Download SVG", notes) and stamped fetches. Browser only. */
(function (root) {
  'use strict';
  var C = root.OPM.core;
  var SOURCE_URL = 'https://data.opm.gov/get-data/api-access';
  /* the ten pages of page-spec section 2, in menu order (Occupations between Appointments and Look-Up, D-040);
     labels are shell.nav split on its separators */
  var PAGES = [
    { id: 'administrations', file: 'index.html' },
    { id: 'workforce-size', file: 'workforce-size.html' },
    { id: 'hiring-and-departures', file: 'hiring-and-departures.html' },
    { id: 'departments-compared', file: 'departments-compared.html' },
    { id: 'who-is-leaving', file: 'who-is-leaving.html' },
    { id: 'who-is-joining', file: 'who-is-joining.html' },
    { id: 'appointments', file: 'appointments.html' },
    { id: 'occupations', file: 'occupations.html' },
    { id: 'look-up', file: 'look-up.html' },
    { id: 'reading-the-data', file: 'reading-the-data.html' }
  ];
  var NAV_SEP = ' · ';

  /* ---- DOM */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  /* a copy string with one phrase in it turned into a link (links are added by code, never stored in copy) */
  function linked(text, phrase, href) {
    var i = text.indexOf(phrase);
    if (i < 0 || !phrase) return [text];
    return [text.slice(0, i), h('a', { href: href, text: phrase }), text.slice(i + phrase.length)];
  }

  /* ---- stamp and fetches */
  function stamp() { var m = document.querySelector('meta[name="opm-build"]'); return m ? m.getAttribute('content') : ''; }
  function asset(url) { var s = stamp(); return s ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(s) : url; }
  function getJson(url) {
    return fetch(asset(url)).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); });
  }

  /* ---- URL state: the entity carries across pages; a page may keep its own settings next to it */
  function params() { return new URLSearchParams(root.location.search); }
  function entityParam() { return params().get('entity') || 'GOV'; }
  function pageHref(file, entity) {
    var e = entity === undefined ? entityParam() : entity;
    return file + (e && e !== 'GOV' ? '?entity=' + encodeURIComponent(e) : '');
  }
  function setParams(obj) {
    var p = params();
    Object.keys(obj).forEach(function (k) { if (obj[k] === null || obj[k] === undefined || obj[k] === '') p.delete(k); else p.set(k, obj[k]); });
    var q = p.toString();
    root.history.replaceState(null, '', root.location.pathname + (q ? '?' + q : '') + root.location.hash);
    refreshNav();
  }

  var copy = null, navLinks = [];
  function refreshNav() {
    navLinks.forEach(function (l) { l.a.setAttribute('href', pageHref(l.file)); });
    document.querySelectorAll('a[data-page-link]').forEach(function (a) { var hash = (a.getAttribute('href') || '').split('#')[1]; a.setAttribute('href', pageHref(a.getAttribute('data-page-link')) + (hash ? '#' + hash : '')); });
  }

  function header(pageId) {
    var labels = copy.t('shell.nav').split(NAV_SEP);
    var ul = h('ul');
    PAGES.forEach(function (p, i) {
      var a = h('a', { href: pageHref(p.file), 'aria-current': p.id === pageId ? 'page' : null, text: labels[i] });
      navLinks.push({ a: a, file: p.file });
      ul.appendChild(h('li', {}, a));
    });
    return h('header', { class: 'site-header' }, h('div', { class: 'site-header__in' }, [
      h('a', { class: 'site-name', href: pageHref('index.html'), text: copy.t('shell.site_name') }),
      h('nav', { class: 'site-nav', 'aria-label': copy.t('shell.site_name') }, ul)
    ]));
  }
  var footerUpdated = null;
  function footer() {
    var src = copy.t('shell.footer.source');
    footerUpdated = h('p', { class: 'site-footer__updated' });
    return h('footer', { class: 'site-footer' }, h('div', { class: 'site-footer__in' }, [
      h('p', {}, linked(src, src.replace(/^[^:]*:\s*/, ''), SOURCE_URL)),
      footerUpdated
    ]));
  }
  /* "Last updated {date}. Data through {month}.": the build stamp's date and the latest month of the data */
  function setDataMonth(month) {
    if (footerUpdated && month) footerUpdated.textContent = copy.t('shell.footer.updated', { date: C.stampDate(stamp()), month: C.monthLabel(month) });
  }
  function pageLabel(pageId) {
    var i = PAGES.map(function (p) { return p.id; }).indexOf(pageId);
    return copy.t('shell.nav').split(NAV_SEP)[i];
  }

  /* Start a page: load copy, draw header and footer around <main>. Resolves with the copy object. */
  function init(pageId) {
    return getJson('copy.json').then(function (json) {
      copy = C.createCopy(json);
      document.title = copy.t('shell.site_name');
      var main = document.getElementById('main');
      document.body.insertBefore(header(pageId), main);
      document.body.appendChild(footer());
      return copy;
    });
  }

  /* ---- section frame. opts: { id, title, sub, headExtra, svgName }. Returns the frame's parts and setters. */
  function frame(opts) {
    var titleId = opts.id + '-title', tableId = opts.id + '-table';
    var title = h('h2', { id: titleId }), sub = h('p', { class: 'frame__sub' });
    var body = h('div', { class: 'frame__body' }), table = h('div', { class: 'frame__table scroll', id: tableId, hidden: true });
    var notes = h('div', { class: 'frame__notes' });
    var svgFn = null;
    var tableBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', 'aria-controls': tableId, text: copy.t('shell.chart.table'),
      onclick: function () { var open = table.hidden; table.hidden = !open; tableBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); } });
    var svgBtn = h('button', { type: 'button', class: 'btn', text: copy.t('shell.chart.svg'),
      onclick: function () { if (svgFn) { var r = svgFn(); root.OPM.svg.download(r.svg, r.filename); } } });
    var head = h('div', { class: 'frame__head' }, [h('div', {}, [title, sub]), opts.headExtra || null]);
    var el = h('section', { class: 'frame' + (opts.panel ? ' panel' : ''), id: opts.id, 'aria-labelledby': titleId },
      [head, body, h('div', { class: 'frame__actions' }, [tableBtn, svgBtn]), table, notes]);
    return {
      el: el, body: body,
      setTitle: function (t) { title.textContent = t; },
      setSub: function (parts) { clear(sub); (Array.isArray(parts) ? parts : [parts]).forEach(function (p) { if (p) sub.appendChild(typeof p === 'string' ? document.createTextNode(p) : p); }); sub.hidden = !sub.firstChild; },
      setBody: function (node) { clear(body).appendChild(node); },
      setTable: function (node) { clear(table).appendChild(node); },
      setNotes: function (list) { clear(notes); list.forEach(function (x) { if (x) notes.appendChild(h('p', {}, x)); }); },
      onSvg: function (fn) { svgFn = fn; },
      svg: function () { return svgFn ? svgFn() : null; }
    };
  }

  /* a plain table: head [text|{text,style}], rows [[th, td...]], foot rows likewise */
  function dataTable(caption, head, rows, foot) {
    function cell(tag, c, scope) {
      var o = typeof c === 'object' && c !== null ? c : { text: c };
      return h(tag, { scope: scope || null, style: o.style || null, text: o.text === null || o.text === undefined ? '' : String(o.text) });
    }
    return h('table', { class: 'data-table' }, [
      h('caption', { class: 'visually-hidden', text: caption }),
      h('thead', {}, h('tr', {}, head.map(function (c, i) { return cell('th', c, i === 0 ? null : 'col'); }))),
      h('tbody', {}, rows.map(function (r) { return h('tr', {}, r.map(function (c, i) { return i === 0 ? cell('th', c, 'row') : cell('td', c); })); })),
      foot && foot.length ? h('tfoot', {}, foot.map(function (r) { return h('tr', {}, r.map(function (c, i) { return i === 0 ? cell('th', c, 'row') : cell('td', c); })); })) : null
    ]);
  }

  /* the page's main area says it has no data (data files missing or unreadable) */
  function empty(main) { main.appendChild(h('p', { class: 'status', role: 'status', text: copy.t('shell.empty') })); }

  /* A page with no contents yet (pages 2 to 9 in stage 1): its title only. */
  function stub(pageId) {
    return init(pageId).then(function () {
      var main = document.getElementById('main');
      main.appendChild(h('div', { class: 'page-head' }, h('h1', { text: pageLabel(pageId) })));
      return getJson('data/admin.meta.json').then(function (m) { setDataMonth(m.range.last_month); }, function () {});
    }).then(function () { document.body.setAttribute('data-ready', 'true'); });
  }

  /* ---- controls shared by pages 2 to 8 */
  var uid = 0;
  /* a row of toggle buttons (one pressed): { label, options: [{ value, text }], value, onChange } */
  function segmented(o) {
    var id = 'seg-' + (++uid), group = h('div', { class: 'seg', role: 'group', 'aria-labelledby': id });
    var buttons = o.options.map(function (op) {
      var b = h('button', { type: 'button', 'data-value': op.value, text: op.text, onclick: function () { set(op.value); o.onChange(op.value); } });
      group.appendChild(b);
      return b;
    });
    function set(v) { buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-value') === v ? 'true' : 'false'); }); }
    set(o.value);
    var el = h('div', { class: 'field' + (o.cls ? ' ' + o.cls : '') }, [h('span', { class: 'field__label', id: id, text: o.label }), group, o.note ? h('p', { class: 'field__note', text: o.note }) : null]);
    return { el: el, set: set, group: group };
  }
  /* a labelled select: { label, options: [{ value, text }], value, onChange, cls } */
  function selectField(o) {
    var id = 'sel-' + (++uid), sel = h('select', { id: id, onchange: function () { o.onChange(sel.value); } });
    function fill(list, v) { clear(sel); list.forEach(function (op) { sel.appendChild(h('option', { value: op.value, text: op.text })); }); if (v !== undefined) sel.value = v; }
    fill(o.options || [], o.value);
    var note = h('p', { class: 'field__note', hidden: !o.note, text: o.note || '' });
    var el = h('div', { class: 'field' + (o.cls ? ' ' + o.cls : '') }, [h('label', { for: id, text: o.label }), sel, note]);
    return { el: el, select: sel, fill: fill, note: note, set: function (v) { sel.value = v; } };
  }
  /* entity choices: government, departments by name, Defense agencies under Defense, subelements under their parent */
  function entityChoices(entities, names, levels, allLabel) {
    var keys = Object.keys(entities), out = [{ value: 'GOV', text: allLabel }], pad = '   ';
    var by = function (a, b) { return names[a].localeCompare(names[b]); };
    function children(parent, level) { return keys.filter(function (k) { return entities[k].level === level && entities[k].parent === parent; }).sort(by); }
    keys.filter(function (k) { return entities[k].level === 'department'; }).sort(by).forEach(function (d) {
      out.push({ value: d, text: names[d] });
      if (levels.indexOf('agency') >= 0) children(d, 'agency').forEach(function (a) {
        out.push({ value: a, text: pad + names[a] });
        if (levels.indexOf('subelement') >= 0) children(a, 'subelement').forEach(function (s) { out.push({ value: s, text: pad + pad + names[s] }); });
      });
      if (levels.indexOf('subelement') >= 0) children(d, 'subelement').forEach(function (s) { out.push({ value: s, text: pad + names[s] }); });
    });
    return out;
  }
  /* the URL's entity if this page supports it, else the government (as on page 1), with the URL rewritten */
  function resolveEntity(ok) {
    var e = entityParam();
    if (e !== 'GOV' && !ok(e)) { e = 'GOV'; setParams({ entity: null }); }
    return e;
  }
  /* notes for a view: { provisional, partial: row|null, partialLabel, small, incomplete, kdi: [ids] } */
  function flagNotes(f) {
    var out = [];
    if (f.provisional) out.push(copy.t('shared.flag.provisional'));
    if (f.partial) out.push(copy.t(f.ytd ? 'shared.flag.ytd' : 'shared.flag.partial', { period: f.partialLabel, month: C.monthLabel(f.partial.period_last_month) }));
    if (f.small) out.push(copy.t('shared.flag.small'));
    if (f.incomplete) out.push(copy.t('p1.note.incomplete'));
    if (f.kdi && f.kdi.length) out.push(readingLink(copy.t('p1.note.issues', { ids: f.kdi.join(', ') })));
    return out;
  }
  /* a sentence whose "Reading the data" becomes a link to page 9 (optionally to an anchor) */
  function readingLink(text, anchor) {
    var a = h('a', { href: pageHref('reading-the-data.html') + (anchor ? '#' + anchor : ''), 'data-page-link': 'reading-the-data.html', text: pageLabel('reading-the-data') });
    var label = pageLabel('reading-the-data'), i = text.indexOf(label);
    if (i < 0) return text;
    return h('span', {}, [text.slice(0, i), a, text.slice(i + label.length)]);
  }

  root.OPM.shell = { PAGES: PAGES, segmented: segmented, selectField: selectField, entityChoices: entityChoices, resolveEntity: resolveEntity, flagNotes: flagNotes, readingLink: readingLink, SOURCE_URL: SOURCE_URL, h: h, clear: clear, linked: linked, stamp: stamp, asset: asset, getJson: getJson,
    params: params, entityParam: entityParam, pageHref: pageHref, setParams: setParams, init: init, setDataMonth: setDataMonth,
    frame: frame, dataTable: dataTable, empty: empty, stub: stub, pageLabel: pageLabel, copy: function () { return copy; } };
})(self);
