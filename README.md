# Liberty Clone – GTA-1-artiger Top-Down-Shooter mit Multiplayer

Ein komplettes, spielbares Open-World-Spiel im Stil von **GTA 1**: Vogelperspektive,
frei begehbare Stadt, Autos klauen, Verkehr, Passanten, Waffen, Fahndungslevel und
Polizei – als **Echtzeit-Multiplayer** im Browser. Läuft ohne App Store direkt im
**Safari auf dem iPhone** und lässt sich dort als PWA auf den Home-Bildschirm legen.

Alles ist selbst implementiert (Canvas-2D-Grafik, Physik, KI, Netcode) – es werden
keinerlei Originaldaten oder Assets von Rockstar/DMA verwendet.

---

## Sofort spielen (ohne Server)

`dist/liberty-solo.html` ist der **Einzelspieler-Modus als eine einzige HTML-Datei** –
Stadt, Verkehr, Polizei, Waffen, Sound, alles darin, kein Server, kein Internet nötig.
Datei aufs iPhone schicken (AirDrop, iCloud, Mail) und in Safari öffnen, oder am Rechner
doppelklicken. Neu bauen mit `npm run build:solo`.

Mit laufendem Server erreichbar unter `/solo.html`.

## Schnellstart

```bash
npm install
npm start
# -> http://localhost:3000
```

Node.js 18 oder neuer wird benötigt (getestet mit Node 22). Einzige Abhängigkeit: `ws`.

## Auf dem iPhone spielen

1. Server auf einem Rechner im gleichen WLAN starten (`npm start`).
2. Lokale IP des Rechners herausfinden:
   * macOS: `ipconfig getifaddr en0`
   * Linux: `hostname -I`
   * Windows: `ipconfig`
3. Am iPhone in Safari `http://<IP-des-Rechners>:3000` öffnen.
4. **Als App installieren:** Teilen-Symbol → „Zum Home-Bildschirm“. Danach startet
   das Spiel im Vollbild ohne Safari-Leisten.
5. Gerät quer halten – das Spiel weist im Hochformat darauf hin.

Mehrere iPhones/Rechner können gleichzeitig dieselbe Adresse öffnen und spielen
zusammen in derselben Stadt.

> Möchtest du über das Internet spielen (nicht nur im WLAN), stelle den Server hinter
> HTTPS – der Client verbindet sich dann automatisch über `wss://`.

## Steuerung

| Aktion | Touch (iPhone) | Tastatur / Maus |
|---|---|---|
| Laufen / Lenken | Joystick auf der linken Bildschirmhälfte (erscheint dort, wo du tippst) | `WASD` oder Pfeiltasten |
| Schießen | Button **FEUER** | `Leertaste` oder linke Maustaste |
| Auto betreten / verlassen | Button **EIN / AUS** | `E` |
| Waffe wechseln (zu Fuß) | Button **WAFFE** | `Q` |
| Tasche / Inventar | Button **TASCHE** | `I` |
| Waffe direkt wählen | Zeile in der Tasche antippen | `1`–`5` |
| Handbremse / Drift (im Auto) | Button **BREMSE** | `Shift` |
| Punktetabelle | Button **≡** oben rechts | `Tab` |

Zielen zu Fuß: Auf dem Touchscreen zielt die Figur automatisch in Laufrichtung und
rastet leicht auf nahe Gegner ein. Am Desktop wird mit der Maus gezielt.

## Spielinhalt

* **Stadt:** 10 × 10 Häuserblocks (ca. 4600 × 4600 Spielwelt-Einheiten) mit Straßen­raster,
  Gehwegen, Parks, Wasserflächen und Zebrastreifen – prozedural aus einem Seed erzeugt,
  den alle Clients vom Server bekommen. Jeder Serverstart erzeugt eine neue Stadt
  (fixierbar über `SEED=…`).
* **Figuren:** Jede Person wird aus einzelnen Teilen gezeichnet – Hut mit Krempe und
  Hutband in der Spielerfarbe, Kopf mit Nase (zeigt die Blickrichtung), Schultern, Torso,
  Arme, Hände, Beine und Schuhe. Die Beine laufen in einem echten Schrittzyklus, dessen
  Tempo aus der tatsächlich zurückgelegten Strecke kommt; der Oberkörper dreht sich in
  Laufrichtung, Arme und Kopf zur Zielrichtung. In der Hand liegt sichtbar die aktuelle
  Waffe (Pistole, Uzi mit Magazin, Schrotflinte mit Holzschaft, Raketenwerfer mit Visier).
  Passanten bekommen aus ihrer ID deterministisch Hemd-, Hosen-, Haar- und Hautfarbe sowie
  in etwa jedem dritten Fall einen Hut – auf allen Clients identisch, ohne ein einziges
  zusätzliches Byte im Netzwerk.
* **Fahrzeuge:** 7 Typen (Limousine, Taxi, Sportwagen, Transporter, Truck, Streifenwagen,
  Käfer) mit eigenem Fahrverhalten, Grip, Tempo und Schadensmodell. Autos parken am
  Straßenrand, fahren im Verkehr mit oder werden von der Polizei gefahren.
* **Waffen:** Du startest **ohne Waffe**, nur mit den Fäusten. Alles andere muss gefunden
  werden – Pistole, Uzi, Schrotflinte und Raketenwerfer (mit Splash-Schaden und
  explodierenden Autos) liegen in der Stadt, ebenso Health, Panzerung und Geld. Diese
  festen Fundorte respawnen nach 22 Sekunden.
* **Beute:** Wer stirbt, lässt liegen, was er getragen hat. Erledigte Spieler lassen ihre
  Waffe mit der Restmunition und ein Viertel ihres Geldes fallen, gesprengte Streifenwagen
  die Dienstwaffe des Cops, Passanten in etwa jedem dritten Fall ihre Brieftasche.
  Solche Drops liegen 30–50 Sekunden auf der Straße, blinken mit einem gestrichelten Ring
  und verschwinden nach dem Aufheben endgültig – sie respawnen nicht.
* **Tasche:** Über den Button **TASCHE** (oder `I`) siehst du alles, was du dabei hast:
  jede Waffe mit Munitionsstand (nicht besessene sind ausgegraut, leergeschossene als
  „leer" markiert), Gesundheit, Panzerung, Geld und die zuletzt aufgesammelten Sachen.
  Eine Zeile antippen wechselt direkt auf diese Waffe. Während die Tasche offen ist,
  bewegt sich deine Figur nicht und schießt nicht – die Welt läuft aber weiter.
* **Fahndungslevel:** Schüsse, überfahrene Passanten und erledigte Cops erhöhen die
  Sterne (0–5). Ab einem Stern rücken Streifenwagen an, rammen, verfolgen und schießen.
  Ohne neue Verbrechen kühlt der Level wieder ab.
* **Multiplayer:** Alle Spieler teilen sich dieselbe Stadt, sehen gegenseitig Autos,
  Schüsse und Explosionen. Kills, Tode, Geld und Ping stehen in der Punktetabelle.

## Technik

```
server/index.js   HTTP-Static-Server + WebSocket-Server + Netzwerk-Loop
shared/           Von Server UND Browser genutzte Module
  world.js          Die Simulation (Spieler, Verkehr, Passanten, Polizei, Pickups) –
                    im Multiplayer läuft sie auf dem Server, im Solo-Modus im Browser
  constants.js      Tuning-Werte (Tempo, Schaden, Dichte, Netzraten)
  city.js           Deterministischer Stadtgenerator (Seed -> identische Stadt)
  physics.js        Bewegung, Kollision, Raycasts
  util.js           Mathe + deterministischer PRNG
public/           Client (ES-Module, keine Build-Tools nötig)
  js/main.js        Multiplayer-Loop, Prediction, Interpolation
  js/solo.js        Einzelspieler-Loop (dieselbe Welt, lokal simuliert)
  js/net.js         WebSocket-Protokoll
  js/input.js       Touch-Controls + Tastatur/Maus
  js/render.js      Canvas-Renderer (Stadt, Fahrzeuge, Effekte, Minimap)
  js/hud.js         HUD, Minimap, Killfeed, Touch-Buttons
  js/audio.js       WebAudio-Synthesizer (Schüsse, Motor, Sirene – keine Sounddateien)
  sw.js             Service Worker (PWA / Offline-Shell)
  solo.html         Seite für den Einzelspieler-Modus
scripts/make-icons.mjs   Erzeugt die PWA-Icons als PNG ohne Fremdbibliothek
scripts/build-solo.mjs   Bündelt den Solo-Modus zu dist/liberty-solo.html (eine Datei)
```

**Netcode:** Der Server simuliert die Welt autoritativ mit 30 Hz und verschickt 15 Snapshots
pro Sekunde, jeweils nur die Entitäten im Umkreis von 1250 Einheiten (~20–30 KB/s pro
Spieler). Clients senden 30-mal pro Sekunde ihre Eingaben, sagen die eigene Bewegung mit
derselben Physik lokal voraus (Client-Side Prediction mit weicher Korrektur) und
interpolieren alle anderen Objekte mit 110 ms Puffer – dadurch bleibt die Steuerung auch
bei Latenz direkt und die Bewegung anderer Spieler flüssig.

**Kamera:** Zu Fuß zoomt die Kamera näher heran (ca. 12,5 Kacheln Höhe), damit die Figuren
mit Hut, Armen und Beinen zu erkennen sind; im Auto zieht sie auf ca. 16,5 Kacheln auf und
mit steigendem Tempo zusätzlich zurück, damit bei Höchstgeschwindigkeit genug Vorausschau
bleibt.

**Warum kein Bild-Asset?** Stadt, Autos, Figuren und Effekte werden zur Laufzeit gezeichnet.
Das Spiel ist damit wenige hundert Kilobyte groß, startet sofort und skaliert scharf auf
jedes Display (inkl. Retina, DPR bis 2).

## Konfiguration

| Variable | Bedeutung | Default |
|---|---|---|
| `PORT` | HTTP/WebSocket-Port | `3000` |
| `SEED` | Fester Stadt-Seed (sonst zufällig pro Start) | zufällig |
| `MAX_PLAYERS` | Maximale gleichzeitige Spieler | `32` |

Beispiel: `PORT=8080 SEED=1337 npm start`

Spielbalance (Tempo, Schaden, Verkehrsdichte, Anzahl Passanten, Fahndungslogik) steht
gesammelt in `shared/constants.js`.

## Deployment

Der Server ist ein einzelner Node-Prozess ohne Build-Schritt und ohne Datenbank:

```bash
npm ci --omit=dev
PORT=8080 node server/index.js
```

Er funktioniert auf jedem Node-Hoster (Fly.io, Railway, Render, VPS, Docker). Wichtig ist
nur, dass der Reverse Proxy **WebSocket-Upgrades durchlässt** (bei nginx:
`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
Der Health-Endpoint `GET /health` liefert Spielerzahl und Uptime.

## Entwicklung

```bash
npm run dev         # Node --watch, startet den Server bei Änderungen neu
npm run build:solo  # baut dist/liberty-solo.html neu
npm run icons       # erzeugt die PWA-Icons neu
```

Der Client hat keinen Build-Schritt: Dateien in `public/` bearbeiten und neu laden.
Wenn der Service Worker eine alte Version ausliefert, in den Safari-/Chrome-DevTools
„Update on reload“ aktivieren oder die Version in `public/sw.js` (`CACHE`) hochzählen.

## Rechtliches

Eigenständige Neuimplementierung eines Spielprinzips zu Lern- und Demozwecken.
Es werden keine Grafiken, Sounds, Karten oder sonstige Inhalte des Originals verwendet.
„Grand Theft Auto“ ist eine Marke von Take-Two Interactive / Rockstar Games; dieses
Projekt steht in keiner Verbindung dazu.
