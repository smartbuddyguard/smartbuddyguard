// Client bootstrap: menu, network, prediction, render loop.

import { Net } from './net.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Controls, loadScheme, mountSchemePicker } from './controls.js';
import { generateCity } from '/shared/city.js';
import { stepPlayer, stepCar } from '/shared/physics.js';
import {
  INTERP_DELAY, E_PLAYER, E_CAR, E_PED, E_PICKUP, CAR_TYPES
} from '/shared/constants.js';
import { clamp, angleDiff, lerpAngle } from '/shared/util.js';

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('name');
const playBtn = document.getElementById('play');
const colorsEl = document.getElementById('colors');
const scoresEl = document.getElementById('scores');
const scoreTable = document.querySelector('#scoreTable tbody');
const closeScores = document.getElementById('closeScores');
const rotateHint = document.getElementById('rotate');
const toastEl = document.getElementById('toast');

const COLORS = ['#ffd23f', '#ff5f4d', '#59d66f', '#59b7ff', '#c86bff', '#ffffff', '#ff8fc7', '#8de0d6'];
let chosenColor = localStorage.getItem('lc_color') || COLORS[0];
nameInput.value = localStorage.getItem('lc_name') || '';

for (const c of COLORS) {
  const d = document.createElement('div');
  d.className = 'swatch' + (c === chosenColor ? ' sel' : '');
  d.style.background = c;
  d.onclick = () => {
    chosenColor = c;
    localStorage.setItem('lc_color', c);
    [...colorsEl.children].forEach(el => el.classList.remove('sel'));
    d.classList.add('sel');
  };
  colorsEl.appendChild(d);
}

const sfx = new Sfx();
const input = new Input(canvas);
const controls = new Controls(loadScheme());
mountSchemePicker(document.getElementById('scheme'), document.getElementById('schemeHint'), controls);

const state = {
  running: false,
  me: 0,
  city: null,
  entities: new Map(),   // id -> { type, prev, cur, ... }
  you: null,
  local: { x: 0, y: 0, vx: 0, vy: 0, angle: 0, moving: 0 },
  localCar: null,
  roster: [],
  rosterById: new Map(),
  playerCount: 0,
  ping: 0,
  fps: 0,
  time: 0,
  aim: 0,
  hurtFlash: 0,
  invOpen: false,
  pickupLog: []
};

let renderer = null;
let hud = null;
let net = null;
let scoresOpen = false;

// ------------------------------------------------------------------ helpers

function toast(text, ms = 2600) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function readSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0
  };
  probe.remove();
  return safe;
}

function resize() {
  const w = Math.round(window.innerWidth);
  const h = Math.round(window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const safe = readSafeArea();
  if (renderer) renderer.resize(w, h, dpr);
  else { canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
  input.layout(w, h, safe);
  if (hud) hud.safe = safe;
  rotateHint.classList.toggle('hidden', !(state.running && h > w && w < 560));
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) input.releaseAll(); });
resize();

// --------------------------------------------------------------- networking

function join() {
  const name = (nameInput.value || '').trim() || 'Spieler';
  localStorage.setItem('lc_name', name);
  statusEl.textContent = 'Verbinde …';
  statusEl.className = 'status';
  playBtn.disabled = true;
  sfx.unlock();

  net = new Net({
    onWelcome: (msg) => {
      state.me = msg.id;
      state.city = generateCity(msg.seed);
      if (!renderer) {
        renderer = new Renderer(canvas, state.city);
        hud = new Hud(renderer, input);
        input.onScores = toggleScores;
        input.onInventory = toggleInventory;
        input.onSelectWeapon = selectWeapon;
        input.modalHitTest = inventoryTap;
      } else {
        renderer.setCity(state.city);
      }
      state.local.x = msg.you.x; state.local.y = msg.you.y;
      state.local.vx = 0; state.local.vy = 0;
      renderer.cam.x = msg.you.x; renderer.cam.y = msg.you.y;
      resize();
      menu.classList.add('hidden');
      statusEl.textContent = '';
      playBtn.disabled = false;
      state.running = true;
      toast('Willkommen in Liberty City. Klau dir ein Auto!', 3500);
      requestAnimationFrame(frame);
    },
    onSnapshot: applySnapshot,
    onRoster: (msg) => {
      state.roster = msg.p;
      state.playerCount = msg.p.length;
      state.rosterById = new Map(msg.p.map(r => [r[0], { id: r[0], name: r[1], color: r[2], kills: r[3], deaths: r[4], cash: r[5], wanted: r[6], ping: r[7], alive: r[8] }]));
      if (scoresOpen) renderScores();
    },
    onClose: () => {
      state.running = false;
      menu.classList.remove('hidden');
      playBtn.disabled = false;
      statusEl.textContent = 'Verbindung getrennt.';
      statusEl.className = 'status err';
      input.releaseAll();
    },
    onError: (m) => {
      statusEl.textContent = m;
      statusEl.className = 'status err';
      playBtn.disabled = false;
    }
  });
  net.connect(name, chosenColor);
}

playBtn.onclick = join;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function applySnapshot(msg) {
  const now = performance.now();
  const prevYou = state.you;
  state.you = msg.you;
  state.ping = net ? net.ping : 0;

  // --- entity interpolation buffers
  const seen = new Set();
  for (const a of msg.e) {
    const type = a[0], id = a[1];
    seen.add(id);
    let e = state.entities.get(id);
    if (!e) {
      e = { id, type, prev: null, cur: null };
      state.entities.set(id, e);
    }
    const sample = { t: now, x: a[2], y: a[3], a: a[4] };
    if (type === E_CAR) {
      e.kind = a[5]; e.hpPct = a[6]; e.driver = a[7];
      e.siren = (a[8] & 1) === 1; e.moving = (a[8] & 2) === 2; e.colorSeed = a[9];
    } else if (type === E_PLAYER) {
      e.hp = a[5]; e.moving = a[6] & 1; e.hit = (a[6] & 2) === 2; e.weapon = a[6] >> 3;
    } else if (type === E_PED) {
      e.state = a[5];
    } else if (type === E_PICKUP) {
      e.kind = a[4];
      e.temp = a[5] === 1;
      sample.a = 0;
    }
    e.prev = e.cur || sample;
    e.cur = sample;
    e.type = type;
    e.lastSeen = now;
    e.x = sample.x; e.y = sample.y; e.angle = sample.a; // used by the minimap
  }
  for (const [id, e] of state.entities) {
    if (!seen.has(id) && now - e.lastSeen > 400) state.entities.delete(id);
  }

  // --- reconcile local prediction with the authoritative position
  const you = msg.you;
  if (you.car) {
    if (!state.localCar || state.localCar.id !== you.car) {
      const src = state.entities.get(you.car);
      state.localCar = {
        id: you.car, kind: you.ck, hp: 1, x: you.x, y: you.y,
        vx: you.vx, vy: you.vy, angle: you.a, speed: you.sp
      };
      if (src) { state.localCar.x = src.x; state.localCar.y = src.y; }
    }
    const c = state.localCar;
    c.kind = you.ck;
    c.hp = (CAR_TYPES[you.ck] ? CAR_TYPES[you.ck].hp : 200) * (you.chp / 100);
    const err = Math.hypot(you.x - c.x, you.y - c.y);
    if (err > 190) { c.x = you.x; c.y = you.y; c.angle = you.a; c.vx = you.vx; c.vy = you.vy; }
    else {
      c.x += (you.x - c.x) * 0.25;
      c.y += (you.y - c.y) * 0.25;
      c.angle = lerpAngle(c.angle, you.a, 0.25);
      c.vx += (you.vx - c.vx) * 0.3;
      c.vy += (you.vy - c.vy) * 0.3;
    }
  } else {
    state.localCar = null;
    const l = state.local;
    const err = Math.hypot(you.x - l.x, you.y - l.y);
    if (err > 150 || !you.al) { l.x = you.x; l.y = you.y; l.vx = you.vx; l.vy = you.vy; }
    else {
      l.x += (you.x - l.x) * 0.22;
      l.y += (you.y - l.y) * 0.22;
      l.vx += (you.vx - l.vx) * 0.25;
      l.vy += (you.vy - l.vy) * 0.25;
    }
  }

  if (prevYou) {
    if (you.hp < prevYou.hp - 0.5 && you.al) { sfx.hurt(); state.hurtFlash = 0.25; }
    if (prevYou.al && !you.al) { sfx.die(); renderer && renderer.shake(14); }
  }

  for (const ev of msg.ev) handleEvent(ev, now);
}

function handleEvent(ev, now) {
  const l = state.localCar || state.local;
  const d = ev.x !== undefined ? Math.hypot(ev.x - l.x, ev.y - l.y) : (ev.x0 !== undefined ? Math.hypot(ev.x0 - l.x, ev.y0 - l.y) : 0);
  const vol = clamp(1 - d / 1000, 0, 1);

  switch (ev.t) {
    case 'shot':
      renderer.addTracer(ev.x0, ev.y0, ev.x1, ev.y1, ev.w);
      markShooter(ev);
      if (vol > 0.02) sfx.shot(ev.w, vol);
      break;
    case 'blood':
      renderer.addBlood(ev.x, ev.y, ev.big);
      break;
    case 'spark':
      renderer.addSpark(ev.x, ev.y);
      break;
    case 'boom':
      renderer.addExplosion(ev.x, ev.y, ev.r);
      if (vol > 0.02) sfx.boom(vol);
      break;
    case 'crash':
      if (vol > 0.03) sfx.crash(ev.m * vol);
      if (d < 400) renderer.shake(6 * ev.m);
      break;
    case 'pickup':
      if (ev.id === state.me) {
        sfx.pickup();
        state.pickupLog.unshift({ kind: ev.kind, amount: ev.amount, t: state.time });
        state.pickupLog.length = Math.min(state.pickupLog.length, 6);
      }
      break;
    case 'kill': {
      const you = ev.victim === state.me;
      const mine = ev.killer === state.me;
      hud.pushKill(`${ev.killerName} ☠ ${ev.victimName}${ev.weapon ? ' · ' + ev.weapon : ''}`, state.time);
      if (mine && !you) toast(`Ausgeschaltet: ${ev.victimName} (+$250)`, 2000);
      break;
    }
    case 'joined': toast(`${ev.name} ist beigetreten`); break;
    case 'left': toast(`${ev.name} hat das Spiel verlassen`); break;
  }
}

// Find who fired so their character plays the recoil or punch.
function markShooter(ev) {
  let bestKey = null, bestD = 46 * 46;
  const own = dist2sq(state.local.x, state.local.y, ev.x0, ev.y0);
  if (own < bestD) { bestD = own; bestKey = 'p' + state.me; }
  for (const e of state.entities.values()) {
    if (e.type !== E_PLAYER) continue;
    const d = dist2sq(e.x, e.y, ev.x0, ev.y0);
    if (d < bestD) { bestD = d; bestKey = 'p' + e.id; }
  }
  if (bestKey) renderer.markAction(bestKey, ev.w > 0 ? 'shoot' : 'punch');
}

function dist2sq(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

// ------------------------------------------------------------------ inventory

function toggleInventory() {
  state.invOpen = !state.invOpen;
  input.releaseAll();
  if (state.invOpen) toastEl.classList.add('hidden');   // keep the header readable
}

function selectWeapon(w) {
  if (!state.you) return;
  if (w !== 0 && !(state.you.iv && state.you.iv[w - 1] > 0)) return;  // nothing to load
  if (net) net.selectWeapon(w);
  state.you.w = w;                                    // instant feedback
  state.invOpen = false;
}

// Taps while the inventory is open belong to the inventory.
function inventoryTap(x, y) {
  if (!state.invOpen || !hud) return false;
  const hit = hud.hitInventory(x, y);
  if (hit === 'close') state.invOpen = false;
  else if (typeof hit === 'number') selectWeapon(hit);
  return true;
}

// ----------------------------------------------------------------- scoreboard

function toggleScores() {
  scoresOpen = !scoresOpen;
  scoresEl.classList.toggle('hidden', !scoresOpen);
  if (scoresOpen) {
    renderScores();
    mountSchemePicker(document.getElementById('scoreScheme'), document.getElementById('scoreSchemeHint'), controls);
  }
  input.releaseAll();
}
closeScores.onclick = () => { scoresOpen = false; scoresEl.classList.add('hidden'); };

function renderScores() {
  scoreTable.innerHTML = '';
  for (const r of state.roster) {
    const tr = document.createElement('tr');
    if (r[0] === state.me) tr.className = 'me';
    tr.innerHTML = `<td><span class="dot" style="background:${r[2]}"></span></td>` +
      `<td>${escapeHtml(r[1])}</td>` +
      `<td class="num">${r[3]} K</td><td class="num">${r[4]} T</td>` +
      `<td class="num">$${r[5]}</td><td class="num">${r[7]} ms</td>`;
    scoreTable.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ aiming

function computeAim() {
  const l = state.localCar || state.local;
  if (state.localCar) return state.localCar.angle;

  // Desktop: aim with the mouse.
  if (input.mouse.active && !input.touchUsed && renderer) {
    const w = renderer.screenToWorld(input.mouse.x, input.mouse.y);
    return Math.atan2(w.y - l.y, w.x - l.x);
  }

  // Touch: face the movement direction with a bit of auto aim.
  const base = state.local.angle;
  let best = null, bestScore = Infinity;
  for (const e of state.entities.values()) {
    if (e.type !== E_PLAYER && e.type !== E_PED) continue;
    const dx = e.x - l.x, dy = e.y - l.y;
    const dd = Math.hypot(dx, dy);
    if (dd > 360) continue;
    const diff = Math.abs(angleDiff(base, Math.atan2(dy, dx)));
    if (diff > 0.7) continue;
    const score = dd + diff * 260 + (e.type === E_PLAYER ? -120 : 0);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (best) return Math.atan2(best.y - l.y, best.x - l.x);
  return base;
}

// -------------------------------------------------------------------- loop

let lastFrame = performance.now();
let fpsAcc = 0, fpsCount = 0;

function frame(now) {
  if (!state.running) return;
  requestAnimationFrame(frame);

  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.1) dt = 0.1;
  state.time += dt;

  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) { state.fps = Math.round(fpsCount / fpsAcc); fpsAcc = 0; fpsCount = 0; }
  state.hurtFlash = Math.max(0, state.hurtFlash - dt);

  const inCar = !!state.localCar;
  const car = state.localCar;
  const carFwd = car ? car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle) : 0;
  const raw = input.sample(0, inCar);
  const inp = controls.convert(raw, {
    inCar,
    carAngle: car ? car.angle : 0,
    carFwd,
    playerAngle: state.local.angle,
    autoAim: computeAim(),
    dt
  });
  state.aim = inp.aim;
  if (state.invOpen) {                    // hands are busy rummaging
    inp.mx = 0; inp.my = 0; inp.fire = false; inp.enter = false; inp.swap = false;
  }
  if (net) net.sendInput(inp, now);

  // --- local prediction
  if (state.you && state.you.al) {
    if (inCar) {
      const c = state.localCar;
      controls.syncHeading(c.angle);
      c.braking = inp.brake;
      stepCar(state.city, c, { throttle: -inp.my, steer: inp.mx, brake: inp.brake }, dt);
      state.local.x = c.x; state.local.y = c.y; state.local.angle = c.angle;
      if (inp.brake && c.speed > 130 && Math.random() < 0.5) {
        const off = c.angle + Math.PI / 2;
        const back = c.angle + Math.PI;
        const bx = c.x + Math.cos(back) * 18, by = c.y + Math.sin(back) * 18;
        renderer.addSkid(bx + Math.cos(off) * 11, by + Math.sin(off) * 11, c.angle);
        renderer.addSkid(bx - Math.cos(off) * 11, by - Math.sin(off) * 11, c.angle);
      }
    } else {
      stepPlayer(state.city, state.local, { mx: inp.mx, my: inp.my }, dt);
      if (controls.scheme === 'classic') state.local.angle = controls.heading;
    }
  }

  drawFrame(dt, now);
  updateAmbientAudio(inCar);
}

function updateAmbientAudio(inCar) {
  const speed = state.localCar ? Math.hypot(state.localCar.vx, state.localCar.vy) : 0;
  const kind = state.localCar ? CAR_TYPES[state.localCar.kind] : null;
  sfx.updateEngine(inCar, kind ? clamp(speed / kind.max, 0, 1) : 0);

  let closeness = 0;
  const l = state.local;
  for (const e of state.entities.values()) {
    if (e.type !== E_CAR || !e.siren) continue;
    const d = Math.hypot(e.x - l.x, e.y - l.y);
    closeness = Math.max(closeness, clamp(1 - d / 700, 0, 1));
  }
  sfx.updateSiren(closeness);
}

function sampleEntity(e, renderTime) {
  if (!e.prev || !e.cur) return { x: e.x, y: e.y, a: e.angle };
  const span = e.cur.t - e.prev.t;
  const t = span > 0 ? clamp((renderTime - e.prev.t) / span, 0, 1.4) : 1;
  return {
    x: e.prev.x + (e.cur.x - e.prev.x) * t,
    y: e.prev.y + (e.cur.y - e.prev.y) * t,
    a: lerpAngle(e.prev.a, e.cur.a, clamp(t, 0, 1))
  };
}

function drawFrame(dt, now) {
  const renderTime = now - INTERP_DELAY;
  const focus = state.localCar || state.local;
  const speed = Math.hypot(focus.vx || 0, focus.vy || 0);

  renderer.updateCamera({ x: focus.x, y: focus.y, angle: focus.angle }, speed, dt, !state.localCar);
  renderer.updateEffects(dt);
  renderer.begin(dt);
  renderer.drawCity();

  // pickups first, then people, then cars
  const cars = [];
  for (const e of state.entities.values()) {
    const s = sampleEntity(e, renderTime);
    if (e.type === E_PICKUP) {
      renderer.drawPickup({ x: s.x, y: s.y, kind: e.kind, id: e.id }, state.time);
    } else if (e.type === E_PED) {
      renderer.drawPed({ x: s.x, y: s.y, angle: s.a, id: e.id, state: e.state });
    } else if (e.type === E_PLAYER) {
      const meta = state.rosterById.get(e.id);
      renderer.drawPlayer(
        { x: s.x, y: s.y, angle: s.a, id: e.id, color: meta ? meta.color : '#fff' },
        { name: meta ? meta.name : 'Spieler', hit: e.hit, weapon: e.weapon, wanted: meta ? meta.wanted : 0 }
      );
    } else if (e.type === E_CAR) {
      cars.push({ e, s });
    }
  }

  for (const { e, s } of cars) {
    const own = state.localCar && state.localCar.id === e.id;
    const c = own
      ? { x: state.localCar.x, y: state.localCar.y, kind: e.kind, colorSeed: e.colorSeed, siren: e.siren, hpPct: e.hpPct, braking: state.localCar.braking }
      : { x: s.x, y: s.y, kind: e.kind, colorSeed: e.colorSeed, siren: e.siren, hpPct: e.hpPct };
    renderer.drawCar(c, own ? state.localCar.angle : s.a);
    if (own && state.rosterById.get(state.me)) {
      renderer.labels.push({
        x: renderer.worldToScreen(c.x, c.y).x,
        y: renderer.worldToScreen(c.x, c.y).y - 34 * renderer.cam.scale,
        text: state.rosterById.get(state.me).name,
        color: state.rosterById.get(state.me).color,
        wanted: state.you ? state.you.wl : 0
      });
    } else if (!own && e.driver) {
      const meta = state.rosterById.get(e.driver);
      if (meta) {
        const p = renderer.worldToScreen(c.x, c.y);
        renderer.labels.push({ x: p.x, y: p.y - 34 * renderer.cam.scale, text: meta.name, color: meta.color, wanted: meta.wanted });
      }
    }
  }

  // own player on foot (predicted)
  if (state.you && state.you.al && !state.localCar) {
    const meta = state.rosterById.get(state.me);
    // The torso follows where we walk, the arms and head follow where we aim.
    renderer.drawPlayer(
      {
        x: state.local.x, y: state.local.y,
        angle: state.aim, bodyAngle: state.local.angle,
        id: state.me, color: meta ? meta.color : '#ffd23f'
      },
      { weapon: state.you.w, hit: state.you.hp < 100 && state.hurtFlash > 0 }
    );
  }

  renderer.drawEffects();
  renderer.drawBuildings();
  renderer.end();

  hud.draw(state, state.time);
}

// --------------------------------------------------------- service worker

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Unlock audio on the very first interaction (required on iOS).
const unlock = () => { sfx.unlock(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);
