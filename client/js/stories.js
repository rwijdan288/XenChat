/* Story: daftar, buat story (image/video), penampil, reaksi, balasan, penonton. */
var Stories = (function () {
  'use strict';

  var REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
  var IMAGE_MS = 5000;
  var MAX_IMAGE = 10 * 1024 * 1024;
  var MAX_VIDEO = 25 * 1024 * 1024;

  var me = null;
  var feed = { mine: [], users: [] };
  var V = { entries: [], ei: 0, si: 0, timer: null, video: null, open: false };
  var pending = null; // { file, url, isVideo }
  var refreshTimer = null;

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* =============== Daftar =============== */
  function ringAvatar(user, unseen) {
    var ring = make('span', 'ring' + (unseen ? ' ring--unseen' : ''));
    ring.appendChild(UI.avatar(user));
    return ring;
  }

  function row(entry, index) {
    var li = make('li');
    var b = make('button', 'item');
    b.type = 'button';
    b.dataset.index = String(index);
    b.appendChild(ringAvatar(entry.user, entry.hasUnseen));
    var main = make('span', 'item__main');
    main.appendChild(UI.nameNode(entry.user, 'item__name'));
    main.appendChild(make('span', 'item__preview truncate', entry.stories.length + ' story · ' + UI.timeShort(entry.latestAt)));
    b.appendChild(main);
    li.appendChild(b);
    return li;
  }

  function renderList() {
    $('#story-loading').hidden = true;
    $('#story-error').hidden = true;
    var recent = $('#story-recent');
    var viewed = $('#story-viewed');
    recent.textContent = '';
    viewed.textContent = '';
    var nr = 0;
    var nv = 0;
    feed.users.forEach(function (e, i) {
      if (e.hasUnseen) { recent.appendChild(row(e, i)); nr++; } else { viewed.appendChild(row(e, i)); nv++; }
    });
    $('#story-recent-title').hidden = !nr;
    $('#story-viewed-title').hidden = !nv;
    $('#story-empty').hidden = !!(nr || nv) || feed.mine.length > 0;

    var box = $('#story-mine-avatar');
    box.textContent = '';
    box.appendChild(ringAvatar(me, false));
    $('#story-mine-sub').textContent = feed.mine.length ? feed.mine.length + ' story aktif · ketuk untuk melihat' : 'Ketuk + untuk menambah story';
  }

  async function load() {
    if (!feed.users.length && !feed.mine.length) $('#story-loading').hidden = false;
    try {
      feed = await Api.get('/api/stories');
      renderList();
    } catch (err) {
      $('#story-loading').hidden = true;
      if (!feed.users.length) $('#story-error').hidden = false;
      UI.toast(err.message, 'error');
    }
  }

  function loadSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(load, 400); }

  /* =============== Buat story =============== */
  function resetPreview() {
    if (pending && pending.url) URL.revokeObjectURL(pending.url);
    pending = null;
    $('#story-preview').textContent = '';
  }

  function pickFile(file) {
    var isVideo = /^video\//.test(file.type);
    var isImage = /^image\/(jpeg|png|webp)$/.test(file.type);
    if (!isImage && !(isVideo && /^video\/(mp4|quicktime|webm)$/.test(file.type))) { UI.toast('Format tidak didukung. Gunakan JPEG, PNG, WebP, MP4, MOV, atau WebM.', 'error'); return; }
    if (isImage && file.size > MAX_IMAGE) { UI.toast('Gambar maksimal 10 MB.', 'error'); return; }
    if (isVideo && file.size > MAX_VIDEO) { UI.toast('Video maksimal 25 MB.', 'error'); return; }

    resetPreview();
    var url = URL.createObjectURL(file);
    pending = { file: file, url: url, isVideo: isVideo };
    var box = $('#story-preview');
    var el;
    if (isVideo) {
      el = document.createElement('video');
      el.muted = true; el.controls = true; el.playsInline = true; el.preload = 'metadata';
      el.addEventListener('loadedmetadata', function () {
        if (el.duration > 60.5) { UI.toast('Durasi video maksimal 60 detik.', 'error'); $('#story-dialog').close(); }
      });
    } else {
      el = document.createElement('img');
      el.alt = 'Pratinjau story';
    }
    el.src = url;
    box.appendChild(el);
    $('#story-caption').value = '';
    $('#story-form-error').textContent = '';
    $('#story-dialog').showModal();
  }

  async function submitStory(e) {
    e.preventDefault();
    if (!pending) return;
    var btn = $('#story-post');
    btn.disabled = true;
    btn.textContent = 'Mengunggah…';
    $('#story-form-error').textContent = '';
    try {
      var res = await fetch('/api/stories?caption=' + encodeURIComponent($('#story-caption').value) + '&privacy=' + encodeURIComponent($('#story-privacy').value), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pending.file
      });
      var data = null;
      try { data = await res.json(); } catch (x) { /* bukan JSON */ }
      if (!res.ok) throw new Error((data && data.message) || 'Gagal mengunggah story. Silakan coba lagi.');
      $('#story-dialog').close();
      UI.toast('Story dibagikan.', 'success');
      load();
    } catch (err) {
      $('#story-form-error').textContent = err instanceof TypeError ? 'Tidak dapat terhubung ke server. Periksa koneksimu.' : err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Bagikan';
    }
  }

  /* =============== Penampil =============== */
  function curEntry() { return V.entries[V.ei]; }
  function curStory() { return V.entries[V.ei].stories[V.si]; }
  function isMine() { return curEntry().user.id === me.id; }

  function stopMedia() {
    clearTimeout(V.timer);
    V.timer = null;
    if (V.video) { V.video.pause(); V.video.removeAttribute('src'); V.video.load(); V.video = null; }
  }

  function fillBar(fill, ms) {
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + ms + 'ms linear';
    fill.style.width = '100%';
  }

  function renderBars() {
    var bars = $('#sv-bars');
    bars.textContent = '';
    curEntry().stories.forEach(function (s, i) {
      var bar = make('span', 'sv__bar');
      var fill = make('span', 'sv__fill');
      if (i < V.si) fill.style.width = '100%';
      bar.appendChild(fill);
      bars.appendChild(bar);
    });
    return bars.children[V.si].firstChild;
  }

  function renderFoot(s) {
    var mine = isMine();
    var views = $('#sv-views');
    views.hidden = !mine;
    if (mine) views.textContent = '👁 ' + (s.viewsCount || 0) + ' dilihat';
    $('#sv-delete').hidden = !mine;
    $('#sv-react').hidden = mine;
    $('#sv-reply').hidden = mine;
    var react = $('#sv-react');
    react.textContent = '';
    if (!mine) {
      REACTIONS.forEach(function (emoji) {
        var b = make('button', 'react-btn', emoji);
        b.type = 'button';
        b.dataset.emoji = emoji;
        b.setAttribute('aria-label', 'Reaksi ' + emoji);
        b.setAttribute('aria-pressed', String(s.myReaction === emoji));
        react.appendChild(b);
      });
    }
  }

  function show() {
    stopMedia();
    var e = curEntry();
    var s = curStory();
    $('#sv-avatar').textContent = '';
    $('#sv-avatar').appendChild(UI.avatar(e.user, 'sm'));
    $('#sv-name').textContent = e.user.id === me.id ? 'Cerita Anda' : e.user.name;
    $('#sv-time').textContent = UI.timeShort(s.createdAt);
    $('#sv-caption').textContent = s.caption || '';
    $('#sv-caption').hidden = !s.caption;
    renderFoot(s);
    var fill = renderBars();

    var box = $('#sv-media');
    box.textContent = '';
    var fail = function () { box.textContent = ''; box.appendChild(make('p', 'sv__fail', 'Media gagal dimuat.')); };
    if (s.type === 'video') {
      var v = document.createElement('video');
      v.playsInline = true; v.autoplay = true; v.preload = 'auto';
      v.addEventListener('timeupdate', function () { if (v.duration) { fill.style.transition = 'none'; fill.style.width = (v.currentTime / v.duration * 100) + '%'; } });
      v.addEventListener('ended', next);
      v.addEventListener('error', fail);
      v.src = s.media.url;
      box.appendChild(v);
      V.video = v;
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* autoplay ditolak: pengguna bisa mengetuk untuk lanjut */ });
    } else {
      var img = document.createElement('img');
      img.alt = s.caption || 'Story';
      img.addEventListener('error', fail);
      img.addEventListener('load', function () { fillBar(fill, IMAGE_MS); V.timer = setTimeout(next, IMAGE_MS); });
      img.src = s.media.url;
      box.appendChild(img);
    }

    if (e.user.id !== me.id && !s.viewed) {
      s.viewed = true;
      Api.post('/api/stories/' + s.id + '/view').catch(function () { /* story mungkin kedaluwarsa */ });
    }
  }

  function firstUnseen(entry) {
    for (var i = 0; i < entry.stories.length; i++) if (!entry.stories[i].viewed) return i;
    return 0;
  }

  function openViewer(entries, index) {
    V.entries = entries;
    V.ei = index;
    V.si = firstUnseen(entries[index]);
    V.open = true;
    $('#story-viewer').hidden = false;
    show();
    $('#sv-close').focus();
  }

  function closeViewer() {
    stopMedia();
    V.open = false;
    $('#story-viewer').hidden = true;
    load();
  }

  function next() {
    var e = curEntry();
    if (V.si < e.stories.length - 1) { V.si++; show(); }
    else if (V.ei < V.entries.length - 1) { V.ei++; V.si = firstUnseen(V.entries[V.ei]); show(); }
    else closeViewer();
  }

  function prev() {
    if (V.si > 0) { V.si--; show(); }
    else if (V.ei > 0) { V.ei--; V.si = 0; show(); }
    else show(); // ulang story pertama
  }

  function pause() { clearTimeout(V.timer); if (V.video) V.video.pause(); }
  function resume() {
    if (!V.open) return;
    if (V.video) V.video.play().catch(function () {});
    else if (curStory().type === 'image') {
      var fill = $('#sv-bars').children[V.si].firstChild;
      fillBar(fill, IMAGE_MS);
      V.timer = setTimeout(next, IMAGE_MS);
    }
  }

  async function react(emoji) {
    var s = curStory();
    try {
      var r = await Api.post('/api/stories/' + s.id + '/reaction', { emoji: emoji });
      s.myReaction = r.reaction;
      renderFoot(s);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function sendReply(e) {
    e.preventDefault();
    var input = $('#sv-input');
    var text = input.value.trim();
    if (!text) return;
    try {
      await Api.post('/api/stories/' + curStory().id + '/reply', { content: text });
      input.value = '';
      input.blur();
      UI.toast('Balasan terkirim.', 'success');
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function showViewers() {
    var s = curStory();
    pause();
    var dlg = $('#sv-viewers-dialog');
    var ul = $('#svv-list');
    var state = $('#svv-state');
    ul.textContent = '';
    state.textContent = 'Memuat…';
    dlg.addEventListener('close', resume, { once: true });
    dlg.showModal();
    try {
      var d = await Api.get('/api/stories/' + s.id + '/viewers?limit=50');
      d.viewers.forEach(function (v) {
        var li = make('li');
        var r = make('div', 'item item--static');
        r.appendChild(UI.avatar(v.user));
        var main = make('span', 'item__main');
        main.appendChild(UI.nameNode(v.user, 'item__name'));
        main.appendChild(make('span', 'item__preview', UI.timeShort(v.at)));
        r.appendChild(main);
        if (v.reaction) r.appendChild(make('span', 'viewer-reaction', v.reaction));
        li.appendChild(r);
        ul.appendChild(li);
      });
      state.textContent = d.viewers.length ? '' : 'Belum ada yang melihat.';
    } catch (err) { state.textContent = err.message; }
  }

  async function deleteCurrent() {
    var s = curStory();
    pause();
    var ok = await UI.confirm({ title: 'Hapus story ini?', text: 'Story akan hilang untuk semua orang.', okText: 'Hapus' });
    if (!ok) { resume(); return; }
    try {
      await Api.del('/api/stories/' + s.id);
      var e = curEntry();
      e.stories.splice(V.si, 1);
      feed.mine = feed.mine.filter(function (x) { return x.id !== s.id; });
      if (!e.stories.length) { closeViewer(); return; }
      if (V.si >= e.stories.length) V.si = e.stories.length - 1;
      show();
    } catch (err) { UI.toast(err.message, 'error'); resume(); }
  }

  /* =============== Init =============== */
  function init(user) {
    me = user;
    var file = $('#story-file');
    $('#story-add').addEventListener('click', function () { file.click(); });
    $('#story-empty-add').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) pickFile(f);
    });
    $('#story-mine-open').addEventListener('click', function () {
      if (feed.mine.length) openViewer([{ user: me, stories: feed.mine }], 0);
      else file.click();
    });
    $('#story-recent').addEventListener('click', onRow);
    $('#story-viewed').addEventListener('click', onRow);
    function onRow(e) {
      var b = e.target.closest('.item');
      if (b) openViewer(feed.users, Number(b.dataset.index));
    }
    $('#story-retry').addEventListener('click', load);

    $('#story-form').addEventListener('submit', submitStory);
    $('#story-close').addEventListener('click', function () { $('#story-dialog').close(); });
    $('#story-dialog').addEventListener('close', resetPreview);

    $('#sv-close').addEventListener('click', closeViewer);
    $('#sv-next').addEventListener('click', next);
    $('#sv-prev').addEventListener('click', prev);
    $('#sv-delete').addEventListener('click', deleteCurrent);
    $('#sv-views').addEventListener('click', showViewers);
    $('#sv-react').addEventListener('click', function (e) {
      var b = e.target.closest('.react-btn');
      if (b) react(b.dataset.emoji);
    });
    $('#sv-reply').addEventListener('submit', sendReply);
    $('#sv-input').addEventListener('focus', pause);
    $('#sv-input').addEventListener('blur', resume);
    document.addEventListener('keydown', function (e) {
      if (!V.open || e.target.matches('input, textarea')) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    });

    XenSocket.on('story:new', loadSoon);
    XenSocket.on('story:delete', loadSoon);
    XenSocket.on('story:view', function (p) {
      feed.mine.forEach(function (s) { if (s.id === p.storyId) s.viewsCount = p.viewsCount; });
      if (V.open && isMine() && curStory().id === p.storyId) { curStory().viewsCount = p.viewsCount; renderFoot(curStory()); }
    });
    XenSocket.on('story:reaction', function (p) {
      if (p.emoji) UI.toast(p.userName + ' bereaksi ' + p.emoji + ' pada story-mu.');
    });
    XenSocket.onConnect(function (reconnect) { if (reconnect) load(); });

    load();
  }

  return { init: init };
})();
