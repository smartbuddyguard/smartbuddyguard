// Ende-zu-Ende-Verschlüsselung im Browser (WebCrypto, ohne Bibliothek).
//
// Jedes Gerät hat ein ECDH-Schlüsselpaar (P-256). Der private Teil verlässt
// das Gerät nie. Jeder Chat hat einen AES-GCM-Schlüssel, der für jedes
// Mitglied einzeln verpackt wird — der Server transportiert nur diese Pakete
// und die Chiffretexte, lesen kann er beides nicht.
const subtle = crypto.subtle;
const utf8 = (s) => new TextEncoder().encode(s);
const unutf8 = (b) => new TextDecoder().decode(b);

const LS = { priv: 'buddychat.priv', pub: 'buddychat.pub', key: 'buddychat.k.' };

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privates Fenster */ } };

/** Base64 auch für große Puffer (Sprachnachrichten, Bilder). */
export function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

export function fromB64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const state = {
  priv: null,
  pubJwk: null,
  myId: null,
  keys: new Map(),      // chatId -> CryptoKey
  pending: new Map(),   // chatId -> Promise
  missing: new Set(),   // Chats ohne Schlüssel
  requestKey: () => {} // wird von socket.js gesetzt
};

export const publicKey = () => state.pubJwk;
export const hasKey = (chatId) => state.keys.has(chatId);
export const missingKey = (chatId) => state.missing.has(chatId);

/** Gerätekennung erzeugen oder aus dem lokalen Speicher laden. */
export async function initIdentity(myId) {
  state.myId = myId;
  const savedPriv = get(LS.priv);
  const savedPub = get(LS.pub);
  if (savedPriv && savedPub) {
    try {
      state.priv = await subtle.importKey('jwk', JSON.parse(savedPriv),
        { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      state.pubJwk = JSON.parse(savedPub);
      return state.pubJwk;
    } catch { /* neu erzeugen */ }
  }
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  state.priv = kp.privateKey;
  state.pubJwk = await subtle.exportKey('jwk', kp.publicKey);
  set(LS.priv, JSON.stringify(await subtle.exportKey('jwk', kp.privateKey)));
  set(LS.pub, JSON.stringify(state.pubJwk));
  return state.pubJwk;
}

/** Gemeinsamer Umschlagschlüssel mit einem anderen Gerät (ECDH + HKDF). */
async function kekWith(otherId, otherPubJwk) {
  const theirs = await subtle.importKey('jwk', otherPubJwk,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, state.priv, 256);
  const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: utf8([state.myId, otherId].sort().join('|')),
    info: utf8('buddychat-key-encryption-v1')
  }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const importChatKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

/** Einen empfangenen, verpackten Chatschlüssel auspacken und merken. */
export async function unwrapChatKey(chatId, box, senderPubJwk) {
  if (!box || !senderPubJwk) return null;
  try {
    const kek = await kekWith(box.from, senderPubJwk);
    const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, kek, fromB64(box.k));
    set(LS.key + chatId, toB64(raw));
    const key = await importChatKey(raw);
    state.keys.set(chatId, key);
    state.missing.delete(chatId);
    return key;
  } catch {
    return null;
  }
}

/** Den Chatschlüssel für ein Mitglied verpacken (zum Weitergeben). */
export async function wrapChatKeyFor(chatId, userId, theirPubJwk) {
  const key = state.keys.get(chatId);
  if (!key || !theirPubJwk) return null;
  const raw = await subtle.exportKey('raw', key);
  const kek = await kekWith(userId, theirPubJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const boxed = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: toB64(iv), k: toB64(boxed) };
}

/** Neuen Chatschlüssel erzeugen; das Verteilen übernimmt der Aufrufer. */
export async function createChatKey(chatId) {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await subtle.exportKey('raw', key);
  set(LS.key + chatId, toB64(raw));
  state.keys.set(chatId, key);
  state.missing.delete(chatId);
  return key;
}

/**
 * Chatschlüssel besorgen: aus dem Speicher, aus dem lokalen Zwischenspeicher
 * oder — als letzter Schritt — per Anfrage bei den anderen Mitgliedern.
 */
export function chatKey(chatId) {
  if (state.keys.has(chatId)) return Promise.resolve(state.keys.get(chatId));
  if (state.pending.has(chatId)) return state.pending.get(chatId);

  const job = (async () => {
    const cached = get(LS.key + chatId);
    if (cached) {
      const key = await importChatKey(fromB64(cached));
      state.keys.set(chatId, key);
      state.missing.delete(chatId);
      return key;
    }
    state.missing.add(chatId);
    state.requestKey(chatId);
    return null;
  })();

  state.pending.set(chatId, job);
  return job.finally(() => state.pending.delete(chatId));
}

export function setKeyHooks({ request }) {
  if (request) state.requestKey = request;
}

/* ------------------------- Inhalte ver-/entschlüsseln ------------------- */
export async function seal(chatId, obj) {
  const key = state.keys.get(chatId) || await chatKey(chatId);
  if (!key) throw new Error('Für diesen Chat fehlt noch der Schlüssel.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function unseal(chatId, box) {
  if (!box || !box.ct) return null;
  const key = state.keys.get(chatId);
  if (!key) return null;
  try {
    const clear = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return JSON.parse(unutf8(clear));
  } catch {
    return null;
  }
}

export async function sealBytes(chatId, bytes) {
  const key = state.keys.get(chatId) || await chatKey(chatId);
  if (!key) throw new Error('Für diesen Chat fehlt noch der Schlüssel.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toB64(iv), bytes: new Uint8Array(ct) };
}

export async function unsealBytes(chatId, iv, bytes) {
  const key = state.keys.get(chatId);
  if (!key) return null;
  try { return await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, bytes); }
  catch { return null; }
}

/** Sicherheitsnummer: Fingerabdruck beider öffentlicher Schlüssel. */
export async function safetyNumber(theirPubJwk) {
  if (!state.pubJwk || !theirPubJwk) return null;
  const one = (j) => j.x + j.y;
  const both = [one(state.pubJwk), one(theirPubJwk)].sort().join('');
  const hash = new Uint8Array(await subtle.digest('SHA-256', utf8(both)));
  const out = [];
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + hash[i + j]) % 100000;
    out.push(String(n).padStart(5, '0'));
  }
  return out.join(' ');
}

export function forgetAllKeys() {
  state.keys.clear();
  state.missing.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LS.key)) localStorage.removeItem(k);
  } catch { /* egal */ }
}
