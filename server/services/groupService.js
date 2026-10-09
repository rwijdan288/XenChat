'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const config = require('../config/config');
const User = require('../models/User');
const Group = require('../models/Group');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AppError = require('../utils/AppError');
const { assertId, cleanName } = require('../utils/validators');
const { publicUser, conversationItem } = require('../utils/serializers');
const media = require('./mediaService');

const MAX = config.limits.groupMembers;
const ids = (arr) => arr.map(String);

// Role selalu dihitung dari database, tidak pernah dari client.
function roleOf(g, userId) {
  if (g.ownerId.toString() === userId) return 'owner';
  return g.admins.some((a) => a.toString() === userId) ? 'admin' : 'member';
}

// Mute aktif milik user: { until: Date|null } atau null. Mute lama (mutedBy) dianggap selamanya.
function muteOf(g, userId) {
  const m = (g.mutes || []).find((x) => x.user.toString() === userId);
  if (m) return !m.until || m.until > new Date() ? { until: m.until || null } : null;
  return g.mutedBy.some((x) => x.toString() === userId) ? { until: null } : null;
}

function groupDTO(g, viewerId) {
  const d = {
    id: g._id.toString(),
    name: g.name,
    description: g.description,
    avatarUrl: g.avatarUrl,
    ownerId: g.ownerId.toString(),
    membersCount: g.membersCount,
    conversationId: g.conversationId ? g.conversationId.toString() : null,
    createdAt: g.createdAt
  };
  if (viewerId) {
    d.myRole = roleOf(g, viewerId);
    const mu = muteOf(g, viewerId);
    d.muted = !!mu;
    d.mutedUntil = mu && mu.until ? mu.until : null; // null + muted = selamanya
  }
  return d;
}

async function loadGroup(groupId, userId) {
  assertId(groupId, 'Grup tidak ditemukan.');
  const g = await Group.findOne({ _id: groupId, members: userId });
  if (!g) throw new AppError(404, 'Kamu bukan anggota grup ini.');
  return g;
}

const requireStaff = (g, userId) => {
  if (roleOf(g, userId) === 'member') throw new AppError(403, 'Kamu tidak punya izin.');
};
const requireOwner = (g, userId) => {
  if (roleOf(g, userId) !== 'owner') throw new AppError(403, 'Hanya pemilik grup yang bisa melakukan ini.');
};

function readFields(body, partial) {
  const fields = {};
  const out = {};
  if (!partial || 'name' in body) {
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (!name) fields.name = 'Nama grup wajib diisi.';
    else if (name.length > 50) fields.name = 'Nama grup maksimal 50 karakter.';
    else out.name = name;
  }
  if ('description' in body) {
    const d = typeof body.description === 'string' ? cleanName(body.description) : null;
    if (d === null || d.length > 200) fields.description = 'Deskripsi maksimal 200 karakter.';
    else out.description = d;
  }
  if (Object.keys(fields).length) throw new AppError(400, 'Periksa kembali data yang kamu isi.', fields);
  return out;
}

async function createGroup(userId, body) {
  const data = readFields(body, false);
  let avatarUrl = '';
  if (body.avatar) avatarUrl = (await media.saveAvatar(body.avatar)).url;

  const gid = new mongoose.Types.ObjectId();
  const conv = await Conversation.create({ type: 'group', groupId: gid, participants: [userId], participantKey: `group:${gid}`, lastMessageAt: new Date() });
  let group;
  try {
    group = await Group.create({
      _id: gid, name: data.name, description: data.description || '', avatarUrl,
      ownerId: userId, admins: [userId], members: [userId], membersCount: 1, conversationId: conv._id
    });
  } catch (err) {
    await Conversation.deleteOne({ _id: conv._id });
    await media.remove(avatarUrl);
    throw err;
  }
  return { group: groupDTO(group, userId), conversation: conversationItem(conv, userId, null, group) };
}

async function getGroup(userId, groupId) {
  return groupDTO(await loadGroup(groupId, userId), userId);
}

// Owner & admin boleh mengubah info dasar (nama, deskripsi, foto).
async function updateGroup(userId, groupId, body) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  const data = readFields(body, true);
  if ('avatar' in body) {
    const old = g.avatarUrl;
    g.avatarUrl = body.avatar ? (await media.saveAvatar(body.avatar)).url : '';
    if (old) await media.remove(old);
  }
  Object.assign(g, data);
  await g.save();
  return { group: g, dto: groupDTO(g), memberIds: ids(g.members) };
}

async function listMembers(userId, groupId, { limit, skip }) {
  assertId(groupId, 'Grup tidak ditemukan.');
  const g = await Group.findOne({ _id: groupId, members: userId }).select('members admins ownerId');
  if (!g) throw new AppError(404, 'Kamu bukan anggota grup ini.');
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), MAX);
  const slice = g.members.slice(off, off + lim);
  const users = await User.find({ _id: { $in: slice } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const members = slice
    .map((id) => byId.get(id.toString()))
    .filter(Boolean)
    .map((u) => ({ ...publicUser(u), role: roleOf(g, u._id.toString()) }));
  return { members, total: g.members.length, hasMore: off + lim < g.members.length };
}

async function addMember(userId, groupId, targetId) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  const target = await User.findById(targetId);
  if (!target) throw new AppError(404, 'Pengguna tidak ditemukan.');

  const upd = await pushMember(g, target._id);
  const conv = await Conversation.findById(g.conversationId);
  return { user: publicUser(target), membersCount: upd.membersCount, memberIds: ids(upd.members), conversation: conversationItem(conv, targetId, null, upd), targetId };
}

// Atomik: batas anggota dan duplikasi dicek di dalam query yang sama.
async function pushMember(g, targetObjectId) {
  const upd = await Group.findOneAndUpdate(
    { _id: g._id, members: { $ne: targetObjectId }, $expr: { $lt: [{ $size: '$members' }, MAX] } },
    { $push: { members: targetObjectId }, $inc: { membersCount: 1 } },
    { new: true }
  );
  if (!upd) {
    const cur = await Group.findById(g._id).select('members');
    if (cur && cur.members.some((m) => m.equals(targetObjectId))) throw new AppError(409, 'Pengguna sudah menjadi anggota grup.');
    throw new AppError(400, 'Grup sudah penuh.');
  }
  await Conversation.updateOne({ _id: g.conversationId }, { $addToSet: { participants: targetObjectId } });
  return upd;
}

async function pullMember(g, targetId) {
  const upd = await Group.findOneAndUpdate(
    { _id: g._id, members: targetId },
    { $pull: { members: targetId, admins: targetId, mutedBy: targetId, mutes: { user: targetId } }, $inc: { membersCount: -1 } },
    { new: true }
  );
  if (!upd) throw new AppError(404, 'Pengguna bukan anggota grup ini.');
  await Conversation.updateOne({ _id: g.conversationId }, { $pull: { participants: targetId }, $unset: { [`unread.${targetId}`]: '' } });
  return upd;
}

async function removeMember(userId, groupId, targetId) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (targetId === userId) throw new AppError(400, 'Gunakan "Keluar grup" untuk keluar sendiri.');
  const targetRole = roleOf(g, targetId);
  if (targetRole === 'owner') throw new AppError(403, 'Pemilik grup tidak bisa dikeluarkan.');
  if (targetRole === 'admin' && roleOf(g, userId) !== 'owner') throw new AppError(403, 'Kamu tidak punya izin.');
  const upd = await pullMember(g, targetId);
  return { membersCount: upd.membersCount, memberIds: ids(upd.members), conversationId: g.conversationId.toString() };
}

async function setAdmin(userId, groupId, targetId, makeAdmin) {
  const g = await loadGroup(groupId, userId);
  requireOwner(g, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (!g.members.some((m) => m.toString() === targetId)) throw new AppError(404, 'Pengguna bukan anggota grup ini.');
  if (targetId === g.ownerId.toString()) throw new AppError(400, 'Peran pemilik tidak bisa diubah.');
  await Group.updateOne({ _id: g._id }, makeAdmin ? { $addToSet: { admins: targetId } } : { $pull: { admins: targetId } });
  return { role: makeAdmin ? 'admin' : 'member', memberIds: ids(g.members) };
}

async function transferOwner(userId, groupId, targetId) {
  const g = await loadGroup(groupId, userId);
  requireOwner(g, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (targetId === userId) throw new AppError(400, 'Kamu sudah menjadi pemilik.');
  if (!g.members.some((m) => m.toString() === targetId)) throw new AppError(404, 'Pengguna bukan anggota grup ini.');
  await Group.updateOne({ _id: g._id }, { $set: { ownerId: targetId }, $addToSet: { admins: targetId } });
  return { memberIds: ids(g.members) };
}

async function leaveGroup(userId, groupId) {
  const g = await loadGroup(groupId, userId);
  if (roleOf(g, userId) === 'owner') throw new AppError(400, 'Pindahkan kepemilikan ke anggota lain dulu sebelum keluar, atau hapus grup.');
  const upd = await pullMember(g, userId);
  return { membersCount: upd.membersCount, memberIds: ids(upd.members), conversationId: g.conversationId.toString() };
}

async function deleteGroup(userId, groupId) {
  const g = await loadGroup(groupId, userId);
  requireOwner(g, userId);
  const memberIds = ids(g.members);
  const conversationId = g.conversationId.toString();
  const files = await Message.find({ conversationId: g.conversationId, 'attachment.url': { $exists: true } }).select('attachment.url').lean();
  for (const f of files) await media.remove(f.attachment.url);
  await Message.deleteMany({ conversationId: g.conversationId });
  await Conversation.deleteOne({ _id: g.conversationId });
  await Group.deleteOne({ _id: g._id });
  if (g.avatarUrl) await media.remove(g.avatarUrl);
  return { memberIds, conversationId };
}

const MUTE_MS = { '1h': 3600e3, '8h': 8 * 3600e3, '1w': 7 * 24 * 3600e3 };

// duration: '1h' | '8h' | '1w' | 'always' | 'off'. Per user; notifikasi push menyusul di fase berikutnya.
async function setMuted(userId, groupId, duration) {
  const g = await loadGroup(groupId, userId);
  await Group.updateOne({ _id: g._id }, { $pull: { mutes: { user: userId }, mutedBy: userId } });
  if (duration !== 'off') {
    if (duration !== 'always' && !MUTE_MS[duration]) throw new AppError(400, 'Durasi tidak valid.');
    const until = duration === 'always' ? null : new Date(Date.now() + MUTE_MS[duration]);
    await Group.updateOne({ _id: g._id }, { $push: { mutes: { user: userId, until } } });
    return { muted: true, mutedUntil: until };
  }
  return { muted: false, mutedUntil: null };
}

/* ---------- Link undangan ---------- */

const newToken = () => crypto.randomBytes(12).toString('base64url'); // token rahasia acak, bukan ObjectId

async function getInvite(userId, groupId) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  return { token: g.inviteToken || null };
}

async function createInvite(userId, groupId) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  const token = newToken();
  await Group.updateOne({ _id: g._id }, { $set: { inviteToken: token } }); // link lama otomatis tidak berlaku
  return { token };
}

async function revokeInvite(userId, groupId) {
  const g = await loadGroup(groupId, userId);
  requireStaff(g, userId);
  await Group.updateOne({ _id: g._id }, { $set: { inviteToken: null } });
}

async function loadByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{10,40}$/.test(token)) throw new AppError(404, 'Link undangan tidak valid atau sudah dicabut.');
  const g = await Group.findOne({ inviteToken: token });
  if (!g) throw new AppError(404, 'Link undangan tidak valid atau sudah dicabut.');
  return g;
}

async function previewInvite(userId, token) {
  const g = await loadByToken(token);
  return {
    group: { name: g.name, description: g.description, avatarUrl: g.avatarUrl, membersCount: g.membersCount, full: g.membersCount >= MAX },
    isMember: g.members.some((m) => m.toString() === userId)
  };
}

async function joinByToken(userId, token) {
  const g = await loadByToken(token);
  const user = await User.findById(userId);
  if (g.members.some((m) => m.toString() === userId)) return { already: true, group: g, user, memberIds: ids(g.members) };
  const upd = await pushMember(g, user._id);
  const conv = await Conversation.findById(g.conversationId);
  return { already: false, group: upd, user, memberIds: ids(upd.members), conversation: conversationItem(conv, userId, null, upd) };
}

module.exports = { getInvite, createInvite, revokeInvite, previewInvite, joinByToken, createGroup, getGroup, updateGroup, listMembers, addMember, removeMember, setAdmin, transferOwner, leaveGroup, deleteGroup, setMuted };
