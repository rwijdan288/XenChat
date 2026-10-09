'use strict';

// Signaling WebRTC lewat Socket.IO. Media (audio/video) TIDAK lewat server: langsung peer-to-peer (WebRTC).
const User = require('../models/User');
const Call = require('../models/Call');
const AppError = require('../utils/AppError');
const emit = require('../utils/emit');
const { assertId } = require('../utils/validators');
const { publicUser } = require('../utils/serializers');
const presence = require('../services/presenceService');
const blocks = require('../services/blockService');
const makeOn = require('./handler');

const RING_MS = 45000;
const active = new Map(); // callId -> state
const inCall = new Map(); // userId -> callId

// Selesaikan panggilan, simpan riwayat, beri tahu kedua pihak. Idempotent.
async function endCall(io, state, reason) {
  if (!active.has(state.callId)) return;
  active.delete(state.callId);
  inCall.delete(state.callerId);
  inCall.delete(state.calleeId);
  clearTimeout(state.timer);

  let status;
  let duration = 0;
  if (state.answeredAt) {
    status = 'completed';
    duration = Math.max(0, Math.round((Date.now() - state.answeredAt) / 1000));
  } else if (reason === 'reject') status = 'rejected';
  else if (reason === 'cancel') status = 'cancelled';
  else status = 'missed'; // timeout / disconnect sebelum dijawab

  emit(io, [state.callerId, state.calleeId], 'call:end', { callId: state.callId, reason, status, duration });
  try {
    await Call.updateOne({ _id: state.callId }, { $set: { status, endedAt: new Date(), duration, answeredAt: state.answeredAt ? new Date(state.answeredAt) : null } });
  } catch (err) {
    console.error('[calls] gagal menyimpan riwayat:', err.message);
  }
}

const validSdp = (s) => s && typeof s === 'object' && ['offer', 'answer'].includes(s.type) && typeof s.sdp === 'string' && s.sdp.length > 0 && s.sdp.length <= 14000;
const validCandidate = (c) => c && typeof c === 'object' && typeof c.candidate === 'string' && JSON.stringify(c).length <= 1500;

function register(io, socket) {
  const userId = socket.data.userId;
  const on = makeOn(socket);

  // Ambil panggilan milik user ini, pastikan ia peserta dan (opsional) socket yang terdaftar.
  function mine(p, requireSocket) {
    assertId(p.callId, 'Panggilan tidak ditemukan.');
    const st = active.get(p.callId);
    if (!st || (st.callerId !== userId && st.calleeId !== userId)) throw new AppError(404, 'Panggilan tidak ditemukan.');
    if (requireSocket) {
      const sid = st.callerId === userId ? st.callerSocket : st.calleeSocket;
      if (sid !== socket.id) throw new AppError(403, 'Panggilan ini aktif di tab/perangkat lain.');
    }
    return st;
  }
  const peerSocket = (st) => (st.callerId === userId ? st.calleeSocket : st.callerSocket);

  on('call:invite', { name: 'callinv', limit: 10, windowMs: 60000 }, async (p) => {
    const type = p.type === 'video' ? 'video' : p.type === 'audio' ? 'audio' : null;
    if (!type) throw new AppError(400, 'Jenis panggilan tidak valid.');
    assertId(p.calleeId, 'Pengguna tidak ditemukan.');
    if (p.calleeId === userId) throw new AppError(400, 'Tidak bisa menelepon diri sendiri.');
    if (inCall.has(userId)) throw new AppError(409, 'Kamu sedang dalam panggilan.');

    const callee = await User.findById(p.calleeId);
    if (!callee || callee.banned || callee.deleted) throw new AppError(404, 'Pengguna tidak ditemukan.');
    if (await blocks.blockedEither(userId, p.calleeId)) throw new AppError(403, 'Panggilan tidak dapat dilakukan.'); // sama untuk dua arah

    const doc = await Call.create({ callerId: userId, calleeId: p.calleeId, type });
    const callId = doc._id.toString();
    const miss = async (msg) => {
      await Call.updateOne({ _id: doc._id }, { $set: { status: 'missed', endedAt: new Date() } });
      throw new AppError(409, msg);
    };
    if (!presence.isOnline(p.calleeId)) await miss('Pengguna sedang offline.');
    if (inCall.has(p.calleeId)) await miss('Pengguna sedang dalam panggilan lain.');

    const st = { callId, callerId: userId, calleeId: p.calleeId, type, callerSocket: socket.id, calleeSocket: null, answeredAt: null, timer: null };
    st.timer = setTimeout(() => endCall(io, st, 'timeout'), RING_MS);
    active.set(callId, st);
    inCall.set(userId, callId);
    inCall.set(p.calleeId, callId);

    const caller = await User.findById(userId);
    emit(io, [p.calleeId], 'call:invite', { callId, type, from: publicUser(caller) });
    return { callId };
  });

  // Callee memberi tahu bahwa perangkatnya berdering -> diteruskan ke penelepon.
  on('call:ring', null, async (p) => {
    const st = mine(p, false);
    if (st.calleeId !== userId || st.answeredAt) return;
    io.to(st.callerSocket).emit('call:ring', { callId: st.callId });
  });

  on('call:accept', null, async (p) => {
    const st = mine(p, false);
    if (st.calleeId !== userId) throw new AppError(403, 'Kamu tidak bisa menerima panggilan ini.');
    if (st.answeredAt) throw new AppError(409, 'Panggilan sudah dijawab.');
    st.answeredAt = Date.now();
    st.calleeSocket = socket.id;
    clearTimeout(st.timer);
    io.to(st.callerSocket).emit('call:accept', { callId: st.callId });
    socket.to(`user:${userId}`).emit('call:handled', { callId: st.callId }); // tab lain berhenti berdering
  });

  on('call:reject', null, async (p) => {
    const st = mine(p, false);
    if (st.calleeId !== userId || st.answeredAt) throw new AppError(403, 'Tidak bisa menolak panggilan ini.');
    await endCall(io, st, 'reject');
  });

  on('call:end', null, async (p) => {
    const st = mine(p, false);
    await endCall(io, st, st.answeredAt ? 'end' : st.callerId === userId ? 'cancel' : 'reject');
  });

  // Offer/answer/ICE: hanya diteruskan antara dua socket yang terdaftar pada panggilan ini.
  on('call:offer', { name: 'calloffer', limit: 30, windowMs: 60000 }, async (p) => {
    const st = mine(p, true);
    if (st.callerId !== userId || !st.answeredAt || !validSdp(p.sdp) || p.sdp.type !== 'offer') throw new AppError(400, 'Data panggilan tidak valid.');
    io.to(st.calleeSocket).emit('call:offer', { callId: st.callId, sdp: p.sdp });
  });

  on('call:answer', { name: 'callanswer', limit: 30, windowMs: 60000 }, async (p) => {
    const st = mine(p, true);
    if (st.calleeId !== userId || !st.answeredAt || !validSdp(p.sdp) || p.sdp.type !== 'answer') throw new AppError(400, 'Data panggilan tidak valid.');
    io.to(st.callerSocket).emit('call:answer', { callId: st.callId, sdp: p.sdp });
  });

  on('call:ice-candidate', { name: 'callice', limit: 300, windowMs: 60000 }, async (p) => {
    const st = mine(p, true);
    if (!st.answeredAt || !validCandidate(p.candidate)) return;
    io.to(peerSocket(st)).emit('call:ice-candidate', { callId: st.callId, candidate: p.candidate });
  });

  // Socket yang memegang panggilan terputus -> akhiri panggilan.
  socket.on('disconnect', () => {
    const callId = inCall.get(userId);
    const st = callId && active.get(callId);
    if (!st) return;
    if (st.callerSocket === socket.id || st.calleeSocket === socket.id) {
      endCall(io, st, st.answeredAt ? 'disconnect' : st.callerId === userId ? 'cancel' : 'disconnect');
    }
  });
}

module.exports = { register };
