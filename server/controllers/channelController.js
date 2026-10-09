'use strict';

const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/channelService');
const media = require('../services/mediaService');
const AppError = require('../utils/AppError');

const room = (id) => `channel:${id}`;
const toRoom = (req, channelId, event, payload) => {
  const io = req.app.get('io');
  if (io) io.to(room(channelId)).emit(event, payload); // hanya yang sedang membuka saluran
};

const create = asyncHandler(async (req, res) => res.status(201).json({ channel: await svc.createChannel(req.user.id, req.body || {}) }));
const list = asyncHandler(async (req, res) => res.json(await svc.listChannels(req.user.id, req.query)));
const get = asyncHandler(async (req, res) => res.json({ channel: await svc.getChannel(req.user.id, req.params.id) }));

const update = asyncHandler(async (req, res) => {
  const ch = await svc.updateChannel(req.user.id, req.params.id, req.body || {});
  toRoom(req, ch.id, 'channel:update', { channel: ch });
  res.json({ channel: ch });
});

const remove = asyncHandler(async (req, res) => {
  await svc.deleteChannel(req.user.id, req.params.id);
  toRoom(req, req.params.id, 'channel:delete', { channelId: req.params.id });
  const io = req.app.get('io');
  if (io) io.socketsLeave(room(req.params.id));
  res.json({ ok: true });
});

const follow = asyncHandler(async (req, res) => {
  const ch = await svc.follow(req.user.id, req.params.id);
  toRoom(req, ch.id, 'channel:update', { channel: { id: ch.id, followersCount: ch.followersCount } });
  res.status(201).json({ channel: ch });
});

const unfollow = asyncHandler(async (req, res) => {
  const ch = await svc.unfollow(req.user.id, req.params.id);
  toRoom(req, ch.id, 'channel:update', { channel: { id: ch.id, followersCount: ch.followersCount } });
  res.json({ channel: ch });
});

const mute = asyncHandler(async (req, res) => res.json(await svc.setMuted(req.user.id, req.params.id, (req.body || {}).muted === true)));
const admin = (makeAdmin) => asyncHandler(async (req, res) => res.json(await svc.setAdmin(req.user.id, req.params.id, req.params.userId, makeAdmin)));

const posts = asyncHandler(async (req, res) => res.json(await svc.listPosts(req.user.id, req.params.id, req.query)));

const createPost = asyncHandler(async (req, res) => {
  const post = await svc.createPost(req.user.id, req.params.id, (req.body || {}).content);
  toRoom(req, post.channelId, 'channel:post:new', { post });
  res.status(201).json({ post });
});

// Post dengan lampiran (badan biner mentah). Hanya owner/admin; file dibersihkan jika gagal.
const createPostAttachment = asyncHandler(async (req, res) => {
  await svc.assertCanPost(req.user.id, req.params.id);
  const q = req.query;
  if (!['image', 'video', 'audio', 'file'].includes(q.kind)) throw new AppError(400, 'Jenis lampiran tidak valid.');
  const att = await media.saveAttachment(req.body, q.kind, { name: q.name });
  let post;
  try { post = await svc.createPost(req.user.id, req.params.id, typeof q.caption === 'string' ? q.caption : '', att); }
  catch (err) { await media.remove(att.url); throw err; }
  toRoom(req, post.channelId, 'channel:post:new', { post });
  res.status(201).json({ post });
});

const byUsername = asyncHandler(async (req, res) => res.json({ channel: await svc.getByUsername(req.user.id, req.params.username) }));

const transfer = asyncHandler(async (req, res) => {
  await svc.transferOwner(req.user.id, req.params.id, req.params.userId);
  const ch = await svc.getChannel(req.user.id, req.params.id);
  toRoom(req, ch.id, 'channel:update', { channel: { id: ch.id, ownerId: ch.ownerId } });
  res.json({ channel: ch });
});

const editPost = asyncHandler(async (req, res) => {
  const post = await svc.editPost(req.user.id, req.params.id, (req.body || {}).content);
  toRoom(req, post.channelId, 'channel:post:edit', { post: { ...post, myReaction: null } });
  res.json({ post });
});

const deletePost = asyncHandler(async (req, res) => {
  const r = await svc.deletePost(req.user.id, req.params.id);
  toRoom(req, r.channelId, 'channel:post:delete', { postId: r.postId, channelId: r.channelId });
  res.json({ ok: true });
});

const pin = asyncHandler(async (req, res) => {
  const r = await svc.pinPost(req.user.id, req.params.id, req.params.postId);
  toRoom(req, r.channelId, 'channel:post:pin', r);
  res.json(r);
});

const react = asyncHandler(async (req, res) => {
  const r = await svc.reactPost(req.user.id, req.params.id, (req.body || {}).emoji);
  toRoom(req, r.post.channelId, 'channel:post:reaction', {
    postId: r.post.id, channelId: r.post.channelId, reactionCounts: r.post.reactionCounts, actorId: r.actorId, actorEmoji: r.actorEmoji
  });
  res.json({ post: r.post });
});

const view = asyncHandler(async (req, res) => {
  const r = await svc.viewPost(req.user.id, req.params.id);
  res.json({ viewsCount: r.viewsCount });
});

module.exports = { createPostAttachment, byUsername, transfer, create, list, get, update, remove, follow, unfollow, mute, promote: admin(true), demote: admin(false), posts, createPost, editPost, deletePost, pin, react, view };
