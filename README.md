# BuddyChat

**by Smartbuddyguard**

Ein Messenger im Telegram-Design mit **Ende-zu-Ende-Verschlüsselung**,
**Sprachnachrichten** und **Videoanrufen** — Einzel- und Gruppenchats,
Lesebestätigungen, Nachtmodus, als PWA auch auf dem Handy.

Läuft **ohne eine einzige npm-Abhängigkeit**: eigener WebSocket-Server,
Verschlüsselung über die WebCrypto-API des Browsers, Anrufe über WebRTC.
Node.js 18+ genügt.

```bash
npm run seed    # optional: Demo-Konten anlegen
npm start       # http://localhost:3000
```

---

## Schnellstart

```bash
git clone <dieses-repo>
cd smartbuddyguard
npm run seed
npm start
```

`http://localhost:3000` öffnen. Die Demo-Konten haben alle das Passwort
`demo1234`:

| Nummer            | Name           |
|-------------------|----------------|
| `+49 170 0000001` | Anna Beispiel  |
| `+49 170 0000002` | Ben Muster     |
| `+49 170 0000003` | Clara Schmidt  |

Zum Ausprobieren zu zweit ein zweites Browserfenster im **privaten Modus**
öffnen und dort ein anderes Konto benutzen. Nachrichten, Tippanzeige, Häkchen
und Anrufe laufen zwischen beiden Fenstern live.

> **Kamera und Mikrofon** geben Browser nur in einem sicheren Kontext frei:
> `localhost` funktioniert, im Netzwerk braucht es HTTPS. Ohne das bleiben
> Sprachnachrichten und Anrufe gesperrt — die App sagt das dann auch.

### Konfiguration

| Variable                | Standard   | Bedeutung                                            |
|-------------------------|------------|------------------------------------------------------|
| `PORT`                  | `3000`     | Port des Servers                                      |
| `HOST`                  | `0.0.0.0`  | Netzwerkschnittstelle                                 |
| `DATA_DIR`              | `./data`   | Ablage für `db.json` und hochgeladene Dateien         |
| `DEFAULT_COUNTRY_CODE`  | `49`       | Vorwahl für national geschriebene Nummern (`0170…`)   |

---

## Verschlüsselung

Inhalte werden **auf dem Gerät** ver- und entschlüsselt. Der Server transportiert
und speichert nur Chiffretext — in `data/db.json` steht bei jeder Nachricht
lediglich `{ iv, ct }`.

**So läuft es ab**

1. Jedes Gerät erzeugt beim ersten Anmelden ein **ECDH-Schlüsselpaar** (P-256).
   Der private Teil bleibt im Browser und verlässt ihn nie; der öffentliche
   liegt im Profil.
2. Jeder Chat hat einen **AES-GCM-256-Schlüssel**. Wer den Chat anlegt, erzeugt ihn.
3. Dieser Chatschlüssel wird für **jedes Mitglied einzeln verpackt**: aus dem
   eigenen privaten und dem fremden öffentlichen Schlüssel entsteht per ECDH
   ein gemeinsames Geheimnis, daraus per HKDF ein Umschlagschlüssel. Der Server
   speichert nur das verschlossene Paket.
4. Fehlt einem Gerät der Schlüssel, fragt es ihn über den Server an. Jedes
   Mitglied, das ihn hat, packt ihn für die anfragende Person ein.
5. **Text, Zitate, Anhänge und Sprachnachrichten** liegen in einem einzigen
   verschlüsselten Block. Dateien werden vor dem Hochladen verschlüsselt; auf
   der Platte liegen sie als undurchsichtige Bytes.

**Sicherheitsnummer.** In der Chat-Info eines Einzelchats steht ein
Fingerabdruck beider öffentlicher Schlüssel. Vergleicht ihr die Zahl über einen
anderen Weg — Telefon, persönlich — und sie stimmt überein, hört niemand mit.

**Was ehrlicherweise nicht verschlüsselt ist:** wer wann mit wem schreibt, wie
groß eine Datei ist, Gruppennamen und Systemmeldungen („X hat die Gruppe
erstellt"). Der Server braucht diese Angaben zum Zustellen und Sortieren.

**Grenzen, die du kennen solltest**

- Die öffentlichen Schlüssel kommen vom Server. Wer den Server kontrolliert,
  könnte einen falschen Schlüssel unterschieben — genau dagegen hilft die
  Sicherheitsnummer.
- Die privaten Schlüssel liegen im `localStorage` des Browsers. Wer den leert,
  bekommt ein neues Gerät und kommt an alte Nachrichten nicht mehr heran. Für
  diesen Fall kann die Person, die den Chat angelegt hat, ihn neu verschlüsseln —
  ältere Nachrichten bleiben dann verschlossen.
- Weil der Server die Inhalte nicht kennt, sucht die Nachrichtensuche nur in
  dem, was auf diesem Gerät bereits entschlüsselt vorliegt.

---

## Anrufe

Sprach- und Videoanrufe laufen **direkt von Gerät zu Gerät** über WebRTC. Über
den Server gehen nur Angebot, Antwort und die ICE-Kandidaten; Ton und Bild
nehmen den kurzen Weg.

- Anrufknöpfe stehen in der Kopfzeile jedes Einzelchats
- Klingelhinweis mit Annehmen/Ablehnen, Mikrofon und Kamera lassen sich
  während des Gesprächs abschalten
- Nach dem Auflegen landet ein Eintrag mit Dauer im Verlauf
- Für die Wegfindung dienen öffentliche STUN-Server. In strengen Netzen
  (symmetrisches NAT, Firmen-Firewall) käme man nur mit einem TURN-Server
  durch — der ist hier nicht eingebaut, und die App sagt es, wenn die
  Verbindung scheitert.

---

## Sprachnachrichten

Aufnahme über `MediaRecorder` (Opus, 24 kbit/s), Wellenbild aus den echten
Pegeln der Aufnahme, verschlüsselt hochgeladen, im Chat mit eigenem Abspieler
und Fortschritt in der Welle. Maximal 60 Sekunden pro Nachricht.

---

## Weitere Funktionen

**Konten & Kontakte**
- Anmeldung mit Telefonnummer und Passwort (scrypt, 90 Tage gültige Sitzungen)
- Nummern werden normalisiert: `0170 1234567`, `0049 170 1234567` und
  `+49 170 1234567` treffen dasselbe Konto
- Profil mit Name, Info-Text und Bild; Adressbuch mit eigenen Anzeigenamen

**Chats**
- Einzelchats und Gruppen mit Administrator und Mitgliederverwaltung
- Anheften, Stummschalten, Archivieren; Filter für *Alle / Ungelesen /
  Gruppen / Archiv*
- Suche über Chats, Nutzer und entschlüsselte Nachrichten
- Entwürfe bleiben pro Chat erhalten

**Nachrichten**
- Status wie gewohnt: ein Haken (gesendet), zwei Haken (zugestellt),
  zwei farbige Haken (gelesen)
- Antworten mit Zitat, Weiterleiten, Bearbeiten (Pfeil hoch), Löschen für alle
- Emoji-Reaktionen und Emoji-Auswahl
- Bilder, Videos und Dateien bis 25 MB per Büroklammer, Drag & Drop oder
  Einfügen aus der Zwischenablage
- Tippanzeige, Online-Status und „zuletzt gesehen"

**Oberfläche**
- Telegram-Optik mit Seitenleiste, gemustertem Hintergrund und Infopanel
- Heller Modus und Nachtmodus
- Responsiv bis zum Handy, PWA mit Service Worker

---

## Aufbau

```
server/
  index.js    HTTP-Server: statische Dateien, Medien, Range-Requests, Upgrade
  ws.js       WebSocket-Server nach RFC 6455 (Handshake, Frames, Ping/Pong)
  hub.js      Echtzeit: Präsenz, Zustellung, Schlüsseltausch, Anruf-Signale
  api.js      REST-Endpunkte
  model.js    Chats und Nachrichten, aufbereitet für den Client
  auth.js     scrypt-Hashing, Sitzungen, Nummernnormalisierung
  store.js    JSON-Persistenz mit gepufferten, atomaren Schreibvorgängen
public/
  css/app.css Gesamtes Design inklusive beider Themes
  js/crypto.js   Geräteschlüssel, Chatschlüssel, Ver- und Entschlüsseln
  js/decrypt.js  Inhalte aufschließen und im Speicher halten
  js/calls.js    WebRTC-Anrufe
  js/…           app · api · state · socket · chat · chatlist · composer ·
                 dialogs · info · emoji · ui · util
scripts/
  seed.mjs    Demo-Konten und leere Chats
```

Daten liegen in `data/db.json`, hochgeladene (verschlüsselte) Dateien in
`data/uploads/`. Beides ist über `.gitignore` ausgenommen; zum Zurücksetzen
einfach den Ordner `data/` löschen.

---

## Schnittstellen

### REST (`Authorization: Bearer <token>`)

| Methode  | Pfad                        | Zweck                                      |
|----------|-----------------------------|--------------------------------------------|
| `POST`   | `/api/auth/register`        | Konto anlegen                              |
| `POST`   | `/api/auth/login`           | Anmelden                                   |
| `POST`   | `/api/auth/logout`          | Sitzung beenden                            |
| `GET`    | `/api/me`                   | Eigenes Profil und bekannte Nutzer         |
| `PATCH`  | `/api/me`                   | Name, Info, Bild, öffentlicher Schlüssel   |
| `POST`   | `/api/me/password`          | Passwort wechseln                          |
| `GET`    | `/api/chats`                | Chatliste samt eigenem Schlüsselpaket      |
| `POST`   | `/api/chats`                | Einzelchat oder Gruppe anlegen             |
| `PATCH`  | `/api/chats/:id`            | Anheften, Stumm, Archiv, Titel, Mitglieder |
| `DELETE` | `/api/chats/:id`            | Chat löschen bzw. Gruppe verlassen         |
| `GET`    | `/api/chats/:id/messages`   | Verlauf (`before`, `limit`)                |
| `GET`    | `/api/users/search?q=`      | Nutzersuche                                |
| `GET`    | `/api/contacts`             | Adressbuch                                 |
| `POST`   | `/api/upload`               | Verschlüsselte Datei hochladen             |

Eine serverseitige Volltextsuche gibt es bewusst nicht — der Server kennt die
Inhalte nicht.

### WebSocket `/ws?token=…`

Client → Server: `message:send`, `message:edit`, `message:delete`,
`message:react`, `typing`, `read`, `draft`, `key:request`, `key:deliver`,
`call`, `ping`

Server → Client: `ready`, `message`, `message:update`, `chat`, `chat:removed`,
`user`, `presence`, `typing`, `read`, `read:self`, `delivered`, `key:request`,
`key:new`, `call`, `error`, `pong`

---

## Weitere Grenzen

- Betrieb im Netz gehört hinter einen TLS-Terminator (nginx, Caddy) — auch
  wegen Kamera und Mikrofon.
- Keine Verifikation der Telefonnummer per SMS: die Nummer ist Benutzername,
  nicht mehr.
- JSON-Datei statt Datenbank. Für einige tausend Nachrichten reicht das; für
  den Massenbetrieb wäre SQLite oder Postgres der nächste Schritt.
- Ein einzelner Serverprozess; horizontal skaliert wird nicht.

---

## Entwicklung

```bash
npm run dev     # Server mit --watch neu starten
npm run seed    # Demodaten (nur bei leerer Datenbank)
```
