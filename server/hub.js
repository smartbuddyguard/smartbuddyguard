// Echtzeit-Schicht: Präsenz, Zustellung, Tippen, Lesebestätigungen.
import { db, save, findUser, findChat, chatState } from './store.js';
import { userForToken } from './auth.js';
import {
  addMessage, publicMessage, publicChat, chatsForUser, publicUser,
  ensureChatAccess, membersOf, now
} from './model.js';

/** userId -> Set<WebSocketConnection> (ein Nutzer darf mehrere Geräte/Tabs haben). */
const clients = new Map();

export const onlineIds = () => new Set(clients.keys());
export const isOnline = (userId) => clients.has(userId);

function add(userId, conn) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(conn);
}

function remove(userId, conn) {
  const set = clients.get(userId);
  if (!set) return false;
  set.delete(conn);
  if (set.size === 0) { clients.delete(userId); return true; }
  return false;
}

export function sendTo(userId, payload) {
  const set = clients.get(userId);
  if (!set) return;
  for (const conn of set) conn.send(payload);
}

function sendToOthers(userId, exceptConn, payload) {
  const set = clients.get(userId);
  if (!set) return;
  for (const conn of set) if (conn !== exceptConn) conn.send(payload);
}

export function broadcastChat(chat, payload, exceptUserId = null) {
  for (const memberId of chat.memberIds) {
    if (memberId === exceptUserId) continue;
    sendTo(memberId, payload);
  }
}

/** Präsenzwechsel an alle Kontakte melden, die einen gemeinsamen Chat haben. */
function announcePresence(userId, online) {
  const user = findUser(userId);
  if (!user) return;
  const seen = new Set();
  for (const chat of db.chats) {
    if (!chat.memberIds.includes(userId)) continue;
    for (const memberId of chat.memberIds) {
      if (memberId === userId || seen.has(memberId)) continue;
      seen.add(memberId);
      sendTo(memberId, { t: 'presence', userId, online, lastSeen: user.lastSeen });
    }
  }
}

/** Neu eingegangene Nachrichten für einen gerade online gegangenen Nutzer als zugestellt markieren. */
function markDelivered(userId) {
  const byChat = new Map();
  for (const msg of db.messages) {
    if (msg.senderId === userId || msg.system) continue;
    const chat = findChat(msg.chatId);
    if (!chat || !chat.memberIds.includes(userId)) continue;
    if (msg.deliveredTo.includes(userId)) continue;
    msg.deliveredTo.push(userId);
    if (!byChat.has(msg.senderId)) byChat.set(msg.senderId, []);
    byChat.get(msg.senderId).push({ chatId: msg.chatId, id: msg.id });
  }
  if (byChat.size === 0) return;
  save();
  for (const [senderId, items] of byChat) {
    sendTo(senderId, { t: 'delivered', userId, messages: items });
  }
}

export function handleConnection(conn, req) {
  const url = new URL(req.url, 'http://localhost');
  const user = userForToken(url.searchParams.get('token'));
  if (!user) {
    conn.send({ t: 'error', code: 'unauthorized' });
    conn.close(4001, 'unauthorized');
    return;
  }

  const wasOffline = !clients.has(user.id);
  add(user.id, conn);
  if (wasOffline) announcePresence(user.id, true);
  markDelivered(user.id);

  const online = onlineIds();
  conn.send({
    t: 'ready',
    me: publicUser(user, true),
    chats: chatsForUser(user.id, online),
    users: knownUsers(user.id, online)
  });

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handleCommand(user.id, conn, msg); } catch (err) {
      console.error('[hub]', msg?.t, err.message);
      conn.send({ t: 'error', code: 'internal', detail: err.message });
    }
  });

  conn.on('close', () => {
    const last = remove(user.id, conn);
    if (last) {
      const u = findUser(user.id);
      if (u) { u.lastSeen = now(); save(); }
      announcePresence(user.id, false);
    }
  });
}

/** Alle Nutzer, die der Client kennen muss (Chatpartner + Kontakte). */
export function knownUsers(userId, online = onlineIds()) {
  const ids = new Set([userId]);
  for (const chat of db.chats) {
    if (chat.memberIds.includes(userId)) for (const m of chat.memberIds) ids.add(m);
  }
  for (const c of db.contacts) if (c.ownerId === userId) ids.add(c.userId);
  return [...ids].map((uid) => publicUser(findUser(uid), online.has(uid))).filter(Boolean);
}

function handleCommand(userId, conn, msg) {
  switch (msg.t) {
    case 'ping':
      conn.send({ t: 'pong' });
      return;

    case 'message:send': {
      const chat = ensureChatAccess(msg.chatId, userId);
      if (!chat) return;
      const message = addMessage(chat, userId, {
        text: msg.text,
        replyTo: msg.replyTo,
        attachment: msg.attachment,
        forwardedFrom: msg.forwardedFrom
      });
      // Empfänger, die online sind, bekommen die Nachricht sofort zugestellt.
      for (const memberId of chat.memberIds) {
        if (memberId !== userId && isOnline(memberId) && !message.deliveredTo.includes(memberId)) {
          message.deliveredTo.push(memberId);
        }
      }
      const state = chatState(userId, chat.id);
      state.lastReadTs = message.ts;
      state.draft = '';
      save();

      conn.send({ t: 'message', chatId: chat.id, message: publicMessage(message), tempId: msg.tempId });
      sendToOthers(userId, conn, { t: 'message', chatId: chat.id, message: publicMessage(message) });
      for (const memberId of chat.memberIds) {
        if (memberId === userId) continue;
        sendTo(memberId, { t: 'message', chatId: chat.id, message: publicMessage(message) });
      }
      return;
    }

    case 'message:edit': {
      const message = db.messages.find((m) => m.id === msg.id);
      if (!message || message.senderId !== userId || message.deleted) return;
      message.text = String(msg.text || '').slice(0, 8000);
      message.editedAt = now();
      save();
      const chat = findChat(message.chatId);
      broadcastChat(chat, { t: 'message:update', chatId: chat.id, message: publicMessage(message) });
      return;
    }

    case 'message:delete': {
      const message = db.messages.find((m) => m.id === msg.id);
      if (!message) return;
      const chat = findChat(message.chatId);
      if (!chat || !chat.memberIds.includes(userId)) return;
      if (message.senderId !== userId && chat.ownerId !== userId) return;
      message.deleted = true;
      message.text = '';
      message.attachment = null;
      message.reactions = {};
      save();
      broadcastChat(chat, { t: 'message:update', chatId: chat.id, message: publicMessage(message) });
      return;
    }

    case 'message:react': {
      const message = db.messages.find((m) => m.id === msg.id);
      if (!message || message.deleted) return;
      const chat = findChat(message.chatId);
      if (!chat || !chat.memberIds.includes(userId)) return;
      const emoji = String(msg.emoji || '').slice(0, 8);
      if (!emoji) return;
      // Ein Reaktions-Emoji pro Person: alte Reaktion entfernen, neue setzen.
      let had = false;
      for (const [key, list] of Object.entries(message.reactions)) {
        const i = list.indexOf(userId);
        if (i >= 0) {
          list.splice(i, 1);
          if (key === emoji) had = true;
          if (list.length === 0) delete message.reactions[key];
        }
      }
      if (!had) {
        if (!message.reactions[emoji]) message.reactions[emoji] = [];
        message.reactions[emoji].push(userId);
      }
      save();
      broadcastChat(chat, { t: 'message:update', chatId: chat.id, message: publicMessage(message) });
      return;
    }

    case 'typing': {
      const chat = ensureChatAccess(msg.chatId, userId);
      if (!chat) return;
      const user = findUser(userId);
      broadcastChat(chat, {
        t: 'typing', chatId: chat.id, userId, name: user?.name || '', state: !!msg.state
      }, userId);
      return;
    }

    case 'read': {
      const chat = ensureChatAccess(msg.chatId, userId);
      if (!chat) return;
      const state = chatState(userId, chat.id);
      const ts = msg.ts || now();
      if (ts <= state.lastReadTs) return;
      state.lastReadTs = ts;
      const senders = new Set();
      for (const message of db.messages) {
        if (message.chatId !== chat.id || message.ts > ts) continue;
        if (!message.readBy.includes(userId)) {
          message.readBy.push(userId);
          senders.add(message.senderId);
        }
      }
      save();
      sendToOthers(userId, conn, { t: 'read:self', chatId: chat.id, ts });
      for (const senderId of senders) {
        if (senderId === userId || senderId === 'system') continue;
        sendTo(senderId, { t: 'read', chatId: chat.id, userId, ts });
      }
      return;
    }

    case 'draft': {
      const chat = ensureChatAccess(msg.chatId, userId);
      if (!chat) return;
      chatState(userId, chat.id).draft = String(msg.text || '').slice(0, 2000);
      save();
      return;
    }

    default:
      conn.send({ t: 'error', code: 'unknown_command', detail: msg.t });
  }
}

/** Ein neu angelegter oder geänderter Chat wird allen Mitgliedern gepusht. */
export function pushChat(chat) {
  const online = onlineIds();
  for (const memberId of chat.memberIds) {
    sendTo(memberId, { t: 'chat', chat: publicChat(chat, memberId, online), members: membersOf(chat, online) });
  }
}

/** Keepalive: tote Verbindungen aufräumen. */
export function startHeartbeat(intervalMs = 30000) {
  return setInterval(() => {
    for (const set of clients.values()) {
      for (const conn of set) {
        if (!conn.isAlive) { conn.close(1001, 'timeout'); continue; }
        conn.ping();
      }
    }
  }, intervalMs).unref?.();
}
