/* Page 9, Reading the data (page-spec 7.8, copy 8.9): fixed text in sections with anchors, and the signed known
   breaks as a table (assets/known-breaks.json, built from pipeline/known_breaks.csv). No charts or controls. */
(function (root) {
  'use strict';
  var C = root.OPM.core, S = root.OPM.shell, h = S.h;
  /* section id, title key, paragraph keys */
  var SECTIONS = [
    ['data-origin', 'p9.source.title', ['p9.source.p1', 'p9.source.p2', 'p9.source.p3', 'p9.source.p4']],
    ['counting', 'p9.count.title', ['p9.count.p1', 'p9.count.p2', 'p9.count.p3', 'p9.count.p4', 'p9.count.p5', 'p9.count.p6']],
    ['rates', 'p9.rates.title', ['p9.rates.p1', 'p9.rates.p2', 'p9.rates.p3', 'p9.rates.p4', 'p9.rates.p5']],
    ['known-data-issues', 'p9.issues.title', ['p9.issues.intro'], ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011']],
    ['known-breaks', 'p9.breaks.title', ['p9.breaks.p1']],
    ['withheld-values', 'p9.redact.title', ['p9.redact.p1']],
    ['revised-files', 'p9.revisions.title', ['p9.revisions.p1']]
  ];

  S.init('reading-the-data').then(function (cp) {
    var t = cp.t, main = document.getElementById('main');
    main.appendChild(h('div', { class: 'page-head' }, [h('h1', { text: t('p9.title') }), h('p', { text: t('p9.intro') })]));
    main.appendChild(h('nav', { class: 'toc', 'aria-labelledby': 'toc-title' }, [h('h2', { id: 'toc-title', class: 'field__label', text: t('p9.toc') }),
      h('ul', {}, SECTIONS.map(function (s) { return h('li', {}, h('a', { href: '#' + s[0], text: t(s[1]) })); }))]));
    var breaksBox = h('div', { class: 'scroll' });
    SECTIONS.forEach(function (s) {
      var kids = [h('h2', { text: t(s[1]) })].concat(s[2].map(function (k) {
        var txt = t(k);
        // the data source names OPM's Federal Workforce Data: link it to OPM's data page (links are added by code)
        if (k === 'p9.source.p1') return h('p', {}, S.linked(txt, "Federal Workforce Data", S.SOURCE_URL));
        return h('p', { text: txt });
      }));
      if (s[3]) kids.push(h('ul', { class: 'kdi-list' }, s[3].map(function (n) { return h('li', { id: 'kdi-' + n }, [h('strong', { class: 'mono', text: 'KDI-' + n + ' ' }), t('p9.issues.kdi' + n)]); })));
      if (s[0] === 'known-breaks') kids.push(breaksBox);
      main.appendChild(h('section', { class: 'prose', id: s[0] }, kids));
    });
    return Promise.all([S.getJson('assets/known-breaks.json'), S.getJson('data/admin.meta.json').catch(function () { return null; })]).then(function (r) {
      if (r[1]) S.setDataMonth(r[1].range.last_month);
      var rows = r[0].rows.slice().sort(function (a, b) {
        return (a.entity === 'GOV' ? -1 : 0) - (b.entity === 'GOV' ? -1 : 0) || C.titleCase(a.name).localeCompare(C.titleCase(b.name)) || a.fiscal_year - b.fiscal_year;
      });
      breaksBox.appendChild(S.dataTable(t('p9.breaks.title'), [t('p9.breaks.col.entity'), t('p9.breaks.col.fy'), t('p9.breaks.col.gap')], rows.map(function (b) {
        return [b.entity === 'GOV' ? t('p1.control.entity.all') : C.titleCase(b.name), t('shared.period.fy', { yyyy: b.fiscal_year }),
          C.signedInt(b.gap) + ' (' + C.pct(b.gap_pct / 100, true) + ')'];
      })));
      if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
      document.body.setAttribute('data-ready', 'true');
    });
  }).catch(function (e) { console.warn(String(e)); document.body.setAttribute('data-ready', 'true'); });
})(self);
