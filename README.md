# TeleGroove

Ein **WhatsApp-Klon im Telegram-Design**: ein voll funktionsfähiger Echtzeit-Messenger
mit Konten, Kontakten, Einzel- und Gruppenchats, Medien, Sprachnachrichten,
Lesebestätigungen und Nachtmodus.

Läuft **ohne eine einzige npm-Abhängigkeit** — inklusive selbst implementiertem
WebSocket-Server. Node.js 18+ genügt.

```bash
node scripts/seed.mjs   # optional: Demo-Konten anlegen
npm start               # http://localhost:3000
```

---

## Schnellstart

```bash
git clone <dieses-repo>
cd smartbuddyguard
npm run seed            # legt drei Demo-Konten mit Beispielchats an
npm start
```

Dann `http://localhost:3000` öffnen. Die Demo-Konten haben alle das Passwort
`demo1234`:

| Nummer            | Name           |
|-------------------|----------------|
| `+49 170 0000001` | Anna Beispiel  |
| `+49 170 0000002` | Ben Muster     |
| `+49 170 0000003` | Clara Schmidt  |

Zum Ausprobieren zu zweit: ein zweites Browserfenster im **privaten Modus**
öffnen und dort ein anderes Konto benutzen — Nachrichten, Tippanzeige und
Häkchen laufen zwischen beiden Fenstern live.

Ohne `npm run seed` startet die App leer; jeder legt sich über **Registrieren**
selbst ein Konto an.

### Konfiguration

| Variable                | Standard   | Bedeutung                                       |
|-------------------------|------------|-------------------------------------------------|
| `PORT`                  | `3000`     | Port des Servers                                 |
| `HOST`                  | `0.0.0.0`  | Netzwerkschnittstelle                            |
| `DATA_DIR`              | `./data`   | Ablage für `db.json` und Uploads                 |
| `DEFAULT_COUNTRY_CODE`  | `49`       | Vorwahl für national geschriebene Nummern (`0170…`) |

Im Handynetz oder LAN testen: `HOST=0.0.0.0 npm start` und vom Handy die
IP-Adresse des Rechners aufrufen. Die App ist eine PWA und lässt sich über
„Zum Home-Bildschirm“ installieren.

---

## Funktionen

**Konten & Kontakte**
- Registrierung und Anmeldung mit Telefonnummer und Passwort
  (scrypt-Hash, 90 Tage gültige Sitzungs-Tokens)
- Nummern werden normalisiert: `0170 1234567`, `0049 170 1234567` und
  `+49 170 1234567` treffen dasselbe Konto
- Profil mit Name, Info-Text und Profilbild, Passwortwechsel
- Adressbuch mit eigenen Anzeigenamen, Nutzersuche über Name oder Nummer

**Chats**
- Einzelchats und Gruppen mit Administrator, Mitgliederverwaltung und
  Systemmeldungen („X hat die Gruppe erstellt“)
- Anheften, Stummschalten, Archivieren; Filter für *Alle / Ungelesen /
  Gruppen / Archiv* mit Zählern
- Suche über Chats, Nutzer und Nachrichteninhalte, dazu eine Suche
  innerhalb eines Chats mit Treffer-Hervorhebung
- Entwürfe bleiben pro Chat erhalten, auch nach einem Gerätewechsel

**Nachrichten**
- Echtzeitversand über WebSocket, optimistisch dargestellt und mit
  Sanduhr-Symbol bis zur Bestätigung
- Status wie bei WhatsApp: ein Haken (gesendet), zwei Haken (zugestellt),
  zwei farbige Haken (gelesen)
- Antworten mit Zitat, Weiterleiten, Bearbeiten (Pfeil-hoch bearbeitet die
  letzte eigene Nachricht), Löschen für alle
- Emoji-Reaktionen, Emoji-Auswahl mit Kategorien und Verlauf
- Bilder, Videos, Audio und beliebige Dateien bis 25 MB per Büroklammer,
  Drag & Drop oder Einfügen aus der Zwischenablage; Bilder in der Großansicht
- Sprachnachrichten mit eigenem Abspieler und Wellenanzeige
- Tippanzeige, Online-Status und „zuletzt gesehen“
- Tagestrenner, Nachrichtenbündelung, Sprechblasen-Zipfel, Verlauf wird
  beim Hochscrollen nachgeladen

**Oberfläche**
- Telegram-Optik: Seitenleiste mit Chatliste, gemustertes Chat-Hintergrundbild,
  grüne bzw. blaue eigene Sprechblasen, Infopanel rechts
- Heller Modus und Nachtmodus (Telegram-„Night“-Palette), Wechsel im Menü
- Vollständig responsiv: am Handy wird die Chatliste zur Vollbildansicht
- PWA mit Service Worker, Icons und Offline-Hülle
- Desktop-Benachrichtigungen mit Ton, ungelesene Anzahl im Seitentitel

---

## Aufbau

```
server/
  index.js    HTTP-Server: statische Dateien, Medien, Range-Requests, Upgrade
  ws.js       WebSocket-Server nach RFC 6455 (Handshake, Frames, Ping/Pong)
  hub.js      Echtzeit: Präsenz, Zustellung, Tippen, Lesebestätigungen
  api.js      REST-Endpunkte
  model.js    Fachlogik: Chats, Nachrichten, Aufbereitung für den Client
  auth.js     scrypt-Hashing, Sitzungen, Nummernnormalisierung
  store.js    JSON-Persistenz mit gepufferten, atomaren Schreibvorgängen
public/
  index.html  Grundgerüst
  css/app.css Gesamtes Design inklusive beider Themes
  js/         app · api · state · socket · chat · chatlist · composer ·
              dialogs · info · emoji · ui · util
scripts/
  seed.mjs        Demo-Konten und Beispielchats
  make-icons.mjs  PWA-Icons als PNG, ohne Bildbibliothek
```

Daten liegen in `data/db.json`, Uploads in `data/uploads/`. Beides ist über
`.gitignore` ausgenommen; zum Zurücksetzen einfach den Ordner `data/` löschen.

### Warum ohne Abhängigkeiten?

`npm install` entfällt komplett — die App startet auf jedem Rechner mit Node 18+
sofort. Der WebSocket-Server (`server/ws.js`) implementiert den Handshake und
das Frame-Format selbst; Passwörter nutzen `node:crypto`, die Persistenz das
Dateisystem.

---

## Schnittstellen

### REST (`Authorization: Bearer <token>`)

| Methode  | Pfad                        | Zweck                                  |
|----------|-----------------------------|----------------------------------------|
| `POST`   | `/api/auth/register`        | Konto anlegen                          |
| `POST`   | `/api/auth/login`           | Anmelden                               |
| `POST`   | `/api/auth/logout`          | Sitzung beenden                        |
| `GET`    | `/api/me`                   | Eigenes Profil und bekannte Nutzer     |
| `PATCH`  | `/api/me`                   | Name, Info, Profilbild ändern          |
| `POST`   | `/api/me/password`          | Passwort wechseln                      |
| `GET`    | `/api/chats`                | Chatliste                              |
| `POST`   | `/api/chats`                | Einzelchat oder Gruppe anlegen         |
| `PATCH`  | `/api/chats/:id`            | Anheften, Stumm, Archiv, Titel, Mitglieder |
| `DELETE` | `/api/chats/:id`            | Chat löschen bzw. Gruppe verlassen     |
| `GET`    | `/api/chats/:id/messages`   | Verlauf (`before`, `limit`)            |
| `GET`    | `/api/users/search?q=`      | Nutzersuche                            |
| `GET`    | `/api/contacts`             | Adressbuch                             |
| `POST`   | `/api/contacts`             | Kontakt speichern                      |
| `DELETE` | `/api/contacts/:userId`     | Kontakt entfernen                      |
| `GET`    | `/api/search?q=`            | Nachrichtensuche                       |
| `POST`   | `/api/upload`               | Datei hochladen (Rohdaten im Rumpf)    |

### WebSocket `/ws?token=…`

Client → Server: `message:send`, `message:edit`, `message:delete`,
`message:react`, `typing`, `read`, `draft`, `ping`

Server → Client: `ready`, `message`, `message:update`, `chat`, `chat:removed`,
`user`, `presence`, `typing`, `read`, `read:self`, `delivered`, `error`, `pong`

---

## Bekannte Grenzen

Das Projekt ist als vollständig nutzbarer Messenger gebaut, aber nicht als
gehärteter Produktionsdienst:

- **Keine Ende-zu-Ende-Verschlüsselung.** Nachrichten liegen im Klartext in
  `data/db.json`. Für den Betrieb im Netz gehört ein TLS-Terminator (z. B.
  nginx oder Caddy) davor.
- **Hochgeladene Dateien sind über ihre URL ohne Anmeldung abrufbar.** Die
  Namen sind zufällig, aber nicht geheim.
- **Keine Telefonnummern-Verifikation per SMS** — die Nummer ist Benutzername,
  nicht mehr.
- **JSON-Datei statt Datenbank.** Für einige tausend Nachrichten völlig
  ausreichend, für den Massenbetrieb wäre SQLite oder Postgres der nächste
  Schritt.
- Ein einzelner Serverprozess; horizontal skaliert wird nicht.

---

## Entwicklung

```bash
npm run dev     # Server mit --watch neu starten
npm run seed    # Demodaten (nur bei leerer Datenbank)
npm run icons   # PWA-Icons neu erzeugen
```
