// Wiederverwendbare Overlays: Kontextmenü, Dialog, Bildansicht.
import { $, el, svg, ICONS } from './util.js';

/* ------------------------------ Kontextmenü ----------------------------- */
export function closeMenu() {
  const root = $('#menuRoot');
  root.hidden = true;
  root.replaceChildren();
}

/**
 * items: [{ label, icon, danger, onClick }] oder 'sep'
 */
export function openMenu(x, y, items) {
  const root = $('#menuRoot');
  const menu = el('div', { class: 'menu' });
  for (const item of items) {
    if (item === 'sep') { menu.append(el('hr')); continue; }
    if (!item) continue;
    menu.append(el('button', {
      type: 'button',
      class: item.danger ? 'danger' : '',
      html: `${item.icon ? svg(item.icon, 19) : ''}<span>${item.label}</span>`,
      onclick: () => { closeMenu(); item.onClick?.(); }
    }));
  }
  root.replaceChildren(menu);
  root.hidden = false;

  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + 'px';

  const dismiss = (event) => {
    if (!menu.contains(event.target)) { closeMenu(); document.removeEventListener('mousedown', dismiss, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

/* -------------------------------- Dialog -------------------------------- */
export function closeModal() {
  const root = $('#modalRoot');
  root.hidden = true;
  root.replaceChildren();
}

/**
 * openModal({ title, body: Node|string, actions: [{label, primary, danger, onClick}] })
 * `onClick` darf false zurückgeben, um den Dialog offen zu halten.
 */
export function openModal({ title, body, actions = [], onClose, wide = false }) {
  const root = $('#modalRoot');
  const bodyNode = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.append(body);

  const foot = el('div', { class: 'modal-foot' });
  for (const action of actions) {
    foot.append(el('button', {
      type: 'button',
      class: `btn-text ${action.danger ? 'danger' : ''}`.trim(),
      text: action.label,
      onclick: async () => {
        const keep = await action.onClick?.();
        if (keep !== false) closeModal();
      }
    }));
  }

  const modal = el('div', { class: 'modal', style: wide ? 'width:min(520px,100%)' : '' }, [
    title ? el('h2', { text: title }) : null,
    bodyNode,
    actions.length ? foot : null
  ]);

  root.replaceChildren(modal);
  root.hidden = false;
  root.onmousedown = (event) => { if (event.target === root) { closeModal(); onClose?.(); } };
  setTimeout(() => modal.querySelector('input, textarea')?.focus(), 30);
  return modal;
}

export function confirmDialog({ title, text, confirmLabel = 'OK', danger = false, onConfirm }) {
  openModal({
    title,
    body: el('p', { text }),
    actions: [
      { label: 'Abbrechen' },
      { label: confirmLabel, danger, onClick: onConfirm }
    ]
  });
}

/** Einfaches Eingabefeld im Dialog. */
export function fieldInput(label, value = '', attrs = {}) {
  const input = el('input', { type: 'text', placeholder: ' ', value, ...attrs });
  const field = el('label', { class: 'field' }, [input, el('span', { text: label })]);
  return { field, input };
}

/* ------------------------------ Bildansicht ----------------------------- */
export function openLightbox(url, name = 'bild') {
  const box = $('#lightbox');
  box.replaceChildren(
    el('img', { src: url, alt: name }),
    el('a', {
      class: 'icon-btn lb-download', href: url, download: name, title: 'Herunterladen',
      html: svg(ICONS.download), onclick: (e) => e.stopPropagation()
    }),
    el('button', { class: 'icon-btn lb-close', html: svg(ICONS.close), title: 'Schließen' })
  );
  box.hidden = false;
  box.onclick = () => { box.hidden = true; box.replaceChildren(); };
  const onKey = (event) => {
    if (event.key === 'Escape') { box.hidden = true; box.replaceChildren(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#menuRoot').hidden) closeMenu();
  else if (!$('#modalRoot').hidden) closeModal();
});
