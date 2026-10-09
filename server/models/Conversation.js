'use strict';

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    // Private: "idA:idB" (urut). Grup: "group:<groupId>". Unique -> tidak ada percakapan ganda.
    participantKey: { type: String, required: true, unique: true },
    lastMessage: {
      messageId: mongoose.Schema.Types.ObjectId,
      senderId: mongoose.Schema.Types.ObjectId,
      senderName: String,
      text: String,
      deleted: { type: Boolean, default: false },
      createdAt: Date
    },
    lastMessageAt: { type: Date, default: null },
    // { "<userId>": jumlah pesan belum dibaca } - sumber kebenaran ada di database.
    unread: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, minimize: false }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
