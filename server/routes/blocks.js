'use strict';

const express = require('express');
const c = require('../controllers/blockController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.get('/', c.list);
router.post('/:userId', c.block);
router.delete('/:userId', c.unblock);

module.exports = router;
