'use strict';

const config = require('../config/config');
const User = require('../models/User');
const Call = require('../models/Call');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { assertId } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');

// Riwayat milik user (yang tidak disembunyikan), terbaru dulu, cursor `before` = tanggal mulai.
const list = asyncHandler(async (req, res) => {
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
  const uid = req.user._id;
  const filter = { $or: [{ callerId: uid }, { calleeId: uid }], hiddenBy: { $ne: uid }, status: { $ne: 'ringing' } };
  if (typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before))) filter.startedAt = { $lt: new Date(req.query.before) };

  const rows = await Call.find(filter).sort({ startedAt: -1 }).limit(lim + 1);
  const page = rows.slice(0, lim);
  const otherIds = page.map((c) => (c.callerId.equals(uid) ? c.calleeId : c.callerId));
  const users = await User.find({ _id: { $in: otherIds } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  res.json({
    calls: page.map((c) => {
      const outgoing = c.callerId.equals(uid);
      return {
        id: c._id.toString(),
        direction: outgoing ? 'outgoing' : 'incoming',
        type: c.type,
        status: c.status,
        startedAt: c.startedAt,
        duration: c.duration,
        user: publicUser(byId.get((outgoing ? c.calleeId : c.callerId).toString()))
      };
    }),
    hasMore: rows.length > lim
  });
});

const remove = asyncHandler(async (req, res) => {
  assertId(req.params.id, 'Riwayat tidak ditemukan.');
  const r = await Call.updateOne({ _id: req.params.id, $or: [{ callerId: req.user._id }, { calleeId: req.user._id }] }, { $addToSet: { hiddenBy: req.user._id } });
  if (!r.matchedCount) throw new AppError(404, 'Riwayat tidak ditemukan.');
  res.json({ ok: true });
});

const clear = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  await Call.updateMany({ $or: [{ callerId: uid }, { calleeId: uid }] }, { $addToSet: { hiddenBy: uid } });
  res.json({ ok: true });
});

// Server ICE untuk WebRTC (STUN dan, jika dikonfigurasi, TURN).
const ice = (req, res) => {
  const servers = [];
  if (config.ice.stun.length) servers.push({ urls: config.ice.stun });
  if (config.ice.turnUrls.length && config.ice.turnUser) servers.push({ urls: config.ice.turnUrls, username: config.ice.turnUser, credential: config.ice.turnPass });
  res.json({ iceServers: servers });
};

module.exports = { list, remove, clear, ice };
