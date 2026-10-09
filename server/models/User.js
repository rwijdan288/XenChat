'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, unique: true, immutable: true, match: /^\d{8}$/ },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 20 },
    // Email dinormalisasi (lowercase) -> unik tanpa membedakan huruf. Sparse: akun lama (Phase 1-3) belum punya email.
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, default: '', maxlength: 160 },
    avatarUrl: { type: String, default: '' },
    avatarData: { type: Buffer, select: false },
    avatarType: { type: String, select: false },
    // Hanya server/Owner yang boleh mengubah role & verified; tidak pernah dibaca dari input user.
    role: { type: String, enum: ['user', 'owner'], default: 'user' },
    verified: { type: Boolean, default: false },
    banned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    deleted: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 }, // dinaikkan saat "keluar dari semua sesi" / ganti password
    settings: {
      showPresence: { type: Boolean, default: true },
      defaultStoryPrivacy: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'contacts' }
    },
    lastSeen: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
// Maksimal satu Owner platform, dijamin oleh database.
userSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: 'owner' } });

// Representasi untuk pemilik akun sendiri (register/login/me). Tanpa passwordHash.
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    accountId: this.accountId,
    name: this.name,
    username: this.username,
    email: this.email || '',
    bio: this.bio,
    avatarUrl: this.avatarUrl,
    verified: this.verified,
    role: this.role,
    settings: {
      showPresence: !this.settings || this.settings.showPresence !== false,
      defaultStoryPrivacy: (this.settings && this.settings.defaultStoryPrivacy) || 'contacts'
    },
    lastSeen: this.lastSeen,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
