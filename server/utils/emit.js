'use strict';

// Kirim event ke room pribadi tiap user ("user:<id>").
function emitToUsers(io, userIds, event, payload) {
  if (!io || !userIds.length) return;
  io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
}

// message:new dikirim per peserta karena unreadCount berbeda untuk tiap orang.
emitToUsers.newMessage = (io, r) => {
  if (!io) return;
  r.participants.forEach((id) => {
    io.to(`user:${id}`).emit('message:new', { message: r.message, sender: r.sender, conversation: r.items[id] });
  });
};

// Keluarkan semua socket milik user dari sebuah room.
emitToUsers.leaveRoom = (io, userId, room) => {
  if (io) io.in(`user:${userId}`).socketsLeave(room);
};

module.exports = emitToUsers;
