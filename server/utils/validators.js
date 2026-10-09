'use strict';

const AppError = require('./AppError');

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED_USERNAMES = new Set([
  'admin', 'owner', 'root', 'system', 'support', 'official',
  'xenchat', 'xen', 'xenchat_ai', 'botmanager', 'api'
]);

// Buang karakter kontrol dan tanda < > lalu rapikan spasi.
function cleanName(value) {
  return String(value).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password wajib diisi.';
  if (password.length < 8) return 'Password minimal 8 karakter.';
  // Batas bcrypt: 72 byte.
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password terlalu panjang (maksimal 72 byte).';
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizeEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const isEmail = (v) => v.length <= 254 && EMAIL_RE.test(v);

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const isObjectId = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v);

function assertId(value, label) {
  if (!isObjectId(value)) throw new AppError(400, label || 'ID tidak valid.');
  return value;
}

// Teks bebas (pesan, postingan): string, tanpa karakter kontrol, 1..max karakter.
function cleanBody(value, max, label) {
  if (typeof value !== 'string') throw new AppError(400, `${label} tidak valid.`);
  const text = value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) throw new AppError(400, `${label} tidak boleh kosong.`);
  if (text.length > max) throw new AppError(400, `${label} maksimal ${max} karakter.`);
  return text;
}

const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

module.exports = { normalizeEmail, isEmail, assertId, cleanBody, REACTIONS, isObjectId, USERNAME_RE, RESERVED_USERNAMES, cleanName, validatePassword };
