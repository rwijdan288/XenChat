'use strict';

const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/ownerService');

const h = asyncHandler;
module.exports = {
  stats: h(async (req, res) => res.json(await svc.stats())),
  users: h(async (req, res) => res.json(await svc.listUsers(req.query))),
  ban: h(async (req, res) => {
    const user = await svc.setBanned(req.user.id, req.params.id, true);
    const io = req.app.get('io');
    if (io) io.in(`user:${req.params.id}`).disconnectSockets(true); // putuskan sesi realtime yang sedang aktif
    res.json({ user });
  }),
  unban: h(async (req, res) => res.json({ user: await svc.setBanned(req.user.id, req.params.id, false) })),
  verify: h(async (req, res) => res.json({ user: await svc.setVerified(req.user.id, req.params.id, true) })),
  unverify: h(async (req, res) => res.json({ user: await svc.setVerified(req.user.id, req.params.id, false) })),
  reports: h(async (req, res) => res.json(await svc.listReports(req.query))),
  resolve: h(async (req, res) => { await svc.resolveReport(req.user.id, req.params.id, (req.body || {}).note); res.json({ ok: true }); }),
  channels: h(async (req, res) => res.json(await svc.listChannels(req.query))),
  verifyChannel: h(async (req, res) => res.json(await svc.setChannelVerified(req.params.id, true))),
  unverifyChannel: h(async (req, res) => res.json(await svc.setChannelVerified(req.params.id, false)))
};
