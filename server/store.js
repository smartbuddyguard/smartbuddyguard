// Persistenz: eine JSON-Datei, die gepuffert (debounced) und atomar geschrieben wird.
// Bewusst ohne Datenbank-Abhängigkeit, damit der Server ohne `npm install` startet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  users: [],       // { id, phone, name, about, color, avatar, hash, salt, createdAt, lastSeen }
  sessions: [],    // { token, userId, createdAt, agent }
  chats: [],       // { id, type, title, color, avatar, memberIds, ownerId, createdAt, lastMessageAt }
  messages: [],    // { id, chatId, senderId, text, ts, ... }
  contacts: [],    // { ownerId, userId, name, createdAt }
  states: []       // { userId, chatId, pinned, muted, archived, lastReadTs, draft }
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...structuredClone(EMPTY), ...parsed };
  } catch {
    return structuredClone(EMPTY);
  }
}

export const db = load();

let timer = null;
let writing = false;
let again = false;

function writeNow() {
  if (writing) { again = true; return; }
  writing = true;
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  const body = JSON.stringify(db);
  fs.promises.writeFile(tmp, body)
    .then(() => fs.promises.rename(tmp, DB_FILE))
    .catch((err) => console.error('[store] Schreiben fehlgeschlagen:', err.message))
    .finally(() => {
      writing = false;
      if (again) { again = false; writeNow(); }
    });
}

/** Markiert den Datenbestand als geändert; geschrieben wird höchstens alle 250 ms. */
export function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; writeNow(); }, 250);
}

/** Synchroner Flush – für den sauberen Shutdown. */
export function saveSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  try {
    const tmp = DB_FILE + '.exit.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[store] Finales Schreiben fehlgeschlagen:', err.message);
  }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function id(prefix = '') {
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return prefix + Date.now().toString(36) + out;
}

export const findUser = (userId) => db.users.find((u) => u.id === userId);
export const findUserByPhone = (phone) => db.users.find((u) => u.phone === phone);
export const findChat = (chatId) => db.chats.find((c) => c.id === chatId);
export const isMember = (chat, userId) => !!chat && chat.memberIds.includes(userId);

export function chatState(userId, chatId) {
  let s = db.states.find((x) => x.userId === userId && x.chatId === chatId);
  if (!s) {
    s = { userId, chatId, pinned: false, muted: false, archived: false, lastReadTs: 0, draft: '' };
    db.states.push(s);
  }
  return s;
}

/** Nachrichten eines Chats, chronologisch. */
export function chatMessages(chatId) {
  return db.messages.filter((m) => m.chatId === chatId);
}

export function privateChatBetween(a, b) {
  return db.chats.find((c) => c.type === 'private' && c.memberIds.length === 2 &&
    c.memberIds.includes(a) && c.memberIds.includes(b));
}
