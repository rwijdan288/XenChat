/* Panggilan audio/video (WebRTC; Socket.IO hanya untuk signaling) + riwayat panggilan. */
var Calls = (function () {
  'use strict';

  var me = null;
  var st = null; // panggilan aktif: { callId, peer, type, role, pc, local, pendingIce, answered, ... }
  var iceServers = null;
  var ringCtx = null;
  var ringTimer = null;
  var hist = { items: [], hasMore: false, loaded: false };
  var facing = 'user';

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* =============== Nada dering (WebAudio, tanpa file) =============== */
  function beep() {
    try {
      ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (ringCtx.state === 'suspended') ringCtx.resume();
      var o = ringCtx.createOscillator();
      var g = ringCtx.createGain();
      o.frequency.value = 523;
      g.gain.setValueAtTime(0.0001, ringCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ringCtx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ringCtx.currentTime + 0.5);
      o.connect(g); g.connect(ringCtx.destination);
      o.start(); o.stop(ringCtx.currentTime + 0.55);
    } catch (e) { /* audio diblokir browser */ }
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  }
  function startRing() { stopRing(); beep(); ringTimer = setInterval(beep, 2200); }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; if (navigator.vibrate) navigator.vibrate(0); }

  /* =============== Media lokal =============== */
  async function getMedia(type) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Browser tidak mendukung panggilan. Gunakan HTTPS atau localhost.');
    var mic = XenPrefs.get('micId');
    var cam = XenPrefs.get('camId');
    var c = { audio: Object.assign({ echoCancellation: true, noiseSuppression: true }, mic ? { deviceId: { exact: mic } } : {}) };
    if (type === 'video') c.video = Object.assign({ facingMode: facing }, cam ? { deviceId: { exact: cam } } : {});
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw new Error('Izin ' + (type === 'video' ? 'kamera dan mikrofon' : 'mikrofon') + ' ditolak.');
      if (err && err.name === 'NotFoundError') throw new Error('Mikrofon' + (type === 'video' ? ' atau kamera' : '') + ' tidak ditemukan.');
      throw new Error('Tidak dapat mengakses perangkat media.');
    }
  }

  async function loadIce() {
    if (iceServers) return iceServers;
    try { iceServers = (await Api.get('/api/calls/ice')).iceServers; } catch (e) { iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }]; }
    return iceServers;
  }

  /* =============== UI panggilan =============== */
  function setStatus(text) {
    $('#call-status').textContent = text;
    $('#call').classList.toggle('call--ringing', /^(Memanggil|Berdering)/.test(text));
  }

  function showCallUI() {
    var u = st.peer;
    $('#call-avatar').textContent = '';
    $('#call-avatar').appendChild(UI.avatar(u, 'lg'));
    $('#call-name').textContent = u.name;
    $('#call').hidden = false;
    $('#call').classList.toggle('call--video', st.type === 'video');
    $('#call-camera').hidden = st.type !== 'video';
    $('#call-switch').hidden = st.type !== 'video';
    $('#call-speaker').hidden = !(HTMLMediaElement.prototype.setSinkId && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);
    setPressed('#call-mute', false);
    setPressed('#call-camera', false);
    if (st.local && st.type === 'video') $('#call-local').srcObject = st.local;
  }

  function setPressed(sel, v) { $(sel).setAttribute('aria-pressed', String(v)); }

  function tickDuration() {
    if (!st || !st.connectedAt) return;
    setStatus(Attach.fmtTime((Date.now() - st.connectedAt) / 1000));
  }

  /* =============== RTCPeerConnection =============== */
  function makePC() {
    var pc = new RTCPeerConnection({ iceServers: iceServers });
    st.pc = pc;
    st.pendingIce = [];
    st.local.getTracks().forEach(function (t) { pc.addTrack(t, st.local); });

    pc.onicecandidate = function (e) {
      if (e.candidate && st) XenSocket.emit('call:ice-candidate', { callId: st.callId, candidate: e.candidate.toJSON() }).catch(function () {});
    };
    pc.ontrack = function (e) {
      var remote = $('#call-remote');
      if (remote.srcObject !== e.streams[0]) remote.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = function () {
      if (!st || st.pc !== pc) return;
      var s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(st.failTimer);
        if (!st.connectedAt) { st.connectedAt = Date.now(); st.durTimer = setInterval(tickDuration, 1000); }
        tickDuration();
      } else if (s === 'disconnected') {
        setStatus('Menyambung kembali…');
        st.failTimer = setTimeout(function () { if (st && st.pc === pc && pc.connectionState !== 'connected') tryRestart(); }, 6000);
      } else if (s === 'failed') {
        tryRestart();
      }
    };
    return pc;
  }

  // Penelepon yang memulai ulang ICE (reconnect). Jika tetap gagal dalam 15 detik, panggilan diakhiri.
  async function tryRestart() {
    if (!st || !st.pc) return;
    setStatus('Menyambung kembali…');
    clearTimeout(st.failTimer);
    st.failTimer = setTimeout(function () { if (st && st.pc && st.pc.connectionState !== 'connected') hangup(true); }, 15000);
    if (st.role !== 'caller') return;
    try {
      var offer = await st.pc.createOffer({ iceRestart: true });
      await st.pc.setLocalDescription(offer);
      await XenSocket.emit('call:offer', { callId: st.callId, sdp: { type: offer.type, sdp: offer.sdp } });
    } catch (e) { /* percobaan berikutnya oleh timer */ }
  }

  async function flushIce() {
    var list = st.pendingIce.splice(0);
    for (var i = 0; i < list.length; i++) { try { await st.pc.addIceCandidate(list[i]); } catch (e) { /* abaikan kandidat basi */ } }
  }

  /* =============== Memulai & menerima =============== */
  async function start(userId, type, peerUser) {
    if (st) { UI.toast('Kamu sedang dalam panggilan.', 'error'); return; }
    if (!XenSocket.isConnected()) { UI.toast('Belum terhubung. Coba lagi sebentar.', 'error'); return; }
    var peer = peerUser || { id: userId, name: 'Pengguna', avatarUrl: '' };
    st = { callId: null, peer: peer, type: type, role: 'caller', pc: null, local: null, pendingIce: [], answered: false, ending: false };
    try {
      await loadIce();
      st.local = await getMedia(type); // izin diminta sebelum membuat panggilan, agar tidak menelepon sia-sia
      showCallUI();
      setStatus('Memanggil…');
      var r = await XenSocket.emit('call:invite', { calleeId: userId, type: type });
      if (!st) return;
      st.callId = r.callId;
    } catch (err) {
      UI.toast(err.message, 'error');
      cleanup();
    }
  }

  function onInvite(p) {
    if (st) { XenSocket.emit('call:reject', { callId: p.callId }).catch(function () {}); return; } // sibuk
    st = { callId: p.callId, peer: p.from, type: p.type, role: 'callee', pc: null, local: null, pendingIce: [], answered: false, ending: false, incoming: true };
    $('#in-avatar').textContent = '';
    $('#in-avatar').appendChild(UI.avatar(p.from, 'lg'));
    $('#in-name').textContent = p.from.name;
    $('#in-text').textContent = p.type === 'video' ? 'Panggilan video masuk' : 'Panggilan suara masuk';
    $('#incoming').hidden = false;
    startRing();
    XenSocket.emit('call:ring', { callId: p.callId }).catch(function () {});
  }

  async function accept() {
    if (!st || !st.incoming) return;
    stopRing();
    $('#incoming').hidden = true;
    st.incoming = false;
    try {
      await loadIce();
      st.local = await getMedia(st.type);
      showCallUI();
      setStatus('Menghubungkan…');
      makePC();
      await XenSocket.emit('call:accept', { callId: st.callId });
      st.answered = true;
    } catch (err) {
      UI.toast(err.message, 'error');
      if (st && st.callId) XenSocket.emit('call:reject', { callId: st.callId }).catch(function () {});
      cleanup();
    }
  }

  function reject() {
    if (!st || !st.incoming) return;
    XenSocket.emit('call:reject', { callId: st.callId }).catch(function () {});
    cleanup();
  }

  function hangup(silent) {
    if (!st) return;
    if (st.callId) XenSocket.emit('call:end', { callId: st.callId }).catch(function () {});
    if (!silent) setStatus('Mengakhiri…');
    cleanup();
  }

  function cleanup() {
    stopRing();
    if (!st) return;
    var s = st;
    st = null;
    clearInterval(s.durTimer);
    clearTimeout(s.failTimer);
    if (s.pc) { s.pc.onconnectionstatechange = null; s.pc.onicecandidate = null; s.pc.ontrack = null; try { s.pc.close(); } catch (e) { /* sudah tertutup */ } }
    if (s.local) s.local.getTracks().forEach(function (t) { t.stop(); });
    $('#call-remote').srcObject = null;
    $('#call-local').srcObject = null;
    $('#call').hidden = true;
    $('#incoming').hidden = true;
  }

  /* =============== Kontrol =============== */
  function toggleMute() {
    if (!st || !st.local) return;
    var on = $('#call-mute').getAttribute('aria-pressed') !== 'true';
    st.local.getAudioTracks().forEach(function (t) { t.enabled = !on; });
    setPressed('#call-mute', on);
  }

  function toggleCamera() {
    if (!st || !st.local) return;
    var off = $('#call-camera').getAttribute('aria-pressed') !== 'true';
    st.local.getVideoTracks().forEach(function (t) { t.enabled = !off; });
    setPressed('#call-camera', off);
    $('#call-local').classList.toggle('call__local--off', off);
  }

  async function switchCamera() {
    if (!st || st.type !== 'video') return;
    var next = facing === 'user' ? 'environment' : 'user';
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } });
      var track = s.getVideoTracks()[0];
      var sender = st.pc && st.pc.getSenders().filter(function (x) { return x.track && x.track.kind === 'video'; })[0];
      if (sender) await sender.replaceTrack(track);
      st.local.getVideoTracks().forEach(function (t) { st.local.removeTrack(t); t.stop(); });
      st.local.addTrack(track);
      $('#call-local').srcObject = st.local;
      facing = next;
    } catch (e) { UI.toast('Perangkat ini tidak bisa berganti kamera.', 'error'); }
  }

  // Speaker: ganti output audio (didukung browser desktop yang punya setSinkId).
  async function cycleSpeaker() {
    try {
      var devices = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'audiooutput'; });
      if (devices.length < 2) { UI.toast('Hanya ada satu output audio.'); return; }
      var remote = $('#call-remote');
      var idx = devices.findIndex(function (d) { return d.deviceId === (remote.sinkId || 'default'); });
      var d = devices[(idx + 1) % devices.length];
      await remote.setSinkId(d.deviceId);
      UI.toast('Output: ' + (d.label || 'perangkat lain'));
    } catch (e) { UI.toast('Tidak dapat mengganti output audio.', 'error'); }
  }

  /* =============== Event signaling =============== */
  function bindSocket() {
    XenSocket.on('call:invite', onInvite);
    XenSocket.on('call:handled', function (p) { if (st && st.callId === p.callId && st.incoming) { stopRing(); cleanup(); } });
    XenSocket.on('call:ring', function (p) { if (st && st.callId === p.callId && !st.answered) setStatus('Berdering…'); });

    XenSocket.on('call:accept', async function (p) {
      if (!st || st.callId !== p.callId || st.role !== 'caller') return;
      st.answered = true;
      setStatus('Menghubungkan…');
      try {
        var pc = makePC();
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await XenSocket.emit('call:offer', { callId: st.callId, sdp: { type: offer.type, sdp: offer.sdp } });
      } catch (e) { UI.toast('Gagal memulai sambungan.', 'error'); hangup(true); }
    });

    XenSocket.on('call:offer', async function (p) {
      if (!st || st.callId !== p.callId || !st.pc) return;
      try {
        await st.pc.setRemoteDescription(p.sdp);
        await flushIce();
        var answer = await st.pc.createAnswer();
        await st.pc.setLocalDescription(answer);
        await XenSocket.emit('call:answer', { callId: st.callId, sdp: { type: answer.type, sdp: answer.sdp } });
      } catch (e) { UI.toast('Gagal menyambungkan panggilan.', 'error'); hangup(true); }
    });

    XenSocket.on('call:answer', async function (p) {
      if (!st || st.callId !== p.callId || !st.pc) return;
      try { await st.pc.setRemoteDescription(p.sdp); await flushIce(); } catch (e) { hangup(true); }
    });

    XenSocket.on('call:ice-candidate', async function (p) {
      if (!st || st.callId !== p.callId || !st.pc) return;
      if (st.pc.remoteDescription) { try { await st.pc.addIceCandidate(p.candidate); } catch (e) { /* abaikan */ } }
      else st.pendingIce.push(p.candidate);
    });

    XenSocket.on('call:end', function (p) {
      var wasMine = st && st.callId === p.callId;
      if (wasMine) {
        var role = st.role;
        var msg = { reject: role === 'caller' ? 'Panggilan ditolak.' : '', timeout: role === 'caller' ? 'Tidak dijawab.' : 'Panggilan terlewat.', disconnect: 'Koneksi terputus.', cancel: '', end: p.duration ? 'Panggilan selesai · ' + Attach.fmtTime(p.duration) : 'Panggilan selesai.' }[p.reason];
        cleanup();
        if (msg) UI.toast(msg);
      }
      if (hist.loaded) loadHistory(true);
    });

    XenSocket.onConnect(function (reconnect) { if (reconnect && hist.loaded) loadHistory(true); });
  }

  /* =============== Riwayat panggilan (tab Panggil) =============== */
  var STATUS = { completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan', failed: 'Gagal' };

  function statusLabel(c) {
    if (c.status === 'missed') return c.direction === 'incoming' ? 'Tidak terjawab' : 'Tidak dijawab';
    if (c.status === 'completed') return 'Selesai · ' + Attach.fmtTime(c.duration);
    return STATUS[c.status] || c.status;
  }

  function histRow(c) {
    var li = make('li');
    var row = make('div', 'item item--static call-row');
    var main = make('button', 'call-row__main');
    main.type = 'button';
    main.dataset.user = c.user.username;
    main.setAttribute('aria-label', 'Lihat profil ' + c.user.name);
    main.appendChild(UI.avatar(c.user));
    var info = make('span', 'item__main');
    info.appendChild(UI.nameNode(c.user, 'item__name'));
    var bad = c.status === 'missed' || c.status === 'rejected' || c.status === 'failed';
    var line = make('span', 'item__preview truncate' + (bad && c.direction === 'incoming' ? ' call-row__bad' : ''));
    var ico = make('span', 'call-ico call-ico--' + (c.status === 'missed' && c.direction === 'incoming' ? 'miss' : c.direction === 'incoming' ? 'in' : 'out'));
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = '<svg class="icon"><use href="#i-' + (c.status === 'missed' && c.direction === 'incoming' ? 'missed' : c.direction === 'incoming' ? 'in' : 'out') + '"/></svg>'; // markup statis
    line.appendChild(ico);
    line.appendChild(document.createTextNode((c.direction === 'incoming' ? 'Masuk' : 'Keluar') + ' ' + (c.type === 'video' ? 'video' : 'suara') + ' · ' + statusLabel(c) + ' · ' + UI.timeShort(c.startedAt)));
    info.appendChild(line);
    main.appendChild(info);

    var again = make('button', 'icon-btn');
    again.type = 'button';
    again.dataset.again = c.id;
    again.setAttribute('aria-label', 'Telepon lagi');
    again.title = 'Telepon lagi';
    again.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + (c.type === 'video' ? 'i-video' : 'i-phone') + '"/></svg>'; // markup statis
    var del = make('button', 'icon-btn');
    del.type = 'button';
    del.dataset.del = c.id;
    del.setAttribute('aria-label', 'Hapus riwayat');
    del.title = 'Hapus';
    del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>'; // markup statis
    row.appendChild(main);
    row.appendChild(again);
    row.appendChild(del);
    li.appendChild(row);
    return li;
  }

  function renderHistory() {
    var ul = $('#calls-list');
    ul.textContent = '';
    hist.items.forEach(function (c) { ul.appendChild(histRow(c)); });
    $('#calls-empty').hidden = hist.items.length > 0;
    $('#calls-clear').hidden = hist.items.length === 0;
    $('#calls-more').hidden = !hist.hasMore;
  }

  async function loadHistory(reset) {
    var before = !reset && hist.items.length ? '&before=' + encodeURIComponent(hist.items[hist.items.length - 1].startedAt) : '';
    if (reset && !hist.items.length) $('#calls-loading').hidden = false;
    $('#calls-error').hidden = true;
    try {
      var d = await Api.get('/api/calls?limit=30' + before);
      hist.items = reset ? d.calls : hist.items.concat(d.calls);
      hist.hasMore = d.hasMore;
      hist.loaded = true;
      $('#calls-loading').hidden = true;
      renderHistory();
    } catch (err) {
      $('#calls-loading').hidden = true;
      if (!hist.items.length) $('#calls-error').hidden = false;
      UI.toast(err.message, 'error');
    }
  }

  function init(user) {
    me = user;
    $('#in-accept').addEventListener('click', accept);
    $('#in-reject').addEventListener('click', reject);
    $('#call-end').addEventListener('click', function () { hangup(false); });
    $('#call-mute').addEventListener('click', toggleMute);
    $('#call-camera').addEventListener('click', toggleCamera);
    $('#call-switch').addEventListener('click', switchCamera);
    $('#call-speaker').addEventListener('click', cycleSpeaker);

    $('#calls-list').addEventListener('click', async function (e) {
      var again = e.target.closest('[data-again]');
      var del = e.target.closest('[data-del]');
      var main = e.target.closest('.call-row__main');
      if (again) {
        var c = hist.items.filter(function (x) { return x.id === again.dataset.again; })[0];
        if (c) start(c.user.id, c.type, c.user);
      } else if (del) {
        try {
          await Api.del('/api/calls/' + del.dataset.del);
          hist.items = hist.items.filter(function (x) { return x.id !== del.dataset.del; });
          renderHistory();
        } catch (err) { UI.toast(err.message, 'error'); }
      } else if (main) {
        Router.go('/profile/' + encodeURIComponent(main.dataset.user));
      }
    });
    $('#calls-clear').addEventListener('click', async function () {
      var ok = await UI.confirm({ title: 'Hapus semua riwayat?', text: 'Riwayat panggilan hanya dihapus dari akunmu.', okText: 'Hapus semua' });
      if (!ok) return;
      try { await Api.del('/api/calls'); hist.items = []; hist.hasMore = false; renderHistory(); } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#calls-more').addEventListener('click', function () { loadHistory(false); });
    $('#calls-retry').addEventListener('click', function () { loadHistory(true); });

    bindSocket();
  }

  // Dipanggil saat tab Panggil dibuka.
  function onTabOpen() { loadHistory(true); }

  return { init: init, start: start, onTabOpen: onTabOpen, busy: function () { return !!st; } };
})();
