'use strict';

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, default: null, maxlength: 4000 },
    type: { type: String, enum: ['text', 'image', 'video', 'audio', 'voice', 'file'], default: 'text' },
    attachment: { url: String, mime: String, size: Number, name: String, duration: Number },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    reactions: [{ _id: false, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
    // Diisi server saat membalas story (tidak pernah dari payload client).
    storyRef: { storyId: mongoose.Schema.Types.ObjectId, type: String, snippet: String },
    deliveredAt: { type: Date, default: null },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

// Query pesan terbaru per percakapan.
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Otorisasi file media chat: cari pesan pemilik file.
messageSchema.index({ 'attachment.url': 1 }, { sparse: true });

module.exports = mongoose.model('Message', messageSchema);
