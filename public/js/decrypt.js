// Entschlüsselt Nachrichteninhalte, sobald sie hereinkommen, und hält sie im
// Speicher — damit das Zeichnen der Oberfläche synchron bleiben kann.
import { unseal, hasKey } from './crypto.js';
import { state, emit, getMessages, putChat } from './state.js';

const bodies = new Map(); // Nachrichten-ID -> { iv, body }

/**
 * Hängt `body` an die Nachricht: den entschlüsselten Inhalt
 * ({ t, r, a, c }) oder `null`, wenn der Schlüssel noch fehlt.
 */
export async function decorate(chatId, message) {
  if (!message) return message;
  if (message.system) { message.body = { t: message.text || '' }; return message; }
  if (message.deleted) { message.body = { t: '' }; return message; }

  const cached = bodies.get(message.id);
  if (cached && cached.iv === message.enc?.iv) {
    message.body = cached.body;
    return message;
  }
  const body = await unseal(chatId, message.enc);
  message.body = body;
  if (body) bodies.set(message.id, { iv: message.enc.iv, body });
  return message;
}

export async function decorateAll(chatId, list = []) {
  for (const message of list) await decorate(chatId, message);
  return list;
}

/** Nach einem nachgereichten Schlüssel alles im Chat erneut aufschließen. */
export async function redecrypt(chatId) {
  if (!hasKey(chatId)) return;
  for (const message of getMessages(chatId)) {
    bodies.delete(message.id);
    await decorate(chatId, message);
  }
  const chat = state.chats.get(chatId);
  if (chat?.lastMessage) {
    bodies.delete(chat.lastMessage.id);
    await decorate(chatId, chat.lastMessage);
    putChat({ ...chat });
  }
  emit('messages:' + chatId, { type: 'reset' });
  emit('message-event', { chatId, payload: { type: 'reset' } });
  emit('chats');
}

export const forgetBody = (messageId) => bodies.delete(messageId);

/** Kurzform für Chatliste, Zitate und Benachrichtigungen. */
export function previewOf(message) {
  if (!message) return '';
  if (message.deleted) return 'Diese Nachricht wurde gelöscht';
  if (message.system) return message.text || '';
  const body = message.body;
  if (!body) return '🔒 Verschlüsselt';
  if (body.c) {
    const label = body.c.kind === 'video' ? '📹 Videoanruf' : '📞 Sprachanruf';
    return body.c.missed ? label + ' verpasst' : label;
  }
  if (body.a) {
    const labels = {
      image: '📷 Foto', video: '🎬 Video', voice: '🎤 Sprachnachricht',
      audio: '🎵 Audio', file: '📎 Datei'
    };
    const label = labels[body.a.kind] || '📎 Anhang';
    return body.t ? `${label} ${body.t}` : label;
  }
  return body.t || '';
}
