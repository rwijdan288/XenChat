'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: '', maxlength: 4000 },
    kind: { type: String, enum: ['text', 'image', 'video', 'audio', 'file'], default: 'text' },
    attachment: { url: String, mime: String, size: Number, name: String },
    edited: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    viewsCount: { type: Number, default: 0 },
    // { "<emoji>": jumlah }; reaksi per user ada di ChannelReaction.
    reactionCounts: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, minimize: false }
);

schema.index({ channelId: 1, createdAt: -1, _id: -1 });
schema.index({ channelId: 1, pinned: 1 });

module.exports = mongoose.model('ChannelPost', schema);
