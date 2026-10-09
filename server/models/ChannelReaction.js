'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPost', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emoji: { type: String, required: true }
});

schema.index({ postId: 1, userId: 1 }, { unique: true }); // satu reaksi per user per post

module.exports = mongoose.model('ChannelReaction', schema);
