/* Lampiran & pesan suara: pilih file, pratinjau, unggah (progress/batal), render aman, perekam MediaRecorder. */
var Attach = (function () {
  'use strict';

  var LIMITS = { image: 10, video: 25, audio: 15, voice: 5, file: 20 }; // MB, cermin batas server
  var ACCEPT = {
    image: 'image/jpeg,image/png,image/webp',
    video: 'video/mp4,video/webm',
    audio: 'audio/mpeg,audio/ogg,audio/webm,.mp3,.ogg',
    file: '.pdf,.zip,.docx,.xlsx,.pptx,.txt'
  };
  var ICON = { image: '🖼️', video: '🎬', audio: '🎵', file: '📄' };
  var cfg = null; // { upload(file, kind, caption, onProgress) -> {promise, abort} }
  var job = null;
  var current = null;

  function $(s) { return document.querySelector(s); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.0', '') + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ---------- Unggah (XHR: progress + bisa dibatalkan) ---------- */
  function upload(url, body, onProgress) {
    var xhr = new XMLHttpRequest();
    var promise = new Promise(function (resolve, reject) {
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* bukan JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.message) || 'Gagal mengunggah. Silakan coba lagi.'));
      };
      xhr.onerror = function () { reject(new Error('Tidak dapat terhubung ke server. Periksa koneksimu.')); };
      xhr.onabort = function () { var e = new Error('Dibatalkan'); e.aborted = true; reject(e); };
      xhr.send(body);
    });
    return { promise: promise, abort: function () { xhr.abort(); } };
  }

  function q(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }

  /* ---------- Picker + pratinjau ---------- */
  function start(config) {
    cfg = config;
    $('#attach-dialog').querySelectorAll('[data-kind]').forEach(function (b) {
      b.hidden = !!(config.kinds && config.kinds.indexOf(b.dataset.kind) < 0);
    });
    $('#attach-dialog').showModal();
  }

  function pickKind(kind) {
    $('#attach-dialog').close();
    var input = $('#attach-file');
    input.accept = ACCEPT[kind];
    input.dataset.kind = kind;
    input.value = '';
    input.click();
  }

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    var kind = e.target.dataset.kind;
    e.target.value = '';
    if (!file) return;
    if (file.size > LIMITS[kind] * 1048576) { UI.toast('Ukuran file maksimal ' + LIMITS[kind] + ' MB.', 'error'); return; }
    if (!file.size) { UI.toast('File kosong.', 'error'); return; }
    openPreview(file, kind);
  }

  function openPreview(file, kind) {
    current = { file: file, kind: kind, url: URL.createObjectURL(file) };
    var box = $('#ap-preview');
    box.textContent = '';
    var el;
    if (kind === 'image') { el = document.createElement('img'); el.alt = 'Pratinjau'; el.src = current.url; }
    else if (kind === 'video') { el = document.createElement('video'); el.controls = true; el.preload = 'metadata'; el.playsInline = true; el.src = current.url; }
    else if (kind === 'audio') { el = document.createElement('audio'); el.controls = true; el.src = current.url; }
    else { el = make('div', 'ap__file', ICON.file); }
    box.appendChild(el);
    $('#ap-name').textContent = file.name;
    $('#ap-size').textContent = fmtSize(file.size);
    $('#ap-caption').value = '';
    $('#ap-error').textContent = '';
    setProgress(0, false);
    $('#ap-send').disabled = false;
    $('#attach-preview').showModal();
  }

  function setProgress(v, show) {
    var bar = $('#ap-progress');
    bar.hidden = !show;
    $('#ap-progress-fill').style.width = Math.round(v * 100) + '%';
  }

  function closePreview() {
    if (job) { job.abort(); job = null; }
    if (current) { URL.revokeObjectURL(current.url); current = null; }
    $('#ap-preview').textContent = '';
    if ($('#attach-preview').open) $('#attach-preview').close();
  }

  async function send(e) {
    e.preventDefault();
    if (!current || job) return;
    $('#ap-error').textContent = '';
    $('#ap-send').disabled = true;
    setProgress(0, true);
    job = cfg.upload(current.file, current.kind, $('#ap-caption').value, function (v) { setProgress(v, true); });
    try {
      await job.promise;
      job = null;
      closePreview();
    } catch (err) {
      job = null;
      if (err.aborted) return;
      $('#ap-error').textContent = err.message;
      $('#ap-send').disabled = false;
      setProgress(0, false);
    }
  }

  /* ---------- Render lampiran (tanpa innerHTML) ---------- */
  function linkify(parent, text) {
    var re = /https?:\/\/[^\s<>"']+/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:!?)]+$/, '');
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = make('a', 'link', url);
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
      parent.appendChild(a);
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function voicePlayer(att, withMeta) {
    var wrap = make('div', 'voice');
    var audio = document.createElement('audio');
    audio.preload = withMeta ? 'metadata' : 'none';
    audio.src = att.url;
    var btn = make('button', 'voice__btn', '▶');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Putar pesan suara');
    var track = make('div', 'voice__track');
    track.setAttribute('role', 'progressbar');
    var fill = make('span', 'voice__fill');
    track.appendChild(fill);
    var time = make('span', 'voice__time', fmtTime(att.duration));
    var total = att.duration || 0;

    btn.addEventListener('click', function () {
      if (audio.paused) {
        document.querySelectorAll('.voice audio').forEach(function (a) { if (a !== audio) a.pause(); });
        audio.play().catch(function () { UI.toast('Tidak dapat memutar audio.', 'error'); });
      } else audio.pause();
    });
    audio.addEventListener('play', function () { btn.textContent = '❚❚'; btn.setAttribute('aria-label', 'Jeda'); });
    audio.addEventListener('pause', function () { btn.textContent = '▶'; btn.setAttribute('aria-label', 'Putar pesan suara'); });
    audio.addEventListener('loadedmetadata', function () { if (isFinite(audio.duration)) { total = audio.duration; time.textContent = fmtTime(total); } });
    audio.addEventListener('timeupdate', function () {
      var d = total || audio.duration || 1;
      fill.style.width = Math.min(100, audio.currentTime / d * 100) + '%';
      time.textContent = fmtTime(audio.currentTime);
    });
    audio.addEventListener('ended', function () { fill.style.width = '0%'; time.textContent = fmtTime(total); });
    track.addEventListener('click', function (e) {
      var d = total || audio.duration;
      if (!d) return;
      var r = track.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d;
    });
    wrap.appendChild(btn);
    wrap.appendChild(track);
    wrap.appendChild(time);
    wrap.appendChild(audio);
    return wrap;
  }

  // Video: thumbnail (frame awal), tombol putar, durasi. Tidak autoplay.
  function videoPlayer(att) {
    var wrap = make('div', 'att-video');
    var v = document.createElement('video');
    v.preload = 'metadata';
    v.playsInline = true;
    v.src = att.url + '#t=0.1';
    v.setAttribute('aria-label', att.name || 'Video');
    var play = make('button', 'att-video__play');
    play.type = 'button';
    play.setAttribute('aria-label', 'Putar video');
    play.appendChild(make('span', null, '▶'));
    var dur = make('span', 'att-video__dur', '');
    v.addEventListener('loadedmetadata', function () { if (isFinite(v.duration)) dur.textContent = fmtTime(v.duration); });
    play.addEventListener('click', function () { v.controls = true; play.hidden = true; dur.hidden = true; v.play().catch(function () {}); });
    v.addEventListener('ended', function () { v.controls = false; play.hidden = false; dur.hidden = false; });
    wrap.appendChild(v);
    wrap.appendChild(play);
    wrap.appendChild(dur);
    return wrap;
  }

  // kind: image | video | audio | voice | file. Media dimuat malas, tanpa autoplay.
  function render(att, kind) {
    if (kind === 'image') {
      var a = make('a', 'att att--image');
      a.href = att.url; a.target = '_blank'; a.rel = 'noopener';
      var img = document.createElement('img');
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = att.name || 'Foto'; img.src = att.url;
      a.appendChild(img);
      return a;
    }
    if (kind === 'video') return videoPlayer(att);
    if (kind === 'audio') {
      var box = make('div', 'att att--audio');
      box.appendChild(voicePlayer(att, true));
      if (att.name) box.appendChild(make('span', 'att__size truncate', att.name));
      return box;
    }
    if (kind === 'voice') return voicePlayer(att);
    var ext = ((att.name || '').split('.').pop() || '').toUpperCase().slice(0, 4);
    if (!ext || ext.length > 4 || ext === (att.name || '').toUpperCase()) ext = att.mime === 'application/pdf' ? 'PDF' : att.mime === 'application/zip' ? 'ZIP' : 'TXT';
    var f = make('a', 'att-doc');
    f.href = att.url; f.download = att.name || 'file'; f.rel = 'noopener';
    f.appendChild(make('span', 'att-doc__icon', ext));
    var info = make('span', 'att-doc__info');
    info.appendChild(make('span', 'att-doc__name truncate', att.name || 'File'));
    info.appendChild(make('span', 'att-doc__meta', ext + ' · ' + fmtSize(att.size || 0)));
    f.appendChild(info);
    var dl = make('span', 'att-doc__dl');
    dl.setAttribute('aria-hidden', 'true');
    dl.innerHTML = '<svg class="icon" width="18" height="18"><use href="#i-download"/></svg>'; // markup statis
    f.appendChild(dl);
    return f;
  }

  /* ---------- Perekam pesan suara (MediaRecorder) ---------- */
  var rec = null;
  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    for (var i = 0; i < list.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  var Recorder = {
    supported: function () { return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    // Mulai merekam. onTick(detik) dipanggil tiap detik; onLimit() saat mencapai batas durasi.
    start: async function (onTick, onLimit) {
      if (rec) return false;
      var constraints = { audio: XenPrefs.get('micId') ? { deviceId: { exact: XenPrefs.get('micId') } } : true };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      var mime = pickMime();
      var mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec = { stream: stream, mr: mr, chunks: [], t0: Date.now(), timer: null };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.start(250);
      rec.timer = setInterval(function () {
        var s = (Date.now() - rec.t0) / 1000;
        if (onTick) onTick(s);
        if (s >= 120 && onLimit) onLimit();
      }, 250);
      return true;
    },
    // Hentikan. Mengembalikan {blob, duration} atau null (jika dibatalkan).
    stop: function (keep) {
      return new Promise(function (resolve) {
        if (!rec) { resolve(null); return; }
        var r = rec;
        rec = null;
        clearInterval(r.timer);
        var duration = (Date.now() - r.t0) / 1000;
        r.mr.onstop = function () {
          r.stream.getTracks().forEach(function (t) { t.stop(); });
          resolve(keep && r.chunks.length ? { blob: new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' }), duration: duration } : null);
        };
        try { r.mr.stop(); } catch (e) { r.stream.getTracks().forEach(function (t) { t.stop(); }); resolve(null); }
      });
    },
    active: function () { return !!rec; }
  };

  function init() {
    $('#attach-dialog').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (b) pickKind(b.dataset.kind);
      else if (e.target === $('#attach-dialog')) $('#attach-dialog').close();
    });
    $('#attach-file').addEventListener('change', onFile);
    $('#ap-form').addEventListener('submit', send);
    $('#ap-cancel').addEventListener('click', closePreview);
    $('#attach-preview').addEventListener('cancel', function () { if (job) job.abort(); });
    $('#attach-preview').addEventListener('close', function () { if (current && !job) { URL.revokeObjectURL(current.url); current = null; } });
  }

  return { init: init, start: start, upload: upload, q: q, render: render, linkify: linkify, fmtSize: fmtSize, fmtTime: fmtTime, Recorder: Recorder };
})();
