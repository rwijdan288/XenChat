'use strict';

const express = require('express');
const c = require('../controllers/storyController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

const createLimiter = userLimiter(24 * 60 * 60 * 1000, 20, 'Batas 20 story per hari tercapai.');
const reactLimiter = userLimiter(60 * 1000, 60, 'Terlalu cepat. Pelan-pelan ya.');
// Upload biner mentah (image/video). Batas 26 MB; batas per jenis dicek di mediaService.
const rawBody = express.raw({ type: () => true, limit: '26mb' });

router.post('/', createLimiter, rawBody, c.create);
router.get('/', c.feed);
router.get('/user/:userId', c.byUser);
router.get('/:id', c.get);
router.delete('/:id', c.remove);

router.post('/:id/view', c.view);
router.post('/:id/reaction', reactLimiter, c.react);
router.post('/:id/reply', reactLimiter, c.reply);
router.get('/:id/viewers', c.viewers);

module.exports = router;
