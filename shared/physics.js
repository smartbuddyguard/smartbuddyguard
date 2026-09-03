// Movement + collision. Both the authoritative server simulation and the
// client side prediction call these, so a predicted move matches the server.

import { TILE, MAP_SIZE, PLAYER_ACCEL, PLAYER_MAX_SPEED, PLAYER_FRICTION, PLAYER_RADIUS, CAR_TYPES } from './constants.js';
import { clamp } from './util.js';
import { isSolidTile } from './city.js';

// Push a circle out of solid tiles. Returns the impact speed of the hardest hit.
export function resolveCircleTiles(city, ent, radius) {
  let impact = 0;
  const minTx = Math.floor((ent.x - radius) / TILE);
  const maxTx = Math.floor((ent.x + radius) / TILE);
  const minTy = Math.floor((ent.y - radius) / TILE);
  const maxTy = Math.floor((ent.y + radius) / TILE);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isSolidTile(city, tx, ty)) continue;
      const bx = tx * TILE, by = ty * TILE;
      const cx = clamp(ent.x, bx, bx + TILE);
      const cy = clamp(ent.y, by, by + TILE);
      let dx = ent.x - cx, dy = ent.y - cy;
      let d2 = dx * dx + dy * dy;
      if (d2 >= radius * radius) continue;

      let nx, ny, pen;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        nx = dx / d; ny = dy / d; pen = radius - d;
      } else {
        // Centre inside the tile: escape along the shallowest axis.
        const left = ent.x - bx, right = bx + TILE - ent.x;
        const top = ent.y - by, bottom = by + TILE - ent.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) { nx = -1; ny = 0; pen = left + radius; }
        else if (m === right) { nx = 1; ny = 0; pen = right + radius; }
        else if (m === top) { nx = 0; ny = -1; pen = top + radius; }
        else { nx = 0; ny = 1; pen = bottom + radius; }
      }

      ent.x += nx * pen;
      ent.y += ny * pen;
      const vn = ent.vx * nx + ent.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        ent.vx -= vn * nx * 1.25; // slight bounce
        ent.vy -= vn * ny * 1.25;
      }
    }
  }
  return impact;
}

export function clampToMap(ent, radius) {
  if (ent.x < radius) { ent.x = radius; ent.vx = Math.max(0, ent.vx); }
  if (ent.y < radius) { ent.y = radius; ent.vy = Math.max(0, ent.vy); }
  if (ent.x > MAP_SIZE - radius) { ent.x = MAP_SIZE - radius; ent.vx = Math.min(0, ent.vx); }
  if (ent.y > MAP_SIZE - radius) { ent.y = MAP_SIZE - radius; ent.vy = Math.min(0, ent.vy); }
}

// input: { mx, my } normalised move vector, optional { sprint }
export function stepPlayer(city, p, input, dt) {
  const mx = input.mx || 0, my = input.my || 0;
  const len = Math.hypot(mx, my);
  const speedMul = input.sprint ? 1.35 : 1;
  if (len > 0.08) {
    const nx = mx / len, ny = my / len;
    p.vx += nx * PLAYER_ACCEL * dt;
    p.vy += ny * PLAYER_ACCEL * dt;
    p.angle = Math.atan2(ny, nx);
    p.moving = 1;
  } else {
    p.moving = 0;
  }

  const f = Math.exp(-PLAYER_FRICTION * dt);
  p.vx *= f; p.vy *= f;

  const max = PLAYER_MAX_SPEED * speedMul;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > max) { p.vx = p.vx / sp * max; p.vy = p.vy / sp * max; }

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  resolveCircleTiles(city, p, PLAYER_RADIUS);
  clampToMap(p, PLAYER_RADIUS);
  return p;
}

// input: { throttle (-1..1), steer (-1..1), brake (bool) }
export function stepCar(city, c, input, dt) {
  const type = CAR_TYPES[c.kind] || CAR_TYPES[0];
  const throttle = clamp(input.throttle || 0, -1, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  const handbrake = !!input.brake;

  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  let fwd = c.vx * cos + c.vy * sin;      // velocity along the car
  let lat = -c.vx * sin + c.vy * cos;     // sideways velocity

  const damageMul = c.hp !== undefined ? clamp(0.55 + (c.hp / type.hp) * 0.45, 0.55, 1) : 1;
  const maxSpeed = type.max * damageMul;

  if (throttle > 0) fwd += type.acc * throttle * dt;
  else if (throttle < 0) fwd += (fwd > 0 ? -520 : type.acc * 0.55) * Math.abs(throttle) * dt;

  // Rolling resistance + drag
  fwd *= Math.exp(-(handbrake ? 3.2 : 0.9) * dt);
  if (Math.abs(fwd) > maxSpeed) fwd = Math.sign(fwd) * maxSpeed;
  if (Math.abs(fwd) < 3 && throttle === 0) fwd = 0;

  // Sideways grip: high grip = no slide, handbrake = drifting.
  const grip = handbrake ? 1.3 : type.grip;
  lat *= Math.exp(-grip * dt);

  // Steering scales with speed and flips when reversing.
  const speedFactor = clamp(Math.abs(fwd) / 120, 0, 1) * clamp(1.15 - Math.abs(fwd) / (type.max * 2.4), 0.45, 1);
  const turn = steer * 3.1 * speedFactor * Math.sign(fwd || 1);
  c.angle += turn * dt;
  if (c.angle > Math.PI) c.angle -= Math.PI * 2;
  if (c.angle < -Math.PI) c.angle += Math.PI * 2;
  // Drifting cars keep some of their old momentum sideways.
  lat += turn * Math.abs(fwd) * dt * (handbrake ? 0.55 : 0.12);

  const nc = Math.cos(c.angle), ns = Math.sin(c.angle);
  c.vx = fwd * nc - lat * ns;
  c.vy = fwd * ns + lat * nc;

  c.x += c.vx * dt;
  c.y += c.vy * dt;

  const radius = type.wid * 0.5 + 4;
  const impact = resolveCircleTiles(city, c, radius);
  clampToMap(c, radius);
  c.speed = Math.hypot(c.vx, c.vy);
  return impact;
}

export function carRadius(kind) {
  const t = CAR_TYPES[kind] || CAR_TYPES[0];
  return t.wid * 0.5 + 4;
}

// Line of sight test against solid tiles (used for bullets and cop AI).
export function raycastTiles(city, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;
  const steps = Math.ceil(len / (TILE * 0.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t, y = y0 + dy * t;
    if (isSolidTile(city, (x / TILE) | 0, (y / TILE) | 0)) {
      return { x, y, t };
    }
  }
  return null;
}
