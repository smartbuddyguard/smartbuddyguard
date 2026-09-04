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
    pub: user.pub || null,
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
    about: 'Hey! Ich benutze BuddyChat.',
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

/**
 * Nachrichten werden im Browser verschlüsselt; der Server sieht nur `enc`
 * ({iv, ct}) plus die Metadaten, die er zum Zustellen und Sortieren braucht.
 * Systemmeldungen erzeugt der Server selbst und bleiben deshalb im Klartext.
 */
export function addMessage(chat, senderId, data) {
  const msg = {
    id: id('m_'),
    chatId: chat.id,
    senderId,
    ts: now(),
    editedAt: 0,
    deleted: false,
    system: !!data.system,
    enc: data.enc && data.enc.ct ? { iv: String(data.enc.iv || ''), ct: String(data.enc.ct || '') } : null,
    text: data.system ? String(data.text || '').slice(0, 400) : '',
    call: data.call || null,
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

export const publicMessage = (message) => ({ ...message });

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
    lastMessage: last ? publicMessage(last) : null,
    myKey: (chat.keys || {})[userId] || null,
    keyOwners: Object.keys(chat.keys || {}),
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
