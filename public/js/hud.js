// Screen-space HUD: status bars, wanted stars, minimap, kill feed and the
// on-screen touch controls.

import { MAP_SIZE, WEAPONS, MAX_WANTED } from '/shared/constants.js';
import { clamp } from '/shared/util.js';

export class Hud {
  constructor(renderer, input) {
    this.r = renderer;
    this.input = input;
    this.killFeed = [];
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  pushKill(text, time) {
    this.killFeed.push({ text, until: time + 6 });
    if (this.killFeed.length > 5) this.killFeed.shift();
  }

  draw(state, time) {
    const ctx = this.r.ctx;
    const w = this.r.w, h = this.r.h;
    const you = state.you;
    const s = this.safe;

    ctx.save();
    ctx.setTransform(this.r.dpr, 0, 0, this.r.dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';

    this.drawNameLabels(ctx);
    if (you) {
      this.drawStatus(ctx, you, s, state);
      this.drawMinimap(ctx, state, w, s);
      this.drawKillFeed(ctx, w, time, s);
      if (!you.al) this.drawDeath(ctx, w, h, you);
    }
    this.drawTouchControls(ctx, state);
    this.drawNetInfo(ctx, state, w, h, s);
    ctx.restore();
  }

  drawNameLabels(ctx) {
    ctx.textAlign = 'center';
    ctx.font = '600 12px ui-sans-serif, -apple-system, sans-serif';
    for (const l of this.r.labels) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const wdt = ctx.measureText(l.text).width + 10;
      ctx.fillRect(l.x - wdt / 2, l.y - 13, wdt, 16);
      ctx.fillStyle = l.color || '#fff';
      ctx.fillText(l.text, l.x, l.y);
      if (l.wanted > 0) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('★'.repeat(Math.min(5, l.wanted)), l.x, l.y - 15);
      }
    }
  }

  drawStatus(ctx, you, s, state) {
    const x = 14 + s.left, y = 14 + s.top;

    // health + armour
    this.bar(ctx, x, y, 168, 14, you.hp / 100, '#e04b3c', '#2a1616');
    if (you.ar > 0) this.bar(ctx, x, y + 18, 168, 8, you.ar / 100, '#59b7ff', '#152430');

    ctx.font = '700 13px ui-sans-serif, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.max(0, Math.round(you.hp))} HP`, x + 6, y + 11.5);

    // wanted stars
    const starY = y + (you.ar > 0 ? 46 : 38);
    ctx.font = '18px ui-sans-serif, sans-serif';
    for (let i = 0; i < MAX_WANTED; i++) {
      ctx.fillStyle = i < you.wl ? '#ffd23f' : 'rgba(255,255,255,.15)';
      ctx.fillText('★', x + i * 20, starY);
    }

    // cash + score
    ctx.font = '700 16px ui-monospace, "SF Mono", monospace';
    ctx.fillStyle = '#7ce08a';
    ctx.fillText(`$${you.cash}`, x, starY + 24);
    ctx.font = '600 12px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#aab3c4';
    ctx.fillText(`Kills ${you.k} · Tode ${you.d}`, x, starY + 42);

    // weapon / vehicle
    const wep = WEAPONS[you.w];
    ctx.font = '700 14px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#fff';
    const ammoTxt = you.am < 0 || wep.ammo === Infinity ? '∞' : you.am;
    ctx.fillText(`${wep.name}  ${ammoTxt}`, x, starY + 64);

    if (you.car) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`${you.cn} · ${Math.round(you.sp / 4)} km/h`, x, starY + 84);
      this.bar(ctx, x, starY + 90, 110, 6, you.chp / 100, '#ffb03a', '#2b2418');
    }
  }

  bar(ctx, x, y, w, h, pct, color, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }

  drawMinimap(ctx, state, w, s) {
    const size = 108;
    const x = w - size - 14 - s.right;
    const y = 52 + s.top;
    const scale = size / MAP_SIZE;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#11141b';
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
    ctx.drawImage(this.r.minimap, x, y, size, size);
    ctx.globalAlpha = 1;

    const dot = (wx, wy, c, r = 2) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + wx * scale, y + wy * scale, r, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const e of state.entities.values()) {
      if (e.type === 2 && e.siren) dot(e.x, e.y, '#4f9dff', 2);
      else if (e.type === 1) dot(e.x, e.y, state.rosterById.get(e.id)?.color || '#fff', 2.4);
    }
    for (const pu of state.entities.values()) {
      if (pu.type === 4) dot(pu.x, pu.y, '#7ce08a', 1.4);
    }
    if (state.you) dot(state.local.x, state.local.y, '#ffd23f', 3);

    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2.5, y - 2.5, size + 5, size + 5);
    ctx.restore();
  }

  drawKillFeed(ctx, w, time, s) {
    ctx.textAlign = 'center';
    ctx.font = '600 13px ui-sans-serif, sans-serif';
    let y = 22 + s.top;
    for (const k of this.killFeed) {
      if (k.until < time) continue;
      const alpha = clamp(k.until - time, 0, 1);
      ctx.globalAlpha = alpha;
      const wdt = ctx.measureText(k.text).width + 16;
      ctx.fillStyle = 'rgba(10,12,18,.7)';
      ctx.fillRect(w / 2 - wdt / 2, y - 13, wdt, 19);
      ctx.fillStyle = '#e8ecf4';
      ctx.fillText(k.text, w / 2, y);
      ctx.globalAlpha = 1;
      y += 23;
    }
    this.killFeed = this.killFeed.filter(k => k.until >= time);
  }

  drawDeath(ctx, w, h, you) {
    ctx.fillStyle = 'rgba(80,10,10,.35)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '800 42px ui-sans-serif, -apple-system, sans-serif';
    ctx.fillText('WASTED', w / 2, h / 2 - 8);
    ctx.font = '600 15px ui-sans-serif, sans-serif';
    ctx.fillStyle = '#ffd2c8';
    ctx.fillText(you.rs > 0 ? `Neustart in ${you.rs.toFixed(1)}s` : 'Tippe zum Weitermachen', w / 2, h / 2 + 24);
  }

  drawNetInfo(ctx, state, w, h, s) {
    // Bottom left: below the joystick ring and clear of the action buttons.
    ctx.textAlign = 'left';
    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(200,210,225,.5)';
    ctx.fillText(`${state.ping} ms · ${state.fps} fps · ${state.playerCount} online`, 14 + s.left, h - 10 - s.bottom);
  }

  drawTouchControls(ctx, state) {
    const inp = this.input;
    if (!inp.touchUsed) return;

    // movement stick
    if (inp.stick.active) {
      const dx = inp.stick.x - inp.stick.ox, dy = inp.stick.y - inp.stick.oy;
      const len = Math.hypot(dx, dy);
      const k = len > inp.stick.r ? inp.stick.r / len : 1;
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(inp.stick.ox, inp.stick.oy, inp.stick.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.arc(inp.stick.ox + dx * k, inp.stick.oy + dy * k, 26, 0, Math.PI * 2); ctx.fill();
    } else {
      const hx = inp.stickHome.x, hy = inp.stickHome.y;
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, inp.stick.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.beginPath(); ctx.arc(hx, hy, 24, 0, Math.PI * 2); ctx.fill();
    }

    for (const [key, b] of Object.entries(inp.buttons)) {
      const main = key === 'fire';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.pressed
        ? (main ? 'rgba(255,95,77,.75)' : 'rgba(255,210,63,.6)')
        : (main ? 'rgba(255,95,77,.32)' : 'rgba(255,255,255,.16)');
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = key === 'scores' ? '700 16px ui-sans-serif, sans-serif' : `700 ${main ? 15 : 11}px ui-sans-serif, sans-serif`;
      ctx.fillText(b.label, b.x, b.y + (key === 'scores' ? 5 : 4));
    }
  }
}
