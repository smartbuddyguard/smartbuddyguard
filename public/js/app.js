// Einstiegspunkt: Anmeldung, Initialisierung der Module, Benachrichtigungen.
import { $, toast } from './util.js';
import { api, getToken, setToken, clearToken } from './api.js';
import { state, on, emit, totalUnread, getChat, getUser, putUsers } from './state.js';
import { connect, disconnect } from './socket.js';
import { initSidebar, renderChatList } from './chatlist.js';
import { initChatView, openChat } from './chat.js';
import { initComposer } from './composer.js';
import { initDialogs, applyTheme, currentTheme } from './dialogs.js';

/* ------------------------------- Anmeldung ------------------------------ */
let mode = 'login';

function setAuthMode(next) {
  mode = next;
  const register = mode === 'register';
  $('#authTitle').textContent = register ? 'Konto anlegen' : 'Willkommen';
  $('#authSub').textContent = register
    ? 'Wähle Name, Nummer und Passwort.'
    : 'Melde dich mit deiner Telefonnummer an.';
  $('#nameField').hidden = !register;
  $('#authSubmit').textContent = register ? 'Registrieren' : 'Anmelden';
  $('#authSwitchText').textContent = register ? 'Schon registriert?' : 'Noch kein Konto?';
  $('#authSwitch').textContent = register ? 'Anmelden' : 'Registrieren';
  $('#authPassword').setAttribute('autocomplete', register ? 'new-password' : 'current-password');
  $('#authError').hidden = true;
}

function initAuth() {
  setAuthMode('login');
  $('#authSwitch').addEventListener('click', () => setAuthMode(mode === 'login' ? 'register' : 'login'));

  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#authSubmit');
    const error = $('#authError');
    error.hidden = true;
    button.disabled = true;
    const payload = {
      phone: $('#authPhone').value.trim(),
      password: $('#authPassword').value,
      name: $('#authName').value.trim()
    };
    try {
      const data = mode === 'register' ? await api.register(payload) : await api.login(payload);
      setToken(data.token);
      state.me = data.user;
      await startApp();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------------------------- Benachrichtigungen ------------------------ */
let audioContext = null;

function blip() {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audioContext.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.25);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.26);
  } catch { /* Ton ist optional */ }
}

function notify({ chatId, message, own }) {
  if (own) return;
  const chat = getChat(chatId);
  if (!chat || chat.muted) return;
  const active = state.activeChatId === chatId && !document.hidden;
  if (active) return;

  blip();
  if (Notification?.permission === 'granted') {
    const sender = getUser(message.senderId)?.name || chat.title;
    const body = message.preview || message.text || 'Neue Nachricht';
    const note = new Notification(chat.type === 'group' ? `${chat.title} · ${sender}` : sender, {
      body: body.slice(0, 120),
      tag: chatId,
      icon: '/icons/icon-192.png'
    });
    note.onclick = () => { window.focus(); openChat(chatId); note.close(); };
  }
}

function updateTitle() {
  const count = totalUnread();
  document.title = count > 0 ? `(${count}) TeleGroove` : 'TeleGroove';
}

/* ------------------------------- App-Start ------------------------------ */
async function startApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;

  connect();

  try {
    const data = await api.chats();
    putUsers(data.users);
    for (const chat of data.chats) state.chats.set(chat.id, chat);
    emit('chats');
  } catch (err) {
    if (err.status === 401) { handleUnauthorized(); return; }
    toast(err.message, 'error');
  }

  renderChatList();
  updateTitle();

  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
  }
}

function handleUnauthorized() {
  disconnect();
  clearToken();
  state.chats.clear();
  state.messages.clear();
  state.users.clear();
  state.me = null;
  $('#app').hidden = true;
  $('#auth').hidden = false;
  setAuthMode('login');
}

/* ----------------------------- Initialisierung -------------------------- */
function init() {
  applyTheme(currentTheme());
  initAuth();
  initSidebar();
  initChatView();
  initComposer();
  initDialogs();

  on('incoming', notify);
  on('chats', updateTitle);
  on('unauthorized', handleUnauthorized);
  on('me', () => {
    const drawerName = $('#drawerName');
    if (drawerName) drawerName.textContent = state.me?.name || '';
  });

  // Verbindungshinweis
  let offlineToast = null;
  on('connection', (online) => {
    clearTimeout(offlineToast);
    if (!online && getToken()) {
      offlineToast = setTimeout(() => {
        if (!state.connected) toast('Verbindung unterbrochen – versuche erneut …', 'error');
      }, 2500);
    }
  });

  // Direkt nach dem Laden: bestehende Sitzung prüfen
  if (getToken()) {
    api.me()
      .then((data) => {
        state.me = data.user;
        putUsers(data.users);
        return startApp();
      })
      .catch(() => handleUnauthorized());
  } else {
    $('#auth').hidden = false;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

init();
