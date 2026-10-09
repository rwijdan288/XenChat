'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, enum: ['spam', 'harassment', 'fake_account', 'inappropriate', 'other'], required: true },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 300 }
  },
  { timestamps: true }
);

schema.index({ status: 1, createdAt: -1 });
schema.index({ reporterId: 1, targetId: 1, status: 1 });

module.exports = mongoose.model('Report', schema);
