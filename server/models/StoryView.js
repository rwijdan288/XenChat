'use strict';

const mongoose = require('mongoose');

const storyViewSchema = new mongoose.Schema(
  {
    storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reaction: { type: String, default: null },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

storyViewSchema.index({ storyId: 1, userId: 1 }, { unique: true });
storyViewSchema.index({ userId: 1, storyId: 1 });
storyViewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // cadangan: view ikut kedaluwarsa

module.exports = mongoose.model('StoryView', storyViewSchema);
