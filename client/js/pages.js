/* Router ringan (History API), halaman penuh (profil, pengaturan, owner, join), blokir & laporan. */
var Pages = (function () {
  'use strict';

  var TAB_PATH = { chat: '/app', story: '/stories', saluran: '/channels', panggil: '/calls' };
  var me = null;
  var cur = location.pathname;
  var seq = 0;

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* =============== Router =============== */
  function parse(path) {
    var p = path.replace(/\/+$/, '') || '/';
    var seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    var head = seg[0];
    if (!head || head === 'app') return { page: 'tab', tab: 'chat' };
    if (head === 'stories') return { page: 'tab', tab: 'story' };
    if (head === 'calls') return { page: 'tab', tab: 'panggil' };
    if (head === 'channels') return seg[1] ? { page: 'tab', tab: 'saluran', channelId: seg[1] } : { page: 'tab', tab: 'saluran' };
    if (head === 'chat' && seg[1]) return { page: 'tab', tab: 'chat', convId: seg[1] };
    if (head === 'groups' && seg[1]) return { page: 'tab', tab: 'chat', groupId: seg[1] };
    if (head === 'channel' && seg[1]) return { page: 'tab', tab: 'saluran', channelUsername: seg[1] };
    if (head === 'profile') return { page: 'profile', kind: seg[1] === 'id' ? 'id' : seg[1] ? 'username' : 'me', key: seg[1] === 'id' ? seg[2] : seg[1] };
    if (head === 'settings') return { page: 'settings', section: seg[1] || '' };
    if (head === 'owner') return { page: 'owner', section: seg[1] || '' };
    if (head === 'join' && seg[1]) return { page: 'join', token: seg[1] };
    return { page: 'tab', tab: 'chat' };
  }

  function go(path, opts) {
    if (opts && opts.replace) history.replaceState({ xen: 1 }, '', path);
    else if (path !== location.pathname) history.pushState({ xen: 1 }, '', path);
    render(path);
  }

  function back() {
    if (history.state && history.state.xen && history.length > 1) history.back();
    else go(TAB_PATH.chat, { replace: true });
  }

  function setTabPath(tab) { cur = TAB_PATH[tab]; history.replaceState(history.state, '', cur); }

  function render(path) {
    cur = path;
    var r = parse(path);
    var mine = ++seq;
    if (r.page === 'tab') {
      close();
      App.showTab(r.tab, true);
      if (r.convId) Chat.openById(r.convId);
      if (r.groupId) Groups.openInfo(r.groupId);
      if (r.channelId) Channels.openById(r.channelId);
      if (r.channelUsername) Channels.openByUsername(r.channelUsername);
      return;
    }
    closeDialogs();
    if (r.page === 'profile') profilePage(r, mine);
    else if (r.page === 'settings') Settings.page(r.section);
    else if (r.page === 'owner') Owner.page(r.section);
    else if (r.page === 'join') Groups.joinPage(r.token);
  }

  function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(function (d) { d.close(); }); }

  /* =============== Kerangka halaman =============== */
  function open(title) {
    $('#page-title').textContent = title;
    $('#page-actions').textContent = '';
    var body = $('#page-body');
    body.textContent = '';
    body.scrollTop = 0;
    $('#page').hidden = false;
    return body;
  }
  function close() { $('#page').hidden = true; $('#page-body').textContent = ''; }
  function setTitle(t) { $('#page-title').textContent = t; }
  function state(body, text, retry) {
    body.textContent = '';
    var box = make('div', 'empty');
    box.appendChild(make('h2', 'empty__title', text));
    if (retry) { var b = make('button', 'btn btn--ghost', 'Coba lagi'); b.type = 'button'; b.addEventListener('click', retry); box.appendChild(b); }
    body.appendChild(box);
  }
  function skeleton(body) {
    body.textContent = '';
    for (var i = 0; i < 3; i++) body.appendChild(make('div', 'skeleton'));
  }

  /* =============== Blokir, laporan, bagikan =============== */
  async function setBlocked(user, block) {
    if (block) {
      var ok = await UI.confirm({ title: 'Blokir ' + user.name + '?', text: 'Dia tidak bisa mengirim pesan atau menelepon kamu. Chat lama tetap ada.', okText: 'Blokir' });
      if (!ok) return null;
      await Api.post('/api/blocks/' + user.id);
      UI.toast('Pengguna diblokir.');
      return true;
    }
    await Api.del('/api/blocks/' + user.id);
    UI.toast('Blokir dibuka.');
    return false;
  }

  function openReport(user) {
    $('#report-user').textContent = user.name;
    $('#report-details').value = '';
    $('#report-error').textContent = '';
    var first = $('#report-form').querySelector('input[name="category"]');
    if (first) first.checked = true;
    $('#report-form').dataset.userId = user.id;
    $('#report-dialog').showModal();
  }

  async function submitReport(e) {
    e.preventDefault();
    var f = e.target;
    var cat = f.querySelector('input[name="category"]:checked');
    var btn = $('#report-send');
    btn.disabled = true;
    try {
      await Api.post('/api/reports', { userId: f.dataset.userId, category: cat && cat.value, details: $('#report-details').value });
      $('#report-dialog').close();
      UI.toast('Laporan terkirim. Terima kasih.', 'success');
    } catch (err) { $('#report-error').textContent = err.message; }
    finally { btn.disabled = false; }
  }

  async function share(url, title) {
    if (navigator.share) {
      try { await navigator.share({ title: title, url: url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); UI.toast('Link disalin.', 'success'); }
    catch (e) { UI.toast('Salin link: ' + url); }
  }

  /* =============== Halaman profil =============== */
  function btn(label, cls, fn) {
    var b = make('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function renderProfile(body, user, blocked, isMe) {
    body.textContent = '';
    var card = make('div', 'pf');
    card.appendChild(UI.avatar(user, 'xl'));
    card.appendChild(UI.nameNode(user, 'pf__name'));
    card.appendChild(make('p', 'pf__user', '@' + user.username));
    var idRow = make('p', 'pf__id', 'ID: ' + user.accountId);
    card.appendChild(idRow);
    card.appendChild(make('p', 'pf__bio' + (user.bio ? '' : ' pf__bio--empty'), user.bio || 'Belum ada bio.'));
    if (!isMe) {
      var s = make('p', 'pf__status' + (user.online ? ' pf__status--on' : ''), (user.online ? '● ' : '') + UI.statusText(user));
      card.appendChild(s);
    }

    var actions = make('div', 'pf__actions');
    if (isMe) {
      actions.appendChild(btn('Edit profil', '', function () { Profile.openEdit(); }));
      actions.appendChild(btn('Ganti foto', 'btn--ghost', function () { Profile.openEdit(); }));
    } else {
      actions.appendChild(btn('Pesan', '', async function () { try { await Chat.openUser(user.id); go('/app'); } catch (e) { UI.toast(e.message, 'error'); } }));
      actions.appendChild(btn('Suara', 'btn--ghost', function () { Calls.start(user.id, 'audio', user); }));
      actions.appendChild(btn('Video', 'btn--ghost', function () { Calls.start(user.id, 'video', user); }));
    }
    actions.appendChild(btn('Bagikan', 'btn--ghost', function () { share(location.origin + '/profile/' + encodeURIComponent(user.username), user.name + ' di XenChat'); }));
    card.appendChild(actions);

    if (!isMe) {
      var more = make('div', 'pf__more');
      var prow = function (icon, label, fn) {
        var r = make('button', 'pf-row');
        r.type = 'button';
        r.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + icon + '"/></svg>'; // markup statis
        r.appendChild(make('span', null, label));
        r.addEventListener('click', fn);
        return r;
      };
      more.appendChild(prow('block', blocked ? 'Buka blokir' : 'Blokir', async function () {
        try {
          var r = await setBlocked(user, !blocked);
          if (r !== null) { blocked = r; renderProfile(body, user, blocked, isMe); }
        } catch (e) { UI.toast(e.message, 'error'); }
      }));
      more.appendChild(prow('flag', 'Laporkan', function () { openReport(user); }));
      card.appendChild(more);
    }
    body.appendChild(card);
  }

  async function profilePage(r, mine) {
    var body = open('Profil');
    if (r.kind === 'me') { renderProfile(body, XenApp.user, false, true); return; }
    skeleton(body);
    var load = async function () {
      try {
        var d = await Api.get(r.kind === 'id' ? '/api/users/id/' + encodeURIComponent(r.key) : '/api/users/' + encodeURIComponent(r.key));
        if (mine !== seq) return;
        var isMe = d.user.id === XenApp.user.id;
        setTitle(isMe ? 'Profil' : d.user.name);
        renderProfile(body, isMe ? Object.assign({}, d.user, XenApp.user) : d.user, !!d.blocked, isMe);
      } catch (err) { if (mine === seq) state(body, err.message, load); }
    };
    load();
  }

  function init(user) {
    me = user;
    $('#page-back').addEventListener('click', back);
    window.addEventListener('popstate', function () {
      if (location.pathname !== cur) render(location.pathname);
    });
    $('#report-form').addEventListener('submit', submitReport);
    $('#report-cancel').addEventListener('click', function () { $('#report-dialog').close(); });
    var rd = $('#report-dialog');
    rd.addEventListener('click', function (e) { if (e.target === rd) rd.close(); });
  }

  return { init: init, go: go, back: back, render: render, parse: parse, open: open, close: close, setTitle: setTitle, state: state, skeleton: skeleton, setTabPath: setTabPath, share: share, openReport: openReport, setBlocked: setBlocked, TAB_PATH: TAB_PATH };
})();

var Router = Pages;
