'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Identitas SELALU dari JWT -> database. Role/banned dibaca dari database, bukan dari client.
async function userFromToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  const user = await User.findById(payload.sub);
  if (!user || user.deleted) return null;
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) return null; // sesi dicabut
  return user;
}

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies && req.cookies[config.cookieName];
  if (!token) throw new AppError(401, 'Silakan login terlebih dahulu.');
  let user = null;
  try { user = await userFromToken(token); } catch (err) { user = null; }
  if (!user) throw new AppError(401, 'Sesi berakhir. Silakan login kembali.');
  if (user.banned) throw new AppError(403, 'Akun ini dinonaktifkan.');
  req.user = user;
  next();
});

// Khusus Owner platform (role dari database).
const requireOwner = (req, res, next) => {
  if (!req.user || req.user.role !== 'owner') return next(new AppError(403, 'Kamu tidak punya izin.'));
  return next();
};

module.exports = { requireAuth, requireOwner, userFromToken };
