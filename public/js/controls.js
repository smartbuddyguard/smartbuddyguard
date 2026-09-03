// Translates raw stick / key input into the movement the world simulation
// expects, according to the control scheme the player picked.
//
//   classic  – like the original: forward/back plus turning on foot, and in a
//              car left/right steer the vehicle itself.
//   modern   – the stick points where you want to go: on foot that is the walk
//              direction, in a car the game steers the vehicle towards it.
//
// Both schemes end up as the same {mx, my} the server already understands, so
// the simulation stays untouched and authoritative.

import { clamp, angleDiff } from '/shared/util.js';

export const SCHEMES = ['modern', 'classic'];
export const SCHEME_LABELS = { modern: 'Modern', classic: 'Original' };
export const SCHEME_HINTS = {
  modern: 'Stick zeigt die Laufrichtung. Im Auto lenkt der Wagen automatisch dorthin, wohin du drückst.',
  classic: 'Wie GTA 1: vor/zurück gehen und mit links/rechts drehen. Im Auto lenken links/rechts den Wagen.'
};

const TURN_RATE = 3.4;          // rad/s while turning on foot in classic mode

export class Controls {
  constructor(scheme = 'modern') {
    this.scheme = SCHEMES.includes(scheme) ? scheme : 'modern';
    this.heading = 0;
  }

  setScheme(scheme) {
    if (!SCHEMES.includes(scheme)) return;
    this.scheme = scheme;
  }

  syncHeading(angle) { this.heading = angle; }

  // raw: what the Input class collected. ctx: { inCar, carAngle, carFwd,
  // playerAngle, autoAim, dt }. Returns the input the world expects.
  convert(raw, ctx) {
    const out = {
      mx: 0, my: 0, aim: 0,
      fire: raw.fire, brake: raw.brake, enter: raw.enter, swap: raw.swap
    };

    if (ctx.inCar) {
      if (this.scheme === 'classic') {
        out.mx = raw.mx;              // steer
        out.my = raw.my;              // the server reads throttle as -my
      } else {
        const drive = this.steerTowards(raw.mx, raw.my, ctx.carAngle, ctx.carFwd);
        out.mx = drive.steer;
        out.my = -drive.throttle;
      }
      out.aim = ctx.carAngle;
      this.heading = ctx.carAngle;
      return out;
    }

    if (this.scheme === 'classic') {
      // Turning is a rotation, not a direction: hold left/right to swing round.
      this.heading += raw.mx * TURN_RATE * (ctx.dt || 0);
      const move = clamp(-raw.my, -1, 1);
      out.mx = Math.cos(this.heading) * move;
      out.my = Math.sin(this.heading) * move;
      out.aim = this.heading;
      return out;
    }

    out.mx = raw.mx;
    out.my = raw.my;
    out.aim = ctx.autoAim;
    this.heading = ctx.playerAngle;
    return out;
  }

  // Modern driving: the stick is a heading request. Push where you want the
  // car to go and it steers there; pull back and it reverses out.
  steerTowards(mx, my, carAngle, carFwd) {
    const mag = Math.hypot(mx, my);
    if (mag < 0.15) return { throttle: 0, steer: 0 };

    const desired = Math.atan2(my, mx);
    const diff = angleDiff(carAngle, desired);

    // Pointing the stick behind a car that is still rolling means "turn round":
    // brake into the corner first instead of slamming it into reverse.
    if (Math.abs(diff) > 1.9 && carFwd > 45) {
      return { throttle: -0.4, steer: clamp(diff * 2.4, -1, 1) };
    }

    const slow = Math.abs(carFwd) < 45;
    const reversing = (Math.abs(diff) > 2.1 && slow) || (carFwd < -8 && Math.abs(diff) > 1.6);

    if (reversing) {
      // Back out of the corner, steering mirrored because the car rolls backwards.
      const back = angleDiff(carAngle + Math.PI, desired);
      return { throttle: -Math.min(1, mag), steer: clamp(-back * 2.2, -1, 1) };
    }

    // Ease off the throttle for sharp corners so the car actually makes them.
    const sharpness = Math.min(Math.abs(diff) / 1.6, 1);
    const throttle = Math.min(1, mag) * (1 - sharpness * 0.45);
    return { throttle, steer: clamp(diff * 2.4, -1, 1) };
  }
}

// --- little DOM helper so both clients get the same picker ----------------

export function loadScheme() {
  try { return localStorage.getItem('lc_scheme') || 'modern'; } catch { return 'modern'; }
}

export function mountSchemePicker(container, hintEl, controls, onChange) {
  if (!container) return;
  container.innerHTML = '';
  for (const scheme of SCHEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg' + (controls.scheme === scheme ? ' sel' : '');
    b.textContent = SCHEME_LABELS[scheme];
    b.onclick = () => {
      controls.setScheme(scheme);
      try { localStorage.setItem('lc_scheme', scheme); } catch { /* private mode */ }
      [...container.children].forEach(c => c.classList.remove('sel'));
      b.classList.add('sel');
      if (hintEl) hintEl.textContent = SCHEME_HINTS[scheme];
      if (onChange) onChange(scheme);
    };
    container.appendChild(b);
  }
  if (hintEl) hintEl.textContent = SCHEME_HINTS[controls.scheme];
}
