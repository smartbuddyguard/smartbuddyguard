// Kleine Helfer für DOM, Formatierung und Text.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svg(paths, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${paths}</svg>`;
}

export const ICONS = {
  reply: '<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  edit: '<path d="M4 20l4.5-1.2L19 8.3a2.1 2.1 0 0 0 0-3l-.3-.3a2.1 2.1 0 0 0-3 0L5.2 15.5 4 20z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  mute: '<path d="M11 6 7 9H4v6h3l4 3z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  sound: '<path d="M11 6 7 9H4v6h3l4 3z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<rect x="8" y="5" width="3.4" height="14" rx="1"/><rect x="13" y="5" width="3.4" height="14" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M17 11h4M19 9v4"/>',
  phone: '<path d="M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2 2 2 0 0 1 6 3z"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
  forward: '<path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/>',
  exit: '<path d="M14 8V5H5v14h9v-3M10 12h10M17 9l3 3-3 3"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  select: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'
};

const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const pad = (n) => String(n).padStart(2, '0');
export const timeOf = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** „Heute“, „Gestern“, „14. März“ oder „14. März 2024“. */
export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(ts) === dayKey(today)) return 'Heute';
  if (dayKey(ts) === dayKey(yesterday)) return 'Gestern';
  const sameYear = d.getFullYear() === today.getFullYear();
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

/** Kompakte Zeitangabe für die Chatliste. */
export function listTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now)) return timeOf(ts);
  if (dayKey(ts) === dayKey(new Date(Date.now() - 86400000))) return 'Gestern';
  if (Date.now() - ts < 6 * 86400000) return DAYS[d.getDay()].slice(0, 2);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/** „zuletzt online“-Text im Telegram-Wording. */
export function lastSeenLabel(user) {
  if (!user) return '';
  if (user.online) return 'online';
  if (!user.lastSeen) return 'zuletzt gesehen: vor langer Zeit';
  const diff = Date.now() - user.lastSeen;
  if (diff < 60000) return 'zuletzt gesehen: gerade eben';
  if (diff < 3600000) return `zuletzt gesehen: vor ${Math.floor(diff / 60000)} Min.`;
  if (dayKey(user.lastSeen) === dayKey(Date.now())) return `zuletzt gesehen: heute um ${timeOf(user.lastSeen)}`;
  if (dayKey(user.lastSeen) === dayKey(Date.now() - 86400000)) return `zuletzt gesehen: gestern um ${timeOf(user.lastSeen)}`;
  return `zuletzt gesehen: ${dayLabel(user.lastSeen)}`;
}

export function fileSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function escapeHtml(text = '') {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g;

/** Text escapen, Links klickbar machen, Zeilenumbrüche behalten. */
export function richText(text = '') {
  return escapeHtml(text).replace(URL_RE, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

export function highlight(text = '', query = '') {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const q = query.trim();
  if (!q) return safe;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|️|‍|\s)+$/u;
export function isEmojiOnly(text = '') {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 12) return false;
  try { return EMOJI_ONLY.test(trimmed); } catch { return false; }
}

/** Avatar-Element mit Bild oder Initialen. */
export function avatarEl(entity, size = '') {
  const node = el('div', { class: `avatar ${size}`.trim() });
  const name = entity?.title || entity?.name || '?';
  if (entity?.avatar) {
    node.style.backgroundImage = `url(${entity.avatar})`;
    node.style.background = `var(--accent) url(${entity.avatar}) center/cover`;
  } else {
    node.style.background = entity?.color || 'var(--accent)';
    node.textContent = initials(name);
  }
  if (entity?.online) node.append(el('span', { class: 'online-dot' }));
  return node;
}

let toastTimer = null;
export function toast(message, kind = '') {
  const root = $('#toastRoot');
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  root.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3200);
  setTimeout(() => node.remove(), 3600);
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
