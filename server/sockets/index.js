'use strict';

const { Server } = require('socket.io');
const config = require('../config/config');
const { userFromToken } = require('../middleware/auth');
const presence = require('./presence');
const chat = require('./chat');
const channels = require('./channels');
const calls = require('./calls');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

module.exports = function initSockets(httpServer) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    ...(config.corsOrigins.length ? { cors: { origin: config.corsOrigins, credentials: true } } : {})
  });

  // Autentikasi: JWT dari cookie httpOnly yang sama dengan REST. userId tidak pernah dari client.
  io.use(async (socket, next) => {
    try {
      const { origin, host, cookie } = socket.handshake.headers;
      if (origin) {
        let sameHost = false;
        try { sameHost = new URL(origin).host === host; } catch (e) { /* origin tidak valid */ }
        if (!sameHost && !config.corsOrigins.includes(origin)) return next(new Error('forbidden'));
      }
      const token = parseCookies(cookie)[config.cookieName];
      if (!token) return next(new Error('unauthorized'));
      const user = await userFromToken(token);
      if (!user || user.banned) return next(new Error('unauthorized'));
      socket.data.userId = user._id.toString();
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    presence.onConnect(io, socket);
    chat.register(io, socket);
    channels.register(io, socket);
    calls.register(io, socket);
  });

  return io;
};
