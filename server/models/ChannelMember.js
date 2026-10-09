'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  muted: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now }
});

schema.index({ channelId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, joinedAt: -1 });

module.exports = mongoose.model('ChannelMember', schema);
