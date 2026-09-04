// WebSocket-Client: verbindet, hält die Verbindung und pflegt den Zustand.
import { getToken } from './api.js';
import {
  state, emit, putChat, putMessage, putUsers, removeChat, setTyping, getMessages
} from './state.js';
import {
  setKeyHooks, unwrapChatKey, wrapChatKeyFor, createChatKey, chatKey, hasKey, publicKey
} from './crypto.js';
import { decorate, redecrypt } from './decrypt.js';

let socket = null;
let retries = 0;
let reconnectTimer = null;
let heartbeat = null;

export function connect() {
  const token = getToken();
  if (!token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  socket.addEventListener('open', () => {
    retries = 0;
    state.connected = true;
    emit('connection', true);
    clearInterval(heartbeat);
    heartbeat = setInterval(() => send({ t: 'ping' }), 25000);
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handle(msg);
  });

  socket.addEventListener('close', (event) => {
    state.connected = false;
    emit('connection', false);
    clearInterval(heartbeat);
    socket = null;
    if (event.code === 4001) { emit('unauthorized'); return; }
    scheduleReconnect();
  });

  socket.addEventListener('error', () => socket?.close());
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * 2 ** retries, 15000);
  retries++;
  reconnectTimer = setTimeout(connect, delay);
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  clearInterval(heartbeat);
  retries = 0;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  state.connected = false;
}

export function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function handle(msg) {
  switch (msg.t) {
    case 'ready': {
      state.me = msg.me;
      putUsers(msg.users);
      for (const chat of msg.chats) putChat(chat);
      emit('me');
      emit('ready');
      for (const chat of msg.chats) ensureKey(chat);
      return;
    }

    case 'message': {
      decorate(msg.chatId, msg.message).then(() => {
        const chat = state.chats.get(msg.chatId);
        const isOwn = msg.message.senderId === state.me?.id;
        // Nur einsortieren, wenn der Verlauf bereits im Speicher liegt.
        if (state.messages.has(msg.chatId) || state.activeChatId === msg.chatId) {
          putMessage(msg.chatId, msg.message, msg.tempId);
        }
        if (chat) {
          const unread = isOwn || state.activeChatId === msg.chatId ? (isOwn ? 0 : chat.unread) : (chat.unread || 0) + 1;
          putChat({
            ...chat,
            lastMessage: msg.message,
            lastMessageAt: msg.message.ts,
            unread: Math.max(0, unread)
          });
        } else {
          emit('chat:unknown', msg.chatId);
        }
        setTyping(msg.chatId, msg.message.senderId, '', false);
        emit('incoming', { chatId: msg.chatId, message: msg.message, own: isOwn });
      });
      return;
    }

    case 'message:update': {
      decorate(msg.chatId, msg.message).then(() => {
        if (state.messages.has(msg.chatId)) putMessage(msg.chatId, msg.message);
        const chat = state.chats.get(msg.chatId);
        if (chat?.lastMessage?.id === msg.message.id) {
          putChat({ ...chat, lastMessage: msg.message });
        }
      });
      return;
    }

    // --- Schlüsseltausch --------------------------------------------------
    case 'key:request': {
      // Wer den Schlüssel hat, packt ihn für die anfragende Person ein.
      if (!hasKey(msg.chatId) || msg.userId === state.me?.id || !msg.pub) return;
      wrapChatKeyFor(msg.chatId, msg.userId, msg.pub).then((box) => {
        if (box) send({ t: 'key:deliver', chatId: msg.chatId, toUserId: msg.userId, box });
      });
      return;
    }

    case 'key:new': {
      adoptKey(msg.chatId, msg.box).then((ok) => { if (ok) redecrypt(msg.chatId); });
      return;
    }

    case 'chat': {
      putChat(msg.chat);
      if (msg.members) putUsers(msg.members);
      ensureKey(msg.chat);
      return;
    }

    case 'call':
      emit('call:signal', msg);
      return;

    case 'chat:removed':
      removeChat(msg.chatId);
      return;

    case 'user':
      putUsers([msg.user]);
      emit('chats');
      return;

    case 'presence': {
      const user = state.users.get(msg.userId);
      if (user) putUsers([{ ...user, online: msg.online, lastSeen: msg.lastSeen }]);
      for (const chat of state.chats.values()) {
        if (chat.peer?.id === msg.userId) {
          putChat({ ...chat, peer: { ...chat.peer, online: msg.online, lastSeen: msg.lastSeen } });
        }
      }
      emit('presence', msg);
      return;
    }

    case 'typing':
      if (msg.userId !== state.me?.id) setTyping(msg.chatId, msg.userId, msg.name, msg.state);
      return;

    case 'delivered': {
      for (const item of msg.messages) {
        const list = getMessages(item.chatId);
        const found = list.find((m) => m.id === item.id);
        if (found && !found.deliveredTo.includes(msg.userId)) {
          putMessage(item.chatId, { ...found, deliveredTo: [...found.deliveredTo, msg.userId] });
        }
        const chat = state.chats.get(item.chatId);
        if (chat?.lastMessage?.id === item.id && !chat.lastMessage.deliveredTo.includes(msg.userId)) {
          putChat({ ...chat, lastMessage: { ...chat.lastMessage, deliveredTo: [...chat.lastMessage.deliveredTo, msg.userId] } });
        }
      }
      return;
    }

    case 'read': {
      // Der Gegenüber hat gelesen: eigene Nachrichten bis `ts` auf „gelesen“ setzen.
      for (const message of getMessages(msg.chatId)) {
        if (message.ts <= msg.ts && !message.readBy.includes(msg.userId)) {
          putMessage(msg.chatId, { ...message, readBy: [...message.readBy, msg.userId] });
        }
      }
      const chat = state.chats.get(msg.chatId);
      if (chat?.lastMessage && chat.lastMessage.ts <= msg.ts && !chat.lastMessage.readBy.includes(msg.userId)) {
        putChat({ ...chat, lastMessage: { ...chat.lastMessage, readBy: [...chat.lastMessage.readBy, msg.userId] } });
      }
      return;
    }

    case 'read:self': {
      // Anderes Gerät desselben Kontos hat gelesen.
      const chat = state.chats.get(msg.chatId);
      if (chat) putChat({ ...chat, unread: 0, lastReadTs: msg.ts });
      return;
    }

    case 'error':
      if (msg.code === 'unauthorized') emit('unauthorized');
      else console.warn('[socket]', msg);
      return;

    case 'pong':
      return;

    default:
      console.debug('[socket] unbekanntes Ereignis', msg);
  }
}

/** Verpackten Chatschlüssel auspacken, wenn der Absender bekannt ist. */
async function adoptKey(chatId, box) {
  if (!box || hasKey(chatId)) return false;
  const sender = state.users.get(box.from);
  if (!sender?.pub) return false;
  return !!(await unwrapChatKey(chatId, box, sender.pub));
}

/** Beim Eintreffen eines Chats: Schlüssel übernehmen, anlegen oder anfragen. */
export async function ensureKey(chat) {
  if (!chat || hasKey(chat.id)) return;
  if (chat.myKey && await adoptKey(chat.id, chat.myKey)) {
    redecrypt(chat.id);
    return;
  }
  // Chat ohne jeden Schlüssel (z. B. serverseitig angelegt): der Ersteller
  // legt ihn an. Nur er, damit nicht zwei Geräte verschiedene Schlüssel bauen.
  if ((chat.keyOwners || []).length === 0 && chat.ownerId === state.me?.id) {
    await provisionChatKey(chat);
    return;
  }
  await chatKey(chat.id);
}

/**
 * Chat neu verschlüsseln. Nötig, wenn niemand mehr an den alten Schlüssel
 * kommt — etwa nach dem Leeren des Browserspeichers. Ältere Nachrichten
 * bleiben mit dem alten Schlüssel verschlüsselt.
 */
export async function rekeyChat(chat) {
  await provisionChatKey(chat, [], { force: true });
}

/** Den vorhandenen Chatschlüssel an weitere Mitglieder weitergeben. */
export async function shareChatKey(chatId, userIds, members = []) {
  if (!hasKey(chatId)) return;
  for (const uid of userIds) {
    const user = state.users.get(uid) || members.find((m) => m.id === uid);
    if (!user?.pub) continue;
    const box = await wrapChatKeyFor(chatId, uid, user.pub);
    if (box) send({ t: 'key:deliver', chatId, toUserId: uid, box });
  }
}

/**
 * Für einen frisch angelegten Chat einen Schlüssel erzeugen und ihn für jedes
 * Mitglied verpacken. Der Server speichert nur die Pakete.
 */
export async function provisionChatKey(chat, members = [], { force = false } = {}) {
  if (!chat || (hasKey(chat.id) && !force)) return;
  await createChatKey(chat.id);
  const ids = new Set([...(chat.memberIds || []), ...members.map((m) => m.id)]);
  for (const uid of ids) {
    const user = state.users.get(uid) || members.find((m) => m.id === uid);
    if (!user?.pub) continue;
    const box = await wrapChatKeyFor(chat.id, uid, user.pub);
    if (box) send({ t: 'key:deliver', chatId: chat.id, toUserId: uid, box });
  }
}

setKeyHooks({
  request: (chatId) => send({ t: 'key:request', chatId })
});

export { publicKey };

// Bequeme Kurzbefehle
export const sendMessage = (payload) => send({ t: 'message:send', ...payload });
export const sendCall = (payload) => send({ t: 'call', ...payload });
export const sendTyping = (chatId, active) => send({ t: 'typing', chatId, state: active });
export const sendRead = (chatId, ts) => send({ t: 'read', chatId, ts });
export const sendEdit = (id, enc) => send({ t: 'message:edit', id, enc });
export const sendDelete = (id) => send({ t: 'message:delete', id });
export const sendReaction = (id, emoji) => send({ t: 'message:react', id, emoji });
export const sendDraft = (chatId, text) => send({ t: 'draft', chatId, text });
