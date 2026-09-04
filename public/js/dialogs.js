// Menü-Schublade und alle Dialoge: neuer Chat, Gruppe, Kontakte, Einstellungen.
import { $, el, svg, ICONS, avatarEl, toast, debounce, initials } from './util.js';
import { state, putChat, putUsers, emit } from './state.js';
import { api, clearToken } from './api.js';
import { openModal, closeModal, confirmDialog, fieldInput } from './ui.js';
import { openChat } from './chat.js';
import { disconnect } from './socket.js';

const THEME_KEY = 'telegroove.theme';

/* -------------------------------- Theme -------------------------------- */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#17212b' : '#3390ec');
  $('#themeSwitch')?.classList.toggle('on', theme === 'dark');
}

export const currentTheme = () => localStorage.getItem(THEME_KEY)
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/* ------------------------------ Schublade ------------------------------- */
export function openDrawer() {
  const me = state.me;
  const avatar = $('#drawerAvatar');
  avatar.replaceWith(Object.assign(avatarEl(me, 'avatar-lg'), { id: 'drawerAvatar' }));
  $('#drawerName').textContent = me?.name || '';
  $('#drawerPhone').textContent = me?.phone || '';
  $('#drawer').hidden = false;
  $('#drawerScrim').hidden = false;
  $('#themeSwitch').classList.toggle('on', currentTheme() === 'dark');
}

export function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawerScrim').hidden = true;
}

/* ------------------------------ Neuer Chat ------------------------------ */
export function newChatDialog() {
  const { field, input } = fieldInput('Name oder Telefonnummer', '', { autocomplete: 'off' });
  const list = el('div', { class: 'pick-list' });
  const body = el('div', {}, [
    el('p', { text: 'Suche eine registrierte Nummer oder wähle einen Kontakt.' }),
    field,
    list
  ]);

  const start = async (userId) => {
    try {
      const data = await api.createChat({ userId });
      putChat(data.chat);
      putUsers(data.members);
      closeModal();
      openChat(data.chat.id);
    } catch (err) { toast(err.message, 'error'); }
  };

  const show = (users) => {
    if (users.length === 0) {
      list.replaceChildren(el('div', { class: 'list-empty', text: 'Niemand gefunden.' }));
      return;
    }
    list.replaceChildren(...users.map((user) => el('div', {
      class: 'pick-item', onclick: () => start(user.id)
    }, [
      avatarEl(user, 'avatar-sm'),
      el('div', { class: 'pick-body' }, [
        el('div', { class: 'pick-name', text: user.contactName || user.name }),
        el('div', { class: 'pick-sub', text: user.phone })
      ])
    ])));
  };

  const search = debounce(async (query) => {
    if (!query) { loadContacts(); return; }
    try { show((await api.searchUsers(query)).users); } catch { /* still */ }
  }, 220);

  const loadContacts = async () => {
    try {
      const { contacts } = await api.contacts();
      if (contacts.length) show(contacts);
      else list.replaceChildren(el('div', { class: 'list-empty', text: 'Noch keine Kontakte – such einfach nach einer Nummer.' }));
    } catch { /* still */ }
  };

  input.addEventListener('input', () => search(input.value.trim()));
  openModal({ title: 'Neuer Chat', body, actions: [{ label: 'Schließen' }] });
  loadContacts();
}

/* ------------------------------ Neue Gruppe ----------------------------- */
export async function newGroupDialog() {
  let people = [];
  try {
    const { contacts } = await api.contacts();
    people = contacts;
  } catch { /* still */ }
  // Ohne Adressbuch nehmen wir die bisherigen Chatpartner.
  if (people.length === 0) {
    people = [...state.chats.values()].filter((c) => c.type === 'private' && c.peer).map((c) => c.peer);
  }
  if (people.length === 0) { toast('Füge zuerst einen Kontakt hinzu.'); return; }

  const { field: titleField, input: titleInput } = fieldInput('Gruppenname');
  const chosen = new Set();
  const list = el('div', { class: 'pick-list' }, people.map((user) => {
    const node = el('div', {
      class: 'pick-item',
      onclick: () => {
        if (chosen.has(user.id)) chosen.delete(user.id); else chosen.add(user.id);
        node.classList.toggle('on', chosen.has(user.id));
      }
    }, [
      el('span', { class: 'check', html: svg(ICONS.check, 13) }),
      avatarEl(user, 'avatar-sm'),
      el('div', { class: 'pick-body' }, [
        el('div', { class: 'pick-name', text: user.contactName || user.name }),
        el('div', { class: 'pick-sub', text: user.phone })
      ])
    ]);
    return node;
  }));

  openModal({
    title: 'Neue Gruppe',
    body: el('div', {}, [titleField, el('p', { text: 'Wähle die Mitglieder:' }), list]),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Erstellen',
        onClick: async () => {
          if (chosen.size === 0) { toast('Bitte mindestens ein Mitglied wählen.'); return false; }
          try {
            const data = await api.createChat({
              type: 'group',
              title: titleInput.value.trim() || 'Neue Gruppe',
              memberIds: [...chosen]
            });
            putChat(data.chat);
            putUsers(data.members);
            openChat(data.chat.id);
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

/* ------------------------------- Kontakte ------------------------------- */
export async function contactsDialog() {
  const list = el('div', { class: 'pick-list' });
  const body = el('div', {}, [list]);

  const render = async () => {
    try {
      const { contacts } = await api.contacts();
      if (contacts.length === 0) {
        list.replaceChildren(el('div', { class: 'list-empty', text: 'Noch keine Kontakte gespeichert.' }));
        return;
      }
      list.replaceChildren(...contacts.map((user) => el('div', { class: 'pick-item' }, [
        avatarEl(user, 'avatar-sm'),
        el('div', {
          class: 'pick-body', style: 'cursor:pointer',
          onclick: async () => {
            try {
              const data = await api.createChat({ userId: user.id });
              putChat(data.chat);
              closeModal();
              openChat(data.chat.id);
            } catch (err) { toast(err.message, 'error'); }
          }
        }, [
          el('div', { class: 'pick-name', text: user.contactName || user.name }),
          el('div', { class: 'pick-sub', text: user.phone })
        ]),
        el('button', {
          class: 'icon-btn', title: 'Kontakt entfernen', html: svg(ICONS.trash, 18),
          onclick: async () => { await api.removeContact(user.id).catch(() => {}); render(); }
        })
      ])));
    } catch (err) { toast(err.message, 'error'); }
  };

  openModal({
    title: 'Kontakte',
    body,
    actions: [
      { label: 'Neuer Kontakt', onClick: () => { addContactDialog(); return true; } },
      { label: 'Schließen' }
    ]
  });
  render();
}

export function addContactDialog() {
  const { field: phoneField, input: phoneInput } = fieldInput('Telefonnummer', '', { type: 'tel', inputmode: 'tel' });
  const { field: nameField, input: nameInput } = fieldInput('Name (optional)');
  openModal({
    title: 'Kontakt hinzufügen',
    body: el('div', {}, [
      el('p', { text: 'Die Nummer muss bereits ein TeleGroove-Konto haben.' }),
      phoneField, nameField
    ]),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        onClick: async () => {
          try {
            const { contact } = await api.addContact({ phone: phoneInput.value, name: nameInput.value });
            putUsers([contact]);
            toast(`${contact.contactName} wurde gespeichert.`);
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

/* ----------------------------- Einstellungen ---------------------------- */
export function settingsDialog() {
  const me = state.me;
  const avatar = avatarEl(me, 'avatar-xl');
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });

  const pick = el('button', {
    class: 'btn-text', type: 'button', text: 'Profilbild ändern',
    onclick: () => fileInput.click()
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const result = await api.upload(file);
      const { user } = await api.updateMe({ avatar: result.url });
      state.me = user;
      putUsers([user]);
      avatar.textContent = '';
      avatar.style.background = `var(--accent) url(${user.avatar}) center/cover`;
      emit('me');
      toast('Profilbild aktualisiert');
    } catch (err) { toast(err.message, 'error'); }
  });

  const removeAvatar = el('button', {
    class: 'btn-text', type: 'button', text: 'Bild entfernen',
    onclick: async () => {
      try {
        const { user } = await api.updateMe({ avatar: null });
        state.me = user;
        putUsers([user]);
        avatar.style.background = user.color;
        avatar.textContent = initials(user.name);
        emit('me');
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  const { field: nameField, input: nameInput } = fieldInput('Name', me.name);
  const { field: aboutField, input: aboutInput } = fieldInput('Über mich', me.about || '', { maxlength: 140 });

  const body = el('div', {}, [
    el('div', { style: 'display:grid;place-items:center;gap:6px;margin-bottom:18px' }, [
      avatar,
      el('div', { style: 'display:flex;gap:4px' }, [pick, me.avatar ? removeAvatar : null]),
      fileInput
    ]),
    nameField,
    aboutField,
    el('div', { style: 'display:flex;justify-content:flex-start;margin:-6px 0 6px' }, [
      el('button', { class: 'btn-text', type: 'button', text: 'Passwort ändern', onclick: passwordDialog })
    ]),
    el('p', { text: `Deine Nummer: ${me.phone}` })
  ]);

  openModal({
    title: 'Einstellungen',
    body,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        onClick: async () => {
          try {
            const { user } = await api.updateMe({ name: nameInput.value.trim(), about: aboutInput.value.trim() });
            state.me = user;
            putUsers([user]);
            emit('me');
            emit('chats');
            toast('Profil gespeichert');
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

function passwordDialog() {
  const { field: currentField, input: currentInput } = fieldInput('Aktuelles Passwort', '', { type: 'password' });
  const { field: nextField, input: nextInput } = fieldInput('Neues Passwort', '', { type: 'password' });
  openModal({
    title: 'Passwort ändern',
    body: el('div', {}, [currentField, nextField]),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Ändern',
        onClick: async () => {
          try {
            await api.changePassword({ current: currentInput.value, next: nextInput.value });
            toast('Passwort geändert');
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

/* ------------------------------- Abmelden ------------------------------- */
function logout() {
  confirmDialog({
    title: 'Abmelden?',
    text: 'Du kannst dich jederzeit wieder mit deiner Nummer anmelden.',
    confirmLabel: 'Abmelden',
    danger: true,
    onConfirm: async () => {
      await api.logout().catch(() => {});
      disconnect();
      clearToken();
      location.reload();
    }
  });
}

/* ----------------------------- Initialisierung -------------------------- */
export function initDialogs() {
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#drawerScrim').addEventListener('click', closeDrawer);
  $('#newChatBtn').addEventListener('click', newChatDialog);

  $('#drawer').addEventListener('click', (event) => {
    const item = event.target.closest('.drawer-item');
    if (!item) return;
    const action = item.dataset.action;
    if (action !== 'theme') closeDrawer();
    switch (action) {
      case 'new-group': newGroupDialog(); break;
      case 'contacts': contactsDialog(); break;
      case 'settings': settingsDialog(); break;
      case 'archived': {
        state.filter = 'archived';
        for (const tab of $('#sidebarTabs').children) tab.classList.toggle('active', tab.dataset.filter === 'archived');
        emit('chats');
        break;
      }
      case 'theme': applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); break;
      case 'logout': logout(); break;
    }
  });
}
