// REST-API: Registrierung, Profile, Chats, Verlauf, Suche, Uploads.
import fs from 'node:fs';
import path from 'node:path';
import { db, save, id, findUser, findUserByPhone, findChat, chatState, UPLOAD_DIR } from './store.js';
import { hashPassword, verifyPassword, createSession, dropSession, userForToken, normalizePhone } from './auth.js';
import {
  publicUser, publicChat, publicMessage, chatsForUser, createUser,
  createPrivateChat, createGroupChat, membersOf, systemMessage, contactName, now
} from './model.js';
import { onlineIds, isOnline, pushChat, knownUsers, broadcastChat } from './hub.js';

const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
  'application/pdf': '.pdf'
};

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function auth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return { token, user: userForToken(token) };
}

/** Behandelt alle /api/*-Routen. Gibt false zurück, wenn nichts passte. */
export async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = parts.slice(1);
  const method = req.method;

  // --- Authentifizierung ------------------------------------------------
  if (route[0] === 'auth' && route[1] === 'register' && method === 'POST') {
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const name = String(body.name || '').trim().slice(0, 60);
    const password = String(body.password || '');
    if (!phone) return json(res, 400, { error: 'Bitte eine gültige Telefonnummer angeben.' });
    if (name.length < 2) return json(res, 400, { error: 'Bitte einen Namen mit mindestens 2 Zeichen angeben.' });
    if (password.length < 6) return json(res, 400, { error: 'Das Passwort braucht mindestens 6 Zeichen.' });
    if (findUserByPhone(phone)) return json(res, 409, { error: 'Diese Nummer ist bereits registriert.' });
    const { hash, salt } = hashPassword(password);
    const user = createUser({ phone, name, hash, salt });
    const token = createSession(user.id, req.headers['user-agent']);
    return json(res, 201, { token, user: publicUser(user, true) });
  }

  if (route[0] === 'auth' && route[1] === 'login' && method === 'POST') {
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    const user = phone ? findUserByPhone(phone) : null;
    if (!user || !verifyPassword(String(body.password || ''), user)) {
      return json(res, 401, { error: 'Nummer oder Passwort stimmt nicht.' });
    }
    const token = createSession(user.id, req.headers['user-agent']);
    return json(res, 200, { token, user: publicUser(user, true) });
  }

  // Ab hier ist eine Session Pflicht.
  const { token, user } = auth(req);
  if (!user) return json(res, 401, { error: 'Nicht angemeldet.' });

  if (route[0] === 'auth' && route[1] === 'logout' && method === 'POST') {
    dropSession(token);
    return json(res, 200, { ok: true });
  }

  // --- Profil -----------------------------------------------------------
  if (route[0] === 'me' && method === 'GET') {
    return json(res, 200, { user: publicUser(user, true), users: knownUsers(user.id) });
  }

  if (route[0] === 'me' && (method === 'PATCH' || method === 'PUT')) {
    const body = await readJson(req);
    if (typeof body.name === 'string' && body.name.trim().length >= 2) user.name = body.name.trim().slice(0, 60);
    if (typeof body.about === 'string') user.about = body.about.slice(0, 140);
    if (typeof body.avatar === 'string' || body.avatar === null) user.avatar = body.avatar || null;
    if (body.pub && typeof body.pub === 'object') user.pub = body.pub;
    save();
    const me = publicUser(user, true);
    for (const chat of db.chats) {
      if (chat.memberIds.includes(user.id)) broadcastChat(chat, { t: 'user', user: me });
    }
    return json(res, 200, { user: me });
  }

  if (route[0] === 'me' && route[1] === 'password' && method === 'POST') {
    const body = await readJson(req);
    if (!verifyPassword(String(body.current || ''), user)) {
      return json(res, 403, { error: 'Aktuelles Passwort ist falsch.' });
    }
    if (String(body.next || '').length < 6) return json(res, 400, { error: 'Das neue Passwort braucht mindestens 6 Zeichen.' });
    const { hash, salt } = hashPassword(String(body.next));
    user.hash = hash;
    user.salt = salt;
    save();
    return json(res, 200, { ok: true });
  }

  // --- Nutzer & Kontakte ------------------------------------------------
  if (route[0] === 'users' && route[1] === 'search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return json(res, 200, { users: [] });
    const online = onlineIds();
    const phone = normalizePhone(q);
    const users = db.users
      .filter((u) => u.id !== user.id)
      .filter((u) => u.name.toLowerCase().includes(q) || u.phone.includes(q) || (phone && u.phone === phone))
      .slice(0, 25)
      .map((u) => ({ ...publicUser(u, online.has(u.id)), contactName: contactName(user.id, u.id) }));
    return json(res, 200, { users });
  }

  if (route[0] === 'contacts' && method === 'GET') {
    const online = onlineIds();
    const contacts = db.contacts
      .filter((c) => c.ownerId === user.id)
      .map((c) => ({ ...publicUser(findUser(c.userId), online.has(c.userId)), contactName: c.name }))
      .filter((c) => c.id)
      .sort((a, b) => (a.contactName || a.name).localeCompare(b.contactName || b.name));
    return json(res, 200, { contacts });
  }

  if (route[0] === 'contacts' && method === 'POST') {
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'Bitte eine gültige Telefonnummer angeben.' });
    const target = findUserByPhone(phone);
    if (!target) return json(res, 404, { error: 'Zu dieser Nummer gibt es kein Konto.' });
    if (target.id === user.id) return json(res, 400, { error: 'Das ist deine eigene Nummer.' });
    const name = String(body.name || target.name).trim().slice(0, 60);
    const existing = db.contacts.find((c) => c.ownerId === user.id && c.userId === target.id);
    if (existing) existing.name = name;
    else db.contacts.push({ ownerId: user.id, userId: target.id, name, createdAt: now() });
    save();
    return json(res, 200, { contact: { ...publicUser(target, isOnline(target.id)), contactName: name } });
  }

  if (route[0] === 'contacts' && route[1] && method === 'DELETE') {
    const i = db.contacts.findIndex((c) => c.ownerId === user.id && c.userId === route[1]);
    if (i >= 0) { db.contacts.splice(i, 1); save(); }
    return json(res, 200, { ok: true });
  }

  // --- Chats ------------------------------------------------------------
  if (route[0] === 'chats' && route.length === 1 && method === 'GET') {
    const online = onlineIds();
    return json(res, 200, { chats: chatsForUser(user.id, online), users: knownUsers(user.id, online) });
  }

  if (route[0] === 'chats' && route.length === 1 && method === 'POST') {
    const body = await readJson(req);
    if (body.type === 'group') {
      const memberIds = (body.memberIds || []).filter((mid) => findUser(mid));
      if (memberIds.length === 0) return json(res, 400, { error: 'Bitte mindestens ein Mitglied auswählen.' });
      const chat = createGroupChat(user.id, memberIds, String(body.title || ''));
      systemMessage(chat, `${user.name} hat die Gruppe „${chat.title}“ erstellt`);
      pushChat(chat);
      return json(res, 201, { chat: publicChat(chat, user.id, onlineIds()), members: membersOf(chat, onlineIds()) });
    }
    let target = null;
    if (body.userId) target = findUser(body.userId);
    else if (body.phone) target = findUserByPhone(normalizePhone(body.phone) || '');
    if (!target) return json(res, 404, { error: 'Zu dieser Nummer gibt es kein Konto.' });
    const chat = createPrivateChat(user.id, target.id);
    pushChat(chat);
    return json(res, 201, { chat: publicChat(chat, user.id, onlineIds()), members: membersOf(chat, onlineIds()) });
  }

  if (route[0] === 'chats' && route[1] && route.length === 2 && method === 'PATCH') {
    const chat = findChat(route[1]);
    if (!chat || !chat.memberIds.includes(user.id)) return json(res, 404, { error: 'Chat nicht gefunden.' });
    const body = await readJson(req);
    const state = chatState(user.id, chat.id);
    if (typeof body.pinned === 'boolean') state.pinned = body.pinned;
    if (typeof body.muted === 'boolean') state.muted = body.muted;
    if (typeof body.archived === 'boolean') state.archived = body.archived;
    if (typeof body.title === 'string' && chat.type === 'group' && body.title.trim()) {
      chat.title = body.title.trim().slice(0, 80);
      systemMessage(chat, `${user.name} hat den Gruppennamen zu „${chat.title}“ geändert`);
    }
    if (Array.isArray(body.addMembers) && chat.type === 'group') {
      for (const mid of body.addMembers) {
        const target = findUser(mid);
        if (!target || chat.memberIds.includes(mid)) continue;
        chat.memberIds.push(mid);
        systemMessage(chat, `${user.name} hat ${target.name} hinzugefügt`);
      }
    }
    if (body.removeMember && chat.type === 'group' && chat.ownerId === user.id) {
      const target = findUser(body.removeMember);
      const i = chat.memberIds.indexOf(body.removeMember);
      if (i >= 0 && body.removeMember !== chat.ownerId) {
        chat.memberIds.splice(i, 1);
        systemMessage(chat, `${user.name} hat ${target?.name || 'ein Mitglied'} entfernt`);
      }
    }
    save();
    pushChat(chat);
    return json(res, 200, { chat: publicChat(chat, user.id, onlineIds()), members: membersOf(chat, onlineIds()) });
  }

  if (route[0] === 'chats' && route[1] && route.length === 2 && method === 'DELETE') {
    const chat = findChat(route[1]);
    if (!chat || !chat.memberIds.includes(user.id)) return json(res, 404, { error: 'Chat nicht gefunden.' });
    if (chat.type === 'group') {
      chat.memberIds = chat.memberIds.filter((mid) => mid !== user.id);
      systemMessage(chat, `${user.name} hat die Gruppe verlassen`);
      pushChat(chat);
    } else {
      // Privatchat: nur für die eigene Ansicht leeren.
      db.messages = db.messages.filter((m) => m.chatId !== chat.id);
      const i = db.chats.indexOf(chat);
      if (i >= 0) db.chats.splice(i, 1);
      broadcastChat(chat, { t: 'chat:removed', chatId: chat.id });
    }
    save();
    return json(res, 200, { ok: true });
  }

  if (route[0] === 'chats' && route[1] && route[2] === 'messages' && method === 'GET') {
    const chat = findChat(route[1]);
    if (!chat || !chat.memberIds.includes(user.id)) return json(res, 404, { error: 'Chat nicht gefunden.' });
    const before = Number(url.searchParams.get('before')) || Infinity;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 60, 200);
    const all = db.messages.filter((m) => m.chatId === chat.id && m.ts < before);
    const slice = all.slice(Math.max(0, all.length - limit));
    return json(res, 200, {
      messages: slice.map(publicMessage),
      hasMore: all.length > slice.length,
      members: membersOf(chat, onlineIds())
    });
  }

  // Eine serverseitige Volltextsuche gibt es bewusst nicht: der Server kennt
  // die Inhalte nicht. Der Client durchsucht die entschlüsselten Nachrichten.

  // --- Upload -----------------------------------------------------------
  if (route[0] === 'upload' && method === 'POST') {
    let buf;
    try {
      buf = await readBody(req, MAX_UPLOAD);
    } catch {
      return json(res, 413, { error: 'Die Datei ist zu groß (max. 25 MB).' });
    }
    if (!buf.length) return json(res, 400, { error: 'Leere Datei.' });
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const original = decodeURIComponent(String(req.headers['x-file-name'] || 'datei'));
    const ext = EXT[type] || path.extname(original).slice(0, 8) || '.bin';
    const name = id('f_') + ext;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
    return json(res, 201, {
      url: '/media/' + name,
      name: original.slice(0, 120),
      size: buf.length,
      mime: type
    });
  }

  return json(res, 404, { error: 'Unbekannter Endpunkt.' });
}
