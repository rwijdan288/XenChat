'use strict';

const mongoose = require('mongoose');

const ref = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };

const schema = new mongoose.Schema({
  callerId: { ...ref, required: true },
  calleeId: { ...ref, required: true },
  type: { type: String, enum: ['audio', 'video'], required: true },
  // Status akhir: completed, missed (tidak dijawab), rejected, cancelled (dibatalkan penelepon), failed.
  status: { type: String, enum: ['ringing', 'completed', 'missed', 'rejected', 'cancelled', 'failed'], default: 'ringing' },
  startedAt: { type: Date, default: Date.now },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  duration: { type: Number, default: 0 }, // detik
  hiddenBy: [ref] // "hapus riwayat" hanya menyembunyikan untuk user tersebut
});

schema.index({ callerId: 1, startedAt: -1 });
schema.index({ calleeId: 1, startedAt: -1 });

module.exports = mongoose.model('Call', schema);
