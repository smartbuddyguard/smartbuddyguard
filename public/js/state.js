// Zentraler Zustand plus winziger Event-Bus.
const listeners = new Map();

function announce(chatId, payload) {
  emit('messages:' + chatId, payload);
  emit('message-event', { chatId, payload });
}

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try { handler(payload); } catch (err) { console.error('[event]', event, err); }
  }
}

export const state = {
  me: null,
  users: new Map(),        // userId -> Nutzer
  chats: new Map(),        // chatId -> Chat
  messages: new Map(),     // chatId -> Nachrichten (chronologisch)
  fullyLoaded: new Set(),  // Chats, deren Verlauf komplett geladen ist
  typing: new Map(),       // chatId -> Map(userId -> {name, timer})
  activeChatId: null,
  filter: 'all',
  replyTo: null,
  editing: null,
  connected: false
};

export const getUser = (userId) => state.users.get(userId) || null;
export const getChat = (chatId) => state.chats.get(chatId) || null;
export const getMessages = (chatId) => state.messages.get(chatId) || [];

export function putUsers(users = []) {
  for (const user of users) if (user?.id) state.users.set(user.id, { ...state.users.get(user.id), ...user });
  emit('users');
}

export function putChat(chat) {
  if (!chat?.id) return;
  const previous = state.chats.get(chat.id);
  state.chats.set(chat.id, { ...previous, ...chat });
  emit('chats');
  emit('chat:' + chat.id);
}

export function removeChat(chatId) {
  state.chats.delete(chatId);
  state.messages.delete(chatId);
  state.fullyLoaded.delete(chatId);
  if (state.activeChatId === chatId) state.activeChatId = null;
  emit('chats');
  emit('active');
}

/** Nachricht einsortieren oder ersetzen; hält die Liste chronologisch. */
export function putMessage(chatId, message, tempId = null) {
  if (!state.messages.has(chatId)) state.messages.set(chatId, []);
  const list = state.messages.get(chatId);

  if (tempId) {
    const pending = list.findIndex((m) => m.id === tempId);
    if (pending >= 0) {
      list[pending] = message;
      announce(chatId, { type: 'replace', message, tempId });
      return message;
    }
  }
  const existing = list.findIndex((m) => m.id === message.id);
  if (existing >= 0) {
    list[existing] = { ...list[existing], ...message };
    announce(chatId, { type: 'update', message: list[existing] });
    return list[existing];
  }
  let i = list.length;
  while (i > 0 && list[i - 1].ts > message.ts) i--;
  list.splice(i, 0, message);
  announce(chatId, { type: 'add', message, index: i });
  return message;
}

export function setMessages(chatId, messages, { prepend = false } = {}) {
  const current = state.messages.get(chatId) || [];
  const merged = prepend ? [...messages, ...current.filter((m) => !messages.some((x) => x.id === m.id))] : messages;
  merged.sort((a, b) => a.ts - b.ts);
  state.messages.set(chatId, merged);
  announce(chatId, { type: 'reset' });
}

export function setTyping(chatId, userId, name, active) {
  if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
  const map = state.typing.get(chatId);
  const existing = map.get(userId);
  if (existing) clearTimeout(existing.timer);
  if (!active) {
    map.delete(userId);
  } else {
    map.set(userId, {
      name,
      timer: setTimeout(() => { map.delete(userId); emit('typing', chatId); emit('chats'); }, 5000)
    });
  }
  emit('typing', chatId);
  emit('chats');
}

export const typingNames = (chatId) => [...(state.typing.get(chatId)?.values() || [])].map((x) => x.name);

/** Chats gefiltert und sortiert für die Seitenleiste. */
export function visibleChats() {
  let chats = [...state.chats.values()];
  if (state.filter === 'archived') chats = chats.filter((c) => c.archived);
  else chats = chats.filter((c) => !c.archived);
  if (state.filter === 'unread') chats = chats.filter((c) => c.unread > 0);
  if (state.filter === 'groups') chats = chats.filter((c) => c.type === 'group');
  return chats.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.lastMessageAt - a.lastMessageAt));
}

export const totalUnread = () => [...state.chats.values()]
  .filter((c) => !c.archived && !c.muted)
  .reduce((sum, c) => sum + (c.unread || 0), 0);
