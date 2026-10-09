'use strict';

const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 20 },
    description: { type: String, default: '', maxlength: 200 },
    avatarUrl: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // tidak termasuk owner
    followersCount: { type: Number, default: 0 },
    // Hanya bisa diubah lewat mekanisme server/admin, tidak pernah dari input user.
    verified: { type: Boolean, default: false }
  },
  { timestamps: true }
);

channelSchema.index({ ownerId: 1 });
channelSchema.index({ followersCount: -1, _id: 1 });

module.exports = mongoose.model('Channel', channelSchema);
