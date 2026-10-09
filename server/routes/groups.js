'use strict';

const express = require('express');
const c = require('../controllers/groupController');
const { requireAuth } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth);

const joinLimiter = userLimiter(60 * 60 * 1000, 30, 'Terlalu banyak percobaan bergabung. Coba lagi nanti.');

const createLimiter = userLimiter(60 * 60 * 1000, 5, 'Terlalu banyak membuat grup. Coba lagi nanti.');
const inviteLimiter = userLimiter(60 * 60 * 1000, 60, 'Terlalu banyak mengundang anggota. Coba lagi nanti.');

// Bergabung lewat link (didefinisikan sebelum '/:id').
router.get('/join/:token', c.preview);
router.post('/join/:token', joinLimiter, c.join);

router.post('/', createLimiter, c.create);
router.get('/:id', c.get);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);

router.get('/:id/members', c.members);
router.post('/:id/members', inviteLimiter, c.addMember);
router.delete('/:id/members/:userId', c.removeMember);

router.post('/:id/admins/:userId', c.promote);
router.delete('/:id/admins/:userId', c.demote);
router.post('/:id/transfer/:userId', c.transfer);

router.get('/:id/invite', c.getInvite);
router.post('/:id/invite', c.createInvite);
router.delete('/:id/invite', c.revokeInvite);

router.post('/:id/leave', c.leave);
router.put('/:id/mute', c.mute);

module.exports = router;
