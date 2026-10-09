/* Pembungkus fetch untuk REST API XenChat. */
var Api = (function () {
  'use strict';

  var offset = 0; // selisih jam server - jam perangkat (untuk "terakhir dilihat")

  async function request(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    var res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      var netErr = new Error('Tidak dapat terhubung ke server. Periksa koneksimu.');
      netErr.status = 0;
      throw netErr;
    }

    var serverDate = Date.parse(res.headers.get('Date') || '');
    if (!isNaN(serverDate)) offset = serverDate - Date.now();

    var data = null;
    try { data = await res.json(); } catch (e) { /* respons bukan JSON */ }

    if (!res.ok) {
      var err = new Error((data && data.message) || 'Terjadi kesalahan. Silakan coba lagi.');
      err.status = res.status;
      err.fields = data && data.fields;
      throw err;
    }
    return data;
  }

  return {
    get: function (url) { return request('GET', url); },
    post: function (url, body) { return request('POST', url, body || {}); },
    patch: function (url, body) { return request('PATCH', url, body || {}); },
    put: function (url, body) { return request('PUT', url, body || {}); },
    del: function (url, body) { return request('DELETE', url, body); },
    now: function () { return Date.now() + offset; }
  };
})();
