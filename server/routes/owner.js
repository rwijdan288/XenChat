'use strict';

const express = require('express');
const c = require('../controllers/ownerController');
const { requireAuth, requireOwner } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireOwner); // role dari database, bukan dari client

router.get('/stats', c.stats);
router.get('/users', c.users);
router.post('/users/:id/ban', c.ban);
router.post('/users/:id/unban', c.unban);
router.post('/users/:id/verify', c.verify);
router.post('/users/:id/unverify', c.unverify);
router.get('/reports', c.reports);
router.post('/reports/:id/resolve', c.resolve);
router.get('/channels', c.channels);
router.post('/channels/:id/verify', c.verifyChannel);
router.post('/channels/:id/unverify', c.unverifyChannel);

module.exports = router;
