'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User');
const Group = require('../models/Group');
const Channel = require('../models/Channel');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateAccountId } = require('../utils/accountId');
const { USERNAME_RE, RESERVED_USERNAMES, cleanName, validatePassword, normalizeEmail, isEmail } = require('../utils/validators');

// Hash dummy supaya waktu respons login sama baik username ada maupun tidak.
const DUMMY_HASH = bcrypt.hashSync('xenchat-dummy-password', 12);

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: config.cookieMaxAgeMs, path: '/' };
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  res.cookie(config.cookieName, token, cookieOptions());
}

// Register hanya membaca name, username, email, password, confirmPassword.
// role / verified / accountId tidak pernah diambil dari client.
const register = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { username, password, confirmPassword } = body;

  const fields = {};
  const name = typeof body.name === 'string' ? cleanName(body.name) : '';
  if (!name) fields.name = 'Nama lengkap wajib diisi.';
  else if (name.length > 50) fields.name = 'Nama maksimal 50 karakter.';

  const uname = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(uname)) fields.username = 'Username 3-20 karakter: huruf kecil, angka, atau underscore.';
  else if (RESERVED_USERNAMES.has(uname)) fields.username = 'Username ini tidak tersedia.';

  const email = normalizeEmail(body.email);
  if (!email) fields.email = 'Email wajib diisi.';
  else if (!isEmail(email)) fields.email = 'Format email tidak valid.';

  const pwError = validatePassword(password);
  if (pwError) fields.password = pwError;
  else if (password !== confirmPassword) fields.confirmPassword = 'Konfirmasi password tidak cocok.';

  if (Object.keys(fields).length) throw new AppError(400, 'Periksa kembali data yang kamu isi.', fields);

  const passwordHash = await bcrypt.hash(password, 12);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const user = await User.create({ accountId: generateAccountId(), name, username: uname, email, passwordHash });
      issueSession(res, user);
      return res.status(201).json({ user: user.toPublic() });
    } catch (err) {
      if (err && err.code === 11000) {
        const key = err.keyPattern || {};
        if (key.username) throw new AppError(409, 'Username sudah dipakai.', { username: 'Username sudah dipakai.' });
        if (key.email) throw new AppError(409, 'Email sudah terdaftar.', { email: 'Email sudah terdaftar.' });
        continue; // accountId bentrok -> coba lagi
      }
      throw err;
    }
  }
  throw new AppError(500, 'Terjadi kesalahan. Silakan coba lagi.');
});

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new AppError(400, 'Username dan password wajib diisi.');
  }
  const user = await User.findOne({ username: username.trim().toLowerCase(), deleted: { $ne: true } }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'Username atau password salah.');
  if (user.banned) throw new AppError(403, 'Akun ini dinonaktifkan.');
  issueSession(res, user);
  res.json({ user: user.toPublic() });
});

const logout = (req, res) => {
  res.clearCookie(config.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
  res.json({ ok: true });
};

const me = (req, res) => res.json({ user: req.user.toPublic() });

async function checkPassword(userId, password) {
  const u = await User.findById(userId).select('+passwordHash');
  if (typeof password !== 'string' || !password || !(await bcrypt.compare(password, u.passwordHash))) {
    throw new AppError(403, 'Password salah.', { currentPassword: 'Password salah.' });
  }
  return u;
}

// Ganti password: semua sesi lain dicabut, sesi ini diperbarui.
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const u = await checkPassword(req.user.id, currentPassword);
  const err = validatePassword(newPassword);
  if (err) throw new AppError(400, err, { newPassword: err });
  if (newPassword !== confirmPassword) throw new AppError(400, 'Konfirmasi password tidak cocok.', { confirmPassword: 'Konfirmasi password tidak cocok.' });
  u.passwordHash = await bcrypt.hash(newPassword, 12);
  u.tokenVersion = (u.tokenVersion || 0) + 1;
  await u.save();
  issueSession(res, u);
  res.json({ ok: true });
});

const logoutAll = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  const io = req.app.get('io');
  if (io) io.in(`user:${req.user.id}`).disconnectSockets(true);
  res.clearCookie(config.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
  res.json({ ok: true });
});

// Hapus akun: data pribadi dihapus/dianonimkan; pesan lama tetap ada sebagai "Akun dihapus".
const deleteAccount = asyncHandler(async (req, res) => {
  if (req.user.role === 'owner') throw new AppError(403, 'Akun Owner tidak bisa dihapus.');
  const u = await checkPassword(req.user.id, (req.body || {}).password);
  const owns = (await Group.exists({ ownerId: u._id })) || (await Channel.exists({ ownerId: u._id }));
  if (owns) throw new AppError(400, 'Pindahkan kepemilikan atau hapus grup/saluran milikmu dulu.');
  u.name = 'Akun dihapus';
  u.username = `deleted_${u._id.toString().slice(-10)}`;
  u.email = undefined;
  u.bio = '';
  u.avatarUrl = '';
  u.avatarData = undefined;
  u.verified = false;
  u.deleted = true;
  u.passwordHash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
  u.tokenVersion = (u.tokenVersion || 0) + 1;
  await u.save();
  const io = req.app.get('io');
  if (io) io.in(`user:${u.id}`).disconnectSockets(true);
  res.clearCookie(config.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
  res.json({ ok: true });
});

module.exports = { register, login, logout, me, changePassword, logoutAll, deleteAccount };
