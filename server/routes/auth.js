'use strict';

const express = require('express');
const c = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/register', authLimiter, c.register);
router.post('/login', authLimiter, c.login);
router.post('/logout', c.logout);
router.get('/me', requireAuth, c.me);
router.post('/password', requireAuth, authLimiter, c.changePassword);
router.post('/logout-all', requireAuth, c.logoutAll);
router.delete('/account', requireAuth, authLimiter, c.deleteAccount);

module.exports = router;
