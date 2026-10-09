'use strict';

const User = require('../models/User');
const Block = require('../models/Block');
const bcrypt = require('bcryptjs');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { USERNAME_RE, RESERVED_USERNAMES, cleanName, normalizeEmail, isEmail } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');

const ACCOUNT_ID_RE = /^\d{8}$/;
const MAX_AVATAR_BYTES = 60 * 1024;

function detectImageType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const getMe = (req, res) => {
  res.json({ user: { ...req.user.toPublic(), online: true } });
};

// Hanya name, username, bio, avatar yang dibaca. accountId & verified tidak pernah.
const updateMe = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fields = {};
  const set = {};
  const unset = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (!name) fields.name = 'Nama wajib diisi.';
    else if (name.length > 50) fields.name = 'Nama maksimal 50 karakter.';
    else set.name = name;
  }

  if ('username' in body) {
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!USERNAME_RE.test(username)) fields.username = 'Username 3-20 karakter: huruf kecil, angka, atau underscore.';
    else if (RESERVED_USERNAMES.has(username) && username !== req.user.username) fields.username = 'Username ini tidak tersedia.';
    else set.username = username;
  }

  if ('bio' in body) {
    const bio = typeof body.bio === 'string' ? cleanName(body.bio) : null;
    if (bio === null) fields.bio = 'Bio tidak valid.';
    else if (bio.length > 160) fields.bio = 'Bio maksimal 160 karakter.';
    else set.bio = bio;
  }

  if ('avatar' in body) {
    if (body.avatar === null || body.avatar === '') {
      set.avatarUrl = '';
      unset.avatarData = '';
      unset.avatarType = '';
    } else {
      const m = typeof body.avatar === 'string' && body.avatar.length <= 90000
        ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(body.avatar)
        : null;
      const buf = m ? Buffer.from(m[1], 'base64') : null;
      const type = buf ? detectImageType(buf) : null;
      if (!buf || !type || buf.length > MAX_AVATAR_BYTES) {
        fields.avatar = 'Foto tidak valid (JPEG/PNG/WebP, maksimal 60 KB).';
      } else {
        set.avatarData = buf;
        set.avatarType = type;
        set.avatarUrl = `/api/users/avatar/${req.user.accountId}?v=${Date.now()}`;
      }
    }
  }

  if (Object.keys(fields).length) throw new AppError(400, 'Periksa kembali data yang kamu isi.', fields);

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  let user = req.user;
  if (Object.keys(update).length) {
    try {
      user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
    } catch (err) {
      if (err && err.code === 11000) throw new AppError(409, 'Username sudah dipakai.', { username: 'Username sudah dipakai.' });
      throw err;
    }
  }
  res.json({ user: { ...user.toPublic(), online: true } });
});

const search = asyncHandler(async (req, res) => {
  let q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 20);
  if (q.length < 2 || q.length > 30) return res.json({ users: [] });

  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const or = [{ username: new RegExp(`^${esc.toLowerCase()}`) }, { name: new RegExp(esc, 'i') }];
  if (/^\d+$/.test(q)) or.push({ accountId: q.length === 8 ? q : new RegExp(`^${q}`) });

  const users = await User.find({ _id: { $ne: req.user._id }, deleted: { $ne: true }, banned: { $ne: true }, $or: or })
    .select('accountId name username avatarUrl bio verified lastSeen settings')
    .limit(limit);
  res.json({ users: users.map(publicUser) });
});

const getByUsername = asyncHandler(async (req, res) => {
  const username = String(req.params.username || '').toLowerCase();
  if (!USERNAME_RE.test(username)) throw new AppError(404, 'Pengguna tidak ditemukan.');
  const user = await User.findOne({ username, deleted: { $ne: true } });
  if (!user) throw new AppError(404, 'Pengguna tidak ditemukan.');
  res.json({ user: publicUser(user), blocked: !!(await Block.exists({ blockerId: req.user._id, blockedId: user._id })) });
});

const getByAccountId = asyncHandler(async (req, res) => {
  if (!ACCOUNT_ID_RE.test(req.params.accountId)) throw new AppError(404, 'Pengguna tidak ditemukan.');
  const user = await User.findOne({ accountId: req.params.accountId, deleted: { $ne: true } });
  if (!user) throw new AppError(404, 'Pengguna tidak ditemukan.');
  res.json({ user: publicUser(user), blocked: !!(await Block.exists({ blockerId: req.user._id, blockedId: user._id })) });
});

const getAvatar = asyncHandler(async (req, res) => {
  if (!ACCOUNT_ID_RE.test(req.params.accountId)) throw new AppError(404, 'Foto tidak ditemukan.');
  const user = await User.findOne({ accountId: req.params.accountId }).select('+avatarData +avatarType');
  if (!user || !user.avatarData) throw new AppError(404, 'Foto tidak ditemukan.');
  res.set('Content-Type', user.avatarType);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(user.avatarData);
});

// Pengaturan yang benar-benar dipakai server: status online & privasi story bawaan.
const updateSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const set = {};
  if ('showPresence' in body) {
    if (typeof body.showPresence !== 'boolean') throw new AppError(400, 'Pengaturan tidak valid.');
    set['settings.showPresence'] = body.showPresence;
  }
  if ('defaultStoryPrivacy' in body) {
    if (!['everyone', 'contacts', 'nobody'].includes(body.defaultStoryPrivacy)) throw new AppError(400, 'Pengaturan tidak valid.');
    set['settings.defaultStoryPrivacy'] = body.defaultStoryPrivacy;
  }
  const user = Object.keys(set).length ? await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true }) : req.user;
  res.json({ user: { ...user.toPublic(), online: true } });
});

// Ubah email: wajib konfirmasi password.
const setEmail = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new AppError(400, 'Format email tidak valid.', { email: 'Format email tidak valid.' });
  const u = await User.findById(req.user._id).select('+passwordHash');
  if (typeof body.password !== 'string' || !(await bcrypt.compare(body.password, u.passwordHash))) {
    throw new AppError(403, 'Password salah.', { password: 'Password salah.' });
  }
  u.email = email;
  try { await u.save(); } catch (err) {
    if (err && err.code === 11000) throw new AppError(409, 'Email sudah terdaftar.', { email: 'Email sudah terdaftar.' });
    throw err;
  }
  res.json({ user: { ...u.toPublic(), online: true } });
});

module.exports = { updateSettings, setEmail, getMe, updateMe, search, getByUsername, getByAccountId, getAvatar };
