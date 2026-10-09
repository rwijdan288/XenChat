'use strict';

const express = require('express');
const c = require('../controllers/channelController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

const createLimiter = userLimiter(60 * 60 * 1000, 3, 'Terlalu banyak membuat saluran. Coba lagi nanti.');
const followLimiter = userLimiter(60 * 60 * 1000, 100, 'Terlalu banyak mengikuti saluran. Coba lagi nanti.');
const postLimiter = userLimiter(60 * 60 * 1000, 60, 'Terlalu banyak postingan. Coba lagi nanti.');

router.post('/', createLimiter, c.create);
router.get('/', c.list);
router.get('/by-username/:username', c.byUsername);
router.get('/:id', c.get);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);

router.post('/:id/follow', followLimiter, c.follow);
router.delete('/:id/follow', followLimiter, c.unfollow);
router.put('/:id/mute', c.mute);

router.post('/:id/admins/:userId', c.promote);
router.delete('/:id/admins/:userId', c.demote);

router.post('/:id/transfer/:userId', c.transfer);
router.post('/:id/posts/attachment', postLimiter, express.raw({ type: () => true, limit: '26mb' }), c.createPostAttachment);
router.get('/:id/posts', c.posts);
router.post('/:id/posts', postLimiter, c.createPost);
router.post('/:id/pin/:postId', c.pin);

module.exports = router;
