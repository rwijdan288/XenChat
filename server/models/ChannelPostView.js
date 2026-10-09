'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPost', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

schema.index({ postId: 1, userId: 1 }, { unique: true }); // 1 view / user / post

module.exports = mongoose.model('ChannelPostView', schema);
