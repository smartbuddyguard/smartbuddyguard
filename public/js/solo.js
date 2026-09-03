// Offline / single player mode: runs the exact same world simulation as the
// multiplayer server, just inside the browser. No websocket, no server.

import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Controls, loadScheme, mountSchemePicker } from './controls.js';
import { World } from '/shared/world.js';
import { SIM_DT, CAR_TYPES } from '/shared/constants.js';
import { clamp, angleDiff } from '/shared/util.js';

const ME = 1;

const canvas = document.getElementById('game');
const menu = document.getElementById('menu');
const playBtn = document.getElementById('play');
const nameInput = document.getElementById('name');
const colorsEl = document.getElementById('colors');
const pauseEl = document.getElementById('pause');
const pauseStats = document.getElementById('pauseStats');
const resumeBtn = document.getElementById('resume');
const newCityBtn = document.getElementById('newCity');
const rotateHint = document.getElementById('rotate');
const toastEl = document.getElementById('toast');

const COLORS = ['#ffd23f', '#ff5f4d', '#59d66f', '#59b7ff', '#c86bff', '#ffffff', '#ff8fc7', '#8de0d6'];
let chosenColor = load('lc_color') || COLORS[0];
nameInput.value = load('lc_name') || '';

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

for (const c of COLORS) {
  const d = document.createElement('div');
  d.className = 'swatch' + (c === chosenColor ? ' sel' : '');
  d.style.background = c;
  d.onclick = () => {
    chosenColor = c;
    save('lc_color', c);
    [...colorsEl.children].forEach(el => el.classList.remove('sel'));
    d.classList.add('sel');
  };
  colorsEl.appendChild(d);
}

// When this file runs as a standalone bundle the page may have no viewport
// meta tag of its own – without it phones render at a fake 980px width.
if (!document.querySelector('meta[name="viewport"]')) {
  const m = document.createElement('meta');
  m.name = 'viewport';
  m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.head.appendChild(m);
}

const sfx = new Sfx();
const input = new Input(canvas);
const controls = new Controls(loadScheme());
mountSchemePicker(document.getElementById('scheme'), document.getElementById('schemeHint'), controls);

let world = null;
let player = null;
let renderer = null;
let hud = null;
let running = false;
let paused = false;

const state = {
  entities: new Map(),
  rosterById: new Map(),
  local: { x: 0, y: 0 },
  you: null,
  ping: 0,
  fps: 0,
  playerCount: 1,
  time: 0,
  invOpen: false,
  pickupLog: []
};

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
  else {
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }
  input.layout(w, h, safe);
  if (hud) hud.safe = safe;
  rotateHint.classList.toggle('hidden', !(running && h > w && w < 560));
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) input.releaseAll(); });
resize();

// -------------------------------------------------------------------- start

function start(seed) {
  const name = (nameInput.value || '').trim().slice(0, 14) || 'Spieler';
  save('lc_name', name);
  sfx.unlock();

  world = new World(seed !== undefined ? seed : ((Math.random() * 1e9) | 0));
  player = world.addPlayer(ME, name, chosenColor);
  state.rosterById = new Map([[ME, { id: ME, name, color: chosenColor, wanted: 0 }]]);

  if (!renderer) {
    renderer = new Renderer(canvas, world.city);
    hud = new Hud(renderer, input);
    input.onScores = togglePause;
    input.onInventory = toggleInventory;
    input.onSelectWeapon = selectWeapon;
    input.modalHitTest = inventoryTap;
  } else {
    renderer.setCity(world.city);
    renderer.decals.length = 0;
    renderer.skids.length = 0;
    renderer.particles.length = 0;
    renderer.tracers.length = 0;
    hud.killFeed.length = 0;
  }

  renderer.cam.x = player.x;
  renderer.cam.y = player.y;
  state.local.x = player.x;
  state.local.y = player.y;
  state.time = 0;
  state.invOpen = false;
  state.pickupLog.length = 0;

  resize();
  menu.classList.add('hidden');
  pauseEl.classList.add('hidden');
  paused = false;
  running = true;
  lastFrame = performance.now();
  acc = 0;
  toast('Klau dir ein Auto und dreh auf. ★ = die Cops sind hinter dir her.', 4000);
  requestAnimationFrame(frame);
}

playBtn.onclick = () => start();
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

function togglePause() {
  if (!running) return;
  paused = !paused;
  pauseEl.classList.toggle('hidden', !paused);
  input.releaseAll();
  if (paused) {
    mountSchemePicker(document.getElementById('pauseScheme'), document.getElementById('pauseSchemeHint'), controls);
    const y = state.you;
    pauseStats.innerHTML = y
      ? `<tr><td>Kills</td><td class="num">${y.k}</td></tr>` +
        `<tr><td>Tode</td><td class="num">${y.d}</td></tr>` +
        `<tr><td>Geld</td><td class="num">$${y.cash}</td></tr>` +
        `<tr><td>Fahndung</td><td class="num">${'★'.repeat(y.wl) || '–'}</td></tr>` +
        `<tr><td>Zeit</td><td class="num">${Math.floor(state.time / 60)}:${String(Math.floor(state.time % 60)).padStart(2, '0')}</td></tr>`
      : '';
  } else {
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
}
resumeBtn.onclick = togglePause;
newCityBtn.onclick = () => { pauseEl.classList.add('hidden'); paused = false; start(); };

// ---------------------------------------------------------------- inventory

function toggleInventory() {
  if (!running) return;
  state.invOpen = !state.invOpen;
  input.releaseAll();
  if (state.invOpen) toastEl.classList.add('hidden');   // keep the header readable
}

function selectWeapon(w) {
  if (!player || !player.alive) return;
  world.selectWeapon(player, w);
  state.invOpen = false;
}

function inventoryTap(x, y) {
  if (!state.invOpen || !hud) return false;
  const hit = hud.hitInventory(x, y);
  if (hit === 'close') state.invOpen = false;
  else if (typeof hit === 'number') selectWeapon(hit);
  return true;
}

// ------------------------------------------------------------------- aiming

function computeAim() {
  const car = player.carId ? world.cars.get(player.carId) : null;
  if (car) return car.angle;

  if (input.mouse.active && !input.touchUsed && renderer) {
    const w = renderer.screenToWorld(input.mouse.x, input.mouse.y);
    return Math.atan2(w.y - player.y, w.x - player.x);
  }

  const base = player.angle;
  let best = null, bestScore = Infinity;
  for (const ped of world.peds.values()) {
    const dx = ped.x - player.x, dy = ped.y - player.y;
    const dd = Math.hypot(dx, dy);
    if (dd > 340) continue;
    const diff = Math.abs(angleDiff(base, Math.atan2(dy, dx)));
    if (diff > 0.6) continue;
    const score = dd + diff * 260;
    if (score < bestScore) { bestScore = score; best = ped; }
  }
  if (best) return Math.atan2(best.y - player.y, best.x - player.x);
  return base;
}

// ------------------------------------------------------------------- events

function consumeEvents() {
  const focus = player.carId ? world.cars.get(player.carId) : player;
  for (const ev of world.events) {
    const ex = ev.x !== undefined ? ev.x : ev.x0;
    const ey = ev.y !== undefined ? ev.y : ev.y0;
    const d = ex === undefined ? 0 : Math.hypot(ex - focus.x, ey - focus.y);
    const vol = clamp(1 - d / 1000, 0, 1);

    switch (ev.t) {
      case 'shot':
        renderer.addTracer(ev.x0, ev.y0, ev.x1, ev.y1, ev.w);
        if (Math.hypot(ev.x0 - player.x, ev.y0 - player.y) < 46) {
          renderer.markAction('p' + ME, ev.w > 0 ? 'shoot' : 'punch');
        }
        if (vol > 0.02) sfx.shot(ev.w, vol);
        break;
      case 'blood': renderer.addBlood(ev.x, ev.y, ev.big); break;
      case 'spark': renderer.addSpark(ev.x, ev.y); break;
      case 'boom':
        renderer.addExplosion(ev.x, ev.y, ev.r);
        if (vol > 0.02) sfx.boom(vol);
        break;
      case 'crash':
        if (vol > 0.03) sfx.crash(ev.m * vol);
        if (d < 400) renderer.shake(6 * ev.m);
        break;
      case 'pickup':
        if (ev.id === ME) {
          sfx.pickup();
          state.pickupLog.unshift({ kind: ev.kind, amount: ev.amount, t: state.time });
          state.pickupLog.length = Math.min(state.pickupLog.length, 6);
        }
        break;
      case 'kill':
        hud.pushKill(`${ev.killerName} ☠ ${ev.victimName}${ev.weapon ? ' · ' + ev.weapon : ''}`, state.time);
        if (ev.victim === ME) { sfx.die(); renderer.shake(14); }
        break;
    }
  }
  world.events.length = 0;
}

// -------------------------------------------------------------- render state

function youFrom() {
  const car = player.carId ? world.cars.get(player.carId) : null;
  return {
    hp: Math.round(player.hp), ar: Math.round(player.armour),
    al: player.alive ? 1 : 0,
    rs: player.alive ? 0 : Math.max(0, Math.round((player.respawnAt - world.time) * 10) / 10),
    w: player.weapon,
    am: player.ammo[player.weapon] === undefined ? -1 : player.ammo[player.weapon],
    wl: Math.floor(player.wanted),
    cash: player.cash, k: player.kills, d: player.deaths,
    iv: [player.ammo[1] | 0, player.ammo[2] | 0, player.ammo[3] | 0, player.ammo[4] | 0],
    ow: (player.owned[1] ? 1 : 0) | (player.owned[2] ? 2 : 0) | (player.owned[3] ? 4 : 0) | (player.owned[4] ? 8 : 0),
    car: car ? car.id : 0, ck: car ? car.kind : -1,
    chp: car ? Math.round((car.hp / car.maxHp) * 100) : 0,
    sp: car ? Math.round(car.speed) : Math.round(Math.hypot(player.vx, player.vy)),
    cn: car ? CAR_TYPES[car.kind].name : ''
  };
}

function buildEntityMap() {
  const m = state.entities;
  m.clear();
  for (const c of world.cars.values()) m.set(c.id, { id: c.id, type: 2, x: c.x, y: c.y, siren: c.siren });
  for (const pu of world.pickups.values()) {
    if (pu.active) m.set(pu.id, { id: pu.id, type: 4, x: pu.x, y: pu.y, kind: pu.kind });
  }
}

// -------------------------------------------------------------------- loop

let lastFrame = performance.now();
let acc = 0;
let fpsAcc = 0, fpsCount = 0;
let hurtFlash = 0;

function frame(now) {
  if (!running || paused) return;
  requestAnimationFrame(frame);

  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.25) dt = 0.25;
  state.time += dt;

  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) {
    state.fps = Math.round(fpsCount / fpsAcc);
    state.netLabel = `${state.fps} fps · Solo (offline)`;
    fpsAcc = 0; fpsCount = 0;
  }

  const car = player.carId ? world.cars.get(player.carId) : null;
  const inCar = !!car;
  const carFwd = car ? car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle) : 0;
  const raw = input.sample(0, inCar);
  const inp = controls.convert(raw, {
    inCar,
    carAngle: car ? car.angle : 0,
    carFwd,
    playerAngle: player.angle,
    autoAim: computeAim(),
    dt
  });
  const aim = inp.aim;
  if (state.invOpen) {                    // hands are busy rummaging
    inp.mx = 0; inp.my = 0; inp.fire = false; inp.enter = false; inp.swap = false;
  }
  world.setInput(ME, { mx: inp.mx, my: inp.my, aim, fire: inp.fire, brake: inp.brake, enter: inp.enter, swap: inp.swap });

  const prevHp = player.hp;
  acc += dt;
  let steps = 0;
  while (acc >= SIM_DT && steps < 5) { world.step(SIM_DT); acc -= SIM_DT; steps++; }
  hurtFlash = Math.max(0, hurtFlash - dt);
  if (player.hp < prevHp - 0.5 && player.alive) { sfx.hurt(); hurtFlash = 0.25; }

  if (controls.scheme === 'classic' && !car) player.angle = controls.heading;

  consumeEvents();
  buildEntityMap();

  state.you = youFrom();
  const meta = state.rosterById.get(ME);
  if (meta) meta.wanted = state.you.wl;
  state.local.x = player.x;
  state.local.y = player.y;

  draw(dt, aim, inp);
}

function draw(dt, aim, inp) {
  const car = player.carId ? world.cars.get(player.carId) : null;
  const focus = car || player;
  const speed = Math.hypot(focus.vx, focus.vy);

  if (car && inp.brake && car.speed > 130 && Math.random() < 0.5) {
    const side = car.angle + Math.PI / 2;
    const bx = car.x - Math.cos(car.angle) * 18, by = car.y - Math.sin(car.angle) * 18;
    renderer.addSkid(bx + Math.cos(side) * 11, by + Math.sin(side) * 11, car.angle);
    renderer.addSkid(bx - Math.cos(side) * 11, by - Math.sin(side) * 11, car.angle);
  }

  renderer.updateCamera({ x: focus.x, y: focus.y, angle: focus.angle }, speed, dt, !car);
  renderer.updateEffects(dt);
  renderer.begin(dt);
  renderer.drawCity();

  // The whole city is simulated locally, so cull to the visible area before
  // drawing – on a phone that is the difference between 60 and 30 fps.
  const b = renderer.viewBounds(70);
  const visible = (e) => e.x > b.x0 && e.x < b.x1 && e.y > b.y0 && e.y < b.y1;

  for (const pu of world.pickups.values()) {
    if (pu.active && visible(pu)) renderer.drawPickup(pu, state.time);
  }
  for (const ped of world.peds.values()) {
    if (visible(ped)) renderer.drawPed(ped);
  }
  for (const c of world.cars.values()) {
    if (!visible(c)) continue;
    renderer.drawCar({
      x: c.x, y: c.y, kind: c.kind, colorSeed: c.colorSeed, siren: c.siren,
      hpPct: (c.hp / c.maxHp) * 100, braking: c.driver === ME && inp.brake
    }, c.angle);
  }
  if (player.alive && !car) {
    // The torso follows where we walk, the arms and head follow where we aim.
    renderer.drawPlayer(
      {
        x: player.x, y: player.y,
        angle: aim, bodyAngle: player.angle,
        id: ME, color: state.rosterById.get(ME).color
      },
      { weapon: player.weapon, hit: hurtFlash > 0 }
    );
  }

  renderer.drawEffects();
  renderer.drawBuildings();
  renderer.end();

  hud.draw(state, state.time);

  const kind = car ? CAR_TYPES[car.kind] : null;
  sfx.updateEngine(!!car, kind ? clamp(car.speed / kind.max, 0, 1) : 0);
  let closeness = 0;
  for (const c of world.cars.values()) {
    if (!c.siren) continue;
    closeness = Math.max(closeness, clamp(1 - Math.hypot(c.x - player.x, c.y - player.y) / 700, 0, 1));
  }
  sfx.updateSiren(closeness);
}

const unlock = () => { sfx.unlock(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);
