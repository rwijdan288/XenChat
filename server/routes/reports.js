'use strict';

const express = require('express');
const c = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);
router.post('/', userLimiter(60 * 60 * 1000, 10, 'Terlalu banyak laporan. Coba lagi nanti.'), c.create);

module.exports = router;
