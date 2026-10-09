'use strict';

// Abstraksi penyimpanan media. Saat ini driver "local" (disk). Untuk object storage (S3/R2),
// cukup ganti objek `driver` dengan implementasi put/remove/send yang sama.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');
const AppError = require('../utils/AppError');

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'text/plain': 'txt'
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp|mp4|mov|webm|mp3|ogg|weba|m4a|pdf|zip|txt)$/;
const DOWNLOAD_EXT = new Set(['pdf', 'zip', 'txt']); // disajikan sebagai unduhan, bukan inline
const URL_PREFIX = '/api/media/';

/* ---------- Driver penyimpanan lokal ---------- */
const driver = {
  async put(filename, buf) {
    await fs.promises.mkdir(config.uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(config.uploadDir, filename), buf, { flag: 'wx', mode: 0o640 });
  },
  async remove(filename) {
    await fs.promises.unlink(path.join(config.uploadDir, filename)).catch(() => {});
  },
  send(res, filename, done) {
    res.sendFile(
      filename,
      {
        root: config.uploadDir,
        dotfiles: 'deny',
        acceptRanges: true, // dibutuhkan pemutar video
        headers: {
          'Content-Type': MIME_BY_EXT[filename.split('.').pop()],
          'Content-Disposition': DOWNLOAD_EXT.has(filename.split('.').pop()) ? 'attachment' : 'inline',
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      done
    );
  }
};

/* ---------- Deteksi format dari isi file (bukan dari Content-Type client) ---------- */
function detect(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return { kind: 'image', mime: 'image/png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { kind: 'video', mime: buf.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return { kind: 'video', mime: 'video/webm' };
  return null;
}

// Durasi dari box 'mvhd' (MP4/MOV). Mencoba kemunculan pertama dan terakhir (moov bisa di awal/akhir file).
function mp4Duration(buf) {
  const at = (i) => {
    if (i < 4 || i + 36 > buf.length) return null;
    const v = buf[i + 4];
    let ts;
    let dur;
    if (v === 0) { ts = buf.readUInt32BE(i + 16); dur = buf.readUInt32BE(i + 20); }
    else if (v === 1) { ts = buf.readUInt32BE(i + 24); dur = Number(buf.readBigUInt64BE(i + 28)); }
    else return null;
    return ts > 0 && dur > 0 ? dur / ts : null;
  };
  const first = buf.indexOf('mvhd');
  if (first < 0) return null;
  const a = at(first);
  return a !== null ? a : at(buf.lastIndexOf('mvhd'));
}

// Durasi dari elemen EBML Duration (WebM). Mengembalikan null jika tidak ada (mis. hasil MediaRecorder).
function webmDuration(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 65536));
  let scale = 1000000;
  const t = head.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (t >= 0) {
    const len = head[t + 3] - 0x80;
    if (len >= 1 && len <= 4) scale = head.readUIntBE(t + 4, len);
  }
  const d = head.indexOf(Buffer.from([0x44, 0x89]));
  if (d < 0) return null;
  const size = head[d + 2];
  let value = null;
  if (size === 0x88 && d + 11 <= head.length) value = head.readDoubleBE(d + 3);
  else if (size === 0x84 && d + 7 <= head.length) value = head.readFloatBE(d + 3);
  return value > 0 ? (value * scale) / 1e9 : null;
}

const videoDuration = (buf, mime) => (mime === 'video/webm' ? webmDuration(buf) : mp4Duration(buf));

/* ---------- API ---------- */
function newName(ext) {
  return `${crypto.randomBytes(16).toString('hex')}.${ext}`; // nama acak, tidak memakai nama dari user
}

// Simpan gambar/video setelah divalidasi isi, ukuran, dan durasi.
async function saveMedia(buf, opts) {
  const imageOnly = !!(opts && opts.imageOnly);
  const maxImage = (opts && opts.maxImage) || config.limits.imageBytes;
  const type = detect(buf);
  if (!type || (imageOnly && type.kind !== 'image')) {
    throw new AppError(400, imageOnly ? 'Foto harus JPEG, PNG, atau WebP.' : 'Format tidak didukung. Gunakan JPEG, PNG, WebP, MP4, MOV, atau WebM.');
  }

  let duration = null;
  if (type.kind === 'image') {
    if (buf.length > maxImage) throw new AppError(400, `Gambar maksimal ${Math.round(maxImage / 1024 / 1024 * 10) / 10} MB.`.replace('0.1 MB', '60 KB'));
  } else {
    if (buf.length > config.limits.videoBytes) throw new AppError(400, 'Video maksimal 25 MB.');
    duration = videoDuration(buf, type.mime);
    if (duration === null) throw new AppError(400, 'Durasi video tidak terbaca. Gunakan file MP4 atau WebM yang valid.');
    if (duration > config.limits.videoSeconds + 0.5) throw new AppError(400, 'Durasi video maksimal 60 detik.');
  }

  const filename = newName(EXT[type.mime]);
  await driver.put(filename, buf);
  return { url: URL_PREFIX + filename, mime: type.mime, kind: type.kind, size: buf.length, duration };
}

// Lampiran chat/saluran. `kind`: image | video | audio | voice | file. Isi file diverifikasi dari signature.
function detectAttachment(buf, kind) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const head = buf.toString('ascii', 0, 4);
  if (kind === 'image') { const t = detect(buf); return t && t.kind === 'image' ? t.mime : null; }
  if (kind === 'video') {
    if (buf.toString('ascii', 4, 8) === 'ftyp' && buf.toString('ascii', 8, 12) !== 'qt  ' && buf.toString('ascii', 8, 12) !== 'M4A ') return 'video/mp4';
    return buf.readUInt32BE(0) === 0x1a45dfa3 ? 'video/webm' : null;
  }
  if (kind === 'audio' || kind === 'voice') {
    if (head === 'OggS') return 'audio/ogg';
    if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm'; // hasil MediaRecorder / WebM audio
    if (buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4'; // m4a (Safari MediaRecorder)
    if (kind === 'audio' && (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
    return null;
  }
  if (kind === 'file') {
    if (head === '%PDF') return 'application/pdf';
    if (head === 'PK\u0003\u0004') return 'application/zip'; // zip/docx/xlsx/pptx
    // Teks polos: harus UTF-8 valid, tanpa byte NUL, dan kecil.
    if (buf.length <= 1024 * 1024 && !buf.includes(0)) {
      const text = buf.toString('utf8');
      if (!text.includes('\ufffd')) return 'text/plain';
    }
    return null;
  }
  return null;
}

function safeName(name, fallback) {
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return n || fallback;
}

async function saveAttachment(buf, kind, opts) {
  const limits = config.attachmentLimits;
  if (!['image', 'video', 'audio', 'voice', 'file'].includes(kind)) throw new AppError(400, 'Jenis lampiran tidak valid.');
  const max = limits[kind];
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError(400, 'File tidak ditemukan.');
  if (buf.length > max) throw new AppError(400, `Ukuran file maksimal ${Math.round(max / 1024 / 1024)} MB.`);
  const mime = detectAttachment(buf, kind);
  if (!mime) {
    const hints = { image: 'JPEG, PNG, atau WebP', video: 'MP4 atau WebM', audio: 'MP3, OGG, atau WebM audio', voice: 'rekaman suara yang valid', file: 'PDF, ZIP/DOCX, atau teks (.txt)' };
    throw new AppError(400, `Format file tidak didukung. Gunakan ${hints[kind]}.`);
  }
  const filename = newName(EXT[mime]);
  await driver.put(filename, buf);
  let duration = null;
  if (kind === 'voice') duration = Math.min(Math.max(Number(opts && opts.duration) || 0, 0), limits.voiceSeconds);
  return { url: URL_PREFIX + filename, mime, kind, size: buf.length, name: safeName(opts && opts.name, kind === 'voice' ? 'Pesan suara' : 'file'), duration };
}

const isValidName = (n) => FILE_RE.test(n);

// Avatar: data URL kecil (hasil resize di browser) -> file gambar.
async function saveAvatar(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.length <= 90000 ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl) : null;
  if (!m) throw new AppError(400, 'Foto tidak valid (JPEG/PNG/WebP, maksimal 60 KB).');
  return saveMedia(Buffer.from(m[1], 'base64'), { imageOnly: true, maxImage: config.limits.avatarBytes });
}

async function remove(url) {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) return;
  const name = url.slice(URL_PREFIX.length);
  if (FILE_RE.test(name)) await driver.remove(name);
}

// Handler GET /api/media/:filename (route sudah dilindungi requireAuth).
function serve(req, res, next) {
  const name = req.params.filename;
  if (!FILE_RE.test(name)) return next(new AppError(404, 'Media tidak ditemukan.'));
  return driver.send(res, name, (err) => {
    if (err && !res.headersSent) next(new AppError(404, 'Media tidak ditemukan.'));
  });
}

module.exports = { saveAttachment, isValidName, detect, mp4Duration, webmDuration, saveMedia, saveAvatar, remove, serve };
