'use strict';

const mongoose = require('mongoose');

const storySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    media: { url: String, mime: String, size: Number, duration: Number },
    caption: { type: String, default: '', maxlength: 200 },
    privacy: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'contacts' },
    viewsCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// Tidak memakai TTL index: file media harus ikut dihapus, jadi dokumen dibersihkan oleh sweeper (storyService).
storySchema.index({ userId: 1, expiresAt: -1 });
storySchema.index({ expiresAt: 1 });

module.exports = mongoose.model('Story', storySchema);
