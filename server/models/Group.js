'use strict';

const mongoose = require('mongoose');

const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model });

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    description: { type: String, default: '', maxlength: 200 },
    avatarUrl: { type: String, default: '' },
    ownerId: { ...ref('User'), required: true },
    admins: [ref('User')], // termasuk owner
    members: [ref('User')], // sumber kebenaran keanggotaan (dicerminkan ke Conversation.participants)
    membersCount: { type: Number, default: 1 },
    conversationId: ref('Conversation'),
    mutedBy: [ref('User')], // lama (Phase 3); dipakai sebagai "selamanya" jika masih ada
    mutes: [{ _id: false, user: ref('User'), until: Date }], // until = null -> selamanya
    inviteToken: { type: String, default: null }
  },
  { timestamps: true }
);

groupSchema.index({ members: 1 });
groupSchema.index({ ownerId: 1 });
groupSchema.index({ inviteToken: 1 }, { unique: true, partialFilterExpression: { inviteToken: { $type: 'string' } } });

module.exports = mongoose.model('Group', groupSchema);
