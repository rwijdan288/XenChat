/* Chat: daftar percakapan, panel percakapan, pesan realtime. Semua teks user dirender dengan textContent. */
var Chat = (function () {
  'use strict';

  var REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
  var EDIT_WINDOW_MS = 15 * 60 * 1000;

  var me = null;
  var S = {
    list: [], listHasMore: false, active: null, pushed: false,
    replyTo: null, editing: null, menuMsg: null,
    typing: false, typingSentAt: 0, typingStopTimer: null, typingHideTimer: null,
    readPending: false, sending: false
  };
  var el = {};
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  function enterSends() { var v = XenPrefs.get('enterToSend'); return v === undefined ? finePointer.matches : v === 'on'; }
  var desktopMq = window.matchMedia('(min-width: 1024px)');

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clockTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  function findConv(id) { return S.list.filter(function (c) { return c.id === id; })[0]; }
  function findByGroup(gid) { return S.list.filter(function (c) { return c.group && c.group.id === gid; })[0]; }
  // Entitas tampilan: lawan bicara (private) atau info grup.
  function peer(c) {
    return c.type === 'group'
      ? { id: c.group.id, name: c.group.name, avatarUrl: c.group.avatarUrl, verified: false, online: false }
      : c.user;
  }
  function senderOf(id) {
    var a = S.active;
    if (id === me.id) return { name: 'Kamu' };
    if (a && a.senders[id]) return a.senders[id];
    if (a && a.conv.type !== 'group') return a.conv.user;
    return { name: 'Anggota' };
  }

  /* =============== Daftar percakapan =============== */
  function previewOf(c) {
    if (!c.lastMessage) return '';
    if (c.lastMessage.deleted) return 'Pesan ini dihapus';
    var who = c.lastMessage.senderId === me.id ? 'Kamu: ' : (c.type === 'group' && c.lastMessage.senderName ? c.lastMessage.senderName + ': ' : '');
    return who + c.lastMessage.text;
  }

  function listItem(c) {
    var li = make('li');
    var pe = peer(c);
    var b = make('button', 'item' + (S.active && S.active.conv.id === c.id ? ' item--active' : ''));
    b.type = 'button';
    b.dataset.id = c.id;

    var wrap = make('span', 'avatar-wrap');
    wrap.appendChild(UI.avatar(pe));
    if (pe.online) wrap.appendChild(make('span', 'dot'));

    var main = make('span', 'item__main');
    var top = make('span', 'item__top');
    top.appendChild(UI.nameNode(pe, 'item__name'));
    top.appendChild(make('span', 'item__time', c.lastMessageAt ? UI.timeShort(c.lastMessageAt) : ''));
    var bottom = make('span', 'item__top');
    bottom.appendChild(make('span', 'item__preview truncate', previewOf(c) || (c.type === 'group' ? 'Grup dibuat' : '')));
    if (c.unreadCount > 0) {
      var u = make('span', 'unread', c.unreadCount > 99 ? '99+' : String(c.unreadCount));
      u.setAttribute('aria-label', c.unreadCount + ' pesan belum dibaca');
      bottom.appendChild(u);
    }
    main.appendChild(top);
    main.appendChild(bottom);

    b.appendChild(wrap);
    b.appendChild(main);
    li.appendChild(b);
    return li;
  }

  function renderList() {
    S.list.sort(function (a, b) { return new Date(b.lastMessageAt) - new Date(a.lastMessageAt); });
    el.list.textContent = '';
    S.list.forEach(function (c) { el.list.appendChild(listItem(c)); });
    el.empty.hidden = S.list.length > 0;
    el.more.hidden = !S.listHasMore;
    var total = 0;
    S.list.forEach(function (c) { total += c.unreadCount || 0; });
    if (window.App) App.setUnread(total);
  }

  function upsertConv(item) {
    var i = S.list.findIndex(function (c) { return c.id === item.id; });
    if (i >= 0) S.list[i] = item; else S.list.push(item);
    renderList();
  }

  async function loadList(more) {
    var before = more && S.list.length ? S.list[S.list.length - 1].lastMessageAt : null;
    if (!more) { el.loading.hidden = S.list.length > 0; el.error.hidden = true; }
    try {
      var d = await Api.get('/api/conversations?limit=30' + (before ? '&before=' + encodeURIComponent(before) : ''));
      d.conversations.forEach(function (c) {
        var i = S.list.findIndex(function (x) { return x.id === c.id; });
        if (i >= 0) S.list[i] = c; else S.list.push(c);
      });
      S.listHasMore = d.hasMore;
      el.loading.hidden = true;
      renderList();
    } catch (err) {
      el.loading.hidden = true;
      if (!S.list.length) el.error.hidden = false;
      UI.toast(err.message, 'error');
    }
  }

  /* =============== Pesan =============== */
  function setHint(text, retry) {
    el.hint.hidden = !text;
    el.hint.textContent = text || '';
    el.hint.disabled = !retry;
    el.hint.dataset.retry = retry ? '1' : '';
  }

  function updateHint() {
    var a = S.active;
    if (!a) return;
    if (a.loading) setHint('Memuat pesan…');
    else if (!a.messages.length) setHint('Ucapkan halo 👋');
    else setHint('');
  }

  function buildTick(m) {
    var t = make('span', 'tick' + (m.status === 'read' ? ' tick--read' : ''), m.status === 'sent' ? '✓' : '✓✓');
    t.setAttribute('aria-label', m.status === 'read' ? 'Dibaca' : m.status === 'delivered' ? 'Diterima' : 'Terkirim');
    return t;
  }

  function buildMsg(m) {
    var mine = m.senderId === me.id;
    var a = S.active;
    var row = make('div', 'msg ' + (mine ? 'msg--out' : 'msg--in'));
    row.dataset.id = m.id;

    var bubble = make('div', 'bubble' + (m.deleted ? ' bubble--deleted' : ''));
    if (!m.deleted) {
      bubble.setAttribute('role', 'button');
      bubble.tabIndex = 0;
      bubble.setAttribute('aria-label', 'Opsi pesan');
    }

    var inGroup = !!(a && a.conv.type === 'group');
    if (inGroup && !mine && !m.deleted) bubble.appendChild(make('span', 'bubble__sender', senderOf(m.senderId).name));

    if (m.storyReply) {
      var sq = make('span', 'quote');
      sq.appendChild(make('span', 'quote__name', 'Membalas story'));
      sq.appendChild(make('span', 'quote__text', m.storyReply.snippet || (m.storyReply.type === 'video' ? 'Video' : 'Foto')));
      bubble.appendChild(sq);
    }

    if (m.replyTo) {
      var q = make('span', 'quote');
      var unavailable = m.replyTo.deleted || m.replyTo.content === null;
      q.appendChild(make('span', 'quote__name', senderOf(m.replyTo.senderId).name));
      q.appendChild(make('span', 'quote__text', unavailable ? 'Pesan asli tidak tersedia' : m.replyTo.content.slice(0, 100)));
      bubble.appendChild(q);
    }

    if (m.deleted) {
      bubble.appendChild(make('span', 'bubble__text', 'Pesan ini dihapus'));
    } else {
      if (m.attachment) bubble.appendChild(Attach.render(m.attachment, m.type));
      if (m.content) { var tx = make('span', 'bubble__text'); Attach.linkify(tx, m.content); bubble.appendChild(tx); }
    }
    if (m.attachment && !m.deleted) bubble.classList.add('bubble--media');

    var meta = make('span', 'meta');
    meta.appendChild(make('span', null, clockTime(m.createdAt) + (m.edited && !m.deleted ? ' · diedit' : '')));
    if (mine && !m.deleted) meta.appendChild(buildTick(inGroup ? { status: 'sent' } : m));
    bubble.appendChild(meta);
    row.appendChild(bubble);

    if (m.reactions && m.reactions.length) {
      var counts = {};
      m.reactions.forEach(function (r) {
        counts[r.emoji] = counts[r.emoji] || { n: 0, mine: false };
        counts[r.emoji].n++;
        if (r.userId === me.id) counts[r.emoji].mine = true;
      });
      var wrap = make('div', 'reactions');
      Object.keys(counts).forEach(function (emoji) {
        var chip = make('button', 'chip' + (counts[emoji].mine ? ' chip--mine' : ''), emoji + ' ' + counts[emoji].n);
        chip.type = 'button';
        chip.dataset.emoji = emoji;
        chip.setAttribute('aria-label', 'Reaksi ' + emoji + ', ' + counts[emoji].n);
        wrap.appendChild(chip);
      });
      row.appendChild(wrap);
    }
    return row;
  }

  function nodeFor(id) { return el.msgs.querySelector('.msg[data-id="' + id + '"]'); }

  function nearBottom() { return el.msgs.scrollHeight - el.msgs.scrollTop - el.msgs.clientHeight < 140; }
  function scrollBottom() { el.msgs.scrollTop = el.msgs.scrollHeight; }

  function refreshNode(m) {
    var old = nodeFor(m.id);
    if (old) old.replaceWith(buildMsg(m));
  }

  // Tambah atau ganti pesan di percakapan aktif (dedupe berdasarkan id).
  function upsertMessage(m) {
    var a = S.active;
    var old = a.byId.get(m.id);
    if (old) {
      a.messages[a.messages.indexOf(old)] = m;
      a.byId.set(m.id, m);
      refreshNode(m);
      return false;
    }
    a.messages.push(m);
    a.byId.set(m.id, m);
    el.msgs.appendChild(buildMsg(m));
    refreshDecor();
    updateHint();
    return true;
  }

  function dayLabel(d) {
    var now = new Date(Api.now());
    if (d.toDateString() === now.toDateString()) return 'Hari ini';
    var y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Pemisah tanggal, pengelompokan pesan beruntun, dan pemisah "belum dibaca".
  function refreshDecor() {
    var a = S.active;
    if (!a) return;
    el.msgs.querySelectorAll('.dsep, .usep').forEach(function (n) { n.remove(); });
    var prev = null;
    el.msgs.querySelectorAll('.msg').forEach(function (row) {
      var m = a.byId.get(row.dataset.id);
      if (!m) return;
      var d = new Date(m.createdAt);
      var newDay = !prev || new Date(prev.createdAt).toDateString() !== d.toDateString();
      if (newDay) el.msgs.insertBefore(make('div', 'dsep', dayLabel(d)), row);
      row.classList.toggle('msg--cont', !!(prev && !newDay && prev.senderId === m.senderId && d - new Date(prev.createdAt) < 5 * 60000));
      prev = m;
    });
    if (a.unreadId) {
      var u = nodeFor(a.unreadId);
      if (u) { u.classList.remove('msg--cont'); el.msgs.insertBefore(make('div', 'usep', 'Pesan belum dibaca'), u); }
    }
  }

  function renderAll() {
    var a = S.active;
    el.msgs.textContent = '';
    el.msgs.appendChild(el.hint);
    a.messages.forEach(function (m) { el.msgs.appendChild(buildMsg(m)); });
    refreshDecor();
    updateHint();
  }

  async function loadLatest() {
    var a = S.active;
    a.loading = true;
    updateHint();
    try {
      var d = await Api.get('/api/conversations/' + a.conv.id + '/messages?limit=30');
      if (S.active !== a) return;
      Object.assign(a.senders, d.senders || {});
      a.messages = d.messages;
      a.byId = new Map(d.messages.map(function (m) { return [m.id, m]; }));
      a.hasMore = d.hasMore;
      a.loading = false;
      // Pesan pertama yang belum dibaca (dihitung dari jumlah unread saat percakapan dibuka).
      var seen = 0;
      for (var i = a.messages.length - 1; i >= 0 && a.unreadAtOpen > 0; i--) {
        if (a.messages[i].senderId !== me.id && ++seen === a.unreadAtOpen) { a.unreadId = a.messages[i].id; break; }
      }
      renderAll();
      scrollBottom();
      markReadIfNeeded();
    } catch (err) {
      if (S.active !== a) return;
      a.loading = false;
      setHint('Gagal memuat pesan. Ketuk untuk mencoba lagi.', true);
    }
  }

  async function loadOlder() {
    var a = S.active;
    if (!a || a.loading || !a.hasMore || !a.messages.length) return;
    a.loading = true;
    setHint('Memuat pesan lama…');
    var prevH = el.msgs.scrollHeight;
    var prevTop = el.msgs.scrollTop;
    try {
      var d = await Api.get('/api/conversations/' + a.conv.id + '/messages?limit=30&before=' + a.messages[0].id);
      if (S.active !== a) return;
      Object.assign(a.senders, d.senders || {});
      var fresh = d.messages.filter(function (m) { return !a.byId.has(m.id); });
      var frag = document.createDocumentFragment();
      fresh.forEach(function (m) { a.byId.set(m.id, m); frag.appendChild(buildMsg(m)); });
      a.messages = fresh.concat(a.messages);
      a.hasMore = d.hasMore;
      el.msgs.insertBefore(frag, el.hint.nextSibling);
      refreshDecor();
      el.msgs.scrollTop = el.msgs.scrollHeight - prevH + prevTop;
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      if (S.active === a) { a.loading = false; updateHint(); }
    }
  }

  // Sinkronkan setelah koneksi tersambung kembali.
  async function refreshActive() {
    var a = S.active;
    if (!a) return;
    try {
      var d = await Api.get('/api/conversations/' + a.conv.id + '/messages?limit=30');
      if (S.active !== a) return;
      var stick = nearBottom();
      d.messages.forEach(upsertMessage);
      if (stick) scrollBottom();
      markReadIfNeeded();
    } catch (e) { /* abaikan, event berikutnya akan menyinkronkan */ }
  }

  /* =============== Percakapan aktif =============== */
  function renderHead() {
    var a = S.active;
    if (!a) return;
    var u = peer(a.conv);
    el.avatar.textContent = '';
    el.avatar.appendChild(UI.avatar(u));
    if (u.online) el.avatar.appendChild(make('span', 'dot'));
    el.title.textContent = '';
    el.title.appendChild(UI.nameNode(u, 'item__name'));
    var priv = a.conv.type !== 'group';
    $('#conv-audio').hidden = !priv;
    $('#conv-video').hidden = !priv;
    el.status.textContent = a.conv.type === 'group' ? a.conv.group.membersCount + ' anggota' : UI.statusText(u);
    el.status.className = 'conv__status' + (u.online ? ' conv__status--on' : '');
  }

  function openConversation(conv) {
    if (S.active && S.active.conv.id !== conv.id) leaveRoom(S.active.conv.id);
    stopTyping();
    clearBar();
    hideTyping();
    S.active = { conv: conv, messages: [], byId: new Map(), hasMore: false, loading: true, senders: {}, unreadAtOpen: conv.unreadCount || 0, unreadId: null };

    if (!S.pushed && !desktopMq.matches) { history.pushState({ xenConv: true }, '', location.href); S.pushed = true; }
    el.pane.classList.add('is-open');
    el.convEmpty.hidden = true;
    el.convMain.hidden = false;
    el.input.value = '';
    autosize();
    syncButtons();
    renderHead();
    el.msgs.textContent = '';
    el.msgs.appendChild(el.hint);
    updateHint();
    renderList();
    joinRoom(conv.id);
    loadLatest();
    if (finePointer.matches) el.input.focus();
  }

  function doClose() {
    stopTyping();
    if (S.active) leaveRoom(S.active.conv.id);
    S.active = null;
    S.pushed = false;
    clearBar();
    hideTyping();
    el.pane.classList.remove('is-open');
    el.convEmpty.hidden = false;
    el.convMain.hidden = true;
    renderList();
  }

  function closeConv() {
    if (S.pushed) history.back(); // popstate menutup panel
    else doClose();
  }

  async function openUser(userId) {
    var d = await Api.post('/api/conversations/private', { userId: userId });
    var existing = findConv(d.conversation.id);
    openConversation(existing || d.conversation);
    var tab = document.querySelector('.nav__item[data-tab="chat"]');
    if (tab) tab.click();
  }

  function joinRoom(id) { XenSocket.emit('conversation:join', { conversationId: id }).catch(function () { /* diulang saat tersambung */ }); }
  function leaveRoom(id) { XenSocket.emit('conversation:leave', { conversationId: id }).catch(function () {}); }

  /* =============== Baca / unread =============== */
  function markReadIfNeeded() {
    var a = S.active;
    if (!a || document.hidden || S.readPending) return;
    var c = findConv(a.conv.id);
    var unread = (c && c.unreadCount > 0) || a.messages.some(function (m) { return m.senderId !== me.id && m.status !== 'read'; });
    if (!unread) return;
    S.readPending = true;
    XenSocket.emit('message:read', { conversationId: a.conv.id })
      .catch(function () {})
      .then(function () { S.readPending = false; });
  }

  /* =============== Typing =============== */
  function stopTyping() {
    clearTimeout(S.typingStopTimer);
    if (S.typing && S.active) XenSocket.fire('message:typing:stop', { conversationId: S.active.conv.id });
    S.typing = false;
    S.typingSentAt = 0;
  }

  function onComposerInput() {
    autosize();
    syncButtons();
    var a = S.active;
    if (!a) return;
    if (!el.input.value.trim() || S.editing) { stopTyping(); return; }
    var now = Date.now();
    if (now - S.typingSentAt > 2500) {
      XenSocket.fire('message:typing:start', { conversationId: a.conv.id });
      S.typingSentAt = now;
      S.typing = true;
    }
    clearTimeout(S.typingStopTimer);
    S.typingStopTimer = setTimeout(stopTyping, 3000);
  }

  function showTyping(name) {
    el.typing.textContent = name + ' sedang mengetik';
    var dots = make('span', 'dots');
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
    el.typing.appendChild(dots);
    if (S.active) { el.status.textContent = 'sedang mengetik…'; el.status.className = 'conv__status conv__status--typing'; }
    clearTimeout(S.typingHideTimer);
    S.typingHideTimer = setTimeout(hideTyping, 5000);
  }
  function hideTyping() {
    clearTimeout(S.typingHideTimer);
    el.typing.textContent = '';
    if (S.active && el.status.classList.contains('conv__status--typing')) renderHead();
  }

  /* =============== Composer =============== */
  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  }

  function setBar(title, text) {
    el.barTitle.textContent = title;
    el.barText.textContent = text;
    el.bar.hidden = false;
  }

  function clearBar() {
    if (S.editing) { el.input.value = ''; autosize(); }
    setTimeout(syncButtons, 0);
    S.editing = null;
    S.replyTo = null;
    el.bar.hidden = true;
  }

  function startReply(m) {
    clearBar();
    S.replyTo = m;
    var who = m.senderId === me.id ? 'dirimu' : senderOf(m.senderId).name;
    setBar('Membalas ' + who, m.content ? m.content.slice(0, 80) : '');
    el.input.focus();
  }

  function startEdit(m) {
    clearBar();
    S.editing = m;
    setBar('Mengedit pesan', m.content.slice(0, 80));
    el.input.value = m.content;
    autosize();
    el.input.focus();
  }

  async function send() {
    var a = S.active;
    var text = el.input.value;
    if (!a || !text.trim() || S.sending) return;
    S.sending = true;
    el.send.disabled = true;
    try {
      stopTyping();
      if (S.editing) {
        await XenSocket.emit('message:edit', { messageId: S.editing.id, content: text });
      } else {
        await XenSocket.emit('message:send', { conversationId: a.conv.id, content: text, replyTo: S.replyTo ? S.replyTo.id : undefined });
      }
      S.editing = null;
      S.replyTo = null;
      el.bar.hidden = true;
      el.input.value = '';
      autosize();
      syncButtons();
    } catch (err) {
      UI.toast(err.message, 'error'); // teks tetap ada agar bisa dikirim ulang
    } finally {
      S.sending = false;
      el.send.disabled = false;
    }
  }

  /* =============== Menu pesan =============== */
  function openMenu(id) {
    var a = S.active;
    var m = a && a.byId.get(id);
    if (!m || m.deleted) return;
    S.menuMsg = m;
    var mine = m.senderId === me.id;
    var canEdit = mine && m.type === 'text' && Api.now() - Date.parse(m.createdAt) < EDIT_WINDOW_MS;
    var mineReaction = m.reactions.filter(function (r) { return r.userId === me.id; })[0];
    Array.prototype.forEach.call(el.menuReactions.children, function (b) {
      b.setAttribute('aria-pressed', String(!!mineReaction && mineReaction.emoji === b.dataset.emoji));
    });
    el.menuEdit.hidden = !canEdit;
    el.menuDelete.hidden = !mine;
    el.menu.showModal();
  }

  function react(messageId, emoji) {
    XenSocket.emit('message:reaction', { messageId: messageId, emoji: emoji }).catch(function (err) { UI.toast(err.message, 'error'); });
  }

  async function deleteMsg(m) {
    var ok = await UI.confirm({ title: 'Hapus pesan ini?', text: 'Pesan akan dihapus untuk kedua pihak.', okText: 'Hapus' });
    if (!ok) return;
    XenSocket.emit('message:delete', { messageId: m.id }).catch(function (err) { UI.toast(err.message, 'error'); });
  }


  /* =============== Tombol composer, lampiran, pesan suara =============== */
  function syncButtons() {
    var has = !!el.input.value.trim() || !!S.editing;
    var canMic = Attach.Recorder.supported() && !S.editing;
    $('#mic-btn').hidden = has || !canMic;
    el.send.hidden = !has && canMic;
    $('#attach-btn').hidden = !!S.editing;
  }

  function convUrl(path) { return '/api/conversations/' + S.active.conv.id + path; }

  function startAttach() {
    if (!S.active) return;
    var convId = S.active.conv.id;
    Attach.start({
      upload: function (file, kind, caption, onProgress) {
        return Attach.upload('/api/conversations/' + convId + '/attachments?' + Attach.q({ kind: kind, name: file.name, caption: caption.trim() }), file, onProgress);
      }
    });
  }

  var voice = { on: false, startX: 0, cancel: false, pointer: null };

  async function voiceStart(e) {
    if (!S.active || voice.on) return;
    e.preventDefault();
    voice.on = true; voice.cancel = false; voice.startX = e.clientX; voice.pointer = e.pointerId;
    var btn = $('#mic-btn');
    try { btn.setPointerCapture(e.pointerId); } catch (x) { /* tidak wajib */ }
    try {
      await Attach.Recorder.start(function (sec) { $('#rec-time').textContent = Attach.fmtTime(sec); }, function () { voiceEnd(true); });
    } catch (err) {
      voice.on = false;
      UI.toast(err && err.name === 'NotAllowedError' ? 'Izin mikrofon ditolak.' : 'Tidak dapat merekam suara.', 'error');
      return;
    }
    if (!voice.on) { Attach.Recorder.stop(false); return; } // dilepas sebelum izin selesai
    $('#rec').hidden = false;
    $('#rec-time').textContent = '0:00';
    btn.classList.add('mic--rec');
  }

  function voiceMove(e) {
    if (!voice.on) return;
    voice.cancel = e.clientX - voice.startX < -80;
    $('#rec').classList.toggle('rec--cancel', voice.cancel);
  }

  async function voiceEnd(forceSend) {
    if (!voice.on) return;
    voice.on = false;
    var cancelled = voice.cancel && !forceSend;
    var a = S.active;
    $('#rec').hidden = true;
    $('#rec').classList.remove('rec--cancel');
    $('#mic-btn').classList.remove('mic--rec');
    var r = await Attach.Recorder.stop(!cancelled);
    if (cancelled) { UI.toast('Rekaman dibatalkan.'); return; }
    if (!r || !a || S.active !== a) return;
    if (r.duration < 1) { UI.toast('Tahan tombol mikrofon untuk merekam.'); return; }
    try {
      var job = Attach.upload('/api/conversations/' + a.conv.id + '/attachments?' + Attach.q({ kind: 'voice', duration: Math.round(r.duration), name: 'Pesan suara' }), r.blob);
      await job.promise;
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* =============== Menu chat (⋮) =============== */
  async function openChatMenu() {
    var a = S.active;
    if (!a) return;
    var dlg = $('#chat-menu');
    var priv = a.conv.type !== 'group';
    $('#cm-profile').textContent = priv ? 'Lihat profil' : 'Info grup';
    $('#cm-block').hidden = !priv;
    $('#cm-report').hidden = !priv;
    dlg.dataset.blocked = '';
    if (priv) {
      $('#cm-block').textContent = 'Blokir';
      $('#cm-block').disabled = true;
      Api.get('/api/users/' + encodeURIComponent(a.conv.user.username)).then(function (d) {
        dlg.dataset.blocked = d.blocked ? '1' : '';
        $('#cm-block').textContent = d.blocked ? 'Buka blokir' : 'Blokir';
        $('#cm-block').disabled = false;
      }).catch(function () { $('#cm-block').textContent = 'Blokir'; $('#cm-block').disabled = false; });
    }
    dlg.showModal();
  }

  async function openById(convId) {
    try {
      var d = await Api.get('/api/conversations/' + encodeURIComponent(convId));
      openConversation(findConv(d.conversation.id) || d.conversation);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* =============== Event socket =============== */
  function bindSocket() {
    XenSocket.onConnect(function (reconnect) {
      if (S.active) joinRoom(S.active.conv.id);
      if (reconnect) { loadList(); refreshActive(); }
    });

    XenSocket.on('user:online', function (p) { setPresence(p.userId, true, null); });
    XenSocket.on('user:offline', function (p) { setPresence(p.userId, false, p.lastSeen); });

    XenSocket.on('message:new', function (p) {
      var m = p.message;
      var a = S.active;
      if (a && p.sender) a.senders[p.sender.id] = p.sender;
      var visibleHere = a && a.conv.id === m.conversationId && !document.hidden;
      if (p.conversation) {
        if (visibleHere && m.senderId !== me.id) p.conversation.unreadCount = 0;
        upsertConv(p.conversation);
        if (a && a.conv.id === m.conversationId) { a.conv = p.conversation; renderHead(); }
      }
      if (a && a.conv.id === m.conversationId) {
        var stick = nearBottom() || m.senderId === me.id;
        var added = upsertMessage(m);
        if (added) { var nn = nodeFor(m.id); if (nn) nn.classList.add('msg--new'); }
        if (stick) scrollBottom();
        if (m.senderId !== me.id) { hideTyping(); markReadIfNeeded(); }
      }
    });

    function onChanged(p) {
      var m = p.message;
      var a = S.active;
      if (a && a.conv.id === m.conversationId && a.byId.has(m.id)) {
        upsertMessage(m);
        // Perbarui kutipan pada pesan yang membalas pesan ini.
        a.messages.forEach(function (x) {
          if (x.replyTo && x.replyTo.id === m.id) {
            x.replyTo.deleted = m.deleted;
            x.replyTo.content = m.deleted ? null : m.content;
            refreshNode(x);
          }
        });
      }
      var c = findConv(m.conversationId);
      if (c && p.isLast && c.lastMessage) {
        c.lastMessage.deleted = m.deleted;
        c.lastMessage.text = m.deleted ? '' : m.content.slice(0, 120);
        renderList();
      }
    }
    XenSocket.on('message:edit', onChanged);
    XenSocket.on('message:delete', onChanged);

    XenSocket.on('message:reaction', function (p) {
      var a = S.active;
      var m = a && a.conv.id === p.conversationId ? a.byId.get(p.messageId) : null;
      if (!m) return;
      m.reactions = p.reactions;
      refreshNode(m);
    });

    XenSocket.on('message:read', function (p) {
      var a = S.active;
      var here = a && a.conv.id === p.conversationId;
      if (p.readerId === me.id) {
        var c = findConv(p.conversationId);
        if (c) { c.unreadCount = 0; renderList(); }
        if (here) a.messages.forEach(function (m) { if (m.senderId !== me.id) m.status = 'read'; });
      } else if (here) {
        a.messages.forEach(function (m) {
          if (m.senderId === me.id && m.status !== 'read') { m.status = 'read'; refreshNode(m); }
        });
      }
    });

    XenSocket.on('message:typing:start', function (p) {
      var a = S.active;
      if (a && a.conv.id === p.conversationId && p.userId !== me.id) showTyping(senderOf(p.userId).name);
    });
    XenSocket.on('message:typing:stop', function (p) {
      var a = S.active;
      if (a && a.conv.id === p.conversationId) hideTyping();
    });
  }

  function setPresence(userId, online, lastSeen) {
    S.list.forEach(function (c) {
      if (c.user && c.user.id === userId) { c.user.online = online; c.user.lastSeen = lastSeen; }
    });
    if (S.active && S.active.conv.user && S.active.conv.user.id === userId) {
      S.active.conv.user.online = online;
      S.active.conv.user.lastSeen = lastSeen;
      renderHead();
    }
    renderList();
  }

  /* =============== Init =============== */
  function init(user) {
    me = user;
    el = {
      list: $('#chat-list'), loading: $('#chat-loading'), empty: $('#chat-empty'), error: $('#chat-error'), more: $('#list-more'),
      pane: $('#conv-pane'), convEmpty: $('#conv-empty'), convMain: $('#conv-main'),
      avatar: $('#conv-avatar'), title: $('#conv-title'), status: $('#conv-status'),
      msgs: $('#msgs'), hint: $('#msgs-hint'), typing: $('#typing'),
      bar: $('#bar'), barTitle: $('#bar-title'), barText: $('#bar-text'),
      input: $('#composer-input'), send: $('#send-btn'),
      menu: $('#msg-menu'), menuReactions: $('#menu-reactions'), menuEdit: $('#menu-edit'), menuDelete: $('#menu-delete')
    };

    REACTIONS.forEach(function (emoji) {
      var b = make('button', 'react-btn', emoji);
      b.type = 'button';
      b.dataset.emoji = emoji;
      b.setAttribute('aria-label', 'Reaksi ' + emoji);
      el.menuReactions.appendChild(b);
    });

    el.list.addEventListener('click', function (e) {
      var b = e.target.closest('.item');
      var c = b && findConv(b.dataset.id);
      if (c) openConversation(c);
    });
    el.more.addEventListener('click', function () { loadList(true); });
    $('#list-retry').addEventListener('click', function () { loadList(); });
    $('#conv-back').addEventListener('click', closeConv);
    $('#conv-who').addEventListener('click', function () {
      var a = S.active;
      if (!a) return;
      if (a.conv.type === 'group') Groups.openInfo(a.conv.group.id);
      else Profile.show(a.conv.user, { refresh: true });
    });
    el.hint.addEventListener('click', function () { if (el.hint.dataset.retry) loadLatest(); });

    el.msgs.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      var row = e.target.closest('.msg');
      if (!row) return;
      if (chip) { react(row.dataset.id, chip.dataset.emoji); return; }
      if (e.target.closest('.bubble[role="button"]')) openMenu(row.dataset.id);
    });
    el.msgs.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.bubble[role="button"]')) {
        e.preventDefault();
        openMenu(e.target.closest('.msg').dataset.id);
      }
    });
    var scrollTick = false;
    el.msgs.addEventListener('scroll', function () {
      if (scrollTick) return;
      scrollTick = true;
      requestAnimationFrame(function () {
        scrollTick = false;
        if (el.msgs.scrollTop < 60) loadOlder();
      });
    });

    $('#composer').addEventListener('submit', function (e) { e.preventDefault(); send(); });
    el.send.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // jaga keyboard tetap terbuka
    el.input.addEventListener('input', onComposerInput);
    el.input.addEventListener('focus', function () { setTimeout(scrollBottom, 300); });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && enterSends()) { e.preventDefault(); send(); }
      else if (e.key === 'Escape') clearBar();
    });
    $('#bar-close').addEventListener('click', clearBar);

    $('#attach-btn').addEventListener('click', startAttach);
    $('#chat-new').addEventListener('click', function () { var s = $('#user-search'); s.scrollIntoView({ block: 'nearest' }); s.focus(); });
    var mic = $('#mic-btn');
    mic.addEventListener('pointerdown', voiceStart);
    mic.addEventListener('pointermove', voiceMove);
    mic.addEventListener('pointerup', function () { voiceEnd(false); });
    mic.addEventListener('pointercancel', function () { voice.cancel = true; voiceEnd(false); });
    mic.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    $('#conv-audio').addEventListener('click', function () { var a = S.active; if (a && a.conv.user) Calls.start(a.conv.user.id, 'audio', a.conv.user); });
    $('#conv-video').addEventListener('click', function () { var a = S.active; if (a && a.conv.user) Calls.start(a.conv.user.id, 'video', a.conv.user); });
    $('#conv-more').addEventListener('click', openChatMenu);
    var cm = $('#chat-menu');
    cm.addEventListener('click', function (e) { if (e.target === cm) cm.close(); });
    $('#cm-profile').addEventListener('click', function () {
      cm.close();
      var a = S.active;
      if (!a) return;
      if (a.conv.type === 'group') Groups.openInfo(a.conv.group.id); else Profile.show(a.conv.user);
    });
    $('#cm-block').addEventListener('click', async function () {
      var a = S.active;
      var blocked = cm.dataset.blocked === '1';
      cm.close();
      if (!a) return;
      try { await Pages.setBlocked(a.conv.user, !blocked); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#cm-report').addEventListener('click', function () { cm.close(); if (S.active) Pages.openReport(S.active.conv.user); });

    el.menu.addEventListener('click', function (e) { if (e.target === el.menu) el.menu.close(); });
    el.menuReactions.addEventListener('click', function (e) {
      var b = e.target.closest('.react-btn');
      if (!b || !S.menuMsg) return;
      el.menu.close();
      react(S.menuMsg.id, b.dataset.emoji);
    });
    $('#menu-reply').addEventListener('click', function () { el.menu.close(); if (S.menuMsg) startReply(S.menuMsg); });
    el.menuEdit.addEventListener('click', function () { el.menu.close(); if (S.menuMsg) startEdit(S.menuMsg); });
    el.menuDelete.addEventListener('click', function () { el.menu.close(); if (S.menuMsg) deleteMsg(S.menuMsg); });

    window.addEventListener('popstate', function () {
      if (S.active && S.pushed) { S.pushed = false; doClose(); }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) markReadIfNeeded(); });

    // Tinggi mengikuti viewport visual agar keyboard HP tidak menutupi input.
    var vv = window.visualViewport;
    if (vv) {
      var syncVv = function () { document.documentElement.style.setProperty('--vvh', vv.height + 'px'); };
      vv.addEventListener('resize', syncVv);
      syncVv();
    }

    bindSocket();
    loadList();
  }

  function removeConv(convId) {
    S.list = S.list.filter(function (c) { return c.id !== convId; });
    if (S.active && S.active.conv.id === convId) closeConv();
    renderList();
  }

  // Dipanggil modul grup saat info grup berubah (nama, foto, jumlah anggota).
  function patchGroup(gid, patch) {
    var c = findByGroup(gid);
    if (!c) return;
    Object.assign(c.group, patch);
    if (S.active && S.active.conv.id === c.id) renderHead();
    renderList();
  }

  return { init: init, openById: openById, openUser: openUser, upsertConv: upsertConv, openItem: openConversation, removeConv: removeConv, patchGroup: patchGroup, findByGroup: findByGroup, activeConv: function () { return S.active && S.active.conv; } };
})();
