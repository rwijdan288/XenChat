/* Pengaturan: hanya opsi yang benar-benar bekerja (server atau penyimpanan lokal). */
var Settings = (function () {
  'use strict';

  var VERSION = 'XenChat 1.0 · Phase 4';
  var SECTIONS = [
    { id: 'account', icon: '👤', title: 'Akun', sub: 'Profil, email, dan ID akun' },
    { id: 'privacy', icon: '🔒', title: 'Privasi', sub: 'Status online dan pengguna diblokir' },
    { id: 'chats', icon: '💬', title: 'Obrolan', sub: 'Preferensi mengetik' },
    { id: 'calls', icon: '📞', title: 'Panggilan', sub: 'Mikrofon, kamera, dan speaker' },
    { id: 'appearance', icon: '🎨', title: 'Tampilan', sub: 'Tema dan ukuran teks' },
    { id: 'security', icon: '🛡️', title: 'Keamanan', sub: 'Password dan sesi' },
    { id: 'about', icon: 'ℹ️', title: 'Tentang', sub: 'Informasi XenChat' }
  ];

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // Bagian = judul + satu kartu berisi baris-baris (dipisah garis tipis). Gunakan .add() untuk menambah baris.
  function section(title) {
    var wrap = make('section', 'set');
    if (title) wrap.appendChild(make('h2', 'set__title', title));
    var group = make('div', 'set__group');
    wrap.appendChild(group);
    wrap.add = function (n) { group.appendChild(n); return n; };
    return wrap;
  }
  function row(label, sub, control, icon) {
    var r = make('div', 'set__row');
    if (icon) r.appendChild(make('span', 'set__icon', icon));
    var t = make('div', 'set__text');
    t.appendChild(make('span', 'set__label', label));
    if (sub) t.appendChild(make('span', 'set__sub', sub));
    r.appendChild(t);
    if (control) r.appendChild(control);
    return r;
  }
  function button(label, cls, fn) { var b = make('button', 'btn ' + (cls || 'btn--ghost') + ' btn--sm', label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function toggle(on, fn) {
    var b = make('button', 'switch');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!on));
    b.addEventListener('click', async function () {
      var next = b.getAttribute('aria-checked') !== 'true';
      b.disabled = true;
      try { await fn(next); b.setAttribute('aria-checked', String(next)); } catch (err) { UI.toast(err.message, 'error'); }
      b.disabled = false;
    });
    return b;
  }
  function segmented(options, value, fn) {
    var g = make('div', 'segmented');
    g.style.gridTemplateColumns = 'repeat(' + options.length + ', 1fr)';
    g.setAttribute('role', 'radiogroup');
    options.forEach(function (o) {
      var b = make('button', null, o[1]);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o[0] === value));
      b.addEventListener('click', function () {
        fn(o[0]);
        g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      });
      g.appendChild(b);
    });
    return g;
  }

  /* =============== Daftar kategori =============== */
  function root(body) {
    var u = XenApp.user;
    var me = make('button', 'set__me');
    me.type = 'button';
    me.setAttribute('aria-label', 'Buka profil');
    me.appendChild(UI.avatar(u, 'lg'));
    var mt = make('span', 'set__text');
    mt.appendChild(UI.nameNode(u, 'set__label'));
    mt.appendChild(make('span', 'set__sub', '@' + u.username + ' · ID ' + u.accountId));
    me.appendChild(mt);
    me.appendChild(make('span', 'set__chev', '›'));
    me.addEventListener('click', function () { Router.go('/profile'); });
    body.appendChild(me);

    var g = section();
    SECTIONS.forEach(function (s) {
      var r = make('button', 'set__row set__row--link');
      r.type = 'button';
      r.appendChild(make('span', 'set__icon', s.icon));
      var t = make('span', 'set__text');
      t.appendChild(make('span', 'set__label', s.title));
      t.appendChild(make('span', 'set__sub', s.sub));
      r.appendChild(t);
      r.appendChild(make('span', 'set__chev', '›'));
      r.addEventListener('click', function () { Router.go('/settings/' + s.id); });
      g.add(r);
    });
    body.appendChild(g);
  }

  /* =============== Akun =============== */
  function account(body) {
    var u = XenApp.user;
    var s = section('Profil');
    s.add(row('Nama lengkap', u.name, null, '👤'));
    s.add(row('Username', '@' + u.username));
    s.add(row('Bio', u.bio || 'Belum ada bio'));
    s.add(row('Edit profil', 'Nama, username, bio, dan foto', button('Edit', 'btn--ghost', function () { Profile.openEdit(); })));
    body.appendChild(s);

    var e = section('Akun');
    e.add(row('Email', u.email || 'Belum diisi', button(u.email ? 'Ubah' : 'Tambah', 'btn--ghost', openEmail), '📧'));
    e.add(row('Account ID', u.accountId + ' (tidak dapat diubah)', button('Salin', 'btn--ghost', function () {
      navigator.clipboard.writeText(u.accountId).then(function () { UI.toast('Account ID disalin.', 'success'); }, function () { UI.toast('Gagal menyalin.', 'error'); });
    })));
    body.appendChild(e);

    if (u.role !== 'owner') {
      var d = section('Zona berbahaya');
      d.add(row('Hapus akun', 'Data pribadimu dihapus dan tidak bisa dipulihkan', button('Hapus', 'btn--outline-danger', function () {
        $('#delete-password').value = ''; $('#delete-error').textContent = ''; $('#delete-dialog').showModal();
      })));
      body.appendChild(d);
    }
  }

  function openEmail() {
    $('#email-input').value = XenApp.user.email || '';
    $('#email-password').value = '';
    $('#email-error').textContent = '';
    $('#email-dialog').showModal();
  }

  /* =============== Privasi =============== */
  async function saveSettings(patch) {
    var d = await Api.patch('/api/users/me/settings', patch);
    XenApp.user = Object.assign(XenApp.user, d.user);
    return d.user;
  }

  function privacy(body) {
    var u = XenApp.user;
    var s = section('Status');
    s.add(row('Tampilkan status online', 'Jika dimatikan, online dan terakhir dilihat disembunyikan dari semua orang', toggle(u.settings.showPresence, function (v) { return saveSettings({ showPresence: v }); })));
    body.appendChild(s);

    var st = section('Story');
    var sel = make('select', 'field__input field__input--sm');
    sel.setAttribute('aria-label', 'Privasi story bawaan');
    [['contacts', 'Kontak'], ['everyone', 'Semua orang'], ['nobody', 'Hanya saya']].forEach(function (o) {
      var op = make('option', null, o[1]); op.value = o[0]; sel.appendChild(op);
    });
    sel.value = u.settings.defaultStoryPrivacy;
    sel.addEventListener('change', function () { saveSettings({ defaultStoryPrivacy: sel.value }).catch(function (e) { UI.toast(e.message, 'error'); }); });
    st.add(row('Siapa yang bisa melihat story baru', 'Bisa diubah untuk tiap story', sel));
    body.appendChild(st);

    var b = section('Pengguna');
    b.add(row('Pengguna diblokir', 'Kelola daftar blokir', button('Buka', 'btn--ghost', function () { Router.go('/settings/blocked'); })));
    body.appendChild(b);
  }

  async function blocked(body) {
    Pages.skeleton(body);
    var load = async function () {
      try {
        var d = await Api.get('/api/blocks?limit=100');
        body.textContent = '';
        if (!d.users.length) { Pages.state(body, 'Tidak ada pengguna yang diblokir'); return; }
        var ul = make('ul', 'list');
        d.users.forEach(function (u) {
          var li = make('li');
          var r = make('div', 'item item--static');
          r.appendChild(UI.avatar(u));
          var m = make('span', 'item__main');
          m.appendChild(UI.nameNode(u, 'item__name'));
          m.appendChild(make('span', 'item__preview truncate', '@' + u.username));
          r.appendChild(m);
          r.appendChild(button('Buka blokir', 'btn--ghost', async function () {
            try { await Api.del('/api/blocks/' + u.id); li.remove(); UI.toast('Blokir dibuka.'); if (!ul.children.length) Pages.state(body, 'Tidak ada pengguna yang diblokir'); }
            catch (e) { UI.toast(e.message, 'error'); }
          }));
          li.appendChild(r);
          ul.appendChild(li);
        });
        body.appendChild(ul);
      } catch (err) { Pages.state(body, err.message, load); }
    };
    load();
  }

  /* =============== Obrolan, panggilan, tampilan =============== */
  function chats(body) {
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var cur = XenPrefs.get('enterToSend');
    var on = cur === undefined ? finePointer : cur === 'on';
    var s = section('Mengetik');
    s.add(row('Enter untuk mengirim', 'Shift+Enter membuat baris baru. Nonaktif: Enter membuat baris baru', toggle(on, function (v) { XenPrefs.set('enterToSend', v ? 'on' : 'off'); return Promise.resolve(); })));
    body.appendChild(s);
  }

  function calls(body) {
    var s = section('Perangkat panggilan');
    var note = make('p', 'set__note', 'Pilihan disimpan di browser ini. Izinkan akses agar nama perangkat tampil.');
    s.add(note);
    var selects = {};
    [['micId', 'Mikrofon', 'audioinput'], ['camId', 'Kamera', 'videoinput'], ['speakerId', 'Speaker', 'audiooutput']].forEach(function (d) {
      var sel = make('select', 'field__input field__input--sm');
      sel.setAttribute('aria-label', d[1]);
      var def = make('option', null, 'Bawaan sistem'); def.value = ''; sel.appendChild(def);
      sel.addEventListener('change', function () { XenPrefs.set(d[0], sel.value); });
      selects[d[2]] = { sel: sel, key: d[0] };
      s.add(row(d[1], '', sel));
    });
    var fill = async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { note.textContent = 'Browser ini tidak mendukung pemilihan perangkat.'; return; }
      var devs = await navigator.mediaDevices.enumerateDevices();
      devs.forEach(function (dv) {
        var t = selects[dv.kind];
        if (!t || !dv.deviceId || dv.deviceId === 'default') return;
        var op = make('option', null, dv.label || (dv.kind + ' ' + (t.sel.options.length)));
        op.value = dv.deviceId;
        t.sel.appendChild(op);
      });
      Object.keys(selects).forEach(function (k) { selects[k].sel.value = XenPrefs.get(selects[k].key) || ''; });
    };
    s.add(row('Izin perangkat', 'Muat nama mikrofon dan kamera', button('Izinkan akses', 'btn--ghost', async function () {
      try {
        var st = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(function () { return navigator.mediaDevices.getUserMedia({ audio: true }); });
        st.getTracks().forEach(function (t) { t.stop(); });
        Object.keys(selects).forEach(function (k) { while (selects[k].sel.options.length > 1) selects[k].sel.remove(1); });
        await fill();
      } catch (e) { UI.toast('Izin perangkat ditolak.', 'error'); }
    })));
    body.appendChild(s);
    fill().catch(function () {});
    var h = section('Riwayat');
    h.add(row('Riwayat panggilan', 'Lihat dan hapus riwayat', button('Buka', 'btn--ghost', function () { Router.go('/calls'); })));
    body.appendChild(h);
  }

  function appearance(body) {
    var s = section('Tema');
    s.add(segmented([['light', 'Terang'], ['dark', 'Gelap'], ['system', 'Sistem']], XenTheme.get(), function (v) { XenTheme.set(v); }));
    body.appendChild(s);
    var f = section('Ukuran teks');
    f.add(segmented([['sm', 'Kecil'], ['md', 'Sedang'], ['lg', 'Besar']], XenPrefs.get('fontSize') || 'md', function (v) { XenPrefs.set('fontSize', v); }));
    body.appendChild(f);
  }

  function security(body) {
    var s = section('Password');
    s.add(row('Ubah password', 'Sesi di perangkat lain akan keluar', button('Ubah', 'btn--ghost', function () {
      ['current', 'new', 'confirm'].forEach(function (k) { $('#pw-' + k).value = ''; });
      $('#pw-error').textContent = '';
      $('#password-dialog').showModal();
    })));
    body.appendChild(s);
    var l = section('Sesi');
    l.add(row('Keluar dari semua sesi', 'Semua perangkat (termasuk ini) harus login lagi', button('Keluar semua', 'btn--outline-danger', async function () {
      var ok = await UI.confirm({ title: 'Keluar dari semua sesi?', text: 'Kamu harus login lagi di semua perangkat.', okText: 'Keluar semua' });
      if (!ok) return;
      try { await Api.post('/api/auth/logout-all'); location.replace('/login.html'); } catch (e) { UI.toast(e.message, 'error'); }
    })));
    body.appendChild(l);
  }

  function about(body) {
    var s = section('XenChat');
    s.add(row('Versi', VERSION));
    body.appendChild(s);
  }

  /* =============== Halaman =============== */
  var BUILD = { account: account, privacy: privacy, blocked: blocked, chats: chats, calls: calls, appearance: appearance, security: security, about: about };

  function page(id) {
    var meta = SECTIONS.filter(function (s) { return s.id === id; })[0];
    var title = id === 'blocked' ? 'Pengguna diblokir' : meta ? meta.title : 'Pengaturan';
    var body = Pages.open(title);
    if (!id) { root(body); return; }
    if (!BUILD[id]) { Pages.state(body, 'Halaman tidak ditemukan'); return; }
    BUILD[id](body);
  }

  /* =============== Dialog akun =============== */
  function init() {
    ['#email-dialog', '#password-dialog', '#delete-dialog'].forEach(function (id) {
      var d = $(id);
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });
    document.querySelectorAll('[data-close-dialog]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    $('#email-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      $('#email-error').textContent = '';
      try {
        var d = await Api.put('/api/users/me/email', { email: $('#email-input').value, password: $('#email-password').value });
        XenApp.user = Object.assign(XenApp.user, d.user);
        $('#email-dialog').close();
        UI.toast('Email diperbarui.', 'success');
        if (location.pathname.indexOf('/settings/account') === 0) Router.render(location.pathname);
      } catch (err) { $('#email-error').textContent = err.message; }
    });

    $('#password-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      $('#pw-error').textContent = '';
      try {
        await Api.post('/api/auth/password', { currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value, confirmPassword: $('#pw-confirm').value });
        $('#password-dialog').close();
        UI.toast('Password diubah. Sesi lain telah keluar.', 'success');
      } catch (err) { $('#pw-error').textContent = err.message; }
    });

    $('#delete-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      $('#delete-error').textContent = '';
      var ok = await UI.confirm({ title: 'Hapus akun secara permanen?', text: 'Tindakan ini tidak bisa dibatalkan.', okText: 'Hapus akun' });
      if (!ok) return;
      try { await Api.del('/api/auth/account', { password: $('#delete-password').value }); location.replace('/login.html'); }
      catch (err) { $('#delete-error').textContent = err.message; }
    });
  }

  return { init: init, page: page };
})();
