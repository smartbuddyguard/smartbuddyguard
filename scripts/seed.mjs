// Legt Demo-Konten samt Beispielchats an, damit man sofort loslegen kann.
// Aufruf: npm run seed   (der Server darf dabei nicht laufen)
import { db, saveSync } from '../server/store.js';
import { hashPassword } from '../server/auth.js';
import { createUser, createPrivateChat, createGroupChat, addMessage, systemMessage } from '../server/model.js';

const PASSWORD = 'demo1234';

const PEOPLE = [
  { phone: '+491700000001', name: 'Anna Beispiel', about: 'Designerin ☕ · Berlin' },
  { phone: '+491700000002', name: 'Ben Muster', about: 'Läuft. Meistens.' },
  { phone: '+491700000003', name: 'Clara Schmidt', about: 'Reist gern, schreibt selten.' }
];

if (db.users.length > 0) {
  console.log('Es gibt bereits Konten – die Demodaten werden übersprungen.');
  console.log('Für einen Neustart: Ordner data/ löschen und erneut ausführen.');
  process.exit(0);
}

const users = PEOPLE.map((person) => {
  const { hash, salt } = hashPassword(PASSWORD);
  const user = createUser({ phone: person.phone, name: person.name, hash, salt });
  user.about = person.about;
  return user;
});

const [anna, ben, clara] = users;

// Kontakte gegenseitig eintragen
for (const owner of users) {
  for (const other of users) {
    if (owner.id === other.id) continue;
    db.contacts.push({ ownerId: owner.id, userId: other.id, name: other.name, createdAt: Date.now() });
  }
}

const minutes = (n) => Date.now() - n * 60000;

const privateChat = createPrivateChat(anna.id, ben.id);
const conversation = [
  [ben, 'Hey Anna! Läuft der neue Messenger schon?', 48],
  [anna, 'Klar 🙂 Gruppen, Sprachnachrichten und Lesebestätigungen sind drin.', 46],
  [ben, 'Und Dateien?', 45],
  [anna, 'Auch. Einfach reinziehen oder auf die Büroklammer tippen.', 44],
  [ben, 'Stark. Dann verschieben wir das Meeting auf morgen 10 Uhr?', 12],
  [anna, 'Passt! Ich lege gleich eine Gruppe an. 👍', 10]
];
for (const [sender, text, ago] of conversation) {
  const message = addMessage(privateChat, sender.id, { text });
  message.ts = minutes(ago);
  message.readBy = [anna.id, ben.id];
  message.deliveredTo = [anna.id, ben.id];
}
privateChat.lastMessageAt = minutes(10);

const group = createGroupChat(anna.id, [ben.id, clara.id], 'Projekt Nordlicht');
const created = systemMessage(group, `${anna.name} hat die Gruppe „Projekt Nordlicht“ erstellt`);
created.ts = minutes(40);
const groupTalk = [
  [anna, 'Willkommen! Hier sammeln wir alles zum Release.', 38],
  [clara, 'Super. Ich bringe die Screenshots mit.', 30],
  [ben, 'Und ich kümmere mich um die Testkonten.', 22]
];
for (const [sender, text, ago] of groupTalk) {
  const message = addMessage(group, sender.id, { text });
  message.ts = minutes(ago);
  message.readBy = [sender.id];
  message.deliveredTo = [sender.id];
}
group.lastMessageAt = minutes(22);

db.messages.sort((a, b) => a.ts - b.ts);
saveSync();

console.log('Demodaten angelegt. Anmelden mit dem Passwort:', PASSWORD);
for (const person of PEOPLE) console.log(`  ${person.phone}  –  ${person.name}`);
