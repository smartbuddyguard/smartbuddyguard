// Chatfenster: Kopfzeile, Nachrichtenliste, Statusanzeigen und Nachrichten-Aktionen.
import {
  $, el, svg, ICONS, avatarEl, timeOf, dayKey, dayLabel, lastSeenLabel,
  richText, fileSize, duration, isEmojiOnly, toast
} from './util.js';
import {
  state, on, emit, getChat, getUser, getMessages, setMessages, putChat, putUsers, typingNames
} from './state.js';
import { api } from './api.js';
import { sendRead, sendReaction, sendDelete } from './socket.js';
import { openMenu, closeModal, confirmDialog, openModal, openLightbox } from './ui.js';
import { openReactionBar } from './emoji.js';
import { statusCheck } from './chatlist.js';
import { setComposerChat, focusComposer, startReply, startEdit } from './composer.js';
import { openChatInfo, closeInfo } from './info.js';

const GROUP_WINDOW = 5 * 60 * 1000; // Nachrichten innerhalb von 5 Minuten werden gebündelt
const rows = new Map();             // messageId -> DOM-Knoten

let loadingHistory = false;
let searchTerm = '';

/* ------------------------------ Chat öffnen ----------------------------- */
export async function openChat(chatId, { focusMessageId = null } = {}) {
  const chat = getChat(chatId);
  if (!chat) return;

  state.activeChatId = chatId;
  document.querySelector('.app').classList.add('chat-open');
  $('#chatEmpty').hidden = true;
  $('#chatView').hidden = false;
  closeInfo();
  emit('active');

  renderHeader();
  setComposerChat(chat);

  if (!state.messages.has(chatId)) {
    $('#messages').replaceChildren(el('div', { class: 'list-empty', text: 'Lade Nachrichten …' }));
    try {
      const data = await api.messages(chatId, { limit: 80 });
      if (state.activeChatId !== chatId) return;
      setMessages(chatId, data.messages);
      if (!data.hasMore) state.fullyLoaded.add(chatId);
      putUsers(data.members);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }

  renderMessages();
  if (focusMessageId) jumpTo(focusMessageId);
  else scrollToBottom(false);
  markRead();
  if (window.innerWidth > 720) focusComposer();
}

export function closeChat() {
  state.activeChatId = null;
  document.querySelector('.app').classList.remove('chat-open');
  $('#chatView').hidden = true;
  $('#chatEmpty').hidden = false;
  closeInfo();
  emit('active');
}

/* ------------------------------- Kopfzeile ------------------------------ */
export function renderHeader() {
  const chat = getChat(state.activeChatId);
  if (!chat) return;
  const avatar = $('#headAvatar');
  avatar.replaceWith(Object.assign(avatarEl({ ...chat, online: chat.peer?.online }), { id: 'headAvatar' }));
  $('#headTitle').textContent = chat.title;

  const status = $('#headStatus');
  const typing = typingNames(chat.id);
  if (typing.length) {
    status.textContent = chat.type === 'group' ? `${typing.join(', ')} tippt …` : 'tippt …';
    status.classList.add('online');
    return;
  }
  if (chat.type === 'group') {
    const onlineCount = chat.memberIds.filter((id) => getUser(id)?.online).length;
    status.textContent = `${chat.memberIds.length} Mitglieder` + (onlineCount > 1 ? `, ${onlineCount} online` : '');
    status.classList.remove('online');
  } else {
    const peer = getUser(chat.peer?.id) || chat.peer;
    status.textContent = lastSeenLabel(peer);
    status.classList.toggle('online', !!peer?.online);
  }
}

/* ----------------------------- Nachrichten ------------------------------ */
function isGrouped(previous, message) {
  return !!previous && !!message
    && !previous.system && !message.system
    && previous.senderId === message.senderId
    && message.ts - previous.ts < GROUP_WINDOW;
}

function attachmentNode(message) {
  const a = message.attachment;
  if (!a) return null;

  if (a.kind === 'image') {
    return el('img', {
      class: 'msg-image', src: a.url, alt: a.name || 'Bild', loading: 'lazy',
      onclick: () => openLightbox(a.url, a.name)
    });
  }
  if (a.kind === 'video') {
    return el('video', { class: 'msg-video', src: a.url, controls: true, preload: 'metadata' });
  }
  if (a.kind === 'voice') return voiceNode(a);
  if (a.kind === 'audio') {
    return el('audio', { src: a.url, controls: true, style: 'width:260px;max-width:100%;margin:2px 0' });
  }
  return el('a', {
    class: 'msg-file', href: a.url, download: a.name, target: '_blank', rel: 'noopener'
  }, [
    el('span', { class: 'file-icon', html: svg(ICONS.file, 22) }),
    el('span', {}, [
      el('div', { class: 'file-name', text: a.name || 'Datei' }),
      el('div', { class: 'file-size', text: fileSize(a.size) })
    ])
  ]);
}

/** Sprachnachricht mit selbstgebautem Player und Balkenanzeige. */
function voiceNode(attachment) {
  const audio = new Audio(attachment.url);
  audio.preload = 'metadata';

  const bars = (attachment.peaks || defaultPeaks(attachment.url)).map((height) =>
    el('i', { style: `height:${Math.max(3, Math.round(height * 22))}px` })
  );
  const wave = el('div', { class: 'voice-wave' }, bars);
  const time = el('div', { class: 'voice-time', text: duration(attachment.duration) });
  const button = el('button', { type: 'button', class: 'voice-play', html: svg(ICONS.play, 20) });

  const paint = () => {
    const total = audio.duration || attachment.duration || 1;
    const ratio = audio.currentTime / total;
    bars.forEach((bar, i) => bar.classList.toggle('on', i / bars.length <= ratio));
  };

  button.addEventListener('click', () => {
    if (audio.paused) {
      for (const other of document.querySelectorAll('audio')) other.pause();
      audio.play();
    } else audio.pause();
  });
  audio.addEventListener('play', () => { button.innerHTML = svg(ICONS.pause, 20); });
  audio.addEventListener('pause', () => { button.innerHTML = svg(ICONS.play, 20); });
  audio.addEventListener('timeupdate', () => {
    time.textContent = duration(audio.currentTime);
    paint();
  });
  audio.addEventListener('ended', () => {
    time.textContent = duration(attachment.duration);
    bars.forEach((bar) => bar.classList.remove('on'));
  });
  wave.addEventListener('click', (event) => {
    const rect = wave.getBoundingClientRect();
    const total = audio.duration || attachment.duration || 0;
    if (total) { audio.currentTime = ((event.clientX - rect.left) / rect.width) * total; paint(); }
  });

  return el('div', { class: 'msg-voice' }, [button, el('div', { class: 'voice-body' }, [wave, time])]);
}

/** Reproduzierbares Pseudo-Wellenbild, wenn keine echten Pegel vorliegen. */
function defaultPeaks(seed = '') {
  let value = 0;
  for (const ch of seed) value = (value * 31 + ch.charCodeAt(0)) % 100000;
  const peaks = [];
  for (let i = 0; i < 32; i++) {
    value = (value * 1103515245 + 12345) % 2147483648;
    peaks.push(0.25 + ((value >> 8) % 100) / 133);
  }
  return peaks;
}

function reactionsNode(message) {
  const entries = Object.entries(message.reactions || {});
  if (entries.length === 0) return null;
  return el('div', { class: 'reactions' }, entries.map(([emoji, users]) =>
    el('button', {
      type: 'button',
      class: `reaction${users.includes(state.me?.id) ? ' mine' : ''}`,
      title: users.map((id) => getUser(id)?.name || '?').join(', '),
      onclick: () => sendReaction(message.id, emoji)
    }, [el('span', { class: 'emo', text: emoji }), String(users.length)])
  ));
}

function metaNode(message, chat) {
  const parts = [];
  if (message.editedAt) parts.push(el('span', { text: 'bearb.' }));
  parts.push(el('span', { text: timeOf(message.ts) }));
  const meta = el('div', { class: 'meta' }, parts);
  if (message.pending) meta.insertAdjacentHTML('beforeend', `<svg class="msg-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`);
  else meta.insertAdjacentHTML('beforeend', statusCheck(message, chat));
  return meta;
}

function messageRow(message, previous, next, chat) {
  if (message.system) {
    return el('div', { class: 'system-msg', dataset: { id: message.id } }, [el('span', { text: message.text })]);
  }

  const own = message.senderId === state.me?.id;
  const grouped = isGrouped(previous, message);
  const tail = !isGrouped(message, next);
  const sender = getUser(message.senderId);
  const onlyMedia = !!message.attachment
    && ['image', 'video'].includes(message.attachment.kind)
    && !message.text;

  const bubble = el('div', {
    class: [
      'bubble', own ? 'out' : 'in',
      tail ? 'tail' : '',
      message.attachment ? 'media' : '',
      onlyMedia ? 'only-media' : '',
      message.deleted ? 'deleted' : ''
    ].filter(Boolean).join(' ')
  });

  if (!own && chat.type === 'group' && !grouped && !message.deleted) {
    bubble.append(el('div', { class: 'sender', style: `color:${sender?.color || 'var(--accent)'}`, text: sender?.name || 'Unbekannt' }));
  }
  if (message.forwardedFrom) {
    bubble.append(el('div', { class: 'forwarded', text: `Weitergeleitet von ${message.forwardedFrom}` }));
  }
  if (message.replyPreview) {
    const quote = message.replyPreview;
    bubble.append(el('div', {
      class: 'reply-quote',
      onclick: () => jumpTo(quote.id)
    }, [
      el('div', { class: 'q-author', text: quote.author }),
      el('div', { class: 'q-text', text: quote.deleted ? 'Gelöschte Nachricht' : quote.text })
    ]));
  }

  if (message.deleted) {
    bubble.append(el('div', { class: 'text', text: 'Diese Nachricht wurde gelöscht' }));
  } else {
    const media = attachmentNode(message);
    if (media) bubble.append(media);
    if (message.text) {
      const cls = `text${isEmojiOnly(message.text) && !message.attachment ? ' emoji-only' : ''}`;
      bubble.append(el('div', { class: cls, html: searchTerm ? highlightIn(message.text) : richText(message.text) }));
    }
  }

  bubble.append(metaNode(message, chat));
  const reactions = reactionsNode(message);
  if (reactions) bubble.append(reactions);

  const actions = el('div', { class: 'msg-actions' }, message.deleted ? [] : [
    el('button', { class: 'icon-btn', title: 'Antworten', html: svg(ICONS.reply, 17), onclick: () => startReply(message) }),
    el('button', {
      class: 'icon-btn', title: 'Reagieren', html: svg(ICONS.smile, 17),
      onclick: (event) => openReactionBar(event.currentTarget, (emoji) => sendReaction(message.id, emoji))
    }),
    el('button', {
      class: 'icon-btn', title: 'Mehr', html: svg(ICONS.more, 17),
      onclick: (event) => messageMenu(event, message, chat)
    })
  ]);

  const showAvatar = !own && chat.type === 'group';
  const row = el('div', {
    class: `row ${own ? 'out' : 'in'}${tail ? ' tail-row' : ' grouped'}`,
    dataset: { id: message.id, ts: String(message.ts) },
    oncontextmenu: (event) => { event.preventDefault(); messageMenu(event, message, chat); }
  }, [
    showAvatar ? el('div', { class: 'row-avatar' }, [tail ? avatarEl(sender || { name: '?' }) : '']) : null,
    bubble,
    actions
  ]);
  return row;
}

function highlightIn(text) {
  const safe = richText(text);
  if (!searchTerm) return safe;
  const re = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

export function renderMessages() {
  const chat = getChat(state.activeChatId);
  const box = $('#messages');
  if (!chat) return;
  const messages = getMessages(chat.id);
  rows.clear();

  if (messages.length === 0) {
    box.replaceChildren(el('div', { class: 'list-empty', text: 'Noch keine Nachrichten. Schreib die erste!' }));
    return;
  }

  const nodes = [];
  if (!state.fullyLoaded.has(chat.id)) {
    nodes.push(el('div', { class: 'list-empty' }, [
      el('button', { class: 'btn-text', text: 'Ältere Nachrichten laden', onclick: loadOlder })
    ]));
  }
  let lastDay = null;
  messages.forEach((message, i) => {
    const key = dayKey(message.ts);
    if (key !== lastDay) {
      lastDay = key;
      nodes.push(el('div', { class: 'day-sep' }, [el('span', { text: dayLabel(message.ts) })]));
    }
    const row = messageRow(message, messages[i - 1], messages[i + 1], chat);
    rows.set(message.id, row);
    nodes.push(row);
  });
  nodes.push(typingRow(chat));
  box.replaceChildren(...nodes);
}

function typingRow(chat) {
  const names = typingNames(chat.id);
  if (names.length === 0) return el('div', { class: 'typing-row', hidden: true });
  return el('div', { class: 'typing-row' }, [
    chat.type === 'group' ? avatarEl({ name: names[0] }, 'avatar-sm') : null,
    el('div', { class: 'typing-bubble' }, [el('i'), el('i'), el('i')])
  ]);
}

/** Eine einzelne Zeile nach einer Änderung neu zeichnen. */
function refreshRow(messageId) {
  const chat = getChat(state.activeChatId);
  if (!chat) return;
  const old = rows.get(messageId);
  if (!old) return;
  const messages = getMessages(chat.id);
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return;
  const fresh = messageRow(messages[index], messages[index - 1], messages[index + 1], chat);
  old.replaceWith(fresh);
  rows.set(messageId, fresh);
}

/* --------------------------------- Scroll ------------------------------- */
export function scrollToBottom(smooth = true) {
  const box = $('#messages');
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  $('#scrollDown').hidden = true;
}

const nearBottom = () => {
  const box = $('#messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
};

export function jumpTo(messageId) {
  const row = rows.get(messageId);
  if (!row) { toast('Die Nachricht ist noch nicht geladen.'); return; }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('highlight');
  setTimeout(() => row.classList.remove('highlight'), 1500);
}

async function loadOlder() {
  const chat = getChat(state.activeChatId);
  if (!chat || loadingHistory || state.fullyLoaded.has(chat.id)) return;
  loadingHistory = true;
  const box = $('#messages');
  const previousHeight = box.scrollHeight;
  try {
    const oldest = getMessages(chat.id)[0];
    const data = await api.messages(chat.id, { before: oldest?.ts || Date.now(), limit: 60 });
    setMessages(chat.id, data.messages, { prepend: true });
    if (!data.hasMore) state.fullyLoaded.add(chat.id);
    renderMessages();
    box.scrollTop = box.scrollHeight - previousHeight;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    loadingHistory = false;
  }
}

/* ---------------------------- Lesebestätigung --------------------------- */
export function markRead() {
  const chat = getChat(state.activeChatId);
  if (!chat || document.hidden) return;
  const messages = getMessages(chat.id);
  const last = messages[messages.length - 1];
  if (!last) return;
  if (chat.unread > 0 || (chat.lastReadTs || 0) < last.ts) {
    sendRead(chat.id, last.ts);
    putChat({ ...chat, unread: 0, lastReadTs: last.ts });
  }
}

/* --------------------------- Nachrichtenmenü ---------------------------- */
function messageMenu(event, message, chat) {
  const own = message.senderId === state.me?.id;
  const items = [
    { label: 'Antworten', icon: ICONS.reply, onClick: () => startReply(message) },
    { label: 'Weiterleiten', icon: ICONS.forward, onClick: () => forwardDialog(message) },
    message.text ? { label: 'Text kopieren', icon: ICONS.copy, onClick: () => copyText(message.text) } : null,
    own && !message.attachment ? { label: 'Bearbeiten', icon: ICONS.edit, onClick: () => startEdit(message) } : null,
    (own || chat.ownerId === state.me?.id) ? 'sep' : null,
    (own || chat.ownerId === state.me?.id) ? {
      label: 'Löschen', icon: ICONS.trash, danger: true,
      onClick: () => confirmDialog({
        title: 'Nachricht löschen?',
        text: 'Die Nachricht wird für alle im Chat entfernt.',
        confirmLabel: 'Löschen',
        danger: true,
        onConfirm: () => sendDelete(message.id)
      })
    } : null
  ].filter(Boolean);
  openMenu(event.clientX, event.clientY, items);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert');
  } catch {
    toast('Kopieren nicht möglich', 'error');
  }
}

function forwardDialog(message) {
  const chats = [...state.chats.values()]
    .filter((c) => c.id !== message.chatId)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  if (chats.length === 0) { toast('Es gibt keinen anderen Chat.'); return; }

  const author = getUser(message.senderId)?.name || 'Unbekannt';
  const body = el('div', {}, [
    el('p', { text: 'An welchen Chat soll die Nachricht gehen?' }),
    el('div', { class: 'pick-list' }, chats.map((chat) => el('div', {
      class: 'pick-item',
      onclick: async () => {
        const { sendMessage } = await import('./socket.js');
        sendMessage({
          chatId: chat.id,
          text: message.text,
          attachment: message.attachment,
          forwardedFrom: author
        });
        closeModal();
        toast(`Weitergeleitet an ${chat.title}`);
      }
    }, [
      avatarEl({ ...chat, online: chat.peer?.online }, 'avatar-sm'),
      el('div', { class: 'pick-body' }, [el('div', { class: 'pick-name', text: chat.title })])
    ])))
  ]);
  openModal({ title: 'Weiterleiten', body, actions: [{ label: 'Abbrechen' }] });
}

/* ------------------------------- Chat-Suche ----------------------------- */
function initChatSearch() {
  const bar = $('#chatSearchBar');
  const input = $('#chatSearchInput');

  $('#chatSearchBtn').addEventListener('click', () => {
    bar.hidden = !bar.hidden;
    if (!bar.hidden) input.focus();
    else { input.value = ''; searchTerm = ''; renderMessages(); scrollToBottom(false); }
  });
  $('#chatSearchClose').addEventListener('click', () => {
    bar.hidden = true;
    input.value = '';
    searchTerm = '';
    renderMessages();
    scrollToBottom(false);
  });
  input.addEventListener('input', () => {
    searchTerm = input.value.trim();
    renderMessages();
    const hits = $$('#messages mark').length;
    $('#chatSearchCount').textContent = searchTerm ? `${hits} Treffer` : '';
    const first = $('#messages mark');
    first?.scrollIntoView({ block: 'center' });
  });
}

const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ----------------------------- Initialisierung -------------------------- */
export function initChatView() {
  $('#backBtn').addEventListener('click', closeChat);
  $('#chatHeadInfo').addEventListener('click', () => openChatInfo(getChat(state.activeChatId)));
  $('#chatMenuBtn').addEventListener('click', (event) => {
    const chat = getChat(state.activeChatId);
    if (!chat) return;
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.right - 200, rect.bottom + 6, [
      { label: 'Chat-Info', icon: ICONS.info, onClick: () => openChatInfo(chat) },
      {
        label: chat.muted ? 'Ton einschalten' : 'Stummschalten',
        icon: chat.muted ? ICONS.sound : ICONS.mute,
        onClick: async () => {
          putChat({ ...chat, muted: !chat.muted });
          await api.updateChat(chat.id, { muted: !chat.muted }).catch(() => {});
        }
      },
      {
        label: chat.archived ? 'Aus dem Archiv holen' : 'Archivieren',
        icon: ICONS.archive,
        onClick: async () => {
          putChat({ ...chat, archived: !chat.archived });
          await api.updateChat(chat.id, { archived: !chat.archived }).catch(() => {});
        }
      }
    ]);
  });

  $('#scrollDown').addEventListener('click', () => scrollToBottom(true));

  $('#messages').addEventListener('scroll', () => {
    const box = $('#messages');
    const down = $('#scrollDown');
    down.hidden = nearBottom();
    if (nearBottom()) {
      $('#scrollBadge').hidden = true;
      markRead();
    }
    if (box.scrollTop < 60) loadOlder();
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });
  window.addEventListener('focus', markRead);

  initChatSearch();

  // Zustandsänderungen abbilden
  on('active', () => { if (state.activeChatId) renderHeader(); });
  on('chats', () => { if (state.activeChatId) renderHeader(); });
  on('presence', () => { if (state.activeChatId) renderHeader(); });
  on('typing', (chatId) => {
    if (chatId !== state.activeChatId) return;
    renderHeader();
    const box = $('#messages');
    const existing = box.querySelector('.typing-row');
    const fresh = typingRow(getChat(chatId));
    if (existing) existing.replaceWith(fresh);
    else box.append(fresh);
    if (nearBottom()) scrollToBottom(false);
  });

  on('message-event', ({ chatId, payload }) => {
    if (chatId !== state.activeChatId) return;
    if (payload.type === 'reset') { renderMessages(); return; }
    if (payload.type === 'update' || payload.type === 'replace') {
      refreshRow(payload.tempId || payload.message.id);
      if (payload.tempId) {
        rows.delete(payload.tempId);
        const row = document.querySelector(`.row[data-id="${payload.tempId}"]`);
        if (row) { row.dataset.id = payload.message.id; rows.set(payload.message.id, row); }
        refreshRow(payload.message.id);
      }
      return;
    }
    if (payload.type === 'add') {
      const stick = nearBottom() || payload.message.senderId === state.me?.id;
      const messages = getMessages(chatId);
      const index = messages.findIndex((m) => m.id === payload.message.id);
      // Am Ende anfügen; sonst reicht ein vollständiger Neuaufbau.
      if (index === messages.length - 1) {
        const chat = getChat(chatId);
        const previous = messages[index - 1];
        if (previous && dayKey(previous.ts) !== dayKey(payload.message.ts)) {
          $('#messages').querySelector('.typing-row')?.before(
            el('div', { class: 'day-sep' }, [el('span', { text: dayLabel(payload.message.ts) })])
          );
        }
        if (previous && isGrouped(previous, payload.message)) refreshRow(previous.id);
        const row = messageRow(payload.message, previous, undefined, chat);
        row.classList.add('enter');
        row.addEventListener('animationend', () => row.classList.remove('enter'), { once: true });
        rows.set(payload.message.id, row);
        const typing = $('#messages').querySelector('.typing-row');
        if (typing) typing.before(row); else $('#messages').append(row);
        $('#messages').querySelector('.list-empty')?.remove();
      } else {
        renderMessages();
      }
      if (stick) { scrollToBottom(false); markRead(); }
      else {
        const badge = $('#scrollBadge');
        $('#scrollDown').hidden = false;
        badge.hidden = false;
        badge.textContent = String((Number(badge.textContent) || 0) + 1);
      }
    }
  });
}

