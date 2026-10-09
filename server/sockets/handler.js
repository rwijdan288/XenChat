'use strict';

const AppError = require('../utils/AppError');
const limiter = require('../utils/socketRateLimit');

// Pembungkus handler socket: validasi payload, rate limit, ack {ok, ...} atau {ok:false, error}.
module.exports = function makeOn(socket) {
  const userId = socket.data.userId;
  return function on(event, bucket, fn) {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (bucket && !limiter.allow(userId, bucket.name, bucket.limit, bucket.windowMs)) {
          return reply({ ok: false, error: 'Terlalu cepat. Pelan-pelan ya.' });
        }
        const data = await fn(payload && typeof payload === 'object' ? payload : {});
        return reply({ ok: true, ...(data || {}) });
      } catch (err) {
        if (!(err instanceof AppError)) console.error(`[socket:${event}]`, err);
        return reply({ ok: false, error: err instanceof AppError ? err.message : 'Terjadi kesalahan. Silakan coba lagi.' });
      }
    });
  };
};
