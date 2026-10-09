/* Saluran: daftar, feed postingan, follow, reaksi, pin, admin, event realtime. */
var Channels = (function () {
  'use strict';

  var REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
  var me = null;
  var S = { scope: 'following', q: '', list: [], hasMore: false, active: null, pushed: false, menuPost: null, editing: null, seq: 0 };
  var el = {};
  var viewed = new Set();
  var observer = null;
  var desktopMq = window.matchMedia('(min-width: 1024px)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var searchTimer = null;
  var pendingAvatar;
  var formMode = 'create';

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function postTime(iso) {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function followers(n) { return UI.fmtCount(n) + ' pengikut'; }
  function role() { return S.active ? S.active.ch.myRole : 'none'; }
  function isStaff() { return role() === 'owner' || role() === 'admin'; }

  /* =============== Daftar saluran =============== */
  function item(ch) {
    var li = make('li');
    var b = make('button', 'item' + (S.active && S.active.ch.id === ch.id ? ' item--active' : ''));
    b.type = 'button';
    b.dataset.id = ch.id;
    b.appendChild(UI.avatar(ch));
    var main = make('span', 'item__main');
    main.appendChild(UI.nameNode(ch, 'item__name'));
    main.appendChild(make('span', 'item__preview truncate', '@' + ch.username + ' · ' + followers(ch.followersCount)));
    b.appendChild(main);
    li.appendChild(b);
    return li;
  }

  function renderList() {
    el.list.textContent = '';
    S.list.forEach(function (ch) { el.list.appendChild(item(ch)); });
    el.empty.hidden = S.list.length > 0;
    el.more.hidden = !S.hasMore;
    if (!S.list.length) {
      $('#chan-empty-title').textContent = S.scope === 'discover' && S.q ? 'Saluran tidak ditemukan' : 'Belum ada saluran';
      $('#chan-empty-text').textContent = S.scope === 'discover' ? 'Coba kata kunci lain.' : 'Buka tab Jelajahi untuk menemukan saluran.';
    }
  }

  async function loadList(more) {
    var seq = ++S.seq;
    if (!more) { S.list = []; el.list.textContent = ''; el.empty.hidden = true; el.more.hidden = true; el.loading.hidden = false; }
    el.error.hidden = true;
    try {
      var qs = '?scope=' + S.scope + '&limit=20&skip=' + (more ? S.list.length : 0) + (S.q ? '&q=' + encodeURIComponent(S.q) : '');
      var d = await Api.get('/api/channels' + qs);
      if (seq !== S.seq) return;
      S.list = more ? S.list.concat(d.channels) : d.channels;
      S.hasMore = d.hasMore;
      el.loading.hidden = true;
      renderList();
    } catch (err) {
      if (seq !== S.seq) return;
      el.loading.hidden = true;
      if (!S.list.length) el.error.hidden = false;
      UI.toast(err.message, 'error');
    }
  }

  function setScope(scope) {
    S.scope = scope;
    $('#chan-tabs').querySelectorAll('[role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.scope === scope)); });
    loadList(false);
  }

  /* =============== Kartu & header saluran =============== */
  function renderHead() {
    var ch = S.active.ch;
    el.headAvatar.textContent = '';
    el.headAvatar.appendChild(UI.avatar(ch));
    el.headTitle.textContent = '';
    el.headTitle.appendChild(UI.nameNode(ch, 'item__name'));
    el.headSub.textContent = followers(ch.followersCount);
    el.edit.hidden = ch.myRole !== 'owner';
    $('#chan-attach').hidden = !!S.editing;
    el.composer.hidden = !isStaff();
  }

  function renderCard() {
    var ch = S.active.ch;
    var card = el.card;
    card.textContent = '';
    card.appendChild(UI.avatar(ch, 'lg'));
    card.appendChild(UI.nameNode(ch, 'chan-card__name'));
    card.appendChild(make('p', 'chan-card__meta', '@' + ch.username + ' · ' + followers(ch.followersCount)));
    if (ch.description) card.appendChild(make('p', 'chan-card__desc', ch.description));

    var actions = make('div', 'chan-card__actions');
    if (ch.myRole !== 'owner') {
      var f = make('button', ch.following ? 'btn btn--ghost' : 'btn', ch.following ? 'Mengikuti ✓' : 'Ikuti');
      f.type = 'button';
      f.addEventListener('click', toggleFollow);
      actions.appendChild(f);
    }
    if (ch.following) {
      var m = make('button', 'btn btn--ghost', ch.muted ? 'Aktifkan notifikasi' : 'Senyapkan');
      m.type = 'button';
      m.setAttribute('aria-pressed', String(!!ch.muted));
      m.addEventListener('click', toggleMute);
      actions.appendChild(m);
    }
    card.appendChild(actions);
  }

  async function toggleFollow() {
    var ch = S.active.ch;
    try {
      if (ch.following) {
        var ok = await UI.confirm({ title: 'Berhenti mengikuti?', text: ch.name + ' akan hilang dari daftar "Mengikuti".', okText: 'Berhenti' });
        if (!ok) return;
        var r = await Api.del('/api/channels/' + ch.id + '/follow');
        Object.assign(ch, { following: false, muted: false, followersCount: r.channel.followersCount });
      } else {
        var r2 = await Api.post('/api/channels/' + ch.id + '/follow');
        Object.assign(ch, { following: true, followersCount: r2.channel.followersCount });
      }
      renderHead();
      renderCard();
      if (S.scope === 'following') loadList(false);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function toggleMute() {
    var ch = S.active.ch;
    try {
      var r = await Api.put('/api/channels/' + ch.id + '/mute', { muted: !ch.muted });
      ch.muted = r.muted;
      renderCard();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* =============== Postingan =============== */
  function canManage(p) { return role() === 'owner' || (role() === 'admin' && p.authorId === me.id); }

  function buildPost(p) {
    var art = make('article', 'post' + (p.pinned ? ' post--pinned' : ''));
    art.dataset.id = p.id;
    var head = make('div', 'post__head');
    var who = make('div', 'post__who');
    who.appendChild(UI.avatar(S.active.ch, 'sm'));
    var wt = make('div', 'post__whotext');
    wt.appendChild(UI.nameNode(S.active.ch, 'item__name'));
    wt.appendChild(make('span', 'post__time', (p.pinned ? '📌 Disematkan · ' : '') + postTime(p.createdAt) + (p.edited ? ' · diedit' : '')));
    who.appendChild(wt);
    head.appendChild(who);
    if (isStaff()) {
      var more = make('button', 'icon-btn post__more');
      more.type = 'button';
      more.setAttribute('aria-label', 'Opsi postingan');
      more.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-more"/></svg>'; // markup statis, tanpa data user
      head.appendChild(more);
    }
    art.appendChild(head);
    if (p.attachment) art.appendChild(Attach.render(p.attachment, p.kind));
    if (p.content) { var tx = make('p', 'post__text'); Attach.linkify(tx, p.content); art.appendChild(tx); }

    var foot = make('div', 'post__foot');
    var rx = make('div', 'post__rx');
    REACTIONS.forEach(function (emoji) {
      var n = p.reactionCounts[emoji] || 0;
      var b = make('button', 'rx', n ? emoji + ' ' + UI.fmtCount(n) : emoji);
      b.type = 'button';
      b.dataset.emoji = emoji;
      b.setAttribute('aria-pressed', String(p.myReaction === emoji));
      b.setAttribute('aria-label', 'Reaksi ' + emoji + (n ? ', ' + n : ''));
      rx.appendChild(b);
    });
    foot.appendChild(rx);
    foot.appendChild(make('span', 'post__views', '👁 ' + UI.fmtCount(p.viewsCount)));
    art.appendChild(foot);
    if (observer) observer.observe(art);
    return art;
  }

  function storePost(p) {
    var a = S.active;
    var old = a.byId.get(p.id);
    if (old) Object.assign(old, p); else a.byId.set(p.id, p);
    return a.byId.get(p.id);
  }

  function refreshPost(p) {
    var stored = storePost(p);
    var node = el.scroll.querySelector('.post[data-id="' + p.id + '"]');
    if (node) node.replaceWith(buildPost(stored));
  }

  function renderPinned() {
    el.pinned.textContent = '';
    if (S.active.pinned) el.pinned.appendChild(buildPost(S.active.pinned));
  }

  function updateEmpty() {
    var a = S.active;
    el.postsEmpty.hidden = !!(a.posts.length || a.pinned) || a.loading;
  }

  async function loadPosts(reset) {
    var a = S.active;
    a.loading = true;
    if (reset) { el.posts.textContent = ''; el.postsLoading.hidden = false; el.postsMore.hidden = true; el.postsEmpty.hidden = true; }
    try {
      var before = !reset && a.posts.length ? '&before=' + a.posts[a.posts.length - 1].id : '';
      var d = await Api.get('/api/channels/' + a.ch.id + '/posts?limit=20' + before);
      if (S.active !== a) return;
      if (reset) { a.posts = []; a.byId = new Map(); a.pinned = null; }
      if (d.pinned) a.pinned = storePost(d.pinned);
      d.posts.forEach(function (p) {
        a.posts.push(storePost(p));
        el.posts.appendChild(buildPost(a.byId.get(p.id)));
      });
      a.hasMore = d.hasMore;
      renderPinned();
    } catch (err) {
      if (S.active === a) UI.toast(err.message, 'error');
    } finally {
      if (S.active === a) {
        a.loading = false;
        el.postsLoading.hidden = true;
        el.postsMore.hidden = !a.hasMore;
        updateEmpty();
      }
    }
  }

  /* =============== Buka / tutup saluran =============== */
  async function openChannel(id) {
    if (S.active) XenSocket.emit('channel:leave', { channelId: S.active.ch.id }).catch(function () {});
    var stub = S.list.filter(function (c) { return c.id === id; })[0];
    S.active = { ch: Object.assign({ myRole: 'none', following: false }, stub), posts: [], byId: new Map(), pinned: null, hasMore: false, loading: true };
    clearEdit();
    if (!S.pushed && !desktopMq.matches) { history.pushState({ xenChan: true }, '', location.href); S.pushed = true; }
    el.pane.classList.add('is-open');
    el.paneEmpty.hidden = true;
    el.main.hidden = false;
    el.composer.hidden = true;
    el.pinned.textContent = '';
    renderHead();
    renderCard();
    renderList();
    XenSocket.emit('channel:join', { channelId: id }).catch(function () { /* diulang saat tersambung */ });
    try {
      var d = await Api.get('/api/channels/' + id);
      if (!S.active || S.active.ch.id !== id) return;
      S.active.ch = d.channel;
      renderHead();
      renderCard();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
    loadPosts(true);
  }

  function doClose() {
    if (S.active) XenSocket.emit('channel:leave', { channelId: S.active.ch.id }).catch(function () {});
    S.active = null;
    S.pushed = false;
    clearEdit();
    el.pane.classList.remove('is-open');
    el.paneEmpty.hidden = false;
    el.main.hidden = true;
    renderList();
  }
  function closePane() { if (S.pushed) history.back(); else doClose(); }

  /* =============== Composer =============== */
  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  }
  function clearEdit() {
    if (S.editing) { el.input.value = ''; autosize(); }
    S.editing = null;
    el.bar.hidden = true;
  }

  async function submitPost(e) {
    e.preventDefault();
    var text = el.input.value;
    if (!text.trim() || !S.active) return;
    el.send.disabled = true;
    try {
      if (S.editing) {
        var d = await Api.patch('/api/channel-posts/' + S.editing.id, { content: text });
        refreshPost(Object.assign({}, d.post, { myReaction: S.editing.myReaction }));
        S.editing = null;
        el.bar.hidden = true;
      } else {
        var r = await Api.post('/api/channels/' + S.active.ch.id + '/posts', { content: text });
        addNewPost(r.post);
      }
      el.input.value = '';
      autosize();
    } catch (err) { UI.toast(err.message, 'error'); }
    finally { el.send.disabled = false; }
  }

  function addNewPost(p) {
    var a = S.active;
    if (!a || a.ch.id !== p.channelId || a.byId.has(p.id)) return;
    a.posts.unshift(storePost(p));
    el.posts.insertBefore(buildPost(a.byId.get(p.id)), el.posts.firstChild);
    updateEmpty();
  }

  /* =============== Menu postingan =============== */
  function openPostMenu(id) {
    var p = S.active && S.active.byId.get(id);
    if (!p) return;
    S.menuPost = p;
    $('#cpm-pin').textContent = p.pinned ? 'Lepas sematan' : 'Sematkan';
    $('#cpm-edit').hidden = !canManage(p) || p.kind !== 'text';
    $('#cpm-delete').hidden = !canManage(p);
    $('#chan-post-menu').showModal();
  }

  async function react(id, emoji) {
    try {
      var r = await Api.post('/api/channel-posts/' + id + '/reaction', { emoji: emoji });
      refreshPost(r.post);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* =============== Form buat / edit saluran =============== */
  var FIELD = { name: '#chan-name', username: '#chan-username', description: '#chan-desc' };
  function setErr(name, msg) {
    var out = $('#chan-err-' + name);
    var inp = FIELD[name] ? $(FIELD[name]) : null;
    if (out) out.textContent = msg || '';
    if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  }

  function renderFormAvatar() {
    var box = $('#chan-avatar');
    box.textContent = '';
    var url = '';
    if (typeof pendingAvatar === 'string') url = pendingAvatar;
    else if (pendingAvatar === undefined && formMode === 'edit') url = S.active.ch.avatarUrl;
    box.appendChild(UI.avatar({ name: $('#chan-name').value || 'S', avatarUrl: url }, 'lg'));
  }

  function renderAdmins() {
    var ul = $('#chan-admin-list');
    ul.textContent = '';
    (S.active.ch.admins || []).forEach(function (u) {
      var li = make('li');
      var row = make('div', 'item item--static');
      row.appendChild(UI.avatar(u));
      var main = make('span', 'item__main');
      main.appendChild(UI.nameNode(u, 'item__name'));
      main.appendChild(make('span', 'item__preview truncate', '@' + u.username));
      var rm = make('button', 'btn btn--ghost btn--sm', 'Hapus');
      rm.type = 'button';
      rm.addEventListener('click', async function () {
        try {
          await Api.del('/api/channels/' + S.active.ch.id + '/admins/' + u.id);
          S.active.ch.admins = S.active.ch.admins.filter(function (a) { return a.id !== u.id; });
          renderAdmins();
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      row.appendChild(main);
      row.appendChild(rm);
      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  function openForm(mode) {
    formMode = mode;
    pendingAvatar = undefined;
    ['name', 'username', 'description', 'avatar'].forEach(function (n) { setErr(n, ''); });
    $('#chan-form-error').textContent = '';
    var ch = mode === 'edit' ? S.active.ch : null;
    $('#chan-name').value = ch ? ch.name : '';
    $('#chan-username').value = ch ? ch.username : '';
    $('#chan-desc').value = ch ? ch.description : '';
    $('#chan-dlg-title').textContent = ch ? 'Pengaturan saluran' : 'Buat saluran';
    $('#chan-save').textContent = ch ? 'Simpan' : 'Buat saluran';
    $('#chan-admins').hidden = !ch;
    if (ch) renderAdmins();
    renderFormAvatar();
    $('#chan-dialog').showModal();
  }

  async function submitForm(e) {
    e.preventDefault();
    var btn = $('#chan-save');
    var label = btn.textContent;
    ['name', 'username', 'description', 'avatar'].forEach(function (n) { setErr(n, ''); });
    $('#chan-form-error').textContent = '';
    var payload = { name: $('#chan-name').value, username: $('#chan-username').value, description: $('#chan-desc').value };
    if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;
    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
    try {
      if (formMode === 'edit') {
        var d = await Api.patch('/api/channels/' + S.active.ch.id, payload);
        Object.assign(S.active.ch, d.channel);
        renderHead();
        renderCard();
        loadList(false);
        $('#chan-dialog').close();
        UI.toast('Saluran diperbarui.', 'success');
      } else {
        var r = await Api.post('/api/channels', payload);
        $('#chan-dialog').close();
        UI.toast('Saluran dibuat.', 'success');
        S.scope = 'following';
        $('#chan-tabs').querySelectorAll('[role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.scope === 'following')); });
        $('#chan-search').value = '';
        S.q = '';
        await loadList(false);
        openChannel(r.channel.id);
      }
    } catch (err) {
      if (err.fields) Object.keys(err.fields).forEach(function (n) { setErr(n, err.fields[n]); });
      $('#chan-form-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* =============== Event realtime =============== */
  function bindSocket() {
    XenSocket.onConnect(function (reconnect) {
      if (!S.active) return;
      XenSocket.emit('channel:join', { channelId: S.active.ch.id }).catch(function () {});
      if (reconnect) loadPosts(true);
    });

    XenSocket.on('channel:post:new', function (p) { addNewPost(p.post); });

    XenSocket.on('channel:post:edit', function (p) {
      var a = S.active;
      if (!a || !a.byId.has(p.post.id)) return;
      refreshPost(Object.assign({}, p.post, { myReaction: a.byId.get(p.post.id).myReaction }));
    });

    XenSocket.on('channel:post:delete', function (p) {
      var a = S.active;
      if (!a || a.ch.id !== p.channelId) return;
      a.byId.delete(p.postId);
      a.posts = a.posts.filter(function (x) { return x.id !== p.postId; });
      if (a.pinned && a.pinned.id === p.postId) { a.pinned = null; renderPinned(); }
      var node = el.scroll.querySelector('.post[data-id="' + p.postId + '"]');
      if (node) node.remove();
      updateEmpty();
    });

    XenSocket.on('channel:post:pin', function (p) {
      if (S.active && S.active.ch.id === p.channelId) loadPosts(true);
    });

    XenSocket.on('channel:post:reaction', function (p) {
      var a = S.active;
      var post = a && a.byId.get(p.postId);
      if (!post) return;
      post.reactionCounts = p.reactionCounts;
      if (p.actorId === me.id) post.myReaction = p.actorEmoji;
      refreshPost(post);
    });

    XenSocket.on('channel:update', function (p) {
      var c = p.channel;
      S.list.forEach(function (x) { if (x.id === c.id) Object.assign(x, c); });
      if (S.active && S.active.ch.id === c.id) {
        Object.assign(S.active.ch, c);
        renderHead();
        renderCard();
      }
      renderList();
    });

    XenSocket.on('channel:delete', function (p) {
      S.list = S.list.filter(function (x) { return x.id !== p.channelId; });
      if (S.active && S.active.ch.id === p.channelId) { closePane(); UI.toast('Saluran telah dihapus.'); }
      renderList();
    });
  }

  /* =============== Init =============== */
  function init(user) {
    me = user;
    el = {
      list: $('#chan-list'), loading: $('#chan-loading'), empty: $('#chan-empty'), error: $('#chan-error'), more: $('#chan-more'),
      pane: $('#chan-pane'), paneEmpty: $('#chan-pane-empty'), main: $('#chan-main'),
      headAvatar: $('#chan-head-avatar'), headTitle: $('#chan-head-title'), headSub: $('#chan-head-sub'), edit: $('#chan-edit'),
      scroll: $('#chan-scroll'), card: $('#chan-card'), pinned: $('#chan-pinned'), posts: $('#chan-posts'),
      postsLoading: $('#chan-posts-loading'), postsEmpty: $('#chan-posts-empty'), postsMore: $('#chan-posts-more'),
      bar: $('#chan-bar'), composer: $('#chan-composer'), input: $('#chan-input'), send: $('#chan-send')
    };

    // Hitung view saat postingan benar-benar terlihat; server menjamin 1 view / user / post.
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting || en.intersectionRatio < 0.6) return;
          var id = en.target.dataset.id;
          observer.unobserve(en.target);
          if (viewed.has(id)) return;
          viewed.add(id);
          Api.post('/api/channel-posts/' + id + '/view').then(function (r) {
            var p = S.active && S.active.byId.get(id);
            if (p) {
              p.viewsCount = r.viewsCount;
              var span = en.target.querySelector('.post__views');
              if (span) span.textContent = '👁 ' + UI.fmtCount(r.viewsCount);
            }
          }).catch(function () { viewed.delete(id); });
        });
      }, { root: el.scroll, threshold: 0.6 });
    }

    el.list.addEventListener('click', function (e) {
      var b = e.target.closest('.item');
      if (b) openChannel(b.dataset.id);
    });
    el.more.addEventListener('click', function () { loadList(true); });
    $('#chan-retry').addEventListener('click', function () { loadList(false); });
    $('#chan-empty-go').addEventListener('click', function () { setScope('discover'); });
    var csearch = $('#chan-search');
    var cclear = $('#chan-search-clear');
    csearch.addEventListener('input', function () { cclear.hidden = !csearch.value; });
    cclear.addEventListener('click', function () { csearch.value = ''; cclear.hidden = true; csearch.dispatchEvent(new Event('input')); csearch.focus(); });
    $('#chan-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[role="tab"]');
      if (b && b.dataset.scope !== S.scope) setScope(b.dataset.scope);
    });
    $('#chan-search').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      var q = e.target.value.trim().replace(/^@/, '');
      searchTimer = setTimeout(function () {
        if (q.length === 1) return;
        S.q = q;
        if (q) { S.scope = 'discover'; $('#chan-tabs').querySelectorAll('[role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.scope === 'discover')); }); }
        loadList(false);
      }, 300);
    });

    $('#chan-back').addEventListener('click', closePane);
    window.addEventListener('popstate', function () { if (S.active && S.pushed) { S.pushed = false; doClose(); } });
    el.postsMore.addEventListener('click', function () { if (S.active && !S.active.loading) loadPosts(false); });

    el.scroll.addEventListener('click', function (e) {
      var art = e.target.closest('.post');
      if (!art) return;
      var rx = e.target.closest('.rx');
      if (rx) { react(art.dataset.id, rx.dataset.emoji); return; }
      if (e.target.closest('.post__more')) openPostMenu(art.dataset.id);
    });

    el.composer.addEventListener('submit', submitPost);
    el.send.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    el.input.addEventListener('input', autosize);
    el.input.addEventListener('keydown', function (e) {
      var pref = XenPrefs.get('enterToSend');
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (pref === undefined ? finePointer.matches : pref === 'on')) { e.preventDefault(); submitPost(e); }
      else if (e.key === 'Escape') clearEdit();
    });
    $('#chan-bar-close').addEventListener('click', clearEdit);
    $('#chan-attach').addEventListener('click', function () {
      if (!S.active) return;
      var id = S.active.ch.id;
      Attach.start({
        kinds: ['image', 'video', 'audio', 'file'],
        upload: function (file, kind, caption, onProgress) {
          return Attach.upload('/api/channels/' + id + '/posts/attachment?' + Attach.q({ kind: kind, name: file.name, caption: caption.trim() }), file, onProgress);
        }
      });
    });
    $('#chan-share').addEventListener('click', function () {
      if (S.active) Pages.share(location.origin + '/channel/' + S.active.ch.username, S.active.ch.name);
    });
    $('#chan-transfer-btn').addEventListener('click', async function () {
      var input = $('#chan-transfer-input');
      var name = input.value.trim().replace(/^@/, '').toLowerCase();
      if (!name || !S.active) return;
      try {
        var u = await Api.get('/api/users/' + encodeURIComponent(name));
        var ok = await UI.confirm({ title: 'Pindahkan kepemilikan?', text: u.user.name + ' akan menjadi pemilik saluran. Kamu menjadi admin.', okText: 'Pindahkan' });
        if (!ok) return;
        var r = await Api.post('/api/channels/' + S.active.ch.id + '/transfer/' + u.user.id);
        Object.assign(S.active.ch, r.channel);
        input.value = '';
        $('#chan-dialog').close();
        renderHead();
        renderCard();
        UI.toast('Kepemilikan dipindahkan.', 'success');
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    var menu = $('#chan-post-menu');
    menu.addEventListener('click', function (e) { if (e.target === menu) menu.close(); });
    $('#cpm-pin').addEventListener('click', async function () {
      menu.close();
      try { await Api.post('/api/channels/' + S.active.ch.id + '/pin/' + S.menuPost.id); loadPosts(true); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#cpm-edit').addEventListener('click', function () {
      menu.close();
      S.editing = S.menuPost;
      el.input.value = S.menuPost.content;
      autosize();
      el.bar.hidden = false;
      el.input.focus();
    });
    $('#cpm-delete').addEventListener('click', async function () {
      menu.close();
      var ok = await UI.confirm({ title: 'Hapus postingan ini?', text: 'Postingan akan hilang untuk semua pengikut.', okText: 'Hapus' });
      if (!ok) return;
      try { await Api.del('/api/channel-posts/' + S.menuPost.id); } catch (err) { UI.toast(err.message, 'error'); }
    });

    var dlg = $('#chan-dialog');
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    $('#chan-new').addEventListener('click', function () { openForm('create'); });
    $('#chan-edit').addEventListener('click', function () { if (S.active) openForm('edit'); });
    $('#chan-close').addEventListener('click', function () { dlg.close(); });
    $('#chan-form').addEventListener('submit', submitForm);
    $('#chan-pick').addEventListener('click', function () { $('#chan-file').click(); });
    $('#chan-file').addEventListener('change', async function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { pendingAvatar = await UI.resizeImage(f); renderFormAvatar(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#chan-remove-avatar').addEventListener('click', function () { pendingAvatar = null; renderFormAvatar(); });

    $('#chan-admin-add').addEventListener('click', async function () {
      var input = $('#chan-admin-input');
      var name = input.value.trim().replace(/^@/, '').toLowerCase();
      if (!name) return;
      try {
        var u = await Api.get('/api/users/' + encodeURIComponent(name));
        await Api.post('/api/channels/' + S.active.ch.id + '/admins/' + u.user.id);
        S.active.ch.admins = (S.active.ch.admins || []).concat([u.user]);
        input.value = '';
        renderAdmins();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#chan-delete').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Hapus saluran?', text: 'Semua postingan dan pengikut akan dihapus. Tindakan ini tidak bisa dibatalkan.', okText: 'Hapus saluran' });
      if (!ok) return;
      try { await Api.del('/api/channels/' + S.active.ch.id); dlg.close(); } catch (err) { UI.toast(err.message, 'error'); }
    });

    bindSocket();
    loadList(false);
  }

  async function openByUsername(username) {
    try {
      var d = await Api.get('/api/channels/by-username/' + encodeURIComponent(username));
      openChannel(d.channel.id);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  return { init: init, openById: openChannel, openByUsername: openByUsername };
})();
