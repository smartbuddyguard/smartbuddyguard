# Liberty Clone – GTA-1-artiger Top-Down-Shooter mit Multiplayer

Ein komplettes, spielbares Open-World-Spiel im Stil von **GTA 1**: Vogelperspektive,
frei begehbare Stadt, Autos klauen, Verkehr, Passanten, Waffen, Fahndungslevel und
Polizei – als **Echtzeit-Multiplayer** im Browser. Läuft ohne App Store direkt im
**Safari auf dem iPhone** und lässt sich dort als PWA auf den Home-Bildschirm legen.

Alles ist selbst implementiert (Canvas-2D-Grafik, Physik, KI, Netcode) – es werden
keinerlei Originaldaten oder Assets von Rockstar/DMA verwendet.

---

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
| Handbremse / Drift (im Auto) | Button **BREMSE** | `Shift` |
| Punktetabelle | Button **≡** oben rechts | `Tab` |

Zielen zu Fuß: Auf dem Touchscreen zielt die Figur automatisch in Laufrichtung und
rastet leicht auf nahe Gegner ein. Am Desktop wird mit der Maus gezielt.

## Spielinhalt

* **Stadt:** 10 × 10 Häuserblocks (ca. 4600 × 4600 Spielwelt-Einheiten) mit Straßen­raster,
  Gehwegen, Parks, Wasserflächen und Zebrastreifen – prozedural aus einem Seed erzeugt,
  den alle Clients vom Server bekommen. Jeder Serverstart erzeugt eine neue Stadt
  (fixierbar über `SEED=…`).
* **Fahrzeuge:** 7 Typen (Limousine, Taxi, Sportwagen, Transporter, Truck, Streifenwagen,
  Käfer) mit eigenem Fahrverhalten, Grip, Tempo und Schadensmodell. Autos parken am
  Straßenrand, fahren im Verkehr mit oder werden von der Polizei gefahren.
* **Waffen:** Fäuste, Pistole, Uzi, Schrotflinte, Raketenwerfer (mit Splash-Schaden und
  explodierenden Autos). Munition, Health, Panzerung und Geld liegen als Pickups in der
  Stadt und respawnen.
* **Fahndungslevel:** Schüsse, überfahrene Passanten und erledigte Cops erhöhen die
  Sterne (0–5). Ab einem Stern rücken Streifenwagen an, rammen, verfolgen und schießen.
  Ohne neue Verbrechen kühlt der Level wieder ab.
* **Multiplayer:** Alle Spieler teilen sich dieselbe Stadt, sehen gegenseitig Autos,
  Schüsse und Explosionen. Kills, Tode, Geld und Ping stehen in der Punktetabelle.

## Technik

```
server/index.js   HTTP-Static-Server + WebSocket-Server + Netzwerk-Loop
server/world.js   Autoritative Simulation (Spieler, Verkehr, Passanten, Polizei, Pickups)
shared/           Von Server UND Browser genutzte Module
  constants.js      Tuning-Werte (Tempo, Schaden, Dichte, Netzraten)
  city.js           Deterministischer Stadtgenerator (Seed -> identische Stadt)
  physics.js        Bewegung, Kollision, Raycasts
  util.js           Mathe + deterministischer PRNG
public/           Client (ES-Module, keine Build-Tools nötig)
  js/main.js        Loop, Prediction, Interpolation
  js/net.js         WebSocket-Protokoll
  js/input.js       Touch-Controls + Tastatur/Maus
  js/render.js      Canvas-Renderer (Stadt, Fahrzeuge, Effekte, Minimap)
  js/hud.js         HUD, Minimap, Killfeed, Touch-Buttons
  js/audio.js       WebAudio-Synthesizer (Schüsse, Motor, Sirene – keine Sounddateien)
  sw.js             Service Worker (PWA / Offline-Shell)
scripts/make-icons.mjs  Erzeugt die PWA-Icons als PNG ohne Fremdbibliothek
```

**Netcode:** Der Server simuliert die Welt autoritativ mit 30 Hz und verschickt 15 Snapshots
pro Sekunde, jeweils nur die Entitäten im Umkreis von 1250 Einheiten (~20–30 KB/s pro
Spieler). Clients senden 30-mal pro Sekunde ihre Eingaben, sagen die eigene Bewegung mit
derselben Physik lokal voraus (Client-Side Prediction mit weicher Korrektur) und
interpolieren alle anderen Objekte mit 110 ms Puffer – dadurch bleibt die Steuerung auch
bei Latenz direkt und die Bewegung anderer Spieler flüssig.

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
npm run dev     # Node --watch, startet den Server bei Änderungen neu
```

Der Client hat keinen Build-Schritt: Dateien in `public/` bearbeiten und neu laden.
Wenn der Service Worker eine alte Version ausliefert, in den Safari-/Chrome-DevTools
„Update on reload“ aktivieren oder die Version in `public/sw.js` (`CACHE`) hochzählen.

## Rechtliches

Eigenständige Neuimplementierung eines Spielprinzips zu Lern- und Demozwecken.
Es werden keine Grafiken, Sounds, Karten oder sonstige Inhalte des Originals verwendet.
„Grand Theft Auto“ ist eine Marke von Take-Two Interactive / Rockstar Games; dieses
Projekt steht in keiner Verbindung dazu.
