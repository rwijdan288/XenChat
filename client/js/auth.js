/* Logika halaman login dan register. */
(function () {
  'use strict';

  var form = document.getElementById('auth-form');
  if (!form) return;

  var mode = form.dataset.mode; // 'login' | 'register'
  var formError = document.getElementById('form-error');
  var submitBtn = form.querySelector('button[type="submit"]');
  var submitLabel = submitBtn.textContent;

  // Jika sudah login, langsung ke aplikasi.
  Api.get('/api/auth/me').then(function () { location.replace(nextUrl()); }).catch(function () { /* belum login */ });

  // Setelah login kembali ke halaman tujuan (hanya path internal, mis. /join/token).
  function nextUrl() {
    var n = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?!\/)[\w\-./%]*$/.test(n) ? n : '/';
  }

  var USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  function setFieldError(name, message) {
    var input = form.elements[name];
    var out = document.getElementById('err-' + name);
    if (!input || !out) return;
    out.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function clearErrors() {
    formError.textContent = '';
    ['name', 'username', 'email', 'password', 'confirmPassword'].forEach(function (n) { setFieldError(n, ''); });
  }

  function validate(values) {
    var errors = {};
    if (mode === 'register') {
      if (!values.name.trim()) errors.name = 'Nama wajib diisi.';
      else if (values.name.trim().length > 50) errors.name = 'Nama maksimal 50 karakter.';
      if (!USERNAME_RE.test(values.username)) errors.username = 'Username 3-20 karakter: huruf kecil, angka, atau underscore.';
      if (!values.email) errors.email = 'Email wajib diisi.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) errors.email = 'Format email tidak valid.';
      if (values.password.length < 8) errors.password = 'Password minimal 8 karakter.';
      else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Konfirmasi password tidak cocok.';
    } else {
      if (!values.username) errors.username = 'Username wajib diisi.';
      if (!values.password) errors.password = 'Password wajib diisi.';
    }
    return errors;
  }

  function showErrors(errors) {
    var first = null;
    Object.keys(errors).forEach(function (name) {
      setFieldError(name, errors[name]);
      if (!first) first = form.elements[name];
    });
    if (first) first.focus();
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    var values = {
      name: form.elements.name ? form.elements.name.value : '',
      username: form.elements.username.value.trim().toLowerCase(),
      email: form.elements.email ? form.elements.email.value.trim().toLowerCase() : '',
      password: form.elements.password.value,
      confirmPassword: form.elements.confirmPassword ? form.elements.confirmPassword.value : ''
    };

    var errors = validate(values);
    if (Object.keys(errors).length) { showErrors(errors); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'register' ? 'Membuat akun…' : 'Masuk…';

    try {
      var payload = mode === 'register' ? values : { username: values.username, password: values.password };
      await Api.post('/api/auth/' + mode, payload);
      location.replace(nextUrl());
    } catch (err) {
      if (err.fields) showErrors(err.fields);
      formError.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }
  });
})();
