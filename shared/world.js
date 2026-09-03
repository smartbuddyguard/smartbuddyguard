// The game world. In multiplayer the server owns this simulation and clients
// only predict their own movement; the offline/solo build runs exactly the
// same class inside the browser. That is why it lives in shared/.

import {
  CAR_TYPES, CAR_POLICE, WEAPONS, PLAYER_MAX_HP, PLAYER_RADIUS,
  RESPAWN_TIME, MAX_PEDS, MAX_TRAFFIC, MAX_POLICE, MAX_WANTED, WANTED_DECAY,
  CRIME_KILL_PED, CRIME_KILL_COP, CRIME_SHOOT, CRIME_RUNOVER, LANE_OFFSET, MAX_PARKED,
  P_PISTOL, P_UZI, P_SHOTGUN, P_ROCKET, P_HEALTH, P_ARMOUR, P_CASH, PICKUP_RESPAWN
} from './constants.js';
import { generateCity } from './city.js';
import { stepPlayer, stepCar, carRadius, raycastTiles, resolveCircleTiles, clampToMap } from './physics.js';
import { clamp, dist, dist2, angleDiff, makeRng } from './util.js';

export class World {
  constructor(seed = (Math.random() * 1e9) | 0) {
    this.seed = seed >>> 0;
    this.city = generateCity(this.seed);
    this.rng = makeRng(this.seed ^ 0x1234);
    this.players = new Map();
    this.cars = new Map();
    this.peds = new Map();
    this.pickups = new Map();
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.tick = 0;
    this.rosterDirty = true;

    for (const s of this.city.pickupSpots) this.spawnPickup(s.x, s.y, s.kind);
    for (let i = 0; i < MAX_TRAFFIC; i++) this.spawnTrafficCar();
    for (let i = 0; i < MAX_PARKED; i++) this.spawnParkedCar();
    for (let i = 0; i < MAX_PEDS; i++) this.spawnPed();
  }

  id() { return this.nextId++; }
  rand(a = 0, b = 1) { return a + this.rng() * (b - a); }
  randInt(n) { return (this.rng() * n) | 0; }

  // ---------------------------------------------------------------- spawning

  freeWalkSpot() {
    for (let tries = 0; tries < 30; tries++) {
      const s = this.city.walkSpots[this.randInt(this.city.walkSpots.length)];
      let clear = true;
      for (const p of this.players.values()) {
        if (p.alive && !p.carId && dist2(p.x, p.y, s.x, s.y) < 120 * 120) { clear = false; break; }
      }
      if (clear) return s;
    }
    return this.city.walkSpots[0];
  }

  spawnPickup(x, y, kind, opts = {}) {
    const id = this.id();
    this.pickups.set(id, {
      id, x, y, kind, active: true, respawnAt: 0,
      amount: opts.amount,                       // overrides the default amount
      temp: !!opts.temp,                         // dropped loot: no respawn
      dieAt: opts.temp ? this.time + (opts.ttl || 45) : 0
    });
    return id;
  }

  // Loot dropped where somebody went down – the logical way to get a gun.
  dropLoot(x, y, kind, amount, ttl = 45) {
    // Keep the street tidy: drop only if nothing comparable lies right there.
    for (const pu of this.pickups.values()) {
      if (pu.temp && pu.kind === kind && dist2(pu.x, pu.y, x, y) < 40 * 40) return null;
    }
    const id = this.spawnPickup(x + this.rand(-12, 12), y + this.rand(-12, 12), kind, { amount, temp: true, ttl });
    this.events.push({ t: 'drop', x, y, kind });
    return id;
  }

  randomNode() { return this.randInt(this.city.nodes.length); }

  spawnTrafficCar(kind = null) {
    const n = this.city.nodes[this.randomNode()];
    const next = this.city.nodes[n.links[this.randInt(n.links.length)]];
    const ang = Math.atan2(next.y - n.y, next.x - n.x);
    const k = kind === null ? [0, 1, 2, 3, 4, 6][this.randInt(6)] : kind;
    const off = { x: Math.sin(ang) * LANE_OFFSET, y: -Math.cos(ang) * LANE_OFFSET };
    const car = this.makeCar(n.x - off.x, n.y - off.y, ang, k);
    car.role = 'traffic';
    car.npc = { node: this.city.nodes.indexOf(next), from: this.city.nodes.indexOf(n), speed: this.rand(0.55, 0.95) };
    return car;
  }

  // Parked cars at the kerb so there is always something to steal nearby.
  spawnParkedCar() {
    const nodes = this.city.nodes;
    for (let tries = 0; tries < 20; tries++) {
      const n = nodes[this.randomNode()];
      const next = nodes[n.links[this.randInt(n.links.length)]];
      if (!next) continue;
      const t = this.rand(0.2, 0.8);
      const ang = Math.atan2(next.y - n.y, next.x - n.x);
      const kerb = (this.rng() < 0.5 ? 1 : -1) * 44;
      const x = n.x + (next.x - n.x) * t + Math.sin(ang) * kerb;
      const y = n.y + (next.y - n.y) * t - Math.cos(ang) * kerb;
      let blocked = false;
      for (const c of this.cars.values()) {
        if (dist2(c.x, c.y, x, y) < 74 * 74) { blocked = true; break; }
      }
      if (blocked) continue;
      const car = this.makeCar(x, y, ang, [0, 1, 2, 3, 4, 6][this.randInt(6)]);
      car.role = 'parked';
      return car;
    }
    return null;
  }

  makeCar(x, y, angle, kind) {
    const id = this.id();
    const t = CAR_TYPES[kind];
    const car = {
      id, kind, x, y, angle, vx: 0, vy: 0, speed: 0,
      hp: t.hp, maxHp: t.hp, driver: null, npc: null, role: 'parked', cop: kind === CAR_POLICE,
      siren: false, fireCd: 0, colorSeed: this.randInt(1000)
    };
    this.cars.set(id, car);
    return car;
  }

  spawnPed() {
    const s = this.city.walkSpots[this.randInt(this.city.walkSpots.length)];
    const id = this.id();
    const ped = {
      id, x: s.x + this.rand(-10, 10), y: s.y + this.rand(-10, 10), vx: 0, vy: 0,
      angle: this.rand(-Math.PI, Math.PI), hp: 40, state: 0, panic: 0,
      target: this.city.walkSpots[this.randInt(this.city.walkSpots.length)],
      speed: this.rand(48, 70)
    };
    this.peds.set(id, ped);
    return ped;
  }

  addPlayer(id, name, color) {
    const s = this.freeWalkSpot();
    const p = {
      id, name, color, x: s.x, y: s.y, vx: 0, vy: 0, angle: 0,
      hp: PLAYER_MAX_HP, armour: 0, alive: true, respawnAt: 0, moving: 0,
      weapon: 0, ammo: { 1: 0, 2: 0, 3: 0, 4: 0 },
      owned: { 1: false, 2: false, 3: false, 4: false },
      wanted: 0, wantedTimer: 0, kills: 0, deaths: 0, cash: 0, score: 0,
      carId: null, fireCd: 0, input: emptyInput(), lastSeq: 0, enterLatch: false,
      switchLatch: false, hitFlash: 0, joinedAt: this.time
    };
    this.players.set(id, p);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p && p.carId) {
      const car = this.cars.get(p.carId);
      if (car) car.driver = null;
    }
    this.players.delete(id);
    this.rosterDirty = true;
  }

  // ------------------------------------------------------------------- input

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = {
      mx: clamp(+input.mx || 0, -1, 1),
      my: clamp(+input.my || 0, -1, 1),
      aim: +input.aim || 0,
      fire: !!input.fire,
      brake: !!input.brake,
      enter: !!input.enter,
      swap: !!input.swap
    };
    if (typeof input.seq === 'number') p.lastSeq = input.seq;
  }

  // -------------------------------------------------------------------- step

  step(dt) {
    this.time += dt;
    this.tick++;
    this.updatePlayers(dt);
    this.updateNpcCars(dt);
    this.updatePeds(dt);
    this.updateCarCollisions(dt);
    this.updatePolice(dt);
    this.updatePickups(dt);
    if (this.tick % 60 === 0) this.maintainWorld();
  }

  // Keeps traffic, parked cars and pedestrians topped up after mayhem.
  maintainWorld() {
    let traffic = 0, parked = 0;
    for (const c of this.cars.values()) {
      if (c.cop) continue;
      if (c.role === 'traffic' && !c.driver) traffic++;
      else if (c.role === 'parked') parked++;
    }
    if (traffic < MAX_TRAFFIC) this.spawnTrafficCar();
    if (parked < MAX_PARKED) this.spawnParkedCar();
    if (this.peds.size < MAX_PEDS) { this.spawnPed(); this.spawnPed(); }

    // Cops go home once nobody is wanted any more.
    const anyWanted = [...this.players.values()].some(p => p.alive && p.wanted >= 1);
    if (!anyWanted) {
      for (const c of this.cars.values()) {
        if (c.cop && !c.driver && this.rng() < 0.35) this.cars.delete(c.id);
      }
    }
  }

  updatePlayers(dt) {
    for (const p of this.players.values()) {
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.hitFlash = Math.max(0, p.hitFlash - dt);

      if (!p.alive) {
        if (this.time >= p.respawnAt) this.respawn(p);
        continue;
      }

      // Wanted level cools down when no crime is committed.
      if (p.wanted > 0) {
        p.wantedTimer += dt;
        if (p.wantedTimer > WANTED_DECAY) { p.wanted = Math.max(0, p.wanted - 1); p.wantedTimer = 0; this.rosterDirty = true; }
      }

      const car = p.carId ? this.cars.get(p.carId) : null;

      if (p.input.swap && !p.switchLatch) { this.cycleWeapon(p); p.switchLatch = true; }
      if (!p.input.swap) p.switchLatch = false;

      if (p.input.enter && !p.enterLatch) {
        p.enterLatch = true;
        if (car) this.exitCar(p, car);
        else this.tryEnterCar(p);
      }
      if (!p.input.enter) p.enterLatch = false;

      const nowCar = p.carId ? this.cars.get(p.carId) : null;

      if (nowCar) {
        const throttle = -p.input.my;               // stick up = forward
        const steer = p.input.mx;
        const impact = stepCar(this.city, nowCar, { throttle, steer, brake: p.input.brake }, dt);
        if (impact > 120) {
          const dmg = (impact - 120) * 0.16;
          this.damageCar(nowCar, dmg, p.id);
          this.events.push({ t: 'crash', x: nowCar.x, y: nowCar.y, m: clamp(impact / 400, 0, 1) });
        }
        p.x = nowCar.x; p.y = nowCar.y; p.angle = nowCar.angle;
        p.vx = nowCar.vx; p.vy = nowCar.vy;
        if (p.input.fire) this.fireWeapon(p, nowCar.angle, nowCar);
      } else {
        stepPlayer(this.city, p, { mx: p.input.mx, my: p.input.my }, dt);
        if (p.input.fire) this.fireWeapon(p, p.input.aim || p.angle, null);
      }
    }
  }

  // Picking a weapon straight out of the inventory.
  selectWeapon(p, w) {
    if (!p) return;
    if (w === 0) { p.weapon = 0; this.rosterDirty = true; return; }
    if (![1, 2, 3, 4].includes(w)) return;
    if (!(p.ammo[w] > 0)) return;                // empty guns stay holstered
    p.weapon = w;
    this.rosterDirty = true;
  }

  cycleWeapon(p) {
    const owned = [0];
    for (const k of [1, 2, 3, 4]) if (p.ammo[k] > 0) owned.push(k);
    const i = owned.indexOf(p.weapon);
    p.weapon = owned[(i + 1) % owned.length];
    this.rosterDirty = true;
  }

  tryEnterCar(p) {
    let best = null, bestD = 62 * 62;
    for (const car of this.cars.values()) {
      if (car.driver) continue;
      const d = dist2(p.x, p.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (!best) return;
    if (best.npc) {
      best.npc = null;
      best.vx *= 0.2; best.vy *= 0.2;
    }
    if (best.role === 'parked') best.role = 'traffic';
    best.driver = p.id;
    p.carId = best.id;
    if (best.cop) this.addWanted(p, 0.5);
    this.events.push({ t: 'enter', x: best.x, y: best.y, id: p.id });
    this.rosterDirty = true;
  }

  exitCar(p, car) {
    if (car.speed > 210) return; // too fast to jump out
    car.driver = null;
    p.carId = null;
    const side = car.angle + Math.PI / 2;
    p.x = car.x + Math.cos(side) * 34;
    p.y = car.y + Math.sin(side) * 34;
    p.vx = car.vx * 0.25; p.vy = car.vy * 0.25;
    resolveCircleTiles(this.city, p, PLAYER_RADIUS);
    clampToMap(p, PLAYER_RADIUS);
    car.siren = false;
    this.rosterDirty = true;
  }

  // ---------------------------------------------------------------- shooting

  fireWeapon(p, angle, fromCar) {
    const w = WEAPONS[p.weapon];
    if (!w) return;
    if (p.fireCd > 0) return;
    if (p.weapon !== 0) {
      if (!(p.ammo[p.weapon] > 0)) { p.weapon = 0; this.rosterDirty = true; return; }
      p.ammo[p.weapon]--;
      if (p.ammo[p.weapon] <= 0) { p.weapon = 0; }
      this.rosterDirty = true;
    }
    p.fireCd = w.rate;

    const muzzle = fromCar ? 30 : 16;
    const ox = p.x + Math.cos(angle) * muzzle;
    const oy = p.y + Math.sin(angle) * muzzle;
    const pellets = w.pellets || 1;

    for (let i = 0; i < pellets; i++) {
      const a = angle + (this.rand(-1, 1) * w.spread);
      const hit = this.traceShot(p, ox, oy, a, w, fromCar);
      this.events.push({ t: 'shot', x0: ox, y0: oy, x1: hit.x, y1: hit.y, w: p.weapon });
      if (w.splash) {
        this.explode(hit.x, hit.y, w.splash, w.dmg, p);
      }
    }

    if (p.weapon !== 0) this.addWanted(p, CRIME_SHOOT);
  }

  traceShot(shooter, ox, oy, angle, w, fromCar) {
    const ex = ox + Math.cos(angle) * w.range;
    const ey = oy + Math.sin(angle) * w.range;
    const wallHit = raycastTiles(this.city, ox, oy, ex, ey);
    let bestT = wallHit ? wallHit.t : 1;
    let target = null, targetKind = null;

    const dx = ex - ox, dy = ey - oy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;

    const test = (e, radius, kind) => {
      const rx = e.x - ox, ry = e.y - oy;
      const along = rx * nx + ry * ny;
      if (along < 0 || along > len) return;
      const perp = Math.abs(-rx * ny + ry * nx);
      if (perp > radius) return;
      const t = along / len;
      if (t < bestT) { bestT = t; target = e; targetKind = kind; }
    };

    for (const other of this.players.values()) {
      if (other === shooter || !other.alive) continue;
      if (other.carId) continue; // hitting the car covers players inside
      test(other, PLAYER_RADIUS + 4, 'player');
    }
    for (const ped of this.peds.values()) {
      if (ped.hp <= 0) continue;
      test(ped, 10, 'ped');
    }
    for (const car of this.cars.values()) {
      if (fromCar && car === fromCar) continue;
      test(car, carRadius(car.kind) + 3, 'car');
    }

    const hx = ox + nx * len * bestT;
    const hy = oy + ny * len * bestT;

    if (target && !w.splash) {
      if (targetKind === 'player') this.damagePlayer(target, w.dmg, shooter, w);
      else if (targetKind === 'ped') this.damagePed(target, w.dmg, shooter);
      else if (targetKind === 'car') this.damageCar(target, w.dmg * 0.8, shooter.id);
      this.events.push({ t: 'blood', x: hx, y: hy, kind: targetKind });
    } else if (!w.splash) {
      this.events.push({ t: 'spark', x: hx, y: hy });
    }

    // Pedestrians panic when shots go off nearby.
    for (const ped of this.peds.values()) {
      if (dist2(ped.x, ped.y, ox, oy) < 380 * 380) { ped.state = 1; ped.panic = 6; }
    }

    return { x: hx, y: hy, target, targetKind };
  }

  explode(x, y, radius, dmg, owner) {
    this.events.push({ t: 'boom', x, y, r: radius });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < radius) this.damagePlayer(p, dmg * (1 - d / radius), owner, { name: 'Explosion' });
    }
    for (const ped of this.peds.values()) {
      if (ped.hp <= 0) continue;
      const d = dist(ped.x, ped.y, x, y);
      if (d < radius) this.damagePed(ped, dmg * (1 - d / radius), owner);
    }
    for (const car of this.cars.values()) {
      const d = dist(car.x, car.y, x, y);
      if (d < radius * 1.4) {
        this.damageCar(car, dmg * 1.2 * (1 - d / (radius * 1.4)), owner ? owner.id : 0);
        const push = (1 - d / (radius * 1.4)) * 260;
        const a = Math.atan2(car.y - y, car.x - x);
        car.vx += Math.cos(a) * push;
        car.vy += Math.sin(a) * push;
      }
    }
    for (const ped of this.peds.values()) { ped.state = 1; ped.panic = 8; }
  }

  // ------------------------------------------------------------------ damage

  damagePlayer(p, dmg, attacker, weapon) {
    if (!p.alive || dmg <= 0) return;
    let d = dmg;
    if (p.armour > 0) {
      const absorbed = Math.min(p.armour, d * 0.65);
      p.armour -= absorbed;
      d -= absorbed;
    }
    p.hp -= d;
    p.hitFlash = 0.25;
    this.rosterDirty = true;
    if (p.hp <= 0) this.killPlayer(p, attacker, weapon);
  }

  killPlayer(p, attacker, weapon) {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.respawnAt = this.time + RESPAWN_TIME;
    p.wanted = 0;
    p.wantedTimer = 0;
    const car = p.carId ? this.cars.get(p.carId) : null;
    if (car) { car.driver = null; p.carId = null; }
    this.events.push({ t: 'blood', x: p.x, y: p.y, kind: 'player', big: 1 });

    // Whatever they were carrying stays on the pavement for the next person.
    if (p.weapon > 0 && p.ammo[p.weapon] > 0) {
      this.dropLoot(p.x, p.y, p.weapon, Math.min(p.ammo[p.weapon], 90));
    }
    if (p.cash >= 200) this.dropLoot(p.x, p.y, P_CASH, Math.round(p.cash * 0.25), 40);

    const killer = attacker && attacker.id && this.players.get(attacker.id) ? this.players.get(attacker.id) : null;
    if (killer && killer !== p) {
      killer.kills++;
      killer.score += 100;
      killer.cash += 250;
    }
    this.events.push({
      t: 'kill',
      killer: killer ? killer.id : 0,
      killerName: killer ? killer.name : (attacker && attacker.cop ? 'Police' : 'The city'),
      victim: p.id, victimName: p.name,
      weapon: weapon ? weapon.name : ''
    });
    this.rosterDirty = true;
  }

  damagePed(ped, dmg, attacker) {
    if (ped.hp <= 0) return;
    ped.hp -= dmg;
    ped.state = 1; ped.panic = 8;
    if (ped.hp <= 0) {
      this.events.push({ t: 'blood', x: ped.x, y: ped.y, kind: 'ped', big: 1 });
      this.peds.delete(ped.id);
      const killer = attacker && this.players.get(attacker.id);
      if (killer) {
        killer.score += 10;
        this.addWanted(killer, CRIME_KILL_PED);
      }
      if (this.rng() < 0.35) this.dropLoot(ped.x, ped.y, P_CASH, 40 + this.randInt(90), 30);
    }
  }

  damageCar(car, dmg, attackerId) {
    if (dmg <= 0) return;
    car.hp -= dmg;
    if (car.hp <= 0) {
      const attacker = this.players.get(attackerId);
      if (car.driver) {
        const drv = this.players.get(car.driver);
        if (drv) {
          drv.carId = null;
          this.damagePlayer(drv, 200, attacker || { id: 0 }, { name: 'Explosion' });
        }
      }
      if (car.cop && attacker) this.addWanted(attacker, CRIME_KILL_COP);
      if (car.cop) this.dropLoot(car.x, car.y, P_PISTOL, 14, 50);   // the officer's sidearm
      this.cars.delete(car.id);
      this.explode(car.x, car.y, 110, 90, attacker || null);
    }
  }

  addWanted(p, amount) {
    if (!p || !p.alive) return;
    p.wanted = clamp(p.wanted + amount, 0, MAX_WANTED);
    p.wantedTimer = 0;
    this.rosterDirty = true;
  }

  respawn(p) {
    const s = this.freeWalkSpot();
    p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
    p.hp = PLAYER_MAX_HP; p.armour = 0; p.alive = true;
    // You always start over with bare fists – guns have to be found again.
    p.weapon = 0;
    p.ammo = { 1: 0, 2: 0, 3: 0, 4: 0 };
    p.owned = { 1: false, 2: false, 3: false, 4: false };
    p.wanted = 0; p.wantedTimer = 0; p.carId = null;
    this.rosterDirty = true;
    this.events.push({ t: 'spawn', x: p.x, y: p.y, id: p.id });
  }

  // -------------------------------------------------------------- npc drivers

  updateNpcCars(dt) {
    for (const car of this.cars.values()) {
      if (!car.npc || car.driver) continue;
      const nodes = this.city.nodes;
      let node = nodes[car.npc.node];
      if (!node) { car.npc.node = this.randomNode(); node = nodes[car.npc.node]; }

      const travel = Math.atan2(node.y - car.y, node.x - car.x);
      const tx = node.x + Math.sin(travel) * LANE_OFFSET;
      const ty = node.y - Math.cos(travel) * LANE_OFFSET;

      if (dist2(car.x, car.y, node.x, node.y) < 46 * 46) {
        const links = node.links.filter(l => l !== car.npc.from);
        const nextIdx = links.length ? links[this.randInt(links.length)] : node.links[0];
        car.npc.from = car.npc.node;
        car.npc.node = nextIdx;
      }

      const want = Math.atan2(ty - car.y, tx - car.x);
      const diff = angleDiff(car.angle, want);
      const steer = clamp(diff * 2.2, -1, 1);

      // Look ahead and brake for anything in the way.
      const lookAhead = 46 + car.speed * 0.34;
      const ax = car.x + Math.cos(car.angle) * lookAhead;
      const ay = car.y + Math.sin(car.angle) * lookAhead;
      let blocked = false;
      for (const other of this.cars.values()) {
        if (other === car) continue;
        if (dist2(other.x, other.y, ax, ay) < 46 * 46) { blocked = true; break; }
      }
      if (!blocked) {
        for (const p of this.players.values()) {
          if (p.alive && !p.carId && dist2(p.x, p.y, ax, ay) < 34 * 34) { blocked = true; break; }
        }
      }
      if (!blocked && raycastTiles(this.city, car.x, car.y, ax, ay)) blocked = true;

      const throttle = blocked ? -0.6 : car.npc.speed * (Math.abs(diff) > 0.8 ? 0.4 : 1);
      stepCar(this.city, car, { throttle, steer, brake: false }, dt);
    }
  }

  // ------------------------------------------------------------------- peds

  updatePeds(dt) {
    for (const ped of this.peds.values()) {
      let tx = ped.target.x, ty = ped.target.y;
      let speed = ped.speed;

      if (ped.panic > 0) {
        ped.panic -= dt;
        speed = ped.speed * 1.9;
        // run away from the closest threat
        let threat = null, bd = 300 * 300;
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          const d = dist2(p.x, p.y, ped.x, ped.y);
          if (d < bd) { bd = d; threat = p; }
        }
        for (const car of this.cars.values()) {
          if (car.speed < 90) continue;
          const d = dist2(car.x, car.y, ped.x, ped.y);
          if (d < bd) { bd = d; threat = car; }
        }
        if (threat) {
          const a = Math.atan2(ped.y - threat.y, ped.x - threat.x);
          tx = ped.x + Math.cos(a) * 200;
          ty = ped.y + Math.sin(a) * 200;
        }
      } else if (dist2(ped.x, ped.y, tx, ty) < 26 * 26) {
        ped.target = this.city.walkSpots[this.randInt(this.city.walkSpots.length)];
        ped.state = 0;
      }

      const a = Math.atan2(ty - ped.y, tx - ped.x);
      ped.vx += (Math.cos(a) * speed - ped.vx) * clamp(dt * 6, 0, 1);
      ped.vy += (Math.sin(a) * speed - ped.vy) * clamp(dt * 6, 0, 1);
      ped.angle = Math.atan2(ped.vy, ped.vx);
      ped.x += ped.vx * dt;
      ped.y += ped.vy * dt;
      resolveCircleTiles(this.city, ped, 8);
      clampToMap(ped, 8);
      ped.state = ped.panic > 0 ? 1 : 0;
    }
  }

  // --------------------------------------------------------------- collisions

  updateCarCollisions(dt) {
    const cars = [...this.cars.values()];
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      const ra = carRadius(a.kind);
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const rb = carRadius(b.kind);
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = ra + rb;
        if (d2 > min * min || d2 < 0.001) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const pen = min - d;
        const ma = CAR_TYPES[a.kind].mass, mb = CAR_TYPES[b.kind].mass;
        const total = ma + mb;
        a.x -= nx * pen * (mb / total); a.y -= ny * pen * (mb / total);
        b.x += nx * pen * (ma / total); b.y += ny * pen * (ma / total);
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.9;
          a.vx -= nx * imp * (mb / total); a.vy -= ny * imp * (mb / total);
          b.vx += nx * imp * (ma / total); b.vy += ny * imp * (ma / total);
          if (imp > 90) {
            this.events.push({ t: 'crash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, m: clamp(imp / 400, 0, 1) });
            this.damageCar(a, imp * 0.10, a.driver || 0);
            this.damageCar(b, imp * 0.10, b.driver || 0);
          }
        }
      }

      // Cars running over people
      for (const ped of this.peds.values()) {
        if (dist2(ped.x, ped.y, a.x, a.y) < (ra + 9) * (ra + 9)) {
          if (a.speed > 70) {
            this.damagePed(ped, 200, a.driver ? { id: a.driver } : null);
            const drv = a.driver && this.players.get(a.driver);
            if (drv) this.addWanted(drv, CRIME_RUNOVER);
          } else {
            const push = Math.atan2(ped.y - a.y, ped.x - a.x);
            ped.vx += Math.cos(push) * 60; ped.vy += Math.sin(push) * 60;
            ped.panic = Math.max(ped.panic, 3);
          }
        }
      }

      // Cars hitting players on foot
      for (const p of this.players.values()) {
        if (!p.alive || p.carId) continue;
        if (dist2(p.x, p.y, a.x, a.y) < (ra + PLAYER_RADIUS) * (ra + PLAYER_RADIUS)) {
          const push = Math.atan2(p.y - a.y, p.x - a.x);
          p.vx += Math.cos(push) * (60 + a.speed * 0.6);
          p.vy += Math.sin(push) * (60 + a.speed * 0.6);
          if (a.speed > 90) {
            const attacker = a.driver ? this.players.get(a.driver) : { id: 0, cop: a.cop };
            this.damagePlayer(p, a.speed * 0.16, attacker || { id: 0 }, { name: 'Roadkill' });
            const drv = a.driver && this.players.get(a.driver);
            if (drv && drv !== p) this.addWanted(drv, CRIME_RUNOVER);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ police

  updatePolice(dt) {
    const wantedPlayers = [...this.players.values()].filter(p => p.alive && p.wanted >= 1);
    const copCars = [...this.cars.values()].filter(c => c.cop);

    // Spawn enough units for the highest wanted level in town.
    const maxWanted = wantedPlayers.reduce((m, p) => Math.max(m, Math.floor(p.wanted)), 0);
    const desired = clamp(maxWanted * 2, 0, MAX_POLICE);
    if (copCars.length < desired && this.tick % 30 === 0) {
      const target = wantedPlayers[this.randInt(wantedPlayers.length)];
      if (target) this.spawnCopNear(target);
    }

    for (const car of copCars) {
      if (car.driver) continue; // a player stole this cruiser
      let target = null, bd = Infinity;
      for (const p of wantedPlayers) {
        const d = dist2(p.x, p.y, car.x, car.y);
        if (d < bd) { bd = d; target = p; }
      }
      car.fireCd = Math.max(0, car.fireCd - dt);

      if (!target) {
        car.siren = false;
        if (!car.npc) car.npc = { node: this.randomNode(), from: -1, speed: 0.7 };
        continue;
      }

      car.siren = true;
      car.npc = null;
      const d = Math.sqrt(bd);
      const want = Math.atan2(target.y - car.y, target.x - car.x);
      const diff = angleDiff(car.angle, want);
      const steer = clamp(diff * 2.4, -1, 1);
      let throttle = 1;
      if (d < 90) throttle = 0.25;
      if (Math.abs(diff) > 2.2 && d < 160) throttle = -0.7;
      stepCar(this.city, car, { throttle, steer, brake: false }, dt);

      // Cops shoot at close range when they can see the target.
      if (d < 260 && car.fireCd <= 0 && !raycastTiles(this.city, car.x, car.y, target.x, target.y)) {
        car.fireCd = target.wanted >= 3 ? 0.55 : 0.95;
        const a = want + this.rand(-0.09, 0.09);
        const ex = car.x + Math.cos(a) * 300, ey = car.y + Math.sin(a) * 300;
        this.events.push({ t: 'shot', x0: car.x + Math.cos(a) * 26, y0: car.y + Math.sin(a) * 26, x1: ex, y1: ey, w: 1 });
        if (!target.carId) {
          this.damagePlayer(target, 9, { id: 0, cop: true }, { name: 'Police' });
        } else {
          const c = this.cars.get(target.carId);
          if (c) this.damageCar(c, 7, 0);
        }
      }
    }
  }

  spawnCopNear(target) {
    let best = null, bd = Infinity;
    for (let i = 0; i < this.city.nodes.length; i++) {
      const n = this.city.nodes[i];
      const d = dist2(n.x, n.y, target.x, target.y);
      if (d > 700 * 700 && d < 1500 * 1500 && d < bd) { bd = d; best = n; }
    }
    if (!best) best = this.city.nodes[this.randomNode()];
    const car = this.makeCar(best.x, best.y, this.rand(-Math.PI, Math.PI), CAR_POLICE);
    car.siren = true;
    return car;
  }

  // ----------------------------------------------------------------- pickups

  updatePickups(dt) {
    for (const pu of this.pickups.values()) {
      if (pu.temp && this.time >= pu.dieAt) { this.pickups.delete(pu.id); continue; }
      if (!pu.active) {
        if (this.time >= pu.respawnAt) pu.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.carId) continue;
        if (dist2(p.x, p.y, pu.x, pu.y) > 24 * 24) continue;
        const got = this.applyPickup(p, pu.kind, pu.amount);
        if (!got) continue;
        this.events.push({ t: 'pickup', x: pu.x, y: pu.y, kind: pu.kind, id: p.id, amount: got });
        if (pu.temp) {
          this.pickups.delete(pu.id);            // dropped loot is gone for good
        } else {
          pu.active = false;
          pu.respawnAt = this.time + PICKUP_RESPAWN;
        }
        break;
      }
    }
  }

  // Returns how much was actually taken (0 = nothing needed, pickup stays).
  applyPickup(p, kind, amount) {
    let got = 0;
    switch (kind) {
      case P_PISTOL: got = amount || 34; p.ammo[1] += got; p.owned[1] = true; p.weapon = 1; break;
      case P_UZI: got = amount || 110; p.ammo[2] += got; p.owned[2] = true; p.weapon = 2; break;
      case P_SHOTGUN: got = amount || 18; p.ammo[3] += got; p.owned[3] = true; p.weapon = 3; break;
      case P_ROCKET: got = amount || 4; p.ammo[4] += got; p.owned[4] = true; p.weapon = 4; break;
      case P_HEALTH:
        if (p.hp >= PLAYER_MAX_HP) return 0;
        got = Math.round(PLAYER_MAX_HP - p.hp);
        p.hp = PLAYER_MAX_HP;
        break;
      case P_ARMOUR:
        if (p.armour >= 100) return 0;
        got = Math.round(100 - p.armour);
        p.armour = 100;
        break;
      case P_CASH:
        got = amount || 500;
        p.cash += got;
        p.score += 25;
        break;
      default: return 0;
    }
    this.rosterDirty = true;
    return got;
  }
}

function emptyInput() {
  return { mx: 0, my: 0, aim: 0, fire: false, brake: false, enter: false, swap: false };
}
