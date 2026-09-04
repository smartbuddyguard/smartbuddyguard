// Seitenleiste: Chatliste, Filter-Tabs, Suche und Chat-Kontextmenü.
import { $, el, svg, ICONS, avatarEl, listTime, escapeHtml, highlight, debounce, toast } from './util.js';
import { state, visibleChats, getUser, on, typingNames, putChat, putUsers, removeChat } from './state.js';
import { api } from './api.js';
import { openMenu, confirmDialog } from './ui.js';
import { openChat, closeChat } from './chat.js';
import { previewOf } from './decrypt.js';
import { provisionChatKey } from './socket.js';

const list = () => $('#chatList');
const results = () => $('#searchResults');

/** Häkchen-Symbol: gesendet / zugestellt / gelesen. */
export function statusCheck(message, chat) {
  if (!message || message.senderId !== state.me?.id || message.system) return '';
  const others = (chat?.memberIds || []).filter((id) => id !== state.me.id);
  const readByAll = others.length > 0 && others.every((id) => message.readBy.includes(id));
  const deliveredToAll = others.length > 0 && others.every((id) => message.deliveredTo.includes(id));
  if (readByAll) return `<svg class="msg-check read" viewBox="0 0 20 16"><path d="M1 8.5l3.6 3.6L11 5"/><path d="M8.4 12.1L14.8 5"/></svg>`;
  if (deliveredToAll) return `<svg class="msg-check" viewBox="0 0 20 16"><path d="M1 8.5l3.6 3.6L11 5"/><path d="M8.4 12.1L14.8 5"/></svg>`;
  return `<svg class="msg-check" viewBox="0 0 20 16"><path d="M4 8.5l3.6 3.6L14.5 5"/></svg>`;
}

function previewLine(chat) {
  const typing = typingNames(chat.id);
  if (typing.length) {
    const label = chat.type === 'group'
      ? `${typing[0]} tippt${typing.length > 1 ? ' …' : ' …'}`
      : 'tippt …';
    return `<span class="typing">${escapeHtml(label)}</span>`;
  }
  if (chat.draft) return `<span class="draft">Entwurf:</span> <span class="text">${escapeHtml(chat.draft)}</span>`;
  const message = chat.lastMessage;
  if (!message) return '<span class="text" style="opacity:.7">Noch keine Nachrichten</span>';
  const text = previewOf(message);
  if (message.system) return `<span class="text" style="opacity:.8">${escapeHtml(text)}</span>`;
  let prefix = '';
  if (chat.type === 'group' && message.senderId !== state.me?.id) {
    const name = getUser(message.senderId)?.name;
    if (name) prefix = `<b>${escapeHtml(name.split(' ')[0])}:</b> `;
  } else if (message.senderId === state.me?.id) {
    prefix = statusCheck(message, chat);
  }
  return `${prefix}<span class="text">${escapeHtml(text)}</span>`;
}

function chatItem(chat) {
  const flags = [];
  if (chat.pinned) flags.push(svg(ICONS.pin, 16));
  if (chat.muted) flags.push(svg(ICONS.mute, 16));

  const node = el('div', {
    class: `chat-item${chat.id === state.activeChatId ? ' active' : ''}`,
    dataset: { chatId: chat.id },
    onclick: () => openChat(chat.id),
    oncontextmenu: (event) => { event.preventDefault(); chatMenu(event, chat); }
  }, [
    avatarEl({ ...chat, online: chat.peer?.online }),
    el('div', { class: 'chat-item-body' }, [
      el('div', { class: 'chat-item-row' }, [
        el('div', { class: 'chat-name', text: chat.title }),
        el('div', { class: 'chat-time', text: listTime(chat.lastMessageAt) })
      ]),
      el('div', { class: 'chat-item-row' }, [
        el('div', { class: 'chat-preview', html: previewLine(chat) }),
        chat.unread > 0
          ? el('span', { class: `chat-badge${chat.muted ? ' muted' : ''}`, text: chat.unread > 99 ? '99+' : String(chat.unread) })
          : (flags.length ? el('span', { class: 'chat-flags', html: flags.join('') }) : null)
      ])
    ])
  ]);
  return node;
}

export function renderChatList() {
  const chats = visibleChats();
  const container = list();
  if (!container) return;
  if (chats.length === 0) {
    const messages = {
      unread: 'Alles gelesen. 🎉',
      groups: 'Noch keine Gruppen. Leg über das Menü eine an.',
      archived: 'Das Archiv ist leer.',
      all: 'Noch keine Chats. Tippe unten rechts auf den Stift, um zu starten.'
    };
    container.replaceChildren(el('div', { class: 'list-empty', text: messages[state.filter] }));
  } else {
    container.replaceChildren(...chats.map(chatItem));
  }
  renderTabCounts();
}

function renderTabCounts() {
  const unread = [...state.chats.values()].filter((c) => !c.archived && c.unread > 0).length;
  const archived = [...state.chats.values()].filter((c) => c.archived).length;
  const counts = { unread, archived };
  for (const tab of $('#sidebarTabs').children) {
    const key = tab.dataset.filter;
    tab.querySelector('.count')?.remove();
    if (counts[key]) tab.append(el('span', { class: 'count', text: String(counts[key]) }));
  }
}

/* ------------------------------ Kontextmenü ----------------------------- */
function chatMenu(event, chat) {
  openMenu(event.clientX, event.clientY, [
    {
      label: chat.pinned ? 'Nicht mehr anheften' : 'Anheften',
      icon: ICONS.pin,
      onClick: () => patch(chat, { pinned: !chat.pinned })
    },
    {
      label: chat.muted ? 'Stummschaltung aufheben' : 'Stummschalten',
      icon: chat.muted ? ICONS.sound : ICONS.mute,
      onClick: () => patch(chat, { muted: !chat.muted })
    },
    {
      label: chat.archived ? 'Aus dem Archiv holen' : 'Archivieren',
      icon: ICONS.archive,
      onClick: () => patch(chat, { archived: !chat.archived })
    },
    'sep',
    {
      label: chat.type === 'group' ? 'Gruppe verlassen' : 'Chat löschen',
      icon: ICONS.trash,
      danger: true,
      onClick: () => confirmDialog({
        title: chat.type === 'group' ? 'Gruppe verlassen?' : 'Chat löschen?',
        text: chat.type === 'group'
          ? `Du verlässt „${chat.title}“ und siehst keine neuen Nachrichten mehr.`
          : `Der Chat mit ${chat.title} wird für beide Seiten gelöscht.`,
        confirmLabel: chat.type === 'group' ? 'Verlassen' : 'Löschen',
        danger: true,
        onConfirm: async () => {
          try {
            await api.deleteChat(chat.id);
            removeChat(chat.id);
            closeChat();
          } catch (err) { toast(err.message, 'error'); }
        }
      })
    }
  ]);
}

async function patch(chat, changes) {
  putChat({ ...chat, ...changes });
  try {
    await api.updateChat(chat.id, changes);
  } catch (err) {
    putChat(chat);
    toast(err.message, 'error');
  }
}

/* --------------------------------- Suche -------------------------------- */
let searchQuery = '';

function resultItem({ avatar, title, sub, onClick }) {
  return el('div', { class: 'result-item', onclick: onClick }, [
    avatar,
    el('div', { class: 'result-body' }, [
      el('div', { class: 'result-title', html: title }),
      el('div', { class: 'result-sub', html: sub || '' })
    ])
  ]);
}

const runSearch = debounce(async (query) => {
  if (query !== searchQuery) return;
  const box = results();
  const nodes = [];

  const chats = [...state.chats.values()].filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  if (chats.length) {
    nodes.push(el('div', { class: 'list-section', text: 'Chats' }));
    for (const chat of chats.slice(0, 8)) {
      nodes.push(resultItem({
        avatar: avatarEl({ ...chat, online: chat.peer?.online }, 'avatar-sm'),
        title: highlight(chat.title, query),
        sub: chat.type === 'group' ? `${chat.memberIds.length} Mitglieder` : chat.peer?.phone || '',
        onClick: () => { clearSearch(); openChat(chat.id); }
      }));
    }
  }

  try {
    const { users } = await api.searchUsers(query);
    const fresh = users.filter((u) => ![...state.chats.values()].some((c) => c.peer?.id === u.id));
    if (fresh.length) {
      nodes.push(el('div', { class: 'list-section', text: 'Weitere Nutzer' }));
      for (const user of fresh.slice(0, 10)) {
        nodes.push(resultItem({
          avatar: avatarEl(user, 'avatar-sm'),
          title: highlight(user.contactName || user.name, query),
          sub: highlight(user.phone, query),
          onClick: async () => {
            try {
              const { chat, members } = await api.createChat({ userId: user.id });
              putUsers(members);
              putChat(chat);
              await provisionChatKey(chat, members);
              clearSearch();
              openChat(chat.id);
            } catch (err) { toast(err.message, 'error'); }
          }
        }));
      }
    }
  } catch { /* Suche ist nicht kritisch */ }

  if (query.length >= 2) {
    // Der Server kennt die Inhalte nicht — gesucht wird in den bereits
    // entschlüsselten Nachrichten dieses Geräts.
    const hits = [];
    for (const [chatId, messages] of state.messages) {
      const chat = state.chats.get(chatId);
      if (!chat) continue;
      for (const message of messages) {
        const text = message.body?.t;
        if (!text || message.deleted) continue;
        if (!text.toLowerCase().includes(query.toLowerCase())) continue;
        hits.push({ chat, message, text });
      }
    }
    if (hits.length) {
      nodes.push(el('div', { class: 'list-section', text: 'Nachrichten' }));
      for (const hit of hits.slice(-20).reverse()) {
        const who = hit.message.senderId === state.me?.id
          ? 'Du' : (getUser(hit.message.senderId)?.name || 'Unbekannt');
        nodes.push(resultItem({
          avatar: avatarEl({ ...hit.chat, online: hit.chat.peer?.online }, 'avatar-sm'),
          title: escapeHtml(hit.chat.title),
          sub: `${escapeHtml(who)}: ${highlight(hit.text, query)}`,
          onClick: () => { clearSearch(); openChat(hit.chat.id, { focusMessageId: hit.message.id }); }
        }));
      }
    }
  }

  if (nodes.length === 0) nodes.push(el('div', { class: 'list-empty', text: `Nichts gefunden für „${query}“.` }));
  box.replaceChildren(...nodes);
}, 220);

export function clearSearch() {
  searchQuery = '';
  $('#searchInput').value = '';
  results().hidden = true;
  results().replaceChildren();
  list().hidden = false;
  $('#sidebarTabs').hidden = false;
  $('#searchBackBtn').hidden = true;
  $('#menuBtn').hidden = false;
}

export function initSidebar() {
  $('#searchInput').addEventListener('input', (event) => {
    searchQuery = event.target.value.trim();
    if (!searchQuery) { clearSearch(); return; }
    results().hidden = false;
    list().hidden = true;
    $('#sidebarTabs').hidden = true;
    $('#searchBackBtn').hidden = false;
    $('#menuBtn').hidden = true;
    results().replaceChildren(el('div', { class: 'list-empty', text: 'Suche …' }));
    runSearch(searchQuery);
  });

  $('#searchBackBtn').addEventListener('click', clearSearch);

  $('#sidebarTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    state.filter = tab.dataset.filter;
    for (const other of $('#sidebarTabs').children) other.classList.toggle('active', other === tab);
    renderChatList();
  });

  on('chats', renderChatList);
  on('users', renderChatList);
  on('active', renderChatList);
}
