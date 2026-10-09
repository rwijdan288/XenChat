'use strict';

const Block = require('../models/Block');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { assertId } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');

// Mengembalikan dokumen Block (jika ada) antara dua user, arah mana pun.
const findBlock = (a, b) => Block.findOne({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] });
const blockedEither = async (a, b) => !!(await findBlock(a, b));

async function block(userId, targetId) {
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (targetId === userId) throw new AppError(400, 'Kamu tidak bisa memblokir dirimu sendiri.');
  const target = await User.findById(targetId);
  if (!target || target.deleted) throw new AppError(404, 'Pengguna tidak ditemukan.');
  if (target.role === 'owner') throw new AppError(403, 'Akun ini tidak bisa diblokir.');
  await Block.updateOne({ blockerId: userId, blockedId: targetId }, { $setOnInsert: { blockerId: userId, blockedId: targetId } }, { upsert: true });
}

async function unblock(userId, targetId) {
  assertId(targetId, 'Pengguna tidak ditemukan.');
  await Block.deleteOne({ blockerId: userId, blockedId: targetId });
}

async function list(userId, { skip, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const off = Math.max(parseInt(skip, 10) || 0, 0);
  const rows = await Block.find({ blockerId: userId }).sort({ createdAt: -1 }).skip(off).limit(lim + 1);
  const page = rows.slice(0, lim);
  const users = await User.find({ _id: { $in: page.map((b) => b.blockedId) } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return {
    users: page.filter((b) => byId.has(b.blockedId.toString())).map((b) => publicUser(byId.get(b.blockedId.toString()))),
    hasMore: rows.length > lim
  };
}

module.exports = { findBlock, blockedEither, block, unblock, list };
