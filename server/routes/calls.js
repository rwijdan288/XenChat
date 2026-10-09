'use strict';

const express = require('express');
const c = require('../controllers/callController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.get('/ice', c.ice);
router.get('/', c.list);
router.delete('/', c.clear);
router.delete('/:id', c.remove);

module.exports = router;
