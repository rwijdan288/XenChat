/* Profil: lihat profil pengguna, edit profil sendiri. */
var Profile = (function () {
  'use strict';

  var me = null;
  var pendingAvatar; // undefined = tidak berubah, null = hapus, string = data URL baru

  function $(s) { return document.querySelector(s); }

  /* ---------- Lihat profil (halaman penuh /profile/:username) ---------- */
  function show(user) {
    document.querySelectorAll('dialog[open]').forEach(function (d) { d.close(); });
    Router.go('/profile/' + encodeURIComponent(user.username));
  }

  /* ---------- Edit profil ---------- */
  function renderEditAvatar() {
    var box = $('#edit-avatar');
    box.textContent = '';
    var shown;
    if (pendingAvatar === null) shown = { name: $('#edit-name').value || me.name, avatarUrl: '' };
    else if (typeof pendingAvatar === 'string') shown = { name: me.name, avatarUrl: pendingAvatar };
    else shown = { name: me.name, avatarUrl: XenApp.user.avatarUrl };
    box.appendChild(UI.avatar(shown, 'lg'));
  }

  function setFieldError(name, msg) {
    var out = $('#edit-err-' + name);
    var input = $('#edit-' + name);
    if (out) out.textContent = msg || '';
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }

  function openEdit() {
    var u = XenApp.user;
    pendingAvatar = undefined;
    $('#edit-name').value = u.name;
    $('#edit-username').value = u.username;
    $('#edit-bio').value = u.bio || '';
    ['name', 'username', 'bio', 'avatar'].forEach(function (n) { setFieldError(n, ''); });
    $('#edit-error').textContent = '';
    renderEditAvatar();
    $('#edit-dialog').showModal();
  }

  async function submitEdit(e) {
    e.preventDefault();
    var btn = $('#edit-save');
    ['name', 'username', 'bio', 'avatar'].forEach(function (n) { setFieldError(n, ''); });
    $('#edit-error').textContent = '';

    var payload = {
      name: $('#edit-name').value,
      username: $('#edit-username').value.trim().toLowerCase(),
      bio: $('#edit-bio').value
    };
    if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;

    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
    try {
      var data = await Api.patch('/api/users/me', payload);
      XenApp.user = data.user;
      XenApp.renderProfile(data.user);
      me = data.user;
      if (location.pathname.indexOf('/profile') === 0 || location.pathname.indexOf('/settings') === 0) Router.render(location.pathname);
      $('#edit-dialog').close();
      UI.toast('Profil diperbarui.', 'success');
    } catch (err) {
      if (err.fields) Object.keys(err.fields).forEach(function (n) { setFieldError(n, err.fields[n]); });
      $('#edit-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Simpan';
    }
  }

  function init(user) {
    me = user;
    var edlg = $('#edit-dialog');
    edlg.addEventListener('click', function (e) { if (e.target === edlg) edlg.close(); });

    $('#edit-form').addEventListener('submit', submitEdit);
    $('#edit-close').addEventListener('click', function () { edlg.close(); });
    $('#edit-pick').addEventListener('click', function () { $('#edit-file').click(); });
    $('#edit-file').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        pendingAvatar = await UI.resizeImage(file);
        renderEditAvatar();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
    $('#edit-remove-avatar').addEventListener('click', function () { pendingAvatar = null; renderEditAvatar(); });
  }

  return { init: init, show: show, openEdit: openEdit };
})();
