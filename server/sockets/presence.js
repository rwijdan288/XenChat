'use strict';

const User = require('../models/User');
const Conversation = require('../models/Conversation');
const presence = require('../services/presenceService');
const emit = require('../utils/emit');

// Lawan bicara di chat pribadi (maks. 500; grup tidak ikut agar tidak ada badai event presence) yang perlu tahu perubahan status online.
async function partnerIds(userId) {
  const rows = await Conversation.find({ participants: userId, type: { $ne: 'group' } }).select('participants').limit(500).lean();
  const set = new Set();
  rows.forEach((r) => r.participants.forEach((p) => { if (p.toString() !== userId) set.add(p.toString()); }));
  return [...set];
}

// Pengguna yang menyembunyikan status online tidak menyiarkan presence.
async function visible(userId) {
  const u = await User.findById(userId).select('settings');
  return !u || !u.settings || u.settings.showPresence !== false;
}

function onConnect(io, socket) {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);

  if (presence.add(userId)) {
    visible(userId)
      .then((v) => (v ? partnerIds(userId) : []))
      .then((ids) => emit(io, ids, 'user:online', { userId }))
      .catch((err) => console.error('[presence]', err.message));
  }

  socket.on('disconnect', async () => {
    try {
      if (!presence.remove(userId)) return; // masih ada tab/device lain
      const lastSeen = new Date();
      await User.updateOne({ _id: userId }, { $set: { lastSeen } });
      if (await visible(userId)) emit(io, await partnerIds(userId), 'user:offline', { userId, lastSeen });
    } catch (err) {
      console.error('[presence]', err.message);
    }
  });
}

module.exports = { onConnect };
