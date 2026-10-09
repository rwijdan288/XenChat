'use strict';

const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/blockService');

module.exports = {
  list: asyncHandler(async (req, res) => res.json(await svc.list(req.user.id, req.query))),
  block: asyncHandler(async (req, res) => { await svc.block(req.user.id, req.params.userId); res.status(201).json({ blocked: true }); }),
  unblock: asyncHandler(async (req, res) => { await svc.unblock(req.user.id, req.params.userId); res.json({ blocked: false }); })
};
