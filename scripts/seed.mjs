// Legt Demo-Konten samt Beispielchats an, damit man sofort loslegen kann.
// Aufruf: npm run seed   (der Server darf dabei nicht laufen)
import { db, saveSync } from '../server/store.js';
import { hashPassword } from '../server/auth.js';
import { createUser, createPrivateChat, createGroupChat, systemMessage } from '../server/model.js';

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

// Beispielnachrichten kann dieses Skript nicht anlegen: Inhalte werden erst
// im Browser verschlüsselt, und den Chatschlüssel gibt es nur dort. Angelegt
// werden Konten, Kontakte und die leeren Chats.
createPrivateChat(anna.id, ben.id);
const group = createGroupChat(anna.id, [ben.id, clara.id], 'Projekt Nordlicht');
systemMessage(group, `${anna.name} hat die Gruppe „Projekt Nordlicht“ erstellt`);

db.messages.sort((a, b) => a.ts - b.ts);
saveSync();

console.log('Demodaten angelegt. Anmelden mit dem Passwort:', PASSWORD);
for (const person of PEOPLE) console.log(`  ${person.phone}  –  ${person.name}`);
console.log(`\nAngelegt: ein Einzelchat (${anna.name} ↔ ${ben.name}) und die Gruppe „${group.title}“.`);
console.log('Nachrichten schreibt ihr im Browser — verschlüsselt werden sie dort.');
