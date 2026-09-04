// Canvas renderer: city, entities and effects. Everything is drawn with
// primitives, so the game ships without any image assets.

import { TILE, MAP_TILES, MAP_SIZE, CAR_TYPES, CAR_POLICE, T_ROAD, T_SIDEWALK, T_BUILDING, T_PARK, T_WATER, GRID, CELL_TILES, ROAD_TILES } from '/shared/constants.js';
import { clamp, lerp } from '/shared/util.js';

const COL = {
  road: '#26282f',
  roadEdge: '#1e2026',
  sidewalk: '#585d69',
  sidewalkLine: '#4a4e59',
  park: '#3d6b3f',
  water: '#22506e',
  line: '#c9c46a',
  crossing: '#d8d8d8'
};

const PICKUP_STYLE = {
  1: { c: '#e8e8e8', label: 'P' },
  2: { c: '#ffd23f', label: 'U' },
  3: { c: '#ff9f43', label: 'S' },
  4: { c: '#ff5f4d', label: 'R' },
  5: { c: '#59d66f', label: '+' },
  6: { c: '#59b7ff', label: 'A' },
  7: { c: '#7ce08a', label: '$' }
};

export class Renderer {
  constructor(canvas, city) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.city = city;
    this.cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, scale: 1 };
    this.decals = [];
    this.skids = [];
    this.particles = [];
    this.tracers = [];
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.labels = [];
    this.gait = new Map();     // walk cycle phase per character
    this.actions = new Map();  // short punch / recoil animations
    this.frameNo = 0;
    this.minimap = this.buildMinimap();
  }

  setCity(city) { this.city = city; this.minimap = this.buildMinimap(); }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  // ------------------------------------------------------------------ camera

  updateCamera(target, speed, dt, onFoot) {
    // On foot the camera sits closer so the characters read; in a car it pulls
    // back so there is room to react at speed.
    const base = Math.min(this.w, this.h) / ((onFoot ? 12.5 : 16.5) * TILE);
    const zoom = base * clamp(1.06 - speed / 2600, 0.74, 1.06);
    this.cam.scale = lerp(this.cam.scale || zoom, zoom, clamp(dt * 2.2, 0, 1));
    const lead = clamp(speed / 6, 0, 90);
    const tx = target.x + Math.cos(target.angle || 0) * lead;
    const ty = target.y + Math.sin(target.angle || 0) * lead;
    const k = clamp(dt * 9, 0, 1);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
  }

  shake(mag) { this.shakeMag = Math.max(this.shakeMag, mag); this.shakeTime = 0.35; }

  worldToScreen(x, y) {
    return {
      x: (x - this.cam.x) * this.cam.scale + this.w / 2,
      y: (y - this.cam.y) * this.cam.scale + this.h / 2
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.w / 2) / this.cam.scale + this.cam.x,
      y: (y - this.h / 2) / this.cam.scale + this.cam.y
    };
  }

  // ------------------------------------------------------------------- frame

  begin(dt) {
    const ctx = this.ctx;
    this.labels.length = 0;
    this.frameNo++;
    if ((this.frameNo & 255) === 0) this.pruneGait();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, this.w, this.h);

    let sx = 0, sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const m = this.shakeMag * (this.shakeTime / 0.35);
      sx = (Math.random() - 0.5) * m;
      sy = (Math.random() - 0.5) * m;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(this.cam.scale, this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);
  }

  end() { this.ctx.restore(); }

  viewBounds(margin = 80) {
    const hw = (this.w / 2) / this.cam.scale + margin;
    const hh = (this.h / 2) / this.cam.scale + margin;
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  // -------------------------------------------------------------------- city

  drawCity() {
    const ctx = this.ctx;
    const b = this.viewBounds();
    const city = this.city;

    ctx.fillStyle = COL.road;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

    const tx0 = clamp(Math.floor(b.x0 / TILE), 0, MAP_TILES - 1);
    const tx1 = clamp(Math.ceil(b.x1 / TILE), 0, MAP_TILES - 1);
    const ty0 = clamp(Math.floor(b.y0 / TILE), 0, MAP_TILES - 1);
    const ty1 = clamp(Math.ceil(b.y1 / TILE), 0, MAP_TILES - 1);

    // Ground tiles (buildings are drawn later so they can be extruded).
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = city.tiles[ty * MAP_TILES + tx];
        if (t === T_ROAD) continue;
        const x = tx * TILE, y = ty * TILE;
        if (t === T_SIDEWALK || t === T_BUILDING) {
          ctx.fillStyle = COL.sidewalk;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = COL.sidewalkLine;
          ctx.fillRect(x, y, TILE, 1);
          ctx.fillRect(x, y, 1, TILE);
        } else if (t === T_PARK) {
          ctx.fillStyle = COL.park;
          ctx.fillRect(x, y, TILE, TILE);
        } else if (t === T_WATER) {
          ctx.fillStyle = COL.water;
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }

    this.drawRoadMarkings(b);
    this.drawDecals();

    // Trees in parks
    for (const p of city.props) {
      if (p.x < b.x0 - 40 || p.x > b.x1 + 40 || p.y < b.y0 - 40 || p.y > b.y1 + 40) continue;
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.arc(p.x + 3, p.y + 4, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f5c33';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d7541';
      ctx.beginPath(); ctx.arc(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawRoadMarkings(b) {
    const ctx = this.ctx;
    const half = (ROAD_TILES / 2) * TILE;
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 2;
    ctx.setLineDash([16, 18]);

    for (let i = 0; i <= GRID; i++) {
      const c = (i * CELL_TILES + ROAD_TILES / 2) * TILE;
      if (c > b.x0 - half && c < b.x1 + half) {
        ctx.beginPath(); ctx.moveTo(c, Math.max(0, b.y0)); ctx.lineTo(c, Math.min(MAP_SIZE, b.y1)); ctx.stroke();
      }
      if (c > b.y0 - half && c < b.y1 + half) {
        ctx.beginPath(); ctx.moveTo(Math.max(0, b.x0), c); ctx.lineTo(Math.min(MAP_SIZE, b.x1), c); ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Zebra crossings on all four approaches of every visible intersection
    ctx.fillStyle = 'rgba(230,230,230,.32)';
    const stripeLen = 13;
    for (let j = 0; j <= GRID; j++) {
      const cy = (j * CELL_TILES + ROAD_TILES / 2) * TILE;
      if (cy < b.y0 - 140 || cy > b.y1 + 140) continue;
      for (let i = 0; i <= GRID; i++) {
        const cx = (i * CELL_TILES + ROAD_TILES / 2) * TILE;
        if (cx < b.x0 - 140 || cx > b.x1 + 140) continue;
        for (let k = -2; k <= 2; k++) {
          const off = k * 11 - 3;
          ctx.fillRect(cx + off, cy - half - stripeLen - 2, 6, stripeLen); // north
          ctx.fillRect(cx + off, cy + half + 2, 6, stripeLen);             // south
          ctx.fillRect(cx - half - stripeLen - 2, cy + off, stripeLen, 6); // west
          ctx.fillRect(cx + half + 2, cy + off, stripeLen, 6);             // east
        }
      }
    }
  }

  drawBuildings() {
    const ctx = this.ctx;
    const b = this.viewBounds(120);
    for (const bld of this.city.buildings) {
      if (bld.x > b.x1 || bld.x + bld.w < b.x0 || bld.y > b.y1 || bld.y + bld.h < b.y0) continue;
      const cx = bld.x + bld.w / 2, cy = bld.y + bld.h / 2;
      // Extrude away from the centre of the screen. The offset grows with the
      // distance to the camera, so the block the player stands next to stays
      // flat and never hides them.
      const ox = (cx - this.cam.x) * 0.0032 * bld.height;
      const oy = (cy - this.cam.y) * 0.0032 * bld.height;

      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(bld.x + 4, bld.y + 5, bld.w, bld.h);

      // Walls (extrusion body)
      ctx.fillStyle = bld.side;
      ctx.beginPath();
      ctx.rect(bld.x, bld.y, bld.w, bld.h);
      ctx.fill();

      // Roof, shifted away from the camera centre for a fake 3D look
      ctx.fillStyle = bld.top;
      ctx.fillRect(bld.x + ox, bld.y + oy, bld.w, bld.h);
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bld.x + ox, bld.y + oy, bld.w, bld.h);

      if (bld.windows && this.cam.scale > 0.55) {
        ctx.fillStyle = 'rgba(255,225,150,.20)';
        const step = 22;
        for (let y = bld.y + 12; y < bld.y + bld.h - 8; y += step) {
          for (let x = bld.x + 12; x < bld.x + bld.w - 8; x += step) {
            if (((x * 31 + y * 17) % 7) < 3) ctx.fillRect(x + ox, y + oy, 7, 7);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- entities

  drawCar(c, interpAngle) {
    const ctx = this.ctx;
    const t = CAR_TYPES[c.kind] || CAR_TYPES[0];
    const len = t.len, wid = t.wid;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(interpAngle);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    this.roundRect(-len / 2 + 3, -wid / 2 + 4, len, wid, 6);
    ctx.fill();

    const body = c.kind === CAR_POLICE ? t.body : shiftColor(t.body, (c.colorSeed || 0) % 40 - 20);
    ctx.fillStyle = body;
    this.roundRect(-len / 2, -wid / 2, len, wid, 6);
    ctx.fill();

    // roof + windows
    ctx.fillStyle = t.roof;
    this.roundRect(-len * 0.18, -wid / 2 + 3, len * 0.42, wid - 6, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,26,36,.85)';
    this.roundRect(len * 0.1, -wid / 2 + 4, len * 0.14, wid - 8, 3);
    ctx.fill();
    this.roundRect(-len * 0.32, -wid / 2 + 4, len * 0.12, wid - 8, 3);
    ctx.fill();

    // lights
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(len / 2 - 4, -wid / 2 + 3, 3, 5);
    ctx.fillRect(len / 2 - 4, wid / 2 - 8, 3, 5);
    ctx.fillStyle = c.braking ? '#ff5544' : '#a33';
    ctx.fillRect(-len / 2 + 1, -wid / 2 + 3, 3, 5);
    ctx.fillRect(-len / 2 + 1, wid / 2 - 8, 3, 5);

    if (c.kind === CAR_POLICE) {
      const on = c.siren && (Math.floor(performance.now() / 180) % 2 === 0);
      ctx.fillStyle = on ? '#ff3b30' : '#5a1f1c';
      ctx.fillRect(-6, -wid / 2 + 2, 6, 5);
      ctx.fillStyle = on ? '#2f6bff' : '#1b2a55';
      ctx.fillRect(-6, wid / 2 - 7, 6, 5);
    }

    if (c.hpPct !== undefined && c.hpPct < 45) {
      // smoking wreck
      ctx.fillStyle = 'rgba(30,30,30,.35)';
      ctx.beginPath(); ctx.arc(len / 2 - 6, 0, 8 + Math.sin(performance.now() / 120) * 2, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }


  // ------------------------------------------------------- city landmarks

  drawPhones(time) {
    const ctx = this.ctx;
    const b = this.viewBounds(40);
    for (const ph of this.city.phones) {
      if (ph.x < b.x0 || ph.x > b.x1 || ph.y < b.y0 || ph.y > b.y1) continue;
      const pulse = 0.5 + Math.sin(time * 2.5 + ph.id) * 0.5;
      ctx.save();
      ctx.translate(ph.x, ph.y);
      ctx.fillStyle = `rgba(90,190,255,${0.10 + pulse * 0.12})`;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      this.roundRect(-6, -6, 15, 15, 3); ctx.fill();
      ctx.fillStyle = '#2f6fa8';                      // booth
      this.roundRect(-7, -8, 14, 15, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#d8e6f2';                      // handset
      this.roundRect(-3.5, -4.5, 7, 3, 1.4); ctx.fill();
      this.roundRect(-3.5, -1, 7, 5, 1.4); ctx.fill();
      ctx.restore();
    }
  }

  drawSprayShops(time) {
    const ctx = this.ctx;
    const b = this.viewBounds(60);
    for (const shop of this.city.sprayShops) {
      if (shop.x > b.x1 || shop.x + shop.w < b.x0 || shop.y > b.y1 || shop.y + shop.h < b.y0) continue;
      ctx.save();
      ctx.translate(shop.x, shop.y);

      ctx.fillStyle = '#2b3240';                      // bay floor
      ctx.fillRect(0, 0, shop.w, shop.h);
      ctx.save();                                     // hazard stripes
      ctx.beginPath(); ctx.rect(0, 0, shop.w, shop.h); ctx.clip();
      ctx.fillStyle = 'rgba(255,210,63,.22)';
      for (let x = -shop.h; x < shop.w; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, shop.h); ctx.lineTo(x + 11, shop.h);
        ctx.lineTo(x + 11 + shop.h, 0); ctx.lineTo(x + shop.h, 0);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,210,63,.5)';        // bay outline
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, shop.w - 2, shop.h - 2);

      ctx.fillStyle = '#1b2029';                      // canopy on the pavement side
      ctx.fillRect(0, shop.h - 7, shop.w, 7);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 9px ui-sans-serif, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SPRAY', shop.w / 2, shop.h - 1.5);
      ctx.restore();
    }
  }

  drawMissionMarker(m, time) {
    const ctx = this.ctx;
    const pulse = 0.5 + Math.sin(time * 3) * 0.5;
    const color = m.k === 3 ? '255,95,77' : '255,210,63';
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = `rgba(${color},${0.10 + pulse * 0.10})`;
    ctx.beginPath(); ctx.arc(0, 0, m.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${color},${0.55 + pulse * 0.35})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 22;
    ctx.beginPath(); ctx.arc(0, 0, m.r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const lift = 6 + pulse * 4;                       // bobbing chevron
    ctx.fillStyle = `rgba(${color},.9)`;
    ctx.beginPath();
    ctx.moveTo(0, -lift); ctx.lineTo(-7, -lift - 11); ctx.lineTo(7, -lift - 11);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------- characters

  // Every character is built from the same parts: legs that swing with the
  // walk cycle, a torso that follows the direction of travel, arms that follow
  // the aim, a head, a hat and whatever is in their hands.
  drawCharacter(o) {
    const ctx = this.ctx;
    const jacket = o.hit ? '#ff7a68' : o.jacket;
    const sleeve = shiftColor(jacket, -22);
    const shoulder = shiftColor(jacket, 16);
    const act = o.action || null;
    const stride = Math.sin(o.phase) * (o.moving ? 1 : 0);
    // Walking bounces the body; standing still it only breathes.
    const bob = o.moving
      ? 1 + Math.abs(Math.sin(o.phase)) * 0.035
      : 1 + Math.sin(performance.now() / 900) * 0.012;

    ctx.save();
    ctx.translate(o.x, o.y);
    const scale = (o.scale || 1) * bob;
    if (scale !== 1) ctx.scale(scale, scale);

    // The shadow stays put no matter which way the character turns.
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath();
    ctx.ellipse(1.2, 2.2, 7.6, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- lower body: legs and torso follow the direction of travel.
    // Seen from above the legs sit under the torso, so it is the stride that
    // swings a foot out past the silhouette - one at a time, which is exactly
    // how a walk cycle reads from this angle.
    ctx.save();
    ctx.rotate(o.body);
    for (const side of [-1, 1]) {
      const off = side * 5.4;
      const step = stride * 4.6 * side;
      // The feet always stick out past the torso, the stride only swings them
      // back and forth - otherwise the legs vanish at the zero crossing.
      this.limb(-4, off, 4.4 + step * 0.8, off, 4.6, o.trousers, 'rgba(0,0,0,.45)');
      ctx.save();
      ctx.translate(5.9 + step, off);
      ctx.rotate(step * 0.05);                       // the foot rolls as it lands
      ctx.fillStyle = o.shoes;
      this.roundRect(-2.5, -2.2, 5.2, 4.4, 1.8);
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(-stride * 0.07);                      // hips and torso counter-swing
    ctx.fillStyle = jacket;                          // torso, narrower than the stance
    this.roundRect(-5.4, -4.6, 10.8, 9.2, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = shiftColor(jacket, -30);         // shaded back
    this.roundRect(-5.2, -3.9, 2.8, 7.8, 2.2);
    ctx.fill();
    ctx.restore();

    // --- upper body: arms, weapon, head and hat follow the aim
    ctx.save();
    ctx.rotate(o.aim + (act ? act.recoil * 0.06 : 0));   // the shot kicks the aim up
    for (const side of [-1, 1]) {                    // shoulders
      ctx.fillStyle = shoulder;
      ctx.beginPath();
      ctx.arc(0.2, side * 4.4, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const recoil = act ? act.recoil * 2.8 : 0;
    const punch = act ? act.punch : 0;
    const armSwing = stride * 3.8;
    let hands;
    if (o.weapon > 0) {
      hands = [[9.8 - recoil, -2.4], [8.4 - recoil, 3.0]];
    } else if (punch > 0) {
      // Alternating straight punches: one fist shoots out, the other guards.
      const lead = act.hand < 0 ? 0 : 1;
      hands = [[5.4 - armSwing, -6.3], [5.4 + armSwing, 6.3]];
      hands[lead] = [5.4 + punch * 8.5, (lead ? 1 : -1) * (6.3 - punch * 4)];
      hands[1 - lead] = [3.4, (lead ? -1 : 1) * 6.6];
    } else {
      hands = [[5.4 + armSwing, -6.3], [5.4 - armSwing, 6.3]];
    }

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.limb(0.4, side * 4.4, hands[i][0], hands[i][1], 3.9, sleeve, 'rgba(0,0,0,.32)');
    }
    if (o.weapon > 0) {
      ctx.save();
      ctx.translate(-recoil, 0);
      this.drawHeldWeapon(o.weapon);
      ctx.restore();
      if (act && act.flash > 0) this.drawMuzzleFlash(o.weapon, act.flash, recoil);
    }
    ctx.fillStyle = o.skin;
    for (const h of hands) {
      ctx.beginPath();
      ctx.arc(h[0], h[1], 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = o.skin;                          // head
    ctx.beginPath();
    ctx.arc(1.2, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();                                 // nose: keeps facing readable
    ctx.moveTo(4.3, -1.4); ctx.lineTo(6.5, 0); ctx.lineTo(4.3, 1.4);
    ctx.closePath();
    ctx.fill();

    if (o.hat) {
      ctx.fillStyle = o.hatBrim;                     // brim, worn back so the face shows
      ctx.beginPath();
      ctx.ellipse(-1.8, 0, 4.7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = o.hat;                         // crown
      ctx.beginPath();
      ctx.arc(-1.1, 0, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = o.hatBand || 'rgba(0,0,0,.25)'; // band – the player's colour, seen from above
      ctx.fillRect(-4, -3.1, 1.7, 6.2);
    } else if (o.hair) {
      ctx.fillStyle = o.hair;                        // bare head: hair from above
      ctx.beginPath();
      ctx.ellipse(-0.6, 0, 3.7, 3.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  drawMuzzleFlash(kind, strength, recoil) {
    const ctx = this.ctx;
    const tip = { 1: 16.5, 2: 18.5, 3: 22.5, 4: 23.5 }[kind] - recoil;
    const size = (kind === 4 ? 9 : kind === 3 ? 7 : 5) * (0.6 + strength * 0.6);
    ctx.save();
    ctx.translate(tip, kind === 4 ? 0 : -0.2);
    ctx.globalAlpha = strength;
    ctx.fillStyle = '#fff0b8';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(0, -size * 0.55);
    ctx.lineTo(size * 0.25, 0);
    ctx.lineTo(0, size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,170,60,.85)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A rounded capsule from a to b – used for arms and legs.
  limb(ax, ay, bx, by, w, color, stroke) {
    const ctx = this.ctx;
    const len = Math.hypot(bx - ax, by - ay);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(by - ay, bx - ax));
    ctx.fillStyle = color;
    this.roundRect(-w * 0.5, -w * 0.5, len + w, w, w * 0.5);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHeldWeapon(kind) {
    const ctx = this.ctx;
    ctx.fillStyle = '#22262f';
    switch (kind) {
      case 1: // pistol: slide plus grip
        this.roundRect(8, -1.4, 8, 2.8, 1); ctx.fill();
        this.roundRect(8.3, 0.7, 2.7, 3.6, 1); ctx.fill();
        break;
      case 2: // uzi: short barrel, magazine hanging down
        this.roundRect(7.4, -1.6, 10.6, 3.2, 1.2); ctx.fill();
        ctx.fillStyle = '#151920';
        this.roundRect(10.4, 1.2, 2.6, 5, 1); ctx.fill();
        break;
      case 3: // shotgun: long barrel with a wooden stock
        this.roundRect(6, -1.7, 16, 3.4, 1.2); ctx.fill();
        ctx.fillStyle = '#6b4a2c';
        this.roundRect(4, -1.7, 5.5, 3.4, 1.2); ctx.fill();
        break;
      case 4: // rocket launcher: tube, sight and a warhead tip
        this.roundRect(4, -2.6, 19, 5.2, 2.4); ctx.fill();
        this.roundRect(8.6, -4.8, 3.4, 3.2, 1); ctx.fill();
        ctx.fillStyle = '#ff5f4d';
        ctx.beginPath(); ctx.arc(22.6, 0, 2.2, 0, Math.PI * 2); ctx.fill();
        break;
    }
  }

  // The walk cycle is driven by the distance actually covered since the last
  // frame, so predicted, interpolated and locally simulated characters all
  // animate correctly without extra bookkeeping at the call site.
  gaitPhase(key, x, y) {
    let g = this.gait.get(key);
    if (!g) {
      g = { phase: (key.length * 1.7) % 6.28, x, y, seen: this.frameNo };
      this.gait.set(key, g);
    }
    const moved = Math.min(Math.hypot(x - g.x, y - g.y), 24);
    g.phase += moved * 0.34;
    g.x = x; g.y = y; g.seen = this.frameNo;
    return { phase: g.phase, moving: moved > 0.06 };
  }

  // A shot or a punch fired by this character – drives recoil, the muzzle
  // flash and which fist swings forward.
  markAction(key, kind) {
    const prev = this.actions.get(key);
    const hand = prev && prev.kind === 'punch' ? -prev.hand : 1;
    this.actions.set(key, { kind, t: performance.now(), hand });
  }

  actionState(key) {
    const a = this.actions.get(key);
    if (!a) return null;
    const age = (performance.now() - a.t) / 1000;
    if (age > 0.32) { this.actions.delete(key); return null; }
    if (a.kind === 'punch') {
      const p = age < 0.08 ? age / 0.08 : Math.max(0, 1 - (age - 0.08) / 0.16);
      return { punch: p, recoil: 0, flash: 0, hand: a.hand };
    }
    return {
      punch: 0,
      recoil: Math.max(0, 1 - age / 0.14),
      flash: age < 0.05 ? 1 - age / 0.05 : 0,
      hand: a.hand
    };
  }

  pruneGait() {
    if (this.gait.size < 400) return;
    for (const [key, g] of this.gait) {
      if (this.frameNo - g.seen > 120) { this.gait.delete(key); this.actions.delete(key); }
    }
  }

  drawPed(p) {
    const look = pedLook(p.id);
    const g = this.gaitPhase('n' + p.id, p.x, p.y);
    if (p.target) {
      const ctx = this.ctx;
      const pulse = 0.5 + Math.sin(performance.now() / 220) * 0.5;
      ctx.strokeStyle = `rgba(255,95,77,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 15 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    }
    this.drawCharacter({
      x: p.x, y: p.y, body: p.angle, aim: p.angle,
      phase: g.phase, moving: g.moving, scale: 0.95,
      jacket: look.shirt, trousers: look.trousers, shoes: look.shoes,
      skin: look.skin, hat: look.hat, hatBrim: look.hatBrim, hair: look.hair, weapon: 0,
      action: this.actionState('n' + p.id)
    });
  }

  drawPlayer(p, opts = {}) {
    const jacket = p.color || '#ffd23f';
    const g = this.gaitPhase('p' + (p.id || 0), p.x, p.y);
    this.drawCharacter({
      x: p.x, y: p.y,
      body: p.bodyAngle !== undefined ? p.bodyAngle : p.angle,
      aim: p.angle,
      phase: g.phase, moving: g.moving, scale: 1.15,
      jacket, trousers: '#616e8c', shoes: '#1b1f27', skin: '#e8cba4',
      hat: '#232936', hatBrim: '#171b24', hatBand: jacket, hair: '#3a2b20',
      weapon: opts.weapon || 0, hit: opts.hit,
      action: this.actionState('p' + (p.id || 0))
    });

    if (opts.name) {
      const s = this.worldToScreen(p.x, p.y);
      this.labels.push({ x: s.x, y: s.y - 22 * this.cam.scale, text: opts.name, color: p.color, wanted: opts.wanted });
    }
  }

  drawPickup(pu, time) {
    const ctx = this.ctx;
    const st = PICKUP_STYLE[pu.kind] || PICKUP_STYLE[7];
    const bob = Math.sin(time * 3 + pu.id) * 2;
    ctx.save();
    ctx.translate(pu.x, pu.y + bob);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = st.c;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (pu.temp) {                              // dropped loot: pulsing ring
      ctx.strokeStyle = st.c;
      ctx.globalAlpha = 0.5 + Math.sin(time * 6 + pu.id) * 0.3;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = st.c;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12151c';
    ctx.font = 'bold 10px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.label, 0, 0.5);
    ctx.restore();
  }

  // ----------------------------------------------------------------- effects

  addTracer(x0, y0, x1, y1, weapon) {
    this.tracers.push({ x0, y0, x1, y1, life: weapon === 4 ? 0.35 : 0.12, max: weapon === 4 ? 0.35 : 0.12, w: weapon });
    if (this.tracers.length > 90) this.tracers.shift();
  }

  addBlood(x, y, big) {
    const n = big ? 8 : 3;
    for (let i = 0; i < n; i++) {
      this.decals.push({
        x: x + (Math.random() - 0.5) * (big ? 26 : 10),
        y: y + (Math.random() - 0.5) * (big ? 26 : 10),
        r: 2 + Math.random() * (big ? 6 : 3),
        c: 'rgba(122,20,20,.75)'
      });
    }
    if (this.decals.length > 260) this.decals.splice(0, this.decals.length - 260);
  }

  addSpark(x, y) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.22, max: 0.22, c: '#ffd98a', r: 1.6 });
    }
  }

  addExplosion(x, y, r) {
    this.particles.push({ x, y, life: 0.55, max: 0.55, boom: r, c: '#ffae42', r });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 90 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, c: i % 3 ? '#ff8a3d' : '#4a4a4a', r: 3 + Math.random() * 4 });
    }
    this.decals.push({ x, y, r: r * 0.5, c: 'rgba(20,18,16,.5)' });
    this.shake(16);
  }

  addSmoke(x, y) {
    this.particles.push({ x, y, vx: (Math.random() - .5) * 20, vy: (Math.random() - .5) * 20, life: 0.9, max: 0.9, c: 'rgba(120,120,120,1)', r: 5 });
  }

  addSkid(x, y, angle) {
    this.skids.push({ x, y, a: angle });
    if (this.skids.length > 240) this.skids.shift();
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.vx !== undefined) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
  }

  drawDecals() {
    const ctx = this.ctx;
    const b = this.viewBounds();
    ctx.save();
    for (const s of this.skids) {
      if (s.x < b.x0 || s.x > b.x1 || s.y < b.y0 || s.y > b.y1) continue;
      ctx.strokeStyle = 'rgba(24,24,28,.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.a) * 8, s.y - Math.sin(s.a) * 8);
      ctx.lineTo(s.x + Math.cos(s.a) * 8, s.y + Math.sin(s.a) * 8);
      ctx.stroke();
    }
    for (const d of this.decals) {
      if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
      ctx.fillStyle = d.c;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const t of this.tracers) {
      const a = t.life / t.max;
      ctx.strokeStyle = t.w === 4 ? `rgba(255,140,60,${a})` : `rgba(255,240,180,${a * 0.9})`;
      ctx.lineWidth = t.w === 4 ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    }
    for (const p of this.particles) {
      const a = p.life / p.max;
      if (p.boom) {
        const r = p.boom * (1.15 - a * 0.85);
        const g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,240,180,${a})`);
        g.addColorStop(0.5, `rgba(255,140,50,${a * 0.85})`);
        g.addColorStop(1, 'rgba(60,40,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ----------------------------------------------------------------- minimap

  buildMinimap() {
    const size = MAP_TILES;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#2a2d34';
    g.fillRect(0, 0, size, size);
    const t = this.city.tiles;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = t[y * size + x];
        if (v === T_ROAD) continue;
        g.fillStyle = v === T_BUILDING ? '#585e6d'
          : v === T_SIDEWALK ? '#43474f'
            : v === T_PARK ? '#33633a' : '#1f4a68';
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }
}

function shiftColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

// Pedestrians get a deterministic look from their id: same person, same
// outfit on every client, without sending any of it over the wire.
const PED_SHIRTS = ['#c94f4f', '#4f7fc9', '#4fc98a', '#c9a84f', '#9a4fc9', '#dcdcdc', '#6b7280', '#e07a3f'];
const PED_SKINS = ['#f0d3b4', '#e2b48c', '#c68a5f', '#8d5a3b', '#6b4430'];
const PED_TROUSERS = ['#33384a', '#2b2f3a', '#4a3f36', '#3c4a3c', '#46394f'];
const PED_HATS = ['#2f3440', '#6b4a2f', '#8d2f2f', '#2f4a6b', '#d8d2c4'];
const PED_HAIR = ['#2b2018', '#4a3a2a', '#6b4a2f', '#1d1a18', '#8a6a3f', '#5c5c5c'];

function hash32(n) {
  n = Math.imul(n ^ (n >>> 15), 2246822507);
  n = Math.imul(n ^ (n >>> 13), 3266489909);
  return (n ^ (n >>> 16)) >>> 0;
}

export function pedLook(id) {
  const h = hash32(id);
  const hat = ((h >>> 24) & 255) < 96 ? PED_HATS[(h >>> 3) % PED_HATS.length] : null;
  return {
    shirt: PED_SHIRTS[h % PED_SHIRTS.length],
    skin: PED_SKINS[(h >>> 5) % PED_SKINS.length],
    trousers: PED_TROUSERS[(h >>> 9) % PED_TROUSERS.length],
    shoes: '#1b1e25',
    hair: PED_HAIR[(h >>> 13) % PED_HAIR.length],
    hat,
    hatBrim: hat ? shiftColor(hat, -30) : null
  };
}
