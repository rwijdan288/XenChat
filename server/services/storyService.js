'use strict';

const config = require('../config/config');
const User = require('../models/User');
const Story = require('../models/Story');
const StoryView = require('../models/StoryView');
const Conversation = require('../models/Conversation');
const AppError = require('../utils/AppError');
const { assertId, cleanName, REACTIONS } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');
const media = require('./mediaService');
const msgs = require('./messageService');

const PRIVACY = ['everyone', 'contacts', 'nobody'];
const MAX_ACTIVE_PER_USER = 30;

// "Kontak" = pengguna yang sudah punya chat pribadi berisi pesan dengan kita (relasi yang ada di Phase 2).
async function contactIds(userId) {
  const rows = await Conversation.find({ participants: userId, type: { $ne: 'group' }, lastMessageAt: { $ne: null } })
    .select('participants')
    .limit(300)
    .lean();
  const set = new Set();
  rows.forEach((r) => r.participants.forEach((p) => { if (p.toString() !== userId) set.add(p.toString()); }));
  return [...set];
}

const areContacts = async (a, b) =>
  !!(await Conversation.exists({ participantKey: [a, b].sort().join(':'), lastMessageAt: { $ne: null } }));

// Filter privasi di server: siapa yang boleh melihat story.
async function canView(story, viewerId) {
  if (story.userId.toString() === viewerId) return true;
  if (story.expiresAt <= new Date()) return false;
  if (story.privacy === 'everyone') return true;
  if (story.privacy === 'contacts') return areContacts(story.userId.toString(), viewerId);
  return false;
}

function storyDTO(s, viewerId, view) {
  const mine = s.userId.toString() === viewerId;
  const d = {
    id: s._id.toString(),
    userId: s.userId.toString(),
    type: s.type,
    media: { url: s.media.url, mime: s.media.mime, duration: s.media.duration || null },
    caption: s.caption,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    viewed: mine || !!view,
    myReaction: view ? view.reaction || null : null
  };
  if (mine) { d.viewsCount = s.viewsCount; d.privacy = s.privacy; }
  return d;
}

async function loadActive(storyId, viewerId) {
  assertId(storyId, 'Story tidak ditemukan.');
  const story = await Story.findById(storyId);
  if (!story) throw new AppError(404, 'Story tidak ditemukan.');
  if (story.expiresAt <= new Date()) throw new AppError(410, 'Story sudah kedaluwarsa.');
  if (!(await canView(story, viewerId))) throw new AppError(403, 'Kamu tidak punya izin melihat story ini.');
  return story;
}

async function createStory(userId, buf, { caption, privacy }) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError(400, 'File story tidak ditemukan.');
  const cap = typeof caption === 'string' ? cleanName(caption) : '';
  if (cap.length > 200) throw new AppError(400, 'Caption maksimal 200 karakter.');
  const priv = PRIVACY.includes(privacy) ? privacy : 'contacts';
  const active = await Story.countDocuments({ userId, expiresAt: { $gt: new Date() } });
  if (active >= MAX_ACTIVE_PER_USER) throw new AppError(400, 'Terlalu banyak story aktif. Hapus salah satu dulu.');

  const saved = await media.saveMedia(buf); // validasi isi, ukuran, durasi
  try {
    const story = await Story.create({
      userId,
      type: saved.kind,
      media: { url: saved.url, mime: saved.mime, size: saved.size, duration: saved.duration },
      caption: cap,
      privacy: priv,
      expiresAt: new Date(Date.now() + config.limits.storyTtlMs) // waktu server
    });
    return { story, dto: storyDTO(story, userId, null), notify: priv === 'nobody' ? [] : await contactIds(userId) };
  } catch (err) {
    await media.remove(saved.url);
    throw err;
  }
}

async function viewMap(viewerId, storyIds) {
  const views = await StoryView.find({ userId: viewerId, storyId: { $in: storyIds } }).select('storyId reaction');
  return new Map(views.map((v) => [v.storyId.toString(), v]));
}

// Feed: story milik sendiri + story kontak yang aktif, dikelompokkan per pengguna.
async function feed(userId) {
  const now = new Date();
  const contacts = await contactIds(userId);
  const [mine, others] = await Promise.all([
    Story.find({ userId, expiresAt: { $gt: now } }).sort({ createdAt: 1 }),
    Story.find({ userId: { $in: contacts }, expiresAt: { $gt: now }, privacy: { $in: ['everyone', 'contacts'] } }).sort({ createdAt: 1 }).limit(300)
  ]);
  const views = await viewMap(userId, others.map((s) => s._id));
  const users = await User.find({ _id: { $in: [...new Set(others.map((s) => s.userId.toString()))] } });
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const groups = new Map();
  others.forEach((s) => {
    const key = s.userId.toString();
    if (!groups.has(key)) groups.set(key, { user: publicUser(userMap.get(key)), stories: [], hasUnseen: false, latestAt: s.createdAt });
    const g = groups.get(key);
    const dto = storyDTO(s, userId, views.get(s._id.toString()));
    g.stories.push(dto);
    if (!dto.viewed) g.hasUnseen = true;
    g.latestAt = s.createdAt;
  });
  const list = [...groups.values()].sort((a, b) => Number(b.hasUnseen) - Number(a.hasUnseen) || b.latestAt - a.latestAt);
  return { mine: mine.map((s) => storyDTO(s, userId, null)), users: list };
}

async function userStories(viewerId, authorId) {
  assertId(authorId, 'Pengguna tidak ditemukan.');
  const filter = { userId: authorId, expiresAt: { $gt: new Date() } };
  if (authorId !== viewerId) {
    filter.privacy = (await areContacts(authorId, viewerId)) ? { $in: ['everyone', 'contacts'] } : 'everyone';
  }
  const stories = await Story.find(filter).sort({ createdAt: 1 }).limit(50);
  const views = authorId === viewerId ? new Map() : await viewMap(viewerId, stories.map((s) => s._id));
  return stories.map((s) => storyDTO(s, viewerId, views.get(s._id.toString())));
}

async function getStory(viewerId, storyId) {
  const story = await loadActive(storyId, viewerId);
  const view = await StoryView.findOne({ storyId: story._id, userId: viewerId });
  return storyDTO(story, viewerId, view);
}

// View unik per (story, user): unique index + upsert, jadi tidak pernah dobel.
async function viewStory(viewerId, storyId) {
  const story = await loadActive(storyId, viewerId);
  const ownerId = story.userId.toString();
  if (ownerId === viewerId) return { counted: false, viewsCount: story.viewsCount, ownerId };
  const res = await StoryView.updateOne({ storyId: story._id, userId: viewerId }, { $setOnInsert: { expiresAt: story.expiresAt } }, { upsert: true });
  let viewsCount = story.viewsCount;
  if (res.upsertedCount === 1) {
    viewsCount = (await Story.findByIdAndUpdate(story._id, { $inc: { viewsCount: 1 } }, { new: true })).viewsCount;
  }
  return { counted: res.upsertedCount === 1, viewsCount, ownerId, storyId: story._id.toString() };
}

// Satu reaksi per user: emoji sama = hapus, emoji lain = ganti. Bereaksi dihitung sebagai view.
async function reactStory(viewerId, storyId, emoji) {
  if (!REACTIONS.includes(emoji)) throw new AppError(400, 'Reaksi tidak valid.');
  const story = await loadActive(storyId, viewerId);
  const ownerId = story.userId.toString();
  if (ownerId === viewerId) throw new AppError(400, 'Kamu tidak bisa bereaksi pada story sendiri.');

  let view = await StoryView.findOne({ storyId: story._id, userId: viewerId });
  let next = emoji;
  if (view) {
    next = view.reaction === emoji ? null : emoji;
    view.reaction = next;
    await view.save();
  } else {
    try {
      await StoryView.create({ storyId: story._id, userId: viewerId, reaction: emoji, expiresAt: story.expiresAt });
      await Story.updateOne({ _id: story._id }, { $inc: { viewsCount: 1 } });
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
      await StoryView.updateOne({ storyId: story._id, userId: viewerId }, { $set: { reaction: emoji } });
    }
  }
  const user = await User.findById(viewerId).select('name');
  return { reaction: next, ownerId, storyId: story._id.toString(), userId: viewerId, userName: user ? user.name : '' };
}

// Balasan story = pesan di chat pribadi Phase 2 (tidak ada sistem chat kedua).
async function replyStory(viewerId, storyId, content) {
  const story = await loadActive(storyId, viewerId);
  const ownerId = story.userId.toString();
  if (ownerId === viewerId) throw new AppError(400, 'Kamu tidak bisa membalas story sendiri.');
  const conv = await msgs.openPrivate(viewerId, ownerId);
  return msgs.createMessage(
    viewerId,
    { conversationId: conv.id, content },
    { storyRef: { storyId: story._id, type: story.type, snippet: story.caption.slice(0, 60) } }
  );
}

async function viewers(ownerId, storyId, { limit, skip }) {
  assertId(storyId, 'Story tidak ditemukan.');
  const story = await Story.findById(storyId);
  if (!story || story.userId.toString() !== ownerId) throw new AppError(404, 'Story tidak ditemukan.');
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const off = Math.min(Math.max(parseInt(skip, 10) || 0, 0), 5000);
  const rows = await StoryView.find({ storyId: story._id }).sort({ createdAt: -1 }).skip(off).limit(lim + 1);
  const page = rows.slice(0, lim);
  const users = await User.find({ _id: { $in: page.map((v) => v.userId) } });
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return {
    viewers: page.filter((v) => byId.has(v.userId.toString())).map((v) => ({ user: publicUser(byId.get(v.userId.toString())), reaction: v.reaction, at: v.createdAt })),
    total: story.viewsCount,
    hasMore: rows.length > lim
  };
}

async function deleteStory(userId, storyId) {
  assertId(storyId, 'Story tidak ditemukan.');
  const story = await Story.findById(storyId);
  if (!story || story.userId.toString() !== userId) throw new AppError(404, 'Story tidak ditemukan.');
  await Story.deleteOne({ _id: story._id });
  await StoryView.deleteMany({ storyId: story._id });
  await media.remove(story.media.url);
  return { notify: story.privacy === 'nobody' ? [] : await contactIds(userId) };
}

// Sweeper: hapus story kedaluwarsa beserta file media-nya (dipanggil berkala dari server.js).
async function sweepExpired() {
  const expired = await Story.find({ expiresAt: { $lte: new Date() } }).limit(100);
  for (const s of expired) {
    await media.remove(s.media.url);
    await StoryView.deleteMany({ storyId: s._id });
    await Story.deleteOne({ _id: s._id });
  }
  return expired.length;
}

function startSweeper() {
  const run = () => sweepExpired().catch((err) => console.error('[stories] sweeper:', err.message));
  run();
  setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = { createStory, feed, userStories, getStory, viewStory, reactStory, replyStory, viewers, deleteStory, sweepExpired, startSweeper };
