// Passwort-Hashing (scrypt) und Session-Tokens – nur mit node:crypto.
import crypto from 'node:crypto';
import { db, save, id } from './store.js';

const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 90; // 90 Tage

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, user) {
  if (!user?.hash || !user?.salt) return false;
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(userId, agent = '') {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, userId, createdAt: Date.now(), agent: String(agent).slice(0, 120) });
  save();
  return token;
}

export function userForToken(token) {
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    dropSession(token);
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}

export function dropSession(token) {
  const i = db.sessions.findIndex((s) => s.token === token);
  if (i >= 0) { db.sessions.splice(i, 1); save(); }
}

// Landesvorwahl für national geschriebene Nummern (0170… → +49170…).
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '49').replace(/\D/g, '');

/**
 * Bringt Telefonnummern auf eine einheitliche Form, damit „+49 170 1234“,
 * „0049 170 1234“ und „0170 1234“ dasselbe Konto treffen.
 */
export function normalizePhone(input) {
  let value = String(input || '').trim().replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (!value) return null;
  if (value.startsWith('00')) value = '+' + value.slice(2);
  else if (value.startsWith('0')) value = '+' + DEFAULT_COUNTRY_CODE + value.slice(1);
  else if (!value.startsWith('+')) value = '+' + value;
  return /^\+\d{6,20}$/.test(value) ? value : null;
}

const COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#faa774', '#6ec9cb', '#d3ab5c'];
export function colorForId(value) {
  let sum = 0;
  for (const ch of String(value)) sum = (sum + ch.charCodeAt(0)) % 997;
  return COLORS[sum % COLORS.length];
}

export const newId = id;
