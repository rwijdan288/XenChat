/* Pencarian pengguna (debounce, hasil dibatasi server). */
var Search = (function () {
  'use strict';

  var input, results, listWrap, timer = null, seq = 0;

  function $(s) { return document.querySelector(s); }

  function note(text, cls) {
    results.textContent = '';
    var p = document.createElement('p');
    p.className = 'search-note' + (cls ? ' ' + cls : '');
    p.textContent = text;
    results.appendChild(p);
  }

  function skeleton() {
    results.textContent = '';
    for (var i = 0; i < 3; i++) {
      var s = document.createElement('div');
      s.className = 'skeleton';
      results.appendChild(s);
    }
  }

  function render(users) {
    if (!users.length) { note('Pengguna tidak ditemukan.'); return; }
    results.textContent = '';
    results.appendChild(make('p', 'search-group', 'Pengguna'));
    var ul = document.createElement('ul');
    ul.className = 'list';
    users.forEach(function (u) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'item';

      var wrap = document.createElement('span');
      wrap.className = 'avatar-wrap';
      wrap.appendChild(UI.avatar(u));
      if (u.online) { var dot = document.createElement('span'); dot.className = 'dot'; wrap.appendChild(dot); }

      var main = document.createElement('span');
      main.className = 'item__main';
      main.appendChild(UI.nameNode(u, 'item__name'));
      var sub = document.createElement('span');
      sub.className = 'item__preview truncate';
      sub.textContent = '@' + u.username + ' · ID: ' + u.accountId;
      main.appendChild(sub);

      b.appendChild(wrap);
      b.appendChild(main);
      b.addEventListener('click', function () { Profile.show(u); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    results.appendChild(ul);
  }

  async function run(q) {
    var mine = ++seq;
    skeleton();
    try {
      var data = await Api.get('/api/users/search?limit=15&q=' + encodeURIComponent(q));
      if (mine === seq) render(data.users);
    } catch (err) {
      if (mine === seq) note(err.message, 'search-note--error');
    }
  }

  function onInput() {
    clearTimeout(timer);
    var q = input.value.trim();
    seq++; // batalkan permintaan yang masih berjalan
    if (!q) { results.hidden = true; listWrap.hidden = false; return; }
    results.hidden = false;
    listWrap.hidden = true;
    if (q.replace(/^@/, '').length < 2) { note('Ketik minimal 2 karakter.'); return; }
    skeleton();
    timer = setTimeout(function () { run(q); }, 300);
  }

  function init() {
    input = $('#user-search');
    results = $('#search-results');
    listWrap = $('#chat-list-wrap');
    var clear = $('#user-search-clear');
    input.addEventListener('input', function () { clear.hidden = !input.value; });
    clear.addEventListener('click', function () { input.value = ''; clear.hidden = true; onInput(); input.focus(); });
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; onInput(); }
    });
  }

  return { init: init };
})();
