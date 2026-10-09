/* Shell aplikasi: sesi, navigasi tab, menu ⋮, inisialisasi modul. */
(function () {
  'use strict';

  var TITLES = { chat: 'Chat', story: 'Story', saluran: 'Saluran', panggil: 'Panggil' };

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }

  var avatar = UI.avatar;

  /* ---------- Ringkasan profil di menu ---------- */
  function renderProfile(user) {
    var box = $('#profile');
    box.textContent = '';
    var info = document.createElement('div');
    info.className = 'profile__info';
    info.appendChild(UI.nameNode(user, 'profile__name'));
    var uname = document.createElement('div');
    uname.className = 'profile__meta truncate';
    uname.textContent = '@' + user.username;
    var id = document.createElement('div');
    id.className = 'profile__meta';
    id.textContent = 'ID: ' + user.accountId;
    info.appendChild(uname);
    info.appendChild(id);
    box.appendChild(avatar(user, 'lg'));
    box.appendChild(info);
    var me = $('#side-profile');
    if (me) {
      me.textContent = '';
      var t = document.createElement('span');
      t.className = 'nav__me-text';
      var n = document.createElement('span');
      n.className = 'nav__me-name truncate';
      n.textContent = user.name;
      var u = document.createElement('span');
      u.className = 'nav__me-user truncate';
      u.textContent = '@' + user.username;
      t.appendChild(n);
      t.appendChild(u);
      me.appendChild(avatar(user, 'sm'));
      me.appendChild(t);
    }
    var owner = $('#menu-owner');
    if (owner) owner.hidden = user.role !== 'owner'; // hanya tampilan; server tetap memeriksa role
  }

  /* ---------- Navigasi tab ---------- */
  function showTab(name, fromRouter) {
    if (!TITLES[name]) name = 'chat';
    if (!fromRouter) { Pages.close(); Pages.setTabPath(name); }
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
    $$('.nav__item').forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#topbar-title').textContent = TITLES[name];
    document.title = TITLES[name] + ' - XenChat';
    if (name === 'panggil') Calls.onTabOpen();
  }

  // Badge pesan belum dibaca pada navigasi Chat (angka dari server lewat daftar chat).
  function setUnread(n) {
    var b = $('#nav-badge-chat');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  }

  /* ---------- Menu ⋮ ---------- */
  function setupMenu() {
    var dlg = $('#menu-dialog');
    function open() { dlg.showModal(); }
    $('#more-btn').addEventListener('click', open);
    $('#settings-btn').addEventListener('click', function () { Router.go('/settings'); });
    $('#side-profile').addEventListener('click', function () { Router.go('/profile'); });
    $('#profile').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dlg.close(); Router.go('/profile'); } });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]');
      if (!b) return;
      dlg.close();
      Router.go(b.dataset.go);
    });
    $('#profile').addEventListener('click', function () { dlg.close(); Router.go('/profile'); });

    $('#logout-btn').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Keluar dari XenChat?', text: 'Kamu perlu login lagi untuk melanjutkan.', okText: 'Keluar' });
      if (!ok) return;
      try {
        await Api.post('/api/auth/logout');
        location.replace('/login.html');
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* ---------- Boot ---------- */
  async function boot() {
    var splashText = $('#splash-text');
    var retry = $('#retry-btn');
    splashText.textContent = 'Memuat…';
    retry.hidden = true;

    try {
      var data = await Api.get('/api/auth/me');
      window.XenApp = { user: data.user, renderProfile: renderProfile };
      window.App = { showTab: showTab, setUnread: setUnread };
      renderProfile(data.user);
      setupMenu();
      Profile.init(data.user);
      Pages.init(data.user);
      Settings.init();
      Attach.init();
      XenSocket.connect();
      Chat.init(data.user);
      Search.init();
      Groups.init(data.user);
      Stories.init(data.user);
      Channels.init(data.user);
      Calls.init(data.user);
      $$('.nav__item').forEach(function (b) {
        b.addEventListener('click', function () { showTab(b.dataset.tab); });
      });
      $('#splash').hidden = true;
      $('#app').hidden = false;
      Pages.render(location.pathname);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        location.replace('/login.html?next=' + encodeURIComponent(location.pathname));
        return;
      }
      splashText.textContent = err.message;
      retry.hidden = false;
    }
  }

  $('#retry-btn').addEventListener('click', boot);
  boot();
})();
