'use strict';

const config = require('../config/config');
const User = require('../models/User');
const Channel = require('../models/Channel');
const ChannelMember = require('../models/ChannelMember');
const ChannelPost = require('../models/ChannelPost');
const ChannelReaction = require('../models/ChannelReaction');
const ChannelPostView = require('../models/ChannelPostView');
const AppError = require('../utils/AppError');
const { assertId, cleanName, cleanBody, USERNAME_RE, RESERVED_USERNAMES, REACTIONS } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');
const media = require('./mediaService');

const MAX_FOLLOWERS = config.limits.channelFollowers;

const roleOf = (ch, userId) => (ch.ownerId.toString() === userId ? 'owner' : ch.admins.some((a) => a.toString() === userId) ? 'admin' : 'none');
const isStaff = (ch, userId) => roleOf(ch, userId) !== 'none';

function channelDTO(ch, ctx) {
  const d = {
    id: ch._id.toString(),
    name: ch.name,
    username: ch.username,
    description: ch.description,
    avatarUrl: ch.avatarUrl,
    ownerId: ch.ownerId.toString(),
    followersCount: ch.followersCount,
    verified: ch.verified,
    createdAt: ch.createdAt
  };
  if (ctx) {
    d.myRole = roleOf(ch, ctx.userId);
    d.following = !!ctx.member;
    d.muted = !!(ctx.member && ctx.member.muted);
    if (ctx.admins) d.admins = ctx.admins;
  }
  return d;
}

function postDTO(p, mine) {
  const counts = {};
  Object.entries(p.reactionCounts || {}).forEach(([emoji, n]) => { if (n > 0) counts[emoji] = n; });
  return {
    id: p._id.toString(),
    channelId: p.channelId.toString(),
    authorId: p.authorId.toString(),
    content: p.content,
    kind: p.kind || 'text',
    attachment: p.attachment && p.attachment.url ? { url: p.attachment.url, mime: p.attachment.mime, size: p.attachment.size, name: p.attachment.name } : null,
    reactionCounts: counts,
    myReaction: mine || null,
    viewsCount: p.viewsCount,
    pinned: p.pinned,
    edited: p.edited,
    createdAt: p.createdAt
  };
}

async function loadChannel(channelId) {
  assertId(channelId, 'Saluran tidak ditemukan.');
  const ch = await Channel.findById(channelId);
  if (!ch) throw new AppError(404, 'Saluran tidak ditemukan.');
  return ch;
}

const requireOwner = (ch, userId) => {
  if (roleOf(ch, userId) !== 'owner') throw new AppError(403, 'Hanya pemilik saluran yang bisa melakukan ini.');
};
const requireStaff = (ch, userId) => {
  if (!isStaff(ch, userId)) throw new AppError(403, 'Kamu tidak punya izin.');
};

function readFields(body, partial) {
  const fields = {};
  const out = {};
  if (!partial || 'name' in body) {
    const name = typeof body.name === 'string' ? cleanName(body.name) : '';
    if (!name) fields.name = 'Nama saluran wajib diisi.';
    else if (name.length > 50) fields.name = 'Nama saluran maksimal 50 karakter.';
    else out.name = name;
  }
  if (!partial || 'username' in body) {
    const u = typeof body.username === 'string' ? body.username.trim().toLowerCase().replace(/^@/, '') : '';
    if (!USERNAME_RE.test(u)) fields.username = 'Username 3-20 karakter: huruf kecil, angka, atau underscore.';
    else if (RESERVED_USERNAMES.has(u)) fields.username = 'Username ini tidak tersedia.';
    else out.username = u;
  }
  if ('description' in body) {
    const d = typeof body.description === 'string' ? cleanName(body.description) : null;
    if (d === null || d.length > 200) fields.description = 'Deskripsi maksimal 200 karakter.';
    else out.description = d;
  }
  if (Object.keys(fields).length) throw new AppError(400, 'Periksa kembali data yang kamu isi.', fields);
  return out;
}

const dupUsername = (err) => {
  if (err && err.code === 11000) throw new AppError(409, 'Username sudah dipakai.', { username: 'Username sudah dipakai.' });
  throw err;
};

/* ---------- Saluran ---------- */

async function createChannel(userId, body) {
  const data = readFields(body, false);
  let avatarUrl = '';
  if (body.avatar) avatarUrl = (await media.saveAvatar(body.avatar)).url;
  let ch;
  try {
    ch = await Channel.create({ ...data, description: data.description || '', avatarUrl, ownerId: userId, followersCount: 1 }); // verified tidak pernah dari input
    await ChannelMember.create({ channelId: ch._id, userId });
  } catch (err) {
    if (ch) await Channel.deleteOne({ _id: ch._id });
    await media.remove(avatarUrl);
    return dupUsername(err);
  }
  return channelDTO(ch, { userId, member: { muted: false } });
}

async function getChannel(userId, channelId) {
  const ch = await loadChannel(channelId);
  const [member, admins] = await Promise.all([
    ChannelMember.findOne({ channelId: ch._id, userId }),
    ch.admins.length ? User.find({ _id: { $in: ch.admins } }) : []
  ]);
  return channelDTO(ch, { userId, member, admins: admins.map(publicUser) });
}

async function listChannels(userId, { scope, q, skip, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 30);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), 1000);
  let channels;
  if (scope === 'discover') {
    const filter = {};
    const text = typeof q === 'string' ? q.trim().replace(/^@/, '').slice(0, 30) : '';
    if (text.length >= 2) {
      const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ username: new RegExp(`^${esc.toLowerCase()}`) }, { name: new RegExp(esc, 'i') }];
    }
    channels = await Channel.find(filter).sort({ followersCount: -1, _id: 1 }).skip(off).limit(lim + 1);
  } else {
    const rows = await ChannelMember.find({ userId }).sort({ joinedAt: -1 }).skip(off).limit(lim + 1);
    const list = await Channel.find({ _id: { $in: rows.map((r) => r.channelId) } });
    const byId = new Map(list.map((c) => [c._id.toString(), c]));
    channels = rows.map((r) => byId.get(r.channelId.toString())).filter(Boolean);
    if (rows.length > lim) channels.length = Math.min(channels.length, lim + 1);
  }
  const hasMore = channels.length > lim;
  const page = channels.slice(0, lim);
  const members = await ChannelMember.find({ userId, channelId: { $in: page.map((c) => c._id) } });
  const memberMap = new Map(members.map((m) => [m.channelId.toString(), m]));
  return { channels: page.map((c) => channelDTO(c, { userId, member: memberMap.get(c._id.toString()) })), hasMore };
}

// Pemilik: nama, username, deskripsi, foto. ownerId & verified tidak bisa diubah lewat sini.
async function updateChannel(userId, channelId, body) {
  const ch = await loadChannel(channelId);
  requireOwner(ch, userId);
  const data = readFields(body, true);
  const oldAvatar = ch.avatarUrl;
  if ('avatar' in body) ch.avatarUrl = body.avatar ? (await media.saveAvatar(body.avatar)).url : '';
  Object.assign(ch, data);
  try { await ch.save(); } catch (err) { return dupUsername(err); }
  if ('avatar' in body && oldAvatar) await media.remove(oldAvatar);
  return channelDTO(ch);
}

async function deleteChannel(userId, channelId) {
  const ch = await loadChannel(channelId);
  requireOwner(ch, userId);
  const posts = await ChannelPost.find({ channelId: ch._id }).select('_id attachment');
  const postIds = posts.map((p) => p._id);
  for (const p of posts) if (p.attachment && p.attachment.url) await media.remove(p.attachment.url);
  await Promise.all([
    ChannelReaction.deleteMany({ postId: { $in: postIds } }),
    ChannelPostView.deleteMany({ postId: { $in: postIds } }),
    ChannelPost.deleteMany({ channelId: ch._id }),
    ChannelMember.deleteMany({ channelId: ch._id })
  ]);
  await Channel.deleteOne({ _id: ch._id });
  if (ch.avatarUrl) await media.remove(ch.avatarUrl);
}

/* ---------- Follow ---------- */

async function follow(userId, channelId) {
  const ch = await loadChannel(channelId);
  if (await ChannelMember.exists({ channelId: ch._id, userId })) throw new AppError(409, 'Kamu sudah mengikuti saluran ini.');
  // Atomik: batas pengikut dicek di query yang sama dengan penambahan.
  const upd = await Channel.findOneAndUpdate({ _id: ch._id, followersCount: { $lt: MAX_FOLLOWERS } }, { $inc: { followersCount: 1 } }, { new: true });
  if (!upd) throw new AppError(400, 'Saluran sudah mencapai batas pengikut.');
  try {
    await ChannelMember.create({ channelId: ch._id, userId });
  } catch (err) {
    await Channel.updateOne({ _id: ch._id }, { $inc: { followersCount: -1 } });
    if (err && err.code === 11000) throw new AppError(409, 'Kamu sudah mengikuti saluran ini.');
    throw err;
  }
  return channelDTO(upd, { userId, member: { muted: false } });
}

async function unfollow(userId, channelId) {
  const ch = await loadChannel(channelId);
  if (roleOf(ch, userId) === 'owner') throw new AppError(400, 'Pemilik tidak bisa berhenti mengikuti. Hapus saluran jika perlu.');
  const res = await ChannelMember.deleteOne({ channelId: ch._id, userId });
  if (!res.deletedCount) throw new AppError(400, 'Kamu belum mengikuti saluran ini.');
  const upd = await Channel.findByIdAndUpdate(ch._id, { $inc: { followersCount: -1 } }, { new: true });
  return channelDTO(upd, { userId, member: null });
}

async function setMuted(userId, channelId, muted) {
  const ch = await loadChannel(channelId);
  const res = await ChannelMember.updateOne({ channelId: ch._id, userId }, { $set: { muted: !!muted } });
  if (!res.matchedCount) throw new AppError(400, 'Ikuti saluran ini dulu.');
  return { muted: !!muted };
}

async function setAdmin(userId, channelId, targetId, makeAdmin) {
  const ch = await loadChannel(channelId);
  requireOwner(ch, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  const target = await User.findById(targetId);
  if (!target) throw new AppError(404, 'Pengguna tidak ditemukan.');
  if (targetId === ch.ownerId.toString()) throw new AppError(400, 'Peran pemilik tidak bisa diubah.');
  if (makeAdmin && !(await ChannelMember.exists({ channelId: ch._id, userId: targetId }))) {
    throw new AppError(400, 'Pengguna harus mengikuti saluran dulu.');
  }
  await Channel.updateOne({ _id: ch._id }, makeAdmin ? { $addToSet: { admins: targetId } } : { $pull: { admins: targetId } });
  return { user: publicUser(target), role: makeAdmin ? 'admin' : 'none' };
}

/* ---------- Postingan ---------- */

async function reactionsOf(userId, posts) {
  const rows = await ChannelReaction.find({ userId, postId: { $in: posts.map((p) => p._id) } });
  return new Map(rows.map((r) => [r.postId.toString(), r.emoji]));
}

async function listPosts(userId, channelId, { limit, before }) {
  const ch = await loadChannel(channelId);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 30);
  const filter = { channelId: ch._id, pinned: false };
  if (before !== undefined) {
    assertId(before, 'Penanda halaman tidak valid.');
    const ref = await ChannelPost.findOne({ _id: before, channelId: ch._id }).select('createdAt');
    if (!ref) throw new AppError(400, 'Penanda halaman tidak valid.');
    filter.$or = [{ createdAt: { $lt: ref.createdAt } }, { createdAt: ref.createdAt, _id: { $lt: ref._id } }];
  }
  const rows = await ChannelPost.find(filter).sort({ createdAt: -1, _id: -1 }).limit(lim + 1);
  const page = rows.slice(0, lim);
  const pinnedDoc = before === undefined ? await ChannelPost.findOne({ channelId: ch._id, pinned: true }) : null;
  const mine = await reactionsOf(userId, pinnedDoc ? [...page, pinnedDoc] : page);
  return {
    posts: page.map((p) => postDTO(p, mine.get(p._id.toString()))),
    pinned: pinnedDoc ? postDTO(pinnedDoc, mine.get(pinnedDoc._id.toString())) : null,
    hasMore: rows.length > lim
  };
}

// Teks atau lampiran (att diisi server dari mediaService). Teks wajib jika tanpa lampiran.
async function createPost(userId, channelId, content, att) {
  const ch = await loadChannel(channelId);
  requireStaff(ch, userId);
  const text = att && (typeof content !== 'string' || !content.trim()) ? '' : cleanBody(content, 4000, 'Postingan');
  const post = await ChannelPost.create({
    channelId: ch._id,
    authorId: userId,
    content: text,
    kind: att ? att.kind : 'text',
    attachment: att ? { url: att.url, mime: att.mime, size: att.size, name: att.name } : undefined
  });
  return postDTO(post, null);
}

async function assertCanPost(userId, channelId) {
  requireStaff(await loadChannel(channelId), userId);
}

async function getByUsername(userId, username) {
  const u = typeof username === 'string' ? username.trim().toLowerCase().replace(/^@/, '') : '';
  if (!USERNAME_RE.test(u)) throw new AppError(404, 'Saluran tidak ditemukan.');
  const ch = await Channel.findOne({ username: u });
  if (!ch) throw new AppError(404, 'Saluran tidak ditemukan.');
  return getChannel(userId, ch._id.toString());
}

// Pindahkan kepemilikan ke pengikut. Pemilik lama menjadi admin.
async function transferOwner(userId, channelId, targetId) {
  const ch = await loadChannel(channelId);
  requireOwner(ch, userId);
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (targetId === userId) throw new AppError(400, 'Kamu sudah menjadi pemilik.');
  if (!(await ChannelMember.exists({ channelId: ch._id, userId: targetId }))) throw new AppError(400, 'Penerima harus mengikuti saluran ini dulu.');
  await Channel.updateOne({ _id: ch._id }, { $set: { ownerId: targetId }, $pull: { admins: targetId } });
  await Channel.updateOne({ _id: ch._id }, { $addToSet: { admins: userId } });
}

async function loadPost(postId) {
  assertId(postId, 'Postingan tidak ditemukan.');
  const post = await ChannelPost.findById(postId);
  if (!post) throw new AppError(404, 'Postingan tidak ditemukan.');
  const ch = await Channel.findById(post.channelId);
  if (!ch) throw new AppError(404, 'Saluran tidak ditemukan.');
  return { post, ch };
}

// Edit/hapus: pengarang sendiri, atau pemilik saluran untuk semua postingan.
async function editPost(userId, postId, content) {
  const { post, ch } = await loadPost(postId);
  if (post.authorId.toString() !== userId && roleOf(ch, userId) !== 'owner') throw new AppError(403, 'Kamu tidak punya izin.');
  post.content = cleanBody(content, 4000, 'Postingan');
  post.edited = true;
  await post.save();
  const mine = await ChannelReaction.findOne({ postId: post._id, userId });
  return postDTO(post, mine && mine.emoji);
}

async function deletePost(userId, postId) {
  const { post, ch } = await loadPost(postId);
  if (post.authorId.toString() !== userId && roleOf(ch, userId) !== 'owner') throw new AppError(403, 'Kamu tidak punya izin.');
  await Promise.all([ChannelReaction.deleteMany({ postId: post._id }), ChannelPostView.deleteMany({ postId: post._id }), ChannelPost.deleteOne({ _id: post._id })]);
  if (post.attachment && post.attachment.url) await media.remove(post.attachment.url);
  return { postId: post._id.toString(), channelId: ch._id.toString() };
}

// Satu pin per saluran. POST pada post yang sedang di-pin = lepas pin.
async function pinPost(userId, channelId, postId) {
  const ch = await loadChannel(channelId);
  requireStaff(ch, userId);
  assertId(postId, 'Postingan tidak ditemukan.');
  const post = await ChannelPost.findOne({ _id: postId, channelId: ch._id });
  if (!post) throw new AppError(404, 'Postingan tidak ditemukan.');
  if (post.pinned) {
    post.pinned = false;
    await post.save();
  } else {
    await ChannelPost.updateMany({ channelId: ch._id, pinned: true }, { $set: { pinned: false } });
    post.pinned = true;
    await post.save();
  }
  return { postId: post._id.toString(), pinned: post.pinned, channelId: ch._id.toString() };
}

// Satu reaksi per user per post: emoji sama = hapus, emoji lain = ganti. Hanya pengikut/admin.
async function reactPost(userId, postId, emoji) {
  if (!REACTIONS.includes(emoji)) throw new AppError(400, 'Reaksi tidak valid.');
  const { post, ch } = await loadPost(postId);
  if (!(await ChannelMember.exists({ channelId: ch._id, userId }))) throw new AppError(403, 'Ikuti saluran ini untuk memberi reaksi.');

  const old = await ChannelReaction.findOneAndUpdate({ postId: post._id, userId }, { $set: { emoji } }, { upsert: true, new: false });
  const inc = {};
  let mine = emoji;
  if (old && old.emoji === emoji) {
    await ChannelReaction.deleteOne({ _id: old._id });
    inc[`reactionCounts.${emoji}`] = -1;
    mine = null;
  } else {
    if (old) inc[`reactionCounts.${old.emoji}`] = -1;
    inc[`reactionCounts.${emoji}`] = 1;
  }
  const upd = await ChannelPost.findByIdAndUpdate(post._id, { $inc: inc }, { new: true });
  return { post: postDTO(upd, mine), actorId: userId, actorEmoji: mine };
}

// 1 view / user / post (unique index). Pengarang tidak dihitung.
async function viewPost(userId, postId) {
  const { post } = await loadPost(postId);
  if (post.authorId.toString() === userId) return { viewsCount: post.viewsCount, channelId: post.channelId.toString(), counted: false };
  const res = await ChannelPostView.updateOne({ postId: post._id, userId }, { $setOnInsert: { userId } }, { upsert: true });
  let viewsCount = post.viewsCount;
  if (res.upsertedCount === 1) viewsCount = (await ChannelPost.findByIdAndUpdate(post._id, { $inc: { viewsCount: 1 } }, { new: true })).viewsCount;
  return { viewsCount, channelId: post.channelId.toString(), counted: res.upsertedCount === 1, postId: post._id.toString() };
}

module.exports = { assertCanPost, getByUsername, transferOwner, createChannel, getChannel, listChannels, updateChannel, deleteChannel, follow, unfollow, setMuted, setAdmin, listPosts, createPost, editPost, deletePost, pinPost, reactPost, viewPost };
