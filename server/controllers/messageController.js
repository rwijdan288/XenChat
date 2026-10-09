'use strict';

const asyncHandler = require('../utils/asyncHandler');
const emit = require('../utils/emit');
const msgs = require('../services/messageService');

// REST dipakai sebagai fallback; event realtime tetap dikirim ke kedua peserta.
const edit = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = await msgs.editMessage(req.user.id, req.params.id, body.content);
  emit(req.app.get('io'), r.participants, 'message:edit', { message: r.message, isLast: r.isLast });
  res.json({ message: r.message });
});

const remove = asyncHandler(async (req, res) => {
  const r = await msgs.deleteMessage(req.user.id, req.params.id);
  emit(req.app.get('io'), r.participants, 'message:delete', { message: r.message, isLast: r.isLast });
  res.json({ message: r.message });
});

module.exports = { edit, remove };
