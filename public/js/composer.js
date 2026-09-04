// Eingabezeile: Text, Antworten, Bearbeiten, Anhänge und Sprachnachrichten.
import { $, el, svg, ICONS, toast, fileSize, duration } from './util.js';
import { state, getChat, putMessage } from './state.js';
import { api } from './api.js';
import { sendMessage, sendTyping, sendEdit, sendDraft } from './socket.js';
import { openEmojiPanel } from './emoji.js';

let currentChatId = null;
let typingSentAt = 0;
let typingTimer = null;
let pending = [];        // hochgeladene Anhänge, die mit der nächsten Nachricht rausgehen
let recorder = null;
let recordChunks = [];
let recordStart = 0;
let recordTimer = null;

const input = () => $('#input');

/* ------------------------------ Chatwechsel ----------------------------- */
export function setComposerChat(chat) {
  if (currentChatId && currentChatId !== chat.id) saveDraft();
  currentChatId = chat.id;
  cancelReply();
  clearAttachments();
  input().value = chat.draft || '';
  autoGrow();
  updateSendMode();
}

export const focusComposer = () => input().focus();

function saveDraft() {
  const text = input().value.trim();
  const chat = getChat(currentChatId);
  if (!chat || chat.draft === text) return;
  sendDraft(currentChatId, text);
  chat.draft = text;
}

/* ------------------------- Antworten & Bearbeiten ----------------------- */
export function startReply(message) {
  state.editing = null;
  state.replyTo = message;
  const author = message.senderId === state.me?.id
    ? 'Du'
    : (state.users.get(message.senderId)?.name || 'Unbekannt');
  $('#replyAuthor').textContent = author;
  $('#replyText').textContent = message.text || (message.attachment ? message.attachment.name || 'Anhang' : '');
  $('#replyBar').hidden = false;
  focusComposer();
}

export function startEdit(message) {
  state.replyTo = null;
  state.editing = message;
  $('#replyAuthor').textContent = 'Nachricht bearbeiten';
  $('#replyText').textContent = message.text;
  $('#replyBar').hidden = false;
  input().value = message.text;
  autoGrow();
  updateSendMode();
  focusComposer();
}

export function cancelReply() {
  state.replyTo = null;
  if (state.editing) { input().value = ''; autoGrow(); }
  state.editing = null;
  $('#replyBar').hidden = true;
  updateSendMode();
}

/* -------------------------------- Anhänge ------------------------------- */
function kindFor(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function renderAttachments() {
  const box = $('#attachPreview');
  if (pending.length === 0) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  box.replaceChildren(...pending.map((item, index) => el('div', {
    class: `attach-chip${item.uploading ? ' uploading' : ''}`
  }, [
    item.thumb ? el('img', { src: item.thumb, alt: '' }) : el('span', { html: svg(ICONS.file, 20) }),
    el('span', {}, [
      el('div', { class: 'name', text: item.name }),
      el('div', { style: 'font-size:12px;opacity:.7', text: item.uploading ? 'lädt hoch …' : fileSize(item.size) })
    ]),
    el('button', {
      class: 'rm', type: 'button', title: 'Entfernen', html: svg(ICONS.close, 14),
      onclick: () => { pending.splice(index, 1); renderAttachments(); updateSendMode(); }
    })
  ])));
}

function clearAttachments() {
  pending = [];
  renderAttachments();
}

export async function addFiles(files) {
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast(`„${file.name}“ ist größer als 25 MB.`, 'error'); continue; }
    const item = {
      name: file.name,
      size: file.size,
      kind: kindFor(file.type),
      uploading: true,
      thumb: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    };
    pending.push(item);
    renderAttachments();
    updateSendMode();
    try {
      const result = await api.upload(file);
      Object.assign(item, { url: result.url, uploading: false, size: result.size });
    } catch (err) {
      toast(err.message, 'error');
      pending = pending.filter((x) => x !== item);
    }
    renderAttachments();
    updateSendMode();
  }
}

/* -------------------------------- Senden -------------------------------- */
function updateSendMode() {
  const hasContent = input().value.trim().length > 0 || pending.some((p) => !p.uploading);
  $('#sendBtn').dataset.mode = hasContent || state.editing ? 'send' : 'mic';
}

function autoGrow() {
  const box = input();
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 180) + 'px';
}

function optimistic(chatId, payload) {
  const tempId = 'tmp_' + Math.random().toString(36).slice(2);
  const reply = state.replyTo;
  putMessage(chatId, {
    id: tempId,
    chatId,
    senderId: state.me.id,
    text: payload.text || '',
    ts: Date.now(),
    editedAt: 0,
    deleted: false,
    system: false,
    replyTo: payload.replyTo || null,
    replyPreview: reply ? {
      id: reply.id,
      author: reply.senderId === state.me.id ? state.me.name : (state.users.get(reply.senderId)?.name || 'Unbekannt'),
      text: reply.text || '',
      deleted: false
    } : null,
    forwardedFrom: null,
    attachment: payload.attachment || null,
    reactions: {},
    readBy: [state.me.id],
    deliveredTo: [state.me.id],
    pending: true
  });
  return tempId;
}

export function submit() {
  const chatId = currentChatId;
  if (!chatId) return;
  const text = input().value.trim();

  if (state.editing) {
    if (text && text !== state.editing.text) sendEdit(state.editing.id, text);
    cancelReply();
    input().value = '';
    autoGrow();
    updateSendMode();
    return;
  }

  const ready = pending.filter((p) => !p.uploading && p.url);
  if (!text && ready.length === 0) return;
  if (pending.some((p) => p.uploading)) { toast('Ein Anhang lädt noch hoch …'); return; }

  const replyTo = state.replyTo?.id || null;
  if (ready.length) {
    ready.forEach((item, index) => {
      const attachment = { kind: item.kind, url: item.url, name: item.name, size: item.size, duration: item.duration };
      const payload = {
        chatId,
        text: index === 0 ? text : '',
        replyTo: index === 0 ? replyTo : null,
        attachment
      };
      sendMessage({ ...payload, tempId: optimistic(chatId, payload) });
    });
  } else {
    const payload = { chatId, text, replyTo };
    sendMessage({ ...payload, tempId: optimistic(chatId, payload) });
  }

  input().value = '';
  clearAttachments();
  cancelReply();
  autoGrow();
  updateSendMode();
  sendTyping(chatId, false);
  typingSentAt = 0;
  const chat = getChat(chatId);
  if (chat?.draft) { chat.draft = ''; sendDraft(chatId, ''); }
}

/* --------------------------- Sprachnachrichten -------------------------- */
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('Aufnahme wird von diesem Browser nicht unterstützt.', 'error'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (event) => { if (event.data.size) recordChunks.push(event.data); };
    recorder.onstop = () => stream.getTracks().forEach((track) => track.stop());
    recorder.start();
    recordStart = Date.now();
    $('#recordingBar').hidden = false;
    $('#composer').hidden = true;
    $('#sendBtn').classList.add('recording');
    recordTimer = setInterval(() => {
      $('#recTime').textContent = duration((Date.now() - recordStart) / 1000);
    }, 200);
  } catch {
    toast('Kein Zugriff auf das Mikrofon.', 'error');
  }
}

function stopRecording(send) {
  if (!recorder) return;
  const seconds = (Date.now() - recordStart) / 1000;
  clearInterval(recordTimer);
  $('#recordingBar').hidden = true;
  $('#composer').hidden = false;
  $('#sendBtn').classList.remove('recording');
  $('#recTime').textContent = '0:00';

  recorder.addEventListener('stop', async () => {
    if (!send || seconds < 0.6) { recordChunks = []; recorder = null; return; }
    const blob = new Blob(recordChunks, { type: recorder?.mimeType || 'audio/webm' });
    recordChunks = [];
    recorder = null;
    try {
      const file = new File([blob], `sprachnachricht-${Date.now()}.webm`, { type: blob.type });
      const result = await api.upload(file);
      const chatId = currentChatId;
      const attachment = {
        kind: 'voice', url: result.url, name: file.name,
        size: result.size, duration: Math.round(seconds)
      };
      const payload = { chatId, text: '', attachment, replyTo: state.replyTo?.id || null };
      sendMessage({ ...payload, tempId: optimistic(chatId, payload) });
      cancelReply();
    } catch (err) {
      toast(err.message, 'error');
    }
  }, { once: true });
  recorder.stop();
}

/* ----------------------------- Initialisierung -------------------------- */
export function initComposer() {
  const box = input();

  box.addEventListener('input', () => {
    autoGrow();
    updateSendMode();
    if (!currentChatId) return;
    const now = Date.now();
    if (now - typingSentAt > 2500) { sendTyping(currentChatId, true); typingSentAt = now; }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { sendTyping(currentChatId, false); typingSentAt = 0; saveDraft(); }, 2200);
  });

  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && (state.replyTo || state.editing)) {
      cancelReply();
    } else if (event.key === 'ArrowUp' && !box.value.trim()) {
      // Wie bei Telegram: Pfeil nach oben bearbeitet die letzte eigene Nachricht.
      const own = [...(state.messages.get(currentChatId) || [])].reverse()
        .find((m) => m.senderId === state.me?.id && !m.deleted && !m.attachment);
      if (own) { event.preventDefault(); startEdit(own); }
    }
  });

  box.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); addFiles(files); }
  });

  $('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    if ($('#sendBtn').dataset.mode === 'send') submit();
    else startRecording();
  });

  $('#replyCancel').addEventListener('click', cancelReply);
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (event) => {
    addFiles([...event.target.files]);
    event.target.value = '';
  });
  $('#emojiBtn').addEventListener('click', (event) => {
    openEmojiPanel(event.currentTarget, (emoji) => {
      const start = box.selectionStart ?? box.value.length;
      box.value = box.value.slice(0, start) + emoji + box.value.slice(box.selectionEnd ?? start);
      box.selectionStart = box.selectionEnd = start + emoji.length;
      autoGrow();
      updateSendMode();
      box.focus();
    });
  });

  $('#recCancel').addEventListener('click', () => stopRecording(false));
  $('#recSend').addEventListener('click', () => stopRecording(true));

  // Dateien per Drag & Drop
  const pane = $('#chatPane');
  pane.addEventListener('dragover', (event) => { event.preventDefault(); });
  pane.addEventListener('drop', (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length && currentChatId) addFiles(files);
  });

  window.addEventListener('beforeunload', saveDraft);
}
