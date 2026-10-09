'use strict';

const User = require('../models/User');
const Report = require('../models/Report');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { assertId, cleanName } = require('../utils/validators');

const CATEGORIES = ['spam', 'harassment', 'fake_account', 'inappropriate', 'other'];

const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  assertId(body.userId, 'Pengguna tidak ditemukan.');
  if (body.userId === req.user.id) throw new AppError(400, 'Kamu tidak bisa melaporkan dirimu sendiri.');
  if (!CATEGORIES.includes(body.category)) throw new AppError(400, 'Pilih kategori laporan.');
  const details = typeof body.details === 'string' ? cleanName(body.details).slice(0, 500) : '';
  const target = await User.findById(body.userId);
  if (!target || target.deleted) throw new AppError(404, 'Pengguna tidak ditemukan.');
  // Satu laporan terbuka per pasangan pelapor-terlapor (tanpa spam laporan).
  const dup = await Report.exists({ reporterId: req.user._id, targetId: target._id, status: 'open' });
  if (!dup) await Report.create({ reporterId: req.user._id, targetId: target._id, category: body.category, details });
  res.status(201).json({ ok: true });
});

module.exports = { create };
