'use strict';

const express = require('express');
const c = require('../controllers/messageController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.patch('/:id', c.edit);
router.delete('/:id', c.remove);

module.exports = router;
