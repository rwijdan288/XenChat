'use strict';

const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET belum diisi atau kurang dari 32 karakter. Salin .env.example ke .env lalu isi.');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xenchat',
  jwtSecret,
  jwtExpiresIn: '7d',
  cookieName: 'xen_token',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', '..', 'uploads'),
  limits: {
    groupMembers: 500,
    channelFollowers: 10000,
    imageBytes: 10 * 1024 * 1024,
    videoBytes: 25 * 1024 * 1024,
    videoSeconds: 60,
    avatarBytes: 60 * 1024,
    storyTtlMs: 24 * 60 * 60 * 1000
  },
  // Owner di-bootstrap dari environment saat server start (tidak ada password di dalam kode).
  owner: {
    name: process.env.OWNER_NAME || 'XenChat Owner',
    username: (process.env.OWNER_USERNAME || '').trim().toLowerCase(),
    email: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
    password: process.env.OWNER_PASSWORD || ''
  },
  // Server ICE untuk WebRTC. STUN publik cukup untuk jaringan sederhana; TURN dibutuhkan di NAT ketat.
  ice: {
    stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((x) => x.trim()).filter(Boolean),
    turnUrls: (process.env.TURN_URLS || '').split(',').map((x) => x.trim()).filter(Boolean),
    turnUser: process.env.TURN_USERNAME || '',
    turnPass: process.env.TURN_PASSWORD || ''
  },
  attachmentLimits: { image: 10 * 1024 * 1024, video: 25 * 1024 * 1024, audio: 15 * 1024 * 1024, voice: 5 * 1024 * 1024, file: 20 * 1024 * 1024, voiceSeconds: 120 },
  editWindowMs: 15 * 60 * 1000,
  trustProxy: process.env.TRUST_PROXY === '1'
};
