'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config/config');
const User = require('../models/User');
const Group = require('../models/Group');
const Channel = require('../models/Channel');
const Report = require('../models/Report');
const AppError = require('../utils/AppError');
const { generateAccountId } = require('../utils/accountId');
const { assertId, USERNAME_RE, isEmail, validatePassword } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');
const presence = require('./presenceService');

// Dipanggil sekali setelah MongoDB terhubung. Idempotent: tidak pernah membuat Owner kedua.
async function bootstrapOwner() {
  const existing = await User.findOne({ role: 'owner' }).select('username');
  if (existing) {
    console.log(`[owner] Owner sudah ada: @${existing.username}`);
    return;
  }
  const o = config.owner;
  const pwError = validatePassword(o.password);
  if (!USERNAME_RE.test(o.username) || !isEmail(o.email) || pwError || o.password.length < 10) {
    console.warn('[owner] Belum ada Owner. Isi OWNER_USERNAME, OWNER_EMAIL, dan OWNER_PASSWORD (min. 10 karakter) di .env lalu restart.');
    return;
  }
  if (await User.exists({ $or: [{ username: o.username }, { email: o.email }] })) {
    console.error('[owner] OWNER_USERNAME/OWNER_EMAIL sudah dipakai akun biasa. Owner tidak dibuat; gunakan nilai lain.');
    return;
  }
  const passwordHash = await bcrypt.hash(o.password, 12);
  for (let i = 0; i < 10; i += 1) {
    try {
      await User.create({ accountId: generateAccountId(), name: o.name, username: o.username, email: o.email, passwordHash, role: 'owner', verified: true });
      console.log(`[owner] Owner dibuat: @${o.username}`);
      return;
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
      if (err.keyPattern && (err.keyPattern.role || err.keyPattern.username || err.keyPattern.email)) return; // instance lain sudah membuatnya
    }
  }
}

const ownerView = (u) => ({
  ...publicUser(u), email: u.email || '', role: u.role, banned: !!u.banned, createdAt: u.createdAt, lastSeen: u.lastSeen
});

async function stats() {
  const [users, banned, groups, channels, openReports] = await Promise.all([
    User.countDocuments({ deleted: { $ne: true } }),
    User.countDocuments({ banned: true }),
    Group.estimatedDocumentCount(),
    Channel.estimatedDocumentCount(),
    Report.countDocuments({ status: 'open' })
  ]);
  return { users, banned, groups, channels, openReports, online: presence.count() };
}

async function listUsers({ q, skip, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), 5000);
  const filter = { deleted: { $ne: true } };
  const text = typeof q === 'string' ? q.trim().replace(/^@/, '').slice(0, 40) : '';
  if (text) {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ username: new RegExp(`^${esc.toLowerCase()}`) }, { name: new RegExp(esc, 'i') }, { email: new RegExp(`^${esc.toLowerCase()}`) }];
    if (/^\d{1,8}$/.test(text)) filter.$or.push({ accountId: new RegExp(`^${text}`) });
  }
  const rows = await User.find(filter).sort({ createdAt: -1 }).skip(off).limit(lim + 1);
  return { users: rows.slice(0, lim).map(ownerView), hasMore: rows.length > lim };
}

async function loadTarget(actorId, id) {
  assertId(id, 'Pengguna tidak ditemukan.');
  const u = await User.findById(id);
  if (!u || u.deleted) throw new AppError(404, 'Pengguna tidak ditemukan.');
  if (u.role === 'owner' || id === actorId) throw new AppError(403, 'Tindakan ini tidak diizinkan untuk akun ini.');
  return u;
}

async function setBanned(actorId, id, banned) {
  const u = await loadTarget(actorId, id);
  u.banned = banned;
  u.bannedAt = banned ? new Date() : null;
  await u.save();
  return ownerView(u);
}

async function setVerified(actorId, id, verified) {
  assertId(id, 'Pengguna tidak ditemukan.');
  const u = await User.findById(id);
  if (!u || u.deleted) throw new AppError(404, 'Pengguna tidak ditemukan.');
  if (u.role === 'owner') throw new AppError(403, 'Akun Owner selalu terverifikasi.');
  u.verified = verified;
  await u.save();
  return ownerView(u);
}

async function listReports({ status, skip, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), 5000);
  const rows = await Report.find({ status: status === 'resolved' ? 'resolved' : 'open' }).sort({ createdAt: -1 }).skip(off).limit(lim + 1);
  const page = rows.slice(0, lim);
  const ids = [...new Set(page.flatMap((r) => [r.reporterId.toString(), r.targetId.toString()]))];
  const users = await User.find({ _id: { $in: ids } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return {
    reports: page.map((r) => ({
      id: r._id.toString(), category: r.category, details: r.details, status: r.status, note: r.note, createdAt: r.createdAt,
      reporter: byId.has(r.reporterId.toString()) ? publicUser(byId.get(r.reporterId.toString())) : null,
      target: byId.has(r.targetId.toString()) ? ownerView(byId.get(r.targetId.toString())) : null
    })),
    hasMore: rows.length > lim
  };
}

async function resolveReport(actorId, id, note) {
  assertId(id, 'Laporan tidak ditemukan.');
  const r = await Report.findOneAndUpdate(
    { _id: id, status: 'open' },
    { $set: { status: 'resolved', resolvedBy: actorId, resolvedAt: new Date(), note: typeof note === 'string' ? note.trim().slice(0, 300) : '' } },
    { new: true }
  );
  if (!r) throw new AppError(404, 'Laporan tidak ditemukan atau sudah diselesaikan.');
}

// Verifikasi saluran hanya lewat Owner (tidak pernah dari input user).
async function listChannels({ q, skip, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), 5000);
  const filter = {};
  const text = typeof q === 'string' ? q.trim().replace(/^@/, '').slice(0, 40) : '';
  if (text) {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ username: new RegExp(`^${esc.toLowerCase()}`) }, { name: new RegExp(esc, 'i') }];
  }
  const rows = await Channel.find(filter).sort({ followersCount: -1, _id: 1 }).skip(off).limit(lim + 1);
  return {
    channels: rows.slice(0, lim).map((c) => ({ id: c._id.toString(), name: c.name, username: c.username, avatarUrl: c.avatarUrl, followersCount: c.followersCount, verified: c.verified })),
    hasMore: rows.length > lim
  };
}

async function setChannelVerified(id, verified) {
  assertId(id, 'Saluran tidak ditemukan.');
  const c = await Channel.findByIdAndUpdate(id, { $set: { verified } }, { new: true });
  if (!c) throw new AppError(404, 'Saluran tidak ditemukan.');
  return { id: c._id.toString(), verified: c.verified };
}

module.exports = { bootstrapOwner, stats, listUsers, setBanned, setVerified, listReports, resolveReport, listChannels, setChannelVerified };
