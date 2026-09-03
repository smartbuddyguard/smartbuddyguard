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

  updateCamera(target, speed, dt) {
    const base = Math.min(this.w, this.h) / (16 * TILE);
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

  drawPed(p) {
    const ctx = this.ctx;
    const shirt = pedColor(p.id);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.arc(1.5, 2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6c8a0';
    ctx.beginPath(); ctx.arc(2.5, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawPlayer(p, opts = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.arc(2, 3, 10, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(p.angle);
    // body
    ctx.fillStyle = opts.hit ? '#ff6b5b' : (p.color || '#ffd23f');
    ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // head
    ctx.fillStyle = '#e8cba4';
    ctx.beginPath(); ctx.arc(3, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    // weapon
    if (opts.weapon > 0) {
      ctx.fillStyle = '#2b2f38';
      ctx.fillRect(4, -2.5, 13, 4);
    }
    ctx.restore();

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

const PED_COLORS = ['#c94f4f', '#4f7fc9', '#4fc98a', '#c9a84f', '#9a4fc9', '#dddddd', '#6b7280', '#e07a3f'];
export function pedColor(id) { return PED_COLORS[(id * 2654435761 >>> 0) % PED_COLORS.length]; }
