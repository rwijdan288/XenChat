'use strict';

const presence = require('../services/presenceService');

function publicUser(u) {
  if (!u) {
    return { id: '', accountId: '', name: 'Pengguna tidak tersedia', username: '', avatarUrl: '', bio: '', verified: false, online: false, lastSeen: null };
  }
  const id = u._id.toString();
  // Pengguna yang menonaktifkan "status online" tidak menampilkan online/terakhir dilihat ke siapa pun.
  const hidden = !!(u.settings && u.settings.showPresence === false);
  const online = !hidden && presence.isOnline(id);
  return {
    id,
    accountId: u.accountId,
    name: u.name,
    username: u.username,
    avatarUrl: u.avatarUrl || '',
    bio: u.bio || '',
    verified: !!u.verified,
    online,
    lastSeen: online || hidden ? null : u.lastSeen || null
  };
}

const preview = (text) => (text.length > 120 ? text.slice(0, 120) : text);

// Balasan hanya dianggap termuat jika replyTo sudah di-populate.
function messageDTO(m) {
  let replyTo = null;
  if (m.replyTo && m.replyTo.senderId) {
    const r = m.replyTo;
    replyTo = {
      id: r._id.toString(),
      senderId: r.senderId.toString(),
      content: r.deleted ? null : r.content,
      deleted: !!r.deleted
    };
  }
  return {
    id: m._id.toString(),
    conversationId: m.conversationId.toString(),
    senderId: m.senderId.toString(),
    content: m.deleted ? null : m.content,
    type: m.type,
    attachment: m.attachment && m.attachment.url ? { url: m.attachment.url, mime: m.attachment.mime, size: m.attachment.size, name: m.attachment.name, duration: m.attachment.duration || null } : null,
    replyTo,
    edited: !!m.edited,
    deleted: !!m.deleted,
    storyReply: m.storyRef && m.storyRef.storyId ? { id: m.storyRef.storyId.toString(), type: m.storyRef.type, snippet: m.storyRef.snippet || '' } : null,
    reactions: (m.reactions || []).map((r) => ({ userId: r.user.toString(), emoji: r.emoji })),
    status: m.readBy && m.readBy.length ? 'read' : m.deliveredAt ? 'delivered' : 'sent',
    createdAt: m.createdAt,
    updatedAt: m.updatedAt
  };
}

// Private: `otherUser` = lawan bicara. Grup: `group` = dokumen Group (name, avatarUrl, membersCount).
function conversationItem(conv, viewerId, otherUser, group) {
  const lm = conv.lastMessage && conv.lastMessage.messageId ? conv.lastMessage : null;
  const item = {
    id: conv._id.toString(),
    type: conv.type,
    lastMessage: lm
      ? { id: lm.messageId.toString(), senderId: lm.senderId.toString(), senderName: lm.senderName || '', text: lm.text || '', deleted: !!lm.deleted, createdAt: lm.createdAt }
      : null,
    lastMessageAt: conv.lastMessageAt,
    unreadCount: (conv.unread && conv.unread[viewerId]) || 0
  };
  if (conv.type === 'group') {
    item.user = null;
    item.group = group
      ? { id: group._id.toString(), name: group.name, avatarUrl: group.avatarUrl || '', membersCount: group.membersCount }
      : { id: String(conv.groupId), name: 'Grup tidak tersedia', avatarUrl: '', membersCount: 0 };
  } else {
    item.user = publicUser(otherUser);
  }
  return item;
}

module.exports = { publicUser, messageDTO, conversationItem, preview };
