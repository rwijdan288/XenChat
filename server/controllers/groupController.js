'use strict';

const asyncHandler = require('../utils/asyncHandler');
const emit = require('../utils/emit');
const svc = require('../services/groupService');

const io = (req) => req.app.get('io');
const room = (cid) => `conversation:${cid}`;

const create = asyncHandler(async (req, res) => {
  const r = await svc.createGroup(req.user.id, req.body || {});
  emit(io(req), [req.user.id], 'group:create', { conversation: r.conversation });
  res.status(201).json(r);
});

const get = asyncHandler(async (req, res) => {
  res.json({ group: await svc.getGroup(req.user.id, req.params.id) });
});

const update = asyncHandler(async (req, res) => {
  const r = await svc.updateGroup(req.user.id, req.params.id, req.body || {});
  emit(io(req), r.memberIds, 'group:update', { group: r.dto });
  res.json({ group: r.dto });
});

const remove = asyncHandler(async (req, res) => {
  const r = await svc.deleteGroup(req.user.id, req.params.id);
  emit(io(req), r.memberIds, 'group:delete', { groupId: req.params.id, conversationId: r.conversationId });
  if (io(req)) io(req).socketsLeave(room(r.conversationId));
  res.json({ ok: true });
});

const members = asyncHandler(async (req, res) => {
  res.json(await svc.listMembers(req.user.id, req.params.id, req.query));
});

const addMember = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = await svc.addMember(req.user.id, req.params.id, body.userId);
  const base = { groupId: req.params.id, user: r.user, membersCount: r.membersCount };
  emit(io(req), [r.targetId], 'group:member:add', { ...base, conversation: r.conversation });
  emit(io(req), r.memberIds.filter((id) => id !== r.targetId), 'group:member:add', base);
  res.status(201).json({ user: r.user, membersCount: r.membersCount });
});

const removeMember = asyncHandler(async (req, res) => {
  const r = await svc.removeMember(req.user.id, req.params.id, req.params.userId);
  const payload = { groupId: req.params.id, userId: req.params.userId, membersCount: r.membersCount };
  // Yang dikeluarkan ikut menerima event, lalu dikeluarkan dari room percakapan.
  emit(io(req), [...r.memberIds, req.params.userId], 'group:member:remove', payload);
  emit.leaveRoom(io(req), req.params.userId, room(r.conversationId));
  res.json({ membersCount: r.membersCount });
});

const role = (makeAdmin) => asyncHandler(async (req, res) => {
  const r = await svc.setAdmin(req.user.id, req.params.id, req.params.userId, makeAdmin);
  emit(io(req), r.memberIds, 'group:member:role', { groupId: req.params.id, userId: req.params.userId, role: r.role });
  res.json({ role: r.role });
});

const transfer = asyncHandler(async (req, res) => {
  const r = await svc.transferOwner(req.user.id, req.params.id, req.params.userId);
  emit(io(req), r.memberIds, 'group:member:role', { groupId: req.params.id, userId: req.params.userId, role: 'owner' });
  emit(io(req), r.memberIds, 'group:member:role', { groupId: req.params.id, userId: req.user.id, role: 'admin' });
  res.json({ ok: true });
});

const leave = asyncHandler(async (req, res) => {
  const r = await svc.leaveGroup(req.user.id, req.params.id);
  emit(io(req), [req.user.id], 'group:leave', { groupId: req.params.id, conversationId: r.conversationId });
  emit(io(req), r.memberIds, 'group:member:remove', { groupId: req.params.id, userId: req.user.id, membersCount: r.membersCount });
  emit.leaveRoom(io(req), req.user.id, room(r.conversationId));
  res.json({ ok: true });
});

const mute = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const duration = typeof body.duration === 'string' ? body.duration : body.muted === true ? 'always' : 'off';
  res.json(await svc.setMuted(req.user.id, req.params.id, duration));
});

const getInvite = asyncHandler(async (req, res) => res.json(await svc.getInvite(req.user.id, req.params.id)));
const createInvite = asyncHandler(async (req, res) => res.status(201).json(await svc.createInvite(req.user.id, req.params.id)));
const revokeInvite = asyncHandler(async (req, res) => { await svc.revokeInvite(req.user.id, req.params.id); res.json({ ok: true }); });
const preview = asyncHandler(async (req, res) => res.json(await svc.previewInvite(req.user.id, req.params.token)));

const join = asyncHandler(async (req, res) => {
  const r = await svc.joinByToken(req.user.id, req.params.token);
  const gid = r.group._id.toString();
  if (!r.already) {
    const user = { id: r.user.id, name: r.user.name, username: r.user.username, avatarUrl: r.user.avatarUrl };
    emit(io(req), [req.user.id], 'group:member:add', { groupId: gid, user, membersCount: r.group.membersCount, conversation: r.conversation });
    emit(io(req), r.memberIds.filter((id) => id !== req.user.id), 'group:member:add', { groupId: gid, user, membersCount: r.group.membersCount });
  }
  res.json({ groupId: gid, already: r.already });
});

module.exports = { getInvite, createInvite, revokeInvite, preview, join, create, get, update, remove, members, addMember, removeMember, promote: role(true), demote: role(false), transfer, leave, mute };
