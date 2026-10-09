/* Grup: buat/edit, info grup, anggota, peran, event realtime. Chat grup memakai modul Chat (Phase 2). */
var Groups = (function () {
  'use strict';

  var me = null;
  var info = null; // dokumen grup + myRole + muted (dari server)
  var members = [];
  var hasMore = false;
  var mode = 'create';
  var pendingAvatar; // undefined = tidak berubah, null = hapus, string = data URL baru
  var gmTarget = null;
  var inviteToken = null;
  var addSeq = 0;
  var addTimer = null;

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function toChatTab() { var t = document.querySelector('.nav__item[data-tab="chat"]'); if (t) t.click(); }
  function infoOpen() { return $('#ginfo-dialog').open && info; }

  /* =============== Buat / edit grup =============== */
  var FIELD = { name: '#group-name', description: '#group-desc' };

  function setErr(name, msg) {
    var out = $('#group-err-' + name);
    var inp = FIELD[name] ? $(FIELD[name]) : null;
    if (out) out.textContent = msg || '';
    if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  }

  function renderAvatar() {
    var box = $('#group-avatar');
    box.textContent = '';
    var url = '';
    if (typeof pendingAvatar === 'string') url = pendingAvatar;
    else if (pendingAvatar === undefined && mode === 'edit' && info) url = info.avatarUrl;
    box.appendChild(UI.avatar({ name: $('#group-name').value || 'G', avatarUrl: url }, 'lg'));
  }

  function openForm(m) {
    mode = m;
    pendingAvatar = undefined;
    ['name', 'description', 'avatar'].forEach(function (n) { setErr(n, ''); });
    $('#group-error').textContent = '';
    $('#group-name').value = m === 'edit' ? info.name : '';
    $('#group-desc').value = m === 'edit' ? info.description : '';
    $('#group-dlg-title').textContent = m === 'edit' ? 'Edit grup' : 'Buat grup';
    $('#group-save').textContent = m === 'edit' ? 'Simpan' : 'Buat grup';
    renderAvatar();
    $('#group-dialog').showModal();
  }

  async function submitForm(e) {
    e.preventDefault();
    var btn = $('#group-save');
    var label = btn.textContent;
    ['name', 'description', 'avatar'].forEach(function (n) { setErr(n, ''); });
    $('#group-error').textContent = '';

    var payload = { name: $('#group-name').value, description: $('#group-desc').value };
    if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;

    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
    try {
      if (mode === 'edit') {
        var d = await Api.patch('/api/groups/' + info.id, payload);
        info = Object.assign(info, d.group);
        Chat.patchGroup(info.id, { name: info.name, avatarUrl: info.avatarUrl });
        renderInfo();
        $('#group-dialog').close();
        UI.toast('Grup diperbarui.', 'success');
      } else {
        var r = await Api.post('/api/groups', payload);
        $('#group-dialog').close();
        Chat.upsertConv(r.conversation);
        toChatTab();
        Chat.openItem(r.conversation);
        UI.toast('Grup dibuat. Tambahkan anggota dari info grup.', 'success');
      }
    } catch (err) {
      if (err.fields) Object.keys(err.fields).forEach(function (n) { setErr(n, err.fields[n]); });
      $('#group-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* =============== Info grup =============== */
  function renderMembers() {
    var ul = $('#ginfo-members');
    ul.textContent = '';
    members.forEach(function (m) {
      var li = make('li');
      var b = make('button', 'item');
      b.type = 'button';
      b.dataset.id = m.id;
      var wrap = make('span', 'avatar-wrap');
      wrap.appendChild(UI.avatar(m));
      if (m.online) wrap.appendChild(make('span', 'dot'));
      var main = make('span', 'item__main');
      var top = make('span', 'item__top');
      top.appendChild(UI.nameNode(m, 'item__name'));
      if (m.role !== 'member') top.appendChild(make('span', 'role-chip', m.role === 'owner' ? 'Pemilik' : 'Admin'));
      if (m.online) top.appendChild(make('span', 'role-chip role-chip--online', 'Online'));
      main.appendChild(top);
      main.appendChild(make('span', 'item__preview truncate', '@' + m.username));
      b.appendChild(wrap);
      b.appendChild(main);
      li.appendChild(b);
      ul.appendChild(li);
    });
    $('#ginfo-state').textContent = members.length ? '' : 'Belum ada anggota.';
    $('#ginfo-more').hidden = !hasMore;
  }

  function renderInfo() {
    if (!info) return;
    var top = $('#ginfo-top');
    top.textContent = '';
    top.appendChild(UI.avatar({ name: info.name, avatarUrl: info.avatarUrl }, 'xl'));
    top.appendChild(make('h3', 'ginfo__name', info.name));
    top.appendChild(make('p', 'ginfo__count', info.membersCount + ' anggota'));
    $('#ginfo-desc').textContent = info.description || 'Belum ada deskripsi.';
    var staff = info.myRole !== 'member';
    $('#ginfo-edit').hidden = !staff;
    $('#ginfo-add').hidden = !staff;
    $('#ginfo-leave').hidden = info.myRole === 'owner';
    $('#ginfo-delete').hidden = info.myRole !== 'owner';
    var mute = $('#ginfo-mute');
    var custom = mute.querySelector('[data-custom]');
    if (custom) custom.remove();
    if (!info.muted) mute.value = 'off';
    else if (!info.mutedUntil) mute.value = 'always';
    else {
      var op = document.createElement('option');
      op.dataset.custom = '1';
      op.value = 'keep';
      op.textContent = 'Senyap sampai ' + new Date(info.mutedUntil).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      mute.appendChild(op);
      mute.value = 'keep';
    }
    renderMembers();
    renderInvite();
  }

  async function loadMembers(reset) {
    var skip = reset ? 0 : members.length;
    var d = await Api.get('/api/groups/' + info.id + '/members?limit=50&skip=' + skip);
    members = reset ? d.members : members.concat(d.members);
    hasMore = d.hasMore;
  }

  async function openInfo(groupId) {
    var dlg = $('#ginfo-dialog');
    info = null;
    members = [];
    hasMore = false;
    $('#ginfo-top').textContent = '';
    $('#ginfo-members').textContent = '';
    $('#ginfo-desc').textContent = '';
    $('#ginfo-state').textContent = 'Memuat…';
    ['ginfo-edit', 'ginfo-add', 'ginfo-more', 'ginfo-leave', 'ginfo-delete'].forEach(function (id) { $('#' + id).hidden = true; });
    if (!dlg.open) dlg.showModal();
    try {
      var g = await Api.get('/api/groups/' + groupId);
      info = g.group;
      await loadMembers(true);
      renderInfo();
      loadInvite();
    } catch (err) {
      $('#ginfo-state').textContent = err.message;
    }
  }

  // Segarkan data setelah event realtime (anggota berubah) tanpa menutup dialog.
  async function refreshInfo() {
    if (!infoOpen()) return;
    try {
      var g = await Api.get('/api/groups/' + info.id);
      info = g.group;
      await loadMembers(true);
      renderInfo();
    } catch (e) { /* abaikan; event berikutnya menyinkronkan */ }
  }

  function closeInfoIf(groupId) {
    if (info && info.id === groupId && $('#ginfo-dialog').open) $('#ginfo-dialog').close();
    if (info && info.id === groupId) info = null;
  }

  /* =============== Link undangan =============== */
  function inviteLink() { return location.origin + '/join/' + inviteToken; }

  function renderInvite() {
    var staff = info && info.myRole !== 'member';
    $('#ginfo-invite').hidden = !staff;
    if (!staff) return;
    $('#inv-link').textContent = inviteToken ? inviteLink() : 'Belum ada link undangan.';
    $('#inv-copy').hidden = !inviteToken;
    $('#inv-revoke').hidden = !inviteToken;
    $('#inv-new').textContent = inviteToken ? 'Buat link baru' : 'Buat link';
  }

  async function loadInvite() {
    inviteToken = null;
    if (!info || info.myRole === 'member') return;
    try { inviteToken = (await Api.get('/api/groups/' + info.id + '/invite')).token; } catch (e) { inviteToken = null; }
    renderInvite();
  }

  /* =============== Halaman gabung via link (/join/:token) =============== */
  async function joinPage(token) {
    var body = Pages.open('Gabung grup');
    Pages.skeleton(body);
    var load = async function () {
      try {
        var d = await Api.get('/api/groups/join/' + encodeURIComponent(token));
        body.textContent = '';
        var card = make('div', 'pf');
        card.appendChild(UI.avatar({ name: d.group.name, avatarUrl: d.group.avatarUrl }, 'xl'));
        card.appendChild(make('h2', 'pf__name', d.group.name));
        card.appendChild(make('p', 'pf__user', d.group.membersCount + ' anggota'));
        if (d.group.description) card.appendChild(make('p', 'pf__bio', d.group.description));
        var b = make('button', 'btn', d.isMember ? 'Kamu sudah anggota' : d.group.full ? 'Grup penuh' : 'Gabung grup');
        b.type = 'button';
        b.disabled = d.isMember || d.group.full;
        b.addEventListener('click', async function () {
          b.disabled = true;
          try { await Api.post('/api/groups/join/' + encodeURIComponent(token)); UI.toast('Berhasil bergabung.', 'success'); Router.go('/app', { replace: true }); }
          catch (err) { UI.toast(err.message, 'error'); b.disabled = false; }
        });
        var actions = make('div', 'pf__actions');
        actions.appendChild(b);
        card.appendChild(actions);
        body.appendChild(card);
      } catch (err) { Pages.state(body, err.message, load); }
    };
    load();
  }

  /* =============== Aksi anggota =============== */
  function openMember(m) {
    var actor = info.myRole;
    var self = m.id === me.id;
    gmTarget = m;
    $('#gm-title').textContent = m.name;
    $('#gm-promote').hidden = !(actor === 'owner' && m.role === 'member');
    $('#gm-demote').hidden = !(actor === 'owner' && m.role === 'admin');
    $('#gm-owner').hidden = !(actor === 'owner' && !self);
    $('#gm-remove').hidden = self || m.role === 'owner' || !(actor === 'owner' || (actor === 'admin' && m.role === 'member'));
    $('#gmember-dialog').showModal();
  }

  async function memberAction(fn, okText) {
    $('#gmember-dialog').close();
    try {
      await fn();
      if (okText) UI.toast(okText, 'success');
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function setRoleLocal(userId, role) {
    members.forEach(function (m) { if (m.id === userId) m.role = role; });
    renderMembers();
  }

  /* =============== Tambah anggota =============== */
  function renderAddResults(users) {
    var box = $('#gadd-results');
    box.textContent = '';
    if (!users.length) { box.appendChild(make('p', 'search-note', 'Pengguna tidak ditemukan.')); return; }
    var ul = make('ul', 'list');
    users.forEach(function (u) {
      var li = make('li');
      var row = make('div', 'item item--static');
      row.appendChild(UI.avatar(u));
      var main = make('span', 'item__main');
      main.appendChild(UI.nameNode(u, 'item__name'));
      main.appendChild(make('span', 'item__preview truncate', '@' + u.username + ' · ID: ' + u.accountId));
      var btn = make('button', 'btn btn--ghost btn--sm', 'Tambah');
      btn.type = 'button';
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        try {
          await Api.post('/api/groups/' + info.id + '/members', { userId: u.id });
          btn.textContent = 'Ditambahkan';
          refreshInfo();
        } catch (err) { UI.toast(err.message, 'error'); btn.disabled = false; }
      });
      row.appendChild(main);
      row.appendChild(btn);
      li.appendChild(row);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  async function runAddSearch(q) {
    var mine = ++addSeq;
    var box = $('#gadd-results');
    box.textContent = '';
    box.appendChild(make('div', 'skeleton'));
    try {
      var d = await Api.get('/api/users/search?limit=15&q=' + encodeURIComponent(q));
      if (mine === addSeq) renderAddResults(d.users);
    } catch (err) {
      if (mine === addSeq) { box.textContent = ''; box.appendChild(make('p', 'search-note search-note--error', err.message)); }
    }
  }

  /* =============== Init & event realtime =============== */
  function bindSocket() {
    XenSocket.on('group:create', function (p) { Chat.upsertConv(p.conversation); });

    XenSocket.on('group:member:add', function (p) {
      if (p.conversation) { Chat.upsertConv(p.conversation); UI.toast('Kamu ditambahkan ke grup "' + p.conversation.group.name + '".'); }
      Chat.patchGroup(p.groupId, { membersCount: p.membersCount });
      if (infoOpen() && info.id === p.groupId) refreshInfo();
    });

    XenSocket.on('group:member:remove', function (p) {
      var c = Chat.findByGroup(p.groupId);
      if (p.userId === me.id) {
        if (c) Chat.removeConv(c.id);
        closeInfoIf(p.groupId);
        UI.toast('Kamu dikeluarkan dari grup.', 'error');
        return;
      }
      Chat.patchGroup(p.groupId, { membersCount: p.membersCount });
      if (infoOpen() && info.id === p.groupId) refreshInfo();
    });

    XenSocket.on('group:leave', function (p) {
      var c = Chat.findByGroup(p.groupId);
      if (c) Chat.removeConv(c.id);
      closeInfoIf(p.groupId);
    });

    XenSocket.on('group:delete', function (p) {
      var c = Chat.findByGroup(p.groupId);
      if (c) Chat.removeConv(c.id);
      closeInfoIf(p.groupId);
      UI.toast('Grup telah dihapus.');
    });

    XenSocket.on('group:update', function (p) {
      Chat.patchGroup(p.group.id, { name: p.group.name, avatarUrl: p.group.avatarUrl });
      if (infoOpen() && info.id === p.group.id) {
        info.name = p.group.name; info.description = p.group.description; info.avatarUrl = p.group.avatarUrl;
        renderInfo();
      }
    });

    XenSocket.on('group:member:role', function (p) {
      if (!infoOpen() || info.id !== p.groupId) return;
      if (p.userId === me.id) { info.myRole = p.role; UI.toast('Perananmu di grup sekarang: ' + (p.role === 'owner' ? 'pemilik' : p.role === 'admin' ? 'admin' : 'anggota') + '.'); }
      if (p.role === 'owner') {
        members.forEach(function (m) { if (m.role === 'owner') m.role = 'admin'; });
        if (info.myRole === 'owner' && p.userId !== me.id) info.myRole = 'admin';
      }
      setRoleLocal(p.userId, p.role);
      renderInfo();
    });
  }

  function init(user) {
    me = user;
    ['#group-dialog', '#ginfo-dialog', '#gadd-dialog', '#gmember-dialog'].forEach(function (id) {
      var d = $(id);
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });

    $('#group-new').addEventListener('click', function () { openForm('create'); });
    $('#group-close').addEventListener('click', function () { $('#group-dialog').close(); });
    $('#group-form').addEventListener('submit', submitForm);
    $('#group-pick').addEventListener('click', function () { $('#group-file').click(); });
    $('#group-file').addEventListener('change', async function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { pendingAvatar = await UI.resizeImage(f); renderAvatar(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#group-remove-avatar').addEventListener('click', function () { pendingAvatar = null; renderAvatar(); });
    $('#group-name').addEventListener('input', function () { if (pendingAvatar === null || (pendingAvatar === undefined && (mode === 'create' || !info.avatarUrl))) renderAvatar(); });

    $('#ginfo-close').addEventListener('click', function () { $('#ginfo-dialog').close(); });
    $('#ginfo-chat').addEventListener('click', function () {
      var c = info && Chat.findByGroup(info.id);
      if (!c) { UI.toast('Percakapan grup tidak ditemukan.', 'error'); return; }
      $('#ginfo-dialog').close();
      toChatTab();
      Chat.openItem(c);
    });
    $('#ginfo-edit').addEventListener('click', function () { if (info) openForm('edit'); });
    $('#ginfo-more').addEventListener('click', async function () {
      try { await loadMembers(false); renderMembers(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#ginfo-members').addEventListener('click', function (e) {
      var b = e.target.closest('.item');
      var m = b && members.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (m) openMember(m);
    });
    $('#ginfo-mute').addEventListener('change', async function (e) {
      var v = e.target.value;
      if (v === 'keep') return;
      try {
        var r = await Api.put('/api/groups/' + info.id + '/mute', { duration: v });
        info.muted = r.muted;
        info.mutedUntil = r.mutedUntil;
        renderInfo();
        UI.toast(r.muted ? 'Grup disenyapkan.' : 'Notifikasi grup aktif.');
      } catch (err) { UI.toast(err.message, 'error'); renderInfo(); }
    });

    $('#inv-copy').addEventListener('click', function () { if (inviteToken) Pages.share(inviteLink(), info.name); });
    $('#inv-new').addEventListener('click', async function () {
      try { inviteToken = (await Api.post('/api/groups/' + info.id + '/invite')).token; renderInvite(); UI.toast('Link baru dibuat. Link lama tidak berlaku.', 'success'); }
      catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#inv-revoke').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Cabut link undangan?', text: 'Orang yang memegang link ini tidak bisa lagi bergabung.', okText: 'Cabut' });
      if (!ok) return;
      try { await Api.del('/api/groups/' + info.id + '/invite'); inviteToken = null; renderInvite(); } catch (err) { UI.toast(err.message, 'error'); }
    });

    $('#ginfo-leave').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Keluar dari grup?', text: 'Kamu tidak akan menerima pesan baru dari grup ini.', okText: 'Keluar' });
      if (!ok) return;
      try {
        await Api.post('/api/groups/' + info.id + '/leave');
        var c = Chat.findByGroup(info.id);
        if (c) Chat.removeConv(c.id);
        closeInfoIf(info.id);
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#ginfo-delete').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Hapus grup?', text: 'Semua pesan dan anggota grup akan dihapus. Tindakan ini tidak bisa dibatalkan.', okText: 'Hapus grup' });
      if (!ok) return;
      try {
        var gid = info.id;
        await Api.del('/api/groups/' + gid);
        var c = Chat.findByGroup(gid);
        if (c) Chat.removeConv(c.id);
        closeInfoIf(gid);
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    $('#ginfo-add').addEventListener('click', function () {
      $('#gadd-search').value = '';
      $('#gadd-results').textContent = '';
      $('#gadd-dialog').showModal();
      $('#gadd-search').focus();
    });
    $('#gadd-close').addEventListener('click', function () { $('#gadd-dialog').close(); });
    $('#gadd-search').addEventListener('input', function (e) {
      clearTimeout(addTimer);
      var q = e.target.value.trim();
      addSeq++;
      if (q.replace(/^@/, '').length < 2) { $('#gadd-results').textContent = ''; return; }
      addTimer = setTimeout(function () { runAddSearch(q); }, 300);
    });

    $('#gm-profile').addEventListener('click', function () { $('#gmember-dialog').close(); Profile.show(gmTarget, { refresh: true }); });
    $('#gm-promote').addEventListener('click', function () {
      memberAction(async function () { await Api.post('/api/groups/' + info.id + '/admins/' + gmTarget.id); setRoleLocal(gmTarget.id, 'admin'); }, 'Dijadikan admin.');
    });
    $('#gm-demote').addEventListener('click', function () {
      memberAction(async function () { await Api.del('/api/groups/' + info.id + '/admins/' + gmTarget.id); setRoleLocal(gmTarget.id, 'member'); }, 'Dihapus dari admin.');
    });
    $('#gm-owner').addEventListener('click', async function () {
      var target = gmTarget;
      $('#gmember-dialog').close();
      var ok = await UI.confirm({ title: 'Pindahkan kepemilikan?', text: target.name + ' akan menjadi pemilik grup. Kamu tetap menjadi admin.', okText: 'Pindahkan' });
      if (!ok) return;
      try { await Api.post('/api/groups/' + info.id + '/transfer/' + target.id); UI.toast('Kepemilikan dipindahkan.', 'success'); refreshInfo(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#gm-remove').addEventListener('click', async function () {
      var target = gmTarget;
      $('#gmember-dialog').close();
      var ok = await UI.confirm({ title: 'Keluarkan ' + target.name + '?', text: 'Anggota ini tidak bisa lagi membaca atau mengirim pesan di grup.', okText: 'Keluarkan' });
      if (!ok) return;
      try { await Api.del('/api/groups/' + info.id + '/members/' + target.id); refreshInfo(); } catch (err) { UI.toast(err.message, 'error'); }
    });

    bindSocket();
  }

  return { init: init, openInfo: openInfo, joinPage: joinPage };
})();
