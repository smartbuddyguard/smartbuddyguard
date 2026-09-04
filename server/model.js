// Fachlogik: Chats/Nachrichten anlegen und für den Client aufbereiten.
import { db, save, id, findUser, findChat, chatState, privateChatBetween } from './store.js';
import { colorForId } from './auth.js';

export const now = () => Date.now();

/** Öffentliches Nutzerprofil (ohne Passwort-Hash). */
export function publicUser(user, online = false) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    about: user.about || '',
    color: user.color,
    avatar: user.avatar || null,
    lastSeen: user.lastSeen || 0,
    online
  };
}

export function contactName(ownerId, userId) {
  const c = db.contacts.find((x) => x.ownerId === ownerId && x.userId === userId);
  return c?.name || null;
}

export function createUser({ phone, name, hash, salt }) {
  const user = {
    id: id('u_'),
    phone,
    name,
    about: 'Hey! Ich benutze TeleGroove.',
    color: colorForId(phone),
    avatar: null,
    hash,
    salt,
    createdAt: now(),
    lastSeen: now()
  };
  db.users.push(user);
  save();
  return user;
}

export function createPrivateChat(a, b) {
  const existing = privateChatBetween(a, b);
  if (existing) return existing;
  const chat = {
    id: id('c_'),
    type: 'private',
    title: '',
    color: colorForId(a + b),
    avatar: null,
    memberIds: [a, b],
    ownerId: a,
    createdAt: now(),
    lastMessageAt: now()
  };
  db.chats.push(chat);
  save();
  return chat;
}

export function createGroupChat(ownerId, memberIds, title) {
  const members = [...new Set([ownerId, ...memberIds])];
  const chat = {
    id: id('c_'),
    type: 'group',
    title: title.trim() || 'Neue Gruppe',
    color: colorForId(title + ownerId),
    avatar: null,
    memberIds: members,
    ownerId,
    createdAt: now(),
    lastMessageAt: now()
  };
  db.chats.push(chat);
  save();
  return chat;
}

export function addMessage(chat, senderId, data) {
  const msg = {
    id: id('m_'),
    chatId: chat.id,
    senderId,
    text: String(data.text || '').slice(0, 8000),
    ts: now(),
    editedAt: 0,
    deleted: false,
    system: !!data.system,
    replyTo: data.replyTo || null,
    forwardedFrom: data.forwardedFrom || null,
    attachment: data.attachment || null,
    reactions: {},
    readBy: [senderId],
    deliveredTo: [senderId]
  };
  db.messages.push(msg);
  chat.lastMessageAt = msg.ts;
  save();
  return msg;
}

export function systemMessage(chat, text) {
  return addMessage(chat, 'system', { text, system: true });
}

/** Kurzvorschau der zitierten Nachricht, damit der Client nicht nachladen muss. */
function replyPreview(message) {
  if (!message?.replyTo) return null;
  const src = db.messages.find((m) => m.id === message.replyTo);
  if (!src) return null;
  const author = src.senderId === 'system' ? 'System' : (findUser(src.senderId)?.name || 'Unbekannt');
  return { id: src.id, author, text: previewText(src), deleted: src.deleted };
}

export function previewText(message) {
  if (!message) return '';
  if (message.deleted) return 'Diese Nachricht wurde gelöscht';
  if (message.attachment) {
    const labels = { image: '📷 Foto', video: '🎬 Video', voice: '🎤 Sprachnachricht', audio: '🎵 Audio', file: '📎 Datei' };
    const label = labels[message.attachment.kind] || '📎 Anhang';
    return message.text ? `${label} ${message.text}` : label;
  }
  return message.text;
}

export function publicMessage(message) {
  return { ...message, replyPreview: replyPreview(message) };
}

/** Ein Chat, aufbereitet aus Sicht von `userId`. */
export function publicChat(chat, userId, onlineIds = new Set()) {
  const state = chatState(userId, chat.id);
  const messages = db.messages.filter((m) => m.chatId === chat.id);
  const last = messages[messages.length - 1] || null;
  const unread = messages.filter((m) => m.ts > state.lastReadTs && m.senderId !== userId && !m.system).length;

  let peer = null;
  let title = chat.title;
  let color = chat.color;
  let avatar = chat.avatar;
  if (chat.type === 'private') {
    const other = findUser(chat.memberIds.find((x) => x !== userId)) || findUser(userId);
    peer = publicUser(other, onlineIds.has(other?.id));
    title = contactName(userId, other?.id) || other?.name || 'Unbekannt';
    color = other?.color || color;
    avatar = other?.avatar || null;
  }

  return {
    id: chat.id,
    type: chat.type,
    title,
    color,
    avatar,
    memberIds: chat.memberIds,
    ownerId: chat.ownerId,
    createdAt: chat.createdAt,
    lastMessageAt: chat.lastMessageAt,
    peer,
    lastMessage: last ? { ...publicMessage(last), preview: previewText(last) } : null,
    unread,
    pinned: state.pinned,
    muted: state.muted,
    archived: state.archived,
    lastReadTs: state.lastReadTs,
    draft: state.draft || ''
  };
}

export function chatsForUser(userId, onlineIds = new Set()) {
  return db.chats
    .filter((c) => c.memberIds.includes(userId))
    .map((c) => publicChat(c, userId, onlineIds))
    .sort((a, b) => (b.pinned - a.pinned) || (b.lastMessageAt - a.lastMessageAt));
}

/** Alle an einem Chat beteiligten Nutzer (für den Client-Cache). */
export function membersOf(chat, onlineIds = new Set()) {
  return chat.memberIds.map((mid) => publicUser(findUser(mid), onlineIds.has(mid))).filter(Boolean);
}

export function ensureChatAccess(chatId, userId) {
  const chat = findChat(chatId);
  if (!chat || !chat.memberIds.includes(userId)) return null;
  return chat;
}
