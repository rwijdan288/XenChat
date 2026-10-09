'use strict';

const asyncHandler = require('../utils/asyncHandler');
const emit = require('../utils/emit');
const svc = require('../services/storyService');

const io = (req) => req.app.get('io');

// Body mentah (biner) dari express.raw; caption & privacy lewat query string.
const create = asyncHandler(async (req, res) => {
  const r = await svc.createStory(req.user.id, req.body, { caption: req.query.caption, privacy: req.query.privacy });
  emit(io(req), r.notify, 'story:new', { userId: req.user.id });
  res.status(201).json({ story: r.dto });
});

const feed = asyncHandler(async (req, res) => res.json(await svc.feed(req.user.id)));
const byUser = asyncHandler(async (req, res) => res.json({ stories: await svc.userStories(req.user.id, req.params.userId) }));
const get = asyncHandler(async (req, res) => res.json({ story: await svc.getStory(req.user.id, req.params.id) }));

const view = asyncHandler(async (req, res) => {
  const r = await svc.viewStory(req.user.id, req.params.id);
  if (r.counted) emit(io(req), [r.ownerId], 'story:view', { storyId: r.storyId, viewsCount: r.viewsCount });
  res.json({ viewsCount: r.viewsCount });
});

const react = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = await svc.reactStory(req.user.id, req.params.id, body.emoji);
  emit(io(req), [r.ownerId], 'story:reaction', { storyId: r.storyId, userId: r.userId, userName: r.userName, emoji: r.reaction });
  res.json({ reaction: r.reaction });
});

const reply = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = await svc.replyStory(req.user.id, req.params.id, body.content);
  emit.newMessage(io(req), r);
  res.status(201).json({ message: r.message });
});

const viewers = asyncHandler(async (req, res) => res.json(await svc.viewers(req.user.id, req.params.id, req.query)));

const remove = asyncHandler(async (req, res) => {
  const r = await svc.deleteStory(req.user.id, req.params.id);
  emit(io(req), [req.user.id, ...r.notify], 'story:delete', { storyId: req.params.id, userId: req.user.id });
  res.json({ ok: true });
});

module.exports = { create, feed, byUser, get, view, react, reply, viewers, remove };
