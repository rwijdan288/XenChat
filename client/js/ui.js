/* Toast dan dialog konfirmasi. */
var UI = (function () {
  'use strict';
  var box = null;

  function toast(message, type) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    var kind = type === 'success' || type === 'error' || type === 'warning' ? type : 'info';
    var el = document.createElement('div');
    el.className = 'toast toast--' + kind;
    var ic = document.createElement('span');
    ic.className = 'toast__icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = { success: '✓', error: '!', warning: '!', info: 'i' }[kind];
    var tx = document.createElement('span');
    tx.className = 'toast__text';
    tx.textContent = message;
    el.appendChild(ic);
    el.appendChild(tx);
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('toast--out');
      setTimeout(function () { el.remove(); }, 250);
    }, 3500);
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('confirm-dialog');
      document.getElementById('confirm-title').textContent = opts.title;
      document.getElementById('confirm-text').textContent = opts.text || '';
      var ok = document.getElementById('confirm-ok');
      ok.textContent = opts.okText || 'Ya';
      ok.className = 'btn ' + (opts.danger === false ? '' : 'btn--danger');
      dlg.returnValue = '';
      dlg.addEventListener('close', function () { resolve(dlg.returnValue === 'ok'); }, { once: true });
      dlg.showModal();
    });
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function badge() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'badge');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Terverifikasi');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-verified');
    svg.appendChild(use);
    return svg;
  }

  // size: 'lg' | 'sm' | undefined. Foto diambil dari avatarUrl, jika kosong tampilkan inisial.
  function avatar(user, size) {
    var cls = 'avatar' + (size ? ' avatar--' + size : '');
    if (user.avatarUrl) {
      var img = document.createElement('img');
      img.className = cls;
      img.src = user.avatarUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      return img;
    }
    var el = document.createElement('span');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    return el;
  }

  // Nama + badge verified. textContent saja, tidak ada innerHTML.
  function nameNode(user, cls) {
    var wrap = document.createElement('span');
    wrap.className = cls || 'name';
    var t = document.createElement('span');
    t.className = 'truncate';
    t.textContent = user.name;
    wrap.appendChild(t);
    if (user.verified) wrap.appendChild(badge());
    return wrap;
  }

  function timeShort(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date(Api.now());
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
  }

  function statusText(user) {
    if (user.online) return 'Online';
    var t = Date.parse(user.lastSeen || '');
    if (isNaN(t)) return 'Offline';
    var min = Math.floor((Api.now() - t) / 60000);
    if (min < 1) return 'Terakhir dilihat baru saja';
    if (min < 60) return 'Terakhir dilihat ' + min + ' menit lalu';
    if (min < 1440) return 'Terakhir dilihat ' + Math.floor(min / 60) + ' jam lalu';
    return 'Terakhir dilihat ' + new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  }

  // Foto di-crop persegi dan diperkecil di browser (192px JPEG) sebelum dikirim sebagai data URL.
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
        reject(new Error('Pilih foto JPEG, PNG, atau WebP (maksimal 8 MB).'));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var size = 192;
        var c = document.createElement('canvas');
        c.width = size; c.height = size;
        var side = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Foto tidak bisa dibaca.')); };
      img.src = url;
    });
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  }

  // Penghubung tombol "pilih foto" -> pratinjau avatar. Mengembalikan fungsi untuk membaca state.
  return { resizeImage: resizeImage, fmtCount: fmtCount, toast: toast, confirm: confirmDialog, badge: badge, avatar: avatar, nameNode: nameNode, timeShort: timeShort, statusText: statusText };
})();
