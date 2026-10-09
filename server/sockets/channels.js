'use strict';

const Channel = require('../models/Channel');
const AppError = require('../utils/AppError');
const { assertId, isObjectId } = require('../utils/validators');
const makeOn = require('./handler');

const MAX_OPEN_CHANNELS = 10;

// Room "channel:<id>": hanya socket yang sedang membuka saluran (bukan broadcast ke semua user).
function register(io, socket) {
  const on = makeOn(socket);

  on('channel:join', { name: 'chjoin', limit: 60, windowMs: 60000 }, async (p) => {
    assertId(p.channelId, 'Saluran tidak ditemukan.');
    if (!(await Channel.exists({ _id: p.channelId }))) throw new AppError(404, 'Saluran tidak ditemukan.');
    const open = [...socket.rooms].filter((r) => r.startsWith('channel:')).length;
    if (open >= MAX_OPEN_CHANNELS) throw new AppError(400, 'Terlalu banyak saluran terbuka.');
    socket.join(`channel:${p.channelId}`);
  });

  on('channel:leave', null, async (p) => {
    if (isObjectId(p.channelId)) socket.leave(`channel:${p.channelId}`);
  });
}

module.exports = { register };
