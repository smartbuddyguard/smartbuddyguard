// Emoji-Auswahl ohne externe Bibliothek: kuratierte Sets nach Kategorien.
import { el } from './util.js';

export const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '🎉'];

const RECENT_KEY = 'telegroove.recentEmoji';

export const CATEGORIES = [
  {
    icon: '🙂', name: 'Smileys',
    list: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾']
  },
  {
    icon: '👍', name: 'Gesten',
    list: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻','👃','🧠','🫀','🦷','👀','👁','👅','👄','💋','👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','👷','🤴','👸','👰','🤵','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','👼','🫂']
  },
  {
    icon: '🐻', name: 'Tiere',
    list: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🦓','🦍','🐘','🦛','🐪','🦒','🐃','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓','🦃','🦚','🦜','🦢','🕊','🐇','🦝','🦡','🐿','🦔','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎋','🍃','🍂','🍁','🌾','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌚','🌙','⭐','🌟','✨','⚡','🔥','🌈','☀️','⛅','☁️','🌧','⛈','❄️','⛄','💧','🌊']
  },
  {
    icon: '🍕', name: 'Essen',
    list: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🧆','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍥','🥠','🍢','🍡','🍦','🍰','🎂','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍿','🧂','🥤','🧃','🧉','☕','🍵','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾']
  },
  {
    icon: '⚽', name: 'Aktivität',
    list: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸','🥌','🎿','⛷','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖','🎗','🎫','🎟','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟','🎯','🎳','🎮','🕹','🧩']
  },
  {
    icon: '✈️', name: 'Reisen',
    list: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🛴','🚲','🛵','🏍','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩','💺','🛰','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','⛴','🚢','⚓','⛽','🚧','🚦','🚥','🗺','🗿','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛱','🏖','🏝','🏜','🌋','⛰','🏔','🗻','🏕','⛺','🏠','🏡','🏘','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛','⛪','🕌','🕍','🛕','🌃','🌆','🌇','🌉','🌌']
  },
  {
    icon: '💡', name: 'Objekte',
    list: ['⌚','📱','💻','⌨️','🖥','🖨','🖱','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📟','📠','📺','📻','🎙','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🧯','🛢','💸','💵','💰','💳','💎','⚖️','🔧','🔨','⚒','🛠','⛏','🔩','⚙️','🧱','⛓','🧲','🔫','💣','🧨','🪓','🔪','🗡','⚔️','🛡','🚬','⚰️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳','💊','💉','🩸','🩹','🩺','🌡','🧬','🦠','🧫','🧪','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🧼','🪒','🧽','🧴','🛎','🔑','🗝','🚪','🪑','🛋','🛏','🧸','🖼','🛍','🛒','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🏮','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','📊','📈','📉','🗒','🗓','📆','📅','📇','🗃','🗳','🗄','📋','📁','📂','🗂','🗞','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🔗','📎','🖇','📐','📏','📌','📍','✂️','🖊','🖋','✒️','🖌','🖍','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓']
  },
  {
    icon: '❤️', name: 'Symbole',
    list: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❓','❕','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸','⏹','⏺','⏭','⏮','⏩','⏪','🔀','🔁','🔂','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔃','🔄','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈']
  }
];

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

function remember(emoji) {
  const list = [emoji, ...recent().filter((e) => e !== emoji)].slice(0, 32);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

let openPanel = null;

export function closeEmojiPanel() {
  openPanel?.remove();
  openPanel = null;
  document.removeEventListener('mousedown', outsideClick, true);
}

function outsideClick(event) {
  if (openPanel && !openPanel.contains(event.target)) closeEmojiPanel();
}

/**
 * Emoji-Panel an einem Anker öffnen.
 * `onPick(emoji)` wird bei jeder Auswahl aufgerufen.
 */
export function openEmojiPanel(anchor, onPick, { closeOnPick = false } = {}) {
  if (openPanel) { closeEmojiPanel(); return; }

  const grid = el('div', { class: 'emoji-grid' });
  const tabs = el('div', { class: 'emoji-tabs' });
  const panel = el('div', { class: 'emoji-panel' }, [tabs, grid]);

  const sets = [];
  const recents = recent();
  if (recents.length) sets.push({ icon: '🕘', name: 'Zuletzt', list: recents });
  sets.push(...CATEGORIES);

  const show = (index) => {
    grid.replaceChildren(...sets[index].list.map((emoji) => el('button', {
      type: 'button', text: emoji, title: emoji,
      onclick: () => { remember(emoji); onPick(emoji); if (closeOnPick) closeEmojiPanel(); }
    })));
    [...tabs.children].forEach((tab, i) => tab.classList.toggle('active', i === index));
    grid.scrollTop = 0;
  };

  sets.forEach((set, i) => tabs.append(el('button', {
    type: 'button', text: set.icon, title: set.name, onclick: () => show(i)
  })));

  document.body.append(panel);
  show(0);

  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
  panel.style.top = (rect.top - height - 8 > 8 ? rect.top - height - 8 : rect.bottom + 8) + 'px';

  openPanel = panel;
  setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
  return panel;
}

/** Kleine Reaktionsleiste über einer Nachricht. */
export function openReactionBar(anchor, onPick) {
  closeEmojiPanel();
  const bar = el('div', { class: 'reaction-bar' },
    QUICK_REACTIONS.map((emoji) => el('button', {
      type: 'button', text: emoji, onclick: () => { onPick(emoji); closeEmojiPanel(); }
    }))
  );
  document.body.append(bar);
  const rect = anchor.getBoundingClientRect();
  bar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - bar.offsetWidth - 8)) + 'px';
  bar.style.top = (rect.top - bar.offsetHeight - 6 > 8 ? rect.top - bar.offsetHeight - 6 : rect.bottom + 6) + 'px';
  openPanel = bar;
  setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
}
