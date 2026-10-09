'use strict';

const asyncHandler = require('../utils/asyncHandler');
const msgs = require('../services/messageService');

const list = asyncHandler(async (req, res) => {
  res.json(await msgs.listConversations(req.user.id, req.query));
});

const createPrivate = asyncHandler(async (req, res) => {
  const body = req.body || {};
  res.json({ conversation: await msgs.openPrivate(req.user.id, body.userId) });
});

const getOne = asyncHandler(async (req, res) => {
  const conv = await msgs.getConversationFor(req.params.id, req.user.id);
  res.json({ conversation: await msgs.conversationItemFor(conv, req.user.id) });
});

const messages = asyncHandler(async (req, res) => {
  res.json(await msgs.listMessages(req.user.id, req.params.id, req.query));
});

module.exports = { list, createPrivate, getOne, messages };

// Upload lampiran (badan biner mentah). Keanggotaan & block dicek sebelum/ sesudah simpan; file dibersihkan jika gagal.
const emit = require('../utils/emit');
const media = require('../services/mediaService');

const upload = asyncHandler(async (req, res) => {
  await msgs.getConversationFor(req.params.id, req.user.id); // 404 jika bukan peserta
  const q = req.query;
  const att = await media.saveAttachment(req.body, q.kind, { name: q.name, duration: q.duration });
  let r;
  try {
    r = await msgs.createMessage(req.user.id, { conversationId: req.params.id, content: typeof q.caption === 'string' ? q.caption : '' }, { attachment: att });
  } catch (err) {
    await media.remove(att.url);
    throw err;
  }
  emit.newMessage(req.app.get('io'), r);
  res.status(201).json({ message: r.message });
});

module.exports.upload = upload;
