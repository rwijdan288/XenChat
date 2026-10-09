'use strict';

const mongoose = require('mongoose');
const config = require('../config/config');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Group = require('../models/Group');
const AppError = require('../utils/AppError');
const { assertId, cleanBody, REACTIONS } = require('../utils/validators');
const { messageDTO, conversationItem, preview } = require('../utils/serializers');
const presence = require('./presenceService');
const media = require('./mediaService');
const blocks = require('./blockService');

const cleanContent = (v) => cleanBody(v, 4000, 'Pesan');
const isGroup = (conv) => conv.type === 'group';
const senderInfo = (u) => ({ id: u._id.toString(), name: u.name, username: u.username, avatarUrl: u.avatarUrl || '', verified: !!u.verified });

// 404 (bukan 403) agar keberadaan percakapan milik orang lain tidak bocor.
// Untuk grup, keanggotaan = Conversation.participants (dicerminkan dari Group.members).
async function getConversationFor(conversationId, userId) {
  assertId(conversationId, 'Percakapan tidak ditemukan.');
  const conv = await Conversation.findOne({ _id: conversationId, participants: userId });
  if (!conv) throw new AppError(404, 'Percakapan tidak ditemukan.');
  return conv;
}

const participantIds = (conv) => conv.participants.map(String);
const otherIdOf = (conv, userId) => participantIds(conv).find((p) => p !== userId);

// Bentuk item daftar chat untuk banyak percakapan sekaligus (private + grup).
async function itemsFor(convs, viewerId) {
  const userIds = [];
  const groupIds = [];
  convs.forEach((c) => (isGroup(c) ? groupIds.push(c.groupId) : userIds.push(otherIdOf(c, viewerId))));
  const [users, groups] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }) : [],
    groupIds.length ? Group.find({ _id: { $in: groupIds } }).select('name avatarUrl membersCount') : []
  ]);
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));
  const groupMap = new Map(groups.map((g) => [g._id.toString(), g]));
  return convs.map((c) =>
    isGroup(c)
      ? conversationItem(c, viewerId, null, groupMap.get(String(c.groupId)))
      : conversationItem(c, viewerId, userMap.get(otherIdOf(c, viewerId)))
  );
}

async function conversationItemFor(conv, viewerId) {
  return (await itemsFor([conv], viewerId))[0];
}

async function loadOwnMessage(userId, messageId) {
  assertId(messageId, 'Pesan tidak ditemukan.');
  const msg = await Message.findById(messageId);
  if (!msg) throw new AppError(404, 'Pesan tidak ditemukan.');
  const conv = await getConversationFor(msg.conversationId.toString(), userId);
  return { msg, conv };
}

const isLastMessage = (conv, msg) => !!(conv.lastMessage && conv.lastMessage.messageId && conv.lastMessage.messageId.equals(msg._id));

/* ---------- Percakapan ---------- */

async function openPrivate(userId, targetId) {
  assertId(targetId, 'Pengguna tidak ditemukan.');
  if (targetId === userId) throw new AppError(400, 'Tidak bisa memulai chat dengan diri sendiri.');
  const target = await User.findById(targetId);
  if (!target) throw new AppError(404, 'Pengguna tidak ditemukan.');

  const ids = [userId, targetId].sort();
  const participantKey = ids.join(':');
  let conv;
  try {
    conv = await Conversation.findOneAndUpdate(
      { participantKey },
      { $setOnInsert: { type: 'private', participants: ids } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) conv = await Conversation.findOne({ participantKey }); // balapan
    else throw err;
  }
  return conversationItem(conv, userId, target);
}

async function listConversations(userId, { limit, before }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 50);
  const filter = { participants: userId, lastMessageAt: { $ne: null } };
  if (typeof before === 'string' && !Number.isNaN(Date.parse(before))) filter.lastMessageAt = { $ne: null, $lt: new Date(before) };

  const rows = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(lim + 1);
  const hasMore = rows.length > lim;
  return { conversations: await itemsFor(rows.slice(0, lim), userId), hasMore };
}

async function listMessages(userId, conversationId, { limit, before }) {
  const conv = await getConversationFor(conversationId, userId);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 50);
  const filter = { conversationId: conv._id };
  if (before !== undefined) {
    assertId(before, 'Penanda halaman tidak valid.');
    const ref = await Message.findOne({ _id: before, conversationId: conv._id }).select('createdAt');
    if (!ref) throw new AppError(400, 'Penanda halaman tidak valid.');
    filter.$or = [{ createdAt: { $lt: ref.createdAt } }, { createdAt: ref.createdAt, _id: { $lt: ref._id } }];
  }
  const rows = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(lim + 1)
    .populate('replyTo', 'senderId content deleted')
    .lean();
  const hasMore = rows.length > lim;
  const page = rows.slice(0, lim).reverse();

  // Grup: kirim info pengirim (nama/foto) untuk pesan di halaman ini, termasuk pengirim kutipan.
  let senders = {};
  if (isGroup(conv)) {
    const ids = new Set();
    page.forEach((m) => { ids.add(m.senderId.toString()); if (m.replyTo && m.replyTo.senderId) ids.add(m.replyTo.senderId.toString()); });
    const users = await User.find({ _id: { $in: [...ids] } }).select('name username avatarUrl verified');
    users.forEach((u) => { senders[u._id.toString()] = senderInfo(u); });
  }
  return { messages: page.map(messageDTO), hasMore, senders };
}

/* ---------- Pesan ---------- */

const KIND_LABEL = { image: '📷 Foto', video: '🎬 Video', audio: '🎵 Audio', voice: '🎙️ Pesan suara' };

// `extra` hanya diisi server (storyRef, attachment) - tidak pernah dari payload client.
async function createMessage(userId, payload, extra) {
  const { conversationId, content, replyTo } = payload;
  const conv = await getConversationFor(conversationId, userId);
  const att = extra && extra.attachment ? extra.attachment : null;
  let text = att && (typeof content !== 'string' || !content.trim()) ? '' : cleanContent(content);

  // Block dicek di server (juga untuk socket): pemblokir maupun yang diblokir tidak bisa mengirim di chat pribadi.
  if (!isGroup(conv)) {
    const other = otherIdOf(conv, userId);
    const blk = await blocks.findBlock(userId, other);
    if (blk) throw new AppError(403, blk.blockerId.toString() === userId ? 'Buka blokir pengguna ini untuk mengirim pesan.' : 'Pesan tidak dapat dikirim.');
  }

  let replyId = null;
  if (replyTo !== undefined && replyTo !== null) {
    assertId(replyTo, 'Pesan yang dibalas tidak tersedia.');
    const target = await Message.findOne({ _id: replyTo, conversationId: conv._id }).select('deleted');
    if (!target || target.deleted) throw new AppError(400, 'Pesan yang dibalas tidak tersedia.');
    replyId = target._id;
  }

  const group = isGroup(conv);
  const others = participantIds(conv).filter((p) => p !== userId);
  const msg = await Message.create({
    conversationId: conv._id,
    senderId: userId,
    content: text,
    type: att ? att.kind : 'text',
    attachment: att ? { url: att.url, mime: att.mime, size: att.size, name: att.name, duration: att.duration || undefined } : undefined,
    replyTo: replyId,
    storyRef: extra && extra.storyRef ? extra.storyRef : undefined,
    deliveredAt: !group && others[0] && presence.isOnline(others[0]) ? new Date() : null
  });

  const sender = await User.findById(userId);
  const inc = {};
  others.forEach((id) => { inc[`unread.${id}`] = 1; });
  const update = {
    $set: {
      lastMessage: { messageId: msg._id, senderId: msg.senderId, senderName: sender.name, text: att ? (att.kind === 'file' ? `📄 ${att.name}` : KIND_LABEL[att.kind]) + (text ? ` ${preview(text)}` : '') : preview(text), deleted: false, createdAt: msg.createdAt },
      lastMessageAt: msg.createdAt
    }
  };
  if (others.length) update.$inc = inc;
  await Conversation.updateOne({ _id: conv._id }, update);

  const [fresh, peer, groupDoc] = await Promise.all([
    Conversation.findById(conv._id),
    group ? null : User.findById(others[0]),
    group ? Group.findById(conv.groupId).select('name avatarUrl membersCount') : null,
    msg.populate('replyTo', 'senderId content deleted')
  ]);

  const items = {};
  if (group) participantIds(conv).forEach((id) => { items[id] = conversationItem(fresh, id, null, groupDoc); });
  else { items[userId] = conversationItem(fresh, userId, peer); items[others[0]] = conversationItem(fresh, others[0], sender); }

  return { message: messageDTO(msg), items, participants: participantIds(conv), sender: senderInfo(sender) };
}

async function editMessage(userId, messageId, content) {
  const { msg, conv } = await loadOwnMessage(userId, messageId);
  if (msg.senderId.toString() !== userId) throw new AppError(403, 'Kamu hanya bisa mengedit pesanmu sendiri.');
  if (msg.deleted) throw new AppError(400, 'Pesan sudah dihapus.');
  if (msg.type !== 'text') throw new AppError(400, 'Pesan media tidak bisa diedit.');
  if (Date.now() - msg.createdAt.getTime() > config.editWindowMs) throw new AppError(400, 'Batas waktu edit (15 menit) sudah lewat.');

  const text = cleanContent(content);
  msg.content = text;
  msg.edited = true;
  await msg.save();

  const isLast = isLastMessage(conv, msg);
  if (isLast) await Conversation.updateOne({ _id: conv._id }, { $set: { 'lastMessage.text': preview(text) } });
  await msg.populate('replyTo', 'senderId content deleted');
  return { message: messageDTO(msg), isLast, participants: participantIds(conv) };
}

async function deleteMessage(userId, messageId) {
  const { msg, conv } = await loadOwnMessage(userId, messageId);
  if (msg.senderId.toString() !== userId) throw new AppError(403, 'Kamu hanya bisa menghapus pesanmu sendiri.');

  const fileUrl = msg.attachment && msg.attachment.url;
  msg.deleted = true;
  msg.content = null;
  msg.reactions = [];
  msg.attachment = undefined;
  await msg.save();
  if (fileUrl) await media.remove(fileUrl); // file ikut dihapus

  const isLast = isLastMessage(conv, msg);
  if (isLast) await Conversation.updateOne({ _id: conv._id }, { $set: { 'lastMessage.text': '', 'lastMessage.deleted': true } });
  await msg.populate('replyTo', 'senderId content deleted');
  return { message: messageDTO(msg), isLast, participants: participantIds(conv) };
}

// Satu reaksi per user per pesan: emoji sama = hapus, emoji lain = ganti.
async function reactMessage(userId, messageId, emoji) {
  if (!REACTIONS.includes(emoji)) throw new AppError(400, 'Reaksi tidak valid.');
  const { msg, conv } = await loadOwnMessage(userId, messageId);
  if (msg.deleted) throw new AppError(400, 'Pesan sudah dihapus.');

  const existing = msg.reactions.find((r) => r.user.toString() === userId);
  msg.reactions = msg.reactions.filter((r) => r.user.toString() !== userId);
  if (!existing || existing.emoji !== emoji) msg.reactions.push({ user: userId, emoji });
  await msg.save();

  return {
    payload: {
      messageId: msg._id.toString(),
      conversationId: conv._id.toString(),
      reactions: msg.reactions.map((r) => ({ userId: r.user.toString(), emoji: r.emoji }))
    },
    participants: participantIds(conv)
  };
}

async function markRead(userId, conversationId) {
  const conv = await getConversationFor(conversationId, userId);
  const uid = new mongoose.Types.ObjectId(userId);
  const now = new Date();
  const res = await Message.updateMany(
    { conversationId: conv._id, senderId: { $ne: uid }, readBy: { $ne: uid } },
    [{ $set: { readBy: { $concatArrays: [{ $ifNull: ['$readBy', []] }, [uid]] }, deliveredAt: { $ifNull: ['$deliveredAt', now] } } }],
    { timestamps: false }
  );
  await Conversation.updateOne({ _id: conv._id }, { $set: { [`unread.${userId}`]: 0 } });
  // Grup: status baca hanya relevan untuk pembaca itu sendiri (sinkron antar tab), tidak disebar ke 500 anggota.
  return {
    payload: { conversationId: conv._id.toString(), readerId: userId, readAt: now },
    participants: isGroup(conv) ? [userId] : participantIds(conv),
    modified: res.modifiedCount
  };
}

module.exports = {
  assertId,
  cleanContent,
  getConversationFor,
  conversationItemFor,
  itemsFor,
  openPrivate,
  listConversations,
  listMessages,
  createMessage,
  editMessage,
  deleteMessage,
  reactMessage,
  markRead
};
