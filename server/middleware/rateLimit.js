'use strict';

const rateLimit = require('express-rate-limit');

const message = { message: 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.' };

// Pembatas ketat untuk login/register (anti brute-force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message
});

// Pembatas umum untuk seluruh /api.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message
});

// Pembatas per user (dipasang setelah requireAuth).
const userLimiter = (windowMs, limit, text) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? req.user.id : 'anon'),
    message: { message: text || message.message }
  });

module.exports = { authLimiter, apiLimiter, userLimiter };
