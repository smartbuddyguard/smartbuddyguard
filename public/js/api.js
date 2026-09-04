// REST-Client. Der Session-Token liegt im localStorage.
const TOKEN_KEY = 'telegroove.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getToken();
  if (token) headers.authorization = 'Bearer ' + token;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  return data;
}

export const api = {
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/me'),
  updateMe: (payload) => request('PATCH', '/api/me', payload),
  changePassword: (payload) => request('POST', '/api/me/password', payload),

  chats: () => request('GET', '/api/chats'),
  createChat: (payload) => request('POST', '/api/chats', payload),
  updateChat: (chatId, payload) => request('PATCH', `/api/chats/${chatId}`, payload),
  deleteChat: (chatId) => request('DELETE', `/api/chats/${chatId}`),
  messages: (chatId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/chats/${chatId}/messages${q ? '?' + q : ''}`);
  },

  searchUsers: (q) => request('GET', `/api/users/search?q=${encodeURIComponent(q)}`),
  searchMessages: (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`),
  contacts: () => request('GET', '/api/contacts'),
  addContact: (payload) => request('POST', '/api/contacts', payload),
  removeContact: (userId) => request('DELETE', `/api/contacts/${userId}`),

  upload: (file, name = file.name) => request('POST', '/api/upload', file, {
    'content-type': file.type || 'application/octet-stream',
    'x-file-name': encodeURIComponent(name || 'datei')
  })
};
