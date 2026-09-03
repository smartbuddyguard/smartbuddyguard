// HTTP static server + WebSocket game server.
//
//   npm install && npm start   ->  http://localhost:3000
//
// Everything under public/ is the game client, shared/ holds the modules that
// the browser and this server both use (city generation, physics, constants).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { World } from './world.js';
import {
  SIM_DT, NET_HZ, VIEW_RADIUS, E_PLAYER, E_CAR, E_PED, E_PICKUP,
  CAR_TYPES, MAX_WANTED
} from '../shared/constants.js';
import { dist2 } from '../shared/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 32);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  return p.startsWith(base) ? p : null;
}

function serveFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${st.size}-${st.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'ETag': etag,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60'
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: world.players.size, uptime: process.uptime() }));
    return;
  }

  const base = url.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
  const rel = url.startsWith('/shared/') ? url.slice(1) : url.slice(1);
  const file = safeJoin(base, rel);
  if (!file) { res.writeHead(400); res.end('Bad path'); return; }
  serveFile(res, file, req);
});

// ---------------------------------------------------------------- game loop

const world = new World(Number(process.env.SEED) || ((Math.random() * 1e9) | 0));
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });
const clients = new Map(); // playerId -> client

let nextClientId = 1;

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  const id = nextClientId++;
  const client = { id, ws, joined: false, ping: 0, lastSeq: 0, alive: true };
  clients.set(id, client);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(client, msg);
  });

  ws.on('close', () => {
    clients.delete(id);
    if (client.joined) {
      const p = world.players.get(id);
      if (p) world.events.push({ t: 'left', name: p.name, id });
      world.removePlayer(id);
    }
  });

  ws.on('error', () => {});
  ws.on('pong', () => { client.alive = true; });
});

function handleMessage(client, msg) {
  switch (msg.t) {
    case 'join': {
      if (client.joined) return;
      const name = String(msg.name || 'Player').slice(0, 14).replace(/[^\w \-.äöüÄÖÜß]/g, '') || 'Player';
      const color = /^#[0-9a-f]{6}$/i.test(msg.color || '') ? msg.color : '#ffd23f';
      const p = world.addPlayer(client.id, name, color);
      client.joined = true;
      client.ws.send(JSON.stringify({
        t: 'welcome',
        id: client.id,
        seed: world.seed,
        you: { x: p.x, y: p.y },
        players: world.players.size,
        serverTime: world.time
      }));
      world.events.push({ t: 'joined', name: p.name, id: p.id });
      break;
    }
    case 'in':
      if (client.joined) world.setInput(client.id, msg);
      break;
    case 'ping':
      client.ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }));
      break;
    case 'respawn': {
      const p = world.players.get(client.id);
      if (p && !p.alive && world.time >= p.respawnAt - 0.2) world.respawn(p);
      break;
    }
    default:
      break;
  }
}

const r0 = (v) => Math.round(v);
const r3 = (v) => Math.round(v * 1000) / 1000;

function buildSnapshot(player) {
  const ents = [];
  const R2 = VIEW_RADIUS * VIEW_RADIUS;
  // Pedestrians are ambient detail: a tighter radius keeps them off the wire
  // long before they would be on screen at any sane zoom level.
  const PED_R2 = (VIEW_RADIUS * 0.7) ** 2;
  const near = (x, y) => dist2(x, y, player.x, player.y) <= R2;
  const nearPed = (x, y) => dist2(x, y, player.x, player.y) <= PED_R2;

  for (const p of world.players.values()) {
    if (p.id === player.id || !p.alive || p.carId) continue;
    if (!near(p.x, p.y)) continue;
    ents.push([E_PLAYER, p.id, r0(p.x), r0(p.y), r3(p.angle), Math.round(p.hp), p.moving | (p.hitFlash > 0 ? 2 : 0) | (p.weapon << 3)]);
  }
  for (const c of world.cars.values()) {
    if (!near(c.x, c.y)) continue;
    ents.push([E_CAR, c.id, r0(c.x), r0(c.y), r3(c.angle), c.kind,
      Math.round((c.hp / c.maxHp) * 100), c.driver || 0, (c.siren ? 1 : 0) | (c.speed > 30 ? 2 : 0), c.colorSeed]);
  }
  for (const p of world.peds.values()) {
    if (!nearPed(p.x, p.y)) continue;
    ents.push([E_PED, p.id, r0(p.x), r0(p.y), r3(p.angle), p.state]);
  }
  for (const pu of world.pickups.values()) {
    if (!pu.active || !near(pu.x, pu.y)) continue;
    ents.push([E_PICKUP, pu.id, r0(pu.x), r0(pu.y), pu.kind]);
  }

  const car = player.carId ? world.cars.get(player.carId) : null;
  const you = {
    x: r0(player.x), y: r0(player.y), a: r3(player.angle),
    vx: r0(player.vx), vy: r0(player.vy),
    hp: Math.round(player.hp), ar: Math.round(player.armour),
    al: player.alive ? 1 : 0, rs: player.alive ? 0 : Math.max(0, Math.round((player.respawnAt - world.time) * 10) / 10),
    w: player.weapon, am: player.ammo[player.weapon] === undefined ? -1 : player.ammo[player.weapon],
    wl: Math.floor(player.wanted), wf: r3(player.wanted % 1),
    cash: player.cash, k: player.kills, d: player.deaths, seq: player.lastSeq,
    car: car ? car.id : 0, ck: car ? car.kind : -1,
    chp: car ? Math.round((car.hp / car.maxHp) * 100) : 0,
    sp: car ? Math.round(car.speed) : Math.round(Math.hypot(player.vx, player.vy)),
    cn: car ? CAR_TYPES[car.kind].name : ''
  };

  const evs = [];
  for (const e of world.events) {
    if (e.t === 'kill' || e.t === 'joined' || e.t === 'left') { evs.push(e); continue; }
    const x = e.x !== undefined ? e.x : e.x0;
    const y = e.y !== undefined ? e.y : e.y0;
    if (x === undefined || near(x, y)) evs.push(e);
  }

  return { t: 's', k: world.tick, ts: Date.now(), you, e: ents, ev: evs };
}

function buildRoster() {
  const list = [];
  for (const p of world.players.values()) {
    const c = clients.get(p.id);
    list.push([p.id, p.name, p.color, p.kills, p.deaths, p.cash, Math.floor(p.wanted), c ? c.ping : 0, p.alive ? 1 : 0]);
  }
  list.sort((a, b) => b[3] - a[3] || a[4] - b[4]);
  return { t: 'r', p: list, max: MAX_WANTED };
}

let acc = 0;
let last = process.hrtime.bigint();
let netAcc = 0;
let rosterAcc = 0;
const NET_DT = 1 / NET_HZ;

// The loop ticks faster than the simulation rate and uses accumulators, so
// timer jitter does not eat into the snapshot rate.
setInterval(() => {
  const now = process.hrtime.bigint();
  let dt = Number(now - last) / 1e9;
  last = now;
  if (dt > 0.5) dt = 0.5; // never simulate a huge catch-up burst
  acc += dt;

  let steps = 0;
  while (acc >= SIM_DT && steps < 6) { world.step(SIM_DT); acc -= SIM_DT; steps++; }

  netAcc += dt;
  if (netAcc >= NET_DT) {
    netAcc = Math.min(netAcc - NET_DT, NET_DT);
    rosterAcc += NET_DT;
    let roster = null;
    if (world.rosterDirty || rosterAcc > 2) { roster = JSON.stringify(buildRoster()); world.rosterDirty = false; rosterAcc = 0; }
    for (const client of clients.values()) {
      if (!client.joined || client.ws.readyState !== 1) continue;
      const p = world.players.get(client.id);
      if (!p) continue;
      try {
        client.ws.send(JSON.stringify(buildSnapshot(p)));
        if (roster) client.ws.send(roster);
      } catch { /* socket went away mid-send */ }
    }
    world.events.length = 0;
  }
}, 1000 / 60);

// Drop dead sockets.
setInterval(() => {
  for (const client of clients.values()) {
    if (!client.alive) { client.ws.terminate(); continue; }
    client.alive = false;
    try { client.ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Liberty Clone running on http://localhost:${PORT}  (seed ${world.seed})`);
  console.log('Open the same URL on your iPhone (same Wi-Fi) and add it to the home screen.');
});
