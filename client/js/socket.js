/* Koneksi Socket.IO (autentikasi lewat cookie httpOnly yang sama dengan REST). */
var XenSocket = (function () {
  'use strict';

  var socket = null;
  var wasConnected = false;
  var connectFns = [];
  var hideTimer = null;

  function setConn(state) {
    clearTimeout(hideTimer);
    document.querySelectorAll('[data-conn]').forEach(function (el) {
      if (state === 'none') { el.hidden = true; return; }
      el.hidden = false;
      el.className = 'conn conn--' + state;
      el.textContent = state === 'ok' ? 'Terhubung' : 'Menghubungkan…';
    });
    if (state === 'ok') hideTimer = setTimeout(function () { setConn('none'); }, 2000);
  }

  function connect() {
    if (socket) return socket;
    if (typeof io !== 'function') { UI.toast('Koneksi realtime tidak tersedia.', 'error'); return null; }
    setConn('wait');
    socket = io();

    socket.on('connect', function () {
      setConn('ok');
      var reconnect = wasConnected;
      wasConnected = true;
      connectFns.forEach(function (fn) { fn(reconnect); });
    });
    socket.on('disconnect', function () { setConn('wait'); });
    socket.on('connect_error', function (err) {
      if (err && err.message === 'unauthorized') { location.replace('/login.html'); return; }
      setConn('wait');
    });
    return socket;
  }

  function on(event, fn) { if (socket) socket.on(event, fn); }
  function onConnect(fn) { connectFns.push(fn); }
  function isConnected() { return !!(socket && socket.connected); }

  // Emit dengan ack -> Promise. Ditolak jika belum terhubung / timeout / server menolak.
  function emit(event, payload) {
    return new Promise(function (resolve, reject) {
      if (!isConnected()) { reject(new Error('Belum terhubung. Coba lagi sebentar.')); return; }
      socket.timeout(8000).emit(event, payload, function (err, res) {
        if (err) { reject(new Error('Server tidak merespons. Coba lagi.')); return; }
        if (!res || !res.ok) { reject(new Error((res && res.error) || 'Terjadi kesalahan.')); return; }
        resolve(res);
      });
    });
  }

  // Tanpa ack (typing).
  function fire(event, payload) { if (isConnected()) socket.emit(event, payload); }

  return { connect: connect, on: on, onConnect: onConnect, isConnected: isConnected, emit: emit, fire: fire };
})();
