// Rechtes Infopanel: Profil bzw. Gruppeninfo, Mitglieder und geteilte Medien.
import { $, el, svg, ICONS, avatarEl, lastSeenLabel, toast } from './util.js';
import { state, getUser, getMessages, putChat, putUsers, removeChat } from './state.js';
import { api } from './api.js';
import { openModal, confirmDialog, openLightbox, fieldInput } from './ui.js';

export function closeInfo() {
  const panel = $('#infoPanel');
  panel.hidden = true;
  panel.replaceChildren();
}

function infoRow(icon, value, label, onClick) {
  return el(onClick ? 'button' : 'div', {
    class: `info-row${onClick ? ' info-toggle' : ''}`,
    ...(onClick ? { onclick: onClick, type: 'button' } : {})
  }, [
    el('span', { html: svg(icon, 20) }),
    el('span', { style: 'text-align:left' }, [
      el('div', { class: 'info-value', text: value }),
      el('div', { class: 'info-label', text: label })
    ])
  ]);
}

function toggleRow(icon, label, active, onChange) {
  const knob = el('span', { class: `switch${active ? ' on' : ''}` });
  return el('button', {
    class: 'info-row info-toggle', type: 'button',
    onclick: () => { knob.classList.toggle('on'); onChange(knob.classList.contains('on')); }
  }, [
    el('span', { html: svg(icon, 20) }),
    el('span', { style: 'flex:1;text-align:left' }, [el('div', { class: 'info-value', text: label })]),
    knob
  ]);
}

export function openChatInfo(chat) {
  if (!chat) return;
  const panel = $('#infoPanel');
  const isGroup = chat.type === 'group';
  const peer = isGroup ? null : (getUser(chat.peer?.id) || chat.peer);

  const hero = el('div', { class: 'info-hero' }, [
    avatarEl({ ...chat, online: peer?.online }, 'avatar-xl'),
    el('div', { class: 'info-name', text: chat.title }),
    el('div', { class: 'info-status', text: isGroup ? `${chat.memberIds.length} Mitglieder` : lastSeenLabel(peer) })
  ]);

  const details = el('div', { class: 'info-block' });
  if (peer) {
    details.append(infoRow(ICONS.phone, peer.phone, 'Telefon', () => copy(peer.phone)));
    if (peer.about) details.append(infoRow(ICONS.info, peer.about, 'Info'));
    const known = !!chat.contactName;
    details.append(infoRow(ICONS.users, known ? 'Kontakt bearbeiten' : 'Zu Kontakten hinzufügen', 'Adressbuch', () => contactDialog(peer)));
  } else {
    details.append(infoRow(ICONS.users, `${chat.memberIds.length} Mitglieder`, 'Gruppe'));
    if (chat.ownerId === state.me?.id) {
      details.append(infoRow(ICONS.edit, 'Gruppennamen ändern', 'Verwaltung', () => renameGroup(chat)));
      details.append(infoRow(ICONS.users, 'Mitglieder hinzufügen', 'Verwaltung', () => addMembersDialog(chat)));
    }
  }

  const settings = el('div', { class: 'info-block' }, [
    toggleRow(chat.muted ? ICONS.mute : ICONS.sound, 'Benachrichtigungen', !chat.muted, async (on) => {
      putChat({ ...chat, muted: !on });
      await api.updateChat(chat.id, { muted: !on }).catch(() => {});
    }),
    toggleRow(ICONS.archive, 'Archiviert', chat.archived, async (on) => {
      putChat({ ...chat, archived: on });
      await api.updateChat(chat.id, { archived: on }).catch(() => {});
    })
  ]);

  const blocks = [hero, details, settings];

  if (isGroup) {
    const members = el('div', { class: 'info-block info-members' }, [
      el('div', { class: 'list-section', text: 'Mitglieder' }),
      ...chat.memberIds.map((memberId) => {
        const member = getUser(memberId);
        return el('div', { class: 'result-item' }, [
          avatarEl(member || { name: '?' }, 'avatar-sm'),
          el('div', { class: 'result-body' }, [
            el('div', { class: 'result-title', text: (member?.name || 'Unbekannt') + (memberId === state.me?.id ? ' (du)' : '') }),
            el('div', { class: 'result-sub', text: memberId === chat.ownerId ? 'Administrator' : lastSeenLabel(member) })
          ]),
          chat.ownerId === state.me?.id && memberId !== state.me?.id
            ? el('button', {
                class: 'icon-btn', title: 'Entfernen', html: svg(ICONS.close, 18),
                onclick: async () => {
                  try {
                    const data = await api.updateChat(chat.id, { removeMember: memberId });
                    putChat(data.chat);
                    putUsers(data.members);
                    openChatInfo(data.chat);
                  } catch (err) { toast(err.message, 'error'); }
                }
              })
            : null
        ]);
      })
    ]);
    blocks.push(members);
  }

  const media = getMessages(chat.id).filter((m) => m.attachment?.kind === 'image' && !m.deleted);
  if (media.length) {
    blocks.push(el('div', { class: 'info-block' }, [
      el('div', { class: 'list-section', text: `Geteilte Medien (${media.length})` }),
      el('div', { class: 'media-grid' }, media.slice(-30).reverse().map((m) =>
        el('img', { src: m.attachment.url, alt: '', loading: 'lazy', onclick: () => openLightbox(m.attachment.url, m.attachment.name) })
      ))
    ]));
  }

  blocks.push(el('div', { class: 'info-block' }, [
    el('button', {
      class: 'info-row info-toggle', type: 'button',
      style: 'color:var(--danger)',
      onclick: () => confirmDialog({
        title: isGroup ? 'Gruppe verlassen?' : 'Chat löschen?',
        text: isGroup ? `Du verlässt „${chat.title}“.` : `Der Chat mit ${chat.title} wird für beide Seiten gelöscht.`,
        confirmLabel: isGroup ? 'Verlassen' : 'Löschen',
        danger: true,
        onConfirm: async () => {
          try {
            await api.deleteChat(chat.id);
            removeChat(chat.id);
            closeInfo();
            const { closeChat } = await import('./chat.js');
            closeChat();
          } catch (err) { toast(err.message, 'error'); }
        }
      })
    }, [
      el('span', { html: svg(isGroup ? ICONS.exit : ICONS.trash, 20), style: 'color:var(--danger)' }),
      el('span', { class: 'info-value', style: 'color:var(--danger)', text: isGroup ? 'Gruppe verlassen' : 'Chat löschen' })
    ])
  ]));

  panel.replaceChildren(
    el('div', { class: 'info-head' }, [
      el('button', { class: 'icon-btn', html: svg(ICONS.close, 22), onclick: closeInfo, title: 'Schließen' }),
      el('span', { text: isGroup ? 'Gruppeninfo' : 'Profil' })
    ]),
    ...blocks
  );
  panel.hidden = false;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert'); } catch { /* egal */ }
}

function contactDialog(user) {
  const { field, input } = fieldInput('Name im Adressbuch', user.name);
  openModal({
    title: 'Kontakt speichern',
    body: el('div', {}, [el('p', { text: user.phone }), field]),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        onClick: async () => {
          try {
            await api.addContact({ phone: user.phone, name: input.value.trim() || user.name });
            toast('Kontakt gespeichert');
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

function renameGroup(chat) {
  const { field, input } = fieldInput('Gruppenname', chat.title);
  openModal({
    title: 'Gruppe umbenennen',
    body: field,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern',
        onClick: async () => {
          const title = input.value.trim();
          if (!title) return false;
          try {
            const data = await api.updateChat(chat.id, { title });
            putChat(data.chat);
            openChatInfo(data.chat);
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}

async function addMembersDialog(chat) {
  let candidates = [];
  try {
    const { contacts } = await api.contacts();
    candidates = contacts.filter((c) => !chat.memberIds.includes(c.id));
  } catch { /* ohne Kontakte weiter */ }

  if (candidates.length === 0) {
    toast('Keine weiteren Kontakte. Füge zuerst Kontakte hinzu.');
    return;
  }
  const chosen = new Set();
  const body = el('div', { class: 'pick-list' }, candidates.map((user) => {
    const node = el('div', { class: 'pick-item', onclick: () => {
      if (chosen.has(user.id)) chosen.delete(user.id); else chosen.add(user.id);
      node.classList.toggle('on', chosen.has(user.id));
    } }, [
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
    title: 'Mitglieder hinzufügen',
    body,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Hinzufügen',
        onClick: async () => {
          if (chosen.size === 0) return false;
          try {
            const data = await api.updateChat(chat.id, { addMembers: [...chosen] });
            putChat(data.chat);
            putUsers(data.members);
            openChatInfo(data.chat);
          } catch (err) { toast(err.message, 'error'); return false; }
        }
      }
    ]
  });
}
