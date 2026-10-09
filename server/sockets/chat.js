'use strict';

const emit = require('../utils/emit');
const limiter = require('../utils/socketRateLimit');
const { isObjectId } = require('../utils/validators');
const msgs = require('../services/messageService');
const makeOn = require('./handler');

function register(io, socket) {
  const userId = socket.data.userId;
  const on = makeOn(socket);

  on('conversation:join', { name: 'join', limit: 60, windowMs: 60000 }, async (p) => {
    const conv = await msgs.getConversationFor(p.conversationId, userId); // validasi keanggotaan (private & grup)
    socket.join(`conversation:${conv._id}`);
  });

  on('conversation:leave', null, async (p) => {
    if (isObjectId(p.conversationId)) socket.leave(`conversation:${p.conversationId}`);
  });

  on('message:send', { name: 'send', limit: 30, windowMs: 60000 }, async (p) => {
    const r = await msgs.createMessage(userId, p); // tanpa `extra`: client tidak bisa menyisipkan storyRef
    emit.newMessage(io, r);
    return { message: r.message, clientId: typeof p.clientId === 'string' ? p.clientId.slice(0, 64) : undefined };
  });

  on('message:edit', { name: 'edit', limit: 30, windowMs: 60000 }, async (p) => {
    const r = await msgs.editMessage(userId, p.messageId, p.content);
    emit(io, r.participants, 'message:edit', { message: r.message, isLast: r.isLast });
  });

  on('message:delete', { name: 'edit', limit: 30, windowMs: 60000 }, async (p) => {
    const r = await msgs.deleteMessage(userId, p.messageId);
    emit(io, r.participants, 'message:delete', { message: r.message, isLast: r.isLast });
  });

  on('message:reaction', { name: 'react', limit: 60, windowMs: 60000 }, async (p) => {
    const r = await msgs.reactMessage(userId, p.messageId, p.emoji);
    emit(io, r.participants, 'message:reaction', r.payload);
  });

  on('message:read', { name: 'read', limit: 120, windowMs: 60000 }, async (p) => {
    const r = await msgs.markRead(userId, p.conversationId);
    emit(io, r.participants, 'message:read', r.payload);
  });

  // Typing: hanya realtime (tanpa database). Hanya boleh jika socket sudah join room percakapan.
  ['start', 'stop'].forEach((kind) => {
    socket.on(`message:typing:${kind}`, (p) => {
      const cid = p && p.conversationId;
      if (!isObjectId(cid) || !socket.rooms.has(`conversation:${cid}`)) return;
      if (!limiter.allow(userId, 'typing', 40, 10000)) return;
      socket.to(`conversation:${cid}`).emit(`message:typing:${kind}`, { conversationId: cid, userId });
    });
  });
}

module.exports = { register };
