'use strict';

const express = require('express');
const c = require('../controllers/channelController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

const reactLimiter = userLimiter(60 * 1000, 60, 'Terlalu cepat. Pelan-pelan ya.');
const viewLimiter = userLimiter(60 * 1000, 120, 'Terlalu cepat. Pelan-pelan ya.');

router.patch('/:id', c.editPost);
router.delete('/:id', c.deletePost);
router.post('/:id/reaction', reactLimiter, c.react);
router.post('/:id/view', viewLimiter, c.view);

module.exports = router;
