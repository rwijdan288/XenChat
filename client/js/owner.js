/* Panel Owner: statistik, pengguna (ban/verified), laporan, saluran (verified). Izin dicek ulang di server. */
var Owner = (function () {
  'use strict';

  var timer = null;

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(label, cls, fn) { var b = make('button', 'btn ' + (cls || 'btn--ghost') + ' btn--sm', label); b.type = 'button'; b.addEventListener('click', fn); return b; }

  function nav(current) {
    var n = make('div', 'segmented segmented--4 tabs');
    n.style.gridTemplateColumns = 'repeat(4, 1fr)';
    [['', 'Ringkasan'], ['users', 'Pengguna'], ['reports', 'Laporan'], ['channels', 'Saluran']].forEach(function (t) {
      var b = make('button', null, t[1]);
      b.type = 'button';
      b.setAttribute('aria-selected', String(t[0] === current));
      b.addEventListener('click', function () { Router.go('/owner' + (t[0] ? '/' + t[0] : '')); });
      n.appendChild(b);
    });
    return n;
  }

  function page(section) {
    var body = Pages.open('Owner Panel');
    if (!XenApp.user || XenApp.user.role !== 'owner') { Pages.state(body, 'Kamu tidak punya izin'); return; }
    body.appendChild(nav(section));
    var host = make('div', 'owner__body');
    body.appendChild(host);
    if (section === 'users') users(host);
    else if (section === 'reports') reports(host);
    else if (section === 'channels') channels(host);
    else overview(host);
  }

  /* ---------- Ringkasan ---------- */
  async function overview(host) {
    Pages.skeleton(host);
    try {
      var s = await Api.get('/api/owner/stats');
      host.textContent = '';
      var grid = make('div', 'stats');
      [['Total pengguna', s.users], ['Sedang online', s.online], ['Diblokir platform', s.banned], ['Grup', s.groups], ['Saluran', s.channels], ['Laporan terbuka', s.openReports]].forEach(function (x) {
        var c = make('div', 'stat');
        c.appendChild(make('span', 'stat__n', UI.fmtCount(x[1])));
        c.appendChild(make('span', 'stat__l', x[0]));
        grid.appendChild(c);
      });
      host.appendChild(grid);
    } catch (err) { Pages.state(host, err.message, function () { overview(host); }); }
  }

  /* ---------- Pengguna ---------- */
  function users(host) {
    var input = make('input', 'field__input');
    input.type = 'search'; input.placeholder = 'Cari nama, @username, email, atau ID'; input.maxLength = 40; input.setAttribute('aria-label', 'Cari pengguna');
    var list = make('ul', 'list');
    var more = btn('Muat lebih banyak', 'btn--ghost', function () { load(false); });
    more.hidden = true;
    var note = make('p', 'search-note');
    host.appendChild(input); host.appendChild(list); host.appendChild(note); host.appendChild(more);
    var items = [];

    function row(u) {
      var li = make('li');
      var r = make('div', 'item item--static owner-row');
      r.appendChild(UI.avatar(u));
      var m = make('span', 'item__main');
      m.appendChild(UI.nameNode(u, 'item__name'));
      m.appendChild(make('span', 'item__preview truncate', '@' + u.username + ' · ' + (u.email || 'tanpa email') + ' · ID ' + u.accountId));
      var tags = make('span', 'owner-tags');
      if (u.role === 'owner') tags.appendChild(make('span', 'role-chip', 'Owner'));
      if (u.banned) tags.appendChild(make('span', 'role-chip role-chip--bad', 'Diblokir'));
      if (tags.children.length) m.appendChild(tags);
      r.appendChild(m);
      if (u.role !== 'owner') {
        var act = make('div', 'owner-actions');
        act.appendChild(btn(u.verified ? 'Cabut ✓' : 'Verifikasi', 'btn--ghost', async function () {
          try { var d = await Api.post('/api/owner/users/' + u.id + (u.verified ? '/unverify' : '/verify')); replace(d.user); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        act.appendChild(btn(u.banned ? 'Pulihkan' : 'Ban', u.banned ? 'btn--ghost' : 'btn--outline-danger', async function () {
          if (!u.banned) {
            var ok = await UI.confirm({ title: 'Ban @' + u.username + '?', text: 'Pengguna tidak bisa login dan sesinya diputus.', okText: 'Ban' });
            if (!ok) return;
          }
          try { var d = await Api.post('/api/owner/users/' + u.id + (u.banned ? '/unban' : '/ban')); replace(d.user); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        r.appendChild(act);
      }
      li.appendChild(r);
      return li;
    }
    function replace(u) { items = items.map(function (x) { return x.id === u.id ? u : x; }); draw(); }
    function draw() { list.textContent = ''; items.forEach(function (u) { list.appendChild(row(u)); }); note.textContent = items.length ? '' : 'Pengguna tidak ditemukan.'; }

    async function load(reset) {
      try {
        var d = await Api.get('/api/owner/users?limit=20&skip=' + (reset ? 0 : items.length) + '&q=' + encodeURIComponent(input.value.trim()));
        items = reset ? d.users : items.concat(d.users);
        more.hidden = !d.hasMore;
        draw();
      } catch (err) { note.textContent = err.message; }
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { load(true); }, 300); });
    load(true);
  }

  /* ---------- Laporan ---------- */
  var CAT = { spam: 'Spam', harassment: 'Pelecehan', fake_account: 'Akun palsu', inappropriate: 'Konten tidak pantas', other: 'Lainnya' };

  function reports(host) {
    var status = 'open';
    var tabs = make('div', 'segmented tabs');
    tabs.style.gridTemplateColumns = 'repeat(2, 1fr)';
    var list = make('ul', 'list');
    var note = make('p', 'search-note');
    var more = btn('Muat lebih banyak', 'btn--ghost', function () { load(false); });
    more.hidden = true;
    var items = [];
    [['open', 'Terbuka'], ['resolved', 'Selesai']].forEach(function (t) {
      var b = make('button', null, t[1]);
      b.type = 'button';
      b.setAttribute('aria-selected', String(t[0] === status));
      b.addEventListener('click', function () { status = t[0]; tabs.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); }); load(true); });
      tabs.appendChild(b);
    });
    host.appendChild(tabs); host.appendChild(list); host.appendChild(note); host.appendChild(more);

    function draw() {
      list.textContent = '';
      items.forEach(function (r) {
        var li = make('li', 'report');
        var head = make('div', 'report__head');
        head.appendChild(make('strong', null, CAT[r.category] || r.category));
        head.appendChild(make('span', 'report__time', UI.timeShort(r.createdAt)));
        li.appendChild(head);
        li.appendChild(make('p', 'report__line', 'Terlapor: ' + (r.target ? r.target.name + ' (@' + r.target.username + ')' : '—') + (r.target && r.target.banned ? ' · diblokir' : '')));
        li.appendChild(make('p', 'report__line', 'Pelapor: ' + (r.reporter ? '@' + r.reporter.username : '—')));
        if (r.details) li.appendChild(make('p', 'report__details', r.details));
        if (r.status === 'open') {
          var act = make('div', 'owner-actions');
          if (r.target && !r.target.banned && r.target.role !== 'owner') {
            act.appendChild(btn('Ban terlapor', 'btn--outline-danger', async function () {
              var ok = await UI.confirm({ title: 'Ban @' + r.target.username + '?', text: 'Pengguna tidak bisa login dan sesinya diputus.', okText: 'Ban' });
              if (!ok) return;
              try { await Api.post('/api/owner/users/' + r.target.id + '/ban'); r.target.banned = true; draw(); } catch (e) { UI.toast(e.message, 'error'); }
            }));
          }
          act.appendChild(btn('Selesaikan', 'btn--ghost', async function () {
            try { await Api.post('/api/owner/reports/' + r.id + '/resolve', {}); items = items.filter(function (x) { return x.id !== r.id; }); draw(); UI.toast('Laporan diselesaikan.', 'success'); } catch (e) { UI.toast(e.message, 'error'); }
          }));
          li.appendChild(act);
        }
        list.appendChild(li);
      });
      note.textContent = items.length ? '' : 'Tidak ada laporan.';
    }
    async function load(reset) {
      try {
        var d = await Api.get('/api/owner/reports?status=' + status + '&limit=20&skip=' + (reset ? 0 : items.length));
        items = reset ? d.reports : items.concat(d.reports);
        more.hidden = !d.hasMore;
        draw();
      } catch (err) { note.textContent = err.message; }
    }
    load(true);
  }

  /* ---------- Saluran (verified) ---------- */
  function channels(host) {
    var input = make('input', 'field__input');
    input.type = 'search'; input.placeholder = 'Cari saluran'; input.maxLength = 40; input.setAttribute('aria-label', 'Cari saluran');
    var list = make('ul', 'list');
    var note = make('p', 'search-note');
    host.appendChild(input); host.appendChild(list); host.appendChild(note);
    var items = [];
    function draw() {
      list.textContent = '';
      items.forEach(function (c) {
        var li = make('li');
        var r = make('div', 'item item--static owner-row');
        r.appendChild(UI.avatar(c));
        var m = make('span', 'item__main');
        m.appendChild(UI.nameNode(c, 'item__name'));
        m.appendChild(make('span', 'item__preview truncate', '@' + c.username + ' · ' + UI.fmtCount(c.followersCount) + ' pengikut'));
        r.appendChild(m);
        r.appendChild(btn(c.verified ? 'Cabut ✓' : 'Verifikasi', 'btn--ghost', async function () {
          try { var d = await Api.post('/api/owner/channels/' + c.id + (c.verified ? '/unverify' : '/verify')); c.verified = d.verified; draw(); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        li.appendChild(r);
        list.appendChild(li);
      });
      note.textContent = items.length ? '' : 'Saluran tidak ditemukan.';
    }
    async function load() {
      try { items = (await Api.get('/api/owner/channels?limit=30&q=' + encodeURIComponent(input.value.trim()))).channels; draw(); }
      catch (err) { note.textContent = err.message; }
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 300); });
    load();
  }

  return { page: page };
})();
