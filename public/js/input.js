// Unified input: virtual touch controls (iPhone) + keyboard/mouse (desktop).
// The touch layout is drawn by hud.js from the state exposed here.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = { mx: 0, my: 0, aim: 0, fire: false, brake: false, enter: false, swap: false };
    this.keys = new Set();
    this.pointers = new Map();     // pointerId -> { role, x, y }
    this.stick = { active: false, ox: 0, oy: 0, x: 0, y: 0, r: 62 };
    this.buttons = {
      fire: { label: 'FEUER', r: 52, pressed: false, x: 0, y: 0 },
      enter: { label: 'EIN', r: 36, pressed: false, x: 0, y: 0 },
      aux: { label: 'WAFFE', r: 36, pressed: false, x: 0, y: 0 },
      scores: { label: '≡', r: 20, pressed: false, x: 0, y: 0 }
    };
    this.mouse = { x: 0, y: 0, down: false, active: false };
    // Show the touch controls right away on phones and tablets.
    this.touchUsed = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    this.onScores = null;
    this.layout(canvas.clientWidth, canvas.clientHeight, { top: 0, right: 0, bottom: 0, left: 0 });
    this.bind();
  }

  layout(w, h, safe) {
    this.w = w; this.h = h;
    const pad = 26;
    const bottom = h - pad - (safe.bottom || 0);
    const right = w - pad - (safe.right || 0);
    const b = this.buttons;
    b.fire.x = right - b.fire.r; b.fire.y = bottom - b.fire.r;
    b.enter.x = right - b.enter.r - 14; b.enter.y = b.fire.y - b.fire.r - b.enter.r - 16;
    b.aux.x = b.fire.x - b.fire.r - b.aux.r - 16; b.aux.y = bottom - b.aux.r;
    // sits left of the minimap (108px wide, 14px inset) so nothing overlaps
    b.scores.x = right - 108 - 14 - b.scores.r; b.scores.y = (safe.top || 0) + 20 + b.scores.r;
    this.stickHome = { x: Math.min(150, w * 0.22), y: bottom - 90 };
  }

  bind() {
    const c = this.canvas;
    const opts = { passive: false };

    c.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    c.addEventListener('pointermove', (e) => this.onMove(e), opts);
    c.addEventListener('pointerup', (e) => this.onUp(e), opts);
    c.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: block scrolling / rubber banding / double tap zoom over the canvas.
    c.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    c.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'Tab' && this.onScores) this.onScores();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    c.addEventListener('mousemove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.active = true;
    });
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hitButton(x, y) {
    for (const [key, b] of Object.entries(this.buttons)) {
      const grow = key === 'scores' ? 10 : 12; // generous touch targets
      if (Math.hypot(x - b.x, y - b.y) <= b.r + grow) return key;
    }
    return null;
  }

  onDown(e) {
    const p = this.pos(e);
    if (e.pointerType === 'touch') this.touchUsed = true;
    const hit = this.hitButton(p.x, p.y);

    if (hit) {
      if (hit === 'scores') { if (this.onScores) this.onScores(); return; }
      this.buttons[hit].pressed = true;
      this.pointers.set(e.pointerId, { role: hit, x: p.x, y: p.y });
      e.preventDefault();
      return;
    }

    if (e.pointerType === 'mouse') {
      this.mouse.down = true;
      this.pointers.set(e.pointerId, { role: 'mouse', x: p.x, y: p.y });
      return;
    }

    // Anything else on the left side starts the movement stick where you touch.
    if (p.x < this.w * 0.55 && !this.stick.active) {
      this.stick.active = true;
      this.stick.ox = p.x; this.stick.oy = p.y;
      this.stick.x = p.x; this.stick.y = p.y;
      this.pointers.set(e.pointerId, { role: 'stick', x: p.x, y: p.y });
      e.preventDefault();
    }
  }

  onMove(e) {
    const rec = this.pointers.get(e.pointerId);
    const p = this.pos(e);
    if (!rec) return;
    rec.x = p.x; rec.y = p.y;
    if (rec.role === 'stick') {
      this.stick.x = p.x; this.stick.y = p.y;
      e.preventDefault();
    } else if (rec.role !== 'mouse') {
      // Sliding off a button releases it.
      const b = this.buttons[rec.role];
      if (b) b.pressed = Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 26;
    }
  }

  onUp(e) {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    this.pointers.delete(e.pointerId);
    if (rec.role === 'stick') {
      this.stick.active = false;
    } else if (rec.role === 'mouse') {
      this.mouse.down = false;
    } else if (this.buttons[rec.role]) {
      this.buttons[rec.role].pressed = false;
    }
  }

  releaseAll() {
    this.pointers.clear();
    this.stick.active = false;
    this.mouse.down = false;
    for (const b of Object.values(this.buttons)) b.pressed = false;
    this.keys.clear();
  }

  // Returns the current input, merged from touch + keyboard.
  // The shared aux button is the handbrake while driving and the weapon
  // switch on foot, so the context has to be passed in.
  sample(aimAngle, inCar) {
    const s = this.state;
    let mx = 0, my = 0;

    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const max = this.stick.r;
      const k = len > max ? max / len : 1;
      mx = (dx * k) / max;
      my = (dy * k) / max;
      if (len < 6) { mx = 0; my = 0; }
    }

    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    s.mx = mx; s.my = my;
    s.fire = this.buttons.fire.pressed || k.has('Space') || this.mouse.down;
    s.enter = this.buttons.enter.pressed || k.has('KeyE');
    s.swap = (!inCar && this.buttons.aux.pressed) || k.has('KeyQ');
    s.brake = (inCar && this.buttons.aux.pressed) || k.has('ShiftLeft') || k.has('ShiftRight');
    this.buttons.aux.label = inCar ? 'BREMSE' : 'WAFFE';
    this.buttons.enter.label = inCar ? 'AUS' : 'EIN';
    s.aim = aimAngle;
    return s;
  }
}
