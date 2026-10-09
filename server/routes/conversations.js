'use strict';

const express = require('express');
const c = require('../controllers/conversationController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

router.get('/', c.list);
router.post('/private', c.createPrivate);
router.get('/:id', c.getOne);
router.get('/:id/messages', c.messages);
// Lampiran: badan biner mentah, batas tertinggi 26 MB; batas per jenis dicek di mediaService.
router.post('/:id/attachments', userLimiter(10 * 60 * 1000, 40, 'Terlalu banyak unggahan. Coba lagi sebentar.'), express.raw({ type: () => true, limit: '26mb' }), c.upload);

module.exports = router;
