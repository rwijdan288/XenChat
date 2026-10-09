'use strict';

const express = require('express');
const media = require('../services/mediaService');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Lampiran chat hanya bisa dibuka peserta percakapan; media lain (story, avatar, saluran) untuk user login.
const authorize = asyncHandler(async (req, res, next) => {
  const name = req.params.filename;
  if (!media.isValidName(name)) throw new AppError(404, 'Media tidak ditemukan.');
  const msg = await Message.findOne({ 'attachment.url': `/api/media/${name}` }).select('conversationId');
  if (msg && !(await Conversation.exists({ _id: msg.conversationId, participants: req.user._id }))) {
    throw new AppError(404, 'Media tidak ditemukan.');
  }
  next();
});

router.get('/:filename', requireAuth, authorize, media.serve);

module.exports = router;
