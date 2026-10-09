'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak pencarian. Coba lagi sebentar.' }
});

router.use(requireAuth);

router.get('/me', c.getMe);
router.patch('/me', c.updateMe);
router.patch('/me/settings', c.updateSettings);
router.put('/me/email', c.setEmail);
router.get('/search', searchLimiter, c.search);
router.get('/avatar/:accountId', c.getAvatar);
router.get('/id/:accountId', c.getByAccountId);
router.get('/:username', c.getByUsername);

module.exports = router;
